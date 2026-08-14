#pragma once
#include "Types.h"
#include "../system/ChannelRegistry.h"
#include <stdint.h>
#include <stddef.h>

// ── Afterburner state machine mode ────────────────────────────
enum class ABMode : uint8_t {
    Off         = 0,   // AB not active
    Arming      = 1,   // trigger detected, waiting for conditions
    Igniting    = 2,   // ignition sequence running
    Running     = 3,   // AB alight and stable
    ShuttingDown= 4,   // shutdown sequence running
    Fault       = 5,   // ignition failed or safety monitor faulted
};

// ============================================================
//  EngineData — central volatile data bus
//
//  Written exclusively by the ECU loop (Core 1).
//  Read by the web server (Core 0) without a mutex.
//
//  On Xtensa ESP32, 32-bit-aligned S32I/L32I are single-cycle
//  atomic operations, so individual scalar reads are tear-free.
//  However, COMPOSITE state transitions (e.g. setting mode then
//  igniterOn in two separate writes) may be observed by Core 0
//  in a mid-transition state — e.g. mode == SHUTDOWN while
//  igniterOn is still true for one WebSocket tick.
//  This is intentional and accepted: Core 0 is display-only and
//  never makes safety or control decisions.  The only consequence
//  is a briefly inconsistent dashboard reading, not an unsafe action.
//
//  Commands travel the other direction via CommandQueue only.
//  Nothing on Core 0 ever writes to this struct.
// ============================================================

struct EngineData {
    static EngineData& instance();
    void publishSnapshot(uint32_t nowMs, bool force = false);
    static uint32_t readPublishedSnapshot(void* destination, size_t destinationSize);

    // ── Sensor values ─────────────────────────────────────────
    volatile float    n1Rpm           = 0;      // RPM  (gas generator / main shaft)
    volatile float    n2Rpm           = 0;      // RPM  (power turbine / compressor 2)
    volatile float    n1RpmAccel      = 0;      // filtered dN1/dt (RPM/s) — predictive limiter & advanced idle
    volatile float    n2RpmAccel      = 0;      // filtered dN2/dt (RPM/s)
    volatile float    tot             = 0;      // °C   turbine outlet temp
    volatile float    tit             = 0;      // °C   turbine inlet temp (optional)
    volatile float    oilPressure     = 0;      // bar  engine oil
    volatile float    oilTemp         = 0;      // °C   engine oil temperature (optional)
    volatile int      oilTempRaw      = 0;
    volatile float    fuelPressure    = 0;      // bar  fuel rail pressure (optional)
    volatile int      fuelPressRaw   = 0;      // raw ADC counts for calibration
    volatile float    p1              = 0;      // bar  inlet pressure (optional)
    volatile float    p2              = 0;      // bar  exhaust pressure (optional)
    volatile int      p1Raw           = 0;
    volatile int      p2Raw           = 0;
    volatile float    fuelFlow        = 0;      // (optional, unit per cal)
    volatile int      fuelFlowRaw     = 0;
    volatile float    battVoltage     = 0;      // V    battery / bus voltage (optional)
    volatile int      battVoltageRaw  = 0;
    volatile float    torque          = 0;      // Nm   output shaft torque (turboshaft, optional)
    volatile float    thrust          = 0;      // N    measured engine thrust (optional)
    volatile float    turboPower      = 0;      // W    shaft power = torque × n2AngularVel (turboshaft)
    volatile int      oilPressureRaw  = 0;      // raw ADC counts
    volatile int      flameSensorRaw  = 0;      // raw ADC counts
    volatile float    lastRunFlameAvg = 0;      // sparse 1 Hz average from latest run
    volatile uint32_t lastRunFlameSamples = 0;
    volatile int      torqueRaw       = 0;      // raw ADC counts (ADC torque sensor only)
    volatile int      thrustRaw       = 0;      // raw NAU7802 bridge-ADC counts
    volatile int      throttleInputRaw = 0;     // ADC counts (ADC mode) or pulse width us (servo mode)
    volatile int      idleInputRaw     = 0;     // ADC counts (ADC mode) or pulse width us (servo mode)
    volatile bool     throttleInputValid = false;
    volatile bool     idleInputValid     = false;
    volatile uint32_t n1SampleSeq      = 0;
    volatile uint32_t n2SampleSeq      = 0;
    volatile uint32_t totSampleSeq     = 0;
    volatile uint32_t titSampleSeq     = 0;
    volatile uint32_t p1SampleSeq      = 0;
    volatile uint32_t p2SampleSeq      = 0;
    volatile uint32_t torqueSampleSeq  = 0;
    volatile uint32_t thrustSampleSeq  = 0;
    volatile uint32_t n1SampleMs       = 0;
    volatile uint32_t n2SampleMs       = 0;
    volatile uint32_t totSampleMs      = 0;
    volatile uint32_t titSampleMs      = 0;
    volatile uint32_t p1SampleMs       = 0;
    volatile uint32_t p2SampleMs       = 0;
    volatile uint32_t torqueSampleMs   = 0;
    volatile uint32_t thrustSampleMs   = 0;

