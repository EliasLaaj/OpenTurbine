# OpenTurbine Setup Tool

This document describes the OpenTurbine 2.0 package and setup workflow. A v2
release package must contain firmware and web assets built from the same commit
and must report version `2.0.2` during post-install verification.

The Windows setup tool provides two deliberately distinct paths: **Clean install
/ reinstall** erases a blank or previously used board over USB, while **Update
and keep my setup** updates an existing OpenTurbine board over Wi-Fi without a
factory reset. Users download only:

```text
OpenTurbineSetupTool.exe
```

The repository root [`README.md`](../README.md) is a short gateway; the detailed
user installation and operating guide is [`USER_GUIDE.md`](USER_GUIDE.md).
Focused browser and SmartScreen troubleshooting is
in [`WINDOWS_FLASHER_INSTALL.md`](WINDOWS_FLASHER_INSTALL.md). The rest of this
file is for setup-tool developers and release packagers.

The setup tool does not redistribute or silently install USB-serial drivers.
If Windows cannot see the board, it identifies the likely bridge family and
opens the official Silicon Labs or WCH download page. The user installs the
vendor package, reconnects the board, and retries detection. ESP32-S3 native USB
normally needs no separate driver.

On launch, the app looks for a local `OpenTurbine_Recommended.zip` next to the
EXE first. If it is not there, it downloads this release asset:

```text
https://github.com/elia179/OpenTurbine/releases/latest/download/OpenTurbine_Recommended.zip
```

Publish `OpenTurbine_Recommended.zip.sha256` beside it so the tool can verify
the download.

## Firmware Support

Current firmware exposes:

```http
GET /api/device_info
```

This endpoint reports the board target (`esp32dev` or `esp32s3dev`), chip name,
firmware version, current state, whether outputs are active, and whether OTA is
currently allowed. The setup tool uses it during Wi-Fi updates when a package
contains both ESP32 and ESP32-S3 firmware.

## Build The Recommended Package

Run the complete release gate first. It assembles split web sources, compresses
the web assets, runs browser/firmware/package tests, builds both targets and
LittleFS images, and checks memory/partition margins:

```bash
python tools/run_release_checks.py
```

The equivalent manual build steps begin with web-source assembly and then build
both firmware targets and their LittleFS images:

```bash
python tools/build_web_sources.py
python tools/gzip_data.py
pio run -e esp32dev
pio run -e esp32dev -t buildfs
pio run -e esp32s3dev
pio run -e esp32s3dev -t buildfs
```

Then create the release ZIP:

```bash
python tools/build_setup_package.py ^
  --esptool C:\path\to\esptool.exe
```

The script writes:

```text
dist/setup_tool/OpenTurbine_Recommended.zip
dist/setup_tool/OpenTurbine_Recommended.zip.sha256
```

## Release Checklist

Before packaging v2.0, also follow [`V2_MIGRATION.md`](V2_MIGRATION.md) and
verify a clean Development-board install, bundled official PCB profile install,
custom chip-matched profile install, and Wi-Fi update of an existing v2 ECU.

Attach these assets to the GitHub release:

```text
OpenTurbineSetupTool.exe
OpenTurbineSetupTool.exe.sha256
OpenTurbine_Recommended.zip
OpenTurbine_Recommended.zip.sha256
```

## Code Signing

Public Windows releases should be Authenticode-signed when a trusted signing
credential is available. An
unsigned or new low-reputation EXE can trigger Microsoft Defender SmartScreen,
browser download warnings, or Windows 11 Smart App Control. A signature does not
guarantee that Microsoft will immediately stop warning on a brand-new app, but it
gives Windows a verified publisher identity and lets reputation carry forward
across releases signed by the same publisher.

Use a production OV/EV code-signing certificate issued by a CA trusted by
Windows. For local signing from a PFX:

```powershell
$env:WINDOWS_SIGNING_CERT_PASSWORD = "pfx-password"
.\tools\sign_windows_setup_tool.ps1 `
  -ExePath .\dist\setup_tool\OpenTurbineSetupTool.exe `
  -CertificatePath C:\secure\OpenTurbineCodeSigning.pfx `
  -CertificatePassword $env:WINDOWS_SIGNING_CERT_PASSWORD
