#include "HardwareConfig.h"
#include "../hal/actuators/RelayDemand.h"
#include "Config.h"
#include "hardware_profile.h"
#include "pcb/PcbProfileManager.h"
#include "pcb/PcbProfileResolver.h"
#include "HardwareConfigInternal.h"
#include "../engine/EngineData.h"
#include <LittleFS.h>
#include <cstring>
#include <memory>
#include <utility>

namespace {
constexpr int AUTO_S3_RGB_STATUS_LED_PIN = -2;
char g_lastHardwareValidationError[160] = "unknown hardware validation error";

void setHardwareValidationError(const char* reason) {
    if (!reason || reason == g_lastHardwareValidationError) return;
    strlcpy(g_lastHardwareValidationError, reason, sizeof(g_lastHardwareValidationError));
}

#if defined(OT_HAS_STATUS_LED) && defined(OT_STATUS_LED_PIN)
constexpr int DEFAULT_STATUS_LED_PIN = OT_STATUS_LED_PIN;
#elif defined(OT_PLATFORM_ESP32S3)
constexpr int DEFAULT_STATUS_LED_PIN = 48;
#else
constexpr int DEFAULT_STATUS_LED_PIN = 2;
#endif

#if defined(OT_PLATFORM_ESP32S3)
constexpr int DEFAULT_STATUS_LED_TYPE = 1;
#else
constexpr int DEFAULT_STATUS_LED_TYPE = 0;
#endif

// ── hardware_profile.h → runtime defaults ────────────────────
// The OT_HAS_* / OT_SAFETY_* macros seed the DEFAULT values below:
//  - first boot with no ecu_config.json generates a file from them,
//  - keys missing from an existing file fall back to them.
// Once saved, ecu_config.json wins — macros never override file values.
#ifdef OT_HAS_N1_RPM
constexpr bool DEFAULT_HAS_N1_RPM = true;
#else
constexpr bool DEFAULT_HAS_N1_RPM = false;
#endif
#ifdef OT_HAS_N2_RPM
constexpr bool DEFAULT_HAS_N2_RPM = true;   // also implies a two-shaft build
#else
constexpr bool DEFAULT_HAS_N2_RPM = false;
#endif
#ifdef OT_HAS_TOT
constexpr bool DEFAULT_HAS_TOT = true;
#else
constexpr bool DEFAULT_HAS_TOT = false;
#endif
#ifdef OT_HAS_OIL_PRESS
constexpr bool DEFAULT_HAS_OIL_PRESS = true;
#else
constexpr bool DEFAULT_HAS_OIL_PRESS = false;
#endif
#ifdef OT_HAS_FLAME
constexpr bool DEFAULT_HAS_FLAME = true;
#else
constexpr bool DEFAULT_HAS_FLAME = false;
#endif
#ifdef OT_HAS_FUEL_FLOW
constexpr bool DEFAULT_HAS_FUEL_FLOW = true;
#else
constexpr bool DEFAULT_HAS_FUEL_FLOW = false;
#endif
#ifdef OT_HAS_P1
constexpr bool DEFAULT_HAS_P1 = true;
#else
constexpr bool DEFAULT_HAS_P1 = false;
#endif
#ifdef OT_HAS_P2
constexpr bool DEFAULT_HAS_P2 = true;
#else
constexpr bool DEFAULT_HAS_P2 = false;
#endif
#ifdef OT_HAS_THROTTLE_INPUT
constexpr bool DEFAULT_HAS_THROTTLE_INPUT = true;
#else
constexpr bool DEFAULT_HAS_THROTTLE_INPUT = false;
#endif
#ifdef OT_THROTTLE_INPUT_RC_PWM
constexpr bool DEFAULT_THROTTLE_INPUT_RC_PWM = true;
#else
constexpr bool DEFAULT_THROTTLE_INPUT_RC_PWM = false;
#endif
#ifdef OT_HAS_IDLE_INPUT
constexpr bool DEFAULT_HAS_IDLE_INPUT = true;
#else
constexpr bool DEFAULT_HAS_IDLE_INPUT = false;
#endif
#ifdef OT_IDLE_INPUT_RC_PWM
constexpr bool DEFAULT_IDLE_INPUT_RC_PWM = true;
#else
constexpr bool DEFAULT_IDLE_INPUT_RC_PWM = false;
#endif
#ifdef OT_HAS_THROTTLE
constexpr bool DEFAULT_HAS_THROTTLE = true;
#else
constexpr bool DEFAULT_HAS_THROTTLE = false;
#endif
#ifdef OT_HAS_STARTER
constexpr bool DEFAULT_HAS_STARTER = true;
#else
constexpr bool DEFAULT_HAS_STARTER = false;
#endif
#ifdef OT_HAS_OIL_PUMP
constexpr bool DEFAULT_HAS_OIL_PUMP = true;
#else
constexpr bool DEFAULT_HAS_OIL_PUMP = false;
#endif
#ifdef OT_HAS_FUEL_SOL
constexpr bool DEFAULT_HAS_FUEL_SOL = true;
#else
constexpr bool DEFAULT_HAS_FUEL_SOL = false;
#endif
#ifdef OT_HAS_IGNITER
constexpr bool DEFAULT_HAS_IGNITER = true;
#else
constexpr bool DEFAULT_HAS_IGNITER = false;
#endif
#ifdef OT_HAS_STARTER_EN
constexpr bool DEFAULT_HAS_STARTER_EN = true;
#else
constexpr bool DEFAULT_HAS_STARTER_EN = false;
#endif
#ifdef OT_HAS_AB_SOL
constexpr bool DEFAULT_HAS_AB_SOL = true;
#else
constexpr bool DEFAULT_HAS_AB_SOL = false;
#endif
#ifdef OT_HAS_AIRSTARTER_SOL
constexpr bool DEFAULT_HAS_AIRSTARTER_SOL = true;
#else
constexpr bool DEFAULT_HAS_AIRSTARTER_SOL = false;
#endif
#ifdef OT_HAS_COOL_FAN
constexpr bool DEFAULT_HAS_COOL_FAN = true;
#else
constexpr bool DEFAULT_HAS_COOL_FAN = false;
#endif
#ifdef OT_HAS_AFTERBURNER
constexpr bool DEFAULT_HAS_AFTERBURNER = true;
#else
constexpr bool DEFAULT_HAS_AFTERBURNER = false;
#endif
#ifdef OT_HAS_CLUSTER_SERIAL
constexpr bool DEFAULT_HAS_CLUSTER_SERIAL = true;
#else
constexpr bool DEFAULT_HAS_CLUSTER_SERIAL = false;
#endif
#ifdef OT_HAS_OIL_LOOP
constexpr bool DEFAULT_HAS_OIL_LOOP = true;
#else
constexpr bool DEFAULT_HAS_OIL_LOOP = false;
#endif
#ifdef OT_HAS_DYNAMIC_IDLE
constexpr bool DEFAULT_HAS_DYNAMIC_IDLE = true;
#else
constexpr bool DEFAULT_HAS_DYNAMIC_IDLE = false;
#endif
#ifdef OT_SAFETY_OVERSPEED
constexpr bool DEFAULT_SAFETY_OVERSPEED = true;
#else
constexpr bool DEFAULT_SAFETY_OVERSPEED = false;
#endif
#ifdef OT_SAFETY_OVERTEMP
constexpr bool DEFAULT_SAFETY_OVERTEMP = true;
#else
constexpr bool DEFAULT_SAFETY_OVERTEMP = false;
#endif
#ifdef OT_SAFETY_LOW_OIL
constexpr bool DEFAULT_SAFETY_LOW_OIL = true;
#else
constexpr bool DEFAULT_SAFETY_LOW_OIL = false;
#endif
#ifdef OT_SAFETY_OIL_ZERO
constexpr bool DEFAULT_SAFETY_OIL_ZERO = true;
#else
constexpr bool DEFAULT_SAFETY_OIL_ZERO = false;
#endif
#ifdef OT_SAFETY_FLAMEOUT
constexpr bool DEFAULT_SAFETY_FLAMEOUT = true;
#else
constexpr bool DEFAULT_SAFETY_FLAMEOUT = false;
#endif

// Optional pin/param macros — commented out in the stock profile, so give
// them fallbacks here to keep the defaults below compiling either way.
#ifndef OT_N2_RPM_PIN
  #define OT_N2_RPM_PIN 27
#endif
#ifndef OT_N2_RPM_PPR
  #define OT_N2_RPM_PPR 0.633f
#endif
#ifndef OT_FUEL_FLOW_PIN
  #define OT_FUEL_FLOW_PIN OT_ADC_5
#endif
#ifndef OT_P1_PIN
  #define OT_P1_PIN OT_ADC_5
#endif
#ifndef OT_P2_PIN
  #define OT_P2_PIN OT_ADC_6
#endif
#ifndef OT_AB_SOL_PIN
  #define OT_AB_SOL_PIN -1
#endif
#ifndef OT_AB_SOL_ACTIVE_H
  #define OT_AB_SOL_ACTIVE_H true
#endif
#ifndef OT_AIRSTARTER_SOL_PIN
  #define OT_AIRSTARTER_SOL_PIN -1
#endif
#ifndef OT_COOL_FAN_PIN
  #define OT_COOL_FAN_PIN -1
#endif
#ifndef OT_CLUSTER_TX_PIN
  #define OT_CLUSTER_TX_PIN 17
#endif
#ifndef OT_CLUSTER_BAUD
  #define OT_CLUSTER_BAUD 115200
#endif
#ifndef OT_CLUSTER_INTERVAL_MS
  #define OT_CLUSTER_INTERVAL_MS 50
#endif

// OT_STARTUP_SEQ / OT_SHUTDOWN_SEQ → default sequence block lists.
#define OT_BLOCK(name) #name,
const char* const kProfileStartupSeq[]  = { OT_STARTUP_SEQ };
const char* const kProfileShutdownSeq[] = { OT_SHUTDOWN_SEQ };
#undef OT_BLOCK
constexpr int kProfileStartupSeqLen =
    (int)(sizeof(kProfileStartupSeq) / sizeof(kProfileStartupSeq[0]));
constexpr int kProfileShutdownSeqLen =
    (int)(sizeof(kProfileShutdownSeq) / sizeof(kProfileShutdownSeq[0]));
static_assert(kProfileStartupSeqLen <= HardwareConfig::MAX_SEQ_BLOCKS,
              "OT_STARTUP_SEQ has more blocks than MAX_SEQ_BLOCKS");
static_assert(kProfileShutdownSeqLen <= HardwareConfig::MAX_SEQ_BLOCKS,
              "OT_SHUTDOWN_SEQ has more blocks than MAX_SEQ_BLOCKS");
#ifndef OT_STARTUP_DELAY_MS
  #define OT_STARTUP_DELAY_MS {0}
#endif
#ifndef OT_SHUTDOWN_DELAY_MS
  #define OT_SHUTDOWN_DELAY_MS {0}
#endif
constexpr int kProfileStartupDelayMs[]  = OT_STARTUP_DELAY_MS;
constexpr int kProfileShutdownDelayMs[] = OT_SHUTDOWN_DELAY_MS;
constexpr int kProfileStartupDelayLen =
    (int)(sizeof(kProfileStartupDelayMs) / sizeof(kProfileStartupDelayMs[0]));
constexpr int kProfileShutdownDelayLen =
    (int)(sizeof(kProfileShutdownDelayMs) / sizeof(kProfileShutdownDelayMs[0]));
constexpr int DEFAULT_STATUS_LED_MODE = 0;
constexpr uint32_t DEFAULT_STATUS_LED_STANDBY_COLOR  = 0x00FF40;
constexpr uint32_t DEFAULT_STATUS_LED_STARTUP_COLOR  = 0x0060FF;
constexpr uint32_t DEFAULT_STATUS_LED_RUNNING_COLOR  = 0x00FF00;
constexpr uint32_t DEFAULT_STATUS_LED_SHUTDOWN_COLOR = 0xFF8000;
constexpr uint32_t DEFAULT_STATUS_LED_BLINK_COLOR    = 0x0000FF;

constexpr const char* currentPlatformName() {
#if defined(OT_PLATFORM_ESP32S3)
    return "esp32s3";
#else
    return "esp32";
#endif
}

bool storedHardwarePlatformMismatch(const JsonDocument& doc) {
    const char* stored = doc["platform"] | "";
    return stored[0] && strcmp(stored, currentPlatformName()) != 0;
}

void normalizeS3StatusLedDefault(JsonDocument& doc) {
#if defined(OT_PLATFORM_ESP32S3)
    JsonObject actuators = doc["actuators"].is<JsonObject>()
        ? doc["actuators"].as<JsonObject>()
        : doc["actuators"].to<JsonObject>();
    JsonObject led = actuators["status_led"].is<JsonObject>()
        ? actuators["status_led"].as<JsonObject>()
        : actuators["status_led"].to<JsonObject>();
    const bool enabledPresent = !led["enabled"].isNull();
    const bool pinPresent = !led["pin"].isNull();
    const bool typePresent = !led["type"].isNull();
    const bool enabled = led["enabled"] | true;
    const int pin = led["pin"] | DEFAULT_STATUS_LED_PIN;
    if (!enabledPresent ||
        (enabled && (!pinPresent || pin < 0 || pin == AUTO_S3_RGB_STATUS_LED_PIN || pin == 38))) {
        const int storedMode = led["mode"] | DEFAULT_STATUS_LED_MODE;
        led["enabled"] = true;
        led["pin"] = DEFAULT_STATUS_LED_PIN;
        led["type"] = DEFAULT_STATUS_LED_TYPE;
        led["mode"] = constrain(storedMode, 0, 1);
        if (led["standby_color"].isNull()) led["standby_color"] = DEFAULT_STATUS_LED_STANDBY_COLOR;
        if (led["startup_color"].isNull()) led["startup_color"] = DEFAULT_STATUS_LED_STARTUP_COLOR;
        if (led["running_color"].isNull()) led["running_color"] = DEFAULT_STATUS_LED_RUNNING_COLOR;
        if (led["shutdown_color"].isNull()) led["shutdown_color"] = DEFAULT_STATUS_LED_SHUTDOWN_COLOR;
        if (led["blink_color"].isNull()) led["blink_color"] = DEFAULT_STATUS_LED_BLINK_COLOR;
        JsonVariant sensorsVar = doc["sensors"];
        if (sensorsVar.is<JsonObject>()) {
            JsonObject sensors = sensorsVar.as<JsonObject>();
            const char* spiKeys[] = { "tot", "tit", "oil_temp" };
            for (const char* key : spiKeys) {
                JsonVariant sensorVar = sensors[key];
                if (!sensorVar.is<JsonObject>()) continue;
                JsonObject sensor = sensorVar.as<JsonObject>();
                if ((sensor["miso"] | -1) == 38) sensor["miso"] = OT_SPI_MISO_DEFAULT;
            }
        }
    } else if (enabled && pin == DEFAULT_STATUS_LED_PIN && !typePresent) {
        led["type"] = DEFAULT_STATUS_LED_TYPE;
    }
    if ((led["mode"] | DEFAULT_STATUS_LED_MODE) < 0 ||
        (led["mode"] | DEFAULT_STATUS_LED_MODE) > 1) {
        led["mode"] = DEFAULT_STATUS_LED_MODE;
    }
    if ((led["mode"] | DEFAULT_STATUS_LED_MODE) == 1) {
        led["enabled"] = true;
        led["type"] = 1;
        if ((led["pin"] | -1) < 0 || (led["pin"] | -1) == 38) led["pin"] = DEFAULT_STATUS_LED_PIN;
    }
    if (led["standby_color"].isNull()) led["standby_color"] = DEFAULT_STATUS_LED_STANDBY_COLOR;
    if (led["startup_color"].isNull()) led["startup_color"] = DEFAULT_STATUS_LED_STARTUP_COLOR;
    if (led["running_color"].isNull()) led["running_color"] = DEFAULT_STATUS_LED_RUNNING_COLOR;
    if (led["shutdown_color"].isNull()) led["shutdown_color"] = DEFAULT_STATUS_LED_SHUTDOWN_COLOR;
    if (led["blink_color"].isNull()) led["blink_color"] = DEFAULT_STATUS_LED_BLINK_COLOR;
#else
    // Classic boards have a conventional built-in LED on GPIO 2. Preserve an
    // explicit user disable, but repair old/missing enabled records so a
    // factory/default Classic always exposes and drives its status LED.
    JsonObject actuators = doc["actuators"].is<JsonObject>()
        ? doc["actuators"].as<JsonObject>()
        : doc["actuators"].to<JsonObject>();
    JsonObject led = actuators["status_led"].is<JsonObject>()
        ? actuators["status_led"].as<JsonObject>()
        : actuators["status_led"].to<JsonObject>();
    const bool enabledPresent = !led["enabled"].isNull();
    const bool enabled = led["enabled"] | true;
    if (!enabledPresent) led["enabled"] = true;
    if (enabled && ((led["pin"] | DEFAULT_STATUS_LED_PIN) < 0))
        led["pin"] = DEFAULT_STATUS_LED_PIN;
    if (led["type"].isNull()) led["type"] = DEFAULT_STATUS_LED_TYPE;
    if (led["mode"].isNull()) led["mode"] = DEFAULT_STATUS_LED_MODE;
#endif
}

bool gpioAllowed(int pin) {
    if (pin < 0) return true;
#if defined(OT_PLATFORM_ESP32S3)
    return pin <= 48 && pin != 19 && pin != 20 && !(pin >= 22 && pin <= 32);
#else
    return pin <= 39 && !(pin >= 6 && pin <= 11);
#endif
}

bool outputGpioAllowed(int pin) {
    if (!gpioAllowed(pin)) return false;
#if defined(OT_PLATFORM_ESP32)
    return pin < 0 || (pin != 34 && pin != 35 && pin != 36 && pin != 39);
#else
    return pin != 46;
#endif
}

bool adcGpioAllowed(int pin) {
    if (pin < 0) return true;
#if defined(OT_PLATFORM_ESP32S3)
    return pin >= 1 && pin <= 10;
#else
    return pin == 32 || pin == 33 || pin == 34 || pin == 35 || pin == 36 || pin == 39;
#endif
}

int jsonPin(JsonVariantConst object, const char* field) {
    return object[field].isNull() ? -1 : object[field].as<int>();
}

bool enabled(JsonVariantConst object) {
    return !object["enabled"].isNull() && object["enabled"].as<bool>();
}

bool registryHasRole(const ChannelRegistry* registry, ChannelRegistry::Direction direction, const char* role) {
    if (!registry) return false;
    const ChannelRegistry::Channel* channels = direction == ChannelRegistry::Input
        ? registry->inputs
        : registry->outputs;
    const uint8_t count = direction == ChannelRegistry::Input
        ? registry->inputCount
        : registry->outputCount;
    for (uint8_t i = 0; i < count; ++i) {
        if (channels[i].installed && strcmp(channels[i].role, role) == 0) return true;
    }
    return false;
}

bool registryHasPurpose(const ChannelRegistry* registry, ChannelRegistry::Direction direction, const char* purpose) {
    if (!registry) return false;
    const ChannelRegistry::Channel* channels = direction == ChannelRegistry::Input
        ? registry->inputs
        : registry->outputs;
    const uint8_t count = direction == ChannelRegistry::Input
        ? registry->inputCount
        : registry->outputCount;
    for (uint8_t i = 0; i < count; ++i) {
        if (channels[i].installed && strcmp(channels[i].purpose, purpose) == 0) return true;
    }
    return false;
}

bool registryHasAddressablePurpose(const ChannelRegistry* registry,
                                   ChannelRegistry::Direction direction,
                                   const char* purpose) {
    if (!registry) return false;
    const ChannelRegistry::Channel* channels = direction == ChannelRegistry::Input
        ? registry->inputs : registry->outputs;
    const uint8_t count = direction == ChannelRegistry::Input
        ? registry->inputCount : registry->outputCount;
    for (uint8_t i = 0; i < count; ++i)
        if (!strcmp(channels[i].purpose, purpose) &&
            ChannelRegistry::channelAddressable(channels[i])) return true;
    return false;
}

bool docHasDiRole(const JsonDocument& doc, const char* wantedRole) {
    if (!doc["di_channels"].is<JsonArrayConst>()) return false;
    for (JsonVariantConst ch : doc["di_channels"].as<JsonArrayConst>()) {
        const char* role = ch["role"] | "none";
        if (strcmp(role, wantedRole) == 0 && jsonPin(ch, "pin") >= 0) return true;
    }
    return false;
}

bool registryHasBinding(const ChannelRegistry* registry, const char* key, ChannelRegistry::Direction direction) {
    if (!registry) return false;
    for (uint8_t i = 0; i < registry->bindingCount; ++i) {
        if (strcmp(registry->bindings[i].key, key) == 0 &&
            registry->find(registry->bindings[i].channelId, direction)) return true;
    }
    return false;
}

bool docSensorEnabled(const JsonDocument& doc, const char* key) {
    return enabled(doc["sensors"][key]);
}

bool docActuatorEnabled(const JsonDocument& doc, const char* key) {
    return enabled(doc["actuators"][key]);
}

bool validateHardwareDependencies(const JsonDocument& doc, const ChannelRegistry* registry) {
    const bool hasN1 = docSensorEnabled(doc, "n1_rpm") ||
                       registryHasBinding(registry, "primary_n1", ChannelRegistry::Input) ||
                       registryHasPurpose(registry, ChannelRegistry::Input, "n1_speed");
    const bool hasN2 = docSensorEnabled(doc, "n2_rpm") ||
                        registryHasBinding(registry, "primary_n2", ChannelRegistry::Input) ||
                        registryHasPurpose(registry, ChannelRegistry::Input, "n2_speed");
    const bool hasP1 = docSensorEnabled(doc, "p1") ||
                       registryHasPurpose(registry, ChannelRegistry::Input, "p1_pressure");
    const bool hasP2 = docSensorEnabled(doc, "p2") ||
                       registryHasPurpose(registry, ChannelRegistry::Input, "p2_pressure");
    const bool hasEgt = docSensorEnabled(doc, "tot") || docSensorEnabled(doc, "tit") ||
                        registryHasBinding(registry, "primary_egt", ChannelRegistry::Input) ||
                        registryHasPurpose(registry, ChannelRegistry::Input, "tot") ||
                        registryHasPurpose(registry, ChannelRegistry::Input, "tit");
    const bool hasOilPress = docSensorEnabled(doc, "oil_press") ||
                             registryHasPurpose(registry, ChannelRegistry::Input, "oil_pressure");
    const bool hasLowOilSafetyInput = hasOilPress ||
                                      docHasDiRole(doc, "low_oil_switch") ||
                                      registryHasPurpose(registry, ChannelRegistry::Input, "low_oil_switch") ||
                                      registryHasRole(registry, ChannelRegistry::Input, "low_oil_switch");
    const bool hasZeroOilSafetyInput = hasOilPress ||
                                       docHasDiRole(doc, "oil_zero_switch") ||
                                       registryHasPurpose(registry, ChannelRegistry::Input, "oil_zero_switch") ||
                                       registryHasRole(registry, ChannelRegistry::Input, "oil_zero_switch");
    const bool hasThrottle = docActuatorEnabled(doc, "throttle") ||
                             registryHasBinding(registry, "main_fuel_output", ChannelRegistry::Output) ||
                             registryHasPurpose(registry, ChannelRegistry::Output, "main_fuel");
    const bool hasOilPump = docActuatorEnabled(doc, "oil_pump") ||
                            registryHasRole(registry, ChannelRegistry::Output, "oil_pump");
    const int propPitchType = doc["actuators"]["prop_pitch"]["type"] | 0;
    const bool hasUsablePropPitch =
        registryHasRole(registry, ChannelRegistry::Output, "prop_pitch") ||
        registryHasPurpose(registry, ChannelRegistry::Output, "prop_pitch") ||
        docActuatorEnabled(doc, "prop_pitch");
    bool registryMeteringFuel = false;
    if (registry) for (uint8_t i = 0; i < registry->outputCount; ++i) {
        const auto& c = registry->outputs[i];
        if (c.installed && !strcmp(c.purpose, "main_fuel") &&
            ChannelRegistry::driverIsProportionalOutput(c.driver)) {
            registryMeteringFuel = true;
            break;
        }
    }
    const int throttleType = doc["actuators"]["throttle"]["type"] | 0;
    const bool hasMeteringThrottle =
        (docActuatorEnabled(doc, "throttle") && throttleType != 2) || registryMeteringFuel;

    JsonVariantConst controllers = doc["controllers"];
    if ((controllers["oil_loop"] | false) && (!hasOilPress || !hasOilPump)) return false;
    if ((controllers["dynamic_idle"] | false) && (!hasMeteringThrottle || (!hasN1 && !hasN2 && !hasP1 && !hasP2))) return false;
    if ((controllers["governor"] | false) && (!hasN2 || (!hasMeteringThrottle && !hasUsablePropPitch))) return false;

    JsonVariantConst safety = doc["safety"];
    if ((safety["overspeed"] | false) && !hasN1) return false;
    if ((safety["n2_overspeed"] | false) && !hasN2) return false;
    if ((safety["surge"] | false) && !hasN1) return false;
    if (((safety["overtemp"] | false) || (safety["tit_overtemp"] | false)) && !hasEgt) return false;
    if ((safety["hot_start"] | false) && !hasEgt) return false;
    if ((safety["low_oil"] | false) && !hasLowOilSafetyInput) return false;
    if ((safety["oil_zero"] | false) && !hasZeroOilSafetyInput) return false;
    if ((safety["oil_temp_high"] | false) &&
        !docSensorEnabled(doc, "oil_temp") &&
        !registryHasPurpose(registry, ChannelRegistry::Input, "oil_temperature")) return false;
    if ((safety["fuel_press_low"] | false) &&
        !docSensorEnabled(doc, "fuel_press") &&
        !registryHasPurpose(registry, ChannelRegistry::Input, "fuel_pressure")) return false;
    if ((safety["batt_low"] | false) &&
        !docSensorEnabled(doc, "batt_voltage") &&
        !registryHasPurpose(registry, ChannelRegistry::Input, "battery_voltage")) return false;
    return true;
}

bool validateOilLoops(JsonVariantConst loops, const ChannelRegistry* registry) {
    if (loops.isNull()) return true;
    if (!loops.is<JsonArrayConst>() || !registry) return false;
    if (loops.size() > HardwareConfig::MAX_OIL_LOOPS) return false;
    auto inRange = [](JsonObjectConst o, const char* key, float lo, float hi) {
        JsonVariantConst v = o[key];
        if (v.isNull()) return true;
        if (!v.is<float>() && !v.is<double>() && !v.is<int>() &&
            !v.is<long>() && !v.is<unsigned int>() && !v.is<unsigned long>()) return false;
        float f = v.as<float>();
        return f >= lo && f <= hi;
    };
    char usedIds[HardwareConfig::MAX_OIL_LOOPS][20] = {};
    char usedPumps[HardwareConfig::MAX_OIL_LOOPS][20] = {};
    uint8_t idCount = 0, pumpCount = 0;
    for (JsonObjectConst loop : loops.as<JsonArrayConst>()) {
        const char* id = loop["id"] | "";
        const char* pressure = loop["pressure_input"] | "";
        const char* pump = loop["pump_output"] | "";
        if (!ChannelRegistry::validId(id) || strlen(id) >= sizeof(HardwareConfig::oilLoops[0].id) ||
            !ChannelRegistry::validId(pressure) ||
            !ChannelRegistry::validId(pump)) return false;
        for (uint8_t i = 0; i < idCount; i++) if (!strcmp(usedIds[i], id)) return false;
        strlcpy(usedIds[idCount++], id, sizeof(usedIds[0]));
        const auto* pressureCh = registry->find(pressure, ChannelRegistry::Input);
        const auto* pumpCh = registry->find(pump, ChannelRegistry::Output);
        if (!pressureCh || !pumpCh ||
            strcmp(pressureCh->role, "pressure") != 0 ||
            strcmp(pressureCh->purpose, "oil_pressure") != 0 ||
            strcmp(pumpCh->role, "oil_pump") != 0) return false;
        if (!inRange(loop, "target_bar", 0.0f, 20.0f) ||
            !inRange(loop, "target_high_bar", 0.0f, 20.0f) ||
            !inRange(loop, "speed_min_rpm", 0.0f, 6553500.0f) ||
            !inRange(loop, "speed_max_rpm", 0.0f, 6553500.0f) ||
            !inRange(loop, "deadband_bar", 0.0f, 5.0f) ||
            !inRange(loop, "response_gain", 0.0f, 100.0f) ||
            !inRange(loop, "failsafe_delay_ms", 0.0f, 60000.0f) ||
            !inRange(loop, "low_pressure_bar", 0.0f, 20.0f) ||
            !inRange(loop, "low_pressure_confirm_ms", 0.0f, 60000.0f) ||
            !inRange(loop, "immediate_pump_run_s", 0.0f, 120.0f) ||
            !inRange(loop, "failsafe_demand", 0.0f, 1.0f) ||
            !inRange(loop, "min_demand", 0.0f, 1.0f) ||
            !inRange(loop, "max_demand", 0.0f, 1.0f)) return false;
        const int targetSource = loop["target_source"] | 0;
        const int lowResponse = loop["low_pressure_response"] | (int)HardwareConfig::OilFaultShutdown;
        const int feedbackResponse = loop["feedback_loss_response"] | (int)HardwareConfig::OilFaultShutdown;
        if (targetSource < 0 || targetSource > 3 ||
            lowResponse < HardwareConfig::OilFaultDisabled || lowResponse > HardwareConfig::OilFaultImmediateStop ||
            feedbackResponse < HardwareConfig::OilFaultDisabled || feedbackResponse > HardwareConfig::OilFaultImmediateStop ||
            (loop["max_demand"] | 1.0f) < (loop["min_demand"] | 0.0f) ||
            ((targetSource == 2 || targetSource == 3) &&
             (loop["speed_max_rpm"] | 20000.0f) <= (loop["speed_min_rpm"] | 0.0f))) return false;
        if (targetSource == 2 && !registryHasPurpose(registry, ChannelRegistry::Input, "n1_speed")) return false;
        if (targetSource == 3 && !registryHasPurpose(registry, ChannelRegistry::Input, "n2_speed")) return false;
        if (loop["enabled"] | false) {
            for (uint8_t i = 0; i < pumpCount; i++) if (!strcmp(usedPumps[i], pump)) return false;
            strlcpy(usedPumps[pumpCount++], pump, sizeof(usedPumps[0]));
        }
    }
    return true;
}

int customSensorId(const char* key) {
    if (!key) return -1;
    for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; ++i)
        if (strcmp(key, HardwareConfig::channelRegistry.inputs[i].id) == 0)
            return ChannelRegistry::INPUT_SENSOR_BASE + i;
    if (strcmp(key, "oil_temp") == 0) return 0;
    if (strcmp(key, "tot") == 0) return 1;
    if (strcmp(key, "n1_rpm") == 0) return 2;
    if (strcmp(key, "oil_press") == 0) return 3;
    if (strcmp(key, "tit") == 0) return 4;
    if (strcmp(key, "batt_voltage") == 0) return 5;
    if (strcmp(key, "n2_rpm") == 0) return 6;
    if (strcmp(key, "di0") == 0) return 7;
    if (strcmp(key, "di1") == 0) return 8;
    if (strcmp(key, "di2") == 0) return 9;
    if (strcmp(key, "di3") == 0) return 10;
    if (strcmp(key, "fuel_press") == 0) return 11;
    if (strcmp(key, "fuel_flow") == 0) return 12;
    if (strcmp(key, "p1") == 0) return 13;
    if (strcmp(key, "p2") == 0) return 14;
    if (strcmp(key, "torque") == 0) return 15;
    if (strcmp(key, "flame") == 0) return 16;
    if (strcmp(key, "throttle_in") == 0) return 17;
    if (strcmp(key, "idle_in") == 0) return 18;
    if (strcmp(key, "ab_flame") == 0) return 19;
    if (strcmp(key, "glow_current") == 0) return 20;
    if (strcmp(key, "igniter_current") == 0) return 21;
    if (strcmp(key, "igniter2_current") == 0) return 22;
    if (strcmp(key, "oil_pump_current") == 0) return 23;
    if (strcmp(key, "ab_input") == 0) return 24;
    if (strcmp(key, "start_switch") == 0) return 25;
    if (strcmp(key, "stop_switch") == 0) return 26;
    if (strcmp(key, "thrust") == 0) return 27;
    return -1;
}

const char* customSensorKey(uint8_t sensor) {
    if (ChannelRegistry::isInputSensor(sensor)) {
        uint8_t idx = ChannelRegistry::inputIndexFromSensor(sensor);
        if (idx < HardwareConfig::channelRegistry.inputCount)
            return HardwareConfig::channelRegistry.inputs[idx].id;
    }
    static const char* const keys[] = {
        "oil_temp", "tot", "n1_rpm", "oil_press", "tit", "batt_voltage",
        "n2_rpm", "di0", "di1", "di2", "di3", "fuel_press", "fuel_flow",
        "p1", "p2", "torque", "flame", "throttle_in", "idle_in",
        "ab_flame", "glow_current", "igniter_current", "igniter2_current",
        "oil_pump_current", "ab_input", "start_switch", "stop_switch", "thrust"
    };
    return sensor < (sizeof(keys) / sizeof(keys[0])) ? keys[sensor] : "";
}

int customActuatorId(const char* key) {
    if (!key) return -1;
    for (uint8_t i = 0; i < HardwareConfig::channelRegistry.outputCount; ++i) {
        const auto& out = HardwareConfig::channelRegistry.outputs[i];
        if (strcmp(key, out.id) == 0 &&
            !HardwareConfig::channelRegistry.ownsCoreOutput(out) &&
            !HardwareConfig::channelRegistry.boundToCoreOutput(out))
            return ChannelRegistry::OUTPUT_ACTUATOR_BASE + i;
    }
    if (strcmp(key, "cool_fan") == 0) return 0;
    if (strcmp(key, "cooling_fan") == 0 || strcmp(key, "cooling_fan_main") == 0) return 0;
    if (strcmp(key, "bleed_valve") == 0) return 1;
    if (strcmp(key, "bleed_valve_main") == 0) return 1;
    if (strcmp(key, "fuel_pump2") == 0 || strcmp(key, "fuel_pump") == 0 || strcmp(key, "fuel_pump2_main") == 0) return 2;
    if (strcmp(key, "oil_scavenge_pump") == 0) return 3;
    if (strcmp(key, "oil_scavenge_main") == 0 || strcmp(key, "scavenge_pump") == 0) return 3;
    if (strcmp(key, "throttle") == 0) return 4;
    if (strcmp(key, "main_fuel") == 0 || strcmp(key, "main_fuel_output") == 0) return 4;
    if (strcmp(key, "starter") == 0) return 5;
    if (strcmp(key, "starter_main") == 0 || strcmp(key, "main_starter") == 0) return 5;
    if (strcmp(key, "starter_en") == 0 || strcmp(key, "starter_enable") == 0 || strcmp(key, "starter_enable_main") == 0) return 6;
    if (strcmp(key, "oil_pump") == 0) return 7;
    if (strcmp(key, "oil_pump_main") == 0) return 7;
    if (strcmp(key, "fuel_sol") == 0 || strcmp(key, "fuel_shutoff") == 0 || strcmp(key, "fuel_solenoid_main") == 0 || strcmp(key, "main_fuel_shutoff") == 0) return 8;
    if (strcmp(key, "igniter") == 0) return 9;
    if (strcmp(key, "igniter_main") == 0) return 9;
    if (strcmp(key, "igniter2") == 0) return 10;
    if (strcmp(key, "ab_igniter") == 0) return 10;
    if (strcmp(key, "igniter2_main") == 0) return 10;
    if (strcmp(key, "ab_sol") == 0 || strcmp(key, "ab_solenoid") == 0 || strcmp(key, "ab_solenoid_main") == 0) return 11;
    if (strcmp(key, "ab_pump") == 0 || strcmp(key, "ab_pump_main") == 0) return 12;
    if (strcmp(key, "airstarter_sol") == 0 || strcmp(key, "air_starter") == 0 || strcmp(key, "airstarter_main") == 0) return 15;
    if (strcmp(key, "glow_plug") == 0 || strcmp(key, "glow_plug_main") == 0) return 16;
    if (strcmp(key, "prop_pitch") == 0 || strcmp(key, "prop_pitch_main") == 0) return 17;
    return -1;
}

const char* customActuatorKey(uint8_t act) {
    if (ChannelRegistry::isOutputActuator(act)) {
        uint8_t idx = ChannelRegistry::outputIndexFromActuator(act);
        if (idx < HardwareConfig::channelRegistry.outputCount)
            return HardwareConfig::channelRegistry.outputs[idx].id;
    }
    switch (act) {
        case 0: return "cool_fan";
        case 1: return "bleed_valve";
        case 2: return "fuel_pump2";
        case 3: return "oil_scavenge_pump";
        case 4: return "throttle";
        case 5: return "starter";
        case 6: return "starter_en";
        case 7: return "oil_pump";
        case 8: return "fuel_sol";
        case 9: return "igniter";
        case 10: return "igniter2";
        case 11: return "ab_sol";
        case 12: return "ab_pump";
        case 15: return "airstarter_sol";
        case 16: return "glow_plug";
        case 17: return "prop_pitch";
        default: return "";
    }
}

const char* sequenceSourceId(uint8_t sensor) {
    if (ChannelRegistry::isInputSensor(sensor)) {
        uint8_t idx = ChannelRegistry::inputIndexFromSensor(sensor);
        if (idx < HardwareConfig::channelRegistry.inputCount)
            return HardwareConfig::channelRegistry.inputs[idx].id;
    }
    switch (sensor) {
        case 0:  return "oil_temp_main";
        case 1:  return "tot_main";
        case 2:  return "n1_main";
        case 3:  return "oil_pressure_main";
        case 4:  return "tit_main";
        case 5:  return "batt_voltage_main";
        case 6:  return "n2_main";
        case 7:  return "di0";
        case 8:  return "di1";
        case 9:  return "di2";
        case 10: return "di3";
        case 11: return "fuel_pressure_main";
        case 12: return "fuel_flow_main";
        case 13: return "p1_main";
        case 14: return "p2_main";
        case 15: return "torque_main";
        case 16: return "flame_main";
        case 17: return "operator_throttle";
        case 18: return "operator_idle";
        case 19: return "ab_flame_main";
        case 20: return "glow_current_main";
        case 21: return "igniter_current_main";
        case 22: return "igniter2_current_main";
        case 23: return "oil_pump_current_main";
        case 24: return "ab_input_main";
        case 25: return "start_switch";
        case 26: return "stop_switch";
        case 27: return "thrust_main";
        default: return "";
    }
}

