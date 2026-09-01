# Changelog

All notable changes to OpenTurbine are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

_Note: there is no 1.2.0 release — 1.1.0 was followed directly by 1.3.0._

---

## [Unreleased]

## [2.2.2] — 2026-09-01

### Changed
- System now owns complete engine-file backup/restore, ECU loop diagnostics,
  and factory reset. Tools remains focused on commissioning, actuator checks,
  software updates, and developer controls.
- Factory-reset guidance now states precisely that an installed physical PCB
  profile is preserved while turbine assignments and settings are cleared.

### Fixed
- A web-service allocation failure no longer prints the misleading claim that
  START is locked; autonomous physical engine control remains independent of
  the browser service.

## [2.2.1] — 2026-08-30

### Fixed
- Browser navigation now carries the installed web-release token on every
  local page link. Exact-version pages remain in the browser cache instead of
  expiring after 60 seconds and repeatedly crossing the Classic ESP32's slower
  LittleFS/Wi-Fi path.
- Repeated Calibration and cross-page navigation were qualified on physical
  ESP32 Classic and ESP32-S3 boards, including full engine-file download,
  restore, reboot and semantic readback.

## [2.2.0] — 2026-08-30

### Development focus
- Harden real-time behavior, turbine-plant fault coverage, persistence, and long-duration operation without expanding OpenTurbine beyond its role as a versatile experimental turbine ECU.
- Keep the published 2.1.0 behavior as the reference baseline; add user-facing controls only when a demonstrated turbine use requires them.

### Added
- Added worst-cycle timing and missed-deadline diagnostics to live Tools telemetry and optional session logs so intermittent ECU stalls are visible instead of being hidden by average loop rate.
- Automatic relight now has its own independently selectable trigger source,
  trigger confirmation, recovery confirmation and timeout. It can use different
  evidence from the independently enabled combustion-loss shutdown monitor.
- The supported setup matrix now explicitly qualifies monitoring-only turbines
  with manual fuel hardware, so the UI cannot accidentally make ECU-controlled
  fuel metering mandatory again.

### Changed
- Fuel-limit cards now use one clear Off / Simple / Predictive choice per
  feedback source and reveal only the settings required by that mode.
- Core actuator ownership is now explicit for every built-in output path. A
  second independent pump, igniter, fan, valve or starter can no longer become
  the primary device merely because its Hardware card appears first.
- Independent oil-pressure loops retain their own pump demand during startup
  and cooldown; the selected primary oil pump alone follows sequence-level oil
  commands and supplies the shared cooldown tuning.
- Normal ignition-confirmation exits now release only the ignition devices that
  the active sequence commanded. Emergency STOP and FAULT continue to cut every
  fuel and ignition output.
- STOP and fault transitions now de-energize fuel, combustion and starter
  hardware immediately, before sensor/bus work in the remainder of the control
  loop, while preserving oil and cooling authority for safe spindown.
- N2 telemetry, logging, rules and display capability now follow the fitted N2
  sensor directly instead of redundantly consulting the retired two-shaft
  master flag.
- Start, running, fault, relight and run-summary records now include only fitted
  sensors. Run-summary peaks ignore unhealthy samples and are omitted when no
  valid sample was seen.
- Current-sensor feedback loss now follows the same rule for built-in and custom
  outputs: an actively driven physical output with a configured current trip
  enters reduced-power protection if that safety feedback becomes unhealthy.
- The actuator writer, OTA/reboot gates, reset recovery and current-sensor safety
  now share one physical-output demand lookup based on applied fuel and
  interlock-qualified starter demand.

### Fixed
- Automatic Idle now releases Main Fuel back to the operator request when its
  feedback falls below target. Rule ownership no longer feeds the previous
  cycle's raised idle floor back into the next control cycle.
- Made the pinned web-server compatibility patch idempotent. Repeated local or
  CI builds no longer wrap its retained-header statement again, so clean and
  incremental builds produce the same firmware instead of slowly consuming
  Classic flash with duplicate generated code.
- Complete engine-file restores now validate settings independently of the
  previously active hardware, then check dependencies against the uploaded
  hardware and sequence. A valid factory or saved engine can therefore be
  restored after a substantially different bench setup has been fitted.
- Classic ESP32 engine-file restore now parses staged settings directly from
  flash after lending its idle transfer workspace to ArduinoJson. This removes
  the fragmented-heap failure reproduced after physical overspeed and STOP
  tests without increasing steady-state memory use.
- A same-tab page navigation now supersedes an abandoned large read response,
  preventing the destination page from remaining at Loading while the ECU is
  otherwise healthy. Multi-chunk configuration writes retain exclusive,
  non-preemptible ownership.
- Kept Developer Mode live controller tuning out of LittleFS while an engine is active. Approved values now apply as one small control-core transaction and persist automatically after the ECU returns to a safe mode.
- Reused the oil-temperature registry ADC sample for its raw diagnostic instead of sampling the same pin twice per control cycle, keeping raw and calibrated readings coherent while reducing loop work.
- Made Hardware and custom-controller safety descriptions match the firmware's
  fixed immediate-cut behavior for every fuel and ignition output.
- Kept bounded flight-recorder events valid by dropping an anomalous field at
  its last JSON boundary when it cannot fit.
- Output-overcurrent shutdowns now name the exact configured actuator in the
  dashboard and event record.
- Registered compressor bleed valves consistently as built-in outputs, so
  native and I2C cards use the same single owner and engine demand path.
- Removed first-input and first-output fallbacks from controller creation,
  sequencer ownership and legacy wet-glow pilot fuel. Ambiguous configurations
  now ask for an explicit device instead of silently depending on card order.

### Removed
- Removed the final unused in-memory two-shaft compatibility flag; fitted N2
  feedback is the single runtime topology source.
- Removed the unreachable duplicate controller renderer, its empty placeholder,
  eight unreferenced browser helpers, five write-only runtime fields, and three
  duplicate On/Off flags now derived from their actuator demands.
- Removed the obsolete RPM-only idle-target telemetry alias; the dashboard now
  consumes only the source-aware target value and its explicit unit.
- Removed the unreachable old `wet_glow_fuel` registry branch. Wet-glow start
  fuel now has one supported `pilot_fuel` purpose and one explicit owner.

## [2.1.0] — 2026-08-25

### Added
- Added user-created output controllers with threshold, mapped-input, feedback-target, and fixed-state methods, while keeping built-in turbine subsystems separate and understandable.
- Added explicit mirrored outputs for twin igniters, pumps, valves, and other redundant physical channels. Each mirror follows the final protected source command but keeps its own pin, signal type, polarity, endpoints, and electrical protection.
- Added repeatable START, STOP, interlock, and auxiliary switch inputs. Any active switch asserts the command, while every fitted channel must remain healthy.
- Added per-output current-sensor calibration, trip current, and confirmation time for all output types; every confirmed overcurrent initiates shutdown.

### Changed
- Reorganized configuration into Hardware, Controllers, and System workspaces with Configured System as the default view, conditional subcards, collapsed first-load navigation, and contextual help beside every setting.
- Renamed the neutral primary fuel actuator to Main Fuel Metering so pumps, valves, metering units, and ESC-driven devices use the same control model without misleading terminology.
- Made duplicate core-purpose outputs explicitly independent unless created as mirrors, and made their ownership visible so no second fuel or ignition output appears driven when it is not.
- Replaced page-owned WebSocket telemetry with one bounded 3 Hz compact REST path. Optional values rotate between complete responses, reducing Classic heap, TCP, and navigation pressure.
- Moved output overcurrent configuration to the owning Hardware card and removed obsolete controller-specific current settings and other superseded UI paths.

### Fixed
- Prevented fragmented-heap configuration apply failures from rebooting the ECU; the attempted candidate is abandoned safely while the current runtime configuration is retained and re-persisted.
- Kept the Classic session recorder usable with the complete dashboard, configuration and event history installed by capping its protected filesystem reserve at 48 KiB; S3 retains the larger 150 KiB reserve.
- Fixed Controllers rendering stopping on a removed visibility helper, which could present as a configuration fetch failure and hide later protection cards.
- Fixed repeated START/STOP registry channels bypassing pin-collision validation under the former single-canonical-input assumption.
- Fixed Configured System exposing controls unsupported by fitted hardware, misleading duplicate-output ownership text, and several stale legacy names and tests.
- Filled the remaining contextual-help gaps for shared-SPI thermocouple wiring, NTC and load-cell calibration, sequence delays, idle metering, and afterburner entry/stabilization fields; regression tests now reject unexplained installed or rendered fields.
- Kept propeller-pitch and afterburner demand in every compact telemetry frame so one browser cannot starve another browser of those live values.
- Fixed Hardware saves that changed propeller-pitch parking demand becoming stuck behind the old live demand instead of completing the controlled restart.
- Preserved an explicit 0% propeller-pitch parking position across save and reboot instead of restoring it as 100%.

### Validation
- Passed the complete publication gate: all 10 UI audit programs, 240 safety checks, 16 representative turbine setups, protocol/calibration vectors, native controller behavior, release-tool tests, and firmware plus LittleFS builds and memory budgets for both targets.
- The exact packaged Classic build passed physical overspeed and STOP fuel-isolation tests, bounded session logging with zero dropped rows, and a realistic save/export/import/navigation workflow with the original configuration restored.
- ESP32-S3 passed the same 2.1.0 browser save/export/import workflow on hardware; its final packaged source passed the same dual-target software and build gates.
- No fuel-burning turbine was run. Installation-specific wiring inspection, driver/output polarity checks, dry commissioning, and a controlled first-engine test remain required.

## [2.0.4] — 2026-08-23

### Added
- Added a deliberate reduced-power start choice inside the normal START confirmation when configured sensor feedback is unhealthy. Critical STOP-path failures and other conditions that cannot be made safe remain hard startup locks.
- Added guided oil-pressure calibration: capture zero pressure, slowly find the pump's reliable starting demand, then record gauge pressure against live sensor voltage at several useful pump speeds.
- Added accessible drag-and-drop sequence ordering with touch/pointer dragging and keyboard movement, while keeping the editor compact on phones.
- Added exact-endpoint browser soak diagnostics and boot-counter assertions for realistic cross-page editing sessions.

### Changed
- Simplified the dashboard's command presentation: throttle, idle and switches remain compact, sensor telemetry keeps the detailed cards, and inactive/failed analog sensors no longer make the display oscillate.
- Moved reduced-power startup into one clear START workflow instead of presenting a second start button, and removed explanatory dashboard clutter that belongs in the guide.
- Clarified flame calibration choices so the operator can explicitly sample with or without energizing the configured igniter.
- Made developer-mode editing availability follow the firmware's actual runtime-safe field policy; fields requiring STANDBY remain visibly locked with a concise reason.
- Reworked the Windows Setup Tool for small and low-resolution displays with responsive button rows, wrapped text, scrollable content and smaller supported window bounds. Successful USB probing now says that the board is found and responsive and asks for its matching hardware package.

