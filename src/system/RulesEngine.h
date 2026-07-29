#pragma once
// ============================================================
//  RulesEngine — deterministic threshold and linear-map automations,
//  evaluated every control tick.
//
//  Rules are edited in the Sequence page Control Rules tab and
//  stored in the settings section of ecu_config.json under "rules".
//
//  Rules run after sequencer/controller writes in the explicitly selected
//  engine states. Outside those states, on invalid input, or after deletion,
//  their output is driven off instead of retaining a stale demand.
// ============================================================
#include "Config.h"
#include "HardwareConfig.h"
#include "../engine/EngineData.h"

class RulesEngine {
public:
    // Sensor indices (match UI dropdown order)
    enum Sensor   : uint8_t { OIL_TEMP=0, TOT=1, N1_RPM=2, OIL_PRESS=3, TIT=4, BATT_V=5, N2_RPM=6,
                              DI_CH0=7, DI_CH1=8, DI_CH2=9, DI_CH3=10, FUEL_PRESS=11,
                              FUEL_FLOW=12, P1=13, P2=14, TORQUE=15, FLAME=16,
                              THROTTLE_INPUT=17, IDLE_INPUT=18, AB_FLAME=19,
                              GLOW_CURRENT=20, IGNITER_CURRENT=21, IGNITER2_CURRENT=22,
                              OIL_PUMP_CURRENT=23, AB_INPUT=24, START_SWITCH=25, STOP_SWITCH=26,
                              THRUST=27 };
    // Comparison operators
    enum Op       : uint8_t { GT=0, LT=1, GTE=2, LTE=3, EQ=4 };
    // Controllable actuators
    enum Actuator : uint8_t { COOL_FAN=0, BLEED_VALVE=1, FUEL_PUMP2=2, OIL_SCAVENGE=3,
                              THROTTLE=4, STARTER=5, STARTER_ENABLE=6, OIL_PUMP=7,
                              FUEL_SOL=8, IGNITER=9, IGNITER2=10, AB_SOL=11, AB_PUMP=12,
                              REQUEST_SHUTDOWN=13, REQUEST_FAULT=14, AIRSTARTER=15,
                              GLOW_PLUG=16, PROP_PITCH=17 };

    using ShutdownCallback = void (*)();
    using FaultCallback = void (*)(const char*);
    static void begin(ShutdownCallback shutdownCb, FaultCallback faultCb) {
        _shutdownCb = shutdownCb;
        _faultCb = faultCb;
    }

    static bool actuatorUsable(uint8_t act) {
        return _actuatorUsable(act);
    }

    static void applyActuatorDemand(uint8_t act, float dem) {
        if (!_actuatorUsable(act)) return;
        _applyActuator(act, constrain(dem, 0.0f, 1.0f), EngineData::instance(), nullptr);
    }

    static bool sensorConditionMet(uint8_t sensor, uint8_t op, float threshold) {
        auto& ed = EngineData::instance();
        return _sensorUsable(sensor, ed) && _evalOp(_readSensor(sensor, ed), op, threshold, sensor);
    }

    // Clear per-rule hysteresis latches. Called after the rules array is
    // reloaded or compacted so a previous rule's latched state cannot apply
    // to a different rule that now occupies the same index.
    static void resetLatches() {
        for (int i = 0; i < Config::MAX_RULES; i++) _ruleLatched[i] = false;
    }

