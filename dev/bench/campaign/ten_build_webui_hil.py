"""Ten live web-UI/API hardware builds against the S3 + OTBench rig.

This is intentionally end-to-end:
  - writes hardware through the same /api/hardware save path used by Hardware
  - writes settings/calibrations through /api/config and /api/hardware PATCH
  - drives physical tester inputs
  - checks physical tester output captures
  - runs a short bench-mode startup on every build

The tester is only used over its serial protocol. This script never flashes it.
"""

from __future__ import annotations

import copy
import json
import os
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "harness"))

from otbench.benchrig import BenchRig, hz  # noqa: E402


ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
RESULT_DIR = os.path.join(ROOT, "dev", "bench", "results")
BASE = os.environ.get("OTBENCH_DUT", "http://192.168.4.1").rstrip("/")


TOOLS_FAST = {
    "fuel_prime_ms": 1500,
    "oil_prime_ms": 1500,
    "ign_test_ms": 1500,
    "ign2_test_ms": 1500,
    "glow_test_ms": 1500,
    "glow_test_pct": 100,
    "start_test_ms": 1500,
    "start_test_pct": 45,
    # Keep physical-output pulses long enough to span an HTTP round trip plus a
    # tester capture. These are campaign-only values, not product defaults.
    "fuel_sol_test_ms": 1500,
    "idle_test_ms": 1500,
    "oil_scav_test_ms": 1500,
    "cool_fan_test_ms": 1500,
    "airstarter_test_ms": 1500,
    "bleed_valve_test_ms": 1500,
    "fuel_pump2_test_ms": 1500,
    "fuel_pump2_test_pct": 60,
    "ab_sol_test_ms": 1500,
    "ab_pump_test_ms": 1500,
    "ab_pump_test_pct": 60,
    "starter_en_test_ms": 1500,
    "prop_pitch_test_ms": 1500,
    "prop_pitch_test_pct": 55,
}


def now_id() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def fetch_json(path: str, timeout: float = 6.0):
    last_error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
                body = r.read()
            if not body:
                raise json.JSONDecodeError("empty DUT response", "", 0)
            return json.loads(body)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(0.4)
    raise RuntimeError(f"DUT JSON request failed after retries: {path}") from last_error


def write_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)


def chan_input(id_, name, role, purpose, driver, pin, **kw):
    c = {
        "id": id_,
        "name": name,
        "role": role,
        "purpose": purpose,
        "driver": driver,
        "pin": pin,
        "min": kw.pop("min", 0),
        "max": kw.pop("max", 1 if driver in (0, 3, 7) else 4095),
        "pulses_per_unit": kw.pop("pulses_per_unit", 1),
        "analog_zero_mv": kw.pop("analog_zero_mv", 0),
        "analog_mv_per_unit": kw.pop("analog_mv_per_unit", 1000),
        "analog_divider": kw.pop("analog_divider", 1),
        "temp_interface": kw.pop("temp_interface", 0),
        "spi_clk": kw.pop("spi_clk", -1),
        "spi_cs": kw.pop("spi_cs", -1),
        "spi_miso": kw.pop("spi_miso", -1),
        "spi_mosi": kw.pop("spi_mosi", -1),
        "tc_type": kw.pop("tc_type", "K"),
        "invert": kw.pop("invert", False),
        "active_high": kw.pop("active_high", True),
        "pullup": kw.pop("pullup", False),
        "pulldown": kw.pop("pulldown", False),
    }
    c.update(kw)
    return c


def chan_output(id_, name, role, purpose, driver, pin, **kw):
    c = {
        "id": id_,
        "name": name,
        "role": role,
        "purpose": purpose,
        "driver": driver,
        "pin": pin,
        "min": kw.pop("min", 0),
        "max": kw.pop("max", 1),
        "safe_demand": kw.pop("safe_demand", 0),
        "min_run_demand": kw.pop("min_run_demand", 0),
        "invert": kw.pop("invert", False),
        "active_high": kw.pop("active_high", True),
        "has_current": kw.pop("has_current", False),
        "current_pin": kw.pop("current_pin", -1),
        "current_mv_a": kw.pop("current_mv_a", 100),
        "current_zero_v": kw.pop("current_zero_v", 1.65),
        "current_max_a": kw.pop("current_max_a", 0),
    }
    c.update(kw)
    return c


