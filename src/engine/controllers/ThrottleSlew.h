#pragma once
#include "IController.h"
#include "../EngineData.h"
#include "../../system/Config.h"
#include "../../system/HardwareConfig.h"
#include "../../system/FeedbackRequirements.h"
#include "ThrottleCommandLatch.h"
#include <Arduino.h>

// ============================================================
//  ThrottleSlew — rate-limiter on throttle output
//
//  Reads throttleDemand from EngineData (set by sequencer or
//  DynamicIdle), applies ramp rates, writes the slewed result
//  back to throttleDemand for actuators to consume.
//
//  Safety pullback: reduces output when approaching overspeed
//  or overtemp limits (soft-guard before safety monitor fires).
//
//  RPM-limiter mode:
//    Simple (0, default) — pulls back on the CURRENT shaft RPM
//      (reactive). Uses the present reading of every enabled gradual limiter.
//    Advanced (1) — pulls back on RPM projected forward from the
//      filtered acceleration (ed.n1RpmAccel / n2RpmAccel), so fuel
//      eases off BEFORE an overshoot during a fast spool, and the
//      throttle-open ramp softens as the predicted N1, N2, P1, P2,
//      selected EGT (TOT/TIT), or torque nears its soft limit.
// ============================================================

class ThrottleSlew : public IController {
public:
    // Config parameters (ms to ramp 0→100%)
    float rampUpMs          = 600.0f;
    float rampDownMs        = 800.0f;

    // Safety pullback thresholds (from config: RPM limit and selected EGT limit)
    float rpmSoftLimit      = 95000.0f;  // start pulling back at 95% of limit
    float rpmHardLimit      = 100000.0f;
    float totSoftLimit      = 700.0f;
    float totHardLimit      = 750.0f;
    bool  n1PullbackEnabled = true;
    bool  n2PullbackEnabled = false;
    bool  egtPullbackEnabled = true;
    bool  p1PullbackEnabled = false;
    bool  p2PullbackEnabled = false;
    bool  torquePullbackEnabled = false;
    float n2SoftLimit       = 0.0f;
    float n2HardLimit       = 0.0f;
    float p1SoftLimit       = 0.0f;
    float p1HardLimit       = 0.0f;
    float p2SoftLimit       = 0.0f;
    float p2HardLimit       = 0.0f;
    float torqueSoftLimit   = 0.0f;
    float torqueHardLimit   = 0.0f;
    float minPullbackThrottle = 0.08f;
    // ── Advanced per-source predictive limiter behavior ──────
    float pullbackNearLimitRampUpMs = 4000.0f; // slower throttle-open ramp near the limit (≈25 %/s)
    float pullbackApproachZoneRpm   = 0.0f;    // RPM band below soft limit where softening begins (assigned in Hardware.h; 0 = auto)
    int n1Mode=0, n2Mode=0, egtMode=0, p1Mode=0, p2Mode=0, torqueMode=0;
    float n1LookaheadMs=1500.0f, n2LookaheadMs=1500.0f, egtLookaheadMs=1500.0f;
    float p1LookaheadMs=1500.0f, p2LookaheadMs=1500.0f, torqueLookaheadMs=1500.0f;
    float n1Strength=1.0f, n2Strength=1.0f, egtStrength=1.0f;
    float p1Strength=1.0f, p2Strength=1.0f, torqueStrength=1.0f;

    void begin() override {
        // Carry forward the current throttle demand so the physical actuator
        // does not dip to zero when RUNNING is entered after the Spool block.
        // reset() still starts from 0 and is used at power-up initialisation.
        _current = constrain(EngineData::instance().throttleDemand, 0.0f, 1.0f);
        _requested = _current;
        _lastMs  = millis();
    }

