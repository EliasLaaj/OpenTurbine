"""Combine two target qualifications with required physical evidence.

This is deliberately separate from the HIL runner: a software-controlled rig
must not certify its own emergency timing, power integrity, or powered-load
behavior without independent evidence and review.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path


REQUIRED_GATES = {
    "Q00_fixture_safety",
    "Q01_flash_and_filesystem_readback",
    "Q10_boot_reset_brownout_scope",
    "Q20_input_transport_matrix",
    "Q30_output_waveform_and_loads",
    "Q40_commissioning_ui",
    "Q50_sequencer_matrix",
    "Q60_rules_matrix",
    "Q70_controller_source_matrix",
    "Q80_ignition_relight_afterburner",
    "Q90_stop_and_fault_timing",
    "Q100_update_and_recovery",
    "Q110_endurance_review",
    "Q120_cross_platform_review",
    "Q130_powered_actuators",
    "Q130_cold_spin",
    "independent_release_review",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: str) -> tuple[Path, dict]:
    resolved = Path(path).resolve()
    return resolved, json.loads(resolved.read_text(encoding="utf-8"))


def validate_qualification(path: str, target: str) -> tuple[Path, dict, list[str]]:
    resolved, data = read_json(path)
    errors = []
    if data.get("target") != target:
        errors.append("%s qualification target is %r" % (target, data.get("target")))
    if data.get("quick"):
        errors.append("%s qualification is a quick/development run" % target)
    if not data.get("passed"):
        errors.append("%s qualification did not pass" % target)
    if not data.get("all_commands_ran"):
        errors.append("%s qualification did not execute every repetition" % target)
    if not data.get("config_restored"):
        errors.append("%s qualification did not prove configuration restoration" % target)
    if not data.get("worktree_unchanged"):
        errors.append("%s worktree changed during qualification" % target)
    if not data.get("device_identity_stable"):
        errors.append("%s target/build identity changed during qualification" % target)
    return resolved, data, errors


def validate_evidence(path: str) -> tuple[Path, dict, list[str], dict]:
    resolved, data = read_json(path)
    errors = []
    attachments = {}
    gates = data.get("gates", {})
    for gate in sorted(REQUIRED_GATES):
        record = gates.get(gate)
        if not isinstance(record, dict):
            errors.append("missing evidence gate %s" % gate)
            continue
        if record.get("passed") is not True:
            errors.append("evidence gate %s is not passed" % gate)
        if not str(record.get("reviewer") or "").strip():
            errors.append("evidence gate %s has no reviewer" % gate)
        for field in ("method", "acceptance", "result"):
            if not str(record.get(field) or "").strip():
                errors.append("evidence gate %s has no %s" % (gate, field))
        files = record.get("files", [])
        if not files:
            errors.append("evidence gate %s has no attached evidence" % gate)
        for raw in files:
            attachment = (resolved.parent / raw).resolve() if not Path(raw).is_absolute() else Path(raw).resolve()
            if not attachment.is_file():
                errors.append("evidence file missing for %s: %s" % (gate, attachment))
            else:
                if attachment.stat().st_size == 0:
                    errors.append("evidence file is empty for %s: %s" % (gate, attachment))
                attachments[str(attachment)] = {
                    "size": attachment.stat().st_size,
                    "sha256": sha256_file(attachment),
                }
    return resolved, data, errors, attachments


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="OpenTurbine final dual-target release evidence gate")
    parser.add_argument("--s3", required=True, help="S3 qualification.json")
    parser.add_argument("--classic", required=True, help="Classic qualification.json")
    parser.add_argument("--evidence", required=True, help="reviewed physical-evidence JSON")
    parser.add_argument("--out", required=True, help="final signoff JSON to create")
    args = parser.parse_args(argv)

    s3_path, s3, s3_errors = validate_qualification(args.s3, "s3")
    classic_path, classic, classic_errors = validate_qualification(args.classic, "classic")
    evidence_path, evidence, evidence_errors, attachments = validate_evidence(args.evidence)
    errors = s3_errors + classic_errors + evidence_errors

    if s3.get("worktree_before") != classic.get("worktree_before"):
        errors.append("Classic and S3 were not qualified from the identical source/worktree fingerprint")
    for artifact_name in ("tester_firmware",):
        a = s3.get("artifacts", {}).get(artifact_name, {}).get("sha256")
        b = classic.get("artifacts", {}).get(artifact_name, {}).get("sha256")
        if not a or not b:
            errors.append("both targets must record %s" % artifact_name)

    result = {
        "schema": 1,
        "created": dt.datetime.now(dt.timezone.utc).isoformat(),
        "passed": not errors,
        "errors": errors,
        "qualifications": {
            "s3": {"path": str(s3_path), "sha256": sha256_file(s3_path)},
            "classic": {"path": str(classic_path), "sha256": sha256_file(classic_path)},
        },
        "evidence": {"path": str(evidence_path), "sha256": sha256_file(evidence_path)},
        "attachments": attachments,
        "review": evidence.get("review", {}),
        "claim_boundary": (
            "Qualifies the tested artifacts, fixture, electrical interfaces, powered loads, and cold-spin setup; "
            "it does not certify an arbitrary turbine, fuel system, wiring installation, or unattended wet start."
        ),
    }
    output = Path(args.out).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print("Final signoff %s: %s" % ("PASS" if result["passed"] else "FAIL", output))
    for error in errors:
        print("  -", error)
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