    // ── Sensor health ─────────────────────────────────────────
    volatile bool     n1Healthy       = false;
    volatile bool     n2Healthy       = true;    // unfitted → not a fault
    volatile bool     totHealthy      = false;
    volatile bool     titHealthy      = true;    // unfitted → not a fault
    volatile bool     oilHealthy      = false;
    volatile bool     oilTempHealthy  = true;    // unfitted → not a fault
    volatile bool     fuelPressHealthy= true;    // unfitted → not a fault
    volatile bool     battHealthy     = true;    // unfitted → not a fault
    volatile bool     torqueHealthy   = true;    // unfitted → not a fault
    volatile bool     thrustHealthy   = true;    // unfitted → not a fault
    volatile bool     p1Healthy       = true;    // unfitted → not a fault
    volatile bool     p2Healthy       = true;    // unfitted → not a fault
    volatile bool     fuelFlowHealthy = true;    // unfitted → not a fault
    // Configured flame-channel availability. Threshold detectors may
    // legitimately use either ADC rail as ON/OFF; presence is separate.
    volatile bool     flameHealthy    = true;   // configured channel is available
    volatile bool     flameDetected   = false;
    volatile uint32_t flameSampleSeq  = 0;
    volatile uint32_t flameSampleMs   = 0;
    volatile float    registryInputValue[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    volatile bool     registryInputHealthy[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    // Canonical sample metadata for registry-backed safety/sequence inputs.
    // `sampleSeq` advances only when a new hardware sample is acquired.
    volatile int32_t  registryInputRaw[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    volatile uint32_t registryInputSampleSeq[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    volatile uint32_t registryInputSampleMs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};

    // ── Actuator demands (written by controllers/sequencer) ───
    volatile float    throttleDemand  = 0;      // 0.0–1.0  main fuel/throttle ESC
    volatile float    finalCoreFuelDemand = 0; // previous tick after rules/protection; excludes AB
    volatile float    mainFuelAppliedDemand = 0; // command last written to the physical main-fuel output
    volatile float    fuelPump2Demand = 0;      // 0.0–1.0  independent variable fuel pump
    volatile float    oilTargetBar     = 0;      // bar target → P-controller
    volatile float    starterDemand   = 0;      // 0.0–1.0
    volatile float    effectiveStarterDemand = 0; // delay/interlock-qualified physical demand
    volatile float    abPumpDemand    = 0;      // 0.0–1.0  afterburner pump
    volatile float    propPitchDemand = 0;      // 0.0–1.0  propeller pitch servo (turboprop)
    // Semantic roles never quantise a command.  Relay drivers do that at their
    // physical boundary; PWM and servo drivers retain the complete demand.
    volatile float    coolFanDemand  = 0;      // 0.0–1.0
    volatile float    oilScavengeDemand = 0;   // 0.0–1.0
    volatile float    bleedValveDemand = 0;    // 0.0–1.0
    volatile float    registryOutputDemand[ChannelRegistry::MAX_OUTPUT_CHANNELS] = {};
    volatile float    registryOutputCurrentAmps[ChannelRegistry::MAX_OUTPUT_CHANNELS] = {};
    volatile bool     registryOutputCurrentHealthy[ChannelRegistry::MAX_OUTPUT_CHANNELS] = {};
    volatile bool     oilFlowWarningActive = false;
    volatile bool     fuelSolOpen     = false;
    volatile bool     igniterOn       = false;
    volatile bool     igniter2On      = false;
    volatile bool     starterEnabled  = false;
    volatile bool     coolFanOn       = false;  // compatibility/telemetry, derived from demand
    volatile bool     airstarterOpen  = false;  // airstarter solenoid open
    volatile bool     oilScavengeOn   = false;  // compatibility/telemetry, derived from demand
    volatile bool     bleedValveOpen  = false;  // compatibility/telemetry, derived from demand

    // ── Safety / diagnostics ───────────────────────────────────
    volatile bool     surgeDetected   = false;  // compressor surge detected (N1 oscillation)
    volatile float    glowPlugDemand  = 0;      // 0.0–1.0 heat level for glow-plug ramp
    volatile float    wetGlowFuelDemand = 0;    // 0.0-1.0 wet-glow fuel output demand
    volatile float    glowCurrentAmps    = 0.0f;   // glow plug current (A), 0 if no sensor
    volatile bool     glowCurrentHealthy = false;
    volatile bool     glowPlugHot        = false;   // true when current dropped below ready threshold
    volatile float    igniterCurrentAmps  = 0.0f;   // igniter 1 coil current (A), 0 if no sensor
    volatile bool     igniterCurrentHealthy = false;
    volatile float    igniter2CurrentAmps = 0.0f;   // secondary igniter coil current (A), 0 if no sensor
    volatile bool     igniter2CurrentHealthy = false;
    volatile float    oilPumpCurrentAmps = 0.0f;   // oil pump current (A), 0 if no sensor
    volatile bool     oilPumpCurrentHealthy = false;
    volatile bool     oilPumpOvercurrent = false;  // true when oil pump current exceeds max threshold

    // ── Afterburner state ─────────────────────────────────────
    volatile ABMode   abMode          = ABMode::Off;
    volatile bool     abTriggerActive = false;  // trigger input (throttle/switch/input) is asserted
    volatile bool     abPermitted = false;
    volatile bool     abExecutionActive = false;
    char              abInhibitReason[80] = {};
    volatile bool     abArmSwitchOn   = false;  // arm switch currently asserted
    volatile bool     abFlameOn       = false;  // AB flame sensor detected
    volatile bool     abFlameHealthy  = false;  // configured channel is available
    volatile float    abFlameValue    = 0.0f;
    volatile int32_t  abFlameRaw      = 0;
    volatile uint32_t abFlameSampleSeq = 0;
    volatile uint32_t abFlameSampleMs = 0;
    volatile uint8_t  abFlameAdapter  = 255;
    volatile bool     abEvidenceValid = false;
    volatile uint32_t abFirstFuelMs = 0;
    volatile uint32_t abFirstIgnitionMs = 0;
    volatile uint32_t abConfirmedMs = 0;
    volatile bool     abFlameOffObserved = false;
    volatile uint32_t abFlameOffSampleSeq = 0;
    volatile bool     abEgtBaselineValid = false;
    volatile float    abEgtBaseline = 0.0f;
    volatile uint32_t abEgtBaselineSampleSeq = 0;
    volatile bool     mainFuelProtectionActive = false;
    volatile float    protectedThrottleDemand = 0.0f;
    char              abFaultReason[96] = {};
    volatile bool     abSolOpen       = false;  // AB fuel solenoid (g_actAbSol)
    volatile int      abInputRaw      = 0;      // raw ADC/RC counts for analog/RC AB trigger
    volatile float    abInputNorm     = 0.0f;   // normalized 0.0-1.0 AB command input
    volatile bool     abInputValid    = false;  // false when a configured servo signal has timed out
    // Additive offset applied at the throttle actuator while AB is Running.
    // Written by checkABTrigger(); read by Hardware::updateActuators().
    // NOT fed into throttleDemand — keeps ThrottleSlew's feedback loop clean.
    volatile float    abFuelOffset    = 0.0f;

    // ── Engine state ──────────────────────────────────────────
    volatile SysMode  mode               = SysMode::STANDBY;
    volatile bool     faultShutdownActive = false; // keeps selected output overrides latched through the fault sequence
    volatile bool     flameMonitorActive = false;
    volatile bool     relightArmed       = false;
    volatile bool     devMode            = false;
    volatile bool     configLocked       = false;
    volatile bool     configStorageFault = false;
    volatile bool     hardwareReady      = true;
    volatile bool     watchdogReady      = false;
    volatile bool     recoveryLockout    = false;
    volatile bool     recoveryStopAcknowledged = false;
    volatile bool     startReleasedSinceBoot = false;
    char              hardwareFault[128] = {};

    // ── Runtime flags (toggleable via web UI) ─────────────────
    volatile bool     skipSafetyChecks   = false;  // DEV_MODE only
    volatile bool     standbyOilFeedActive = false; // windmill protection: oil pump running in STANDBY
    volatile bool     benchMode          = false;  // bench/debug: blocks complete on timer, safety bypassed
    volatile uint32_t limpOverrideSensor = 0;      // one failed feedback sensor explicitly overridden for restart
    volatile uint32_t limpFailureMask    = 0;      // all ordinary feedback failures observed during this run
    volatile bool     manualLimpRequested = false; // operator/input request; cannot clear automatic limp
    volatile bool     automaticLimpLatched = false;// ECU latch; cleared only at the STANDBY boundary
    volatile bool     dynamicIdleEnabled = true;
    volatile bool     limpMode           = false;  // effective manual request || automatic latch
    volatile bool     stopSwitchActive   = false;
    volatile bool     stopSwitchConfigured = false;
    volatile bool     stopSwitchHealthy  = false;
    volatile bool     startSwitchActive  = false;  // hardware start button currently pressed
    volatile bool     startSwitchRawLevel = false; // electrical/logical level before debounce
    volatile bool     startSwitchConfigured = false;
    volatile bool     startSwitchHealthy = false;
    volatile bool     startSwitchActiveHigh = false;
    volatile bool     startSwitchReady   = true;   // healthy release observed; next press may request START
    volatile bool     manualRelightActive = false; // operator holding START while running

    // ── Last mode-change reason (best-effort display, no mutex) ──
    char              lastEvent[64]      = {};     // e.g. "Startup complete"

    // ── Plain-language fault / abort description ───────────────
    // Set by SafetyMonitor / enterAbortStandby before mode change.
    // Includes "what to do" guidance shown in the web UI fault banner.
    char              faultDescription[320] = {};

    // ── Sequence validation (written by Core 1 while in STANDBY) ─
    // validateSequences() walks the active block list and checks hardware
    // requirements. Results are read by Core 0 for telemetry / UI display.
    // Written only while mode == STANDBY so no mutex required.
    struct SeqIssue {
        char blockName[24];
        char reason[192];
        bool isError;   // true = blocks START, false = warning only
    };
    static constexpr int MAX_SEQ_ISSUES = 9;
    SeqIssue         seqIssues[MAX_SEQ_ISSUES] = {};
    uint8_t          seqIssueCount  = 0;
    bool             seqHasErrors   = false;
    bool             seqHasStructuralErrors = false;

    // ── Sequence progress (written by SequenceEngine) ─────────
    char              currentBlock[32]   = {};     // name of active block, "" when idle
    volatile uint8_t  seqBlockIdx        = 0;      // 0-based index of current block
    volatile uint8_t  seqBlockTotal      = 0;      // total blocks in running sequence
    char              seqWaitReason[80]  = {};     // set by active block: "waiting for N1 > 42000 (currently 38500)"
    char              seqLastResult[16]  = {};
    char              seqFaultBlock[32]  = {};
    volatile uint32_t seqStartedMs       = 0;
    volatile uint32_t seqEndedMs         = 0;
    char              abCurrentBlock[32] = {};
    volatile uint8_t  abSeqBlockIdx      = 0;
    volatile uint8_t  abSeqBlockTotal    = 0;
    char              abSeqWaitReason[80] = {};
    char              abSeqLastResult[16] = {};
    char              abSeqFaultBlock[32] = {};
    volatile uint32_t abSeqStartedMs      = 0;
    volatile uint32_t abSeqEndedMs        = 0;
    volatile bool     governorHandoffActive = false;
    char              governorControllerState[64] = "Off";
    char              idleControllerState[40] = "Off";
    char              throttleCommandOwner[32] = "Sequencer / operator";
    char              propPitchCommandOwner[32] = "Sequencer / parked";
    char              oilCommandOwner[32] = "Sequencer / fixed";

    // ── Oil controller state (for web display) ────────────────
    volatile float    oilPumpPct         = 0;   // % duty currently driven
    volatile bool     oilFailsafeActive  = false;

    // ── Safety monitor: armed thresholds ─────────────────────
    // Progressively ratcheted up by sequence blocks during startup:
    // 0 in OilPrime → oilArmMinBar at OilPrime exit → oilStartupMinBar in
    // StarterSpin → oilRunningMin in Spool. 0 = check disabled.
    volatile float    oilMinBar          = 0;

    // ── Startup tracking ──────────────────────────────────────
    // True once FuelOpen fires this run.  CooldownSpin skips if never set
    // (aborted before ignition = no hot EGT to cool).  Cleared at STANDBY.
    volatile bool     fuelAdmitted       = false;
    volatile bool     combustionAttempted = false;
    volatile bool     thermallyLoaded    = false;
    volatile float    startupEgtBaseline = 0.0f;

    // ── Relight tracking ──────────────────────────────────────
    // Counts relight attempts this run.  Reset on entering RUNNING or STANDBY.
    volatile uint8_t  relightAttempts    = 0;

    // ── Extra cooldown (standby only) ─────────────────────────
    // True while extra cooldown is running.  Cleared by checkExtraCooldown()
    // when the operator timeout expires.
    volatile bool          extraCooldownActive   = false;
    volatile unsigned long extraCooldownUntilMs  = 0;   // absolute millis() deadline; 0 when inactive

    // ── General-purpose DI channel states ─────────────────────
    volatile bool diState[4] = {};   // current debounced active state of each DI channel

    // ── Config health (set by Config::load()) ─────────────────
    // True when the loaded ecu_config.json has a different config_version than
    // the firmware expects — new fields will have compile-time defaults.
    // Web UI should display a calibration reminder when this is set.
    volatile bool     configVersionMismatch = false;

    // ── Cluster display hint (optional plugin) ────────────────
    // Written by sequence blocks; read by ClusterSerial plugin.
    // 0 = nothing new to send.  Values match ClCode constants in ClusterSerial.h.
    volatile uint8_t  clusterCode        = 0;

    // ── RC PWM input (written by RCInput::tick(), hardware-profile opt-in) ──
    // Active only when OT_IDLE_INPUT_RC_PWM or OT_THROTTLE_INPUT_RC_PWM is defined.
    volatile bool     rcThrottleValid       = false;   // true = fresh PWM signal
    volatile float    rcThrottleNorm        = 0.0f;    // 0.0–1.0
    volatile bool     rcIdleValid           = false;
    volatile float    rcIdleNorm            = 0.0f;    // 0.0–1.0

    // ── Session peak values (reset at power-up, not persisted) ──
    // Thread-safety note: these are written only by Core 1 (ECU loop) and read
    // by Core 0 (web server) for display.  On Xtensa ESP32, S32I/L32I are
    // single-cycle 32-bit atomic operations, so torn reads of individual floats
    // cannot occur.  No mutex is needed here.
    volatile float    maxN1              = 0;
    volatile float    maxN2              = 0;
    volatile float    maxTot             = 0;
    volatile float    maxP1              = 0;
    volatile float    maxP2              = 0;
    volatile float    maxOilTemp         = 0;
    volatile float    maxBattVoltage     = 0;
    volatile float    maxTit             = 0;
    volatile float    maxFuelPressure    = 0;
    volatile float    minOilPressure     = -1; // minimum healthy RUNNING value; -1 = no sample

    // ── EGT rate of rise (°C/s, calculated by SafetyMonitor) ──
    volatile float    totRiseRate        = 0.0f;   // positive = rising

    // ── Stats ─────────────────────────────────────────────────
    volatile uint32_t bootCount          = 0;
    volatile uint32_t runCount           = 0;   // entries into RUNNING
    volatile uint32_t runStartMs         = 0;   // millis() at RUNNING entry; mode identifies whether active, so 0 remains valid at rollover
    volatile uint32_t uptimeMs           = 0;
    volatile uint32_t loopCounter        = 0;   // main control-loop iterations since boot
    volatile float    loopHz             = 0.0f; // measured loop start-to-start rate
    volatile float    loopPeriodMs       = 0.0f; // measured loop start-to-start period
    volatile float    loopExecAvgMs      = 0.0f; // EWMA loop body execution time
    volatile float    loopExecMaxMs      = 0.0f; // worst loop body time in the last sample window
    // Section breakdown from the same worst loop represented by loopExecMaxMs.
    volatile float    loopSensorsMs      = 0.0f;
    volatile float    loopSequencerMs    = 0.0f;
    volatile float    loopControllersMs  = 0.0f;
    volatile float    loopActuatorsMs    = 0.0f;
    volatile float    loopLoggingMs      = 0.0f;
    volatile float    loopLedMs          = 0.0f;
    volatile uint8_t  resetReason        = 0;   // esp_reset_reason_t cast to uint8

private:
    EngineData() = default;
};
