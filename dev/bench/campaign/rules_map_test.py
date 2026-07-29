"""Physical ADC-to-starter rule-map qualification."""
import os
import serial
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig

rig = BenchRig(port=os.environ.get("OTBENCH_PORT", "COM3"))
dut, dc, tester = rig.dut, rig.dcfg, rig.t
original_hw = dut.hardware()
original_cfg = dut.config()
rows = []


def record(name, ok, detail=""):
    rows.append((name, bool(ok), detail))
    print("[%s] %-48s %s" % ("PASS" if ok else "FAIL", name, detail), flush=True)


def configure_map_hardware(input_enabled=True):
    def mutate(hw):
        hw["sensors"]["throttle_input"].update(enabled=input_enabled, pin=4, rc_pwm=False)
        hw["actuators"]["throttle"].update(enabled=False, pin=-1)
        hw["actuators"]["starter"].update(
            enabled=True, pin=40, type=0, min_us=1000, max_us=2000,
            inverted=False, active_h=True)
        hw["actuators"]["starter_en"].update(enabled=False, pin=-1)
        hw["controllers"].update(dynamic_idle=False, governor=False)
        reg = hw.setdefault("channel_registry", {"version": 1, "inputs": [], "outputs": [], "bindings": []})
        reg["inputs"] = [c for c in reg.get("inputs", []) if c.get("purpose") != "throttle"]
        reg["outputs"] = [c for c in reg.get("outputs", []) if c.get("purpose") not in ("main_fuel", "starter", "starter_enable")]
        if input_enabled:
            reg["inputs"].append({
                "id": "operator_throttle", "name": "Throttle Input", "role": "operator", "purpose": "throttle",
                "driver": 1, "pin": 4, "min": 0, "max": 4095, "pulses_per_unit": 1,
                "analog_zero_mv": 0, "analog_mv_per_unit": 1000, "analog_divider": 1,
                "temp_interface": 0, "spi_clk": -1, "spi_cs": -1, "spi_miso": -1, "spi_mosi": -1,
                "tc_type": "K", "invert": False, "active_high": True, "pullup": False, "pulldown": False,
            })
        reg["outputs"].append({
            "id": "starter", "name": "Starter", "role": "starter", "purpose": "starter",
            "driver": 6, "pin": 40, "min": 1000, "max": 2000, "safe_demand": 0,
            "min_run_demand": 0, "invert": False, "active_high": True, "has_current": False,
            "current_pin": -1, "current_mv_a": 100, "current_zero_v": 1.65, "current_max_a": 0,
        })
    return dc.multi(
        mutate,
        check=lambda hw: hw["actuators"]["starter"]["enabled"]
        and hw["actuators"]["starter"]["pin"] == 40
        and bool(hw["sensors"]["throttle_input"]["enabled"]) == input_enabled,
    )[0]


def set_map(mode_mask):
    rule = {
        "enabled": True, "kind": 1, "source": "operator_throttle", "target": "starter", "op": 0,
        "threshold": 0.5, "on_value": 1.0,
        "off_value": 0.0, "hysteresis": 0.0,
        "input_min": 0.0, "input_max": 1.0,
        "output_min": 0.0, "output_max": 1.0,
        "mode_mask": mode_mask, "name": "Starter potentiometer map",
    }
    code, _ = dut.patch("/api/config", {"rules": [rule]})
    if code != 200:
        return False
    saved = dut.config().get("rules", [])
    return len(saved) == 1 and saved[0].get("source") == "operator_throttle" \
        and saved[0].get("target") == "starter" and saved[0].get("mode_mask") == mode_mask


def sample(volts, settle=0.8):
    tester.set("THROTTLE_IN", volts)
    time.sleep(settle)
    return dut.data(), tester.get("THROTTLE_OUT")


def usb_reset_and_wait():
    before = dut.data().get("boot_count")
    port = serial.Serial("COM4", 115200, timeout=0.1)
    port.dtr = False
    port.rts = True
    time.sleep(0.15)
    port.rts = False
    port.close()
    deadline = time.time() + 90
    while time.time() < deadline:
        try:
            dut._reconnect_wifi()
            data = dut.data()
            if before is None or data.get("boot_count") != before:
                time.sleep(1.0)
                return True, data
        except Exception:
            pass
        time.sleep(1.0)
    return False, {}


