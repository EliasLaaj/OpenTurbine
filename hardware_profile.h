#pragma once
// ============================================================
//  hardware_profile.h — OpenTurbine hardware topology DEFAULTS
//
//  THIS FILE SEEDS THE RUNTIME CONFIGURATION (ecu_config.json):
//   - First boot with no ecu_config.json generates the file from
//     the values defined here.
//   - Keys missing from an existing ecu_config.json (e.g. a feature
//     added after the file was saved) fall back to these defaults.
//   - Once saved, ecu_config.json is the source of truth: values in
//     the file are NEVER overridden by this header. Change hardware
//     at runtime on the web Hardware page instead.
//  Define what hardware is physically present for a new build:
//  pin assignments, sensor types, safety enables, sequence blocks.
//  Comment / uncomment to enable/disable features.
//
//  DEFAULT = minimal simple turbojet, no sensors, external (air/leaf-blower)
//  start. Enabled out of the box: throttle input, idle input, throttle/fuel
//  pump ESC, oil pump, one igniter, throttle rate-limiter, the START/STOP
//  buttons, and the onboard status LED (auto-enabled on the dev-board LED —
//  see the Status LED section below). Startup/shutdown run on TIMERS only.
//  NO sensors and therefore NO automated overspeed/overtemp/oil/flameout
//  protection — those switch on automatically as you fit the matching sensor.
//  Add your real hardware here or on the web Hardware page.
// ============================================================

// ── Profile identity ─────────────────────────────────────────
// Initial profile_id used when creating a new ecu_config.json engine file.
// A mismatch at boot inhibits START until repaired — the web UI, config
// upload, and tools stay available so the mismatch can be fixed in place.
#define OT_PROFILE_ID     "OpenTurbine"
#define OT_PROFILE_DESC   "OpenTurbine minimal turbojet — edit for your build"

// ── Platform ─────────────────────────────────────────────────
// Auto-detected from the IDF build target — no manual setting needed.
// When you select env:esp32dev or env:esp32s3dev in platformio.ini the
// correct platform is picked automatically.  Override here only if your
// toolchain does not set CONFIG_IDF_TARGET_ESP32S3.
#if !defined(OT_PLATFORM_ESP32) && !defined(OT_PLATFORM_ESP32S3)
  #if defined(CONFIG_IDF_TARGET_ESP32S3)
    #define OT_PLATFORM_ESP32S3    // ESP32-S3 (ADC1 on GPIO 1–10, no DAC, USB on 19/20)
  #else
    #define OT_PLATFORM_ESP32      // ESP32 classic (ADC1 on GPIO 32–39)
  #endif
#endif
#if defined(OT_PLATFORM_ESP32) && defined(OT_PLATFORM_ESP32S3)
  #error "OT_PLATFORM_ESP32 and OT_PLATFORM_ESP32S3 cannot both be defined"
#endif

// ── Platform ADC pin slots ────────────────────────────────────
// ADC1 is safe to use while WiFi is active. ADC2 is NOT — never use
// ADC2-only pins for sensors (GPIO 0/2/4/12–15/25–27 on ESP32,
// GPIO 11–20 on S3).
//
// Six named ADC slots are defined here for both chips.  Assign your
// analog sensors to whichever slot matches your PCB wiring.  Digital
// and PWM pins (RPM, servos, pump, solenoids) are unchanged between
// the two chips.
//
// ESP32-S3 IMPORTANT: GPIO 19 and 20 are USB D−/D+ — never use them.
// GPIO1-10 are ADC1-capable on ESP32-S3 and can be used while WiFi is active.
// The default SPI MISO moves to GPIO 37 on S3. GPIO48 is kept free for
// the YD-ESP32-S3 / YD-ESP32-23 onboard NeoPixel/RGB status LED.
//
#ifdef OT_PLATFORM_ESP32S3
  //  ADC1-capable used by this profile: GPIO 2–10.
  #define OT_ADC_1    1     // ADC1 CH0
  #define OT_ADC_2    2     // ADC1 CH1
  #define OT_ADC_3    3     // ADC1 CH2
  #define OT_ADC_4    5     // ADC1 CH4  (skipping 4 — oil pump default)
  #define OT_ADC_5    6     // ADC1 CH5
  #define OT_ADC_6    7     // ADC1 CH6
  #define OT_SPI_MISO_DEFAULT  37   // safe MISO; GPIO 19 = USB D− on S3, GPIO48 = YD onboard RGB LED
  #define OT_SPI_CLK_DEFAULT   36   // GPIO 36 is full I/O on S3 (input-only on ESP32)
