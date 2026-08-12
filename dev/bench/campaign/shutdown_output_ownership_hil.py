"""Qualify shutdown ownership of main-oil and scavenge-pump outputs.

Exercises paths not covered by the normal safety campaigns:
  * FinalStop keeps main oil on until its no-N1 delay expires.
  * The main pump then stops while the independent scavenge pump runs longer.
  * STANDBY turns the scavenge pump off after its configured overrun.
  * The physical cooldown override stops the active sequence, including a
    deliberately unmatched OilScavengeOn block, so it cannot resume in STANDBY.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))

from ten_build_webui_hil import TenBuildRunner, chan_output  # noqa: E402


def main() -> int:
    runner = TenBuildRunner(port=os.environ.get("OTBENCH_PORT", "COM3"))
    dut, tester = runner.dut, runner.t
    rows: list[dict] = []
    error = None
    restored = False

    def record(name, ok, **detail):
        rows.append({"name": name, "ok": bool(ok), "detail": detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}", flush=True)

    def base_build(hw, shutdown):
        runner.common_turbine(
            hw, with_throttle_input=False, with_idle_input=False,
            with_throttle_output=False, with_oil=True,
            with_fuel_sol=False, with_igniter=False,
        )
        # Relay scavenge output is captured on the tester's STARTER_EN input.
        hw["actuators"]["oil_scavenge_pump"].update(
            enabled=True, pin=39, type=2, active_h=True,
        )
        hw["channel_registry"]["outputs"].append(
            chan_output("scavenge_pump", "Scavenge Pump", "scavenge_pump",
                        "scavenge_pump", 4, 39)
        )
        hw["startup_seq"] = ["OilPumpOn", "TimedDelay"]
        hw["startup_delay_ms"] = [0, 150]
        hw["startup_ignition_target"] = [0, 0]
        hw["startup_enter_actions"] = [[], []]
        hw["startup_exit_actions"] = [[], []]
        hw["shutdown_seq"] = shutdown
        hw["shutdown_delay_ms"] = [0] * len(shutdown)
        hw["shutdown_ignition_target"] = [0] * len(shutdown)
        hw["shutdown_enter_actions"] = [[] for _ in shutdown]
        hw["shutdown_exit_actions"] = [[] for _ in shutdown]

    def start_running():
        runner.safe_standby()
        dut.ensure_dev_mode(True)
        dut.ensure_bench_mode(True)
        code, resp = dut.start()
        ok, data = dut.poll_until(lambda d: d.get("mode") == "RUNNING", timeout=8, interval=0.03)
        if code != 200 or not ok:
            raise RuntimeError(f"profile did not reach RUNNING: HTTP {code} {resp} {data}")
        return data

    try:
        runner.apply_profile({
            "id": "shutdown_output_ownership",
            "name": "Oil and scavenge shutdown ownership",
            "build": lambda hw: base_build(hw, ["ImmediateCut", "FinalStop"]),
        })
        ok, resp = runner.dc.patch_cfg({
            "sequence": {"shutdown": {
                "final_stop_timeout_ms": 1000,
                "oil_scavenge_ms": 1100,
            }},
            "rules": [],
        }, verify=False)
        if not ok:
            raise RuntimeError(f"FinalStop settings save failed: {resp}")

        running = start_running()
        main_before = tester.get("OILPUMP_OUT")
        started = time.monotonic()
        dut.stop()
        time.sleep(0.35)
        main_during_delay = tester.get("OILPUMP_OUT")
        scav_during_delay = tester.get("STARTER_EN")
        phase_ok, phase = dut.poll_until(
            lambda d: d.get("mode") == "SHUTDOWN" and d.get("oil_scavenge_on")
                      and float(d.get("oil_pct") or 0) < 0.05,
            timeout=2.0, interval=0.02,
        )
        main_during_scavenge = tester.get("OILPUMP_OUT")
        scav_active = tester.get("STARTER_EN")
        standby, stopped = dut.poll_until(
            lambda d: d.get("mode") == "STANDBY", timeout=3.0, interval=0.02,
        )
        elapsed = time.monotonic() - started
        main_after = tester.get("OILPUMP_OUT")
        scav_after = tester.get("STARTER_EN")

        record(
            "MAIN_OIL_REMAINS_ON_DURING_FINAL_STOP_DELAY",
            float(main_before.get("duty") or 0) > 0.5 and
            float(main_during_delay.get("duty") or 0) > 0.5 and
            int(scav_during_delay.get("level") or 0) == 0,
            running_oil_pct=running.get("oil_pct"), before=main_before,
            during_delay=main_during_delay, scavenge=scav_during_delay,
        )
        record(
            "SCAVENGE_OVERRUN_STARTS_ONLY_AFTER_MAIN_OIL_STOPS",
            phase_ok and float(main_during_scavenge.get("duty") or 0) < 0.05 and
            int(scav_active.get("level") or 0) == 1,
            telemetry={k: phase.get(k) for k in ("mode", "oil_pct", "oil_scavenge_on", "seq_wait_reason")},
            main_output=main_during_scavenge, scavenge_output=scav_active,
        )
        record(
            "SHUTDOWN_WAITS_FOR_SCAVENGE_THEN_STANDBY_FORCES_OFF",
            standby and 1.55 <= elapsed <= 2.8 and
            float(main_after.get("duty") or 0) < 0.05 and
            int(scav_after.get("level") or 0) == 0,
            elapsed_s=round(elapsed, 3), mode=stopped.get("mode"),
            main_output=main_after, scavenge_output=scav_after,
        )

        # Now hold an unmatched OilScavengeOn through a long delay. The
        # operator override must cancel the sequence itself, not merely write
        # the outputs off once while the sequence keeps running in STANDBY.
        runner.apply_profile({
            "id": "shutdown_override_ownership",
            "name": "Cooldown override sequence cancellation",
            "build": lambda hw: base_build(
                hw, ["ImmediateCut", "OilScavengeOn", "TimedDelay", "FinalStop"]
            ),
        })
        ok, resp = runner.dc.patch_cfg({
            "misc": {"cooldown_skip_hold_ms": 500},
            "sequence": {"shutdown": {
                "final_stop_timeout_ms": 1000,
                "oil_scavenge_ms": 0,
            }},
            # Shared TimedDelay is per-card in hardware; the third entry above
            # is configured by shutdown_delay_ms in the profile below.
            "rules": [],
        }, verify=False)
        if not ok:
            raise RuntimeError(f"override settings save failed: {resp}")
        hw = dut.hardware()
        hw["shutdown_delay_ms"] = [0, 0, 5000, 0]
        previous_boot = dut.data().get("boot_count")
        code, resp = dut._post("/api/hardware", hw)
        if code != 200 or not runner.wait_dut_ready_after_hardware_save(previous_boot_count=previous_boot):
            raise RuntimeError(f"override delay hardware save failed: HTTP {code} {resp}")

        start_running()
        dut.stop()
        active, active_data = dut.poll_until(
            lambda d: d.get("mode") == "SHUTDOWN" and d.get("current_block") == "TimedDelay"
                      and d.get("oil_scavenge_on"),
            timeout=2.0, interval=0.02,
        )
        physical_active = tester.get("STARTER_EN")
        tester.set("START", 1)
        tester.set("STOP", 1)
        skipped, skipped_data = dut.poll_until(
            lambda d: d.get("mode") == "STANDBY", timeout=2.5, interval=0.02,
        )
        tester.set("START", 0)
        tester.set("STOP", 0)
        immediate_off = tester.get("STARTER_EN")
        time.sleep(5.4)
        later = dut.data()
        later_output = tester.get("STARTER_EN")
        record(
            "COOLDOWN_OVERRIDE_CANCELS_UNMATCHED_SCAVENGE_SEQUENCE",
            active and int(physical_active.get("level") or 0) == 1 and skipped and
            int(immediate_off.get("level") or 0) == 0 and
            later.get("mode") == "STANDBY" and not later.get("oil_scavenge_on") and
            not later.get("current_block") and int(later_output.get("level") or 0) == 0,
            active={"telemetry": active_data.get("current_block"), "output": physical_active},
            skipped={"event": skipped_data.get("last_event"), "output": immediate_off},
            after_old_deadline={"mode": later.get("mode"), "block": later.get("current_block"),
                                "scavenge": later.get("oil_scavenge_on"), "output": later_output},
        )
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
        print("ERROR:", error, flush=True)
    finally:
        tester.set("START", 0)
        tester.set("STOP", 0)
        try:
            runner.reconnect_wifi()
            dut.stop()
            dut.ensure_mode_standby(timeout=12)
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
        "shutdown_output_ownership_hil_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".json",
    )
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    passed = sum(1 for row in rows if row["ok"])
    print(f"RESULT: {passed}/{len(rows)} checks passed; restored={restored}", flush=True)
    print("Results:", os.path.abspath(path), flush=True)
    return 0 if (error is None and restored and result["firmware_match"] and
                 len(rows) == 4 and passed == len(rows)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
