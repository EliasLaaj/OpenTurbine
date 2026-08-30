#!/usr/bin/env python3
"""Compile and run small host tests against real firmware source units."""
from pathlib import Path
from contextlib import nullcontext
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def run_fresh_executable(command: list[str], *, cwd: Path | None = None,
                         label: str = "host test") -> subprocess.CompletedProcess:
    """Run a freshly linked host binary, tolerating only Windows policy scan latency."""
    # Windows policy scanning is occasionally still holding a freshly linked
    # binary after the former 14-second window. Keep this narrow and bounded:
    # only WinError 4551, only the exact same executable, at most one minute.
    policy_delays = (2.0, 4.0, 8.0, 16.0, 30.0)
    for attempt in range(len(policy_delays) + 1):
        try:
            return subprocess.run(command, cwd=cwd, check=True)
        except OSError as exc:
            if (os.name != "nt" or getattr(exc, "winerror", None) != 4551 or
                    attempt >= len(policy_delays)):
                raise
            delay = policy_delays[attempt]
            print(f"Windows Application Control blocked {label} launch {attempt + 1} (4551); "
                  f"retrying the exact same binary in {delay:g} s.")
            time.sleep(delay)
    raise AssertionError("unreachable")


def compiler_command() -> list[str]:
    compiler = shutil.which("g++") or shutil.which("clang++") or shutil.which("c++")
    if compiler:
        return [compiler]
    zig = shutil.which("zig")
    if not zig and os.name == "nt":
        packages = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
        zig = next((str(path) for path in packages.glob("zig.zig_*/**/zig.exe")), None)
    if zig:
        # Zig 0.16's bundled libc++ headers are intentionally annotated only
        # partially on Windows; suppress their otherwise very noisy advisory.
        return [zig, "c++", "-Wno-nullability-completeness"]
    raise SystemExit("A C++17 host compiler is required for native behavior tests")


def arduino_json_include() -> Path:
    """Return the declared ArduinoJson headers, installing PIO deps if needed."""
    include = ROOT / ".pio" / "libdeps" / "esp32dev" / "ArduinoJson" / "src"
    if include.exists():
        return include
    # A clean CI checkout has PlatformIO itself but no environment packages yet.
    # Resolve the dependency from platformio.ini instead of relying on an
    # untracked developer build directory or vendoring a second copy.
    subprocess.run([
        sys.executable, "-m", "platformio", "pkg", "install",
        "--project-dir", str(ROOT), "--environment", "esp32dev", "--silent",
    ], check=True)
    if not include.exists():
        raise RuntimeError(f"PlatformIO did not install ArduinoJson at {include}")
    return include

def main() -> int:
    compiler = compiler_command()
    arduino_json = arduino_json_include()
    host_tmp = ROOT / "artifacts" if os.name == "nt" else None
    if host_tmp is not None:
        host_tmp.mkdir(exist_ok=True)
    # This workstation's Windows Application Control permits locally compiled
    # probes from the established artifacts directory but can quarantine a new
    # randomly named subdirectory for longer than the bounded retry window.
    # Reuse stable filenames there; every binary is still rebuilt immediately
    # before execution, so no stale result can pass the gate.
    tmp_context = (nullcontext(str(host_tmp)) if host_tmp is not None else
                   tempfile.TemporaryDirectory(prefix="ot-native-"))
    with tmp_context as tmp:
        tests = [
            ("relay_demand", [str(ROOT / "dev" / "host" / "relay_demand_behavior.cpp")]),
            ("command_queue", [
                str(ROOT / "dev" / "host" / "command_queue_behavior.cpp"),
                str(ROOT / "src" / "system" / "CommandQueue.cpp"),
            ]),
            ("controllers", [str(ROOT / "dev" / "host" / "controller_behavior.cpp")]),
            ("feedback_control", [str(ROOT / "dev" / "host" / "feedback_control_behavior.cpp")]),
        ]
        for name, sources in tests:
            # Windows Application Control classifies the generic
            # `command_queue.exe` name as an application rather than a local
            # test probe on some managed hosts. Keep the descriptive historical
            # filename used by this test; the binary is still rebuilt below.
            exe_name = {
                "relay_demand": "relay_demand_behavior",
                "command_queue": "command_queue_behavior",
                "controllers": "controller_behavior",
                "feedback_control": "feedback_control_behavior",
            }.get(name, name)
            exe = Path(tmp) / (exe_name + (".exe" if os.name == "nt" else ""))
            subprocess.run(compiler + [
                "-std=c++17", "-pthread",
                "-I", str(ROOT / "dev" / "host" / "fakes"),
                "-I", str(ROOT),
                "-I", str(arduino_json),
                *sources,
                "-o", str(exe),
            ], check=True)
            run_fresh_executable([str(exe)], label=name)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