### Fixed
- Prevented low-memory Classic ESP32 configuration persistence from throwing an allocation exception inside AsyncTCP or LittleFS. Nothrow allocations now return failure as intended, and the complete candidate is serialized into reserved scratch memory before filesystem staging begins.
- Preserved the existing hardware registry exactly during settings-only saves, structurally verified the unified candidate before atomic replacement, and bounded failed deferred-save retries instead of retrying continuously.
- Prevented flash-backed page responses and persistence from overlapping, while retaining bounded page-load waiting and closing completed HTTP transports consistently on both supported chips.
- Split oversized WebSocket telemetry only at complete top-level JSON member boundaries, eliminating malformed fragments under constrained TCP/heap conditions.
- Fixed mobile Config save controls overflowing the viewport, fault guidance clipping, brief incorrect dashboard layouts during initial configuration loading, and inconsistent sequence move controls.
- Fixed stale configuration-transfer state appearing on the Log page after ordinary page changes.
- Prevented transient `/api/config` 503 responses during long ESP32-S3 sessions by using the reserved bounded transfer workspace instead of requiring a second contiguous full-config allocation.
- Released completed bounded Log views when their flash read finishes rather than waiting for a keep-alive disconnect, so returning to Log cannot be mistaken for a competing reader.
- Replaced unsafe low-heap raw TCP closes with framework-safe request aborts and limited the proactive low-heap request guard to the memory-constrained Classic target.
- Kept Controllers and System live mode/Developer Mode locks current through the compact status heartbeat without retaining WebSocket clients across page navigation.
- Made session-log filesystem headroom proportional to the available LittleFS volume, preserving the bounded logger on Classic while retaining a larger reserve on ESP32-S3.
- Prevented absent N1, TOT, and throttle channels from appearing in event snapshots and applied the disabled standby-snapshot setting equally in STANDBY and FAULT.

### Validation
- Passed physical realistic-session checks on Classic ESP32 and ESP32-S3 with repeated page navigation, edits, acknowledged persisted saves, readback, restoration, unchanged boot counters, STANDBY retained and all outputs inactive.
- Visually verified the Windows Setup Tool's critical install path at a 588 × 487 client area and confirmed live S3 USB responsiveness without proceeding to erase.
- No fuel-burning turbine was run; installation-specific wiring inspection, output-polarity checks, dry commissioning and a controlled first-engine test remain required.
- Requalified both role orientations: Classic passed 11/11 pin/function, 2/2 physical safety, 2/2 session logger, and a 319-second real browser session; ESP32-S3 passed 10/10 hard safety, 13/13 controller interactions, 3/3 afterburner/Reduced-Power, 4/4 shutdown ownership, 2/2 session logger, and the final 18-navigation save/export/import/restore session with clean UART evidence.

## [2.0.3] — 2026-08-14

### Changed
- Simplified Windows download guidance for normal users: use the official link and follow the Setup Tool; checksum comparison is now clearly optional advanced verification rather than a required installation step.
- Documented SignPath Foundation as a potential zero-budget Authenticode-signing route for qualifying open-source releases.
- Reworked the public landing page to explain what OpenTurbine is and summarize planning-level engine, control, protection, and logging capabilities before presenting installation choices.
- Added a source-verified hardware compatibility table covering supported thermocouple interfaces, low-temperature sensors, shared-I2C expansion devices, load-cell interfaces, and native ESP32 I/O.
- Made dashboard actuator presentation follow the configured electrical mode consistently: relay outputs use clear binary states, while PWM and servo/ESC outputs use percentages and compact demand bars.
- Colored binary state words without adding indicators: ordinary active states are green, inactive states are neutral, armed/inhibit states are amber, and active stop/fault inputs are red.
- Simplified both igniter dashboard outputs to binary ON/OFF words; internal dwell or coil drive never appears as a misleading operator percentage.
- Restored the Tools appearance picker after the serialized low-connection web bootstrap and added live theme-selection persistence coverage.
- Unified live browser telemetry on Classic ESP32 and ESP32-S3 around compact REST polling so page changes do not leave page-owned connections behind.
- Kept command inputs intentionally compact on the dashboard: switches share one concise status strip, while throttle and idle show only their live percentages and small range bars.

### Added
- Added live N1 and N2 acceleration to the dashboard and simulator coverage for every core actuator display mode.
- Added persistent dashboard cards for fitted throttle and idle command inputs, including live percentages and compact range bars in every engine mode.

### Fixed
- Fixed public dashboard captures occurring before animated gauge bars reached their reported values.
- Unified generic relay commands across native GPIO, shared-I²C outputs, PCB profiles, sequences, rules, tools, telemetry, logging, and safety checks: zero is OFF and any positive demand is ON, with propeller pitch retained as an explicit two-position midpoint exception.
- Prevented stale hidden percentage settings from disabling explicit relay starter, oil-pump, glow, auxiliary-fuel, or afterburner ON actions after changing an output from proportional to relay mode.
- Fixed I2C relay outputs appearing as proportional percentages and prevented core bleed/afterburner outputs from also appearing as duplicate generic cards.
- Fixed configured throttle and idle inputs disappearing from the dashboard in STANDBY, including profiles whose only fitted inputs are operator commands.
- Advanced the shared web-asset generation so browsers cannot reuse the pre-fix dashboard script after an ECU update.
- Prevented repeated navigation and editing from exhausting the ESP32-S3 lwIP TCP table. Local HTTP TIME_WAIT cleanup now starts before the fixed 16-connection pool can block the web UI, while preserving a protected tail for delayed packets.
- Prevented the fixed navigation bar and connection banner from overlapping stale-telemetry and fault text, and allowed long fault guidance to wrap instead of clipping.

### Validation
- Passed the complete release gate, including 204 safety-source checks, 43 browser UI behavior groups, native behavior tests, package/configuration audits, and firmware plus LittleFS builds for both targets.
- Passed approximately 490 real browser page loads on each physical target. ESP32-S3 completed a continuous 490-load soak with zero retries while exercising the TIME_WAIT guard; Classic completed equivalent cumulative navigation with compact operator inputs visible and live.
- Reconfirmed both flashed ECUs in STANDBY with all outputs inactive and restored their original engine profiles after testing.
## [2.0.2] — 2026-08-12

### Added
- Added registry-native calibration and health handling for analog threshold inputs, piecewise nonlinear sensors, shared-I²C devices, load cells, temperature interfaces, current feedback, and the wider range of experimental turbine hardware exposed by the Hardware page.
- Added causal turbine-plant HIL, reboot recovery, native command/controller behavior tests, cross-browser UI coverage, mixed-hardware configuration fuzzing, and representative setup matrices for turbojet, turboshaft, turboprop, APU, afterburner, air-start, dry-sump, and instrumented development installations.
- Added complete engine-file backup/restore, profile-aware setup packaging, exact firmware build IDs, and stronger release-package bounds, hash, partition, and helper-tool validation.

### Changed
- Unified Classic ESP32 and ESP32-S3 behavior around channel capabilities, controller ownership, sequencer outcomes, reduced-power operation, STOP handling, hardware-save transactions, I²C loss rechecks, and safe output states.
- Simplified Hardware, Config, Calibration, Sequence, Log, and Tools workflows while retaining expert freedom. Unsupported electrical modes are blocked; unusual but physically possible settings remain available with focused warnings instead of arbitrary limits.
- Reworked afterburner gates and sequencing, starter-enable ownership, oil-pump control, N1/N2 governor behavior, ADC switch/flame thresholds and hysteresis, developer-mode edits, and fault explanations for hobby and experimental turbine use.
- The web interface is qualified for one active operator tab. Documentation now states this explicitly.

### Fixed
- Prevented completed web responses from exhausting the ESP32 connection table during repeated page navigation, while preserving clean browser closes and bounded stalled-client recovery.
- Hardened immediate fuel/ignition cuts, reboot output parking, FinalStop and shutdown ownership, sequence fault/timeout handling, sensor-loss reduced-power behavior, and critical STOP-path failures.
- Fixed live configuration saves, warned edits, profile-backed restore, large configuration transfers, deferred restart responses, session logging, atomic web-asset replacement, and Wi-Fi recovery across both chips.
- Removed stale legacy dependencies and inconsistent hardware assumptions that could expose unusable controls, hide valid shared-I²C channels, or apply different behavior on Classic and S3.

### Validation
- Passed the canonical release gate: 10 UI audit programs, 197 safety regression checks, 16 turbine setup matrices, native command/controller tests, release-tool tests, HIL harness tests, both firmware/filesystem builds, and enforced image/linker budgets.
- Passed physical dry-bench qualification on Classic ESP32 and ESP32-S3 using simulated sensors and actuator capture, including start/run/shutdown dynamics, safety trips, afterburner/reduced-power interactions, I²C loss, reboots, browser navigation, live edits, backup/restore, and full-size OTA.
- This qualification does not replace installation-specific wiring inspection, dry commissioning, or controlled first-engine testing. No fuel-burning turbine was run as part of this release qualification.

## [2.0.1] — 2026-07-30

