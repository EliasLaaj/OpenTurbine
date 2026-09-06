#pragma once
#include <ArduinoJson.h>
#include "../engine/EngineData.h"

// ============================================================
//  Config — manages the settings section of ecu_config.json and validates profile ID
//
//  Boot sequence:
//    1. load()
//    2. If no file → generateDefaults() + save() + proceed
//    3. If hardware/settings profile_id values differ → block engine ops
//    4. If OK → populate config values into runtime structs
//
//  During STARTUP/RUNNING/SHUTDOWN: all config write() calls are rejected.
// ============================================================

class Config {
public:
    static constexpr const char* PATH        = "/ecu_config.json";
    static constexpr const char* SECTION     = "settings";

    // ── Engine parameters ─────────────────────────────────────
    static float rpmLimit;
    static float n2RpmLimit;       // hard power-turbine overspeed shutdown; 0 = disabled
    static float minRpm;
    static float totLimit;
    static float totCooldownTarget;
    static float totSafeMargin;

    // ── Oil parameters ────────────────────────────────────────
    static float oilStartupPressure;
    static float oilStartupPct;      // pump duty % for OilPrime when no oil pressure sensor
    static float oilStartupMinBar;
    static float oilRunningMin;
    static float oilMapMin;          // fixed running pressure OR throttle-map idle target
    static float oilMapMax;          // throttle-map full-throttle target
    static bool  oilUseThrottleMap;  // false = fixed at oilMapMin; true = lerp with throttle
    static float oilAdjustScale;
    static float oilMinPct;
    static int   oilFailsafeDelayMs;
    static float oilFailsafePct;

    // ── Sequence parameters ───────────────────────────────────
    static int   startupOilArmTimeoutMs;
    static int   starterTimeoutMs;
    static float preIgnRpm;
    static int   preIgnSparkMs;
    static int   flameTimeoutMs;
    static int   flameCheckIntervalMs;
    static float tempConfirmTarget;      // TempConfirm threshold (°C)
    static int   tempConfirmTimeoutMs;   // TempConfirm timeout
    static float spoolRpmTarget;
    static int   spoolTimeoutMs;
    static int   safetyHoldMs;
    static int   safetyHoldTimeoutMs;
    static float safetyHoldFinalRpm;
    static bool  safetyHoldCheckN1;
    static bool  safetyHoldCheckN2;
    static bool  safetyHoldCheckP1;
    static bool  safetyHoldCheckP2;
    static bool  safetyHoldCheckOil;
    static bool  safetyHoldCheckEgt;
    static bool  safetyHoldCheckFlame;
    static float safetyHoldFinalN2Rpm;
    static float safetyHoldFinalP1;
    static float safetyHoldFinalP2;
    static float safetyHoldFinalEgt;
    static float shutdownRpmDropThreshold;
    static int   shutdownRpmDropTimeoutMs;
    static int   shutdownCooldownTimeoutMs;
    static int   shutdownFinalStopTimeoutMs;
    static float rpmZeroThreshold;       // FinalStop: RPM below this = stopped

    // ── Throttle parameters ───────────────────────────────────
    static float throttleRampUpMs;
    static float throttleRampDownMs;
    static float throttleIdleMaxPct;
    static float throttleExpo;       // 0=linear, 0.3=mild expo, 1.0=max expo (reduces sensitivity near zero)
    static bool  pullbackN1Enabled;
    static bool  pullbackN2Enabled;
    static bool  pullbackEgtEnabled;
    static bool  pullbackP1Enabled;
    static bool  pullbackP2Enabled;
    static bool  pullbackTorqueEnabled;
    static float pullbackN1SoftRpm;
    static float pullbackN1HardRpm;
    static float pullbackN2SoftRpm;
    static float pullbackN2HardRpm;
    static float pullbackEgtSoftC;
    static float pullbackEgtHardC;
    static float pullbackP1Soft;
    static float pullbackP1Hard;
    static float pullbackP2Soft;
    static float pullbackP2Hard;
    static float pullbackTorqueSoft;
    static float pullbackTorqueHard;
    static float p1TripLimit;
    static float p2TripLimit;
    static float torqueTripLimit;
    static int   p1TripConfirmMs, p2TripConfirmMs, torqueTripConfirmMs;
    static float pullbackMinThrottlePct;
    static float pullbackNearLimitRampUpMs;
    static float pullbackApproachZoneRpm;   // 0 = auto (4× soft/hard band)
    static float rpmAccelFilter;            // EMA weight for the dRPM/dt estimate
    // Per-feedback gradual-limiter response. Reactive (0) is the simple
    // default; predictive (1) projects only that source by its own horizon.
    static int   pullbackN1Mode, pullbackN2Mode, pullbackEgtMode;
    static int   pullbackP1Mode, pullbackP2Mode, pullbackTorqueMode;
    static float pullbackN1LookaheadMs, pullbackN2LookaheadMs, pullbackEgtLookaheadMs;
    static float pullbackP1LookaheadMs, pullbackP2LookaheadMs, pullbackTorqueLookaheadMs;
    static float pullbackN1Strength, pullbackN2Strength, pullbackEgtStrength;
    static float pullbackP1Strength, pullbackP2Strength, pullbackTorqueStrength;