class TenBuildRunner:
    def __init__(self, port: str = "COM3"):
        self.rig = BenchRig(port=port)
        self.dut = self.rig.dut
        self.dc = self.rig.dcfg
        self.t = self.rig.t
        # Windows may drop a manually connected open-network association while
        # the previous campaign is quiet. Recover that client-side condition
        # before taking the authoritative snapshot; ordinary API retries must
        # not spend minutes probing an interface with no 192.168.4.x address.
        try:
            self.dut.status()
        except Exception:
            self.dut._reconnect_wifi()
            time.sleep(4.0)
        self.firmware_before = self.dut.data().get("fw_version", "unknown")
        self.firmware_after = None
        self.restored = False
        self.original_hw = self.dut.hardware()
        self.original_cfg = self.dut.config()
        self._restore_config_patch = {}
        self.dc.before_patch = self.note_config_patch
        self.base_profile_id = self.original_hw.get("profile_id", "OpenTurbine")
        self.base_profile_desc = self.original_hw.get("profile_desc", "")
        self.base_wifi_password = self.original_hw.get("wifi_password", "")
        self.base_wifi_tx_power = self.original_hw.get("wifi_tx_power_dbm", 8)
        self.run_id = now_id()
        self.backup_path = os.path.join(RESULT_DIR, f"ten_build_backup_{self.run_id}.json")
        self.result_path = os.path.join(RESULT_DIR, f"ten_build_webui_hil_{self.run_id}.json")
        self.results = []
        write_json(self.backup_path, {"hardware": self.original_hw, "config": self.original_cfg})

    def note_config_patch(self, changes) -> None:
        """Remember only original leaves a campaign is about to modify.

        Replaying an entire settings document is both unnecessary and costly on
        Classic ESP32. A narrow restore also avoids reintroducing fields that a
        temporary hardware topology correctly sanitized while it was active.
        """
        def capture(original, changed, destination):
            if not isinstance(changed, dict) or not isinstance(original, dict):
                return
            for key, value in changed.items():
                if key not in original:
                    continue
                if isinstance(value, dict) and isinstance(original[key], dict):
                    child = destination.setdefault(key, {})
                    capture(original[key], value, child)
                    if not child:
                        destination.pop(key, None)
                else:
                    destination[key] = copy.deepcopy(original[key])

        capture(self.original_cfg, changes, self._restore_config_patch)

    def log(self, msg: str) -> None:
        print(msg, flush=True)

    def save_progress(self) -> None:
        write_json(self.result_path, {
            "run_id": self.run_id,
            "firmware": self.firmware_before,
            "firmware_after": self.firmware_after,
            "firmware_match": self.firmware_after in (None, self.firmware_before),
            "backup_path": os.path.relpath(self.backup_path, ROOT).replace(os.sep, "/"),
            "results": self.results,
            "restored": self.restored,
        })

    def api_alive(self) -> bool:
        self.reconnect_wifi()
        try:
            self.dut.data()
            return True
        except Exception:
            return False

    def reconnect_wifi(self) -> None:
        # Never issue netsh while the ECU is already reachable: Windows treats
        # that as a user-requested disconnect and tears down a healthy link.
        try:
            with urllib.request.urlopen(BASE + "/api/status", timeout=0.75) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        # Use the client's throttled recovery only after a real failure.
        self.dut._reconnect_wifi()

    def safe_standby(self) -> None:
        reversed_fixture = os.environ.get("OTBENCH_TARGET", "s3").strip().lower() == "classic"
        self.t.set("START", 0)
        self.t.set("STOP", 0)
        self.t.set("N1", 0)
        self.t.set("N2", 0)
        if not reversed_fixture:
            self.t.set("THROTTLE_IN", 0.0)
            self.t.set("OILP", 2.5)
        self.t.set("FLAME", 1)
        self.t.set("IDLE_IN", 1000)
        if not reversed_fixture:
            self.t.set_tot(120)
        self.dut.stop()
        self.dut.ensure_mode_standby(timeout=25)
        d = self.dut.data()
        if d.get("bench_mode"):
            self.dut.command("TOGGLE_BENCH_MODE")
            time.sleep(0.3)
        if d.get("dev_mode"):
            self.dut.command("TOGGLE_DEV_MODE")
            time.sleep(0.3)

    def outputs_idle(self, d) -> bool:
        return not (
            d.get("extra_cooldown_active") or d.get("standby_oil_feed_active") or
            (d.get("throttle_demand", 0) or 0) > 0.001 or
            (d.get("fuel_pump2_demand", 0) or 0) > 0.001 or
            (d.get("oil_pct", 0) or 0) > 0.01 or
            (d.get("starter_demand", 0) or 0) > 0.001 or
            (d.get("ab_pump_demand", 0) or 0) > 0.001 or
            (d.get("prop_pitch_demand", 0) or 0) > 0.001 or
            (d.get("glow_plug_pct", 0) or 0) > 0.001 or
            d.get("fuel_sol_open") or d.get("igniter_on") or d.get("igniter2_on") or
            d.get("starter_enabled") or d.get("cool_fan_on") or d.get("airstarter_open") or
            d.get("oil_scavenge_on") or d.get("bleed_valve_open") or d.get("ab_sol_open")
        )

    def prepare_hardware_save(self) -> None:
        self.safe_standby()
        # Bench profiles can leave a synthetic RPM source above the windmill
        # threshold. Disable standby oil feed and explicitly zero manual output
        # demands so the firmware's hardware-save interlock can clear.
        standby_patch = {"standby_oil": {"rpm_limit": 500000, "feed_pct": 0, "feed_bar": 0}}
        self.note_config_patch(standby_patch)
        self.dc.patch_cfg(standby_patch)
        for cmd in ("SET_THROTTLE_PCT", "SET_OIL_PCT"):
            try:
                self.dut.command(cmd, fParam=0, iParam=0)
            except Exception:
                pass
        try:
            self.dut.command("AB_STOP")
        except Exception:
            pass
        deadline = time.time() + 20
        last = {}
        reconnect_attempted = False
        while time.time() < deadline:
            try:
                last = self.dut.data()
                if self.outputs_idle(last):
                    return
            except Exception as exc:
                # A profile save immediately before this guard may have reset
                # the AP while Windows still shows the old association. Make
                # one bounded client-side reconnect, then keep polling the
                # authoritative ECU state. Do not misreport a transport-only
                # timeout as an unexplained active output set.
                last = {"transport_error": str(exc)}
                if not reconnect_attempted:
                    reconnect_attempted = True
                    try:
                        self.dut._reconnect_wifi()
                    except Exception:
                        pass
            time.sleep(0.5)
        active = {key: last.get(key) for key in (
            "mode", "extra_cooldown_active", "standby_oil_feed_active",
            "throttle_demand", "fuel_pump2_demand", "oil_pct", "starter_demand",
            "ab_pump_demand", "prop_pitch_demand", "glow_plug_pct", "fuel_sol_open",
            "igniter_on", "igniter2_on", "starter_enabled", "cool_fan_on",
            "airstarter_open", "oil_scavenge_on", "bleed_valve_open", "ab_sol_open",
        ) if last.get(key)}
        if last.get("transport_error"):
            active["transport_error"] = last["transport_error"]
        raise RuntimeError(f"outputs did not become idle before hardware save: {active}")

    def patch_fast_config(self) -> None:
        patch = {
            "tools": TOOLS_FAST,
            "throttle": {
                "fuel_pump_min_pct": 10,
                "ramp_up_ms": 0,
                "ramp_down_ms": 0,
            },
            "calibration": {
                "throttle_min_raw": 0,
                "throttle_max_raw": 4095,
                "idle_min_raw": 1000,
                "idle_max_raw": 2000,
                "flame_threshold": 500,
                "oil_poly": {"a": 0, "b": 0, "c": round(10.0 / 4095.0, 8), "d": 0, "x_min": 0, "x_max": 4095},
            },
            "standby_oil": {"rpm_limit": 500000, "feed_pct": 0, "feed_bar": 0},
            "oil": {"startup_min_bar": 0, "startup_pressure": 2.5},
            "oil_advanced": {"zero_bar": 0.1},
            "safety": {"tot_limit": 750, "tit_limit": 750, "fuel_press_min": 0, "batt_volt_min": 9.5},
            "governor": {"target_rpm": 24000, "kp": 0.00003, "pitch_kp": 0.00003},
        }
        self.note_config_patch(patch)
        last = None
        for _ in range(5):
            ok, last = self.dc.patch_cfg(patch, verify=False)
            if ok:
                return
            # The web API can answer just before the post-hardware-save apply
            # task has fully settled. Re-read once, then retry the identical
            # bounded patch rather than misreporting a transient as a DUT bug.
            try:
                self.dut.config()
            except Exception:
                pass
            time.sleep(0.75)
        raise RuntimeError(f"fast config patch failed after retries: {last}")

    def clear_hw(self, hw) -> None:
        # Preserve the identity/Wi-Fi fields so the AP name stays stable while
        # profiles are rebuilt. The profile being tested is recorded only in the
        # result JSON/log, not in the ECU identity fields.
        hw["profile_id"] = self.base_profile_id
        hw["profile_desc"] = self.base_profile_desc
        hw["wifi_password"] = self.base_wifi_password
        hw["wifi_tx_power_dbm"] = self.base_wifi_tx_power
        hw["platform"] = "esp32s3"
        hw["has_two_shaft"] = False
        hw["has_afterburner"] = False
        hw["controls"].update({
            "stop_pin": 15,
            "start_pin": 13,
            "stop_active_h": False,
            "start_active_h": False,
            "stop_pullup": True,
            "start_pullup": True,
            "stop_pulldown": False,
            "start_pulldown": False,
            "stop_active_low": True,
            "start_active_low": True,
        })
        for s in hw.get("sensors", {}).values():
            s["enabled"] = False
            for k in ("pin", "clk", "cs", "miso", "mosi", "dt_pin", "clk_pin"):
                if k in s:
                    s[k] = -1
        for a in hw.get("actuators", {}).values():
            a["enabled"] = False
            if "pin" in a:
                a["pin"] = -1
            if "fuel_pin" in a:
                a["fuel_pin"] = -1
            if "current_pin" in a:
                a["current_pin"] = -1
            if "has_current" in a:
                a["has_current"] = False
            if "assist_enabled" in a:
                a["assist_enabled"] = False
            if "fuel_pin" in a:
                a["fuel_pin"] = -1
            if "fuel_type" in a:
                a["fuel_type"] = 0
            if "fuel_delay_ms" in a:
                a["fuel_delay_ms"] = 0
        hw["channel_registry"] = {"version": 1, "inputs": [], "outputs": [], "bindings": []}
        hw["di_channels"] = [
            {"pin": -1, "active_h": False, "debounce_ms": 20, "label": "", "role": "none", "fault_code": "", "fault_msg": "", "active_modes": 31}
            for _ in range(4)
        ]
        hw["oil_loops"] = []
        for k in list(hw.get("safety", {}).keys()):
            hw["safety"][k] = False
        for k in list(hw.get("controllers", {}).keys()):
            hw["controllers"][k] = False
        hw["startup_seq"] = ["OilPumpOn", "TimedDelay", "IgniterOn", "FuelPumpIdle", "FuelOpen", "TimedDelay", "IgniterOff", "TimedDelay"]
        hw["startup_delay_ms"] = [0, 200, 0, 0, 0, 500, 0, 200]
        hw["startup_ignition_target"] = [0] * len(hw["startup_seq"])
        hw["startup_enter_actions"] = [[] for _ in hw["startup_seq"]]
        hw["startup_exit_actions"] = [[] for _ in hw["startup_seq"]]
        hw["shutdown_seq"] = ["ImmediateCut", "TimedDelay", "FinalStop"]
        hw["shutdown_delay_ms"] = [0, 300, 0]
        hw["shutdown_ignition_target"] = [0] * len(hw["shutdown_seq"])
        hw["shutdown_enter_actions"] = [[] for _ in hw["shutdown_seq"]]
        hw["shutdown_exit_actions"] = [[] for _ in hw["shutdown_seq"]]
        hw["ab_seq"] = []
        hw["ab_delay_ms"] = []
        hw["ab_ignition_target"] = []
        hw["ab_enter_actions"] = []
        hw["ab_exit_actions"] = []
        hw["ab_shut_seq"] = []
        hw["ab_shut_delay_ms"] = []
        hw["ab_shut_ignition_target"] = []
        hw["ab_shut_enter_actions"] = []
        hw["ab_shut_exit_actions"] = []
        hw["custom_blocks"] = {}
        if "ab_trigger" in hw:
            hw["ab_trigger"].update({
                "source": 0, "requires_arm": False, "arm_pin": -1, "switch_pin": -1,
                "input_pin": -1, "input_rc_pwm": False,
            })
        if "ab_flame" in hw:
            hw["ab_flame"].update(enabled=False, pin=-1)
        if "cluster_serial" in hw:
            hw["cluster_serial"].update(enabled=False, tx_pin=-1, rx_pin=-1)
        if "mavlink" in hw:
            hw["mavlink"].update(enabled=False, tx_pin=-1)
        if "buzzer" in hw:
            hw["buzzer"].update(enabled=False, pin=-1)

    def common_turbine(self, hw, with_throttle_input=True, with_idle_input=True, with_throttle_output=True,
                       with_oil=True, with_fuel_sol=True, with_igniter=True):
        if with_throttle_input:
            hw["sensors"]["throttle_input"].update(enabled=True, pin=4, rc_pwm=False)
        if with_idle_input:
            profile_backed = hw.get("_pcb_profile", {}).get("id") == "otbench-s3-harness"
            hw["sensors"]["idle_input"].update(enabled=True, pin=5, rc_pwm=profile_backed)
        if with_throttle_output:
            hw["actuators"]["throttle"].update(enabled=True, pin=40, type=0, min_us=1000, max_us=2000, inverted=False)
        if with_oil:
            hw["actuators"]["oil_pump"].update(enabled=True, pin=11, type=1, freq_hz=5000, res_bits=12, pwm_min_pct=0, pwm_max_pct=100)
        if with_fuel_sol:
            hw["actuators"]["fuel_sol"].update(enabled=True, pin=12, active_h=True)
        if with_igniter:
            hw["actuators"]["igniter"].update(enabled=True, pin=21, active_h=True, pwm=False, dwell_ms=6, rest_ms=3)

    def sync_core_registry(self, hw) -> None:
        """Mirror legacy test fixtures into the canonical fitted-device registry."""
        reg = hw.setdefault("channel_registry", {"version": 1, "inputs": [], "outputs": [], "bindings": []})
        input_ids = {c.get("id") for c in reg["inputs"]}
        output_ids = {c.get("id") for c in reg["outputs"]}

        # The physical OTBench profile deliberately reserves every cross-link.
        # Registry channels must therefore retain the profile's stable port and
        # mode IDs; raw GPIO alone is rejected (correctly) by the firmware. Keep
        # this translation in one place so every campaign exercises the same
        # profile-backed path as the Hardware page.
        profile_ports = {}
        if hw.get("_pcb_profile", {}).get("id") == "otbench-s3-harness":
            profile_ports = {
                ("input", 13, 0): ("start_switch", "switch"),
                ("input", 15, 0): ("stop_switch", "switch"),
                ("input", 14, 2): ("n1_pulse", "frequency"),
                ("input", 8, 2): ("n2_pulse", "frequency"),
                ("input", 4, 1): ("throttle_input", "analog"),
                ("input", 1, 1): ("oil_pressure_input", "analog"),
                ("input", 2, 1): ("flame_input", "analog"),
                ("input", 2, 0): ("flame_input", "switch"),
                ("input", 5, 3): ("idle_input", "servo_pwm"),
                ("input", 5, 0): ("idle_input", "switch"),
                ("output", 40, 6): ("main_fuel_output", "servo"),
                ("output", 17, 6): ("starter_output", "servo"),
                ("output", 11, 5): ("oil_pump_output", "pwm"),
                ("output", 11, 4): ("oil_pump_output", "relay"),
                ("output", 12, 4): ("fuel_shutoff_output", "relay"),
                ("output", 21, 4): ("igniter_output", "relay"),
                ("output", 21, 5): ("igniter_output", "pwm"),
                ("output", 39, 4): ("starter_enable_output", "relay"),
            }

        def attach_profile_port(direction, channel):
            if (profile_ports and direction == "input" and
                    channel.get("purpose") == "tot"):
                channel["physical_port"] = "tot_input"
                channel["physical_mode"] = "temperature"
                channel["pin"] = -1
                return channel
            physical = profile_ports.get((direction, channel.get("pin"), channel.get("driver")))
            if physical:
                channel["physical_port"], channel["physical_mode"] = physical
                channel["pin"] = -1  # derived from the immutable PCB profile
            return channel

        # Profiles may add generic/alternate-purpose channels directly before
        # this synchronization pass. Resolve those too; otherwise only legacy
        # channels created below receive their immutable connector identity.
        for channel in reg.get("inputs", []):
            attach_profile_port("input", channel)
        for channel in reg.get("outputs", []):
            attach_profile_port("output", channel)

        def add_input(channel):
            if channel["id"] not in input_ids:
                reg["inputs"].append(attach_profile_port("input", channel))
                input_ids.add(channel["id"])

        def add_output(channel):
            if channel["id"] not in output_ids:
                reg["outputs"].append(attach_profile_port("output", channel))
                output_ids.add(channel["id"])

        controls = hw.get("controls", {})
        if controls.get("start_pin", -1) >= 0:
            add_input(chan_input("start_switch", "Start Switch", "digital_switch", "start_switch", 0,
                                 controls["start_pin"], invert=not controls.get("start_active_h", False),
                                 active_high=controls.get("start_active_h", False),
                                 pullup=controls.get("start_pullup", False),
                                 pulldown=controls.get("start_pulldown", False)))
        if controls.get("stop_pin", -1) >= 0:
            add_input(chan_input("stop_switch", "Stop Switch", "digital_switch", "stop_switch", 0,
                                 controls["stop_pin"], invert=not controls.get("stop_active_h", False),
                                 active_high=controls.get("stop_active_h", False),
                                 pullup=controls.get("stop_pullup", False),
                                 pulldown=controls.get("stop_pulldown", False)))

        sensors = hw["sensors"]
        if sensors["n1_rpm"].get("enabled"):
            add_input(chan_input("n1_main", "N1 Speed", "speed", "n1_speed", 2,
                                 sensors["n1_rpm"]["pin"], pulses_per_unit=sensors["n1_rpm"].get("ppr", 1)))
        if sensors["n2_rpm"].get("enabled"):
            add_input(chan_input("n2_main", "N2 Speed", "speed", "n2_speed", 2,
                                 sensors["n2_rpm"]["pin"], pulses_per_unit=sensors["n2_rpm"].get("ppr", 1)))
        if sensors["tot"].get("enabled"):
            s = sensors["tot"]
            add_input(chan_input("tot_main", "Main TOT", "temperature", "tot", 1, -1,
                                 temp_interface=1, spi_clk=s["clk"], spi_cs=s["cs"],
                                 spi_miso=s["miso"], spi_mosi=s.get("mosi", -1), tc_type=s.get("tc_type", "K")))
        if sensors["oil_press"].get("enabled"):
            add_input(chan_input("oil_pressure_main", "Oil Pressure", "pressure", "oil_pressure", 1,
                                 sensors["oil_press"]["pin"]))
        if sensors["flame"].get("enabled"):
            add_input(chan_input("flame_main", "Flame", "flame", "flame", 1,
                                 sensors["flame"]["pin"]))
        for key, channel_id, name, purpose in (
            ("throttle_input", "operator_throttle", "Throttle Input", "throttle"),
            ("idle_input", "operator_idle", "Idle Input", "idle"),
        ):
            s = sensors[key]
            if s.get("enabled"):
                add_input(chan_input(channel_id, name, "operator", purpose, 3 if s.get("rc_pwm") else 1,
                                     s["pin"], min=1000 if s.get("rc_pwm") else 0,
                                     max=2000 if s.get("rc_pwm") else 4095))

        def driver(legacy_type):
            return 6 if legacy_type == 0 else 5 if legacy_type == 1 else 4

        def variable(key, channel_id, name, role, purpose):
            a = hw["actuators"][key]
            if not a.get("enabled"):
                return
            d = driver(a.get("type", 2))
            add_output(chan_output(channel_id, name, role, purpose, d, a["pin"],
                                   min=a.get("min_us", 1000) if d == 6 else a.get("pwm_min_pct", 0) / 100 if d == 5 else 0,
                                   max=a.get("max_us", 2000) if d == 6 else a.get("pwm_max_pct", 100) / 100 if d == 5 else 1,
                                   invert=a.get("inverted", False) or not a.get("active_h", True)))

        variable("throttle", "main_fuel", "Main Fuel Pump", "fuel", "main_fuel")
        variable("starter", "starter", "Starter", "starter", "starter")
        variable("oil_pump", "oil_pump_main", "Oil Pump", "oil_pump", "oil_pump")
        variable("prop_pitch", "prop_pitch", "Prop Pitch", "prop_pitch", "prop_pitch")
        variable("ab_pump", "ab_pump", "AB Fuel Pump", "ab_pump", "ab_pump")

        for key, channel_id, name, role, purpose in (
            ("fuel_sol", "fuel_shutoff", "Fuel Shutoff", "fuel_shutoff", "fuel_shutoff"),
            ("starter_en", "starter_enable", "Starter Enable", "starter_en", "starter_enable"),
            ("ab_sol", "ab_solenoid", "Afterburner Fuel Valve", "valve", "ab_valve"),
            ("airstarter_sol", "air_starter", "Air Starter", "starter", "air_starter"),
        ):
            a = hw["actuators"][key]
            if a.get("enabled"):
                add_output(chan_output(channel_id, name, role, purpose, 4, a["pin"], invert=not a.get("active_h", True)))

        for key, channel_id, name, role, purpose in (
            ("igniter", "igniter", "Igniter", "igniter", "igniter"),
            ("igniter2", "ab_igniter", "AB Igniter", "ab_igniter", "ab_igniter"),
        ):
            a = hw["actuators"][key]
            if a.get("enabled"):
                add_output(chan_output(channel_id, name, role, purpose, 5 if a.get("pwm") else 4,
                                       a["pin"], invert=not a.get("active_h", True)))

        glow = hw["actuators"]["glow_plug"]
        if glow.get("enabled"):
            add_output(chan_output("glow_plug", "Glow Plug", "glow_plug", "glow_plug",
                                   4 if glow.get("output_type") == 1 else 5, glow["pin"],
                                   invert=not glow.get("active_h", True)))

    def enable_n1(self, hw):
        hw["sensors"]["n1_rpm"].update(enabled=True, pin=14, ppr=1.0)

    def enable_n2(self, hw):
        hw["has_two_shaft"] = True
        hw["sensors"]["n2_rpm"].update(enabled=True, pin=8, ppr=1.0)

    def enable_tot(self, hw):
        # v2 treats the shared SPI bus as the physical source of truth.  A
        # thermocouple card cannot silently claim its own duplicate bus pins.
        hw["spi"].update(enabled=True, sck_pin=36, miso_pin=37, mosi_pin=-1)
        hw["sensors"]["tot"].update(enabled=True, chip="max6675", tc_type="K", clk=36, cs=18, miso=37, mosi=-1)

    def enable_oil_press(self, hw, pin=1):
        hw["sensors"]["oil_press"].update(enabled=True, pin=pin)

    def wait_dut_ready_after_hardware_save(self, timeout=150, previous_boot_count=None):
        deadline = time.time() + timeout
        down_seen = False
        stable = 0
        # The AP is deliberately taken down during a clean restart. One WLAN
        # connect after it has had time to return is enough; repeated requests
        # make Windows disconnect an association that is already succeeding.
        reconnect_at = time.time() + 7.0
        reconnect_attempts = 0
        # Hardware POST schedules reboot after its HTTP response. Prefer the
        # monotonic boot_count so a very short AP outage cannot race the next
        # save; fall back to outage/stability if telemetry is unavailable.
        while time.time() < deadline:
            try:
                # Use a single short readiness probe here. The ordinary DUT
                # client retries are appropriate for isolated API glitches,
                # but nesting them inside this reboot loop can overrun the
                # deadline by minutes while Windows recovers its Wi-Fi adapter.
                with urllib.request.urlopen(BASE + "/api/status", timeout=1.5) as response:
                    if response.status != 200:
                        raise RuntimeError("status probe did not return HTTP 200")
                data = self.dut.data()
                boot_count = data.get("boot_count")
                if previous_boot_count is not None and boot_count is not None:
                    if int(boot_count) != int(previous_boot_count):
                        stable += 1
                    else:
                        stable = 0
                    if stable >= 3:
                        time.sleep(1.0)
                        return True
                elif down_seen:
                    stable += 1
                    if stable >= 3:
                        time.sleep(1.5)
                        return True
                else:
                    # If the reboot was too fast to observe, do not return too
                    # early; the delayed reboot window is several seconds.
                    if time.time() < deadline - (timeout - 12):
                        stable += 1
                    if stable >= 6:
                        return True
                time.sleep(1.0)
            except Exception:
                down_seen = True
                stable = 0
                now = time.time()
                if now >= reconnect_at and reconnect_attempts < 2:
                    self.reconnect_wifi()
                    reconnect_attempts += 1
                    reconnect_at = now + 45
                time.sleep(1.0)
        self.reconnect_wifi()
        return False

    def verify_profile_shape(self, expected, current):
        if current.get("profile_id") != self.base_profile_id:
            return False
        expected_platform = "esp32" if os.environ.get(
            "OTBENCH_TARGET", "s3").strip().lower() == "classic" else "esp32s3"
        if current.get("platform") != expected_platform:
            return False
        def registry_has(direction, purpose):
            reg = expected.get("channel_registry", {})
            for ch in reg.get(direction, []):
                if ch.get("purpose") == purpose:
                    return True
            return False

        def topology(doc, kind):
            reg = doc.get("channel_registry", {})
            inputs = reg.get("inputs", [])
            outputs = reg.get("outputs", [])
            if kind == "two_shaft":
                return bool(doc.get("sensors", {}).get("n2_rpm", {}).get("enabled")) or any(
                    c.get("purpose") == "n2_speed" for c in inputs)
            return any(doc.get("actuators", {}).get(k, {}).get("enabled") for k in
                       ("ab_sol", "ab_pump", "igniter2")) or bool(doc.get("ab_flame", {}).get("enabled")) or any(
                           c.get("purpose") in ("ab_valve", "ab_pump", "ab_igniter") for c in outputs)

        if topology(current, "two_shaft") != topology(expected, "two_shaft"):
            return False
        if topology(current, "afterburner") != topology(expected, "afterburner"):
            return False

        registry_sensor_alias = {
            "n1_rpm": ("inputs", "n1_speed"),
            "n2_rpm": ("inputs", "n2_speed"),
            "oil_press": ("inputs", "oil_pressure"),
            "fuel_press": ("inputs", "fuel_pressure"),
            "p1": ("inputs", "p1_pressure"),
            "p2": ("inputs", "p2_pressure"),
            "tot": ("inputs", "tot"),
            "tit": ("inputs", "tit"),
        }
        registry_actuator_alias = {
            "throttle": ("outputs", "main_fuel"),
            "starter": ("outputs", "starter"),
            "starter_en": ("outputs", "starter_enable"),
            "oil_pump": ("outputs", "oil_pump"),
            "prop_pitch": ("outputs", "prop_pitch"),
        }
        for group in ("sensors", "actuators"):
            for key, exp in expected.get(group, {}).items():
                cur = current.get(group, {}).get(key, {})
                fixed = current.get("_pcb_profile", {}).get("fixed_functions", {})
                if group == "actuators" and key == "status_led" and "status_led" in fixed:
                    continue
                alias = registry_sensor_alias.get(key) if group == "sensors" else registry_actuator_alias.get(key)
                if alias and not exp.get("enabled") and registry_has(*alias):
                    continue
                if bool(cur.get("enabled")) != bool(exp.get("enabled")):
                    return False
                if exp.get("enabled") and "pin" in exp and cur.get("pin") != exp.get("pin"):
                    return False
        exp_cr = expected.get("channel_registry", {})
        cur_cr = current.get("channel_registry", {})
        for direction in ("inputs", "outputs"):
            exp_ids = [c.get("id") for c in exp_cr.get(direction, [])]
            cur_ids = [c.get("id") for c in cur_cr.get(direction, [])]
            if any(exp_id not in cur_ids for exp_id in exp_ids):
                return False
        return True

    def apply_profile(self, spec):
        expected = self.dut.hardware()
        # Classic streams this large document from its fixed receive workspace.
        # Let the GET response drain before reusing the same content in a POST;
        # real Hardware-page editing always provides a much longer interval.
        classic_target = os.environ.get("OTBENCH_TARGET", "s3").strip().lower() == "classic"
        if classic_target:
            time.sleep(3.0)
        self.clear_hw(expected)
        spec["build"](expected)
        self.sync_core_registry(expected)
        self.prepare_hardware_save()
        try:
            previous_boot_count = self.dut.data().get("boot_count")
        except Exception:
            previous_boot_count = None
        code, resp = self.dut._post("/api/hardware", expected)
        retryable_memory = (
            code == 400 and isinstance(resp, dict) and
            resp.get("detail") == "insufficient memory to parse hardware configuration"
        )
        if code != 200 and isinstance(resp, dict) and (resp.get("rebooting") or retryable_memory):
            if resp.get("rebooting"):
                self.wait_dut_ready_after_hardware_save(previous_boot_count=previous_boot_count)
            if classic_target:
                time.sleep(5.0)
            previous_boot_count = self.dut.data().get("boot_count")
            code, resp = self.dut._post("/api/hardware", expected)
        if code != 200:
            raise RuntimeError(f"/api/hardware save failed for {spec['id']}: HTTP {code} {resp}")
        if not self.wait_dut_ready_after_hardware_save(previous_boot_count=previous_boot_count):
            raise RuntimeError(f"DUT did not return after hardware save for {spec['id']}")
        # Read/verify with a few retries because the API may come back just
        # before the hardware apply task has completely settled.
        verified = False
        last = None
        for _ in range(8):
            try:
                last = self.dut.hardware()
                if self.verify_profile_shape(expected, last):
                    verified = True
                    break
            except Exception:
                pass
            time.sleep(1.0)
        if not verified:
            raise RuntimeError(f"/api/hardware verify failed for {spec['id']}; last={last}")
        self.patch_fast_config()
        self.safe_standby()

    def check(self, checks, name: str, ok: bool, detail: str = "") -> bool:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        self.log(f"    [{'PASS' if ok else 'FAIL'}] {name} {detail}")
        return bool(ok)

    def wait_idle_tools(self):
        deadline = time.time() + 8
        while time.time() < deadline:
            d = self.dut.data()
            active = (
                d.get("oil_pct", 0) > 0.5 or d.get("fuel_sol_open") or d.get("igniter_on") or
                d.get("igniter2_on") or d.get("starter_enabled") or d.get("cool_fan_on") or
                d.get("airstarter_open") or d.get("bleed_valve_open") or d.get("ab_sol_open") or
                d.get("glow_plug_pct", 0) > 1 or d.get("fuel_pump2_demand", 0) > 0.01 or
                d.get("prop_pitch_demand", 0) > 0.01 or d.get("ab_pump_demand", 0) > 0.01 or
                any((o.get("demand", 0) or 0) > 0.01 for o in d.get("registry_outputs", []))
            )
            if not active:
                return True
            time.sleep(0.15)
        return False

    def tester_active(self, signal: str, kind: str):
        f = self.t.get(signal)
        if kind == "level":
            return f.get("level") == 1, f
        if kind == "pwm":
            return (f.get("duty", 0) or 0) > 0.03 or f.get("level") == 1, f
        if kind == "servo":
            return (f.get("us", 0) or 0) >= 850 and 40 <= (f.get("hz", 0) or 0) <= 60, f
        return False, f

    def fire_tool(self, checks, cmd: str, signal: str, kind: str, label: str, telemetry=None, fparam=0.0, iparam=0):
        self.dut.ensure_mode_standby()
        self.wait_idle_tools()
        code, resp = self.dut.command(cmd, fParam=fparam, iParam=iparam)
        if code == 409 and "already active" in str(resp.get("error", "")).lower():
            self.wait_idle_tools()
            code, resp = self.dut.command(cmd, fParam=fparam, iParam=iparam)
        if not self.check(checks, f"{label} command accepted", code == 200, f"HTTP {code} {resp}"):
            return False
        pin_seen = False
        tel_seen = telemetry is None
        best = {}
        deadline = time.time() + 2.5
        while time.time() < deadline:
            active, fields = self.tester_active(signal, kind)
            best = fields
            pin_seen = pin_seen or active
            d = self.dut.data()
            if telemetry:
                val = telemetry(d)
                tel_seen = tel_seen or bool(val)
            if pin_seen and tel_seen:
                break
            time.sleep(0.06)
        ok = pin_seen and tel_seen
        self.check(checks, f"{label} physical output", ok, f"{signal} {best}")
        self.wait_idle_tools()
        return ok

    def telemetry_tool(self, checks, cmd: str, label: str, telemetry, fparam=0.0, iparam=0):
        self.dut.ensure_mode_standby()
        self.wait_idle_tools()
        code, resp = self.dut.command(cmd, fParam=fparam, iParam=iparam)
        if not self.check(checks, f"{label} command accepted", code == 200, f"HTTP {code} {resp}"):
            return False
        seen = False
        deadline = time.time() + 2.5
        while time.time() < deadline:
            d = self.dut.data()
            seen = seen or bool(telemetry(d))
            if seen:
                break
            time.sleep(0.06)
        self.check(checks, f"{label} telemetry active", seen, "")
        self.wait_idle_tools()
        return seen

    def registry_tool(self, checks, out_id: str, signal: str, kind: str, label: str, demand=0.7):
        hw = self.dut.hardware()
        idx = next((i for i, c in enumerate(hw.get("channel_registry", {}).get("outputs", [])) if c.get("id") == out_id), -1)
        if idx < 0:
            self.check(checks, f"{label} registry present", False, f"{out_id} not found")
            return False
        return self.fire_tool(
            checks,
            "REGISTRY_OUTPUT_TEST",
            signal,
            kind,
            label,
            telemetry=lambda d: len(d.get("registry_outputs", [])) > idx and d["registry_outputs"][idx].get("demand", 0) > 0.1,
            fparam=demand,
            iparam=idx,
        )

    def test_inputs_and_cal(self, checks, profile_id: str):
        hw = self.dut.hardware()
        sensors = hw.get("sensors", {})
        registry_inputs = hw.get("channel_registry", {}).get("inputs", [])
        def registry_input(purpose):
            return next((c for c in registry_inputs if c.get("purpose") == purpose), None)
        if sensors.get("throttle_input", {}).get("enabled") and sensors["throttle_input"].get("pin") == 4 and not sensors["throttle_input"].get("rc_pwm"):
            self.t.set("THROTTLE_IN", 0.0)
            time.sleep(0.35)
            lo = self.dut.data().get("throttle_input_raw", 0)
            self.t.set("THROTTLE_IN", 3.3)
            time.sleep(0.35)
            hi = self.dut.data().get("throttle_input_raw", 0)
            self.check(checks, "throttle ADC input sweep", hi > lo + 1500, f"{lo}->{hi}")
            ok, _ = self.dc.patch_cfg({"calibration": {"throttle_min_raw": 100, "throttle_max_raw": 3900}})
            cfg = self.dut.config().get("calibration", {})
            self.check(checks, "throttle calibration save", ok and cfg.get("throttle_min_raw") == 100 and cfg.get("throttle_max_raw") == 3900)
        if sensors.get("idle_input", {}).get("enabled") and sensors["idle_input"].get("rc_pwm"):
            self.t.set("IDLE_IN", 1000)
            time.sleep(0.45)
            lo = self.dut.data().get("idle_input_raw", 0)
            self.t.set("IDLE_IN", 1900)
            time.sleep(0.45)
            hi = self.dut.data().get("idle_input_raw", 0)
            self.check(checks, "idle RC input sweep", hi > lo + 400, f"{lo}->{hi}")
            ok, _ = self.dc.patch_cfg({"calibration": {"idle_min_raw": 1050, "idle_max_raw": 1950}})
            cfg = self.dut.config().get("calibration", {})
            self.check(checks, "idle RC calibration save", ok and cfg.get("idle_min_raw") == 1050 and cfg.get("idle_max_raw") == 1950)
        n1_registry = registry_input("n1_speed")
        n1_uses_pcnt_wire = not n1_registry or int(n1_registry.get("driver", 2)) == 2
        if sensors.get("n1_rpm", {}).get("enabled") and n1_uses_pcnt_wire:
            self.t.set("N1", hz(6000))
            time.sleep(0.65)
            n1a = self.dut.data().get("n1", 0)
            self.t.set("N1", hz(12000))
            time.sleep(0.65)
            n1b = self.dut.data().get("n1", 0)
            self.t.set("N1", 0)
            self.check(checks, "N1 PCNT input", n1b > n1a > 500, f"{n1a}->{n1b}")
        if sensors.get("n2_rpm", {}).get("enabled"):
            self.t.set("N2", hz(5000))
            time.sleep(0.65)
            n2a = self.dut.data().get("n2", 0)
            self.t.set("N2", hz(10000))
            time.sleep(0.65)
            n2b = self.dut.data().get("n2", 0)
            self.t.set("N2", 0)
            self.check(checks, "N2 PCNT input", n2b > n2a > 500, f"{n2a}->{n2b}")
        if sensors.get("tot", {}).get("enabled"):
            self.t.set_tot(180)
            time.sleep(1.2)
            t1 = self.dut.data().get("tot", 0)
            self.t.set_tot(560)
            time.sleep(1.2)
            t2 = self.dut.data().get("tot", 0)
            self.check(checks, "TOT thermocouple simulator", t2 > t1 + 250, f"{t1}->{t2}")
        if sensors.get("oil_press", {}).get("enabled"):
            oil_signal = "THROTTLE_IN" if sensors.get("oil_press", {}).get("pin") == 4 else "OILP"
            self.t.set(oil_signal, 0.5)
            time.sleep(0.35)
            raw1 = self.dut.data().get("oil_raw", 0)
            bar1 = self.dut.data().get("oil", 0)
            ok, _ = self.dc.patch_cfg({"calibration": {"oil_poly": {"a": 0, "b": 0, "c": round(20.0 / 4095.0, 8), "d": 0, "x_min": 0, "x_max": 4095}}})
            self.t.set(oil_signal, 2.5)
            time.sleep(0.45)
            raw2 = self.dut.data().get("oil_raw", 0)
            bar2 = self.dut.data().get("oil", 0)
            self.check(checks, "oil pressure calibration path", ok and raw2 > raw1 and bar2 > bar1, f"raw {raw1}->{raw2}, bar {bar1}->{bar2}")
        for ch in registry_inputs:
            cid = ch.get("id")
            if cid == "generic_rc":
                idx = registry_inputs.index(ch)
                self.t.set("IDLE_IN", 1000)
                time.sleep(0.45)
                lo = self.dut.data().get("registry_inputs", [])[idx].get("value", 0)
                self.t.set("IDLE_IN", 1900)
                time.sleep(0.45)
                hi = self.dut.data().get("registry_inputs", [])[idx].get("value", 0)
                self.check(checks, "generic RC registry input", hi > lo + 0.4, f"{lo}->{hi}")
            if cid == "coolant_temp":
                idx = registry_inputs.index(ch)
                self.t.set("THROTTLE_IN", 0.5)
                time.sleep(0.4)
                v1 = self.dut.data().get("registry_inputs", [])[idx].get("value", 0)
                code, resp = self.dut.patch("/api/hardware", {"channel_registry_calibration": {"id": "coolant_temp", "analog_mv_per_unit": 20}})
                self.t.set("THROTTLE_IN", 2.5)
                time.sleep(0.5)
                v2 = self.dut.data().get("registry_inputs", [])[idx].get("value", 0)
                self.check(checks, "coolant temp registry calibration", code == 200 and v2 > v1 + 50, f"HTTP {code} {resp}; {v1}->{v2}")
            if cid == "low_oil_sw":
                idx = registry_inputs.index(ch)
                self.t.set("FLAME", 0)
                time.sleep(0.35)
                off = self.dut.data().get("registry_inputs", [])[idx].get("value", 0)
                self.t.set("FLAME", 1)
                time.sleep(0.35)
                on = self.dut.data().get("registry_inputs", [])[idx].get("value", 0)
                self.check(checks, "low-oil switch registry input", on > off, f"{off}->{on}")
        di_channels = hw.get("di_channels", []) or []
        for idx, ch in enumerate(di_channels):
            if ch.get("role") == "low_oil_switch" and ch.get("pin") == 2:
                active_high = ch.get("active_h", True)
                inactive_level = 0 if active_high else 1
                active_level = 1 if active_high else 0
                self.t.set("FLAME", inactive_level)
                time.sleep(0.35)
                off = self.dut.data().get("di_channels", [])[idx].get("state", False)
                self.t.set("FLAME", active_level)
                time.sleep(0.35)
                on = self.dut.data().get("di_channels", [])[idx].get("state", False)
                self.check(checks, "low-oil switch DI input", (not off) and bool(on), f"{off}->{on}")
                self.t.set("FLAME", inactive_level)
            if cid == "n1_analog":
                self.t.set("THROTTLE_IN", 0.4)
                time.sleep(0.5)
                n1a = self.dut.data().get("n1", 0)
                self.t.set("THROTTLE_IN", 2.8)
                time.sleep(0.5)
                n1b = self.dut.data().get("n1", 0)
                self.check(checks, "N1 analog converter input", n1b > n1a + 20000, f"{n1a}->{n1b}")

    def test_standard_tools(self, checks, extra_tools):
        hw = self.dut.hardware()
        acts = hw.get("actuators", {})
        if acts.get("oil_pump", {}).get("enabled") and acts["oil_pump"].get("pin") == 11:
            self.fire_tool(checks, "OIL_PRIME", "OILPUMP_OUT", "pwm", "oil prime", telemetry=lambda d: d.get("oil_pct", 0) > 10)
        if acts.get("fuel_sol", {}).get("enabled") and acts["fuel_sol"].get("pin") == 12:
            self.fire_tool(checks, "FUEL_SOL_TEST", "FUEL_SOL", "level", "fuel solenoid", telemetry=lambda d: d.get("fuel_sol_open"))
        if acts.get("igniter", {}).get("enabled") and acts["igniter"].get("pin") == 21:
            if acts["igniter"].get("pwm"):
                self.telemetry_tool(checks, "IGN_TEST", "dwell igniter", telemetry=lambda d: d.get("igniter_on"))
            else:
                self.fire_tool(checks, "IGN_TEST", "IGNITER", "level", "igniter", telemetry=lambda d: d.get("igniter_on"))
        if acts.get("throttle", {}).get("enabled") and acts["throttle"].get("pin") == 40:
            self.fire_tool(checks, "SET_THROTTLE_PCT", "THROTTLE_OUT", "servo", "main fuel/throttle servo",
                           telemetry=lambda d: d.get("throttle_demand", 0) > 0.25, fparam=50)
            ok, _ = self.dc.patch_cfg({"throttle": {"fuel_pump_min_pct": 14}})
            saved = self.dut.config().get("throttle", {}).get("fuel_pump_min_pct")
            self.check(checks, "minimum reliable fuel command save", ok and abs((saved or 0) - 14) < 0.5, f"saved={saved}")
        for tool in extra_tools:
            kind = tool.get("kind", "level")
            if tool["cmd"] == "REGISTRY_OUTPUT_TEST":
                self.registry_tool(checks, tool["id"], tool["signal"], kind, tool["label"], tool.get("demand", 0.7))
            else:
                self.fire_tool(checks, tool["cmd"], tool["signal"], kind, tool["label"], telemetry=tool.get("telemetry"))

    def test_run(self, checks):
        self.safe_standby()
        self.dut.ensure_dev_mode(True)
        self.dut.ensure_bench_mode(True)
        # Give open-loop/timer profiles a realistic operator demand before
        # START. At 0% throttle they can complete the sequence but never show a
        # meaningful RUNNING output in the short HIL observation window.
        self.t.set("THROTTLE_IN", 2.5)
        self.t.set("IDLE_IN", 1500)
        self.t.set("N1", hz(18000))
        self.t.set("N2", hz(14000))
        self.t.set("OILP", 2.5)
        try:
            hw = self.dut.hardware()
            if hw.get("sensors", {}).get("oil_press", {}).get("enabled") and hw["sensors"]["oil_press"].get("pin") == 4:
                self.t.set("THROTTLE_IN", 2.5)
        except Exception:
            pass
        self.t.set("FLAME", 1)
        self.t.set_tot(150)
        code, resp = self.dut.start()
        if not self.check(checks, "bench start accepted", code == 200, f"HTTP {code} {resp}"):
            self.safe_standby()
            return
        saw_startup = False
        saw_running = False
        saw_any_output = False
        output_notes = {}
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                st = self.t.state()
                d = self.dut.data()
            except Exception:
                time.sleep(0.1)
                continue
            mode = d.get("mode")
            saw_startup = saw_startup or mode == "STARTUP"
            saw_running = saw_running or mode == "RUNNING"
            driven = (
                (st.get("OILPUMP_OUT_duty", 0) or 0) > 0.02 or
                st.get("IGNITER", 0) == 1 or
                st.get("FUEL_SOL", 0) == 1 or
                st.get("STARTER_EN", 0) == 1 or
                (st.get("THROTTLE_OUT_us", 0) or 0) >= 850
            )
            saw_any_output = saw_any_output or driven
            output_notes = st
            if saw_startup and saw_running and saw_any_output:
                break
            time.sleep(0.08)
        self.dut.stop()
        self.dut.ensure_mode_standby(timeout=25)
        if self.dut.data().get("bench_mode"):
            self.dut.command("TOGGLE_BENCH_MODE")
            time.sleep(0.2)
        if self.dut.data().get("dev_mode"):
            self.dut.command("TOGGLE_DEV_MODE")
            time.sleep(0.2)
        self.check(checks, "bench startup run reaches active states", saw_startup and saw_running, f"startup={saw_startup} running={saw_running}")
        self.check(checks, "bench startup drives at least one output", saw_any_output, str(output_notes)[:220])

    def run_profile(self, spec):
        self.log(f"\n=== {spec['id']}: {spec['name']} ===")
        row = {"id": spec["id"], "name": spec["name"], "status": "pass", "checks": [], "error": None}
        t0 = time.time()
        try:
            self.apply_profile(spec)
            self.test_inputs_and_cal(row["checks"], spec["id"])
            self.test_standard_tools(row["checks"], spec.get("tools", []))
            self.test_run(row["checks"])
            if not all(c["ok"] for c in row["checks"]):
                row["status"] = "fail"
        except Exception as e:  # noqa: BLE001
            row["status"] = "error"
            row["error"] = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            self.log(row["error"])
            try:
                self.safe_standby()
            except Exception:
                pass
        row["duration_s"] = round(time.time() - t0, 2)
        self.results.append(row)
        self.save_progress()

    def restore_original(self):
        self.log("\nRestoring original hardware/config...")
        try:
            self.prepare_hardware_save()
        except Exception:
            pass
        try:
            previous_boot_count = self.dut.data().get("boot_count")
        except Exception:
            previous_boot_count = None
        classic_target = os.environ.get("OTBENCH_TARGET", "s3").strip().lower() == "classic"
        # A settings transaction from the final recovery step can still own
        # the apply gate for a few control ticks. Treat that documented 409 as
        # a short-lived ordering condition and retry the identical restore;
        # leaving a temporary HIL profile installed is never an acceptable
        # cleanup result.
        deadline = time.time() + 5.0
        while True:
            code, resp = self.dut._post("/api/hardware", self.original_hw)
            if code != 409 or "configuration update" not in str(resp).lower() or time.time() >= deadline:
                break
            time.sleep(0.1)
        if code != 200:
            self.log(f"WARNING: original hardware restore failed: HTTP {code} {resp}")
            return False
        if not self.wait_dut_ready_after_hardware_save(previous_boot_count=previous_boot_count):
            self.log("WARNING: DUT did not return after original hardware restore")
            return False
        restore_patch = self._restore_config_patch or self.original_cfg
        ok, resp = self.dc.patch_cfg(restore_patch)
        if not ok:
            self.log(f"WARNING: original config restore failed: {resp}")
            return False
        try:
            self.safe_standby()
        except Exception as exc:
            # A settings apply briefly occupies the smallest internal-heap
            # window of the run.  Do not turn one missed TCP response into an
            # uncaught campaign exception; allow the AP/client association to
            # settle and then verify the device through its compact endpoint.
            self.log(f"Restore standby verification retrying after transport error: {exc}")

        identity = None
        deadline = time.time() + 75.0
        reconnect_at = time.time() + 7.0
        while time.time() < deadline:
            try:
                identity = self.dut.device_info()
                if identity.get("state") in ("STANDBY", "FAULT"):
                    break
            except Exception:
                if time.time() >= reconnect_at:
                    self.reconnect_wifi()
                    reconnect_at = time.time() + 45.0
            time.sleep(1.0)
        if not identity:
            self.log("WARNING: restored ECU identity could not be verified")
            return False
        self.firmware_after = identity.get("firmware_version", "unknown")
        self.restored = True
        return self.firmware_after == self.firmware_before

    def close(self):
        try:
            self.rig.close()
        except Exception:
            pass


