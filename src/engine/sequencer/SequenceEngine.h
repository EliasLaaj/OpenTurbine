#pragma once
#include "IBlock.h"
#include "../EngineData.h"
#include "../../system/FlightRecorder.h"
#include "../../system/HardwareConfig.h"
#include "../../system/RulesEngine.h"
#include <stddef.h>
#include <stdio.h>   // snprintf

// ============================================================
//  SequenceEngine — runs an ordered array of IBlock*
//
//  One active sequence at a time (startup OR shutdown).
//  Called by Hardware::tick() via SequenceEngine::tick().
//
//  On each tick():
//    1. Call activeBlock->tick()
//    2. Route result: Complete → next, Abort → standby, Fault → shutdown
//    3. Call onExit() / onEnter() at transitions
//
//  No dynamic allocation — sequences are compiled-in pointer arrays.
// ============================================================

class SequenceEngine {
public:
    using ResultFn  = void(*)(const char* blockName, BlockResult result);
    using DoneFn    = ResultFn;   // called when sequence finishes normally
    using AbortFn   = ResultFn;   // called on BlockResult::Abort
    using FaultFn   = ResultFn;   // called on BlockResult::Fault

    void setCallbacks(DoneFn done, AbortFn abort, FaultFn fault) {
        _done  = done;
        _abort = abort;
        _fault = fault;
    }
    void setAfterburnerContext(bool afterburner) { _afterburner = afterburner; }

    void startSequence(IBlock** blocks, size_t count,
                       const HardwareConfig::SeqSideAction (*enterActions)[HardwareConfig::MAX_SEQ_SIDE_ACTIONS] = nullptr,
                       const HardwareConfig::SeqSideAction (*exitActions)[HardwareConfig::MAX_SEQ_SIDE_ACTIONS] = nullptr) {
        // If a sequence is already running, exit the current block cleanly so its
        // onExit() cleanup runs (e.g. ABIgnite restores pre-torch throttle).
        // Without this, interrupting mid-sequence (e.g. fault during AB ignition)
        // leaves actuators in whatever state the block had set them.
        // Replacement is ECU-owned cleanup. User success/timeout exit actions
        // must not run for a forced replacement.
        const uint32_t operation = ++_generation;
        _cancelStarterTransition();
        if (_running && _blocks && _idx < _count) {
            IBlock::setAfterburnerContext(_afterburner);
            _blocks[_idx]->onExit();
            if (_generation != operation) return;
        }
        _blocks  = blocks;
        _count   = count;
        _idx     = 0;
        _enterActions = enterActions;
        _exitActions  = exitActions;
        _running = count > 0;
        auto& ed = EngineData::instance();
        if (_afterburner) {
            ed.abSeqBlockTotal = (uint8_t)count; ed.abSeqBlockIdx = 0;
            ed.abSeqStartedMs = millis(); ed.abSeqEndedMs = 0; ed.abSeqLastResult[0] = '\0';
            ed.abSeqFaultBlock[0] = '\0';
        } else {
            ed.seqBlockTotal = (uint8_t)count; ed.seqBlockIdx = 0;
            ed.seqStartedMs = millis(); ed.seqEndedMs = 0; ed.seqLastResult[0] = '\0';
            ed.seqFaultBlock[0] = '\0';
        }
        if (_running) _enter(0);
    }

    void stopSequence() {
        const uint32_t operation = ++_generation;
        _cancelStarterTransition();
        if (_running && _idx < _count) {
            IBlock::setAfterburnerContext(_afterburner);
            _blocks[_idx]->onExit();
            if (_generation != operation) return;
        }
        _running = false;
        _blocks  = nullptr;
        _count   = 0;
        _idx     = 0;
        _enterActions = nullptr;
        _exitActions  = nullptr;
        auto& ed = EngineData::instance();
        if (_afterburner) {
            ed.abCurrentBlock[0] = '\0'; ed.abSeqBlockTotal = 0; ed.abSeqBlockIdx = 0;
            ed.abSeqEndedMs = millis();
            strncpy(ed.abSeqLastResult, "stopped", sizeof(ed.abSeqLastResult)-1);
            ed.abSeqLastResult[sizeof(ed.abSeqLastResult)-1] = '\0';
        } else {
            ed.currentBlock[0] = '\0'; ed.seqBlockTotal = 0; ed.seqBlockIdx = 0;
            ed.seqEndedMs = millis();
            strncpy(ed.seqLastResult, "stopped", sizeof(ed.seqLastResult)-1);
            ed.seqLastResult[sizeof(ed.seqLastResult)-1] = '\0';
        }
    }

