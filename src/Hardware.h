#pragma once
// ============================================================
//  Hardware.h — runtime hardware dispatch
//
//  Reads HardwareConfig (loaded from the hardware section of /ecu_config.json) at boot.
//  All sensor/actuator objects are always compiled in; feature
//  enable/disable is controlled by HardwareConfig runtime flags
//  instead of compile-time #ifdef OT_HAS_* guards.
//
//  hardware_profile.h is still included for compile-time defaults
//  used by HardwareConfig::applyDefaults() and boot-control defines
//  such as OT_STOP_PIN and OT_START_PIN.
//
//  Pin assignments pass through Hardware::initSensors/initActuators
//  at boot time; changing the hardware section and rebooting applies new pins.
//
//  main.cpp includes this once and calls Hardware::init* / update*.
// ============================================================

#include "../hardware_profile.h"
#include "system/HardwareConfig.h"
#include "soc/soc_caps.h"

// ── All sensor headers — always included ──────────────────────
#include "hal/sensors/PCNTRpmSensor.h"
#include "hal/sensors/MAX6675TempSensor.h"
#include "hal/sensors/MAX31855TempSensor.h"
#include "hal/sensors/MAX31856TempSensor.h"
#include "hal/sensors/AnalogSensor.h"
#include "hal/sensors/NTCSensor.h"
#include "hal/sensors/DS18B20TempSensor.h"
#include "hal/sensors/HX711Sensor.h"
#include "hal/i2c/I2CDeviceManager.h"

// ── All actuator headers — always included ────────────────────
#include "hal/actuators/ServoActuator.h"
#include "hal/actuators/LEDCActuator.h"
#include "hal/actuators/RelayActuator.h"
#include "hal/actuators/IActuator.h"

// ── Controller headers — always included ──────────────────────
#include "engine/controllers/OilPressureLoop.h"
#include "engine/controllers/ThrottleSlew.h"
#include "engine/controllers/DynamicIdle.h"
#include "engine/controllers/PowerTurbineGovernor.h"

// ── Sequence block headers ────────────────────────────────────
#include "engine/sequencer/blocks/AdvancedBlocks.h"
#include "engine/sequencer/blocks/OilPrime.h"
#include "engine/sequencer/blocks/StarterSpin.h"
#include "engine/sequencer/blocks/PreIgnSpark.h"
#include "engine/sequencer/blocks/FuelOpen.h"
#include "engine/sequencer/blocks/FlameConfirm.h"
#include "engine/sequencer/blocks/TempConfirm.h"
#include "engine/sequencer/blocks/TimedDelay.h"
#include "engine/sequencer/blocks/FuelPumpIdle.h"
#include "engine/sequencer/blocks/ModifiedIdle.h"
#include "engine/sequencer/blocks/Spool.h"
#include "engine/sequencer/blocks/SafetyHold.h"
#include "engine/sequencer/blocks/ImmediateCut.h"
#include "engine/sequencer/blocks/RPMDrop.h"
#include "engine/sequencer/blocks/CooldownSpin.h"
#include "engine/sequencer/blocks/FinalStop.h"
#include "engine/sequencer/blocks/ActuatorBlocks.h"
#include "engine/sequencer/blocks/MoreBlocks.h"
#include "engine/sequencer/blocks/WaitForInput.h"
#include "engine/sequencer/blocks/ABCheckReady.h"
#include "engine/sequencer/blocks/ABIgnite.h"
#include "engine/sequencer/blocks/ABFlameConfirm.h"
#include "engine/sequencer/blocks/ABStabilize.h"
#include "engine/sequencer/SequenceEngine.h"
#include "engine/SafetyMonitor.h"
#include "system/Config.h"
#include "platform/esp32/StatusLED.h"

// ============================================================
//  OT_DECLARE_HARDWARE — put in global scope in main.cpp.
//  All sensor/actuator/controller/block objects always declared.
//  For oil pump and igniter, both relay and LEDC variants are
//  declared; g_actOilPump / g_actIgniter are IActuator* pointers
//  set to the active one by initActuators().
// ============================================================

// Servo signal range defaults (used when the engine file has no override)
#ifndef OT_THROTTLE_SERVO_MIN_US
  #define OT_THROTTLE_SERVO_MIN_US 1000
#endif
#ifndef OT_THROTTLE_SERVO_MAX_US
  #define OT_THROTTLE_SERVO_MAX_US 2000
#endif
#ifndef OT_STARTER_SERVO_MIN_US
  #define OT_STARTER_SERVO_MIN_US  1000
#endif
#ifndef OT_STARTER_SERVO_MAX_US
  #define OT_STARTER_SERVO_MAX_US  2000
#endif
#ifndef OT_OIL_PUMP_ONOFF_ACTIVE_H
  #define OT_OIL_PUMP_ONOFF_ACTIVE_H true
#endif
#ifndef OT_IGNITER_DWELL_MS
  #define OT_IGNITER_DWELL_MS 6
#endif
#ifndef OT_IGNITER_REST_MS
  #define OT_IGNITER_REST_MS  3
#endif

#define OT_DECLARE_HARDWARE \
    /* ── Sensors ──────────────────────────────────────────────────────────── */ \
    PCNTRpmSensor      g_sensorN1Rpm(OT_N1_RPM_PIN, OT_N1_RPM_PPR, "N1_RPM");   \
    PCNTRpmSensor      g_sensorN2Rpm(27, 0.633f, "N2_RPM");                      \
    MAX6675TempSensor    g_sensorTot(OT_TOT_CLK, OT_TOT_CS, OT_TOT_MISO, "TOT"); \
    MAX31855TempSensor   g_sensorTotAlt(OT_TOT_CLK, OT_TOT_CS, OT_TOT_MISO, "TOT_ALT"); \
    MAX31856TempSensor   g_sensorTot31856(OT_TOT_CLK, OT_TOT_CS, OT_TOT_MISO, -1, "K", "TOT_31856"); \
    ISensor*             g_pSensorTot = nullptr;                                  \
    MAX6675TempSensor    g_sensorTit(-1, -1, -1, "TIT");                         \
    MAX31855TempSensor   g_sensorTitAlt(-1, -1, -1, "TIT_ALT");                  \
    MAX31856TempSensor   g_sensorTit31856(-1, -1, -1, -1, "K", "TIT_31856");     \
    ISensor*             g_pSensorTit = nullptr;                                  \
    /* Oil temp sensor (NTC analog, SPI thermocouple, or DS18B20 OneWire) */       \
    MAX6675TempSensor    g_sensorOilTempTc(-1, -1, -1, "OIL_TEMP_TC");           \
    MAX31855TempSensor   g_sensorOilTemp855(-1, -1, -1, "OIL_TEMP_855");         \
    MAX31856TempSensor   g_sensorOilTemp856(-1, -1, -1, -1, "K", "OIL_TEMP_856");\
    NTCSensor            g_sensorOilTempNtc(-1, "OIL_TEMP_NTC");                 \
    DS18B20TempSensor    g_sensorOilTempDs18b20("OIL_TEMP_DS18B20");             \
    ISensor*             g_pSensorOilTemp = nullptr;                              \
    /* Battery voltage and torque sensors */                                      \
    AnalogLinearSensor   g_sensorBattVolt(-1, "BATT_VOLT");                      \
    AnalogLinearSensor   g_sensorTorque(-1, "TORQUE");                           \
    HX711Sensor           g_sensorTorqueHx711(-1, -1, "TORQUE_HX711");            \
    AnalogPolySensor   g_sensorOilPress(OT_OIL_PRESS_PIN, "OIL_PRESS");          \
    AnalogThSensor     g_sensorFlame(OT_FLAME_PIN, "FLAME");                     \
    AnalogLinearSensor g_sensorIdleInput(OT_IDLE_INPUT_PIN, "IDLE_INPUT");       \
    AnalogLinearSensor g_sensorThrottleInput(OT_THROTTLE_INPUT_PIN, "THROTTLE_INPUT"); \
    AnalogLinearSensor g_sensorFuelFlow(36, "FUEL_FLOW");                        \
    PCNTRpmSensor      g_sensorFuelFlowPulse(-1, 1.0f, "FUEL_FLOW_PULSE");      \
    AnalogLinearSensor g_sensorFuelPress(36, "FUEL_PRESS");                      \
    AnalogLinearSensor g_sensorP1(36, "P1");                                     \
    AnalogLinearSensor g_sensorP2(39, "P2");                                     \
    AnalogThSensor     g_sensorAbFlame(-1, "AB_FLAME");                          \
    AnalogLinearSensor g_sensorAbInput(-1, "AB_INPUT");                          \
    AnalogLinearSensor g_sensorGlowCurrent(-1, "GLOW_CURRENT");                  \
    AnalogLinearSensor g_sensorIgniterCurrent(-1, "IGNITER_CURRENT");             \
    AnalogLinearSensor g_sensorIgniter2Current(-1, "IGNITER2_CURRENT");           \
    AnalogLinearSensor g_sensorOilPumpCurrent(-1, "OIL_PUMP_CURRENT");           \
    /* ── Actuators ─────────────────────────────────────────────────────────── */ \
    /* Throttle: servo / LEDC-PWM / on-off — pointer set by initActuators() */   \
    ServoActuator  g_actThrottleServo(OT_THROTTLE_PIN, OT_THROTTLE_SERVO_MIN_US, OT_THROTTLE_SERVO_MAX_US, "THROTTLE_SRV"); \
    LEDCActuator   g_actThrottleLedc(OT_THROTTLE_PIN, 10000, 12, "THROTTLE_LEDC"); \
    RelayActuator  g_actThrottleOnOff(OT_THROTTLE_PIN, true, "THROTTLE_ONOFF");   \
    IActuator*     g_actThrottle = nullptr;                                        \
    /* Starter: servo / LEDC-PWM / on-off */                                       \
    ServoActuator  g_actStarterServo(OT_STARTER_MOTOR_PIN, OT_STARTER_SERVO_MIN_US, OT_STARTER_SERVO_MAX_US, "STARTER_SRV"); \
    LEDCActuator   g_actStarterLedc(OT_STARTER_MOTOR_PIN, 10000, 12, "STARTER_LEDC"); \
    RelayActuator  g_actStarterOnOff(OT_STARTER_MOTOR_PIN, true, "STARTER_ONOFF"); \
    IActuator*     g_actStarter = nullptr;                                         \
    /* Oil pump: servo / LEDC-PWM / on-off */                                      \
    ServoActuator  g_actOilPumpServo(OT_OIL_PUMP_PIN, 1000, 2000, "OIL_PUMP_SRV"); \
    LEDCActuator   g_actOilPumpLedc(OT_OIL_PUMP_PIN, OT_OIL_PUMP_FREQ_HZ, OT_OIL_PUMP_RES_BITS, "OIL_PUMP"); \
    RelayActuator  g_actOilPumpRelay(OT_OIL_PUMP_PIN, OT_OIL_PUMP_ONOFF_ACTIVE_H, "OIL_PUMP_RELAY"); \
    IActuator*     g_actOilPump = nullptr;                                        \
    /* Scavenge pump: servo / LEDC-PWM / on-off */                                     \
    ServoActuator  g_actOilScavServo(-1, 1000, 2000, "OIL_SCAV_SRV");                 \
    LEDCActuator   g_actOilScavLedc(-1, 10000, 12, "OIL_SCAV_LEDC");                 \
    RelayActuator  g_actOilScavRelay(-1, true, "OIL_SCAV");                           \
    IActuator*     g_actOilScavPump = nullptr;                                         \
    RelayActuator  g_actFuelSol(OT_FUEL_SOL_PIN, OT_FUEL_SOL_ACTIVE_H, "FUEL_SOL"); \
    LEDCActuator   g_actIgniterLedc(OT_IGNITER_PIN, 1000/(OT_IGNITER_DWELL_MS+OT_IGNITER_REST_MS), 8, "IGNITER_LEDC"); \
    RelayActuator  g_actIgniterRelay(OT_IGNITER_PIN, OT_IGNITER_ACTIVE_H, "IGNITER_RELAY"); \
    IActuator*     g_actIgniter = nullptr;                                        \
    /* AB / pilot igniter */                                                       \
    LEDCActuator   g_actIgniter2Ledc(-1, 111, 8, "IGNITER2_LEDC");               \
    RelayActuator  g_actIgniter2Relay(-1, true, "IGNITER2_RELAY");                \
    IActuator*     g_actIgniter2 = nullptr;                                       \
    RelayActuator  g_actStarterEn(OT_STARTER_EN_PIN, OT_STARTER_EN_ACTIVE_H, "STARTER_EN"); \
    RelayActuator  g_actAbSol(-1, true, "AB_SOL");                               \
    RelayActuator  g_actAirstarterSol(-1, true, "AIRSTARTER_SOL");               \
    /* Cool fan: servo / LEDC-PWM / on-off */                                      \
    ServoActuator  g_actCoolFanServo(-1, 1000, 2000, "COOL_FAN_SRV");            \
    LEDCActuator   g_actCoolFanLedc(-1, 10000, 12, "COOL_FAN_LEDC");             \
    RelayActuator  g_actCoolFan(-1, true, "COOL_FAN");                           \
    IActuator*     g_pActCoolFan = nullptr;                                       \
    /* Afterburner pump: servo / LEDC-PWM / on-off */                             \
    ServoActuator  g_actAbPumpServo(-1, 1000, 2000, "AB_PUMP_SRV");              \
    LEDCActuator   g_actAbPumpLedc(-1, 10000, 12, "AB_PUMP_LEDC");               \
    RelayActuator  g_actAbPumpRelay(-1, true, "AB_PUMP");                         \
    IActuator*     g_actAbPump = nullptr;                                         \
    /* Fuel pump 2: servo / LEDC-PWM / on-off */                                  \
    ServoActuator  g_actFuelPump2Servo(-1, 1000, 2000, "FUEL_PUMP2_SRV");        \
    LEDCActuator   g_actFuelPump2Ledc(-1, 10000, 12, "FUEL_PUMP2");             \
    RelayActuator  g_actFuelPump2Relay(-1, true, "FUEL_PUMP2_RELAY");            \
    IActuator*     g_actFuelPump2 = nullptr;                                     \
    /* Compressor bleed valve: on-off / servo / ledc-pwm */                      \
    RelayActuator  g_actBleedValveRelay(-1, true, "BLEED_VALVE");                \
    ServoActuator  g_actBleedValveServo(-1, 1000, 2000, "BLEED_VALVE_SRV");     \
    LEDCActuator   g_actBleedValveLedc(-1, 1000, 10, "BLEED_VALVE_LEDC");       \
    IActuator*     g_actBleedValve = nullptr;                                    \
    /* Propeller pitch actuator: servo / ledc-pwm / on-off */                   \
    ServoActuator  g_actPropPitchServo(-1, 1000, 2000, "PROP_PITCH_SRV");       \
    LEDCActuator   g_actPropPitchLedc(-1, 1000, 10, "PROP_PITCH_LEDC");         \
    RelayActuator  g_actPropPitchRelay(-1, true, "PROP_PITCH");                  \
    IActuator*     g_actPropPitch = nullptr;                                     \
    LEDCActuator   g_actGlowPlug(-1, 1000, 8, "GLOW_PLUG");                     \
    RelayActuator  g_actGlowPlugRelay(-1, true, "GLOW_PLUG_RELAY");             \
    RelayActuator  g_actWetGlowFuelRelay(-1, true, "WET_GLOW_FUEL");            \
    LEDCActuator   g_actWetGlowFuelLedc(-1, 1000, 10, "WET_GLOW_FUEL_PWM");     \
    ServoActuator  g_actWetGlowFuelServo(-1, 1000, 2000, "WET_GLOW_FUEL_SRV");  \
    IActuator*     g_actWetGlowFuel = nullptr;                                  \
    /* ── Controllers ───────────────────────────────────────────────────────── */ \
    OilPressureLoop       g_ctrlOilLoop;                                          \
    ThrottleSlew          g_ctrlThrottleSlew;                                     \
    DynamicIdle           g_ctrlDynamicIdle;                                      \
    PowerTurbineGovernor  g_ctrlGovernor;                                         \
    /* ── Sequence blocks ───────────────────────────────────────────────────── */ \
    OilPrime     g_blkOilPrime;                                                   \
    StarterSpin  g_blkStarterSpin;                                                \
    PreIgnSpark  g_blkPreIgnSpark;                                                \
    FuelOpen     g_blkFuelOpen;                                                   \
    FlameConfirm g_blkFlameConfirm;                                               \
    TempConfirm  g_blkTempConfirm;                                                \
    TimedDelay   g_blkTimedDelay;                                                 \
    FuelPumpIdle g_blkFuelPumpIdle;                                               \
    ModifiedIdle g_blkModifiedIdle;                                               \
    Spool        g_blkSpool;                                                      \
    SafetyHold   g_blkSafetyHold;                                                 \
    ImmediateCut g_blkImmediateCut;                                               \
    RPMDrop      g_blkRPMDrop;                                                    \
    CooldownSpin g_blkCooldownSpin;                                               \
    FinalStop    g_blkFinalStop;                                                   \
    /* ── Simple actuator blocks ────────────────────────────────────────────── */ \
    IgniterOn    g_blkIgniterOn;    IgniterOff   g_blkIgniterOff;                \
    FuelSolClose g_blkFuelSolClose;                                               \
    StarterEnOn  g_blkStarterEnOn;  StarterEnOff g_blkStarterEnOff;             \
    StarterOff   g_blkStarterOff;                                                 \
    OilPumpOn    g_blkOilPumpOn;    OilPumpOff   g_blkOilPumpOff;               \
    CoolFanOn    g_blkCoolFanOn;    CoolFanOff   g_blkCoolFanOff;               \
    AirstarterOn g_blkAirstarterOn; AirstarterOff g_blkAirstarterOff;           \
    ABPumpOn     g_blkABPumpOn;     ABPumpOff    g_blkABPumpOff;                \
    ABIgnOn      g_blkABIgnOn;      ABIgnOff     g_blkABIgnOff;                 \
    ABSolOpen    g_blkABSolOpen;    ABSolClose   g_blkABSolClose;               \
    OilScavengeOn  g_blkOilScavengeOn;  OilScavengeOff g_blkOilScavengeOff;          \
    DrainValveOpen g_blkDrainValveOpen; DrainValveClose g_blkDrainValveClose;          \
    /* ── MoreBlocks ─────────────────────────────────────────────────────────── */ \
    FuelPulse    g_blkFuelPulse;                                                  \
    WaitTOTCool  g_blkWaitTOTCool;                                                \
    WaitForInput g_blkWaitForInput; WaitForInputOff g_blkWaitForInputOff;         \
    ThrottleSet  g_blkThrottleSet;                                                \
    PreHeat      g_blkPreHeat;                                                    \
    /* ── Advanced sequence blocks ───────────────────────────────────────────── */ \
    GlowPreheat  g_blkGlowPreheat;                                                \
    BleedOpen    g_blkBleedOpen;                                                  \
    BleedClose   g_blkBleedClose;                                                 \
    FuelPumpRamp g_blkFuelPumpRamp;                                               \
    GovernorHold g_blkGovernorHold;                                               \
    FuelPump2Set g_blkFuelPump2Set;                                               \
    FuelPump2On  g_blkFuelPump2On;                                                \
    FuelPump2Off g_blkFuelPump2Off;                                               \
    /* ── AB sequence blocks ─────────────────────────────────────────────────── */ \
    ABCheckReady  g_blkABCheckReady;                                              \
    ABIgnite      g_blkABIgnite;                                                  \
    ABFlameConfirm g_blkABFlameConfirm;                                           \
    ABStabilize   g_blkABStabilize;                                               \
    SequenceEngine g_sequencer;                                                   \
    SequenceEngine g_abSequencer;                                                 \
    SafetyMonitor  g_safety;

// ============================================================
//  Forward declarations (used by Hardware:: inline functions)
// ============================================================

extern PCNTRpmSensor      g_sensorN1Rpm;
extern PCNTRpmSensor      g_sensorN2Rpm;
extern MAX6675TempSensor   g_sensorTot;
extern MAX31855TempSensor  g_sensorTotAlt;
extern MAX31856TempSensor  g_sensorTot31856;
extern ISensor*            g_pSensorTot;
extern MAX6675TempSensor   g_sensorTit;
extern MAX31855TempSensor  g_sensorTitAlt;
extern MAX31856TempSensor  g_sensorTit31856;
extern ISensor*            g_pSensorTit;
extern MAX6675TempSensor   g_sensorOilTempTc;
extern MAX31855TempSensor  g_sensorOilTemp855;
extern MAX31856TempSensor  g_sensorOilTemp856;
extern NTCSensor           g_sensorOilTempNtc;
extern DS18B20TempSensor   g_sensorOilTempDs18b20;
extern ISensor*            g_pSensorOilTemp;
extern AnalogLinearSensor  g_sensorBattVolt;
extern AnalogLinearSensor  g_sensorTorque;
extern HX711Sensor          g_sensorTorqueHx711;
extern AnalogPolySensor   g_sensorOilPress;
extern AnalogThSensor     g_sensorFlame;
extern AnalogLinearSensor g_sensorIdleInput;
extern AnalogLinearSensor g_sensorThrottleInput;
extern AnalogLinearSensor g_sensorFuelFlow;
extern PCNTRpmSensor      g_sensorFuelFlowPulse;
extern AnalogLinearSensor g_sensorFuelPress;
extern AnalogLinearSensor g_sensorP1;
extern AnalogLinearSensor g_sensorP2;
extern AnalogThSensor     g_sensorAbFlame;
extern AnalogLinearSensor g_sensorAbInput;
extern AnalogLinearSensor g_sensorGlowCurrent;
extern AnalogLinearSensor g_sensorIgniterCurrent;
extern AnalogLinearSensor g_sensorIgniter2Current;
extern AnalogLinearSensor g_sensorOilPumpCurrent;

