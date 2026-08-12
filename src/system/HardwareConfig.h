#pragma once
#include <ArduinoJson.h>
#include "ChannelRegistry.h"

// ============================================================
//  HardwareConfig — manages the hardware section of ecu_config.json
//
//  Replaces compile-time hardware_profile.h for runtime hardware
//  topology configuration (pins, feature flags, servo ranges,
//  sequence order, safety enables).
//
//  Boot sequence:
//    1. HardwareConfig::load()
//    2. If no file → applyDefaults() (mirrors hardware_profile.h) + save()
//    3. All Hardware:: init/update functions read from this class
//
//  Changes require a reboot (pins are initialised once at boot).
//  Engine must be in STANDBY to POST /api/hardware.
// ============================================================

class HardwareConfig {
public:
    static constexpr uint8_t CHANNEL_REGISTRY_VERSION = 2;
#if defined(OT_PLATFORM_ESP32S3)
    static ChannelRegistry channelRegistry;
#else
    // The classic target keeps the registry on the heap; a static instance
    // would consume the constrained linker DRAM segment before setup().
    static ChannelRegistry& channelRegistry;
#endif
    static constexpr const char* PATH        = "/ecu_config.json";
    static constexpr const char* SECTION     = "hardware";

    // ── Profile identity ──────────────────────────────────────
    // profileId identifies the loaded engine and is used as the WiFi AP SSID.
    // It must match the settings section profileId within the same ecu_config.json.
    static char  profileId[64];
    static char  profileDesc[64];
    static char  wifiPassword[64];   // WiFi AP password — empty = open network; WPA2 allows 8-63 chars
    static int   wifiTxPowerDbm;     // AP transmit power, dBm; lower reduces heat/current draw

    // ── System features ───────────────────────────────────────
    static bool  hasAfterburner;     // shows afterburner-specific hardware sections
    static bool  hasTwoShaft;        // shows N2 RPM sensor

    // ── Physical controls ─────────────────────────────────────
    static int  stopPin;
    static bool stopActiveH;    // false = active-low (button to GND, INPUT_PULLUP) — default
    static bool stopPullup;     // true = enable ESP32 internal pull-up on stop pin (default on)
    static bool stopPulldown;   // true = enable ESP32 internal pull-down on stop pin
    static int  startPin;
    static bool startActiveH;   // false = active-low
    static bool startPullup;    // true = enable ESP32 internal pull-up on start pin (default on)
    static bool startPulldown;  // true = enable ESP32 internal pull-down on start pin

    // ── Sensor feature flags ──────────────────────────────────
    static bool hasN1Rpm;
    static bool hasN2Rpm;
    static bool hasTot;
    static bool hasTit;
    static bool hasOilPress;
    static bool hasFlame;
    static bool hasFuelFlow;
    static bool hasFuelPress;     // dedicated fuel pressure sensor (ADC, calibrated on cal page)
    static bool hasP1;
    static bool hasP2;
    static bool hasThrottleInput;
    static bool hasIdleInput;
    static bool hasOilTemp;       // engine oil temperature sensor
    static bool hasBattVoltage;   // bus / battery voltage monitor
    static bool hasTorque;        // torque sensor (turboshaft / dynamometer)
    static bool hasThrust;        // calibrated load-cell thrust input

    // One shared I2C bus. Recognized devices are discovered automatically;
    // only assigned channels are persisted in ChannelRegistry.
    static bool     i2cEnabled;
    static int      i2cSdaPin;
    static int      i2cSclPin;
    static int      i2cInterruptPin;
    static uint32_t i2cFrequencyHz;

    // One shared SPI bus. Devices retain only their own CS and any
    // device-specific auxiliary pins; PCB profiles may fix these bus pins.
    static bool     spiEnabled;
    static int      spiSckPin;
    static int      spiMisoPin;
    static int      spiMosiPin;

