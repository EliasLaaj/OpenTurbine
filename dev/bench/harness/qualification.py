"""Strict OpenTurbine HIL qualification orchestration.

This module intentionally treats missing evidence as failure.  It wraps the
individual bench campaigns, fingerprints the exact worktree and supplied
artifacts, captures every command's output, and produces one machine-readable
summary suitable for release review.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[3]
HARNESS = ROOT / "dev" / "bench" / "harness"
CAMPAIGN = ROOT / "dev" / "bench" / "campaign"


S3_CAMPAIGNS = (
    "ten_build_webui_hil.py",
    "phase2_safety_hil.py",
    "v2_controls_hil.py",
    "interaction_hil.py",
    "afterburner_limp_hil.py",
    "shutdown_output_ownership_hil.py",
    "finalstop_live_config_hil.py",
    "session_logger_hil.py",
    "i2c_devices_hil.py",
    "plant_hil.py",
    "reboot_recovery_hil.py",
)

CLASSIC_CAMPAIGNS = (
    "classic_pinfunc_test.py",
    "classic_safety_hil.py",
    "reversed_digital_sensor_hil.py",
    "role_reversed_outputs_test.py",
    "plant_hil.py",
    "reboot_recovery_hil.py",
)

CAMPAIGN_GATES = {
    "ten_build_webui_hil.py": ["Q20", "Q30", "Q40"],
    "phase2_safety_hil.py": ["Q70", "Q90"],
    "v2_controls_hil.py": ["Q70", "Q80"],
    "interaction_hil.py": ["Q60", "Q70", "Q80", "Q90"],
    "afterburner_limp_hil.py": ["Q70", "Q80", "Q90"],
    "shutdown_output_ownership_hil.py": ["Q50", "Q90"],
    "finalstop_live_config_hil.py": ["Q40", "Q50", "Q100"],
    "session_logger_hil.py": ["Q100", "Q110"],
    "i2c_devices_hil.py": ["Q20", "Q30", "Q90"],
    "reversed_digital_sensor_hil.py": ["Q20", "Q90"],
    "plant_hil.py": ["Q50", "Q70", "Q80", "Q90", "Q110"],
    "reboot_recovery_hil.py": ["Q10", "Q100"],
    "classic_pinfunc_test.py": ["Q20", "Q30", "Q70", "Q120"],
    "classic_safety_hil.py": ["Q90", "Q120"],
    "role_reversed_outputs_test.py": ["Q30", "Q120"],
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def esp_firmware_elf_sha256(path: str) -> str:
    """Read the full ELF SHA embedded in ESP-IDF's app descriptor."""
    data = Path(path).read_bytes()
    magic = b"\x32\x54\xcd\xab"  # ESP_APP_DESC_MAGIC_WORD, little endian
    offset = data.find(magic)
    sha_offset = offset + 144
    if offset < 0 or sha_offset + 32 > len(data):
        raise ValueError("firmware does not contain a complete ESP app descriptor: %s" % path)
    digest = data[sha_offset:sha_offset + 32]
    if not any(digest):
        raise ValueError("firmware app descriptor has an empty ELF SHA: %s" % path)
    return digest.hex()


def esp_firmware_build_id(path: str) -> str:
    return esp_firmware_elf_sha256(path)[:16]


def git_output(*args: str) -> bytes:
    return subprocess.check_output(
        ["git", *args], cwd=ROOT, stderr=subprocess.STDOUT
    )


def worktree_fingerprint() -> dict:
    commit = git_output("rev-parse", "HEAD").decode().strip()
    status = git_output("status", "--porcelain=v1", "-z")
    diff = git_output("diff", "--binary", "--no-ext-diff", "HEAD", "--")
    untracked = sorted(
        item.decode(errors="surrogateescape")
        for item in status.split(b"\0")
        if item and item[:2] == b"??"
    )
    # The diff does not contain untracked contents. Hash their paths and bytes
    # so changing a new source file also invalidates the qualification identity.
    untracked_digest = hashlib.sha256()
    for entry in untracked:
        relative = entry[3:] if entry.startswith("?? ") else entry
        path = ROOT / relative
        untracked_digest.update(relative.encode("utf-8", errors="surrogateescape"))
        if path.is_file():
            untracked_digest.update(path.read_bytes())
        elif path.is_dir():
            for child in sorted(item for item in path.rglob("*") if item.is_file()):
                child_relative = child.relative_to(ROOT).as_posix()
                untracked_digest.update(child_relative.encode("utf-8"))
                untracked_digest.update(child.read_bytes())
    return {
        "commit": commit,
        "status_sha256": sha256_bytes(status),
        "tracked_diff_sha256": sha256_bytes(diff),
        "untracked_sha256": untracked_digest.hexdigest(),
        "dirty": bool(status),
    }


