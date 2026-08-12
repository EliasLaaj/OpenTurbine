# OpenTurbine final ESP32 / ESP32-S3 HIL qualification plan

Date prepared: 2026-08-10
Scope: the exact release-candidate firmware, filesystem, setup package, and PCB profiles built from this worktree
Targets: ESP32 Classic (`esp32dev`) and ESP32-S3 (`esp32s3dev`)

This is a qualification plan, not a claim that a two-board simulator reproduces a turbine. It is intended to prove every behavior that can be measured with electrical stimuli, physical output capture, representative loads, forced faults, repeated resets, and browser/API use. Combustion, fuel-system hydraulics, vibration, engine-bay EMI, thermocouple accuracy, and actuator mechanics require later system testing.

## 1. Qualification principles

1. Test the exact release artifacts. Record SHA-256 hashes for source revision, ELF, firmware BIN, LittleFS BIN, setup package, PCB profiles, and tester firmware in every campaign manifest.
2. Treat historical `dev/bench/results` as test-development evidence only. Re-run every required case after the final code change on the final images.
3. Run equivalent behavior on both chips. A pass on S3 does not qualify Classic, and a successful compile is not hardware evidence.
4. Observe both sides whenever possible: ECU telemetry/event logs plus an independent tester, oscilloscope, logic analyser, DMM, or electronic load measurement.
5. Test the negative side of every protection: no trip immediately inside the allowed region, correct trip beyond the boundary, and recovery/reset behavior afterward.
6. Preserve user flexibility. Unusual but electrically valid configurations should work. Reject only impossible hardware combinations or unsafe actions, and verify warnings remain warnings where operation is intentionally permitted.
7. A required test that is skipped is a gap. It cannot be counted as passed.
8. Never connect fuel, ignition energy, a starter motor, or a turbine during early phases. Move to powered loads and engine work only after every preceding gate is green.
9. Any firmware change invalidates all affected tests and the final uninterrupted regression. Safety or actuator-boundary changes require the full matrix again.

## 2. Required equipment

### 2.1 Core rig

- One supported ESP32 Classic DUT board and one supported ESP32-S3 DUT board.
- One Classic and one S3 capable of running OTBench so DUT/tester roles can be reversed.
- Existing `dev/bench/pinmap.json` harness, rebuilt or continuity-checked.
- 470 ohm to 1 kohm series resistor on every board-to-board signal and a verified common ground.
- Independent physical emergency disconnect that removes power from every dummy actuator/load without depending on either MCU.
- Fused, current-limited bench supply. Start at a low current limit.
- USB isolation or careful ground review if the PSU, scope, PC, and boards are simultaneously grounded.

### 2.2 Measurement and stimulus

- At least four-channel logic analyser; eight channels is preferable.
- Oscilloscope capable of measuring servo pulses, PWM frequency/duty, reset glitches, and sub-100 ms shutdown timing.
- Two DMMs or a DMM plus scope current probe.
- Programmable PSU or a safe power-interrupt/brownout fixture with timestamped control.
- Function/pulse generator for independent PCNT and PWM-duty verification.
- Four-channel DAC such as MCP4728, or calibrated external DACs, for simultaneous analog sweeps and noise injection. Do not rely only on the Classic's two DACs.
- Resistor decade box and representative NTCs.
- RC/servo pulse generator with adjustable pulse width, frame rate, dropout, and malformed pulses.
- Switch fixture capable of bounce, stuck-open, stuck-closed, and disconnect simulation.

### 2.3 Supported device and load set

- MAX6675, MAX31855, MAX31856, and at least one real K-type thermocouple for each applicable interface.
- DS18B20/OneWire sensor if that source remains supported.
- HX711 with a load-cell bridge or precision simulator.
- NAU7802 and representative bridge/load cell.
- TCA9554, TLA2528, and the actual I2C relay/ADC hardware advertised by the UI.
- Representative 3.3 V-safe digital inputs and relay-driver dummy loads.
- Dummy resistive/MOSFET loads for every relay output. Fit flyback protection to inductive relay/solenoid loads.
- Representative ESC/servo signal receivers or analysers; use actual low-energy servo/ESC hardware only after signal qualification.
- Current-sensor and pulse-flow-sensor fixtures.
- Second UART adapter/device for External Cluster and MAVLink testing.
- Phone, Windows PC, and one additional browser device for commissioning and captive-portal checks.

