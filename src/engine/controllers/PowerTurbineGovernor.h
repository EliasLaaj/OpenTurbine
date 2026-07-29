#pragma once
#include "IController.h"
#include "../EngineData.h"
#include <Arduino.h>

// ============================================================
//  PowerTurbineGovernor — N2 speed-hold for turboshaft / APU
//
//  In turboshaft and APU applications the power turbine (N2)
//  must run at a constant speed regardless of load (helicopter
//  rotor, generator, gearbox).  This controller adjusts the
//  main throttleDemand to hold N2 at targetRpm.
//
//  Architecture:
//    - P-controller, dt-scaled so that gain is independent of
//      main-loop call rate (previous version applied kp*error
//      per tick, making response dependent on CPU load / WiFi
//      processing delays).
//    - Deadband (bandRpm): no correction while inside.
//    - Disengages automatically when N2 is not healthy.
//    - Interacts with ThrottleSlew: governor sets throttleDemand
//      directly; ThrottleSlew then rate-limits it.  Set rampUpMs
//      conservatively so the governor does not fight slew.
//
//  Prop pitch actuator management (turboprop mode):
//    If usePropPitch is true the governor prefers to adjust
//    propPitchDemand first (torque / load change) and only falls
//    back to throttleDemand when pitch reaches its limits.  This
//    matches conventional turboprop governing where the propeller
//    governor is the primary speed-control authority.
//
//    Pitch is slew-rate limited (pitchRampSec: seconds for a
//    full 0→100 % stroke).  The P-gain is also dt-scaled, so
//    the effective rate of change is the lesser of the gain-
//    driven rate and the hard slew cap.
//
//    Internal pitch state (_pitchCurrent) is tracked separately
//    from ed.propPitchDemand so successive adjustments never
//    accumulate floating-point rounding error.
//
//  Config params (set from Config / Hardware::applyConfig()):
//    targetRpm      — desired N2 speed (RPM); 0 = governor disabled
//    bandRpm        — deadband ±RPM (no correction inside this band)
//    kp             — throttle gain: fraction/RPM·s  (e.g. 0.001)
//    pitchKp        — pitch gain:   fraction/RPM·s  (e.g. 0.0005)
//    pitchRampSec   — max pitch travel: full stroke in this many
//                     seconds (0 = unlimited; default 10 s)
// ============================================================

class PowerTurbineGovernor : public IController {
public:
    float targetRpm    = 0.0f;      // 0 = disabled
    float bandRpm      = 500.0f;
    float kp           = 0.00025f;  // 25 fuel percentage-points/s at 1000 RPM error
    float pitchKp      = 0.00020f;  // 20 pitch percentage-points/s at 1000 RPM error
    float pitchRampSec = 10.0f;     // hard slew limit for pitch (0=off)
    bool  usePropPitch = false;     // true = turboprop pitch-primary mode

    void begin() override {
        auto& ed = EngineData::instance();
        // Always take ownership from the live actuator demand. Startup
        // sequencing may already have positioned the propeller before the
        // governor's first RUNNING tick; beginning from the default zero would
        // otherwise create an unintended jump toward fine pitch.
        //
        // Re-sync internal state and let tick()'s slew-capped path walk pitch
        // from there. The old instant
        // propPitchDemand = 0 step bypassed pitchRampSec: a full-stroke
        // release on RUNNING re-entry / relight is exactly the gearbox torque
        // transient the slew cap exists to prevent.  With targetRpm > 0 the
        // governor drives pitch itself from the first tick; when disabled,
        // tick()'s release path slews pitch to fine.
        if (usePropPitch) {
            _pitchCurrent = constrain(ed.propPitchDemand, 0.0f, 1.0f);
            _releasing = targetRpm <= 0.0f && _pitchCurrent > 0.0f;
        } else {
            _releasing = false;
        }
        _wasActive = false;
        _lastMs    = millis();
    }

    void tick() override {
        auto& ed = EngineData::instance();
        unsigned long now = millis();
        float dt = (now - _lastMs) / 1000.0f;
        _lastMs  = now;
        // Guard: clamp dt so a stale timer or first-call edge case doesn't
        // produce an absurdly large correction step.
        if (dt <= 0.0f || dt > 0.5f) dt = 0.01f;

        if (targetRpm <= 0.0f) {
            // Governor disabled — release pitch to fine so manual throttle
            // has full authority without fighting a stale pitch demand.
            // Slew-capped (pitchRampSec), not an instant 0-step.
            if (_wasActive) {
                _releasing = usePropPitch;
                _wasActive = false;
            }
            if (_releasing) {
                float maxStep      = pitchRampSec > 0.0f ? dt / pitchRampSec : 1.0f;
                _pitchCurrent      = constrain(_pitchCurrent - maxStep, 0.0f, 1.0f);
                ed.propPitchDemand = _pitchCurrent;
                if (_pitchCurrent <= 0.0f) _releasing = false;
            }
            return;
        }
        if (!ed.n2Healthy) {
            _wasActive = false;
            if (usePropPitch) {
                // Lost free-turbine feedback: add propeller load. Fine pitch
                // would unload the shaft and can worsen an overspeed.
                float maxStep = pitchRampSec > 0.0f ? dt / pitchRampSec : 1.0f;
                _pitchCurrent = constrain(_pitchCurrent + maxStep, 0.0f, 1.0f);
                ed.propPitchDemand = _pitchCurrent;
            }
            return;
        }
        _wasActive = true;
        _releasing = false;   // active governor owns pitch from here

        float error = targetRpm - ed.n2Rpm;
        if (fabsf(error) <= bandRpm) return;   // inside deadband — no action

        if (usePropPitch) {
            // Turboprop: pitch primary, throttle secondary.
            // dt-scaled gain + hard slew cap so large errors can't step pitch
            // instantaneously (which would cause gearbox torque transients and
            // immediate N2 excursions that the governor then has to chase).
            // Positive demand is coarser pitch / higher prop load.  Therefore
            // underspeed needs finer pitch (less load) and overspeed needs
            // coarser pitch (more load).
            float pitchAdj    = -pitchKp * error * dt;
            float maxStep     = pitchRampSec > 0.0f ? dt / pitchRampSec : 1.0f;
            pitchAdj          = constrain(pitchAdj, -maxStep, maxStep);
            float newPitch    = constrain(_pitchCurrent + pitchAdj, 0.0f, 1.0f);

            // Apply only if pitch has authority in the required direction
            if (fabsf(newPitch - _pitchCurrent) > 0.0001f) {
                _pitchCurrent      = newPitch;
                ed.propPitchDemand = newPitch;
                return;  // pitch authority: skip throttle
            }
            // Pitch saturated — fall through to throttle
        }

        // Throttle-primary (or pitch authority exhausted).
        // dt-scaled so effective gain is loop-rate-independent.
        float adj = kp * error * dt;
        ed.throttleDemand = constrain(ed.throttleDemand + adj, 0.0f, 1.0f);
    }

    void reset() override {
        _wasActive    = false;
        _lastMs       = millis();
        // Do not zero _pitchCurrent here: reset() is used mid-run by some callers.
        // begin() is the authoritative "start fresh" path that handles pitch release.
    }

private:
    bool          _wasActive    = false;
    bool          _releasing    = false; // slewed release-to-fine in progress
    unsigned long _lastMs       = 0;
    float         _pitchCurrent = 0.0f;  // governor's own pitch position state
};
