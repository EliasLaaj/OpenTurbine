# OpenTurbine bench validation campaign

## Complete pre-release gate

From the repository root, run:

```text
python tools/run_release_checks.py
```

This is the publication gate for both ESP32 targets. It rebuilds the web
assets, runs UI/safety/setup/package tests, builds both firmware and LittleFS
images, and checks OTA, filesystem, static DRAM, IRAM, and RTC memory margins.
The release gate preserves at least 16 KiB of statically linkable DRAM on the
Classic ESP32 and 64 KiB on ESP32-S3 so routine future features cannot return
either target to a build-only-by-a-few-bytes state.
`--skip-build` is useful during editing but is not a release result.

Systematic hardware-in-the-loop validation of the OpenTurbine firmware on the
bench rig, aimed at finding defects **before** they reach a real turbine engine.
The current release candidate is OpenTurbine 2.2.2. DUT and tester roles may be
swapped between the ESP32-S3 and Classic ESP32 as a campaign requires. Tests
drive physical ADC/PCNT/SPI/digital paths where wired and use explicit simulator
coverage for unavailable I²C devices.

The first findings below are retained historical v1.x campaign evidence. Use
the **v2.0.0 release-candidate HIL** section as the baseline and the newer
2.1.0 verification audit and dated result files for current sign-off;
superseded EGT-rate and old configuration behavior are not v2 requirements.

Legend: ✅ pass · ⚠️ anomaly/concern · ❌ bug · ⏭️ not physically testable

## v2.2.2 ESP32-S3 release-candidate qualification — 2026-09-05

- ✅ The exact ESP32-S3 image (`build_id 2453e51295e85291`, firmware
  SHA-256 `0C5CB721CD8C6AD93328343B3D04BAFEAC884BF103A6A6F1D6DEBCE1F533B547`)
  was built with the pinned production toolchain, flashed with its matching
  LittleFS image and verified live on the 16 MB bench module using the universal
  8 MB partition layout. The 1,642,544-byte firmware leaves 1,503,184 bytes of
  OTA headroom; static DRAM, IRAM and RTC slow-memory headroom are 149,912,
  278,528 and 7,640 bytes respectively.
- ✅ With the Classic ESP32 running OTBench 0.9, the final S3 candidate passed
  the ten-profile physical web/HIL matrix (`ten_build_webui_hil_20260904_232258.json`),
  10/10 hard-safety cases (`phase2_safety_hil_20260904_234401.json`), 8/8 starter
  and pressure-control cases (`v2_controls_hil_20260904_234724.json`), and 13/13
  controller/rule/safety priority cases (`interaction_hil_20260904_235323.json`).
- ✅ Afterburner coordination passed 3/3, shutdown/scavenge ownership passed
  4/4, live/deferred configuration and FinalStop behavior passed 5/5, session
  logging passed 2/2, and physical TCA9554/TLA2528/NAU7802 behavior passed 13/13
  (`afterburner_limp_hil_20260904_235440.json`,
  `shutdown_output_ownership_hil_20260904_235616.json`,
  `finalstop_live_config_hil_20260904_235718.json`,
  `session_logger_hil_20260904_235929.json`, and
  `i2c_devices_hil_20260905_000115.json`).
- ✅ The corrected explicit-controller causal plant profile passed 5/5
  (`plant_hil_20260905_085724.json`): safe standby, physical-output-driven
  startup through RUNNING, operator demand raising physical fuel and shaft
  speed, 180 seconds/828 samples with zero transport or status errors and no
  added loop overruns, and physical STOP cutting all combustion outputs.
  A first run exposed an obsolete harness assumption that schema-1 profiles
  retain hidden throttle ownership; the harness now installs and later removes
  the explicit Main Fuel controller required by the released model.
- ✅ Ten consecutive hardware-save warm reboots preserved exact configuration
  identity and recovered AP/DHCP/API service in 2.7–2.9 seconds each
  (`reboot_recovery_hil_20260905_085254.json`). Page-scoped save, sequence
  add/save/reboot/restore and 24-page navigation audits passed. Two full
  ten-minute realistic browser sessions each completed 38 connected page loads,
  two persisted saves and an engine-file round trip; their only assertion was
  obsolete bookkeeping of successfully retried bounded `/api/config` 503
  responses. After restricting that classification to retryable configuration
  GETs only, the targeted session rerun passed with all settings restored.
