#pragma once
#include "EngineData.h"
#include "../system/Config.h"
#include "../system/HardwareConfig.h"
#include "../system/FeedbackRequirements.h"
#include <Arduino.h>
#include <functional>
#include <string.h>

// ============================================================
//  SafetyMonitor — reads EngineData, triggers shutdowns on fault
//
//  Overspeed runs every tick (no interval gate) with a short
//  raw-reading confirmation (OVERSPEED_CONFIRM_MS).
//  All other checks run at checkIntervalMs (default 100 ms).
//  All checks bypassable with skipSafetyChecks in DEV_MODE.
//
//  The actual enterShutdown() / setMode() calls happen via
//  callbacks registered at begin() — keeps this file hardware-free.
// ============================================================

class SafetyMonitor {
public:
    using ShutdownFn = void(*)();
    using RelightFn  = std::function<void()>;

    // Config parameters (populated from Config before begin())
    float         rpmLimit              = 100000.0f;
    float         n2RpmLimit            = 0.0f;
    float         minRpm               = 30000.0f;
    float         titLimit             = 0.0f;    // °C — 0 = disabled
    float         oilTempLimit         = 0.0f;    // °C — 0 = disabled
    float         fuelPressMin         = 0.0f;    // bar — 0 = disabled
    float         battVoltMin          = 0.0f;    // V — 0 = disabled
    float         surgeRpmVariance     = 0.0f;    // RPM² variance threshold — 0 = disabled
    float         flameoutShutdownMs   = 3000.0f;
    int           flameoutSource       = 0;
    float         flameoutN1MinRpm     = 0.0f;
    float         flameoutEgtBelowC    = 300.0f;
    float         flameoutEgtFallRateCPerSec = 50.0f;
    unsigned long checkIntervalMs      = 100;
    uint32_t      lowOilConfirmMs      = 500;
    uint32_t      oilZeroConfirmMs     = 100;
    uint32_t      oilTempConfirmMs     = 1000;
    uint32_t      fuelPressConfirmMs   = 500;
    uint32_t      battLowConfirmMs     = 1000;

    void begin(ShutdownFn enterShutdown, ShutdownFn enterFault) {
        _enterShutdown    = enterShutdown;
        _enterFault       = enterFault;
        _lastCheckMs      = 0;
        _flameoutMs       = 0;
        _relightStartMs   = 0;
        _relightStartEgt  = 0.0f;
        _startupSpooled   = false;
        _overspeedPending = false;
        _n2OverspeedPending = false;
        _resetDwellConfirmations();
        _resetSurge();
    }

    // Allow external callers (e.g. DI fault handler) to inject a fault code
    // so lastFault() returns the right string when enterFaultShutdown() reads it.
    void setExternalFault(const char* code) { _lastFault = code; }

    void setRelightCallback(RelightFn fn) { _relight = fn; }

