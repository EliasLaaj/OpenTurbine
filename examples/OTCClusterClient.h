#pragma once

/*
  OTCClusterClient.h - simple receiver for OpenTurbine Cluster Protocol v1.

  Drop this single file into an Arduino / ESP32 cluster project and include it:

      #include "OTCClusterClient.h"

      HardwareSerial EcuSerial(2);
      OTCClusterClient otc;

      void setup() {
        Serial.begin(115200);
        // ECU setup checklist:
        //   1. Hardware page: enable Cluster Serial, choose TX/RX/baud.
        //   2. Config page: keep Cluster > Enable on for live telemetry.
        //   3. Match this begin() baud/rx/tx to the ECU settings.
        // TX-only display:
        //   ECU cluster TX  -> cluster RX pin 16
        //   GND             -> GND
        //
        // Two-way display:
        //   ECU cluster TX  -> cluster RX pin 16
        //   cluster TX pin 17 -> ECU cluster RX
        //   GND             -> GND
        EcuSerial.begin(115200, SERIAL_8N1, 16, 17);
        otc.begin(EcuSerial);
        // Safe to call in two-way mode. In TX-only mode the ECU repeats schema
        // periodically, so the cluster can still sync without sending anything.
        otc.requestSchema();
      }

      void loop() {
        otc.update();

        if (otc.dataReceived) {
          // Values are in OpenTurbine canonical units.
          // Convert on the display side if you want F, PSI, etc.
          float n1 = otc.n1Rpm;
          float egt = otc.totC;
          float oil = otc.oilBar;
          const char* status = otc.statusText;
        }

        // Optional commands/subscriptions if cluster TX is wired to ECU RX:
        // if (otc.commandsAvailable()) otc.stop();
        // if (otc.subscriptionsAvailable()) otc.subscribeAll();
        // if (otc.subscriptionsAvailable()) otc.subscribe("N1_RPM,TOT_C,OIL_BAR,MODE");
      }

  Link:
    - UART 8N1
    - ECU TX is required
    - ECU RX is optional; commands are newline ASCII, ACK comes back as binary
    - Baud is configured on the OpenTurbine Hardware page
    - Fitting Cluster Data on the Hardware page enables runtime streaming

  Frame parser:
    - Looks for binary frames beginning with "OT"
    - Verifies CRC16-CCITT-FALSE
    - Applies schema FIELD_DEF order to TELEMETRY values
    - Unknown fields are ignored, so future ECU firmware can add fields safely
    - SUB,ALL asks for all fitted ECU data only
    - Named subscriptions can request unavailable fields; those arrive as NaN

  Typical display logic:
    - Wait for schemaReceived before building dynamic gauges.
    - Use hasN1 / hasN2 / hasTot / hasOil etc. to decide what to draw.
    - Use signalLost() to show NO DATA if telemetry stops.
    - Use commandsAvailable() and subscriptionsAvailable() before showing
      buttons or advanced subscription UI.
    - Status text and mode are always available in the telemetry/status frames.
*/

#include <Arduino.h>

