#pragma once

#include <Arduino.h>

namespace ConfigInternal {

int8_t ruleSourceHandle(const char* id);
int8_t ruleTargetHandle(const char* id);

#ifdef OT_DYNAMIC_IDLE_USE_N2
inline constexpr bool idleUseN2Default = true;
#else
inline constexpr bool idleUseN2Default = false;
#endif

extern portMUX_TYPE statsMux;

}  // namespace ConfigInternal
