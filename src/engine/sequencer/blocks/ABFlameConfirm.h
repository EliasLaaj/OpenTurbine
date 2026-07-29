#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/Config.h"
#include <Arduino.h>

// ============================================================
//  ABFlameConfirm — waits for afterburner flame confirmation
//
//  flameMode:
//    0 = sensor    : wait for ed.abFlameOn (dedicated AB flame sensor)
//    1 = EGT rise  : wait for selected EGT to rise >= totRiseDegC within totRiseWindowMs
//    2 = timed     : wait assumeIgnitedMs then assume lit
//
//  If flameTimeoutMs elapses without confirmation → Fault.
//  Clears igniter2On on exit regardless of mode.
// ============================================================

class ABFlameConfirm : public IBlock {
public:
    int   flameMode        = 2;       // 0=sensor, 1=EGT rise, 2=timed
    float totRiseDegC      = 30.0f;   // required EGT rise (mode 1)
    int   totRiseWindowMs  = 2000;    // window for EGT rise (mode 1)
    int   assumeIgnitedMs  = 1500;    // timed mode delay (mode 2)
    int   flameTimeoutMs   = 3000;    // overall timeout → Fault

    const char* name() override { return "ABFlameConfirm"; }

    void onEnter() override {
        _startMs     = millis();
        clearWaitReason();
        auto& ed = EngineData::instance();
        _baselineValid = Config::primaryEgtHealthy(ed);
        _totBaseline   = _baselineValid ? Config::primaryEgtC(ed) : 0.0f;
        Serial.printf("[AB] FlameConfirm: mode=%d timeout=%d ms\n", flameMode, flameTimeoutMs);
    }

    BlockResult tick() override {
        auto& ed = EngineData::instance();
        unsigned long now     = millis();
        unsigned long elapsed = now - _startMs;

        // Bench mode: simulate confirmed AB flame after assumeIgnitedMs — no real sensor needed.
        // Uses the timed path regardless of flameMode so mode 0/1 don't fault on timeout.
        if (ed.benchMode) {
            if (elapsed >= (unsigned long)assumeIgnitedMs) {
                clearWaitReason();
                Serial.println("[AB] FlameConfirm: BENCH - simulating AB flame confirmed");
                return BlockResult::Complete;
            }
            return BlockResult::Running;
        }

        // Overall timeout → fault (ignition failed)
        if (elapsed > (unsigned long)flameTimeoutMs) {
            clearWaitReason();
            Serial.println("[AB] FlameConfirm: TIMEOUT - ignition failed");
            return BlockResult::Fault;
        }

        switch (flameMode) {
            case 0: // dedicated sensor
                if (!ed.abFlameHealthy) {
                    clearWaitReason();
                    Serial.println("[AB] FlameConfirm fault: flame sensor unavailable");
                    return BlockResult::Fault;
                }
                if (ed.abFlameOn) {
                    clearWaitReason();
                    Serial.println("[AB] FlameConfirm: sensor detected flame");
                    return BlockResult::Complete;
                }
                break;

            case 1: // EGT rise
            {
                // EGT-rise confirmation cannot be trusted without the selected sensor.
                if (!Config::primaryEgtHealthy(ed)) {
                    clearWaitReason();
                    Serial.println("[AB] FlameConfirm fault: EGT sensor unavailable");
                    return BlockResult::Fault;
                }
                // Sensor was unhealthy at onEnter: snapshot the baseline on the
                // first healthy reading instead of measuring rise against 0,
                // which would confirm flame instantly at any normal EGT.
                if (!_baselineValid) {
                    _totBaseline   = Config::primaryEgtC(ed);
                    _baselineValid = true;
                    break;
                }
                float rise = Config::primaryEgtC(ed) - _totBaseline;
                if (rise >= totRiseDegC) {
                    clearWaitReason();
                    Serial.printf("[AB] FlameConfirm: EGT rose %.1f C - confirmed\n",
                                  (double)rise);
                    return BlockResult::Complete;
                }
                if (totRiseWindowMs > 0 &&
                    elapsed >= (unsigned long)totRiseWindowMs) {
                    clearWaitReason();
                    Serial.println("[AB] FlameConfirm fault: EGT did not rise within configured window");
                    return BlockResult::Fault;
                }
                // Baseline is fixed at onEnter snapshot — no per-tick ratcheting.
                // Per-sample updates caused noise sensitivity: a momentary dip in
                // the first window would lower the baseline and make the threshold
                // easier to trigger spuriously on sensor noise.
                break;
            }

            case 2: // timed assumption
                if (elapsed >= (unsigned long)assumeIgnitedMs) {
                    clearWaitReason();
                    Serial.printf("[AB] FlameConfirm: timed - assuming lit after %d ms\n",
                                  assumeIgnitedMs);
                    return BlockResult::Complete;
                }
                break;

            default:
                // Unknown mode cannot verify AB flame — fail safe. Completing
                // here would leave the AB solenoid open with zero verification.
                clearWaitReason();
                Serial.printf("[AB] FlameConfirm fault: unknown flameMode %d\n", flameMode);
                return BlockResult::Fault;
        }

        return BlockResult::Running;
    }

    void onExit() override {
        clearWaitReason();
        // Cut AB igniter regardless of mode
        EngineData::instance().igniter2On = false;
    }

private:
    unsigned long _startMs    = 0;
    float         _totBaseline= 0;
    bool          _baselineValid = false;
};