class OTCClusterClient {
public:
  enum FieldId : uint8_t {
    F_N1_RPM = 1,
    F_N2_RPM,
    F_TOT_C,
    F_TIT_C,
    F_OIL_BAR,
    F_OIL_TEMP_C,
    F_FUEL_PRESS_BAR,
    F_FUEL_FLOW,
    F_P1_BAR,
    F_P2_BAR,
    F_BATT_V,
    F_TORQUE_NM,
    F_POWER_W,
    F_THROTTLE_PCT,
    F_STARTER_PCT,
    F_OIL_PUMP_PCT,
    F_FUEL_PUMP2_PCT,
    F_AB_PUMP_PCT,
    F_PROP_PITCH_PCT,
    F_GLOW_PCT,
    F_MODE,
    F_AB_MODE,
    F_TOT_RATE,
    F_OIL_TARGET_BAR,
    F_FUEL_SOL,
    F_IGNITER1,
    F_IGNITER2,
    F_STARTER_ENABLE,
    F_COOL_FAN,
    F_AIRSTARTER,
    F_OIL_SCAVENGE,
    F_BLEED_VALVE,
    F_AB_SOL,
    F_AB_TRIGGER,
    F_AB_ARM,
    F_AB_FLAME,
    F_STOP_SWITCH,
    F_START_SWITCH,
    F_DYNAMIC_IDLE,
    F_LIMP_MODE,
    F_BENCH_MODE,
    F_DEV_MODE,
    F_RELIGHT,
    F_STANDBY_OIL,
    F_OIL_FAILSAFE,
    F_OIL_OVERCURRENT,
    F_GLOW_CURRENT_A,
    F_IGNITER1_CURRENT_A,
    F_IGNITER2_CURRENT_A,
    F_OIL_PUMP_CURRENT_A,
    F_THROTTLE_INPUT_RAW,
    F_IDLE_INPUT_RAW,
    F_AB_INPUT_RAW,
    F_AB_INPUT_NORM,
    F_MAX_N1_RPM,
    F_MAX_N2_RPM,
    F_MAX_TOT_C,
    F_MAX_TIT_C,
    F_MAX_OIL_TEMP_C,
    F_MAX_FUEL_PRESS_BAR,
    F_MAX_BATT_V,
    F_RUN_COUNT,
    F_BOOT_COUNT,
    F_UPTIME_MS,
    F_DI1,
    F_DI2,
    F_DI3,
    F_DI4,
    F_THRUST_N,
  };

  enum SysMode : uint8_t {
    MODE_STANDBY = 0,
    MODE_STARTUP = 1,
    MODE_RUNNING = 2,
    MODE_SHUTDOWN = 3,
    MODE_FAULT = 4,
  };

  enum Severity : uint8_t {
    SEV_INFO = 0,
    SEV_WARN = 1,
    SEV_CRIT = 2,
  };

  // Connection/schema state
  bool dataReceived = false;
  bool schemaReceived = false;
  bool ackReceived = false;
  bool lastAckOk = false;
  unsigned long lastFrameMs = 0;
  unsigned long lastDataMs = 0;

  uint8_t protocolMajor = 0;
  uint8_t protocolMinor = 0;
  uint16_t capabilities = 0;
  uint16_t intervalMs = 0;
  uint32_t ecuBaud = 0;
  char profile[48] = {};

  // Live ECU state
  uint8_t mode = MODE_STANDBY;
  uint32_t healthFlags = 0;
  uint8_t statusCode = 0;
  uint8_t statusSeverity = SEV_INFO;
  char statusText[40] = {};
  char lastEventText[72] = {};
  uint8_t lastEventSeverity = SEV_INFO;
  uint8_t seqBlockIndex = 0;
  uint8_t seqBlockTotal = 0;

  // Limits from ECU config
  float n1MaxRpm = 0;
  float n1WarnRpm = 0;
  float n2WarnRpm = 0;
  float totMaxC = 0;
  float totWarnC = 0;
  float oilWarnBar = 0;
  float oilZeroBar = 0;

  // Live values in canonical ECU units
  float n1Rpm = 0;
  float n2Rpm = 0;
  float totC = 0;
  float titC = 0;
  float oilBar = 0;
  float oilTempC = 0;
  float fuelPressBar = 0;
  float fuelFlow = 0;
  float p1Bar = 0;
  float p2Bar = 0;
  float battV = 0;
  float torqueNm = 0;
  float thrustN = 0;
  float powerW = 0;
  float throttlePct = 0;
  float starterPct = 0;
  float oilPumpPct = 0;
  float fuelPump2Pct = 0;
  float abPumpPct = 0;
  float propPitchPct = 0;
  float glowPct = 0;
  float abMode = 0;
  float totRateCPerS = 0;
  float oilTargetBar = 0;
  float fuelSolOpen = 0;
  float igniter1On = 0;
  float igniter2On = 0;
  float starterEnable = 0;
  float coolFanOn = 0;
  float airstarterOpen = 0;
  float oilScavengeOn = 0;
  float bleedValveOpen = 0;
  float abSolOpen = 0;
  float abTriggerActive = 0;
  float abArmOn = 0;
  float abFlameOn = 0;
  float stopSwitchActive = 0;
  float startSwitchActive = 0;
  float dynamicIdleEnabled = 0;
  float limpMode = 0;
  float benchMode = 0;
  float devMode = 0;
  float relightActive = 0;
  float standbyOilActive = 0;
  float oilFailsafeActive = 0;
  float oilOvercurrent = 0;
  float glowCurrentA = 0;
  float igniter1CurrentA = 0;
  float igniter2CurrentA = 0;
  float oilPumpCurrentA = 0;
  float throttleInputRaw = 0;
  float idleInputRaw = 0;
  float abInputRaw = 0;
  float abInputPct = 0;
  float maxN1Rpm = 0;
  float maxN2Rpm = 0;
  float maxTotC = 0;
  float maxTitC = 0;
  float maxOilTempC = 0;
  float maxFuelPressBar = 0;
  float maxBattV = 0;
  float runCount = 0;
  float bootCount = 0;
  float uptimeMs = 0;
  float di1 = 0;
  float di2 = 0;
  float di3 = 0;
  float di4 = 0;

