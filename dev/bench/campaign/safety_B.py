import sys, time
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

OILC = round(10.0 / 4095.0, 7)
rig = BenchRig(); dc = rig.dcfg
print("DUT settled:", rig.dut.mode())

# The former standalone EGT-rise trip was removed in v2.0; startup now uses
# an explicit hard EGT limit and EGT flameout uses cooling behavior.
# ── LOW_OIL (needs OilPrime in the startup seq to arm oilMinBar) ──
print("\n-- LOW_OIL --")
print("  seq=OilPrime,TimedDelay:", dc.set_sequence(startup=["OilPrime", "TimedDelay"], startup_delays=[3000, 25000])[0])
print("  arm low_oil:", dc.only_safety("low_oil")[0])
print("  oil_poly linear + min 1.5:", dc.patch_cfg({
    "calibration": {"oil_poly": {"a": 0, "b": 0, "c": OILC, "d": 0, "x_min": 0, "x_max": 4095}},
    "oil": {"startup_min_bar": 1.5}})[0])
rig.baseline(); rig.t.set("OILP", 2.5)     # high oil so OilPrime completes
ok, d = rig.start()
# wait for OilPrime to complete & arm oilMinBar
armed, d = rig.dut.poll_until(lambda x: (x.get("oil_min_bar") or 0) >= 1.0, timeout=8)
print("  oilMinBar armed=%s (oil_min_bar=%s, oil=%s bar, block=%s)"
      % (armed, d.get("oil_min_bar"), d.get("oil"), d.get("current_block")))
neg = rig.stays_active(lambda: rig.t.set("OILP", 0.7), 3)      # ~1.7 bar > 1.5
pos = rig.detect_trip(lambda: rig.t.set("OILP", 0.15), "oil")  # ~0.4 bar < 1.5
rig.rec("LOW_OIL", neg, pos); rig.recover()

# restore minimal startup seq
dc.set_sequence(startup=["OilPumpOn", "TimedDelay", "IgniterOn", "FuelPumpIdle", "TimedDelay", "IgniterOff", "TimedDelay"],
                startup_delays=[0, 15000, 0, 0, 10000, 0, 5000])

rig.summary("Run B (LOW_OIL)")
rig.close()
