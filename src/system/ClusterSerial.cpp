#include "ClusterSerial.h"
#include "CommandQueue.h"
#include "Config.h"
#include "HardwareConfig.h"
#include <Arduino.h>
#include <math.h>
#include <string.h>

unsigned long ClusterSerial::_lastDataMs      = 0;
SysMode       ClusterSerial::_lastMode        = SysMode::STANDBY;
uint8_t       ClusterSerial::_lastClusterCode = 0;
uint8_t       ClusterSerial::_lastStatusCode  = 0;
bool          ClusterSerial::_totWarnActive   = false;
bool          ClusterSerial::_oilWarnActive   = false;
bool          ClusterSerial::_schemaDirty     = true;
uint8_t       ClusterSerial::_seq             = 0;
char          ClusterSerial::_rxLine[168]     = {};
uint8_t       ClusterSerial::_rxLen           = 0;
bool          ClusterSerial::_rxOverflow      = false;
unsigned long ClusterSerial::_lastSchemaMs    = 0;
unsigned long ClusterSerial::_nextSchemaMs    = 0;
bool          ClusterSerial::_begun           = false;

// Use UART1 for the cluster link. MAVLinkOutput owns its own UART2 object.
static HardwareSerial _port(1);

namespace {
uint64_t g_subscriptionMaskLo = 0;
uint64_t g_subscriptionMaskHi = 0;
bool g_subscriptionActive = false;
uint8_t g_telemetryCursor = 0;

enum FrameType : uint8_t {
    FT_HELLO      = 1,
    FT_FIELD_DEF  = 2,
    FT_LIMITS     = 3,
    FT_TELEMETRY  = 4,
    FT_STATUS     = 5,
    FT_EVENT      = 6,
    FT_ACK        = 7,
    FT_SCHEMA_END = 8,
    FT_STATUS_DEF = 9,
};

enum Capability : uint16_t {
    CAP_SCHEMA        = 1u << 0,
    CAP_TELEMETRY     = 1u << 1,
    CAP_RX_COMMANDS   = 1u << 2,
    CAP_SUBSCRIPTIONS = 1u << 3,
};

enum FieldId : uint8_t {
    F_N1_RPM = 1,
    F_N2_RPM,
    F_TOT_C,
    F_TIT_C,
    F_OIL_BAR,
    F_OIL_TEMP_C,
    F_FUEL_PRESS_BAR,
    F_FUEL_FLOW,
    F_P1_BAR,
    F_P2_BAR,
    F_BATT_V,
    F_TORQUE_NM,
    F_POWER_W,
    F_THROTTLE_PCT,
    F_STARTER_PCT,
    F_OIL_PUMP_PCT,
    F_FUEL_PUMP2_PCT,
    F_AB_PUMP_PCT,
    F_PROP_PITCH_PCT,
    F_GLOW_PCT,
    F_MODE,
    F_AB_MODE,
    F_TOT_RATE,
    F_OIL_TARGET_BAR,
    F_FUEL_SOL,
    F_IGNITER1,
    F_IGNITER2,
    F_STARTER_ENABLE,
    F_COOL_FAN,
    F_AIRSTARTER,
    F_OIL_SCAVENGE,
    F_BLEED_VALVE,
    F_AB_SOL,
    F_AB_TRIGGER,
    F_AB_ARM,
    F_AB_FLAME,
    F_STOP_SWITCH,
    F_START_SWITCH,
    F_DYNAMIC_IDLE,
    F_LIMP_MODE,
    F_BENCH_MODE,
    F_DEV_MODE,
    F_RELIGHT,
    F_STANDBY_OIL,
    F_OIL_FAILSAFE,
    F_OIL_OVERCURRENT,
    F_GLOW_CURRENT_A,
    F_IGNITER1_CURRENT_A,
    F_IGNITER2_CURRENT_A,
    F_OIL_PUMP_CURRENT_A,
    F_THROTTLE_INPUT_RAW,
    F_IDLE_INPUT_RAW,
    F_AB_INPUT_RAW,
    F_AB_INPUT_NORM,
    F_MAX_N1_RPM,
    F_MAX_N2_RPM,
    F_MAX_TOT_C,
    F_MAX_TIT_C,
    F_MAX_OIL_TEMP_C,
    F_MAX_FUEL_PRESS_BAR,
    F_MAX_BATT_V,
    F_RUN_COUNT,
    F_BOOT_COUNT,
    F_UPTIME_MS,
    F_DI1,
    F_DI2,
    F_DI3,
    F_DI4,
    F_THRUST_N,
};

enum UnitId : uint8_t {
    U_NONE = 0,
    U_RPM,
    U_DEG_C,
    U_BAR,
    U_VOLT,
    U_NM,
    U_WATT,
    U_PERCENT,
    U_FLOW,
    U_RAW,
    U_BOOL,
    U_MS,
    U_COUNT,
    U_AMP,
    U_NEWTON,
};

struct MsgDef {
    uint8_t code;
    uint8_t sev;
    const char* label;
};

static const MsgDef MSGS[] = {
    {  1, 0, "Running" },
    {  2, 1, "Relight active" },
    {  3, 0, "Starting" },
    {  4, 0, "Ready to start" },
    {  5, 0, "Igniting" },
    {  6, 0, "Ignited" },
    {  7, 2, "Ignition failed" },
    {  8, 0, "Waiting N1" },
    {  9, 2, "Flame-out" },
    { 10, 0, "Shutting down" },
    { 11, 0, "Cooldown" },
    { 12, 1, "Oil cal invalid" },
    { 13, 1, "Stop switch" },
    { 14, 2, "Oil pres low" },
    { 15, 2, "Overspeed" },
    { 16, 2, "Oil zero/disc" },
    { 17, 1, "EGT high" },
    { 18, 1, "Oil warn" },
};

struct FieldDef {
    uint8_t id;
    uint8_t unit;
    uint8_t decimals;
    const char* key;
    const char* label;
    bool (*available)();
    float (*read)();
    bool defaultStream;
};

bool yes() { return true; }
bool hasN2() { return HardwareConfig::hasTwoShaft && HardwareConfig::hasN2Rpm; }
bool hasTot() { return HardwareConfig::hasTot; }
bool hasTit() { return HardwareConfig::hasTit; }
bool hasPrimaryEgt() { return Config::effectiveEgtSource() != 0; }
bool hasOilPress() { return HardwareConfig::hasOilPress; }
bool hasOilTemp() { return HardwareConfig::hasOilTemp; }
bool hasFuelPress() { return HardwareConfig::hasFuelPress; }
bool hasFuelFlow() { return HardwareConfig::hasFuelFlow; }
bool hasP1() { return HardwareConfig::hasP1; }
bool hasP2() { return HardwareConfig::hasP2; }
bool hasBatt() { return HardwareConfig::hasBattVoltage; }
bool hasTorque() { return HardwareConfig::hasTorque; }
bool hasThrust() { return HardwareConfig::hasThrust; }
bool hasShaftPower() { return HardwareConfig::hasTorque && HardwareConfig::hasN2Rpm; }
bool hasThrottle() { return HardwareConfig::hasThrottle; }
bool hasStarter() { return HardwareConfig::hasStarter; }
bool hasOilPump() { return HardwareConfig::hasOilPump; }
bool hasFuelPump2() { return HardwareConfig::hasFuelPump2; }
bool hasAbPump() { return HardwareConfig::hasAfterburner && HardwareConfig::hasAbPump; }
bool hasPropPitch() { return HardwareConfig::hasPropPitch; }
bool hasGlow() { return HardwareConfig::hasGlowPlug; }
bool hasAfterburner() { return HardwareConfig::hasAfterburner; }
bool hasFuelSol() { return HardwareConfig::hasFuelSol; }
bool hasIgniter() { return HardwareConfig::hasIgniter; }
bool hasIgniter2() { return HardwareConfig::hasIgniter2; }
bool hasStarterEn() { return HardwareConfig::hasStarterEn; }
bool hasCoolFan() { return HardwareConfig::hasCoolFan; }
bool hasAirstarter() { return HardwareConfig::hasAirstarterSol; }
bool hasOilScavenge() { return HardwareConfig::hasOilScavengePump; }
bool hasBleedValve() { return HardwareConfig::hasBleedValve; }
bool hasAbSol() { return HardwareConfig::hasAfterburner && HardwareConfig::hasAbSol; }
bool hasGlowCurrent() { return HardwareConfig::hasGlowCurrentSensor; }
bool hasIgniterCurrent() { return HardwareConfig::hasIgniterCurrentSensor; }
bool hasIgniter2Current() { return HardwareConfig::hasIgniter2CurrentSensor; }
bool hasOilPumpCurrent() { return HardwareConfig::hasOilPumpCurrentSensor; }
bool hasThrottleInput() { return HardwareConfig::hasThrottleInput; }
bool hasIdleInput() { return HardwareConfig::hasIdleInput; }
// AB input is live when it is the trigger source OR the pump command source
// (Config::abPumpControlMode == 2) — matching Hardware::updateSensors' gate,
// so a cluster can always see the signal the operator is modulating with.
bool hasAbInput() {
    return HardwareConfig::hasAfterburner && HardwareConfig::abInputPin >= 0 &&
           (HardwareConfig::abTriggerSource == 3 || Config::abPumpControlMode == 2);
}
bool hasDI1() { return HardwareConfig::diCh[0].pin >= 0; }
bool hasDI2() { return HardwareConfig::diCh[1].pin >= 0; }
bool hasDI3() { return HardwareConfig::diCh[2].pin >= 0; }
bool hasDI4() { return HardwareConfig::diCh[3].pin >= 0; }

float rN1() { return EngineData::instance().n1Rpm; }
float rN2() { return EngineData::instance().n2Rpm; }
float rTot() { return EngineData::instance().tot; }
float rTit() { return EngineData::instance().tit; }
float rOil() { return EngineData::instance().oilPressure; }
float rOilTemp() { return EngineData::instance().oilTemp; }
float rFuelPress() { return EngineData::instance().fuelPressure; }
float rFuelFlow() { return EngineData::instance().fuelFlow; }
float rP1() { return EngineData::instance().p1; }
float rP2() { return EngineData::instance().p2; }
float rBatt() { return EngineData::instance().battVoltage; }
float rTorque() { return EngineData::instance().torque; }
float rThrust() { return EngineData::instance().thrust; }
float rPower() { return EngineData::instance().turboPower; }
float rThrottle() { return EngineData::instance().throttleDemand * 100.0f; }
float rStarter() { return EngineData::instance().starterDemand * 100.0f; }
float rOilPump() { return EngineData::instance().oilPumpPct; }
float rFuelPump2() { return EngineData::instance().fuelPump2Demand * 100.0f; }
float rAbPump() { return EngineData::instance().abPumpDemand * 100.0f; }
float rPropPitch() { return EngineData::instance().propPitchDemand * 100.0f; }
float rGlow() { return EngineData::instance().glowPlugDemand * 100.0f; }
float rMode() { return (float)(uint8_t)EngineData::instance().mode; }
float rAbMode() { return (float)(uint8_t)EngineData::instance().abMode; }
float rTotRate() { return EngineData::instance().totRiseRate; }
float rOilTarget() { return EngineData::instance().oilTargetBar; }
float rFuelSol() { return EngineData::instance().fuelSolOpen ? 1.0f : 0.0f; }
float rIgniter1() { return EngineData::instance().igniterOn ? 1.0f : 0.0f; }
float rIgniter2() { return EngineData::instance().igniter2On ? 1.0f : 0.0f; }
float rStarterEnable() { return EngineData::instance().starterEnabled ? 1.0f : 0.0f; }
float rCoolFan() { return EngineData::instance().coolFanOn ? 1.0f : 0.0f; }
float rAirstarter() { return EngineData::instance().airstarterOpen ? 1.0f : 0.0f; }
float rOilScavenge() { return EngineData::instance().oilScavengeOn ? 1.0f : 0.0f; }
float rBleedValve() { return EngineData::instance().bleedValveOpen ? 1.0f : 0.0f; }
float rAbSol() { return EngineData::instance().abSolOpen ? 1.0f : 0.0f; }
float rAbTrigger() { return EngineData::instance().abTriggerActive ? 1.0f : 0.0f; }
float rAbArm() { return EngineData::instance().abArmSwitchOn ? 1.0f : 0.0f; }
float rAbFlame() { return EngineData::instance().abFlameOn ? 1.0f : 0.0f; }
float rStopSwitch() { return EngineData::instance().stopSwitchActive ? 1.0f : 0.0f; }
float rStartSwitch() { return EngineData::instance().startSwitchActive ? 1.0f : 0.0f; }
float rDynamicIdle() { return EngineData::instance().dynamicIdleEnabled ? 1.0f : 0.0f; }
float rLimp() { return EngineData::instance().limpMode ? 1.0f : 0.0f; }
float rBench() { return EngineData::instance().benchMode ? 1.0f : 0.0f; }
float rDev() { return EngineData::instance().devMode ? 1.0f : 0.0f; }
float rRelight() { return EngineData::instance().manualRelightActive ? 1.0f : 0.0f; }
float rStandbyOil() { return EngineData::instance().standbyOilFeedActive ? 1.0f : 0.0f; }
float rOilFailsafe() { return EngineData::instance().oilFailsafeActive ? 1.0f : 0.0f; }
float rOilOvercurrent() { return EngineData::instance().oilPumpOvercurrent ? 1.0f : 0.0f; }
float rGlowCurrent() { return EngineData::instance().glowCurrentAmps; }
float rIgniterCurrent() { return EngineData::instance().igniterCurrentAmps; }
float rIgniter2Current() { return EngineData::instance().igniter2CurrentAmps; }
float rOilPumpCurrent() { return EngineData::instance().oilPumpCurrentAmps; }
float rThrottleRaw() { return (float)EngineData::instance().throttleInputRaw; }
float rIdleRaw() { return (float)EngineData::instance().idleInputRaw; }
float rAbRaw() { return (float)EngineData::instance().abInputRaw; }
float rAbNorm() { return EngineData::instance().abInputNorm * 100.0f; }
float rMaxN1() { return EngineData::instance().maxN1; }
float rMaxN2() { return EngineData::instance().maxN2; }
float rMaxTot() { return EngineData::instance().maxTot; }
float rMaxTit() { return EngineData::instance().maxTit; }
float rMaxOilTemp() { return EngineData::instance().maxOilTemp; }
float rMaxFuelPress() { return EngineData::instance().maxFuelPressure; }
float rMaxBatt() { return EngineData::instance().maxBattVoltage; }
float rRunCount() { return (float)EngineData::instance().runCount; }
float rBootCount() { return (float)EngineData::instance().bootCount; }
float rUptime() { return (float)EngineData::instance().uptimeMs; }
float rDI1() { return EngineData::instance().diState[0] ? 1.0f : 0.0f; }
float rDI2() { return EngineData::instance().diState[1] ? 1.0f : 0.0f; }
float rDI3() { return EngineData::instance().diState[2] ? 1.0f : 0.0f; }
float rDI4() { return EngineData::instance().diState[3] ? 1.0f : 0.0f; }

static const FieldDef FIELDS[] = {
    { F_N1_RPM,         U_RPM,     0, "N1_RPM",         "N1 RPM",         yes,            rN1,               true },
    { F_N2_RPM,         U_RPM,     0, "N2_RPM",         "N2 RPM",         hasN2,          rN2,               true },
    { F_TOT_C,          U_DEG_C,   1, "TOT_C",          "TOT C",          hasTot,         rTot,              true },
    { F_TIT_C,          U_DEG_C,   1, "TIT_C",          "TIT C",          hasTit,         rTit,              true },
    { F_OIL_BAR,        U_BAR,     2, "OIL_BAR",        "Oil bar",        hasOilPress,    rOil,              true },
    { F_OIL_TEMP_C,     U_DEG_C,   1, "OIL_TEMP_C",     "Oil temp C",     hasOilTemp,     rOilTemp,          true },
    { F_FUEL_PRESS_BAR, U_BAR,     2, "FUEL_PRESS_BAR", "Fuel bar",       hasFuelPress,   rFuelPress,        true },
    { F_FUEL_FLOW,      U_FLOW,    2, "FUEL_FLOW",      "Fuel flow",      hasFuelFlow,    rFuelFlow,         true },
    { F_P1_BAR,         U_BAR,     2, "P1_BAR",         "P1 bar",         hasP1,          rP1,               true },
    { F_P2_BAR,         U_BAR,     2, "P2_BAR",         "P2 bar",         hasP2,          rP2,               true },
    { F_BATT_V,         U_VOLT,    2, "BATT_V",         "Battery V",      hasBatt,        rBatt,             true },
    { F_TORQUE_NM,      U_NM,      1, "TORQUE_NM",      "Torque Nm",      hasTorque,      rTorque,           true },
    { F_THRUST_N,        U_NEWTON,  1, "THRUST_N",       "Thrust N",       hasThrust,      rThrust,           true },
    { F_POWER_W,        U_WATT,    0, "POWER_W",        "Power W",        hasShaftPower,  rPower,            true },
    { F_THROTTLE_PCT,   U_PERCENT, 1, "THROTTLE_PCT",   "Main fuel pct",  hasThrottle,    rThrottle,         true },
    { F_STARTER_PCT,    U_PERCENT, 1, "STARTER_PCT",    "Starter pct",    hasStarter,     rStarter,          true },
    { F_OIL_PUMP_PCT,   U_PERCENT, 1, "OIL_PUMP_PCT",   "Oil pump pct",   hasOilPump,     rOilPump,          true },
    { F_FUEL_PUMP2_PCT, U_PERCENT, 1, "FUEL_PUMP2_PCT", "Pilot/aux fuel pump pct", hasFuelPump2,   rFuelPump2,        true },
    { F_AB_PUMP_PCT,    U_PERCENT, 1, "AB_PUMP_PCT",    "AB pump pct",    hasAbPump,      rAbPump,           true },
    { F_PROP_PITCH_PCT, U_PERCENT, 1, "PROP_PITCH_PCT", "Prop pitch pct", hasPropPitch,   rPropPitch,        true },
    { F_GLOW_PCT,       U_PERCENT, 1, "GLOW_PCT",       "Glow pct",       hasGlow,        rGlow,             true },
    { F_MODE,           U_NONE,    0, "MODE",           "Mode",           yes,            rMode,             false },
    { F_AB_MODE,        U_NONE,    0, "AB_MODE",        "AB mode",        hasAfterburner, rAbMode,           false },
    { F_TOT_RATE,       U_DEG_C,   1, "TOT_RATE",       "EGT rise C/s",   hasPrimaryEgt,  rTotRate,          false },
    { F_OIL_TARGET_BAR, U_BAR,     2, "OIL_TARGET_BAR", "Oil target",     hasOilPump,     rOilTarget,        false },
    { F_FUEL_SOL,       U_BOOL,    0, "FUEL_SOL",       "Main fuel shutoff", hasFuelSol,   rFuelSol,           false },
    { F_IGNITER1,       U_BOOL,    0, "IGNITER1",       "Igniter 1",      hasIgniter,     rIgniter1,         false },
    { F_IGNITER2,       U_BOOL,    0, "IGNITER2",       "AB / pilot igniter", hasIgniter2, rIgniter2,         false },
    { F_STARTER_ENABLE, U_BOOL,    0, "STARTER_ENABLE", "Starter enable", hasStarterEn,   rStarterEnable,    false },
    { F_COOL_FAN,       U_BOOL,    0, "COOL_FAN",       "Cool fan",       hasCoolFan,     rCoolFan,          false },
    { F_AIRSTARTER,     U_BOOL,    0, "AIRSTARTER",     "Air starter valve", hasAirstarter, rAirstarter,      false },
    { F_OIL_SCAVENGE,   U_BOOL,    0, "OIL_SCAVENGE",   "Oil scavenge",   hasOilScavenge, rOilScavenge,      false },
    { F_BLEED_VALVE,    U_BOOL,    0, "BLEED_VALVE",    "Bleed valve",    hasBleedValve,  rBleedValve,       false },
    { F_AB_SOL,         U_BOOL,    0, "AB_SOL",         "AB fuel valve",  hasAbSol,       rAbSol,            false },
    { F_AB_TRIGGER,     U_BOOL,    0, "AB_TRIGGER",     "AB trigger",     hasAfterburner, rAbTrigger,        false },
    { F_AB_ARM,         U_BOOL,    0, "AB_ARM",         "AB arm",         hasAfterburner, rAbArm,            false },
    { F_AB_FLAME,       U_BOOL,    0, "AB_FLAME",       "AB flame",       hasAfterburner, rAbFlame,          false },
    { F_STOP_SWITCH,    U_BOOL,    0, "STOP_SWITCH",    "Stop switch",    yes,            rStopSwitch,       false },
    { F_START_SWITCH,   U_BOOL,    0, "START_SWITCH",   "Start switch",   yes,            rStartSwitch,      false },
    { F_DYNAMIC_IDLE,   U_BOOL,    0, "DYNAMIC_IDLE",   "Automatic idle speed control", yes, rDynamicIdle, false },
    { F_LIMP_MODE,      U_BOOL,    0, "LIMP_MODE",      "Reduced-power mode", yes,        rLimp,        false },
    { F_BENCH_MODE,     U_BOOL,    0, "BENCH_MODE",     "Bench mode",     yes,            rBench,            false },
    { F_DEV_MODE,       U_BOOL,    0, "DEV_MODE",       "Dev mode",       yes,            rDev,              false },
    { F_RELIGHT,        U_BOOL,    0, "RELIGHT",        "Automatic relight", yes,          rRelight,          false },
    { F_STANDBY_OIL,    U_BOOL,    0, "STANDBY_OIL",    "Standby oil",    yes,            rStandbyOil,       false },
    { F_OIL_FAILSAFE,   U_BOOL,    0, "OIL_FAILSAFE",   "Oil sensor fallback", hasOilPump,  rOilFailsafe,      false },
    { F_OIL_OVERCURRENT,U_BOOL,    0, "OIL_OVERCURRENT","Oil overcurrent",hasOilPumpCurrent,rOilOvercurrent,   false },
    { F_GLOW_CURRENT_A, U_AMP,     2, "GLOW_CURRENT_A", "Glow current",   hasGlowCurrent, rGlowCurrent,      false },
    { F_IGNITER1_CURRENT_A,U_AMP,  2, "IGNITER1_CURRENT_A","Ign1 current",hasIgniterCurrent,rIgniterCurrent, false },
    { F_IGNITER2_CURRENT_A,U_AMP,  2, "IGNITER2_CURRENT_A","Ign2 current",hasIgniter2Current,rIgniter2Current,false },
    { F_OIL_PUMP_CURRENT_A,U_AMP,  2, "OIL_PUMP_CURRENT_A","Oil current", hasOilPumpCurrent,rOilPumpCurrent, false },
    { F_THROTTLE_INPUT_RAW,U_RAW,  0, "THROTTLE_INPUT_RAW","Thr raw",     hasThrottleInput,rThrottleRaw,     false },
    { F_IDLE_INPUT_RAW,  U_RAW,    0, "IDLE_INPUT_RAW",  "Idle raw",      hasIdleInput,   rIdleRaw,          false },
    { F_AB_INPUT_RAW,    U_RAW,    0, "AB_INPUT_RAW",    "AB raw",        hasAbInput,     rAbRaw,            false },
    { F_AB_INPUT_NORM,   U_PERCENT,1, "AB_INPUT_NORM",   "AB input pct",  hasAbInput,     rAbNorm,           false },
    { F_MAX_N1_RPM,      U_RPM,    0, "MAX_N1_RPM",      "Max N1",        yes,            rMaxN1,            false },
    { F_MAX_N2_RPM,      U_RPM,    0, "MAX_N2_RPM",      "Max N2",        hasN2,          rMaxN2,            false },
    { F_MAX_TOT_C,       U_DEG_C,  1, "MAX_TOT_C",       "Max TOT",       hasTot,         rMaxTot,           false },
    { F_MAX_TIT_C,       U_DEG_C,  1, "MAX_TIT_C",       "Max TIT",       hasTit,         rMaxTit,           false },
    { F_MAX_OIL_TEMP_C,  U_DEG_C,  1, "MAX_OIL_TEMP_C",  "Max oil temp",  hasOilTemp,     rMaxOilTemp,       false },
    { F_MAX_FUEL_PRESS_BAR,U_BAR,  2, "MAX_FUEL_PRESS_BAR","Max fuel bar",hasFuelPress,   rMaxFuelPress,     false },
    { F_MAX_BATT_V,      U_VOLT,   2, "MAX_BATT_V",      "Max batt",      hasBatt,        rMaxBatt,          false },
    { F_RUN_COUNT,       U_COUNT,  0, "RUN_COUNT",       "Run count",     yes,            rRunCount,         false },
    { F_BOOT_COUNT,      U_COUNT,  0, "BOOT_COUNT",      "Boot count",    yes,            rBootCount,        false },
    { F_UPTIME_MS,       U_MS,     0, "UPTIME_MS",       "Uptime ms",     yes,            rUptime,           false },
    { F_DI1,             U_BOOL,   0, "DI1",             "DI 1",          hasDI1,         rDI1,              false },
    { F_DI2,             U_BOOL,   0, "DI2",             "DI 2",          hasDI2,         rDI2,              false },
    { F_DI3,             U_BOOL,   0, "DI3",             "DI 3",          hasDI3,         rDI3,              false },
    { F_DI4,             U_BOOL,   0, "DI4",             "DI 4",          hasDI4,         rDI4,              false },
};

uint16_t crc16(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFF;
    while (len--) {
        crc ^= (uint16_t)(*data++) << 8;
        for (int i = 0; i < 8; i++) {
            crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
        }
    }
    return crc;
}

void put16(uint8_t* b, uint16_t v) {
    b[0] = (uint8_t)(v & 0xFF);
    b[1] = (uint8_t)(v >> 8);
}

void put32(uint8_t* b, uint32_t v) {
    b[0] = (uint8_t)(v & 0xFF);
    b[1] = (uint8_t)((v >> 8) & 0xFF);
    b[2] = (uint8_t)((v >> 16) & 0xFF);
    b[3] = (uint8_t)(v >> 24);
}

void putFloat(uint8_t* b, float v) {
    memcpy(b, &v, sizeof(float));
}

uint32_t healthFlags(const EngineData& ed) {
    uint32_t f = 0;
    if (HardwareConfig::hasN1Rpm && ed.n1Healthy) f |= 1UL << 0;
    if (HardwareConfig::hasN2Rpm && ed.n2Healthy) f |= 1UL << 1;
    if (HardwareConfig::hasTot && ed.totHealthy) f |= 1UL << 2;
    if (HardwareConfig::hasTit && ed.titHealthy) f |= 1UL << 3;
    if (HardwareConfig::hasOilPress && ed.oilHealthy) f |= 1UL << 4;
    if (HardwareConfig::hasOilTemp && ed.oilTempHealthy) f |= 1UL << 5;
    if (HardwareConfig::hasFuelPress && ed.fuelPressHealthy) f |= 1UL << 6;
    if (HardwareConfig::hasBattVoltage && ed.battHealthy) f |= 1UL << 7;
    if (HardwareConfig::hasTorque && ed.torqueHealthy) f |= 1UL << 8;
    if (HardwareConfig::hasFlame && ed.flameDetected) f |= 1UL << 9;
    if (ed.surgeDetected) f |= 1UL << 10;
    if (HardwareConfig::hasAfterburner && HardwareConfig::hasAbFlame && ed.abFlameOn) f |= 1UL << 11;
    if (HardwareConfig::hasThrottleInput && ed.rcThrottleValid) f |= 1UL << 12;
    if (HardwareConfig::hasIdleInput && ed.rcIdleValid) f |= 1UL << 13;
    if (ed.configVersionMismatch) f |= 1UL << 14;
    if (ed.seqHasErrors) f |= 1UL << 15;
    return f;
}

const MsgDef* findMsg(uint8_t code) {
    for (size_t i = 0; i < sizeof(MSGS) / sizeof(MSGS[0]); i++)
        if (MSGS[i].code == code) return &MSGS[i];
    return nullptr;
}

const FieldDef* findFieldByKey(const char* key) {
    if (!key || !key[0]) return nullptr;
    for (size_t i = 0; i < sizeof(FIELDS) / sizeof(FIELDS[0]); i++)
        if (strcmp(FIELDS[i].key, key) == 0) return &FIELDS[i];
    return nullptr;
}

void addFieldMask(size_t index) {
    if (index < 64) g_subscriptionMaskLo |= (1ULL << index);
    else if (index < 128) g_subscriptionMaskHi |= (1ULL << (index - 64));
}

bool hasFieldMask(size_t index) {
    if (index < 64) return (g_subscriptionMaskLo & (1ULL << index)) != 0;
    if (index < 128) return (g_subscriptionMaskHi & (1ULL << (index - 64))) != 0;
    return false;
}

void clearFieldMask() {
    g_subscriptionMaskLo = 0;
    g_subscriptionMaskHi = 0;
}

bool fieldSelected(size_t index) {
    if (index >= sizeof(FIELDS) / sizeof(FIELDS[0])) return false;
    const FieldDef& field = FIELDS[index];
    if (g_subscriptionActive) return hasFieldMask(index);
    return field.defaultStream && field.available();
}

bool fieldShouldSendValue(size_t index) {
    if (!fieldSelected(index)) return false;
    const FieldDef& field = FIELDS[index];
    if (field.available()) return true;
    return g_subscriptionActive;
}

bool applySubscription(const char* spec) {
    if (!spec || !spec[0] || strcmp(spec, "DEFAULT") == 0) {
        g_subscriptionActive = false;
        clearFieldMask();
        g_telemetryCursor = 0;
        return true;
    }
    if (strcmp(spec, "ALL") == 0) {
        g_subscriptionActive = true;
        clearFieldMask();
        for (size_t i = 0; i < sizeof(FIELDS) / sizeof(FIELDS[0]); i++)
            if (FIELDS[i].available()) addFieldMask(i);
        g_telemetryCursor = 0;
        return true;
    }

    uint64_t newMaskLo = 0;
    uint64_t newMaskHi = 0;
    char tmp[160] = {};
    strncpy(tmp, spec, sizeof(tmp) - 1);
    char* ctx = nullptr;
    char* tok = strtok_r(tmp, ",", &ctx);
    while (tok) {
        while (*tok == ' ') tok++;
        const FieldDef* field = findFieldByKey(tok);
        if (!field) return false;
        size_t index = (size_t)(field - FIELDS);
        if (index < 64) newMaskLo |= (1ULL << index);
        else if (index < 128) newMaskHi |= (1ULL << (index - 64));
        tok = strtok_r(nullptr, ",", &ctx);
    }
    if (newMaskLo == 0 && newMaskHi == 0) return false;
    g_subscriptionActive = true;
    g_subscriptionMaskLo = newMaskLo;
    g_subscriptionMaskHi = newMaskHi;
    g_telemetryCursor = 0;
    return true;
}

bool sendFrame(uint8_t type, uint8_t seq, const uint8_t* payload, uint16_t len) {
    if (len > 220) return false;
    const size_t packetLen = (size_t)len + 9;
    if (_port.availableForWrite() < (int)packetLen) return false;

    uint8_t header[7] = { 'O', 'T', 1, type, seq, 0, 0 };
    put16(header + 5, len);

    uint8_t crcBuf[227];
    memcpy(crcBuf, header + 2, 5);
    if (len) memcpy(crcBuf + 5, payload, len);
    uint16_t crc = crc16(crcBuf, (size_t)len + 5);

    _port.write(header, sizeof(header));
    if (len) _port.write(payload, len);
    _port.write((uint8_t)(crc & 0xFF));
    _port.write((uint8_t)(crc >> 8));
    return true;
}

void sendAck(uint8_t seq, uint8_t ok, const char* text) {
    uint8_t payload[48] = {};
    payload[0] = ok;
    strncpy((char*)payload + 1, text ? text : "", sizeof(payload) - 2);
    sendFrame(FT_ACK, seq, payload, (uint16_t)(2 + strlen((char*)payload + 1)));
}
}