int8_t sequenceSourceHandle(const char* id) {
    if (!id || !id[0]) return -1;
    for (uint8_t i = 0; i <= 27; ++i) {
        if (strcmp(id, sequenceSourceId(i)) == 0 || strcmp(id, customSensorKey(i)) == 0)
            return (int8_t)i;
    }
    if (strcmp(id, "primary_n1") == 0) return 2;
    if (strcmp(id, "primary_n2") == 0) return 6;
    if (strcmp(id, "primary_egt") == 0) return 1;
    if (strcmp(id, "operator_throttle") == 0 || strcmp(id, "throttle_input") == 0) return 17;
    if (strcmp(id, "operator_idle") == 0) return 18;
    if (strcmp(id, "oil_temp") == 0) return 0;
    if (strcmp(id, "tot") == 0) return 1;
    if (strcmp(id, "n1_rpm") == 0) return 2;
    if (strcmp(id, "oil_press") == 0) return 3;
    if (strcmp(id, "tit") == 0) return 4;
    if (strcmp(id, "batt_voltage") == 0) return 5;
    if (strcmp(id, "n2_rpm") == 0) return 6;
    if (strcmp(id, "fuel_press") == 0) return 11;
    if (strcmp(id, "fuel_flow") == 0) return 12;
    if (strcmp(id, "p1") == 0) return 13;
    if (strcmp(id, "p2") == 0) return 14;
    if (strcmp(id, "torque") == 0) return 15;
    if (strcmp(id, "flame") == 0) return 16;
    if (strcmp(id, "idle_in") == 0 || strcmp(id, "idle_input") == 0) return 18;
    if (strcmp(id, "ab_flame") == 0) return 19;
    if (strcmp(id, "glow_current") == 0) return 20;
    if (strcmp(id, "igniter_current") == 0) return 21;
    if (strcmp(id, "igniter2_current") == 0) return 22;
    if (strcmp(id, "oil_pump_current") == 0) return 23;
    if (strcmp(id, "ab_input") == 0) return 24;
    if (strcmp(id, "thrust") == 0) return 27;
    for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; ++i) {
        const auto& in = HardwareConfig::channelRegistry.inputs[i];
        if (strcmp(in.id, id) != 0) continue;
        return (int8_t)(ChannelRegistry::INPUT_SENSOR_BASE + i);
    }
    return -1;
}

const char* sequenceTargetId(uint8_t act) {
    if (ChannelRegistry::isOutputActuator(act)) {
        uint8_t idx = ChannelRegistry::outputIndexFromActuator(act);
        if (idx < HardwareConfig::channelRegistry.outputCount)
            return HardwareConfig::channelRegistry.outputs[idx].id;
    }
    switch (act) {
        case 0:  return "cooling_fan_main";
        case 1:  return "bleed_valve_main";
        case 2:  return "fuel_pump2_main";
        case 3:  return "oil_scavenge_main";
        case 4:  return "main_fuel";
        case 5:  return "starter_main";
        case 6:  return "starter_enable_main";
        case 7:  return "oil_pump_main";
        case 8:  return "fuel_solenoid_main";
        case 9:  return "igniter_main";
        case 10: return "igniter2_main";
        case 11: return "ab_solenoid_main";
        case 12: return "ab_pump_main";
        case 13: return "request_shutdown";
        case 14: return "request_fault";
        case 15: return "airstarter_main";
        case 16: return "glow_plug_main";
        case 17: return "prop_pitch_main";
        default: return "";
    }
}

int8_t sequenceTargetHandle(const char* id) {
    if (!id || !id[0]) return -1;
    for (uint8_t i = 0; i <= 17; ++i) {
        if (strcmp(id, sequenceTargetId(i)) == 0 || strcmp(id, customActuatorKey(i)) == 0)
            return (int8_t)i;
    }
    if (strcmp(id, "main_fuel_output") == 0) return 4;
    if (strcmp(id, "main_starter") == 0) return 5;
    if (strcmp(id, "main_fuel_shutoff") == 0) return 8;
    if (strcmp(id, "ab_igniter") == 0) return 10;
    if (strcmp(id, "igniter2_main") == 0) return 10;
    if (strcmp(id, "fuel_pump") == 0) return 2;
    if (strcmp(id, "scavenge_pump") == 0) return 3;
    if (strcmp(id, "starter_enable") == 0) return 6;
    if (strcmp(id, "fuel_shutoff") == 0) return 8;
    if (strcmp(id, "ab_solenoid") == 0) return 11;
    if (strcmp(id, "air_starter") == 0) return 15;
    for (uint8_t i = 0; i < HardwareConfig::channelRegistry.outputCount; ++i) {
        const auto& out = HardwareConfig::channelRegistry.outputs[i];
        if (strcmp(out.id, id) != 0) continue;
        if (!HardwareConfig::channelRegistry.ownsCoreOutput(out) &&
            !HardwareConfig::channelRegistry.boundToCoreOutput(out))
            return (int8_t)(ChannelRegistry::OUTPUT_ACTUATOR_BASE + i);
        if (!strcmp(out.purpose, "main_fuel")) return 4;
        if (!strcmp(out.purpose, "starter")) return 5;
        if (!strcmp(out.purpose, "starter_enable")) return 6;
        if (!strcmp(out.purpose, "oil_pump")) return 7;
        if (!strcmp(out.purpose, "cooling_fan")) return 0;
        if (!strcmp(out.purpose, "bleed_valve")) return 1;
        if (!strcmp(out.purpose, "scavenge_pump")) return 3;
        if (!strcmp(out.purpose, "fuel_pump")) return 2;
        if (!strcmp(out.purpose, "fuel_shutoff")) return 8;
        if (!strcmp(out.purpose, "igniter")) return 9;
        if (!strcmp(out.purpose, "ab_igniter")) return 10;
        if (!strcmp(out.purpose, "ab_valve")) return 11;
        if (!strcmp(out.purpose, "ab_pump")) return 12;
        if (!strcmp(out.purpose, "air_starter")) return 15;
        if (!strcmp(out.purpose, "glow_plug")) return 16;
        if (!strcmp(out.purpose, "prop_pitch")) return 17;
        return -1;
    }
    return -1;
}

bool customActuatorIsAnalog(uint8_t act) {
    if (ChannelRegistry::isOutputActuator(act)) {
        uint8_t idx = ChannelRegistry::outputIndexFromActuator(act);
        if (idx >= HardwareConfig::channelRegistry.outputCount) return false;
        auto driver = HardwareConfig::channelRegistry.outputs[idx].driver;
        return driver == ChannelRegistry::Pwm || driver == ChannelRegistry::Servo;
    }
    switch (act) {
        case 2:  return HardwareConfig::fuelPump2Type != 2;
        case 4:  return HardwareConfig::throttleType != 2;
        case 5:  return HardwareConfig::starterType != 2;
        case 7:  return HardwareConfig::oilPumpType != 2;
        case 12: return HardwareConfig::abPumpType != 2;
        case 16: return HardwareConfig::glowPlugOutputType != 1;
        case 17: return HardwareConfig::propPitchType != 2;
        default: return false;
    }
}

float customThresholdToStored(uint8_t sensor, float value) {
    return (sensor == 17 || sensor == 18 || sensor == 24) ? constrain(value, 0.0f, 100.0f) / 100.0f : value;
}

float customThresholdToDisplay(uint8_t sensor, float value) {
    return (sensor == 17 || sensor == 18 || sensor == 24) ? value * 100.0f : value;
}

float customActuatorValueToStored(uint8_t actuator, float value) {
    if (customActuatorIsAnalog(actuator)) return constrain(value, 0.0f, 100.0f) / 100.0f;
    return RelayDemand::binary(RelayDemand::requested(value));
}

float customActuatorValueToDisplay(uint8_t actuator, float value) {
    if (customActuatorIsAnalog(actuator)) return value * 100.0f;
    return RelayDemand::binary(RelayDemand::requested(value));
}

uint8_t customOpId(const char* op) {
    if (!op) return 0;
    if (strcmp(op, "<") == 0) return 1;
    if (strcmp(op, ">=") == 0) return 2;
    if (strcmp(op, "<=") == 0) return 3;
    if (strcmp(op, "==") == 0 || strcmp(op, "=") == 0) return 4;
    return 0;
}

const char* customOpString(uint8_t op) {
    switch (op) {
        case 1: return "<";
        case 2: return ">=";
        case 3: return "<=";
        case 4: return "==";
        default: return ">";
    }
}

void clearSeqSideActions(
    HardwareConfig::SeqSideAction actions[HardwareConfig::MAX_SEQ_BLOCKS][HardwareConfig::MAX_SEQ_SIDE_ACTIONS]) {
    memset(actions, 0, sizeof(HardwareConfig::SeqSideAction) *
                       HardwareConfig::MAX_SEQ_BLOCKS *
                       HardwareConfig::MAX_SEQ_SIDE_ACTIONS);
}

void writeSeqSideActions(
    JsonObject doc, const char* key, int seqLen,
    HardwareConfig::SeqSideAction actions[HardwareConfig::MAX_SEQ_BLOCKS][HardwareConfig::MAX_SEQ_SIDE_ACTIONS]) {
    JsonArray outer = doc[key].to<JsonArray>();
    for (int i = 0; i < seqLen; i++) {
        JsonArray slot = outer.add<JsonArray>();
        for (int j = 0; j < HardwareConfig::MAX_SEQ_SIDE_ACTIONS; j++) {
            const auto& a = actions[i][j];
            if (!a.enabled) continue;
            JsonObject item = slot.add<JsonObject>();
            item["act"] = a.actuator;
            item["target"] = a.targetId[0] ? a.targetId : sequenceTargetId(a.actuator);
            item["value"] = a.value;
        }
    }
}

void readSeqSideActions(
    const JsonDocument& doc, const char* key, int seqLen,
    HardwareConfig::SeqSideAction actions[HardwareConfig::MAX_SEQ_BLOCKS][HardwareConfig::MAX_SEQ_SIDE_ACTIONS]) {
    clearSeqSideActions(actions);
    if (!doc[key].is<JsonArrayConst>()) return;
    JsonArrayConst outer = doc[key];
    for (int i = 0; i < seqLen && i < (int)outer.size() && i < HardwareConfig::MAX_SEQ_BLOCKS; i++) {
        if (!outer[i].is<JsonArrayConst>()) continue;
        JsonArrayConst slot = outer[i];
        int out = 0;
        for (JsonObjectConst item : slot) {
            if (out >= HardwareConfig::MAX_SEQ_SIDE_ACTIONS) break;
            const char* target = item["target"] | "";
            int act = target[0] ? sequenceTargetHandle(target) : (item["act"] | -1);
            if (!target[0] && act < 0) continue;
            if (act > 17 && !ChannelRegistry::isOutputActuator((uint8_t)act)) act = -1;
            actions[i][out].enabled = true;
            actions[i][out].actuator = act >= 0 ? (uint8_t)act : 255;
            strlcpy(actions[i][out].targetId, target, sizeof(actions[i][out].targetId));
            actions[i][out].value = constrain(item["value"] | 0.0f, 0.0f, 1.0f);
            out++;
        }
    }
}

void clearCustomBlocks() {
    memset(HardwareConfig::customBlocks, 0,
           sizeof(HardwareConfig::CustomBlockDef) * HardwareConfig::MAX_CUSTOM_BLOCKS);
    HardwareConfig::customBlockCount = 0;
}

void writeCustomBlocks(JsonObject doc) {
    JsonObject root = doc["custom_blocks"].to<JsonObject>();
    for (int i = 0; i < HardwareConfig::customBlockCount; i++) {
        const auto& def = HardwareConfig::customBlocks[i];
        if (!def.enabled || !def.key[0]) continue;
        JsonObject item = root[def.key].to<JsonObject>();
        item["label"] = def.label;
        item["desc"] = def.desc;
        item["type"] = def.type == 1 ? "wait" : (def.type == 2 ? "while" : "action");
        JsonArray steps = item["steps"].to<JsonArray>();
        for (uint8_t s = 0; s < def.stepCount; s++) {
            const auto& step = def.steps[s];
            JsonObject so = steps.add<JsonObject>();
            if (step.type == 1) {
                so["type"] = "delay_ms";
                so["val"] = step.delayMs;
            } else {
                so["type"] = "set_act";
                so["act"] = customActuatorKey(step.actuator);
                so["target"] = step.targetId[0] ? step.targetId : sequenceTargetId(step.actuator);
                so["val"] = step.actuator == 255 && step.valueIsPercent
                    ? step.value * 100.0f
                    : customActuatorValueToDisplay(step.actuator, step.value);
            }
        }
        if (def.type == 1) {
            item["duration_ms"] = def.durationMs;
        } else if (def.type == 2) {
            JsonObject cond = item["condition"].to<JsonObject>();
            cond["sensor"] = customSensorKey(def.sensor);
            cond["source"] = def.sensorId[0] ? def.sensorId : sequenceSourceId(def.sensor);
            cond["op"] = customOpString(def.op);
            cond["value"] = customThresholdToDisplay(def.sensor, def.threshold);
            cond["stable_ms"] = def.stableMs;
            cond["relative_to_entry"] = def.relativeToEntry;
            item["timeout_ms"] = def.timeoutMs;
            item["timeout_action"] = def.timeoutAction == 1 ? "fault" :
                                     (def.timeoutAction == 2 ? "continue" : "abort");
        }
    }
}

void readCustomBlocks(const JsonDocument& doc) {
    clearCustomBlocks();
    if (!doc["custom_blocks"].is<JsonObjectConst>()) return;
    JsonObjectConst root = doc["custom_blocks"];
    for (JsonPairConst kv : root) {
        if (HardwareConfig::customBlockCount >= HardwareConfig::MAX_CUSTOM_BLOCKS) break;
        const char* key = kv.key().c_str();
        if (!key || strncmp(key, "custom_", 7) != 0) continue;
        JsonObjectConst item = kv.value().as<JsonObjectConst>();
        if (item.isNull()) continue;

        HardwareConfig::CustomBlockDef def{};
        def.enabled = true;
        strncpy(def.key, key, sizeof(def.key) - 1);
        def.key[sizeof(def.key) - 1] = '\0';
        strncpy(def.label, item["label"] | key, sizeof(def.label) - 1);
        def.label[sizeof(def.label) - 1] = '\0';
        strncpy(def.desc, item["desc"] | "", sizeof(def.desc) - 1);
        def.desc[sizeof(def.desc) - 1] = '\0';
        const char* type = item["type"] | "action";
        def.type = strcmp(type, "wait") == 0 ? 1 : (strcmp(type, "while") == 0 ? 2 : 0);
        def.durationMs = constrain((uint32_t)(item["duration_ms"] | 1000UL), 100UL, 600000UL);
        def.timeoutMs = constrain((uint32_t)(item["timeout_ms"] | 10000UL), 0UL, 600000UL);
        const char* timeoutAction = item["timeout_action"] | "abort";
        def.timeoutAction = strcmp(timeoutAction, "fault") == 0 ? 1 :
                            (strcmp(timeoutAction, "continue") == 0 ? 2 : 0);

        if (def.type == 2 && item["condition"].is<JsonObjectConst>()) {
            JsonObjectConst cond = item["condition"];
            const char* source = cond["source"] | "";
            int sensor = source[0] ? sequenceSourceHandle(source) : customSensorId(cond["sensor"] | "");
            if (!source[0] && sensor < 0) continue;
            def.sensor = sensor >= 0 ? (uint8_t)sensor : 255;
            strlcpy(def.sensorId, source, sizeof(def.sensorId));
            def.op = customOpId(cond["op"] | ">");
            def.threshold = customThresholdToStored(def.sensor, cond["value"] | 0.0f);
            def.stableMs = constrain((uint32_t)(cond["stable_ms"] | 0UL), 0UL, 600000UL);
            def.relativeToEntry = cond["relative_to_entry"] | false;
        }

        if (item["steps"].is<JsonArrayConst>()) {
            JsonArrayConst steps = item["steps"];
            for (JsonObjectConst step : steps) {
                if (def.stepCount >= HardwareConfig::MAX_CUSTOM_STEPS) break;
                const char* st = step["type"] | "";
                auto& out = def.steps[def.stepCount];
                if (strcmp(st, "delay_ms") == 0) {
                    out.type = 1;
                    out.delayMs = constrain((uint32_t)(step["val"] | 0UL), 0UL, 600000UL);
                    def.stepCount++;
                } else if (strcmp(st, "set_act") == 0) {
                    const char* target = step["target"] | "";
                    int act = target[0] ? sequenceTargetHandle(target) : customActuatorId(step["act"] | "");
                    if (!target[0] && act < 0) continue;
                    out.type = 0;
                    out.actuator = act >= 0 ? (uint8_t)act : 255;
                    strlcpy(out.targetId, target, sizeof(out.targetId));
                    out.valueIsPercent = act < 0 && (step["val"] | 0.0f) > 1.0f;
                    out.value = act >= 0
                        ? customActuatorValueToStored(out.actuator, step["val"] | 0.0f)
                        : out.valueIsPercent
                            ? constrain(step["val"] | 0.0f, 0.0f, 100.0f) / 100.0f
                            : RelayDemand::binary(RelayDemand::requested(step["val"] | 0.0f));
                    def.stepCount++;
                }
            }
        }

        if (def.type == 0 && def.stepCount == 0) continue;
        HardwareConfig::customBlocks[HardwareConfig::customBlockCount++] = def;
    }
}

bool seqActionActuatorAvailable(uint8_t act) {
    if (ChannelRegistry::isOutputActuator(act)) {
        uint8_t idx = ChannelRegistry::outputIndexFromActuator(act);
        if (idx >= HardwareConfig::channelRegistry.outputCount) return false;
        const auto& out = HardwareConfig::channelRegistry.outputs[idx];
        return ChannelRegistry::channelAddressable(out) &&
               !HardwareConfig::channelRegistry.ownsCoreOutput(out) &&
               !HardwareConfig::channelRegistry.boundToCoreOutput(out);
    }
    switch (act) {
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
        case 15: return HardwareConfig::hasAirstarterSol;
        case 16: return HardwareConfig::hasGlowPlug;
        case 17: return HardwareConfig::hasPropPitch;
        default: return false;
    }
}

bool ruleSensorAvailable(uint8_t sensor) {
    if (ChannelRegistry::isInputSensor(sensor)) {
        uint8_t idx = ChannelRegistry::inputIndexFromSensor(sensor);
        return idx < HardwareConfig::channelRegistry.inputCount &&
               ChannelRegistry::channelAddressable(HardwareConfig::channelRegistry.inputs[idx]);
    }
    switch (sensor) {
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
                        (HardwareConfig::abInputPin >= 0 ||
                         registryHasAddressablePurpose(&HardwareConfig::channelRegistry,
                             ChannelRegistry::Input, "ab_command"));
        case 25: return HardwareConfig::startPin >= 0 ||
                        registryHasAddressablePurpose(&HardwareConfig::channelRegistry,
                            ChannelRegistry::Input, "start_switch");
        case 26: return HardwareConfig::stopPin >= 0 ||
                        registryHasAddressablePurpose(&HardwareConfig::channelRegistry,
                            ChannelRegistry::Input, "stop_switch");
        case 27: return HardwareConfig::hasThrust;
        default: return false;
    }
}

int customBlockIndexByKey(const char* key) {
    if (!key || !key[0]) return -1;
    for (int i = 0; i < HardwareConfig::customBlockCount; i++) {
        if (HardwareConfig::customBlocks[i].enabled &&
            strcmp(HardwareConfig::customBlocks[i].key, key) == 0) return i;
    }
    return -1;
}

bool customBlockAvailable(const char* key) {
    int idx = customBlockIndexByKey(key);
    if (idx < 0) return false;
    const auto& def = HardwareConfig::customBlocks[idx];
    if (def.type > 2) return false;
    if (def.type == 2 && !ruleSensorAvailable(def.sensor)) return false;
    if (def.type == 0 && def.stepCount == 0) return false;
    for (uint8_t i = 0; i < def.stepCount; i++) {
        const auto& step = def.steps[i];
        if (step.type == 0 && !seqActionActuatorAvailable(step.actuator)) return false;
    }
    return true;
}

void sanitizeSeqSideActions(
    HardwareConfig::SeqSideAction actions[HardwareConfig::MAX_SEQ_BLOCKS][HardwareConfig::MAX_SEQ_SIDE_ACTIONS]) {
    for (int i = 0; i < HardwareConfig::MAX_SEQ_BLOCKS; i++) {
        int out = 0;
        for (int j = 0; j < HardwareConfig::MAX_SEQ_SIDE_ACTIONS; j++) {
            auto a = actions[i][j];
            if (!a.enabled) continue;
            a.value = constrain(a.value, 0.0f, 1.0f);
            actions[i][out++] = a;
        }
        for (; out < HardwareConfig::MAX_SEQ_SIDE_ACTIONS; out++) {
            actions[i][out] = HardwareConfig::SeqSideAction{};
        }
    }
}

bool sequenceBlockAvailable(const char* name) {
    if (!name || !name[0]) return false;
    if (strncmp(name, "custom_", 7) == 0) return customBlockAvailable(name);
    if (strcmp(name, "OilPrime") == 0 || strcmp(name, "OilPumpOn") == 0 || strcmp(name, "OilPumpOff") == 0)
        return HardwareConfig::hasOilPump;
    if (strcmp(name, "StarterSpin") == 0 || strcmp(name, "StarterOff") == 0)
        return HardwareConfig::hasStarter;
    if (strcmp(name, "FuelPumpIdle") == 0 || strcmp(name, "ModifiedIdle") == 0 ||
        strcmp(name, "Spool") == 0 || strcmp(name, "ThrottleSet") == 0)
        return HardwareConfig::hasThrottle;
    if (strcmp(name, "FuelOpen") == 0 || strcmp(name, "FuelSolClose") == 0 || strcmp(name, "FuelPulse") == 0)
        return HardwareConfig::hasFuelSol;
    if (strcmp(name, "PreIgnSpark") == 0)
        return HardwareConfig::hasIgniter;
    if (strcmp(name, "PreHeat") == 0 ||
        strcmp(name, "IgniterOn") == 0 || strcmp(name, "IgniterOff") == 0)
        return HardwareConfig::hasIgniter || HardwareConfig::hasIgniter2 || HardwareConfig::hasGlowPlug;
    if (strcmp(name, "FlameConfirm") == 0) return HardwareConfig::hasFlame;
    if (strcmp(name, "TempConfirm") == 0 || strcmp(name, "WaitTOTCool") == 0)
        return HardwareConfig::hasTot || HardwareConfig::hasTit;
    if (strcmp(name, "StarterEnOn") == 0 || strcmp(name, "StarterEnOff") == 0) return HardwareConfig::hasStarterEn;
    if (strcmp(name, "OilScavengeOn") == 0 || strcmp(name, "OilScavengeOff") == 0) return HardwareConfig::hasOilScavengePump;
    if (strcmp(name, "AirstarterOn") == 0 || strcmp(name, "AirstarterOff") == 0) return HardwareConfig::hasAirstarterSol;
    if (strcmp(name, "CoolFanOn") == 0 || strcmp(name, "CoolFanOff") == 0) return HardwareConfig::hasCoolFan;
    if (strcmp(name, "BleedOpen") == 0 || strcmp(name, "BleedClose") == 0) return HardwareConfig::hasBleedValve;
    if (strcmp(name, "GlowPreheat") == 0) return HardwareConfig::hasGlowPlug;
    if (strcmp(name, "FuelPumpRamp") == 0 || strcmp(name, "FuelPump2Set") == 0 ||
        strcmp(name, "FuelPump2On") == 0 || strcmp(name, "FuelPump2Off") == 0) return HardwareConfig::hasFuelPump2;
    if (strcmp(name, "GovernorHold") == 0)
        return HardwareConfig::hasGovernor && HardwareConfig::hasN2Rpm &&
               (HardwareConfig::hasThrottle || HardwareConfig::hasPropPitch);
    if (strncmp(name, "AB", 2) == 0 || strcmp(name, "ABSolOpen") == 0 || strcmp(name, "ABSolClose") == 0)
        return HardwareConfig::hasAfterburner;
    return true;
}

void sanitizeSequenceBlocks(
    char seq[HardwareConfig::MAX_SEQ_BLOCKS][24], int& len, int delays[HardwareConfig::MAX_SEQ_BLOCKS],
    uint8_t ignitionTargets[HardwareConfig::MAX_SEQ_BLOCKS],
    char deviceTargets[HardwareConfig::MAX_SEQ_BLOCKS][20],
    HardwareConfig::SeqSideAction enterActions[HardwareConfig::MAX_SEQ_BLOCKS][HardwareConfig::MAX_SEQ_SIDE_ACTIONS],
    HardwareConfig::SeqSideAction exitActions[HardwareConfig::MAX_SEQ_BLOCKS][HardwareConfig::MAX_SEQ_SIDE_ACTIONS]) {
    int out = 0;
    for (int i = 0; i < len; i++) {
        // Keep configured blocks even when their current hardware dependency
        // is absent. Runtime validation exposes the unresolved dependency and
        // inhibits the affected sequence; silently deleting user intent here
        // could later command a different device after hardware is replaced.
        if (!seq[i][0]) continue;
        if (out != i) {
            strncpy(seq[out], seq[i], sizeof(seq[out]) - 1);
            seq[out][sizeof(seq[out]) - 1] = '\0';
            delays[out] = delays[i];
            ignitionTargets[out] = constrain(ignitionTargets[i], 0, 2);
            strlcpy(deviceTargets[out], deviceTargets[i], sizeof(deviceTargets[out]));
            memcpy(enterActions[out], enterActions[i], sizeof(enterActions[out]));
            memcpy(exitActions[out], exitActions[i], sizeof(exitActions[out]));
        }
        out++;
    }
    for (int i = out; i < HardwareConfig::MAX_SEQ_BLOCKS; i++) {
        seq[i][0] = '\0';
        delays[i] = 0;
        ignitionTargets[i] = 0;
        deviceTargets[i][0] = '\0';
        memset(enterActions[i], 0, sizeof(enterActions[i]));
        memset(exitActions[i], 0, sizeof(exitActions[i]));
    }
    len = out;
}

bool intRange(JsonVariantConst object, const char* field, long minValue, long maxValue) {
    if (object[field].isNull()) return true;
    if (!object[field].is<int>() && !object[field].is<long>() &&
        !object[field].is<unsigned int>() && !object[field].is<unsigned long>()) return false;
    long value = object[field].as<long>();
    return value >= minValue && value <= maxValue;
}

bool numberRange(JsonVariantConst object, const char* field, float minValue, float maxValue) {
    if (object[field].isNull()) return true;
    if (!object[field].is<float>() && !object[field].is<double>() &&
        !object[field].is<int>() && !object[field].is<long>()) return false;
    float value = object[field].as<float>();
    return value >= minValue && value <= maxValue;
}

bool optionalStringFits(JsonVariantConst value, size_t capacity) {
    if (value.isNull()) return true;
    if (!value.is<const char*>()) return false;
    const char* text = value.as<const char*>();
    return text && strlen(text) < capacity;
}

bool requiredStringFits(JsonVariantConst value, size_t capacity) {
    if (!value.is<const char*>()) return false;
    const char* text = value.as<const char*>();
    return text && text[0] && strlen(text) < capacity;
}

bool validateDisplayLabels(JsonVariantConst labels) {
    if (labels.isNull()) return true;
    if (!labels.is<JsonObjectConst>()) return false;
    static constexpr const char* keys[] = {
        "tot", "tit", "n1", "n2", "oil_press", "oil_temp", "p1", "p2",
        "fuel_press", "fuel_flow", "stop", "start", "ab_arm"
    };
    for (const char* key : keys) {
        if (!optionalStringFits(labels[key], sizeof(HardwareConfig::labelTot))) return false;
    }
    return true;
}

bool validateCustomBlockStrings(JsonVariantConst blocks) {
    if (blocks.isNull()) return true;
    if (!blocks.is<JsonObjectConst>()) return false;
    for (JsonPairConst kv : blocks.as<JsonObjectConst>()) {
        const char* key = kv.key().c_str();
        if (!key || strncmp(key, "custom_", 7) != 0) continue;
        if (strlen(key) >= sizeof(HardwareConfig::customBlocks[0].key)) return false;
        if (!kv.value().is<JsonObjectConst>()) return false;
        JsonObjectConst item = kv.value().as<JsonObjectConst>();
        if (!optionalStringFits(item["label"], sizeof(HardwareConfig::customBlocks[0].label)) ||
            !optionalStringFits(item["desc"], sizeof(HardwareConfig::customBlocks[0].desc))) return false;
    }
    return true;
}

bool stagedOutputAvailable(JsonVariantConst doc, const ChannelRegistry* registry, const char* id) {
    if (!id || !id[0]) return true;
    auto act = doc["actuators"];
    auto enabled = [&](const char* key) { return act[key]["enabled"].as<bool>(); };
    auto abEnabled = [&](const char* key) { return enabled(key); };
    if (!strcmp(id, "request_shutdown") || !strcmp(id, "request_fault")) return true;
    if (!strcmp(id, "cooling_fan_main") || !strcmp(id, "cooling_fan") || !strcmp(id, "cool_fan")) return enabled("cool_fan");
    if (!strcmp(id, "bleed_valve_main") || !strcmp(id, "bleed_valve")) return enabled("bleed_valve");
    if (!strcmp(id, "fuel_pump2_main") || !strcmp(id, "fuel_pump2") || !strcmp(id, "fuel_pump")) return enabled("fuel_pump2");
    if (!strcmp(id, "oil_scavenge_main") || !strcmp(id, "oil_scavenge_pump") || !strcmp(id, "scavenge_pump")) return enabled("oil_scavenge_pump");
    if (!strcmp(id, "main_fuel") || !strcmp(id, "main_fuel_output") || !strcmp(id, "throttle")) return enabled("throttle");
    if (!strcmp(id, "starter_main") || !strcmp(id, "main_starter") || !strcmp(id, "starter")) return enabled("starter");
    if (!strcmp(id, "starter_enable_main") || !strcmp(id, "starter_en") || !strcmp(id, "starter_enable")) return enabled("starter_en");
    if (!strcmp(id, "oil_pump_main") || !strcmp(id, "oil_pump")) return enabled("oil_pump");
    if (!strcmp(id, "fuel_solenoid_main") || !strcmp(id, "main_fuel_shutoff") || !strcmp(id, "fuel_sol") || !strcmp(id, "fuel_shutoff")) return enabled("fuel_sol");
    if (!strcmp(id, "igniter_main") || !strcmp(id, "igniter")) return enabled("igniter");
    if (!strcmp(id, "igniter2_main") || !strcmp(id, "ab_igniter") || !strcmp(id, "igniter2")) return enabled("igniter2");
    if (!strcmp(id, "ab_solenoid_main") || !strcmp(id, "ab_sol") || !strcmp(id, "ab_solenoid")) return abEnabled("ab_sol");
    if (!strcmp(id, "ab_pump_main") || !strcmp(id, "ab_pump")) return abEnabled("ab_pump");
    if (!strcmp(id, "airstarter_main") || !strcmp(id, "airstarter_sol") || !strcmp(id, "air_starter")) return enabled("airstarter_sol");
    if (!strcmp(id, "glow_plug_main") || !strcmp(id, "glow_plug")) return enabled("glow_plug");
    if (!strcmp(id, "prop_pitch_main") || !strcmp(id, "prop_pitch")) return enabled("prop_pitch");
    if (!registry) return false;
    const auto* out = registry->find(id, ChannelRegistry::Output);
    return out && ChannelRegistry::channelAddressable(*out) &&
           !registry->ownsCoreOutput(*out) &&
           !registry->boundToCoreOutput(*out);
}

bool stagedInputAvailable(JsonVariantConst doc, const ChannelRegistry* registry, const char* id) {
    if (!id || !id[0]) return true;
    auto sensors = doc["sensors"];
    auto enabled = [&](const char* key) { return sensors[key]["enabled"].as<bool>(); };
    auto diPin = [&](uint8_t idx) {
        JsonVariantConst ch = doc["di_channels"][idx];
        return ch.is<JsonObjectConst>() && (ch["pin"] | -1) >= 0;
    };
    if (!strcmp(id, "oil_temp_main") || !strcmp(id, "oil_temp")) return enabled("oil_temp");
    if (!strcmp(id, "tot_main") || !strcmp(id, "tot") || !strcmp(id, "primary_egt")) return enabled("tot");
    if (!strcmp(id, "n1_main") || !strcmp(id, "n1_rpm") || !strcmp(id, "primary_n1")) return enabled("n1_rpm");
    if (!strcmp(id, "oil_pressure_main") || !strcmp(id, "oil_press")) return enabled("oil_press");
    if (!strcmp(id, "tit_main") || !strcmp(id, "tit")) return enabled("tit");
    if (!strcmp(id, "batt_voltage_main") || !strcmp(id, "batt_voltage")) return enabled("batt_voltage");
    if (!strcmp(id, "n2_main") || !strcmp(id, "n2_rpm") || !strcmp(id, "primary_n2")) return enabled("n2_rpm");
    if (!strcmp(id, "di0")) return diPin(0);
    if (!strcmp(id, "di1")) return diPin(1);
    if (!strcmp(id, "di2")) return diPin(2);
    if (!strcmp(id, "di3")) return diPin(3);
    if (!strcmp(id, "fuel_pressure_main") || !strcmp(id, "fuel_press")) return enabled("fuel_press");
    if (!strcmp(id, "fuel_flow_main") || !strcmp(id, "fuel_flow")) return enabled("fuel_flow");
    if (!strcmp(id, "p1_main") || !strcmp(id, "p1")) return enabled("p1");
    if (!strcmp(id, "p2_main") || !strcmp(id, "p2")) return enabled("p2");
    if (!strcmp(id, "torque_main") || !strcmp(id, "torque")) return enabled("torque");
    if (!strcmp(id, "flame_main") || !strcmp(id, "flame")) return enabled("flame");
    if (!strcmp(id, "throttle_input_main") || !strcmp(id, "throttle_in") || !strcmp(id, "operator_throttle")) return enabled("throttle_input");
    if (!strcmp(id, "idle_input_main") || !strcmp(id, "idle_in") || !strcmp(id, "idle_input") || !strcmp(id, "operator_idle")) return enabled("idle_input");
    if (!strcmp(id, "ab_flame_main") || !strcmp(id, "ab_flame")) return enabled("ab_flame");
    if (!strcmp(id, "glow_current_main") || !strcmp(id, "glow_current")) return doc["actuators"]["glow_plug"]["enabled"].as<bool>() && doc["actuators"]["glow_plug"]["has_current"].as<bool>();
    if (!strcmp(id, "igniter_current_main") || !strcmp(id, "igniter_current")) return doc["actuators"]["igniter"]["enabled"].as<bool>() && doc["actuators"]["igniter"]["has_current"].as<bool>();
    if (!strcmp(id, "igniter2_current_main") || !strcmp(id, "igniter2_current")) return doc["actuators"]["igniter2"]["enabled"].as<bool>() && doc["actuators"]["igniter2"]["has_current"].as<bool>();
    if (!strcmp(id, "oil_pump_current_main") || !strcmp(id, "oil_pump_current")) return doc["actuators"]["oil_pump"]["enabled"].as<bool>() && doc["actuators"]["oil_pump"]["has_current"].as<bool>();
    if (!strcmp(id, "ab_input_main") || !strcmp(id, "ab_input"))
        return (doc["ab_trigger"]["input_pin"] | -1) >= 0 ||
               registryHasAddressablePurpose(registry, ChannelRegistry::Input, "ab_command");
    if (!strcmp(id, "start_switch"))
        return (doc["controls"]["start_pin"] | -1) >= 0 ||
               registryHasAddressablePurpose(registry, ChannelRegistry::Input, "start_switch");
    if (!strcmp(id, "stop_switch"))
        return (doc["controls"]["stop_pin"] | -1) >= 0 ||
               registryHasAddressablePurpose(registry, ChannelRegistry::Input, "stop_switch");
    if (!registry) return false;
    const auto* in = registry->find(id, ChannelRegistry::Input);
    return in && ChannelRegistry::channelAddressable(*in);
}

bool validateSequenceReferenceIds(JsonVariantConst doc, const ChannelRegistry* registry) {
    auto validTarget = [&](JsonVariantConst target) {
        if (target.isNull()) return true;
        if (!target.is<const char*>()) return false;
        const char* id = target.as<const char*>();
        // Stable sequence references may intentionally outlive a temporarily
        // removed device. Runtime validation keeps the affected sequence
        // inhibited until that exact ID is restored or explicitly changed.
        return id && strlen(id) < 20;
    };
    auto validSource = [&](JsonVariantConst source) {
        if (source.isNull()) return true;
        if (!source.is<const char*>()) return false;
        const char* id = source.as<const char*>();
        return id && strlen(id) < 20;
    };
    static constexpr const char* sideKeys[] = {
        "startup_enter_actions", "startup_exit_actions",
        "shutdown_enter_actions", "shutdown_exit_actions",
        "ab_enter_actions", "ab_exit_actions",
        "ab_shut_enter_actions", "ab_shut_exit_actions"
    };
    // Per-block device bindings are intentionally allowed to reference a
    // device that is temporarily absent. The UI keeps that exact ID visible
    // as an unresolved dependency so replacing hardware never silently
    // retargets an action. Runtime sequence validation prevents the affected
    // block from starting until it is repaired.
    static constexpr const char* deviceTargetKeys[] = {
        "startup_device_target", "shutdown_device_target",
        "ab_device_target", "ab_shut_device_target"
    };
    for (const char* key : deviceTargetKeys) {
        JsonVariantConst targets = doc[key];
        if (targets.isNull()) continue;
        if (!targets.is<JsonArrayConst>()) return false;
        for (JsonVariantConst target : targets.as<JsonArrayConst>()) {
            if (!target.is<const char*>()) return false;
            const char* id = target.as<const char*>();
            if (!id || strlen(id) >= 20) return false;
        }
    }
    for (const char* key : sideKeys) {
        JsonVariantConst outer = doc[key];
        if (outer.isNull()) continue;
        if (!outer.is<JsonArrayConst>()) return false;
        for (JsonVariantConst slot : outer.as<JsonArrayConst>()) {
            if (!slot.is<JsonArrayConst>()) return false;
            for (JsonVariantConst item : slot.as<JsonArrayConst>()) {
                if (!item.is<JsonObjectConst>() || !validTarget(item["target"])) return false;
            }
        }
    }
    JsonVariantConst blocks = doc["custom_blocks"];
    if (blocks.isNull()) return true;
    if (!blocks.is<JsonObjectConst>()) return false;
    for (JsonPairConst kv : blocks.as<JsonObjectConst>()) {
        if (!kv.value().is<JsonObjectConst>()) return false;
        JsonObjectConst block = kv.value().as<JsonObjectConst>();
        if (block["condition"].is<JsonObjectConst>() &&
            !validSource(block["condition"]["source"])) return false;
        JsonVariantConst steps = block["steps"];
        if (steps.isNull()) continue;
        if (!steps.is<JsonArrayConst>()) return false;
        for (JsonVariantConst step : steps.as<JsonArrayConst>()) {
            if (!step.is<JsonObjectConst>() || !validTarget(step["target"])) return false;
        }
    }
    return true;
}

