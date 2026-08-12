#pragma once
#include "FreeRTOS.h"
#include <cstring>
#include <deque>
#include <vector>

struct FakeQueue {
    size_t depth;
    size_t itemSize;
    std::deque<std::vector<unsigned char>> items;
};
using QueueHandle_t = FakeQueue*;

inline QueueHandle_t xQueueCreate(size_t depth, size_t itemSize) {
    return new FakeQueue{depth, itemSize, {}};
}
inline BaseType_t xQueueSendToBack(QueueHandle_t q, const void* item, TickType_t) {
    if (!q || q->items.size() >= q->depth) return pdFALSE;
    q->items.emplace_back(q->itemSize);
    std::memcpy(q->items.back().data(), item, q->itemSize);
    return pdTRUE;
}
inline BaseType_t xQueueSendToFront(QueueHandle_t q, const void* item, TickType_t) {
    if (!q || q->items.size() >= q->depth) return pdFALSE;
    q->items.emplace_front(q->itemSize);
    std::memcpy(q->items.front().data(), item, q->itemSize);
    return pdTRUE;
}
inline BaseType_t xQueueReceive(QueueHandle_t q, void* item, TickType_t) {
    if (!q || q->items.empty()) return pdFALSE;
    std::memcpy(item, q->items.front().data(), q->itemSize);
    q->items.pop_front();
    return pdTRUE;
}
inline BaseType_t xQueueReset(QueueHandle_t q) {
    if (!q) return pdFALSE;
    q->items.clear();
    return pdTRUE;
}