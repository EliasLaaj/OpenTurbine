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

    def test_compact_v2_frame_is_decoded_and_refreshes_changed_text(self):
        values = [0] * 73
        values[0] = 12345
        values[6] = 234
        values[20] = 375
        values[25] = 420
        values[58] = -123
        self.dut._get.side_effect = [
            {"boot_count": 7, "profile": "bench"},
            {
                "cv": 2, "s": 99, "m": 1, "v": values,
                "f": (1 << 20) | (1 << 23), "g": 1,
                "bc": 7, "u": 12, "tr": 123,
                "iv": [], "ir": [], "ov": [], "oc": [],
            },
            {"current_block": "Timed Delay", "last_event": "Start sequence initiated"},
        ]

        self.dut.data()
        live = self.dut.data()

        self.assertEqual(live["mode"], "STARTUP")
        self.assertEqual(live["n1"], 12345)
        self.assertEqual(live["oil"], 2.34)
        self.assertEqual(live["throttle_effective"], 0.375)
        self.assertEqual(live["starter_demand"], 0.42)
        self.assertEqual(live["thrust_raw"], -123)
        self.assertTrue(live["igniter_on"])
        self.assertTrue(live["start_switch_active"])
        self.assertTrue(live["dev_mode"])
        self.assertEqual(live["current_block"], "Timed Delay")
        self.assertEqual(live["profile"], "bench")
        self.assertEqual(
            self.dut._get.call_args_list,
            [call("/api/data"), call("/api/telemetry"), call("/api/telemetry_text")],
        )

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
        # Each permitted recovery probes association, probes the DHCP address,
        # then requests a reconnect. The middle call is throttled completely.
        self.assertEqual(run.call_count, 6)
        connect_calls = [
            item for item in run.call_args_list
            if item.args and item.args[0][:3] == ["netsh", "wlan", "connect"]
        ]
        self.assertEqual(len(connect_calls), 2)


if __name__ == "__main__":
    unittest.main()
