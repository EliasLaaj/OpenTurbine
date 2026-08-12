#!/usr/bin/env python3
"""Compile and run small host tests against real firmware source units."""
from pathlib import Path
import os
import shutil
import subprocess
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

def main() -> int:
    compiler = compiler_command()
    arduino_json = ROOT / ".pio" / "libdeps" / "esp32dev" / "ArduinoJson" / "src"
    host_tmp = ROOT / "artifacts" if os.name == "nt" else None
    if host_tmp is not None:
        host_tmp.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ot-native-", dir=host_tmp) as tmp:
        tests = [
            ("command_queue", [
                str(ROOT / "dev" / "host" / "command_queue_behavior.cpp"),
                str(ROOT / "src" / "system" / "CommandQueue.cpp"),
            ]),
            ("controllers", [str(ROOT / "dev" / "host" / "controller_behavior.cpp")]),
        ]
        for name, sources in tests:
            exe = Path(tmp) / (name + (".exe" if os.name == "nt" else ""))
            subprocess.run(compiler + [
                "-std=c++17", "-pthread",
                "-I", str(ROOT / "dev" / "host" / "fakes"),
                "-I", str(ROOT),
                *(["-I", str(arduino_json)] if arduino_json.exists() else []),
                *sources,
                "-o", str(exe),
            ], check=True)
            run_fresh_executable([str(exe)], label=name)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
