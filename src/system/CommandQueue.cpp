#include "CommandQueue.h"
#include <Arduino.h>
#include <cstring>

QueueHandle_t CommandQueue::_queue = nullptr;

namespace {
struct ResultSlot {
    uint32_t id = 0;
    uint8_t state = 0; // 1 pending, 2 accepted, 3 rejected, 4 canceled, 5 claimed
    char reason[120] = {};
};
ResultSlot s_results[8];
volatile uint32_t s_nextRequestId = 1;
portMUX_TYPE s_resultMux = portMUX_INITIALIZER_UNLOCKED;
}

uint32_t CommandQueue::nextRequestId() {
    portENTER_CRITICAL(&s_resultMux);
    uint32_t id = s_nextRequestId;
    s_nextRequestId = s_nextRequestId + 1U;
    if (s_nextRequestId == 0) s_nextRequestId = 1;
    portEXIT_CRITICAL(&s_resultMux);
    return id;
}

void CommandQueue::beginResult(uint32_t id) {
    if (!id) return;
    portENTER_CRITICAL(&s_resultMux);
    ResultSlot& slot = s_results[id % 8];
    slot.id = id;
    slot.state = 1;
    slot.reason[0] = '\0';
    portEXIT_CRITICAL(&s_resultMux);
}

bool CommandQueue::claimPendingResult(uint32_t id) {
    if (!id) return true;
    bool claimed = false;
    portENTER_CRITICAL(&s_resultMux);
    ResultSlot& slot = s_results[id % 8];
    if (slot.id == id && slot.state == 1) {
        slot.state = 5;
        claimed = true;
    }
    portEXIT_CRITICAL(&s_resultMux);
    return claimed;
}

bool CommandQueue::cancelPendingResult(uint32_t id) {
    if (!id) return false;
    bool canceled = false;
    portENTER_CRITICAL(&s_resultMux);
    ResultSlot& slot = s_results[id % 8];
    if (slot.id == id && slot.state == 1) {
        slot.state = 4;
        canceled = true;
    }
    portEXIT_CRITICAL(&s_resultMux);
    return canceled;
}

void CommandQueue::completeResult(uint32_t id, bool accepted, const char* reason) {
    if (!id) return;
    portENTER_CRITICAL(&s_resultMux);
    ResultSlot& slot = s_results[id % 8];
    if (slot.id == id && slot.state == 5) {
        slot.state = accepted ? 2 : 3;
        strncpy(slot.reason, reason ? reason : "", sizeof(slot.reason) - 1);
        slot.reason[sizeof(slot.reason) - 1] = '\0';
    }
    portEXIT_CRITICAL(&s_resultMux);
}

bool CommandQueue::waitResult(uint32_t id, uint32_t timeoutMs, bool& accepted,
                              char* reason, size_t reasonLen) {
    const uint32_t started = millis();
    while (millis() - started < timeoutMs) {
        uint8_t state = 0;
        char copy[120] = {};
        portENTER_CRITICAL(&s_resultMux);
        const ResultSlot& slot = s_results[id % 8];
        if (slot.id == id) {
            state = slot.state;
            strncpy(copy, slot.reason, sizeof(copy) - 1);
        }
        portEXIT_CRITICAL(&s_resultMux);
        if (state == 2 || state == 3) {
            accepted = state == 2;
            if (reason && reasonLen) {
                strncpy(reason, copy, reasonLen - 1);
                reason[reasonLen - 1] = '\0';
            }
            return true;
        }
        delay(1);
    }
    return false;
}
