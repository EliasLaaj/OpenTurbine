//go:build windows

package main

import (
	"os/exec"
	"regexp"
	"strings"
)

type driverKind string

const (
	driverCP210x          driverKind = "cp210x"
	driverWCH             driverKind = "wch"
	driverEspressifNative driverKind = "espressif-native"
	driverUnknown         driverKind = "unknown"
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

type driverCommandResult struct {
	ExitCode int
	Output   string
	Err      string
}

var driverCommandRunner = runHiddenDriverCommand

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
				Message: "Windows detected a Silicon Labs CP210x USB bridge.\n\nOpen the official CP210x driver page below.",
				Detail:  "Detected hardware ID: " + strings.Join(d.HardwareIDs, ", "),
				Choices: []driverChoice{{Kind: driverCP210x, Label: "Official CP210x driver"}},
				Device:  d,
			}
		case driverWCH:
			return driverRecommendation{
				Message: "Windows detected a WCH USB serial bridge.\n\nOpen the official WCH driver page below.",
				Detail:  "Detected hardware ID: " + strings.Join(d.HardwareIDs, ", "),
				Choices: []driverChoice{{Kind: driverWCH, Label: "Official WCH driver"}},
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
		Choices: []driverChoice{{Kind: driverCP210x, Label: "Official CP210x driver"}, {Kind: driverWCH, Label: "Official WCH driver"}},
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
		recommendation.Message += "\n\nWindows has not assigned this connected bridge a COM port yet. Open the matching official driver page below, then reconnect the board and try again."
		recommendation.Detail += "\n\nNo COM port is assigned to this detected USB bridge. Any other COM port shown by Windows may belong to a different device."
		return recommendation
	}
	fallback := bootloaderNoAnswerDriverRecommendation()
	// A COM port proves that a serial driver is loaded, not that the correct
	// bridge driver is healthy. Keep repair available after a failed ESP probe.
	if kind == driverCP210x || kind == driverWCH {
		fallback.Message += "\n\nIf BOOT/RESET and closing other serial apps do not help, open the detected bridge's official driver page below."
		fallback.Detail += "\n\nDetected hardware ID: " +
			strings.Join(recommendation.Device.HardwareIDs, ", ")
		fallback.Choices = recommendation.Choices
		fallback.Device = recommendation.Device
	} else {
		fallback.Message += "\n\nYou can also open the correct official driver page below after checking the chip or USB VID."
		fallback.Choices = []driverChoice{
			{Kind: driverCP210x, Label: "Official CP210x driver"},
			{Kind: driverWCH, Label: "Official WCH driver"},
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
