---
layout: document
title: "OpenTurbine troubleshooting: USB, flashing and Wi-Fi"
description: Diagnose OpenTurbine USB-driver, board-detection, flashing, Wi-Fi, dashboard, and update problems for supported ESP32 turbine ECU boards.
lede: Find the symptom first; do not treat a setup or wiring question as a software bug.
---

Keep fuel, ignition, starter power, and other hazardous loads isolated while diagnosing an OpenTurbine installation. Use a direct USB port and a known data-capable cable before changing drivers or firmware.

## Windows blocks the Setup Tool

Download only from the official [OpenTurbine Releases](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/releases) page. Windows can warn about a new or unsigned application. Confirm the release, its notes, and checksum before using the Windows-provided More info/Run anyway path. Do not disable Windows protection globally or use a copy from an unrelated site.

## CP210x driver installation fails

Disconnect and reconnect the intended board, then let the Setup Tool identify the connected CP210x bridge before installing a driver. Use a direct port, close serial monitors, and avoid installing a CP210x driver for an unrelated COM device. If Windows reports a specific installation error, restart only when Windows asks, then reconnect the board and rescan.

## CH340/WCH driver installation fails

The Setup Tool offers a WCH driver only for a matching connected WCH bridge. Check the data cable and direct USB connection first. Do not install a WCH driver merely because an unrelated serial device exists. After a successful driver install, reconnect or rescan as the tool instructs.

## Board does not appear as a COM port

Try a known data cable, another direct USB port, and no USB hub. Check whether the connected bridge has a missing driver; the tool should offer the matching CP210x or WCH driver. Remove power only if the board documentation permits it, then reconnect. An unrelated existing COM port does not prove the intended board has one.

## COM port exists but the ESP32 does not answer

Close PlatformIO, terminal programs, and any serial monitor using that port. Use the board's BOOT/RESET sequence: commonly hold BOOT, tap EN/RESET, start the connection, and release BOOT when the uploader begins. Follow the Setup Tool's device-specific boot-mode guidance instead of reinstalling a driver that is already working.

## Flashing fails

Keep the cable short and directly connected. Confirm the selected board is a supported Classic ESP32 or supported ESP32-S3 target. Retry with the BOOT/RESET procedure, no other application holding the COM port, and stable board power. A Clean install/reinstall erases the selected board; use it only when that is intended.

## OpenTurbine Wi-Fi is missing

Wait for a successful firmware boot, confirm stable ECU power, and look for the configured board network name. If the board was just installed or reset, reconnect after it finishes booting. If no network appears after a confirmed USB install, retry the installation with the correct target and inspect the diagnostic logs before reporting a problem.

## Dashboard does not open

Join the board Wi-Fi and browse directly to `http://192.168.4.1`. Mobile data, VPN, captive-portal behavior, and automatic network switching can send the browser elsewhere; temporarily disable them if needed. If Wi-Fi is visible but pages fail, reinstall or update the web assets without interrupting power.

## Update fails

Back up the full engine file before an update. Use **Update and keep my setup** for a working controller, and do not interrupt power while it runs. If the board cannot be reached over Wi-Fi, recover over USB. If a restore is rejected, use a complete matching engine file rather than partial configuration sections.

## Where diagnostic logs are stored

Setup Tool diagnostics are stored in `%LOCALAPPDATA%\OpenTurbine\SetupTool\logs`. Wi-Fi-update backups are normally stored under `Documents\OpenTurbine\Backups`. Remove Wi-Fi passwords, personal network details, and unreviewed engine configuration before attaching material to [Setup Help](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/issues/new?template=setup_help.yml).

## Before reporting a bug

Include the supported board target, connection method, fitted hardware, exact symptom, expected behavior, observed behavior, and sanitized logs. Use [Setup Help](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/issues/new?template=setup_help.yml) for installation, USB, driver, flashing, Wi-Fi, and dashboard questions. Use a bug report only for reproducible software behavior.
