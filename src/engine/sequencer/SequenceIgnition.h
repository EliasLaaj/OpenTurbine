#pragma once

#include "../EngineData.h"
#include "../../system/HardwareConfig.h"
#include "../../system/RulesEngine.h"

inline void setSequenceIgnitionTracked(int8_t outputIndex, bool active) {
    if (outputIndex < 0 || outputIndex >= ChannelRegistry::MAX_OUTPUT_CHANNELS) return;
    auto& ed = EngineData::instance();
    const uint16_t bit = (uint16_t)1U << outputIndex;
    if (active) ed.sequenceIgnitionMask |= bit;
    else ed.sequenceIgnitionMask &= (uint16_t)~bit;
}

inline void clearSequenceIgnitionOutputs() {
    auto& ed = EngineData::instance();
    const uint16_t mask = ed.sequenceIgnitionMask;
    ed.sequenceIgnitionMask = 0;
    for (uint8_t i = 0; i < HardwareConfig::channelRegistry.outputCount && i < 16; ++i) {
        if (!(mask & ((uint16_t)1U << i))) continue;
        const auto& output = HardwareConfig::channelRegistry.outputs[i];
        // A core-owned registry channel is refreshed from its legacy demand
        // field at the actuator boundary. Clear that field with the exact
        // tracked device so it cannot reassert on the following tick.
        if (HardwareConfig::channelRegistry.ownsCoreOutput(output)) {
            if (!strcmp(output.purpose, "igniter")) ed.igniterOn = false;
            else if (!strcmp(output.purpose, "ab_igniter")) ed.igniter2On = false;
            else if (!strcmp(output.purpose, "glow_plug")) ed.glowPlugDemand = 0.0f;
        }
        const int8_t actuator = HardwareConfig::outputActuatorForId(output.id);
        if (actuator >= 0) RulesEngine::applyActuatorDemand((uint8_t)actuator, 0.0f);
    }
}
