"""HTTP client for the OpenTurbine DUT (ESP32-S3) web API.

Uses only the Python standard library. A full /api/data snapshot seeds static
fields, then the compact /api/telemetry endpoint supplies live values. This
matches the real UI and avoids repeatedly allocating and transferring the
largest ECU JSON document during long HIL campaigns.
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
    def __init__(self, base=None, timeout=8.0):
        base = base or os.environ.get("OTBENCH_DUT", "http://192.168.4.1")
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.wifi_profile = os.environ.get("OTBENCH_WIFI_PROFILE", "OpenTurbine")
        self._data_base = None
        self._last_wifi_reconnect = 0.0

    def _reconnect_wifi(self, force=False):
        if os.name != "nt":
            return
        # A netsh connect issued while Windows is already associating tears
        # down that attempt and starts over. Throttle recovery requests so API
        # retry loops cannot keep the adapter permanently disconnected.
        now = time.monotonic()
        if not force and now - self._last_wifi_reconnect < 5.0:
            return
        connected_to_dut = False
        try:
            state = subprocess.run(
                ["netsh", "wlan", "show", "interfaces"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=5,
                check=False,
            ).stdout
            addresses = subprocess.run(
                ["ipconfig"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=5,
                check=False,
            ).stdout
            # PCB profiles may use their own AP name. The 192.168.4.x lease,
            # not a hard-coded SSID, identifies a healthy DUT connection.
            connected_to_dut = (
                "State" in state and "connected" in state and
                "192.168.4." in addresses
            )
            # Association alone is not enough: Windows can remain associated
            # after losing the ECU DHCP lease and fall back to 169.254/16.
            if connected_to_dut and "192.168.4." in addresses:
                return
            # Do not restart an association that Windows already has underway.
            if "connecting" in state or "disconnecting" in state:
                return
        except Exception:
            pass
        self._last_wifi_reconnect = now
        try:
            if connected_to_dut:
                subprocess.run(
                    ["netsh", "wlan", "disconnect", "interface=Wi-Fi"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                    check=False,
                )
                time.sleep(0.5)
            subprocess.run(
                ["netsh", "wlan", "connect",
                 "name=" + self.wifi_profile,
                 "ssid=" + self.wifi_profile,
                 "interface=Wi-Fi"],
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
                    # HTTPError is also the response stream. Preserve the body
                    # before re-raising; otherwise _body() sees an exhausted
                    # stream and hides the ECU's useful validation reason.
                    e.otbench_body = body
                    raise
                last = e
                time.sleep(0.35)
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as e:
                last = e
                # This is a no-op for a healthy 192.168.4.x association, but
                # repairs a disconnected or APIPA-stuck Windows client.
                self._reconnect_wifi()
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
            except (http.client.IncompleteRead, json.JSONDecodeError,
                    socket.timeout, TimeoutError, urllib.error.URLError,
                    ConnectionError) as e:
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
            body = getattr(e, "otbench_body", None)
            if body is None:
                body = e.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = {"error": body}
            return e.code, parsed

    def _post(self, path, obj=None):
        result = self._body(path, obj, "POST")
        if 200 <= result[0] < 300 and path in self._configuration_paths():
            self._data_base = None
        return result

    def patch(self, path, obj):
        result = self._body(path, obj, "PATCH")
        if 200 <= result[0] < 300 and path in self._configuration_paths():
            self._data_base = None
        return result

    @staticmethod
    def _configuration_paths():
        return {"/api/config", "/api/hardware", "/api/ecu_config"}

    # ── endpoints ────────────────────────────────────────────
    def data(self):
        if self._data_base is None:
            self._data_base = self._get("/api/data")
            return dict(self._data_base)

        telemetry = self._get("/api/telemetry")
        old_boot = self._data_base.get("boot_count")
        new_boot = telemetry.get("boot_count")
        if old_boot is not None and new_boot is not None and old_boot != new_boot:
            self._data_base = self._get("/api/data")
            return dict(self._data_base)

        # Compact telemetry rotates optional groups. Preserve each received
        # group in the cached complete snapshot so a later frame that omits a
        # field does not make the harness fall back to its boot-time value.
        # This mirrors the browser's persistent telemetry model.
        self._data_base.update(telemetry)
        return dict(self._data_base)

    def full_data(self):
        """Fetch a fresh complete snapshot for fields not carried every compact frame."""
        self._data_base = self._get("/api/data")
        return dict(self._data_base)

    def status(self):
        return self._get("/api/status")

    def device_info(self):
        """Return the small, allocation-light device identity document."""
        return self._get("/api/device_info")

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

    def clear_fault(self):
        """Acknowledge a latched run fault after its stimulus and outputs are safe."""
        return self.command("CLEAR_FAULT")

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
        """Poll compact live telemetry until predicate(data) is truthy or timeout.
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
        if d.get("mode") == "FAULT" and d.get("fault_latched"):
            code, _ = self.clear_fault()
            if code == 200:
                return self.poll_until(lambda x: x.get("mode") == "STANDBY", timeout=min(timeout, 8.0))
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
            if code == 200:
                # The HTTP response confirms queueing, not execution. Poll the
                # requested state before sending another toggle; otherwise two
                # delayed commands can cancel one another on a busy Classic/S3.
                apply_deadline = min(deadline, time.time() + 2.0)
                while time.time() < apply_deadline:
                    time.sleep(0.1)
                    if bool(self.data().get(key)) == bool(want):
                        return True
            else:
                time.sleep(0.6)
        return bool(self.data().get(key)) == bool(want)

    def ensure_dev_mode(self, want=True):
        return self._ensure_toggle("dev_mode", "TOGGLE_DEV_MODE", want)

    def ensure_bench_mode(self, want=True):
        return self._ensure_toggle("bench_mode", "TOGGLE_BENCH_MODE", want)
