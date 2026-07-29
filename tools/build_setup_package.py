#!/usr/bin/env python3
r"""Build OpenTurbine_Recommended.zip for the Windows setup tool.

Run after both firmware environments and their LittleFS images have been built:

    pio run -e esp32dev
    pio run -e esp32dev -t buildfs
    pio run -e esp32s3dev
    pio run -e esp32s3dev -t buildfs
    python tools/build_setup_package.py --esptool C:\path\to\esptool.exe \
        --cp210x-driver C:\path\to\extracted\CP210x_Windows_Drivers \
        --ch340-driver C:\path\to\extracted\wch-serial-drivers

The output ZIP is intentionally deterministic enough for release checks and is
validated before it is written.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_ROOTS = [
    ROOT / ".pio3",
    ROOT / ".pio3" / "build",
    ROOT / ".pio" / "build",
]
WEB_ASSETS = [
    "app.js.gz",
    "calibration.html.gz",
    "config.html.gz",
    "hardware.html.gz",
    "index.html.gz",
    "log.html.gz",
    "sequence.html.gz",
    "style.css.gz",
    "tools.html.gz",
    "theme.js.gz",
    "ui_dialog.js.gz",
]
TARGETS = {
    "esp32dev": {
        "chip": "ESP32",
        "bootloader_address": "0x1000",
        "partition_csv": "partitions.csv",
    },
    "esp32s3dev": {
        "chip": "ESP32-S3",
        "bootloader_address": "0x0000",
        "partition_csv": "partitions_8mb.csv",
    },
}
COMMON_FLASH = [
    ("0x8000", "partitions.bin"),
    ("0xe000", "boot_app0.bin"),
    ("0x10000", "firmware.bin"),
]
PACKAGE_SCHEMA = 3
SETUP_TOOL_VERSION = "0.6.0"
MINIMUM_SETUP_TOOL_VERSION = "0.6.0"


def load_profile_tool():
    spec = importlib.util.spec_from_file_location("openturbine_pcb_profile", ROOT / "tools" / "pcb_profile.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load tools/pcb_profile.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_version() -> str:
    version_h = ROOT / "src" / "system" / "version.h"
    text = version_h.read_text(encoding="utf-8", errors="replace")
    match = re.search(r'#define\s+OT_VERSION\s+"([^"]+)"', text)
    if not match:
        raise RuntimeError(f"Could not find OT_VERSION in {version_h}")
    return match.group(1)


def find_boot_app0() -> Path | None:
    candidates = [
        ROOT / ".pio3" / "packages" / "framework-arduinoespressif32" / "tools" / "partitions" / "boot_app0.bin",
        ROOT / ".pio" / "packages" / "framework-arduinoespressif32" / "tools" / "partitions" / "boot_app0.bin",
        Path.home() / ".platformio" / "packages" / "framework-arduinoespressif32" / "tools" / "partitions" / "boot_app0.bin",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def find_env_build_dir(env: str) -> Path:
    for build_root in BUILD_ROOTS:
        candidate = build_root / env
        if candidate.exists():
            return candidate
    return BUILD_ROOTS[0] / env


def find_esptool(provided: str | None) -> Path | None:
    if provided:
        candidate = Path(provided).expanduser()
        if candidate.exists() and candidate.name.lower() == "esptool.exe":
            return candidate
        return None
    for base in (ROOT / ".pio3", ROOT / ".pio"):
        for candidate in base.glob("packages/**/esptool.exe"):
            if candidate.is_file():
                return candidate
    return None


def partition_offset(csv_name: str, partition_name: str) -> str:
    path = ROOT / csv_name
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 4 and parts[0] == partition_name:
            return parts[3]
    raise RuntimeError(f"Could not find partition {partition_name!r} in {path}")


def partition_size(csv_name: str, partition_name: str) -> int:
    path = ROOT / csv_name
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 5 and parts[0] == partition_name:
            return int(parts[4], 0)
    raise RuntimeError(f"Could not find partition {partition_name!r} in {path}")


def copy_required(src: Path, dst: Path, missing: list[str]) -> None:
    if src.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    else:
        missing.append(str(src.relative_to(ROOT) if src.is_relative_to(ROOT) else src))


def copy_driver_package(src: str | None, dst: Path, *, label: str) -> None:
    if not src:
        return
    path = Path(src).expanduser()
    if not path.exists():
        raise RuntimeError(f"Driver package not found: {path}")
    source_dir = path if path.is_dir() else path.parent
    has_inf = any(source_dir.rglob("*.inf"))
    has_cat = any(source_dir.rglob("*.cat"))
    has_sys = any(source_dir.rglob("*.sys"))
    if not has_inf:
        raise RuntimeError(
            f"{label} driver package {source_dir} has no .inf file. Pass the complete "
            "extracted signed INF/CAT/SYS driver folder, not an installer EXE."
        )
    if not has_cat:
        raise RuntimeError(
            f"{label} driver package {source_dir} has no .cat signature file. Pass the "
            "complete unmodified vendor driver package."
        )
    if not has_sys:
        raise RuntimeError(
            f"{label} driver package {source_dir} has no .sys driver payload. Pass the "
            "complete unmodified vendor driver package."
        )
    shutil.copytree(source_dir, dst, dirs_exist_ok=True)


def stage_package(stage: Path, esptool: Path, cp210x: str | None, ch340: str | None) -> dict:
    missing: list[str] = []
    (stage / "tools").mkdir(parents=True, exist_ok=True)
    copy_required(esptool, stage / "tools" / "esptool.exe", missing)
    copy_driver_package(cp210x, stage / "drivers" / "cp210x", label="CP210x")
    copy_driver_package(ch340, stage / "drivers" / "wch", label="WCH")

    boot_app0 = find_boot_app0()
    if boot_app0 is None:
        missing.append(".pio3/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin")

    manifest = {
        "project": "OpenTurbine",
        "version": read_version(),
        "recommended": True,
        "package_schema": PACKAGE_SCHEMA,
        "setup_tool_version": SETUP_TOOL_VERSION,
        "minimum_setup_tool_version": MINIMUM_SETUP_TOOL_VERSION,
        "targets": {},
    }
    profile_tool = load_profile_tool()
    for target_file in sorted((ROOT / "pcb_profiles" / "targets").glob("*.json")):
        copy_required(target_file, stage / "pcb_profiles" / "targets" / target_file.name, missing)

    for env, meta in TARGETS.items():
        env_stage = stage / env
        env_build = find_env_build_dir(env)
        copy_required(env_build / "bootloader.bin", env_stage / "bootloader.bin", missing)
        copy_required(env_build / "partitions.bin", env_stage / "partitions.bin", missing)
        copy_required(env_build / "firmware.bin", env_stage / "firmware.bin", missing)
        copy_required(env_build / "littlefs.bin", env_stage / "littlefs.bin", missing)
        if boot_app0 is not None:
            copy_required(boot_app0, env_stage / "boot_app0.bin", missing)

        web_stage = env_stage / "web_assets"
        for name in WEB_ASSETS:
            copy_required(ROOT / "data" / name, web_stage / name, missing)

        littlefs_address = partition_offset(meta["partition_csv"], "littlefs")
        profile_address = partition_offset(meta["partition_csv"], "pcbprof")
        profile_partition_bytes = partition_size(meta["partition_csv"], "pcbprof")
        app_partition_bytes = partition_size(meta["partition_csv"], "app0")
        firmware_path = env_build / "firmware.bin"
        firmware_bytes = firmware_path.stat().st_size if firmware_path.exists() else 0
        if firmware_bytes > app_partition_bytes:
            raise RuntimeError(
                f"{env} firmware is {firmware_bytes} bytes but app0 is only "
                f"{app_partition_bytes} bytes"
            )
        firmware_used_pct = round(firmware_bytes * 100.0 / app_partition_bytes, 1)
        if firmware_used_pct >= 90.0:
            print(
                f"warning: {env} firmware uses {firmware_used_pct:.1f}% of its app partition "
                f"({app_partition_bytes - firmware_bytes} bytes free)",
                file=sys.stderr,
            )
        usb_flash = [{"address": meta["bootloader_address"], "file": "bootloader.bin"}]
        usb_flash.extend({"address": address, "file": filename} for address, filename in COMMON_FLASH)
        usb_flash.append({"address": littlefs_address, "file": "littlefs.bin"})
        official_profiles = []
        expected_profile_chip = "esp32-s3" if env == "esp32s3dev" else "esp32"
        for source in sorted((ROOT / "pcb_profiles" / "official").glob("*.otpcb.json")):
            profile = json.loads(source.read_text(encoding="utf-8"))
            if profile.get("target", {}).get("chip") != expected_profile_chip:
                continue
            binary = profile_tool.build_container(profile, official=True)
            if len(binary) > profile_partition_bytes:
                raise RuntimeError(f"{source} is larger than the {env} PCB-profile partition")
            file_name = source.name.removesuffix(".json") + ".bin"
            destination = stage / env / "pcb_profiles" / file_name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(binary)
            official_profiles.append({
                "id": profile["board"]["id"],
                "name": profile["board"]["name"],
                "revision": profile["board"]["revision"],
                "file": f"pcb_profiles/{file_name}",
                "sha256": hashlib.sha256(binary).hexdigest(),
            })
        manifest["targets"][env] = {
            "chip": meta["chip"],
            "firmware_ota": "firmware.bin",
            "firmware_bytes": firmware_bytes,
            "app_partition_bytes": app_partition_bytes,
            "web_assets": "web_assets",
            "usb_flash": usb_flash,
            "pcb_profile": {
                "address": profile_address,
                "size": profile_partition_bytes,
                "official_profiles": official_profiles,
            },
        }

    if missing:
        raise RuntimeError(
            "Cannot build setup package; missing required files:\n  - "
            + "\n  - ".join(missing)
            + "\n\nBuild both PlatformIO environments and pass --esptool C:\\path\\to\\esptool.exe."
        )

    (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def write_zip(stage: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(stage).as_posix())


def write_sha256(output: Path) -> Path:
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    sha_path = output.with_suffix(output.suffix + ".sha256")
    sha_path.write_text(f"{digest}  {output.name}\n", encoding="ascii")
    return sha_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--esptool", help="Path to the Windows esptool.exe to bundle.")
    parser.add_argument("--cp210x-driver", help="Extracted Silicon Labs CP210x driver folder (or a file inside it).")
    parser.add_argument("--ch340-driver", help="Extracted WCH CH340 driver folder (or a file inside it).")
    parser.add_argument(
        "--allow-missing-drivers",
        action="store_true",
        help="Build without one or both driver packages (development only; do not use for releases).",
    )
    parser.add_argument(
        "--output",
        default=str(ROOT / "dist" / "setup_tool" / "OpenTurbine_Recommended.zip"),
        help="Output ZIP path.",
    )
    args = parser.parse_args()

    esptool = find_esptool(args.esptool)
    if esptool is None:
        print("error: esptool.exe was not found; pass --esptool C:\\path\\to\\esptool.exe", file=sys.stderr)
        return 2
    if not args.allow_missing_drivers and (not args.cp210x_driver or not args.ch340_driver):
        print(
            "error: release packages require both --cp210x-driver and --ch340-driver; "
            "use --allow-missing-drivers only for local development",
            file=sys.stderr,
        )
        return 2

    output = Path(args.output).resolve()
    with tempfile.TemporaryDirectory(prefix="openturbine_setup_") as tmp:
        stage = Path(tmp)
        manifest = stage_package(stage, esptool, args.cp210x_driver, args.ch340_driver)
        write_zip(stage, output)
    sha_path = write_sha256(output)

    print(f"wrote {output}")
    print(f"wrote {sha_path}")
    print(f"version {manifest['version']} with targets: {', '.join(manifest['targets'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
