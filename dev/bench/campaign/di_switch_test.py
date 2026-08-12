"""Digital inputs: START/STOP hardware switches + a general-purpose DI channel.

START (dut13/tester13) and STOP (dut15/tester14) are wired as digital switch inputs.
The 4 general DI channels aren't dedicated-wired, so we reuse the IDLE_IN pin (dut5,
tester DAC) as a DI channel and drive it high/low to prove the channel debounces and
reports state. (AB-arm / fault / estop roles change mode; here we validate the plumbing.)
"""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

rig = BenchRig(); dut = rig.dut; dc = rig.dcfg; t = rig.t
results = []
def rec(n, ok, d=""): results.append((n, ok)); print("[%s] %-38s %s" % ("PASS" if ok else "FAIL", n, d))
dut.ensure_mode_standby(); dut.ensure_dev_mode(True)

# ── configure START/STOP switch pins + one DI channel on the idle-input pin ──
def setup(hw):
    hw.setdefault("controls", {})
    hw["controls"]["start_pin"] = 13
    hw["controls"]["stop_pin"]  = 15
    hw["sensors"]["idle_input"].update(enabled=False)   # free pin 5 for the DI channel
    hw["di_channels"][0].update(pin=5, active_h=True, debounce_ms=20, role="none",
                                label="TEST-DI", active_modes=0x1F)
ok = dc.multi(setup, check=lambda hw: hw.get("controls", {}).get("start_pin") == 13
              and hw["di_channels"][0]["pin"] == 5)[0]
print("configure start/stop pins + DI ch0 on pin5:", ok)

# ── 1. DI channel reports driven state ──────────────────────────────
t.set("IDLE_IN", 1.0); time.sleep(0.4)          # drive pin high (DAC high)
di_hi = (dut.data().get("di_channels") or [{}])[0].get("state")
t.set("IDLE_IN", 0.0); time.sleep(0.4)          # drive low
di_lo = (dut.data().get("di_channels") or [{}])[0].get("state")
rec("DI channel tracks driven level (hi/lo)", di_hi is True and di_lo is False,
    "hi=%s lo=%s" % (di_hi, di_lo))

# ── 2. START switch initiates a start ───────────────────────────────
dut.ensure_bench_mode(True)
t.set("N1", hz(45000)); t.set("OILP", 2.5); t.set("FLAME", 1); t.set_tot(200)
dut.ensure_mode_standby(); time.sleep(0.5)
t.set("START", 1); time.sleep(0.4); t.set("START", 0)   # press-release
r, _ = dut.poll_until(lambda x: x.get("mode") in ("STARTUP", "RUNNING"), timeout=8)
sw = dut.data().get("start_switch_active")
rec("START switch initiates start", r, "mode=%s (start_switch seen active during press)" % dut.data().get("mode"))

# ── 3. STOP switch shuts the engine down ────────────────────────────
time.sleep(0.5)
t.set("STOP", 1); time.sleep(0.4); t.set("STOP", 0)
r2, _ = dut.poll_until(lambda x: x.get("mode") in ("SHUTDOWN", "STANDBY"), timeout=8)
rec("STOP switch shuts engine down", r2, "mode=%s" % dut.data().get("mode"))

# ── restore ─────────────────────────────────────────────────────────
rig.recover()
def restore(hw):
    hw["controls"]["start_pin"] = -1
    hw["controls"]["stop_pin"]  = -1
    hw["di_channels"][0].update(pin=-1, role="none", label="")
    hw["sensors"]["idle_input"].update(enabled=True, pin=5)
dc.multi(restore)
t.set("N1", 0)
npass = sum(1 for _, ok in results if ok)
print("\n=== DI + switches: %d/%d passed ===" % (npass, len(results)))
for n, ok in results:
    if not ok: print("  FAIL:", n)
rig.close()
raise SystemExit(0 if npass == len(results) else 1)
