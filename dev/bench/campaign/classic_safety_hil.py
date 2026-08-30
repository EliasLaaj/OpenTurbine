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
from copy import deepcopy
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "harness"))

from otbench.dut import DUT
from otbench.dutconfig import DutConfig
from otbench.tester import Tester
from reversed_digital_sensor_hil import ReversedDigitalSensorHil


def hz(rpm):
    return round(rpm / 60.0, 2)


class ClassicSafetyHil:
    def __init__(self):
        self.dut = DUT()
        self.dc = DutConfig(self.dut)
        self.tester = Tester(os.environ.get("OTBENCH_PORT", "COM4")).open()
        self.original_hw = self.dut.hardware()
        self.original_ecu = self.dut._get("/api/ecu_config")
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
        # Keep the Classic POST deliberately compact. Missing optional channel
        # fields use the same firmware defaults as the Hardware UI.
        hw["channel_registry"] = {
            "version": 1,
            "inputs": [
                {"id": "n1_main", "name": "N1 Speed", "role": "speed",
                 "purpose": "n1_speed", "driver": 2, "pin": 4,
                 "pulses_per_unit": 1.0},
            ],
            "outputs": [
                {"id": "main_fuel", "name": "Main Fuel", "role": "fuel",
                 "purpose": "main_fuel", "driver": 6, "pin": 17,
                 "min": 1000, "max": 2000},
                {"id": "fuel_shutoff", "name": "Fuel Shutoff",
                 "role": "fuel_shutoff", "purpose": "fuel_shutoff",
                 "driver": 4, "pin": 22},
                {"id": "igniter", "name": "Igniter", "role": "igniter",
                 "purpose": "igniter", "driver": 4, "pin": 23},
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
        hw["ab_startup_seq"] = []
        hw["ab_startup_delay_ms"] = []
        hw["ab_startup_ignition_target"] = []
        hw["ab_startup_enter_actions"] = []
        hw["ab_startup_exit_actions"] = []
        hw["ab_shutdown_seq"] = []
        hw["ab_shutdown_delay_ms"] = []
        hw["ab_shutdown_ignition_target"] = []
        hw["ab_shutdown_enter_actions"] = []
        hw["ab_shutdown_exit_actions"] = []

    def install(self):
        temporary = deepcopy(self.original_ecu)
        self.profile(temporary["hardware"])
        settings = temporary["settings"]
        settings["engine"].update(rpm_limit=50000, min_rpm=0)
        settings["throttle"].update(
            ramp_up_ms=0, ramp_down_ms=0, fuel_pump_min_pct=30
        )
        settings["safety"]["check_interval_ms"] = 20
        previous_boot = self.dut.data().get("boot_count")
        code, detail = self.dut._post("/api/ecu_config", temporary)
        if code != 200 or not self.dc._wait_reboot(previous_boot):
            raise RuntimeError(f"Classic safety engine file rejected: {detail}")
        saved = self.dut._get("/api/ecu_config")
        if (saved["hardware"]["controls"].get("stop_pin") != 14
                or saved["settings"]["engine"].get("rpm_limit") != 50000
                or not any(c.get("id") == "main_fuel"
                           for c in saved["hardware"]["channel_registry"]["outputs"])):
            raise RuntimeError("Classic safety engine file did not persist exactly")

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
        # Overspeed intentionally latches FAULT. Clear that acknowledged test
        # fault before the independent physical-STOP scenario; otherwise the
        # second START correctly remains blocked and the campaign tests its own
        # sequencing mistake instead of ECU behaviour.
        try:
            self.dut.command("CLEAR_FAULT")
        except Exception:
            pass
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
        previous_boot = self.dut.data().get("boot_count")
        code, detail = self.dut._post("/api/ecu_config", self.original_ecu)
        ok = code == 200 and self.dc._wait_reboot(previous_boot)
        if ok:
            ok = self.dut._get("/api/ecu_config") == self.original_ecu
        if not ok:
            raise RuntimeError(f"complete engine-file restore failed: {detail}")
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
