import sys, time, math
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

def ntc_v(T, rF=10000.0, r0=10000.0, t0=25.0, beta=3950.0):
    r = r0 * math.exp(beta * (1.0/(T+273.15) - 1.0/(t0+273.15)))
    return (4095.0 * r/(rF+r))/4095.0*3.3

rig = BenchRig(); dc = rig.dcfg; dut = rig.dut; t = rig.t
print("settled:", dut.mode())

# ── OIL_TEMP_HIGH: oil_temp NTC on GPIO4 (throttle DAC pin), throttle_input off ──
print("\n-- OIL_TEMP_HIGH (NTC on reused GPIO4) --")
ok1, _ = dc.multi(lambda hw: (hw["sensors"]["throttle_input"].update(enabled=False),
                              hw["sensors"]["oil_temp"].update(enabled=True, chip="ntc", pin=4)),
                  check=lambda hw: hw["sensors"]["oil_temp"]["enabled"] and hw["sensors"]["oil_temp"]["pin"] == 4
                                   and not hw["sensors"]["throttle_input"]["enabled"])
print("  reconfig oil_temp NTC:", ok1)
print("  arm oil_temp_high:", dc.set_safety(oil_temp_high=True, overspeed=False, overtemp=False, low_oil=False,
                                            hot_start=False, oil_zero=False, flameout=False)[0])
print("  limit 90C:", dc.patch_cfg({"safety": {"oil_temp_limit_c": 90}})[0])   # ADC floor caps temp ~106C
t.set("N1", hz(45000)); t.set("THROTTLE_IN", ntc_v(25)); time.sleep(2)   # spinning + ~25C safe
rig.baseline = lambda: (t.set("N1", hz(45000)), t.set("THROTTLE_IN", ntc_v(25)), t.set("OILP", 2.5), t.set("FLAME", 1))
rig.start()
neg = rig.stays_active(lambda: t.set("THROTTLE_IN", ntc_v(70)), 4)     # 70C < 90
pos = rig.detect_trip(lambda: t.set("THROTTLE_IN", 0.0), "oil temp")   # ADC floor ~106C > 90
d = dut.data(); print("  (oil_temp read=%s at floor)" % d.get("oil_temp"))
rig.rec("OIL_TEMP_HIGH", neg, pos); rig.recover()

# ── BATT_LOW: batt_voltage on GPIO4, threshold 10 V (divider 5.7 -> 18.8 V full scale) ──
print("\n-- BATT_LOW (analog on reused GPIO4) --")
FS = 5.7 * 3.3   # ~18.8 V full-scale
def batt_v(volts): return max(0.0, min(3.3, volts / FS * 3.3))   # tester DAC volts for a target battV
ok2, _ = dc.multi(lambda hw: (hw["sensors"]["oil_temp"].update(enabled=False),
                              hw["sensors"]["batt_voltage"].update(enabled=True, pin=4)),
                  check=lambda hw: hw["sensors"]["batt_voltage"]["enabled"] and hw["sensors"]["batt_voltage"]["pin"] == 4)
print("  reconfig batt on GPIO4:", ok2)
print("  arm batt_low:", dc.set_safety(batt_low=True, oil_temp_high=False)[0])
print("  min 10V:", dc.patch_cfg({"safety": {"batt_volt_min_v": 10.0}})[0])
t.set("N1", hz(45000)); t.set("THROTTLE_IN", batt_v(14)); time.sleep(2)   # spinning + 14 V healthy
rig.baseline = lambda: (t.set("N1", hz(45000)), t.set("THROTTLE_IN", batt_v(14)), t.set("OILP", 2.5), t.set("FLAME", 1))
rig.start()
d = dut.data(); print("  batt reads %s V at 14V drive" % d.get("batt_voltage"))
neg = rig.stays_active(lambda: t.set("THROTTLE_IN", batt_v(11)), 4)     # 11 > 10
pos = rig.detect_trip(lambda: t.set("THROTTLE_IN", batt_v(7)), "volt")  # 7 < 10 (and > 0.5 connected)
rig.rec("BATT_LOW", neg, pos); rig.recover()

# restore throttle_input on GPIO4, disable batt
dc.multi(lambda hw: (hw["sensors"]["batt_voltage"].update(enabled=False),
                     hw["sensors"]["throttle_input"].update(enabled=True, pin=4)))
rig.summary("Run D (pin-reuse: oil_temp_high, batt_low)")
rig.close()
raise SystemExit(0 if rig.rows and all(row[1] for row in rig.rows) else 1)