- ✅ All 12 files served by the final S3 DUT are byte-identical to the release
  assets. The final unit is in STANDBY with no fault and zero fuel, ignition,
  starter, oil, afterburner or throttle demand; OTBench independently reports
  every captured output at its safe state.
- ⚠️ This is controlled dry-bench qualification. It does not replace powered
  driver/load, real thermocouple and bridge sensors, plumbing, EMI, brownout,
  vibration, emergency-stop installation, combustion or engine validation.

## v2.2.2 Classic release-candidate qualification — 2026-09-04

- ✅ The exact ESP32 Classic image (`build_id c477e5aa8648d325`, SHA-256
  `B5AAA24BBC44B759FDBA78379A5C853998C00C7F81DCAEC2FBCEB177B8AC55D2`)
  passed the Classic image/linker gate. The 1,657,584-byte firmware leaves
  46,352 bytes in its OTA slot; the web payload leaves 144,257 bytes before
  filesystem overhead; static DRAM, IRAM and RTC slow-memory headroom are
  19,680, 40,288 and 116 bytes respectively.
- ✅ The uninterrupted no-rebuild publication suite passed all 10 UI audit
  programs, 274 safety regressions, 17 representative turbine setups, native
  command/controller/I2C/feedback behavior, 32 extended sensor-protocol
  vectors, 42 Python tests and the Setup Tool Go tests. The exact Classic
  firmware and LittleFS images were built and checked separately.
- ✅ With the ESP32-S3 running the OTBench tester firmware, the exact candidate
  passed 11/11 reachable pin/function cases, 2/2 independent physical
  fuel-isolation cases and 9/9 reversed digital-sensor cases
  (`classic_pinfunc_hil_20260904_224833.json`,
  `classic_safety_hil_20260904_224456.json` and
  `reversed_digital_sensor_hil_20260904_225108.json`). These cover PWM and
  servo outputs, relays, PCNT, ADC, digital input, starter behavior, physical
  STOP, overspeed isolation, MAX6675/MAX31855/MAX31856 conversion and fault
  detection, and HX711 signed conversion and timeout handling.
- ✅ Live Wi-Fi validation covered all pages, persisted page-scoped saves,
  sequence-output round trips, reboot detection, engine-file restore and a
  591-second realistic session. A cross-profile restore defect found during
  the campaign was corrected: full engine-file restore now resolves controller
  rule handles only after installing the uploaded hardware, so valid custom
  rules are not silently discarded. The final build preserved the exact
  enabled Main Fuel rule across an incompatible hardware profile and reboot.
- ✅ All 12 web assets served by the final DUT are byte-identical to the local
  release files. Final recursive ECU-file comparison matches the saved baseline
  except for the deliberately disabled physical START pin; the unit is in
  STANDBY with no fault and all commanded outputs inactive.
- ⚠️ This qualifies the Classic candidate for controlled external dry-bench
  testing, not unattended operation or engine release. It does not cover a
  fueled engine, installed driver-power stages, plumbing, EMI, a real
  thermocouple junction/load-cell bridge, or installation-specific emergency
  shutdown wiring. ESP32-S3 product-firmware qualification remains a separate
  follow-up; the S3 was used here only as the physical stimulus/readback rig.

## v2.2.2 dual-target qualification — 2026-09-01

- ✅ ESP32-S3 DUT with Classic ESP32 tester passed the timer-only and
  single-shaft/TOT/oil physical web-configuration profiles. The campaign
  exercised ADC input, calibrated throttle movement, oil PWM, fuel shutoff,
  ignition, main-fuel servo demand, startup acceptance, active startup/run
  states, physical output readback, configuration persistence and restoration
  (`ten_build_webui_hil_20260901_211917.json` and
  `ten_build_webui_hil_20260901_212101.json`).
- ✅ Both physical targets completed engine-file export/import/reboot/readback.
  Classic reproduced the exported file byte-for-byte; S3 reproduced the same
  recursive JSON values after canonical serialization. PCB-backed Classic
  hardware save/readback also passed without removing the installed
  `jet-ecu-v1` PCB profile.
- ✅ The exact Classic release firmware completed the eight-page connected
  browser audit with API recovery, mobile checks, zero transient failures and
  stable heap. The S3 completed 24 page loads with zero retries and stable heap.
