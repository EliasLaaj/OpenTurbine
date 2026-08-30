#pragma once

// Bounded, allocation-free inventory used by configuration validation and
// runtime binding resolution.  IDs are configuration keys; labels are never
// used to resolve a channel.
#include <Arduino.h>
#include <ArduinoJson.h>
#include "../hal/sensors/PiecewiseCalibration.h"

class ChannelRegistry {
public:
    // Handles occupy 64..79 (outputs) and start at 80 for inputs, leaving the
    // fixed rule/sequence handle ranges untouched.
#if defined(CONFIG_IDF_TARGET_ESP32S3)
    // The official ECU exposes twenty assignable input connectors plus its
    // fixed supply monitor. Keep spare capacity for future profile revisions.
    static constexpr uint8_t MAX_INPUT_CHANNELS = 24;
#else
    // Preserve the classic ESP32's established capacity and static-DRAM margin.
    // PCB profiles are target-specific, so this does not constrain the S3 ECU.
    static constexpr uint8_t MAX_INPUT_CHANNELS = 16;
#endif
    static constexpr uint8_t MAX_OUTPUT_CHANNELS = 16;
    static constexpr uint8_t MAX_BINDINGS = 24;
    static constexpr uint8_t INPUT_SENSOR_BASE = 80;
    static constexpr uint8_t OUTPUT_ACTUATOR_BASE = 64;
    static constexpr bool isInputSensor(uint8_t handle) {
        return handle >= INPUT_SENSOR_BASE &&
               handle < INPUT_SENSOR_BASE + MAX_INPUT_CHANNELS;
    }
    static constexpr uint8_t inputIndexFromSensor(uint8_t handle) {
        return handle - INPUT_SENSOR_BASE;
    }
    static constexpr bool isOutputActuator(uint8_t handle) {
        return handle >= OUTPUT_ACTUATOR_BASE &&
               handle < OUTPUT_ACTUATOR_BASE + MAX_OUTPUT_CHANNELS;
    }
    static constexpr uint8_t outputIndexFromActuator(uint8_t handle) {
        return handle - OUTPUT_ACTUATOR_BASE;
    }
    static bool isCoreManagedOutputId(const char* id) {
        return id && (!strcmp(id, "main_fuel_output") ||
                      !strcmp(id, "main_fuel") ||
                      !strcmp(id, "main_starter") ||
                      !strcmp(id, "starter") ||
                      !strcmp(id, "starter_main") ||
                      !strcmp(id, "starter_enable") ||
                      !strcmp(id, "oil_pump_main") ||
                      !strcmp(id, "oil_pump") ||
                      !strcmp(id, "cooling_fan_main") ||
                      !strcmp(id, "cooling_fan") ||
                      !strcmp(id, "oil_scavenge_main") ||
                      !strcmp(id, "scavenge_pump") ||
                      !strcmp(id, "bleed_valve_main") ||
                      !strcmp(id, "bleed_valve") ||
                      !strcmp(id, "igniter") ||
                      !strcmp(id, "ab_igniter") ||
                      !strcmp(id, "igniter2_main") ||
                      !strcmp(id, "main_fuel_shutoff") ||
                      !strcmp(id, "fuel_shutoff") ||
                      !strcmp(id, "ab_solenoid") ||
                      !strcmp(id, "air_starter") ||
                      !strcmp(id, "fuel_pump") ||
                      !strcmp(id, "ab_pump") ||
                      !strcmp(id, "prop_pitch") ||
                      !strcmp(id, "glow_plug"));
    }
    static bool isCoreManagedInputId(const char* id) {
        return id && (!strcmp(id, "n1_main") ||
                      !strcmp(id, "n2_main") ||
                      !strcmp(id, "tot_main") ||
                      !strcmp(id, "primary_n1") ||
                      !strcmp(id, "primary_n2") ||
                      !strcmp(id, "primary_egt") ||
                      !strcmp(id, "oil_pressure_main") ||
                      !strcmp(id, "p1_main") ||
                      !strcmp(id, "p2_main") ||
                      !strcmp(id, "operator_throttle") ||
                      !strcmp(id, "operator_idle") ||
                      !strcmp(id, "battery_voltage") ||
                      !strcmp(id, "batt_voltage_main"));
    }
    static bool isCoreManagedInputPurpose(const char* purpose) {
        return purpose && (!strcmp(purpose, "n1_speed") || !strcmp(purpose, "n2_speed") ||
                           !strcmp(purpose, "tot") || !strcmp(purpose, "tit") ||
                           !strcmp(purpose, "oil_pressure") || !strcmp(purpose, "oil_temperature") ||
                           !strcmp(purpose, "fuel_pressure") || !strcmp(purpose, "p1_pressure") ||
                           !strcmp(purpose, "p2_pressure") || !strcmp(purpose, "fuel_flow") ||
                           !strcmp(purpose, "flame") || !strcmp(purpose, "torque") ||
                           !strcmp(purpose, "thrust") ||
                           !strcmp(purpose, "battery_voltage") || !strcmp(purpose, "throttle") ||
                           !strcmp(purpose, "idle") || !strcmp(purpose, "ab_flame") ||
                           !strcmp(purpose, "ab_command") ||
                           !strcmp(purpose, "start_switch") || !strcmp(purpose, "stop_switch") ||
                           !strcmp(purpose, "low_oil_switch") || !strcmp(purpose, "oil_zero_switch"));
    }
    static bool isCoreOutputBindingKey(const char* key) {
        return key && (!strcmp(key, "main_fuel_output") ||
                       !strcmp(key, "main_fuel_shutoff") ||
                       !strcmp(key, "main_starter") ||
                       !strcmp(key, "starter_enable_output") ||
                       !strcmp(key, "primary_oil_pump") ||
                       !strcmp(key, "primary_scavenge_pump") ||
                       !strcmp(key, "primary_cooling_fan") ||
                       !strcmp(key, "primary_bleed_valve") ||
                       !strcmp(key, "primary_aux_fuel_pump") ||
                       !strcmp(key, "primary_igniter") ||
                       !strcmp(key, "primary_secondary_igniter") ||
                       !strcmp(key, "primary_ab_valve") ||
                       !strcmp(key, "primary_glow_plug") ||
                       !strcmp(key, "primary_ab_pump") ||
                       !strcmp(key, "primary_prop_pitch") ||
                       !strcmp(key, "primary_air_starter"));
    }
    static const char* coreOutputBindingKey(const char* purpose) {
        if (!purpose) return nullptr;
        if (!strcmp(purpose, "main_fuel")) return "main_fuel_output";
        if (!strcmp(purpose, "fuel_shutoff")) return "main_fuel_shutoff";
        if (!strcmp(purpose, "starter")) return "main_starter";
        if (!strcmp(purpose, "starter_enable")) return "starter_enable_output";
        if (!strcmp(purpose, "oil_pump")) return "primary_oil_pump";
        if (!strcmp(purpose, "scavenge_pump")) return "primary_scavenge_pump";
        if (!strcmp(purpose, "cooling_fan")) return "primary_cooling_fan";
        if (!strcmp(purpose, "bleed_valve")) return "primary_bleed_valve";
        if (!strcmp(purpose, "fuel_pump")) return "primary_aux_fuel_pump";
        if (!strcmp(purpose, "igniter")) return "primary_igniter";
        if (!strcmp(purpose, "ab_igniter")) return "primary_secondary_igniter";
        if (!strcmp(purpose, "ab_valve")) return "primary_ab_valve";
        if (!strcmp(purpose, "glow_plug")) return "primary_glow_plug";
        if (!strcmp(purpose, "ab_pump")) return "primary_ab_pump";
        if (!strcmp(purpose, "prop_pitch")) return "primary_prop_pitch";
        if (!strcmp(purpose, "air_starter")) return "primary_air_starter";
        return nullptr;
    }
    static bool isCoreManagedOutputRole(const char* role) {
        (void)role;
        return false;
    }
    static bool isCoreManagedOutputPurpose(const char* purpose) {
        return purpose && (!strcmp(purpose, "main_fuel") ||
                           !strcmp(purpose, "fuel_shutoff") ||
                           !strcmp(purpose, "starter") ||
                           !strcmp(purpose, "starter_enable") ||
                           !strcmp(purpose, "oil_pump") ||
                            !strcmp(purpose, "scavenge_pump") ||
                            !strcmp(purpose, "cooling_fan") ||
                            !strcmp(purpose, "bleed_valve") ||
                            !strcmp(purpose, "fuel_pump") ||
                           !strcmp(purpose, "igniter") ||
                           !strcmp(purpose, "ab_igniter") ||
                           !strcmp(purpose, "ab_valve") ||
                           !strcmp(purpose, "glow_plug") ||
                           !strcmp(purpose, "ab_pump") ||
                           !strcmp(purpose, "prop_pitch") ||
                           !strcmp(purpose, "air_starter"));
    }
    static bool isDedicatedTemperatureId(const char* id) {
        return id && (!strcmp(id, "tot_main") || !strcmp(id, "tit_main") ||
                      !strcmp(id, "oil_temperature") || !strcmp(id, "coolant_temperature"));
    }
    enum Direction : uint8_t { Input, Output };
    static bool roleValid(Direction d, const char* role) {
        if (!role || !role[0] || strlen(role) >= 18) return false;
        if (!strcmp(role, "generic")) return true;
        if (d == Input) {
            return !strcmp(role, "speed") ||
                   !strcmp(role, "pressure") ||
                   !strcmp(role, "temperature") ||
                   !strcmp(role, "flame") ||
                   !strcmp(role, "flow") ||
                   !strcmp(role, "current") ||
                   !strcmp(role, "torque") ||
                   !strcmp(role, "thrust") ||
                   !strcmp(role, "voltage") ||
                   !strcmp(role, "operator") ||
                   !strcmp(role, "digital_switch") ||
                   !strcmp(role, "fault") ||
                   !strcmp(role, "estop") ||
                   !strcmp(role, "inhibit_start") ||
                   !strcmp(role, "low_oil_switch") ||
                   !strcmp(role, "oil_zero_switch") ||
                   !strcmp(role, "sequence_gate") ||
                   !strcmp(role, "ab_arm") ||
                   !strcmp(role, "ab_fire") ||
                   !strcmp(role, "limp_mode");
        }
        return !strcmp(role, "fuel") ||
               !strcmp(role, "fuel_shutoff") ||
               !strcmp(role, "starter") ||
               !strcmp(role, "starter_en") ||
               !strcmp(role, "oil_pump") ||
               !strcmp(role, "coolant_pump") ||
               !strcmp(role, "scavenge_pump") ||
               !strcmp(role, "cooling_fan") ||
               !strcmp(role, "valve") ||
               !strcmp(role, "igniter") ||
               !strcmp(role, "ab_igniter") ||
               !strcmp(role, "glow_plug") ||
               !strcmp(role, "fuel_pump") ||
               !strcmp(role, "ab_pump") ||
               !strcmp(role, "prop_pitch") ||
               !strcmp(role, "indicator");
    }
    // Driver numbers are persisted. Keep 0..6 stable and append new drivers.
    enum Driver : uint8_t {
        Digital, Analog, Pulse, RcPwm, Relay, Pwm, Servo, PwmDuty,
        I2cDigital, I2cAnalog, I2cLoadCell, I2cRelay
    };
    struct Channel {
        bool installed = false;
        Direction direction = Input;
        Driver driver = Digital;
        char id[20] = {};
        char name[24] = {};
        char role[18] = {"generic"};
        char purpose[20] = {"generic"};
        char mirrorOf[20] = {}; // output command source; empty means independent
        // Empty in generic dev-board mode. In PCB-profile mode these stable
        // IDs are the persisted topology; raw pin/bus/driver fields below are
        // derived from the immutable flashed profile on every load.
        char physicalPortId[24] = {};
        char physicalModeId[24] = {};
        int8_t pin = -1;
        uint8_t i2cAddress = 0;
        uint8_t deviceChannel = 0;
        float i2cReferenceMv = 3300.0f;
        uint8_t loadCellGain = 128;
        uint16_t loadCellRate = 80;
        int32_t loadCellZero = 0;
        float loadCellNPerCount = 1.0f;
        float leverArmM = 1.0f;
        float filterAlpha = 1.0f;
        float minValue = 0.0f, maxValue = 1.0f;
        float pulsesPerUnit = 1.0f; // pulse inputs: speed=pulses/rev, flow=pulses/litre
        float analogZeroMv = 0.0f;      // analog physical roles: mV at zero output
        float analogMvPerUnit = 1000.0f; // speed=RPM, pressure=bar, temp=C, flow=L/min, torque=Nm
        float analogDivider = 1.0f;     // voltage role: Vbatt = ADC volts * divider
        // Optional datasheet/measured curve. Zero points keeps the compact
        // linear calibration above. Raw points must increase; values must
        // consistently increase or decrease. Runtime clamps outside endpoints.
        uint8_t calibrationPointCount = 0;
        uint16_t calibrationRaw[PiecewiseCalibration::MAX_POINTS] = {};
        float calibrationValue[PiecewiseCalibration::MAX_POINTS] = {};
        uint16_t digitalThresholdRaw = 2048; // ADC-backed switch centre, 0..4095
        uint16_t digitalHysteresisRaw = 64;  // total switch deadband, 0..2047
        // Torque cards can use a normal analog transmitter (0) or an HX711
        // bridge ADC (1).  For HX711, pin is DOUT and hx711Clk is SCK.
        uint8_t torqueInterface = 0;
        int8_t hx711Clk = -1;
        float hx711Scale = 1.0f;
        int32_t hx711Zero = 0;
        // Temperature cards can be a calibrated analog transmitter (0), a
        // thermocouple amplifier (1=MAX6675, 2=MAX31855, 3=MAX31856), an
        // NTC divider (4), or a DS18B20 OneWire probe (5). SPI bus lines may
        // be shared; each thermocouple amplifier owns its CS pin.
        uint8_t temperatureInterface = 0;
        int8_t spiClk = -1, spiCs = -1, spiMiso = -1, spiMosi = -1;
        char tcType[2] = "K";
        uint8_t temperatureResolution = 10;
        float thermistorBeta = 3950.0f, thermistorR0 = 10000.0f, thermistorRFixed = 10000.0f;
        bool thermistorPullup = true;
        float safeDemand = 0.0f;
        bool forceSafeOnFault = false; // optional hard override during fault shutdown
        float minimumRunDemand = 0.0f; // operational floor inside the electrical output range
        uint32_t pwmFrequency = 5000;
        uint8_t pwmResolution = 10;
        bool pwmTimingConfigured = false;
        bool inverted = false;
        bool activeHigh = true;
        bool pullup = false;
        bool pulldown = false;
        bool hasCurrent = false;
        int8_t currentPin = -1;
        float currentMvPerA = 100.0f;
        float currentZeroV = 1.65f;
        float currentMaxAmps = 0.0f;
        float currentReadyAmps = 3.0f; // glow-plug hot/ready threshold; ignored by other outputs
        uint32_t currentTripDelayMs = 5000; // continuous overcurrent before shutdown
        // Device-local ignition behavior. Legacy profiles leave this false and
        // continue using the old shared settings until the card is edited.
        bool ignitionProfileConfigured = false;
        uint8_t ignitionMode = 0; // 0=simple, 1=dwell/rest PWM, 2=current-limited coil
        uint16_t ignitionDwellMs = 6;
        uint16_t ignitionRestMs = 3;
        float ignitionCoilSatAmps = 8.0f;
        uint32_t ignitionPreheatMs = 10000;
        float ignitionPeakDemand = 0.8f;
        float ignitionHoldDemand = 0.3f;
        bool ignitionWaitUntilHot = false;
        uint32_t ignitionHotTimeoutMs = 30000;
        char pairedOutputId[20] = {}; // optional pilot-fuel output owned while this ignition device is on
        uint32_t pairedOutputDelayMs = 8000;
        float pairedOutputDemand = 1.0f;
        bool hasFlowMonitor = false;
        float minimumFlow = 0.0f;  // L/min; applies to oil/scavenge pump outputs
        char flowInputId[20] = {}; // optional when exactly one compatible input exists
    };
    static bool driverIsI2c(Driver d) {
        return d == I2cDigital || d == I2cAnalog || d == I2cLoadCell || d == I2cRelay;
    }
    static bool driverIsOnOffOutput(Driver d) {
        return d == Relay || d == I2cRelay;
    }
    static bool driverIsProportionalOutput(Driver d) {
        return d == Pwm || d == Servo;
    }
    static bool isSwitchCondition(const Channel& c) {
        if (c.direction != Input) return false;
        return !strcmp(c.role, "digital_switch") || !strcmp(c.role, "fault") ||
               !strcmp(c.role, "estop") || !strcmp(c.role, "inhibit_start") ||
               !strcmp(c.role, "low_oil_switch") || !strcmp(c.role, "oil_zero_switch") ||
               !strcmp(c.role, "sequence_gate") || !strcmp(c.role, "ab_arm") ||
               !strcmp(c.role, "ab_fire") || !strcmp(c.role, "limp_mode") ||
               !strcmp(c.purpose, "start_switch") || !strcmp(c.purpose, "stop_switch") ||
               !strcmp(c.purpose, "digital_switch") || !strcmp(c.purpose, "inhibit_start") ||
               !strcmp(c.purpose, "estop") || !strcmp(c.purpose, "fault") ||
               !strcmp(c.purpose, "low_oil_switch") || !strcmp(c.purpose, "oil_zero_switch") ||
               !strcmp(c.purpose, "sequence_gate") || !strcmp(c.purpose, "ab_arm") ||
               !strcmp(c.purpose, "ab_fire") || !strcmp(c.purpose, "limp_mode");
    }
    static bool isAdcThresholdCondition(const Channel& c) {
        if (c.driver != Analog && c.driver != I2cAnalog) return false;
        return isSwitchCondition(c) || !strcmp(c.purpose, "flame") ||
               !strcmp(c.purpose, "ab_flame");
    }
    static bool channelAddressable(const Channel& c) {
        if (!c.installed) return false;
        if (c.driver == I2cDigital || c.driver == I2cRelay)
            return c.i2cAddress >= 0x20 && c.i2cAddress <= 0x27 && c.deviceChannel < 8;
        if (c.driver == I2cAnalog)
            return c.i2cAddress >= 0x10 && c.i2cAddress <= 0x17 && c.deviceChannel < 8;
        if (c.driver == I2cLoadCell)
            return c.i2cAddress == 0x2A && c.deviceChannel < 2;
        return c.pin >= 0 || (c.physicalPortId[0] && c.physicalModeId[0]);
    }
    struct Binding { char key[20] = {}; char channelId[20] = {}; };