void ClusterSerial::begin() {
    if (!HardwareConfig::hasClusterSerial || HardwareConfig::clusterTxPin < 0) return;

    uint32_t baud = (uint32_t)HardwareConfig::clusterBaud;
    if (baud == 0) baud = OT_CLUSTER_BAUD;
    const int rxPin = HardwareConfig::clusterRxPin >= 0 ? HardwareConfig::clusterRxPin : -1;
    // A full schema burst (HELLO + STATUS_DEFs + FIELD_DEFs + LIMITS +
    // SCHEMA_END) is ~3 KB with every field subscribed; without a TX ring
    // buffer availableForWrite() caps at the 128-byte HW FIFO, sendFrame()
    // rejects most frames and the schema can never complete. Must be set
    // before begin() (boot-time allocation only).
    _port.setTxBufferSize(4096);
    _port.begin(baud, SERIAL_8N1, rxPin, HardwareConfig::clusterTxPin);

    _seq = 0;
    _rxLen = 0;
    _rxOverflow = false;
    _schemaDirty = true;
    g_subscriptionActive = false;
    g_subscriptionMaskLo = 0;
    g_subscriptionMaskHi = 0;
    g_telemetryCursor = 0;
    _lastMode = SysMode::STANDBY;
    _lastClusterCode = 0;
    _lastStatusCode = 0;
    _lastDataMs = 0;
    _lastSchemaMs = 0;
    _nextSchemaMs = millis() + 2000UL;
    _sendSchema();
    sendStatus(ClCode::ReadyToStart);

    Serial.printf("[OT] Cluster OTC v1 on TX GPIO %d RX GPIO %d @ %lu baud\n",
                  HardwareConfig::clusterTxPin, rxPin, (unsigned long)baud);
    _begun = true;
}