    void check() {
        auto& ed = EngineData::instance();

        // Mode bookkeeping runs BEFORE the skip/bench gate: mode transitions
        // must reset detection state even while checks are skipped, otherwise
        // a stale _flameoutMs from a previous run survives into
        // the next one and the first un-skipped tick trips instantly (stale
        // absolute timestamp = zero confirmation time).
        SysMode m = ed.mode;
        bool inOp = (m == SysMode::STARTUP || m == SysMode::RUNNING);
        if (!inOp) {
            _flameoutMs     = 0;
            _relightStartMs = 0;
            _relightStartEgt = 0.0f;
            _overspeedPending = false;
            _n2OverspeedPending = false;
            _resetDwellConfirmations(m != SysMode::SHUTDOWN);
            _lastCheckMs = 0;
            _lastEgt        = -1.0f;
            _lastEgtMs      = 0;
            _lastEgtSampleSeq = 0;
            ed.totRiseRate  = 0.0f;
            // Surge buffer is only reset on STANDBY entry — not on every non-op
            // mode change (e.g. SHUTDOWN) — so the buffer isn't wiped mid-spindown.
            if (m == SysMode::STANDBY) {
                _n1BufIdx      = 0;
                _n1BufCount    = 0;
                _startupSpooled = false;  // reset for next startup
            }
            ed.surgeDetected = false;
            _resetSurge();
            // Scavenge pumps commonly run only during shutdown. Keep their
            // flow warning useful there, but never request a second shutdown.
            if (m == SysMode::SHUTDOWN) _checkOilFlow(ed, m);
            return;
        }

        if (ed.skipSafetyChecks || ed.benchMode) {
            // Never carry a partly confirmed raw overspeed across a period in
            // which monitoring was deliberately suspended.
            _overspeedPending = false;
            _n2OverspeedPending = false;
            _resetDwellConfirmations();
            _lastCheckMs = 0;
            _resetSurge();
            return;
        }

        // ── Overspeed — every tick, short raw-reading confirmation ──
        // Deliberately ignores n1Healthy: a genuine fast runaway raises the
        // JUMP health flag on every 100 ms sample (rate > jumpThreshold ×
        // rpmLimit/s), which would suppress this exact protection. Instead
        // the raw reading must stay above the limit for OVERSPEED_CONFIRM_MS
        // (≥2, typically 3 sensor samples at the 100 ms sensor update rate),
        // so a single noise spike still cannot trip it.
        if (HardwareConfig::safetyOverspeed && HardwareConfig::hasN1Rpm &&
            ed.n1Rpm > rpmLimit) {
            unsigned long nowOs = millis();
            if (!_overspeedPending) {
                _overspeedPending = true;
                _overspeedSinceMs = nowOs;
            } else if (nowOs - _overspeedSinceMs >= OVERSPEED_CONFIRM_MS) {
                _trigger("OVERSPEED");
                return;
            }
        } else {
            _overspeedPending = false;
        }

        // N2 is an independently protected power-turbine shaft. As with N1,
        // use confirmed raw readings so the sensor's fast-change health flag
        // cannot mask a real free-power-turbine runaway.
        if (HardwareConfig::safetyN2Overspeed && HardwareConfig::hasN2Rpm &&
            n2RpmLimit > 0.0f && ed.n2Rpm > n2RpmLimit) {
            unsigned long nowOs = millis();
            if (!_n2OverspeedPending) {
                _n2OverspeedPending = true;
                _n2OverspeedSinceMs = nowOs;
            } else if (nowOs - _n2OverspeedSinceMs >= OVERSPEED_CONFIRM_MS) {
                _trigger("N2_OVERSPEED");
                return;
            }
        } else {
            _n2OverspeedPending = false;
        }

        // Independent hard trips for pressure and shaft torque. These do not
        // depend on the gradual fuel limiter being enabled.
        const unsigned long hardNow = millis();
        if (_confirmed(HardwareConfig::hasP1 && ed.p1Healthy &&
                       Config::p1TripLimit > 0.0f &&
                       ed.p1 > Config::p1TripLimit, hardNow,
                       Config::pressureTorqueTripConfirmMs, _p1TripSinceMs)) {
            _trigger("P1_HIGH"); return;
        }
        if (_confirmed(HardwareConfig::hasP2 && ed.p2Healthy &&
                       Config::p2TripLimit > 0.0f &&
                       ed.p2 > Config::p2TripLimit, hardNow,
                       Config::pressureTorqueTripConfirmMs, _p2TripSinceMs)) {
            _trigger("P2_HIGH"); return;
        }
        if (_confirmed(HardwareConfig::hasTorque && ed.torqueHealthy &&
                       Config::torqueTripLimit > 0.0f &&
                       ed.torque > Config::torqueTripLimit, hardNow,
                       Config::pressureTorqueTripConfirmMs, _torqueTripSinceMs)) {
            _trigger("TORQUE_HIGH"); return;
        }

        // ── Interval checks ──────────────────────────────────
        // Current protection uses wall time on every ECU tick; its configured
        // delay must not be stretched by the slower general safety scan.
        unsigned long fastNow = millis();
        if (HardwareConfig::hasOilPumpCurrentSensor && ed.oilPumpOvercurrent) {
            if (_oilOvercurrentSinceMs == 0) {
                _oilOvercurrentSinceMs = fastNow;
                strncpy(ed.lastEvent, "WARNING: oil pump overcurrent", sizeof(ed.lastEvent) - 1);
            } else if (fastNow - _oilOvercurrentSinceMs >= Config::oilPumpOvercurrentDelayMs) {
                _trigger("OIL_PUMP_OVERCURRENT");
                return;
            }
        } else {
            _oilOvercurrentSinceMs = 0;
        }
        const auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            const auto& c = reg.outputs[i];
            const bool over = c.installed && c.hasCurrent && c.currentMaxAmps > 0.0f &&
                              ed.registryOutputCurrentHealthy[i] &&
                              ed.registryOutputCurrentAmps[i] > c.currentMaxAmps;
            if (!over) { _registryOvercurrentSinceMs[i] = 0; continue; }
            if (_registryOvercurrentSinceMs[i] == 0) {
                _registryOvercurrentSinceMs[i] = fastNow;
                snprintf(ed.lastEvent, sizeof(ed.lastEvent), "WARNING: %s overcurrent",
                         c.name[0] ? c.name : c.id);
            } else if (fastNow - _registryOvercurrentSinceMs[i] >= Config::oilPumpOvercurrentDelayMs) {
                _trigger("OUTPUT_OVERCURRENT");
                return;
            }
        }
        if (_checkOilFlow(ed, m)) return;

        unsigned long now = fastNow;
        if (now - _lastCheckMs < checkIntervalMs) return;
        // Gap guard: a hole in monitoring (skip-safety toggled off mid-run,
        // scheduler stall) makes all EGT history stale — reset it so old
        // snapshots can't fake 2 s of stability, and clear any in-progress
        // flameout timer so a stale absolute timestamp can't trip with zero
        // fresh confirmation time.
        if (_lastCheckMs != 0 && now - _lastCheckMs > CHECK_GAP_RESET_MS) {
            _lastEgt         = -1.0f;
            _lastEgtMs       = 0;
            ed.totRiseRate   = 0.0f;
            _flameoutMs      = 0;
            _relightStartMs  = 0;
            _relightStartEgt = 0.0f;
        }
        _lastCheckMs = now;

