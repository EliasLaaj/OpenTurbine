"""The bench test suite.

Each test drives stimulus on one side and asserts the other side agrees:
  - input paths:  tester drives a pin  -> assert DUT telemetry
  - output paths: DUT drives a pin      -> assert tester measurement

Tests that need a feature not fitted/enabled on the DUT raise SkipTest with a
hint rather than failing.
"""

import time

from .runner import SkipTest


# ── shared helpers ───────────────────────────────────────────
def _to_standby(ctx):
    ctx.tester.reset()
    ok, d = ctx.dut.ensure_mode_standby()
    return ok, d


def _level_from_state(state, name):
    return int(state.get(name, state.get(name + "_level", 0)) or 0)


def _variable_output_safe(state, signal, actuator):
    output_type = int(actuator.get("type", 0) or 0)
    inverted = bool(actuator.get("inverted", False))
    if output_type == 0:
        pulse = float(state.get(signal + "_us", 0) or 0)
        if pulse <= 0:
            return True
        expected = float(actuator.get("max_us" if inverted else "min_us", 2000 if inverted else 1000))
        span = abs(float(actuator.get("max_us", 2000)) - float(actuator.get("min_us", 1000)))
        return abs(pulse - expected) <= max(40.0, span * 0.06)
    if output_type == 1:
        duty = float(state.get(signal + "_duty", 0) or 0)
        expected = float(actuator.get("pwm_max_pct" if inverted else "pwm_min_pct", 100 if inverted else 0)) / 100.0
        return abs(duty - expected) <= 0.035
    expected_level = 1 if not actuator.get("active_h", True) else 0
    return _level_from_state(state, signal) == expected_level


def _relay_output_safe(state, signal, actuator):
    expected_level = 1 if not actuator.get("active_h", True) else 0
    return _level_from_state(state, signal) == expected_level


def _tool_output(ctx, c, cmd, sig_name, telem_key, pwm=False, window=1.8):
    """Fire a STANDBY actuator self-test command and confirm both the DUT
    telemetry and the tester's pin measurement see it drive."""
    ctx.dut.ensure_mode_standby()
    actuator_key = {
        "OILPUMP_OUT": "oil_pump", "FUEL_SOL": "fuel_sol",
        "IGNITER": "igniter", "STARTER_EN": "starter_en",
    }.get(sig_name)
    actuator = ctx.dut.hardware().get("actuators", {}).get(actuator_key, {})
    # Actuator self-tests are mutually exclusive; a previous one may still be
    # expiring. Retry briefly while the DUT reports another output active.
    deadline = time.time() + 14
    code, resp = ctx.dut.command(cmd)
    while code == 409 and time.time() < deadline:
        time.sleep(0.5)
        code, resp = ctx.dut.command(cmd)
    if code != 200:
        raise SkipTest("%s rejected (HTTP %s): %s — actuator likely not enabled on DUT"
                       % (cmd, code, resp.get("error")))
    active_pin = False
    active_tel = False
    deadline = time.time() + window
    while time.time() < deadline:
        state = ctx.tester.state()
        safe = (_variable_output_safe(state, sig_name, actuator) if pwm else
                _relay_output_safe(state, sig_name, actuator))
        active_pin = active_pin or not safe
        if ctx.dut.data().get(telem_key):
            active_tel = True
        if active_pin and active_tel:
            break
    c.expect(active_tel, "%s -> DUT telemetry '%s' active" % (cmd, telem_key))
    c.expect(active_pin, "%s -> tester measures %s driven" % (cmd, sig_name))
    # Let this tool expire so the next test starts from a clean idle DUT.
    telemetry_off, _ = ctx.dut.poll_until(lambda x: not x.get(telem_key), timeout=12)
    physical_off = False
    deadline = time.time() + 1.0
    while time.time() < deadline:
        state = ctx.tester.state()
        physical_off = (
            _variable_output_safe(state, sig_name, actuator) if pwm else
            _relay_output_safe(state, sig_name, actuator)
        )
        if physical_off:
            break
        time.sleep(0.04)
    c.expect(telemetry_off, "%s telemetry returned inactive" % cmd)
    c.expect(physical_off, "%s physical output returned safe" % cmd)


