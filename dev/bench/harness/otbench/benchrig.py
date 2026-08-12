"""BenchRig — reusable driver for the validation campaign.

Wraps DUT (Wi-Fi) + Tester (serial) + DutConfig, and provides the common
patterns: safe baseline, verified start into an active mode, negative
(stays-active) and positive (detect-trip) checks, and recovery. Opening the
tester glitches the DUT into STARTUP, so __init__ settles it to STANDBY.
"""

import os
import time

from .dut import DUT
from .tester import Tester
from .dutconfig import DutConfig


def hz(rpm):
    return round(rpm / 60.0, 1)   # pulses/s for ppr = 1


class BenchRig:
    def __init__(self, port=None):
        self.dut = DUT()
        self.dcfg = DutConfig(self.dut)
        self.t = Tester(port or os.environ.get("OTBENCH_PORT", "COM3")).open()
        self.dut.ensure_mode_standby()   # settle the open-glitch before any config
        self.rows = []

    def close(self):
        try:
            self.t.set("N1", 0); self.t.set_tot("off")
        except Exception:
            pass
        try:
            self.dut.stop(); self.dut.ensure_mode_standby()
        except Exception:
            pass
        self.t.close()

    # ── sensor baseline (wired sensors all in a safe, healthy state) ──
    def baseline(self):
        self.t.set("N1", 0)
        self.t.set_tot(120)
        self.t.set("OILP", 2.5)
        self.t.set("FLAME", 1)

    # ── engine control ───────────────────────────────────────
    def start(self, want=("STARTUP", "RUNNING"), timeout=25):
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

    def reach_running(self, timeout=45):
        """Drive N1 up so an RPM-gated startup can spool to RUNNING."""
        self.t.set("N1", hz(45000))
        return self.dut.poll_until(lambda x: x.get("mode") == "RUNNING", timeout=timeout)

    def recover(self):
        self.baseline()
        self.dut.stop()
        self.dut.ensure_mode_standby()

    # ── assertions ───────────────────────────────────────────
    def stays_active(self, drive, secs=4):
        """Apply drive(); return True if the engine STAYS in an active mode."""
        drive()
        end = time.time() + secs
        while time.time() < end:
            if self.dut.data().get("mode") not in ("STARTUP", "RUNNING"):
                return False
            time.sleep(0.2)
        return True

    def detect_trip(self, drive, expect, timeout=8):
        """Apply drive(); capture the instant the engine leaves the active mode."""
        t0 = time.time(); drive()
        end = time.time() + timeout
        while time.time() < end:
            d = self.dut.data(); m = d.get("mode")
            if m not in ("STARTUP", "RUNNING"):
                f = str(d.get("fault_description") or "")
                return dict(tripped=True, matched=expect.lower() in f.lower(), mode=m,
                            elapsed=round(time.time()-t0, 2), fault=f.splitlines()[0] if f else "")
            time.sleep(0.04)
        d = self.dut.data()
        return dict(tripped=False, matched=False, mode=d.get("mode"), elapsed=None, fault="")

    # ── reporting ────────────────────────────────────────────
    def rec(self, name, neg_ok, pos, note=""):
        ok = bool(neg_ok) and pos["tripped"] and pos["matched"]
        self.rows.append((name, ok, note))
        print("[%s] %-13s neg(no-trip)=%s pos: trip=%s match=%s %ss %r %s"
              % ("PASS" if ok else "FAIL", name, neg_ok, pos["tripped"], pos["matched"],
                 pos.get("elapsed"), pos["fault"], note))
        return ok

    def summary(self, title):
        print("\n=== %s ===" % title)
        for name, ok, note in self.rows:
            print("  %-13s %s %s" % (name, "PASS" if ok else "FAIL", note))
        self.rows = []
