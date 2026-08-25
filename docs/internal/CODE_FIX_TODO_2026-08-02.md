# OpenTurbine post-audit implementation TODO

## Sensor coverage and final pre-audit corrections — 2026-08-08

- [x] Ordinary local and TLA2528 analog channels share one optional 2–6 point monotonic piecewise-linear calibration. Existing linear offset/scale remains the uncluttered default; NTC, thermocouple, pulse/frequency, and load-cell conversions remain dedicated.
- [x] Hardware validates bounded ordered raw points and consistently rising or falling physical values. Runtime clamps outside the endpoints and uses no polynomial extrapolation.
- [x] Calibration wizards persist their two-point or captured oil-pressure calibration to the authoritative registry card. Hardware exposes the general curve only under an Advanced disclosure.
- [x] P1, P2, fuel pressure, fuel flow, and battery raw telemetry now follows the selected registry input, including I²C channels, rather than an unrelated legacy ADC object.
- [x] I²C starter, starter-enable, air-starter, glow, and ignition outputs remain required at pre-START readiness when configured, but loss of starting/lighting equipment alone does not fault an established safe run. Startup blocks retain finite timeout/shutdown behavior; state-critical I²C outputs retain the 500 ms fault contract.

**Created:** 2026-08-02
**Source audit:** `docs/internal/CODE_SIM_RELEASE_AUDIT_2026-08-01.md`
**Scope:** Decisions made for OT-AUD-001 through OT-AUD-079. This is an implementation checklist, not evidence that an item is fixed. No item may be marked complete until its code, tests, generated assets, and documentation obligations pass.

## Software completion record â€” 2026-08-03

All FIX and HARDEN items below are implemented and passed the canonical software release gate on the exact locally packaged candidate. That gate includes both firmware targets and filesystem images, target budget enforcement, native command/I2C behavior, 88 safety regressions, 16 representative turbine configurations, all 10 UI audit programs, and Chromium/Firefox/WebKit at desktop and narrow viewports.

Local pre-HIL candidate package: `artifacts/OpenTurbine_Recommended.zip` (SHA-256 `C7622582BC9E812850268FC5F5554870FD6E3B4225193E3230770735C6CC0C54`). Setup Tool SHA-256: `E261E0F14D2C6B333E44FDD53BFE7B53CCCC191CBAFDF58A5BBB96AB5DA7874B`. Classic build ID: `8bf4b59008e16521`. S3 build ID: `5b424e8af379dcdc`. Its manifest explicitly records `source_dirty: true`; after the changes are committed, rebuild and repeat the software gate before treating the result as the exact publishable HIL candidate.

OT-AUD-015 and the HIL-dependent definition-of-done line remain open. These artifacts must not be published as the fixed release until the planned dry and fueled HIL campaign passes on these exact hashes, or on a newly rebuilt candidate that repeats this software gate.

## Final cross-system audit completion - 2026-08-08

The follow-up findings OT-FINAL-001 through OT-FINAL-013 are implemented in software. Reverse thrust was discussed after this audit and is deliberately deferred; no reverse-thrust mode, setting, or hidden behavior was added.

- Prop Pitch and Bleed Valve now use the same semantic local/I2C output path, safe parking, and fault behavior.
- Bleed Valve uses the canonical Servo/PWM/Relay driver numbering without preserving the incorrect rotated convention.
- Igniter and all other configurable outputs apply one driver-aware polarity/direction transform at the hardware adapter.
- Afterburner coordination cannot create fuel from zero, cannot defeat active fuel limiting, and a negative offset cannot pull a running pump below its calibrated reliable minimum.
- The visible oil-loop master is authoritative. Binary oil-pump fallback is Off/On (stored and published as 0/100), while mixed/proportional installations retain percentage control.
- N1/N2 oil maps require their selected shaft sensor. Removing it changes the affected map to fixed high pressure; running feedback loss uses the conservative high target before the established reduced-power response.
- Flow-monitor removal cleanup is exact to the removed input and does not alter unrelated pumps or remaining compatible sensors.
- Analog/RC afterburner hysteresis derives from the selected calibrated range while retaining time debounce.
- STARTUP and SHUTDOWN are fully read-only. RUNNING Developer Mode exposes only the established live-safe fields, sends changed fields only, and refetches the ECU's merged configuration after saving.
- Prop-pitch endpoint status truthfully reports fine/coarse saturation and leaves main fuel operator-controlled; the separate N2 pullback remains independent.

Hardware-free verification includes executable endpoint/recovery tests, two-stale-browser live-save coverage, all-mode Config editability coverage, the full UI browser matrix, 16 representative turbine configurations, both ESP32 target builds, both LittleFS images, and image/linker budget checks. Physical behavior remains subject to the planned full HIL campaign before release.

## Final audit correction checklist - 2026-08-08

The final follow-up set is code-complete. These checks mark implementation and hardware-free regression coverage, not physical validation.

- [x] OT-FINAL-014 - make the narrow RUNNING Developer Mode PATCH path reachable on Core 1.
- [x] OT-FINAL-015 - acknowledge the exact applied Config generation before browser rebase.
- [x] OT-FINAL-016 - prevent live Pitch Gain changes from transferring governor actuator authority.
- [x] OT-FINAL-017 - unify standby/cooldown binary oil-pump behavior and enum handling.
- [x] OT-FINAL-018 - route canonical local and I2C Bleed Valve assignments consistently.
- [x] OT-FINAL-019 - accept supported TLA2528 threshold-switch roles.
- [x] OT-FINAL-020 - make registry Start Fuel authoritative for wet-glow operation.
- [x] OT-FINAL-021 - constrain relay igniters to Simple On/Off while retaining PWM advanced modes.
- [x] OT-FINAL-022 - apply native GPIO safety interlocks before START.
- [x] OT-FINAL-023 - remove afterburner fallback from an unhealthy fitted throttle.
- [x] OT-FINAL-024 - give registry oil-pressure feedback precedence over the legacy ADC path.
- [x] OT-FINAL-025 - connect I2C Analog torque to control, protection, and telemetry.
- [x] OT-FINAL-026 - enforce real driver-specific I2C address families in firmware and UI.

Final hardware-free verification passed on 2026-08-08: 102 safety regressions, native command/controller/I2C behavior, 19 sensor protocol vectors, 24 mixed hardware profiles across seven pages, the full Chromium/Firefox/WebKit desktop and narrow matrix, both firmware and LittleFS targets, and all image/linker budgets.

- [ ] Run the complete HIL campaign on the exact rebuilt candidate before tester release.

## Product rules for every change

1. **YAGNI:** implement the smallest coherent fix for a demonstrated problem. Do not add frameworks, abstraction layers, policies, settings, or telemetry that have no current consumer.
2. **Easy by default:** the normal UI shows the few controls and one-line status a typical turbine builder needs. Advanced tuning belongs behind an **Advanced** disclosure.
3. **Expert freedom:** support unusual turbojets, turboshafts, turboprops, generators, boats, ground vehicles, test stands, external controllers, sensor-light systems, and DIY hardware. Prefer a clear warning and **Save anyway** unless a setting defeats an ECU-owned hard hardware-protection boundary or creates internally contradictory state.
4. **No silent reinterpretation:** never silently clamp, strip, autofill, migrate ambiguously, or claim success after rejection. Show the exact changed/rejected value and reason.
5. **One authoritative path:** START, STOP, input health, output activity, configuration publication, sequencer results, and sensor adapters should each have one core contract. Remove obsolete duplicate paths once migration is handled.
6. **Hard boundaries stay simple:** STOP/FAULT keeps all main and AB combustion fuel/ignition off; START is never pending; sequencers never wait forever; reboot happens only with all outputs off.
7. **Neutral terminology:** use **operator**, **control request**, **throttle input**, or **source/controller**. Do not assume an aircraft or use â€œpilotâ€ in general product UI/docs.
8. **Same product on both chips:** Classic ESP32 and ESP32-S3 retain the same behavior and features. Reject only layouts that exceed the selected target's real physical resources.
9. **Minimal clutter:** the dashboard shows a concise state/reason/action. Detailed evidence belongs on Log, diagnostics, or an Advanced commissioning view.
10. **Verification:** every behavioral fix gets an executable regression. Source-pattern checks may supplement but never substitute for behavior tests. The exact fixed release candidate must pass full HIL before publication.

## Status legend

- `[ ] FIX` â€” code/test/docs work is required.
- `[ ] HARDEN` â€” useful release or usability hardening; keep proportional to risk.
- `[x] FIX` / `[x] HARDEN` â€” implemented and verified by the canonical software gate; HIL may still remain separately open.
- `[x] ACCEPT` â€” deliberate product behavior/risk; do not â€œfixâ€ by removing freedom.
- `[x] NO CODE` â€” reviewed and intentionally requires no implementation.
- `[ ] HIL` â€” cannot complete without the exact release candidate and hardware.

## Implementation order

Work in this order to avoid repairing the same ownership paths twice:

1. Native host test harness and canonical CI gate.
2. Core command/output safety: START, STOP, limp, recovery, output activity, reboot.
3. Configuration isolation/publication and channel/input contracts.
4. Sequencer result model, bounded waits, shutdown terminal behavior, and status separation.
5. Main controller/governor/fuel-history corrections.
6. Afterburner request, ignition, evidence, and diagnostics.
7. Storage/logging/UI correctness.
8. Setup Tool, package, release, and documentation.
9. Full software regression, exact artifact verification, then full dry/fueled HIL.

## Core safety and control

### [x] FIX OT-AUD-001 â€” automatic limp cannot be cancelled in RUNNING

- Latch ECU-imposed limp until STANDBY.
- Manual/web/cluster/physical limp controls may not clear it during the run.
- Keep manual limp ownership separate enough that a manual control cannot negate the automatic latch.
- Test every entry source and attempted clear in the same control iteration.

### [x] FIX OT-AUD-002 â€” START switch boot/reconnect interlock

- Do not arm START until its selected input is healthy and has been positively observed released.
- A disconnect/reconnect while held must not create an edge.
- Expose raw level, health, configured polarity, interpreted ACTIVE/RELEASED state, and WAITING FOR RELEASE/READY state without dashboard clutter.

### [x] ACCEPT OT-AUD-003 â€” open Wi-Fi remains an intentional option

- ECU may remain open until the user sets a password, including indefinitely.
- Do not force authentication or a password.
- Show a truthful persistent warning while open: connected clients can control the ECU.
- Documentation must describe the network/client as part of the trust boundary.

### [x] FIX OT-AUD-004 â€” common 500 ms I2C health policy

- Every I2C-connected switch, sensor, and actuator gets up to 500 ms to recover from device/bus loss.
- Recovery within the window records a transient diagnostic and resumes.
- After 500 ms, latch the exact device/channel fault.
- Critical control paths such as STOP, E-stop/fault, fuel-output control, or inability to enforce a fuel cap initiate shutdown.
- Noncritical/degradable feedback enters its configured fault/limp behavior; unavailable data never silently becomes inactive or zero.
- UI states: ACTIVE, INACTIVE, UNAVAILABLEâ€”RECHECKING, FAULTED.

### [x] FIX OT-AUD-016 â€” disabled Control Rules have no ownership

- A disabled rule does not evaluate, apply ON/OFF values, or reserve its target.
- Disable/delete releases to another legitimate owner or physical zero.
- Preserve nonzero OFF values for enabled rules.

### [x] FIX OT-AUD-017 â€” implement Standby rules

- Preserve and execute the Standby mode bit consistently in UI, firmware, import, persistence, docs, and tests.
- Do not silently strip or delete Standby-only rules.

### [x] FIX OT-AUD-018 â€” rule ownership exists only in selected modes

- Inside selected modes: condition true uses ON value; false/unavailable uses configured OFF value.
- Outside selected modes the rule releases ownership completely.
- Recompute the underlying non-rule demand each loop; never restore a stale last physical value.

### [x] FIX OT-AUD-028 â€” one authoritative START gate

- Every source reaches the same final ECU-core START interlock.
- START is rejected when any unexpected physical output is active, including device-backed outputs; preserve only explicitly allowed standby lubrication behavior.
- Return the exact blocking output and owner; do not silently cancel it and start.

### [x] FIX OT-AUD-030 â€” mark reset state safe only after stable all-off

- Clear the retained active/recovery marker only after a complete stable-safe loop proves safe mode, no hazardous demands/owners/sequences, and successful physical output writes.
- Include critical I2C output availability in the decision.
- Inject resets between every safe-transition operation.

### [x] FIX OT-AUD-031 â€” bounded automatic relight

- Hardcoded absolute relight supervisor: 30 seconds from first detected flameout; it cannot be reset by retry-state cycling.
- A configured shorter timeout remains effective; zero means use the 30-second maximum; values above 30 seconds are rejected/clamped with an explicit message.
- Keep a finite per-run attempt limit; initial default is three unless existing configuration evidence justifies another small value.
- Success requires post-trigger causal evidence (flame, EGT, N1 recovery from captured baseline, combined evidence, or explicitly unverified timed assumption).
- At the hard deadline cut fuel and enter fault shutdown.
- Preventive continuous ignition is a separate mode, not an active relight attempt.

### [x] FIX OT-AUD-034 â€” existing limp covers every required EGT use

- No new policy/UI setting.
- Loss of EGT used by any enabled RUNNING protection/control (including flameout or pullback) activates the existing latched limp and safe-fuel cap.
- Use the authoritative requirement predicate consistently.

### [x] FIX OT-AUD-036 â€” limp always disables AB

- Effective limp immediately cuts AB fuel valve/pump, igniter, torch/main offset, pending arming, and ignition sequence.
- Main engine remains at its limp cap.
- AB stays inhibited until STANDBY and shows one concise reason.

### [x] FIX OT-AUD-037 â€” continue in limp after additional ordinary sensor losses

- This is an intentional availability policy: additional ordinary feedback failures do not automatically shut down.
- Continue tracking and displaying the complete failure mask even while limp is active.
- Keep main fuel at the hard limp maximum; no upward authority; AB remains off.
- Shutdown only for critical control-path loss: STOP/E-stop/fault infrastructure, inability to command fuel/fuel shutoff or enforce the limp cap, internal control-integrity faults, or a channel explicitly classified shutdown-critical.

### [x] FIX OT-AUD-041 â€” START is never pending; STOP is a cancellation barrier

- A START request is evaluated once at the next authoritative ECU-core boundary and is immediately accepted or rejected.
- It never waits for conditions; rejected physical START requires release/new press.
- Web/API waits for the core result rather than reporting queue insertion.
- STOP invalidates every older START; a post-STOP START requires a genuinely new action after STOP release.
- AB may have a visible held-request/arming state, but an old queued AB_FIRE cannot survive AB_STOP.

### [x] HARDEN OT-AUD-042 â€” truthful reset-state wording only

- Rename **Power-on state/demand** to **Post-boot initialization demand**.
- Document that software cannot guarantee GPIO state during electrical reset/bootloader/config-load time.
- External bias/power gating remains builder responsibility, not a firmware-enforced requirement.
- Capture reset/brownout output behavior during HIL.

### [x] FIX OT-AUD-046 â€” STOP owns every mode

- STOP cancels timed tests, calibration/manual demands, relight, AB activity, temporary registry demands, and every other temporary output owner in STANDBY, FAULT, STARTUP, RUNNING, and SHUTDOWN.
- In active operation it immediately latches combustion off and enters bounded shutdown/cooling.
- In STANDBY/FAULT it drives outputs off.
- Held STOP rejects every new energizing command.
- No client lease/heartbeat framework is required for this fix.

### [x] FIX OT-AUD-047 â€” output activity is driver-aware

- GPIO endpoint presence requires a valid GPIO; I2C relay presence requires a valid device/channel.
- Scan authoritative demand for every installed physical endpoint in START, update, restore, reset, reboot, and tool mutual-exclusion gates.
- If a hazardous output device is unavailable while demanded beyond the 500 ms policy, treat it as a critical output-control fault.

### [x] FIX OT-AUD-049 â€” immediate hard cut is combustion-specific

- STOP/FAULT immediately latches main and AB combustion off: main fuel/throttle, fuel shutoff/admission, start/wet fuel, main ignition/glow, AB valve/pump, AB igniter, and torch offset.
- Rules, sequences, manual commands, and AB logic cannot restore those demands through shutdown.
- Starter, oil, cooling, scavenge, and other mechanical outputs reach safe state through bounded shutdown/emergency policy; do not promise immediate starter-off if cooldown intentionally uses it.
- Clear combustion-off only for a genuinely new authorized START/maintenance action after STOP release.

### [x] FIX OT-AUD-052 â€” sticky recovery-required marker

- Set before engine operation or any hazardous manual output can energize.
- Preserve across repeated watchdog/panic/brownout resets; never clear merely because boot occurred.
- Clear only after START is released, deliberate STOP acknowledgement, and OT-AUD-030 stable-safe proof.
- Reuse the compact RTC representation; do not add speculative NVS persistence.

### [x] FIX OT-AUD-053 â€” simple shared START safety check

- Add one small `startInterlock()` used by all START sources.
- Directly check raw-active state for every fitted safety role before START; unknown/unavailable required inputs block.
- Return the first exact input/reason.
- Keep role-appropriate runtime debounce; do not build a large new interlock framework.

### [x] FIX OT-AUD-060 â€” no reboot with an active output

- Immediately before every scheduled restart, rescan authoritative physical demand.
- Restart only when every output is confirmed off.
- If any demand appears, postpone/cancel reboot and show the exact blocking output.
- Never cut protective lubrication merely to meet a reboot deadline.

## Configuration, input, and resource integrity

### [x] FIX OT-AUD-020 â€” reject duplicate singleton purposes

- Firmware owns the singleton-purpose catalog and rejects duplicates atomically on save/restore/boot.
- Report purpose plus both conflicting channel IDs.
- Do not auto-select/disable duplicates. Explicit redundancy is a separate future feature.

### [x] FIX OT-AUD-021 â€” restore is isolated and reboot-applied

- Parse/validate complete restore into isolated candidate objects.
- Persist atomically only after all sections pass.
- Failure leaves live runtime and stored config unchanged.
- Apply hardware/registry only after successful reboot.

### [x] FIX OT-AUD-029 â€” split hardware topology from runtime tuning

- Hardware topology, pins, drivers, registry, sequence structure, and full restore are isolated, atomically saved, and reboot-applied.
- Safe live settings publish as one immutable snapshot on the ECU core at a loop boundary.
- Developer Mode may apply explicitly supported tuning fields during RUNNING through the same atomic core transaction, with old/new value logging and bumpless/ramped output behavior where needed.
- Hardware bindings and sequence structures saved mid-run take effect later; Developer Mode does not bypass hard protection limits.

### [x] FIX OT-AUD-050 â€” implement I2C ADC threshold switches

- Convert calibrated analog samples to a conditioned Boolean using polarity and ON/OFF hysteresis.
- Carry health/freshness and the 500 ms device-loss policy.
- Use the same contract for every advertised supported role, including safety/control inputs.
- Generate/test the UI/firmware purpose-driver matrix and return precise channel errors.

