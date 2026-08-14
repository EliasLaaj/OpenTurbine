#pragma once
#include "../hal/actuators/RelayDemand.h"

#include "HardwareConfig.h"
#include "Config.h"
#include "../engine/EngineData.h"
#include <Arduino.h>
#include <string.h>

// Canonical logical demand lookup for every physical output. Core actuators
// use EngineData's authoritative demand; non-core channels use the registry
// demand array. Web/OTA/START gates must use this instead of maintaining a
// second, legacy-only list of outputs.
namespace OutputActivity {
    inline bool hasPhysicalEndpoint(const ChannelRegistry::Channel& c);
    inline float logicalDemand(const ChannelRegistry::Channel& c, uint8_t index,
                               const EngineData& ed);
    inline const char* firstPhysicalDemand(bool allowStandbyOilFeed = false) {
        const auto& ed = EngineData::instance();
        const auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            const auto& c = reg.outputs[i];
            if (!hasPhysicalEndpoint(c)) continue;
            const float demand = logicalDemand(c, i, ed);
            if (!RelayDemand::requested(demand)) continue;
            // A propeller actuator may intentionally park at a non-zero
            // semantic position in STANDBY. That is its neutral/safe state,
            // not an outstanding tool or engine demand; otherwise START,
            // OTA, configuration reboot, and restore can never proceed on a
            // correctly parked turboprop installation.
            if (!strcmp(c.purpose, "prop_pitch")) {
                const float parked = constrain(c.safeDemand, 0.0f, 1.0f);
                if (demand >= parked - 0.001f && demand <= parked + 0.001f) continue;
            }
            if (allowStandbyOilFeed && ed.standbyOilFeedActive && !strcmp(c.purpose, "oil_pump") &&
                demand <= constrain(Config::standbyOilFeedPct / 100.0f + 0.005f, 0.0f, 1.0f)) continue;
            return c.name[0] ? c.name : (c.id[0] ? c.id : c.purpose);
        }
        if (ed.extraCooldownActive) return "extra cooldown";
        if (ed.standbyOilFeedActive && !allowStandbyOilFeed) return "protective standby lubrication";
        return nullptr;
    }

    inline bool hasPhysicalEndpoint(const ChannelRegistry::Channel& c) {
        if (!c.installed) return false;
        if (c.driver == ChannelRegistry::I2cDigital ||
            c.driver == ChannelRegistry::I2cRelay)
            return c.i2cAddress != 0;
        return c.pin >= 0;
    }

    inline float logicalDemand(const ChannelRegistry::Channel& c, uint8_t index,
                               const EngineData& ed) {
        const char* p = c.purpose;
        const auto& reg = HardwareConfig::channelRegistry;
        const bool core = reg.ownsCoreOutput(c) || reg.boundToCoreOutput(c);
        if (core) {
            if (!strcmp(p, "main_fuel"))       return ed.throttleDemand;
            if (!strcmp(p, "fuel_shutoff"))    return ed.fuelSolOpen ? 1.0f : 0.0f;
            if (!strcmp(p, "starter"))         return ed.starterDemand;
            if (!strcmp(p, "starter_enable"))  return ed.starterEnabled ? 1.0f : 0.0f;
            if (!strcmp(p, "oil_pump"))        return ed.oilPumpPct / 100.0f;
            if (!strcmp(p, "scavenge_pump"))   return ed.oilScavengeDemand;
            if (!strcmp(p, "cooling_fan"))     return ed.coolFanDemand;
            if (!strcmp(p, "fuel_pump"))       return ed.fuelPump2Demand;
            if (!strcmp(p, "igniter"))         return ed.igniterOn ? 1.0f : 0.0f;
            if (!strcmp(p, "ab_igniter"))      return ed.igniter2On ? 1.0f : 0.0f;
            if (!strcmp(p, "ab_valve"))        return ed.abSolOpen ? 1.0f : 0.0f;
            if (!strcmp(p, "ab_pump"))         return ed.abPumpDemand;
            if (!strcmp(p, "prop_pitch"))      return ed.propPitchDemand;
            if (!strcmp(p, "air_starter"))     return ed.airstarterOpen ? 1.0f : 0.0f;
            if (!strcmp(p, "bleed_valve") || !strcmp(c.id, "bleed_valve"))
                return ed.bleedValveDemand;
            if (!strcmp(p, "glow_plug"))       return ed.glowPlugDemand;
        }
        if (!strcmp(p, "wet_glow_fuel"))   return ed.wetGlowFuelDemand;
        return index < ChannelRegistry::MAX_OUTPUT_CHANNELS ? ed.registryOutputDemand[index] : 0.0f;
    }

    inline bool anyPhysicalDemand(bool allowStandbyOilFeed = false) {
        return firstPhysicalDemand(allowStandbyOilFeed) != nullptr;
    }
}
