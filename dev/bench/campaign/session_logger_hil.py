"""Session-log enable/disable and live-web interaction test on OTBench."""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from phase2_safety_hil import SafetyQualification  # noqa: E402
from classic_safety_hil import ClassicSafetyHil  # noqa: E402


SESSION_FIELDS = (
    "n1", "n2", "tot", "oil_temp", "oil", "p1", "p2", "throttle", "mode", "tit",
    "batt", "fuel_press", "fuel_flow", "glow", "wet_glow", "glow_current", "ign_current",
    "ign2_current", "oil_current", "fp2", "ab", "prop", "oil_pct", "loop",
)


def session_cfg(**enabled):
    cfg = {key: False for key in SESSION_FIELDS}
    cfg.update(enabled)
    # The logger deliberately retains 64 newest rows in RAM while engine
    # control is active. 500 ms still stresses live capture at twice the
    # product default without making an ordinary bounded shutdown exceed the
    # queue by construction.
    cfg["interval_ms"] = 500
    return {"session_log": cfg}


def wait_session_cfg(expected, timeout=25):
    """Wait for the persisted generation to become the live ECU generation."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen("http://192.168.4.1/api/status", timeout=3) as response:
                status = json.loads(response.read().decode("utf-8"))
            with urllib.request.urlopen("http://192.168.4.1/api/config", timeout=5) as response:
                config = json.loads(response.read().decode("utf-8"))
            last = (status, config.get("session_log", {}))
            if not status.get("config_apply_busy") and all(
                config.get("session_log", {}).get(key) == value
                for key, value in expected["session_log"].items()
            ):
                return
        except Exception as exc:  # noqa: BLE001
            last = exc
        time.sleep(0.5)
    raise RuntimeError(f"session settings did not become live: {last}")


def main():
    with urllib.request.urlopen("http://192.168.4.1/api/device_info", timeout=10) as response:
        target = json.loads(response.read().decode("utf-8")).get("target", "")
    classic = target == "esp32dev"
    if classic:
        q = ClassicSafetyHil()
        # Keep the rest of this behavior test shared. The reversed S3 tester
        # has no DAC channels, so use the Classic-specific N1/fuel profile
        # instead of pretending THROTTLE_IN/OILP analog stimulus exists.
        q.runner = type("ClassicSessionRunner", (), {"dc": q.dc})()
        q.t = q.tester
        q.firmware_before = q.dut.data().get("fw_version", "unknown")
        original_session_cfg = dict(q.original_cfg.get("session_log", {}))
    else:
        q = SafetyQualification()
        original_session_cfg = None
    rows = []
    restored = False
    error = None
    try:
        q.install()
        if not classic:
            q.set_safeties()

        disabled_cfg = session_cfg()
        ok, response = q.runner.dc.patch_cfg(disabled_cfg)
        if not ok:
            raise RuntimeError(f"could not disable all session fields: {response}")
        wait_session_cfg(disabled_cfg)
        before_path = q.dut.data().get("session_log_path") or ""
        q.start_running()
        time.sleep(3)
        q.recover()
        after_disabled_path = q.dut.data().get("session_log_path") or ""
        disabled_ok = after_disabled_path == before_path
        rows.append({
            "name": "NO_FIELDS_CREATES_NO_SESSION_FILE",
            "ok": disabled_ok,
            "before_path": before_path,
            "after_path": after_disabled_path,
        })
        print(f"[{'PASS' if disabled_ok else 'FAIL'}] NO_FIELDS_CREATES_NO_SESSION_FILE")

        enabled_cfg = session_cfg(n1=True, throttle=True, mode=True, loop=True)
        ok, response = q.runner.dc.patch_cfg(enabled_cfg)
        if not ok:
            raise RuntimeError(f"could not enable session fields: {response}")
        wait_session_cfg(enabled_cfg)
        q.start_running()
        web_samples = 0
        deadline = time.time() + 10
        last = {}
        active_path = ""
        max_active_loop_exec_ms = 0.0
        max_recorded_loop_exec_ms = 0.0
        max_queued_rows = 0
        while time.time() < deadline:
            last = q.dut.data()
            active_path = last.get("session_log_path") or active_path
            max_queued_rows = max(max_queued_rows, int(last.get("session_queued_rows") or 0))
            web_samples += 1
            time.sleep(0.2)
        q.recover()

        standby, standby_data = q.dut.poll_until(
            lambda d: d.get("mode") == "STANDBY", timeout=40, interval=0.2
        )
        if not standby:
            raise RuntimeError(f"session run did not return to STANDBY: {standby_data}")

        completed_path = ""
        for _ in range(30):
            completed = q.dut.data()
            completed_path = completed.get("session_log_path") or ""
            if completed_path:
                break
            time.sleep(0.2)
        csv_text = ""
        if completed_path:
            with urllib.request.urlopen("http://192.168.4.1/api/session/log", timeout=10) as response:
                csv_text = response.read().decode("utf-8")
        lines = [line for line in csv_text.splitlines() if line.strip()]
        expected_header = (
            "t_ms,mode,n1_rpm,thr_pct,loop_hz,loop_period_max_ms,"
            "loop_exec_avg_ms,loop_exec_max_ms,loop_overrun_count"
        )
        header_ok = bool(lines) and lines[0] == expected_header
        # Compact telemetry deliberately omits loop diagnostics, so the
        # one-time /api/data base can contain a pre-run configuration spike.
        # The session rows are the authoritative timing evidence for this run.
        if header_ok:
            first_sample_ms = None
            for line in lines[1:]:
                columns = line.split(",")
                if len(columns) >= 9:
                    sample_ms = int(columns[0])
                    if first_sample_ms is None:
                        first_sample_ms = sample_ms
                    sample_max = float(columns[7])
                    max_recorded_loop_exec_ms = max(max_recorded_loop_exec_ms, sample_max)
                    # The first completed one-second windows may predate START
                    # and include the deliberately heavy STANDBY config apply.
                    # Qualify active session timing after two seconds of the
                    # captured run, while retaining the overall peak below for
                    # diagnosis.
                    if sample_ms - first_sample_ms >= 2000:
                        max_active_loop_exec_ms = max(max_active_loop_exec_ms, sample_max)
        enabled_ok = (
            not active_path and bool(completed_path) and header_ok and
            # A sustained 2 Hz REST read rate is comfortably above the UI's
            # fallback need and leaves room for deliberately closed/bounded
            # API transports on the small ECU. Data integrity and loop latency
            # remain the authoritative checks below.
            len(lines) >= 20 and web_samples >= 20 and max_active_loop_exec_ms < 20.0 and
            last.get("session_logger_healthy") is True and
            int(last.get("session_dropped_rows") or 0) == 0
        )
        rows.append({
            "name": "ENABLED_LOGGING_DEFERS_FLASH_AND_STAYS_RESPONSIVE",
            "ok": enabled_ok,
            "active_path": active_path,
            "completed_path": completed_path,
            "csv_lines": len(lines),
            "header_ok": header_ok,
            "header": lines[0] if lines else "",
            "web_samples": web_samples,
            "max_active_loop_exec_ms": max_active_loop_exec_ms,
            "max_recorded_loop_exec_ms": max_recorded_loop_exec_ms,
            "max_queued_rows": max_queued_rows,
            "logger_healthy": last.get("session_logger_healthy"),
            "dropped_rows": last.get("session_dropped_rows"),
        })
        print(f"[{'PASS' if enabled_ok else 'FAIL'}] ENABLED_LOGGING_DEFERS_FLASH_AND_STAYS_RESPONSIVE: "
              f"samples={web_samples} rows={max(0, len(lines) - 1)} "
              f"max_loop={max_active_loop_exec_ms:.3f}ms")
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        print("ERROR:", error)
    finally:
        try:
            if classic:
                q.restore()
                ok, detail = q.dc.patch_cfg({"session_log": original_session_cfg})
                if not ok:
                    raise RuntimeError(f"session settings restore failed: {detail}")
                restored = True
            else:
                restored = q.close()
        except Exception as exc:  # noqa: BLE001
            error = error or f"restore: {type(exc).__name__}: {exc}"

    result = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "firmware": q.firmware_before,
        "rows": rows,
        "restored": restored,
        "error": error,
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results",
                        "session_logger_hil_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    passed = sum(1 for row in rows if row["ok"])
    print(f"RESULT: {passed}/{len(rows)} session-log checks passed; restored={restored}")
    print("Results:", os.path.abspath(path))
    return 0 if error is None and restored and len(rows) == 2 and passed == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
