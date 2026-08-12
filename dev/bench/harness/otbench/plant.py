"""Low-order deterministic turbine model for closed-loop HIL.

The model is an ECU behavior test oracle, not an engine design model.  It
captures only causal relationships that should hold for virtually any small
gas turbine: starter torque raises shaft speed, admitted fuel plus ignition can
light above a minimum speed, combustion raises temperature and shaft speed,
oil pressure follows pump/shaft activity, and all values decay after cutoff.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import math


@dataclass
class PlantConfig:
    ambient_c: float = 20.0
    starter_target_rpm: float = 9000.0
    idle_rpm: float = 32000.0
    max_rpm: float = 85000.0
    lightoff_min_rpm: float = 2500.0
    sustain_min_rpm: float = 1800.0
    lightoff_delay_s: float = 0.45
    flameout_delay_s: float = 0.25
    spool_tau_s: float = 1.8
    rundown_tau_s: float = 4.0
    egt_tau_s: float = 0.9
    oil_tau_s: float = 0.55
    n2_ratio: float = 0.68
    max_oil_bar: float = 6.0


@dataclass
class Actuators:
    fuel: float = 0.0
    fuel_shutoff: bool = False
    igniter: bool = False
    starter: float = 0.0
    starter_enable: bool = True
    oil_pump: float = 0.0

    def clamped(self) -> "Actuators":
        return Actuators(
            fuel=max(0.0, min(1.0, float(self.fuel))),
            fuel_shutoff=bool(self.fuel_shutoff),
            igniter=bool(self.igniter),
            starter=max(0.0, min(1.0, float(self.starter))),
            starter_enable=bool(self.starter_enable),
            oil_pump=max(0.0, min(1.0, float(self.oil_pump))),
        )


@dataclass
class PlantState:
    n1_rpm: float = 0.0
    n2_rpm: float = 0.0
    egt_c: float = 20.0
    oil_bar: float = 0.0
    flame: bool = False
    lightoff_timer_s: float = 0.0
    flameout_timer_s: float = 0.0
    elapsed_s: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


class TurbinePlant:
    def __init__(self, config: PlantConfig | None = None):
        self.config = config or PlantConfig()
        self.state = PlantState(egt_c=self.config.ambient_c)

    @staticmethod
    def _lag(value: float, target: float, dt: float, tau: float) -> float:
        if tau <= 0:
            return target
        alpha = 1.0 - math.exp(-max(0.0, dt) / tau)
        return value + (target - value) * alpha

    def reset(self) -> PlantState:
        self.state = PlantState(egt_c=self.config.ambient_c)
        return self.state

    def step(self, actuators: Actuators, dt: float) -> PlantState:
        a = actuators.clamped()
        c = self.config
        s = self.state
        dt = max(0.0, min(float(dt), 0.5))

        starter = a.starter if a.starter_enable else 0.0
        fuel_admitted = a.fuel_shutoff and a.fuel > 0.015
        can_light = fuel_admitted and a.igniter and s.n1_rpm >= c.lightoff_min_rpm
        if not s.flame:
            s.lightoff_timer_s = s.lightoff_timer_s + dt if can_light else 0.0
            if s.lightoff_timer_s >= c.lightoff_delay_s:
                s.flame = True
                s.flameout_timer_s = 0.0
        else:
            can_sustain = fuel_admitted and s.n1_rpm >= c.sustain_min_rpm
            s.flameout_timer_s = 0.0 if can_sustain else s.flameout_timer_s + dt
            if s.flameout_timer_s >= c.flameout_delay_s:
                s.flame = False
                s.lightoff_timer_s = 0.0

        starter_target = c.starter_target_rpm * starter
        combustion_target = 0.0
        if s.flame:
            # Any stable admitted fuel sustains roughly idle speed; the rest of
            # the command covers the usable operating range.
            combustion_target = c.idle_rpm + max(0.0, a.fuel - 0.12) / 0.88 * (c.max_rpm - c.idle_rpm)
        target_rpm = max(starter_target, combustion_target)
        tau = c.spool_tau_s if target_rpm >= s.n1_rpm else c.rundown_tau_s
        s.n1_rpm = max(0.0, self._lag(s.n1_rpm, target_rpm, dt, tau))
        s.n2_rpm = max(0.0, self._lag(s.n2_rpm, s.n1_rpm * c.n2_ratio, dt, tau * 1.15))

        egt_target = c.ambient_c
        if s.flame:
            egt_target = 320.0 + 430.0 * a.fuel
        elif fuel_admitted and a.igniter:
            egt_target = 90.0
        s.egt_c = self._lag(s.egt_c, egt_target, dt, c.egt_tau_s)

        shaft_oil = min(1.0, s.n1_rpm / max(c.idle_rpm, 1.0)) * 0.25
        oil_target = c.max_oil_bar * min(1.0, max(a.oil_pump, shaft_oil))
        s.oil_bar = max(0.0, self._lag(s.oil_bar, oil_target, dt, c.oil_tau_s))
        s.elapsed_s += dt
        return s