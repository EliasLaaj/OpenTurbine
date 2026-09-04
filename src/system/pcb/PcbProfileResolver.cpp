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
    using Driver = ChannelRegistry::Driver;
    const bool lowTemperature = !strcmp(channel.purpose, "oil_temperature") ||
                                !strcmp(channel.purpose, "coolant_temp") ||
                                !strcmp(channel.purpose, "intake_temperature");
    const bool thermocoupleTemperature = !strcmp(channel.purpose, "oil_temperature") ||
                                         !strcmp(channel.purpose, "tot") ||
                                         !strcmp(channel.purpose, "tit");
    if (!strcmp(adapter, "spi_thermocouple") && !thermocoupleTemperature) return false;
    if (!strcmp(adapter, "onewire_temperature") && !lowTemperature) return false;
    Driver driver;
    if (!strcmp(adapter, "digital_input")) driver = Driver::Digital;
    else if (!strcmp(adapter, "analog_input") || !strcmp(adapter, "spi_thermocouple") ||
             !strcmp(adapter, "onewire_temperature")) driver = Driver::Analog;
    else if (!strcmp(adapter, "pcnt_input")) driver = Driver::Pulse;
    else if (!strcmp(adapter, "rc_pwm_input")) driver = Driver::RcPwm;
    else if (!strcmp(adapter, "pwm_duty_input")) driver = Driver::PwmDuty;
    else if (!strcmp(adapter, "i2c_digital_input")) driver = Driver::I2cDigital;
    else if (!strcmp(adapter, "i2c_adc_input") || !strcmp(adapter, "i2c_adc_digital_input")) driver = Driver::I2cAnalog;
    else if (!strcmp(adapter, "i2c_load_cell")) driver = Driver::I2cLoadCell;
    else if (!strcmp(adapter, "digital_output") || !strcmp(adapter, "relay_output")) driver = Driver::Relay;
    else if (!strcmp(adapter, "pwm_output")) driver = Driver::Pwm;
    else if (!strcmp(adapter, "servo_output")) driver = Driver::Servo;
    else if (!strcmp(adapter, "i2c_digital_output")) driver = Driver::I2cRelay;
    else return false;
    return ChannelRegistry::purposeRoleDriverValid(channel.direction, channel.purpose,
                                                   channel.role, driver);
}

bool applyMode(ChannelRegistry::Channel& channel,
               const PcbProfileManager::Mode& mode,
               char* reason, size_t reasonSize,
               bool seedUserInputOptions = false) {
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
    // GPIO routing and the electrical adapter belong to the immutable PCB
    // profile. Polarity and internal bias belong to the engine assignment: a
    // plain exposed GPIO may electrically be used with pull-up, pull-down, or
    // no internal bias. Seed profile defaults for new assignments, but do not
    // overwrite the user's saved choice every time the profile is resolved.
    if (!input || seedUserInputOptions) {
        channel.activeHigh = mode.activeHigh;
        channel.inverted = !mode.activeHigh;
    }
    if (input && seedUserInputOptions) {
        channel.pullup = mode.pull == 1;
        channel.pulldown = mode.pull == 2;
    }
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
            const bool hasPort = channel.physicalPortId[0] != '\0';
            const bool hasMode = channel.physicalModeId[0] != '\0';
            if (hasPort != hasMode)
                return fail(reason, reasonSize,
                            "PCB channel has an incomplete named-port assignment");
            if (!hasPort) {
                // A PCB profile owns its labelled connectors and fixed
                // functions, not every otherwise free ESP32 pad. Advanced
                // builders may deliberately use a spare GPIO. It remains an
                // ordinary registry channel and still passes the platform,
                // role/driver, and global collision validation.
                if (channel.pin < 0)
                    return fail(reason, reasonSize,
                                "bare-GPIO channel has no GPIO assignment");
                if (PcbProfileManager::gpioReserved(channel.pin))
                    return fail(reason, reasonSize,
                                "bare-GPIO channel uses a pin reserved by the PCB");
                continue;
            }
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

bool PcbProfileResolver::addProfileDefaults(ChannelRegistry& registry,
                                            char* reason, size_t reasonSize) {
    if (!PcbProfileManager::active()) return !PcbProfileManager::faulted();
    const auto* catalog = PcbProfileManager::catalog();
    if (!catalog) return fail(reason, reasonSize, "PCB profile catalog is unavailable");
    for (uint8_t i = 0; i < catalog->portCount; ++i) {
        const auto& port = catalog->ports[i];
        for (uint8_t j = 0; j < port.modeCount; ++j) {
            const auto& mode = port.modes[j];
            if (!mode.defaultId[0]) continue;
            ChannelRegistry::Channel channel;
            channel.installed = true;
            channel.direction = strstr(mode.adapter, "output")
                ? ChannelRegistry::Output : ChannelRegistry::Input;
            channel.driver = channel.direction == ChannelRegistry::Input
                ? ChannelRegistry::Digital : ChannelRegistry::Relay;
            strlcpy(channel.id, mode.defaultId, sizeof(channel.id));
            strlcpy(channel.name, mode.defaultName, sizeof(channel.name));
            strlcpy(channel.role, mode.defaultRole, sizeof(channel.role));
            strlcpy(channel.purpose, mode.defaultPurpose, sizeof(channel.purpose));
            strlcpy(channel.physicalPortId, port.id, sizeof(channel.physicalPortId));
            strlcpy(channel.physicalModeId, mode.id, sizeof(channel.physicalModeId));
            channel.safeDemand = 0.0f;
            if (!applyMode(channel, mode, reason, reasonSize, true)) return false;
            if (!registry.add(channel))
                return fail(reason, reasonSize,
                            "PCB profile default assignment could not be added");
        }
    }
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
