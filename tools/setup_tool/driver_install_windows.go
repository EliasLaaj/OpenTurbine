//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type driverKind string

const (
	driverCP210x          driverKind = "cp210x"
	driverWCH             driverKind = "wch"
	driverEspressifNative driverKind = "espressif-native"
	driverUnknown         driverKind = "unknown"

	errorSuccessRebootRequired = 3010
	errorCancelled             = 1223
)

type usbBridgeDevice struct {
	InstanceID   string
	HardwareIDs  []string
	FriendlyName string
	ClassName    string
	PortName     string
	ProblemCode  uint32
	DriverKind   driverKind
}

type driverRecommendation struct {
	Message string
	Detail  string
	Choices []driverChoice
	Device  usbBridgeDevice
}

type driverInstallRequest struct {
	Kind             driverKind
	DriverRoot       string
	DeviceInstanceID string
	HardwareIDs      []string
	ResultPath       string
	LogPath          string
}

type driverCommandResult struct {
	ExitCode int
	Output   string
	Err      string
}

type shellExecuteInfo struct {
	cbSize       uint32
	fMask        uint32
	hwnd         uintptr
	lpVerb       *uint16
	lpFile       *uint16
	lpParameters *uint16
	lpDirectory  *uint16
	nShow        int32
	hInstApp     uintptr
	lpIDList     uintptr
	lpClass      *uint16
	hkeyClass    uintptr
	dwHotKey     uint32
	hIcon        uintptr
	hProcess     uintptr
}

var (
	procShellExecuteExW     = shell32.NewProc("ShellExecuteExW")
	procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
	procGetExitCodeProcess  = kernel32.NewProc("GetExitCodeProcess")
	procCloseHandle         = kernel32.NewProc("CloseHandle")
	driverCommandRunner     = runHiddenDriverCommand
	driverCOMWaitTimeout    = 15 * time.Second
)

const (
	seeMaskNoCloseProcess = 0x00000040
	infiniteWait          = 0xFFFFFFFF
)

func normalizeDriverKind(kind string) driverKind {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "cp210x", "silabs", "silicon-labs":
		return driverCP210x
	case "wch", "ch340", "ch341", "ch343", "ch910x":
		return driverWCH
	case "espressif-native", "native", "esp-usb":
		return driverEspressifNative
	case "":
		return ""
	default:
		return driverKind(strings.ToLower(strings.TrimSpace(kind)))
	}
}

func driverKindLabel(kind driverKind) string {
	switch normalizeDriverKind(string(kind)) {
	case driverCP210x:
		return "CP210x"
	case driverWCH:
		return "WCH CH340/CH341/CH343"
	case driverEspressifNative:
		return "Espressif native USB"
	default:
		return "USB serial"
	}
}

func detectUSBDriverRecommendation() driverRecommendation {
	devices := detectUSBBridgeDevices()
	for _, d := range devices {
		switch d.DriverKind {
		case driverCP210x:
			return driverRecommendation{
				Message: "Windows detected a Silicon Labs CP210x USB bridge.\n\nUse the CP210x driver installer below.",
				Detail:  "Detected hardware ID: " + strings.Join(d.HardwareIDs, ", "),
				Choices: []driverChoice{{Kind: driverCP210x, Label: "Install CP210x"}},
				Device:  d,
			}
		case driverWCH:
			return driverRecommendation{
				Message: "Windows detected a WCH USB serial bridge.\n\nUse the WCH driver installer below.",
				Detail:  "Detected hardware ID: " + strings.Join(d.HardwareIDs, ", "),
				Choices: []driverChoice{{Kind: driverWCH, Label: "Install WCH"}},
				Device:  d,
			}
		case driverEspressifNative:
			return driverRecommendation{
				Message: "Windows detected Espressif native USB. No CP210x or WCH driver is required.\n\nTry another data cable/port and use BOOT/RESET as instructed.",
				Detail:  "Detected hardware ID: " + strings.Join(d.HardwareIDs, ", "),
				Choices: nil,
				Device:  d,
			}
		}
	}
	return driverRecommendation{
		Message: "Windows did not expose a known OpenTurbine USB bridge hardware ID. Check the USB bridge chip printed near the USB socket.\n\nAdvanced: choose CP210x only for Silicon Labs VID_10C4. Choose WCH only for VID_1A86 or VID_1A2C.",
		Detail:  "CP210x is for Silicon Labs USB bridges (VID_10C4). WCH is for CH340/CH341/CH343 bridges (VID_1A86 or VID_1A2C). Espressif native USB (VID_303A) does not use these drivers.",
		Choices: []driverChoice{{Kind: driverCP210x, Label: "Install CP210x"}, {Kind: driverWCH, Label: "Install WCH"}},
	}
}

