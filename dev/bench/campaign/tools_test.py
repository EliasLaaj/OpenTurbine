"""Tools / commands validation: mode toggles, actuator self-tests (configured +
graceful rejection of unconfigured), manual oil override, reset-peaks."""
import sys, time, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

rig = BenchRig(); dut = rig.dut; t = rig.t
dut.ensure_mode_standby()
results = []
def rec(name, ok, detail=""):
    results.append((name, ok)); print("[%s] %-22s %s" % ("PASS" if ok else "FAIL", name, detail))

# make sure we start from a known state: dev/bench off
if dut.data().get("dev_mode"): dut.command("TOGGLE_DEV_MODE")
time.sleep(0.3)

# ── 1. Toggles flip their telemetry flag ────────────────────────────
def toggle_test(name, cmd, key, iParam=0):
    before = bool(dut.data().get(key))
    dut.command(cmd, iParam=iParam); time.sleep(0.4)
    after = bool(dut.data().get(key))
    rec(name, after != before, "%s: %s -> %s" % (key, before, after))
    # restore
    if after != before:
        dut.command(cmd, iParam=iParam); time.sleep(0.3)

toggle_test("toggle dev_mode",     "TOGGLE_DEV_MODE",     "dev_mode")
# dev mode needed for some toggles; enable it for the rest
dut.command("TOGGLE_DEV_MODE"); time.sleep(0.4)
print("  (dev_mode=%s for subsequent toggles)" % dut.data().get("dev_mode"))
toggle_test("toggle bench_mode",   "TOGGLE_BENCH_MODE",   "bench_mode")
toggle_test("toggle dynamic_idle", "TOGGLE_DYNAMIC_IDLE", "dynamic_idle_enabled")
toggle_test("toggle limp_mode",    "TOGGLE_LIMP_MODE",    "limp_mode")

# ── 2. Pulsed-assist test rejected when hardware is absent ─────────
code, resp = dut.command("PULSED_STARTER_ASSIST_TEST")
rec("reject pulsed assist (unconfigured)", code != 200,
    "code=%s err=%r" % (code, resp.get("error")))

# ── 3. Configured actuator self-tests drive the pin ─────────────────
def selftest_drives(name, cmd, sig, telem_key, ledc=False):
    dut.command(cmd); time.sleep(0.6)
    seen_pin = False; seen_tel = False
    end = time.time() + 3
    while time.time() < end:
        s = t.get(sig)
        if s.get("level") == 1 or s.get("duty", 0) > 0.05 or s.get("us", 0) > 0: seen_pin = True
        if dut.data().get(telem_key): seen_tel = True
        if seen_pin and seen_tel: break
        time.sleep(0.05)
    rec(name, seen_pin and seen_tel, "pin=%s telem=%s" % (seen_pin, seen_tel))

selftest_drives("IGN_TEST",      "IGN_TEST",      "IGNITER",      "igniter_on")
selftest_drives("OIL_PRIME",     "OIL_PRIME",     "OILPUMP_OUT",  "oil_pct")
selftest_drives("FUEL_SOL_TEST", "FUEL_SOL_TEST", "FUEL_SOL",     "fuel_sol_open")

# ── 4. Unconfigured self-tests are gracefully rejected ──────────────
for cmd in ["IGN2_TEST", "START_TEST", "STARTER_EN_TEST", "GLOW_TEST", "COOL_FAN_TEST",
            "AB_SOL_TEST", "OIL_SCAV_TEST", "PROP_PITCH_TEST"]:
    code, resp = dut.command(cmd)
    rec("reject %s (unconfigured)" % cmd, code != 200, "code=%s err=%r" % (code, resp.get("error")))

# ── 5. Manual oil override SET_OIL_PCT drives the pump duty ──────────
dut.command("SET_OIL_PCT", iParam=70); time.sleep(1.0)
duty = 0
end = time.time() + 2
while time.time() < end:
    s = t.get("OILPUMP_OUT")
    if s.get("duty", 0) > 0: duty = s["duty"]
    time.sleep(0.05)
oilpct = dut.data().get("oil_pct")
rec("SET_OIL_PCT 70%", 0.4 < duty < 0.95 or (oilpct and abs(oilpct-70) < 15),
    "tester duty=%.2f oil_pct=%s" % (duty, oilpct))
dut.command("SET_OIL_PCT", iParam=0); time.sleep(0.3)

# ── 6. RESET_PEAKS clears the session peaks ─────────────────────────
# make a peak in bench mode: start, drive N1, stop
dut.command("TOGGLE_BENCH_MODE") if not dut.data().get("bench_mode") else None
time.sleep(0.3)
t.set("N1", hz(52000)); time.sleep(0.5)
rig.start(); time.sleep(1.0)
t.set("N1", hz(52000)); time.sleep(1.5)
peak_before = dut.data().get("max_n1")
dut.stop(); dut.ensure_mode_standby()
dut.command("RESET_PEAKS"); time.sleep(0.5)
peak_after = dut.data().get("max_n1")
rec("RESET_PEAKS clears max_n1", (peak_before or 0) > 1000 and (peak_after or 0) < 1000,
    "max_n1 %s -> %s" % (peak_before, peak_after))

# cleanup: dev/bench off
if dut.data().get("bench_mode"): dut.command("TOGGLE_BENCH_MODE"); time.sleep(0.3)
if dut.data().get("dev_mode"):  dut.command("TOGGLE_DEV_MODE"); time.sleep(0.3)
t.set("N1", 0)

npass = sum(1 for _, ok in results if ok)
print("\n=== Tools: %d/%d passed ===" % (npass, len(results)))
for n, ok in results:
    if not ok: print("  FAIL:", n)
rig.close()
raise SystemExit(0 if npass == len(results) else 1)
