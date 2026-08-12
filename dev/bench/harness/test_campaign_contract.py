import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


GATING_CAMPAIGNS = {
    "ten_build_webui_hil.py",
    "phase2_safety_hil.py",
    "v2_controls_hil.py",
    "interaction_hil.py",
    "afterburner_limp_hil.py",
    "shutdown_output_ownership_hil.py",
    "finalstop_live_config_hil.py",
    "session_logger_hil.py",
    "i2c_devices_hil.py",
    "reversed_digital_sensor_hil.py",
    "classic_safety_hil.py",
    "classic_pinfunc_test.py",
    "role_reversed_outputs_test.py",
    "plant_hil.py",
}


class CampaignContractTests(unittest.TestCase):
    def test_every_gating_campaign_propagates_failure_exit_status(self):
        for name in sorted(GATING_CAMPAIGNS):
            with self.subTest(name=name):
                path = ROOT / "campaign" / name
                source = path.read_text(encoding="utf-8")
                tree = ast.parse(source)
                system_exits = [
                    node for node in ast.walk(tree)
                    if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call)
                    and getattr(node.exc.func, "id", None) == "SystemExit"
                ]
                self.assertTrue(system_exits, "%s can fall through with process status 0" % name)

    def test_gating_campaigns_do_not_use_ambiguous_check_result(self):
        for name in sorted(GATING_CAMPAIGNS):
            with self.subTest(name=name):
                source = (ROOT / "campaign" / name).read_text(encoding="utf-8")
                self.assertNotIn('"CHECK"', source)
                self.assertNotIn("'CHECK'", source)

    def test_ten_build_physical_pulses_span_capture_round_trip(self):
        source = (ROOT / "campaign" / "ten_build_webui_hil.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        assignment = next(
            node for node in tree.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "TOOLS_FAST"
                    for target in node.targets)
        )
        tools = ast.literal_eval(assignment.value)
        short = {key: value for key, value in tools.items()
                 if key.endswith("_ms") and value < 600}
        self.assertEqual(short, {}, "physical HIL pulses below 600 ms can expire before capture")


if __name__ == "__main__":
    unittest.main()
