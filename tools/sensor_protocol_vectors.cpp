#include "../src/hal/sensors/SensorProtocolDecode.h"
#include "../src/hal/AdcThreshold.h"
#include "../src/hal/sensors/PiecewiseCalibration.h"
#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>

static bool near(float a, float b, float eps = 0.001f) { return std::fabs(a - b) <= eps; }
int main() {
    float t = 999.0f;
    assert(SensorProtocolDecode::max31855(0, t) && near(t, 0));
    assert(SensorProtocolDecode::max31855((uint32_t)(400 * 4) << 18, t) && near(t, 400));
    assert(!SensorProtocolDecode::max31855(0x00010001u, t));
    assert(!SensorProtocolDecode::max31855(0xFFFFFFFFu, t));
    const int32_t m56 = (int32_t)(815.5f / 0.0078125f);
    assert(SensorProtocolDecode::max31856((uint32_t)m56 << 5, 0, t) && near(t, 815.5f));
    assert(!SensorProtocolDecode::max31856(0, 1, t));
    assert(SensorProtocolDecode::max6675((uint16_t)((642.25f / 0.25f) * 8), t) && near(t, 642.25f));
    assert(!SensorProtocolDecode::max6675(4, t));
    int32_t counts = 0;
    assert(SensorProtocolDecode::hx711(0x000123u, counts) && counts == 0x123);
    assert(SensorProtocolDecode::hx711(0xFFFF00u, counts) && counts == -256);
    assert(!SensorProtocolDecode::hx711(0x7FFFFFu, counts));
    assert(!SensorProtocolDecode::hx711(0x800000u, counts));
    uint8_t scratch[9] = {0x50,0x05,0x4B,0x46,0x7F,0xFF,0x0C,0x10,0};
    scratch[8] = SensorProtocolDecode::dallasCrc8(scratch, 8);
    assert(SensorProtocolDecode::ds18b20(scratch, 12, t) && near(t, 85));
    scratch[8] ^= 1;
    assert(!SensorProtocolDecode::ds18b20(scratch, 12, t));
    bool state = false;
    state = AdcThreshold::update(2080, 2048, 128, state);
    assert(!state); // below 2112 ON edge
    state = AdcThreshold::update(2112, 2048, 128, state);
    assert(state);
    state = AdcThreshold::update(2000, 2048, 128, state);
    assert(state); // above 1984 OFF edge
    state = AdcThreshold::update(1984, 2048, 128, state);
    assert(!state);
    assert(AdcThreshold::logicalValue(false, false) == 1.0f);
    state = AdcThreshold::update(101, 100, 3, false);
    assert(!state); // odd 3-count band keeps a 2-count rising half
    state = AdcThreshold::update(102, 100, 3, state);
    assert(state);
    state = AdcThreshold::update(100, 100, 3, state);
    assert(state); // and a 1-count falling half
    state = AdcThreshold::update(99, 100, 3, state);
    assert(!state);
    const uint16_t rawUp[] = {200, 1000, 2600, 3800};
    const float valueUp[] = {0.0f, 1.0f, 5.0f, 10.0f};
    assert(PiecewiseCalibration::valid(4, rawUp, valueUp));
    assert(near(PiecewiseCalibration::apply(1800, 4, rawUp, valueUp), 3.0f));
    assert(near(PiecewiseCalibration::apply(0, 4, rawUp, valueUp), 0.0f));
    assert(near(PiecewiseCalibration::apply(4095, 4, rawUp, valueUp), 10.0f));
    const uint16_t rawDown[] = {100, 2000, 4000};
    const float valueDown[] = {100.0f, 50.0f, 0.0f};
    assert(PiecewiseCalibration::valid(3, rawDown, valueDown));
    assert(near(PiecewiseCalibration::apply(3000, 3, rawDown, valueDown), 25.0f));
    const uint16_t rawBad[] = {100, 100, 3000};
    const float valueBad[] = {0.0f, 1.0f, 0.5f};
    assert(!PiecewiseCalibration::valid(3, rawBad, valueBad));
    const uint16_t rawHuge[] = {0, 4095};
    const float valueHuge[] = {-3.0e38f, 3.0e38f};
    assert(!PiecewiseCalibration::valid(2, rawHuge, valueHuge));
    assert(PiecewiseCalibration::valid(0, nullptr, nullptr));
    std::cout << "sensor protocol, ADC threshold and calibration vectors passed (32 checks)\n";
}
