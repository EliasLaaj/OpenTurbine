#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

// Immutable flash-time PCB identity and named physical-port catalog. The
// dedicated partition is written only by the USB setup tool.
class PcbProfileManager {
public:
    static constexpr uint8_t MAX_BUSES = 8;
    static constexpr uint8_t MAX_DEVICES = 24;
    static constexpr uint8_t MAX_PORTS = 48;
    static constexpr uint8_t MAX_MODES_PER_PORT = 4;
    static constexpr uint32_t MAX_PAYLOAD = 24U * 1024U;

    enum class State : uint8_t { Absent, Valid, Fault };
    enum class Origin : uint8_t { Unknown, Custom, Official };

    struct Bus {
        char id[24] = {};
        char kind[10] = {};
        int8_t sda = -1, scl = -1, interrupt = -1;
        int8_t sck = -1, miso = -1, mosi = -1;
        int8_t tx = -1, rx = -1, data = -1;
        uint32_t frequencyHz = 0;
    };

    struct Device {
        char id[24] = {};
        char driver[24] = {};
        char busId[24] = {};
        uint8_t address = 0;
        int8_t selectGpio = -1;
        bool expected = false;
    };

    struct Mode {
        char id[24] = {};
        char adapter[24] = {};
        char deviceId[24] = {};
        uint8_t channel = 0;
        int8_t gpio = -1;
        bool activeHigh = true;
        uint8_t pull = 0; // 0=none/external, 1=internal pull-up, 2=internal pull-down
        float safeDemand = 0.0f;
        bool hasSafeDemand = false;
        float minimumHz = 0.0f;
        float maximumHz = 0.0f;
        float minimumMv = 0.0f;
        float maximumMv = 3300.0f;
        float referenceMv = 3300.0f;
    };

    struct Port {
        char id[24] = {};
        char label[32] = {};
        char connector[24] = {};
        char description[80] = {};
        Mode modes[MAX_MODES_PER_PORT] = {};
        uint8_t modeCount = 0;
    };

    struct Catalog {
        char boardId[40] = {};
        char boardName[48] = {};
        char revision[16] = {};
        char manufacturer[32] = {};
        char description[96] = {};
        char targetChip[12] = {};
        uint8_t formatMajor = 0, formatMinor = 0;
        Origin origin = Origin::Unknown;
        // Allocate only the fitted catalog. A maximum-size Port contains four
        // modes and substantial user-facing text; reserving all 48 ports for
        // every profile consumed nearly all remaining classic ESP32 heap even
        // for a small seven-port board, starving DHCP and web responses.
        Bus* buses = nullptr;
        Device* devices = nullptr;
        Port* ports = nullptr;
        uint8_t busCount = 0, deviceCount = 0, portCount = 0;
        bool hasStatusLed = false, hasBuzzer = false;
        int8_t statusLedGpio = -1, buzzerGpio = -1;
        uint8_t statusLedType = 0;
        bool statusLedActiveHigh = true, buzzerActiveHigh = true;
        bool hasServoOutputEnable = false;
        int8_t servoOutputEnableGpio = -1;
        bool servoOutputEnableActiveHigh = true;
        bool hasSupplyVoltage = false;
        int8_t supplyVoltageGpio = -1;
        float supplyVoltageDivider = 1.0f;
        char supplyVoltageLabel[32] = {};
        char clusterSerialBusId[24] = {};
        char mavlinkBusId[24] = {};

        ~Catalog() {
            delete[] buses;
            delete[] devices;
            delete[] ports;
        }
    };

    static void begin();
    // Park every profile-owned native output before filesystem/config loading.
    // I2C outputs are handled later when their device driver is initialized.
    static void driveEarlySafeStates();
    static State state() { return _state; }
    static bool active() { return _state == State::Valid; }
    static bool faulted() { return _state == State::Fault; }
    static const char* faultReason() { return _fault; }
    static const Catalog* catalog() { return _catalog; }
    static const Port* findPort(const char* id);
    static const Mode* findMode(const Port& port, const char* id);
    static const Device* findDevice(const char* id);
    static const Bus* findBus(const char* id);
    static const Bus* findBusKind(const char* kind);
    static bool ownsBusKind(const char* kind);
    static bool gpioReserved(int gpio);
    // The shared buffer is kept disabled until every configured servo waveform
    // has been attached and initialized.
    static void setServoOutputsEnabled(bool enabled);
    static void toJson(JsonObject out, bool includePorts = true,
                       uint8_t portOffset = 0, uint8_t portLimit = MAX_PORTS);

private:
    static State _state;
    static Catalog* _catalog;
    static char _fault[128];

    static void setFault(const char* reason);
    static bool parsePayload(const uint8_t* payload, size_t length,
                             uint8_t formatMajor, uint8_t formatMinor,
                             Origin origin);
    static bool validTargetPin(int pin, bool output);
    static bool copyText(char* dst, size_t size, const char* value,
                         bool required, const char* field);
    static uint32_t crc32(const uint8_t* data, size_t length);
};