REQUIRED_ARTIFACTS = {
    "firmware", "elf", "filesystem", "partitions", "setup_package",
    "tester_firmware", "pcb_profile", "pinmap",
}
REQUIRED_FIXTURE_SIGNALS = {
    "START", "STOP", "N1", "N2", "THROTTLE_IN", "OILP", "FLAME",
    "IDLE_IN", "THROTTLE_OUT", "STARTER_OUT", "OILPUMP_OUT",
    "FUEL_SOL", "IGNITER", "STARTER_EN",
}


def artifact_manifest(paths: list[str]) -> dict:
    records = {}
    for raw in paths:
        if "=" not in raw:
            raise ValueError("artifact must be NAME=PATH: %s" % raw)
        name, raw_path = raw.split("=", 1)
        name = name.strip()
        if not name or name in records:
            raise ValueError("artifact name is empty or duplicated: %s" % name)
        path = Path(raw_path).resolve()
        if not path.is_file():
            raise FileNotFoundError("qualification artifact not found: %s" % path)
        records[name] = {
            "path": str(path),
            "size": path.stat().st_size,
            "sha256": sha256_file(path),
        }
    return records


def validate_pinmap_target(path: str, target: str) -> None:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    meta = data.get("meta", {})
    declared = str(meta.get("dut_target") or "").strip().lower()
    board = str(meta.get("dut_board") or "").strip().lower()
    if not declared:
        declared = "s3" if "s3" in board else "classic" if "classic" in board or "esp32dev" in board else ""
    aliases = {"esp32": "classic", "esp32-classic": "classic", "esp32s3": "s3", "esp32-s3": "s3"}
    declared = aliases.get(declared, declared)
    if declared != target:
        raise ValueError("pin map declares DUT target %r, qualification target is %r" %
                         (declared or "unknown", target))


def validate_release_pinmap(path: str) -> None:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    fitted = {signal.get("name") for signal in data.get("signals", []) if isinstance(signal, dict)}
    missing = sorted(REQUIRED_FIXTURE_SIGNALS - fitted)
    if missing:
        raise ValueError("release fixture pin map is incomplete; missing: %s" % ", ".join(missing))