### [x] FIX OT-AUD-055 â€” remove obsolete split TIT safety logic

- Delete obsolete `safetyTitOvertemp` runtime field, snapshots, branches, serialization, and tests.
- Retain legacy `tit_overtemp` only as a one-time import alias if needed.
- Use the unified selected-EGT overtemperature model only.
- Never alter an explicit zero during unrelated saves.
- On genuine enable/source change, suggest a value and require explicit confirmation; never silently write 900 C.

### [x] FIX OT-AUD-056 â€” target-aware LEDC validation

- Model every core/auxiliary/registry PWM or servo plus buzzer use against the selected chip's actual channel/timer resources.
- Reject impossible layouts before persistence and name conflicts.
- Show a compact used/available recap only where helpful.
- Preserve identical features on Classic/S3; no software-PWM fallback.

## Sequencer architecture

### [x] FIX OT-AUD-032 â€” indefinite readiness waits live outside sequencers

- `timeout = 0` never means forever inside any sequencer.
- Indefinite nonhazardous readiness belongs in an ARMED/WAITING state before sequence start, with exact unmet condition and no sequence-owned hazardous output.
- Trigger release cancels waiting.
- Every sequence wait is finite with a defined result.
- Once hazardous actions begin, failures abort safely; long-running background behavior belongs in controllers/rules/states.

### [x] HARDEN OT-AUD-033 â€” warn truthfully about unsupervised safety-switch wiring

- Continue supporting simple direct-GPIO and I2C-expander switch wiring.
- Clearly state that a field-wire break can look identical to an inactive/open switch and cannot be detected from one unsupervised Boolean input.
- Do not describe active-low/pull-up wiring as line-supervised or wire-break-safe.
- Warn prominently when a critical safety role uses unsupervised wiring, but allow Save anyway.
- Distinguish whole I2C device/bus loss (covered by the 500 ms policy) from a broken wire downstream of a healthy expander.

### [x] FIX OT-AUD-035 â€” included shutdown blocks require valid finite timing

- Firmware enforces nonzero minima for RPMDrop, CooldownSpin, and FinalStop on API/import/boot.
- A custom installation omits an unnecessary block deliberately; zero is not a hidden skip.
- Reject rather than silently clamp.

### [x] FIX OT-AUD-038 â€” dedicated shutdown failure terminal

- Abort/Fault during SHUTDOWN never restarts the custom shutdown sequence.
- Immediately latch combustion off, leave the editable sequence, run a fixed bounded emergency oil/cooling policy, then physical all-off and diagnosed FAULT/lockout.
- Emergency path contains no editable or indefinite waits.

### [x] ACCEPT OT-AUD-039 â€” free-form AB sequencing remains allowed

- Do not reject confirmation-before-ECU-fuel ordering because fuel/ignition may be external.
- Warn and show the predicted timeline/ECU outputs; allow Save anyway.
- Optional external-light-up marker may improve logs but is not required.
- Do not label pre-action evidence as causally verified.

### [x] FIX OT-AUD-040 â€” specialized blocks stay in valid contexts

- Migrate/reject wrong-context specialized stateful blocks.
- Keep `StarterSpin`, AB-specific state transitions, and shutdown terminals in their owning sequence.
- Preserve expert cross-system flexibility through generic actuator actions/custom blocks with explicit ownership and cleanup.
- Do not create shared stateful block instances across simultaneous sequencers.

### [x] FIX OT-AUD-043 â€” finite oil/final-check/cooldown-skip holds

- Firmware enforces UI minima for OilPrime dwell, SafetyHold stability/timeout, and cooldown-skip hold.
- Block present means valid finite timing; remove it or manage readiness outside the sequencer when not needed.
- Cooldown skip is either disabled or requires a deliberate nonzero hold.

### [x] FIX OT-AUD-044 â€” independent main and AB sequence status

- Separate current block, index/total, wait reason, result, timestamps, and fault data for main and AB.
- Callbacks receive the exact sequencer/block/result directly; never infer fault identity from shared display state.
- UI/logs can show both timelines without crowding the main screen.

### [x] NO CODE OT-AUD-045 â€” sensor-free/external startup is intentional

- Do not add mandatory ECU combustion proof, final-state restrictions, or new preview requirements under this finding.

### [x] FIX OT-AUD-062 â€” real late-start governor handoff

- After combustion/self-sustaining speed and required oil/temperature checks, initialize the real N2/prop governor bumplessly from current demand.
- Run it during a late-start engagement phase, require healthy feedback and stable in-band hold, then enter RUNNING without a step.
- Finite failure returns to safe startup abort.
- Engines without a governor omit the phase.

### [x] FIX OT-AUD-063 â€” turbine-specific result semantics

- Complete: run success actions and continue.
- Timeout-Continue: only for explicitly optional conditions; log and run explicit accepted-timeout actions.
- Timeout-Fault: required proof timed out; latch combustion off and shut down.
- Abort: operator cancellation; shutdown if combustion was attempted, otherwise safe idle.
- Fault: no normal exit actions; safe shutdown and retained reason.
- Forced stop/replacement: ECU-owned cleanup only.
- Safety-proof blocks default to Fault; optional monitoring may default Continue. Retry requires a later deliberate START, not automatic replay.

### [x] FIX OT-AUD-064 â€” split fuel, combustion-attempt, and thermal history

- Replace the single coarse `fuelEverOpened` meaning with minimal explicit latches:
  - fuel admitted â€” used for immediate fuel cut/purge handling;
  - combustion attempted â€” meaningful fuel plus ignition/heat overlap; requires failed-light shutdown/cooldown path;
  - combustion confirmed/thermally loaded â€” flame/EGT/sustained running; requires full cooldown policy.
- Set at authoritative action/output boundaries, not block names.
- Pre-ignition FuelPulse alone does not force hot cooldown.
- If EGT is unavailable after a combustion attempt, use conservative timed cooldown.
- Optional external attempt/confirmation markers support external systems.
- AB-only fuel during an already-running main engine does not create a new main-start event; configured AB thermal effects may still influence normal shutdown.

## Afterburner

### [x] FIX OT-AUD-048 â€” canonical AB flame sensor adapter

- Resolve `ab_flame` once through the registry and publish raw/calibrated value, Boolean state, health, freshness, and adapter identity.
- Use it consistently for topology, calibration, confirmation, stabilization/running monitoring, telemetry, and faults.
- Test every advertised direct/I2C digital/analog adapter and device loss.

### [x] FIX OT-AUD-070 â€” AB cannot override main-engine fuel protection

- AB main-fuel coordination is a request, not an override.
- When any main fuel limiter/pullback/governor ceiling is reducing fuel, positive AB offset cannot raise main fuel above the already protected demand.
- Positive offset uses unused safe authority and the normal opening ramp.
- Negative offset cannot reduce RUNNING fuel below the configured reliable/safe minimum; hard cut may go to zero.
- Log requested offset, limiting reason, and final output.

### [x] FIX OT-AUD-071 â€” pre-attempt EGT baseline

- Capture a fresh short stable/averaged selected-EGT baseline before ECU AB fuel/ignition and preserve it for the attempt.
- EGT-rise confirmation compares against that immutable baseline.
- Require a positive threshold; zero belongs to explicit timed/unverified mode.
- Optional explicit baseline placement supports unusual external sequences.

### [x] FIX OT-AUD-072 â€” causal flame acquisition with simple modes

- Verified mode requires healthy stable OFF before fuel, then fresh stable OFF-to-ON with hysteresis/dwell.
- Provide clearly labelled alternatives: externally conditioned level and timed/unverified.
- Light-up rejects unhealthy input immediately; I2C loss handling still follows the common device policy outside active fuel admission.

### [x] FIX OT-AUD-073 â€” evidence remains valid through stabilization

- Maintain selected light-up evidence throughout stabilization; brief dropout uses configured filtering/reset policy.
- Separate light-up evidence from optional running supervision (flame, EGT, pressure, or none).
- Enter Running only after the complete selected stability policy passes.

### [x] ACCEPT OT-AUD-074 â€” AB light-up duration remains user-defined

- Do not add a hardcoded AB fuel-on cap.
- All waits remain finite, but expert users may select large finite durations.
- Calculate/display the potential first-fuel-to-confirmation/Running duration and warn prominently for unusually long paths; allow Save anyway.
- Runtime/logs show elapsed unconfirmed-fuel time and sequence state.
- STOP/AB_STOP always cuts ECU-controlled AB fuel; external fuel remains explicitly outside ECU authority.

### [x] FIX OT-AUD-075 â€” low-clutter AB trigger conditioning

- Use sensible internal presets per source: switch debounce; analog/RC/throttle ON/OFF hysteresis and small dwell; stable arm assertion.
- Basic UI shows trigger source and primary threshold/control only.
- Advanced disclosure exposes optional conditioning; zero allowed with warning for externally conditioned systems.
- Main UI shows interpreted request, while diagnostics can log raw/conditioned state.

### [x] FIX OT-AUD-076 â€” concise AB fault reason

- AB card shows current state, one exact blocking/fault reason, and required action (for example, RELEASE CONTROL TO RETRY).
- Detailed attempt evidence stays on Log; no large main-dashboard panel.
- Retain block, gates, values, evidence, first-fuel/ignition times, confirmation result, and cut reason internally.

### [x] FIX OT-AUD-077 â€” remove legacy AB-fire clutter

- Migrate legacy `ab_fire` input to the canonical registry/request representation during import/load.
- Keep one runtime Afterburner Request input path and remove redundant special handling.
- Reject only ambiguous migration with a precise repair.

### [x] FIX OT-AUD-078 â€” separate control request, permission, and execution

- Throttle request comes from calibrated operator control position, not protected fuel output.
- Permission comes from arm, N1/EGT/health/limp and configured gates.
- A held request may enter WAITING with one reason until initial permission exists.
- After a real failed ignition, require control below OFF threshold and a new request; never silently retry.
- Minimal states: OFF, WAITINGâ€”reason, IGNITING, RUNNING, FAULTâ€”action.

### [x] FIX OT-AUD-079 â€” coherent torch method and temperature guard

- `Use Torch` genuinely enables a finite main-fuel torch pulse.
- Simple UI: Use Torch, Strength, Duration, Temperature Guard (Auto/Custom/Off).
- Auto derives a torch-only cut below the configured main shutdown limit using the existing EGT protection margin.
- Custom must be below the main shutdown threshold; Off/zero disables only the local torch guard and receives a warning.
- At the guard, remove only the extra torch fuel; AB confirmation may continue. The actual main overtemperature limit retains its configured shutdown action.
- If no healthy EGT/main limit exists, Auto is unavailable; explicit Save anyway preserves sensor-light expert use.
- Dedicated AB igniter may be used alone or with Torch.

## Storage, logging, dashboard, and accessibility

### [x] FIX OT-AUD-023 â€” native labels for two Hardware fields

- Associate engine/profile name and Wi-Fi password with real `<label for>` elements; keep styling and suitable password autocomplete metadata.
- Add to automated accessibility audit.

### [x] HARDEN OT-AUD-024 â€” lightweight dashboard generation proof

- Clear a complete-generation marker before asset replacement; hash/verify the expected set; write marker last.
- If incomplete, serve a firmware-embedded recovery page and inhibit START until one complete set is proven.
- Verify S3 rollback results. Do not build dual slots or redesign storage.
- Treat as reliability hardening, not a reason to block ordinary cosmetic version differences.

### [x] FIX OT-AUD-051 â€” HTTP reflects ECU-core execution decision

- Web request waits briefly for the core's Started/Rejected decision; HTTP success means action actually started.
- Return exact rejection reason; use an internal request ID to correlate telemetry/logging.
- Active progress comes from ECU state, not a browser-only timer.
- Commands that cannot start immediately do not remain pending for later execution.

### [x] FIX OT-AUD-054 â€” theme is deferred with other safe saves

- Apply theme immediately in RAM/browser and mark shared config dirty.
- Persist through the normal STANDBY/FAULT deferred save so other browsers receive it later.
- No active-mode filesystem write. Last explicit theme selection wins.

### [x] FIX OT-AUD-057 â€” truthful bounded session retention

- Keep oldest-first eviction.
- Correct UI promise; show compact used/free/reserve/estimated capacity information.
- Record/display eviction count and last evicted session; warn before evidence disappears.

### [x] FIX OT-AUD-058 â€” CSV schema parity

- Count thrust in the diagnostic.
- Drive/test count, header, and row values from one field catalog.

### [x] FIX OT-AUD-059 â€” durable monotonic session IDs

- Allocate from max(durable run identity, highest valid stored ID)+1 with explicit overflow handling.
- Enumerate actual bounded directory entries; do not assume contiguous filenames.
- Sort/evict by durable identity so newest cannot become oldest after reboot.

### [x] FIX OT-AUD-061 â€” atomic clear boundary

- Under the recorder lock, invalidate/discard every pre-clear queued event, reset defined dropped markers, and remove the file.
- Post-clear events are retained normally and distinguishable.
- Factory reset suppresses all later persistence until reboot and verifies logs remain absent.

### [x] FIX OT-AUD-065 â€” simple verified erase/reset

- Check remove/NVS results and verify required postconditions.
- Do not schedule factory-reset reboot until the initial wipe succeeds.
- Return exact remaining items/error; user may retry.
- Do not add a multi-boot reset transaction unless real failure testing proves it necessary.

### [x] FIX OT-AUD-066 â€” compact session logger fault visibility

- Decode existing logger health/errors.
- One compact dashboard warning only while degraded; detailed status on Log.
- Distinguish no run yet from recording failed; include run/path where known.
- Clear only after a later session proves recovery or acknowledgement.
- Logging is not a general START dependency.

### [x] FIX OT-AUD-067 â€” one mutating web response contract

- All mutating fetch helpers fail on non-2xx or explicit `ok:false` and update local/success UI only after authoritative success.
- Route the fuel-minimum calibration through it.
- Contract-test every server rejection shape.

### [x] FIX OT-AUD-068 â€” persistent-stat dirty flag survives failure

- Clear dirty only after every required NVS write succeeds.
- Retry with bounded backoff only in safe storage windows.
- Expose current RAM totals separately from persisted health/last error.

### [x] FIX OT-AUD-069 â€” minimal recorder persistence health

- Internally retain pending count, retry/error, dropped count, task/mutex readiness, and last durable append.
- Show one compact indicator only when degraded; details on Log.
- Clear after verified recovery. Do not inhibit START or add permanent dashboard clutter.

## Setup Tool, release, and repository

### [x] FIX OT-AUD-005 â€” verify exact flashed build

- After reboot, Setup Tool compares selected target, semantic version, and exact build ID from the package manifest.
- Mismatch is failure with expected/installed details and retry/recovery action.

### [x] ACCEPT OT-AUD-006 â€” unrestricted OTA is intentional

- Continue accepting official, custom, and experimental ESP-compatible images.
- UI shows identifiable target, size/hash, authenticity/compatibility warning, and recovery instructions.
- Do not imply project verification or add signature enforcement.

### [x] HARDEN OT-AUD-007 â€” free unsigned distribution with hashes

- Setup Tool may remain unsigned; document the Windows warning.
- Publish automatic SHA-256 for executable/package plus source commit, build ID, and toolchain provenance.
- Provide one easy PowerShell verification command. No paid certificate requirement.

### [x] FIX OT-AUD-008 â€” one canonical required release gate

- Add extended sensor vectors to `tools/run_release_checks.py`.
- CI/release runs that same entry point in a clearly named required safety job.
- Do not duplicate test lists across workflows.

### [x] FIX OT-AUD-009 â€” real native behavioral harness

- Compile real controller/state-machine/sequencer logic for host with small reusable fake clock, sensors, commands, actuators, storage, and failure injection.
- Prioritize confirmed safety findings; grow toward more of the real ECU loop only when useful.
- Keep source-pattern audits as supplemental checks; do not build a parallel Python behavior model.

### [x] FIX OT-AUD-010 â€” complete per-image manifest

- For every image include filename, target, byte count, SHA-256, semantic version, runtime build ID, and source commit.
- Setup Tool and published release consume the same generated metadata.

### [x] HARDEN OT-AUD-011 â€” practical free solo-maintainer controls

- Required build/safety checks on `main`; explicit emergency admin bypass.
- Pin third-party Actions to reviewed commits.
- Enable free dependency/security/secret scanning where available.
- Create tags/releases through verified workflow with hashes/source commit; signing is optional, not a paid blocker.

### [x] FIX OT-AUD-012 â€” documentation matches actual release model

- Remove false signing claims.
- Document unsigned/hash-verified artifacts, target mapping, install/verify, upgrade/rollback, open network, unrestricted custom OTA, known limits, tester logs, and issue reporting.
- Keep ordinary path concise; put expert/custom detail in a clear advanced section without hiding it.

### [x] HARDEN OT-AUD-013 â€” preserve identical Classic/S3 behavior within RTC budget

- CI reports/enforces current RTC slow-memory budget.
- Compact/reorder/remove only data that does not need retention when space is required.
- Add reset/recovery tests for retained-layout changes.
- Do not remove Classic features or weaken its recovery behavior.

### [x] FIX OT-AUD-014 â€” compact cross-browser matrix

- Automated Chromium, Firefox, and WebKit at desktop and narrow mobile viewports against the simulator.
- Cover load/navigation/forms/save and error states, START/STOP presentation, sequence editing, logs, and reconnect for safety-critical workflows.
- Keep broad depth in Chromium; physical iOS/Android remains later supplementary evidence.

### [x] FIX OT-AUD-019 â€” free clipboard allocation on failure

- Load/use `GlobalFree` on every failure before clipboard ownership transfers. No new dependency.

### [x] FIX OT-AUD-022 â€” bounded streaming package extraction

- Hard limits for download, entry count, per-file size, total expanded size, and available disk.
- Validate manifest/layout and enforce limits during copy, not ZIP metadata only.
- Every temporary root has deterministic cleanup.

### [x] FIX OT-AUD-025 â€” use official driver flow and comply for esptool

- Do not redistribute unclear driver payloads; use official vendor/Windows installation/download flows.
- If esptool remains bundled, include GPL license, exact upstream version/commit, build recipe, and corresponding source/source path as required.
- Include OpenTurbine MIT license plus generated third-party notices/SBOM.
- Treat this as compliance engineering, not a legal conclusion.

### [x] FIX OT-AUD-026 â€” remove generic elevated driver helper

- Prefer official vendor/Windows elevation flow and delete the arbitrary-path helper.
- If a direct INF fallback is genuinely necessary, constrain it to verified package/log roots and use a one-time authenticated request. Do not keep that complexity otherwise.

### [x] FIX OT-AUD-027 â€” validate typed flash plan before erase

- Full erase remains the simple normal clean-install flow.
- Automatically verify detected chip/flash size, exact image set, addresses/ranges/non-overlap, partition layout, per-file hash/size, and package-root confinement before erase.
- Show technical plan only on error/Advanced; optional config backup is sufficient.