    // ── Sensor pins & params ──────────────────────────────────
    static int   n1RpmPin;
    static float n1RpmPpr;
    static int   n2RpmPin;
    static float n2RpmPpr;
    static char  totChip[12];       // "max6675", "max31855", "max31856"
    static char  totTcType[4];      // thermocouple type for MAX31856: "K","J","N","T"…
    static int   totClk;
    static int   totCs;
    static int   totMiso;
    static int   totMosi;
    static char  titChip[12];       // "max6675", "max31855", "max31856"
    static char  titTcType[4];      // thermocouple type for MAX31856
    static int   titClk;
    static int   titCs;
    static int   titMiso;
    static int   titMosi;
    static int   oilPressPin;
    static int   flamePin;
    static int   fuelFlowPin;
    static int   fuelFlowType;          // 0 = analog voltage, 1 = pulse/frequency
    static float fuelFlowPulsesPerLitre; // pulse type: pulses per litre
    static int   fuelPressPin;
    static int   p1Pin;
    static int   p2Pin;
    static int   throttleInputPin;
    static bool  throttleInputRcPwm;
    static int   idleInputPin;
    static bool  idleInputRcPwm;

    // oil temperature sensor — "ntc" (analog NTC), "max6675", "max31855", "max31856", "ds18b20"
    static char  oilTempChip[12];
    static int   oilTempPin;        // analog pin for NTC; CLK pin for SPI types; data pin for DS18B20
    static int   oilTempCs;         // SPI CS  (-1 for NTC / DS18B20)
    static int   oilTempMiso;       // SPI MISO (-1 for NTC / DS18B20)
    static int   oilTempMosi;       // SPI MOSI (-1 for non-MAX31856)
    static char  oilTempTcType[4];  // thermocouple type for MAX31856: "K","J","N","T"…
    static int   oilTempResolution; // DS18B20 resolution bits: 9, 10, 11, or 12 (default 10)
    static float ntcBeta;           // NTC B coefficient (default 3950)
    static float ntcR0;             // NTC resistance at reference temp in Ω (default 10000)
    static float ntcRFixed;         // pull-up resistor in Ω (default 10000)
    static bool  ntcFixedPullup;
    static bool  oilTempUseRawPoly;
    static float oilTempPolyA, oilTempPolyB, oilTempPolyC, oilTempPolyD;
    static float oilTempPolyXMin, oilTempPolyXMax;

    // battery / bus voltage monitor — analog divider
    static int   battVoltPin;       // ADC pin
    static float battVoltDivider;   // voltage divider ratio: Vbatt = ADC_volt × divider
                                    // e.g. 5.7 for a 10k/47k divider on a 3.3 V ADC

    // torque sensor - analog output or persisted HX711 wiring/calibration
    static int   torquePin;         // ADC pin
    static float torqueScale;       // Nm per volt (e.g. 100 Nm / 3.3 V → 30.3)
    static float torqueOffset;      // zero-offset in Nm (subtracted from raw)
    static bool  torqueHx711;
    static int   torqueDtPin;
    static int   torqueClkPin;
    static float torqueHxScale;
    static long  torqueHxZero;

    // ── Actuator feature flags ────────────────────────────────
    static bool hasThrottle;
    static bool hasStarter;
    static bool hasOilPump;
    static bool hasFuelSol;
    static bool hasIgniter;
    static bool hasIgniter2;
    static bool hasStarterEn;
    static bool hasAbSol;
    static bool hasAirstarterSol;
    static bool hasCoolFan;
    static bool hasAbPump;
    static bool hasOilScavengePump;  // dedicated scavenge return pump
    static bool hasFuelPump2;        // second variable fuel pump (independent of throttle ESC)
    static bool hasBleedValve;       // compressor bleed valve (surge prevention / unloaded start)
    static bool hasPropPitch;        // variable pitch propeller servo (turboprop)
    static bool hasGlowPlug;         // glow plug / flame element
    static bool hasGlowCurrentSensor;       // current sensor on glow plug output
    static bool hasIgniterCurrentSensor;   // current sensor on igniter 1 coil output
    static bool hasIgniter2CurrentSensor;  // current sensor on secondary igniter coil output
    static bool hasOilPumpCurrentSensor;   // current sensor on oil pump output (overcurrent detection)
    static bool hasGovernor;         // N2 power turbine speed governor (turboshaft/APU)
    static bool hasMAVLink;          // MAVLink UART telemetry output
    static bool hasStatusLed;
    static bool hasClusterSerial;
    static bool hasBuzzer;           // passive buzzer / piezo on buzzerPin
    static int  buzzerPin;

