//go:build windows

package main

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	appVersion                  = "0.6.1"
	packageCompatibilityVersion = "0.6.0"
	requiredPackageSchema       = 3
	appTitle                    = "OpenTurbine Setup Tool"
	ecuBaseURL                  = "http://192.168.4.1"
	defaultPackageURL           = "https://github.com/elia179/OpenTurbine/releases/latest/download/OpenTurbine_Recommended.zip"
	cleanSafetyButtonLabel      = "I understand — choose board"
	updateSafetyButtonLabel     = "My engine is safe — continue update"
)

var (
	colBg         = rgb(17, 21, 24)
	colHeader     = rgb(23, 28, 33)
	colPanel      = rgb(30, 37, 43)
	colPanelSoft  = rgb(37, 45, 52)
	colBorder     = rgb(61, 75, 90)
	colBorderSoft = rgb(44, 54, 64)
	colText       = rgb(231, 239, 245)
	colTextMuted  = rgb(170, 185, 199)
	colTextSoft   = rgb(131, 149, 169)
	colAccent     = rgb(238, 118, 32)
	colAccent2    = rgb(245, 158, 11)
	colAccentDark = rgb(124, 63, 24)
	colInfoBg     = rgb(32, 40, 58)
	colInfoBorder = rgb(54, 82, 124)
	colInfoText   = rgb(215, 229, 255)
	colTitleBar   = rgb(58, 62, 66)
)

var webAssets = []string{
	"app.js.gz",
	"calibration.html.gz",
	"config.html.gz",
	"hardware.html.gz",
	"index.html.gz",
	"log.html.gz",
	"sequence.html.gz",
	"style.css.gz",
	"tools.html.gz",
	"theme.js.gz",
	"ui_dialog.js.gz",
}

type AppConfig struct {
	PackageURL string `json:"package_url"`
}

type Manifest struct {
	Project                 string                    `json:"project"`
	Version                 string                    `json:"version"`
	Recommended             bool                      `json:"recommended"`
	PackageSchema           int                       `json:"package_schema"`
	SetupToolVersion        string                    `json:"setup_tool_version"`
	MinimumSetupToolVersion string                    `json:"minimum_setup_tool_version"`
	Targets                 map[string]ManifestTarget `json:"targets"`
	FirmwareOTA             string                    `json:"firmware_ota"`
	WebAssets               string                    `json:"web_assets"`
}

type ManifestTarget struct {
	Chip        string              `json:"chip"`
	USBFlash    []FlashEntry        `json:"usb_flash"`
	FirmwareOTA string              `json:"firmware_ota"`
	WebAssets   string              `json:"web_assets"`
	PCBProfile  PCBProfilePartition `json:"pcb_profile"`
}

type PCBProfilePartition struct {
	Address          string               `json:"address"`
	Size             int                  `json:"size"`
	OfficialProfiles []ManifestPCBProfile `json:"official_profiles"`
}

type ManifestPCBProfile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Revision string `json:"revision"`
	File     string `json:"file"`
	SHA256   string `json:"sha256"`
}

type FlashEntry struct {
	Address string `json:"address"`
	File    string `json:"file"`
	SHA256  string `json:"sha256,omitempty"`
}

type sourcePCBProfile struct {
	Format        string `json:"format"`
	FormatVersion struct {
		Major int `json:"major"`
		Minor int `json:"minor"`
	} `json:"format_version"`
	Board struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Revision string `json:"revision"`
	} `json:"board"`
	Target struct {
		Chip string `json:"chip"`
	} `json:"target"`
	Buses []struct {
		ID   string         `json:"id"`
		Kind string         `json:"kind"`
		Pins map[string]int `json:"pins"`
	} `json:"buses"`
	Devices []struct {
		ID      string `json:"id"`
		Driver  string `json:"driver"`
		Bus     string `json:"bus"`
		Address *int   `json:"address"`
		Select  struct {
			GPIO *int `json:"gpio"`
		} `json:"select"`
	} `json:"devices"`
	FixedFunctions struct {
		StatusLED *struct {
			GPIO       int      `json:"gpio"`
			ActiveHigh *bool    `json:"active_high"`
			Type       string   `json:"type"`
			SafeDemand *float64 `json:"safe_demand"`
		} `json:"status_led"`
		Buzzer *struct {
			GPIO       int      `json:"gpio"`
			ActiveHigh *bool    `json:"active_high"`
			SafeDemand *float64 `json:"safe_demand"`
		} `json:"buzzer"`
		ServoOutputEnable *struct {
			GPIO       int      `json:"gpio"`
			ActiveHigh *bool    `json:"active_high"`
			SafeDemand *float64 `json:"safe_demand"`
		} `json:"servo_output_enable"`
		SupplyVoltage *struct {
			GPIO        int     `json:"gpio"`
			Divider     float64 `json:"divider"`
			ReferenceMV float64 `json:"reference_mv"`
		} `json:"supply_voltage"`
		ClusterSerial *struct {
			Bus string `json:"bus"`
		} `json:"cluster_serial"`
		MAVLink *struct {
			Bus string `json:"bus"`
		} `json:"mavlink"`
	} `json:"fixed_functions"`
	Ports []struct {
		ID    string `json:"id"`
		Label string `json:"label"`
		Modes []struct {
			ID          string   `json:"id"`
			Adapter     string   `json:"adapter"`
			Device      string   `json:"device"`
			Channel     int      `json:"channel"`
			ActiveHigh  *bool    `json:"active_high"`
			Pull        string   `json:"pull"`
			SafeDemand  *float64 `json:"safe_demand"`
			ReferenceMV float64  `json:"reference_mv"`
			Endpoint    struct {
				GPIO *int `json:"gpio"`
			} `json:"endpoint"`
		} `json:"modes"`
	} `json:"ports"`
}

type pcbTargetCatalog struct {
	Chip          string `json:"chip"`
	GPIO          []int  `json:"gpio"`
	InputOnlyGPIO []int  `json:"input_only_gpio"`
	StrappingGPIO []int  `json:"strapping_gpio"`
}

type Package struct {
	Root      string
	Manifest  Manifest
	Temporary bool
}

func (p *Package) cleanup() {
	if p != nil && p.Temporary && p.Root != "" {
		_ = os.RemoveAll(p.Root)
		p.Root = ""
	}
}

type driverInstallResult struct {
	Kind             driverKind `json:"kind"`
	DriverRoot       string     `json:"driver_root"`
	INFPaths         []string   `json:"inf_paths"`
	DeviceInstanceID string     `json:"device_instance_id,omitempty"`
	HardwareIDs      []string   `json:"hardware_ids,omitempty"`
	ExitCode         int        `json:"exit_code"`
	Output           string     `json:"output"`
	Error            string     `json:"error,omitempty"`
	RebootRequired   bool       `json:"reboot_required,omitempty"`
	COMPort          string     `json:"com_port,omitempty"`
	LogPath          string     `json:"log_path,omitempty"`
	ScanExitCode     int        `json:"scan_exit_code,omitempty"`
	ScanOutput       string     `json:"scan_output,omitempty"`
}

type driverChoice struct {
	Kind  driverKind
	Label string
}

type pcbProfileChoice struct {
	Label   string
	Detail  string
	Action  string
	Enabled bool
}

type detectedBoard struct {
	Port, Target, Chip string
}

type App struct {
	workDir      string
	config       AppConfig
	packageMu    sync.Mutex
	packageReady *Package
}

type Job struct {
	app        *App
	mode       string
	continueCh chan struct{}
	actionCh   chan string
	backupPath string
	logs       []string
	mu         sync.Mutex
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--install-inf-driver" {
		os.Exit(runINFDriverInstallHelper(os.Args[2:]))
	}
	runtime.LockOSThread()
	setProcessDPIAware()
	app := newApp()
	defer func() {
		app.packageMu.Lock()
		defer app.packageMu.Unlock()
		app.packageReady.cleanup()
	}()
	runGUI(app)
}

func newApp() *App {
	dir := setupToolDataDir()
	_ = os.MkdirAll(dir, 0755)
	cfg := AppConfig{PackageURL: defaultPackageURL}
	exe, _ := os.Executable()
	if exe != "" {
		p := filepath.Join(filepath.Dir(exe), "openturbine_setup_tool.json")
		if data, err := os.ReadFile(p); err == nil {
			_ = json.Unmarshal(data, &cfg)
		}
	}
	return &App{workDir: dir, config: cfg}
}

// ---------------- Native modern Win32 UI ----------------

var (
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	user32   = syscall.NewLazyDLL("user32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	comdlg32 = syscall.NewLazyDLL("comdlg32.dll")
	dwmapi   = syscall.NewLazyDLL("dwmapi.dll")

	procGetModuleHandleW   = kernel32.NewProc("GetModuleHandleW")
	procGetCurrentThreadId = kernel32.NewProc("GetCurrentThreadId")
	procRegisterClassExW   = user32.NewProc("RegisterClassExW")
	procCreateWindowExW    = user32.NewProc("CreateWindowExW")
	procDefWindowProcW     = user32.NewProc("DefWindowProcW")
	procShowWindow         = user32.NewProc("ShowWindow")
	procUpdateWindow       = user32.NewProc("UpdateWindow")
	procGetMessageW        = user32.NewProc("GetMessageW")
	procTranslateMessage   = user32.NewProc("TranslateMessage")
	procDispatchMessageW   = user32.NewProc("DispatchMessageW")
	procPostQuitMessage    = user32.NewProc("PostQuitMessage")
	procPostMessageW       = user32.NewProc("PostMessageW")
	procGetClientRect      = user32.NewProc("GetClientRect")
	procInvalidateRect     = user32.NewProc("InvalidateRect")
	procLoadIconW          = user32.NewProc("LoadIconW")
	procLoadImageW         = user32.NewProc("LoadImageW")
	procBeginPaint         = user32.NewProc("BeginPaint")
	procEndPaint           = user32.NewProc("EndPaint")
	procSetWindowTextW     = user32.NewProc("SetWindowTextW")
	procSetProcessDPIAware = user32.NewProc("SetProcessDPIAware")
	procSetDPIContext      = user32.NewProc("SetProcessDpiAwarenessContext")
	procLoadCursorW        = user32.NewProc("LoadCursorW")
	procOpenClipboard      = user32.NewProc("OpenClipboard")
	procEmptyClipboard     = user32.NewProc("EmptyClipboard")
	procCloseClipboard     = user32.NewProc("CloseClipboard")
	procSetClipboardData   = user32.NewProc("SetClipboardData")
	procGlobalAlloc        = kernel32.NewProc("GlobalAlloc")
	procGlobalLock         = kernel32.NewProc("GlobalLock")
	procGlobalUnlock       = kernel32.NewProc("GlobalUnlock")

	procCreateFontW            = gdi32.NewProc("CreateFontW")
	procCreateSolidBrush       = gdi32.NewProc("CreateSolidBrush")
	procCreatePen              = gdi32.NewProc("CreatePen")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procFillRect               = user32.NewProc("FillRect")
	procRoundRect              = gdi32.NewProc("RoundRect")
	procRectangle              = gdi32.NewProc("Rectangle")
	procDrawTextW              = user32.NewProc("DrawTextW")
	procSetTextColor           = gdi32.NewProc("SetTextColor")
	procSetBkMode              = gdi32.NewProc("SetBkMode")
	procMoveToEx               = gdi32.NewProc("MoveToEx")
	procLineTo                 = gdi32.NewProc("LineTo")
	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
	procBitBlt                 = gdi32.NewProc("BitBlt")
	procSaveDC                 = gdi32.NewProc("SaveDC")
	procRestoreDC              = gdi32.NewProc("RestoreDC")
	procIntersectClipRect      = gdi32.NewProc("IntersectClipRect")

	procShellExecuteW         = shell32.NewProc("ShellExecuteW")
	procGetOpenFileNameW      = comdlg32.NewProc("GetOpenFileNameW")
	procDwmSetWindowAttribute = dwmapi.NewProc("DwmSetWindowAttribute")
)

const (
	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	createNoWindow     = 0x08000000
	imageIcon          = 1
	lrDefaultSize      = 0x00000040

	wmCreate        = 0x0001
	wmDestroy       = 0x0002
	wmSize          = 0x0005
	wmGetMinMaxInfo = 0x0024
	wmPaint         = 0x000F
	wmEraseBkgnd    = 0x0014
	wmLButtonDown   = 0x0201
	wmMouseWheel    = 0x020A
	wmMouseMove     = 0x0200
	wmSetCursor     = 0x0020
	wmUser          = 0x0400
	wmAppUpdate     = wmUser + 10
	wmAppInvalidate = wmUser + 11

	swShowDefault = 10

	cfUnicodeText = 13
	gmemMoveable  = 0x0002

	dtLeft       = 0x00000000
	dtCenter     = 0x00000001
	dtRight      = 0x00000002
	dtVCenter    = 0x00000004
	dtWordBreak  = 0x00000010
	dtSingleLine = 0x00000020
	dtNoPrefix   = 0x00000800

	transparent = 1
	psSolid     = 0
	srcCopy     = 0x00CC0020

	cursorArrow = 32512
	cursorHand  = 32649
)

type rect struct{ left, top, right, bottom int32 }
type point struct{ x, y int32 }
type minMaxInfo struct {
	reserved, maxSize, maxPosition, minTrackSize, maxTrackSize point
}
type msg struct {
	hwnd           uintptr
	message        uint32
	wParam, lParam uintptr
	time           uint32
	pt             point
}
type paintStruct struct {
	hdc         uintptr
	fErase      int32
	rcPaint     rect
	fRestore    int32
	fIncUpdate  int32
	rgbReserved [32]byte
}
type wndClassEx struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type openFileName struct {
	structSize       uint32
	owner            uintptr
	instance         uintptr
	filter           *uint16
	customFilter     *uint16
	maxCustomFilter  uint32
	filterIndex      uint32
	file             *uint16
	maxFile          uint32
	fileTitle        *uint16
	maxFileTitle     uint32
	initialDir       *uint16
	title            *uint16
	flags            uint32
	fileOffset       uint16
	fileExtension    uint16
	defaultExtension *uint16
	customData       uintptr
	hook             uintptr
	templateName     *uint16
}

type screenKind int

const (
	screenHome screenKind = iota
	screenSafety
	screenRunning
	screenWait
	screenDone
	screenError
	screenDriverHelp
	screenBoardChoice
	screenPCBProfileChoice
)

type clickZone struct {
	r      rect
	action string
}

type NativeUI struct {
	app         *App
	hwnd        uintptr
	uiThreadID  uint32
	fontTitle   uintptr
	fontHeading uintptr
	fontBody    uintptr
	fontSmall   uintptr
	fontButton  uintptr

	mu            sync.Mutex
	screen        screenKind
	title         string
	subtitle      string
	body          string
	detail        string
	mode          string
	step          int
	totalSteps    int
	progress      int
	primary       string
	secondary     string
	pendingMode   string
	backupPath    string
	logs          []string
	showDetails   bool
	scrollOffset  int
	activeJob     *Job
	zones         []clickZone
	boards        []detectedBoard
	pcbChoices    []pcbProfileChoice
	driverChoices []driverChoice

	pending *uiUpdate
}

type uiUpdate struct {
	screen        screenKind
	title         string
	subtitle      string
	body          string
	detail        string
	step          int
	totalSteps    int
	progress      int
	primary       string
	secondary     string
	backupPath    string
	done          bool
	mode          string
	appendLog     []string
	boards        []detectedBoard
	pcbChoices    []pcbProfileChoice
	driverChoices []driverChoice
}

var globalUI *NativeUI

func runGUI(app *App) {
	ui := &NativeUI{app: app}
	globalUI = ui
	threadID, _, _ := procGetCurrentThreadId.Call()
	ui.uiThreadID = uint32(threadID)
	hInst, _, _ := procGetModuleHandleW.Call(0)
	arrow, _, _ := procLoadCursorW.Call(0, cursorArrow)
	appIcon := loadAppIcon(hInst)
	className := utf16Ptr("OpenTurbineSetupToolModernWindow")
	wc := wndClassEx{
		cbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		lpfnWndProc:   syscall.NewCallback(wndProc),
		hInstance:     hInst,
		hIcon:         appIcon,
		hIconSm:       appIcon,
		hCursor:       arrow,
		hbrBackground: 0,
		lpszClassName: className,
	}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16Ptr(appTitle))),
		wsOverlappedWindow|wsVisible,
		0x80000000, 0x80000000, 900, 740,
		0, 0, hInst, 0,
	)
	ui.hwnd = hwnd
	setTitleBarColors(hwnd)
	procShowWindow.Call(hwnd, swShowDefault)
	procUpdateWindow.Call(hwnd)
	var m msg
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func wndProc(hwnd uintptr, msgID uint32, wParam, lParam uintptr) uintptr {
	ui := globalUI
	switch msgID {
	case wmCreate:
		ui.hwnd = hwnd
		ui.createResources()
		ui.showPreparing()
		go ui.prepareThenShowHome()
		return 0
	case wmPaint:
		ui.paint()
		return 0
	case wmEraseBkgnd:
		// The complete frame is copied from an off-screen buffer in wmPaint.
		return 1
	case wmSize:
		ui.invalidate()
		return 0
	case wmGetMinMaxInfo:
		mmi := (*minMaxInfo)(unsafe.Pointer(lParam))
		// Safety and destructive-action screens carry essential text above the
		// buttons. Do not allow resizing until that text is clipped away.
		mmi.minTrackSize = point{x: 680, y: 680}
		return 0
	case wmMouseWheel:
		if ui != nil {
			delta := int(int16((wParam >> 16) & 0xffff))
			ui.scroll(delta)
		}
		return 0
	case wmLButtonDown:
		x := int(int16(lParam & 0xffff))
		y := int(int16((lParam >> 16) & 0xffff))
		ui.click(x, y)
		return 0
	case wmSetCursor:
		// Leave the cursor simple and predictable.
		arrow, _, _ := procLoadCursorW.Call(0, cursorArrow)
		user32.NewProc("SetCursor").Call(arrow)
		return 1
	case wmAppUpdate:
		ui.applyPending()
		return 0
	case wmAppInvalidate:
		procInvalidateRect.Call(hwnd, 0, 1)
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	ret, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msgID), wParam, lParam)
	return ret
}

