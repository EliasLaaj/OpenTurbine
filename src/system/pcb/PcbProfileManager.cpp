#include "PcbProfileManager.h"

#include <esp_partition.h>
#include <new>
#include "../../engine/EngineData.h"

namespace {
static constexpr uint8_t PROFILE_SUBTYPE = 0x40;
static constexpr uint8_t CONTAINER_VERSION = 1;
static constexpr uint8_t ENCODING_JSON = 1;
static constexpr uint8_t TARGET_ESP32 = 1;
static constexpr uint8_t TARGET_ESP32S3 = 2;

struct __attribute__((packed)) ProfileHeader {
    char magic[4];
    uint8_t containerVersion;
    uint8_t encoding;
    uint8_t formatMajor;
    uint8_t formatMinor;
    uint8_t targetChip;
    uint8_t origin;
    uint16_t headerSize;
    uint32_t payloadLength;
    uint32_t payloadCrc32;
    uint8_t reserved[12];
};
static_assert(sizeof(ProfileHeader) == 32, "PCB profile container header changed");

bool idValid(const char* value, size_t maxLength) {
    if (!value || !value[0] || strlen(value) >= maxLength) return false;
    if (!(value[0] >= 'a' && value[0] <= 'z') && !(value[0] >= '0' && value[0] <= '9'))
        return false;
    for (const char* p = value; *p; ++p)
        if (!((*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '_' || *p == '-'))
            return false;
    return true;
}

bool adapterKnown(const char* value) {
    static const char* const names[] = {
        "digital_input", "analog_input", "pcnt_input", "rc_pwm_input",
        "pwm_duty_input", "spi_thermocouple", "onewire_temperature",
        "i2c_digital_input", "i2c_adc_input", "i2c_load_cell",
        "digital_output", "relay_output", "pwm_output", "servo_output",
        "i2c_digital_output"
    };
    for (const char* name : names) if (!strcmp(name, value)) return true;
    return false;
}

int jsonPin(JsonObjectConst pins, const char* key) {
    return pins[key].is<int>() ? pins[key].as<int>() : -1;
}
}

PcbProfileManager::State PcbProfileManager::_state = PcbProfileManager::State::Absent;
PcbProfileManager::Catalog* PcbProfileManager::_catalog = nullptr;
char PcbProfileManager::_fault[128] = {};

void PcbProfileManager::setFault(const char* reason) {
    _state = State::Fault;
    strlcpy(_fault, reason ? reason : "unknown PCB profile error", sizeof(_fault));
    if (_catalog) {
        delete _catalog;
        _catalog = nullptr;
    }
    auto& ed = EngineData::instance();
    ed.configLocked = true;
    snprintf(ed.faultDescription, sizeof(ed.faultDescription),
             "Cannot start: flashed PCB profile is invalid (%s). Reinstall the correct board profile over USB.",
             _fault);
    Serial.printf("[PCBProfile] FAULT: %s\n", _fault);
}

uint32_t PcbProfileManager::crc32(const uint8_t* data, size_t length) {
    uint32_t crc = 0xFFFFFFFFU;
    for (size_t i = 0; i < length; ++i) {
        crc ^= data[i];
        for (uint8_t bit = 0; bit < 8; ++bit)
            crc = (crc >> 1) ^ (0xEDB88320U & (0U - (crc & 1U)));
    }
    return ~crc;
}

bool PcbProfileManager::copyText(char* dst, size_t size, const char* value,
                                 bool required, const char* field) {
    if (!value) value = "";
    if ((required && !value[0]) || strlen(value) >= size) {
        snprintf(_fault, sizeof(_fault), "%s is missing or too long", field);
        return false;
    }
    strlcpy(dst, value, size);
    return true;
}

bool PcbProfileManager::validTargetPin(int pin, bool output) {
    if (pin == -1) return true;
#if defined(OT_PLATFORM_ESP32S3)
    static const int8_t pins[] = {
        0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,21,
        35,36,37,38,39,40,41,42,43,44,45,46,47,48
    };
    if (output && pin == 46) return false;
#else
    static const int8_t pins[] = {
        0,1,2,3,4,5,12,13,14,15,16,17,18,19,21,22,23,25,26,27,
        32,33,34,35,36,39
    };
    if (output && (pin == 34 || pin == 35 || pin == 36 || pin == 39)) return false;
#endif
    for (int8_t candidate : pins) if (candidate == pin) return true;
    return false;
}

void PcbProfileManager::begin() {
    _state = State::Absent;
    _fault[0] = '\0';
    if (_catalog) {
        delete _catalog;
        _catalog = nullptr;
    }

    const esp_partition_t* partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)PROFILE_SUBTYPE, "pcbprof");
    if (!partition) {
        setFault("pcbprof partition is missing; USB clean install required");
        return;
    }

    ProfileHeader header = {};
    if (esp_partition_read(partition, 0, &header, sizeof(header)) != ESP_OK) {
        setFault("profile partition could not be read");
        return;
    }
    bool erased = true;
    const uint8_t* headerBytes = reinterpret_cast<const uint8_t*>(&header);
    for (size_t i = 0; i < sizeof(header); ++i)
        if (headerBytes[i] != 0xFF) { erased = false; break; }
    if (erased) {
        Serial.println("[PCBProfile] No profile - generic development-board mode");
        return;
    }
    if (memcmp(header.magic, "OTPB", 4) != 0) {
        setFault("profile partition contains unrecognized data");
        return;
    }
    if (header.containerVersion != CONTAINER_VERSION ||
        header.encoding != ENCODING_JSON || header.headerSize != sizeof(ProfileHeader)) {
        setFault("unsupported profile container");
        return;
    }
    if (header.formatMajor != 1) {
        setFault("unsupported PCB profile format");
        return;
    }
