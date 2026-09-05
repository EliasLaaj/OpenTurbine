import importlib.util
import tempfile
import struct
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_setup_package", ROOT / "tools" / "build_setup_package.py")
build_setup_package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_setup_package)


class BuildSetupPackageTests(unittest.TestCase):
    def test_stage_package_uses_schema_and_compliance_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            build_root = tmp / "build"
            for env in build_setup_package.TARGETS:
                env_dir = build_root / env
                env_dir.mkdir(parents=True)
                for name in ("bootloader.bin", "partitions.bin", "firmware.bin", "littlefs.bin"):
                    data = bytearray(256 if name == "firmware.bin" else 32)
                    if name == "firmware.bin":
                        struct.pack_into("<I", data, 32, 0xABCD5432)
                        data[176:184] = b"BUILD123"
                    (env_dir / name).write_bytes(data)
            boot_app0 = tmp / "boot_app0.bin"
            boot_app0.write_bytes(b"\x00" * 32)
            esptool = tmp / "esptool.exe"
            esptool.write_bytes(b"exe")
            esptool_license = tmp / "esptool-LICENSE"
            esptool_license.write_text("GPL test license", encoding="utf-8")
            stage = tmp / "stage"
            with mock.patch.object(build_setup_package, "BUILD_ROOTS", [build_root]), \
                mock.patch.object(build_setup_package, "find_boot_app0", return_value=boot_app0), \
                mock.patch.object(build_setup_package, "read_version", return_value="9.9.9"):
                manifest = build_setup_package.stage_package(stage, esptool, esptool_license)
            self.assertEqual(manifest["package_schema"], 4)
            self.assertEqual(manifest["setup_tool_version"], "0.7.2")
            self.assertEqual(manifest["minimum_setup_tool_version"], "0.7.0")
            self.assertTrue((stage / "LICENSE").exists())
            self.assertTrue((stage / "THIRD_PARTY_NOTICES.md").exists())
            self.assertEqual(
                __import__("json").loads((stage / "SBOM.spdx.json").read_text())["spdxVersion"],
                "SPDX-2.3",
            )
            self.assertEqual((stage / "tools" / "esptool-LICENSE").read_text(), "GPL test license")
            self.assertEqual(manifest["bundled_tools"]["esptool"]["version"], "5.3.0")
            self.assertTrue(any((stage / "pcb_profiles" / "targets").glob("*.json")))
            for target in manifest["targets"].values():
                self.assertRegex(target["build_id"], r"^[0-9a-f]{16}$")
                for image in target["usb_flash"]:
                    self.assertEqual(len(image["sha256"]), 64)
                    self.assertGreater(image["bytes"], 0)
                    self.assertTrue(image["source_commit"])
                    self.assertIsInstance(image["source_dirty"], bool)
                profile = target["pcb_profile"]
                self.assertGreater(int(profile["address"], 0), 0)
                self.assertGreater(profile["size"], 0)
                self.assertIsInstance(profile["official_profiles"], list)

if __name__ == "__main__":
    unittest.main()
