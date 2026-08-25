# OpenTurbine (OT) — Architecture & Design Specification

Version: 2.0
License: MIT

---

> **Status:** OpenTurbine 2.0 architecture notes. The current firmware stores complete
> per-engine hardware and settings in `ecu_config.json`, edited through the web
> UI. Keep this file aligned with `README.md`, `hardware_profile.h`, and the
> web UI text.

---

## 1. Project Philosophy

OpenTurbine is a universal turbine engine ECU firmware targeting ESP32-class microcontrollers.
The core principle: **add without breaking**. Every feature is an optional block. The firmware
runs on minimal hardware by gracefully disabling anything not enabled in the runtime hardware config.
Non-engineers can configure and operate it; engineers can extend it without touching unrelated code.

### Hard rules
- The ECU control loop is never blocked by web, logging, or communication activity
- Safety-critical logic (sequencer structure, fault responses) lives in code, not config
- Factory profile identity and fallback pin defaults live in `hardware_profile.h`; normal engine setup is stored in `ecu_config.json` through the web UI
- Every sensor reports health alongside its value — consumers always know if data is trustworthy
- Config changes during STARTUP / RUNNING / SHUTDOWN are locked unless runtime Dev Mode is enabled; hardware and reboot-required changes remain STANDBY-only

---

## 2. Repository Structure

```
OpenTurbine/
├── platformio.ini
├── hardware_profile.h          ← compile-time factory defaults / profile identity
├── partitions.csv              ← 4 MB OTA layout (esp32dev)
├── partitions_8mb.csv          ← universal 8 MB OTA layout (esp32s3dev; safe on 16 MB)
├── README.md
├── CHANGELOG.md
├── LICENSE
│
├── dev/                        ← developer docs (DESIGN_SPEC.md, CODEMAP.md, bench rig)
├── docs/                       ← user/protocol docs (beta guide, OTC cluster protocol)
├── examples/                   ← reference client code (OTCClusterClient.h)
│
├── data/                       ← web UI assets (LittleFS, uploaded via uploadfs)
│   ├── index.html
│   ├── hardware.html
│   ├── calibration.html
│   ├── config.html
│   ├── sequence.html
│   ├── log.html
│   ├── tools.html
│   ├── app.js
│   ├── theme.js
│   └── style.css
│
└── src/
    ├── main.cpp                ← setup()/loop() wiring only
    ├── Hardware.h              ← sensor/actuator instances, applyConfig(), runControllers()
    │
    ├── hal/                    ← hardware drivers — nothing above knows about chips
    │   ├── sensors/
    │   │   ├── ISensor.h             ← interface all sensors implement
    │   │   ├── PCNTRpmSensor.h       ← ESP32 PCNT hall-effect RPM counter
    │   │   ├── AnalogSensor.h        ← ADC: polynomial, linear, threshold variants
    │   │   ├── MAX6675TempSensor.h   ← SPI MAX6675 thermocouple
    │   │   └── MAX31855TempSensor.h  ← SPI MAX31855 thermocouple (bit-banged)
    │   │
    │   ├── actuators/
    │   │   ├── IActuator.h     ← interface all actuators implement
    │   │   ├── ServoActuator.h ← servo PWM 1000–2000 µs (throttle, starter ESC)
    │   │   ├── LEDCActuator.h  ← high-freq LEDC PWM (oil pump, fans)
    │   │   └── RelayActuator.h ← relay / MOSFET (solenoids, igniters)
    │   │
    │   └── RCInput.h           ← optional RC PWM input (idle pot / throttle position)
    │
    ├── engine/                 ← core logic — hardware agnostic
    │   ├── EngineData.h/.cpp   ← central volatile data bus singleton
    │   ├── SafetyMonitor.h     ← watches EngineData, triggers faults
    │   ├── Types.h             ← SysMode enum, RpmHealth bitmask, helpers
    │   │
    │   ├── controllers/
    │   │   ├── IController.h
    │   │   ├── OilPressureLoop.h  ← P-controller with throttle-map and failsafe
    │   │   ├── ThrottleSlew.h     ← rate-limiter + safety pullback
    │   │   └── DynamicIdle.h      ← closed-loop idle RPM hold
    │   │
    │   └── sequencer/
    │       ├── IBlock.h        ← interface every sequence block implements
    │       ├── SequenceEngine.h
    │       └── blocks/
    │           ├── OilPrime.h       ← pre-start oil pressure gate
    │           ├── StarterSpin.h    ← starter spin-up to pre-ignition RPM
    │           ├── PreIgnSpark.h    ← igniter fire while starter spins
    │           ├── FuelOpen.h       ← open fuel solenoid
    │           ├── FlameConfirm.h   ← wait for N consecutive flame detections
    │           ├── Spool.h          ← wait for N1 to reach spool target
    │           ├── SafetyHold.h     ← final pre-running safety check
    │           ├── ImmediateCut.h   ← shutdown: cut fuel/ignition instantly
    │           ├── RPMDrop.h        ← wait for N1 to drop below threshold
    │           ├── CooldownSpin.h   ← spin starter to cool turbine
    │           └── FinalStop.h      ← wait for N1 = 0, oil off → STANDBY
    │
    ├── system/
    │   ├── Config.h/.cpp         ← JSON load/save, profile ID check, locking
    │   ├── FlightRecorder.h/.cpp ← persistent event log to LittleFS
    │   ├── SessionLogger.h/.cpp  ← per-run CSV data stream
    │   ├── ClusterSerial.h/.cpp  ← serial telemetry to external cluster display
    │   ├── CommandQueue.h/.cpp   ← thread-safe Core 0 → Core 1 command pipe
    │   ├── Watchdog.h
    │   └── web/
    │       ├── WebServer.h/.cpp  ← AsyncWebServer, WebSocket, REST endpoints
    │
    └── platform/esp32/         ← MCU-specific shims
        ├── PlatformInit.h      ← Serial, LittleFS, NVS, ADC bring-up
        └── StatusLED.h         ← mode-driven blink indicator
```

