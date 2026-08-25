"""Registry-native turbine safety qualification for OpenTurbine 2.0.

The older safety_A..D scripts predate the canonical channel registry.  They can
set legacy sensors to enabled while the corresponding registry channels remain
absent; firmware then correctly sanitizes the safety flags back off.  This
campaign installs a complete registry-backed turbine profile, refuses to start
unless every requested protection verifies armed, and checks that every trip
also produces a physical fuel/ignition cut on OTBench.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))

from ten_build_webui_hil import TenBuildRunner, chan_input  # noqa: E402
from otbench.benchrig import hz  # noqa: E402


OIL_C = round(10.0 / 4095.0, 8)


class SafetyQualification:
    def __init__(self):
        self.runner = TenBuildRunner(port=os.environ.get("OTBENCH_PORT", "COM3"))
        self.dut = self.runner.dut
        self.t = self.runner.t
        self.firmware_before = self.dut.data().get("fw_version", "unknown")
        self.firmware_after = None
        self.rows: list[dict] = []

    def build_profile(self, hw):
        self.runner.common_turbine(hw, with_idle_input=False)
        self.runner.enable_n1(hw)
        self.runner.enable_n2(hw)
        self.runner.enable_tot(hw)
        self.runner.enable_oil_press(hw, pin=1)
        hw["sensors"]["flame"].update(enabled=True, pin=2)
        hw["channel_registry"]["inputs"].append(
            chan_input("flame_main", "Flame", "flame", "flame", 1, 2)
        )
        for key in hw["safety"]:
            hw["safety"][key] = key in (
                "overspeed", "n2_overspeed", "overtemp", "low_oil", "hot_start", "oil_zero", "flameout"
            )
        hw["startup_seq"] = [
            "OilPrime", "IgniterOn", "FuelOpen", "FuelPumpIdle",
            "TimedDelay", "IgniterOff", "TimedDelay",
        ]
        # Hold STARTUP long enough for the external thermocouple simulator and
        # its conversion interval to publish the dedicated startup-limit
        # stimulus before the sequence declares RUNNING.
        hw["startup_delay_ms"] = [0, 0, 0, 0, 5000, 0, 350]
        hw["startup_ignition_target"] = [0] * len(hw["startup_seq"])
        hw["startup_enter_actions"] = [[] for _ in hw["startup_seq"]]
        hw["startup_exit_actions"] = [[] for _ in hw["startup_seq"]]
        hw["shutdown_seq"] = ["ImmediateCut", "TimedDelay", "FinalStop"]
        hw["shutdown_delay_ms"] = [0, 250, 0]
        hw["shutdown_ignition_target"] = [0] * len(hw["shutdown_seq"])
        hw["shutdown_enter_actions"] = [[] for _ in hw["shutdown_seq"]]
        hw["shutdown_exit_actions"] = [[] for _ in hw["shutdown_seq"]]

    def install(self):
        self.runner.apply_profile({
            "id": "phase2_turbine_safety",
            "name": "Registry-native turbine safety profile",
            "build": self.build_profile,
        })
        ok, resp = self.runner.dc.patch_cfg({
            "engine": {"rpm_limit": 50000, "n2_rpm_limit": 30000, "min_rpm": 10000, "tot_limit": 700},
            "oil": {"startup_min_bar": 1.5, "running_min": 1.5},
            "calibration": {
                "oil_poly": {"a": 0, "b": 0, "c": OIL_C, "d": 0, "x_min": 0, "x_max": 4095},
            },
            "sequence": {"startup": {"pre_start_egt_limit_c": 200, "startup_egt_limit_c": 700}},
            "safety": {
                "check_interval_ms": 20,
                "flameout_shutdown_ms": 600,
                "flameout_source": 1,
                "flameout_egt_below_c": 300,
                "flameout_egt_fall_rate_c_s": 50,
            },
            "oil_advanced": {"zero_bar": 0.5},
            "relight": {"enabled": False},
            "throttle": {"ramp_up_ms": 0, "ramp_down_ms": 0, "fuel_pump_min_pct": 10},
        })
        if not ok:
            raise RuntimeError(f"safety settings did not verify: {resp}")
        # This campaign qualifies the built-in safety paths in isolation.
        # Clear any user rules left by a previous campaign so a deliberate
        # request_fault rule cannot pre-empt the safety stimulus under test.
        ok, resp = self.runner.dc.patch_cfg({"rules": []}, verify=False)
        if not ok or self.dut.config().get("rules"):
            raise RuntimeError(f"could not clear control rules for safety qualification: {resp}")
        self.verify_profile({"overspeed", "n2_overspeed", "overtemp", "low_oil", "hot_start", "oil_zero", "flameout"})

    def verify_profile(self, expected_safeties):
        hw = self.dut.hardware()
        data = self.dut.data()
        settings = self.dut.config()
        purposes = {c.get("purpose") for c in hw.get("channel_registry", {}).get("inputs", [])}
        armed = {key for key, value in hw.get("safety", {}).items() if value}
        required = {"n1_speed", "n2_speed", "tot", "oil_pressure", "flame"}
        if not required.issubset(purposes):
            raise RuntimeError(f"required registry inputs absent: {sorted(required - purposes)}")
        if armed != set(expected_safeties):
            raise RuntimeError(f"safeties not armed exactly: expected={sorted(expected_safeties)} got={sorted(armed)}")
        if not all(data.get(key) for key in ("has_n1", "has_n2", "has_tot", "has_oil_press", "has_flame")):
            raise RuntimeError("telemetry capability flags do not match the installed safety profile")
        if float(settings.get("engine", {}).get("n2_rpm_limit") or 0) != 30000:
            raise RuntimeError(f"hard N2 limit did not persist: {settings.get('engine', {}).get('n2_rpm_limit')!r}")
        if data.get("seq_has_errors"):
            _, data = self.dut.poll_until(lambda d: not d.get("seq_has_errors"), timeout=3, interval=0.15)
        if data.get("seq_has_errors"):
            raise RuntimeError(f"safety profile readiness issues: {data.get('seq_issues')}")
        print("Verified registry purposes:", sorted(required))
        print("Verified armed safeties:", sorted(armed))

    def set_safeties(self, *names):
        hw = self.dut.hardware()
        for key in hw["safety"]:
            hw["safety"][key] = key in names
        self.runner.prepare_hardware_save()
        previous_boot = self.dut.data().get("boot_count")
        deadline = time.time() + 3.0
        while True:
            code, resp = self.dut._post("/api/hardware", hw)
            if code != 409 or "configuration update" not in str(resp).lower() or time.time() >= deadline:
                break
            # Settings PATCH returns after persistence but the ECU core applies
            # the staged document on its next control tick. A back-to-back full
            # hardware save should respect that intentional transaction gate.
            time.sleep(0.05)
        if code != 200:
            raise RuntimeError(f"safety hardware save failed: HTTP {code} {resp}")
        if not self.runner.wait_dut_ready_after_hardware_save(previous_boot_count=previous_boot):
            raise RuntimeError("DUT did not return after changing safety enables")
        self.verify_profile(set(names))

    def baseline(self, rpm=40000, n2_rpm=24000, egt=120, oil_v=2.5, flame=1):
        self.t.set("N1", hz(rpm))
        self.t.set("N2", hz(n2_rpm))
        self.t.set_tot(egt)
        self.t.set("OILP", oil_v)
        self.t.set("FLAME", flame)
        ok, data = self.dut.poll_until(
            lambda d: (
                abs(float(d.get("n1") or 0) - rpm) <= max(2500, rpm * 0.2)
                and abs(float(d.get("n2") or 0) - n2_rpm) <= max(2500, n2_rpm * 0.2)
                and abs(float(d.get("tot") or 0) - egt) <= 30
                and float(d.get("oil") or 0) >= 1.5
                and bool(d.get("flame")) == bool(flame)
            ),
            timeout=5, interval=0.15,
        )
        if not ok:
            raise RuntimeError(
                "safety stimulus did not settle: "
                f"n1={data.get('n1')} n2={data.get('n2')} tot={data.get('tot')} "
                f"oil={data.get('oil')} flame={data.get('flame')}"
            )

    def start_running(self):
        self.baseline()
        self.dut.ensure_mode_standby(timeout=25)
        # This is a synthetic qualification run. Developer Mode keeps all
        # production safety behavior active but prevents the service hour
        # meter/start counters from being polluted by the bench campaign.
        self.dut.ensure_dev_mode(True)
        code, resp = self.dut.start()
        if code != 200:
            raise RuntimeError(f"START rejected: HTTP {code} {resp}")
        ok, data = self.dut.poll_until(lambda d: d.get("mode") == "RUNNING", timeout=20, interval=0.15)
        if not ok:
            raise RuntimeError(f"did not reach RUNNING: mode={data.get('mode')} fault={data.get('fault_description')}")
        return data

    def safe_cut(self):
        time.sleep(0.18)
        # Read one coherent actuator snapshot. Compact telemetry deliberately
        # rotates groups and its cache may still contain a pre-trip value even
        # though the physical outputs have already been cut.
        data = self.dut.full_data()
        fuel = self.t.get("FUEL_SOL")
        ign = self.t.get("IGNITER")
        throttle = self.t.get("THROTTLE_OUT")
        ok = (
            not data.get("fuel_sol_open")
            and not data.get("igniter_on")
            and float(data.get("throttle_effective") or 0) <= 0.001
            and int(fuel.get("level") or 0) == 0
            and int(ign.get("level") or 0) == 0
            and int(throttle.get("us") or 0) <= 1050
        )
        return ok, {
            "mode": data.get("mode"), "fuel": fuel, "igniter": ign,
            "throttle": throttle,
            "telemetry": {
                "fuel_sol_open": data.get("fuel_sol_open"),
                "igniter_on": data.get("igniter_on"),
                "throttle_effective": data.get("throttle_effective"),
            },
        }

    def recover(self):
        try:
            self.t.set("STOP", 0)
        except Exception:
            pass
        self.t.set("N1", 0)
        self.t.set("N2", 0)
        self.t.set_tot(120)
        self.t.set("OILP", 2.5)
        self.t.set("FLAME", 1)
        self.dut.stop()
        self.dut.ensure_mode_standby(timeout=25)
        time.sleep(0.3)

    def record(self, name, safe_side, tripped, matched, elapsed, detail, cut_ok, cut_detail):
        ok = bool(safe_side and tripped and matched and cut_ok)
        row = {
            "name": name, "ok": ok, "safe_side": bool(safe_side), "tripped": bool(tripped),
            "matched": bool(matched), "elapsed_s": elapsed, "detail": detail,
            "safe_cut": bool(cut_ok), "safe_cut_detail": cut_detail,
        }
        self.rows.append(row)
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: safe={safe_side} trip={tripped} "
              f"match={matched} cut={cut_ok} elapsed={elapsed} detail={detail!r}")
        return ok

    def trip_test(self, name, safe_drive, fault_drive, match, timeout=8, safe_secs=1.5):
        self.start_running()
        safe_drive()
        deadline = time.time() + safe_secs
        safe_side = True
        while time.time() < deadline:
            if self.dut.data().get("mode") not in ("STARTUP", "RUNNING"):
                safe_side = False
                break
            time.sleep(0.15)
        t0 = time.time()
        fault_drive()
        tripped = matched = False
        detail = ""
        elapsed = None
        deadline = time.time() + timeout
        while time.time() < deadline:
            data = self.dut.data()
            if data.get("mode") not in ("STARTUP", "RUNNING"):
                detail = str(data.get("fault_description") or data.get("last_event") or "")
                matched = match.lower() in detail.lower()
                tripped = True
                elapsed = round(time.time() - t0, 3)
                break
            time.sleep(0.15)
        cut_ok, cut_detail = self.safe_cut() if tripped else (False, {})
        self.record(name, safe_side, tripped, matched, elapsed, detail.splitlines()[0], cut_ok, cut_detail)
        self.recover()

    def hot_start(self):
        self.recover()
        self.baseline(egt=300)
        self.dut.ensure_dev_mode(True)
        code, resp = self.dut.start()
        t0 = time.time()
        tripped = matched = False
        detail = str(resp)
        if code == 200:
            ok, data = self.dut.poll_until(
                lambda d: d.get("mode") in ("SHUTDOWN", "FAULT") or "hot" in str(d.get("fault_description") or "").lower(),
                timeout=6, interval=0.15,
            )
            tripped = ok
            detail = str(data.get("fault_description") or data.get("last_event") or "")
            matched = "hot" in detail.lower()
        else:
            # Blocking START before fuel is the preferred hot-start response
            # when EGT is already above the pre-start limit. A later rise after
            # START remains covered by STARTUP_OVERTEMP below.
            reason = detail.lower()
            matched = "hot" in reason or "pre-start" in reason
            tripped = matched
        cut_ok, cut_detail = self.safe_cut()
        self.record("HOT_START", True, tripped, matched, round(time.time() - t0, 3), detail.splitlines()[0], cut_ok, cut_detail)
        self.recover()
        ok, resp = self.runner.dc.patch_cfg({"sequence": {"startup": {"pre_start_egt_limit_c": 1000}}})
        if not ok:
            raise RuntimeError(f"could not raise hot-start threshold for remaining tests: {resp}")

    def startup_overtemp(self):
        """Prove the STARTUP-only EGT limit without crossing the RUNNING limit."""
        self.recover()
        ok, resp = self.runner.dc.patch_cfg({
            "sequence": {"startup": {
                "pre_start_egt_limit_c": 1000,
                "startup_egt_limit_c": 500,
            }},
        })
        if not ok:
            raise RuntimeError(f"could not configure startup EGT limit: {resp}")
        self.baseline(egt=120)
        self.dut.ensure_dev_mode(True)
        code, resp = self.dut.start()
        t0 = time.time()
        entered = False
        if code == 200:
            entered, data = self.dut.poll_until(
                lambda d: d.get("mode") in ("STARTUP", "RUNNING"),
                timeout=3, interval=0.08,
            )
            if not entered:
                tripped = False
                matched = False
                detail = "START accepted but no fresh STARTUP transition was observed"
            else:
                # 600 C is deliberately below the normal 700 C continuous limit.
                # A trip therefore proves the separate STARTUP threshold was used.
                self.t.set_tot(600)
                tripped, data = self.dut.poll_until(
                    lambda d: d.get("mode") not in ("STARTUP", "RUNNING"),
                    timeout=5, interval=0.08,
                )
                detail = str(data.get("fault_description") or data.get("last_event") or "")
                matched = "over-temperature" in detail.lower()
        else:
            tripped = False
            matched = False
            detail = str(resp)
        cut_ok, cut_detail = self.safe_cut() if tripped else (False, {})
        self.record("STARTUP_OVERTEMP", code == 200 and entered, tripped, matched,
                    round(time.time() - t0, 3), detail.splitlines()[0],
                    cut_ok, cut_detail)
        self.recover()
        ok, resp = self.runner.dc.patch_cfg({
            "sequence": {"startup": {"startup_egt_limit_c": 700}},
        })
        if not ok:
            raise RuntimeError(f"could not restore startup EGT limit: {resp}")

    def hard_stop(self):
        self.start_running()
        self.t.set("STOP", 1)
        t0 = time.time()
        ok, data = self.dut.poll_until(lambda d: d.get("mode") not in ("STARTUP", "RUNNING"), timeout=3, interval=0.1)
        cut_ok, cut_detail = self.safe_cut() if ok else (False, {})
        self.record("PHYSICAL_STOP", True, ok, ok, round(time.time() - t0, 3) if ok else None,
                    str(data.get("last_event") or data.get("fault_description") or ""), cut_ok, cut_detail)
        self.t.set("STOP", 0)
        self.recover()

    def shared_reduced_power_cap(self):
        """Manual reduced-power and protection-feedback loss use one cap."""
        self.set_safeties("overspeed")
        ok, resp = self.runner.dc.patch_cfg({
            "engine": {"min_rpm": 0},
            "limp_mode": {"max_throttle_pct": 30},
            "rpm_health": {"zero_stuck_ticks": 4},
        })
        if not ok:
            raise RuntimeError(f"could not configure shared reduced-power test: {resp}")
        self.start_running()
        self.t.set("THROTTLE_IN", 3.3)
        full_ok, full = self.dut.poll_until(
            lambda d: float(d.get("throttle_effective") or 0) > 0.65,
            timeout=4, interval=0.15,
        )
        code, resp = self.dut.command("TOGGLE_LIMP_MODE")
        manual_ok, manual = self.dut.poll_until(
            lambda d: d.get("limp_mode") and float(d.get("throttle_effective") or 1) <= 0.305,
            timeout=3, interval=0.15,
        )
        manual_pulse = self.t.get("THROTTLE_OUT")
        self.dut.command("TOGGLE_LIMP_MODE")
        clear_ok, _ = self.dut.poll_until(
            lambda d: not d.get("limp_mode") and float(d.get("throttle_effective") or 0) > 0.65,
            timeout=3, interval=0.15,
        )
        self.t.set("N1", 0)
        auto_ok, automatic = self.dut.poll_until(
            lambda d: d.get("mode") == "RUNNING" and not d.get("n1_healthy") and
                      d.get("limp_mode") and float(d.get("throttle_effective") or 1) <= 0.305,
            timeout=6, interval=0.15,
        )
        auto_pulse = self.t.get("THROTTLE_OUT")
        physical_ok = int(manual_pulse.get("us") or 0) <= 1350 and int(auto_pulse.get("us") or 0) <= 1350
        passed = full_ok and code == 200 and manual_ok and clear_ok and auto_ok and physical_ok
        detail = {
            "command": {"code": code, "response": resp},
            "full_effective": full.get("throttle_effective"),
            "manual_effective": manual.get("throttle_effective"),
            "automatic_effective": automatic.get("throttle_effective"),
            "manual_pulse": manual_pulse,
            "automatic_pulse": auto_pulse,
        }
        self.rows.append({"name": "SHARED_REDUCED_POWER_CAP", "ok": bool(passed), "detail": detail})
        print(f"[{'PASS' if passed else 'FAIL'}] SHARED_REDUCED_POWER_CAP: {detail}")
        self.recover()
        ok, resp = self.runner.dc.patch_cfg({
            "engine": {"min_rpm": 10000},
            "limp_mode": {"max_throttle_pct": 50},
        })
        if not ok:
            raise RuntimeError(f"could not restore safety campaign settings: {resp}")
        self.set_safeties("overspeed", "n2_overspeed", "overtemp", "low_oil", "hot_start", "oil_zero", "flameout")

    def run(self):
        self.install()
        self.hot_start()
        self.startup_overtemp()
        self.shared_reduced_power_cap()
        self.trip_test("OVERSPEED", lambda: self.t.set("N1", hz(49000)),
                       lambda: self.t.set("N1", hz(60000)), "over-speed", timeout=4)
        self.trip_test("N2_OVERSPEED", lambda: self.t.set("N2", hz(29000)),
                       lambda: self.t.set("N2", hz(36000)), "N2 over-speed", timeout=4)
        self.trip_test("OVERTEMP", lambda: self.t.set_tot(650),
                       lambda: self.t.set_tot(800), "over-temperature", timeout=4)

        # Isolate ordinary low-oil from the deliberately faster catastrophic
        # near-zero-oil protection. With both armed, a stimulus below both
        # thresholds must correctly report OIL_ZERO first.
        self.set_safeties("low_oil")
        self.trip_test("LOW_OIL", lambda: self.t.set("OILP", 2.5),
                       lambda: self.t.set("OILP", 0.12), "low oil", timeout=4)

        self.set_safeties("oil_zero", "flameout")
        self.trip_test("OIL_ZERO", lambda: self.t.set("OILP", 2.5),
                       lambda: self.t.set("OILP", 0.0), "near zero", timeout=4)
        self.trip_test("FLAMEOUT", lambda: self.t.set("FLAME", 1),
                       lambda: self.t.set("FLAME", 0), "flameout", timeout=4)
        self.hard_stop()

    def close(self):
        self.recover()
        restored = self.runner.restore_original()
        self.runner.close()
        return restored


def main():
    qualification = SafetyQualification()
    restored = False
    error = None
    try:
        qualification.run()
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        print("ERROR:", error)
    finally:
        try:
            restored = qualification.close()
        except Exception as exc:  # noqa: BLE001
            print("RESTORE ERROR:", exc)
    try:
        qualification.firmware_after = qualification.dut.data().get("fw_version", "unknown")
    except Exception as exc:  # noqa: BLE001
        qualification.firmware_after = f"unavailable: {type(exc).__name__}"
    firmware_match = qualification.firmware_after == qualification.firmware_before
    result = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "firmware": qualification.firmware_before,
        "firmware_after": qualification.firmware_after,
        "firmware_match": firmware_match,
        "rows": qualification.rows,
        "restored": restored,
        "error": error,
    }
    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "results",
        "phase2_safety_hil_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".json",
    )
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    passed = sum(1 for row in qualification.rows if row["ok"])
    print(f"RESULT: {passed}/{len(qualification.rows)} safety checks passed; "
          f"firmware={qualification.firmware_before}; restored={restored}")
    print("Results:", os.path.abspath(path))
    return 0 if error is None and firmware_match and restored and passed == len(qualification.rows) and passed >= 7 else 1


if __name__ == "__main__":
    raise SystemExit(main())