## Exact-release verification

### [ ] HIL OT-AUD-015 â€” full HIL before publishing the fixed version

- Run the complete dry electrical/output campaign on the exact candidate and verify target/version/build ID.
- Include boot/reset/brownout states, GPIO/I2C polarity and 500 ms loss/recovery, START/STOP, output-off before reboot, PWM/servo waveforms, sensors, sequence faults, limp, logging, and AB.
- Proceed to restrained fueled main-engine and AB tests only after dry checks pass.
- Review logs and freeze the exact tested artifacts before pushing the fixed version.

## Definition of done for each implementation batch

- [x] Product code implements only the selected decision above; accepted/no-code items remain intentionally unchanged.
- [x] Real executable regression fails on audited `afaf4c9` behavior and passes on the candidate where practical.
- [x] Import/API/boot boundaries match browser validation; no silent mutation.
- [x] Classic and S3 builds pass target budgets and behavior tests.
- [x] Generated `data/` assets match `data_src/`; browser matrix passes with no console errors or false success states.
- [x] UI uses neutral terminology, concise default controls, exact reasons, and Advanced disclosure for optional tuning.
- [x] User Guide, Setup Tool docs, release manifest/notes, and migration text match actual behavior.
- [x] Canonical local release gate passes; CI will rerun the same gate on the publication commit.
- [x] Exact release artifacts have target/version/build ID/hash recorded.
- [ ] Full HIL passes on the exact artifacts before publication.

## Post-implementation cross-dependency audit - 2026-08-04

This pass was performed without physical hardware. It traces the final implemented
controller, channel-registry, sequencer, rule, actuator, dashboard, and documentation
contracts after the completed items above. These are newly confirmed gaps or incomplete
implementations; they are not requests to restrict deliberate expert freedom. Keep each
resolution small, warn for unusual but valid configurations, and block only a hardware or
safety invariant.

### [x] P1 FIX OT-POST-001 - device-backed STOP loss must stop the engine

**Decision:** Option 1 — after the common 500 ms recheck window, loss of a device-backed STOP
input is a critical input fault. In STARTUP/RUNNING, cut combustion and enter fault shutdown; in
STANDBY, block START. Report the disconnected STOP input clearly and require healthy reconnection
with STOP released before normal use resumes.

- `I2CDeviceManager` correctly declares a missing/stale device unavailable after the shared
  500 ms recheck window, but `checkStopSwitch()` ignores `registryHealthy` and converts the
  unavailable input to an inactive STOP (`src/main.cpp:3243-3266`).
- The generic registry safety-role path handles fault/E-stop/oil switches but does not include
  the canonical `stop_switch` (`src/main.cpp:1651-1687`). This leaves a STOP switch expander
  disconnect unable to request shutdown, contrary to OT-AUD-004.
- Minimal resolution: after the 500 ms device window, mark the STOP unhealthy and request the
  normal fault-shutdown path while STARTUP/RUNNING. Keep a precise `STOP INPUT LOST` reason and
  require the ordinary recovery acknowledgement. Add a real behavior test for disconnect,
  reconnect, active-high, and active-low cases.

### [x] P1 FIX OT-POST-002 - make device-backed channels usable in rules and custom sequences

**Decision:** Option 1 — use one driver-aware installed/addressable predicate everywhere. Local
channels require a valid GPIO; device-backed channels require a valid address and device channel.
Present both by their configured names in rules and custom sequences, retaining the existing
unhealthy-input fallback and bounded sequence-timeout behavior.

- Both editors discard registry inputs/outputs whose native `pin` is negative, which also
  discards valid I2C channels (`data_src/pages/sequence-rules-save.js:150-175`,
  `data_src/pages/sequence-editor.js:585-634`). Firmware registry handles already support the
  I2C drivers, so an imported file can express configurations that the normal UI cannot create
  or repair.
- Canonical `start_switch` and `stop_switch` IDs are converted to legacy sensor enums before
  registry lookup (`src/system/Config.cpp:39-48`); those enums then require local start/stop
  pins (`src/system/RulesEngine.h:175-215`). The custom-sequence source translation has the
  same legacy-first behavior (`src/system/HardwareConfig.cpp:673-710`).
- Minimal resolution: use channel availability/driver capability rather than `pin >= 0`; bind
  canonical device-backed START/STOP to their registry handles; keep one label and one source
  in the UI. Test edit/save/reload and live unavailable-input behavior for Classic and S3.

### [x] P1 FIX OT-POST-003 - Pulsed Starter Assist test currently cancels itself

**Decision:** Option 1 — cancel any older temporary output owner before creating the new test,
then command exactly one bounded starter-assist pulse and return the output off automatically.
STOP cancels the pulse immediately. Add an executable command-to-output regression.

- The Tools command sets the starter assist demand and timer, then immediately calls
  `cancelTemporaryOutputOwners()` in every allowed STANDBY/FAULT mode
  (`src/main.cpp:3039-3055`). The cancellation clears the demand and timer, so the advertised
  direction/output test never energizes.
- Minimal resolution: perform the standby cleanup before claiming the test owner, or remove
  the contradictory cleanup. Preserve the normal bounded timer and STOP cancellation. Add a
  behavior test that observes nonzero output followed by automatic off and STOP-driven off.

### [x] P1 FIX OT-POST-004 - complete AB request, permission, and execution separation

**Decision:** Option 1 — complete the existing low-clutter three-stage model: derive request from
the calibrated raw operator source, evaluate engine/health permission continuously, and start the
bounded ignition sequence only after permission is stable. A held pre-attempt request may wait
with one concise blocking reason; a genuine failed ignition attempt requires release/reselection.

- OT-AUD-078 says throttle request comes from calibrated operator position. The implementation
  still compares `g_ctrlThrottleSlew.currentDemand()`/`throttleDemand`, which are changed by
  governor, Dynamic Idle, slew, limp, and fuel protections (`src/main.cpp:1918-1923`). A
  controller can therefore create or remove the AB request without the operator control
  crossing the detent.
- A fresh request enters Arming only to collect flame/EGT baseline, then starts the sequence;
  N1/EGT/throttle permission is still evaluated by `ABCheckReady` after execution begins.
  An initially unavailable permission therefore faults instead of visibly waiting for bounded
  permission as the completed decision requires (`src/main.cpp:2411-2465`,
  `src/engine/sequencer/blocks/ABCheckReady.h`).
- Minimal resolution: derive throttle request once from the calibrated input; continuously
  evaluate the small existing permission set during bounded Arming; start the sequencer only
  when permission is stable. A failed fuel/ignition attempt must still require release and a
  new request. Do not add another settings page or policy framework.

### [x] P2 FIX OT-POST-005 - finish low-clutter AB trigger conditioning

**Decision:** Option 1, range-aware — retain the 75 ms dwell and add hysteresis derived from the
selected input's calibrated usable span, not a universal raw-count value. Use a small fraction of
that span with a one-effective-sample/count minimum where quantization requires it, and never let
the OFF margin consume an implausibly large part of a narrow range. Digital trigger modes remain
unchanged. Add narrow-span, normal ADC, normalized and RC-range boundary tests.

- The implementation applies one 75 ms dwell but uses the same threshold for assert and
  release for throttle and analog/RC sources (`src/main.cpp:1918-1969`). OT-AUD-075's small
  ON/OFF hysteresis is absent, so a noisy value near the threshold can repeatedly request and
  stop AB.
- Minimal resolution: add a small internal hysteresis appropriate to normalized throttle and
  the configured analog/RC span, with no new Basic control. Reuse the existing request status
  and add boundary-vector tests.

### [x] P1 FIX OT-POST-006 - make prop-pitch fuel fallback accumulate

**Decision:** Do not accumulate governor fuel fallback in prop-pitch mode. Remove that hidden
fallback instead: the operator retains main-fuel authority and the pitch governor uses only
propeller load. If required correction reaches a pitch endpoint, publish a concise saturated/limit
status so the configuration or available pitch travel can be corrected. Independent gradual N2
fuel pullback remains responsible for overspeed reduction, followed by the hard N2 shutdown trip.
Fuel-primary governor installations without prop-pitch authority retain normal governor fuel
control. Update the title/documentation during implementation to reflect this selected behavior.

- With pitch-primary governing, physical throttle input is remapped onto `throttleDemand` on
  every RUNNING tick (`src/Hardware.h:2743-2782`). At a pitch limit the governor falls through
  and adds only one `kp * error * dt` correction (`src/engine/controllers/PowerTurbineGovernor.h:140-150`);
  the next tick erases that correction by remapping the input.
- This makes the documented fuel fallback at pitch travel limits extremely weak instead of a
  persistent governing authority.
- Minimal resolution: give the saturated fallback a small explicit accumulated trim around the
  current operator request, reset/track it bumplessly when pitch authority returns, and keep
  all normal fuel limits after it. Test both error directions, stick movement, saturation exit,
  N2 loss, and limp.

### [x] P1 FIX OT-POST-007 - oil-flow protection must watch the effective pump command

**Decision:** Option 1 — supervise every explicitly monitored pump independently using its
effective physical command, matching flow input and own confirmation timer. Auto-select the sole
compatible flow input; show a binding choice only when several exist. Preserve the configured
warning/shutdown policy and leave unmonitored or externally controlled pumps unaffected.

- `_checkOilFlow()` arms supervision only when `registryOutputDemand[i]` is nonzero
  (`src/engine/SafetyMonitor.h:553-602`). Local core oil/scavenge outputs are not registry-
  managed and their registry demand is not synchronized to `oilPumpPct`/
  `oilScavengeDemand` (`src/Hardware.h:923-932`, `src/Hardware.h:1002-1044`).
- Result: a configured local main or scavenge pump can be physically running with zero flow
  while the low-flow timer never starts. I2C and generic registry pumps take a different path,
  so the same feature behaves differently by output type.
- The confirmation arrays are keyed only as main-versus-scavenge and each output searches the
  first input with the matching purpose. Multiple same-purpose pump channels can therefore
  share/reset one timer and observe the wrong flow input.
- Minimal resolution: determine activity from the authoritative effective demand for the
  bound purpose, after minimum/final ownership rules, and pair each monitored pump with one
  explicit flow channel/timer. Use registry demand only for a truly generic output. Test local
  PWM/servo/relay, I2C relay, duplicate-purpose channels, and secondary-loop outputs.

### [x] P2 FIX OT-POST-008 - cooldown oil control must respect calibrated pump bounds

**Decision:** Option 1 — use the normal configured oil-regulation behavior while cooldown owns
the pump, with the cooldown pressure target and a bumpless seed from current demand. Respect the
selected pump's minimum, maximum, deadband and sensor-failure fallback. Binary pumps remain fixed
On/Off rather than being presented as modulating.

- `CooldownSpin` has a separate hard-coded proportional controller with gain 0.15 and a
  5-100% output clamp, while RUNNING uses configured minimum/maximum, deadband, adjustment,
  sensor-failure delay, and fallback (`src/engine/sequencer/blocks/CooldownSpin.h:38-86`,
  `src/engine/controllers/OilPressureLoop.h`).
- The same pump can therefore be commanded below its reliable minimum or above its configured
  electrical/control maximum during hot cooldown.
- Minimal resolution: retain the simple cooldown regulator but clamp it to the selected oil
  loop's saved minimum/maximum and use its configured safe fallback. Do not create a second set
  of cooldown tuning controls.

### [x] P2 FIX OT-POST-009 - make the first oil-loop binding authoritative

**Decision:** Option 1 — every enabled oil-loop definition controls its explicitly selected
pressure input and pump output with the same small regulator behavior and independent state. The
first enabled loop is merely the primary/dashboard loop. Do not skip a loop based on array order
or retain a separate legacy binding path.

- The first enabled `oil_loops[]` entry is skipped by `runAdditionalOilLoops()` and is assumed
  to be the legacy `g_ctrlOilLoop` (`src/Hardware.h:2680-2734`). That controller reads
  `ed.oilPressure` and writes `ed.oilPumpPct`, not the entry's `pressureInputIndex` and
  `pumpOutputIndex`.
- Loader mirroring works only for a local-pin first loop and validation accepts any pressure-
  role input/oil-pump-role output (`src/system/HardwareConfig.cpp:493-506, 4137-4157`). An
  imported first loop using a generic or device-backed pair can therefore tune/control a
  different canonical signal/output than the file names.
- Minimal resolution: either require the first loop to name the canonical oil-pressure/main-
  pump pair, with a clear import error, or execute every loop from its explicit indices. Prefer
  the smaller single authoritative model. Add an Advanced UI repair path only if multiple oil
  systems remain a supported advertised feature.

### [x] P2 HARDEN OT-POST-010 - warn about controller/rule ownership collisions

**Decision:** Option 1 — add one concise grouped warning per output when enabled controllers,
rules or sequence ownership can overlap in the same engine mode. Name the output and owners, do
not warn for mutually exclusive modes, and always preserve Save for intentional expert setups.

- Rules run after governor, oil, and Dynamic Idle controllers and may target the same throttle,
  prop-pitch, or oil-pump demand. The rule editor warns only about empty mode sets and duplicate
  rule targets (`data_src/pages/sequence-rules-save.js:540-557`).
- Governor and N2-based Dynamic Idle may also both be enabled; Dynamic Idle applies a final
  fuel floor after the governor. Overlapping targets/bands can prevent the governor from
  reducing fuel as expected, but validation compares each only with the hard N2 limit.
- Preserve expert freedom. Add concise save-time warnings naming both owners and the selected
  modes/targets; do not block the save. Show the current final owner in existing runtime detail.

### [x] P1 HARDEN OT-POST-011 - make prop-pitch physical direction unmistakable

**Decision:** Option 3, minimal and percentage-preserving — keep the existing percentage test and
all expert control. Add only a concise nearby/documented semantic contract: 0% is fine/minimum
load, 100% is coarse/maximum load, and inversion maps that meaning to physical travel. The user
verifies direction during the normal dry-HIL output tests; add no wizard, forced confirmation, or
extra commissioning controls.

Add one `Power-up / standby pitch %` setting. It defaults to 100% but remains freely configurable
from 0-100% for different mechanisms and turbine arrangements. Apply it as soon as the actuator is
initialized, throughout standby, and as the startup seed until an explicitly configured rule,
sequence action, or controller takes ownership. A temporary percentage test returns to this value,
not an implicit 0%, when it ends or is cancelled. Runtime N2-feedback loss, Reduced-Power, and fault
shutdown retain the fixed 100% coarse/maximum-load safety command; the configurable parked/start
value must not weaken those running safety responses.

- Firmware semantics are safety-significant: 0 is fine/unloaded, 1 is coarse/loaded, and
  N2-loss/limp/fault commands 1. The Hardware editor describes only electrical pulse endpoints
  at 0% and 100%, without those physical meanings, and the current tool test does not walk both
  endpoints.
- A reversed installation makes the intended overspeed-safe command unload the shaft.
- The generic Fault override editor describes the initialized core state as Off and offers a
  checkbox, but firmware always forces prop pitch to semantic 100%/coarse during fault shutdown
  regardless of that checkbox (`data_src/pages/hardware-registry-catalog.js:478-481`,
  `src/Hardware.h:1048-1107`). Hide the ineffective generic control for this purpose and state
  the real invariant.
- Minimal resolution: label both semantic endpoints beside the existing electrical values, retain
  the existing percentage test, add only the one power-up/standby percentage field, and require
  physical direction and the configured return position to be checked in dry HIL. Inversion
  remains freely configurable.

### [x] P2 HARDEN OT-POST-012 - report controller activity, not only configuration

**Decision:** Option 1, implemented minimally and read-only. Publish one compact effective runtime
state for each applicable controller: Active, Waiting/Inhibited with a short existing reason,
Feedback Lost/Reduced-Power/Fallback, or Off. Show the effective target with its correct source and
unit. Derive this from controller and sensor states already present; do not add configuration,
another control state machine, charts, or detailed UI clutter. If exposing a state would require
duplicating control logic, instead publish the controller's existing authoritative state directly.

- Governor telemetry exposes configured mode/enabled state but no active authority, feedback-
  lost state, or pitch-saturated fuel fallback. The dashboard therefore showed
  `PROPELLER-PITCH CONTROL`, N2 target 25,000, actual 0, while N2 was explicitly unhealthy.
- Automatic Idle similarly shows its target whenever its toggle and RUNNING are true, even when
  its selected feedback is unhealthy, target/limit is unusable, or feedback is above the
  controller's stop threshold (`data_src/app.js:608-617`,
  `src/engine/controllers/DynamicIdle.h:39-98`).
- Pressure-feedback Dynamic Idle is still published/rendered as `idle_target_rpm`; the dashboard
  can show an unrelated RPM target even though the active unit and target are bar
  (`src/system/web/WebServer.cpp:1187-1189`).
- Minimal states are enough: inactive with one reason, active with authority, and for governor
  pitch-saturated/fuel-fallback. Show the selected idle source in its correct unit. Keep tuning
  details off the main dashboard.

### [x] P2 FIX OT-POST-013 - base oil-pressure mapping on effective engine demand

**Decision:** Option 1, plus a simple per-loop shaft-speed target option. Each configured oil loop
selects one target source: Fixed pressure, Effective core-fuel demand, N1 speed, or N2 speed. Fixed
uses one pressure target. Fuel mode maps 0-100% final effective main-engine fuel demand to the
configured low/high pressure and excludes afterburner-only fuel. N1/N2 mode maps a user-defined
low/high shaft-speed range to a user-defined low/high pressure range (for example 0-20,000 RPM to
2-3 bar), clamping at both ends. Show only the fields used by the selected mode; do not create a
second oil controller or an advanced curve editor.

Only offer N1 or N2 when that feedback exists. If the selected shaft-speed signal becomes
unavailable while the oil loop is required, retain oil delivery and use that loop's configured
high-pressure endpoint as the conservative target while exposing the existing feedback-loss/
Reduced-Power reason. The normal oil-pressure feedback failure and pump fallback policy remains
authoritative. Validate that pressure endpoints are compatible with the configured low-oil fault
and warn, without blocking expert configurations, when a map decreases pressure as speed or fuel
increases.

- The oil throttle map is calculated immediately after operator input mapping and before the
  governor, Dynamic Idle, rules, fuel protection, and AB coordination (`src/Hardware.h:2784-2819`,
  `src/main.cpp:3708-3726`). The oil target can remain at operator idle while a later owner
  commands high main fuel.
- Minimal resolution: calculate each loop's selected target immediately before that loop is
  regulated. Fuel mode uses final protected base main-fuel demand (or the previous tick's final
  value to avoid an algebraic loop) and never AB-only additions. RPM modes use conditioned N1/N2
  feedback. Test physical throttle plus Dynamic Idle, governor, rules, Reduced-Power, AB offset,
  both RPM sources, range clamping, and loss of the selected speed signal.

### [x] P2 FIX OT-POST-014 - remove the physically impossible Dynamic Idle floor range

