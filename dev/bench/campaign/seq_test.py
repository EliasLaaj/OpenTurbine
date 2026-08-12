"""Sequencer validation (non-bench, real gating):
  1. Realistic startup [OilPrime, PreIgnSpark, FuelOpen, FlameConfirm, Spool]:
     each block's actuator fires (oil pump / igniter / fuel sol) and the gated
     blocks advance on their sensor (oil>=min, flame, N1>=spool target) -> RUNNING.
  2. OilPrime abort: oil stays low -> times out -> STARTUP aborts (engine never lit).
  3. FlameConfirm abort: no flame -> times out -> 'no ignition' abort.
  4. STOP during startup -> abort to shutdown.
"""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

OILC = round(10.0 / 4095.0, 7)
rig = BenchRig(); dut = rig.dut; dc = rig.dcfg; t = rig.t
results = []
def rec(n, ok, d=""): results.append((n, ok)); print("[%s] %-28s %s" % ("PASS" if ok else "FAIL", n, d))

dut.ensure_mode_standby()
print("oil cal + spool/flame timing:", dc.patch_cfg({
    "calibration": {"oil_poly": {"a":0,"b":0,"c":OILC,"d":0,"x_min":0,"x_max":4095}},
    "oil": {"startup_min_bar": 1.5, "startup_pressure": 3.0},
    "sequence": {"spool_rpm_target": 30000, "spool_timeout_ms": 12000,
                 "flame_timeout_ms": 5000, "startup_oil_arm_timeout_ms": 3000}})[0])
SEQ = ["OilPrime","PreIgnSpark","FuelOpen","FlameConfirm","Spool"]
print("set startup seq:", dc.set_sequence(startup=SEQ, startup_delays=[0,600,0,0,0])[0])
dut.ensure_dev_mode(True)
if dut.data().get("bench_mode"): dut.command("TOGGLE_BENCH_MODE"); time.sleep(0.4)
print("bench_mode:", dut.data().get("bench_mode"))
# OilPrime with an oil sensor regulates the pump via the oil control loop, so it must
# be enabled for the pump to actually build pressure (see the preflight warning).
print("oil loop:", dc.set_controllers(oil_loop=True)[0])

def drive(n1=0, oilv=2.5, flame=1, tot=120):
    t.set("N1", hz(n1)); t.set("OILP", oilv); t.set("FLAME", flame); t.set_tot(tot)

# ── 1. realistic startup ────────────────────────────────────────────
print("\n-- realistic startup --")
drive(n1=0, oilv=2.5, flame=0, tot=120); time.sleep(1.0)
dut.ensure_mode_standby()
for _ in range(8):
    code, resp = dut.start()
    if code == 200 or "reboot" not in str(resp.get("error","")).lower(): break
    time.sleep(2)
blocks = []; saw_oil = saw_ign = saw_fuel = False; flame_set = False
t0 = time.time()
while time.time() - t0 < 25:
    d = dut.data(); m = d.get("mode"); blk = d.get("current_block")
    if blk and (not blocks or blocks[-1] != blk): blocks.append(blk)
    s21 = t.get("OILPUMP_OUT");
    if s21.get("duty",0) > 0.02 or s21.get("level")==1: saw_oil = True
    if t.get("IGNITER").get("level")==1: saw_ign = True
    if t.get("FUEL_SOL").get("level")==1: saw_fuel = True
    # provide gates: once fuel opened, turn flame on; ramp N1 for spool
    if blk == "FlameConfirm" and not flame_set:
        t.set("FLAME", 1); flame_set = True
    if blk == "Spool":
        t.set("N1", hz(32000))
    # OilPrime only commands the pump when oil is below its target; hold oil below the
    # arm-min (1.5) until the pump is seen priming, then raise it so OilPrime completes.
    t.set("OILP", 1.0 if (blk == "OilPrime" and not saw_oil) else 2.5); t.set_tot(120)
    if m == "RUNNING": break
    time.sleep(0.15)
