#include "Config.h"
#include "HardwareConfig.h"
#include "hardware_profile.h"
#include <LittleFS.h>
#include <Preferences.h>
#include <Arduino.h>
#include <ctype.h>
#include <math.h>
#include "RulesEngine.h"     // after Arduino.h — needs constrain()
#include "FlightRecorder.h"
#include "ConfigInternal.h"

namespace ConfigInternal {
int8_t ruleSourceHandle(const char* id) {
    if (!id || !id[0]) return -1;
    if (!strcmp(id, "oil_temp") || !strcmp(id, "oil_temp_main")) return RulesEngine::OIL_TEMP;
    if (!strcmp(id, "tot") || !strcmp(id, "tot_main")) return RulesEngine::TOT;
    if (!strcmp(id, "n1_main") || !strcmp(id, "n1_rpm")) return RulesEngine::N1_RPM;
    if (!strcmp(id, "n2_main") || !strcmp(id, "n2_rpm")) return RulesEngine::N2_RPM;
    if (!strcmp(id, "oil_pressure_main") || !strcmp(id, "oil_press")) return RulesEngine::OIL_PRESS;
    if (!strcmp(id, "primary_n1")) return RulesEngine::N1_RPM;
    if (!strcmp(id, "primary_n2")) return RulesEngine::N2_RPM;
    if (!strcmp(id, "primary_egt")) return RulesEngine::TOT;
    if (!strcmp(id, "operator_throttle") || !strcmp(id, "throttle_input") || !strcmp(id, "throttle_in") || !strcmp(id, "throttle_input_main")) return RulesEngine::THROTTLE_INPUT;
    if (!strcmp(id, "tit") || !strcmp(id, "tit_main")) return RulesEngine::TIT;
    if (!strcmp(id, "batt_voltage") || !strcmp(id, "batt_voltage_main") || !strcmp(id, "battery_voltage")) return RulesEngine::BATT_V;
    if (!strcmp(id, "fuel_press") || !strcmp(id, "fuel_pressure_main")) return RulesEngine::FUEL_PRESS;
    if (!strcmp(id, "fuel_flow") || !strcmp(id, "fuel_flow_main")) return RulesEngine::FUEL_FLOW;
    if (!strcmp(id, "p1") || !strcmp(id, "p1_main")) return RulesEngine::P1;
    if (!strcmp(id, "p2") || !strcmp(id, "p2_main")) return RulesEngine::P2;
    if (!strcmp(id, "torque") || !strcmp(id, "torque_main")) return RulesEngine::TORQUE;
    if (!strcmp(id, "thrust") || !strcmp(id, "thrust_main")) return RulesEngine::THRUST;
    if (!strcmp(id, "flame") || !strcmp(id, "flame_main")) return RulesEngine::FLAME;
    if (!strcmp(id, "idle_input") || !strcmp(id, "idle_in") || !strcmp(id, "idle_input_main") || !strcmp(id, "operator_idle")) return RulesEngine::IDLE_INPUT;
    if (!strcmp(id, "ab_flame") || !strcmp(id, "ab_flame_main")) return RulesEngine::AB_FLAME;
    if (!strcmp(id, "glow_current") || !strcmp(id, "glow_current_main")) return RulesEngine::GLOW_CURRENT;
    if (!strcmp(id, "igniter_current") || !strcmp(id, "igniter_current_main")) return RulesEngine::IGNITER_CURRENT;
    if (!strcmp(id, "igniter2_current") || !strcmp(id, "igniter2_current_main")) return RulesEngine::IGNITER2_CURRENT;
    if (!strcmp(id, "oil_pump_current") || !strcmp(id, "oil_pump_current_main")) return RulesEngine::OIL_PUMP_CURRENT;
    if (!strcmp(id, "ab_input") || !strcmp(id, "ab_input_main")) return RulesEngine::AB_INPUT;
    if (!strcmp(id, "start_switch")) return RulesEngine::START_SWITCH;
    if (!strcmp(id, "stop_switch")) return RulesEngine::STOP_SWITCH;
    if (!strcmp(id, "di0")) return RulesEngine::DI_CH0;
    if (!strcmp(id, "di1")) return RulesEngine::DI_CH1;
    if (!strcmp(id, "di2")) return RulesEngine::DI_CH2;
    if (!strcmp(id, "di3")) return RulesEngine::DI_CH3;
    for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; ++i) {
        const auto& in = HardwareConfig::channelRegistry.inputs[i];
        if (strcmp(in.id, id) != 0) continue;
        return (int8_t)(ChannelRegistry::INPUT_SENSOR_BASE + i);
    }
    return -1;
}
int8_t ruleTargetHandle(const char* id) {
    if (!id || !id[0]) return -1;
    if (!strcmp(id, "main_fuel") || !strcmp(id, "main_fuel_output") || !strcmp(id, "throttle")) return RulesEngine::THROTTLE;
    if (!strcmp(id, "starter_main") || !strcmp(id, "main_starter") || !strcmp(id, "starter")) return RulesEngine::STARTER;
    if (!strcmp(id, "starter_enable") || !strcmp(id, "starter_enable_main")) return RulesEngine::STARTER_ENABLE;
    if (!strcmp(id, "oil_pump_main") || !strcmp(id, "oil_pump")) return RulesEngine::OIL_PUMP;
    if (!strcmp(id, "cooling_fan_main") || !strcmp(id, "cooling_fan") || !strcmp(id, "cool_fan")) return RulesEngine::COOL_FAN;
    if (!strcmp(id, "bleed_valve_main") || !strcmp(id, "bleed_valve")) return RulesEngine::BLEED_VALVE;
    if (!strcmp(id, "oil_scavenge_main") || !strcmp(id, "scavenge_pump") || !strcmp(id, "oil_scavenge_pump")) return RulesEngine::OIL_SCAVENGE;
    if (!strcmp(id, "fuel_pump") || !strcmp(id, "fuel_pump2") || !strcmp(id, "fuel_pump2_main")) return RulesEngine::FUEL_PUMP2;
    if (!strcmp(id, "main_fuel_shutoff") || !strcmp(id, "fuel_shutoff") || !strcmp(id, "fuel_sol")) return RulesEngine::FUEL_SOL;
    if (!strcmp(id, "igniter") || !strcmp(id, "igniter_main")) return RulesEngine::IGNITER;
    if (!strcmp(id, "ab_igniter") || !strcmp(id, "igniter2_main") || !strcmp(id, "igniter2")) return RulesEngine::IGNITER2;
    if (!strcmp(id, "ab_solenoid") || !strcmp(id, "ab_sol") || !strcmp(id, "ab_solenoid_main")) return RulesEngine::AB_SOL;
    if (!strcmp(id, "ab_pump") || !strcmp(id, "ab_pump_main")) return RulesEngine::AB_PUMP;
    if (!strcmp(id, "air_starter") || !strcmp(id, "airstarter_sol") || !strcmp(id, "airstarter_main")) return RulesEngine::AIRSTARTER;
    if (!strcmp(id, "glow_plug") || !strcmp(id, "glow_plug_main")) return RulesEngine::GLOW_PLUG;
    if (!strcmp(id, "prop_pitch") || !strcmp(id, "prop_pitch_main")) return RulesEngine::PROP_PITCH;
    if (!strcmp(id, "request_shutdown")) return RulesEngine::REQUEST_SHUTDOWN;
    if (!strcmp(id, "request_fault")) return RulesEngine::REQUEST_FAULT;
    for (uint8_t i = 0; i < HardwareConfig::channelRegistry.outputCount; ++i) {
        const auto& out = HardwareConfig::channelRegistry.outputs[i];
        if (strcmp(out.id, id) != 0) continue;
        if (!HardwareConfig::channelRegistry.ownsCoreOutput(out) &&
            !HardwareConfig::channelRegistry.boundToCoreOutput(out))
            return (int8_t)(ChannelRegistry::OUTPUT_ACTUATOR_BASE + i);
        // A core-owned output is still addressed by its stable registry ID.
        // Resolve it through the legacy adapter that currently drives the
        // physical channel; callers must never need to know that adapter's
        // historical alias.
        if (!strcmp(out.purpose, "main_fuel")) return RulesEngine::THROTTLE;
        if (!strcmp(out.purpose, "starter")) return RulesEngine::STARTER;
        if (!strcmp(out.purpose, "starter_enable")) return RulesEngine::STARTER_ENABLE;
        if (!strcmp(out.purpose, "oil_pump")) return RulesEngine::OIL_PUMP;
        if (!strcmp(out.purpose, "cooling_fan")) return RulesEngine::COOL_FAN;
        if (!strcmp(out.purpose, "bleed_valve")) return RulesEngine::BLEED_VALVE;
        if (!strcmp(out.purpose, "scavenge_pump")) return RulesEngine::OIL_SCAVENGE;
        if (!strcmp(out.purpose, "fuel_pump")) return RulesEngine::FUEL_PUMP2;
        if (!strcmp(out.purpose, "fuel_shutoff")) return RulesEngine::FUEL_SOL;
        if (!strcmp(out.purpose, "igniter")) return RulesEngine::IGNITER;
        if (!strcmp(out.purpose, "ab_igniter")) return RulesEngine::IGNITER2;
        if (!strcmp(out.purpose, "ab_valve")) return RulesEngine::AB_SOL;
        if (!strcmp(out.purpose, "ab_pump")) return RulesEngine::AB_PUMP;
        if (!strcmp(out.purpose, "air_starter")) return RulesEngine::AIRSTARTER;
        if (!strcmp(out.purpose, "glow_plug")) return RulesEngine::GLOW_PLUG;
        if (!strcmp(out.purpose, "prop_pitch")) return RulesEngine::PROP_PITCH;
        return -1;
    }
    return -1;
}

}

// hardware_profile.h controller option → Config default (file wins once saved)
// ── Static member definitions ─────────────────────────────────
float Config::rpmLimit              = 100000;
float Config::n2RpmLimit            = 0;
float Config::minRpm                = 30000;
float Config::totLimit              = 750;
float Config::totCooldownTarget     = 150;
float Config::totSafeMargin         = 50;

float Config::oilStartupPressure    = 2.5f;
float Config::oilStartupPct         = 80.0f; // pump % when no oil pressure sensor
float Config::oilStartupMinBar      = 1.5f;
float Config::oilRunningMin         = 2.8f;
float Config::oilMapMin             = 3.6f;
float Config::oilMapMax             = 4.4f;
bool  Config::oilUseThrottleMap     = false;
float Config::oilAdjustScale        = 1.80f;
float Config::oilMinPct             = 18.0f;
int   Config::oilFailsafeDelayMs    = 1500;
float Config::oilFailsafePct        = 60.0f;

int   Config::startupOilArmTimeoutMs  = 3000;
float Config::preIgnRpm               = 5000;
int   Config::preIgnSparkMs           = 1500;
int   Config::flameTimeoutMs          = 5000;
int   Config::flameCheckIntervalMs    = 300;
float Config::spoolRpmTarget          = 32000;
int   Config::spoolTimeoutMs          = 12000;
int   Config::safetyHoldMs            = 1000;
int   Config::safetyHoldTimeoutMs     = 15000;
float Config::safetyHoldFinalRpm      = 31000;
bool  Config::safetyHoldCheckN1       = true;
bool  Config::safetyHoldCheckN2       = false;
bool  Config::safetyHoldCheckP1       = false;
bool  Config::safetyHoldCheckP2       = false;
bool  Config::safetyHoldCheckOil      = false;
bool  Config::safetyHoldCheckEgt      = false;
bool  Config::safetyHoldCheckFlame    = false;
float Config::safetyHoldFinalN2Rpm    = 0.0f;
float Config::safetyHoldFinalP1       = 0.0f;
float Config::safetyHoldFinalP2       = 0.0f;
float Config::safetyHoldFinalEgt      = 0.0f;
float Config::shutdownRpmDropThreshold= 5000;
int   Config::shutdownRpmDropTimeoutMs= 15000;
int   Config::shutdownCooldownTimeoutMs= 60000;  // 60 s default (was 200 s — unreachably long for typical engines)
int   Config::shutdownFinalStopTimeoutMs=10000;

float Config::throttleRampUpMs      = 1000;
float Config::throttleRampDownMs    = 2000;
float Config::throttleIdleMaxPct    = 50;
float Config::fuelPumpMinPct        = 0;   // 0 = not calibrated; measured via the fuel-pump min-spin calibration
float Config::throttleExpo          = 0.0f;  // 0 = linear by default
bool  Config::pullbackN1Enabled     = true;
bool  Config::pullbackN2Enabled     = false;
bool  Config::pullbackEgtEnabled    = true;
bool  Config::pullbackP1Enabled     = false;
bool  Config::pullbackP2Enabled     = false;
bool  Config::pullbackTorqueEnabled = false;
float Config::pullbackN1SoftRpm     = 95000.0f;
float Config::pullbackN1HardRpm     = 100000.0f;
float Config::pullbackN2SoftRpm     = 0.0f;
float Config::pullbackN2HardRpm     = 0.0f;
float Config::pullbackEgtSoftC      = 700.0f;
float Config::pullbackEgtHardC      = 750.0f;
float Config::pullbackP1Soft        = 0.0f;
float Config::pullbackP1Hard        = 0.0f;
float Config::pullbackP2Soft        = 0.0f;
float Config::pullbackP2Hard        = 0.0f;
float Config::pullbackTorqueSoft    = 0.0f;
float Config::pullbackTorqueHard    = 0.0f;
float Config::p1TripLimit           = 0.0f;
float Config::p2TripLimit           = 0.0f;
float Config::torqueTripLimit       = 0.0f;
int   Config::p1TripConfirmMs = 250; int Config::p2TripConfirmMs = 250; int Config::torqueTripConfirmMs = 250;
float Config::pullbackMinThrottlePct = 8.0f;
float Config::pullbackNearLimitRampUpMs = 4000.0f;
float Config::pullbackApproachZoneRpm   = 0.0f;
float Config::rpmAccelFilter            = 0.20f;
int   Config::pullbackN1Mode = 0; int Config::pullbackN2Mode = 0; int Config::pullbackEgtMode = 0;
int   Config::pullbackP1Mode = 0; int Config::pullbackP2Mode = 0; int Config::pullbackTorqueMode = 0;
float Config::pullbackN1LookaheadMs = 1500.0f; float Config::pullbackN2LookaheadMs = 1500.0f;
float Config::pullbackEgtLookaheadMs = 1500.0f; float Config::pullbackP1LookaheadMs = 1500.0f;
float Config::pullbackP2LookaheadMs = 1500.0f; float Config::pullbackTorqueLookaheadMs = 1500.0f;
float Config::pullbackN1Strength = 1.0f; float Config::pullbackN2Strength = 1.0f;
float Config::pullbackEgtStrength = 1.0f; float Config::pullbackP1Strength = 1.0f;
float Config::pullbackP2Strength = 1.0f; float Config::pullbackTorqueStrength = 1.0f;

