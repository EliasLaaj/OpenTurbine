import copy
import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "pcb_profile", ROOT / "tools" / "pcb_profile.py"
)
pcb_profile = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pcb_profile)


class PcbProfileValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.official = json.loads(
            (ROOT / "pcb_profiles" / "official" /
             "openturbine-ecu-s3-v1.otpcb.json").read_text(encoding="utf-8")
        )

    def test_official_profile_matches_runtime_text_limits(self):
        self.assertEqual([], pcb_profile.validate_profile(self.official, strict=True))

    def test_port_description_too_long_is_rejected_before_flash(self):
        profile = copy.deepcopy(self.official)
        profile["ports"][0]["description"] = "x" * 80
        with self.assertRaisesRegex(
            pcb_profile.ProfileError, "description must be at most 79"
        ):
            pcb_profile.validate_profile(profile, strict=True)

    def test_port_connector_too_long_is_rejected_before_flash(self):
        profile = copy.deepcopy(self.official)
        profile["ports"][0]["connector"] = "x" * 24
        with self.assertRaisesRegex(
            pcb_profile.ProfileError, "connector must be at most 23"
        ):
            pcb_profile.validate_profile(profile, strict=True)

    def test_active_high_must_be_boolean(self):
        profile = copy.deepcopy(self.official)
        profile["ports"][0]["modes"][0]["active_high"] = "false"
        with self.assertRaisesRegex(
            pcb_profile.ProfileError, "active_high must be boolean"
        ):
            pcb_profile.validate_profile(profile, strict=True)

    def test_compatible_non_switch_default_is_accepted(self):
        profile = copy.deepcopy(self.official)
        mode = next(port for port in profile["ports"] if port["id"] == "adc_1")["modes"][0]
        mode["default"] = {
            "id": "oil_pressure_main", "name": "Oil Pressure",
            "role": "pressure", "purpose": "oil_pressure",
        }
        self.assertEqual([], pcb_profile.validate_profile(profile, strict=True))

    def test_incompatible_default_is_rejected_before_flash(self):
        profile = copy.deepcopy(self.official)
        mode = next(port for port in profile["ports"] if port["id"] == "power_output_1")["modes"][0]
        mode["default"] = {
            "id": "main_fuel", "name": "Main Fuel",
            "role": "fuel", "purpose": "main_fuel",
        }
        with self.assertRaisesRegex(pcb_profile.ProfileError, "incompatible with adapter"):
            pcb_profile.validate_profile(profile, strict=True)

    def test_extended_profile_purposes_follow_runtime_contract(self):
        self.assertTrue(pcb_profile._default_compatible(
            "i2c_adc_input", "oil_flow", "flow"))
        self.assertTrue(pcb_profile._default_compatible(
            "i2c_adc_input", "scavenge_flow", "flow"))
        self.assertTrue(pcb_profile._default_compatible(
            "i2c_digital_output", "drain_valve", "valve"))
        self.assertFalse(pcb_profile._default_compatible(
            "spi_thermocouple", "coolant_temp", "temperature"))
        self.assertTrue(pcb_profile._default_compatible(
            "onewire_temperature", "intake_temperature", "temperature"))
        self.assertFalse(pcb_profile._default_compatible(
            "i2c_load_cell", "oil_pressure", "pressure"))
        self.assertFalse(pcb_profile._default_compatible(
            "relay_output", "main_fuel", "fuel"))
        self.assertTrue(pcb_profile._default_compatible(
            "analog_input", "generic", "pressure"))
        self.assertFalse(pcb_profile._default_compatible(
            "i2c_load_cell", "generic", "pressure"))


if __name__ == "__main__":
    unittest.main()
