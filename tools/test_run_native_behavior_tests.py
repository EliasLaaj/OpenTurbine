import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools import run_native_behavior_tests as native


def policy_block():
    error = OSError("blocked")
    error.winerror = 4551
    return error


class FreshExecutableTests(unittest.TestCase):
    @mock.patch.object(native.subprocess, "run")
    def test_clean_checkout_installs_declared_arduinojson_dependency(self, run):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            expected = root / ".pio" / "libdeps" / "esp32dev" / "ArduinoJson" / "src"
            run.side_effect = lambda *args, **kwargs: expected.mkdir(parents=True)
            with mock.patch.object(native, "ROOT", root):
                self.assertEqual(expected, native.arduino_json_include())
        run.assert_called_once()
        command = run.call_args.args[0]
        self.assertIn("platformio", command)
        self.assertIn("esp32dev", command)

    @mock.patch.object(native.time, "sleep")
    @mock.patch.object(native.subprocess, "run")
    def test_windows_policy_block_retries_with_bounded_backoff(self, run, sleep):
        expected = subprocess.CompletedProcess(["probe"], 0)
        run.side_effect = [policy_block(), policy_block(), policy_block(), policy_block(),
                           policy_block(), expected]
        with mock.patch.object(native.os, "name", "nt"):
            self.assertIs(expected, native.run_fresh_executable(["probe"]))
        self.assertEqual(6, run.call_count)
        self.assertEqual([mock.call(2.0), mock.call(4.0), mock.call(8.0),
                          mock.call(16.0), mock.call(30.0)], sleep.call_args_list)

    @mock.patch.object(native.time, "sleep")
    @mock.patch.object(native.subprocess, "run")
    def test_repeated_policy_block_is_not_hidden(self, run, sleep):
        run.side_effect = [policy_block()] * 6
        with mock.patch.object(native.os, "name", "nt"):
            with self.assertRaises(OSError):
                native.run_fresh_executable(["probe"])
        self.assertEqual(6, run.call_count)
        self.assertEqual([mock.call(2.0), mock.call(4.0), mock.call(8.0),
                          mock.call(16.0), mock.call(30.0)], sleep.call_args_list)

    @mock.patch.object(native.time, "sleep")
    @mock.patch.object(native.subprocess, "run")
    def test_other_launch_errors_are_not_retried(self, run, sleep):
        run.side_effect = OSError("different error")
        with mock.patch.object(native.os, "name", "nt"):
            with self.assertRaises(OSError):
                native.run_fresh_executable(["probe"])
        run.assert_called_once()
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