---

## 3. hardware_profile.h

`hardware_profile.h` supplies the compile-time default topology used to generate
`ecu_config.json` on first boot and factory reset; after that the saved engine
file is the source of truth and normal setup is done on the web Hardware page.

The saved `ChannelRegistry` is the canonical installed-device inventory. One
allocation-free `I2CDeviceManager` owns the shared Wire bus, performs startup
discovery plus incremental runtime verification, and services TCA9554,
TLA2528, and NAU7802 channels without blocking the control loop. Discovery is
not configuration: only a responding device may receive a new assignment.
Unchanged missing assignments may remain saved for diagnosis/removal, but are
unhealthy at runtime. Loss of an engine-affecting TCA9554 output blocks START
or faults an operating engine because software cannot guarantee the state of a
disconnected output latch.

Development-board hardware JSON also owns one canonical shared SPI bus
(`spi.enabled`, `sck_pin`, `miso_pin`, `mosi_pin`). SPI device channels persist
their unique chip-select and device options; common pins are normalized from
the bus before runtime adapters are built. PCB profiles override both shared
I2C and SPI pins at boot. Adding an I2C/SPI-backed channel while its bus is
disabled is rejected by the UI and hardware validation.

The **shipped default** is a deliberately minimal simple turbojet — throttle and
idle inputs, throttle/fuel-pump ESC, oil pump, one igniter, START/STOP buttons,
and a timed startup (external air/leaf-blower start); no sensors and no automated
safety. The annotated block below is a **fuller example** that shows the available
options (N1, EGT, oil pressure, starter, safety monitors, a sensor-verified
sequence) — it is illustrative, not the default.

```cpp
// ── Profile identity ──────────────────────────────────────────
#define OT_PROFILE_ID     "my_engine_v1"   // must match ecu_config.json profile_id
#define OT_PROFILE_DESC   "My turbine build, rev 1"

// ── Platform ──────────────────────────────────────────────────
#define OT_PLATFORM_ESP32          // ESP32 classic (240 MHz dual-core)

// ── Development mode ──────────────────────────────────────────
// Uncomment to allow live config changes, bypass safety locks.
// NEVER ship firmware with this enabled.
// #define OT_DEV_MODE

// ── Mandatory physical controls ───────────────────────────────
#define OT_STOP_PIN    15    // active-low, internal pull-up — MUST be hardware
#define OT_START_PIN   13    // active-low, internal pull-up

// ── Sensors ───────────────────────────────────────────────────
// Enable only the sensors physically present.
// Comment out anything not wired.

#define OT_HAS_N1_RPM
#define OT_N1_RPM_PIN    14    // hall sensor signal GPIO
#define OT_N1_RPM_PPR    1.0f  // pulses per revolution

#define OT_HAS_TOT
#define OT_TOT_CLK       5
#define OT_TOT_CS        18
#define OT_TOT_MISO      19

#define OT_HAS_OIL_PRESS
#define OT_OIL_PRESS_PIN 34    // ADC1 channel only (GPIOs 32–39)

#define OT_HAS_FLAME
#define OT_FLAME_PIN     35    // ADC1 channel only

// Optional — uncomment if fitted:
// #define OT_HAS_N2_RPM
// #define OT_N2_RPM_PIN   27
// #define OT_N2_RPM_PPR   0.633f

// #define OT_HAS_FUEL_FLOW
// #define OT_FUEL_FLOW_PIN 36

// #define OT_HAS_P1
// #define OT_P1_PIN        36

// #define OT_HAS_IDLE_POT
// #define OT_IDLE_POT_PIN  33
// #define OT_IDLE_POT_RC_PWM  // uncomment to use RC PWM instead of ADC

// ── Actuators ─────────────────────────────────────────────────
#define OT_HAS_THROTTLE
#define OT_THROTTLE_PIN       22

#define OT_HAS_STARTER
#define OT_STARTER_PIN        23

#define OT_HAS_OIL_PUMP
#define OT_OIL_PUMP_PIN       4
#define OT_OIL_PUMP_FREQ_HZ   10000
#define OT_OIL_PUMP_RES_BITS  12

#define OT_HAS_FUEL_SOL
#define OT_FUEL_SOL_PIN       12
#define OT_FUEL_SOL_ACTIVE_H  true

#define OT_HAS_IGNITER
#define OT_IGNITER_PIN        21
#define OT_IGNITER_ACTIVE_H   true

#define OT_HAS_STARTER_EN
#define OT_STARTER_EN_PIN     25
#define OT_STARTER_EN_ACTIVE_H true

// Optional actuators:
// #define OT_HAS_AB_SOL
// #define OT_AB_SOL_PIN       XX
// #define OT_HAS_COOL_FAN
// #define OT_COOL_FAN_PIN     XX

// ── Controllers ───────────────────────────────────────────────
#define OT_HAS_OIL_LOOP           // P-controller: OIL_PRESS → OIL_PUMP
#define OT_HAS_DYNAMIC_IDLE       // Closed-loop idle RPM hold

// ── Safety sources ────────────────────────────────────────────
#define OT_SAFETY_OVERSPEED       // N1 > RPM_LIMIT → immediate shutdown
#define OT_SAFETY_OVERTEMP        // TOT > TOT_LIMIT → shutdown
#define OT_SAFETY_LOW_OIL         // oil < min bar → shutdown
#define OT_SAFETY_FLAMEOUT        // flame lost sustained → shutdown

// ── Startup sequence (order matters, comment to remove a block) ─
#define OT_STARTUP_SEQ \
    OT_BLOCK(OilPrime)       \
    OT_BLOCK(StarterSpin)    \
    OT_BLOCK(PreIgnSpark)    \
    OT_BLOCK(FuelOpen)       \
    OT_BLOCK(FlameConfirm)   \
    OT_BLOCK(Spool)          \
    OT_BLOCK(SafetyHold)

// ── Shutdown sequence ─────────────────────────────────────────
#define OT_SHUTDOWN_SEQ \
    OT_BLOCK(ImmediateCut)   \
    OT_BLOCK(RPMDrop)        \
    OT_BLOCK(CooldownSpin)   \
    OT_BLOCK(FinalStop)

// ── Optional features ─────────────────────────────────────────
// #define OT_HAS_STATUS_LED
// #define OT_STATUS_LED_PIN  2

// #define OT_HAS_CLUSTER_SERIAL
// #define OT_CLUSTER_TX_PIN        17
// #define OT_CLUSTER_BAUD          115200
// #define OT_CLUSTER_INTERVAL_MS   50
```

