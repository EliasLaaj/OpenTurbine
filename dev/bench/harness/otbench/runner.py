"""Minimal test framework for the bench suite.

A test is a function `t_name(ctx, check)`:
  - use `check.expect(cond, msg)` for assertions
  - use `check.info(msg)` for context
  - raise SkipTest("reason") to skip (e.g. a feature not fitted on the DUT)
"""

import time
import traceback


class SkipTest(Exception):
    pass


class Check:
    def __init__(self):
        self.entries = []      # list of (level, msg): level in PASS/FAIL/INFO
        self.ok = True

    def expect(self, cond, msg):
        self.entries.append(("PASS" if cond else "FAIL", msg))
        if not cond:
            self.ok = False
        return bool(cond)

    def info(self, msg):
        self.entries.append(("INFO", msg))


class Result:
    def __init__(self, name):
        self.name = name
        self.status = "pass"      # pass | fail | skip | error
        self.entries = []
        self.error = None
        self.skip_reason = None
        self.duration = 0.0

    def to_dict(self):
        return {
            "name": self.name,
            "status": self.status,
            "duration_s": round(self.duration, 3),
            "skip_reason": self.skip_reason,
            "error": self.error,
            "checks": [{"level": lvl, "msg": m} for lvl, m in self.entries],
        }


class Ctx:
    """Shared context handed to every test."""
    def __init__(self, dut, tester, pinmap, opts=None):
        self.dut = dut
        self.tester = tester
        self.pinmap = pinmap
        self.opts = opts or {}


def run_tests(tests, ctx, only=None):
    results = []
    for t in tests:
        name = t.__name__
        if only and name not in only:
            continue
        r = Result(name)
        c = Check()
        t0 = time.time()
        try:
            t(ctx, c)
            r.status = "pass" if c.ok else "fail"
        except SkipTest as e:
            r.status = "skip"
            r.skip_reason = str(e)
        except Exception:  # noqa: BLE001 — a crashing test is an error, not a pass
            r.status = "error"
            r.error = traceback.format_exc()
        r.entries = c.entries
        r.duration = time.time() - t0
        results.append(r)
    return results


# ── reporting ────────────────────────────────────────────────
_ICON = {"pass": "PASS", "fail": "FAIL", "skip": "SKIP", "error": "ERR "}


def print_report(results, verbose=False, require_all=False):
    print()
    for r in results:
        print("[%s] %s  (%.2fs)" % (_ICON.get(r.status, "?"), r.name, r.duration))
        if r.status == "skip" and r.skip_reason:
            print("       skipped: %s" % r.skip_reason)
        show = verbose or r.status in ("fail", "error")
        if show:
            for lvl, msg in r.entries:
                if lvl == "INFO" and not verbose:
                    continue
                print("       %-4s %s" % (lvl, msg))
            if r.error:
                for ln in r.error.rstrip().splitlines():
                    print("       | " + ln)
    p = sum(1 for r in results if r.status == "pass")
    f = sum(1 for r in results if r.status == "fail")
    s = sum(1 for r in results if r.status == "skip")
    e = sum(1 for r in results if r.status == "error")
    print("\n%d passed, %d failed, %d skipped, %d errored (%d total)"
          % (p, f, s, e, len(results)))
    if s:
        # Skips are legitimate (feature not fitted) so they don't fail the run,
        # but an untested path must not be mistaken for a verified one — flag it
        # loudly so a green exit code isn't read as "everything was exercised".
        print("WARNING: %d test(s) SKIPPED (prerequisite/hardware not fitted) — "
              "those paths were NOT exercised; review before trusting a pass." % s)
    return f == 0 and e == 0 and (not require_all or s == 0)