### Changed
- Hardware setup now explains the shared SPI/I2C wiring required by a selected bus-backed device and opens the relevant wiring controls directly.
- Calibration now provides a compact fitted-device index for quickly reaching the required sensor or actuator workflow.
- Standby-only actuator tools report `Locked` with the current engine mode instead of showing `Ready` beside disabled controls.
- Dashboard commissioning progress now distinguishes successful saves and tool commands from physical verification instead of calling both complete, and upstream hardware changes clear stale downstream activity marks.
- START confirmation now shows a compact live ECU preflight snapshot with mode, fitted primary feedback, STOP input, safety-bypass state, and startup-sequence length.
- Confirming START now rechecks that telemetry is current and the dashboard start gate is still open, preventing an obsolete confirmation from submitting after the ECU state changes.
- Visible fault and startup-abort diagnoses now include direct routes to event evidence, calibration, limits, and standby diagnostics.
- Browser backup reports that a download was started and asks the operator to confirm the file exists, rather than claiming the browser saved it successfully; advanced manual firmware update also carries an immediate backup reminder.
- First-run safety/theme overlays and the commissioning guide are deferred to STANDBY/FAULT so a fresh browser cannot cover an already-running dashboard.
- Registry telemetry no longer duplicates the dedicated calibrated Thrust card.
- Hardware and Sequence saves now remain available in FAULT, matching the firmware's intended repair-state behavior; related labels consistently say `STANDBY / FAULT`.
- Visible Wi-Fi terminology is now consistent across Hardware and advanced update controls.
- Config's `Open (Dev Mode)` badge is now reserved for genuinely active engine modes; FAULT correctly appears as the normal open repair state.
- Generated Config controls and the remaining static commissioning selectors/sliders now expose their visible technical labels to assistive and keyboard-driven tooling.
- Manual afterburner fire now requires an explicit confirmation showing the configured action and available live N1/EGT snapshot; AB STOP remains immediate.
- A required afterburner arm input is now continuous permission for every trigger source, including manual fire; losing it enters the normal AB shutdown path.
- Registry/native afterburner command inputs now behave identically in rules, custom sequence conditions, RC signal-loss settings, telemetry, validation, and UI availability.
- The Setup Tool clean-install safety gate now leads truthfully to board selection; its later board-specific confirmation remains the actual erase gate.
- Setup Tool failures now display the exact support-log path actually used, including the normal `%LOCALAPPDATA%` location or the backup folder for an update.
- Windows Setup Tool 0.6.2 carries these workflow, recovery-download, board-detection, driver-repair, and support-log fixes while retaining package compatibility with the 0.6.0 stable-client baseline.
- OTBench `verify-wiring` now matches each expected signal to its actual configured subsystem or registry purpose, so an unrelated user of the same GPIO can no longer produce a false pass.
- PCB-mode START and STOP registry channels no longer conflict with their mirrored legacy control fields in firmware or the Hardware UI.
- PCB profile catalogs now retry transient busy responses and use independent paged snapshots, preventing a valid final page of connectors from silently appearing missing.
- PCB profile packaging now enforces the firmware's board, connector, description, supply-label, and polarity field limits; the official S3 profile has been corrected to pass both pack-time and live firmware validation.
- Channel-registry JSON omits decoder-default fields, keeping fully populated hardware responses inside the shared Classic/S3 buffer. Tools also compacts equivalent defaults from older engine files before restore and retries transient atomic-storage races.
- OTBench coverage now includes idle RC input, N2 capability without the removed `has_two_shaft` flag, retryable ECU-busy responses, reliable N1 sampling, and an active-low 14-port S3 PCB harness profile.
- PCB profile catalogs now allocate only the buses, devices, and ports actually present, preserving enough Classic ESP32 heap for DHCP, dynamic APIs, and OTA while retaining the same public profile limits on both targets.
- First boot with a valid PCB profile now completes the missing settings section even while hardware commissioning keeps START locked.
- Manual web-asset updates retain whole-set atomic replacement on S3 and use bounded one-file replacement on the Classic ESP32, where the populated 704 KiB filesystem cannot hold two complete UI generations. The recovery Tools page is uploaded last and interrupted uploads remain retryable.
- Shared CSS and JavaScript now revalidate after maintenance updates instead of remaining immutable for a year under stable filenames, preventing a newly updated page from running with stale styling or behavior.
- Calibration reports a missing RC idle-input pulse as `NO SIGNAL` instead of inventing a valid 0% position and minimum throttle value.
- Log now distinguishes the current in-memory session from archived Past Sessions and disables the current-session download when none exists.
- Config's maximum-N1 warning calls the limit a hard shutdown only when the corresponding Hardware safety is actually enabled.
- Device identity now exposes a shortened ELF SHA-256 build ID, allowing setup and bench checks to distinguish the exact installed binary instead of relying on the release version alone.

### Known limitations
- The ECU web interface is designed for one active operator browser. Sustained parallel UI-file downloads from many clients can exhaust the ESP32 network stack and require an ECU reset; control state and outputs remained safe in the reproduced board-only stress test.

## [2.0.0] — 2026-07-29

### Added
- Main and scavenge oil pumps can each use a dedicated calibrated flow meter and minimum-flow monitor. Confirmed underflow is warning-only by default, with an explicit Config option for shutdown. Electric drain valves are first-class relay/PWM/servo outputs available to both sequencer Open/Close blocks and Control Rules.
- Optional immutable flash-time PCB profiles provide chip-specific named ports, fixed buses/devices, labelled connector choices, and capability-filtered engine-purpose assignment while leaving an erased profile partition in the existing generic development-board GPIO mode. The Windows setup tool offers Development board, compatible official PCB, and custom profile choices in that order.
- One automatically scanned shared I²C bus now supports TCA9554 binary I/O, TLA2528 analog inputs, and dual-channel NAU7802 load cells. New assignments can select only live detected hardware; disconnected saved devices retain their setup and offer one reviewed removal action for all channels and dependencies.
- Thrust is a first-class calibrated input in newtons across the dashboard, rules, session logging, MAVLink, cluster telemetry, and the load-cell calibration wizard. NAU7802 torque calibration supports known force plus lever arm.
- Pulsed Starter Assist now provides configurable ON/OFF proportional-starter impulses inside `StarterSpin` for Bendix-drive, splined-coupling, and similar low-speed engagement problems. It latches complete at the configured N1 threshold, cancels on unhealthy N1, and includes a short STANDBY-only commissioning test.
- Config now offers **Essentials**, **Configured system**, **Explore all features**, and **Changed** views. Explore reveals every optional value for advance planning: amber-bordered tuning values can be edited and saved while remaining inactive until Hardware satisfies their displayed prerequisite. Missing-hardware choices and unavailable enable switches stay locked. Normal commissioning views stay focused on fitted hardware.
- Automatic Idle can use N1, N2, P1, or P2 feedback. Shaft-speed control remains the normal proven method; pressure feedback is explicitly experimental and uses pressure-specific target, deadband, and disengagement settings.
- Startup temperature protection now has separate pre-start and active-start limits. A zero startup limit safely inherits the normal selected TOT/TIT hard limit.

### Changed
- Shaft PCNT inputs now use a 5 µs glitch filter, and new DS18B20 temperature channels default to 10-bit conversion.
- Development-board I²C and SPI wiring is configured once in a top-level Shared Sensor Buses section. Thermocouple cards now keep only their unique CS/device settings, PCB profiles own bus pins read-only, and adding a bus-backed device clearly requires enabling its bus first.
- PCNT speed plausibility now follows twice the applicable N1/N2 hard shutdown speed automatically; the redundant user-entered pulse-sensor minimum/maximum RPM fields are removed.
- TLA2528 inputs reuse the normal voltage validity, scaling, filtering, stale-data, telemetry and health paths. A single NAU7802 can serve torque and thrust on its two channels with shared gain/sample rate and non-blocking channel scheduling.
- Configuration schema version 9 replaces the former RUNNING-mode low-RPM starter-support fields and the obsolete EGT-drop/rise-rate hot-start model; this major release intentionally does not migrate that behavior.
- Config field units, unavailable-state explanations, narrow-screen save controls, and save recap layout are more consistent and touch-friendly, including 320–420 px screens and high browser zoom.
- Pulsed starter timing is owned by a dependency-free sequencer state machine with compile-time timing, cancellation, reset, and `millis()` wraparound checks.
- EGT flameout evidence now means temperature is below a threshold and falling, or is falling faster than a separately configured rate. Automatic relight uses an explicit minimum firing speed and recovery threshold with no hidden `Min RPM + 5%` fallback.
- Session-data intervals, standby snapshots, and channel selection now live together on Log. Binary control-rule outputs are presented as On/Off.
- Gradual N1/N2/EGT/P1/P2/torque protection now has one predictable authority model: at the full-reduction threshold, strength 1.0 reaches the user-configured minimum-fuel floor. Simple current-value and advanced rate-predictive modes remain selectable.
- Config groups throttle response separately from gradual protection and places oil, pressure/torque, cooldown, combustion/startup, and auxiliary confirmation settings beside the limits or subsystem they affect.
- Hardware is now the single enable for the external cluster. Oil fallback and windmilling modes are described as explicit fixed-output versus pressure-regulated paths, glow preheat explains its Hardware/Sequence ownership, and N2 governor gains are displayed as understandable percentage-per-second corrections.
- Startup oil-pressure targets, ignition-pressure minimums, and no-sensor startup duty now live only in the Sequence blocks that use them. Hardware exposes discoverable **Show all controllers** and **Show all safeties** views with visible prerequisites and clear N2 fuel/prop-pitch behavior.
- Automatic relight defaults to a 2,000 ms ignition window for a normal combustor. Tool safety-confirmation suppression now applies consistently to the full Tools page and is restored from Tool settings.
- Session CSV logging adds shaft torque with calculated power and starter output demand.
- The universal ESP32-S3 image now uses an 8 MB-safe partition layout with
  two 3 MB OTA slots and about 1.8 MB of LittleFS. It runs unchanged on 16 MB
  modules and prevents a standard N8 dev board from being erased before a
  16 MB-only filesystem write fails.
- Setup Tool 0.6.0 is the stable Windows flasher baseline. It checks and
  downloads the latest signed firmware/dashboard package on launch and accepts
  later schema-3 releases according to their declared minimum tool version, so
  ordinary firmware updates no longer require users to download a new EXE.

### Removed
- Removed the manually armed, continuously applied RUNNING-mode starter aid and its hidden re-engagement hysteresis. Starter assistance is now startup-only and requires no runtime arming.

### Fixed
- Config, Calibration, Sequence, and Control Rules now recognize valid shared-I²C channels as fitted hardware instead of incorrectly requiring a native GPIO. This restores NAU7802/TLA2528 configuration and calibration surfaces and allows I²C drain valves and other expansion outputs in sequences.
- Tools now bench-tests non-core TCA9554 outputs as well as native outputs. Binary expansion outputs use an explicit ON test; proportional registry outputs default to 50% and expose an editable 0–100% commissioning demand.
- Shared sensor buses now use a compact Enabled/Disabled summary. **Edit buses** opens wiring, discovery, and a current supported-device list without leaving permanent setup text walls on the normal Hardware page.
- PCB-profile outputs are parked from the immutable catalog before filesystem/config loading; a damaged or wrong-target profile leaves generic pins untouched and locks START. Profile-backed wet-glow start fuel and physical/analog afterburner command inputs now drive the real runtime paths instead of retaining legacy raw-GPIO assumptions.
- Missing I²C inputs become unhealthy instead of retaining believable stale data. Missing engine-affecting TCA9554 outputs block START and fault an operating engine because their physical latch state cannot be guaranteed.
- P1-only and P2-only installations can configure Automatic Idle without an unrelated RPM sensor.
- Search can find unavailable features by their purpose and descriptive terms, including Bendix starter assistance.
- Unavailable optional features remain absent from normal configured views; Explore permits harmless future-value tuning while keeping activation controls and missing-hardware selector choices locked.
- Hardware save failures now identify the rejected area in plain language, and removing then re-adding an output no longer fills the confirmation recap with irrelevant driver-default fields.
- P1/P2 shutdown descriptions explicitly identify high-pressure trips, sequence final-state values and action buttons wrap cleanly, custom/unavailable outputs are distinguishable, and repeated per-tool confirmation dialogs can be suppressed and restored in the same browser.
- Pressure/torque hard trips now require healthy feedback; pressure-based idle clears stale rate history after feedback loss; additional oil loops honor the configured fallback delay; and cooldown oil regulation no longer changes behavior with ECU loop frequency.
- Startup temperature and flame confirmation count only newly arrived sensor samples. Binary flame detectors accept valid rail-level ON/OFF states instead of misclassifying a strong flame as a wiring fault.
- Afterburner EGT-rise confirmation now enforces its configured time window, custom ignition sequences require an explicit sensor/EGT/timed confirmation block, and flame-sensor mode shuts down only the afterburner after a configurable 1,000 ms running flame-loss delay.
- Oil-pump overcurrent timing is ghosted unless current sensing is fitted, and incomplete afterburner installations can no longer expose unrelated editable tuning fields.
- Hardware changes now disarm Pulsed Starter Assist if its starter, proportional output mode, or N1 feedback is removed, while preserving its tuning values for possible later reuse. The resulting engine file remains immediately editable instead of failing the next unrelated Config save.
- Dashboard effective-fuel telemetry now includes the final Reduced-Power cap after afterburner fuel coordination, matching the physical main-fuel output. Generic binary inputs are described as On/Off rather than internal 0/1 values.
- Hot-start prevention faults now identify the protection by name and show both measured temperature and the configured pre-start limit.
- Automatic relight ignition now uses the higher of its configured firing threshold and Minimum Running N1, so a permissive relight value cannot fire below the engine's self-sustaining airflow floor.
- Assigned TCA9554 outputs are parked before the full I²C discovery scan and
  retain a low-rate runtime heartbeat, so a steady-demand expander disconnect
  is detected during operation instead of remaining falsely healthy.