void ClusterSerial::beginIfNeeded() {
    if (_begun) return;
    begin();  // still early-returns if the feature is not enabled/pinned
}

void ClusterSerial::_sendSchema() {
    bool ok = true;
    uint8_t hello[80] = {};
    hello[0] = 1; // OTC protocol major
    hello[1] = 0; // minor
    uint16_t caps = CAP_SCHEMA | CAP_TELEMETRY;
    if (HardwareConfig::clusterRxPin >= 0) caps |= CAP_RX_COMMANDS | CAP_SUBSCRIPTIONS;
    put16(hello + 2, caps);
    put16(hello + 4, (uint16_t)HardwareConfig::clusterIntervalMs);
    put32(hello + 6, (uint32_t)HardwareConfig::clusterBaud);
    strncpy((char*)hello + 10, HardwareConfig::profileId, sizeof(hello) - 11);
    ok = sendFrame(FT_HELLO, _seq++, hello, (uint16_t)(11 + strlen((char*)hello + 10))) && ok;

    for (size_t i = 0; i < sizeof(MSGS) / sizeof(MSGS[0]); i++) {
        uint8_t payload[48] = {};
        payload[0] = MSGS[i].code;
        payload[1] = MSGS[i].sev;
        strncpy((char*)payload + 2, MSGS[i].label, sizeof(payload) - 3);
        ok = sendFrame(FT_STATUS_DEF, _seq++, payload, (uint16_t)(3 + strlen((char*)payload + 2))) && ok;
    }

    uint8_t idx = 0;
    for (size_t i = 0; i < sizeof(FIELDS) / sizeof(FIELDS[0]); i++) {
        if (!fieldShouldSendValue(i)) continue;
        uint8_t payload[48] = {};
        payload[0] = idx++;
        payload[1] = FIELDS[i].id;
        payload[2] = 1; // float32
        payload[3] = FIELDS[i].unit;
        payload[4] = FIELDS[i].decimals;
        strncpy((char*)payload + 5, FIELDS[i].key, sizeof(payload) - 6);
        ok = sendFrame(FT_FIELD_DEF, _seq++, payload, (uint16_t)(6 + strlen((char*)payload + 5))) && ok;
    }

    uint8_t limits[28] = {};
    float egtLimit = Config::primaryEgtLimitC();
    float totWarn = Config::totWarnC > 0.0f ? Config::totWarnC
                  : (egtLimit > 0.0f ? max(0.0f, egtLimit - Config::totSafeMargin) : 0.0f);
    float oilWarn = Config::oilWarnBar > 0.0f ? Config::oilWarnBar : Config::oilRunningMin;
    putFloat(limits + 0,  Config::rpmLimit);
    // 0 = auto-derive from the RPM limit (like totWarn/oilWarn above), so the
    // N1 warn line tracks rpm_limit instead of a stale fixed default.
    putFloat(limits + 4,  Config::n1WarnRpm > 0.0f ? Config::n1WarnRpm
                                                   : Config::rpmLimit * 0.9f);
    putFloat(limits + 8,  Config::n2WarnRpm);
    putFloat(limits + 12, egtLimit);
    putFloat(limits + 16, totWarn);
    putFloat(limits + 20, oilWarn);
    putFloat(limits + 24, Config::oilZeroBar);
    ok = sendFrame(FT_LIMITS, _seq++, limits, sizeof(limits)) && ok;

    uint8_t endPayload[1] = { idx };
    ok = sendFrame(FT_SCHEMA_END, _seq++, endPayload, sizeof(endPayload)) && ok;
    _lastSchemaMs = millis();
    if (ok) {
        _schemaDirty = false;
        _nextSchemaMs = _lastSchemaMs + 10000UL;
    } else {
        _schemaDirty = true;
        _nextSchemaMs = _lastSchemaMs + 100UL;
    }
}