#else
  //  ADC1-capable: GPIO 32–39.  GPIO 36/39 are input-only (fine for ADC).
  #define OT_ADC_1   34     // ADC1 CH6
  #define OT_ADC_2   35     // ADC1 CH7
  #define OT_ADC_3   32     // ADC1 CH4
  #define OT_ADC_4   33     // ADC1 CH5
  #define OT_ADC_5   36     // ADC1 CH0 (input-only — ADC use only)
  #define OT_ADC_6   39     // ADC1 CH3 (input-only — ADC use only)
  #define OT_SPI_MISO_DEFAULT  19
  #define OT_SPI_CLK_DEFAULT    5
#endif

// ── Development mode ─────────────────────────────────────────
// Uncomment to allow live config changes during engine operation,
// enable mock sensors/actuators, and bypass safety locks.
// NEVER ship firmware with this enabled.
// #define OT_DEV_MODE

// ── Mandatory physical controls ──────────────────────────────
#define OT_STOP_PIN    15    // active-low, internal pull-up — MUST be hardware
#define OT_START_PIN   13    // active-low, internal pull-up

// ── Sensors ──────────────────────────────────────────────────
// N1 shaft RPM via PCNT pulse counter (hardware, not interrupt).
// Optional for the standard timer/TOT based setup; enable when RPM feedback is fitted.
// #define OT_HAS_N1_RPM
#define OT_N1_RPM_PIN    14    // hall sensor signal
#define OT_N1_RPM_PPR    1.0f  // pulses per revolution

// EGT / TOT via MAX6675 thermocouple SPI.
// OFF in the default minimal profile (no sensors). Uncomment when a
// thermocouple is fitted — this also unlocks overtemp + EGT flameout safety.
// #define OT_HAS_TOT
#define OT_TOT_CLK       OT_SPI_CLK_DEFAULT   // ESP32: 5 / S3: 36
#define OT_TOT_CS        18
#define OT_TOT_MISO      OT_SPI_MISO_DEFAULT  // ESP32: 19 / S3: 37 (19=USB D− on S3)

// Oil pressure via analog (ADC1, polynomial calibrated).
// OFF by default — the minimal engine runs the oil pump open-loop.
// #define OT_HAS_OIL_PRESS
#define OT_OIL_PRESS_PIN OT_ADC_1   // ESP32: 34 / S3: 1

// Flame / ignition confirmation via analog threshold.
// OFF by default — light-up is timed (no combustion sensor).
// #define OT_HAS_FLAME
#define OT_FLAME_PIN     OT_ADC_2   // ESP32: 35 / S3: 2

// Optional — uncomment if fitted:
// N2 shaft RPM (e.g. compressor shaft on twin-spool)
// #define OT_HAS_N2_RPM
// #define OT_N2_RPM_PIN   27
// #define OT_N2_RPM_PPR   0.633f

// Fuel flow sensor (analog linear)
// #define OT_HAS_FUEL_FLOW
// #define OT_FUEL_FLOW_PIN OT_ADC_5   // ESP32: 36 / S3: 6

// Inlet pressure P1
// #define OT_HAS_P1
// #define OT_P1_PIN        OT_ADC_5   // ESP32: 36 / S3: 6

// Exhaust pressure P2
// #define OT_HAS_P2
// #define OT_P2_PIN        OT_ADC_6   // ESP32: 39 / S3: 7

// Throttle input — measures throttle stick/lever position (display + open-loop ref)
// Uncomment OT_HAS_THROTTLE_INPUT to enable. Choose signal type:
//   default = analog ADC voltage; OT_THROTTLE_INPUT_RC_PWM = servo PWM on same GPIO.
#define OT_HAS_THROTTLE_INPUT
#define OT_THROTTLE_INPUT_PIN    OT_ADC_3   // ESP32: 32 / S3: 3
// #define OT_THROTTLE_INPUT_RC_PWM