#if defined(OT_PLATFORM_ESP32S3)
    const uint8_t expectedTarget = TARGET_ESP32S3;
#else
    const uint8_t expectedTarget = TARGET_ESP32;
#endif
    if (header.targetChip != expectedTarget) {
        setFault("PCB profile targets a different ESP32 chip");
        return;
    }
    if (!header.payloadLength || header.payloadLength > MAX_PAYLOAD ||
        header.headerSize + header.payloadLength > partition->size) {
        setFault("PCB profile payload size is invalid");
        return;
    }

    uint8_t* payload = static_cast<uint8_t*>(malloc(header.payloadLength + 1));
    if (!payload) {
        setFault("not enough memory to read PCB profile");
        return;
    }
    if (esp_partition_read(partition, header.headerSize, payload, header.payloadLength) != ESP_OK) {
        free(payload);
        setFault("PCB profile payload could not be read");
        return;
    }
    payload[header.payloadLength] = '\0';
    if (crc32(payload, header.payloadLength) != header.payloadCrc32) {
        free(payload);
        setFault("PCB profile CRC does not match");
        return;
    }
    Origin origin = header.origin == 2 ? Origin::Official :
                    header.origin == 1 ? Origin::Custom : Origin::Unknown;
    const bool ok = parsePayload(payload, header.payloadLength,
                                 header.formatMajor, header.formatMinor, origin);
    free(payload);
    if (!ok) {
        char reason[sizeof(_fault)];
        strlcpy(reason, _fault[0] ? _fault : "PCB profile content is invalid", sizeof(reason));
        setFault(reason);
        return;
    }
    _state = State::Valid;
    driveEarlySafeStates();
    Serial.printf("[PCBProfile] %s rev %s (%s, %u ports)\n",
                  _catalog->boardName, _catalog->revision,
                  _catalog->origin == Origin::Official ? "official" : "custom",
                  _catalog->portCount);
}

void PcbProfileManager::driveEarlySafeStates() {
    if (_state != State::Valid || !_catalog) return;

    auto driveLevel = [](int pin, bool high) {
        if (pin < 0) return;
        digitalWrite(pin, high ? HIGH : LOW);
        pinMode(pin, OUTPUT);
    };
    auto driveInactive = [&](int pin, bool activeHigh) {
        driveLevel(pin, !activeHigh);
    };

    // Fixed indicators are always defined with a safe demand of zero.
    // For a NeoPixel, holding the data line inactive prevents spurious frames;
    // StatusLED initialization clears any previously latched pixel later.
    if (_catalog->hasStatusLed)
        driveInactive(_catalog->statusLedGpio, _catalog->statusLedActiveHigh);
    if (_catalog->hasBuzzer)
        driveInactive(_catalog->buzzerGpio, _catalog->buzzerActiveHigh);
    if (_catalog->hasServoOutputEnable)
        driveInactive(_catalog->servoOutputEnableGpio,
                      _catalog->servoOutputEnableActiveHigh);

    for (uint8_t i = 0; i < _catalog->portCount; ++i) {
        const Port& port = _catalog->ports[i];
        for (uint8_t j = 0; j < port.modeCount; ++j) {
            const Mode& mode = port.modes[j];
            if (mode.gpio < 0 || !strstr(mode.adapter, "output") ||
                !strncmp(mode.adapter, "i2c_", 4))
                continue;

            // PWM and servo outputs must not emit a waveform before their
            // driver owns the pin. Static inactive is safer than attempting
            // to approximate a fractional demand with a constant level.
            if (!strcmp(mode.adapter, "pwm_output") ||
                !strcmp(mode.adapter, "servo_output")) {
                driveInactive(mode.gpio, mode.activeHigh);
            } else {
                const bool commandedOn = mode.safeDemand >= 0.5f;
                driveLevel(mode.gpio, mode.activeHigh ? commandedOn : !commandedOn);
            }
        }
    }
}