    // ── Dynamic idle ──────────────────────────────────────────
    static float idleTargetRpm;
    static float idleRampUpMs;
    static float idleRampDownMs;
    static float idleDeadbandRpm;
    static float idleRpmLimit;
    static float idleMaxMultiplier;      // idle ceiling = throttleIdleMaxPct * this (>=1)
    static bool  idleUseN2;          // false = N1 (default), true = N2
    static int   idleSource;         // 0=N1, 1=N2, 2=P1, 3=P2
    static float idleTargetPressure;
    static float idlePressureDeadband;
    static float idlePressureLimit;
    static float idleIGain;          // integral gain (accumulated error → throttle %)
    static float idleIMax;           // max integral windup (fraction, e.g. 0.15 = ±15% authority)
    // Advanced dynamic-idle mode (Simple/0 = current PI behaviour)
    static int   idleMode;
    static float idleDecelEnterRpm;
    static float idleDecelDropPct;
    static float idleLookaheadMs;
    static float idleSettleBandRpm;
    static float idleFullResponseRpm;
    static float idleTrimUpPctPerSec;
    static float idleTrimDownPctPerSec;
    static float idleLearnRate;
    static float idleLearnAccelMax;
    static float idlePressureDecelEnter;
    static float idlePressureSettleBand;
    static float idlePressureFullResponse;
    static float idlePressureLearnRateMax;

    // ── Safety ────────────────────────────────────────────────
    static int   safetyCheckIntervalMs;
    static float flameoutShutdownMs;
    // Primary EGT source: 0=auto, 1=TOT, 2=TIT.
    static int   egtSource;
    // Flameout source: 0=auto, 1=flame sensor, 2=N1 below threshold, 3=selected EGT drop.
    static int   flameoutSource;
    static float flameoutN1MinRpm;
    static float flameoutEgtBelowC;          // °C; EGT-source flameout low-temperature threshold
    static float flameoutEgtFallRateCPerSec; // °C/s magnitude; rapid cooling can independently declare flameout
    static float titLimit;                   // °C TIT hard limit when TIT is the selected EGT source (0 = disabled)
    static float oilTempLimit;              // °C oil temp limit (0 = disabled)
    static float fuelPressMin;             // bar minimum fuel pressure (0 = disabled)
    static float battVoltMin;              // V minimum battery voltage (0 = disabled)
    static float surgeDetectRpmVariance;   // N1 variance threshold for surge detection (0 = disabled)
    static uint32_t lowOilConfirmMs;
    static uint32_t oilZeroConfirmMs;
    static uint32_t oilTempConfirmMs;
    static uint32_t fuelPressConfirmMs;
    static uint32_t battLowConfirmMs;

    // ── Relight ───────────────────────────────────────────────
    static bool     relightEnabled;      // independent automatic relight subsystem
    static int      relightTriggerSource; // 0=auto, 1=flame, 2=N1, 3=selected EGT
    static int      relightTriggerConfirmMs;
    static float    relightTriggerEgtBelowC;
    static float    relightTriggerEgtFallRateCPerSec;
    static float    relightMinRpm;       // min N1 to attempt relight (falls below → fault)
    static int      relightIgnitionTarget; // 0=Igniter 1, 1=Secondary Igniter, 2=Glow/Wet Glow
    static char     relightOutputId[20]; // stable registry ID; empty uses legacy target migration
    static int      relightConfirmSource; // 0=auto, 1=flame, 2=N1 recovered, 3=selected EGT rise
    static float    relightConfirmRpm;
    static float    relightTotRiseC;
    static int      relightTimeoutMs;    // 0 = hardcoded 30 s maximum; never unlimited

