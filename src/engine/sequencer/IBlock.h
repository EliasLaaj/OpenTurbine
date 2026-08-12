#pragma once
#include "../EngineData.h"
#include <stdio.h>   // snprintf
#include <string.h>  // strncpy

// ── Sequence block result ─────────────────────────────────────
enum class BlockResult {
    Running,    // still executing — call tick() next loop
    Complete,   // done cleanly — advance to next block
    TimeoutContinue, // optional condition timed out; log explicitly and continue
    Abort,      // abort to STANDBY with no shutdown (engine never ran)
    Fault       // trigger full shutdown sequence
};

// ── Block interface ───────────────────────────────────────────
// Every startup and shutdown block implements this.
// onEnter() / onExit() are optional; tick() is mandatory.
// SequenceEngine calls these — blocks never call each other.
class IBlock {
public:
    static void setAfterburnerContext(bool afterburner) { _afterburnerContext = afterburner; }
    virtual ~IBlock() = default;
    virtual const char* name()      = 0;
    virtual void        onEnter()   {}
    virtual BlockResult tick()      = 0;
    virtual void        onExit()    {}

protected:
    static void setWaitReason(const char* reason) {
        auto& ed = EngineData::instance();
        char* target = _afterburnerContext ? ed.abSeqWaitReason : ed.seqWaitReason;
        const size_t size = _afterburnerContext ? sizeof(ed.abSeqWaitReason) : sizeof(ed.seqWaitReason);
        strncpy(target, reason, size - 1);
        target[size - 1] = '\0';
    }
    static void clearWaitReason() {
        auto& ed = EngineData::instance();
        (_afterburnerContext ? ed.abSeqWaitReason : ed.seqWaitReason)[0] = '\0';
    }

private:
    static inline bool _afterburnerContext = false;
};