# ── connectivity ─────────────────────────────────────────────
def t_handshake(ctx, c):
    line = ctx.tester.ping()
    c.expect(line.startswith("OK OTBench"), "tester PING -> %r" % line)
    ok, s = ctx.dut.ping()
    c.expect(ok, "DUT /api/status reachable" if ok else "DUT unreachable: %s" % s)
    if ok:
        d = ctx.dut.data()
        c.info("DUT fw=%s mode=%s profile_match=%s"
               % (d.get("fw_version"), d.get("mode"), d.get("profile_match")))


def t_safe_state(ctx, c):
    ok, d = _to_standby(ctx)
    c.expect(ok, "DUT settled to STANDBY (mode=%s)" % d.get("mode"))
    state = ctx.tester.state()
    actuators = ctx.dut.hardware().get("actuators", {})
    fuel_shutoff_fitted = bool(actuators.get("fuel_sol", {}).get("enabled"))
    telemetry_safe = (
        (fuel_shutoff_fitted or float(d.get("throttle_effective") or 0) <= 0.001) and
        not d.get("fuel_sol_open") and not d.get("igniter_on") and
        not d.get("igniter2_on") and
        float(d.get("starter_demand") or 0) <= 0.001 and
        not d.get("starter_enabled") and not d.get("ab_sol_open") and
        float(d.get("ab_pump_demand") or 0) <= 0.001 and
        float(d.get("glow_plug_pct") or 0) <= 0.001 and
        float(d.get("wet_glow_fuel_pct") or 0) <= 0.001 and
        float(d.get("fuel_pump2_demand") or 0) <= 0.001 and
        not d.get("airstarter_open")
    )
    c.expect(telemetry_safe, "STANDBY telemetry reports every combustion/starter path safe")
    physical = []
    for key, signal, variable in (
        ("throttle", "THROTTLE_OUT", True),
        ("starter", "STARTER_OUT", True),
        ("fuel_sol", "FUEL_SOL", False),
        ("igniter", "IGNITER", False),
        ("starter_en", "STARTER_EN", False),
    ):
        actuator = actuators.get(key, {})
        if not actuator.get("enabled") or (key == "throttle" and fuel_shutoff_fitted):
            continue
        safe = (_variable_output_safe(state, signal, actuator) if variable else
                _relay_output_safe(state, signal, actuator))
        physical.append((key, safe))
        c.expect(safe, "STANDBY physical %s output is at configured safe demand" % key)
    c.info("safe-state tester snapshot=%r checked=%r" % (state, physical))


# ── input paths (tester -> DUT) ──────────────────────────────
def t_stop_switch(ctx, c):
    ctx.tester.set("STOP", 0)
    time.sleep(0.2)
    ctx.tester.set("STOP", 1)
    ok, d = ctx.dut.poll_until(lambda x: x.get("stop_switch_active") is True, timeout=2)
    c.expect(ok, "STOP pressed -> stop_switch_active True (got %s)" % d.get("stop_switch_active"))
    ctx.tester.set("STOP", 0)
    ok2, d2 = ctx.dut.poll_until(lambda x: x.get("stop_switch_active") is False, timeout=2)
    c.expect(ok2, "STOP released -> stop_switch_active False (got %s)" % d2.get("stop_switch_active"))


