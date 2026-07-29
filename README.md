<h1 align="center">OpenTurbine</h1>

<p align="center">OpenTurbine 2.0 — open-source ESP32 turbine ECU with guided Windows setup and a browser-based dashboard.</p>

<p align="center">
  <a href="https://github.com/elia179/OpenTurbine/releases/latest/download/OpenTurbineSetupTool.exe"><strong>Download for Windows</strong></a>
  &middot; <a href="https://elia179.github.io/OpenTurbine/get-started/">Get Started</a>
  &middot; <a href="https://elia179.github.io/OpenTurbine/hardware/">Hardware guide</a>
  &middot; <a href="docs/README.md">Developer documentation</a>
</p>

![OpenTurbine dashboard](site/assets/images/hero-dashboard.png)

## What is OpenTurbine?

OpenTurbine is experimental open-source turbine engine controller software for turbojets, APUs, generators, turboshafts, turboprops, and other small turbine systems. It runs on supported ESP32 boards and provides configurable startup and shutdown sequences, hardware-aware settings, simple control rules, fuel and oil control, monitoring, fault handling, calibration, logging, and a browser-based interface.

The normal Windows installation does not require Git, PlatformIO, or source-code compilation.

### Current interface highlights

- Installed-channel inventory for fitted sensors, switches, relays, PWM outputs, and servo/ESC outputs
- Automatic shared-I²C discovery for TCA9554 digital I/O, TLA2528 analog inputs, and NAU7802 torque/thrust load cells
- One shared SPI setup for MAX6675/MAX31855/MAX31856 thermocouple interfaces, plus native OneWire DS18B20 support
- Optional flash-time PCB profiles that replace raw GPIO setup with board-labelled, capability-filtered connections
- Per-pump oil-flow monitoring, electric drain-valve sequencing/rules, and calibrated torque/thrust measurement
- Simple and rate-predictive gradual fuel limiting for N1, N2, TOT/TIT, P1, P2, and torque, backed by independent hard trips
- Searchable grouped configuration with Essentials, Configured system, Explore all features, and Changed views
- Startup, shutdown, afterburner, and custom sequence blocks with final-state previews
- Simple threshold/hysteresis rules and direct input-to-variable-output mapping
- Guided calibration, standby-only actuator tests, complete engine-file backup/restore, event logs, and per-run session data

| Configuration | Control Rules |
| --- | --- |
| ![Searchable OpenTurbine configuration workspace](site/assets/images/config-page.png) | ![OpenTurbine Control Rules editor](site/assets/images/control-rules-page.png) |

## What you need

- A Windows computer and data-capable USB cable
- A supported ESP32 board
- A browser-capable phone or computer for the dashboard
- Suitable driver electronics, sensors, power protection, and fusing
- A verified independent physical fuel/power stop and restrained test equipment

## Start with a new board

1. Connect a supported ESP32 board using a USB data cable.
2. [Download OpenTurbine Setup Tool](https://github.com/elia179/OpenTurbine/releases/latest/download/OpenTurbineSetupTool.exe).
3. Choose **Clean install / reinstall** for a blank board, or **Update and keep my setup** for a working controller.
4. For a clean install, choose **Development board**, a compatible bundled **Official OpenTurbine PCB**, or a chip-matched **Custom PCB profile** supplied with the PCB design.
5. Follow the Setup Tool, then join the board Wi-Fi and open the address it shows (normally `http://192.168.4.1`).

If Windows warns about the Setup Tool, confirm the file came from the official [OpenTurbine Releases](https://github.com/elia179/OpenTurbine/releases) page, read the current release notes, and verify the published checksum before continuing.

## Supported targets

| Target | Status |
| --- | --- |
| Classic ESP32 with at least 4 MB flash | Supported |
| ESP32-S3 DevKitC-1-compatible board with at least 8 MB flash | Supported; the universal image runs on 8 MB and 16 MB modules without requiring PSRAM |
| Windows guided setup | Supported |
| macOS/Linux graphical installer | Not currently available |
| Manual source build | Advanced/developer path |
| Certified aviation use | Not certified |

> **Experimental engine-control software:** Verify all limits, outputs, shutdown paths, and sequences on a restrained test setup. Use an independent physical fuel/power stop. OpenTurbine does not make an engine safe or replace suitable drivers, fusing, sensors, or operating judgment.

## Before introducing fuel

Configure only the hardware you actually fitted, then verify inputs, limits, calibration, sequences, and individual outputs with fuel and ignition made safe. Run complete dry sequences and verify every stop path before planning a controlled fueled test.

## Documentation

- [Public landing site](https://elia179.github.io/OpenTurbine/)
- [Get started](https://elia179.github.io/OpenTurbine/get-started/)
- [Hardware guide](https://elia179.github.io/OpenTurbine/hardware/)
- [User guide](https://elia179.github.io/OpenTurbine/user-guide/) ([source document](docs/USER_GUIDE.md))
- [Moving from a pre-2.0 build](docs/V2_MIGRATION.md)
- [Troubleshooting](https://elia179.github.io/OpenTurbine/troubleshooting/)
- [Safety](https://elia179.github.io/OpenTurbine/safety/)
- [Developer documentation](docs/README.md)
- [PCB profile authoring](pcb_profiles/README.md)

## Help and status

Use [Setup Help](https://github.com/elia179/OpenTurbine/issues/new?template=setup_help.yml) for Windows, installation, USB, Wi-Fi, and dashboard issues. Use [Bug reports](https://github.com/elia179/OpenTurbine/issues/new?template=bug_report.yml) only for reproducible software behavior, and [Discussions](https://github.com/elia179/OpenTurbine/discussions) for hardware and wiring questions.

OpenTurbine is experimental, not a certified engine-control system. Contributions are welcome; read the developer documentation before building source. Released under the [MIT License](LICENSE).