    Channel inputs[MAX_INPUT_CHANNELS] = {};
    Channel outputs[MAX_OUTPUT_CHANNELS] = {};
    Binding bindings[MAX_BINDINGS] = {};
    uint8_t inputCount = 0, outputCount = 0, bindingCount = 0;
    inline static char _validationError[128] = {};

    // Only active entries are observable. Resetting the counts avoids
    // constructing a 5+ KB temporary registry on the Arduino loop stack.
    void clear() { inputCount = 0; outputCount = 0; bindingCount = 0; }
    const Channel* find(const char* id, Direction direction) const {
        const Channel* list = direction == Input ? inputs : outputs;
        uint8_t count = direction == Input ? inputCount : outputCount;
        for (uint8_t i = 0; i < count; ++i) if (!strcmp(list[i].id, id)) return &list[i];
        return nullptr;
    }
    Channel* findMutable(const char* id, Direction direction) {
        Channel* list = direction == Input ? inputs : outputs;
        uint8_t count = direction == Input ? inputCount : outputCount;
        for (uint8_t i = 0; i < count; ++i) if (!strcmp(list[i].id, id)) return &list[i];
        return nullptr;
    }
    bool add(const Channel& c) {
        const bool profileBacked = c.physicalPortId[0] && c.physicalModeId[0];
        const bool thermocouple = c.direction == Input && !strcmp(c.role, "temperature") &&
                                  c.temperatureInterface >= 1 && c.temperatureInterface <= 3;
        const bool remote = c.driver == I2cDigital || c.driver == I2cAnalog ||
                            c.driver == I2cLoadCell || c.driver == I2cRelay;
        if (!validId(c.id) || findMutable(c.id, Input) || findMutable(c.id, Output) ||
            (!profileBacked && !thermocouple && !remote && c.pin < 0) ||
            (!profileBacked && thermocouple && !temperatureInterfaceValid(c))) return false;
        Channel* list = c.direction == Input ? inputs : outputs;
        uint8_t& count = c.direction == Input ? inputCount : outputCount;
        uint8_t max = c.direction == Input ? MAX_INPUT_CHANNELS : MAX_OUTPUT_CHANNELS;
        const char* candidatePurpose =
            !strcmp(c.purpose, "generic") && strcmp(c.role, "generic")
                ? derivePurpose(c.direction, c.id, c.role) : c.purpose;
        if (singletonPurpose(c.direction, candidatePurpose)) {
            for (uint8_t i = 0; i < count; ++i) {
                if (!strcmp(list[i].purpose, candidatePurpose)) {
                    snprintf(_validationError, sizeof(_validationError),
                             "Purpose %s is assigned to both %s and %s",
                             candidatePurpose, list[i].id, c.id);
                    return false;
                }
            }
        }
        if (count >= max || !driverMatches(c.direction, c.driver) || !roleValid(c.direction, c.role) ||
            !purposeValid(c.direction, c.purpose) || !semanticDriverValid(c) || !demandsValid(c)) return false;
        for (uint8_t i=0; i<inputCount; ++i) {
            if (c.pin >= 0 && (inputs[i].pin == c.pin || inputs[i].hx711Clk == c.pin)) return false;
            if (c.hx711Clk >= 0 && (inputs[i].pin == c.hx711Clk || inputs[i].hx711Clk == c.hx711Clk)) return false;
        }
        for (uint8_t i=0; i<outputCount; ++i) {
            if (c.pin >= 0 && (outputs[i].pin == c.pin || outputs[i].hx711Clk == c.pin)) return false;
            if (c.hx711Clk >= 0 && (outputs[i].pin == c.hx711Clk || outputs[i].hx711Clk == c.hx711Clk)) return false;
        }
        list[count] = c;
        if (!strcmp(list[count].purpose, "generic") && strcmp(list[count].role, "generic"))
            strlcpy(list[count].purpose, derivePurpose(c.direction, c.id, c.role), sizeof(list[count].purpose));
        count++;
        return true;
    }
    bool validate() const {
        _validationError[0] = '\0';
        for (uint8_t i = 0; i < inputCount; ++i)
            for (uint8_t j = i + 1; j < inputCount; ++j) {
                if (singletonPurpose(Input, inputs[i].purpose) &&
                    !strcmp(inputs[i].purpose, inputs[j].purpose)) {
                    snprintf(_validationError, sizeof(_validationError),
                             "Purpose %s is assigned to both %s and %s",
                             inputs[i].purpose, inputs[i].id, inputs[j].id);
                    return false;
                }
                const bool repeatableTyped = !strcmp(inputs[i].purpose, "shaft_speed") ||
                    !strncmp(inputs[i].purpose, "general_", 8);
                if (repeatableTyped && !strcmp(inputs[i].purpose, inputs[j].purpose) &&
                    !strcmp(inputs[i].name, inputs[j].name)) {
                    snprintf(_validationError, sizeof(_validationError),
                             "Rename repeated %s inputs so each name is unique",
                             inputs[i].purpose);
                    return false;
                }
            }
        for (uint8_t i = 0; i < outputCount; ++i)
            for (uint8_t j = i + 1; j < outputCount; ++j)
                if (singletonPurpose(Output, outputs[i].purpose) &&
                    !strcmp(outputs[i].purpose, outputs[j].purpose)) {
                    snprintf(_validationError, sizeof(_validationError),
                             "Purpose %s is assigned to both %s and %s",
                             outputs[i].purpose, outputs[i].id, outputs[j].id);
                    return false;
                }
        for (uint8_t i = 0; i < outputCount; ++i) {
            const auto& candidate = outputs[i];
            if (!candidate.installed || candidate.mirrorOf[0] ||
                !isCoreManagedOutputPurpose(candidate.purpose)) continue;
            uint8_t peers = 0;
            uint8_t owners = 0;
            for (uint8_t j = 0; j < outputCount; ++j) {
                const auto& output = outputs[j];
                if (!output.installed || output.mirrorOf[0] ||
                    strcmp(output.purpose, candidate.purpose)) continue;
                ++peers;
                if (ownsCoreOutput(output)) ++owners;
            }
            if (peers > 1 && owners != 1) {
                snprintf(_validationError, sizeof(_validationError),
                         "Several %s outputs are fitted; select one primary device",
                         candidate.purpose);
                return false;
            }
        }
        for (uint8_t i=0; i<inputCount; ++i) if (!validId(inputs[i].id) || !driverMatches(Input, inputs[i].driver) || !roleValid(Input, inputs[i].role) || !purposeValid(Input, inputs[i].purpose) || !semanticDriverValid(inputs[i]) || (!(inputs[i].physicalPortId[0] && inputs[i].physicalModeId[0]) && !temperatureInterfaceValid(inputs[i])) || !torqueInterfaceValid(inputs[i]) || !demandsValid(inputs[i])) return false;
        for (uint8_t i=0; i<outputCount; ++i) {
            if (!validId(outputs[i].id) || !driverMatches(Output, outputs[i].driver) ||
                !roleValid(Output, outputs[i].role) || !purposeValid(Output, outputs[i].purpose) ||
                !semanticDriverValid(outputs[i]) || !demandsValid(outputs[i])) return false;
            if (outputs[i].hasFlowMonitor) {
                const char* expected = (!strcmp(outputs[i].purpose, "oil_pump") ||
                                        !strcmp(outputs[i].role, "oil_pump"))
                    ? "oil_flow" : "scavenge_flow";
                uint8_t compatible = 0;
                bool selected = outputs[i].flowInputId[0] == '\0';
                for (uint8_t j=0; j<inputCount; ++j)
                    if (inputs[j].installed && !strcmp(inputs[j].purpose, expected)) {
                        ++compatible;
                        if (outputs[i].flowInputId[0] &&
                            !strcmp(inputs[j].id, outputs[i].flowInputId)) selected = true;
                    }
                if (compatible == 0 || !selected ||
                    (compatible > 1 && !outputs[i].flowInputId[0])) return false;
            }
            if (outputs[i].mirrorOf[0]) {
                const Channel* source = find(outputs[i].mirrorOf, Output);
                if (!source || source == &outputs[i] || source->mirrorOf[0] ||
                    ownsCoreOutput(outputs[i])) {
                    snprintf(_validationError, sizeof(_validationError),
                             "Output %s has an invalid mirror source", outputs[i].id);
                    return false;
                }
            }
        }
        uint8_t auxiliaryPcnt = 0, registryOneWire = 0, nauLoadCells = 0;
        uint8_t nauGain = 0;
        uint16_t nauRate = 0;
        for (uint8_t i=0; i<inputCount; ++i) {
            if (inputs[i].driver == Pulse && !strcmp(inputs[i].purpose, "shaft_speed")) auxiliaryPcnt++;
            if (inputs[i].temperatureInterface == 5 && strcmp(inputs[i].purpose, "oil_temperature")) registryOneWire++;
            if (inputs[i].driver == I2cLoadCell) {
                nauLoadCells++;
                if (!nauGain) { nauGain = inputs[i].loadCellGain; nauRate = inputs[i].loadCellRate; }
                else if (inputs[i].loadCellGain != nauGain || inputs[i].loadCellRate != nauRate) return false;
            }
        }
        if (auxiliaryPcnt > 2) {
            snprintf(_validationError, sizeof(_validationError),
                     "At most 2 additional pulse shaft-speed inputs are supported");
            return false;
        }
        if (registryOneWire > 4) {
            snprintf(_validationError, sizeof(_validationError),
                     "At most 4 general OneWire temperature inputs are supported");
            return false;
        }
        if (nauLoadCells > 2) {
            snprintf(_validationError, sizeof(_validationError),
                     "At most 2 NAU7802 load-cell inputs are supported");
            return false;
        }
        for (uint8_t i=0; i<inputCount; ++i) for (uint8_t j=0; j<outputCount; ++j) if (inputs[i].pin >= 0 && inputs[i].pin == outputs[j].pin) return false;
        for (uint8_t i=0; i<inputCount; ++i) {
            if (inputs[i].driver < I2cDigital) continue;
            for (uint8_t j=i+1; j<inputCount; ++j)
                if (inputs[j].driver >= I2cDigital &&
                    inputs[i].i2cAddress == inputs[j].i2cAddress &&
                    inputs[i].deviceChannel == inputs[j].deviceChannel) return false;
            for (uint8_t j=0; j<outputCount; ++j)
                if (outputCount && outputCount > j && outputs[j].driver == I2cRelay &&
                    inputs[i].i2cAddress == outputs[j].i2cAddress &&
                    inputs[i].deviceChannel == outputs[j].deviceChannel) return false;
        }
        for (uint8_t i=0; i<outputCount; ++i) {
            if (outputs[i].driver != I2cRelay) continue;
            for (uint8_t j=i+1; j<outputCount; ++j)
                if (outputs[j].driver == I2cRelay &&
                    outputs[i].i2cAddress == outputs[j].i2cAddress &&
                    outputs[i].deviceChannel == outputs[j].deviceChannel) return false;
        }
        for (uint8_t i=0; i<bindingCount; ++i) {
            if (!bindingValid(bindings[i])) return false;
            for (uint8_t j=i+1; j<bindingCount; ++j)
                if (!strcmp(bindings[i].key, bindings[j].key)) {
                    snprintf(_validationError, sizeof(_validationError),
                             "Binding %s is assigned more than once", bindings[i].key);
                    return false;
                }
        }
        return true;
    }
    static const char* validationError() { return _validationError; }
    void toJson(JsonObject root) const {
        root["input_capacity"] = MAX_INPUT_CHANNELS;
        root["output_capacity"] = MAX_OUTPUT_CHANNELS;
        JsonArray in = root["inputs"].to<JsonArray>(), out = root["outputs"].to<JsonArray>(), bind = root["bindings"].to<JsonArray>();
        write(in, inputs, inputCount); write(out, outputs, outputCount);
        for (uint8_t i=0;i<bindingCount;i++) { JsonObject b=bind.add<JsonObject>(); b["key"]=bindings[i].key; b["channel"]=bindings[i].channelId; }
    }
    bool fromJson(JsonObjectConst root) {
        clear(); if (!read(root["inputs"], Input) || !read(root["outputs"], Output)) return false;
        for (JsonObjectConst b : root["bindings"].as<JsonArrayConst>()) { if (bindingCount >= MAX_BINDINGS) return false; Binding& x=bindings[bindingCount++]; strlcpy(x.key,b["key"]|"",sizeof(x.key)); strlcpy(x.channelId,b["channel"]|"",sizeof(x.channelId)); }
        return validate();
    }
    bool boundToCoreOutput(const Channel& c) const {
        for (uint8_t i = 0; i < bindingCount; i++)
            if (isCoreOutputBindingKey(bindings[i].key) &&
                strcmp(bindings[i].channelId, c.id) == 0) return true;
        return false;
    }
    bool ownsCoreOutput(const Channel& c) const {
        if (!isCoreManagedOutputPurpose(c.purpose)) return false;
        // An explicit advanced binding is the clearest statement of which
        // physical card owns the built-in adapter. It must override a migrated
        // canonical ID so duplicate-purpose outputs never acquire two owners.
        const char* bindingKey = coreOutputBindingKey(c.purpose);
        if (bindingKey) {
            for (uint8_t i = 0; i < bindingCount; ++i) {
                if (strcmp(bindings[i].key, bindingKey)) continue;
                return !strcmp(bindings[i].channelId, c.id);
            }
        }
        if (isCoreManagedOutputId(c.id)) return true;
        // A canonical legacy card remains a deterministic migration owner.
        // For non-canonical cards, only a sole compatible output may inherit
        // the adapter. Multiple cards require an explicit binding; registry
        // order must never decide which physical device receives a command.
        for (uint8_t i = 0; i < outputCount; ++i)
            if (!strcmp(outputs[i].purpose, c.purpose) && isCoreManagedOutputId(outputs[i].id))
                return &outputs[i] == &c;
        uint8_t matches = 0;
        for (uint8_t i = 0; i < outputCount; ++i)
            if (outputs[i].installed && !outputs[i].mirrorOf[0] &&
                !strcmp(outputs[i].purpose, c.purpose)) ++matches;
        return matches == 1;
    }
    static bool validId(const char* id) { if (!id || !id[0] || strlen(id) >= 20) return false; for (;*id;++id) if (!(isalnum(*id)||*id=='_'||*id=='-')) return false; return true; }
    static bool pwmTimingValid(uint32_t frequency, uint8_t resolution) {
        // ESP32 LEDC derives these channels from an 80 MHz source. Preserve
        // every achievable pair instead of imposing presets, but reject a
        // pair the driver can only discover is impossible during boot attach.
        return frequency >= 1 && frequency <= 100000 &&
               resolution >= 8 && resolution <= 14 &&
               frequency * (1UL << resolution) <= 80000000UL;
    }
    static bool singletonPurpose(Direction d, const char* purpose) {
        if (!purpose || !strcmp(purpose, "generic")) return false;
        // Output hardware is not semantically single-instance. One explicit
        // binding (or a sole/canonical migration card) owns each built-in
        // controller adapter; all other cards remain independent rule/sequence
        // targets. Registry order never assigns physical authority.
        if (d == Output) return false;
        // Discrete switches may be repeated. Their consumers combine them as
        // any-active while retaining per-channel health and disconnect checks.
        if (!strcmp(purpose, "start_switch") || !strcmp(purpose, "stop_switch") ||
            !strcmp(purpose, "low_oil_switch") || !strcmp(purpose, "oil_zero_switch") ||
            !strcmp(purpose, "digital_switch") || !strcmp(purpose, "fault") ||
            !strcmp(purpose, "estop") || !strcmp(purpose, "inhibit_start") ||
            !strcmp(purpose, "sequence_gate") || !strcmp(purpose, "ab_arm") ||
            !strcmp(purpose, "ab_fire") || !strcmp(purpose, "limp_mode")) return false;
        return (strcmp(purpose, "oil_pressure") && isCoreManagedInputPurpose(purpose)) ||
               !strcmp(purpose, "ab_command");
    }
    static bool purposeValid(Direction d, const char* purpose) {
        if (!purpose || !purpose[0] || strlen(purpose) >= 20) return false;
        if (!strcmp(purpose, "generic")) return true;
        if (d == Input) {
            return !strcmp(purpose, "n1_speed") || !strcmp(purpose, "n2_speed") ||
                   !strcmp(purpose, "shaft_speed") || !strcmp(purpose, "tot") ||
                   !strcmp(purpose, "tit") || !strcmp(purpose, "oil_pressure") ||
                   !strcmp(purpose, "fuel_pressure") || !strcmp(purpose, "p1_pressure") ||
                   !strcmp(purpose, "p2_pressure") || !strcmp(purpose, "coolant_pressure") ||
                   !strcmp(purpose, "oil_temperature") || !strcmp(purpose, "coolant_temp") ||
                   !strcmp(purpose, "intake_temperature") || !strcmp(purpose, "fuel_flow") ||
                    !strcmp(purpose, "general_temperature") ||
                    !strcmp(purpose, "general_pressure") ||
                    !strcmp(purpose, "general_flow") ||
                    !strcmp(purpose, "general_current") ||
                    !strcmp(purpose, "general_voltage") ||
                    !strcmp(purpose, "general_torque") ||
                    !strcmp(purpose, "general_thrust") ||
                    !strcmp(purpose, "oil_flow") || !strcmp(purpose, "scavenge_flow") ||
                    !strcmp(purpose, "flame") || !strcmp(purpose, "ab_flame") || !strcmp(purpose, "torque") ||
                   !strcmp(purpose, "thrust") ||
                   !strcmp(purpose, "battery_voltage") || !strcmp(purpose, "throttle") ||
                   !strcmp(purpose, "idle") || !strcmp(purpose, "ab_command") ||
                   !strcmp(purpose, "digital_switch") ||
                   !strcmp(purpose, "start_switch") || !strcmp(purpose, "stop_switch") ||
                   !strcmp(purpose, "fault") || !strcmp(purpose, "estop") ||
                   !strcmp(purpose, "inhibit_start") || !strcmp(purpose, "sequence_gate") ||
                   !strcmp(purpose, "low_oil_switch") || !strcmp(purpose, "oil_zero_switch") ||
                   !strcmp(purpose, "ab_arm") || !strcmp(purpose, "ab_fire") ||
                   !strcmp(purpose, "limp_mode");
        }
        return !strcmp(purpose, "main_fuel") || !strcmp(purpose, "fuel_shutoff") ||
               !strcmp(purpose, "starter") || !strcmp(purpose, "starter_enable") ||
               !strcmp(purpose, "oil_pump") || !strcmp(purpose, "coolant_pump") ||
               !strcmp(purpose, "scavenge_pump") || !strcmp(purpose, "cooling_fan") ||
               !strcmp(purpose, "valve") || !strcmp(purpose, "bleed_valve") || !strcmp(purpose, "igniter") ||
               !strcmp(purpose, "ab_igniter") || !strcmp(purpose, "glow_plug") ||
               !strcmp(purpose, "fuel_pump") || !strcmp(purpose, "ab_pump") ||
               !strcmp(purpose, "ab_valve") ||
               !strcmp(purpose, "prop_pitch") ||
               !strcmp(purpose, "air_starter") || !strcmp(purpose, "pilot_fuel") ||
               !strcmp(purpose, "purge_valve") || !strcmp(purpose, "drain_valve") ||
               !strcmp(purpose, "nozzle_actuator") ||
                !strcmp(purpose, "warning_indicator");
    }
    // Authoritative semantic capability contract. A persisted/imported card
    // must describe the same signal that the runtime adapter will consume.
    // Keep this deliberately small and aligned with the Hardware catalog;
    // unusual configurations remain valid whenever the runtime truly supports
    // their electrical driver.
    static bool purposeRoleDriverValid(Direction d, const char* purpose,
                                       const char* role, Driver driver) {
        if (!purpose || !role) return false;
        auto oneOf = [driver](Driver a, Driver b, Driver c = (Driver)255,
                              Driver e = (Driver)255, Driver f = (Driver)255) {
            return driver == a || driver == b || driver == c || driver == e || driver == f;
        };
        if (!strcmp(purpose, "generic")) {
            if (!strcmp(role, "generic"))
                return d == Input
                    ? oneOf(Digital, Analog, Pulse, RcPwm, PwmDuty) ||
                          driver == I2cDigital || driver == I2cAnalog
                    : oneOf(Relay, Pwm, Servo, I2cRelay);
            // Version-1 custom cards used a typed role with no explicit
            // canonical purpose. Preserve that useful automation/calibration
            // metadata without binding the card to a core engine function.
            const char* representative = nullptr;
            if (d == Input) {
                representative = !strcmp(role, "speed") ? "shaft_speed" :
                    !strcmp(role, "pressure") ? "coolant_pressure" :
                    !strcmp(role, "temperature") ? "coolant_temp" :
                    !strcmp(role, "flame") ? "flame" :
                    !strcmp(role, "flow") ? "oil_flow" :
                    !strcmp(role, "current") ? "general_current" :
                    !strcmp(role, "torque") ? "torque" :
                    !strcmp(role, "thrust") ? "thrust" :
                    !strcmp(role, "voltage") ? "battery_voltage" :
                    !strcmp(role, "operator") ? "idle" :
                    !strcmp(role, "digital_switch") ? "digital_switch" :
                    !strcmp(role, "fault") ? "fault" : !strcmp(role, "estop") ? "estop" :
                    !strcmp(role, "inhibit_start") ? "inhibit_start" :
                    !strcmp(role, "low_oil_switch") ? "low_oil_switch" :
                    !strcmp(role, "oil_zero_switch") ? "oil_zero_switch" :
                    !strcmp(role, "sequence_gate") ? "sequence_gate" :
                    !strcmp(role, "ab_arm") ? "ab_arm" : !strcmp(role, "ab_fire") ? "ab_fire" :
                    !strcmp(role, "limp_mode") ? "limp_mode" : nullptr;
            } else {
                representative = !strcmp(role, "fuel") ? "main_fuel" :
                    !strcmp(role, "fuel_shutoff") ? "fuel_shutoff" :
                    !strcmp(role, "starter") ? "starter" : !strcmp(role, "starter_en") ? "starter_enable" :
                    !strcmp(role, "oil_pump") ? "oil_pump" : !strcmp(role, "coolant_pump") ? "coolant_pump" :
                    !strcmp(role, "scavenge_pump") ? "scavenge_pump" :
                    !strcmp(role, "cooling_fan") ? "cooling_fan" :
                    !strcmp(role, "valve") ? "valve" : !strcmp(role, "igniter") ? "igniter" :
                    !strcmp(role, "ab_igniter") ? "ab_igniter" : !strcmp(role, "glow_plug") ? "glow_plug" :
                    !strcmp(role, "fuel_pump") ? "fuel_pump" : !strcmp(role, "ab_pump") ? "ab_pump" :
                    !strcmp(role, "prop_pitch") ? "prop_pitch" :
                    !strcmp(role, "indicator") ? "warning_indicator" : nullptr;
            }
            return representative && purposeRoleDriverValid(d, representative, role, driver);
        }
        if (d == Input) {
            if (!strcmp(purpose, "n1_speed") || !strcmp(purpose, "n2_speed") ||
                !strcmp(purpose, "shaft_speed"))
                return !strcmp(role, "speed") && oneOf(Pulse, Analog, I2cAnalog);
            if (!strcmp(purpose, "tot") || !strcmp(purpose, "tit") ||
                !strcmp(purpose, "oil_temperature") || !strcmp(purpose, "coolant_temp") ||
                !strcmp(purpose, "intake_temperature") || !strcmp(purpose, "general_temperature"))
                return !strcmp(role, "temperature") && oneOf(Analog, I2cAnalog);
            if (!strcmp(purpose, "oil_pressure") || !strcmp(purpose, "fuel_pressure") ||
                !strcmp(purpose, "p1_pressure") || !strcmp(purpose, "p2_pressure") ||
                !strcmp(purpose, "coolant_pressure") || !strcmp(purpose, "general_pressure"))
                return !strcmp(role, "pressure") && oneOf(Analog, I2cAnalog);
            if (!strcmp(purpose, "fuel_flow") || !strcmp(purpose, "general_flow") ||
                !strcmp(purpose, "oil_flow") ||
                !strcmp(purpose, "scavenge_flow"))
                return !strcmp(role, "flow") && oneOf(Pulse, Analog, I2cAnalog);
            if (!strcmp(purpose, "general_current"))
                return !strcmp(role, "current") && oneOf(Analog, I2cAnalog);
            if (!strcmp(purpose, "general_voltage"))
                return !strcmp(role, "voltage") && oneOf(Analog, I2cAnalog);
            if (!strcmp(purpose, "flame") || !strcmp(purpose, "ab_flame"))
                return !strcmp(role, "flame") &&
                       oneOf(Digital, Analog, I2cDigital, I2cAnalog);
            if (!strcmp(purpose, "torque") || !strcmp(purpose, "general_torque"))
                return !strcmp(role, "torque") && oneOf(Analog, I2cAnalog, I2cLoadCell);
            if (!strcmp(purpose, "thrust") || !strcmp(purpose, "general_thrust"))
                return !strcmp(role, "thrust") && oneOf(Analog, I2cAnalog, I2cLoadCell);
            if (!strcmp(purpose, "battery_voltage"))
                return !strcmp(role, "voltage") && oneOf(Analog, I2cAnalog);
            if (!strcmp(purpose, "throttle"))
                return !strcmp(role, "operator") &&
                       oneOf(Analog, Pulse, RcPwm, PwmDuty, I2cAnalog);
            if (!strcmp(purpose, "idle"))
                return !strcmp(role, "operator") &&
                       (oneOf(Digital, Analog, Pulse, RcPwm, PwmDuty) ||
                        driver == I2cDigital || driver == I2cAnalog);
            if (!strcmp(purpose, "ab_command"))
                return !strcmp(role, "operator") &&
                       oneOf(Analog, RcPwm, PwmDuty, I2cAnalog);

            const bool switchDriver = oneOf(Digital, Analog, I2cDigital, I2cAnalog);
            if (!strcmp(purpose, "start_switch") || !strcmp(purpose, "stop_switch") ||
                !strcmp(purpose, "digital_switch"))
                return !strcmp(role, "digital_switch") && switchDriver;
            const char* expectedRole = !strcmp(purpose, "inhibit_start") ? "inhibit_start" :
                !strcmp(purpose, "estop") ? "estop" : !strcmp(purpose, "fault") ? "fault" :
                !strcmp(purpose, "low_oil_switch") ? "low_oil_switch" :
                !strcmp(purpose, "oil_zero_switch") ? "oil_zero_switch" :
                !strcmp(purpose, "sequence_gate") ? "sequence_gate" :
                !strcmp(purpose, "ab_arm") ? "ab_arm" :
                !strcmp(purpose, "ab_fire") ? "ab_fire" :
                !strcmp(purpose, "limp_mode") ? "limp_mode" : nullptr;
            return expectedRole && !strcmp(role, expectedRole) && switchDriver;
        }

        auto output = [&](const char* expectedRole, bool relay, bool pwm,
                          bool servo, bool i2cRelay) {
            if (strcmp(role, expectedRole)) return false;
            return (relay && driver == Relay) || (pwm && driver == Pwm) ||
                   (servo && driver == Servo) || (i2cRelay && driver == I2cRelay);
        };
        if (!strcmp(purpose, "main_fuel")) return output("fuel", false, true, true, false);
        if (!strcmp(purpose, "fuel_shutoff")) return output("fuel_shutoff", true, false, false, true);
        if (!strcmp(purpose, "starter")) return output("starter", true, true, true, true);
        if (!strcmp(purpose, "starter_enable")) return output("starter_en", true, true, true, true);
        if (!strcmp(purpose, "oil_pump")) return output("oil_pump", true, true, true, true);
        if (!strcmp(purpose, "coolant_pump")) return output("coolant_pump", true, true, true, true);
        if (!strcmp(purpose, "scavenge_pump")) return output("scavenge_pump", true, true, true, true);
        if (!strcmp(purpose, "cooling_fan")) return output("cooling_fan", true, true, true, true);
        if (!strcmp(purpose, "fuel_pump")) return output("fuel_pump", true, true, true, true);
        if (!strcmp(purpose, "igniter")) return output("igniter", true, true, false, true);
        if (!strcmp(purpose, "ab_igniter")) return output("ab_igniter", true, true, false, true);
        if (!strcmp(purpose, "glow_plug")) return output("glow_plug", true, true, false, true);
        if (!strcmp(purpose, "valve") || !strcmp(purpose, "air_starter") ||
            !strcmp(purpose, "pilot_fuel") || !strcmp(purpose, "purge_valve") ||
            !strcmp(purpose, "drain_valve"))
            return output(!strcmp(purpose, "air_starter") ? "starter" : "valve",
                          true, true, true, true);
        if (!strcmp(purpose, "bleed_valve")) return output("valve", true, true, true, true);
        if (!strcmp(purpose, "ab_valve")) return output("valve", true, false, false, true);
        if (!strcmp(purpose, "ab_pump")) return output("ab_pump", true, true, true, true);
        if (!strcmp(purpose, "prop_pitch")) return output("prop_pitch", true, true, true, true);
        if (!strcmp(purpose, "nozzle_actuator")) return output("prop_pitch", false, true, true, false);
        if (!strcmp(purpose, "warning_indicator")) return output("indicator", true, true, false, true);
        return false;
    }
private:
    static bool driverMatches(Direction d, Driver v) {
        return d == Input
            ? (v == Digital || v == Analog || v == Pulse || v == RcPwm ||
               v == PwmDuty || v == I2cDigital || v == I2cAnalog || v == I2cLoadCell)
            : (v == Relay || v == Pwm || v == Servo || v == I2cRelay);
    }
    static bool semanticDriverValid(const Channel& c) {
        return purposeRoleDriverValid(c.direction, c.purpose, c.role, c.driver);
    }
    static bool temperatureInterfaceValid(const Channel& c) {
        if (!c.temperatureInterface) return true;
        if (c.direction != Input || strcmp(c.role, "temperature")) return false;
        const bool turbineGasPurpose = !strcmp(c.purpose, "tot") || !strcmp(c.purpose, "tit");
        const bool lowTemperaturePurpose = !strcmp(c.purpose, "oil_temperature") ||
                                           !strcmp(c.purpose, "coolant_temp") ||
                                           !strcmp(c.purpose, "intake_temperature") ||
                                           !strcmp(c.purpose, "general_temperature");
        if (c.temperatureInterface >= 1 && c.temperatureInterface <= 3) {
            const bool thermocouplePurpose = turbineGasPurpose ||
                                              !strcmp(c.purpose, "oil_temperature") ||
                                              !strcmp(c.purpose, "general_temperature");
            if (!thermocouplePurpose) return false;
            if (c.spiClk < 0 || c.spiCs < 0 || c.spiMiso < 0) return false;
            return c.temperatureInterface != 3 || c.spiMosi >= 0;
        }
        // NTC and DS18B20 devices are low-temperature sensors. In particular,
        // a DS18B20 can report a plausible-looking but saturated value far
        // below turbine-gas temperatures, so never accept either interface as
        // TOT/TIT feedback even if a configuration is submitted outside the UI.
        if (!lowTemperaturePurpose || turbineGasPurpose) return false;
        if (c.temperatureInterface == 4)
            return c.pin >= 0 && c.thermistorBeta > 0.0f && c.thermistorR0 > 0.0f && c.thermistorRFixed > 0.0f;
        return c.temperatureInterface == 5 && c.pin >= 0 &&
               c.temperatureResolution >= 9 && c.temperatureResolution <= 12;
    }
    static bool torqueInterfaceValid(const Channel& c) {
        if (!c.torqueInterface) return true;
        return c.torqueInterface == 1 && c.direction == Input && !strcmp(c.role, "torque") &&
               c.driver == Analog && c.pin >= 0 && c.hx711Clk >= 0 && c.pin != c.hx711Clk &&
               c.hx711Scale >= 0.000001f && c.hx711Scale <= 1000000.0f;
    }
    static bool rangeValid(const Channel& c) {
        if (!PiecewiseCalibration::valid(c.calibrationPointCount,
                                         c.calibrationRaw, c.calibrationValue)) return false;
        const bool thresholdInput = isAdcThresholdCondition(c);
        const uint16_t railDistance = c.digitalThresholdRaw < (4095U - c.digitalThresholdRaw)
            ? c.digitalThresholdRaw : (uint16_t)(4095U - c.digitalThresholdRaw);
        if (thresholdInput && c.digitalHysteresisRaw > 2U * railDistance) return false;
        if (c.calibrationPointCount &&
            (c.direction != Input || (c.driver != Analog && c.driver != I2cAnalog) ||
             thresholdInput ||
             c.torqueInterface != 0 ||
             (!strcmp(c.role, "temperature") && c.temperatureInterface != 0 &&
              c.temperatureInterface != 4))) return false;
        if (c.calibrationPointCount && !strcmp(c.role, "temperature") &&
            c.temperatureInterface == 4 &&
            (c.calibrationRaw[0] == 0 ||
             c.calibrationRaw[c.calibrationPointCount - 1] >= 4095)) return false;
        if (c.driver == I2cDigital || c.driver == I2cRelay)
            return c.i2cAddress >= 0x20 && c.i2cAddress <= 0x27 && c.deviceChannel < 8;
        if (c.driver == I2cAnalog)
            return c.i2cAddress >= 0x10 && c.i2cAddress <= 0x17 && c.deviceChannel < 8 &&
                   c.i2cReferenceMv >= 1000.0f && c.i2cReferenceMv <= 5500.0f &&
                   c.analogMvPerUnit > 0.0f &&
                   c.digitalThresholdRaw <= 4095 &&
                   c.digitalHysteresisRaw <= 2047 &&
                   c.filterAlpha > 0.0f && c.filterAlpha <= 1.0f;
        if (c.driver == I2cLoadCell)
            return c.i2cAddress == 0x2A && c.deviceChannel < 2 &&
                   (c.loadCellGain == 1 || c.loadCellGain == 2 || c.loadCellGain == 4 ||
                    c.loadCellGain == 8 || c.loadCellGain == 16 || c.loadCellGain == 32 ||
                    c.loadCellGain == 64 || c.loadCellGain == 128) &&
                   (c.loadCellRate == 10 || c.loadCellRate == 20 || c.loadCellRate == 40 ||
                    c.loadCellRate == 80 || c.loadCellRate == 320) &&
                   isfinite(c.loadCellNPerCount) && c.loadCellNPerCount != 0.0f &&
                   isfinite(c.leverArmM) && c.leverArmM <= 100.0f &&
                   (!strcmp(c.role, "torque") ? c.leverArmM > 0.0f
                                                : c.leverArmM >= 0.0f) &&
                   c.filterAlpha > 0.0f && c.filterAlpha <= 1.0f;
        if (c.torqueInterface == 1) return torqueInterfaceValid(c);
        // Dedicated temperature interfaces do not consume the generic analog
        // validity range or mV scale. Their own wiring/calibration validates
        // the channel completely.
        if (!strcmp(c.role, "temperature") && c.temperatureInterface != 0)
            return temperatureInterfaceValid(c);
        if (c.maxValue < c.minValue) return false;
        if (c.driver == Analog) {
            if (c.minValue < 0.0f || c.maxValue > 4095.0f || c.maxValue <= c.minValue) return false;
            if (strcmp(c.role, "generic") && strcmp(c.role, "operator") && strcmp(c.role, "flame")) {
                if (!strcmp(c.role, "voltage")) return c.analogDivider >= 1.0f && c.analogDivider <= 100.0f;
                return c.analogMvPerUnit > 0.0f && c.analogMvPerUnit <= 1000000.0f;
            }
            return true;
        }
        if (c.driver == Pulse) return c.minValue >= 0.0f && c.maxValue > c.minValue && c.pulsesPerUnit > 0.0f;
        if (c.driver == RcPwm || c.driver == Servo) return c.minValue >= 500.0f && c.maxValue <= 2500.0f && c.maxValue > c.minValue;
        if (c.driver == PwmDuty) return c.minValue >= 0.0f && c.maxValue <= 1.0f && c.maxValue > c.minValue;
        if (c.driver == Pwm) return c.minValue >= 0.0f && c.maxValue <= 1.0f &&
                                    (!c.pwmTimingConfigured ||
                                     pwmTimingValid(c.pwmFrequency, c.pwmResolution));
        return true;
    }
    static bool demandsValid(const Channel& c) {
        const bool pitchPark = c.direction == Output &&
            (!strcmp(c.purpose, "prop_pitch") || !strcmp(c.id, "prop_pitch"));
        const bool fixedOffAtBoot = c.direction == Output && !pitchPark &&
            (isCoreManagedOutputId(c.id) || isCoreManagedOutputPurpose(c.purpose) ||
             !strcmp(c.purpose, "pilot_fuel"));
        return c.safeDemand >= 0 && c.safeDemand <= 1 &&
               (!fixedOffAtBoot || c.safeDemand == 0.0f) &&
               c.minimumRunDemand >= 0 && c.minimumRunDemand <= 1 &&
               !(c.pullup && c.pulldown) &&
               (!c.hasCurrent || (c.currentPin >= 0 && c.currentMvPerA > 0.0f &&
                                  c.currentZeroV >= 0.0f && c.currentZeroV <= 3.3f &&
                                  c.currentMaxAmps >= 0.0f &&
                                  c.currentReadyAmps >= 0.0f &&
                                  c.currentTripDelayMs >= 100 &&
                                  c.currentTripDelayMs <= 60000)) &&
               (!c.ignitionProfileConfigured ||
                (c.direction == Output &&
                 (!strcmp(c.purpose, "igniter") || !strcmp(c.purpose, "ab_igniter") ||
                  !strcmp(c.purpose, "glow_plug")) &&
                 c.ignitionMode <= 2 && c.ignitionDwellMs >= 1 && c.ignitionDwellMs <= 200 &&
                 c.ignitionRestMs >= 1 && c.ignitionRestMs <= 200 &&
                 isfinite(c.ignitionCoilSatAmps) && c.ignitionCoilSatAmps > 0.0f &&
                 c.ignitionPreheatMs <= 3600000UL &&
                 isfinite(c.ignitionPeakDemand) && c.ignitionPeakDemand >= 0.0f && c.ignitionPeakDemand <= 1.0f &&
                 isfinite(c.ignitionHoldDemand) && c.ignitionHoldDemand >= 0.0f && c.ignitionHoldDemand <= 1.0f &&
                 c.ignitionHotTimeoutMs >= 100UL && c.ignitionHotTimeoutMs <= 3600000UL &&
                 (!c.pairedOutputId[0] || validId(c.pairedOutputId)) &&
                 c.pairedOutputDelayMs <= 3600000UL &&
                 isfinite(c.pairedOutputDemand) && c.pairedOutputDemand >= 0.0f && c.pairedOutputDemand <= 1.0f)) &&
               (!c.hasFlowMonitor ||
                (c.direction == Output &&
                 (!strcmp(c.purpose, "oil_pump") || !strcmp(c.purpose, "scavenge_pump") ||
                  !strcmp(c.role, "oil_pump")) &&
                 isfinite(c.minimumFlow) && c.minimumFlow > 0.0f)) &&
               rangeValid(c);
    }
    bool bindingValid(const Binding& b) const {
        if (!validId(b.key)) return false;
        Direction expected = Input;
        bool known = false;
        if (!strcmp(b.key, "primary_n1") || !strcmp(b.key, "primary_n2") ||
            !strcmp(b.key, "primary_egt") || !strcmp(b.key, "operator_throttle") ||
            !strcmp(b.key, "operator_idle")) {
            expected = Input;
            known = true;
        } else if (!strcmp(b.key, "main_fuel_output") ||
                   !strcmp(b.key, "main_fuel_shutoff") ||
                   !strcmp(b.key, "main_starter") ||
                   isCoreOutputBindingKey(b.key)) {
            expected = Output;
            known = true;
        }
        if (known) {
            const Channel* c = find(b.channelId, expected);
            if (!c) return false;
            if (!strcmp(b.key, "primary_n1")) return !strcmp(c->purpose, "n1_speed");
            if (!strcmp(b.key, "primary_n2")) return !strcmp(c->purpose, "n2_speed");
            if (!strcmp(b.key, "primary_egt")) return !strcmp(c->purpose, "tot") || !strcmp(c->purpose, "tit");
            if (!strcmp(b.key, "operator_throttle")) return !strcmp(c->purpose, "throttle");
            if (!strcmp(b.key, "operator_idle")) return !strcmp(c->purpose, "idle");
            if (!strcmp(b.key, "main_fuel_output")) return !strcmp(c->purpose, "main_fuel");
            if (!strcmp(b.key, "main_fuel_shutoff")) return !strcmp(c->purpose, "fuel_shutoff");
            if (!strcmp(b.key, "main_starter")) return !strcmp(c->purpose, "starter");
            const char* expectedPurpose =
                !strcmp(b.key, "starter_enable_output") ? "starter_enable" :
                !strcmp(b.key, "primary_oil_pump") ? "oil_pump" :
                !strcmp(b.key, "primary_scavenge_pump") ? "scavenge_pump" :
                !strcmp(b.key, "primary_cooling_fan") ? "cooling_fan" :
                !strcmp(b.key, "primary_bleed_valve") ? "bleed_valve" :
                !strcmp(b.key, "primary_aux_fuel_pump") ? "fuel_pump" :
                !strcmp(b.key, "primary_igniter") ? "igniter" :
                !strcmp(b.key, "primary_secondary_igniter") ? "ab_igniter" :
                !strcmp(b.key, "primary_ab_valve") ? "ab_valve" :
                !strcmp(b.key, "primary_glow_plug") ? "glow_plug" :
                !strcmp(b.key, "primary_ab_pump") ? "ab_pump" :
                !strcmp(b.key, "primary_prop_pitch") ? "prop_pitch" :
                !strcmp(b.key, "primary_air_starter") ? "air_starter" : nullptr;
            if (expectedPurpose) return !strcmp(c->purpose, expectedPurpose);
            return true;
        }
        return find(b.channelId, Input) || find(b.channelId, Output);
    }
    static const char* derivePurpose(Direction d, const char* id, const char* role) {
        if (d == Input) {
            if (!strcmp(id, "n1_main") || !strcmp(id, "primary_n1")) return "n1_speed";
            if (!strcmp(id, "n2_main") || !strcmp(id, "primary_n2")) return "n2_speed";
            if (!strcmp(id, "tot_main") || !strcmp(id, "primary_egt")) return "tot";
            if (!strcmp(id, "tit_main")) return "tit";
            if (!strcmp(id, "oil_pressure_main")) return "oil_pressure";
            if (!strcmp(id, "fuel_pressure")) return "fuel_pressure";
            if (!strcmp(id, "p1_main") || !strcmp(id, "p1")) return "p1_pressure";
            if (!strcmp(id, "p2_main") || !strcmp(id, "p2")) return "p2_pressure";
            if (!strcmp(id, "oil_temperature")) return "oil_temperature";
            if (!strcmp(id, "coolant_temperature")) return "coolant_temp";
            if (!strcmp(id, "intake_temperature")) return "intake_temperature";
            if (!strcmp(id, "coolant_pressure")) return "coolant_pressure";
            if (!strcmp(id, "fuel_flow") || !strcmp(id, "fuel_flow_main")) return "fuel_flow";
            if (!strcmp(id, "general_temperature")) return "general_temperature";
            if (!strcmp(id, "general_pressure")) return "general_pressure";
            if (!strcmp(id, "general_flow") || !strcmp(id, "general_flow_main")) return "general_flow";
            if (!strcmp(id, "general_current") || !strcmp(id, "general_current_main")) return "general_current";
            if (!strcmp(id, "general_voltage")) return "general_voltage";
            if (!strcmp(id, "general_torque")) return "general_torque";
            if (!strcmp(id, "general_thrust")) return "general_thrust";
            if (!strcmp(id, "oil_flow") || !strcmp(id, "oil_flow_main")) return "oil_flow";
            if (!strcmp(id, "scavenge_flow") || !strcmp(id, "scavenge_flow_main")) return "scavenge_flow";
            if (!strcmp(id, "flame_main")) return "flame";
            if (!strcmp(id, "torque_main")) return "torque";
            if (!strcmp(id, "thrust_main")) return "thrust";
            if (!strcmp(id, "battery_voltage") || !strcmp(id, "batt_voltage_main")) return "battery_voltage";
            if (!strcmp(id, "operator_throttle")) return "throttle";
            if (!strcmp(id, "operator_idle")) return "idle";
            if (!strcmp(role, "fault") || !strcmp(role, "estop") ||
                !strcmp(role, "low_oil_switch") || !strcmp(role, "oil_zero_switch") ||
                !strcmp(role, "inhibit_start") || !strcmp(role, "sequence_gate") ||
                !strcmp(role, "ab_arm") || !strcmp(role, "ab_fire") ||
                !strcmp(role, "limp_mode")) return role;
            if (!strcmp(role, "digital_switch")) return "digital_switch";
            if (!strcmp(role, "speed")) return "shaft_speed";
            if (!strcmp(role, "temperature")) return "general_temperature";
            if (!strcmp(role, "pressure")) return "general_pressure";
            if (!strcmp(role, "flow")) return "general_flow";
            if (!strcmp(role, "current")) return "general_current";
            if (!strcmp(role, "voltage")) return "general_voltage";
            if (!strcmp(role, "torque")) return "general_torque";
            if (!strcmp(role, "thrust")) return "general_thrust";
            return "generic";
        }
        if (!strcmp(id, "main_fuel") || !strcmp(id, "main_fuel_output")) return "main_fuel";
        if (!strcmp(id, "fuel_shutoff") || !strcmp(id, "main_fuel_shutoff")) return "fuel_shutoff";
        if (!strcmp(id, "starter") || !strcmp(id, "starter_main") || !strcmp(id, "main_starter")) return "starter";
        if (!strcmp(id, "starter_enable")) return "starter_enable";
        if (!strcmp(id, "oil_pump") || !strcmp(id, "oil_pump_main")) return "oil_pump";
        if (!strcmp(id, "coolant_pump")) return "coolant_pump";
        if (!strcmp(id, "scavenge_pump") || !strcmp(id, "oil_scavenge_main")) return "scavenge_pump";
        if (!strcmp(id, "cooling_fan") || !strcmp(id, "cooling_fan_main")) return "cooling_fan";
        if (!strcmp(id, "bleed_valve") || !strcmp(id, "bleed_valve_main")) return "bleed_valve";
        if (!strcmp(id, "igniter")) return "igniter";
        if (!strcmp(id, "ab_igniter") || !strcmp(id, "igniter2_main")) return "ab_igniter";
        if (!strcmp(id, "ab_solenoid")) return "ab_valve";
        if (!strcmp(id, "glow_plug")) return "glow_plug";
        if (!strcmp(id, "fuel_pump")) return "fuel_pump";
        if (!strcmp(id, "ab_pump")) return "ab_pump";
        if (!strcmp(id, "prop_pitch")) return "prop_pitch";
        if (!strcmp(id, "air_starter")) return "air_starter";
        if (!strcmp(id, "pilot_fuel")) return "pilot_fuel";
        if (!strcmp(id, "purge_valve")) return "purge_valve";
        if (!strcmp(id, "drain_valve")) return "drain_valve";
        if (!strcmp(id, "nozzle_actuator")) return "nozzle_actuator";
        if (!strcmp(role, "indicator")) return "warning_indicator";
        if (!strcmp(role, "coolant_pump")) return "coolant_pump";
        if (!strcmp(role, "starter_en")) return "starter_enable";
        return roleValid(Output, role) && strcmp(role, "fuel") ? role : (!strcmp(role, "fuel") ? "main_fuel" : "generic");
    }
    static void write(JsonArray a, const Channel* list, uint8_t n) {
        for (uint8_t i = 0; i < n; i++) {
            const Channel& c = list[i]; JsonObject o = a.add<JsonObject>();
            o["id"] = c.id; o["name"] = c.name; o["role"] = c.role; o["purpose"] = c.purpose; o["driver"] = (uint8_t)c.driver; o["pin"] = c.pin;
            if (c.physicalPortId[0]) {
                o["physical_port"] = c.physicalPortId;
                o["physical_mode"] = c.physicalModeId;
            }
            if (c.driver >= I2cDigital) {
                o["i2c_address"] = c.i2cAddress; o["device_channel"] = c.deviceChannel;
                if (c.i2cReferenceMv != 3300.0f) o["i2c_reference_mv"] = c.i2cReferenceMv;
                if (c.driver == I2cLoadCell) {
                    o["loadcell_gain"] = c.loadCellGain;
                    o["loadcell_rate_sps"] = c.loadCellRate;
                    o["loadcell_zero"] = c.loadCellZero;
                    o["loadcell_n_per_count"] = c.loadCellNPerCount;
                    o["lever_arm_m"] = c.leverArmM;
                    o["filter_alpha"] = c.filterAlpha;
                } else if (c.filterAlpha != 1.0f) {
                    o["filter_alpha"] = c.filterAlpha;
                }
            }
            o["min"] = c.minValue; o["max"] = c.maxValue;
            if (c.pulsesPerUnit != 1.0f) o["pulses_per_unit"] = c.pulsesPerUnit;
            if (c.driver == Analog || c.driver == I2cAnalog ||
                c.analogZeroMv != 0.0f || c.analogMvPerUnit != 1000.0f ||
                c.analogDivider != 1.0f) {
                o["analog_zero_mv"] = c.analogZeroMv;
                o["analog_mv_per_unit"] = c.analogMvPerUnit;
                o["analog_divider"] = c.analogDivider;
            }
            if (c.calibrationPointCount >= 2) {
                JsonArray points = o["calibration_points"].to<JsonArray>();
                for (uint8_t p = 0; p < c.calibrationPointCount; ++p) {
                    JsonObject point = points.add<JsonObject>();
                    point["raw"] = c.calibrationRaw[p];
                    point["value"] = c.calibrationValue[p];
                }
            }
            if (c.driver == I2cAnalog ||
                (c.driver == Analog && !strcmp(c.role, "flame")) ||
                c.digitalThresholdRaw != 2048 ||
                c.digitalHysteresisRaw != 64) {
                o["digital_threshold_raw"] = c.digitalThresholdRaw;
                o["digital_hysteresis_raw"] = c.digitalHysteresisRaw;
            }
            if (c.torqueInterface || c.hx711Clk >= 0 ||
                c.hx711Scale != 1.0f || c.hx711Zero != 0) {
                o["torque_interface"] = c.torqueInterface;
                o["hx711_clk"] = c.hx711Clk;
                o["hx711_scale"] = c.hx711Scale;
                o["hx711_zero"] = c.hx711Zero;
            }
            if (c.temperatureInterface || c.spiClk >= 0 || c.spiCs >= 0 ||
                c.spiMiso >= 0 || c.spiMosi >= 0) {
                o["temp_interface"] = c.temperatureInterface;
                o["spi_clk"] = c.spiClk; o["spi_cs"] = c.spiCs;
                o["spi_miso"] = c.spiMiso; o["spi_mosi"] = c.spiMosi;
                o["tc_type"] = c.tcType;
                o["temp_resolution"] = c.temperatureResolution;
                o["ntc_beta"] = c.thermistorBeta;
                o["ntc_r0"] = c.thermistorR0;
                o["ntc_r_fixed"] = c.thermistorRFixed;
                o["ntc_pullup"] = c.thermistorPullup;
            }
            // Propeller pitch deliberately defaults to 100% coarse when an
            // old document omits this field. Therefore an explicit 0% park is
            // not equivalent to omission and must survive save/reboot.
            if (c.safeDemand != 0.0f || !strcmp(c.purpose, "prop_pitch"))
                o["safe_demand"] = c.safeDemand;
            if (c.mirrorOf[0]) o["mirror_of"] = c.mirrorOf;
            if (c.forceSafeOnFault) o["force_safe_on_fault"] = true;
            if (c.minimumRunDemand != 0.0f) o["min_run_demand"] = c.minimumRunDemand;
            if (c.pwmTimingConfigured) { o["pwm_freq_hz"] = c.pwmFrequency; o["pwm_res_bits"] = c.pwmResolution; }
            if (c.inverted) o["invert"] = true;
            // Active-high is the electrical default but is rendered as a
            // checked control by the UI; keep it explicit to avoid changing
            // the apparent polarity when reopening a compact document.
            o["active_high"] = c.activeHigh;
            if (c.pullup) o["pullup"] = true;
            if (c.pulldown) o["pulldown"] = true;
            if (c.hasCurrent) {
                o["has_current"] = true;
                o["current_pin"] = c.currentPin;
                o["current_mv_a"] = c.currentMvPerA;
                o["current_zero_v"] = c.currentZeroV;
                o["current_max_a"] = c.currentMaxAmps;
                if (!strcmp(c.purpose, "glow_plug")) o["current_ready_a"] = c.currentReadyAmps;
                o["current_trip_delay_ms"] = c.currentTripDelayMs;
            }
            if (c.ignitionProfileConfigured) {
                o["ignition_mode"] = c.ignitionMode;
                o["ignition_dwell_ms"] = c.ignitionDwellMs;
                o["ignition_rest_ms"] = c.ignitionRestMs;
                o["ignition_coil_sat_a"] = c.ignitionCoilSatAmps;
                o["ignition_preheat_ms"] = c.ignitionPreheatMs;
                o["ignition_peak_demand"] = c.ignitionPeakDemand;
                o["ignition_hold_demand"] = c.ignitionHoldDemand;
                o["ignition_wait_hot"] = c.ignitionWaitUntilHot;
                o["ignition_hot_timeout_ms"] = c.ignitionHotTimeoutMs;
                if (c.pairedOutputId[0]) o["paired_output"] = c.pairedOutputId;
                o["paired_output_delay_ms"] = c.pairedOutputDelayMs;
                o["paired_output_demand"] = c.pairedOutputDemand;
            }
            if (c.hasFlowMonitor) {
                o["has_flow_monitor"] = true;
                o["minimum_flow_l_min"] = c.minimumFlow;
                if (c.flowInputId[0]) o["flow_input"] = c.flowInputId;
            }
        }
    }
    bool read(JsonVariantConst v, Direction d) {
        for (JsonObjectConst o : v.as<JsonArrayConst>()) {
            Channel c; c.direction = d; c.installed = true;
            strlcpy(c.id, o["id"] | "", sizeof(c.id)); strlcpy(c.name, o["name"] | c.id, sizeof(c.name)); strlcpy(c.role, o["role"] | "generic", sizeof(c.role));
            strlcpy(c.purpose, o["purpose"] | derivePurpose(d, c.id, c.role), sizeof(c.purpose));
            if (d == Output) strlcpy(c.mirrorOf, o["mirror_of"] | "", sizeof(c.mirrorOf));
            if (d == Output && !strcmp(c.purpose, "main_fuel") &&
                (!strcmp(c.name, "Main Fuel Pump") || !strcmp(c.name, "Main Fuel Meteri")))
                strlcpy(c.name, "Main Fuel Metering", sizeof(c.name));
            strlcpy(c.physicalPortId, o["physical_port"] | "", sizeof(c.physicalPortId));
            strlcpy(c.physicalModeId, o["physical_mode"] | "", sizeof(c.physicalModeId));
            c.driver = (Driver)(o["driver"] | 0); c.pin = o["pin"] | -1; c.minValue = o["min"] | 0.0f; c.maxValue = o["max"] | 1.0f;
            c.i2cAddress = o["i2c_address"] | 0; c.deviceChannel = o["device_channel"] | 0;
            c.i2cReferenceMv = o["i2c_reference_mv"] | 3300.0f;
            c.loadCellGain = o["loadcell_gain"] | 128; c.loadCellRate = o["loadcell_rate_sps"] | 80;
            c.loadCellZero = o["loadcell_zero"] | 0; c.loadCellNPerCount = o["loadcell_n_per_count"] | 1.0f;
            c.leverArmM = o["lever_arm_m"] | 1.0f;
            c.filterAlpha = o["filter_alpha"] |
                (c.driver == I2cLoadCell ? 0.25f : 1.0f);
            c.pulsesPerUnit = o["pulses_per_unit"] | 1.0f; c.analogZeroMv = o["analog_zero_mv"] | 0.0f; c.analogMvPerUnit = o["analog_mv_per_unit"] | 1000.0f; c.analogDivider = o["analog_divider"] | 1.0f;
            if (!o["calibration_points"].isNull() &&
                !o["calibration_points"].is<JsonArrayConst>()) return false;
            JsonArrayConst calibrationPoints = o["calibration_points"].as<JsonArrayConst>();
            if (!calibrationPoints.isNull()) {
                for (JsonObjectConst point : calibrationPoints) {
                    if (c.calibrationPointCount >= PiecewiseCalibration::MAX_POINTS) return false;
                    const uint8_t p = c.calibrationPointCount++;
                    const int rawPoint = point["raw"] | -1;
                    const float physicalValue = point["value"] | NAN;
                    if (rawPoint < 0 || rawPoint > 4095 || !isfinite(physicalValue)) return false;
                    c.calibrationRaw[p] = (uint16_t)rawPoint;
                    c.calibrationValue[p] = physicalValue;
                }
            }
            c.digitalThresholdRaw = constrain(o["digital_threshold_raw"] | 2048, 0, 4095);
            c.digitalHysteresisRaw = constrain(o["digital_hysteresis_raw"] | 64, 0, 2047);
            c.torqueInterface = o["torque_interface"] | 0; c.hx711Clk = o["hx711_clk"] | -1; c.hx711Scale = o["hx711_scale"] | 1.0f; c.hx711Zero = o["hx711_zero"] | 0;
            c.temperatureInterface = o["temp_interface"] | 0; c.spiClk = o["spi_clk"] | -1; c.spiCs = o["spi_cs"] | -1; c.spiMiso = o["spi_miso"] | -1; c.spiMosi = o["spi_mosi"] | -1; strlcpy(c.tcType, o["tc_type"] | "K", sizeof(c.tcType));
            c.temperatureResolution = o["temp_resolution"] | 10; c.thermistorBeta = o["ntc_beta"] | 3950.0f; c.thermistorR0 = o["ntc_r0"] | 10000.0f; c.thermistorRFixed = o["ntc_r_fixed"] | 10000.0f; c.thermistorPullup = o["ntc_pullup"] | true;
            c.safeDemand = o["safe_demand"] | (!strcmp(c.purpose, "prop_pitch") ? 1.0f : 0.0f); c.forceSafeOnFault = o["force_safe_on_fault"] | false; c.minimumRunDemand = o["min_run_demand"] | 0.0f; c.pwmTimingConfigured = !o["pwm_freq_hz"].isNull() || !o["pwm_res_bits"].isNull(); c.pwmFrequency = o["pwm_freq_hz"] | 5000; c.pwmResolution = o["pwm_res_bits"] | 10;
            c.inverted = o["invert"] | false; c.activeHigh = o["active_high"] | true; c.pullup = o["pullup"] | false; c.pulldown = o["pulldown"] | false; c.hasCurrent = o["has_current"] | false; c.currentPin = o["current_pin"] | -1; c.currentMvPerA = o["current_mv_a"] | 100.0f; c.currentZeroV = o["current_zero_v"] | 1.65f; c.currentMaxAmps = o["current_max_a"] | 0.0f; c.currentReadyAmps = o["current_ready_a"] | 3.0f; c.currentTripDelayMs = o["current_trip_delay_ms"] | 5000UL;
            c.ignitionProfileConfigured = !o["ignition_mode"].isNull() ||
                !o["ignition_dwell_ms"].isNull() || !o["ignition_rest_ms"].isNull() ||
                !o["ignition_coil_sat_a"].isNull() || !o["ignition_preheat_ms"].isNull() ||
                !o["ignition_peak_demand"].isNull() || !o["ignition_hold_demand"].isNull() ||
                !o["ignition_wait_hot"].isNull() || !o["ignition_hot_timeout_ms"].isNull() ||
                !o["paired_output"].isNull() || !o["paired_output_delay_ms"].isNull() ||
                !o["paired_output_demand"].isNull();
            c.ignitionMode = o["ignition_mode"] | 0;
            if (c.driver == Relay || c.driver == I2cRelay) c.ignitionMode = 0;
            c.ignitionDwellMs = constrain(o["ignition_dwell_ms"] | 6, 1, 200);
            c.ignitionRestMs = constrain(o["ignition_rest_ms"] | 3, 1, 200);
            c.ignitionCoilSatAmps = o["ignition_coil_sat_a"] | 8.0f;
            c.ignitionPreheatMs = constrain((uint32_t)(o["ignition_preheat_ms"] | 10000UL), (uint32_t)0, (uint32_t)3600000);
            c.ignitionPeakDemand = constrain(o["ignition_peak_demand"] | 0.8f, 0.0f, 1.0f);
            c.ignitionHoldDemand = constrain(o["ignition_hold_demand"] | 0.3f, 0.0f, 1.0f);
            c.ignitionWaitUntilHot = o["ignition_wait_hot"] | false;
            c.ignitionHotTimeoutMs = constrain((uint32_t)(o["ignition_hot_timeout_ms"] | 30000UL), (uint32_t)100, (uint32_t)3600000);
            strlcpy(c.pairedOutputId, o["paired_output"] | "", sizeof(c.pairedOutputId));
            c.pairedOutputDelayMs = constrain((uint32_t)(o["paired_output_delay_ms"] | 8000UL), (uint32_t)0, (uint32_t)3600000);
            c.pairedOutputDemand = constrain(o["paired_output_demand"] | 1.0f, 0.0f, 1.0f);
            c.hasFlowMonitor = o["has_flow_monitor"] | false; c.minimumFlow = o["minimum_flow_l_min"] | 0.0f;
            strlcpy(c.flowInputId, o["flow_input"] | "", sizeof(c.flowInputId));
            if (c.pullup) c.pulldown = false;
            if (!add(c)) {
                Serial.printf(
                    "[ChannelRegistry] rejected %s channel id=%s driver=%u pin=%d "
                    "role=%s purpose=%s id_ok=%d driver_ok=%d role_ok=%d purpose_ok=%d "
                    "semantic_ok=%d demands_ok=%d\n",
                    d == Input ? "input" : "output", c.id, (unsigned)c.driver,
                    (int)c.pin, c.role, c.purpose, validId(c.id),
                    driverMatches(d, c.driver), roleValid(d, c.role),
                    purposeValid(d, c.purpose), semanticDriverValid(c),
                    demandsValid(c));
                return false;
            }
        }
        return true;
    }
};
