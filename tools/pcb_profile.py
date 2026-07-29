#!/usr/bin/env python3
"""Validate and wrap OpenTurbine PCB profiles for the pcbprof partition.

Source profiles stay readable JSON beside the PCB design. The flash-time
container adds target identity and corruption detection without making the
source format firmware-specific.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAGIC = b"OTPB"
CONTAINER_VERSION = 1
ENCODING_JSON = 1
ORIGIN_CUSTOM = 1
ORIGIN_OFFICIAL = 2
HEADER = struct.Struct("<4sBBBBBBHII12s")
MAX_PAYLOAD = 24 * 1024
MAX_BUSES = 8
MAX_DEVICES = 24
MAX_PORTS = 48
MAX_MODES = 4
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,23}$")
BOARD_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
TARGET_IDS = {"esp32": 1, "esp32-s3": 2}
ADAPTERS = {
    "digital_input", "analog_input", "pcnt_input", "rc_pwm_input",
    "pwm_duty_input", "spi_thermocouple", "onewire_temperature",
    "i2c_digital_input", "i2c_adc_input", "i2c_load_cell",
    "i2c_adc_digital_input",
    "digital_output", "relay_output", "pwm_output", "servo_output",
    "i2c_digital_output",
}


class ProfileError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ProfileError(message)


def _load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ProfileError(f"cannot read valid UTF-8 JSON: {exc}") from exc
    _require(isinstance(value, dict), "profile root must be an object")
    return value


def _target_catalog(chip: str) -> dict:
    path = ROOT / "pcb_profiles" / "targets" / f"{chip}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProfileError(f"target catalog for {chip!r} is unavailable: {exc}") from exc


def validate_profile(profile: dict, *, strict: bool = False) -> list[str]:
    warnings: list[str] = []
    _require(profile.get("format") == "openturbine-pcb-profile",
             "format must be 'openturbine-pcb-profile'")
    version = profile.get("format_version")
    _require(isinstance(version, dict) and version.get("major") == 1,
             "format_version.major must be 1")
    _require(isinstance(version.get("minor"), int) and 0 <= version["minor"] <= 255,
             "format_version.minor must be 0..255")

    board = profile.get("board")
    _require(isinstance(board, dict), "board must be an object")
    _require(isinstance(board.get("id"), str) and BOARD_ID_RE.fullmatch(board["id"]),
             "board.id must be a stable lowercase ID up to 40 characters")
    for key, limit in (("name", 47), ("revision", 15)):
        _require(isinstance(board.get(key), str) and 0 < len(board[key]) <= limit,
                 f"board.{key} must be 1..{limit} characters")

    target = profile.get("target")
    _require(isinstance(target, dict) and target.get("chip") in TARGET_IDS,
             "target.chip must be esp32 or esp32-s3")
    chip = target["chip"]
    catalog = _target_catalog(chip)
    valid_gpio = set(catalog["gpio"])
    input_only = set(catalog.get("input_only_gpio", []))
    straps = set(catalog.get("strapping_gpio", []))
    reviewed_straps = target.get("reviewed_strapping_gpio", [])
    _require(isinstance(reviewed_straps, list) and
             all(isinstance(pin, int) and pin in straps for pin in reviewed_straps),
             "target.reviewed_strapping_gpio must contain only target strapping GPIOs")
    reviewed_straps = set(reviewed_straps)

    buses = profile.get("buses", [])
    devices = profile.get("devices", [])
    ports = profile.get("ports")
    _require(isinstance(buses, list) and len(buses) <= MAX_BUSES,
             f"buses must contain at most {MAX_BUSES} entries")
    _require(isinstance(devices, list) and len(devices) <= MAX_DEVICES,
             f"devices must contain at most {MAX_DEVICES} entries")
    _require(isinstance(ports, list) and 0 < len(ports) <= MAX_PORTS,
             f"ports must contain 1..{MAX_PORTS} entries")

    all_ids: set[str] = set()

    def stable_id(owner: dict, where: str) -> str:
        value = owner.get("id")
        _require(isinstance(value, str) and ID_RE.fullmatch(value),
                 f"{where}.id is not a valid stable ID")
        _require(value not in all_ids, f"duplicate stable ID {value!r}")
        all_ids.add(value)
        return value

    def gpio(value: object, where: str, *, output: bool = False) -> None:
        if value == -1:
            return
        _require(isinstance(value, int) and value in valid_gpio,
                 f"{where} GPIO {value!r} does not exist on {chip}")
        _require(not output or value not in input_only,
                 f"{where} GPIO {value} is input-only on {chip}")
        if value in straps and value not in reviewed_straps:
            warnings.append(f"{where} uses boot-strapping GPIO {value}")

    gpio_owners: dict[int, str] = {}
    device_channel_owners: dict[tuple[str, int], str] = {}

    def claim_gpio(value: object, owner: str, *, same_owner_ok: bool = False) -> None:
        if value == -1:
            return
        prior = gpio_owners.get(value)
        _require(prior is None or (same_owner_ok and prior == owner),
                 f"GPIO {value} is claimed by both {prior} and {owner}")
        gpio_owners[value] = owner

    bus_ids: set[str] = set()
    bus_kinds: dict[str, str] = {}
    for index, bus in enumerate(buses):
        _require(isinstance(bus, dict), f"buses[{index}] must be an object")
        bus_id = stable_id(bus, f"buses[{index}]")
        bus_ids.add(bus_id)
        bus_kinds[bus_id] = bus.get("kind")
        _require(bus.get("kind") in {"i2c", "spi", "uart", "onewire"},
                 f"bus {bus_id} has unsupported kind")
        pins = bus.get("pins")
        _require(isinstance(pins, dict), f"bus {bus_id} requires pins")
        required = {
            "i2c": {"sda", "scl"},
            "spi": {"sck", "miso"},
            "uart": {"tx"},
            "onewire": {"data"},
        }[bus["kind"]]
        _require(required.issubset(pins) and all(isinstance(pins[key], int) and pins[key] >= 0 for key in required),
                 f"bus {bus_id} is missing required {bus['kind']} pins")
        _require(len([pins[key] for key in required]) == len(set(pins[key] for key in required)),
                 f"bus {bus_id} reuses one GPIO for multiple required signals")
        for key, value in pins.items():
            gpio(value, f"bus {bus_id}.{key}", output=key in {"sck", "mosi", "sda", "scl", "tx"})
            claim_gpio(value, f"bus {bus_id}.{key}")

    device_ids: set[str] = set()
    for index, device in enumerate(devices):
        _require(isinstance(device, dict), f"devices[{index}] must be an object")
        device_id = stable_id(device, f"devices[{index}]")
        device_ids.add(device_id)
        _require(isinstance(device.get("driver"), str) and ID_RE.fullmatch(device["driver"]),
                 f"device {device_id} has invalid driver")
        if "bus" in device:
            _require(device["bus"] in bus_ids, f"device {device_id} refers to missing bus")
        if "address" in device:
            _require(isinstance(device["address"], int) and 0 <= device["address"] <= 127,
                     f"device {device_id} has invalid I2C address")
        select = device.get("select", {})
        if isinstance(select, dict) and "gpio" in select:
            gpio(select["gpio"], f"device {device_id}.select", output=True)
            claim_gpio(select["gpio"], f"device {device_id}.select")

    fixed = profile.get("fixed_functions", {})
    _require(isinstance(fixed, dict), "fixed_functions must be an object")
    for key in ("status_led", "buzzer"):
        if key not in fixed:
            continue
        item = fixed[key]
        _require(isinstance(item, dict) and isinstance(item.get("gpio"), int),
                 f"fixed_functions.{key} requires gpio")
        _require(item.get("safe_demand") == 0,
                 f"fixed_functions.{key} requires safe_demand 0")
        if key == "status_led":
            _require(item.get("type", "gpio") in {"gpio", "neopixel"},
                     "fixed status_led type must be gpio or neopixel")
        gpio(item["gpio"], f"fixed_functions.{key}", output=True)
        claim_gpio(item["gpio"], f"fixed_functions.{key}")
    if "servo_output_enable" in fixed:
        item = fixed["servo_output_enable"]
        _require(isinstance(item, dict) and isinstance(item.get("gpio"), int),
                 "fixed_functions.servo_output_enable requires gpio")
        _require(isinstance(item.get("active_high"), bool),
                 "fixed_functions.servo_output_enable requires active_high")
        _require(item.get("safe_demand") == 0,
                 "fixed_functions.servo_output_enable requires safe_demand 0")
        gpio(item["gpio"], "fixed_functions.servo_output_enable", output=True)
        claim_gpio(item["gpio"], "fixed_functions.servo_output_enable")
    if "supply_voltage" in fixed:
        item = fixed["supply_voltage"]
        _require(isinstance(item, dict) and isinstance(item.get("gpio"), int),
                 "fixed_functions.supply_voltage requires gpio")
        _require(isinstance(item.get("divider"), (int, float)) and
                 1 <= item["divider"] <= 100,
                 "fixed_functions.supply_voltage divider must be 1..100")
        gpio(item["gpio"], "fixed_functions.supply_voltage")
        claim_gpio(item["gpio"], "fixed_functions.supply_voltage")
    for key in ("cluster_serial", "mavlink"):
        if key not in fixed:
            continue
        item = fixed[key]
        _require(isinstance(item, dict) and bus_kinds.get(item.get("bus")) == "uart",
                 f"fixed_functions.{key} must refer to a UART bus")

    for index, port in enumerate(ports):
        _require(isinstance(port, dict), f"ports[{index}] must be an object")
        port_id = stable_id(port, f"ports[{index}]")
        _require(isinstance(port.get("label"), str) and 0 < len(port["label"]) <= 31,
                 f"port {port_id} label must be 1..31 characters")
        modes = port.get("modes")
        _require(isinstance(modes, list) and 0 < len(modes) <= MAX_MODES,
                 f"port {port_id} must have 1..{MAX_MODES} modes")
        mode_ids: set[str] = set()
        native_output_levels: dict[int, bool] = {}
        for mode_index, mode in enumerate(modes):
            _require(isinstance(mode, dict), f"port {port_id} mode {mode_index} must be an object")
            mode_id = mode.get("id")
            _require(isinstance(mode_id, str) and ID_RE.fullmatch(mode_id),
                     f"port {port_id} has invalid mode ID")
            _require(mode_id not in mode_ids, f"port {port_id} repeats mode {mode_id}")
            mode_ids.add(mode_id)
            adapter = mode.get("adapter")
            _require(isinstance(adapter, str) and ID_RE.fullmatch(adapter),
                     f"port {port_id}/{mode_id} has invalid adapter")
            _require(mode.get("pull", "none") in {"none", "up", "down"},
                     f"port {port_id}/{mode_id} pull must be none, up, or down")
            if "reference_mv" in mode:
                _require(isinstance(mode["reference_mv"], (int, float)) and
                         1000 <= mode["reference_mv"] <= 5500,
                         f"port {port_id}/{mode_id} reference_mv must be 1000..5500")
            if adapter not in ADAPTERS:
                warnings.append(f"port {port_id}/{mode_id} uses adapter {adapter!r} not supported by this firmware")
            if "device" in mode:
                _require(mode["device"] in device_ids,
                         f"port {port_id}/{mode_id} refers to missing device")
            endpoint = mode.get("endpoint", {})
            if isinstance(endpoint, dict) and "gpio" in endpoint:
                output = adapter.endswith("_output") or adapter in {"relay_output", "pwm_output", "servo_output"}
                gpio(endpoint["gpio"], f"port {port_id}/{mode_id}", output=output)
                claim_gpio(endpoint["gpio"], f"port {port_id}", same_owner_ok=True)
            if "device" in mode:
                resource = (mode["device"], mode.get("channel", 0))
                prior = device_channel_owners.get(resource)
                _require(prior is None or prior == port_id,
                         f"device channel {resource[0]}:{resource[1]} is claimed by ports {prior} and {port_id}")
                device_channel_owners[resource] = port_id
            if adapter.endswith("_output") or adapter in {"relay_output", "pwm_output", "servo_output"}:
                _require("safe_demand" in mode, f"output port {port_id}/{mode_id} requires safe_demand")
                _require(isinstance(mode["safe_demand"], (int, float)) and 0 <= mode["safe_demand"] <= 1,
                         f"port {port_id}/{mode_id} safe_demand must be 0..1")
                pin = endpoint.get("gpio") if isinstance(endpoint, dict) else None
                if isinstance(pin, int) and not adapter.startswith("i2c_"):
                    active_high = mode.get("active_high", True)
                    proportional = adapter in {"pwm_output", "servo_output"}
                    physical_level = (not active_high) if proportional else (
                        mode["safe_demand"] >= 0.5 if active_high
                        else mode["safe_demand"] < 0.5
                    )
                    prior_level = native_output_levels.get(pin)
                    _require(prior_level is None or prior_level == physical_level,
                             f"multipurpose port {port_id} output modes disagree on GPIO {pin} boot-safe level")
                    native_output_levels[pin] = physical_level

    if strict and warnings:
        raise ProfileError("strict validation warnings:\n- " + "\n- ".join(warnings))
    return warnings


def canonical_payload(profile: dict) -> bytes:
    payload = (json.dumps(profile, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    _require(len(payload) <= MAX_PAYLOAD, f"canonical profile is {len(payload)} bytes; maximum is {MAX_PAYLOAD}")
    return payload


def build_container(profile: dict, *, official: bool = False) -> bytes:
    validate_profile(profile, strict=official)
    payload = canonical_payload(profile)
    version = profile["format_version"]
    target_id = TARGET_IDS[profile["target"]["chip"]]
    origin = ORIGIN_OFFICIAL if official else ORIGIN_CUSTOM
    header = HEADER.pack(
        MAGIC, CONTAINER_VERSION, ENCODING_JSON, version["major"], version["minor"],
        target_id, origin, HEADER.size, len(payload), zlib.crc32(payload) & 0xFFFFFFFF,
        b"\0" * 12,
    )
    return header + payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path)
    parser.add_argument("--output", "-o", type=Path, help="write flashable .bin container")
    parser.add_argument("--official", action="store_true", help="treat warnings as errors and mark official")
    args = parser.parse_args()
    try:
        profile = _load_json(args.profile)
        warnings = validate_profile(profile, strict=args.official)
        for warning in warnings:
            print(f"warning: {warning}", file=sys.stderr)
        if args.output:
            data = build_container(profile, official=args.official)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(data)
            print(f"Wrote {args.output} ({len(data)} bytes)")
        else:
            print(f"Valid {profile['target']['chip']} profile: {profile['board']['name']} rev {profile['board']['revision']}")
        return 0
    except ProfileError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
