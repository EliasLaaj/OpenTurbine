# OpenTurbine Setup Tool

Windows setup/update helper for OpenTurbine boards.

The home screen separates **Clean install / reinstall** (USB, erases the entire
selected board) from **Update and keep my setup** (Wi-Fi, backs up and retains
the existing engine setup). Do not weaken this distinction in release builds.

Driver installation is INF-only. The recommended ZIP must bundle complete,
unmodified, vendor-signed CP210x and WCH INF/CAT/SYS driver packages. The GUI
detects the connected USB bridge hardware ID, elevates only a small helper, runs
`pnputil`, scans for devices, and writes a diagnostic log.

Build from this directory:

```powershell
go test ./...
go run github.com/akavel/rsrc@v0.10.2 -ico OpenTurbineSetupTool.ico -manifest OpenTurbineSetupTool.manifest -o rsrc_windows_amd64.syso
go build -ldflags="-H windowsgui -s -w" -o OpenTurbineSetupTool.exe .
```

`rsrc_windows_amd64.syso` embeds the tracked `.ico` and manifest. Regenerate it
after changing either source file; CI also regenerates it before release builds.

For public releases, sign `OpenTurbineSetupTool.exe` before hashing or
publishing it. See `docs/SETUP_TOOL.md` for the Authenticode signing workflow
and GitHub Actions secrets.

The app downloads `OpenTurbine_Recommended.zip` from the latest GitHub release,
or uses a local `OpenTurbine_Recommended.zip` placed next to the EXE.

Build the recommended ZIP from the repository root:

```powershell
python tools/build_setup_package.py `
  --esptool "$env:USERPROFILE\.platformio\penv\Scripts\esptool.exe" `
  --cp210x-driver C:\path\to\extracted\CP210x_Windows_Drivers `
  --ch340-driver C:\path\to\extracted\wch-serial-drivers
```

Release packages require both complete driver packages. Keep each full extracted
vendor folder; a copied installer EXE is rejected. CP210x payloads are packaged
under `drivers/cp210x/`; WCH CH340/CH341/CH343 payloads are packaged under
`drivers/wch/`. The generated manifest includes `package_schema: 3` so the EXE
and ZIP must come from the same release family.

For local packaging validation only, `--allow-missing-drivers` may be used. Do
not publish that development package as the recommended release.

Release assets:

```text
OpenTurbineSetupTool.exe
OpenTurbineSetupTool.exe.sha256
OpenTurbine_Recommended.zip
OpenTurbine_Recommended.zip.sha256
```
