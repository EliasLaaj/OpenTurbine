"""Prove the throttle pullback still works while the governor commands throttle,
using EGT pullback (TOT is driven over SPI, independent of the RPM channels that
share an LEDC timer on the tester). Governor winds throttle to 100% to hold N2
low; driving EGT into its pullback band must cut throttle_effective."""
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
    "throttle": {"ramp_up_ms": 400, "ramp_down_ms": 400,
                 "pullback_n1": False, "pullback_egt": True,
                 "pullback_egt_soft_c": 700, "pullback_egt_hard_c": 750,
                 "pullback_min_pct": 8, "pullback_strength": 1,
                 "fuel_pump_min_pct": 10}})[0])  # fuel floor 10% > pullback min 8%
dut.ensure_dev_mode(True); dut.ensure_bench_mode(True)
t.set("N1", hz(45000)); t.set("N2", hz(34000)); t.set("OILP",2.5); t.set("FLAME",1); t.set_tot(300); t.set("THROTTLE_IN",0.3)
time.sleep(0.8); rig.start()
r,_ = dut.poll_until(lambda x: x.get("mode")=="RUNNING", timeout=20)
print("RUNNING:", r)

def hold(tot, secs=5.0, label=""):
    end=time.time()+secs
    while time.time()<end:
        t.set("N1", hz(45000)); t.set("N2", hz(34000)); t.set("OILP",2.5); t.set("FLAME",1); t.set_tot(tot); t.set("THROTTLE_IN",0.3)
        time.sleep(0.2)
    d=dut.data()
    print("  [%s] EGT=%d (read=%s healthy=%s) -> throttle_demand=%.3f throttle_eff=%.3f" %
          (label, tot, d.get("tot"), d.get("tot_healthy"), d.get("throttle_demand"), d.get("throttle_effective")))
    return d.get("throttle_effective")

eff_lo = hold(300, 4, "EGT below pullback band")     # governor winds to ~1.0, no pullback
eff_hi = hold(730, 5, "EGT in pullback band 700-750")# pullback should cut it
print("\nRESULT:")
print("  governor commands max throttle (holds N2 low):", (eff_lo or 0) > 0.8, "(eff=%.3f)" % (eff_lo or 0))
print("  EGT pullback STILL reduces throttle under governor:",
      (eff_hi if eff_hi is not None else 1) < (eff_lo or 1) - 0.05, "(eff %.3f -> %.3f)" % (eff_lo or 0, eff_hi or 0))
print("  pullback respects the 10%% fuel floor (>= ~0.10, not 0.08):",
      (eff_hi if eff_hi is not None else 0) >= 0.095, "(eff=%.3f)" % (eff_hi or 0))

rig.recover()
dc.set_controllers(governor=False)
t.set("N1", 0); t.set("N2", 0)
rig.close()