func loadAppIcon(hInst uintptr) uintptr {
	for _, id := range []uintptr{1, 2, 3, 4, 5, 101} {
		icon, _, _ := procLoadImageW.Call(hInst, id, imageIcon, 0, 0, lrDefaultSize)
		if icon != 0 {
			return icon
		}
		icon, _, _ = procLoadIconW.Call(hInst, id)
		if icon != 0 {
			return icon
		}
	}
	return 0
}

func (ui *NativeUI) createResources() {
	ui.fontTitle = createFont(-24, 700)
	ui.fontHeading = createFont(-20, 700)
	ui.fontBody = createFont(-16, 400)
	ui.fontSmall = createFont(-14, 400)
	ui.fontButton = createFont(-16, 700)
}

func setProcessDPIAware() {
	// Per-monitor DPI awareness prevents Windows from bitmap-scaling this custom
	// drawn UI (which made fonts and minimum dimensions enormous at 150–200%).
	if r, _, _ := procSetDPIContext.Call(^uintptr(3)); r == 0 {
		procSetProcessDPIAware.Call()
	}
}

func (ui *NativeUI) scroll(wheelDelta int) {
	ui.mu.Lock()
	if ui.screen == screenDriverHelp {
		ui.scrollOffset -= wheelDelta / 120 * 48
		if ui.scrollOffset < 0 {
			ui.scrollOffset = 0
		}
		if ui.scrollOffset > 260 {
			ui.scrollOffset = 260
		}
	}
	ui.mu.Unlock()
	ui.invalidate()
}

func (ui *NativeUI) showHome() {
	ui.mu.Lock()
	ui.screen = screenHome
	ui.title = appTitle
	ui.subtitle = "Ready. Simple setup and updates for OpenTurbine boards."
	ui.body = ""
	ui.detail = ""
	ui.mode = ""
	ui.step = 0
	ui.totalSteps = 0
	ui.progress = 0
	ui.primary = ""
	ui.secondary = ""
	ui.pendingMode = ""
	ui.showDetails = false
	ui.activeJob = nil
	ui.mu.Unlock()
	ui.invalidate()
}

func (ui *NativeUI) showPreparing() {
	ui.mu.Lock()
	ui.screen = screenRunning
	ui.title = "Preparing OpenTurbine Setup Tool"
	ui.subtitle = "Stay connected to your normal internet Wi‑Fi."
	ui.body = "Checking setup files. The tool will download anything missing before it opens."
	ui.detail = "After this, choose either a clean USB install (erases the board) or a Wi-Fi update (keeps the engine setup)."
	ui.mode = ""
	ui.step = 1
	ui.totalSteps = 2
	ui.progress = 8
	ui.primary = ""
	ui.secondary = ""
	ui.pendingMode = ""
	ui.showDetails = false
	ui.activeJob = nil
	ui.logs = nil
	ui.mu.Unlock()
	ui.invalidate()
}

func (ui *NativeUI) prepareThenShowHome() {
	logf := func(line string, percent int) {
		if percent < 8 {
			percent = 8
		}
		if percent > 96 {
			percent = 96
		}
		ui.update(uiUpdate{screen: screenRunning, title: "Preparing OpenTurbine Setup Tool", subtitle: "Stay connected to your normal internet Wi‑Fi.", body: line, detail: "The setup tool will open automatically when the required files are ready.", step: 1, totalSteps: 2, progress: percent, appendLog: []string{line}})
	}
	logf("Checking for the recommended OpenTurbine files.", 12)
	if _, err := ui.app.ensurePackageWithProgress(logf); err != nil {
		body := "The tool could not prepare the required OpenTurbine files.\n\nStay connected to your normal internet Wi-Fi and open the tool again.\n\nFor now, OpenTurbine also needs a GitHub Release asset named OpenTurbine_Recommended.zip."
		ui.update(uiUpdate{screen: screenError, title: "Setup files not ready", subtitle: "The tool could not download or check the required files.", body: body, detail: oneLine(err.Error()), step: 0, totalSteps: 0, progress: 0, primary: "Back to start", secondary: "", done: true, appendLog: []string{"ERROR: " + err.Error()}})
		return
	}
	ui.update(uiUpdate{screen: screenRunning, title: "Preparing OpenTurbine Setup Tool", subtitle: "Setup files ready.", body: "Required files are ready. Opening the setup tool.", detail: "", step: 2, totalSteps: 2, progress: 100, appendLog: []string{"Required files are ready."}})
	time.Sleep(500 * time.Millisecond)
	ui.update(uiUpdate{screen: screenHome, title: appTitle, subtitle: "Ready. Simple setup and updates for OpenTurbine boards."})
}

func (ui *NativeUI) showSafety(mode string) {
	subtitle := "For a blank board or a clean reinstall, connected by USB."
	body := "This is a CLEAN INSTALL. It erases the entire selected ESP32, including any existing OpenTurbine settings, calibration, logs, and Wi-Fi password. Use the Wi-Fi Update option instead when you want to keep an existing engine setup.\n\nIf this board still runs OpenTurbine and you may need its setup, cancel now and download the complete engine file from Tools before returning here. The installer cannot recover data after erase.\n\nDisconnect relays, pumps, starters, igniters, servos, valves, and anything else that could move, heat, spark, or start fuel flow. Pins can briefly change state while the board is erased, flashed, or restarted.\n\nAfter installation, treat the ECU as unconfigured. Check Hardware, Config, Calibration, and Sequence before reconnecting engine outputs."
	primary := cleanSafetyButtonLabel
	if mode == "update" {
		subtitle = "For a working OpenTurbine board; keeps its engine setup."
		body = "This is an UPDATE, not a reset. It updates the firmware and dashboard over Wi-Fi. Existing hardware settings, engine settings, calibration, logs, profile name, and Wi-Fi password remain on the board. The tool also saves and validates a complete engine file before uploading anything.\n\nBefore continuing:\n\nStop the engine, make sure no actuator test is running, and physically make fuel, ignition, starter, and other dangerous outputs safe. Keep board power stable until the update finishes.\n\nAfter updating, review Hardware, Config, Calibration, and Sequence before using fuel."
		primary = updateSafetyButtonLabel
	}
	ui.update(uiUpdate{
		screen:     screenSafety,
		title:      "Safety check",
		subtitle:   subtitle,
		body:       body,
		mode:       mode,
		primary:    primary,
		secondary:  "Back",
		appendLog:  nil,
		progress:   0,
		totalSteps: 0,
		step:       0,
	})
}

func (ui *NativeUI) startJob(mode string) {
	if ui.activeJob != nil {
		return
	}
	job := &Job{app: ui.app, mode: mode, continueCh: make(chan struct{}), actionCh: make(chan string)}
	ui.mu.Lock()
	ui.activeJob = job
	ui.logs = nil
	ui.showDetails = false
	ui.mu.Unlock()
	if mode == "new" {
		go job.runNewBoard()
	} else {
		go job.runExistingUpdate()
	}
}

func (ui *NativeUI) click(x, y int) {
	ui.mu.Lock()
	zones := append([]clickZone(nil), ui.zones...)
	screen := ui.screen
	mode := ui.pendingMode
	job := ui.activeJob
	ui.mu.Unlock()
	for _, z := range zones {
		if pointInRect(x, y, z.r) {
			if (strings.HasPrefix(z.action, "selectBoard:") ||
				strings.HasPrefix(z.action, "pcbProfile:")) && job != nil {
				select {
				case job.actionCh <- z.action:
				default:
				}
				return
			}
			switch z.action {
			case "new":
				ui.showSafety("new")
			case "update":
				ui.showSafety("update")
			case "start":
				ui.startJob(mode)
			case "back":
				ui.showHome()
			case "continue":
				if job != nil {
					select {
					case job.continueCh <- struct{}{}:
					default:
					}
				}
			case "home":
				ui.showHome()
			case "openBackup":
				ui.openBackupFolder()
			case "copyLog":
				ui.copyLogToClipboard()
			case "driverCP210x":
				if job != nil {
					select {
					case job.actionCh <- "cp210x":
					default:
					}
				}
			case "driverWCH":
				if job != nil {
					select {
					case job.actionCh <- "wch":
					default:
					}
				}
			case "retryUSB":
				if job != nil {
					select {
					case job.actionCh <- "retry":
					default:
					}
				}
			case "cancelUSB":
				if job != nil {
					select {
					case job.actionCh <- "cancel":
					default:
					}
				}
			case "pcbProfileCustom":
				if job != nil {
					if path := ui.choosePCBProfileFile(); path != "" {
						select {
						case job.actionCh <- "pcbProfileCustom:" + path:
						default:
						}
					}
				}
			case "details":
				ui.mu.Lock()
				ui.showDetails = !ui.showDetails
				ui.mu.Unlock()
				ui.invalidate()
			case "close":
				procPostQuitMessage.Call(0)
			}
			return
		}
	}
	switch screen {
	case screenHome:
		if y >= 170 && y <= 395 {
			if x < 450 {
				ui.showSafety("new")
				return
			}
			ui.showSafety("update")
			return
		}
	case screenSafety:
		if y >= 520 {
			if x < 330 {
				ui.showHome()
				return
			}
			ui.startJob(mode)
			return
		}
	case screenWait:
		if y >= 520 && job != nil {
			select {
			case job.continueCh <- struct{}{}:
			default:
			}
			return
		}
	case screenError, screenDone:
		if y >= 520 && x > 500 {
			ui.showHome()
			return
		}
	}
	_ = screen
}

func (ui *NativeUI) choosePCBProfileFile() string {
	buffer := make([]uint16, 32768)
	filter := syscall.StringToUTF16("OpenTurbine PCB profile (*.otpcb.json)\x00*.otpcb.json\x00JSON files (*.json)\x00*.json\x00All files (*.*)\x00*.*\x00\x00")
	title := syscall.StringToUTF16("Choose the PCB profile supplied with the board design")
	defExt := syscall.StringToUTF16("json")
	ofn := openFileName{
		structSize:       uint32(unsafe.Sizeof(openFileName{})),
		owner:            ui.hwnd,
		filter:           &filter[0],
		filterIndex:      1,
		file:             &buffer[0],
		maxFile:          uint32(len(buffer)),
		title:            &title[0],
		flags:            0x00080000 | 0x00000800 | 0x00001000, // explorer, path exists, file exists
		defaultExtension: &defExt[0],
	}
	ok, _, _ := procGetOpenFileNameW.Call(uintptr(unsafe.Pointer(&ofn)))
	if ok == 0 {
		return ""
	}
	return syscall.UTF16ToString(buffer)
}

func (ui *NativeUI) openBackupFolder() {
	ui.mu.Lock()
	p := ui.backupPath
	ui.mu.Unlock()
	if p == "" {
		p = ui.app.workDir
	}
	if fileExists(p) {
		p = filepath.Dir(p)
	}
	_ = os.MkdirAll(p, 0755)
	procShellExecuteW.Call(ui.hwnd, uintptr(unsafe.Pointer(utf16Ptr("open"))), uintptr(unsafe.Pointer(utf16Ptr(p))), 0, 0, 1)
}

func (ui *NativeUI) copyLogToClipboard() {
	ui.mu.Lock()
	title := ui.title
	subtitle := ui.subtitle
	body := ui.body
	detail := ui.detail
	logs := append([]string(nil), ui.logs...)
	ui.mu.Unlock()

	var b strings.Builder
	b.WriteString("OpenTurbine Setup Tool " + appVersion + "\r\n")
	if title != "" {
		b.WriteString(title + "\r\n")
	}
	if subtitle != "" {
		b.WriteString(subtitle + "\r\n")
	}
	if body != "" {
		b.WriteString("\r\n" + body + "\r\n")
	}
	if detail != "" {
		b.WriteString("\r\n" + detail + "\r\n")
	}
	if len(logs) > 0 {
		b.WriteString("\r\nLog:\r\n")
		for _, line := range logs {
			b.WriteString(line + "\r\n")
		}
	}
	if err := setClipboardText(ui.hwnd, b.String()); err != nil {
		return
	}
	ui.mu.Lock()
	ui.detail = "Log copied to clipboard."
	ui.mu.Unlock()
	ui.invalidate()
}

func (ui *NativeUI) update(u uiUpdate) {
	ui.mu.Lock()
	ui.pending = &u
	ui.mu.Unlock()
	procPostMessageW.Call(ui.hwnd, wmAppUpdate, 0, 0)
}

func (ui *NativeUI) applyPending() {
	ui.mu.Lock()
	p := ui.pending
	ui.pending = nil
	if p != nil {
		ui.screen = p.screen
		ui.title = p.title
		ui.subtitle = p.subtitle
		ui.body = p.body
		ui.detail = p.detail
		ui.step = p.step
		ui.totalSteps = p.totalSteps
		ui.progress = p.progress
		ui.primary = p.primary
		ui.secondary = p.secondary
		if p.mode != "" {
			ui.mode = p.mode
			if p.screen == screenSafety {
				ui.pendingMode = p.mode
			}
		}
		if p.backupPath != "" {
			ui.backupPath = p.backupPath
		}
		if len(p.appendLog) > 0 {
			ui.logs = append(ui.logs, p.appendLog...)
		}
		if p.boards != nil {
			ui.boards = append([]detectedBoard(nil), p.boards...)
		}
		if p.pcbChoices != nil {
			ui.pcbChoices = append([]pcbProfileChoice(nil), p.pcbChoices...)
		}
		if p.screen == screenDriverHelp || p.driverChoices != nil {
			ui.driverChoices = append([]driverChoice(nil), p.driverChoices...)
		}
		if p.done {
			ui.activeJob = nil
		}
		if p.screen == screenHome {
			ui.body = ""
			ui.detail = ""
			ui.mode = ""
			ui.step = 0
			ui.totalSteps = 0
			ui.progress = 0
			ui.primary = ""
			ui.secondary = ""
			ui.pendingMode = ""
			ui.backupPath = ""
			ui.showDetails = false
			ui.activeJob = nil
			ui.driverChoices = nil
			ui.pcbChoices = nil
		}
		if p.screen != screenDriverHelp {
			ui.scrollOffset = 0
		}
	}
	ui.mu.Unlock()
	ui.invalidate()
}

func (ui *NativeUI) invalidate() {
	if ui.hwnd != 0 {
		procPostMessageW.Call(ui.hwnd, wmAppInvalidate, 0, 0)
	}
}

