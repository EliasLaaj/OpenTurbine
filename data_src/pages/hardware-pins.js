// ═══════════════════════════════════════════════════
//  GPIO PIN DATABASE
// ═══════════════════════════════════════════════════
const GPIO_DB_ESP32 = {
   0: {s:1, a2:1, label:'GPIO0'},
   1: {u:1,       label:'GPIO1 (UART TX)'},
   2: {s:1, a2:1, label:'GPIO2'},
   3: {u:1,       label:'GPIO3 (UART RX)'},
   4: {      a2:1, label:'GPIO4'},
   5: {s:1,       label:'GPIO5'},
   6: {r:1,       label:'GPIO6 (SPI Flash)'},
   7: {r:1,       label:'GPIO7 (SPI Flash)'},
   8: {r:1,       label:'GPIO8 (SPI Flash)'},
   9: {r:1,       label:'GPIO9 (SPI Flash)'},
  10: {r:1,       label:'GPIO10 (SPI Flash)'},
  11: {r:1,       label:'GPIO11 (SPI Flash)'},
  12: {s:1, a2:1, label:'GPIO12'},
  13: {      a2:1, label:'GPIO13'},
  14: {      a2:1, label:'GPIO14'},
  15: {s:1, a2:1, label:'GPIO15'},
  16: {label:'GPIO16'},
  17: {label:'GPIO17'},
  18: {label:'GPIO18'},
  19: {label:'GPIO19'},
  21: {label:'GPIO21'},
  22: {label:'GPIO22'},
  23: {label:'GPIO23'},
  25: {a2:1, label:'GPIO25'},
  26: {a2:1, label:'GPIO26'},
  27: {a2:1, label:'GPIO27'},
  32: {adc1:1, label:'GPIO32'},
  33: {adc1:1, label:'GPIO33'},
  34: {adc1:1, i:1, label:'GPIO34 (input only)'},
  35: {adc1:1, i:1, label:'GPIO35 (input only)'},
  36: {adc1:1, i:1, label:'GPIO36 (input only)'},
  39: {adc1:1, i:1, label:'GPIO39 (input only)'},
};

const GPIO_DB_ESP32S3 = {
   0: {s:1,       label:'GPIO0'},
   1: {adc1:1,    label:'GPIO1 (ADC1)'},
   2: {adc1:1,    label:'GPIO2 (ADC1)'},
   3: {s:1, adc1:1, label:'GPIO3 (ADC1, strap)'},
   4: {adc1:1,    label:'GPIO4 (ADC1)'},
   5: {adc1:1,    label:'GPIO5 (ADC1)'},
   6: {adc1:1,    label:'GPIO6 (ADC1)'},
   7: {adc1:1,    label:'GPIO7 (ADC1)'},
   8: {adc1:1,    label:'GPIO8 (ADC1)'},
   9: {adc1:1,    label:'GPIO9 (ADC1)'},
  10: {adc1:1,    label:'GPIO10 (ADC1)'},
  11: {label:'GPIO11'},
  12: {label:'GPIO12'},
  13: {label:'GPIO13'},
  14: {label:'GPIO14'},
  15: {label:'GPIO15'},
  16: {label:'GPIO16'},
  17: {label:'GPIO17'},
  18: {label:'GPIO18'},
  21: {label:'GPIO21'},
  35: {label:'GPIO35'},
  36: {label:'GPIO36'},
  37: {label:'GPIO37'},
  38: {label:'GPIO38'},
  39: {label:'GPIO39'},
  40: {label:'GPIO40'},
  41: {label:'GPIO41'},
  42: {label:'GPIO42'},
  43: {u:1, label:'GPIO43 (UART TX)'},
  44: {u:1, label:'GPIO44 (UART RX)'},
  45: {s:1, label:'GPIO45 (strap)'},
  46: {s:1, i:1, label:'GPIO46 (strap, input only)'},
  47: {label:'GPIO47'},
  48: {label:'GPIO48 (YD onboard RGB / NeoPixel)'},
};

let GPIO_DB = GPIO_DB_ESP32;

