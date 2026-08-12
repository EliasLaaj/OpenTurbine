# OpenTurbine Setup Tool

Windows setup/update helper for OpenTurbine boards.

The home screen separates **Clean install / reinstall** (USB, erases the entire
selected board) from **Update and keep my setup** (Wi-Fi, backs up and retains
the existing engine setup). Do not weaken this distinction in release builds.

The tool does not redistribute or silently install serial drivers. If Windows
cannot see a board, the GUI identifies the likely USB bridge and opens the
official Silicon Labs or WCH download page for the user.

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
  --esptool "$env:USERPROFILE\.platformio\penv\Scripts\esptool.exe"
```

The generated manifest includes `package_schema: 4`; the EXE and ZIP must come
from the same release family. The ZIP also includes OpenTurbine's license and
the bundled esptool third-party notice.

Release assets:

```text
OpenTurbineSetupTool.exe
OpenTurbineSetupTool.exe.sha256
OpenTurbine_Recommended.zip
OpenTurbine_Recommended.zip.sha256
```
