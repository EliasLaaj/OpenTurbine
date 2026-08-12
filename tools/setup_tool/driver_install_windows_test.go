//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDriverKindForHardwareIDs(t *testing.T) {
	tests := map[string]driverKind{
		`USB\VID_10C4&PID_EA60\0001`: driverCP210x,
		`USB\VID_1A86&PID_7523\5&1`:  driverWCH,
		`USB\VID_1A2C&PID_0002\5&1`:  driverWCH,
		`USB\VID_303A&PID_1001\5&1`:  driverEspressifNative,
		`USB\VID_1234&PID_5678\5&1`:  driverUnknown,
	}
	for id, want := range tests {
		if got := driverKindForHardwareID(id); got != want {
			t.Fatalf("%s: got %s, want %s", id, got, want)
		}
	}
}

func TestParseUSBBridgeDevicesFromPnPUtilOutput(t *testing.T) {
	oldRunner := driverCommandRunner
	defer func() { driverCommandRunner = oldRunner }()
	driverCommandRunner = func(name string, args ...string) driverCommandResult {
		return driverCommandResult{ExitCode: 1}
	}
	out := `
Instance ID: USB\VID_10C4&PID_EA60\0001
Device Description: Silicon Labs CP210x USB to UART Bridge
Class Name: Ports

Instance ID: USB\VID_303A&PID_1001\7&abc
Device Description: USB JTAG/serial debug unit
Class Name: USBDevice
`
	devices := parseUSBBridgeDevices(out)
	if len(devices) != 2 {
		t.Fatalf("got %d devices: %+v", len(devices), devices)
	}
	if devices[0].DriverKind != driverCP210x {
		t.Fatalf("first device kind=%s, want cp210x", devices[0].DriverKind)
	}
	if devices[1].DriverKind != driverEspressifNative {
		t.Fatalf("second device kind=%s, want espressif-native", devices[1].DriverKind)
	}
}

func TestBootloaderFailureKeepsMatchingDriverForBridgeWithoutCOM(t *testing.T) {
	recommendation := driverRecommendation{
		Message: "Windows detected a Silicon Labs CP210x USB bridge.",
		Choices: []driverChoice{{Kind: driverCP210x, Label: "Install CP210x"}},
		Device: usbBridgeDevice{
			InstanceID: `USB\VID_10C4&PID_EA60\0001`,
			DriverKind: driverCP210x,
		},
	}
	got := bootloaderFailureDriverRecommendation(recommendation)
	if len(got.Choices) != 1 || got.Choices[0].Kind != driverCP210x {
		t.Fatalf("missing CP210x choice for detected bridge without COM: %+v", got)
	}
	if !strings.Contains(got.Message, "has not assigned") {
		t.Fatalf("missing no-COM explanation: %q", got.Message)
	}
}

func TestBootloaderFailureKeepsOfficialDriverPageForBridgeWithCOM(t *testing.T) {
	recommendation := driverRecommendation{
		Choices: []driverChoice{{Kind: driverWCH, Label: "Official WCH driver"}},
		Device: usbBridgeDevice{
			InstanceID: `USB\VID_1A86&PID_7523\0001`,
			PortName:   "COM8",
			DriverKind: driverWCH,
		},
	}
	got := bootloaderFailureDriverRecommendation(recommendation)
	if len(got.Choices) != 1 || got.Choices[0].Kind != driverWCH {
		t.Fatalf("missing official WCH page choice for bridge already on COM8: %+v", got)
	}
	if !strings.Contains(got.Message, "Hold BOOT") {
		t.Fatalf("missing boot-mode advice: %q", got.Message)
	}
	if !strings.Contains(got.Message, "official driver page") {
		t.Fatalf("missing official driver-page advice: %q", got.Message)
	}
}

func TestLoadPackageRejectsSchemaMismatch(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "manifest.json"), `{"project":"OpenTurbine","version":"1.0","package_schema":1}`)
	if _, err := loadPackageFromDir(root); err == nil || !strings.Contains(err.Error(), "uses format") {
		t.Fatalf("expected schema mismatch, got %v", err)
	}
}

func TestLoadPackageRejectsMissingMinimumToolVersion(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "manifest.json"), `{"project":"OpenTurbine","version":"2.0.0","package_schema":4,"setup_tool_version":"0.7.0"}`)
	if _, err := loadPackageFromDir(root); err == nil || !strings.Contains(err.Error(), "minimum compatible") {
		t.Fatalf("expected missing minimum-tool-version error, got %v", err)
	}
}

func completeDriverRoot(t *testing.T, root string) string {
	t.Helper()
	writeTestFile(t, filepath.Join(root, "driver.inf"), "inf")
	writeTestFile(t, filepath.Join(root, "driver.cat"), "cat")
	writeTestFile(t, filepath.Join(root, "x64", "driver.sys"), "sys")
	return root
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
