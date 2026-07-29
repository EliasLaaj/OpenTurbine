import sys, time
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

rig = BenchRig(); dc = rig.dcfg; dut = rig.dut; t = rig.t

def fix(hw):
    hw["sensors"]["batt_voltage"]["enabled"] = False           # free pin 4
    hw["sensors"]["throttle_input"].update(enabled=True, pin=4, rc_pwm=False)
    hw["actuators"]["throttle"].update(enabled=True, type=0, min_us=1000, max_us=2000)
    hw["actuators"]["status_led"]["enabled"] = False
    hw["controllers"].update(dynamic_idle=False, oil_loop=False, governor=False)
    for k in hw["safety"]:
        hw["safety"][k] = False
    hw["startup_delay_ms"] = [0, 400, 0, 0, 400, 0, 400]

print("config:", dc.multi(fix, check=lambda hw: hw["sensors"]["throttle_input"]["enabled"]
      and hw["sensors"]["throttle_input"]["pin"] == 4 and not hw["sensors"]["batt_voltage"]["enabled"])[0])
print("ramps 2000ms:", dc.patch_cfg({"throttle": {"ramp_up_ms": 2000, "ramp_down_ms": 2000, "idle_min_pct": 0, "expo": 0},
                                     "engine": {"rpm_limit": 120000}})[0])

t.set("N1", hz(45000)); t.set("THROTTLE_IN", 0.1); t.set_tot(300); t.set("OILP", 2.5); t.set("FLAME", 1)
dut.ensure_mode_standby()
for _ in range(8):
    code, resp = dut.start()
    if code == 200 or "reboot" not in str(resp.get("error", "")).lower(): break
    time.sleep(2)
ok, d = dut.poll_until(lambda x: x.get("mode") == "RUNNING", timeout=20)
us0, _, _, _ = t.get_pwm("THROTTLE_OUT")
print("RUNNING=%s | idle servo=%s us | throttle_eff=%s throttle_demand=%s"
      % (ok, us0, d.get("throttle_effective"), d.get("throttle_demand")))

print("\nstep throttle 0.1V -> 3.0V (rampUp 2000 ms):")
t0 = time.time(); t.set("THROTTLE_IN", 3.0)
rows = []
while time.time() - t0 < 3.5:
    us = t.get_pwm("THROTTLE_OUT")[0]; d = dut.data()
    rows.append((round(time.time()-t0, 2), us, d.get("throttle_effective")))
    time.sleep(0.25)
for ti, us, eff in rows:
    print("  t=%4.2fs  servo=%5s us  eff=%s" % (ti, us, eff))
series = [us for _, us, _ in rows if us and us > 100]
if series:
    gradual = (max(series) - series[0]) > 300 and series[1] < max(series) - 150
    print("\nramped gradually=%s  reached_full(~2000)=%s  (min %s -> max %s us)"
          % (gradual, max(series) >= 1850, min(series), max(series)))
else:
    print("\nNO servo pulses measured (throttle ESC not outputting?) - investigate")

t.set("N1", 0); t.set("THROTTLE_IN", 0.1); dut.stop(); dut.ensure_mode_standby()
rig.close()