    // ── Tool test durations (standby diagnostics) ─────────────
    static uint32_t toolFuelPrimeMs;
    static uint32_t toolOilPrimeMs;
    static uint32_t toolIgnTestMs;
    static uint32_t toolIgn2TestMs;
    static uint32_t toolGlowTestMs;
    static float    toolGlowTestPct;
    static uint32_t toolStartTestMs;
    static float    toolStartTestPct;
    static uint32_t toolFuelSolTestMs;
    static uint32_t toolIdleTestMs;
    static uint32_t toolOilScavTestMs;
    static uint32_t toolCoolFanTestMs;
    static uint32_t toolAirstarterTestMs;
    static uint32_t toolBleedValveTestMs;
    static uint32_t toolFuelPump2TestMs;
    static float    toolFuelPump2TestPct;
    static uint32_t toolAbSolTestMs;
    static uint32_t toolAbPumpTestMs;
    static float    toolAbPumpTestPct;
    static uint32_t toolStarterEnTestMs;
    static uint32_t toolPropPitchTestMs;
    static float    toolPropPitchTestPct;

    // ── Telemetry intervals ───────────────────────────────────
    static uint32_t wsIntervalMs;        // Browser telemetry request interval (ms; >=333)
    static uint32_t snapshotIntervalMs;  // FlightRecorder RUNNING_SNAP rate (ms)
    static uint32_t controlLoopHz;       // Main ECU loop target frequency (Hz)
    static bool     logStandby;          // include periodic event-log snapshots while idle

    // ── Starter assist ────────────────────────────────────────
    static bool     starterAssistEnabled;
    static float    starterAssistPwmPct;
    static float    starterAssistUntilRpm;
    static uint32_t starterAssistOnMs;
    static uint32_t starterAssistOffMs;

    // ── Starter slew rate & demand ───────────────────────────
    static float starterStartupRampPctPerSec; // starter ramp rate during the startup crank step
    static float starterDemand;          // starter ESC demand % during StarterSpin (0-100)

    // ── Oil zero / disconnect fault ───────────────────────────
    static float oilZeroBar;             // oil pressure below this → OIL_ZERO fault

    // ── Oil controller deadband ───────────────────────────────
    static float oilPressureDeadband;    // bar: suppress output change when |error| < this
    static uint32_t oilPumpUnderflowDelayMs;   // continuous low/no flow before confirmed fault
    static bool shutdownOnOilUnderflow;        // false = warn only; true = fault shutdown

    // ── Standby oil feed (windmill protection) ────────────────
    static bool  standbyOilEnabled;      // explicit opt-in; false leaves standby outputs untouched
    static int   standbyOilSource;       // 0=N1, 1=N2, 2=either shaft
    static float standbyOilRpmLimit;     // selected shaft above this in STANDBY → activate oil feed
    static float standbyOilFeedPct;      // oil pump % to run during standby feed (fixed mode, and the floor in pressure mode)
    static float standbyOilFeedBar;      // >0 with an oil sensor: regulate standby feed to this pressure (bar) instead of a fixed %; 0 = fixed % mode
    static char  standbyOilOutputId[20]; // exact oil-pump device; empty migrates the sole/legacy pump

    // ── Limp mode ─────────────────────────────────────────────
    static float limpMaxThrottlePct;     // throttle cap (%) when limp mode is active

    // ── Misc ──────────────────────────────────────────────────
    static bool  igniterOnStart;         // fire igniter while START held during RUNNING
    static int   manualRelightIgnitionTarget; // 0=Igniter 1, 1=Secondary Igniter, 2=Glow/Wet Glow
    static char  manualRelightOutputId[20]; // stable registry ID; empty uses legacy target migration

    // ── Cooldown hardware selection ───────────────────────────
    static bool  cooldownUseStarter;          // spin starter motor during CooldownSpin block
    static bool  cooldownUseOilPump;          // run oil pump during CooldownSpin block
    static float cooldownStarterPct;          // starter speed % during CooldownSpin (0-100)
    static float cooldownOilPct;              // oil pump % during CooldownSpin (no pressure sensor)
    static float cooldownOilPressureTarget;   // oil pressure target bar (pressure-fed systems)