**Decision:** Option 1 — remove `Minimum Fuel Range Multiplier` from configuration, UI,
serialization, validation, and controller logic. The calibrated minimum reliable fuel-pump output
is the single nonzero Dynamic Idle floor. Zero remains available to combustion shutdown and other
authoritative fuel-cut paths. Migrate legacy configurations by safely ignoring/removing the old
field; do not replace it with another setting.

- `min_multiplier` may lower the controller floor below the calibrated minimum reliable fuel-
  pump output (`src/engine/controllers/DynamicIdle.h:99-152`). The final actuator boundary turns
  any positive demand below that calibrated minimum into zero rather than delivering the lower
  command (`src/Hardware.h:2431-2434`).
- This creates a zero/jump region while the UI describes a usable lower fuel range.
- Minimal resolution: clamp the controller floor to the calibrated reliable minimum, or remove
  the multiplier as ineffective tuning. Prefer removing/clamping over adding another special
  output policy.

### [x] P1 FIX OT-POST-015 - classify prop-pitch and other hazardous I2C outputs

**Decision:** Option 1 — use one small purpose/dependency-aware safety classifier and the standard
500 ms I2C recheck window. Prop pitch and universally hazardous/core outputs are always critical.
Other outputs are critical only when their configured role is required by an enabled safety,
controller, or engine invariant; optional auxiliaries must not cause an unnecessary shutdown.
Evaluate all installed channels on the unavailable device, so one harmless channel cannot mask a
critical channel sharing the same IC. A critical loss blocks START in standby and causes fault
shutdown in STARTUP/RUNNING. Preserve the already-decided Reduced-Power behavior for genuinely
noncritical losses and expose the device/channel reason. Do not add a per-channel `Critical`
checkbox.

- Loss of an engine-affecting I2C relay faults only for a fixed purpose list. That list omits
  `prop_pitch` and `bleed_valve` (`src/Hardware.h:884-904`). At minimum, a device-backed
  prop-pitch output is safety-significant because the ECU can no longer command coarse/load on
  N2 loss or fault.
- Minimal resolution: include prop pitch. Classify bleed/nozzle/cooling/drain/purge by whether
  loss can violate a configured engine invariant; use one small purpose classifier and avoid
  treating harmless auxiliaries as mandatory. Test loss while active and inactive.

### [x] P3 HARDEN OT-POST-016 - replace false `Not used yet` hardware labels

**Decision:** Option 1 — replace `Not used yet` with one concise status derived from existing
dependencies. Show the most significant active control/calculation use when present (for example
Dynamic Idle or shaft-power calculation), otherwise `Monitoring only` for values still available
to the dashboard, logging, or rules. Do not enumerate every consumer or add a dependency panel.

- Hardware usage reporting omits monitoring/config-only consumers such as P1/P2/torque
  protections, dashboard telemetry, calculated shaft power, and some limit-only uses. The full
  simulator consequently labels fitted Fuel Flow, P1, P2, and Torque as `Not used yet` while
  they are actively monitored or used for calculations.
- Minimal resolution: distinguish `Monitoring only` / `No control or safety consumer` from
  genuinely unused. Do not list every downstream widget.

### [x] P2 HARDEN OT-POST-017 - make the canonical native-test gate deterministic on Windows

**Decision:** Option 1 — at the canonical test-wrapper boundary, retry once only when launching
the exact same native-test binary fails with Windows Application Control error 4551. Preserve a
visible note that the first launch was policy-blocked. Compilation errors, assertions, nonzero test
results, crashes, timeouts, and every other launch error fail immediately and are never retried.
Do not add general flaky-test retries.

- The full release check passed all ten UI audits, 88 safety checks, the 16-setup matrix, and
  I2C/load-cell audit, then failed when Windows Application Control temporarily blocked the
  just-linked native behavior executable with WinError 4551. An immediate standalone rerun of
  the same native harness passed.
- Minimal resolution: use one stable bounded build/run location and, only for this documented
  Windows policy result, perform a short bounded retry with the exact same binary. Never convert
  a genuine compile/test failure into success.

### [x] P1 DOC OT-POST-018 - document actual rule ownership outside selected modes

**Decision:** Option 1 — preserve runtime behavior and correct every contradictory rule header,
editor hint, User Guide passage, and example. Outside the rule's selected modes it releases the
target so the last applicable non-rule owner resumes. Inside a selected mode, a false or unavailable
condition applies the configured OFF demand. Add one small contract/regression check so generated
or duplicated help text cannot silently drift from these semantics.

- Runtime intentionally releases a rule's target outside its selected engine states so the
  sequencer/controller/current non-rule owner resumes control. Only an unavailable input while
  the rule is in a selected state applies its configured OFF demand.
- The engine header, Sequence page, generated page, and User Guide instead say both cases drive
  the configured OFF value (`src/system/RulesEngine.h:8-11`,
  `data_src/pages/sequence.shell.html:83`, `docs/USER_GUIDE.md:445`). This can make an operator
  design the wrong handoff around a fuel, oil, pitch, or auxiliary output.
- Minimal resolution: correct the one sentence everywhere and add one ownership example: outside
  mode = release; selected mode plus false/unavailable condition = configured OFF. Keep the UI
  concise and test that generated assets contain the same contract.

### [x] P0 FIX OT-POST-019 - reset controller state before every new STARTUP

**Decision:** Option 1 — reset controllers at every new STARTUP. Seed throttle from the cleared
zero demand and seed oil control deliberately from the new startup prime command; preserve the
existing bumpless STARTUP-to-RUNNING handoff. Add a two-run regression proving that no fuel is
restored before an explicit fuel-admission block on the second start.

- `enterStandby()` clears public demands and physically calls all-off, but it does not reset the
  controllers' private accumulated state (`src/main.cpp:2228-2318`). Controllers are initialized
  at boot and again only after startup completes in `enterRunning()` (`src/main.cpp:2109-2140`,
  `src/Hardware.h:2664-2677`).
- `applyThrottleProtection()` runs throughout STARTUP. On a second run after a nonzero RUNNING
  demand, `ThrottleSlew::_current` can therefore survive shutdown/standby and be written back to
  `ed.throttleDemand` on the first new STARTUP tick, before the startup sequence requests fuel
  (`src/engine/controllers/ThrottleSlew.h:64-81, 180-204`, `src/Hardware.h:2817-2828`). This can
  defeat OilPrime/starter-before-fuel ordering. A separate fuel shutoff is optional, so the main
  metering pump itself may admit that fuel.
- The primary/additional oil loops also retain their accumulated pump outputs into the next
  STARTUP and can override the new sequence's intended initial oil demand.
- Minimal resolution: establish one new-run controller reset/seed boundary before the first
  startup block/tick, with throttle seeded from the already-cleared zero demand and oil loops
  seeded deliberately for the upcoming prime. Keep the existing bumpless RUNNING handoff.
  Add a real two-run behavior test: run at high fuel/oil, complete shutdown/standby, start again,
  and prove fuel remains zero until the first explicit fuel-admission block.

### [x] P1 HARDEN OT-POST-020 - the native behavior gate must exercise engine behavior

**Decision:** Option 1, narrowly scoped — extend the lightweight native harness with focused
contract scenarios that compile and execute the real controller, sequencer, transition, I2C-loss,
AB cleanup, protection-ordering, and final-output-ownership components. Cover at least STARTUP to
RUNNING to SHUTDOWN, immediate and persistent combustion cut, controller/rule/protection ordering,
AB gate failure cleanup, the 500 ms I2C loss boundary, and two consecutive runs for private-state
reset. Use thin fake time/sensor/output adapters and reusable fixtures only where they reduce code;
do not create a full desktop ECU simulator or duplicate firmware logic in the harness.

- The release step labelled `real native command/state behavior` compiles only
  `dev/host/command_queue_behavior.cpp` plus `CommandQueue.cpp`
  (`tools/run_native_behavior_tests.py`). It does not execute the controllers, mode transitions,
  sequencer, I2C-loss response, AB state machine, or final actuator ownership promised by
  OT-AUD-009.
- This is why the gate can report 88 source-pattern safety checks and a passing native behavior
  test while OT-POST-001, 003, 004, 006, 007, and 019 remain observable in the real source.
- Minimal resolution: keep the small fake environment, but add real compiled scenarios for the
  few safety-critical owner/transition contracts found in this audit. Rename individual gate
  labels to the behavior actually covered; do not build a duplicate simulator architecture.

### [x] P1 FIX OT-POST-021 - correct the inverted cooldown-target warning

**Decision:** Option 1 — correct the warning without changing or restricting sequencer behavior.
A target high enough to be satisfied while the turbine is still hot warns that cooldown may finish
too early or immediately. A suspiciously low target warns that cooldown may reach its configured
finite timeout before reaching the temperature. Keep Save available and do not impose a universal
normal range.

- Config warns that an EGT cooldown target at/above the hard EGT limit means cooldown `will
  never complete` (`data_src/pages/config-validation-save.js:346`). `CooldownSpin` actually
  completes as soon as measured EGT is below that target (`src/engine/sequencer/blocks/CooldownSpin.h:88-91`).
- With an excessively high target, shutdown can therefore skip most or all cooling while the UI
  describes the opposite failure mode.
- Minimal resolution: warn that the target may complete cooldown immediately/while still hot and
  recommend a verified storage/bearing-safe target below the running limit. Keep Save anyway for
  unusual systems, and add a boundary test for below/equal/above target.

### [x] P2 FIX OT-POST-022 - correct startup ordering warnings to match sequencer behavior

**Decision:** Option 1 — correct both comparisons and their messages, without imposing a universal
ordering or blocking Save. A pre-ignition RPM above the spool target warns that the spool stage may
already be satisfied/skipped, not that it can never complete. A startup oil-arm threshold below the
running low-oil limit warns that startup may pass and then immediately fault; a higher startup
threshold is simply stricter. Add below/equal/above boundary checks for both relationships.

- Config says pre-ignition RPM above spool target means the engine `will never reach spool`
  (`data_src/pages/config-validation-save.js:34-41`). In the stock sequence, StarterSpin has
  already reached the higher RPM, so the later Spool block is immediately satisfied. The useful
  warning is that the intended post-light acceleration stage may be skipped.
- Config also warns when Oil Arm Minimum is higher than Running Minimum that the engine will
  fault immediately after spool (`data_src/pages/config-validation-save.js:330-334`). A higher
  startup qualification is stricter and already satisfies the lower running threshold; the
  risky direction is a startup threshold below the running requirement, which can admit a run
  that immediately fails its new threshold.
- Minimal resolution: correct both comparisons/messages and cover both directions with config
  validation tests. Keep unusual intentional ordering saveable with a warning.

### [x] P3 HARDEN OT-POST-023 - hide ineffective generic fault overrides

**Decision:** Option 1 — omit the generic fault-safe override checkbox wherever a turbine safety
invariant is unconditional. Show one short read-only statement instead: combustion/fuel/ignition
outputs are cut and held off, and prop pitch is forced to semantic 100% coarse/maximum load during
a running fault. Retain the configurable override only for outputs where it genuinely changes
runtime behavior. Do not allow configuration to weaken the fixed invariants.

- Hardware shows the same optional `Force initialized safe demand during fault shutdown` control
  for core outputs. Combustion outputs are already unconditionally cut by the hard shutdown
  invariant, and prop pitch is unconditionally forced coarse/load, so toggling this control does
  not change their real fault behavior (`data_src/pages/hardware-registry-catalog.js:478-481`,
  `src/Hardware.h:1048-1147`).
- Minimal resolution: omit the generic checkbox for outputs with an unconditional turbine
  invariant and show one short fixed-state explanation instead. Retain the checkbox only for
  mechanical/general outputs where it genuinely changes ownership.

### Verification status and remaining hardware work

Software completion recorded 2026-08-04: `python tools/run_release_checks.py` passed in one
uninterrupted run for generated/public assets, all browser matrices, 92 safety/source checks,
16 turbine setup profiles, I2C/load-cell audits, real native behavior and sensor vectors,
Python/Go tooling, both firmware targets, both LittleFS images, and linker/partition budgets.
The unchecked items below require physical ECU/expander/actuator instrumentation and remain
deliberately deferred to the planned full HIL campaign.

- [x] Add executable regressions for OT-POST-001 through OT-POST-033 where behavior can be
  exercised without hardware. Source-pattern audits alone are insufficient.
- [x] Rerun the canonical release gate to completion after fixes; both Classic ESP32 and S3
  builds, generated assets, native behavior, UI matrix, setup matrix, and package checks must
  pass from the exact candidate.
- [ ] Add dry-HIL cases for effective oil-flow supervision, prop-pitch physical direction and
  expander loss, STOP expander loss after 500 ms, AB raw request/permission, governor pitch-limit
  fallback, and cooldown oil bounds.
- [ ] Extend the existing I2C campaign beyond one generic relay: exercise every supported
  canonical TCA9554 output through START readiness, command forwarding, 500 ms loss, safe
  shutdown, and reconnect. Include device-backed START+STOP cooldown skip.
- [ ] In HIL, add a two-save Developer Mode scenario that proves each advertised live field
  changes as one coherent controller snapshot and every non-live field remains locked until
  STANDBY.

### [x] P1 FIX OT-POST-024 - imported relay prop-pitch can pass validation and silently disable the governor

**Decision:** Support relay prop pitch as a valid, deliberately two-position N2-control actuator.
Do not present it as proportional. Relay OFF is semantic 0% fine/minimum load and relay ON is
semantic 100% coarse/maximum load. Above the existing N2 target deadband the governor selects
coarse; below it the governor selects fine; inside the band it retains the last state to avoid
chatter. Reuse the existing target/deadband and add no relay-specific tuning fields. Runtime status
states `Two-position pitch control`. If it cannot hold speed, the existing gradual N2 overspeed
fuel pullback and hard trip remain authoritative; do not add hidden normal governor fuel control.
The fixed fault/feedback-loss command remains coarse/load.

Use one shared capability predicate across validation, import, UI, and runtime: Servo/PWM means
proportional pitch, Relay/I2C relay means two-position pitch, and both are supported governor modes
with their truthful behavior. A single relay does not claim support for a reversible motor that
requires separate forward and reverse outputs.

- `HardwareConfig::validateJson()` treats any registry output with role `prop_pitch` as
  proportional when checking the governor dependency (`src/system/HardwareConfig.cpp:448-456`).
- The registry accepts every legal output driver for that role, including local relay and I2C
  relay (`src/system/ChannelRegistry.h:448-455`). Import then correctly maps either relay to
  `propPitchType == 2` (on/off), and the later runtime dependency check disables the governor
  because it requires `propPitchType != 2` (`src/system/HardwareConfig.cpp:3847-3855,4167-4170`).
- The result is a configuration that saves successfully but boots with the requested controller
  turned off. Correct this by recognizing the explicit two-position mode above rather than
  silently changing behavior. Validation and UI must use the same capability classification as
  runtime and describe the selected proportional or two-position behavior truthfully.
- `HardwareCapabilities::available("n2_governor")` also treats any prop-pitch purpose as usable
  control authority (`src/system/HardwareCapabilities.h:19-23`), so the backend capability API
  must use that same proportional-driver predicate too.

### [x] P1 FIX OT-POST-025 - accepted I2C core outputs fail the local-actuator START readiness check

**Decision:** Option 1 — make START readiness use the effective physical driver. Local GPIO,
relay, PWM, and servo outputs require their real local actuator object to initialize successfully.
I2C outputs require a valid device address/channel assignment and the actual device/channel to be
connected and initialized. Apply the standard 500 ms confirmation window; an unavailable critical
endpoint blocks START and names its device/channel. Use the same logic on both supported ESP chips
and cover every core purpose/driver combination with table-driven tests. Do not create dummy local
actuators or exempt I2C outputs from readiness.

- TCA9554 outputs are intentionally offered for fuel shutoff, starter, oil/scavenge/cooling
  pumps, ignition, afterburner, glow, valves, and other on/off functions. Registry import maps
  these channels into the corresponding canonical `has...` flags with GPIO `-1`, and
  `updateRegistryOutputs()` contains the matching I2C demand forwarding.
- `Hardware::initActuators()` nevertheless calls `requireReady()` against the local GPIO
  actuator pointer/object for most of those canonical functions. With an I2C-only channel the
  local object was never initialized, so `hardwareReady` becomes false and START is blocked
  (`src/Hardware.h:2318-2388`). Fuel shutoff, AB valve, starter, oil pump, scavenge pump, cooling
  fan, secondary/AB pump, igniters, glow plug, and any imported core valve/pitch path need a
  consistent review. Starter-enable and air-starter already contain partial I2C exceptions,
  showing the intended pattern.
- Minimal resolution: readiness must test the effective driver. A local output requires its
  local actuator to be ready; an I2C output requires the expander/channel to be available and
  successfully initialized. Do not weaken the START interlock. Add one table-driven native or
  simulated case for every I2C-capable engine purpose, including commanded ON/OFF forwarding and
  loss after the 500 ms recheck window.

### [x] P2 FIX OT-POST-026 - Config UI does not classify TCA9554 outputs as on/off relays

**Decision:** Option 1 — define and reuse one truthful capability model throughout Hardware,
Config, Sequence, Tools, validation, and runtime status: local relay and TCA9554/I2C relay are
on/off; Servo and PWM are proportional. On/off controls show state/duration rather than a
percentage they cannot reproduce. Relay prop pitch remains fully supported as the selected
two-position control mode. Do not impose driver restrictions without a physical or safety reason;
support every behavior the hardware can actually perform while avoiding controls that promise
unsupported behavior.

- Config's `actuatorType()` maps local relay driver 4 to on/off but maps TCA9554 relay driver 11
  to `NaN` (`data_src/pages/config-runtime.js:324-338`). As a result, valid I2C starter,
  secondary-fuel, and AB-pump installations expose percentage controls whose values are ignored
  at the binary driver boundary.
- The same local-relay-only comparison initially presents Pulsed Starter Assist for an I2C relay
  starter, despite the feature text and firmware correctly requiring proportional PWM/servo
  (`data_src/pages/config-runtime.js:206-212,528-549`). The proportional prop-pitch check likewise
  excludes driver 4 but not driver 11, compounding OT-POST-024 for imported files.
- Sequence uses the same comparison for block availability, demand labels, and custom actions;
  Hardware also renders general TCA9554 outputs with percentage/power-on wording rather than
  simple On/Off state (`data_src/pages/sequence-state.js:31-36`,
  `data_src/pages/sequence-editor.js:602-634`,
  `data_src/pages/hardware-registry-catalog.js:448-480`).
- Minimal resolution: use one small shared UI capability helper (`on/off` = 4 or 11;
  `proportional` = 5 or 6) wherever tests, starter assist, and governor visibility are decided.
  Keep the UI simple: for binary outputs show duration/state only, not a meaningless percentage.

### [x] P1 FIX OT-POST-027 - Developer Mode live saves publish a mixed old/new control configuration

