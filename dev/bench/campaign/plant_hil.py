#!/usr/bin/env python3
"""Closed-loop causal startup/run/STOP qualification.

Unlike the scripted gate campaigns, this test derives N1/N2, EGT, oil pressure,
and flame from the ECU's physically measured outputs.  It proves that a
representative engine lifecycle works as a causal system; it does not claim to
predict a particular turbine's thermodynamics.
"""

from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
import sys
import time
import traceback

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "harness"))

from otbench.pinmap import PinMap  # noqa: E402
from otbench.plant import TurbinePlant  # noqa: E402
from otbench.plant_bridge import PhysicalPlantBridge  # noqa: E402
from ten_build_webui_hil import TenBuildRunner, chan_input, chan_output  # noqa: E402
from reversed_digital_sensor_hil import ReversedDigitalSensorHil  # noqa: E402


def main() -> int:
    target = os.environ.get("OTBENCH_TARGET", "s3").strip().lower()
    soak_seconds = max(0, int(os.environ.get("OTBENCH_PLANT_SOAK_SECONDS", "0")))
    # Keep the synthetic engine's spool gate comfortably below its 32k model
    # idle and leave real margin above the running floor. The former 30k/26k
    # pair let one period-measurement overshoot complete Spool just before the
    # still-accelerating model dipped under the floor on RUNNING entry.
    spool_target_rpm = 24000
    runner = TenBuildRunner(port=os.environ.get("OTBENCH_PORT", "COM3"))
    rows = []
    error = None
    restored = False

    def record(name, ok, **detail):
        row = {"name": name, "ok": bool(ok), **detail}
        rows.append(row)
        print("[%s] %s: %s" % ("PASS" if ok else "FAIL", name, detail), flush=True)

    def build(hw):
        if target == "classic":
            ReversedDigitalSensorHil.quiet_profile(hw)
            hw["controls"].update(start_pin=13, stop_pin=14, start_active_h=False,
                                  stop_active_h=False, start_pullup=True, stop_pullup=True)
            # Use a representative multi-tooth pickup for the continuously
            # changing plant ramp. PPR=1 is separately proven by the static pin
            # campaign; at very low ramp frequencies the tester timer's first
            # divider reconfiguration can create a non-physical edge burst.
            hw["sensors"]["n1_rpm"].update(enabled=True, pin=4, ppr=10.0)
            hw["sensors"]["throttle_input"].update(enabled=False, pin=-1, rc_pwm=False)
            hw["sensors"]["flame"].update(enabled=True, pin=27)
            hw["actuators"]["throttle"].update(
                enabled=True, pin=17, type=0, min_us=1000, max_us=2000, inverted=False
            )
            hw["actuators"]["fuel_sol"].update(enabled=True, pin=22, active_h=True)
            hw["actuators"]["igniter"].update(enabled=True, pin=23, active_h=True, pwm=False)
        else:
            runner.common_turbine(hw, with_idle_input=False, with_oil=False)
            runner.enable_n1(hw)
            runner.enable_n2(hw)
            # The protected OTBench profile models the main cross-links but
            # not the separate legacy three-wire MAX6675 emulator. The plant
            # remains causal without ECU EGT feedback; its own EGT state is
            # still derived from measured ignition/fuel/spool outputs.
            if hw.get("_pcb_profile", {}).get("id") != "otbench-s3-harness":
                runner.enable_tot(hw)
            runner.enable_oil_press(hw, pin=1)
            hw["sensors"]["flame"].update(enabled=True, pin=2)
        # The established S3 fixture does not reliably capture GPIO17. Use two
        # independently captured, hardware-valid channels for the closed loop:
        # starter PWM on GPIO11 and an on/off oil pump on GPIO39.
        hw["actuators"]["starter"].update(
            enabled=True, pin=21 if target == "classic" else 11,
            type=1, freq_hz=5000, res_bits=12,
            pwm_min_pct=0, pwm_max_pct=100, inverted=False
        )
        hw["actuators"]["oil_pump"].update(
            enabled=target != "classic", pin=-1 if target == "classic" else 39,
            type=2, active_h=True,
        )
        hw["actuators"]["starter_en"].update(enabled=False, pin=-1)
        if target == "classic":
            # The shared registry synchronizer builds every legacy mirror. The
            # only exception is flame: this reversed fixture drives GPIO27 as
            # a digital threshold signal, and GPIO27 is not a Classic ADC pin.
            hw["channel_registry"] = {
                "version": 1,
                "inputs": [
                    chan_input("flame_main", "Flame", "flame", "flame", 0, 27),
                ],
                "outputs": [],
                "bindings": [],
            }
        startup = [
            "StarterSpin", "IgniterOn", "TimedDelay", "FuelOpen",
            "FuelPumpIdle", "FlameConfirm", "Spool",
        ]
        if target != "classic":
            startup.insert(0, "OilPrime")
        hw["startup_seq"] = startup
        hw["startup_delay_ms"] = [500 if block == "TimedDelay" else 0 for block in startup]
        hw["startup_ignition_target"] = [0] * len(startup)
        hw["startup_enter_actions"] = [[] for _ in startup]
        hw["startup_exit_actions"] = [[] for _ in startup]
        hw["shutdown_seq"] = ["ImmediateCut", "TimedDelay", "FinalStop"]
        hw["shutdown_delay_ms"] = [0, 500, 0]
        hw["shutdown_ignition_target"] = [0, 0, 0]
        hw["shutdown_enter_actions"] = [[], [], []]
        hw["shutdown_exit_actions"] = [[], [], []]
        hw["controllers"]["oil_loop"] = target != "classic"

    try:
        runner.apply_profile({"id": "closed_loop_plant", "build": build})
        config_patch = {
            "engine": {"min_rpm": 20000},
            "calibration": {
                "oil_poly": {"a": 0, "b": 0, "c": round(6.0 / 4095.0, 8),
                             "d": 0, "x_min": 0, "x_max": 4095},
            },
            "oil": {"startup_min_bar": 1.2, "startup_pressure": 3.0},
            "sequence": {"startup": {
                "pre_ign_rpm": 2500,
                "starter_demand": 65,
                "starter_timeout_ms": 12000,
                "flame_timeout_ms": 7000,
                "rpm_target": spool_target_rpm,
                "rpm_timeout_ms": 18000,
                "oil_arm_timeout_ms": 5000,
            }},
            "throttle": {"fuel_pump_min_pct": 12},
        }
        runner.note_config_patch(config_patch)
        ok, response = runner.dc.patch_cfg(config_patch)
        if not ok:
            raise RuntimeError("closed-loop plant config rejected: %r" % (response,))

        dut = runner.dut
        tester = runner.t
        dut.ensure_mode_standby(timeout=20)
        dut.ensure_dev_mode(True)
        dut.ensure_bench_mode(False)
        driven_signals = {"N1", "FLAME"}
        if target != "classic":
            driven_signals.update({"N2", "TOT", "OILP"})
        plant_pinmap = PinMap()
        plant_model = TurbinePlant()
        if target == "classic":
            plant_pinmap.by_name["N1"]["ppr"] = 10.0
            # Keep the role-reversed signal generator well above its low-Hz
            # divider transition. This represents a geared/high-torque starter
            # and still preserves the causal dependency on measured starter PWM.
            plant_model.config.starter_target_rpm = 30000.0
            plant_model.config.spool_tau_s = 0.4
        bridge = PhysicalPlantBridge(
            dut, tester, plant_pinmap, plant_model,
            signal_map={"starter": "OILPUMP_OUT", "oil_pump": "STARTER_EN"},
            driven_signals=driven_signals,
        )
        bridge.safe_inputs()
        operator_signal = None if target == "classic" else "THROTTLE_IN"
        startup_operator = 1.5
        if operator_signal:
            tester.set(operator_signal, startup_operator)

        safe_samples = []
        for _ in range(8):
            actuators, physical, _ = bridge.tick()
            safe_samples.append((actuators, physical))
            time.sleep(0.1)
        safe = all(
            sample[0].fuel <= 0.01 and not sample[0].fuel_shutoff and
            not sample[0].igniter and sample[0].starter <= 0.01
            for sample in safe_samples
        )
        record("STANDBY_PHYSICAL_COMBUSTION_AND_STARTER_OUTPUTS_SAFE", safe)

        code, response = dut.start()
        if code != 200:
            try:
                start_diagnostics = dut.data()
            except Exception as diagnostic_error:  # noqa: BLE001
                start_diagnostics = {"read_error": str(diagnostic_error)}
            raise RuntimeError(
                "closed-loop START rejected: HTTP %s %r diagnostics=%r" %
                (code, response, start_diagnostics)
            )

        seen = {"starter": False, "igniter": False, "fuel": False, "flame": False,
                "oil": target == "classic", "spool": False}
        blocks = []
        startup_trace = []
        next_trace = 0.0
        peak_egt = 0.0
        peak_n1 = 0.0
        deadline = time.monotonic() + 65.0
        operator_refresh = 0.0
        last_data = {}
        while time.monotonic() < deadline:
            if operator_signal and time.monotonic() >= operator_refresh:
                tester.set(operator_signal, startup_operator)
                operator_refresh = time.monotonic() + 0.5
            actuators, physical, plant = bridge.tick()
            last_data = dut.data()
            block = last_data.get("current_block")
            if block and (not blocks or blocks[-1] != block):
                blocks.append(block)
            seen["starter"] |= actuators.starter > 0.1 and actuators.starter_enable
            seen["igniter"] |= actuators.igniter
            seen["fuel"] |= actuators.fuel_shutoff and actuators.fuel > 0.02
            seen["flame"] |= plant.flame
            seen["oil"] |= plant.oil_bar >= 1.2
            # ECU and tester observe pulse-period RPM while the continuous
            # plant model is still accelerating. A one-sample phase lag of a
            # few percent is expected at Spool completion; the ECU reaching
            # RUNNING independently proves its measured RPM crossed the exact
            # configured gate. Keep the model-side check meaningful without
            # requiring both clocks to cross on the same sample.
            seen["spool"] |= plant.n1_rpm >= spool_target_rpm * 0.95
            peak_egt = max(peak_egt, plant.egt_c)
            peak_n1 = max(peak_n1, plant.n1_rpm)
            if time.monotonic() >= next_trace:
                startup_trace.append({
                    "block": block,
                    "oil_pct": last_data.get("oil_pct"),
                    "oil_bar": last_data.get("oil"),
                    "oil_model_bar": round(plant.oil_bar, 3),
                    "oil_command_v": bridge.last_drive.get("OILP"),
                    "oil_owner": last_data.get("oil_command_owner"),
                    "n1_model_rpm": round(plant.n1_rpm),
                    "n1_command_hz": bridge.last_drive.get("N1"),
                    "n1_measured_rpm": last_data.get("n1"),
                    "physical_oil": round(actuators.oil_pump, 3),
                    "physical_starter_enable": physical.get("STARTER_EN"),
                    "outputs": [
                        {"id": row.get("id"), "demand": row.get("demand")}
                        for row in last_data.get("registry_outputs", [])
                        if row.get("purpose") == "oil_pump" or row.get("id") == "oil_pump_main"
                    ],
                })
                next_trace = time.monotonic() + 0.5
            if last_data.get("mode") == "RUNNING":
                break
            if last_data.get("mode") in ("FAULT", "SHUTDOWN", "STANDBY") and blocks:
                break
            time.sleep(0.08)

        lifecycle_ok = (
            last_data.get("mode") == "RUNNING" and all(seen.values()) and
            peak_egt >= 250 and peak_n1 >= spool_target_rpm * 0.95 and
            "FlameConfirm" in blocks
        )
        record(
            "PHYSICAL_OUTPUTS_CAUSE_COMPLETE_STARTUP_TO_RUNNING", lifecycle_ok,
            mode=last_data.get("mode"), blocks=blocks, seen=seen,
            peak_egt_c=round(peak_egt, 1), peak_n1_rpm=round(peak_n1),
            event=last_data.get("fault_description") or last_data.get("last_event"),
            trace=startup_trace,
        )

        # A real operator-demand increase must first appear at the physical fuel
        # output and then cause a shaft-speed increase in the model.
        if target != "classic":
            baseline_fuel, _physical, baseline_plant = bridge.tick()
            baseline_demand = baseline_fuel.fuel
            baseline_n1 = baseline_plant.n1_rpm
            tester.set(operator_signal, 3.0)
            max_fuel = baseline_demand
            max_n1 = baseline_n1
            response_data = {}
            response_deadline = time.monotonic() + 12.0
            operator_refresh = 0.0
            while time.monotonic() < response_deadline:
                if time.monotonic() >= operator_refresh:
                    tester.set(operator_signal, 3.0)
                    operator_refresh = time.monotonic() + 0.5
                actuators, _physical, plant = bridge.tick()
                response_data = dut.data()
                max_fuel = max(max_fuel, actuators.fuel)
                max_n1 = max(max_n1, plant.n1_rpm)
                time.sleep(0.08)
            record(
                "OPERATOR_DEMAND_RAISES_PHYSICAL_FUEL_THEN_SHAFT_SPEED",
                max_fuel >= baseline_demand + 0.12 and max_n1 >= baseline_n1 + 3000,
                baseline_fuel=round(baseline_demand, 3), max_fuel=round(max_fuel, 3),
                baseline_n1=round(baseline_n1), max_n1=round(max_n1),
                telemetry=response_data,
            )

        if soak_seconds:
            # Roll the ECU's one-second timing window and the compact
            # telemetry rotation past configuration/startup before scoring a
            # steady RUNNING soak. Otherwise the first merged REST sample can
            # retain an earlier, intentionally heavyweight save/reboot spike
            # for the entire max() calculation even though the run is clean.
            settle_deadline = time.monotonic() + 2.5
            while time.monotonic() < settle_deadline:
                bridge.tick()
                dut.data()
                time.sleep(0.08)
            soak_deadline = time.monotonic() + soak_seconds
            samples = 0
            transport_errors = 0
            status_errors = 0
            min_heap = None
            max_loop_ms = 0.0
            max_loop_period_ms = 0.0
            start_overruns = None
            end_overruns = None
            stayed_running = True
            while time.monotonic() < soak_deadline:
                try:
                    _actuators, _physical, _plant = bridge.tick()
                    data = dut.data()
                    samples += 1
                    stayed_running &= data.get("mode") == "RUNNING"
                    max_loop_ms = max(
                        max_loop_ms,
                        float(data.get("loop_exec_max_ms", 0) or 0),
                    )
                    max_loop_period_ms = max(
                        max_loop_period_ms,
                        float(data.get("loop_period_max_ms", 0) or 0),
                    )
                    current_overruns = int(data.get("loop_overrun_count", 0) or 0)
                    if start_overruns is None:
                        start_overruns = current_overruns
                    end_overruns = current_overruns
                    # Heap lives on the compact status endpoint. Sample it at
                    # a low rate so the measurement does not become the load.
                    if samples == 1 or samples % 10 == 0:
                        try:
                            heap = dut.status().get("free_heap")
                            if heap is not None:
                                min_heap = int(heap) if min_heap is None else min(min_heap, int(heap))
                        except Exception:  # noqa: BLE001
                            status_errors += 1
                except Exception:  # noqa: BLE001
                    transport_errors += 1
                if not stayed_running:
                    break
                time.sleep(0.08)
            record(
                "CONTINUOUS_CLOSED_LOOP_SOAK_STAYS_HEALTHY",
                stayed_running and samples > max(10, soak_seconds * 2) and
                transport_errors <= max(2, samples // 1000) and status_errors <= 1 and
                min_heap is not None and min_heap >= (16000 if target == "classic" else 24000) and
                0 < max_loop_ms < 50.0 and 0 < max_loop_period_ms < 50.0 and
                start_overruns is not None and end_overruns is not None and
                end_overruns - start_overruns <= max(1, soak_seconds // 300),
                requested_s=soak_seconds, samples=samples, transport_errors=transport_errors,
                status_errors=status_errors, min_heap=min_heap, max_loop_exec_ms=max_loop_ms,
                max_loop_period_ms=max_loop_period_ms,
                loop_overrun_delta=(end_overruns - start_overruns)
                if start_overruns is not None and end_overruns is not None else None,
            )

        # Use the physical STOP input. The serial fixture gives a conservative
        # coarse time; Q90 still requires an independent logic-analyser capture
        # for the final <=100 ms release claim.
        tester.set("STOP", 1)
        stop_started = time.monotonic()
        cut_latency = None
        cut_sample = None
        while time.monotonic() - stop_started < 1.0:
            actuators, physical = bridge.read_actuators()
            if (actuators.fuel <= 0.01 and not actuators.fuel_shutoff and
                    not actuators.igniter and actuators.starter <= 0.01):
                cut_latency = time.monotonic() - stop_started
                cut_sample = physical
                break
            time.sleep(0.01)
        held_safe = cut_latency is not None
        hold_deadline = time.monotonic() + 2.0
        while time.monotonic() < hold_deadline:
            actuators, _physical, _plant = bridge.tick()
            held_safe &= (
                actuators.fuel <= 0.01 and not actuators.fuel_shutoff and
                not actuators.igniter and actuators.starter <= 0.01
            )
            time.sleep(0.08)
        record(
            "PHYSICAL_STOP_CUTS_AND_LATCHES_ALL_COMBUSTION_OUTPUTS",
            held_safe and cut_latency <= 0.35,
            coarse_cut_latency_s=round(cut_latency, 4) if cut_latency is not None else None,
            physical=cut_sample,
        )
        tester.set("STOP", 0)
        dut.stop()
        dut.ensure_mode_standby(timeout=30)
    except Exception as exc:  # noqa: BLE001
        error = "%s: %s" % (type(exc).__name__, exc)
        print("ERROR:", error, flush=True)
        traceback.print_exc()
    finally:
        try:
            runner.t.set("STOP", 0)
            runner.t.reset()
            runner.dut.stop()
            runner.dut.ensure_mode_standby(timeout=30)
            restored = runner.restore_original()
        except Exception as exc:  # noqa: BLE001
            error = error or "restore: %s: %s" % (type(exc).__name__, exc)
        runner.close()

    result = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "firmware": runner.firmware_before,
        "firmware_after": runner.firmware_after,
        "firmware_match": runner.firmware_after == runner.firmware_before,
        "rows": rows,
        "restored": restored,
        "error": error,
        "model_scope": "low-order causal ECU behavior oracle; not turbine thermodynamic validation",
    }
    result_dir = HERE.parent / "results"
    result_dir.mkdir(parents=True, exist_ok=True)
    result_path = result_dir / ("plant_hil_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".json")
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    passed = sum(1 for row in rows if row["ok"])
    print("RESULT: %d/%d plant checks passed; restored=%s" % (passed, len(rows), restored))
    print("Results:", result_path.resolve())
    # Classic records standby safety, the causal lifecycle and physical STOP.
    # S3 additionally records the operator-demand/fuel/speed relationship.
    expected = (4 if soak_seconds else 3) if target == "classic" else (5 if soak_seconds else 4)
    return 0 if (error is None and restored and result["firmware_match"] and
                 len(rows) == expected and passed == len(rows)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