def t_n1_rpm(ctx, c):
    pm = ctx.pinmap
    samples = []
    # Start at the firmware's reliable low shaft-speed bench range. A 1-PPR
    # signal below roughly 60 Hz can legitimately fall through the N1
    # zero-stuck/health window during asynchronous bench sampling.
    for rpm in (4000, 5000, 9000):
        hz = pm.rpm_to_hz("N1", rpm)
        ctx.tester.set("N1", round(hz, 2))
        # Frequency changes can land on a partial PCNT integration window.
        # Wait for one settled sample within the same tolerance asserted below
        # instead of treating a nonzero transition sample as the final value.
        tolerance = max(650, 0.10 * rpm)
        deadline = time.time() + 1.6
        got = 0
        while time.time() < deadline:
            time.sleep(0.12)
            got = ctx.dut.data().get("n1", 0)
            if got and abs(got - rpm) <= tolerance:
                break
        samples.append((rpm, hz, got))
        c.info("N1 %d rpm (%.1f Hz) -> telemetry n1=%s" % (rpm, hz, got))
    ctx.tester.set("N1", 0)
    if all(g == 0 for _, _, g in samples):
        raise SkipTest("n1 stayed 0 — enable OT_HAS_N1_RPM on DUT GPIO %d and check ppr"
                       % pm.sig("N1")["dut_gpio"])
    c.expect(samples[0][2] < samples[-1][2], "n1 telemetry rises with stimulus")
    # The S3 PCNT integrates over ~100 ms, so at ppr=1 one pulse is ~600 rpm of
    # quantization — widen the tolerance accordingly at low rpm.
    near = all(abs(got - rpm) <= max(650, 0.10 * rpm) for rpm, _, got in samples)
    c.expect(near, "n1 within tolerance of commanded rpm (allowing PCNT quantization)")


def t_n2_rpm(ctx, c):
    """Exercise the optional second-shaft PCNT path when the bench profile fits it."""
    hw = ctx.dut.hardware()
    n2 = hw.get("sensors", {}).get("n2_rpm", {})
    pm = ctx.pinmap
    # `has_two_shaft` was removed from the hardware API when fitted-channel
    # capability became authoritative. The enabled N2 sensor is now the
    # prerequisite; retaining the obsolete flag silently skipped real N2 HIL.
    if not n2.get("enabled"):
        raise SkipTest("N2 is not enabled on the DUT")
    if n2.get("pin") != pm.sig("N2")["dut_gpio"]:
        raise SkipTest("N2 is configured on GPIO %s, bench wire is GPIO %d"
                       % (n2.get("pin"), pm.sig("N2")["dut_gpio"]))

    samples = []
    for rpm in (3000, 7000):
        ctx.tester.set("N2", pm.rpm_to_hz("N2", rpm))
        # A single read can land on the first partial PCNT window after a
        # stopped shaft begins producing pulses. Require an acquired sample
        # inside the same tolerance used below, while retaining a hard timeout
        # so a missing or intermittent signal still fails qualification.
        deadline = time.time() + 1.6
        got = 0
        tolerance = max(650, 0.10 * rpm)
        while time.time() < deadline:
            time.sleep(0.12)
            got = ctx.dut.data().get("n2", 0)
            if got and abs(got - rpm) <= tolerance:
                break
        samples.append((rpm, got))
        c.info("N2 %d rpm -> telemetry n2=%s" % (rpm, got))
    ctx.tester.set("N2", 0)
    c.expect(samples[0][1] > 0 and samples[0][1] < samples[1][1],
             "n2 telemetry rises with stimulus")
    c.expect(all(abs(got - rpm) <= max(650, 0.10 * rpm) for rpm, got in samples),
             "n2 within tolerance of commanded rpm (allowing PCNT quantization)")