// Idle input — sets idle RPM target range (potentiometer or RC channel)
#define OT_HAS_IDLE_INPUT
#define OT_IDLE_INPUT_PIN        OT_ADC_4   // ESP32: 33 / S3: 5
// Input signal type — default = analog ADC voltage.
// Uncomment to use servo PWM on the same GPIO instead:
// #define OT_IDLE_INPUT_RC_PWM

// ── Actuators ─────────────────────────────────────────────────
// Throttle ESC (servo PWM)
// Signal range — standard unidirectional ESC: 1000–2000 µs
#define OT_HAS_THROTTLE
#ifdef OT_PLATFORM_ESP32S3
  #define OT_THROTTLE_PIN        16
#else
  #define OT_THROTTLE_PIN        22
#endif
#define OT_THROTTLE_SERVO_MIN_US 1000  // armed / idle position
#define OT_THROTTLE_SERVO_MAX_US 2000  // full throttle

// Starter motor ESC (servo PWM)
// Signal range — choose to match your ESC type:
//   Standard unidirectional ESC : 1000–2000 µs  (armed=1000, full=2000)
//   Bidirectional ESC           : 1500–2000 µs  (neutral=1500, full forward=2000)
// OFF by default — the minimal profile assumes external air/leaf-blower start.
// Uncomment when an electric/air starter ESC is fitted.
// #define OT_HAS_STARTER
#ifdef OT_PLATFORM_ESP32S3
  #define OT_STARTER_MOTOR_PIN   17
#else
  #define OT_STARTER_MOTOR_PIN   23
#endif
#define OT_STARTER_SERVO_MIN_US  1500  // bidirectional — change to 1000 for standard ESC
#define OT_STARTER_SERVO_MAX_US  2000

// Oil pump — any PWM-capable GPIO works; the pin below is just a
// safe default that avoids the ADC1 range on each chip.
#define OT_HAS_OIL_PUMP
#ifdef OT_PLATFORM_ESP32S3
  #define OT_OIL_PUMP_PIN     11   // first GPIO above ADC1 range on S3 (1–10)
#else
  #define OT_OIL_PUMP_PIN      4   // ESP32 classic
#endif

// Choose pump drive mode (uncomment ONE of the two blocks below, or leave both commented
// to use the default PWM mode):
//
//  MODE A — PWM BLDC (default, closed-loop capable via OT_HAS_OIL_LOOP)
//    10 kHz LEDC output, 12-bit duty, proportional pressure control.
#define OT_OIL_PUMP_FREQ_HZ   5000
#define OT_OIL_PUMP_RES_BITS  12
//
//  MODE B — On/Off relay or MOSFET (no P-loop, no OT_HAS_OIL_LOOP)
//    Pump is ON whenever oil is demanded (STARTUP/RUNNING/SHUTDOWN cooldown/windmill),
//    OFF in standby when engine is not spinning.
//    Comment out MODE A lines above and uncomment these two:
// #define OT_OIL_PUMP_ONOFF
// #define OT_OIL_PUMP_ONOFF_ACTIVE_H  true    // true = relay energised = pump ON

// Fuel solenoid (relay/MOSFET) — positive fuel shutoff valve.
// OFF by default: minimal setup meters fuel with the pump alone (throttle
// output). Uncomment if a shutoff solenoid is fitted, and add a FuelOpen
// block to the startup sequence.
// #define OT_HAS_FUEL_SOL
#define OT_FUEL_SOL_PIN       12
#define OT_FUEL_SOL_ACTIVE_H  true

// Igniter — relay / MOSFET (default) or direct coil drive (PWM)
#define OT_HAS_IGNITER
#define OT_IGNITER_PIN        21
#define OT_IGNITER_ACTIVE_H   true   // used in relay mode only

// ── Direct coil drive (uncomment OT_IGNITER_PWM for inductive coil igniter) ──
// Generates dwell/rest cycle: coil charges for DWELL_MS, sparks during REST_MS.
// Frequency = 1000 / (DWELL_MS + REST_MS), duty = DWELL_MS / (DWELL_MS + REST_MS)
// Do NOT define OT_IGNITER_FREQ_HZ — it is computed automatically.
// #define OT_IGNITER_PWM
// #define OT_IGNITER_DWELL_MS  6    // coil charge time per cycle (default 6 ms)
// #define OT_IGNITER_REST_MS   3    // spark / discharge time per cycle (default 3 ms)