func (ui *NativeUI) paint() {
	var ps paintStruct
	windowDC, _, _ := procBeginPaint.Call(ui.hwnd, uintptr(unsafe.Pointer(&ps)))
	defer procEndPaint.Call(ui.hwnd, uintptr(unsafe.Pointer(&ps)))
	var cr rect
	procGetClientRect.Call(ui.hwnd, uintptr(unsafe.Pointer(&cr)))
	w := int(cr.right - cr.left)
	h := int(cr.bottom - cr.top)
	if w < 640 {
		w = 640
	}
	if h < 480 {
		h = 480
	}

	// Paint into memory and copy one finished frame to the window. Direct GDI
	// painting visibly flashed during mouse-wheel scrolling and live resize.
	hdc, _, _ := procCreateCompatibleDC.Call(windowDC)
	bitmap, _, _ := procCreateCompatibleBitmap.Call(windowDC, uintptr(w), uintptr(h))
	oldBitmap, _, _ := procSelectObject.Call(hdc, bitmap)
	defer func() {
		procBitBlt.Call(windowDC, 0, 0, uintptr(w), uintptr(h), hdc, 0, 0, srcCopy)
		procSelectObject.Call(hdc, oldBitmap)
		procDeleteObject.Call(bitmap)
		procDeleteDC.Call(hdc)
	}()

	ui.mu.Lock()
	s := ui.screen
	title := ui.title
	subtitle := ui.subtitle
	body := ui.body
	detail := ui.detail
	step := ui.step
	total := ui.totalSteps
	progress := ui.progress
	primary := ui.primary
	secondary := ui.secondary
	backupPath := ui.backupPath
	secondaryState := ui.secondary
	mode := ui.mode
	logs := append([]string(nil), ui.logs...)
	showDetails := ui.showDetails
	scrollOffset := ui.scrollOffset
	boards := append([]detectedBoard(nil), ui.boards...)
	pcbChoices := append([]pcbProfileChoice(nil), ui.pcbChoices...)
	driverChoices := append([]driverChoice(nil), ui.driverChoices...)
	ui.zones = nil
	ui.mu.Unlock()

	fill(hdc, rect{0, 0, int32(w), int32(h)}, colBg)
	fill(hdc, rect{0, 0, int32(w), 86}, colHeader)
	line(hdc, 0, 86, w, 86, colBorderSoft, 1)
	text(hdc, title, rect{34, 14, int32(w - 34), 54}, ui.fontTitle, colText, dtLeft|dtSingleLine|dtNoPrefix)
	text(hdc, subtitle, rect{36, 56, int32(w - 36), 80}, ui.fontSmall, colTextMuted, dtLeft|dtSingleLine|dtNoPrefix)

	switch s {
	case screenHome:
		ui.paintHome(hdc, w, h)
	case screenSafety:
		ui.paintCardScreen(hdc, w, h, body, detail, step, total, progress, primary, secondary, false, false, logs, showDetails)
	case screenRunning:
		ui.paintCardScreen(hdc, w, h, body, detail, step, total, progress, "", "", true, true, logs, showDetails)
	case screenWait:
		ui.paintCardScreen(hdc, w, h, body, detail, step, total, progress, primary, "", false, true, logs, showDetails)
	case screenDone:
		if backupPath != "" && !strings.Contains(body, backupPath) {
			body += "\n\nEngine file backup:\n" + backupPath
		}
		secondary := "Open log folder"
		if backupPath != "" {
			secondary = "Open backup folder"
		}
		ui.paintCardScreen(hdc, w, h, body, detail, step, total, 100, "Back to start", secondary, false, true, logs, showDetails)
	case screenDriverHelp:
		ui.paintDriverHelp(hdc, w, h, body, detail, logs, showDetails, scrollOffset, driverChoices)
	case screenBoardChoice:
		ui.paintBoardChoice(hdc, w, h, boards)
	case screenPCBProfileChoice:
		ui.paintPCBProfileChoice(hdc, w, h, pcbChoices)
	case screenError:
		errorSecondary := secondaryState
		if errorSecondary == "" {
			errorSecondary = "Open folder"
		}
		ui.paintCardScreen(hdc, w, h, body, detail, step, total, progress, "Back to start", errorSecondary, false, true, logs, showDetails)
	}

	// Footer is intentionally simple.
	text(hdc, "OpenTurbine Setup Tool "+appVersion, rect{34, int32(h - 36), int32(w - 34), int32(h - 12)}, ui.fontSmall, colTextSoft, dtLeft|dtSingleLine|dtNoPrefix)
	if mode != "" && s != screenHome {
		label := "Clean USB install / reinstall"
		if mode == "update" {
			label = "Wi-Fi update — keeps setup"
		}
		text(hdc, label, rect{34, int32(h - 36), int32(w - 34), int32(h - 12)}, ui.fontSmall, colTextSoft, dtRight|dtSingleLine|dtNoPrefix)
	}
}

func (ui *NativeUI) paintHome(hdc uintptr, w, h int) {
	text(hdc, "Choose one option", rect{36, 108, int32(w - 36), 144}, ui.fontHeading, colText, dtLeft|dtSingleLine|dtNoPrefix)
	margin := 34
	gap := 24
	cardW := (w - margin*2 - gap) / 2
	if cardW > 390 {
		cardW = 390
	}
	x1 := margin
	x2 := x1 + cardW + gap
	y := 150
	cardH := h - y - 142
	if cardH > 268 {
		cardH = 268
	}
	if cardH < 196 {
		cardH = 196
	}
	r1 := rect{int32(x1), int32(y), int32(x1 + cardW), int32(y + cardH)}
	r2 := rect{int32(x2), int32(y), int32(x2 + cardW), int32(y + cardH)}
	ui.drawActionCard(hdc, r1, "Clean install / reinstall", "For a blank board or a fresh start on an older board. Uses USB and ERASES all existing settings, calibration, logs, and Wi-Fi details.", "Erase board and install", "new")
	ui.drawActionCard(hdc, r2, "Update and keep my setup", "For a working OpenTurbine board. Uses Wi-Fi, validates a complete engine-file backup, and keeps the setup already stored on the board.", "Update without resetting", "update")
	noteY := y + cardH + 16
	note := "During update the tool will tell you exactly when to stay on normal internet Wi-Fi and when to connect to the board Wi-Fi. The board Wi-Fi name may be OpenTurbine or your own engine/project name."
	noteBottom := h - 48
	drawPanel(hdc, rect{34, int32(noteY), int32(w - 34), int32(noteBottom)}, colInfoBg, colInfoBorder, 18)
	text(hdc, note, rect{56, int32(noteY + 14), int32(w - 56), int32(noteBottom - 10)}, ui.fontSmall, colInfoText, dtLeft|dtWordBreak|dtNoPrefix)
}

func (ui *NativeUI) drawActionCard(hdc uintptr, r rect, heading, body, button, action string) {
	drawPanel(hdc, r, colPanel, colBorderSoft, 24)
	text(hdc, heading, rect{r.left + 24, r.top + 26, r.right - 24, r.top + 64}, ui.fontHeading, colText, dtLeft|dtSingleLine|dtNoPrefix)
	text(hdc, body, rect{r.left + 24, r.top + 82, r.right - 24, r.bottom - 84}, ui.fontBody, colTextMuted, dtLeft|dtWordBreak|dtNoPrefix)
	br := rect{r.left + 24, r.bottom - 64, r.right - 24, r.bottom - 22}
	drawButton(hdc, br, button, ui.fontButton, true)
	ui.addZone(br, action)
	ui.addZone(r, action)
}

func (ui *NativeUI) paintDriverHelp(hdc uintptr, w, h int, body, detail string, logs []string, showDetails bool, scrollOffset int, choices []driverChoice) {
	card := rect{34, 112, int32(w - 34), int32(h - 78)}
	drawPanel(hdc, card, colPanel, colBorderSoft, 24)
	top := int(card.top) + 28
	bodyArea := rect{card.left + 28, int32(top), card.right - 28, card.bottom - 226}
	saved, _, _ := procSaveDC.Call(hdc)
	procIntersectClipRect.Call(hdc, uintptr(bodyArea.left), uintptr(bodyArea.top), uintptr(bodyArea.right), uintptr(bodyArea.bottom))
	text(hdc, body, rect{bodyArea.left, bodyArea.top - int32(scrollOffset), bodyArea.right, bodyArea.top + 520 - int32(scrollOffset)}, ui.fontBody, colText, dtLeft|dtWordBreak|dtNoPrefix)
	procRestoreDC.Call(hdc, saved)
	if showDetails {
		dr := rect{card.left + 28, card.bottom - 218, card.right - 28, card.bottom - 132}
		drawPanel(hdc, dr, colPanelSoft, colBorder, 14)
		text(hdc, "Additional information", rect{dr.left + 16, dr.top + 10, dr.right - 16, dr.top + 34}, ui.fontSmall, colText, dtLeft|dtSingleLine|dtNoPrefix)
		logText := latestLogs(logs, 3)
		if logText == "" {
			logText = detail
		}
		if logText == "" {
			logText = "No details yet."
		}
		text(hdc, logText, rect{dr.left + 16, dr.top + 40, dr.right - 16, dr.bottom - 10}, ui.fontSmall, colTextMuted, dtLeft|dtWordBreak|dtNoPrefix)
	} else if detail != "" {
		dr := rect{card.left + 28, card.bottom - 194, card.right - 28, card.bottom - 132}
		drawPanel(hdc, dr, colPanelSoft, colBorder, 14)
		text(hdc, detail, rect{dr.left + 16, dr.top + 12, dr.right - 16, dr.bottom - 10}, ui.fontSmall, colTextMuted, dtLeft|dtWordBreak|dtNoPrefix)
	}
	by := int(card.bottom) - 64
	left := card.left + 28
	label := "Show details"
	if showDetails {
		label = "Hide details"
	}
	details := rect{left, int32(by), left + 150, int32(by + 44)}
	drawButton(hdc, details, label, ui.fontButton, false)
	ui.addZone(details, "details")
	left += 166
	cancel := rect{left, int32(by), left + 118, int32(by + 44)}
	drawButton(hdc, cancel, "Cancel", ui.fontButton, false)
	ui.addZone(cancel, "cancelUSB")
	// Driver choices get their own row so they cannot collide with navigation
	// buttons in a narrow window or under Windows display scaling.
	driverY := by - 58
	x := card.left + 28
	for _, choice := range choices {
		if choice.Kind != driverCP210x && choice.Kind != driverWCH {
			continue
		}
		label := choice.Label
		if label == "" {
			label = "Install " + string(choice.Kind)
		}
		r := rect{x, int32(driverY), x + 198, int32(driverY + 42)}
		drawButton(hdc, r, label, ui.fontButton, false)
		if choice.Kind == driverCP210x {
			ui.addZone(r, "driverCP210x")
		} else {
			ui.addZone(r, "driverWCH")
		}
		x += 214
	}
	try := rect{card.right - 192, int32(by), card.right - 28, int32(by + 44)}
	drawButton(hdc, try, "Try Again", ui.fontButton, true)
	ui.addZone(try, "retryUSB")
}

func (ui *NativeUI) paintBoardChoice(hdc uintptr, w, h int, boards []detectedBoard) {
	card := rect{34, 112, int32(w - 34), int32(h - 78)}
	drawPanel(hdc, card, colPanel, colBorderSoft, 24)
	text(hdc, "More than one supported board was found. Nothing will be erased until you choose.", rect{card.left + 28, card.top + 24, card.right - 28, card.top + 62}, ui.fontBody, colText, dtLeft|dtWordBreak|dtNoPrefix)
	y := card.top + 78
	for i, board := range boards {
		if y+58 > card.bottom-74 {
			break
		}
		r := rect{card.left + 28, y, card.right - 28, y + 52}
		label := board.Port + "  —  " + board.Chip
		if i == 0 {
			label += "  (suggested)"
		}
		drawButton(hdc, r, label, ui.fontButton, i == 0)
		ui.addZone(r, fmt.Sprintf("selectBoard:%d", i))
		y += 64
	}
	cancel := rect{card.left + 28, card.bottom - 58, card.left + 150, card.bottom - 16}
	drawButton(hdc, cancel, "Cancel", ui.fontButton, false)
	ui.addZone(cancel, "cancelUSB")
}

func (ui *NativeUI) paintCardScreen(hdc uintptr, w, h int, body, detail string, step, total, progress int, primary, secondary string, busy bool, canDetails bool, logs []string, showDetails bool) {
	card := rect{34, 112, int32(w - 34), int32(h - 78)}
	drawPanel(hdc, card, colPanel, colBorderSoft, 24)
	top := int(card.top) + 28
	if total > 0 {
		label := fmt.Sprintf("Step %d of %d", step, total)
		if step <= 0 {
			label = fmt.Sprintf("Step 1 of %d", total)
		}
		text(hdc, label, rect{card.left + 28, int32(top), card.right - 28, int32(top + 24)}, ui.fontSmall, colTextMuted, dtLeft|dtSingleLine|dtNoPrefix)
		ui.drawProgress(hdc, rect{card.left + 28, int32(top + 34), card.right - 28, int32(top + 48)}, progress)
		top += 76
	}
	bodyBottom := card.bottom - 150
	if showDetails && canDetails {
		bodyBottom = card.bottom - 286
	}
	if busy {
		drawStatusBadge(hdc, rect{card.left + 28, int32(top), card.left + 136, int32(top + 32)}, "Working", ui.fontSmall)
		text(hdc, body, rect{card.left + 28, int32(top + 48), card.right - 28, bodyBottom}, ui.fontBody, colText, dtLeft|dtWordBreak|dtNoPrefix)
	} else if requiresConfirmationBadge(primary) {
		drawStatusBadge(hdc, rect{card.left + 28, int32(top), card.left + 230, int32(top + 32)}, "Confirmation required", ui.fontSmall)
		text(hdc, body, rect{card.left + 28, int32(top + 48), card.right - 28, bodyBottom}, ui.fontBody, colText, dtLeft|dtWordBreak|dtNoPrefix)
	} else {
		text(hdc, body, rect{card.left + 28, int32(top), card.right - 28, bodyBottom}, ui.fontBody, colText, dtLeft|dtWordBreak|dtNoPrefix)
	}
	if showDetails && canDetails {
		dr := rect{card.left + 28, card.bottom - 274, card.right - 28, card.bottom - 92}
		drawPanel(hdc, dr, colPanelSoft, colBorder, 14)
		text(hdc, "Additional information", rect{dr.left + 16, dr.top + 10, dr.right - 16, dr.top + 34}, ui.fontSmall, colText, dtLeft|dtSingleLine|dtNoPrefix)
		logText := latestLogs(logs, 3)
		if logText == "" {
			logText = "No details yet."
		}
		text(hdc, logText, rect{dr.left + 16, dr.top + 40, dr.right - 16, dr.bottom - 22}, ui.fontSmall, colTextMuted, dtLeft|dtWordBreak|dtNoPrefix)
	} else if detail != "" {
		dr := rect{card.left + 28, card.bottom - 138, card.right - 28, card.bottom - 86}
		drawPanel(hdc, dr, colPanelSoft, colBorder, 14)
		text(hdc, detail, rect{dr.left + 16, dr.top + 12, dr.right - 16, dr.bottom - 10}, ui.fontSmall, colTextMuted, dtLeft|dtWordBreak|dtNoPrefix)
	}
	by := int(card.bottom) - 64
	leftX := card.left + 28
	if canDetails {
		label := "Show details"
		if showDetails {
			label = "Hide details"
		}
		drBtn := rect{leftX, int32(by), leftX + 170, int32(by + 44)}
		drawButton(hdc, drBtn, label, ui.fontButton, false)
		ui.addZone(drBtn, "details")
		leftX += 186
		copyBtn := rect{leftX, int32(by), leftX + 150, int32(by + 44)}
		drawButton(hdc, copyBtn, "Copy log", ui.fontButton, false)
		ui.addZone(copyBtn, "copyLog")
		leftX += 166
	}
	if secondary != "" {
		sr := rect{leftX, int32(by), leftX + 150, int32(by + 44)}
		drawButton(hdc, sr, secondary, ui.fontButton, false)
		if secondary == "Back" {
			ui.addZone(sr, "back")
		} else {
			ui.addZone(sr, "openBackup")
		}
	}
	if primary != "" {
		pr := rect{card.right - 314, int32(by), card.right - 28, int32(by + 44)}
		if primary == "Back to start" {
			pr = rect{card.right - 230, int32(by), card.right - 28, int32(by + 44)}
		}
		drawButton(hdc, pr, primary, ui.fontButton, true)
		ui.addZone(pr, primaryButtonAction(primary))
	}
}

func requiresConfirmationBadge(primary string) bool {
	return primary != "" && primary != "Back to start"
}

func primaryButtonAction(label string) string {
	switch label {
	case cleanSafetyButtonLabel, updateSafetyButtonLabel:
		return "start"
	case "Back to start":
		return "home"
	default:
		return "continue"
	}
}

func latestLogs(logs []string, max int) string {
	if max <= 0 || len(logs) == 0 {
		return ""
	}
	start := len(logs) - max
	if start < 0 {
		start = 0
	}
	return strings.Join(logs[start:], "\n")
}

func (ui *NativeUI) drawProgress(hdc uintptr, r rect, percent int) {
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	drawPanel(hdc, r, colPanelSoft, colBorderSoft, 7)
	fillW := int(float64(r.right-r.left) * float64(percent) / 100.0)
	if fillW > 0 {
		rr := r
		rr.right = rr.left + int32(fillW)
		drawPanel(hdc, rr, colAccent, colAccent, 7)
	}
}

func (ui *NativeUI) addZone(r rect, action string) {
	ui.mu.Lock()
	ui.zones = append(ui.zones, clickZone{r: r, action: action})
	ui.mu.Unlock()
}

func fill(hdc uintptr, r rect, color uint32) {
	brush, _, _ := procCreateSolidBrush.Call(uintptr(color))
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(&r)), brush)
	procDeleteObject.Call(brush)
}

func drawPanel(hdc uintptr, r rect, fillColor, borderColor uint32, radius int) {
	brush, _, _ := procCreateSolidBrush.Call(uintptr(fillColor))
	pen, _, _ := procCreatePen.Call(psSolid, 1, uintptr(borderColor))
	oldB, _, _ := procSelectObject.Call(hdc, brush)
	oldP, _, _ := procSelectObject.Call(hdc, pen)
	procRoundRect.Call(hdc, uintptr(r.left), uintptr(r.top), uintptr(r.right), uintptr(r.bottom), uintptr(radius), uintptr(radius))
	procSelectObject.Call(hdc, oldB)
	procSelectObject.Call(hdc, oldP)
	procDeleteObject.Call(brush)
	procDeleteObject.Call(pen)
}

func drawButton(hdc uintptr, r rect, label string, font uintptr, primary bool) {
	fillColor := colPanelSoft
	borderColor := colBorder
	textColor := colText
	if primary {
		fillColor = colAccent
		borderColor = colAccent
		textColor = colText
	}
	drawPanel(hdc, r, fillColor, borderColor, 18)
	text(hdc, label, r, font, textColor, dtCenter|dtVCenter|dtSingleLine|dtNoPrefix)
}

func drawStatusBadge(hdc uintptr, r rect, label string, font uintptr) {
	drawPanel(hdc, r, colInfoBg, colInfoBorder, 14)
	text(hdc, label, r, font, colInfoText, dtCenter|dtVCenter|dtSingleLine|dtNoPrefix)
}