bool pwmPercentRange(JsonVariantConst object, const char* minField, const char* maxField) {
    if (!numberRange(object, minField, 0.0f, 100.0f) ||
        !numberRange(object, maxField, 0.0f, 100.0f)) return false;
    if (!object[minField].isNull() && !object[maxField].isNull() &&
        object[maxField].as<float>() < object[minField].as<float>()) return false;
    return true;
}

bool requiredPinAllowed(JsonVariantConst object, const char* field, bool (*allowed)(int)) {
    const int pin = jsonPin(object, field);
    return pin >= 0 && allowed(pin);
}

bool optionalPinAllowed(JsonVariantConst object, const char* field, bool (*allowed)(int)) {
    const int pin = jsonPin(object, field);
    return pin < 0 || allowed(pin);
}

bool validatePlatformPins(const JsonDocument& doc,
                          const ChannelRegistry* parsedRegistry = nullptr) {
    // Canonical I2C cards intentionally mirror into the legacy runtime flags
    // as enabled with pin=-1. Those flags tell controllers that the function
    // exists; the registry owns the real bus address/channel. A document
    // serialized after runtime apply must therefore validate the canonical
    // endpoint instead of rejecting its legacy mirror as a missing GPIO.
    auto registryInputForPurpose = [&](const char* purpose) -> const ChannelRegistry::Channel* {
        if (!parsedRegistry) return nullptr;
        for (uint8_t i = 0; i < parsedRegistry->inputCount; ++i) {
            const auto& c = parsedRegistry->inputs[i];
            if (!strcmp(c.purpose, purpose)) return &c;
        }
        return nullptr;
    };
    auto registryInputUsesI2c = [&](const char* purpose) {
        const auto* c = registryInputForPurpose(purpose);
        return c && c->driver >= ChannelRegistry::I2cDigital &&
                    c->driver <= ChannelRegistry::I2cLoadCell;
    };
    auto registryOutputUsesI2c = [&](const char* purpose) {
        if (!parsedRegistry) return false;
        for (uint8_t i = 0; i < parsedRegistry->outputCount; ++i) {
            const auto& c = parsedRegistry->outputs[i];
            if (!strcmp(c.purpose, purpose) &&
                c.driver == ChannelRegistry::I2cRelay) return true;
        }
        return false;
    };
    auto registryOutputIdUsesI2c = [&](const char* id) {
        if (!parsedRegistry) return false;
        const auto* c = parsedRegistry->find(id, ChannelRegistry::Output);
        return c && c->driver == ChannelRegistry::I2cRelay;
    };
    const bool hasAfterburner = enabled(doc["actuators"]["ab_sol"]) ||
        enabled(doc["actuators"]["ab_pump"]) ||
        jsonPin(doc["ab_trigger"], "switch_pin") >= 0 ||
        jsonPin(doc["ab_trigger"], "input_pin") >= 0 ||
        registryHasPurpose(parsedRegistry, ChannelRegistry::Input, "ab_flame") ||
        registryHasPurpose(parsedRegistry, ChannelRegistry::Input, "ab_command") ||
        registryHasPurpose(parsedRegistry, ChannelRegistry::Input, "ab_fire") ||
        registryHasPurpose(parsedRegistry, ChannelRegistry::Output, "ab_valve") ||
        registryHasPurpose(parsedRegistry, ChannelRegistry::Output, "ab_pump") ||
        registryHasPurpose(parsedRegistry, ChannelRegistry::Output, "ab_igniter");
    const bool hasN2Rpm = enabled(doc["sensors"]["n2_rpm"]);
    JsonVariantConst controls = doc["controls"];
    int stopPin = jsonPin(controls, "stop_pin");
    int startPin = jsonPin(controls, "start_pin");
    const bool registryStop = registryHasAddressablePurpose(parsedRegistry,
        ChannelRegistry::Input, "stop_switch");
    const bool registryStart = registryHasAddressablePurpose(parsedRegistry,
        ChannelRegistry::Input, "start_switch");
    if (parsedRegistry) {
        for (uint8_t i = 0; i < parsedRegistry->inputCount; ++i) {
            const auto& channel = parsedRegistry->inputs[i];
            if (!ChannelRegistry::channelAddressable(channel)) continue;
            if (!strcmp(channel.purpose, "stop_switch")) stopPin = channel.pin;
            else if (!strcmp(channel.purpose, "start_switch")) startPin = channel.pin;
        }
    }
    // A fresh PCB profile intentionally has no user assignments yet. Allow
    // that commissioning document to validate so the Hardware page remains
    // available; HardwareConfig::load() independently locks START until a
    // profile-backed Stop input is assigned. Development-board defaults still
    // require their compiled Stop input here.
    if (!registryStop && stopPin < 0 && !PcbProfileManager::active()) return false;
    if ((stopPin >= 0 && !gpioAllowed(stopPin)) ||
        (startPin >= 0 && !gpioAllowed(startPin)) ||
        (stopPin >= 0 && startPin >= 0 && stopPin == startPin)) return false;
    if (!PcbProfileManager::active()) {
        if (!registryStop && (controls["stop_pullup"] | false) &&
            (controls["stop_pulldown"] | false)) return false;
        if (!registryStart && (controls["start_pullup"] | false) &&
            (controls["start_pulldown"] | false)) return false;
    }

    JsonVariantConst sensors = doc["sensors"];
    if (enabled(sensors["n1_rpm"]) &&
        !registryInputUsesI2c("n1_speed") &&
        !requiredPinAllowed(sensors["n1_rpm"], "pin", gpioAllowed)) return false;
    if (hasN2Rpm &&
        !registryInputUsesI2c("n2_speed") &&
        !requiredPinAllowed(sensors["n2_rpm"], "pin", gpioAllowed)) return false;

    struct LegacyInputMirror { const char* key; const char* purpose; };
    const LegacyInputMirror analogSensors[] = {
        {"oil_press", "oil_pressure"}, {"flame", "flame"},
        {"fuel_press", "fuel_pressure"}, {"p1", "p1_pressure"},
        {"p2", "p2_pressure"}, {"batt_voltage", "battery_voltage"}
    };
    for (const auto& mirror : analogSensors)
        if (enabled(sensors[mirror.key]) && !registryInputUsesI2c(mirror.purpose)) {
            const auto* canonical = registryInputForPurpose(mirror.purpose);
            const bool localDigital = canonical && canonical->driver == ChannelRegistry::Digital;
            if (!requiredPinAllowed(sensors[mirror.key], "pin",
                                    localDigital ? gpioAllowed : adcGpioAllowed)) return false;
        }
    if (!numberRange(sensors["batt_voltage"], "divider", 1.0f, 100.0f)) return false;

    JsonVariantConst fuelFlow = sensors["fuel_flow"];
    if (enabled(fuelFlow) && !registryInputUsesI2c("fuel_flow") &&
        !((fuelFlow["type"] | 0) ? requiredPinAllowed(fuelFlow, "pin", gpioAllowed)
                                 : requiredPinAllowed(fuelFlow, "pin", adcGpioAllowed))) return false;

    const LegacyInputMirror inputSensors[] = {
        {"throttle_input", "throttle"}, {"idle_input", "idle"}
    };
    for (const auto& mirror : inputSensors) {
        JsonVariantConst item = sensors[mirror.key];
        if (enabled(item) && !registryInputUsesI2c(mirror.purpose)) {
            const auto* canonical = registryInputForPurpose(mirror.purpose);
            const bool gpioSignal = canonical
                ? canonical->driver != ChannelRegistry::Analog
                : (item["rc_pwm"] | false);
            if (!requiredPinAllowed(item, "pin", gpioSignal ? gpioAllowed : adcGpioAllowed)) return false;
        }
    }

    auto validTcChip = [](const char* chip) {
        return strcmp(chip, "max6675") == 0 ||
               strcmp(chip, "max31855") == 0 ||
               strcmp(chip, "max31856") == 0;
    };
    const char* spiSensors[] = { "tot", "tit" };
    for (const char* key : spiSensors) {
        JsonVariantConst item = sensors[key];
        const bool remoteI2c = registryInputUsesI2c(key);
        const char* chip = item["chip"] | "max6675";
        if (enabled(item) && !remoteI2c &&
            (!validTcChip(chip) ||
             !requiredPinAllowed(item, "clk", outputGpioAllowed) ||
             !requiredPinAllowed(item, "cs", outputGpioAllowed) ||
             !requiredPinAllowed(item, "miso", gpioAllowed))) return false;
        // MAX31856 needs MOSI: the driver writes CR0/CR1 and readback-verifies;
        // without MOSI configuration fails and the sensor is permanently
        // unhealthy — reject rather than let the save look complete.
        if (enabled(item) && !remoteI2c && strcmp(chip, "max31856") == 0) {
            if (!requiredPinAllowed(item, "mosi", outputGpioAllowed)) return false;
        } else if (enabled(item) && !remoteI2c) {
            if (!optionalPinAllowed(item, "mosi", outputGpioAllowed)) return false;
        }
    }

    JsonVariantConst oilTemp = sensors["oil_temp"];
    if (enabled(oilTemp) && !registryInputUsesI2c("oil_temperature")) {
        const char* chip = oilTemp["chip"] | "ntc";
        const bool validOilTempChip = strcmp(chip, "ntc") == 0 ||
                                      strcmp(chip, "ds18b20") == 0 ||
                                      validTcChip(chip);
        if (!validOilTempChip) return false;
        if (!oilTemp["ntc_pullup"].isNull() && !oilTemp["ntc_pullup"].is<bool>()) return false;
        if (strcmp(chip, "ntc") == 0 &&
            (!requiredPinAllowed(oilTemp, "pin", adcGpioAllowed) ||
             !numberRange(oilTemp, "ntc_beta", 1000.0f, 10000.0f) ||
             !numberRange(oilTemp, "ntc_r0", 100.0f, 1000000.0f) ||
             !numberRange(oilTemp, "ntc_r_fixed", 100.0f, 1000000.0f))) return false;
        if (strcmp(chip, "ntc") == 0 && (oilTemp["use_raw_poly"] | false)) {
            if (!numberRange(oilTemp, "poly_a", -1000000.0f, 1000000.0f) ||
                !numberRange(oilTemp, "poly_b", -1000000.0f, 1000000.0f) ||
                !numberRange(oilTemp, "poly_c", -1000000.0f, 1000000.0f) ||
                !numberRange(oilTemp, "poly_d", -1000000.0f, 1000000.0f) ||
                !numberRange(oilTemp, "poly_x_min", 0.0f, 4095.0f) ||
                !numberRange(oilTemp, "poly_x_max", 0.0f, 4095.0f) ||
                (oilTemp["poly_x_max"] | 0.0f) <= (oilTemp["poly_x_min"] | 0.0f)) return false;
        }
        if (strcmp(chip, "ds18b20") == 0 && !requiredPinAllowed(oilTemp, "pin", gpioAllowed)) return false;
        if (strcmp(chip, "ntc") != 0 && strcmp(chip, "ds18b20") != 0 &&
            (!requiredPinAllowed(oilTemp, "clk", outputGpioAllowed) ||
             !requiredPinAllowed(oilTemp, "cs", outputGpioAllowed) ||
             !requiredPinAllowed(oilTemp, "miso", gpioAllowed))) return false;
        // Same MAX31856 MOSI requirement as TOT/TIT above.
        if (strcmp(chip, "max31856") == 0) {
            if (!requiredPinAllowed(oilTemp, "mosi", outputGpioAllowed)) return false;
        } else if (strcmp(chip, "ntc") != 0 && strcmp(chip, "ds18b20") != 0) {
            if (!optionalPinAllowed(oilTemp, "mosi", outputGpioAllowed)) return false;
        }
    }

    JsonVariantConst torque = sensors["torque"];
    if (enabled(torque) && !registryInputUsesI2c("torque")) {
        if (torque["hx711"] | false) {
            if (!requiredPinAllowed(torque, "dt_pin", gpioAllowed) ||
                !requiredPinAllowed(torque, "clk_pin", outputGpioAllowed)) return false;
        } else if (!requiredPinAllowed(torque, "pin", adcGpioAllowed)) return false;
    }
    if (!numberRange(torque, "scale", 0.001f, 100000.0f) ||
        !numberRange(torque, "offset", -100000.0f, 100000.0f) ||
        !numberRange(torque, "hx_scale", 0.000001f, 1000000.0f)) return false;

    JsonVariantConst actuators = doc["actuators"];
    const char* actuatorNames[] = {
        "throttle", "starter", "oil_pump", "fuel_sol", "igniter", "igniter2",
        "starter_en", "ab_sol", "airstarter_sol", "cool_fan", "ab_pump",
        "oil_scavenge_pump", "fuel_pump2", "bleed_valve", "prop_pitch",
        "glow_plug", "status_led"
    };
    auto actuatorPurpose = [](const char* key) -> const char* {
        if (!strcmp(key, "throttle")) return "main_fuel";
        if (!strcmp(key, "starter")) return "starter";
        if (!strcmp(key, "oil_pump")) return "oil_pump";
        if (!strcmp(key, "fuel_sol")) return "fuel_shutoff";
        if (!strcmp(key, "igniter")) return "igniter";
        if (!strcmp(key, "igniter2")) return "ab_igniter";
        if (!strcmp(key, "starter_en")) return "starter_enable";
        if (!strcmp(key, "ab_sol")) return "ab_valve";
        if (!strcmp(key, "airstarter_sol")) return "air_starter";
        if (!strcmp(key, "cool_fan")) return "cooling_fan";
        if (!strcmp(key, "ab_pump")) return "ab_pump";
        if (!strcmp(key, "oil_scavenge_pump")) return "scavenge_pump";
        if (!strcmp(key, "fuel_pump2")) return "fuel_pump";
        if (!strcmp(key, "bleed_valve")) return "valve";
        if (!strcmp(key, "prop_pitch")) return "prop_pitch";
        if (!strcmp(key, "glow_plug")) return "glow_plug";
        if (!strcmp(key, "status_led")) return "warning_indicator";
        return "";
    };
    for (const char* key : actuatorNames) {
        JsonVariantConst item = actuators[key];
        if (!hasAfterburner &&
            (strcmp(key, "ab_sol") == 0 || strcmp(key, "ab_pump") == 0)) continue;
        if (enabled(item)) {
            const int pin = jsonPin(item, "pin");
            const bool remoteI2c = !strcmp(key, "bleed_valve")
                ? registryOutputIdUsesI2c("bleed_valve")
                : registryOutputUsesI2c(actuatorPurpose(key));
            if (strcmp(key, "status_led") == 0) {
                const int ledType = item["type"] | 0;
                const int ledMode = item["mode"] | 0;
                if (ledType < 0 || ledType > 1) return false;
                if (ledMode < 0 || ledMode > 1) return false;
                if (pin == AUTO_S3_RGB_STATUS_LED_PIN) {
#if defined(OT_PLATFORM_ESP32S3)
                    continue;
#else
                    return false;
#endif
                }
            }
            if (!remoteI2c &&
                (pin < 0 || !outputGpioAllowed(pin) ||
                 (pin >= 0 && (pin == stopPin || pin == startPin)))) return false;
            if (!pwmPercentRange(item, "pwm_min_pct", "pwm_max_pct")) return false;
            if (strcmp(key, "starter_en") == 0) {
                // External contactors and starter controllers may need a short
                // settling delay, but an accidental huge imported value must
                // not hold the enable stage indefinitely before starter demand.
                if (!intRange(item, "delay_ms", 0, 30000)) return false;
            } else if (strcmp(key, "glow_plug") == 0) {
                const int glowType = item["type"] | 0;
                const int glowOutputType = item["output_type"] | 0;
                if (glowType < 0 || glowType > 2) return false;
                if (glowOutputType < 0 || glowOutputType > 1) return false;
                if (glowType == 2) {
                    const int fuelPin = item["fuel_pin"] | -1;
                    const int fuelType = item["fuel_type"] | 0;
                    const bool registryFuel =
                        registryHasPurpose(parsedRegistry, ChannelRegistry::Output, "pilot_fuel");
                    if (fuelType < 0 || fuelType > 2) return false;
                    if (!registryFuel &&
                        (fuelPin < 0 || !outputGpioAllowed(fuelPin) ||
                         fuelPin == stopPin || fuelPin == startPin)) return false;
                    if (!intRange(item, "fuel_delay_ms", 0, 3600000) ||
                        !intRange(item, "fuel_min_us", 500, 2500) ||
                        !intRange(item, "fuel_max_us", 500, 2500) ||
                        !intRange(item, "fuel_freq_hz", 1, 100000) ||
                        !intRange(item, "fuel_res_bits", 8, 14) ||
                        !pwmPercentRange(item, "fuel_pwm_min_pct", "fuel_pwm_max_pct") ||
                        !numberRange(item, "fuel_demand_pct", 0.0f, 100.0f)) return false;
                    if (fuelType == 1 &&
                        !ChannelRegistry::pwmTimingValid(item["fuel_freq_hz"] | 1000,
                                                         item["fuel_res_bits"] | 10)) return false;
                }
            } else if (strcmp(key, "bleed_valve") == 0) {
                const int type = item["type"] | 0;
                if (type < 0 || type > 2) return false;
            } else if (strcmp(key, "throttle") == 0 ||
                       strcmp(key, "starter") == 0 ||
                       strcmp(key, "oil_pump") == 0 ||
                       strcmp(key, "cool_fan") == 0 ||
                       strcmp(key, "ab_pump") == 0 ||
                       strcmp(key, "oil_scavenge_pump") == 0 ||
                       strcmp(key, "fuel_pump2") == 0 ||
                       strcmp(key, "prop_pitch") == 0) {
                const int type = item["type"] | 0;
                if (type < 0 || type > 2) return false;
            }
        }
    }

    const char* currentSensorOwners[] = { "glow_plug", "igniter", "igniter2", "oil_pump" };
    for (const char* key : currentSensorOwners) {
        JsonVariantConst item = actuators[key];
        if (enabled(item) && (item["has_current"] | false) &&
            !requiredPinAllowed(item, "current_pin", adcGpioAllowed)) return false;
        if (!numberRange(item, "current_zero_v", 0.0f, 3.3f) ||
            !numberRange(item, "current_mv_a", 0.001f, 10000.0f)) return false;
    }
    if (!numberRange(actuators["glow_plug"], "current_ready_a", 0.0f, 1000.0f) ||
        !intRange(actuators["igniter"], "dwell_ms", 1, 200) ||
        !intRange(actuators["igniter"], "rest_ms", 1, 200) ||
        !intRange(actuators["igniter2"], "dwell_ms", 1, 200) ||
        !intRange(actuators["igniter2"], "rest_ms", 1, 200) ||
        !numberRange(actuators["igniter"], "coil_sat_a", 0.001f, 1000.0f) ||
        !numberRange(actuators["igniter2"], "coil_sat_a", 0.001f, 1000.0f) ||
        !numberRange(actuators["oil_pump"], "current_max_a", 0.0f, 1000.0f)) return false;
    for (const char* key : {"oil_pump", "glow_plug", "igniter", "igniter2"}) {
        JsonVariantConst item = actuators[key];
        if (!intRange(item, "current_trip_delay_ms", 100, 60000) ||
            !numberRange(item, "current_max_a", 0.0f, 1000.0f)) return false;
    }

    JsonVariantConst cluster = doc["cluster_serial"];
    JsonVariantConst mavlink = doc["mavlink"];
    JsonVariantConst buzzer = doc["buzzer"];
    if (enabled(cluster) &&
        (!requiredPinAllowed(cluster, "tx_pin", outputGpioAllowed) ||
         !optionalPinAllowed(cluster, "rx_pin", gpioAllowed) ||
         (jsonPin(cluster, "tx_pin") >= 0 && jsonPin(cluster, "tx_pin") == jsonPin(cluster, "rx_pin")))) return false;
    if (!intRange(cluster, "baud", 9600, 921600) ||
        !intRange(cluster, "interval_ms", 10, 5000)) return false;
    if (enabled(mavlink) && !requiredPinAllowed(mavlink, "tx_pin", outputGpioAllowed)) return false;
    if (enabled(buzzer) && !requiredPinAllowed(buzzer, "pin", outputGpioAllowed)) return false;

    auto docHasDiRoleInMode = [&](const char* wantedRole, uint8_t modeBit) {
        if (!doc["di_channels"].is<JsonArrayConst>()) return false;
        for (JsonVariantConst ch : doc["di_channels"].as<JsonArrayConst>()) {
            const char* role = ch["role"] | "none";
            const uint8_t activeModes = ch["active_modes"] | (uint8_t)0x1F;
            if (strcmp(role, wantedRole) == 0 &&
                jsonPin(ch, "pin") >= 0 &&
                (activeModes & modeBit) != 0) return true;
        }
        return false;
    };

    if (hasAfterburner) {
        JsonVariantConst abTrigger = doc["ab_trigger"];
        const int abSource = abTrigger["source"] | 0;
        const auto* abCommand = registryInputForPurpose("ab_command");
        const bool registryAbCommand = abCommand && ChannelRegistry::channelAddressable(*abCommand);
        const bool registryAbFire = registryHasAddressablePurpose(parsedRegistry,
            ChannelRegistry::Input, "ab_fire");
        const bool registryAbArm = registryHasAddressablePurpose(parsedRegistry,
            ChannelRegistry::Input, "ab_arm");
        if (abSource < 0 || abSource > 3) return false;
        if (abSource == 2 && !registryAbFire &&
            !requiredPinAllowed(abTrigger, "switch_pin", gpioAllowed)) return false;
        const int inputPin = jsonPin(abTrigger, "input_pin");
        if (abSource == 3 && inputPin < 0 && !registryAbCommand) return false;
        if (inputPin >= 0 && !registryAbCommand) {
            if (!((abTrigger["input_rc_pwm"] | false) ? gpioAllowed(inputPin)
                                                       : adcGpioAllowed(inputPin))) return false;
        }
        if (!intRange(abTrigger, "input_threshold", 0, 4095) ||
            !intRange(abTrigger, "input_min_us", 500, 2500) ||
            !intRange(abTrigger, "input_max_us", 500, 2500)) return false;
        if (abSource != 0 && (abTrigger["requires_arm"] | false) &&
            !registryAbArm &&
            !docHasDiRoleInMode("ab_arm", 1u << 2) &&
            !requiredPinAllowed(abTrigger, "arm_pin", gpioAllowed)) return false;
    }

    auto validDiRole = [](const char* role) {
        return strcmp(role, "none") == 0 ||
               strcmp(role, "fault") == 0 ||
               strcmp(role, "estop") == 0 ||
               strcmp(role, "inhibit_start") == 0 ||
               strcmp(role, "low_oil_switch") == 0 ||
               strcmp(role, "oil_zero_switch") == 0 ||
               strcmp(role, "sequence_gate") == 0 ||
               strcmp(role, "ab_arm") == 0 ||
               strcmp(role, "ab_fire") == 0 ||
               strcmp(role, "limp_mode") == 0;
    };
    if (!doc["di_channels"].isNull() && !doc["di_channels"].is<JsonArrayConst>()) return false;
    for (JsonVariantConst ch : doc["di_channels"].as<JsonArrayConst>()) {
        if (!optionalStringFits(ch["label"], sizeof(HardwareConfig::diCh[0].label)) ||
            !optionalStringFits(ch["role"], sizeof(HardwareConfig::diCh[0].role)) ||
            !optionalStringFits(ch["fault_code"], sizeof(HardwareConfig::diCh[0].faultCode)) ||
            !optionalStringFits(ch["fault_msg"], sizeof(HardwareConfig::diCh[0].faultMsg))) return false;
        const char* role = ch["role"] | "none";
        if (!validDiRole(role)) return false;
        if ((role && strcmp(role, "none") != 0) && jsonPin(ch, "pin") < 0) return false;
        if (!optionalPinAllowed(ch, "pin", gpioAllowed) ||
            !intRange(ch, "debounce_ms", 5, 500)) return false;
        // active_modes: wrong type rejects, but out-of-range values are
        // accepted and masked to 0x1F at load (warn, don't brick the config).
        JsonVariantConst am = ch["active_modes"];
        if (!am.isNull() && !am.is<int>() && !am.is<long>() &&
            !am.is<unsigned int>() && !am.is<unsigned long>()) return false;
    }

    struct PinUse {
        int pin;
        uint8_t shareGroup;
    };
    PinUse used[96] = {};
    size_t usedCount = 0;
    auto addPin = [&](int pin, uint8_t shareGroup = 0) -> bool {
        if (pin < 0) return true;
        for (size_t i = 0; i < usedCount; i++) {
            if (used[i].pin != pin) continue;
            // SPI CLK/MISO/MOSI may be shared by SPI temperature sensors on one bus.
            if (shareGroup != 0 && used[i].shareGroup == shareGroup) return true;
            return false;
        }
        if (usedCount >= sizeof(used) / sizeof(used[0])) return false;
        used[usedCount++] = { pin, shareGroup };
        return true;
    };

    // Registry START/STOP cards are independently sampled and may be repeated.
    // Add every one in the registry loop below; only reserve the legacy pins
    // here when no registry-backed channel replaces that control.
    if ((!registryStop && !addPin(stopPin)) ||
        (!registryStart && !addPin(startPin))) return false;
    JsonVariantConst i2c = doc["i2c"];
    if (!i2c.isNull() && !i2c.is<JsonObjectConst>()) return false;
    if (i2c["enabled"] | false) {
        const int sda = i2c["sda_pin"] | -1;
        const int scl = i2c["scl_pin"] | -1;
        const int interruptPin = i2c["interrupt_pin"] | -1;
        const uint32_t frequency = i2c["frequency_hz"] | 400000U;
        if (!gpioAllowed(sda) || !outputGpioAllowed(scl) || sda == scl ||
            frequency < 10000U || frequency > 400000U ||
            !addPin(sda) || !addPin(scl)) return false;
        if (interruptPin >= 0 &&
            (!gpioAllowed(interruptPin) || !addPin(interruptPin))) return false;
        // A PCB profile owns all of its connector and fixed-function GPIOs,
        // even when it does not provide the shared I2C bus itself. Permit the
        // user to add that missing bus only on genuinely free header pins.
        if (PcbProfileManager::active() && !PcbProfileManager::ownsBusKind("i2c") &&
            (PcbProfileManager::gpioReserved(sda) ||
             PcbProfileManager::gpioReserved(scl) ||
             PcbProfileManager::gpioReserved(interruptPin))) return false;
    }
    JsonVariantConst spi = doc["spi"];
    if (!spi.isNull() && !spi.is<JsonObjectConst>()) return false;
    if (spi["enabled"] | false) {
        const int sck = spi["sck_pin"] | -1;
        const int miso = spi["miso_pin"] | -1;
        const int mosi = spi["mosi_pin"] | -1;
        if (!outputGpioAllowed(sck) || !gpioAllowed(miso) || sck == miso ||
            (mosi >= 0 && (!outputGpioAllowed(mosi) || mosi == sck || mosi == miso)) ||
            !addPin(sck, 1) || !addPin(miso, 2) ||
            (mosi >= 0 && !addPin(mosi, 3))) return false;
        if (PcbProfileManager::active() && !PcbProfileManager::ownsBusKind("spi") &&
            (PcbProfileManager::gpioReserved(sck) ||
             PcbProfileManager::gpioReserved(miso) ||
             PcbProfileManager::gpioReserved(mosi))) return false;
    }

    if (enabled(sensors["n1_rpm"]) && !addPin(jsonPin(sensors["n1_rpm"], "pin"))) return false;
    if (hasN2Rpm && !addPin(jsonPin(sensors["n2_rpm"], "pin"))) return false;
    for (const auto& mirror : analogSensors)
        if (enabled(sensors[mirror.key]) &&
            !addPin(jsonPin(sensors[mirror.key], "pin"))) return false;
    if (enabled(fuelFlow) && !addPin(jsonPin(fuelFlow, "pin"))) return false;
    for (const auto& mirror : inputSensors)
        if (enabled(sensors[mirror.key]) &&
            !addPin(jsonPin(sensors[mirror.key], "pin"))) return false;

    for (const char* key : spiSensors) {
        JsonVariantConst item = sensors[key];
        if (!enabled(item)) continue;
        if (!addPin(jsonPin(item, "clk"), 1) ||
            !addPin(jsonPin(item, "miso"), 2) ||
            !addPin(jsonPin(item, "mosi"), 3) ||
            !addPin(jsonPin(item, "cs"))) return false;
    }
    if (enabled(oilTemp)) {
        const char* chip = oilTemp["chip"] | "ntc";
        if (strcmp(chip, "ntc") == 0 || strcmp(chip, "ds18b20") == 0) {
            if (!addPin(jsonPin(oilTemp, "pin"))) return false;
        } else if (!addPin(jsonPin(oilTemp, "clk"), 1) ||
                   !addPin(jsonPin(oilTemp, "miso"), 2) ||
                   !addPin(jsonPin(oilTemp, "mosi"), 3) ||
                   !addPin(jsonPin(oilTemp, "cs"))) return false;
    }
    if (enabled(torque)) {
        if (torque["hx711"] | false) {
            if (!addPin(jsonPin(torque, "dt_pin")) ||
                !addPin(jsonPin(torque, "clk_pin"))) return false;
        } else if (!addPin(jsonPin(torque, "pin"))) return false;
    }

    for (const char* key : actuatorNames) {
        JsonVariantConst item = actuators[key];
        if (!hasAfterburner &&
            (strcmp(key, "ab_sol") == 0 || strcmp(key, "ab_pump") == 0)) continue;
        if (enabled(item) && !addPin(jsonPin(item, "pin"))) return false;
        if (strcmp(key, "glow_plug") == 0 && enabled(item) && ((item["type"] | 0) == 2) &&
            !addPin(item["fuel_pin"] | -1)) return false;
    }
    for (const char* key : currentSensorOwners) {
        JsonVariantConst item = actuators[key];
        if (enabled(item) && (item["has_current"] | false) &&
            !addPin(jsonPin(item, "current_pin"))) return false;
    }
    if (enabled(cluster) &&
        (!addPin(jsonPin(cluster, "tx_pin")) ||
         !addPin(jsonPin(cluster, "rx_pin")))) return false;
    if (enabled(mavlink) && !addPin(jsonPin(mavlink, "tx_pin"))) return false;
    if (enabled(buzzer) && !addPin(jsonPin(buzzer, "pin"))) return false;

    if (hasAfterburner) {
        JsonVariantConst abTrigger = doc["ab_trigger"];
        const int abSource = abTrigger["source"] | 0;
        if (abSource == 2 && !addPin(jsonPin(abTrigger, "switch_pin"))) return false;
        if (jsonPin(abTrigger, "input_pin") >= 0 && !addPin(jsonPin(abTrigger, "input_pin"))) return false;
        if (abSource != 0 && (abTrigger["requires_arm"] | false) &&
            !docHasDiRoleInMode("ab_arm", 1u << 2) &&
            !addPin(jsonPin(abTrigger, "arm_pin"))) return false;
    }
    for (JsonVariantConst ch : doc["di_channels"].as<JsonArrayConst>())
        if (!addPin(jsonPin(ch, "pin"))) return false;
    auto registryMirrorsDiChannel = [&](const ChannelRegistry::Channel& ch) {
        if (ch.driver != ChannelRegistry::Digital || ch.pin < 0) return false;
        if (strncmp(ch.id, "di_", 3) != 0) return false;
        for (JsonVariantConst di : doc["di_channels"].as<JsonArrayConst>()) {
            if (jsonPin(di, "pin") != ch.pin) continue;
            const char* diRole = di["role"] | "none";
            if (!strcmp(diRole, ch.role) || !strcmp(diRole, ch.purpose)) return true;
        }
        return false;
    };
    auto registryMirrorsLegacyPin = [&](const ChannelRegistry::Channel& ch) {
        if (ch.pin < 0) return false;
        auto sensorPin = [&](const char* key) {
            JsonVariantConst sensor = sensors[key];
            return enabled(sensor) && jsonPin(sensor, "pin") == ch.pin;
        };
        if (!strcmp(ch.purpose, "n1_speed")) return sensorPin("n1_rpm");
        if (!strcmp(ch.purpose, "n2_speed")) return sensorPin("n2_rpm");
        for (const auto& mirror : analogSensors)
            if (!strcmp(ch.purpose, mirror.purpose)) return sensorPin(mirror.key);
        if (!strcmp(ch.purpose, "fuel_flow")) return sensorPin("fuel_flow");
        for (const auto& mirror : inputSensors)
            if (!strcmp(ch.purpose, mirror.purpose)) return sensorPin(mirror.key);
        if (!strcmp(ch.purpose, "oil_temperature")) return sensorPin("oil_temp");
        if (!strcmp(ch.purpose, "torque")) return sensorPin("torque");
        if (!strcmp(ch.purpose, "ab_command"))
            return jsonPin(doc["ab_trigger"], "input_pin") == ch.pin;
        return false;
    };

    // A 16x16 registry is too large for the loop/AsyncWebServer task stack,
    // but keeping a permanent validation copy wastes scarce classic-ESP32
    // DRAM. Allocate the scratch copy only for standalone pin validation;
    // validateJson() passes its already-parsed copy through this parameter.
    std::unique_ptr<ChannelRegistry> registryScratch;
    if (!doc["channel_registry"].isNull()) {
        if (!parsedRegistry) {
            registryScratch.reset(new (std::nothrow) ChannelRegistry());
            if (!registryScratch ||
                !registryScratch->fromJson(doc["channel_registry"].as<JsonObjectConst>())) return false;
            parsedRegistry = registryScratch.get();
        }
        const ChannelRegistry& registry = *parsedRegistry;
        bool registryUsesI2c = false;
        bool registryUsesSpi = false;
        bool registryNeedsMosi = false;
        for (uint8_t i = 0; i < registry.inputCount; ++i)
        {
            registryUsesI2c |= registry.inputs[i].driver >= ChannelRegistry::I2cDigital;
            const auto& channel = registry.inputs[i];
            const bool channelUsesSpi = !strcmp(channel.role, "temperature") &&
                channel.temperatureInterface >= 1 && channel.temperatureInterface <= 3;
            registryUsesSpi |= channelUsesSpi;
            registryNeedsMosi |= channelUsesSpi && channel.temperatureInterface == 3;
        }
        for (uint8_t i = 0; i < registry.outputCount; ++i)
            registryUsesI2c |= registry.outputs[i].driver == ChannelRegistry::I2cRelay;
        if (registryUsesI2c && !(i2c["enabled"] | false)) return false;
        if (registryUsesSpi && !(spi["enabled"] | false)) return false;
        if (registryNeedsMosi && (spi["mosi_pin"] | -1) < 0) return false;
        for (uint8_t i = 0; i < registry.inputCount; i++) {
            const auto& ch = registry.inputs[i];
            const bool hx711Torque = !strcmp(ch.role, "torque") && ch.torqueInterface == 1;
            if (hx711Torque) {
                if (!gpioAllowed(ch.pin) || !outputGpioAllowed(ch.hx711Clk) ||
                    ch.pin == ch.hx711Clk) return false;
                // Core torque pins are mirrored into the runtime adapter and
                // validated there when present. Canonical-only documents still
                // need both physical pins entered into the collision set.
                JsonVariantConst runtimeTorque = doc["sensors"]["torque"];
                const bool mirrored = (runtimeTorque["enabled"] | false) &&
                    (runtimeTorque["hx711"] | false) &&
                    jsonPin(runtimeTorque, "dt_pin") == ch.pin &&
                    jsonPin(runtimeTorque, "clk_pin") == ch.hx711Clk;
                if (!mirrored && (!addPin(ch.pin) || !addPin(ch.hx711Clk))) return false;
                continue;
            }
            const bool thermocouple = strcmp(ch.role, "temperature") == 0 &&
                                      ch.temperatureInterface >= 1 && ch.temperatureInterface <= 3;
            if (thermocouple) {
                // Core TOT/TIT channels are serialized both in the canonical
                // registry and in the singleton runtime adapter. The adapter
                // has already claimed these pins above, so do not count the
                // same physical thermocouple a second time as a CS collision.
                const char* runtimeKey = !strcmp(ch.purpose, "tot") ? "tot" :
                                         !strcmp(ch.purpose, "tit") ? "tit" : nullptr;
                if (runtimeKey) {
                    JsonVariantConst runtimeSensor = doc["sensors"][runtimeKey];
                    const bool mirrored = (runtimeSensor["enabled"] | false) &&
                        jsonPin(runtimeSensor, "clk") == ch.spiClk &&
                        jsonPin(runtimeSensor, "cs") == ch.spiCs &&
                        jsonPin(runtimeSensor, "miso") == ch.spiMiso &&
                        (ch.temperatureInterface != 3 || jsonPin(runtimeSensor, "mosi") == ch.spiMosi);
                    if (mirrored) continue;
                }
                // A registry thermocouple has no generic GPIO.  Validate its
                // actual SPI wiring here, using the same shared-bus rule as
                // the established TOT/TIT hardware: CLK/MISO/MOSI may share,
                // but CS must be unique and cannot collide with other IO.
                if (!gpioAllowed(ch.spiClk) || !gpioAllowed(ch.spiCs) ||
                    !gpioAllowed(ch.spiMiso) ||
                    (ch.temperatureInterface == 3 && !gpioAllowed(ch.spiMosi)) ||
                    !addPin(ch.spiClk, 1) || !addPin(ch.spiMiso, 2) ||
                    (ch.temperatureInterface == 3 && !addPin(ch.spiMosi, 3)) ||
                    !addPin(ch.spiCs)) return false;
                continue;
            }
            if (ch.pin < 0) continue;
            // DS18B20 is represented by a temperature card but uses a OneWire
            // data GPIO, not an ADC-capable pin. NTC and analog transmitters
            // remain ADC-only.
            if (ch.driver == ChannelRegistry::Analog && ch.temperatureInterface != 5) {
                if (!adcGpioAllowed(ch.pin)) return false;
            } else if (!gpioAllowed(ch.pin)) {
                return false;
            }
            if (registryMirrorsDiChannel(ch)) continue;
            if (registryMirrorsLegacyPin(ch)) continue;
            if (!addPin(ch.pin)) return false;
        }
        for (uint8_t i = 0; i < registry.outputCount; i++) {
            const auto& ch = registry.outputs[i];
            if (ch.pin >= 0 && (!outputGpioAllowed(ch.pin) ||
                ch.pin == stopPin || ch.pin == startPin)) return false;
            if (ch.hasCurrent && !adcGpioAllowed(ch.currentPin)) return false;
            if (ch.pin >= 0 && !registry.ownsCoreOutput(ch) && !registry.boundToCoreOutput(ch) &&
                !addPin(ch.pin)) return false;
            if (ch.hasCurrent && !addPin(ch.currentPin)) return false;
        }
    }

    // Arduino-ESP32 allocates one LEDC channel per attached PWM/servo/tone
    // endpoint. Reserve the target's real channel count before persistence so
    // a valid-looking layout cannot fail part-way through actuator startup.
    uint8_t ledcUsed = 0;
    auto countType012 = [&](const char* key) {
        JsonVariantConst item = actuators[key];
        if (enabled(item) && (item["type"] | 0) != 2) ++ledcUsed;
    };
    for (const char* key : { "throttle", "starter", "oil_pump", "cool_fan",
                             "ab_pump", "oil_scavenge_pump", "fuel_pump2" })
        countType012(key);
    if (enabled(actuators["bleed_valve"]) && (actuators["bleed_valve"]["type"] | 2) != 2) ++ledcUsed;
    if (enabled(actuators["prop_pitch"]) && (actuators["prop_pitch"]["type"] | 0) != 2) ++ledcUsed;
    if (enabled(actuators["igniter"]) && (actuators["igniter"]["pwm"] | false)) ++ledcUsed;
    if (enabled(actuators["igniter2"]) && (actuators["igniter2"]["pwm"] | false)) ++ledcUsed;
    JsonVariantConst glow = actuators["glow_plug"];
    if (enabled(glow) && (glow["output_type"] | 0) == 0) ++ledcUsed;
    if (enabled(glow) && (glow["type"] | 0) == 2 && (glow["fuel_type"] | 0) != 0) ++ledcUsed;
    if (enabled(buzzer)) ++ledcUsed;
    if (parsedRegistry) {
        for (uint8_t i = 0; i < parsedRegistry->outputCount; ++i) {
            const auto& channel = parsedRegistry->outputs[i];
            if (!channel.installed || (channel.driver != ChannelRegistry::Pwm && channel.driver != ChannelRegistry::Servo)) continue;
            if (!parsedRegistry->ownsCoreOutput(channel) && !parsedRegistry->boundToCoreOutput(channel)) ++ledcUsed;
        }
    }
#if defined(OT_PLATFORM_ESP32S3)
    static constexpr uint8_t LEDC_AVAILABLE = 8;
#else
    static constexpr uint8_t LEDC_AVAILABLE = 16;
#endif
    if (ledcUsed > LEDC_AVAILABLE) {
        static char ledcError[96];
        snprintf(ledcError, sizeof(ledcError),
                 "PWM/servo/buzzer endpoints use %u LEDC channels; selected target provides %u",
                 (unsigned)ledcUsed, (unsigned)LEDC_AVAILABLE);
        setHardwareValidationError(ledcError);
        return false;
    }

    return true;
}
}