    // Called once per control tick (Core 1, ~10 ms cycle).
    static void evaluate() {
        auto& ed = EngineData::instance();
        const SysMode modeAtStart = ed.mode;
        uint8_t currentTargets[Config::MAX_RULES] = {};
        uint8_t currentTargetCount = 0;

        // FAULT is never an automation state. Force both current and recently
        // removed targets physically off, regardless of a configured off value.
        if (ed.mode == SysMode::FAULT) {
            for (int i = 0; i < Config::ruleCount; ++i)
                if (_actuatorUsable(Config::rules[i].actuator))
                    _applyActuator(Config::rules[i].actuator, 0.0f, ed, nullptr);
            for (uint8_t i = 0; i < _ownedTargetCount; ++i)
                if (_actuatorUsable(_ownedTargets[i]))
                    _applyActuator(_ownedTargets[i], 0.0f, ed, nullptr);
            _ownedTargetCount = 0;
            return;
        }

        for (int i = 0; i < Config::ruleCount; i++) {
            const Config::Rule& r = Config::rules[i];
            if (!_targetPresent(currentTargets, currentTargetCount, r.actuator) &&
                currentTargetCount < Config::MAX_RULES)
                currentTargets[currentTargetCount++] = r.actuator;

            const uint8_t modeBit = (uint8_t)(1u << (int)ed.mode);
            const bool activeState = r.enabled && (r.modeMask & modeBit) != 0 &&
                                     _actuatorUsable(r.actuator);
            const bool inputHealthy = _sensorUsable(r.sensor, ed);
            const bool applies = activeState && inputHealthy;
            float demand = r.offValue;
            if (activeState && !inputHealthy && _warningIndicator(r.actuator))
                demand = r.onValue;

            if (applies) {
                const float value = _readSensor(r.sensor, ed);
                if (r.kind == 1) {
                    const float span = r.inputMax - r.inputMin;
                    const float mapped = span != 0.0f
                        ? constrain((value - r.inputMin) / span, 0.0f, 1.0f)
                        : 0.0f;
                    demand = r.outputMin + mapped * (r.outputMax - r.outputMin);
                    _ruleLatched[i] = false;
                } else {
                    const bool met = _evalRuleState(i, value, r.op, r.threshold,
                                                    r.hysteresis, r.sensor);
                    demand = met ? r.onValue : r.offValue;
                }
            } else {
                _ruleLatched[i] = false;
            }

            if (_actuatorUsable(r.actuator))
                _applyActuator(r.actuator, constrain(demand, 0.0f, 1.0f), ed, r.name);
            if (modeAtStart != SysMode::SHUTDOWN && ed.mode == SysMode::SHUTDOWN) return;
        }

        // A deleted rule no longer appears above, so explicitly release any
        // target it owned on the previous tick.
        for (uint8_t i = 0; i < _ownedTargetCount; ++i)
            if (!_targetPresent(currentTargets, currentTargetCount, _ownedTargets[i]) &&
                _actuatorUsable(_ownedTargets[i]))
                _applyActuator(_ownedTargets[i], 0.0f, ed, nullptr);
        _ownedTargetCount = currentTargetCount;
        for (uint8_t i = 0; i < currentTargetCount; ++i) _ownedTargets[i] = currentTargets[i];
    }

    static bool sensorReading(uint8_t sensor, float& value) {
        auto& ed = EngineData::instance();
        if (!_sensorUsable(sensor, ed)) return false;
        value = _readSensor(sensor, ed);
        return true;
    }

private:
    static bool _warningIndicator(uint8_t act) {
        if (!ChannelRegistry::isOutputActuator(act)) return false;
        const uint8_t idx = ChannelRegistry::outputIndexFromActuator(act);
        return idx < HardwareConfig::channelRegistry.outputCount &&
               !strcmp(HardwareConfig::channelRegistry.outputs[idx].purpose,
                       "warning_indicator");
    }

