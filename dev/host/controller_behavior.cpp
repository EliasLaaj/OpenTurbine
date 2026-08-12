#include "../../src/engine/controllers/PowerTurbineGovernor.h"
#include "../../src/hal/AdcThreshold.h"
#include "../../src/hal/i2c/LossRecheck.h"
#include "../../src/system/ChannelRegistry.h"
#include <cassert>
#include <cmath>
#include <cstring>
#include <iostream>

EngineData& EngineData::instance() {
    static EngineData data;
    return data;
}

static void resetData() {
    auto& ed = EngineData::instance();
    ed.n2Rpm = 0.0f;
    ed.n2Healthy = true;
    ed.throttleDemand = 0.5f;
    ed.propPitchDemand = 0.5f;
    std::strcpy(ed.governorControllerState, "Off");
    fakeMillisClock() = 0;
}

int main() {
    // PWM validation follows the ESP32 timer's real 80 MHz timing budget,
    // preserving every achievable user-selected pair without accepting a
    // configuration that can only fail when the driver attaches at boot.
    assert(ChannelRegistry::pwmTimingValid(100000, 8));
    assert(!ChannelRegistry::pwmTimingValid(100000, 10));
    assert(ChannelRegistry::pwmTimingValid(4882, 14));
    assert(!ChannelRegistry::pwmTimingValid(4883, 14));
    assert(!ChannelRegistry::pwmTimingValid(0, 10));

    // Duplicate engine-purpose outputs have exactly one built-in controller
    // owner. An explicit advanced binding intentionally transfers ownership;
    // the other card remains available to rules and sequences.
    ChannelRegistry outputOwners;
    ChannelRegistry::Channel primaryFuel;
    primaryFuel.installed = true;
    primaryFuel.direction = ChannelRegistry::Output;
    primaryFuel.driver = ChannelRegistry::Pwm;
    primaryFuel.pin = 25;
    std::strcpy(primaryFuel.id, "main_fuel");
    std::strcpy(primaryFuel.name, "Main fuel");
    std::strcpy(primaryFuel.role, "fuel");
    std::strcpy(primaryFuel.purpose, "main_fuel");
    assert(outputOwners.add(primaryFuel));
    ChannelRegistry::Channel auxiliaryFuel = primaryFuel;
    auxiliaryFuel.pin = 26;
    std::strcpy(auxiliaryFuel.id, "aux_fuel");
    std::strcpy(auxiliaryFuel.name, "Aux fuel");
    assert(outputOwners.add(auxiliaryFuel));
    assert(outputOwners.ownsCoreOutput(outputOwners.outputs[0]));
    assert(!outputOwners.ownsCoreOutput(outputOwners.outputs[1]));
    outputOwners.bindingCount = 1;
    std::strcpy(outputOwners.bindings[0].key, "main_fuel_output");
    std::strcpy(outputOwners.bindings[0].channelId, "aux_fuel");
    assert(!outputOwners.ownsCoreOutput(outputOwners.outputs[0]));
    assert(outputOwners.ownsCoreOutput(outputOwners.outputs[1]));

    // Every I2C input/output gets the same full 500 ms recovery opportunity.
    assert(!LossRecheck::expired(1499, 1000, true));
    assert(LossRecheck::expired(1500, 1000, true));
    assert(LossRecheck::expired(25, UINT32_MAX - 474, true)); // millis rollover
    assert(!LossRecheck::expired(500, 0, false));
    assert(LossRecheck::expired(500, 0, true)); // loss began exactly at millis zero

    // Threshold hysteresis retains the previous state inside its own range.
    assert(!AdcThreshold::update(2049, 2050, 20, false));
    assert(AdcThreshold::update(2060, 2050, 20, false));
    assert(AdcThreshold::update(2041, 2050, 20, true));
    assert(!AdcThreshold::update(2039, 2050, 20, true));

    // Registry validation matches the actual supported I2C chip address
    // families and permits TLA2528 threshold-backed safety switches.
    ChannelRegistry registry;
    ChannelRegistry::Channel tlaSwitch;
    tlaSwitch.installed = true;
    tlaSwitch.direction = ChannelRegistry::Input;
    tlaSwitch.driver = ChannelRegistry::I2cAnalog;
    std::strcpy(tlaSwitch.id, "stop_adc");
    std::strcpy(tlaSwitch.name, "Stop ADC");
    std::strcpy(tlaSwitch.role, "digital_switch");
    std::strcpy(tlaSwitch.purpose, "stop_switch");
    tlaSwitch.i2cAddress = 0x10;
    assert(registry.add(tlaSwitch));

    ChannelRegistry::Channel invalidTla = tlaSwitch;
    std::strcpy(invalidTla.id, "bad_adc");
    std::strcpy(invalidTla.purpose, "sequence_gate");
    invalidTla.i2cAddress = 0x20;
    assert(!registry.add(invalidTla));

    ChannelRegistry::Channel torque;
    torque.installed = true;
    torque.direction = ChannelRegistry::Input;
    torque.driver = ChannelRegistry::I2cAnalog;
    std::strcpy(torque.id, "torque_main");
    std::strcpy(torque.name, "Torque");
    std::strcpy(torque.role, "torque");
    std::strcpy(torque.purpose, "torque");
    torque.i2cAddress = 0x11;
    assert(registry.add(torque));

    ChannelRegistry::Channel invalidRelay;
    invalidRelay.installed = true;
    invalidRelay.direction = ChannelRegistry::Output;
    invalidRelay.driver = ChannelRegistry::I2cRelay;
    std::strcpy(invalidRelay.id, "bad_relay");
    std::strcpy(invalidRelay.name, "Bad Relay");
    std::strcpy(invalidRelay.role, "valve");
    std::strcpy(invalidRelay.purpose, "purge_valve");
    invalidRelay.i2cAddress = 0x10;
    assert(!registry.add(invalidRelay));

    // The firmware contract must accept every combination advertised by the
    // Hardware page, while rejecting combinations whose runtime adapter cannot
    // implement the selected turbine function.
    struct Capability {
        ChannelRegistry::Direction direction;
        const char* purpose;
        const char* role;
        const ChannelRegistry::Driver* drivers;
        size_t count;
    };
    using D = ChannelRegistry::Driver;
    static const D speed[] = {D::Pulse, D::Analog, D::I2cAnalog};
    static const D analog[] = {D::Analog, D::I2cAnalog};
    static const D flow[] = {D::Pulse, D::Analog, D::I2cAnalog};
    static const D flame[] = {D::Digital, D::Analog, D::I2cDigital, D::I2cAnalog};
    static const D load[] = {D::Analog, D::I2cAnalog, D::I2cLoadCell};
    static const D throttle[] = {D::Analog, D::RcPwm, D::Pulse, D::PwmDuty, D::I2cAnalog};
    static const D idle[] = {D::Digital, D::Analog, D::RcPwm, D::Pulse, D::PwmDuty, D::I2cDigital, D::I2cAnalog};
    static const D abCommand[] = {D::Analog, D::RcPwm, D::PwmDuty, D::I2cAnalog};
    static const D switches[] = {D::Digital, D::I2cDigital, D::I2cAnalog};
    static const D metered[] = {D::Pwm, D::Servo};
    static const D relayOnly[] = {D::Relay, D::I2cRelay};
    static const D generalOutput[] = {D::Relay, D::Pwm, D::Servo, D::I2cRelay};
    static const D ignition[] = {D::Relay, D::Pwm, D::I2cRelay};
    static const D genericInput[] = {D::Digital, D::Analog, D::Pulse, D::RcPwm, D::PwmDuty, D::I2cDigital, D::I2cAnalog};

#define CAP(dir, purpose, role, drivers) {dir, purpose, role, drivers, sizeof(drivers)/sizeof(drivers[0])}
    static const Capability capabilities[] = {
        CAP(ChannelRegistry::Input,"n1_speed","speed",speed), CAP(ChannelRegistry::Input,"n2_speed","speed",speed),
        CAP(ChannelRegistry::Input,"shaft_speed","speed",speed), CAP(ChannelRegistry::Input,"tot","temperature",analog),
        CAP(ChannelRegistry::Input,"tit","temperature",analog), CAP(ChannelRegistry::Input,"oil_pressure","pressure",analog),
        CAP(ChannelRegistry::Input,"fuel_pressure","pressure",analog), CAP(ChannelRegistry::Input,"p1_pressure","pressure",analog),
        CAP(ChannelRegistry::Input,"p2_pressure","pressure",analog), CAP(ChannelRegistry::Input,"coolant_pressure","pressure",analog),
        CAP(ChannelRegistry::Input,"oil_temperature","temperature",analog), CAP(ChannelRegistry::Input,"coolant_temp","temperature",analog),
        CAP(ChannelRegistry::Input,"intake_temperature","temperature",analog), CAP(ChannelRegistry::Input,"fuel_flow","flow",flow),
        CAP(ChannelRegistry::Input,"oil_flow","flow",flow), CAP(ChannelRegistry::Input,"scavenge_flow","flow",flow),
        CAP(ChannelRegistry::Input,"flame","flame",flame), CAP(ChannelRegistry::Input,"ab_flame","flame",flame),
        CAP(ChannelRegistry::Input,"torque","torque",load), CAP(ChannelRegistry::Input,"thrust","thrust",load),
        CAP(ChannelRegistry::Input,"battery_voltage","voltage",analog), CAP(ChannelRegistry::Input,"throttle","operator",throttle),
        CAP(ChannelRegistry::Input,"idle","operator",idle), CAP(ChannelRegistry::Input,"ab_command","operator",abCommand),
        CAP(ChannelRegistry::Input,"start_switch","digital_switch",switches), CAP(ChannelRegistry::Input,"stop_switch","digital_switch",switches),
        CAP(ChannelRegistry::Input,"digital_switch","digital_switch",switches), CAP(ChannelRegistry::Input,"inhibit_start","inhibit_start",switches),
        CAP(ChannelRegistry::Input,"estop","estop",switches), CAP(ChannelRegistry::Input,"fault","fault",switches),
        CAP(ChannelRegistry::Input,"low_oil_switch","low_oil_switch",switches), CAP(ChannelRegistry::Input,"oil_zero_switch","oil_zero_switch",switches),
        CAP(ChannelRegistry::Input,"sequence_gate","sequence_gate",switches), CAP(ChannelRegistry::Input,"ab_arm","ab_arm",switches),
        CAP(ChannelRegistry::Input,"ab_fire","ab_fire",switches), CAP(ChannelRegistry::Input,"limp_mode","limp_mode",switches),
        CAP(ChannelRegistry::Input,"generic","generic",genericInput),
        CAP(ChannelRegistry::Output,"main_fuel","fuel",metered), CAP(ChannelRegistry::Output,"fuel_shutoff","fuel_shutoff",relayOnly),
        CAP(ChannelRegistry::Output,"starter","starter",generalOutput), CAP(ChannelRegistry::Output,"starter_enable","starter_en",generalOutput),
        CAP(ChannelRegistry::Output,"oil_pump","oil_pump",generalOutput), CAP(ChannelRegistry::Output,"coolant_pump","coolant_pump",generalOutput),
        CAP(ChannelRegistry::Output,"scavenge_pump","scavenge_pump",generalOutput), CAP(ChannelRegistry::Output,"cooling_fan","cooling_fan",generalOutput),
        CAP(ChannelRegistry::Output,"fuel_pump","fuel_pump",generalOutput), CAP(ChannelRegistry::Output,"igniter","igniter",ignition),
        CAP(ChannelRegistry::Output,"ab_igniter","ab_igniter",ignition), CAP(ChannelRegistry::Output,"glow_plug","glow_plug",ignition),
        CAP(ChannelRegistry::Output,"valve","valve",generalOutput), CAP(ChannelRegistry::Output,"ab_valve","valve",relayOnly),
        CAP(ChannelRegistry::Output,"air_starter","starter",generalOutput), CAP(ChannelRegistry::Output,"pilot_fuel","valve",generalOutput),
        CAP(ChannelRegistry::Output,"purge_valve","valve",generalOutput), CAP(ChannelRegistry::Output,"drain_valve","valve",generalOutput),
        CAP(ChannelRegistry::Output,"nozzle_actuator","prop_pitch",metered), CAP(ChannelRegistry::Output,"ab_pump","ab_pump",generalOutput),
        CAP(ChannelRegistry::Output,"prop_pitch","prop_pitch",generalOutput), CAP(ChannelRegistry::Output,"warning_indicator","indicator",ignition),
        CAP(ChannelRegistry::Output,"generic","generic",generalOutput),
    };
#undef CAP
    for (const auto& capability : capabilities)
        for (size_t i = 0; i < capability.count; ++i)
            assert(ChannelRegistry::purposeRoleDriverValid(capability.direction,
                capability.purpose, capability.role, capability.drivers[i]));
    assert(!ChannelRegistry::purposeRoleDriverValid(ChannelRegistry::Output,
        "main_fuel", "fuel", D::Relay));
    assert(!ChannelRegistry::purposeRoleDriverValid(ChannelRegistry::Output,
        "fuel_shutoff", "fuel_shutoff", D::Servo));
    assert(!ChannelRegistry::purposeRoleDriverValid(ChannelRegistry::Input,
        "oil_pressure", "pressure", D::I2cLoadCell));
    assert(!ChannelRegistry::purposeRoleDriverValid(ChannelRegistry::Input,
        "tot", "temperature", D::I2cLoadCell));
    assert(!ChannelRegistry::purposeRoleDriverValid(ChannelRegistry::Input,
        "battery_voltage", "voltage", D::I2cLoadCell));
    assert(!ChannelRegistry::purposeRoleDriverValid(ChannelRegistry::Input,
        "thrust", "torque", D::I2cLoadCell));
    assert(ChannelRegistry::purposeRoleDriverValid(ChannelRegistry::Input,
        "generic", "pressure", D::Analog));
    assert(!ChannelRegistry::purposeRoleDriverValid(ChannelRegistry::Input,
        "generic", "pressure", D::I2cLoadCell));
    assert(ChannelRegistry::purposeRoleDriverValid(ChannelRegistry::Output,
        "generic", "indicator", D::I2cRelay));

    auto& ed = EngineData::instance();
    PowerTurbineGovernor governor;
    governor.targetRpm = 10000;
    governor.bandRpm = 100;
    governor.usePropPitch = true;
    governor.pitchRampSec = 1.0f;

    // Proportional pitch: underspeed unloads/fines, overspeed loads/coarsens.
    resetData();
    governor.begin();
    fakeMillisClock() = 100;
    ed.n2Rpm = 9000;
    governor.tick();
    assert(ed.propPitchDemand < 0.5f);
    const float fineDemand = ed.propPitchDemand;
    fakeMillisClock() = 200;
    ed.n2Rpm = 11000;
    governor.tick();
    assert(ed.propPitchDemand > fineDemand);

    // Pitch endpoints never grant hidden main-fuel authority. The status tells
    // the operator which physical limit blocked the requested correction, and
    // authority recovers normally when the error reverses.
    resetData();
    ed.propPitchDemand = 0.0f;
    ed.throttleDemand = 0.42f;
    governor.begin();
    fakeMillisClock() = 100;
    ed.n2Rpm = 9000;
    governor.tick();
    assert(std::strstr(ed.governorControllerState, "Pitch limit: fine"));
    assert(std::fabs(ed.throttleDemand - 0.42f) < 0.0001f);
    fakeMillisClock() = 200;
    ed.n2Rpm = 11000;
    governor.tick();
    assert(ed.propPitchDemand > 0.0f);
    assert(std::strstr(ed.governorControllerState, "Active: prop pitch"));

    resetData();
    ed.propPitchDemand = 1.0f;
    ed.throttleDemand = 0.42f;
    governor.begin();
    fakeMillisClock() = 100;
    ed.n2Rpm = 11000;
    governor.tick();
    assert(std::strstr(ed.governorControllerState, "Pitch limit: coarse"));
    assert(std::fabs(ed.throttleDemand - 0.42f) < 0.0001f);

    // Relay pitch is deliberately supported as two-position fine/coarse
    // authority, with the RPM band retaining state as hysteresis.
    resetData();
    governor.twoPositionPitch = true;
    governor.begin();
    fakeMillisClock() = 100;
    ed.n2Rpm = 9000;
    governor.tick();
    assert(ed.propPitchDemand == 0.0f);
    fakeMillisClock() = 200;
    ed.n2Rpm = 10000;
    governor.tick();
    assert(ed.propPitchDemand == 0.0f);
    fakeMillisClock() = 300;
    ed.n2Rpm = 11000;
    governor.tick();
    assert(ed.propPitchDemand == 1.0f);

    // Feedback loss never unloads a propeller; it goes coarse-safe.
    ed.n2Healthy = false;
    ed.propPitchDemand = 0.0f;
    fakeMillisClock() = 400;
    governor.tick();
    assert(ed.propPitchDemand == 1.0f);
    assert(std::strstr(ed.governorControllerState, "coarse-safe"));

    // Two-position pitch cannot slew: disabling the governor after feedback
    // loss must release the coarse relay immediately.
    governor.targetRpm = 0.0f;
    fakeMillisClock() = 500;
    governor.tick();
    assert(ed.propPitchDemand == 0.0f);
    assert(std::strcmp(ed.governorControllerState, "Off") == 0);

    // Proportional pitch still releases smoothly, including after feedback
    // loss cleared the governor's active flag.
    governor.twoPositionPitch = false;
    governor.pitchRampSec = 1.0f;
    governor.targetRpm = 10000.0f;
    fakeMillisClock() = 600;
    governor.tick();
    const float coarseAfterLoss = ed.propPitchDemand;
    assert(coarseAfterLoss > 0.0f);
    governor.targetRpm = 0.0f;
    fakeMillisClock() = 650;
    governor.tick();
    assert(ed.propPitchDemand < coarseAfterLoss);
    assert(std::strcmp(ed.governorControllerState, "Off") == 0);
    governor.targetRpm = 10000.0f;

    // A second run begins from the actuator's current position, not stale
    // private state left by the first run.
    ed.n2Healthy = true;
    ed.propPitchDemand = 0.35f;
    fakeMillisClock() = 1000;
    governor.twoPositionPitch = false;
    governor.begin();
    fakeMillisClock() = 1100;
    ed.n2Rpm = 10000;
    governor.tick();
    assert(std::fabs(ed.propPitchDemand - 0.35f) < 0.0001f);

    // Main-fuel mode is loop-time scaled and obeys calibrated 0..100% bounds.
    resetData();
    governor.usePropPitch = false;
    governor.kp = 0.001f;
    governor.begin();
    fakeMillisClock() = 100;
    ed.n2Rpm = 9000;
    governor.tick();
    assert(std::fabs(ed.throttleDemand - 0.6f) < 0.0001f);
    fakeMillisClock() = 200;
    ed.n2Rpm = 0;
    governor.tick();
    assert(ed.throttleDemand <= 1.0f);

    std::cout << "real controller and I2C behavior passed\n";
}
