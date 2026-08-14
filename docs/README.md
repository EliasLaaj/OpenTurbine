# OpenTurbine 2.0 developer and validation documentation

The repository root [`README.md`](../README.md) is a concise user gateway. The detailed current user procedure is [`USER_GUIDE.md`](USER_GUIDE.md); public summaries live in the Pages site under `site/`.

This directory contains material for people developing, validating, packaging, or integrating OpenTurbine.

For installations upgrading from a pre-2.0 build, read
[`V2_MIGRATION.md`](V2_MIGRATION.md) before restoring or reusing an engine
configuration.

## Product principles

- Support hobby turbine installations broadly: turbojets, APUs, generators, turboshafts, turboprops, test rigs, and unusual custom systems.
- Keep the ordinary path understandable, but preserve advanced configuration rather than deciding what a user is allowed to build.
- Derive visibility and suggestions from fitted hardware. Do not silently impose one installation type or preferred turbine architecture.
- Treat examples and suggested values as unverified starting points, never as authoritative limits.
- Require user action only for immediate safety, destructive operations, or configuration integrity. Prefer warnings and clear consequences when informed choice is possible.
- Keep the classic ESP32 target viable; its application partition has little remaining headroom, so firmware-size impact is a release concern.

## Public-content source of truth

| Fact | Source of truth |
| --- | --- |
| Setup Tool asset name | release workflow and `docs/SETUP_TOOL.md` |
| supported firmware targets | `platformio.ini` |
| default board IP | firmware and `site/_data/project.yml` |
| public project status | `site/_data/project.yml` |
| compatibility wording | `site/_data/compatibility.yml` |
| normal install procedure | `docs/USER_GUIDE.md` and `site/get-started.md` |
| update/recovery procedure | `docs/USER_GUIDE.md` and `site/troubleshooting.md` |
| developer build procedure | this file and `docs/SETUP_TOOL.md` |
| safety requirements | `docs/USER_GUIDE.md` and `site/safety.md` |

## Integrations

- [`OTC_CLUSTER_PROTOCOL.md`](OTC_CLUSTER_PROTOCOL.md) — complete OpenTurbine Cluster wire protocol
- [`../examples/cluster/README.md`](../examples/cluster/README.md) — practical cluster/companion-device implementation guide
- [`../examples/OTCClusterClient.h`](../examples/OTCClusterClient.h) — reusable Arduino/ESP32 OTC client

## Release engineering

- [`SETUP_TOOL.md`](SETUP_TOOL.md) — building and packaging the Windows setup tool and release assets
- [`V2_MIGRATION.md`](V2_MIGRATION.md) — intentional compatibility break, clean-install guidance, and v2 commissioning review
- [`WINDOWS_FLASHER_INSTALL.md`](WINDOWS_FLASHER_INSTALL.md) — legacy focused SmartScreen/download troubleshooting; normal installation lives in [`USER_GUIDE.md`](USER_GUIDE.md)
- [`../CHANGELOG.md`](../CHANGELOG.md) — version history

## Beta and internal work

- [`BETA_USER_GUIDE.md`](BETA_USER_GUIDE.md) — beta reporting and extended historical notes; [`USER_GUIDE.md`](USER_GUIDE.md) is authoritative for current setup
- [`internal/BETA_READINESS_PLAN.md`](internal/BETA_READINESS_PLAN.md) — internal validation plan
- [`../dev/`](../dev/) — design specification, code map, bench harness, campaigns, and validation records
- [`../tools/`](../tools/) — UI audits, asset generation, setup packaging, and build helpers

## Repository layout

| Path | Purpose |
|---|---|
| `src/` | ECU firmware implementation |
| `data_src/` | editable web interface sources |
| `data/` | generated gzip web assets stored in LittleFS |
| `examples/` | cluster and integration examples |
| `tools/` | release and validation tooling |
| `dev/` | developer design and bench-test material |
| `docs/internal/` | internal beta/release planning |
| `dist/` | locally generated packages and executables |

## Required release checks

Before publishing a release:

1. Confirm the **Release checks** GitHub Actions workflow passes. It runs every browser audit, both firmware/filesystem builds, and the Windows installer tests/build on clean hosted machines.
2. Locally, run `python tools/run_release_checks.py`. This rebuilds split web sources and compressed assets, validates public content, runs all `tools/ui_*.cjs` audits (including mixed-configuration fuzzing), runs firmware/safety/setup tests, builds both targets and filesystems, and enforces image/linker budgets.
3. After a visible UI change, run `node tools/capture_public_screenshots.cjs` and visually inspect every updated image in `site/assets/images/`. The fixture is simulated and must remain free of user data.
4. Build firmware and LittleFS for `esp32dev` and `esp32s3dev`.
5. Run `go test ./...` and rebuild the setup tool from `tools/setup_tool/`.
6. Build the recommended ZIP with complete CP210x and CH340 driver packages.
7. Test USB installation on a blank board and Wi-Fi update on an installed ECU.
8. Perform the physical ECU bench campaign required by the changed control paths.
9. Confirm the firmware, package manifest, changelog, release title, and website all identify `2.0.2`.
10. Publish `OpenTurbineSetupTool.exe`, `OpenTurbine_Recommended.zip`, and their SHA-256 files under the exact stable asset names required by the release workflow and Setup Tool.
