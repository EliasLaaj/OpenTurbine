#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/Config.h"
#include "../../../system/FlightRecorder.h"
#include "../../../system/HardwareConfig.h"
#include <Arduino.h>

// Spin starter motor and/or run oil pump to cool EGT below safe storage temperature.
// Exits when selected engine temperature source is below target OR timeout.
// If oil pressure sensor is configured, drives the pump via a simple P-controller
// targeting oilPressureTarget bar instead of a fixed percentage.
class CooldownSpin : public IBlock {
public:
    float         totTarget          = 150.0f;
    float         starterCoolPct     = 0.40f;  // 40% starter speed
    float         oilCoolPct         = 30.0f;  // direct oil pump % (no pressure sensor)
    float         oilPressureTarget  = 2.0f;   // bar target (used when oil pressure sensor present)
    float         oilMinPct          = 5.0f;
    float         oilMaxPct          = 100.0f;
    float         oilDeadbandBar     = 0.2f;
    float         oilAdjustScale     = 0.15f;
    float         oilFailsafePct     = 30.0f;
    unsigned long oilFailsafeDelayMs = 1000;
    bool          oilPumpBinary      = false;
    uint8_t       pressureInputIndex = 255;    // primary configured oil-loop input
    unsigned long timeoutMs          = 60000;  // 60 s default
    bool          useScavengePump = false;   // also run scavenge pump during cooldown

    const char* name() override { return "CooldownSpin"; }

    void onEnter() override {
        _entryMs       = millis();
        _lastTickMs    = _entryMs;
        _oilFeedbackLostMs = 0;
        _oilWarnLogged = false;
        auto& ed = EngineData::instance();

        // Skip immediately if fuel was never opened (no combustion = no hot EGT to cool)
        // Also skip in bench mode — no real heat was generated, no need to wait
        if (!ed.combustionAttempted || ed.benchMode) {
            _skip = true;
            return;
        }
        _skip = false;

        if (HardwareConfig::hasStarter && Config::cooldownUseStarter) {
            ed.starterEnabled = true;
            ed.starterDemand  = starterCoolPct;
        }
        if (HardwareConfig::hasOilPump && Config::cooldownUseOilPump) {
            // Start at oilCoolPct regardless of sensor presence.
            // With hasOilPress: tick() regulates up/down via P-controller from this seed.
            // Without hasOilPress: stays fixed at oilCoolPct for the whole cooldown.
            ed.oilPumpPct = oilPumpBinary ? (oilCoolPct > 0.0f ? 100.0f : 0.0f)
                                          : constrain(oilCoolPct, oilMinPct, oilMaxPct);
        }
        if (HardwareConfig::hasOilScavengePump && useScavengePump) ed.oilScavengeDemand = 1.0f;
        ed.clusterCode = 11;    // ClCode::CooldownRunning
    }

    BlockResult tick() override {
        if (_skip) return BlockResult::Complete;
        auto& ed = EngineData::instance();

        // Pressure-fed oil system: regulate pump to target pressure
        if (HardwareConfig::hasOilPump && HardwareConfig::hasOilPress && Config::cooldownUseOilPump) {
            if (oilFeedbackHealthy(ed)) {
                _oilFeedbackLostMs = 0;
                const unsigned long now = millis();
                float dt = (now - _lastTickMs) / 1000.0f;
                _lastTickMs = now;
                if (dt <= 0.0f || dt > 0.25f) dt = 1.0f / 400.0f;
                const float err = oilPressureTarget - oilPressureBar(ed);
                // Preserve the historical 400 Hz tuning while making the
                // accumulated correction independent of the ECU loop rate.
                if (oilPumpBinary) {
                    if (err > oilDeadbandBar) ed.oilPumpPct = 100.0f;
                    else if (err < -oilDeadbandBar) ed.oilPumpPct = 0.0f;
                } else if (fabsf(err) > oilDeadbandBar) {
                    float adj = constrain(err * oilAdjustScale * (dt * 400.0f), -5.0f, 5.0f);
                    ed.oilPumpPct = constrain(ed.oilPumpPct + adj, oilMinPct, oilMaxPct);
                }
            } else {
                _lastTickMs = millis();
                // Sensor unhealthy: fall back to the fixed no-sensor duty rather
                // than regulating on a bad reading — a failed-high sensor would
                // drive the pump to the 5% clamp during hot spindown.
                if (_oilFeedbackLostMs == 0) _oilFeedbackLostMs = _lastTickMs;
                if (_lastTickMs - _oilFeedbackLostMs >= oilFailsafeDelayMs)
                    ed.oilPumpPct = oilPumpBinary
                        ? (oilFailsafePct > 0.0f ? 100.0f : 0.0f)
                        : constrain(oilFailsafePct, oilMinPct, oilMaxPct);
            }
        }

        // Oil pump fail-check: if oil is near zero while pump is supposed to be running,
        // log a warning but do NOT abort — the engine must still cool regardless.
        if (HardwareConfig::hasOilPump && HardwareConfig::hasOilPress && Config::cooldownUseOilPump
            && oilFeedbackHealthy(ed) && oilPressureBar(ed) < Config::oilZeroBar
            && !_oilWarnLogged)
        {
            FlightRecorder::logAbort("CooldownSpin", "oil_pressure_zero_during_cooldown");
            Serial.println("[CooldownSpin] WARNING: oil pressure near zero - check oil pump");
            _oilWarnLogged = true;
        }

        if (Config::primaryEgtHealthy(ed) && Config::primaryEgtC(ed) < totTarget) {
            return BlockResult::Complete;
        }
        if ((millis() - _entryMs) > timeoutMs)   return BlockResult::TimeoutContinue;
        return BlockResult::Running;
    }

    void onExit() override {
        auto& ed = EngineData::instance();
        ed.starterDemand  = 0;
        ed.starterEnabled = false;
        ed.oilPumpPct   = 0;
        ed.oilScavengeDemand = 0.0f;
    }

private:
    bool oilFeedbackHealthy(const EngineData& ed) const {
        if (pressureInputIndex < ChannelRegistry::MAX_INPUT_CHANNELS)
            return ed.registryInputHealthy[pressureInputIndex];
        return ed.oilHealthy;
    }
    float oilPressureBar(const EngineData& ed) const {
        if (pressureInputIndex < ChannelRegistry::MAX_INPUT_CHANNELS)
            return ed.registryInputValue[pressureInputIndex];
        return ed.oilPressure;
    }
    unsigned long _entryMs       = 0;
    unsigned long _lastTickMs    = 0;
    bool          _skip          = false;
    bool          _oilWarnLogged = false;
    unsigned long _oilFeedbackLostMs = 0;
};