---

## 4. EngineData — Central Data Bus

Single owner of all live state. Written exclusively by the ECU loop (Core 1).
Read by web server (Core 0) without mutex — scalar reads are safe with volatile.
Commands travel the other direction via CommandQueue only.

```cpp
// engine/EngineData.h
struct EngineData {
    static EngineData& instance();

    // ── Sensor values (written by sensor drivers each loop) ───────────────
    volatile float   n1Rpm          = 0;
    volatile float   n2Rpm          = 0;
    volatile float   tot            = 0;    // °C
    volatile float   oilPressure    = 0;    // bar
    volatile float   fuelPressure   = 0;    // bar
    volatile float   p1             = 0;    // bar
    volatile float   p2             = 0;    // bar
    volatile int     flameSensorRaw = 0;
    volatile int     throttleRaw    = 0;
    volatile int     idlePotRaw     = 0;

    // ── Sensor health ─────────────────────────────────────────────────────
    volatile bool    n1Healthy      = false;
    volatile bool    n2Healthy      = false;
    volatile bool    totHealthy     = false;
    volatile bool    oilHealthy     = false;
    volatile bool    flameDetected  = false;

    // ── Actuator demands (written by controllers/sequencer) ───────────────
    volatile float   throttleDemand = 0;    // 0.0–1.0
    volatile float   oilDemand      = 0;    // bar target
    volatile float   starterDemand  = 0;    // 0.0–1.0

    // ── Engine state ──────────────────────────────────────────────────────
    volatile SysMode mode           = STANDBY;
    volatile bool    flameMonitorActive = false;
    volatile bool    relightArmed   = false;
    volatile bool    devMode        = false;

    // ── Runtime flags (togglable via web UI) ──────────────────────────────
    volatile bool    skipSafetyChecks   = false;  // DEV_MODE only
    volatile bool    dynamicIdleEnabled = true;
    volatile bool    limpMode           = false;

    // ── Stats for web UI / flight recorder ───────────────────────────────
    volatile uint32_t  bootCount       = 0;
    volatile uint32_t  runCount        = 0;       // successful RUNNING entries
    volatile uint32_t  uptimeMs        = 0;
};
```

---

## 5. Sensor Interface

Every sensor implements `ISensor`. The ECU loop calls `update()` on all registered sensors,
then reads `getValue()` and `isHealthy()` into EngineData. Callers never touch sensor
objects directly after registration.

```cpp
// hal/sensors/ISensor.h
class ISensor {
public:
    virtual ~ISensor() = default;
    virtual void  begin()      = 0;
    virtual void  update()     = 0;   // called every loop tick (rate-limits internally)
    virtual float getValue()   = 0;   // last good reading
    virtual bool  isHealthy()  = 0;   // false = reading not trustworthy
    virtual const char* name() = 0;   // e.g. "N1_RPM" — for logging/web UI
};
```

**Implemented sensors at launch:**
| Class | Source | Output |
|---|---|---|
| `PCNTRpmSensor` | PCNT hall sensor | RPM (float) |
| `AnalogPolySensor` | ADC + cubic cal | bar / any unit |
| `AnalogLinearSensor` | ADC + linear cal | bar / any unit |
| `AnalogThresholdSensor` | ADC + threshold cal | bool as 0.0/1.0 |
| `MAX6675TempSensor` | SPI MAX6675 | °C |
| `MAX31855TempSensor` | SPI MAX31855 | °C |

Health reporting per sensor type:
- RPM: uses RpmHealth fault bitmask (SATURATED, JUMP, ZERO_STUCK, ZERO_GLITCH)
- Analog: ADC rail detection (reading pinned to 0 or 4095)
- Thermocouple: chip fault flags (open circuit, short to VCC, short to GND on MAX31855)

---

## 6. Actuator Interface

Every actuator implements `IActuator`. Controllers write normalized demands (0.0–1.0)
to EngineData; the actuator layer maps those to physical signals. Actuators never read
EngineData directly — the ECU loop calls `set()` explicitly.

```cpp
// hal/actuators/IActuator.h
class IActuator {
public:
    virtual ~IActuator() = default;
    virtual void  begin()           = 0;
    virtual void  set(float value)  = 0;  // 0.0 = off/min, 1.0 = on/max
    virtual void  off()             = 0;  // immediate safe-off
    virtual const char* name()      = 0;
};
```

**Implemented actuators at launch:**
| Class | Signal | Use |
|---|---|---|
| `ServoActuator` | PWM 1000–2000µs | throttle ESC, starter ESC |
| `LEDCActuator` | High-freq PWM | oil pump, fans |
| `RelayActuator` | Digital on/off | solenoids, igniters, enables |

---

## 7. Sequence Engine

### Block interface