func line(hdc uintptr, x1, y1, x2, y2 int, color uint32, width int) {
	pen, _, _ := procCreatePen.Call(psSolid, uintptr(width), uintptr(color))
	old, _, _ := procSelectObject.Call(hdc, pen)
	procMoveToEx.Call(hdc, uintptr(x1), uintptr(y1), 0)
	procLineTo.Call(hdc, uintptr(x2), uintptr(y2))
	procSelectObject.Call(hdc, old)
	procDeleteObject.Call(pen)
}

func text(hdc uintptr, s string, r rect, font uintptr, color uint32, flags uintptr) {
	old, _, _ := procSelectObject.Call(hdc, font)
	procSetTextColor.Call(hdc, uintptr(color))
	procSetBkMode.Call(hdc, transparent)
	p := utf16Ptr(s)
	procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(p)), ^uintptr(0), uintptr(unsafe.Pointer(&r)), flags)
	procSelectObject.Call(hdc, old)
}

func createFont(height, weight int32) uintptr {
	h, _, _ := procCreateFontW.Call(uintptr(height), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(utf16Ptr("Segoe UI"))))
	return h
}

func rgb(r, g, b byte) uint32 { return uint32(r) | uint32(g)<<8 | uint32(b)<<16 }
func pointInRect(x, y int, r rect) bool {
	return int32(x) >= r.left && int32(x) <= r.right && int32(y) >= r.top && int32(y) <= r.bottom
}
func utf16Ptr(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func setClipboardText(hwnd uintptr, s string) error {
	r, _, err := procOpenClipboard.Call(hwnd)
	if r == 0 {
		return err
	}
	defer procCloseClipboard.Call()
	procEmptyClipboard.Call()
	data := append(syscall.StringToUTF16(s), 0)
	size := uintptr(len(data) * 2)
	hmem, _, err := procGlobalAlloc.Call(gmemMoveable, size)
	if hmem == 0 {
		return err
	}
	ptr, _, err := procGlobalLock.Call(hmem)
	if ptr == 0 {
		return err
	}
	dst := unsafe.Slice((*byte)(unsafe.Pointer(ptr)), int(size))
	src := unsafe.Slice((*byte)(unsafe.Pointer(&data[0])), int(size))
	copy(dst, src)
	procGlobalUnlock.Call(hmem)
	r, _, err = procSetClipboardData.Call(cfUnicodeText, hmem)
	if r == 0 {
		return err
	}
	return nil
}

func setTitleBarColors(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	enabled := int32(1)
	// 20 = DWMWA_USE_IMMERSIVE_DARK_MODE. Older Windows builds ignore failures.
	procDwmSetWindowAttribute.Call(hwnd, 20, uintptr(unsafe.Pointer(&enabled)), unsafe.Sizeof(enabled))
	caption := colTitleBar
	textColor := colText
	// 35/36 = DWMWA_CAPTION_COLOR / DWMWA_TEXT_COLOR on modern Windows.
	procDwmSetWindowAttribute.Call(hwnd, 35, uintptr(unsafe.Pointer(&caption)), unsafe.Sizeof(caption))
	procDwmSetWindowAttribute.Call(hwnd, 36, uintptr(unsafe.Pointer(&textColor)), unsafe.Sizeof(textColor))
}

// ---------------- Job flow ----------------

func (j *Job) ui() *NativeUI { return globalUI }

func (j *Job) set(step, total, progress int, title, body, detail string, wait bool) {
	j.addLog(title + " - " + oneLine(body))
	screen := screenRunning
	primary := ""
	if wait {
		screen = screenWait
		primary = "Continue"
		lowerTitle := strings.ToLower(title)
		if strings.Contains(lowerTitle, "plug") {
			primary = "Board connected, continue"
		} else if strings.Contains(lowerTitle, "wi") || strings.Contains(lowerTitle, "connect") {
			primary = "Wi-Fi connected, continue"
		}
		if primary != "Continue" {
			body = strings.ReplaceAll(body, "click Continue", "click "+primary)
			body = strings.ReplaceAll(body, "Click Continue", "Click "+primary)
			body = strings.ReplaceAll(body, "Then click Continue", "Then click "+primary)
			body = strings.ReplaceAll(body, "After connecting, click Continue", "After connecting, click "+primary)
		}
	}
	j.ui().update(uiUpdate{screen: screen, title: title, subtitle: subtitleForMode(j.mode), body: body, detail: detail, step: step, totalSteps: total, progress: progress, primary: primary, mode: j.mode})
}

func (j *Job) addLog(s string) {
	line := time.Now().Format("2006-01-02 15:04:05") + "  " + s
	j.mu.Lock()
	j.logs = append(j.logs, line)
	j.mu.Unlock()
	if globalUI != nil {
		globalUI.mu.Lock()
		globalUI.logs = append(globalUI.logs, line)
		globalUI.mu.Unlock()
		globalUI.invalidate()
	}
}

func (j *Job) fail(err error) {
	msg := friendlyError(err.Error())
	j.addLog("FAILED: " + err.Error())
	j.writeLog("failed", err.Error())
	body := msg + "\n\nNo update is running now. You can go back to the start screen and try again."
	secondary := "Open folder"
	if j.backupPath != "" {
		secondary = "Open backup folder"
	}
	j.ui().update(uiUpdate{screen: screenError, title: "Could not finish", subtitle: subtitleForMode(j.mode), body: body, detail: "Support log:\n" + j.logPath(), step: 0, totalSteps: 0, progress: 0, mode: j.mode, secondary: secondary, done: true, backupPath: j.backupPath})
}

func (j *Job) success(title, body string) {
	j.addLog("DONE: " + title)
	j.writeLog("done", body)
	j.ui().update(uiUpdate{screen: screenDone, title: title, subtitle: subtitleForMode(j.mode), body: body, detail: "Keep fuel disconnected until Hardware, Config, Calibration, and Sequence have been checked.", step: 0, totalSteps: 0, progress: 100, mode: j.mode, done: true, backupPath: j.backupPath})
}

func (j *Job) waitContinue() { <-j.continueCh }

func (j *Job) showDriverHelp(pkg *Package, reason string, bootloaderFailure bool) string {
	recommendation := detectUSBDriverRecommendation()
	if bootloaderFailure {
		recommendation = bootloaderFailureDriverRecommendation(recommendation)
	}
	body := "Board not found.\n\nTry this first:\n\n1. Use a USB data cable, not a charge-only cable.\n2. Plug the board directly into this computer.\n3. Hold BOOT on the board, then click Try Again.\n4. Close Arduino IDE, PlatformIO, Cura, serial monitors, or anything else that may use the COM port.\n\n" + recommendation.Message
	detail := reason + "\n\n" + recommendation.Detail
	j.addLog("Driver Help shown: " + reason)
	j.ui().update(uiUpdate{screen: screenDriverHelp, title: "Board not found", subtitle: subtitleForMode(j.mode), body: body, detail: detail, step: 0, totalSteps: 0, progress: 0, mode: j.mode, appendLog: []string{reason}, driverChoices: recommendation.Choices})
	for {
		action := <-j.actionCh
		switch action {
		case "cp210x", "wch", "ch340":
			kind := normalizeDriverKind(action)
			name := driverKindLabel(kind)
			j.ui().update(uiUpdate{screen: screenDriverHelp, title: "Installing " + name + " driver", subtitle: subtitleForMode(j.mode), body: body, detail: "Windows will ask for administrator permission for a small helper process. The helper installs the signed INF driver package with pnputil, scans for devices, and writes a full diagnostic log.", mode: j.mode, driverChoices: recommendation.Choices})
			result, err := startDriverInstaller(j.app, pkg, kind, recommendation.Device)
			if err != nil {
				msg := name + " driver installation failed: " + err.Error()
				j.addLog(msg)
				j.ui().update(uiUpdate{screen: screenDriverHelp, title: "Driver installation failed", subtitle: subtitleForMode(j.mode), body: body, detail: msg + "\n\nDiagnostic log:\n" + result.LogPath + "\n\nUse Show details or Copy log for the full pnputil output.", mode: j.mode, appendLog: []string{msg, resultSummary(result)}, driverChoices: recommendation.Choices})
				continue
			}
			if result.RebootRequired {
				msg := name + " driver installed. Windows reported that a restart is required before the USB port can be used."
				j.addLog(msg)
				j.ui().update(uiUpdate{screen: screenDriverHelp, title: "Restart Windows required", subtitle: subtitleForMode(j.mode), body: "Driver installed. Windows must be restarted before the USB port can be used.\n\nSave your work, restart Windows, reconnect the board, and run OpenTurbine Setup Tool again.", detail: "Diagnostic log:\n" + result.LogPath, mode: j.mode, appendLog: []string{msg, resultSummary(result)}, driverChoices: nil})
				continue
			}
			if result.COMPort != "" {
				msg := name + " driver installed and Windows reported " + result.COMPort + ". Continuing board detection."
				j.addLog(msg)
				j.ui().update(uiUpdate{screen: screenDriverHelp, title: "Driver installation finished", subtitle: subtitleForMode(j.mode), body: "Windows driver installation finished and the matching USB serial port appeared as " + result.COMPort + ".\n\nContinuing automatically.", detail: "Diagnostic log:\n" + result.LogPath, mode: j.mode, appendLog: []string{msg, resultSummary(result)}, driverChoices: nil})
				return "retry"
			}
			msg := name + " driver installation finished, but the matching COM port did not appear yet."
			finishedBody := "Windows driver installation finished, but the matching USB serial port did not appear yet.\n\n1. Unplug the board.\n2. Plug it in again.\n3. Hold BOOT if needed.\n4. Click Try Again."
			j.addLog(msg)
			j.ui().update(uiUpdate{screen: screenDriverHelp, title: "Driver installation finished", subtitle: subtitleForMode(j.mode), body: finishedBody, detail: msg + "\n\nDiagnostic log:\n" + result.LogPath, mode: j.mode, appendLog: []string{msg, resultSummary(result)}, driverChoices: recommendation.Choices})
		case "retry", "cancel":
			return action
		}
	}
}

func (j *Job) cancelToHome(msg string) {
	j.addLog(msg)
	j.writeLog("cancelled", msg)
	j.ui().showHome()
}

func subtitleForMode(mode string) string {
	if mode == "update" {
		return "Wi-Fi update — keeps setup"
	}
	if mode == "new" {
		return "Clean USB install / reinstall"
	}
	return ""
}

func (j *Job) runNewBoard() {
	total := 7
	j.set(1, total, 5, "Preparing setup files", "Stay connected to your normal internet Wi‑Fi. The tool is preparing the recommended OpenTurbine setup files.", "For a clean USB install or reinstall, the selected board will be erased and OpenTurbine will be installed from the recommended package.", false)
	pkg, err := j.app.ensurePackage()
	if err != nil {
		j.fail(err)
		return
	}

	j.set(2, total, 20, "Plug in the board", "Plug the ESP32 or ESP32‑S3 board into this computer with USB.\n\nIf it is not found, hold BOOT on the board and then click Continue.", "Use a USB data cable, not a charge-only cable.", true)
	j.waitContinue()

	esptool, err := findEsptool(pkg)
	if err != nil {
		j.fail(err)
		return
	}

	var target, port string
	for {
		ports := findSerialPorts()
		if len(ports) == 0 {
			action := j.showDriverHelp(pkg, "No serial COM port was found for the board.", false)
			if action == "cancel" {
				j.cancelToHome("Clean USB install was cancelled.")
				return
			}
			continue
		}

		j.set(3, total, 35, "Detecting board", "The tool is looking for an ESP32 board over USB.", "This usually takes a few seconds. If it fails, hold BOOT and try again.", false)
		var supported []detectedBoard
		var unsupported []string
		for _, p := range ports {
			board, err := detectBoardWithEsptool(esptool, p)
			if err != nil {
				continue
			}
			if board.Target == "" {
				unsupported = append(unsupported, board.Port+" ("+board.Chip+")")
				continue
			}
			supported = append(supported, board)
		}
		if len(unsupported) > 0 {
			j.addLog("Ignored unsupported board(s): " + strings.Join(unsupported, ", "))
		}
		if len(supported) == 1 {
			target, port = supported[0].Target, supported[0].Port
			break
		}
		if len(supported) > 1 {
			j.ui().update(uiUpdate{screen: screenBoardChoice, title: "Choose the board to flash", subtitle: subtitleForMode(j.mode), mode: j.mode, boards: supported})
			action := <-j.actionCh
			if action == "cancel" {
				j.cancelToHome("Clean USB install was cancelled before a board was selected.")
				return
			}
			var selected int
			if _, err := fmt.Sscanf(action, "selectBoard:%d", &selected); err == nil && selected >= 0 && selected < len(supported) {
				target, port = supported[selected].Target, supported[selected].Port
				break
			}
			continue
		}
		if len(unsupported) > 0 {
			j.fail(fmt.Errorf("only unsupported ESP chips were found: %s. OpenTurbine currently supports classic ESP32 and ESP32-S3 only; no board was erased", strings.Join(unsupported, ", ")))
			return
		}
		action := j.showDriverHelp(pkg, "A COM port was found, but the ESP32 bootloader did not answer. The connected USB bridge may still be missing its driver; otherwise the board may need BOOT held, EN/RESET tapped, a direct USB data cable, or another app may be holding the port.", true)
		if action == "cancel" {
			j.cancelToHome("Clean USB install was cancelled.")
			return
		}
	}
	j.addLog("Detected board on " + port + ": " + friendlyTarget(target))
	targetPackage := pkg.Manifest.Targets[target]
	choices := []pcbProfileChoice{{
		Label:  "1. ESP32 development board",
		Detail: "No PCB profile. Hardware is configured manually with GPIO, bus, chip, and signal fields as before.",
		Action: "pcbProfile:dev", Enabled: true,
	}}
	if len(targetPackage.PCBProfile.OfficialProfiles) == 0 {
		choices = append(choices, pcbProfileChoice{
			Label:   "2. Official OpenTurbine PCB",
			Detail:  "No official profile for this ESP chip is included in this setup package.",
			Enabled: false,
		})
	} else {
		for i, profile := range targetPackage.PCBProfile.OfficialProfiles {
			choices = append(choices, pcbProfileChoice{
				Label:  fmt.Sprintf("2. %s — revision %s", profile.Name, profile.Revision),
				Detail: "Official immutable pinout supplied with the OpenTurbine PCB design.",
				Action: fmt.Sprintf("pcbProfile:official:%d", i), Enabled: true,
			})
		}
	}
	choices = append(choices, pcbProfileChoice{
		Label:  "3. Custom PCB profile…",
		Detail: "Choose the .otpcb.json file supplied with a third-party or self-designed PCB. The file must match the detected ESP chip.",
		Action: "pcbProfileCustom", Enabled: true,
	})
	j.ui().update(uiUpdate{screen: screenPCBProfileChoice, title: "Choose board hardware", subtitle: subtitleForMode(j.mode), mode: j.mode, pcbChoices: choices})
	var pcbProfilePath, pcbProfileLabel string
	for pcbProfilePath == "" && pcbProfileLabel == "" {
		action := <-j.actionCh
		if action == "cancel" {
			j.cancelToHome("Clean USB install was cancelled before a PCB layout was selected.")
			return
		}
		if action == "pcbProfile:dev" {
			pcbProfileLabel = "ESP32 development board (no PCB profile)"
			break
		}
		if strings.HasPrefix(action, "pcbProfile:official:") {
			var selected int
			if _, err := fmt.Sscanf(action, "pcbProfile:official:%d", &selected); err != nil ||
				selected < 0 || selected >= len(targetPackage.PCBProfile.OfficialProfiles) {
				continue
			}
			profile := targetPackage.PCBProfile.OfficialProfiles[selected]
			path, err := packageFile(pkg, target, profile.File)
			if err != nil || verifySHA256(path, profile.SHA256) != nil {
				j.fail(errors.New("the selected official PCB profile is missing or corrupt; no board was erased"))
				return
			}
			pcbProfilePath = path
			pcbProfileLabel = profile.Name + " revision " + profile.Revision
			break
		}
		if strings.HasPrefix(action, "pcbProfileCustom:") {
			sourcePath := strings.TrimPrefix(action, "pcbProfileCustom:")
			path, warnings, err := buildCustomPCBProfile(pkg, target, sourcePath)
			if err != nil {
				retryChoices := append([]pcbProfileChoice{{
					Label:   "Profile not accepted",
					Detail:  err.Error(),
					Enabled: false,
				}}, choices...)
				j.ui().update(uiUpdate{screen: screenPCBProfileChoice, title: "Custom PCB profile rejected", subtitle: subtitleForMode(j.mode), mode: j.mode, pcbChoices: retryChoices, appendLog: []string{"Custom PCB profile rejected: " + err.Error()}})
				continue
			}
			pcbProfilePath = path
			pcbProfileLabel = filepath.Base(sourcePath)
			defer os.Remove(path)
			if len(warnings) > 0 {
				j.set(4, total, 43, "Review custom PCB warnings",
					"The profile is structurally valid for this chip, but its designer should review:\n\n• "+strings.Join(warnings, "\n• ")+"\n\nContinue only if these choices match the PCB schematic.",
					"Custom profiles are intentionally permissive after hard chip, GPIO, reference, size, and output-safe-state checks.", true)
				j.waitContinue()
			}
			break
		}
	}
	j.addLog("Selected hardware: " + pcbProfileLabel)
	j.set(5, total, 52, "Confirm complete erase", "Found "+friendlyTarget(target)+" on "+port+".\nSelected hardware: "+pcbProfileLabel+".\n\nContinuing will ERASE THE ENTIRE BOARD, including any existing settings, calibration, logs, Wi-Fi details, and any previous PCB profile, then install a fresh OpenTurbine copy. No backup is made by this clean-install path.", "This is the last confirmation before the selected board is erased. Cancel if you intended to update, keep its setup, or make a backup first.", true)
	j.waitContinue()

	version := packageVersion(pkg)
	j.addLog("Using package " + version + " for " + friendlyTarget(target))
	j.set(6, total, 64, "Installing OpenTurbine "+version, "Detected "+friendlyTarget(target)+" on "+port+".\nHardware: "+pcbProfileLabel+".\n\nDo not unplug USB or power. The board will be erased and OpenTurbine "+version+" will be installed.", "Package target: "+target+". This is the clean-install path for blank boards and intentional fresh reinstalls.", false)
	if err := flashUSB(esptool, port, target, pkg, pcbProfilePath, j.addLog, func(percent int) {
		progress := 64 + percent*30/100
		j.ui().update(uiUpdate{screen: screenRunning, title: "Flashing board — " + fmt.Sprintf("%d%%", percent), subtitle: subtitleForMode(j.mode), body: "Writing OpenTurbine to " + friendlyTarget(target) + " on " + port + ".\n\nDo not unplug USB or power.", detail: "Flash write progress reported by esptool.", step: 6, totalSteps: total, progress: progress, mode: j.mode})
	}); err != nil {
		j.fail(err)
		return
	}

	j.success("OpenTurbine installed", "OpenTurbine was installed and verified successfully.\n\nThe board is restarting with fresh defaults. Connect your computer or phone to the OpenTurbine Wi-Fi network; it has no password until you configure one. Windows may say 'No internet'; that is normal.\n\nThen open:\nhttp://192.168.4.1")
}

func (j *Job) runExistingUpdate() {
	total := 7
	j.set(1, total, 5, "Downloading update", "Stay connected to your normal internet Wi‑Fi. Do not connect to the board Wi‑Fi yet.\n\nThe tool is downloading the recommended OpenTurbine update first.", "The board Wi‑Fi often has no internet, so this step happens before switching Wi‑Fi.", false)
	pkg, err := j.app.ensurePackage()
	if err != nil {
		j.fail(err)
		return
	}

	j.set(2, total, 20, "Connect to board Wi‑Fi", "Now switch Wi‑Fi.\n\nConnect this computer to the OpenTurbine board Wi‑Fi. The Wi‑Fi name may be OpenTurbine, or it may be your own engine/project name. Windows may say 'No internet'; that is normal.\n\nAfter connecting, click Continue.", "The tool will look for the board at http://192.168.4.1.", true)
	j.waitContinue()

	j.set(2, total, 25, "Finding board", "The tool is looking for the board at http://192.168.4.1.", "Check that Windows is still connected to the board Wi‑Fi.", false)
	if err := waitForECU(25 * time.Second); err != nil {
		j.fail(errors.New("The board was not found. Check that this computer is connected to the board Wi‑Fi, then try again. The Wi‑Fi name may be OpenTurbine or your own engine/project name."))
		return
	}

	if err := checkSafeStatus(); err != nil {
		j.fail(err)
		return
	}

	j.set(3, total, 36, "Saving complete engine file", "Before updating, the tool is saving and validating the board's hardware, settings, sequences, and calibration.\n\nThe update will not start unless this restorable file is complete.", "The engine file contains the board Wi‑Fi password. Keep it private.", false)
	bpath, err := backupConfig()
	if err != nil {
		j.fail(errors.New("Engine file backup failed. The update was not started. Reconnect to the board Wi‑Fi and try again."))
		return
	}
	j.backupPath = bpath
	j.addLog("Engine file backup saved: " + bpath)

	target, err := chooseTargetForOTA(pkg)
	if err != nil {
		j.fail(errors.New("The tool could not identify this board safely, so no firmware was uploaded. Do not guess the target. If the ECU still opens in a browser, download its complete engine file from Tools first. A clean USB reinstall can recover a supported board, but it erases the board and the engine file must then be restored."))
		return
	}
	if target != "" {
		j.addLog("Using update target: " + friendlyTarget(target))
	}
	version := packageVersion(pkg)
	j.addLog("Using package " + version + " for " + friendlyTarget(target))
	firmware, err := firmwarePath(pkg, target)
	if err != nil {
		j.fail(err)
		return
	}

	j.set(4, total, 50, "Updating OpenTurbine "+version, "Target: "+friendlyTarget(target)+".\n\nDo not unplug power. The board will restart after this step.", "Package target: "+target+". If Windows disconnects from the board Wi-Fi after restart, the tool will pause and tell you what to do.", false)
	if err := postMultipartFilesWithProgress(ecuBaseURL+"/update", []string{firmware}, 10*time.Minute, func(done, totalBytes int64) {
		if totalBytes > 0 {
			p := 50 + int((done*15)/totalBytes)
			j.ui().update(uiUpdate{screen: screenRunning, title: "Updating board software", subtitle: subtitleForMode(j.mode), body: fmt.Sprintf("Sending board software to the OpenTurbine board... %d%%", int((done*100)/totalBytes)), detail: "Do not unplug power. Keep this computer connected to the board Wi-Fi.", step: 4, totalSteps: total, progress: p, mode: j.mode})
		}
	}); err != nil {
		j.fail(fmt.Errorf("Board software update failed. Make sure the engine is in STANDBY and no actuator test is running. Details: %w", err))
		return
	}

	j.set(5, total, 68, "Check Wi‑Fi connection", "The board restarted. Windows may have switched away from the board Wi‑Fi.\n\nCheck that this computer is connected to the correct board Wi‑Fi again before continuing. The Wi‑Fi name may be OpenTurbine, or it may be your own engine/project name.\n\nThen click Continue.", "This check is important before dashboard files are sent to the board.", true)
	j.waitContinue()

	j.set(5, total, 72, "Finding board again", "The tool is checking that the board is back online at http://192.168.4.1.", "If this fails, reconnect to the board Wi‑Fi and run the update again.", false)
	if err := waitForECU(75 * time.Second); err != nil {
		j.fail(errors.New("The board software was uploaded, but the tool could not reconnect after restart. Check that this computer is connected to the board Wi‑Fi, then try again."))
		return
	}

	assets, err := webAssetPaths(pkg, target)
	if err != nil {
		j.fail(err)
		return
	}
	j.set(6, total, 82, "Updating dashboard", "Do not unplug power. The tool is updating the OpenTurbine dashboard files.", "Keep this computer connected to the board Wi‑Fi until this step finishes.", false)
	if err := postMultipartFilesWithProgress(ecuBaseURL+"/api/web_assets", assets, 10*time.Minute, func(done, totalBytes int64) {
		if totalBytes > 0 {
			p := 82 + int((done*10)/totalBytes)
			j.ui().update(uiUpdate{screen: screenRunning, title: "Updating dashboard", subtitle: subtitleForMode(j.mode), body: fmt.Sprintf("Sending dashboard files to the OpenTurbine board... %d%%", int((done*100)/totalBytes)), detail: "Keep this computer connected to the board Wi-Fi until this finishes.", step: 6, totalSteps: total, progress: p, mode: j.mode})
		}
	}); err != nil {
		j.fail(fmt.Errorf("Dashboard update failed. Check that this computer is still connected to the board Wi‑Fi, then try again. Details: %w", err))
		return
	}

	j.set(7, total, 94, "Reconnect for final verification", "The dashboard files were accepted and the board is restarting.\n\nWindows may have switched back to another network. Connect to this OpenTurbine board's Wi-Fi again, wait a few seconds, then click Continue.", "The tool will verify the firmware version and all eleven web assets; it will not report success merely because upload returned quickly.", true)
	j.waitContinue()
	if err := waitForECU(75 * time.Second); err != nil {
		j.fail(errors.New("The files were uploaded, but the tool could not reconnect for final verification. Reconnect to the board Wi-Fi and run Update and keep my setup again; it is safe to repeat."))
		return
	}
	if err := verifyUpdatedECU(version, assets); err != nil {
		j.fail(fmt.Errorf("Final verification failed: %w", err))
		return
	}
	j.success("Update complete", "OpenTurbine was updated successfully.\n\nYour complete engine file was saved here:\n"+bpath+"\n\nOpen http://192.168.4.1 and check the setup before using fuel.")
}

func verifyUpdatedECU(expectedVersion string, assetPaths []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", ecuBaseURL+"/api/device_info", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("could not read firmware identity: %w", err)
	}
	var info struct {
		Project string `json:"project"`
		Version string `json:"firmware_version"`
	}
	decodeErr := json.NewDecoder(resp.Body).Decode(&info)
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || decodeErr != nil {
		return fmt.Errorf("board did not return valid firmware identity")
	}
	if info.Project != "OpenTurbine" || info.Version != expectedVersion {
		return fmt.Errorf("firmware version is %q, expected %q", info.Version, expectedVersion)
	}

	for _, localPath := range assetPaths {
		name := filepath.Base(localPath)
		urlPath := "/" + strings.TrimSuffix(name, ".gz")
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		req, _ := http.NewRequestWithContext(ctx, "GET", ecuBaseURL+urlPath+"?verify="+fmt.Sprint(time.Now().UnixNano()), nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			cancel()
			return fmt.Errorf("could not read dashboard file %s: %w", name, err)
		}
		remote, readErr := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
		resp.Body.Close()
		cancel()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 || readErr != nil {
			return fmt.Errorf("dashboard file %s was not served correctly", name)
		}
		local, err := readGzipFile(localPath)
		if err != nil {
			return fmt.Errorf("could not verify packaged file %s: %w", name, err)
		}
		// Go normally decompresses Content-Encoding:gzip automatically. If a
		// transport leaves raw gzip bytes, normalize those before comparing.
		if len(remote) >= 2 && remote[0] == 0x1f && remote[1] == 0x8b {
			remote, err = gunzipBytes(remote)
			if err != nil {
				return fmt.Errorf("board served corrupt gzip for %s", name)
			}
		}
		if !bytes.Equal(remote, local) {
			return fmt.Errorf("dashboard file %s does not match the update package", name)
		}
	}
	return nil
}

