#pragma once

#include "Config.h"
#include "HardwareConfig.h"
#include <string.h>

// Feedback is operationally required only when an enabled protection,
// controller, or configured startup block consumes it. Merely fitting a
// telemetry sensor must never block START, cap fuel, or latch limp mode.
namespace FeedbackRequirements {
    enum Sensor : uint32_t {
        NONE          = 0,
        N1            = 1UL << 0,
        N2            = 1UL << 1,
        EGT           = 1UL << 2,
        P1            = 1UL << 3,
        P2            = 1UL << 4,
        TORQUE        = 1UL << 5,
        OIL_PRESSURE  = 1UL << 6,
        OIL_TEMP      = 1UL << 7,
        FUEL_PRESSURE = 1UL << 8,
        BATTERY       = 1UL << 9,
        FLAME         = 1UL << 10,
        THROTTLE      = 1UL << 11,
        IDLE          = 1UL << 12,
        GLOW_CURRENT  = 1UL << 13
    };

    inline bool isOverridden(const EngineData& ed, Sensor sensor) {
        return (ed.limpOverrideSensor & (uint32_t)sensor) != 0;
    }

    inline const char* sensorName(uint32_t sensor) {
        switch (sensor) {
            case N1: return "N1 speed";
            case N2: return "N2 speed";
            case EGT: return "engine temperature";
            case P1: return "Pressure 1";
            case P2: return "Pressure 2";
            case TORQUE: return "torque";
            case OIL_PRESSURE: return "oil pressure";
            case OIL_TEMP: return "oil temperature";
            case FUEL_PRESSURE: return "fuel pressure";
            case BATTERY: return "supply voltage";
            case FLAME: return "flame";
            case THROTTLE: return "throttle input";
            case IDLE: return "idle input";
            case GLOW_CURRENT: return "glow current";
            default: return "unknown sensor";
        }
    }

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
        bool oilTargetUsesN1 = false;
        if (HardwareConfig::hasOilLoop) {
            for (uint8_t i = 0; i < HardwareConfig::oilLoopCount; ++i)
                if (HardwareConfig::oilLoops[i].enabled && HardwareConfig::oilLoops[i].targetSource == 2) {
                    oilTargetUsesN1 = true; break;
                }
        }
        return HardwareConfig::safetyOverspeed || HardwareConfig::safetySurge ||
               (HardwareConfig::hasN1Rpm && Config::minRpm > 0.0f) ||
               (HardwareConfig::safetyFlameout && effectiveFlameoutSource() == 2) ||
               (HardwareConfig::hasDynamicIdle && HardwareConfig::hasN1Rpm && Config::idleSource == 0) ||
               (HardwareConfig::hasThrottle && HardwareConfig::hasN1Rpm && Config::pullbackN1Enabled &&
                Config::pullbackN1HardRpm > Config::pullbackN1SoftRpm) || oilTargetUsesN1;
    }

    inline bool n2ForProtectionOrControl() {
        bool oilTargetUsesN2 = false;
        if (HardwareConfig::hasOilLoop) {
            for (uint8_t i = 0; i < HardwareConfig::oilLoopCount; ++i)
                if (HardwareConfig::oilLoops[i].enabled && HardwareConfig::oilLoops[i].targetSource == 3) {
                    oilTargetUsesN2 = true; break;
                }
        }
        return HardwareConfig::safetyN2Overspeed || HardwareConfig::hasGovernor ||
               (HardwareConfig::hasDynamicIdle && HardwareConfig::hasN2Rpm && Config::idleSource == 1) ||
               (HardwareConfig::hasThrottle && HardwareConfig::hasN2Rpm && Config::pullbackN2Enabled &&
                Config::pullbackN2HardRpm > Config::pullbackN2SoftRpm) || oilTargetUsesN2;
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
    inline uint32_t requiredStartFailureMask(const EngineData& ed, uint32_t now) {
        uint32_t failed = NONE;
        if (n1ForStart() && (!HardwareConfig::hasN1Rpm || !ed.n1Healthy || now - ed.n1SampleMs > 500UL))
            failed |= N1;
        if (n2ForStart() && (!HardwareConfig::hasN2Rpm || !ed.n2Healthy || now - ed.n2SampleMs > 500UL))
            failed |= N2;
        if ((p1ForProtectionOrControl() || (startupHas("SafetyHold") && Config::safetyHoldCheckP1)) &&
            (!HardwareConfig::hasP1 || !ed.p1Healthy)) failed |= P1;
        if ((p2ForProtectionOrControl() || (startupHas("SafetyHold") && Config::safetyHoldCheckP2)) &&
            (!HardwareConfig::hasP2 || !ed.p2Healthy)) failed |= P2;
        if (torqueForProtectionOrControl() && (!HardwareConfig::hasTorque || !ed.torqueHealthy)) failed |= TORQUE;
        if (egtForStart()) {
            const uint32_t sampleMs = Config::effectiveEgtSource() == 2 ? ed.titSampleMs : ed.totSampleMs;
            if (Config::effectiveEgtSource() == 0 || !Config::primaryEgtHealthy(ed) ||
                now - sampleMs > 1000UL) failed |= EGT;
        }
        if (oilPressureForStart() && !ed.oilHealthy) failed |= OIL_PRESSURE;
        if (!allOilLoopFeedbackHealthy(ed)) failed |= OIL_PRESSURE;
        if (HardwareConfig::safetyOilTempHigh && HardwareConfig::hasOilTemp && !ed.oilTempHealthy) failed |= OIL_TEMP;
        if (HardwareConfig::safetyFuelPressLow && HardwareConfig::hasFuelPress && !ed.fuelPressHealthy) failed |= FUEL_PRESSURE;
        if (HardwareConfig::safetyBattLow && HardwareConfig::hasBattVoltage && !ed.battHealthy) failed |= BATTERY;
        if (flameForStart() && !ed.flameHealthy) failed |= FLAME;
        if (HardwareConfig::hasThrottleInput && !ed.throttleInputValid) failed |= THROTTLE;
        if (HardwareConfig::hasIdleInput &&
            (startupHas("FuelPumpIdle") || startupHas("ModifiedIdle")) && !ed.idleInputValid) failed |= IDLE;
        if (Config::glowWaitUntilHot && startupHas("GlowPreheat") &&
            (!HardwareConfig::hasGlowCurrentSensor || !ed.glowCurrentHealthy)) failed |= GLOW_CURRENT;
        return failed;
    }

    inline bool allRequiredStartFeedbackHealthy(const EngineData& ed, uint32_t now) {
        return requiredStartFailureMask(ed, now) == NONE;
    }

    inline bool startupConsumes(uint32_t sensor) {
        switch (sensor) {
            case N1:
                return startupHas("StarterSpin") || startupHas("Spool") ||
                       (startupHas("SafetyHold") && Config::safetyHoldCheckN1);
            case N2:
                return startupHas("GovernorHold") ||
                       (startupHas("SafetyHold") && Config::safetyHoldCheckN2);
            case EGT:
                return startupHas("TempConfirm") || startupHas("WaitTOTCool") ||
                       (startupHas("SafetyHold") && Config::safetyHoldCheckEgt);
            case P1: return startupHas("SafetyHold") && Config::safetyHoldCheckP1;
            case P2: return startupHas("SafetyHold") && Config::safetyHoldCheckP2;
            case OIL_PRESSURE:
                return startupHas("OilPrime") ||
                       (startupHas("SafetyHold") && Config::safetyHoldCheckOil);
            case FLAME:
                return startupHas("FlameConfirm") ||
                       (startupHas("SafetyHold") && Config::safetyHoldCheckFlame);
            default: return false;
        }
    }

    inline uint32_t eligibleSingleStartOverride(const EngineData& ed, uint32_t now) {
        const uint32_t failed = requiredStartFailureMask(ed, now);
        if (failed == NONE || (failed & (failed - 1UL)) != 0) return NONE;
        if (failed == THROTTLE || failed == IDLE || failed == GLOW_CURRENT) return NONE;
        if (failed == OIL_PRESSURE && HardwareConfig::hasOilLoop) return NONE;
        if (startupConsumes(failed)) return NONE;
        return failed;
    }

    inline uint32_t protectionFailureMask(const EngineData& ed, uint32_t now) {
        uint32_t failed = NONE;
        if (n1ForProtectionOrControl() &&
            (!HardwareConfig::hasN1Rpm || !ed.n1Healthy || now - ed.n1SampleMs > 500UL)) failed |= N1;
        if (n2ForProtectionOrControl() &&
            (!HardwareConfig::hasN2Rpm || !ed.n2Healthy || now - ed.n2SampleMs > 500UL)) failed |= N2;
        if (egtForProtectionOrControl()) {
            const uint32_t sampleMs = Config::effectiveEgtSource() == 2 ? ed.titSampleMs : ed.totSampleMs;
            if (Config::effectiveEgtSource() == 0 || !Config::primaryEgtHealthy(ed) ||
                now - sampleMs > 1000UL) failed |= EGT;
        }
        if (p1ForProtectionOrControl() && !ed.p1Healthy) failed |= P1;
        if (p2ForProtectionOrControl() && !ed.p2Healthy) failed |= P2;
        if (torqueForProtectionOrControl() && !ed.torqueHealthy) failed |= TORQUE;
        if ((HardwareConfig::safetyLowOil || HardwareConfig::safetyOilZero) &&
            HardwareConfig::hasOilPress && !ed.oilHealthy) failed |= OIL_PRESSURE;
        if (HardwareConfig::hasOilLoop && !allOilLoopFeedbackHealthy(ed)) failed |= OIL_PRESSURE;
        if (HardwareConfig::safetyOilTempHigh && HardwareConfig::hasOilTemp && !ed.oilTempHealthy) failed |= OIL_TEMP;
        if (HardwareConfig::safetyFuelPressLow && HardwareConfig::hasFuelPress && !ed.fuelPressHealthy) failed |= FUEL_PRESSURE;
        if (HardwareConfig::safetyBattLow && HardwareConfig::hasBattVoltage && !ed.battHealthy) failed |= BATTERY;
        if (HardwareConfig::safetyFlameout && effectiveFlameoutSource() == 1 &&
            HardwareConfig::hasFlame && !ed.flameHealthy) failed |= FLAME;
        if (HardwareConfig::hasThrottleInput && !ed.throttleInputValid) failed |= THROTTLE;
        return failed;
    }
}
