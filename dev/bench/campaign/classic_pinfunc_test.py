"""CLASSIC ESP32 pin-function sign-off (role-reversed: OpenTurbine on classic = DUT,
S3 = tester on COM4). Validates every pin FUNCTION the current wiring can reach.

Uses four focused configs (one hardware POST each). A single all-in-one config is rejected
("Invalid hardware section JSON") because the controls/start-stop-pin section must be set
coherently, which is a config-structure quirk, not a pin-function limitation:

  1. outputs : oil_pump LEDC (GPIO21), fuel_sol/igniter/starter_en (GPIO22/23/33)
  2. servo   : throttle servo (GPIO21) -> S3 reads the pulse width on OILPUMP_OUT
  3. inputs  : n1_rpm (GPIO4 freq), p1 (GPIO32 ADC1), DI channel (GPIO27 digital)
  4. v2 start: pulsed starter on GPIO17 with physical N1 threshold/STOP checks

Not reachable with this wiring (documented, NOT firmware bugs): thermocouple SPI (classic
input-only pins 34/35 can't be an SPI master on the TOT jumpers) and a full analog *sweep*
(the S3 tester has no DAC, so ADC is proven at range extremes only).
"""
import atexit, datetime, json, sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from otbench.dut import DUT
from otbench.dutconfig import DutConfig
from otbench.tester import Tester
from reversed_digital_sensor_hil import ReversedDigitalSensorHil
from ten_build_webui_hil import chan_input, chan_output

dut = DUT(); dc = DutConfig(dut); t = Tester(os.environ.get("OTBENCH_PORT", "COM4")).open()
original_hw = dut.hardware()
cleaned = False
restore_verified = False
results = []
def rec(n, ok, d=""):
    results.append({"name": n, "passed": bool(ok), "detail": d})
    print("[%s] %-32s %s" % ("PASS" if ok else "FAIL", n, d))

def cleanup():
    global cleaned, restore_verified
    if cleaned: return restore_verified
    cleaned = True
    try:
        for command in ("SET_OIL_PCT", "SET_THROTTLE_PCT"):
            try:
                dut.command(command, iParam=0)
            except Exception:
                pass
        standby = False
        for _ in range(4):
            try:
                standby = dut.ensure_mode_standby()
                if standby:
                    break
            except Exception as exc:
                print("[RESTORE] standby verification retry:", exc)
            time.sleep(1.0)
        if not standby:
            print("[RESTORE] DUT did not reach verified STANDBY")
            return False
        ok, detail = dc.restore(original_hw)
        restore_verified = bool(ok)
        print("[RESTORE] hardware profile:", "OK" if ok else detail)
        try:
            dut.ensure_dev_mode(False)
        except Exception:
            pass
        return restore_verified
    finally:
        t.close()

atexit.register(cleanup)
dut.ensure_mode_standby()

def apply_profile(mutate, check):
    def profile(hw):
        ReversedDigitalSensorHil.quiet_profile(hw)
        mutate(hw)
    ok, detail = dc.multi(profile, check=check)
    if not ok:
        raise RuntimeError("Classic test hardware profile did not persist: %r" % (detail,))
    if not dut.ensure_dev_mode(True):
        raise RuntimeError("Developer Mode did not enable after hardware reboot")

def watch(sig, kind, secs=2.5):
    peak = 0; act = False; end = time.time() + secs
    while time.time() < end:
        f = t.get(sig)
        if kind == "level" and f.get("level") == 1: act = True
        elif kind == "duty": peak = max(peak, f.get("duty", 0) or 0); act = act or peak > 0.05
        elif kind == "us":   peak = max(peak, f.get("us", 0) or 0);   act = act or peak > 800
        time.sleep(0.1)
    return act, peak

# 1. OUTPUTS: LEDC PWM + digital relays
def cfg_out(hw):
    hw["actuators"]["oil_pump"].update(enabled=True, pin=21)                  # LEDC -> S3 GPIO11
    hw["actuators"]["fuel_sol"].update(enabled=True, pin=22, active_h=True)
    hw["actuators"]["igniter"].update(enabled=True, pin=23, active_h=True)
    hw["actuators"]["starter_en"].update(enabled=True, pin=33, active_h=True)
    hw["channel_registry"]["outputs"] = [
        chan_output("oil_pump_main", "Oil Pump", "oil_pump", "oil_pump", 5, 21,
                    pwm_freq_hz=5000, pwm_res_bits=12),
        chan_output("fuel_shutoff", "Fuel Shutoff", "fuel_shutoff", "fuel_shutoff", 4, 22),
        chan_output("igniter", "Igniter", "igniter", "igniter", 4, 23),
        chan_output("starter_enable", "Starter Enable", "starter_en", "starter_enable", 4, 33),
    ]
