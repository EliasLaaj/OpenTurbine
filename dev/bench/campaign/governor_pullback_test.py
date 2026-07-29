"""Does N1 overspeed pullback still work while the governor commands throttle?
Governor (throttle-primary) winds throttle to 100% to hold N2 low; then drive N1
into the pullback band — throttle_effective must be pulled back below the
governor's demand (pullback runs in ThrottleSlew, after the governor)."""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

rig = BenchRig(); dut = rig.dut; dc = rig.dcfg; t = rig.t
dut.ensure_mode_standby()
dc.multi(lambda hw: (hw.__setitem__("has_two_shaft", True),
                     hw["sensors"]["n2_rpm"].update(enabled=True, pin=8, ppr=1.0),
                     hw["controllers"].update(governor=True, dynamic_idle=False)),
         check=lambda hw: hw.get("has_two_shaft") and hw["controllers"]["governor"])
print("cfg:", dc.patch_cfg({
    "governor": {"target_rpm": 40000, "band_rpm": 500, "kp": 0.003},
    "engine": {"rpm_limit": 120000, "min_rpm": 20000},   # keep 46k healthy, avoid under/overspeed
    "throttle": {"ramp_up_ms": 400, "ramp_down_ms": 400,
                 "pullback_n1": True, "pullback_n1_soft_rpm": 40000, "pullback_n1_hard_rpm": 48000,
                 "pullback_min_pct": 8, "pullback_strength": 1}})[0])
dut.ensure_dev_mode(True); dut.ensure_bench_mode(True)
t.set("N1", hz(45000)); t.set("N2", hz(34000)); t.set("OILP",2.5); t.set("FLAME",1); t.set_tot(200); t.set("THROTTLE_IN", 0.3)
time.sleep(0.8); rig.start()
r,_ = dut.poll_until(lambda x: x.get("mode")=="RUNNING", timeout=20)
print("RUNNING:", r)

def hold(n1, secs=4.0, label=""):
    end=time.time()+secs
    while time.time()<end:
        t.set("N1", hz(n1)); t.set("N2", hz(34000)); t.set("OILP",2.5); t.set("FLAME",1); t.set_tot(200); t.set("THROTTLE_IN",0.3)
        time.sleep(0.2)
    d=dut.data()
    print("  [%s] N1=%d (read=%s healthy=%s) -> throttle_demand=%.3f throttle_eff=%.3f" %
          (label, n1, d.get("n1"), d.get("n1_healthy"), d.get("throttle_demand"), d.get("throttle_effective")))
    return d.get("throttle_effective")

eff_lo = hold(35000, 4, "N1 below pullback band (40k)")   # governor winds to ~1.0, no pullback
eff_hi = hold(46000, 5, "N1 in pullback band 40-48k")     # pullback should cut it
print("\nRESULT:")
print("  governor commands max throttle (holds N2 low):", (eff_lo or 0) > 0.8, "(eff=%.3f)" % (eff_lo or 0))
print("  N1 pullback STILL reduces throttle under governor:", (eff_hi if eff_hi is not None else 1) < (eff_lo or 1) - 0.1,
      "(eff %.3f -> %.3f)" % (eff_lo or 0, eff_hi or 0))

rig.recover()
dc.set_controllers(governor=False)
t.set("N1", 0); t.set("N2", 0)
rig.close()