// Starter enable relay (powers ESC) — OFF by default (no starter).
// #define OT_HAS_STARTER_EN
#ifdef OT_PLATFORM_ESP32S3
  #define OT_STARTER_EN_PIN   39
#else
  #define OT_STARTER_EN_PIN   25
#endif
#define OT_STARTER_EN_ACTIVE_H true

// Optional actuators:
// Afterburner fuel solenoid
// #define OT_HAS_AB_SOL
// #define OT_AB_SOL_PIN       XX
// #define OT_AB_SOL_ACTIVE_H  true

// Air-starter solenoid
// #define OT_HAS_AIRSTARTER_SOL
// #define OT_AIRSTARTER_SOL_PIN XX

// Cooling fan relay
// #define OT_HAS_COOL_FAN
// #define OT_COOL_FAN_PIN     XX

// ── Controllers ──────────────────────────────────────────────
// All require matching hardware above to be defined.
// #define OT_HAS_OIL_LOOP        // P-controller: OIL_PRESS → OIL_PUMP (needs oil-pressure sensor)
// #define OT_HAS_DYNAMIC_IDLE    // Closed-loop idle RPM hold; requires N1 or N2 RPM feedback

// Use N2 as idle control source instead of N1 (requires OT_HAS_N2_RPM):
// #define OT_DYNAMIC_IDLE_USE_N2

// ── Safety sources ───────────────────────────────────────────
// Each requires the corresponding sensor to be defined above.
// Sensor-based safety shutdowns. ALL OFF in the minimal default because it has
// no sensors — each auto-enables when you fit the matching sensor above. With
// no protection configured the only shutdowns are the STOP button and block
// timeouts, so fit sensors before running anything you care about.
// #define OT_SAFETY_OVERSPEED    // N1 > RPM_LIMIT -> immediate shutdown; requires N1 RPM feedback
// #define OT_SAFETY_OVERTEMP     // TOT > TOT_LIMIT → shutdown; requires a TOT/TIT thermocouple
// #define OT_SAFETY_LOW_OIL      // oil < min bar → shutdown; requires oil-pressure sensor
// #define OT_SAFETY_OIL_ZERO     // oil near-zero during RUNNING → catastrophic loss fault; requires oil-pressure sensor
// #define OT_SAFETY_FLAMEOUT     // combustion source lost sustained → shutdown; requires TOT/N1/flame source

// ── Startup sequence ─────────────────────────────────────────
// Order matters. Comment out to remove a block.
// Stock sensor-free startup: pre-lube first, energize ignition before fuel,
// then hold ignition through a conservative timed light-up interval.
#define OT_STARTUP_SEQ \
    OT_BLOCK(OilPumpOn)      \
    OT_BLOCK(TimedDelay)      \
    OT_BLOCK(IgniterOn)      \
    OT_BLOCK(FuelPumpIdle)   \
    OT_BLOCK(TimedDelay)      \
    OT_BLOCK(IgniterOff)     \
    OT_BLOCK(TimedDelay)

// Default per-block delay (ms), one entry per block above, in order.
// Only TimedDelay blocks consume it; keep 0 for the others.
#define OT_STARTUP_DELAY_MS  {0, 15000, 0, 0, 10000, 0, 5000}

// ── Shutdown sequence ─────────────────────────────────────────
#define OT_SHUTDOWN_SEQ \
    OT_BLOCK(ImmediateCut)   \
    OT_BLOCK(TimedDelay)     \
    OT_BLOCK(OilPumpOff)

#define OT_SHUTDOWN_DELAY_MS {0, 15000, 0}

// ── Optional feature blocks ──────────────────────────────────
// #define OT_HAS_AFTERBURNER

