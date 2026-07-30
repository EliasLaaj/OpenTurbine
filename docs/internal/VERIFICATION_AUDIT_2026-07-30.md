# OpenTurbine Verification Audit — 2026-07-30

## Purpose

This document records what has actually been checked, the strength of the
evidence, and what remains unverified. “Passed” does not mean that the ECU is
proven safe for an operating turbine. The present bench has only the two ESP32
development boards connected; no turbine, production PCB, sensors, power
drivers, valves, pumps, igniters, starter, or loaded actuators are connected.

## Evidence levels

| Level | Meaning |
|---|---|
| **Current-build hardware verified** | Checked on the exact binary currently installed, with its live build ID confirmed against the ELF digest in the compiled image. |
| **Recent hardware/HIL verified** | Checked physically or through the two-board HIL harness on a recent 2.0.0 build. It was not necessarily rerun after the final identity-only firmware change. |
| **Software verified** | Exercised by automated source, simulator, browser, packaging, build, or budget tests. |
| **Not verified** | No adequate test evidence yet, or the required physical equipment was not connected. |

## Current installed builds

| Board | Live target | Live build ID | PCB profile | Final state |
|---|---|---|---|---|
| Classic ESP32 | `esp32dev` / ESP32 | `0a8fdf96c5a48d43` | `classic-devboard-pcb-test`, revision A, 7 ports | STANDBY, unlocked, outputs inactive |
| ESP32-S3 | `esp32s3dev` / ESP32-S3 | `e757e40ffe9eef52` | `otbench-s3-harness`, revision A, 14 ports | STANDBY, unlocked, outputs inactive |

The live build IDs are the first 64 bits of the ELF SHA-256 stored in the
ESP-IDF application descriptor. Each board was isolated from the other board’s
identically named access point before checking target, BSSID, build ID, and
profile identity.

## Current-build hardware verification

### Both boards

- Correct target and chip returned by `/api/device_info`.
- Live build ID exactly matched the target-specific compiled firmware image.
- OTA accepted the correct target image with HTTP 200.
- Serial output confirmed the exact OTA byte count, software reboot,
  configuration load, web-server startup, and `Setup complete`.
- Reboot preserved the PCB profile and hardware configuration.
- Device returned to STANDBY with:
  - `outputs_active: false`;
  - `ota_allowed: true`;
  - configuration unlocked;
  - PCB profile match true;
  - START and STOP inputs inactive.
- Each board passed a final isolated 50-request JSON API check:
  `/api/device_info`, `/api/status`, `/api/hardware`, `/api/data`, and
  `/api/config`, repeated ten times.
- Each exact final installed binary passed five complete source-byte checks of
  all eleven UI assets (55/55), 100 mixed JSON API requests, and two valid
  WebSocket telemetry frames with matching build ID, STANDBY, and outputs
  inactive.
- Firmware compiled against the same pinned Arduino/ESP-IDF platform for both
  targets.

### Classic ESP32 PCB mode

- Live custom profile: 7 ports.
- Exact final build `0a8fdf96c5a48d43` was isolated again after all
  experimental network changes had been removed:
  - five complete passes over all eleven UI assets succeeded (55/55), including
    gzip decompression and exact comparison with `data_src`;
  - 100/100 mixed JSON API requests succeeded;
  - a raw WebSocket handshake returned HTTP 101 and both the initial and
    client-pull telemetry frames were valid JSON in STANDBY;
  - a further hardware reset preserved the build ID and PCB profile, returned
    to STANDBY with outputs inactive, and all seven UI pages returned HTTP 200.
- Live channel registry:
  - 4 inputs: throttle, idle, START, STOP;
  - 3 outputs: main fuel servo, oil-pump PWM, igniter relay.
- Every registry channel retained the expected named physical port and mode
  after save, reboot, UI update, and OTA.
- A 125-request API soak passed before the final build-ID-only change.
- DHCP, dynamic JSON APIs, UI delivery, and OTA were all verified after replacing
  the fixed maximum PCB catalog with exact-size allocations.
- Classic OTA was repeated with serial capture:
  1,558,432 bytes written on the updater-fix build, HTTP 200, then a complete
  boot. The final `0a8fdf96c5a48d43` image was OTA-flashed with HTTP 200 and
  verified live.
- PCB first-boot configuration completion was observed on real hardware:
  hardware-only unified configuration was completed with default settings even
  while commissioning kept START locked.