bool PcbProfileManager::parsePayload(const uint8_t* payload, size_t length,
                                     uint8_t formatMajor, uint8_t formatMinor,
                                     Origin origin) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);
    if (error) {
        snprintf(_fault, sizeof(_fault), "profile JSON: %s", error.c_str());
        return false;
    }
    JsonObjectConst root = doc.as<JsonObjectConst>();
    if (strcmp(root["format"] | "", "openturbine-pcb-profile") ||
        (root["format_version"]["major"] | 0) != formatMajor ||
        (root["format_version"]["minor"] | 0) != formatMinor) {
        strlcpy(_fault, "profile identity/version does not match its container", sizeof(_fault));
        return false;
    }
#if defined(OT_PLATFORM_ESP32S3)
    const char* expectedChip = "esp32-s3";
#else
    const char* expectedChip = "esp32";
#endif
    if (strcmp(root["target"]["chip"] | "", expectedChip)) {
        strlcpy(_fault, "profile JSON targets a different ESP32 chip", sizeof(_fault));
        return false;
    }

    Catalog* catalog = new (std::nothrow) Catalog();
    if (!catalog) {
        strlcpy(_fault, "not enough memory for PCB port catalog", sizeof(_fault));
        return false;
    }
    catalog->formatMajor = formatMajor;
    catalog->formatMinor = formatMinor;
    catalog->origin = origin;
    if (!copyText(catalog->boardId, sizeof(catalog->boardId), root["board"]["id"] | "", true, "board.id") ||
        !copyText(catalog->boardName, sizeof(catalog->boardName), root["board"]["name"] | "", true, "board.name") ||
        !copyText(catalog->revision, sizeof(catalog->revision), root["board"]["revision"] | "", true, "board.revision") ||
        !copyText(catalog->manufacturer, sizeof(catalog->manufacturer), root["board"]["manufacturer"] | "", false, "board.manufacturer") ||
        !copyText(catalog->description, sizeof(catalog->description), root["board"]["description"] | "", false, "board.description") ||
        !copyText(catalog->targetChip, sizeof(catalog->targetChip), expectedChip, true, "target.chip") ||
        !idValid(catalog->boardId, sizeof(catalog->boardId))) {
        delete catalog;
        return false;
    }

    JsonArrayConst buses = root["buses"].as<JsonArrayConst>();
    if (buses.size() > MAX_BUSES) {
        delete catalog; strlcpy(_fault, "too many PCB buses", sizeof(_fault)); return false;
    }
    if (buses.size()) {
        catalog->buses = new (std::nothrow) Bus[buses.size()];
        if (!catalog->buses) {
            delete catalog;
            strlcpy(_fault, "not enough memory for PCB buses", sizeof(_fault));
            return false;
        }
    }
    for (JsonObjectConst source : buses) {
        Bus& bus = catalog->buses[catalog->busCount++];
        if (!copyText(bus.id, sizeof(bus.id), source["id"] | "", true, "bus.id") ||
            !copyText(bus.kind, sizeof(bus.kind), source["kind"] | "", true, "bus.kind") ||
            !idValid(bus.id, sizeof(bus.id))) { delete catalog; return false; }
        JsonObjectConst pins = source["pins"].as<JsonObjectConst>();
        bus.sda = jsonPin(pins, "sda"); bus.scl = jsonPin(pins, "scl");
        bus.interrupt = jsonPin(pins, "interrupt");
        bus.sck = jsonPin(pins, "sck"); bus.miso = jsonPin(pins, "miso");
        bus.mosi = jsonPin(pins, "mosi"); bus.tx = jsonPin(pins, "tx");
        bus.rx = jsonPin(pins, "rx"); bus.data = jsonPin(pins, "data");
        bus.frequencyHz = source["frequency_hz"] | 0U;
        const bool validKind = !strcmp(bus.kind, "i2c") || !strcmp(bus.kind, "spi") ||
                               !strcmp(bus.kind, "uart") || !strcmp(bus.kind, "onewire");
        const bool requiredPins = (!strcmp(bus.kind, "i2c") && bus.sda >= 0 && bus.scl >= 0 && bus.sda != bus.scl) ||
                                  (!strcmp(bus.kind, "spi") && bus.sck >= 0 && bus.miso >= 0 && bus.sck != bus.miso) ||
                                  (!strcmp(bus.kind, "uart") && bus.tx >= 0 && bus.tx != bus.rx) ||
                                  (!strcmp(bus.kind, "onewire") && bus.data >= 0);
        if (!validKind || !requiredPins) {
            delete catalog; strlcpy(_fault, "PCB bus kind or required pins are invalid", sizeof(_fault)); return false;
        }
        const int inputPins[] = {bus.miso, bus.rx, bus.interrupt, bus.data};
        const int outputPins[] = {bus.sda, bus.scl, bus.sck, bus.mosi, bus.tx};
        for (int pin : inputPins) if (!validTargetPin(pin, false)) {
            delete catalog; strlcpy(_fault, "bus uses invalid input GPIO", sizeof(_fault)); return false;
        }
        for (int pin : outputPins) if (!validTargetPin(pin, true)) {
            delete catalog; strlcpy(_fault, "bus uses invalid output GPIO", sizeof(_fault)); return false;
        }
    }

    JsonArrayConst devices = root["devices"].as<JsonArrayConst>();
    if (devices.size() > MAX_DEVICES) {
        delete catalog; strlcpy(_fault, "too many PCB devices", sizeof(_fault)); return false;
    }
    if (devices.size()) {
        catalog->devices = new (std::nothrow) Device[devices.size()];
        if (!catalog->devices) {
            delete catalog;
            strlcpy(_fault, "not enough memory for PCB devices", sizeof(_fault));
            return false;
        }
    }
    for (JsonObjectConst source : devices) {
        Device& device = catalog->devices[catalog->deviceCount++];
        if (!copyText(device.id, sizeof(device.id), source["id"] | "", true, "device.id") ||
            !copyText(device.driver, sizeof(device.driver), source["driver"] | "", true, "device.driver") ||
            !copyText(device.busId, sizeof(device.busId), source["bus"] | "", false, "device.bus") ||
            !idValid(device.id, sizeof(device.id))) { delete catalog; return false; }
        device.address = source["address"] | 0;
        device.selectGpio = source["select"]["gpio"] | -1;
        device.expected = source["expected"] | false;
        if (device.busId[0]) {
            bool found = false;
            for (uint8_t i = 0; i < catalog->busCount; ++i)
                if (!strcmp(catalog->buses[i].id, device.busId)) { found = true; break; }
            if (!found) { delete catalog; strlcpy(_fault, "device refers to missing bus", sizeof(_fault)); return false; }
        }
        if (!validTargetPin(device.selectGpio, true)) {
            delete catalog; strlcpy(_fault, "device uses invalid select GPIO", sizeof(_fault)); return false;
        }
    }

    JsonObjectConst fixed = root["fixed_functions"].as<JsonObjectConst>();
    if (!fixed.isNull()) {
        auto readFixedOutput = [&](const char* key, bool& present, int8_t& gpio,
                                   bool& activeHigh, uint8_t* type) {
            JsonObjectConst source = fixed[key].as<JsonObjectConst>();
            if (source.isNull()) return true;
            if (source["gpio"].isNull() || source["safe_demand"].isNull() ||
                (source["safe_demand"] | -1.0f) != 0.0f) return false;
            const int pin = source["gpio"].as<int>();
            if (!validTargetPin(pin, true)) return false;
            present = true;
            gpio = static_cast<int8_t>(pin);
            activeHigh = source["active_high"] | true;
            if (type) {
                const char* kind = source["type"] | "gpio";
                if (!strcmp(kind, "gpio")) *type = 0;
                else if (!strcmp(kind, "neopixel")) *type = 1;
                else return false;
            }
            return true;
        };
        if (!readFixedOutput("status_led", catalog->hasStatusLed,
                             catalog->statusLedGpio, catalog->statusLedActiveHigh,
                             &catalog->statusLedType) ||
            !readFixedOutput("buzzer", catalog->hasBuzzer,
                             catalog->buzzerGpio, catalog->buzzerActiveHigh, nullptr)) {
            delete catalog; strlcpy(_fault, "fixed PCB output has invalid GPIO or safe state", sizeof(_fault)); return false;
        }
        JsonObjectConst servoEnable = fixed["servo_output_enable"].as<JsonObjectConst>();
        if (!servoEnable.isNull()) {
            if (servoEnable["gpio"].isNull() ||
                servoEnable["active_high"].isNull() ||
                (servoEnable["safe_demand"] | -1.0f) != 0.0f) {
                delete catalog; strlcpy(_fault, "servo-output enable has invalid safe state", sizeof(_fault)); return false;
            }
            const int pin = servoEnable["gpio"].as<int>();
            if (!validTargetPin(pin, true)) {
                delete catalog; strlcpy(_fault, "servo-output enable uses invalid GPIO", sizeof(_fault)); return false;
            }
            catalog->hasServoOutputEnable = true;
            catalog->servoOutputEnableGpio = static_cast<int8_t>(pin);
            catalog->servoOutputEnableActiveHigh = servoEnable["active_high"].as<bool>();
        }
        JsonObjectConst supply = fixed["supply_voltage"].as<JsonObjectConst>();
        if (!supply.isNull()) {
            const int pin = supply["gpio"] | -1;
            const float divider = supply["divider"] | 0.0f;
            if (!validTargetPin(pin, false) || divider < 1.0f || divider > 100.0f ||
                !copyText(catalog->supplyVoltageLabel,
                          sizeof(catalog->supplyVoltageLabel),
                          supply["label"] | "ECU supply voltage", false,
                          "supply_voltage.label")) {
                delete catalog; strlcpy(_fault, "fixed supply-voltage monitor is invalid", sizeof(_fault)); return false;
            }
            catalog->hasSupplyVoltage = true;
            catalog->supplyVoltageGpio = static_cast<int8_t>(pin);
            catalog->supplyVoltageDivider = divider;
        }
        auto readSerial = [&](const char* key, char* destination, size_t size) {
            JsonObjectConst source = fixed[key].as<JsonObjectConst>();
            if (source.isNull()) return true;
            const char* busId = source["bus"] | "";
            for (uint8_t i = 0; i < catalog->busCount; ++i)
                if (!strcmp(catalog->buses[i].id, busId) &&
                    !strcmp(catalog->buses[i].kind, "uart")) {
                    strlcpy(destination, busId, size);
                    return true;
                }
            return false;
        };
        if (!readSerial("cluster_serial", catalog->clusterSerialBusId,
                        sizeof(catalog->clusterSerialBusId)) ||
            !readSerial("mavlink", catalog->mavlinkBusId,
                        sizeof(catalog->mavlinkBusId))) {
            delete catalog; strlcpy(_fault, "fixed serial function refers to a missing UART bus", sizeof(_fault)); return false;
        }
    }

    JsonArrayConst ports = root["ports"].as<JsonArrayConst>();
    if (!ports.size() || ports.size() > MAX_PORTS) {
        delete catalog; strlcpy(_fault, "PCB profile needs 1..48 ports", sizeof(_fault)); return false;
    }
    catalog->ports = new (std::nothrow) Port[ports.size()];
    if (!catalog->ports) {
        delete catalog;
        strlcpy(_fault, "not enough memory for PCB ports", sizeof(_fault));
        return false;
    }
    for (JsonObjectConst source : ports) {
        Port& port = catalog->ports[catalog->portCount++];
        if (!copyText(port.id, sizeof(port.id), source["id"] | "", true, "port.id") ||
            !copyText(port.label, sizeof(port.label), source["label"] | "", true, "port.label") ||
            !copyText(port.connector, sizeof(port.connector), source["connector"] | "", false, "port.connector") ||
            !copyText(port.description, sizeof(port.description), source["description"] | "", false, "port.description") ||
            !idValid(port.id, sizeof(port.id))) { delete catalog; return false; }
        for (uint8_t i = 0; i + 1 < catalog->portCount; ++i)
            if (!strcmp(catalog->ports[i].id, port.id)) {
                delete catalog; strlcpy(_fault, "duplicate PCB port ID", sizeof(_fault)); return false;
            }
        JsonArrayConst modes = source["modes"].as<JsonArrayConst>();
        if (!modes.size() || modes.size() > MAX_MODES_PER_PORT) {
            delete catalog; strlcpy(_fault, "PCB port needs 1..4 modes", sizeof(_fault)); return false;
        }
        for (JsonObjectConst modeSource : modes) {
            Mode& mode = port.modes[port.modeCount++];
            if (!copyText(mode.id, sizeof(mode.id), modeSource["id"] | "", true, "mode.id") ||
                !copyText(mode.adapter, sizeof(mode.adapter), modeSource["adapter"] | "", true, "mode.adapter") ||
                !copyText(mode.deviceId, sizeof(mode.deviceId), modeSource["device"] | "", false, "mode.device") ||
                !idValid(mode.id, sizeof(mode.id))) { delete catalog; return false; }
            mode.channel = modeSource["channel"] | 0;
            mode.gpio = modeSource["endpoint"]["gpio"] | -1;
            mode.activeHigh = modeSource["active_high"] | true;
            const char* pull = modeSource["pull"] | "none";
            if (!strcmp(pull, "none")) mode.pull = 0;
            else if (!strcmp(pull, "up")) mode.pull = 1;
            else if (!strcmp(pull, "down")) mode.pull = 2;
            else {
                delete catalog; strlcpy(_fault, "PCB port mode has invalid pull setting", sizeof(_fault)); return false;
            }
            mode.hasSafeDemand = modeSource["safe_demand"].is<float>() || modeSource["safe_demand"].is<int>();
            mode.safeDemand = modeSource["safe_demand"] | 0.0f;
            mode.minimumHz = modeSource["limits"]["minimum_hz"] | 0.0f;
            mode.maximumHz = modeSource["limits"]["maximum_hz"] | 0.0f;
            mode.minimumMv = modeSource["limits"]["minimum_mv"] | 0.0f;
            mode.maximumMv = modeSource["limits"]["maximum_mv"] | 3300.0f;
            mode.referenceMv = modeSource["reference_mv"] | 3300.0f;
            if (mode.referenceMv < 1000.0f || mode.referenceMv > 5500.0f) {
                delete catalog; strlcpy(_fault, "PCB port mode has invalid ADC reference", sizeof(_fault)); return false;
            }
            if (!adapterKnown(mode.adapter)) {
                // Forward-compatible: retain the port so UI can report that a
                // newer firmware is required, but never resolve this mode.
                continue;
            }
            const bool output = strstr(mode.adapter, "output") != nullptr;
            if (!validTargetPin(mode.gpio, output) ||
                (output && (!mode.hasSafeDemand || mode.safeDemand < 0.0f || mode.safeDemand > 1.0f))) {
                delete catalog; strlcpy(_fault, "PCB port mode has invalid GPIO or safe state", sizeof(_fault)); return false;
            }
            if (mode.deviceId[0]) {
                bool found = false;
                for (uint8_t i = 0; i < catalog->deviceCount; ++i)
                    if (!strcmp(catalog->devices[i].id, mode.deviceId)) { found = true; break; }
                if (!found) { delete catalog; strlcpy(_fault, "port mode refers to missing device", sizeof(_fault)); return false; }
            }
        }
        // A multipurpose connector may offer multiple adapters over one GPIO,
        // but every output interpretation must agree on the physical boot
        // level. Otherwise firmware could not park that pin deterministically
        // before the user configuration is loaded.
        for (uint8_t a = 0; a < port.modeCount; ++a) {
            const Mode& first = port.modes[a];
            if (first.gpio < 0 || !strstr(first.adapter, "output") ||
                !strncmp(first.adapter, "i2c_", 4))
                continue;
            const bool firstProportional = !strcmp(first.adapter, "pwm_output") ||
                                           !strcmp(first.adapter, "servo_output");
            const bool firstLevel = firstProportional ? !first.activeHigh :
                (first.activeHigh ? first.safeDemand >= 0.5f : first.safeDemand < 0.5f);
            for (uint8_t b = a + 1; b < port.modeCount; ++b) {
                const Mode& second = port.modes[b];
                if (second.gpio != first.gpio || !strstr(second.adapter, "output") ||
                    !strncmp(second.adapter, "i2c_", 4))
                    continue;
                const bool secondProportional = !strcmp(second.adapter, "pwm_output") ||
                                                !strcmp(second.adapter, "servo_output");
                const bool secondLevel = secondProportional ? !second.activeHigh :
                    (second.activeHigh ? second.safeDemand >= 0.5f : second.safeDemand < 0.5f);
                if (firstLevel != secondLevel) {
                    delete catalog;
                    strlcpy(_fault, "multipurpose PCB output modes disagree on boot-safe level",
                            sizeof(_fault));
                    return false;
                }
            }
        }
    }
    // Reject impossible aliases before the catalog becomes authoritative.
    // Modes on one multipurpose port may share their endpoint, but separate
    // ports may not silently name the same GPIO or device channel.
    int16_t gpioOwner[49];
    for (auto& owner : gpioOwner) owner = -1;
    auto claimGpio = [&](int pin, int16_t owner, bool sameOwnerAllowed) {
        if (pin < 0) return true;
        if (pin >= static_cast<int>(sizeof(gpioOwner) / sizeof(gpioOwner[0])))
            return false;
        if (gpioOwner[pin] >= 0 &&
            !(sameOwnerAllowed && gpioOwner[pin] == owner)) return false;
        gpioOwner[pin] = owner;
        return true;
    };
    int16_t fixedOwner = 100;
    for (uint8_t i = 0; i < catalog->busCount; ++i) {
        const Bus& bus = catalog->buses[i];
        for (int pin : {bus.sda, bus.scl, bus.interrupt, bus.sck, bus.miso,
                        bus.mosi, bus.tx, bus.rx, bus.data})
            if (!claimGpio(pin, fixedOwner++, false)) {
                delete catalog; strlcpy(_fault, "PCB buses share an exclusive GPIO", sizeof(_fault)); return false;
            }
    }
    for (uint8_t i = 0; i < catalog->deviceCount; ++i)
        if (!claimGpio(catalog->devices[i].selectGpio, fixedOwner++, false)) {
            delete catalog; strlcpy(_fault, "PCB device select conflicts with another GPIO use", sizeof(_fault)); return false;
        }
    if ((catalog->hasStatusLed &&
         !claimGpio(catalog->statusLedGpio, fixedOwner++, false)) ||
        (catalog->hasBuzzer &&
         !claimGpio(catalog->buzzerGpio, fixedOwner++, false)) ||
        (catalog->hasServoOutputEnable &&
         !claimGpio(catalog->servoOutputEnableGpio, fixedOwner++, false)) ||
        (catalog->hasSupplyVoltage &&
         !claimGpio(catalog->supplyVoltageGpio, fixedOwner++, false))) {
        delete catalog; strlcpy(_fault, "fixed PCB output conflicts with another GPIO use", sizeof(_fault)); return false;
    }
    for (uint8_t i = 0; i < catalog->portCount; ++i) {
        const Port& port = catalog->ports[i];
        for (uint8_t j = 0; j < port.modeCount; ++j) {
            const Mode& mode = port.modes[j];
            if (!claimGpio(mode.gpio, i, true)) {
                delete catalog; strlcpy(_fault, "separate PCB ports share an exclusive GPIO", sizeof(_fault)); return false;
            }
            if (!mode.deviceId[0]) continue;
            for (uint8_t priorPort = 0; priorPort < i; ++priorPort) {
                const Port& prior = catalog->ports[priorPort];
                for (uint8_t priorMode = 0; priorMode < prior.modeCount; ++priorMode)
                    if (!strcmp(prior.modes[priorMode].deviceId, mode.deviceId) &&
                        prior.modes[priorMode].channel == mode.channel) {
                        delete catalog; strlcpy(_fault, "separate PCB ports share a device channel", sizeof(_fault)); return false;
                    }
            }
        }
    }
    _catalog = catalog;
    return true;
}

