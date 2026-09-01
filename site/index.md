---
layout: landing
title: Open-source ESP32 turbine ECU
description: OpenTurbine is open-source ESP32 turbine ECU software with guided Windows setup, hardware-aware configuration, editable sequences, calibration, monitoring and logging.
---

<section class="hero"><div class="shell hero-grid"><div>
<p class="eyebrow">OpenTurbine 2.2 · open-source ESP32 turbine ECU</p>
<h1>A configurable ECU for experimental turbine engines</h1>
<p class="lede"><strong>OpenTurbine turns a supported Classic ESP32 or ESP32-S3 board into a browser-configured engine control unit.</strong> It can manage starting, fuel, oil, ignition, shutdown, protection and logging for hobby and development turbines.</p>
<p>Describe the sensors and actuators actually fitted, then build the operating sequence around your engine instead of adapting the engine to one fixed ECU layout.</p>
{% include download-cta.html %}
<p class="quiet">For turbojets, APUs, generators, turboshafts, turboprops and turbine test rigs.</p>
</div><div><img class="screenshot" src="{{ '/assets/images/hero-dashboard.png' | relative_url }}?v=20260901a" width="1800" height="1050" alt="OpenTurbine dashboard during a representative simulated single-shaft turbine run, showing N1, shaft acceleration, turbine temperature, oil pressure, oil temperature, battery voltage and actuator demand"></div></div></section>

<section class="section"><div class="shell">
<p class="eyebrow">Plan a complete system</p>
<h2>What can OpenTurbine do?</h2>
<p class="lede">Use the common turbine controllers directly, or combine fitted hardware, editable sequences and compact custom controllers for an unusual system. Features stay out of the normal setup until their required hardware is present.</p>
<div class="card-grid four">
  <div class="card"><h3>Start and stop the engine</h3><p>Build timed or feedback-driven startup and shutdown sequences around electric starters, air starters, fuel valves and pumps, igniters, glow systems, purge, cooldown and oil scavenge hardware.</p></div>
  <div class="card"><h3>Hold idle and govern a shaft</h3><p>Automatically hold idle from N1, N2, P1 or P2 feedback; regulate oil pressure; and govern a free power turbine through main fuel or propeller pitch.</p></div>
  <div class="card"><h3>Support different turbine layouts</h3><p>Configure single-shaft turbojets, APUs and generators, free-turbine turboshafts, variable-pitch turboprops, afterburning engines and instrumented development rigs.</p></div>
  <div class="card"><h3>Protect and understand the run</h3><p>Apply independent speed, temperature, oil, pressure, torque, flameout and sensor-health responses, then review event history, per-run CSV data and exact command ownership.</p></div>
</div>
</div></section>

<section class="section alt"><div class="shell">
<p class="eyebrow">See it before installing</p>
<h2>One interface, from wiring to a completed run</h2>
<p class="lede">The ECU hosts its own browser interface. These are real OpenTurbine pages; no internet connection is needed while configuring or operating the ECU.</p>
<div class="ui-gallery">
  <figure><img class="screenshot" src="{{ '/assets/images/hardware-page.png' | relative_url }}?v=20260901a" width="1800" height="1050" loading="lazy" alt="OpenTurbine Hardware page with fitted inputs and outputs"><figcaption><strong>Hardware</strong> — describe the fitted sensors, actuators and channels.</figcaption></figure>
  <figure><img class="screenshot" src="{{ '/assets/images/controllers-page.png' | relative_url }}?v=20260901a" width="1800" height="1050" loading="lazy" alt="OpenTurbine Controllers page with configurable turbine controls"><figcaption><strong>Controllers</strong> — choose how each output is commanded and protected.</figcaption></figure>
  <figure><img class="screenshot" src="{{ '/assets/images/calibration-page.png' | relative_url }}?v=20260901a" width="1800" height="1050" loading="lazy" alt="OpenTurbine Calibration page with guided sensor and actuator tools"><figcaption><strong>Calibration</strong> — verify real signals and usable output ranges safely.</figcaption></figure>
  <figure><img class="screenshot" src="{{ '/assets/images/sequence-page.png' | relative_url }}?v=20260901a" width="1800" height="1050" loading="lazy" alt="OpenTurbine Sequence page with editable startup blocks"><figcaption><strong>Sequence</strong> — build startup and shutdown around the engine.</figcaption></figure>
  <figure><img class="screenshot" src="{{ '/assets/images/system-page.png' | relative_url }}?v=20260901a" width="1800" height="1050" loading="lazy" alt="OpenTurbine System page with device and interface settings"><figcaption><strong>System</strong> — manage the device, interface and configuration backup.</figcaption></figure>
  <figure><img class="screenshot" src="{{ '/assets/images/tools-page.png' | relative_url }}?v=20260901a" width="1800" height="1050" loading="lazy" alt="OpenTurbine Tools page with diagnostics and bench controls"><figcaption><strong>Tools</strong> — diagnose, dry-test and understand the ECU state.</figcaption></figure>