  // Presence flags learned from FIELD_DEF
  bool hasN1 = false;
  bool hasN2 = false;
  bool hasTot = false;
  bool hasTit = false;
  bool hasOil = false;
  bool hasOilTemp = false;
  bool hasFuelPress = false;
  bool hasFuelFlow = false;
  bool hasP1 = false;
  bool hasP2 = false;
  bool hasBatt = false;
  bool hasTorque = false;
  bool hasThrust = false;
  bool hasPower = false;
  bool hasThrottle = false;
  bool hasStarter = false;
  bool hasOilPump = false;
  bool hasFuelPump2 = false;
  bool hasAbPump = false;
  bool hasPropPitch = false;
  bool hasGlow = false;

  char lastAckText[40] = {};

  void begin(Stream& serial) {
    _serial = &serial;
    resetSchema();
  }

  void update() {
    if (!_serial) return;
    while (_serial->available()) parseByte((uint8_t)_serial->read());
  }

  bool signalLost(unsigned long timeoutMs = 1500) const {
    return !dataReceived || (millis() - lastDataMs) > timeoutMs;
  }

  bool health(uint8_t bit) const {
    return bit < 32 && (healthFlags & (1UL << bit));
  }

  bool commandsAvailable() const {
    return (capabilities & (1u << 2)) != 0;
  }

  bool subscriptionsAvailable() const {
    return (capabilities & (1u << 3)) != 0;
  }

  const char* modeText() const {
    switch (mode) {
      case MODE_STANDBY: return "STANDBY";
      case MODE_STARTUP: return "STARTUP";
      case MODE_RUNNING: return "RUNNING";
      case MODE_SHUTDOWN: return "SHUTDOWN";
      case MODE_FAULT: return "FAULT";
      default: return "UNKNOWN";
    }
  }

  // Optional cluster-to-ECU commands. They require cluster TX wired to ECU RX.
  void ping() { sendLine("OTC:PING"); }
  void requestSchema() { sendLine("OTC:SCHEMA?"); }
  void subscribeDefault() { sendLine("OTC:SUB,DEFAULT"); }
  void subscribeAll() { sendLine("OTC:SUB,ALL"); }
  // Returns false if the key list exceeds the ECU RX line limit
  // ("OTC:SUB," + up to 159 chars of field keys) — the ECU would
  // discard the line and NAK it with LINE_TOO_LONG.
  bool subscribe(const char* commaSeparatedFieldKeys) {
    if (!_serial || !commaSeparatedFieldKeys) return false;
    if (strlen(commaSeparatedFieldKeys) > 159) return false;
    _serial->print("OTC:SUB,");
    _serial->print(commaSeparatedFieldKeys);
    _serial->print('\n');
    return true;
  }
  void stop() { sendLine("OTC:CMD,STOP"); }
  void start() { sendLine("OTC:CMD,START"); }
  void abStop() { sendLine("OTC:CMD,AB_STOP"); }
  void resetPeaks() { sendLine("OTC:CMD,RESET_PEAKS"); }
  void toggleLimpMode() { sendLine("OTC:CMD,LIMP_TOGGLE"); }
  void toggleDynamicIdle() { sendLine("OTC:CMD,DYNAMIC_IDLE_TOGGLE"); }

private:
  static constexpr uint8_t MAX_PAYLOAD = 220;
  static constexpr uint8_t MAX_FIELDS = 96;