    // ── Actuator pins & params ────────────────────────────────
    // throttleType / starterType: 0=servo, 1=ledc_pwm, 2=onoff
    static int   throttlePin;
    static int   throttleType;
    static int   throttleMinUs;
    static int   throttleMaxUs;
    static bool  throttleInverted;   // LEDC type: invert duty (0%→full, 100%→off)
    static bool  throttleActiveH;    // on-off mode active polarity
    static int   throttleLedcFreqHz;
    static int   throttleLedcBits;
    static float throttlePwmMinPct;
    static float throttlePwmMaxPct;

    static int   starterPin;
    static int   starterType;
    static int   starterMinUs;
    static int   starterMaxUs;
    static bool  starterInverted;
    static bool  starterActiveH;     // on-off mode active polarity
    static int   starterLedcFreqHz;
    static int   starterLedcBits;
    static float starterPwmMinPct;
    static float starterPwmMaxPct;

    // oilPumpType: 0=servo, 1=ledc_pwm, 2=onoff
    static int   oilPumpPin;
    static int   oilPumpType;
    static int   oilPumpMinUs;
    static int   oilPumpMaxUs;
    static bool  oilPumpActiveH;        // on-off mode active polarity
    static int   oilPumpFreqHz;
    static int   oilPumpResBits;
    static float oilPumpPwmMinPct;
    static float oilPumpPwmMaxPct;

    static int   fuelSolPin;
    static bool  fuelSolActiveH;

    static int   igniterPin;
    static bool  igniterActiveH;        // relay mode only
    static bool  igniterPwm;            // true = direct coil PWM drive
    static int   igniterDwellMs;
    static int   igniterRestMs;
    static bool  igniterCoil;            // true = active coil switching (fires repeatedly)
    static float igniterCoilSatAmps;     // saturation threshold (coil + current mode)
    static int   igniterCurrentPin;      // ADC pin for igniter current sensor (-1 = none)
    static float igniterCurrentMvPerA;   // sensor sensitivity mV/A (e.g. 100 for ACS712-20A)
    static float igniterCurrentZeroV;    // output voltage at 0A (default 1.65V)

    static int   igniter2Pin;
    static bool  igniter2ActiveH;
    static bool  igniter2Pwm;
    static int   igniter2DwellMs;
    static int   igniter2RestMs;
    static bool  igniter2Coil;             // true = active coil switching (fires repeatedly)
    static float igniter2CoilSatAmps;      // saturation threshold (coil + current mode)
    static int   igniter2CurrentPin;       // ADC pin for secondary igniter current sensor (-1 = none)
    static float igniter2CurrentMvPerA;    // sensor sensitivity mV/A (e.g. 100 for ACS712-20A)
    static float igniter2CurrentZeroV;     // output voltage at 0A (default 1.65V)

    static int   starterEnPin;
    static bool  starterEnActiveH;
    static int   starterEnDelayMs;   // ms delay after enable relay closes before starter may spin

    static int   abSolPin;
    static bool  abSolActiveH;
    static int   airstarterSolPin;
    static bool  airstarterSolActiveH;

