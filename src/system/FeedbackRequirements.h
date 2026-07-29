#pragma once

#include "Config.h"
#include "HardwareConfig.h"
#include <string.h>

// Feedback is operationally required only when an enabled protection,
// controller, or configured startup block consumes it. Merely fitting a
// telemetry sensor must never block START, cap fuel, or latch limp mode.
namespace FeedbackRequirements {
    inline bool startupHas(const char* name) {
        for (int i = 0; i < HardwareConfig::startupSeqLen; ++i)
            if (!strcmp(HardwareConfig::startupSeq[i], name)) return true;
        return false;
    }

    inline int effectiveFlameoutSource() {
        if (Config::flameoutSource >= 1 && Config::flameoutSource <= 3)
            return Config::flameoutSource;
        if (HardwareConfig::hasFlame) return 1;
        if (HardwareConfig::hasN1Rpm) return 2;
        if (Config::effectiveEgtSource() != 0) return 3;
        return 0;
    }

    inline bool n1ForProtectionOrControl() {
        return HardwareConfig::safetyOverspeed || HardwareConfig::safetySurge ||
               (HardwareConfig::hasN1Rpm && Config::minRpm > 0.0f) ||
               (HardwareConfig::safetyFlameout && effectiveFlameoutSource() == 2) ||
               (HardwareConfig::hasDynamicIdle && HardwareConfig::hasN1Rpm && Config::idleSource == 0) ||
               (HardwareConfig::hasThrottle && HardwareConfig::hasN1Rpm && Config::pullbackN1Enabled &&
                Config::pullbackN1HardRpm > Config::pullbackN1SoftRpm);
    }

    inline bool n2ForProtectionOrControl() {
        return HardwareConfig::safetyN2Overspeed || HardwareConfig::hasGovernor ||
               (HardwareConfig::hasDynamicIdle && HardwareConfig::hasN2Rpm && Config::idleSource == 1) ||
               (HardwareConfig::hasThrottle && HardwareConfig::hasN2Rpm && Config::pullbackN2Enabled &&
                Config::pullbackN2HardRpm > Config::pullbackN2SoftRpm);
    }

    inline bool egtForProtectionOrControl() {
        return HardwareConfig::safetyOvertemp || HardwareConfig::safetyHotStart ||
               (HardwareConfig::safetyFlameout && effectiveFlameoutSource() == 3) ||
               (HardwareConfig::hasThrottle && Config::effectiveEgtSource() != 0 && Config::pullbackEgtEnabled &&
                Config::pullbackEgtHardC > Config::pullbackEgtSoftC);
    }

    inline bool p1ForProtectionOrControl() {
        return HardwareConfig::hasP1 &&
            ((Config::pullbackP1Enabled && Config::pullbackP1Hard > Config::pullbackP1Soft) ||
             Config::p1TripLimit > 0.0f || (HardwareConfig::hasDynamicIdle && Config::idleSource == 2));
    }
    inline bool p2ForProtectionOrControl() {
        return HardwareConfig::hasP2 &&
            ((Config::pullbackP2Enabled && Config::pullbackP2Hard > Config::pullbackP2Soft) ||
             Config::p2TripLimit > 0.0f || (HardwareConfig::hasDynamicIdle && Config::idleSource == 3));
    }
    inline bool torqueForProtectionOrControl() {
        return HardwareConfig::hasTorque &&
            ((Config::pullbackTorqueEnabled && Config::pullbackTorqueHard > Config::pullbackTorqueSoft) ||
             Config::torqueTripLimit > 0.0f);
    }

    inline bool n1ForStart() {
        return n1ForProtectionOrControl() || startupHas("StarterSpin") ||
               startupHas("Spool") || (startupHas("SafetyHold") && Config::safetyHoldCheckN1);
    }
    inline bool n2ForStart() {
        return n2ForProtectionOrControl() || startupHas("GovernorHold") ||
               (startupHas("SafetyHold") && Config::safetyHoldCheckN2);
    }
    inline bool egtForStart() {
        return egtForProtectionOrControl() || startupHas("TempConfirm") ||
               startupHas("WaitTOTCool") || (startupHas("SafetyHold") && Config::safetyHoldCheckEgt);
    }