        // EGT rate-of-rise.
        uint32_t egtSeq = Config::effectiveEgtSource() == 2 ? ed.titSampleSeq : ed.totSampleSeq;
        unsigned long egtMs = Config::effectiveEgtSource() == 2 ? ed.titSampleMs : ed.totSampleMs;
        if (Config::primaryEgtHealthy(ed) && egtSeq != _lastEgtSampleSeq) {
            float currentEgt = Config::primaryEgtC(ed);
            if (_lastEgt >= 0.0f && _lastEgtMs > 0) {
                float dtSec = (egtMs - _lastEgtMs) / 1000.0f;
                if (dtSec > 0.0f) {
                    ed.totRiseRate = (currentEgt - _lastEgt) / dtSec;
                }
            }
            _lastEgt   = currentEgt;
            _lastEgtMs = egtMs;
            _lastEgtSampleSeq = egtSeq;

        } else if (!Config::primaryEgtHealthy(ed)) {
            _lastEgt   = -1.0f;
            _lastEgtMs = 0;
            _lastEgtSampleSeq = 0;
            ed.totRiseRate = 0.0f;
        }

        float primaryLimit = Config::primaryEgtLimitC();
        if (m == SysMode::STARTUP && Config::startupEgtLimitC > 0.0f)
            primaryLimit = Config::startupEgtLimitC;
        if (HardwareConfig::safetyOvertemp
            && (m == SysMode::STARTUP || m == SysMode::RUNNING)
            && primaryLimit > 0.0f &&
            Config::primaryEgtHealthy(ed) && Config::primaryEgtC(ed) > primaryLimit) {
            _trigger("OVERTEMP");
            return;
        }

        if (_confirmed(HardwareConfig::safetyLowOil && HardwareConfig::hasOilPress
            && ed.oilMinBar > 0 && ed.oilHealthy && ed.oilPressure < ed.oilMinBar,
            now, lowOilConfirmMs, _lowOilSinceMs))
        {
            _trigger("LOW_OIL");
            return;
        }

        // Oil near-zero while sensor is ADC-healthy → catastrophic failure or
        // disconnected fitting.  Distinguished from LOW_OIL (calibrated range)
        // and from sensor-rail fault (oilHealthy=false).
        if (_confirmed(HardwareConfig::safetyOilZero && HardwareConfig::hasOilPress
            && m == SysMode::RUNNING && ed.oilHealthy
            && ed.oilPressure < Config::oilZeroBar,
            now, oilZeroConfirmMs, _oilZeroSinceMs))
        {
            _trigger("OIL_ZERO");
            return;
        }

        if (HardwareConfig::safetyFlameout &&
            m == SysMode::RUNNING && ed.flameMonitorActive && _flameoutSourceUsable()) {
            if (_flameoutLost(ed)) {
                if (_flameoutMs == 0) _flameoutMs = now;

                if ((now - _flameoutMs) > (unsigned long)flameoutShutdownMs) {
                    // Relight path: enabled, armed, N1 still viable
                    bool n1Ok = HardwareConfig::hasN1Rpm && ed.n1Healthy
                             && ed.n1Rpm >= Config::effectiveRelightMinRpm();
                    bool relightIgnitionOk = false;
                    switch (Config::relightIgnitionTarget) {
                        case 1: relightIgnitionOk = HardwareConfig::hasIgniter2; break;
                        case 2: relightIgnitionOk = HardwareConfig::hasGlowPlug; break;
                        default: relightIgnitionOk = HardwareConfig::hasIgniter; break;
                    }
                    if (Config::relightEnabled && ed.relightArmed && relightIgnitionOk && n1Ok && _relight) {
                        if (_relightStartMs == 0) {
                            // First trigger — start continuous ignition
                            _relight();
                            _relightStartMs = now;
                            _relightStartEgt = Config::primaryEgtC(ed);
                        } else {
                            // Relight window: check N1 still viable and timeout not expired
                            bool stillViable = HardwareConfig::hasN1Rpm && ed.n1Healthy
                                            && ed.n1Rpm >= Config::effectiveRelightMinRpm();
                            bool timedOut    = Config::relightTimeoutMs > 0
                                           && (now - _relightStartMs) > (unsigned long)Config::relightTimeoutMs;
                            if (!stillViable || timedOut) {
                                _trigger("FLAMEOUT");
                                return;
                            }
                        }
                        return;  // checkRelight() in main.cpp keeps igniterOn true each tick
                    }
                    // Relight not enabled / armed / N1 too low — fault immediately
                    _trigger("FLAMEOUT");
                    return;
                }
            } else {
                _flameoutMs     = 0;
                _relightStartEgt = 0.0f;
                _relightStartMs = 0;  // flame returned — reset relight state
            }
        }