def t_throttle_input(ctx, c):
    d0 = ctx.dut.data()
    t = d0.get("throttle_input_type")
    if t == "none":
        raise SkipTest("throttle input not enabled on DUT")
    if t == "servo":
        raise SkipTest("throttle input is RC-PWM on DUT; this analog test does not apply")
    pm = ctx.pinmap
    seq = []
    for volts in (0.0, 1.65, 3.3):
        ctx.tester.set("THROTTLE_IN", volts)
        time.sleep(0.4)
        raw = ctx.dut.data().get("throttle_input_raw", 0)
        seq.append((volts, raw))
        c.info("THROTTLE_IN %.2f V -> throttle_input_raw=%s (expect ~%d)"
               % (volts, raw, pm.volts_to_counts(volts)))
    ctx.tester.set("THROTTLE_IN", 0.0)
    c.expect(seq[0][1] < seq[-1][1], "throttle_input_raw rises 0 V -> 3.3 V")
    mid_exp = pm.volts_to_counts(1.65)
    c.expect(abs(seq[1][1] - mid_exp) <= 500, "mid-scale within +/-500 counts of %d" % mid_exp)


def t_oil_pressure_input(ctx, c):
    pm = ctx.pinmap
    ctx.tester.set("OILP", 0.3)      # true DAC — clean, no RC settling needed
    time.sleep(0.4)
    lo = ctx.dut.data().get("oil_raw", 0)
    ctx.tester.set("OILP", 2.5)
    time.sleep(0.4)
    hi = ctx.dut.data().get("oil_raw", 0)
    ctx.tester.set("OILP", 0.0)
    c.info("oil_raw: 0.3 V -> %s, 2.5 V -> %s (DAC on tester GPIO %d)"
           % (lo, hi, pm.sig("OILP")["tester_gpio"]))
    if lo == 0 and hi == 0:
        raise SkipTest("oil_raw stayed 0 — enable OT_HAS_OIL_PRESS on DUT GPIO %d"
                       % pm.sig("OILP")["dut_gpio"])
    c.expect(hi > lo, "oil_raw rises with driven DAC voltage")


def t_flame_input(ctx, c):
    ctx.tester.set("FLAME", 1)      # digital HIGH -> above threshold
    time.sleep(0.5)
    on = ctx.dut.data().get("flame")
    ctx.tester.set("FLAME", 0)      # digital LOW -> below threshold
    time.sleep(0.5)
    off = ctx.dut.data().get("flame")
    c.info("flame: driven HIGH -> %s, driven LOW -> %s" % (on, off))
    if on is None:
        raise SkipTest("no 'flame' telemetry — flame sensor not enabled on DUT")
    c.expect(on is True and off is False, "flame detect follows threshold crossing")


# ── output paths (DUT -> tester) ─────────────────────────────
def t_idle_input(ctx, c):
    input_type = ctx.dut.data().get("idle_input_type")
    if input_type == "none":
        raise SkipTest("idle input not enabled on DUT")
    if input_type != "servo":
        raise SkipTest("idle input is not RC-PWM on DUT; this pulse test does not apply")
    ctx.tester.set("IDLE_IN", 1000)
    time.sleep(0.5)
    lo = ctx.dut.data().get("idle_input_raw", 0)
    ctx.tester.set("IDLE_IN", 1900)
    time.sleep(0.5)
    hi = ctx.dut.data().get("idle_input_raw", 0)
    ctx.tester.set("IDLE_IN", 1000)
    c.info("IDLE_IN 1000 us -> %s, 1900 us -> %s" % (lo, hi))
    c.expect(hi > lo + 400, "idle RC input follows the commanded pulse width")


def t_igniter_output(ctx, c):
    _tool_output(ctx, c, "IGN_TEST", "IGNITER", "igniter_on")


def t_oilpump_output(ctx, c):
    _tool_output(ctx, c, "OIL_PRIME", "OILPUMP_OUT", "oil_pct", pwm=True)


def t_fuelsol_output(ctx, c):
    _tool_output(ctx, c, "FUEL_SOL_TEST", "FUEL_SOL", "fuel_sol_open")


def t_starter_en_output(ctx, c):
    _tool_output(ctx, c, "STARTER_EN_TEST", "STARTER_EN", "starter_enabled")


