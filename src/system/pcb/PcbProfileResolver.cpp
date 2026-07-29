#include "PcbProfileResolver.h"

#include "PcbProfileManager.h"
#include "../HardwareConfig.h"

namespace {
bool fail(char* reason, size_t size, const char* message) {
    if (reason && size) strlcpy(reason, message, size);
    return false;
}

const char* deviceDriver(const PcbProfileManager::Mode& mode) {
    const auto* device = PcbProfileManager::findDevice(mode.deviceId);
    return device ? device->driver : "";
}

bool purposeAcceptsAdapter(const ChannelRegistry::Channel& channel, const char* adapter) {
    const char* purpose = channel.purpose;
    if (channel.direction == ChannelRegistry::Output) {
        const bool relay = !strcmp(adapter, "digital_output") ||
                           !strcmp(adapter, "relay_output") ||
                           !strcmp(adapter, "i2c_digital_output");
        const bool pwm = !strcmp(adapter, "pwm_output");
        const bool servo = !strcmp(adapter, "servo_output");
        if (!strcmp(purpose, "main_fuel") || !strcmp(purpose, "prop_pitch") ||
            !strcmp(purpose, "nozzle_actuator"))
            return pwm || servo;
        if (!strcmp(purpose, "fuel_shutoff") || !strcmp(purpose, "ab_valve"))
            return relay;
        if (!strcmp(purpose, "igniter") || !strcmp(purpose, "ab_igniter") ||
            !strcmp(purpose, "glow_plug") || !strcmp(purpose, "warning_indicator"))
            return relay || pwm;
        if (!strcmp(purpose, "starter") || !strcmp(purpose, "starter_enable") ||
            !strcmp(purpose, "oil_pump") || !strcmp(purpose, "coolant_pump") ||
            !strcmp(purpose, "scavenge_pump") || !strcmp(purpose, "cooling_fan") ||
            !strcmp(purpose, "fuel_pump") || !strcmp(purpose, "valve") ||
            !strcmp(purpose, "air_starter") || !strcmp(purpose, "pilot_fuel") ||
            !strcmp(purpose, "purge_valve") || !strcmp(purpose, "ab_pump") ||
            !strcmp(purpose, "generic"))
            return relay || pwm || servo;
        return false;
    }
    const bool analog = !strcmp(adapter, "analog_input") || !strcmp(adapter, "i2c_adc_input");
    const bool digital = !strcmp(adapter, "digital_input") || !strcmp(adapter, "i2c_digital_input");
    if (!strcmp(purpose, "throttle") || !strcmp(purpose, "idle") ||
        !strcmp(purpose, "ab_command"))
        return analog || !strcmp(adapter, "rc_pwm_input") || !strcmp(adapter, "pwm_duty_input");
    if (!strcmp(purpose, "start_switch") || !strcmp(purpose, "stop_switch") ||
        !strcmp(purpose, "digital_switch") || !strcmp(purpose, "inhibit_start") ||
        !strcmp(purpose, "estop") || !strcmp(purpose, "fault") ||
        !strcmp(purpose, "low_oil_switch") || !strcmp(purpose, "oil_zero_switch") ||
        !strcmp(purpose, "sequence_gate") || !strcmp(purpose, "ab_arm") ||
        !strcmp(purpose, "ab_fire") || !strcmp(purpose, "limp_mode"))
        return digital || !strcmp(adapter, "i2c_adc_digital_input");
    if (!strcmp(purpose, "n1_speed") || !strcmp(purpose, "n2_speed") ||
        !strcmp(purpose, "shaft_speed") || !strcmp(purpose, "fuel_flow"))
        return analog || !strcmp(adapter, "pcnt_input");
    if (!strcmp(purpose, "oil_pressure") || !strcmp(purpose, "fuel_pressure") ||
        !strcmp(purpose, "p1_pressure") || !strcmp(purpose, "p2_pressure") ||
        !strcmp(purpose, "coolant_pressure") || !strcmp(purpose, "battery_voltage"))
        return analog;
    if (!strcmp(purpose, "torque") || !strcmp(purpose, "thrust"))
        return analog || !strcmp(adapter, "i2c_load_cell");
    if (!strcmp(purpose, "flame") || !strcmp(purpose, "ab_flame"))
        return analog || digital;
    if (!strcmp(purpose, "tot") || !strcmp(purpose, "tit"))
        return analog || !strcmp(adapter, "spi_thermocouple");
    if (!strcmp(purpose, "oil_temperature") || !strcmp(purpose, "coolant_temp") ||
        !strcmp(purpose, "intake_temperature"))
        return analog || !strcmp(adapter, "spi_thermocouple") ||
               !strcmp(adapter, "onewire_temperature");
    return !strcmp(purpose, "generic");
}

bool applyMode(ChannelRegistry::Channel& channel,
               const PcbProfileManager::Mode& mode,
               char* reason, size_t reasonSize) {
    using Driver = ChannelRegistry::Driver;
    using Direction = ChannelRegistry::Direction;
    const char* adapter = mode.adapter;
    bool input = channel.direction == Direction::Input;
    if (!purposeAcceptsAdapter(channel, adapter))
        return fail(reason, reasonSize, "PCB port signal is incompatible with the selected engine purpose");

    if (!strcmp(adapter, "digital_input") && input) channel.driver = Driver::Digital;
    else if (!strcmp(adapter, "analog_input") && input) channel.driver = Driver::Analog;
    else if (!strcmp(adapter, "pcnt_input") && input) channel.driver = Driver::Pulse;
    else if (!strcmp(adapter, "rc_pwm_input") && input) channel.driver = Driver::RcPwm;
    else if (!strcmp(adapter, "pwm_duty_input") && input) channel.driver = Driver::PwmDuty;
    else if (!strcmp(adapter, "i2c_digital_input") && input) channel.driver = Driver::I2cDigital;
    else if (!strcmp(adapter, "i2c_adc_input") && input) channel.driver = Driver::I2cAnalog;
    else if (!strcmp(adapter, "i2c_adc_digital_input") && input)
        channel.driver = Driver::I2cAnalog;
    else if (!strcmp(adapter, "i2c_load_cell") && input) channel.driver = Driver::I2cLoadCell;
    else if (!strcmp(adapter, "spi_thermocouple") && input) {
        channel.driver = Driver::Analog;
        const char* chip = deviceDriver(mode);
        channel.temperatureInterface = !strcmp(chip, "max6675") ? 1 :
                                       !strcmp(chip, "max31855") ? 2 :
                                       !strcmp(chip, "max31856") ? 3 : 0;
        if (!channel.temperatureInterface)
            return fail(reason, reasonSize, "thermocouple port uses an unsupported chip");
        const auto* device = PcbProfileManager::findDevice(mode.deviceId);
        const auto* bus = device ? PcbProfileManager::findBus(device->busId) : nullptr;
        if (!device || !bus || strcmp(bus->kind, "spi"))
            return fail(reason, reasonSize, "thermocouple port has no valid SPI device/bus");
        channel.spiClk = bus->sck;
        channel.spiMiso = bus->miso;
        channel.spiMosi = bus->mosi;
        channel.spiCs = device->selectGpio;
    } else if (!strcmp(adapter, "onewire_temperature") && input) {
        channel.driver = Driver::Analog;
        channel.temperatureInterface = 5;
    } else if ((!strcmp(adapter, "digital_output") || !strcmp(adapter, "relay_output")) && !input)
        channel.driver = Driver::Relay;
    else if (!strcmp(adapter, "pwm_output") && !input) channel.driver = Driver::Pwm;
    else if (!strcmp(adapter, "servo_output") && !input) channel.driver = Driver::Servo;
    else if (!strcmp(adapter, "i2c_digital_output") && !input) channel.driver = Driver::I2cRelay;
    else return fail(reason, reasonSize, "PCB port mode is incompatible with channel direction or firmware");

    channel.pin = mode.gpio;
    channel.activeHigh = mode.activeHigh;
    channel.inverted = !mode.activeHigh;
    channel.pullup = input && mode.pull == 1;
    channel.pulldown = input && mode.pull == 2;
    if (!input) channel.safeDemand = mode.safeDemand;

    if (channel.driver == Driver::I2cDigital || channel.driver == Driver::I2cAnalog ||
        channel.driver == Driver::I2cLoadCell || channel.driver == Driver::I2cRelay) {
        const auto* device = PcbProfileManager::findDevice(mode.deviceId);
        if (!device) return fail(reason, reasonSize, "I2C port refers to a missing device");
        channel.i2cAddress = device->address;
        channel.deviceChannel = mode.channel;
        channel.pin = -1;
        if (channel.driver == Driver::I2cAnalog)
            channel.i2cReferenceMv = mode.referenceMv;
    }
    return true;
}
}