  enum FrameType : uint8_t {
    FT_HELLO = 1,
    FT_FIELD_DEF = 2,
    FT_LIMITS = 3,
    FT_TELEMETRY = 4,
    FT_STATUS = 5,
    FT_EVENT = 6,
    FT_ACK = 7,
    FT_SCHEMA_END = 8,
    FT_STATUS_DEF = 9,
  };

  Stream* _serial = nullptr;
  uint8_t _state = 0;
  uint8_t _header[7] = {};
  uint8_t _payload[MAX_PAYLOAD] = {};
  uint16_t _len = 0;
  uint16_t _pos = 0;
  uint8_t _seq = 0;
  uint8_t _fieldMap[MAX_FIELDS] = {};

  void resetSchema() {
    schemaReceived = false;
    for (uint8_t i = 0; i < MAX_FIELDS; i++) _fieldMap[i] = 0;
    hasN1 = hasN2 = hasTot = hasTit = hasOil = hasOilTemp = false;
    hasFuelPress = hasFuelFlow = hasP1 = hasP2 = hasBatt = false;
    hasTorque = hasPower = hasThrottle = hasStarter = hasOilPump = false;
    hasFuelPump2 = hasAbPump = hasPropPitch = hasGlow = false;
  }

  void sendLine(const char* line) {
    if (!_serial || !line) return;
    _serial->print(line);
    _serial->print('\n');
  }

  void parseByte(uint8_t b) {
    switch (_state) {
      case 0:
        if (b == 'O') { _header[0] = b; _state = 1; }
        break;
      case 1:
        if (b == 'T') { _header[1] = b; _state = 2; _pos = 2; }
        else _state = (b == 'O') ? 1 : 0;
        break;
      case 2:
        _header[_pos++] = b;
        if (_pos == sizeof(_header)) {
          _len = (uint16_t)_header[5] | ((uint16_t)_header[6] << 8);
          if (_len > MAX_PAYLOAD) { _state = 0; break; }
          _pos = 0;
          _state = _len ? 3 : 4;
        }
        break;
      case 3:
        _payload[_pos++] = b;
        if (_pos >= _len) { _pos = 0; _state = 4; }
        break;
      case 4:
        _crcLo = b;
        _state = 5;
        break;
      case 5: {
        uint16_t got = (uint16_t)_crcLo | ((uint16_t)b << 8);
        if (got == frameCrc()) handleFrame(_header[3], _header[4], _payload, _len);
        _state = 0;
        break;
      }
      default:
        _state = 0;
        break;
    }
  }

  uint8_t _crcLo = 0;

  uint16_t frameCrc() const {
    uint16_t crc = 0xFFFF;
    crc = crcUpdate(crc, _header + 2, 5);
    crc = crcUpdate(crc, _payload, _len);
    return crc;
  }

  static uint16_t crcUpdate(uint16_t crc, const uint8_t* data, uint16_t len) {
    while (len--) {
      crc ^= (uint16_t)(*data++) << 8;
      for (uint8_t i = 0; i < 8; i++) {
        crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
      }
    }
    return crc;
  }

  static uint16_t u16(const uint8_t* p) {
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
  }

  static uint32_t u32(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
  }

  static float f32(const uint8_t* p) {
    float v;
    memcpy(&v, p, sizeof(v));
    return v;
  }

  static void copyText(char* dst, size_t dstLen, const uint8_t* src, uint16_t srcLen) {
    if (!dst || !dstLen) return;
    size_t n = srcLen;
    if (n > dstLen - 1) n = dstLen - 1;
    memcpy(dst, src, n);
    dst[n] = '\0';
  }

