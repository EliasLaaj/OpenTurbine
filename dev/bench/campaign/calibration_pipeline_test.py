"""Calibration pipeline validation (the math/config path behind the wizards).

The Calibration page wizards capture points and PATCH calibration config; the bench can't
click the wizard buttons, but it CAN verify the underlying pipeline end-to-end: PATCH a
calibration, drive the physical sensor via the tester, and confirm the DUT's derived
reading responds correctly. Covers oil-pressure cubic cal, flame threshold, and the
fuel-pump-min save path. (NTC/battery/torque cals are pure config math with no wired
sensor on this rig, so they're PATCH-and-readback only.)
"""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

rig = BenchRig(); dut = rig.dut; dc = rig.dcfg; t = rig.t
results = []
def rec(n, ok, d=""): results.append((n, ok)); print("[%s] %-40s %s" % ("PASS" if ok else "FAIL", n, d))
dut.ensure_mode_standby(); dut.ensure_dev_mode(True)

# ── 1. Oil cubic cal: two different linear cals -> reading scales as configured ──
# c = bar-per-raw-count. Drive a fixed tester DAC, read bar under two cals; the ratio
# of readings should match the ratio of the c coefficients.
def set_oil_c(c): return dc.patch_cfg({"calibration": {"oil_poly":
    {"a":0,"b":0,"c":round(c,8),"d":0,"x_min":0,"x_max":4095}}})[0]
t.set("OILP", 2.0); time.sleep(0.6)
set_oil_c(10.0/4095.0); time.sleep(0.4)
raw = dut.data().get("oil_raw") or 0
bar_a = dut.data().get("oil")
set_oil_c(20.0/4095.0); time.sleep(0.4)
bar_b = dut.data().get("oil")
# doubling c should roughly double the derived bar (same raw)
rec("oil cubic cal scales reading with coefficient",
    bar_a and bar_b and abs(bar_b - 2*bar_a) < max(0.3, 0.15*bar_b),
    "raw=%s c1->%.2f bar, 2c->%.2f bar" % (raw, bar_a or 0, bar_b or 0))

# ── 2. Flame threshold: reading crosses the configured threshold ──
print("flame thresh 500:", dc.patch_cfg({"safety": {}, "sensors": {}})[0] if False else
      dc.patch_cfg({"flame": {"threshold": 500}})[0])
t.set("FLAME", 1); time.sleep(0.5)   # tester drives flame ADC high
hi = dut.data().get("flame")
t.set("FLAME", 0); time.sleep(0.5)   # drive low
lo = dut.data().get("flame")
rec("flame sensor tracks threshold (hi=on, lo=off)", (hi is True) and (lo is False),
    "flame hi=%s lo=%s (raw hi->lo)" % (hi, lo))

# ── 3. Fuel-pump-min save path: PATCH persists to cfg + telemetry ──
ok, _ = dc.patch_cfg({"throttle": {"fuel_pump_min_pct": 12}})
saved = dut.config().get("throttle", {}).get("fuel_pump_min_pct")
tel   = dut.data().get("fuel_pump_min_pct")
rec("fuel_pump_min_pct cal saves (cfg+telemetry)",
    abs((saved or 0) - 12) < 0.5 and abs((tel or 0) - 12) < 0.5,
    "cfg=%s telem=%s" % (saved, tel))

# ── 4. Oil zero-reachability: a full-range linear cal never reaches < zero_bar ──
# (documents VALIDATION concern #1 / the new calibration-page warning). At the ADC
# low-end floor the naive cal reads above the 0.1 bar zero threshold.
set_oil_c(10.0/4095.0)
dc.patch_cfg({"oil_advanced": {"zero_bar": 0.1}})
t.set("OILP", 0.0); time.sleep(0.6)
floor_bar = dut.data().get("oil")
rec("naive full-range oil cal can't reach zero_bar (silent OIL_ZERO)",
    floor_bar is not None,  # informational: report the floor
    "oil at DAC floor = %.2f bar vs zero_bar 0.1 (>0.1 => silent)" % (floor_bar or 0))

rig.recover()
dc.patch_cfg({"throttle": {"fuel_pump_min_pct": 10}})
t.set("OILP", 2.5)
npass = sum(1 for _, ok in results if ok)
print("\n=== Calibration pipeline: %d/%d passed ===" % (npass, len(results)))
for n, ok in results:
    if not ok: print("  FAIL:", n)
rig.close()
raise SystemExit(0 if npass == len(results) else 1)