## 3. Bench safety and preflight gate (Q00)

Complete before flashing either DUT.

- Photograph and label every connection. Save the wiring revision with the result set.
- Continuity-test all cross-links end to end, including the historically unreliable starter/throttle jumper area.
- Verify series resistors and confirm no tester output is tied directly against a DUT output.
- Confirm Classic ADC stimuli use ADC1 while Wi-Fi is active. Explicitly test that the UI rejects or warns about invalid Classic ADC2 use.
- Confirm S3 reserved flash/USB pins are not assigned.
- Verify all dummy loads are disconnected or de-energised during reset and flash.
- Verify the physical master disconnect works with both MCUs crashed or unpowered.
- Run tester self-test: safe reset state, each generated signal, each capture input, independent N1/N2 timers, thermocouple/load-cell emulation, and timestamp accuracy.
- Cross-check one tester reading per signal with the scope or function generator. This prevents the DUT and tester from sharing the same measurement error.
- Run `doctor` and `verify-wiring`; required signals must not be SKIP.
- Back up both DUTs and record their original flash/profile state.

Pass: zero wiring conflicts, all required tester channels independently verified, physical kill proven.
Fail: any unexplained level, floating safety input, dead capture channel, or unprotected inductive load.

## 4. Artifact and result control (Q01)

Create one timestamped result directory per target and run. It must contain:

- `manifest.json`: git status/diff hash, source commit if available, all SHA-256 hashes, build flags, compiler/framework versions, target chip/revision/MAC/flash size, tester version, fixture revision, operator, date, and ambient/supply conditions.
- Complete engine-file backup before and after each campaign.
- PCB-profile binary/JSON and the effective `/api/hardware`, `/api/config`, and sequence/rule configuration.
- Raw test JSON, serial logs from DUT and tester, `/api/data`/event snapshots, session logs, screenshots for manual UI tests, and logic-analyser/scope captures for timing-critical tests.
- Explicit PASS/FAIL/SKIP per test ID with measured values and acceptance limits.
- A restoration record proving the starting configuration hash was restored after each destructive campaign.

The campaign runner should abort if firmware fingerprint, web-asset version, target chip, PCB profile, or tester wiring revision differs from the manifest.

## 5. Test profiles

Every target must run these profiles from a clean flash. Reuse the existing ten-profile matrix, but bind it to physical I/O where the feature is under test.

| ID | Profile | Purpose |
|---|---|---|
| P0 | Factory-default/minimal | First boot, open AP until password is chosen, missing-hardware guidance, no phantom outputs |
| P1 | Single-shaft simple turbojet | N1, EGT, main fuel, shutoff, ignition, starter, basic oil |
| P2 | Sensor-light/timed startup | Valid hobby configuration with minimal feedback and clear warnings |
| P3 | Full dual-shaft | N1/N2, all principal protections, logging, cluster |
| P4 | Turboprop | N2 governor with proportional pitch and separately with relay fine/coarse pitch; no reverse thrust claim |
| P5 | Generator/turboshaft | N2 governor driving main fuel, load/torque inputs |
| P6 | Pressure-controlled engine | P1/P2 idle control and pressure fuel protection |
| P7 | Dual oil system | Two pressure sensors, two independently mapped pumps, speed-based targets, flow/current monitoring |
| P8 | Afterburner | All trigger sources, arm gate, flame/EGT/timed confirmation, valve/pump/ignition combinations |
| P9 | I2C-heavy | TCA9554, TLA2528, NAU7802, native and I2C mixed critical/non-critical channels |
| P10 | Automation-heavy | 16 rules, custom blocks, side actions, duplicate outputs, explicit bindings |
| P11 | PCB-profile mode | Signed/valid profile, wrong target, wrong/corrupt profile, missing fitted device, recovery |

For profiles with user-selectable variants, cover pairwise combinations first and then explicit boundary cases. Do not attempt a combinatorial explosion of every setting value.

## 6. Boot, flash, reset, and safe-state qualification (Q10)

Run on both chips with the scope watching main fuel, fuel shutoff, ignition 1/2, starter, starter enable, AB valve/pump, glow/start fuel, oil/scavenge, and one generic rule output.