### Classic web-asset update under storage pressure

- The original complete-set staging method failed on the populated 704 KiB
  LittleFS and exposed a real Classic-only defect.
- Classic now installs one completed asset at a time with one-file rollback.
- Two consecutive complete 11-file UI updates passed on the populated
  filesystem.
- All 11 served files matched their `data_src` source bytes exactly after
  decompression.
- A multipart upload was deliberately disconnected after one complete file and
  part of the next file:
  - Tools remained available;
  - status and page APIs remained available;
  - the stale upload lock cleared after its timeout;
  - a complete retry succeeded.
- `tools.html` is uploaded last so the recovery/update page remains available
  during a partial rolling update.
- S3 retains full-set atomic staging because its larger filesystem can hold both
  generations.

### ESP32-S3 PCB mode

- Live custom HIL profile: 14 ports.
- Live channel registry:
  - 8 inputs;
  - 6 outputs.
- A 100-request API soak passed after the catalog-allocation change.
- Full atomic 11-file web-asset update passed.
- Every served asset matched its source bytes exactly.
- OTA returned HTTP 200, serial confirmed 1,540,144 bytes on the updater-fix
  build and a complete reboot. The final `e757e40ffe9eef52` image was
  OTA-flashed with HTTP 200 and verified live.
- The 14-port PCB profile and 8-input/6-output configuration persisted after
  both updates.

## PCB and generic development-board modes

### S3 — current logic physically exercised

The S3’s 64 KiB `pcbprof` partition was read back and verified byte-for-byte
against `otbench-s3-harness.bin`. Only that partition was then erased.

- With the old PCB-specific configuration still present:
  - firmware reported PCB state `absent`;
  - outputs remained inactive;
  - APIs remained available;
  - ECU entered FAULT because PCB-specific saved assignments are invalid without
    their PCB. This is the intended safe behavior.
- A preserved generic pre-PCB engine configuration was restored:
  - ECU booted to STANDBY;
  - PCB state remained `absent`;
  - configuration was unlocked and matched;
  - outputs remained inactive;
  - a 60-request generic-mode API soak passed.
- The exact 64 KiB profile backup was restored with flash hash verification.
- The saved PCB configuration was restored.
- S3 returned to STANDBY with the original 14-port profile and 8/6 registry.

The complete destructive profile erase/restore cycle was rerun on the exact
final `e757e40ffe9eef52` image. Generic mode and the restored PCB mode each
passed 55/55 source-exact UI asset checks, 100/100 JSON API requests, and two
WebSocket frames while remaining in STANDBY with outputs inactive.

### Classic — current logic physically exercised

- Generic Classic operation has recent physical HIL evidence:
  - 11/11 pin/function cases;
  - 2/2 shutdown-safety cases;
  - 9/9 thermocouple/load-cell cases.
- The new exact-size PCB catalog code was audited for an absent catalog:
  null pointers are guarded and zero-count bus/device loops do not dereference
  storage.
- The exact current Classic binary has been verified extensively in PCB mode.
- The exact final `0a8fdf96c5a48d43` image completed a fresh profile-partition
  erase → generic configuration → generic verification → byte-exact profile
  restore → PCB configuration restore cycle.
- The PCB-bound configuration failed safe in FAULT with outputs inactive when
  the profile was absent. The generic configuration then reached STANDBY.
- Generic mode and the restored PCB mode each passed 55/55 source-exact UI
  asset checks, 100/100 JSON API requests, and two WebSocket frames.
- The restored 64 KiB profile was flash-hash verified and the final seven-port
  profile returned to STANDBY with outputs inactive.

## Recent two-board physical/HIL evidence

These tests used the ESP32 boards as DUT/tester hardware. They provide stronger
evidence than simulation, but most were run before the final identity-only build
change.

### Classic pin and sensor functions

- `classic_pinfunc_hil_20260729_213045.json`: 11/11 passed:
  - oil-pump LEDC PWM;
  - digital fuel, igniter, and starter-enable outputs;
  - servo output;
  - PCNT N1 input;
  - ADC input;
  - digital input;
  - timed starter assist;
  - repeating StarterSpin pulses;
  - STOP cutting StarterSpin.
- `classic_safety_hil_20260729_212409.json`: 2/2 passed:
  - N1 overspeed isolates fuel;
  - physical STOP isolates fuel.
