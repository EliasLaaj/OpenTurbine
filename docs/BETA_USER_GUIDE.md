# Beta tester appendix

The current v2 procedure is [`USER_GUIDE.md`](USER_GUIDE.md), with a concise
project gateway in the repository root [`README.md`](../README.md). A pre-2.0
installation must also follow [`V2_MIGRATION.md`](V2_MIGRATION.md).

This appendix contains only beta-specific reporting guidance.

## Before testing

- Use a sacrificial or safely recoverable ECU board.
- Record the firmware version, target (`esp32dev` or `esp32s3dev`), and installation method.
- Back up the full engine file.
- Follow the v2 User Guide pre-start review and repeat the relevant dry tests.
- Keep a known-good installer/package available for recovery.

## What to report

Open a GitHub issue with:

- Firmware/UI version
- ESP32 board and target
- Browser/device used
- Hardware that is physically fitted
- Hardware types and relevant GPIO assignments
- Engine mode and active sequence block
- Exact steps that reproduce the problem
- Expected and observed behavior
- Event Log and relevant Session Data
- Photos or a wiring diagram when the failure may be electrical
- Whether the same result occurs after reboot and with a clean browser session

Attach a sanitized engine file only when necessary. The full file contains the ECU Wi-Fi AP password; remove it before sharing.

## Severity

- **Critical:** fuel does not stop, an output activates unexpectedly, a safety gate is bypassed, configuration is corrupted, or an update can brick supported hardware.
- **High:** startup/shutdown sequence behaves incorrectly, a fitted safety cannot be enabled, telemetry gives a dangerously wrong value, or recovery requires reflashing.
- **Normal:** UI confusion, layout issue, incorrect help text, optional hardware problem, or logging/display defect.

For any critical control problem, stop fueled testing until the cause is understood and fixed.

Developer validation procedures live in [`docs/README.md`](README.md) and [`dev/bench/`](../dev/bench/).