1. Fresh erase and setup-tool flash, including driver detection and wrong-port prevention.
2. First boot with blank storage; verify complete web assets, profile handling, and understandable recovery if assets are missing.
3. Cold power-on, EN/reset, watchdog reset, software restart, configuration-apply restart, factory reset, and OTA restart.
4. Hold START active at boot: no start, visible release requirement.
5. Hold STOP active at boot: START blocked and outputs remain safe.
6. Hold START and STOP together; verify recovery acknowledgement/cooldown override behavior only in its documented state.
7. Reset during STANDBY tool activation, each startup stage, RUNNING, normal shutdown, AB ignition/running/shutdown, extra cooldown, and a rule-driven generic output.
8. Verify abnormal-reset recovery: hazardous outputs stay off, START is locked, release/STOP acknowledgement works, and the lock clears only after physical off-state verification.
9. Power-cycle or reset while an I2C relay is on; verify the ECU cannot falsely claim its state is safe when the device is missing.
10. Interrupt firmware, filesystem, configuration restore, PCB-profile install, and web-asset upload at each practical stage; verify recovery or an explicit repair state with no configuration cross-contamination.
11. Brownout sweep downward and upward in controlled steps, then short dropouts at multiple phases. Record reset reason and output waveforms.
12. Confirm there is no unintended pulse on any hazardous output before setup, during bootloader entry, during reset, or while pins change ownership. Any unavoidable MCU high-impedance interval must be covered by documented external pull-offs.

Repetition: 50 cold boots, 50 warm resets, 20 brownout/dropout events per target; at least 10 resets in each hazardous lifecycle family.
Acceptance: zero unintended hazardous pulses; zero automatic START; deterministic recovery; no configuration corruption.

## 7. Physical input transport qualification (Q20)

Test every advertised transport on both targets where electrically supported.

### Q20-D digital and switches

- Active-high and active-low native GPIO; pull-up, pull-down, and external bias.
- START, STOP, inhibit-start, E-stop, fault, low-oil, oil-zero, sequence gate, AB arm/fire, Reduced-Power, and generic switch roles.
- Contact bounce below/above debounce, held-active at mode transition, simultaneous inputs, and stuck/disconnected wiring.
- ADC-threshold switch active-above and active-below, threshold capture, range-relative hysteresis, noise centered around threshold, and extreme narrow ADC ranges.
- TCA9554 equivalents and the 500 ms device-loss recheck.

### Q20-A analog

- Sweep minimum to maximum and back at 0%, 1%, 10%, 25%, 50%, 75%, 90%, 99%, 100%.
- Test calibration endpoints, reversed endpoints, two-point and multi-point nonlinear curves, interpolation boundaries, out-of-range clamping, noise/filter response, and disconnect/stale health.
- Pressure, voltage, fuel/oil flow, flame, AB flame, torque/thrust, throttle, idle, AB command, and generic analog roles.
- TLA2528 reference-voltage conversion and every device channel; disconnect and reconnect inside and beyond 500 ms.

### Q20-P pulse, RC, and duty

- N1/N2/additional speed and flow at zero, minimum reliable frequency, typical values, configured maximum, and just beyond maximum.
- PPR values below/above 1 where valid, independent N1/N2 changes, missing pulses, extra pulses, jump, saturation, zero-stuck, and rollover/long-run behavior.
- RC pulse endpoints, center, inversion, 20-500 Hz frames where supported, timeout, missing pulses, malformed widths, jitter, and reconnect.
- PWM-duty input at endpoints/intermediate values, frequency boundaries, dropout, and noise.

### Q20-T temperature/load interfaces

- MAX6675, MAX31855, MAX31856 with cold, typical, high, negative where supported, open circuit, short/fault flags, and reconnect.
- At least one real thermocouple compared against a reference meter at two stable temperatures.
- NTC/analog temperature across at least five resistance points including a nonlinear calibration fit.
- DS18B20/OneWire discovery, normal conversion, CRC/no-device fault, reconnect, and shared-bus behavior if supported.
- HX711 and NAU7802: zero/tare, positive/negative counts, gain/rate choices, calibration, overload, missing bridge/device, and reconnect.

Acceptance: measured conversion error stays within the configured calibration tolerance; health changes within its defined window; no stale value remains presented as healthy.

## 8. Physical output transport qualification (Q30)

For every output, compare logical demand, ECU telemetry, physical waveform, active polarity, and safe demand.