- `reversed_digital_sensor_hil_20260729_212648.json`: 9/9 passed:
  - MAX6675, MAX31855, and MAX31856 temperature decode and open-circuit health;
  - HX711 positive, signed-negative, calibration, and missing-data behavior.

### Core safety and interaction

- `phase2_safety_hil_20260730_083143.json`: 10/10 passed:
  hot start, startup overtemperature, reduced-power cap, N1 and N2 overspeed,
  operating overtemperature, low oil, zero oil, flameout, and physical STOP.
- `interaction_hil_20260730_083715.json`: 13/13 passed:
  control-rule/controller arbitration, gradual limiter authority, reduced-power
  authority, N2 feedback loss, overspeed, oil recovery versus shutdown,
  physical STOP, rule-requested shutdown/fault, live rule deletion, relight
  interaction, and simultaneous faults.
- `finalstop_live_config_hil_20260730_083830.json`: 5/5 passed:
  development-mode live configuration, no-N1 FinalStop timing, oil output
  ownership, deferred block updates, and normal running-mode configuration lock.
- `shutdown_output_ownership_hil_20260729_152410.json`: 4/4 passed:
  main-oil delay, scavenge sequencing, forced-off STANDBY state, and cooldown
  override.
- `afterburner_limp_hil_20260729_152920.json`: 3/3 passed:
  physical main-fuel offset, reduced-power inclusion, and STOP cutting both
  afterburner and main combustion.
- `v2_controls_hil_20260729_152133.json`: 8/8 passed:
  starter assist behavior, STOP, pressure-based automatic idle, and both limiter
  modes.

### I²C and load-cell hardware

- `i2c_devices_hil_20260729_152615.json`: 13/13 passed:
  - TCA9554 discovery, assignment, input, output test, safe return, disconnect,
    output blocking, and reconnect;
  - rejection of an absent new I²C device;
  - TLA2528 discovery, calibrated input, and disconnect invalidation;
  - NAU7802 discovery, torque/thrust calibration, and disconnect invalidation.

### Configuration and logging

- `ten_build_webui_hil_20260730_081938.json`: 10/10 turbine builds passed and
  the original configuration was restored.
- `session_logger_hil_20260730_084154.json`: 2/2 passed:
  no empty session files, deferred flash writes, responsive web access, healthy
  logger, and no dropped rows.
- `output_type_switch_20260714_203940.json`: 9/9 passed for servo/PWM/relay save,
  command acceptance, and physical output.

### PCB-profile HIL

- Final basic PCB campaign
  `pcb_profile_final_pass_hil_20260730_102743.json`: 12/12 passed:
  handshake, boot-safe outputs, STOP, N1, throttle and oil-pressure analog
  inputs, flame, idle input, igniter, oil-pump, fuel-solenoid, and
  starter-enable outputs.
- Advanced cases passed for START, N2, and 50 Hz throttle-servo output.
- Earlier intermediate campaigns recorded low-frequency N1 tolerance failures
  and temporary igniter/starter-enable test errors. They are not hidden:
  the final 12/12 campaign subsequently passed N1 within tolerance and measured
  both outputs physically.
- Corrupt, truncated, and wrong-target PCB profile artifacts were prepared and
  exercised during recovery work. Fault/recovery behavior was observed, but
  this was not rerun on the final release-candidate binary.

## Automated software verification

The complete release gate passed after all final firmware, cache-policy,
calibration, logging, documentation, and packaging-source changes.

### UI and configuration

- 9 UI audit programs passed.
- UI beta dependency audit: 20 groups.
- Beta release audit: 14 groups on the final source, including:
  - build fingerprint exposure;
  - Classic rolling asset update structure;
  - dashboard and captive-portal behavior;
  - PCB UI and nested configuration merges.
- Configuration audit: 19 groups.
- Config super-audit: 13 groups.
- Configuration fuzz audit: 24 mixed hardware profiles × 7 pages.
- Cross-platform GPIO/conflict audit: 4 groups.
- PCB-profile UI audit passed.
- Pre-hardware UX audit: 33 groups.
- UI smoke test: 40 checks.
- No browser-console errors or missing application resources were reported by
  the release audit.

### Safety and turbine configurations

- Safety regression audit: 85 checks passed.
- Turbine setup matrix: 16 representative setups passed, including minimal
  turbojet, sensored single-shaft, generic automation, free turbine,
  turboprop, afterburner, air start, wet glow, switch-only oil safety,
  analog-RPM conversion, generator/turboshaft, pressure/torque development
  turbine, dual EGT, windmilling oil, and dry-sump flow monitoring.