- Web JSON buffers now detect required size before serialization; truncated
  telemetry and rollback snapshots fail explicitly, and the bounded serializer
  no longer has a recursive failure path.
- Classic ESP32 large API responses now use a reserved response workspace after
  serialization releases its temporary JSON tree. Repeated Hardware, Config,
  and telemetry reads no longer fragment heap into truncated responses, and a
  full fitted-hardware save streams Hardware and Settings independently to the
  atomic engine-file replacement.
- Rejected Hardware edits now validate against the live registry under the
  STANDBY apply gate and restore the staged prior profile before returning an
  error. A rollback failure explicitly schedules a safe reboot instead of
  continuing with partially parsed hardware.
- The pitch governor synchronizes to the sequencer's live propeller demand when
  RUNNING begins, preventing a first-correction jump toward fine pitch.
- Boot loading filters Hardware and Settings independently from the unified
  engine file. Oversized/corrupt files preserve their evidence and inhibit
  START instead of exhausting Classic ESP32 heap or silently running defaults.
- Sequence and command-queue allocation failures now produce explicit,
  repairable START-readiness faults rather than undefined or serial-only
  behavior.
- Returning to STANDBY now cancels every temporary Tools-page actuator timer,
  so resetting a fault cannot leave an invisible busy state that blocks the
  next test or START after all outputs have already been parked.
- The two fixed web-transfer workspaces are now reserved once from internal
  heap before Wi-Fi starts instead of consuming 32 KB of statically linkable
  Classic ESP32 DRAM. Allocation failure is explicit and locks START.
- A deterministic configuration-fuzz audit now loads 24 mixed native/SPI/I²C
  installations across all seven web pages at desktop and mobile sizes,
  catching crashes, failed requests, duplicate IDs, broken controls, and
  leaked invalid values before release.
- CI and tagged-release builds now use the same universal 8 MB S3 partition
  layout as the installer package, enforce linker-memory headroom on both
  targets, regenerate the public Config reference, and run the control,
  engine-setup, and I²C audits before publication.

---

## [1.9.10] — 2026-07-22

### Added
- Startup pressure presets can wait for compressor pressure, confirm a rise relative to block entry, or require a threshold continuously for a stable interval, with selectable P1/P2 source and timeout behavior.
- Final Startup Checks can independently require N1, N2, P1, P2, oil pressure, selected EGT, and flame evidence before RUNNING.
- Gradual P1, P2, and shaft-torque fuel protection, independent confirmed hard trips, and P1/P2 automatic-idle feedback are now configurable.
- Telemetry frames carry a same-control-tick snapshot identifier, and run summaries report the measured minimum healthy oil pressure.
- Pure host-testable protocol vectors cover MAX31855, MAX31856, MAX6675, HX711, and DS18B20 frame decoding.

### Changed
- Firmware now uses explicit embedded error paths without unused C++ exception tables, restoring comfortable Classic ESP32 OTA headroom while keeping the same control and safety behavior on both targets.
- Control rules now expose Standby, Starting, Running, and Shutdown directly; binary inputs use explicit switch-ON and switch-OFF output values instead of editable comparison thresholds.
- TIT, P1, and P2 hard limits are grouped with the main Engine Protection Limits, and P1/P2 session-log choices are discoverable in the Essentials view.
- Simultaneous gradual N1/N2/EGT/P1/P2/torque constraints now resolve explicitly to the most restrictive fuel ceiling.
- Automatic Idle Control selects one N1, N2, P1, or P2 source and uses bounded pressure-specific target, deadband, and disengagement settings for pressure feedback.
- Loss of feedback consumed by an enabled limiter, hard trip, or automatic-idle controller now prevents fuel increases and enters the shared reduced-power mode.
- Shaft pulse counting now uses a bounded adaptive 40-250 ms measurement window: low speed is averaged longer while rising pulse rate produces faster updates. Jump detection includes the unavoidable one-pulse window quantization without weakening raw overspeed trips.
- Every predictive rate calculator now consumes each sensor sample sequence exactly once with its sample timestamp; cached control-loop reads can no longer create or decay P1/P2/torque/pressure-idle rates.

### Fixed

- All LittleFS and NVS persistence is now deferred until STANDBY or FAULT. Active runs retain the newest session rows and flight-recorder events in bounded RAM queues, so ESP32 flash-cache suspension cannot stall engine control; any overwritten evidence is counted explicitly.
- AsyncTCP's priority-10 worker is pinned to Core 0 instead of pre-empting the Core-1 engine loop. The web-polling session HIL reduced the observed active-loop maximum from intermittent 44–98 ms stalls to 3.154 ms.
- Session CSVs are exposed for download only after the run has ended and the queued file has been completely written and closed.
- A dedicated start-fuel output is no longer overwritten by wet-glow handling unless wet-glow start fuel is actually selected; standalone start-fuel and dedicated wet-glow-fuel ownership are independently regression-checked.
- Full engine-file restore now parses and stages hardware/settings independently and validates the registry in bounded STANDBY scratch space, allowing large unified configurations to restore even after a long Classic ESP32 browser session without requiring another large contiguous heap allocation.
- P1/P2 pullback and hard-trip fields now follow the selected pressure unit and are locked when their sensor is not fitted; factory-reset confirmation input stays inside its dialog on narrow screens.
- Rapid page navigation now finishes load-blocking assets, drains or aborts page-owned API reads, closes page-local WebSockets, briefly reuses unchanged configuration reads, and promptly reaps stale clients; legitimate Wi-Fi ACK stalls get a 10-second window without allowing abandoned transfers to exhaust the Classic ESP32 TCP pool.
- Web telemetry is serialized from an immutable snapshot published after the ECU control tick instead of combining fields read across different ticks.
- Final startup stability now resets when any selected check becomes unhealthy or falls below its threshold, rather than waiting a fixed time and checking only once.
- Classic ESP32 software-SPI thermocouple and HX711 clocks now include practical settling margin for level shifters, isolators, and longer hobby wiring; physical MAX6675/MAX31855/MAX31856/HX711 role-reversed HIL passes all decode, calibration, and fault cases.
- A disabled Automatic Idle controller no longer reports a boot-readiness error merely because its saved source is not fitted in the current hardware profile.

## [1.9.9] — 2026-07-19

### Changed
- Hardware temperature and torque cards now use one plainly named **Sensor interface** selector, with required HX711 and thermocouple GPIO fields visibly marked until assigned.
- Valve/actuator cards can select relay, PWM, or servo output where the turbine function is not intrinsically a hard shutoff; air-starter PWM/servo endpoints retain the sequencer's safe on/off command semantics.
- OTBench 0.6 adds role-reversed MAX6675, MAX31855, MAX31856, and HX711 protocol emulation for physical GPIO qualification.

### Fixed
- Classic ESP32 now uses deterministic static FreeRTOS timer-task storage and keeps the flight-recorder queue out of critically fragmented normal DRAM, eliminating the pre-setup timer-task boot assertion.
- Hardware and Settings saves parse only the unified-config subtree they must preserve and rebuild the replacement subtree in place, preventing low-memory saves from dropping registry bindings or failing after repeated Hardware changes.
- Boot and web saves now use the same complete Hardware validation path and emit the rejected validation stage to serial diagnostics.
- HX711 torque registry cards now mirror the dedicated load-cell driver's calibrated value and health instead of incorrectly sampling DOUT as a second analog input.
- Sensor-only test profiles retain the mandatory physical STOP input and clear hidden low-RPM starter support when the starter is absent.
- New ECU profiles leave optional low-RPM starter assistance disabled until the user fits both a starter output and N1 feedback.

## [1.9.8] — 2026-07-19

### Changed
- The large-RC-jet example is now an internally consistent approximately 100,000 RPM baseline, including matching gradual N1/EGT protection, idle, hot-start, and windmilling-oil suggestions.
- Factory settings now retain useful 100 °C/s EGT-rise and 150 °C hot-start thresholds while their Hardware safety switches still control whether those checks are active; windmilling oil starts from a noise-resistant 1,000 RPM baseline.
- Surge detection now labels its statistical value explicitly as RPM² and explains its equivalent RPM standard deviation.
- Hardware temperature cards now use one explicit interface selector across TOT, TIT, oil, coolant, and intake/ambient sensing; digital interfaces hide analog signal/range fields, while analog validity limits are shown in measurable millivolts.
- Torque hardware now presents analog transmitter versus HX711 as the authoritative interface and keeps both HX711 DOUT and SCK wiring visible together.

### Fixed
- Enabling hot-start safety with an old zero threshold now fills a visible 150 °C starting value instead of leaving the selected protection silently disabled.
- Config now warns when windmilling-oil protection cannot activate because its RPM threshold is above every selected shaft limit, or cannot deliver oil because both output settings are zero.
- A configured EGT rate-of-rise threshold no longer blocks START on a supported timer-only turbine with no TOT/TIT sensor; it becomes a feedback requirement only when an engine-temperature source is fitted.
- Dashboard prop-pitch indication now shows `COARSE`/`FINE` for a binary pitch solenoid and retains the percentage display for servo/PWM pitch actuators.
- Event-log display now tolerates an incomplete/trailing-comma record instead of discarding every run, and the JSON/CSV download routes are registered before the base log route so they return their intended formats.
- Flash-heavy log views/downloads are serialized: concurrent clients now receive a clear HTTP 429 retry response instead of stacking large reads that can exhaust async networking memory or trip the watchdog.
- Glow Preheat help now directs an unfitted installation to add Glow Plug hardware instead of opening a Config section that is hidden without that actuator.
- Hardware validation now rejects NTC/DS18B20 devices as TOT/TIT feedback, clears incompatible hidden temperature interfaces when a card purpose changes, and ignores irrelevant analog range fields for dedicated digital sensors.
- A forced transition to STANDBY now stops any active main sequence before the final all-off boundary, preventing a skipped cooldown block or side action from resuming and re-energising an output afterward.