### Q30-R relay/on-off

- Native and TCA9554 relay, active-high/low, invert, off/on transitions, fault-safe forcing, and disconnect/reconnect.
- Exercise every relay-capable purpose, including unusual user choices. Confirm a relay-only channel cannot be saved as PWM/servo.
- Measure representative dummy load voltage/current and flyback behavior.

### Q30-W PWM

- Frequencies and resolutions at minimum, typical, and real 80 MHz timer-product boundary.
- 0%, minimum-run demand, 1%, 10%, 50%, 90%, 99%, 100%; inversion and configured safe demand.
- Multiple simultaneous channels, including buzzer/tone, to expose LEDC timer/channel collisions.
- Relay-selected pump behavior remains binary 0/100 while pressure control uses its configured deadband.

### Q30-S servo/ESC

- Endpoint pulse widths, center/intermediate positions, inversion, 50 Hz and other permitted rates, slew/ramp, and safe/park demand.
- Main fuel, starter, starter enable, oil/scavenge/coolant/secondary pumps, air starter, valves, nozzle, prop pitch, AB pump, and generic servo where allowed.
- Confirm bidirectional pulse ranges can be configured as normal endpoints, while product-specific reverse-thrust behavior remains out of scope.
- Verify prop pitch parks safely at power-up, STOP, FAULT, and reset on both chips.

### Q30-M multiple ownership and monitoring

- Duplicate purpose outputs: explicit primary binding wins; auxiliary cards remain independent rule/sequence targets.
- Remove/reorder/rename/re-purpose a middle card and prove rules/custom blocks still reach the same physical output.
- Two oil pumps with separate flow and current sensors, including long colliding names; no sensor sharing.
- Starter-enable gate must block starter demand across every native/I2C/relay/PWM/servo pairing and enforce its delay.
- Current and flow warning/trip behavior, confirmation timing, unhealthy feedback, and opt-in shutdown.
- Status LED/NeoPixel and buzzer patterns for ready, start, running, shutdown, fault, recovery, and muted/absent hardware. Confirm their LEDC/tone use does not disturb an actuator channel.
- Worst-case shared I2C load: all fitted devices polled while several relays change. Measure bus occupancy, loop time, command-to-output latency, and recovery from a stuck-low/released bus.

Acceptance: waveform and physical state match the configured driver; hazardous outputs are off whenever combustion is forbidden; no channel/timer collision changes another output.

## 9. Tools, calibration, and commissioning workflow (Q40)

- From a blank device, have a person unfamiliar with the branch configure each principal profile using only the UI and user guide. Record confusion and wrong turns as usability defects.
- Run every available Tools action on every compatible output transport. Confirm exclusivity, visible countdown, correct physical output, configured duration, 30 s hard maximum where applicable, and automatic safe return.
- Press physical STOP during each tool and extra cooldown; output must cut and remain off.
- Try START during every tool/cooldown: immediate, explained rejection; START is never left pending.
- Verify unavailable tools are hidden or clearly locked, not apparently successful no-ops.
- Exercise calibration capture/save/reload for all installed sensors and actuator endpoints, including flame/AB flame and ADC switches with hysteresis.
- Verify dev-mode running edits: only genuinely live-safe fields can change; other fields are visibly read-only/ghosted and save after returning to a safe mode.
- Test phone captive portal, direct IP, `ot.local`, password creation/change/removal policy, reconnect, two clients, and AP loss/rejoin. The AP may remain open by user choice until a password is assigned.

Acceptance: every UI success corresponds to measured hardware action or persisted data; every rejection explains why and leaves state unchanged.

## 10. Sequencer qualification (Q50)

Build a reusable campaign for every stock block and every legal lifecycle placement. Do not require every block in a real engine sequence; isolate it in a safe synthetic sequence where necessary.

