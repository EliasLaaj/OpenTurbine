import sys, time
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))
from otbench.benchrig import BenchRig, hz

OILC = round(10.0 / 4095.0, 7)
rig = BenchRig(); dc = rig.dcfg; dut = rig.dut; t = rig.t
print("settled:", dut.mode())

def run_baseline():
    t.set("N1", hz(45000)); t.set_tot(500); t.set("OILP", 2.5); t.set("FLAME", 1)

print("config: short minimal startup, arm oil_zero+flameout, oil_poly linear, relight off")
print("  seq:", dc.set_sequence(
    startup=["OilPumpOn", "TimedDelay", "IgniterOn", "FuelPumpIdle", "TimedDelay", "IgniterOff", "TimedDelay"],
    startup_delays=[0, 400, 0, 0, 400, 0, 400])[0])
print("  arm:", dc.only_safety("oil_zero", "flameout")[0])
print("  cfg:", dc.patch_cfg({
    "calibration": {"oil_poly": {"a": 0, "b": 0, "c": OILC, "d": 0, "x_min": 0, "x_max": 4095}},
    "relight": {"enabled": False}})[0])

def reach_running(timeout=20):
    run_baseline(); dut.ensure_mode_standby()
    for _ in range(8):
        code, resp = dut.start()
        if code == 200 or "reboot" not in str(resp.get("error", "")).lower(): break
        time.sleep(2)
    if code != 200:
        return False, {"error": resp}
    return dut.poll_until(lambda x: x.get("mode") == "RUNNING", timeout=timeout)

# ── confirm RUNNING is reachable ────────────────────────────────
ok, d = reach_running()
print("\nreach RUNNING: %s (mode=%s, block=%s, flame_monitor via running)" % (ok, d.get("mode"), d.get("current_block")))

if ok:
    # OIL_ZERO
    neg = rig.stays_active(lambda: t.set("OILP", 0.15), 3)          # ~0.37 bar > 0.1
    pos = rig.detect_trip(lambda: t.set("OILP", 0.02), "oil", 6)    # ~0.05 bar < 0.1
    rig.rec("OIL_ZERO", neg, pos); rig.recover()

    # FLAMEOUT: reach running, confirm it stays with flame, then remove flame + drop EGT
    ok2, d2 = reach_running()
    if ok2:
        neg = rig.stays_active(lambda: run_baseline(), 3)           # flame present -> stays
        pos = rig.detect_trip(lambda: (t.set("FLAME", 0), t.set_tot(100)), "flame", 8)  # loss -> flameout (3 s delay)
        rig.rec("FLAMEOUT", neg, pos); rig.recover()
    else:
        print("FLAMEOUT: could not reach RUNNING again:", d2.get("mode"))
else:
    print("Could not reach RUNNING - oil_zero/flameout need it. mode=%s" % d.get("mode"))

rig.summary("Run C (RUNNING-mode: oil_zero, flameout)")
rig.close()
raise SystemExit(0 if rig.rows and all(row[1] for row in rig.rows) else 1)
