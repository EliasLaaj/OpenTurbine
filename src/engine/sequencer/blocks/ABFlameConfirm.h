#pragma once
#include "../IBlock.h"
#include "../../EngineData.h"
#include "../../../system/Config.h"
#include <Arduino.h>

// ============================================================
//  ABFlameConfirm — waits for afterburner flame confirmation
//
//  flameMode:
//    0 = verified sensor: require a fresh OFF-to-ON transition
//    1 = EGT rise  : wait for selected EGT to rise >= totRiseDegC within totRiseWindowMs
//    2 = timed     : wait assumeIgnitedMs then assume lit
//    3 = external level: accept a fresh conditioned ON level
//
//  If flameTimeoutMs elapses without confirmation → Fault.
//  Clears igniter2On on exit regardless of mode.
// ============================================================

class ABFlameConfirm : public IBlock {
public:
    int   flameMode        = 2;       // 0=verified edge, 1=EGT rise, 2=timed, 3=external level
    float totRiseDegC      = 30.0f;   // required EGT rise (mode 1)
    int   totRiseWindowMs  = 2000;    // window for EGT rise (mode 1)
    int   assumeIgnitedMs  = 1500;    // timed mode delay (mode 2)
    int   flameTimeoutMs   = 3000;    // overall timeout → Fault

    const char* name() override { return "ABFlameConfirm"; }

    void onEnter() override {
        _startMs     = millis();
        clearWaitReason();
        auto& ed = EngineData::instance();
        _baselineValid = ed.abEgtBaselineValid;
        _totBaseline   = ed.abEgtBaseline;
        _baselineSeq   = ed.abEgtBaselineSampleSeq;
        _onSinceMs = 0;
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
                ed.abEvidenceValid = true;
                ed.abConfirmedMs = now;
                Serial.println("[AB] FlameConfirm: BENCH - simulating AB flame confirmed");
                return BlockResult::Complete;
            }
            return BlockResult::Running;
        }

        // Overall timeout → fault (ignition failed)
        if (elapsed > (unsigned long)flameTimeoutMs) {
            return fault(ed, "AB FLAME NOT CONFIRMED - RELEASE CONTROL TO RETRY");
        }

        switch (flameMode) {
            case 0: // dedicated sensor
                if (!ed.abFlameHealthy) {
                    return fault(ed, "AB FLAME INPUT UNAVAILABLE - RELEASE CONTROL TO RETRY");
                }
                if (!ed.abFlameOffObserved) {
                    return fault(ed, "AB FLAME INPUT WAS NOT OFF BEFORE FUEL - RELEASE CONTROL TO RETRY");
                }
                if (ed.abFlameSampleSeq > ed.abFlameOffSampleSeq && ed.abFlameOn) {
                    if (_onSinceMs == 0) _onSinceMs = now;
                } else {
                    _onSinceMs = 0;
                }
                if (_onSinceMs && now - _onSinceMs >= 100UL) {
                    clearWaitReason();
                    ed.abEvidenceValid = true;
                    ed.abConfirmedMs = now;
                    Serial.println("[AB] FlameConfirm: sensor detected flame");
                    return BlockResult::Complete;
                }
                break;

            case 1: // EGT rise
            {
                // EGT-rise confirmation cannot be trusted without the selected sensor.
                if (!Config::primaryEgtHealthy(ed)) {
                    return fault(ed, "EGT INPUT UNAVAILABLE DURING AB IGNITION - RELEASE CONTROL TO RETRY");
                }
                if (!_baselineValid) {
                    return fault(ed, "PRE-IGNITION EGT BASELINE UNAVAILABLE - RELEASE CONTROL TO RETRY");
                }
                const uint32_t seq = Config::effectiveEgtSource() == 2 ? ed.titSampleSeq : ed.totSampleSeq;
                float rise = Config::primaryEgtC(ed) - _totBaseline;
                if (seq > _baselineSeq && rise >= totRiseDegC) {
                    clearWaitReason();
                    ed.abEvidenceValid = true;
                    ed.abConfirmedMs = now;
                    Serial.printf("[AB] FlameConfirm: EGT rose %.1f C - confirmed\n",
                                  (double)rise);
                    return BlockResult::Complete;
                }
                if (totRiseWindowMs > 0 &&
                    elapsed >= (unsigned long)totRiseWindowMs) {
                    return fault(ed, "EGT DID NOT RISE IN AB WINDOW - RELEASE CONTROL TO RETRY");
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
                    ed.abEvidenceValid = true;
                    ed.abConfirmedMs = now;
                    Serial.printf("[AB] FlameConfirm: timed - assuming lit after %d ms\n",
                                  assumeIgnitedMs);
                    return BlockResult::Complete;
                }
                break;

            case 3: // externally conditioned level; no pre-attempt OFF requirement
                if (!ed.abFlameHealthy)
                    return fault(ed, "AB FLAME INPUT UNAVAILABLE - RELEASE CONTROL TO RETRY");
                if (ed.abFlameSampleMs >= _startMs && ed.abFlameOn) {
                    if (_onSinceMs == 0) _onSinceMs = now;
                    if (now - _onSinceMs >= 100UL) {
                        ed.abEvidenceValid = true;
                        ed.abConfirmedMs = now;
                        clearWaitReason();
                        return BlockResult::Complete;
                    }
                } else {
                    _onSinceMs = 0;
                }
                break;

            default:
                // Unknown mode cannot verify AB flame — fail safe. Completing
                // here would leave the AB solenoid open with zero verification.
                return fault(ed, "INVALID AB FLAME MODE - RELEASE CONTROL TO RETRY");
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
    uint32_t      _baselineSeq = 0;
    unsigned long _onSinceMs = 0;

    BlockResult fault(EngineData& ed, const char* reason) {
        clearWaitReason();
        snprintf(ed.abFaultReason, sizeof(ed.abFaultReason), "%s", reason);
        Serial.printf("[AB] FlameConfirm fault: %s\n", reason);
        return BlockResult::Fault;
    }
};
