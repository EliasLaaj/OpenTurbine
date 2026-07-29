"""Role-reversed physical HIL for digital temperature and torque interfaces.

Classic ESP32 = OpenTurbine DUT, S3 = OTBench 0.9 protocol emulator on COM4.
The existing protected harness links are repurposed temporarily; no rewiring is
required.  This validates actual GPIO transactions, decoding, health/fault
transitions, registry plumbing and calibration.  It does not simulate the
analogue thermocouple junction or load-cell bridge ahead of the converter IC.
"""
from __future__ import annotations

import copy
import json
import os
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "harness"))

from otbench.dut import DUT  # noqa: E402
from otbench.tester import Tester  # noqa: E402
from ten_build_webui_hil import chan_input  # noqa: E402


class ReversedDigitalSensorHil:
    def __init__(self):
        self.dut = DUT()
        self.tester = Tester(os.environ.get("OTBENCH_PORT", "COM4")).open()
        self.firmware = self.dut.data().get("fw_version", "unknown")
        self.tester_version = self.tester.ping()
        self.original_hw = self.dut.hardware()
        self.rows: list[dict] = []
        self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.result_path = os.path.join(
            ROOT, "dev", "bench", "results", f"reversed_digital_sensor_hil_{self.run_id}.json"
        )
        self.backup_path = os.path.join(
            ROOT, "dev", "bench", "results", f"reversed_digital_sensor_backup_{self.run_id}.json"
        )
        os.makedirs(os.path.dirname(self.backup_path), exist_ok=True)
        with open(self.backup_path, "w", encoding="utf-8") as f:
            json.dump(self.original_hw, f, indent=2)

    def record(self, name, ok, **detail):
        row = {"name": name, "ok": bool(ok), "detail": detail}
        self.rows.append(row)
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}", flush=True)

    @staticmethod
    def quiet_profile(hw):
        hw["platform"] = "esp32"
        hw["has_two_shaft"] = False
        hw["has_afterburner"] = False
        for item in hw.get("sensors", {}).values():
            if not isinstance(item, dict):
                continue
            item["enabled"] = False
            for key in ("pin", "clk", "cs", "miso", "mosi", "dt_pin", "clk_pin"):
                if key in item:
                    item[key] = -1
        for item in hw.get("actuators", {}).values():
            if not isinstance(item, dict):
                continue
            item["enabled"] = False
            for key in ("pin", "fuel_pin", "current_pin"):
                if key in item:
                    item[key] = -1
            if "has_current" in item:
                item["has_current"] = False
            if "assist_enabled" in item:
                item["assist_enabled"] = False
        # A physical STOP input is mandatory even in a sensor-only bench
        # profile. GPIO27 is unused by the protected role-reversal harness.
        hw["controls"].update(start_pin=-1, stop_pin=27)
        for row in hw.get("di_channels", []):
            row["pin"] = -1
            row["role"] = "none"
        for key in hw.get("safety", {}):
            hw["safety"][key] = False
        for key in hw.get("controllers", {}):
            hw["controllers"][key] = False
        hw["oil_loops"] = []
        if "i2c" in hw:
            hw["i2c"]["enabled"] = False
        if "spi" in hw:
            hw["spi"]["enabled"] = False
        hw["channel_registry"] = {"version": 1, "inputs": [], "outputs": [], "bindings": []}
        hw["custom_blocks"] = {}
        if "ab_trigger" in hw:
            hw["ab_trigger"].update(source=0, requires_arm=False, arm_pin=-1, switch_pin=-1, input_pin=-1)
        if "ab_flame" in hw:
            hw["ab_flame"].update(enabled=False, pin=-1)
        if "cluster_serial" in hw:
            hw["cluster_serial"].update(enabled=False, tx_pin=-1, rx_pin=-1)
        if "mavlink" in hw:
            hw["mavlink"].update(enabled=False, tx_pin=-1)
        if "buzzer" in hw:
            hw["buzzer"].update(enabled=False, pin=-1)

    def wait_online(self, old_boot=None, timeout=35):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            try:
                data = self.dut.data()
                if old_boot is None or data.get("boot_count") != old_boot:
                    return data
                last = data
            except Exception as exc:
                last = exc
            time.sleep(0.5)
        raise RuntimeError(f"DUT did not return from hardware save: {last}")

    def install_channel(self, channel, legacy=None, spi=None):
        self.dut.ensure_mode_standby()
        hw = copy.deepcopy(self.dut.hardware())
        self.quiet_profile(hw)
        hw["channel_registry"]["inputs"] = [channel]
        if spi is not None:
            hw["spi"].update(spi)
        if legacy:
            hw["sensors"][legacy[0]].update(legacy[1])
        old_boot = self.dut.data().get("boot_count")
        code, response = self.dut._post("/api/hardware", hw)
        if code != 200:
            raise RuntimeError(f"hardware save rejected: HTTP {code} {response}")
        self.wait_online(old_boot)
        saved = self.dut.hardware()["channel_registry"]["inputs"]
        if len(saved) != 1 or saved[0].get("id") != channel["id"]:
            raise RuntimeError(f"channel did not persist: {saved}")

    def registry_value(self, channel_id, timeout=4, expected=None, tolerance=0.1):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            for item in self.dut.data().get("registry_inputs", []):
                if item.get("id") == channel_id:
                    last = item
                    value = item.get("value")
                    if item.get("healthy") and (
                        expected is None or
                        (value is not None and abs(value - expected) <= tolerance)
                    ):
                        return item
            time.sleep(0.12)
        return last or {"id": channel_id, "healthy": False, "value": None}

    def wait_unhealthy(self, channel_id, timeout=3):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            for item in self.dut.data().get("registry_inputs", []):
                if item.get("id") == channel_id:
                    last = item
                    if not item.get("healthy"):
                        return item
            time.sleep(0.12)
        return last or {"id": channel_id, "healthy": True}

    def thermocouple(self, command, interface, expected, tolerance, mosi=-1):
        channel_id = command.lower()
        self.tester.raw(f"EMU {command} {expected}")
        channel = chan_input(
            channel_id, command, "temperature", "tot", 1, -1,
            temp_interface=interface, spi_clk=13, spi_cs=14,
            spi_miso=4, spi_mosi=mosi, tc_type="K",
        )
        # Generic dev-board mode requires the shared bus to be explicitly
        # enabled, exactly as the Hardware UI does before adding an SPI card.
        hw_spi = {"enabled": True, "sck_pin": 13, "miso_pin": 4,
                  "mosi_pin": mosi}
        self.install_channel(channel, ("tot", {
            "enabled": True, "chip": command.lower(), "tc_type": "K",
            "clk": 13, "cs": 14, "miso": 4, "mosi": mosi,
        }), spi=hw_spi)
        sample = self.registry_value(channel_id, timeout=5)
        value = sample.get("value")
        self.record(
            f"{command} decodes temperature",
            sample.get("healthy") is True and value is not None and abs(value - expected) <= tolerance,
            expected=expected, observed=value, healthy=sample.get("healthy"),
        )
        self.tester.raw(f"EMU {command} open")
        fault = self.wait_unhealthy(channel_id, timeout=3)
        self.record(
            f"{command} open-circuit becomes unhealthy",
            fault.get("healthy") is False,
            observed=fault,
        )

    def hx711(self):
        zero = 100000
        scale = 0.01
        counts = 123456
        expected = (counts - zero) * scale
        self.tester.raw(f"EMU HX711 {counts}")
        channel = chan_input(
            "torque_hx711", "Shaft Torque", "torque", "torque", 1, 4,
            torque_interface=1, hx711_clk=13, hx711_scale=scale, hx711_zero=zero,
        )
        self.install_channel(channel, ("torque", {
            "enabled": True, "hx711": True, "pin": 4,
            "dt_pin": 4, "clk_pin": 13, "hx_scale": scale, "hx_zero": zero,
        }))
        sample = self.registry_value("torque_hx711", timeout=4)
        value = sample.get("value")
        self.record(
            "HX711 positive counts and calibration",
            sample.get("healthy") is True and value is not None and abs(value - expected) < 0.1,
            counts=counts, zero=zero, scale=scale, expected=expected, observed=value,
        )

        counts2 = 87654
        expected2 = (counts2 - zero) * scale
        self.tester.raw(f"EMU HX711 {counts2}")
        # The previous reading remains healthy until the HX711 publishes its
        # next conversion. Wait for the requested calibrated value, not merely
        # for any healthy (possibly stale) sample.
        sample2 = self.registry_value(
            "torque_hx711", timeout=3, expected=expected2, tolerance=0.1
        )
        value2 = sample2.get("value")
        self.record(
            "HX711 below-zero signed torque",
            sample2.get("healthy") is True and value2 is not None and abs(value2 - expected2) < 0.1,
            counts=counts2, expected=expected2, observed=value2,
        )

        self.tester.raw("EMU OFF 0")
        fault = self.wait_unhealthy("torque_hx711", timeout=2.5)
        self.record("HX711 missing-data timeout", fault.get("healthy") is False, observed=fault)

    def restore(self):
        try:
            self.tester.raw("EMU OFF 0")
        except Exception:
            pass
        try:
            self.dut.ensure_mode_standby()
            old_boot = self.dut.data().get("boot_count")
            code, response = self.dut._post("/api/hardware", self.original_hw)
            if code == 200:
                self.wait_online(old_boot)
            else:
                print(f"WARNING: classic DUT restore rejected: HTTP {code} {response}")
        except Exception as exc:
            print(f"WARNING: classic DUT restore failed: {exc}")

    def run(self):
        try:
            print(self.tester_version)
            self.dut.ensure_mode_standby()
            if os.environ.get("OTBENCH_HX_ONLY") != "1":
                self.thermocouple("MAX6675", 1, 642.25, 0.3)
                self.thermocouple("MAX31855", 2, 731.75, 0.3)
                self.thermocouple("MAX31856", 3, 815.5, 0.03, mosi=25)
            self.hx711()
        finally:
            self.restore()
            self.tester.close()
            payload = {
                "firmware": self.firmware,
                "dut": "classic ESP32",
                "tester": f"ESP32-S3 {self.tester_version}",
                "results": self.rows,
                "passed": sum(1 for row in self.rows if row["ok"]),
                "total": len(self.rows),
            }
            os.makedirs(os.path.dirname(self.result_path), exist_ok=True)
            with open(self.result_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            print(f"Result: {payload['passed']}/{payload['total']} -> {self.result_path}")
        return all(row["ok"] for row in self.rows)


if __name__ == "__main__":
    raise SystemExit(0 if ReversedDigitalSensorHil().run() else 1)