func readGzipFile(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return gunzipBytes(data)
}

func gunzipBytes(data []byte) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	return io.ReadAll(io.LimitReader(zr, 2*1024*1024))
}

func (j *Job) writeLog(status, msg string) {
	dir := filepath.Dir(j.logPath())
	_ = os.MkdirAll(dir, 0755)
	j.mu.Lock()
	defer j.mu.Unlock()
	var b strings.Builder
	b.WriteString("OpenTurbine Setup Tool " + appVersion + "\r\n")
	b.WriteString("Status: " + status + "\r\n")
	b.WriteString("Mode: " + j.mode + "\r\n")
	if j.backupPath != "" {
		b.WriteString("Backup: " + j.backupPath + "\r\n")
	}
	b.WriteString("Message: " + msg + "\r\n\r\n")
	for _, l := range j.logs {
		b.WriteString(l + "\r\n")
	}
	_ = os.WriteFile(filepath.Join(dir, "update_log.txt"), []byte(b.String()), 0644)
}

func (j *Job) logPath() string {
	dir := j.app.workDir
	if j.backupPath != "" {
		dir = filepath.Dir(j.backupPath)
	}
	return filepath.Join(dir, "update_log.txt")
}

func friendlyError(s string) string {
	lower := strings.ToLower(s)
	switch {
	case strings.Contains(lower, "engine file backup failed"):
		return "Engine file backup failed.\n\nThe update was not started. Reconnect to the board Wi‑Fi and try again."
	case strings.Contains(lower, "board was not found") || strings.Contains(lower, "could not reconnect"):
		return "The board was not found.\n\nCheck that this computer is connected to the board Wi‑Fi. The Wi‑Fi name may be OpenTurbine or your own engine/project name. Windows may say 'No internet'; that is normal."
	case strings.Contains(lower, "no usb board"):
		return "No USB board was found.\n\nPlug the board into USB. If needed, hold BOOT on the board and try again. Use a USB data cable, not a charge-only cable."
	case strings.Contains(lower, "usb erase failed") ||
		strings.Contains(lower, "usb install failed") ||
		strings.Contains(lower, "failed to connect") ||
		strings.Contains(lower, "wrong boot mode") ||
		strings.Contains(lower, "timed out waiting") ||
		strings.Contains(lower, "no serial data received") ||
		strings.Contains(lower, "serial data stream stopped") ||
		strings.Contains(lower, "bootloader did not answer"):
		return "The board did not enter USB boot mode.\n\nHold BOOT on the ESP32 board, click Back to start, and try Clean install / reinstall again. Keep BOOT held until the tool starts writing, then release it.\n\nRemember: the clean-install path erases the selected board. Also check that no serial monitor or other app is using the COM port."
	case strings.Contains(lower, "missing tools\\esptool.exe") ||
		strings.Contains(lower, "needs esptool.exe") ||
		strings.Contains(lower, "include tools\\esptool.exe"):
		return "USB setup files are incomplete.\n\nThe recommended OpenTurbine package must include tools\\esptool.exe, or esptool.exe must be placed next to this app."
	case strings.Contains(lower, "not in standby"):
		return "The board is not in STANDBY.\n\nStop the engine, make sure no actuator test is running, then update again."
	case strings.Contains(lower, "download"):
		return "The update could not be downloaded.\n\nStay connected to your normal internet Wi‑Fi and try again. If this is a test build, place OpenTurbine_Recommended.zip next to the app."
	default:
		return s
	}
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }
func friendlyTarget(t string) string {
	if t == "esp32s3dev" {
		return "ESP32-S3"
	}
	if t == "esp32dev" {
		return "ESP32"
	}
	return t
}

func packageVersion(pkg *Package) string {
	if pkg == nil || strings.TrimSpace(pkg.Manifest.Version) == "" {
		return "from the recommended package"
	}
	return strings.TrimSpace(pkg.Manifest.Version)
}

// ---------------- Update / flashing backend ----------------

func (a *App) ensurePackage() (*Package, error) {
	return a.ensurePackageWithProgress(nil)
}

func (a *App) ensurePackageWithProgress(progress func(string, int)) (*Package, error) {
	a.packageMu.Lock()
	defer a.packageMu.Unlock()
	if a.packageReady != nil {
		return a.packageReady, nil
	}
	exe, _ := os.Executable()
	base := "."
	if exe != "" {
		base = filepath.Dir(exe)
	}
	localCandidates := []string{
		filepath.Join(base, "OpenTurbine_Recommended.zip"),
		filepath.Join(base, "package", "OpenTurbine_Recommended.zip"),
	}
	cacheCandidates := []string{
		filepath.Join(a.workDir, "packages", "OpenTurbine_Recommended.zip"),
		filepath.Join(a.workDir, "OpenTurbine_Recommended.zip"),
	}
	for _, c := range localCandidates {
		if !fileExists(c) {
			continue
		}
		if progress != nil {
			progress("Checking downloaded OpenTurbine package.", 28)
		}
		pkg, err := loadPackageFromZip(c)
		if err == nil {
			if _, eerr := findEsptool(pkg); eerr == nil {
				a.packageReady = pkg
				return pkg, nil
			} else {
				return nil, fmt.Errorf("the local OpenTurbine package is missing tools\\esptool.exe, needed for clean USB installation: %w", eerr)
			}
		}
		return nil, fmt.Errorf("the local OpenTurbine package could not be opened: %w", err)
	}
	var cached *Package
	for _, c := range cacheCandidates {
		if !fileExists(c) {
			continue
		}
		pkg, err := loadPackageFromZip(c)
		if err != nil {
			_ = os.Remove(c)
			continue
		}
		if _, err := findEsptool(pkg); err != nil {
			_ = os.Remove(c)
			continue
		}
		cached = pkg
		break
	}
	if fileExists(filepath.Join(base, "package", "manifest.json")) {
		if progress != nil {
			progress("Checking local OpenTurbine package.", 28)
		}
		pkg, err := loadPackageFromDir(filepath.Join(base, "package"))
		if err != nil {
			return nil, err
		}
		if _, eerr := findEsptool(pkg); eerr != nil {
			return nil, fmt.Errorf("the local OpenTurbine package is missing tools\\esptool.exe, needed for clean USB installation: %w", eerr)
		}
		a.packageReady = pkg
		return pkg, nil
	}
	url := strings.TrimSpace(a.config.PackageURL)
	if url == "" {
		url = defaultPackageURL
	}
	dst := filepath.Join(a.workDir, "packages", "OpenTurbine_Recommended.zip")
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return nil, err
	}
	if progress != nil {
		progress("Downloading the recommended OpenTurbine files from GitHub.", 34)
	}
	if err := downloadFileWithProgress(url, dst, func(done, total int64) {
		if progress == nil {
			return
		}
		if total > 0 {
			pct := 34 + int((done*42)/total)
			progress(fmt.Sprintf("Downloading OpenTurbine setup files... %d%%", int((done*100)/total)), pct)
		} else {
			progress("Downloading OpenTurbine setup files...", 42)
		}
	}); err != nil {
		if cached != nil {
			if progress != nil {
				progress("Could not check GitHub; using the previously downloaded package.", 80)
			}
			a.packageReady = cached
			return cached, nil
		}
		return nil, fmt.Errorf("could not download OpenTurbine_Recommended.zip from GitHub Releases. Publish a release asset with that exact name, then try again. Details: %w", err)
	}
	if progress != nil {
		progress("Checking downloaded OpenTurbine package checksum.", 78)
	}
	if err := verifyRemoteSHA256(url+".sha256", dst); err != nil {
		_ = os.Remove(dst)
		return nil, err
	}
	if progress != nil {
		progress("Checking downloaded OpenTurbine package.", 80)
	}
	pkg, err := loadPackageFromZip(dst)
	if err != nil {
		_ = os.Remove(dst)
		return nil, fmt.Errorf("the downloaded OpenTurbine package could not be opened: %w", err)
	}
	if _, eerr := findEsptool(pkg); eerr != nil {
		return nil, fmt.Errorf("the downloaded OpenTurbine package is missing tools\\esptool.exe, needed for clean USB installation: %w", eerr)
	}
	if progress != nil {
		progress("OpenTurbine setup files are ready.", 94)
	}
	a.packageReady = pkg
	return pkg, nil
}