def build_profiles(r: TenBuildRunner):
    def p1(hw):
        r.common_turbine(hw)

    def p2(hw):
        r.common_turbine(hw)
        r.enable_n1(hw)
        r.enable_tot(hw)
        r.enable_oil_press(hw, pin=1)
        hw["controllers"]["oil_loop"] = True
        hw["oil_loops"] = [{
            "id": "main_oil_loop", "enabled": True,
            "pressure_input": "oil_pressure_main", "pump_output": "oil_pump_main",
            "target_bar": 2.5, "deadband_bar": 0.2, "min_demand": 0.18, "max_demand": 1,
        }]
        hw["safety"]["overtemp"] = True

    def p3(hw):
        r.common_turbine(hw, with_idle_input=False)
        hw["channel_registry"]["inputs"].append(chan_input("generic_rc", "RC Input", "generic", "generic", 3, 5, min=1000, max=2000))
        hw["channel_registry"]["outputs"].append(chan_output("generic_relay", "Relay Output", "generic", "generic", 4, 39))

    def p4(hw):
        r.common_turbine(hw, with_throttle_output=False)
        r.enable_n1(hw)
        r.enable_n2(hw)
        hw["actuators"]["prop_pitch"].update(enabled=True, pin=40, type=0, min_us=1000, max_us=2000)
        hw["controllers"]["governor"] = True

    def p5(hw):
        r.common_turbine(hw, with_oil=False)
        r.enable_n1(hw)
        r.enable_n2(hw)
        hw["actuators"]["prop_pitch"].update(enabled=True, pin=11, type=1, freq_hz=5000, res_bits=12, pwm_min_pct=0, pwm_max_pct=100)
        hw["channel_registry"]["outputs"].append(chan_output("coolant_pump", "Coolant Pump", "coolant_pump", "coolant_pump", 4, 39))
        hw["channel_registry"]["inputs"].append(chan_input("coolant_temp", "Coolant Temp", "temperature", "coolant_temp", 1, 4, analog_zero_mv=0, analog_mv_per_unit=10))
        hw["sensors"]["throttle_input"].update(enabled=False, pin=-1)

    def p6(hw):
        r.common_turbine(hw, with_fuel_sol=False, with_igniter=False)
        r.enable_n1(hw)
        r.enable_tot(hw)
        hw["has_afterburner"] = True
        hw["actuators"]["ab_sol"].update(enabled=True, pin=12, active_h=True)
        hw["actuators"]["ab_pump"].update(enabled=True, pin=39, type=2, active_h=True)
        hw["actuators"]["igniter2"].update(enabled=True, pin=21, active_h=True, pwm=False)

    def p7(hw):
        r.common_turbine(hw, with_fuel_sol=False, with_igniter=False)
        r.enable_n1(hw)
        hw["actuators"]["airstarter_sol"].update(enabled=True, pin=39, active_h=True)
        hw["channel_registry"]["outputs"].append(chan_output("pilot_fuel", "Pilot Fuel", "valve", "pilot_fuel", 4, 12))
        hw["channel_registry"]["outputs"].append(chan_output("purge_valve", "Purge Valve", "valve", "purge_valve", 4, 21))

    def p8(hw):
        r.common_turbine(hw, with_fuel_sol=False)
        r.enable_n1(hw)
        hw["actuators"]["igniter"].update(enabled=True, pin=21, active_h=True, pwm=True, dwell_ms=80, rest_ms=20)
        hw["actuators"]["glow_plug"].update(enabled=True, pin=39, output_type=1, type=2, active_h=True,
                                            fuel_pin=12, fuel_type=0, fuel_active_h=True, fuel_delay_ms=0)

    def p9(hw):
        r.common_turbine(hw)
        r.enable_n1(hw)
        hw["sensors"]["flame"].update(enabled=False, pin=-1)
        hw["di_channels"] = [{"pin": 2, "active_h": False, "debounce_ms": 20, "label": "Low Oil Switch", "role": "low_oil_switch", "fault_code": "", "fault_msg": "", "active_modes": 31}]
        hw["safety"]["low_oil"] = True

    def p10(hw):
        r.common_turbine(hw, with_throttle_input=False, with_throttle_output=False)
        hw["sensors"]["n1_rpm"].update(enabled=False, pin=-1)
        hw["channel_registry"]["inputs"].append(chan_input("n1_analog", "N1 Analog", "speed", "n1_speed", 1, 4, analog_zero_mv=0, analog_mv_per_unit=0.055))
        hw["channel_registry"]["outputs"].append(chan_output("starter_enable", "Starter Enable", "starter_en", "starter_enable", 6, 40, min=1000, max=2000))
        # This bench's S3 notes GPIO16/17 as non-driving, so do not require a
        # physical starter motor output on GPIO17 here. The profile is still
        # valuable: it covers analog RPM conversion plus a proportional
        # servo-style starter-enable output.
        hw["actuators"]["starter"].update(enabled=False, pin=-1, type=0, min_us=1000, max_us=2000)

    return [
        {"id": "hil_minimal_timer_turbojet", "name": "Minimal timer turbojet", "build": p1, "tools": []},
        {"id": "hil_single_shaft_tot_oil", "name": "Single shaft with N1, TOT and oil loop", "build": p2, "tools": []},
        {"id": "hil_rc_generic_rules", "name": "RC/generic automation I/O", "build": p3, "tools": [
            {"cmd": "REGISTRY_OUTPUT_TEST", "id": "generic_relay", "signal": "STARTER_EN", "kind": "level", "label": "generic relay output"}
        ]},
        {"id": "hil_free_turbine_prop_servo", "name": "Free turbine governor with servo prop pitch", "build": p4, "tools": [
            {"cmd": "PROP_PITCH_TEST", "signal": "THROTTLE_OUT", "kind": "servo", "label": "prop pitch servo",
             "telemetry": lambda d: d.get("prop_pitch_demand", 0) > 0.1}
        ]},
        {"id": "hil_turboprop_pwm_coolant", "name": "Turboprop PWM pitch plus coolant pump/temp", "build": p5, "tools": [
            {"cmd": "PROP_PITCH_TEST", "signal": "OILPUMP_OUT", "kind": "pwm", "label": "prop pitch PWM",
             "telemetry": lambda d: d.get("prop_pitch_demand", 0) > 0.1},
            {"cmd": "REGISTRY_OUTPUT_TEST", "id": "coolant_pump", "signal": "STARTER_EN", "kind": "level", "label": "coolant pump relay"}
        ]},
        {"id": "hil_afterburning_turbojet", "name": "Afterburning turbojet", "build": p6, "tools": [
            {"cmd": "AB_SOL_TEST", "signal": "FUEL_SOL", "kind": "level", "label": "AB solenoid",
             "telemetry": lambda d: d.get("ab_sol_open")},
            {"cmd": "AB_PUMP_TEST", "signal": "STARTER_EN", "kind": "level", "label": "AB pump relay",
             "telemetry": lambda d: d.get("ab_pump_demand", 0) > 0.1},
        ]},
        {"id": "hil_air_start_pilot_purge", "name": "Air start with pilot gas and purge valve", "build": p7, "tools": [
            {"cmd": "AIRSTARTER_TEST", "signal": "STARTER_EN", "kind": "level", "label": "air starter solenoid",
             "telemetry": lambda d: d.get("airstarter_open")},
            {"cmd": "REGISTRY_OUTPUT_TEST", "id": "pilot_fuel", "signal": "FUEL_SOL", "kind": "level", "label": "pilot fuel output"},
            {"cmd": "REGISTRY_OUTPUT_TEST", "id": "purge_valve", "signal": "IGNITER", "kind": "level", "label": "purge valve output"},
        ]},
        {"id": "hil_dwell_igniter_wet_glow", "name": "Dwell igniter and wet glow plug", "build": p8, "tools": [
            {"cmd": "GLOW_TEST", "signal": "STARTER_EN", "kind": "level", "label": "wet glow relay",
             "telemetry": lambda d: d.get("glow_plug_pct", 0) > 10},
        ]},
        {"id": "hil_oil_switch_safety", "name": "Oil switch safety without analog oil pressure", "build": p9, "tools": []},
        {"id": "hil_analog_rpm_servo_start_en", "name": "Analog RPM converter with servo starter enable", "build": p10, "tools": [
            {"cmd": "STARTER_EN_TEST", "signal": "THROTTLE_OUT", "kind": "servo", "label": "servo starter enable",
             "telemetry": lambda d: d.get("starter_enabled")},
        ]},
    ]