    static bool _targetPresent(const uint8_t* targets, uint8_t count, uint8_t target) {
        for (uint8_t i = 0; i < count; ++i) if (targets[i] == target) return true;
        return false;
    }
    static bool _sensorUsable(uint8_t s, const EngineData& ed) {
        if (ChannelRegistry::isInputSensor(s)) {
            uint8_t idx = ChannelRegistry::inputIndexFromSensor(s);
            if (idx >= HardwareConfig::channelRegistry.inputCount) return false;
            const auto& channel = HardwareConfig::channelRegistry.inputs[idx];
            const bool addressable = channel.pin >= 0 ||
                channel.driver == ChannelRegistry::I2cDigital ||
                channel.driver == ChannelRegistry::I2cAnalog ||
                channel.driver == ChannelRegistry::I2cLoadCell;
            return channel.installed && addressable && ed.registryInputHealthy[idx];
        }
        switch (s) {
            case OIL_TEMP:        return HardwareConfig::hasOilTemp && ed.oilTempHealthy;
            case TOT:             return HardwareConfig::hasTot && ed.totHealthy;
            case N1_RPM:          return HardwareConfig::hasN1Rpm && ed.n1Healthy;
            case OIL_PRESS:       return HardwareConfig::hasOilPress && ed.oilHealthy;
            case TIT:             return HardwareConfig::hasTit && ed.titHealthy;
            case BATT_V:          return HardwareConfig::hasBattVoltage && ed.battHealthy;
            case N2_RPM:          return HardwareConfig::hasTwoShaft && HardwareConfig::hasN2Rpm && ed.n2Healthy;
            case DI_CH0:          return HardwareConfig::diCh[0].pin >= 0;
            case DI_CH1:          return HardwareConfig::diCh[1].pin >= 0;
            case DI_CH2:          return HardwareConfig::diCh[2].pin >= 0;
            case DI_CH3:          return HardwareConfig::diCh[3].pin >= 0;
            case FUEL_PRESS:      return HardwareConfig::hasFuelPress && ed.fuelPressHealthy;
            case FUEL_FLOW:       return HardwareConfig::hasFuelFlow && ed.fuelFlowHealthy;
            case P1:              return HardwareConfig::hasP1 && ed.p1Healthy;
            case P2:              return HardwareConfig::hasP2 && ed.p2Healthy;
            case TORQUE:          return HardwareConfig::hasTorque && ed.torqueHealthy;
            case FLAME:           return HardwareConfig::hasFlame && ed.flameHealthy;
            case THROTTLE_INPUT:  return HardwareConfig::hasThrottleInput && ed.throttleInputValid;
            case IDLE_INPUT:      return HardwareConfig::hasIdleInput && ed.idleInputValid;
            case AB_FLAME:        return HardwareConfig::hasAfterburner && HardwareConfig::hasAbFlame && ed.abFlameHealthy;
            case GLOW_CURRENT:    return HardwareConfig::hasGlowPlug && HardwareConfig::hasGlowCurrentSensor && ed.glowCurrentHealthy;
            case IGNITER_CURRENT: return HardwareConfig::hasIgniter && HardwareConfig::hasIgniterCurrentSensor && ed.igniterCurrentHealthy;
            case IGNITER2_CURRENT:return HardwareConfig::hasIgniter2 && HardwareConfig::hasIgniter2CurrentSensor && ed.igniter2CurrentHealthy;
            case OIL_PUMP_CURRENT:return HardwareConfig::hasOilPump && HardwareConfig::hasOilPumpCurrentSensor && ed.oilPumpCurrentHealthy;
            case AB_INPUT:        return HardwareConfig::hasAfterburner &&
                                         HardwareConfig::abInputPin >= 0 && ed.abInputValid;
            case START_SWITCH:    return HardwareConfig::startPin >= 0;
            case STOP_SWITCH:     return HardwareConfig::stopPin >= 0;
            case THRUST:          return HardwareConfig::hasThrust && ed.thrustHealthy;
            default:              return false;
        }
    }

    static float _readSensor(uint8_t s, const EngineData& ed) {
        if (ChannelRegistry::isInputSensor(s)) {
            uint8_t idx = ChannelRegistry::inputIndexFromSensor(s);
            return idx < ChannelRegistry::MAX_INPUT_CHANNELS ? ed.registryInputValue[idx] : 0.0f;
        }
        switch (s) {
            case OIL_TEMP:  return ed.oilTemp;
            case TOT:       return ed.tot;
            case N1_RPM:    return ed.n1Rpm;
            case OIL_PRESS: return ed.oilPressure;
            case TIT:       return ed.tit;
            case BATT_V:    return ed.battVoltage;
            case N2_RPM:    return ed.n2Rpm;
            case DI_CH0:    return ed.diState[0] ? 1.0f : 0.0f;
            case DI_CH1:    return ed.diState[1] ? 1.0f : 0.0f;
            case DI_CH2:    return ed.diState[2] ? 1.0f : 0.0f;
            case DI_CH3:    return ed.diState[3] ? 1.0f : 0.0f;
            case FUEL_PRESS:return ed.fuelPressure;
            case FUEL_FLOW: return ed.fuelFlow;
            case P1:        return ed.p1;
            case P2:        return ed.p2;
            case TORQUE:    return ed.torque;
            case FLAME:     return ed.flameDetected ? 1.0f : 0.0f;
            case THROTTLE_INPUT: {
                if (HardwareConfig::throttleInputRcPwm)
                    return ed.rcThrottleValid ? ed.rcThrottleNorm : 0.0f;
                int range = Config::throttleMaxRaw - Config::throttleMinRaw;
                return range ? constrain((ed.throttleInputRaw - Config::throttleMinRaw) /
                                         (float)range, 0.0f, 1.0f) : 0.0f;
            }
            case IDLE_INPUT: {
                if (HardwareConfig::idleInputRcPwm)
                    return ed.rcIdleValid ? ed.rcIdleNorm : 0.0f;
                int range = Config::idleMaxRaw - Config::idleMinRaw;
                return range ? constrain((ed.idleInputRaw - Config::idleMinRaw) /
                                         (float)range, 0.0f, 1.0f) : 0.0f;
            }
            case AB_FLAME:  return ed.abFlameOn ? 1.0f : 0.0f;
            case GLOW_CURRENT: return ed.glowCurrentAmps;
            case IGNITER_CURRENT: return ed.igniterCurrentAmps;
            case IGNITER2_CURRENT: return ed.igniter2CurrentAmps;
            case OIL_PUMP_CURRENT: return ed.oilPumpCurrentAmps;
            case AB_INPUT:   return ed.abInputValid ? constrain(ed.abInputNorm, 0.0f, 1.0f) : 0.0f;
            case START_SWITCH:return ed.startSwitchActive ? 1.0f : 0.0f;
            case STOP_SWITCH: return ed.stopSwitchActive ? 1.0f : 0.0f;
            case THRUST:      return ed.thrust;
            default:        return 0.0f;
        }
    }

