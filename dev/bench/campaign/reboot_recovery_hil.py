"""Repeated warm-reboot, AP/DHCP, API, and configuration-integrity HIL."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request


BASE = os.environ.get("OTBENCH_DUT", "http://192.168.4.1").rstrip("/")
SSID = os.environ.get("OPENTURBINE_SSID", "OpenTurbine")
REPETITIONS = int(os.environ.get("OPENTURBINE_REBOOT_REPETITIONS", "10"))


def get(path: str, timeout: float = 5) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def post(path: str, value: dict, timeout: float = 10) -> tuple[int | None, dict]:
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(value, separators=(",", ":")).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))
    except (TimeoutError, OSError, urllib.error.URLError) as error:
        # A successful hardware save intentionally restarts shortly after the
        # response is queued. On a busy Wi-Fi stack the TCP reply can be lost
        # even though the committed profile boots correctly. The caller must
        # classify this using boot-count advance and configuration identity.
        return None, {"transport_error": "%s: %s" % (type(error).__name__, error)}


def stable(value: dict) -> dict:
    copy = json.loads(json.dumps(value))
    copy.pop("_pcb_profile", None)
    copy.pop("_i2c_discovery", None)
    return copy


def digest(value: dict) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def wlan(*args: str) -> None:
    subprocess.run(["netsh", "wlan", *args], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_api(timeout: float = 25) -> tuple[bool, float, dict]:
    started = time.monotonic()
    last: dict = {}
    while time.monotonic() - started < timeout:
        try:
            last = get("/api/data", timeout=2)
            return True, time.monotonic() - started, last
        except (OSError, ValueError, urllib.error.URLError):
            time.sleep(0.4)
    return False, time.monotonic() - started, last


def main() -> int:
    hardware = get("/api/hardware")
    config = get("/api/config")
    hardware_payload = json.loads(json.dumps(hardware))
    hardware_payload.pop("_i2c_discovery", None)
    initial_hardware = digest(stable(hardware_payload))
    initial_config = digest(config)
    rows: list[dict] = []

    for number in range(1, REPETITIONS + 1):
        before_boot = int(get("/api/data").get("boot_count", 0))
        code, response = post("/api/hardware", hardware_payload)
        # Leave before the scheduled restart, then make Windows perform a real
        # association and DHCP transaction after the AP is back.
        wlan("disconnect")
        time.sleep(7)
        wlan("connect", f"name={SSID}", f"ssid={SSID}")
        ok, elapsed, data = wait_api()
        after_boot = int(data.get("boot_count", 0)) if ok else 0
        identity_ok = False
        if ok and after_boot > before_boot:
            try:
                identity_ok = (
                    digest(stable(get("/api/hardware"))) == initial_hardware and
                    digest(get("/api/config")) == initial_config
                )
            except (OSError, ValueError, urllib.error.URLError):
                identity_ok = False
        # A missing HTTP status is acceptable only when independent evidence
        # proves that the requested reboot occurred and the exact hardware and
        # settings survived it. Explicit non-200 replies still fail.
        response_ok = code == 200 or code is None
        row_ok = response_ok and ok and after_boot > before_boot and identity_ok
        row = {
            "iteration": number,
            "ok": row_ok,
            "post_code": code,
            "post_response": response,
            "api_recovery_s": round(elapsed, 3),
            "boot_before": before_boot,
            "boot_after": after_boot,
            "configuration_identity": identity_ok,
        }
        rows.append(row)
        print("[%s] warm reboot %d/%d: %s" %
              ("PASS" if row_ok else "FAIL", number, REPETITIONS, row), flush=True)
        if not row_ok:
            break

    final_hardware = stable(get("/api/hardware")) if rows[-1]["ok"] else {}
    final_config = get("/api/config") if rows[-1]["ok"] else {}
    integrity = bool(final_hardware) and digest(final_hardware) == initial_hardware and \
        digest(final_config) == initial_config
    print("[%s] configuration identity" % ("PASS" if integrity else "FAIL"), flush=True)

    result = {
        "repetitions_requested": REPETITIONS,
        "rows": rows,
        "configuration_identity": integrity,
        "passed": len(rows) == REPETITIONS and all(row["ok"] for row in rows) and integrity,
    }
    output = Path(__file__).resolve().parents[1] / "results" / \
        ("reboot_recovery_hil_" + time.strftime("%Y%m%d_%H%M%S") + ".json")
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print("Results:", output)
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