**Decision:** Option 1, with an explicit no-deferred-edit rule while running. Define a small
whitelist containing only values the real controller can safely adapt during RUNNING, such as
supported targets, gains, deadbands, and response/ramp values. Validate and apply each related
group atomically, seed/clamp private state as needed, and route changed demands through existing
slew and safety limits. Mark editable fields concisely as `Applies live`.

While RUNNING in Developer Mode, ghost every non-whitelisted field and explain `Can only be changed
and saved while not running`. This includes hardware topology, pins/drivers, sensor/actuator
calibration, source selection, sequence structure, and any value lacking a proven bumpless live
apply path. Do not accept a hidden deferred structural edit during RUNNING and do not claim that
all configuration values are live. Outside RUNNING, normal editing and saving remains unchanged.

- The accepted design says explicitly supported tuning fields may apply atomically during RUNNING.
  The current ECU-core transaction calls `Config::applyJsonRuntimeOnly()`, which loads the whole
  settings document into global `Config` statics, then deliberately defers `Hardware::applyConfig()`
  until STANDBY (`src/main.cpp:3636-3675`, `src/system/ConfigSerialize.cpp:308-315`).
- Controllers and several safety checks use copied members populated only by
  `Hardware::applyConfig()` (throttle pullback limits, most Dynamic Idle and governor fields,
  N1/N2 trips, oil/fuel/bus limits). Other checks read `Config` statics directly (selected EGT,
  P1/P2/torque trips, oil-flow timing, relight, fuel minimum, and some controller terms). One save
  therefore creates a mixed snapshot whose exact live behavior depends on which code path owns
  each field.
- Both POST/PATCH responses nevertheless claim `runtime_safe_values_live:true`
  (`src/system/web/WebServer.cpp:1884-1888,1956-1960`). A user tuning the governor, idle, slew, or
  hard N1/N2 limit mid-run can reasonably believe the new value is active when it is not; another
  value from the same save may already be active.
- Minimal resolution: define a short explicit whitelist of genuinely safe live-tuning fields and
  publish/apply those together on the ECU-core boundary, with bumpless controller handling where
  required. Leave every other saved value pending until STANDBY and return/show the two concise
  groups (`live now`, `saved for standby`). Do not attempt universal live reconfiguration.

### [x] P2 FIX OT-POST-028 - cooldown skip ignores canonical device-backed START/STOP switches

**Decision:** Option 1 — cooldown skip consumes the same canonical conditioned START and STOP
states and health used by normal engine control, independent of GPIO or I2C transport. Both must be
healthy and continuously active for the entire hold duration; release or signal/device loss
immediately cancels and resets the gesture. I2C channels behave like every other channel and add
only the standard disconnected-device guard and 500 ms fault policy. Apply the same transport-
independent channel rule anywhere else raw local pin reads still bypass canonical state.

- The normal START and STOP paths resolve local, registry, and I2C-backed canonical inputs into
  `EngineData` switch state. `checkCooldownSkip()` bypasses that abstraction and calls
  `digitalRead()` only when the two legacy GPIO pins are nonnegative
  (`src/main.cpp:2081-2104`).
- An installation using TCA9554 START/STOP can start and stop normally but cannot perform the
  documented hold-both cooldown override from those same controls. This is a user-workflow
  inconsistency, not a reason to remove the override.
- Minimal resolution: use the already conditioned canonical active states and health flags for
  the hold. Require both inputs healthy for the full configured duration; loss cancels the hold.
  Keep the same single action and wording for local and device-backed switches.

### [x] P1 FIX OT-POST-029 - imported on/off main fuel can satisfy proportional controller dependencies

**Decision:** Option 1 — enforce real actuator capability. Local and I2C relay outputs remain fully
supported for binary fuel enable/shutoff, sequences, rules, and tests, but cannot satisfy a feature
that requires continuously metered PWM/servo fuel authority. Dynamic Idle and fuel-primary N2
control use an available proportional main-fuel output; otherwise they are unavailable with one
concise explanation instead of silently quantizing percentages to OFF/ON. Imported configurations
receive the same validation/capability result as UI-created configurations. Do not synthesize
bang-bang combustion-fuel governing.

- Hardware UI intentionally offers only PWM and servo/ESC for `main_fuel`, but backend registry
  semantics accept Relay/I2cRelay for every output purpose. `validateJson()`,
  `HardwareCapabilities`, and runtime dependency cleanup then treat any canonical main-fuel
  output as valid authority for Dynamic Idle and the N2 governor.
- The controller chain continues producing fractional fuel demands, but a relay actuator
  quantizes them at the driver boundary. Idle trim, governor correction, slew, gradual pullback,
  startup minimum fuel, and AB coordination no longer behave as their UI describes; demand near
  the relay threshold can become abrupt all-or-nothing fuel.
- Minimal resolution: use purpose/driver capability validation for imported JSON as well as UI
  editing. A canonical metering output used by these controllers must be proportional. Preserve
  expert freedom to use binary fuel valves as `fuel_shutoff`, start-fuel, or generic outputs and
  control them with sequences/rules; if legacy imported `main_fuel` relay configurations must be
  retained, show a prominent incompatibility warning and keep proportional controllers disabled.

### [x] P1 FIX OT-POST-030 - I2C starter bypasses the configured starter-enable delay

**Decision:** Option 1 — compute one authoritative starter demand only after the configured starter-
enable prerequisite and delay have been satisfied, then feed that same demand to the effective
local or I2C starter writer. Starter and starter-enable may independently be local or I2C-backed;
all four combinations have identical interlock behavior. The enable must be healthy and active for
the full delay. STOP, fault, startup cancellation, enable release, or enable/device loss cuts the
effective starter demand immediately and resets the qualification. Do not duplicate a timer in
the registry writer.

- The local starter writer gates physical demand until `starterEnabled` has been true for
  `starterEnDelayMs` (`src/Hardware.h:2443-2454`). The later TCA9554 forwarding path independently
  turns an I2C starter relay on whenever raw `ed.starterDemand` is nonzero
  (`src/Hardware.h:1014-1018,2599`). It never uses the delay-qualified demand.
- OT-POST-025 currently blocks this configuration before START; once that readiness defect is
  repaired, the I2C starter would energize immediately and make local/I2C behavior diverge. A
  starter-enable contactor, pneumatic precondition, or other intended enable lead time could be
  bypassed.
- Minimal resolution: calculate one effective starter demand after the enable/delay gate and feed
  it to both local and registry writers. Test GPIO and I2C starters with no enable, local enable,
  I2C enable, delay boundary, STOP during delay, and expander loss. Do not duplicate timing state
  in the registry writer.

### [x] P2 HARDEN OT-POST-031 - oil-pressure controller UI promises modulation for binary pumps

**Decision:** Option 1, with real accumulator-based on/off pressure control supported. A binary
local or I2C pump has only physical 0% and 100% states. When pressure regulation is enabled and
feedback is healthy, turn the pump ON below `target - deadband`, turn it OFF above
`target + deadband`, and retain its current state inside the band. This supports pressure-
accumulator systems without pretending to vary pump speed. Keep target and deadband; hide/ghost
correction gain and minimum/maximum percentage fields for that loop. Label the mode `On/off oil-
pressure control` and briefly state that it requires a suitable accumulator/relief arrangement.

Also support a binary pump as a continuously ON fixed-speed pump whenever the active engine mode
requires oil and regulation is not selected. Present any existing sensor-loss fallback as ON/OFF,
not a percentage, and retain the authoritative oil fault/shutdown/cooldown policy. Do not rapidly
PWM or pulse a mechanical relay to synthesize intermediate speed.

- Hardware allows local and TCA9554 relay oil pumps to satisfy the oil-loop dependency. The
  controller output is clamped to a positive minimum and a relay reduces every such demand to
  On, so target, deadband, gain, minimum, and maximum percentages cannot regulate pressure. The
  pump effectively runs continuously through STARTUP/RUNNING while pressure safety remains
  separate.
- This fixed-speed behavior can be perfectly valid for a hobby turbine; the problem is presenting
  it as closed-loop pressure control and exposing tuning values that cannot change the physical
  output.
- Minimal resolution: retain binary oil pumps and normal pressure monitoring. When the selected
  pump is on/off, describe the behavior as fixed On during the applicable engine modes and hide or
  ghost modulation-only tuning. Only call the feature pressure regulation when the selected pump
  is PWM/servo. One concise warning is enough; do not add a second controller.

### [x] P2 HARDEN OT-POST-032 - Automatic Idle target can overlap its own disengagement threshold

**Decision:** Option 1 — add one concise warning only when the selected feedback mode's
`target + no-correction band` is greater than or equal to its nonzero `Stop Controlling Above`
limit. State that the controller may release before settling at its target. Label zero explicitly
as `Disabled - no upper cutoff`. Compare only RPM fields for N1/N2 and pressure fields for P1/P2;
keep Save available and do not auto-adjust or add another parameter.

- Dynamic Idle clears its learned/floor demand whenever feedback is above `rpmLimit` or
  `pressureLimit` (`src/engine/controllers/DynamicIdle.h:94-100`). Config exposes these as
  `Stop Controlling Above`, but validation compares an RPM target only with the engine hard limit
  and never checks either mode's target/deadband against the controller's own stop threshold.
- A target at/above that threshold can make the controller add fuel while below target, withdraw
  its whole idle floor as it crosses the stop threshold, then re-engage as feedback falls. This is
  a likely hunting or flameout-prone setup, especially with experimental pressure feedback.
- Save validation also emits the hidden RPM-target-vs-Min-RPM warning for a P1/P2-selected setup
  whenever any shaft sensor exists (`data_src/pages/config-validation-save.js:220-268`), adding an
  irrelevant warning while missing the active pressure relationship.
- Both limit fields allow 0 without explaining that runtime treats a nonpositive target or limit
  as controller disabled (`src/engine/controllers/DynamicIdle.h:46-50`). A user can reasonably
  read 0 as “no upper disengagement limit” and silently turn Automatic Idle off instead.
- Minimal resolution: add one mode-aware warning that the active target plus a sensible margin or
  deadband should remain below `Stop Controlling Above`; state that 0 disables control (or reject
  0 while enabled); still allow other unusual values to Save. Only validate and mention the
  selected RPM or pressure fields so unusual configurations stay uncluttered.

### [x] P3 HARDEN OT-POST-033 - pressure-based predictive idle shows inactive RPM tuning fields

**Decision:** Provide real pressure-domain tuning instead of showing fields that do nothing. When
predictive Dynamic Idle uses P1/P2, hide the four RPM-only fields and show their four functional
pressure equivalents: `Catch Entry Above Target` (bar), `Settled Pressure Band` (bar), `Pressure
Error for Full Correction` (bar), and `Maximum Pressure Change While Learning` (bar/s). Use these
values directly in the controller. Keep lookahead time, deceleration fuel reduction, fuel trim
rates, and learning rate as shared settings because their units and behavior are source-independent.

Show the extra fields only when P1/P2 and predictive mode are selected. Migrate an existing
configuration by calculating initial values from the current formulas (`max(deadband*4,target*5%)`,
`max(deadband,target*1%)`, `max(deadband,target*25%)`, and `max(0.01,target)` bar/s), so behavior
does not change merely because firmware was upgraded. Validate units and nonnegative/range
relationships, warn rather than block unusual expert values, and do not introduce an advanced
curve editor or additional controller mode.

- In predictive mode the Config page shows all fast-deceleration fields after selecting P1/P2,
  including RPM entry band, settled RPM band, full-response RPM error, and learned acceleration
  limit (`data_src/pages/config-render.js:291-303`).
- Runtime deliberately derives pressure-mode equivalents from pressure target/deadband and does
  not read those four RPM settings (`src/engine/controllers/DynamicIdle.h:103-108`). Changing them
  appears to tune the active controller but has no effect. The lookahead, fuel-drop/rates, and
  learning-rate fields do remain applicable.
- Minimal resolution: hide the four inactive RPM-only fields for P1/P2, expose the four pressure
  equivalents above, and keep only the shared predictive fields in both modes. Verify that every
  visible field changes real runtime behavior and that hidden fields cannot affect the selected
  source mode.

## Fresh cross-system audit after nonlinear calibration — 2026-08-08

This pass re-traced the final sensor, controller, registry, persistence, and UI paths after the
nonlinear-calibration work. It remains hardware-free; the items below are software findings and
do not replace the exact-candidate HIL campaign.

### [x] P1 FIX OT-FRESH-001 — paired calibration saves competed for the configuration gate

Registry-backed calibration wizards started `/api/hardware` and `/api/config` writes in parallel.
The firmware correctly serializes configuration writes, so one request could receive a 409 while
the page showed only a partially saved calibration. Hardware-registry calibration is now written
first and its compatibility settings copy follows in sequence. A short bounded retry covers only
the known ECU-core handoff window after a successful hardware PATCH; ordinary concurrent writes
still fail visibly.

### [x] P1 FIX OT-FRESH-002 — canonical oil-pressure registry input could mirror itself

A local analog oil-pressure registry card was classified as a legacy mirror, while the canonical
oil-pressure consumer simultaneously selected that registry slot. The result could remain at the
previous/initial value rather than sampling the ADC. Oil pressure now follows the same single
registry sampling and calibration path as the other canonical analog sensors.

### [x] P1 FIX OT-FRESH-003 — saved NTC table was not used by canonical oil temperature

The advanced NTC curve round-tripped through configuration but canonical oil temperature still
used only the beta equation. The beta model remains the simple default; when a 2–6 point table is
present it is authoritative, while the NTC driver's open/short/stale health remains authoritative.
The Calibration capture wizard now saves its measured points as that same bounded monotonic table.
ADC rails 0 and 4095 are prohibited for NTC table points so electrical fault detection cannot be
calibrated away.

### [x] P2 FIX OT-FRESH-004 — torque/thrust adapter support diverged from registry validation

Local analog torque bypassed the registry conversion (and therefore any curve), while analog and
I2C-analog thrust were accepted by firmware semantics but never promoted to usable canonical
feedback. Torque and thrust now consume one registry sample across local analog, TLA2528 analog,
and NAU7802 paths; HX711 retains its dedicated timing-sensitive driver. Hardware exposes the same
three practical thrust choices. Coolant pressure likewise exposes the already-supported TLA2528
adapter.

### [x] P2 FIX OT-FRESH-005 — S3 sensor-registry response could exceed the original web buffer

The S3 supports 24 inputs. A legal maximum layout with six-point analog curves can exceed the old
16 KiB Hardware API workspace and become impossible to reopen. The first fix increased only the
S3 workspace to 24 KiB. The later complete-capacity audit in OT-FRESH-015 found that this model had
not included maximum Sequence side actions/custom blocks and replaced the fixed-buffer response
design entirely. This entry remains as the sensor-registry finding that led to that wider audit.

### [x] P2 FIX OT-FRESH-006 — engine-affecting I2C readiness omitted auxiliary cooling/nozzle outputs

Cooling fans were added earlier, but coolant pumps and variable-nozzle actuators could still evade
the shared device-ready/loss classification. They now participate in the same 500 ms I2C loss
policy. Starter and ignition remain intentionally noncritical to an already established run, while
all configured engine-affecting outputs are still required before START.

### [x] P2 FIX OT-FRESH-007 — renamed calibration channels were patched by assumed default ID

Calibration lookup already supported semantic purpose, but the PATCH envelope reused the requested
default name instead of the matched card's persisted ID. A renamed yet otherwise valid sensor could
therefore be displayed and captured but rejected on save. Every registry-backed calibration now
sends the actual matched ID; analog torque also resolves the `torque` purpose rather than assuming
`torque_main`.

### [x] P2 FIX OT-FRESH-008 — calibration settings used stale full-document replacement

Small calibration changes still fetched the full settings document, merged in the browser, then
POSTed the complete snapshot. Another browser save between those operations could be overwritten.
Calibration now PATCHes only its changed fields through the firmware's canonical recursive merge,
matching the main Config editor and removing the duplicate browser-side merge implementation.

### [x] P2 FIX OT-FRESH-009 — Log settings could overwrite unrelated configuration

Log → Session Data used the same GET–merge–full-POST pattern for its checkboxes and intervals.
It now PATCHes only `session_log` and its two owned telemetry fields, so another browser's engine,
controller, or safety edit cannot be replaced by saving logging preferences.

### [x] P2 FIX OT-FRESH-010 — Sequence full-engine save could restore unrelated stale settings

Sequence order and its block settings correctly use the atomic full-engine-file endpoint, but a
long-open Sequence page could include unrelated old Hardware or Config values in that replacement.
The page now records its normalized load baseline, fetches both current sections immediately before
save, and overlays only fields actually edited on the Sequence page. The merged engine file is then
revalidated and committed atomically. Arrays such as sequence order, side actions, and control rules
remain intentional replacement units, while unrelated newer browser changes are preserved.

### [x] P1 FIX OT-FRESH-011 — generic I2C channels disappeared from Sequence and Rules

The Sequence page's generic-channel loops required a local GPIO even though its canonical device
predicate and the firmware both support addressable I2C channels. Canonical I2C sensors and outputs
therefore appeared through their built-in names, but an auxiliary TLA2528/TCA9554/NAU7802 channel
could not be selected in a custom block or control rule. All Sequence and Rules inventories now use
the same driver-aware installed predicate. The generic analog-to-output preset also accepts either
the local ADC or TLA2528 adapter. No new I2C-specific workflow is exposed.

### [x] P2 FIX OT-FRESH-012 — I2C purge and drain valves bypassed device-loss guards

Both valves are advertised as turbine sequence/automation outputs, but they were omitted from the
configured I2C engine-output set used for pre-start readiness and established-run loss handling.
They now follow the same 500 ms shared-device recheck and fault policy as the other configured
engine-affecting valves. Warning indicators remain noncritical general-purpose outputs.

### [x] P2 FIX OT-FRESH-013 — renamed canonical channels appeared as duplicate custom channels

Sequence and Rules recognized core-managed channels mainly from default IDs, while firmware also
resolves their semantic purpose. Renaming a canonical card could consequently show both the normal
turbine control and a custom copy that firmware would later reject as independently owned. The page
now mirrors firmware ownership: prefer an installed canonical-ID card for a core purpose; otherwise
the first installed card owns that adapter. Additional oil pressure/pump channels remain selectable
for independent systems instead of being hidden merely because they share a role.

### [ ] HIL OT-FRESH-014 — exact final candidate physical confirmation

After the complete software release gate passes, rebuild the exact tester candidate and perform
the planned dry and fueled HIL campaign. In particular verify local/I2C curve agreement against a
known voltage source, NTC rail faults, oil-pressure response, torque/thrust calibration, I2C loss
recheck timing, starter/ignition loss classification, and all-off behavior during reset/fault.

### [x] P1 FIX OT-FRESH-015 — complete legal Sequence data exceeded Hardware API limits

OT-FRESH-005 measured a maximum sensor registry but did not include the independently legal
maximum of 512 Sequence side actions plus eight custom blocks. The combined representative
hardware section is 55,256 bytes before a maximum S3 registry, versus the old 16 KiB/24 KiB
response and request workspaces. Hardware reads now use an owned streaming JSON response;
Hardware saves use the flash-staged full-engine transaction; calibration merges operate directly
on a JSON tree; full restores accept the same 192 KiB maximum as boot and enforce it cumulatively.
Rollback reloads the unchanged committed engine file instead of requiring another fixed-size copy.