try:
    tester.reset()
    dut.ensure_mode_standby()
    record("map hardware configuration saved", configure_map_hardware(True))
    dut.ensure_mode_standby()

    tester.set("THROTTLE_IN", 0.0)
    time.sleep(1.0)
    floor_raw = int(dut.data().get("throttle_input_raw") or 0)
    cfg = dut.config()
    ceiling_raw = int(cfg.get("calibration", {}).get("throttle_max_raw") or 3900)
    calibrated_floor = min(floor_raw + 25, ceiling_raw - 100)
    floor_saved, floor_resp = dc.patch_cfg({
        "calibration": {"throttle_min_raw": calibrated_floor}
    })
    record(
        "potentiometer minimum calibrated",
        floor_saved,
        "raw=%d saved=%d response=%r" % (floor_raw, calibrated_floor, floor_resp),
    )
    record("all-state starter map saved", set_map(15))

    tester.set("THROTTLE_IN", 0.0)
    time.sleep(1.0)
    rebooted, data_after_reboot = usb_reset_and_wait()
    if rebooted:
        # The first HTTP frame after Wi-Fi returns can precede the first fresh
        # post-boot ADC/rules tick. Require the persisted map to settle at the
        # already-driven safe minimum instead of comparing that stale frame to
        # a newer physical pulse sample.
        _, data_after_reboot = dut.poll_until(
            lambda d: float(d.get("starter_demand") or 0) <= 0.03,
            timeout=3, interval=0.05,
        )
    saved_after_reboot = dut.config().get("rules", []) if rebooted else []
    pwm_after_reboot = tester.get("THROTTLE_OUT") if rebooted else {}
    record(
        "map persists through reboot at safe minimum",
        rebooted
        and len(saved_after_reboot) == 1
        and saved_after_reboot[0].get("source") == "operator_throttle"
        and saved_after_reboot[0].get("target") == "starter"
        and float(data_after_reboot.get("starter_demand") or 0) <= 0.03
        and abs(int(pwm_after_reboot.get("us") or 0) - 1000) <= 80,
        "reboot=%s rules=%d demand=%s pulse=%s" %
        (rebooted, len(saved_after_reboot),
         data_after_reboot.get("starter_demand"), pwm_after_reboot.get("us")),
    )

    points = [
        ("minimum", 0.0, 0.0, 1000, 80),
        ("midpoint", 1.65, 0.5, 1500, 110),
        ("maximum", 3.3, 1.0, 2000, 110),
    ]
    for label, volts, expected, expected_us, tolerance_us in points:
        data, pwm = sample(volts)
        demand = float(data.get("starter_demand") or 0)
        pulse = int(pwm.get("us") or 0)
        record(
            "all-state map %s" % label,
            abs(demand - expected) <= 0.08 and abs(pulse - expected_us) <= tolerance_us,
            "input=%.3f demand=%.3f pulse=%dus" %
            (float(data.get("throttle_input_norm") or 0), demand, pulse),
        )

    record("RUNNING-only map saved", set_map(4))
    data, pwm = sample(3.3)
    record(
        "outside selected state returns starter off",
        data.get("mode") == "STANDBY"
        and float(data.get("starter_demand") or 0) < 0.01
        and not bool(data.get("starter_enabled"))
        and abs(int(pwm.get("us") or 0) - 1000) <= 80,
        "mode=%s demand=%s enabled=%s pulse=%s" %
        (data.get("mode"), data.get("starter_demand"), data.get("starter_enabled"), pwm.get("us")),
    )

    record("restore all-state map before integrity test", set_map(15))
    sample(0.0)
    orphan_rejected = not configure_map_hardware(False)
    record("hardware save rejects orphaned rule source", orphan_rejected)
    dut.ensure_mode_standby()
    data, pwm = dut.data(), tester.get("THROTTLE_OUT")
    record(
        "rejected orphan retains valid map at minimum",
        float(data.get("starter_demand") or 0) <= 0.03
        and abs(int(pwm.get("us") or 0) - 1000) <= 80,
        "demand=%s enabled=%s pulse=%s" %
        (data.get("starter_demand"), data.get("starter_enabled"), pwm.get("us")),
    )
finally:
    tester.set("THROTTLE_IN", 0.0)
    dut.ensure_mode_standby()
    rules_code, rules_resp = dut.patch("/api/config", {"rules": []})
    time.sleep(0.5)
    # Config omits optional empty arrays from its compact response; omission is
    # the persisted zero-rule representation, not a failed clear.
    rules_cleared = rules_code == 200 and dut.config().get("rules", []) == []
    hardware_restored, hardware_resp = dc.restore(original_hw)
    config_restored, config_resp = dc.patch_cfg(original_cfg)
    record(
        "original hardware and settings restored",
        rules_cleared and hardware_restored and config_restored,
        "rules=%s %r hardware=%s %r config=%s %r" %
        (rules_cleared, rules_resp, hardware_restored, hardware_resp,
         config_restored, config_resp),
    )
    rig.close()

passed = sum(1 for _, ok, _ in rows if ok)
print("\n=== ADC-to-starter mapping: %d/%d passed ===" % (passed, len(rows)))
for name, ok, detail in rows:
    if not ok:
        print("  FAIL %s: %s" % (name, detail))
raise SystemExit(0 if passed == len(rows) else 1)