// ── Static member definitions ─────────────────────────────────
// Default values mirror hardware_profile.h so that a missing
// an ecu_config.json without a hardware section produces identical behaviour to the current build.

void HardwareConfigInternal::writeSequenceSideActions(
    JsonObject doc, const char* key, int sequenceLength,
    HardwareConfig::SeqSideAction actions[HardwareConfig::MAX_SEQ_BLOCKS]
                                          [HardwareConfig::MAX_SEQ_SIDE_ACTIONS]) {
    writeSeqSideActions(doc, key, sequenceLength, actions);
}

void HardwareConfigInternal::writeCustomBlocks(JsonObject doc) {
    ::writeCustomBlocks(doc);
}

#if defined(OT_PLATFORM_ESP32S3)
ChannelRegistry HardwareConfig::channelRegistry = {};
#else
ChannelRegistry& HardwareConfig::channelRegistry = *new ChannelRegistry();
#endif
char  HardwareConfig::profileId[64]    = {};
char  HardwareConfig::profileDesc[64]  = {};
char  HardwareConfig::wifiPassword[64] = {};   // empty = open network; WPA2 allows 8-63 chars
int   HardwareConfig::wifiTxPowerDbm   = 8;
bool  HardwareConfig::hasAfterburner   = DEFAULT_HAS_AFTERBURNER;

// Physical controls
int   HardwareConfig::stopPin          = OT_STOP_PIN;
bool  HardwareConfig::stopActiveH      = false;  // active-low: button connects pin to GND
bool  HardwareConfig::stopPullup       = true;   // enable internal pull-up by default
bool  HardwareConfig::stopPulldown     = false;
int   HardwareConfig::startPin         = OT_START_PIN;
bool  HardwareConfig::startActiveH     = false;  // active-low
bool  HardwareConfig::startPullup      = true;   // enable internal pull-up by default
bool  HardwareConfig::startPulldown    = false;

// Sensor feature flags
bool  HardwareConfig::hasN1Rpm         = DEFAULT_HAS_N1_RPM;
bool  HardwareConfig::hasN2Rpm         = DEFAULT_HAS_N2_RPM;
bool  HardwareConfig::hasTot           = DEFAULT_HAS_TOT;
bool  HardwareConfig::hasTit           = false;
bool  HardwareConfig::hasOilPress      = DEFAULT_HAS_OIL_PRESS;
bool  HardwareConfig::hasFlame         = DEFAULT_HAS_FLAME;
bool  HardwareConfig::hasFuelFlow      = DEFAULT_HAS_FUEL_FLOW;
bool  HardwareConfig::hasFuelPress     = false;
bool  HardwareConfig::hasP1            = DEFAULT_HAS_P1;
bool  HardwareConfig::hasP2            = DEFAULT_HAS_P2;
bool  HardwareConfig::hasThrottleInput = DEFAULT_HAS_THROTTLE_INPUT;
bool  HardwareConfig::hasIdleInput     = DEFAULT_HAS_IDLE_INPUT;
bool  HardwareConfig::hasOilTemp       = false;
bool  HardwareConfig::hasBattVoltage   = false;
bool  HardwareConfig::hasTorque        = false;
bool  HardwareConfig::hasThrust        = false;
bool  HardwareConfig::i2cEnabled       = false;
#ifdef OT_PLATFORM_ESP32S3
int   HardwareConfig::i2cSdaPin        = 8;
int   HardwareConfig::i2cSclPin        = 9;
#else
int   HardwareConfig::i2cSdaPin        = 26;
int   HardwareConfig::i2cSclPin        = 27;
#endif
int   HardwareConfig::i2cInterruptPin  = -1;
uint32_t HardwareConfig::i2cFrequencyHz = 400000;
bool  HardwareConfig::spiEnabled       = DEFAULT_HAS_TOT;
int   HardwareConfig::spiSckPin        = OT_TOT_CLK;
int   HardwareConfig::spiMisoPin       = OT_TOT_MISO;
int   HardwareConfig::spiMosiPin       = -1;

// Sensor pins & params
int   HardwareConfig::n1RpmPin         = OT_N1_RPM_PIN;
float HardwareConfig::n1RpmPpr         = OT_N1_RPM_PPR;
int   HardwareConfig::n2RpmPin         = OT_N2_RPM_PIN;
float HardwareConfig::n2RpmPpr         = OT_N2_RPM_PPR;
char  HardwareConfig::totChip[12]      = "max6675";
char  HardwareConfig::totTcType[4]     = "K";
int   HardwareConfig::totClk           = OT_TOT_CLK;
int   HardwareConfig::totCs            = OT_TOT_CS;
int   HardwareConfig::totMiso          = OT_TOT_MISO;
int   HardwareConfig::totMosi          = -1;
char  HardwareConfig::titChip[12]      = "max6675";
char  HardwareConfig::titTcType[4]     = "K";
int   HardwareConfig::titClk           = -1;
int   HardwareConfig::titCs            = -1;
int   HardwareConfig::titMiso          = -1;
int   HardwareConfig::titMosi          = -1;
int   HardwareConfig::oilPressPin      = OT_OIL_PRESS_PIN;
int   HardwareConfig::flamePin         = OT_FLAME_PIN;
int   HardwareConfig::fuelFlowPin           = OT_FUEL_FLOW_PIN;
int   HardwareConfig::fuelFlowType          = 0;
float HardwareConfig::fuelFlowPulsesPerLitre = 100.0f;
int   HardwareConfig::fuelPressPin     = OT_ADC_5;
int   HardwareConfig::p1Pin            = OT_P1_PIN;
int   HardwareConfig::p2Pin            = OT_P2_PIN;
int   HardwareConfig::throttleInputPin = OT_THROTTLE_INPUT_PIN;
bool  HardwareConfig::throttleInputRcPwm = DEFAULT_THROTTLE_INPUT_RC_PWM;
int   HardwareConfig::idleInputPin     = OT_IDLE_INPUT_PIN;
bool  HardwareConfig::idleInputRcPwm   = DEFAULT_IDLE_INPUT_RC_PWM;

char  HardwareConfig::oilTempChip[12]  = "ntc";
int   HardwareConfig::oilTempPin       = -1;
int   HardwareConfig::oilTempCs        = -1;
int   HardwareConfig::oilTempMiso      = -1;
int   HardwareConfig::oilTempMosi      = -1;
char  HardwareConfig::oilTempTcType[4] = "K";
int   HardwareConfig::oilTempResolution = 10;
float HardwareConfig::ntcBeta          = 3950.0f;
float HardwareConfig::ntcR0            = 10000.0f;
float HardwareConfig::ntcRFixed        = 10000.0f;
bool  HardwareConfig::ntcFixedPullup   = true;
bool  HardwareConfig::oilTempUseRawPoly = false;
float HardwareConfig::oilTempPolyA = 0, HardwareConfig::oilTempPolyB = 0;
float HardwareConfig::oilTempPolyC = 0, HardwareConfig::oilTempPolyD = 0;
float HardwareConfig::oilTempPolyXMin = 0, HardwareConfig::oilTempPolyXMax = 4095;
int   HardwareConfig::battVoltPin      = -1;
float HardwareConfig::battVoltDivider  = 5.7f;
int   HardwareConfig::torquePin        = -1;
float HardwareConfig::torqueScale      = 30.3f;
float HardwareConfig::torqueOffset     = 0.0f;
bool  HardwareConfig::torqueHx711      = false;
int   HardwareConfig::torqueDtPin      = -1;
int   HardwareConfig::torqueClkPin     = -1;
float HardwareConfig::torqueHxScale    = 1.0f;
long  HardwareConfig::torqueHxZero     = 0;

// Actuator feature flags
bool  HardwareConfig::hasThrottle      = DEFAULT_HAS_THROTTLE;
bool  HardwareConfig::hasStarter       = DEFAULT_HAS_STARTER;
bool  HardwareConfig::hasOilPump       = DEFAULT_HAS_OIL_PUMP;
bool  HardwareConfig::hasFuelSol       = DEFAULT_HAS_FUEL_SOL;
bool  HardwareConfig::hasIgniter       = DEFAULT_HAS_IGNITER;
bool  HardwareConfig::hasIgniter2      = false;
bool  HardwareConfig::hasStarterEn     = DEFAULT_HAS_STARTER_EN;
bool  HardwareConfig::hasAbSol         = DEFAULT_HAS_AB_SOL;
bool  HardwareConfig::hasAirstarterSol = DEFAULT_HAS_AIRSTARTER_SOL;
bool  HardwareConfig::hasCoolFan       = DEFAULT_HAS_COOL_FAN;
bool  HardwareConfig::hasAbPump        = false;
bool  HardwareConfig::hasOilScavengePump = false;
bool  HardwareConfig::hasFuelPump2     = false;
bool  HardwareConfig::hasBleedValve    = false;
bool  HardwareConfig::hasPropPitch     = false;
bool  HardwareConfig::hasGlowPlug      = false;
bool  HardwareConfig::hasGlowCurrentSensor       = false;
bool  HardwareConfig::hasIgniterCurrentSensor    = false;
bool  HardwareConfig::hasIgniter2CurrentSensor   = false;
bool  HardwareConfig::hasOilPumpCurrentSensor    = false;
bool  HardwareConfig::hasGovernor      = false;
bool  HardwareConfig::hasMAVLink       = false;
bool  HardwareConfig::hasStatusLed     = DEFAULT_STATUS_LED_PIN != -1;
bool  HardwareConfig::hasClusterSerial = DEFAULT_HAS_CLUSTER_SERIAL;
bool  HardwareConfig::hasBuzzer        = false;
int   HardwareConfig::buzzerPin        = -1;

int   HardwareConfig::fuelPump2Pin     = -1;
int   HardwareConfig::fuelPump2Type    = 1;   // ledc_pwm
int   HardwareConfig::fuelPump2MinUs   = 1000;
int   HardwareConfig::fuelPump2MaxUs   = 2000;
bool  HardwareConfig::fuelPump2ActiveH = true;
int   HardwareConfig::fuelPump2FreqHz  = 5000;
int   HardwareConfig::fuelPump2ResBits = 12;
float HardwareConfig::fuelPump2PwmMinPct = 0.0f;
float HardwareConfig::fuelPump2PwmMaxPct = 100.0f;
int   HardwareConfig::bleedValveType    = 2;     // 0=servo, 1=ledc_pwm, 2=on-off
int   HardwareConfig::bleedValvePin    = -1;
bool  HardwareConfig::bleedValveActiveH = true;
int   HardwareConfig::bleedValveMinUs  = 1000;
int   HardwareConfig::bleedValveMaxUs  = 2000;
int   HardwareConfig::bleedValveFreqHz = 5000;
int   HardwareConfig::bleedValveResBits = 10;
float HardwareConfig::bleedValvePwmMinPct = 0.0f;
float HardwareConfig::bleedValvePwmMaxPct = 100.0f;
int   HardwareConfig::propPitchType    = 0;     // 0=servo, 1=ledc_pwm, 2=on-off
int   HardwareConfig::propPitchPin     = -1;
int   HardwareConfig::propPitchMinUs   = 1000;
int   HardwareConfig::propPitchMaxUs   = 2000;
int   HardwareConfig::propPitchFreqHz  = 5000;
int   HardwareConfig::propPitchResBits = 10;
float HardwareConfig::propPitchPwmMinPct = 0.0f;
float HardwareConfig::propPitchPwmMaxPct = 100.0f;
bool  HardwareConfig::propPitchActiveH = true;
int   HardwareConfig::glowPlugType     = 0;
int   HardwareConfig::glowPlugOutputType = 0;
bool  HardwareConfig::glowPlugActiveH  = true;
int   HardwareConfig::glowPlugPin      = -1;
int   HardwareConfig::glowPlugFreqHz   = 1000;
int   HardwareConfig::glowPlugResBits  = 8;
float HardwareConfig::glowPlugPwmMinPct = 0.0f;
float HardwareConfig::glowPlugPwmMaxPct = 100.0f;
int   HardwareConfig::wetGlowFuelPin       = -1;
int   HardwareConfig::wetGlowFuelType      = 0;
bool  HardwareConfig::wetGlowFuelActiveH   = true;
int   HardwareConfig::wetGlowFuelMinUs     = 1000;
int   HardwareConfig::wetGlowFuelMaxUs     = 2000;
int   HardwareConfig::wetGlowFuelFreqHz    = 1000;
int   HardwareConfig::wetGlowFuelResBits   = 10;
float HardwareConfig::wetGlowFuelPwmMinPct = 0.0f;
float HardwareConfig::wetGlowFuelPwmMaxPct = 100.0f;
float HardwareConfig::wetGlowFuelDemandPct = 100.0f;
int   HardwareConfig::wetGlowFuelDelayMs   = 8000;
int   HardwareConfig::glowCurrentPin           = -1;
float HardwareConfig::glowCurrentMvPerA        = 185.0f;
float HardwareConfig::glowCurrentZeroV         = 1.65f;
float HardwareConfig::glowCurrentReadyAmps     = 3.0f;
int   HardwareConfig::oilPumpCurrentPin        = -1;
float HardwareConfig::oilPumpCurrentMvPerA     = 100.0f;
float HardwareConfig::oilPumpCurrentZeroV      = 1.65f;
float HardwareConfig::oilPumpCurrentMaxAmps    = 0.0f;    // 0 = disabled
int   HardwareConfig::mavlinkTxPin     = -1;
int   HardwareConfig::mavlinkBaud      = 57600;
int   HardwareConfig::mavlinkIntervalMs = 100;

// Actuator pins & params
// throttleType / starterType: 0=servo  1=ledc_pwm  2=onoff
int   HardwareConfig::throttlePin         = OT_THROTTLE_PIN;
int   HardwareConfig::throttleType        = 0;     // default: servo
int   HardwareConfig::throttleMinUs       = OT_THROTTLE_SERVO_MIN_US;
int   HardwareConfig::throttleMaxUs       = OT_THROTTLE_SERVO_MAX_US;
bool  HardwareConfig::throttleInverted    = false;
bool  HardwareConfig::throttleActiveH     = true;
int   HardwareConfig::throttleLedcFreqHz  = 5000;
int   HardwareConfig::throttleLedcBits    = 12;
float HardwareConfig::throttlePwmMinPct   = 0.0f;
float HardwareConfig::throttlePwmMaxPct   = 100.0f;

int   HardwareConfig::starterPin          = OT_STARTER_MOTOR_PIN;
int   HardwareConfig::starterType         = 0;     // default: servo
int   HardwareConfig::starterMinUs        = OT_STARTER_SERVO_MIN_US;
int   HardwareConfig::starterMaxUs        = OT_STARTER_SERVO_MAX_US;
bool  HardwareConfig::starterInverted     = false;
bool  HardwareConfig::starterActiveH      = true;
int   HardwareConfig::starterLedcFreqHz   = 5000;
int   HardwareConfig::starterLedcBits     = 12;
float HardwareConfig::starterPwmMinPct    = 0.0f;
float HardwareConfig::starterPwmMaxPct    = 100.0f;

int   HardwareConfig::oilPumpPin       = OT_OIL_PUMP_PIN;
#ifdef OT_OIL_PUMP_ONOFF
int   HardwareConfig::oilPumpType      = 2;   // on-off
bool  HardwareConfig::oilPumpActiveH   = OT_OIL_PUMP_ONOFF_ACTIVE_H;
int   HardwareConfig::oilPumpMinUs     = 1000;
int   HardwareConfig::oilPumpMaxUs     = 2000;
int   HardwareConfig::oilPumpFreqHz    = 5000;
int   HardwareConfig::oilPumpResBits   = 12;
float HardwareConfig::oilPumpPwmMinPct = 0.0f;
float HardwareConfig::oilPumpPwmMaxPct = 100.0f;
#else
int   HardwareConfig::oilPumpType      = 1;   // ledc_pwm
bool  HardwareConfig::oilPumpActiveH   = true;
int   HardwareConfig::oilPumpMinUs     = 1000;
int   HardwareConfig::oilPumpMaxUs     = 2000;
int   HardwareConfig::oilPumpFreqHz    = OT_OIL_PUMP_FREQ_HZ;
int   HardwareConfig::oilPumpResBits   = OT_OIL_PUMP_RES_BITS;
float HardwareConfig::oilPumpPwmMinPct = 0.0f;
float HardwareConfig::oilPumpPwmMaxPct = 100.0f;
#endif

int   HardwareConfig::fuelSolPin       = OT_FUEL_SOL_PIN;
bool  HardwareConfig::fuelSolActiveH   = OT_FUEL_SOL_ACTIVE_H;

int   HardwareConfig::igniterPin       = OT_IGNITER_PIN;
bool  HardwareConfig::igniterActiveH   = OT_IGNITER_ACTIVE_H;
#ifdef OT_IGNITER_PWM
bool  HardwareConfig::igniterPwm       = true;
int   HardwareConfig::igniterDwellMs   = OT_IGNITER_DWELL_MS;
int   HardwareConfig::igniterRestMs    = OT_IGNITER_REST_MS;
#else
bool  HardwareConfig::igniterPwm       = false;
int   HardwareConfig::igniterDwellMs   = 6;
int   HardwareConfig::igniterRestMs    = 3;
#endif
bool  HardwareConfig::igniterCoil              = false;
float HardwareConfig::igniterCoilSatAmps       = 8.0f;
int   HardwareConfig::igniterCurrentPin        = -1;
float HardwareConfig::igniterCurrentMvPerA     = 100.0f;
float HardwareConfig::igniterCurrentZeroV      = 1.65f;

int   HardwareConfig::starterEnPin     = OT_STARTER_EN_PIN;
bool  HardwareConfig::starterEnActiveH = OT_STARTER_EN_ACTIVE_H;
int   HardwareConfig::starterEnDelayMs = 1000;  // 1 s default

int   HardwareConfig::igniter2Pin      = -1;
bool  HardwareConfig::igniter2ActiveH  = true;
bool  HardwareConfig::igniter2Pwm      = false;
int   HardwareConfig::igniter2DwellMs  = 6;
int   HardwareConfig::igniter2RestMs   = 3;
bool  HardwareConfig::igniter2Coil             = false;
float HardwareConfig::igniter2CoilSatAmps      = 8.0f;
int   HardwareConfig::igniter2CurrentPin       = -1;
float HardwareConfig::igniter2CurrentMvPerA    = 100.0f;
float HardwareConfig::igniter2CurrentZeroV     = 1.65f;

int   HardwareConfig::abSolPin         = OT_AB_SOL_PIN;
bool  HardwareConfig::abSolActiveH     = OT_AB_SOL_ACTIVE_H;
int   HardwareConfig::airstarterSolPin = OT_AIRSTARTER_SOL_PIN;
bool  HardwareConfig::airstarterSolActiveH = true;

int   HardwareConfig::coolFanPin       = OT_COOL_FAN_PIN;
int   HardwareConfig::coolFanType      = 2;   // on-off default
int   HardwareConfig::coolFanMinUs     = 1000;
int   HardwareConfig::coolFanMaxUs     = 2000;
bool  HardwareConfig::coolFanActiveH   = true;
int   HardwareConfig::coolFanFreqHz    = 5000;
int   HardwareConfig::coolFanResBits   = 12;
float HardwareConfig::coolFanPwmMinPct = 0.0f;
float HardwareConfig::coolFanPwmMaxPct = 100.0f;

int   HardwareConfig::abPumpPin        = -1;
int   HardwareConfig::abPumpType       = 2;   // on-off default
int   HardwareConfig::abPumpMinUs      = 1000;
int   HardwareConfig::abPumpMaxUs      = 2000;
bool  HardwareConfig::abPumpActiveH    = true;
int   HardwareConfig::abPumpFreqHz     = 5000;
int   HardwareConfig::abPumpResBits    = 12;
float HardwareConfig::abPumpPwmMinPct  = 0.0f;
float HardwareConfig::abPumpPwmMaxPct  = 100.0f;

int   HardwareConfig::oilScavPumpPin     = -1;
int   HardwareConfig::oilScavPumpType    = 2;
int   HardwareConfig::oilScavPumpMinUs   = 1000;
int   HardwareConfig::oilScavPumpMaxUs   = 2000;
bool  HardwareConfig::oilScavPumpActiveH = true;
int   HardwareConfig::oilScavPumpFreqHz  = 5000;
int   HardwareConfig::oilScavPumpResBits = 12;
float HardwareConfig::oilScavPumpPwmMinPct = 0.0f;
float HardwareConfig::oilScavPumpPwmMaxPct = 100.0f;

int   HardwareConfig::abTriggerSource    = 0;   // 0=manual
bool  HardwareConfig::abRequiresArmSwitch= false;
int   HardwareConfig::abArmSwitchPin     = -1;
bool  HardwareConfig::abArmSwitchActiveH = false;
int   HardwareConfig::abSwitchPin        = -1;
bool  HardwareConfig::abSwitchActiveH    = false;
int   HardwareConfig::abInputPin         = -1;
bool  HardwareConfig::abInputRcPwm       = false;
int   HardwareConfig::abInputMinUs       = 1000;
int   HardwareConfig::abInputMaxUs       = 2000;
int   HardwareConfig::abInputThreshold   = 2048;

bool  HardwareConfig::hasAbFlame         = false;

int   HardwareConfig::statusLedPin     = DEFAULT_STATUS_LED_PIN;
bool  HardwareConfig::statusLedActiveH = true;
int   HardwareConfig::statusLedType    = DEFAULT_STATUS_LED_TYPE;
int   HardwareConfig::statusLedMode    = DEFAULT_STATUS_LED_MODE;
uint32_t HardwareConfig::statusLedStandbyColor  = DEFAULT_STATUS_LED_STANDBY_COLOR;
uint32_t HardwareConfig::statusLedStartupColor  = DEFAULT_STATUS_LED_STARTUP_COLOR;
uint32_t HardwareConfig::statusLedRunningColor  = DEFAULT_STATUS_LED_RUNNING_COLOR;
uint32_t HardwareConfig::statusLedShutdownColor = DEFAULT_STATUS_LED_SHUTDOWN_COLOR;
uint32_t HardwareConfig::statusLedBlinkColor    = DEFAULT_STATUS_LED_BLINK_COLOR;

// Cluster serial
int   HardwareConfig::clusterTxPin     = OT_CLUSTER_TX_PIN;
int   HardwareConfig::clusterRxPin     = -1;
int   HardwareConfig::clusterBaud      = OT_CLUSTER_BAUD;
int   HardwareConfig::clusterIntervalMs= OT_CLUSTER_INTERVAL_MS;

// Controller feature flags
bool  HardwareConfig::hasOilLoop       = DEFAULT_HAS_OIL_LOOP;
bool  HardwareConfig::hasDynamicIdle   = DEFAULT_HAS_DYNAMIC_IDLE;
HardwareConfig::OilLoopDef HardwareConfig::oilLoops[HardwareConfig::MAX_OIL_LOOPS] = {};
uint8_t HardwareConfig::oilLoopCount = 0;

// Safety enables
bool  HardwareConfig::safetyOverspeed  = DEFAULT_SAFETY_OVERSPEED;
bool  HardwareConfig::safetyN2Overspeed = false;
bool  HardwareConfig::safetyOvertemp   = DEFAULT_SAFETY_OVERTEMP;
bool  HardwareConfig::safetyLowOil     = DEFAULT_SAFETY_LOW_OIL;
bool  HardwareConfig::safetyOilZero    = DEFAULT_SAFETY_OIL_ZERO;
bool  HardwareConfig::safetyFlameout   = DEFAULT_SAFETY_FLAMEOUT;
bool  HardwareConfig::safetyHotStart   = false;
bool  HardwareConfig::safetyOilTempHigh  = false;
bool  HardwareConfig::safetyFuelPressLow = false;
bool  HardwareConfig::safetyBattLow      = false;
bool  HardwareConfig::safetySurge        = false;

// Channel display labels
char HardwareConfig::labelTot[32]       = "TOT";
char HardwareConfig::labelTit[32]       = "TIT";
char HardwareConfig::labelN1[32]        = "N1";
char HardwareConfig::labelN2[32]        = "N2";
char HardwareConfig::labelOilPress[32]  = "Oil Press";
char HardwareConfig::labelOilTemp[32]   = "Oil Temp";
char HardwareConfig::labelP1[32]        = "Pressure 1";
char HardwareConfig::labelP2[32]        = "Pressure 2";
char HardwareConfig::labelFuelPress[32] = "Fuel Press";
char HardwareConfig::labelFuelFlow[32]  = "Fuel Flow";
char HardwareConfig::labelStop[32]      = "Stop";
char HardwareConfig::labelStart[32]     = "Start";
char HardwareConfig::labelAbArm[32]     = "AB Arm";

// General-purpose digital input channels
HardwareConfig::DiChannel HardwareConfig::diCh[HardwareConfig::MAX_DI] = {};

// Sequences — block order and delays come from OT_STARTUP_SEQ /
// OT_SHUTDOWN_SEQ (+ OT_*_DELAY_MS) in hardware_profile.h.
char  HardwareConfig::startupSeq[MAX_SEQ_BLOCKS][24] = {
#define OT_BLOCK(name) #name,
    OT_STARTUP_SEQ
#undef OT_BLOCK
};
int   HardwareConfig::startupSeqLen    = kProfileStartupSeqLen;
int   HardwareConfig::startupDelayMs[MAX_SEQ_BLOCKS] = OT_STARTUP_DELAY_MS;
uint8_t HardwareConfig::startupIgnitionTarget[MAX_SEQ_BLOCKS] = {};
char HardwareConfig::startupDeviceTarget[MAX_SEQ_BLOCKS][20] = {};
HardwareConfig::SeqSideAction HardwareConfig::startupEnterActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS] = {};
HardwareConfig::SeqSideAction HardwareConfig::startupExitActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS] = {};

char  HardwareConfig::shutdownSeq[MAX_SEQ_BLOCKS][24] = {
#define OT_BLOCK(name) #name,
    OT_SHUTDOWN_SEQ
#undef OT_BLOCK
};
int   HardwareConfig::shutdownSeqLen   = kProfileShutdownSeqLen;
int   HardwareConfig::shutdownDelayMs[MAX_SEQ_BLOCKS] = OT_SHUTDOWN_DELAY_MS;
uint8_t HardwareConfig::shutdownIgnitionTarget[MAX_SEQ_BLOCKS] = {};
char HardwareConfig::shutdownDeviceTarget[MAX_SEQ_BLOCKS][20] = {};
HardwareConfig::SeqSideAction HardwareConfig::shutdownEnterActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS] = {};
HardwareConfig::SeqSideAction HardwareConfig::shutdownExitActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS] = {};

char  HardwareConfig::abSeq[MAX_SEQ_BLOCKS][24]    = {};
int   HardwareConfig::abSeqLen                     = 0;
int   HardwareConfig::abDelayMs[MAX_SEQ_BLOCKS]    = {};
uint8_t HardwareConfig::abIgnitionTarget[MAX_SEQ_BLOCKS] = {};
char HardwareConfig::abDeviceTarget[MAX_SEQ_BLOCKS][20] = {};
HardwareConfig::SeqSideAction HardwareConfig::abEnterActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS] = {};
HardwareConfig::SeqSideAction HardwareConfig::abExitActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS] = {};
char  HardwareConfig::abShutSeq[MAX_SEQ_BLOCKS][24]= {};
int   HardwareConfig::abShutSeqLen                 = 0;
int   HardwareConfig::abShutDelayMs[MAX_SEQ_BLOCKS]= {};
uint8_t HardwareConfig::abShutIgnitionTarget[MAX_SEQ_BLOCKS] = {};
char HardwareConfig::abShutDeviceTarget[MAX_SEQ_BLOCKS][20] = {};
HardwareConfig::SeqSideAction HardwareConfig::abShutEnterActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS] = {};
HardwareConfig::SeqSideAction HardwareConfig::abShutExitActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS] = {};
HardwareConfig::CustomBlockDef HardwareConfig::customBlocks[MAX_CUSTOM_BLOCKS] = {};
int HardwareConfig::customBlockCount = 0;

// ── Load ──────────────────────────────────────────────────────
static void inhibitStartForHardwareConfigFailure(const char* reason, bool storageFault = false) {
    auto& ed = EngineData::instance();
    ed.configLocked = true;
    ed.configStorageFault = storageFault;
    strncpy(ed.faultDescription, reason, sizeof(ed.faultDescription) - 1);
    ed.faultDescription[sizeof(ed.faultDescription) - 1] = '\0';
}

void HardwareConfig::load() {
    applyDefaults();
    auto& bootState = EngineData::instance();
    if (!PcbProfileManager::faulted() && !bootState.configStorageFault) {
        bootState.configLocked = false;
    }

    static constexpr const char* BAK_PATH = "/ecu_config.bak";
    if (!LittleFS.exists(PATH) && LittleFS.exists(BAK_PATH)) {
        if (LittleFS.rename(BAK_PATH, PATH)) {
            Serial.println("[HWCfg] Recovered ecu_config.json from backup");
        }
    }

    // First boot with no ecu_config.json seeds the file from the compiled
    // hardware_profile.h defaults (applyDefaults() above + save() below).
    // Factory reset regenerates from the same defaults (no factory_config.json
    // ships), so hardware_profile.h is the single source of default topology.
    if (!LittleFS.exists(PATH)) {
        Serial.println("[HWCfg] No ecu_config.json - using compiled defaults, generating file");
        if (!save()) {
            inhibitStartForHardwareConfigFailure(
                "Cannot start: hardware configuration storage is unavailable.", true);
        } else if (PcbProfileManager::active() &&
                   !registryHasPurpose(&channelRegistry, ChannelRegistry::Input,
                                       "stop_switch")) {
            inhibitStartForHardwareConfigFailure(
                "Cannot start: assign the required Stop switch to a PCB connection in Hardware.");
        }
        return;
    }

    File f = LittleFS.open(PATH, "r");
    if (!f) {
        Serial.println("[HWCfg] Failed to open ecu_config.json - using defaults");
        inhibitStartForHardwareConfigFailure(
            "Cannot start: failed to read the hardware configuration.", true);
        return;
    }
    const size_t configSize = f.size();
    if (configSize > 196608UL) {
        f.close();
        Serial.println("[HWCfg] Stored config is too large - START inhibited");
        applyDefaults();
        inhibitStartForHardwareConfigFailure(
            "Cannot start: ecu_config.json is unexpectedly large. Use Tools to export "
            "it for diagnosis, then restore a valid engine file or reset configuration.",
            true);
        return;
    }
    delay(0);
    // Parse only the hardware subtree before Wi-Fi/AsyncTCP reserve their
    // runtime memory. This is the same straightforward boot path on both chips.
    JsonDocument filter;
    filter[SECTION] = true;
    JsonDocument fullDoc;
    DeserializationError err = deserializeJson(
        fullDoc, f, DeserializationOption::Filter(filter));
    f.close();
    delay(0);
    if (err) {
        Serial.printf("[HWCfg] JSON parse error: %s - using defaults\n", err.c_str());
        inhibitStartForHardwareConfigFailure(
            "Cannot start: the hardware configuration file is corrupted.", true);
        return;
    }
    JsonDocument workDoc;
    if (fullDoc[SECTION].is<JsonObject>()) {
        workDoc.set(fullDoc[SECTION]);
        fullDoc.clear();
        fullDoc.shrinkToFit();
        delay(0);
    } else {
        Serial.println("[HWCfg] Hardware section missing - adding compiled defaults");
        if (!save()) {
            inhibitStartForHardwareConfigFailure(
                "Cannot start: no stored hardware configuration is available.", true);
        }
        return;
    }

    const char* id = workDoc["profile_id"] | "";
    if (!id[0]) {
        inhibitStartForHardwareConfigFailure(
            "Cannot start: stored hardware profile ID is missing.");
        Serial.println("[HWCfg] Hardware profile ID is missing - START inhibited");
        return;
    }
    if (storedHardwarePlatformMismatch(workDoc)) {
        Serial.printf("[HWCfg] Stored hardware platform %s does not match firmware %s - regenerating safe defaults\n",
                      workDoc["platform"] | "(unset)", currentPlatformName());
        applyDefaults();
        if (!save()) {
            inhibitStartForHardwareConfigFailure(
                "Cannot start: hardware configuration could not be saved to storage.", true);
            Serial.println("[HWCfg] Platform migration save failed - START inhibited");
        }
        return;
    }
    normalizeS3StatusLedDefault(workDoc);
    if (!workDoc["channel_registry"].is<JsonObjectConst>()) {
        inhibitStartForHardwareConfigFailure(
            "Cannot start: hardware channel registry is missing or invalid.");
        Serial.println("[HWCfg] Hardware channel registry is missing or invalid - START inhibited");
        return;
    }
    // Use the exact same complete validation path as POST /api/hardware.
    if (!validateJson(workDoc)) {
        inhibitStartForHardwareConfigFailure(
            "Cannot start: stored hardware configuration is invalid or unsafe.");
        Serial.println("[HWCfg] Complete hardware validation failed - START inhibited");
        return;
    }
    _fromDoc(workDoc);
    if (PcbProfileManager::active() &&
        !registryHasPurpose(&channelRegistry, ChannelRegistry::Input,
                            "stop_switch")) {
        inhibitStartForHardwareConfigFailure(
            "Cannot start: assign the required Stop switch to a PCB connection in Hardware.");
    }
    Serial.printf("[HWCfg] Loaded OK - profile: %s\n", profileId);
}

// ── Save ──────────────────────────────────────────────────────
bool HardwareConfig::save() {
    static constexpr const char* TMP_PATH = "/ecu_config.hw.tmp";
    static constexpr const char* BAK_PATH = "/ecu_config.bak";
    if (!Config::acquireStorageWrite()) {
        Serial.println("[HWCfg] Timed out waiting to write ecu_config.json");
        return false;
    }
    struct StorageRelease {
        ~StorageRelease() { Config::releaseStorageWrite(); }
    } release;
    // Read-modify-write: preserve other sections (settings etc.)
    JsonDocument fullDoc;
    File fr = LittleFS.open(PATH, "r");
    if (fr) {
        // The unified file currently has two authoritative top-level
        // sections. Hardware is being replaced, so parsing its old copy only
        // wastes heap while the incoming POST document is still resident.
        JsonDocument filter;
        filter["settings"] = true;
        DeserializationError err = deserializeJson(
            fullDoc, fr, DeserializationOption::Filter(filter));
        fr.close();
        if (err) {
            Serial.printf("[HWCfg] Refusing to overwrite unreadable ecu_config.json: %s\n",
                          err.c_str());
            return false;
        }
    }

    // Rebuild Hardware directly inside the unified document; no second
    // hardware document or copied replacement is needed.
    _toDoc(fullDoc[SECTION].to<JsonObject>());
    if (fullDoc["settings"].is<JsonObject>())
        fullDoc["settings"]["profile_id"] = profileId;

    File fw = LittleFS.open(TMP_PATH, "w");
    if (!fw) {
        Serial.println("[HWCfg] Failed to open ecu_config.hw.tmp for write");
        return false;
    }
    size_t expected = measureJsonPretty(fullDoc);
    size_t written = serializeJsonPretty(fullDoc, fw);
    fw.close();
    if (written != expected) {
        LittleFS.remove(TMP_PATH);
        Serial.println("[HWCfg] Incomplete write to ecu_config.hw.tmp");
        return false;
    }
    LittleFS.remove(BAK_PATH);
    bool hadOriginal = LittleFS.exists(PATH);
    if (hadOriginal && !LittleFS.rename(PATH, BAK_PATH)) {
        LittleFS.remove(TMP_PATH);
        Serial.println("[HWCfg] failed to preserve previous ecu_config.json");
        return false;
    }
    if (!LittleFS.rename(TMP_PATH, PATH)) {
        Serial.println("[HWCfg] rename ecu_config.hw.tmp failed");
        const bool restored = !hadOriginal || LittleFS.rename(BAK_PATH, PATH);
        LittleFS.remove(TMP_PATH);
        if (!restored) {
            // Keep ecu_config.bak: load() can recover it on a later boot once
            // the filesystem is writable again.
            Serial.println("[HWCfg] rollback failed; preserving ecu_config.bak for boot recovery");
        }
        return false;
    }
    if (hadOriginal) LittleFS.remove(BAK_PATH);
    return true;
}

