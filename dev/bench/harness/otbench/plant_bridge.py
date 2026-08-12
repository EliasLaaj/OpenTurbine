"""Physical OTBench bridge for :mod:`otbench.plant`."""

from __future__ import annotations

import time

from .plant import Actuators, TurbinePlant


def _fraction(value, low, high, inverted=False):
    value = float(value or 0)
    low = float(low)
    high = float(high)
    if high == low or value <= 0:
        result = 0.0
    else:
        result = (value - low) / (high - low)
    result = max(0.0, min(1.0, result))
    return 1.0 - result if inverted else result


class PhysicalPlantBridge:
    def __init__(self, dut, tester, pinmap, plant: TurbinePlant | None = None,
                 signal_map=None, driven_signals=None):
        self.dut = dut
        self.tester = tester
        self.pinmap = pinmap
        self.plant = plant or TurbinePlant()
        self.hardware = dut.hardware()
        self.signal_map = {
            "fuel": "THROTTLE_OUT",
            "starter": "STARTER_OUT",
            "oil_pump": "OILPUMP_OUT",
            **(signal_map or {}),
        }
        self.driven_signals = set(driven_signals or {"N1", "N2", "TOT", "OILP", "FLAME"})
        self.last_time = time.monotonic()
        self.last_drive = {}

    def _variable_output(self, state, signal, actuator_name):
        actuator = self.hardware.get("actuators", {}).get(actuator_name, {})
        output_type = int(actuator.get("type", 0) or 0)
        if output_type == 0:
            return _fraction(
                state.get(signal + "_us"), actuator.get("min_us", 1000),
                actuator.get("max_us", 2000), actuator.get("inverted", False),
            )
        if output_type == 1:
            return _fraction(
                state.get(signal + "_duty"),
                float(actuator.get("pwm_min_pct", 0)) / 100.0,
                float(actuator.get("pwm_max_pct", 100)) / 100.0,
                actuator.get("inverted", False),
            )
        return 1.0 if int(state.get(signal, state.get(signal + "_level", 0)) or 0) else 0.0

    def read_actuators(self):
        state = self.tester.state()
        fuel = self._variable_output(state, self.signal_map["fuel"], "throttle")
        starter = self._variable_output(state, self.signal_map["starter"], "starter")
        oil = self._variable_output(state, self.signal_map["oil_pump"], "oil_pump")
        starter_enable_cfg = self.hardware.get("actuators", {}).get("starter_en", {})
        starter_enable = True
        if starter_enable_cfg.get("enabled"):
            starter_enable = bool(state.get("STARTER_EN", state.get("STARTER_EN_level", 0)))
        return Actuators(
            fuel=fuel,
            fuel_shutoff=bool(state.get("FUEL_SOL", state.get("FUEL_SOL_level", 0))),
            igniter=bool(state.get("IGNITER", state.get("IGNITER_level", 0))),
            starter=starter,
            starter_enable=starter_enable,
            oil_pump=oil,
        ), state

    def _set_changed(self, name, value, tolerance):
        previous = self.last_drive.get(name)
        if previous is None or abs(float(previous) - float(value)) >= tolerance:
            self.tester.set(name, value)
            self.last_drive[name] = value
            return True
        return False

    def drive_sensors(self, state):
        if "N1" in self.driven_signals:
            self._set_changed(
                "N1", round(self.pinmap.rpm_to_hz("N1", state.n1_rpm), 2), 10.0)
        if "N2" in self.driven_signals and self.pinmap.has("N2"):
            self._set_changed(
                "N2", round(self.pinmap.rpm_to_hz("N2", state.n2_rpm), 2), 10.0)
        if "TOT" in self.driven_signals:
            previous_tot = self.last_drive.get("TOT")
            if previous_tot is None or abs(previous_tot - state.egt_c) >= 2.0:
                self.tester.set_tot(round(state.egt_c, 1))
                self.last_drive["TOT"] = state.egt_c
        if "OILP" in self.driven_signals:
            oil_volts = max(0.0, min(self.pinmap.vref, state.oil_bar / self.plant.config.max_oil_bar * self.pinmap.vref))
            self._set_changed("OILP", round(oil_volts, 3), 0.03)
        if "FLAME" in self.driven_signals:
            flame = 1 if state.flame else 0
            if self.last_drive.get("FLAME") != flame:
                self.tester.set("FLAME", flame)
                self.last_drive["FLAME"] = flame

    def tick(self):
        now = time.monotonic()
        dt = now - self.last_time
        self.last_time = now
        actuators, physical = self.read_actuators()
        state = self.plant.step(actuators, dt)
        self.drive_sensors(state)
        return actuators, physical, state

    def safe_inputs(self):
        self.plant.reset()
        self.last_drive.clear()
        if "N1" in self.driven_signals:
            self.tester.set("N1", 0)
        if "N2" in self.driven_signals and self.pinmap.has("N2"):
            self.tester.set("N2", 0)
        if "TOT" in self.driven_signals:
            self.tester.set_tot(self.plant.config.ambient_c)
        if "OILP" in self.driven_signals:
            self.tester.set("OILP", 0)
        if "FLAME" in self.driven_signals:
            self.tester.set("FLAME", 0)
        self.tester.set("START", 0)
        self.tester.set("STOP", 0)