extern ServoActuator  g_actThrottleServo;
extern LEDCActuator   g_actThrottleLedc;
extern RelayActuator  g_actThrottleOnOff;
extern IActuator*     g_actThrottle;
extern ServoActuator  g_actStarterServo;
extern LEDCActuator   g_actStarterLedc;
extern RelayActuator  g_actStarterOnOff;
extern IActuator*     g_actStarter;
extern ServoActuator  g_actOilPumpServo;
extern LEDCActuator   g_actOilPumpLedc;
extern RelayActuator  g_actOilPumpRelay;
extern IActuator*     g_actOilPump;
extern ServoActuator  g_actOilScavServo;
extern LEDCActuator   g_actOilScavLedc;
extern RelayActuator  g_actOilScavRelay;
extern IActuator*     g_actOilScavPump;
extern RelayActuator  g_actFuelSol;
extern LEDCActuator   g_actIgniterLedc;
extern RelayActuator  g_actIgniterRelay;
extern IActuator*     g_actIgniter;
extern LEDCActuator   g_actIgniter2Ledc;
extern RelayActuator  g_actIgniter2Relay;
extern IActuator*     g_actIgniter2;
extern RelayActuator  g_actStarterEn;
extern RelayActuator  g_actAbSol;
extern RelayActuator  g_actAirstarterSol;
extern ServoActuator  g_actCoolFanServo;
extern LEDCActuator   g_actCoolFanLedc;
extern RelayActuator  g_actCoolFan;
extern IActuator*     g_pActCoolFan;
extern ServoActuator  g_actAbPumpServo;
extern LEDCActuator   g_actAbPumpLedc;
extern RelayActuator  g_actAbPumpRelay;
extern IActuator*     g_actAbPump;
extern ServoActuator  g_actFuelPump2Servo;
extern LEDCActuator   g_actFuelPump2Ledc;
extern RelayActuator  g_actFuelPump2Relay;
extern IActuator*     g_actFuelPump2;
extern RelayActuator  g_actBleedValveRelay;
extern ServoActuator  g_actBleedValveServo;
extern LEDCActuator   g_actBleedValveLedc;
extern IActuator*     g_actBleedValve;
extern ServoActuator  g_actPropPitchServo;
extern LEDCActuator   g_actPropPitchLedc;
extern RelayActuator  g_actPropPitchRelay;
extern IActuator*     g_actPropPitch;
extern LEDCActuator   g_actGlowPlug;
extern RelayActuator  g_actGlowPlugRelay;
extern RelayActuator  g_actWetGlowFuelRelay;
extern LEDCActuator   g_actWetGlowFuelLedc;
extern ServoActuator  g_actWetGlowFuelServo;
extern IActuator*     g_actWetGlowFuel;

extern OilPressureLoop      g_ctrlOilLoop;
extern ThrottleSlew         g_ctrlThrottleSlew;
extern DynamicIdle          g_ctrlDynamicIdle;
extern PowerTurbineGovernor g_ctrlGovernor;

extern OilPrime      g_blkOilPrime;
extern StarterSpin   g_blkStarterSpin;
extern PreIgnSpark   g_blkPreIgnSpark;
extern FuelOpen      g_blkFuelOpen;
extern FlameConfirm  g_blkFlameConfirm;
extern TempConfirm   g_blkTempConfirm;
extern TimedDelay    g_blkTimedDelay;
extern FuelPumpIdle  g_blkFuelPumpIdle;
extern ModifiedIdle  g_blkModifiedIdle;
extern Spool         g_blkSpool;
extern SafetyHold    g_blkSafetyHold;
extern ImmediateCut  g_blkImmediateCut;
extern RPMDrop       g_blkRPMDrop;
extern CooldownSpin  g_blkCooldownSpin;
extern FinalStop     g_blkFinalStop;
extern IgniterOn     g_blkIgniterOn;    extern IgniterOff    g_blkIgniterOff;
extern FuelSolClose  g_blkFuelSolClose;
extern StarterEnOn   g_blkStarterEnOn;  extern StarterEnOff  g_blkStarterEnOff;
extern StarterOff    g_blkStarterOff;
extern OilPumpOn     g_blkOilPumpOn;    extern OilPumpOff    g_blkOilPumpOff;
extern CoolFanOn     g_blkCoolFanOn;    extern CoolFanOff    g_blkCoolFanOff;
extern AirstarterOn  g_blkAirstarterOn; extern AirstarterOff g_blkAirstarterOff;
extern ABPumpOn      g_blkABPumpOn;     extern ABPumpOff     g_blkABPumpOff;
extern ABIgnOn       g_blkABIgnOn;      extern ABIgnOff      g_blkABIgnOff;
extern ABSolOpen     g_blkABSolOpen;    extern ABSolClose    g_blkABSolClose;
extern OilScavengeOn  g_blkOilScavengeOn;
extern OilScavengeOff g_blkOilScavengeOff;
extern DrainValveOpen g_blkDrainValveOpen;
extern DrainValveClose g_blkDrainValveClose;
extern FuelPulse     g_blkFuelPulse;
extern WaitTOTCool   g_blkWaitTOTCool;
extern WaitForInput  g_blkWaitForInput;
extern WaitForInputOff g_blkWaitForInputOff;
extern ThrottleSet   g_blkThrottleSet;
extern PreHeat       g_blkPreHeat;
extern GlowPreheat   g_blkGlowPreheat;
extern BleedOpen     g_blkBleedOpen;
extern BleedClose    g_blkBleedClose;
extern FuelPumpRamp  g_blkFuelPumpRamp;
extern GovernorHold  g_blkGovernorHold;
extern FuelPump2Set  g_blkFuelPump2Set;
extern FuelPump2On   g_blkFuelPump2On;
extern FuelPump2Off  g_blkFuelPump2Off;
extern ABCheckReady  g_blkABCheckReady;
extern ABIgnite      g_blkABIgnite;
extern ABFlameConfirm g_blkABFlameConfirm;
extern ABStabilize   g_blkABStabilize;
extern SequenceEngine g_sequencer;
extern SequenceEngine g_abSequencer;
extern SafetyMonitor  g_safety;

// ============================================================
//  Hardware namespace — init / update functions called from main
// ============================================================

namespace Hardware {

    inline volatile uint16_t g_registryPulseCounts[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline unsigned long     g_registryPulseLastMs = 0;
    inline volatile uint16_t g_registryRcRiseUs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline volatile uint16_t g_registryRcPulseUs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline volatile uint8_t  g_registryRcFlags[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline uint16_t          g_registryRcLastMs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline volatile uint32_t g_registryPwmRiseUs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline volatile uint32_t g_registryPwmPeriodUs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline volatile uint32_t g_registryPwmHighUs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline volatile uint8_t  g_registryPwmFlags[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline uint32_t          g_registryPwmLastMs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    inline uint32_t          g_registryAnalogLastMs[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    static constexpr uint8_t MAX_REGISTRY_PCNT = 2;
    inline PCNTRpmSensor     g_registryPcnt[MAX_REGISTRY_PCNT] = {
        PCNTRpmSensor(-1, 1.0f, "REG_PCNT_1"), PCNTRpmSensor(-1, 1.0f, "REG_PCNT_2")
    };
    inline bool              g_pcntResourcePlanValid = true;
    inline int8_t            g_registryPcntSlot[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    static constexpr uint8_t MAX_REGISTRY_ONEWIRE = 4;
    inline DS18B20TempSensor g_registryDs18[MAX_REGISTRY_ONEWIRE] = {
        DS18B20TempSensor("REG_DS18_1"), DS18B20TempSensor("REG_DS18_2"),
        DS18B20TempSensor("REG_DS18_3"), DS18B20TempSensor("REG_DS18_4")
    };
    inline int8_t            g_registryDs18Slot[ChannelRegistry::MAX_INPUT_CHANNELS] = {};
    static constexpr uint8_t REG_RC_FRESH = 0x01;
    static constexpr uint8_t REG_RC_VALID = 0x02;
    static constexpr uint8_t REG_PWM_FRESH = 0x01;
    static constexpr uint8_t REG_PWM_VALID = 0x02;
    inline float             g_registryOilLoopPct[HardwareConfig::MAX_OIL_LOOPS] = {};
    inline uint32_t          g_registryOilLoopFailSinceMs[HardwareConfig::MAX_OIL_LOOPS] = {};
    inline bool              g_registryOilLoopFailArmed[HardwareConfig::MAX_OIL_LOOPS] = {};
    inline uint32_t          g_registryOilLoopLastMs = 0;

    inline float registryMappedInput(float raw, const ChannelRegistry::Channel& c) {
        float span = c.maxValue - c.minValue;
        return span > 0.0f ? constrain((raw - c.minValue) / span, 0.0f, 1.0f) : raw;
    }

    inline float registryAnalogPhysicalInput(float rawCounts, const ChannelRegistry::Channel& c) {
        if (!strcmp(c.role, "generic") || !strcmp(c.role, "operator") || !strcmp(c.role, "flame"))
            return c.inverted ? 1.0f - registryMappedInput(rawCounts, c) : registryMappedInput(rawCounts, c);
        if (!strcmp(c.role, "temperature") && c.temperatureInterface == 4) {
            if (rawCounts <= 0.0f || rawCounts >= 4095.0f || c.thermistorRFixed <= 0.0f ||
                c.thermistorR0 <= 0.0f || c.thermistorBeta <= 0.0f) return NAN;
            float resistance = c.thermistorPullup
                ? c.thermistorRFixed * rawCounts / (4095.0f - rawCounts)
                : c.thermistorRFixed * (4095.0f - rawCounts) / rawCounts;
            float invT = (1.0f / 298.15f) + logf(resistance / c.thermistorR0) / c.thermistorBeta;
            return (1.0f / invT) - 273.15f;
        }
        float mv = constrain(rawCounts, 0.0f, 4095.0f) * (3300.0f / 4095.0f);
        if (!strcmp(c.role, "voltage")) {
            float divider = c.analogDivider >= 1.0f ? c.analogDivider : 1.0f;
            return (mv / 1000.0f) * divider;
        }
        float scale = c.analogMvPerUnit > 0.0f ? c.analogMvPerUnit : 1000.0f;
        return (mv - c.analogZeroMv) / scale;
    }

    inline bool registryInputBoundTo(const ChannelRegistry::Channel& c, const char* key) {
        auto& reg = HardwareConfig::channelRegistry;
        const uint8_t count = min(reg.bindingCount, ChannelRegistry::MAX_BINDINGS);
        for (uint8_t i = 0; i < count; ++i)
            if (!strcmp(reg.bindings[i].key, key) && !strcmp(reg.bindings[i].channelId, c.id)) return true;
        return false;
    }

    inline uint8_t registryCoreInputKind(const ChannelRegistry::Channel& c) {
        if (c.driver == ChannelRegistry::Pulse &&
            (!strcmp(c.purpose, "n1_speed") || !strcmp(c.id, "n1_main") || !strcmp(c.id, "primary_n1") || registryInputBoundTo(c, "primary_n1"))) return 1;
        if (c.driver == ChannelRegistry::Pulse &&
            (!strcmp(c.purpose, "n2_speed") || !strcmp(c.id, "n2_main") || !strcmp(c.id, "primary_n2") || registryInputBoundTo(c, "primary_n2"))) return 2;
        if (c.driver == ChannelRegistry::Pulse &&
            (!strcmp(c.purpose, "fuel_flow") || !strcmp(c.id, "fuel_flow") || !strcmp(c.id, "fuel_flow_main"))) return 3;
        // RC operator inputs are owned by the existing failsafe-aware RCInput
        // implementation. Mirror them into the registry instead of attaching a
        // second GPIO interrupt handler to the same pin.
        if (c.driver == ChannelRegistry::RcPwm &&
            (!strcmp(c.purpose, "throttle") || registryInputBoundTo(c, "operator_throttle"))) return 4;
        if (c.driver == ChannelRegistry::RcPwm && !strcmp(c.purpose, "idle")) return 5;
        if (c.driver == ChannelRegistry::Analog &&
            (!strcmp(c.purpose, "oil_pressure") || !strcmp(c.id, "oil_pressure_main"))) return 6;
        // HX711 uses the dedicated timing-sensitive load-cell driver. Mirror
        // its calibrated result; never analogRead() the DOUT GPIO a second
        // time as though this were an analog torque transmitter.
        if (c.driver == ChannelRegistry::Analog && c.torqueInterface == 1 &&
            (!strcmp(c.purpose, "torque") || !strcmp(c.id, "torque_main"))) return 7;
        return 0;
    }

    // A registry card can replace a legacy singleton sensor with a calibrated
    // analog transmitter.  Keep the lookup deliberately exact: a second,
    // unrelated pressure or temperature card must never silently become a
    // primary engine input merely because it shares the same semantic role.
    inline int8_t registryAnalogInputIndex(const char* id, const char* binding = nullptr, const char* purpose = nullptr) {
        auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.inputCount; ++i) {
            const auto& c = reg.inputs[i];
            const bool localAnalog = c.driver == ChannelRegistry::Analog && c.pin >= 0;
            const bool remoteAnalog = c.driver == ChannelRegistry::I2cAnalog;
            if (!c.installed || (!localAnalog && !remoteAnalog) || c.temperatureInterface != 0) continue;
            if ((id && !strcmp(c.id, id)) || (binding && registryInputBoundTo(c, binding)) ||
                (purpose && !strcmp(c.purpose, purpose)))
                return (int8_t)i;
        }
        return -1;
    }

    // Non-ADC temperature interfaces are read by the dedicated temperature
    // drivers. Keep their registry cards live by mirroring the resulting °C
    // reading back into the same per-card telemetry path.
    inline int8_t registrySpecialTemperatureIndex(const char* id, const char* purpose = nullptr) {
        auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.inputCount; ++i) {
            const auto& c = reg.inputs[i];
            if (c.installed && ((!strcmp(c.id, id)) || (purpose && !strcmp(c.purpose, purpose))) && !strcmp(c.role, "temperature") &&
                c.temperatureInterface != 0) return (int8_t)i;
        }
        return -1;
    }

    inline int8_t registryPurposeInputIndex(const char* purpose, const char* binding = nullptr) {
        auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.inputCount; ++i) {
            const auto& c = reg.inputs[i];
            const bool remote = c.driver == ChannelRegistry::I2cDigital ||
                                c.driver == ChannelRegistry::I2cAnalog ||
                                c.driver == ChannelRegistry::I2cLoadCell;
            if (!c.installed || (!remote && c.pin < 0)) continue;
            if ((purpose && !strcmp(c.purpose, purpose)) || (binding && registryInputBoundTo(c, binding)))
                return (int8_t)i;
        }
        return -1;
    }

    inline int8_t registryPurposeOutputIndex(const char* purpose) {
        auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            const auto& c = reg.outputs[i];
            const bool remote = c.driver == ChannelRegistry::I2cRelay;
            if (c.installed && (remote || c.pin >= 0) &&
                purpose && !strcmp(c.purpose, purpose))
                return (int8_t)i;
        }
        return -1;
    }

    inline void mirrorCoreRegistryInput(uint8_t i, uint8_t kind, EngineData& ed) {
        if (kind == 1) { ed.registryInputValue[i] = ed.n1Rpm; ed.registryInputHealthy[i] = ed.n1Healthy; }
        else if (kind == 2) { ed.registryInputValue[i] = ed.n2Rpm; ed.registryInputHealthy[i] = ed.n2Healthy; }
        else if (kind == 3) { ed.registryInputValue[i] = ed.fuelFlow; ed.registryInputHealthy[i] = ed.fuelFlowHealthy; }
        else if (kind == 4) {
            const auto& c = HardwareConfig::channelRegistry.inputs[i];
            ed.registryInputValue[i] = c.inverted ? 1.0f - ed.rcThrottleNorm : ed.rcThrottleNorm;
            ed.registryInputHealthy[i] = ed.rcThrottleValid;
        } else if (kind == 5) {
            const auto& c = HardwareConfig::channelRegistry.inputs[i];
            ed.registryInputValue[i] = c.inverted ? 1.0f - ed.rcIdleNorm : ed.rcIdleNorm;
            ed.registryInputHealthy[i] = ed.rcIdleValid;
        } else if (kind == 6) {
            ed.registryInputValue[i] = ed.oilPressure;
            ed.registryInputHealthy[i] = ed.oilHealthy;
        } else if (kind == 7) {
            ed.registryInputValue[i] = ed.torque;
            ed.registryInputHealthy[i] = ed.torqueHealthy;
        }
    }

    static void IRAM_ATTR registryPulseIsr(void* arg) {
        uint8_t idx = (uint8_t)(uintptr_t)arg;
        g_registryPulseCounts[idx] = g_registryPulseCounts[idx] + 1;
    }

    static void IRAM_ATTR registryRcIsr(void* arg) {
        uint8_t idx = (uint8_t)(uintptr_t)arg;
        int pin = HardwareConfig::channelRegistry.inputs[idx].pin;
        if (digitalRead(pin) == HIGH) {
            g_registryRcRiseUs[idx] = (uint16_t)micros();
        } else {
            uint16_t pw = (uint16_t)micros() - g_registryRcRiseUs[idx];
            if (pw >= 500 && pw <= 2500) {
                g_registryRcPulseUs[idx] = pw;
                g_registryRcFlags[idx] |= REG_RC_FRESH;
            }
        }
    }

    static void IRAM_ATTR registryPwmDutyIsr(void* arg) {
        uint8_t idx = (uint8_t)(uintptr_t)arg;
        int pin = HardwareConfig::channelRegistry.inputs[idx].pin;
        uint32_t now = micros();
        if (digitalRead(pin) == HIGH) {
            uint32_t previous = g_registryPwmRiseUs[idx];
            if (previous) g_registryPwmPeriodUs[idx] = now - previous;
            g_registryPwmRiseUs[idx] = now;
        } else {
            uint32_t rise = g_registryPwmRiseUs[idx];
            uint32_t period = g_registryPwmPeriodUs[idx];
            if (rise && period) {
                uint32_t high = now - rise;
                if (high <= period) {
                    g_registryPwmHighUs[idx] = high;
                    g_registryPwmFlags[idx] |= REG_PWM_FRESH;
                }
            }
        }
    }

    inline void initRegistryInputs() {
        auto& reg = HardwareConfig::channelRegistry;
        auto& ed = EngineData::instance();
        uint8_t ds18Count = 0;
        uint8_t pcntCount = 0;
        for (uint8_t i = 0; i < reg.inputCount; ++i) {
            const auto& c = reg.inputs[i];
            ed.registryInputValue[i] = 0.0f;
            g_registryDs18Slot[i] = -1;
            g_registryPcntSlot[i] = -1;
            if (c.driver == ChannelRegistry::I2cDigital ||
                c.driver == ChannelRegistry::I2cAnalog ||
                c.driver == ChannelRegistry::I2cLoadCell) {
                ed.registryInputHealthy[i] = false;
                continue;
            }
            const bool singletonOilTemperature = !strcmp(c.id, "oil_temperature") || !strcmp(c.purpose, "oil_temperature");
            if (!strcmp(c.role, "temperature") && c.temperatureInterface == 5 && !singletonOilTemperature) {
                if (c.installed && c.pin >= 0 && ds18Count < MAX_REGISTRY_ONEWIRE) {
                    g_registryDs18Slot[i] = (int8_t)ds18Count;
                    g_registryDs18[ds18Count++].begin(c.pin, c.temperatureResolution);
                }
                ed.registryInputHealthy[i] = false;
                continue;
            }
            if (!strcmp(c.role, "temperature") && c.temperatureInterface != 0 &&
                (c.temperatureInterface != 4 || singletonOilTemperature)) {
                // Thermocouple, NTC and OneWire inputs are sampled by their
                // dedicated drivers in updateSensors(), not analogRead().
                ed.registryInputHealthy[i] = false;
                continue;
            }
            if (registryCoreInputKind(c)) {
                ed.registryInputHealthy[i] = false;
                continue;
            }
            if (c.installed && c.pin >= 0 && c.driver == ChannelRegistry::Pulse &&
                !strcmp(c.role, "speed")) {
                if (g_pcntResourcePlanValid && pcntCount < MAX_REGISTRY_PCNT) {
                    g_registryPcntSlot[i] = (int8_t)pcntCount;
                    // The hardware page no longer asks hobbyists for a second,
                    // unrelated "sensor maximum".  PCNT plausibility follows
                    // the applicable hard shutdown and leaves 2x headroom so
                    // it catches impossible signals without restricting use.
                    float hardLimit = Config::rpmLimit;
                    if (!strcmp(c.purpose, "n2_speed") || !strcmp(c.id, "n2_main"))
                        hardLimit = Config::n2RpmLimit > 0.0f ? Config::n2RpmLimit : Config::rpmLimit;
                    if (!isfinite(hardLimit) || hardLimit <= 0.0f) hardLimit = 60000.0f;
                    g_registryPcnt[pcntCount].rpmLimit = hardLimit * 2.0f;
                    g_registryPcnt[pcntCount++].begin(c.pin, c.pulsesPerUnit);
                }
                ed.registryInputHealthy[i] = false;
                continue;
            }
            ed.registryInputHealthy[i] = c.installed && c.pin >= 0 &&
                (c.driver == ChannelRegistry::Digital || c.driver == ChannelRegistry::Analog ||
                 c.driver == ChannelRegistry::Pulse || c.driver == ChannelRegistry::RcPwm ||
                 c.driver == ChannelRegistry::PwmDuty);
            if (c.driver == ChannelRegistry::Analog) g_registryAnalogLastMs[i] = 0;
            if (!ed.registryInputHealthy[i]) continue;
            uint8_t inputMode = c.pullup ? INPUT_PULLUP : (c.pulldown ? INPUT_PULLDOWN : INPUT);
            if (c.driver == ChannelRegistry::Digital) {
                pinMode(c.pin, inputMode);
            } else if (c.driver == ChannelRegistry::Pulse) {
                g_registryPulseCounts[i] = 0;
                g_registryPulseLastMs = millis();
                ed.registryInputHealthy[i] = false;
                pinMode(c.pin, inputMode);
                attachInterruptArg(digitalPinToInterrupt(c.pin), registryPulseIsr, (void*)(uintptr_t)i, RISING);
            } else if (c.driver == ChannelRegistry::RcPwm) {
                g_registryRcRiseUs[i] = 0;
                g_registryRcPulseUs[i] = 0;
                g_registryRcFlags[i] = 0;
                g_registryRcLastMs[i] = 0;
                pinMode(c.pin, inputMode);
                attachInterruptArg(digitalPinToInterrupt(c.pin), registryRcIsr, (void*)(uintptr_t)i, CHANGE);
                ed.registryInputHealthy[i] = false;
            } else if (c.driver == ChannelRegistry::PwmDuty) {
                g_registryPwmRiseUs[i] = 0;
                g_registryPwmPeriodUs[i] = 0;
                g_registryPwmHighUs[i] = 0;
                g_registryPwmFlags[i] = 0;
                g_registryPwmLastMs[i] = 0;
                pinMode(c.pin, inputMode);
                attachInterruptArg(digitalPinToInterrupt(c.pin), registryPwmDutyIsr, (void*)(uintptr_t)i, CHANGE);
                ed.registryInputHealthy[i] = false;
            }
        }
    }

    inline void updateRegistryPulseInput(uint8_t i, const ChannelRegistry::Channel& c, EngineData& ed, bool sample, unsigned long dt) {
        if (sample) {
            uint16_t count;
            noInterrupts();
            count = g_registryPulseCounts[i];
            g_registryPulseCounts[i] = 0;
            interrupts();
            float hz = (float)count * 1000.0f / (float)dt;
            float value = hz;
            if (!strcmp(c.role, "speed")) {
                float ppr = c.pulsesPerUnit > 0.0f ? c.pulsesPerUnit : 1.0f;
                value = hz * 60.0f / ppr;
            } else if (!strcmp(c.role, "flow")) {
                float ppl = c.pulsesPerUnit > 0.0f ? c.pulsesPerUnit : 1.0f;
                value = hz * 60.0f / ppl;
            }
            if (!strcmp(c.role, "speed") || !strcmp(c.role, "flow")) {
                ed.registryInputValue[i] = value;
            } else {
                float normalized = registryMappedInput(value, c);
                ed.registryInputValue[i] = c.inverted ? 1.0f - normalized : normalized;
            }
            ed.registryInputHealthy[i] = true;
        }
    }

    inline void updateRegistryRcInput(uint8_t i, const ChannelRegistry::Channel& c, EngineData& ed) {
        unsigned long now = millis();
        uint8_t flags;
        uint32_t pulseUs;
        noInterrupts();
        flags = g_registryRcFlags[i];
        pulseUs = g_registryRcPulseUs[i];
        g_registryRcFlags[i] = flags & ~REG_RC_FRESH;
        interrupts();

        if (flags & REG_RC_FRESH) {
            g_registryRcLastMs[i] = (uint16_t)now;
            flags |= REG_RC_VALID;
            g_registryRcFlags[i] |= REG_RC_VALID;
        } else if ((flags & REG_RC_VALID) &&
                   (uint16_t)((uint16_t)now - g_registryRcLastMs[i]) > (uint16_t)Config::rcFailsafeMs) {
            flags &= ~REG_RC_VALID;
            g_registryRcFlags[i] &= ~REG_RC_VALID;
        }

        float minUs = (c.minValue >= 500.0f && c.minValue <= 2500.0f) ? c.minValue : 1000.0f;
        float maxUs = (c.maxValue >= 500.0f && c.maxValue <= 2500.0f && c.maxValue > minUs) ? c.maxValue : 2000.0f;
        float span = maxUs - minUs;
        ed.registryInputValue[i] = (flags & REG_RC_VALID) ? constrain(((float)pulseUs - minUs) / span, 0.0f, 1.0f) : 0.0f;
        if ((flags & REG_RC_VALID) && c.inverted) ed.registryInputValue[i] = 1.0f - ed.registryInputValue[i];
        ed.registryInputHealthy[i] = flags & REG_RC_VALID;
    }

    inline void updateRegistryPwmDutyInput(uint8_t i, const ChannelRegistry::Channel& c, EngineData& ed) {
        unsigned long now = millis();
        uint8_t flags;
        uint32_t highUs, periodUs;
        noInterrupts();
        flags = g_registryPwmFlags[i];
        highUs = g_registryPwmHighUs[i];
        periodUs = g_registryPwmPeriodUs[i];
        g_registryPwmFlags[i] = flags & ~REG_PWM_FRESH;
        interrupts();
        if ((flags & REG_PWM_FRESH) && periodUs > 0) {
            g_registryPwmLastMs[i] = now;
            flags |= REG_PWM_VALID;
            g_registryPwmFlags[i] |= REG_PWM_VALID;
        } else if ((flags & REG_PWM_VALID) && now - g_registryPwmLastMs[i] > (unsigned long)Config::rcFailsafeMs) {
            flags &= ~REG_PWM_VALID;
            g_registryPwmFlags[i] &= ~REG_PWM_VALID;
        }
        float duty = periodUs > 0 ? constrain((float)highUs / (float)periodUs, 0.0f, 1.0f) : 0.0f;
        float normalized = registryMappedInput(duty, c);
        ed.registryInputValue[i] = (flags & REG_PWM_VALID) ? (c.inverted ? 1.0f - normalized : normalized) : 0.0f;
        ed.registryInputHealthy[i] = flags & REG_PWM_VALID;
    }

    inline void updateRegistryInputs() {
        auto& reg = HardwareConfig::channelRegistry;
        auto& ed = EngineData::instance();
        unsigned long now = millis();
        unsigned long pulseDt = now - g_registryPulseLastMs;
        bool samplePulse = pulseDt >= 100UL;
        const uint8_t inputCount = min(reg.inputCount, ChannelRegistry::MAX_INPUT_CHANNELS);
        for (uint8_t i = 0; i < inputCount; ++i) {
            const auto& c = reg.inputs[i];
            if (c.driver == ChannelRegistry::I2cDigital ||
                c.driver == ChannelRegistry::I2cAnalog ||
                c.driver == ChannelRegistry::I2cLoadCell) {
                float value = 0.0f; int32_t raw = 0; uint32_t seq = 0, sampleMs = 0;
                ed.registryInputHealthy[i] = I2CDeviceManager::input(i, value, raw, seq, sampleMs);
                if (ed.registryInputHealthy[i]) {
                    ed.registryInputValue[i] = value;
                    g_registryAnalogLastMs[i] = sampleMs;
                }
                continue;
            }
            uint8_t coreKind = registryCoreInputKind(c);
            if (coreKind) {
                mirrorCoreRegistryInput(i, coreKind, ed);
                continue;
            }
            if (!c.installed || c.pin < 0) {
                ed.registryInputHealthy[i] = false;
                continue;
            }
            if (!strcmp(c.role, "temperature") && c.temperatureInterface == 5 && g_registryDs18Slot[i] >= 0) {
                auto& sensor = g_registryDs18[(uint8_t)g_registryDs18Slot[i]];
                sensor.update();
                ed.registryInputValue[i] = sensor.getValue();
                ed.registryInputHealthy[i] = sensor.isHealthy();
                continue;
            }
            if (c.driver == ChannelRegistry::Pulse && g_registryPcntSlot[i] >= 0) {
                auto& sensor = g_registryPcnt[(uint8_t)g_registryPcntSlot[i]];
                sensor.update();
                ed.registryInputValue[i] = sensor.getValue();
                ed.registryInputHealthy[i] = sensor.isHealthy();
                continue;
            }
            const bool singletonOilTemperature = !strcmp(c.id, "oil_temperature") || !strcmp(c.purpose, "oil_temperature");
            if (!strcmp(c.role, "temperature") && c.temperatureInterface != 0 &&
                (c.temperatureInterface != 4 || singletonOilTemperature)) {
                ed.registryInputHealthy[i] = false;
                continue;
            }
            if (c.driver == ChannelRegistry::Digital) {
                bool high = digitalRead(c.pin) == HIGH;
                ed.registryInputValue[i] = (c.activeHigh ? high : !high) ? 1.0f : 0.0f;
                ed.registryInputHealthy[i] = true;
            } else if (c.driver == ChannelRegistry::Analog) {
                if (now - g_registryAnalogLastMs[i] < 10UL) continue;
                g_registryAnalogLastMs[i] = now;
                delay(0);
                int raw = analogRead(c.pin);
                delay(0);
                ed.registryInputValue[i] = registryAnalogPhysicalInput((float)raw, c);
                ed.registryInputHealthy[i] = isfinite(ed.registryInputValue[i]) &&
                                             raw >= c.minValue && raw <= c.maxValue;
            } else if (c.driver == ChannelRegistry::Pulse) {
                updateRegistryPulseInput(i, c, ed, samplePulse, pulseDt);
            } else if (c.driver == ChannelRegistry::RcPwm) {
                updateRegistryRcInput(i, c, ed);
            } else if (c.driver == ChannelRegistry::PwmDuty) {
                updateRegistryPwmDutyInput(i, c, ed);
            } else {
                ed.registryInputHealthy[i] = false;
            }
        }
        if (samplePulse) g_registryPulseLastMs = now;
    }

    inline bool registryOutputOwnsCorePurpose(const ChannelRegistry::Channel& c) {
        return HardwareConfig::channelRegistry.ownsCoreOutput(c);
    }

    inline bool i2cOutputAffectsEngine(const ChannelRegistry::Channel& c) {
        if (!c.installed || c.driver != ChannelRegistry::I2cRelay) return false;
        const char* p = c.purpose;
        return !strcmp(p, "main_fuel") || !strcmp(p, "fuel_shutoff") ||
               !strcmp(p, "starter") || !strcmp(p, "starter_enable") ||
               !strcmp(p, "igniter") || !strcmp(p, "ab_igniter") ||
               !strcmp(p, "ab_valve") || !strcmp(p, "air_starter") ||
               !strcmp(p, "oil_pump") || !strcmp(p, "scavenge_pump") ||
               !strcmp(p, "fuel_pump") || !strcmp(p, "ab_pump") ||
               !strcmp(p, "glow_plug") || !strcmp(p, "pilot_fuel") ||
               !strcmp(p, "wet_glow_fuel");
    }

    inline const ChannelRegistry::Channel* unavailableEngineI2cOutput() {
        const auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            const auto& c = reg.outputs[i];
            if (i2cOutputAffectsEngine(c) && !I2CDeviceManager::channelAvailable(c))
                return &c;
        }
        return nullptr;
    }