    static bool _actuatorUsable(uint8_t act) {
        if (ChannelRegistry::isOutputActuator(act)) {
            uint8_t idx = ChannelRegistry::outputIndexFromActuator(act);
            if (idx >= HardwareConfig::channelRegistry.outputCount) return false;
            const auto& out = HardwareConfig::channelRegistry.outputs[idx];
            return out.installed &&
                   (out.pin >= 0 || out.driver == ChannelRegistry::I2cRelay) &&
                   !HardwareConfig::channelRegistry.ownsCoreOutput(out) &&
                   !HardwareConfig::channelRegistry.boundToCoreOutput(out);
        }
        switch (act) {
            case COOL_FAN:         return HardwareConfig::hasCoolFan;
            case BLEED_VALVE:      return HardwareConfig::hasBleedValve;
            case FUEL_PUMP2:       return HardwareConfig::hasFuelPump2;
            case OIL_SCAVENGE:     return HardwareConfig::hasOilScavengePump;
            case THROTTLE:         return HardwareConfig::hasThrottle;
            case STARTER:          return HardwareConfig::hasStarter;
            case STARTER_ENABLE:   return HardwareConfig::hasStarterEn;
            case OIL_PUMP:         return HardwareConfig::hasOilPump;
            case FUEL_SOL:         return HardwareConfig::hasFuelSol;
            case IGNITER:          return HardwareConfig::hasIgniter;
            case IGNITER2:         return HardwareConfig::hasIgniter2;
            case AB_SOL:           return HardwareConfig::hasAfterburner &&
                                          HardwareConfig::hasAbSol;
            case AB_PUMP:          return HardwareConfig::hasAfterburner &&
                                          HardwareConfig::hasAbPump;
            case AIRSTARTER:       return HardwareConfig::hasAirstarterSol;
            case GLOW_PLUG:        return HardwareConfig::hasGlowPlug;
            case PROP_PITCH:       return HardwareConfig::hasPropPitch;
            case REQUEST_SHUTDOWN:
            case REQUEST_FAULT:    return true;
            default:               return false;
        }
    }

    static bool _evalOp(float val, uint8_t op, float threshold, uint8_t sensor) {
        switch (op) {
            case GT:  return val >  threshold;
            case LT:  return val <  threshold;
            case GTE: return val >= threshold;
            case LTE: return val <= threshold;
            case EQ: {
                float tolerance = 0.01f;
                switch (sensor) {
                    case OIL_TEMP:
                    case TOT:
                    case TIT:
                    case N1_RPM:
                    case N2_RPM: tolerance = 1.0f; break;
                    case THROTTLE_INPUT:
                    case IDLE_INPUT:
                    case AB_INPUT: tolerance = 0.005f; break;
                    case DI_CH0:
                    case DI_CH1:
                    case DI_CH2:
                    case DI_CH3:
                    case FLAME:
                    case AB_FLAME:
                    case START_SWITCH:
                    case STOP_SWITCH: tolerance = 0.1f; break;
                    default: break;
                }
                return fabsf(val - threshold) < tolerance;
            }
            default:  return false;
        }
    }