void ClusterSerial::sendStatus(uint8_t code) {
    if (!HardwareConfig::hasClusterSerial) return;
    _lastStatusCode = code;
    const MsgDef* msg = findMsg(code);

    uint8_t payload[56] = {};
    payload[0] = code;
    payload[1] = msg ? msg->sev : 0;
    strncpy((char*)payload + 2, msg ? msg->label : "Status", sizeof(payload) - 3);
    sendFrame(FT_STATUS, _seq++, payload, (uint16_t)(3 + strlen((char*)payload + 2)));
}

void ClusterSerial::sendEvent(uint8_t severity, const char* text) {
    if (!HardwareConfig::hasClusterSerial) return;
    uint8_t payload[96] = {};
    payload[0] = severity;
    strncpy((char*)payload + 1, text ? text : "", sizeof(payload) - 2);
    sendFrame(FT_EVENT, _seq++, payload, (uint16_t)(2 + strlen((char*)payload + 1)));
}

void ClusterSerial::_sendTelemetry() {
    auto& ed = EngineData::instance();
    uint8_t payload[220] = {};
    put32(payload + 0, millis());
    payload[4] = (uint8_t)ed.mode;
    put32(payload + 5, healthFlags(ed));
    payload[9] = _lastStatusCode;
    payload[10] = ed.seqBlockIdx;
    payload[11] = ed.seqBlockTotal;

    uint8_t total = 0;
    for (size_t i = 0; i < sizeof(FIELDS) / sizeof(FIELDS[0]); i++)
        if (fieldShouldSendValue(i)) total++;
    if (!total) return;
    if (g_telemetryCursor >= total) g_telemetryCursor = 0;

    const uint8_t startIndex = g_telemetryCursor;
    uint8_t count = 0;
    uint8_t activeIndex = 0;
    size_t pos = 14;
    for (size_t i = 0; i < sizeof(FIELDS) / sizeof(FIELDS[0]); i++) {
        if (!fieldShouldSendValue(i)) continue;
        if (activeIndex++ < startIndex) continue;
        if (pos + 4 > sizeof(payload)) break;
        putFloat(payload + pos, FIELDS[i].available() ? FIELDS[i].read() : NAN);
        pos += 4;
        count++;
    }
    payload[12] = count;
    payload[13] = startIndex;
    // Advance the chunk cursor only if the frame was actually accepted —
    // otherwise retry the same block next interval instead of silently
    // skipping it for the whole cycle.
    if (sendFrame(FT_TELEMETRY, _seq++, payload, (uint16_t)pos))
        g_telemetryCursor = (startIndex + count >= total) ? 0 : (uint8_t)(startIndex + count);
}