// ── Apply defaults ─────────────────────────────────────────────
// Called before load() to seed all values from hardware_profile.h.
// Static member initialisers already handle this at program start;
// this function is used when resetting to defaults at runtime.
bool HardwareConfig::saveUnified(bool preserveStoredSettings) {
    static constexpr const char* TMP_PATH = "/ecu_config.unified.tmp";
    static constexpr const char* BAK_PATH = "/ecu_config.bak";
    if (!Config::acquireStorageWrite()) {
        Serial.println("[HWCfg] Timed out waiting to write unified ecu_config.json");
        return false;
    }
    struct StorageRelease {
        ~StorageRelease() { Config::releaseStorageWrite(); }
    } release;

    File fw = LittleFS.open(TMP_PATH, "w");
    if (!fw) {
        Serial.println("[HWCfg] Failed to open ecu_config.unified.tmp for write");
        return false;
    }
    bool ok = fw.print("{\"hardware\":") == strlen("{\"hardware\":");
    JsonDocument section;
    _toDoc(section.to<JsonObject>());
    const size_t hardwareExpected = measureJson(section);
    ok &= !section.overflowed();
    ok &= serializeJson(section, fw) == hardwareExpected;
    section.clear();
    section.shrinkToFit();
    delay(0);

    ok &= fw.print(",\"settings\":") == strlen(",\"settings\":");
    if (preserveStoredSettings) {
        ok &= Config::copyStoredSettings(fw);
    } else {
        Config::toJson(section);
        const size_t settingsExpected = measureJson(section);
        ok &= !section.overflowed();
        ok &= serializeJson(section, fw) == settingsExpected;
    }
    ok &= fw.print('}') == 1;
    fw.close();
    section.clear();
    section.shrinkToFit();
    if (!ok) {
        LittleFS.remove(TMP_PATH);
        Serial.println("[HWCfg] Incomplete unified config write");
        return false;
    }

    LittleFS.remove(BAK_PATH);
    const bool hadOriginal = LittleFS.exists(PATH);
    if (hadOriginal && !LittleFS.rename(PATH, BAK_PATH)) {
        LittleFS.remove(TMP_PATH);
        Serial.println("[HWCfg] Failed to preserve previous unified config");
        return false;
    }
    if (!LittleFS.rename(TMP_PATH, PATH)) {
        Serial.println("[HWCfg] Failed to install unified config");
        const bool restored = !hadOriginal || LittleFS.rename(BAK_PATH, PATH);
        LittleFS.remove(TMP_PATH);
        if (!restored)
            Serial.println("[HWCfg] Unified rollback failed; preserving backup");
        return false;
    }
    if (hadOriginal) LittleFS.remove(BAK_PATH);
    return true;
}

int8_t HardwareConfig::outputActuatorForId(const char* id) {
    return sequenceTargetHandle(id);
}

const char* HardwareConfig::defaultOutputIdForPurpose(const char* purpose) {
    if (!purpose || !purpose[0]) return "";
    const char* bindingKey = ChannelRegistry::coreOutputBindingKey(purpose);
    if (bindingKey) {
        for (uint8_t i = 0; i < channelRegistry.bindingCount; ++i) {
            if (strcmp(channelRegistry.bindings[i].key, bindingKey)) continue;
            const auto* bound = channelRegistry.find(channelRegistry.bindings[i].channelId,
                                                     ChannelRegistry::Output);
            if (bound && bound->installed && !bound->mirrorOf[0] &&
                !strcmp(bound->purpose, purpose) &&
                ChannelRegistry::channelAddressable(*bound)) return bound->id;
        }
    }
    const char* sole = "";
    uint8_t matches = 0;
    for (uint8_t i = 0; i < channelRegistry.outputCount; ++i) {
        const auto& output = channelRegistry.outputs[i];
        if (!output.installed || output.mirrorOf[0] ||
            strcmp(output.purpose, purpose) ||
            !ChannelRegistry::channelAddressable(output)) continue;
        sole = output.id;
        ++matches;
    }
    return matches == 1 ? sole : "";
}

void HardwareConfig::applyDefaults() {
    strncpy(profileId,   OT_PROFILE_ID,   sizeof(profileId)   - 1);
    // An immutable PCB profile is the hardware identity for this installation.
    // First boot and factory reset must seed both unified-config sections with
    // that identity; retaining the development-board build ID here creates a
    // guaranteed profile mismatch immediately after a successful reset.
    if (PcbProfileManager::active() && PcbProfileManager::catalog() &&
        PcbProfileManager::catalog()->boardId[0]) {
        strlcpy(profileId, PcbProfileManager::catalog()->boardId,
                sizeof(profileId));
    }
    strncpy(profileDesc, OT_PROFILE_DESC, sizeof(profileDesc) - 1);
    hasAfterburner = DEFAULT_HAS_AFTERBURNER;

    stopPin      = OT_STOP_PIN;  stopActiveH  = false;  stopPullup  = true;  stopPulldown  = false;
    startPin     = OT_START_PIN; startActiveH = false;  startPullup = true;  startPulldown = false;

    hasN1Rpm  = DEFAULT_HAS_N1_RPM; hasN2Rpm = DEFAULT_HAS_N2_RPM;
    hasTot = DEFAULT_HAS_TOT; hasTit = false;
    hasOilPress = DEFAULT_HAS_OIL_PRESS; hasFlame = DEFAULT_HAS_FLAME;
    hasFuelFlow = DEFAULT_HAS_FUEL_FLOW; hasFuelPress = false;
    hasP1 = DEFAULT_HAS_P1; hasP2 = DEFAULT_HAS_P2;
    hasThrottleInput = DEFAULT_HAS_THROTTLE_INPUT; hasIdleInput = DEFAULT_HAS_IDLE_INPUT;
    hasOilTemp = false; hasBattVoltage = false; hasTorque = false; hasThrust = false;
    i2cEnabled = false;
#ifdef OT_PLATFORM_ESP32S3
    i2cSdaPin = 8; i2cSclPin = 9;
#else
    i2cSdaPin = 26; i2cSclPin = 27;
#endif
    i2cInterruptPin = -1; i2cFrequencyHz = 400000;
    spiEnabled = DEFAULT_HAS_TOT;
    spiSckPin = OT_TOT_CLK;
    spiMisoPin = OT_TOT_MISO;
    spiMosiPin = -1;

    n1RpmPin  = OT_N1_RPM_PIN; n1RpmPpr = OT_N1_RPM_PPR;
    n2RpmPin  = OT_N2_RPM_PIN;  n2RpmPpr  = OT_N2_RPM_PPR;
    strncpy(totChip, "max6675", sizeof(totChip) - 1);
    strncpy(totTcType, "K", sizeof(totTcType) - 1);
    totClk    = OT_TOT_CLK; totCs = OT_TOT_CS; totMiso = OT_TOT_MISO; totMosi = -1;
    strncpy(titChip, "max6675", sizeof(titChip) - 1);
    strncpy(titTcType, "K", sizeof(titTcType) - 1);
    titClk = -1; titCs = -1; titMiso = -1; titMosi = -1;
    oilPressPin = OT_OIL_PRESS_PIN; flamePin = OT_FLAME_PIN;
    fuelFlowPin = OT_FUEL_FLOW_PIN; fuelFlowType = 0; fuelFlowPulsesPerLitre = 100.0f;
    fuelPressPin = OT_ADC_5; p1Pin = OT_P1_PIN; p2Pin = OT_P2_PIN;
    throttleInputPin = OT_THROTTLE_INPUT_PIN; throttleInputRcPwm = DEFAULT_THROTTLE_INPUT_RC_PWM;
    idleInputPin     = OT_IDLE_INPUT_PIN;     idleInputRcPwm     = DEFAULT_IDLE_INPUT_RC_PWM;

    strncpy(oilTempChip, "ntc", sizeof(oilTempChip) - 1);
    oilTempPin = -1; oilTempCs = -1; oilTempMiso = -1; oilTempMosi = -1;
    strncpy(oilTempTcType, "K", sizeof(oilTempTcType) - 1);
    oilTempResolution = 10;
    ntcBeta = 3950.0f; ntcR0 = 10000.0f; ntcRFixed = 10000.0f; ntcFixedPullup = true;
    oilTempUseRawPoly = false;
    oilTempPolyA = oilTempPolyB = oilTempPolyC = oilTempPolyD = 0.0f;
    oilTempPolyXMin = 0.0f; oilTempPolyXMax = 4095.0f;
    battVoltPin = -1; battVoltDivider = 5.7f;
    torquePin = -1; torqueScale = 30.3f; torqueOffset = 0.0f;
    torqueHx711 = false; torqueDtPin = -1; torqueClkPin = -1;
    torqueHxScale = 1.0f; torqueHxZero = 0;

    hasThrottle = DEFAULT_HAS_THROTTLE; hasStarter = DEFAULT_HAS_STARTER;
    hasOilPump = DEFAULT_HAS_OIL_PUMP;
    hasFuelSol  = DEFAULT_HAS_FUEL_SOL; hasIgniter = DEFAULT_HAS_IGNITER;
    hasIgniter2 = false; hasStarterEn = DEFAULT_HAS_STARTER_EN;
    hasAbSol = DEFAULT_HAS_AB_SOL; hasAirstarterSol = DEFAULT_HAS_AIRSTARTER_SOL;
    hasCoolFan = DEFAULT_HAS_COOL_FAN;
    hasAbPump = false; hasFuelPump2 = false; hasBleedValve = false;
    hasPropPitch = false; hasGlowPlug = false;
    hasGlowCurrentSensor = false; hasIgniterCurrentSensor = false;
    hasIgniter2CurrentSensor = false; hasOilPumpCurrentSensor = false;
    hasGovernor = false; hasMAVLink = false;
    hasStatusLed = DEFAULT_STATUS_LED_PIN != -1; hasClusterSerial = DEFAULT_HAS_CLUSTER_SERIAL;
    statusLedActiveH = true;
    hasBuzzer = false; buzzerPin = -1;

    fuelPump2Pin = -1; fuelPump2Type = 1; fuelPump2MinUs = 1000; fuelPump2MaxUs = 2000;
    fuelPump2ActiveH = true; fuelPump2FreqHz = 5000; fuelPump2ResBits = 12;
    fuelPump2PwmMinPct = 0.0f; fuelPump2PwmMaxPct = 100.0f;
    bleedValveType = 2; bleedValvePin = -1; bleedValveActiveH = true;
    bleedValveMinUs = 1000; bleedValveMaxUs = 2000; bleedValveFreqHz = 5000; bleedValveResBits = 10;
    bleedValvePwmMinPct = 0.0f; bleedValvePwmMaxPct = 100.0f;
    propPitchType = 0; propPitchPin = -1; propPitchMinUs = 1000; propPitchMaxUs = 2000;
    propPitchFreqHz = 5000; propPitchResBits = 10; propPitchActiveH = true;
    propPitchPwmMinPct = 0.0f; propPitchPwmMaxPct = 100.0f;
    glowPlugType = 0; glowPlugOutputType = 0; glowPlugActiveH = true;
    glowPlugPin = -1; glowPlugFreqHz = 1000; glowPlugResBits = 8;
    glowPlugPwmMinPct = 0.0f; glowPlugPwmMaxPct = 100.0f;
    wetGlowFuelPin = -1; wetGlowFuelType = 0; wetGlowFuelActiveH = true;
    wetGlowFuelMinUs = 1000; wetGlowFuelMaxUs = 2000;
    wetGlowFuelFreqHz = 1000; wetGlowFuelResBits = 10;
    wetGlowFuelPwmMinPct = 0.0f; wetGlowFuelPwmMaxPct = 100.0f;
    wetGlowFuelDemandPct = 100.0f; wetGlowFuelDelayMs = 8000;
    glowCurrentPin = -1; glowCurrentMvPerA = 185.0f; glowCurrentZeroV = 1.65f; glowCurrentReadyAmps = 3.0f;
    oilPumpCurrentPin = -1; oilPumpCurrentMvPerA = 100.0f; oilPumpCurrentZeroV = 1.65f; oilPumpCurrentMaxAmps = 0.0f;
    mavlinkTxPin = -1; mavlinkBaud = 57600; mavlinkIntervalMs = 100;

    throttlePin        = OT_THROTTLE_PIN;
    throttleType       = 0; throttleInverted = false; throttleActiveH = true;
    throttleMinUs      = OT_THROTTLE_SERVO_MIN_US;
    throttleMaxUs      = OT_THROTTLE_SERVO_MAX_US;
    throttleLedcFreqHz = 5000; throttleLedcBits = 12;
    throttlePwmMinPct = 0.0f; throttlePwmMaxPct = 100.0f;

    starterPin        = OT_STARTER_MOTOR_PIN;
    starterType       = 0; starterInverted = false; starterActiveH = true;
    starterMinUs      = OT_STARTER_SERVO_MIN_US;
    starterMaxUs      = OT_STARTER_SERVO_MAX_US;
    starterLedcFreqHz = 5000; starterLedcBits = 12;
    starterPwmMinPct = 0.0f; starterPwmMaxPct = 100.0f;

    oilPumpPin     = OT_OIL_PUMP_PIN;
    oilPumpMinUs   = 1000; oilPumpMaxUs = 2000;
    oilPumpPwmMinPct = 0.0f; oilPumpPwmMaxPct = 100.0f;
#ifdef OT_OIL_PUMP_ONOFF
    oilPumpType    = 2;   // on-off
    oilPumpActiveH = OT_OIL_PUMP_ONOFF_ACTIVE_H;
    oilPumpFreqHz  = 5000;
    oilPumpResBits = 12;
#else
    oilPumpType    = 1;   // ledc_pwm
    oilPumpActiveH = true;
    oilPumpFreqHz  = OT_OIL_PUMP_FREQ_HZ;
    oilPumpResBits = OT_OIL_PUMP_RES_BITS;
#endif

    fuelSolPin     = OT_FUEL_SOL_PIN;
    fuelSolActiveH = OT_FUEL_SOL_ACTIVE_H;

    igniterPin     = OT_IGNITER_PIN;
    igniterActiveH = OT_IGNITER_ACTIVE_H;
#ifdef OT_IGNITER_PWM
    igniterPwm     = true;
    igniterDwellMs = OT_IGNITER_DWELL_MS;
    igniterRestMs  = OT_IGNITER_REST_MS;
#else
    igniterPwm     = false;
    igniterDwellMs = 6;
    igniterRestMs  = 3;
#endif
    igniterCoil = false; igniterCoilSatAmps = 8.0f;
    igniterCurrentPin = -1; igniterCurrentMvPerA = 100.0f; igniterCurrentZeroV = 1.65f;

    starterEnPin     = OT_STARTER_EN_PIN;
    starterEnActiveH = OT_STARTER_EN_ACTIVE_H;
    starterEnDelayMs = 1000;             // mirror static-init default (was missing here)

    igniter2Pin = -1; igniter2ActiveH = true; igniter2Pwm = false;
    igniter2DwellMs = 6; igniter2RestMs = 3;
    igniter2Coil = false; igniter2CoilSatAmps = 8.0f;
    igniter2CurrentPin = -1; igniter2CurrentMvPerA = 100.0f; igniter2CurrentZeroV = 1.65f;

    abSolPin = OT_AB_SOL_PIN; abSolActiveH = OT_AB_SOL_ACTIVE_H;
    airstarterSolPin = OT_AIRSTARTER_SOL_PIN; airstarterSolActiveH = true;

    coolFanPin = OT_COOL_FAN_PIN; coolFanType = 2; coolFanMinUs = 1000; coolFanMaxUs = 2000;
    coolFanActiveH = true; coolFanFreqHz = 5000; coolFanResBits = 12;
    coolFanPwmMinPct = 0.0f; coolFanPwmMaxPct = 100.0f;

    abPumpPin = -1; abPumpType = 2; abPumpMinUs = 1000; abPumpMaxUs = 2000;
    abPumpActiveH = true; abPumpFreqHz = 5000; abPumpResBits = 12;
    abPumpPwmMinPct = 0.0f; abPumpPwmMaxPct = 100.0f;

    hasOilScavengePump = false;
    oilScavPumpPin     = -1;
    oilScavPumpType    = 2;
    oilScavPumpMinUs   = 1000;
    oilScavPumpMaxUs   = 2000;
    oilScavPumpActiveH = true;
    oilScavPumpFreqHz  = 5000;
    oilScavPumpResBits = 12;
    oilScavPumpPwmMinPct = 0.0f; oilScavPumpPwmMaxPct = 100.0f;

    abTriggerSource     = 0;
    abRequiresArmSwitch = false;
    abArmSwitchPin      = -1;
    abArmSwitchActiveH  = false;
    abSwitchPin         = -1;
    abSwitchActiveH     = false;
    abInputPin          = -1;
    abInputRcPwm        = false;
    abInputMinUs        = 1000;
    abInputMaxUs        = 2000;
    abInputThreshold    = 2048;
    hasAbFlame          = false;

    wifiTxPowerDbm = 8;                  // mirror static-init default (was missing here)

    statusLedPin = DEFAULT_STATUS_LED_PIN;
    statusLedType = DEFAULT_STATUS_LED_TYPE;
    statusLedMode = DEFAULT_STATUS_LED_MODE;
    statusLedStandbyColor  = DEFAULT_STATUS_LED_STANDBY_COLOR;
    statusLedStartupColor  = DEFAULT_STATUS_LED_STARTUP_COLOR;
    statusLedRunningColor  = DEFAULT_STATUS_LED_RUNNING_COLOR;
    statusLedShutdownColor = DEFAULT_STATUS_LED_SHUTDOWN_COLOR;
    statusLedBlinkColor    = DEFAULT_STATUS_LED_BLINK_COLOR;

    // Labels and DI channels belong to the previous engine profile — a
    // defaults reset must not retain stale safety inputs (estop, fault,
    // inhibit_start) or display names.
    auto resetLabel = [](char* dst, size_t len, const char* value) {
        strncpy(dst, value, len - 1);
        dst[len - 1] = '\0';
    };
    resetLabel(labelTot,       sizeof(labelTot),       "TOT");
    resetLabel(labelTit,       sizeof(labelTit),       "TIT");
    resetLabel(labelN1,        sizeof(labelN1),        "N1");
    resetLabel(labelN2,        sizeof(labelN2),        "N2");
    resetLabel(labelOilPress,  sizeof(labelOilPress),  "Oil Press");
    resetLabel(labelOilTemp,   sizeof(labelOilTemp),   "Oil Temp");
    resetLabel(labelP1,        sizeof(labelP1),        "Pressure 1");
    resetLabel(labelP2,        sizeof(labelP2),        "Pressure 2");
    resetLabel(labelFuelPress, sizeof(labelFuelPress), "Fuel Press");
    resetLabel(labelFuelFlow,  sizeof(labelFuelFlow),  "Fuel Flow");
    resetLabel(labelStop,      sizeof(labelStop),      "Stop");
    resetLabel(labelStart,     sizeof(labelStart),     "Start");
    resetLabel(labelAbArm,     sizeof(labelAbArm),     "AB Arm");
    for (int i = 0; i < MAX_DI; i++) diCh[i] = DiChannel{};

    clusterTxPin    = OT_CLUSTER_TX_PIN;
    clusterRxPin    = -1;
    clusterBaud     = OT_CLUSTER_BAUD;
    clusterIntervalMs = OT_CLUSTER_INTERVAL_MS;

    hasOilLoop      = DEFAULT_HAS_OIL_LOOP;
    hasDynamicIdle  = DEFAULT_HAS_DYNAMIC_IDLE;
    oilLoopCount = 0;
    for (int i = 0; i < MAX_OIL_LOOPS; i++) oilLoops[i] = OilLoopDef{};
    // hardware_profile.h compile guards enforce the other controller
    // dependencies; dynamic idle's RPM requirement is only checked here.
    if (hasDynamicIdle && !hasN1Rpm && !hasN2Rpm) hasDynamicIdle = false;

    safetyOverspeed = DEFAULT_SAFETY_OVERSPEED;
    safetyN2Overspeed = false;
    safetyOvertemp  = DEFAULT_SAFETY_OVERTEMP;
    safetyLowOil    = DEFAULT_SAFETY_LOW_OIL;
    safetyOilZero   = DEFAULT_SAFETY_OIL_ZERO;
    safetyFlameout  = DEFAULT_SAFETY_FLAMEOUT;
    safetyHotStart      = false;
    safetyOilTempHigh   = false;
    safetyFuelPressLow  = false;
    safetyBattLow       = false;
    safetySurge         = false;

    // Block order and per-block delays come from OT_STARTUP_SEQ /
    // OT_SHUTDOWN_SEQ and OT_STARTUP_DELAY_MS / OT_SHUTDOWN_DELAY_MS.
    startupSeqLen = kProfileStartupSeqLen;
    memset(startupSeq, 0, sizeof(startupSeq));
    memset(startupDelayMs, 0, sizeof(startupDelayMs));
    memset(startupIgnitionTarget, 0, sizeof(startupIgnitionTarget));
    memset(startupDeviceTarget, 0, sizeof(startupDeviceTarget));
    clearSeqSideActions(startupEnterActions);
    clearSeqSideActions(startupExitActions);
    for (int i = 0; i < startupSeqLen; i++) {
        strncpy(startupSeq[i], kProfileStartupSeq[i], sizeof(startupSeq[i]) - 1);
        if (i < kProfileStartupDelayLen) startupDelayMs[i] = kProfileStartupDelayMs[i];
    }

    shutdownSeqLen = kProfileShutdownSeqLen;
    memset(shutdownSeq, 0, sizeof(shutdownSeq));
    memset(shutdownDelayMs, 0, sizeof(shutdownDelayMs));
    memset(shutdownIgnitionTarget, 0, sizeof(shutdownIgnitionTarget));
    memset(shutdownDeviceTarget, 0, sizeof(shutdownDeviceTarget));
    clearSeqSideActions(shutdownEnterActions);
    clearSeqSideActions(shutdownExitActions);
    for (int i = 0; i < shutdownSeqLen; i++) {
        strncpy(shutdownSeq[i], kProfileShutdownSeq[i], sizeof(shutdownSeq[i]) - 1);
        if (i < kProfileShutdownDelayLen) shutdownDelayMs[i] = kProfileShutdownDelayMs[i];
    }

    // AB ignition: check conditions -> open solenoid -> start pump -> torch spike -> confirm flame -> stabilize.
    // Only seed when an afterburner is fitted; a no-AB build leaves the AB
    // sequences empty rather than carrying an orphaned sequence for hardware
    // that isn't there (keeps a minimal profile truly minimal).
    const char* defAbIgn[] = {
        "ABCheckReady","ABSolOpen","ABPumpOn","ABIgnite","ABFlameConfirm","ABStabilize"
    };
    abSeqLen = hasAfterburner ? 6 : 0;
    memset(abSeq, 0, sizeof(abSeq));
    memset(abDelayMs, 0, sizeof(abDelayMs));
    memset(abIgnitionTarget, 0, sizeof(abIgnitionTarget));
    memset(abDeviceTarget, 0, sizeof(abDeviceTarget));
    clearSeqSideActions(abEnterActions);
    clearSeqSideActions(abExitActions);
    for (int i = 0; i < abSeqLen; i++)
        strncpy(abSeq[i], defAbIgn[i], sizeof(abSeq[i]) - 1);

    // AB shutdown: close solenoid first, then cut pump
    const char* defAbShut[] = { "ABSolClose", "ABPumpOff" };
    abShutSeqLen = hasAfterburner ? 2 : 0;
    memset(abShutSeq, 0, sizeof(abShutSeq));
    memset(abShutDelayMs, 0, sizeof(abShutDelayMs));
    memset(abShutIgnitionTarget, 0, sizeof(abShutIgnitionTarget));
    memset(abShutDeviceTarget, 0, sizeof(abShutDeviceTarget));
    clearSeqSideActions(abShutEnterActions);
    clearSeqSideActions(abShutExitActions);
    clearCustomBlocks();
    for (int i = 0; i < abShutSeqLen; i++)
        strncpy(abShutSeq[i], defAbShut[i], sizeof(abShutSeq[i]) - 1);

    // A factory reset must describe the fitted profile on the Hardware page,
    // not leave the modern inventory empty while only legacy fields are live.
    channelRegistry.clear();
    auto addDefaultInput = [](const char* id, const char* name, const char* role, const char* purpose,
                              int pin, ChannelRegistry::Driver driver, float pulsesPerUnit = 1.0f,
                              float analogMvPerUnit = 1000.0f, float analogDivider = 1.0f) {
        if (pin < 0) return;
        ChannelRegistry::Channel c;
        c.installed = true; c.direction = ChannelRegistry::Input;
        c.driver = driver; c.pin = pin;
        strlcpy(c.id, id, sizeof(c.id)); strlcpy(c.name, name, sizeof(c.name));
        strlcpy(c.role, role, sizeof(c.role)); strlcpy(c.purpose, purpose, sizeof(c.purpose));
        c.pulsesPerUnit = pulsesPerUnit > 0.0f ? pulsesPerUnit : 1.0f;
        c.analogMvPerUnit = analogMvPerUnit > 0.0f ? analogMvPerUnit : 1000.0f;
        c.analogDivider = analogDivider >= 1.0f ? analogDivider : 1.0f;
        if (!strcmp(purpose, "flame")) c.digitalThresholdRaw = 500;
        if (driver == ChannelRegistry::Analog) { c.minValue = 0.0f; c.maxValue = 4095.0f; }
        else if (driver == ChannelRegistry::Pulse) { c.minValue = 0.0f; c.maxValue = 100000.0f; }
        else if (driver == ChannelRegistry::RcPwm) { c.minValue = 1000.0f; c.maxValue = 2000.0f; }
        channelRegistry.add(c);
    };
    auto addDefaultOutput = [](const char* id, const char* name, const char* role,
                               const char* purpose, int pin, int legacyType,
                               uint32_t pwmHz = 5000, uint8_t pwmBits = 10) {
        if (pin < 0) return;
        ChannelRegistry::Channel c;
        c.installed = true; c.direction = ChannelRegistry::Output; c.pin = pin;
        c.driver = legacyType == 0 ? ChannelRegistry::Servo : legacyType == 1 ? ChannelRegistry::Pwm : ChannelRegistry::Relay;
        strlcpy(c.id, id, sizeof(c.id)); strlcpy(c.name, name, sizeof(c.name));
        strlcpy(c.role, role, sizeof(c.role)); strlcpy(c.purpose, purpose, sizeof(c.purpose));
        if (c.driver == ChannelRegistry::Servo) { c.minValue = 1000.0f; c.maxValue = 2000.0f; }
        else { c.minValue = 0.0f; c.maxValue = 1.0f; }
        if (c.driver == ChannelRegistry::Pwm) { c.pwmTimingConfigured = true; c.pwmFrequency = pwmHz; c.pwmResolution = pwmBits; }
        c.safeDemand = !strcmp(purpose, "prop_pitch") ? 1.0f : 0.0f;
        channelRegistry.add(c);
    };
    auto addDefaultTemperature = [](const char* id, const char* name, const char* purpose,
                                    const char* chip, const char* tcType,
                                    int pin, int clk, int cs, int miso, int mosi,
                                    int resolution, float beta, float r0, float rFixed) {
        ChannelRegistry::Channel c;
        c.installed = true; c.direction = ChannelRegistry::Input; c.driver = ChannelRegistry::Analog;
        c.minValue = 0.0f; c.maxValue = 4095.0f; c.pin = pin;
        strlcpy(c.id, id, sizeof(c.id)); strlcpy(c.name, name, sizeof(c.name));
        strlcpy(c.role, "temperature", sizeof(c.role)); strlcpy(c.purpose, purpose, sizeof(c.purpose));
        if (!strcmp(chip, "max6675")) c.temperatureInterface = 1;
        else if (!strcmp(chip, "max31855")) c.temperatureInterface = 2;
        else if (!strcmp(chip, "max31856")) c.temperatureInterface = 3;
        else if (!strcmp(chip, "ntc")) c.temperatureInterface = 4;
        else if (!strcmp(chip, "ds18b20")) c.temperatureInterface = 5;
        if (c.temperatureInterface >= 1 && c.temperatureInterface <= 3) {
            c.pin = -1; c.spiClk = clk; c.spiCs = cs; c.spiMiso = miso; c.spiMosi = mosi;
            strlcpy(c.tcType, tcType && tcType[0] ? tcType : "K", sizeof(c.tcType));
        }
        c.temperatureResolution = resolution;
        c.thermistorBeta = beta; c.thermistorR0 = r0; c.thermistorRFixed = rFixed;
        channelRegistry.add(c);
    };
    if (hasN1Rpm) addDefaultInput("n1_main", "N1 Speed", "speed", "n1_speed", n1RpmPin, ChannelRegistry::Pulse, n1RpmPpr);
    if (hasN2Rpm) addDefaultInput("n2_main", "N2 Speed", "speed", "n2_speed", n2RpmPin, ChannelRegistry::Pulse, n2RpmPpr);
    if (hasTot) addDefaultTemperature("tot_main", "Main TOT", "tot", totChip, totTcType, -1, totClk, totCs, totMiso, totMosi, 12, 3950, 10000, 10000);
    if (hasTit) addDefaultTemperature("tit_main", "Main TIT", "tit", titChip, titTcType, -1, titClk, titCs, titMiso, titMosi, 12, 3950, 10000, 10000);
    if (hasOilPress) addDefaultInput("oil_pressure_main", "Oil Pressure", "pressure", "oil_pressure", oilPressPin, ChannelRegistry::Analog);
    if (hasFlame) addDefaultInput("flame_main", "Flame", "flame", "flame", flamePin, ChannelRegistry::Analog);
    if (hasFuelFlow) addDefaultInput("fuel_flow", "Fuel Flow", "flow", "fuel_flow", fuelFlowPin,
        fuelFlowType == 1 ? ChannelRegistry::Pulse : ChannelRegistry::Analog, fuelFlowPulsesPerLitre, 330.0f);
    if (hasFuelPress) addDefaultInput("fuel_pressure", "Fuel Pressure", "pressure", "fuel_pressure", fuelPressPin, ChannelRegistry::Analog, 1.0f, 330.0f);
    if (hasP1) addDefaultInput("p1_main", "Pressure 1", "pressure", "p1_pressure", p1Pin, ChannelRegistry::Analog, 1.0f, 330.0f);
    if (hasP2) addDefaultInput("p2_main", "Pressure 2", "pressure", "p2_pressure", p2Pin, ChannelRegistry::Analog, 1.0f, 330.0f);
    if (hasOilTemp) addDefaultTemperature("oil_temperature", "Oil Temperature", "oil_temperature", oilTempChip, oilTempTcType,
        oilTempPin, oilTempPin, oilTempCs, oilTempMiso, oilTempMosi, oilTempResolution, ntcBeta, ntcR0, ntcRFixed);
    if (hasBattVoltage) addDefaultInput("battery_voltage", "Battery Voltage", "voltage", "battery_voltage", battVoltPin, ChannelRegistry::Analog, 1.0f, 1000.0f, battVoltDivider);
    if (hasTorque && !torqueHx711) addDefaultInput("torque_main", "Torque", "torque", "torque", torquePin, ChannelRegistry::Analog, 1.0f,
        torqueScale > 0.0f ? 1000.0f / torqueScale : 1000.0f);
    if (hasTorque && torqueHx711 && torqueDtPin >= 0 && torqueClkPin >= 0) {
        ChannelRegistry::Channel c;
        c.installed = true; c.direction = ChannelRegistry::Input; c.driver = ChannelRegistry::Analog;
        c.pin = torqueDtPin; c.minValue = 0.0f; c.maxValue = 4095.0f;
        c.torqueInterface = 1; c.hx711Clk = torqueClkPin;
        c.hx711Scale = torqueHxScale; c.hx711Zero = torqueHxZero;
        strlcpy(c.id, "torque_main", sizeof(c.id)); strlcpy(c.name, "Torque", sizeof(c.name));
        strlcpy(c.role, "torque", sizeof(c.role)); strlcpy(c.purpose, "torque", sizeof(c.purpose));
        channelRegistry.add(c);
    }
    if (hasThrottleInput) addDefaultInput("operator_throttle", "Throttle Input", "operator", "throttle", throttleInputPin,
        throttleInputRcPwm ? ChannelRegistry::RcPwm : ChannelRegistry::Analog);
    if (hasIdleInput) addDefaultInput("operator_idle", "Idle Input", "operator", "idle", idleInputPin,
        idleInputRcPwm ? ChannelRegistry::RcPwm : ChannelRegistry::Analog);
    if (hasThrottle) addDefaultOutput("main_fuel", "Main Fuel Metering", "fuel", "main_fuel", throttlePin, throttleType, throttleLedcFreqHz, throttleLedcBits);
    if (hasStarter) addDefaultOutput("starter", "Starter", "starter", "starter", starterPin, starterType, starterLedcFreqHz, starterLedcBits);
    if (hasOilPump) addDefaultOutput("oil_pump_main", "Oil Pump", "oil_pump", "oil_pump", oilPumpPin, oilPumpType, oilPumpFreqHz, oilPumpResBits);
    if (hasFuelSol) addDefaultOutput("fuel_shutoff", "Fuel Shutoff", "fuel_shutoff", "fuel_shutoff", fuelSolPin, 2);
    if (hasIgniter) addDefaultOutput("igniter", "Igniter", "igniter", "igniter", igniterPin, igniterPwm ? 1 : 2);
    if (hasIgniter2) addDefaultOutput("ab_igniter", "AB Igniter", "ab_igniter", "ab_igniter", igniter2Pin, igniter2Pwm ? 1 : 2);
    if (hasStarterEn) addDefaultOutput("starter_enable", "Starter Enable", "starter_en", "starter_enable", starterEnPin, 2);
    if (hasAbSol) addDefaultOutput("ab_solenoid", "Afterburner Fuel Valve", "valve", "ab_valve", abSolPin, 2);
    if (hasAirstarterSol) addDefaultOutput("air_starter", "Air Starter", "starter", "air_starter", airstarterSolPin, 2);
    if (hasCoolFan) addDefaultOutput("cooling_fan", "Cooling Fan", "cooling_fan", "cooling_fan", coolFanPin, coolFanType, coolFanFreqHz, coolFanResBits);
    if (hasAbPump) addDefaultOutput("ab_pump", "AB Fuel Pump", "ab_pump", "ab_pump", abPumpPin, abPumpType, abPumpFreqHz, abPumpResBits);
    if (hasOilScavengePump) addDefaultOutput("scavenge_pump", "Scavenge Pump", "scavenge_pump", "scavenge_pump", oilScavPumpPin, oilScavPumpType, oilScavPumpFreqHz, oilScavPumpResBits);
    if (hasFuelPump2) addDefaultOutput("fuel_pump", "Aux Fuel Pump", "fuel_pump", "fuel_pump", fuelPump2Pin, fuelPump2Type, fuelPump2FreqHz, fuelPump2ResBits);
    if (hasBleedValve) addDefaultOutput("bleed_valve", "Bleed Valve", "valve", "bleed_valve", bleedValvePin, bleedValveType, bleedValveFreqHz, bleedValveResBits);
    if (hasPropPitch) addDefaultOutput("prop_pitch", "Prop Pitch", "prop_pitch", "prop_pitch", propPitchPin, propPitchType, propPitchFreqHz, propPitchResBits);
    if (hasGlowPlug) addDefaultOutput("glow_plug", "Glow Plug", "glow_plug", "glow_plug", glowPlugPin, glowPlugOutputType == 1 ? 2 : 1, glowPlugFreqHz, glowPlugResBits);
    auto addDefaultBinding = [](const char* key, const char* channelId, ChannelRegistry::Direction direction) {
        if (channelRegistry.bindingCount >= ChannelRegistry::MAX_BINDINGS ||
            !channelRegistry.find(channelId, direction)) return;
        auto& b = channelRegistry.bindings[channelRegistry.bindingCount++];
        strlcpy(b.key, key, sizeof(b.key));
        strlcpy(b.channelId, channelId, sizeof(b.channelId));
    };
    addDefaultBinding("primary_n1", "n1_main", ChannelRegistry::Input);
    addDefaultBinding("primary_n2", "n2_main", ChannelRegistry::Input);
    addDefaultBinding("primary_egt", "tot_main", ChannelRegistry::Input);
    addDefaultBinding("operator_throttle", "operator_throttle", ChannelRegistry::Input);
    addDefaultBinding("operator_idle", "operator_idle", ChannelRegistry::Input);
    addDefaultBinding("main_fuel_output", "main_fuel", ChannelRegistry::Output);
    addDefaultBinding("main_fuel_shutoff", "fuel_shutoff", ChannelRegistry::Output);
    addDefaultBinding("main_starter", "starter", ChannelRegistry::Output);
    addDefaultBinding("starter_enable_output", "starter_enable", ChannelRegistry::Output);
    addDefaultBinding("primary_oil_pump", "oil_pump_main", ChannelRegistry::Output);
    addDefaultBinding("primary_scavenge_pump", "scavenge_pump", ChannelRegistry::Output);
    addDefaultBinding("primary_cooling_fan", "cooling_fan", ChannelRegistry::Output);
    addDefaultBinding("primary_bleed_valve", "bleed_valve", ChannelRegistry::Output);
    addDefaultBinding("primary_aux_fuel_pump", "fuel_pump", ChannelRegistry::Output);
    addDefaultBinding("primary_igniter", "igniter", ChannelRegistry::Output);
    addDefaultBinding("primary_secondary_igniter", "ab_igniter", ChannelRegistry::Output);
    addDefaultBinding("primary_ab_valve", "ab_solenoid", ChannelRegistry::Output);
    addDefaultBinding("primary_glow_plug", "glow_plug", ChannelRegistry::Output);
    addDefaultBinding("primary_ab_pump", "ab_pump", ChannelRegistry::Output);
    addDefaultBinding("primary_prop_pitch", "prop_pitch", ChannelRegistry::Output);
    addDefaultBinding("primary_air_starter", "air_starter", ChannelRegistry::Output);

    // A flashed PCB describes available ports, not which turbine equipment the
    // end user connected. First boot/factory reset therefore starts with an
    // empty assignment inventory rather than applying generic dev-board pins
    // to a soldered controller.
    if (PcbProfileManager::active()) {
        channelRegistry.clear();
        stopPin = startPin = -1;
        stopActiveH = startActiveH = false;
        stopPullup = stopPulldown = startPullup = startPulldown = false;
        hasN1Rpm = hasN2Rpm = hasTot = hasTit = hasOilPress = hasFlame = false;
        hasFuelFlow = hasFuelPress = hasP1 = hasP2 = false;
        hasThrottleInput = hasIdleInput = hasOilTemp = hasBattVoltage = false;
        hasTorque = hasThrust = false;
        hasThrottle = hasStarter = hasOilPump = hasFuelSol = false;
        hasIgniter = hasIgniter2 = hasStarterEn = hasAbSol = false;
        hasAirstarterSol = hasCoolFan = hasAbPump = false;
        hasOilScavengePump = hasFuelPump2 = hasBleedValve = false;
        hasPropPitch = hasGlowPlug = false;
        PcbProfileResolver::applyFixedBuses();
        PcbProfileResolver::applyFixedPeripherals();
        char fixedProfileReason[128] = {};
        if (!PcbProfileResolver::addProfileDefaults(channelRegistry, fixedProfileReason,
                                                    sizeof(fixedProfileReason)) ||
            !PcbProfileResolver::resolve(channelRegistry, fixedProfileReason,
                                         sizeof(fixedProfileReason))) {
            inhibitStartForHardwareConfigFailure(
                fixedProfileReason[0] ? fixedProfileReason :
                "Cannot install fixed PCB channels.");
        }
    }

    // Present fresh/factory sequences in the same unified form created by the
    // web editor.  The profile macros remain convenient compile-time shorthand,
    // but simple device commands become editable Set Output cards with an exact
    // stable output ID.  Specialized turbine operations (fuel-to-idle, waits,
    // checks, immediate cut, cooldown) intentionally remain dedicated blocks.
    auto modernizeDefaultActions = [](char names[MAX_SEQ_BLOCKS][24], int len,
                                      SeqSideAction enter[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS]) {
        for (int i = 0; i < len; ++i) {
            const char* purpose = nullptr;
            float demand = 0.0f;
            if (!strcmp(names[i], "OilPumpOn"))             { purpose = "oil_pump"; demand = 1.0f; }
            else if (!strcmp(names[i], "OilPumpOff"))       { purpose = "oil_pump"; }
            else if (!strcmp(names[i], "IgniterOn"))        { purpose = "igniter"; demand = 1.0f; }
            else if (!strcmp(names[i], "IgniterOff"))       { purpose = "igniter"; }
            else if (!strcmp(names[i], "ABIgnOn"))          { purpose = "ab_igniter"; demand = 1.0f; }
            else if (!strcmp(names[i], "ABIgnOff"))         { purpose = "ab_igniter"; }
            else if (!strcmp(names[i], "FuelOpen"))         { purpose = "fuel_shutoff"; demand = 1.0f; }
            else if (!strcmp(names[i], "FuelSolClose"))     { purpose = "fuel_shutoff"; }
            else if (!strcmp(names[i], "StarterEnOn"))      { purpose = "starter_enable"; demand = 1.0f; }
            else if (!strcmp(names[i], "StarterEnOff"))     { purpose = "starter_enable"; }
            else if (!strcmp(names[i], "StarterOff"))       { purpose = "starter"; }
            else if (!strcmp(names[i], "CoolFanOn"))        { purpose = "cooling_fan"; demand = 1.0f; }
            else if (!strcmp(names[i], "CoolFanOff"))       { purpose = "cooling_fan"; }
            else if (!strcmp(names[i], "AirstarterOn"))     { purpose = "air_starter"; demand = 1.0f; }
            else if (!strcmp(names[i], "AirstarterOff"))    { purpose = "air_starter"; }
            else if (!strcmp(names[i], "ABPumpOn"))         { purpose = "ab_pump"; demand = 0.8f; }
            else if (!strcmp(names[i], "ABPumpOff"))        { purpose = "ab_pump"; }
            else if (!strcmp(names[i], "OilScavengeOn"))    { purpose = "scavenge_pump"; demand = 1.0f; }
            else if (!strcmp(names[i], "OilScavengeOff"))   { purpose = "scavenge_pump"; }
            else if (!strcmp(names[i], "DrainValveOpen"))   { purpose = "drain_valve"; demand = 1.0f; }
            else if (!strcmp(names[i], "DrainValveClose"))  { purpose = "drain_valve"; }
            else if (!strcmp(names[i], "BleedOpen"))        { purpose = "bleed_valve"; demand = 1.0f; }
            else if (!strcmp(names[i], "BleedClose"))       { purpose = "bleed_valve"; }
            else if (!strcmp(names[i], "FuelPump2On"))      { purpose = "fuel_pump"; demand = 1.0f; }
            else if (!strcmp(names[i], "FuelPump2Off"))     { purpose = "fuel_pump"; }
            else if (!strcmp(names[i], "ABSolOpen"))        { purpose = "ab_valve"; demand = 1.0f; }
            else if (!strcmp(names[i], "ABSolClose"))       { purpose = "ab_valve"; }
            if (!purpose) continue;

            const char* outputId = defaultOutputIdForPurpose(purpose);
            const int8_t actuator = outputActuatorForId(outputId);
            if (!outputId[0] || actuator < 0) continue;
            strlcpy(names[i], "SetOutput", sizeof(names[i]));
            enter[i][0].enabled = true;
            enter[i][0].actuator = (uint8_t)actuator;
            strlcpy(enter[i][0].targetId, outputId, sizeof(enter[i][0].targetId));
            enter[i][0].value = demand;
        }
    };
    modernizeDefaultActions(startupSeq, startupSeqLen, startupEnterActions);
    modernizeDefaultActions(shutdownSeq, shutdownSeqLen, shutdownEnterActions);
    modernizeDefaultActions(abSeq, abSeqLen, abEnterActions);
    modernizeDefaultActions(abShutSeq, abShutSeqLen, abShutEnterActions);
}