- Startup: oil pressure build, starter spin/ramp/assist, pre-ignition, fuel admission, flame/temperature/timed confirmation, idle fuel, spool, final checks, air starter, glow/wet-glow, secondary pump, N2 governor hold, input gates, and side actions.
- Shutdown: immediate combustion cut, starter/fuel/ignition off actions, RPM drop, cooldown, final stop, scavenge overrun, drain/purge/bleed actions, safe-temperature wait, and no-N1 timeout behavior.
- Afterburner ignition and shutdown blocks, including abort/fault/timeout/continue outcomes.
- Custom blocks: delay, while condition, all eight steps, all four side actions, string and legacy numeric references, maximum capacities, and removal/reorder stability.
- Timeout must always be finite. Verify Abort versus Fault versus Continue exactly. A startup block fault enters safe shutdown; an ordinary timeout follows its configured outcome; a shutdown block fault cuts combustion/starter and uses bounded emergency cooling without looping.
- STOP at block entry, middle, exit, and simultaneous with natural completion.
- Sensor changes on the final confirmation sample and output changes on the same ECU loop.
- Sequence edit/save during safe mode; running live-safe config changes versus deferred block rebuild; reboot persistence.
- Track fuel-admitted/combustion-attempted/thermal-load history so cooldown occurs only after a credible heating opportunity.

Acceptance: observed block order/result/timing matches configuration; no wait-forever; STOP and fault invariants always win.

## 11. Rules and generic automation qualification (Q60)

- All 28 sensor sources and every actuator target, including registry channels.
- Above/below operators, hysteresis scaled to the actual sensor range, mapping, on/off values, and leave-unchanged behavior.
- Each mode mask: STANDBY, STARTUP, RUNNING, SHUTDOWN; transition while a rule is latched.
- Full 16-rule load with competing targets, deterministic final ownership, rule-requested shutdown/fault, and simultaneous conditions.
- Rules cannot bypass throttle slew, Reduced-Power cap, overspeed/EGT pullback, hard shutdown, AB restrictions, starter enable, FAULT safe state, pending reboot, or physical STOP.
- Edit/delete/reorder a running rule and verify its ownership is released atomically.
- Reboot, restore, duplicate/removal, stable string IDs, and shifted legacy numeric handles.

Acceptance: rule flexibility is preserved but final hardware safety invariants remain unbypassable.

## 12. Controllers and operating modes (Q70)

### Q70-F main fuel and throttle

- ADC, RC, PWM-duty, and registry operator input paths.
- Calibration, expo, minimum reliable pump output, startup/default safe value, up/down slew, missing input, and reconnect.
- Gradual N1, N2, EGT, pressure, and torque pullbacks independently and simultaneously. Confirm pullback begins before the hard trip and never raises fuel.

### Q70-I automatic idle

- N1, N2, P1, and P2 sources; simple and predictive modes where applicable.
- Load steps, deceleration, settling, learning, min/max output, sensor loss, manual disable, and restart reset.
- Confirm ordinary operator demand resumes bumplessly outside idle ownership.

### Q70-G N2 governor

- Main-fuel governor for generator/turboshaft.
- Proportional prop-pitch governor for turboprop; main fuel remains operator controlled except independent protection.
- Relay fine/coarse pitch with deadband and back-and-forth operation.
- N1/EGT limits while governor asks for more power; no controller can defeat pullback or hard shutdown.
- N2 loss, controller enable/disable, startup handoff, shutdown, Reduced-Power, and integrator reset.

### Q70-O oil control

- Up to two independent loops, each with its own pressure sensor and pump output.
- Fixed target and N1/N2 speed-mapped target, minimum/high pressure endpoints, deadband, min/max demand, PWM/servo/relay pumps.
- Startup prime, running regulation, sensor loss fallback, flow/current supervision, standby windmilling pressure mode, fixed-percent mode, cooldown, and STOP.

### Q70-L Reduced-Power and sensor failures

- Manual switch and automatic single eligible failure.
- Cap main fuel and AB coordination; AB cannot increase main fuel or drive below minimum reliable main fuel.
- Once latched, additional ordinary sensor failures keep the engine running under the preset cap as designed.
- Loss of the IC/device carrying STOP, or another explicitly terminal interlock, causes shutdown after the 500 ms recheck.
- Starter or ignition device loss alone does not shut down an already safely running engine.
- Reset/new run clears only the intended latches.

Acceptance: controller output is continuous and bounded; mode ownership is visible; safety layers remain final.

## 13. Combustion-state and afterburner logic without fuel (Q80)

