#!/usr/bin/env python3
"""Fail release builds that outgrow OTA or filesystem safety margins."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
import re


def number(value: str) -> int:
    return int(value.strip(), 0)


def partitions(path: Path) -> dict[str, tuple[int, int]]:
    result: dict[str, tuple[int, int]] = {}
    with path.open(encoding="utf-8-sig", errors="strict", newline="") as source:
        for row in csv.reader(line for line in source if not line.lstrip().startswith("#")):
            if not row or not row[0].strip():
                continue
            if len(row) < 5:
                raise ValueError(f"invalid partition row in {path}: {row}")
            result[row[0].strip()] = (number(row[3]), number(row[4]))
    return result


def linker_region_headroom(path: Path) -> dict[str, tuple[int, int]]:
    """Return used/total bytes for the constrained internal linker regions."""
    text = path.read_text(encoding="utf-8", errors="replace")
    regions: dict[str, tuple[int, int]] = {}
    for name in ("dram0_0_seg", "iram0_0_seg", "rtc_slow_seg"):
        match = re.search(
            rf"(?m)^{re.escape(name)}\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+",
            text,
        )
        if not match:
            raise ValueError(f"{name} is missing from {path}")
        regions[name] = (int(match.group(1), 16), int(match.group(2), 16))

    def symbol(name: str) -> int:
        match = re.search(
            rf"(?m)^\s*0x([0-9a-f]+)\s+{re.escape(name)}\s*=",
            text,
        )
        if not match:
            raise ValueError(f"{name} is missing from {path}")
        return int(match.group(1), 16)

    dram_origin, dram_total = regions["dram0_0_seg"]
    iram_origin, iram_total = regions["iram0_0_seg"]
    _, rtc_total = regions["rtc_slow_seg"]
    return {
        "static DRAM": (symbol("_heap_low_start") - dram_origin, dram_total),
        "IRAM": (symbol("_iram_end") - iram_origin, iram_total),
        "RTC slow": (
            symbol("_rtc_force_slow_end") - symbol("_rtc_data_start"),
            rtc_total,
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--partitions", required=True, type=Path)
    parser.add_argument("--firmware", required=True, type=Path)
    parser.add_argument("--filesystem", type=Path)
    parser.add_argument("--map", type=Path, help="linker map to check internal-memory headroom")
    parser.add_argument("--app-reserve", type=number, default=0x10000)
    parser.add_argument(
        "--minimum-filesystem",
        type=number,
        default=0x90000,
        help="minimum LittleFS partition size (default matches the supported 4 MB layout)",
    )
    parser.add_argument("--filesystem-source", type=Path, help="source directory used to build LittleFS")
    parser.add_argument("--minimum-filesystem-free", type=number, default=0x28000)
    parser.add_argument("--minimum-dram-headroom", type=number, default=0x100)
    parser.add_argument("--minimum-iram-headroom", type=number, default=0x8000)
    parser.add_argument("--minimum-rtc-headroom", type=number, default=0x60)
    args = parser.parse_args()

    table = partitions(args.partitions)
    required = {"app0", "app1", "littlefs"}
    missing = required - table.keys()
    if missing:
        raise SystemExit(f"missing partitions: {', '.join(sorted(missing))}")

    app0 = table["app0"]
    app1 = table["app1"]
    littlefs = table["littlefs"]
    if app0[1] != app1[1]:
        raise SystemExit("OTA app slots must have equal size")
    if app0[0] % 0x10000 or app1[0] % 0x10000:
        raise SystemExit("OTA app offsets must be 64 KiB aligned")
    if app0[0] + app0[1] > app1[0] or app1[0] + app1[1] > littlefs[0]:
        raise SystemExit("app or filesystem partitions overlap")
    if littlefs[1] < args.minimum_filesystem:
        raise SystemExit(
            f"LittleFS is {littlefs[1]} bytes; minimum is {args.minimum_filesystem}"
        )

    firmware_size = args.firmware.stat().st_size
    headroom = app0[1] - firmware_size
    if headroom < args.app_reserve:
        raise SystemExit(
            f"firmware {firmware_size} leaves only {headroom} bytes in the OTA slot; "
            f"required reserve is {args.app_reserve}"
        )
    if args.filesystem:
        filesystem_size = args.filesystem.stat().st_size
        if filesystem_size > littlefs[1]:
            raise SystemExit(
                f"filesystem image {filesystem_size} exceeds partition {littlefs[1]}"
            )
    if args.filesystem_source:
        payload_bytes = sum(
            path.stat().st_size for path in args.filesystem_source.rglob("*") if path.is_file()
        )
        payload_headroom = littlefs[1] - payload_bytes
        if payload_headroom < args.minimum_filesystem_free:
            raise SystemExit(
                f"LittleFS source payload {payload_bytes} leaves only {payload_headroom} bytes; "
                f"required working/log reserve is {args.minimum_filesystem_free}"
            )

    summary = (
        f"OK: firmware={firmware_size}, OTA slot={app0[1]}, headroom={headroom}, "
        f"LittleFS={littlefs[1]}"
    )
    if args.filesystem_source:
        summary += f", source payload={payload_bytes} ({payload_headroom} free before filesystem overhead)"
    if args.map:
        minimums = {
            "static DRAM": args.minimum_dram_headroom,
            "IRAM": args.minimum_iram_headroom,
            "RTC slow": args.minimum_rtc_headroom,
        }
        region_summary = []
        for name, (used, total) in linker_region_headroom(args.map).items():
            remaining = total - used
            if remaining < minimums[name]:
                raise SystemExit(
                    f"{name} leaves only {remaining} bytes in {args.map}; "
                    f"required reserve is {minimums[name]}"
                )
            region_summary.append(f"{name}={used}/{total} ({remaining} free)")
        summary += "; " + ", ".join(region_summary)

    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
