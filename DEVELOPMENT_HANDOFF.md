# Development snapshot — 2026-09-04

Not a stable release or approval for live-turbine operation. This branch preserves
the local controller-editor work and subsequent PCB/save-system fixes for continued testing.

## Included

- Page-owned partial saves for Hardware, Controllers, System, and Sequence.
- System hardware fields separated from Controller dirty state and safety warnings.
- Classic ESP32 Settings staging with temporary RX workspace reuse.
- Streaming hardware writes with overflow rejection; System/Sequence preserve stored Settings.
- Combined saves wait through the Hardware reboot before submitting Settings.
- START remains locked during save-triggered reboot delays.
- Unsaved-change navigation warnings and protection against telemetry clearing new edits.
- PCB connector capability/role improvements and controller/sequencer editor corrections.

## Verified in this session

- ESP32 build and COM3 firmware flash succeeded (97.2% application flash used).
- Updated compressed web assets uploaded without replacing the configuration filesystem.
- 272 safety-regression source checks passed.
- 49 UI simulator smoke checks passed before the final navigation-warning adjustment;
  a final rerun was started when this snapshot was prepared.
- Real ECU Settings PATCH saved and rebooted successfully.
- Real ECU System hardware PATCH preserved Settings exactly across reboot.
- Real ECU Controller hardware PATCH retained the Main Fuel rule; runtime statistics
  were refreshed from runtime state during that write.
- Eight real-ECU pages loaded and APIs remained available in a short navigation run.

## Resume here

1. Finish `tools/live_page_save_audit.cjs --allow-write` on an idle bench ECU.
   The earlier attempt stopped on the navigation selector; it now accepts versioned links.
   Combined saves and the final navigation changes still need an end-to-end pass.
2. Rerun UI smoke and live navigation audits, including long browsing sessions,
   cancelled navigation, reconnects, and maximum-size configurations.
3. Test PCB-profile mode and ESP32-S3 separately; COM3 testing used generic/no-PCB mode.
4. Review remaining memory-pressure error paths and full engine-file restore.
5. Complete independent safe-output/fault/interlock bench testing before live-turbine testing.

The original ECU description, theme, and Main Fuel rule were restored after tests.
No engine-start command was issued by these save tests. No release tag is created.
