import unittest
from unittest.mock import Mock, call, patch

from otbench.dut import DUT


class DutTelemetryCacheTests(unittest.TestCase):
    def setUp(self):
        self.dut = DUT("http://dut.invalid")
        self.dut._get = Mock()

    def test_data_seeds_full_snapshot_then_merges_compact_telemetry(self):
        self.dut._get.side_effect = [
            {"boot_count": 7, "hardware_capability": "dac", "rpm": 0},
            {"boot_count": 7, "rpm": 12345, "mode": "RUNNING"},
        ]

        first = self.dut.data()
        second = self.dut.data()

        self.assertEqual(first["rpm"], 0)
        self.assertEqual(second["rpm"], 12345)
        self.assertEqual(second["hardware_capability"], "dac")
        self.assertEqual(
            self.dut._get.call_args_list,
            [call("/api/data"), call("/api/telemetry")],
        )

    def test_boot_change_refreshes_full_snapshot(self):
        self.dut._get.side_effect = [
            {"boot_count": 7, "profile": "old"},
            {"boot_count": 8, "rpm": 0},
            {"boot_count": 8, "profile": "new", "rpm": 0},
        ]

        self.dut.data()
        refreshed = self.dut.data()

        self.assertEqual(refreshed["profile"], "new")
        self.assertEqual(self.dut._get.call_args_list[-1], call("/api/data"))

    def test_successful_configuration_writes_invalidate_snapshot(self):
        for method, path in (
            (self.dut._post, "/api/config"),
            (self.dut._post, "/api/ecu_config"),
            (self.dut.patch, "/api/hardware"),
        ):
            with self.subTest(path=path):
                self.dut._data_base = {"boot_count": 1}
                self.dut._body = Mock(return_value=(200, {"ok": True}))
                method(path, {})
                self.assertIsNone(self.dut._data_base)

    def test_failed_or_non_configuration_write_preserves_snapshot(self):
        self.dut._data_base = {"boot_count": 1}
        self.dut._body = Mock(return_value=(400, {"error": "bad"}))
        self.dut._post("/api/config", {})
        self.assertIsNotNone(self.dut._data_base)

        self.dut._body = Mock(return_value=(200, {"ok": True}))
        self.dut._post("/api/command", {})
        self.assertIsNotNone(self.dut._data_base)

    @patch("otbench.dut.time.sleep")
    @patch("otbench.dut.subprocess.run")
    @patch("otbench.dut.time.monotonic", side_effect=[100.0, 101.0, 161.0])
    def test_wifi_reconnect_requests_are_throttled(self, _clock, run, _sleep):
        # The recovery command is intentionally Windows-only; make the test's
        # platform assumption explicit so it remains meaningful on Linux CI.
        with patch("otbench.dut.os.name", "nt"):
            self.dut._reconnect_wifi()
            self.dut._reconnect_wifi()
            self.dut._reconnect_wifi()
        self.assertEqual(run.call_count, 2)


if __name__ == "__main__":
    unittest.main()
