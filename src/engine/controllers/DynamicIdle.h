#pragma once
#include "IController.h"
#include "../EngineData.h"
#include "../../system/Config.h"
#include "../../system/HardwareConfig.h"
#include <Arduino.h>

// Closed-loop idle floor using one explicitly selected feedback source.
// N1/N2 use RPM settings; P1/P2 use the pressure settings below.
class DynamicIdle : public IController {
public:
    float targetRpm = 44000.0f;
    float rampUpMs = 10000.0f;
    float rampDownMs = 20000.0f;
    float deadbandRpm = 300.0f;
    float rpmLimit = 60000.0f;
    float maxMultiplier = 1.50f;
    int source = 0; // 0=N1, 1=N2, 2=P1, 3=P2
    float targetPressure = 1.0f;
    float pressureDeadband = 0.03f;
    float pressureLimit = 2.0f;

    int idleMode = 0;
    float idleDecelEnterRpm = 1000.0f;
    float idleDecelDropPct = 2.0f;
    float idleLookaheadMs = 2500.0f;
    float idleSettleBandRpm = 1500.0f;
    float idleFullResponseRpm = 12000.0f;
    float idleTrimUpPctPerSec = 4.0f;
    float idleTrimDownPctPerSec = 2.0f;
    float idleLearnRate = 0.02f;
    float idleLearnAccelMax = 1200.0f;
    float pressureDecelEnter = 0.12f;
    float pressureSettleBand = 0.03f;
    float pressureFullResponse = 0.25f;
    float pressureLearnRateMax = 1.0f;

    void begin() override { reset(); _lastMs = millis(); }