```cpp
// engine/sequencer/IBlock.h
enum class BlockResult { Running, Complete, Abort, Fault };

class IBlock {
public:
    virtual ~IBlock() = default;
    virtual const char* name()   = 0;
    virtual void onEnter()       {}   // called once on entry
    virtual BlockResult tick()   = 0; // called every loop tick
    virtual void onExit()        {}   // called once on exit (any result)
};
```

### BlockResult routing
- `Complete` → advance to next block in sequence
- `Abort` → immediately go to STANDBY, reset all flags, no shutdown sequence
  (used when engine never actually fired — oil gate timeout, ignition fail)
- `Fault` → call `enterShutdown()` — full cooldown sequence runs
  (used when engine was running or partially started)

### SequenceEngine
Owns the active sequence (startup or shutdown). On each `tick()`:
1. Calls `activeBlock->tick()`
2. Routes result
3. Calls `onExit()` / `onEnter()` at transitions
4. Logs block transitions to FlightRecorder

Sequences are defined in `hardware_profile.h` and compiled into fixed arrays.
The engine iterates them — no dynamic allocation.

### Startup blocks

| Block | Entry condition | Success | Fail route |
|---|---|---|---|
| `OilPrime` | always | oil >= threshold within timeout | Abort |
| `StarterSpin` | oil gate passed | N1 >= pre_ign_rpm | Fault |
| `PreIgnSpark` | starter at speed | timer elapsed | — |
| `FuelOpen` | spark done | immediately | — |
| `FlameConfirm` | fuel open | 3 consecutive detections | Abort |
| `Spool` | flame confirmed | N1 >= rpm_target | Fault |
| `SafetyHold` | spool done | hold elapsed + final check | Fault |

### Shutdown blocks

| Block | Action |
|---|---|
| `ImmediateCut` | throttle=0, igniter off, starter=0, flags cleared |
| `RPMDrop` | wait N1 < threshold (timeout: proceed anyway) |
| `CooldownSpin` | starter on at cooldown%, wait TOT < target or timeout |
| `FinalStop` | starter off, wait N1=0, oil off → STANDBY |

---

## 8. Safety Monitor

Runs every loop tick. Reads EngineData exclusively. Calls `enterShutdown()` on fault.
Each check has a `skipSafetyChecks` bypass (DEV_MODE only).

```
Checks active in STARTUP + RUNNING:
  Overspeed:   N1 > RPM_LIMIT (immediate, no interval gate)

Checks active in STARTUP (after OilPrime block):
  Low oil:     oilPressure < oilMinBar && oilMinBar > 0

Checks active in RUNNING:
  Underspeed:  N1 < MIN_RPM (on trusted RPM only; untrusted → limp mode)
  Overtemp:    TOT > TOT_LIMIT
  Flameout:    flame absent > FLAMEOUT_MS (sustained, not instant)
  Low oil:     oilPressure < RUNNING_MIN_OIL

Safety check interval: configurable (default 100ms), overspeed always immediate.
```

All fault events logged to FlightRecorder with sensor values at time of fault.

---

## 9. Controllers

Controllers run every loop tick in RUNNING state (some also in STARTUP).
They read from EngineData and write demands back to EngineData.
The actuator layer converts demands to physical signals.

### OilPressureLoop
P-controller. Source: `OIL_PRESS` sensor. Output: `oilDemand` → `OIL_PUMP` actuator.
Failsafe: if sensor faults after OIL_FAILSAFE_DELAY_MS, switches to fixed open-loop duty.
All gains and thresholds come from ecu_config.json.

### ThrottleSlew
Rate-limits changes to throttle output. Separate up/down ramp rates from config.
Optional N1, N2, selected EGT, P1, P2, and torque pullbacks share configured
soft/full thresholds, strength, and minimum-fuel floor. Simple mode reacts to
current samples. Predictive mode projects only rising rates from each source's
sample sequence and timestamp. At the full threshold, strength 1.0 reaches the
configured floor; the most restrictive active ceiling wins.

### DynamicIdle (optional)
Reads one selected N1, N2, P1, or P2 source. N1/N2 are the normal supported
approach; pressure control is explicitly experimental. Adjusts the idle floor
with asymmetric rates, bounded integral/learned trim, source-specific deadband,
and a disengagement limit. Feedback loss clears controller and rate state.

---

## 10. Config System

### Profile ID check (boot sequence)
```
1. Load ecu_config.json from LittleFS
2. Read profile_id field
3. Compare to OT_PROFILE_ID from hardware_profile.h
4. MATCH     → proceed normally
5. MISMATCH  → halt, web UI shows error, no engine operations permitted
6. NO FILE   → generate default ecu_config.json from compiled-in defaults, proceed
```