  void handleFrame(uint8_t type, uint8_t seq, const uint8_t* p, uint16_t len) {
    _seq = seq;
    lastFrameMs = millis();
    switch (type) {
      case FT_HELLO:
        if (len >= 10) {
          protocolMajor = p[0];
          protocolMinor = p[1];
          capabilities = u16(p + 2);
          intervalMs = u16(p + 4);
          ecuBaud = u32(p + 6);
          copyText(profile, sizeof(profile), p + 10, len - 10);
          resetSchema();
        }
        break;
      case FT_FIELD_DEF:
        if (len >= 5 && p[0] < MAX_FIELDS) {
          _fieldMap[p[0]] = p[1];
          markPresent(p[1]);
        }
        break;
      case FT_LIMITS:
        if (len >= 28) {
          n1MaxRpm = f32(p + 0);
          n1WarnRpm = f32(p + 4);
          n2WarnRpm = f32(p + 8);
          totMaxC = f32(p + 12);
          totWarnC = f32(p + 16);
          oilWarnBar = f32(p + 20);
          oilZeroBar = f32(p + 24);
        }
        break;
      case FT_TELEMETRY:
        handleTelemetry(p, len);
        break;
      case FT_STATUS:
        if (len >= 2) {
          statusCode = p[0];
          statusSeverity = p[1];
          copyText(statusText, sizeof(statusText), p + 2, len - 2);
        }
        break;
      case FT_EVENT:
        if (len >= 1) {
          lastEventSeverity = p[0];
          copyText(lastEventText, sizeof(lastEventText), p + 1, len - 1);
        }
        break;
      case FT_ACK:
        if (len >= 1) {
          ackReceived = true;
          lastAckOk = p[0] != 0;
          copyText(lastAckText, sizeof(lastAckText), p + 1, len - 1);
        }
        break;
      case FT_SCHEMA_END:
        schemaReceived = true;
        break;
      case FT_STATUS_DEF:
        // This simple client uses STATUS frames directly. A richer display can
        // store STATUS_DEF if it wants localized or persistent status tables.
        break;
      default:
        break;
    }
  }

  void handleTelemetry(const uint8_t* p, uint16_t len) {
    if (len < 14) return;
    mode = p[4];
    healthFlags = u32(p + 5);
    statusCode = p[9];
    seqBlockIndex = p[10];
    seqBlockTotal = p[11];
    uint8_t count = p[12];
    uint8_t startIndex = p[13];
    uint16_t pos = 14;
    for (uint8_t i = 0; i < count && i < MAX_FIELDS && pos + 4 <= len; i++) {
      uint8_t fieldIndex = startIndex + i;
      if (fieldIndex < MAX_FIELDS) applyValue(_fieldMap[fieldIndex], f32(p + pos));
      pos += 4;
    }
    dataReceived = true;
    lastDataMs = millis();
  }

  void markPresent(uint8_t id) {
    switch (id) {
      case F_N1_RPM: hasN1 = true; break;
      case F_N2_RPM: hasN2 = true; break;
      case F_TOT_C: hasTot = true; break;
      case F_TIT_C: hasTit = true; break;
      case F_OIL_BAR: hasOil = true; break;
      case F_OIL_TEMP_C: hasOilTemp = true; break;
      case F_FUEL_PRESS_BAR: hasFuelPress = true; break;
      case F_FUEL_FLOW: hasFuelFlow = true; break;
      case F_P1_BAR: hasP1 = true; break;
      case F_P2_BAR: hasP2 = true; break;
      case F_BATT_V: hasBatt = true; break;
      case F_TORQUE_NM: hasTorque = true; break;
      case F_THRUST_N: hasThrust = true; break;
      case F_POWER_W: hasPower = true; break;
      case F_THROTTLE_PCT: hasThrottle = true; break;
      case F_STARTER_PCT: hasStarter = true; break;
      case F_OIL_PUMP_PCT: hasOilPump = true; break;
      case F_FUEL_PUMP2_PCT: hasFuelPump2 = true; break;
      case F_AB_PUMP_PCT: hasAbPump = true; break;
      case F_PROP_PITCH_PCT: hasPropPitch = true; break;
      case F_GLOW_PCT: hasGlow = true; break;
      default: break;
    }
  }