func verifyRemoteSHA256(shaURL, path string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", shaURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "OpenTurbineSetupTool/"+appVersion)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("could not download package checksum: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("package checksum download returned %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return err
	}
	re := regexp.MustCompile(`(?i)[a-f0-9]{64}`)
	expected := re.FindString(string(body))
	if expected == "" {
		return fmt.Errorf("downloaded checksum file did not contain a SHA-256 value")
	}
	return verifySHA256(path, expected)
}

func downloadFile(url, dst string) error {
	return downloadFileWithProgress(url, dst, nil)
}

func downloadFileWithProgress(url, dst string, progress func(done, total int64)) error {
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(url)), "https://") {
		return fmt.Errorf("package URL must use HTTPS")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "OpenTurbineSetupTool/"+appVersion)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download returned %s", resp.Status)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, copyErr := copyWithProgress(f, resp.Body, resp.ContentLength, progress)
	closeErr := f.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	// Windows does not replace an existing destination with os.Rename.
	_ = os.Remove(dst)
	return os.Rename(tmp, dst)
}

func copyWithProgress(dst io.Writer, src io.Reader, total int64, progress func(done, total int64)) (int64, error) {
	if progress == nil {
		return io.Copy(dst, src)
	}
	buf := make([]byte, 64*1024)
	var done int64
	last := time.Now().Add(-time.Second)
	for {
		n, rerr := src.Read(buf)
		if n > 0 {
			wn, werr := dst.Write(buf[:n])
			done += int64(wn)
			if time.Since(last) > 250*time.Millisecond || (total > 0 && done >= total) {
				progress(done, total)
				last = time.Now()
			}
			if werr != nil {
				return done, werr
			}
			if wn != n {
				return done, io.ErrShortWrite
			}
		}
		if rerr == io.EOF {
			progress(done, total)
			return done, nil
		}
		if rerr != nil {
			return done, rerr
		}
	}
}

func loadPackageFromZip(zipPath string) (*Package, error) {
	root := filepath.Join(os.TempDir(), "openturbine_setup_pkg_"+fmt.Sprintf("%d", time.Now().UnixNano()))
	if err := unzip(zipPath, root); err != nil {
		_ = os.RemoveAll(root)
		return nil, err
	}
	pkg, err := loadPackageFromDir(root)
	if err != nil {
		_ = os.RemoveAll(root)
		return nil, err
	}
	pkg.Temporary = true
	return pkg, nil
}

func loadPackageFromDir(root string) (*Package, error) {
	data, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		return nil, fmt.Errorf("setup package is missing manifest.json")
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("setup package manifest is not valid JSON: %w", err)
	}
	if strings.TrimSpace(m.Project) != "" && !strings.EqualFold(strings.TrimSpace(m.Project), "OpenTurbine") {
		return nil, fmt.Errorf("this setup package is not for OpenTurbine")
	}
	if err := validateManifestCompatibility(m); err != nil {
		return nil, err
	}
	for name, target := range m.Targets {
		if !regexp.MustCompile(`^0x[0-9a-fA-F]+$`).MatchString(target.PCBProfile.Address) ||
			target.PCBProfile.Size < 32 {
			return nil, fmt.Errorf("setup package target %s has invalid PCB-profile partition metadata", name)
		}
	}
	return &Package{Root: root, Manifest: m}, nil
}

func validateManifestCompatibility(m Manifest) error {
	if m.PackageSchema != requiredPackageSchema {
		return fmt.Errorf("This setup package uses format %d, but this Setup Tool supports format %d.\nDownload the latest OpenTurbine Setup Tool.", m.PackageSchema, requiredPackageSchema)
	}
	minimum := strings.TrimSpace(m.MinimumSetupToolVersion)
	if minimum == "" {
		return fmt.Errorf("This setup package does not declare a minimum compatible Setup Tool version.\nDownload the latest OpenTurbine Setup Tool.")
	}
	ok, err := versionAtLeast(appVersion, minimum)
	if err != nil {
		return fmt.Errorf("setup package has an invalid minimum_setup_tool_version %q", minimum)
	}
	if !ok {
		return fmt.Errorf("OpenTurbine %s needs Setup Tool %s or newer; this copy is %s.\nDownload the latest OpenTurbine Setup Tool.", strings.TrimSpace(m.Version), minimum, appVersion)
	}
	return nil
}

func versionAtLeast(current, minimum string) (bool, error) {
	parse := func(value string) ([]int, error) {
		value = strings.TrimPrefix(strings.TrimSpace(value), "v")
		parts := strings.Split(value, ".")
		if len(parts) < 2 || len(parts) > 4 {
			return nil, fmt.Errorf("invalid version")
		}
		out := make([]int, len(parts))
		for i, part := range parts {
			if part == "" {
				return nil, fmt.Errorf("invalid version")
			}
			for _, ch := range part {
				if ch < '0' || ch > '9' {
					return nil, fmt.Errorf("invalid version")
				}
				out[i] = out[i]*10 + int(ch-'0')
			}
		}
		return out, nil
	}
	have, err := parse(current)
	if err != nil {
		return false, err
	}
	need, err := parse(minimum)
	if err != nil {
		return false, err
	}
	width := len(have)
	if len(need) > width {
		width = len(need)
	}
	for i := 0; i < width; i++ {
		havePart, needPart := 0, 0
		if i < len(have) {
			havePart = have[i]
		}
		if i < len(need) {
			needPart = need[i]
		}
		if havePart != needPart {
			return havePart > needPart, nil
		}
	}
	return true, nil
}

func unzip(src, dst string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		clean := filepath.Clean(f.Name)
		if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			return fmt.Errorf("unsafe package path: %s", f.Name)
		}
		p := filepath.Join(dst, clean)
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(p, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(p)
		if err != nil {
			rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, rc)
		closeErr := out.Close()
		rc.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func startDriverInstaller(app *App, pkg *Package, kind driverKind, device usbBridgeDevice) (driverInstallResult, error) {
	kind = normalizeDriverKind(string(kind))
	if kind != driverCP210x && kind != driverWCH {
		return driverInstallResult{Kind: kind, Error: "unknown driver type"}, fmt.Errorf("unknown driver type")
	}
	root, err := findDriverINFRoot(pkg, kind)
	if err != nil {
		return driverInstallResult{Kind: kind, Error: err.Error()}, err
	}
	return startINFDriverInstaller(app, root, kind, device)
}

func startINFDriverInstaller(app *App, driverRoot string, kind driverKind, device usbBridgeDevice) (driverInstallResult, error) {
	result := driverInstallResult{Kind: kind, DriverRoot: driverRoot, DeviceInstanceID: device.InstanceID, HardwareIDs: device.HardwareIDs}
	if app == nil {
		result.Error = "setup tool data folder is unavailable"
		return result, fmt.Errorf(result.Error)
	}
	exe, err := os.Executable()
	if err != nil || exe == "" {
		result.Error = "could not find this setup tool executable"
		return result, fmt.Errorf(result.Error)
	}
	if !dirExists(driverRoot) {
		result.Error = fmt.Sprintf("%s driver folder was not found", kind)
		return result, fmt.Errorf(result.Error)
	}
	req, err := buildDriverInstallRequest(app, kind, driverRoot, device)
	if err != nil {
		result.Error = err.Error()
		return result, err
	}
	result, err = runElevatedINFDriverHelper(exe, req)
	if err != nil {
		return result, err
	}
	return result, driverInstallError(result)
}

func waitForDriverInstallResult(path string, timeout time.Duration) (driverInstallResult, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil && len(data) > 0 {
			var result driverInstallResult
			if err := json.Unmarshal(data, &result); err != nil {
				return result, fmt.Errorf("could not read driver installer result: %w", err)
			}
			return result, nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return driverInstallResult{}, fmt.Errorf("driver installer did not report a result. The administrator prompt may have been cancelled or blocked by Windows")
}

func runINFDriverInstallHelper(args []string) int {
	req := driverInstallRequest{}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--driver-kind":
			if i+1 < len(args) {
				req.Kind = normalizeDriverKind(args[i+1])
				i++
			}
		case "--driver-root":
			if i+1 < len(args) {
				req.DriverRoot = args[i+1]
				i++
			}
		case "--device-instance-id":
			if i+1 < len(args) {
				req.DeviceInstanceID = args[i+1]
				i++
			}
		case "--hardware-id":
			if i+1 < len(args) {
				req.HardwareIDs = append(req.HardwareIDs, args[i+1])
				i++
			}
		case "--result":
			if i+1 < len(args) {
				req.ResultPath = args[i+1]
				i++
			}
		case "--log":
			if i+1 < len(args) {
				req.LogPath = args[i+1]
				i++
			}
		}
	}
	if req.DriverRoot == "" || req.ResultPath == "" || req.Kind == "" {
		return 2
	}
	result := installINFDriverPackage(req)
	data, _ := json.MarshalIndent(result, "", "  ")
	_ = os.MkdirAll(filepath.Dir(req.ResultPath), 0755)
	if err := os.WriteFile(req.ResultPath, data, 0644); err != nil {
		return 1
	}
	if req.LogPath != "" {
		_ = os.MkdirAll(filepath.Dir(req.LogPath), 0755)
		_ = os.WriteFile(req.LogPath, []byte(formatDriverDiagnosticText(result)), 0644)
	}
	if driverInstallError(result) == nil {
		return 0
	}
	return 1
}

func runDriverInstallerEXE(installerPath string) driverInstallResult {
	if !fileExists(installerPath) {
		return driverInstallResult{ExitCode: 1, Error: filepath.Base(installerPath) + " was not found"}
	}
	cmd := exec.Command(installerPath)
	prepareHiddenCommand(cmd)
	out, err := cmd.CombinedOutput()
	result := driverInstallResult{Output: strings.TrimSpace(string(out))}
	if exitErr, ok := err.(*exec.ExitError); ok {
		result.ExitCode = exitErr.ExitCode()
		result.Error = strings.TrimSpace(string(out))
	} else if err != nil {
		result.ExitCode = 1
		result.Error = err.Error()
	} else {
		result.ExitCode = 0
	}
	if result.ExitCode == 3010 {
		result.RebootRequired = true
	}
	return result
}

func installINFDriverPackage(req driverInstallRequest) driverInstallResult {
	result := driverInstallResult{
		Kind:             req.Kind,
		DriverRoot:       req.DriverRoot,
		DeviceInstanceID: req.DeviceInstanceID,
		HardwareIDs:      append([]string(nil), req.HardwareIDs...),
		LogPath:          req.LogPath,
	}
	if !dirExists(req.DriverRoot) {
		result.ExitCode = 1
		result.Error = "driver folder was not found"
		return result
	}
	infs := driverINFs(req.DriverRoot)
	result.INFPaths = infs
	if len(infs) == 0 {
		result.ExitCode = 1
		result.Error = "driver folder does not contain an INF file"
		return result
	}
	pnputil := filepath.Join(os.Getenv("SystemRoot"), "System32", "pnputil.exe")
	if !fileExists(pnputil) {
		pnputil = "pnputil.exe"
	}
	install := runDriverCommand(pnputil, "/add-driver", filepath.Join(req.DriverRoot, "*.inf"), "/subdirs", "/install")
	result.ExitCode = install.ExitCode
	result.Output = install.Output
	if install.Err != "" {
		result.Error = install.Err
	}
	if result.ExitCode == 3010 {
		result.RebootRequired = true
	}
	if result.ExitCode != 0 && result.ExitCode != 3010 {
		if result.Error == "" {
			result.Error = meaningfulTail(result.Output)
		}
		return result
	}
	scan := runDriverCommand(pnputil, "/scan-devices")
	result.ScanExitCode = scan.ExitCode
	result.ScanOutput = scan.Output
	if scan.ExitCode == 3010 {
		result.RebootRequired = true
	}
	if scan.ExitCode != 0 && scan.ExitCode != 3010 && result.Error == "" {
		result.Error = strings.TrimSpace(scan.Err)
		if result.Error == "" {
			result.Error = meaningfulTail(scan.Output)
		}
		return result
	}
	if req.DeviceInstanceID != "" && !result.RebootRequired {
		if port := waitForDeviceCOMPort(req.DeviceInstanceID, driverCOMWaitTimeout); port != "" {
			result.COMPort = port
		} else {
			result.Error = "driver installed, but the matching COM port did not appear after scan-devices"
		}
	} else if req.DeviceInstanceID == "" && !result.RebootRequired {
		result.Error = "driver installed, but the setup tool could not identify the exact USB device to verify the matching COM port"
	}
	return result
}

func driverPackageRoots(pkg *Package, kind string) []string {
	if pkg == nil {
		return nil
	}
	switch normalizeDriverKind(kind) {
	case "cp210x":
		return []string{filepath.Join(pkg.Root, "drivers", "cp210x")}
	case "wch":
		return []string{filepath.Join(pkg.Root, "drivers", "wch")}
	default:
		return nil
	}
}

func findDriverINFRoot(pkg *Package, kind driverKind) (string, error) {
	if pkg == nil {
		return "", fmt.Errorf("setup package is not loaded")
	}
	for _, root := range driverPackageRoots(pkg, string(kind)) {
		if err := validateDriverINFRoot(root); err == nil {
			return root, nil
		} else if dirExists(root) {
			return "", err
		}
	}
	return "", fmt.Errorf("expected a signed INF driver package inside OpenTurbine_Recommended.zip")
}

func validateDriverINFRoot(root string) error {
	if !dirExists(root) {
		return fmt.Errorf("driver folder was not found: %s", root)
	}
	if len(driverINFs(root)) == 0 {
		return fmt.Errorf("driver folder does not contain an INF file: %s", root)
	}
	if len(driverFilesWithExt(root, ".cat")) == 0 {
		return fmt.Errorf("driver folder does not contain a CAT signature file: %s", root)
	}
	if len(driverFilesWithExt(root, ".sys")) == 0 {
		return fmt.Errorf("driver folder does not contain a SYS driver payload: %s", root)
	}
	if len(driverFilesWithExt(root, ".exe")) > 0 && len(driverINFs(root)) == 0 {
		return fmt.Errorf("driver folder contains only installer executables; pass the extracted signed INF/CAT/SYS package")
	}
	return nil
}

func driverINFs(root string) []string {
	return driverFilesWithExt(root, ".inf")
}

func driverFilesWithExt(root, ext string) []string {
	if !dirExists(root) {
		return nil
	}
	var files []string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Ext(path), ext) {
			files = append(files, path)
		}
		return nil
	})
	sort.Strings(files)
	return files
}

func findEsptool(pkg *Package) (string, error) {
	exe, _ := os.Executable()
	base := "."
	if exe != "" {
		base = filepath.Dir(exe)
	}
	names := []string{
		filepath.Join(base, "tools", "esptool.exe"),
		filepath.Join(base, "esptool.exe"),
	}
	if pkg != nil {
		names = append(names,
			filepath.Join(pkg.Root, "tools", "esptool.exe"),
			filepath.Join(pkg.Root, "esptool.exe"),
		)
	}
	for _, n := range names {
		if fileExists(n) {
			return n, nil
		}
	}
	return "", errors.New("USB install needs esptool.exe. The recommended OpenTurbine package should include tools\\esptool.exe, or esptool.exe can be placed next to this app.")
}

func findSerialPorts() []string {
	var ports []string
	cmd := exec.Command("reg", "query", `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM`)
	prepareHiddenCommand(cmd)
	out, err := cmd.CombinedOutput()
	if err == nil {
		re := regexp.MustCompile(`COM\d+`)
		ports = append(ports, re.FindAllString(string(out), -1)...)
	}
	seen := map[string]bool{}
	var unique []string
	for _, p := range ports {
		if !seen[p] {
			seen[p] = true
			unique = append(unique, p)
		}
	}
	sort.Strings(unique)
	return unique
}

