const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 11920 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const routes = [
  'index.html', 'hardware.html', 'config.html', 'calibration.html',
  'sequence.html', 'log.html', 'tools.html'
];

function installedBrowser() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function input(id, name, purpose, role, driver, pin, extra = {}) {
  return {installed:true, id, name, purpose, role, driver, pin, min:0, max:1, ...extra};
}

function output(id, name, purpose, role, driver, pin, extra = {}) {
  return {installed:true, id, name, purpose, role, driver, pin, min:0, max:1, safe_demand:0, ...extra};
}

function makeRegistry(random) {
  const inputs = [];
  const outputs = [];
  const bindings = [];
  const add = (chance, item, list = inputs) => { if (random() < chance) list.push(item); };

  add(.72, input('n1_main','N1 Speed','n1_speed','speed',2,34,{pulses_per_unit:1}));
  add(.48, input('n2_main','N2 Speed','n2_speed','speed',2,35,{pulses_per_unit:1}));
  add(.68, input('tot_main','Main TOT','tot','temperature',1,-1,
    {temp_interface:2,spi_clk:18,spi_cs:5,spi_miso:19}));
  add(.31, input('tit_main','Main TIT','tit','temperature',1,-1,
    {temp_interface:1,spi_clk:18,spi_cs:17,spi_miso:19}));
  add(.58, input('oil_pressure_main','Oil Pressure','oil_pressure','pressure',1,36,
    {analog_zero_mv:500,analog_mv_per_unit:500}));
  add(.35, input('p1_main','Compressor P1','p1_pressure','pressure',9,-1,
    {i2c_address:16,device_channel:0,analog_zero_mv:500,analog_mv_per_unit:1000}));
  add(.35, input('p2_main','Compressor P2','p2_pressure','pressure',9,-1,
    {i2c_address:16,device_channel:1,analog_zero_mv:500,analog_mv_per_unit:1000}));
  add(.30, input('torque_main','Shaft Torque','torque','torque',10,-1,
    {i2c_address:42,device_channel:0,load_cell_gain:128,load_cell_rate:80,lever_arm_m:.12}));
  add(.24, input('thrust_main','Engine Thrust','thrust','thrust',10,-1,
    {i2c_address:42,device_channel:1,load_cell_gain:128,load_cell_rate:80}));
  add(.42, input('fuel_flow_main','Fuel Flow','fuel_flow','flow',2,25,{pulses_per_unit:900}));
  add(.38, input('oil_flow_main','Oil Flow','oil_flow','flow',9,-1,
    {i2c_address:16,device_channel:2,analog_zero_mv:500,analog_mv_per_unit:1000}));
  add(.42, input('flame_main','Flame Sensor','flame','flame',8,-1,
    {i2c_address:32,device_channel:0,active_high:true}));
  add(.52, input('operator_throttle','Throttle Input','throttle','operator',1,32,{min:0,max:4095}));
  add(.34, input('operator_idle','Idle Input','idle','operator',3,33,{min:1000,max:2000}));

  add(.86, output('main_fuel','Main Fuel Pump','main_fuel','fuel',5,21,{pwm_freq_hz:5000,pwm_res_bits:10}), outputs);
  add(.62, output('starter_main','Starter','starter','starter',6,22,{min:1000,max:2000}), outputs);
  add(.62, output('igniter','Igniter','igniter','igniter',4,23), outputs);
  add(.45, output('main_fuel_shutoff','Fuel Shutoff','fuel_shutoff','fuel_shutoff',4,13), outputs);
  add(.58, output('oil_pump_main','Oil Pump','oil_pump','oil_pump',5,14,
    {pwm_freq_hz:5000,pwm_res_bits:10,has_flow_monitor:random()<.5,minimum_flow_l_min:.3}), outputs);
  add(.30, output('prop_pitch','Prop Pitch','prop_pitch','prop_pitch',6,26,{min:1000,max:2000}), outputs);
  add(.30, output('scavenge_pump','Scavenge Pump','scavenge_pump','scavenge_pump',5,27,
    {pwm_freq_hz:5000,pwm_res_bits:10,has_flow_monitor:true,minimum_flow_l_min:.2}), outputs);
  add(.38, output('drain_valve','Drain Valve','drain_valve','valve',11,-1,
    {i2c_address:32,device_channel:7,inverted:random()<.5}), outputs);
  add(.28, output('ab_pump','AB Fuel Pump','ab_pump','ab_pump',5,4,{pwm_freq_hz:5000,pwm_res_bits:10}), outputs);
  add(.28, output('ab_igniter','AB Igniter','ab_igniter','ab_igniter',4,2), outputs);
  add(.25, output('utility_servo','Utility Servo','generic','generic',6,15,{min:1000,max:2000}), outputs);

  const byPurpose = (list, purpose) => list.find(channel => channel.purpose === purpose);
  if (byPurpose(inputs,'n1_speed')) bindings.push({key:'primary_n1',channel:'n1_main'});
  if (byPurpose(inputs,'n2_speed')) bindings.push({key:'primary_n2',channel:'n2_main'});
  if (byPurpose(inputs,'tot')) bindings.push({key:'primary_egt',channel:'tot_main'});
  else if (byPurpose(inputs,'tit')) bindings.push({key:'primary_egt',channel:'tit_main'});
  if (byPurpose(outputs,'main_fuel')) bindings.push({key:'main_fuel_output',channel:'main_fuel'});
  if (byPurpose(outputs,'fuel_shutoff')) bindings.push({key:'main_fuel_shutoff',channel:'main_fuel_shutoff'});
  if (byPurpose(outputs,'starter')) bindings.push({key:'main_starter',channel:'starter_main'});
  return {version:2,input_capacity:24,output_capacity:16,inputs,outputs,bindings};
}