const PcbProfileManager::Port* PcbProfileManager::findPort(const char* id) {
    if (!_catalog || !id) return nullptr;
    for (uint8_t i = 0; i < _catalog->portCount; ++i)
        if (!strcmp(_catalog->ports[i].id, id)) return &_catalog->ports[i];
    return nullptr;
}

const PcbProfileManager::Mode* PcbProfileManager::findMode(const Port& port, const char* id) {
    if (!id) return nullptr;
    for (uint8_t i = 0; i < port.modeCount; ++i)
        if (!strcmp(port.modes[i].id, id)) return &port.modes[i];
    return nullptr;
}

const PcbProfileManager::Device* PcbProfileManager::findDevice(const char* id) {
    if (!_catalog || !id) return nullptr;
    for (uint8_t i = 0; i < _catalog->deviceCount; ++i)
        if (!strcmp(_catalog->devices[i].id, id)) return &_catalog->devices[i];
    return nullptr;
}

const PcbProfileManager::Bus* PcbProfileManager::findBus(const char* id) {
    if (!_catalog || !id) return nullptr;
    for (uint8_t i = 0; i < _catalog->busCount; ++i)
        if (!strcmp(_catalog->buses[i].id, id)) return &_catalog->buses[i];
    return nullptr;
}

const PcbProfileManager::Bus* PcbProfileManager::findBusKind(const char* kind) {
    if (!_catalog || !kind) return nullptr;
    for (uint8_t i = 0; i < _catalog->busCount; ++i)
        if (!strcmp(_catalog->buses[i].kind, kind)) return &_catalog->buses[i];
    return nullptr;
}

