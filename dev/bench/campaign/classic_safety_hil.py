"""Role-reversed Classic ESP32 fuel-isolation safety qualification.

Classic ESP32 is the OpenTurbine DUT and the S3 runs OTBench on COM4. The
campaign proves that both N1 overspeed and the physical STOP input isolate the
actual main-fuel servo, fuel shutoff, and igniter links.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "harness"))

from otbench.dut import DUT
from otbench.dutconfig import DutConfig
from otbench.tester import Tester
from reversed_digital_sensor_hil import ReversedDigitalSensorHil
from ten_build_webui_hil import chan_input, chan_output


def hz(rpm):
    return round(rpm / 60.0, 2)


class ClassicSafetyHil:
    def __init__(self):
        self.dut = DUT()
        self.dc = DutConfig(self.dut)
        self.tester = Tester(os.environ.get("OTBENCH_PORT", "COM4")).open()
        self.original_hw = self.dut.hardware()
        self.original_cfg = self.dut.config()
        self.rows = []
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.result_path = os.path.join(
            ROOT, "dev", "bench", "results", f"classic_safety_hil_{stamp}.json"
        )

    def record(self, name, ok, **detail):
        self.rows.append({"name": name, "ok": bool(ok), "detail": detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}", flush=True)

    def profile(self, hw):
        ReversedDigitalSensorHil.quiet_profile(hw)
        hw["controls"].update(start_pin=-1, stop_pin=14, stop_active_h=False,
                              stop_pullup=True, stop_pulldown=False)
        hw["sensors"]["n1_rpm"].update(enabled=True, pin=4, ppr=1.0)
        hw["actuators"]["throttle"].update(
            enabled=True, pin=17, type=0, min_us=1000, max_us=2000, inverted=False
        )
        hw["actuators"]["fuel_sol"].update(enabled=True, pin=22, active_h=True)
        hw["actuators"]["igniter"].update(
            enabled=True, pin=23, active_h=True, pwm=False
        )
        for key in hw["safety"]:
            hw["safety"][key] = key == "overspeed"
        hw["channel_registry"] = {
            "version": 1,
            "inputs": [
                chan_input("n1_main", "N1 Speed", "speed", "n1_speed", 2, 4,
                           pulses_per_unit=1.0),
            ],
            "outputs": [
                chan_output("main_fuel", "Main Fuel", "fuel", "main_fuel", 6, 17,
                            min=1000, max=2000),
                chan_output("fuel_shutoff", "Fuel Shutoff", "fuel_shutoff",
                            "fuel_shutoff", 4, 22),
                chan_output("igniter", "Igniter", "igniter", "igniter", 4, 23),
            ],
            "bindings": [
                {"key": "primary_n1", "channel": "n1_main"},
                {"key": "main_fuel_output", "channel": "main_fuel"},
                {"key": "main_fuel_shutoff", "channel": "fuel_shutoff"},
            ],
        }
        hw["startup_seq"] = ["IgniterOn", "FuelOpen", "FuelPumpIdle", "TimedDelay"]
        hw["startup_delay_ms"] = [0, 0, 0, 500]
        hw["startup_ignition_target"] = [0, 0, 0, 0]
        hw["startup_enter_actions"] = [[], [], [], []]
        hw["startup_exit_actions"] = [[], [], [], []]
        hw["shutdown_seq"] = ["ImmediateCut", "FinalStop"]
        hw["shutdown_delay_ms"] = [0, 0]
        hw["shutdown_ignition_target"] = [0, 0]
        hw["shutdown_enter_actions"] = [[], []]
        hw["shutdown_exit_actions"] = [[], []]

    def install(self):
        ok, detail = self.dc.multi(
            self.profile,
            check=lambda hw: (
                hw["controls"].get("stop_pin") == 14
                and hw["safety"].get("overspeed") is True
                and any(c.get("id") == "main_fuel"
                        for c in hw["channel_registry"]["outputs"])
            ),
        )
        if not ok:
            raise RuntimeError(f"Classic safety profile rejected: {detail}")
        ok, detail = self.dc.patch_cfg({
            "engine": {"rpm_limit": 50000, "min_rpm": 0},
            "throttle": {
                "ramp_up_ms": 0, "ramp_down_ms": 0, "fuel_pump_min_pct": 30
            },
            "safety": {"check_interval_ms": 20},
        })
        if not ok:
            raise RuntimeError(f"Classic safety settings rejected: {detail}")

    def start_running(self):
        self.tester.set("STOP", 0)
        self.tester.set("N1", hz(40000))
        time.sleep(1.2)
        self.dut.ensure_mode_standby()
        self.dut.ensure_dev_mode(True)
        code, response = self.dut.start()
        if code != 200:
            raise RuntimeError(f"START rejected: {code} {response}")
        ok, data = self.dut.poll_until(
            lambda d: d.get("mode") == "RUNNING", timeout=8, interval=0.1
        )
        if not ok:
            raise RuntimeError(f"RUNNING not reached: {data}")
        time.sleep(0.5)
        return self.dut.data()

    def physical_state(self):
        return {
            "fuel": self.tester.get("FUEL_SOL"),
            "igniter": self.tester.get("IGNITER"),
            "throttle": self.tester.get("THROTTLE_OUT"),
        }

    @staticmethod
    def active(state):
        return (
            int(state["fuel"].get("level") or 0) == 1
            and int(state["igniter"].get("level") or 0) == 1
            and int(state["throttle"].get("us") or 0) >= 1250
        )

    @staticmethod
    def isolated(state):
        return (
            int(state["fuel"].get("level") or 0) == 0
            and int(state["igniter"].get("level") or 0) == 0
            and int(state["throttle"].get("us") or 0) <= 1050
        )

    def recover(self):
        self.tester.set("STOP", 0)
        self.tester.set("N1", 0)
        self.dut.stop()
        self.dut.ensure_mode_standby(timeout=25)

    def overspeed(self):
        running = self.start_running()
        before = self.physical_state()
        t0 = time.time()
        self.tester.set("N1", hz(60000))
        tripped, data = self.dut.poll_until(
            lambda d: d.get("mode") not in ("STARTUP", "RUNNING"),
            timeout=4, interval=0.05,
        )
        time.sleep(0.2)
        after = self.physical_state()
        detail = str(data.get("fault_description") or data.get("last_event") or "")
        self.record(
            "N1 overspeed isolates fuel",
            self.active(before) and tripped and "over-speed" in detail.lower()
            and self.isolated(after),
            elapsed_s=round(time.time() - t0, 3), event=detail,
            n1_before=running.get("n1"), n1_after=data.get("n1"),
            before=before, after=after,
        )
        self.recover()

    def physical_stop(self):
        running = self.start_running()
        before = self.physical_state()
        t0 = time.time()
        self.tester.set("STOP", 1)
        stopped, data = self.dut.poll_until(
            lambda d: d.get("mode") not in ("STARTUP", "RUNNING"),
            timeout=3, interval=0.05,
        )
        time.sleep(0.2)
        after = self.physical_state()
        self.record(
            "Physical STOP isolates fuel",
            self.active(before) and stopped and self.isolated(after),
            elapsed_s=round(time.time() - t0, 3),
            event=str(data.get("last_event") or data.get("fault_description") or ""),
            n1_before=running.get("n1"), stop_active=data.get("stop_switch_active"),
            before=before, after=after,
        )
        self.recover()

    def restore(self):
        self.recover()
        ok, detail = self.dc.restore(self.original_hw)
        if not ok:
            raise RuntimeError(f"hardware restore failed: {detail}")
        # Restore only fields this campaign changed. Replaying an entire
        # settings snapshot after changing the hardware profile can correctly
        # fail validation when that snapshot contains controller options tied
        # to the temporary profile.
        original = self.original_cfg
        restore_patch = {
            "engine": {
                key: original["engine"][key]
                for key in ("rpm_limit", "min_rpm")
            },
            "throttle": {
                key: original["throttle"][key]
                for key in ("ramp_up_ms", "ramp_down_ms", "fuel_pump_min_pct")
            },
            "safety": {
                "check_interval_ms": original["safety"]["check_interval_ms"]
            },
        }
        ok, detail = self.dc.patch_cfg(restore_patch)
        if not ok:
            raise RuntimeError(f"settings restore failed: {detail}")
        self.dut.ensure_dev_mode(False)
        self.tester.close()

    def run(self):
        try:
            self.install()
            self.overspeed()
            self.physical_stop()
        finally:
            self.restore()
        payload = {
            "firmware": self.dut.data().get("fw_version", "unknown"),
            "target": "esp32dev",
            "tester": "ESP32-S3 OTBench 0.9",
            "passed": sum(row["ok"] for row in self.rows),
            "total": len(self.rows),
            "checks": self.rows,
        }
        with open(self.result_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        print(f"Result: {payload['passed']}/{payload['total']} -> {self.result_path}")
        if payload["total"] != 2 or payload["passed"] != payload["total"]:
            raise SystemExit(1)


if __name__ == "__main__":
    ClassicSafetyHil().run()