func usbDriverRecommendation() string {
	// PnPUtil's connected-device list avoids recommending a driver for an old,
	// disconnected adapter that merely remains in the registry.
	cmd := exec.Command("pnputil", "/enum-devices", "/connected")
	prepareHiddenCommand(cmd)
	out, err := cmd.CombinedOutput()
	if err == nil {
		s := strings.ToUpper(string(out))
		switch {
		case strings.Contains(s, "VID_10C4"):
			return "Windows sees a Silicon Labs CP210x USB bridge. Install the CP210x driver below, then unplug and reconnect the board."
		case strings.Contains(s, "VID_1A86") || strings.Contains(s, "VID_1A2C"):
			return "Windows sees a WCH USB bridge. Install the CH340/CH341/CH343 driver below, then unplug and reconnect the board."
		case strings.Contains(s, "VID_303A"):
			return "Windows sees Espressif native USB. It normally needs no separate driver; try BOOT, another data cable, and another USB port."
		}
	}
	return "Check the USB bridge chip printed near the USB socket: choose CP210x for Silicon Labs CP2102/CP2104, or CH340 for WCH CH340/CH341/CH343. ESP32-S3 native USB normally needs no driver."
}

func prepareEsptoolCommand(cmd *exec.Cmd) {
	cmd.Env = append(os.Environ(),
		"PYTHONIOENCODING=utf-8",
		"PYTHONUTF8=1",
		"NO_COLOR=1",
	)
	prepareHiddenCommand(cmd)
}

func prepareHiddenCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}

func detectBoardWithEsptool(esptool, port string) (detectedBoard, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, esptool, "--port", port, "chip_id")
	prepareEsptoolCommand(cmd)
	out, err := cmd.CombinedOutput()
	return parseDetectedBoard(port, string(out), err)
}

func parseDetectedBoard(port, output string, commandErr error) (detectedBoard, error) {
	s := strings.ToLower(output)
	board := detectedBoard{Port: port}
	// Check every unsupported family before the generic "esp32" match. The old
	// detector classified ESP32-C3 as classic ESP32 and could erase it.
	unsupported := []string{"esp32-c2", "esp32-c3", "esp32-c5", "esp32-c6", "esp32-h2", "esp32-p4", "esp32-s2"}
	for _, chip := range unsupported {
		if strings.Contains(s, chip) || strings.Contains(s, strings.ReplaceAll(chip, "-", "")) {
			board.Chip = strings.ToUpper(chip)
			return board, nil
		}
	}
	if strings.Contains(s, "esp32-s3") || strings.Contains(s, "esp32s3") {
		board.Target, board.Chip = "esp32s3dev", "ESP32-S3"
		return board, nil
	}
	if strings.Contains(s, "esp32") {
		board.Target, board.Chip = "esp32dev", "Classic ESP32"
		return board, nil
	}
	if commandErr == nil {
		commandErr = fmt.Errorf("esptool did not identify an ESP32 family")
	}
	return board, commandErr
}

type esptoolProgressWriter struct {
	mu           sync.Mutex
	output       bytes.Buffer
	last         int
	lastFilePct  float64
	fileIndex    int
	segmentSizes []int64
	progress     func(int)
}

func (w *esptoolProgressWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	_, _ = w.output.Write(p)
	// esptool v5 prints "[bar]  12.3% 123/456 bytes"; older versions used
	// "(12 %)". Accept both and combine per-file progress into one overall
	// percentage because write-flash resets its percentage for every image.
	matches := regexp.MustCompile(`([0-9]{1,3}(?:\.[0-9]+)?)\s*%`).FindAllStringSubmatch(w.output.String(), -1)
	if len(matches) > 0 {
		var filePct float64
		_, _ = fmt.Sscanf(matches[len(matches)-1][1], "%f", &filePct)
		if filePct+1.0 < w.lastFilePct && w.fileIndex+1 < len(w.segmentSizes) {
			w.fileIndex++
		}
		w.lastFilePct = filePct
		percent := int(filePct)
		if len(w.segmentSizes) > 0 {
			var done, total int64
			for i, size := range w.segmentSizes {
				total += size
				if i < w.fileIndex {
					done += size
				} else if i == w.fileIndex {
					done += int64(float64(size) * filePct / 100.0)
				}
			}
			if total > 0 {
				percent = int(done * 100 / total)
			}
		}
		if percent > w.last && percent <= 100 {
			w.last = percent
			if w.progress != nil {
				w.progress(percent)
			}
		}
	}
	return len(p), nil
}

func (w *esptoolProgressWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.output.String()
}

func validStableID(value string, max int) bool {
	if len(value) < 1 || len(value) > max {
		return false
	}
	for i, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') ||
			(i > 0 && (r == '_' || r == '-')) {
			continue
		}
		return false
	}
	return true
}

func (ui *NativeUI) paintPCBProfileChoice(hdc uintptr, w, h int, choices []pcbProfileChoice) {
	card := rect{34, 112, int32(w - 34), int32(h - 78)}
	drawPanel(hdc, card, colPanel, colBorderSoft, 24)
	text(hdc, "Choose the physical board layout. This choice is written at flash time and cannot be changed from the ECU web page.", rect{card.left + 28, card.top + 22, card.right - 28, card.top + 66}, ui.fontBody, colText, dtLeft|dtWordBreak|dtNoPrefix)
	y := card.top + 78
	for _, choice := range choices {
		if y+72 > card.bottom-72 {
			break
		}
		r := rect{card.left + 28, y, card.right - 28, y + 64}
		drawPanel(hdc, r, colPanelSoft, colBorder, 14)
		color := colText
		if !choice.Enabled {
			color = colTextSoft
		}
		text(hdc, choice.Label, rect{r.left + 16, r.top + 9, r.right - 16, r.top + 31}, ui.fontButton, color, dtLeft|dtSingleLine|dtNoPrefix)
		text(hdc, choice.Detail, rect{r.left + 16, r.top + 34, r.right - 16, r.bottom - 7}, ui.fontSmall, colTextMuted, dtLeft|dtWordBreak|dtNoPrefix)
		if choice.Enabled && choice.Action != "" {
			ui.addZone(r, choice.Action)
		}
		y += 72
	}
	cancel := rect{card.left + 28, card.bottom - 56, card.left + 150, card.bottom - 14}
	drawButton(hdc, cancel, "Cancel", ui.fontButton, false)
	ui.addZone(cancel, "cancelUSB")
}

func buildCustomPCBProfile(pkg *Package, target, sourcePath string) (string, []string, error) {
	targetInfo, ok := pkg.Manifest.Targets[target]
	if !ok {
		return "", nil, errors.New("setup package has no matching board target")
	}
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		return "", nil, fmt.Errorf("cannot read custom PCB profile: %w", err)
	}
	var profile sourcePCBProfile
	if err := json.Unmarshal(source, &profile); err != nil {
		return "", nil, fmt.Errorf("custom PCB profile is not valid UTF-8 JSON: %w", err)
	}
	if profile.Format != "openturbine-pcb-profile" || profile.FormatVersion.Major != 1 ||
		profile.FormatVersion.Minor < 0 || profile.FormatVersion.Minor > 255 {
		return "", nil, errors.New("custom PCB profile uses an unsupported format or major version")
	}
	expectedChip := "esp32"
	targetID := byte(1)
	if target == "esp32s3dev" {
		expectedChip, targetID = "esp32-s3", 2
	}
	if profile.Target.Chip != expectedChip {
		return "", nil, fmt.Errorf("custom PCB profile is for %s, but the detected board is %s",
			profile.Target.Chip, expectedChip)
	}
	if !validStableID(profile.Board.ID, 40) || profile.Board.Name == "" ||
		len(profile.Board.Name) > 47 || profile.Board.Revision == "" ||
		len(profile.Board.Revision) > 15 {
		return "", nil, errors.New("custom PCB profile has invalid board identity fields")
	}
	if len(profile.Buses) > 8 || len(profile.Devices) > 24 ||
		len(profile.Ports) < 1 || len(profile.Ports) > 48 {
		return "", nil, errors.New("custom PCB profile exceeds firmware bus, device, or port limits")
	}
	catalogPath, err := packageFile(pkg, "", "pcb_profiles/targets/"+expectedChip+".json")
	if err != nil {
		return "", nil, fmt.Errorf("setup package lacks the %s pin catalog", expectedChip)
	}
	var catalog pcbTargetCatalog
	catalogBytes, readErr := os.ReadFile(catalogPath)
	if readErr != nil || json.Unmarshal(catalogBytes, &catalog) != nil || catalog.Chip != expectedChip {
		return "", nil, fmt.Errorf("setup package has an invalid %s pin catalog", expectedChip)
	}
	validPins, inputOnly, straps := map[int]bool{}, map[int]bool{}, map[int]bool{}
	for _, pin := range catalog.GPIO {
		validPins[pin] = true
	}
	for _, pin := range catalog.InputOnlyGPIO {
		inputOnly[pin] = true
	}
	for _, pin := range catalog.StrappingGPIO {
		straps[pin] = true
	}
	warnings := []string{}
	gpioOwners := map[int]string{}
	checkPin := func(pin int, output bool, owner string) error {
		if pin == -1 {
			return nil
		}
		if !validPins[pin] {
			return fmt.Errorf("%s uses GPIO %d, which does not exist on %s", owner, pin, expectedChip)
		}
		if output && inputOnly[pin] {
			return fmt.Errorf("%s uses input-only GPIO %d as an output", owner, pin)
		}
		if straps[pin] {
			warnings = append(warnings, fmt.Sprintf("%s uses boot-strapping GPIO %d", owner, pin))
		}
		return nil
	}
	claimPin := func(pin int, owner string, sameOwnerOK bool) error {
		if pin == -1 {
			return nil
		}
		if prior, exists := gpioOwners[pin]; exists && !(sameOwnerOK && prior == owner) {
			return fmt.Errorf("GPIO %d is claimed by both %s and %s", pin, prior, owner)
		}
		gpioOwners[pin] = owner
		return nil
	}
	allIDs, busIDs, deviceIDs := map[string]bool{}, map[string]bool{}, map[string]bool{}
	busKinds := map[string]string{}
	claimID := func(id, owner string) error {
		if !validStableID(id, 24) {
			return fmt.Errorf("%s has an invalid stable ID", owner)
		}
		if allIDs[id] {
			return fmt.Errorf("stable ID %q is used more than once", id)
		}
		allIDs[id] = true
		return nil
	}
	for _, bus := range profile.Buses {
		if err := claimID(bus.ID, "bus"); err != nil {
			return "", nil, err
		}
		if bus.Kind != "i2c" && bus.Kind != "spi" && bus.Kind != "uart" && bus.Kind != "onewire" {
			return "", nil, fmt.Errorf("bus %s has unsupported kind %q", bus.ID, bus.Kind)
		}
		if len(bus.Pins) == 0 {
			return "", nil, fmt.Errorf("bus %s has no pins", bus.ID)
		}
		requiredPins := map[string][]string{
			"i2c": {"sda", "scl"}, "spi": {"sck", "miso"},
			"uart": {"tx"}, "onewire": {"data"},
		}[bus.Kind]
		requiredValues := map[int]bool{}
		for _, name := range requiredPins {
			pin, exists := bus.Pins[name]
			if !exists || pin < 0 || requiredValues[pin] {
				return "", nil, fmt.Errorf("bus %s has missing or duplicated required %s pins", bus.ID, bus.Kind)
			}
			requiredValues[pin] = true
		}
		for name, pin := range bus.Pins {
			output := name == "sck" || name == "mosi" || name == "sda" || name == "scl" || name == "tx"
			if err := checkPin(pin, output, "bus "+bus.ID+"."+name); err != nil {
				return "", nil, err
			}
			if err := claimPin(pin, "bus "+bus.ID+"."+name, false); err != nil {
				return "", nil, err
			}
		}
		busIDs[bus.ID] = true
		busKinds[bus.ID] = bus.Kind
	}
	for _, device := range profile.Devices {
		if err := claimID(device.ID, "device"); err != nil {
			return "", nil, err
		}
		if !validStableID(device.Driver, 24) {
			return "", nil, fmt.Errorf("device %s has invalid driver", device.ID)
		}
		if device.Bus != "" && !busIDs[device.Bus] {
			return "", nil, fmt.Errorf("device %s refers to missing bus", device.ID)
		}
		if device.Address != nil && (*device.Address < 0 || *device.Address > 127) {
			return "", nil, fmt.Errorf("device %s has invalid I2C address", device.ID)
		}
		if device.Select.GPIO != nil {
			if err := checkPin(*device.Select.GPIO, true, "device "+device.ID+" select"); err != nil {
				return "", nil, err
			}
			if err := claimPin(*device.Select.GPIO, "device "+device.ID+" select", false); err != nil {
				return "", nil, err
			}
		}
		deviceIDs[device.ID] = true
	}
	checkFixedOutput := func(name string, gpio int, safeDemand *float64, kind string) error {
		if safeDemand == nil || *safeDemand != 0 {
			return fmt.Errorf("fixed function %s requires safe_demand 0", name)
		}
		if name == "status_led" && kind != "" && kind != "gpio" && kind != "neopixel" {
			return errors.New("fixed status LED type must be gpio or neopixel")
		}
		if err := checkPin(gpio, true, "fixed function "+name); err != nil {
			return err
		}
		if err := claimPin(gpio, "fixed function "+name, false); err != nil {
			return err
		}
		return nil
	}
	if fixed := profile.FixedFunctions.StatusLED; fixed != nil {
		if err := checkFixedOutput("status_led", fixed.GPIO, fixed.SafeDemand, fixed.Type); err != nil {
			return "", nil, err
		}
	}
	if fixed := profile.FixedFunctions.Buzzer; fixed != nil {
		if err := checkFixedOutput("buzzer", fixed.GPIO, fixed.SafeDemand, ""); err != nil {
			return "", nil, err
		}
	}
	if fixed := profile.FixedFunctions.ServoOutputEnable; fixed != nil {
		if fixed.ActiveHigh == nil {
			return "", nil, errors.New("fixed function servo_output_enable requires active_high")
		}
		if err := checkFixedOutput("servo_output_enable", fixed.GPIO, fixed.SafeDemand, ""); err != nil {
			return "", nil, err
		}
	}
	if fixed := profile.FixedFunctions.SupplyVoltage; fixed != nil {
		if fixed.Divider < 1 || fixed.Divider > 100 {
			return "", nil, errors.New("fixed function supply_voltage divider must be 1..100")
		}
		if fixed.ReferenceMV != 0 && (fixed.ReferenceMV < 1000 || fixed.ReferenceMV > 5500) {
			return "", nil, errors.New("fixed function supply_voltage reference_mv must be 1000..5500")
		}
		if err := checkPin(fixed.GPIO, false, "fixed function supply_voltage"); err != nil {
			return "", nil, err
		}
		if err := claimPin(fixed.GPIO, "fixed function supply_voltage", false); err != nil {
			return "", nil, err
		}
	}
	for name, serial := range map[string]*struct {
		Bus string `json:"bus"`
	}{
		"cluster_serial": profile.FixedFunctions.ClusterSerial,
		"mavlink":        profile.FixedFunctions.MAVLink,
	} {
		if serial != nil && busKinds[serial.Bus] != "uart" {
			return "", nil, fmt.Errorf("fixed function %s must refer to a UART bus", name)
		}
	}
	knownAdapters := map[string]bool{
		"digital_input": true, "analog_input": true, "pcnt_input": true, "rc_pwm_input": true,
		"pwm_duty_input": true, "spi_thermocouple": true, "onewire_temperature": true,
		"i2c_digital_input": true, "i2c_adc_input": true, "i2c_adc_digital_input": true,
		"i2c_load_cell":  true,
		"digital_output": true, "relay_output": true, "pwm_output": true, "servo_output": true,
		"i2c_digital_output": true,
	}
	deviceChannelOwners := map[string]string{}
	for _, port := range profile.Ports {
		if err := claimID(port.ID, "port"); err != nil {
			return "", nil, err
		}
		if port.Label == "" || len(port.Label) > 31 || len(port.Modes) < 1 || len(port.Modes) > 4 {
			return "", nil, fmt.Errorf("port %s has invalid label or mode count", port.ID)
		}
		modeIDs := map[string]bool{}
		nativeOutputLevels := map[int]bool{}
		for _, mode := range port.Modes {
			if !validStableID(mode.ID, 24) || modeIDs[mode.ID] {
				return "", nil, fmt.Errorf("port %s has invalid or duplicate mode ID", port.ID)
			}
			modeIDs[mode.ID] = true
			if !knownAdapters[mode.Adapter] {
				warnings = append(warnings, fmt.Sprintf("port %s mode %s requires a newer firmware adapter %q", port.ID, mode.ID, mode.Adapter))
			}
			if mode.Device != "" && !deviceIDs[mode.Device] {
				return "", nil, fmt.Errorf("port %s refers to missing device", port.ID)
			}
			if mode.Pull != "" && mode.Pull != "none" && mode.Pull != "up" && mode.Pull != "down" {
				return "", nil, fmt.Errorf("port %s mode %s has invalid pull setting", port.ID, mode.ID)
			}
			if mode.ReferenceMV != 0 && (mode.ReferenceMV < 1000 || mode.ReferenceMV > 5500) {
				return "", nil, fmt.Errorf("port %s mode %s reference_mv must be 1000..5500", port.ID, mode.ID)
			}
			isOutput := strings.HasSuffix(mode.Adapter, "_output") || mode.Adapter == "relay_output" ||
				mode.Adapter == "pwm_output" || mode.Adapter == "servo_output"
			if mode.Endpoint.GPIO != nil {
				if err := checkPin(*mode.Endpoint.GPIO, isOutput, "port "+port.ID+"/"+mode.ID); err != nil {
					return "", nil, err
				}
				if err := claimPin(*mode.Endpoint.GPIO, "port "+port.ID, true); err != nil {
					return "", nil, err
				}
			}
			if mode.Device != "" {
				resource := fmt.Sprintf("%s:%d", mode.Device, mode.Channel)
				if prior, exists := deviceChannelOwners[resource]; exists && prior != port.ID {
					return "", nil, fmt.Errorf("device channel %s is claimed by ports %s and %s", resource, prior, port.ID)
				}
				deviceChannelOwners[resource] = port.ID
			}
			if isOutput && (mode.SafeDemand == nil || *mode.SafeDemand < 0 || *mode.SafeDemand > 1) {
				return "", nil, fmt.Errorf("output port %s/%s has no valid power-on safe demand", port.ID, mode.ID)
			}
			if isOutput && mode.Endpoint.GPIO != nil && !strings.HasPrefix(mode.Adapter, "i2c_") {
				activeHigh := true
				if mode.ActiveHigh != nil {
					activeHigh = *mode.ActiveHigh
				}
				proportional := mode.Adapter == "pwm_output" || mode.Adapter == "servo_output"
				physicalLevel := !activeHigh
				if !proportional {
					physicalLevel = (*mode.SafeDemand >= 0.5) == activeHigh
				}
				pin := *mode.Endpoint.GPIO
				if prior, exists := nativeOutputLevels[pin]; exists && prior != physicalLevel {
					return "", nil, fmt.Errorf("multipurpose port %s output modes disagree on GPIO %d boot-safe level", port.ID, pin)
				}
				nativeOutputLevels[pin] = physicalLevel
			}
		}
	}
	// Re-marshal to a bounded canonical payload; encoding/json sorts map keys in
	// the source object, matching the source-tool container semantics.
	var canonical any
	if err := json.Unmarshal(source, &canonical); err != nil {
		return "", nil, err
	}
	payload, err := json.Marshal(canonical)
	if err != nil {
		return "", nil, err
	}
	payload = append(payload, '\n')
	if len(payload) > 24*1024 || len(payload)+32 > targetInfo.PCBProfile.Size {
		return "", nil, errors.New("custom PCB profile is larger than the firmware or partition limit")
	}
	header := make([]byte, 32)
	copy(header[0:4], []byte("OTPB"))
	header[4] = 1
	header[5] = 1
	header[6] = byte(profile.FormatVersion.Major)
	header[7] = byte(profile.FormatVersion.Minor)
	header[8] = targetID
	header[9] = 1
	binary.LittleEndian.PutUint16(header[10:12], 32)
	binary.LittleEndian.PutUint32(header[12:16], uint32(len(payload)))
	binary.LittleEndian.PutUint32(header[16:20], crc32.ChecksumIEEE(payload))
	out, err := os.CreateTemp(pkg.Root, "custom-pcb-profile-*.bin")
	if err != nil {
		return "", nil, err
	}
	outPath := out.Name()
	if _, err = out.Write(append(header, payload...)); err != nil {
		out.Close()
		os.Remove(outPath)
		return "", nil, err
	}
	if err = out.Close(); err != nil {
		os.Remove(outPath)
		return "", nil, err
	}
	return outPath, warnings, nil
}