function pinShareGroupForMode(mode) {
  if (mode === 'spi-clk') return 'spi-clk';
  if (mode === 'spi-miso') return 'spi-miso';
  if (mode === 'spi-mosi') return 'spi-mosi';
  if (mode === 'i2c-sda') return 'i2c-sda';
  if (mode === 'i2c-scl') return 'i2c-scl';
  return '';
}
function pinElectricalMode(mode) {
  if (mode === 'spi-miso') return 'in';
  if (mode === 'spi-clk' || mode === 'spi-mosi' || mode === 'i2c-scl') return 'out';
  return mode;
}
function pinShareLabel(group) {
  const labels = {
    'spi-clk':'shared SPI CLK',
    'spi-miso':'shared SPI MISO',
    'spi-mosi':'shared SPI MOSI',
    'i2c-sda':'shared I2C SDA',
    'i2c-scl':'shared I2C SCL'
  };
  return labels[group] || 'shared bus';
}
function hardwareHasAfterburner() {
  return !!(registryHasPurpose('output','ab_igniter') || registryHasPurpose('output','ab_pump') ||
    registryHasPurpose('output','ab_valve'));
}
function collectPinUsage() {
  const usage = new Map();
  const add = (v, label, group = '') => {
    if (v === undefined || v === null || v < 0) return;
    const pin = +v;
    if (!usage.has(pin)) usage.set(pin, []);
    usage.get(pin).push({label, group});
  };
  const c = cfg.controls || {};
  const profileActive = pcbProfileActive();
  if (profileActive) {
    const profileName = pcbProfile.name || pcbProfile.id || 'PCB profile';
    (pcbProfile.reserved_gpio || []).forEach(pin =>
      add(pin, `${profileName} reserved GPIO`, 'pcb-reserved'));
  }
  // START/STOP registry channels mirror the legacy controls fields. Count
  // either representation, not both, or a valid PCB assignment is reported
  // as conflicting with itself.
  if (!registryHasPurpose('input', 'stop_switch')) add(c.stop_pin, 'Stop input');
  if (!registryHasPurpose('input', 'start_switch')) add(c.start_pin, 'Start input');
  const i2c = cfg.i2c || {};
  if (i2c.enabled !== false && !(profileActive && pcbProfile?.bus_ownership?.i2c)) {
    add(i2c.sda_pin, 'Shared I2C SDA', 'i2c-sda');
    add(i2c.scl_pin, 'Shared I2C SCL', 'i2c-scl');
    add(i2c.interrupt_pin, 'TCA9554 interrupt');
  }
  const spi = cfg.spi || {};
  if (spi.enabled && !(profileActive && pcbProfile?.bus_ownership?.spi)) {
    add(spi.sck_pin, 'Shared SPI SCK', 'spi-clk');
    add(spi.miso_pin, 'Shared SPI MISO', 'spi-miso');
    add(spi.mosi_pin, 'Shared SPI MOSI', 'spi-mosi');
  }
  const statusLed = cfg.actuators?.status_led;
  if (statusLed?.enabled !== false &&
      !(profileActive && pcbProfile?.fixed_functions?.status_led?.available))
    add(statusLed?.pin, 'Status LED');
  const cl = cfg.cluster_serial || {};
  if (cl.enabled && !(profileActive && pcbProfile?.fixed_functions?.cluster_serial?.available)) {
    add(cl.tx_pin, 'Cluster Serial TX'); add(cl.rx_pin, 'Cluster Serial RX');
  }
  const mv = cfg.mavlink || {};
  if (mv.enabled && !(profileActive && pcbProfile?.fixed_functions?.mavlink?.available))
    add(mv.tx_pin, 'MAVLink TX');
  if (cfg.buzzer?.enabled &&
      !(profileActive && pcbProfile?.fixed_functions?.buzzer?.available))
    add(cfg.buzzer.pin, 'Buzzer');
  const abt = cfg.ab_trigger || {};
  if (hardwareHasAfterburner()) {
    if (abt.source === 2) add(abt.switch_pin, 'AB switch');
    add(abt.input_pin, 'AB input');
    if (abt.source !== 0 && abt.requires_arm) add(abt.arm_pin, 'AB arm');
  }
  (cfg.di_channels || []).forEach((ch, i) => add(ch.pin, ch.label || `DI channel ${i + 1}`));
  const r = registryRoot();
  (r.inputs || []).forEach(ch => {
    if (!ch || ch.installed === false) return;
    if (profileActive && (ch.physical_port ||
        (ch.purpose === 'battery_voltage' &&
         pcbProfile?.fixed_functions?.supply_voltage?.available))) return;
    if (registryTorqueIsHx711(ch)) {
      const label = registryDisplayName('input', ch, ch.id || 'Torque');
      add(ch.pin, `${label} DOUT`);
      add(ch.hx711_clk, `${label} SCK`);
    } else if (registryTemperatureIsSpi(ch)) {
      const label = registryDisplayName('input', ch, ch.id || 'Temperature');
      add(ch.spi_clk, `${label} CLK`, 'spi-clk');
      add(ch.spi_cs, `${label} CS`);
      add(ch.spi_miso, `${label} MISO`, 'spi-miso');
      add(ch.spi_mosi, `${label} MOSI`, 'spi-mosi');
    } else {
      add(ch.pin, registryDisplayName('input', ch, ch.id || 'Registry input'));
    }
  });
  (r.outputs || []).forEach(ch => {
    if (!ch || ch.installed === false) return;
    if (profileActive && ch.physical_port) return;
    const label = registryDisplayName('output', ch, ch.id || 'Registry output');
    add(ch.pin, label);
    const actuatorKey = registryCoreActuatorKey(ch);
    const dedicated = actuatorKey ? cfg.actuators?.[actuatorKey] : null;
    if (actuatorKey === 'glow_plug' && Number(dedicated?.type || 0) === 2) add(dedicated?.fuel_pin, 'Wet glow pilot fuel');
    const currentEnabled = dedicated ? !!dedicated.has_current : !!ch.has_current;
    const currentPin = dedicated ? dedicated.current_pin : ch.current_pin;
    if (currentEnabled) add(currentPin, `${label} current`);
  });
  return usage;
}
function collectUsedPins() {
  const pins = new Set();
  for (const pin of collectPinUsage().keys()) pins.add(+pin);
  return pins;
}
function buildPinOptions(currentVal, mode) {
  const pinUsage = collectPinUsage();
  const shareGroup = pinShareGroupForMode(mode);
  const electricalMode = pinElectricalMode(mode);
  const current = Number(currentVal ?? -1);
  let html = '<option value="-1">— Not assigned —</option>';
  const safe = [], strap = [], inOnly = [], uart = [];
  for (const [gpio, info] of Object.entries(GPIO_DB).sort((a,b) => +a[0] - +b[0])) {
    const g = +gpio;
    if (info.r) continue;
    if (electricalMode === 'adc') { if (!info.adc1) continue; }
    else if (electricalMode === 'out' || electricalMode === 'status-led') { if (info.i) continue; }
    const usedBy = pinUsage.get(g) || [];
    // The current field's own claim is normally ignored, but a PCB reservation
    // remains authoritative: a stale/manual bus assignment must not make a
    // profile-owned pin appear free.
    const usedByOther = g !== current ? usedBy : usedBy.filter(u => u.group === 'pcb-reserved');
    const busShareOk = !!shareGroup && usedByOther.length > 0 && usedByOther.every(u => u.group === shareGroup);
    const disabled = usedByOther.length > 0 && !busShareOk;
    const usedLabels = [...new Set(usedByOther.map(u => u.label).filter(Boolean))].slice(0, 3).join(', ');
    let suffix = '';
    if (disabled) suffix += ` [used by ${usedLabels || 'another device'}]`;
    else if (busShareOk) suffix += ` [${pinShareLabel(shareGroup)}]`;
    else if (g === current && usedBy.length > 1 && !shareGroup) suffix += ' [conflict]';
    if (info.s) { strap.push({g, cls:'pin-strap', suffix: suffix + ' ⚠ strap', disabled}); continue; }
    if (info.u) { uart.push({g, cls:'pin-uart', suffix: suffix + ' (UART0)', disabled}); continue; }
    if (info.i) { inOnly.push({g, cls:'pin-inonly', suffix: suffix + ' (input only)', disabled}); continue; }
    safe.push({g, cls:'', suffix, disabled});
  }
  function render(group, label) {
    if (!group.length) return '';
    let s = `<optgroup label="${label}">`;
    for (const {g, cls, suffix, disabled} of group) {
      const sel = g === current ? ' selected' : '';
      const dis = disabled ? ' disabled' : '';
      const title = disabled ? ` title="${escapeHtmlText(suffix.replace(/^\s+/, ''))}"` : '';
      s += `<option value="${g}" class="${cls}"${sel}${dis}${title}>GPIO${g}${suffix}</option>`;
    }
    return s + '</optgroup>';
  }
  html += render(safe, 'Available');
  if (strap.length)  html += render(strap,   'Strapping pins ⚠');
  if (inOnly.length && electricalMode !== 'out') html += render(inOnly, 'Input-only');
  if (uart.length)   html += render(uart,    'UART0 (debug serial)');
  return html;
}

