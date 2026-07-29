#pragma once

#include "HardwareConfig.h"

namespace HardwareConfigInternal {

void writeSequenceSideActions(
    JsonObject doc, const char* key, int sequenceLength,
    HardwareConfig::SeqSideAction actions[HardwareConfig::MAX_SEQ_BLOCKS]
                                          [HardwareConfig::MAX_SEQ_SIDE_ACTIONS]);
void writeCustomBlocks(JsonObject doc);

}  // namespace HardwareConfigInternal
