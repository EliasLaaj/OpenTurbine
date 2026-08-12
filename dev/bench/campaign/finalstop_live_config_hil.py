"""Qualify no-N1 FinalStop timing and Developer Mode live config writes."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))

from ten_build_webui_hil import TenBuildRunner  # noqa: E402


def main() -> int:
    runner = TenBuildRunner(port=os.environ.get("OTBENCH_PORT", "COM3"))
    dut, tester = runner.dut, runner.t
    rows: list[dict] = []
    error = None
    restored = False

    def record(name, ok, **detail):
        rows.append({"name": name, "ok": bool(ok), "detail": detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}", flush=True)

    def build(hw):
        runner.common_turbine(
            hw, with_throttle_input=False, with_idle_input=False,
            with_throttle_output=False, with_oil=True,
            with_fuel_sol=False, with_igniter=False,
        )
        # This profile intentionally has no N1 source. Oil is turned on during
        # startup and no explicit OilPumpOff block exists in shutdown.
        hw["startup_seq"] = ["OilPumpOn", "TimedDelay"]
        hw["startup_delay_ms"] = [0, 250]
        hw["startup_ignition_target"] = [0, 0]
        hw["startup_enter_actions"] = [[], []]
        hw["startup_exit_actions"] = [[], []]
        hw["shutdown_seq"] = ["ImmediateCut", "FinalStop"]
        hw["shutdown_delay_ms"] = [0, 0]
        hw["shutdown_ignition_target"] = [0, 0]
        hw["shutdown_enter_actions"] = [[], []]
        hw["shutdown_exit_actions"] = [[], []]

    def start_and_wait():
        if not runner.dc._wait_config_apply():
            raise RuntimeError("configuration transaction did not finish before START")
        code, resp = dut.start()
        running, data = dut.poll_until(lambda d: d.get("mode") == "RUNNING", timeout=8, interval=0.04)
        if code != 200 or not running:
            raise RuntimeError(f"test profile did not reach RUNNING: HTTP {code} {resp} {data}")
        return data

    try:
        runner.apply_profile({
            "id": "finalstop_live_config_hil",
            "name": "No-N1 shutdown and live config",
            "build": build,
        })
        ok, resp = runner.dc.patch_cfg({
            "engine": {"rpm_limit": 90000, "min_rpm": 0},
            "oil": {"startup_pct": 70},
            "sequence": {"shutdown": {"final_stop_timeout_ms": 2000}},
            "throttle": {"ramp_down_ms": 0},
            "rules": [],
        }, verify=False)
        if not ok:
            raise RuntimeError(f"test settings save failed: {resp}")

        runner.safe_standby()
        dut.ensure_dev_mode(True)
        dut.ensure_bench_mode(True)
        start_and_wait()

        code, resp = dut.patch("/api/config", {
            "throttle": {"ramp_up_ms": 250},
        })
        live_apply_complete = code == 200 and runner.dc._wait_config_apply()
        live = dut.data()
        applied = int(dut.config().get("throttle", {}).get("ramp_up_ms") or 0) == 250
        record(
            "DEV_MODE_APPLIES_MARKED_LIVE_FIELD_WHILE_RUNNING",
            code == 200 and live_apply_complete and applied,
            http=code, response=resp, mode=live.get("mode"),
            saved_ramp_up_ms=dut.config().get("throttle", {}).get("ramp_up_ms"),
        )

        block_code, block_resp = dut.patch("/api/config", {
            "sequence": {"shutdown": {"final_stop_timeout_ms": 1000}},
        })

        oil_before = tester.get("OILPUMP_OUT")
        started = time.monotonic()
        dut.stop()
        in_shutdown, shutdown_data = dut.poll_until(
            lambda d: d.get("mode") == "SHUTDOWN", timeout=1.2, interval=0.02
        )
        time.sleep(0.45)
        oil_during = tester.get("OILPUMP_OUT")
        standby, stopped = dut.poll_until(
            lambda d: d.get("mode") == "STANDBY", timeout=5, interval=0.02
        )
        elapsed = time.monotonic() - started
        oil_after = tester.get("OILPUMP_OUT")
        record(
            "NO_N1_FINALSTOP_USES_CONFIGURED_DELAY",
            in_shutdown and standby and 1.75 <= elapsed <= 3.2,
            elapsed_s=round(elapsed, 3), last_event=stopped.get("last_event"),
        )
        record(
            "OIL_STAYS_ON_THROUGH_DELAY_THEN_STANDBY_FORCES_OFF",
            float(oil_before.get("duty") or 0) > 0.2 and
            float(oil_during.get("duty") or 0) > 0.2 and
            float(oil_after.get("duty") or 0) < 0.05,
            before=oil_before, during=oil_during, after=oil_after,
            shutdown_mode=shutdown_data.get("mode"),
        )

        # Sequence topology/timing is not a marked live field. It must be
        # rejected while RUNNING, then apply normally after reaching STANDBY.
        stopped_code, stopped_resp = dut.patch("/api/config", {
            "sequence": {"shutdown": {"final_stop_timeout_ms": 1000}},
        })
        stopped_apply_complete = stopped_code == 200 and runner.dc._wait_config_apply()
        start_and_wait()
        started = time.monotonic()
        dut.stop()
        standby, stopped = dut.poll_until(
            lambda d: d.get("mode") == "STANDBY", timeout=3, interval=0.02
        )
        deferred_elapsed = time.monotonic() - started
        record(
            "RUNNING_BLOCK_CHANGE_REJECTED_THEN_STOPPED_CHANGE_APPLIES",
            block_code == 423 and stopped_code == 200 and stopped_apply_complete and standby and
            0.8 <= deferred_elapsed <= 1.9,
            elapsed_s=round(deferred_elapsed, 3),
            running_edit={"http": block_code, "response": block_resp},
            stopped_edit={"http": stopped_code, "response": stopped_resp},
            configured_timeout_ms=1000, last_event=stopped.get("last_event"),
        )

        dut.ensure_bench_mode(False)
        dut.ensure_dev_mode(False)
        start_and_wait()
        code, resp = dut.patch("/api/config", {"throttle": {"ramp_down_ms": 333}})
        record(
            "NORMAL_RUNNING_MODE_LOCKS_EVEN_MARKED_LIVE_FIELDS",
            code == 423 and int(dut.config().get("throttle", {}).get("ramp_down_ms") or 0) == 0,
            http=code, response=resp,
        )
        dut.stop()
        dut.ensure_mode_standby(timeout=8)
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
        print("ERROR:", error, flush=True)
    finally:
        tester.set("STOP", 0)
        try:
            runner.reconnect_wifi()
            dut.stop()
            dut.ensure_mode_standby(timeout=10)
            restored = runner.restore_original()
        except Exception as exc:  # noqa: BLE001
            print("RESTORE ERROR:", exc, flush=True)
        runner.close()

    result = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "firmware": runner.firmware_before,
        "firmware_after": runner.firmware_after,
        "firmware_match": runner.firmware_after == runner.firmware_before,
        "rows": rows, "restored": restored, "error": error,
    }
    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "results",
        "finalstop_live_config_hil_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".json",
    )
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    passed = sum(1 for row in rows if row["ok"])
    print(f"RESULT: {passed}/{len(rows)} checks passed; restored={restored}", flush=True)
    print("Results:", os.path.abspath(path), flush=True)
    return 0 if (error is None and restored and result["firmware_match"] and
                 len(rows) == 5 and passed == len(rows)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
