const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const port = 11600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;

async function post(page, path, body) {
  const response = await page.request.post(base + path, {data:body});
  assert.equal(response.ok(), true, `${path} failed`);
}
function installedBrowser() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES,'Google','Chrome','Application','chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'],'Microsoft','Edge','Application','msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Google','Chrome','Application','chrome.exe')
  ].filter(Boolean);
  return candidates.find(candidate=>fs.existsSync(candidate));
}

(async () => {
  const official = JSON.parse(fs.readFileSync(path.join(__dirname,'..','pcb_profiles','official','openturbine-ecu-s3-v1.otpcb.json'),'utf8'));
  assert.equal(official.board.id, 'openturbine-ecu-s3-v1');
  assert.equal(official.target.chip, 'esp32-s3');
  assert.equal(official.fixed_functions.servo_output_enable.gpio, 17);
  assert.equal(official.fixed_functions.servo_output_enable.active_high, false);
  assert.equal(official.fixed_functions.supply_voltage.gpio, 10);
  assert.equal(official.ports.length, 36);
  const officialPorts = new Map(official.ports.map(port=>[port.id,port]));
  for (let n=1;n<=8;n++) {
    const adc = officialPorts.get(`adc_${n}`);
    assert.equal(adc.modes.find(mode=>mode.id==='analog').channel, n-1);
    assert.equal(adc.modes.find(mode=>mode.id==='digital').adapter, 'i2c_adc_digital_input');
    assert.equal(adc.modes.find(mode=>mode.id==='digital').reference_mv, 5000);
  }
  for (let n=1;n<=4;n++) {
    assert.equal(officialPorts.get(`switch_input_${n}`).modes[0].channel, n-1);
    assert.equal(officialPorts.get(`low_output_${n}`).modes[0].channel, n+3);
  }
  assert.deepEqual([1,2,3,4,5,6,7,8].map(n=>officialPorts.get(`power_output_${n}`).modes[0].endpoint.gpio),
    [37,38,41,42,2,1,39,40]);

  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  const executablePath = installedBrowser();
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  try {
    const hardware = await (await page.request.get(`${base}/api/hardware`)).json();
    hardware.channel_registry = {version:2,input_capacity:24,output_capacity:16,inputs:[
      {id:'battery_voltage',name:'Supply voltage',purpose:'battery_voltage',role:'voltage',
       driver:1,pin:10,min:0,max:4095,analog_divider:18.6470588}
    ],outputs:[],bindings:[]};
    hardware._pcb_profile = {
      state:'valid', id:'test-s3-pcb', name:'Test S3 Turbine ECU', revision:'B',
      origin:'custom', target_chip:'esp32-s3', port_count:9,
      bus_ownership:{i2c:true,spi:true}, reserved_gpio:[4,5,8,9,10,11,12,13,17],
      fixed_functions:{
        status_led:{available:true,type:'neopixel'},
        supply_voltage:{available:true,label:'ECU supply voltage'},
        cluster_serial:{available:true,connection:'serial_0'},
        mavlink:{available:true,connection:'serial_0'}
      },
      ports:[
        {id:'thermo_1',label:'Thermocouple 1',connector:'J4',description:'First fitted MAX31856 input',modes:[{id:'temperature',adapter:'spi_thermocouple',device:'tc1',device_driver:'max31856'}]},
        {id:'thermo_2',label:'Thermocouple 2',connector:'J5',description:'Second fitted MAX6675 input',modes:[{id:'temperature',adapter:'spi_thermocouple',device:'tc2'}]},
        {id:'adc_1',label:'ADC 1',connector:'J8 pin 1',modes:[
          {id:'analog',adapter:'i2c_adc_input',device:'adc1',reference_mv:5000},
          {id:'digital',adapter:'i2c_adc_digital_input',device:'adc1',reference_mv:5000}]},
        {id:'servo_pulse_1',label:'Servo / pulse input 1',connector:'J7',modes:[
          {id:'servo',adapter:'rc_pwm_input'},{id:'frequency',adapter:'pcnt_input'},{id:'digital',adapter:'digital_input'}]},
        {id:'servo_pulse_2',label:'Servo / pulse input 2',connector:'J8',modes:[
          {id:'servo',adapter:'rc_pwm_input'},{id:'frequency',adapter:'pcnt_input'},{id:'digital',adapter:'digital_input'}]},
        {id:'speed_1',label:'High-speed pulse input 1',connector:'J10',modes:[{id:'speed',adapter:'pcnt_input'}]},
        {id:'switch_1',label:'Switch input 1',connector:'J6',modes:[{id:'digital',adapter:'digital_input'}]},
        {id:'servo_out_1',label:'Servo output 1',connector:'J11',modes:[{id:'servo',adapter:'servo_output'}]},
        {id:'power_out_4',label:'High-current output 4',connector:'J12',modes:[{id:'pwm',adapter:'pwm_output'},{id:'onoff',adapter:'relay_output'}]}
      ]
    };
    await post(page, '/api/hardware', hardware);

    await page.goto(`${base}/hardware.html`);
    await page.waitForFunction(() => /Test S3 Turbine ECU/.test(document.querySelector('#hardware-board-summary')?.textContent || ''));
    assert.match(await page.locator('#hardware-board-summary').textContent(), /revision B/i);
    assert.equal(await page.locator('#hardware-buses-panel').isVisible(), true);
    assert.equal(await page.locator('#hardware-buses-summary').isVisible(), true);
    assert.equal(await page.locator('#hardware-i2c-card').isVisible(), false);
    assert.equal(await page.locator('#hardware-spi-card').isVisible(), false);
    await page.locator('#btn-edit-buses').click();
    assert.equal(await page.locator('#en-i2c').isDisabled(), true);
    assert.equal(await page.locator('#en-spi').isDisabled(), true);
    assert.equal(await page.locator('#hardware-i2c-card').isVisible(), true);
    assert.equal(await page.locator('#hardware-spi-card').isVisible(), true);
    assert.match(await page.locator('#btn-edit-buses').textContent(), /Done editing/i);
    const additiveBusState = await page.evaluate(() => {
      pcbProfile.bus_ownership = {i2c:false, spi:false};
      pcbProfile.reserved_gpio = [8, 9, 10];
      cfg.i2c = {enabled:true, sda_pin:8, scl_pin:9, frequency_hz:400000};
      populate();
      return {
        i2cLocked: document.querySelector('#en-i2c').disabled,
        spiLocked: document.querySelector('#en-spi').disabled,
        reservedSdaDisabled: document.querySelector('#f-i2c-sda option[value="8"]')?.disabled ?? true,
        description: document.querySelector('#hardware-buses-panel > .hw-desc').textContent
      };
    });
    assert.deepEqual(additiveBusState, {
      i2cLocked:false, spiLocked:false, reservedSdaDisabled:true,
      description:'Buses defined by the flashed PCB profile are shown read-only and cannot be removed. You may add a missing shared bus using only GPIOs that the PCB leaves free.'
    }, 'PCB mode must permit absent buses while keeping profile-reserved GPIOs unavailable');
    assert.equal(await page.locator('#pcb-profile-identity').isVisible(), true);
    assert.equal(await page.locator('#hardware-cluster-source-panel').isVisible(), false);
    assert.equal(await page.locator('#hardware-mavlink-source-panel').isVisible(), false);
    const supplyCard = page.locator('#registry-inputs .registry-card').first();
    assert.match(await supplyCard.textContent(), /ECU supply voltage/);
    assert.match(await supplyCard.textContent(), /Built in/);
    assert.doesNotMatch(await supplyCard.textContent(), /Choose a compatible PCB connection/);
    await page.getByRole('button',{name:'Edit devices'}).click();
    assert.match(await page.locator('#hardware-comms-summary').textContent(), /Physical connection/);
    assert.equal(await page.locator('#hardware-comms-summary').getByText('Cluster TX GPIO',{exact:true}).count(), 0);
    await page.evaluate(async () => {
      await setProfileSerialEnabled('cluster_serial',true);
      await setProfileSerialEnabled('mavlink',true);
    });
    const serialState = await page.evaluate(() => ({
      cluster:cfg.cluster_serial.enabled, mavlink:cfg.mavlink.enabled
    }));
    assert.deepEqual(serialState,{cluster:false,mavlink:true},
      'one physical serial connector must not enable OT Cluster and MAVLink simultaneously');
    await page.locator('#btn-edit-comms').click();
    assert.match(await page.locator('#builtin-inputs').textContent(), /Switch wiring comes from this PCB profile/);
    assert.equal(await page.locator('#f-stop-pin').isVisible(), false);

    await page.getByRole('button',{name:'+ Add input'}).click();
    await page.getByRole('button',{name:/TOT \/ EGT/}).click();
    assert.match(await page.locator('#registry-add-title').textContent(), /Connect TOT/);
    await page.getByRole('button',{name:/Thermocouple 1/}).click();
    const totCard = page.locator('#registry-inputs .registry-card').nth(1);
    assert.match(await totCard.textContent(), /Thermocouple 1/);
    assert.equal(await totCard.getByText('Connected to',{exact:true}).count(), 1);
    assert.equal(await totCard.getByText('GPIO pin',{exact:true}).count(), 0);
    assert.equal(await totCard.getByText('Signal type',{exact:true}).count(), 0);

    await page.getByRole('button',{name:'+ Add input'}).click();
    await page.getByRole('button',{name:/Fuel flow/}).click();
    assert.equal(await page.getByRole('button',{name:/Servo \/ pulse input 1/}).count(), 1);
    await page.getByRole('button',{name:/Servo \/ pulse input 1/}).click();

    await page.getByRole('button',{name:'+ Add input'}).click();
    await page.getByRole('button',{name:/Idle input/}).click();
    assert.equal(await page.getByRole('button',{name:/Servo \/ pulse input 1/}).count(), 0,
      'an assigned multipurpose port must be reserved as a whole');
    assert.equal(await page.getByRole('button',{name:/Servo \/ pulse input 2/}).count(), 1);
    await page.getByRole('button',{name:/Servo \/ pulse input 2/}).click();

    await page.getByRole('button',{name:'+ Add output'}).click();
    await page.getByRole('button',{name:/^Starter Electric starter/}).click();
    assert.equal(await page.getByRole('button',{name:/Servo output 1/}).count(), 1);
    await page.getByRole('button',{name:/Servo output 1/}).click();

    await page.getByRole('button',{name:'+ Add input'}).click();
    await page.getByRole('button',{name:/^Stop switch /}).click();
    await page.getByRole('button',{name:/Switch input 1/}).click();

    await page.getByRole('button',{name:'+ Add input'}).click();
    await page.getByRole('button',{name:/^Start switch /}).click();
    assert.equal(await page.getByRole('button',{name:/ADC 1/}).count(), 1,
      'an ADC connector configured for thresholded digital use must be offered for a switch');
    await page.getByRole('button',{name:/ADC 1/}).click();

    const saved = await (await page.request.get(`${base}/api/hardware`)).json();
    const assigned = [...saved.channel_registry.inputs,...saved.channel_registry.outputs];
    // The page has not saved yet; inspect its live model instead.
    const live = await page.evaluate(() => cfg.channel_registry);
    assert.deepEqual(live.inputs.map(c=>c.physical_port), [undefined,'thermo_1','servo_pulse_1','servo_pulse_2','switch_1','adc_1']);
    assert.equal(live.inputs[5].physical_mode, 'digital');
    assert.equal(live.inputs[5].i2c_reference_mv, 5000);
    assert.equal(live.inputs[5].digital_threshold_raw, 2048,
      'ADC-backed switch must default to a 50% threshold');
    assert.equal(live.inputs[1].temp_interface, 3,
      'profile device metadata must select the fitted MAX31856 interface');
    const adcSwitchCard = page.locator('#registry-inputs .registry-card').nth(5);
    assert.equal(await adcSwitchCard.getByText('Switch threshold (V)',{exact:true}).count(), 1);
    assert.match(await adcSwitchCard.textContent(), /Defaults to 50%/);
    assert.equal(live.outputs[0].physical_port, 'servo_out_1');
    assert.equal(assigned.length, 1);

    console.log('PCB profile UI audit passed: named capability-filtered ports replace raw topology and exclusive multipurpose ports stay reserved.');
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