    void tick() override {
        auto& ed = EngineData::instance();
        if (!ed.dynamicIdleEnabled) { setState(ed, "Off"); reset(); return; }
        if (source != _lastSource) {
            reset();
            _lastSource = source;
        }

        const bool pressureMode = source >= 2;
        const float target = pressureMode ? targetPressure : targetRpm;
        const float limit = pressureMode ? pressureLimit : rpmLimit;
        const float deadband = pressureMode ? pressureDeadband : deadbandRpm;
        if (target <= 0.0f || limit <= 0.0f) {
            setState(ed, "Inhibited: target/cutoff disabled");
            reset();
            return;
        }

        bool installed = false, healthy = false;
        float feedback = 0.0f;
        switch (source) {
            case 1: installed = HardwareConfig::hasN2Rpm; healthy = ed.n2Healthy; feedback = ed.n2Rpm; break;
            case 2: installed = HardwareConfig::hasP1; healthy = ed.p1Healthy; feedback = ed.p1; break;
            case 3: installed = HardwareConfig::hasP2; healthy = ed.p2Healthy; feedback = ed.p2; break;
            default: installed = HardwareConfig::hasN1Rpm; healthy = ed.n1Healthy; feedback = ed.n1Rpm; break;
        }

        const unsigned long now = millis();
        const float actualDt = (now - _lastMs) / 1000.0f;
        float dt = actualDt;
        _lastMs = now;
        if (dt <= 0.0f) dt = 0.001f;
        else if (dt > 0.05f) dt = 0.05f;

        if (!installed || !healthy) {
            setState(ed, "Feedback lost");
            _idleFloor = 0.0f;
            _integrator = 0.0f;
            _wasEngaged = false;
            _lastFeedback = _feedbackRate = 0.0f;
            _feedbackSeenSeq = _feedbackLastMs = 0;
            return;
        }

        float rate = source == 1 ? ed.n2RpmAccel : (source == 0 ? ed.n1RpmAccel : _feedbackRate);
        if (pressureMode) {
            const uint32_t seq = source == 2 ? ed.p1SampleSeq : ed.p2SampleSeq;
            const uint32_t sampleMs = source == 2 ? ed.p1SampleMs : ed.p2SampleMs;
            if (seq != 0 && seq != _feedbackSeenSeq) {
                const float sampleDt = _feedbackLastMs ? (sampleMs - _feedbackLastMs) / 1000.0f : 0.0f;
                if (sampleDt > 0.0f && sampleDt <= 1.0f)
                    _feedbackRate += (((feedback - _lastFeedback) / sampleDt) - _feedbackRate) * 0.20f;
                else
                    _feedbackRate = 0.0f;
                _lastFeedback = feedback;
                _feedbackLastMs = sampleMs;
                _feedbackSeenSeq = seq;
            }
            rate = _feedbackRate;
        }

        if (feedback > limit) {
            setState(ed, "Waiting: above cutoff");
            _idleFloor = 0.0f;
            _integrator = 0.0f;
            _wasEngaged = false;
            return;
        }

        // A metering pump cannot reliably reproduce a nonzero command below
        // its calibrated minimum. Keep zero for authoritative fuel-cut paths,
        // but use that calibration as Dynamic Idle's single nonzero floor.
        const float minFloor = constrain(Config::fuelPumpMinPct / 100.0f, 0.0f, 1.0f);
        const float maxFloor = constrain((Config::throttleIdleMaxPct / 100.0f) * maxMultiplier, minFloor, 1.0f);

        if (idleMode == 1) {
            setState(ed, "Active");
            const float enterBand = pressureMode ? pressureDecelEnter : idleDecelEnterRpm;
            const float settleBand = pressureMode ? pressureSettleBand : idleSettleBandRpm;
            const float fullResponse = pressureMode ? pressureFullResponse : idleFullResponseRpm;
            const float learnRateMax = pressureMode ? pressureLearnRateMax : idleLearnAccelMax;
            if (!_wasEngaged) {
                _wasEngaged = true;
                _state = (feedback > target + enterBand && _learnedHoldValid) ? DiState::DecelCatch : DiState::Trim;
            }
            const float predicted = feedback + rate * (idleLookaheadMs * 0.001f);
            if (_state == DiState::DecelCatch) {
                _idleFloor = constrain(_learnedHold - idleDecelDropPct / 100.0f, minFloor, maxFloor);
                if (feedback <= target + enterBand) _state = DiState::Trim;
            } else {
                const float err = target - predicted;
                const float ae = fabsf(err);
                if (ae > settleBand) {
                    const float response = constrain((ae - settleBand) / fmaxf(0.001f, fullResponse), 0.0f, 1.0f);
                    const float pctPerSec = err > 0 ? idleTrimUpPctPerSec : idleTrimDownPctPerSec;
                    const float step = (pctPerSec / 100.0f) * response * dt;
                    _idleFloor = constrain(_idleFloor + (err > 0 ? step : -step), minFloor, maxFloor);
                }
                if (fabsf(feedback - target) <= settleBand && fabsf(rate) <= learnRateMax) {
                    const float nominal = constrain(idleLearnRate, 0.0f, 1.0f);
                    const float alpha = nominal >= 1.0f ? 1.0f : 1.0f - powf(1.0f - nominal, dt * 400.0f);
                    _learnedHold += (_idleFloor - _learnedHold) * alpha;
                    _learnedHoldValid = true;
                }
            }
            const float demand = constrain(_idleFloor, minFloor, maxFloor);
            if (ed.throttleDemand < demand) ed.throttleDemand = demand;
            return;
        }

        const float error = target - feedback;
        setState(ed, "Active");
        float rampStep = 0.0f;
        if (fabsf(error) >= deadband) {
            const float rampMs = error > 0 ? rampUpMs : rampDownMs;
            const float maxStep = rampMs > 0.0f ? dt / (rampMs / 1000.0f) : 1.0f;
            rampStep = constrain(error / target, -maxStep, maxStep);
        }
        _idleFloor = constrain(_idleFloor + rampStep, minFloor, maxFloor);
        if (Config::idleIGain > 0.0f) {
            _integrator += (error / target) * Config::idleIGain * dt;
            _integrator = constrain(_integrator, -Config::idleIMax, Config::idleIMax);
        } else {
            _integrator = 0.0f;
        }
        const float demand = constrain(_idleFloor + _integrator, minFloor, maxFloor);
        if (ed.throttleDemand < demand) ed.throttleDemand = demand;
    }

    void reset() override {
        _idleFloor = _integrator = _learnedHold = 0.0f;
        _learnedHoldValid = _wasEngaged = false;
        _state = DiState::Trim;
        _lastMs = millis();
        _lastFeedback = _feedbackRate = 0.0f;
        _feedbackSeenSeq = _feedbackLastMs = 0;
        _lastSource = source;
    }

private:
    static void setState(EngineData& ed, const char* value) {
        strlcpy(ed.idleControllerState, value, sizeof(ed.idleControllerState));
    }
    enum class DiState : uint8_t { Trim, DecelCatch };
    DiState _state = DiState::Trim;
    float _idleFloor = 0.0f;
    float _integrator = 0.0f;
    float _learnedHold = 0.0f;
    bool _learnedHoldValid = false;
    bool _wasEngaged = false;
    unsigned long _lastMs = 0;
    float _lastFeedback = 0.0f;
    float _feedbackRate = 0.0f;
    uint32_t _feedbackSeenSeq = 0;
    uint32_t _feedbackLastMs = 0;
    int _lastSource = -1;
};