- Main ignition via physical START switch, web command, and configured input/throttle workflows. Verify release/re-arm semantics and that rejected START is never pending.
- Flame, temperature, and timed main-combustion confirmation, with fresh-sample causality and false-positive/false-negative boundaries.
- Hot pre-start EGT rejection; startup EGT hard limit; short torch temperature spike below shutdown limit does not falsely fault unless its selected limit is crossed.
- Automatic/manual relight: every trigger source, minimum N1, ignition target, confirmation method, timeout, maximum 30 s ignition, STOP at each stage, and retry policy.
- Afterburner trigger sources: manual, throttle threshold, digital switch, analog/RC command. Test arm gate, held request before permission, release, failed attempt requiring reselect, and signal loss.
- AB ignition methods: dedicated igniter, torch, timed assumption, configured main-fuel coordination, flame/EGT confirmation, and no-confirmation timeout.
- AB stabilisation, running mapping, main-fuel protection interaction, Reduced-Power rejection, main-engine shutdown, AB STOP, and AB shutdown-sequence fault.
- Capture every fuel/ignition output physically with dummy loads; verify no path can restore them after terminal cut.

Acceptance: no fuel-path dummy output remains on without the selected bounded ignition/confirmation state; STOP cuts main and AB fuel/spark and keeps them off.

## 14. Safety and fault-injection qualification (Q90)

Use real operating mode, not Bench Mode or safety bypass. Replace combustion with synthetic sensor progression and dummy loads.

For each threshold, test at least: safe margin, just safe, exactly at boundary, just beyond boundary, sustained fault, single-sample spike, oscillation around boundary, unhealthy sensor, and simultaneous second fault.

- N1 and N2 overspeed.
- Running TOT/TIT overtemperature using each selectable source.
- Pre-start hot EGT and startup hard EGT.
- Underspeed/stall and flameout using flame, N1, and EGT confirmation combinations.
- Low oil and near-zero oil using analog pressure and digital switches.
- Oil, coolant, and auxiliary temperature/pressure limits.
- Fuel pressure, P1/P2, torque, battery voltage, current, and flow protections.
- RPM saturated, implausible jump, zero glitch, zero stuck, stale/missing signal.
- Native and I2C E-stop/fault/inhibit/STOP; I2C loss shorter and longer than 500 ms.
- I2C loss of critical running outputs versus non-critical starter/ignition outputs.
- Physical STOP during STARTUP, RUNNING, SHUTDOWN, relight, AB, tools, config upload, and simultaneous fault.
- Rule/controller demanding maximum fuel at the instant of every fault.
- Watchdog stall injection if a controlled test build can safely create it; final candidate must then prove recovery behavior without the injection hook enabled.

Measure stimulus edge, confirmation-window start, state transition, and physical fuel/ignition cutoff. Suggested acceptance limits:

- Physical STOP: hazardous outputs off within 100 ms, including 30 ms debounce and loop latency.
- Immediate hard fault with zero configured confirmation: off within 100 ms after a fresh qualified sample.
- Confirmed fault: off no later than configured confirmation plus 100 ms.
- I2C disconnect: no fault before the intended recheck window; terminal action by 650 ms for a 500 ms guard.
- No single unqualified spike causes a confirmed trip where a confirmation window is configured.
- Every trip provides a specific reason and records the responsible channel/fault.

Repetition: 20 repetitions per catastrophic fault per target; 10 for each auxiliary fault; 100 physical STOP presses distributed across modes. Record worst-case, median, and any outlier—not only averages.

## 15. Persistence, update, networking, and logging (Q100)

- Save/reload every Hardware, Config, Sequence, Rule, Calibration, Log, Wi-Fi, and PCB-profile field used by the matrix.
- Backup/restore same device, cross-browser, and after factory reset. Reject crossed/wrong-target/corrupt/truncated files without partial mutation.
- Configuration save concurrent with telemetry clients, log download, rule activity, START request, STOP, and scheduled reboot.
- OTA and web-assets update from current and previous supported release; interruption and recovery; exact fingerprint afterward.
- Open AP until password assignment, password persistence, user-selected open operation, wrong password recovery, captive portal, direct IP, mDNS, reconnect, and multiple clients.
- Cluster serial TX-only and two-way command/telemetry; malformed/partial frames and disconnect.
- MAVLink transmit/receive if advertised; malformed frames, loss, and reconnect.
- Session selection, no-channel behavior, full channel set, rotation/deletion, storage-full behavior, download integrity, and no writes during active engine mode.
- Runtime counters: attempts, completed runs, run hours, fault/abort counts, peaks, dev/bench exclusion, reset and long-run rollover.

