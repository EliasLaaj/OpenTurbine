#include "../../src/system/CommandQueue.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <vector>

static std::vector<OTCommand> handled;
static void capture(const OTPacket& packet) { handled.push_back(packet.cmd); }

int main() {
    assert(CommandQueue::begin());

    // Emergency STOP discards every older energizing request and is first.
    assert(CommandQueue::push({OTCommand::START}));
    assert(CommandQueue::push({OTCommand::FUEL_PRIME}));
    assert(CommandQueue::pushEmergencyStop({OTCommand::STOP}));
    CommandQueue::drain(capture);
    assert(handled.size() == 1 && handled[0] == OTCommand::STOP);

    // A STOP handler is also a barrier against work queued behind it.
    handled.clear();
    assert(CommandQueue::push({OTCommand::STOP}));
    assert(CommandQueue::push({OTCommand::START}));
    CommandQueue::drain(capture);
    assert(handled.size() == 1 && handled[0] == OTCommand::STOP);

    // AB_STOP uses the same cancellation contract; old AB_FIRE cannot survive.
    handled.clear();
    assert(CommandQueue::push({OTCommand::AB_FIRE}));
    assert(CommandQueue::pushEmergencyFront({OTCommand::AB_STOP}));
    CommandQueue::drain(capture);
    assert(handled.size() == 1 && handled[0] == OTCommand::AB_STOP);

    // Request decisions are correlated and preserve exact rejection text.
    const uint32_t id = CommandQueue::nextRequestId();
    CommandQueue::beginResult(id);
    assert(CommandQueue::claimPendingResult(id));
    assert(!CommandQueue::cancelPendingResult(id));
    CommandQueue::completeResult(id, false, "START blocked: STOP input is active");
    bool accepted = true;
    char reason[120] = {};
    assert(CommandQueue::waitResult(id, 10, accepted, reason, sizeof(reason)));
    assert(!accepted);
    assert(std::strcmp(reason, "START blocked: STOP input is active") == 0);

    // A web timeout can cancel only an unclaimed START. A canceled request
    // cannot later be claimed by the ECU, and a stale completion is ignored.
    const uint32_t canceledId = CommandQueue::nextRequestId();
    CommandQueue::beginResult(canceledId);
    assert(CommandQueue::cancelPendingResult(canceledId));
    assert(!CommandQueue::claimPendingResult(canceledId));
    CommandQueue::completeResult(canceledId, true, "");
    accepted = true;
    assert(!CommandQueue::waitResult(canceledId, 2, accepted, reason, sizeof(reason)));

    std::cout << "real CommandQueue behavior passed\n";
}