    // ── Flame confirm ─────────────────────────────────────────
    static int   flameRequiredCount;     // consecutive flame detections needed (FlameConfirm)

    // ── WaitForInput block ────────────────────────────────────
    static int   waitForInputChannel;    // DI channel index (0-3)
    static bool  waitForInputExpected;   // wait until active (true) or inactive (false)
    static int   waitForInputTimeoutMs;  // finite when the block is included

    // ── Cooldown skip ─────────────────────────────────────────
    static int   cooldownSkipHoldMs;     // hold both buttons this long in SHUTDOWN to skip cooldown

    // ── Throttle / fuel ESC idle range ────────────────────────
    static float fuelPumpMinPct;         // measured min % at which the fuel-pump ESC reliably spins; 0 = not calibrated. Non-standby commands below it are forced to zero.

    // ── New sequence block params ─────────────────────────────
    static int   timedDelayMs;           // TimedDelay block duration (ms)
    static float modifiedIdleMultiplier; // ModifiedIdle block throttle multiplier
    static int   fuelPulsePulseMs;       // FuelPulse solenoid open duration
    static int   fuelPulseOffMs;         // FuelPulse wait after close
    static float waitTotCoolTarget;      // WaitTOTCool target temperature (°C)
    static int   waitTotCoolTimeoutMs;   // WaitTOTCool timeout
    static float throttleSetPct;         // ThrottleSet demand %
    static int   preHeatMs;             // PreHeat igniter duration
    static float oilPumpOnPct;          // OilPumpOn actuator block demand %

    // ── FlameConfirm exit actions ─────────────────────────────
    static bool  flameConfirmTurnOffIgniter;  // cut igniter on FlameConfirm exit (default true)

    // ── SafetyHold exit actions ───────────────────────────────
    static bool  safetyHoldTurnOffStarter;    // zero starter demand on SafetyHold exit
    static bool  safetyHoldTurnOffStarterEn;  // clear starter enable relay on SafetyHold exit
    static bool  safetyHoldTurnOffIgniter;    // cut igniter on SafetyHold exit

    // ── Spool exit actions ────────────────────────────────────
    static bool  spoolCutStarterOnExit;       // zero starter demand when spool RPM reached (default true)
    static bool  spoolCutStarterEnOnExit;     // de-assert starter enable relay on spool exit (default true)

    // ── Hot start protection ──────────────────────────────────
    static float preStartEgtLimitC;      // °C; reject START if selected EGT is already above this (0 = disabled)
    static float startupEgtLimitC;       // °C; hard selected-EGT limit in STARTUP (0 = use normal EGT limit)

    // ── Post-stop oil scavenge ────────────────────────────────
    static int   finalStopOilScavengeMs; // extra scavenge-pump runtime after the main oil pump stops (0 = off)
    static bool  oilPrimeUseScavengePump;    // run scavenge pump during OilPrime block
    static bool  cooldownUseScavengePump;    // run scavenge pump during CooldownSpin block

    // ── Afterburner tuning ────────────────────────────────────
    // Trigger / ready-check
    static float abMinN1;              // minimum N1 to attempt AB ignition
    static float abMaxN1;              // maximum N1 above which AB will not fire (compressor too fast)
    static float abMaxTotForLight;     // maximum TOT to attempt lighting (°C); 0=disabled
    static float abThrottleThreshold;  // throttle fraction 0-1 to trigger when source=throttle.
                                       // NOTE: stored as a FRACTION (0.80 = 80%), unlike the other
                                       // percent config fields which are 0-100. The web UI shows it
                                       // x100; raw-API / JSON writers must use 0-1 for THIS key.
    // Ignition
    static bool  abUseTorch;           // spike main fuel through turbine (torch method)
    static bool  abUseIgniter;         // fire AB igniter (igniter2) on ignition
    static float abTorchSpikePct;      // main fuel metering spike % during torch
    static int   abTorchDurationMs;    // torch spike duration
    static float abTorchTotLimit;      // custom torch-only EGT cut (°C)
    static int   abTorchGuardMode;     // 0=auto, 1=custom limit, 2=off
    // Flame confirmation
    static int   abFlameMode;          // 0=verified edge, 1=EGT rise, 2=timed, 3=external level
    static float abTotRiseDegC;        // selected EGT rise required for EGT-rise mode
    static int   abTotRiseWindowMs;    // time window for selected EGT rise
    static int   abAssumeIgnitedMs;    // timed mode: wait this long then assume lit
    static int   abFlameTimeoutMs;     // overall timeout to confirm flame before fault
    static int   abFlameLossDelayMs;   // running AB flame-loss dwell before AB-only shutdown
    // Running
    static float abLightupPumpPct;      // AB pump demand used by ABPumpOn during light-up
    static float abPumpMinPct;         // AB pump minimum % when running
    static float abPumpMaxPct;         // AB pump maximum % when running
    static int   abPumpControlMode;    // 0=fixed max, 1=main throttle, 2=dedicated AB input
    static float abMainFuelOffsetPct;  // add this to main throttle demand while AB running
    static int   abStabilizeMs;        // hold time in ABStabilize block
    static float abStabilizeMaxTot;    // TOT limit during stabilize; abort if exceeded

