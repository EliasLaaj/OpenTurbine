#pragma once
#include <cstdint>
#include <algorithm>
#include <cmath>
#include <cstring>

inline uint32_t& fakeMillisClock() { static uint32_t value = 0; return value; }
inline uint32_t millis() { return fakeMillisClock(); }
inline void delay(uint32_t ms) { fakeMillisClock() += ms; }

template <typename T>
inline T constrain(T value, T low, T high) {
    return std::min(std::max(value, low), high);
}

inline size_t strlcpy(char* dst, const char* src, size_t size) {
    const size_t len = std::strlen(src);
    if (size) {
        const size_t copied = std::min(len, size - 1);
        std::memcpy(dst, src, copied);
        dst[copied] = '\0';
    }
    return len;
}

struct FakeSerialPort {
    template <typename... Args> void printf(const char*, Args...) {}
    template <typename T> void println(const T&) {}
};
inline FakeSerialPort Serial;