float Config::idleTargetRpm         = 44000;
float Config::idleRampUpMs          = 10000;
float Config::idleRampDownMs        = 20000;
float Config::idleDeadbandRpm       = 300;
float Config::idleRpmLimit          = 60000;
float Config::idleMaxMultiplier     = 1.50f;
bool  Config::idleUseN2             = ConfigInternal::idleUseN2Default;
int   Config::idleSource            = ConfigInternal::idleUseN2Default ? 1 : 0;
float Config::idleTargetPressure    = 1.0f;
float Config::idlePressureDeadband  = 0.03f;
float Config::idlePressureLimit     = 2.0f;
float Config::idleIGain             = 0.0f;   // 0 = off by default (pure ramp mode), enable in config
float Config::idleIMax              = 0.10f;  // ±10% integral authority
int   Config::idleMode                  = 0;
float Config::idleDecelEnterRpm         = 0.0f;
float Config::idleDecelDropPct          = 0.0f;
float Config::idleLookaheadMs           = 2500.0f;
float Config::idleSettleBandRpm         = 1500.0f;
float Config::idleFullResponseRpm       = 12000.0f;
float Config::idleTrimUpPctPerSec       = 4.0f;
float Config::idleTrimDownPctPerSec     = 2.0f;
float Config::idleLearnRate             = 0.02f;
float Config::idleLearnAccelMax         = 1200.0f;
float Config::idlePressureDecelEnter    = 0.0f;
float Config::idlePressureSettleBand    = 0.03f;
float Config::idlePressureFullResponse  = 0.25f;
float Config::idlePressureLearnRateMax  = 1.0f;

int   Config::safetyCheckIntervalMs      = 100;
float Config::flameoutShutdownMs         = 3000;
int   Config::egtSource                  = 0;
int   Config::flameoutSource             = 0;
float Config::flameoutN1MinRpm           = 0.0f;
float Config::flameoutEgtBelowC          = 300.0f;
float Config::flameoutEgtFallRateCPerSec = 50.0f;
float Config::titLimit                   = 0.0f;
float Config::oilTempLimit               = 120.0f;
float Config::fuelPressMin               = 0.0f;
float Config::battVoltMin                = 0.0f;
float Config::surgeDetectRpmVariance     = 0.0f;
uint32_t Config::lowOilConfirmMs         = 500;
uint32_t Config::oilZeroConfirmMs        = 100;
uint32_t Config::oilTempConfirmMs        = 1000;
uint32_t Config::fuelPressConfirmMs      = 500;
uint32_t Config::battLowConfirmMs        = 1000;

bool     Config::relightEnabled      = false;
int      Config::relightTriggerSource = 0;
int      Config::relightTriggerConfirmMs = 200;
float    Config::relightTriggerEgtBelowC = 300.0f;
float    Config::relightTriggerEgtFallRateCPerSec = 50.0f;
int      Config::relightIgnitionTarget = 0;
char     Config::relightOutputId[20] = {};
int      Config::relightConfirmSource = 0;
float    Config::relightMinRpm       = 30000.0f;
float    Config::relightConfirmRpm   = 35000.0f;
float    Config::relightTotRiseC     = 30.0f;
int      Config::relightTimeoutMs    = 2000;    // normal combustor should recover within 1-2 s

uint32_t Config::toolFuelPrimeMs    = 3000;
uint32_t Config::toolOilPrimeMs     = 5000;
uint32_t Config::toolIgnTestMs      = 2000;
uint32_t Config::toolIgn2TestMs     = 2000;
uint32_t Config::toolGlowTestMs     = 10000;
float    Config::toolGlowTestPct    = 100.0f;
uint32_t Config::toolStartTestMs    = 2000;
float    Config::toolStartTestPct   = 30.0f;
uint32_t Config::toolFuelSolTestMs  = 1000;
uint32_t Config::toolIdleTestMs     = 3000;
uint32_t Config::toolOilScavTestMs  = 2000;
uint32_t Config::toolCoolFanTestMs  = 3000;
uint32_t Config::toolAirstarterTestMs = 1000;
uint32_t Config::toolBleedValveTestMs = 1000;
uint32_t Config::toolFuelPump2TestMs = 3000;
float    Config::toolFuelPump2TestPct = 30.0f;
uint32_t Config::toolAbSolTestMs    = 1000;
uint32_t Config::toolAbPumpTestMs   = 2000;
float    Config::toolAbPumpTestPct  = 30.0f;
uint32_t Config::toolStarterEnTestMs = 1000;
uint32_t Config::toolPropPitchTestMs = 3000;
float    Config::toolPropPitchTestPct = 50.0f;

uint32_t Config::wsIntervalMs       = 333;
uint32_t Config::snapshotIntervalMs = 10000;
uint32_t Config::controlLoopHz      = 400;
bool     Config::logStandby         = false;

bool     Config::starterAssistEnabled = false;
float    Config::starterAssistPwmPct = 15.0f;
float    Config::starterAssistUntilRpm = 1000.0f;
uint32_t Config::starterAssistOnMs = 500;
uint32_t Config::starterAssistOffMs = 250;

float    Config::starterStartupRampPctPerSec = 10.0f;
float    Config::starterDemand        = 60.0f;  // %
int      Config::starterTimeoutMs     = 8000;

float    Config::tempConfirmTarget    = 200.0f;
int      Config::tempConfirmTimeoutMs = 10000;

float    Config::rpmZeroThreshold     = 100.0f;

float    Config::oilZeroBar          = 0.1f;
float    Config::oilPressureDeadband = 0.2f;
uint32_t Config::oilPumpUnderflowDelayMs = 5000;
bool     Config::shutdownOnOilUnderflow = false;

bool     Config::standbyOilEnabled   = false;
int      Config::standbyOilSource    = 0;
float    Config::standbyOilRpmLimit  = 1000.0f;
float    Config::standbyOilFeedPct   = 25.0f;
float    Config::standbyOilFeedBar   = 0.0f;
char     Config::standbyOilOutputId[20] = {};

float    Config::limpMaxThrottlePct  = 75.0f;
bool     Config::igniterOnStart      = false;
int      Config::manualRelightIgnitionTarget = 0;
char     Config::manualRelightOutputId[20] = {};

bool     Config::cooldownUseStarter         = true;
bool     Config::cooldownUseOilPump         = true;
float    Config::cooldownStarterPct         = 40.0f;  // %
float    Config::cooldownOilPct             = 30.0f;  // % (no pressure sensor)
float    Config::cooldownOilPressureTarget  = 2.0f;   // bar

int      Config::flameRequiredCount  = 3;

int      Config::waitForInputChannel   = 0;
bool     Config::waitForInputExpected  = true;
int      Config::waitForInputTimeoutMs = 0;

int      Config::cooldownSkipHoldMs  = 1000;

int      Config::timedDelayMs            = 1000;
float    Config::modifiedIdleMultiplier  = 1.0f;
int      Config::fuelPulsePulseMs        = 200;
int      Config::fuelPulseOffMs          = 300;
float    Config::waitTotCoolTarget       = 150.0f;
int      Config::waitTotCoolTimeoutMs    = 120000;
float    Config::throttleSetPct          = 10.0f;
int      Config::preHeatMs               = 3000;
float    Config::oilPumpOnPct            = 100.0f;

bool     Config::flameConfirmTurnOffIgniter  = true;
bool     Config::safetyHoldTurnOffStarter    = false;
bool     Config::safetyHoldTurnOffStarterEn  = false;
bool     Config::safetyHoldTurnOffIgniter    = false;
bool     Config::spoolCutStarterOnExit       = true;
bool     Config::spoolCutStarterEnOnExit     = true;

float    Config::preStartEgtLimitC           = 150.0f;
float    Config::startupEgtLimitC            = 0.0f;
int      Config::finalStopOilScavengeMs      = 0;
bool     Config::oilPrimeUseScavengePump    = false;
bool     Config::cooldownUseScavengePump    = false;

float    Config::abMinN1                    = 30000.0f;
float    Config::abMaxN1                    = 0.0f;      // 0 = disabled
float    Config::abMaxTotForLight           = 0.0f;      // 0 = disabled
float    Config::abThrottleThreshold        = 0.80f;     // 80%
bool     Config::abUseTorch                 = false;
bool     Config::abUseIgniter               = false;
float    Config::abTorchSpikePct            = 30.0f;
int      Config::abTorchDurationMs          = 400;
float    Config::abTorchTotLimit            = 0.0f;      // 0 = disabled
int      Config::abTorchGuardMode           = 0;
int      Config::abFlameMode                = 2;         // 2=timed (safest default)
float    Config::abTotRiseDegC              = 30.0f;
int      Config::abTotRiseWindowMs          = 2000;
int      Config::abAssumeIgnitedMs          = 1500;
int      Config::abFlameTimeoutMs           = 3000;
int      Config::abFlameLossDelayMs         = 1000;
float    Config::abLightupPumpPct           = 80.0f;
float    Config::abPumpMinPct               = 80.0f;
float    Config::abPumpMaxPct               = 100.0f;
int      Config::abPumpControlMode          = 0;
float    Config::abMainFuelOffsetPct        = 0.0f;
int      Config::abStabilizeMs              = 1000;
float    Config::abStabilizeMaxTot          = 0.0f;      // 0 = disabled

float    Config::rpmJumpThreshold    = 0.40f;
int      Config::rpmZeroStuckTicks   = 5;

float    Config::n1WarnRpm          = 0.0f;       // 0 = auto (rpmLimit * 0.9)
float    Config::n2WarnRpm          = 22000.0f;
float    Config::totWarnC           = 0.0f;       // 0 = auto (selected EGT limit - totSafeMargin)
float    Config::oilWarnBar         = 0.0f;       // 0 = auto (oilRunningMin)

int      Config::rcFailsafeMs       = 500;

uint32_t Config::sessionLogMask       = Config::SLOG_DEFAULT;
uint32_t Config::sessionLogIntervalMs = 1000;  // 1 Hz default
uint8_t  Config::sessionRegistryInputCount = 0;
char     Config::sessionRegistryInputIds[Config::MAX_SESSION_REGISTRY_INPUTS][20] = {};
float Config::governorTargetRpm     = 0.0f;
float Config::governorBandRpm       = 500.0f;
float Config::governorKp            = 0.00025f;  // 25 fuel percentage-points/s at 1000 RPM error
float Config::governorPitchKp       = 0.00020f;  // 20 pitch percentage-points/s at 1000 RPM error
float Config::governorPitchRampSec  = 10.0f;   // 0→100% pitch in 10 s max
int   Config::govHoldTimeoutMs      = 10000;
float Config::fp2StartPct           = 0.0f;
float Config::fp2EndPct             = 80.0f;
int   Config::fp2RampMs             = 3000;
float Config::fp2DemandPct          = 0.0f;

int   Config::glowPreheatMs         = 10000;
float Config::glowPreheatMaxPct     = 80.0f;
float Config::glowHoldPct           = 30.0f;
bool  Config::glowWaitUntilHot      = false;

volatile uint32_t Config::totalRunSeconds    = 0;
volatile uint32_t Config::startAttemptCount  = 0;
volatile uint32_t Config::runCount           = 0;
// Guards the read-modify-write of the three persisted counters above so a
// Core 0 config-restore merge cannot lose a concurrent Core 1 increment.
portMUX_TYPE ConfigInternal::statsMux = portMUX_INITIALIZER_UNLOCKED;

int   Config::throttleMinRaw        = 0;
int   Config::throttleMaxRaw        = 4095;
int   Config::idleMinRaw            = 0;
int   Config::idleMaxRaw            = 4095;
float Config::oilPolyA              = 0;
float Config::oilPolyB              = 0;
float Config::oilPolyC              = 0;
float Config::oilPolyD              = 0;
float Config::oilPolyXMin           = 0;
float Config::oilPolyXMax           = 4095;
int   Config::p1RawMin              = 0;
int   Config::p1RawMax              = 4095;
float Config::p1ValMax              = 10.0f;
int   Config::p2RawMin              = 0;
int   Config::p2RawMax              = 4095;
float Config::p2ValMax              = 10.0f;
int   Config::fuelPressRawMin       = 0;
int   Config::fuelPressRawMax       = 4095;
float Config::fuelPressValMax       = 10.0f;
int   Config::fuelFlowRawMin        = 0;
int   Config::fuelFlowRawMax        = 4095;
float Config::fuelFlowValMax        = 10.0f;

char  Config::profileId[64]         = {};
char  Config::uiTheme[16]           = "carbon";
bool  Config::profileMatch          = false;
char  Config::loadWarning[192]      = {};
static SemaphoreHandle_t s_configWriteMutex = nullptr;

static void inhibitStartForConfigWriteFailure() {
    EngineData::instance().configStorageFault = true;
    strncpy(EngineData::instance().faultDescription,
        "Cannot start: the ECU configuration could not be written to storage. "
        "Check or re-upload the filesystem before operating the engine.",
        sizeof(EngineData::instance().faultDescription) - 1);
    EngineData::instance().faultDescription[
        sizeof(EngineData::instance().faultDescription) - 1] = '\0';
    Config::profileMatch = false;
}

static void inhibitStartForProfileMismatch() {
    EngineData::instance().configStorageFault = false;
    strncpy(EngineData::instance().faultDescription,
        "Cannot start: hardware and settings in ecu_config.json identify different engines. "
        "Restore one complete engine file or save Hardware to synchronize its profile ID.",
        sizeof(EngineData::instance().faultDescription) - 1);
    EngineData::instance().faultDescription[
        sizeof(EngineData::instance().faultDescription) - 1] = '\0';
    Config::profileMatch = false;
}

Config::Rule Config::rules[Config::MAX_RULES] = {};
int          Config::ruleCount                = 0;
uint8_t      Config::controllerSchema         = 0;

namespace {
bool registryInputPurposeAvailable(const char* purpose) {
    for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; ++i) {
        const auto& input = HardwareConfig::channelRegistry.inputs[i];
        if (!strcmp(input.purpose, purpose) && ChannelRegistry::channelAddressable(input))
            return true;
    }
    return false;
}