// ── Status LED (mode blink indicator) ────────────────────────
// Blink pattern: STANDBY=1, STARTUP=2, RUNNING=3, SHUTDOWN=4, FAULT=rapid
// ENABLED BY DEFAULT on the onboard dev-board LED even with the macros below
// left commented: the runtime default pin is GPIO 2 (classic ESP32) / GPIO 48
// (ESP32-S3), so a fresh config ships with the status LED on. Uncomment the
// macros only to force a specific pin; disable it on the web Hardware page.
// Built-in LED is usually GPIO 2 on ESP32 dev boards.
// YD-ESP32-S3 / YD-ESP32-23 has an addressable RGB LED on GPIO48.
// In the Hardware page, choose Status LED type = NeoPixel RGB data LED
// for that onboard LED, or Plain GPIO on/off for a normal external LED.
// Some boards require the solder jumper marked RGB to be bridged.
// #define OT_HAS_STATUS_LED
// #define OT_STATUS_LED_PIN  2

// ── External cluster / device serial link ───────────────────
// OpenTurbine Cluster (OTC) binary telemetry on a dedicated UART TX pin.
// Optional RX is configured at runtime in the Hardware page.
// Fitting Cluster Data here enables runtime transmission.
// Configure TX pin to a free GPIO (avoid GPIO1/3 = USB serial).
// Baud: 115200 default. Interval: telemetry packet rate.
// #define OT_HAS_CLUSTER_SERIAL
// #define OT_CLUSTER_TX_PIN        17
// #define OT_CLUSTER_BAUD          115200
// #define OT_CLUSTER_INTERVAL_MS   50     // sensor data packet rate (ms)

// ── Compile-time sanity checks ───────────────────────────────
#ifndef OT_PROFILE_ID
  #error "OT_PROFILE_ID must be defined in hardware_profile.h"
#endif
#ifndef OT_STOP_PIN
  #error "OT_STOP_PIN must be defined in hardware_profile.h"
#endif
#if defined(OT_SAFETY_OVERSPEED) && !defined(OT_HAS_N1_RPM)
  #error "OT_SAFETY_OVERSPEED requires OT_HAS_N1_RPM"
#endif
#if defined(OT_SAFETY_OVERTEMP) && !defined(OT_HAS_TOT)
  #error "OT_SAFETY_OVERTEMP requires OT_HAS_TOT"
#endif
#if defined(OT_SAFETY_LOW_OIL) && !defined(OT_HAS_OIL_PRESS)
  #error "OT_SAFETY_LOW_OIL requires OT_HAS_OIL_PRESS"
#endif
#if defined(OT_SAFETY_FLAMEOUT) && !(defined(OT_HAS_FLAME) || defined(OT_HAS_N1_RPM) || defined(OT_HAS_TOT))
  #error "OT_SAFETY_FLAMEOUT requires OT_HAS_FLAME, OT_HAS_N1_RPM, or OT_HAS_TOT"
#endif
#if defined(OT_HAS_OIL_LOOP) && !(defined(OT_HAS_OIL_PRESS) && defined(OT_HAS_OIL_PUMP))
  #error "OT_HAS_OIL_LOOP requires OT_HAS_OIL_PRESS and OT_HAS_OIL_PUMP"
#endif
#if defined(OT_OIL_PUMP_ONOFF) && !defined(OT_HAS_OIL_PUMP)
  #error "OT_OIL_PUMP_ONOFF requires OT_HAS_OIL_PUMP"
#endif
#if defined(OT_OIL_PUMP_ONOFF) && defined(OT_HAS_OIL_LOOP)
  #error "OT_OIL_PUMP_ONOFF is incompatible with OT_HAS_OIL_LOOP — on/off pump cannot be P-controlled; remove OT_HAS_OIL_LOOP when using ONOFF mode"
#endif
#if defined(OT_HAS_DYNAMIC_IDLE) && !defined(OT_HAS_THROTTLE)
  #error "OT_HAS_DYNAMIC_IDLE requires OT_HAS_THROTTLE"
#endif
#if defined(OT_DYNAMIC_IDLE_USE_N2) && !defined(OT_HAS_N2_RPM)
  #error "OT_DYNAMIC_IDLE_USE_N2 requires OT_HAS_N2_RPM"
#endif
#if defined(OT_IDLE_INPUT_RC_PWM) && !defined(OT_HAS_IDLE_INPUT)
  #error "OT_IDLE_INPUT_RC_PWM requires OT_HAS_IDLE_INPUT"
