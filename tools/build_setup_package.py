#!/usr/bin/env python3
r"""Build OpenTurbine_Recommended.zip for the Windows setup tool.

Run after both firmware environments and their LittleFS images have been built:

    pio run -e esp32dev
    pio run -e esp32dev -t buildfs
    pio run -e esp32s3dev
    pio run -e esp32s3dev -t buildfs
    python tools/build_setup_package.py --esptool C:\path\to\esptool.exe

The output ZIP is intentionally deterministic enough for release checks and is
validated before it is written.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import struct
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
    "controllers.html.gz",
    "hardware.html.gz",
    "index.html.gz",
    "log.html.gz",
    "sequence.html.gz",
    "style.css.gz",
    "system.html.gz",
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
PACKAGE_SCHEMA = 4
SETUP_TOOL_VERSION = "0.7.1"
MINIMUM_SETUP_TOOL_VERSION = "0.7.0"
ESPTOOL_VERSION = "5.3.0"


def source_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def source_dirty() -> bool:
    """Report source changes while ignoring generated local artifact output."""
    try:
        changed = subprocess.check_output(
            ["git", "status", "--porcelain=v1", "--untracked-files=all"],
            cwd=ROOT,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return True
    for line in changed.splitlines():
        path = line[3:].replace("\\", "/")
        if not path.startswith("artifacts/"):
            return True
    return False


def source_timestamp() -> str:
    try:
        value = subprocess.check_output(
            ["git", "show", "-s", "--format=%cI", "HEAD"], cwd=ROOT, text=True
        ).strip()
        return datetime.fromisoformat(value).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (OSError, subprocess.CalledProcessError, ValueError):
        return "1970-01-01T00:00:00Z"


def image_metadata(path: Path, filename: str, target: str, version: str) -> dict:
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    return {
        "file": filename,
        "target": target,
        "bytes": len(data),
        "sha256": digest,
        "version": version,
        "build_id": runtime_build_id(data) if filename == "firmware.bin" else "",
        "source_commit": source_commit(),
        "source_dirty": source_dirty(),
    }


def runtime_build_id(firmware: bytes) -> str:
    # ESP application images place esp_app_desc_t at the start of segment 0
    # (24-byte image header + 8-byte segment header). Its magic and embedded
    # ELF SHA are the same values returned by /api/device_info at runtime.
    app_desc = 32
    elf_sha = app_desc + 144
    if len(firmware) < elf_sha + 8 or struct.unpack_from("<I", firmware, app_desc)[0] != 0xABCD5432:
        raise RuntimeError("firmware.bin does not contain a valid ESP application descriptor")
    return firmware[elf_sha:elf_sha + 8].hex()


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


def verify_esptool(path: Path) -> None:
    try:
        result = subprocess.run(
            [str(path), "version"], capture_output=True, text=True, timeout=30, check=True
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"esptool self-check failed: {exc}") from exc
    output = result.stdout + result.stderr
    if not re.search(rf"\b{re.escape(ESPTOOL_VERSION)}\b", output):
        raise RuntimeError(
            f"Expected standalone esptool {ESPTOOL_VERSION}; self-check reported: {output.strip()}"
        )


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


def stage_package(stage: Path, esptool: Path, esptool_license: Path | None = None) -> dict:
    missing: list[str] = []
    (stage / "tools").mkdir(parents=True, exist_ok=True)
    copy_required(esptool, stage / "tools" / "esptool.exe", missing)
    license_path = esptool_license or (esptool.parent / "LICENSE")
    copy_required(license_path, stage / "tools" / "esptool-LICENSE", missing)
    copy_required(ROOT / "LICENSE", stage / "LICENSE", missing)
    copy_required(ROOT / "THIRD_PARTY_NOTICES.md", stage / "THIRD_PARTY_NOTICES.md", missing)

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
        "source_commit": source_commit(),
        "source_dirty": source_dirty(),
        "bundled_tools": {
            "esptool": {
                "version": ESPTOOL_VERSION,
                "source": f"https://github.com/espressif/esptool/tree/v{ESPTOOL_VERSION}",
                "license": "GPL-2.0-or-later",
                "sha256": hashlib.sha256(esptool.read_bytes()).hexdigest(),
            }
        },
        "targets": {},
    }
    commit = manifest["source_commit"]
    sbom = {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"OpenTurbine-{manifest['version']}",
        "documentNamespace": f"https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/releases/spdx/{commit}",
        "creationInfo": {
            "created": source_timestamp(),
            "creators": [f"Tool: OpenTurbine Setup package builder {SETUP_TOOL_VERSION}"],
        },
        "packages": [
            {
                "name": "OpenTurbine",
                "SPDXID": "SPDXRef-Package-OpenTurbine",
                "versionInfo": manifest["version"],
                "downloadLocation": f"https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/tree/{commit}",
                "filesAnalyzed": False,
                "licenseConcluded": "MIT",
                "licenseDeclared": "MIT",
            },
            {
                "name": "esptool",
                "SPDXID": "SPDXRef-Package-esptool",
                "versionInfo": ESPTOOL_VERSION,
                "downloadLocation": f"https://github.com/espressif/esptool/tree/v{ESPTOOL_VERSION}",
                "filesAnalyzed": False,
                "licenseConcluded": "GPL-2.0-or-later",
                "licenseDeclared": "GPL-2.0-or-later",
                "checksums": [{
                    "algorithm": "SHA256",
                    "checksumValue": manifest["bundled_tools"]["esptool"]["sha256"],
                }],
            },
        ],
        "relationships": [
            {"spdxElementId": "SPDXRef-DOCUMENT", "relationshipType": "DESCRIBES", "relatedSpdxElement": "SPDXRef-Package-OpenTurbine"},
            {"spdxElementId": "SPDXRef-Package-OpenTurbine", "relationshipType": "CONTAINS", "relatedSpdxElement": "SPDXRef-Package-esptool"},
        ],
    }
    (stage / "SBOM.spdx.json").write_text(json.dumps(sbom, indent=2) + "\n", encoding="utf-8")
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
        version = manifest["version"]
        flash_layout = [(meta["bootloader_address"], "bootloader.bin"), *COMMON_FLASH,
                        (littlefs_address, "littlefs.bin")]
        usb_flash = []
        for address, filename in flash_layout:
            entry = {"address": address}
            entry.update(image_metadata(env_stage / filename, filename, env, version))
            usb_flash.append(entry)
        firmware_digest = hashlib.sha256((env_stage / "firmware.bin").read_bytes()).hexdigest()
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
            "firmware_sha256": firmware_digest,
            "build_id": runtime_build_id((env_stage / "firmware.bin").read_bytes()),
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
    parser.add_argument("--esptool-license", help="Path to the matching esptool GPL license file.")
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
    try:
        verify_esptool(esptool)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    esptool_license = Path(args.esptool_license).resolve() if args.esptool_license else None
    if esptool_license is not None and not esptool_license.is_file():
        print(f"error: esptool license was not found: {esptool_license}", file=sys.stderr)
        return 2

    output = Path(args.output).resolve()
    with tempfile.TemporaryDirectory(prefix="openturbine_setup_") as tmp:
        stage = Path(tmp)
        manifest = stage_package(stage, esptool, esptool_license)
        write_zip(stage, output)
    sha_path = write_sha256(output)

    print(f"wrote {output}")
    print(f"wrote {sha_path}")
    print(f"version {manifest['version']} with targets: {', '.join(manifest['targets'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
