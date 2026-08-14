#pragma once
#include "../actuators/RelayDemand.h"
#include "LossRecheck.h"
#include "../AdcThreshold.h"

#include <Arduino.h>
#include <Wire.h>
#include "../../system/ChannelRegistry.h"

// One shared, allocation-free I2C bus. Discovery is informational: only
// explicitly assigned registry channels affect control or consume slots.
class I2CDeviceManager {
public:
    enum Type : uint8_t { Unknown=0, Tca9554=1, Tla2528=2, Nau7802=3 };
    // Discovery metadata is diagnostic and low-rate. Packing saves 51 bytes
    // of the Classic ESP32's nearly exhausted static DRAM (17 entries ×
    // three bytes of natural padding); control values remain in aligned arrays.
    struct __attribute__((packed)) Device {
        uint8_t address;
        Type type;
        bool present;
        bool lossActive;
        uint32_t lastSeenMs;
        uint32_t lossSinceMs;
        uint16_t errors;
    };
    static constexpr uint8_t MAX_DEVICES = 17;

    static void begin(bool enabled, int sda, int scl, int interruptPin,
                      uint32_t frequency,
                      const ChannelRegistry& registry) {
        _enabled = enabled && sda >= 0 && scl >= 0 && sda != scl;
        _registry = &registry;
        for (uint8_t i = 0; i < registry.inputCount; ++i) {
            _adcDigitalState[i] = !registry.inputs[i].activeHigh;
            _adcConfig[i] = _adcConfigKey(registry.inputs[i]);
            _adcDigitalChannel[i] = ChannelRegistry::isSwitchCondition(registry.inputs[i]);
        }
        if (!_enabled) return;
        Wire.begin(sda, scl, constrain(frequency, 10000U, 400000U));
        // The I2C manager runs from the control loop. The framework default is
        // 50 ms, which is long enough for a stuck accessory bus to disturb fuel
        // control. All supported transactions are only a few bytes; 5 ms still
        // accommodates the user-selectable 10 kHz minimum bus rate.
        Wire.setTimeOut(5);
        _interruptPin = interruptPin;
        if (_interruptPin >= 0) pinMode(_interruptPin, INPUT_PULLUP);
        // A separately powered expander may retain an active output while the
        // ESP resets. Park configured relay channels before spending time
        // probing every possible accessory address.
        _parkAssignedRelayOutputs();
        _scan();
        _configureAssignedDevices();
    }

    static void requestScan() { if (_enabled) _scanRequested = true; }

    static void tick(bool allowDiscovery = true) {
        if (!_enabled || !_registry) return;
        const uint32_t now = millis();
        if (!allowDiscovery) _scanActive = false;
        if (allowDiscovery && !_scanActive &&
            (_scanRequested || now - _lastScanMs >= 5000UL)) {
            _scanRequested = false;
            _scanActive = true;
            _scanCursor = 0;
            _lastScanMs = now;
        }
        const bool interruptActive =
            _interruptPin >= 0 && digitalRead(_interruptPin) == LOW;
        if (!interruptActive && now - _lastServiceMs < 2UL) return;
        _lastServiceMs = now;
        if (_scanActive) {
            _scanStep();
            return;
        }
        _serviceOneInput();
    }

    static uint8_t deviceCount() { return _deviceCount; }
    static const Device& device(uint8_t i) { return _devices[i < _deviceCount ? i : 0]; }
    static bool enabled() { return _enabled; }

    static bool input(uint8_t registryIndex, float& value, int32_t& raw,
                      uint32_t& sequence, uint32_t& sampleMs) {
        if (registryIndex >= ChannelRegistry::MAX_INPUT_CHANNELS) return false;
        value = _values[registryIndex];
        raw = _raw[registryIndex];
        sequence = _sequence[registryIndex];
        sampleMs = _sampleMs[registryIndex];
        const auto& c = _registry->inputs[registryIndex];
        const Device* d = _find(c.i2cAddress, _typeForDriver(c.driver));
        return d && d->present && _valid[registryIndex] &&
               sampleMs && millis() - sampleMs <= _staleMs(c);
    }

