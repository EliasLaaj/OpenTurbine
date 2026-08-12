"""Simulate the optional analog/pulse sensors that aren't physically wired, by remapping
each onto a wired tester channel and driving it:

  ADC sensors (P1, P2, fuel press, torque, battery, oil-temp NTC) -> the THROTTLE_IN DAC pin
      (DUT GPIO4, tester GPIO25 true DAC). Sweep the DAC, verify the raw/scaled reading tracks
      it and the sensor is healthy.
  TIT (thermocouple)  -> the MAX6675 emulator SPI pins (same as TOT); drive set_tot, verify.
  Fuel flow (pulse)   -> the N2 FREQ_OUT pin (DUT GPIO8); drive Hz, verify flow reads.

Proves each optional sensor's read path + health flag work end-to-end. (Limit/safety trips for
battery/TIT/oil-temp/fuel-press are covered by a separate safety pass.)
"""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

rig = BenchRig(); dut = rig.dut; dc = rig.dcfg; t = rig.t
results = []
def rec(n, ok, d=""): results.append((n, ok)); print("[%s] %-34s %s" % ("PASS" if ok else "FAIL", n, d))
dut.ensure_mode_standby(); dut.ensure_dev_mode(True)

ADC_SENSORS = ["p1", "p2", "fuel_press", "torque", "batt_voltage", "oil_temp"]

def clear_pin4(hw):
    # free DUT GPIO4 (throttle input) and make sure no other ADC sensor squats on it
    hw["sensors"]["throttle_input"].update(enabled=False)
    for s in ADC_SENSORS:
        if s in hw["sensors"]:
            hw["sensors"][s].update(enabled=False)
            if "pin" in hw["sensors"][s]:
                hw["sensors"][s]["pin"] = -1

# ── ADC sensors via the THROTTLE_IN DAC (DUT GPIO4) ─────────────────
def test_adc(name, raw_key, healthy_key):
    def mut(hw):
        clear_pin4(hw)
        cfg = {"enabled": True, "pin": 4}
        if name == "oil_temp": cfg["chip"] = "ntc"
        hw["sensors"][name].update(cfg)
    dc.multi(mut, check=lambda hw: hw["sensors"][name]["enabled"] and hw["sensors"][name].get("pin") == 4)
    t.set("THROTTLE_IN", 0.3); time.sleep(0.5); lo = dut.data()
    t.set("THROTTLE_IN", 3.0); time.sleep(0.5); hi = dut.data()
    # oil_temp has no raw field -> use the scaled value; others use the ADC raw
    lo_v = lo.get(raw_key); hi_v = hi.get(raw_key); healthy = hi.get(healthy_key)
    responds = (lo_v is not None and hi_v is not None and abs(hi_v - lo_v) > (100 if "raw" in raw_key else 1.0))
    rec("%s reads + responds + healthy" % name, bool(responds and healthy),
        "%s %s->%s healthy=%s" % (raw_key, lo_v, hi_v, healthy))

test_adc("p1",           "p1_raw",           "p1_healthy")
test_adc("p2",           "p2_raw",           "p2_healthy")
test_adc("fuel_press",   "fuel_press_raw",   "fuel_press_healthy")
test_adc("torque",       "torque_raw",       "torque_healthy")
test_adc("batt_voltage", "batt_voltage_raw", "batt_healthy")
test_adc("oil_temp",     "oil_temp",         "oil_temp_healthy")

# ── TIT thermocouple via the MAX6675 emulator (share TOT's SPI pins) ─
def mut_tit(hw):
    hw["sensors"]["tot"].update(enabled=False)                          # free the SPI bus
    hw["sensors"]["tit"].update(enabled=True, chip="max6675", clk=36, cs=18, miso=37)
dc.multi(mut_tit, check=lambda hw: hw["sensors"]["tit"]["enabled"] and not hw["sensors"]["tot"]["enabled"])
t.set_tot(200); time.sleep(1.5); tit_lo = dut.data().get("tit")
t.set_tot(650); time.sleep(1.5); d = dut.data(); tit_hi = d.get("tit")
rec("TIT thermocouple reads + responds",
    tit_lo is not None and tit_hi is not None and (tit_hi - (tit_lo or 0)) > 200 and d.get("tit_healthy"),
    "tit %s->%s healthy=%s" % (tit_lo, tit_hi, d.get("tit_healthy")))
# restore TOT
dc.multi(lambda hw: (hw["sensors"]["tit"].update(enabled=False),
                     hw["sensors"]["tot"].update(enabled=True, chip="max6675", clk=36, cs=18, miso=37)))

# ── Fuel flow (pulse) via the N2 FREQ_OUT pin (DUT GPIO8) ────────────
def mut_ff(hw):
    hw["sensors"]["n2_rpm"].update(enabled=False)                       # free GPIO8
    hw["sensors"]["fuel_flow"].update(enabled=True, pin=8, type=0, pulses_per_litre=100)
dc.multi(mut_ff, check=lambda hw: hw["sensors"]["fuel_flow"]["enabled"] and hw["sensors"]["fuel_flow"].get("pin") == 8)
t.set("N2", 0); time.sleep(0.6); ff_lo = dut.data().get("fuel_flow")
t.set("N2", 300); time.sleep(0.8); d = dut.data(); ff_hi = d.get("fuel_flow")   # 300 Hz pulses
rec("Fuel flow (pulse) reads + responds",
    ff_hi is not None and (ff_hi or 0) > (ff_lo or 0) + 0.01 and d.get("fuel_flow_healthy"),
    "flow %s->%s healthy=%s" % (ff_lo, ff_hi, d.get("fuel_flow_healthy")))

# ── restore the bench baseline ──────────────────────────────────────
def restore(hw):
    for s in ADC_SENSORS: hw["sensors"][s].update(enabled=False)
    hw["sensors"]["throttle_input"].update(enabled=True, pin=4)
    hw["sensors"]["fuel_flow"].update(enabled=False)
    hw["sensors"]["n2_rpm"].update(enabled=True, pin=8, ppr=1.0)
    hw["sensors"]["tot"].update(enabled=True, chip="max6675", clk=36, cs=18, miso=37)
dc.multi(restore)
t.set("N2", 0)
npass = sum(1 for _, ok in results if ok)
print("\n=== Optional sensors: %d/%d passed ===" % (npass, len(results)))
for n, ok in results:
    if not ok: print("  FAIL:", n)
rig.close()
raise SystemExit(0 if npass == len(results) else 1)