func bootloaderNoAnswerDriverRecommendation() driverRecommendation {
	return driverRecommendation{
		Message: "A COM port already exists, so the USB serial driver is probably working.\n\nDo not install another driver first. Hold BOOT, tap EN/RESET, try a direct data cable, and close any other serial monitor using the port.",
		Detail:  "Driver installation is only useful when Windows does not create a COM port for the connected board.",
		Choices: nil,
	}
}

// bootloaderFailureDriverRecommendation keeps the driver path available when
// Windows can identify the connected bridge but has not assigned that bridge a
// COM port. findSerialPorts may include an unrelated Bluetooth/modem COM port;
// that must not hide the CP210x/WCH installer from a fresh Windows machine.
func bootloaderFailureDriverRecommendation(recommendation driverRecommendation) driverRecommendation {
	kind := normalizeDriverKind(string(recommendation.Device.DriverKind))
	if (kind == driverCP210x || kind == driverWCH) &&
		strings.TrimSpace(recommendation.Device.InstanceID) != "" &&
		strings.TrimSpace(recommendation.Device.PortName) == "" {
		recommendation.Message += "\n\nWindows has not assigned this connected bridge a COM port yet. Install the matching driver below, then reconnect the board and try again."
		recommendation.Detail += "\n\nNo COM port is assigned to this detected USB bridge. Any other COM port shown by Windows may belong to a different device."
		return recommendation
	}
	fallback := bootloaderNoAnswerDriverRecommendation()
	// A COM port proves that a serial driver is loaded, not that the correct
	// bridge driver is healthy. Keep repair available after a failed ESP probe.
	if kind == driverCP210x || kind == driverWCH {
		fallback.Message += "\n\nIf BOOT/RESET and closing other serial apps do not help, reinstall or repair the detected bridge driver below."
		fallback.Detail += "\n\nDetected hardware ID: " +
			strings.Join(recommendation.Device.HardwareIDs, ", ")
		fallback.Choices = recommendation.Choices
		fallback.Device = recommendation.Device
	} else {
		fallback.Message += "\n\nYou can also repair the USB bridge driver manually below after checking the chip or USB VID."
		fallback.Choices = []driverChoice{
			{Kind: driverCP210x, Label: "Repair CP210x"},
			{Kind: driverWCH, Label: "Repair WCH"},
		}
	}
	return fallback
}

func detectUSBBridgeDevices() []usbBridgeDevice {
	result := runDriverCommand("pnputil", "/enum-devices", "/connected", "/ids")
	if result.ExitCode != 0 || strings.TrimSpace(result.Output) == "" {
		return nil
	}
	return parseUSBBridgeDevices(result.Output)
}

func parseUSBBridgeDevices(output string) []usbBridgeDevice {
	var devices []usbBridgeDevice
	for _, block := range splitPNPBlocks(output) {
		ids := hardwareIDsFromText(block)
		if len(ids) == 0 {
			continue
		}
		kind := driverUnknown
		for _, id := range ids {
			if k := driverKindForHardwareID(id); k != driverUnknown {
				kind = k
				break
			}
		}
		if kind == driverUnknown {
			continue
		}
		d := usbBridgeDevice{
			InstanceID:   ids[0],
			HardwareIDs:  ids,
			FriendlyName: labeledPNPValue(block, "description"),
			ClassName:    labeledPNPValue(block, "class"),
			DriverKind:   kind,
		}
		if d.FriendlyName == "" {
			d.FriendlyName = labeledPNPValue(block, "name")
		}
		d.PortName = deviceCOMPort(d.InstanceID)
		devices = append(devices, d)
	}
	return devices
}