bool PcbProfileManager::ownsBusKind(const char* kind) {
    return findBusKind(kind) != nullptr;
}

bool PcbProfileManager::gpioReserved(int gpio) {
    if (!_catalog || gpio < 0) return false;
    for (uint8_t i = 0; i < _catalog->busCount; ++i) {
        const Bus& bus = _catalog->buses[i];
        for (int pin : {bus.sda, bus.scl, bus.interrupt, bus.sck, bus.miso,
                        bus.mosi, bus.tx, bus.rx, bus.data})
            if (pin == gpio) return true;
    }
    for (uint8_t i = 0; i < _catalog->deviceCount; ++i)
        if (_catalog->devices[i].selectGpio == gpio) return true;
    if ((_catalog->hasStatusLed && _catalog->statusLedGpio == gpio) ||
        (_catalog->hasBuzzer && _catalog->buzzerGpio == gpio) ||
        (_catalog->hasServoOutputEnable && _catalog->servoOutputEnableGpio == gpio) ||
        (_catalog->hasSupplyVoltage && _catalog->supplyVoltageGpio == gpio))
        return true;
    for (uint8_t i = 0; i < _catalog->portCount; ++i)
        for (uint8_t j = 0; j < _catalog->ports[i].modeCount; ++j)
            if (_catalog->ports[i].modes[j].gpio == gpio) return true;
    return false;
}