    void tick() {
        _updateStarterTransition();
        if (!_running || !_blocks || _idx >= _count) return;
        const uint32_t operation = _generation;

        IBlock::setAfterburnerContext(_afterburner);
        BlockResult r = _blocks[_idx]->tick();
        if (_generation != operation) return;

        switch (r) {
            case BlockResult::Running:
                break;

            case BlockResult::Complete:
            case BlockResult::TimeoutContinue:
                {
                const bool acceptedTimeout = r == BlockResult::TimeoutContinue;
                const char* completedBlock = _blocks[_idx]->name();
                FlightRecorder::logBlockExit(_blocks[_idx]->name(), acceptedTimeout ? "timeout_continue" : "ok");
                _blocks[_idx]->onExit();
                _applyActions(_exitActions, _idx);
                if (_generation != operation) return;
                _idx++;
                if (_idx >= _count) {
                    _running = false;
                    _recordResult(acceptedTimeout ? "timeout_continue" : "complete");
                    if (_done) _done(completedBlock, r);
                } else {
                    _enter(_idx);
                }
                break;
                }

            case BlockResult::Abort:
                // In bench mode: treat abort as Complete so the full sequence still runs.
                // Real engines need the abort path; bench tests just need to step through.
                if (EngineData::instance().benchMode) {
                    FlightRecorder::logBlockExit(_blocks[_idx]->name(), "bench_mode_skip");
                    _blocks[_idx]->onExit();
                    _applyActions(_exitActions, _idx);
                    if (_generation != operation) return;
                    _idx++;
                    if (_idx >= _count) { _running = false; _recordResult("complete"); if (_done) _done(_blocks[_idx - 1]->name(), BlockResult::Complete); }
                    else { _enter(_idx); }
                    break;
                }
                FlightRecorder::logBlockExit(_blocks[_idx]->name(), "abort");
                _cancelStarterTransition();
                _blocks[_idx]->onExit();
                if (_generation != operation) return;
                _running = false;
                _recordResult("abort");
                if (_abort) _abort(_blocks[_idx]->name(), BlockResult::Abort);
                break;

            case BlockResult::Fault:
                // Same: bench mode converts fault to Continue rather than shutdown.
                if (EngineData::instance().benchMode) {
                    FlightRecorder::logBlockExit(_blocks[_idx]->name(), "bench_mode_skip");
                    _blocks[_idx]->onExit();
                    _applyActions(_exitActions, _idx);
                    if (_generation != operation) return;
                    _idx++;
                    if (_idx >= _count) { _running = false; _recordResult("complete"); if (_done) _done(_blocks[_idx - 1]->name(), BlockResult::Complete); }
                    else { _enter(_idx); }
                    break;
                }
                FlightRecorder::logBlockExit(_blocks[_idx]->name(), "fault");
                _cancelStarterTransition();
                _recordFaultBlock(_blocks[_idx]->name());
                _blocks[_idx]->onExit();
                if (_generation != operation) return;
                _running = false;
                _recordResult("fault");
                if (_fault) _fault(_blocks[_idx]->name(), BlockResult::Fault);
                break;
        }
    }

    bool isRunning()         const { return _running; }
    int  currentBlockIndex() const { return (int)_idx; }
    const char* currentBlockName() const {
        if (_running && _blocks && _idx < _count) return _blocks[_idx]->name();
        return "IDLE";
    }

private:
    IBlock**  _blocks  = nullptr;
    size_t    _count   = 0;
    size_t    _idx     = 0;
    const HardwareConfig::SeqSideAction (*_enterActions)[HardwareConfig::MAX_SEQ_SIDE_ACTIONS] = nullptr;
    const HardwareConfig::SeqSideAction (*_exitActions)[HardwareConfig::MAX_SEQ_SIDE_ACTIONS] = nullptr;
    bool      _running = false;
    bool      _afterburner = false;
    uint32_t  _generation = 0;
    DoneFn    _done    = nullptr;
    AbortFn   _abort   = nullptr;
    FaultFn   _fault   = nullptr;
    bool      _starterTransitionActive = false;
    float     _starterTransitionFrom = 0.0f;
    float     _starterTransitionTo = 0.0f;
    uint32_t  _starterTransitionStartedMs = 0;
    uint32_t  _starterTransitionDurationMs = 0;