## [1.9.7] — 2026-07-19

### Changed
- Bench-test settings now have one UI owner under **Tools > Test settings**; the hidden duplicate Config schema definitions were removed while full engine-file round trips continue to preserve their values.
- Manual relight and cooldown-override controls now live under **Start, Run & Recovery** instead of **Data & Display**.

### Fixed
- Aligned every setting shared by Config and Sequence to the same firmware-supported range, including oil pressure, cooldown temperature, afterburner timing/temperature, glow preheat, and governor band settings.
- Allowed the documented maximum throttle-expo value of 1.0 and added structural regression checks for duplicate Config keys, paths, labels, section ownership, Tools coverage, and shared Sequence ranges.

## [1.9.6] — 2026-07-19

### Changed
- Reduced the hardware-aware Essentials view to the common commissioning limits and controls; specialist tuning, logging, integration, windmilling-oil, and afterburner detail remains available under **All settings**.
- Clarified that Hardware is an installer/electronics commissioning surface and that the Reduced-Power cap is shared by manual activation and automatic loss of feedback required by an enabled protection or shaft controller.
- Moved bench-test timing and output controls out of Config and into **Tools > Test settings**, clarified the separate hardware-installation and runtime cluster controls, and documented the exact RPM change-rate calculation.
- The Hardware device picker now wraps long turbine-device descriptions and uses theme-matched scrollbars without horizontal overflow.

### Fixed
- HIL campaign records now capture the firmware version reported by the DUT instead of writing a stale hard-coded version.
- Fixed S3 dwell/rest igniter PWM initialization across the documented timing range, and reject imported igniter timings outside the Hardware UI limits.
- Enforced the Reduced-Power maximum at the final main-fuel actuator boundary so an afterburner main-fuel offset cannot exceed the configured cap.
- Disabled timestamp-only session files when no log fields are selected, avoiding needless flash wear and long LittleFS flush stalls during a run.
- Bounded session-log listing by newest run numbers so a large legacy log directory cannot block the ECU web task for tens of seconds.
- Final shutdown now uses the configured spool-down timeout when no N1 sensor is fitted instead of treating an unmeasured rotor as already stopped.
- Developer Mode now permits runtime-safe Config values to be saved and applied while the engine is active; sequence-block and peripheral copies are safely queued until STANDBY, while normal operating mode remains locked.
- Shutdown final-state guidance now explains the ECU-enforced STANDBY safe-output boundary, and opening All Events refreshes the event history.

## [1.9.5] — 2026-07-18

### Changed
- Standardized dashboard, sequencer, cluster, tools, calibration, and hardware terminology around turbine devices such as the main fuel metering output, main fuel shutoff, air starter valve, and combustion confirmation.
- Preserved configurable turbine use cases: a zero minimum-running N1 disables the independent underspeed check, telemetry-only sensors do not cause limp, and cooldown may intentionally reuse the starter after the immediate shutdown cut.

### Fixed
- Made START feedback requirements follow the sensors actually consumed by enabled safety features, controllers, and sequence blocks, including FlameConfirm and registry oil loops.
- Hardened shutdown of registry-defined start, auxiliary, main, and afterburner fuel/ignition outputs while preserving intentional cooldown actions.
- Reset delayed safety confirmations across inactive and bypassed states, corrected zero-RPM FinalStop completion, aligned the cooldown timeout, and prevented legacy oil-loop migration from binding a non-oil pressure channel.

## [1.9.4] — 2026-07-18

### Changed
- Updated turbine setup, calibration, sequencer naming, and device guidance, including known-point thermistor calibration and explicit coarse-pitch fail-safe behavior.

### Fixed
- Hardened configuration application, start interlocks, device dependency cleanup, output shutdown invariants, sensor-loss handling, current protection, reboot gating, and multi-platform build/setup behavior found during the post-1.9.3 exhaustive audit.

## [1.9.3] — 2026-07-17

### Fixed
- Hardened fresh-sample safety calculations, turbine shutdown fuel/ignition cuts, shaft-sensor limp behavior, actuator and PCNT initialization, boot-safe output parking, watchdog recovery, and analog command-input failsafes.
- Reduced thermocouple filtering to four real samples and made the oil overcurrent shutdown delay configurable (5 seconds by default).

## [1.9.2] — 2026-07-16

### Changed
- The Windows setup tool now labels destructive and update gates as **Confirmation required** and declares Per-Monitor-V2 DPI awareness for clearer Windows 10/11 scaling.
- Versioned `v*` tags now build and publish a matched firmware, web-assets, signed-driver, and setup-tool release bundle. Publication stops if the firmware version does not match the tag or any release input fails its pinned checksum.

## [1.9.1] — 2026-07-16

### Added
- Independent, configurable hard N2 overspeed shutdown for two-shaft turbines. It confirms raw RPM samples, remains effective during sensor jump faults, requires a fitted N2 channel, and is separate from gradual N2 pullback/governor control.

### Fixed
- The dashboard N2 card now matches the N1 card with a limit gauge, absolute RPM/limit readout, and approaching-limit warning based on the independent hard N2 shutdown setting.
- Settings-only safety corrections now refresh cached startup-readiness issues immediately, so clearing an invalid limit does not leave START blocked until reboot.
- Two-shaft configuration now warns when N2 pullback, governor band, N2-based idle, or cluster warning settings do not leave margin below the hard N2 shutdown limit.
- The dashboard post-run summary now includes peak N2 when an N2 sensor is fitted.
- Mobile Configuration groups no longer reserve large blank off-screen placeholders, and mobile Log run summaries use the same full-width statistics layout for short and long outcomes.
- Dashboard P1, P2, and fuel-flow cards now show their available sensor-health state; fuel flow is labelled consistently as L/min across Dashboard and Calibration.
- Hardware unit controls now retain a usable compact touch target, and Save & Reboot uses the same primary-action styling as the other editors.
- The detailed user guide now covers hard-versus-gradual N2 protection, controllers and limiters, relight, afterburner, logging, custom sequence behavior, update verification, and turbine-safe dry testing in the current UI.

## [1.9.0] — 2026-07-16

### Added
- Guided calibration for fuel-pump and oil-pump minimum output, pressure-sensor model fitting, one-second throttle/idle endpoint capture, known-point oil-temperature curves, and current-sensor known-point/datasheet modes.
- A hardware-aware Setup view, advanced manual controls, hover help, a first-run workflow, responsive mobile layout fixes, and configurable bench-test durations in Tools.
- A consolidated user manual with installation, wiring, first setup, calibration, operation, recovery, troubleshooting, and cluster-integration guidance.
- A practical OpenTurbine Cluster example and implementation guide.
- A bounded hardware channel registry with installed input/output inventory, stable channel IDs, editable registry cards on the Hardware page, and compatibility migration from legacy singleton hardware fields.
- Stable channel references for control rules, sequence side actions, and custom sequence blocks, while retaining legacy numeric fields for older configuration files.
- Fixed-capacity oil-loop definitions that bind pressure input channels to oil-pump output channels. The first enabled loop feeds the existing oil-pressure controller compatibility path; additional enabled registry loops drive their selected non-core pump outputs before rules run.
- Runtime dispatch for generic registry inputs and outputs: digital/analog/pulse/RC-PWM inputs publish telemetry and rule values, relay/PWM/servo outputs use normalized demand, and testable registry outputs appear in Tools.
- Registry input switch roles for existing DI behaviors (`fault`, `estop`, `inhibit_start`, `sequence_gate`, `ab_arm`, `ab_fire`, `limp_mode`) with a compatibility bridge into the fixed DI runtime slots.
- A searchable, grouped Configuration workspace with Essentials, All settings, Changed, and Unavailable filters; changed fields and cards are highlighted until saved or discarded.
- Simple Control Rules for threshold switching with hysteresis and linear input-to-variable-output mapping, with selectable engine states and an explicit off value.

### Changed
- Configuration suggestions are explicitly unverified starting points; unavailable hardware-dependent controls are hidden in Setup and retained as explained, disabled controls in Advanced.
- The Windows installer now distinguishes **Clean install / reinstall** (USB, complete erase) from **Update and keep my setup** (Wi-Fi, automatic settings backup, no reset).
- Raw firmware and web-asset uploads remain available in Tools but are grouped under a collapsed advanced section; the setup tool is the normal update path.
- User-facing aircraft/flight-specific wording was replaced with turbine-neutral operator, event-log, and engine-operation terminology.
- Controller and safety enables are now rejected by Hardware save/import validation and START preflight when their required inventory is missing.
- The first enabled oil-loop definition now supplies the oil controller's selected pressure/pump channels plus min/max demand and deadband; duplicate enabled pump ownership is rejected.
- Rule and sequence ID resolution now accepts standard binding keys and registry channel IDs where they map to existing runtime inputs/outputs.
- Control-rule editing now includes installed registry inputs/outputs, preserves stable `source`/`target` IDs, and backend validation rejects unavailable explicit rule/sequence/custom-block references before save or full restore.
- Core output ownership is determined by stable IDs or explicit bindings instead of semantic role, so repeatable same-role outputs such as `Oil Pump 2` remain available to rules, sequences, tools, or additional oil loops unless intentionally bound to a singleton subsystem.
- The AB igniter registry role bridges to the existing Igniter 2 / afterburner ignition runtime when using the standard `ab_igniter` or `igniter2_main` ID.
- Hardware, Configuration, and Sequence editors now share one clean/dirty save contract: actions are disabled when clean, highlighted when edited, and reset after save or discard.
- Tools uses a responsive two-column desktop layout while keeping maintenance, backup, update, and destructive actions full width.

### Fixed
- Known-point oil-temperature curves now reject duplicate ADC captures, allow individual point removal, persist their calibrated ADC range, and clamp conversion to that range instead of extrapolating beyond measured data.
- Factory reset now describes every erased data class and requires an explicit typed confirmation.
- Calibration saves and hardware patches preserve sibling configuration fields and report acceptance accurately.
- Multiple narrow-screen overflow, inactive-hardware dependency, single-shaft, and first-run navigation inconsistencies found by the release audits.
- Registry bindings now reject missing channels, invalid directions for standard binding keys, duplicate IDs, invalid drivers, invalid safe demands, and cross-direction GPIO conflicts.
- Control Rules now persist through save and reboot as part of the unified engine file.
- Complete engine-file restore now preserves registry channel identities, ordering, drivers, and GPIO assignments exactly through reboot.
- Configuration PATCH requests now replace array values correctly, including clearing all Control Rules with an empty array.
- Dashboard setup-status text, page headings, unit labels, empty configuration groups, and narrow-screen editor layouts are visually consistent across the web interface.