Acceptance: no partial/crossed configuration, no active-mode filesystem/NVS stalls, logs explain the run, and update recovery is deterministic.

## 16. Concurrency, endurance, and environmental bench tests (Q110)

- 24-hour soak per target in RUNNING simulation with fast telemetry, WebSocket plus HTTP clients, cluster/MAVLink traffic, logging enabled, N1/N2/analog changes, rules, controllers, and I2C polling.
- 100 complete synthetic start-run-shutdown cycles per target, including at least 20 AB cycles where fitted.
- 100 I2C disconnect/reconnect cycles per device type at random lifecycle points.
- 50 configuration-save/reboot cycles, 20 OTA cycles, 20 web-asset update cycles, and 20 backup/factory-reset/restore cycles.
- Wi-Fi client churn, two-browser use, truncated requests, command queue load, repeated START/STOP, and STOP while queues are busy.
- Monitor minimum heap, largest free block, loop duration, watchdog margin, dropped sensor/log samples, HTTP errors, resets, and retained output marker.
- Repeat a shorter soak at minimum and maximum supported bench supply voltage and, if safely available, low/high ambient board temperature.
- Use an instrumented test build to cross the 32-bit `millis()` rollover with active timers, confirmation windows, logs, rules, cooldown, and I2C rechecks. Then remove the time hook and rerun the ordinary production-image regression.

Acceptance: no unexplained reset, deadlock, memory trend, output glitch, stale healthy sensor, lost STOP, configuration drift, dropped required log row, or loop-time limit violation.

## 17. Cross-platform equivalence gate (Q120)

After individual qualification, compare Classic and S3 results for:

- Same logical state transitions, fault codes, sequence results, controller bounds, rule ownership, persistence, and UI/API behavior.
- Equivalent physical relay state, PWM duty/frequency, and servo pulse within configured tolerance. Resolution may differ where the hardware requires it, but user-visible demand must not.
- Classic-specific: ADC1-only operation with Wi-Fi, 4 MB partition/update limits, full 16-bit servo path where available, strapping-pin review, no accidental GPIO16/17 use on WROVER-class modules.
- S3-specific: 8 MB partition layout, 12/14-bit LEDC limits as applicable, USB/reserved-pin protection, NeoPixel status path, warm restart with PSRAM deliberately disabled.
- PCB-profile target enforcement and recovery on both.

Acceptance: no undocumented behavioral difference. Document legitimate electrical/platform differences in the user guide and tester notes.

## 18. Powered actuator and system test gate (Q130)

Only after Q00-Q120 pass.

1. Replace each dummy output with the real actuator one at a time, still without fuel or turbine coupling.
2. Measure supply current, driver temperature, flyback, EMI on sensor inputs, mechanical direction, travel, park/off position, and response time.
3. Verify starter enable and starter motor with the coupling mechanically safe or disconnected.
4. Flow water or a safe calibration fluid through pump/valve circuits before fuel. Verify pressure/flow maps, leaks, dead-head protection, and shutdown.
5. Conduct a cold-spin turbine test without fuel: starter ramp, N1/N2 sensing, oil pressure/control, STOP, power loss, and cooldown behavior.
6. Only then create a separate controlled first-fuel/first-light plan with fire suppression, remote stop, containment, experienced supervision, conservative limits, and incremental fuel authority.

Passing dry HIL does not authorise an unattended wet start.

## 19. Repetition and sign-off policy

Minimum evidence for a release candidate:

- Full software release gate once immediately before flashing and once after the final HIL-driven code change.
- Q10-Q120 complete on both targets with zero required SKIPs.
- Three uninterrupted full functional-matrix passes per target from clean restore.
- Fault repetition and soak counts specified above.
- A second person reviews wiring, safety limits, result manifest, all failures/retries, and the final release summary.
- No unresolved P0/P1 defect. P2 issues require an explicit written risk decision and must not contradict a public safety claim.
- Any flaky test is a failure until its cause is identified as DUT, fixture, or test software and independently demonstrated.
- The final pass must use the production build without test hooks, safety bypass, or debug-only behavior.

## 20. Release claim boundary

After this plan passes, the defensible statement is:

> This OpenTurbine release passed the published software and hardware-in-the-loop qualification matrix on both supported ESP32 Classic and ESP32-S3 targets, including physical I/O, fault injection, recovery, repeated lifecycle tests, and endurance testing for the listed hardware interfaces.