#endif
#if defined(OT_THROTTLE_INPUT_RC_PWM) && !defined(OT_HAS_THROTTLE_INPUT)
  #error "OT_THROTTLE_INPUT_RC_PWM requires OT_HAS_THROTTLE_INPUT"
#endif

// ── Compile-time GPIO safety guards ─────────────────────────
// These catch common wiring mistakes before they cause silent
// hardware damage or unpredictable behaviour at runtime.
//
// Helper predicates — used inside #if below:
//
//  _OT_FLASH_ESP32(p) — GPIO 6–11: connected to internal flash/PSRAM on ESP32.
//                        Using these destroys flash communication.
//  _OT_FLASH_S3(p)    — GPIO 26–32: internal flash/PSRAM on most S3 modules.
//  _OT_USB_S3(p)      — GPIO 19–20: USB D−/D+ on S3. Cannot be used for anything.
//  _OT_GAP_S3(p)      — GPIO 22–25: not implemented on ESP32-S3.
//  _OT_IN_ONLY(p)     — GPIO 34/35/36/39: input-only on ESP32 (no driver, no pull-up).
//                        Fine for ADC/digital-in; fatal if used as an output.
//  _OT_NO_PULLUP(p)   — same set: no internal pull-up, so unsuitable for active-low
//                        buttons that rely on pull-up (stop/start).
//
#define _OT_FLASH_ESP32(p) ((p) >= 6  && (p) <= 11)
#define _OT_FLASH_S3(p)    ((p) >= 26 && (p) <= 32)
#define _OT_USB_S3(p)      ((p) == 19 || (p) == 20)
#define _OT_GAP_S3(p)      ((p) >= 22 && (p) <= 25)
#define _OT_IN_ONLY(p)     ((p) == 34 || (p) == 35 || (p) == 36 || (p) == 39)
#define _OT_NO_PULLUP(p)   _OT_IN_ONLY(p)

// ── ESP32 classic: internal flash GPIO 6–11 ──────────────────
#ifdef OT_PLATFORM_ESP32
  #if _OT_FLASH_ESP32(OT_STOP_PIN)
    #error "OT_STOP_PIN: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if _OT_FLASH_ESP32(OT_START_PIN)
    #error "OT_START_PIN: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if _OT_FLASH_ESP32(OT_N1_RPM_PIN)
    #error "OT_N1_RPM_PIN: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if _OT_FLASH_ESP32(OT_TOT_CLK) || _OT_FLASH_ESP32(OT_TOT_CS) || _OT_FLASH_ESP32(OT_TOT_MISO)
    #error "OT_TOT_*: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if _OT_FLASH_ESP32(OT_OIL_PRESS_PIN) || _OT_FLASH_ESP32(OT_FLAME_PIN)
    #error "Sensor pin: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if _OT_FLASH_ESP32(OT_THROTTLE_PIN)
    #error "OT_THROTTLE_PIN: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if _OT_FLASH_ESP32(OT_STARTER_MOTOR_PIN)
    #error "OT_STARTER_MOTOR_PIN: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if _OT_FLASH_ESP32(OT_OIL_PUMP_PIN)
    #error "OT_OIL_PUMP_PIN: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if _OT_FLASH_ESP32(OT_FUEL_SOL_PIN)
    #error "OT_FUEL_SOL_PIN: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if _OT_FLASH_ESP32(OT_IGNITER_PIN)
    #error "OT_IGNITER_PIN: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif
  #if defined(OT_HAS_STARTER_EN) && _OT_FLASH_ESP32(OT_STARTER_EN_PIN)
    #error "OT_STARTER_EN_PIN: GPIO 6-11 are internal flash pins on ESP32 — do not use"
  #endif

  // ── ESP32: input-only GPIOs (34/35/36/39) used as outputs ────
  // These pins have no output driver.  Assigning an actuator here produces
  // no signal.  ADC sensors and digital inputs are fine on these pins.
  #if _OT_IN_ONLY(OT_TOT_CLK) || _OT_IN_ONLY(OT_TOT_CS)
    #error "OT_TOT CLK/CS: GPIO 34/35/36/39 are input-only on ESP32 — cannot drive SPI clock or chip-select"
  #endif
  #if _OT_IN_ONLY(OT_THROTTLE_PIN)
    #error "OT_THROTTLE_PIN: GPIO 34/35/36/39 are input-only on ESP32 — cannot drive servo/ESC"
  #endif
  #if _OT_IN_ONLY(OT_STARTER_MOTOR_PIN)
    #error "OT_STARTER_MOTOR_PIN: GPIO 34/35/36/39 are input-only on ESP32 — cannot drive servo/ESC"
  #endif
  #if _OT_IN_ONLY(OT_OIL_PUMP_PIN)
    #error "OT_OIL_PUMP_PIN: GPIO 34/35/36/39 are input-only on ESP32 — cannot drive PWM"
  #endif
  #if _OT_IN_ONLY(OT_FUEL_SOL_PIN)
    #error "OT_FUEL_SOL_PIN: GPIO 34/35/36/39 are input-only on ESP32 — cannot drive solenoid"
  #endif
  #if _OT_IN_ONLY(OT_IGNITER_PIN)
    #error "OT_IGNITER_PIN: GPIO 34/35/36/39 are input-only on ESP32 — cannot drive igniter"
  #endif
  #if defined(OT_HAS_STARTER_EN) && _OT_IN_ONLY(OT_STARTER_EN_PIN)
    #error "OT_STARTER_EN_PIN: GPIO 34/35/36/39 are input-only on ESP32 — cannot drive relay"
  #endif
  // Stop/start buttons need internal pull-up — input-only pins have none
  #if _OT_NO_PULLUP(OT_STOP_PIN)
    #error "OT_STOP_PIN: GPIO 34/35/36/39 have no internal pull-up on ESP32 — use a different GPIO for the stop button"
  #endif
  #if _OT_NO_PULLUP(OT_START_PIN)
    #error "OT_START_PIN: GPIO 34/35/36/39 have no internal pull-up on ESP32 — use a different GPIO for the start button"
  #endif