void ClusterSerial::_handleLine(const char* line) {
    if (strcmp(line, "OTC:PING") == 0) {
        sendAck(_seq++, 1, "PONG");
        return;
    }
    if (strcmp(line, "OTC:SCHEMA?") == 0) {
        _schemaDirty = true;
        _nextSchemaMs = 0;
        sendAck(_seq++, 1, "SCHEMA");
        return;
    }
    if (strncmp(line, "OTC:SUB,", 8) == 0) {
        bool ok = applySubscription(line + 8);
        if (ok) {
            _schemaDirty = true;
            _nextSchemaMs = 0;
            sendAck(_seq++, 1, "SUB_OK");
        } else {
            sendAck(_seq++, 0, "SUB_BAD_FIELD");
        }
        return;
    }
    if (strncmp(line, "OTC:CMD,", 8) != 0) {
        sendAck(_seq++, 0, "BAD_CMD");
        return;
    }

    const char* cmd = line + 8;
    OTPacket pkt{};
    bool ok = true;
    if (strcmp(cmd, "STOP") == 0) {
        pkt.cmd = OTCommand::STOP;
        ok = CommandQueue::pushEmergencyStop(pkt);
    } else if (strcmp(cmd, "START") == 0) {
        pkt.cmd = OTCommand::START;
        ok = CommandQueue::push(pkt);
    } else if (strcmp(cmd, "AB_STOP") == 0) {
        pkt.cmd = OTCommand::AB_STOP;
        ok = CommandQueue::pushEmergencyFront(pkt);
    } else if (strcmp(cmd, "RESET_PEAKS") == 0) {
        pkt.cmd = OTCommand::RESET_PEAKS;
        ok = CommandQueue::push(pkt);
    } else if (strcmp(cmd, "LIMP_TOGGLE") == 0) {
        pkt.cmd = OTCommand::TOGGLE_LIMP_MODE;
        ok = CommandQueue::push(pkt);
    } else if (strcmp(cmd, "DYNAMIC_IDLE_TOGGLE") == 0) {
        pkt.cmd = OTCommand::TOGGLE_DYNAMIC_IDLE;
        ok = CommandQueue::push(pkt);
    } else {
        ok = false;
    }
    sendAck(_seq++, ok ? 1 : 0, ok ? "QUEUED" : "REJECTED");
}