    void tick() override {
        auto& ed     = EngineData::instance();
        unsigned long now = millis();
        float actualDt    = (now - _lastMs) / 1000.0f;
        float dt          = actualDt;
        _lastMs           = now;
        if (dt <= 0.0f) dt = 0.001f;
        else if (dt > 0.05f) dt = 0.05f;

        // throttleDemand is both the command mailbox and the published slewed
        // value. Preserve a one-shot sequence target when the next loop sees
        // our own partial ramp step; genuine external changes replace it.
        _requested = ThrottleCommandLatch::retain(ed.throttleDemand, _current, _requested);
        float target = _requested;
        bool protectionActive = false;
        // Dry Bench Mode intentionally permits actuator travel without fitted
        // feedback. In normal operation this interlock must still prevent a
        // fuel increase with missing speed or temperature feedback.
        if (!ed.benchMode &&
            ((FeedbackRequirements::n1ForProtectionOrControl() && !ed.n1Healthy &&
              !FeedbackRequirements::isOverridden(ed, FeedbackRequirements::N1)) ||
             (FeedbackRequirements::n2ForProtectionOrControl() && !ed.n2Healthy &&
              !FeedbackRequirements::isOverridden(ed, FeedbackRequirements::N2)) ||
             (FeedbackRequirements::egtForProtectionOrControl() && !Config::primaryEgtHealthy(ed) &&
              !FeedbackRequirements::isOverridden(ed, FeedbackRequirements::EGT)) ||
             (FeedbackRequirements::p1ForProtectionOrControl() && !ed.p1Healthy &&
              !FeedbackRequirements::isOverridden(ed, FeedbackRequirements::P1)) ||
             (FeedbackRequirements::p2ForProtectionOrControl() && !ed.p2Healthy &&
              !FeedbackRequirements::isOverridden(ed, FeedbackRequirements::P2)) ||
             (FeedbackRequirements::torqueForProtectionOrControl() && !ed.torqueHealthy &&
              !FeedbackRequirements::isOverridden(ed, FeedbackRequirements::TORQUE)))) {
            if (target > _current) { target = _current; protectionActive = true; }
        }

        // Safety pullback: approach overspeed
        // Guard: rpmHardLimit must be strictly above rpmSoftLimit — equal limits
        // would cause division by zero and NaN throttle demand.
        const float unrestrictedTarget = target;
        auto applyPullback = [&](float value, float soft, float hard, float sourceStrength) {
            if (hard <= soft || value <= soft) return;
            float over = constrain((value - soft) / (hard - soft), 0.0f, 1.0f);
            float floor = constrain(minPullbackThrottle, 0.0f, unrestrictedTarget);
            // All sources use the same predictable authority: at the configured
            // full-reduction point, strength 1.0 reaches the user-set floor.
            // Lower strength is gentler; greater than 1 reaches the floor sooner.
            const float reduction = (unrestrictedTarget - floor) * over * sourceStrength;
            const float ceiling =
                constrain(unrestrictedTarget - reduction, floor, unrestrictedTarget);
            target = fminf(target, ceiling); // the most restrictive active limiter wins
        };

        // RPM fed to the pullback: current (Simple) or accel-predicted (Advanced),
        // and effRampUpMs softens the throttle-open rate near the limit (Advanced
        // only). In Simple mode n1val/n2val == current RPM and effRampUpMs ==
        // rampUpMs, so the pullback and slew below are the original behaviour.
        float n1val = ed.n1Rpm;
        float n2val = ed.n2Rpm;
        float p1val = ed.p1;
        float p2val = ed.p2;
        float torqueVal = ed.torque;
        float egtVal = Config::primaryEgtC(ed);
        float effRampUpMs = rampUpMs;
        auto updateSampleRate = [&](float value, uint32_t seq, uint32_t sampleMs,
                                    bool healthy, uint32_t& seenSeq, uint32_t& lastMs,
                                    float& lastValue, float& rate) {
            if (!healthy) { rate = 0.0f; return; }
            if (seq == 0 || seq == seenSeq) return;  // cached value: do not re-differentiate
            const float alpha = constrain(Config::rpmAccelFilter, 0.02f, 1.0f);
            const float sampleDt = lastMs ? (sampleMs - lastMs) / 1000.0f : 0.0f;
            if (sampleDt > 0.0f && sampleDt <= 1.0f) {
                rate += (((value - lastValue) / sampleDt) - rate) * alpha;
            } else {
                rate = 0.0f;
            }
            lastValue = value;
            lastMs = sampleMs;
            seenSeq = seq;
        };
        updateSampleRate(ed.p1, ed.p1SampleSeq, ed.p1SampleMs, ed.p1Healthy,
                         _p1SeenSeq, _p1LastMs, _lastP1, _p1Rate);
        updateSampleRate(ed.p2, ed.p2SampleSeq, ed.p2SampleMs, ed.p2Healthy,
                         _p2SeenSeq, _p2LastMs, _lastP2, _p2Rate);
        updateSampleRate(ed.torque, ed.torqueSampleSeq, ed.torqueSampleMs, ed.torqueHealthy,
                         _torqueSeenSeq, _torqueLastMs, _lastTorque, _torqueRate);
        if (n1Mode == 1) n1val = ed.n1Rpm + fmaxf(0.0f, ed.n1RpmAccel) * n1LookaheadMs * 0.001f;
        if (n2Mode == 1) n2val = ed.n2Rpm + fmaxf(0.0f, ed.n2RpmAccel) * n2LookaheadMs * 0.001f;
        if (p1Mode == 1) p1val = ed.p1 + fmaxf(0.0f, _p1Rate) * p1LookaheadMs * 0.001f;
        if (p2Mode == 1) p2val = ed.p2 + fmaxf(0.0f, _p2Rate) * p2LookaheadMs * 0.001f;
        if (torqueMode == 1) torqueVal = ed.torque + fmaxf(0.0f, _torqueRate) * torqueLookaheadMs * 0.001f;
        if (egtMode == 1) egtVal = Config::primaryEgtC(ed) + fmaxf(0.0f, ed.totRiseRate) * egtLookaheadMs * 0.001f;
        if (n1Mode == 1) {
            if (ed.n1Healthy && pullbackApproachZoneRpm > 0.0f) {
                const float approachStart = rpmSoftLimit - pullbackApproachZoneRpm;
                if (n1val > approachStart) {
                    const float f = constrain((n1val - approachStart) / pullbackApproachZoneRpm, 0.0f, 1.0f);
                    effRampUpMs = rampUpMs + (pullbackNearLimitRampUpMs - rampUpMs) * f;  // larger ms = slower open
                }
            }
        }
        if (n1PullbackEnabled && ed.n1Healthy) applyPullback(n1val, rpmSoftLimit, rpmHardLimit, n1Strength);
        if (n2PullbackEnabled && ed.n2Healthy) applyPullback(n2val, n2SoftLimit, n2HardLimit, n2Strength);
        if (egtPullbackEnabled && Config::primaryEgtHealthy(ed)) {
            applyPullback(egtVal, totSoftLimit, totHardLimit, egtStrength);
        }
        if (p1PullbackEnabled && ed.p1Healthy) applyPullback(p1val, p1SoftLimit, p1HardLimit, p1Strength);
        if (p2PullbackEnabled && ed.p2Healthy) applyPullback(p2val, p2SoftLimit, p2HardLimit, p2Strength);
        if (torquePullbackEnabled && ed.torqueHealthy) applyPullback(torqueVal, torqueSoftLimit, torqueHardLimit, torqueStrength);
        if (target + 0.0001f < unrestrictedTarget) protectionActive = true;

        // Guard: if rampMs is 0 (instant) or dt is 0 (same-millisecond tick),
        // dividing would produce Inf or NaN.  Treat 0 ms ramp as instant (maxStep=1).
        float maxStep;
        if (target > _current) {
            maxStep = effRampUpMs > 0.0f ? dt / (effRampUpMs / 1000.0f) : 1.0f;
        } else {
            float closeDt = fmaxf(dt, actualDt);
            maxStep = rampDownMs > 0.0f ? closeDt / (rampDownMs / 1000.0f) : 1.0f;
        }
        _current = constrain(_current + constrain(target - _current, -maxStep, maxStep),
                             0.0f, 1.0f);

        ed.throttleDemand = _current;
        ed.mainFuelProtectionActive = protectionActive;
    }

