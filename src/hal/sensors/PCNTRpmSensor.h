#pragma once
#include "ISensor.h"
#include "driver/pulse_cnt.h"
#include "../../engine/Types.h"
#include <Arduino.h>

// ============================================================
//  PCNTRpmSensor — shaft RPM using ESP32 hardware pulse counter
//
//  Uses the IDF5 PCNT unit API (driver/pulse_cnt.h).
//  Hardware counting is interrupt-free and glitch-filtered.
//  RPM computed from count delta every UPDATE_INTERVAL_MS.
//  Reports RpmHealth fault bits (JUMP / ZERO_STUCK; see _updateHealth for
//  why SATURATED is not raised by an edge counter).
//  Brief ZERO_GLITCH samples are tolerated (RpmHealth::isTrustworthy):
//  the last real reading is held instead of publishing a healthy 0 RPM.
// ============================================================

class PCNTRpmSensor : public ISensor {
public:
    PCNTRpmSensor(int pin, float pulsesPerRev, const char* sensorName)
        : _pin(pin), _ppr(pulsesPerRev), _name(sensorName) {}

    // Runtime-pin overload: update pin/ppr then initialise hardware.
    // Called by Hardware::initSensors() when runtime config is loaded.
    void begin(int pin, float ppr) {
        _pin = pin;
        _ppr = ppr;
        begin();
    }

    void begin() override {
        _cleanup();
        _ready = false;
        if (_pin < 0) return;
        if (_ppr <= 0.0f) {
            Serial.printf("[%s] Invalid pulses/rev %.3f; using 1.0\n", _name, (double)_ppr);
            _ppr = 1.0f;
        }
        pcnt_unit_config_t unitCfg = {
            .low_limit  = -1,
            .high_limit = H_LIM,
            .intr_priority = 0,
            // accum_count=0: we track wraps manually in int64_t so the
            // accumulated total never overflows (the IDF's own software
            // accumulator is int32, which wraps after ~14 days at max RPM).
            .flags = { .accum_count = 0 }
        };
        esp_err_t err = pcnt_new_unit(&unitCfg, &_unit);
        if (err != ESP_OK) return _fail("allocation", err);

        // Glitch filter: ignore pulses shorter than 5000 ns (5 us).
        pcnt_glitch_filter_config_t flt = { .max_glitch_ns = 5000 };
        err = pcnt_unit_set_glitch_filter(_unit, &flt);
        if (err != ESP_OK) return _fail("glitch filter", err);

        pcnt_chan_config_t chanCfg = {
            .edge_gpio_num  = _pin,
            .level_gpio_num = -1,  // not used (IDF5 — no PCNT_PIN_NOT_USED macro)
            .flags = {}
        };
        err = pcnt_new_channel(_unit, &chanCfg, &_channel);
        if (err != ESP_OK) return _fail("channel allocation", err);

        // Count on rising edge only
        err = (pcnt_channel_set_edge_action(_channel,
            PCNT_CHANNEL_EDGE_ACTION_INCREASE,   // rising  → +1
            PCNT_CHANNEL_EDGE_ACTION_HOLD));      // falling → no change

        if (err != ESP_OK) return _fail("edge action", err);
        err = pcnt_unit_enable(_unit);
        if (err != ESP_OK) return _fail("enable", err);
        _enabled = true;
        err = pcnt_unit_clear_count(_unit);
        if (err != ESP_OK) return _fail("clear", err);
        err = pcnt_unit_start(_unit);
        if (err != ESP_OK) return _fail("start", err);
        _started = true;

        _lastMs    = millis();
        _lastCount = 0;
        _accumPulses = 0;
        _rpm       = 0;
        _health.clear();
        _sampleSeq = 0;
        _ready = true;
    }

    void update() override {
        if (!_ready) return;
        unsigned long now = millis();
        unsigned long dt  = now - _lastMs;
        if (dt < _nextIntervalMs()) return;

        // Read the raw hardware counter (bounded 0…H_LIM-1).
        // We use accum_count=0 and accumulate ourselves in int64_t so the
        // total never wraps — the IDF's own int32 accumulator overflows
        // after ~14 days at max RPM with typical PPR values.
        int rawInt = 0;
        esp_err_t readErr = pcnt_unit_get_count(_unit, &rawInt);
        if (readErr != ESP_OK) {
            Serial.printf("[%s] PCNT runtime read failed: %s; feedback disabled without reboot\n",
                          _name, esp_err_to_name(readErr));
            _health.set(RpmHealth::SATURATED);
            _ready = false;
            return;
        }

        int64_t delta = (int64_t)rawInt - _lastCount;
        if (delta < 0) delta += H_LIM;   // hardware counter wrapped 0…H_LIM
        _accumPulses += delta;

        float newRpm = ((float)delta / _ppr) * (60000.0f / (float)dt);

        _updateHealth(newRpm, dt);

        // ZERO_GLITCH is tolerable (Types.h isTrustworthy): hold the last real
        // reading for the few glitch ticks instead of publishing a healthy
        // 0 RPM, which would trip UNDERSPEED / latch limp mode instantly.
        if (_health.faults & RpmHealth::ZERO_GLITCH) {
            newRpm = _holdRpm;
        } else if (newRpm >= 1.0f) {
            _holdRpm = newRpm;
        }
        _rpm       = newRpm;
        _lastMs    = now;
        _lastCount = (int64_t)rawInt;
        ++_sampleSeq;
    }

    float       getValue()  override { return _rpm; }
    // ZERO_GLITCH alone does not fail health — see RpmHealth::isTrustworthy().
    bool        isHealthy() override { return _health.isTrustworthy(); }
    const char* name()      override { return _name; }
    uint32_t sampleSequence() override { return _sampleSeq; }
    uint32_t sampleTimestampMs() override { return _lastMs; }
    bool hardwareReady() const { return _ready; }

