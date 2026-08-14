# Windows installer troubleshooting

Normal download and installation instructions live in
[`USER_GUIDE.md`](USER_GUIDE.md). This page is retained as a focused
troubleshooting reference and should not be treated as a second installation
guide.

## Official download

[`OpenTurbineSetupTool.exe`](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/releases/latest/download/OpenTurbineSetupTool.exe)

Only bypass browser or SmartScreen warnings for a file downloaded from the official `elia179/OpenTurbine-ESP32-Gas-Turbine-ECU` release.

## Browser warning

Open the browser’s Downloads panel, inspect the source URL, and choose to keep
the file. If the stable link returns **Not Found**, the requested official
release asset has not been published; do not substitute an unrelated download.

## Windows SmartScreen

1. Open the downloaded file.
2. Choose **More info**.
3. Confirm the application is `OpenTurbineSetupTool.exe` from the official release.
4. Choose **Run anyway**.

The warning occurs because the current executable may be unsigned or may not yet
have Microsoft download reputation.

## Smart App Control

Windows 11 Smart App Control can block unsigned or untrusted apps without the
same **Run anyway** path. The release fix is an Authenticode-signed EXE
published from the official release page, not asking users to disable Windows
security globally.

## Optional advanced checksum verification

Normal users do not need this step, and the Setup Tool automatically verifies
the firmware package it downloads. A checksum is an additional manual check for
developers and advanced users who specifically want one.

When the release includes `OpenTurbineSetupTool.exe.sha256`, place it beside the executable and run:

```powershell
Get-FileHash .\OpenTurbineSetupTool.exe -Algorithm SHA256
Get-Content .\OpenTurbineSetupTool.exe.sha256
```

The hexadecimal hashes must match.

## Board is not detected

- Use a USB cable known to carry data.
- Try another direct USB port without a hub.
- Use the official CP210x or WCH driver page opened by the setup tool when it matches the USB serial chip on the board.
- Disconnect and reconnect the board after driver installation.
- Close serial monitors and other applications using the COM port.
- For boards requiring bootloader mode, hold **BOOT**, tap **EN/RESET**, begin installation, and release BOOT when connection starts.

Return to the detailed [`USER_GUIDE.md`](USER_GUIDE.md) after the installer detects the board.