- ✅ The final software gate passed all 10 UI audit programs, 269 safety
  regressions, 17 representative turbine configurations, native controller and
  protocol vectors, 42 Python tests, Setup Tool Go tests, both firmware and
  LittleFS builds, and all enforced image/linker budgets. Windows Application
  Control blocked launching a newly linked unsigned local probe; the unchanged
  trusted native probes passed locally and the clean GitHub runner repeats the
  canonical compilation/execution gate.
- ⚠️ This is dry-bench qualification. Every installed ECU still requires
  wiring, polarity, independent emergency-stop, driver-power, plumbing, EMI
  and controlled first-engine validation on its actual turbine.

## v2.2.0 Classic shipping qualification — 2026-08-30

- ✅ A final cross-target controller campaign exposed and fixed stale Automatic
  Idle floor ownership. The corrected S3 candidate then passed controls 8/8,
  safety 10/10, interactions 13/13, I²C 13/13, afterburner 3/3, shutdown
  ownership 4/4, live configuration 5/5, and session logging 2/2. Its realistic
  browser session completed eight connected navigations, two persisted saves,
  and an engine-file download/upload/restore round trip
  (`s3_v220_final_4a4c6cda_soak`).
- ✅ A repeated-build audit found and removed cumulative wrapping in the
  pinned web-server header-retention patch. Consecutive Classic and S3 builds
  are now byte-identical. The clean images pass their linker/filesystem gates:
  Classic firmware is 1,653,904 bytes with 50,032 bytes of OTA-slot headroom;
  S3 firmware is 1,639,216 bytes with 1,506,512 bytes of headroom.
- ✅ ESP32 Classic DUT with ESP32-S3 tester passed all 11 reachable physical
  pin/function cases: PWM oil demand, fuel solenoid, ignition, starter enable,
  servo pulse, N1 PCNT, ADC, digital input, starter-assist stop, repeated
  StarterSpin pulses, and physical STOP cut
  (`classic_pinfunc_hil_20260830_111007.json`).
- ✅ The same candidate passed both independent physical fuel-isolation cases.
  N1 overspeed removed fuel, ignition, and metering demand in 0.565–0.667 s;
  physical STOP removed them in 0.383–0.400 s
  (`classic_safety_hil_20260830_111009.json`).
- ✅ The final Classic image also passed 9/9 digital-sensor cases: MAX6675,
  MAX31855 and MAX31856 conversion/open-circuit behavior plus HX711 positive,
  signed-negative and missing-data behavior
  (`reversed_digital_sensor_hil_20260830_111556.json`).
- ✅ The safety campaign then restored the saved engine file successfully on
  the fragmented Classic heap. The exact final build then completed a realistic
  one-tab browser session with seven connected page navigations, two persisted
  settings saves, a complete engine-file download/restore, and original-value
  restoration (`classic_v220_final_cb0debb0_soak`). Earlier sustained telemetry
  completed 60/60 consecutive 300 ms requests without reboot or transport
  error.
- ⚠️ This remains dry-bench qualification. It does not replace installation
  wiring, driver-power, EMI, plumbing, combustion, or controlled first-run
  validation on the user's actual turbine.

## v2.1.0 qualification — 2026-08-25

- ✅ The uninterrupted publication gate passed on the final source: all 10 UI
  audit programs, 240 safety checks, 16 representative turbine setups,
  sensor/protocol vectors, native controller behavior, Python and Go tests,
  generated public content, and both firmware and LittleFS builds.
- ✅ The exact final Classic candidate was installed over USB with its matching
  web filesystem and then
  passed 2/2 physical fuel-isolation cases
  (`classic_safety_hil_20260825_191214.json`). Overspeed and physical STOP both
  removed fuel, ignition, and metering demand and the saved ECU setup was
  restored afterward. The preceding unchanged logger implementation passed 2/2
  bounded session-recorder
  cases (`session_logger_hil_20260825_090750.json`). Overspeed and physical
  STOP evidence and logging produced a valid 43-row run file with zero dropped
  rows.
- ✅ The exact packaged Classic firmware and final on-device web assets passed
  a same-file engine export/import/reboot/readback round trip, complete 742-line
  NDJSON and CSV event exports, current-session CSV export, 15 connected page
  navigation samples, continuing live dashboard updates, and zero browser
  console errors. The field-help regression now covers every generated
  controller setting, installed input/output editor, visible calibration field,
  and sequence parameter.
- ✅ The same exact Classic candidate completed the final realistic browser
  workflow with eight navigations, two persisted save/readback cycles, complete
  engine-file download/upload, and original-value restoration
  (`classic_v210_exact_final_session`). Every page reached CONNECTED.