// ── toJson ────────────────────────────────────────────────────
static constexpr const char* WIFI_PASSWORD_RETAINED = "__KEEP_PASSWORD__";

size_t HardwareConfig::toJson(char* buf, size_t len, bool redactPassword) {
    JsonDocument doc;
    toJson(doc, redactPassword);
    const size_t required = measureJson(doc);
    if (!buf || len == 0 || required >= len) {
        if (buf && len) buf[0] = '\0';
        return len;  // explicit overflow sentinel for bounded-buffer callers
    }
    return serializeJson(doc, buf, len);
}

void HardwareConfig::toJson(JsonDocument& doc, bool redactPassword) {
    doc.clear();
    toJson(doc.to<JsonObject>(), redactPassword);
}

void HardwareConfig::toJson(JsonObject doc, bool redactPassword) {
    _toDoc(doc);
    if (redactPassword)
        doc["wifi_password"] = wifiPassword[0] ? WIFI_PASSWORD_RETAINED : "";
}

// ── fromJson ──────────────────────────────────────────────────
bool HardwareConfig::validateJson(const char* json, size_t len) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json, len);
    if (err) {
        setHardwareValidationError("malformed JSON data");
        return false;
    }
    return validateJson(doc);
}

bool HardwareConfig::validateJson(const JsonDocument& doc, ChannelRegistry* registryWorkspace) {
    setHardwareValidationError("unknown hardware validation error");
    auto reject = [](const char* reason) {
        setHardwareValidationError(reason);
        Serial.printf("[HardwareConfig] validation rejected: %s\n", g_lastHardwareValidationError);
        return false;
    };
    if (!requiredStringFits(doc["profile_id"], sizeof(HardwareConfig::profileId))) return reject("profile_id");
    if (!optionalStringFits(doc["profile_desc"], sizeof(HardwareConfig::profileDesc))) return reject("profile_desc");
    if (!optionalStringFits(doc["wifi_password"], sizeof(HardwareConfig::wifiPassword))) return reject("wifi_password");
    const char* password = doc["wifi_password"] | "";
    if (strcmp(password, WIFI_PASSWORD_RETAINED) != 0 && password[0]) {
        size_t pwLen = strlen(password);
        if (pwLen < 8 || pwLen >= sizeof(HardwareConfig::wifiPassword)) return reject("wifi_password length");
    }
    if (!validateDisplayLabels(doc["labels"])) return reject("display labels");
    if (!validateCustomBlockStrings(doc["custom_blocks"])) return reject("custom block strings");
    if (PcbProfileManager::active()) {
        const auto* catalog = PcbProfileManager::catalog();
        JsonObjectConst identity = doc["_pcb_profile"].as<JsonObjectConst>();
        if (!catalog || identity.isNull() ||
            strcmp(identity["id"] | "", catalog->boardId) ||
            strcmp(identity["revision"] | "", catalog->revision))
            return reject("hardware file belongs to a different PCB profile");
    } else if (!doc["_pcb_profile"]["id"].isNull() &&
               (doc["_pcb_profile"]["id"] | "")[0]) {
        return reject("hardware file requires a PCB profile but this board is in development-board mode");
    }
    if (doc["channel_registry"].isNull()) return reject("missing channel registry");
    const ChannelRegistry* registryForValidation = nullptr;
    // Keep the expanded registry off the AsyncWebServer task stack without
    // permanently reserving a second registry in DRAM.
    std::unique_ptr<ChannelRegistry> ownedRegistry;
    if (!doc["channel_registry"].isNull()) {
        if ((doc["channel_registry"]["version"] | 0) > CHANNEL_REGISTRY_VERSION) return reject("channel registry version");
        ChannelRegistry* registry = registryWorkspace;
        if (!registry) {
            ownedRegistry.reset(new (std::nothrow) ChannelRegistry());
            registry = ownedRegistry.get();
        }
        if (!registry || !registry->fromJson(doc["channel_registry"].as<JsonObjectConst>())) {
            const char* registryError = ChannelRegistry::validationError();
            return reject(registryError && registryError[0]
                ? registryError : "channel registry contents");
        }
        char profileReason[128] = {};
        if (!PcbProfileResolver::resolve(*registry, profileReason, sizeof(profileReason))) {
            return reject(profileReason[0] ? profileReason : "PCB profile assignment");
        }
        registryForValidation = registry;
    }
    if (!validateOilLoops(doc["oil_loops"], registryForValidation)) return reject("oil loops");
    if (!validateHardwareDependencies(doc, registryForValidation)) return reject("hardware dependencies");
    if (!validateSequenceReferenceIds(doc.as<JsonVariantConst>(), registryForValidation)) return reject("sequence references");
    auto wrongContext = [](JsonArrayConst seq, const char* context) -> const char* {
        for (JsonVariantConst item : seq) {
            const char* name = item.is<const char*>() ? item.as<const char*>() : (item["name"] | "");
            const bool abSpecific = !strncmp(name, "AB", 2);
            const bool shutdownTerminal = !strcmp(name, "RPMDrop") || !strcmp(name, "CooldownSpin") ||
                                          !strcmp(name, "FinalStop") || !strcmp(name, "ImmediateCut");
            if (!strcmp(context, "startup") && (abSpecific || shutdownTerminal)) return name;
            if (!strcmp(context, "shutdown") && (abSpecific || !strcmp(name, "StarterSpin"))) return name;
            if ((!strcmp(context, "ab_ignition") || !strcmp(context, "ab_shutdown")) &&
                (!strcmp(name, "StarterSpin") || shutdownTerminal)) return name;
        }
        return nullptr;
    };
    for (const auto& check : {
             std::pair<const char*, const char*>("startup_seq", "startup"),
             std::pair<const char*, const char*>("shutdown_seq", "shutdown"),
             std::pair<const char*, const char*>("ab_seq", "ab_ignition"),
             std::pair<const char*, const char*>("ab_shut_seq", "ab_shutdown")}) {
        if (const char* block = wrongContext(doc[check.first].as<JsonArrayConst>(), check.second)) {
            static char contextError[96];
            snprintf(contextError, sizeof(contextError), "%s block %s is not valid in %s",
                     check.first, block, check.second);
            return reject(contextError);
        }
    }
    auto sensors = doc["sensors"];
    auto n1 = sensors["n1_rpm"];
    if (n1["enabled"].as<bool>()) {
        if (n1["ppr"].isNull() || n1["ppr"].as<float>() <= 0.0f) return reject("N1 pulses per revolution");
    }
    auto n2 = sensors["n2_rpm"];
    if (n2["enabled"].as<bool>()) {
        if (n2["ppr"].isNull() || n2["ppr"].as<float>() <= 0.0f) return reject("N2 pulses per revolution");
    }
    if (!validatePlatformPins(doc, registryForValidation))
        return reject(strcmp(g_lastHardwareValidationError, "unknown hardware validation error") != 0
            ? g_lastHardwareValidationError : "platform pins or electrical ranges");
    return true;
}

const char* HardwareConfig::lastValidationError() {
    return g_lastHardwareValidationError;
}

bool HardwareConfig::fromJson(char* json, size_t len,
                              ChannelRegistry* validationWorkspace) {
    JsonDocument doc;
    // Mutable input selects ArduinoJson's zero-copy parser. Hardware POST
    // already owns this buffer until the transaction finishes, and _fromDoc()
    // copies all retained strings, so there is no lifetime dependency.
    const DeserializationError parseError = deserializeJson(doc, json, len);
    if (parseError) {
        setHardwareValidationError(
            parseError == DeserializationError::NoMemory
                ? "insufficient memory to parse hardware configuration"
                : "malformed JSON data");
        return false;
    }
    // Validate the already-parsed document once; the web path filters its I2C
    // comparison parses to the registry only, leaving room for this complete
    // validation workspace on Classic ESP32.
    if (!validateJson(doc, validationWorkspace)) return false;
    _fromDoc(doc);
    return true;
}