apply_profile(cfg_out, check=lambda hw: (
    hw["actuators"]["oil_pump"].get("pin") == 21 and
    hw["actuators"]["fuel_sol"].get("enabled") is True and
    hw["actuators"]["starter_en"].get("enabled") is True))
dut.command("SET_OIL_PCT", iParam=100); a, p = watch("OILPUMP_OUT", "duty"); rec("LEDC PWM output (oil_pump)", a, "duty=%.2f" % p); dut.command("SET_OIL_PCT", iParam=0)
dut.command("FUEL_SOL_TEST");   a, _ = watch("FUEL_SOL",   "level", 1.1); rec("digital output (fuel_sol)",   a); time.sleep(0.3)
dut.command("IGN_TEST");        a, _ = watch("IGNITER",    "level", 2.1); rec("digital output (igniter)",    a); time.sleep(0.3)
dut.command("STARTER_EN_TEST"); a, _ = watch("STARTER_EN", "level", 1.1); rec("digital output (starter_en)", a); time.sleep(0.3)

# 2. SERVO output
def cfg_servo(hw):
    hw["actuators"]["throttle"].update(enabled=True, pin=17, type=0, min_us=1000, max_us=2000)
    hw["channel_registry"]["outputs"] = [
        chan_output("main_fuel", "Main Fuel", "fuel", "main_fuel", 6, 17,
                    min=1000, max=2000),
    ]
    hw["channel_registry"]["bindings"] = [
        {"key": "main_fuel_output", "channel": "main_fuel"},
    ]
apply_profile(cfg_servo, check=lambda hw: hw["actuators"]["throttle"].get("pin") == 17)
dut.command("SET_THROTTLE_PCT", iParam=60); a, p = watch("THROTTLE_OUT", "us"); rec("SERVO output (LEDC servo)", a and 1500 <= p <= 1700, "pulse=%dus @60%%" % p); dut.command("SET_THROTTLE_PCT", iParam=0)

# 3. INPUTS: frequency + ADC + digital
def cfg_in(hw):
    # GPIO27 is the protected FLAME/DI jumper in this profile, so move the
    # mandatory sensor-only STOP backstop to otherwise-unused GPIO26.
    hw["controls"].update(start_pin=-1, stop_pin=26)
    hw["sensors"]["n1_rpm"].update(enabled=True, pin=4, ppr=1.0)              # freq  <- S3 GPIO14
    hw["sensors"]["p1"].update(enabled=True, pin=32)                          # ADC1  <- S3 GPIO5
    hw["di_channels"][0].update(pin=27, active_h=True, role="none", label="DI", active_modes=0x1F)  # digital <- S3 GPIO2
    hw["channel_registry"]["inputs"] = [
        chan_input("n1_main", "N1 Speed", "speed", "n1_speed", 2, 4,
                   pulses_per_unit=1.0),
        chan_input("p1_main", "P1 Pressure", "pressure", "p1_pressure", 1, 32),
    ]
    hw["channel_registry"]["bindings"] = [
        {"key": "primary_n1", "channel": "n1_main"},
    ]
apply_profile(cfg_in, check=lambda hw: (
    any(c.get("id") == "n1_main" for c in hw["channel_registry"]["inputs"]) and
    hw["di_channels"][0]["pin"] == 27))
t.set("N1", round(45000/60.0, 1)); time.sleep(1.5); n1 = dut.data().get("n1"); t.set("N1", 0)
rec("FREQ input (N1 RPM / PCNT)", abs((n1 or 0) - 45000) < 3000, "drive 45000 -> %s" % n1)
t.set("IDLE_IN", "HIGH"); time.sleep(0.7); hi = dut.data().get("p1")
t.set("IDLE_IN", "LOW");  time.sleep(0.7); lo = dut.data().get("p1")
# Registry-native pressure cards publish calibrated engineering units through
# `p1`/registry_inputs. `p1_raw` belongs only to the legacy AnalogSensor object.
rec("ADC input (GPIO32 range)", (hi or 0) - (lo or 0) > 2.0, "high=%sbar low=%sbar" % (hi, lo))
t.set("FLAME", 1); time.sleep(0.4); don = (dut.data().get("di_channels") or [{}])[0].get("state")
t.set("FLAME", 0); time.sleep(0.4); doff = (dut.data().get("di_channels") or [{}])[0].get("state")
rec("DIGITAL input (DI channel)", don is True and doff is False, "on=%s off=%s" % (don, doff))