    static bool _evalRuleState(int idx, float val, uint8_t op, float threshold, float hysteresis, uint8_t sensor) {
        if (idx < 0 || idx >= Config::MAX_RULES) return _evalOp(val, op, threshold, sensor);
        hysteresis = max(0.0f, hysteresis);
        bool& latched = _ruleLatched[idx];
        switch (op) {
            case GT:
            case GTE:
                if (latched) {
                    if (val <= threshold - hysteresis) latched = false;
                } else if (_evalOp(val, op, threshold, sensor)) {
                    latched = true;
                }
                return latched;
            case LT:
            case LTE:
                if (latched) {
                    if (val >= threshold + hysteresis) latched = false;
                } else if (_evalOp(val, op, threshold, sensor)) {
                    latched = true;
                }
                return latched;
            default:
                latched = _evalOp(val, op, threshold, sensor);
                return latched;
        }
    }

    static void _applyActuator(uint8_t act, float dem, EngineData& ed, const char* ruleName) {
        if (ChannelRegistry::isOutputActuator(act)) {
            uint8_t idx = ChannelRegistry::outputIndexFromActuator(act);
            if (idx < ChannelRegistry::MAX_OUTPUT_CHANNELS) ed.registryOutputDemand[idx] = dem;
            return;
        }
        switch (act) {
            case COOL_FAN:    ed.coolFanDemand = dem; ed.coolFanOn = dem >= 0.5f; break;
            case BLEED_VALVE: ed.bleedValveDemand = dem; ed.bleedValveOpen = dem >= 0.5f; break;
            case FUEL_PUMP2:  ed.fuelPump2Demand = constrain(dem, 0.0f, 1.0f); break;
            case OIL_SCAVENGE:ed.oilScavengeDemand = dem; ed.oilScavengeOn = dem >= 0.5f; break;
            case THROTTLE:    ed.throttleDemand = constrain(dem, 0.0f, 1.0f); break;
            case STARTER:
                ed.starterDemand = constrain(dem, 0.0f, 1.0f);
                // A starter automation owns the complete starter action. This
                // makes a potentiometer map usable even when an enable relay is
                // fitted, while zero demand returns both outputs to off.
                ed.starterEnabled = dem > 0.001f;
                break;
            case STARTER_ENABLE: ed.starterEnabled = (dem >= 0.5f); break;
            case OIL_PUMP:    ed.oilPumpPct     = constrain(dem, 0.0f, 1.0f) * 100.0f; break;
            case FUEL_SOL:    ed.fuelSolOpen    = (dem >= 0.5f); break;
            case IGNITER:     ed.igniterOn      = (dem >= 0.5f); break;
            case IGNITER2:    ed.igniter2On     = (dem >= 0.5f); break;
            case AB_SOL:      ed.abSolOpen      = (dem >= 0.5f); break;
            case AB_PUMP:     ed.abPumpDemand   = constrain(dem, 0.0f, 1.0f); break;
            case REQUEST_SHUTDOWN:
                if (dem >= 0.5f && _shutdownCb) _shutdownCb();
                break;
            case REQUEST_FAULT:
                if (dem >= 0.5f && _faultCb) {
                    if (ruleName && ruleName[0]) {
                        snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                                 "Control rule fault: %s", ruleName);
                    } else {
                        snprintf(ed.faultDescription, sizeof(ed.faultDescription),
                                 "Control rule requested a fault shutdown.");
                    }
                    _faultCb("CONTROL_RULE");
                }
                break;
            case AIRSTARTER: ed.airstarterOpen = (dem >= 0.5f); break;
            case GLOW_PLUG:  ed.glowPlugDemand = constrain(dem, 0.0f, 1.0f); break;
            case PROP_PITCH: ed.propPitchDemand = constrain(dem, 0.0f, 1.0f); break;
            default: break;
        }
    }

    static inline ShutdownCallback _shutdownCb = nullptr;
    static inline FaultCallback _faultCb = nullptr;
    static inline bool _ruleLatched[Config::MAX_RULES] = {};
    static inline uint8_t _ownedTargets[Config::MAX_RULES] = {};
    static inline uint8_t _ownedTargetCount = 0;
};