func flashUSB(esptool, port, target string, pkg *Package, pcbProfilePath string, logf func(string), progress func(int)) error {
	t, ok := pkg.Manifest.Targets[target]
	if !ok {
		return fmt.Errorf("setup package does not contain files for this board")
	}
	if len(t.USBFlash) == 0 {
		return fmt.Errorf("setup package does not contain USB install instructions")
	}

	args := []string{"--port", port, "--baud", "921600", "write-flash", "-z"}
	entries := append([]FlashEntry(nil), t.USBFlash...)
	if pcbProfilePath != "" {
		entries = append(entries, FlashEntry{Address: t.PCBProfile.Address, File: pcbProfilePath})
	}
	segmentSizes := make([]int64, 0, len(entries))
	seenAddresses := map[string]bool{}
	for _, e := range entries {
		address := strings.ToLower(strings.TrimSpace(e.Address))
		if !regexp.MustCompile(`^0x[0-9a-f]+$`).MatchString(address) {
			return fmt.Errorf("setup package contains invalid flash address %q; board was not erased", e.Address)
		}
		if seenAddresses[address] {
			return fmt.Errorf("setup package contains duplicate flash address %s; board was not erased", address)
		}
		seenAddresses[address] = true
		p := e.File
		if !filepath.IsAbs(p) {
			var err error
			p, err = packageFile(pkg, target, e.File)
			if err != nil {
				return fmt.Errorf("%w; board was not erased", err)
			}
		}
		if e.SHA256 != "" {
			if err := verifySHA256(p, e.SHA256); err != nil {
				return fmt.Errorf("%w; board was not erased", err)
			}
		}
		if info, statErr := os.Stat(p); statErr == nil {
			segmentSizes = append(segmentSizes, info.Size())
		} else {
			segmentSizes = append(segmentSizes, 1)
		}
		args = append(args, address, p)
	}
	logf("Package preflight passed; all flash files are present")

	logf("Erasing board for clean USB install / reinstall")
	eraseCtx, eraseCancel := context.WithTimeout(context.Background(), 4*time.Minute)
	eraseCmd := exec.CommandContext(eraseCtx, esptool, "--port", port, "erase_flash")
	prepareEsptoolCommand(eraseCmd)
	eraseOut, eraseErr := eraseCmd.CombinedOutput()
	eraseCancel()
	if eraseErr != nil {
		return fmt.Errorf("USB erase failed. Hold BOOT on the board and try again. Details: %s", strings.TrimSpace(string(eraseOut)))
	}
	logf("Writing board software over USB")
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, esptool, args...)
	prepareEsptoolCommand(cmd)
	w := &esptoolProgressWriter{progress: progress, segmentSizes: segmentSizes}
	cmd.Stdout = w
	cmd.Stderr = w
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("USB install failed. Hold BOOT on the board and try again. Details: %s", strings.TrimSpace(w.String()))
	}
	if progress != nil {
		progress(100)
	}
	return nil
}

func packageFile(pkg *Package, target, name string) (string, error) {
	if strings.TrimSpace(name) == "" {
		return "", fmt.Errorf("setup package has a missing file name")
	}
	tries := []string{}
	if target != "" {
		tries = append(tries, filepath.Join(pkg.Root, target, filepath.FromSlash(name)))
	}
	tries = append(tries, filepath.Join(pkg.Root, filepath.FromSlash(name)))
	for _, p := range tries {
		if fileExists(p) {
			return p, nil
		}
	}
	return "", fmt.Errorf("setup package is missing %s", name)
}

func verifySHA256(path, expected string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	got := hex.EncodeToString(h.Sum(nil))
	expected = strings.ToLower(strings.TrimSpace(expected))
	if got != expected {
		return fmt.Errorf("setup package checksum failed for %s", filepath.Base(path))
	}
	return nil
}

func chooseTargetForOTA(pkg *Package) (string, error) {
	target, err := detectTargetFromDeviceInfo()
	if err == nil && target != "" {
		if _, ok := pkg.Manifest.Targets[target]; ok {
			return target, nil
		}
	}
	// Older OpenTurbine builds predate /api/device_info but expose the build
	// platform in /api/hardware. Use that read-only identity before suggesting
	// an erasing USB reinstall.
	target, err = detectTargetFromHardware()
	if err == nil && target != "" {
		if _, ok := pkg.Manifest.Targets[target]; ok {
			return target, nil
		}
	}
	if strings.TrimSpace(pkg.Manifest.FirmwareOTA) != "" {
		return "", nil
	}
	if len(pkg.Manifest.Targets) == 1 {
		for k := range pkg.Manifest.Targets {
			return k, nil
		}
	}
	return "", errors.New("target not known")
}

func targetFromIdentity(target, chip string) (string, error) {
	t := strings.ToLower(strings.TrimSpace(target))
	if t == "esp32dev" || t == "esp32s3dev" {
		return t, nil
	}
	chip = strings.ToLower(strings.TrimSpace(chip))
	if strings.Contains(chip, "s3") {
		return "esp32s3dev", nil
	}
	if strings.Contains(chip, "esp32-c3") || strings.Contains(chip, "esp32-c6") ||
		strings.Contains(chip, "esp32-s2") || strings.Contains(chip, "esp32-h2") {
		return "", fmt.Errorf("unsupported ESP chip")
	}
	if strings.Contains(chip, "esp32") {
		return "esp32dev", nil
	}
	return "", fmt.Errorf("unknown target")
}

func detectTargetFromDeviceInfo() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", ecuBaseURL+"/api/device_info", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("device_info returned %s", resp.Status)
	}
	var v struct {
		Target string `json:"target"`
		Chip   string `json:"chip"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return "", err
	}
	return targetFromIdentity(v.Target, v.Chip)
}

func detectTargetFromHardware() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", ecuBaseURL+"/api/hardware", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("hardware identity returned %s", resp.Status)
	}
	var v struct {
		Platform string `json:"platform"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return "", err
	}
	switch strings.ToLower(strings.TrimSpace(v.Platform)) {
	case "esp32s3", "esp32-s3", "esp32s3dev":
		return "esp32s3dev", nil
	case "esp32", "esp32dev":
		return "esp32dev", nil
	default:
		return "", fmt.Errorf("unknown hardware platform")
	}
}

func firmwarePath(pkg *Package, target string) (string, error) {
	if target != "" {
		if t, ok := pkg.Manifest.Targets[target]; ok && t.FirmwareOTA != "" {
			return packageFile(pkg, target, t.FirmwareOTA)
		}
	}
	if pkg.Manifest.FirmwareOTA != "" {
		return packageFile(pkg, "", pkg.Manifest.FirmwareOTA)
	}
	if target != "" {
		if p, err := packageFile(pkg, target, "firmware.bin"); err == nil {
			return p, nil
		}
	}
	if p, err := packageFile(pkg, "", "firmware.bin"); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("setup package is missing the board software file")
}

func webAssetPaths(pkg *Package, target string) ([]string, error) {
	var root string
	if target != "" {
		if t, ok := pkg.Manifest.Targets[target]; ok && t.WebAssets != "" {
			p := filepath.Join(pkg.Root, target, filepath.FromSlash(t.WebAssets))
			if fileExists(p) {
				return extractAssetsZipIfNeeded(p)
			}
			if dirExists(p) {
				root = p
			}
			if root == "" {
				p = filepath.Join(pkg.Root, filepath.FromSlash(t.WebAssets))
				if fileExists(p) {
					return extractAssetsZipIfNeeded(p)
				}
				if dirExists(p) {
					root = p
				}
			}
		}
	}
	if root == "" && pkg.Manifest.WebAssets != "" {
		p := filepath.Join(pkg.Root, filepath.FromSlash(pkg.Manifest.WebAssets))
		if fileExists(p) {
			return extractAssetsZipIfNeeded(p)
		}
		if dirExists(p) {
			root = p
		}
	}
	if root == "" && target != "" {
		root = filepath.Join(pkg.Root, target)
	}
	if root == "" || !dirExists(root) {
		root = pkg.Root
	}
	var paths []string
	for _, name := range webAssets {
		p := filepath.Join(root, name)
		if !fileExists(p) {
			return nil, fmt.Errorf("setup package is missing dashboard file %s", name)
		}
		paths = append(paths, p)
	}
	return paths, nil
}

func extractAssetsZipIfNeeded(zipPath string) ([]string, error) {
	if !strings.HasSuffix(strings.ToLower(zipPath), ".zip") {
		return nil, fmt.Errorf("dashboard files entry is not a folder or .zip")
	}
	root := filepath.Join(os.TempDir(), "openturbine_assets_"+fmt.Sprintf("%d", time.Now().UnixNano()))
	if err := unzip(zipPath, root); err != nil {
		return nil, err
	}
	var paths []string
	for _, name := range webAssets {
		p := filepath.Join(root, name)
		if !fileExists(p) {
			return nil, fmt.Errorf("dashboard package is missing %s", name)
		}
		paths = append(paths, p)
	}
	return paths, nil
}

func waitForECU(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		req, _ := http.NewRequestWithContext(ctx, "GET", ecuBaseURL+"/", nil)
		resp, err := http.DefaultClient.Do(req)
		cancel()
		if err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 600 {
				return nil
			}
		} else {
			last = err
		}
		time.Sleep(2 * time.Second)
	}
	if last != nil {
		return last
	}
	return fmt.Errorf("board did not respond")
}

func checkSafeStatus() error {
	mode, statusErr := fetchECUMode("/api/status")
	if statusErr != nil || mode == "" {
		// Compatibility path for releases older than /api/status.
		mode, statusErr = fetchECUMode("/api/data")
	}
	if statusErr != nil || mode == "" {
		return fmt.Errorf("The tool could not verify that the engine is stopped, so the update was not started. Open the Dashboard, confirm the ECU is in STANDBY or FAULT, then try again. Details: %v", statusErr)
	}
	if mode != "STANDBY" && mode != "FAULT" {
		return fmt.Errorf("The board reports %s. Stop the engine and wait for STANDBY (or FAULT) before updating.", mode)
	}
	return nil
}

func fetchECUMode(path string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", ecuBaseURL+path, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("%s returned %s", path, resp.Status)
	}
	var payload struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("%s returned invalid status data: %w", path, err)
	}
	mode := strings.ToUpper(strings.TrimSpace(payload.Mode))
	if mode == "" {
		return "", fmt.Errorf("%s did not report engine mode", path)
	}
	return mode, nil
}

func backupConfig() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", ecuBaseURL+"/api/ecu_config", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("backup returned %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
	if err != nil {
		return "", fmt.Errorf("could not read engine file backup: %w", err)
	}
	if len(data) > 2*1024*1024 {
		return "", fmt.Errorf("engine file backup is unexpectedly large")
	}
	var engineFile struct {
		Hardware json.RawMessage `json:"hardware"`
		Settings json.RawMessage `json:"settings"`
	}
	if err := json.Unmarshal(data, &engineFile); err != nil {
		return "", fmt.Errorf("board returned an invalid engine file: %w", err)
	}
	validSection := func(raw json.RawMessage) bool {
		trimmed := strings.TrimSpace(string(raw))
		return len(trimmed) >= 2 && strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")
	}
	if !validSection(engineFile.Hardware) || !validSection(engineFile.Settings) {
		return "", fmt.Errorf("board backup is incomplete: hardware or settings section is missing")
	}
	var hardwareIdentity, settingsIdentity struct {
		ProfileID string `json:"profile_id"`
	}
	if json.Unmarshal(engineFile.Hardware, &hardwareIdentity) != nil ||
		json.Unmarshal(engineFile.Settings, &settingsIdentity) != nil ||
		hardwareIdentity.ProfileID == "" || hardwareIdentity.ProfileID != settingsIdentity.ProfileID {
		return "", fmt.Errorf("board backup has missing or mismatched engine profile IDs")
	}
	dir := filepath.Join(backupDir(), time.Now().Format("2006-01-02_15-04-05"))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	p := filepath.Join(dir, "ecu_config.json")
	f, err := os.Create(p)
	if err != nil {
		return "", err
	}
	_, copyErr := f.Write(data)
	closeErr := f.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	note := "This complete engine file contains the OpenTurbine board Wi-Fi password. Keep it private.\r\n"
	_ = os.WriteFile(filepath.Join(dir, "README.txt"), []byte(note), 0644)
	return p, nil
}

func postMultipartFilesWithProgress(url string, paths []string, timeout time.Duration, progress func(done, total int64)) error {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, path := range paths {
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		fw, err := mw.CreateFormFile("file", filepath.Base(path))
		if err != nil {
			f.Close()
			return err
		}
		_, copyErr := io.Copy(fw, f)
		f.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	if err := mw.Close(); err != nil {
		return err
	}
	client := &http.Client{Timeout: timeout}
	reader := &uploadProgressReader{r: bytes.NewReader(body.Bytes()), total: int64(body.Len()), progress: progress, last: time.Now().Add(-time.Second)}
	req, err := http.NewRequest("POST", url, reader)
	if err != nil {
		return err
	}
	req.ContentLength = int64(body.Len())
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("board returned %s: %s", resp.Status, strings.TrimSpace(string(respBody)))
	}
	return nil
}

type uploadProgressReader struct {
	r        *bytes.Reader
	total    int64
	done     int64
	progress func(done, total int64)
	last     time.Time
}

func (r *uploadProgressReader) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	if n > 0 {
		r.done += int64(n)
		if r.progress != nil && (time.Since(r.last) > 250*time.Millisecond || r.done >= r.total) {
			r.progress(r.done, r.total)
			r.last = time.Now()
		}
	}
	return n, err
}

func fileExists(p string) bool { st, err := os.Stat(p); return err == nil && !st.IsDir() }
func dirExists(p string) bool  { st, err := os.Stat(p); return err == nil && st.IsDir() }

func setupToolDataDir() string {
	if p := os.Getenv("LOCALAPPDATA"); p != "" {
		return filepath.Join(p, "OpenTurbine", "SetupTool")
	}
	return filepath.Join(userDocumentsDir(), "OpenTurbine", "SetupTool")
}

func userDocumentsDir() string {
	if p := os.Getenv("USERPROFILE"); p != "" {
		return filepath.Join(p, "Documents")
	}
	if p := os.Getenv("HOME"); p != "" {
		return filepath.Join(p, "Documents")
	}
	return "."
}
func backupDir() string { return filepath.Join(userDocumentsDir(), "OpenTurbine", "Backups") }