- I²C/load-cell support audit passed.
- PCB profile pack/validation Python tests: 4/4 passed.
- Setup-package Python tests passed.
- Setup-tool Go tests passed.
- Public-content validation passed.

### Production builds and budgets

Final release-candidate builds:

| Target | Firmware image | OTA slot headroom | Static DRAM headroom | Result |
|---|---:|---:|---:|---|
| Classic ESP32 | 1,558,592 bytes | 79,808 bytes | 33,032 bytes | Pass |
| ESP32-S3 | 1,540,336 bytes | 1,605,392 bytes | 170,496 bytes | Pass |

- Both LittleFS images built successfully.
- Classic LittleFS partition: 720,896 bytes.
- S3 LittleFS partition: 1,900,544 bytes.
- `git diff --check` reported no whitespace errors.
- The third-party OneWire library emits two existing preprocessor warnings.
  No OpenTurbine compilation errors or budget failures remain.

### Final UI and Windows bundle review

- The final public screenshots were regenerated from the 2.0.1 fixture and
  inspected at full resolution.
- The live S3 UI was reviewed page by page across Dashboard, Hardware, Config,
  Calibration, Sequence, Log, and Tools, including Hardware add/edit flows,
  Config changed/invalid/discard states, startup/shutdown/control-rule views,
  session/event logging, Tools maintenance controls, and the test-settings
  dialog. No remaining overlap or horizontal overflow was found.
- The final Setup Tool 0.6.1 executable was launched beside its local package.
  The home, clean-install safety, USB connection, detection, and actionable
  board-not-found screens rendered coherently.
- `OpenTurbine_Recommended.zip` contains package schema 3, both exact final
  firmware and LittleFS images, all eleven web assets per target, the official
  S3 PCB profile, esptool, and complete CP210x plus WCH INF/CAT/SYS payloads.
- The ZIP manifest keeps `minimum_setup_tool_version: 0.6.0`; Setup Tool 0.6.1
  is the refreshed default, not a compatibility break.
- The Setup Tool executable remains unsigned because no local Authenticode
  certificate is available. Its public checksum must be regenerated after
  production signing.

## Defects found during this audit and their disposition

| Defect | Impact | Disposition |
|---|---|---|
| Maximum-size PCB catalog arrays permanently consumed roughly 30 KiB on Classic | DHCP lease failure, missing dynamic responses, hardware API timeout, OTA header failure | Replaced with exact-size bus/device/port allocations; hardware verified |
| PCB commissioning lock prevented creation of a missing settings section on first boot | Hardware-only unified file could remain incomplete | Settings are now completed safely while START remains locked; hardware verified |
| Whole-set UI staging exceeded populated Classic LittleFS capacity | Web UI update failed after the system had real configuration/log data | Classic rolling replacement plus retry recovery; hardware verified |
| Both boards use the same SSID and IP | Tests could accidentally reach the wrong DUT | Other board is held in reset; BSSID, target, chip, profile, and build ID are required |
| Firmware version alone did not identify the installed binary | A board could report 2.0.0 while running an older build | Added 16-character ELF build ID; exact live matching verified |
| ESP-IDF helper returned only its configured 9-character digest and Arduino defines `HEX` as a macro | Initial fingerprint implementation was shorter than intended and first raw-hex build failed | Raw application digest is encoded directly; both builds and live boards verified |
| Shared CSS/JavaScript used immutable one-year caching while maintenance updates replaced stable filenames | A successfully updated ECU could show new HTML with stale styling or behavior | Shared assets now use revalidation (`no-cache`), the page cache token was advanced consistently, and live S3 loading plus automated audits verified the new policy |
| A missing RC idle-input pulse was displayed as a valid `0 µs`, `0%` position and minimum throttle | The Calibration page could make an absent operator signal look valid | Zero/missing servo pulses now show `NO SIGNAL` and em dashes; simulator regression and live S3 UI checks passed |
| The Log page showed an archived run beside an enabled current-session download and “No session log yet” | Valid current-vs-archived API behavior looked contradictory | The current-session control is explicitly labelled, starts disabled, and directs the user to Past Sessions when empty |
| The Config warning called the N1 maximum a hard shutdown even when N1 overspeed protection was disabled | Warning severity and consequence were inaccurate | Warning text now follows the actual hardware-safety enable; regression coverage added |
| Sustained eight-client parallel LittleFS requests can starve the AP/HTTP stack | After enough deliberately abusive concurrent page transfers, the board remains in STANDBY with outputs inactive but the web interface can require a board reset | Reproduced on S3 and Classic; short-lived admission-limit and ACK-timeout mitigations were rejected because they impaired ordinary Classic page navigation. This remains a documented resilience limit, not a release-image change |