    // coolFanType: 0=servo, 1=ledc_pwm, 2=onoff
    static int   coolFanPin;
    static int   coolFanType;
    static int   coolFanMinUs;
    static int   coolFanMaxUs;
    static bool  coolFanActiveH;        // on-off mode active polarity
    static int   coolFanFreqHz;
    static int   coolFanResBits;
    static float coolFanPwmMinPct;
    static float coolFanPwmMaxPct;

    // abPumpType: 0=servo, 1=ledc_pwm, 2=onoff
    static int   abPumpPin;
    static int   abPumpType;
    static int   abPumpMinUs;
    static int   abPumpMaxUs;
    static bool  abPumpActiveH;
    static int   abPumpFreqHz;
    static int   abPumpResBits;
    static float abPumpPwmMinPct;
    static float abPumpPwmMaxPct;

    // oilScavPumpType: 0=servo, 1=ledc_pwm, 2=onoff
    static int   oilScavPumpPin;
    static int   oilScavPumpType;
    static int   oilScavPumpMinUs;
    static int   oilScavPumpMaxUs;
    static bool  oilScavPumpActiveH;
    static int   oilScavPumpFreqHz;
    static int   oilScavPumpResBits;
    static float oilScavPumpPwmMinPct;
    static float oilScavPumpPwmMaxPct;

    // fuelPump2Type: 0=servo, 1=ledc_pwm, 2=onoff
    static int   fuelPump2Pin;
    static int   fuelPump2Type;
    static int   fuelPump2MinUs;
    static int   fuelPump2MaxUs;
    static bool  fuelPump2ActiveH;
    static int   fuelPump2FreqHz;
    static int   fuelPump2ResBits;
    static float fuelPump2PwmMinPct;
    static float fuelPump2PwmMaxPct;

    // Canonical variable-output driver: 0=servo, 1=ledc_pwm, 2=on-off.
    static int   bleedValveType;
    static int   bleedValvePin;
    static bool  bleedValveActiveH;    // false = active-low relay / MOSFET
    static int   bleedValveMinUs;      // servo: closed pulse
    static int   bleedValveMaxUs;      // servo: open pulse
    static int   bleedValveFreqHz;     // PWM freq
    static int   bleedValveResBits;    // PWM resolution
    static float bleedValvePwmMinPct;
    static float bleedValvePwmMaxPct;

    // propPitchType: 0=servo, 1=ledc_pwm, 2=on-off
    static int   propPitchType;
    static int   propPitchPin;         // actuator output pin
    static int   propPitchMinUs;       // servo: fine pitch pulse
    static int   propPitchMaxUs;       // servo: coarse pitch pulse
    static int   propPitchFreqHz;      // PWM freq
    static int   propPitchResBits;     // PWM resolution
    static float propPitchPwmMinPct;
    static float propPitchPwmMaxPct;
    static bool  propPitchActiveH;     // on-off: active-high = coarse pitch

    // glowPlugType: 0=plain glow, 2=wet glow (1 retired: current-sensing is the
    // separate hasGlowCurrentSensor flag, independent of plain/wet)
    // glowPlugOutputType: 0=LEDC PWM, 1=on-off relay/MOSFET
    static int   glowPlugType;
    static int   glowPlugOutputType;
    static bool  glowPlugActiveH;       // relay/on-off mode polarity
    static int   glowPlugPin;           // output to glow plug / ignition element
    static int   glowPlugFreqHz;       // PWM frequency (e.g. 1000 Hz)
    static int   glowPlugResBits;      // PWM resolution (default 8)
    static float glowPlugPwmMinPct;
    static float glowPlugPwmMaxPct;
    static int   wetGlowFuelPin;       // fuel output for wet glow plug (-1 = none)
    static int   wetGlowFuelType;      // 0=relay, 1=LEDC PWM, 2=servo/ESC
    static bool  wetGlowFuelActiveH;    // relay mode polarity
    static int   wetGlowFuelMinUs;      // servo/ESC low pulse
    static int   wetGlowFuelMaxUs;      // servo/ESC high pulse
    static int   wetGlowFuelFreqHz;     // PWM frequency
    static int   wetGlowFuelResBits;    // PWM resolution
    static float wetGlowFuelPwmMinPct;
    static float wetGlowFuelPwmMaxPct;
    static float wetGlowFuelDemandPct;  // active demand for PWM/servo
    static int   wetGlowFuelDelayMs;    // delay after glow command before fuel starts
    static int   glowCurrentPin;            // ADC pin for glow plug current sensor (-1 = none)
    static float glowCurrentMvPerA;         // sensor sensitivity mV/A (e.g. 185 for ACS712-5A)
    static float glowCurrentZeroV;          // output voltage at 0A (default 1.65V)
    static float glowCurrentReadyAmps;      // current drops below this → plug is hot

