//go:build windows

package main

import (
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildCustomPCBProfileContainer(t *testing.T) {
	root := t.TempDir()
	catalog := `{"chip":"esp32-s3","gpio":[8,9,10,16,17],"input_only_gpio":[],"strapping_gpio":[]}`
	writeTestFile(t, filepath.Join(root, "pcb_profiles", "targets", "esp32-s3.json"), catalog)
	source := `{
	  "format":"openturbine-pcb-profile",
	  "format_version":{"major":1,"minor":0},
	  "board":{"id":"test-s3-pcb","name":"Test S3 PCB","revision":"A"},
	  "target":{"chip":"esp32-s3"},
	  "buses":[{"id":"sensor_i2c","kind":"i2c","pins":{"sda":8,"scl":9}}],
	  "devices":[{"id":"adc","driver":"tla2528","bus":"sensor_i2c","address":16}],
	  "fixed_functions":{
	    "servo_output_enable":{"gpio":17,"active_high":false,"safe_demand":0},
	    "supply_voltage":{"gpio":10,"divider":11.0,"reference_mv":3300}
	  },
	  "ports":[
	    {"id":"servo_out_1","label":"Servo output 1","modes":[
	      {"id":"servo","adapter":"servo_output","endpoint":{"gpio":16},"safe_demand":0}
	    ]},
	    {"id":"adc_1","label":"ADC input 1","modes":[
	      {"id":"analog","adapter":"i2c_adc_input","device":"adc","channel":0,"reference_mv":5000},
	      {"id":"switch","adapter":"i2c_adc_digital_input","device":"adc","channel":0,"reference_mv":5000}
	    ]}
	  ]
	}`
	sourcePath := filepath.Join(root, "test.otpcb.json")
	writeTestFile(t, sourcePath, source)
	pkg := &Package{Root: root, Manifest: Manifest{Targets: map[string]ManifestTarget{
		"esp32s3dev": {PCBProfile: PCBProfilePartition{Address: "0x610000", Size: 65536}},
	}}}
	path, warnings, err := buildCustomPCBProfile(pkg, "esp32s3dev", sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	container, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(container) < 33 || string(container[:4]) != "OTPB" ||
		container[4] != 1 || container[5] != 1 || container[8] != 2 ||
		container[9] != 1 || binary.LittleEndian.Uint16(container[10:12]) != 32 {
		t.Fatalf("bad OTPB header: %x", container[:32])
	}
	length := int(binary.LittleEndian.Uint32(container[12:16]))
	if length != len(container)-32 ||
		binary.LittleEndian.Uint32(container[16:20]) != crc32.ChecksumIEEE(container[32:]) {
		t.Fatal("payload length or CRC does not match container")
	}
	var decoded map[string]any
	if err := json.Unmarshal(container[32:], &decoded); err != nil ||
		decoded["format"] != "openturbine-pcb-profile" {
		t.Fatalf("invalid JSON payload: %v", err)
	}
}

func TestParseDetectedBoardRejectsC3(t *testing.T) {
	board, err := parseDetectedBoard("COM7", "Chip is ESP32-C3 (revision v0.4)", nil)
	if err != nil || board.Target != "" || board.Chip != "ESP32-C3" {
		t.Fatalf("C3 must be identified but unsupported: board=%+v err=%v", board, err)
	}
}

func TestParseDetectedBoardSupportedFamilies(t *testing.T) {
	tests := []struct {
		output, target string
	}{
		{"Chip is ESP32-S3", "esp32s3dev"},
		{"Chip is ESP32-D0WDQ6", "esp32dev"},
	}
	for _, tc := range tests {
		board, err := parseDetectedBoard("COM4", tc.output, nil)
		if err != nil || board.Target != tc.target {
			t.Fatalf("output %q: board=%+v err=%v", tc.output, board, err)
		}
	}
}

func TestEsptoolProgressWriter(t *testing.T) {
	var got []int
	w := &esptoolProgressWriter{progress: func(percent int) { got = append(got, percent) }}
	_, _ = w.Write([]byte("Writing at 0x00010000... (12 %"))
	_, _ = w.Write([]byte(")"))
	_, _ = w.Write([]byte("\rWriting at 0x00020000... (73 %)"))
	if len(got) != 2 || got[0] != 12 || got[1] != 73 {
		t.Fatalf("unexpected progress callbacks: %v", got)
	}
}

func TestEsptoolV5AndMultiFileProgress(t *testing.T) {
	var got []int
	w := &esptoolProgressWriter{
		segmentSizes: []int64{100, 900},
		progress:     func(percent int) { got = append(got, percent) },
	}
	_, _ = w.Write([]byte("Writing at 0x00001000 [blocks] 100.0% 100/100 bytes...\n"))
	_, _ = w.Write([]byte("Writing at 0x00010000 [blocks]  50.0% 450/900 bytes..."))
	if len(got) < 2 || got[0] != 10 || got[len(got)-1] != 55 {
		t.Fatalf("unexpected aggregate progress: %v", got)
	}
}

func TestPrimaryButtonActions(t *testing.T) {
	if cleanSafetyButtonLabel != "I understand — choose board" {
		t.Fatalf("clean-install safety gate must describe the next selection step, got %q", cleanSafetyButtonLabel)
	}
	tests := map[string]string{
		cleanSafetyButtonLabel:  "start",
		updateSafetyButtonLabel: "start",
		"Back to start":         "home",
		"Continue":              "continue",
	}
	for label, want := range tests {
		if got := primaryButtonAction(label); got != want {
			t.Fatalf("label %q: got action %q, want %q", label, got, want)
		}
	}
}

func TestJobLogPathMatchesWriteLocation(t *testing.T) {
	work := filepath.Join(t.TempDir(), "setup-data")
	job := &Job{app: &App{workDir: work}}
	if got, want := job.logPath(), filepath.Join(work, "update_log.txt"); got != want {
		t.Fatalf("default log path = %q, want %q", got, want)
	}
	job.backupPath = filepath.Join(t.TempDir(), "backups", "engine.json")
	if got, want := job.logPath(), filepath.Join(filepath.Dir(job.backupPath), "update_log.txt"); got != want {
		t.Fatalf("backup log path = %q, want %q", got, want)
	}
}

func TestTargetFromIdentity(t *testing.T) {
	tests := []struct{ target, chip, want string }{
		{"esp32dev", "", "esp32dev"},
		{"esp32s3dev", "", "esp32s3dev"},
		{"", "ESP32-S3", "esp32s3dev"},
		{"", "ESP32-D0WDQ6", "esp32dev"},
	}
	for _, tc := range tests {
		got, err := targetFromIdentity(tc.target, tc.chip)
		if err != nil || got != tc.want {
			t.Fatalf("target=%q chip=%q: got %q err=%v, want %q", tc.target, tc.chip, got, err, tc.want)
		}
	}
	if _, err := targetFromIdentity("", "ESP32-C3"); err == nil {
		t.Fatal("unsupported ESP32-C3 identity must not select classic ESP32 firmware")
	}
}

func TestConfirmationBadgeOnlyAppearsAtDecisionGates(t *testing.T) {
	if !requiresConfirmationBadge("My engine is safe — continue update") {
		t.Fatal("a safety decision must show the confirmation badge")
	}
	if requiresConfirmationBadge("Back to start") {
		t.Fatal("a completed workflow must not show the confirmation badge")
	}
	if requiresConfirmationBadge("") {
		t.Fatal("a screen without a primary action must not show the confirmation badge")
	}
}

func TestPackageDownloadRejectsPlainHTTP(t *testing.T) {
	err := downloadFileWithProgress("http://example.invalid/OpenTurbine.zip",
		filepath.Join(t.TempDir(), "package.zip"), nil)
	if err == nil {
		t.Fatal("plain HTTP package URL must be rejected before any request is made")
	}
}

func TestRecommendedPackageURLsPreferResolvedRelease(t *testing.T) {
	resolved := "https://github.com/example/OpenTurbine/releases/download/v2.3.2/OpenTurbine_Recommended.zip"
	got := recommendedPackageURLs(defaultPackageURL, resolved)
	if len(got) != 2 || got[0] != resolved || got[1] != defaultPackageURL {
		t.Fatalf("download order = %v; want immutable release URL before stable latest URL", got)
	}
	custom := "https://downloads.example.test/custom.zip"
	got = recommendedPackageURLs(custom, "")
	if len(got) != 1 || got[0] != custom {
		t.Fatalf("custom package URL changed unexpectedly: %v", got)
	}
}

func TestManifestCompatibilityUsesMinimumToolVersion(t *testing.T) {
	base := Manifest{
		Version:                 "2.0.0",
		PackageSchema:           requiredPackageSchema,
		SetupToolVersion:        "9.9.9",
		MinimumSetupToolVersion: packageCompatibilityVersion,
	}
	if err := validateManifestCompatibility(base); err != nil {
		t.Fatalf("current stable client must accept a compatible package: %v", err)
	}
	base.MinimumSetupToolVersion = "0.5.24"
	if err := validateManifestCompatibility(base); err != nil {
		t.Fatalf("newer client must accept an older compatible baseline: %v", err)
	}
	base.MinimumSetupToolVersion = "0.7.3"
	if err := validateManifestCompatibility(base); err == nil {
		t.Fatal("client must reject a package that requires a newer setup tool")
	}
}

func TestVersionAtLeast(t *testing.T) {
	tests := []struct {
		current, minimum string
		want             bool
	}{
		{"0.6.0", "0.6.0", true},
		{"0.6.1", "0.6.0", true},
		{"0.10.0", "0.9.9", true},
		{"0.6", "0.6.0", true},
		{"0.5.24", "0.6.0", false},
	}
	for _, tc := range tests {
		got, err := versionAtLeast(tc.current, tc.minimum)
		if err != nil || got != tc.want {
			t.Fatalf("versionAtLeast(%q, %q) = %v, %v; want %v", tc.current, tc.minimum, got, err, tc.want)
		}
	}
	if _, err := versionAtLeast("0.6.0-beta", "0.6.0"); err == nil {
		t.Fatal("non-numeric compatibility versions must be rejected")
	}
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}