- ✅ ESP32-S3 release-candidate hardware completed the equivalent save,
  engine-file transfer, navigation, and restoration workflow in 91 seconds
  (`s3_v210_publish_smoke`). The final S3 source rebuild passed the identical
  software suites and image/linker budgets.
- ✅ Final image budgets pass: Classic firmware is 1,621,312 bytes with 82,624
  bytes of OTA headroom and 33,616 bytes of statically linkable DRAM free; S3
  firmware is 1,605,392 bytes with 1,540,336 bytes of OTA headroom and 167,048
  bytes of statically linkable DRAM free.
- ⚠️ These are dry-bench and simulated-plant qualifications. No fueled turbine
  or installation-specific EMI, driver-power, plumbing, or combustion test was
  performed; every installation still requires its own wiring inspection, dry
  output/polarity commissioning, and controlled first-engine test.

## v2.0.4 final dual-target qualification — 2026-08-23

- ✅ **Classic ESP32 as DUT, ESP32-S3 as tester:** 11/11 reachable pin/function
  cases passed (`classic_pinfunc_hil_20260822_190410.json`), followed by 2/2
  physical fuel-isolation safety cases (`classic_safety_hil_20260822_190422.json`)
  and 2/2 bounded session-logging cases
  (`session_logger_hil_20260822_205910.json`). The final realistic browser
  session ran 319 seconds with 18 navigations, live save/readback, complete
  engine-file download/restore, cleanup save, no panic, and the original
  profile restored (`classic_heapguard_soak_20260822`).
- ✅ **ESP32-S3 as DUT, Classic ESP32 as tester:** 10/10 hard-safety cases
  (`phase2_safety_hil_20260822_211431.json`), 13/13 controller/protection
  interactions (`interaction_hil_20260822_213350.json`), 3/3 afterburner and
  Reduced-Power interactions (`afterburner_limp_hil_20260822_213505.json`),
  4/4 shutdown-output ownership cases
  (`shutdown_output_ownership_hil_20260822_213703.json`), and 2/2 bounded
  session-logging cases (`session_logger_hil_20260822_211652.json`) passed.
- ✅ The final S3 user-session soak completed 18 page navigations, two
  acknowledged persisted controller saves, complete engine-file
  download/upload/restore, the one expected software reboot, original-value
  restoration, and zero HTTP, browser-console, conflict, panic, or unexpected
  reset failures (`s3_final_user_soak_20260823`). A final all-page audit of the
  rebuilt Controllers/System UI passed with zero transient API retries
  (`s3_final_ui_nav_status_20260823`).
- ✅ The campaigns exposed and closed four web/storage defects before sign-off:
  an unsafe low-heap raw client close, an S3 full-config snapshot allocation,
  a Log read lease tied to TCP keep-alive, and configuration pages retaining
  unnecessary WebSockets during navigation. Controllers/System now obtain
  live mode and Developer Mode lock state from the compact status heartbeat.
- ✅ Final firmware budgets remain within target: ESP32-S3 uses 35.5% static
  RAM and 50.9% application flash; Classic uses 29.7% static RAM and 94.9%
  application flash. Session-log filesystem reserve scales to the target's
  actual LittleFS size, so the bounded 64-row logger works on both chips.

## v2.0.4 web-persistence and Setup Tool qualification — 2026-08-16

- ✅ Repeated real-browser navigation, page interaction, configuration edits,
  persistence, readback, and restoration were exercised against both physical
  targets while the other ECU was electrically isolated. The test fails if the
  ECU boot counter changes or any output becomes active.
- ✅ The Classic ESP32 completed the corrected low-memory persistence session
  without rebooting: 12 page navigations and two acknowledged, read-back saves
  over 150 seconds, followed by restoration of the original setting.
- ✅ The ESP32-S3 completed the equivalent cross-page edit workflow without a
  reboot. A diagnostic rerun also verified that an absent session log is the
  only expected 404 and records the exact endpoint for every other HTTP error.
- ✅ The Windows Setup Tool was visually exercised at a 588 × 487 client area.
  Its home, safety, wait, and board-selection screens remained readable and
  usable, and live USB detection clearly reported the responsive S3 and asked
  for its matching hardware package before any erase step.

The exact versioned release-gate and final flashed-image checks are recorded
before publication; the v2.0.3 evidence below remains historical.

## v2.0.3 final cross-platform web and release qualification — 2026-08-14