function refreshPinSel(id, mode, currentVal) {
  const el = document.getElementById(id);
  if (!el) return;
  if (id === 'f-led-pin' && cfg.platform === 'esp32s3' &&
      cfg.actuators?.status_led?.enabled !== false &&
      (currentVal === undefined || currentVal === null || currentVal < 0 || currentVal === 38)) {
    currentVal = 48;
    if (!cfg.actuators) cfg.actuators = {};
    if (!cfg.actuators.status_led) cfg.actuators.status_led = {};
    cfg.actuators.status_led.enabled = true;
    cfg.actuators.status_led.pin = 48;
    if (cfg.actuators.status_led.type === undefined) cfg.actuators.status_led.type = 1;
  }
  el.innerHTML = buildPinOptions(currentVal, mode);
  el.value = currentVal !== undefined && currentVal !== null ? currentVal : -1;
}

function refreshAllPins() {
  const s = cfg.sensors || {};
  const a = cfg.actuators || {};
  const c = cfg.controls  || {};
  const cl = cfg.cluster_serial || {};
  const abt = cfg.ab_trigger || {};
  const abfl = cfg.ab_flame || {};

  refreshPinSel('f-stop-pin',       'in',  c.stop_pin);
  refreshPinSel('f-start-pin',      'in',  c.start_pin);
  refreshPinSel('f-i2c-sda',        'i2c-sda', (cfg.i2c||{}).sda_pin);
  refreshPinSel('f-i2c-scl',        'i2c-scl', (cfg.i2c||{}).scl_pin);
  refreshPinSel('f-spi-sck',         'spi-clk', (cfg.spi||{}).sck_pin);
  refreshPinSel('f-spi-miso',        'spi-miso', (cfg.spi||{}).miso_pin);
  refreshPinSel('f-spi-mosi',        'spi-mosi', (cfg.spi||{}).mosi_pin ?? -1);
  refreshPinSel('f-n1-pin',         'in',  (s.n1_rpm||{}).pin);
  refreshPinSel('f-n2-pin',         'in',  (s.n2_rpm||{}).pin);
  refreshPinSel('f-tot-clk',        'spi-clk', (s.tot||{}).clk);
  refreshPinSel('f-tot-cs',         'out', (s.tot||{}).cs);
  refreshPinSel('f-tot-miso',       'spi-miso',  (s.tot||{}).miso);
  refreshPinSel('f-tot-mosi',       'spi-mosi', (s.tot||{}).mosi);
  refreshPinSel('f-tit-clk',        'spi-clk', (s.tit||{}).clk);
  refreshPinSel('f-tit-cs',         'out', (s.tit||{}).cs);
  refreshPinSel('f-tit-miso',       'spi-miso',  (s.tit||{}).miso);
  refreshPinSel('f-tit-mosi',       'spi-mosi', (s.tit||{}).mosi);
  refreshPinSel('f-oilpress-pin',   'adc', (s.oil_press||{}).pin);
  refreshPinSel('f-flame-pin',      'adc', (s.flame||{}).pin);
  refreshPinSel('f-thinput-pin',    (s.throttle_input||{}).rc_pwm ? 'in' : 'adc', (s.throttle_input||{}).pin);
  refreshPinSel('f-idiinput-pin',   (s.idle_input||{}).rc_pwm ? 'in' : 'adc', (s.idle_input||{}).pin);
  const ffType = (s.fuel_flow||{}).type || 0;
  v('f-fuelflow-type', ffType);
  v('f-fuelflow-ppl',  (s.fuel_flow||{}).pulses_per_litre || 100);
  refreshPinSel('f-fuelflow-pin', ffType === 1 ? 'any' : 'adc', (s.fuel_flow||{}).pin);
  updateFuelFlowTypeUI();
  refreshPinSel('f-p1-pin',         'adc', (s.p1||{}).pin);
  refreshPinSel('f-p2-pin',         'adc', (s.p2||{}).pin);
  refreshPinSel('f-thr-pin',        'out', (a.throttle||{}).pin);
  refreshPinSel('f-str-pin',        'out', (a.starter||{}).pin);
  refreshPinSel('f-op-pin',         'out', (a.oil_pump||{}).pin);
  refreshPinSel('f-oscav-pin',      'out', (a.oil_scavenge_pump||{}).pin);
  refreshPinSel('f-fsol-pin',       'out', (a.fuel_sol||{}).pin);
  refreshPinSel('f-ign-pin',        'out', (a.igniter||{}).pin);
  refreshPinSel('f-ign2-pin',       'out', (a.igniter2||{}).pin);
  refreshPinSel('f-wetglow-pin',    'out', (a.glow_plug||{}).fuel_pin);
  refreshPinSel('f-sen-pin',        'out', (a.starter_en||{}).pin);
  refreshPinSel('f-abs-pin',        'out', (a.ab_sol||{}).pin);
  refreshPinSel('f-abp-pin',        'out', (a.ab_pump||{}).pin);
  refreshPinSel('f-airs-pin',       'out', (a.airstarter_sol||{}).pin);
  refreshPinSel('f-fan-pin',        'out', (a.cool_fan||{}).pin);
  refreshPinSel('f-led-pin',        'status-led', (a.status_led||{}).pin);
  refreshPinSel('f-buzzer-pin',     'out', (cfg.buzzer||{}).pin);
  refreshPinSel('f-cl-tx',          'out', cl.tx_pin);
  refreshPinSel('f-cl-rx',          'in',  cl.rx_pin);
  refreshPinSel('f-ab-sw-pin',      'in',  abt.switch_pin);
  refreshPinSel('f-ab-inp-pin',     abt.input_rc_pwm ? 'in' : 'adc', abt.input_pin);
  refreshPinSel('f-ab-arm-pin',     'in',  abt.arm_pin);
  refreshPinSel('f-ab-fl-pin',      'adc', abfl.pin);

  // New sensors
  const ot = s.oil_temp || {};
  refreshPinSel('f-oiltemp-pin',    'adc', ot.pin);   // NTC (ADC)
  refreshPinSel('f-oiltemp-ow-pin', 'any', ot.pin);   // DS18B20 (any GPIO)
  refreshPinSel('f-oiltemp-clk',    'spi-clk', ot.clk ?? ot.pin);
  refreshPinSel('f-oiltemp-cs',     'out', ot.cs);
  refreshPinSel('f-oiltemp-miso',   'spi-miso',  ot.miso);
  refreshPinSel('f-oiltemp-mosi',   'spi-mosi', ot.mosi);
  refreshPinSel('f-battvolt-pin', 'adc', (s.batt_voltage||{}).pin);
  refreshPinSel('f-torque-pin',   'adc', (s.torque||{}).pin);
  refreshPinSel('f-torque-dt',    'in',  (s.torque||{}).dt_pin);
  refreshPinSel('f-torque-clk',   'out', (s.torque||{}).clk_pin);
  refreshPinSel('f-fuelpress-pin','adc', (s.fuel_press||{}).pin);
  refreshPinSel('f-ign2cur-pin',  'adc', (a.igniter2||{}).current_pin);
  // New actuators
  refreshPinSel('f-fp2-pin',   'out', (a.fuel_pump2||{}).pin);
  refreshPinSel('f-bleed-pin', 'out', (a.bleed_valve||{}).pin);
  refreshPinSel('f-pp-pin',    'out', (a.prop_pitch||{}).pin);
  refreshPinSel('f-glow-pin',    'out', (a.glow_plug||{}).pin);
  refreshPinSel('f-mav-tx',      'out', (cfg.mavlink||{}).tx_pin);
  // Current sensor pin selectors — glow/igniter stored inside their actuator objects
  refreshPinSel('f-glowcur-pin',      'adc', (a.glow_plug||{}).current_pin);
  refreshPinSel('f-igncur-pin',       'adc', (a.igniter||{}).current_pin);
  refreshPinSel('f-oilpumpcur-pin',   'adc', (a.oil_pump||{}).current_pin);
  // DI channel pin selectors (dynamically rendered)
  (cfg.di_channels || []).forEach((ch, i) => {
    refreshPinSel('f-di' + i + '-pin', 'in', ch.pin);
  });
  checkPinConflicts();
  renderHardwareWorkflowSummaries();
}