        // ── Oil temperature high ──────────────────────────────
        if (_confirmed(HardwareConfig::safetyOilTempHigh && HardwareConfig::hasOilTemp && oilTempLimit > 0.0f
            && ed.oilTempHealthy && ed.oilTemp > oilTempLimit,
            now, oilTempConfirmMs, _oilTempSinceMs))
        {
            _trigger("OIL_TEMP_HIGH");
            return;
        }

        // ── Fuel pressure low ────────────────────────────────
        if (_confirmed(HardwareConfig::safetyFuelPressLow && HardwareConfig::hasFuelPress && fuelPressMin > 0.0f
            && m == SysMode::RUNNING && ed.fuelPressHealthy
            && ed.fuelPressure < fuelPressMin,
            now, fuelPressConfirmMs, _fuelPressSinceMs))
        {
            _trigger("FUEL_PRESS_LOW");
            return;
        }

        // ── Battery / bus undervoltage ────────────────────────
        if (_confirmed(HardwareConfig::safetyBattLow && battVoltMin > 0.0f
            && HardwareConfig::hasBattVoltage
            && ed.battHealthy && ed.battVoltage < battVoltMin,
            now, battLowConfirmMs, _battLowSinceMs))
        {
            _trigger("BATT_LOW");
            return;
        }

        // ── Surge detection (N1 oscillation variance) ─────────
        if (HardwareConfig::safetySurge && surgeRpmVariance > 0.0f
            && HardwareConfig::hasN1Rpm
            && m == SysMode::RUNNING && ed.n1Healthy)
        {
            if (ed.n1SampleSeq != _lastSurgeN1SampleSeq) {
                _lastSurgeN1SampleSeq = ed.n1SampleSeq;
                // Push N1 sample into circular buffer
                _n1Buf[_n1BufIdx] = ed.n1Rpm;
                _n1BufIdx = (_n1BufIdx + 1) % SURGE_BUF;
                if (_n1BufCount < SURGE_BUF) _n1BufCount++;

                if (_n1BufCount >= SURGE_BUF) {
                    // Detrend before measuring oscillation energy. A monotonic RPM
                    // ramp is normal turbine behavior, not compressor surge.
                    float sum = 0.0f;
                    for (uint8_t i = 0; i < SURGE_BUF; i++) sum += _n1Buf[i];
                    float mean = sum / SURGE_BUF;
                    const float xMean = (SURGE_BUF - 1) * 0.5f;
                    float slopeNum = 0.0f, slopeDen = 0.0f;
                    for (uint8_t i = 0; i < SURGE_BUF; i++) {
                        float x = i - xMean;
                        slopeNum += x * (_n1Buf[(_n1BufIdx + i) % SURGE_BUF] - mean);
                        slopeDen += x * x;
                    }
                    float slope = slopeDen > 0.0f ? slopeNum / slopeDen : 0.0f;
                    float var = 0.0f, prevDelta = 0.0f;
                    uint8_t reversals = 0;
                    for (uint8_t i = 0; i < SURGE_BUF; i++) {
                        float sample = _n1Buf[(_n1BufIdx + i) % SURGE_BUF];
                        float d = sample - (mean + slope * (i - xMean));
                        var += d * d;
                        if (i > 0) {
                            float prev = _n1Buf[(_n1BufIdx + i - 1) % SURGE_BUF];
                            float delta = sample - prev;
                            if (fabsf(delta) > 1.0f && fabsf(prevDelta) > 1.0f &&
                                ((delta > 0.0f) != (prevDelta > 0.0f))) ++reversals;
                            if (fabsf(delta) > 1.0f) prevDelta = delta;
                        }
                    }
                    var /= SURGE_BUF;

                    bool candidate = var > surgeRpmVariance && reversals >= 2;
                    _surgeConfirmWindows = candidate
                        ? (uint8_t)(_surgeConfirmWindows < 2 ? _surgeConfirmWindows + 1 : 2)
                        : 0;
                    ed.surgeDetected = _surgeConfirmWindows >= 2;
                    if (ed.surgeDetected) {
                        _trigger("SURGE");
                        return;
                    }
                }
            }
        } else {
            ed.surgeDetected = false;
            _resetSurge();
        }

        // ── Underspeed ────────────────────────────────────────
        // RUNNING: fire immediately if N1 drops below minRpm at any time.
        // STARTUP: only fire if N1 previously crossed minRpm and then fell back
        //          (genuine stall during spool-up, not the normal crank-up phase
        //          where the engine must pass through 0→minRpm on its way to idle).
        if (HardwareConfig::hasN1Rpm && m == SysMode::RUNNING) {
            if (minRpm > 0.0f && ed.n1Healthy && ed.n1Rpm < minRpm) {
                if (HardwareConfig::safetyFlameout && ed.flameMonitorActive
                    && _effectiveFlameoutSource() == 2) {
                    return;
                }
                _trigger("UNDERSPEED");
                return;
            }
        }

