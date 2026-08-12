"""Config persistence / validation / reboot survival.
  1. Round-trip: PATCH a value, read it back.
  2. Reboot survival: value persists across a reboot.
  3. Reject illegal pin: two enabled sensors on one pin is refused (or relocated).
  4. Out-of-range limit: extreme value loads with a prominent warning, not silently.
"""
import sys, time, os, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.dut import DUT

d = DUT(); d.ensure_mode_standby()
d.ensure_dev_mode(True)
results = []
def rec(n, ok, det=""): results.append((n, ok)); print("[%s] %-32s %s" % ("PASS" if ok else "FAIL", n, det))

def reboot_wait():
    for _ in range(30):
        try: d.status(); time.sleep(0.4)
        except Exception: break
    for _ in range(60):
        try: d.status(); time.sleep(2.0); return
        except Exception: time.sleep(1)

# ── 1. round-trip ───────────────────────────────────────────────────
ok, _ = d.patch("/api/config", {"engine": {"rpm_limit": 55000}})
time.sleep(0.5)
val = d.config().get("engine", {}).get("rpm_limit")
rec("round-trip rpm_limit=55000", abs((val or 0) - 55000) < 1, "read=%s" % val)

# ── 2. reboot survival ──────────────────────────────────────────────
# a config PATCH should persist to LittleFS; force a reboot via a no-op hardware POST
hw = d.hardware(); code, _ = d._post("/api/hardware", hw)
if code == 200: reboot_wait()
d.ensure_dev_mode(True)
val2 = d.config().get("engine", {}).get("rpm_limit")
rec("rpm_limit survives reboot", abs((val2 or 0) - 55000) < 1, "read=%s" % val2)
# restore
d.patch("/api/config", {"engine": {"rpm_limit": 50000}}); time.sleep(0.3)

# ── 3. reject illegal pin (two enabled sensors on same pin) ─────────
hw = d.hardware()
orig_flame_pin = hw["sensors"]["flame"]["pin"]
hw["sensors"]["flame"]["pin"] = hw["sensors"]["oil_press"]["pin"]  # collide flame onto oil_press pin
hw["sensors"]["flame"]["enabled"] = True
hw["sensors"]["oil_press"]["enabled"] = True
code, resp = d._post("/api/hardware", hw)
if code == 200: reboot_wait()
hw2 = d.hardware()
fp = hw2["sensors"]["flame"]["pin"]; op = hw2["sensors"]["oil_press"]["pin"]
fen = hw2["sensors"]["flame"]["enabled"]; oen = hw2["sensors"]["oil_press"]["enabled"]
# acceptable outcomes: POST rejected (non-200), OR the DUT refused to leave both enabled on the same pin
conflict_resolved = (code != 200) or not (fen and oen and fp == op)
rec("illegal pin collision refused/resolved", conflict_resolved,
    "code=%s flame(pin=%s en=%s) oil(pin=%s en=%s)" % (code, fp, fen, op, oen))
# restore flame to its own pin
hw3 = d.hardware(); hw3["sensors"]["flame"]["pin"] = orig_flame_pin; hw3["sensors"]["flame"]["enabled"] = True
hw3["sensors"]["oil_press"]["enabled"] = True
code, _ = d._post("/api/hardware", hw3)
if code == 200: reboot_wait()
d.ensure_dev_mode(True)

# ── 4. out-of-range limit -> rejected at PATCH, not silently stored ─
# A live PATCH is validated: rpm_limit below min_rpm is structurally invalid, so the
# firmware rejects it (400) and keeps the previous valid value rather than accepting a
# bad limit. (config_load_warning is the separate boot-time path for legacy flash.)
d.patch("/api/config", {"engine": {"min_rpm": 30000, "rpm_limit": 50000}}); time.sleep(0.4)
code, resp = d.patch("/api/config", {"engine": {"rpm_limit": 20000}}); time.sleep(0.4)
cfg = d.config().get("engine", {})
not_silent = (code != 200) or abs((cfg.get("rpm_limit") or 0) - 20000) > 1  # rejected OR not stored
rec("out-of-range limit rejected (not silent)", not_silent,
    "PATCH code=%s stored rpm_limit=%s min_rpm=%s" % (code, cfg.get("rpm_limit"), cfg.get("min_rpm")))
# restore sane
d.patch("/api/config", {"engine": {"rpm_limit": 50000, "min_rpm": 30000}}); time.sleep(0.3)

npass = sum(1 for _,ok in results if ok)
print("\n=== Config: %d/%d passed ===" % (npass, len(results)))
for n,ok in results:
    if not ok: print("  FAIL:", n)
raise SystemExit(0 if npass == len(results) else 1)
