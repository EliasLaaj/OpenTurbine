#pragma once
#include "IActuator.h"
#include "RelayDemand.h"
#include <Arduino.h>

// Digital relay / MOSFET actuator.
// set(0) → off; any intentional nonzero demand → on.
// activeHigh = true for active-high logic (most MOSFETs);
// activeHigh = false for active-low relay boards.
class RelayActuator : public IActuator {
public:
    RelayActuator(int pin, bool activeHigh, const char* actuatorName)
        : _pin(pin), _activeHigh(activeHigh), _name(actuatorName) {}

    // Runtime-pin overload — update params then initialise.
    void begin(int pin, bool activeHigh) {
        _pin        = pin;
        _activeHigh = activeHigh;
        begin();
    }

    void begin() override {
        if (_pin < 0) { _ready = false; return; }
        // Preload the inactive output latch before enabling the driver. This
        // avoids an active-low pulse during the INPUT -> OUTPUT transition.
        digitalWrite(_pin, _activeHigh ? LOW : HIGH);
        pinMode(_pin, OUTPUT);
        _ready = true;
        _hasLast = false;
        off();
    }

    void set(float value) override {
        _write(RelayDemand::requested(value));
    }

    void off() override {
        _write(false);
    }

    const char* name() override { return _name; }
    bool isReady() const override { return _ready; }

    // Convenience for boolean callers
    void setOn(bool on) { _write(on); }

private:
    void _write(bool on) {
        if (!_ready) return;
        if (_hasLast && on == _lastOn) return;
        digitalWrite(_pin, (_activeHigh ? on : !on) ? HIGH : LOW);
        _lastOn = on;
        _hasLast = true;
    }

    int         _pin;
    bool        _activeHigh;
    bool        _lastOn = false;
    bool        _hasLast = false;
    bool        _ready = false;
    const char* _name;
};