    static bool writeOutput(const ChannelRegistry::Channel& c, float demand) {
        if (!_enabled || c.driver != ChannelRegistry::I2cRelay ||
            c.deviceChannel >= 8 || !_present(c.i2cAddress, Tca9554)) return false;
        const uint8_t bit = (uint8_t)(1U << c.deviceChannel);
        const bool on = RelayDemand::physicalLevel(demand, c.inverted);
        uint8_t& latch = _tcaLatch[c.i2cAddress - 0x20];
        uint8_t nextLatch = latch;
        if (on) nextLatch |= bit; else nextLatch &= (uint8_t)~bit;
        // Actuator updates run every ECU tick. Do not retransmit an unchanged
        // latch hundreds of times per second. A bounded heartbeat is still
        // required because discovery scans stop while the engine is active:
        // otherwise an expander unplugged during a steady demand could look
        // healthy forever.
        const uint8_t deviceIndex = c.i2cAddress - 0x20;
        const uint16_t nowTick = (uint16_t)(millis() >> 4);
        if (nextLatch == latch &&
            (uint16_t)(nowTick - _tcaVerifiedTick[deviceIndex]) <
                TCA_HEARTBEAT_TICKS) return true;
        const bool ok = _writeReg(c.i2cAddress, 0x01, nextLatch);
        if (ok) {
            latch = nextLatch;
            _tcaVerifiedTick[deviceIndex] = nowTick;
            // A successful heartbeat inside the 500 ms grace period fully
            // recovers the device. Leaving lossSinceMs armed here would make a
            // later, unrelated bus glitch fail immediately instead of receiving
            // its own recheck window.
            _record(c.i2cAddress, Tca9554, true);
        }
        if (!ok) _markMissing(c.i2cAddress, Tca9554);
        return ok;
    }

    static bool channelAvailable(const ChannelRegistry::Channel& c) {
        return _enabled && _present(c.i2cAddress, _typeForDriver(c.driver));
    }

    static bool channelRechecking(const ChannelRegistry::Channel& c) {
        const Device* d = _find(c.i2cAddress, _typeForDriver(c.driver));
        return d && d->present && d->lossActive;
    }

    static bool assignmentAvailable(uint8_t driver, uint8_t address) {
        if (driver < (uint8_t)ChannelRegistry::I2cDigital ||
            driver > (uint8_t)ChannelRegistry::I2cRelay) return false;
        return _enabled && _present(address, _typeForDriver((ChannelRegistry::Driver)driver));
    }