</div>
</div></section>

<section class="section"><div class="shell"><h2>Start where you are</h2><div class="card-grid four">
<a class="card" href="{{ '/get-started/' | relative_url }}"><h3>Install on a board</h3><p>Use the Windows Setup Tool, connect to the ECU Wi-Fi and open the dashboard.</p></a>
<a class="card" href="{{ '/example-system/' | relative_url }}"><h3>Explore a basic system</h3><p>Follow one ordinary single-shaft example to see how hardware, controllers, calibration and sequences fit together.</p></a>
<a class="card" href="{{ '/user-guide/' | relative_url }}"><h3>Build and configure an ECU</h3><p>Read the complete guide for wiring, Hardware, Controllers, System, calibration, sequences and dry testing.</p></a>
<a class="card" href="{{ '/troubleshooting/' | relative_url }}"><h3>Fix a problem</h3><p>Go directly to help for USB, flashing, Wi-Fi, dashboard and update problems.</p></a>
</div></div></section>

<section class="section"><div class="shell split"><div>
<p class="eyebrow">What it provides</p>
<h2>One configurable ECU platform</h2>
<p>OpenTurbine describes the hardware actually fitted to the engine, exposes the relevant settings, and keeps unrelated options out of the way.</p>
<ul class="plain-feature-list">
  <li>Editable startup and shutdown sequences</li>
  <li>Sensor calibration and actuator testing</li>
  <li>Speed, temperature, pressure and controller limits</li>
  <li>Native, SPI, OneWire and discovered I²C sensor hardware</li>
  <li>PCB-profile ports, torque/thrust load cells and oil-flow monitoring</li>
  <li>Simple threshold and input-to-output controls</li>
  <li>Browser monitoring, backups, event logs and run logs</li>
</ul>
</div><figure><img class="screenshot" src="{{ '/assets/images/hardware-page.png' | relative_url }}?v=20260901a" width="1800" height="1050" loading="lazy" alt="OpenTurbine Hardware page showing a conflict-free example turbine channel inventory"><figcaption>Hardware contains only the sensors and actuators fitted to this example. Values shown throughout the documentation are examples, not settings to copy.</figcaption></figure></div></section>

<section class="section alt"><div class="shell"><div class="compact-callout"><div><h2>Check compatibility before installing</h2><p>Normal setup supports Classic ESP32 boards with at least 4 MB flash and ESP32-S3 DevKitC-1-compatible boards with at least 8 MB flash. The universal S3 image also runs on 16 MB modules and does not require PSRAM. The guided installer currently requires Windows.</p></div><a class="button secondary" href="{{ '/hardware/' | relative_url }}">Read hardware requirements</a></div></div></section>

<section class="section"><div class="shell split"><div>
<h2>Experimental software, independent safety</h2>
<p>OpenTurbine does not replace suitable drivers, fusing, signal conditioning or an independent physical emergency stop. Verify the complete system with fuel, ignition energy, starter power and load power isolated before an operating test.</p>
<a href="{{ '/safety/' | relative_url }}">Read the safety requirements</a>
</div><div>
<h2>Source is open</h2>
<p>Use the released firmware and Setup Tool, inspect the source, adapt it for your own project, or contribute improvements.</p>
<a href="{{ site.data.project.repository_url }}">View OpenTurbine on GitHub</a>
</div></div></section>
