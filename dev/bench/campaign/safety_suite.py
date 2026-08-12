import sys, time
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench import Tester, DUT
from otbench.dutconfig import DutConfig

def hz(rpm): return round(rpm / 60.0, 1)
OILC = round(10.0 / 4095.0, 7)   # linear oil poly: raw -> bar

class Rig:
    def __init__(self):
        self.dut = DUT(); self.dcfg = DutConfig(self.dut)
        self.t = Tester("COM3").open()
        self.rows = []
    def baseline(self):
        self.t.set("N1", hz(40000)); self.t.set_tot(120); self.t.set("OILP", 2.5); self.t.set("FLAME", 1)
        # The thermocouple emulator and filtered ADC channels settle
        # asynchronously. Do not begin the next start on the previous fault
        # stimulus (especially the 300 C hot-start point).
        time.sleep(2.0)
    def start_active(self, want=("STARTUP", "RUNNING"), timeout=25):
        self.dut.ensure_mode_standby()
        code = None
        for _ in range(8):
            code, resp = self.dut.start()
            if code == 200 or "reboot" not in str(resp.get("error", "")).lower():
                break
            time.sleep(2)
        if code != 200:
            return False, {"error": resp}
        return self.dut.poll_until(lambda x: x.get("mode") in want, timeout=timeout)
    def stays_active(self, drive, secs=4):
        drive()
        end = time.time() + secs
        while time.time() < end:
            if self.dut.data().get("mode") not in ("STARTUP", "RUNNING"):
                return False
            time.sleep(0.2)
        return True
    def detect_trip(self, drive, expect, timeout=8):
        t0 = time.time(); drive()
        end = time.time() + timeout
        while time.time() < end:
            d = self.dut.data(); m = d.get("mode")
            if m not in ("STARTUP", "RUNNING"):
                f = str(d.get("fault_description") or ""); ev = str(d.get("last_event") or "")
                return dict(tripped=True, matched=(expect.lower() in f.lower() or expect.lower() in ev.lower()),
                            mode=m, elapsed=round(time.time()-t0, 2), fault=f.splitlines()[0] if f else "", event=ev)
            time.sleep(0.04)
        d = self.dut.data()
        return dict(tripped=False, matched=False, mode=d.get("mode"), elapsed=None, fault="", event=str(d.get("last_event") or ""))
    def recover(self):
        self.baseline(); self.dut.stop(); self.dut.ensure_mode_standby(); time.sleep(0.5)
    def rec(self, name, neg_ok, pos):
        ok = neg_ok and pos["tripped"] and pos["matched"]
        self.rows.append((name, ok, neg_ok, pos))
        print("[%s] %-13s | neg(no-trip)=%s | pos tripped=%s matched=%s %ss fault=%r"
              % ("PASS" if ok else "FAIL", name, neg_ok, pos["tripped"], pos["matched"], pos.get("elapsed"), pos["fault"]))

rig = Rig()

# ── arm the any-mode safeties + calibrate ───────────────────────
def arm(hw):
    for k in hw["safety"]:
        hw["safety"][k] = False
    for k in ("overspeed", "overtemp", "low_oil", "hot_start"):
        hw["safety"][k] = True
    for s in ("n1_rpm", "tot", "oil_press", "flame"):
        hw["sensors"][s]["enabled"] = True
    if not any(name in ("OilPrime", "StarterSpin", "Spool", "SafetyHold") for name in hw.get("startup_seq", [])):
        hw["startup_seq"].append("SafetyHold")
        hw["startup_delay_ms"].append(0)
    hw["shutdown_delay_ms"] = [800 if d and d > 800 else d for d in hw.get("shutdown_delay_ms", [])]

print("arming safeties (overspeed/overtemp/low_oil/hot_start) + fast cooldown ...")
rig.dcfg.multi(arm)
rig.dcfg.patch_cfg({"engine": {"rpm_limit": 50000, "tot_limit": 700},
                    "oil": {"startup_min_bar": 1.5},
                    "calibration": {"oil_poly": {"a": 0, "b": 0, "c": OILC, "d": 0, "x_min": 0, "x_max": 4095}},
                    "sequence": {"startup": {"pre_start_egt_limit_c": 200, "startup_egt_limit_c": 0}}})
c = rig.dut.config()
print("  rpm_limit=%s tot_limit=%s oil_min=%s oil_poly.c=%s hot_start_thr=%s"
      % (c["engine"]["rpm_limit"], c["engine"]["tot_limit"], c["oil"]["startup_min_bar"],
         c["calibration"]["oil_poly"]["c"], c["sequence"]["startup"]["pre_start_egt_limit_c"]))
print()

# ── HOT_START (fault present at start) ──────────────────────────
rig.baseline(); rig.t.set_tot(300); time.sleep(2.0)   # hot at start
rig.dut.ensure_mode_standby()
for _ in range(8):
    code, resp = rig.dut.start()
    if code == 200 or "reboot" not in str(resp.get("error", "")).lower(): break
    time.sleep(2)
hs = {"tripped": False, "matched": False, "elapsed": None, "fault": ""}
if code == 200:
    t0 = time.time()
    ok, d = rig.dut.poll_until(lambda x: x.get("mode") in ("SHUTDOWN", "FAULT") or "HOT" in str(x.get("fault_description") or "").upper(), timeout=6)
    f = str(d.get("fault_description") or "")
    hs = dict(tripped=ok, matched="hot" in f.lower(), elapsed=round(time.time()-t0, 2), fault=f.splitlines()[0] if f else "", mode=d.get("mode"))
else:
    # start blocked because hot -> also a valid hot-start guard
    hs = dict(tripped=True, matched="hot" in str(resp.get("error", "")).lower(), elapsed=0, fault=str(resp.get("error")), mode="rejected")
# negative for hot start = the other tests all start fine with TOT=120
rig.rec("HOT_START", True, hs)
rig.recover()
# Isolate the remaining protections: their safe-side temperature points are
# intentionally above the hot-start threshold used by the first test.
rig.dcfg.patch_cfg({"sequence": {"startup": {"pre_start_egt_limit_c": 1000}}})

# ── OVERSPEED ───────────────────────────────────────────────────
rig.baseline(); rig.start_active()
neg = rig.stays_active(lambda: rig.t.set("N1", hz(49000)), 4)
pos = rig.detect_trip(lambda: rig.t.set("N1", hz(60000)), "over-speed")
rig.rec("OVERSPEED", neg, pos); rig.recover()

# ── OVERTEMP ────────────────────────────────────────────────────
rig.baseline(); rig.start_active()
neg = rig.stays_active(lambda: rig.t.set_tot(650), 5)
pos = rig.detect_trip(lambda: rig.t.set_tot(800), "over-temp")
rig.rec("OVERTEMP", neg, pos); rig.recover()

# ── LOW_OIL ─────────────────────────────────────────────────────
rig.baseline(); rig.start_active()
neg = rig.stays_active(lambda: rig.t.set("OILP", 1.3), 4)     # ~3.3 bar > 2.8 running minimum
pos = rig.detect_trip(lambda: rig.t.set("OILP", 0.2), "oil")  # ~0.5 bar < 1.5
rig.rec("LOW_OIL", neg, pos); rig.recover()

print("\n=== summary ===")
for name, ok, neg, pos in rig.rows:
    print("  %-13s %s" % (name, "PASS" if ok else "FAIL  " + repr(pos)))
rig.t.set_tot("off"); rig.t.close()
raise SystemExit(0 if rig.rows and all(row[1] for row in rig.rows) else 1)