// ─── General-purpose DI channel renderer ────────────────────
function updateStatusLedTypeUI() {
  const sel = document.getElementById('f-led-type');
  if (!sel) return;
  if (!cfg.actuators) cfg.actuators = {};
  if (!cfg.actuators.status_led) cfg.actuators.status_led = {};
  if (cfg.actuators.status_led.mode === undefined) cfg.actuators.status_led.mode = 0;
  if (cfg.actuators.status_led.standby_color === undefined) cfg.actuators.status_led.standby_color = 0x00FF40;
  if (cfg.actuators.status_led.startup_color === undefined) cfg.actuators.status_led.startup_color = 0x0060FF;
  if (cfg.actuators.status_led.running_color === undefined) cfg.actuators.status_led.running_color = 0x00FF00;
  if (cfg.actuators.status_led.shutdown_color === undefined) cfg.actuators.status_led.shutdown_color = 0xFF8000;
  if (cfg.actuators.status_led.blink_color === undefined) cfg.actuators.status_led.blink_color = 0x0000FF;
  if (cfg.platform === 'esp32s3' && cfg.actuators.status_led.type === 1 &&
      (cfg.actuators.status_led.pin === undefined || cfg.actuators.status_led.pin === null ||
       cfg.actuators.status_led.pin < 0 || cfg.actuators.status_led.pin === 38)) {
    cfg.actuators.status_led.pin = 48;
  }
  sel.value = String(cfg.actuators.status_led.type ?? 0);
  const isNeo = cfg.actuators.status_led.type === 1;
  const isColor = isNeo && cfg.actuators.status_led.mode === 1;
  const modeGrp = document.getElementById('grp-led-mode');
  const colorGrp = document.getElementById('grp-led-colors');
  const blinkGrp = document.getElementById('grp-led-blink');
  if (modeGrp) modeGrp.style.display = isNeo ? '' : 'none';
  if (colorGrp) colorGrp.style.display = isColor ? '' : 'none';
  if (blinkGrp) blinkGrp.style.display = (isNeo && !isColor) ? '' : 'none';
  v('f-led-mode', cfg.actuators.status_led.mode ?? 0);
  v('f-led-color-blink', colorToHex(cfg.actuators.status_led.blink_color, '#0000ff'));
  v('f-led-color-standby', colorToHex(cfg.actuators.status_led.standby_color, '#00ff40'));
  v('f-led-color-startup', colorToHex(cfg.actuators.status_led.startup_color, '#0060ff'));
  v('f-led-color-running', colorToHex(cfg.actuators.status_led.running_color, '#00ff00'));
  v('f-led-color-shutdown', colorToHex(cfg.actuators.status_led.shutdown_color, '#ff8000'));
}

