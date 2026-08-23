---
layout: document
title: "OpenTurbine FAQ: boards, installation and updates"
description: Answers about supported ESP32 boards, Windows installation, hardware channels, controllers, updates, backups, wiring, logs, and experimental-use limits for OpenTurbine.
lede: Quick answers for the normal Windows installation path.
---

## Do I need programming experience? Do I download the source ZIP?

No. Download `OpenTurbineSetupTool.exe` from the official release. Do not use GitHub’s **Download ZIP** source-code button for normal Windows setup.

## Which boards are supported?

Use a Classic ESP32 with at least 4 MB flash, or an ESP32-S3 DevKitC-1-compatible board with at least 8 MB flash. The same universal S3 image runs on 8 MB and 16 MB modules and does not require PSRAM. ESP32-C3 and other unlisted ESP32 families are not supported by the current normal setup path.

## Does driver installation require a restart?

Usually not. The Setup Tool rescans after installing a driver and shows when Windows specifically requires a restart. If the connected CP210x/WCH bridge has no COM port, it offers the matching driver even when an unrelated COM port exists.

## What does Clean install erase? How does Update keep my setup?

Clean install/reinstall erases the selected board. **Update and keep my setup** is the normal Wi-Fi update path for a working controller; it backs up the engine file first. Keep backups private because they can contain Wi-Fi credentials.

## Can I reuse a pre-2.0 engine file?

OpenTurbine 2.0 intentionally replaces older hardware and startup-safety
behavior. Keep the old file as a reference, but use a clean installation and
rebuild/review Hardware, Config, Calibration, Sequence, Rules, and every dry
shutdown test. Read the
[v2 migration guide](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/blob/main/docs/V2_MIGRATION.md)
before moving an engine installation.

## Can I explore without a turbine? Can GPIO power a pump or igniter?

You can explore and configure the dashboard with loads physically disconnected. GPIO pins are 3.3 V logic only: they do not power pumps, valves, starters, or ignition. Use suitable protected driver electronics.

## Can I add a sensor or output that is not one of the built-in names?

Yes. Add it to the **Hardware** Installed Channel Inventory with a unique stable ID, the correct input/output driver, pin, range, and safe states. Registry-backed analog, pulse, digital, relay, PWM, and servo/ESC channels can be referenced by supported controllers, sequence actions, Tools, and telemetry. The electrical interface still needs suitable conditioning or a rated driver.

## What can simple controls do?

Simple controls live with the other output owners on **Controllers**. A control can switch an output at a sensor threshold with hysteresis or map an input range directly to a variable PWM/servo output range. Each output has one normal owner; Sequence owns ordered startup/shutdown actions and safety can always override normal demand.

## Why does Windows warn about the Setup Tool?

Use the official OpenTurbine download link and choose **More info → Run anyway** when Windows offers it. Do not disable Windows security or use an installer from another website. Normal installation does not require understanding checksums; the Setup Tool automatically verifies the firmware package it downloads.

## Where are logs and complete instructions?

Setup Tool diagnostics are under `%LOCALAPPDATA%\OpenTurbine\SetupTool\logs`. The [complete user guide](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/blob/main/docs/USER_GUIDE.md) covers operating and wiring details. Use [Setup Help](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/issues/new?template=setup_help.yml) for installation problems.

## Is OpenTurbine certified or inherently safe? Does it work on macOS/Linux?

No. It is experimental and requires independently verified limits, drivers, and physical shutdown protection. There is no graphical macOS/Linux installer; manual PlatformIO builds are an advanced/developer path.
