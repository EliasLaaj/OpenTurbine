import sys
import tempfile
import unittest
import contextlib
import io
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import qualification
import release_signoff
from otbench.runner import Result, print_report
from otbench.suite import _relay_output_safe, _variable_output_safe


class QualificationTests(unittest.TestCase):
    def test_safe_output_oracle_uses_configured_endpoints_and_polarity(self):
        servo = {"type": 0, "min_us": 800, "max_us": 2200, "inverted": False}
        self.assertTrue(_variable_output_safe({"OUT_us": 800}, "OUT", servo))
        self.assertFalse(_variable_output_safe({"OUT_us": 1500}, "OUT", servo))
        servo["inverted"] = True
        self.assertTrue(_variable_output_safe({"OUT_us": 2200}, "OUT", servo))
        self.assertTrue(_relay_output_safe({"OUT": 1}, "OUT", {"active_h": False}))
        self.assertFalse(_relay_output_safe({"OUT": 0}, "OUT", {"active_h": False}))

    def test_required_skip_fails_strict_report(self):
        skipped = Result("required")
        skipped.status = "skip"
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(print_report([skipped], require_all=False))
            self.assertFalse(print_report([skipped], require_all=True))

    def test_failure_always_fails_report(self):
        failed = Result("bad")
        failed.status = "fail"
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(print_report([failed], require_all=False))
            self.assertFalse(print_report([failed], require_all=True))

    def test_command_plan_contains_strict_core_and_plant(self):
        with tempfile.TemporaryDirectory() as directory:
            commands = qualification.build_commands(
                "s3", "COM9", "http://192.0.2.1", Path(directory), pinmap="fixture.json"
            )
        ids = [command["id"] for command in commands]
        self.assertIn("core_advanced", ids)
        self.assertIn("plant_hil", ids)
        core = next(command for command in commands if command["id"] == "core_advanced")
        self.assertIn("--require-all", core["argv"])
        self.assertIn("fixture.json", core["argv"])

    def test_classic_plan_adds_platform_campaign(self):
        with tempfile.TemporaryDirectory() as directory:
            commands = qualification.build_commands(
                "classic", "COM9", "http://192.0.2.1", Path(directory)
            )
        ids = [command["id"] for command in commands]
        self.assertIn("classic_safety_hil", ids)
        self.assertIn("reversed_digital_sensor_hil", ids)
        self.assertNotIn("ten_build_webui_hil", ids)

    def test_s3_plan_excludes_role_reversed_campaigns(self):
        with tempfile.TemporaryDirectory() as directory:
            commands = qualification.build_commands(
                "s3", "COM9", "http://192.0.2.1", Path(directory)
            )
        ids = [command["id"] for command in commands]
        self.assertIn("ten_build_webui_hil", ids)
        self.assertNotIn("reversed_digital_sensor_hil", ids)
        self.assertNotIn("classic_safety_hil", ids)

    def test_artifacts_are_named_and_hashed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "firmware.bin"
            path.write_bytes(b"candidate")
            manifest = qualification.artifact_manifest(["firmware=" + str(path)])
        self.assertEqual(set(manifest), {"firmware"})
        self.assertEqual(manifest["firmware"]["size"], 9)

    def test_embedded_esp_build_id_is_extracted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "firmware.bin"
            digest = bytes(range(1, 33))
            path.write_bytes(b"prefix" + b"\x32\x54\xcd\xab" + bytes(140) + digest + b"suffix")
            build_id = qualification.esp_firmware_build_id(str(path))
        self.assertEqual(build_id, digest[:8].hex())

    def test_unnamed_artifact_is_rejected(self):
        with self.assertRaises(ValueError):
            qualification.artifact_manifest(["firmware.bin"])

    def test_pinmap_target_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pinmap.json"
            path.write_text('{"meta":{"dut_target":"s3"}}', encoding="utf-8")
            with self.assertRaises(ValueError):
                qualification.validate_pinmap_target(str(path), "classic")

    def test_incomplete_release_pinmap_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pinmap.json"
            path.write_text('{"signals":[{"name":"STOP"}]}', encoding="utf-8")
            with self.assertRaises(ValueError):
                qualification.validate_release_pinmap(str(path))

    def test_release_evidence_requires_every_gate_and_attachment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / "evidence.json"
            evidence.write_text('{"gates": {}}', encoding="utf-8")
            _path, _data, errors, _attachments = release_signoff.validate_evidence(str(evidence))
        self.assertGreaterEqual(len(errors), len(release_signoff.REQUIRED_GATES))

    def test_complete_reviewed_evidence_validates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            capture = root / "capture.txt"
            capture.write_text("independent measurement", encoding="utf-8")
            gates = {
                gate: {"passed": True, "reviewer": "reviewer", "method": "measured",
                       "acceptance": "within documented limit", "result": "within limit",
                       "files": [capture.name]}
                for gate in release_signoff.REQUIRED_GATES
            }
            evidence = root / "evidence.json"
            evidence.write_text(__import__("json").dumps({"gates": gates}), encoding="utf-8")
            _path, _data, errors, attachments = release_signoff.validate_evidence(str(evidence))
        self.assertEqual(errors, [])
        self.assertEqual(len(attachments), 1)


if __name__ == "__main__":
    unittest.main()
