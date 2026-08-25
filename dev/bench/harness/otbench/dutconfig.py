"""DUT reconfiguration helpers for the validation campaign.

Hardware changes (POST /api/hardware) reboot the DUT (~15 s incl. WiFi
reconnect). Config changes (PATCH /api/config) apply live. CRITICAL: every
change is VERIFIED by re-reading it back and retried if it didn't stick — a
config that silently fails to apply otherwise produces false test results.
"""

import os
import time


def _nested_matches(cfg, partial):
    for k, v in partial.items():
        if isinstance(v, dict):
            if not isinstance(cfg.get(k), dict) or not _nested_matches(cfg[k], v):
                return False
        elif isinstance(v, float) or isinstance(cfg.get(k), float):
            cur = cfg.get(k)
            # A missing/null key is NOT a match — otherwise verifying a patch to
            # 0.0 (e.g. disarming a rate limit) against a config that never had
            # the key would falsely report the change as applied.
            if cur is None:
                return False
            if abs(float(cur) - float(v)) > 1e-4:
                return False
        elif cfg.get(k) != v:
            return False
    return True


def _nested_mismatches(cfg, partial, prefix=""):
    """Return concise leaf-level differences for a failed config verification."""
    differences = []
    for key, expected in partial.items():
        path = f"{prefix}.{key}" if prefix else key
        actual = cfg.get(key) if isinstance(cfg, dict) else None
        if isinstance(expected, dict):
            if not isinstance(actual, dict):
                differences.append(f"{path}: expected object, got {actual!r}")
            else:
                differences.extend(_nested_mismatches(actual, expected, path))
        elif isinstance(expected, float) or isinstance(actual, float):
            try:
                if actual is None or abs(float(actual) - float(expected)) > 1e-4:
                    differences.append(f"{path}: expected {expected!r}, got {actual!r}")
            except (TypeError, ValueError):
                differences.append(f"{path}: expected {expected!r}, got {actual!r}")
        elif actual != expected:
            differences.append(f"{path}: expected {expected!r}, got {actual!r}")
    return differences