## [1.7.0] — 2026-07-09

Opt-in advanced control modes (default **Simple** = current behaviour — nothing changes until
you switch a mode on) plus a Hardware-page convenience toggle. Config schema → v3 with free
forward-migration (a v2 file loads with the new keys at their Simple defaults).

### Added
- **RPM Limiter — Advanced (predictive) mode** (`throttle.rpm_limiter_mode`; default Simple).
  Advanced projects shaft RPM from a filtered acceleration estimate and eases fuel off *before*
  an overshoot during a fast spool, then softens the throttle-open ramp near the limit. EGT
  pullback stays reactive. Tunables: predict lookahead, near-limit ramp, approach zone
  (0 = auto), RPM-accel filter weight.
- **Dynamic Idle — Advanced (decel-catch) mode** (`dynamic_idle.idle_mode`; default Simple).
  Advanced adds a decel-catch (drops just below a learned idle-hold on a fast chop from high
  RPM so it settles without hanging or dipping toward flameout), a learned idle-hold replacing
  the integrator, and a predictive trim. The learned hold is per-run (not persisted to flash).
  Tunables for decel enter/drop, trim lookahead, settle band, full-response error, trim
  up/down rates, hold learn rate, and the learn-accel gate.
- **Filtered RPM acceleration** — one shared `dRPM/dt` source (`n1RpmAccel`/`n2RpmAccel`),
  exposed as `n1_rpm_accel`/`n2_rpm_accel` in the live telemetry frame.
- **Hardware page "Hide unselected"** toggle — collapses the Actuators section to just the
  enabled cards (and hides emptied sub-headers). Per-browser preference; view-only.

