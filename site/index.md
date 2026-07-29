---
layout: landing
title: Open-source ESP32 turbine ECU
description: OpenTurbine is open-source ESP32 turbine ECU software with guided Windows setup, hardware-aware configuration, editable sequences, calibration, monitoring and logging.
---

<section class="hero"><div class="shell hero-grid"><div>
<p class="eyebrow">OpenTurbine 2.0 · open-source ESP32 turbine ECU</p>
<h1>Build the turbine controller your system needs</h1>
<p class="lede">Configure sensors, actuators, sequences, limits and control rules from a browser. No source-code build is required for the normal Windows setup.</p>
{% include download-cta.html %}
<p class="quiet">For turbojets, APUs, generators, turboshafts, turboprops and turbine test rigs.</p>
</div><div><img class="screenshot" src="{{ '/assets/images/hero-dashboard.png' | relative_url }}?v=20260718b" width="1800" height="1050" alt="OpenTurbine dashboard during a representative simulated single-shaft turbine run, showing N1, turbine temperature, oil pressure, oil temperature, battery voltage and actuator demand"></div></div></section>

<section class="section alt"><div class="shell"><h2>Start where you are</h2><div class="card-grid three">
<a class="card" href="{{ '/get-started/' | relative_url }}"><h3>Install on a board</h3><p>Use the Windows Setup Tool, connect to the ECU Wi-Fi and open the dashboard.</p></a>
<a class="card" href="{{ '/user-guide/' | relative_url }}"><h3>Build and configure an ECU</h3><p>Read the complete guide for wiring, Hardware, Config, calibration, sequences and dry testing.</p></a>
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
  <li>Threshold and input-to-output control rules</li>
  <li>Browser monitoring, backups, event logs and run logs</li>
</ul>
</div><figure><img class="screenshot" src="{{ '/assets/images/hardware-page.png' | relative_url }}?v=20260718b" width="1800" height="1050" loading="lazy" alt="OpenTurbine Hardware page showing a conflict-free example turbine channel inventory"><figcaption>Hardware contains only the sensors and actuators fitted to this example. Values shown throughout the documentation are examples, not settings to copy.</figcaption></figure></div></section>

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