func splitPNPBlocks(output string) []string {
	output = strings.ReplaceAll(output, "\r\n", "\n")
	raw := regexp.MustCompile(`\n\s*\n`).Split(output, -1)
	var blocks []string
	for _, block := range raw {
		if strings.TrimSpace(block) != "" {
			blocks = append(blocks, block)
		}
	}
	if len(blocks) == 0 && strings.TrimSpace(output) != "" {
		blocks = []string{output}
	}
	return blocks
}

func hardwareIDsFromText(s string) []string {
	re := regexp.MustCompile(`(?i)(USB|USBSTOR|ROOT)\\VID_[0-9A-F]{4}(?:&PID_[0-9A-F]{4})?(?:\\[^\s]+)?`)
	seen := map[string]bool{}
	var ids []string
	for _, match := range re.FindAllString(s, -1) {
		id := strings.ToUpper(strings.TrimSpace(match))
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}

func driverKindForHardwareID(id string) driverKind {
	upper := strings.ToUpper(id)
	switch {
	case strings.Contains(upper, "VID_10C4"):
		return driverCP210x
	case strings.Contains(upper, "VID_1A86") || strings.Contains(upper, "VID_1A2C"):
		return driverWCH
	case strings.Contains(upper, "VID_303A"):
		return driverEspressifNative
	default:
		return driverUnknown
	}
}

func labeledPNPValue(block, label string) string {
	for _, line := range strings.Split(block, "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(parts[0]))
		if strings.Contains(key, label) {
			return strings.TrimSpace(parts[1])
		}
	}
	return ""
}

func buildDriverInstallRequest(app *App, kind driverKind, driverRoot string, device usbBridgeDevice) (driverInstallRequest, error) {
	if app == nil {
		return driverInstallRequest{}, fmt.Errorf("setup tool data folder is unavailable")
	}
	if device.DriverKind != "" && device.DriverKind != driverUnknown && device.DriverKind != kind {
		return driverInstallRequest{}, fmt.Errorf("connected USB bridge is %s, not %s", driverKindLabel(device.DriverKind), driverKindLabel(kind))
	}
	root, err := filepath.Abs(driverRoot)
	if err != nil {
		return driverInstallRequest{}, err
	}
	root = filepath.Clean(root)
	if err := validateDriverINFRoot(root); err != nil {
		return driverInstallRequest{}, err
	}
	logDir := filepath.Join(app.workDir, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return driverInstallRequest{}, err
	}
	stamp := time.Now().Format("20060102-150405")
	base := fmt.Sprintf("driver-install-%s-%s", kind, stamp)
	resultPath, err := filepath.Abs(filepath.Join(logDir, base+".json"))
	if err != nil {
		return driverInstallRequest{}, err
	}
	logPath, err := filepath.Abs(filepath.Join(logDir, base+".txt"))
	if err != nil {
		return driverInstallRequest{}, err
	}
	instanceID := strings.TrimSpace(device.InstanceID)
	if instanceID != "" {
		instanceID = filepath.Clean(instanceID)
	}
	return driverInstallRequest{
		Kind:             kind,
		DriverRoot:       root,
		DeviceInstanceID: instanceID,
		HardwareIDs:      append([]string(nil), device.HardwareIDs...),
		ResultPath:       filepath.Clean(resultPath),
		LogPath:          filepath.Clean(logPath),
	}, nil
}

func buildINFHelperArgs(req driverInstallRequest) []string {
	args := []string{
		"--install-inf-driver",
		"--driver-kind", string(req.Kind),
		"--driver-root", req.DriverRoot,
	}
	if req.DeviceInstanceID != "" && req.DeviceInstanceID != "." {
		args = append(args, "--device-instance-id", req.DeviceInstanceID)
	}
	for _, id := range req.HardwareIDs {
		args = append(args, "--hardware-id", id)
	}
	args = append(args, "--result", req.ResultPath, "--log", req.LogPath)
	return args
}

func runElevatedINFDriverHelper(exe string, req driverInstallRequest) (driverInstallResult, error) {
	_ = os.Remove(req.ResultPath)
	args := buildINFHelperArgs(req)
	params := escapeCommandArgs(args)
	sei := shellExecuteInfo{
		cbSize:       uint32(unsafe.Sizeof(shellExecuteInfo{})),
		fMask:        seeMaskNoCloseProcess,
		lpVerb:       utf16Ptr("runas"),
		lpFile:       utf16Ptr(exe),
		lpParameters: utf16Ptr(params),
		lpDirectory:  utf16Ptr(filepath.Dir(exe)),
		nShow:        0,
	}
	ret, _, callErr := procShellExecuteExW.Call(uintptr(unsafe.Pointer(&sei)))
	if ret == 0 {
		errText := callErr.Error()
		if errno, ok := callErr.(syscall.Errno); ok && errno == errorCancelled {
			errText = "administrator permission was cancelled"
		}
		return driverInstallResult{Kind: req.Kind, DriverRoot: req.DriverRoot, DeviceInstanceID: req.DeviceInstanceID, HardwareIDs: req.HardwareIDs, LogPath: req.LogPath, Error: errText, ExitCode: int(errorCancelled)}, fmt.Errorf(errText)
	}
	if sei.hProcess != 0 {
		defer procCloseHandle.Call(sei.hProcess)
		procWaitForSingleObject.Call(sei.hProcess, infiniteWait)
		var exitCode uint32
		procGetExitCodeProcess.Call(sei.hProcess, uintptr(unsafe.Pointer(&exitCode)))
	}
	result, err := waitForDriverInstallResult(req.ResultPath, 10*time.Second)
	if result.LogPath == "" {
		result.LogPath = req.LogPath
	}
	if err != nil {
		result.Kind = req.Kind
		result.DriverRoot = req.DriverRoot
		result.DeviceInstanceID = req.DeviceInstanceID
		result.HardwareIDs = append([]string(nil), req.HardwareIDs...)
		result.Error = err.Error()
		return result, err
	}
	return result, nil
}

func escapeCommandArgs(args []string) string {
	escaped := make([]string, 0, len(args))
	for _, arg := range args {
		escaped = append(escaped, syscall.EscapeArg(arg))
	}
	return strings.Join(escaped, " ")
}

func runDriverCommand(name string, args ...string) driverCommandResult {
	return driverCommandRunner(name, args...)
}

func runHiddenDriverCommand(name string, args ...string) driverCommandResult {
	cmd := exec.Command(name, args...)
	prepareHiddenCommand(cmd)
	out, err := cmd.CombinedOutput()
	result := driverCommandResult{Output: strings.TrimSpace(string(out))}
	if exitErr, ok := err.(*exec.ExitError); ok {
		result.ExitCode = exitErr.ExitCode()
		result.Err = exitErr.Error()
	} else if err != nil {
		result.ExitCode = 1
		result.Err = err.Error()
	} else {
		result.ExitCode = 0
	}
	return result
}

func waitForDeviceCOMPort(instanceID string, timeout time.Duration) string {
	if strings.TrimSpace(instanceID) == "" {
		return ""
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if port := deviceCOMPort(instanceID); port != "" {
			return port
		}
		time.Sleep(500 * time.Millisecond)
	}
	return ""
}

func deviceCOMPort(instanceID string) string {
	if strings.TrimSpace(instanceID) == "" {
		return ""
	}
	key := `HKLM\SYSTEM\CurrentControlSet\Enum\` + strings.Trim(instanceID, `\`) + `\Device Parameters`
	result := runDriverCommand("reg", "query", key, "/v", "PortName")
	if result.ExitCode != 0 {
		return ""
	}
	re := regexp.MustCompile(`(?i)\bCOM\d+\b`)
	return strings.ToUpper(re.FindString(result.Output))
}

func driverInstallError(result driverInstallResult) error {
	if result.ExitCode != 0 && result.ExitCode != errorSuccessRebootRequired {
		msg := strings.TrimSpace(result.Error)
		if msg == "" {
			msg = meaningfulTail(result.Output)
		}
		if msg == "" {
			msg = fmt.Sprintf("pnputil exited with code %d", result.ExitCode)
		}
		return fmt.Errorf("%s", msg)
	}
	if result.RebootRequired {
		return nil
	}
	if strings.TrimSpace(result.Error) != "" {
		return fmt.Errorf("%s", result.Error)
	}
	if result.COMPort == "" {
		return fmt.Errorf("driver installed, but the matching COM port was not verified")
	}
	return nil
}

func resultSummary(result driverInstallResult) string {
	var b strings.Builder
	b.WriteString("Driver result")
	if result.Kind != "" {
		b.WriteString(" (" + string(result.Kind) + ")")
	}
	b.WriteString(fmt.Sprintf(": exit=%d", result.ExitCode))
	if result.ScanExitCode != 0 {
		b.WriteString(fmt.Sprintf(", scan=%d", result.ScanExitCode))
	}
	if result.RebootRequired {
		b.WriteString(", reboot-required")
	}
	if result.COMPort != "" {
		b.WriteString(", port=" + result.COMPort)
	}
	if result.Error != "" {
		b.WriteString(", error=" + result.Error)
	}
	if result.LogPath != "" {
		b.WriteString(", log=" + result.LogPath)
	}
	return b.String()
}

func meaningfulTail(s string) string {
	lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(s), "\r\n", "\n"), "\n")
	var kept []string
	for _, line := range lines {
		t := strings.TrimSpace(line)
		if t == "" || strings.EqualFold(t, "Microsoft PnP Utility") {
			continue
		}
		kept = append(kept, t)
	}
	if len(kept) > 5 {
		kept = kept[len(kept)-5:]
	}
	return strings.Join(kept, "\n")
}

func formatDriverDiagnosticText(result driverInstallResult) string {
	var b strings.Builder
	b.WriteString("OpenTurbine Setup Tool " + appVersion + "\r\n")
	b.WriteString("Driver installation diagnostics\r\n\r\n")
	b.WriteString("Kind: " + string(result.Kind) + "\r\n")
	b.WriteString("Driver root: " + result.DriverRoot + "\r\n")
	b.WriteString("Device instance ID: " + result.DeviceInstanceID + "\r\n")
	b.WriteString("Hardware IDs: " + strings.Join(result.HardwareIDs, ", ") + "\r\n")
	b.WriteString(fmt.Sprintf("Exit code: %d\r\n", result.ExitCode))
	b.WriteString(fmt.Sprintf("Scan exit code: %d\r\n", result.ScanExitCode))
	b.WriteString(fmt.Sprintf("Reboot required: %t\r\n", result.RebootRequired))
	b.WriteString("COM port: " + result.COMPort + "\r\n")
	b.WriteString("Current user: " + currentUserSummary() + "\r\n")
	b.WriteString("OS/arch: windows/" + runtime.GOARCH + "\r\n")
	b.WriteString("\r\nINF paths:\r\n")
	for _, inf := range result.INFPaths {
		b.WriteString("  " + inf + "\r\n")
	}
	b.WriteString("\r\nDriver file hashes:\r\n")
	for _, line := range driverFileHashes(result.DriverRoot) {
		b.WriteString("  " + line + "\r\n")
	}
	b.WriteString("\r\nPnPUtil add-driver output:\r\n")
	b.WriteString(result.Output + "\r\n")
	b.WriteString("\r\nPnPUtil scan-devices output:\r\n")
	b.WriteString(result.ScanOutput + "\r\n")
	if result.Error != "" {
		b.WriteString("\r\nError:\r\n" + result.Error + "\r\n")
	}
	b.WriteString("\r\nWindows SetupAPI log: %WINDIR%\\INF\\setupapi.dev.log\r\n")
	return b.String()
}

func currentUserSummary() string {
	u, err := user.Current()
	if err != nil || u == nil {
		return os.Getenv("USERDOMAIN") + `\` + os.Getenv("USERNAME")
	}
	return u.Username
}

func driverFileHashes(root string) []string {
	var files []string
	for _, ext := range []string{".inf", ".cat", ".sys"} {
		files = append(files, driverFilesWithExt(root, ext)...)
	}
	sort.Strings(files)
	var lines []string
	for _, file := range files {
		if sum, err := fileSHA256(file); err == nil {
			lines = append(lines, fmt.Sprintf("%s  %s", sum, file))
		}
	}
	return lines
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func writeDriverResultJSON(path string, result driverInstallResult) error {
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