    void resetHealth() {
        _health.clear();
        _zeroCount = 0;
        _prevRpm   = 0;
        _holdRpm   = 0;
    }

    // Configurable health thresholds — set from applyConfig() via Hardware.h
    float jumpThreshold  = 0.40f;  // fraction of rpmLimit per second → JUMP fault
    int   zeroStuckLimit = 5;      // ticks at UPDATE_INTERVAL_MS before ZERO_STUCK fault
    float rpmLimit       = 120000.0f; // sensor plausibility ceiling (normally 2x hard shutdown)

private:
    static constexpr int           H_LIM              = 30000;
    static constexpr unsigned long MIN_INTERVAL_MS = 40;
    static constexpr unsigned long MAX_INTERVAL_MS = 250;
    static constexpr float TARGET_PULSES_PER_SAMPLE = 6.0f;

    int         _pin;
    float       _ppr;
    const char* _name;

    pcnt_unit_handle_t _unit        = nullptr;
    pcnt_channel_handle_t _channel  = nullptr;
    unsigned long      _lastMs      = 0;
    int64_t            _lastCount   = 0;   // last raw hardware counter value (0…H_LIM)
    int64_t            _accumPulses = 0;   // total pulses since begin() — never overflows
    float              _rpm         = 0;
    float              _prevRpm  = 0;
    float              _holdRpm  = 0;   // last real (non-glitch) reading, held during ZERO_GLITCH
    int                _zeroCount= 0;
    RpmHealth          _health;
    uint32_t           _sampleSeq = 0;
    bool               _ready = false;
    bool               _enabled = false;
    bool               _started = false;

    unsigned long _nextIntervalMs() const {
        if (_rpm < 1.0f || _ppr <= 0.0f) return MAX_INTERVAL_MS;
        const float ms = TARGET_PULSES_PER_SAMPLE * 60000.0f / (_rpm * _ppr);
        return (unsigned long)constrain(ms, (float)MIN_INTERVAL_MS, (float)MAX_INTERVAL_MS);
    }

    void _cleanup() {
        if (_unit && _started) pcnt_unit_stop(_unit);
        _started = false;
        if (_channel) pcnt_del_channel(_channel);
        _channel = nullptr;
        if (_unit && _enabled) pcnt_unit_disable(_unit);
        _enabled = false;
        if (_unit) pcnt_del_unit(_unit);
        _unit = nullptr;
    }

    void _fail(const char* stage, esp_err_t err) {
        Serial.printf("[%s] PCNT %s failed: %s; channel unavailable without reboot\n",
                      _name, stage, esp_err_to_name(err));
        _health.set(RpmHealth::SATURATED);
        _cleanup();
        _ready = false;
    }

    void _updateHealth(float rpm, unsigned long dt) {
        _health.clear();

        // "Clearly running" reference: a small fraction of the engine's RPM
        // limit, floored so it stays meaningful on a low-limit shaft (e.g. a
        // free power turbine) and never triggers on sensor noise. This replaces
        // a fixed 2000 RPM, which left a detection gap for any shaft that idles
        // below 2000 RPM — a dead sensor dropping it to zero was never flagged.
        // rpmLimit is the 2x-hard-limit sensor plausibility ceiling. Health
        // tuning remains referenced to the real hard limit (half that value).
        const float runningRpm = fmaxf(rpmLimit * 0.015f, 200.0f);
        // Preserve the historical zero-stuck delay in milliseconds even as
        // the adaptive RPM sample window changes with pulse rate.
        int requiredZeros = zeroStuckLimit > 0
            ? (int)ceilf((zeroStuckLimit * 100.0f) / fmaxf(1.0f, (float)dt))
            : 1;

        // Note: RpmHealth::SATURATED ("stuck at max") is intentionally not
        // raised here. With a bare edge counter a stuck-high line produces no
        // edges, so it is indistinguishable from a silent sensor and is already
        // covered by ZERO_STUCK below. A genuinely over-range reading is
        // deliberately NOT flagged unhealthy, so it can never suppress the
        // raw-reading overspeed trip.

        // Implausible jump remains scaled from the actual hard shutdown,
        // which is half the automatic sensor plausibility ceiling.
        if (_prevRpm > 500.0f && rpm > 0) {
            float maxDeltaRpm = jumpThreshold * (rpmLimit * 0.5f) * (dt / 1000.0f);
            // A short adaptive window has a coarser one-pulse RPM quantum.
            // Permit two counts of unavoidable window-edge quantization so a
            // steady pulse train cannot alternate into a false JUMP fault.
            const float pulseQuantumRpm = (60000.0f / fmaxf(1.0f, _ppr)) / fmaxf(1.0f, (float)dt);
            maxDeltaRpm += 2.0f * pulseQuantumRpm;
            if (fabsf(rpm - _prevRpm) > maxDeltaRpm) {
                _health.set(RpmHealth::JUMP);
            }
        }

        // Zero-stuck: shaft was clearly running but now reads zero.
        // The streak continues while the reading stays zero (_zeroCount > 0):
        // _prevRpm alone is 0 from the second zero tick onward and would
        // reset the counter, making ZERO_STUCK unreachable.
        if (rpm < 1.0f && (_prevRpm > runningRpm || _zeroCount > 0)) {
            if (++_zeroCount >= requiredZeros) {
                _health.set(RpmHealth::ZERO_STUCK);
            } else {
                _health.set(RpmHealth::ZERO_GLITCH);
            }
        } else {
            _zeroCount = 0;
        }

        _prevRpm = rpm;
    }
};
