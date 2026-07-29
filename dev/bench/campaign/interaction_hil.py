"""Cross-dependency HIL for turbine controls, rules, and safety priority.

This complements the isolated phase-two safety campaign.  It deliberately
allows controllers and control rules to demand hazardous outputs, then proves
that pullback, reduced-power, feedback-loss, hard safety, physical STOP, and
rule-requested shutdown retain the intended ordering at the physical pins.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))

from ten_build_webui_hil import TenBuildRunner, chan_input  # noqa: E402
from otbench.benchrig import hz  # noqa: E402


OIL_C = round(10.0 / 4095.0, 8)
RUNNING_MASK = 4


class InteractionQualification:
    def __init__(self):
        self.runner = TenBuildRunner(port=os.environ.get("OTBENCH_PORT", "COM3"))
        self.dut = self.runner.dut
        self.t = self.runner.t
        self.rows: list[dict] = []

    def record(self, name: str, ok: bool, **detail) -> bool:
        row = {"name": name, "ok": bool(ok), "detail": detail}
        self.rows.append(row)
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}", flush=True)
        return bool(ok)

    def build_profile(self, hw) -> None:
        self.runner.common_turbine(hw, with_idle_input=False)
        self.runner.enable_n1(hw)
        self.runner.enable_n2(hw)
        self.runner.enable_tot(hw)
        self.runner.enable_oil_press(hw, pin=1)
        hw["sensors"]["flame"].update(enabled=True, pin=2)
        hw["channel_registry"]["inputs"].append(
            chan_input("flame_main", "Flame", "flame", "flame", 1, 2)
        )
        # A coarse/fine pitch solenoid makes the degraded-state pitch command
        # physically observable without taking the main-fuel servo capture pin.
        hw["actuators"]["prop_pitch"].update(enabled=True, pin=39, type=2, active_h=True)
        hw["controllers"].update(
            governor=True, dynamic_idle=True, oil_loop=True
        )
        for key in hw["safety"]:
            hw["safety"][key] = key in (
                "overspeed", "n2_overspeed", "overtemp", "low_oil",
                "hot_start", "oil_zero", "flameout",
            )
        hw["startup_seq"] = [
            "OilPrime", "IgniterOn", "FuelOpen", "FuelPumpIdle",
            "TimedDelay", "IgniterOff", "TimedDelay",
        ]
        hw["startup_delay_ms"] = [0, 0, 0, 0, 350, 0, 350]
        hw["startup_ignition_target"] = [0] * len(hw["startup_seq"])
        hw["startup_enter_actions"] = [[] for _ in hw["startup_seq"]]
        hw["startup_exit_actions"] = [[] for _ in hw["startup_seq"]]
        hw["shutdown_seq"] = ["ImmediateCut", "TimedDelay", "FinalStop"]
        hw["shutdown_delay_ms"] = [0, 250, 0]
        hw["shutdown_ignition_target"] = [0] * len(hw["shutdown_seq"])
        hw["shutdown_enter_actions"] = [[] for _ in hw["shutdown_seq"]]
        hw["shutdown_exit_actions"] = [[] for _ in hw["shutdown_seq"]]

    @staticmethod
    def output_rules():
        return [
            {
                "enabled": True, "kind": 0, "source": "tot_main",
                "target": "main_fuel", "op": 0, "threshold": 50,
                "on_value": 1.0, "off_value": 0.0, "hysteresis": 0,
                "mode_mask": RUNNING_MASK, "name": "hil_force_fuel",
            },
            {
                "enabled": True, "kind": 0, "source": "tot_main",
                "target": "igniter_main", "op": 0, "threshold": 50,
                "on_value": 1.0, "off_value": 0.0, "hysteresis": 0,
                "mode_mask": RUNNING_MASK, "name": "hil_force_ignition",
            },
        ]

    def save_rules(self, rules, expected_names) -> None:
        if self.dut.data().get("mode") == "STANDBY":
            deadline = time.time() + 10
            while time.time() < deadline and not self.runner.outputs_idle(self.dut.data()):
                time.sleep(0.15)
        ok, resp = self.runner.dc.patch_cfg({"rules": rules}, verify=False)
        saved = self.dut.config().get("rules", [])
        names = {r.get("name") for r in saved}
        if not ok or names != set(expected_names):
            raise RuntimeError(f"interaction rules did not persist: {resp} {saved}")

    def install(self) -> None:
        self.runner.apply_profile({
            "id": "interaction_turbine_profile",
            "name": "Controller/rule/safety interaction profile",
            "build": self.build_profile,
        })
        ok, resp = self.runner.dc.patch_cfg({
            "engine": {
                "rpm_limit": 60000, "n2_rpm_limit": 50000,
                "min_rpm": 10000, "tot_limit": 850,
            },
            "oil": {
                "startup_min_bar": 1.5, "running_min": 1.5,
                "min_pct": 15, "use_throttle_map": False,
            },
            "calibration": {
                "flame_threshold": 500,
                "oil_poly": {"a": 0, "b": 0, "c": OIL_C, "d": 0,
                             "x_min": 0, "x_max": 4095},
            },
            "sequence": {"startup": {"pre_start_egt_limit_c": 200, "startup_egt_limit_c": 0}},
            "safety": {
                "check_interval_ms": 20, "flameout_shutdown_ms": 700,
                "flameout_source": 1, "flameout_egt_below_c": 300,
                "flameout_egt_fall_rate_c_s": 50,
                "low_oil_confirm_ms": 1500, "oil_zero_confirm_ms": 1500,
            },
            "oil_advanced": {"zero_bar": 0.2},
            "governor": {
                "target_rpm": 40000, "band_rpm": 500, "kp": 0.003,
                "pitch_kp": 0, "pitch_ramp_sec": 1,
            },
            "dynamic_idle": {
                "target_rpm": 35000, "rpm_limit": 39000,
                "deadband_rpm": 300, "ramp_up_ms": 300,
                "ramp_down_ms": 300, "max_multiplier": 1.5,
            },
            "throttle": {
                "ramp_up_ms": 0, "ramp_down_ms": 0, "fuel_pump_min_pct": 10,
                "pullback_n1": True, "pullback_n1_soft_rpm": 40000,
                "pullback_n1_hard_rpm": 50000,
                "pullback_n2": True, "pullback_n2_soft_rpm": 35000,
                "pullback_n2_hard_rpm": 45000,
                "pullback_egt": True, "pullback_egt_soft_c": 650,
                "pullback_egt_hard_c": 800, "pullback_min_pct": 8,
                "pullback_strength": 1,
            },
            "limp_mode": {"max_throttle_pct": 30},
            "rpm_health": {"zero_stuck_ticks": 4},
            "relight": {"enabled": False},
        })
        if not ok:
            raise RuntimeError(f"interaction settings did not verify: {resp}")
        # Rule serialization includes resolved numeric IDs and default mapping
        # fields, so DutConfig's exact list comparison is intentionally too
        # strict for this section. Verify the saved rule identities instead.
        self.save_rules(self.output_rules(), {"hil_force_fuel", "hil_force_ignition"})
        hw = self.dut.hardware()
        data = self.dut.data()
        purposes = {c.get("purpose") for c in hw["channel_registry"]["inputs"]}
        required = {"n1_speed", "n2_speed", "tot", "oil_pressure", "flame"}
        if not required.issubset(purposes):
            raise RuntimeError(f"interaction inputs absent: {sorted(required - purposes)}")
        if not all(hw["controllers"].get(k) for k in
                   ("governor", "dynamic_idle", "oil_loop")):
            raise RuntimeError("not every interaction controller remained enabled")
        if data.get("seq_has_errors"):
            raise RuntimeError(f"interaction profile readiness issues: {data.get('seq_issues')}")

    def drive(self, n1=35000, n2=30000, egt=300, oil_v=2.5, flame=1,
              throttle_v=0.2, seconds=0.0):
        end = time.time() + seconds
        while True:
            self.t.set("N1", hz(n1))
            self.t.set("N2", hz(n2))
            self.t.set_tot(egt)
            self.t.set("OILP", oil_v)
            self.t.set("FLAME", flame)
            self.t.set("THROTTLE_IN", throttle_v)
            if time.time() >= end:
                break
            time.sleep(0.12)
        return self.dut.data()

    def clear_limp(self) -> None:
        self.drive(seconds=1.0)
        if self.dut.data().get("limp_mode"):
            code, resp = self.dut.command("TOGGLE_LIMP_MODE")
            if code != 200:
                raise RuntimeError(f"could not clear reduced-power mode: {resp}")
            self.dut.poll_until(lambda d: not d.get("limp_mode"), timeout=3, interval=0.05)

    def start_running(self):
        self.dut.ensure_mode_standby(timeout=25)
        self.dut.ensure_dev_mode(True)
        self.dut.ensure_bench_mode(False)
        self.clear_limp()
        # Perform housekeeping first, then leave the final pre-start sample
        # below the armed hot-start threshold. Interaction stimuli are applied
        # only after the sequencer reaches RUNNING.
        self.drive(egt=120, seconds=1.2)
        code, resp = self.dut.start()
        if code != 200:
            data = self.dut.data()
            health = {
                key: data.get(key) for key in (
                    "n1", "n1_healthy", "n2", "n2_healthy", "tot", "tot_healthy",
                    "oil", "oil_healthy", "flame", "flame_healthy",
                    "throttle_input_norm", "mode", "last_event",
                )
            }
            raise RuntimeError(
                f"interaction START rejected: HTTP {code} {resp}; feedback={health}"
            )
        ok, data = self.dut.poll_until(
            lambda d: d.get("mode") == "RUNNING", timeout=20, interval=0.06
        )
        if not ok:
            raise RuntimeError(f"interaction profile did not reach RUNNING: {data}")
        return data

    def physical_cut(self):
        time.sleep(0.2)
        data = self.dut.data()
        fuel = self.t.get("FUEL_SOL")
        igniter = self.t.get("IGNITER")
        throttle = self.t.get("THROTTLE_OUT")
        ok = (
            not data.get("fuel_sol_open") and not data.get("igniter_on") and
            float(data.get("throttle_effective") or 0) <= 0.001 and
            int(fuel.get("level") or 0) == 0 and
            int(igniter.get("level") or 0) == 0 and
            int(throttle.get("us") or 0) <= 1050
        )
        return ok, {"mode": data.get("mode"), "fuel": fuel,
                    "igniter": igniter, "throttle": throttle}

    def recover(self) -> None:
        self.t.set("STOP", 0)
        self.drive(n1=0, n2=0, egt=120, oil_v=2.5, flame=1)
        self.dut.stop()
        self.dut.ensure_mode_standby(timeout=25)
        self.clear_limp()
        try:
            self.dut.command("SET_THROTTLE_PCT", fParam=0, iParam=0)
            self.dut.command("SET_OIL_PCT", fParam=0, iParam=0)
        except Exception:
            pass
        deadline = time.time() + 10
        while time.time() < deadline and not self.runner.outputs_idle(self.dut.data()):
            time.sleep(0.15)

    def controller_rule_protection_stack(self) -> None:
        self.start_running()
        baseline = self.drive(seconds=2.5)
        baseline_pulse = self.t.get("THROTTLE_OUT")
        base_eff = float(baseline.get("throttle_effective") or 0)
        rule_active = base_eff > 0.9 and baseline.get("igniter_on")
        self.record(
            "RULE_AND_CONTROLLERS_CAN_COMMAND_OUTPUT",
            rule_active and int(baseline_pulse.get("us") or 0) >= 1850,
            throttle_effective=base_eff, throttle_pulse=baseline_pulse,
            igniter_on=baseline.get("igniter_on"),
        )

        pulled = self.drive(n1=46000, n2=39000, egt=730, seconds=3.0)
        pulled_pulse = self.t.get("THROTTLE_OUT")
        pulled_eff = float(pulled.get("throttle_effective") or 0)
        self.record(
            "N1_N2_EGT_PULLBACK_DOMINATES_RULE_AND_GOVERNOR",
            pulled.get("mode") == "RUNNING" and pulled_eff < base_eff - 0.2 and
            int(pulled_pulse.get("us") or 0) < int(baseline_pulse.get("us") or 0) - 150,
            baseline_effective=base_eff, pulled_effective=pulled_eff,
            mode=pulled.get("mode"), event=pulled.get("last_event"),
            baseline_pulse=baseline_pulse, pulled_pulse=pulled_pulse,
        )

        # Return to a stable, below-pullback RUNNING point before testing the
        # shared cap. This keeps the assertion about precedence rather than
        # about recovery from the deliberately stacked pullback transient.
        self.clear_limp()
        stable = self.drive(seconds=1.2)
        if stable.get("limp_mode"):
            raise RuntimeError("reduced-power mode re-latched after all required feedback stabilized")
        code, resp = self.dut.command("TOGGLE_LIMP_MODE")
        ok, limp = self.dut.poll_until(
            lambda d: d.get("limp_mode") and
                      float(d.get("throttle_effective") or 1) <= 0.305,
            timeout=3, interval=0.05,
        )
        limp_pulse = self.t.get("THROTTLE_OUT")
        self.record(
            "REDUCED_POWER_DOMINATES_RULE_CONTROLLER_AND_PULLBACK",
            stable.get("mode") == "RUNNING" and code == 200 and ok and
            int(limp_pulse.get("us") or 0) <= 1350,
            command=resp, throttle_effective=limp.get("throttle_effective"),
            stable_effective=stable.get("throttle_effective"), throttle_pulse=limp_pulse,
        )
        self.dut.command("TOGGLE_LIMP_MODE")
        self.drive(seconds=1.0)

        self.t.set("N2", 0)
        ok, lost = self.dut.poll_until(
            lambda d: d.get("mode") == "RUNNING" and not d.get("n2_healthy") and
                      d.get("limp_mode") and float(d.get("throttle_effective") or 1) <= 0.305 and
                      float(d.get("prop_pitch_demand") or 0) >= 0.99,
            timeout=7, interval=0.05,
        )
        fuel_pulse = self.t.get("THROTTLE_OUT")
        pitch = self.t.get("STARTER_EN")
        self.record(
            "N2_FEEDBACK_LOSS_CAPS_FUEL_AND_COMMANDS_COARSE_PITCH",
            ok and int(fuel_pulse.get("us") or 0) <= 1350 and
            int(pitch.get("level") or 0) == 1,
            telemetry={k: lost.get(k) for k in
                       ("n2_healthy", "limp_mode", "throttle_effective", "prop_pitch_demand")},
            fuel_pulse=fuel_pulse, pitch_output=pitch,
        )
        self.recover()

    def safety_and_stop_priority(self) -> None:
        self.start_running()
        active = self.drive(seconds=1.0)
        self.t.set("N1", hz(65000))
        tripped, trip = self.dut.poll_until(
            lambda d: d.get("mode") != "RUNNING", timeout=4, interval=0.04
        )
        cut, physical = self.physical_cut() if tripped else (False, {})
        self.record(
            "OVERSPEED_SHUTDOWN_OVERRIDES_ACTIVE_RULE_OUTPUTS",
            tripped and cut and "speed" in
            str(trip.get("fault_description") or trip.get("last_event") or "").lower(),
            pretrip_fuel=active.get("throttle_effective"),
            event=trip.get("fault_description") or trip.get("last_event"), physical=physical,
        )
        self.recover()

        self.start_running()
        before = self.drive(oil_v=2.5, seconds=1.0)
        max_oil_pct = float(before.get("oil_pct") or 0)
        deadline = time.time() + 5
        low = None
        while time.time() < deadline:
            self.drive(oil_v=0.4)
            low = self.dut.data()
            max_oil_pct = max(max_oil_pct, float(low.get("oil_pct") or 0))
            if low.get("mode") != "RUNNING":
                break
            time.sleep(0.05)
        tripped = bool(low and low.get("mode") != "RUNNING")
        cut, physical = self.physical_cut() if tripped else (False, {})
        event = (low or {}).get("fault_description") or (low or {}).get("last_event")
        self.record(
            "OIL_CONTROLLER_RECOVERY_CANNOT_MASK_LOW_OIL_SHUTDOWN",
            tripped and cut and max_oil_pct > float(before.get("oil_pct") or 0) + 10 and
            "oil" in str(event or "").lower(),
            initial_oil_pct=before.get("oil_pct"), max_oil_pct=max_oil_pct,
            event=event, physical=physical,
        )
        self.recover()

        self.start_running()
        active = self.drive(seconds=1.0)
        self.t.set("STOP", 1)
        stopped, data = self.dut.poll_until(
            lambda d: d.get("mode") != "RUNNING", timeout=3, interval=0.03
        )
        cut, physical = self.physical_cut() if stopped else (False, {})
        self.record(
            "PHYSICAL_STOP_OVERRIDES_RULES_AND_CONTROLLERS",
            stopped and cut, pre_stop_effective=active.get("throttle_effective"),
            event=data.get("last_event"), physical=physical,
        )
        self.t.set("STOP", 0)
        self.recover()

    def rule_shutdown_priority(self) -> None:
        shutdown_rule = [{
            "enabled": True, "kind": 0, "source": "tot_main",
            "target": "request_shutdown", "op": 0, "threshold": 600,
            "on_value": 1.0, "off_value": 0.0, "hysteresis": 0,
            "mode_mask": RUNNING_MASK, "name": "hil_hot_shutdown",
        }]
        self.save_rules(shutdown_rule, {"hil_hot_shutdown"})
        self.start_running()
        stable = self.drive(egt=300, seconds=1.0)
        self.t.set_tot(650)
        stopped, data = self.dut.poll_until(
            lambda d: d.get("mode") != "RUNNING", timeout=4, interval=0.04
        )
        cut, physical = self.physical_cut() if stopped else (False, {})
        self.record(
            "RULE_REQUESTED_SHUTDOWN_USES_SAFE_CUT_WITH_CONTROLLERS_ACTIVE",
            stable.get("mode") == "RUNNING" and stopped and cut,
            event=data.get("last_event") or data.get("fault_description"), physical=physical,
        )
        self.recover()

    def controller_rule_lifecycle_and_relight(self) -> None:
        # With N2 on target, let low N1 make Dynamic Idle raise fuel. The
        # reduced-power cap must remain the final authority over that floor.
        self.save_rules([], set())
        ok, resp = self.runner.dc.patch_cfg({
            "throttle": {"idle_max_pct": 50},
            "governor": {"target_rpm": 40000},
        })
        if not ok:
            raise RuntimeError(f"could not configure idle/governor interaction: {resp}")
        self.start_running()
        low_idle = dict(n1=20000, n2=40000, egt=300, throttle_v=0)
        self.drive(**low_idle, seconds=1.0)
        if self.dut.data().get("limp_mode"):
            code, resp = self.dut.command("TOGGLE_LIMP_MODE")
            if code != 200:
                raise RuntimeError(f"could not clear reduced-power before idle test: {resp}")
            self.dut.poll_until(lambda d: not d.get("limp_mode"), timeout=3, interval=0.05)
        idle = self.drive(**low_idle, seconds=4.0)
        idle_pulse = self.t.get("THROTTLE_OUT")
        code, resp = self.dut.command("TOGGLE_LIMP_MODE")
        capped_ok, capped = self.dut.poll_until(
            lambda d: d.get("limp_mode") and float(d.get("throttle_effective") or 1) <= 0.305,
            timeout=3, interval=0.05,
        )
        capped_pulse = self.t.get("THROTTLE_OUT")
        self.record(
            "REDUCED_POWER_CAP_DOMINATES_DYNAMIC_IDLE_AND_GOVERNOR",
            idle.get("mode") == "RUNNING" and float(idle.get("throttle_effective") or 0) > 0.3 and
            code == 200 and capped_ok and int(capped_pulse.get("us") or 0) <= 1350,
            idle_effective=idle.get("throttle_effective"), idle_pulse=idle_pulse,
            capped_effective=capped.get("throttle_effective"), capped_pulse=capped_pulse,
            command=resp,
        )
        self.recover()

        # Developer Mode intentionally permits runtime Config changes. Removing
        # an active rule must apply atomically on the ECU core and release its
        # output; the following run must not inherit the deleted demand.
        ign_rule = [{
            "enabled": True, "kind": 0, "source": "tot_main",
            "target": "igniter_main", "op": 0, "threshold": 50,
            "on_value": 1.0, "off_value": 0.0, "hysteresis": 0,
            "mode_mask": RUNNING_MASK, "name": "hil_transient_ignition",
        }]
        self.save_rules(ign_rule, {"hil_transient_ignition"})
        self.start_running()
        on_ok, on = self.dut.poll_until(
            lambda d: d.get("mode") == "RUNNING" and d.get("igniter_on"),
            timeout=3, interval=0.05,
        )
        physical_on = self.t.get("IGNITER")
        edit_code, edit_resp = self.dut.patch("/api/config", {"rules": []})
        released_ok, released = self.dut.poll_until(
            lambda d: d.get("mode") == "RUNNING" and not d.get("igniter_on"),
            timeout=2, interval=0.05,
        )
        self.recover()
        self.save_rules([], set())
        self.start_running()
        off_ok, off = self.dut.poll_until(
            lambda d: d.get("mode") == "RUNNING" and not d.get("igniter_on"),
            timeout=3, interval=0.05,
        )
        physical_off = self.t.get("IGNITER")
        self.record(
            "DEV_MODE_RUNNING_RULE_DELETE_ATOMICALLY_RELEASES_OUTPUT",
            on_ok and int(physical_on.get("level") or 0) == 1 and
            edit_code == 200 and released_ok and off_ok and
            int(physical_off.get("level") or 0) == 0,
            on_telemetry=on.get("igniter_on"), on_output=physical_on,
            running_edit={"code": edit_code, "response": edit_resp,
                          "igniter_released": not released.get("igniter_on")},
            off_telemetry=off.get("igniter_on"), off_output=physical_off,
        )
        self.recover()

        # Relight, governor, and an active main-fuel rule may all be working;
        # the hardwired STOP path must still win immediately.
        fuel_rule = [{
            "enabled": True, "kind": 0, "source": "tot_main",
            "target": "main_fuel", "op": 0, "threshold": 50,
            "on_value": 1.0, "off_value": 0.0, "hysteresis": 0,
            "mode_mask": RUNNING_MASK, "name": "hil_relight_fuel",
        }]
        self.save_rules(fuel_rule, {"hil_relight_fuel"})
        ok, resp = self.runner.dc.patch_cfg({
            "relight": {
                "enabled": True, "min_rpm": 30000, "confirm_rpm": 35000,
                "relight_timeout_ms": 4000,
            }
        })
        if not ok:
            raise RuntimeError(f"could not configure relight interaction: {resp}")
        self.start_running()
        self.drive(n1=45000, n2=35000, egt=400, flame=1, seconds=1.0)
        deadline = time.time() + 7
        relight_seen = False
        relight_data = {}
        while time.time() < deadline:
            self.drive(n1=45000, n2=35000, egt=100, flame=0)
            relight_data = self.dut.data()
            if relight_data.get("relight_armed") or (relight_data.get("relight_attempts") or 0) > 0:
                relight_seen = True
            if relight_seen and relight_data.get("igniter_on"):
                break
            if relight_data.get("mode") != "RUNNING":
                break
            time.sleep(0.06)
        self.t.set("STOP", 1)
        stopped, stopped_data = self.dut.poll_until(
            lambda d: d.get("mode") != "RUNNING", timeout=3, interval=0.03
        )
        cut, physical = self.physical_cut() if stopped else (False, {})
        self.record(
            "PHYSICAL_STOP_OVERRIDES_ACTIVE_RELIGHT_GOVERNOR_AND_RULE",
            relight_seen and stopped and cut,
            relight_telemetry={k: relight_data.get(k) for k in
                               ("relight_armed", "relight_attempts", "igniter_on", "mode")},
            stop_event=stopped_data.get("last_event"), physical=physical,
        )
        self.t.set("STOP", 0)
        self.recover()

    def simultaneous_fault_and_rule_fault(self) -> None:
        ok, resp = self.runner.dc.patch_cfg({"relight": {"enabled": False}})
        if not ok:
            raise RuntimeError(f"could not disable relight: {resp}")
        self.save_rules(self.output_rules(), {"hil_force_fuel", "hil_force_ignition"})
        self.start_running()
        active = self.drive(seconds=1.0)
        self.t.set("N1", hz(65000))
        self.t.set("N2", hz(55000))
        self.t.set_tot(900)
        self.t.set("OILP", 0.1)
        stopped, data = self.dut.poll_until(
            lambda d: d.get("mode") != "RUNNING", timeout=4, interval=0.03
        )
        cut, physical = self.physical_cut() if stopped else (False, {})
        event = data.get("fault_description") or data.get("last_event")
        self.record(
            "SIMULTANEOUS_SHAFT_TEMP_AND_OIL_FAULTS_FAIL_SAFE",
            active.get("mode") == "RUNNING" and stopped and cut and
            any(word in str(event or "").lower() for word in ("speed", "temperature", "oil")),
            event=event, physical=physical,
        )
        self.recover()

        fault_rule = [{
            "enabled": True, "kind": 0, "source": "tot_main",
            "target": "request_fault", "op": 0, "threshold": 600,
            "on_value": 1.0, "off_value": 0.0, "hysteresis": 0,
            "mode_mask": RUNNING_MASK, "name": "hil_rule_fault",
        }]
        self.save_rules(fault_rule, {"hil_rule_fault"})
        self.start_running()
        stable = self.drive(egt=300, seconds=1.0)
        self.t.set_tot(650)
        faulted, data = self.dut.poll_until(
            lambda d: d.get("mode") not in ("STARTUP", "RUNNING"), timeout=4, interval=0.03
        )
        cut, physical = self.physical_cut() if faulted else (False, {})
        description = data.get("fault_description") or ""
        self.record(
            "RULE_REQUESTED_FAULT_CUTS_OUTPUTS_AND_IDENTIFIES_RULE",
            stable.get("mode") == "RUNNING" and faulted and cut and
            ("hil_rule_fault" in description or "control rule" in description.lower()),
            mode=data.get("mode"), description=description, physical=physical,
        )
        self.recover()

    def run(self) -> None:
        self.install()
        self.controller_rule_protection_stack()
        self.safety_and_stop_priority()
        self.rule_shutdown_priority()
        self.controller_rule_lifecycle_and_relight()
        self.simultaneous_fault_and_rule_fault()

    def close(self) -> bool:
        try:
            self.recover()
        except Exception as exc:  # noqa: BLE001
            print("RECOVERY WARNING:", exc, flush=True)
        restored = self.runner.restore_original()
        self.runner.close()
        return restored


def main() -> int:
    q = InteractionQualification()
    restored = False
    error = None
    try:
        q.run()
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
        print("ERROR:", error, flush=True)
    finally:
        try:
            restored = q.close()
        except Exception as exc:  # noqa: BLE001
            print("RESTORE ERROR:", exc, flush=True)
    firmware_after = q.runner.firmware_after
    result = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "firmware": q.runner.firmware_before,
        "firmware_after": firmware_after,
        "firmware_match": firmware_after == q.runner.firmware_before,
        "rows": q.rows, "restored": restored, "error": error,
    }
    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "results",
        "interaction_hil_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".json",
    )
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    passed = sum(1 for row in q.rows if row["ok"])
    print(f"RESULT: {passed}/{len(q.rows)} interaction checks passed; "
          f"firmware={q.runner.firmware_before}; restored={restored}", flush=True)
    print("Results:", os.path.abspath(path), flush=True)
    return 0 if error is None and restored and result["firmware_match"] and passed == len(q.rows) and passed >= 13 else 1


if __name__ == "__main__":
    raise SystemExit(main())