    static int   oilPumpCurrentPin;         // ADC pin for oil pump current sensor (-1 = none)
    static float oilPumpCurrentMvPerA;      // sensor sensitivity mV/A (e.g. 100 for ACS712-20A)
    static float oilPumpCurrentZeroV;       // output voltage at 0A (default 1.65V)
    static float oilPumpCurrentMaxAmps;     // overcurrent trip threshold (0 = disabled)

    // ── MAVLink UART ──────────────────────────────────────────
    static int   mavlinkTxPin;         // UART TX pin for MAVLink output
    static int   mavlinkBaud;          // baud rate (default 57600)
    static int   mavlinkIntervalMs;    // telemetry send interval (ms)

    static int   statusLedPin;
    static bool  statusLedActiveH;
    static int   statusLedType;        // 0=plain GPIO, 1=NeoPixel/RGB data LED
    static int   statusLedMode;        // NeoPixel only: 0=blink pattern, 1=state color
    static uint32_t statusLedStandbyColor;
    static uint32_t statusLedBlinkColor;
    static uint32_t statusLedStartupColor;
    static uint32_t statusLedRunningColor;
    static uint32_t statusLedShutdownColor;

    // ── Cluster serial ────────────────────────────────────────
    static int   clusterTxPin;
    static int   clusterRxPin;
    static int   clusterBaud;
    static int   clusterIntervalMs;

    // ── Controller feature flags ──────────────────────────────
    static bool hasOilLoop;
    static bool hasDynamicIdle;

    static constexpr int MAX_OIL_LOOPS = 2;
    struct OilLoopDef {
        bool  enabled = false;
        char  id[16] = {};
        uint8_t pressureInputIndex = 255;
        uint8_t pumpOutputIndex = 255;
        uint8_t targetSource = 0; // 0=fixed, 1=effective core fuel, 2=N1, 3=N2
        uint16_t targetCentiBar = 250;
        uint16_t targetHighCentiBar = 250;
        uint16_t speedMinHundredRpm = 0;
        uint16_t speedMaxHundredRpm = 200;
        uint16_t deadbandCentiBar = 20;
        uint8_t minDemandPct = 18;
        uint8_t maxDemandPct = 100;
    };
    static OilLoopDef oilLoops[MAX_OIL_LOOPS];
    static uint8_t oilLoopCount;

    // ── Safety enables ────────────────────────────────────────
    static bool safetyOverspeed;
    static bool safetyN2Overspeed;
    static bool safetyOvertemp;
    static bool safetyLowOil;
    static bool safetyOilZero;
    static bool safetyFlameout;
    static bool safetyHotStart;   // reject START if selected EGT is above preStartEgtLimitC
    static bool safetyOilTempHigh;  // oil temperature overtemp shutdown
    static bool safetyFuelPressLow; // fuel pressure below minimum shutdown
    static bool safetyBattLow;      // battery undervoltage warning/shutdown
    static bool safetySurge;        // compressor surge detection (N1 oscillation)

