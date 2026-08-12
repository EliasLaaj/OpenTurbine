import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from otbench.plant import Actuators, TurbinePlant
from otbench.plant_bridge import _fraction


class TurbinePlantTests(unittest.TestCase):
    @staticmethod
    def advance(plant, actuators, seconds, dt=0.05):
        for _ in range(round(seconds / dt)):
            plant.step(actuators, dt)
        return plant.state

    def test_starter_spools_without_false_combustion(self):
        plant = TurbinePlant()
        state = self.advance(plant, Actuators(starter=0.7), 5)
        self.assertGreater(state.n1_rpm, 4000)
        self.assertFalse(state.flame)
        self.assertLess(state.egt_c, 30)

    def test_fuel_and_ignition_light_and_accelerate(self):
        plant = TurbinePlant()
        self.advance(plant, Actuators(starter=0.7), 3)
        state = self.advance(
            plant,
            Actuators(starter=0.7, fuel=0.25, fuel_shutoff=True, igniter=True),
            5,
        )
        self.assertTrue(state.flame)
        self.assertGreater(state.n1_rpm, 20000)
        self.assertGreater(state.egt_c, 300)

    def test_fuel_without_ignition_does_not_light(self):
        plant = TurbinePlant()
        self.advance(plant, Actuators(starter=0.8), 4)
        state = self.advance(
            plant, Actuators(starter=0.8, fuel=0.5, fuel_shutoff=True), 3
        )
        self.assertFalse(state.flame)
        self.assertLess(state.egt_c, 30)

    def test_cutoff_extinguishes_and_runs_down(self):
        plant = TurbinePlant()
        self.advance(plant, Actuators(starter=0.8), 3)
        self.advance(
            plant,
            Actuators(starter=0.8, fuel=0.4, fuel_shutoff=True, igniter=True),
            5,
        )
        running_rpm = plant.state.n1_rpm
        state = self.advance(plant, Actuators(), 3)
        self.assertFalse(state.flame)
        self.assertLess(state.n1_rpm, running_rpm)
        self.assertLess(state.egt_c, 150)

    def test_oil_pressure_tracks_physical_pump(self):
        plant = TurbinePlant()
        high = self.advance(plant, Actuators(oil_pump=1), 2).oil_bar
        low = self.advance(plant, Actuators(), 2).oil_bar
        self.assertGreater(high, 5)
        self.assertLess(low, high / 2)

    def test_output_fraction_honours_endpoints_and_inversion(self):
        self.assertEqual(_fraction(1000, 1000, 2000), 0)
        self.assertAlmostEqual(_fraction(1500, 1000, 2000), 0.5)
        self.assertEqual(_fraction(2000, 1000, 2000), 1)
        self.assertEqual(_fraction(1000, 1000, 2000, inverted=True), 1)


if __name__ == "__main__":
    unittest.main()
