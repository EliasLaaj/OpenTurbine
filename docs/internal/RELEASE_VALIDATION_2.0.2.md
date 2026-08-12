# OpenTurbine 2.0.2 release validation

Date: 2026-08-12
Targets: Classic ESP32 (`esp32dev`) and ESP32-S3 (`esp32s3dev`)

## Qualified scope

OpenTurbine 2.0.2 passed the canonical software release gate and a physical
two-board dry-bench campaign. The bench used OTBench stimuli and independent
output capture; it did not use fuel, ignition energy, a starter motor, or a
running turbine.

The only firmware-source change after the full behavioral HIL campaign was the
reported release version (`2.0.1` to `2.0.2`). The resulting 2.0.2 images were
then rebuilt through the complete release gate, flashed to both physical chips,
and checked for boot, filesystem/config/profile load, network/API availability,
safe state, and inactive outputs.

## Exact 2.0.2 hardware smoke images

| Target | Firmware SHA-256 | Runtime build ID | Result |
|---|---|---|---|
| Classic ESP32 | `350315dd387f51cdb2e12c1c1edad11956d0cfedc0914fa2a23683cb9bf0a615` | `e594bc86c89dbd27` | STANDBY, hardware ready, profile matched, no fault, outputs inactive |
| ESP32-S3 | `c933e97e2792c305421635c227606a32a0f2bdf0155b475b77caeeda0535f800` | `2e3c74405c8bd4f8` | STANDBY, hardware ready, profile matched, no fault, outputs inactive |

The final release workflow rebuilds from the signed/tagged commit. Its manifest
and published SHA-256 files are authoritative for distributed bytes; CI rejects
generated-asset drift, version mismatch, image-budget overflow, malformed flash
plans, and missing or inconsistent hashes before publishing.

## Canonical gate

`python tools/run_release_checks.py` passed on the 2.0.2 source:

- all 10 UI audit programs;
- Chromium, Firefox, and WebKit at desktop and narrow viewports;
- 24 mixed hardware profiles across all seven UI pages;
- 197 safety regression checks;
- 16 representative turbine configurations;
- native command queue, controller, I2C, sensor protocol, ADC-threshold, and
  piecewise-calibration behavior;
- 11 release-tool tests and 30 HIL harness/qualification-contract tests;
- Classic and S3 firmware plus LittleFS builds;
- enforced firmware, filesystem, DRAM, IRAM, and RTC memory budgets.

## Physical dry-bench coverage

The final behavioral campaign covered causal start/run/shutdown plant response,
safety trips and physical fuel/ignition cuts, controller interactions,
afterburner and reduced-power behavior, shutdown output ownership, live-safe
configuration, I2C device/loss handling, session logging, repeated reboot
recovery, rapid HTTP connections, real browser page navigation, warned live
edits with restoration, complete engine-file backup/restore, and full-size OTA.

Notable final measurements:

- 150 rapid connections and 210 real browser page loads per target without a
  connection failure in the final transport campaign;
- S3 causal plant run: 60 seconds, 199 samples, zero transport/status errors,
  maximum ECU loop execution 7.356 ms;
- session logging: valid 65-line CSV, zero dropped rows, maximum active loop
  execution 7.336 ms;
- full 1,594,736-byte S3 OTA: HTTP 200 in 9.88 seconds, followed by a clean
  reboot with configuration and PCB profile retained;
- complete engine-file browser round trip restored a canonically identical
  document and returned to safe STANDBY.

## Operating and residual limits

- Use one active operator browser tab. This is documented in the user guide and
  troubleshooting material.
- Hardware capability limits are enforced. Unusual but electrically possible
  turbine configurations remain available and use warnings where appropriate.
- Every installation still requires wiring inspection, dry output tests,
  calibration, independent shutdown verification, and a controlled first run.
- Bench simulation cannot qualify combustion, fuel hydraulics, vibration,
  engine-bay EMI, thermocouple installation accuracy, actuator mechanics, or a
  particular turbine's tuning.