    static const char* typeName(Type type) {
        switch (type) {
            case Tca9554: return "TCA9554";
            case Tla2528: return "TLA2528";
            case Nau7802: return "NAU7802";
            default: return "Unknown";
        }
    }

private:
    inline static bool _enabled = false;
    inline static bool _scanRequested = false;
    inline static const ChannelRegistry* _registry = nullptr;
    inline static Device _devices[MAX_DEVICES] = {};
    inline static uint8_t _deviceCount = 0;
    inline static uint8_t _serviceIndex = 0;
    inline static int8_t _interruptPin = -1;
    inline static uint8_t _scanCursor = 0;
    inline static bool _scanActive = false;
    inline static uint32_t _lastScanMs = 0, _lastServiceMs = 0;
    inline static float _values[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline static int32_t _raw[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline static uint32_t _sequence[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline static uint32_t _sampleMs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline static bool _valid[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline static bool _adcDigitalState[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline static uint16_t _adcConfig[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline static bool _adcDigitalChannel[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline static uint8_t _tcaLatch[8] = {};
    inline static uint8_t _tcaDirection[8] = {255,255,255,255,255,255,255,255};
    inline static uint16_t _tcaVerifiedTick[8] = {};
    inline static bool _nauConfigured = false;
    inline static uint8_t _nauInitStage = 0;
    inline static uint8_t _nauSelectedChannel = 255;
    inline static uint8_t _nauPendingRegistryIndex = 255;
    inline static uint32_t _nauInitMs = 0;
    inline static uint32_t _nauFailureLogMs = 0;
    inline static bool _needsConfigure = false;
    // 16 ms ticks keep eight device timestamps in 16 bytes on the
    // static-DRAM-constrained Classic ESP32. Unsigned subtraction remains
    // correct across the ~17 minute tick wrap.
    static constexpr uint16_t TCA_HEARTBEAT_TICKS = 16; // 256 ms

    static Type _typeForDriver(ChannelRegistry::Driver d) {
        if (d == ChannelRegistry::I2cDigital || d == ChannelRegistry::I2cRelay) return Tca9554;
        if (d == ChannelRegistry::I2cAnalog) return Tla2528;
        if (d == ChannelRegistry::I2cLoadCell) return Nau7802;
        return Unknown;
    }

    static void _logNauFailure(const char* message) {
        const uint32_t now = millis();
        if (_nauFailureLogMs && now - _nauFailureLogMs < 1000UL) return;
        _nauFailureLogMs = now;
        Serial.println(message);
    }

    static uint16_t _adcConfigKey(const ChannelRegistry::Channel& c) {
        return (uint16_t)(c.digitalThresholdRaw | (c.activeHigh ? 0x8000U : 0U));
    }

    static uint32_t _staleMs(const ChannelRegistry::Channel& c) {
        if (c.driver == ChannelRegistry::I2cLoadCell)
            return max<uint32_t>(500UL, 5000UL / max<uint16_t>(c.loadCellRate, 10));
        return 500UL;
    }

    static bool _ack(uint8_t address) {
        Wire.beginTransmission(address);
        return Wire.endTransmission() == 0;
    }

    static bool _readReg(uint8_t address, uint8_t reg, uint8_t& value) {
        Wire.beginTransmission(address);
        Wire.write(reg);
        // Finish the register-pointer write before requesting data. TCA9554
        // and NAU7802 both retain the pointer across STOP, and this form is
        // compatible with simple I2C bridges/slaves that cannot service a
        // repeated-start receive callback before their request callback.
        if (Wire.endTransmission(true) != 0) return false;
        if (Wire.requestFrom(address, (uint8_t)1) != 1) return false;
        value = Wire.read();
        return true;
    }

    static bool _writeReg(uint8_t address, uint8_t reg, uint8_t value) {
        Wire.beginTransmission(address);
        Wire.write(reg);
        Wire.write(value);
        return Wire.endTransmission() == 0;
    }

    static bool _tlaReadReg(uint8_t address, uint8_t reg, uint8_t& value) {
        Wire.beginTransmission(address);
        Wire.write((uint8_t)0x10);
        Wire.write(reg);
        if (Wire.endTransmission(false) != 0) return false;
        if (Wire.requestFrom(address, (uint8_t)1) != 1) return false;
        value = Wire.read();
        return true;
    }

    static bool _tlaWriteReg(uint8_t address, uint8_t reg, uint8_t value) {
        Wire.beginTransmission(address);
        Wire.write((uint8_t)0x08);
        Wire.write(reg);
        Wire.write(value);
        return Wire.endTransmission() == 0;
    }

    static Device* _findMutable(uint8_t address, Type type) {
        for (uint8_t i = 0; i < _deviceCount; ++i)
            if (_devices[i].address == address && _devices[i].type == type) return &_devices[i];
        return nullptr;
    }
    static const Device* _find(uint8_t address, Type type) {
        return _findMutable(address, type);
    }
    static bool _present(uint8_t address, Type type) {
        const Device* d = _find(address, type);
        return d && d->present;
    }
    static void _record(uint8_t address, Type type, bool present) {
        Device* d = _findMutable(address, type);
        if (!d && !present) return;
        if (!d && _deviceCount < MAX_DEVICES) {
            d = &_devices[_deviceCount++];
            d->address = address; d->type = type;
        }
        if (!d) return;
        const bool wasPresent = d->present;
        if (present) {
            if (d->lossActive)
                Serial.printf("[I2C] 0x%02X recovered inside 500 ms recheck window\n", address);
            d->present = true;
            d->lastSeenMs = millis();
            d->lossSinceMs = 0;
            d->lossActive = false;
            if (!wasPresent) _needsConfigure = true;
        } else if (wasPresent) {
            if (!d->lossActive) {
                d->lossSinceMs = millis();
                d->lossActive = true;
                ++d->errors;
            }
            if (LossRecheck::expired(millis(), d->lossSinceMs, d->lossActive)) {
                d->present = false;
                if (type == Nau7802) _nauConfigured = false;
            }
        }
    }

    static void _markMissing(uint8_t address, Type type) {
        Device* d = _findMutable(address, type);
        if (!d) return;
        if (d->present) {
            if (!d->lossActive) {
                d->lossSinceMs = millis();
                d->lossActive = true;
                ++d->errors;
            }
            if (!LossRecheck::expired(millis(), d->lossSinceMs, d->lossActive)) return;
        }
        d->present = false;
        if (type == Nau7802) {
            _nauConfigured = false;
            _nauInitStage = 0;
            _nauSelectedChannel = 255;
            _nauPendingRegistryIndex = 255;
        }
    }

    static void _scan() {
        _lastScanMs = millis();
        for (uint8_t a = 0x20; a <= 0x27; ++a) {
            uint8_t cfg = 0;
            _record(a, Tca9554, _ack(a) && _readReg(a, 0x03, cfg));
        }
        for (uint8_t a = 0x10; a <= 0x17; ++a) {
            uint8_t status = 0;
            _record(a, Tla2528, _ack(a) && _tlaReadReg(a, 0x00, status) &&
                                    (status & 0x80U));
        }
        uint8_t pu = 0;
        _record(0x2A, Nau7802, _ack(0x2A) && _readReg(0x2A, 0x00, pu));
    }

    static void _scanStep() {
        if (_scanCursor < 8) {
            const uint8_t address = (uint8_t)(0x20 + _scanCursor);
            uint8_t cfg = 0;
            _record(address, Tca9554, _ack(address) && _readReg(address, 0x03, cfg));
        } else if (_scanCursor < 16) {
            const uint8_t address = (uint8_t)(0x10 + (_scanCursor - 8));
            uint8_t status = 0;
            _record(address, Tla2528, _ack(address) &&
                    _tlaReadReg(address, 0x00, status) && (status & 0x80U));
        } else {
            uint8_t pu = 0;
            _record(0x2A, Nau7802, _ack(0x2A) && _readReg(0x2A, 0x00, pu));
        }
        if (++_scanCursor >= 17) {
            _scanActive = false;
            if (_needsConfigure) _configureAssignedDevices();
        }
    }

    static bool _configureTcaOutputs(uint8_t address, bool requirePresent) {
        if (requirePresent && !_present(address, Tca9554)) return false;
        uint8_t direction = 0xFF, latch = 0;
        bool assigned = false;
        for (uint8_t i = 0; i < _registry->outputCount; ++i) {
            const auto& c = _registry->outputs[i];
            if (!c.installed || c.driver != ChannelRegistry::I2cRelay ||
                c.i2cAddress != address || c.deviceChannel >= 8) continue;
            assigned = true;
            const uint8_t bit = (uint8_t)(1U << c.deviceChannel);
            direction &= (uint8_t)~bit;
            const bool safeOn = RelayDemand::physicalLevel(c.safeDemand, c.inverted);
            if (safeOn) latch |= bit;
        }
        if (!assigned) return true;

        // Set the safe latch before changing direction: a pin becoming an
        // output must never briefly expose the expander's previous latch.
        const bool ok = _writeReg(address, 0x01, latch) &&
                        _writeReg(address, 0x03, direction);
        if (!ok) {
            _markMissing(address, Tca9554);
            return false;
        }
        _tcaDirection[address - 0x20] = direction;
        _tcaLatch[address - 0x20] = latch;
        _tcaVerifiedTick[address - 0x20] = (uint16_t)(millis() >> 4);
        _record(address, Tca9554, true);
        return true;
    }

    static void _parkAssignedRelayOutputs() {
        for (uint8_t address = 0x20; address <= 0x27; ++address)
            _configureTcaOutputs(address, false);
    }

    static void _configureAssignedDevices() {
        _needsConfigure = false;
        for (uint8_t a = 0x20; a <= 0x27; ++a) {
            if (!_present(a, Tca9554)) continue;
            _configureTcaOutputs(a, true);
        }
        if (_present(0x2A, Nau7802)) _beginNauConfiguration();
    }

    static uint8_t _gainCode(uint8_t gain) {
        uint8_t code = 0;
        while (gain > 1 && code < 7) { gain >>= 1; ++code; }
        return code;
    }
    static uint8_t _rateCode(uint16_t rate) {
        if (rate == 20) return 1; if (rate == 40) return 2;
        if (rate == 80) return 3; if (rate == 320) return 7;
        return 0;
    }
    static const ChannelRegistry::Channel* _nauChannel() {
        const ChannelRegistry::Channel* chosen = nullptr;
        for (uint8_t i = 0; i < _registry->inputCount; ++i)
            if (_registry->inputs[i].installed &&
                _registry->inputs[i].driver == ChannelRegistry::I2cLoadCell) {
                chosen = &_registry->inputs[i]; break;
            }
        return chosen;
    }

    static void _beginNauConfiguration() {
        if (!_nauChannel()) return;
        _nauConfigured = false;
        _nauInitStage = 0;
        _nauSelectedChannel = 255;
        _nauPendingRegistryIndex = 255;
        // Reset and power-up are intentionally non-blocking. The converter is
        // not considered healthy until power-ready and calibration complete.
        if (!_writeReg(0x2A, 0x00, 0x01) ||
            !_writeReg(0x2A, 0x00, 0x00) ||
            !_writeReg(0x2A, 0x00, 0x06)) {
            Serial.println("[I2C] NAU7802 reset/power-up write failed");
            _markMissing(0x2A, Nau7802);
            return;
        }
        _nauInitStage = 1;
        _nauInitMs = millis();
    }

    static void _serviceNauInit() {
        if (!_nauInitStage || !_present(0x2A, Nau7802)) return;
        const ChannelRegistry::Channel* chosen = _nauChannel();
        if (!chosen) { _nauInitStage = 0; return; }
        uint8_t pu = 0;
        if (!_readReg(0x2A, 0x00, pu)) {
            Serial.println("[I2C] NAU7802 power/status read failed");
            _markMissing(0x2A, Nau7802);
            return;
        }
        if (_nauInitStage == 1) {
            if (!(pu & 0x08U)) {
                if (millis() - _nauInitMs > 250UL) {
                    Serial.printf("[I2C] NAU7802 power-ready timeout (PU=0x%02X)\n", pu);
                    _markMissing(0x2A, Nau7802);
                }
                return;
            }
            const uint8_t ctrl2 = (uint8_t)((chosen->deviceChannel ? 0x80 : 0) |
                                  (_rateCode(chosen->loadCellRate) << 4));
            if (!_writeReg(0x2A, 0x01, (uint8_t)(0x20 | _gainCode(chosen->loadCellGain))) ||
                !_writeReg(0x2A, 0x02, (uint8_t)(ctrl2 | 0x04)) ||
                !_writeReg(0x2A, 0x00, 0x16)) {
                Serial.println("[I2C] NAU7802 gain/rate/calibration write failed");
                _markMissing(0x2A, Nau7802);
                return;
            }
            _nauInitStage = 2;
            _nauInitMs = millis();
            return;
        }
        uint8_t ctrl2 = 0;
        if (!_readReg(0x2A, 0x02, ctrl2)) {
            Serial.println("[I2C] NAU7802 calibration status read failed");
            _markMissing(0x2A, Nau7802);
            return;
        }
        if (ctrl2 & 0x08U) {
            Serial.printf("[I2C] NAU7802 internal calibration error (CTRL2=0x%02X)\n", ctrl2);
            _markMissing(0x2A, Nau7802);
        } else if (!(ctrl2 & 0x04U)) {
            _nauConfigured = true;
            _nauSelectedChannel = chosen->deviceChannel;
            _nauInitStage = 0;
        } else if (millis() - _nauInitMs > 1000UL) {
            Serial.printf("[I2C] NAU7802 calibration timeout (CTRL2=0x%02X)\n", ctrl2);
            _markMissing(0x2A, Nau7802);
        }
    }

    static void _serviceOneInput() {
        _serviceNauInit();
        if (!_registry->inputCount) return;
        uint8_t i = 0;
        const ChannelRegistry::Channel* selected = nullptr;
        // Native channels are serviced elsewhere. Skip over them in this tick
        // so a large mixed registry does not unnecessarily reduce I2C sample
        // rate, while still performing at most one device transaction here.
        for (uint8_t attempt = 0; attempt < _registry->inputCount; ++attempt) {
            i = _serviceIndex++ % _registry->inputCount;
            const auto& candidate = _registry->inputs[i];
            if (candidate.installed &&
                candidate.driver >= ChannelRegistry::I2cDigital) {
                selected = &candidate;
                break;
            }
        }
        if (!selected) return;
        const auto& c = *selected;
        if (c.driver == ChannelRegistry::I2cLoadCell &&
            _nauPendingRegistryIndex != 255 && _nauPendingRegistryIndex != i)
            return;
        int32_t raw = 0;
        bool ok = false;
        bool valid = true;
        if (c.driver == ChannelRegistry::I2cDigital && _present(c.i2cAddress, Tca9554)) {
            uint8_t bits = 0;
            ok = _readReg(c.i2cAddress, 0x00, bits);
            if (ok) {
                const bool high = bits & (1U << c.deviceChannel);
                raw = high ? 1 : 0;
                _values[i] = (c.activeHigh ? high : !high) ? 1.0f : 0.0f;
            }
        } else if (c.driver == ChannelRegistry::I2cAnalog &&
                   _present(c.i2cAddress, Tla2528)) {
            ok = _tlaWriteReg(c.i2cAddress, 0x11, c.deviceChannel);
            if (ok && Wire.requestFrom(c.i2cAddress, (uint8_t)2) == 2) {
                raw = (((uint16_t)Wire.read() << 8) | Wire.read()) >> 4;
                const float mv = raw * c.i2cReferenceMv / 4095.0f;
                float physical = 0.0f;
                if (_adcDigitalChannel[i]) {
                    const uint16_t configKey = _adcConfigKey(c);
                    if (_adcConfig[i] != configKey) {
                        _adcDigitalState[i] = !c.activeHigh;
                        _adcConfig[i] = configKey;
                    }
                    _adcDigitalState[i] = AdcThreshold::update(
                        raw, c.digitalThresholdRaw, c.digitalHysteresisRaw,
                        _adcDigitalState[i]);
                    physical = AdcThreshold::logicalValue(_adcDigitalState[i], c.activeHigh);
                } else if (c.calibrationPointCount >= 2) {
                    physical = PiecewiseCalibration::apply((float)raw, c.calibrationPointCount,
                                                            c.calibrationRaw, c.calibrationValue);
                    if (!strcmp(c.role, "generic") || !strcmp(c.role, "operator") || !strcmp(c.role, "flame")) {
                        physical = constrain(physical, 0.0f, 1.0f);
                        if (c.inverted) physical = 1.0f - physical;
                    }
                } else if (!strcmp(c.role, "generic") || !strcmp(c.role, "operator") || !strcmp(c.role, "flame")) {
                    const float span = c.maxValue - c.minValue;
                    float n = span > 0 ? constrain((raw - c.minValue) / span, 0.0f, 1.0f) : 0.0f;
                    physical = c.inverted ? 1.0f - n : n;
                } else if (!strcmp(c.role, "voltage")) {
                    physical = (mv / 1000.0f) * max(c.analogDivider, 1.0f);
                } else {
                    physical = (mv - c.analogZeroMv) / max(c.analogMvPerUnit, 0.001f);
                }
                const float alpha = constrain(c.filterAlpha, 0.01f, 1.0f);
                _values[i] = _adcDigitalChannel[i] ? physical : (_sequence[i]
                    ? _values[i] + alpha * (physical - _values[i])
                    : physical);
                valid = isfinite(_values[i]) &&
                        raw >= c.minValue && raw <= c.maxValue;
            } else ok = false;
        } else if (c.driver == ChannelRegistry::I2cLoadCell &&
                   _present(c.i2cAddress, Nau7802) && _nauConfigured) {
            if (_nauSelectedChannel != c.deviceChannel) {
                uint8_t ctrl2 = 0;
                if (!_readReg(0x2A, 0x02, ctrl2) ||
                    !_writeReg(0x2A, 0x02, (uint8_t)((ctrl2 & 0x7FU) |
                                                     (c.deviceChannel ? 0x80U : 0)))) {
                    _logNauFailure("[I2C] NAU7802 channel-select transaction failed");
                    _markMissing(0x2A, Nau7802);
                } else {
                    _nauSelectedChannel = c.deviceChannel;
                    _nauPendingRegistryIndex = i;
                }
                // The first conversion after switching channels may belong to
                // the previous input. Wait for this channel's next ready sample.
                return;
            }
            uint8_t pu = 0;
            if (!_readReg(0x2A, 0x00, pu)) {
                _logNauFailure("[I2C] NAU7802 conversion-ready read failed");
                _markMissing(0x2A, Nau7802);
                return;
            }
            if (!(pu & 0x20U)) {
                return;
            }
            ok = true;
            {
                Wire.beginTransmission(0x2A); Wire.write((uint8_t)0x12);
                ok = Wire.endTransmission(true) == 0 &&
                     Wire.requestFrom((uint8_t)0x2A, (uint8_t)3) == 3;
                if (ok) {
                    raw = ((int32_t)Wire.read() << 16) |
                          ((int32_t)Wire.read() << 8) | Wire.read();
                    if (raw & 0x00800000L) raw |= 0xFF000000L;
                    float forceN = (raw - c.loadCellZero) * c.loadCellNPerCount;
                    float physical = !strcmp(c.role, "torque") ? forceN * c.leverArmM : forceN;
                    _values[i] = _sequence[i]
                        ? _values[i] + c.filterAlpha * (physical - _values[i])
                        : physical;
                    valid = isfinite(_values[i]) &&
                            raw > -8388352L && raw < 8388351L;
                } else {
                    _logNauFailure("[I2C] NAU7802 24-bit sample read failed");
                }
            }
        }
        if (ok) {
            _raw[i] = raw; _valid[i] = valid;
            _sampleMs[i] = millis(); ++_sequence[i];
            if (c.driver == ChannelRegistry::I2cLoadCell)
                _nauPendingRegistryIndex = 255;
            // Use the common recovery path so a good sample also clears a
            // pending loss timer. Directly setting present/lastSeen left the
            // old timer armed and shortened every subsequent recheck.
            _record(c.i2cAddress, _typeForDriver(c.driver), true);
        } else if ((c.driver == ChannelRegistry::I2cDigital ||
                    c.driver == ChannelRegistry::I2cAnalog ||
                    (c.driver == ChannelRegistry::I2cLoadCell && _nauConfigured)) &&
                   _present(c.i2cAddress, _typeForDriver(c.driver))) {
            if (_adcDigitalChannel[i]) _adcDigitalState[i] = !c.activeHigh;
            _markMissing(c.i2cAddress, _typeForDriver(c.driver));
        }
    }
};