    inline const ChannelRegistry::Channel* registryStarterEnableOutput() {
        const auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.outputCount; ++i)
            if (reg.outputs[i].installed && !strcmp(reg.outputs[i].purpose, "starter_enable"))
                return &reg.outputs[i];
        return nullptr;
    }

    inline const ChannelRegistry::Channel* registryAirStarterOutput() {
        const auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.outputCount; ++i)
            if (reg.outputs[i].installed && !strcmp(reg.outputs[i].purpose, "air_starter"))
                return &reg.outputs[i];
        return nullptr;
    }

    inline bool registryOutputManaged(const ChannelRegistry::Channel& c) {
        if (c.installed && c.driver == ChannelRegistry::I2cRelay) return true;
        const bool proportionalStarterEnable = !strcmp(c.purpose, "starter_enable") && c.driver != ChannelRegistry::Relay;
        const bool proportionalAirStarter = !strcmp(c.purpose, "air_starter") && c.driver != ChannelRegistry::Relay;
        return c.installed && c.pin >= 0 &&
               (proportionalStarterEnable || proportionalAirStarter ||
               !ChannelRegistry::isCoreManagedOutputId(c.id) &&
               !registryOutputOwnsCorePurpose(c) &&
               !HardwareConfig::channelRegistry.boundToCoreOutput(c));
    }

    inline float registryPurposeMinimum(const char* purpose, float demand) {
        if (demand <= 0.0f) return 0.0f;
        auto& reg = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            const auto& c = reg.outputs[i];
            if (c.installed && !strcmp(c.purpose, purpose))
                return fmaxf(demand, constrain(c.minimumRunDemand, 0.0f, 1.0f));
        }
        return demand;
    }

    inline void writeRegistryOutput(const ChannelRegistry::Channel& c, float demand) {
        if (!registryOutputManaged(c)) return;
        demand = constrain(demand, 0.0f, 1.0f);
        if (demand > 0.0f) demand = fmaxf(demand, constrain(c.minimumRunDemand, 0.0f, 1.0f));
        float driveDemand = c.inverted ? 1.0f - demand : demand;
        if (c.driver == ChannelRegistry::I2cRelay) {
            I2CDeviceManager::writeOutput(c, demand);
        } else if (c.driver == ChannelRegistry::Relay) {
            digitalWrite(c.pin, driveDemand >= 0.5f ? HIGH : LOW);
        } else if (c.driver == ChannelRegistry::Pwm) {
            float minDuty = constrain(c.minValue, 0.0f, 1.0f);
            float maxDuty = constrain(c.maxValue, 0.0f, 1.0f);
            if (maxDuty < minDuty) maxDuty = minDuty;
            float dutyDemand = minDuty + (maxDuty - minDuty) * driveDemand;
            const uint8_t bits = constrain(c.pwmResolution, 8, 14);
            const uint32_t dutyMax = (1UL << bits) - 1UL;
            uint32_t duty = (uint32_t)(dutyDemand * dutyMax + 0.5f);
            ledcWrite(c.pin, duty);
        } else if (c.driver == ChannelRegistry::Servo) {
            float minUs = (c.minValue >= 500.0f && c.minValue <= 2500.0f) ? c.minValue : 1000.0f;
            float maxUs = (c.maxValue >= 500.0f && c.maxValue <= 2500.0f && c.maxValue > minUs)
                        ? c.maxValue : 2000.0f;
            float us = minUs + (maxUs - minUs) * driveDemand;
            uint32_t duty = (uint32_t)(us * 16383.0f / 20000.0f + 0.5f);
            ledcWrite(c.pin, duty);
        }
    }

    inline void initRegistryOutputs(float fallbackDemand) {
        auto& reg = HardwareConfig::channelRegistry;
        auto& ed = EngineData::instance();
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            const auto& c = reg.outputs[i];
            if (!registryOutputManaged(c)) continue;
            ed.registryOutputDemand[i] = constrain(c.safeDemand, 0.0f, 1.0f);
            if (c.driver == ChannelRegistry::I2cRelay) {
                // The manager wrote the configured safe latch before changing
                // the TCA9554 direction register.
            } else if (c.driver == ChannelRegistry::Relay) {
                pinMode(c.pin, OUTPUT);
            } else if (c.driver == ChannelRegistry::Pwm) {
                const uint32_t freq = c.pwmTimingConfigured ? constrain(c.pwmFrequency, 1U, 100000U) : 5000U;
                const uint8_t bits = c.pwmTimingConfigured ? constrain(c.pwmResolution, 8, 14) : 10;
                if (!ledcAttach(c.pin, freq, bits)) {
                    ed.hardwareReady = false;
                    snprintf(ed.hardwareFault, sizeof(ed.hardwareFault), "Registry PWM attach failed: %s", c.id);
                }
            } else if (c.driver == ChannelRegistry::Servo) {
                if (!ledcAttach(c.pin, 50, 14)) {
                    ed.hardwareReady = false;
                    snprintf(ed.hardwareFault, sizeof(ed.hardwareFault), "Registry servo attach failed: %s", c.id);
                }
            }
            writeRegistryOutput(c, fallbackDemand >= 0.0f ? fallbackDemand : c.safeDemand);
        }
    }

    inline void updateRegistryOutputs() {
        auto& reg = HardwareConfig::channelRegistry;
        auto& hw = HardwareConfig::instance();
        auto& ed = EngineData::instance();
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            const auto& c = reg.outputs[i];
            const bool wetGlowOwned =
                !strcmp(c.purpose, "wet_glow_fuel") ||
                (!strcmp(c.purpose, "pilot_fuel") &&
                 hw.hasGlowPlug && hw.glowPlugType == 2);
            if (wetGlowOwned)
                ed.registryOutputDemand[i] = constrain(ed.wetGlowFuelDemand, 0.0f, 1.0f);
            if (c.driver == ChannelRegistry::I2cRelay) {
                if (!strcmp(c.purpose, "fuel_shutoff")) ed.registryOutputDemand[i] = ed.fuelSolOpen ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "starter")) ed.registryOutputDemand[i] = ed.starterDemand > 0.001f ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "starter_enable")) ed.registryOutputDemand[i] = ed.starterEnabled ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "oil_pump")) ed.registryOutputDemand[i] = ed.oilPumpPct > 0.1f ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "igniter")) ed.registryOutputDemand[i] = ed.igniterOn ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "ab_igniter")) ed.registryOutputDemand[i] = ed.igniter2On ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "ab_valve")) ed.registryOutputDemand[i] = ed.abSolOpen ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "air_starter")) ed.registryOutputDemand[i] = ed.airstarterOpen ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "cooling_fan")) ed.registryOutputDemand[i] = ed.coolFanOn ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "scavenge_pump")) ed.registryOutputDemand[i] = ed.oilScavengeOn ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "fuel_pump")) ed.registryOutputDemand[i] = ed.fuelPump2Demand > 0.001f ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "ab_pump")) ed.registryOutputDemand[i] = ed.abPumpDemand > 0.001f ? 1.0f : 0.0f;
                else if (!strcmp(c.purpose, "glow_plug")) ed.registryOutputDemand[i] = ed.glowPlugDemand >= 0.5f ? 1.0f : 0.0f;
            }
            if (!strcmp(c.purpose, "starter_enable") && c.driver != ChannelRegistry::Relay)
                ed.registryOutputDemand[i] = ed.starterEnabled ? 1.0f : 0.0f;
            if (!strcmp(c.purpose, "air_starter") && c.driver != ChannelRegistry::Relay)
                ed.registryOutputDemand[i] = ed.airstarterOpen ? 1.0f : 0.0f;
            writeRegistryOutput(c, ed.registryOutputDemand[i]);
            if (c.hasCurrent && c.currentPin >= 0) {
                int raw = analogRead(c.currentPin);
                float volts = (float)raw * 3.3f / 4095.0f;
                float mvPerA = c.currentMvPerA > 0.0f ? c.currentMvPerA : 100.0f;
                ed.registryOutputCurrentAmps[i] = (volts - constrain(c.currentZeroV, 0.0f, 3.3f)) * 1000.0f / mvPerA;
                ed.registryOutputCurrentHealthy[i] = raw > 10 && raw < 4085;
            } else {
                ed.registryOutputCurrentAmps[i] = 0.0f;
                ed.registryOutputCurrentHealthy[i] = false;
            }
        }
    }

    inline void applyFaultSafeOutputs() {
        auto& reg = HardwareConfig::channelRegistry;
        auto& ed = EngineData::instance();
        if (!ed.faultShutdownActive) return;
        // Turboprop fail-safe: coarse pitch adds load to the free turbine and
        // opposes overspeed. This semantic demand is applied before per-channel
        // inversion, so installation wiring can still be calibrated correctly.
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            const auto& c = reg.outputs[i];
            if (!c.installed || !c.forceSafeOnFault) continue;
            const bool core = reg.ownsCoreOutput(c) || reg.boundToCoreOutput(c);
            // Engine actuators have a fixed Off power-on state. General-purpose
            // outputs may use their explicitly configured power-on demand.
            const float safe = core ? 0.0f : constrain(c.safeDemand, 0.0f, 1.0f);
            ed.registryOutputDemand[i] = safe;
            const char* p = c.purpose;
            if (!strcmp(p, "main_fuel")) {
                ed.throttleDemand = safe; ed.abFuelOffset = 0.0f;
            } else if (!strcmp(p, "fuel_shutoff")) {
                ed.fuelSolOpen = safe >= 0.5f;
            } else if (!strcmp(p, "starter")) {
                ed.starterDemand = safe;
            } else if (!strcmp(p, "starter_enable")) {
                ed.starterEnabled = safe >= 0.5f;
            } else if (!strcmp(p, "oil_pump")) {
                ed.oilPumpPct = safe * 100.0f;
            } else if (!strcmp(p, "scavenge_pump")) {
                ed.oilScavengeDemand = safe; ed.oilScavengeOn = safe > 0.001f;
            } else if (!strcmp(p, "cooling_fan")) {
                ed.coolFanDemand = safe; ed.coolFanOn = safe > 0.001f;
            } else if (!strcmp(p, "fuel_pump")) {
                ed.fuelPump2Demand = safe;
            } else if (!strcmp(p, "igniter")) {
                ed.igniterOn = safe >= 0.5f;
            } else if (!strcmp(p, "ab_igniter")) {
                ed.igniter2On = safe >= 0.5f;
            } else if (!strcmp(p, "ab_valve")) {
                ed.abSolOpen = safe >= 0.5f;
            } else if (!strcmp(p, "glow_plug")) {
                ed.glowPlugDemand = safe;
            } else if (!strcmp(p, "ab_pump")) {
                ed.abPumpDemand = safe;
            } else if (!strcmp(p, "prop_pitch")) {
                ed.propPitchDemand = safe;
            } else if (!strcmp(p, "air_starter")) {
                ed.airstarterOpen = safe >= 0.5f;
            } else if (!strcmp(p, "bleed_valve")) {
                ed.bleedValveDemand = safe; ed.bleedValveOpen = safe >= 0.5f;
            }
        }
        // This turbine-specific invariant overrides even a generic per-output
        // fault-safe demand: pitch feedback/control failure must add load.
        if (HardwareConfig::hasPropPitch) ed.propPitchDemand = 1.0f;
    }

    inline bool registryCombustionPurpose(const char* purpose) {
        return !strcmp(purpose, "main_fuel") || !strcmp(purpose, "fuel_shutoff") ||
               !strcmp(purpose, "fuel_pump") || !strcmp(purpose, "pilot_fuel") ||
               !strcmp(purpose, "igniter") || !strcmp(purpose, "ab_igniter") ||
               !strcmp(purpose, "ab_valve") || !strcmp(purpose, "ab_pump") ||
               !strcmp(purpose, "glow_plug") || !strcmp(purpose, "wet_glow_fuel");
    }

    inline bool registryStarterPurpose(const char* purpose) {
        return !strcmp(purpose, "starter") || !strcmp(purpose, "starter_enable") ||
               !strcmp(purpose, "air_starter");
    }

    inline void cutRegistryHazardousDemands(bool includeStarter = true) {
        auto& reg = HardwareConfig::channelRegistry;
        auto& ed = EngineData::instance();
        for (uint8_t i = 0; i < reg.outputCount; ++i)
            if (registryCombustionPurpose(reg.outputs[i].purpose) ||
                (includeStarter && registryStarterPurpose(reg.outputs[i].purpose)))
                ed.registryOutputDemand[i] = 0.0f;
    }

    inline void applyShutdownCombustionInvariant() {
        auto& ed = EngineData::instance();
        if (ed.mode != SysMode::SHUTDOWN) return;
        ed.throttleDemand = 0.0f;
        ed.abFuelOffset = 0.0f;
        ed.fuelSolOpen = false;
        ed.fuelPump2Demand = 0.0f;
        ed.igniterOn = false;
        ed.igniter2On = false;
        ed.glowPlugDemand = 0.0f;
        ed.wetGlowFuelDemand = 0.0f;
        ed.abSolOpen = false;
        ed.abPumpDemand = 0.0f;
        const bool immediateCut = strcmp(ed.currentBlock, "ImmediateCut") == 0;
        if (immediateCut) {
            // Neutralise simultaneous actions attached to the hard-cut block,
            // including registry-defined secondary starter channels. Later
            // cooldown blocks may intentionally re-enable a starter.
            ed.starterDemand = 0.0f;
            ed.starterEnabled = false;
            ed.airstarterOpen = false;
        }
        cutRegistryHazardousDemands(immediateCut);
    }

    inline void faultRegistryOutputs() {
        auto& reg = HardwareConfig::channelRegistry;
        auto& ed = EngineData::instance();
        for (uint8_t i = 0; i < reg.outputCount; ++i) {
            if (!registryOutputManaged(reg.outputs[i])) continue;
            // Final STANDBY is always fully off. Per-output fault overrides
            // are applied separately while the shutdown sequence is running.
            ed.registryOutputDemand[i] = 0.0f;
            writeRegistryOutput(reg.outputs[i], ed.registryOutputDemand[i]);
        }
    }

    inline void applyCurrentSensorCal(AnalogLinearSensor& sensor, float zeroV, float mvPerA) {
        float safeZeroV = constrain(zeroV, 0.0f, 3.3f);
        float safeMvPerA = mvPerA > 0.0f ? mvPerA : 100.0f;
        float zeroAdc = (safeZeroV / 3.3f) * 4095.0f;
        float adcPerAmp = safeMvPerA / (3300.0f / 4095.0f);
        sensor.setCal({ zeroAdc, zeroAdc + adcPerAmp * 50.0f, 0.0f, 50.0f });
    }

    // ── Apply config values to block/controller instances ────
    inline void applyConfig() {
        // Startup blocks
        g_blkOilPrime.timeoutMs           = Config::startupOilArmTimeoutMs;
        g_blkOilPrime.oilArmMinBar        = Config::oilStartupMinBar;
        g_blkOilPrime.startupOilDemand    = Config::oilStartupPressure;
        g_blkOilPrime.startupOilPct       = Config::oilStartupPct;
        g_blkStarterSpin.starterDemand    = Config::starterDemand / 100.0f;
        g_blkStarterSpin.targetRpm        = Config::preIgnRpm;
        g_blkStarterSpin.timeoutMs        = (unsigned long)Config::starterTimeoutMs;
        g_blkStarterSpin.oilStartupMinBar = Config::oilStartupMinBar;
        g_blkStarterSpin.rampPctPerSec    = Config::starterStartupRampPctPerSec;
        g_blkStarterSpin.assistEnabled    = Config::starterAssistEnabled &&
                                             HardwareConfig::hasStarter &&
                                             HardwareConfig::starterType != 2 &&
                                             HardwareConfig::hasN1Rpm;
        g_blkStarterSpin.assistDemand     = Config::starterAssistPwmPct / 100.0f;
        g_blkStarterSpin.assistUntilRpm   = Config::starterAssistUntilRpm;
        g_blkStarterSpin.assistOnMs       = Config::starterAssistOnMs;
        g_blkStarterSpin.assistOffMs      = Config::starterAssistOffMs;
        g_blkPreIgnSpark.sparkMs          = Config::preIgnSparkMs;
        g_blkTempConfirm.tempTarget       = Config::tempConfirmTarget;
        g_blkTempConfirm.timeoutMs        = (unsigned long)Config::tempConfirmTimeoutMs;
        g_blkWaitForInput.channelIdx      = Config::waitForInputChannel;
        g_blkWaitForInput.expectedState   = Config::waitForInputExpected;
        g_blkWaitForInput.timeoutMs       = (unsigned long)Config::waitForInputTimeoutMs;
        g_blkWaitForInputOff.channelIdx   = Config::waitForInputChannel;
        g_blkWaitForInputOff.expectedState= false;
        g_blkWaitForInputOff.timeoutMs    = (unsigned long)Config::waitForInputTimeoutMs;
        g_blkFlameConfirm.timeoutMs           = Config::flameTimeoutMs;
        g_blkFlameConfirm.checkIntervalMs     = Config::flameCheckIntervalMs;
        g_blkFlameConfirm.requiredCount       = Config::flameRequiredCount;
        g_blkFlameConfirm.turnOffIgniterOnExit= Config::flameConfirmTurnOffIgniter;
        g_blkTimedDelay.dwellMs               = (unsigned long)Config::timedDelayMs;
        g_blkFuelPulse.pulseMs               = (unsigned long)Config::fuelPulsePulseMs;
        g_blkFuelPulse.offMs                 = (unsigned long)Config::fuelPulseOffMs;
        g_blkWaitTOTCool.targetTot           = Config::waitTotCoolTarget;
        g_blkWaitTOTCool.timeoutMs           = (unsigned long)Config::waitTotCoolTimeoutMs;
        g_blkThrottleSet.pct                 = Config::throttleSetPct;
        g_blkPreHeat.preheatMs               = (unsigned long)Config::preHeatMs;
        g_blkOilPumpOn.demandPct             = Config::oilPumpOnPct;
        g_blkFuelPumpIdle.maxPct              = Config::throttleIdleMaxPct;  // unified idle ceiling
        g_blkModifiedIdle.multiplier          = Config::modifiedIdleMultiplier;
        g_blkSpool.rpmTarget              = Config::spoolRpmTarget;
        g_blkSpool.timeoutMs              = Config::spoolTimeoutMs;
        g_blkSpool.throttleIdle           = Config::fuelPumpMinPct / 100.0f;
        g_blkSpool.cutStarterOnExit       = Config::spoolCutStarterOnExit;
        g_blkSpool.cutStarterEnOnExit     = Config::spoolCutStarterEnOnExit;
        g_blkSpool.runningOilMin          = Config::oilRunningMin;  // raise oil threshold at spool start
        g_blkSafetyHold.holdMs               = Config::safetyHoldMs;
        g_blkSafetyHold.timeoutMs            = Config::safetyHoldTimeoutMs;
        g_blkSafetyHold.finalCheckRpm        = Config::safetyHoldFinalRpm;
        g_blkSafetyHold.checkN1              = Config::safetyHoldCheckN1;
        g_blkSafetyHold.checkN2              = Config::safetyHoldCheckN2;
        g_blkSafetyHold.checkP1              = Config::safetyHoldCheckP1;
        g_blkSafetyHold.checkP2              = Config::safetyHoldCheckP2;
        g_blkSafetyHold.checkOil             = Config::safetyHoldCheckOil;
        g_blkSafetyHold.checkEgt             = Config::safetyHoldCheckEgt;
        g_blkSafetyHold.checkFlame           = Config::safetyHoldCheckFlame;
        g_blkSafetyHold.finalCheckN2Rpm      = Config::safetyHoldFinalN2Rpm;
        g_blkSafetyHold.finalCheckP1         = Config::safetyHoldFinalP1;
        g_blkSafetyHold.finalCheckP2         = Config::safetyHoldFinalP2;
        g_blkSafetyHold.finalCheckEgt        = Config::safetyHoldFinalEgt;
        g_blkSafetyHold.runningOilMin        = Config::oilRunningMin;
        g_blkSafetyHold.turnOffStarterOnExit  = Config::safetyHoldTurnOffStarter;
        g_blkSafetyHold.turnOffStarterEnOnExit= Config::safetyHoldTurnOffStarterEn;
        g_blkSafetyHold.turnOffIgniterOnExit  = Config::safetyHoldTurnOffIgniter;
        // Shutdown blocks
        g_blkRPMDrop.rpmThreshold         = Config::shutdownRpmDropThreshold;
        g_blkRPMDrop.timeoutMs            = Config::shutdownRpmDropTimeoutMs;
        g_blkCooldownSpin.totTarget          = Config::totCooldownTarget;
        g_blkCooldownSpin.starterCoolPct     = Config::cooldownStarterPct / 100.0f;
        g_blkCooldownSpin.oilCoolPct         = Config::cooldownOilPct;
        g_blkCooldownSpin.oilPressureTarget  = Config::cooldownOilPressureTarget;
        g_blkCooldownSpin.timeoutMs          = Config::shutdownCooldownTimeoutMs;
        g_blkFinalStop.timeoutMs            = Config::shutdownFinalStopTimeoutMs;
        g_blkFinalStop.rpmZeroThreshold    = Config::rpmZeroThreshold;
        g_blkFinalStop.oilScavengeMs       = (unsigned long)Config::finalStopOilScavengeMs;
        g_blkOilPrime.useScavengePump      = Config::oilPrimeUseScavengePump;
        g_blkCooldownSpin.useScavengePump  = Config::cooldownUseScavengePump;

        // AB blocks
        g_blkABCheckReady.minN1           = Config::abMinN1;
        g_blkABCheckReady.maxN1           = Config::abMaxN1;
        g_blkABCheckReady.maxTotForLight  = Config::abMaxTotForLight;
        g_blkABCheckReady.minThrottle     = (HardwareConfig::abTriggerSource == 1)
                                            ? Config::abThrottleThreshold : 0.0f;
        g_blkABIgnite.useTorch            = Config::abUseTorch;
        g_blkABIgnite.useIgniter          = Config::abUseIgniter;
        g_blkABIgnite.torchSpikePct       = Config::abTorchSpikePct;
        g_blkABIgnite.torchDurationMs     = Config::abTorchDurationMs;
        g_blkABIgnite.torchTotLimit       = Config::abTorchTotLimit;
        g_blkABPumpOn.demandPct           = Config::abLightupPumpPct;
        g_blkABFlameConfirm.flameMode     = Config::abFlameMode;
        g_blkABFlameConfirm.totRiseDegC   = Config::abTotRiseDegC;
        g_blkABFlameConfirm.totRiseWindowMs= Config::abTotRiseWindowMs;
        g_blkABFlameConfirm.assumeIgnitedMs= Config::abAssumeIgnitedMs;
        g_blkABFlameConfirm.flameTimeoutMs= Config::abFlameTimeoutMs;
        g_blkABStabilize.stabilizeMs      = Config::abStabilizeMs;
        g_blkABStabilize.stabilizeMaxTot  = Config::abStabilizeMaxTot;

        auto& hw = HardwareConfig::instance();
        if (hw.hasOilLoop) {
            g_ctrlOilLoop.adjustScale     = Config::oilAdjustScale;
            g_ctrlOilLoop.minPct          = Config::oilMinPct;
            g_ctrlOilLoop.maxPct          = 100.0f;
            g_ctrlOilLoop.failsafeDelayMs = Config::oilFailsafeDelayMs;
            g_ctrlOilLoop.failsafePct     = Config::oilFailsafePct;
            g_ctrlOilLoop.deadband        = Config::oilPressureDeadband;
            for (uint8_t i = 0; i < HardwareConfig::oilLoopCount; ++i) {
                const auto& loop = HardwareConfig::oilLoops[i];
                if (!loop.enabled) continue;
                g_ctrlOilLoop.minPct   = constrain((float)loop.minDemandPct, 0.0f, 100.0f);
                g_ctrlOilLoop.maxPct   = constrain((float)loop.maxDemandPct, g_ctrlOilLoop.minPct, 100.0f);
                g_ctrlOilLoop.deadband = loop.deadbandCentiBar / 100.0f;
                break;
            }
        }
        if (hw.hasThrottle) {
            g_ctrlThrottleSlew.rampUpMs     = Config::throttleRampUpMs;
            g_ctrlThrottleSlew.rampDownMs   = Config::throttleRampDownMs;
            g_ctrlThrottleSlew.n1PullbackEnabled = Config::pullbackN1Enabled;
            g_ctrlThrottleSlew.n2PullbackEnabled = Config::pullbackN2Enabled;
            g_ctrlThrottleSlew.egtPullbackEnabled = Config::pullbackEgtEnabled;
            g_ctrlThrottleSlew.p1PullbackEnabled = Config::pullbackP1Enabled;
            g_ctrlThrottleSlew.p2PullbackEnabled = Config::pullbackP2Enabled;
            g_ctrlThrottleSlew.torquePullbackEnabled = Config::pullbackTorqueEnabled;
            g_ctrlThrottleSlew.rpmHardLimit = Config::pullbackN1HardRpm > 0.0f ? Config::pullbackN1HardRpm : Config::rpmLimit;
            g_ctrlThrottleSlew.rpmSoftLimit = Config::pullbackN1SoftRpm > 0.0f ? Config::pullbackN1SoftRpm : (Config::rpmLimit * 0.95f);
            g_ctrlThrottleSlew.n2HardLimit = Config::pullbackN2HardRpm;
            g_ctrlThrottleSlew.n2SoftLimit = Config::pullbackN2SoftRpm;
            const float egtLimit = Config::primaryEgtLimitC();
            g_ctrlThrottleSlew.totHardLimit = Config::pullbackEgtHardC > 0.0f ? Config::pullbackEgtHardC : egtLimit;
            g_ctrlThrottleSlew.p1SoftLimit = Config::pullbackP1Soft;
            g_ctrlThrottleSlew.p1HardLimit = Config::pullbackP1Hard;
            g_ctrlThrottleSlew.p2SoftLimit = Config::pullbackP2Soft;
            g_ctrlThrottleSlew.p2HardLimit = Config::pullbackP2Hard;
            g_ctrlThrottleSlew.torqueSoftLimit = Config::pullbackTorqueSoft;
            g_ctrlThrottleSlew.torqueHardLimit = Config::pullbackTorqueHard;
            g_ctrlThrottleSlew.totSoftLimit = Config::pullbackEgtSoftC > 0.0f ? Config::pullbackEgtSoftC : (egtLimit - Config::totSafeMargin);
            g_ctrlThrottleSlew.minPullbackThrottle = Config::pullbackMinThrottlePct / 100.0f;
            g_ctrlThrottleSlew.pullbackStrength = Config::pullbackStrength;
            g_ctrlThrottleSlew.rpmLimiterMode            = Config::rpmLimiterMode;
            g_ctrlThrottleSlew.pullbackLookaheadMs       = Config::pullbackLookaheadMs;
            g_ctrlThrottleSlew.pullbackNearLimitRampUpMs = Config::pullbackNearLimitRampUpMs;
            g_ctrlThrottleSlew.pullbackApproachZoneRpm   = (Config::pullbackApproachZoneRpm > 0.0f)
                ? Config::pullbackApproachZoneRpm
                : 4.0f * (g_ctrlThrottleSlew.rpmHardLimit - g_ctrlThrottleSlew.rpmSoftLimit);
        }
        if (hw.hasDynamicIdle) {
            g_ctrlDynamicIdle.targetRpm     = Config::idleTargetRpm;
            g_ctrlDynamicIdle.rampUpMs      = Config::idleRampUpMs;
            g_ctrlDynamicIdle.rampDownMs    = Config::idleRampDownMs;
            g_ctrlDynamicIdle.deadbandRpm   = Config::idleDeadbandRpm;
            g_ctrlDynamicIdle.rpmLimit      = Config::idleRpmLimit;
            g_ctrlDynamicIdle.source        = Config::idleSource;
            g_ctrlDynamicIdle.targetPressure = Config::idleTargetPressure;
            g_ctrlDynamicIdle.pressureDeadband = Config::idlePressureDeadband;
            g_ctrlDynamicIdle.pressureLimit = Config::idlePressureLimit;
            g_ctrlDynamicIdle.minMultiplier = Config::idleMinMultiplier;
            g_ctrlDynamicIdle.maxMultiplier = Config::idleMaxMultiplier;
            g_ctrlDynamicIdle.idleMode              = Config::idleMode;
            g_ctrlDynamicIdle.idleDecelEnterRpm     = Config::idleDecelEnterRpm;
            g_ctrlDynamicIdle.idleDecelDropPct      = Config::idleDecelDropPct;
            g_ctrlDynamicIdle.idleLookaheadMs       = Config::idleLookaheadMs;
            g_ctrlDynamicIdle.idleSettleBandRpm     = Config::idleSettleBandRpm;
            g_ctrlDynamicIdle.idleFullResponseRpm   = Config::idleFullResponseRpm;
            g_ctrlDynamicIdle.idleTrimUpPctPerSec   = Config::idleTrimUpPctPerSec;
            g_ctrlDynamicIdle.idleTrimDownPctPerSec = Config::idleTrimDownPctPerSec;
            g_ctrlDynamicIdle.idleLearnRate         = Config::idleLearnRate;
            g_ctrlDynamicIdle.idleLearnAccelMax     = Config::idleLearnAccelMax;
        }
        if (hw.hasOilPress) {
            PolyCal pc;
            pc.a = Config::oilPolyA; pc.b = Config::oilPolyB;
            pc.c = Config::oilPolyC; pc.d = Config::oilPolyD;
            pc.xMin = Config::oilPolyXMin; pc.xMax = Config::oilPolyXMax;
            g_sensorOilPress.setCal(pc);
        }
        if (hw.hasFlame)  g_sensorFlame.setThreshold(Config::flameThreshold);
        if (hw.hasAbFlame && hw.abFlamePin >= 0) g_sensorAbFlame.setThreshold(hw.abFlameThreshold);
        if (hw.hasOilTemp && hw.oilTempPin >= 0 && strcmp(hw.oilTempChip, "ntc") == 0) {
            g_sensorOilTempNtc.setCal({ hw.ntcFixedPullup, hw.ntcRFixed, hw.ntcR0, 25.0f, hw.ntcBeta,
                hw.oilTempUseRawPoly, hw.oilTempPolyA, hw.oilTempPolyB, hw.oilTempPolyC, hw.oilTempPolyD,
                hw.oilTempPolyXMin, hw.oilTempPolyXMax });
        }
        if (hw.hasBattVoltage && hw.battVoltPin >= 0) {
            g_sensorBattVolt.setCal({ 0.0f, 4095.0f, 0.0f, hw.battVoltDivider * 3.3f });
        }
        if (hw.hasTorque && !hw.torqueHx711 && hw.torquePin >= 0) {
            g_sensorTorque.setCal({ 0.0f, 4095.0f, -hw.torqueOffset,
                                    hw.torqueScale * 3.3f - hw.torqueOffset });
        }
        if (hw.hasGlowCurrentSensor && hw.glowCurrentPin >= 0) {
            applyCurrentSensorCal(g_sensorGlowCurrent, hw.glowCurrentZeroV, hw.glowCurrentMvPerA);
        }
        if (hw.hasIgniterCurrentSensor && hw.igniterCurrentPin >= 0) {
            applyCurrentSensorCal(g_sensorIgniterCurrent, hw.igniterCurrentZeroV, hw.igniterCurrentMvPerA);
        }
        if (hw.hasIgniter2CurrentSensor && hw.igniter2CurrentPin >= 0) {
            applyCurrentSensorCal(g_sensorIgniter2Current, hw.igniter2CurrentZeroV, hw.igniter2CurrentMvPerA);
        }
        if (hw.hasOilPumpCurrentSensor && hw.oilPumpCurrentPin >= 0) {
            applyCurrentSensorCal(g_sensorOilPumpCurrent, hw.oilPumpCurrentZeroV, hw.oilPumpCurrentMvPerA);
        }
        if (hw.hasN1Rpm) { g_sensorN1Rpm.jumpThreshold  = Config::rpmJumpThreshold;
                           g_sensorN1Rpm.zeroStuckLimit = Config::rpmZeroStuckTicks;
                           g_sensorN1Rpm.rpmLimit       = Config::rpmLimit > 0.0f ? Config::rpmLimit * 2.0f : 120000.0f; }
        if (hw.hasN2Rpm) { g_sensorN2Rpm.jumpThreshold  = Config::rpmJumpThreshold;
                           g_sensorN2Rpm.zeroStuckLimit = Config::rpmZeroStuckTicks;
                           g_sensorN2Rpm.rpmLimit       = (Config::n2RpmLimit > 0.0f ? Config::n2RpmLimit :
                                                          (Config::rpmLimit > 0.0f ? Config::rpmLimit : 60000.0f)) * 2.0f; }
        g_safety.rpmLimit              = Config::rpmLimit;
        g_safety.n2RpmLimit            = Config::n2RpmLimit;
        g_safety.minRpm               = Config::minRpm;
        g_safety.titLimit             = Config::titLimit;
        g_safety.oilTempLimit         = Config::oilTempLimit;
        g_safety.fuelPressMin         = Config::fuelPressMin;
        g_safety.battVoltMin          = Config::battVoltMin;
        g_safety.surgeRpmVariance     = Config::surgeDetectRpmVariance;
        g_safety.lowOilConfirmMs      = Config::lowOilConfirmMs;
        g_safety.oilZeroConfirmMs     = Config::oilZeroConfirmMs;
        g_safety.oilTempConfirmMs     = Config::oilTempConfirmMs;
        g_safety.fuelPressConfirmMs   = Config::fuelPressConfirmMs;
        g_safety.battLowConfirmMs     = Config::battLowConfirmMs;
        g_safety.flameoutShutdownMs   = Config::flameoutShutdownMs;
        g_safety.flameoutSource       = Config::flameoutSource;
        g_safety.flameoutN1MinRpm     = Config::flameoutN1MinRpm;
        g_safety.flameoutEgtBelowC    = Config::flameoutEgtBelowC;
        g_safety.flameoutEgtFallRateCPerSec = Config::flameoutEgtFallRateCPerSec;
        g_safety.checkIntervalMs      = Config::safetyCheckIntervalMs;

        if (hw.hasGovernor) {
            g_ctrlGovernor.targetRpm    = Config::governorTargetRpm;
            g_ctrlGovernor.bandRpm      = Config::governorBandRpm;
            g_ctrlGovernor.kp           = Config::governorKp;
            g_ctrlGovernor.pitchKp       = Config::governorPitchKp;
            g_ctrlGovernor.pitchRampSec  = Config::governorPitchRampSec;
            g_ctrlGovernor.usePropPitch  = hw.hasPropPitch && hw.propPitchType != 2 &&
                                           Config::governorPitchKp > 0.0f;
        }
        // Advanced sequence block params
        g_blkFuelPumpRamp.startPct      = Config::fp2StartPct;
        g_blkFuelPumpRamp.endPct        = Config::fp2EndPct;
        g_blkFuelPumpRamp.rampMs        = (unsigned long)Config::fp2RampMs;
        g_blkFuelPump2Set.demandPct     = Config::fp2DemandPct;
        g_blkGovernorHold.timeoutMs     = (unsigned long)Config::govHoldTimeoutMs;
        g_blkGovernorHold.bandRpm       = Config::governorBandRpm;

        // ADC linear-cal sensors — re-apply so PATCH calibration takes effect immediately
        if (hw.hasFuelFlow && hw.fuelFlowType != 1) {
            g_sensorFuelFlow.setCal({ (float)Config::fuelFlowRawMin,
                                      (float)Config::fuelFlowRawMax,
                                      0.0f, Config::fuelFlowValMax });
        }
        if (hw.hasFuelPress) {
            g_sensorFuelPress.setCal({ (float)Config::fuelPressRawMin,
                                       (float)Config::fuelPressRawMax,
                                       0.0f, Config::fuelPressValMax });
        }
        if (hw.hasP1) {
            g_sensorP1.setCal({ (float)Config::p1RawMin, (float)Config::p1RawMax,
                                0.0f, Config::p1ValMax });
        }
        if (hw.hasP2) {
            g_sensorP2.setCal({ (float)Config::p2RawMin, (float)Config::p2RawMax,
                                0.0f, Config::p2ValMax });
        }
    }

    // Filtered RPM-acceleration state (single instance; reset in initSensors()).
    inline unsigned long _accelLastN1Ms = 0;
    inline unsigned long _accelLastN2Ms = 0;
    inline uint32_t      _accelSeenN1Seq = 0;
    inline uint32_t      _accelSeenN2Seq = 0;
    inline float         _accelPrevN1 = 0.0f;
    inline float         _accelPrevN2 = 0.0f;

    // ── Sensor init ───────────────────────────────────────────
    inline void initSensors() {
        auto& hw = HardwareConfig::instance();
        auto& ed = EngineData::instance();
        ed.hardwareReady = true;
        ed.hardwareFault[0] = '\0';
        const bool n1RegistryAnalog = registryAnalogInputIndex("n1_main", "primary_n1", "n1_speed") >= 0;
        const bool n2RegistryAnalog = registryAnalogInputIndex("n2_main", "primary_n2", "n2_speed") >= 0;
        const bool totRegistryAnalog = registryAnalogInputIndex("tot_main", nullptr, "tot") >= 0;
        const bool titRegistryAnalog = registryAnalogInputIndex("tit_main", nullptr, "tit") >= 0;
        const bool oilTempRegistryAnalog = registryAnalogInputIndex("oil_temperature", nullptr, "oil_temperature") >= 0;
        const bool p1RegistryAnalog = registryAnalogInputIndex("p1_main", nullptr, "p1_pressure") >= 0;
        const bool p2RegistryAnalog = registryAnalogInputIndex("p2_main", nullptr, "p2_pressure") >= 0;
        const bool idleRegistryInput = registryPurposeInputIndex("idle") >= 0;
        const bool throttleRegistryInput = registryPurposeInputIndex("throttle", "operator_throttle") >= 0;
        uint8_t pcntNeeded = (hw.hasN1Rpm && !n1RegistryAnalog ? 1 : 0) +
                             (hw.hasN2Rpm && !n2RegistryAnalog ? 1 : 0) +
                             (hw.hasFuelFlow && hw.fuelFlowType == 1 ? 1 : 0);
        uint8_t registryPcntNeeded = 0;
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.inputCount; ++i) {
            const auto& c = HardwareConfig::channelRegistry.inputs[i];
            if (c.installed && c.driver == ChannelRegistry::Pulse && !strcmp(c.role, "speed") &&
                !registryCoreInputKind(c) &&
                strcmp(c.purpose, "fuel_flow") != 0 && strcmp(c.id, "fuel_flow") != 0) {
                ++pcntNeeded;
                ++registryPcntNeeded;
            }
        }
        #if defined(SOC_PCNT_GROUPS)
        constexpr uint8_t pcntAvailable = SOC_PCNT_GROUPS * SOC_PCNT_UNITS_PER_GROUP;
        #else
        constexpr uint8_t pcntAvailable = SOC_PCNT_UNITS_PER_GROUP;
        #endif
        g_pcntResourcePlanValid = pcntNeeded <= pcntAvailable &&
                                  registryPcntNeeded <= MAX_REGISTRY_PCNT;
        if (!g_pcntResourcePlanValid) {
            ed.hardwareReady = false;
            snprintf(ed.hardwareFault, sizeof(ed.hardwareFault),
                     "PCNT overcommit: %u total/%u available, %u registry/%u supported",
                     pcntNeeded, pcntAvailable, registryPcntNeeded, MAX_REGISTRY_PCNT);
            Serial.printf("[HW] %s\n", ed.hardwareFault);
        }
        if (hw.hasN1Rpm && !n1RegistryAnalog && g_pcntResourcePlanValid) {
            g_sensorN1Rpm.begin(hw.n1RpmPin, hw.n1RpmPpr);
            if (!g_sensorN1Rpm.hardwareReady()) { ed.hardwareReady = false; strlcpy(ed.hardwareFault, "N1 PCNT initialization failed", sizeof(ed.hardwareFault)); }
        }
        if (hw.hasN2Rpm && !n2RegistryAnalog && g_pcntResourcePlanValid) {
            g_sensorN2Rpm.begin(hw.n2RpmPin, hw.n2RpmPpr);
            if (!g_sensorN2Rpm.hardwareReady()) { ed.hardwareReady = false; strlcpy(ed.hardwareFault, "N2 PCNT initialization failed", sizeof(ed.hardwareFault)); }
        }
        _accelLastN1Ms = 0; _accelLastN2Ms = 0;
        _accelSeenN1Seq = 0; _accelSeenN2Seq = 0;
        _accelPrevN1 = 0.0f; _accelPrevN2 = 0.0f;
        if (hw.hasTot && !totRegistryAnalog) {
            if (strncmp(hw.totChip, "max31856", 8) == 0) {
                g_sensorTot31856 = MAX31856TempSensor(hw.totClk, hw.totCs, hw.totMiso, hw.totMosi, hw.totTcType, "TOT_31856");
                g_sensorTot31856.begin(); g_pSensorTot = &g_sensorTot31856;
            } else if (strncmp(hw.totChip, "max31855", 8) == 0) {
                g_sensorTotAlt.begin(hw.totClk, hw.totCs, hw.totMiso);
                g_pSensorTot = &g_sensorTotAlt;
            } else {
                g_sensorTot.begin(hw.totClk, hw.totCs, hw.totMiso);
                g_pSensorTot = &g_sensorTot;
            }
        }
        if (hw.hasTit && !titRegistryAnalog) {
            if (strncmp(hw.titChip, "max31856", 8) == 0) {
                g_sensorTit31856 = MAX31856TempSensor(hw.titClk, hw.titCs, hw.titMiso, hw.titMosi, hw.titTcType, "TIT_31856");
                g_sensorTit31856.begin(); g_pSensorTit = &g_sensorTit31856;
            } else if (strncmp(hw.titChip, "max31855", 8) == 0) {
                g_sensorTitAlt.begin(hw.titClk, hw.titCs, hw.titMiso);
                g_pSensorTit = &g_sensorTitAlt;
            } else {
                g_sensorTit.begin(hw.titClk, hw.titCs, hw.titMiso);
                g_pSensorTit = &g_sensorTit;
            }
        }
        if (hw.hasOilTemp && !oilTempRegistryAnalog && hw.oilTempPin >= 0) {
            if (strncmp(hw.oilTempChip, "max31856", 8) == 0) {
                g_sensorOilTemp856 = MAX31856TempSensor(hw.oilTempPin, hw.oilTempCs, hw.oilTempMiso,
                                                        hw.oilTempMosi, hw.oilTempTcType, "OIL_TEMP_856");
                g_sensorOilTemp856.begin(); g_pSensorOilTemp = &g_sensorOilTemp856;
            } else if (strncmp(hw.oilTempChip, "max31855", 8) == 0) {
                g_sensorOilTemp855.begin(hw.oilTempPin, hw.oilTempCs, hw.oilTempMiso);
                g_pSensorOilTemp = &g_sensorOilTemp855;
            } else if (strncmp(hw.oilTempChip, "max6675", 7) == 0) {
                g_sensorOilTempTc.begin(hw.oilTempPin, hw.oilTempCs, hw.oilTempMiso);
                g_pSensorOilTemp = &g_sensorOilTempTc;
            } else if (strncmp(hw.oilTempChip, "ds18b20", 7) == 0) {
                // DS18B20 OneWire digital thermometer — single data pin, no SPI.
                g_sensorOilTempDs18b20.begin(hw.oilTempPin,
                                             (uint8_t)constrain(hw.oilTempResolution, 9, 12));
                g_pSensorOilTemp = &g_sensorOilTempDs18b20;
            } else {
                // NTC analog — Steinhart-Hart B-parameter equation.
                g_sensorOilTempNtc.begin(hw.oilTempPin);
                g_sensorOilTempNtc.setCal({ hw.ntcFixedPullup, hw.ntcRFixed, hw.ntcR0, 25.0f, hw.ntcBeta,
                    hw.oilTempUseRawPoly, hw.oilTempPolyA, hw.oilTempPolyB, hw.oilTempPolyC, hw.oilTempPolyD,
                    hw.oilTempPolyXMin, hw.oilTempPolyXMax });
                g_pSensorOilTemp = &g_sensorOilTempNtc;
            }
        }
        if (hw.hasBattVoltage && hw.battVoltPin >= 0) {
            g_sensorBattVolt.begin(hw.battVoltPin);
            // ADC 0–4095 → 0–3.3 V; multiply by divider to get Vbatt
            g_sensorBattVolt.setCal({ 0.0f, 4095.0f, 0.0f, hw.battVoltDivider * 3.3f });
        }
        if (hw.hasTorque && hw.torqueHx711 && hw.torqueDtPin >= 0 && hw.torqueClkPin >= 0) {
            g_sensorTorqueHx711.begin(hw.torqueDtPin, hw.torqueClkPin,
                                      hw.torqueHxScale, (long)hw.torqueHxZero);
        } else if (hw.hasTorque && hw.torquePin >= 0) {
            g_sensorTorque.begin(hw.torquePin);
            // torqueOffset is the Nm-equivalent zero-load reading to subtract.
            g_sensorTorque.setCal({ 0.0f, 4095.0f, -hw.torqueOffset,
                                    hw.torqueScale * 3.3f - hw.torqueOffset });
        }
        if (hw.hasOilPress) g_sensorOilPress.begin(hw.oilPressPin);
        if (hw.hasFlame)   g_sensorFlame.begin(hw.flamePin);
        auto setOperatorHealthWindow = [](AnalogBase& sensor, int rawA, int rawB) {
            const int lo = min(rawA, rawB);
            const int hi = max(rawA, rawB);
            const int margin = max(8, (hi - lo) / 20); // 5% outside calibrated travel
            sensor.setHealthyRawRange(max(0, lo - margin), min(4095, hi + margin));
        };
        if (hw.hasIdleInput && !hw.idleInputRcPwm && !idleRegistryInput) {
            g_sensorIdleInput.begin(hw.idleInputPin);
            setOperatorHealthWindow(g_sensorIdleInput, Config::idleMinRaw, Config::idleMaxRaw);
        }
        if (hw.hasThrottleInput && !hw.throttleInputRcPwm && !throttleRegistryInput) {
            g_sensorThrottleInput.begin(hw.throttleInputPin);
            setOperatorHealthWindow(g_sensorThrottleInput, Config::throttleMinRaw, Config::throttleMaxRaw);
        }
        if (hw.hasFuelFlow) {
            if (hw.fuelFlowType == 1) {
                // Pulse / frequency type — reuse PCNT infrastructure (pulsesPerRev=1 → RPM = pulses/min)
                if (g_pcntResourcePlanValid) g_sensorFuelFlowPulse.begin(hw.fuelFlowPin, 1.0f);
            } else {
                // Analog voltage type
                g_sensorFuelFlow.begin(hw.fuelFlowPin);
                g_sensorFuelFlow.setCal({ (float)Config::fuelFlowRawMin,
                                          (float)Config::fuelFlowRawMax,
                                          0.0f, Config::fuelFlowValMax });
            }
        }
        if (hw.hasFuelPress) {
            g_sensorFuelPress.begin(hw.fuelPressPin);
            g_sensorFuelPress.setCal({ (float)Config::fuelPressRawMin,
                                       (float)Config::fuelPressRawMax,
                                       0.0f, Config::fuelPressValMax });
        }
        if (hw.hasP1 && !p1RegistryAnalog) {
            g_sensorP1.begin(hw.p1Pin);
            g_sensorP1.setCal({ (float)Config::p1RawMin, (float)Config::p1RawMax,
                                 0.0f, Config::p1ValMax });
        }
        if (hw.hasP2 && !p2RegistryAnalog) {
            g_sensorP2.begin(hw.p2Pin);
            g_sensorP2.setCal({ (float)Config::p2RawMin, (float)Config::p2RawMax,
                                 0.0f, Config::p2ValMax });
        }
        if (hw.hasAbFlame && hw.abFlamePin >= 0) {
            g_sensorAbFlame.begin(hw.abFlamePin);
            g_sensorAbFlame.setThreshold(hw.abFlameThreshold);
        }
        if (hw.hasAfterburner && hw.abInputPin >= 0 && !hw.abInputRcPwm &&
            (hw.abTriggerSource == 3 || Config::abPumpControlMode == 2))
        {
            g_sensorAbInput.begin(hw.abInputPin);
            // Dedicated analog AB command inputs are intentionally full-span.
            // Registry inputs expose a separately calibrated health window.
            g_sensorAbInput.setHealthyRawRange(0, 4095);
        }
        if (hw.abRequiresArmSwitch && hw.abArmSwitchPin >= 0)
            pinMode(hw.abArmSwitchPin, hw.abArmSwitchActiveH ? INPUT_PULLDOWN : INPUT_PULLUP);
        if (hw.abTriggerSource == 2 && hw.abSwitchPin >= 0)
            pinMode(hw.abSwitchPin, hw.abSwitchActiveH ? INPUT_PULLDOWN : INPUT_PULLUP);
        if (hw.hasGlowCurrentSensor && hw.glowCurrentPin >= 0) {
            g_sensorGlowCurrent.begin(hw.glowCurrentPin);
            applyCurrentSensorCal(g_sensorGlowCurrent, hw.glowCurrentZeroV, hw.glowCurrentMvPerA);
        }
        if (hw.hasIgniterCurrentSensor && hw.igniterCurrentPin >= 0) {
            g_sensorIgniterCurrent.begin(hw.igniterCurrentPin);
            applyCurrentSensorCal(g_sensorIgniterCurrent, hw.igniterCurrentZeroV, hw.igniterCurrentMvPerA);
        }
        if (hw.hasIgniter2CurrentSensor && hw.igniter2CurrentPin >= 0) {
            g_sensorIgniter2Current.begin(hw.igniter2CurrentPin);
            applyCurrentSensorCal(g_sensorIgniter2Current, hw.igniter2CurrentZeroV, hw.igniter2CurrentMvPerA);
        }
        if (hw.hasOilPumpCurrentSensor && hw.oilPumpCurrentPin >= 0) {
            g_sensorOilPumpCurrent.begin(hw.oilPumpCurrentPin);
            applyCurrentSensorCal(g_sensorOilPumpCurrent, hw.oilPumpCurrentZeroV, hw.oilPumpCurrentMvPerA);
        }
        initRegistryInputs();
    }

    // ── Sensor update → EngineData ────────────────────────────
    inline void updateSensors() {
        auto& hw = HardwareConfig::instance();
        auto& ed = EngineData::instance();
        // Full address discovery is maintenance work. Assigned devices remain
        // serviced while active, but scanning unknown addresses is restricted
        // to standby/fault so a damaged bus cannot add jitter to fuel control.
        const bool allowI2cDiscovery =
            ed.mode == SysMode::STANDBY || ed.mode == SysMode::FAULT;
        I2CDeviceManager::tick(allowI2cDiscovery);
        updateRegistryInputs();
        const int8_t idleRegistry = registryPurposeInputIndex("idle");
        const int8_t throttleRegistry = registryPurposeInputIndex("throttle", "operator_throttle");
        const int8_t torqueRegistry = registryPurposeInputIndex("torque");
        const int8_t thrustRegistry = registryPurposeInputIndex("thrust");
        const int8_t flameRegistry = registryPurposeInputIndex("flame");
        const int8_t abCommandRegistry = registryPurposeInputIndex("ab_command");
        // Preserve the existing idle/throttle consumers and telemetry without
        // making them apply a second calibration layer. Registry endpoints
        // already produce 0..1, so synthesize the legacy raw value that maps
        // straight back to the same normalized demand.
        if (idleRegistry >= 0 && ed.registryInputHealthy[idleRegistry]) {
            float norm = constrain(ed.registryInputValue[idleRegistry], 0.0f, 1.0f);
            ed.idleInputRaw = (int)(Config::idleMinRaw + norm * (Config::idleMaxRaw - Config::idleMinRaw));
            ed.idleInputValid = true;
        } else if (idleRegistry >= 0) {
            ed.idleInputRaw = Config::idleMinRaw;
            ed.idleInputValid = false;
        }
        if (throttleRegistry >= 0 && ed.registryInputHealthy[throttleRegistry]) {
            float norm = constrain(ed.registryInputValue[throttleRegistry], 0.0f, 1.0f);
            ed.throttleInputRaw = (int)(Config::throttleMinRaw + norm * (Config::throttleMaxRaw - Config::throttleMinRaw));
            ed.throttleInputValid = true;
        } else if (throttleRegistry >= 0) {
            ed.throttleInputRaw = Config::throttleMinRaw;
            ed.throttleInputValid = false;
        }
        const int8_t n1Analog = registryAnalogInputIndex("n1_main", "primary_n1", "n1_speed") >= 0
            ? registryAnalogInputIndex("n1_main", "primary_n1", "n1_speed") : registryAnalogInputIndex("primary_n1", nullptr, "n1_speed");
        const int8_t n2Analog = registryAnalogInputIndex("n2_main", "primary_n2", "n2_speed") >= 0
            ? registryAnalogInputIndex("n2_main", "primary_n2", "n2_speed") : registryAnalogInputIndex("primary_n2", nullptr, "n2_speed");
        const int8_t totAnalog = registryAnalogInputIndex("tot_main", nullptr, "tot");
        const int8_t titAnalog = registryAnalogInputIndex("tit_main", nullptr, "tit");
        const int8_t oilPressAnalog = registryAnalogInputIndex("oil_pressure_main", nullptr, "oil_pressure");
        const int8_t oilTempAnalog = registryAnalogInputIndex("oil_temperature", nullptr, "oil_temperature");
        const int8_t fuelPressAnalog = registryAnalogInputIndex("fuel_pressure", nullptr, "fuel_pressure");
        const int8_t p1Analog = registryAnalogInputIndex("p1_main", nullptr, "p1_pressure");
        const int8_t p2Analog = registryAnalogInputIndex("p2_main", nullptr, "p2_pressure");
        const int8_t flameAnalog = registryAnalogInputIndex("flame_main", nullptr, "flame");
        const int8_t fuelFlowAnalog = registryAnalogInputIndex("fuel_flow", nullptr, "fuel_flow");
        const int8_t battAnalog = registryAnalogInputIndex("battery_voltage", nullptr, "battery_voltage");
        const int8_t totSpecial = registrySpecialTemperatureIndex("tot_main", "tot");
        const int8_t titSpecial = registrySpecialTemperatureIndex("tit_main", "tit");
        const int8_t oilTempSpecial = registrySpecialTemperatureIndex("oil_temperature", "oil_temperature");
        if (hw.hasN1Rpm) {
            if (n1Analog >= 0) {
                ed.n1Rpm = ed.registryInputValue[n1Analog];
                ed.n1Healthy = ed.registryInputHealthy[n1Analog];
                if (g_registryAnalogLastMs[n1Analog] != ed.n1SampleMs) {
                    ed.n1SampleSeq = ed.n1SampleSeq + 1U;
                    ed.n1SampleMs = g_registryAnalogLastMs[n1Analog];
                }
            } else {
                g_sensorN1Rpm.update();
                ed.n1Rpm     = g_sensorN1Rpm.getValue();
                ed.n1Healthy = g_sensorN1Rpm.isHealthy();
                uint32_t seq = g_sensorN1Rpm.sampleSequence();
                if (seq != ed.n1SampleSeq) {
                    ed.n1SampleSeq = seq;
                    const uint32_t sampleMs = g_sensorN1Rpm.sampleTimestampMs();
                    ed.n1SampleMs = sampleMs ? sampleMs : millis();
                }
            }
        }
        if (hw.hasN2Rpm) {
            if (n2Analog >= 0) {
                ed.n2Rpm = ed.registryInputValue[n2Analog];
                ed.n2Healthy = ed.registryInputHealthy[n2Analog];
                if (g_registryAnalogLastMs[n2Analog] != ed.n2SampleMs) {
                    ed.n2SampleSeq = ed.n2SampleSeq + 1U;
                    ed.n2SampleMs = g_registryAnalogLastMs[n2Analog];
                }
            } else {
                g_sensorN2Rpm.update();
                ed.n2Rpm     = g_sensorN2Rpm.getValue();
                ed.n2Healthy = g_sensorN2Rpm.isHealthy();
                uint32_t seq = g_sensorN2Rpm.sampleSequence();
                if (seq != ed.n2SampleSeq) {
                    ed.n2SampleSeq = seq;
                    const uint32_t sampleMs = g_sensorN2Rpm.sampleTimestampMs();
                    ed.n2SampleMs = sampleMs ? sampleMs : millis();
                }
            }
        }
        // Filtered RPM acceleration (RPM/s) — one trustworthy source for the
        // predictive RPM limiter and advanced dynamic-idle. Follows the RPM read
        // cadence; unhealthy shaft ⇒ 0; a >1 s gap resets (never integrate a stall).
        {
            if (ed.n1SampleSeq != _accelSeenN1Seq) {
                float dt = _accelLastN1Ms ? (ed.n1SampleMs - _accelLastN1Ms) / 1000.0f : 0.0f;
                if (ed.n1Healthy && dt > 0.0f && dt < 1.0f) {
                    float raw = (ed.n1Rpm - _accelPrevN1) / dt;
                    ed.n1RpmAccel += (raw - ed.n1RpmAccel) * Config::rpmAccelFilter;
                } else ed.n1RpmAccel = 0;
                _accelPrevN1 = ed.n1Rpm; _accelLastN1Ms = ed.n1SampleMs; _accelSeenN1Seq = ed.n1SampleSeq;
            }
            if (ed.n2SampleSeq != _accelSeenN2Seq) {
                float dt = _accelLastN2Ms ? (ed.n2SampleMs - _accelLastN2Ms) / 1000.0f : 0.0f;
                if (ed.n2Healthy && dt > 0.0f && dt < 1.0f) {
                    float raw = (ed.n2Rpm - _accelPrevN2) / dt;
                    ed.n2RpmAccel += (raw - ed.n2RpmAccel) * Config::rpmAccelFilter;
                } else ed.n2RpmAccel = 0;
                _accelPrevN2 = ed.n2Rpm; _accelLastN2Ms = ed.n2SampleMs; _accelSeenN2Seq = ed.n2SampleSeq;
            }
        }
        if (totAnalog >= 0) {
            ed.tot = ed.registryInputValue[totAnalog];
            ed.totHealthy = ed.registryInputHealthy[totAnalog];
            if (g_registryAnalogLastMs[totAnalog] != ed.totSampleMs) {
                ed.totSampleSeq = ed.totSampleSeq + 1U;
                ed.totSampleMs = g_registryAnalogLastMs[totAnalog];
            }
        } else if (hw.hasTot && g_pSensorTot) {
            g_pSensorTot->update();
            ed.tot        = g_pSensorTot->getValue();
            ed.totHealthy = g_pSensorTot->isHealthy();
            uint32_t seq = g_pSensorTot->sampleSequence();
            if (seq != ed.totSampleSeq) {
                ed.totSampleSeq = seq;
                const uint32_t sampleMs = g_pSensorTot->sampleTimestampMs();
                ed.totSampleMs = sampleMs ? sampleMs : millis();
            }
        }
        if (totSpecial >= 0) {
            ed.registryInputValue[totSpecial] = ed.tot;
            ed.registryInputHealthy[totSpecial] = ed.totHealthy;
        }
        if (titAnalog >= 0) {
            ed.tit = ed.registryInputValue[titAnalog];
            ed.titHealthy = ed.registryInputHealthy[titAnalog];
            if (g_registryAnalogLastMs[titAnalog] != ed.titSampleMs) {
                ed.titSampleSeq = ed.titSampleSeq + 1U;
                ed.titSampleMs = g_registryAnalogLastMs[titAnalog];
            }
        } else if (hw.hasTit && g_pSensorTit) {
            g_pSensorTit->update();
            ed.tit        = g_pSensorTit->getValue();
            ed.titHealthy = g_pSensorTit->isHealthy();
            uint32_t seq = g_pSensorTit->sampleSequence();
            if (seq != ed.titSampleSeq) {
                ed.titSampleSeq = seq;
                const uint32_t sampleMs = g_pSensorTit->sampleTimestampMs();
                ed.titSampleMs = sampleMs ? sampleMs : millis();
            }
        }
        if (titSpecial >= 0) {
            ed.registryInputValue[titSpecial] = ed.tit;
            ed.registryInputHealthy[titSpecial] = ed.titHealthy;
        }
        if (hw.hasOilPress) {
            g_sensorOilPress.update();
            ed.oilPressure    = g_sensorOilPress.getValue();
            ed.oilPressureRaw = g_sensorOilPress.rawCounts();
            ed.oilHealthy     = g_sensorOilPress.isHealthy();
            if (oilPressAnalog >= 0) {
                ed.registryInputValue[oilPressAnalog] = ed.oilPressure;
                ed.registryInputHealthy[oilPressAnalog] = ed.oilHealthy;
            }
        } else if (oilPressAnalog >= 0) {
            ed.oilPressure = ed.registryInputValue[oilPressAnalog];
            ed.oilHealthy = ed.registryInputHealthy[oilPressAnalog];
        }
        if (flameAnalog >= 0) {
            const auto& c = HardwareConfig::channelRegistry.inputs[flameAnalog];
            if (c.driver == ChannelRegistry::I2cAnalog) {
                float value = 0.0f; int32_t raw = 0; uint32_t seq = 0, sampleMs = 0;
                ed.flameHealthy = I2CDeviceManager::input(flameAnalog, value, raw, seq, sampleMs);
                ed.flameSensorRaw = raw;
                ed.flameDetected = ed.flameHealthy && value >= 0.5f;
                ed.flameSampleSeq = seq; ed.flameSampleMs = sampleMs;
            } else {
                ed.flameSensorRaw = analogRead(c.pin);
                ed.flameDetected = ed.flameSensorRaw > Config::flameThreshold;
                ed.flameHealthy = ed.registryInputHealthy[flameAnalog];
                const uint32_t sampleMs = g_registryAnalogLastMs[flameAnalog];
                if (sampleMs != ed.flameSampleMs) {
                    ed.flameSampleMs = sampleMs;
                    ed.flameSampleSeq = ed.flameSampleSeq + 1U;
                }
            }
        } else if (flameRegistry >= 0 &&
                   HardwareConfig::channelRegistry.inputs[flameRegistry].driver ==
                       ChannelRegistry::I2cDigital) {
            ed.flameHealthy = ed.registryInputHealthy[flameRegistry];
            ed.flameDetected = ed.flameHealthy && ed.registryInputValue[flameRegistry] >= 0.5f;
            ed.flameSensorRaw = ed.flameDetected ? 1 : 0;
        } else if (hw.hasFlame) {
            g_sensorFlame.update();
            ed.flameSensorRaw = g_sensorFlame.rawCounts();
            ed.flameDetected  = g_sensorFlame.getValue() > 0.5f;
            // Threshold flame detectors may legitimately use either ADC rail
            // as their binary ON/OFF state; fitted-channel availability is the
            // only generic health information this interface can provide.
            ed.flameHealthy   = true;
            ed.flameSampleSeq = g_sensorFlame.sampleSequence();
            ed.flameSampleMs  = g_sensorFlame.sampleTimestampMs();
        }
        if (hw.hasIdleInput && !hw.idleInputRcPwm && idleRegistry < 0) {
            g_sensorIdleInput.update();
            ed.idleInputRaw = g_sensorIdleInput.rawCounts();
            ed.idleInputValid = g_sensorIdleInput.railHealthy();
            if (!ed.idleInputValid) ed.idleInputRaw = Config::idleMinRaw;
        }
        // Throttle input — ADC path; RC PWM path writes throttleInputRaw via RCInput::tick()
        if (hw.hasThrottleInput && !hw.throttleInputRcPwm && throttleRegistry < 0) {
            g_sensorThrottleInput.update();
            ed.throttleInputRaw = g_sensorThrottleInput.rawCounts();
            ed.throttleInputValid = g_sensorThrottleInput.railHealthy();
            if (!ed.throttleInputValid) ed.throttleInputRaw = Config::throttleMinRaw;
        }
        if (abCommandRegistry >= 0) {
            ed.abInputValid = ed.registryInputHealthy[abCommandRegistry];
            ed.abInputNorm = ed.abInputValid
                ? constrain(ed.registryInputValue[abCommandRegistry], 0.0f, 1.0f)
                : 0.0f;
            ed.abInputRaw = (int32_t)(ed.abInputNorm * 4095.0f + 0.5f);
        }
        // AB flame sensor (dedicated, optional)
        if (hw.hasAbFlame && hw.abFlamePin >= 0) {
            g_sensorAbFlame.update();
            ed.abFlameOn = (g_sensorAbFlame.getValue() > 0.5f);
            ed.abFlameHealthy = true;  // binary rail states are valid ON/OFF states
        }
        // AB analog/RC trigger input
        if (hw.hasAfterburner && hw.abInputPin >= 0 && !hw.abInputRcPwm &&
            (hw.abTriggerSource == 3 || Config::abPumpControlMode == 2)) {
            g_sensorAbInput.update();
            ed.abInputRaw = g_sensorAbInput.rawCounts();
            ed.abInputNorm = constrain(ed.abInputRaw / 4095.0f, 0.0f, 1.0f);
            ed.abInputValid = g_sensorAbInput.railHealthy();
            if (!ed.abInputValid) { ed.abInputRaw = 0; ed.abInputNorm = 0.0f; }
        }
        // AB arm switch
        if (hw.abRequiresArmSwitch && hw.abArmSwitchPin >= 0) {
            bool pressed = (digitalRead(hw.abArmSwitchPin) ==
                            (hw.abArmSwitchActiveH ? HIGH : LOW));
            ed.abArmSwitchOn = pressed;
        }
        // ── New sensors ──────────────────────────────────────────
        if (oilTempAnalog >= 0) {
            ed.oilTemp = ed.registryInputValue[oilTempAnalog];
            const auto& channel = HardwareConfig::channelRegistry.inputs[oilTempAnalog];
            if (channel.driver == ChannelRegistry::I2cAnalog) {
                float value = 0.0f; int32_t raw = 0; uint32_t seq = 0, sampleMs = 0;
                I2CDeviceManager::input(oilTempAnalog, value, raw, seq, sampleMs);
                ed.oilTempRaw = raw;
            } else {
                ed.oilTempRaw = analogRead(channel.pin);
            }
            ed.oilTempHealthy = ed.registryInputHealthy[oilTempAnalog];
            if (ed.oilTempHealthy && ed.oilTemp > ed.maxOilTemp) ed.maxOilTemp = ed.oilTemp;
        } else if (hw.hasOilTemp && g_pSensorOilTemp) {
            g_pSensorOilTemp->update();
            ed.oilTemp        = g_pSensorOilTemp->getValue();
            ed.oilTempRaw     = (strcmp(hw.oilTempChip, "ntc") == 0) ? g_sensorOilTempNtc.rawCounts() : 0;
            ed.oilTempHealthy = g_pSensorOilTemp->isHealthy();
            if (ed.oilTempHealthy && ed.oilTemp > ed.maxOilTemp) ed.maxOilTemp = ed.oilTemp;
        }
        if (oilTempSpecial >= 0) {
            ed.registryInputValue[oilTempSpecial] = ed.oilTemp;
            ed.registryInputHealthy[oilTempSpecial] = ed.oilTempHealthy;
        }
        if (battAnalog >= 0) {
            ed.battVoltage = ed.registryInputValue[battAnalog];
            ed.battHealthy = ed.registryInputHealthy[battAnalog];
            if (ed.battHealthy && ed.battVoltage > ed.maxBattVoltage) ed.maxBattVoltage = ed.battVoltage;
        } else if (hw.hasBattVoltage) {
            g_sensorBattVolt.update();
            ed.battVoltage  = g_sensorBattVolt.getValue();
            ed.battHealthy  = g_sensorBattVolt.isHealthy();
            if (ed.battHealthy && ed.battVoltage > ed.maxBattVoltage) ed.maxBattVoltage = ed.battVoltage;
        }
        if (hw.hasTorque) {
            if (torqueRegistry >= 0 &&
                HardwareConfig::channelRegistry.inputs[torqueRegistry].driver ==
                    ChannelRegistry::I2cLoadCell) {
                float rawValue = 0.0f; int32_t raw = 0; uint32_t seq = 0, sampleMs = 0;
                ed.torqueHealthy = I2CDeviceManager::input(torqueRegistry, rawValue, raw, seq, sampleMs);
                if (ed.torqueHealthy) {
                    ed.torque = rawValue; ed.torqueRaw = raw;
                    ed.torqueSampleSeq = seq; ed.torqueSampleMs = sampleMs;
                }
            } else if (hw.torqueHx711) {
                g_sensorTorqueHx711.update();
                ed.torque        = g_sensorTorqueHx711.getValue();
                ed.torqueRaw     = (int)g_sensorTorqueHx711.rawCounts();
                ed.torqueHealthy = g_sensorTorqueHx711.isHealthy();
                const uint32_t seq = g_sensorTorqueHx711.sampleSequence();
                if (seq != ed.torqueSampleSeq) {
                    ed.torqueSampleSeq = seq;
                    const uint32_t sampleMs = g_sensorTorqueHx711.sampleTimestampMs();
                    ed.torqueSampleMs = sampleMs ? sampleMs : millis();
                }
            } else {
                g_sensorTorque.update();
                ed.torque        = g_sensorTorque.getValue();
                ed.torqueRaw     = g_sensorTorque.rawCounts();
                ed.torqueHealthy = g_sensorTorque.isHealthy();
                const uint32_t seq = g_sensorTorque.sampleSequence();
                if (seq != ed.torqueSampleSeq) {
                    ed.torqueSampleSeq = seq;
                    const uint32_t sampleMs = g_sensorTorque.sampleTimestampMs();
                    ed.torqueSampleMs = sampleMs ? sampleMs : millis();
                }
            }
            // shaft power = torque × angular velocity of N2
            if (ed.torqueHealthy && ed.n2Healthy && ed.n2Rpm > 0) {
                float omega = ed.n2Rpm * (2.0f * 3.14159f / 60.0f); // rad/s
                ed.turboPower = ed.torque * omega;
            } else {
                ed.turboPower = 0.0f;
            }
        }
        if (hw.hasThrust && thrustRegistry >= 0) {
            float value = 0.0f; int32_t raw = 0; uint32_t seq = 0, sampleMs = 0;
            ed.thrustHealthy = I2CDeviceManager::input(thrustRegistry, value, raw, seq, sampleMs);
            if (ed.thrustHealthy) {
                ed.thrust = value; ed.thrustRaw = raw;
                ed.thrustSampleSeq = seq; ed.thrustSampleMs = sampleMs;
            }
        }
        if (fuelFlowAnalog >= 0) {
            ed.fuelFlow = ed.registryInputValue[fuelFlowAnalog];
            ed.fuelFlowHealthy = ed.registryInputHealthy[fuelFlowAnalog];
        } else if (hw.hasFuelFlow) {
            if (hw.fuelFlowType == 1) {
                g_sensorFuelFlowPulse.update();
                // RPM = pulses/min; divide by pulsesPerLitre → litres/min
                float ppl = hw.fuelFlowPulsesPerLitre > 0 ? hw.fuelFlowPulsesPerLitre : 1.0f;
                ed.fuelFlow = g_sensorFuelFlowPulse.getValue() / ppl;
                ed.fuelFlowHealthy = g_sensorFuelFlowPulse.isHealthy();
            } else {
                g_sensorFuelFlow.update();
                ed.fuelFlow = g_sensorFuelFlow.getValue();
                ed.fuelFlowHealthy = g_sensorFuelFlow.isHealthy();
            }
        }
        if (p1Analog >= 0) {
            ed.p1 = ed.registryInputValue[p1Analog];
            ed.p1Healthy = ed.registryInputHealthy[p1Analog];
            if (g_registryAnalogLastMs[p1Analog] != ed.p1SampleMs) {
                ed.p1SampleSeq = ed.p1SampleSeq + 1U;
                ed.p1SampleMs = g_registryAnalogLastMs[p1Analog];
            }
        } else if (hw.hasP1) {
            g_sensorP1.update();
            ed.p1 = g_sensorP1.getValue();
            ed.p1Healthy = g_sensorP1.isHealthy();
            const uint32_t seq = g_sensorP1.sampleSequence();
            if (seq != ed.p1SampleSeq) {
                ed.p1SampleSeq = seq;
                const uint32_t sampleMs = g_sensorP1.sampleTimestampMs();
                ed.p1SampleMs = sampleMs ? sampleMs : millis();
            }
        }
        if (p2Analog >= 0) {
            ed.p2 = ed.registryInputValue[p2Analog];
            ed.p2Healthy = ed.registryInputHealthy[p2Analog];
            if (g_registryAnalogLastMs[p2Analog] != ed.p2SampleMs) {
                ed.p2SampleSeq = ed.p2SampleSeq + 1U;
                ed.p2SampleMs = g_registryAnalogLastMs[p2Analog];
            }
        } else if (hw.hasP2) {
            g_sensorP2.update();
            ed.p2 = g_sensorP2.getValue();
            ed.p2Healthy = g_sensorP2.isHealthy();
            const uint32_t seq = g_sensorP2.sampleSequence();
            if (seq != ed.p2SampleSeq) {
                ed.p2SampleSeq = seq;
                const uint32_t sampleMs = g_sensorP2.sampleTimestampMs();
                ed.p2SampleMs = sampleMs ? sampleMs : millis();
            }
        }
        if (fuelPressAnalog >= 0) {
            const auto& c = HardwareConfig::channelRegistry.inputs[fuelPressAnalog];
            ed.fuelPressure = ed.registryInputValue[fuelPressAnalog];
            ed.fuelPressRaw = analogRead(c.pin);
            ed.fuelPressHealthy = ed.registryInputHealthy[fuelPressAnalog];
        } else if (hw.hasFuelPress) {
            g_sensorFuelPress.update();
            ed.fuelPressure     = g_sensorFuelPress.getValue();
            ed.fuelPressRaw     = g_sensorFuelPress.rawCounts();
            ed.fuelPressHealthy = g_sensorFuelPress.isHealthy();
        }
        if (hw.hasGlowCurrentSensor) {
            g_sensorGlowCurrent.update();
            ed.glowCurrentAmps = g_sensorGlowCurrent.getValue();
            ed.glowCurrentHealthy = g_sensorGlowCurrent.railHealthy();
            // Plug is hot when current has dropped below threshold and plug is
            // powered.  Health gate: a disconnected/railed ADC reads ~0 A and
            // would instantly flag a cold plug 'hot' (GlowPreheat has its own
            // waitHotTimeout, so an unhealthy sensor cannot hang the sequence).
            ed.glowPlugHot = ed.glowCurrentHealthy &&
                             (ed.glowPlugDemand > 0.05f) &&
                             (ed.glowCurrentAmps <= hw.glowCurrentReadyAmps);
        }
        if (hw.hasIgniterCurrentSensor) {
            g_sensorIgniterCurrent.update();
            ed.igniterCurrentAmps = g_sensorIgniterCurrent.getValue();
            ed.igniterCurrentHealthy = g_sensorIgniterCurrent.railHealthy();
        }
        if (hw.hasIgniter2CurrentSensor) {
            g_sensorIgniter2Current.update();
            ed.igniter2CurrentAmps = g_sensorIgniter2Current.getValue();
            ed.igniter2CurrentHealthy = g_sensorIgniter2Current.railHealthy();
        }
        if (hw.hasOilPumpCurrentSensor) {
            g_sensorOilPumpCurrent.update();
            ed.oilPumpCurrentAmps = g_sensorOilPumpCurrent.getValue();
            ed.oilPumpCurrentHealthy = g_sensorOilPumpCurrent.railHealthy();
            ed.oilPumpOvercurrent = ed.oilPumpCurrentHealthy && (hw.oilPumpCurrentMaxAmps > 0.0f)
                                    && (ed.oilPumpCurrentAmps > hw.oilPumpCurrentMaxAmps);
        }
    }

    // ── Boot-safe relay states ────────────────────────────────
    // Drive the RUNTIME-configured fuel solenoid / igniter(s) / starter-enable
    // pins to their inactive level.  PlatformInit::begin() parks the compile-time
    // OT_* pins as the first line of defense, but the config may remap these
    // outputs, leaving the real pin floating until initActuators().  Called from
    // setup() immediately after HardwareConfig::load() succeeds.
    inline void driveBootSafeStates() {
        auto& hw = HardwareConfig::instance();
        auto driveInactive = [](int pin, bool activeH) {
            if (pin < 0) return;
            digitalWrite(pin, activeH ? LOW : HIGH);
            pinMode(pin, OUTPUT);
        };
        auto parkProportional = [&](bool fitted, int pin, int type, bool relayActiveH, bool pwmInverted = false) {
            if (!fitted || pin < 0) return;
            if (type == 2) driveInactive(pin, relayActiveH);
            else driveInactive(pin, !pwmInverted); // no pulse/duty is the safe pre-attach state
        };
        parkProportional(hw.hasThrottle, hw.throttlePin, hw.throttleType, hw.throttleActiveH, hw.throttleInverted);
        parkProportional(hw.hasStarter, hw.starterPin, hw.starterType, hw.starterActiveH, hw.starterInverted);
        parkProportional(hw.hasOilPump, hw.oilPumpPin, hw.oilPumpType, hw.oilPumpActiveH);
        parkProportional(hw.hasFuelPump2, hw.fuelPump2Pin, hw.fuelPump2Type, hw.fuelPump2ActiveH);
        parkProportional(hw.hasAbPump, hw.abPumpPin, hw.abPumpType, hw.abPumpActiveH);
        parkProportional(hw.hasOilScavengePump, hw.oilScavPumpPin, hw.oilScavPumpType, hw.oilScavPumpActiveH);
        if (hw.hasGlowPlug && hw.glowPlugType == 2 && hw.wetGlowFuelPin >= 0) {
            if (hw.wetGlowFuelType == 0) driveInactive(hw.wetGlowFuelPin, hw.wetGlowFuelActiveH);
            else driveInactive(hw.wetGlowFuelPin, true);
        }
        if (hw.hasFuelSol)   driveInactive(hw.fuelSolPin, hw.fuelSolActiveH);
        // PWM igniter drive is active-high (LEDC duty 0 = pin LOW);
        // igniterActiveH applies in relay/coil mode only.
        if (hw.hasIgniter)   driveInactive(hw.igniterPin,
                                           hw.igniterPwm ? true : hw.igniterActiveH);
        if (hw.hasIgniter2)  driveInactive(hw.igniter2Pin,
                                           hw.igniter2Pwm ? true : hw.igniter2ActiveH);
        if (hw.hasGlowPlug)  driveInactive(hw.glowPlugPin,
                                           hw.glowPlugOutputType == 1 ? hw.glowPlugActiveH : true);
        if (hw.hasStarterEn) driveInactive(hw.starterEnPin, hw.starterEnActiveH);
        if (hw.hasAbSol) driveInactive(hw.abSolPin, hw.abSolActiveH);
        if (hw.hasAirstarterSol) driveInactive(hw.airstarterSolPin, hw.airstarterSolActiveH);
        for (uint8_t i = 0; i < HardwareConfig::channelRegistry.outputCount; ++i) {
            const auto& c = HardwareConfig::channelRegistry.outputs[i];
            if (!registryOutputManaged(c)) continue;
            if (c.driver == ChannelRegistry::I2cRelay) continue; // parked by manager
            const float safe = constrain(c.safeDemand, 0.0f, 1.0f);
            const bool high = (c.inverted ? 1.0f - safe : safe) >= 0.5f;
            digitalWrite(c.pin, high ? HIGH : LOW);
            pinMode(c.pin, OUTPUT);
        }
        // A separately powered TCA9554 retains its output latch while the ESP
        // resets. Bring the shared bus up before Wi-Fi and park every assigned
        // remote output after all native outputs have reached their safe state.
        I2CDeviceManager::begin(hw.i2cEnabled, hw.i2cSdaPin, hw.i2cSclPin,
                                hw.i2cInterruptPin,
                                hw.i2cFrequencyHz, hw.channelRegistry);
    }

    // ── Actuator init ─────────────────────────────────────────
    inline void initActuators() {
        auto& hw = HardwareConfig::instance();
        auto& ed = EngineData::instance();
        if (hw.hasThrottle) {
            if (hw.throttleType == 1) {
                g_actThrottleLedc.setInverted(hw.throttleInverted);
                g_actThrottleLedc.setOutputRange(hw.throttlePwmMinPct, hw.throttlePwmMaxPct);
                g_actThrottleLedc.begin(hw.throttlePin, (uint32_t)hw.throttleLedcFreqHz, (uint8_t)hw.throttleLedcBits);
                g_actThrottle = &g_actThrottleLedc;
            } else if (hw.throttleType == 2) {
                g_actThrottleOnOff.begin(hw.throttlePin, hw.throttleActiveH);
                g_actThrottle = &g_actThrottleOnOff;
            } else {
                g_actThrottleServo.begin(hw.throttlePin, hw.throttleMinUs, hw.throttleMaxUs, hw.throttleInverted);
                g_actThrottle = &g_actThrottleServo;
            }
        }
        if (hw.hasStarter) {
            if (hw.starterType == 1) {
                g_actStarterLedc.setInverted(hw.starterInverted);
                g_actStarterLedc.setOutputRange(hw.starterPwmMinPct, hw.starterPwmMaxPct);
                g_actStarterLedc.begin(hw.starterPin, (uint32_t)hw.starterLedcFreqHz, (uint8_t)hw.starterLedcBits);
                g_actStarter = &g_actStarterLedc;
            } else if (hw.starterType == 2) {
                g_actStarterOnOff.begin(hw.starterPin, hw.starterActiveH);
                g_actStarter = &g_actStarterOnOff;
            } else {
                g_actStarterServo.begin(hw.starterPin, hw.starterMinUs, hw.starterMaxUs, hw.starterInverted);
                g_actStarter = &g_actStarterServo;
            }
        }
        if (hw.hasOilPump) {
            if (hw.oilPumpType == 2) {
                g_actOilPumpRelay.begin(hw.oilPumpPin, hw.oilPumpActiveH);
                g_actOilPump = &g_actOilPumpRelay;
            } else if (hw.oilPumpType == 0) {
                g_actOilPumpServo.begin(hw.oilPumpPin, hw.oilPumpMinUs, hw.oilPumpMaxUs, !hw.oilPumpActiveH);
                g_actOilPump = &g_actOilPumpServo;
            } else {
                g_actOilPumpLedc.setOutputRange(hw.oilPumpPwmMinPct, hw.oilPumpPwmMaxPct);
                g_actOilPumpLedc.begin(hw.oilPumpPin,
                                       (uint32_t)hw.oilPumpFreqHz,
                                       (uint8_t)hw.oilPumpResBits);
                g_actOilPump = &g_actOilPumpLedc;
            }
        }
        if (hw.hasFuelSol)
            g_actFuelSol.begin(hw.fuelSolPin, hw.fuelSolActiveH);
        if (hw.hasIgniter) {
            if (hw.igniterPwm) {
                int period = hw.igniterDwellMs + hw.igniterRestMs;
                uint32_t freq = (period > 0) ? (uint32_t)(1000u / (uint32_t)period) : 111u;
                if (freq == 0) freq = 1;
                // Long dwell/rest cycles need the extra timer divider range.
                // Eight-bit LEDC cannot generate much of the 1..200 ms UI range
                // on the S3 and used to leave a fitted igniter uninitialised.
                g_actIgniterLedc.begin(hw.igniterPin, freq, 14);
                g_actIgniter = &g_actIgniterLedc;
            } else {
                g_actIgniterRelay.begin(hw.igniterPin, hw.igniterActiveH);
                g_actIgniter = &g_actIgniterRelay;
            }
        }
        if (hw.hasIgniter2 && hw.igniter2Pin >= 0) {
            if (hw.igniter2Pwm) {
                int period = hw.igniter2DwellMs + hw.igniter2RestMs;
                uint32_t freq = (period > 0) ? (uint32_t)(1000u / (uint32_t)period) : 111u;
                if (freq == 0) freq = 1;
                g_actIgniter2Ledc.begin(hw.igniter2Pin, freq, 14);
                g_actIgniter2 = &g_actIgniter2Ledc;
            } else {
                g_actIgniter2Relay.begin(hw.igniter2Pin, hw.igniter2ActiveH);
                g_actIgniter2 = &g_actIgniter2Relay;
            }
        }
        if (hw.hasStarterEn) {
            const auto* starterEnable = registryStarterEnableOutput();
            if (!starterEnable || starterEnable->driver == ChannelRegistry::Relay)
                g_actStarterEn.begin(hw.starterEnPin, hw.starterEnActiveH);
        }
        if (hw.hasAbSol && hw.abSolPin >= 0)
            g_actAbSol.begin(hw.abSolPin, hw.abSolActiveH);
        if (hw.hasAirstarterSol && hw.airstarterSolPin >= 0) {
            const auto* airStarter = registryAirStarterOutput();
            if (!airStarter || airStarter->driver == ChannelRegistry::Relay)
                g_actAirstarterSol.begin(hw.airstarterSolPin, hw.airstarterSolActiveH);
        }
        if (hw.hasCoolFan && hw.coolFanPin >= 0) {
            if (hw.coolFanType == 0) {
                g_actCoolFanServo.begin(hw.coolFanPin, hw.coolFanMinUs, hw.coolFanMaxUs, !hw.coolFanActiveH);
                g_pActCoolFan = &g_actCoolFanServo;
            } else if (hw.coolFanType == 1) {
                g_actCoolFanLedc.setOutputRange(hw.coolFanPwmMinPct, hw.coolFanPwmMaxPct);
                g_actCoolFanLedc.begin(hw.coolFanPin, (uint32_t)hw.coolFanFreqHz, (uint8_t)hw.coolFanResBits);
                g_pActCoolFan = &g_actCoolFanLedc;
            } else {
                g_actCoolFan.begin(hw.coolFanPin, hw.coolFanActiveH);
                g_pActCoolFan = &g_actCoolFan;
            }
        }
        if (hw.hasAbPump && hw.abPumpPin >= 0) {
            if (hw.abPumpType == 0) {
                g_actAbPumpServo.begin(hw.abPumpPin, hw.abPumpMinUs, hw.abPumpMaxUs, !hw.abPumpActiveH);
                g_actAbPump = &g_actAbPumpServo;
            } else if (hw.abPumpType == 1) {
                g_actAbPumpLedc.setOutputRange(hw.abPumpPwmMinPct, hw.abPumpPwmMaxPct);
                g_actAbPumpLedc.begin(hw.abPumpPin, (uint32_t)hw.abPumpFreqHz, (uint8_t)hw.abPumpResBits);
                g_actAbPump = &g_actAbPumpLedc;
            } else {
                g_actAbPumpRelay.begin(hw.abPumpPin, hw.abPumpActiveH);
                g_actAbPump = &g_actAbPumpRelay;
            }
        }
        if (hw.hasOilScavengePump && hw.oilScavPumpPin >= 0) {
            if (hw.oilScavPumpType == 0) {
                g_actOilScavServo.begin(hw.oilScavPumpPin,
                                        hw.oilScavPumpMinUs,
                                        hw.oilScavPumpMaxUs, !hw.oilScavPumpActiveH);
                g_actOilScavPump = &g_actOilScavServo;
            } else if (hw.oilScavPumpType == 1) {
                g_actOilScavLedc.setOutputRange(hw.oilScavPumpPwmMinPct, hw.oilScavPumpPwmMaxPct);
                g_actOilScavLedc.begin(hw.oilScavPumpPin,
                                       (uint32_t)hw.oilScavPumpFreqHz,
                                       (uint8_t)hw.oilScavPumpResBits);
                g_actOilScavPump = &g_actOilScavLedc;
            } else {
                g_actOilScavRelay.begin(hw.oilScavPumpPin, hw.oilScavPumpActiveH);
                g_actOilScavPump = &g_actOilScavRelay;
            }
        }
        if (hw.hasFuelPump2 && hw.fuelPump2Pin >= 0) {
            if (hw.fuelPump2Type == 2) {
                g_actFuelPump2Relay.begin(hw.fuelPump2Pin, hw.fuelPump2ActiveH);
                g_actFuelPump2 = &g_actFuelPump2Relay;
            } else if (hw.fuelPump2Type == 0) {
                g_actFuelPump2Servo.begin(hw.fuelPump2Pin, hw.fuelPump2MinUs, hw.fuelPump2MaxUs, !hw.fuelPump2ActiveH);
                g_actFuelPump2 = &g_actFuelPump2Servo;
            } else {
                g_actFuelPump2Ledc.setOutputRange(hw.fuelPump2PwmMinPct, hw.fuelPump2PwmMaxPct);
                g_actFuelPump2Ledc.begin(hw.fuelPump2Pin,
                                         (uint32_t)hw.fuelPump2FreqHz,
                                         (uint8_t)hw.fuelPump2ResBits);
                g_actFuelPump2 = &g_actFuelPump2Ledc;
            }
        }
        if (hw.hasBleedValve && hw.bleedValvePin >= 0) {
            if (hw.bleedValveType == 1) {
                g_actBleedValveServo.begin(hw.bleedValvePin, hw.bleedValveMinUs, hw.bleedValveMaxUs, !hw.bleedValveActiveH);
                g_actBleedValve = &g_actBleedValveServo;
            } else if (hw.bleedValveType == 2) {
                g_actBleedValveLedc.setOutputRange(hw.bleedValvePwmMinPct, hw.bleedValvePwmMaxPct);
                g_actBleedValveLedc.begin(hw.bleedValvePin, (uint32_t)hw.bleedValveFreqHz, (uint8_t)hw.bleedValveResBits);
                g_actBleedValve = &g_actBleedValveLedc;
            } else {
                g_actBleedValveRelay.begin(hw.bleedValvePin, hw.bleedValveActiveH);
                g_actBleedValve = &g_actBleedValveRelay;
            }
        }
        if (hw.hasPropPitch && hw.propPitchPin >= 0) {
            if (hw.propPitchType == 1) {
                g_actPropPitchLedc.setOutputRange(hw.propPitchPwmMinPct, hw.propPitchPwmMaxPct);
                g_actPropPitchLedc.begin(hw.propPitchPin, (uint32_t)hw.propPitchFreqHz, (uint8_t)hw.propPitchResBits);
                g_actPropPitch = &g_actPropPitchLedc;
            } else if (hw.propPitchType == 2) {
                g_actPropPitchRelay.begin(hw.propPitchPin, hw.propPitchActiveH);
                g_actPropPitch = &g_actPropPitchRelay;
            } else {
                g_actPropPitchServo.begin(hw.propPitchPin, hw.propPitchMinUs, hw.propPitchMaxUs, !hw.propPitchActiveH);
                g_actPropPitch = &g_actPropPitchServo;
            }
        }
        if (hw.hasGlowPlug && hw.glowPlugPin >= 0) {
            if (hw.glowPlugOutputType == 1) {
                g_actGlowPlugRelay.begin(hw.glowPlugPin, hw.glowPlugActiveH);
            } else {
                g_actGlowPlug.setOutputRange(hw.glowPlugPwmMinPct, hw.glowPlugPwmMaxPct);
                g_actGlowPlug.begin(hw.glowPlugPin, (uint32_t)hw.glowPlugFreqHz,
                                    (uint8_t)hw.glowPlugResBits);
            }
        }
        if (hw.hasGlowPlug && hw.glowPlugType == 2 && hw.wetGlowFuelPin >= 0) {
            if (hw.wetGlowFuelType == 2) {
                g_actWetGlowFuelServo.begin(hw.wetGlowFuelPin, hw.wetGlowFuelMinUs, hw.wetGlowFuelMaxUs, !hw.wetGlowFuelActiveH);
                g_actWetGlowFuel = &g_actWetGlowFuelServo;
            } else if (hw.wetGlowFuelType == 1) {
                g_actWetGlowFuelLedc.setOutputRange(hw.wetGlowFuelPwmMinPct, hw.wetGlowFuelPwmMaxPct);
                g_actWetGlowFuelLedc.begin(hw.wetGlowFuelPin, (uint32_t)hw.wetGlowFuelFreqHz,
                                           (uint8_t)hw.wetGlowFuelResBits);
                g_actWetGlowFuel = &g_actWetGlowFuelLedc;
            } else {
                g_actWetGlowFuelRelay.begin(hw.wetGlowFuelPin, hw.wetGlowFuelActiveH);
                g_actWetGlowFuel = &g_actWetGlowFuelRelay;
            }
        }
        initRegistryOutputs(-1.0f);
        auto requireReady = [&](bool fitted, IActuator* actuator, const char* label) {
            if (!fitted || (actuator && actuator->isReady())) return;
            ed.hardwareReady = false;
            snprintf(ed.hardwareFault, sizeof(ed.hardwareFault), "%s output failed to initialize", label);
        };
        requireReady(hw.hasThrottle, g_actThrottle, "Main fuel/throttle");
        requireReady(hw.hasStarter, g_actStarter, "Starter");
        requireReady(hw.hasOilPump, g_actOilPump, "Oil pump");
        requireReady(hw.hasFuelPump2, g_actFuelPump2, "Secondary fuel pump");
        requireReady(hw.hasAfterburner && hw.hasAbPump, g_actAbPump, "Afterburner pump");
        if (hw.hasFuelSol && !g_actFuelSol.isReady()) requireReady(true, &g_actFuelSol, "Fuel shutoff");
        requireReady(hw.hasIgniter, g_actIgniter, "Primary igniter");
        requireReady(hw.hasIgniter2, g_actIgniter2, "Secondary igniter");
        requireReady(hw.hasStarterEn && (!registryStarterEnableOutput() || registryStarterEnableOutput()->driver == ChannelRegistry::Relay),
                     &g_actStarterEn, "Starter enable");
        requireReady(hw.hasAbSol, &g_actAbSol, "Afterburner shutoff");
        {
            const auto* airStarter = registryAirStarterOutput();
            requireReady(hw.hasAirstarterSol && (!airStarter || airStarter->driver == ChannelRegistry::Relay),
                         &g_actAirstarterSol, "Air starter valve");
        }
        requireReady(hw.hasCoolFan, g_pActCoolFan, "Cooling fan");
        requireReady(hw.hasOilScavengePump, g_actOilScavPump, "Oil scavenge pump");
        requireReady(hw.hasBleedValve, g_actBleedValve, "Bleed valve");
        requireReady(hw.hasPropPitch, g_actPropPitch, "Propeller pitch");
        requireReady(hw.hasGlowPlug,
                     hw.glowPlugOutputType == 1 ? (IActuator*)&g_actGlowPlugRelay : (IActuator*)&g_actGlowPlug,
                     "Glow plug");
        const bool registryWetGlowFuel =
            registryPurposeOutputIndex("pilot_fuel") >= 0 ||
            registryPurposeOutputIndex("wet_glow_fuel") >= 0;
        requireReady(hw.hasGlowPlug && hw.glowPlugType == 2 && !registryWetGlowFuel,
                     g_actWetGlowFuel, "Wet-glow fuel");
        if (!ed.hardwareReady) Serial.printf("[HW] START readiness fault: %s\n", ed.hardwareFault);
    }

    // ── Actuator update: EngineData demands → physical signals ─
    inline void updateActuators() {
        auto& hw = HardwareConfig::instance();
        auto& ed = EngineData::instance();
        // Keep this at the final actuator boundary so no controller or rule
        // can restore fine pitch later in a degraded/failure loop iteration.
        if (ed.limpMode && hw.hasPropPitch) ed.propPitchDemand = 1.0f;
        applyFaultSafeOutputs();
        applyShutdownCombustionInvariant();
        // AB main-fuel offset is added here at the actuator write, NOT to throttleDemand,
        // so ThrottleSlew's feedback loop never sees the inflated value.
        if (hw.hasThrottle && g_actThrottle) {
            float demand = constrain(ed.throttleDemand + ed.abFuelOffset, 0.0f, 1.0f);
            // Reduced-Power Mode promises a cap on the actual main-fuel output.
            // Enforce it after the AB offset is composed so afterburner compressor-
            // fuel coordination cannot bypass a manual or feedback-loss cap.
            if (ed.limpMode && ed.mode == SysMode::RUNNING) {
                demand = min(demand,
                             constrain(Config::limpMaxThrottlePct / 100.0f, 0.0f, 1.0f));
            }
            // Standby calibration/tools intentionally bypass the saved min-spin
            // threshold so the operator can measure or lower the threshold.
            if (ed.mode != SysMode::STANDBY) demand = Config::applyFuelPumpMinimum(demand);
            g_actThrottle->set(demand);
            if (demand > 0.001f) ed.fuelEverOpened = true;
        }

        // Starter enable output
        if (hw.hasStarterEn) {
            const auto* starterEnable = registryStarterEnableOutput();
            if (!starterEnable || starterEnable->driver == ChannelRegistry::Relay)
                g_actStarterEn.set(ed.starterEnabled ? 1.0f : 0.0f);
        }
        // Only allow starter to spin once the enable relay is on and its
        // delay has elapsed — with the relay off, the demand must not reach
        // the ESC/motor (the relay may not be the sole power gate).
        if (hw.hasStarter && g_actStarter) {
            static bool  _prevEn2 = false;
            static unsigned long _enMs2 = 0;
            if (ed.starterEnabled && !_prevEn2) _enMs2 = millis();
            _prevEn2 = ed.starterEnabled;
            bool delayOk = !hw.hasStarterEn ||
                           (ed.starterEnabled &&
                            ((millis() - _enMs2) >= (unsigned long)hw.starterEnDelayMs));
            g_actStarter->set(delayOk ? ed.starterDemand : 0.0f);
        }
        if (hw.hasAbPump      && g_actAbPump)      g_actAbPump->set(ed.abPumpDemand);
        if (hw.hasAbSol)         g_actAbSol.set(ed.abSolOpen ? 1.0f : 0.0f);
        if (hw.hasAirstarterSol) {
            const auto* airStarter = registryAirStarterOutput();
            if (!airStarter || airStarter->driver == ChannelRegistry::Relay)
                g_actAirstarterSol.set(ed.airstarterOpen ? 1.0f : 0.0f);
        }
        if (hw.hasCoolFan && g_pActCoolFan)  g_pActCoolFan->set(registryPurposeMinimum("cooling_fan", constrain(ed.coolFanDemand, 0.0f, 1.0f)));
        if (hw.hasOilScavengePump && g_actOilScavPump)
            g_actOilScavPump->set(registryPurposeMinimum("scavenge_pump", constrain(ed.oilScavengeDemand, 0.0f, 1.0f)));
        if (hw.hasOilPump && g_actOilPump) {
            float demand = (hw.oilPumpType == 2)
                         ? (ed.oilPumpPct > 0.0f ? 1.0f : 0.0f)
                         : (ed.oilPumpPct / 100.0f);
            g_actOilPump->set(demand);
        }
        if (hw.hasFuelSol) g_actFuelSol.set(ed.fuelSolOpen ? 1.0f : 0.0f);
        if (hw.hasIgniter && g_actIgniter) {
            if (hw.igniterCoil) {
                static bool     s_coilCharging   = false;
                static uint32_t s_coilPhaseStart = 0;
                if (ed.igniterOn) {
                    uint32_t now = millis();
                    // Dwell time is always the hard cap on charge duration;
                    // the current sensor only ends the charge early at coil
                    // saturation.  Without the cap, a failed-low sensor (or a
                    // weak supply never reaching satAmps) would leave the coil
                    // energized continuously, overheating coil and driver.
                    bool endCharge = (now - s_coilPhaseStart) >= (uint32_t)hw.igniterDwellMs;
                    if (hw.hasIgniterCurrentSensor &&
                        ed.igniterCurrentAmps >= hw.igniterCoilSatAmps)
                        endCharge = true;
                    if (s_coilCharging) {
                        if (endCharge) {
                            s_coilCharging   = false;
                            s_coilPhaseStart = now;
                            g_actIgniter->set(0.0f);
                        }
                    } else {
                        if ((now - s_coilPhaseStart) >= (uint32_t)hw.igniterRestMs) {
                            s_coilCharging   = true;
                            s_coilPhaseStart = now;
                            g_actIgniter->set(1.0f);
                        }
                    }
                } else {
                    // Reset phase timer to now so the rest period is measured
                    // from when the coil was actually switched off, not from
                    // the start of the previous charge phase.  Without this,
                    // a rapid off→on toggle could restart charging before the
                    // full rest period has elapsed.
                    s_coilCharging   = false;
                    s_coilPhaseStart = (uint32_t)millis();
                    g_actIgniter->set(0.0f);
                }
            } else {
                float duty = hw.igniterPwm
                    ? ((hw.igniterDwellMs + hw.igniterRestMs > 0)
                       ? ((float)hw.igniterDwellMs / (hw.igniterDwellMs + hw.igniterRestMs))
                       : 0.5f)
                    : 1.0f;
                g_actIgniter->set(ed.igniterOn ? duty : 0.0f);
            }
        }
        if (hw.hasIgniter2 && g_actIgniter2) {
            if (hw.igniter2Coil) {
                static bool     s_coil2Charging   = false;
                static uint32_t s_coil2PhaseStart = 0;
                if (ed.igniter2On) {
                    uint32_t now = millis();
                    // Same dwell hard cap as igniter 1 — current sensing only
                    // ends the charge early, never extends it.
                    bool endCharge = (now - s_coil2PhaseStart) >= (uint32_t)hw.igniter2DwellMs;
                    if (hw.hasIgniter2CurrentSensor &&
                        ed.igniter2CurrentAmps >= hw.igniter2CoilSatAmps)
                        endCharge = true;
                    if (s_coil2Charging) {
                        if (endCharge) {
                            s_coil2Charging   = false;
                            s_coil2PhaseStart = now;
                            g_actIgniter2->set(0.0f);
                        }
                    } else {
                        if ((now - s_coil2PhaseStart) >= (uint32_t)hw.igniter2RestMs) {
                            s_coil2Charging   = true;
                            s_coil2PhaseStart = now;
                            g_actIgniter2->set(1.0f);
                        }
                    }
                } else {
                    s_coil2Charging   = false;
                    s_coil2PhaseStart = (uint32_t)millis();
                    g_actIgniter2->set(0.0f);
                }
            } else {
                float duty2 = hw.igniter2Pwm
                    ? ((hw.igniter2DwellMs + hw.igniter2RestMs > 0)
                       ? ((float)hw.igniter2DwellMs / (hw.igniter2DwellMs + hw.igniter2RestMs))
                       : 0.5f)
                    : 1.0f;
                g_actIgniter2->set(ed.igniter2On ? duty2 : 0.0f);
            }
        }
        if (hw.hasFuelPump2 && g_actFuelPump2)
            g_actFuelPump2->set(registryPurposeMinimum("fuel_pump", constrain(ed.fuelPump2Demand, 0.0f, 1.0f)));
        if (hw.hasBleedValve && g_actBleedValve)
            g_actBleedValve->set(constrain(ed.bleedValveDemand, 0.0f, 1.0f));
        if (hw.hasPropPitch && g_actPropPitch)
            g_actPropPitch->set(ed.propPitchDemand);
        if (hw.hasGlowPlug) {
            float glowDemand = constrain(ed.glowPlugDemand, 0.0f, 1.0f);
            if (hw.glowPlugOutputType == 1)
                g_actGlowPlugRelay.setOn(glowDemand > 0.001f);
            else
                g_actGlowPlug.set(glowDemand);
            const bool registryWetGlowFuel =
                registryPurposeOutputIndex("pilot_fuel") >= 0 ||
                registryPurposeOutputIndex("wet_glow_fuel") >= 0;
            if (hw.glowPlugType == 2 && (g_actWetGlowFuel || registryWetGlowFuel)) {
                static bool s_wetGlowActive = false;
                static unsigned long s_wetGlowOnMs = 0;
                bool commandOn = glowDemand > 0.001f;
                if (commandOn && !s_wetGlowActive) {
                    s_wetGlowActive = true;
                    s_wetGlowOnMs = millis();
                    ed.wetGlowFuelDemand = 0.0f;
                    if (g_actWetGlowFuel) g_actWetGlowFuel->off();
                } else if (!commandOn) {
                    s_wetGlowActive = false;
                    s_wetGlowOnMs = 0;
                    ed.wetGlowFuelDemand = 0.0f;
                    if (g_actWetGlowFuel) g_actWetGlowFuel->off();
                }
                if (commandOn && s_wetGlowActive &&
                    (millis() - s_wetGlowOnMs) >= (unsigned long)hw.wetGlowFuelDelayMs) {
                    float fuelDemand = hw.wetGlowFuelType == 0 ? 1.0f : (hw.wetGlowFuelDemandPct / 100.0f);
                    ed.wetGlowFuelDemand = constrain(fuelDemand, 0.0f, 1.0f);
                    if (g_actWetGlowFuel) g_actWetGlowFuel->set(ed.wetGlowFuelDemand);
                }
            } else {
                ed.wetGlowFuelDemand = 0.0f;
            }
        }
        updateRegistryOutputs();
    }

    // ── Emergency all-off ─────────────────────────────────────
    inline void allOff() {
        auto& hw = HardwareConfig::instance();
        if (hw.hasThrottle && g_actThrottle)  g_actThrottle->off();
        if (hw.hasStarter  && g_actStarter)   g_actStarter->off();
        if (hw.hasOilPump && g_actOilPump)    g_actOilPump->off();
        if (hw.hasFuelSol)                    g_actFuelSol.off();
        if (hw.hasIgniter && g_actIgniter)    g_actIgniter->off();
        if (hw.hasIgniter2 && g_actIgniter2)  g_actIgniter2->off();
        if (hw.hasStarterEn)                  g_actStarterEn.off();
        if (hw.hasAbPump && g_actAbPump)       g_actAbPump->off();
        if (hw.hasAbSol)                        g_actAbSol.off();
        if (hw.hasAirstarterSol)               g_actAirstarterSol.off();
        if (hw.hasCoolFan && g_pActCoolFan)    g_pActCoolFan->off();
        if (hw.hasOilScavengePump && g_actOilScavPump) g_actOilScavPump->off();
        if (hw.hasFuelPump2 && g_actFuelPump2) g_actFuelPump2->off();
        if (hw.hasBleedValve && g_actBleedValve)  g_actBleedValve->off();
        if (hw.hasPropPitch  && g_actPropPitch)   g_actPropPitch->set(0.0f);  // return to fine pitch
        if (hw.hasGlowPlug) {
            if (hw.glowPlugOutputType == 1) g_actGlowPlugRelay.off();
            else g_actGlowPlug.off();
        }
        if (hw.hasGlowPlug && hw.glowPlugType == 2 && g_actWetGlowFuel) g_actWetGlowFuel->off();
        faultRegistryOutputs();
        auto& _ed = EngineData::instance();
        _ed.throttleDemand  = 0;
        _ed.fuelSolOpen     = false;
        _ed.igniterOn       = false;
        _ed.starterDemand   = 0;
        _ed.starterEnabled  = false;
        _ed.oilPumpPct      = 0;
        _ed.oilTargetBar    = 0;   // clear the loop target too (matches enterStandby/ImmediateCut/FinalStop)
        _ed.oilScavengeDemand = 0.0f; _ed.oilScavengeOn = false;
        _ed.abSolOpen       = false;
        _ed.abPumpDemand    = 0;
        _ed.fuelPump2Demand  = 0;
        _ed.propPitchDemand  = 0;
        _ed.abFuelOffset     = 0.0f;
        _ed.bleedValveDemand = 0.0f; _ed.bleedValveOpen = false;
        _ed.glowPlugDemand   = 0;
        _ed.wetGlowFuelDemand = 0;
        _ed.surgeDetected    = false;
        _ed.igniter2On      = false;
        _ed.abMode          = ABMode::Off;
        _ed.airstarterOpen  = false;
        _ed.coolFanDemand = 0.0f; _ed.coolFanOn = false;
    }

    // ── Status LED init / tick ────────────────────────────────
    inline void initStatusLED() {
        auto& hw = HardwareConfig::instance();
        // Respect hasStatusLed on every platform. On the S3 this used to run
        // unconditionally, so disabling the status LED in the hardware config had
        // no effect and the onboard NeoPixel stayed lit. When disabled, actively
        // clear the LED (it latches its last colour otherwise).
        if (hw.hasStatusLed) StatusLED::begin();
        else                 StatusLED::off();
    }
    inline void tickStatusLED() {
        if (HardwareConfig::instance().hasStatusLed) StatusLED::tick();
    }

    // ── Controller init ───────────────────────────────────────
    inline void initControllers() {
        auto& hw = HardwareConfig::instance();
        if (hw.hasOilLoop)      g_ctrlOilLoop.begin();
        if (hw.hasThrottle) g_ctrlThrottleSlew.begin();
        if (hw.hasDynamicIdle)  g_ctrlDynamicIdle.begin();
        if (hw.hasGovernor)     g_ctrlGovernor.begin();
        for (uint8_t i = 0; i < HardwareConfig::MAX_OIL_LOOPS; ++i) {
            g_registryOilLoopPct[i] = 0.0f;
            g_registryOilLoopFailSinceMs[i] = 0;
            g_registryOilLoopFailArmed[i] = false;
        }
        g_registryOilLoopLastMs = millis();
    }

    inline void runAdditionalOilLoops() {
        auto& hw = HardwareConfig::instance();
        auto& ed = EngineData::instance();
        if (!hw.hasOilLoop || ed.benchMode) return;

        unsigned long now = millis();
        float dt = g_registryOilLoopLastMs
            ? (now - g_registryOilLoopLastMs) / 1000.0f : 1.0f / 400.0f;
        g_registryOilLoopLastMs = now;
        dt = constrain(dt, 0.0005f, 0.05f);

        bool legacyLoopSkipped = false;
        for (uint8_t i = 0; i < HardwareConfig::oilLoopCount; ++i) {
            const auto& loop = HardwareConfig::oilLoops[i];
            if (!loop.enabled) continue;
            if (!legacyLoopSkipped) {
                legacyLoopSkipped = true;
                continue;
            }
            if (loop.pressureInputIndex >= HardwareConfig::channelRegistry.inputCount ||
                loop.pumpOutputIndex >= HardwareConfig::channelRegistry.outputCount ||
                loop.pumpOutputIndex >= ChannelRegistry::MAX_OUTPUT_CHANNELS) continue;

            const auto& pump = HardwareConfig::channelRegistry.outputs[loop.pumpOutputIndex];
            if (!registryOutputManaged(pump)) continue;

            float minPct = constrain((float)loop.minDemandPct, 0.0f, 100.0f);
            float maxPct = constrain((float)loop.maxDemandPct, minPct, 100.0f);
            if (g_registryOilLoopPct[i] < minPct) g_registryOilLoopPct[i] = minPct;

            if (!ed.registryInputHealthy[loop.pressureInputIndex]) {
                if (!g_registryOilLoopFailArmed[i]) {
                    g_registryOilLoopFailArmed[i] = true;
                    g_registryOilLoopFailSinceMs[i] = now;
                } else if (now - g_registryOilLoopFailSinceMs[i] >=
                           (unsigned long)Config::oilFailsafeDelayMs) {
                    g_registryOilLoopPct[i] =
                        constrain(Config::oilFailsafePct, minPct, maxPct);
                }
                ed.registryOutputDemand[loop.pumpOutputIndex] = g_registryOilLoopPct[i] / 100.0f;
                continue;
            }
            g_registryOilLoopFailArmed[i] = false;
            g_registryOilLoopFailSinceMs[i] = 0;

            const float pressureBar = constrain(ed.registryInputValue[loop.pressureInputIndex], 0.0f, 20.0f);
            const float targetBar = loop.targetCentiBar / 100.0f;
            const float deadband = loop.deadbandCentiBar / 100.0f;
            const float error = targetBar - pressureBar;
            if (fabsf(error) > deadband) {
                g_registryOilLoopPct[i] = constrain(
                    g_registryOilLoopPct[i] + error * Config::oilAdjustScale * (dt * 400.0f),
                    minPct, maxPct);
            }
            ed.registryOutputDemand[loop.pumpOutputIndex] = g_registryOilLoopPct[i] / 100.0f;
        }
    }

    // ── Controller tick (RUNNING + late STARTUP) ──────────────
    inline void runControllers() {
        auto& hw   = HardwareConfig::instance();
        auto& ed   = EngineData::instance();
        auto  mode = ed.mode;
        if (mode != SysMode::RUNNING && mode != SysMode::STARTUP) return;

        // ── Operator throttle input → demand mapping ───────────
        // When a physical throttle input is configured (ADC pot or RC stick),
        // map it directly to throttleDemand in RUNNING mode.  DynamicIdle then
        // applies a floor on top, and ThrottleSlew rate-limits the result.
        // A throttle-primary governor (turboshaft/APU with no prop-pitch authority)
        // OWNS throttleDemand: it holds N2 by accumulating throttle over many ticks.
        // Re-mapping the operator input onto throttleDemand every tick would wipe that
        // accumulation, so skip the input mapping while such a governor is active
        // (this is the "governor overrides this demand" contract). A pitch-primary
        // governor instead leaves the throttle to the operator and holds N2 with pitch,
        // so the input mapping still applies there. DynamicIdle (ticked after the
        // governor) still enforces the running idle floor either way.
        const bool governorOwnsThrottle = hw.hasGovernor && hw.hasN2Rpm &&
                                          ed.n2Healthy &&
                                          Config::governorTargetRpm > 0.0f &&
                                          !g_ctrlGovernor.usePropPitch;
        const int8_t registryThrottle = registryPurposeInputIndex("throttle", "operator_throttle");
        if ((hw.hasThrottleInput || registryThrottle >= 0) && mode == SysMode::RUNNING && !governorOwnsThrottle) {
            float norm;
            if (registryThrottle >= 0) {
                norm = ed.registryInputHealthy[registryThrottle] ? ed.registryInputValue[registryThrottle] : 0.0f;
            } else if (hw.throttleInputRcPwm) {
                norm = (ed.rcThrottleValid) ? ed.rcThrottleNorm : 0.0f;
            } else if (!ed.throttleInputValid) {
                norm = 0.0f;
            } else {
                int range = Config::throttleMaxRaw - Config::throttleMinRaw;
                norm = (range != 0)
                    ? constrain((ed.throttleInputRaw - Config::throttleMinRaw) /
                                (float)range, 0.0f, 1.0f)
                    : 0.0f;
            }
            // Apply throttle expo if configured (softens stick sensitivity)
            float expo = Config::throttleExpo;  // 0=linear, 1=max expo
            if (expo > 0.0f) {
                // Standard RC expo: y = x*(1-e) + x^3*e
                norm = norm * (1.0f - expo) + norm * norm * norm * expo;
            }
            // Map from calibrated fuel-pump minimum spin to full range.
            float minPct = Config::fuelPumpMinPct / 100.0f;
            ed.throttleDemand = constrain(minPct + norm * (1.0f - minPct), 0.0f, 1.0f);
        }

        if (hw.hasOilLoop) {
            if (mode == SysMode::RUNNING) {
                if (Config::oilUseThrottleMap) {
                    float t  = constrain(ed.throttleDemand, 0.0f, 1.0f);
                    ed.oilTargetBar = Config::oilMapMin
                                 + t * (Config::oilMapMax - Config::oilMapMin);
                } else {
                    ed.oilTargetBar = Config::oilMapMin;
                }
            }
            g_ctrlOilLoop.tick();
            runAdditionalOilLoops();
        }
        // Tick order matters:
        //  1. Governor first — adjusts throttleDemand toward N2 target (may reduce it).
        //  2. DynamicIdle second — enforces the idle RPM floor on throttleDemand.
        //     Running DI after the governor ensures the floor is always the last
        //     word: when governor reduces throttle below the DI floor both controllers
        //     no longer fight each tick, and ThrottleSlew sees a stable target.
        // Final throttle protection runs after automation rules so a rule can
        // request throttle without bypassing limp or slew/sensor safeguards.
        if (hw.hasGovernor && hw.hasN2Rpm && mode == SysMode::RUNNING) g_ctrlGovernor.tick();
        if (hw.hasDynamicIdle && mode == SysMode::RUNNING) g_ctrlDynamicIdle.tick();
    }

    inline void applyThrottleProtection() {
        auto& hw   = HardwareConfig::instance();
        auto& ed   = EngineData::instance();
        auto  mode = ed.mode;
        if (mode != SysMode::RUNNING && mode != SysMode::STARTUP) return;

        if (ed.limpMode && mode == SysMode::RUNNING) {
            float cap = constrain(Config::limpMaxThrottlePct / 100.0f, 0.0f, 1.0f);
            if (ed.throttleDemand > cap) ed.throttleDemand = cap;
        }
        if (hw.hasThrottle) g_ctrlThrottleSlew.tick();
        // The calibrated fuel-pump minimum is applied as an output deadband in
        // updateActuators(), not as a clamp here. Low commands below min-spin
        // become zero instead of being silently lifted to the threshold.
    }

} // namespace Hardware