- ✅ The canonical `python tools/run_release_checks.py` publication gate passed,
  including 204 safety-source checks, 43 browser UI behavior groups, native
  behavior tests, configuration/package audits, both firmware builds, both
  LittleFS images, and the enforced memory/linker budgets.
- ✅ ESP32-S3 completed 70 complete seven-page navigation cycles (490 real page
  loads) with no transient request failures. The HTTP TIME_WAIT guard stabilized
  at seven retained entries instead of exhausting lwIP's fixed 16-PCB pool; 163
  completed connections were reclaimed during the run. Final heap was 44.4 KiB
  free with a 31.7 KiB largest block.
- ✅ Classic ESP32 completed approximately 490 cumulative page loads on the same
  firmware/UI behavior, including 140 loads with registry-backed START, STOP,
  throttle, and idle inputs visible and live in the compact dashboard layout.
  Final observed heap remained about 63.5 KiB free with a 38.9 KiB largest block.
- ✅ Live engine-file save, export, import/restore, page navigation, theme
  persistence, output-mode presentation, and compact telemetry were exercised.
  Each ECU's original profile was restored afterward.
- ✅ Both final v2.0.3 images booted on physical hardware, reported STANDBY, and
  reported all outputs inactive. Both access points were visible simultaneously
  after qualification, confirming neither board was left reset or in bootloader.

This is dry-bench and simulated-plant evidence. It does not claim a fuel-burning
engine run and does not replace installation-specific wiring inspection, output
polarity checks, dry commissioning, or a controlled first-engine test.

## Findings (running)

### Safety monitor
| Check | Result | Detail |
|---|---|---|
| OVERSPEED | ✅ | N1 60000 vs limit 50000 → SHUTDOWN in **0.37 s** (RPM reads within 0.2 s, ~3-sample confirm). No false trip at 49000. |
| OVERTEMP (TOT) | ✅ | TOT 800 vs limit 700 → SHUTDOWN in 0.76 s. No trip at 650. |
| HOT_START | ✅ | TOT 300 (>threshold 200) at start → STARTUP aborted "hot start" in 0.3 s. Cold start (120) proceeds. |
| hot_start × overtemp | ✅ (interaction) | Hot-start (STARTUP, TOT>200) correctly pre-empts overtemp (700) during a start — intended: don't keep starting into a hot engine. |
| Startup EGT protection | Superseded | v2.0 replaces the simple rise-rate trip with a pre-start interlock plus an explicit startup hard EGT limit. |
| LOW_OIL | ✅ | With OilPrime in seq (arms oilMinBar=1.5): oil 0.4 bar → SHUTDOWN 0.25 s; 1.7 bar no trip. (Minimal seq never arms oilMinBar — by design.) |
| FLAMEOUT | ✅ | In RUNNING (flameMonitorActive forced at STARTUP→RUNNING, main.cpp:1696): flame loss + EGT drop → SHUTDOWN in 3.42 s (matches 3 s confirm), relight-not-possible. Stays lit while flame present. |
| OIL_ZERO | ✅ | In RUNNING, oil ~0.08 bar (< zero 0.1) → SHUTDOWN 0.37 s. No trip at 0.25 bar. **See cal caveat below.** |
| OIL_TEMP_HIGH | ✅ | NTC via pin-reuse: ~148 °C (> limit 90) → SHUTDOWN 0.28 s; 70 °C no trip. |
| BATT_LOW | ✅ | Analog via pin-reuse: 7 V (< min 10) → SHUTDOWN 0.16 s; 11 V no trip. |
| UNDERSPEED | ✅ | (found incidentally) N1 falls below min_rpm in RUNNING → SHUTDOWN. Correct flameout/stall protection. |
| FUEL_PRESS_LOW | ⏭️(likely ✅) | Same RUNNING + pin-reuse mechanism as oil-zero/batt (both pass); not separately run. |
| TIT_OVERTEMP / SURGE | ⏭️ | TIT = 2nd SPI thermocouple not wired (one CS). Surge = rapid RPM variance, hard to synthesize cleanly. |

**Safety verdict: 10/12 checks validated on hardware, all correct, no firmware defects.** Every catastrophic-failure protection (overspeed, overtemp, EGT-rate, oil-zero, low-oil, flameout, under-speed, hot-start) fires with a proper confirmation window and no false trips.