bool ruleSensorAvailable(uint8_t s) {
    if (ChannelRegistry::isInputSensor(s)) {
        uint8_t idx = ChannelRegistry::inputIndexFromSensor(s);
        return idx < HardwareConfig::channelRegistry.inputCount &&
               ChannelRegistry::channelAddressable(HardwareConfig::channelRegistry.inputs[idx]);
    }
    switch (s) {
        case 0:  return HardwareConfig::hasOilTemp;
        case 1:  return HardwareConfig::hasTot;
        case 2:  return HardwareConfig::hasN1Rpm;
        case 3:  return HardwareConfig::hasOilPress;
        case 4:  return HardwareConfig::hasTit;
        case 5:  return HardwareConfig::hasBattVoltage;
        case 6:  return HardwareConfig::hasN2Rpm;
        case 7:  return HardwareConfig::diCh[0].pin >= 0;
        case 8:  return HardwareConfig::diCh[1].pin >= 0;
        case 9:  return HardwareConfig::diCh[2].pin >= 0;
        case 10: return HardwareConfig::diCh[3].pin >= 0;
        case 11: return HardwareConfig::hasFuelPress;
        case 12: return HardwareConfig::hasFuelFlow;
        case 13: return HardwareConfig::hasP1;
        case 14: return HardwareConfig::hasP2;
        case 15: return HardwareConfig::hasTorque;
        case 16: return HardwareConfig::hasFlame;
        case 17: return HardwareConfig::hasThrottleInput;
        case 18: return HardwareConfig::hasIdleInput;
        case 19: return HardwareConfig::hasAfterburner && HardwareConfig::hasAbFlame;
        case 20: return HardwareConfig::hasGlowPlug && HardwareConfig::hasGlowCurrentSensor;
        case 21: return HardwareConfig::hasIgniter && HardwareConfig::hasIgniterCurrentSensor;
        case 22: return HardwareConfig::hasIgniter2 && HardwareConfig::hasIgniter2CurrentSensor;
        case 23: return HardwareConfig::hasOilPump && HardwareConfig::hasOilPumpCurrentSensor;
        case 24: return HardwareConfig::hasAfterburner &&
                        (HardwareConfig::abInputPin >= 0 || registryInputPurposeAvailable("ab_command"));
        case 25: return HardwareConfig::startPin >= 0 || registryInputPurposeAvailable("start_switch");
        case 26: return HardwareConfig::stopPin >= 0 || registryInputPurposeAvailable("stop_switch");
        case 27: return HardwareConfig::hasThrust;
        default: return false;
    }
}

bool ruleActuatorAvailable(uint8_t a) {
    if (ChannelRegistry::isOutputActuator(a)) {
        uint8_t idx = ChannelRegistry::outputIndexFromActuator(a);
        if (idx >= HardwareConfig::channelRegistry.outputCount) return false;
        const auto& out = HardwareConfig::channelRegistry.outputs[idx];
        return ChannelRegistry::channelAddressable(out) &&
               !HardwareConfig::channelRegistry.ownsCoreOutput(out) &&
               !HardwareConfig::channelRegistry.boundToCoreOutput(out);
    }
    switch (a) {
        case 0:  return HardwareConfig::hasCoolFan;
        case 1:  return HardwareConfig::hasBleedValve;
        case 2:  return HardwareConfig::hasFuelPump2;
        case 3:  return HardwareConfig::hasOilScavengePump;
        case 4:  return HardwareConfig::hasThrottle;
        case 5:  return HardwareConfig::hasStarter;
        case 6:  return HardwareConfig::hasStarterEn;
        case 7:  return HardwareConfig::hasOilPump;
        case 8:  return HardwareConfig::hasFuelSol;
        case 9:  return HardwareConfig::hasIgniter;
        case 10: return HardwareConfig::hasIgniter2;
        case 11: return HardwareConfig::hasAfterburner && HardwareConfig::hasAbSol;
        case 12: return HardwareConfig::hasAfterburner && HardwareConfig::hasAbPump;
        case 13:
        case 14: return true;
        case 15: return HardwareConfig::hasAirstarterSol;
        case 16: return HardwareConfig::hasGlowPlug;
        case 17: return HardwareConfig::hasPropPitch;
        default: return false;
    }
}

bool ruleActuatorSupportsVariable(uint8_t a) {
    if (ChannelRegistry::isOutputActuator(a)) {
        const uint8_t idx = ChannelRegistry::outputIndexFromActuator(a);
        if (idx >= HardwareConfig::channelRegistry.outputCount) return false;
        const uint8_t driver = HardwareConfig::channelRegistry.outputs[idx].driver;
        return driver == 5 || driver == 6; // PWM or servo
    }
    switch (a) {
        case RulesEngine::FUEL_PUMP2:
        case RulesEngine::THROTTLE:
        case RulesEngine::STARTER:
        case RulesEngine::OIL_PUMP:
        case RulesEngine::GLOW_PLUG:
        case RulesEngine::PROP_PITCH:
            return true;
        default:
            return false;
    }
}

bool ruleTargetConflictsWithDedicatedController(int8_t handle) {
    if (handle == RulesEngine::AB_PUMP) return true;
    if (handle == RulesEngine::THROTTLE || handle == RulesEngine::PROP_PITCH)
        return HardwareConfig::hasGovernor;
    if (handle == RulesEngine::OIL_PUMP) return HardwareConfig::hasOilLoop;
    if (ChannelRegistry::isOutputActuator(handle)) {
        const uint8_t outputIndex = ChannelRegistry::outputIndexFromActuator(handle);
        for (uint8_t i = 0; i < HardwareConfig::oilLoopCount; ++i)
            if (HardwareConfig::oilLoops[i].enabled &&
                HardwareConfig::oilLoops[i].pumpOutputIndex == outputIndex) return true;
    }
    return false;
}
} // namespace

