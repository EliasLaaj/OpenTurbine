#pragma once
#include <Arduino.h>
#include "../../hardware_profile.h"
#include "../system/Config.h"
#include "../system/HardwareConfig.h"
#include "../engine/EngineData.h"

// ============================================================
//  RCInput - hardware-level RC PWM input (runtime hardware selection)
//
//  *** EXPERIMENTAL — not yet field-tested with full edge-case coverage.
//  *** Prefer ADC pot input for new builds until this is validated.
//  *** RC PWM is susceptible to glitches from RF interference; ensure
//  *** rcFailsafeMs is set conservatively and test failsafe behaviour
//  *** on the bench before operating the engine.
//
//  Enabled by HardwareConfig::idleInputRcPwm / throttleInputRcPwm.
//  The GPIO pin is the same as the ADC version - only the signal
//  type changes.  Throttle and idle pulse widths are calibrated on the
//  Calibration page; rcFailsafeMs remains a shared timeout.
//
//  Outputs written:
//    ed.rcIdleValid / rcIdleNorm        (0.0–1.0) + synthesised idleInputRaw
//    ed.rcThrottleValid / rcThrottleNorm (0.0–1.0) + synthesised throttleInputRaw
//
//  Usage: RCInput::begin() once in setup(), RCInput::tick() each loop()
// ============================================================

class RCInput {
public:

    // ── Lifecycle ─────────────────────────────────────────────
    static void begin() {
        auto& hw = HardwareConfig::instance();
        if (hw.hasIdleInput && hw.idleInputRcPwm && hw.idleInputPin >= 0) {
            _idle.pin = hw.idleInputPin;
            pinMode(_idle.pin, INPUT);
            attachInterrupt(digitalPinToInterrupt(_idle.pin), _isrIdle, CHANGE);
            Serial.printf("[RCInput] idle input -> servo PWM on GPIO%d %d-%d us\n",
                _idle.pin, Config::idleMinRaw, Config::idleMaxRaw);
        }
        if (hw.hasThrottleInput && hw.throttleInputRcPwm && hw.throttleInputPin >= 0) {
            _thr.pin = hw.throttleInputPin;
            pinMode(_thr.pin, INPUT);
            attachInterrupt(digitalPinToInterrupt(_thr.pin), _isrThr, CHANGE);
            Serial.printf("[RCInput] throttle input -> servo PWM on GPIO%d %d-%d us\n",
                _thr.pin, Config::throttleMinRaw, Config::throttleMaxRaw);
        }
        if (hw.hasAfterburner && hw.abInputRcPwm && hw.abInputPin >= 0 &&
            !_registryAbCommandPresent()) {
            _ab.pin = hw.abInputPin;
            pinMode(_ab.pin, INPUT);
            attachInterrupt(digitalPinToInterrupt(_ab.pin), _isrAb, CHANGE);
            Serial.printf("[RCInput] AB command input -> servo PWM on GPIO%d %d-%d us\n",
                _ab.pin, hw.abInputMinUs, hw.abInputMaxUs);
        }
    }

    // ── Called each loop tick ─────────────────────────────────
    static void tick() {
        auto& ed = EngineData::instance();

        auto& hw = HardwareConfig::instance();
        if (hw.hasIdleInput && hw.idleInputRcPwm) {
            _updateCh(_idle, ed.rcIdleValid, ed.rcIdleNorm);
            ed.idleInputValid = ed.rcIdleValid;
            if (ed.rcIdleValid) {
                ed.idleInputRaw = (int)_idle.acceptedUs;
            } else {
                ed.idleInputRaw = Config::idleMinRaw;
            }
        }

        if (hw.hasThrottleInput && hw.throttleInputRcPwm) {
            _updateCh(_thr, ed.rcThrottleValid, ed.rcThrottleNorm);
            ed.throttleInputValid = ed.rcThrottleValid;
            if (ed.rcThrottleValid) {
                ed.throttleInputRaw = (int)_thr.acceptedUs;
            } else {
                ed.throttleInputRaw = Config::throttleMinRaw;
            }
        }
        if (hw.hasAfterburner && hw.abInputRcPwm && hw.abInputPin >= 0 &&
            !_registryAbCommandPresent() &&
            (hw.abTriggerSource == 3 || Config::abPumpControlMode == 2)) {
            _updateCh(_ab, ed.abInputValid, ed.abInputNorm);
            ed.abInputRaw = ed.abInputValid ? (int)(ed.abInputNorm * 4095.0f) : 0;
        }
    }

private:

    static bool _registryAbCommandPresent() {
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; ++i) {
            const auto& input = HardwareConfig::channelRegistry.inputs[i];
            if (!strcmp(input.purpose, "ab_command") &&
                ChannelRegistry::channelAddressable(input)) return true;
        }
        return false;
    }

    struct Ch {
        int               pin     = -1;
        volatile uint32_t riseUs  = 0;
        volatile uint32_t pulseUs = 0;
        volatile bool     fresh   = false;
        uint32_t          lastMs  = 0;
        uint32_t          acceptedUs = 0;
    };

    static Ch _thr;
    static Ch _idle;
    static Ch _ab;
    static portMUX_TYPE _mux;

    static void IRAM_ATTR _isrThr() {
        if (digitalRead(_thr.pin) == HIGH) {
            _thr.riseUs = micros();
        } else {
            uint32_t pw = micros() - _thr.riseUs;
            if (pw >= 500 && pw <= 2500) {
                portENTER_CRITICAL_ISR(&_mux);
                _thr.pulseUs = pw; _thr.fresh = true;
                portEXIT_CRITICAL_ISR(&_mux);
            }
        }
    }

    static void IRAM_ATTR _isrIdle() {
        if (digitalRead(_idle.pin) == HIGH) {
            _idle.riseUs = micros();
        } else {
            uint32_t pw = micros() - _idle.riseUs;
            if (pw >= 500 && pw <= 2500) {
                portENTER_CRITICAL_ISR(&_mux);
                _idle.pulseUs = pw; _idle.fresh = true;
                portEXIT_CRITICAL_ISR(&_mux);
            }
        }
    }

    static void IRAM_ATTR _isrAb() {
        if (digitalRead(_ab.pin) == HIGH) {
            _ab.riseUs = micros();
        } else {
            uint32_t pw = micros() - _ab.riseUs;
            if (pw >= 500 && pw <= 2500) {
                portENTER_CRITICAL_ISR(&_mux);
                _ab.pulseUs = pw; _ab.fresh = true;
                portEXIT_CRITICAL_ISR(&_mux);
            }
        }
    }

    static void _updateCh(Ch& ch, volatile bool& valid, volatile float& norm) {
        if (ch.pin < 0) { valid = false; return; }

        uint32_t now = millis();

        uint32_t pulseUs = 0;
        bool fresh = false;
        portENTER_CRITICAL(&_mux);
        fresh = ch.fresh;
        if (fresh) {
            pulseUs = ch.pulseUs;
            ch.fresh = false;
        }
        portEXIT_CRITICAL(&_mux);

        if (fresh) {
            ch.lastMs = now;
            bool isIdle = (&ch == &_idle);
            bool isAb = (&ch == &_ab);
            int minUs = isAb ? HardwareConfig::abInputMinUs : (isIdle ? Config::idleMinRaw : Config::throttleMinRaw);
            int maxUs = isAb ? HardwareConfig::abInputMaxUs : (isIdle ? Config::idleMaxRaw : Config::throttleMaxRaw);
            // ADC defaults are 0-4095. Until a servo channel has been
            // calibrated, use standard receiver pulse endpoints.
            if (minUs == 0 && maxUs == 4095) {
                minUs = 1000;
                maxUs = 2000;
            }
            int range = maxUs - minUs;
            if (range == 0) { valid = false; return; }  // misconfigured — guard div/0
            ch.acceptedUs = pulseUs;
            float n = (float)((int)pulseUs - minUs) / (float)range;
            norm  = constrain(n, 0.0f, 1.0f);
            valid = true;
        } else if (valid && (now - ch.lastMs) > (uint32_t)Config::rcFailsafeMs) {
            valid = false;
            norm  = 0.0f;
        }
    }
};

// Static member definitions (header-only, so inline)
inline RCInput::Ch RCInput::_thr{};
inline RCInput::Ch RCInput::_idle{};
inline RCInput::Ch RCInput::_ab{};
inline portMUX_TYPE RCInput::_mux = portMUX_INITIALIZER_UNLOCKED;