function selected(registry, direction, purpose) {
  return registry[direction].some(channel => channel.purpose === purpose);
}

(async () => {
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  const executablePath = installedBrowser();
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const badResponses = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon|Failed to load resource/i.test(message.text()))
      consoleErrors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() >= 400 && !/favicon/.test(response.url()))
      badResponses.push(`${response.status()} ${response.url()}`);
  });

  try {
    for (let seed = 1; seed <= 24; seed++) {
      const random = rng(seed * 0x9E3779B1);
      await page.request.post(`${base}/__sim/blank`);
      const state = await (await page.request.get(`${base}/__sim/state`)).json();
      const registry = makeRegistry(random);
      const hardware = state.hardware;
      hardware.profile_id = `fuzz-${seed}`;
      hardware.profile_desc = `Deterministic mixed-I/O fuzz profile ${seed}`;
      hardware.channel_registry = registry;
      hardware.i2c = {
        enabled: registry.inputs.some(c => c.driver >= 8 && c.driver <= 10) || registry.outputs.some(c => c.driver === 11),
        sda_pin:16, scl_pin:17, interrupt_pin:-1, frequency_hz:random()<.25 ? 100000 : 400000
      };
      hardware.spi = {
        enabled: registry.inputs.some(c => Number(c.temp_interface) >= 1 && Number(c.temp_interface) <= 3),
        sck_pin:18, miso_pin:19, mosi_pin:-1
      };
      hardware.controllers = {
        oil_loop: random()<.65,
        dynamic_idle: random()<.55,
        governor: random()<.55
      };
      hardware.safety = {
        overspeed:random()<.8,n2_overspeed:random()<.6,overtemp:random()<.8,
        low_oil:random()<.7,oil_zero:random()<.55,flameout:random()<.6,hot_start:random()<.7,
        oil_temp_high:random()<.4,fuel_press_low:random()<.4,batt_low:random()<.4,surge:random()<.5
      };
      hardware.sensors = {
        n1_rpm:{enabled:selected(registry,'inputs','n1_speed')},
        n2_rpm:{enabled:selected(registry,'inputs','n2_speed')},
        tot:{enabled:selected(registry,'inputs','tot')},
        tit:{enabled:selected(registry,'inputs','tit')},
        oil_press:{enabled:selected(registry,'inputs','oil_pressure')},
        p1:{enabled:selected(registry,'inputs','p1_pressure')},
        p2:{enabled:selected(registry,'inputs','p2_pressure')},
        torque:{enabled:selected(registry,'inputs','torque')},
        fuel_flow:{enabled:selected(registry,'inputs','fuel_flow')}
      };
      hardware.actuators = {
        throttle:{enabled:selected(registry,'outputs','main_fuel')},
        starter:{enabled:selected(registry,'outputs','starter')},
        igniter:{enabled:selected(registry,'outputs','igniter')},
        fuel_sol:{enabled:selected(registry,'outputs','fuel_shutoff')},
        oil_pump:{enabled:selected(registry,'outputs','oil_pump')},
        prop_pitch:{enabled:selected(registry,'outputs','prop_pitch')},
        oil_scavenge_pump:{enabled:selected(registry,'outputs','scavenge_pump')}
      };
      const settings = state.settings;
      settings.profile_id = hardware.profile_id;
      settings.relight.enabled = random()<.45;
      settings.safety.shutdown_on_underflow = random()<.5;
      settings.throttle.pullback_n1_mode = random()<.5 ? 0 : 1;
      settings.throttle.pullback_n2_mode = random()<.5 ? 0 : 1;
      settings.throttle.pullback_egt_mode = random()<.5 ? 0 : 1;
      const save = await page.request.post(`${base}/api/ecu_config`, {data:{hardware,settings}});
      assert.equal(save.ok(), true, `seed ${seed} profile save`);
      await page.request.post(`${base}/__sim/data`, {data:{
        mode:['STANDBY','STARTUP','RUNNING','SHUTDOWN','FAULT'][seed%5],
        config_locked:false, config_storage_fault:false
      }});

      await page.setViewportSize(seed % 3 === 0 ? {width:390,height:844} : {width:1440,height:960});
      for (const route of routes) {
        await page.goto(`${base}/${route}#fuzz-${seed}`, {waitUntil:'domcontentloaded'});
        await page.waitForTimeout(80);
        const audit = await page.evaluate(() => {
          const visibleText = document.body?.innerText || '';
          const ids = Array.from(document.querySelectorAll('[id]')).map(element => element.id).filter(Boolean);
          const seen = new Set();
          const duplicates = ids.filter(id => seen.has(id) || !seen.add(id));
          const visibleBroken = Array.from(document.querySelectorAll('button,input,select')).filter(element => {
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) return false;
            const rect = element.getBoundingClientRect();
            return rect.width < 8 || rect.height < 8;
          }).map(element => element.id || element.textContent?.trim() || element.tagName);
          return {
            duplicates:[...new Set(duplicates)],
            visibleBroken,
            badText:(visibleText.match(/\b(?:undefined|NaN|Infinity)\b|\[object Object\]/i) || [])[0] || '',
            hasBody:visibleText.trim().length > 20
          };
        });
        assert.equal(audit.hasBody, true, `seed ${seed} ${route} blank body`);
        assert.deepEqual(audit.duplicates, [], `seed ${seed} ${route} duplicate ids`);
        assert.deepEqual(audit.visibleBroken, [], `seed ${seed} ${route} collapsed visible control`);
        assert.equal(audit.badText, '', `seed ${seed} ${route} leaked ${audit.badText}`);
      }
    }
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(' | ')}`);
    assert.deepEqual(badResponses, [], `bad responses: ${badResponses.join(' | ')}`);
    console.log(`Configuration fuzz audit passed: 24 mixed hardware profiles × ${routes.length} pages.`);
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
