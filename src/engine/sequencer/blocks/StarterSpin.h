#pragma once
#include "../IBlock.h"
#include "../PulsedStarterAssist.h"
#include "../../EngineData.h"
#include <Arduino.h>

// Spin to pre-ignition RPM. Optional proportional-starter assist pulses at low
// N1, then latches complete so ordinary ramped starter control can take over.
class StarterSpin : public IBlock {
public:
    float         starterDemand    = 0.60f;
    float         targetRpm        = 5000.0f;
    unsigned long timeoutMs        = 8000;
    float         oilStartupMinBar = 1.5f;
    float         rampPctPerSec    = 10.0f;
    bool          assistEnabled    = false;
    float         assistDemand     = 0.15f;
    float         assistUntilRpm   = 1000.0f;
    unsigned long assistOnMs       = 500;
    unsigned long assistOffMs      = 250;

    const char* name() override { return "StarterSpin"; }

    void onEnter() override {
        _entryMs = millis();
        _lastRampMs = _entryMs;
        _currentDemand = 0.0f;
        _completedNormally = false;
        _assist.begin(assistEnabled, (uint32_t)_entryMs);
        auto& ed = EngineData::instance();
        ed.starterEnabled = true;
        ed.starterDemand = 0.0f;
        ed.oilMinBar = oilStartupMinBar;
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        const unsigned long now = millis();

        // Invalid feedback must never hold the starter on. The existing block
        // timeout remains the single predictable startup failure deadline.
        const auto assistPhase = _assist.update((uint32_t)now, ed.n1Healthy,
                                                ed.n1Rpm, assistUntilRpm,
                                                (uint32_t)assistOnMs,
                                                (uint32_t)assistOffMs);
        if (assistPhase == PulsedStarterAssist::Phase::Cancelled) {
            ed.starterDemand = 0.0f;
            ed.starterEnabled = false;
            _lastRampMs = now;
        } else if (!ed.n1Healthy) {
            ed.starterDemand = 0.0f;
            _lastRampMs = now;
        } else if (assistPhase == PulsedStarterAssist::Phase::On ||
                   assistPhase == PulsedStarterAssist::Phase::Off) {
            ed.starterDemand = _assist.pulseOn() ? assistDemand : 0.0f;
        } else {
            applyNormalRamp(ed, now);
        }

        if (ed.n1Healthy && ed.n1Rpm >= targetRpm) {
            // Preserve the established startup hand-off: later ignition/flame
            // blocks keep ordinary starter demand until Spool cuts it. Never
            // let an assist ON/OFF phase leak beyond StarterSpin.
            if (!_assist.complete()) ed.starterDemand = starterDemand;
            _completedNormally = true;
            clearWaitReason();
            return BlockResult::Complete;
        }
        const unsigned long elapsed = now - _entryMs;
        if (elapsed > timeoutMs) {
            ed.starterDemand = 0.0f;
            ed.starterEnabled = false;
            clearWaitReason();
            return ed.benchMode ? BlockResult::Complete : BlockResult::Fault;
        }
        char message[80];
        if (ed.benchMode)
            snprintf(message, sizeof(message), "[BENCH] Starter sim - %lu ms remaining", timeoutMs - elapsed);
        else
            snprintf(message, sizeof(message), "N1: %d / %d RPM", (int)ed.n1Rpm, (int)targetRpm);
        setWaitReason(message);
        return BlockResult::Running;
    }

    void onExit() override {
        if (_completedNormally) return;
        auto& ed = EngineData::instance();
        ed.starterDemand = 0.0f;
        ed.starterEnabled = false;
    }

private:
    void applyNormalRamp(EngineData& ed, unsigned long now) {
        if (rampPctPerSec > 0.0f && _currentDemand < starterDemand) {
            const float dtSec = (now - _lastRampMs) * 0.001f;
            _lastRampMs = now;
            const float step = rampPctPerSec * 0.01f * dtSec;
            _currentDemand = fminf(_currentDemand + step, starterDemand);
            ed.starterDemand = _currentDemand;
        } else {
            ed.starterDemand = starterDemand;
        }
    }

    unsigned long _entryMs = 0;
    unsigned long _lastRampMs = 0;
    float         _currentDemand = 0.0f;
    bool          _completedNormally = false;
    PulsedStarterAssist _assist;
};
