#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/HardwareConfig.h"
#include <Arduino.h>

// ============================================================
//  WaitForInput — holds sequence until a general-purpose DI
//  channel reaches the expected state.
//
//  channelIdx   : index into HardwareConfig::diCh[] (0–3)
//  expectedState: true = wait until active, false = wait until inactive
//  timeoutMs    : finite max wait; zero uses the 30 s defensive fallback
// ============================================================
class WaitForInput : public IBlock {
public:
    int           channelIdx    = 0;
    bool          expectedState = true;
    unsigned long timeoutMs     = 30000;

    const char* name() override { return "WaitForInput"; }

    void onEnter() override {
        _entryMs = millis();
        if (channelIdx >= 0 && channelIdx < HardwareConfig::MAX_DI) {
            auto& hw = HardwareConfig::instance();
            const char* lbl = hw.diCh[channelIdx].label[0]
                              ? hw.diCh[channelIdx].label : "DI";
            Serial.printf("[WaitForInput] Waiting for ch%d (%s) to be %s\n",
                          channelIdx, lbl, expectedState ? "active" : "inactive");
        }
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();

        // Bench mode: skip input wait — no physical switches connected
        if (ed.benchMode) {
            Serial.printf("[WaitForInput] BENCH: skipping ch%d wait\n", channelIdx);
            return BlockResult::Complete;
        }

        if (channelIdx < 0 || channelIdx >= HardwareConfig::MAX_DI) {
            Serial.printf("[WaitForInput] Invalid input channel %d\n", channelIdx);
            return BlockResult::Abort;
        }

        bool state = ed.diState[channelIdx];

        if (state == expectedState) {
            Serial.printf("[WaitForInput] ch%d condition met\n", channelIdx);
            return BlockResult::Complete;
        }
        const unsigned long finiteTimeout = timeoutMs ? timeoutMs : 30000UL;
        if ((millis() - _entryMs) >= finiteTimeout) {
            Serial.printf("[WaitForInput] ch%d timeout after %lums\n", channelIdx, finiteTimeout);
            return BlockResult::Abort;
        }
        return BlockResult::Running;
    }

private:
    unsigned long _entryMs = 0;
};

// Uses the same configured channel and timeout, but waits for switch release.
class WaitForInputOff : public WaitForInput {
public:
    const char* name() override { return "WaitForInputOff"; }
};
