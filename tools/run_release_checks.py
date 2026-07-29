#!/usr/bin/env python3
"""Run the complete OpenTurbine pre-release verification gate.

The default run rebuilds web assets, exercises source/UI/package tests, builds
both firmware and filesystem targets, and enforces partition/linker margins.
Use --skip-build only for a quick edit-time pass; it is not a release result.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def run(label: str, command: list[str], cwd: Path = ROOT) -> None:
    print(f"\n=== {label} ===", flush=True)
    result = subprocess.run(command, cwd=cwd, env=os.environ.copy())
    if result.returncode:
        raise SystemExit(f"{label} failed with exit code {result.returncode}")


def pio_command() -> list[str]:
    wrapper = ROOT / "tools" / "pio.cmd"
    if os.name == "nt" and wrapper.exists():
        return [str(wrapper)]
    executable = shutil.which("pio") or shutil.which("platformio")
    if not executable:
        raise SystemExit("PlatformIO was not found")
    return [executable]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="skip firmware/filesystem builds and budgets (development only)",
    )
    args = parser.parse_args()

    os.environ.setdefault("PYTHONUTF8", "1")
    python = sys.executable
    node = shutil.which("node")
    go = shutil.which("go")
    if not node:
        raise SystemExit("Node.js was not found")
    if not go:
        raise SystemExit("Go was not found")

    run("assemble and compress web assets", [python, "tools/gzip_data.py"])
    run(
        "generate public Config reference",
        [node, "tools/generate_site_config_reference.cjs"],
    )
    run("public-content validation", [python, "tools/validate_public_content.py"])
    run("UI audit suite", [node, "tools/run_ui_audits.cjs"])
    run("safety regression audit", [node, "tools/safety_regression_audit.cjs"])
    run("turbine setup matrix", [node, "tools/turbine_setup_matrix_test.cjs"])
    run("I2C and load-cell audit", [node, "tools/i2c_support_audit.cjs"])
    run(
        "setup-package Python tests",
        [python, "-m", "unittest", "tools/test_build_setup_package.py"],
    )
    run("setup-tool Go tests", [go, "test", "./..."], ROOT / "tools" / "setup_tool")

    if args.skip_build:
        print("\nQuick checks passed (builds intentionally skipped).")
        return 0

    pio = pio_command()
    for env, partitions, minimum_dram in (
        ("esp32dev", "partitions.csv", "16384"),
        ("esp32s3dev", "partitions_8mb.csv", "65536"),
    ):
        run(f"{env} firmware", pio + ["run", "-e", env, "-j", "2"])
        run(f"{env} LittleFS", pio + ["run", "-e", env, "-t", "buildfs", "-j", "2"])
        run(
            f"{env} image and linker budgets",
            [
                python,
                "tools/check_firmware_budget.py",
                "--partitions",
                partitions,
                "--firmware",
                f".pio3/{env}/firmware.bin",
                "--filesystem",
                f".pio3/{env}/littlefs.bin",
                "--map",
                f".pio3/{env}/firmware.map",
                "--minimum-dram-headroom",
                minimum_dram,
            ],
        )

    print("\nAll OpenTurbine release checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
