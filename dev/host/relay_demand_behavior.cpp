#include "src/hal/actuators/RelayDemand.h"

#include <cassert>

int main() {
    assert(!RelayDemand::requested(0.0f));
    assert(RelayDemand::requested(0.000001f));
    assert(RelayDemand::requested(0.20f));
    assert(RelayDemand::requested(1.0f));
    assert(!RelayDemand::requested(-0.01f));

    assert(!RelayDemand::midpoint(0.4999f));
    assert(RelayDemand::midpoint(0.5f));
    assert(RelayDemand::midpoint(1.0f));

    assert(!RelayDemand::physicalLevel(0.0f, false));
    assert(RelayDemand::physicalLevel(0.20f, false));
    assert(RelayDemand::physicalLevel(0.0f, true));
    assert(!RelayDemand::physicalLevel(0.20f, true));
    assert(RelayDemand::binary(false) == 0.0f);
    assert(RelayDemand::binary(true) == 1.0f);
    return 0;
}
