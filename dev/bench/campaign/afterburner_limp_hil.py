"""Prove afterburner fuel coordination cannot bypass degraded main-fuel limits."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))

from ten_build_webui_hil import TenBuildRunner  # noqa: E402
from otbench.benchrig import hz  # noqa: E402


def main() -> int:
    runner = TenBuildRunner(port=os.environ.get("OTBENCH_PORT", "COM3"))
    dut, t = runner.dut, runner.t
    rows = []
    error = None
    restored = False

    def record(name, ok, **detail):
        rows.append({"name": name, "ok": bool(ok), "detail": detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}", flush=True)

    def build(hw):
        runner.common_turbine(hw, with_idle_input=False, with_fuel_sol=False)
        runner.enable_n1(hw)
        runner.enable_tot(hw)
        hw["has_afterburner"] = True
        hw["actuators"]["ab_sol"].update(enabled=True, pin=12, active_h=True)
        hw["actuators"]["ab_pump"].update(enabled=True, pin=39, type=2, active_h=True)
        hw["ab_trigger"].update(source=0, requires_arm=False)
        # Bench mode makes ABFlameConfirm deterministic, while retaining the
        # same explicit confirmation contract required from production sequences.
        hw["ab_seq"] = ["ABSolOpen", "ABPumpOn", "ABFlameConfirm", "ABStabilize"]
        hw["ab_delay_ms"] = [0, 0, 0, 300]
        hw["ab_ignition_target"] = [0, 0, 0, 0]
        hw["ab_enter_actions"] = [[], [], [], []]
        hw["ab_exit_actions"] = [[], [], [], []]

    try:
        runner.apply_profile({
            "id": "afterburner_limp_interaction",
            "name": "Afterburner/reduced-power interaction",
            "build": build,
        })
        ok, resp = runner.dc.patch_cfg({
            "engine": {"rpm_limit": 90000, "min_rpm": 0, "tot_limit": 900},
            "throttle": {
                "ramp_up_ms": 0, "ramp_down_ms": 0, "fuel_pump_min_pct": 10,
                "rpm_limiter_mode": 0,
                "pullback_n1": False, "pullback_n2": False,
                "pullback_egt": False, "pullback_p1": False,
                "pullback_p2": False, "pullback_torque": False,
            },
            "limp_mode": {"max_throttle_pct": 30},
            "afterburner": {
                "main_fuel_offset_pct": 20, "pump_min_pct": 20,
                "pump_max_pct": 90, "pump_control_mode": 0,
                "stabilize_ms": 300, "stabilize_max_tot": 0,
            },
            "rules": [],
        }, verify=False)
        if not ok:
            raise RuntimeError(f"afterburner interaction config failed: {resp}")

        runner.safe_standby()
        dut.ensure_dev_mode(True)
        dut.ensure_bench_mode(True)
        t.set("N1", hz(45000))
        t.set_tot(300)
        t.set("OILP", 2.5)
        t.set("FLAME", 1)
        t.set("THROTTLE_IN", 0.7)
        time.sleep(1)
        code, resp = dut.start()
        if code != 200:
            raise RuntimeError(f"afterburner interaction START rejected: HTTP {code} {resp}")
        running, data = dut.poll_until(lambda d: d.get("mode") == "RUNNING", timeout=20, interval=0.06)
        if not running:
            raise RuntimeError(f"afterburner interaction did not reach RUNNING: {data}")

        base = dut.data()
        base_pulse = t.get("THROTTLE_OUT")
        code, resp = dut.command("AB_FIRE")
        ab_ok, ab = dut.poll_until(
            lambda d: d.get("ab_mode") == "Running" and float(d.get("ab_fuel_offset") or 0) >= 0.19,
            timeout=7, interval=0.06,
        )
        time.sleep(0.2)
        ab_pulse = t.get("THROTTLE_OUT")
        ab_sol = t.get("FUEL_SOL")
        ab_pump = t.get("STARTER_EN")
        record(
            "AFTERBURNER_OFFSET_REACHES_PHYSICAL_MAIN_FUEL_OUTPUT",
            code == 200 and ab_ok and int(ab_sol.get("level") or 0) == 1 and
            int(ab_pump.get("level") or 0) == 1 and
            int(ab_pulse.get("us") or 0) > int(base_pulse.get("us") or 0) + 120,
            command=resp, baseline_effective=base.get("throttle_effective"),
            baseline_pulse=base_pulse, ab_offset=ab.get("ab_fuel_offset"),
            ab_pulse=ab_pulse, ab_solenoid=ab_sol, ab_pump=ab_pump,
        )

        code, resp = dut.command("TOGGLE_LIMP_MODE")
        capped_ok, capped = dut.poll_until(
            lambda d: d.get("limp_mode") and
                      float(d.get("throttle_effective", 1) if d.get("throttle_effective") is not None else 1) <= 0.305,
            timeout=3, interval=0.05,
        )
        time.sleep(0.2)
        capped_pulse = t.get("THROTTLE_OUT")
        capped_sol = t.get("FUEL_SOL")
        capped_pump = t.get("STARTER_EN")
        ab_stopped_safely = (
            capped.get("ab_mode") != "Running" and
            float(capped.get("ab_fuel_offset") or 0) <= 0.001 and
            int(capped_sol.get("level") or 0) == 0 and
            int(capped_pump.get("level") or 0) == 0
        )
        # 1000..2000 us calibration: a true 30% total main-fuel cap is <=1300 us.
        record(
            "REDUCED_POWER_CAP_INCLUDES_AFTERBURNER_MAIN_FUEL_OFFSET",
            code == 200 and capped_ok and
            float(capped.get("throttle_effective", 1) if capped.get("throttle_effective") is not None else 1) <= 0.305 and
            int(capped_pulse.get("us") or 0) <= 1305 and
            (capped.get("ab_mode") == "Running" or ab_stopped_safely),
            command=resp, throttle_effective=capped.get("throttle_effective"),
            ab_mode=capped.get("ab_mode"), ab_offset=capped.get("ab_fuel_offset"),
            capped_pulse=capped_pulse, ab_solenoid=capped_sol, ab_pump=capped_pump,
        )

        t.set("STOP", 1)
        stopped, stopped_data = dut.poll_until(
            lambda d: d.get("mode") != "RUNNING", timeout=3, interval=0.03
        )
        time.sleep(0.2)
        throttle = t.get("THROTTLE_OUT")
        sol = t.get("STARTER_EN")
        fuel = t.get("FUEL_SOL")
        telemetry_clear, stopped_full = dut.poll_until(
            lambda d: (
                not d.get("ab_sol_open") and
                float(d.get("ab_pump_demand") or 0) <= 0.001 and
                float(d.get("ab_fuel_offset") or 0) <= 0.001
            ),
            timeout=2, interval=0.08,
        )
        # Capture one coherent post-cut document for the report. Compact live
        # telemetry rotates field groups and can legitimately retain the last
        # RUNNING AB group for one frame after the physical pins are already safe.
        stopped_data = dut.full_data()
        safe = (
            stopped and int(throttle.get("us") or 0) <= 1050 and
            int(sol.get("level") or 0) == 0 and int(fuel.get("level") or 0) == 0 and
            telemetry_clear and
            not stopped_data.get("ab_sol_open") and
            float(stopped_data.get("ab_pump_demand") or 0) <= 0.001 and
            float(stopped_data.get("ab_fuel_offset") or 0) <= 0.001
        )
        record(
            "PHYSICAL_STOP_CUTS_AFTERBURNER_AND_MAIN_COMBUSTION",
            safe, event=stopped_data.get("last_event"), throttle=throttle,
            ab_solenoid=sol, fuel_shutoff=fuel,
            telemetry={k: stopped_data.get(k) for k in
                       ("ab_sol_open", "ab_pump_demand", "ab_fuel_offset", "mode")},
        )
        t.set("STOP", 0)
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
        print("ERROR:", error, flush=True)
    finally:
        t.set("STOP", 0)
        restore_error = None
        for attempt in range(1, 4):
            try:
                runner.reconnect_wifi()
                dut.stop()
                dut.ensure_mode_standby(timeout=25)
                restored = runner.restore_original()
                if restored:
                    break
            except Exception as exc:  # noqa: BLE001
                restore_error = exc
                print(f"RESTORE RETRY {attempt}: {exc}", flush=True)
            time.sleep(3)
        if not restored and restore_error is not None:
            print("RESTORE ERROR:", restore_error, flush=True)
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
        "afterburner_limp_hil_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".json",
    )
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    passed = sum(1 for row in rows if row["ok"])
    print(f"RESULT: {passed}/{len(rows)} afterburner interaction checks passed; "
          f"firmware={runner.firmware_before}; restored={restored}", flush=True)
    print("Results:", os.path.abspath(path), flush=True)
    return 0 if (error is None and restored and result["firmware_match"] and
                 len(rows) == 3 and passed == len(rows)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
