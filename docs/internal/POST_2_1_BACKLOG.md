# OpenTurbine post-2.1 backlog

This is the short active backlog after OpenTurbine 2.1.0. The historical audit and implementation record remains in `CODE_FIX_TODO_2026-08-02.md`; completed findings are not reopened here.

## Current rule

- Keep the published `v2.1.0` tag immutable.
- Make a 2.1.x patch only for a confirmed defect or a small documentation/release correction.
- Put new behavior in a later feature release and require evidence that it is needed.
- Preserve the YAGNI, easy-by-default, expert-freedom, and dual-target rules used for 2.1.0.

## Active work

- [x] Publish a compact single-shaft example that helps users understand how Hardware, Controllers, Calibration, Sequence, and protection fit together without supplying unsafe universal tuning values.
- [ ] Review reproducible tester reports and attached configuration/log evidence as they arrive.
- [ ] Test common real sensor/expansion modules and electrical interfaces that the present bench could not physically exercise.
- [ ] Prepare a staged first-engine commissioning and log-review procedure before a fueled turbine becomes available.

## Deferred until justified

- Propeller reverse-thrust control.
- Additional protocol integrations.
- More advanced predictive control.
- Broad UI or controller redesign without a demonstrated workflow problem.
- Paid code signing; retain the checksum-verified unsigned release path unless a suitable free signing program becomes available.

## Known validation boundary

Version 2.1.0 passed the software release gate and dual-board dry-bench qualification. It has not run a fuel-burning turbine and has not proven any installation-specific power driver, wiring, grounding, plumbing, EMI environment, or engine tune.