    // ── RPM sensor health thresholds ─────────────────────────
    static float rpmJumpThreshold;       // fraction: relative RPM step > this → JUMP fault
    static int   rpmZeroStuckTicks;      // consecutive zero ticks before ZERO_STUCK fault

    // ── Cluster display limits ────────────────────────────────
    static float n1WarnRpm;              // N1 warning RPM for cluster gauge yellow zone
    static float n2WarnRpm;              // N2 warning threshold for ClusterSerial
    static float totWarnC;               // selected-EGT warning threshold for cluster (°C); 0 = use primary limit - safe margin
    static float oilWarnBar;             // Oil pressure warning threshold for cluster (bar); 0 = use oilRunningMin

    static int   effectiveEgtSource();           // 0=none, 1=TOT, 2=TIT
    static bool  primaryEgtHealthy(const EngineData& ed);
    static float primaryEgtC(const EngineData& ed);
    static float primaryEgtLimitC();
    static const char* primaryEgtLabel();
    static float effectiveRelightMinRpm();       // never below configured minimum running N1
    static float applyFuelPumpMinimum(float demand01);
    static float effectiveMainFuelDemand(const EngineData& ed);

    // ── RC PWM input calibration ──────────────────────────────
    // GPIO pin and ADC/servo input type are selected in Hardware.
    // Throttle/idle servo endpoints are calibrated independently on Calibration.
    static int   rcFailsafeMs;     // mark invalid if no pulse within this ms

    // ── Power turbine governor (turboshaft / APU) ─────────────
    static float governorTargetRpm;      // N2 target RPM (speed-hold)
    static float governorBandRpm;        // deadband ± RPM around target
    static float governorKp;             // proportional gain (throttle %/RPM error)
    static float governorPitchKp;        // pitch demand fraction per RPM error (turboprop mode)
    static float governorPitchRampSec;   // max pitch rate: full stroke in this many seconds (0=unlimited)
    static int   govHoldTimeoutMs;       // GovernorHold block max wait (ms)
    // FuelPumpRamp / FuelPump2Set block params
    static float fp2StartPct;            // FuelPumpRamp start % (0–100)
    static float fp2EndPct;              // FuelPumpRamp end % (0–100)
    static int   fp2RampMs;              // FuelPumpRamp ramp duration (ms)
    static float fp2DemandPct;           // FuelPump2Set fixed demand % (0–100)

    // ── Glow plug preheating ──────────────────────────────────
    static int   glowPreheatMs;          // total preheat duration (ms)
    static float glowPreheatMaxPct;      // peak duty cycle during preheat (%)
    static float glowHoldPct;            // hold duty once preheated (%)
    static bool  glowWaitUntilHot;       // hold at holdPct until current sensor confirms hot

    // ── Hour meter / run statistics ───────────────────────────
    // volatile: Core 1 (ECU) increments these via the guarded add/inc helpers
    // below while Core 0 (web) may merge them during a config restore. Single
    // 32-bit reads (telemetry/serialize) are atomic; only the RMW is guarded.
    static volatile uint32_t totalRunSeconds;   // accumulated engine-on time (persisted)
    static volatile uint32_t startAttemptCount; // commanded start attempts (persisted)
    static volatile uint32_t runCount;          // successful entries into RUNNING (persisted, lifetime)