void PcbProfileManager::setServoOutputsEnabled(bool enabled) {
    if (!_catalog || !_catalog->hasServoOutputEnable) return;
    const bool level = enabled == _catalog->servoOutputEnableActiveHigh;
    digitalWrite(_catalog->servoOutputEnableGpio, level ? HIGH : LOW);
    pinMode(_catalog->servoOutputEnableGpio, OUTPUT);
}

void PcbProfileManager::toJson(JsonObject out, bool includePorts,
                               uint8_t portOffset, uint8_t portLimit) {
    out["state"] = _state == State::Absent ? "absent" :
                   _state == State::Valid ? "valid" : "fault";
    if (_state == State::Fault) out["error"] = _fault;
    if (!_catalog) return;
    out["id"] = _catalog->boardId;
    out["name"] = _catalog->boardName;
    out["revision"] = _catalog->revision;
    out["manufacturer"] = _catalog->manufacturer;
    out["description"] = _catalog->description;
    out["target_chip"] = _catalog->targetChip;
    out["format_major"] = _catalog->formatMajor;
    out["format_minor"] = _catalog->formatMinor;
    out["origin"] = _catalog->origin == Origin::Official ? "official" :
                    _catalog->origin == Origin::Custom ? "custom" : "unknown";
    out["port_count"] = _catalog->portCount;
    JsonObject busOwnership = out["bus_ownership"].to<JsonObject>();
    busOwnership["i2c"] = ownsBusKind("i2c");
    busOwnership["spi"] = ownsBusKind("spi");
    JsonArray reserved = out["reserved_gpio"].to<JsonArray>();
    for (int gpio = 0; gpio <= 48; ++gpio)
        if (gpioReserved(gpio)) reserved.add(gpio);
    JsonObject fixed = out["fixed_functions"].to<JsonObject>();
    if (_catalog->hasStatusLed) {
        JsonObject item = fixed["status_led"].to<JsonObject>();
        item["available"] = true;
        item["type"] = _catalog->statusLedType ? "neopixel" : "gpio";
    }
    if (_catalog->hasBuzzer)
        fixed["buzzer"]["available"] = true;
    if (_catalog->hasServoOutputEnable)
        fixed["servo_output_enable"]["available"] = true;
    if (_catalog->hasSupplyVoltage) {
        JsonObject item = fixed["supply_voltage"].to<JsonObject>();
        item["available"] = true;
        item["label"] = _catalog->supplyVoltageLabel;
    }
    if (_catalog->clusterSerialBusId[0]) {
        fixed["cluster_serial"]["available"] = true;
        fixed["cluster_serial"]["connection"] = _catalog->clusterSerialBusId;
    }
    if (_catalog->mavlinkBusId[0]) {
        fixed["mavlink"]["available"] = true;
        fixed["mavlink"]["connection"] = _catalog->mavlinkBusId;
    }
    if (!includePorts) return;
    JsonArray ports = out["ports"].to<JsonArray>();
    uint8_t end = portOffset + portLimit;
    if (end < portOffset || end > _catalog->portCount) end = _catalog->portCount;
    out["port_offset"] = portOffset;
    for (uint8_t i = portOffset; i < end; ++i) {
        const Port& port = _catalog->ports[i];
        JsonObject item = ports.add<JsonObject>();
        item["id"] = port.id; item["label"] = port.label;
        item["connector"] = port.connector; item["description"] = port.description;
        JsonArray modes = item["modes"].to<JsonArray>();
        for (uint8_t j = 0; j < port.modeCount; ++j) {
            const Mode& mode = port.modes[j];
            JsonObject m = modes.add<JsonObject>();
            m["id"] = mode.id; m["adapter"] = mode.adapter;
            if (mode.deviceId[0]) {
                m["device"] = mode.deviceId;
                const Device* device = findDevice(mode.deviceId);
                if (device) m["device_driver"] = device->driver;
            }
            if ((!strcmp(mode.adapter, "i2c_adc_input") ||
                 !strcmp(mode.adapter, "i2c_adc_digital_input")) &&
                mode.referenceMv > 0.0f)
                m["reference_mv"] = mode.referenceMv;
        }
    }
}