void ClusterSerial::_pollRx() {
    if (HardwareConfig::clusterRxPin < 0) return;
    while (_port.available()) {
        char c = (char)_port.read();
        if (c == '\r') continue;
        if (c == '\n') {
            if (_rxOverflow) {
                // Line exceeded the buffer: discard it whole rather than
                // re-parsing the tail as a bogus new command.
                _rxOverflow = false;
                sendAck(_seq++, 0, "LINE_TOO_LONG");
            } else {
                _rxLine[_rxLen] = '\0';
                if (_rxLen) _handleLine(_rxLine);
            }
            _rxLen = 0;
            continue;
        }
        if (_rxOverflow) continue;
        if (_rxLen < sizeof(_rxLine) - 1) _rxLine[_rxLen++] = c;
        else _rxOverflow = true;
    }
}

void ClusterSerial::tick() {
    if (!HardwareConfig::hasClusterSerial) return;
    _pollRx();

    auto& ed = EngineData::instance();
    SysMode m = ed.mode;
    unsigned long now = millis();

    if (_schemaDirty && (int32_t)(now - _nextSchemaMs) >= 0) _sendSchema();
    else if (HardwareConfig::clusterRxPin < 0 && (int32_t)(now - _nextSchemaMs) >= 0) {
        _sendSchema();
        _nextSchemaMs = now + 10000UL;
    }

    if (m != _lastMode) {
        uint8_t code;
        switch (m) {
            case SysMode::STANDBY:  code = ClCode::ReadyToStart; break;
            case SysMode::STARTUP:  code = ClCode::StartingUp;   break;
            case SysMode::RUNNING:  code = ClCode::Running;      break;
            case SysMode::SHUTDOWN: code = ClCode::ShuttingDown; break;
            case SysMode::FAULT:    code = ClCode::ShuttingDown; break;
            default:                code = ClCode::ReadyToStart; break;
        }
        sendStatus(code);
        _lastMode = m;
        _lastClusterCode = 0;
    }

    uint8_t cc = ed.clusterCode;
    if (cc != 0 && cc != _lastClusterCode) {
        sendStatus(cc);
        _lastClusterCode = cc;
    }

    if (m == SysMode::RUNNING) {
        const float egtLimit = Config::primaryEgtLimitC();
        float egtWarnThresh = (Config::totWarnC > 0.0f)
            ? Config::totWarnC
            : (egtLimit > 0.0f ? max(0.0f, egtLimit - Config::totSafeMargin) : 0.0f);
        bool totHigh = egtWarnThresh > 0.0f
            && Config::primaryEgtHealthy(ed)
            && (Config::primaryEgtC(ed) >= egtWarnThresh);
        if (totHigh && !_totWarnActive) {
            _totWarnActive = true;
            sendStatus(ClCode::TotHigh);
        } else if (!totHigh && _totWarnActive) {
            _totWarnActive = false;
            sendStatus(ClCode::Running);
        }

        float oilWarnThresh = (Config::oilWarnBar > 0.0f)
            ? Config::oilWarnBar
            : Config::oilRunningMin;
        bool oilLow = oilWarnThresh > 0.0f
            && ed.oilHealthy
            && (ed.oilPressure < (oilWarnThresh + 0.3f));
        if (oilLow && !_oilWarnActive) {
            _oilWarnActive = true;
            sendStatus(ClCode::OilWarn);
        } else if (!oilLow && _oilWarnActive) {
            _oilWarnActive = false;
            sendStatus(ClCode::Running);
        }
    } else {
        _totWarnActive = false;
        _oilWarnActive = false;
    }

    unsigned long interval = (unsigned long)HardwareConfig::clusterIntervalMs;
    if (interval < 10) interval = 50;
    if (now - _lastDataMs < interval) return;
    _lastDataMs = now;
    _sendTelemetry();
}
