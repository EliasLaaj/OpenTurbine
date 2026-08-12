#pragma once
#include "HardwareConfig.h"

// One backend source for feature availability. Browser pages consume its JSON
// response rather than maintaining independent `hasX` matrices.
class HardwareCapabilities {
public:
    static bool hasInputRole(const char* role) { return hasRole(ChannelRegistry::Input, role); }
    static bool hasOutputRole(const char* role) { return hasRole(ChannelRegistry::Output, role); }
    static bool hasInputPurpose(const char* purpose) { return hasPurpose(ChannelRegistry::Input, purpose); }
    static bool hasOutputPurpose(const char* purpose) { return hasPurpose(ChannelRegistry::Output, purpose); }
    static bool available(const char* feature) {
        if (!strcmp(feature, "oil_loop"))
            return (hasInputPurpose("oil_pressure") && hasOutputPurpose("oil_pump")) ||
                   (HardwareConfig::hasOilPress && HardwareConfig::hasOilPump);
        if (!strcmp(feature, "n1_safety"))
            return hasInputBindingOrPurpose("primary_n1", "n1_speed") || HardwareConfig::hasN1Rpm;
        if (!strcmp(feature, "n2_safety"))
            return hasInputBindingOrPurpose("primary_n2", "n2_speed") || HardwareConfig::hasN2Rpm;
        if (!strcmp(feature, "n2_governor"))
            return (hasInputBindingOrPurpose("primary_n2", "n2_speed") &&
                    (hasProportionalOutputPurpose("main_fuel") || hasOutputPurpose("prop_pitch"))) ||
                   (HardwareConfig::hasN2Rpm &&
                    ((HardwareConfig::hasThrottle && HardwareConfig::throttleType != 2) ||
                     HardwareConfig::hasPropPitch));
        if (!strcmp(feature, "egt_safety"))
            return (hasInputBindingOrPurpose("primary_egt", "tot") || hasInputPurpose("tit")) ||
                   HardwareConfig::hasTot || HardwareConfig::hasTit;
        if (!strcmp(feature, "dynamic_idle"))
            return ((hasInputBindingOrPurpose("primary_n1", "n1_speed") ||
                    hasInputBindingOrPurpose("primary_n2", "n2_speed") ||
                    hasInputPurpose("p1_pressure") || hasInputPurpose("p2_pressure")) &&
                    hasProportionalOutputPurpose("main_fuel")) ||
                   ((HardwareConfig::hasN1Rpm || HardwareConfig::hasN2Rpm || HardwareConfig::hasP1 || HardwareConfig::hasP2) &&
                    HardwareConfig::hasThrottle && HardwareConfig::throttleType != 2);
        return false;
    }
    static const char* enabledFeatureRejectReason() {
        if (HardwareConfig::hasOilLoop && !available("oil_loop"))
            return "Oil control loop requires an oil pressure input and oil pump output";
        if (HardwareConfig::hasDynamicIdle && !available("dynamic_idle"))
            return "Automatic idle control requires N1, N2, P1, or P2 feedback and a main fuel output";
        if (HardwareConfig::hasGovernor && !available("n2_governor"))
            return "Governor requires N2 RPM feedback and a throttle or prop-pitch output";
        if ((HardwareConfig::safetyOverspeed || HardwareConfig::safetySurge) && !available("n1_safety"))
            return "Overspeed/surge safety requires N1 RPM feedback";
        if (HardwareConfig::safetyN2Overspeed && !available("n2_safety"))
            return "N2 overspeed safety requires N2 RPM feedback";
        if ((HardwareConfig::safetyOvertemp || HardwareConfig::safetyHotStart) && !available("egt_safety"))
            return "Temperature safety requires a selected EGT/TIT input";
        if (HardwareConfig::safetyLowOil && !hasOilSafetyInput("low_oil_switch"))
            return "Low-oil safety requires an oil pressure input or low-oil switch";
        if (HardwareConfig::safetyOilZero && !hasOilSafetyInput("oil_zero_switch"))
            return "Zero-oil safety requires an oil pressure input or zero-oil switch";
        if (HardwareConfig::safetyOilTempHigh && !(hasInputPurpose("oil_temperature") || HardwareConfig::hasOilTemp))
            return "Oil temperature safety requires an oil temperature input";
        if (HardwareConfig::safetyFuelPressLow && !(hasInputPurpose("fuel_pressure") || HardwareConfig::hasFuelPress))
            return "Fuel pressure safety requires a fuel pressure input";
        if (HardwareConfig::safetyBattLow && !(hasInputPurpose("battery_voltage") || HardwareConfig::hasBattVoltage))
            return "Battery safety requires a voltage input";
        return nullptr;
    }
    static void toJson(JsonObject root, const char* feature) {
        bool ok = available(feature); root["feature"] = feature; root["available"] = ok;
        root["oil_loop_count"] = HardwareConfig::oilLoopCount;
        root["max_oil_loops"] = HardwareConfig::MAX_OIL_LOOPS;
        JsonArray missing = root["missing"].to<JsonArray>();
        if (ok) return;
        if (!strcmp(feature, "oil_loop")) {
            if (!hasPressureInput()) addMissing(missing, "oil_pressure_input", "Add an oil-pressure input");
            if (!hasOilPumpOutput()) addMissing(missing, "oil_pump_output", "Add an oil-pump output");
        }
        else if (!strcmp(feature, "n1_safety")) addMissing(missing, "primary_n1", "Bind or add an N1 speed input");
        else if (!strcmp(feature, "n2_safety")) addMissing(missing, "primary_n2", "Bind or add an N2 speed input");
        else if (!strcmp(feature, "n2_governor")) {
            if (!hasInputBindingOrPurpose("primary_n2", "n2_speed")) addMissing(missing, "primary_n2", "Bind or add an N2 speed input");
            if (!hasOutputPurpose("main_fuel") && !hasOutputPurpose("prop_pitch") && !HardwareConfig::hasThrottle && !HardwareConfig::hasPropPitch)
                addMissing(missing, "governor_output", "Add a fuel or prop-pitch output");
        }
        else if (!strcmp(feature, "egt_safety")) addMissing(missing, "primary_egt", "Bind or add a temperature input");
        else if (!strcmp(feature, "dynamic_idle")) {
            if (!hasInputRole("speed") && !hasInputPurpose("p1_pressure") && !hasInputPurpose("p2_pressure") &&
                !HardwareConfig::hasN1Rpm && !HardwareConfig::hasN2Rpm && !HardwareConfig::hasP1 && !HardwareConfig::hasP2)
                addMissing(missing, "idle_feedback", "Add an N1, N2, P1, or P2 feedback input");
            if (!hasProportionalOutputPurpose("main_fuel") &&
                !(HardwareConfig::hasThrottle && HardwareConfig::throttleType != 2))
                addMissing(missing, "throttle_output", "Add a PWM or servo main-fuel output");
        }
    }
private:
    static void addMissing(JsonArray missing, const char* capability, const char* message) {
        JsonObject item = missing.add<JsonObject>();
        item["capability"] = capability;
        item["message"] = message;
    }
    static bool hasPressureInput() { return hasInputPurpose("oil_pressure") || HardwareConfig::hasOilPress; }
    static bool hasOilPumpOutput() { return hasOutputPurpose("oil_pump") || HardwareConfig::hasOilPump; }
    static bool hasOilSafetyInput(const char* switchRole) {
        return hasPressureInput() || hasInputPurpose(switchRole) || hasInputRole(switchRole) || hasDiRole(switchRole);
    }
    static bool hasDiRole(const char* role) {
        for (int i = 0; i < HardwareConfig::MAX_DI; ++i)
            if (HardwareConfig::diCh[i].pin >= 0 && !strcmp(HardwareConfig::diCh[i].role, role)) return true;
        return false;
    }
    static bool hasRole(ChannelRegistry::Direction direction, const char* role) {
        const ChannelRegistry& r = HardwareConfig::channelRegistry;
        const ChannelRegistry::Channel* list = direction == ChannelRegistry::Input ? r.inputs : r.outputs;
        uint8_t n = direction == ChannelRegistry::Input ? r.inputCount : r.outputCount;
        for (uint8_t i=0;i<n;i++) if (list[i].installed && !strcmp(list[i].role, role)) return true;
        return false;
    }
    static bool hasPurpose(ChannelRegistry::Direction direction, const char* purpose) {
        const ChannelRegistry& r = HardwareConfig::channelRegistry;
        const ChannelRegistry::Channel* list = direction == ChannelRegistry::Input ? r.inputs : r.outputs;
        uint8_t n = direction == ChannelRegistry::Input ? r.inputCount : r.outputCount;
        for (uint8_t i=0;i<n;i++) if (list[i].installed && !strcmp(list[i].purpose, purpose)) return true;
        return false;
    }
    static bool hasProportionalOutputPurpose(const char* purpose) {
        const ChannelRegistry& r = HardwareConfig::channelRegistry;
        for (uint8_t i = 0; i < r.outputCount; ++i)
            if (r.outputs[i].installed && !strcmp(r.outputs[i].purpose, purpose) &&
                ChannelRegistry::driverIsProportionalOutput(r.outputs[i].driver)) return true;
        return false;
    }
    static bool hasBindingOrRole(const char* key, const char* role) {
        return hasInputBindingOrRole(key, role) || hasOutputBindingOrRole(key, role);
    }
    static bool hasInputBindingOrRole(const char* key, const char* role) {
        const ChannelRegistry& r = HardwareConfig::channelRegistry;
        for (uint8_t i=0;i<r.bindingCount;i++) if (!strcmp(r.bindings[i].key,key) && r.find(r.bindings[i].channelId, ChannelRegistry::Input)) return true;
        return hasInputRole(role);
    }
    static bool hasInputBindingOrPurpose(const char* key, const char* purpose) {
        const ChannelRegistry& r = HardwareConfig::channelRegistry;
        for (uint8_t i=0;i<r.bindingCount;i++)
            if (!strcmp(r.bindings[i].key,key) && r.find(r.bindings[i].channelId, ChannelRegistry::Input)) return true;
        return hasPurpose(ChannelRegistry::Input, purpose);
    }
    static bool hasOutputBindingOrRole(const char* key, const char* role) {
        const ChannelRegistry& r = HardwareConfig::channelRegistry;
        for (uint8_t i=0;i<r.bindingCount;i++) if (!strcmp(r.bindings[i].key,key) && r.find(r.bindings[i].channelId, ChannelRegistry::Output)) return true;
        return hasOutputRole(role);
    }
};
