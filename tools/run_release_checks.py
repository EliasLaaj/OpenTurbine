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
from contextlib import nullcontext
import shutil
import subprocess
import sys
import tempfile

from run_native_behavior_tests import compiler_command, run_fresh_executable


ROOT = Path(__file__).resolve().parents[1]


def run(
    label: str,
    command: list[str],
    cwd: Path = ROOT,
    env_overrides: dict[str, str] | None = None,
) -> None:
    print(f"\n=== {label} ===", flush=True)
    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)
    result = subprocess.run(command, cwd=cwd, env=env)
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
    run("real native command/state behavior", [python, "tools/run_native_behavior_tests.py"])
    host_tmp = ROOT / "artifacts" if os.name == "nt" else None
    if host_tmp is not None:
        host_tmp.mkdir(exist_ok=True)
    tmp_context = (nullcontext(str(host_tmp)) if host_tmp is not None else
                   tempfile.TemporaryDirectory(prefix="ot-sensor-vectors-"))
    with tmp_context as tmp:
        compiler = compiler_command()
        sensor_exe = str(Path(tmp) / ("sensor_vectors.exe" if os.name == "nt" else "sensor_vectors"))
        run("extended real sensor protocol vectors", compiler + ["-std=c++17", "tools/sensor_protocol_vectors.cpp", "-o", sensor_exe])
        print("\n=== execute extended sensor protocol vectors ===", flush=True)
        run_fresh_executable([sensor_exe], cwd=ROOT, label="sensor vectors")
    run(
        "Python release-tool and bench tests",
        [
            python,
            "-m",
            "unittest",
            "tools/test_build_setup_package.py",
            "tools/test_pcb_profile.py",
            "tools/test_run_native_behavior_tests.py",
        ],
    )
    run(
        "HIL harness and qualification-contract tests",
        [python, "-m", "unittest", "discover", "-s", "dev/bench/harness", "-p", "test_*.py"],
    )
    setup_tool_dir = ROOT / "tools" / "setup_tool"
    if os.name == "nt":
        run("setup-tool Go tests", [go, "test", "./..."], setup_tool_dir)
    else:
        # The setup tool deliberately uses Windows build tags throughout. A
        # Linux gate cannot execute its tests, but it must still prove that the
        # complete Windows package and tests compile. The Windows release gate
        # above executes the same tests before it is allowed to publish.
        with tempfile.TemporaryDirectory(prefix="ot-setup-test-") as tmp:
            run(
                "setup-tool Windows test compile",
                [go, "test", "-c", "-o", str(Path(tmp) / "setup_tool_tests.exe"), "./..."],
                setup_tool_dir,
                {"GOOS": "windows", "GOARCH": "amd64"},
            )

    if args.skip_build:
        print("\nQuick checks passed (builds intentionally skipped).")
        return 0

    pio = pio_command()
    for env, partitions, minimum_dram, app_reserve, filesystem_free in (
        # Classic is now feature-complete inside its fixed 1.625 MiB OTA
        # slots. Keep a hard 32 KiB image margin and roughly 140 KiB of raw
        # LittleFS working/log space; the S3 retains the broader defaults.
        ("esp32dev", "partitions.csv", "16384", "0x8000", "0x23000"),
        ("esp32s3dev", "partitions_8mb.csv", "65536", "0x10000", "0x28000"),
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
                "--filesystem-source",
                "data",
                "--map",
                f".pio3/{env}/firmware.map",
                "--minimum-dram-headroom",
                minimum_dram,
                "--app-reserve",
                app_reserve,
                "--minimum-filesystem-free",
                filesystem_free,
            ],
        )

    print("\nAll OpenTurbine release checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