### [x] P1 FIX OT-FRESH-016 — Hardware saves could overwrite newer Sequence or Config work

Sequence definitions share the hardware section, while dependency cleanup for removed channels
shares the settings section. A long-open Hardware tab formerly replaced both with its load-time
view. Hardware now refreshes the current engine file immediately before save and applies only its
own three-way hardware differences. Exact rule removals and the oil-flow underflow disable are
applied selectively to fresh settings, preserving concurrent rule additions/edits. Profile identity
is synchronized atomically and newly enabled safety thresholds retain their existing autofill path.

### [x] P1 FIX OT-FRESH-017 — rejected full restores could leave a proposed registry live

Full-file validation intentionally borrows the live channel registry as bounded scratch while the
engine is idle. If staging the validated hardware section then failed, that scratch mutation was
not restored. Every failure after the registry is borrowed now reloads hardware from the unchanged
committed engine file before releasing the maintenance transaction.

### [x] P1 FIX OT-FRESH-018 — thrust and generic I2C automation were advertised but rejected

The runtime Rules engine supports thrust and addressable registry channels, but Config validation,
Config sanitization, Hardware custom-block mapping, and main's structural preflight used older
maps ending at Stop Switch or required a local GPIO. Thrust rules/custom while-blocks and generic
TLA2528/TCA9554/NAU7802 inputs or outputs could therefore be rejected, disabled after load, or
block START. All maps now use the shared addressability predicate and include Thrust sensor 27.

### [x] P1 FIX OT-FRESH-019 — shared-I2C afterburner flame detector never enabled AB flame logic

Hardware and runtime sampling support digital/analog TCA9554/TLA2528 AB flame inputs, but hardware
derivation required a nonnegative local GPIO and cleared `hasAbFlame`. The detector could update
telemetry while AB readiness and flame-loss logic treated it as absent. Availability now accepts
the four advertised local/shared-I2C adapters; a `-1` local pin remains intentional for I2C.

### [x] P3 FIX OT-FRESH-020 — live I2C discovery metadata could enter the engine file

Sequence refreshes Hardware through the API, whose response includes live discovery status. Its
atomic full-engine save could persist that transient response-only object. Sequence now removes
`_i2c_discovery` before save; immutable PCB identity remains present for profile validation.

## Final cross-layer audit after the completed fixes - 2026-08-08

This pass is again software-only. It compares the advertised Hardware and Sequence workflows
against firmware validation, load sanitization, runtime adapter selection, command gating, and
persistence. The entries below are independently confirmed defects; they are not proposals to
remove expert configuration freedom.

### [x] P1 FIX OT-FRESH-021 - Standby Control Rules are still rejected or stripped

The Sequence page exposes Standby as a normal rule state and can save all four operational states
as mask `15`. Firmware validation accepts only `1..14`, so that valid UI combination is rejected.
Separately, both load sanitization paths apply `modeMask &= 0x0E`, which deletes the Standby bit;
a Standby-only rule becomes disabled and a mixed rule silently loses its Standby behavior. The
Rules engine itself correctly understands bit 0. This contradicts completed item OT-AUD-017.

Minimal resolution: validate masks `1..15`, preserve with `0x0F` in every load/import path, keep
FAULT excluded, and add round-trip/runtime tests for Standby-only and all-four-state rules.

Implemented: validation now accepts `1..15`; both sanitizers retain `0x0F`; the safety gate
asserts that both load paths preserve Standby and that the obsolete mask cannot return.

### [x] P1 FIX OT-FRESH-022 - every advertised AB-flame registry card is rejected

Hardware offers `ab_flame` with local digital, local analog, TCA9554 digital, and TLA2528 analog
drivers. A host probe against the real `ChannelRegistry` confirmed that all four are rejected
because `purposeValid(Input, ...)` omits `ab_flame`. I2C AB flame has a second independent blocker:
platform validation still requires the mirrored legacy `ab_flame.pin` to be a local ADC GPIO,
unlike the other canonical I2C sensor mirrors. This makes OT-FRESH-019 unreachable through a real
firmware save even though browser-only tests pass.

Minimal resolution: add the advertised purpose to the authoritative firmware vocabulary, make
the legacy-pin check registry-transport aware, and test complete Hardware JSON validation for all
four advertised adapters rather than testing only browser inventory and runtime sampling patterns.

Implemented: `ab_flame` is part of the authoritative input vocabulary and capability matrix.
Platform validation now honors the canonical local-digital/local-analog/shared-I2C adapter instead
of always demanding a legacy ADC pin; the host matrix covers all four advertised drivers.

### [x] P1 FIX OT-FRESH-023 - imported channel purpose/role/driver contracts are not enforced

The browser has an explicit purpose-to-role-to-driver matrix, but firmware validates roles and
purposes mostly independently and returns true for every output in `semanticDriverValid()`. A host
probe against real firmware accepted a Servo fuel shutoff and a Relay main-fuel channel. The same
gap accepts load-cell drivers for temperature, pressure, and voltage purposes even though their
canonical runtime adapters do not consume a load-cell sample. It also still accepts the on/off
main-fuel configuration called out by completed item OT-POST-029. Depending on purpose, runtime can
then initialize the same pin using a different electrical writer, disable the expected adapter,
or expose a configured controller/sensor that never receives the advertised signal.

Minimal resolution: define one small authoritative capability contract used by browser choices,
firmware import validation, PCB resolution, and runtime adapter selection. Block only physically
or functionally incompatible combinations; retain unusual but real combinations when the runtime
actually implements them. Add firmware-host matrix tests covering every advertised combination
and selected forbidden combinations, especially metered fuel, shutoff, ignition, load cells, and
prop/nozzle outputs.

Implemented: one firmware capability contract now validates purpose, role, and driver together.
It accepts the complete Hardware catalog, including two-position relay prop pitch, and rejects
unsupported examples such as relay main fuel, servo shutoff, and load-cell pressure/temperature.
PCB resolution consumes the same contract and a real-header host matrix covers every catalog row.

### [x] P2 FIX OT-FRESH-024 - a renamed thrust channel loses its canonical thrust adapter

`HardwareConfig::_fromDoc()` deliberately falls back from canonical IDs to semantic purposes so an
imported or migrated renamed card still feeds its dedicated EngineData field. That mapping covers
the other canonical sensors but omits `thrust_main -> thrust`. A renamed, valid thrust card remains
visible as a generic registry sample while `hasThrust` stays false, disabling dedicated thrust
telemetry, rule availability, and any feature that checks canonical thrust capability.

Minimal resolution: resolve thrust by purpose exactly like torque and the other canonical inputs,
then test default and renamed IDs for Analog, TLA2528, and NAU7802 adapters.

Implemented: canonical thrust lookup now falls back from `thrust_main` to purpose `thrust`, matching
torque and the other dedicated sensor adapters. The shared host capability matrix covers all three
thrust transports.

### [x] P1 FIX OT-FRESH-025 - successful full restore releases START lock before reboot guard

During `/api/ecu_config`, `_configRestoreOwner` correctly blocks START while uploaded Hardware and
Config values temporarily occupy runtime state. On success, the handler calls
`_finishConfigRestore(false)` before `_scheduleRestart()`. Those calls run on the web core while
commands run on the ECU core, leaving a real interleaving window in which neither the maintenance
guard nor reboot-pending guard is true. A physical, serial, or queued START can therefore enter
STARTUP using newly applied runtime settings while physical drivers are still initialized for the
old hardware. The later safe-reboot check then postpones restart because the engine is active.

Minimal resolution: make reboot-pending visible before releasing the restore owner, and keep the
transaction guarded through that handoff. Add a concurrency-oriented assertion/test for START at
upload completion, not only during upload and after restart scheduling.

Implemented: successful restore publishes reboot-pending before releasing restore ownership. The
safety regression gate asserts this ordering so no START-visible cross-core gap can reappear.

### [x] P1 FIX OT-FRESH-026 - I2C START/STOP still depend on hidden legacy GPIO state

On a generic dev-board configuration, both browser and firmware platform validation require a
local `controls.stop_pin` even when the canonical STOP registry channel is a valid TCA9554 or
TLA2528 input. Runtime gives the registry STOP precedence and ignores that required local pin, so
the saved configuration contains a misleading fallback that is not actually a second stop path.
PCB-profile I2C-only control channels avoid that particular validator, but default IDs
`start_switch` and `stop_switch` are still converted to legacy rule/custom-sequence handles before
registry lookup; their availability checks require local pins. This leaves OT-POST-001/002 only
partly implemented and makes behavior depend on stale compatibility fields.

Minimal resolution: let one canonical addressable STOP channel satisfy the mandatory stop-input
requirement on every board type, clear/ignore its legacy mirror consistently, and resolve a
device-backed default ID to its registry handle wherever transport health matters. Test local and
I2C-only START/STOP across direct commands, cooldown skip, Rules, custom while-blocks, loss/recheck,
and restore round trips.

Implemented: an installed addressable canonical STOP satisfies the mandatory input on either board
style; START remains optional. Canonical registry controls replace their legacy pin mirrors on all
platforms, Rules/custom preflight accepts them, and runtime usability follows configured/healthy
switch state so the existing 500 ms I2C loss policy remains authoritative.

### [x] P2 FIX OT-FRESH-027 - the required Windows release gate can fail on a transient executable block

The complete gate compiled its extended sensor-vector executable successfully, then aborted with
Windows error 4551 when Application Control blocked the first launch of that freshly generated
binary. The real native behavior runner already recognizes this exact intermittent Windows case
and retries the identical binary once after 250 ms; `run_release_checks.py` launches the sensor
binary through its generic no-retry helper. A direct rebuild/run then passed all 28 vector checks,
confirming a gate-execution defect rather than a failed sensor assertion. Because this script is
the declared mandatory release gate, an environmental first-launch race must not produce a false
release failure.

Minimal resolution: reuse one bounded Windows-only 4551 retry helper for every freshly compiled
host executable. Do not retry assertion failures, compiler failures, other OS errors, or a second
4551. Test the helper deterministically and retain the final nonzero result when retry fails.

Implemented: every freshly linked host executable uses one shared Windows-only error-4551 retry
after a bounded policy-settle delay. Unit tests prove one retry succeeds, a second 4551 remains a
failure, and unrelated launch/assertion errors are never hidden. This workstation is currently
persistently blocking the command-queue executable even after the retry; that is correctly reported
as an environment failure rather than a false green result.

### [x] P2 FIX OT-FRESH-028 - PCB profile capability and default-assignment contracts diverge

The browser and registry advertise PCB-backed oil-flow, scavenge-flow, and drain-valve channels,
but `PcbProfileResolver::purposeAcceptsAdapter()` omits those three purposes. The page can therefore
offer and save an electrically compatible named port that firmware rejects during resolution.
There is a second custom-profile failure path: `addProfileDefaults()` inserts every default input
as a placeholder Digital driver before resolving its selected mode. Defaults for pressure,
temperature, speed, flow, torque, thrust, or voltage then fail registry semantic validation even
when the profile mode is the correct ADC, PCNT, thermocouple, or load-cell adapter. The profile
builder validates only default text shape and role/purpose vocabulary, not compatibility with the
mode; a targeted in-memory test added an I2C-ADC oil-pressure default to the official profile and
the builder returned no warnings.

Minimal resolution: share the same purpose/adapter capability table used by OT-FRESH-023, resolve
the mode before adding a default (or construct the default with its real driver), and make the
profile builder reject incompatible defaults before flash. Add positive defaults for analog/PCNT/
thermocouple/load-cell inputs plus negative cross-adapter cases, and cover the three omitted
purposes in browser-to-firmware profile tests.

Implemented: PCB adapter selection now reuses the registry capability contract, covering oil flow,
scavenge flow, and drain valve. Defaults are electrically resolved before insertion. Both firmware
profile parsing and the Python flash-time builder reject incompatible defaults; tests cover analog
pressure, flow, drain, thermocouple/one-wire temperature, and forbidden load-cell/relay cases. The
missing `i2c_adc_digital_input` firmware catalog entry and coolant/intake thermocouple restriction
found during confirmation were corrected in the same contract pass.

## Continued cross-dependency audit - 2026-08-09

### [x] P2 FIX OT-FRESH-029 - coolant and intake cards offered an SPI adapter with no runtime owner

The Hardware page allowed MAX6675/MAX31855/MAX31856 modes for coolant and intake temperature, but
firmware only owns dedicated SPI thermocouple instances for TOT, TIT, and oil temperature. A saved
coolant/intake SPI card could therefore validate as a temperature input yet never publish a sample.
The shared capability contract, PCB resolver/builder, and browser now limit SPI thermocouples to
the three implemented purposes. Coolant and intake retain calibrated analog, NTC, and DS18B20.

### [x] P2 FIX OT-FRESH-030 - typed generic migration could change or reject canonical semantics

Older/expert cards may persist `purpose: generic` with a useful typed role. Firmware validation did
not consistently map these cards to the same capability contract as the browser, and the legacy
`indicator` role derived a purpose name different from the canonical warning-indicator output.
Typed generic cards now use the representative capability for their role without silently becoming
core owners, and indicator derivation consistently produces `warning_indicator`.

### [x] P1 FIX OT-FRESH-031 - canonical legacy mirrors could hide collisions or collide with themselves

Platform validation previously skipped a broad class of core-managed registry pins to avoid
counting their compatibility mirrors twice. That also skipped genuine registry GPIO ownership,
allowing conflicts with unrelated devices; tightening it without mirror awareness made the same
physical endpoint collide with its own legacy field. Validation now skips only an exact canonical
mirror and always registers every other real GPIO, preserving both compatibility and conflict safety.

### [x] P1 FIX OT-FRESH-032 - accepted operator and AB registry inputs were not complete runtime workflows

Idle validation still assumed ADC for non-RC inputs even though the canonical card supports local
digital, pulse, PWM-duty, and shared-I2C forms. Afterburner trigger validation and browser workflow
checks similarly depended on hidden legacy AB command, fire, or arm pins after a canonical registry
card had been selected. Validation, save readiness, and runtime selection now follow the selected
driver and treat addressable `ab_command`, `ab_fire`, and `ab_arm` cards as first-class inputs.

### [x] P1 FIX OT-FRESH-033 - canonical digital flame detectors were interpreted as ADC channels

The main-engine local digital flame card fell through the legacy analog path, losing active-low
semantics. The afterburner path applied a 0..4095 threshold to every adapter; a TCA9554 reports raw
0/1 and could therefore never show flame. Main and AB digital adapters now consume their already
conditioned logical values. Main local/shared-I2C analog cards share the established Config flame
threshold, while AB analog cards retain their per-card threshold and hysteresis. Unhealthy channels
always publish flame off.

### [x] P1 FIX OT-FRESH-034 - a recovered I2C device retained its expired loss timer

Input reads and output heartbeats marked a device present after a successful retry but did not clear
`lossSinceMs`. The UI could show permanent rechecking, and the next isolated failure—even much
later—could trip immediately instead of receiving a new 500 ms confirmation window. Every successful
assigned-device transaction now uses the common recovery path, clearing the old timer for both
inputs and outputs. A safety regression assertion protects both paths.

### [x] P2 FIX OT-FRESH-035 - fuel-admitting startup abort bypassed empty-shutdown fallback

Normal STOP and safety-fault entry already detect a zero-block shutdown sequence and immediately
park all outputs, but the startup Abort path started `_shutdownBlocks` directly after fuel had been
admitted. Structural validation normally blocks START with an empty shutdown sequence, yet corrupt
or future callers still must fail safe. Startup abort now uses the same explicit empty-sequence
fallback and cannot remain stranded in SHUTDOWN with no callback.

### [x] P1 FIX OT-FRESH-036 - STOP loss and startup block faults could log stale fault codes

The dedicated I2C STOP-loss path wrote a useful description and cut the engine, then called the
fault transition without updating `SafetyMonitor::lastFault()`. Startup blocks returning Fault did
the same. Recorder, event, cluster, and telemetry consumers could therefore report `UNKNOWN` or a
previous unrelated code. These paths now publish stable `STOP_INPUT_LOST` and
`STARTUP_SEQUENCE_FAULT` identities; the startup description also names the failing block.

### [x] P3 FIX OT-FRESH-037 - canonical flame cards initialized an unused legacy ADC object

Every canonical local/shared-I2C flame card is sampled through the registry, but sensor setup still
initialized the compatibility flame object whenever `hasFlame` was true. Its `-1` I2C pin was
defensively ignored by the current analog class, so this was not an output hazard, but it preserved
an unnecessary second ownership path and made future driver changes risky. The legacy object is now
initialized only when no canonical flame card owns the input.

### [x] P1 FIX OT-FRESH-038 - web START readiness did not mirror all ECU safety interlocks

The dashboard could offer START while a configured STOP channel was unavailable, or while a native
or registry-backed inhibit, emergency-stop, fault, low-oil, or oil-zero switch was active. The ECU's
final command path still rejected the request, so this was not an unsafe bypass, but it produced a
misleading operator workflow. Web readiness now uses the same active-mode and health semantics as
the ECU core and fails closed for an unavailable configured safety interlock.

### [x] P1 FIX OT-FRESH-039 - remapped and active-low outputs were not all boot-parked safely

Cooling-fan, bleed-valve, and propeller-pitch GPIOs were omitted from the early post-config parking
pass. In addition, several PWM-capable auxiliaries were always driven LOW before LEDC attachment;
for an inverted/active-low output that is full electrical drive, not zero demand. Every remappable
core actuator is now parked before peripheral initialization, using its configured polarity for oil,
secondary fuel, afterburner, scavenge, cooling, bleed, pitch, ignition, glow, and wet-glow outputs.

### [x] P1 FIX OT-FRESH-040 - proportional starter gates failed readiness through an unused relay object

Starter-enable and air-starter intentionally support relay, PWM, and servo hardware. PWM/servo
variants were correctly attached and driven by the generic registry owner, but START readiness also
tested the deliberately uninitialized compatibility RelayActuator and marked the hardware failed.
Readiness now accepts a successfully attached registry-owned native endpoint, and emergency all-off
does not touch the unused relay object; the registry remains the sole physical writer.

### [x] P1 FIX OT-FRESH-041 - physical-output activity could miss a valve and deadlock parked turboprops

The shared START/OTA/reboot activity gate interpreted every repeated semantic output as the core
actuator instead of following actual registry ownership. In particular, the compatibility bleed
valve is persisted as `purpose: valve` with ID `bleed_valve`, so its live core demand could be
missed; additional oil circuits could also be mistaken for the primary pump. Conversely, a
propeller actuator correctly parked at its configured non-zero safe position was treated as an
outstanding command, permanently blocking START, OTA, and configuration reboot. Activity lookup
now uses the actual core owner (including the bleed-valve ID), leaves independent outputs on their
own registry demand, and recognizes the configured pitch park position as neutral.