  void applyValue(uint8_t id, float v) {
    switch (id) {
      case F_N1_RPM: n1Rpm = v; break;
      case F_N2_RPM: n2Rpm = v; break;
      case F_TOT_C: totC = v; break;
      case F_TIT_C: titC = v; break;
      case F_OIL_BAR: oilBar = v; break;
      case F_OIL_TEMP_C: oilTempC = v; break;
      case F_FUEL_PRESS_BAR: fuelPressBar = v; break;
      case F_FUEL_FLOW: fuelFlow = v; break;
      case F_P1_BAR: p1Bar = v; break;
      case F_P2_BAR: p2Bar = v; break;
      case F_BATT_V: battV = v; break;
      case F_TORQUE_NM: torqueNm = v; break;
      case F_THRUST_N: thrustN = v; break;
      case F_POWER_W: powerW = v; break;
      case F_THROTTLE_PCT: throttlePct = v; break;
      case F_STARTER_PCT: starterPct = v; break;
      case F_OIL_PUMP_PCT: oilPumpPct = v; break;
      case F_FUEL_PUMP2_PCT: fuelPump2Pct = v; break;
      case F_AB_PUMP_PCT: abPumpPct = v; break;
      case F_PROP_PITCH_PCT: propPitchPct = v; break;
      case F_GLOW_PCT: glowPct = v; break;
      case F_MODE: mode = (uint8_t)v; break;
      case F_AB_MODE: abMode = v; break;
      case F_TOT_RATE: totRateCPerS = v; break;
      case F_OIL_TARGET_BAR: oilTargetBar = v; break;
      case F_FUEL_SOL: fuelSolOpen = v; break;
      case F_IGNITER1: igniter1On = v; break;
      case F_IGNITER2: igniter2On = v; break;
      case F_STARTER_ENABLE: starterEnable = v; break;
      case F_COOL_FAN: coolFanOn = v; break;
      case F_AIRSTARTER: airstarterOpen = v; break;
      case F_OIL_SCAVENGE: oilScavengeOn = v; break;
      case F_BLEED_VALVE: bleedValveOpen = v; break;
      case F_AB_SOL: abSolOpen = v; break;
      case F_AB_TRIGGER: abTriggerActive = v; break;
      case F_AB_ARM: abArmOn = v; break;
      case F_AB_FLAME: abFlameOn = v; break;
      case F_STOP_SWITCH: stopSwitchActive = v; break;
      case F_START_SWITCH: startSwitchActive = v; break;
      case F_DYNAMIC_IDLE: dynamicIdleEnabled = v; break;
      case F_LIMP_MODE: limpMode = v; break;
      case F_BENCH_MODE: benchMode = v; break;
      case F_DEV_MODE: devMode = v; break;
      case F_RELIGHT: relightActive = v; break;
      case F_STANDBY_OIL: standbyOilActive = v; break;
      case F_OIL_FAILSAFE: oilFailsafeActive = v; break;
      case F_OIL_OVERCURRENT: oilOvercurrent = v; break;
      case F_GLOW_CURRENT_A: glowCurrentA = v; break;
      case F_IGNITER1_CURRENT_A: igniter1CurrentA = v; break;
      case F_IGNITER2_CURRENT_A: igniter2CurrentA = v; break;
      case F_OIL_PUMP_CURRENT_A: oilPumpCurrentA = v; break;
      case F_THROTTLE_INPUT_RAW: throttleInputRaw = v; break;
      case F_IDLE_INPUT_RAW: idleInputRaw = v; break;
      case F_AB_INPUT_RAW: abInputRaw = v; break;
      case F_AB_INPUT_NORM: abInputPct = v; break;
      case F_MAX_N1_RPM: maxN1Rpm = v; break;
      case F_MAX_N2_RPM: maxN2Rpm = v; break;
      case F_MAX_TOT_C: maxTotC = v; break;
      case F_MAX_TIT_C: maxTitC = v; break;
      case F_MAX_OIL_TEMP_C: maxOilTempC = v; break;
      case F_MAX_FUEL_PRESS_BAR: maxFuelPressBar = v; break;
      case F_MAX_BATT_V: maxBattV = v; break;
      case F_RUN_COUNT: runCount = v; break;
      case F_BOOT_COUNT: bootCount = v; break;
      case F_UPTIME_MS: uptimeMs = v; break;
      case F_DI1: di1 = v; break;
      case F_DI2: di2 = v; break;
      case F_DI3: di3 = v; break;
      case F_DI4: di4 = v; break;
      default: break;
    }
  }
};