### ecu_config.json structure
```json
{
  "profile_id": "my_engine_v1",
  "config_version": 2,
  "engine": {
    "rpm_limit": 100000,
    "min_rpm": 30000,
    "tot_limit": 750,
    "tot_cooldown_target": 150,
    "tot_safe_margin": 50
  },
  "oil": {
    "startup_pressure": 2.5,
    "startup_min_bar": 1.5,
    "running_min": 2.8,
    "map_min": 3.6,
    "map_max": 4.4,
    "use_throttle_map": false,
    "adjust_scale": 1.80,
    "min_pct": 18,
    "failsafe_delay_ms": 1500,
    "failsafe_pct": 60
  },
  "oil_advanced": {
    "zero_bar": 0.1,
    "deadband_bar": 0.2
  },
  "sequence": {
    "startup": {
      "oil_arm_timeout_ms": 3000,
      "start_rpm_threshold": 1000,
      "pre_ign_rpm": 5000,
      "pre_ign_spark_ms": 1500,
      "flame_timeout_ms": 5000,
      "flame_check_interval_ms": 300,
      "flame_required_count": 3,
      "temp_confirm_target": 200,
      "temp_confirm_timeout": 10000,
      "pre_start_egt_limit_c": 150,
      "startup_egt_limit_c": 0,
      "rpm_target": 32000,
      "rpm_timeout_ms": 12000,
      "safety_hold_ms": 1000,
      "final_check_rpm": 31000
    },
    "shutdown": {
      "rpm_drop_threshold": 5000,
      "rpm_drop_timeout_ms": 15000,
      "cooldown_timeout_ms": 60000,
      "final_stop_timeout_ms": 10000,
      "cooldown_use_starter": true,
      "cooldown_use_oil": true
    }
  },
  "throttle": {
    "ramp_up_ms": 600,
    "ramp_down_ms": 800,
    "fuel_pump_min_pct": 0,
    "idle_max_pct": 18,
    "expo": 0
  },
  "dynamic_idle": {
    "target_rpm": 44000,
    "ramp_up_ms": 10000,
    "ramp_down_ms": 20000,
    "deadband_rpm": 300,
    "rpm_limit": 60000,
    "min_multiplier": 0.75,
    "max_multiplier": 1.50,
    "use_n2": false
  },
  "safety": {
    "check_interval_ms": 100,
    "flameout_shutdown_ms": 3000,
    "egt_source": 0,
    "flameout_source": 0,
    "flameout_n1_min_rpm": 0,
    "flameout_egt_below_c": 300,
    "flameout_egt_fall_rate_c_s": 50,
    "tit_limit_c": 0,
    "oil_temp_limit_c": 120,
    "fuel_press_min_bar": 0,
    "batt_volt_min_v": 0,
    "surge_detect_rpm_variance": 0
  },
  "relight": {
    "enabled": false,
    "confirm_source": 0,
    "min_rpm": 30000,
    "confirm_rpm": 35000,
    "tot_rise_c": 30,
    "relight_timeout_ms": 2000
  },
  "standby_oil": {
    "source": 0,
    "rpm_limit": 100,
    "feed_pct": 25
  },
  "starter_assist": {
    "pct": 15,
    "exit_rpm": 1000,
    "ramp_pct_per_s": 10
  },
  "limp_mode": {
    "max_throttle_pct": 50
  },
  "rpm_health": {
    "jump_threshold": 0.40,
    "zero_stuck_ticks": 5
  },
  "tools": {
    "fuel_prime_ms": 3000,
    "oil_prime_ms": 5000,
    "ign_test_ms": 2000,
    "start_test_ms": 2000,
    "fuel_sol_test_ms": 1000
  },
  "telemetry": {
    "ws_interval_ms": 333,
    "snapshot_interval_ms": 10000
  },
  "cluster": {
    "n1_warn_rpm": 0,
    "n2_warn_rpm": 22000,
    "tot_warn_c": 0,
    "oil_warn_bar": 0,
    "enabled": true
  },
  "display": {
    "pressure_sensors": false
  },
  "rc_input": {
    "min_us": 1000,
    "max_us": 2000,
    "failsafe_ms": 500
  },
  "misc": {
    "cooldown_skip_hold_ms": 1000,
    "igniter_on_start": true
  },
  "session_log": {
    "n1": true, "n2": true, "tot": true, "oil": true,
    "p1": false, "p2": false, "throttle": false, "mode": false
  },
  "calibration": {
    "throttle_min_raw": 0,
    "throttle_max_raw": 4095,
    "flame_threshold": 500,
    "oil_poly": { "a": 0, "b": 0, "c": 0, "d": 0, "x_min": 0, "x_max": 4095 },
    "p1_zero_bar": 0,
    "p2_zero_bar": 0
  }
}
```

### Config locking
- STANDBY: Config fields are editable.
- STARTUP / RUNNING / SHUTDOWN: Config writes are rejected unless runtime Dev Mode is already enabled.
- Dev Mode can only be toggled in STANDBY. When active, Config writes are allowed during active modes for controlled bench tuning.
- Hardware topology, GPIO pins, full engine-file restore, factory reset, OTA, and web-asset update remain STANDBY-only because they require reboot or can disturb outputs.

---

## 11. Flight Recorder

The ECU loop and configuration paths format events into a bounded static RAM
ring. Core 0 drains that ring to the persistent LittleFS log
(`/logs/events.json`) only in STANDBY/FAULT. If an active run fills the RAM
ring, the oldest pending event is overwritten so the newest shutdown/fault
context is retained; the loss counter and a later `EVENTS_DROPPED` marker make
the truncation explicit. The web server reads the closed persistent log for
display/download.

### Event types logged
- `BOOT` — boot count, profile ID
- `START_ATTEMPT` — timestamp, initial sensor values
- `BLOCK_ENTER` / `BLOCK_EXIT` — sequence step transitions with sensor snapshot
- `RUNNING_ENTRY` — N1, TOT, oil at moment of entering RUNNING
- `FAULT` — fault type, sensor values at fault, mode at fault
- `NORMAL_SHUTDOWN` — initiated by stop switch or web UI
- `FAULT_SHUTDOWN` — fault code, values
- `ABORT` — which block aborted, why, sensor values
- `CONFIG_CHANGE` — which field changed, old value, new value, who (web/boot)
- `CALIBRATION` — type, before/after values

### Log record format (compact)
```json
{"t":12345,"bc":3,"ev":"FAULT","code":"LOW_OIL","n1":45000,"oil":1.2,"tot":380}
```

### Capacity
Fixed ring buffer, 2200 records. Oldest 20% evicted when full.
Full log downloadable as JSON from web UI. Individual run summaries shown in log page.

---

## 12. Web Server Architecture