    // ── Session data logger ───────────────────────────────────
    static constexpr uint32_t SLOG_N1         = 1u << 0;
    static constexpr uint32_t SLOG_N2         = 1u << 1;
    static constexpr uint32_t SLOG_TOT        = 1u << 2;
    static constexpr uint32_t SLOG_OIL        = 1u << 3;
    static constexpr uint32_t SLOG_P1         = 1u << 4;
    static constexpr uint32_t SLOG_P2         = 1u << 5;
    static constexpr uint32_t SLOG_THR        = 1u << 6;
    static constexpr uint32_t SLOG_MODE       = 1u << 7;
    static constexpr uint32_t SLOG_TIT        = 1u << 8;
    static constexpr uint32_t SLOG_BATT       = 1u << 9;
    static constexpr uint32_t SLOG_FUEL_PRESS = 1u << 10;
    static constexpr uint32_t SLOG_FUEL_FLOW  = 1u << 11;
    static constexpr uint32_t SLOG_GLOW       = 1u << 12;
    static constexpr uint32_t SLOG_FP2        = 1u << 13;
    static constexpr uint32_t SLOG_AB         = 1u << 14;
    static constexpr uint32_t SLOG_PROP       = 1u << 15;
    static constexpr uint32_t SLOG_OIL_PCT   = 1u << 16;  // oil pump duty %
    static constexpr uint32_t SLOG_LOOP       = 1u << 17;  // ECU loop speed/timing diagnostics
    static constexpr uint32_t SLOG_GLOW_CURRENT = 1u << 18;
    static constexpr uint32_t SLOG_IGN_CURRENT  = 1u << 19;
    static constexpr uint32_t SLOG_IGN2_CURRENT = 1u << 20;
    static constexpr uint32_t SLOG_OIL_CURRENT  = 1u << 21;
    static constexpr uint32_t SLOG_WET_GLOW     = 1u << 22; // wet-glow fuel output %
    static constexpr uint32_t SLOG_OIL_TEMP     = 1u << 23; // oil/gearbox/coolant temp C
    static constexpr uint32_t SLOG_TORQUE       = 1u << 24; // torque Nm + calculated shaft power W
    static constexpr uint32_t SLOG_STARTER      = 1u << 25; // starter demand %
    static constexpr uint32_t SLOG_THRUST       = 1u << 26; // calibrated thrust N
    static constexpr uint32_t SLOG_DEFAULT = SLOG_N1 | SLOG_TOT | SLOG_OIL;
    static constexpr uint8_t MAX_SESSION_REGISTRY_INPUTS = 24;
    static uint32_t sessionLogMask;
    static uint32_t sessionLogIntervalMs;  // session CSV row interval (default 1000 = 1 Hz)
    // Stable ChannelRegistry IDs selected as additional session CSV columns.
    // IDs, rather than array positions, survive hardware-card reordering.
    static uint8_t sessionRegistryInputCount;
    static char sessionRegistryInputIds[MAX_SESSION_REGISTRY_INPUTS][20];

    // ── Calibration ───────────────────────────────────────────
    static int   throttleMinRaw;
    static int   throttleMaxRaw;
    static int   idleMinRaw;
    static int   idleMaxRaw;
    static float oilPolyA, oilPolyB, oilPolyC, oilPolyD;
    static float oilPolyXMin, oilPolyXMax;
    // P1 / P2 two-point linear calibration (rawMin/Max = ADC counts, valMax = bar at rawMax)
    static int   p1RawMin;             // ADC at 0 bar (atmosphere / zero-pressure)
    static int   p1RawMax;             // ADC at reference pressure
    static float p1ValMax;             // Reference pressure in bar
    static int   p2RawMin;
    static int   p2RawMax;
    static float p2ValMax;
    static int   fuelPressRawMin;      // ADC raw count at 0 bar (open-line / zero-pressure capture)
    static int   fuelPressRawMax;      // ADC raw count at known reference pressure
    static float fuelPressValMax;      // Reference pressure in bar (at fuelPressRawMax)
    // Fuel flow (analog type only — pulse type uses HardwareConfig::fuelFlowPulsesPerLitre)
    static int   fuelFlowRawMin;       // ADC at 0 flow
    static int   fuelFlowRawMax;       // ADC at reference flow
    static float fuelFlowValMax;       // Flow rate in units/min at fuelFlowRawMax

