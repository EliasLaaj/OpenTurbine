"""Validate the fuel-pump min-spin feature:
  1. SET_THROTTLE_PCT drives the throttle/fuel-pump ESC in STANDBY (calibration ramp).
  2. Saving throttle.fuel_pump_min_pct persists.
  3. In RUNNING the throttle floor = fuel_pump_min_pct — no controller can command
     below the measured pump minimum.
  4. fuel_pump_min_pct = 0 means NO floor (uncalibrated) — throttle follows demand
     down toward 0. The old arbitrary 8% idle floor was removed by design.
"""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

rig = BenchRig(); dut = rig.dut; dc = rig.dcfg; t = rig.t
results = []
def rec(n, ok, d=""): results.append((n, ok)); print("[%s] %-38s %s" % ("PASS" if ok else "FAIL", n, d))
dut.ensure_mode_standby()

# ── 1. SET_THROTTLE_PCT drives the pump in STANDBY ──────────────────
best = 0
for _ in range(4):
    dut.command("SET_THROTTLE_PCT", iParam=25); time.sleep(0.4)
    s = t.get("THROTTLE_OUT")
    if s.get("us", 0) > best: best = s["us"]
eff = dut.data().get("throttle_effective")
# 25% servo ~ 1000 + 0.25*1000 = 1250us
rec("SET_THROTTLE_PCT drives pump (STANDBY)", 1150 < best < 1350 or (eff and 0.18 < eff < 0.32),
    "tester us=%s throttle_eff=%s" % (best, eff))
dut.command("SET_THROTTLE_PCT", iParam=0); time.sleep(0.5)

# ── 2. save + persist fuel_pump_min_pct ─────────────────────────────
dut.ensure_dev_mode(True)
ok, _ = dc.patch_cfg({"throttle": {"idle_min_pct": 8, "fuel_pump_min_pct": 15}})
saved = dut.config().get("throttle", {}).get("fuel_pump_min_pct")
tel = dut.data().get("fuel_pump_min_pct")
rec("fuel_pump_min_pct saves (cfg+telemetry)", abs((saved or 0) - 15) < 0.5 and abs((tel or 0) - 15) < 0.5,
    "cfg=%s telem=%s" % (saved, tel))

# ── 3. RUNNING floor = max(idle 8%, pump 15%) = 15% ─────────────────
dc.set_controllers(governor=False)
dut.ensure_bench_mode(True)
t.set("N1", hz(45000)); t.set("OILP",2.5); t.set("FLAME",1); t.set_tot(200); t.set("THROTTLE_IN", 0.0)
time.sleep(0.6); rig.start()
dut.poll_until(lambda x: x.get("mode")=="RUNNING", timeout=20)
for _ in range(12): t.set("N1", hz(45000)); t.set("THROTTLE_IN", 0.0); time.sleep(0.2)
eff15 = dut.data().get("throttle_effective")
rec("RUNNING floor uses pump min (15%, not 8%)", eff15 is not None and 0.14 < eff15 < 0.17,
    "throttle_eff=%.3f" % (eff15 or 0))

# pump min = 0 -> NO fuel floor: throttle follows demand down toward 0 (old 8% idle
# floor removed by design). idle_min_pct is a SEPARATE mechanism (the idle-input curve
# low end); zero it too so we isolate the fuel floor and the pilot-idle position can't
# mask it. A mid-RUNNING config PATCH is rejected, so set it in STANDBY, then restart.
rig.recover(); dut.ensure_mode_standby()
dc.patch_cfg({"throttle": {"fuel_pump_min_pct": 0, "idle_min_pct": 0}})
dut.ensure_bench_mode(True)
t.set("N1", hz(45000)); t.set("OILP",2.5); t.set("FLAME",1); t.set_tot(200); t.set("THROTTLE_IN", 0.0)
time.sleep(0.6); rig.start()
dut.poll_until(lambda x: x.get("mode")=="RUNNING", timeout=20)
for _ in range(12): t.set("N1", hz(45000)); t.set("THROTTLE_IN", 0.0); time.sleep(0.2)
eff0 = dut.data().get("throttle_effective")
rec("pump min = 0 means NO floor (throttle -> ~0, not 8%)", eff0 is not None and eff0 < 0.05,
    "throttle_eff=%.3f" % (eff0 or 0))

rig.recover()
dc.patch_cfg({"throttle": {"fuel_pump_min_pct": 0}})
t.set("N1", 0)
npass = sum(1 for _,ok in results if ok)
print("\n=== Fuel-pump min-spin: %d/%d passed ===" % (npass, len(results)))
for n,ok in results:
    if not ok: print("  FAIL:", n)
rig.close()
raise SystemExit(0 if npass == len(results) else 1)
