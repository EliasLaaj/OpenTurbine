"""Targeted re-validation of the three safety checks that the batch run flagged.

Each batch failure looked like a *harness* artifact, not a firmware defect:
  OIL_ZERO  - the naive full-range linear oil cal puts the ESP32 ADC low-end floor
              (~raw 84) at ~0.2 bar, which never drops below the 0.1 bar zero
              threshold -> the reading the firmware needs to see is unreachable.
  BATT_LOW  - the verified batt-on-GPIO4 reconfig didn't stick, so batt read 0 V
              and never saw the driven voltage.

This proves the firmware logic by removing each artifact: hold N1 above min-rpm,
use a reachable zero threshold, and verify the batt reconfig before driving it.
"""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

OILC = round(10.0 / 4095.0, 7)   # 10 bar over full ADC range (naive linear cal)
N1_HOLD = hz(45000)

rig = BenchRig(); dc = rig.dcfg; dut = rig.dut; t = rig.t
print("settled:", dut.mode())

# Keep N1 spinning in every baseline so the always-on under-speed protection
# never contaminates a RUNNING-mode negative window.
rig.baseline = lambda: (t.set("N1", N1_HOLD), t.set_tot(120), t.set("OILP", 2.5), t.set("FLAME", 1))

# ── 2. OIL_ZERO with a reachable zero threshold ─────────────────────
print("\n-- OIL_ZERO (reachable threshold) --")
print("  arm oil_zero:", dc.only_safety("oil_zero")[0])
print("  oil cal linear + zero_bar 0.5:", dc.patch_cfg({
    "calibration": {"oil_poly": {"a": 0, "b": 0, "c": OILC, "d": 0, "x_min": 0, "x_max": 4095}},
    "oil_advanced": {"zero_bar": 0.5}})[0])
rig.baseline(); t.set("OILP", 2.5)
rig.start()
dut.poll_until(lambda x: x.get("mode") == "RUNNING", timeout=20)
neg = rig.stays_active(lambda: (t.set("N1", N1_HOLD), t.set("OILP", 1.0)), 3)   # ~2.4 bar > 0.5
t.set("OILP", 0.0); time.sleep(0.6)
print("  oil at DAC floor = %s bar (raw %s)" % (dut.data().get("oil"), dut.data().get("oil_raw")))
pos = rig.detect_trip(lambda: (t.set("N1", N1_HOLD), t.set("OILP", 0.0)), "oil", 6)
rig.rec("OIL_ZERO", neg, pos); rig.recover()
dc.patch_cfg({"oil_advanced": {"zero_bar": 0.1}})

# ── 3. BATT_LOW with a verified reconfig ────────────────────────────
print("\n-- BATT_LOW (verified reconfig) --")
FS = 5.7 * 3.3
def batt_v(volts): return max(0.0, min(3.3, volts / FS * 3.3))
okb, _ = dc.multi(
    lambda hw: (hw["sensors"]["oil_temp"].update(enabled=False),
                hw["sensors"]["throttle_input"].update(enabled=False),
                hw["sensors"]["batt_voltage"].update(enabled=True, pin=4)),
    check=lambda hw: hw["sensors"]["batt_voltage"]["enabled"]
                     and hw["sensors"]["batt_voltage"]["pin"] == 4
                     and not hw["sensors"]["throttle_input"]["enabled"])
print("  reconfig batt on GPIO4 verified:", okb)
if okb:
    print("  arm batt_low:", dc.set_safety(batt_low=True, oil_temp_high=False)[0])
    print("  min 10V:", dc.patch_cfg({"safety": {"batt_volt_min_v": 10.0}})[0])
    rig.baseline = lambda: (t.set("N1", N1_HOLD), t.set("THROTTLE_IN", batt_v(14)), t.set("OILP", 2.5), t.set("FLAME", 1))
    t.set("N1", N1_HOLD); t.set("THROTTLE_IN", batt_v(14)); time.sleep(2)
    rig.start()
    print("  batt reads %s V at 14V drive" % dut.data().get("batt_voltage"))
    neg = rig.stays_active(lambda: (t.set("N1", N1_HOLD), t.set("THROTTLE_IN", batt_v(11))), 4)   # 11 > 10
    pos = rig.detect_trip(lambda: (t.set("N1", N1_HOLD), t.set("THROTTLE_IN", batt_v(7))), "volt")  # 7 < 10
    rig.rec("BATT_LOW", neg, pos); rig.recover()
else:
    print("  SKIP BATT_LOW trip test - could not verify batt sensor on GPIO4")
# restore throttle_input on GPIO4, disable batt
dc.multi(lambda hw: (hw["sensors"]["batt_voltage"].update(enabled=False),
                     hw["sensors"]["throttle_input"].update(enabled=True, pin=4)))

rig.summary("Safety recheck (OIL_ZERO, BATT_LOW)")
rig.close()
