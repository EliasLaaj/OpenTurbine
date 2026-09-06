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


def _decode_compact_telemetry(frame, previous=None):
    """Expand the firmware's compact v2 frame into the public telemetry names.

    Keep this in step with ``decodeCompactTelemetry`` in ``data_src/app.js`` so
    the physical HIL runner exercises the same 3 Hz transport as the browser.
    """
    if not isinstance(frame, dict) or frame.get("cv") != 2 or not isinstance(frame.get("v"), list):
        return frame
    v = frame["v"]
    if len(v) < 73:
        raise RuntimeError("compact telemetry v2 value array is truncated")

    def bit(mask, index):
        return bool((int(mask or 0) >> index) & 1)

    out = {
        "snapshot_id": frame.get("s"),
        "mode": ("STANDBY", "STARTUP", "RUNNING", "SHUTDOWN", "FAULT")[int(frame.get("m", 255))]
                if 0 <= int(frame.get("m", 255)) < 5 else "UNKNOWN",
        "n1": v[0], "n2": v[1], "n1_rpm_accel": v[2], "n2_rpm_accel": v[3],
        "tot": v[4], "tit": v[5], "oil": v[6] / 100.0,
        "p1": v[7] / 100.0, "p2": v[8] / 100.0,
        "fuel_press": v[9] / 100.0, "fuel_flow": v[10] / 10.0,
        "oil_temp": v[11], "batt_voltage": v[12] / 10.0,
        "torque": v[13] / 10.0, "thrust": v[14] / 10.0,
        "throttle_input_raw": v[15], "idle_input_raw": v[16],
        "throttle_input_us": v[15], "idle_input_us": v[16],
        "throttle_input_norm": v[17] / 1000.0, "rc_throttle_norm": v[18] / 1000.0,
        "throttle_demand": v[19] / 1000.0, "throttle_effective": v[20] / 1000.0,
        "oil_pct": v[21] / 10.0, "oil_demand": v[22] / 100.0,
        "prop_pitch_demand": v[23] / 1000.0, "ab_fuel_offset": v[24] / 1000.0,
        "starter_demand": v[25] / 1000.0, "ab_pump_demand": v[26] / 1000.0,
        "fuel_pump2_demand": v[27] / 1000.0, "glow_plug_pct": v[28] / 10.0,
        "wet_glow_fuel_pct": v[29] / 10.0, "cool_fan_demand": v[30] / 1000.0,
        "oil_scavenge_demand": v[31] / 1000.0, "bleed_valve_demand": v[32] / 1000.0,
        "glow_current_amps": v[33] / 10.0, "igniter_current_amps": v[34] / 10.0,
        "igniter2_current_amps": v[35] / 10.0, "oil_pump_current_amps": v[36] / 10.0,
        "max_n1": v[37], "max_n2": v[38], "max_tot": v[39], "max_tit": v[40],
        "max_p1": v[41] / 100.0, "max_p2": v[42] / 100.0,
        "max_oil_temp": v[43], "max_batt_voltage": v[44] / 10.0,
        "max_fuel_press": v[45] / 100.0, "tot_rise_rate": v[46], "egt_rise_rate": v[46],
        "turbo_power_w": v[47], "extra_cooldown_remaining_s": v[48],
        "relight_attempts": v[49], "flame_raw": v[50], "oil_raw": v[51],
        "p1_raw": v[52], "p2_raw": v[53], "fuel_press_raw": v[54],
        "oil_temp_raw": v[55], "batt_voltage_raw": v[56], "torque_raw": v[57],
        "thrust_raw": v[58], "fuel_flow_raw": v[59], "glow_current_raw": v[60],
        "igniter_current_raw": v[61], "igniter2_current_raw": v[62],
        "oil_pump_current_raw": v[63], "last_run_flame_avg": v[64] / 10.0,
        "last_run_flame_samples": v[65], "min_oil": v[66] / 100.0 if v[66] >= 0 else None,
        "total_run_seconds": v[67], "run_count": v[68], "start_attempt_count": v[69],
        "ab_seq_block_idx": v[70], "ab_seq_block_total": v[71], "ab_flame_raw": v[72],
        "ri_on": frame.get("io"), "ri_ok": frame.get("ih"),
        "ro_on": frame.get("oo"), "di_on": frame.get("di"),
        "uptime_s": frame.get("u"), "boot_count": frame.get("bc"),
        "reset_reason": frame.get("rr"), "session_dropped_rows": frame.get("lg"),
        "session_queued_rows": frame.get("lq"), "session_logger_error": frame.get("lc"),
        "_text_revision": frame.get("tr"),
    }
    ab_modes = ("Off", "Arming", "Igniting", "Running", "ShuttingDown", "Fault")
    ab_index = int(frame.get("am", 0))
    out["ab_mode"] = ab_modes[ab_index] if 0 <= ab_index < len(ab_modes) else "Off"
    if isinstance(frame.get("sq"), list) and len(frame["sq"]) >= 2:
        out["seq_block_idx"], out["seq_block_total"] = frame["sq"][:2]

    names = (
        "fault_latched", "dry_oil_stop_active", "fault_clear_allowed", "n1_healthy",
        "n2_healthy", "tot_healthy", "tit_healthy", "oil_healthy", "p1_healthy", "p2_healthy",
        "fuel_press_healthy", "fuel_flow_healthy", "oil_temp_healthy", "batt_healthy",
        "torque_healthy", "thrust_healthy", "flame_healthy", "flame", "starter_enabled",
        "fuel_sol_open", "igniter_on", "igniter2_on", "stop_switch_active", "start_switch_active",
        "start_switch_healthy", "start_switch_ready", "limp_mode", "dynamic_idle_enabled",
        "manual_relight_active", "oil_failsafe_active", "standby_oil_feed_active", "surge_detected",
    )
    names2 = (
        "dev_mode", "bench_mode", "relight_armed", "extra_cooldown_active", "ab_trigger_active",
        "ab_flame_on", "ab_flame_healthy", "ab_permitted", "ab_execution_active", "ab_sol_open",
        "glow_plug_hot", "glow_current_healthy", "igniter_current_healthy",
        "igniter2_current_healthy", "oil_pump_current_healthy", "oil_pump_overcurrent",
        "oil_flow_warning", "airstarter_open", "main_fuel_protection_active",
        "config_version_mismatch", "throttle_input_valid", "idle_input_valid", "rc_throttle_valid",
        "rc_idle_valid", "ab_arm_switch_on", "config_storage_fault", "hardware_ready", "watchdog_ready",
        "recovery_lockout", "session_logger_healthy", "session_capture_active", "limited_start_allowed",
    )
    out.update((name, bit(frame.get("f"), index)) for index, name in enumerate(names))
    out.update((name, bit(frame.get("g"), index)) for index, name in enumerate(names2))
    out["cool_fan_on"] = v[30] >= 50
    out["oil_scavenge_on"] = v[31] >= 50
    out["bleed_valve_open"] = v[32] >= 50

    previous = previous or {}
    prior_inputs = previous.get("registry_inputs") or []
    prior_outputs = previous.get("registry_outputs") or []
    if isinstance(frame.get("iv"), list):
        out["registry_inputs"] = [
            {"id": prior_inputs[i].get("id", str(i)) if i < len(prior_inputs) else str(i),
             "value": value,
             "raw": frame.get("ir", [None] * len(frame["iv"]))[i],
             "healthy": bit(frame.get("ih"), i)}
            for i, value in enumerate(frame["iv"])
        ]
    if isinstance(frame.get("ov"), list):
        out["registry_outputs"] = [
            {"id": prior_outputs[i].get("id", str(i)) if i < len(prior_outputs) else str(i),
             "demand": value / 1000.0,
             "current_amps": (frame.get("oc") or [None] * len(frame["ov"]))[i] / 10.0,
             "current_healthy": bit(frame.get("oh"), i)}
            for i, value in enumerate(frame["ov"])
        ]
    return out


class DUT:
    def __init__(self, base=None, timeout=8.0):
        base = base or os.environ.get("OTBENCH_DUT", "http://192.168.4.1")
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.wifi_profile = os.environ.get("OTBENCH_WIFI_PROFILE", "OpenTurbine")
        self._data_base = None
        self._text_revision = None
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

        telemetry = _decode_compact_telemetry(self._get("/api/telemetry"), self._data_base)
        old_boot = self._data_base.get("boot_count")
        new_boot = telemetry.get("boot_count")
        if old_boot is not None and new_boot is None:
            raise RuntimeError("compact telemetry omitted boot_count")
        if old_boot is not None and new_boot is not None and old_boot != new_boot:
            self._data_base = self._get("/api/data")
            return dict(self._data_base)

        # Compact telemetry rotates optional groups. Preserve each received
        # group in the cached complete snapshot so a later frame that omits a
        # field does not make the harness fall back to its boot-time value.
        # This mirrors the browser's persistent telemetry model.
        self._data_base.update(telemetry)
        text_revision = telemetry.get("_text_revision")
        if text_revision is not None and text_revision != self._text_revision:
            self._data_base.update(self._get("/api/telemetry_text"))
            self._text_revision = text_revision
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