// ── _fromDoc ─────────────────────────────────────────────────
void HardwareConfig::_fromDoc(const JsonDocument& doc) {
    channelRegistry.fromJson(doc["channel_registry"].as<JsonObjectConst>());
    // Versions through 2.1 represented the built-in bleed valve as a generic
    // valve and recovered its meaning from the ID in several separate paths.
    // Converge that one historical representation at load so ownership,
    // native/I2C dispatch and controller discovery use the same purpose.
    for (uint8_t i = 0; i < channelRegistry.outputCount; ++i) {
        auto& output = channelRegistry.outputs[i];
        if ((!strcmp(output.id, "bleed_valve") || !strcmp(output.id, "bleed_valve_main")) &&
            !strcmp(output.purpose, "valve"))
            strlcpy(output.purpose, "bleed_valve", sizeof(output.purpose));
    }
    const char* id   = doc["profile_id"]    | profileId;
    const char* desc = doc["profile_desc"]  | profileDesc;
    const char* pwd  = doc["wifi_password"] | (const char*)wifiPassword;
    if (strcmp(pwd, WIFI_PASSWORD_RETAINED) == 0) pwd = wifiPassword;
    strncpy(profileId,    id,   sizeof(profileId)    - 1);
    profileId[sizeof(profileId) - 1] = '\0';
    strncpy(profileDesc,  desc, sizeof(profileDesc)  - 1);
    profileDesc[sizeof(profileDesc) - 1] = '\0';
    strncpy(wifiPassword, pwd,  sizeof(wifiPassword) - 1);
    wifiPassword[sizeof(wifiPassword) - 1] = '\0';
    wifiTxPowerDbm = constrain(doc["wifi_tx_power_dbm"] | wifiTxPowerDbm, 2, 20);
    auto i2c = doc["i2c"];
    if (!i2c["enabled"].isNull()) i2cEnabled = i2c["enabled"].as<bool>();
    i2cSdaPin = i2c["sda_pin"] | i2cSdaPin;
    i2cSclPin = i2c["scl_pin"] | i2cSclPin;
    i2cInterruptPin = i2c["interrupt_pin"] | i2cInterruptPin;
    i2cFrequencyHz = constrain(i2c["frequency_hz"] | i2cFrequencyHz, 10000U, 400000U);
    auto spi = doc["spi"];
    if (!spi["enabled"].isNull()) spiEnabled = spi["enabled"].as<bool>();
    spiSckPin = spi["sck_pin"] | spiSckPin;
    spiMisoPin = spi["miso_pin"] | spiMisoPin;
    spiMosiPin = spi["mosi_pin"] | spiMosiPin;
    if (!PcbProfileManager::active() && spiEnabled) {
        for (uint8_t i = 0; i < channelRegistry.inputCount; ++i) {
            auto& channel = channelRegistry.inputs[i];
            if (strcmp(channel.role, "temperature") ||
                channel.temperatureInterface < 1 || channel.temperatureInterface > 3) continue;
            channel.spiClk = spiSckPin;
            channel.spiMiso = spiMisoPin;
            channel.spiMosi = channel.temperatureInterface == 3 ? spiMosiPin : -1;
        }
    }
    char profileReason[128] = {};
    if (!PcbProfileResolver::resolve(channelRegistry, profileReason, sizeof(profileReason))) {
        inhibitStartForHardwareConfigFailure(
            profileReason[0] ? profileReason : "Cannot resolve PCB profile assignments.");
    }
    PcbProfileResolver::applyFixedBuses();
    if (wifiPassword[0] && strlen(wifiPassword) < 8) {
        Serial.println("[HWCfg] Invalid WiFi password length; using open access point");
        wifiPassword[0] = '\0';
    }
    hasAfterburner = false;

    auto ctrl = doc["controls"];
    stopPin  = ctrl["stop_pin"]  | stopPin;
    if (!ctrl["stop_active_h"].isNull())  stopActiveH  = ctrl["stop_active_h"].as<bool>();
    if (!ctrl["stop_pullup"].isNull())    stopPullup   = ctrl["stop_pullup"].as<bool>();
    if (!ctrl["stop_pulldown"].isNull())  stopPulldown = ctrl["stop_pulldown"].as<bool>();
    if (stopPullup) stopPulldown = false;
    startPin = ctrl["start_pin"] | startPin;
    if (!ctrl["start_active_h"].isNull()) startActiveH = ctrl["start_active_h"].as<bool>();
    if (!ctrl["start_pullup"].isNull())   startPullup  = ctrl["start_pullup"].as<bool>();
    if (!ctrl["start_pulldown"].isNull()) startPulldown = ctrl["start_pulldown"].as<bool>();
    if (startPullup) startPulldown = false;

    auto s = doc["sensors"];

    auto n1 = s["n1_rpm"];
    if (!n1["enabled"].isNull()) hasN1Rpm = n1["enabled"].as<bool>();
    n1RpmPin = n1["pin"] | n1RpmPin;
    n1RpmPpr = n1["ppr"] | n1RpmPpr;

    auto n2 = s["n2_rpm"];
    if (!n2["enabled"].isNull()) hasN2Rpm = n2["enabled"].as<bool>();
    n2RpmPin = n2["pin"] | n2RpmPin;
    n2RpmPpr = n2["ppr"] | n2RpmPpr;

    auto tot = s["tot"];
    if (!tot["enabled"].isNull()) hasTot = tot["enabled"].as<bool>();
    { const char* v = tot["chip"]    | totChip;   strncpy(totChip,   v, sizeof(totChip)   - 1); totChip[sizeof(totChip) - 1] = '\0'; }
    { const char* v = tot["tc_type"] | totTcType; strncpy(totTcType, v, sizeof(totTcType) - 1); totTcType[sizeof(totTcType) - 1] = '\0'; }
    totClk  = tot["clk"]  | totClk;
    totCs   = tot["cs"]   | totCs;
    totMiso = tot["miso"] | totMiso;
    totMosi = tot["mosi"] | totMosi;

    auto tit = s["tit"];
    if (!tit["enabled"].isNull()) hasTit = tit["enabled"].as<bool>();
    { const char* v = tit["chip"]    | titChip;   strncpy(titChip,   v, sizeof(titChip)   - 1); titChip[sizeof(titChip) - 1] = '\0'; }
    { const char* v = tit["tc_type"] | titTcType; strncpy(titTcType, v, sizeof(titTcType) - 1); titTcType[sizeof(titTcType) - 1] = '\0'; }
    titClk  = tit["clk"]  | titClk;
    titCs   = tit["cs"]   | titCs;
    titMiso = tit["miso"] | titMiso;
    titMosi = tit["mosi"] | titMosi;

    auto oilp = s["oil_press"];
    if (!oilp["enabled"].isNull()) hasOilPress = oilp["enabled"].as<bool>();
    oilPressPin = oilp["pin"] | oilPressPin;

    auto fl = s["flame"];
    if (!fl["enabled"].isNull()) hasFlame = fl["enabled"].as<bool>();
    flamePin = fl["pin"] | flamePin;

    auto ff = s["fuel_flow"];
    if (!ff["enabled"].isNull()) hasFuelFlow = ff["enabled"].as<bool>();
    fuelFlowPin              = ff["pin"]              | fuelFlowPin;
    fuelFlowType             = ff["type"]             | fuelFlowType;
    fuelFlowPulsesPerLitre   = ff["pulses_per_litre"] | fuelFlowPulsesPerLitre;

    auto fpress = s["fuel_press"];
    if (!fpress["enabled"].isNull()) hasFuelPress = fpress["enabled"].as<bool>();
    fuelPressPin = fpress["pin"] | fuelPressPin;

    auto p1 = s["p1"];
    if (!p1["enabled"].isNull()) hasP1 = p1["enabled"].as<bool>();
    p1Pin = p1["pin"] | p1Pin;

    auto p2 = s["p2"];
    if (!p2["enabled"].isNull()) hasP2 = p2["enabled"].as<bool>();
    p2Pin = p2["pin"] | p2Pin;

    auto thi = s["throttle_input"];
    if (!thi["enabled"].isNull()) hasThrottleInput = thi["enabled"].as<bool>();
    throttleInputPin   = thi["pin"]    | throttleInputPin;
    if (!thi["rc_pwm"].isNull()) throttleInputRcPwm = thi["rc_pwm"].as<bool>();

    auto idi = s["idle_input"];
    if (!idi["enabled"].isNull()) hasIdleInput = idi["enabled"].as<bool>();
    idleInputPin       = idi["pin"]    | idleInputPin;
    if (!idi["rc_pwm"].isNull()) idleInputRcPwm = idi["rc_pwm"].as<bool>();

    auto oilt = s["oil_temp"];
    if (!oilt["enabled"].isNull()) hasOilTemp = oilt["enabled"].as<bool>();
    { const char* v = oilt["chip"] | oilTempChip; strncpy(oilTempChip, v, sizeof(oilTempChip) - 1); oilTempChip[sizeof(oilTempChip) - 1] = '\0'; }
    if (strcmp(oilTempChip, "ntc") == 0 || strcmp(oilTempChip, "ds18b20") == 0)
        oilTempPin = oilt["pin"] | oilTempPin;
    else
        oilTempPin = oilt["clk"] | oilTempPin;
    oilTempCs   = oilt["cs"]   | oilTempCs;
    oilTempMiso = oilt["miso"] | oilTempMiso;
    oilTempMosi = oilt["mosi"] | oilTempMosi;
    { const char* v = oilt["tc_type"] | oilTempTcType; strncpy(oilTempTcType, v, sizeof(oilTempTcType) - 1); oilTempTcType[sizeof(oilTempTcType) - 1] = '\0'; }
    oilTempResolution = oilt["resolution"] | oilTempResolution;
    ntcBeta   = oilt["ntc_beta"]    | ntcBeta;
    ntcR0     = oilt["ntc_r0"]      | ntcR0;
    ntcRFixed = oilt["ntc_r_fixed"] | ntcRFixed;
    ntcFixedPullup = oilt["ntc_pullup"] | ntcFixedPullup;
    oilTempUseRawPoly = oilt["use_raw_poly"] | oilTempUseRawPoly;
    oilTempPolyA = oilt["poly_a"] | oilTempPolyA;
    oilTempPolyB = oilt["poly_b"] | oilTempPolyB;
    oilTempPolyC = oilt["poly_c"] | oilTempPolyC;
    oilTempPolyD = oilt["poly_d"] | oilTempPolyD;
    oilTempPolyXMin = oilt["poly_x_min"] | oilTempPolyXMin;
    oilTempPolyXMax = oilt["poly_x_max"] | oilTempPolyXMax;

    auto bvs = s["batt_voltage"];
    if (!bvs["enabled"].isNull()) hasBattVoltage = bvs["enabled"].as<bool>();
    battVoltPin     = bvs["pin"]     | battVoltPin;
    battVoltDivider = bvs["divider"] | battVoltDivider;

    auto torqs = s["torque"];
    if (!torqs["enabled"].isNull()) hasTorque = torqs["enabled"].as<bool>();
    torquePin    = torqs["pin"]    | torquePin;
    torqueScale  = torqs["scale"]  | torqueScale;
    torqueOffset = torqs["offset"] | torqueOffset;
    if (!torqs["hx711"].isNull()) torqueHx711 = torqs["hx711"].as<bool>();
    torqueDtPin   = torqs["dt_pin"]  | torqueDtPin;
    torqueClkPin  = torqs["clk_pin"] | torqueClkPin;
    torqueHxScale = torqs["hx_scale"] | torqueHxScale;
    torqueHxZero  = torqs["hx_zero"] | torqueHxZero;

    auto a = doc["actuators"];

    auto thr = a["throttle"];
    if (!thr["enabled"].isNull())  hasThrottle      = thr["enabled"].as<bool>();
    throttlePin        = thr["pin"]       | throttlePin;
    throttleType       = thr["type"]      | throttleType;
    throttleMinUs      = thr["min_us"]    | throttleMinUs;
    throttleMaxUs      = thr["max_us"]    | throttleMaxUs;
    if (!thr["inverted"].isNull()) throttleInverted  = thr["inverted"].as<bool>();
    if (!thr["active_h"].isNull())  throttleActiveH   = thr["active_h"].as<bool>();
    throttleLedcFreqHz = thr["ledc_freq"] | throttleLedcFreqHz;
    throttleLedcBits   = thr["ledc_bits"] | throttleLedcBits;
    throttlePwmMinPct  = thr["pwm_min_pct"] | throttlePwmMinPct;
    throttlePwmMaxPct  = thr["pwm_max_pct"] | throttlePwmMaxPct;

    auto str = a["starter"];
    if (!str["enabled"].isNull())  hasStarter        = str["enabled"].as<bool>();
    starterPin         = str["pin"]       | starterPin;
    starterType        = str["type"]      | starterType;
    if (!str["inverted"].isNull()) starterInverted    = str["inverted"].as<bool>();
    if (!str["active_h"].isNull())  starterActiveH     = str["active_h"].as<bool>();
    starterLedcFreqHz  = str["ledc_freq"] | starterLedcFreqHz;
    starterLedcBits    = str["ledc_bits"] | starterLedcBits;
    starterPwmMinPct   = str["pwm_min_pct"] | starterPwmMinPct;
    starterPwmMaxPct   = str["pwm_max_pct"] | starterPwmMaxPct;
    starterMinUs = str["min_us"] | starterMinUs;
    starterMaxUs = str["max_us"] | starterMaxUs;

    auto op = a["oil_pump"];
    if (!op["enabled"].isNull())  hasOilPump  = op["enabled"].as<bool>();
    oilPumpPin     = op["pin"]      | oilPumpPin;
    oilPumpType    = op["type"]     | oilPumpType;
    if (!op["active_h"].isNull()) oilPumpActiveH = op["active_h"].as<bool>();
    oilPumpMinUs   = op["min_us"]   | oilPumpMinUs;
    oilPumpMaxUs   = op["max_us"]   | oilPumpMaxUs;
    oilPumpFreqHz  = op["freq_hz"]  | oilPumpFreqHz;
    oilPumpResBits = op["res_bits"] | oilPumpResBits;
    oilPumpPwmMinPct = op["pwm_min_pct"] | oilPumpPwmMinPct;
    oilPumpPwmMaxPct = op["pwm_max_pct"] | oilPumpPwmMaxPct;
    if (!op["has_current"].isNull()) hasOilPumpCurrentSensor = hasOilPump && op["has_current"].as<bool>();
    oilPumpCurrentPin     = op["current_pin"]    | oilPumpCurrentPin;
    oilPumpCurrentMvPerA  = op["current_mv_a"]   | oilPumpCurrentMvPerA;
    oilPumpCurrentZeroV   = op["current_zero_v"] | oilPumpCurrentZeroV;
    oilPumpCurrentMaxAmps = op["current_max_a"]  | oilPumpCurrentMaxAmps;

    auto fsol = a["fuel_sol"];
    if (!fsol["enabled"].isNull()) hasFuelSol   = fsol["enabled"].as<bool>();
    fuelSolPin   = fsol["pin"]      | fuelSolPin;
    if (!fsol["active_h"].isNull()) fuelSolActiveH = fsol["active_h"].as<bool>();

    auto ign = a["igniter"];
    if (!ign["enabled"].isNull()) hasIgniter   = ign["enabled"].as<bool>();
    igniterPin   = ign["pin"]      | igniterPin;
    if (!ign["active_h"].isNull()) igniterActiveH = ign["active_h"].as<bool>();
    if (!ign["pwm"].isNull())      igniterPwm     = ign["pwm"].as<bool>();
    igniterDwellMs = ign["dwell_ms"] | igniterDwellMs;
    igniterRestMs  = ign["rest_ms"]  | igniterRestMs;
    if (!ign["coil"].isNull())       igniterCoil           = ign["coil"].as<bool>();
    igniterCoilSatAmps    = ign["coil_sat_a"]     | igniterCoilSatAmps;
    if (!igniterPwm) igniterCoil = false;
    igniterCurrentPin     = ign["current_pin"]    | igniterCurrentPin;
    igniterCurrentMvPerA  = ign["current_mv_a"]   | igniterCurrentMvPerA;
    igniterCurrentZeroV   = ign["current_zero_v"] | igniterCurrentZeroV;
    if (!ign["has_current"].isNull()) hasIgniterCurrentSensor = hasIgniter && ign["has_current"].as<bool>();

    auto ign2 = a["igniter2"];
    if (!ign2["enabled"].isNull()) hasIgniter2    = ign2["enabled"].as<bool>();
    igniter2Pin    = ign2["pin"]      | igniter2Pin;
    if (!ign2["active_h"].isNull()) igniter2ActiveH = ign2["active_h"].as<bool>();
    if (!ign2["pwm"].isNull())      igniter2Pwm     = ign2["pwm"].as<bool>();
    igniter2DwellMs = ign2["dwell_ms"] | igniter2DwellMs;
    igniter2RestMs  = ign2["rest_ms"]  | igniter2RestMs;
    if (!ign2["coil"].isNull())       igniter2Coil           = ign2["coil"].as<bool>();
    igniter2CoilSatAmps    = ign2["coil_sat_a"]     | igniter2CoilSatAmps;
    if (!igniter2Pwm) igniter2Coil = false;
    igniter2CurrentPin     = ign2["current_pin"]    | igniter2CurrentPin;
    igniter2CurrentMvPerA  = ign2["current_mv_a"]   | igniter2CurrentMvPerA;
    igniter2CurrentZeroV   = ign2["current_zero_v"] | igniter2CurrentZeroV;
    if (!ign2["has_current"].isNull()) hasIgniter2CurrentSensor = hasIgniter2 && ign2["has_current"].as<bool>();

    auto sen = a["starter_en"];
    if (!sen["enabled"].isNull()) hasStarterEn   = sen["enabled"].as<bool>();
    starterEnPin       = sen["pin"]       | starterEnPin;
    if (!sen["active_h"].isNull()) starterEnActiveH = sen["active_h"].as<bool>();
    starterEnDelayMs   = sen["delay_ms"]  | starterEnDelayMs;

    auto abs2 = a["ab_sol"];
    if (!abs2["enabled"].isNull()) hasAbSol   = abs2["enabled"].as<bool>();
    abSolPin   = abs2["pin"]      | abSolPin;
    if (!abs2["active_h"].isNull()) abSolActiveH = abs2["active_h"].as<bool>();

    auto airs = a["airstarter_sol"];
    if (!airs["enabled"].isNull()) hasAirstarterSol = airs["enabled"].as<bool>();
    airstarterSolPin = airs["pin"] | airstarterSolPin;
    if (!airs["active_h"].isNull()) airstarterSolActiveH = airs["active_h"].as<bool>();

    auto fan = a["cool_fan"];
    if (!fan["enabled"].isNull()) hasCoolFan = fan["enabled"].as<bool>();
    coolFanPin    = fan["pin"]      | coolFanPin;
    coolFanType   = fan["type"]     | coolFanType;
    if (!fan["active_h"].isNull()) coolFanActiveH = fan["active_h"].as<bool>();
    coolFanMinUs  = fan["min_us"]   | coolFanMinUs;
    coolFanMaxUs  = fan["max_us"]   | coolFanMaxUs;
    coolFanFreqHz = fan["freq_hz"]  | coolFanFreqHz;
    coolFanResBits= fan["res_bits"] | coolFanResBits;
    coolFanPwmMinPct = fan["pwm_min_pct"] | coolFanPwmMinPct;
    coolFanPwmMaxPct = fan["pwm_max_pct"] | coolFanPwmMaxPct;

    auto abp = a["ab_pump"];
    if (!abp["enabled"].isNull()) hasAbPump = abp["enabled"].as<bool>();
    abPumpPin    = abp["pin"]      | abPumpPin;
    abPumpType   = abp["type"]     | abPumpType;
    if (!abp["active_h"].isNull()) abPumpActiveH = abp["active_h"].as<bool>();
    abPumpMinUs  = abp["min_us"]   | abPumpMinUs;
    abPumpMaxUs  = abp["max_us"]   | abPumpMaxUs;
    abPumpFreqHz = abp["freq_hz"]  | abPumpFreqHz;
    abPumpResBits= abp["res_bits"] | abPumpResBits;
    abPumpPwmMinPct = abp["pwm_min_pct"] | abPumpPwmMinPct;
    abPumpPwmMaxPct = abp["pwm_max_pct"] | abPumpPwmMaxPct;

    auto scav = a["oil_scavenge_pump"];
    if (!scav["enabled"].isNull()) hasOilScavengePump = scav["enabled"].as<bool>();
    oilScavPumpPin     = scav["pin"]      | oilScavPumpPin;
    oilScavPumpType    = scav["type"]     | oilScavPumpType;
    oilScavPumpMinUs   = scav["min_us"]   | oilScavPumpMinUs;
    oilScavPumpMaxUs   = scav["max_us"]   | oilScavPumpMaxUs;
    if (!scav["active_h"].isNull()) oilScavPumpActiveH = scav["active_h"].as<bool>();
    oilScavPumpFreqHz  = scav["freq_hz"]  | oilScavPumpFreqHz;
    oilScavPumpResBits = scav["res_bits"] | oilScavPumpResBits;
    oilScavPumpPwmMinPct = scav["pwm_min_pct"] | oilScavPumpPwmMinPct;
    oilScavPumpPwmMaxPct = scav["pwm_max_pct"] | oilScavPumpPwmMaxPct;

    auto fp2 = a["fuel_pump2"];
    if (!fp2["enabled"].isNull()) hasFuelPump2 = fp2["enabled"].as<bool>();
    fuelPump2Pin     = fp2["pin"]      | fuelPump2Pin;
    fuelPump2Type    = fp2["type"]     | fuelPump2Type;
    if (!fp2["active_h"].isNull()) fuelPump2ActiveH = fp2["active_h"].as<bool>();
    fuelPump2MinUs   = fp2["min_us"]   | fuelPump2MinUs;
    fuelPump2MaxUs   = fp2["max_us"]   | fuelPump2MaxUs;
    fuelPump2FreqHz  = fp2["freq_hz"]  | fuelPump2FreqHz;
    fuelPump2ResBits = fp2["res_bits"] | fuelPump2ResBits;
    fuelPump2PwmMinPct = fp2["pwm_min_pct"] | fuelPump2PwmMinPct;
    fuelPump2PwmMaxPct = fp2["pwm_max_pct"] | fuelPump2PwmMaxPct;

    auto blv = a["bleed_valve"];
    if (!blv["enabled"].isNull()) hasBleedValve  = blv["enabled"].as<bool>();
    bleedValveType   = blv["type"]     | bleedValveType;
    bleedValvePin    = blv["pin"]      | bleedValvePin;
    if (!blv["active_h"].isNull()) bleedValveActiveH = blv["active_h"].as<bool>();
    bleedValveMinUs  = blv["min_us"]   | bleedValveMinUs;
    bleedValveMaxUs  = blv["max_us"]   | bleedValveMaxUs;
    bleedValveFreqHz = blv["freq_hz"]  | bleedValveFreqHz;
    bleedValveResBits= blv["res_bits"] | bleedValveResBits;
    bleedValvePwmMinPct = blv["pwm_min_pct"] | bleedValvePwmMinPct;
    bleedValvePwmMaxPct = blv["pwm_max_pct"] | bleedValvePwmMaxPct;

    auto pps = a["prop_pitch"];
    if (!pps["enabled"].isNull()) hasPropPitch = pps["enabled"].as<bool>();
    propPitchType   = pps["type"]     | propPitchType;
    propPitchPin    = pps["pin"]      | propPitchPin;
    propPitchMinUs  = pps["min_us"]   | propPitchMinUs;
    propPitchMaxUs  = pps["max_us"]   | propPitchMaxUs;
    propPitchFreqHz = pps["freq_hz"]  | propPitchFreqHz;
    propPitchResBits= pps["res_bits"] | propPitchResBits;
    propPitchPwmMinPct = pps["pwm_min_pct"] | propPitchPwmMinPct;
    propPitchPwmMaxPct = pps["pwm_max_pct"] | propPitchPwmMaxPct;
    if (!pps["active_h"].isNull()) propPitchActiveH = pps["active_h"].as<bool>();

    auto glw = a["glow_plug"];
    if (!glw["enabled"].isNull()) hasGlowPlug  = glw["enabled"].as<bool>();
    glowPlugType    = glw["type"]     | glowPlugType;
    glowPlugOutputType = glw["output_type"] | glowPlugOutputType;
    if (!glw["active_h"].isNull()) glowPlugActiveH = glw["active_h"].as<bool>();
    glowPlugPin     = glw["pin"]      | glowPlugPin;
    glowPlugFreqHz  = glw["freq_hz"]  | glowPlugFreqHz;
    glowPlugResBits = glw["res_bits"] | glowPlugResBits;
    glowPlugPwmMinPct = glw["pwm_min_pct"] | glowPlugPwmMinPct;
    glowPlugPwmMaxPct = glw["pwm_max_pct"] | glowPlugPwmMaxPct;
    wetGlowFuelPin       = glw["fuel_pin"]        | wetGlowFuelPin;
    wetGlowFuelType      = glw["fuel_type"]       | wetGlowFuelType;
    if (!glw["fuel_active_h"].isNull()) wetGlowFuelActiveH = glw["fuel_active_h"].as<bool>();
    wetGlowFuelMinUs     = glw["fuel_min_us"]     | wetGlowFuelMinUs;
    wetGlowFuelMaxUs     = glw["fuel_max_us"]     | wetGlowFuelMaxUs;
    wetGlowFuelFreqHz    = glw["fuel_freq_hz"]    | wetGlowFuelFreqHz;
    wetGlowFuelResBits   = glw["fuel_res_bits"]   | wetGlowFuelResBits;
    wetGlowFuelPwmMinPct = glw["fuel_pwm_min_pct"] | wetGlowFuelPwmMinPct;
    wetGlowFuelPwmMaxPct = glw["fuel_pwm_max_pct"] | wetGlowFuelPwmMaxPct;
    wetGlowFuelDemandPct = glw["fuel_demand_pct"] | wetGlowFuelDemandPct;
    wetGlowFuelDelayMs   = glw["fuel_delay_ms"]   | wetGlowFuelDelayMs;
    glowCurrentPin      = glw["current_pin"]     | glowCurrentPin;
    glowCurrentMvPerA   = glw["current_mv_a"]    | glowCurrentMvPerA;
    glowCurrentZeroV    = glw["current_zero_v"]  | glowCurrentZeroV;
    glowCurrentReadyAmps= glw["current_ready_a"] | glowCurrentReadyAmps;
    if (!glw["has_current"].isNull()) hasGlowCurrentSensor = hasGlowPlug && glw["has_current"].as<bool>();
    glowPlugType = constrain(glowPlugType, 0, 2);
    if (glowPlugType == 1) glowPlugType = 0;  // legacy 'current-sensed' retired; current = hasGlowCurrentSensor
    glowPlugOutputType = constrain(glowPlugOutputType, 0, 1);
    wetGlowFuelType = constrain(wetGlowFuelType, 0, 2);
    wetGlowFuelMinUs = constrain(wetGlowFuelMinUs, 500, 2500);
    wetGlowFuelMaxUs = constrain(wetGlowFuelMaxUs, 500, 2500);
    if (wetGlowFuelMaxUs < wetGlowFuelMinUs) {
        int tmp = wetGlowFuelMinUs;
        wetGlowFuelMinUs = wetGlowFuelMaxUs;
        wetGlowFuelMaxUs = tmp;
    }
    wetGlowFuelFreqHz = constrain(wetGlowFuelFreqHz, 1, 100000);
    wetGlowFuelResBits = constrain(wetGlowFuelResBits, 1, 16);
    wetGlowFuelDemandPct = constrain(wetGlowFuelDemandPct, 0.0f, 100.0f);
    if (wetGlowFuelDelayMs < 0) wetGlowFuelDelayMs = 0;

    auto led = a["status_led"];
    const bool ledEnabledPresent = !led["enabled"].isNull();
    const bool ledPinPresent = !led["pin"].isNull();
    const bool ledTypePresent = !led["type"].isNull();
    if (ledEnabledPresent) hasStatusLed = led["enabled"].as<bool>();
    statusLedPin = led["pin"] | statusLedPin;
    statusLedType = led["type"] | statusLedType;
    statusLedMode = led["mode"] | statusLedMode;
    statusLedStandbyColor  = led["standby_color"]  | statusLedStandbyColor;
    statusLedStartupColor  = led["startup_color"]  | statusLedStartupColor;
    statusLedRunningColor  = led["running_color"]  | statusLedRunningColor;
    statusLedShutdownColor = led["shutdown_color"] | statusLedShutdownColor;
    statusLedBlinkColor    = led["blink_color"]    | statusLedBlinkColor;
    if (statusLedMode < 0 || statusLedMode > 1) statusLedMode = DEFAULT_STATUS_LED_MODE;
    statusLedStandbyColor  &= 0xFFFFFFu;
    statusLedStartupColor  &= 0xFFFFFFu;
    statusLedRunningColor  &= 0xFFFFFFu;
    statusLedShutdownColor &= 0xFFFFFFu;
    statusLedBlinkColor    &= 0xFFFFFFu;
    if (statusLedMode == 1) {
        hasStatusLed = true;
        statusLedType = 1;
    }
#if defined(OT_PLATFORM_ESP32S3)
    if (!ledEnabledPresent) hasStatusLed = true;
    if (hasStatusLed && (!ledPinPresent ||
        statusLedPin < 0 ||
        statusLedPin == AUTO_S3_RGB_STATUS_LED_PIN ||
        statusLedPin == 38)) {
        auto moveOldRgbMiso = [](int& pin) {
            if (pin == 38) pin = OT_SPI_MISO_DEFAULT;
        };
        moveOldRgbMiso(totMiso);
        moveOldRgbMiso(titMiso);
        moveOldRgbMiso(oilTempMiso);
        hasStatusLed = true;
        statusLedPin = DEFAULT_STATUS_LED_PIN;
        statusLedType = DEFAULT_STATUS_LED_TYPE;
        statusLedMode = constrain(statusLedMode, 0, 1);
        Serial.println("[HWCfg] Status LED migrated to YD-ESP32-S3 RGB LED default");
    }
    if (hasStatusLed && statusLedPin == DEFAULT_STATUS_LED_PIN && !ledTypePresent) {
        statusLedType = DEFAULT_STATUS_LED_TYPE;
    }
#else
    if (statusLedPin == AUTO_S3_RGB_STATUS_LED_PIN) statusLedPin = DEFAULT_STATUS_LED_PIN;
    if (hasStatusLed && statusLedPin < 0) statusLedPin = DEFAULT_STATUS_LED_PIN;
#endif
    auto clus = doc["cluster_serial"];
    if (!clus["enabled"].isNull()) hasClusterSerial = clus["enabled"].as<bool>();
    clusterTxPin     = clus["tx_pin"]     | clusterTxPin;
    clusterRxPin     = clus["rx_pin"]     | clusterRxPin;
    clusterBaud      = clus["baud"]       | clusterBaud;
    clusterIntervalMs= clus["interval_ms"]| clusterIntervalMs;

    auto buz = doc["buzzer"];
    if (!buz["enabled"].isNull()) hasBuzzer = buz["enabled"].as<bool>();
    buzzerPin = buz["pin"] | buzzerPin;

    auto mvl = doc["mavlink"];
    if (!mvl["enabled"].isNull()) hasMAVLink = mvl["enabled"].as<bool>();
    mavlinkTxPin    = mvl["tx_pin"]      | mavlinkTxPin;
    mavlinkBaud     = mvl["baud"]        | mavlinkBaud;
    mavlinkIntervalMs = mvl["interval_ms"] | mavlinkIntervalMs;
    PcbProfileResolver::applyFixedPeripherals();

    if (doc["channel_registry"].is<JsonObjectConst>()) {
        // The registry is the fitted-hardware authority. Legacy objects below
        // retain electrical/calibration details for existing runtime drivers,
        // but they cannot keep a removed device enabled.
        hasN1Rpm = hasN2Rpm = hasTot = hasTit = hasOilPress = hasFlame = false;
        hasFuelFlow = hasFuelPress = hasP1 = hasP2 = false;
        hasThrottleInput = hasIdleInput = hasOilTemp = hasBattVoltage = hasTorque = hasThrust = false;
        hasThrottle = hasStarter = hasOilPump = hasFuelSol = hasIgniter = hasIgniter2 = false;
        hasStarterEn = hasAbSol = hasAirstarterSol = hasCoolFan = hasAbPump = false;
        hasOilScavengePump = hasFuelPump2 = hasBleedValve = hasPropPitch = hasGlowPlug = false;
        auto bound = [](const char* key, ChannelRegistry::Direction dir) -> const ChannelRegistry::Channel* {
            for (uint8_t i = 0; i < HardwareConfig::channelRegistry.bindingCount; i++)
                if (strcmp(HardwareConfig::channelRegistry.bindings[i].key, key) == 0)
                    return HardwareConfig::channelRegistry.find(HardwareConfig::channelRegistry.bindings[i].channelId, dir);
            return nullptr;
        };
        auto byIdOrRole = [](ChannelRegistry::Direction dir, const char* id, const char* role) -> const ChannelRegistry::Channel* {
            if (id) {
                const auto* c = HardwareConfig::channelRegistry.find(id, dir);
                if (c) return c;
            }
            const char* purpose = nullptr;
            if (id) {
                if (!strcmp(id, "n1_main") || !strcmp(id, "primary_n1")) purpose = "n1_speed";
                else if (!strcmp(id, "n2_main") || !strcmp(id, "primary_n2")) purpose = "n2_speed";
                else if (!strcmp(id, "tot_main") || !strcmp(id, "primary_egt")) purpose = "tot";
                else if (!strcmp(id, "tit_main")) purpose = "tit";
                else if (!strcmp(id, "oil_pressure_main")) purpose = "oil_pressure";
                else if (!strcmp(id, "fuel_pressure")) purpose = "fuel_pressure";
                else if (!strcmp(id, "p1_main") || !strcmp(id, "p1")) purpose = "p1_pressure";
                else if (!strcmp(id, "p2_main") || !strcmp(id, "p2")) purpose = "p2_pressure";
                else if (!strcmp(id, "oil_temperature")) purpose = "oil_temperature";
                else if (!strcmp(id, "fuel_flow")) purpose = "fuel_flow";
                else if (!strcmp(id, "flame_main")) purpose = "flame";
                else if (!strcmp(id, "torque_main")) purpose = "torque";
                else if (!strcmp(id, "thrust_main")) purpose = "thrust";
                else if (!strcmp(id, "battery_voltage") || !strcmp(id, "batt_voltage_main")) purpose = "battery_voltage";
                else if (!strcmp(id, "operator_throttle")) purpose = "throttle";
                else if (!strcmp(id, "operator_idle")) purpose = "idle";
                else if (!strcmp(id, "main_fuel") || !strcmp(id, "main_fuel_output")) purpose = "main_fuel";
                else if (!strcmp(id, "fuel_shutoff") || !strcmp(id, "main_fuel_shutoff")) purpose = "fuel_shutoff";
                else if (!strcmp(id, "starter") || !strcmp(id, "starter_main") || !strcmp(id, "main_starter")) purpose = "starter";
                else if (!strcmp(id, "starter_enable")) purpose = "starter_enable";
                else if (!strcmp(id, "oil_pump") || !strcmp(id, "oil_pump_main")) purpose = "oil_pump";
                else if (!strcmp(id, "scavenge_pump") || !strcmp(id, "oil_scavenge_main")) purpose = "scavenge_pump";
                else if (!strcmp(id, "cooling_fan") || !strcmp(id, "cooling_fan_main")) purpose = "cooling_fan";
                else if (!strcmp(id, "bleed_valve") || !strcmp(id, "bleed_valve_main")) purpose = "bleed_valve";
                else if (!strcmp(id, "igniter")) purpose = "igniter";
                else if (!strcmp(id, "ab_igniter") || !strcmp(id, "igniter2_main")) purpose = "ab_igniter";
                else if (!strcmp(id, "ab_solenoid")) purpose = "ab_valve";
                else if (!strcmp(id, "glow_plug")) purpose = "glow_plug";
                else if (!strcmp(id, "fuel_pump")) purpose = "fuel_pump";
                else if (!strcmp(id, "ab_pump")) purpose = "ab_pump";
                else if (!strcmp(id, "prop_pitch")) purpose = "prop_pitch";
                else if (!strcmp(id, "air_starter")) purpose = "air_starter";
            }
            const ChannelRegistry::Channel* list = dir == ChannelRegistry::Input
                ? HardwareConfig::channelRegistry.inputs
                : HardwareConfig::channelRegistry.outputs;
            uint8_t count = dir == ChannelRegistry::Input
                ? HardwareConfig::channelRegistry.inputCount
                : HardwareConfig::channelRegistry.outputCount;
            const ChannelRegistry::Channel* sole = nullptr;
            uint8_t matches = 0;
            if (purpose) {
                for (uint8_t i = 0; i < count; i++)
                    if (list[i].installed && !strcmp(list[i].purpose, purpose)) {
                        sole = &list[i];
                        ++matches;
                    }
                if (matches) return matches == 1 ? sole : nullptr;
            }
            sole = nullptr;
            matches = 0;
            for (uint8_t i = 0; i < count; i++)
                if (list[i].installed && role && !strcmp(list[i].role, role)) {
                    sole = &list[i];
                    ++matches;
                }
            return matches == 1 ? sole : nullptr;
        };
        auto outputType = [](ChannelRegistry::Driver d) {
            return d == ChannelRegistry::Servo ? 0 : d == ChannelRegistry::Pwm ? 1 : 2;
        };
        auto applyPulse = [](const ChannelRegistry::Channel* c, bool& has, int& pin, float& pulsesPerUnit) {
            if (c && c->pin >= 0 && c->driver == ChannelRegistry::Pulse) {
                has = true;
                pin = c->pin;
                pulsesPerUnit = c->pulsesPerUnit > 0.0f ? c->pulsesPerUnit : 1.0f;
            }
        };
        // Speed cards may use either a PCNT pulse sensor or an analog RPM
        // transmitter.  The registry owns the analog scale; the legacy pin/PPR
        // fields are only used for the PCNT path.
        auto applySpeed = [&](const ChannelRegistry::Channel* c, bool& has, int& pin, float& pulsesPerUnit) {
            if (!c) return;
            if (c->driver == ChannelRegistry::I2cAnalog) { has = true; pin = -1; return; }
            if (c->pin < 0) return;
            if (c->driver == ChannelRegistry::Pulse) {
                applyPulse(c, has, pin, pulsesPerUnit);
            } else if (c->driver == ChannelRegistry::Analog) {
                has = true;
                pin = c->pin;
            }
        };
        auto applyAnalog = [](const ChannelRegistry::Channel* c, bool& has, int& pin) {
            if (!c) return;
            if (c->pin >= 0 && c->driver == ChannelRegistry::Analog) { has = true; pin = c->pin; }
            else if (c->driver == ChannelRegistry::I2cAnalog) { has = true; pin = -1; }
        };
        auto applyInput = [](const ChannelRegistry::Channel* c, bool& has, int& pin, bool& rcPwm) {
            if (!c) return;
            if (c->driver == ChannelRegistry::I2cDigital ||
                c->driver == ChannelRegistry::I2cAnalog) {
                has = true; pin = -1; rcPwm = false; return;
            }
            if (c->pin < 0) return;
            if (c->driver == ChannelRegistry::Digital || c->driver == ChannelRegistry::Analog ||
                c->driver == ChannelRegistry::Pulse || c->driver == ChannelRegistry::RcPwm ||
                c->driver == ChannelRegistry::PwmDuty) {
                has = true; pin = c->pin; rcPwm = c->driver == ChannelRegistry::RcPwm;
            }
        };
        {
            bool registryStop = false, registryStart = false;
            for (uint8_t i = 0; i < channelRegistry.inputCount; ++i) {
                const auto& c = channelRegistry.inputs[i];
                registryStop = registryStop || !strcmp(c.purpose, "stop_switch");
                registryStart = registryStart || !strcmp(c.purpose, "start_switch");
            }
            if (PcbProfileManager::active()) stopPin = startPin = -1;
            if (registryStop || PcbProfileManager::active()) stopPullup = stopPulldown = false;
            if (registryStart || PcbProfileManager::active()) startPullup = startPulldown = false;
            for (uint8_t i = 0; i < channelRegistry.inputCount; ++i) {
                const auto& c = channelRegistry.inputs[i];
                if (!strcmp(c.purpose, "stop_switch")) {
                    stopPin = c.pin; stopActiveH = c.activeHigh;
                    stopPullup = c.pullup; stopPulldown = c.pulldown;
                } else if (!strcmp(c.purpose, "start_switch")) {
                    startPin = c.pin; startActiveH = c.activeHigh;
                    startPullup = c.pullup; startPulldown = c.pulldown;
                }
            }
            if (!registryStop && PcbProfileManager::active()) stopPin = -1;
            if (!registryStart && PcbProfileManager::active()) startPin = -1;
        }
        auto applyOutput = [&](const ChannelRegistry::Channel* c, bool& has, int& pin, int& type) {
            if (!c) return;
            if (c->driver == ChannelRegistry::I2cRelay) {
                has = true; pin = -1; type = 2; return;
            }
            if (c->pin < 0) return;
            has = true; pin = c->pin; type = outputType(c->driver);
        };
        auto applyVariableOutput = [&](const ChannelRegistry::Channel* c, bool& has, int& pin, int& type,
                                       int& minUs, int& maxUs, float& pwmMinPct, float& pwmMaxPct,
                                       bool& activeH, bool* inverted = nullptr) {
            if (!c) return;
            if (c->driver == ChannelRegistry::I2cRelay) {
                has = true; pin = -1; type = 2; activeH = !c->inverted; return;
            }
            if (c->pin < 0) return;
            has = true; pin = c->pin; type = outputType(c->driver);
            if (c->driver == ChannelRegistry::Servo) {
                minUs = (int)c->minValue;
                maxUs = (int)c->maxValue;
                if (inverted) *inverted = c->inverted;
                else activeH = !c->inverted;
            } else if (c->driver == ChannelRegistry::Pwm) {
                pwmMinPct = constrain(c->minValue, 0.0f, 1.0f) * 100.0f;
                pwmMaxPct = constrain(c->maxValue, 0.0f, 1.0f) * 100.0f;
                if (inverted) *inverted = c->inverted;
                else activeH = !c->inverted;
            } else {
                activeH = !c->inverted;
            }
        };
        auto applyRelayOutput = [&](const ChannelRegistry::Channel* c, bool& has, int& pin, bool& activeH) {
            if (!c) return;
            if (c->driver == ChannelRegistry::I2cRelay) {
                has = true; pin = -1; activeH = !c->inverted; return;
            }
            if (c->pin < 0) return;
            has = true; pin = c->pin; activeH = !c->inverted;
        };
        auto applyPwmTiming = [](const ChannelRegistry::Channel* c, int& frequency, int& resolution) {
            if (!c || c->driver != ChannelRegistry::Pwm || !c->pwmTimingConfigured) return;
            frequency = constrain((int)c->pwmFrequency, 1, 100000);
            resolution = constrain((int)c->pwmResolution, 8, 14);
        };
        auto applyIgniterOutput = [&](const ChannelRegistry::Channel* c, bool& has, int& pin,
                                      bool& pwm, bool& activeH) {
            if (!c) return;
            if (c->driver == ChannelRegistry::I2cRelay) {
                has = true; pin = -1; pwm = false; activeH = !c->inverted; return;
            }
            if (c->pin < 0) return;
            has = true; pin = c->pin; pwm = c->driver != ChannelRegistry::Relay;
            activeH = !c->inverted;
        };

        const auto* n1Registry = bound("primary_n1", ChannelRegistry::Input);
        if (!n1Registry) n1Registry = byIdOrRole(ChannelRegistry::Input, "n1_main", nullptr);
        if (!n1Registry) n1Registry = byIdOrRole(ChannelRegistry::Input, "primary_n1", nullptr);
        const auto* n2Registry = bound("primary_n2", ChannelRegistry::Input);
        if (!n2Registry) n2Registry = byIdOrRole(ChannelRegistry::Input, "n2_main", nullptr);
        if (!n2Registry) n2Registry = byIdOrRole(ChannelRegistry::Input, "primary_n2", nullptr);
        applySpeed(n1Registry, hasN1Rpm, n1RpmPin, n1RpmPpr);
        applySpeed(n2Registry, hasN2Rpm, n2RpmPin, n2RpmPpr);
        // Temperature registry cards carry their calibrated analog value directly
        // into EngineData.  Do not overload the legacy SPI CS fields with an ADC
        // pin: those fields remain meaningful for thermocouple configurations.
        auto applyTemperature = [](const ChannelRegistry::Channel* c, bool& has, char* chip, size_t chipLen,
                                   char* tcType, size_t tcTypeLen, int& clk, int& cs, int& miso, int& mosi) {
            if (!c) return;
            if (c->driver == ChannelRegistry::I2cAnalog) { has = true; return; }
            if (c->driver != ChannelRegistry::Analog) return;
            if (c->temperatureInterface == 0) { if (c->pin >= 0) has = true; return; }
            static const char* const names[] = { "", "max6675", "max31855", "max31856" };
            if (c->temperatureInterface > 3 || c->spiClk < 0 || c->spiCs < 0 || c->spiMiso < 0 ||
                (c->temperatureInterface == 3 && c->spiMosi < 0)) return;
            has = true; strlcpy(chip, names[c->temperatureInterface], chipLen);
            strlcpy(tcType, c->tcType[0] ? c->tcType : "K", tcTypeLen);
            clk = c->spiClk; cs = c->spiCs; miso = c->spiMiso; mosi = c->spiMosi;
        };
        applyTemperature(byIdOrRole(ChannelRegistry::Input, "tot_main", nullptr), hasTot,
                         totChip, sizeof(totChip), totTcType, sizeof(totTcType), totClk, totCs, totMiso, totMosi);
        applyTemperature(byIdOrRole(ChannelRegistry::Input, "tit_main", nullptr), hasTit,
                         titChip, sizeof(titChip), titTcType, sizeof(titTcType), titClk, titCs, titMiso, titMosi);
        // The oil-temperature registry card is the single low/medium-
        // temperature source. Its interface selects the existing calibrated
        // sensor implementation; a plain analog card remains a linear °C
        // transmitter and is read directly through the registry.
        if (const auto* oilTemp = byIdOrRole(ChannelRegistry::Input, "oil_temperature", nullptr)) {
            const uint8_t iface = oilTemp->temperatureInterface;
            if (iface >= 1 && iface <= 3) {
                static const char* const names[] = { "", "max6675", "max31855", "max31856" };
                hasOilTemp = true; strlcpy(oilTempChip, names[iface], sizeof(oilTempChip));
                strlcpy(oilTempTcType, oilTemp->tcType[0] ? oilTemp->tcType : "K", sizeof(oilTempTcType));
                oilTempPin = oilTemp->spiClk; oilTempCs = oilTemp->spiCs; oilTempMiso = oilTemp->spiMiso; oilTempMosi = oilTemp->spiMosi;
            } else if (iface == 4 && oilTemp->pin >= 0) {
                hasOilTemp = true; strlcpy(oilTempChip, "ntc", sizeof(oilTempChip)); oilTempPin = oilTemp->pin;
                ntcBeta = oilTemp->thermistorBeta; ntcR0 = oilTemp->thermistorR0; ntcRFixed = oilTemp->thermistorRFixed;
                ntcFixedPullup = oilTemp->thermistorPullup;
            } else if (iface == 5 && oilTemp->pin >= 0) {
                hasOilTemp = true; strlcpy(oilTempChip, "ds18b20", sizeof(oilTempChip)); oilTempPin = oilTemp->pin;
                oilTempResolution = constrain((int)oilTemp->temperatureResolution, 9, 12);
            }
        }
        if (const auto* ff = byIdOrRole(ChannelRegistry::Input, "fuel_flow", nullptr)) {
            if ((ff->pin >= 0 && (ff->driver == ChannelRegistry::Pulse || ff->driver == ChannelRegistry::Analog)) ||
                ff->driver == ChannelRegistry::I2cAnalog) {
                hasFuelFlow = true;
                fuelFlowPin = ff->pin;
                fuelFlowType = ff->driver == ChannelRegistry::Pulse ? 1 : 0;
                if (ff->driver == ChannelRegistry::Pulse)
                    fuelFlowPulsesPerLitre = ff->pulsesPerUnit > 0.0f ? ff->pulsesPerUnit : 1.0f;
            }
        }
        applyAnalog(byIdOrRole(ChannelRegistry::Input, "oil_pressure_main", nullptr), hasOilPress, oilPressPin);
        if (const auto* c = byIdOrRole(ChannelRegistry::Input, "oil_temperature", nullptr))
            if ((c->pin >= 0 && c->driver == ChannelRegistry::Analog) ||
                c->driver == ChannelRegistry::I2cAnalog) hasOilTemp = true;
        applyAnalog(byIdOrRole(ChannelRegistry::Input, "fuel_pressure", nullptr), hasFuelPress, fuelPressPin);
        if (const auto* pressure1 = byIdOrRole(ChannelRegistry::Input, "p1_main", nullptr)) {
            applyAnalog(pressure1, hasP1, p1Pin);
            if (pressure1->name[0]) strlcpy(labelP1, pressure1->name, sizeof(labelP1));
        }
        if (const auto* pressure2 = byIdOrRole(ChannelRegistry::Input, "p2_main", nullptr)) {
            applyAnalog(pressure2, hasP2, p2Pin);
            if (pressure2->name[0]) strlcpy(labelP2, pressure2->name, sizeof(labelP2));
        }
        if (const auto* flame = byIdOrRole(ChannelRegistry::Input, "flame_main", nullptr)) {
            if ((flame->pin >= 0 && (flame->driver == ChannelRegistry::Analog ||
                                     flame->driver == ChannelRegistry::Digital)) ||
                flame->driver == ChannelRegistry::I2cAnalog ||
                flame->driver == ChannelRegistry::I2cDigital) {
                hasFlame = true; flamePin = flame->pin;
            }
        }
        if (const auto* torque = byIdOrRole(ChannelRegistry::Input, "torque_main", nullptr)) {
            if (torque->driver == ChannelRegistry::I2cLoadCell) {
                hasTorque = true;
                torqueHx711 = false;
                torquePin = -1;
            } else if (torque->driver == ChannelRegistry::I2cAnalog) {
                hasTorque = true;
                torqueHx711 = false;
                torquePin = -1;
            } else if (torque->pin >= 0 && torque->driver == ChannelRegistry::Analog && torque->torqueInterface == 1) {
                hasTorque = true;
                torqueHx711 = true;
                torqueDtPin = torque->pin;
                torqueClkPin = torque->hx711Clk;
                torqueHxScale = torque->hx711Scale;
                torqueHxZero = torque->hx711Zero;
                torquePin = -1;
            } else if (torque->pin >= 0 && torque->driver == ChannelRegistry::Analog) {
                hasTorque = true;
                torqueHx711 = false;
                torquePin = torque->pin;
                const float mvPerNm = torque->analogMvPerUnit > 0.0f ? torque->analogMvPerUnit : 1000.0f;
                torqueScale = 1000.0f / mvPerNm;          // legacy path stores Nm / V
                torqueOffset = torque->analogZeroMv / mvPerNm;
            }
        }
        if (const auto* thrust = byIdOrRole(ChannelRegistry::Input, "thrust_main", nullptr)) {
            hasThrust = thrust->installed &&
                ((thrust->driver == ChannelRegistry::Analog && thrust->pin >= 0) ||
                 thrust->driver == ChannelRegistry::I2cAnalog ||
                 thrust->driver == ChannelRegistry::I2cLoadCell);
        }
        applyInput(bound("operator_throttle", ChannelRegistry::Input), hasThrottleInput, throttleInputPin, throttleInputRcPwm);
        if (!hasThrottleInput)
            applyInput(byIdOrRole(ChannelRegistry::Input, "operator_throttle", nullptr), hasThrottleInput, throttleInputPin, throttleInputRcPwm);
        applyInput(bound("operator_idle", ChannelRegistry::Input), hasIdleInput, idleInputPin, idleInputRcPwm);
        if (!hasIdleInput)
            applyInput(byIdOrRole(ChannelRegistry::Input, "operator_idle", nullptr), hasIdleInput, idleInputPin, idleInputRcPwm);
        const auto* battery = byIdOrRole(ChannelRegistry::Input, "battery_voltage", nullptr);
        if (!battery) battery = byIdOrRole(ChannelRegistry::Input, "batt_voltage_main", nullptr);
        if (battery && ((battery->pin >= 0 && battery->driver == ChannelRegistry::Analog) ||
                        battery->driver == ChannelRegistry::I2cAnalog)) {
            hasBattVoltage = true;
            battVoltPin = battery->pin;
            if (battery->analogDivider >= 1.0f && battery->analogDivider <= 100.0f)
                battVoltDivider = battery->analogDivider;
        }
        const auto* mainFuel = bound("main_fuel_output", ChannelRegistry::Output);
        if (!mainFuel) mainFuel = byIdOrRole(ChannelRegistry::Output, "main_fuel", nullptr);
        applyVariableOutput(mainFuel, hasThrottle, throttlePin, throttleType,
                             throttleMinUs, throttleMaxUs, throttlePwmMinPct, throttlePwmMaxPct,
                             throttleActiveH, &throttleInverted);
        applyPwmTiming(mainFuel, throttleLedcFreqHz, throttleLedcBits);
        const auto* starter = bound("main_starter", ChannelRegistry::Output);
        if (!starter) starter = byIdOrRole(ChannelRegistry::Output, "starter_main", nullptr);
        if (!starter) starter = byIdOrRole(ChannelRegistry::Output, "starter", nullptr);
        applyVariableOutput(starter, hasStarter, starterPin, starterType,
                             starterMinUs, starterMaxUs, starterPwmMinPct, starterPwmMaxPct,
                             starterActiveH, &starterInverted);
        applyPwmTiming(starter, starterLedcFreqHz, starterLedcBits);
        const auto* oilPump = bound("primary_oil_pump", ChannelRegistry::Output);
        if (!oilPump) oilPump = byIdOrRole(ChannelRegistry::Output, "oil_pump_main", nullptr);
        applyVariableOutput(oilPump,
                            hasOilPump, oilPumpPin, oilPumpType,
                            oilPumpMinUs, oilPumpMaxUs, oilPumpPwmMinPct, oilPumpPwmMaxPct,
                             oilPumpActiveH);
        applyPwmTiming(oilPump, oilPumpFreqHz, oilPumpResBits);
        const auto* coolingFan = bound("primary_cooling_fan", ChannelRegistry::Output);
        if (!coolingFan) coolingFan = byIdOrRole(ChannelRegistry::Output, "cooling_fan_main", nullptr);
        applyVariableOutput(coolingFan,
                            hasCoolFan, coolFanPin, coolFanType,
                            coolFanMinUs, coolFanMaxUs, coolFanPwmMinPct, coolFanPwmMaxPct,
                             coolFanActiveH);
        applyPwmTiming(coolingFan, coolFanFreqHz, coolFanResBits);
        const auto* scavengePump = bound("primary_scavenge_pump", ChannelRegistry::Output);
        if (!scavengePump) scavengePump = byIdOrRole(ChannelRegistry::Output, "oil_scavenge_main", nullptr);
        applyVariableOutput(scavengePump,
                            hasOilScavengePump, oilScavPumpPin, oilScavPumpType,
                            oilScavPumpMinUs, oilScavPumpMaxUs, oilScavPumpPwmMinPct, oilScavPumpPwmMaxPct,
                             oilScavPumpActiveH);
        applyPwmTiming(scavengePump, oilScavPumpFreqHz, oilScavPumpResBits);
        const auto* bleedValve = bound("primary_bleed_valve", ChannelRegistry::Output);
        if (!bleedValve) bleedValve = byIdOrRole(ChannelRegistry::Output, "bleed_valve_main", nullptr);
        applyVariableOutput(bleedValve,
                            hasBleedValve, bleedValvePin, bleedValveType,
                            bleedValveMinUs, bleedValveMaxUs, bleedValvePwmMinPct, bleedValvePwmMaxPct,
                             bleedValveActiveH);
        applyPwmTiming(bleedValve, bleedValveFreqHz, bleedValveResBits);
        const auto* auxFuelPump = bound("primary_aux_fuel_pump", ChannelRegistry::Output);
        if (!auxFuelPump) auxFuelPump = byIdOrRole(ChannelRegistry::Output, "fuel_pump", nullptr);
        applyVariableOutput(auxFuelPump,
                            hasFuelPump2, fuelPump2Pin, fuelPump2Type,
                            fuelPump2MinUs, fuelPump2MaxUs, fuelPump2PwmMinPct, fuelPump2PwmMaxPct,
                             fuelPump2ActiveH);
        applyPwmTiming(auxFuelPump, fuelPump2FreqHz, fuelPump2ResBits);
        const auto* afterburnerPump = bound("primary_ab_pump", ChannelRegistry::Output);
        if (!afterburnerPump) afterburnerPump = byIdOrRole(ChannelRegistry::Output, "ab_pump", nullptr);
        applyVariableOutput(afterburnerPump,
                            hasAbPump, abPumpPin, abPumpType,
                            abPumpMinUs, abPumpMaxUs, abPumpPwmMinPct, abPumpPwmMaxPct,
                             abPumpActiveH);
        applyPwmTiming(afterburnerPump, abPumpFreqHz, abPumpResBits);
        const auto* propellerPitch = bound("primary_prop_pitch", ChannelRegistry::Output);
        if (!propellerPitch) propellerPitch = byIdOrRole(ChannelRegistry::Output, "prop_pitch", nullptr);
        applyVariableOutput(propellerPitch,
                            hasPropPitch, propPitchPin, propPitchType,
                            propPitchMinUs, propPitchMaxUs, propPitchPwmMinPct, propPitchPwmMaxPct,
                             propPitchActiveH);
        applyPwmTiming(propellerPitch, propPitchFreqHz, propPitchResBits);
        const auto* secondaryIgniter = bound("primary_secondary_igniter", ChannelRegistry::Output);
        if (!secondaryIgniter) secondaryIgniter = byIdOrRole(ChannelRegistry::Output, "ab_igniter", nullptr);
        applyIgniterOutput(secondaryIgniter,
                           hasIgniter2, igniter2Pin, igniter2Pwm, igniter2ActiveH);
        if (const auto* c = secondaryIgniter)
            if (c->pin >= 0 || c->driver == ChannelRegistry::I2cRelay) hasAfterburner = true;
        const auto* primaryIgniter = bound("primary_igniter", ChannelRegistry::Output);
        if (!primaryIgniter) primaryIgniter = byIdOrRole(ChannelRegistry::Output, "igniter", nullptr);
        applyIgniterOutput(primaryIgniter,
                           hasIgniter, igniterPin, igniterPwm, igniterActiveH);
        if (const auto* c = primaryIgniter) {
            if (c->driver == ChannelRegistry::Relay || c->driver == ChannelRegistry::I2cRelay) {
                igniterPwm = false;
                igniterCoil = false;
            }
        }
        if (const auto* c = secondaryIgniter) {
            if (c->driver == ChannelRegistry::Relay || c->driver == ChannelRegistry::I2cRelay) {
                igniter2Pwm = false;
                igniter2Coil = false;
            }
        }
        const auto* primaryGlow = bound("primary_glow_plug", ChannelRegistry::Output);
        if (!primaryGlow) primaryGlow = byIdOrRole(ChannelRegistry::Output, "glow_plug", nullptr);
        if (const auto* c = primaryGlow) {
            if (c->pin >= 0 || c->driver == ChannelRegistry::I2cRelay) {
                hasGlowPlug = true;
                glowPlugPin = c->pin;
                glowPlugOutputType = (c->driver == ChannelRegistry::Relay ||
                                      c->driver == ChannelRegistry::I2cRelay) ? 1 : 0;
                if (c->driver == ChannelRegistry::Pwm) {
                    glowPlugPwmMinPct = constrain(c->minValue, 0.0f, 1.0f) * 100.0f;
                    glowPlugPwmMaxPct = constrain(c->maxValue, 0.0f, 1.0f) * 100.0f;
                    glowPlugActiveH = !c->inverted;
                    applyPwmTiming(c, glowPlugFreqHz, glowPlugResBits);
                } else if (c->driver == ChannelRegistry::Relay) {
                    glowPlugActiveH = !c->inverted;
                }
            }
        }
        for (uint8_t i = 0; i < channelRegistry.outputCount; ++i) {
            const auto& c = channelRegistry.outputs[i];
            if (!c.installed || strcmp(c.purpose, "pilot_fuel")) continue;
            // The registry card is the sole wet-glow fuel endpoint. Suppress
            // any stale nested GPIO mirror so one command cannot energize two
            // physical outputs, and derive On/percentage semantics from the
            // actual selected driver.
            wetGlowFuelPin = -1;
            wetGlowFuelType = (c.driver == ChannelRegistry::Relay ||
                               c.driver == ChannelRegistry::I2cRelay) ? 0
                              : c.driver == ChannelRegistry::Pwm ? 1 : 2;
            wetGlowFuelActiveH = !c.inverted;
            break;
        }
        const auto* starterEnable = bound("starter_enable_output", ChannelRegistry::Output);
        if (!starterEnable) starterEnable = byIdOrRole(ChannelRegistry::Output, "starter_enable", nullptr);
        applyRelayOutput(starterEnable,
                         hasStarterEn, starterEnPin, starterEnActiveH);
        applyRelayOutput(byIdOrRole(ChannelRegistry::Output, "fuel_shutoff", nullptr),
                         hasFuelSol, fuelSolPin, fuelSolActiveH);
        const auto* afterburnerValve = bound("primary_ab_valve", ChannelRegistry::Output);
        if (!afterburnerValve) afterburnerValve = byIdOrRole(ChannelRegistry::Output, "ab_solenoid", nullptr);
        applyRelayOutput(afterburnerValve,
                         hasAbSol, abSolPin, abSolActiveH);
        const auto* airStarter = bound("primary_air_starter", ChannelRegistry::Output);
        if (!airStarter) airStarter = byIdOrRole(ChannelRegistry::Output, "air_starter", nullptr);
        applyRelayOutput(airStarter,
                         hasAirstarterSol, airstarterSolPin, airstarterSolActiveH);
        if (const auto* c = bound("main_fuel_shutoff", ChannelRegistry::Output)) {
            if (c->pin >= 0 || c->driver == ChannelRegistry::I2cRelay) {
                hasFuelSol = true; fuelSolPin = c->pin; fuelSolActiveH = !c->inverted;
            }
        }
        hasOilPumpCurrentSensor = hasOilPump && (op["has_current"] | false);
        hasIgniterCurrentSensor = hasIgniter && (ign["has_current"] | false);
        hasIgniter2CurrentSensor = hasIgniter2 && (ign2["has_current"] | false);
        hasGlowCurrentSensor = hasGlowPlug && (glw["has_current"] | false);
        // Dedicated actuator objects retain a few mode-specific fields, while
        // the registry is the canonical per-output protection inventory.
        // Mirror current-sensor settings into the owning physical card so the
        // generic safety loop treats oil, glow and both igniters uniformly.
        auto syncCurrentProtection = [](const char* purpose, JsonVariantConst source) {
            for (uint8_t i = 0; i < channelRegistry.outputCount; ++i) {
                auto& c = channelRegistry.outputs[i];
                if (strcmp(c.purpose, purpose) || !channelRegistry.ownsCoreOutput(c)) continue;
                c.hasCurrent = source["has_current"] | false;
                c.currentPin = source["current_pin"] | -1;
                c.currentMvPerA = source["current_mv_a"] | 100.0f;
                c.currentZeroV = source["current_zero_v"] | 1.65f;
                c.currentMaxAmps = source["current_max_a"] | 0.0f;
                if (!strcmp(purpose, "glow_plug"))
                    c.currentReadyAmps = source["current_ready_a"] | 3.0f;
                c.currentTripDelayMs = source["current_trip_delay_ms"] | 5000UL;
                break;
            }
        };
        syncCurrentProtection("oil_pump", op);
        syncCurrentProtection("glow_plug", glw);
        syncCurrentProtection("igniter", ign);
        syncCurrentProtection("ab_igniter", ign2);

        // The registry is canonical for per-device ignition tuning. Mirror the
        // profile of a card that owns a legacy physical output into the compact
        // core fields used by the hardware writer. This keeps imported files
        // identical to profiles edited through the Hardware page.
        for (uint8_t i = 0; i < channelRegistry.outputCount; ++i) {
            const auto& c = channelRegistry.outputs[i];
            if (!c.installed || !c.ignitionProfileConfigured ||
                !channelRegistry.ownsCoreOutput(c)) continue;
            const bool dwell = c.ignitionMode >= 1;
            const bool coil = c.ignitionMode == 2;
            if (!strcmp(c.purpose, "igniter")) {
                igniterPwm = dwell;
                igniterCoil = coil;
                igniterDwellMs = c.ignitionDwellMs;
                igniterRestMs = c.ignitionRestMs;
                igniterCoilSatAmps = c.ignitionCoilSatAmps;
            } else if (!strcmp(c.purpose, "ab_igniter")) {
                igniter2Pwm = dwell;
                igniter2Coil = coil;
                igniter2DwellMs = c.ignitionDwellMs;
                igniter2RestMs = c.ignitionRestMs;
                igniter2CoilSatAmps = c.ignitionCoilSatAmps;
            }
        }
    }

    auto contrl = doc["controllers"];
    if (!contrl["oil_loop"].isNull())      hasOilLoop      = contrl["oil_loop"].as<bool>();
    if (!contrl["dynamic_idle"].isNull())  hasDynamicIdle  = contrl["dynamic_idle"].as<bool>();
    if (!contrl["governor"].isNull())      hasGovernor     = contrl["governor"].as<bool>();
    oilLoopCount = 0;
    for (int i = 0; i < MAX_OIL_LOOPS; i++) oilLoops[i] = OilLoopDef{};
    if (doc["oil_loops"].is<JsonArrayConst>()) {
        auto outType = [](ChannelRegistry::Driver d) {
            return d == ChannelRegistry::Servo ? 0 : d == ChannelRegistry::Pwm ? 1 : 2;
        };
        auto inputIndex = [](const char* id) -> uint8_t {
            for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; i++)
                if (!strcmp(HardwareConfig::channelRegistry.inputs[i].id, id)) return i;
            return 255;
        };
        auto outputIndex = [](const char* id) -> uint8_t {
            for (uint8_t i = 0; i < HardwareConfig::channelRegistry.outputCount; i++)
                if (!strcmp(HardwareConfig::channelRegistry.outputs[i].id, id)) return i;
            return 255;
        };
        bool anyEnabledLoop = false;
        for (JsonObjectConst src : doc["oil_loops"].as<JsonArrayConst>()) {
            if (oilLoopCount >= MAX_OIL_LOOPS) break;
            OilLoopDef& l = oilLoops[oilLoopCount++];
            strlcpy(l.id, src["id"] | "", sizeof(l.id));
            l.pressureInputIndex = inputIndex(src["pressure_input"] | "");
            l.pumpOutputIndex = outputIndex(src["pump_output"] | "");
            l.enabled = src["enabled"] | false;
            l.targetSource = (uint8_t)constrain(src["target_source"] | 0, 0, 3);
            l.targetCentiBar = (uint16_t)constrain((int)((src["target_bar"] | 2.5f) * 100.0f), 0, 2000);
            l.targetHighCentiBar = (uint16_t)constrain((int)((src["target_high_bar"] | (l.targetCentiBar / 100.0f)) * 100.0f), 0, 2000);
            l.speedMinHundredRpm = (uint16_t)constrain((int)((src["speed_min_rpm"] | 0.0f) / 100.0f), 0, 65535);
            l.speedMaxHundredRpm = (uint16_t)constrain((int)((src["speed_max_rpm"] | 20000.0f) / 100.0f), 0, 65535);
            l.deadbandCentiBar = (uint16_t)constrain((int)((src["deadband_bar"] | 0.2f) * 100.0f), 0, 500);
            l.adjustScaleCenti = (uint16_t)constrain((int)((src["response_gain"] | Config::oilAdjustScale) * 100.0f), 0, 10000);
            l.failsafeDelayMs = (uint16_t)constrain(src["failsafe_delay_ms"] | Config::oilFailsafeDelayMs, 0, 60000);
            // Oil-loop cards own their protection threshold. Missing fields
            // use the same conservative 1 bar default as newly-created UI
            // cards; inheriting the legacy global 2.8 bar value can place the
            // shutdown threshold above a perfectly valid 2.5 bar target.
            l.lowPressureCentiBar = (uint16_t)constrain((int)((src["low_pressure_bar"] | 1.0f) * 100.0f), 0, 2000);
            l.lowPressureConfirmMs = (uint16_t)constrain(src["low_pressure_confirm_ms"] | Config::lowOilConfirmMs, 0, 60000);
            l.immediatePumpRunDeciSec = (uint16_t)constrain((int)((src["immediate_pump_run_s"] | 10.0f) * 10.0f), 0, 1200);
            l.failsafeDemandPct = (uint8_t)constrain((int)((src["failsafe_demand"] | (Config::oilFailsafePct / 100.0f)) * 100.0f), 0, 100);
            l.minDemandPct = (uint8_t)constrain((int)((src["min_demand"] | 0.18f) * 100.0f), 0, 100);
            l.maxDemandPct = (uint8_t)constrain((int)((src["max_demand"] | 1.0f) * 100.0f), l.minDemandPct, 100);
            l.lowPressureResponse = (uint8_t)constrain(src["low_pressure_response"] | (int)OilFaultShutdown,
                                                       (int)OilFaultDisabled, (int)OilFaultImmediateStop);
            l.feedbackLossResponse = (uint8_t)constrain(src["feedback_loss_response"] | (int)OilFaultShutdown,
                                                        (int)OilFaultDisabled, (int)OilFaultImmediateStop);
            if (l.enabled && !anyEnabledLoop) {
                const auto* pressure = l.pressureInputIndex < channelRegistry.inputCount ? &channelRegistry.inputs[l.pressureInputIndex] : nullptr;
                const auto* pump = l.pumpOutputIndex < channelRegistry.outputCount ? &channelRegistry.outputs[l.pumpOutputIndex] : nullptr;
                if (pressure && ChannelRegistry::channelAddressable(*pressure)) {
                    hasOilPress = true;
                    if (pressure->pin >= 0) oilPressPin = pressure->pin;
                }
                if (pump && ChannelRegistry::channelAddressable(*pump)) {
                    hasOilPump = true; oilPumpType = outType(pump->driver);
                    if (pump->pin >= 0) oilPumpPin = pump->pin;
                }
                anyEnabledLoop = true;
            }
        }
        // The visible controller master is authoritative. Saved loop entries
        // retain their tuning while the master is Off, but cannot re-enable it.
    }
    if (hasOilLoop && (!hasOilPress || !hasOilPump)) {
        Serial.println("[HWCfg] Oil pressure loop disabled: requires oil pressure sensor and oil pump");
        hasOilLoop = false;
    }
    const bool hasMeteringThrottle = hasThrottle && throttleType != 2;
    if (hasDynamicIdle && (!hasMeteringThrottle || (!hasN1Rpm && !hasN2Rpm && !hasP1 && !hasP2))) {
        Serial.println("[HWCfg] Automatic idle control disabled: requires main fuel output and N1, N2, P1, or P2 feedback");
        hasDynamicIdle = false;
    }
    const bool hasUsablePropPitch = hasPropPitch;
    if (hasGovernor && (!hasN2Rpm || (!hasMeteringThrottle && !hasUsablePropPitch))) {
        Serial.println("[HWCfg] Governor disabled: requires N2 RPM and metering throttle or prop pitch output");
        hasGovernor = false;
    }

    auto saf = doc["safety"];
    if (!saf["overspeed"].isNull()) safetyOverspeed = saf["overspeed"].as<bool>();
    if (!saf["n2_overspeed"].isNull()) safetyN2Overspeed = saf["n2_overspeed"].as<bool>();
    if (!saf["overtemp"].isNull())  safetyOvertemp  = saf["overtemp"].as<bool>();
    if (saf["tit_overtemp"] | false) safetyOvertemp = true;
    if (!saf["low_oil"].isNull())   safetyLowOil    = saf["low_oil"].as<bool>();
    if (!saf["oil_zero"].isNull())  safetyOilZero   = saf["oil_zero"].as<bool>();
    if (!saf["flameout"].isNull())   safetyFlameout  = saf["flameout"].as<bool>();
    if (!saf["hot_start"].isNull())      safetyHotStart      = saf["hot_start"].as<bool>();
    if (!saf["oil_temp_high"].isNull())  safetyOilTempHigh   = saf["oil_temp_high"].as<bool>();
    if (!saf["fuel_press_low"].isNull()) safetyFuelPressLow  = saf["fuel_press_low"].as<bool>();
    if (!saf["batt_low"].isNull())       safetyBattLow       = saf["batt_low"].as<bool>();
    if (!saf["surge"].isNull())          safetySurge         = saf["surge"].as<bool>();
    if (!hasN1Rpm) {
        safetyOverspeed = false;
        safetySurge = false;
    }
    if (!hasN2Rpm) safetyN2Overspeed = false;
    if (!hasTot && !hasTit) {
        safetyOvertemp = false;
        safetyHotStart = false;
    }
    auto hasDocOrRegistrySwitch = [&](const char* role) {
        if (docHasDiRole(doc, role)) return true;
        for (uint8_t i = 0; i < channelRegistry.inputCount; ++i) {
            const auto& c = channelRegistry.inputs[i];
            if (c.installed && (!strcmp(c.role, role) || !strcmp(c.purpose, role))) return true;
        }
        return false;
    };
    if (!hasOilPress && !hasDocOrRegistrySwitch("low_oil_switch")) {
        safetyLowOil = false;
    }
    if (!hasOilPress && !hasDocOrRegistrySwitch("oil_zero_switch")) {
        safetyOilZero = false;
    }
    if (!hasFlame && !hasN1Rpm && !hasTot && !hasTit) safetyFlameout = false;
    if (!hasOilTemp) safetyOilTempHigh = false;
    if (!hasFuelPress) safetyFuelPressLow = false;
    if (!hasBattVoltage) safetyBattLow = false;

    if (doc["startup_seq"].is<JsonArrayConst>()) {
        JsonArrayConst ss = doc["startup_seq"];
        int n = (int)ss.size();
        if (n > MAX_SEQ_BLOCKS) n = MAX_SEQ_BLOCKS;
        startupSeqLen = n;
        memset(startupDelayMs, 0, sizeof(startupDelayMs));
        for (int i = 0; i < n; i++) {
            strncpy(startupSeq[i], ss[i] | "", sizeof(startupSeq[i]) - 1);
            startupSeq[i][sizeof(startupSeq[i]) - 1] = '\0';
        }
    }
    if (doc["startup_delay_ms"].is<JsonArrayConst>()) {
        JsonArrayConst d = doc["startup_delay_ms"];
        for (int i = 0; i < startupSeqLen && i < (int)d.size(); i++)
            startupDelayMs[i] = constrain(d[i] | 0, 0, 3600000);
    }
    memset(startupIgnitionTarget, 0, sizeof(startupIgnitionTarget));
    if (doc["startup_ignition_target"].is<JsonArrayConst>()) {
        JsonArrayConst t = doc["startup_ignition_target"];
        for (int i = 0; i < startupSeqLen && i < (int)t.size(); i++)
            startupIgnitionTarget[i] = constrain(t[i] | 0, 0, 2);
    }
    memset(startupDeviceTarget, 0, sizeof(startupDeviceTarget));
    if (doc["startup_device_target"].is<JsonArrayConst>()) {
        JsonArrayConst t = doc["startup_device_target"];
        for (int i = 0; i < startupSeqLen && i < (int)t.size(); ++i)
            strlcpy(startupDeviceTarget[i], t[i] | "", sizeof(startupDeviceTarget[i]));
    }
    readSeqSideActions(doc, "startup_enter_actions", startupSeqLen, startupEnterActions);
    readSeqSideActions(doc, "startup_exit_actions", startupSeqLen, startupExitActions);

    if (doc["shutdown_seq"].is<JsonArrayConst>()) {
        JsonArrayConst ds = doc["shutdown_seq"];
        int n = (int)ds.size();
        if (n > MAX_SEQ_BLOCKS) n = MAX_SEQ_BLOCKS;
        shutdownSeqLen = n;
        memset(shutdownDelayMs, 0, sizeof(shutdownDelayMs));
        for (int i = 0; i < n; i++) {
            strncpy(shutdownSeq[i], ds[i] | "", sizeof(shutdownSeq[i]) - 1);
            shutdownSeq[i][sizeof(shutdownSeq[i]) - 1] = '\0';
        }
    }
    if (doc["shutdown_delay_ms"].is<JsonArrayConst>()) {
        JsonArrayConst d = doc["shutdown_delay_ms"];
        for (int i = 0; i < shutdownSeqLen && i < (int)d.size(); i++)
            shutdownDelayMs[i] = constrain(d[i] | 0, 0, 3600000);
    }
    memset(shutdownIgnitionTarget, 0, sizeof(shutdownIgnitionTarget));
    if (doc["shutdown_ignition_target"].is<JsonArrayConst>()) {
        JsonArrayConst t = doc["shutdown_ignition_target"];
        for (int i = 0; i < shutdownSeqLen && i < (int)t.size(); i++)
            shutdownIgnitionTarget[i] = constrain(t[i] | 0, 0, 2);
    }
    memset(shutdownDeviceTarget, 0, sizeof(shutdownDeviceTarget));
    if (doc["shutdown_device_target"].is<JsonArrayConst>()) {
        JsonArrayConst t = doc["shutdown_device_target"];
        for (int i = 0; i < shutdownSeqLen && i < (int)t.size(); ++i)
            strlcpy(shutdownDeviceTarget[i], t[i] | "", sizeof(shutdownDeviceTarget[i]));
    }
    readSeqSideActions(doc, "shutdown_enter_actions", shutdownSeqLen, shutdownEnterActions);
    readSeqSideActions(doc, "shutdown_exit_actions", shutdownSeqLen, shutdownExitActions);

    auto abt = doc["ab_trigger"];
    abTriggerSource    = abt["source"]          | abTriggerSource;
    if (!abt["requires_arm"].isNull())  abRequiresArmSwitch = abt["requires_arm"].as<bool>();
    abArmSwitchPin     = abt["arm_pin"]         | abArmSwitchPin;
    if (!abt["arm_active_h"].isNull())  abArmSwitchActiveH  = abt["arm_active_h"].as<bool>();
    abSwitchPin        = abt["switch_pin"]      | abSwitchPin;
    if (!abt["switch_active_h"].isNull()) abSwitchActiveH   = abt["switch_active_h"].as<bool>();
    abInputPin         = abt["input_pin"]       | abInputPin;
    if (!abt["input_rc_pwm"].isNull()) abInputRcPwm = abt["input_rc_pwm"].as<bool>();
    abInputMinUs       = abt["input_min_us"]    | abInputMinUs;
    abInputMaxUs       = abt["input_max_us"]    | abInputMaxUs;
    abInputThreshold   = abt["input_threshold"] | abInputThreshold;

    hasAbFlame = false;
    for (uint8_t i = 0; i < channelRegistry.inputCount; ++i) {
        const auto& c = channelRegistry.inputs[i];
        if ((!strcmp(c.purpose, "ab_flame") || !strcmp(c.id, "ab_flame_main")) &&
            ChannelRegistry::channelAddressable(c) &&
            (c.driver == ChannelRegistry::Digital || c.driver == ChannelRegistry::Analog ||
             c.driver == ChannelRegistry::I2cDigital || c.driver == ChannelRegistry::I2cAnalog)) {
            hasAbFlame = true;
            break;
        }
    }

    // Legacy master switches are no longer authoritative. Topology is derived
    // from the fitted devices so registry and legacy channels behave the same.
    hasAfterburner = hasAfterburner || hasAbSol || hasAbPump || hasAbFlame ||
                     abSwitchPin >= 0 || abInputPin >= 0 ||
                     registryHasAddressablePurpose(&channelRegistry,
                         ChannelRegistry::Input, "ab_command");

    if (doc["ab_seq"].is<JsonArrayConst>()) {
        JsonArrayConst as = doc["ab_seq"];
        int n = (int)as.size();
        if (n > MAX_SEQ_BLOCKS) n = MAX_SEQ_BLOCKS;
        abSeqLen = n;
        memset(abDelayMs, 0, sizeof(abDelayMs));
        for (int i = 0; i < n; i++) {
            strncpy(abSeq[i], as[i] | "", sizeof(abSeq[i]) - 1);
            abSeq[i][sizeof(abSeq[i]) - 1] = '\0';
        }
    }
    if (doc["ab_delay_ms"].is<JsonArrayConst>()) {
        JsonArrayConst d = doc["ab_delay_ms"];
        for (int i = 0; i < abSeqLen && i < (int)d.size(); i++)
            abDelayMs[i] = constrain(d[i] | 0, 0, 3600000);
    }
    memset(abIgnitionTarget, 0, sizeof(abIgnitionTarget));
    if (doc["ab_ignition_target"].is<JsonArrayConst>()) {
        JsonArrayConst t = doc["ab_ignition_target"];
        for (int i = 0; i < abSeqLen && i < (int)t.size(); i++)
            abIgnitionTarget[i] = constrain(t[i] | 0, 0, 2);
    }
    memset(abDeviceTarget, 0, sizeof(abDeviceTarget));
    if (doc["ab_device_target"].is<JsonArrayConst>()) {
        JsonArrayConst t = doc["ab_device_target"];
        for (int i = 0; i < abSeqLen && i < (int)t.size(); ++i)
            strlcpy(abDeviceTarget[i], t[i] | "", sizeof(abDeviceTarget[i]));
    }
    readSeqSideActions(doc, "ab_enter_actions", abSeqLen, abEnterActions);
    readSeqSideActions(doc, "ab_exit_actions", abSeqLen, abExitActions);

    if (doc["ab_shut_seq"].is<JsonArrayConst>()) {
        JsonArrayConst ass = doc["ab_shut_seq"];
        int n = (int)ass.size();
        if (n > MAX_SEQ_BLOCKS) n = MAX_SEQ_BLOCKS;
        abShutSeqLen = n;
        memset(abShutDelayMs, 0, sizeof(abShutDelayMs));
        for (int i = 0; i < n; i++) {
            strncpy(abShutSeq[i], ass[i] | "", sizeof(abShutSeq[i]) - 1);
            abShutSeq[i][sizeof(abShutSeq[i]) - 1] = '\0';
        }
    }
    if (doc["ab_shut_delay_ms"].is<JsonArrayConst>()) {
        JsonArrayConst d = doc["ab_shut_delay_ms"];
        for (int i = 0; i < abShutSeqLen && i < (int)d.size(); i++)
            abShutDelayMs[i] = constrain(d[i] | 0, 0, 3600000);
    }
    memset(abShutIgnitionTarget, 0, sizeof(abShutIgnitionTarget));
    if (doc["ab_shut_ignition_target"].is<JsonArrayConst>()) {
        JsonArrayConst t = doc["ab_shut_ignition_target"];
        for (int i = 0; i < abShutSeqLen && i < (int)t.size(); i++)
            abShutIgnitionTarget[i] = constrain(t[i] | 0, 0, 2);
    }
    memset(abShutDeviceTarget, 0, sizeof(abShutDeviceTarget));
    if (doc["ab_shut_device_target"].is<JsonArrayConst>()) {
        JsonArrayConst t = doc["ab_shut_device_target"];
        for (int i = 0; i < abShutSeqLen && i < (int)t.size(); ++i)
            strlcpy(abShutDeviceTarget[i], t[i] | "", sizeof(abShutDeviceTarget[i]));
    }
    readSeqSideActions(doc, "ab_shut_enter_actions", abShutSeqLen, abShutEnterActions);
    readSeqSideActions(doc, "ab_shut_exit_actions", abShutSeqLen, abShutExitActions);
    readCustomBlocks(doc);
    sanitizeSeqSideActions(startupEnterActions);
    sanitizeSeqSideActions(startupExitActions);
    sanitizeSeqSideActions(shutdownEnterActions);
    sanitizeSeqSideActions(shutdownExitActions);
    sanitizeSeqSideActions(abEnterActions);
    sanitizeSeqSideActions(abExitActions);
    sanitizeSeqSideActions(abShutEnterActions);
    sanitizeSeqSideActions(abShutExitActions);

    sanitizeSequenceBlocks(startupSeq, startupSeqLen, startupDelayMs, startupIgnitionTarget, startupDeviceTarget, startupEnterActions, startupExitActions);
    sanitizeSequenceBlocks(shutdownSeq, shutdownSeqLen, shutdownDelayMs, shutdownIgnitionTarget, shutdownDeviceTarget, shutdownEnterActions, shutdownExitActions);
    sanitizeSequenceBlocks(abSeq, abSeqLen, abDelayMs, abIgnitionTarget, abDeviceTarget, abEnterActions, abExitActions);
    sanitizeSequenceBlocks(abShutSeq, abShutSeqLen, abShutDelayMs, abShutIgnitionTarget, abShutDeviceTarget, abShutEnterActions, abShutExitActions);

    if (doc["labels"].is<JsonObjectConst>()) {
        auto lbld = doc["labels"].as<JsonObjectConst>();
        auto cpylbl = [](char* dst, size_t sz, const char* src) {
            if (src && src[0]) { strncpy(dst, src, sz-1); dst[sz-1]='\0'; }
        };
        cpylbl(labelTot,       sizeof(labelTot),       lbld["tot"]        | "");
        cpylbl(labelTit,       sizeof(labelTit),       lbld["tit"]        | "");
        cpylbl(labelN1,        sizeof(labelN1),        lbld["n1"]         | "");
        cpylbl(labelN2,        sizeof(labelN2),        lbld["n2"]         | "");
        cpylbl(labelOilPress,  sizeof(labelOilPress),  lbld["oil_press"]  | "");
        cpylbl(labelOilTemp,   sizeof(labelOilTemp),   lbld["oil_temp"]   | "");
        cpylbl(labelP1,        sizeof(labelP1),        lbld["p1"]         | "");
        cpylbl(labelP2,        sizeof(labelP2),        lbld["p2"]         | "");
        cpylbl(labelFuelPress, sizeof(labelFuelPress), lbld["fuel_press"] | "");
        cpylbl(labelFuelFlow,  sizeof(labelFuelFlow),  lbld["fuel_flow"]  | "");
        cpylbl(labelStop,      sizeof(labelStop),      lbld["stop"]       | "");
        cpylbl(labelStart,     sizeof(labelStart),     lbld["start"]      | "");
        cpylbl(labelAbArm,     sizeof(labelAbArm),     lbld["ab_arm"]     | "");
    }

    if (doc["di_channels"].is<JsonArrayConst>()) {
        for (int j = 0; j < MAX_DI; ++j) diCh[j] = DiChannel{};
        JsonArrayConst arr = doc["di_channels"].as<JsonArrayConst>();
        int i = 0;
        for (JsonObjectConst ch : arr) {
            if (i >= MAX_DI) break;
            diCh[i].pin        = ch["pin"]         | -1;
            diCh[i].activeH    = ch["active_h"]    | false;
            diCh[i].debounceMs = ch["debounce_ms"] | 20;
            strncpy(diCh[i].label,     ch["label"]      | "", sizeof(diCh[i].label)-1);
            strncpy(diCh[i].role,      ch["role"]       | "none", sizeof(diCh[i].role)-1);
            strncpy(diCh[i].faultCode, ch["fault_code"] | "", sizeof(diCh[i].faultCode)-1);
            strncpy(diCh[i].faultMsg,  ch["fault_msg"]  | "", sizeof(diCh[i].faultMsg)-1);
            diCh[i].label[sizeof(diCh[i].label) - 1] = '\0';
            diCh[i].role[sizeof(diCh[i].role) - 1] = '\0';
            diCh[i].faultCode[sizeof(diCh[i].faultCode) - 1] = '\0';
            diCh[i].faultMsg[sizeof(diCh[i].faultMsg) - 1] = '\0';
            {
                // Accept out-of-range active_modes and mask to the 5 valid
                // SysMode bits instead of failing the whole config.
                int am = ch["active_modes"].isNull() ? 0x1F : ch["active_modes"].as<int>();
                if (!ch["active_modes"].isNull() && (am < 0 || am > 0x1F)) {
                    Serial.printf("[HWCfg] WARNING: DI%d active_modes %d out of range - masked to 0x1F\n",
                                  i + 1, am);
                }
                diCh[i].activeModes = (uint8_t)(am & 0x1F);
            }
            i++;
        }
    }
    auto registryDiRole = [](const char* role) {
        return role &&
               (strcmp(role, "fault") == 0 ||
                strcmp(role, "estop") == 0 ||
                strcmp(role, "inhibit_start") == 0 ||
                strcmp(role, "low_oil_switch") == 0 ||
                strcmp(role, "oil_zero_switch") == 0 ||
                strcmp(role, "sequence_gate") == 0 ||
                strcmp(role, "ab_arm") == 0 ||
                strcmp(role, "ab_fire") == 0 ||
                strcmp(role, "limp_mode") == 0);
    };
    auto diPinAlreadyMapped = [](int pin) {
        for (int i = 0; i < MAX_DI; ++i)
            if (pin >= 0 && diCh[i].pin == pin) return true;
        return false;
    };
    for (uint8_t ri = 0; ri < channelRegistry.inputCount; ++ri) {
        const auto& c = channelRegistry.inputs[ri];
        if (!c.installed || c.pin < 0 || c.driver != ChannelRegistry::Digital ||
            !registryDiRole(c.role) || diPinAlreadyMapped(c.pin)) continue;
        for (int di = 0; di < MAX_DI; ++di) {
            if (diCh[di].pin >= 0) continue;
            diCh[di] = DiChannel{};
            diCh[di].pin = c.pin;
            diCh[di].activeH = c.activeHigh;
            diCh[di].debounceMs = 20;
            strlcpy(diCh[di].label, c.name[0] ? c.name : c.id, sizeof(diCh[di].label));
            strlcpy(diCh[di].role, c.role, sizeof(diCh[di].role));
            if (strcmp(c.role, "fault") == 0)
                strlcpy(diCh[di].faultCode, c.id, sizeof(diCh[di].faultCode));
            diCh[di].activeModes = 0x1F;
            break;
        }
    }

    if (n1RpmPpr <= 0.0f) n1RpmPpr = 1.0f;
    if (n2RpmPpr <= 0.0f) n2RpmPpr = 1.0f;
    if (igniterDwellMs < 1) igniterDwellMs = 1;
    if (igniterRestMs < 1) igniterRestMs = 1;
    if (igniter2DwellMs < 1) igniter2DwellMs = 1;
    if (igniter2RestMs < 1) igniter2RestMs = 1;
    if (mavlinkIntervalMs < 20) mavlinkIntervalMs = 100;
    if (clusterIntervalMs < 10) clusterIntervalMs = 50;
    abTriggerSource = constrain(abTriggerSource, 0, 3);
    abInputThreshold = constrain(abInputThreshold, 0, 4095);
    if (abTriggerSource == 0) abRequiresArmSwitch = false;
    starterEnDelayMs = constrain(starterEnDelayMs, 0, 30000);
    if (fuelFlowType < 0 || fuelFlowType > 1) fuelFlowType = 0;
    auto validTcChipName = [](const char* chip) {
        return strcmp(chip, "max6675") == 0 ||
               strcmp(chip, "max31855") == 0 ||
               strcmp(chip, "max31856") == 0;
    };
    auto setChip = [](char* dst, size_t len, const char* value) {
        strncpy(dst, value, len - 1);
        dst[len - 1] = '\0';
    };
    if (!validTcChipName(totChip)) setChip(totChip, sizeof(totChip), "max6675");
    if (!validTcChipName(titChip)) setChip(titChip, sizeof(titChip), "max6675");
    if (!(strcmp(oilTempChip, "ntc") == 0 ||
          strcmp(oilTempChip, "ds18b20") == 0 ||
          validTcChipName(oilTempChip))) {
        setChip(oilTempChip, sizeof(oilTempChip), "ntc");
    }
    throttleType = constrain(throttleType, 0, 2);
    starterType = constrain(starterType, 0, 2);
    oilPumpType = constrain(oilPumpType, 0, 2);
    coolFanType = constrain(coolFanType, 0, 2);
    abPumpType = constrain(abPumpType, 0, 2);
    oilScavPumpType = constrain(oilScavPumpType, 0, 2);
    fuelPump2Type = constrain(fuelPump2Type, 0, 2);
    bleedValveType = constrain(bleedValveType, 0, 2);
    propPitchType = constrain(propPitchType, 0, 2);
    if (fuelFlowPulsesPerLitre <= 0.0f) fuelFlowPulsesPerLitre = 100.0f;
    if (oilTempResolution < 9 || oilTempResolution > 12) oilTempResolution = 10;
    if (ntcBeta < 1000.0f || ntcBeta > 10000.0f) ntcBeta = 3950.0f;
    if (ntcR0 < 100.0f || ntcR0 > 1000000.0f) ntcR0 = 10000.0f;
    if (ntcRFixed < 100.0f || ntcRFixed > 1000000.0f) ntcRFixed = 10000.0f;

    auto sanitizePwm = [](int& freqHz, int& resBits, int defaultFreq, int defaultBits) {
        if (freqHz < 1) freqHz = defaultFreq;
        if (resBits < 8 || resBits > 14) resBits = defaultBits;
    };
    sanitizePwm(throttleLedcFreqHz, throttleLedcBits, 5000, 12);
    sanitizePwm(starterLedcFreqHz, starterLedcBits, 5000, 12);
    sanitizePwm(oilPumpFreqHz, oilPumpResBits, 5000, 12);
    sanitizePwm(coolFanFreqHz, coolFanResBits, 5000, 12);
    sanitizePwm(abPumpFreqHz, abPumpResBits, 5000, 12);
    sanitizePwm(oilScavPumpFreqHz, oilScavPumpResBits, 5000, 12);
    sanitizePwm(fuelPump2FreqHz, fuelPump2ResBits, 5000, 12);
    sanitizePwm(bleedValveFreqHz, bleedValveResBits, 5000, 10);
    sanitizePwm(propPitchFreqHz, propPitchResBits, 5000, 10);
    sanitizePwm(glowPlugFreqHz, glowPlugResBits, 1000, 8);
    sanitizePwm(wetGlowFuelFreqHz, wetGlowFuelResBits, 1000, 10);

    auto sanitizePwmRange = [](float& minPct, float& maxPct) {
        minPct = constrain(minPct, 0.0f, 100.0f);
        maxPct = constrain(maxPct, 0.0f, 100.0f);
        if (maxPct < minPct) {
            minPct = 0.0f;
            maxPct = 100.0f;
        }
    };
    sanitizePwmRange(throttlePwmMinPct, throttlePwmMaxPct);
    sanitizePwmRange(starterPwmMinPct, starterPwmMaxPct);
    sanitizePwmRange(oilPumpPwmMinPct, oilPumpPwmMaxPct);
    sanitizePwmRange(coolFanPwmMinPct, coolFanPwmMaxPct);
    sanitizePwmRange(abPumpPwmMinPct, abPumpPwmMaxPct);
    sanitizePwmRange(oilScavPumpPwmMinPct, oilScavPumpPwmMaxPct);
    sanitizePwmRange(fuelPump2PwmMinPct, fuelPump2PwmMaxPct);
    sanitizePwmRange(bleedValvePwmMinPct, bleedValvePwmMaxPct);
    sanitizePwmRange(propPitchPwmMinPct, propPitchPwmMaxPct);
    sanitizePwmRange(glowPlugPwmMinPct, glowPlugPwmMaxPct);
    sanitizePwmRange(wetGlowFuelPwmMinPct, wetGlowFuelPwmMaxPct);
    for (int i = 0; i < MAX_DI; i++) {
        if (!(strcmp(diCh[i].role, "none") == 0 ||
              strcmp(diCh[i].role, "fault") == 0 ||
              strcmp(diCh[i].role, "estop") == 0 ||
              strcmp(diCh[i].role, "inhibit_start") == 0 ||
              strcmp(diCh[i].role, "low_oil_switch") == 0 ||
              strcmp(diCh[i].role, "oil_zero_switch") == 0 ||
              strcmp(diCh[i].role, "sequence_gate") == 0 ||
              strcmp(diCh[i].role, "ab_arm") == 0 ||
              strcmp(diCh[i].role, "ab_fire") == 0 ||
              strcmp(diCh[i].role, "limp_mode") == 0)) {
            strncpy(diCh[i].role, "none", sizeof(diCh[i].role) - 1);
            diCh[i].role[sizeof(diCh[i].role) - 1] = '\0';
        }
        if (diCh[i].debounceMs < 5 || diCh[i].debounceMs > 500) diCh[i].debounceMs = 20;
        diCh[i].activeModes &= 0x1F;
    }

    auto sanitizeServoRange = [](int& minUs, int& maxUs) {
        minUs = constrain(minUs, 500, 2500);
        maxUs = constrain(maxUs, 500, 2500);
        if (maxUs <= minUs) {
            minUs = 1000;
            maxUs = 2000;
        }
    };
    sanitizeServoRange(throttleMinUs, throttleMaxUs);
    sanitizeServoRange(starterMinUs, starterMaxUs);
    sanitizeServoRange(oilPumpMinUs, oilPumpMaxUs);
    sanitizeServoRange(coolFanMinUs, coolFanMaxUs);
    sanitizeServoRange(abPumpMinUs, abPumpMaxUs);
    sanitizeServoRange(abInputMinUs, abInputMaxUs);
    sanitizeServoRange(oilScavPumpMinUs, oilScavPumpMaxUs);
    sanitizeServoRange(fuelPump2MinUs, fuelPump2MaxUs);
    sanitizeServoRange(bleedValveMinUs, bleedValveMaxUs);
    sanitizeServoRange(propPitchMinUs, propPitchMaxUs);

    if (oilLoopCount == 0 && hasOilLoop && hasOilPress && hasOilPump) {
        const ChannelRegistry::Channel* pressure = channelRegistry.find("oil_pressure_main", ChannelRegistry::Input);
        const ChannelRegistry::Channel* pump = channelRegistry.find("oil_pump_main", ChannelRegistry::Output);
        if (!pressure) {
            uint8_t matches = 0;
            for (uint8_t i = 0; i < channelRegistry.inputCount; i++) {
                const auto& candidate = channelRegistry.inputs[i];
                if (!candidate.installed || strcmp(candidate.purpose, "oil_pressure")) continue;
                pressure = &candidate;
                ++matches;
            }
            if (matches != 1) pressure = nullptr;
        }
        // A migrated legacy loop may inherit the explicitly selected primary
        // oil pump (or the sole pump), but never whichever card happens first.
        if (!pump || !channelRegistry.ownsCoreOutput(*pump)) {
            pump = nullptr;
            for (uint8_t i = 0; i < channelRegistry.outputCount; i++) {
                const auto& candidate = channelRegistry.outputs[i];
                if (candidate.installed && !candidate.mirrorOf[0] &&
                    !strcmp(candidate.purpose, "oil_pump") &&
                    channelRegistry.ownsCoreOutput(candidate)) {
                    pump = &candidate;
                    break;
                }
            }
        }
        if (pressure && pump) {
            OilLoopDef& l = oilLoops[oilLoopCount++];
            l.enabled = true;
            strlcpy(l.id, "main_oil_loop", sizeof(l.id));
            l.pressureInputIndex = (uint8_t)(pressure - channelRegistry.inputs);
            l.pumpOutputIndex = (uint8_t)(pump - channelRegistry.outputs);
            l.targetSource = Config::oilUseThrottleMap ? 1 : 0;
            l.targetCentiBar = (uint16_t)constrain((int)(Config::oilMapMin * 100.0f), 0, 2000);
            l.targetHighCentiBar = (uint16_t)constrain((int)(Config::oilMapMax * 100.0f), 0, 2000);
            l.deadbandCentiBar = (uint16_t)constrain((int)(Config::oilPressureDeadband * 100.0f), 0, 500);
            l.lowPressureCentiBar = (uint16_t)constrain((int)(Config::oilRunningMin * 100.0f), 0, 2000);
            l.lowPressureConfirmMs = (uint16_t)constrain((int)Config::lowOilConfirmMs, 0, 60000);
            l.lowPressureResponse = safetyLowOil ? OilFaultShutdown : OilFaultDisabled;
            l.feedbackLossResponse = OilFaultShutdown;
            l.immediatePumpRunDeciSec = 100;
            l.failsafeDelayMs = (uint16_t)constrain(Config::oilFailsafeDelayMs, 0, 60000);
            l.failsafeDemandPct = (uint8_t)constrain((int)Config::oilFailsafePct, 0, 100);
            l.minDemandPct = (uint8_t)constrain((int)Config::oilMinPct, 0, 100);
            l.maxDemandPct = 100;
        }
    }
}

void HardwareConfig::applyValidatedJsonRuntimeOnly(const JsonDocument& doc) {
    _fromDoc(doc);
}
