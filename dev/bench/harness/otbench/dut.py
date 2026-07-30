"""HTTP client for the OpenTurbine DUT (ESP32-S3) web API.

Uses only the Python standard library. Telemetry is read by polling
/api/data, which carries the full EngineData snapshot (mode, sensor values,
actuator demands, sequence progress, health flags, bench/dev mode, ...).
"""

import http.client
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request


class DUT:
    def __init__(self, base="http://192.168.4.1", timeout=4.0):
        self.base = base.rstrip("/")
        self.timeout = timeout

    def _reconnect_wifi(self):
        if os.name != "nt":
            return
        try:
            subprocess.run(
                ["netsh", "wlan", "connect", "name=OpenTurbine", "ssid=OpenTurbine", "interface=Wi-Fi"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=8,
                check=False,
            )
            time.sleep(2.0)
        except Exception:
            pass

    # ── low-level ────────────────────────────────────────────
    def _open_retry(self, req, tries=4):
        """urlopen with retries on transient transport errors (the AP drops the
        odd request during mode transitions / WiFi contention). A real HTTP
        response (4xx/5xx) is normally re-raised. The ECU's bounded shared
        JSON buffer can briefly return a retryable busy response while the
        previous frame drains, so retry only those explicit cases."""
        last = None
        for i in range(tries):
            try:
                return urllib.request.urlopen(req, timeout=self.timeout)
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                retryable = e.code in (409, 503) and (
                    "configuration transfer is in progress" in body
                    or "ECU is busy" in body
                )
                if not retryable or i + 1 >= tries:
                    raise
                last = e
                time.sleep(0.35)
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as e:
                last = e
                if i >= 1:
                    self._reconnect_wifi()
                else:
                    time.sleep(0.4)
        raise last

    def _get(self, path):
        # WiFi can truncate a large /api/data body mid-stream, yielding invalid
        # JSON. Retry a couple of times before giving up so one glitch doesn't
        # abort a whole test run.
        req = urllib.request.Request(self.base + path, method="GET")
        last = None
        for _ in range(3):
            try:
                with self._open_retry(req) as r:
                    body = r.read().decode("utf-8")
                return json.loads(body)
            except (http.client.IncompleteRead, json.JSONDecodeError) as e:
                last = e
                time.sleep(0.3)
        raise last

    def _body(self, path, obj, method):
        # The ECU intentionally uses a fixed receive buffer. Whitespace in the
        # default JSON encoding can push a valid, fully fitted hardware map
        # over that limit even though its compact representation fits.
        data = json.dumps(obj, separators=(",", ":")).encode("utf-8") if obj is not None else b""
        headers = {"Content-Type": "application/json"} if obj is not None else {}
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self._open_retry(req) as r:
                body = r.read().decode("utf-8")
                if not body:
                    return r.status, {}
                try:
                    parsed = json.loads(body)
                except json.JSONDecodeError:
                    # The request already received a successful HTTP status and
                    # may have changed ECU state (START, toggle, config apply).
                    # Retrying a non-idempotent command could undo or duplicate
                    # it. Preserve the success status and let callers verify
                    # state through the normal GET path instead.
                    parsed = {"ok": True, "transport_warning": "non-JSON success body"}
                return r.status, parsed
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = {"error": body}
            return e.code, parsed

    def _post(self, path, obj=None):
        return self._body(path, obj, "POST")

    def patch(self, path, obj):
        return self._body(path, obj, "PATCH")

    # ── endpoints ────────────────────────────────────────────
    def data(self):
        return self._get("/api/data")

    def status(self):
        return self._get("/api/status")

    def hardware(self):
        return self._get("/api/hardware")

    def config(self):
        return self._get("/api/config")

    def command(self, cmd, fParam=0.0, iParam=0):
        return self._post("/api/command", {"cmd": cmd, "fParam": fParam, "iParam": iParam})

    def start(self):
        return self._post("/api/start")

    def stop(self):
        return self._post("/api/stop")

    # ── convenience ──────────────────────────────────────────
    def mode(self):
        return self.data().get("mode")

    def ping(self):
        """Return (ok, detail)."""
        try:
            s = self.status()
            return True, s
        except Exception as e:  # noqa: BLE001 — surface any transport error
            return False, str(e)

    def poll_until(self, predicate, timeout=5.0, interval=0.15):
        """Poll /api/data until predicate(data) is truthy or timeout.
        Transient transport or JSON failures are treated as a missed sample;
        the caller's full timeout remains authoritative. Returns
        (ok, last_successful_data)."""
        deadline = time.time() + timeout
        last = {}
        while time.time() < deadline:
            try:
                last = self.data()
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError,
                    json.JSONDecodeError):
                time.sleep(interval)
                continue
            if predicate(last):
                return True, last
            time.sleep(interval)
        return False, last

    def ensure_mode_standby(self, timeout=25.0):
        """Best-effort return to STANDBY: issue STOP if the engine is active.
        Timeout covers the shutdown cooldown block (~15 s by default)."""
        d = self.data()
        if d.get("mode") in ("STARTUP", "RUNNING", "SHUTDOWN"):
            self.stop()
            ok, d = self.poll_until(lambda x: x.get("mode") == "STANDBY", timeout=timeout)
            return ok, d
        return d.get("mode") == "STANDBY", d

    def _ensure_toggle(self, key, cmd, want, settle=0.4):
        """Toggle a boolean EngineData flag (dev_mode / bench_mode) to `want`.
        These toggles are STANDBY-only in the firmware. A hardware reboot may
        make HTTP reachable just before its configuration gate has settled, so
        retry a transiently rejected toggle instead of reporting a false HIL
        failure."""
        deadline = time.time() + 6.0
        while time.time() < deadline:
            d = self.data()
            if bool(d.get(key)) == bool(want):
                return True
            code, _ = self.command(cmd)
            time.sleep(settle if code == 200 else 0.6)
        return bool(self.data().get(key)) == bool(want)

    def ensure_dev_mode(self, want=True):
        return self._ensure_toggle("dev_mode", "TOGGLE_DEV_MODE", want)

    def ensure_bench_mode(self, want=True):
        return self._ensure_toggle("bench_mode", "TOGGLE_BENCH_MODE", want)