## Not yet verified

### Requires real production hardware

- The actual OpenTurbine production PCB, connector pinout, grounding, supply
  rails, protection circuits, level shifting, and output drivers.
- Loaded fuel/oil pumps, shutoff valves, igniters, glow plugs, starter contactors,
  servos, and propeller-pitch actuators.
- Real N1/N2 pickups across the complete RPM range.
- Real thermocouples, pressure sensors, flow sensors, load cells, RC receivers,
  battery monitor, and current sensors over temperature and supply variation.
- ADC accuracy, calibration drift, sensor linearity, electrical noise, ground
  offsets, and cable-length effects.
- Output polarity and boot-safe behavior after production driver inversion.
- Brownout, cranking-voltage dip, electrical transients, EMI/EMC, ESD, and
  watchdog behavior under real installation noise.
- Hard power removal at every boot/update/configuration phase.

### Requires turbine testing

- Cold, warm, and hot starts.
- Light-off timing, hot-start protection, flame confirmation, flameout, relight,
  acceleration, deceleration, overspeed, overtemperature, oil-pressure response,
  shutdown, cooldown, and restart on the actual engine.
- Fuel mapping, idle stability, governor tuning, surge behavior, thrust/torque
  calibration, afterburner light-up, and propeller response under load.
- Confirmation that all default limits and sequences are suitable for the
  specific turbine. Software validity does not make generic defaults safe for
  an unknown engine.

### Endurance and adverse-condition gaps

- Multi-hour/day continuous operation and repeated hot reboot endurance.
- Flash wear from long-term logs, settings changes, and repeated OTA/UI updates.
- Deliberate power loss during firmware OTA.
- Systematic filesystem boundary testing with every byte of log reserve consumed.
- Multiple simultaneous browser clients during configuration/OTA.
- Recovery from sustained parallel filesystem-request flooding. Eight
  concurrent clients repeatedly fetching UI pages can exhaust the AsyncTCP /
  LittleFS serving path; the engine state and outputs remained safe, but the AP
  stopped serving until reset. Small APIs alone passed 160/160 requests at the
  same concurrency, and the large JSON APIs shed load with HTTP 409, so the
  residual is specifically the sustained file-serving path.
- Sustained packet loss, weak-signal operation, roaming interference, and
  congested 2.4 GHz environments.
- Heap-fragmentation soak over days of page navigation, logging, config edits,
  and updates.

### User-interface/platform gaps

- Automated browser coverage is Chromium-based; current Firefox, Safari, iOS,
  and Android devices were not all physically tested.
- Touch behavior, captive-portal behavior, downloads, file pickers, and reconnect
  behavior on representative real phones/tablets remain to be checked.
- Screen-reader workflows and full WCAG conformance were not independently
  audited.
- Translations/locales are not covered; the UI is currently English.

### Security and release-distribution gaps

- No independent penetration test or protocol fuzzing campaign.
- The ECU AP is intentionally open in the current bench configuration.
- Signed release download/update flow was covered by source and setup-tool tests,
  but not independently exercised from every supported clean Windows
  installation and network/proxy environment.
- Rollback across every historical configuration/profile schema was not tested.

## Release assessment

Both boards run their exact expected binaries, have passed final PCB and
generic-mode cycles, and are safe and responsive under ordinary board-only
bench use. One adverse-network resilience limit is known:
sustained eight-client UI-file flooding can make the web service unavailable
until reset while the ECU remains in STANDBY with outputs inactive.

The system should be described as **software-release-gate clean and
board-bench verified**, not “perfect” and not yet “turbine proven.” The next
highest-value checks are:

1. connect the real production PCB and verify every connector and safe output;
2. run unloaded peripheral commissioning;
3. perform controlled turbine tests with independent overspeed, fuel, ignition,
   and emergency-stop protection;
4. complete endurance, power-interruption, and real-device UI testing.