    void _enter(size_t i) {
        const char* bname = _blocks[i]->name();
        auto& ed = EngineData::instance();
        // Update last-event for dashboard display
        snprintf(ed.lastEvent, sizeof(ed.lastEvent), "Seq: %s", bname);
        // Update sequence progress fields for web UI
        char* current = _afterburner ? ed.abCurrentBlock : ed.currentBlock;
        const size_t currentSize = _afterburner ? sizeof(ed.abCurrentBlock) : sizeof(ed.currentBlock);
        strncpy(current, bname, currentSize - 1); current[currentSize - 1] = '\0';
        if (_afterburner) ed.abSeqBlockIdx = (uint8_t)i; else ed.seqBlockIdx = (uint8_t)i;
        FlightRecorder::logBlockEnter(bname);
        IBlock::setAfterburnerContext(_afterburner);
        _blocks[i]->onEnter();
        _applyActions(_enterActions, i);
        // A configurable side action must never be able to re-energize a
        // combustion or starter output in the hard-cut shutdown block.
        if (strcmp(bname, "ImmediateCut") == 0) {
            _cancelStarterTransition();
            _blocks[i]->onEnter();
        }
    }

    void _recordResult(const char* result) {
        auto& ed = EngineData::instance();
        char* target = _afterburner ? ed.abSeqLastResult : ed.seqLastResult;
        const size_t size = _afterburner ? sizeof(ed.abSeqLastResult) : sizeof(ed.seqLastResult);
        strncpy(target, result, size - 1); target[size - 1] = '\0';
        if (_afterburner) { ed.abSeqEndedMs = millis(); ed.abCurrentBlock[0] = '\0'; }
        else { ed.seqEndedMs = millis(); ed.currentBlock[0] = '\0'; }
    }

    void _recordFaultBlock(const char* blockName) {
        auto& ed = EngineData::instance();
        char* target = _afterburner ? ed.abSeqFaultBlock : ed.seqFaultBlock;
        const size_t size = _afterburner ? sizeof(ed.abSeqFaultBlock) : sizeof(ed.seqFaultBlock);
        strncpy(target, blockName ? blockName : "UNKNOWN", size - 1);
        target[size - 1] = '\0';
    }

    void _applyActions(const HardwareConfig::SeqSideAction (*actions)[HardwareConfig::MAX_SEQ_SIDE_ACTIONS], size_t i) {
        if (!actions || i >= HardwareConfig::MAX_SEQ_BLOCKS) return;
        for (int j = 0; j < HardwareConfig::MAX_SEQ_SIDE_ACTIONS; j++) {
            const auto& a = actions[i][j];
            if (!a.enabled) continue;
            if (a.actuator == RulesEngine::STARTER && a.transitionMs > 0) {
                auto& ed = EngineData::instance();
                _starterTransitionFrom = constrain(ed.starterDemand, 0.0f, 1.0f);
                _starterTransitionTo = constrain(a.value, 0.0f, 1.0f);
                _starterTransitionStartedMs = millis();
                _starterTransitionDurationMs = a.transitionMs;
                _starterTransitionActive = true;
                _updateStarterTransition();
            } else {
                if (a.actuator == RulesEngine::STARTER) _cancelStarterTransition();
                RulesEngine::applyActuatorDemand(a.actuator, a.value);
            }
        }
    }

    void _cancelStarterTransition() {
        _starterTransitionActive = false;
        _starterTransitionDurationMs = 0;
    }

    void _updateStarterTransition() {
        if (!_starterTransitionActive || _starterTransitionDurationMs == 0) return;
        const uint32_t elapsed = millis() - _starterTransitionStartedMs;
        if (elapsed >= _starterTransitionDurationMs) {
            RulesEngine::applyActuatorDemand(RulesEngine::STARTER, _starterTransitionTo);
            _cancelStarterTransition();
            return;
        }
        const float fraction = (float)elapsed / (float)_starterTransitionDurationMs;
        const float demand = _starterTransitionFrom +
                             (_starterTransitionTo - _starterTransitionFrom) * fraction;
        RulesEngine::applyActuatorDemand(RulesEngine::STARTER, demand);
    }
};
