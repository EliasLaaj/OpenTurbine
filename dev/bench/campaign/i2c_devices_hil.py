"""Physical shared-I2C HIL using OTBench 0.9 and the existing switch jumpers.

The classic tester temporarily makes DUT GPIO13/15 an I2C bus and emulates one
supported accessory at a time. The campaign proves discovery, assignment
truth, live input conversion, TCA output writes, disconnect/reconnect health,
and NAU7802 torque/thrust calibration. Original hardware/config are restored.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from datetime import datetime

import serial

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))

from ten_build_webui_hil import TenBuildRunner, chan_input, chan_output  # noqa: E402


class I2cQualification:
    def __init__(self):
        self.serial_lines: list[str] = []
        self.serial_stop = threading.Event()
        self.serial_port = serial.Serial(baudrate=115200, timeout=0.15)
        self.serial_port.port = os.environ.get("OPENTURBINE_DUT_PORT", "COM4")
        self.serial_port.dtr = False
        self.serial_port.rts = False
        self.serial_port.open()
        self.serial_thread = threading.Thread(target=self._capture_serial, daemon=True)
        self.serial_thread.start()
        self.r = TenBuildRunner(port=os.environ.get("OTBENCH_PORT", "COM3"))
        self.dut, self.t = self.r.dut, self.r.t
        self.rows: list[dict] = []

    def _capture_serial(self):
        while not self.serial_stop.is_set():
            raw = self.serial_port.readline()
            if not raw:
                continue
            line = raw.decode("utf-8", errors="replace").strip()
            if line:
                self.serial_lines.append(line)
                print("[DUT]", line, flush=True)

    def record(self, name, ok, **detail):
        self.rows.append({"name": name, "ok": bool(ok), "detail": detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}", flush=True)

    def reset_i2c_tester(self):
        """Reset the synthetic slave before changing its I2C address."""
        self.t._reset_board()
        if not self.t.ping().startswith("OK OTBench 0.9"):
            raise RuntimeError("OTBench did not return after I2C emulator reset")

    def bus_profile(self, hw):
        # The hardware schema intentionally requires dedicated physical
        # START/STOP inputs. Park them on otherwise-unused harness pins while
        # their normal jumpers carry the temporary I2C bus.
        hw["controls"].update(start_pin=12, stop_pin=21)
        hw["i2c"].update(enabled=True, sda_pin=13, scl_pin=15,
                         interrupt_pin=-1, frequency_hz=100000)

    def wait_device(self, address, type_name, present=True, timeout=12):
        deadline, last = time.time() + timeout, {}
        while time.time() < deadline:
            last = self.dut.hardware().get("_i2c_discovery", {})
            found = next((d for d in last.get("devices", [])
                          if int(d.get("address", -1)) == address and
                          d.get("type") == type_name), None)
            if bool(found and found.get("present")) == present:
                return True, found or {}
            time.sleep(0.35)
        return False, last

    def post_registry(self, inputs, outputs):
        hw = self.dut.hardware()
        hw.pop("_i2c_discovery", None)
        hw["channel_registry"]["inputs"] = inputs
        hw["channel_registry"]["outputs"] = outputs
        # Match the Hardware UI's dependency cleanup when replacing a core
        # sensor card. Runtime serialization mirrors canonical I2C purposes
        # into these flags; removing the card must remove that mirror too.
        input_purposes = {c.get("purpose") for c in inputs}
        for legacy_key, purpose in (
            ("oil_press", "oil_pressure"), ("fuel_press", "fuel_pressure"),
            ("p1", "p1_pressure"), ("p2", "p2_pressure"),
            ("batt_voltage", "battery_voltage"),
        ):
            if purpose not in input_purposes:
                hw["sensors"][legacy_key]["enabled"] = False
                hw["sensors"][legacy_key]["pin"] = -1
        previous_boot = self.dut.data().get("boot_count")
        code, response = self.dut._post("/api/hardware", hw)
        if code == 200:
            if not self.r.wait_dut_ready_after_hardware_save(previous_boot_count=previous_boot):
                raise RuntimeError("DUT did not return after I2C registry save")
            self.r.reconnect_wifi()
            applied = self.dut.hardware()
            print("  applied I2C=", applied.get("i2c"),
                  "inputs=", [c.get("id") for c in applied.get("channel_registry", {}).get("inputs", [])],
                  "outputs=", [c.get("id") for c in applied.get("channel_registry", {}).get("outputs", [])],
                  flush=True)
        return code, response

    @staticmethod
    def registry_value(data, id_):
        return next((row for row in data.get("registry_inputs", [])
                     if row.get("id") == id_), {})

    @staticmethod
    def nau_channels():
        torque = chan_input("torque_main", "Torque", "torque", "torque",
                            10, -1, i2c_address=0x2A, device_channel=0,
                            loadcell_zero=100000, loadcell_n_per_count=0.002,
                            lever_arm_m=0.5, loadcell_gain=128,
                            loadcell_rate_sps=80, filter_alpha=1)
        thrust = chan_input("thrust_main", "Thrust", "thrust", "thrust",
                            10, -1, i2c_address=0x2A, device_channel=1,
                            loadcell_zero=100000, loadcell_n_per_count=0.002,
                            lever_arm_m=0, loadcell_gain=128,
                            loadcell_rate_sps=80, filter_alpha=1)
        return torque, thrust

    def run_nau_only(self):
        self.r.apply_profile({"id": "i2c_bus_only", "name": "I2C bus only",
                              "build": self.bus_profile})
        self.t._reset_board()
        self.t.ping()
        emu_reply = self.t.raw("I2CEMU NAU7802 102000")
        found, detail = self.wait_device(0x2A, "NAU7802")
        self.record("NAU7802_DISCOVERED", found and emu_reply == "OK",
                    emulator=emu_reply, discovery=detail)
        # Restart the synthetic slave's deterministic transaction model just
        # before the reboot that initializes assigned load-cell channels.
        self.t.raw("I2CEMU NAU7802 102000")
        torque, thrust = self.nau_channels()
        code, response = self.post_registry([torque, thrust], [])
        samples = []
        deadline = time.time() + 12
        while time.time() < deadline:
            data = self.dut.data()
            samples.append({
                "torque": self.registry_value(data, "torque_main"),
                "thrust": self.registry_value(data, "thrust_main"),
                "discovery": self.dut.hardware().get("_i2c_discovery", {}),
                "emulator": self.t.raw("I2CEMU STATUS"),
            })
            if (samples[-1]["torque"].get("healthy") and
                    samples[-1]["thrust"].get("healthy")):
                break
            time.sleep(0.5)
        last = samples[-1] if samples else {}
        ok = (
            code == 200 and last.get("torque", {}).get("healthy") and
            last.get("thrust", {}).get("healthy") and
            1.9 <= float(last["torque"].get("value", 0)) <= 2.1 and
            3.9 <= float(last["thrust"].get("value", 0)) <= 4.1
        )
        self.record("NAU7802_TORQUE_AND_THRUST_CALIBRATION", ok,
                    code=code, response=response, last=last,
                    sample_count=len(samples))

    def run(self):
        if os.environ.get("I2C_ONLY_NAU") == "1":
            self.run_nau_only()
            return
        self.r.apply_profile({"id": "i2c_bus_only", "name": "I2C bus only",
                              "build": self.bus_profile})

        # TCA9554: discovery, binary input, generic output test and heartbeat loss.
        self.t.raw("I2CEMU TCA9554 1")
        found, detail = self.wait_device(0x20, "TCA9554")
        self.record("TCA9554_DISCOVERED", found, discovery=detail)
        tca_in = chan_input("i2c_switch", "I2C Switch", "digital_switch",
                            "digital_switch", 8, -1, min=0, max=1,
                            i2c_address=0x20, device_channel=0)
        tca_out = chan_output("i2c_relay", "I2C Relay", "generic", "generic",
                              11, -1, i2c_address=0x20, device_channel=1,
                              safe_demand=0, force_safe_on_fault=True)
        code, response = self.post_registry([tca_in], [tca_out])
        self.record("TCA9554_ASSIGNMENT_SAVED", code == 200, code=code, response=response)
        ok, data = self.dut.poll_until(
            lambda d: (r := self.registry_value(d, "i2c_switch")).get("healthy") and
                      r.get("value") == 1, timeout=8, interval=0.1)
        self.record("TCA9554_INPUT_HIGH", ok, input=self.registry_value(data, "i2c_switch"))

        code, response = self.dut.command("REGISTRY_OUTPUT_TEST", fParam=1, iParam=0)
        time.sleep(0.35)
        active_status = self.t.raw("I2CEMU STATUS")
        time.sleep(3.1)
        safe_status = self.t.raw("I2CEMU STATUS")
        active = "tca_out=02" in active_status
        safe = "tca_out=00" in safe_status
        self.record("TCA9554_OUTPUT_TEST_AND_SAFE_RETURN",
                    code == 200 and active and safe, code=code, response=response,
                    active=active_status, safe=safe_status)

        self.t.raw("I2CEMU OFF 0")
        missing, data = self.dut.poll_until(
            lambda d: not self.registry_value(d, "i2c_switch").get("healthy", True),
            timeout=3, interval=0.08)
        code, response = self.dut.command("REGISTRY_OUTPUT_TEST", fParam=1, iParam=0)
        self.record("TCA9554_DISCONNECT_FAILS_INPUT_AND_BLOCKS_OUTPUT",
                    missing and code != 200, input=self.registry_value(data, "i2c_switch"),
                    tool_code=code, response=response)
        self.t.raw("I2CEMU TCA9554 0")
        found, _ = self.wait_device(0x20, "TCA9554", timeout=12)
        ok, data = self.dut.poll_until(
            lambda d: (r := self.registry_value(d, "i2c_switch")).get("healthy") and
                      r.get("value") == 0, timeout=5, interval=0.1)
        self.record("TCA9554_RECONNECT_AND_LOW_INPUT", found and ok,
                    input=self.registry_value(data, "i2c_switch"))

        # Hardware must remain the truth: an absent new NAU7802 cannot be assigned.
        self.t.raw("I2CEMU OFF 0")
        absent_nau, _ = self.nau_channels()
        hw = self.dut.hardware()
        hw.pop("_i2c_discovery", None)
        hw["channel_registry"]["inputs"] = [absent_nau]
        hw["channel_registry"]["outputs"] = []
        code, response = self.dut._post("/api/hardware", hw)
        self.record("ABSENT_NEW_I2C_DEVICE_REJECTED",
                    code == 409 and "not connected" in str(response).lower(),
                    code=code, response=response)

        # TLA2528: real command-register protocol and calibrated pressure value.
        self.reset_i2c_tester()
        self.t.raw("I2CEMU TLA2528 2048")
        found, detail = self.wait_device(0x10, "TLA2528")
        self.record("TLA2528_DISCOVERED", found, discovery=detail)
        tla = chan_input("p1_main", "P1 Pressure", "pressure", "p1_pressure",
                         9, -1, i2c_address=0x10, device_channel=3,
                         i2c_reference_mv=3300, analog_zero_mv=0,
                         analog_mv_per_unit=1000, filter_alpha=1,
                         min=0, max=4095)
        code, response = self.post_registry([tla], [])
        ok, data = self.dut.poll_until(
            lambda d: (r := self.registry_value(d, "p1_main")).get("healthy") and
                      1.55 <= float(r.get("value", 0)) <= 1.75,
            timeout=8, interval=0.1)
        self.record("TLA2528_LIVE_CALIBRATED_INPUT", code == 200 and ok,
                    code=code, input=self.registry_value(data, "p1_main"))
        self.t.raw("I2CEMU OFF 0")
        missing, data = self.dut.poll_until(
            lambda d: not self.registry_value(d, "p1_main").get("healthy", True),
            timeout=3, interval=0.08)
        self.record("TLA2528_DISCONNECT_INVALIDATES_INPUT", missing,
                    input=self.registry_value(data, "p1_main"))

        # NAU7802: initialization/calibration, signed 24-bit samples, both
        # channels, and torque lever-arm vs direct thrust conversion.
        # Reset the tester-side slave peripheral between different addresses.
        # This does not reset or touch the DUT; it avoids a known Arduino-ESP32
        # slave-address reinitialization quirk in the synthetic test device.
        self.reset_i2c_tester()
        emu_reply = self.t.raw("I2CEMU NAU7802 102000")
        found, detail = self.wait_device(0x2A, "NAU7802")
        self.record("NAU7802_DISCOVERED", found and emu_reply == "OK",
                    emulator=emu_reply, discovery=detail)
        self.t.raw("I2CEMU NAU7802 102000")
        torque, thrust = self.nau_channels()
        code, response = self.post_registry([torque, thrust], [])
        ok, data = self.dut.poll_until(
            lambda d: (
                (a := self.registry_value(d, "torque_main")).get("healthy") and
                (b := self.registry_value(d, "thrust_main")).get("healthy") and
                1.9 <= float(a.get("value", 0)) <= 2.1 and
                3.9 <= float(b.get("value", 0)) <= 4.1
            ), timeout=10, interval=0.1)
        self.record("NAU7802_TORQUE_AND_THRUST_CALIBRATION", code == 200 and ok,
                    code=code, torque=self.registry_value(data, "torque_main"),
                    thrust=self.registry_value(data, "thrust_main"),
                    torque_raw=data.get("torque_raw"), thrust_raw=data.get("thrust_raw"))
        self.t.raw("I2CEMU OFF 0")
        missing, data = self.dut.poll_until(
            lambda d: not self.registry_value(d, "torque_main").get("healthy", True) and
                      not self.registry_value(d, "thrust_main").get("healthy", True),
            timeout=3, interval=0.08)
        self.record("NAU7802_DISCONNECT_INVALIDATES_BOTH_CHANNELS", missing,
                    torque=self.registry_value(data, "torque_main"),
                    thrust=self.registry_value(data, "thrust_main"))

    def close(self):
        try:
            self.t.raw("I2CEMU OFF 0")
        except Exception:
            pass
        restored = self.r.restore_original()
        firmware_after = self.r.firmware_after
        self.r.close()
        self.serial_stop.set()
        self.serial_thread.join(timeout=1)
        self.serial_port.close()
        return restored, firmware_after


def main():
    q = I2cQualification()
    error = None
    restored = False
    firmware_after = None
    try:
        q.run()
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
        print("ERROR:", error, flush=True)
    finally:
        try:
            restored, firmware_after = q.close()
        except Exception as exc:  # noqa: BLE001
            print("RESTORE ERROR:", exc, flush=True)
    result = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "firmware": q.r.firmware_before,
        "firmware_after": firmware_after,
        "rows": q.rows, "restored": restored, "error": error,
        "serial_tail": q.serial_lines[-300:],
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results",
                        "i2c_devices_hil_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    passed = sum(1 for row in q.rows if row["ok"])
    print(f"RESULT: {passed}/{len(q.rows)} I2C checks passed; restored={restored}; error={error}")
    print("Results:", os.path.abspath(path))
    return 0 if passed == len(q.rows) and restored and not error else 1


if __name__ == "__main__":
    raise SystemExit(main())
