"""Relight after flameout (RUNNING). With relight enabled and N1 above min_rpm,
losing flame should ARM a relight (re-fire igniter, relight_armed/attempts telem)
rather than immediately shutting down.
  A. flame returns during the relight window -> engine recovers (stays RUNNING).
  B. flame stays out -> relight fails -> shutdown.
"""
import atexit, sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

OILC = round(10.0/4095.0, 7)
rig = BenchRig(); dut = rig.dut; dc = rig.dcfg; t = rig.t
original_hw = dut.hardware()
original_cfg = dut.config()
restored = False

def restore_original():
    global restored
    if restored:
        return
    try:
        rig.recover()
        dc.restore(original_hw)
        dut.ensure_mode_standby()
        code, response = dut._post("/api/config", original_cfg)
        print("restore config:", code, str(response)[:80])
        restored = code == 200
    except Exception as exc:
        print("WARNING: relight fixture restore failed:", exc)

atexit.register(restore_original)
results = []
def rec(n, ok, d=""): results.append((n, ok)); print("[%s] %-30s %s" % ("PASS" if ok else "FAIL", n, d))

dut.ensure_mode_standby()
dc.set_sequence(startup=["OilPumpOn","TimedDelay","IgniterOn","FuelPumpIdle","TimedDelay","IgniterOff","TimedDelay"],
                startup_delays=[0,400,0,0,400,0,400])
dc.only_safety("flameout")   # arm flameout (it triggers relight); other maskable safety off
print("relight cfg:", dc.patch_cfg({
    "engine": {"min_rpm": 0},
    "relight": {"enabled": True, "min_rpm": 30000, "confirm_rpm": 35000, "relight_timeout_ms": 4000},
    "calibration": {"oil_poly": {"a":0,"b":0,"c":OILC,"d":0,"x_min":0,"x_max":4095}}})[0])
dut.ensure_dev_mode(True)
if dut.data().get("bench_mode"): dut.command("TOGGLE_BENCH_MODE"); time.sleep(0.4)

def baseline(flame=1):
    t.set("N1", hz(45000)); t.set("OILP", 2.5); t.set("FLAME", flame); t.set_tot(400)
def reach_running():
    baseline(1); time.sleep(0.8); dut.ensure_mode_standby()
    for _ in range(8):
        c, r = dut.start()
        if c==200 or "reboot" not in str(r.get("error","")).lower(): break
        time.sleep(2)
    return dut.poll_until(lambda x: x.get("mode")=="RUNNING", timeout=20)

# ── A. relight recovers when flame+EGT return ───────────────────────
print("-- A: real flameout, then recovery during relight --")
r,_ = reach_running(); print("  RUNNING:", r)
for _ in range(6): baseline(1); time.sleep(0.2)   # settle lit
# drop flame AND EGT -> real flameout -> relight fires igniter
t0=time.time(); armed=False; ign_refire=False; attempts=0
while time.time()-t0 < 6.0:
    t.set("N1", hz(45000)); t.set("OILP",2.5); t.set("FLAME",0); t.set_tot(100)  # EGT drops too
    d=dut.data()
    if d.get("relight_armed") or (d.get("relight_attempts") or 0)>0: armed=True
    attempts=max(attempts, d.get("relight_attempts") or 0)
    if d.get("igniter_on"): ign_refire=True
    # once relight is actively re-igniting, restore flame+EGT to recover
    if ign_refire:
        for _ in range(15): t.set("N1",hz(45000)); t.set("FLAME",1); t.set_tot(400); t.set("OILP",2.5); time.sleep(0.2)
        break
    if d.get("mode")!="RUNNING": break
    time.sleep(0.08)
mode_reco = dut.data().get("mode")
rec("flameout arms relight", armed, "attempts=%s" % attempts)
rec("relight re-fires igniter", ign_refire)
rec("engine recovers when flame+EGT return", mode_reco=="RUNNING", "mode=%s" % mode_reco)
dut.stop(); dut.ensure_mode_standby()

# ── B. relight fails -> shutdown ────────────────────────────────────
print("\n-- B: flame stays out -> relight fails -> shutdown --")
r,_ = reach_running(); print("  RUNNING:", r)
for _ in range(6): baseline(1); time.sleep(0.2)
t0=time.time(); armed=False; down=False
while time.time()-t0 < 14:
    t.set("N1", hz(45000)); t.set("OILP",2.5); t.set("FLAME",0); t.set_tot(100)  # flame + EGT gone
    d=dut.data()
    if d.get("relight_armed") or (d.get("relight_attempts") or 0)>0: armed=True
    if d.get("mode")!="RUNNING": down=True; break
    time.sleep(0.12)
rec("relight attempted before giving up", armed)
rec("shuts down when relight fails", down,
    "reason=%r" % ((dut.data().get("fault_description") or "")[:60]))

# C. Below the explicit minimum firing speed, flameout must cut without
# energizing any relight ignition output. Deliberately set the relight value
# below Minimum Running N1 to prove the firmware applies the higher floor.
dut.ensure_mode_standby()
dc.patch_cfg({
    "engine": {"min_rpm": 30000},
    "relight": {"enabled": True, "min_rpm": 10000, "confirm_rpm": 35000,
                "relight_timeout_ms": 4000},
})
print("\n-- C: flameout below relight firing speed --")
r,_ = reach_running(); print("  RUNNING:", r)
for _ in range(6): baseline(1); time.sleep(0.2)
t0=time.time(); down=False; ignited=False
while time.time()-t0 < 7:
    t.set("N1", hz(25000)); t.set("OILP",2.5); t.set("FLAME",0); t.set_tot(100)
    d=dut.data()
    ignited = ignited or bool(d.get("igniter_on"))
    if d.get("mode") != "RUNNING":
        down=True
        break
    time.sleep(0.08)
rec("below-minimum relight never fires ignition", down and not ignited,
    "down=%s ignited=%s mode=%s" % (down, ignited, dut.data().get("mode")))

restore_original()
t.set("N1", 0)
npass = sum(1 for _,ok in results if ok)
print("\n=== Relight: %d/%d passed ===" % (npass, len(results)))
for n,ok in results:
    if not ok: print("  FAIL:", n)
rig.close()
raise SystemExit(0 if npass == len(results) else 1)