function colorToHex(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0');
}

function hexToColor(value, fallback = 0) {
  const s = String(value || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return fallback;
  return parseInt(s.slice(1), 16);
}

const DI_ROLES = [
  { val:'none',           lbl:'None (display only)' },
  { val:'fault',          lbl:'Fault — trigger engine fault shutdown' },
  { val:'estop',          lbl:'E-Stop — immediate engine stop' },
  { val:'inhibit_start',  lbl:'Inhibit Start — block START command' },
  { val:'sequence_gate',  lbl:'Sequence Gate — WaitForInput block' },
  { val:'ab_arm',         lbl:'AB Arm — afterburner arm switch (hold active)' },
  { val:'ab_fire',        lbl:'AB Fire — trigger afterburner ignition (rising edge)' },
  { val:'limp_mode',      lbl:'Reduced-Power Mode — apply the shared main-fuel cap while the switch is active' },
];
const DI_MODES = [
  { bit:1,  lbl:'STANDBY' },
  { bit:2,  lbl:'STARTUP' },
  { bit:4,  lbl:'RUNNING' },
  { bit:8,  lbl:'SHUTDOWN' },
  // Stored configs can carry bit 0x10 (FAULT); hiding it let invisible mode
  // masks affect runtime behaviour without being visible or editable.
  { bit:16, lbl:'FAULT' },
];
// Roles whose runtime handler checks the active_modes mask.
const DI_MODE_ROLES = ['fault', 'estop', 'ab_arm', 'ab_fire', 'limp_mode'];

// Local copy of the shared app.js escapeHtmlText(): this page intentionally
// does not load app.js (it runs its own telemetry), so it cannot share it.
function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Wet-glow pilot-fuel subfields are mode-specific, like the other actuator
// cards: relay mode shows polarity; PWM shows freq/bits + duty range;
// servo/ESC shows pulse endpoints; demand applies to PWM and servo.
function updateWetGlowModeUI() {
  const mode = Number(cfg?.actuators?.glow_plug?.fuel_type ?? 0);
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('wg-relay-field',     mode === 0);
  show('wg-demand-field',    mode !== 0);
  show('wg-servo-field',     mode === 2);
  show('wg-pwm-freq-field',  mode === 1);
  show('wg-pwm-range-field', mode === 1);
  const pwmAdvanced = document.getElementById('wg-pwm-freq-field')?.closest('details.source-pwm-advanced');
  if (pwmAdvanced) {
    pwmAdvanced.style.display = mode === 1 ? '' : 'none';
    if (mode !== 1) pwmAdvanced.open = false;
  }
}
function updateGlowOutputModeUI() {
  const mode = Number(cfg?.actuators?.glow_plug?.output_type ?? 0);
  setOptionalGroupVisible('grp-glow-pwm', mode === 0);
  setOptionalGroupVisible('grp-glow-relay', mode === 1);
}

function renderDiChannels(channels) {
  const wrap = document.getElementById('di-channels-wrap');
  if (!wrap) return;
  let html = '';
  for (let i = 0; i < 4; i++) {
    const ch = channels[i] || {};
    const role = ch.role || 'none';
    const modes = ch.active_modes !== undefined ? ch.active_modes : 0xFF;
    const roleOpts = DI_ROLES.map(r =>
      `<option value="${r.val}"${role===r.val?' selected':''}>${r.lbl}</option>`).join('');
    const modeChks = DI_MODES.map(m =>
      `<label style="font-size:.72rem;display:flex;align-items:center;gap:.3rem;cursor:pointer">
        <input type="checkbox" ${(modes & m.bit) ? 'checked' : ''}
          onchange="setDiModeBit(${i},${m.bit},this.checked)"> ${m.lbl}
      </label>`).join('');
    html += `
    <div class="hw-item-card" id="di-card-${i}">
      <div style="font-size:.8rem;font-weight:700;margin-bottom:.5rem;display:flex;align-items:center;gap:.6rem">
        DI-${i+1}
        <span id="di-live-${i}" class="dot" title="Current state"></span>
        ${ch.label ? `<span style="font-size:.7rem;color:var(--accent)">${escapeHtmlText(ch.label)}</span>` : ''}
      </div>
      <div class="hw-grid">
        <div class="hw-field">
          <span class="hw-label">GPIO pin</span>
          <span class="hw-desc">Digital input pin. Leave at —None— to disable this channel.</span>
          <select id="f-di${i}-pin" onchange="setDiChannel(${i},'pin',+this.value)"></select>
        </div>
        <div class="hw-field">
          <span class="hw-label">Active polarity</span>
          <span class="hw-desc">Active LOW uses the internal pull-up. ⚠ Active HIGH leaves the pin floating — it REQUIRES an external pulldown resistor or a permanently driven signal, or noise will trigger it.</span>
          <select onchange="setDiChannel(${i},'active_h',this.value==='1')">
            <option value="0" ${!ch.active_h?'selected':''}>Active LOW (GND = active)</option>
            <option value="1" ${ch.active_h?'selected':''}>Active HIGH (3.3 V = active)</option>
          </select>
        </div>
        <div class="hw-field">
          <span class="hw-label">Debounce (ms)</span>
          <span class="hw-desc">Ignore glitches shorter than this. Typical: 20 ms.</span>
          <input type="number" min="5" max="500" value="${ch.debounce_ms||20}"
            oninput="setDiChannel(${i},'debounce_ms',+this.value)">
        </div>
        <div class="hw-field">
          <span class="hw-label">Display label</span>
          <span class="hw-desc">Name shown in dashboard (e.g. "Fuel Shutoff Valve", "Oil Pressure Switch").</span>
          <input type="text" maxlength="31" placeholder="DI-${i+1}" value="${escapeHtmlText(ch.label || '')}"
            oninput="setDiChannel(${i},'label',this.value); rerenderDiLabel(${i},this.value)">
        </div>
        <div class="hw-field">
          <span class="hw-label">Role</span>
          <span class="hw-desc">What happens when this input becomes active.</span>
          <select id="f-di${i}-role" onchange="setDiChannel(${i},'role',this.value); updateDiRoleUI(${i},this.value)">
            ${roleOpts}
          </select>
        </div>
        <div id="di${i}-fault-fields" style="display:${role==='fault'?'contents':'none'}">
          <div class="hw-field">
            <span class="hw-label">Fault code</span>
            <span class="hw-desc">Short code logged in the event recorder (e.g. LOW_OIL_PRESSURE, FUEL_SHUTOFF).</span>
            <input type="text" maxlength="23" placeholder="e.g. LOW_OIL_PRESS" value="${escapeHtmlText(ch.fault_code || '')}"
              oninput="setDiChannel(${i},'fault_code',this.value)">
          </div>
          <div class="hw-field">
            <span class="hw-label">Fault message</span>
            <span class="hw-desc">Human-readable description shown in the fault log.</span>
            <input type="text" maxlength="63" placeholder="e.g. Oil pressure switch opened" value="${escapeHtmlText(ch.fault_msg || '')}"
              oninput="setDiChannel(${i},'fault_msg',this.value)">
          </div>
        </div>
        <div id="di${i}-modes-field" style="display:${DI_MODE_ROLES.includes(role)?'contents':'none'}">
          <div class="hw-field">
            <span class="hw-label">Active in modes</span>
            <span class="hw-desc">Role acts only in the checked modes. Note: Fault/E-Stop always ignore STANDBY, SHUTDOWN and FAULT (so noise can't block starts), and act on the input LEVEL in STARTUP/RUNNING — a held-active input trips immediately.</span>
            <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-top:.3rem">${modeChks}</div>
          </div>
        </div>
      </div>
    </div>`;
  }
  wrap.innerHTML = html;
  refreshAllPins();
}

function rerenderDiLabel(idx, val) {
  const span = document.querySelector(`#di-card-${idx} span[style*="accent"]`);
  if (span) span.textContent = val;
}

function updateDiRoleUI(idx, role) {
  const ff = document.getElementById('di' + idx + '-fault-fields');
  if (ff) ff.style.display = (role === 'fault') ? 'contents' : 'none';
  // Mode mask is used by every mode-gated role, not just fault — hiding it
  // let stored masks affect runtime invisibly.
  const mf = document.getElementById('di' + idx + '-modes-field');
  if (mf) mf.style.display = DI_MODE_ROLES.includes(role) ? 'contents' : 'none';
}

function setDiModeBit(idx, bit, checked) {
  if (!cfg.di_channels) cfg.di_channels = [{},{},{},{}];
  while (cfg.di_channels.length < 4) cfg.di_channels.push({});
  const cur = cfg.di_channels[idx].active_modes !== undefined
              ? cfg.di_channels[idx].active_modes : 0xFF;
  cfg.di_channels[idx].active_modes = checked ? (cur | bit) : (cur & ~bit);
  dirty();
}