### [x] P1 FIX OT-FRESH-042 - imported core-output boot demand behaved differently on GPIO and I2C

The Hardware UI displayed a fixed Off post-boot state for engine-owned actuators, but firmware only
range-checked the hidden `safe_demand` field. An imported document could therefore assign a nonzero
value. Native core writers still parked Off, while a TCA9554 applied the persisted value to its latch
before changing pin direction, potentially energizing fuel, ignition, starting, or lubrication only
on the shared-I2C version. Firmware and browser validation now require zero boot demand for every
core engine output and the start-fuel endpoint. General automation outputs retain configurable
initial demand, and propeller pitch retains its explicit nonzero park position.

### [x] P1 FIX OT-FRESH-043 - the fourth afterburner evidence mode could not be saved

The UI offers, serialization preserves, and `ABFlameConfirm` executes mode 3 for an externally
conditioned flame-controller level, but the settings validator still limited `flame_mode` to 0-2.
Choosing the valid fourth option therefore rejected the entire settings document. The authoritative
backend range now matches the same four-mode contract already used by the UI and runtime, with a
regression assertion spanning all three layers.

### [x] P2 FIX OT-FRESH-044 - several advanced controller fields bypassed normal input validation

Predictive gradual protection, predictive automatic idle, and the AB torch guard serialized and
clamped their enum/tuning values, but their save-time validator omitted the newer fields. A malformed
restore was therefore accepted and silently changed later instead of receiving the same clear atomic
rejection as surrounding settings. The existing validator now covers those selectors and their
published numeric ranges; this adds no controls and keeps all settings on one uniform contract.

### [x] P1 FIX OT-FRESH-045 - external AB flame mode admitted fuel before checking input availability

Verified flame mode treated a usable detector as a pre-fuel permission, but the externally
conditioned-level mode could start the AB sequence with its detector disconnected and then fault
immediately after fuel admission. Both sensor-based evidence modes now wait in the existing Arming
state for healthy feedback. Verified mode additionally requires the deliberate OFF observation;
external-level mode keeps its intended ability to trust an already asserted external controller.

### [x] P1 FIX OT-FRESH-046 - manual afterburner FIRE bypassed the configured arm switch

The arm requirement gated throttle, switch, and dedicated-input AB requests, but the manual FIRE
command entered Arming without checking it. Both the browser preflight and authoritative ECU command
handler now require the same active arm state whenever `ab_requires_arm_switch` is enabled. Manual
mode remains one click to fire when no arm switch is required, and rejection names the one missing
condition without adding another control.

### [x] P1 FIX OT-FRESH-047 - manual afterburner ignored arm-switch loss after firing

The manual FIRE entry gate now respected the optional arm switch, but only automatic trigger modes
continued watching that permission after ignition began. Turning the required arm switch off could
therefore leave a manually fired afterburner running. The arm state is now one continuous permission
for every trigger source: losing it stops an active or igniting afterburner through the normal AB
shutdown path. Configurations without an arm switch keep their existing simple manual operation.

### [x] P1 FIX OT-FRESH-048 - registry afterburner command was unavailable to rules

The canonical registry/I2C afterburner command already drove AB triggering and pump scheduling, but
the rule editor hid AB Input, both configuration validators required a local GPIO pin, and runtime
rules rejected the mirrored value. AB Input rules now accept either the dedicated local input or an
addressable `ab_command` channel, using the same normalized value and health guard as the existing AB
control path. This restores native/I2C parity without adding another rule source or user-facing mode.
The same canonical AB command, AB flame, START, and STOP registry cards are also folded into their
existing named rule sources instead of appearing a second time as confusing custom-input duplicates.
The follow-up parity scan also corrected custom while-block readiness, staged and live rule validation,
sequence condition choices, AB-only RC settings visibility, and cluster telemetry capability reporting.
Registry START/STOP sources now pass staged validation through the same addressability guard as live
validation; no alternate unguarded path was added.

### [x] P1 FIX OT-FRESH-049 - live capability telemetry hid registry RC failsafe settings

The Config page detected a registry RC afterburner command while loading Hardware, but the next slow
telemetry frame replaced that result with a legacy throttle/idle-only capability flag. The shared
signal-loss section could therefore disappear even though the registry sampler uses its timeout.
Firmware capability reporting now includes every addressable registry RC-pulse or PWM-duty input,
including AB command, and the browser simulator has a behavioral regression for that exact workflow.

### [x] P1 FIX OT-FRESH-050 - AB pump command was coupled to the firing trigger

Config disabled the valid Dedicated AB Input pump mode unless the same input was also selected as the
AB firing trigger. A throttle, switch, or manual trigger therefore could not be paired cleanly with a
separate proportional pump command. Availability now follows the fitted AB command hardware alone.
Native analog/RC AB inputs are initialized whenever fitted, so changing their pump-control use no
longer creates a hidden reboot dependency; registry/I2C inputs remain continuously supervised.
Canonical registry hardware can select pump control independently of the fire trigger. For older
legacy-only files, a hidden pin is accepted only when it is already the saved trigger or pump source,
so stale imported pin values do not expose a misleading option.

### [x] P1 FIX OT-FRESH-051 - mirrored AB command could have two GPIO samplers

A local canonical `ab_command` registry card could mirror the legacy AB pin. The registry correctly
owned analog/PWM sampling, but the compatibility analog or RC object could initialize the same GPIO
and later overwrite the registry-normalized value; the RC variant could also replace the registry
interrupt handler. Canonical registry ownership now suppresses both legacy initialization and update.
The dedicated legacy path remains available when no canonical command card is fitted.

### [x] P2 FIX OT-FRESH-052 - disabled legacy RC flags could expose irrelevant settings

The expanded RC/PWM capability report initially inherited the old legacy assumption that a saved
`rc_pwm` flag implied a usable input. After removing a throttle, idle, or AB input, a stale type flag
could therefore keep the signal-loss section visible. Legacy capability reporting now also requires
the corresponding fitted input and valid pin; addressable registry RC/PWM inputs remain first-class.

### [x] P2 FIX OT-FRESH-053 - canonical analog cards retained unused legacy ADC initializers

Registry-owned AB flame, fuel-flow, fuel-pressure, battery-voltage, and analog-torque cards already
provided the sole runtime value, but their compatibility ADC objects were still initialized on the
same native pins. They did not currently overwrite the selected reading, but kept a hidden second
ownership path. Initializers now follow the same single-owner rule as updates. Dedicated fuel-flow
PCNT and torque HX711 drivers remain the intentional compatibility owners and are unchanged.

### [x] P2 FIX OT-FRESH-054 - core current telemetry used a second ADC sample

Glow, primary/secondary ignition, and primary oil-pump current were sampled once for protection and
coil logic, then independently sampled again for the canonical output card. ADC noise or timing could
therefore make registry telemetry disagree with the value and health state actually used by safety.
Core-owned cards now mirror that authoritative sample. Independent auxiliary outputs retain their own
current sampling, so no general-purpose capability is removed.

### [x] P1 FIX OT-FRESH-055 - an unavailable reduced-power switch could remove its fuel cap

A registry or I2C reduced-power switch was treated as inactive whenever its input became unavailable.
That could silently clear a manual fuel cap previously asserted by the same physical switch. The ECU
now preserves an asserted request while any configured registry reduced-power input is unavailable; a
healthy inactive level is required to clear it. Native GPIO inputs retain their normal level behavior,
and the independent automatic reduced-power latch remains unaffected.

### [x] P2 FIX OT-FRESH-056 - Hardware exposed ignored RC operator endpoints

Canonical RC throttle and idle cards are sampled by the dedicated operator-input path, whose calibrated
endpoints live in ECU Config. Their registry-card minimum and maximum values were therefore editable on
Hardware but had no runtime effect. Those cards now show the current authoritative ECU endpoints as a
read-only summary and link directly to the matching Calibration workflow. General RC inputs keep their
normal editable electrical range, so no custom-input flexibility is removed.

### [x] P1 FIX OT-FRESH-057 - a bound RC idle channel could have two interrupt owners

The single-owner guard recognized a canonical idle-purpose RC card but not a custom RC card bound to
the operator-idle function, even though configuration compatibility accepts that binding. Such a card
could attach both the generic sampler and the dedicated failsafe-aware idle sampler to one GPIO. Idle
ownership and lookup are now binding-aware, matching throttle behavior without adding a separate mode.
The existing operator-idle binding is also validated, created during legacy migration, and exposed by
the same expert binding editor as the other core assignments instead of remaining a hidden partial path.

### [x] P1 FIX OT-FRESH-058 - duplicate registry bindings had an ambiguous runtime owner

An imported registry could contain the same binding key more than once. Each row validated on its own,
but firmware lookup used the first match, making the effective core assignment dependent on array order.
Registry validation now rejects duplicate keys before applying or saving the configuration. Different
core functions may still bind their own compatible channels; the normal editor workflow is unchanged.

### [x] P2 FIX OT-FRESH-059 - pulse fuel-flow cards exposed unused range controls

The dedicated PCNT fuel-flow path converts measured pulse frequency with the card's pulses-per-litre
calibration. Its displayed minimum and maximum flow fields were not consumed by that path, so editing
them falsely appeared to configure a plausibility window. Pulse flow cards now show the actual
conversion contract and retain the effective pulses-per-litre control without adding another limit.

### [x] P1 FIX OT-FRESH-060 - AB flame hysteresis survived sensor health loss

An unhealthy analog AB flame channel correctly published flame off, but retained its private hysteresis
latch. If the sensor recovered inside the deadband, its pre-disconnect flame state could reappear without
a fresh threshold crossing. Health loss now resets the raw-side latch to the polarity-correct inactive
state. Both active-high and active-low sensors must therefore cross their configured confirmation edge
after recovery; digital inputs keep their direct logical behavior.

### [x] P3 FIX OT-FRESH-061 - Windows policy scanning could abort valid native release tests

Windows Application Control can temporarily block a freshly linked host-test executable more than once
while it scans the file. The harness allowed one fixed retry, which proved insufficient during the final
release run even though the same tests had already passed. It now retries only error 4551, only for the
exact same binary, with three bounded delays before surfacing a real failure. Other launch and test errors
remain immediate failures.

### [x] P1 FIX OT-FRESH-062 - AB flame Calibration updated the wrong threshold owner

For a canonical registry or I2C AB-flame input, runtime switching uses the card's raw threshold,
hysteresis, and polarity. Calibration instead wrote only the legacy AB-flame threshold and then reported
success, so the active setting did not change. Calibration now loads and updates the registry threshold
as its only owner. The Hardware card replaces its
irrelevant analog range controls with a compact active-above/below choice, the current calibrated
threshold, and a range-aware hysteresis field. The browser simulator now exercises the same dedicated
registry-calibration PATCH envelope as firmware.

### [x] P2 FIX OT-FRESH-063 - digital AB flame inputs exposed a no-op ADC threshold wizard

Digital local and TCA9554 AB-flame inputs are intentionally direct logical states, so their configured
polarity is meaningful but an ADC threshold is not. Calibration nevertheless displayed the analog
threshold wizard for them. It now replaces that control with one concise note directing the user to the
Hardware active-high/active-low choice. Analog local and TLA2528 AB-flame inputs retain the calibrated
threshold workflow.

### [x] P1 FIX OT-FRESH-064 - Hardware save review omitted active registry settings

The reboot confirmation filtered out several settings that the Hardware cards expose and firmware
consumes: shared-I2C address/channel, TLA2528 analog calibration, piecewise curves, NAU7802 setup,
auxiliary-output current sensing, and oil-flow input selection. A change limited to one of those fields
could produce “No reviewable hardware changes” and could not be saved; mixed edits could save it without
showing it in the recap. The relevance contract now follows the selected driver and interface, labels
every active field in plain language, formats curve points readably, and omits stale fields that the
selected runtime path does not use. A browser regression checks the real recap data for local and I2C
inputs, I2C outputs, load cells, curves, current sensing, and flow routing.

### [x] P1 FIX OT-FRESH-065 - a Hardware save could overwrite newer sensor calibration

Hardware correctly refreshed the latest complete engine file before reboot, but treated registry input
and output arrays as indivisible replacements. If Calibration updated one registry sensor after Hardware
was opened, then Hardware changed any card, the old array could silently replace that newer calibration.
Registry rows now merge by stable channel ID and then by field: untouched calibration and concurrently
added cards survive, reviewed Hardware edits win on the exact fields they changed, and deliberate card
removals remain removals. Other arrays retain their existing replacement semantics.

### [x] P1 FIX OT-FRESH-066 - shared-I2C switch polarity was missing while no-op fields were shown

Non-PCB TCA9554 and TLA2528 switch cards had no editable active-high/active-low state. TCA flame cards
could instead expose input inversion, and analog AB flame cards exposed both inversion and threshold
polarity, even though those runtime paths consume only active polarity. TCA digital cards also displayed
an ignored numeric range. Digital and threshold inputs now use one uniform active-state control; direct
digital cards explain their 0/1 mapping, AB threshold cards retain their above/below choice, and ignored
range/inversion controls are absent from both the editor and reboot recap.

### [x] P1 FIX OT-FRESH-067 - threshold hysteresis could exceed the usable ADC range

General TLA2528 switch hysteresis used a universal half-range maximum, and AB Calibration could move a
threshold close to an ADC rail without reducing the saved deadband. A sufficiently wide deadband could
put a transition edge outside 0..4095, leaving the switch unable to change as intended. Every ADC-backed
switch now limits total hysteresis to twice the distance from its threshold to the nearest rail. Hardware
uses that range in volts, AB Calibration atomically clamps and saves threshold plus hysteresis, and
firmware validation rejects out-of-range imported combinations.

### [x] P1 FIX OT-FRESH-068 - flame and ADC switches had split condition models and no common calibration

Main flame still consumed the legacy settings threshold and inversion while afterburner flame and
TLA2528 switches consumed per-card threshold, hysteresis, and active polarity. Native ESP32 ADC pins
could not be selected for switch purposes even though the hardware supports them. Main flame, AB flame,
native ADC switches, and TLA2528 switches now use the same raw threshold/hysteresis/polarity contract;
direct GPIO and TCA9554 inputs remain threshold-free logical inputs. Obsolete standalone flame settings
and sensor fallbacks were removed rather than preserving two authorities. Calibration exposes
manual flame hysteresis/polarity and a guided inactive/active capture for every ADC switch, calculates a
midpoint threshold and bounded noise-aware deadband, and saves the canonical card. Raw registry ADC
telemetry supports the wizard. Latches reset to a polarity-correct inactive state on configuration
changes or I2C loss. This pass also corrected a misplaced DOM ID that could hide the fuel-pump minimum
tool when a digital AB flame detector was selected.

### [x] P2 FIX OT-FRESH-069 - registry topology was rediscovered inside control loops

Sensor, controller, and actuator ticks repeatedly scanned every registry row and compared purpose,
role, ID, and binding strings even though channel topology cannot change until reboot. Output updates
also searched every oil loop for every output. Boot-time input/output routing plans now cache immutable
indices, driver classifications, managed-output ownership, and primary oil-loop ownership in compact
byte arrays. Live demands, thresholds, calibration values, and run-safe tuning remain dynamic. The
Classic build retains lower flash/RAM use while removing the repeated control-loop scans.

### [x] P1 FIX OT-FRESH-070 - canonical AB flame telemetry read the obsolete sensor object

Runtime AB flame logic used the canonical registry adapter, but `/api/data` still obtained raw AB flame
telemetry from the unused standalone sensor. A correctly working registry or shared-I2C detector could
therefore show a stale zero in Calibration and diagnostics. The standalone AB flame pin, threshold,
sensor object, JSON mirror, UI helpers, validation exceptions, and calibration mirror are removed.
Runtime, telemetry, capability detection, and Calibration now share the same registry card.

### [x] P1 FIX OT-FRESH-071 - cached output routing was initially built after its first consumer

The first routing-cache revision built the output plan inside generic-output initialization, but
starter-enable and air-starter setup consult ownership earlier in actuator initialization. That order
could temporarily select the legacy local path for a registry-owned output. The plan is now built at
the start of actuator initialization before any consumer, and a regression checks that control-loop
lookups use the cached plan.

### [x] P3 FIX OT-FRESH-072 - ADC switch capture concentrated avoidable web load

The guided ADC switch wizard requested the complete telemetry document at 20 Hz during capture. This is
standby-only, but it needlessly concentrated JSON generation and browser traffic. Capture now samples at
10 Hz for 1.5 seconds, retaining enough data for noise, overlap, threshold, and hysteresis estimation
while halving the request rate. Flame pages also show unusual threshold advisories immediately on load,
not only after saving.

### [x] P1 FIX OT-FRESH-073 - telemetry copied the full engine state inside cross-core critical sections

Every 50-1000 Hz control iteration copied the multi-kilobyte `EngineData` object while holding a
cross-core critical section, and every telemetry read held the same lock for its copy. This could delay
interrupt and network scheduling for display-only work. The ECU now publishes at a bounded 20 Hz—still
well above the normal browser rate—using a single-writer sequence counter. Readers retry an overlapping
copy, so neither side holds a critical section across `memcpy` and control never waits for JSON work.

### [x] P2 FIX OT-FRESH-074 - auxiliary output-current ADCs sampled at the full control-loop rate

Every non-core output with current feedback called `analogRead()` on every actuator tick, potentially
1,000 times per second per channel. These values feed delayed overcurrent confirmation and feedback-loss
logic, not sub-millisecond switching. Auxiliary acquisition is now bounded to 100 Hz while the fast
safety loop continuously evaluates the latest sample. Core glow, ignition, and oil-pump protection
continues to mirror its dedicated sensor path unchanged.

### [x] P2 FIX OT-FRESH-075 - flame threshold warnings assumed active-above polarity

Calibration described a high threshold as a missed-flame risk and a low threshold as a false-flame risk
for every sensor. Those risks reverse for active-below detectors, and threshold zero escaped the low
advisory completely. Main and AB warnings now follow the selected polarity, include both ADC extremes,
remain advisory only, and are browser-tested with an active-below detector.

### [x] P3 FIX OT-FRESH-076 - shared ADC condition helper retained transport-specific naming and lost odd counts

Native ADC and TLA2528 conditions shared one implementation, but it remained named `I2CThreshold`,
obscuring the unified contract. Splitting total hysteresis in half also discarded one count whenever the
configured deadband was odd. The transport-neutral `AdcThreshold` helper now places the extra odd count
on the rising edge and preserves the exact total band. Native behavior and protocol vectors cover both
even and odd deadbands.

## Final software-only release checkpoint - 2026-08-09

- The complete `tools/run_release_checks.py` gate passed after the final concurrency, timing, and
  transport-neutral ADC fixes (the build and non-build stages were run separately after an app context reset).