    void reset() override {
        _current = 0;
        _requested = 0;
        _lastMs  = millis();
        _lastP1 = _lastP2 = _lastTorque = 0.0f;
        _p1Rate = _p2Rate = _torqueRate = 0.0f;
        _p1SeenSeq = _p2SeenSeq = _torqueSeenSeq = 0;
        _p1LastMs = _p2LastMs = _torqueLastMs = 0;
        auto& ed = EngineData::instance();
        ed.mainFuelProtectionActive = false;
    }

    // Returns the slew-limited output before any external offset (e.g. AB fuel offset)
    // is added on top.  Used by checkABTrigger() to prevent the offset compounding
    // each tick when no physical throttle input is present to reset throttleDemand.
    float currentDemand() const { return _current; }

private:
    float         _current = 0;
    float         _requested = 0;
    unsigned long _lastMs  = 0;
    float _lastP1 = 0.0f, _lastP2 = 0.0f, _lastTorque = 0.0f;
    float _p1Rate = 0.0f, _p2Rate = 0.0f, _torqueRate = 0.0f;
    uint32_t _p1SeenSeq = 0, _p2SeenSeq = 0, _torqueSeenSeq = 0;
    uint32_t _p1LastMs = 0, _p2LastMs = 0, _torqueLastMs = 0;
};
