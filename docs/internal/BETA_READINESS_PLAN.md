# OpenTurbine 2.0 release and beta-readiness plan

This checklist is the working plan for making the firmware and web UI coherent
enough for external beta testers. It focuses on user experience, supported
hardware combinations, dependency gates, and release-facing documentation.

## Goals

- A new user can set up a real engine without knowing hidden code assumptions.
- Every visible option is either usable or clearly disabled with a reason.
- Every supported hardware combination has a logical path through Hardware,
  Config, Calibration, Sequence, Dashboard, Log, and Tools.
- Unsupported or half-implemented features are hidden, rejected, or documented
  as not supported.
- `ecu_config.json` remains the single complete engine file.
- README and protocol docs match the current firmware and web UI.

## System Review Checklist

### 1. Supported Engine Setups

- Standard turbojet, single shaft, timer/TOT based, no N1 RPM sensor, no afterburner.
- Turbojet, single shaft, with N1 RPM feedback.
- Turbojet with afterburner.
- Twin-shaft turbojet with N2 monitoring only.
- Free-turbine / turboshaft with N2 governor.
- Turboprop with prop pitch governor.
- Bench/dry actuator setup with minimal sensors.
- No-start-switch setup using timed startup blocks.
- ADC throttle input and RC PWM throttle input.
- ADC idle input and RC PWM idle input.
- Main throttle/fuel ESC output as servo, LEDC PWM, or relay where supported.
- Oil pump as servo, LEDC PWM, or on/off relay where supported.
- Igniter relay/MOSFET mode and active coil mode with current sensing.
- Glow plug with and without current sensing.
- Thermocouple choices: MAX6675, MAX31855, MAX31856.
- Oil temperature choices: NTC, DS18B20, thermocouple.
- Shared-I²C choices: TCA9554 digital I/O, TLA2528 analog input, NAU7802 torque/thrust.
- Development-board, official-PCB-profile, and custom-PCB-profile installation paths.
- Separate main/scavenge oil-flow monitors and electric drain valve.
- AB trigger choices: manual, throttle threshold, switch, dedicated ADC/RC input.
- AB pump command choices: fixed, follows main throttle, dedicated AB input.
- Cluster serial TX-only and two-way RX.
- MAVLink TX-only.
- Open Wi-Fi AP and password-protected AP.

### 2. Dependency And Visibility Rules

- Hardware page releases pins owned by disabled sensors/actuators.
- Shared SPI bus pins are allowed; shared chip-select pins are blocked.
- ADC-only fields only offer valid ADC1 pins for the selected ESP32 platform.
- Output fields do not offer input-only, flash, or absent pins.
- Config fields hide or ghost when their required hardware is absent.
- RPM-only limits, dynamic idle, overspeed, surge, standby windmill oil, and
  auto-relight are optional N1-dependent features, not standard setup
  requirements.
- Calibration rows hide when their source sensor/input is absent.
- Dashboard cards show only fitted sources, and absent sources show no data
  rather than misleading zeroes.
- Sequence blocks and control-rule sensors/actuators hide or ghost unavailable
  hardware.
- Tools show only fitted actuator tests.
- Dev-mode-only functions are hidden until Dev Mode is active.
- Bench Mode is explicit and impossible to confuse with live safety.
- Safety and relight source selectors only allow configured sensors.
- Current-sensor settings only appear when the parent actuator and current
  mode require or enable them.

### 3. Critical User Flows

- First boot: user sees a clear Hardware -> Config -> Calibration -> Sequence
  path.
- Hardware save: changed fields are highlighted, conflicts are named, save
  recap is clear, reboot behavior is clear.
- Config save: units convert correctly, validation errors are actionable, and
  Essentials/Configured/Explore/Changed views are understandable.
- Unified import/export: full engine file restore rejects crossed hardware and
  settings sections.
- Factory reset: restores one complete factory engine file and makes the user
  review hardware before running.
- OTA firmware update and web-assets update both explain what is updated.
- Dashboard live data remains readable through reconnects and does not blank
  valid last-known cards during short telemetry gaps.
- Start/Stop buttons match actual mode, including STARTUP -> RUNNING.
- Sequence editor explains each block, supports editable timed delays, and
  keeps control rules under the Sequence page.
- Logs and session CSVs work without blocking the control loop or filling flash.

### 4. Documentation To Keep Current

- `README.md`: release-facing setup guide, minimum hardware, optional hardware,
  flashing, OTA, one-file engine config, and user workflows.
- `README.md`: the single authoritative user path, including first setup,
  calibration, dry testing, first fueled test, update, restore, and recovery.
- `docs/BETA_USER_GUIDE.md`: beta-only reporting appendix; it must not duplicate
  the normal user setup guide.
- `docs/README.md`: index for developer, integration, beta, and release material.
- `docs/OTC_CLUSTER_PROTOCOL.md`: cluster serial behavior and current command
  set.
- `examples/cluster/README.md`: practical cluster wiring and implementation path.
- `CHANGELOG.md`: user-visible changes since the last release.
- `DESIGN_SPEC.md`: architecture and behavior reference; keep current with
  firmware, but use README and web UI text as the primary setup guide.
- In-page help text and tooltips in `data_src/*.html`.

### 5. Verification

- JavaScript syntax check for every page.
- UI smoke test.
- UI config dependency audit.
- UI beta dependency audit.
- UI beta release audit.
- UI pre-hardware UX audit.
- UI cross-platform GPIO audit.
- UI PCB-profile audit.
- Deterministic mixed native/SPI/I²C configuration fuzz audit.
- `pio run -e esp32dev`.
- `pio run -e esp32s3dev`.
- `pio run -e esp32dev -t buildfs`.
- `pio run -e esp32s3dev -t buildfs`.

## Execution Order

1. Compare README/docs against current config and hardware schema.
2. Search for obsolete, unsupported, or misleading user-facing text.
3. Audit dependency gates across Hardware, Config, Calibration, Sequence,
   Dashboard, Log, and Tools.
4. Fix confirmed product bugs first; update audit scripts when they expose stale
   assumptions.
5. Update README and docs after behavior is stable.
6. Run `python tools/run_release_checks.py` and record any remaining physical
   hardware risks that software tests cannot close.

## 2.0.0 Release-Candidate Result — 2026-07-29

- `python tools/run_release_checks.py` passed all nine browser/UI audit
  programs, 85 safety source checks, 16 representative turbine matrices,
  I²C/load-cell audits, setup-package Python tests, setup-tool Go tests, both
  firmware builds, both LittleFS builds, and both linker/image budgets.
- Normal orientation (ESP32-S3 ECU, Classic ESP32 OTBench) passed the final
  ten-profile web/HIL run 10/10, physical safety fault injection 10/10, and
  session logging 2/2. Each campaign restored the saved engine file.
- Reversed orientation (Classic ESP32 ECU, ESP32-S3 OTBench) passed reachable
  pin functions 11/11, digital thermocouple/load-cell behavior 9/9, and
  overspeed/physical-STOP fuel isolation 2/2.
- Rejected Hardware JSON was confirmed to leave the active hardware profile
  byte-for-byte unchanged and keep the ECU in STANDBY.
- Remaining qualification boundaries are explicit: this bench does not contain
  a turbine, fuel system, ignition energy, loaded starter, oil circuit, or
  calibrated production sensors. It cannot replace guarded staged commissioning
  and an independent physical emergency-stop/fuel-isolation path.