### Threading model
```
Core 1 (Arduino loop, priority 1):
  sensors → EngineData → controllers → sequencer → safety → actuators → watchdog
  CommandQueue::drain() at top of each loop tick
  Session and event evidence is appended to bounded RAM queues

Core 0:
  OpenTurbine web task, priority 8
  AsyncTCP network callbacks, priority 10, explicitly pinned here
  AsyncWebServer handles HTTP requests
  WebSocket responds to browser pull frames; Dashboard and Calibration pull near 3 Hz
  CommandQueue::push() when commands received from UI
  LittleFS/NVS queues are persisted only while the ECU is in STANDBY/FAULT
```

`EngineData` values are `volatile` — Core 0 reads are safe without mutex.
`CommandQueue` is a small FreeRTOS queue — thread-safe, non-blocking on both ends.

### WiFi
Default: Access Point mode. SSID is the active engine profile ID. No password by default unless configured in Hardware.
IP: `192.168.4.1`. Also reachable via mDNS at `http://ot.local` on any mDNS-capable client.
Phone/laptop connects directly, no router needed.

### HTTP endpoints
```
GET   /              → serve index.html from LittleFS
GET   /api/data      → current EngineData snapshot (JSON)
GET   /api/config    → current settings section from ecu_config.json
POST  /api/config    → replace settings section (locked while active unless Dev Mode)
PATCH /api/config    → merge settings patch / calibration field save
POST  /api/theme     → save UI theme only (no engine-config re-apply)
GET   /api/hardware  → current hardware section from ecu_config.json
POST  /api/hardware  → replace hardware section, STANDBY-only, schedules reboot
PATCH /api/hardware  → calibration/topology patch, STANDBY-only
GET   /api/ecu_config → download full engine file
POST  /api/ecu_config → restore full engine file, STANDBY-only, schedules reboot
GET   /api/log       → full flight recorder log (JSON)
GET   /api/log/csv   → log as CSV download
GET    /api/log/raw   → raw flight recorder log file (STANDBY-only, standby logging off)
GET   /api/session/list → list of available per-run session CSVs
GET   /api/session/log → latest or selected completed per-run session CSV
DELETE /api/session/all → delete all per-run session CSVs
POST  /api/command   → queue a command (FuelPrime, IGNtest, etc.)
POST  /api/start     → queue START command
POST  /api/stop      → immediate STOP (direct, not queued)
GET   /api/status    → mode, health summary, lock state
POST  /api/factory_reset → regenerate default config, STANDBY-only, schedules reboot
POST  /api/web_assets → upload replacement web UI assets to LittleFS, STANDBY-only
POST  /update        → OTA firmware upload (binary, writes to inactive OTA slot, reboots)
WS    /ws            → client-pulled live telemetry frames
```

### WebSocket telemetry frame (Dashboard/Calibration pull near 3 Hz)
```json
{
  "mode": "RUNNING",
  "n1": 45230,
  "tot": 412.5,
  "oil": 3.82,
  "flame": true,
  "throttle_demand": 0.34,
  "oil_demand": 3.9,
  "n1_healthy": true,
  "tot_healthy": true,
  "dev_mode": false,
  "config_locked": true
}
```

---

## 13. Web UI — Page Structure

Static files served from LittleFS. Plain HTML/CSS/JS — no frameworks, no build step.
Modern, clean aesthetic. Mobile-friendly. All live data via WebSocket.

### Pages

**Dashboard (`/`)**
- Live values: N1 RPM, TOT, Oil Pressure, Mode — large clean numbers
- Sensor health indicators (green dot = healthy, red = fault)
- Start / Stop buttons (disabled when config locked by wrong profile)
- Current mode indicator with color coding
- Connection status indicator

**Calibration (`/calibration`)**
For each configured analog input:
- Sensor name
- Raw ADC value (live)
- Calibrated value with unit (live)
- Visual bar showing position within calibrated range — clean, minimal
  ```
  Throttle   raw: 2184   64%   [=======   ]  950 ←───→ 3150
  Oil Press  raw: 1876   3.42 bar  healthy ●
  Flame      raw:  312   below threshold ○
  ```
- Guided calibration wizards per sensor type:
  - Throttle: step-by-step min/max capture with live bar
  - Oil: multi-point capture with live pressure entry
  - Flame: automated noise-floor cal (cycles igniter, captures 95th pct)
- All wizards show exactly what to do, no BT command typing

**Config (`/config`)**
- Settings grouped by purpose with Configured system as the default, plus Explore all features and Changed views
- Fields show current value, units, validation warnings, and hardware dependency state
- Config locked during active engine modes unless Dev Mode is active
- Save to device button with change recap
- Full `ecu_config.json` backup/restore is routed through Tools so hardware and settings stay together
- Profile mismatch shown as an engine-operation lockout banner