Do not promise that every turbine, sensor, actuator, wiring harness, power system, or user-defined sequence will work without commissioning. Publish:

- exact tested board and device models;
- firmware and filesystem hashes;
- test matrix and result archive;
- known untested variants and hardware limitations;
- requirement for output-polarity, calibration, actuator, dry-spin, and engine-specific validation before admitting fuel.

## 21. Execution order

1. Freeze release candidate and build/hash artifacts.
2. Repair/upgrade the fixture and independently validate it (Q00-Q01).
3. S3: Q10-Q40, then Q50-Q90, then Q100-Q110.
4. Swap roles and load the Classic-safe profile; Classic: Q10-Q110.
5. Run Q120 comparison and resolve every difference.
6. Re-run affected tests after fixes, then the complete uninterrupted matrix on both targets.
7. Run powered-actuator and cold-spin Q130 separately.
8. Publish the evidence-backed qualification report and only the bounded claim above.

Master sign-off record:

| Gate | S3 | Classic | Evidence reviewed | Notes |
|---|---|---|---|---|
| Q00 fixture safety | ☐ | ☐ | ☐ | |
| Q01 artifacts/results | ☐ | ☐ | ☐ | |
| Q10 boot/reset/safe state | ☐ | ☐ | ☐ | |
| Q20 physical inputs | ☐ | ☐ | ☐ | |
| Q30 physical outputs | ☐ | ☐ | ☐ | |
| Q40 tools/calibration/UX | ☐ | ☐ | ☐ | |
| Q50 sequencers | ☐ | ☐ | ☐ | |
| Q60 rules | ☐ | ☐ | ☐ | |
| Q70 controllers/modes | ☐ | ☐ | ☐ | |
| Q80 ignition/AB dry logic | ☐ | ☐ | ☐ | |
| Q90 safety/fault injection | ☐ | ☐ | ☐ | |
| Q100 persistence/network/logging | ☐ | ☐ | ☐ | |
| Q110 endurance/environment | ☐ | ☐ | ☐ | |
| Q120 cross-platform comparison | ☐ | ☐ | ☐ | |
| Q130 powered loads/cold spin | ☐ | ☐ | ☐ | separate system gate |

## 22. Harness work needed before execution

Implemented in the pre-hardware hardening pass:

- Strict dual-target qualification orchestration with named artifact hashes,
  fail-on-SKIP core execution, fail-fast campaign status, repeated release
  campaigns, worktree/config restoration checks, and per-run logs.
- A deterministic physical-output-driven plant campaign covering causal
  starter/oil/fuel/ignition startup, flame/EGT/spool response, operator-demand
  response, STOP latching, 100 lifecycle repetitions, and a 24-hour soak.
- Final dual-target signoff tooling that requires independent reviewed evidence
  for fixture safety, reset/brownout, transport and output captures, timing,
  endurance, powered actuators, and cold spin.
- Gating process exit status for retained standalone test campaigns that
  previously only printed failures.

Still requires fixture hardware or execution evidence:

The existing campaign scripts cover much of Q20-Q100, but the following still
needs hardware, fixture definition, or additional target-portable campaigns
before calling the campaign complete:

- Extend `pinmap-classic-role-reversed.json` into the actual release fixture
  revision. The baseline correctly records current wiring and intentionally
  fails release completeness because the Classic role-reversed rig lacks DAC
  inputs and the known-dead starter capture.
- MCP4728/external-DAC support for multi-channel analog sweeps on the Classic DUT.
- Logic-analyser trigger/export integration for STOP, fault confirmation, and output-cut timing.
- Programmable power/reset control for repeatable cold boot, brownout, and interrupted-operation tests.
- A transport matrix runner covering all registry input/output drivers and polarity/inversion combinations.
- Make the remaining S3-oriented profile builders target-portable after the
  Classic external fixture pins and device addresses are final. The release
  runner must continue failing before incompatible profiles can be applied.
- New campaigns for boot/reset retained-output recovery, duplicate output
  bindings/removal, dual oil loops/flow monitors, I2C START/STOP loss,
  controller/source matrix, AB trigger matrix, and update interruption.
- Execute every campaign against the final artifacts; no historical result may
  silently satisfy a current requirement.