# 4. V2 PULSED STARTER: actual StarterSpin output and STOP cut
def cfg_v2_starter(hw):
    hw["controls"].update(start_pin=-1, stop_pin=26)
    hw["sensors"]["n1_rpm"].update(enabled=True, pin=4, ppr=1.0)
    hw["actuators"]["starter"].update(enabled=True, pin=17, type=0, min_us=1000, max_us=2000)
    hw["channel_registry"] = {
        "version": 1,
        "inputs": [chan_input("n1_main", "N1 Speed", "speed", "n1_speed", 2, 4,
                              pulses_per_unit=1.0)],
        "outputs": [chan_output("starter", "Starter", "starter", "starter", 6, 17,
                                min=1000, max=2000)],
        "bindings": [
            {"key": "primary_n1", "channel": "n1_main"},
            {"key": "main_starter", "channel": "starter"},
        ],
    }
    hw["startup_seq"] = ["StarterSpin", "TimedDelay"]
    hw["startup_delay_ms"] = [0, 1000]
    hw["startup_ignition_target"] = [0, 0]
    hw["startup_enter_actions"] = [[], []]
    hw["startup_exit_actions"] = [[], []]
apply_profile(cfg_v2_starter, check=lambda hw: (
    hw["actuators"]["starter"].get("pin") == 17 and
    hw["sensors"]["n1_rpm"].get("pin") == 4))
ok, detail = dc.patch_cfg({
    "sequence": {"startup": {"pre_ign_rpm": 3000, "starter_demand": 60,
                                "starter_timeout_ms": 6000}},
    "starter_control": {"pulsed_assist_enabled": True, "pulsed_assist_pwm_pct": 20,
                         "pulsed_assist_until_rpm": 1000, "pulsed_assist_on_ms": 500,
                         "pulsed_assist_off_ms": 250, "startup_ramp_pct_per_s": 1000},
})
if not ok:
    raise RuntimeError("Classic v2 starter config rejected: %r" % (detail,))

dut.command("PULSED_STARTER_ASSIST_TEST")
a, p = watch("THROTTLE_OUT", "us", 0.8)
time.sleep(0.8)
safe_us = t.get("THROTTLE_OUT").get("us", 0) or 0
rec("v2 assist Tools pulse auto-stops", a and p >= 1150 and safe_us <= 1050,
    "peak=%dus final=%dus" % (p, safe_us))

t.set("N1", round(300/60.0, 1)); time.sleep(1.0)
code, response = dut.start()
samples = []
end = time.time() + 1.8
while code == 200 and time.time() < end:
    t.set("N1", round(300/60.0, 1))
    samples.append(t.get("THROTTLE_OUT").get("us", 0) or 0)
    time.sleep(0.05)
states = [1 if value >= 1150 else 0 for value in samples if value > 0]
transitions = sum(a != b for a, b in zip(states, states[1:]))
rec("v2 StarterSpin repeats pulses", code == 200 and 1 in states and 0 in states and transitions >= 2,
    "HTTP=%s transitions=%d" % (code, transitions))
dut.stop(); time.sleep(0.5)
stopped_us = t.get("THROTTLE_OUT").get("us", 0) or 0
rec("v2 StarterSpin STOP cut", stopped_us <= 1050 and not dut.data().get("starter_enabled"),
    "pulse=%dus mode=%s" % (stopped_us, dut.data().get("mode")))
t.set("N1", 0)

npass = sum(1 for result in results if result["passed"])
print("\n=== Classic ESP32 pin functions: %d/%d passed ===" % (npass, len(results)))
for result in results:
    if not result["passed"]:
        print("  FAIL:", result["name"])
cleanup_ok = cleanup()

timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
result_path = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "results",
    "classic_pinfunc_hil_%s.json" % timestamp))
with open(result_path, "w", encoding="utf-8") as result_file:
    json.dump({
        "campaign": "classic_pinfunc_hil",
        "dut": "ESP32 Classic",
        "tester": "ESP32-S3 OTBench 0.9",
        "passed": npass,
        "total": len(results),
        "restored": cleanup_ok,
        "results": results,
    }, result_file, indent=2)
    result_file.write("\n")
print("Result: %d/%d -> %s" % (npass, len(results), result_path))
if npass != len(results) or not cleanup_ok:
    raise SystemExit(1)