#endif  // OT_PLATFORM_ESP32

// ── ESP32-S3: USB D−/D+ GPIO 19–20 and flash GPIO 26–32 ──────
#ifdef OT_PLATFORM_ESP32S3
  // USB pins — absolutely forbidden for any use
  #if _OT_USB_S3(OT_STOP_PIN) || _OT_USB_S3(OT_START_PIN)
    #error "Stop/start pin: GPIO 19/20 are USB D-/D+ on ESP32-S3 — never assign these"
  #endif
  #if _OT_USB_S3(OT_N1_RPM_PIN)
    #error "OT_N1_RPM_PIN: GPIO 19/20 are USB D-/D+ on ESP32-S3 — never assign these"
  #endif
  #if _OT_USB_S3(OT_TOT_CLK) || _OT_USB_S3(OT_TOT_CS) || _OT_USB_S3(OT_TOT_MISO)
    #error "OT_TOT SPI pin: GPIO 19/20 are USB D-/D+ on ESP32-S3 — never assign these"
  #endif
  #if _OT_USB_S3(OT_OIL_PRESS_PIN) || _OT_USB_S3(OT_FLAME_PIN)
    #error "Sensor pin: GPIO 19/20 are USB D-/D+ on ESP32-S3 — never assign these"
  #endif
  #if _OT_USB_S3(OT_THROTTLE_PIN) || _OT_USB_S3(OT_STARTER_MOTOR_PIN) || _OT_USB_S3(OT_OIL_PUMP_PIN)
    #error "Actuator pin: GPIO 19/20 are USB D-/D+ on ESP32-S3 — never assign these"
  #endif
  #if _OT_USB_S3(OT_FUEL_SOL_PIN) || _OT_USB_S3(OT_IGNITER_PIN)
    #error "Actuator pin: GPIO 19/20 are USB D-/D+ on ESP32-S3 — never assign these"
  #endif
  #if defined(OT_HAS_STARTER_EN) && _OT_USB_S3(OT_STARTER_EN_PIN)
    #error "OT_STARTER_EN_PIN: GPIO 19/20 are USB D-/D+ on ESP32-S3 — never assign these"
  #endif
  // Internal flash/PSRAM — forbidden on most S3 modules
  #if _OT_FLASH_S3(OT_STOP_PIN) || _OT_FLASH_S3(OT_START_PIN)
    #error "Stop/start pin: GPIO 26-32 are internal flash/PSRAM on most ESP32-S3 modules"
  #endif
  #if _OT_FLASH_S3(OT_N1_RPM_PIN)
    #error "OT_N1_RPM_PIN: GPIO 26-32 are internal flash/PSRAM on most ESP32-S3 modules"
  #endif
  #if _OT_FLASH_S3(OT_TOT_CLK) || _OT_FLASH_S3(OT_TOT_CS) || _OT_FLASH_S3(OT_TOT_MISO)
    #error "OT_TOT SPI pin: GPIO 26-32 are internal flash/PSRAM on most ESP32-S3 modules"
  #endif
  #if _OT_FLASH_S3(OT_OIL_PRESS_PIN) || _OT_FLASH_S3(OT_FLAME_PIN)
    #error "Sensor pin: GPIO 26-32 are internal flash/PSRAM on most ESP32-S3 modules"
  #endif
  #if _OT_FLASH_S3(OT_THROTTLE_PIN) || _OT_FLASH_S3(OT_STARTER_MOTOR_PIN) || _OT_FLASH_S3(OT_OIL_PUMP_PIN)
    #error "Actuator pin: GPIO 26-32 are internal flash/PSRAM on most ESP32-S3 modules"
  #endif
  #if _OT_FLASH_S3(OT_FUEL_SOL_PIN) || _OT_FLASH_S3(OT_IGNITER_PIN)
    #error "Actuator pin: GPIO 26-32 are internal flash/PSRAM on most ESP32-S3 modules"
  #endif
  #if defined(OT_HAS_STARTER_EN) && _OT_FLASH_S3(OT_STARTER_EN_PIN)
    #error "OT_STARTER_EN_PIN: GPIO 26-32 are internal flash/PSRAM on most ESP32-S3 modules"
  #endif
  // GPIO 22-25 are absent on ESP32-S3.
  #if _OT_GAP_S3(OT_STOP_PIN) || _OT_GAP_S3(OT_START_PIN) || _OT_GAP_S3(OT_N1_RPM_PIN)
    #error "Input pin: GPIO 22-25 do not exist on ESP32-S3"
  #endif
  #if _OT_GAP_S3(OT_TOT_CLK) || _OT_GAP_S3(OT_TOT_CS) || _OT_GAP_S3(OT_TOT_MISO)
    #error "OT_TOT SPI pin: GPIO 22-25 do not exist on ESP32-S3"
  #endif
  #if _OT_GAP_S3(OT_OIL_PRESS_PIN) || _OT_GAP_S3(OT_FLAME_PIN)
    #error "Sensor pin: GPIO 22-25 do not exist on ESP32-S3"
  #endif
  #if _OT_GAP_S3(OT_THROTTLE_PIN) || _OT_GAP_S3(OT_STARTER_MOTOR_PIN) || _OT_GAP_S3(OT_OIL_PUMP_PIN)
    #error "Actuator pin: GPIO 22-25 do not exist on ESP32-S3"
  #endif
  #if _OT_GAP_S3(OT_FUEL_SOL_PIN) || _OT_GAP_S3(OT_IGNITER_PIN)
    #error "Actuator pin: GPIO 22-25 do not exist on ESP32-S3"
  #endif
  #if defined(OT_HAS_STARTER_EN) && _OT_GAP_S3(OT_STARTER_EN_PIN)
    #error "OT_STARTER_EN_PIN: GPIO 22-25 do not exist on ESP32-S3"
  #endif
#endif  // OT_PLATFORM_ESP32S3
//
// ── Strapping pin advisory ────────────────────────────────────
// The following GPIOs affect boot mode and should be avoided where
// possible.  They are NOT checked automatically because they can
// work fine in many configurations (e.g. driven after boot).
//   ESP32:    GPIO 0, 2, 5, 12, 15
//   ESP32-S3: GPIO 0, 3, 45, 46
// If you must use them: ensure they are at their default boot state
// (typically floating or pulled to the correct level) at power-on.