bool PcbProfileResolver::resolve(ChannelRegistry& registry,
                                 char* reason, size_t reasonSize) {
    if (!PcbProfileManager::active()) return !PcbProfileManager::faulted();

    const auto* catalog = PcbProfileManager::catalog();
    if (catalog && catalog->hasSupplyVoltage) {
        ChannelRegistry::Channel* battery =
            registry.findMutable("battery_voltage", ChannelRegistry::Input);
        if (!battery) {
            ChannelRegistry::Channel fixed;
            fixed.installed = true;
            fixed.direction = ChannelRegistry::Input;
            fixed.driver = ChannelRegistry::Analog;
            strlcpy(fixed.id, "battery_voltage", sizeof(fixed.id));
            strlcpy(fixed.name, "ECU Supply", sizeof(fixed.name));
            strlcpy(fixed.role, "voltage", sizeof(fixed.role));
            strlcpy(fixed.purpose, "battery_voltage", sizeof(fixed.purpose));
            fixed.pin = catalog->supplyVoltageGpio;
            fixed.minValue = 0.0f;
            fixed.maxValue = 4095.0f;
            fixed.analogDivider = catalog->supplyVoltageDivider;
            if (!registry.add(fixed))
                return fail(reason, reasonSize,
                            "cannot add the PCB's fixed supply-voltage monitor");
            battery = registry.findMutable("battery_voltage", ChannelRegistry::Input);
        }
        if (!battery)
            return fail(reason, reasonSize, "fixed supply-voltage monitor is unavailable");
        battery->installed = true;
        battery->direction = ChannelRegistry::Input;
        battery->driver = ChannelRegistry::Analog;
        battery->pin = catalog->supplyVoltageGpio;
        battery->minValue = 0.0f;
        battery->maxValue = 4095.0f;
        battery->analogDivider = catalog->supplyVoltageDivider;
        battery->physicalPortId[0] = '\0';
        battery->physicalModeId[0] = '\0';
        strlcpy(battery->role, "voltage", sizeof(battery->role));
        strlcpy(battery->purpose, "battery_voltage", sizeof(battery->purpose));
    }

    const char* claimed[ChannelRegistry::MAX_INPUT_CHANNELS +
                        ChannelRegistry::MAX_OUTPUT_CHANNELS] = {};
    uint8_t claimCount = 0;
    auto resolveList = [&](ChannelRegistry::Channel* channels, uint8_t count) {
        for (uint8_t i = 0; i < count; ++i) {
            auto& channel = channels[i];
            if (catalog && catalog->hasSupplyVoltage &&
                channel.direction == ChannelRegistry::Input &&
                !strcmp(channel.id, "battery_voltage"))
                continue;
            if (!channel.physicalPortId[0] || !channel.physicalModeId[0])
                return fail(reason, reasonSize,
                            "profile-mode channel is missing its named PCB port");
            for (uint8_t j = 0; j < claimCount; ++j)
                if (!strcmp(claimed[j], channel.physicalPortId))
                    return fail(reason, reasonSize,
                                "one PCB port is assigned to more than one channel");
            const auto* port = PcbProfileManager::findPort(channel.physicalPortId);
            if (!port) return fail(reason, reasonSize,
                                   "saved channel refers to a port not present on this PCB");
            const auto* mode = PcbProfileManager::findMode(*port, channel.physicalModeId);
            if (!mode) return fail(reason, reasonSize,
                                   "saved channel refers to a mode not present on this PCB port");
            if (!applyMode(channel, *mode, reason, reasonSize)) return false;
            claimed[claimCount++] = channel.physicalPortId;
        }
        return true;
    };
    if (!resolveList(registry.inputs, registry.inputCount) ||
        !resolveList(registry.outputs, registry.outputCount)) return false;
    if (!registry.validate())
        return fail(reason, reasonSize,
                    "resolved PCB ports are incompatible with their engine purposes or ranges");
    return true;
}