def t_throttle_output(ctx, c):
    """Verify the registry-mirrored throttle/ESC servo output when it is benched."""
    hw = ctx.dut.hardware()
    pm = ctx.pinmap
    expected_pin = pm.sig("THROTTLE_OUT")["dut_gpio"]
    throttle = hw.get("actuators", {}).get("throttle", {})
    main_fuel = next((x for x in hw.get("channel_registry", {}).get("outputs", [])
                      if x.get("id") == "main_fuel"), None)
    # The registry channel is the runtime authority when fitted, so require
    # both the legacy mirror and the registry to identify this exact bench pin.
    if not (throttle.get("enabled") and throttle.get("pin") == expected_pin and
            main_fuel and main_fuel.get("pin") == expected_pin and
            main_fuel.get("driver") == 6):
        raise SkipTest("throttle ESC is not configured as a servo on bench GPIO %d"
                       % expected_pin)

    ctx.tester.reset()
    ctx.dut.ensure_mode_standby()
    code, resp = ctx.dut.command("SET_THROTTLE_PCT", fParam=50.0)
    if code != 200:
        raise SkipTest("SET_THROTTLE_PCT rejected (HTTP %s): %s" %
                       (code, resp.get("error")))
    time.sleep(0.25)
    us, hz, duty, _level = ctx.tester.get_pwm("THROTTLE_OUT")
    ctx.tester.reset()
    ctx.dut.ensure_mode_standby()
    c.info("50%% throttle -> %sus %.1fHz duty=%.3f" % (us, hz, duty))
    min_us = float(throttle.get("min_us", 1000))
    max_us = float(throttle.get("max_us", 2000))
    expected_us = (min_us + max_us) / 2.0
    tolerance = max(40.0, abs(max_us - min_us) * 0.08)
    expected_hz = float(throttle.get("freq_hz", 50) or 50)
    c.expect(abs(us - expected_us) <= tolerance,
             "50%% throttle pulse follows configured endpoints (expect %.0f us)" % expected_us)
    c.expect(abs(hz - expected_hz) <= max(3.0, expected_hz * 0.1),
             "throttle servo frame follows configured frequency")
    ctx.dut.command("SET_THROTTLE_PCT", fParam=0.0)
    off, off_state = ctx.dut.poll_until(
        lambda d: float(d.get("throttle_effective") or 0) <= 0.001, timeout=2, interval=0.05
    )
    c.expect(off, "throttle commissioning command returns to zero demand")


# ── advanced (may move the engine state machine) ─────────────
def t_start_switch(ctx, c):
    ctx.dut.ensure_mode_standby()
    ctx.tester.set("START", 1)
    ok, d = ctx.dut.poll_until(lambda x: x.get("start_switch_active") is True, timeout=1.5)
    ctx.tester.set("START", 0)
    ctx.dut.stop()               # abort any start the edge may have triggered
    ctx.dut.ensure_mode_standby()
    c.expect(ok, "START pressed -> start_switch_active True (got %s)" % d.get("start_switch_active"))


