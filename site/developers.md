---
layout: document
title: OpenTurbine developer documentation and source build
description: Build OpenTurbine from source, validate firmware and web changes, package the Windows Setup Tool, or integrate the OpenTurbine Cluster protocol.
lede: Build source, validate changes, package releases, or integrate the OpenTurbine Cluster protocol.
---

The developer path is intentionally separate from normal Windows setup. Use the repository's [developer documentation](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/tree/main/docs), [setup-tool packaging guide](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/blob/main/docs/SETUP_TOOL.md), and [OTC protocol](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/blob/main/docs/OTC_CLUSTER_PROTOCOL.md).

Run the existing browser audits with `npm ci` then `npm run audit:ui`. Build both supported firmware environments and filesystem images before release. Check each release's notes for its signing status.

## Useful entry points

- [Build and development documentation](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/tree/main/docs) covers the firmware and web workflows.
- [Setup Tool packaging](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/blob/main/docs/SETUP_TOOL.md) describes the Windows release artifact.
- [OTC Cluster protocol](https://github.com/elia179/OpenTurbine-ESP32-Gas-Turbine-ECU/blob/main/docs/OTC_CLUSTER_PROTOCOL.md) is the integration reference.

Keep operational and developer paths distinct: users should install a published setup-tool release, while contributors should build, test, and review from source. Do not publish a release without recording the verification results and signing status.
