#pragma once
#include "../../engine/EngineData.h"
#include "../../engine/Types.h"
#include "../../system/HardwareConfig.h"
#include "hardware_profile.h"
#include <Arduino.h>
#include "esp32-hal-rgb-led.h"

// ============================================================
//  StatusLED — mode-driven blink indicator
//
//  Pin is set at runtime via HardwareConfig::statusLedPin.
//  Only active when HardwareConfig::hasStatusLed == true and
//  statusLedPin >= 0.
//
//  Blink patterns:
//    STANDBY  — 1 blink  per cycle
//    STARTUP  — 2 blinks per cycle
//    RUNNING  — 3 blinks per cycle
//    SHUTDOWN — 4 blinks per cycle
//    FAULT    — rapid continuous 100 ms flash
//
//  Call StatusLED::begin() in setup(), StatusLED::tick() in loop().
//  tick() is non-blocking (millis-based state machine).
// ============================================================

namespace StatusLED {

// ── Config ────────────────────────────────────────────────────
// Deliberate enough to count reliably at a glance, including bright LEDs and
// phone-camera viewing, without making state changes feel sluggish.
static constexpr unsigned long BLINK_ON_MS    = 140;
static constexpr unsigned long BLINK_OFF_MS   = 220;
static constexpr unsigned long BURST_PAUSE_MS = 1800;
static constexpr unsigned long FAULT_PERIOD_MS= 100;

// ── State ─────────────────────────────────────────────────────
static int           _blinksRemaining = 0;
static bool          _ledOn           = false;
static unsigned long _nextMs          = 0;
static bool          _inPause         = false;
static SysMode       _lastRenderedMode = SysMode::STANDBY;
static uint32_t      _lastStateColor  = 0;
static constexpr int AUTO_S3_RGB_STATUS_LED_PIN = -2;
static constexpr uint8_t S3_RGB_LEVEL = 64;

static bool _isRgbStatusLed(int pin) {
    return HardwareConfig::statusLedType == 1 && pin >= 0;
}

static int _statusPin() {
    int pin = HardwareConfig::statusLedPin;
#if defined(OT_PLATFORM_ESP32S3)
    if (pin == AUTO_S3_RGB_STATUS_LED_PIN || pin == 38) return 48;
#endif
    return pin;
}

static void _writeLed(int pin, bool on) {
    if (_isRgbStatusLed(pin)) {
        uint32_t c = on ? HardwareConfig::statusLedBlinkColor : 0;
        rgbLedWrite((uint8_t)pin,
                    (uint8_t)((((c >> 16) & 0xFFu) * S3_RGB_LEVEL) / 255u),
                    (uint8_t)((((c >> 8)  & 0xFFu) * S3_RGB_LEVEL) / 255u),
                    (uint8_t)(((c & 0xFFu) * S3_RGB_LEVEL) / 255u));
        return;
    }
    const bool level = HardwareConfig::statusLedActiveH ? on : !on;
    digitalWrite(pin, level ? HIGH : LOW);
}

static uint32_t _colorForMode(SysMode mode) {
    switch (mode) {
        case SysMode::STARTUP:  return HardwareConfig::statusLedStartupColor;
        case SysMode::RUNNING:  return HardwareConfig::statusLedRunningColor;
        case SysMode::SHUTDOWN: return HardwareConfig::statusLedShutdownColor;
        case SysMode::STANDBY:
        default:                return HardwareConfig::statusLedStandbyColor;
    }
}

static uint8_t _scaledChannel(uint32_t color, uint8_t shift, bool half) {
    uint16_t value = (uint16_t)(((color >> shift) & 0xFFu) * S3_RGB_LEVEL) / 255u;
    if (half) value /= 2u;
    return (uint8_t)value;
}

static void _writeRgbColor(int pin, uint32_t color, bool on, bool half = false) {
    if (!on) {
        rgbLedWrite((uint8_t)pin, 0, 0, 0);
        return;
    }
    rgbLedWrite((uint8_t)pin,
                _scaledChannel(color, 16, half),
                _scaledChannel(color, 8, half),
                _scaledChannel(color, 0, half));
}

static void _tickColorMode(int pin, unsigned long now, SysMode mode) {
    if (mode == SysMode::FAULT) {
        // FAULT must always be visible. Reuse the last rendered state colour,
        // but if that is black (nothing rendered yet, or a state colour set to
        // 0x000000) flash red instead of the standby colour — which could also
        // be configured black and leave the fault indication invisible.
        uint32_t faultColor = _lastStateColor ? _lastStateColor : 0xFF0000u;
        _ledOn = !_ledOn;
        _writeRgbColor(pin, faultColor, _ledOn, true);
        _nextMs = now + FAULT_PERIOD_MS;
        return;
    }

    const uint32_t color = _colorForMode(mode);
    if (mode != _lastRenderedMode || color != _lastStateColor || !_ledOn) {
        _lastStateColor = color;
        _lastRenderedMode = mode;
        _ledOn = true;
        _writeRgbColor(pin, color, true, false);
    }
    _nextMs = now + 100;
}

static void _writeStatusLed(bool on) {
    int pin = _statusPin();
    if (pin >= 0) _writeLed(pin, on);
}

static int _blinksForMode(SysMode m) {
    switch (m) {
        case SysMode::STANDBY:  return 1;
        case SysMode::STARTUP:  return 2;
        case SysMode::RUNNING:  return 3;
        case SysMode::SHUTDOWN: return 4;
        case SysMode::FAULT:    return -1;
        default:                return 1;
    }
}

inline void begin() {
    int pin = _statusPin();
    if (pin < 0) return;
    if (!_isRgbStatusLed(pin))
        pinMode(pin, OUTPUT);
    _writeStatusLed(false);
    _nextMs          = millis();
    _blinksRemaining = 0;
    _inPause         = true;
    _ledOn           = false;
    _lastRenderedMode = SysMode::STANDBY;
    _lastStateColor = 0;
    if (_isRgbStatusLed(pin)) {
        _ledOn = true;
        _blinksRemaining = 1;
        _inPause = false;
        if (HardwareConfig::statusLedMode == 1) {
            _lastStateColor = _colorForMode(SysMode::STANDBY);
            _writeRgbColor(pin, _lastStateColor, true, false);
        } else {
            _writeStatusLed(true);
        }
        _nextMs = millis() + 300;
    }
}

inline void tick() {
    int pin = _statusPin();
    if (pin < 0) return;
    unsigned long now = millis();
    if ((int32_t)(now - _nextMs) < 0) return;

    SysMode mode = EngineData::instance().mode;

    if (_isRgbStatusLed(pin) && HardwareConfig::statusLedMode == 1) {
        _tickColorMode(pin, now, mode);
        return;
    }

    if (mode == SysMode::FAULT) {
        _ledOn = !_ledOn;
        _writeStatusLed(_ledOn);
        _nextMs = now + FAULT_PERIOD_MS;
        return;
    }

    int target = _blinksForMode(mode);

    if (_inPause) {
        _blinksRemaining = target;
        _inPause         = false;
    }

    if (_blinksRemaining > 0) {
        if (!_ledOn) {
            _ledOn = true;
            _writeStatusLed(true);
            _nextMs = now + BLINK_ON_MS;
        } else {
            _ledOn = false;
            _writeStatusLed(false);
            _blinksRemaining--;
            if (_blinksRemaining > 0) {
                _nextMs = now + BLINK_OFF_MS;
            } else {
                _nextMs  = now + BURST_PAUSE_MS;
                _inPause = true;
            }
        }
    }
}

// Force the status LED dark. Used when the status LED is disabled in the
// hardware config: simply not ticking is not enough because the addressable S3
// onboard LED latches its last colour across a soft reboot, so it must be
// explicitly cleared or it stays lit.
inline void off() {
    int pin = _statusPin();
    if (pin >= 0) {
        if (_isRgbStatusLed(pin)) rgbLedWrite((uint8_t)pin, 0, 0, 0);
        else {
            pinMode(pin, OUTPUT);
            digitalWrite(pin, HardwareConfig::statusLedActiveH ? LOW : HIGH);
        }
    }
#if defined(OT_PLATFORM_ESP32S3)
    // Only clear the onboard addressable LED when the configured status LED
    // actually points at it.  Some S3 boards expose GPIO48 differently; forcing
    // a NeoPixel write with statusLedPin=-1 can wedge boot before the UI comes
    // up.  Disabled + no configured pin means "leave hardware alone".
    if (HardwareConfig::statusLedPin == AUTO_S3_RGB_STATUS_LED_PIN ||
        HardwareConfig::statusLedPin == 38 ||
        HardwareConfig::statusLedPin == 48) {
        rgbLedWrite(48, 0, 0, 0);
    }
#endif
    _ledOn           = false;
    _blinksRemaining = 0;
    _inPause         = true;
}

} // namespace StatusLED
