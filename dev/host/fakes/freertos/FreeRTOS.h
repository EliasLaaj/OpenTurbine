#pragma once
#include <cstdint>
#include <mutex>

using BaseType_t = int;
using TickType_t = uint32_t;
constexpr BaseType_t pdTRUE = 1;
constexpr BaseType_t pdFALSE = 0;
constexpr TickType_t portMAX_DELAY = 0xffffffffu;
struct portMUX_TYPE { std::mutex mutex; };
#define portMUX_INITIALIZER_UNLOCKED {}
#define portENTER_CRITICAL(mux) (mux)->mutex.lock()
#define portEXIT_CRITICAL(mux) (mux)->mutex.unlock()