    // ── Afterburner trigger & arming ─────────────────────────
    // abTriggerSource: 0=manual (web UI only), 1=throttle, 2=switch, 3=rc/analog input
    static int   abTriggerSource;
    static bool  abRequiresArmSwitch;  // second enable gate (for source 1/2/3)
    static int   abArmSwitchPin;
    static bool  abArmSwitchActiveH;
    static int   abSwitchPin;          // dedicated trigger switch (source=2)
    static bool  abSwitchActiveH;
    static int   abInputPin;           // optional AB command/trigger input
    static bool  abInputRcPwm;         // false=ADC, true=servo PWM input
    static int   abInputMinUs;         // servo PWM zero-command endpoint
    static int   abInputMaxUs;         // servo PWM full-command endpoint
    static int   abInputThreshold;     // normalized 0-4095 trigger threshold

    // AB flame sensor (optional, dedicated — separate from main flame sensor)
    static bool  hasAbFlame;

    // ── Channel display labels (user-defined, shown in UI instead of technical names) ──
    static char labelTot[32];        // default "TOT"
    static char labelTit[32];        // default "TIT"
    static char labelN1[32];         // default "N1"
    static char labelN2[32];         // default "N2"
    static char labelOilPress[32];   // default "Oil Press"
    static char labelOilTemp[32];    // default "Oil Temp"
    static char labelP1[32];         // default "Pressure 1"; follows registry channel name
    static char labelP2[32];         // default "Pressure 2"; follows registry channel name
    static char labelFuelPress[32];  // default "Fuel Press"
    static char labelFuelFlow[32];   // default "Fuel Flow"
    static char labelStop[32];       // default "Stop"
    static char labelStart[32];      // default "Start"
    static char labelAbArm[32];      // default "AB Arm"

    // ── General-purpose digital input channels ────────────────
    static constexpr int MAX_DI = 4;
    struct DiChannel {
        int  pin         = -1;
        bool activeH     = false;   // true = active-high, false = active-low
        int  debounceMs  = 20;
        char label[32]   = {};      // user display name
        // role: "none","fault","inhibit_start","estop","ab_arm","limp_mode","ab_fire"
        char role[20]    = "none";
        // fault role params:
        char faultCode[24]    = {};  // e.g. "LOW_OIL_PRESSURE"
        char faultMsg[64]     = {};  // human-readable fault description
        uint8_t activeModes   = 0x1F; // bitmask of SysMode values where action fires (0x1F = all 5 modes incl. FAULT)
    };
    static DiChannel diCh[MAX_DI];

