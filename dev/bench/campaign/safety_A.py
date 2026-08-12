import sys, time
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench import Tester, DUT
from otbench.dutconfig import DutConfig

def hz(rpm): return round(rpm / 60.0, 1)

class Rig:
    def __init__(self):
        self.dut = DUT(); self.dcfg = DutConfig(self.dut); self.t = Tester("COM3").open(); self.rows = []
    def baseline(self):
        self.t.set("N1", 0); self.t.set_tot(120); self.t.set("OILP", 2.5); self.t.set("FLAME", 1)
    def start_active(self, timeout=20):
        self.dut.ensure_mode_standby(); code = None
        for _ in range(8):
            code, resp = self.dut.start()
            if code == 200 or "reboot" not in str(resp.get("error", "")).lower(): break
            time.sleep(2)
        if code != 200: return False, {"error": resp}
        return self.dut.poll_until(lambda x: x.get("mode") in ("STARTUP", "RUNNING"), timeout=timeout)
    def stays_active(self, drive, secs=4):
        drive(); end = time.time() + secs
        while time.time() < end:
            if self.dut.data().get("mode") not in ("STARTUP", "RUNNING"): return False
            time.sleep(0.2)
        return True
    def detect_trip(self, drive, expect, timeout=8):
        t0 = time.time(); drive(); end = time.time() + timeout
        while time.time() < end:
            d = self.dut.data(); m = d.get("mode")
            if m not in ("STARTUP", "RUNNING"):
                f = str(d.get("fault_description") or "")
                return dict(tripped=True, matched=expect.lower() in f.lower(), mode=m,
                            elapsed=round(time.time()-t0, 2), fault=f.splitlines()[0] if f else "")
            time.sleep(0.04)
        return dict(tripped=False, matched=False, mode=self.dut.data().get("mode"), elapsed=None, fault="")
    def recover(self):
        self.baseline(); self.dut.stop(); self.dut.ensure_mode_standby()
    def rec(self, name, neg_ok, pos):
        ok = neg_ok and pos["tripped"] and pos["matched"]
        self.rows.append((name, ok));
        print("[%s] %-11s neg(no-trip@safe)=%s  pos: tripped=%s matched=%s %ss %r"
              % ("PASS" if ok else "FAIL", name, neg_ok, pos["tripped"], pos["matched"], pos.get("elapsed"), pos["fault"]))

rig = Rig(); dc = rig.dcfg
ok, d = rig.dut.ensure_mode_standby()   # tester-open glitches START -> must settle before config
print("DUT mode before config: %s (standby=%s)" % (d.get("mode"), ok))
print("config: sensors on, fast cooldown, arm overspeed/overtemp/hot_start (verified)")
print("  sensors+cooldown:", dc.multi(
    lambda hw: ([hw["sensors"][s].update(enabled=True) for s in ("n1_rpm","tot","oil_press","flame")],
                hw.__setitem__("shutdown_delay_ms", [800 if d and d>800 else d for d in hw.get("shutdown_delay_ms",[])]))[-1],
    check=lambda hw: all(hw["sensors"][s]["enabled"] for s in ("n1_rpm","tot","oil_press","flame")))[0])
print("  arm:", dc.only_safety("overspeed", "overtemp")[0])
print("  cfg:", dc.patch_cfg({"engine": {"rpm_limit": 50000, "tot_limit": 700},
                              "sequence": {"startup": {"pre_start_egt_limit_c": 200, "startup_egt_limit_c": 0}}})[0])
c = rig.dut.config(); hw = rig.dut.hardware()
print("  VERIFIED armed=%s rpm_limit=%s tot_limit=%s hot_thr=%s\n"
      % ({k for k,v in hw["safety"].items() if v}, c["engine"]["rpm_limit"], c["engine"]["tot_limit"], c["sequence"]["startup"]["pre_start_egt_limit_c"]))

# OVERSPEED
rig.baseline(); rig.start_active()
neg = rig.stays_active(lambda: rig.t.set("N1", hz(49000)), 4)
pos = rig.detect_trip(lambda: rig.t.set("N1", hz(60000)), "over-speed")
rig.rec("OVERSPEED", neg, pos); rig.recover()

# OVERTEMP
rig.baseline(); rig.start_active()
neg = rig.stays_active(lambda: rig.t.set_tot(650), 5)
pos = rig.detect_trip(lambda: rig.t.set_tot(800), "over-temp")
rig.rec("OVERTEMP", neg, pos); rig.recover()

# HOT_START (TOT hot at start -> abort in STARTUP) — now arm hot_start too
print("arm hot_start:", dc.set_safety(hot_start=True)[0])
rig.baseline(); rig.t.set_tot(300); time.sleep(2.2)
t0 = time.time(); code = None
rig.dut.ensure_mode_standby()
for _ in range(8):
    code, resp = rig.dut.start()
    if code == 200 or "reboot" not in str(resp.get("error", "")).lower(): break
    time.sleep(2)
if code == 200:
    ok, d = rig.dut.poll_until(lambda x: x.get("mode") in ("SHUTDOWN","FAULT") or "hot" in str(x.get("fault_description") or "").lower(), timeout=6)
    f = str(d.get("fault_description") or "")
    pos = dict(tripped=ok, matched="hot" in f.lower(), elapsed=round(time.time()-t0,2), fault=f.splitlines()[0] if f else "")
else:
    pos = dict(tripped=True, matched="hot" in str(resp).lower(), elapsed=0, fault=str(resp))
rig.rec("HOT_START", True, pos); rig.recover()

print("\n=== Run A summary ===")
for n, ok in rig.rows: print("  %-11s %s" % (n, "PASS" if ok else "FAIL"))
rig.t.set_tot("off"); rig.t.close()
raise SystemExit(0 if rig.rows and all(row[1] for row in rig.rows) else 1)
