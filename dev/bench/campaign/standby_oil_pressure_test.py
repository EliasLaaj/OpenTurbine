"""Standby-oil SET-PRESSURE mode (new feature).

Standby oil feed protects windmilling bearings in STANDBY. Historically it ran the
pump at a fixed % (standby_oil.feed_pct). New: standby_oil.feed_bar > 0 (with an oil
sensor + the oil control loop enabled) regulates the pump to hold that PRESSURE via the
tuned oil loop, floored at feed_pct. Default feed_bar=0 keeps the old fixed-% behaviour.

Runs in STANDBY (no engine start). The oil loop SKIPS in bench mode, so this uses a real
(non-bench) config. On the bench oil pressure is fixed by the tester DAC (doesn't respond
to pump duty), so we assert the loop's SIGN response: pressure below target -> duty winds
up toward 100; pressure above target -> duty winds down to the feed_pct floor. Then a
fixed-% check (feed_bar=0) confirms duty == feed_pct regardless of pressure.
"""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

OILC = round(10.0 / 4095.0, 7)
rig = BenchRig(); dut = rig.dut; dc = rig.dcfg; t = rig.t
results = []
def rec(n, ok, d=""): results.append((n, ok)); print("[%s] %-44s %s" % ("PASS" if ok else "FAIL", n, d))
dut.ensure_mode_standby()

print("enable oil_loop:", dc.set_controllers(oil_loop=True)[0])
print("cfg (oil cal linear, minPct 18):", dc.patch_cfg({
    "calibration": {"oil_poly": {"a":0,"b":0,"c":OILC,"d":0,"x_min":0,"x_max":4095}},
    "oil": {"min_pct": 18, "use_throttle_map": False, "adjust_scale": 1.8},
    "standby_oil": {"source": 0, "rpm_limit": 1000, "feed_pct": 20, "feed_bar": 3.0}})[0])

# real (non-bench) so the oil loop actually runs; dev mode for live cfg
dut.ensure_dev_mode(True)
if dut.data().get("bench_mode"): dut.command("TOGGLE_BENCH_MODE"); time.sleep(0.4)
print("bench_mode:", dut.data().get("bench_mode"), "(must be False)")
print("feed_bar telemetry:", dut.data().get("standby_oil_feed_bar"))

def hold(volts, secs=5.0, label=""):
    end = time.time() + secs
    while time.time() < end:
        t.set("N1", hz(45000)); t.set("OILP", volts)   # N1 >> rpm_limit -> windmilling
        time.sleep(0.2)
    d = dut.data()
    print("  [%s] OILP=%.2f -> oil=%.2f bar (target 3.0) feed_active=%s oil_pct=%s" %
          (label, volts, d.get("oil"), d.get("standby_oil_feed_active"), d.get("oil_pct")))
    return d

# ── pressure mode: windmilling in STANDBY, regulate to 3.0 bar ──────
d_lo = hold(1.0, 6.0, "oil low (~2.4 bar < 3.0)")   # below target -> wind up
rec("standby feed active while windmilling", bool(d_lo.get("standby_oil_feed_active")))
pct_lo = d_lo.get("oil_pct") or 0
d_hi = hold(2.5, 6.0, "oil high (~6 bar > 3.0)")     # above target -> wind down to floor
pct_hi = d_hi.get("oil_pct") or 0
rec("pressure mode winds duty UP below target (>floor)", pct_lo > 40, "pct_lo=%s" % pct_lo)
rec("pressure mode winds duty DOWN to feed_pct floor above target", 18 <= pct_hi <= 26,
    "pct_hi=%s (floor feed_pct=20)" % pct_hi)

# ── windmilling stops -> feed disengages, pump returns to ~0 ─────────
t.set("N1", 0); time.sleep(1.5)
d_off = dut.data()
rec("feed disengages + pump released when windmill stops",
    (not d_off.get("standby_oil_feed_active")) and (d_off.get("oil_pct") or 0) < 5,
    "feed_active=%s oil_pct=%s" % (d_off.get("standby_oil_feed_active"), d_off.get("oil_pct")))

# ── fixed-% mode: feed_bar=0 -> duty == feed_pct regardless of pressure ──
print("fixed mode:", dc.patch_cfg({"standby_oil": {"feed_bar": 0.0, "feed_pct": 30}})[0])
d_fix = hold(2.5, 4.0, "fixed mode, oil high")   # pressure irrelevant in fixed mode
pct_fix = d_fix.get("oil_pct") or 0
rec("fixed mode holds feed_pct exactly (ignores pressure)", abs(pct_fix - 30) <= 3,
    "oil_pct=%s (feed_pct=30)" % pct_fix)

rig.recover()
dc.patch_cfg({"standby_oil": {"feed_bar": 0.0, "feed_pct": 25}})
dc.set_controllers(oil_loop=False)
t.set("N1", 0)
npass = sum(1 for _, ok in results if ok)
print("\n=== Standby-oil pressure mode: %d/%d passed ===" % (npass, len(results)))
for n, ok in results:
    if not ok: print("  FAIL:", n)
raise SystemExit(0 if npass == len(results) else 1)
rig.close()