Response times are all fast and confirmation-windowed (no single-sample false trips): overspeed 0.37 s, overtemp 0.76 s, EGT-rate 0.27 s, low-oil 0.25 s, oil-zero 0.37 s, flameout 3.4 s (by design), hot-start 0.3 s.

### Controllers
| Controller | Result | Detail |
|---|---|---|
| Throttle slew (rate limit) | ✅ | `throttle_effective` ramps 0.05→0.86 over ~2 s under `ramp_up_ms=2000` (gradual, not a step). |
| Throttle pullback | ⏳ | pending (N1/EGT near-limit throttle reduction) |
| Oil P-loop / dynamic idle / governor | ⏳ | pending (governor needs N2, not wired) |

⚠️ **THROTTLE_OUT servo line unverified — wire check needed.** Firmware drives a
correct continuous 50 Hz servo pulse (`ServoActuator`, confirmed in source), and
`throttle_effective` follows demand, but the tester reads **no pulse** on GPIO18
(oil-pump LEDC + relay outputs all read fine). The original suite only tested
throttle *input*, never the servo *output* — so **S3 GPIO16 → tester GPIO18 was
never actually validated.** Needs the jumper checked before the throttle/starter
servo output paths can be signed off.

### Framework notes (important for anyone re-running)
- Config changes MUST be verified (re-read); a config PATCH or hardware POST that lands too close to a reboot, or while the engine is not in STANDBY, silently no-ops. `DutConfig` now verifies + retries.
- Opening the tester serial port glitches the DUT into STARTUP (DTR→EN reset). Always `ensure_mode_standby()` after connecting, before any config change.

## Bugs / anomalies

No **firmware** bugs found so far — the seven critical safety shutdowns all fire
correctly with sane confirmation windows and no false trips. Notes worth raising
with the author:

