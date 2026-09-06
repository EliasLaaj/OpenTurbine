#!/usr/bin/env python3
"""Exercise one Set Starter transition on a safe bench ECU and restore its engine file."""

from __future__ import annotations

import argparse
import copy
import json
import time
import urllib.error
import urllib.request


def request_json(base: str, path: str, payload: dict | None = None, timeout: float = 10,
                 method: str | None = None) -> dict:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        base.rstrip("/") + path,
        data=body,
        method=method or ("GET" if payload is None else "POST"),
        headers={"Content-Type": "application/json", "Connection": "close"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_endpoint(base: str, path: str, predicate, timeout: float = 40) -> dict:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            data = request_json(base, path, timeout=5)
            if predicate(data):
                return data
        except Exception as error:
            last_error = error
        time.sleep(0.5)
    raise RuntimeError(f"{path} did not reach the expected state: {last_error}")


def post_allow_reboot(base: str, path: str, payload: dict, method: str = "POST") -> None:
    for attempt in range(6):
        try:
            result = request_json(base, path, payload, timeout=20, method=method)
            if result.get("ok") is False:
                raise RuntimeError(result.get("error") or result)
            return
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if error.code == 503 and attempt < 5:
                time.sleep(2)
                continue
            raise RuntimeError(f"{path} returned HTTP {error.code}: {detail}") from error
        except (TimeoutError, ConnectionError, urllib.error.URLError):
            return


def same_sequence(left: dict, right: dict) -> bool:
    keys = ("startup_seq", "startup_enter_actions", "startup_exit_actions")
    return all(left["hardware"].get(key) == right["hardware"].get(key) for key in keys)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://192.168.4.1")
    parser.add_argument("--transition-ms", type=int, default=2000)
    args = parser.parse_args()
    if not 100 <= args.transition_ms <= 60000:
        raise SystemExit("transition must be between 100 and 60000 ms")

    original = request_json(args.base, "/api/ecu_config")
    initial = request_json(args.base, "/api/device_info")
    if initial.get("state") != "STANDBY" or initial.get("outputs_active"):
        raise SystemExit("bench ECU must be healthy and in STANDBY")

    candidate = copy.deepcopy(original)
    actions = candidate["hardware"]["startup_enter_actions"]
    selected = next(
        action
        for slot in actions
        for action in slot
        if int(action.get("act", -1)) == 5 and float(action.get("value", 0)) > 0
    )
    selected["transition_ms"] = args.transition_ms
    samples: list[float] = []

    try:
        post_allow_reboot(
            args.base, "/api/hardware?source=sequence",
            {"startup_enter_actions": candidate["hardware"]["startup_enter_actions"]},
            method="PATCH",
        )
        stored = wait_endpoint(
            args.base, "/api/ecu_config",
            lambda config: any(
                int(action.get("transition_ms", 0)) == args.transition_ms
                for slot in config["hardware"]["startup_enter_actions"] for action in slot
            ),
        )
        wait_endpoint(args.base, "/api/device_info", lambda data: data.get("state") == "STANDBY")
        stored_transition = next(
            action.get("transition_ms", 0)
            for slot in stored["hardware"]["startup_enter_actions"]
            for action in slot
            if int(action.get("act", -1)) == 5 and float(action.get("value", 0)) > 0
        )
        if int(stored_transition) != args.transition_ms:
            raise AssertionError("starter transition did not survive save and reboot")

        start = request_json(args.base, "/api/start", {})
        if start.get("ok") is False:
            raise AssertionError(f"bench start was rejected: {start}")
        deadline = time.monotonic() + args.transition_ms / 1000 + 0.9
        while time.monotonic() < deadline:
            data = request_json(args.base, "/api/telemetry", timeout=5)
            samples.append(float(data["v"][25]) / 1000.0)
            time.sleep(0.12)
        post_allow_reboot(args.base, "/api/stop", {})
        wait_endpoint(args.base, "/api/device_info", lambda data: data.get("state") == "STANDBY", timeout=20)

        positive = [value for value in samples if value > 0.002]
        if not positive or max(positive) < 0.23:
            raise AssertionError(f"starter never reached its 25% command: {samples}")
        if not any(0.02 < value < 0.22 for value in positive):
            raise AssertionError(f"starter demand snapped instead of ramping: {samples}")
        if any(b + 0.01 < a for a, b in zip(positive, positive[1:])):
            raise AssertionError(f"starter ramp was not monotonic: {positive}")
        print(f"Starter ramp observed across {len(samples)} samples: "
              f"{min(positive):.3f} -> {max(positive):.3f}")
    finally:
        try:
            post_allow_reboot(args.base, "/api/stop", {})
        except Exception:
            pass
        try:
            wait_endpoint(args.base, "/api/device_info", lambda data: data.get("state") == "STANDBY", timeout=20)
            current = request_json(args.base, "/api/ecu_config")
            if not same_sequence(current, original):
                post_allow_reboot(
                    args.base, "/api/hardware?source=sequence",
                    {"startup_enter_actions": original["hardware"]["startup_enter_actions"]},
                    method="PATCH",
                )
                restored = wait_endpoint(args.base, "/api/ecu_config", lambda config: same_sequence(config, original))
                wait_endpoint(args.base, "/api/device_info", lambda data: data.get("state") == "STANDBY")
            else:
                restored = current
            if not same_sequence(restored, original):
                raise RuntimeError("original sequence was not restored")
        except Exception as error:
            raise RuntimeError(f"EMERGENCY RESTORE FAILED: {error}") from error

    final = request_json(args.base, "/api/device_info")
    if final.get("state") != "STANDBY" or final.get("outputs_active"):
        raise AssertionError(f"unsafe final state: {final}")
    print("Live starter transition PASSED; original sequence restored and all outputs are off.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
