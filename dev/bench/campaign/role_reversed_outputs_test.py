"""ROLE-REVERSED: OpenTurbine on the classic ESP32 (DUT, WiFi 192.168.4.1); S3 = tester
(OTBench-S3, COM4). Reads the CLASSIC ESP32's actuator outputs while OpenTurbine drives them.

  classic throttle   GPIO17 -> S3 reads THROTTLE_OUT (GPIO40, servo pulse us)
  classic oil_pump   GPIO21 -> S3 reads OILPUMP_OUT  (GPIO11, LEDC duty)
  classic fuel_sol   GPIO22 -> S3 reads FUEL_SOL     (GPIO12, digital level)
  classic igniter    GPIO23 -> S3 reads IGNITER      (GPIO21, digital level)
  classic starter_en GPIO33 -> S3 reads STARTER_EN   (GPIO39, digital level)
"""
import atexit, sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.dut import DUT
from otbench.dutconfig import DutConfig
from otbench.tester import Tester
from ten_build_webui_hil import chan_output
from reversed_digital_sensor_hil import ReversedDigitalSensorHil

dut = DUT(); dc = DutConfig(dut); t = Tester(os.environ.get("OTBENCH_PORT", "COM4")).open()
original_hw = dut.hardware()
restored = False

def restore_original():
    global restored
    if restored:
        return True
    try:
        restored, _detail = dc.restore(original_hw)
    except Exception:
        restored = False
    return restored

atexit.register(restore_original)
results = []
def rec(n, ok, d=""): results.append((n, ok)); print("[%s] %-28s %s" % ("PASS" if ok else "FAIL", n, d))
dut.ensure_mode_standby(); dut.ensure_dev_mode(True)

# ── map the classic OpenTurbine's actuators onto the wired classic GPIOs ──
def setup(hw):
    # Remove unrelated fitted devices/rules and park STOP on an unwired pin so
    # this output-only fixture cannot inherit a conflicting previous profile.
    ReversedDigitalSensorHil.quiet_profile(hw)
    a = hw["actuators"]
    a["throttle"].update(enabled=True, pin=17, type=0, min_us=1000, max_us=2000)  # servo
    a["oil_pump"].update(enabled=True, pin=21, type=0, freq_hz=5000, res_bits=12) # LEDC
    a["fuel_sol"].update(enabled=True, pin=22, active_h=True)
    a["igniter"].update(enabled=True, pin=23, active_h=True)
    a["starter_en"].update(enabled=True, pin=33, active_h=True)
    # The registry is the fitted-hardware authority.  Editing only the legacy
    # mirror makes the ECU correctly remove those devices again on reboot.
    hw["channel_registry"] = {
        "version": 1,
        "inputs": [],
        "outputs": [
            chan_output("main_fuel", "Main Fuel Pump", "fuel", "main_fuel", 6, 17,
                        min=1000, max=2000),
            chan_output("oil_pump_main", "Oil Pump", "oil_pump", "oil_pump", 5, 21,
                        pwm_freq_hz=5000, pwm_res_bits=12),
            chan_output("fuel_shutoff", "Main Fuel Shutoff", "fuel_shutoff", "fuel_shutoff", 4, 22),
            chan_output("igniter", "Igniter", "igniter", "igniter", 4, 23),
            chan_output("starter_enable", "Starter Enable", "starter_en", "starter_enable", 4, 33),
        ],
        "bindings": [
            {"key": "main_fuel_output", "channel": "main_fuel"},
            {"key": "main_fuel_shutoff", "channel": "fuel_shutoff"},
        ],
    }
ok, profile_detail = dc.multi(setup, check=lambda hw: hw["actuators"]["throttle"].get("enabled") is True
              and hw["actuators"]["throttle"].get("pin") == 17
              and hw["actuators"]["fuel_sol"].get("enabled") is True
              and hw["actuators"]["fuel_sol"].get("pin") == 22
              and hw["actuators"]["igniter"].get("enabled") is True
              and hw["actuators"]["igniter"].get("pin") == 23)
print("classic actuators mapped to wired GPIOs:", ok)
if not ok:
    raise RuntimeError("classic output fixture profile did not persist: %r" % (profile_detail,))
if not dut.ensure_dev_mode(True):
    raise RuntimeError("Developer Mode did not enable after output-profile reboot")

def watch(sig, kind, secs=2.5):
    peak = 0; active = False; end = time.time() + secs
    while time.time() < end:
        f = t.get(sig)
        if kind == "level" and f.get("level") == 1: active = True
        elif kind == "duty": peak = max(peak, f.get("duty", 0) or 0); active = active or peak > 0.05
        elif kind == "us":   peak = max(peak, f.get("us", 0) or 0);   active = active or peak > 800
        time.sleep(0.1)
    return active, peak

# THROTTLE servo — drive to 50% in STANDBY, read the pulse on the S3
dut.command("SET_THROTTLE_PCT", iParam=50)
a, p = watch("THROTTLE_OUT", "us"); rec("classic THROTTLE servo output", a, "us=%d (~1500 @50%%)" % p)
dut.command("SET_THROTTLE_PCT", iParam=0)

# OIL PUMP LEDC — drive to 100% in STANDBY, read duty
dut.command("SET_OIL_PCT", iParam=100)
a, p = watch("OILPUMP_OUT", "duty"); rec("classic OIL PUMP LEDC output", a, "duty=%.2f" % p)
dut.command("SET_OIL_PCT", iParam=0)

# Digital relays — Tools self-tests pulse each
dut.command("FUEL_SOL_TEST");   a, _ = watch("FUEL_SOL",   "level"); rec("classic FUEL SOLENOID output", a)
dut.command("IGN_TEST");        a, _ = watch("IGNITER",    "level"); rec("classic IGNITER output",       a)
dut.command("STARTER_EN_TEST"); a, _ = watch("STARTER_EN", "level"); rec("classic STARTER-EN output",    a)

npass = sum(1 for _, ok in results if ok)
print("\n=== Classic ESP32 outputs (role-reversed, S3=tester): %d/%d passed ===" % (npass, len(results)))
for n, ok in results:
    if not ok: print("  FAIL:", n)
restored = restore_original()
t.close()
raise SystemExit(0 if restored and npass == len(results) else 1)