    // ── Automation rules ("if this, then that") ──────────────
    // Small, deterministic custom controls evaluated every control tick. A
    // definition is a threshold switch, linear map, or feedback controller.
    // Outside its selected engine states the target is released to its normal
    // sequence/direct owner.
    struct Rule {
        bool    enabled;
        uint8_t kind;       // 0=threshold on/off, 1=linear map, 2=feedback, 3=fixed output
        uint8_t sensor;     // 0=oil_temp 1=tot 2=n1_rpm 3=oil_press 4=tit 5=batt_v 6=n2_rpm
        uint8_t op;         // threshold rules: 0=above, 1=below
        float   threshold;  // SI units: °C, bar, RPM, V
        uint8_t actuator;   // 0=cool_fan 1=bleed_valve 2=fuel_pump2
        float   onValue;    // threshold rule active demand, canonical 0–1
        float   offValue;   // false/inactive/unhealthy demand, canonical 0–1
        float   hysteresis; // analog deadband in sensor units; 0 = exact threshold
        float   inputMin;   // map source range in source units
        float   inputMax;
        float   outputMin;  // map target range, canonical 0–1
        float   outputMax;
        uint8_t targetSourceType; // feedback: 0=fixed, 1=two-state, 2=variable map
        uint8_t targetSensor;     // compact handle resolved from targetSourceId
        float   targetFixed;      // feedback engineering-unit target
        float   targetLow;        // switch OFF / variable low target
        float   targetHigh;       // switch ON / variable high target
        float   targetInputMin;   // variable target-source range
        float   targetInputMax;
        float   responseGain;     // output fraction per feedback engineering unit
        float   integralGain;     // output fraction per unit-second
        float   deadband;         // feedback engineering units
        uint8_t modeMask;   // STANDBY=1, STARTUP=2, RUNNING=4, SHUTDOWN=8
        char    name[24];   // display name (UI only)
        // Persisted references. The numeric fields above are compact handles
        // resolved once while loading; control ticks never compare IDs.
        char    sourceId[24] = {};
        char    targetId[24] = {};
        char    targetSourceId[24] = {};
    };
    static constexpr int MAX_RULES = 16;
    static Rule rules[MAX_RULES];
    static int  ruleCount;
    // 0 = legacy implicit/dedicated owners; 1 = output-first editable control
    // definitions. The UI performs the one-time, reviewable migration.
    static uint8_t controllerSchema;

    // ── Profile ID (read-only after load) ─────────────────────
    static char    profileId[64];
    static char    uiTheme[16];   // web UI theme key (cosmetic); travels in ecu_config.json
    static bool    profileMatch;

    // ── Boot-load warning (accept + warn, never block) ────────
    // Set by _fromDoc when a loaded config carries safety-relevant values
    // beyond the recommended caps. Empty string = no warning. Exposed in
    // full telemetry frames as "config_load_warning" for the dashboard.
    static char    loadWarning[192];

    // ── Config version ────────────────────────────────────────
    static constexpr uint8_t CONFIG_VERSION = 9;

    // ── API ───────────────────────────────────────────────────
    static void load();
    // Seed the complete compiled settings profile before HardwareConfig writes
    // a first-boot unified file. Static initializers alone cannot represent
    // structured defaults such as controller rules reliably.
    static void resetToCompiledDefaults();
    static bool save(bool writeRuntimeHardware = false); // atomic unified save; full restore passes true
    static void sanitizeForHardware(); // clear settings that reference unequipped hardware
    // Auto-fill a sane default threshold for any threshold-based
    // safeties just ENABLED (off->on) while its threshold is 0, so a ticked
    // safety cannot stay silently off. Pass the pre-change enable flags.
    static void autoFillNewlyEnabledSafety(bool prevOilTemp,
                                           bool prevFuelPress, bool prevBatt,
                                           bool prevSurge, bool prevHotStart);
    static void requestSave();   // Core 1: mark save needed, zero file I/O
    static bool flushPendingSave(); // Core 0 in STANDBY/FAULT: perform deferred save
    static void requestRuntimeStatsSave(); // Core 1: persist hour meter through NVS
    static bool flushPendingRuntimeStats(); // Core 0 in STANDBY/FAULT: deferred NVS write
    static bool runtimeStatsPending() { return _runtimeStatsSavePending; }
    static bool runtimeStatsHealthy() { return _runtimeStatsError == 0; }
    static uint8_t runtimeStatsError() { return _runtimeStatsError; }
    static void loadRuntimeStats(); // merge per-engine NVS hour meter after profile load
    static bool clearRuntimeStats(); // verified factory-reset of current engine's hour meter
    // Guarded RMW helpers for the persisted counters (called from the Core 1
    // ECU path); protected against a concurrent Core 0 restore-merge.
    static void addRunSeconds(uint32_t seconds);
    static void incStartAttemptCount();
    static void incRunCount();
    // True while the engine is active. Developer Mode's narrow RUNNING-only
    // live-tuning exception is enforced by the PATCH endpoint, not here.
    static bool isLocked();
    static bool acquireStorageWrite(); // serialize all ecu_config.json replacement operations
    static void releaseStorageWrite();