1. ⚠️ **Oil-zero reachability depends on calibration (engineering note, not a bug).**
   OIL_ZERO fires when `oilPressure < oil_advanced.zero_bar` (default 0.1 bar)
   *and the sensor reads healthy*. If a user's oil-pressure calibration never maps
   the real zero-pressure reading below 0.1 bar (e.g. sensor offset, or a naive
   0–N bar linear cal over the full ADC range), oil-zero can never trigger — the
   most catastrophic oil fault would be silent. Worth a calibration-page warning
   or a sanity check that `poly(zero-pressure raw) < zero_bar`. (On the bench the
   ESP32 ADC's ~0.1 V low-end floor made this visible.)
2. ℹ️ LOW_OIL only arms once a sequence block (`OilPrime`/`StarterSpin`/`Spool`)
   sets `oilMinBar`. A hand-built startup sequence that omits all three leaves
   low-oil protection off in STARTUP. `flameMonitorActive` has an explicit
   safeguard for exactly this (main.cpp:1696) — `oilMinBar` does not. Consider a
   similar backstop or a config-validation warning.

---

## Session 2 — 2026-07-07 (fw 1.4.0, S3 + tester)

Full regression re-run plus guides/UI/feature work. Real-problem log:
`bench/ISSUES_FOUND.md`. Known open item: DUT went unreachable after a flash near
the end (flash succeeded + hash-verified; AP didn't return, PC couldn't re-associate)
— items marked ⏳ are implemented/ready but await a DUT power-cycle to validate.

### Validated GREEN on hardware this session
- ✅ **Safety monitor** — OIL_ZERO trips 0.08 s once properly
  armed (the batch "FAIL" was the `only_safety` reboot-race verify artifact, not a
  defect); safety-block config round-trips correctly.
- ✅ **ServoActuator on S3** (session-1 open item RESOLVED) — attach-retry fix lands;
  throttle ESC ramps smoothly 0→full in ~2 s (`ctrl_slew`).
- ✅ **Throttle slew + N1/EGT pullback**, incl. under the governor, respecting the fuel floor.
- ✅ **Governor, both flavours** — throttle-driven (winds fuel to hold N2, respects the
  fuel floor at 0.08) and prop-pitch/load-driven (winds pitch, leaves throttle to pilot).
- ✅ **Fuel-pump minimum-spin floor** — 15% floors at 0.150, 10% at 0.100, 0 = no floor
  (throttle → ~0). Replaces the old fixed 8% idle floor by design.
- ✅ **Relight** 5/5, **rules** 6/6 (thresholds + hysteresis + shutdown), **sequencer** (blocks,
  gates, aborts, ImmediateCut), **config** persistence/reboot/illegal-pin/out-of-range-reject.
- ✅ **Oil P-loop** drives the pump to target pressure (sign response).

### Firmware fix this session
- ❌→✅ **OilPrime silent no-prime when the oil control loop is disabled.** With an oil
  sensor, `OilPrime` sets a pressure target and relies on `g_ctrlOilLoop` to drive the
  pump; if the loop is off, nothing drives it → times out into an abort with no reason.
  Added a preflight `seq_issue` warning (main.cpp sequence validation, OilPrime case).
  Confirmed: with the loop enabled OilPrime drives the pump to 100%.

### Engineering notes from session 1 — now addressed
- Note 1 (oil-zero reachability): the Calibration page now warns after an oil fit if the
  curve never reads below the zero-pressure threshold at the low end (OIL_ZERO could be silent).

### Validated GREEN after the DUT was power-cycled (firmware + UI reflashed)
- ✅ **New preflight warnings** both fire on hardware: OilPrime-needs-oil-loop, and
  low-oil-arming (sequence with no oil-arming block).
- ✅ **Standby-oil SET-PRESSURE mode** 5/5 (`standby_oil_pressure_test.py`): regulates to
  the target bar, floors at feed_pct, disengages + releases the pump when windmilling stops,
  and fixed-% mode (feed_bar=0) is unchanged.
- ✅ **Calibration pipeline** 4/4 (`calibration_pipeline_test.py`): oil cubic scaling, flame
  threshold tracking, fuel-pump-min save, oil zero-reachability.
- ✅ **Digital inputs** 3/3 (`di_switch_test.py`): DI channel debounce/state (pin-reused),
  START switch initiates start, STOP switch shuts down.
- ✅ **Rules engine** reconfirmed 6/6 + extended (LT operator + OIL_PRESS source + IGNITER
  actuator) on the new firmware.
- ✅ **Afterburner** 5/5 (`afterburner_test.py`): AB_FIRE opens the AB solenoid (telemetry +
  physical relay on the remapped pin), drives the AB pump to 90%, reaches AB Running with the
  main-fuel offset live, and AB_STOP shuts it down cleanly. New engineering note filed:
  default AB ignition faults ("no active ignition method") when torch has no EGT cap and the
  AB igniter is off — see ISSUES_FOUND.md #7.
- ✅ **Guides/UI** deployed via uploadfs; new firmware confirmed live (`governor_mode`,
  `standby_oil_feed_bar` telemetry present).

**All planned HIL validation is complete.**

---

## v2.0.0 release-candidate HIL — 2026-07-28/29

Normal orientation: ESP32-S3 DUT on COM4, classic ESP32 OTBench on COM3. Every
campaign below snapshots and restores the unified engine file.

- ✅ `v2_controls_hil.py` 8/8: one-shot and repeating Pulsed Starter Assist,
  threshold latch, STOP priority, P1/P2 Automatic Idle, and simple/predictive
  P1 fuel protection at measured physical sensor values.
- ✅ `phase2_safety_hil.py` 10/10 behaviors: hot-start rejection, separate
  startup overtemperature, N1/N2 overspeed, running overtemperature, low oil,
  near-zero oil, flameout, shared Reduced-Power cap, and physical STOP. Every
  shutdown cut fuel, ignition, and the main-fuel servo at the tester pins.
- ✅ `interaction_hil.py` 13/13: control rules and governor demand cannot bypass
  gradual protection, feedback-loss/Reduced-Power caps, hard safety, relight
  STOP, rule-requested shutdown/fault, or simultaneous shaft/temperature/oil
  faults. Running rule deletion releases its output atomically. The final run
  restored the original engine file and re-confirmed firmware 2.0.0.
- ✅ `i2c_devices_hil.py` 13/13: TCA9554 discovery, digital input/output and
  disconnect fail-safe behavior; TLA2528 calibrated input and disconnect
  invalidation; and NAU7802 torque/thrust calibration and disconnect handling.
- ✅ `reversed_digital_sensor_hil.py` 9/9 on the role-reversed rig: MAX6675,
  MAX31855 and MAX31856 temperature/open-circuit decoding plus HX711 positive,
  signed below-zero and missing-data behavior.
- ✅ `afterburner_limp_hil.py` 3/3: afterburner main-fuel coordination reaches
  the physical output, the final Reduced-Power cap includes that offset, and
  STOP cuts both main and afterburner combustion. Dashboard effective-fuel
  telemetry was corrected and reverified at 30% against a 1300 µs pulse.
- ✅ `shutdown_output_ownership_hil.py` 4/4 and
  `finalstop_live_config_hil.py` 5/5: main oil and scavenge ownership, timed
  overrun, cooldown override cancellation, no-N1 FinalStop timing, safe live
  configuration, deferred block application, and normal running lock.
- ✅ `session_logger_hil.py` 2/2: no selected channels creates no file. During
  an enabled run, the session path remains unavailable and the newest 64
  samples stay in bounded RAM while continuous web polling remains responsive.
  On return to STANDBY the complete retained tail is written, closed, and only
  then exposed for download. The final run's worst active-loop time was
  3.154 ms, with no sample at or above 20 ms.

Additional release checks: all nine UI audit programs, 85 safety source
checks, and 16 realistic web-configured engine matrices pass. Both firmware
targets compile from the same source; the final S3 candidate was flashed and
booted with the packed web UI.

The final uninterrupted ten-profile web/HIL run in the normal deployment
orientation, against the regenerated and installed filesystem, passed 10/10
and restored the original engine file
(`ten_build_webui_hil_20260729_214709.json`). Dedicated
pilot-fuel and wet-glow-fuel output-ownership checks also passed after correcting
the shared actuator update path. The final fault-injection campaign passed
10/10 with physical fuel, ignition, and throttle cutoff
(`phase2_safety_hil_20260729_215851.json`). With AsyncTCP pinned to Core 0 and
all LittleFS/NVS writes deferred to STANDBY/FAULT, the final session-logging
timing qualification passed 2/2 with a 3.419 ms worst active loop and no
dropped rows (`session_logger_hil_20260729_220051.json`).

Role-reversed cross-platform qualification used the Classic ESP32 as the
OpenTurbine DUT and the ESP32-S3 as OTBench. The final Classic image passed
11/11 reachable pin-function cases (LEDC PWM, servo, three digital outputs,
PCNT speed, ADC range, digital input, repeating starter assist, and physical
STOP), 9/9 MAX6675/MAX31855/MAX31856/HX711 decode and fault cases, and 2/2
fuel-isolation cases for N1 overspeed and physical STOP
(`classic_pinfunc_hil_20260729_213045.json`,
`reversed_digital_sensor_hil_20260729_212648.json`, and
`classic_safety_hil_20260729_212409.json`). The original hardware profile was
restored after every campaign.

The role-reversed wiring cannot prove a full analog sweep because the S3 has
no DAC, or Classic hardware-SPI electrical operation because the available
thermocouple jumpers land on input-only Classic pins. ADC range endpoints and
all three thermocouple protocols were qualified by the reachable physical
paths; these bench limitations must not be read as real-engine qualification.

---

## v1.5.0 sign-off — verified on BOTH chips (2026-07-07)

Both open follow-ups resolved: OilPrime now self-drives the pump when the oil loop is off
(verified: oil_pct 80, duty 0.81 with the loop disabled), and afterburner ignition falls back
to the fitted igniter (verified: default AB reaches Running). Both new-problem fixes done too:
the tester now drives N1/N2 **independently** (raw ESP-IDF LEDC per-timer), which unblocked a
**direct** N1-max pullback-under-governor test (N1 65k → throttle 1.0 → 0.08); and the "GPIO17
servo quirk" was root-caused as a dead bench jumper (DUT17↔tester19), not firmware.

**Cross-platform (role-reversed rig: OpenTurbine on the classic ESP32, S3 as tester):** every
reachable pin FUNCTION validated on the classic ESP32 — **8/8**: LEDC PWM out, servo out
(1599 µs, full 16-bit), 3× digital out, freq/RPM in (PCNT), ADC in (0↔4095), digital in. Plus
a clean serial boot (LittleFS, sequencer validate, WiFi, web server). The ServoActuator fix is
platform-correct: **16-bit on the classic, 12-bit fallback only on the S3.** OpenTurbine builds
for both `esp32dev` and `esp32s3dev`.

Not provable on this bench (wiring limits, NOT firmware): classic thermocouple SPI (TOT jumpers
land on input-only pins), a full analog sweep (S3 tester has no DAC), MAVLink (no UART jumper),
and a real engine start. Classic-ESP32 rule to document for testers: analog sensors must use
**ADC1** pins so WiFi doesn't disturb them.

Normal bench restored (S3 = OpenTurbine v1.5.0 DUT, classic = OTBench tester); smoke test green.