namespace {

bool present(JsonVariantConst v) { return !v.isNull(); }

bool validNumber(JsonVariantConst v, float minValue, float maxValue) {
    if (!present(v)) return true;
    if (!v.is<float>() && !v.is<double>() && !v.is<int>() && !v.is<long>() &&
        !v.is<unsigned int>() && !v.is<unsigned long>()) return false;
    float value = v.as<float>();
    return isfinite(value) && value >= minValue && value <= maxValue;
}

bool validInt(JsonVariantConst v, long minValue, long maxValue) {
    if (!present(v)) return true;
    if (!v.is<int>() && !v.is<long>() && !v.is<unsigned int>() && !v.is<unsigned long>()) return false;
    long value = v.as<long>();
    return value >= minValue && value <= maxValue;
}

bool validBool(JsonVariantConst v) { return !present(v) || v.is<bool>(); }

bool validOptionalStableId(JsonVariantConst v, size_t maxLen) {
    if (!present(v)) return true;
    if (!v.is<const char*>()) return false;
    const char* id = v.as<const char*>();
    return id && strlen(id) < maxLen;
}

bool validRequiredStableId(JsonVariantConst v, size_t maxLen) {
    if (!v.is<const char*>()) return false;
    const char* id = v.as<const char*>();
    return id && id[0] && strlen(id) < maxLen;
}

bool validRuleId(JsonVariantConst v, size_t maxLen,
                 int8_t (*resolve)(const char*),
                 bool (*available)(uint8_t)) {
    if (!present(v)) return false;
    if (!v.is<const char*>()) return false;
    const char* id = v.as<const char*>();
    if (!id) return false;
    if (!id[0]) return false;
    if (strlen(id) >= maxLen) return false;
    int8_t handle = resolve(id);
    return handle >= 0 && available((uint8_t)handle);
}

bool validRawPair(JsonVariantConst obj, const char* minKey, const char* maxKey) {
    if (!validInt(obj[minKey], 0, 4095) || !validInt(obj[maxKey], 0, 4095)) return false;
    if (present(obj[minKey]) && present(obj[maxKey]) && obj[maxKey].as<int>() <= obj[minKey].as<int>()) return false;
    return true;
}

bool validMsFields(JsonVariantConst obj, const char* const* keys, int count, long maxValue = 3600000) {
    for (int i = 0; i < count; i++)
        if (!validInt(obj[keys[i]], 0, maxValue)) return false;
    return true;
}

bool validateSettingsDoc(const JsonDocument& doc, bool validateHardwareDependencies = true) {
    const char* id = doc["profile_id"] | "";
    if (!id[0] || strlen(id) >= sizeof(Config::profileId)) return false;

    const char* requiredSections[] = { "engine", "oil", "sequence", "throttle", "safety", "calibration" };
    for (const char* section : requiredSections)
        if (!doc[section].is<JsonObjectConst>()) return false;

    JsonVariantConst eng = doc["engine"];
    // Safety-limit upper bounds are deliberately loose: values above the
    // recommended caps (rpm_limit 500000, tot_limit 1400) are accepted and
    // flagged via Config::loadWarning instead of rejected (warn, don't block).
    if (!validNumber(eng["rpm_limit"], 1000.0f, 1000000000.0f) ||
        !validNumber(eng["n2_rpm_limit"], 0.0f, 1000000000.0f) ||
        !validNumber(eng["min_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(eng["tot_limit"], 0.0f, 100000.0f) ||
        !validNumber(eng["tot_cooldown_target"], 0.0f, 100000.0f) ||
        !validNumber(eng["tot_safe_margin"], 0.0f, 100000.0f)) return false;
    if (present(eng["rpm_limit"]) && present(eng["min_rpm"]) && eng["min_rpm"].as<float>() >= eng["rpm_limit"].as<float>()) return false;
    // tot_cooldown_target >= tot_limit is accepted (warn only) so the
    // controller/system editor's "Save anyway" flow works instead of hard-failing.

    JsonVariantConst oil = doc["oil"];
    if (!validNumber(oil["startup_pressure"], 0.0f, 20.0f) ||
        !validNumber(oil["startup_pct"], 0.0f, 100.0f) ||
        !validNumber(oil["startup_min_bar"], 0.0f, 20.0f) ||
        !validNumber(oil["running_min"], 0.0f, 20.0f) ||
        !validNumber(oil["map_min"], 0.0f, 20.0f) ||
        !validNumber(oil["map_max"], 0.0f, 20.0f) ||
        !validBool(oil["use_throttle_map"]) ||
        !validNumber(oil["adjust_scale"], 0.0f, 20.0f) ||
        !validNumber(oil["min_pct"], 0.0f, 100.0f) ||
        !validInt(oil["failsafe_delay_ms"], 0, 60000) ||
        !validNumber(oil["failsafe_pct"], 0.0f, 100.0f)) return false;
    if (present(oil["map_min"]) && present(oil["map_max"]) && oil["map_max"].as<float>() < oil["map_min"].as<float>()) return false;

    JsonVariantConst su = doc["sequence"]["startup"];
    JsonVariantConst sd = doc["sequence"]["shutdown"];
    if (!su.is<JsonObjectConst>() || !sd.is<JsonObjectConst>()) return false;
    const char* startupMs[] = {
        "oil_arm_timeout_ms", "pre_ign_spark_ms", "flame_timeout_ms", "rpm_timeout_ms",
        "safety_hold_ms", "safety_hold_timeout_ms", "starter_timeout_ms", "temp_confirm_timeout", "wait_for_input_timeout",
        "timed_delay_ms", "fuel_pulse_ms", "fuel_off_ms", "wait_tot_timeout", "preheat_ms",
        "fp2_ramp_ms", "gov_hold_timeout_ms"
    };
    if (!validMsFields(su, startupMs, sizeof(startupMs) / sizeof(startupMs[0])) ||
        !validInt(su["flame_check_interval_ms"], 1, 3600000) ||
        !validInt(su["flame_required_count"], 1, 1000) ||
        !validInt(su["wait_for_input_ch"], 0, 3) ||
        !validBool(su["wait_for_input_state"])) return false;
    if (!validNumber(su["pre_ign_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(su["rpm_target"], 0.0f, 1000000000.0f) ||
        !validNumber(su["final_check_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(su["final_check_n2_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(su["final_check_p1_bar"], 0.0f, 1000.0f) ||
        !validNumber(su["final_check_p2_bar"], 0.0f, 1000.0f) ||
        !validNumber(su["final_check_egt_c"], 0.0f, 100000.0f) ||
        !validNumber(su["starter_demand"], 0.0f, 100.0f) ||
        !validNumber(su["temp_confirm_target"], 0.0f, 100000.0f) ||
        !validNumber(su["wait_tot_target"], 0.0f, 100000.0f) ||
        !validNumber(su["throttle_set_pct"], 0.0f, 100.0f) ||
        !validNumber(su["oil_pump_on_pct"], 0.0f, 100.0f) ||
        !validNumber(su["modified_idle_multiplier"], 0.0f, 10.0f) ||
        !validNumber(su["pre_start_egt_limit_c"], 0.0f, 100000.0f) ||
        !validNumber(su["startup_egt_limit_c"], 0.0f, 100000.0f) ||
        !validNumber(su["fp2_start_pct"], 0.0f, 100.0f) ||
        !validNumber(su["fp2_end_pct"], 0.0f, 100.0f) ||
        !validNumber(su["fp2_demand_pct"], 0.0f, 100.0f)) return false;
    if (!validBool(su["flame_turn_off_igniter"]) ||
        !validBool(su["final_check_n1_enabled"]) ||
        !validBool(su["final_check_n2_enabled"]) ||
        !validBool(su["final_check_p1_enabled"]) ||
        !validBool(su["final_check_p2_enabled"]) ||
        !validBool(su["final_check_oil_enabled"]) ||
        !validBool(su["final_check_egt_enabled"]) ||
        !validBool(su["final_check_flame_enabled"]) ||
        !validBool(su["safety_turn_off_starter"]) ||
        !validBool(su["safety_turn_off_starter_en"]) ||
        !validBool(su["safety_turn_off_igniter"]) ||
        !validBool(su["spool_cut_starter_on_exit"]) ||
        !validBool(su["spool_cut_starter_en_on_exit"]) ||
        !validBool(su["oil_prime_use_scavenge"])) return false;

    const char* shutdownMs[] = { "rpm_drop_timeout_ms", "cooldown_timeout_ms", "final_stop_timeout_ms", "oil_scavenge_ms" };
    if (!validMsFields(sd, shutdownMs, sizeof(shutdownMs) / sizeof(shutdownMs[0])) ||
        !validNumber(sd["rpm_drop_threshold"], 0.0f, 1000000000.0f) ||
        !validNumber(sd["rpm_zero_threshold"], 0.0f, 1000000000.0f) ||
        !validNumber(sd["cooldown_starter_pct"], 0.0f, 100.0f) ||
        !validNumber(sd["cooldown_oil_pct"], 0.0f, 100.0f) ||
        !validNumber(sd["cooldown_oil_pressure_bar"], 0.0f, 20.0f) ||
        !validBool(sd["cooldown_use_scavenge"]) ||
        !validBool(sd["cooldown_use_starter"]) ||
        !validBool(sd["cooldown_use_oil"])) return false;
    auto sequenceContains = [](char sequence[][24], int count, const char* name) {
        for (int i = 0; i < count; ++i) if (!strcmp(sequence[i], name)) return true;
        return false;
    };
    if (validateHardwareDependencies) {
        if (sequenceContains(HardwareConfig::startupSeq, HardwareConfig::startupSeqLen, "OilPrime") &&
            (!present(su["oil_arm_timeout_ms"]) || su["oil_arm_timeout_ms"].as<int>() < 500)) return false;
        if ((sequenceContains(HardwareConfig::startupSeq, HardwareConfig::startupSeqLen, "WaitForInput") ||
             sequenceContains(HardwareConfig::startupSeq, HardwareConfig::startupSeqLen, "WaitForInputOff")) &&
            (!present(su["wait_for_input_timeout"]) || su["wait_for_input_timeout"].as<int>() < 500)) return false;
        if (sequenceContains(HardwareConfig::startupSeq, HardwareConfig::startupSeqLen, "SafetyHold") &&
            ((!present(su["safety_hold_ms"]) || su["safety_hold_ms"].as<int>() < 100) ||
             (!present(su["safety_hold_timeout_ms"]) || su["safety_hold_timeout_ms"].as<int>() < 100))) return false;
        if (sequenceContains(HardwareConfig::shutdownSeq, HardwareConfig::shutdownSeqLen, "RPMDrop") &&
            (!present(sd["rpm_drop_timeout_ms"]) || sd["rpm_drop_timeout_ms"].as<int>() < 1000)) return false;
        if (sequenceContains(HardwareConfig::shutdownSeq, HardwareConfig::shutdownSeqLen, "CooldownSpin") &&
            (!present(sd["cooldown_timeout_ms"]) || sd["cooldown_timeout_ms"].as<int>() < 1000)) return false;
        if (sequenceContains(HardwareConfig::shutdownSeq, HardwareConfig::shutdownSeqLen, "FinalStop") &&
            (!present(sd["final_stop_timeout_ms"]) || sd["final_stop_timeout_ms"].as<int>() < 1000)) return false;
    }

    JsonVariantConst th = doc["throttle"];
    if (!validNumber(th["ramp_up_ms"], 0.0f, 3600000.0f) ||
        !validNumber(th["ramp_down_ms"], 0.0f, 3600000.0f) ||
        !validNumber(th["fuel_pump_min_pct"], 0.0f, 100.0f) ||
        !validNumber(th["idle_max_pct"], 0.0f, 100.0f) ||
        !validNumber(th["expo"], 0.0f, 1.0f) ||
        !validBool(th["pullback_n1"]) ||
        !validBool(th["pullback_n2"]) ||
        !validBool(th["pullback_egt"]) ||
        !validBool(th["pullback_p1"]) ||
        !validBool(th["pullback_p2"]) ||
        !validBool(th["pullback_torque"]) ||
        !validNumber(th["pullback_n1_soft_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(th["pullback_n1_hard_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(th["pullback_n2_soft_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(th["pullback_n2_hard_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(th["pullback_egt_soft_c"], 0.0f, 100000.0f) ||
        !validNumber(th["pullback_egt_hard_c"], 0.0f, 100000.0f) ||
        !validNumber(th["pullback_p1_soft_bar"], 0.0f, 1000.0f) ||
        !validNumber(th["pullback_p1_hard_bar"], 0.0f, 1000.0f) ||
        !validNumber(th["pullback_p2_soft_bar"], 0.0f, 1000.0f) ||
        !validNumber(th["pullback_p2_hard_bar"], 0.0f, 1000.0f) ||
        !validNumber(th["pullback_torque_soft_nm"], 0.0f, 1000000.0f) ||
        !validNumber(th["pullback_torque_hard_nm"], 0.0f, 1000000.0f) ||
        !validNumber(th["pullback_min_pct"], 0.0f, 100.0f) ||
        !validNumber(th["pullback_near_limit_rampup_ms"], 0.0f, 20000.0f) ||
        !validNumber(th["pullback_approach_zone_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(th["rpm_accel_filter"], 0.02f, 1.0f)) return false;
    const char* limiterModes[] = {"pullback_n1_mode","pullback_n2_mode","pullback_egt_mode",
                                  "pullback_p1_mode","pullback_p2_mode","pullback_torque_mode"};
    for (const char* key : limiterModes) if (!validInt(th[key], 0, 1)) return false;
    const char* limiterHorizons[] = {"pullback_n1_lookahead_ms","pullback_n2_lookahead_ms","pullback_egt_lookahead_ms",
                                     "pullback_p1_lookahead_ms","pullback_p2_lookahead_ms","pullback_torque_lookahead_ms"};
    for (const char* key : limiterHorizons) if (!validNumber(th[key], 0.0f, 5000.0f)) return false;
    const char* limiterStrengths[] = {"pullback_n1_strength","pullback_n2_strength","pullback_egt_strength",
                                      "pullback_p1_strength","pullback_p2_strength","pullback_torque_strength"};
    for (const char* key : limiterStrengths) if (!validNumber(th[key], 0.0f, 5.0f)) return false;
    if (present(th["pullback_n1_soft_rpm"]) && present(th["pullback_n1_hard_rpm"]) &&
        th["pullback_n1_hard_rpm"].as<float>() > 0.0f &&
        th["pullback_n1_hard_rpm"].as<float>() <= th["pullback_n1_soft_rpm"].as<float>()) return false;
    if (present(th["pullback_n2_soft_rpm"]) && present(th["pullback_n2_hard_rpm"]) &&
        th["pullback_n2_hard_rpm"].as<float>() > 0.0f &&
        th["pullback_n2_hard_rpm"].as<float>() <= th["pullback_n2_soft_rpm"].as<float>()) return false;
    if (present(th["pullback_egt_soft_c"]) && present(th["pullback_egt_hard_c"]) &&
        th["pullback_egt_hard_c"].as<float>() > 0.0f &&
        th["pullback_egt_hard_c"].as<float>() <= th["pullback_egt_soft_c"].as<float>()) return false;
    if (present(th["pullback_p1_hard_bar"]) && th["pullback_p1_hard_bar"].as<float>() > 0.0f &&
        th["pullback_p1_hard_bar"].as<float>() <= th["pullback_p1_soft_bar"].as<float>()) return false;
    if (present(th["pullback_p2_hard_bar"]) && th["pullback_p2_hard_bar"].as<float>() > 0.0f &&
        th["pullback_p2_hard_bar"].as<float>() <= th["pullback_p2_soft_bar"].as<float>()) return false;
    if (present(th["pullback_torque_hard_nm"]) && th["pullback_torque_hard_nm"].as<float>() > 0.0f &&
        th["pullback_torque_hard_nm"].as<float>() <= th["pullback_torque_soft_nm"].as<float>()) return false;


    JsonVariantConst tools = doc["tools"];
    if (present(tools) && (!tools.is<JsonObjectConst>() ||
        !validInt(tools["fuel_prime_ms"], 100, 60000) ||
        !validInt(tools["oil_prime_ms"], 100, 60000) ||
        !validInt(tools["ign_test_ms"], 100, 60000) ||
        !validInt(tools["ign2_test_ms"], 100, 60000) ||
        !validInt(tools["glow_test_ms"], 100, 60000) ||
        !validNumber(tools["glow_test_pct"], 0.0f, 100.0f) ||
        !validInt(tools["start_test_ms"], 100, 60000) ||
        !validNumber(tools["start_test_pct"], 0.0f, 100.0f) ||
        !validInt(tools["fuel_sol_test_ms"], 50, 60000) ||
        !validInt(tools["idle_test_ms"], 100, 60000) ||
        !validInt(tools["oil_scav_test_ms"], 100, 60000) ||
        !validInt(tools["cool_fan_test_ms"], 100, 60000) ||
        !validInt(tools["airstarter_test_ms"], 50, 60000) ||
        !validInt(tools["bleed_valve_test_ms"], 50, 60000) ||
        !validInt(tools["fuel_pump2_test_ms"], 100, 60000) ||
        !validNumber(tools["fuel_pump2_test_pct"], 0.0f, 100.0f) ||
        !validInt(tools["ab_sol_test_ms"], 50, 60000) ||
        !validInt(tools["ab_pump_test_ms"], 100, 60000) ||
        !validNumber(tools["ab_pump_test_pct"], 0.0f, 100.0f) ||
        !validInt(tools["starter_en_test_ms"], 50, 60000) ||
        !validInt(tools["prop_pitch_test_ms"], 100, 60000) ||
        !validNumber(tools["prop_pitch_test_pct"], 0.0f, 100.0f))) return false;

    JsonVariantConst so = doc["standby_oil"];
    if (present(so) && (!so.is<JsonObjectConst>() ||
        !validBool(so["enabled"]) ||
        !validInt(so["source"], 0, 2) ||
        !validNumber(so["rpm_limit"], 0.0f, 1000000000.0f) ||
        !validNumber(so["feed_pct"], 0.0f, 100.0f) ||
        !validNumber(so["feed_bar"], 0.0f, 20.0f) ||
        !validOptionalStableId(so["output_id"], sizeof(Config::standbyOilOutputId)))) return false;

    JsonVariantConst sf = doc["safety"];
    if (!validInt(sf["check_interval_ms"], 10, 250) ||
        !validNumber(sf["flameout_shutdown_ms"], 100.0f, 60000.0f) ||
        !validInt(sf["egt_source"], 0, 2) ||
        !validInt(sf["flameout_source"], 0, 3) ||
        !validNumber(sf["flameout_n1_min_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(sf["flameout_egt_below_c"], 0.0f, 100000.0f) ||
        !validNumber(sf["flameout_egt_fall_rate_c_s"], 0.0f, 1000.0f) ||
        !validNumber(sf["tit_limit_c"], 0.0f, 100000.0f) ||
        !validNumber(sf["oil_temp_limit_c"], 0.0f, 100000.0f) ||
        !validNumber(sf["fuel_press_min_bar"], 0.0f, 100.0f) ||
        !validNumber(sf["batt_volt_min_v"], 0.0f, 80.0f) ||
        !validNumber(sf["p1_trip_bar"], 0.0f, 1000.0f) ||
        !validNumber(sf["p2_trip_bar"], 0.0f, 1000.0f) ||
        !validNumber(sf["torque_trip_nm"], 0.0f, 1000000.0f) ||
        !validInt(sf["p1_trip_confirm_ms"], 0, 60000) ||
        !validInt(sf["p2_trip_confirm_ms"], 0, 60000) ||
        !validInt(sf["torque_trip_confirm_ms"], 0, 60000) ||
        !validNumber(sf["surge_detect_rpm_variance"], 0.0f, 1000000000000.0f) ||
        !validInt(sf["low_oil_confirm_ms"], 0, 60000) ||
        !validInt(sf["oil_zero_confirm_ms"], 0, 60000) ||
        !validInt(sf["oil_temp_confirm_ms"], 0, 60000) ||
        !validInt(sf["fuel_press_confirm_ms"], 0, 60000) ||
        !validInt(sf["batt_low_confirm_ms"], 0, 60000)) return false;

    JsonVariantConst rl = doc["relight"];
    if (present(rl) && (!rl.is<JsonObjectConst>() ||
        !validBool(rl["enabled"]) ||
        !validOptionalStableId(rl["output_id"], sizeof(Config::relightOutputId)) ||
        !validInt(rl["ignition_target"], 0, 2) ||
        !validInt(rl["trigger_source"], 0, 3) ||
        !validInt(rl["trigger_confirm_ms"], 0, 60000) ||
        !validNumber(rl["trigger_egt_below_c"], 0.0f, 100000.0f) ||
        !validNumber(rl["trigger_egt_fall_rate_c_s"], 0.0f, 1000.0f) ||
        !validInt(rl["confirm_source"], 0, 3) ||
        !validNumber(rl["min_rpm"], 1.0f, 1000000000.0f) ||
        !validNumber(rl["confirm_rpm"], 1.0f, 1000000000.0f) ||
        !validNumber(rl["tot_rise_c"], 0.0f, 100000.0f) ||
        !validInt(rl["relight_timeout_ms"], 0, 30000))) return false;

    JsonVariantConst cal = doc["calibration"];
    if (!validInt(cal["throttle_min_raw"], 0, 4095) ||
        !validInt(cal["throttle_max_raw"], 0, 4095) ||
        !validInt(cal["idle_min_raw"], 0, 4095) ||
        !validInt(cal["idle_max_raw"], 0, 4095) ||
        !validRawPair(cal, "p1_raw_min", "p1_raw_max") ||
        !validRawPair(cal, "p2_raw_min", "p2_raw_max") ||
        !validRawPair(cal, "fuel_press_raw_min", "fuel_press_raw_max") ||
        !validRawPair(cal, "fuel_flow_raw_min", "fuel_flow_raw_max") ||
        !validNumber(cal["p1_val_max"], 0.001f, 1000.0f) ||
        !validNumber(cal["p2_val_max"], 0.001f, 1000.0f) ||
        !validNumber(cal["fuel_press_val_max"], 0.001f, 1000.0f) ||
        !validNumber(cal["fuel_flow_val_max"], 0.001f, 1000.0f)) return false;
    if (present(cal["throttle_min_raw"]) && present(cal["throttle_max_raw"]) && cal["throttle_min_raw"].as<int>() == cal["throttle_max_raw"].as<int>()) return false;
    if (present(cal["idle_min_raw"]) && present(cal["idle_max_raw"]) && cal["idle_min_raw"].as<int>() == cal["idle_max_raw"].as<int>()) return false;
    JsonVariantConst poly = cal["oil_poly"];
    if (present(poly) && (!poly.is<JsonObjectConst>() ||
        !validNumber(poly["a"], -1000000.0f, 1000000.0f) ||
        !validNumber(poly["b"], -1000000.0f, 1000000.0f) ||
        !validNumber(poly["c"], -1000000.0f, 1000000.0f) ||
        !validNumber(poly["d"], -1000000.0f, 1000000.0f) ||
        !validNumber(poly["x_min"], 0.0f, 4095.0f) ||
        !validNumber(poly["x_max"], 0.0f, 4095.0f))) return false;

    JsonVariantConst di = doc["dynamic_idle"];
    if (present(di) && (!di.is<JsonObjectConst>() ||
        !validNumber(di["target_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(di["ramp_up_ms"], 0.0f, 3600000.0f) ||
        !validNumber(di["ramp_down_ms"], 0.0f, 3600000.0f) ||
        !validNumber(di["deadband_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(di["rpm_limit"], 0.0f, 1000000000.0f) ||
        !validNumber(di["max_multiplier"], 1.0f, 3.0f) ||
        !validBool(di["use_n2"]) ||
        !validInt(di["source"], 0, 3) ||
        !validNumber(di["target_pressure_bar"], 0.0f, 1000.0f) ||
        !validNumber(di["pressure_deadband_bar"], 0.0f, 1000.0f) ||
        !validNumber(di["pressure_limit_bar"], 0.0f, 1000.0f) ||
        !validNumber(di["i_gain"], 0.0f, 2.0f) ||
        !validNumber(di["i_max"], 0.0f, 0.5f) ||
        !validInt(di["idle_mode"], 0, 1) ||
        !validNumber(di["decel_enter_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(di["decel_drop_pct"], 0.0f, 50.0f) ||
        !validNumber(di["lookahead_ms"], 0.0f, 5000.0f) ||
        !validNumber(di["settle_band_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(di["full_response_rpm"], 1.0f, 1000000000.0f) ||
        !validNumber(di["trim_up_pct_s"], 0.0f, 50.0f) ||
        !validNumber(di["trim_down_pct_s"], 0.0f, 50.0f) ||
        !validNumber(di["learn_rate"], 0.0f, 1.0f) ||
        !validNumber(di["learn_accel_max"], 0.0f, 1000000000.0f) ||
        !validNumber(di["pressure_decel_enter_bar"], 0.0f, 1000.0f) ||
        !validNumber(di["pressure_settle_band_bar"], 0.0f, 1000.0f) ||
        !validNumber(di["pressure_full_response_bar"], 0.0001f, 1000.0f) ||
        !validNumber(di["pressure_learn_rate_max_bar_s"], 0.0f, 1000.0f))) return false;

    JsonVariantConst ab = doc["afterburner"];
    if (present(ab)) {
        if (!ab.is<JsonObjectConst>() ||
            !validNumber(ab["min_n1"], 0.0f, 1000000000.0f) ||
            !validNumber(ab["max_n1"], 0.0f, 1000000000.0f) ||
            !validNumber(ab["max_tot_for_light"], 0.0f, 100000.0f) ||
            !validNumber(ab["throttle_threshold"], 0.0f, 1.0f) ||
            !validBool(ab["use_torch"]) ||
            !validBool(ab["use_igniter"]) ||
            !validNumber(ab["torch_spike_pct"], 0.0f, 100.0f) ||
            !validInt(ab["torch_duration_ms"], 0, 3600000) ||
            !validNumber(ab["torch_tot_limit"], 0.0f, 100000.0f) ||
            !validInt(ab["torch_guard_mode"], 0, 2) ||
            !validInt(ab["flame_mode"], 0, 3) ||
            !validNumber(ab["tot_rise_deg_c"], 0.0f, 100000.0f) ||
            !validInt(ab["tot_rise_window_ms"], 0, 3600000) ||
            !validInt(ab["assume_ignited_ms"], 0, 3600000) ||
            !validInt(ab["flame_timeout_ms"], 0, 3600000) ||
            !validInt(ab["flame_loss_delay_ms"], 0, 60000) ||
            !validNumber(ab["lightup_pump_pct"], 0.0f, 100.0f) ||
            !validNumber(ab["pump_min_pct"], 0.0f, 100.0f) ||
            !validNumber(ab["pump_max_pct"], 0.0f, 100.0f) ||
            !validInt(ab["pump_control_mode"], 0, 2) ||
            !validNumber(ab["main_fuel_offset_pct"], -20.0f, 50.0f) ||
            !validInt(ab["stabilize_ms"], 0, 3600000) ||
            !validNumber(ab["stabilize_max_tot"], 0.0f, 100000.0f)) return false;
        if (present(ab["pump_min_pct"]) && present(ab["pump_max_pct"]) && ab["pump_max_pct"].as<float>() < ab["pump_min_pct"].as<float>()) return false;
    }

    JsonVariantConst sl = doc["session_log"];
    if (present(sl)) {
        if (!sl.is<JsonObjectConst>() || !validInt(sl["interval_ms"], 100, 60000)) return false;
        JsonVariantConst selected = sl["registry_inputs"];
        if (present(selected)) {
            if (!selected.is<JsonArrayConst>() || selected.size() > Config::MAX_SESSION_REGISTRY_INPUTS)
                return false;
            const char* seen[Config::MAX_SESSION_REGISTRY_INPUTS] = {};
            uint8_t seenCount = 0;
            for (JsonVariantConst item : selected.as<JsonArrayConst>()) {
                if (!item.is<const char*>()) return false;
                const char* id = item.as<const char*>();
                if (!id || !id[0] || strlen(id) >= sizeof(Config::sessionRegistryInputIds[0]))
                    return false;
                for (uint8_t i = 0; i < seenCount; ++i)
                    if (!strcmp(seen[i], id)) return false;
                seen[seenCount++] = id;
            }
        }
    }

    JsonVariantConst gov = doc["governor"];
    if (present(gov) && (!gov.is<JsonObjectConst>() ||
        !validNumber(gov["target_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(gov["band_rpm"], 0.0f, 1000000000.0f) ||
        !validNumber(gov["kp"], 0.0f, 0.01f) ||
        !validNumber(gov["pitch_kp"], 0.0f, 0.01f) ||
        !validNumber(gov["pitch_ramp_sec"], 0.0f, 3600000.0f))) return false;

    JsonVariantConst glow = doc["glow_plug"];
    if (present(glow) && (!glow.is<JsonObjectConst>() ||
        !validInt(glow["preheat_ms"], 0, 3600000) ||
        !validNumber(glow["preheat_max_pct"], 0.0f, 100.0f) ||
        !validNumber(glow["hold_pct"], 0.0f, 100.0f) ||
        !validBool(glow["wait_until_hot"]))) return false;

    JsonVariantConst rc = doc["rc_input"];
    if (present(rc) && (!rc.is<JsonObjectConst>() ||
        !validInt(rc["failsafe_ms"], 20, 60000))) return false;

    JsonVariantConst misc = doc["misc"];
    if (present(misc) && (!misc.is<JsonObjectConst>() ||
        !validBool(misc["igniter_on_start"]) ||
        !validOptionalStableId(misc["igniter_on_start_output_id"], sizeof(Config::manualRelightOutputId)) ||
        !validInt(misc["igniter_on_start_target"], 0, 2) ||
        !validInt(misc["cooldown_skip_hold_ms"], 0, 60000))) return false;

    // Groups below were read/written but never validated — a restore or raw
    // API write could persist values far outside the UI ranges and only get
    // silently clamped (or not) after load.
    // NOTE: these telemetry bounds MUST mirror the boot-load clamps in
    // _fromDoc (ws>=333, snapshot>=500, control_loop 50..1000) so a value the
    // API accepts is exactly the value that survives the next reboot.
    JsonVariantConst tmv = doc["telemetry"];
    if (present(tmv) && (!tmv.is<JsonObjectConst>() ||
        !validInt(tmv["ws_interval_ms"], 333, 60000) ||
        !validInt(tmv["snapshot_interval_ms"], 500, 3600000) ||
        !validInt(tmv["control_loop_hz"], 50, 1000) ||
        !validBool(tmv["log_standby"]))) return false;

    JsonVariantConst sav = doc["starter_control"];
    if (present(sav) && (!sav.is<JsonObjectConst>() ||
        !validBool(sav["pulsed_assist_enabled"]) ||
        !validNumber(sav["pulsed_assist_pwm_pct"], 0.0f, 100.0f) ||
        !validNumber(sav["pulsed_assist_until_rpm"], 0.0f, 1000000.0f) ||
        !validInt(sav["pulsed_assist_on_ms"], 1, 60000) ||
        !validInt(sav["pulsed_assist_off_ms"], 1, 60000) ||
        !validNumber(sav["startup_ramp_pct_per_s"], 0.0f, 1000.0f))) return false;

    JsonVariantConst oilxv = doc["oil_advanced"];
    if (present(oilxv) && (!oilxv.is<JsonObjectConst>() ||
        !validNumber(oilxv["zero_bar"], 0.0f, 100.0f) ||
        !validNumber(oilxv["deadband_bar"], 0.0f, 100.0f) ||
        !validNumber(oilxv["pump_underflow_delay_ms"], 100.0f, 60000.0f) ||
        !validBool(oilxv["shutdown_on_underflow"]))) return false;
    if (validateHardwareDependencies && (oilxv["shutdown_on_underflow"] | false)) {
        const auto& reg = HardwareConfig::channelRegistry;
        bool monitoredFlow = false;
        for (uint8_t i = 0; i < reg.outputCount && !monitoredFlow; ++i) {
            const auto& out = reg.outputs[i];
            if (!out.installed || !out.hasFlowMonitor) continue;
            const char* inputPurpose = !strcmp(out.purpose, "oil_pump") ? "oil_flow"
                                     : !strcmp(out.purpose, "scavenge_pump") ? "scavenge_flow"
                                     : nullptr;
            if (!inputPurpose) continue;
            for (uint8_t j = 0; j < reg.inputCount; ++j)
                if (reg.inputs[j].installed && !strcmp(reg.inputs[j].purpose, inputPurpose)) {
                    monitoredFlow = true;
                    break;
                }
        }
        if (!monitoredFlow) return false;
    }
    // (standby_oil is validated once above near the top of this function.)

    JsonVariantConst limpv = doc["limp_mode"];
    if (present(limpv) && (!limpv.is<JsonObjectConst>() ||
        !validNumber(limpv["max_throttle_pct"], 0.0f, 100.0f))) return false;

    JsonVariantConst clv = doc["cluster"];
    if (present(clv) && (!clv.is<JsonObjectConst>() ||
        !validBool(clv["enabled"]) ||
        !validNumber(clv["n1_warn_rpm"], 0.0f, 1000000.0f) ||
        !validNumber(clv["n2_warn_rpm"], 0.0f, 1000000.0f) ||
        !validNumber(clv["tot_warn_c"], 0.0f, 100000.0f) ||
        !validNumber(clv["oil_warn_bar"], 0.0f, 1000.0f))) return false;

    JsonVariantConst rhs = doc["rpm_health"];
    if (present(rhs) && (!rhs.is<JsonObjectConst>() ||
        !validNumber(rhs["jump_threshold"], 0.001f, 1000.0f) ||
        !validInt(rhs["zero_stuck_ticks"], 1, 10000))) return false;

    JsonVariantConst rules = doc["rules"];
    if (present(rules)) {
        if (!rules.is<JsonArrayConst>() || rules.size() > Config::MAX_RULES) return false;
        const char* claimedTargets[Config::MAX_RULES] = {};
        size_t claimedTargetCount = 0;
        for (JsonObjectConst rule : rules.as<JsonArrayConst>()) {
            const int kind = rule["kind"] | -1;
            if (!validBool(rule["enabled"]) ||
                !validInt(rule["kind"], 0, 3) ||
                !validInt(rule["op"], 0, 1) ||
                !validNumber(rule["threshold"], -1000000.0f, 1000000.0f) ||
                !validNumber(rule["on_value"], 0.0f, 1.0f) ||
                !validNumber(rule["off_value"], 0.0f, 1.0f) ||
                !validNumber(rule["hysteresis"], 0.0f, 1000000.0f) ||
                !validNumber(rule["input_min"], -1000000.0f, 1000000.0f) ||
                !validNumber(rule["input_max"], -1000000.0f, 1000000.0f) ||
                !validNumber(rule["output_min"], 0.0f, 1.0f) ||
                !validNumber(rule["output_max"], 0.0f, 1.0f) ||
                !validInt(rule["mode_mask"], 1, 15) ||
                !(validateHardwareDependencies
                    ? validRuleId(rule["target"], sizeof(Config::Rule::targetId), ConfigInternal::ruleTargetHandle, ruleActuatorAvailable)
                    : validRequiredStableId(rule["target"], sizeof(Config::Rule::targetId)))) return false;
            if (kind != 3 &&
                !(validateHardwareDependencies
                    ? validRuleId(rule["source"], sizeof(Config::Rule::sourceId), ConfigInternal::ruleSourceHandle, ruleSensorAvailable)
                    : validRequiredStableId(rule["source"], sizeof(Config::Rule::sourceId)))) return false;
            if (kind == 2) {
                const int targetSourceType = rule["target_source_type"] | -1;
                if (!validInt(rule["target_source_type"], 0, 2) ||
                    !validNumber(rule["target_fixed"], -1000000.0f, 1000000.0f) ||
                    !validNumber(rule["target_low"], -1000000.0f, 1000000.0f) ||
                    !validNumber(rule["target_high"], -1000000.0f, 1000000.0f) ||
                    !validNumber(rule["target_input_min"], -1000000.0f, 1000000.0f) ||
                    !validNumber(rule["target_input_max"], -1000000.0f, 1000000.0f) ||
                    !validNumber(rule["response_gain"], 0.0f, 1000.0f) ||
                    !validNumber(rule["integral_gain"], 0.0f, 1000.0f) ||
                    !validNumber(rule["deadband"], 0.0f, 1000000.0f)) return false;
                if (targetSourceType != 0 &&
                    !(validateHardwareDependencies
                        ? validRuleId(rule["target_source"], sizeof(Config::Rule::targetSourceId), ConfigInternal::ruleSourceHandle, ruleSensorAvailable)
                        : validRequiredStableId(rule["target_source"], sizeof(Config::Rule::targetSourceId)))) return false;
                if (targetSourceType == 2 &&
                    rule["target_input_max"].as<float>() == rule["target_input_min"].as<float>()) return false;
            }
            // Shutdown/fault requests are actions, not owned physical outputs.
            // Every other enabled control must be the sole normal owner.
            const char* target = rule["target"] | "";
            const int8_t handle = validateHardwareDependencies
                ? ConfigInternal::ruleTargetHandle(target) : -1;
            // A normal-shutdown request is an edge-like safety action rather
            // than a physical output. It must be driven by a threshold rule,
            // request shutdown when true, remain inactive when false, and only
            // run in states from which the shutdown sequence is meaningful.
            // Enforce this for complete imports as well as normal UI saves.
            if (!strcmp(target, "request_shutdown") &&
                (kind != 0 || rule["on_value"].as<float>() != 1.0f ||
                 rule["off_value"].as<float>() != 0.0f ||
                 (rule["mode_mask"].as<uint8_t>() & ~0x06u) != 0)) return false;
            if (validateHardwareDependencies && (kind == 1 || kind == 2) &&
                !ruleActuatorSupportsVariable(handle)) return false;
            if (validateHardwareDependencies && rule["enabled"].as<bool>()) {
                // A custom definition may replace the ordinary direct owner.
                // The UI withholds outputs whose dedicated turbine controller
                // is active; duplicate definitions are still rejected here.
                if (ruleTargetConflictsWithDedicatedController(handle)) return false;
                if (handle != 13 && handle != 14) {
                    for (size_t i = 0; i < claimedTargetCount; ++i)
                        if (!strcmp(claimedTargets[i], target)) return false;
                    claimedTargets[claimedTargetCount++] = target;
                }
            }
        }
    }

    return true;
}

}

// ── Load ──────────────────────────────────────────────────────
void Config::load() {
    _applyDefaults();
    EngineData::instance().configVersionMismatch = false;

    static constexpr const char* BAK_PATH = "/ecu_config.bak";
    if (!LittleFS.exists(PATH) && LittleFS.exists(BAK_PATH)) {
        if (LittleFS.rename(BAK_PATH, PATH)) {
            Serial.println("[Config] Recovered ecu_config.json from backup");
        }
    }

    if (!LittleFS.exists(PATH)) {
        Serial.println("[Config] No ecu_config.json - generating defaults");
        if (!save()) {
            inhibitStartForConfigWriteFailure();
            return;
        }
        strncpy(profileId, HardwareConfig::profileId, sizeof(profileId) - 1);
        profileId[sizeof(profileId) - 1] = '\0';
        profileMatch = true;
        return;
    }

    File f = LittleFS.open(PATH, "r");
    if (!f) {
        Serial.println("[Config] Failed to open ecu_config.json");
        EngineData::instance().configStorageFault = true;
        strncpy(EngineData::instance().faultDescription,
            "Cannot start: failed to open ecu_config.json.\n"
            "What to do: The config file may be missing or the filesystem is corrupt. "
            "Re-upload the filesystem image (pio run --target uploadfs) or use the web UI "
            "Tools page to reset config to defaults.",
            sizeof(EngineData::instance().faultDescription) - 1);
        EngineData::instance().faultDescription[sizeof(EngineData::instance().faultDescription) - 1] = '\0';
        profileMatch = false;
        return;
    }
    if (f.size() > 196608UL) {
        f.close();
        Serial.println("[Config] ecu_config.json is too large - START inhibited");
        EngineData::instance().configStorageFault = true;
        strlcpy(EngineData::instance().faultDescription,
                "Cannot start: ecu_config.json is unexpectedly large. Use Tools to "
                "export it for diagnosis, then restore a valid engine file or reset configuration.",
                sizeof(EngineData::instance().faultDescription));
        profileMatch = false;
        return;
    }
    // Parse only the settings subtree before Wi-Fi/AsyncTCP reserve their
    // runtime memory. The temporary JSON trees are released before the web
    // server starts, keeping boot deterministic without a second parser path.
    JsonDocument filter;
    filter[SECTION] = true;
    JsonDocument fullDoc;
    DeserializationError err = deserializeJson(
        fullDoc, f, DeserializationOption::Filter(filter));
    f.close();
    if (err) {
        Serial.printf("[Config] JSON parse error: %s\n", err.c_str());
        EngineData::instance().configStorageFault = true;
        strncpy(EngineData::instance().faultDescription,
            "Cannot start: ecu_config.json is corrupted (JSON parse error).\n"
            "What to do: Use the web UI Tools page to reset config to defaults, "
            "or re-upload the filesystem image.",
            sizeof(EngineData::instance().faultDescription) - 1);
        EngineData::instance().faultDescription[sizeof(EngineData::instance().faultDescription) - 1] = '\0';
        profileMatch = false;
        return;
    }

    JsonDocument workDoc;
    if (fullDoc[SECTION].is<JsonObject>()) {
        workDoc.set(fullDoc[SECTION]);
        fullDoc.clear();
        fullDoc.shrinkToFit();
        delay(0);
    } else {
        Serial.println("[Config] Settings missing from ecu_config.json - adding defaults");
        strncpy(profileId, HardwareConfig::profileId, sizeof(profileId) - 1);
        profileId[sizeof(profileId) - 1] = '\0';
        if (!save()) {
            inhibitStartForConfigWriteFailure();
            return;
        }
        profileMatch = true;
        return;
    }

    const char* id = workDoc["profile_id"] | "";
    strncpy(profileId, id, sizeof(profileId) - 1);
    profileId[sizeof(profileId) - 1] = '\0';
    profileMatch = (strcmp(profileId, HardwareConfig::profileId) == 0);
    if (!profileMatch) {
        // Keep web repair available, but do not run with crossed engine sections.
        Serial.printf("[Config] WARNING: settings profile (%s) does not match hardware profile (%s)"
                      " - START inhibited until repaired\n",
                      profileId, HardwareConfig::profileId);
        _applyDefaults();
        strncpy(profileId, HardwareConfig::profileId, sizeof(profileId) - 1);
        profileId[sizeof(profileId) - 1] = '\0';
        inhibitStartForProfileMismatch();
        return;
    }

    uint8_t ver = workDoc["config_version"] | 0;
    if (ver != CONFIG_VERSION) {
        Serial.printf("[Config] Version mismatch (file=%u expected=%u) - new fields use defaults\n",
                      ver, CONFIG_VERSION);
        // Signal the web UI to show a calibration reminder banner
        EngineData::instance().configVersionMismatch = true;
    }

    bool settingsIncomplete = false;
    const char* requiredSections[] = {
        "engine", "oil", "sequence", "throttle", "safety", "calibration"
    };
    for (const char* section : requiredSections) {
        settingsIncomplete |= !workDoc[section].is<JsonObject>();
    }
    _missingRequiredSections = false;
    _fromDoc(workDoc);
    if (settingsIncomplete || _missingRequiredSections) {
        Serial.println("[Config] Completing missing settings sections in ecu_config.json");
        if (!save()) {
            inhibitStartForConfigWriteFailure();
            return;
        }
    }
    if (loadWarning[0]) {
        // Boot-only event-log markers for out-of-cap safety limits (see the
        // accept+warn block in _fromDoc). Emitted here, not in _fromDoc,
        // because boot load runs on Core 1 — the event recorder's only
        // permitted producer core; web uploads (Core 0) get the persistent
        // telemetry notice without an event-log record.
        if (rpmLimit > 500000.0f)
            FlightRecorder::logConfigChange("load_warning:rpm_limit", rpmLimit, 500000.0f);
        if (totLimit > 1400.0f)
            FlightRecorder::logConfigChange("load_warning:tot_limit", totLimit, 1400.0f);
        if (titLimit > 1400.0f)
            FlightRecorder::logConfigChange("load_warning:tit_limit_c", titLimit, 1400.0f);
        if (oilTempLimit > 300.0f)
            FlightRecorder::logConfigChange("load_warning:oil_temp_limit_c", oilTempLimit, 300.0f);
    }
    Serial.printf("[Config] Loaded OK - profile: %s\n", profileId);
}

volatile bool Config::_savePending = false;
volatile bool Config::_runtimeStatsSavePending = false;
volatile uint8_t Config::_runtimeStatsError = 0;
bool Config::_missingRequiredSections = false;
static uint8_t s_configSaveFailures = 0;
static unsigned long s_configSaveRetryAfterMs = 0;

bool Config::acquireStorageWrite() {
    if (!s_configWriteMutex) s_configWriteMutex = xSemaphoreCreateMutex();
    return s_configWriteMutex &&
           xSemaphoreTake(s_configWriteMutex, pdMS_TO_TICKS(2000)) == pdTRUE;
}

void Config::releaseStorageWrite() {
    if (s_configWriteMutex) xSemaphoreGive(s_configWriteMutex);
}

void Config::autoFillNewlyEnabledSafety(bool prevOilTemp,
                                        bool prevFuelPress, bool prevBatt,
                                        bool prevSurge, bool prevHotStart) {
    // For each threshold-based safety: if it just transitioned
    // OFF->ON (user ticked it) and is still active after hardware sanitize (its
    // sensor is present) but its threshold is 0 (= disabled), fill a sane
    // default so a ticked safety can't sit silently off. This runs only on the
    // enable EVENT, so deliberately setting a threshold to 0 later still
    // disables the safety. Each fill is recorded in the event log.
    auto fill = [](bool was, bool now, float& thr, float def, const char* field) {
        if (!was && now && thr <= 0.0f) {
            FlightRecorder::logConfigChange(field, 0.0f, def);
            Serial.printf("[Config] %s enabled with no threshold - auto-set to %.1f\n",
                          field, (double)def);
            thr = def;
        }
    };
    fill(prevOilTemp,   HardwareConfig::safetyOilTempHigh,  oilTempLimit,           120.0f,    "autofill:oil_temp_limit_c");
    fill(prevFuelPress, HardwareConfig::safetyFuelPressLow, fuelPressMin,           0.5f,      "autofill:fuel_press_min_bar");
    fill(prevBatt,      HardwareConfig::safetyBattLow,      battVoltMin,            10.5f,     "autofill:batt_volt_min_v");
    fill(prevSurge,     HardwareConfig::safetySurge,        surgeDetectRpmVariance, 500000.0f, "autofill:surge_variance");
    fill(prevHotStart,  HardwareConfig::safetyHotStart,     preStartEgtLimitC,      150.0f,    "autofill:pre_start_egt_limit_c");
}

void Config::sanitizeForHardware() {
    // An enabled starter-assist mode is an operating command, not merely a
    // tuning value. If a Hardware edit removes its required starter/N1 path
    // (or changes to a non-PWM starter), disarm it while preserving all of its
    // tuning values for later reuse. Leaving it enabled makes the resulting
    // settings fail their own next PATCH validation.
    if (starterAssistEnabled &&
        (!HardwareConfig::hasStarter || HardwareConfig::starterType == 2 ||
         !HardwareConfig::hasN1Rpm)) {
        starterAssistEnabled = false;
    }
    if ((egtSource == 1 && !HardwareConfig::hasTot) ||
        (egtSource == 2 && !HardwareConfig::hasTit)) {
        egtSource = 0;
    }
    // N1 is structurally required for windmilling proof. Keep a missing or
    // ambiguous ignition-device reference enabled and visible for repair;
    // runtime validation reports it and never guesses another physical output.
    if (!HardwareConfig::hasN1Rpm && relightEnabled) {
        relightEnabled = false;
    }
    if ((flameoutSource == 1 && !HardwareConfig::hasFlame) ||
        (flameoutSource == 2 && !HardwareConfig::hasN1Rpm) ||
        (flameoutSource == 3 && effectiveEgtSource() == 0)) {
        flameoutSource = 0;
    }
    if ((relightConfirmSource == 1 && !HardwareConfig::hasFlame) ||
        (relightConfirmSource == 2 && !HardwareConfig::hasN1Rpm) ||
        (relightConfirmSource == 3 && effectiveEgtSource() == 0)) {
        relightConfirmSource = 0;
    }
    if ((relightTriggerSource == 1 && !HardwareConfig::hasFlame) ||
        (relightTriggerSource == 2 && !HardwareConfig::hasN1Rpm) ||
        (relightTriggerSource == 3 && effectiveEgtSource() == 0)) {
        relightTriggerSource = 0;
    }
    const bool hasN1 = HardwareConfig::hasN1Rpm;
    const bool hasN2 = HardwareConfig::hasN2Rpm;
    if ((idleSource == 0 && !hasN1) || (idleSource == 1 && !hasN2) ||
        (idleSource == 2 && !HardwareConfig::hasP1) || (idleSource == 3 && !HardwareConfig::hasP2)) {
        if (hasN1) idleSource = 0;
        else if (hasN2) idleSource = 1;
        else if (HardwareConfig::hasP1) idleSource = 2;
        else if (HardwareConfig::hasP2) idleSource = 3;
    }
    idleUseN2 = idleSource == 1;
    if (!hasN1 && !hasN2) {
        standbyOilSource = 0;
    } else if (standbyOilSource == 0 && !hasN1) {
        standbyOilSource = 1;
    } else if (standbyOilSource == 1 && !hasN2) {
        standbyOilSource = 0;
    }
    if (!HardwareConfig::hasN1Rpm) sessionLogMask &= ~SLOG_N1;
    if (!HardwareConfig::hasN2Rpm) sessionLogMask &= ~SLOG_N2;
    if (!HardwareConfig::hasTot) sessionLogMask &= ~SLOG_TOT;
    if (!HardwareConfig::hasOilTemp) sessionLogMask &= ~SLOG_OIL_TEMP;
    if (!HardwareConfig::hasOilPress) sessionLogMask &= ~SLOG_OIL;
    if (!HardwareConfig::hasP1) sessionLogMask &= ~SLOG_P1;
    if (!HardwareConfig::hasP2) sessionLogMask &= ~SLOG_P2;
    if (!HardwareConfig::hasThrottle) sessionLogMask &= ~SLOG_THR;
    if (!HardwareConfig::hasTit) sessionLogMask &= ~SLOG_TIT;
    if (!HardwareConfig::hasBattVoltage) sessionLogMask &= ~SLOG_BATT;
    if (!HardwareConfig::hasFuelPress) sessionLogMask &= ~SLOG_FUEL_PRESS;
    if (!HardwareConfig::hasFuelFlow) sessionLogMask &= ~SLOG_FUEL_FLOW;
    if (!HardwareConfig::hasGlowPlug) sessionLogMask &= ~SLOG_GLOW;
    if (!(HardwareConfig::hasGlowPlug && HardwareConfig::glowPlugType == 2 &&
          HardwareConfig::wetGlowFuelPin >= 0)) sessionLogMask &= ~SLOG_WET_GLOW;
    if (!(HardwareConfig::hasGlowPlug && HardwareConfig::hasGlowCurrentSensor)) sessionLogMask &= ~SLOG_GLOW_CURRENT;
    if (!(HardwareConfig::hasIgniter && HardwareConfig::hasIgniterCurrentSensor)) sessionLogMask &= ~SLOG_IGN_CURRENT;
    if (!(HardwareConfig::hasIgniter2 && HardwareConfig::hasIgniter2CurrentSensor)) sessionLogMask &= ~SLOG_IGN2_CURRENT;
    if (!(HardwareConfig::hasOilPump && HardwareConfig::hasOilPumpCurrentSensor)) sessionLogMask &= ~SLOG_OIL_CURRENT;
    if (!HardwareConfig::hasFuelPump2) sessionLogMask &= ~SLOG_FP2;
    if (!HardwareConfig::hasAfterburner) sessionLogMask &= ~SLOG_AB;
    if (!HardwareConfig::hasPropPitch) sessionLogMask &= ~SLOG_PROP;
    if (!HardwareConfig::hasOilPump) sessionLogMask &= ~SLOG_OIL_PCT;
    if (!HardwareConfig::hasTorque) sessionLogMask &= ~SLOG_TORQUE;
    if (!HardwareConfig::hasThrust) sessionLogMask &= ~SLOG_THRUST;
    if (!HardwareConfig::hasStarter) sessionLogMask &= ~SLOG_STARTER;

    int out = 0;
    uint8_t claimedTargets[MAX_RULES] = {};
    int claimedTargetCount = 0;
    for (int i = 0; i < ruleCount; i++) {
        Rule r = rules[i];
        if ((r.kind != 3 && !ruleSensorAvailable(r.sensor)) || !ruleActuatorAvailable(r.actuator)) continue;
        if (r.kind == 2 && r.targetSourceType != 0 && !ruleSensorAvailable(r.targetSensor)) continue;
        if ((r.kind == 1 || r.kind == 2) && !ruleActuatorSupportsVariable(r.actuator)) continue;
        // Afterburner fuel remains owned by its ignition/running state
        // machine. Other fitted outputs may use a custom normal owner when
        // their dedicated controller is not selected in the UI.
        if (ruleTargetConflictsWithDedicatedController(r.actuator)) continue;
        bool duplicateTarget = false;
        if (r.actuator != 13 && r.actuator != 14) {
            for (int j = 0; j < claimedTargetCount; ++j)
                if (claimedTargets[j] == r.actuator) { duplicateTarget = true; break; }
        }
        if (duplicateTarget) continue;
        r.kind = constrain(r.kind, 0, 3);
        r.op = constrain(r.op, 0, 1);
        r.onValue = constrain(r.onValue, 0.0f, 1.0f);
        r.offValue = constrain(r.offValue, 0.0f, 1.0f);
        r.outputMin = constrain(r.outputMin, 0.0f, 1.0f);
        r.outputMax = constrain(r.outputMax, 0.0f, 1.0f);
        r.targetSourceType = constrain(r.targetSourceType, 0, 2);
        if (!isfinite(r.targetFixed) || !isfinite(r.targetLow) || !isfinite(r.targetHigh)) continue;
        if (r.targetSourceType == 2 && (!isfinite(r.targetInputMin) ||
            !isfinite(r.targetInputMax) || r.targetInputMax == r.targetInputMin)) continue;
        if (!isfinite(r.responseGain) || r.responseGain < 0.0f ||
            !isfinite(r.integralGain) || r.integralGain < 0.0f ||
            !isfinite(r.deadband) || r.deadband < 0.0f) continue;
        if (r.kind == 1 && (!isfinite(r.inputMin) || !isfinite(r.inputMax) || r.inputMax == r.inputMin)) continue;
        if (r.hysteresis < 0.0f) r.hysteresis = 0.0f;
        r.modeMask &= 0x0F;
        if (r.modeMask == 0) continue;
        if (r.actuator == RulesEngine::THROTTLE) {
            const float calibratedMinimum = constrain(fuelPumpMinPct / 100.0f, 0.0f, 1.0f);
            if (r.onValue > 0.0f) r.onValue = max(r.onValue, calibratedMinimum);
            r.outputMin = max(r.outputMin, calibratedMinimum);
            r.outputMax = max(r.outputMax, r.outputMin);
        }
        if (r.actuator != 13 && r.actuator != 14)
            claimedTargets[claimedTargetCount++] = r.actuator;
        rules[out++] = r;
    }
    for (int i = out; i < MAX_RULES; i++) rules[i] = {};
    ruleCount = out;
}

class ConfigStorageWriteRelease {
public:
    ~ConfigStorageWriteRelease() { Config::releaseStorageWrite(); }
};

void Config::requestSave() {
    // Called from Core 1 — sets a flag only, zero file I/O.
    // Core 0 picks this up in flushPendingSave() via WebServer::tick() once
    // the ECU reaches STANDBY/FAULT. Flash access can suspend both cores.
    s_configSaveFailures = 0;
    s_configSaveRetryAfterMs = 0;
    _savePending = true;
}

bool Config::flushPendingSave() {
    if (!_savePending) return false;
    if (s_configSaveRetryAfterMs != 0 &&
        static_cast<long>(millis() - s_configSaveRetryAfterMs) < 0) return false;
    _savePending = false;
    bool ok = save();
    if (!ok) {
        ++s_configSaveFailures;
        if (s_configSaveFailures < 3) {
            s_configSaveRetryAfterMs = millis() + 1000UL * s_configSaveFailures;
            _savePending = true;
            Serial.println("[Config] WARNING: deferred config save failed; retry scheduled");
        } else {
            s_configSaveRetryAfterMs = 0;
            EngineData::instance().configStorageFault = true;
            Serial.println("[Config] ERROR: deferred config save failed three times; retry stopped");
        }
    } else {
        s_configSaveFailures = 0;
        s_configSaveRetryAfterMs = 0;
    }
    return ok;
}

void Config::requestRuntimeStatsSave() {
    _runtimeStatsSavePending = true;
}

static void runtimeStatsKey(char* key, size_t len, const char* prefix) {
    const char* profile = Config::profileId[0] ? Config::profileId : HardwareConfig::profileId;
    uint32_t hash = 2166136261u;
    for (const char* p = profile; p && *p; ++p) {
        hash ^= (uint8_t)*p;
        hash *= 16777619u;
    }
    snprintf(key, len, "%s%08lx", prefix, (unsigned long)hash);
}

void Config::loadRuntimeStats() {
    char runKey[14];
    char startKey[14];
    char rcKey[14];
    runtimeStatsKey(runKey, sizeof(runKey), "run");
    runtimeStatsKey(startKey, sizeof(startKey), "sta");
    runtimeStatsKey(rcKey, sizeof(rcKey), "rct");
    Preferences stats;
    if (!stats.begin("ot", true)) {
        Serial.println("[Config] WARNING: failed to open NVS for accumulated runtime read");
        return;
    }
    uint32_t savedRunSeconds = stats.getUInt(runKey, totalRunSeconds);
    uint32_t savedStarts = stats.getUInt(startKey, startAttemptCount);
    uint32_t savedRuns = stats.getUInt(rcKey, runCount);
    stats.end();
    if (savedRunSeconds > totalRunSeconds) totalRunSeconds = savedRunSeconds;
    if (savedStarts > startAttemptCount) startAttemptCount = savedStarts;
    if (savedRuns > runCount) runCount = savedRuns;
}

bool Config::flushPendingRuntimeStats() {
    if (!_runtimeStatsSavePending) return false;
    static uint32_t lastAttemptMs = 0;
    static uint32_t retryDelayMs = 1000;
    const uint32_t now = millis();
    if (lastAttemptMs && now - lastAttemptMs < retryDelayMs) return false;
    lastAttemptMs = now;
    char runKey[14];
    char startKey[14];
    char rcKey[14];
    runtimeStatsKey(runKey, sizeof(runKey), "run");
    runtimeStatsKey(startKey, sizeof(startKey), "sta");
    runtimeStatsKey(rcKey, sizeof(rcKey), "rct");
    Preferences stats;
    if (!stats.begin("ot", false)) {
        _runtimeStatsError = 1;
        retryDelayMs = retryDelayMs < 15000 ? retryDelayMs * 2 : 30000;
        Serial.println("[Config] WARNING: failed to open NVS for accumulated runtime");
        return false;
    }
    size_t writtenRun = stats.putUInt(runKey, totalRunSeconds);
    size_t writtenStarts = stats.putUInt(startKey, startAttemptCount);
    size_t writtenRuns = stats.putUInt(rcKey, runCount);
    stats.end();
    if (writtenRun == 0 || writtenStarts == 0 || writtenRuns == 0) {
        _runtimeStatsError = 2;
        retryDelayMs = retryDelayMs < 15000 ? retryDelayMs * 2 : 30000;
        Serial.println("[Config] WARNING: accumulated runtime NVS write failed");
        return false;
    }
    _runtimeStatsSavePending = false;
    _runtimeStatsError = 0;
    retryDelayMs = 1000;
    return true;
}

int Config::effectiveEgtSource() {
    if (egtSource == 1 && HardwareConfig::hasTot) return 1;
    if (egtSource == 2 && HardwareConfig::hasTit) return 2;
    if (HardwareConfig::hasTot) return 1;
    if (HardwareConfig::hasTit) return 2;
    return 0;
}

bool Config::primaryEgtHealthy(const EngineData& ed) {
    switch (effectiveEgtSource()) {
        case 1: return ed.totHealthy;
        case 2: return ed.titHealthy;
        default: return false;
    }
}

float Config::primaryEgtC(const EngineData& ed) {
    switch (effectiveEgtSource()) {
        case 1: return ed.tot;
        case 2: return ed.tit;
        default: return 0.0f;
    }
}

float Config::primaryEgtLimitC() {
    switch (effectiveEgtSource()) {
        case 1: return totLimit;
        case 2: return titLimit;
        default: return 0.0f;
    }
}

const char* Config::primaryEgtLabel() {
    switch (effectiveEgtSource()) {
        case 1: return "TOT";
        case 2: return "TIT";
        default: return "EGT";
    }
}

float Config::effectiveRelightMinRpm() {
    // relightMinRpm remains independently tunable, but automatic ignition
    // must never be fired below the engine's configured minimum
    // running/self-sustained N1 speed.
    return fmaxf(relightMinRpm, minRpm);
}

bool Config::clearRuntimeStats() {
    char runKey[14];
    char startKey[14];
    char rcKey[14];
    runtimeStatsKey(runKey, sizeof(runKey), "run");
    runtimeStatsKey(startKey, sizeof(startKey), "sta");
    runtimeStatsKey(rcKey, sizeof(rcKey), "rct");
    Preferences stats;
    if (!stats.begin("ot", false)) {
        Serial.println("[Config] WARNING: failed to open NVS to clear accumulated runtime");
        return false;
    }
    stats.remove(runKey);
    stats.remove(startKey);
    stats.remove(rcKey);
    const bool cleared = !stats.isKey(runKey) && !stats.isKey(startKey) && !stats.isKey(rcKey);
    stats.end();
    if (!cleared) {
        Serial.println("[Config] WARNING: accumulated runtime keys remain after erase");
        return false;
    }
    portENTER_CRITICAL(&ConfigInternal::statsMux);
    totalRunSeconds = 0;
    startAttemptCount = 0;
    runCount = 0;
    portEXIT_CRITICAL(&ConfigInternal::statsMux);
    return true;
}

void Config::addRunSeconds(uint32_t seconds) {
    portENTER_CRITICAL(&ConfigInternal::statsMux);
    totalRunSeconds += seconds;
    portEXIT_CRITICAL(&ConfigInternal::statsMux);
}

void Config::incStartAttemptCount() {
    portENTER_CRITICAL(&ConfigInternal::statsMux);
    startAttemptCount = startAttemptCount + 1u;
    portEXIT_CRITICAL(&ConfigInternal::statsMux);
}

void Config::incRunCount() {
    portENTER_CRITICAL(&ConfigInternal::statsMux);
    runCount = runCount + 1u;
    portEXIT_CRITICAL(&ConfigInternal::statsMux);
}

bool Config::save(bool writeRuntimeHardware) {
    return _saveSettingsJson(nullptr, 0, writeRuntimeHardware);
}

bool Config::saveStagedJsonCandidate(size_t settingsLen,
                                     bool writeRuntimeHardware) {
    if (settingsLen == 0 || settingsLen > 32768) return false;
    return _saveSettingsJson(nullptr, settingsLen, writeRuntimeHardware);
}

// Copy one top-level object from the existing unified engine file without
// materialising it as an ArduinoJson tree. Settings-only PATCH writes leave
// hardware unchanged, and a fully populated registry can otherwise consume
// the Wi-Fi driver's remaining heap while the settings candidate is resident.
// Locate and validate the complete object first, then copy its exact bytes so
// a malformed source can fall back without leaving a partial destination.
static bool copyUnifiedObject(File& source, Print& destination, const char* section) {
    if (!source || !section || !section[0]) return false;
    int depth = 0;
    bool inString = false;
    bool escaped = false;
    bool expectingKey = false;
    bool capturingKey = false;
    char key[24] = {};
    size_t keyLen = 0;
    bool found = false;
    while (source.available()) {
        const char ch = static_cast<char>(source.read());
        if (inString) {
            if (escaped) {
                escaped = false;
                if (capturingKey && keyLen + 1 < sizeof(key)) key[keyLen++] = ch;
            } else if (ch == '\\') {
                escaped = true;
            } else if (ch == '"') {
                inString = false;
                if (capturingKey) {
                    key[keyLen] = '\0';
                    found = strcmp(key, section) == 0;
                    capturingKey = false;
                    expectingKey = false;
                    if (found) break;
                }
            } else if (capturingKey && keyLen + 1 < sizeof(key)) {
                key[keyLen++] = ch;
            }
            continue;
        }
        if (ch == '"') {
            inString = true;
            escaped = false;
            capturingKey = depth == 1 && expectingKey;
            keyLen = 0;
        } else if (ch == '{') {
            ++depth;
            if (depth == 1) expectingKey = true;
        } else if (ch == '}') {
            --depth;
        } else if (ch == ',' && depth == 1) {
            expectingKey = true;
        }
    }
    if (!found) return false;

    int next = -1;
    do { next = source.read(); } while (next >= 0 && isspace(next));
    if (next != ':') return false;
    do { next = source.read(); } while (next >= 0 && isspace(next));
    if (next != '{') return false;
    const size_t objectStart = source.position() - 1;

    int objectDepth = 1;
    inString = false;
    escaped = false;
    while (objectDepth > 0 && source.available()) {
        const char ch = static_cast<char>(source.read());
        if (inString) {
            if (escaped) escaped = false;
            else if (ch == '\\') escaped = true;
            else if (ch == '"') inString = false;
        } else if (ch == '"') {
            inString = true;
        } else if (ch == '{') {
            ++objectDepth;
        } else if (ch == '}') {
            --objectDepth;
        }
    }
    if (objectDepth != 0 || inString) return false;
    const size_t objectEnd = source.position();
    if (objectEnd <= objectStart || !source.seek(objectStart)) return false;

    uint8_t buffer[256];
    size_t remaining = objectEnd - objectStart;
    while (remaining > 0) {
        const size_t wanted = min(remaining, sizeof(buffer));
        const size_t got = source.read(buffer, wanted);
        if (got != wanted || destination.write(buffer, got) != got) return false;
        remaining -= got;
    }
    return true;
}

bool Config::copyStoredSettings(Print& destination) {
    File source = LittleFS.open(PATH, "r");
    return source && copyUnifiedObject(source, destination, SECTION);
}

bool Config::_saveSettingsJson(const char* settingsJson, size_t settingsLen,
                               bool writeRuntimeHardware) {
    static constexpr const char* TMP_PATH = "/ecu_config.tmp";
    static constexpr const char* BAK_PATH = "/ecu_config.bak";
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
    static constexpr const char* APPLY_PATH = "/config_apply.tmp";
    const bool hasStagedSettings = settingsLen > 0;
#endif
    if (!acquireStorageWrite()) {
        Serial.println("[Config] Timed out waiting to write ecu_config.json");
        return false;
    }
    ConfigStorageWriteRelease release;

#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
    // Keep an exact, bounded copy for the ECU core. Mutable-buffer parsing is
    // normally zero-copy, but a fully configured Classic ESP32 may not have a
    // large enough contiguous block until that transfer buffer is released.
    // This file is transaction scratch only; boot never consumes it.
    if (settingsJson) {
        File apply = LittleFS.open(APPLY_PATH, "w");
        const bool applyOk = apply && settingsLen > 0 &&
            apply.write(reinterpret_cast<const uint8_t*>(settingsJson), settingsLen) == settingsLen;
        if (apply) apply.close();
        if (!applyOk) {
            LittleFS.remove(APPLY_PATH);
            Serial.println("[Config] Failed to stage Classic runtime candidate");
            return false;
        }
    }
#endif

    // Stream the two authoritative runtime sections separately. A fully fitted
    // hardware tree plus settings cannot coexist in one ArduinoJson document
    // on a fragmented Classic ESP32 heap. Both runtime sections were validated
    // before reaching save(), and the temp/backup rename below remains atomic.
    File fw = LittleFS.open(TMP_PATH, "w");
    if (!fw) {
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
        if (hasStagedSettings) LittleFS.remove(APPLY_PATH);
#endif
        Serial.println("[Config] Failed to open ecu_config.tmp for write");
        return false;
    }
    bool ok = fw.print("{\"hardware\":") == strlen("{\"hardware\":");
    JsonDocument section;
    bool copiedHardware = false;
    const bool hadSourceConfig = LittleFS.exists(PATH);
    if (!writeRuntimeHardware && hadSourceConfig && ok) {
        File current = LittleFS.open(PATH, "r");
        copiedHardware = current && copyUnifiedObject(current, fw, "hardware");
        if (current) current.close();
    }
    if (!copiedHardware) {
        // A settings-only update must never synthesize a replacement for an
        // existing hardware section. LittleFS.open()/seek() can temporarily
        // fail on a memory-starved Classic ESP32; rebuilding Hardware while
        // the web request is resident can then overflow ArduinoJson and used
        // to commit a valid-looking but truncated section. Preserve the old
        // unified file and let the UI retry instead.
        if (hadSourceConfig && !writeRuntimeHardware) {
            ok = false;
            Serial.println("[Config] Refusing settings save: existing hardware section could not be copied");
        } else {
            HardwareConfig::toJson(section, false);
            if (section.overflowed()) {
                ok = false;
                Serial.println("[Config] Refusing settings save: generated hardware JSON overflowed");
            } else {
                const size_t hardwareExpected = measureJson(section);
                ok &= serializeJson(section, fw) == hardwareExpected;
            }
        }
    }
    section.clear();
    section.shrinkToFit();
    delay(0);

    ok &= fw.print(",\"settings\":") == strlen(",\"settings\":");
    if (settingsJson) {
        ok &= settingsLen > 0 && fw.write((const uint8_t*)settingsJson, settingsLen) == settingsLen;
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
    } else if (hasStagedSettings) {
        File staged = LittleFS.open(APPLY_PATH, "r");
        size_t remaining = settingsLen;
        uint8_t buffer[256];
        while (staged && remaining > 0 && ok) {
            const size_t wanted = min(remaining, sizeof(buffer));
            const size_t got = staged.read(buffer, wanted);
            ok &= got == wanted && fw.write(buffer, got) == got;
            remaining -= got;
        }
        ok &= staged && remaining == 0 && staged.available() == 0;
        if (staged) staged.close();
#endif
    } else {
        _writeDoc(section.to<JsonObject>());
        if (section.overflowed()) {
            ok = false;
            Serial.println("[Config] Refusing settings save: generated settings JSON overflowed");
        } else {
            const size_t settingsExpected = measureJson(section);
            ok &= serializeJson(section, fw) == settingsExpected;
        }
    }
    ok &= fw.print('}') == 1;
    const size_t writtenSize = fw.position();
    fw.close();
    if (ok) {
        // Every source tree was validated before this writer was entered and
        // every serialization/copy above checked its exact byte count. Do not
        // allocate and parse a second ArduinoJson tree merely to rediscover
        // three fields already held in the authoritative runtime: a complete
        // Classic restore can legitimately have no contiguous block left for
        // that redundant parse. Reopen only to prove LittleFS retained the
        // complete byte stream, then confirm the runtime identities that were
        // serialized still match. Atomic rename/backup below remains the final
        // commit boundary.
        File candidate = LittleFS.open(TMP_PATH, "r");
        const bool completeSize = candidate && writtenSize >= 32 &&
                                  candidate.size() == writtenSize;
        if (candidate) candidate.close();
        if (!completeSize || !HardwareConfig::profileId[0] || !profileId[0] ||
            strcmp(HardwareConfig::profileId, profileId) != 0) {
            ok = false;
            Serial.println("[Config] Refusing settings save: unified candidate failed structural verification");
        }
    }
    if (!ok) {
        LittleFS.remove(TMP_PATH);
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
        if (hasStagedSettings) LittleFS.remove(APPLY_PATH);
#endif
        Serial.println("[Config] Incomplete write to ecu_config.tmp");
        return false;
    }

    // Keep the previous valid file available for recovery until replacement succeeds.
    LittleFS.remove(BAK_PATH);
    bool hadOriginal = LittleFS.exists(PATH);
    if (hadOriginal && !LittleFS.rename(PATH, BAK_PATH)) {
        LittleFS.remove(TMP_PATH);
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
        if (hasStagedSettings) LittleFS.remove(APPLY_PATH);
#endif
        Serial.println("[Config] failed to preserve previous ecu_config.json");
        return false;
    }
    if (!LittleFS.rename(TMP_PATH, PATH)) {
        Serial.println("[Config] rename ecu_config.tmp failed");
        const bool restored = !hadOriginal || LittleFS.rename(BAK_PATH, PATH);
        LittleFS.remove(TMP_PATH);
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
        if (hasStagedSettings) LittleFS.remove(APPLY_PATH);
#endif
        if (!restored) {
            // Keep ecu_config.bak: load() can recover it on a later boot once
            // the filesystem is writable again.
            Serial.println("[Config] rollback failed; preserving ecu_config.bak for boot recovery");
        }
        return false;
    }
    if (hadOriginal) LittleFS.remove(BAK_PATH);
    return true;
}

bool Config::isLocked() {
    auto& ed = EngineData::instance();
    auto m = ed.mode;
    bool active = (m == SysMode::STARTUP || m == SysMode::RUNNING || m == SysMode::SHUTDOWN);
    // This reports whether the complete configuration is locked. Developer
    // Mode opens only the explicitly whitelisted live-tuning PATCH window in
    // RUNNING; it never makes STARTUP/SHUTDOWN or the full config writable.
    return active;
}

size_t Config::toJson(char* buf, size_t len) {
    JsonDocument doc;
    _toDoc(doc);
    const size_t required = measureJson(doc);
    if (!buf || len == 0 || required >= len) {
        if (buf && len) buf[0] = '\0';
        return len;  // explicit overflow sentinel for bounded-buffer callers
    }
    return serializeJson(doc, buf, len);
}

void Config::toJson(JsonDocument& doc) {
    _toDoc(doc);
}

bool Config::validateJson(const char* json, size_t len) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json, len);
    if (err) return false;
    return validateJson(doc);
}

bool Config::validateJson(const JsonDocument& doc) {
    if (!validateSettingsDoc(doc, true)) return false;
    if (HardwareConfig::hasDynamicIdle) {
        const int source = doc["dynamic_idle"]["source"] | 0;
        if ((source == 0 && !HardwareConfig::hasN1Rpm) ||
            (source == 1 && !HardwareConfig::hasN2Rpm) ||
            (source == 2 && !HardwareConfig::hasP1) ||
            (source == 3 && !HardwareConfig::hasP2)) return false;
    }
    if (doc["starter_control"]["pulsed_assist_enabled"] | false) {
        if (!HardwareConfig::hasStarter || HardwareConfig::starterType == 2 ||
            !HardwareConfig::hasN1Rpm) return false;
    }
    return true;
}

bool Config::validateJsonValues(const JsonDocument& doc) {
    // A complete engine-file restore validates settings before its uploaded
    // hardware is resident. Range/schema checks are portable; sequence and
    // fitted-device dependencies are checked against the uploaded hardware
    // after both runtime sections have been applied.
    return validateSettingsDoc(doc, false);
}

bool Config::validateRuntimeHardwareDependencies() {
    auto sequenceContains = [](char sequence[][24], int count, const char* name) {
        for (int i = 0; i < count; ++i) if (!strcmp(sequence[i], name)) return true;
        return false;
    };
    if (sequenceContains(HardwareConfig::startupSeq, HardwareConfig::startupSeqLen, "OilPrime") &&
        startupOilArmTimeoutMs < 500) return false;
    if ((sequenceContains(HardwareConfig::startupSeq, HardwareConfig::startupSeqLen, "WaitForInput") ||
         sequenceContains(HardwareConfig::startupSeq, HardwareConfig::startupSeqLen, "WaitForInputOff")) &&
        waitForInputTimeoutMs < 500) return false;
    if (sequenceContains(HardwareConfig::startupSeq, HardwareConfig::startupSeqLen, "SafetyHold") &&
        (safetyHoldMs < 100 || safetyHoldTimeoutMs < 100)) return false;
    if (sequenceContains(HardwareConfig::shutdownSeq, HardwareConfig::shutdownSeqLen, "RPMDrop") &&
        shutdownRpmDropTimeoutMs < 1000) return false;
    if (sequenceContains(HardwareConfig::shutdownSeq, HardwareConfig::shutdownSeqLen, "CooldownSpin") &&
        shutdownCooldownTimeoutMs < 1000) return false;
    if (sequenceContains(HardwareConfig::shutdownSeq, HardwareConfig::shutdownSeqLen, "FinalStop") &&
        shutdownFinalStopTimeoutMs < 1000) return false;
    if (HardwareConfig::hasDynamicIdle &&
        ((idleSource == 0 && !HardwareConfig::hasN1Rpm) ||
         (idleSource == 1 && !HardwareConfig::hasN2Rpm) ||
         (idleSource == 2 && !HardwareConfig::hasP1) ||
         (idleSource == 3 && !HardwareConfig::hasP2))) return false;
    if (starterAssistEnabled &&
        (!HardwareConfig::hasStarter || HardwareConfig::starterType == 2 ||
         !HardwareConfig::hasN1Rpm)) return false;
    return true;
}

bool Config::resolveRuleHandlesForHardware() {
    for (int i = 0; i < ruleCount; ++i) {
        Rule& rule = rules[i];
        const int8_t source = rule.kind == 3 ? 0 :
            ConfigInternal::ruleSourceHandle(rule.sourceId);
        const int8_t target = ConfigInternal::ruleTargetHandle(rule.targetId);
        const int8_t targetSource = rule.targetSourceType == 0 ? 0 :
            ConfigInternal::ruleSourceHandle(rule.targetSourceId);
        if (source < 0 || target < 0 || targetSource < 0) return false;
        rule.sensor = (uint8_t)source;
        rule.actuator = (uint8_t)target;
        rule.targetSensor = (uint8_t)targetSource;
    }
    return true;
}

DeserializationError Config::loadStagedJsonCandidate(JsonDocument& doc) {
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
    static constexpr const char* APPLY_PATH = "/config_apply.tmp";
    // LittleFS.open() allocates VFS/shared-file state. Avoid an uncaught
    // bad_alloc/abort while a fragmented Classic heap is recovering; the
    // caller already treats NoMemory as a bounded retry condition.
    if (ESP.getMaxAllocHeap() < 4096) return DeserializationError::NoMemory;
    if (!acquireStorageWrite()) return DeserializationError::NoMemory;
    ConfigStorageWriteRelease release;
    File staged = LittleFS.open(APPLY_PATH, "r");
    if (!staged) return DeserializationError::InvalidInput;
    const DeserializationError error = deserializeJson(doc, staged);
    staged.close();
    if (error != DeserializationError::Ok) {
        Serial.printf("[Config] Staged runtime candidate parse failed: %s\n", error.c_str());
    }
    return error;
#else
    (void)doc;
    return DeserializationError::InvalidInput;
#endif
}

void Config::clearStagedJsonCandidate() {
#if defined(OT_PLATFORM_ESP32) || defined(OT_PLATFORM_ESP32S3)
    static constexpr const char* APPLY_PATH = "/config_apply.tmp";
    if (!acquireStorageWrite()) return;
    ConfigStorageWriteRelease release;
    LittleFS.remove(APPLY_PATH);
#endif
}

bool Config::fromJson(const char* json, size_t len) {
    if (isLocked() || !validateJson(json, len)) return false;
    JsonDocument doc;
    if (deserializeJson(doc, json, len)) return false;
    if (strcmp(doc["profile_id"] | "", HardwareConfig::profileId) != 0) return false;
    JsonDocument previous;
    _toDoc(previous);
    bool previousMismatch = EngineData::instance().configVersionMismatch;
    _fromDoc(doc);
    if (!save()) {
        _fromDoc(previous);
        EngineData::instance().configVersionMismatch = previousMismatch;
        return false;
    }
    profileMatch = true;
    EngineData::instance().configVersionMismatch = false;
    return true;
}

bool Config::fromJson(const JsonDocument& doc) {
    if (isLocked() || !validateJson(doc)) return false;
    const char* id = doc["profile_id"] | "";
    if (!id[0] || strcmp(id, HardwareConfig::profileId) != 0) return false;
    JsonDocument previous;
    _toDoc(previous);
    bool previousMismatch = EngineData::instance().configVersionMismatch;
    _fromDoc(doc);
    if (!save()) {
        _fromDoc(previous);
        EngineData::instance().configVersionMismatch = previousMismatch;
        return false;
    }
    profileMatch = true;
    EngineData::instance().configVersionMismatch = false;
    return true;
}