    // Serialize current config to JSON string (for web download)
    static size_t toJson(char* buf, size_t len);
    // Serialize into an existing document (for PATCH merge)
    static void   toJson(JsonDocument& doc);

    // Parse and apply JSON from web upload
    static bool validateJson(const char* json, size_t len);
    static bool validateJson(const JsonDocument& doc);
    // Full-engine restore validates settings before its uploaded hardware is
    // resident. This checks schema/ranges only; dependency cleanup is run
    // after that uploaded hardware has been applied.
    static bool validateJsonValues(const JsonDocument& doc);
    // Validate the already-applied settings against the already-applied
    // hardware without allocating another JSON document. Used by complete
    // engine-file restore on memory-constrained Classic ESP32.
    static bool validateRuntimeHardwareDependencies();
    // Re-resolve stable controller source/target IDs after a complete engine
    // restore has installed its uploaded hardware registry.
    static bool resolveRuleHandlesForHardware();
    static bool fromJson(const char* json, size_t len);
    static bool fromJson(const JsonDocument& doc);  // PATCH merge variant
    // Applies a validated settings document, releases its heap before the
    // unified-file write, and reloads the on-disk values if the write fails.
    // Persists a validated candidate without touching live Config statics.
    // On success, ownership of outJson transfers to ConfigApplyGate/the ECU core.
    static bool persistJsonCandidateReleasing(JsonDocument& doc, char*& outJson,
                                              size_t& outLen, char* scratch = nullptr,
                                              size_t scratchLen = 0);
    // Caller holds the storage-write lock. Preserve Settings without a JSON tree.
    static bool copyStoredSettings(Print& destination);
    static bool applyJsonRuntimeOnly(const JsonDocument& doc, bool allowActiveLive = false,
                                     bool validateHardwareDependencies = true); // no flash write
    // Apply only the narrow Developer-Mode controller tuning surface. The web
    // gate validates this patch against the complete configuration first.
    static bool applyJsonLivePatch(const JsonDocument& patch);
    // Classic ESP32 can become too fragmented to hold the serialized transfer
    // buffer and a second complete JSON tree at once. Settings persistence also
    // stages the exact validated candidate so Core 1 can retry from a stream
    // after releasing that buffer. Other targets implement these as no-ops.
    static DeserializationError loadStagedJsonCandidate(JsonDocument& doc);
    static void clearStagedJsonCandidate();
    // Full-engine restore has already range-validated the exact settings
    // object staged at /config_apply.tmp. Stream that object into the atomic
    // unified writer so Classic never has to rebuild a large JSON tree.
    static bool saveStagedJsonCandidate(size_t settingsLen,
                                        bool writeRuntimeHardware = false);

private:
    static void _applyDefaults();
    static void _fromDoc(const JsonDocument& doc, bool resolveRuleHandles = true);
    static void _toDoc(JsonDocument& doc);
    static void _writeDoc(JsonObject doc);
    static bool _saveSettingsJson(const char* settingsJson, size_t settingsLen,
                                  bool writeRuntimeHardware = false);
    static volatile bool _savePending;
    static volatile bool _runtimeStatsSavePending;
    static volatile uint8_t _runtimeStatsError; // 0=ok, 1=NVS open, 2=write
    static bool _missingRequiredSections;
};