def main():
    runner = TenBuildRunner(port=os.environ.get("OTBENCH_PORT", "COM3"))
    requested_profile = os.environ.get("OTBENCH_PROFILE", "").strip()
    restored = False
    fatal_error = None
    try:
        runner.log(f"Backup saved: {runner.backup_path}")
        runner.log("Checking live UI pages used by this run...")
        for page in ("hardware.html", "calibration.html", "tools.html", "sequence.html"):
            body = urllib.request.urlopen(BASE + "/" + page, timeout=6).read()
            if len(body) < 1000:
                raise RuntimeError(f"{page} served too small ({len(body)} bytes)")
            runner.log(f"  {page}: {len(body)} bytes")
        runner.safe_standby()
        profiles = build_profiles(runner)
        if requested_profile:
            profiles = [spec for spec in profiles if spec["id"] == requested_profile]
            if not profiles:
                raise RuntimeError(f"unknown OTBENCH_PROFILE: {requested_profile}")
        for spec in profiles:
            runner.run_profile(spec)
            last = runner.results[-1]
            if last["status"] == "error" and "timed out" in (last.get("error") or "").lower():
                if not runner.api_alive():
                    raise RuntimeError("DUT API unreachable after timeout; stopping campaign to avoid cascading stale failures")
    except Exception as exc:  # noqa: BLE001 - preserve evidence, then restore
        fatal_error = exc
        traceback.print_exc()
    finally:
        # A failed profile is still destructive: always put the user's engine
        # file back before closing the tester. DUT transport retries cover the
        # Windows Wi-Fi adapter's limited-connectivity recovery interval.
        try:
            restored = runner.restore_original()
        except Exception:  # noqa: BLE001 - record failure without hiding root cause
            traceback.print_exc()
            restored = False
        runner.log(f"Original profile restored: {restored}")
        runner.save_progress()
        runner.close()
    passes = sum(1 for r in runner.results if r["status"] == "pass")
    fails = [r for r in runner.results if r["status"] != "pass"]
    runner.log(f"\nRESULT: {passes}/{len(runner.results)} profiles passed")
    for r in fails:
        runner.log(f"  {r['id']}: {r['status']} {r.get('error') or ''}")
        for c in r.get("checks", []):
            if not c.get("ok"):
                runner.log(f"    FAIL {c['name']}: {c.get('detail', '')}")
    runner.log(f"Results saved: {runner.result_path}")
    if fatal_error is not None:
        runner.log(f"Fatal campaign error: {type(fatal_error).__name__}: {fatal_error}")
    expected_profiles = 1 if requested_profile else 10
    return 0 if len(runner.results) == expected_profiles and not fails and restored else 1


if __name__ == "__main__":
    raise SystemExit(main())