**Log (`/log`)**
- Per-run summary cards: date (boot#), duration, peak N1, peak TOT, outcome
- Expandable detail per run showing all events with sensor snapshots
- Download full log as JSON
- Download full log as CSV
- Clear log button (with confirmation)

**Tools (`/tools`)**
- All diagnostic commands as proper UI forms:
  - FuelPrime — button with duration field
  - OilPrime — button with duration field
  - IGNtest — button, shows flame sensor reading after
  - StartTest — button, shows N1 achieved
  - FuelSolTest — button
  - IdleTest — button
- All tools disabled unless in STANDBY
- DEV_MODE badge shown if active, with warning text

---

## 14. main.cpp

```cpp
#include "hardware_profile.h"
#include "system/Config.h"
#include "system/FlightRecorder.h"
#include "system/CommandQueue.h"
#include "system/Watchdog.h"
#include "system/web/WebServer.h"
#include "engine/EngineData.h"
#include "engine/SafetyMonitor.h"
#include "engine/sequencer/SequenceEngine.h"
#include "platform/esp32/PlatformInit.h"

// Hardware objects declared by hardware_profile.h macros
OT_DECLARE_HARDWARE;

void setup() {
    PlatformInit::begin();
    Config::load();             // profile ID check happens here
    FlightRecorder::begin();
    Hardware::initSensors();
    Hardware::initActuators();
    Hardware::initControls();
    SafetyMonitor::begin();
    WebServer::begin();         // starts on Core 0 via FreeRTOS
    FlightRecorder::log(EVENT_BOOT);
    Watchdog::begin();
}

void loop() {
    Watchdog::feed();
    CommandQueue::drain();      // process any commands from web UI
    Hardware::updateSensors();  // all sensors → EngineData
    SafetyMonitor::check();     // fault detection
    SequenceEngine::tick();     // startup/shutdown progression
    Hardware::runControllers(); // PID loops, slew, dynamic idle
    Hardware::updateActuators();// demands → physical signals
    FlightRecorder::tick();     // periodic snapshot if running
    EngineData::instance().uptimeMs = millis();
}
```

---

## 15. CommandQueue

One-way pipe: Web (Core 0) → ECU (Core 1). FreeRTOS queue, capacity 16.
ECU drains at top of each loop tick. Commands are non-blocking on both ends.

```cpp
enum class OTCommand {
    START, STOP,
    FUEL_PRIME, OIL_PRIME, IGN_TEST, START_TEST, FUEL_SOL_TEST, IDLE_TEST,
    SET_OIL_DEMAND,     // fParam = bar target
    SET_OIL_PCT,        // int param
    CALIBRATE_OIL,
    CALIBRATE_THROTTLE,
    CALIBRATE_FLAME,
    TOGGLE_LIMP_MODE,
    TOGGLE_DYNAMIC_IDLE,
    TOGGLE_SAFETY_CHECKS,   // DEV_MODE only
};

struct OTCommandPacket {
    OTCommand cmd;
    float     fParam = 0.0f;
    int       iParam = 0;
};
```

---

## 16. Platform Abstraction

All MCU-specific code lives in `platform/`. Everything above `hal/` is platform-agnostic.

```cpp
// platform/esp32/PlatformInit.h
namespace PlatformInit {
    void begin();   // Serial, LittleFS, NVS, watchdog config
}
```

PCNT (pulse counter for RPM) is ESP32-specific and lives in `platform/esp32/PCNT.h`.
`PCNTRpmSensor` uses it. On a different MCU, `TimerRpmSensor` (input capture) would
replace it — same `ISensor` interface, different platform driver underneath.
The rest of the code never knows the difference.

---

## 17. Build Configuration (platformio.ini)

```ini
[env:esp32dev]
platform  = https://github.com/pioarduino/platform-espressif32/releases/download/stable/platform-espressif32.zip
board     = esp32dev
framework = arduino

board_build.filesystem = littlefs

lib_deps =
    adafruit/MAX6675 library
    bblanchon/ArduinoJson
    ESP32Async/ESPAsyncWebServer
    ESP32Async/AsyncTCP
    paulstoffregen/OneWire
    milesburton/DallasTemperature

build_flags =
    -std=gnu++17
    -DCORE_DEBUG_LEVEL=0

monitor_speed = 115200
```

---

## 18. Key Design Constraints (non-negotiable)

1. **ECU loop never blocks.** No `delay()`, no mutex waits, no blocking I/O.
2. **Sensors always report health.** No consumer uses a value without checking health.
3. **Hardware defaults live in `hardware_profile.h`; runtime configuration in `ecu_config.json` owns the fitted hardware.** Chip names are validated in the hardware/config layer so saved configs cannot select unsupported drivers.
4. **No dynamic allocation after boot.** No `new`/`malloc` in the run loop.
5. **Config changes during operation are locked unless runtime Dev Mode is active.**
6. **Profile ID mismatch = no engine operations.** Ever.
7. **STOP switch always wins.** Checked in hardware, not just software.
8. **Flight recorder writes are non-blocking.** Buffered, flushed when idle.
9. **Web server can never directly set actuator state.** Commands only via queue.
10. **Optional hardware is inactive unless configured.** Runtime hardware objects may remain compiled in so one firmware image can serve multiple engine builds.

---

## 19. Proven Control Patterns

The following logic is core OpenTurbine behavior and should be preserved when refactoring:
- RPM health tracking (RpmHealth struct, fault bitmask, trustworthy check)
- Oil pressure P-controller gains and failsafe logic
- Dynamic idle asymmetric ramp controller
- Throttle slew rate limiting
- Flame sensor calibration algorithm (95th percentile + margin)
- ADC rolling average buffer
- Debounced switch logic
- Oil cubic polynomial calibration stored with the engine configuration
- LittleFS persistence patterns

---

## 20. Extending OpenTurbine

OpenTurbine is designed so that new hardware and behaviours can be added in one place
without touching the engine core. The four extension points are:

1. **Custom sequence block** — new startup/shutdown stage
2. **New sensor driver** — new chip or signal type
3. **New actuator driver** — new output type
4. **RUNNING-mode features** — afterburner, air-starter, and similar features
   that activate during operation rather than during sequencing

---

### Adding a custom sequence block

Every startup/shutdown stage is an `IBlock`. To add one:

**Step 1 — Create the block header:**

```cpp
// src/engine/sequencer/blocks/MyBlock.h
#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include <Arduino.h>

class MyBlock : public IBlock {
public:
    // Config parameters — wired from Config in Hardware::applyConfig()
    unsigned long timeoutMs = 5000;
    float         targetRpm = 10000;

    const char* name() override { return "MyBlock"; }

    void onEnter() override {
        _entryMs = millis();
        // Set any EngineData demands needed for this stage
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        // Success condition
        if (ed.n1Rpm >= targetRpm) return BlockResult::Complete;
        // Timeout
        if ((millis() - _entryMs) > timeoutMs) return BlockResult::Fault;
        return BlockResult::Running;
    }

    void onExit() override {
        // Clean up, update EngineData thresholds for the next stage
    }

private:
    unsigned long _entryMs = 0;
};
```

**Step 2 — Declare the instance in Hardware.h:**

```cpp
// In the block instances section of Hardware.h
#include "engine/sequencer/blocks/MyBlock.h"
static MyBlock g_blkMyBlock;
```

**Step 3 — Wire config parameters in `Hardware::applyConfig()`:**

```cpp
g_blkMyBlock.timeoutMs = Config::myBlockTimeoutMs;   // add to Config if needed
g_blkMyBlock.targetRpm = Config::myTargetRpm;
```

**Step 4 — Register in `hardware_profile.h`:**

```cpp
#define OT_STARTUP_SEQ \
    OT_BLOCK(OilPrime)    \
    OT_BLOCK(StarterSpin) \
    OT_BLOCK(MyBlock)     \   // ← inserted at the right position
    OT_BLOCK(PreIgnSpark) \
    ...
```

The `OT_BLOCK()` macro expands to an entry in a fixed compile-time array — no dynamic
allocation. `SequenceEngine` iterates the array and routes `BlockResult` automatically.

---

### Afterburner — worked example

An afterburner activates while the engine is already in `RUNNING` mode, not during
startup sequencing. The correct pattern is a **RUNNING-mode command handler**.

**hardware_profile.h additions:**
```cpp
#define OT_HAS_AB_SOL
#define OT_AB_SOL_PIN       26
#define OT_AB_SOL_ACTIVE_H  true
```

**Hardware.h — declare the actuator:**
```cpp
#ifdef OT_HAS_AB_SOL
#include "hal/actuators/RelayActuator.h"
static RelayActuator g_actAbSol;
#endif
```

**Hardware.h — init in `initActuators()`:**
```cpp
#ifdef OT_HAS_AB_SOL
g_actAbSol.pin      = OT_AB_SOL_PIN;
g_actAbSol.activeH  = OT_AB_SOL_ACTIVE_H;
g_actAbSol.begin();
#endif
```

**Add a command to `CommandQueue.h`:**
```cpp
enum class OTCommand {
    // ... existing commands ...
    AB_FIRE,
    AB_STOP,
};
```

**Handle in `main.cpp` command drain loop:**
```cpp
case OTCommand::AB_FIRE:
    if (ed.mode == SysMode::RUNNING) {
        #ifdef OT_HAS_AB_SOL
        g_actAbSol.set(1.0f);
        ed.afterburnerActive = true;   // add volatile bool to EngineData
        #endif
    }
    break;
case OTCommand::AB_STOP:
    #ifdef OT_HAS_AB_SOL
    g_actAbSol.off();
    ed.afterburnerActive = false;
    #endif
    break;
```

**Safety:** always call `g_actAbSol.off()` in `ImmediateCut::onEnter()` and from the
FAULT handler — the same place starter and fuel solenoid are cut.

**Web UI button:** send `{"cmd":"AB_FIRE"}` or `{"cmd":"AB_STOP"}` to `POST /api/command`,
add a toggle button to `tools.html` (or dashboard) visible only in RUNNING mode.

---

### Air starter

An air-starter replaces the electric starter ESC during `StarterSpin`. The approach
depends on whether the air starter is used instead of or alongside the electric starter.

**Replace electric starter entirely:**
- Remove `OT_HAS_STARTER` / `OT_HAS_STARTER_EN` from hardware_profile.h
- Add `OT_HAS_AIRSTARTER_SOL` (relay/solenoid to open air valve)
- Modify `StarterSpin` — instead of ramping an ESC, open the solenoid on `onEnter()`,
  monitor N1 RPM for target, close solenoid on `onExit()`

**Supplement electric starter with an air boost:**
- Keep both sets of defines
- Add air-valve open/close calls inside `StarterSpin::onEnter()` / `onExit()`
  behind `#ifdef OT_HAS_AIRSTARTER_SOL`

Either way, `StarterSpin` is the only file that changes. No other block or system
component knows or cares how N1 got to `preIgnRpm`.

---

### Adding a new sensor driver

Implement `ISensor` from `hal/sensors/ISensor.h`:

```cpp
// hal/sensors/MyChipSensor.h
#pragma once
#include "ISensor.h"

class MyChipSensor : public ISensor {
public:
    int pin = -1;

    void begin() override {
        // chip init
    }
    void update() override {
        // read chip, set _value and _healthy
        // rate-limit internally if chip is slow
    }
    float getValue()  override { return _value;   }
    bool  isHealthy() override { return _healthy;  }
    const char* name() override { return "MY_CHIP"; }

private:
    float _value   = 0;
    bool  _healthy = false;
};
```

Then in `Hardware.h`:
- Declare an instance (guarded by `#ifdef OT_HAS_MY_CHIP`)
- Call `begin()` in `initSensors()`
- Call `update()` in `updateSensors()` and write `getValue()` / `isHealthy()` into the appropriate `EngineData` fields

The engine core, safety monitor, and web server never see `MyChipSensor` — they only
see the `EngineData` fields it writes.

---

### Adding a new actuator driver

Implement `IActuator` from `hal/actuators/IActuator.h`:

```cpp
// hal/actuators/MyActuator.h
#pragma once
#include "IActuator.h"

class MyActuator : public IActuator {
public:
    int pin = -1;

    void begin() override  { /* init GPIO/peripheral */ }
    void set(float v) override {
        // v is 0.0–1.0; map to your signal range
    }
    void off() override {
        // immediate safe-off — called on fault/shutdown
        set(0.0f);
    }
    const char* name() override { return "MY_ACT"; }
};
```

Then declare, init, and drive it in `Hardware.h` like any other actuator.
Controllers write demands to `EngineData`; `updateActuators()` maps those to `set()`.
The actuator object never reads `EngineData` directly.

---

*End of specification — OpenTurbine v2.0*
