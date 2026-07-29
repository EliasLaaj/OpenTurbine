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
    unsigned long timeoutMs          = 60000;  // 60 s default
    bool          useScavengePump = false;   // also run scavenge pump during cooldown

    const char* name() override { return "CooldownSpin"; }

    void onEnter() override {
        _entryMs       = millis();
        _lastTickMs    = _entryMs;
        _oilWarnLogged = false;
        auto& ed = EngineData::instance();

        // Skip immediately if fuel was never opened (no combustion = no hot EGT to cool)
        // Also skip in bench mode — no real heat was generated, no need to wait
        if (!ed.fuelEverOpened || ed.benchMode) {
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
            ed.oilPumpPct = oilCoolPct;
        }
        if (HardwareConfig::hasOilScavengePump && useScavengePump) { ed.oilScavengeDemand = 1.0f; ed.oilScavengeOn = true; }
        ed.clusterCode = 11;    // ClCode::CooldownRunning
    }

    BlockResult tick() override {
        if (_skip) return BlockResult::Complete;
        auto& ed = EngineData::instance();

        // Pressure-fed oil system: regulate pump to target pressure
        if (HardwareConfig::hasOilPump && HardwareConfig::hasOilPress && Config::cooldownUseOilPump) {
            if (ed.oilHealthy) {
                const unsigned long now = millis();
                float dt = (now - _lastTickMs) / 1000.0f;
                _lastTickMs = now;
                if (dt <= 0.0f || dt > 0.25f) dt = 1.0f / 400.0f;
                float err = oilPressureTarget - ed.oilPressure;
                // Preserve the historical 400 Hz tuning while making the
                // accumulated correction independent of the ECU loop rate.
                float adj = constrain(err * 0.15f * (dt * 400.0f), -5.0f, 5.0f);
                ed.oilPumpPct = constrain(ed.oilPumpPct + adj, 5.0f, 100.0f);
            } else {
                _lastTickMs = millis();
                // Sensor unhealthy: fall back to the fixed no-sensor duty rather
                // than regulating on a bad reading — a failed-high sensor would
                // drive the pump to the 5% clamp during hot spindown.
                ed.oilPumpPct = oilCoolPct;
            }
        }

        // Oil pump fail-check: if oil is near zero while pump is supposed to be running,
        // log a warning but do NOT abort — the engine must still cool regardless.
        if (HardwareConfig::hasOilPump && HardwareConfig::hasOilPress && Config::cooldownUseOilPump
            && ed.oilHealthy && ed.oilPressure < Config::oilZeroBar
            && !_oilWarnLogged)
        {
            FlightRecorder::logAbort("CooldownSpin", "oil_pressure_zero_during_cooldown");
            Serial.println("[CooldownSpin] WARNING: oil pressure near zero - check oil pump");
            _oilWarnLogged = true;
        }

        if (Config::primaryEgtHealthy(ed) && Config::primaryEgtC(ed) < totTarget) {
            return BlockResult::Complete;
        }
        if ((millis() - _entryMs) > timeoutMs)   return BlockResult::Complete;
        return BlockResult::Running;
    }

    void onExit() override {
        auto& ed = EngineData::instance();
        ed.starterDemand  = 0;
        ed.starterEnabled = false;
        ed.oilPumpPct   = 0;
        ed.oilScavengeDemand = 0.0f; ed.oilScavengeOn  = false;
    }

private:
    unsigned long _entryMs       = 0;
    unsigned long _lastTickMs    = 0;
    bool          _skip          = false;
    bool          _oilWarnLogged = false;
};
