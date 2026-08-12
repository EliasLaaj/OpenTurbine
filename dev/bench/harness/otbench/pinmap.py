"""Loads bench/pinmap.json — the single source of truth shared with the
OTBench firmware. Provides signal lookups and unit conversions."""

import json
import os

# bench/harness/otbench/pinmap.py -> up three levels is bench/
_BENCH_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_PINMAP_PATH = os.path.join(_BENCH_DIR, "pinmap.json")


class PinMap:
    def __init__(self, path=None):
        self.path = path or os.environ.get("OTBENCH_PINMAP", DEFAULT_PINMAP_PATH)
        with open(self.path, "r", encoding="utf-8") as f:
            self.raw = json.load(f)
        self.meta = self.raw["meta"]
        self.signals = self.raw["signals"]
        self.by_name = {s["name"]: s for s in self.signals}
        self.dut_profile = self.raw.get("dut_profile", {})

    # ── lookups ──────────────────────────────────────────────
    def sig(self, name):
        return self.by_name[name]

    def has(self, name):
        return name in self.by_name

    def telemetry_key(self, name):
        return self.by_name[name].get("telemetry_key")

    def ppr(self, name):
        return float(self.by_name[name].get("ppr", 1.0))

    def inputs(self):
        """Signals the tester drives into the DUT."""
        return [s for s in self.signals if s["dir"] == "dut_in"]

    def outputs(self):
        """Signals the tester reads from the DUT."""
        return [s for s in self.signals if s["dir"] == "dut_out"]

    # ── unit conversions ─────────────────────────────────────
    @property
    def vref(self):
        return float(self.meta.get("logic_level_v", 3.3))

    @property
    def adc_full_scale(self):
        return float(self.meta.get("adc_full_scale_counts", 4095))

    def rpm_to_hz(self, name, rpm):
        return rpm * self.ppr(name) / 60.0

    def volts_to_counts(self, volts):
        return int(round(volts / self.vref * self.adc_full_scale))

    def counts_to_volts(self, counts):
        return counts / self.adc_full_scale * self.vref
