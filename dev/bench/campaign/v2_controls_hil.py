"""OpenTurbine 2.0 final HIL: Pulsed Starter Assist and pressure idle.

Normal bench orientation: ESP32-S3 = OpenTurbine DUT, classic ESP32 = OTBench.
The script snapshots and restores both Hardware and Config. Load power must stay
disconnected: this qualification uses logic-level cross-links only.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))

from ten_build_webui_hil import TenBuildRunner, chan_input, chan_output  # noqa: E402
from otbench.benchrig import hz  # noqa: E402


RESULT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "results"))


class V2ControlsQualification:
    def __init__(self):
        self.r = TenBuildRunner(port=os.environ.get("OTBENCH_PORT", "COM3"))
        self.dut, self.dc, self.t = self.r.dut, self.r.dc, self.r.t
        self.rows = []

    def record(self, name, ok, **detail):
        row = {"name": name, "ok": bool(ok), "detail": detail}
        self.rows.append(row)
        print("[%s] %s: %s" % ("PASS" if ok else "FAIL", name, detail), flush=True)
        return bool(ok)

    @staticmethod
    def _minimal_sequences(hw, startup):
        hw["startup_seq"] = startup
        hw["startup_delay_ms"] = [0] * len(startup)
        hw["startup_ignition_target"] = [0] * len(startup)
        hw["startup_enter_actions"] = [[] for _ in startup]
        hw["startup_exit_actions"] = [[] for _ in startup]
        hw["shutdown_seq"] = ["ImmediateCut", "TimedDelay", "FinalStop"]
        hw["shutdown_delay_ms"] = [0, 250, 0]
        hw["shutdown_ignition_target"] = [0, 0, 0]
        hw["shutdown_enter_actions"] = [[], [], []]
        hw["shutdown_exit_actions"] = [[], [], []]

    def _starter_profile(self, hw):
        self.r.enable_n1(hw)
        hw["actuators"]["starter"].update(
            enabled=True, pin=40, type=0, min_us=1000, max_us=2000, inverted=False
        )
        hw["channel_registry"] = {
            "version": 1,
            "inputs": [chan_input("n1_main", "N1 Speed", "speed", "n1_speed", 2, 14,
                                  pulses_per_unit=1.0)],
            "outputs": [chan_output("starter", "Starter", "starter", "starter", 6, 40,
                                    min=1000, max=2000)],
            "bindings": [
                {"key": "primary_n1", "channel": "n1_main"},
                {"key": "main_starter", "channel": "starter"},
            ],
        }
        self._minimal_sequences(hw, ["StarterSpin", "TimedDelay"])
        hw["startup_delay_ms"] = [0, 1200]

    def _read_servo(self):
        sample = self.t.get("THROTTLE_OUT")
        return int(sample.get("us") or 0), sample

    def _wait_servo(self, predicate, timeout=3.0):
        end = time.time() + timeout
        last = {}
        while time.time() < end:
            us, last = self._read_servo()
            if predicate(us):
                return True, us, last
            time.sleep(0.04)
        return False, int(last.get("us") or 0), last

    def test_starter_assist(self):
        print("\n--- Pulsed Starter Assist ---", flush=True)
        self.r.apply_profile({"id": "v2_pulsed_starter", "build": self._starter_profile})
        ok, detail = self.dc.patch_cfg({
            "sequence": {"startup": {
                "pre_ign_rpm": 3000, "starter_demand": 60,
                "starter_timeout_ms": 6000,
            }},
            "starter_control": {
                "pulsed_assist_enabled": True,
                "pulsed_assist_pwm_pct": 20,
                "pulsed_assist_until_rpm": 1000,
                "pulsed_assist_on_ms": 500,
                "pulsed_assist_off_ms": 250,
                "startup_ramp_pct_per_s": 1000,
            },
        })
        if not ok:
            raise RuntimeError("Pulsed Starter Assist config rejected: %r" % (detail,))

        # The commissioning action must be one pulse and must automatically stop.
        self.dut.ensure_mode_standby()
        code, response = self.dut.command("PULSED_STARTER_ASSIST_TEST")
        seen_on, peak, _ = self._wait_servo(lambda us: us >= 1150, timeout=1.2)
        seen_off, final_us, _ = self._wait_servo(lambda us: 0 < us <= 1050, timeout=1.5)
        self.record("standby assist test auto-stops", code == 200 and seen_on and seen_off,
                    http=code, peak_us=peak, final_us=final_us, response=response)

        # Actual StarterSpin should repeat 500/250 ms pulses while N1 is low.
        # Keep synthetic starts out of the user's persistent service counters.
        # Developer Mode does not relax startup/safety behavior.
        self.dut.ensure_dev_mode(True)
        self.t.set("N1", hz(300))
        time.sleep(1.0)
        code, response = self.dut.start()
        if code != 200:
            raise RuntimeError("StarterSpin START rejected: HTTP %s %r" % (code, response))
        samples = []
        # The tester's serial query cadence can miss a short 250 ms OFF phase.
        # Observe enough cycles that the physical repeated pattern is still
        # unambiguous without assuming every edge is sampled.
        end = time.time() + 4.0
        while time.time() < end:
            us, _ = self._read_servo()
            samples.append((time.time(), us))
            # The tester's pulse generator runs continuously after SET. Sending
            # the same SET command every sample halves the capture cadence and
            # can hide the 250 ms OFF phases we are trying to observe.
            time.sleep(0.04)
        states = [1 if us >= 1150 else 0 for _, us in samples if us > 0]
        transitions = sum(a != b for a, b in zip(states, states[1:]))
        self.record("StarterSpin repeats ON/OFF pulses",
                    1 in states and 0 in states and transitions >= 4,
                    transitions=transitions, min_us=min((u for _, u in samples), default=0),
                    max_us=max((u for _, u in samples), default=0))

        # Crossing the threshold ends pulsing; falling below it must not restart it.
        self.t.set("N1", hz(1500))
        normal, normal_us, _ = self._wait_servo(lambda us: us >= 1500, timeout=1.5)
        self.t.set("N1", hz(300))
        latched = True
        latch_samples = []
        end = time.time() + 1.0
        while time.time() < end:
            us, _ = self._read_servo()
            latch_samples.append(us)
            latched = latched and us >= 1450
            self.t.set("N1", hz(300))
            time.sleep(0.05)
        self.record("assist threshold latches normal starter control", normal and latched,
                    normal_us=normal_us, post_drop_min_us=min(latch_samples or [0]))

        # STOP must cut the physical pulse immediately.
        self.dut.stop()
        stopped, stopped_us, raw = self._wait_servo(lambda us: us == 0 or us <= 1050, timeout=0.8)
        data = self.dut.data()
        self.record("STOP cuts starter output", stopped and not data.get("starter_enabled") and
                    float(data.get("starter_demand") or 0) == 0,
                    pulse_us=stopped_us, tester=raw, mode=data.get("mode"))
        self.t.set("N1", 0)
        self.dut.ensure_mode_standby()

    def _pressure_profile(self, hw, purpose):
        self.r.common_turbine(hw, with_throttle_input=True, with_idle_input=False,
                              with_throttle_output=True, with_oil=False,
                              with_fuel_sol=False, with_igniter=False)
        key = "p1" if purpose == "p1_pressure" else "p2"
        hw["sensors"][key].update(enabled=True, pin=1)
        hw["controllers"]["dynamic_idle"] = True
        hw["channel_registry"] = {
            "version": 1,
            "inputs": [
                chan_input("operator_throttle", "Throttle Input", "operator", "throttle", 1, 4),
                chan_input(key + "_main", key.upper() + " Pressure", "pressure", purpose, 1, 1,
                           analog_zero_mv=0, analog_mv_per_unit=1000),
            ],
            "outputs": [chan_output("main_fuel", "Main Fuel", "fuel", "main_fuel", 6, 40,
                                    min=1000, max=2000)],
            "bindings": [{"key": "main_fuel_output", "channel": "main_fuel"}],
        }
        self._minimal_sequences(hw, ["TimedDelay"])
        hw["startup_delay_ms"] = [500]

    def _run_pressure_source(self, source, purpose):
        label = "P1" if source == 2 else "P2"
        self.r.apply_profile({
            "id": "v2_idle_" + label.lower(),
            "build": lambda hw: self._pressure_profile(hw, purpose),
        })
        ok, response = self.dc.patch_cfg({
            "dynamic_idle": {
                "source": source, "target_pressure_bar": 1.5,
                "pressure_deadband_bar": 0.05, "pressure_limit_bar": 3.0,
                "ramp_up_ms": 700, "ramp_down_ms": 700,
                "max_multiplier": 2.0,
                "i_gain": 0, "idle_mode": 0,
            },
            "throttle": {
                "fuel_pump_min_pct": 10, "idle_max_pct": 45,
                "ramp_up_ms": 0, "ramp_down_ms": 0,
            },
        })
        if not ok:
            raise RuntimeError("%s Automatic Idle config rejected: %r" % (label, response))
        self.dut.ensure_dev_mode(True)
        self.dut.ensure_bench_mode(True)
        if not self.dut.data().get("dynamic_idle_enabled"):
            self.dut.command("TOGGLE_DYNAMIC_IDLE")
        self.t.set("THROTTLE_IN", 0.0)
        self.t.set("OILP", 0.5)
        code, response = self.dut.start()
        if code != 200:
            raise RuntimeError("%s idle START rejected: HTTP %s %r" % (label, code, response))
        reached, _ = self.dut.poll_until(lambda d: d.get("mode") == "RUNNING", timeout=8)
        if not reached:
            raise RuntimeError("%s idle profile did not reach RUNNING" % label)

        def hold(volts, seconds):
            end = time.time() + seconds
            values = []
            while time.time() < end:
                self.t.set("OILP", volts)
                self.t.set("THROTTLE_IN", 0.0)
                d = self.dut.data()
                values.append(float(d.get("throttle_effective") or 0))
                time.sleep(0.12)
            return values[-1], max(values or [0])

        low_last, low_peak = hold(0.5, 2.5)
        high_last, _ = hold(2.5, 2.5)
        limit_last, _ = hold(3.2, 1.3)
        # Automatic Idle is an idle *floor*: above the pressure limit it
        # withdraws its extra demand, but the configured main-fuel minimum
        # remains authoritative.  Do not expect it to command below that
        # physical minimum.
        self.record(label + " pressure Automatic Idle response",
                    low_peak > 0.12 and high_last < low_peak - 0.05 and
                    limit_last <= 0.14 and limit_last < low_peak - 0.05,
                    low_peak=round(low_peak, 3), high_final=round(high_last, 3),
                    above_limit=round(limit_last, 3))
        self.dut.stop()
        self.dut.ensure_mode_standby()

    def test_pressure_idle(self):
        print("\n--- P1/P2 Automatic Idle ---", flush=True)
        self._run_pressure_source(2, "p1_pressure")
        self._run_pressure_source(3, "p2_pressure")

    def test_gradual_limiter_modes(self):
        print("\n--- Simple and predictive gradual protection ---", flush=True)
        self.r.apply_profile({
            "id": "v2_p1_limiter",
            "build": lambda hw: self._pressure_profile(hw, "p1_pressure"),
        })
        ok, response = self.dc.patch_cfg({
            "dynamic_idle": {"source": 2},
            "throttle": {
                "ramp_up_ms": 0, "ramp_down_ms": 0,
                "pullback_p1": True,
                "pullback_p1_soft_bar": 1.0,
                "pullback_p1_hard_bar": 2.0,
                "pullback_min_pct": 20,
                "pullback_strength": 1.0,
                "rpm_limiter_mode": 0,
                "pullback_lookahead_ms": 5000,
            },
        })
        if not ok:
            raise RuntimeError("Gradual-limiter config rejected: %r" % (response,))
        self.dut.ensure_dev_mode(True)
        self.dut.ensure_bench_mode(True)
        if self.dut.data().get("dynamic_idle_enabled"):
            self.dut.command("TOGGLE_DYNAMIC_IDLE")
        self.t.set("THROTTLE_IN", 3.0)
        self.t.set("OILP", 0.5)
        code, response = self.dut.start()
        if code != 200:
            raise RuntimeError("Limiter START rejected: HTTP %s %r" % (code, response))
        reached, _ = self.dut.poll_until(lambda d: d.get("mode") == "RUNNING", timeout=8)
        if not reached:
            raise RuntimeError("Limiter profile did not reach RUNNING")

        def wait_sample(volts, predicate, timeout=4.0):
            end = time.time() + timeout
            last = {}
            while time.time() < end:
                self.t.set("OILP", volts)
                last = self.dut.data()
                if predicate(last):
                    return True, last
                time.sleep(0.04)
            return False, last

        settled, data = wait_sample(
            0.2, lambda d: float(d.get("p1") or 0) < 0.4 and
            float(d.get("throttle_effective") or 0) > 0.75)
        unrestricted = float(data.get("throttle_effective") or 0)
        full_seen, data = wait_sample(
            2.5, lambda d: float(d.get("p1") or 0) >= 2.0 and
            float(d.get("throttle_effective") or 0) <= 0.25)
        at_full = float(data.get("throttle_effective") or 0)
        full_p1 = float(data.get("p1") or 0)
        self.record("simple limiter reaches configured floor at full threshold",
                    settled and full_seen and unrestricted > 0.75 and
                    0.16 <= at_full <= 0.25,
                    unrestricted=round(unrestricted, 3), p1=round(full_p1, 3),
                    at_full=round(at_full, 3))

        wait_sample(0.2, lambda d: float(d.get("p1") or 0) < 0.4 and
                    float(d.get("throttle_effective") or 0) > 0.75)
        # Limiter strategy is intentionally not a live-tunable field.  End the
        # simple-mode run before selecting predictive mode, then establish a
        # fresh RUNNING baseline so this test follows the same workflow as the
        # web UI and does not rely on a rejected mid-run structural edit.
        self.dut.stop()
        # FinalStop is a real spool-down guard and may legitimately consume
        # the configured 10 s timeout even with the simulated rotor at zero.
        stopped, _ = self.dut.ensure_mode_standby(timeout=25)
        if not stopped:
            raise RuntimeError("Simple limiter run did not return to STANDBY")
        ok, response = self.dc.patch_cfg({
            "throttle": {"rpm_limiter_mode": 1, "pullback_lookahead_ms": 5000}
        })
        if not ok:
            raise RuntimeError("Predictive-limiter config rejected: %r" % (response,))
        code, response = self.dut.start()
        if code != 200:
            raise RuntimeError("Predictive limiter START rejected: HTTP %s %r" %
                               (code, response))
        reached, _ = self.dut.poll_until(
            lambda d: d.get("mode") == "RUNNING", timeout=8)
        if not reached:
            raise RuntimeError("Predictive limiter profile did not reach RUNNING")
        _, data = wait_sample(0.2, lambda d: float(d.get("p1") or 0) < 0.4 and
                              float(d.get("throttle_effective") or 0) > 0.75)
        baseline = float(data.get("throttle_effective") or 0)
        # Prime the controller's sample-to-sample derivative with a distinct,
        # still-safe intermediate reading. A single jump immediately after a
        # runtime config reload can legitimately be the derivative tracker's
        # first sample and therefore has no earlier timestamp to compare.
        self.t.set("OILP", 0.45)
        wait_sample(0.45, lambda d: 0.35 < float(d.get("p1") or 0) < 0.6)
        # Let the filtered derivative return to zero after the preceding
        # simple-mode test's large downward step. The predictive ramp must
        # start from a stable state, not from an arbitrary negative history.
        wait_sample(0.45, lambda d: False, timeout=1.0)
        # This bench channel currently calibrates at about 1.15 bar/V. Keep
        # the final measured pressure below the 1.0 bar simple-mode threshold;
        # any fuel reduction must therefore come from the rate/look-ahead path.
        predicted = baseline
        current_p1 = 0.0
        # Sustain a realistic rising-pressure trend while polling telemetry
        # independently. Serial SET calls and HTTP reads in one loop left a
        # long flat interval after every step, allowing the 10 ms derivative
        # filter to decay before telemetry could observe the intervention.
        def pressure_ramp():
            for step in range(1, 101):
                self.t.set("OILP", 0.45 + step * 0.005)
                time.sleep(0.02)

        ramp_thread = threading.Thread(target=pressure_ramp, daemon=True)
        ramp_thread.start()
        while ramp_thread.is_alive():
            data = self.dut.data()
            predicted = min(predicted, float(data.get("throttle_effective") or 0))
            current_p1 = float(data.get("p1") or 0)
            if predicted < baseline - 0.01:
                break
        ramp_thread.join()
        self.record("predictive limiter acts before present value reaches threshold",
                    current_p1 < 1.0 and baseline > 0.75 and predicted < baseline - 0.01,
                    p1=round(current_p1, 3), baseline=round(baseline, 3),
                    predicted_output=round(predicted, 3))
        self.dut.stop()
        self.dut.ensure_mode_standby()

    def finish(self):
        os.makedirs(RESULT_DIR, exist_ok=True)
        path = os.path.join(RESULT_DIR, "v2_controls_hil_%s.json" % datetime.now().strftime("%Y%m%d_%H%M%S"))
        report = {
            "firmware": self.dut.data().get("fw_version", "unknown"),
            "passed": sum(1 for row in self.rows if row["ok"]),
            "total": len(self.rows), "rows": self.rows,
        }
        with open(path, "w", encoding="utf-8") as output:
            json.dump(report, output, indent=2)
        print("\nResult: %d/%d passed\nReport: %s" %
              (report["passed"], report["total"], path), flush=True)
        expected = 2 if os.environ.get("V2_LIMITER_ONLY") == "1" else 8
        return report["total"] == expected and report["passed"] == report["total"]


def main():
    q = V2ControlsQualification()
    passed = False
    restored = False
    try:
        limiter_only = os.environ.get("V2_LIMITER_ONLY") == "1"
        if not limiter_only:
            q.test_starter_assist()
            q.test_pressure_idle()
        q.test_gradual_limiter_modes()
        passed = q.finish()
    finally:
        try:
            restored = q.r.restore_original()
        finally:
            q.r.close()
    return 0 if passed and restored else 1


if __name__ == "__main__":
    raise SystemExit(main())