        // If an enabled hard protection loses its sensor, do not silently
        // remove that protection. ThrottleSlew freezes fuel increases at once;
        // confirmation prevents one quantised JUMP sample from latching the
        // persistent Reduced-Power Mode.
        if ((m == SysMode::STARTUP || m == SysMode::RUNNING) &&
            ed.limpOverrideSensor != FeedbackRequirements::NONE) {
            const uint32_t observedFailure =
                m == SysMode::STARTUP
                    ? FeedbackRequirements::requiredStartFailureMask(ed, millis())
                    : FeedbackRequirements::protectionFailureMask(ed, millis());
            const uint32_t additionalFailure =
                observedFailure & ~ed.limpOverrideSensor;
            if (additionalFailure != FeedbackRequirements::NONE) {
                snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                         "Reduced-power operation stopped: %s feedback also failed while %s was overridden.",
                         FeedbackRequirements::sensorName(additionalFailure & (~additionalFailure + 1UL)),
                         FeedbackRequirements::sensorName(ed.limpOverrideSensor));
                _trigger("MULTIPLE_SENSOR_FAILURE");
                return;
            }
        }

        if (m == SysMode::RUNNING && !ed.limpMode) {
            const bool n1Blind = HardwareConfig::hasN1Rpm &&
                FeedbackRequirements::n1ForProtectionOrControl() && !ed.n1Healthy;
            const bool n2Blind = HardwareConfig::hasN2Rpm &&
                FeedbackRequirements::n2ForProtectionOrControl() && !ed.n2Healthy;
            bool protectionBlind =
                (HardwareConfig::safetyOvertemp && Config::effectiveEgtSource() != 0 && !Config::primaryEgtHealthy(ed)) ||
                ((HardwareConfig::safetyLowOil || HardwareConfig::safetyOilZero) && HardwareConfig::hasOilPress && !ed.oilHealthy) ||
                (HardwareConfig::hasOilLoop && !FeedbackRequirements::allOilLoopFeedbackHealthy(ed)) ||
                (HardwareConfig::safetyOilTempHigh && HardwareConfig::hasOilTemp && !ed.oilTempHealthy) ||
                (HardwareConfig::safetyFuelPressLow && HardwareConfig::hasFuelPress && !ed.fuelPressHealthy) ||
                (HardwareConfig::safetyBattLow && HardwareConfig::hasBattVoltage && !ed.battHealthy) ||
                (FeedbackRequirements::p1ForProtectionOrControl() && !ed.p1Healthy) ||
                (FeedbackRequirements::p2ForProtectionOrControl() && !ed.p2Healthy) ||
                (FeedbackRequirements::torqueForProtectionOrControl() && !ed.torqueHealthy) ||
                (HardwareConfig::safetyFlameout && _effectiveFlameoutSource() == 1 &&
                 HardwareConfig::hasFlame && !ed.flameHealthy) ||
                (HardwareConfig::hasOilPumpCurrentSensor && HardwareConfig::oilPumpCurrentMaxAmps > 0.0f &&
                 ed.oilPumpPct > 0.01f && !ed.oilPumpCurrentHealthy);
            for (uint8_t i = 0; i < reg.outputCount && !protectionBlind; ++i) {
                const auto& c = reg.outputs[i];
                if (c.installed && c.hasCurrent && c.currentMaxAmps > 0.0f &&
                    !reg.ownsCoreOutput(c) && ed.registryOutputDemand[i] > 0.001f &&
                    !ed.registryOutputCurrentHealthy[i]) protectionBlind = true;
            }
            const bool feedbackBlind = n1Blind || n2Blind || protectionBlind;
            if (_confirmed(feedbackBlind, millis(), FEEDBACK_LOSS_CONFIRM_MS,
                           _feedbackBlindSinceMs)) {
                ed.limpMode = true;
                const char* reason = n1Blind ? "LIMP: N1 feedback lost"
                    : n2Blind ? "LIMP: N2 feedback lost"
                    : "LIMP: safety sensor lost";
                strncpy(ed.lastEvent, reason, sizeof(ed.lastEvent) - 1);
                ed.lastEvent[sizeof(ed.lastEvent) - 1] = '\0';
            }
        } else if (m != SysMode::RUNNING || ed.limpMode) {
            _feedbackBlindSinceMs = 0;
        }
        if (HardwareConfig::hasN1Rpm && minRpm > 0.0f && m == SysMode::STARTUP && ed.n1Healthy) {
            // Track once N1 reaches minRpm so we know the engine has spooled through
            if (ed.n1Rpm >= minRpm) _startupSpooled = true;
            // Only fault if we already spooled past minRpm and now dropped below it
            if (_startupSpooled && ed.n1Rpm < minRpm) {
                _trigger("UNDERSPEED");
                return;
            }
        }
    }

    const char* lastFault() const { return _lastFault; }

