//go:build windows

package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
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

func TestBootloaderFailureDoesNotOfferDriverForBridgeWithCOM(t *testing.T) {
	recommendation := driverRecommendation{
		Choices: []driverChoice{{Kind: driverWCH, Label: "Install WCH"}},
		Device: usbBridgeDevice{
			InstanceID: `USB\VID_1A86&PID_7523\0001`,
			PortName:   "COM8",
			DriverKind: driverWCH,
		},
	}
	got := bootloaderFailureDriverRecommendation(recommendation)
	if len(got.Choices) != 0 {
		t.Fatalf("unexpected driver choices for bridge already on COM8: %+v", got)
	}
	if !strings.Contains(got.Message, "Hold BOOT") {
		t.Fatalf("missing boot-mode advice: %q", got.Message)
	}
}

func TestValidateDriverINFRootRejectsIncompletePackages(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "driver.inf"), "inf")
	if err := validateDriverINFRoot(root); err == nil || !strings.Contains(err.Error(), "CAT") {
		t.Fatalf("expected missing CAT error, got %v", err)
	}
	writeTestFile(t, filepath.Join(root, "driver.cat"), "cat")
	if err := validateDriverINFRoot(root); err == nil || !strings.Contains(err.Error(), "SYS") {
		t.Fatalf("expected missing SYS error, got %v", err)
	}
	writeTestFile(t, filepath.Join(root, "driver.sys"), "sys")
	if err := validateDriverINFRoot(root); err != nil {
		t.Fatalf("complete INF root rejected: %v", err)
	}
}

func TestBuildINFHelperArgsUsesExplicitAbsolutePaths(t *testing.T) {
	root := t.TempDir()
	req, err := buildDriverInstallRequest(&App{workDir: t.TempDir()}, driverCP210x, completeDriverRoot(t, root), usbBridgeDevice{
		InstanceID:  `USB\VID_10C4&PID_EA60\0001`,
		HardwareIDs: []string{`USB\VID_10C4&PID_EA60`},
		DriverKind:  driverCP210x,
	})
	if err != nil {
		t.Fatal(err)
	}
	args := buildINFHelperArgs(req)
	joined := strings.Join(args, "\n")
	for _, want := range []string{"--driver-kind", "cp210x", "--driver-root", "--device-instance-id", "--result", "--log"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("helper args missing %q: %#v", want, args)
		}
	}
	if !filepath.IsAbs(req.DriverRoot) || !filepath.IsAbs(req.ResultPath) || !filepath.IsAbs(req.LogPath) {
		t.Fatalf("request paths must be absolute: %+v", req)
	}
}

func TestInstallINFDriverPackageUsesPnPUtilSubdirsScanAndMatchingCOM(t *testing.T) {
	oldRunner := driverCommandRunner
	oldTimeout := driverCOMWaitTimeout
	defer func() {
		driverCommandRunner = oldRunner
		driverCOMWaitTimeout = oldTimeout
	}()
	driverCOMWaitTimeout = 10 * time.Millisecond
	root := completeDriverRoot(t, t.TempDir())
	var calls [][]string
	driverCommandRunner = func(name string, args ...string) driverCommandResult {
		call := append([]string{name}, args...)
		calls = append(calls, call)
		if strings.EqualFold(name, "reg") {
			return driverCommandResult{Output: `PortName    REG_SZ    COM7`}
		}
		if len(args) > 0 && args[0] == "/scan-devices" {
			return driverCommandResult{ExitCode: 0, Output: "scan complete"}
		}
		return driverCommandResult{ExitCode: 0, Output: "Microsoft PnP Utility\r\nDriver package added successfully"}
	}

	result := installINFDriverPackage(driverInstallRequest{
		Kind:             driverCP210x,
		DriverRoot:       root,
		DeviceInstanceID: `USB\VID_10C4&PID_EA60\0001`,
	})
	if err := driverInstallError(result); err != nil {
		t.Fatalf("install should be successful: result=%+v err=%v", result, err)
	}
	if result.COMPort != "COM7" {
		t.Fatalf("got COM port %q, want COM7", result.COMPort)
	}
	wantAddArgs := []string{"/add-driver", filepath.Join(root, "*.inf"), "/subdirs", "/install"}
	if filepath.Base(calls[0][0]) != "pnputil.exe" || !reflect.DeepEqual(calls[0][1:], wantAddArgs) {
		t.Fatalf("first command=%#v, want pnputil.exe %#v", calls[0], wantAddArgs)
	}
	if len(calls) < 2 || calls[1][1] != "/scan-devices" {
		t.Fatalf("scan-devices was not called: %#v", calls)
	}
}

func TestInstallINFDriverPackageRequiresMatchingCOM(t *testing.T) {
	oldRunner := driverCommandRunner
	oldTimeout := driverCOMWaitTimeout
	defer func() {
		driverCommandRunner = oldRunner
		driverCOMWaitTimeout = oldTimeout
	}()
	driverCOMWaitTimeout = time.Millisecond
	driverCommandRunner = func(name string, args ...string) driverCommandResult {
		if strings.EqualFold(name, "reg") {
			return driverCommandResult{ExitCode: 1}
		}
		return driverCommandResult{ExitCode: 0, Output: "ok"}
	}
	result := installINFDriverPackage(driverInstallRequest{
		Kind:             driverWCH,
		DriverRoot:       completeDriverRoot(t, t.TempDir()),
		DeviceInstanceID: `USB\VID_1A86&PID_7523\0001`,
	})
	if err := driverInstallError(result); err == nil || !strings.Contains(err.Error(), "matching COM port") {
		t.Fatalf("expected matching COM port error, result=%+v err=%v", result, err)
	}
}

func TestInstallINFDriverPackagePreservesRebootRequired(t *testing.T) {
	oldRunner := driverCommandRunner
	defer func() { driverCommandRunner = oldRunner }()
	driverCommandRunner = func(name string, args ...string) driverCommandResult {
		return driverCommandResult{ExitCode: errorSuccessRebootRequired, Output: "restart required"}
	}
	result := installINFDriverPackage(driverInstallRequest{
		Kind:             driverCP210x,
		DriverRoot:       completeDriverRoot(t, t.TempDir()),
		DeviceInstanceID: `USB\VID_10C4&PID_EA60\0001`,
	})
	if !result.RebootRequired {
		t.Fatalf("expected reboot required: %+v", result)
	}
	if err := driverInstallError(result); err != nil {
		t.Fatalf("3010 should be successful with reboot-required status: %v", err)
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
	writeTestFile(t, filepath.Join(root, "manifest.json"), `{"project":"OpenTurbine","version":"2.0.0","package_schema":3,"setup_tool_version":"0.6.0"}`)
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
