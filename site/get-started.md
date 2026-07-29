---
layout: document
title: Install OpenTurbine from Windows
description: Install OpenTurbine on a supported ESP32 using the Windows Setup Tool, then connect to its Wi-Fi dashboard.
lede: The normal installation does not require Git, PlatformIO or source-code compilation.
---

{% include safety-note.html %}

## 1. Prepare the board

You need:

- A Classic ESP32 board with at least 4 MB flash, or an ESP32-S3 DevKitC-1-compatible board with at least 8 MB flash. The universal S3 image runs on 8 MB and 16 MB modules and does not require PSRAM.
- A Windows computer.
- A USB **data cable**. A charge-only cable can power the board but cannot install firmware.

Keep fuel, ignition energy, starter power and actuator/load power physically disconnected during installation.

## 2. Download the Setup Tool

[Download `OpenTurbineSetupTool.exe` for Windows]({{ site.data.project.windows_download_url }}).

Use the executable above, not GitHub's **Download ZIP** source-code button. If Windows displays a warning, confirm that the file came from the official [OpenTurbine Releases]({{ site.data.project.releases_url }}) page before using **More info → Run anyway**. Do not disable Windows protection globally.

<p class="expected"><strong>Expected:</strong> Windows opens the OpenTurbine Setup Tool.</p>

## 3. Connect and identify the board

Connect the ESP32 directly to the computer and open the Setup Tool. It will show a detected board or identify a missing CP210x/WCH USB driver.

If a driver is required, use the matching option offered by the Setup Tool. If Windows already shows a COM port but the board does not answer, close other serial programs, hold **BOOT**, tap **EN/RESET**, and try again.

<p class="expected"><strong>Expected:</strong> the Setup Tool shows the connected board and a usable COM port.</p>

<p class="inline-help">No board or COM port? <a href="{{ '/troubleshooting/#board-does-not-appear-as-a-com-port' | relative_url }}">Use the board-detection troubleshooting steps.</a></p>

## 4. Choose install or update

- For a new board, select **Clean install / reinstall**. This erases the selected board.
- For a working OpenTurbine ECU, select **Update and keep my setup**. Back up the engine file first; this path is designed to preserve the setup.

Check the selected board and operation before starting. Do not disconnect USB power while the Setup Tool is writing firmware.

<p class="expected"><strong>Expected:</strong> installation completes without an error and the board restarts.</p>

<p class="inline-help">Installation stopped or failed? <a href="{{ '/troubleshooting/#flashing-fails' | relative_url }}">Go directly to flashing help.</a></p>

## 5. Open the dashboard

Join the Wi-Fi network created by the board, remain connected even if Windows says the network has no internet, and open [`http://192.168.4.1`](http://192.168.4.1) in a browser.

<p class="expected"><strong>Expected:</strong> the OpenTurbine dashboard loads and shows the ECU state.</p>

<p class="inline-help">Wi-Fi missing or dashboard not loading? See <a href="{{ '/troubleshooting/#openturbine-wi-fi-is-missing' | relative_url }}">Wi-Fi help</a> or <a href="{{ '/troubleshooting/#dashboard-does-not-open' | relative_url }}">dashboard help</a>.</p>

## 6. Continue with your own hardware

OpenTurbine does not require one fixed engine layout. Describe only the sensors and actuators your system actually has, then configure and test them in this order:

**Hardware → Config → Calibration → Sequence and Control Rules → Tools → Dashboard**

The [complete User Guide]({{ '/user-guide/' | relative_url }}) explains every stage, including sensor wiring, actuator drivers, available inputs and outputs, controller behavior, safety functions and Config fields.

Do not connect fuel or ignition energy until the independent stop and every configured shutdown path have been dry-tested.

<p class="document-nav"><a href="{{ '/user-guide/' | relative_url }}">Open the User Guide</a><a href="{{ '/hardware/' | relative_url }}">Hardware requirements</a><a href="{{ '/troubleshooting/' | relative_url }}">Troubleshooting</a></p>
