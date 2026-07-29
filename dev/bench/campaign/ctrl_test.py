"""Controller validation via DUT telemetry (throttle-output servo wire not needed):
  - throttle slew (rate limit)
  - throttle pullback on N1 (reduce throttle as N1 -> overspeed band)
  - throttle pullback on EGT (reduce throttle as EGT -> limit band)
  - oil pressure loop (oil pump duty rises when pressure is below target)

Run in BENCH mode so the safety monitor is skipped (per handoff) and N1/EGT can be
driven into the pullback bands without a hard shutdown; the controllers still run.
"""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

OILC = round(10.0 / 4095.0, 7)   # linear: bar = raw*10/4095
rig = BenchRig(); dc = rig.dcfg; dut = rig.dut; t = rig.t

def hard_post(mutate, check):
    for _ in range(4):
        dut.ensure_mode_standby()
        for _ in range(20):
            if not dut.data().get("extra_cooldown_active"): break
            time.sleep(1)
        hw = dut.hardware(); mutate(hw)
        code, resp = dut._post("/api/hardware", hw)
        if code != 200: time.sleep(3); continue
        for _ in range(30):
            try: dut.status(); time.sleep(0.4)
            except Exception: break
        for _ in range(60):
            try: dut.status(); time.sleep(2.0); break
            except Exception: time.sleep(1)
        if check(dut.hardware()): return True
    return False

# Main-fuel slew and pullback are automatic when a main-fuel output exists.
print("enable oil_loop:",
      hard_post(lambda hw: hw["controllers"].update(oil_loop=True),
                lambda hw: hw["controllers"]["oil_loop"]))
print("cfg (fast slew, linear oil cal, pullback bands):", dc.patch_cfg({
    "throttle": {"ramp_up_ms": 1500, "ramp_down_ms": 1500, "expo": 0, "idle_min_pct": 0,
                 "pullback_min_pct": 8, "pullback_strength": 1},
    "calibration": {"oil_poly": {"a": 0, "b": 0, "c": OILC, "d": 0, "x_min": 0, "x_max": 4095}}})[0])

dut.ensure_dev_mode(True); dut.ensure_bench_mode(True)
rig.baseline = lambda: (t.set("N1", hz(45000)), t.set_tot(300), t.set("OILP", 2.5), t.set("FLAME", 1), t.set("THROTTLE_IN", 0.05))
rig.baseline(); rig.start()
r, _ = dut.poll_until(lambda x: x.get("mode") == "RUNNING", timeout=20)
print("RUNNING=%s  tot_healthy=%s\n" % (r, dut.data().get("tot_healthy")))

def hold(n1=None, tot=None, oilp=None, thr=None, secs=2.0):
    if n1 is not None: t.set("N1", hz(n1))
    if tot is not None: t.set_tot(tot)
    if oilp is not None: t.set("OILP", oilp)
    if thr is not None: t.set("THROTTLE_IN", thr)
    time.sleep(secs)
    return dut.data()

# ── 1. Throttle slew ────────────────────────────────────────────────
print("-- throttle slew --")
hold(n1=45000, tot=300, thr=0.05, secs=2)
t0 = time.time(); t.set("THROTTLE_IN", 3.0); series = []
while time.time() - t0 < 3.0:
    d = dut.data(); series.append((round(time.time()-t0,2), d.get("throttle_effective")))
    t.set("N1", hz(45000)); time.sleep(0.3)
mids = [e for _, e in series if e is not None]
print("  eff over time:", ["%.2f" % e for e in mids])
print("  gradual ramp (not a step):", (mids[-1] - mids[0] > 0.5) and (mids[1] < mids[-1] - 0.15))

# ── 2. Throttle pullback on N1 (band 95k-100k) ──────────────────────
print("\n-- throttle pullback (N1) --")
d_lo = hold(n1=45000, thr=3.0, secs=3)       # below soft 95k -> full throttle
eff_lo = d_lo.get("throttle_effective")
d_hi = hold(n1=98000, thr=3.0, secs=3)       # in band -> pulled back
eff_hi = d_hi.get("throttle_effective")
print("  N1=45k eff=%.3f  |  N1=98k eff=%.3f  demand=%.3f" % (eff_lo, eff_hi, d_hi.get("throttle_demand")))
print("  N1 pullback reduces throttle:", eff_hi < eff_lo - 0.08)
hold(n1=45000, thr=3.0, secs=2)

# ── 3. Throttle pullback on EGT (band 700-750) ──────────────────────
print("\n-- throttle pullback (EGT) --")
d_lo = hold(n1=45000, tot=300, thr=3.0, secs=3)
eff_lo = d_lo.get("throttle_effective")
d_hi = hold(n1=45000, tot=735, thr=3.0, secs=3)   # in 700-750 band
eff_hi = d_hi.get("throttle_effective")
print("  EGT=300 eff=%.3f  |  EGT=735 eff=%.3f (tot_healthy=%s)" % (eff_lo, eff_hi, d_hi.get("tot_healthy")))
print("  EGT pullback reduces throttle:", eff_hi < eff_lo - 0.05)
hold(n1=45000, tot=300, thr=3.0, secs=2)

# ── 4. Oil pressure loop (duty rises when pressure below target 2.8) ─
print("\n-- oil pressure loop --")
d_hi = hold(oilp=2.6, secs=4)     # ~6.3 bar >> target -> low duty
oil_hi, pct_hi = d_hi.get("oil"), d_hi.get("oil_pct")
d_lo = hold(oilp=1.1, secs=5)     # ~2.7 bar ~ target / below -> higher duty
oil_lo, pct_lo = d_lo.get("oil"), d_lo.get("oil_pct")
print("  oil=%.2f bar -> oil_pct=%s  |  oil=%.2f bar -> oil_pct=%s" % (oil_hi, pct_hi, oil_lo, pct_lo))
print("  loop raises pump duty as pressure falls:", (pct_lo or 0) > (pct_hi or 0))

rig.recover()
# restore controllers to minimal default (oil_loop off)
hard_post(lambda hw: hw["controllers"].update(oil_loop=False),
          lambda hw: not hw["controllers"]["oil_loop"])
print("\ndone.")
rig.close()