class DutConfig:
    def __init__(self, dut):
        self.dut = dut
        # Campaign runners may install a recorder here so every direct config
        # patch participates in exact post-test restoration. Keeping this at
        # the low-level helper prevents individual campaigns from silently
        # forgetting to register one of their temporary settings changes.
        self.before_patch = None

    # ── low level ────────────────────────────────────────────
    def hw(self):
        return self.dut.hardware()

    def cfg(self):
        return self.dut.config()

    def _wait_reboot(self, previous_boot_count=None):
        # A hardware POST answers 200 and then schedules the reboot ~5 s LATER,
        # so /api/status keeps answering the PRE-reboot state for several seconds
        # before the ESP32 actually restarts. The old "wait for one failed poll
        # then one success" heuristic could therefore return before the reboot
        # (catching the pre-reboot config) and falsely report a change as applied.
        #
        # Confirm a REAL reboot by requiring the AP to be unreachable for a
        # SUSTAINED period (the restart drops the WiFi AP for several seconds; a
        # transient glitch is sub-second), then wait for it to come back and
        # settle. Returns True only if the outage was observed, so a POST that
        # silently failed to reboot is reported as unverified (edit_hw retries)
        # rather than passing on stale, pre-reboot config.
        REQUIRED_DOWN = 3            # consecutive failed polls = a real outage
        deadline = time.time() + 90.0
        down = 0
        saw_outage = False
        # Phase 1: wait for the sustained outage (the reboot dropping the AP).
        while time.time() < deadline:
            try:
                self.dut.status()
                if previous_boot_count is not None:
                    current = self.dut.data().get("boot_count")
                    if current is not None and int(current) != int(previous_boot_count):
                        time.sleep(2.0)
                        self.dut._data_base = None
                        return True
                down = 0
            except Exception:
                down += 1
                if down >= REQUIRED_DOWN:
                    saw_outage = True
                    break
            time.sleep(0.5)
        # Phase 2: wait for the AP to return, then settle so the reboot-pending
        # preflight flag has cleared before the caller re-reads config.
        while time.time() < deadline:
            try:
                self.dut.status()
                time.sleep(2.0)
                # /api/telemetry intentionally omits static registry and DI
                # topology. A hardware reboot invalidates the DUT helper's
                # merged /api/data base even when the process object survives.
                self.dut._data_base = None
                return saw_outage
            except Exception:
                time.sleep(1.0)
        return False

    def edit_hw(self, mutate, check=None, tries=3):
        """GET hardware, apply mutate(hw), POST (reboots), wait, then VERIFY via
        check(hw)->bool. Retries the whole cycle if the change didn't stick."""
        resp = None
        for _ in range(tries):
            hw = self.dut.hardware()
            # GET /api/hardware is a large streamed response on Classic.  A
            # browser user naturally spends time editing before Save; give
            # AsyncTCP one bounded quiet window to release that response too,
            # instead of making the HIL client manufacture peak fragmentation
            # by POSTing the document in the next scheduler tick.
            if os.environ.get("OTBENCH_TARGET", "s3").strip().lower() == "classic":
                time.sleep(3.0)
            try:
                previous_boot_count = self.dut.data().get("boot_count")
            except Exception:
                previous_boot_count = None
            mutate(hw)
            code, resp = self.dut._post("/api/hardware", hw)
            if code != 200:
                # If validation rollback itself could not be staged, firmware
                # fails safe and schedules a reboot.  Do not race that reboot
                # with another large request; confirm recovery before retrying.
                if isinstance(resp, dict) and resp.get("rebooting"):
                    self._wait_reboot(previous_boot_count)
                else:
                    time.sleep(2)
                continue
            self._wait_reboot(previous_boot_count)
            if check is None or check(self.dut.hardware()):
                return True, resp
        return False, resp

    def patch_cfg(self, partial, verify=True, tries=4):
        """PATCH a partial (nested) config — applies live — and verify it stuck."""
        code = resp = None
        if callable(self.before_patch):
            self.before_patch(partial)
        for _ in range(tries):
            code, resp = self.dut.patch("/api/config", partial)
            if code != 200:
                time.sleep(1); continue
            if not verify:
                # The API has persisted the generation but deliberately frees
                # its HTTP buffers before ECU-core apply. Give that bounded
                # transaction a quiet window before issuing dependent calls.
                self._wait_config_apply()
                return True, resp
            # Firmware releases the HTTP buffers before copying the complete
            # settings generation on the ECU core. Verify that short bounded
            # transaction instead of racing it with an immediate duplicate.
            time.sleep(0.6)
            deadline = time.time() + 4.0
            while time.time() < deadline:
                try:
                    if _nested_matches(self.dut.config(), partial):
                        if self._wait_config_apply():
                            return True, resp
                except Exception:
                    pass
                time.sleep(0.2)
        try:
            differences = _nested_mismatches(self.dut.config(), partial)
            if differences:
                print("Config verification mismatch: " + "; ".join(differences[:12]), flush=True)
        except Exception as error:
            print(f"Config verification diagnostic failed: {error}", flush=True)
        return False, resp

    def _wait_config_apply(self, timeout=8.0):
        """Wait until the persisted generation has left the cross-core gate."""
        if os.environ.get("OTBENCH_TARGET", "s3").strip().lower() == "classic":
            # Do not keep allocating HTTP request headers while the Classic is
            # deliberately trying to recover one large contiguous heap block.
            time.sleep(3.0)
            try:
                return not self.dut.status().get("config_apply_busy", False)
            except Exception:
                return False
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                status = self.dut.status()
                if not status.get("config_apply_busy", False):
                    return True
            except Exception:
                pass
            time.sleep(0.15)
        return False

    # ── verified hardware helpers ────────────────────────────
    def sensor(self, name, **fields):
        return self.edit_hw(lambda hw: hw["sensors"][name].update(fields),
                            check=lambda hw: all(hw["sensors"][name].get(k) == v for k, v in fields.items()))

    def actuator(self, name, **fields):
        return self.edit_hw(lambda hw: hw["actuators"][name].update(fields),
                            check=lambda hw: all(hw["actuators"][name].get(k) == v for k, v in fields.items()))

    def set_safety(self, **flags):
        return self.edit_hw(lambda hw: hw["safety"].update(flags),
                            check=lambda hw: all(hw["safety"].get(k) == v for k, v in flags.items()))

    def set_controllers(self, **flags):
        return self.edit_hw(lambda hw: hw["controllers"].update(flags),
                            check=lambda hw: all(hw["controllers"].get(k) == v for k, v in flags.items()))

    def only_safety(self, *on):
        """Arm exactly the named safeties, disarm all others. Verified."""
        def m(hw):
            for k in hw["safety"]:
                hw["safety"][k] = k in on
        return self.edit_hw(m, check=lambda hw: all((hw["safety"][k] is (k in on)) for k in hw["safety"]))

    def set_sequence(self, startup=None, startup_delays=None, shutdown=None, shutdown_delays=None):
        def m(hw):
            if startup is not None: hw["startup_seq"] = startup
            if startup_delays is not None: hw["startup_delay_ms"] = startup_delays
            if shutdown is not None: hw["shutdown_seq"] = shutdown
            if shutdown_delays is not None: hw["shutdown_delay_ms"] = shutdown_delays
        return self.edit_hw(m)

    def multi(self, mutate, check=None):
        return self.edit_hw(mutate, check=check)

    def fast_cooldown(self):
        def m(hw):
            hw["shutdown_delay_ms"] = [800 if d and d > 800 else d for d in hw.get("shutdown_delay_ms", [])]
        return self.edit_hw(m)

    # ── snapshot / restore ───────────────────────────────────
    def snapshot(self):
        return self.dut.hardware()

    def restore(self, snap, tries=3):
        resp = None
        for _ in range(tries):
            try:
                previous_boot_count = self.dut.data().get("boot_count")
            except Exception:
                previous_boot_count = None
            if os.environ.get("OTBENCH_TARGET", "s3").strip().lower() == "classic":
                time.sleep(3.0)
            code, resp = self.dut._post("/api/hardware", snap)
            if code == 200:
                if self._wait_reboot(previous_boot_count):
                    return True, resp
                resp = {"ok": False, "error": "hardware restore reboot was not verified"}
                continue
            if isinstance(resp, dict) and resp.get("rebooting"):
                self._wait_reboot(previous_boot_count)
            else:
                time.sleep(2.0)
        return False, resp
