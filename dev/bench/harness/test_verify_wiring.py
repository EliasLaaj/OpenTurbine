import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run import _configured_signal_pins, _tester_pinmap_errors
from otbench.pinmap import PinMap


class VerifyWiringTests(unittest.TestCase):
    def test_tester_firmware_must_match_pinmap_kind_and_gpio(self):
        pinmap = PinMap()
        lines = [
            "SIG %s %s gpio=%s" %
            (signal["name"], signal["tester_kind"].upper(), signal["tester_gpio"])
            for signal in pinmap.signals
        ]
        self.assertEqual(_tester_pinmap_errors(pinmap, lines), [])
        lines[0] = lines[0].replace("gpio=13", "gpio=99")
        self.assertTrue(any("gpio=99" in error for error in _tester_pinmap_errors(pinmap, lines)))
    def test_unrelated_gpio_owner_does_not_satisfy_signal(self):
        hardware = {
            "controls": {"start_pin": 13, "stop_pin": 15},
            "sensors": {
                "n2_rpm": {"enabled": False, "pin": 27},
            },
            "actuators": {},
            "i2c": {"sda_pin": 8},
            "channel_registry": {"inputs": [], "outputs": []},
        }

        pins = _configured_signal_pins(hardware)

        self.assertEqual(pins["N2"], set())

    def test_legacy_and_registry_roles_are_matched_semantically(self):
        hardware = {
            "controls": {"start_pin": 13, "stop_pin": 15},
            "sensors": {
                "n1_rpm": {"enabled": True, "pin": 14},
                "throttle_input": {"enabled": False, "pin": 3},
            },
            "actuators": {
                "igniter": {"enabled": False, "pin": 21},
            },
            "channel_registry": {
                "inputs": [
                    {"purpose": "throttle", "pin": 4},
                    {"purpose": "generic", "pin": 21},
                ],
                "outputs": [
                    {"purpose": "igniter", "pin": 21},
                    {"purpose": "main_fuel", "pin": 40},
                ],
            },
        }

        pins = _configured_signal_pins(hardware)

        self.assertEqual(pins["N1"], {14})
        self.assertEqual(pins["THROTTLE_IN"], {4})
        self.assertEqual(pins["IGNITER"], {21})
        self.assertEqual(pins["THROTTLE_OUT"], {40})


if __name__ == "__main__":
    unittest.main()
