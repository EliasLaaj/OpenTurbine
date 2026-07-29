import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_setup_package", ROOT / "tools" / "build_setup_package.py")
build_setup_package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_setup_package)


class BuildSetupPackageTests(unittest.TestCase):
    def test_complete_driver_packages_are_copied(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = self.complete_driver(tmp / "src")
            dst = tmp / "dst"
            build_setup_package.copy_driver_package(str(src), dst, label="WCH")
            self.assertTrue((dst / "driver.inf").exists())
            self.assertTrue((dst / "driver.cat").exists())
            self.assertTrue((dst / "x64" / "driver.sys").exists())

    def test_exe_only_driver_package_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "driver"
            src.mkdir()
            (src / "setup.exe").write_bytes(b"exe")
            with self.assertRaisesRegex(RuntimeError, "no .inf"):
                build_setup_package.copy_driver_package(str(src), tmp / "dst", label="WCH")

    def test_missing_cat_or_payload_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "driver"
            src.mkdir()
            (src / "driver.inf").write_text("inf", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "no .cat"):
                build_setup_package.copy_driver_package(str(src), tmp / "dst", label="CP210x")
            (src / "driver.cat").write_text("cat", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "no .sys"):
                build_setup_package.copy_driver_package(str(src), tmp / "dst", label="CP210x")

    def test_stage_package_uses_schema_and_wch_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            build_root = tmp / "build"
            for env in build_setup_package.TARGETS:
                env_dir = build_root / env
                env_dir.mkdir(parents=True)
                for name in ("bootloader.bin", "partitions.bin", "firmware.bin", "littlefs.bin"):
                    (env_dir / name).write_bytes(b"\x00" * 32)
            boot_app0 = tmp / "boot_app0.bin"
            boot_app0.write_bytes(b"\x00" * 32)
            esptool = tmp / "esptool.exe"
            esptool.write_bytes(b"exe")
            cp210x = self.complete_driver(tmp / "cp210x")
            wch = self.complete_driver(tmp / "wch")
            stage = tmp / "stage"
            with mock.patch.object(build_setup_package, "BUILD_ROOTS", [build_root]), \
                mock.patch.object(build_setup_package, "find_boot_app0", return_value=boot_app0), \
                mock.patch.object(build_setup_package, "read_version", return_value="9.9.9"):
                manifest = build_setup_package.stage_package(stage, esptool, str(cp210x), str(wch))
            self.assertEqual(manifest["package_schema"], 3)
            self.assertEqual(manifest["setup_tool_version"], "0.6.0")
            self.assertEqual(manifest["minimum_setup_tool_version"], "0.6.0")
            self.assertTrue((stage / "drivers" / "cp210x" / "driver.inf").exists())
            self.assertTrue((stage / "drivers" / "wch" / "driver.inf").exists())
            self.assertTrue(any((stage / "pcb_profiles" / "targets").glob("*.json")))
            for target in manifest["targets"].values():
                profile = target["pcb_profile"]
                self.assertGreater(int(profile["address"], 0), 0)
                self.assertGreater(profile["size"], 0)
                self.assertIsInstance(profile["official_profiles"], list)

    def complete_driver(self, root: Path) -> Path:
        root.mkdir(parents=True)
        (root / "driver.inf").write_text("inf", encoding="utf-8")
        (root / "driver.cat").write_text("cat", encoding="utf-8")
        payload = root / "x64"
        payload.mkdir()
        (payload / "driver.sys").write_bytes(b"sys")
        return root


if __name__ == "__main__":
    unittest.main()