```

For a certificate already installed in the Windows certificate store, or on a
local hardware token exposed through the certificate store:

```powershell
.\tools\sign_windows_setup_tool.ps1 `
  -ExePath .\dist\setup_tool\OpenTurbineSetupTool.exe `
  -CertificateThumbprint "certificate-thumbprint"
```

Generate `OpenTurbineSetupTool.exe.sha256` only after signing:

```powershell
$hash = (Get-FileHash .\dist\setup_tool\OpenTurbineSetupTool.exe -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  OpenTurbineSetupTool.exe" | Set-Content -Encoding ascii .\dist\setup_tool\OpenTurbineSetupTool.exe.sha256
Get-AuthenticodeSignature .\dist\setup_tool\OpenTurbineSetupTool.exe
```

GitHub Actions can sign the setup tool automatically when these repository
secrets are configured:

```text
WINDOWS_SIGNING_CERT_BASE64   base64-encoded PFX file
WINDOWS_SIGNING_CERT_PASSWORD PFX password
```

The release workflow intentionally produces an unsigned executable when those
secrets are absent; the release notes must say so. It always publishes a SHA-256
sidecar. When signing is configured, it verifies the Authenticode signature and
generates the checksum only after signing. If your production certificate uses a cloud HSM,
Azure Trusted Signing, or a USB token that cannot be exported as a PFX, run that
provider's signing step before the checksum step and keep the same publish rule:
sign first, hash second.

References:

- Microsoft SmartScreen reputation for Windows app developers: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- Microsoft Smart App Control overview: https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview
- Microsoft SignTool reference: https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool

The ZIP must contain:

```text
manifest.json
LICENSE
THIRD_PARTY_NOTICES.md
SBOM.spdx.json
tools/esptool.exe
tools/esptool-LICENSE
esp32dev/bootloader.bin
esp32dev/partitions.bin
esp32dev/boot_app0.bin
esp32dev/firmware.bin
esp32dev/littlefs.bin
esp32dev/web_assets/*.gz
esp32s3dev/bootloader.bin
esp32s3dev/partitions.bin
esp32s3dev/boot_app0.bin
esp32s3dev/firmware.bin
esp32s3dev/littlefs.bin
esp32s3dev/web_assets/*.gz
```

The generated `manifest.json` must include `package_schema: 4`,
`setup_tool_version`, and `minimum_setup_tool_version`. The package schema
protects the flashing/layout contract. The minimum version makes Setup Tool
0.6.0 a stable client: later firmware and dashboard packages remain compatible
without requiring a new EXE unless they adopt a newer package format or feature
that the installed tool cannot handle. `setup_tool_version` records which tool
source built the package; it is informational for modern packages rather than
an exact-match requirement.

On each normal launch, the tool downloads and verifies the current
`releases/latest` package. If GitHub is temporarily unavailable, it can use a
previously verified cached package. A ZIP deliberately placed beside the EXE is
a local/offline override and therefore stays pinned until it is replaced or
removed.

Recommended driver sources:

- CP210x: [Silicon Labs CP210x USB to UART Bridge VCP Drivers](https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers?tab=downloads).
- CH340/CH341/CH343: [WCH CH341SER Windows USB serial driver](https://www.wch-ic.com/downloads/ch341ser_zip.html).

## Local Tryout

Before publishing a release, place a real `OpenTurbine_Recommended.zip` next to
`OpenTurbineSetupTool.exe` and double-click the EXE. The app will use the local
package first.

Setup and flash diagnostics are written under:

```text
%LOCALAPPDATA%\OpenTurbine\SetupTool\logs
```

For a remote test PC, `tools/setup_tool/collect_driver_diagnostics.ps1` can be
run manually to create a read-only diagnostics ZIP from PnPUtil, the serial-port
registry, and the tail of `%WINDIR%\INF\setupapi.dev.log`.

Use a blank or sacrificial board for the first USB install test. For Wi-Fi
updates, the tool backs up `ecu_config.json` into:

```text
Documents\OpenTurbine\Backups
```

Treat backups as private because they can contain the board Wi-Fi password.

The clean-PC USB driver hardware test checklist is
[`WINDOWS_USB_DRIVER_ACCEPTANCE.md`](WINDOWS_USB_DRIVER_ACCEPTANCE.md).