private:
    static constexpr uint8_t SURGE_BUF = 10; // ~1 s of N1 samples at 100 ms interval
    // ≥2 (typically 3) fresh 100 ms RPM sensor samples must confirm overspeed.
    static constexpr unsigned long OVERSPEED_CONFIRM_MS = 250;
    // Fuel increases are blocked immediately; only the persistent degraded
    // mode latch is delayed to reject isolated unhealthy samples.
    static constexpr unsigned long FEEDBACK_LOSS_CONFIRM_MS = 500;
    // A hole in monitoring longer than this (skip-safety toggle, stall)
    // invalidates EGT rate history and any in-progress detection timestamps.
    static constexpr unsigned long CHECK_GAP_RESET_MS = 1500;

    ShutdownFn    _enterShutdown  = nullptr;
    ShutdownFn    _enterFault     = nullptr;
    RelightFn     _relight;
    unsigned long _lastCheckMs    = 0;
    unsigned long _flameoutMs     = 0;
    unsigned long _relightStartMs = 0;   // millis() when relight was first triggered; 0 = not active
    float         _relightStartEgt = 0.0f;
    const char*   _lastFault      = nullptr;
    float         _lastEgt        = -1.0f;   // for dEGT/dt calculation
    unsigned long _lastEgtMs      = 0;
    uint32_t      _lastEgtSampleSeq = 0;
    bool          _overspeedPending = false; // raw reading above rpmLimit, confirming
    unsigned long _overspeedSinceMs = 0;     // millis() when the overspeed reading began
    bool          _n2OverspeedPending = false;
    unsigned long _n2OverspeedSinceMs = 0;
    unsigned long _oilOvercurrentSinceMs = 0;
    unsigned long _registryOvercurrentSinceMs[ChannelRegistry::MAX_OUTPUT_CHANNELS] = {};
    unsigned long _oilUnderflowSinceMs[2] = {};
    bool          _oilUnderflowWarned[2] = {};
    unsigned long _lowOilSinceMs = 0;
    unsigned long _oilZeroSinceMs = 0;
    unsigned long _oilTempSinceMs = 0;
    unsigned long _fuelPressSinceMs = 0;
    unsigned long _battLowSinceMs = 0;
    unsigned long _p1TripSinceMs = 0;
    unsigned long _p2TripSinceMs = 0;
    unsigned long _torqueTripSinceMs = 0;
    unsigned long _feedbackBlindSinceMs = 0;
    bool          _startupSpooled = false;   // true once N1 ≥ minRpm during STARTUP
    float         _n1Buf[SURGE_BUF] = {};   // circular buffer for surge detection
    uint8_t       _n1BufIdx       = 0;
    uint8_t       _n1BufCount     = 0;
    uint8_t       _surgeConfirmWindows = 0;
    uint32_t      _lastSurgeN1SampleSeq = 0;

    static bool _confirmed(bool condition, unsigned long now, uint32_t delayMs,
                           unsigned long& sinceMs) {
        if (!condition) { sinceMs = 0; return false; }
        if (delayMs == 0) return true;
        if (sinceMs == 0) { sinceMs = now; return false; }
        return now - sinceMs >= delayMs;
    }

    bool _checkOilFlow(EngineData& ed, SysMode mode) {
        // Optional supervision is attached independently to the main and
        // scavenge pump outputs. Missing/unhealthy feedback means flow cannot
        // be trusted. The default remains a warning; shutdown is opt-in and
        // applies only while starting or running.
        const auto& reg = HardwareConfig::channelRegistry;
        const unsigned long now = millis();
        bool anyUnderflow = false;
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            const auto& c = reg.outputs[i];
            const int8_t slot = !strcmp(c.purpose, "oil_pump") ? 0
                                : !strcmp(c.purpose, "scavenge_pump") ? 1 : -1;
            if (slot < 0) continue;
            const char* inputPurpose = slot == 0 ? "oil_flow" : "scavenge_flow";
            bool underflow = false;
            if (c.installed && c.hasFlowMonitor && c.minimumFlow > 0.0f &&
                ed.registryOutputDemand[i] > 0.001f) {
                int8_t inputIndex = -1;
                for (uint8_t j = 0; j < reg.inputCount; ++j)
                    if (reg.inputs[j].installed && !strcmp(reg.inputs[j].purpose, inputPurpose)) {
                        inputIndex = (int8_t)j;
                        break;
                    }
                underflow = inputIndex < 0 ||
                            !ed.registryInputHealthy[(uint8_t)inputIndex] ||
                            ed.registryInputValue[(uint8_t)inputIndex] < c.minimumFlow;
            }
            anyUnderflow = anyUnderflow || underflow;
            if (!underflow) {
                _oilUnderflowSinceMs[(uint8_t)slot] = 0;
                _oilUnderflowWarned[(uint8_t)slot] = false;
                continue;
            }
            if (_oilUnderflowSinceMs[(uint8_t)slot] == 0) {
                _oilUnderflowSinceMs[(uint8_t)slot] = now;
                snprintf(ed.lastEvent, sizeof(ed.lastEvent), "WARNING: %s low/no flow",
                         c.name[0] ? c.name : c.id);
            } else if (now - _oilUnderflowSinceMs[(uint8_t)slot] >= Config::oilPumpUnderflowDelayMs) {
                if (!_oilUnderflowWarned[(uint8_t)slot]) {
                    snprintf(ed.lastEvent, sizeof(ed.lastEvent), "WARNING: %s flow fault",
                             c.name[0] ? c.name : c.id);
                    _oilUnderflowWarned[(uint8_t)slot] = true;
                }
                if (Config::shutdownOnOilUnderflow &&
                    (mode == SysMode::STARTUP || mode == SysMode::RUNNING)) {
                    ed.oilFlowWarningActive = true;
                    _trigger("OIL_FLOW_LOW");
                    return true;
                }
            }
        }
        ed.oilFlowWarningActive = anyUnderflow;
        return false;
    }

    void _resetDwellConfirmations(bool resetOilFlow = true) {
        _oilOvercurrentSinceMs = 0;
        memset(_registryOvercurrentSinceMs, 0, sizeof(_registryOvercurrentSinceMs));
        if (resetOilFlow) {
            memset(_oilUnderflowSinceMs, 0, sizeof(_oilUnderflowSinceMs));
            memset(_oilUnderflowWarned, 0, sizeof(_oilUnderflowWarned));
            EngineData::instance().oilFlowWarningActive = false;
        }
        _lowOilSinceMs = 0;
        _oilZeroSinceMs = 0;
        _oilTempSinceMs = 0;
        _fuelPressSinceMs = 0;
        _battLowSinceMs = 0;
        _p1TripSinceMs = 0;
        _p2TripSinceMs = 0;
        _torqueTripSinceMs = 0;
        _feedbackBlindSinceMs = 0;
    }

    void _resetSurge() {
        _n1BufIdx = 0;
        _n1BufCount = 0;
        _surgeConfirmWindows = 0;
        _lastSurgeN1SampleSeq = 0;
    }

    int _effectiveFlameoutSource() const {
        if (flameoutSource >= 1 && flameoutSource <= 3) return flameoutSource;
        if (HardwareConfig::hasFlame) return 1;
        if (HardwareConfig::hasN1Rpm) return 2;
        if (Config::effectiveEgtSource() != 0) return 3;
        return 0;
    }

    bool _flameoutSourceUsable() const {
        switch (_effectiveFlameoutSource()) {
            case 1: return HardwareConfig::hasFlame;
            case 2: return HardwareConfig::hasN1Rpm;
            case 3: return Config::effectiveEgtSource() != 0;
            default: return false;
        }
    }

    bool _flameoutLost(const EngineData& ed) const {
        switch (_effectiveFlameoutSource()) {
            case 1:
                return HardwareConfig::hasFlame && ed.flameHealthy && !ed.flameDetected;
            case 2: {
                float threshold = flameoutN1MinRpm > 0.0f ? flameoutN1MinRpm : minRpm;
                return HardwareConfig::hasN1Rpm && ed.n1Healthy && ed.n1Rpm < threshold;
            }
            case 3: {
                if (!Config::primaryEgtHealthy(ed)) return false;
                const float egt = Config::primaryEgtC(ed);
                const bool belowAndFalling = flameoutEgtBelowC > 0.0f
                    && egt <= flameoutEgtBelowC && ed.totRiseRate < 0.0f;
                const bool fallingRapidly = flameoutEgtFallRateCPerSec > 0.0f
                    && ed.totRiseRate <= -flameoutEgtFallRateCPerSec;
                return belowAndFalling || fallingRapidly;
            }
            default:
                return false;
        }
    }

    void _trigger(const char* code) {
        _lastFault = code;
        auto& ed = EngineData::instance();

        // Populate plain-language description for the web UI fault banner
        const char* desc = nullptr;
        if      (strcmp(code, "OVERSPEED")  == 0) desc =
            "Engine over-speed: RPM exceeded the safety limit.\n"
            "What to do: Wait for the engine to cool down fully. Check your RPM limit setting "
            "in Config and verify throttle calibration before the next start.";
        else if (strcmp(code, "N2_OVERSPEED") == 0) desc =
            "N2 over-speed: power-turbine RPM exceeded its hard shutdown limit.\n"
            "What to do: Do not restart until the driven load, shaft, coupling, N2 pickup, "
            "governor or propeller control, and configured N2 limit have been inspected.";
        else if (strcmp(code, "P1_HIGH") == 0) desc =
            "P1 pressure remained above its hard shutdown limit.\n"
            "What to do: Inspect the pressure pickup and calibration, compressor system, fuel schedule, and configured P1 trip before restarting.";
        else if (strcmp(code, "P2_HIGH") == 0) desc =
            "P2 pressure remained above its hard shutdown limit.\n"
            "What to do: Inspect the pressure pickup and calibration, downstream restriction, fuel schedule, and configured P2 trip before restarting.";
        else if (strcmp(code, "TORQUE_HIGH") == 0) desc =
            "Shaft torque remained above its hard shutdown limit.\n"
            "What to do: Inspect the driven load, coupling and torque calibration, then verify the configured torque trip before restarting.";
        else if (strcmp(code, "OVERTEMP")   == 0) desc =
            "Over-temperature: selected engine temperature source (TOT/TIT) exceeded the limit.\n"
            "What to do: Allow the engine to cool. Check your fuel flow, throttle calibration, "
            "and configured EGT limit. Inspect the turbine for damage if this was severe.";
        else if (strcmp(code, "LOW_OIL")    == 0) desc =
            "Low oil pressure during operation.\n"
            "What to do: Do not restart until you have checked the oil level, oil pump, "
            "oil lines, and fittings for leaks. Verify oil pressure sensor calibration.";
        else if (strcmp(code, "OIL_ZERO")   == 0) desc =
            "Oil pressure read near zero - possible pump failure or broken fitting.\n"
            "What to do: Inspect oil pump, lines, and fittings before any restart. "
            "Do not run the engine until oil supply is confirmed.";
        else if (strcmp(code, "OIL_PUMP_OVERCURRENT") == 0) desc =
            "Oil pump current remained above its configured limit.\n"
            "What to do: Check the pump, driver, wiring, oil viscosity and current-sensor calibration before restarting.";
        else if (strcmp(code, "OIL_FLOW_LOW") == 0) desc =
            "A monitored oil pump did not produce the configured minimum flow for the confirmation time.\n"
            "What to do: Check oil level, pump operation, filters, lines and flow-meter calibration before restarting.";
        else if (strcmp(code, "FLAMEOUT")   == 0) desc =
            "Flameout: combustion was lost according to the configured flameout source, and relight was not possible.\n"
            "What to do: Check fuel supply, fuel valve, and the selected flameout sensor/source. "
            "Ensure ignition system is working. Try a normal start.";
        else if (strcmp(code, "UNDERSPEED") == 0) desc =
            "Under-speed: RPM dropped below the minimum running threshold.\n"
            "What to do: Check fuel supply and throttle settings. "
            "Verify the RPM sensor is reading correctly.";
        else if (strcmp(code, "HOT_START")  == 0) desc =
            "Hot start aborted: exhaust temperature was still too high to start safely.\n"
            "What to do: Wait for the engine to cool further before attempting another start. "
            "Increase the cool-down time if this keeps happening.";
        else if (strcmp(code, "TIT_OVERTEMP")  == 0) desc =
            "Turbine inlet temperature (TIT) exceeded the safety limit.\n"
            "What to do: Allow full cool-down. Check combustion system, fuel flow, and "
            "verify TIT limit is correct for your engine. Inspect turbine wheel for damage.";
        else if (strcmp(code, "OIL_TEMP_HIGH") == 0) desc =
            "Engine oil temperature too high.\n"
            "What to do: Allow the engine to cool down. Check oil cooler (if fitted), "
            "oil level, and flow rate. Reduce run duration until the cause is found.";
        else if (strcmp(code, "FUEL_PRESS_LOW")== 0) desc =
            "Fuel pressure dropped below the minimum threshold during operation.\n"
            "What to do: Check fuel tank level, fuel filter, pump, and lines. "
            "Inspect for leaks or blockages before attempting another run.";
        else if (strcmp(code, "BATT_LOW")      == 0) desc =
            "Battery / bus voltage too low - risk of control system brownout.\n"
            "What to do: Charge or replace the battery. Check power wiring for resistance. "
            "Do not run the engine until the voltage is stable above the limit.";
        else if (strcmp(code, "SURGE")         == 0) desc =
            "Compressor surge detected: N1 RPM is oscillating abnormally.\n"
            "What to do: The engine has been shut down to prevent compressor damage. "
            "Check throttle slew rate settings, compressor inlet for blockage, "
            "and reduce throttle advance rate to prevent recurrence.";
        else if (strcmp(code, "MULTIPLE_SENSOR_FAILURE") == 0) {
            static char multipleSensorDesc[192];
            snprintf(multipleSensorDesc, sizeof(multipleSensorDesc),
                     "Reduced-power operation stopped: another required sensor failed while %s was overridden. "
                     "Inspect both sensor circuits before restarting.",
                     FeedbackRequirements::sensorName(ed.limpOverrideSensor));
            desc = multipleSensorDesc;
        }
        // Fallback for unknown / DI-channel fault codes — generate a generic message
        char _fallbackDesc[192];
        if (!desc) {
            snprintf(_fallbackDesc, sizeof(_fallbackDesc),
                "Safety fault: %s. Engine has been shut down as a precaution.\n"
                "Check the event log for sensor readings at the time of the fault "
                "and review relevant calibration and limit settings before restarting.",
                code);
            desc = _fallbackDesc;
        }

        ed.faultDescription[0] = '\0';  // clear previous fault message before writing
        strncpy(ed.faultDescription, desc, sizeof(ed.faultDescription) - 1);
        ed.faultDescription[sizeof(ed.faultDescription) - 1] = '\0';

        if (_enterFault) _enterFault();   // enterFaultShutdown() — logs FAULT:*, sets lastEvent
    }
};