    inline bool oilPressureForStart() {
        if (!HardwareConfig::hasOilPress) return false;
        return HardwareConfig::safetyLowOil || HardwareConfig::safetyOilZero ||
               HardwareConfig::hasOilLoop || startupHas("OilPrime") ||
               (startupHas("SafetyHold") && Config::safetyHoldCheckOil);
    }

    inline bool flameForStart() {
        return HardwareConfig::hasFlame &&
               (startupHas("FlameConfirm") || (startupHas("SafetyHold") && Config::safetyHoldCheckFlame) ||
                (HardwareConfig::safetyFlameout && effectiveFlameoutSource() == 1));
    }

    inline bool allOilLoopFeedbackHealthy(const EngineData& ed) {
        if (!HardwareConfig::hasOilLoop) return true;
        bool foundEnabledLoop = false;
        for (uint8_t i = 0; i < HardwareConfig::oilLoopCount; ++i) {
            const auto& loop = HardwareConfig::oilLoops[i];
            if (!loop.enabled) continue;
            foundEnabledLoop = true;
            if (loop.pressureInputIndex >= HardwareConfig::channelRegistry.inputCount ||
                loop.pressureInputIndex >= ChannelRegistry::MAX_INPUT_CHANNELS ||
                !ed.registryInputHealthy[loop.pressureInputIndex]) return false;
        }
        // Legacy profiles may enable the controller before an explicit registry
        // oil-loop entry has been migrated. Its authoritative feedback is the
        // primary oil-pressure sensor.
        return foundEnabledLoop || (HardwareConfig::hasOilPress && ed.oilHealthy);
    }

    // Telemetry-only sensors are intentionally absent. Every member of this
    // set is consumed by an enabled safety, controller, or startup block.
    inline bool allRequiredStartFeedbackHealthy(const EngineData& ed, uint32_t now) {
        if (n1ForStart() && (!HardwareConfig::hasN1Rpm || !ed.n1Healthy || now - ed.n1SampleMs > 500UL))
            return false;
        if (n2ForStart() && (!HardwareConfig::hasN2Rpm || !ed.n2Healthy || now - ed.n2SampleMs > 500UL))
            return false;
        if ((p1ForProtectionOrControl() || (startupHas("SafetyHold") && Config::safetyHoldCheckP1)) &&
            (!HardwareConfig::hasP1 || !ed.p1Healthy)) return false;
        if ((p2ForProtectionOrControl() || (startupHas("SafetyHold") && Config::safetyHoldCheckP2)) &&
            (!HardwareConfig::hasP2 || !ed.p2Healthy)) return false;
        if (torqueForProtectionOrControl() && (!HardwareConfig::hasTorque || !ed.torqueHealthy)) return false;
        if (egtForStart()) {
            const uint32_t sampleMs = Config::effectiveEgtSource() == 2 ? ed.titSampleMs : ed.totSampleMs;
            if (Config::effectiveEgtSource() == 0 || !Config::primaryEgtHealthy(ed) ||
                now - sampleMs > 1000UL) return false;
        }
        if (oilPressureForStart() && !ed.oilHealthy) return false;
        if (!allOilLoopFeedbackHealthy(ed)) return false;
        if (HardwareConfig::safetyOilTempHigh && HardwareConfig::hasOilTemp && !ed.oilTempHealthy) return false;
        if (HardwareConfig::safetyFuelPressLow && HardwareConfig::hasFuelPress && !ed.fuelPressHealthy) return false;
        if (HardwareConfig::safetyBattLow && HardwareConfig::hasBattVoltage && !ed.battHealthy) return false;
        if (flameForStart() && !ed.flameHealthy) return false;
        if (HardwareConfig::hasThrottleInput && !ed.throttleInputValid) return false;
        if (HardwareConfig::hasIdleInput &&
            (startupHas("FuelPumpIdle") || startupHas("ModifiedIdle")) && !ed.idleInputValid) return false;
        if (Config::glowWaitUntilHot && startupHas("GlowPreheat") &&
            (!HardwareConfig::hasGlowCurrentSensor || !ed.glowCurrentHealthy)) return false;
        return true;
    }
}