d = dut.data()
print("  blocks:", " -> ".join(blocks), "| final mode:", d.get("mode"))
rec("startup reached RUNNING", d.get("mode") == "RUNNING", "mode=%s" % d.get("mode"))
rec("OilPrime drove oil pump", saw_oil)
rec("PreIgnSpark drove igniter", saw_ign)
rec("FuelOpen drove fuel sol", saw_fuel)
rec("progressed through gated blocks", "FlameConfirm" in blocks and "Spool" in blocks,
    "seen: %s" % blocks)
# shutdown: STOP -> ImmediateCut cuts fuel
t.set("N1", hz(20000))
dut.stop(); time.sleep(1.5)
fuel_after = t.get("FUEL_SOL").get("level")
rec("shutdown ImmediateCut cut fuel", fuel_after == 0, "fuel_level=%s" % fuel_after)
dut.ensure_mode_standby()

# ── 2. OilPrime abort (oil never reaches min) ───────────────────────
print("\n-- OilPrime abort (oil low) --")
t.set("OILP", 0.2); drive(n1=0, oilv=0.2, flame=0, tot=120); time.sleep(0.5)
dut.ensure_mode_standby(); dut.start()
end = time.time() + 10; aborted = False; reason = ""; saw_startup = False
while time.time() < end:
    d = dut.data(); m = d.get("mode")
    if m == "STARTUP": saw_startup = True
    if saw_startup and m != "STARTUP":
        aborted = True; reason = d.get("last_event") or (d.get("fault_description") or ""); break
    t.set("OILP", 0.2)
    time.sleep(0.15)
rec("OilPrime aborts on oil timeout", aborted, "reason=%r" % (reason[:70] if reason else ""))
dut.ensure_mode_standby()

# ── 3. FlameConfirm abort (no flame) ────────────────────────────────
print("\n-- FlameConfirm abort (no flame) --")
drive(n1=0, oilv=2.5, flame=0, tot=120); time.sleep(0.5)
dut.ensure_mode_standby(); dut.start()
end = time.time() + 14; aborted = False; reason = ""; sawFC = False
while time.time() < end:
    d = dut.data(); blk = d.get("current_block")
    if blk == "FlameConfirm": sawFC = True
    t.set("OILP", 2.5); t.set("FLAME", 0); t.set_tot(120)
    if sawFC and d.get("mode") not in ("STARTUP",):
        aborted = True; reason = d.get("last_event") or (d.get("fault_description") or ""); break
    time.sleep(0.2)
rec("FlameConfirm aborts (no ignition)", aborted, "reason=%r" % (reason[:70] if reason else ""))
dut.ensure_mode_standby()

# ── 4. STOP during startup ──────────────────────────────────────────
print("\n-- STOP during startup --")
drive(n1=0, oilv=2.5, flame=0, tot=120); time.sleep(0.5)
dut.ensure_mode_standby(); dut.start(); time.sleep(1.0)
mode_mid = dut.data().get("mode")
t.set("STOP", 1); time.sleep(0.3); t.set("STOP", 0)
time.sleep(1.5)
mode_after = dut.data().get("mode")
rec("STOP aborts startup", mode_mid == "STARTUP" and mode_after in ("STANDBY","SHUTDOWN"),
    "%s -> %s" % (mode_mid, mode_after))

rig.recover()
# restore minimal seq + leave oil loop as we found it (off)
dc.set_sequence(startup=["OilPumpOn","TimedDelay","IgniterOn","FuelPumpIdle","TimedDelay","IgniterOff","TimedDelay"],
                startup_delays=[0,400,0,0,400,0,400])
dc.set_controllers(oil_loop=False)
t.set("N1", 0)
npass = sum(1 for _,ok in results if ok)
print("\n=== Sequencer: %d/%d passed ===" % (npass, len(results)))
for n,ok in results:
    if not ok: print("  FAIL:", n)
rig.close()
raise SystemExit(0 if npass == len(results) else 1)