void PcbProfileResolver::applyFixedBuses() {
    if (!PcbProfileManager::active()) return;
    const auto* catalog = PcbProfileManager::catalog();
    if (!catalog) return;
    for (uint8_t i = 0; i < catalog->busCount; ++i) {
        const auto& bus = catalog->buses[i];
        if (!strcmp(bus.kind, "i2c")) {
            HardwareConfig::i2cEnabled = true;
            HardwareConfig::i2cSdaPin = bus.sda;
            HardwareConfig::i2cSclPin = bus.scl;
            HardwareConfig::i2cInterruptPin = bus.interrupt;
            if (bus.frequencyHz) HardwareConfig::i2cFrequencyHz = bus.frequencyHz;
        } else if (!strcmp(bus.kind, "spi")) {
            HardwareConfig::spiEnabled = true;
            HardwareConfig::spiSckPin = bus.sck;
            HardwareConfig::spiMisoPin = bus.miso;
            HardwareConfig::spiMosiPin = bus.mosi;
        }
    }
}

void PcbProfileResolver::applyFixedPeripherals() {
    if (!PcbProfileManager::active()) return;
    const auto* catalog = PcbProfileManager::catalog();
    if (!catalog) return;

    HardwareConfig::hasStatusLed = catalog->hasStatusLed;
    HardwareConfig::statusLedPin = catalog->hasStatusLed ? catalog->statusLedGpio : -1;
    HardwareConfig::statusLedType = catalog->statusLedType;
    HardwareConfig::statusLedActiveH = catalog->statusLedActiveHigh;
    HardwareConfig::hasBuzzer = catalog->hasBuzzer;
    HardwareConfig::buzzerPin = catalog->hasBuzzer ? catalog->buzzerGpio : -1;

    auto applySerial = [&](const char* busId, bool& enabled, int& tx, int* rx) {
        if (!busId || !busId[0]) {
            enabled = false;
            tx = -1;
            if (rx) *rx = -1;
            return;
        }
        const auto* bus = PcbProfileManager::findBus(busId);
        if (!bus || strcmp(bus->kind, "uart")) {
            enabled = false;
            tx = -1;
            if (rx) *rx = -1;
            return;
        }
        tx = bus->tx;
        if (rx) *rx = bus->rx;
    };
    applySerial(catalog->clusterSerialBusId, HardwareConfig::hasClusterSerial,
                HardwareConfig::clusterTxPin, &HardwareConfig::clusterRxPin);
    applySerial(catalog->mavlinkBusId, HardwareConfig::hasMAVLink,
                HardwareConfig::mavlinkTxPin, nullptr);
}