- Safety regression audit: 170 checks passed.
- Browser coverage: Chromium, Firefox, and WebKit at desktop and narrow widths passed.
- Configuration fuzzing: 24 mixed hardware profiles across 7 pages passed.
- Turbine setup matrix: all 16 representative installations passed.
- Native CommandQueue, controller, shared-I2C, Python, and Go tests passed; sensor protocol,
  ADC-threshold, and calibration vectors passed all 32 checks.
- ESP32 Classic firmware and LittleFS builds passed; the packaged image is 1,605,936 bytes with
  98,000 bytes OTA headroom; static DRAM has 29,136 bytes free and all enforced linker budgets pass.
- ESP32-S3 firmware and LittleFS builds passed; the packaged image is 1,590,864 bytes with
  1,554,864 bytes OTA headroom; static DRAM has 163,952 bytes free and all enforced linker budgets pass.
- Generated browser assets and the public Config reference were rebuilt and validated.
- No remaining software-only defect was confirmed after the additional controller, sequencer, rule,
  afterburner, registry/I2C, ownership, disconnect-recovery, persistence, telemetry, setup-tool, and
  documentation, alternate-ownership, hot-loop, concurrency/timing, and maintainability sweeps through
  OT-FRESH-076.
- Remaining release evidence requires physical hardware: electrical polarity and safe parking,
  sensor disconnect timing, real actuator envelopes, combustion/light-off behavior, EMI/noise,
  brownout/reboot behavior, and the planned full HIL campaign.

### [x] P1 FIX OT-FRESH-077 - governor disable could retain coarse-safe prop pitch

N2 feedback loss deliberately clears the governor's active flag while commanding coarse pitch to load
the free turbine. If Developer Mode then changed the target to 0, the disable path used only that cleared
flag to decide whether pitch needed release, so the retained coarse command could remain latched. The
release decision now also follows the actual retained pitch state. A native regression covers feedback
loss followed by a live governor disable.

### [x] P1 FIX OT-FRESH-078 - standby temporary-output owners could overlap extra cooldown

Timed bench commands excluded other timed tools but did not uniformly exclude Extra Cooldown, while
Extra Cooldown could begin over a running timed test. Direct oil-percentage calibration could also write
the pump while a timed owner was active. The ECU now enforces one temporary output owner across every
entry path, and the Tools page locks timed controls with a clear cooldown state while cooldown owns the
starter/oil/scavenge outputs. STOP retains the common immediate cancellation path.

### [x] P2 FIX OT-FRESH-079 - Starter Test UI finished before the starter output

Firmware intentionally adds the separate starter-enable settling delay before giving the starter motor
its full configured test time. The browser countdown, duration label, and safety confirmation counted
only motor time, so they could report Done precisely when a long-delay starter first began turning. The
UI now shows the enable, wait, and starter stages in one concise description and uses their true total
duration for confirmation and progress without rewriting the saved motor-on duration.

### [x] P1 FIX OT-FRESH-080 - exact millis rollover could alias a live output timer to Off

Temporary actuator deadlines used 0 as their inactive sentinel. An addition landing exactly on the
32-bit `millis()` rollover produced 0, so expiry logic could treat a newly energized tool as having no
timer. A shared wrap-safe deadline constructor now maps that one impossible active value to 1 and is
used by every timed tool, Extra Cooldown, registry-output testing, and bounded emergency cooling.

### [x] P2 FIX OT-FRESH-081 - starter-enable delay had no editor or upper bound

The hardware model loaded, saved, and consumed a starter-enable delay, but the canonical output card did
not expose it and imported positive values were unbounded. The Starter Enable card now contains one
optional settling-delay field. UI and firmware accept 0..30000 ms, runtime clamps legacy data to the
same range, and the Starter Test explanation reflects it.

### [x] P1 FIX OT-FRESH-082 - two-position prop pitch was released as though it were proportional

When governing was disabled, relay fine/coarse pitch followed the servo ramp and could therefore remain
electrically coarse until the internal fractional demand crossed the relay threshold. A relay has no
intermediate position, so it now releases directly to fine. PWM/servo pitch retains its configured
smooth release. Native tests cover both behaviors after N2 feedback loss.

## Final software-only release checkpoint - 2026-08-09 (OT-FRESH-082)

- The complete `tools/run_release_checks.py` gate passed after the malformed-data, timer-rollover,
  temporary-output ownership, starter-timing, and governor state-transition sweep.
- Safety regression audit: 175 checks passed.
- Browser, configuration, pre-hardware UX, cross-browser, setup-matrix, generated-content, native,
  sensor-vector, Python, Go, packaging, and documentation checks passed.
- ESP32 Classic firmware and LittleFS builds passed; the packaged image is 1,606,288 bytes with
  97,648 bytes OTA headroom. Static DRAM has 29,136 bytes free and all linker budgets pass.
- ESP32-S3 firmware and LittleFS builds passed; the packaged image is 1,591,232 bytes with
  1,554,496 bytes OTA headroom. Static DRAM has 163,952 bytes free and all linker budgets pass.
- Generated Hardware and Tools assets were rebuilt after adding the bounded starter-enable timing
  editor and accurate Starter Test sequence countdown.
- No further software-only defect was confirmed by the broadened numeric-boundary, absolute-timer,
  boot-transition, actuator-ownership, governor-release, persistence, and UI/runtime-contract sweep.
- Remaining evidence still requires physical hardware and the planned HIL campaign: actual polarity
  and parked states, disconnect timing, starter contactor/ESC timing, sensor noise and calibration,
  actuator envelopes, EMI, brownout/reboot behavior, and combustion/light-off behavior.

### [x] P1 FIX OT-FRESH-083 - starter-enable qualification could remain blocked at millis zero

Starter-enable settling used its timestamp as both time and active state. If qualification began exactly
when `millis()` was zero, the separate edge flag prevented the timestamp being seeded again while the
zero check prevented the delay from ever completing. The explicit qualification boolean is now the sole
state authority, so zero is accepted as a valid start time and both local and shared-I2C starters behave
identically.

### [x] P2 FIX OT-FRESH-084 - a rollover-started run could be omitted from lifetime time

Run timing treated start timestamp zero as inactive. Entering RUNNING exactly at the counter rollover
therefore hid the live increment and omitted the entire run at STANDBY. A dedicated lifecycle flag now
owns run accounting; the mode owns the live telemetry calculation, and timestamp zero is ordinary data.

### [x] P1 FIX OT-FRESH-085 - automatic relight could trigger twice at millis zero

The relight window also used zero as its inactive marker. A flameout decision at exactly zero could invoke
the relight callback again on the next safety interval and consume another attempt. An explicit active flag
now makes entry idempotent and is cleared on recovery, monitoring gaps, and every non-operating mode.

### [x] P2 FIX OT-FRESH-086 - repeating Extra Cooldown start canceled the active cooldown

`EXTRA_COOLDOWN` previously treated every command received while active as a toggle-off, including a
repeated positive start request caused by a retry or double click. Positive requests are now idempotent;
only an explicit non-positive command cancels the bounded cooldown.

### [x] P3 FIX OT-FRESH-087 - Windows policy scanning outlasted the native-test retry window

Freshly linked native tests were intermittently still blocked by Windows Application Control after the
former 14-second retry window, producing a false release failure; an unchanged immediate rerun passed.
Retries remain narrowly limited to WinError 4551 and the exact binary, but use a bounded one-minute
backoff. Unit tests cover recovery and permanent-block propagation.

### [x] P1 FIX OT-FRESH-088 - I2C loss beginning at millis zero could recheck forever

The common 500 ms I2C disconnect guard used `lossSinceMs == 0` as its inactive state. A first failed
transaction at zero could continuously restart the grace period and prevent a critical device from ever
becoming unavailable. Each discovered device now carries an explicit packed loss-active bit. Native tests
cover the exact boundary, counter rollover, inactive state, and a loss starting at zero.

### [x] P2 FIX OT-FRESH-089 - first-second RUNNING entry could lose its flight-recorder summary

Flight Recorder stored uptime in whole seconds and treated zero as "RUNNING_ENTRY was never called".
A fast or simulated startup in the first second therefore emitted no run summary. An explicit run-active
flag now owns summary lifecycle and still prevents duplicate summaries when shutdown handlers chain.

### [x] P1 FIX OT-FRESH-090 - custom GovernorHold startup could reuse stale controller state

The governor-handoff edge flag lived inside `runControllers()`, but non-operating modes returned before
clearing it. A custom next startup beginning directly with GovernorHold could skip `begin()` and reuse
pitch/fuel controller state from the previous attempt. Non-operating ticks now reset the handoff edge.
Controller-owner telemetry is also mode-aware, so stale Active text cannot claim a shutdown demand.

### [x] P1 FIX OT-FRESH-091 - AB shutdown side actions could reopen AB fuel

Main-engine SHUTDOWN already had a final physical-output combustion invariant, but AB-only shutdown runs
while the main mode remains RUNNING. A custom AB shutdown side action or automation rule could therefore
restore AB valve/pump demand after the immediate cut. The actuator boundary now permits AB fuel during a
real run only in Igniting or Running, and keeps AB spark cut throughout ShuttingDown/Fault. Standby tests
and a shared secondary igniter used for normal-engine relight remain available.

## Final software-only release checkpoint - 2026-08-09 (OT-FRESH-091)

- The complete `tools/run_release_checks.py` gate passed after the lifecycle-state, controller-boundary,
  I2C-disconnect, recorder, command-idempotence, and AB terminal-authority sweep.
- Safety regression audit: 182 checks passed.
- Chromium, Firefox, and WebKit passed at desktop and narrow widths; all 10 UI audit programs passed.
- Configuration fuzzing passed 24 mixed hardware profiles across 7 pages; all 16 representative turbine
  setups passed.
- Native CommandQueue/controller/I2C tests, 32 sensor/calibration vectors, Python and Go suites, generated
  content, setup packaging, public documentation, and both LittleFS images passed.
- ESP32 Classic firmware is 1,606,560 bytes with 97,376 bytes OTA headroom; static DRAM has 29,112 bytes
  free and all linker budgets pass.
- ESP32-S3 firmware is 1,591,520 bytes with 1,554,208 bytes OTA headroom; static DRAM has 163,928 bytes
  free and all linker budgets pass.
- No further software-only defect was confirmed by the final mode-lifecycle, timestamp-as-state,
  command-result, custom-sequence, controller ownership, AB shutdown, config-liveness, and actuator-boundary
  sweeps.
- Physical hardware/HIL remains required for polarity and parking, disconnect timing under electrical
  faults, real sensor noise/calibration, actuator envelopes, EMI, brownout/reboot, and combustion behavior.

### [x] P2 FIX OT-FRESH-092 - output purposes were arbitrarily single-instance

The registry and Hardware page rejected a second card for nearly every built-in output even though the
runtime already has explicit primary ownership and safe all-output shutdown behavior. Outputs are now
multi-instance so series valves, redundant pumps/fans, auxiliary starters, and unusual hobby layouts are
possible. One canonical/first card owns the built-in controller; later cards remain independent rule and
sequence targets. Input singleton rules remain where one unambiguous primary measurement is required.

### [x] P1 FIX OT-FRESH-093 - adding an auxiliary output reset primary protection settings

Creating a second oil pump, igniter, or glow card reran the purpose defaults and could clear the already
configured primary current sensor, overcurrent settings, or ignition mode. Purpose-owned defaults now run
only when the first card is created. Auxiliary cards keep independent per-card monitoring and do not alter
the established controller configuration.

### [x] P1 FIX OT-FRESH-094 - Hardware accepted PWM timing the ESP32 cannot generate

Frequency and resolution were individually bounded but impossible pairs such as 100 kHz at 14 bits could
still be saved and then fail only when LEDC attached during boot. Firmware and UI now enforce the real
80 MHz timer product limit while preserving every achievable pair instead of imposing arbitrary presets.
Native boundary tests cover valid and invalid high-resolution combinations.

### [x] P2 FIX OT-FRESH-095 - Glow PWM exposed two conflicting timing authorities

The Glow card showed legacy frequency/resolution fields separate from the canonical output-card PWM
fields. They could appear to save and then be overwritten or ignored. Main glow timing now has one editor
under Advanced output settings; wet-glow start fuel retains its genuinely separate timer and the same real
hardware timing validation.

### [x] P1 FIX OT-FRESH-096 - a timed-out web START could execute later

The web handler could time out before Core 1 drained the queue, report that START was not accepted, and
leave the live packet to start the turbine later. START requests now use an atomic pending/claimed/canceled
handshake. An unclaimed timeout is canceled and discarded before any state/output change; a claimed request
gets a bounded second wait for its definitive result. Native tests cover cancellation, claim, completion,
and stale completion attempts.

### [x] P1 FIX OT-FRESH-097 - automation could indefinitely strand a committed reboot

After a hardware/config save scheduled a safe reboot, a new rule edge could energize an output. Restart
correctly postponed for active hardware, but configuration commands were already locked, allowing a steady
rule to hold the ECU in that state indefinitely. Pending reboot now releases and freezes automation-rule
ownership. Turbine-owned windmilling oil and other safety behavior remain active and may legitimately delay
restart.

### [x] P1 FIX OT-FRESH-098 - duplicate outputs still shared primary UI ownership

After multi-instance outputs were enabled, several Hardware-page paths still treated every card of a core
purpose as the primary. An auxiliary oil pump could edit primary current sensing, claim built-in sequencer
use, collide with primary pins, or disable the primary actuator when removed. Firmware and UI now use the
same one-owner rule: an explicit advanced binding wins, otherwise the canonical card or first peer wins.
Auxiliary cards expose only their own monitoring and explicit rule/sequence references. Native tests verify
that binding transfers ownership rather than creating a second owner.

## Final software-only release checkpoint - 2026-08-09 (OT-FRESH-098)

- The complete uninterrupted `tools/run_release_checks.py` gate passed after the user-freedom,
  interrupted-operation, reboot-continuity, and duplicate-output ownership scouts.
- Safety regression audit: 189 checks passed. Native tests cover PWM capability boundaries, START
  claim/cancel behavior, and explicit transfer of one built-in output owner.
- All 10 UI audit programs passed, including 24 mixed hardware profiles across 7 pages, 16 turbine setup
  profiles, and Chromium/Firefox/WebKit at desktop and narrow widths.
- Sensor/calibration vectors, I2C/load-cell support, Python and Go suites, generated content, public
  documentation, setup packaging, and both LittleFS images passed.
- ESP32 Classic packaged firmware is 1,607,552 bytes with 96,384 bytes OTA headroom; static DRAM has
  29,112 bytes free and all linker budgets pass.
- ESP32-S3 packaged firmware is 1,592,464 bytes with 1,553,264 bytes OTA headroom; static DRAM has
  163,928 bytes free and all linker budgets pass.
- No additional software-only defect was confirmed after tracing save/restore timeouts, factory reset,
  upload recovery, restart blockers, command acknowledgement, controller/binding ownership, per-card
  monitoring, removal cleanup, pin accounting, validation/runtime parity, and browser workflow labels.
- Physical hardware/HIL remains the necessary next evidence: actual output polarity and parking, I2C
  disconnect timing under electrical faults, sensor noise and calibration, actuator envelopes, EMI,
  brownout/reboot behavior, and real combustion/light-off/shutdown behavior.

### [x] P1 FIX OT-FRESH-099 - topology edits could steal ownership or retarget numeric references

Changing a spare output to a core purpose silently moved the convenience binding away from the established
primary card. Removing a registry row also left surviving legacy numeric rule/sequence handles unchanged,
so every handle above the removed row could begin commanding the next physical card. Re-purpose now keeps
the existing owner unless the user deliberately changes the Advanced binding. All single and grouped
removal paths shift surviving numeric handles while stable string IDs remain unchanged. Browser regression
uses three outputs and verifies both ownership and the physical identity reached after middle-row removal.

### [x] P1 FIX OT-FRESH-100 - reset recovery tracked command type instead of physical demand

The retained abnormal-reset marker was set before mode, timer, OTA/reboot, and capability guards had decided
whether an actuator command would run. A harmless rejected tool command could therefore cause recovery
lockout after a later reset. Conversely, a rule-driven generic output did not pass through that marker path.
Recovery tracking now observes the settled logical demand immediately before the final actuator write,
after controllers, sequences, rules, timers, and protections. Accepted START retains its early transition
marker to cover the short interval before the first physical demand. STOP cleanup also explicitly clears
both bleed-valve demand representations.

### [x] P1 FIX OT-FRESH-101 - auxiliary pumps could silently share or collide flow sensors

Legacy pump flow monitoring found the first input by purpose. With multi-instance oil pumps, an auxiliary
card without an explicit link could therefore appear to own the primary pump's flow sensor. Automatically
generated flow-input IDs could also collide when long pump IDs shared the same 19-character prefix, and
removing an auto-created input bypassed numeric-reference shifting. The first pump alone inherits a legacy
unlinked sensor; every auxiliary monitor now gets a collision-safe unique ID and an explicit per-pump link.
Automatic removal uses the same reference-preserving path as manual removal. A real-browser regression
covers three pumps whose long IDs intentionally collide after truncation.

## Final software-only release checkpoint - 2026-08-09 (OT-FRESH-101)

- The complete uninterrupted `tools/run_release_checks.py` gate passed after the topology, coincident-event,
  saved-intent, mode-mask, and driver/transport scouts.
- Safety regression audit: 192 checks passed. The pre-hardware browser audit now has 43 workflow groups,
  including explicit binding preservation, middle-row numeric-reference stability, and independent
  collision-safe flow monitoring for three oil pumps.
- All 10 UI audit programs passed, including 24 mixed hardware profiles across 7 pages, 16 representative
  turbine setups, and Chromium/Firefox/WebKit at desktop and narrow widths.
- Native command/controller behavior, sensor/calibration vectors, I2C/load-cell support, Python and Go
  suites, generated web/reference content, public docs, setup packaging, and both LittleFS images passed.
- ESP32 Classic packaged firmware is 1,607,568 bytes with 96,368 bytes OTA headroom; static DRAM has
  29,112 bytes free and all linker budgets pass.
- ESP32-S3 packaged firmware is 1,592,464 bytes with 1,553,264 bytes OTA headroom; static DRAM has
  163,928 bytes free and all linker budgets pass.
- The additional mode/driver scout confirmed that user-visible engine-state bits, rule masks, registry
  driver numbers, capability filtering, and final firmware transports agree; no further software defect
  was confirmed in that pass.
- Hardware/HIL remains the next evidence boundary: real polarity and parking, expander disconnect timing,
  sensor noise and nonlinear calibration, actuator envelopes, EMI, brownout/reset, and combustion behavior.

### [x] P2 UX OT-RELEASE-102 - warn about afterburner hot-streak ordering without restricting it

A custom afterburner sequence may intentionally ignite a torch or hot streak before commanding a fitted
ECU-controlled afterburner pump. The sequencer validator now calls out that ordering and asks the user to
verify where the ignition fuel comes from, but leaves the sequence valid. This preserves experimental
freedom while making an accidental missing `ABPumpOn` easy to spot. The beta release audit locks in the
warning text and its non-blocking behavior.
