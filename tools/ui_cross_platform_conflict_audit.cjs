const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 9800 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;

function installedBrowser() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

async function reset(page) {
  const response = await page.request.post(`${base}/__sim/reset`);
  assert.equal(response.ok(), true);
}

async function patchHardware(page, patch) {
  const response = await page.request.patch(`${base}/api/hardware`, { data: patch });
  assert.equal(response.ok(), true);
}

async function gotoHardware(page) {
  await page.goto(`${base}/hardware.html`);
  await page.waitForSelector('#hardware-profile-section', { state: 'attached' });
}

async function hasOption(page, selector, value) {
  return page.locator(`${selector} option[value="${value}"]`).count();
}

(async () => {
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  const executablePath = installedBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  page.on('pageerror', error => { throw error; });

  const results = [];
  try {
    await reset(page);
    await patchHardware(page, { platform: 'esp32' });
    await gotoHardware(page);
    const esp32Pins = await page.evaluate(() => ({
      out34: buildPinOptions(-1, 'out').includes('value="34"'),
      out6: buildPinOptions(-1, 'out').includes('value="6"'),
      adc34: buildPinOptions(-1, 'adc').includes('value="34"'),
      adc25: buildPinOptions(-1, 'adc').includes('value="25"')
    }));
    assert.deepEqual(esp32Pins, {out34:false, out6:false, adc34:true, adc25:false});
    results.push('ESP32 pin selectors match firmware GPIO, output and ADC limits');

    await reset(page);
    await patchHardware(page, { platform: 'esp32s3' });
    await gotoHardware(page);
    const s3Pins = await page.evaluate(() => ({
      out46: buildPinOptions(-1, 'out').includes('value="46"'),
      out22: buildPinOptions(-1, 'out').includes('value="22"'),
      adc10: buildPinOptions(-1, 'adc').includes('value="10"'),
      adc11: buildPinOptions(-1, 'adc').includes('value="11"')
    }));
    assert.deepEqual(s3Pins, {out46:false, out22:false, adc10:true, adc11:false});
    results.push('ESP32-S3 pin selectors match firmware GPIO, output and ADC limits');

    const conflictMatrix = await page.evaluate(() => {
      cfg.platform = 'esp32s3';
      cfg.controls = { stop_pin: 33, start_pin: 34 };
      for (const item of Object.values(cfg.sensors || {})) item.enabled = false;
      for (const item of Object.values(cfg.actuators || {})) {
        item.enabled = false;
        item.has_current = false;
      }
      cfg.channel_registry = {version:1, bindings:[], inputs:[], outputs:[]};
      cfg.has_afterburner = false;
      cfg.di_channels = [];
      cfg.actuators.status_led = { enabled: true, pin: 4 };
      cfg.mavlink = { enabled: true, tx_pin: 4, baud: 115200, interval_ms: 200 };
      cfg.cluster_serial = { enabled: true, tx_pin: 5, rx_pin: -1, baud: 115200, interval_ms: 100 };
      const optionState = (html, value) => {
        const select = document.createElement('select');
        select.innerHTML = html;
        const option = select.querySelector(`option[value="${value}"]`);
        return option ? { exists: true, disabled: option.disabled, text: option.textContent } : { exists: false, disabled: null, text: '' };
      };
      const usedOutputPin = optionState(buildPinOptions(-1, 'out'), 4);
      const statusLedMav = _checkGpioConflicts().some(c =>
        c.pin === 4 && c.names.includes('Status LED') && c.names.includes('MAVLink TX'));

      cfg.mavlink.enabled = false;
      cfg.channel_registry.inputs = [
        {installed:true,id:'tot_main',name:'TOT',purpose:'tot',role:'temperature',driver:1,pin:-1,temp_interface:3,spi_clk:40,spi_cs:37,spi_miso:41,spi_mosi:42},
        {installed:true,id:'tit_main',name:'TIT',purpose:'tit',role:'temperature',driver:1,pin:-1,temp_interface:3,spi_clk:40,spi_cs:38,spi_miso:41,spi_mosi:42},
        {installed:true,id:'oil_temp',name:'Oil Temp',purpose:'oil_temperature',role:'temperature',driver:1,pin:-1,temp_interface:3,spi_clk:40,spi_cs:39,spi_miso:41,spi_mosi:42}
      ];
      const sharedSpiBusOk = !_checkGpioConflicts().some(c => [40, 41, 42].includes(c.pin));
      const spiClkAsSpi = optionState(buildPinOptions(-1, 'spi-clk'), 40);
      const spiClkAsOrdinaryOutput = optionState(buildPinOptions(-1, 'out'), 40);

      cfg.channel_registry.inputs.find(c => c.purpose === 'tit').spi_cs = 37;
      const sharedCsBlocked = _checkGpioConflicts().some(c =>
        c.pin === 37 && c.names.includes('TOT CS') && c.names.includes('TIT CS'));

      cfg.channel_registry.inputs.find(c => c.purpose === 'tit').spi_cs = 16;
      cfg.cluster_serial.tx_pin = 4;
      cfg.actuators.status_led.enabled = false;
      const released = _releaseInactivePinConflicts();
      const statusLedReleased = cfg.actuators.status_led.pin === -1 && released;

      cfg.channel_registry = {version:1, bindings:[], outputs:[], inputs:[
        {installed:true,id:'oil_pressure_main',name:'Oil Pressure',purpose:'oil_pressure',role:'pressure',driver:1,pin:10},
        {installed:true,id:'ab_flame_main',name:'AB Flame',purpose:'ab_flame',role:'flame',driver:1,pin:10}
      ]};
      cfg.ab_flame = {enabled:false,pin:-1};
      const registryOnlyConflict = _checkGpioConflicts().some(c =>
        c.pin === 10 && c.names.includes('Oil Pressure') && c.names.includes('AB Flame'));

      return { statusLedMav, sharedSpiBusOk, sharedCsBlocked, statusLedReleased, registryOnlyConflict, usedOutputPin, spiClkAsSpi, spiClkAsOrdinaryOutput };
    });
    assert.deepEqual({
      statusLedMav: conflictMatrix.statusLedMav,
      sharedSpiBusOk: conflictMatrix.sharedSpiBusOk,
      sharedCsBlocked: conflictMatrix.sharedCsBlocked,
      statusLedReleased: conflictMatrix.statusLedReleased,
      registryOnlyConflict: conflictMatrix.registryOnlyConflict
    }, {
      statusLedMav: true,
      sharedSpiBusOk: true,
      sharedCsBlocked: true,
      statusLedReleased: true,
      registryOnlyConflict: true
    });
    assert.equal(conflictMatrix.usedOutputPin.disabled, true, 'ordinary used output pin must be disabled in selectors');
    assert.match(conflictMatrix.usedOutputPin.text, /used by Status LED/i);
    assert.equal(conflictMatrix.spiClkAsSpi.disabled, false, 'SPI CLK pin must remain selectable by another SPI CLK field');
    assert.match(conflictMatrix.spiClkAsSpi.text, /shared SPI CLK/i);
    assert.equal(conflictMatrix.spiClkAsOrdinaryOutput.disabled, true, 'SPI CLK pin must not be selectable by an unrelated output');
    results.push('hardware conflict logic covers status LED, serial pins, SPI bus sharing and hidden inactive pins');

    const txOnlyCluster = await page.evaluate(() => {
      cfg.cluster_serial = { enabled: true, tx_pin: 5, rx_pin: -1, baud: 115200, interval_ms: 100 };
      return _checkGpioConflicts().some(c => c.names.some(n => n.startsWith('Cluster Serial')));
    });
    assert.equal(txOnlyCluster, false, 'TX-only cluster mode must not create a false RX conflict');
    results.push('TX-only cluster mode remains conflict-free with RX disabled');

    console.log(`Cross-platform conflict audit passed (${results.length} groups):`);
    for (const result of results) console.log(`- ${result}`);
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