def t_sequence_bench(ctx, c):
    """Run a bench-mode timed startup and confirm the oil pump and igniter
    actually fire on their sequence pins."""
    ctx.dut.ensure_mode_standby()
    dev = ctx.dut.ensure_dev_mode(True)
    bench = ctx.dut.ensure_bench_mode(True)
    c.info("dev_mode=%s bench_mode=%s" % (dev, bench))
    ctx.tester.reset()
    code, resp = ctx.dut.start()
    if code != 200:
        ctx.dut.ensure_bench_mode(False)
        ctx.dut.ensure_dev_mode(False)
        raise SkipTest("start rejected (HTTP %s): %s" % (code, resp.get("error")))
    saw_oil = False
    saw_ign = False
    saw_fuel = False
    saw_starter = False
    blocks = []
    reached_running = False
    actuators = ctx.dut.hardware().get("actuators", {})
    try:
        # Sample the tester pins fast (serial only, ~40 ms) so short action-block
        # windows aren't aliased past — the IgniterOn..IgniterOff window is only a
        # few hundred ms. Only reach for the slower DUT HTTP poll occasionally, to
        # track the block and notice when the sequence has settled (STARTUP -> a
        # steady mode). current_block reports the timed blocks; the 0 ms action
        # blocks (OilPumpOn/IgniterOn/...) execute instantly and aren't observable.
        deadline = time.time() + ctx.opts.get("seq_secs", 45)
        next_http = 0.0
        steady_since = None
        while time.time() < deadline:
            st = ctx.tester.state()
            if (actuators.get("oil_pump", {}).get("enabled") and
                    not _variable_output_safe(st, "OILPUMP_OUT", actuators["oil_pump"])):
                saw_oil = True
            if (actuators.get("igniter", {}).get("enabled") and
                    not _relay_output_safe(st, "IGNITER", actuators["igniter"])):
                saw_ign = True
            fuel_sol_active = (
                actuators.get("fuel_sol", {}).get("enabled") and
                not _relay_output_safe(st, "FUEL_SOL", actuators["fuel_sol"])
            )
            fuel_pump_active = (
                actuators.get("throttle", {}).get("enabled") and
                not _variable_output_safe(st, "THROTTLE_OUT", actuators["throttle"])
            )
            if fuel_sol_active or fuel_pump_active:
                saw_fuel = True
            starter_active = (
                actuators.get("starter", {}).get("enabled") and
                not _variable_output_safe(st, "STARTER_OUT", actuators["starter"])
            )
            starter_enable_active = (
                actuators.get("starter_en", {}).get("enabled") and
                not _relay_output_safe(st, "STARTER_EN", actuators["starter_en"])
            )
            if starter_active or starter_enable_active:
                saw_starter = True
            now = time.time()
            if now >= next_http:
                next_http = now + 0.3
                d = ctx.dut.data()
                blk = d.get("current_block")
                if blk and (not blocks or blocks[-1] != blk):
                    blocks.append(blk)
                mode = d.get("mode")
                reached_running = reached_running or mode == "RUNNING"
                # Startup finished when we leave STARTUP for a steady RUNNING (bench
                # mode never returns to STANDBY on its own) or back to STANDBY.
                if blocks and mode == "RUNNING":
                    if steady_since is None:
                        steady_since = now
                    elif saw_ign and now - steady_since > 1.0:
                        break
                else:
                    steady_since = None
            time.sleep(0.04)
    finally:
        ctx.dut.stop()
        ctx.dut.ensure_mode_standby()
        ctx.dut.ensure_bench_mode(False)
        ctx.dut.ensure_dev_mode(False)
    c.info("blocks: %s" % (" -> ".join(blocks) if blocks else "(none seen)"))
    c.expect(saw_oil, "oil pump driven during startup sequence")
    c.expect(saw_ign, "igniter fired during startup sequence")
    startup = ctx.dut.hardware().get("startup_seq", [])
    if any(block in startup for block in ("FuelOpen", "FuelPumpIdle")):
        c.expect(saw_fuel, "configured startup fuel action reached a physical fuel output")
    if any(block in startup for block in ("StarterSpin", "StarterRamp", "StarterOn")):
        c.expect(saw_starter, "configured starter block reached a physical starter output")
    c.expect(bool(blocks), "startup exposed sequencer progress")
    c.expect(reached_running, "bench startup completed into RUNNING rather than aborting")


BASIC = [
    t_handshake,
    t_safe_state,
    t_stop_switch,
    t_n1_rpm,
    t_throttle_input,
    t_oil_pressure_input,
    t_flame_input,
    t_idle_input,
    t_igniter_output,
    t_oilpump_output,
    t_fuelsol_output,
    t_starter_en_output,
]

ADVANCED = [
    t_start_switch,
    t_sequence_bench,
    t_n2_rpm,
    t_throttle_output,
]


def get_tests(advanced=False):
    return BASIC + (ADVANCED if advanced else [])