    // ── Startup / shutdown / afterburner sequences ────────────
    static constexpr int MAX_SEQ_BLOCKS = 16;
    static constexpr int MAX_SEQ_SIDE_ACTIONS = 4;
    static constexpr int MAX_CUSTOM_BLOCKS = 8;
    static constexpr int MAX_CUSTOM_STEPS = 8;
    struct SeqSideAction {
        bool    enabled = false;
        uint8_t actuator = 0;
        float   value = 0.0f;  // 0.0-1.0 demand; relays use >=0.5 as ON
    };
    struct CustomBlockStep {
        uint8_t type = 0;      // 0 = set actuator, 1 = delay
        uint8_t actuator = 0;  // RulesEngine::Actuator when type == 0
        float   value = 0.0f;  // 0.0-1.0 actuator demand
        uint32_t delayMs = 0;  // when type == 1
    };
    struct CustomBlockDef {
        bool     enabled = false;
        char     key[24] = {};
        char     label[32] = {};
        char     desc[96] = {};
        uint8_t  type = 0;           // 0 = action, 1 = wait, 2 = while
        uint32_t durationMs = 1000;  // wait type
        uint32_t timeoutMs = 10000;  // while type; runtime always applies a finite fallback
        uint8_t  timeoutAction = 0;  // 0 = abort, 1 = fault, 2 = continue
        uint8_t  sensor = 255;
        uint8_t  op = 0;
        float    threshold = 0.0f;
        uint32_t stableMs = 0;       // condition must remain true continuously
        bool     relativeToEntry = false; // threshold is a rise/drop from entry value
        uint8_t  stepCount = 0;
        CustomBlockStep steps[MAX_CUSTOM_STEPS] = {};
    };
    static CustomBlockDef customBlocks[MAX_CUSTOM_BLOCKS];
    static int customBlockCount;
    static char  startupSeq[MAX_SEQ_BLOCKS][24];
    static int   startupSeqLen;
    static int   startupDelayMs[MAX_SEQ_BLOCKS];
    static uint8_t startupIgnitionTarget[MAX_SEQ_BLOCKS]; // 0=igniter1, 1=igniter2, 2=glow plug
    static SeqSideAction startupEnterActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS];
    static SeqSideAction startupExitActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS];
    static char  shutdownSeq[MAX_SEQ_BLOCKS][24];
    static int   shutdownSeqLen;
    static int   shutdownDelayMs[MAX_SEQ_BLOCKS];
    static uint8_t shutdownIgnitionTarget[MAX_SEQ_BLOCKS];
    static SeqSideAction shutdownEnterActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS];
    static SeqSideAction shutdownExitActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS];
    static char  abSeq[MAX_SEQ_BLOCKS][24];     // AB ignition sequence
    static int   abSeqLen;
    static int   abDelayMs[MAX_SEQ_BLOCKS];
    static uint8_t abIgnitionTarget[MAX_SEQ_BLOCKS];
    static SeqSideAction abEnterActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS];
    static SeqSideAction abExitActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS];
    static char  abShutSeq[MAX_SEQ_BLOCKS][24]; // AB shutdown sequence
    static int   abShutSeqLen;
    static int   abShutDelayMs[MAX_SEQ_BLOCKS];
    static uint8_t abShutIgnitionTarget[MAX_SEQ_BLOCKS];
    static SeqSideAction abShutEnterActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS];
    static SeqSideAction abShutExitActions[MAX_SEQ_BLOCKS][MAX_SEQ_SIDE_ACTIONS];

    // ── Singleton accessor ────────────────────────────────────
    // All members are static; instance() lets callers use the
    // convenient `auto& hw = HardwareConfig::instance(); hw.xxx` pattern
    // without changing every call site to HardwareConfig::xxx directly.
    static HardwareConfig& instance() {
        static HardwareConfig _s;
        return _s;
    }

    // ── API ───────────────────────────────────────────────────
    static void load();                      // call at boot after LittleFS.begin()
    static bool save();                      // write current values → ecu_config.json hardware section
    // Atomically write current Hardware and Settings while holding only one
    // large JSON section in heap at a time.
    static bool saveUnified();
    static void applyDefaults();             // restore defaults (mirrors hardware_profile.h)

    // Serialize to / from JSON
    static size_t toJson(char* buf, size_t len, bool redactPassword = false);
    static void   toJson(JsonDocument& doc, bool redactPassword = false);
    static void   toJson(JsonObject doc, bool redactPassword = false);
    static bool   validateJson(const char* json, size_t len);
    static bool   validateJson(const JsonDocument& doc, ChannelRegistry* registryWorkspace = nullptr);
    static const char* lastValidationError();
    // The mutable input overload lets ArduinoJson keep strings in the web
    // receive buffer instead of duplicating every key/value on the heap.  This
    // is important on Classic ESP32 for a complete, otherwise-valid hardware
    // map.  Callers must treat the buffer as consumed after this call.
    static bool   fromJson(char* json, size_t len,
                           ChannelRegistry* validationWorkspace = nullptr);
    // Apply a document already accepted by validateJson(), without writing
    // storage. The full-engine restore path uses this to avoid a second large
    // validation allocation while several transaction documents are resident.
    static void   applyValidatedJsonRuntimeOnly(const JsonDocument& doc);

private:
    static void _toDoc(JsonObject doc);
    static void _fromDoc(const JsonDocument& doc);
};
