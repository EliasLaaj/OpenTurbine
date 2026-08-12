#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include <Arduino.h>

// Wait for N1 to drop below threshold before starting cooldown spin.
// Has a timeout — if RPM sensor faults we proceed anyway.
// Runtime behavior: missing/unhealthy RPM feedback waits for timeout.
class RPMDrop : public IBlock {
public:
    float         rpmThreshold = 5000.0f;
    unsigned long timeoutMs    = 15000;

    const char* name() override { return "RPMDrop"; }

    void onEnter() override {
        _entryMs = millis();
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        // Proceed only when healthy feedback confirms low RPM, or when the
        // timeout expires. Missing/unhealthy RPM feedback should not skip the
        // wait, because the next cooldown step may spin the starter.
        if (ed.n1Healthy && ed.n1Rpm < rpmThreshold) return BlockResult::Complete;
        if ((millis() - _entryMs) > timeoutMs) return BlockResult::TimeoutContinue;
        return BlockResult::Running;
    }

    void onExit() override {}

private:
    unsigned long _entryMs = 0;
};