def get_json(base: str, path: str) -> dict:
    with urllib.request.urlopen(base.rstrip("/") + path, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def api_snapshot(base: str) -> dict:
    status = get_json(base, "/api/status")
    device_info = get_json(base, "/api/device_info")
    hardware = get_json(base, "/api/hardware")
    config = get_json(base, "/api/config")
    return {
        "status": status,
        "device_info": device_info,
        "hardware_sha256": sha256_bytes(
            json.dumps(hardware, sort_keys=True, separators=(",", ":")).encode()
        ),
        "config_sha256": sha256_bytes(
            json.dumps(config, sort_keys=True, separators=(",", ":")).encode()
        ),
    }


def build_commands(target: str, port: str, dut: str, result_dir: Path,
                   quick: bool = False, pinmap: str | None = None) -> list[dict]:
    python = sys.executable
    common = ["--port", port, "--dut", dut]
    if pinmap:
        common.extend(["--pinmap", pinmap])
    commands = [
        {"id": "doctor", "gates": ["Q00", "Q01"], "repetitions": 1,
         "argv": [python, str(HARNESS / "run.py"), *common, "doctor"]},
        {"id": "verify_wiring", "gates": ["Q00", "Q20", "Q30"], "repetitions": 1,
         "argv": [python, str(HARNESS / "run.py"), *common, "verify-wiring", "--require-all"]},
        {
            "id": "core_advanced", "gates": ["Q10", "Q20", "Q30", "Q40", "Q50"],
            "repetitions": 1 if quick else 3,
            "argv": [python, str(HARNESS / "run.py"), *common, "run", "--advanced",
                     "--require-all", "--json", str(result_dir / "core_advanced_{run}.json")],
        },
    ]
    release_repetitions = {
        "ten_build_webui_hil.py": 3,
        "phase2_safety_hil.py": 20,
        "v2_controls_hil.py": 3,
        "interaction_hil.py": 10,
        "afterburner_limp_hil.py": 10,
        "shutdown_output_ownership_hil.py": 10,
        "finalstop_live_config_hil.py": 10,
        "session_logger_hil.py": 3,
        "i2c_devices_hil.py": 100,
        "reversed_digital_sensor_hil.py": 20,
        "plant_hil.py": 100,
        "reboot_recovery_hil.py": 1,
        "classic_pinfunc_test.py": 3,
        "classic_safety_hil.py": 20,
        "role_reversed_outputs_test.py": 3,
    }
    target_campaigns = CLASSIC_CAMPAIGNS if target == "classic" else S3_CAMPAIGNS
    for script in target_campaigns:
        command = {
            "id": Path(script).stem,
            "argv": [python, str(CAMPAIGN / script)],
            "gates": CAMPAIGN_GATES[script],
            "repetitions": 1 if quick else release_repetitions[script],
        }
        if script == "reboot_recovery_hil.py":
            command["env"] = {
                "OPENTURBINE_REBOOT_REPETITIONS": "10" if quick else "50"
            }
        commands.append(command)
    commands.append({
        "id": "plant_soak_24h",
        "gates": ["Q110"],
        "argv": [python, str(CAMPAIGN / "plant_hil.py")],
        "repetitions": 1,
        "env": {"OTBENCH_PLANT_SOAK_SECONDS": "60" if quick else "86400"},
    })
    return commands


def run_command(spec: dict, env: dict, result_dir: Path, repetition: int = 1) -> dict:
    started = time.monotonic()
    command_env = env.copy()
    command_env.update(spec.get("env", {}))
    argv = [part.format(run="%03d" % repetition) for part in spec["argv"]]
    completed = subprocess.run(
        argv, cwd=ROOT, env=command_env, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
        check=False,
    )
    duration = time.monotonic() - started
    log_path = result_dir / ("%s_%03d.log" % (spec["id"], repetition))
    log_path.write_text(completed.stdout, encoding="utf-8")
    return {
        "id": spec["id"],
        "gates": spec.get("gates", []),
        "repetition": repetition,
        "argv": argv,
        "returncode": completed.returncode,
        "ok": completed.returncode == 0,
        "duration_s": round(duration, 3),
        "log": str(log_path),
        "log_sha256": sha256_file(log_path),
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Strict OpenTurbine HIL qualification runner")
    parser.add_argument("--target", choices=("classic", "s3"), required=True)
    parser.add_argument("--port", required=True, help="OTBench tester serial port")
    parser.add_argument("--dut", default="http://192.168.4.1")
    parser.add_argument("--artifact", action="append", default=[],
                        help="NAME=PATH exact release artifact; required names: firmware, elf, filesystem, partitions, setup_package, tester_firmware, pcb_profile (pinmap is added from --pinmap)")
    parser.add_argument("--pinmap", default=str(ROOT / "dev" / "bench" / "pinmap.json"),
                        help="exact fixture pin-map JSON; hashed into the manifest")
    parser.add_argument("--result-dir", help="new qualification result directory")
    parser.add_argument("--operator", default=os.environ.get("USERNAME") or "unknown")
    parser.add_argument("--fixture-revision", required=True)
    parser.add_argument("--dry-run", action="store_true", help="write manifest and command plan only")
    parser.add_argument("--quick", action="store_true",
                        help="one short development pass; never produces a release qualification PASS")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    result_dir = Path(args.result_dir or ROOT / "dev" / "bench" / "results" /
                      ("qualification_%s_%s" % (args.target, stamp))).resolve()
    result_dir.mkdir(parents=True, exist_ok=False)

    before = worktree_fingerprint()
    artifact_args = list(args.artifact)
    if not any(item.split("=", 1)[0].strip() == "pinmap" for item in artifact_args if "=" in item):
        artifact_args.append("pinmap=" + args.pinmap)
    try:
        artifacts = artifact_manifest(artifact_args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("ERROR:", exc)
        return 2
    pinmap_path = artifacts["pinmap"]["path"]
    try:
        validate_pinmap_target(pinmap_path, args.target)
        if not args.quick and not args.dry_run:
            validate_release_pinmap(pinmap_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("ERROR:", exc)
        return 2
    commands = build_commands(
        args.target, args.port, args.dut, result_dir, quick=args.quick, pinmap=pinmap_path
    )
    manifest = {
        "schema": 1,
        "started": dt.datetime.now(dt.timezone.utc).isoformat(),
        "target": args.target,
        "tester_target": "s3" if args.target == "classic" else "classic",
        "operator": args.operator,
        "fixture_revision": args.fixture_revision,
        "dut": args.dut,
        "tester_port": args.port,
        "worktree_before": before,
        "artifacts": artifacts,
        "commands": commands,
        "dry_run": args.dry_run,
        "quick": args.quick,
    }
    (result_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if args.dry_run:
        print("Qualification plan written to %s" % result_dir)
        return 0
    missing_artifacts = sorted(REQUIRED_ARTIFACTS - set(artifacts))
    if missing_artifacts:
        print("ERROR: missing required --artifact entries: %s" % ", ".join(missing_artifacts))
        return 2

    env = os.environ.copy()
    env["OTBENCH_PORT"] = args.port
    env["OTBENCH_DUT"] = args.dut
    env["OTBENCH_TARGET"] = args.target
    env["OTBENCH_PINMAP"] = pinmap_path
    try:
        manifest["api_before"] = api_snapshot(args.dut)
    except Exception as exc:  # noqa: BLE001
        manifest["preflight_error"] = "%s: %s" % (type(exc).__name__, exc)
        (result_dir / "qualification.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return 2
    expected_target = "esp32dev" if args.target == "classic" else "esp32s3dev"
    actual_target = manifest["api_before"].get("device_info", {}).get("target")
    if actual_target != expected_target:
        manifest["preflight_error"] = "DUT target %r does not match requested %r" % (
            actual_target, expected_target
        )
        (result_dir / "qualification.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("ERROR:", manifest["preflight_error"])
        return 2
    try:
        embedded_elf_sha = esp_firmware_elf_sha256(artifacts["firmware"]["path"])
        artifact_build_id = embedded_elf_sha[:16]
    except (OSError, ValueError) as exc:
        manifest["preflight_error"] = str(exc)
        (result_dir / "qualification.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("ERROR:", manifest["preflight_error"])
        return 2
    if embedded_elf_sha != artifacts["elf"]["sha256"]:
        manifest["preflight_error"] = (
            "firmware's embedded ELF SHA does not match the supplied ELF artifact"
        )
        (result_dir / "qualification.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("ERROR:", manifest["preflight_error"])
        return 2
    live_build_id = str(manifest["api_before"].get("device_info", {}).get("build_id") or "").lower()
    manifest["artifact_build_id"] = artifact_build_id
    if live_build_id != artifact_build_id:
        manifest["preflight_error"] = (
            "flashed DUT build_id %r does not match firmware artifact %r" %
            (live_build_id, artifact_build_id)
        )
        (result_dir / "qualification.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("ERROR:", manifest["preflight_error"])
        return 2

    results = []
    stopped = False
    for spec in commands:
        for repetition in range(1, int(spec.get("repetitions", 1)) + 1):
            print("[%s] running %s %d/%d" %
                  (args.target, spec["id"], repetition, spec.get("repetitions", 1)), flush=True)
            result = run_command(spec, env, result_dir, repetition=repetition)
            results.append(result)
            print("  %s (%.1fs)" % ("PASS" if result["ok"] else "FAIL", result["duration_s"]), flush=True)
            if not result["ok"]:
                stopped = True
                break
        if stopped:
            break

    manifest["results"] = results
    manifest["worktree_after"] = worktree_fingerprint()
    try:
        manifest["api_after"] = api_snapshot(args.dut)
    except Exception as exc:  # noqa: BLE001
        manifest["postflight_error"] = "%s: %s" % (type(exc).__name__, exc)
    manifest["completed"] = dt.datetime.now(dt.timezone.utc).isoformat()
    expected_runs = sum(int(spec.get("repetitions", 1)) for spec in commands)
    manifest["expected_runs"] = expected_runs
    manifest["all_commands_ran"] = len(results) == expected_runs
    manifest["worktree_unchanged"] = manifest["worktree_after"] == before
    manifest["config_restored"] = (
        manifest.get("api_before", {}).get("hardware_sha256") ==
        manifest.get("api_after", {}).get("hardware_sha256") and
        manifest.get("api_before", {}).get("config_sha256") ==
        manifest.get("api_after", {}).get("config_sha256")
    )
    manifest["device_identity_stable"] = (
        manifest.get("api_before", {}).get("device_info", {}).get("target") ==
        manifest.get("api_after", {}).get("device_info", {}).get("target") and
        manifest.get("api_before", {}).get("device_info", {}).get("build_id") ==
        manifest.get("api_after", {}).get("device_info", {}).get("build_id")
    )
    manifest["passed"] = bool(
        manifest["all_commands_ran"] and
        all(result["ok"] for result in results) and
        manifest["worktree_unchanged"] and
        manifest["config_restored"] and
        manifest["device_identity_stable"] and
        not args.quick and
        not manifest.get("postflight_error")
    )
    output = result_dir / "qualification.json"
    output.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Qualification %s: %s" % ("PASS" if manifest["passed"] else "FAIL", output))
    return 0 if manifest["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