### Changed
- Config schema version **2 → 3** (additive only).
- **Hover help on every page** — the Hardware and Sequence pages (which don't load app.js)
  now also give a hover tooltip on each documented control, so a user can hover any setting
  for its explanation instead of reading the docs, matching the pages that already did.

---

## [1.6.0] — 2026-07-08

Code-quality and configuration-clarity release. A deep, repeated end-to-end audit of the firmware
and web UI removed dead code and confusing/duplicated configuration, tightened the cross-core data
paths, and fixed several latent bugs. No new engine features — the focus is making the existing
behaviour correct, consistent, and easy to configure. Re-validated on the two-ESP32 HIL bench
(every input, output, and startup-sequence path).

### Added
- **Safety-threshold auto-fill** — turning on a safety check that still has a zero/unset threshold
  now auto-fills a sensible turbine default (TIT 900 °C, oil temp 120 °C, fuel pressure 0.5 bar,
  battery 10.5 V, surge 500000) and logs it, so a check can never be armed in a state where it can
  never trip. Every value remains user-editable.
- **Dynamic-idle maximum multiplier** (`dynamic_idle.max_multiplier`, default 1.50) — bounds the
  dynamic-idle upper target as a multiple of the idle set point, mirroring the existing
  `min_multiplier`.

### Changed
- **Unified the idle-ceiling setting** — the two overlapping "idle max %" fields are merged into one
  (`throttle.idle_max_pct`); the old `fuel_pump.idle_max_pct` is migrated forward automatically on
  first load.
- **Decoupled glow-plug configuration** — glow-plug type and glow current-sensing are now
  independent settings; the redundant "current-sensed" glow-type option is gone. (Per-channel
  igniter current-sensing is unchanged.)
- **`0 = auto` N1 warn threshold now works** — the default no longer silently overrides an unset
  (0) warn threshold with a fixed RPM, so it derives from the configured N1 limit as intended.
- **RPM staleness floor scales with the engine** — the "shaft still turning" floor in the PCNT
  reader derives from the configured RPM limit (min 200 rpm) instead of a fixed 2000 rpm, so both
  small and large turbines detect a stalled or newly-live shaft correctly.
- **Leaner telemetry** — 18 telemetry fields that nothing consumed were dropped from `/api/data`
  (only the instrument cluster and web UI read telemetry).
- **Config schema → v2**, with automatic forward-migration of the renamed/merged fields.

### Fixed
- **Cross-core run statistics** — total run seconds and the start-attempt / run counters are now
  `volatile` and mutex-guarded, eliminating torn reads/writes between the ECU (core 1) and web
  (core 0) tasks.
- **Factory reset** no longer returns HTTP 500 while nonetheless rebooting into wiped defaults when
  the backup copy fails — it now falls through cleanly to the compiled defaults.
- **Manual relight, dynamic-idle toggle, and limp-home switch** logic in the main loop: igniter-on-
  start and manual relight are no longer conflated, the dynamic-idle toggle is no longer a no-op,
  and the limp-home switch is level-authoritative each tick.
- **Complete actuator safe-state** — the master "all off" path also zeroes the oil-pressure target.
- **Web UI doubled divider** — a subsection label placed directly under a section title on the
  Hardware page no longer stacks its top border against the title's bottom border.

### Removed
- Dead configuration and code: the unused low-fuel-safety flag and cluster-protocol selector, the
  vestigial oil-arm-bar and ThrottleSlew idle-min/idle-max fields, `fuel_pump.idle_max_pct` (merged
  above), unused HAL helper methods, and the unused mock sensor/actuator classes.

---

## [1.5.0] — 2026-07-07

Hardware-in-the-loop validation release. A full two-ESP32 HIL bench exercised every input,
output, controller, and safety path end-to-end; the fixes and features below were all verified
on hardware, and OpenTurbine is now validated on **both** the ESP32-S3 and the classic ESP32
(servo/PWM, ADC, RPM/frequency, and digital I/O confirmed on each).

### Added
- **Fuel-pump minimum-spin calibration** — a Calibration-page routine ramps the fuel pump until
  it reliably spins; that % (`throttle.fuel_pump_min_pct`, telemetry `fuel_pump_min_pct`) becomes
  the lowest fuel the ECU commands while running. Replaces the old fixed 8% idle-floor assumption;
  0 = uncalibrated = no floor. The dashboard throttle card shows it as "fuel min spin".
- **Standby-oil set-pressure mode** (`standby_oil.feed_bar`) — with an oil sensor and the oil
  control loop enabled, the standby windmill feed regulates the pump to a target pressure instead
  of a fixed %, floored at Feed Duty %. Default 0 keeps the fixed-% behaviour unchanged.
- **Governor mode indicator** on the dashboard (`governor_mode` telemetry) — shows whether the
  power-turbine governor is running in PROP-PITCH or THROTTLE-DRIVEN mode.
- **Preflight warnings** for two silent-failure footguns: LOW_OIL protection enabled but no
  startup block arms the oil-pressure minimum; and an afterburner ignition with no active method
  (torch needs an EGT cap, or enable the AB igniter).
- **Oil-zero reachability warning** on the Calibration page: flags an oil curve that never reads
  below the zero-pressure threshold (which would silently defeat OIL_ZERO protection).

### Changed
- **Fuel/throttle floor model** — the running floor is now the measured fuel-pump minimum-spin %,
  not an arbitrary 8% idle floor. The throttle-driven governor correctly overrides the throttle
  input to hold N2, and the N1/EGT pullback reduces throttle no lower than the fuel floor.
- **OilPrime** drives the oil pump directly at a fixed % when the oil control loop is disabled
  (previously it set a pressure target that nothing acted on → a silent no-prime abort).
- **Afterburner ignition** falls back to the fitted AB igniter when no ignition method is
  configured, so a default AB setup lights whenever the ignition hardware is present.
- **Captive portal** serves a small landing page (302 → `/portal`, no WebSocket) to OS
  connectivity probes instead of the full dashboard. This both improves the captive experience
  and frees the single `/ws` slot, so the Hardware page now updates at 1 s on first open (it
  previously fell back to a 3 s poll until you navigated away and back).
- **Guides / settings text** — clearer idle-input vs running-fuel-floor naming, explicit
  governor-mode labels and gains, pullback-strength guidance, and false-confirm warnings on the
  relight/afterburner EGT-rise thresholds; README updated for the fuel floor and both governor
  modes. All dashboard warning-banner colours now use theme variables so they track all six themes.
- Standby oil feed keeps the fixed-% path as the floor in pressure mode and releases the pump
  cleanly when windmilling stops.

### Fixed
- **ServoActuator dead on ESP32-S3** — `ledcAttach(pin, 50, 16)` (16-bit @ 50 Hz) fails to attach
  on the S3's slower LEDC clock, so the throttle ESC and starter servo emitted nothing. Now
  retries at progressively lower resolution (16→12 bit) with runtime max-duty tracking, matching
  `LEDCActuator`. Verified: the S3 falls back to 12-bit and the classic ESP32 keeps full 16-bit.
- Dashboard: battery bar colour direction (green full → red empty), the S3 status LED now turns
  off when disabled in the hardware config, unified per-field graph/bar/value layout, N1/N2 health
  dots no longer stay grey when the data is good, and the hour meter / lifetime run count / flash
  usage now update correctly.

---

## [1.4.0] — 2026-07-06

Web UI theming, a portable theme choice, and a configurable status-LED blink colour.

### Added
- Selectable UI theme: six built-in dark/light themes — Carbon (default), Ember, Slate Teal, Midnight, High Contrast, and Daylight — chosen from a preview-tile picker at the bottom of the Tools page, or a one-time first-run chooser shown right after the beta notice. The saved theme is applied before first paint on every page (no flash of the wrong theme).
- The theme travels with the engine file: it is stored in `ecu_config.json` (`ui_theme`), served in `/api/data`, and saved through a new lightweight `POST /api/theme` (no engine-config re-apply). A fresh phone/browser adopts whatever theme the ECU has stored; a per-browser override is kept in local storage.
- Configurable status-LED blink colour (`blink_color`, default blue): in NeoPixel blink-pattern mode the RGB status LED now flashes the chosen colour instead of hard-coded green, with a Blink colour picker on the Hardware page (shown in blink mode). State-colour mode is unchanged.

### Changed
- The web palette is now fully CSS-variable driven so themes swap cleanly: the brand accent is split from the healthy/running green, every semantic tint tracks the active theme, START is a filled green and STOP a filled red with high-contrast dark labels, and SHUTDOWN uses a steel teal. The shipped default look moves from the previous navy/mint to the neutral "Carbon" charcoal with an orange accent.

### Fixed
- Field help text (`.hw-desc`/`.cfg-desc`/`.param-unit`) used a hard-coded blue-grey that clashed with the new palette; it now uses the theme's neutral dim colour.

---

## [1.3.0] — 2026-07-05

Beta-hardening release: two full review/fix passes over firmware and web UI
(120+ verified findings resolved), plus a working browser-audit suite.

### Changed (default profile)
- The default `hardware_profile.h` is now a deliberately minimal simple turbojet so a fresh flash boots clean with no warnings: throttle + idle inputs, throttle/fuel-pump ESC, oil pump, one igniter, throttle rate-limiter, START/STOP buttons, and a purely timed startup/shutdown (external air/leaf-blower start). Removed from the default: TOT/oil-pressure/flame sensors, starter + starter-enable, fuel solenoid, oil P-loop, and all sensor-based safety (overspeed/overtemp/low-oil/oil-zero/flameout) — each auto-enables when you fit its sensor. Testers add their real hardware on the Hardware page. The "timed light-up doesn't confirm combustion" warning now only fires when a combustion sensor is actually fitted.
- Factory reset now regenerates the built-in defaults (identical to first boot) instead of restoring a separate, more-enabled `factory_config.json` — `hardware_profile.h` is the single source of default topology. A curated `/factory_config.json` is still honored as an optional override if present, but none ships.

### Added
- FAULT is now a real boot state: profile mismatch or a failed config load shows a clear FAULT status and inhibits START while the entire web UI (config/hardware upload, OTA, tools, calibration, logs, Dev Mode) stays usable as the repair path. DI `active_modes` bit 4 (FAULT) and the status LED / cluster / MAVLink FAULT displays are live.
- Load-and-warn config handling: out-of-range safety limits in `ecu_config.json` load as-is but raise a persistent dashboard banner (`config_load_warning`) and boot flight-log markers, instead of being silently clamped or rejected. Upload/restore accepts the same values with the same warning.
- `hardware_profile.h` OT_* macros now seed the generated config on first boot and fill missing keys for newly added features; saved JSON always wins afterward. `hardware_profile.h` is the single source of default topology for both first boot and factory reset (see above).
- Dashboard START button explains why it is disabled (profile mismatch, sequence errors, extra cooldown, inhibit-start input, stop switch, FAULT) instead of rejecting after the click.
- Session chart can plot oil pump % and ECU loop timing; dashboard shows peak battery voltage; captive-portal browsers get a throttled-data warning banner.

### Changed
- Overspeed protection uses the raw N1 reading with a 250 ms confirmation window, so a fast runaway can no longer suppress its own trip through the RPM-health JUMP flag; brief zero-glitches no longer latch limp mode.
- EGT-only flameout detection (source 3) redesigned: the reference is judged over a true 2 s stability window, seeds only from settled EGT, and follows down only after a cumulative 10 % commanded-power drop. Known, documented limitation (sequence validation now warns): EGT-only builds cannot detect a flameout during a throttle reduction — fit a flame or N1 sensor for full coverage.
- DI Fault/E-Stop roles are level-sensitive while STARTUP/RUNNING: an input already held active trips immediately (previously edge-only, so a held trip was missed). Dedicated START/STOP switches gained a 30 ms debounce.
- Empty startup/shutdown sequences are structural errors, and STOP or a fault with an empty shutdown sequence performs an immediate all-off to STANDBY instead of hanging in SHUTDOWN with outputs untouched. Shutdown-sequence block faults safe-stop to STANDBY instead of restarting the sequence forever.
- FlightRecorder events queue on the ECU core and are written to flash from Core 0 (no more control-loop stalls); session CSVs flush every 5 s so a power cut loses seconds, not the whole run.
- Cluster serial gained a real TX buffer (the schema burst now completes), overflow-safe RX, and telemetry retry; MAVLink sends all channels round-robin with a TX buffer; enabling Cluster Serial in Config now starts the UART without a reboot.
- Hardware save and factory reset require idle outputs, and START from any source (web, physical button, cluster serial) is rejected during the save-reboot window.

### Security
- The full engine backup (`/api/ecu_config`) intentionally includes the Wi-Fi AP password so a file restores 1:1 on another ESP32 — the Tools card and beta guide now say so before you share the file. The Hardware page warns that an open AP gives anyone who joins command access. Over-long profile IDs are safely truncated for the broadcast SSID.

### Fixed
- A generated config no longer seeds a full afterburner ignition/shutdown sequence when no afterburner is fitted — `applyDefaults()` gates the AB sequences on `hasAfterburner`, so a minimal (no-AB) profile gets `ab_ign=0`/`ab_shut=0` instead of an orphaned sequence for absent hardware.
- Serial/debug output is now plain ASCII (converted em-dashes, arrows, °, µ, Ω, etc. inside string literals to `-`, `->`, plain text) so the boot log and diagnostics render correctly on the Arduino Serial Monitor and other non-UTF-8 terminals instead of showing `?`/garbage. Source comments are unchanged.
- ESP32-S3: PWM outputs failed to initialize (`[OIL_PUMP] LEDC attach ... FAILED`, `div_param=0`) because the S3's LEDC timer clock can't achieve the default 10 kHz at 12-bit resolution (the classic ESP32's 80 MHz clock can). `LEDCActuator::begin()` now retries at progressively lower resolution (down to 8-bit) so the output attaches with slightly coarser duty steps instead of not at all; the classic keeps 12-bit.
- ESP32-S3: the env used the 4 MB `partitions.csv` on a 16 MB DevKitC-1, so esptool erase/uploadfs and the firmware disagreed about the flash and a full clean flash left stale config and web UI behind. The S3 env now declares 16 MB flash and uses `partitions_16mb.csv` (3 MB app slots, ~9.9 MB littlefs) — clean flashes now clear correctly, and firmware dropped from 94% of a 1.5 MB slot to 46% of 3 MB.
- Editor pages (Sequence/Hardware/Config/Calibration) failed to load with "Unterminated string in JSON" on configs with many features enabled: `GET /api/config` and `GET /api/hardware` streamed their response via `AsyncResponseStream`, which silently truncates large JSON under AP heap pressure. Both now serialize into the checked static TX buffer and send with a fixed Content-Length (the reliable path `/api/data` already used), with a `measureJson` guard that returns a clear 500 rather than truncating.
- Sequence page: missing display-unit helpers (`toDispTemp`) threw during boot rendering and the error was silently swallowed — the Afterburner criteria panels and the Control Rules tab never rendered whenever the shutdown sequence contained a temperature-unit block. The page now carries a read-only mirror of the site-wide unit preference.
- Optional sensors gained real health flags: railed/disconnected P1, P2, and fuel-flow sensors now read unhealthy (dash on the dashboard, rules leave outputs unchanged, peaks not corrupted) instead of feeding plausible extrapolated values everywhere; the flame sensor's ADC rail state is surfaced as a wiring hint at standby.
- Calibration pages no longer show "Saved" before the ECU accepts the save (fuel pressure, oil wizard, throttle, idle, P1/P2, fuel flow, flame threshold).
- Tools: Starter Idle Assist got a proper arm/disarm control, the dashboard got a peak-values reset button, wet-glow tests show the real demand percent, and PWM-configured accessory tests say they drive FULL output.
- The Playwright browser-audit suite is runnable again (stale cache/scope assertions updated to current behavior); it now also covers the beta safety notice, the igniter 1/2 tool-timing split, and unit-preference-aware flight-log summaries.
- First boot no longer fails GPIO validation and locks START (factory `di_channels` active-mode masks were out of the accepted range; masks are now accepted and clamped with a logged warning instead of rejected).
- Thermocouples: MAX31856 open-circuit detection enabled, configuration readback-verified, and MOSI required at save; MAX6675 no longer flags 0.0 °C as a fault; DS18B20 reads no longer stall the ECU loop and a genuine 85.00 °C is accepted; analog linear sensors clamp to their calibrated range instead of extrapolating.
- Igniter coil dwell is hard-capped even with a failed current sensor; starter demand is forced to 0 while the enable relay is off; glow "hot" requires a healthy current sensor; HX711 disconnect is detected instead of reading noise.
- An interrupted OTA upload no longer locks maintenance actions until power-cycle, and a pending deferred save can no longer overwrite a fresh factory reset or restored config.
- Web UI truth pass: role-aware DI badge colors, honest Dev Mode banner, normal inactive states no longer render as red sensor faults, the sequence editor no longer collapses open panels on every keystroke, Hardware save preflight covers every backend-required pin and names reversed PWM/servo ranges, user-entered sequencer text is escaped, and boot load-warnings in the flight log read as warnings rather than as edits.
- Bumped firmware/UI version to 1.3.0 for beta-test builds.
- Documented the current Config lock rule: Config is locked while the engine is active unless Dev Mode was enabled from STANDBY; Hardware, full restore, OTA, and reboot-required changes remain STANDBY-only.
- Restored Hardware page controls for the passive buzzer so fitted buzzer pins can be assigned, validated, and included in GPIO conflict checks.
- Replaced stale flashing instructions that referenced a missing helper script with the actual PlatformIO firmware and filesystem upload commands.
- Aligned the factory profile and setup guide with the standard N1-free setup; primary EGT safety can use TOT or TIT, while N1-dependent dynamic idle, overspeed, surge, and auto-relight remain optional features.
- Flight log run summaries now preserve TIT peaks and the Log page reads the real firmware event field names (`n1Rpm`, `totDegC`, `titDegC`, `oilBar`, `maxTot`, `maxTit`).
- Dashboard EGT approach warnings now follow the selected engine-safety EGT source instead of always treating TOT as primary.
- Extra Cooldown UI/docs now describe the actual Sequencer CooldownSpin actuator settings instead of fixed starter-plus-oil behavior.
- Documentation now calls out ESP32-S3 GPIO48 NeoPixel status LED mode separately from plain GPIO status LEDs, and platform notes no longer refer to old GPIO38/S3 auto-detect assumptions.

### Documentation
- Added `docs/BETA_USER_GUIDE.md` with first-flash, first-setup, calibration, dry-test, first-fuel, backup/restore, update, and troubleshooting guidance for beta testers.
- Added a beta-readiness review plan covering supported setups, dependency gates, critical user flows, and required verification.
- Updated the README hardware/setup guide to reflect the unified `ecu_config.json` engine file, runtime hardware configuration, OTA web assets, and current ESP32-S3 target.

---

## [1.1.0] — 2026-05-24

Major feature release. Significant expansion of hardware support, safety system, and afterburner capability.

### New: Afterburner system
- Full afterburner state machine (Off → Arming → Igniting → Running → ShuttingDown → Fault)
- Configurable AB ignition sequence: ABCheckReady, ABIgnite, ABFlameConfirm, ABStabilize
- ABIgnite: torch mode (opens main fuel solenoid briefly to confirm TOT rise before committing fuel), separate igniter 2 channel, configurable retries
- AB fuel offset applied at actuator level — does not contaminate ThrottleSlew feedback
- AB pump demand follows throttle (lerp min→max) or fixed at max, configurable
- Trigger sources: manual (web UI), throttle threshold, dedicated switch pin, analog/RC input
- Rising-edge latch prevents rapid re-entry while trigger is held after Fault
- Arm-switch gate (optional): AB only fires when arm switch is also asserted
- ABCheckReady validates armed/throttle/TOT conditions before ignition sequence starts
- ABFlameConfirm: TOT-rise confirmation alternative to photodiode (for AB without flame sensor)
- Independent DI channel role `ab_fire` for external trigger
- `enterFaultShutdown()` synchronously stops AB sequence; AB actuators cut immediately

### New: Safety monitor checks
- **EGT rate-of-rise** (`TOT_RISE`) — triggers before temperature limit is reached; configurable °C/s
- **Hot start detection** (`HOT_START`) — aborts startup if TOT exceeds threshold; configurable per-engine
- **Compressor surge detection** (`SURGE`) — N1 RPM variance analysis over a 10-sample ring buffer
- **TIT overtemp** (`TIT_OVERTEMP`) — turbine inlet temperature limit, independently enabled
- **Oil temperature high** (`OIL_TEMP_HIGH`) — oil temp limit, independently enabled
- **Fuel pressure low** (`FUEL_PRESS_LOW`) — active in RUNNING only, independently enabled
- **Battery / bus undervoltage** (`BATT_LOW`) — configurable minimum voltage, independently enabled
- All safety checks now independently enabled/disabled via HardwareConfig flags
- Each fault provides a plain-language `faultDescription` with "what to do" guidance shown in the web UI

### New: Sensors
- **MAX31856TempSensor** — direct SPI bit-bang; supports all thermocouple types (B E J K N R S T); 19-bit resolution (0.0078 °C/LSB); continuous-conversion mode
- **DS18B20TempSensor** — async 1-Wire Dallas/Maxim thermometer; non-blocking requestTemperatures/read cycle; 9–12 bit resolution; filters 85 °C power-on reset value; placement-new (no heap)
- **NTCSensor** — NTC thermistor with Steinhart-Hart B-parameter equation; configurable R0, T0, beta, divider resistor

### New: Controllers
- **PowerTurbineGovernor** — closed-loop N2 RPM P-controller driving propeller pitch servo for turboprop/turboshaft builds; dt-scaled output; hard pitch slew cap; pitch-primary mode

### New: Blocks
- **GlowPreheat** — current-sensor-based glow plug saturation detection (dwell/rest state machine); skips immediately when no glow plug configured
- **BleedOpen / BleedClose** — compressor bleed valve commands for surge prevention
- **FuelPump2Set** — set secondary variable-speed fuel pump demand
- **FuelPumpRamp** — ramp fuel pump demand from current to target over configurable time
- **GovernorHold** — hold N2 governor at target until RPM is stable
- **FuelPulse** — pulsed fuel open/close cycle as alternative to continuous FuelOpen
- **WaitTOTCool** — block until TOT falls below configurable target
- **WaitForInput** — block until a configured DI channel activates (with timeout)
- **ThrottleSet** — set throttle demand to a specific value and hold
- **PreHeat** — configurable pre-ignition heating stage
- **ModifiedIdle** — post-startup idle at a lower RPM for one sequencer cycle
- **TempConfirm** — TOT-rise based flame confirmation (alternative to FlameConfirm for builds without a photodiode)
- **TimedDelay** — simple configurable delay block
- **ActuatorBlocks** — IgniterOn/Off, Igniter2On/Off, FuelSolClose, StarterEnOn/Off, StarterOff, OilPumpOn/Off, OilScavengeOn/Off, CoolFanOn/Off, AirstarterOn/Off, ABPumpOn/Off, ABIgnOn/Off, ABSolOpen/Close

### New: Hardware support
- **ESP32-S3** build environment (`esp32s3dev`) — correct ADC1 pin range (GPIO 1–10), USB pins reserved
- **Glow plug** with optional current-sense feedback
- **Oil scavenge pump** — second oil pump for scavenge/dry-sump systems
- **Fuel pump 2** — independent variable-speed secondary fuel pump
- **Air-starter solenoid** — pneumatic starter valve
- **Cooling fan** — relay or LEDC PWM
- **Buzzer** — passive piezo with patterns: rapid fault beep, startup chirp (×2), running beep, shutdown beep
- **MAVLink v1 output** — hand-crafted HEARTBEAT, NAMED_VALUE_FLOAT, STATUSTEXT over any UART TX; CRC-16/MCRF4XX (X25)
- **DI channels (×4)** — configurable role per channel: `fault`, `estop`, `ab_arm`, `ab_fire`, `limp_mode`, `inhibit_start`; debounced; rising/falling edge handling; boot-state seed prevents spurious triggers
- **Torque / shaft power** — optional analog torque sensor with shaft power calculation
- **Oil temperature** sensor support
- **TIT sensor** (turbine inlet temperature) — separate sensor channel from TOT
- **P1 / P2 pressure** sensors — configurable in hardware, displayed in dashboard
- **Battery voltage** — configurable divider scaling
- **Prop pitch servo** — for turboprop/turboshaft power turbine governor

### New: System
- **RulesEngine** — up to 8 user-defined automation rules (sensor, comparison operator, threshold → actuator demand); evaluated last in the control chain after all safety checks
- **Sequence validator** — runs at boot and after `buildSequences()`; checks block names (unknown names flagged as errors), required sensors per block, and config sanity (e.g. `idleUseN2=true` without N2 sensor); results stored in EngineData and shown in the Sequence web page
- **HardwareConfig** — full runtime hardware topology stored in `ecu_config.json hardware` section; covers pins, sensor types, safety enables, sequence names, DI config, AB config, MAVLink, cluster serial, buzzer, status LED; `save()` uses read-modify-write to preserve other config sections
- **Config automation rules section** — `rules[]` array in `ecu_config.json`
- **Config version mismatch detection** — warning shown in web UI when firmware default fields differ from saved config
- **Peak value tracking** — session maxima for N1, N2, TOT, TIT, P1, P2, oil temp, fuel pressure, battery voltage; health-gated; reset via web command
- **Run count and engine-time accumulator** — NVS-persisted; bench/dev runs excluded
- **Web UI assets gzip-compressed** — `data/` contains `.gz` versions; original sources in `data_src/`; significant LittleFS space savings; `tools/gzip_data.py` provided for regeneration
- **Relight attempt counter** — tracks attempts per run in EngineData; logged in FlightRecorder
- **Limp mode** — auto-engaged by SafetyMonitor when N1 sensor is lost; also togglable via DI channel or web command; throttle capped at `limpMaxThrottlePct`
- **Starter assist** — post-spool starter engagement in RUNNING; hysteresis to prevent chattering; disabled when RPM sensor unhealthy
- **Manual relight** — hold START button while RUNNING to force igniter on (configurable via `igniterOnStart`)
- **Extra cooldown tool** — operator-initiated post-shutdown cooldown spin from web UI; duration configurable; conflicts with actuator test tools
- **Standby oil feed** — windmill protection; oil pump runs at low duty in STANDBY when N1 above threshold (e.g. engine windmilling on the bench)
- **Cooldown skip** — hold START+STOP simultaneously for configurable time during SHUTDOWN to skip to STANDBY
- **Config `requestSave()`** — deferred LittleFS write from Core 1; Config saves handled by Core 0 to avoid stalling the ECU loop

### Bug fixes
- **`SessionLogger::_evictOldSessions()`** — `entry.name()` on LittleFS can return the full path (`/logs/session_N.csv`) rather than just the filename; `sscanf` failed silently, flash could fill up without eviction; fixed by stripping directory prefix with `strrchr`
- **`WebServer.cpp` PONG rescue** — when `canSend()` was false during a full-frame WebSocket event (counter=60), `_wsPendingFull` was never set, so the PONG rescue always sent a fast frame; dashboard labels and limits would not refresh until the next 30-second cycle; fixed by saving the full-frame flag across the deferred path
- **`Config.cpp` ArduinoJson v7 const** — `_fromDoc(const JsonDocument&)` iterated `rules` array as `JsonArray` / `JsonObject` — invalid from a const document in v7; changed to `JsonArrayConst` / `JsonObjectConst`
- **`MAX31856TempSensor.h`** — dead code: first assignment of `val` was immediately overwritten; removed
- **`PlatformInit.h`** — missing `#include "../../engine/EngineData.h"`; relied on transitive inclusion from `Hardware.h`; added direct include

---

## [1.0.0] — 2026-03-20

First public release. Complete, running firmware.

### Core engine
- Block-based startup sequencer: OilPrime → StarterSpin → PreIgnSpark → FuelOpen → FlameConfirm → Spool → SafetyHold
- Block-based shutdown sequencer: ImmediateCut → RPMDrop → CooldownSpin → FinalStop
- Safety monitor: overspeed, overtemp, low oil, flameout — independently configurable
- RPM sensor health tracking: saturation, jump, zero-stuck, glitch faults
- Relight support: automatic ignition retry on flameout if N1 is above minimum
- Limp mode: throttle cap on partial sensor failure
- Standby oil feed: windmill protection in STANDBY
- Cooldown skip: hold both buttons in SHUTDOWN to bypass cooldown
- Starter assist: post-spool starter engagement to help reach idle

### Controllers
- OilPressureLoop: P-controller, throttle-mapped target, open-loop failsafe, deadband
- ThrottleSlew: configurable ramp rates, overspeed and overtemp safety pullback
- DynamicIdle: closed-loop idle RPM hold with asymmetric ramp, deadband, N1 or N2 selectable

### Sensors
- PCNTRpmSensor: ESP32 hardware PCNT, health fault tracking
- AnalogSensor: polynomial (oil), linear, threshold (flame)
- MAX6675TempSensor: SPI thermocouple with ring-buffer averaging
- MAX31855TempSensor: direct SPI bit-bang, K-type
- RCInput: interrupt-driven RC PWM decoder
- MockSensor: scripted ramp for bench testing

### Actuators
- ServoActuator: 50 Hz servo PWM
- LEDCActuator: LEDC high-frequency PWM
- RelayActuator: digital relay/MOSFET, active-high or active-low
- MockActuator: logs all calls for bench testing

### System
- JSON config (20+ sections, 80+ parameters), profile ID safety check
- FlightRecorder: persistent ring-buffer event log on LittleFS
- SessionLogger: per-run CSV stream with configurable channel mask
- ClusterSerial: OTC framed external display/device telemetry protocol
- Web interface: Dashboard, Calibration, Config, Sequence, Log, Tools
- ESP32 classic, 4 MB flash, dual OTA partition, hardware watchdog
- Core 1: ECU control loop; Core 0: Wi-Fi + WebServer + WebSocket
