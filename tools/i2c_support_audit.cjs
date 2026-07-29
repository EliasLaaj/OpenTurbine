const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manager = read('src/hal/i2c/I2CDeviceManager.h');
const registry = read('src/system/ChannelRegistry.h');
const hardware = read('src/Hardware.h');
const main = read('src/main.cpp');
const web = read('src/system/web/WebServer.cpp');
const hwUi = read('data_src/hardware.html');
const calibration = read('data_src/calibration.html');
const logger = read('src/system/SessionLogger.cpp');
const rules = read('src/system/RulesEngine.h');
const cluster = read('src/system/ClusterSerial.cpp');
const mavlink = read('src/system/MAVLinkOutput.h');
const pcnt = read('src/hal/sensors/PCNTRpmSensor.h');
const ds18 = read('src/hal/sensors/DS18B20TempSensor.h');

assert.match(pcnt, /max_glitch_ns\s*=\s*5000/);
assert.match(ds18, /_resolution\(10\)/);

assert.match(manager, /Tca9554=1,\s*Tla2528=2,\s*Nau7802=3/);
assert.match(manager, /0x20;\s*a <= 0x27/);
assert.match(manager, /0x10;\s*a <= 0x17/);
assert.match(manager, /0x2A,\s*Nau7802/);
assert.match(manager, /_scanStep\(\)/);
assert.doesNotMatch(manager, /\bdelay\s*\(/);
assert.match(manager, /Wire\.setTimeOut\(5\)/);
assert.match(manager, /tick\(bool allowDiscovery/);
assert.match(manager, /TCA_HEARTBEAT_TICKS = 16/);
assert.match(manager, /nextLatch == latch[\s\S]*_tcaVerifiedTick\[deviceIndex\][\s\S]*TCA_HEARTBEAT_TICKS/);
assert.match(manager, /_parkAssignedRelayOutputs\(\);[\s\S]*_scan\(\)/);
assert.match(manager, /_writeReg\(address, 0x01, latch\) &&[\s\S]*_writeReg\(address, 0x03, direction\)/);
assert.match(manager, /if \(!ok\) \{[\s\S]*_markMissing\(address, Tca9554\)/);
assert.match(manager, /candidate\.driver >= ChannelRegistry::I2cDigital/);
assert.match(manager, /_serviceNauInit\(\)/);
assert.match(manager, /_nauPendingRegistryIndex/);
assert.match(manager, /raw > -8388352L && raw < 8388351L/);
assert.match(manager, /raw >= c\.minValue && raw <= c\.maxValue/);
assert.match(manager, /_valid\[registryIndex\]/);

assert.match(registry, /nauLoadCells > 2/);
assert.match(registry, /inputs\[i\]\.loadCellGain != nauGain/);
assert.match(registry, /c\.i2cAddress == 0x2A && c\.deviceChannel < 2/);

assert.match(hardware, /unavailableEngineI2cOutput/);
assert.match(hardware, /I2CDeviceManager::tick\(allowI2cDiscovery\)/);
assert.match(hardware, /driveBootSafeStates\(\)[\s\S]*I2CDeviceManager::begin/);
assert.match(hardware, /c\.driver == ChannelRegistry::I2cRelay\) continue/);
assert.match(main, /I2C_OUTPUT_LOST/);
assert.match(main, /START blocked: I2C output unavailable/);
assert.match(main, /Control command queue allocation failed/);
assert.match(web, /New I2C assignments can only use a device detected on the live bus/);

assert.match(hwUi, /Only devices responding on the live bus can be assigned/);
assert.match(hwUi, /Remove device and assignments/);
assert.match(hwUi, /removeDisconnectedI2cDevice/);
assert.match(hwUi, /Native ESP GPIO is recommended/);
assert.match(calibration, /Thrust.*Load Cell \(NAU7802\)/s);
assert.match(calibration, /known.*(force|load)/i);
assert.match(calibration, /_loadCellCal\[kind\]\.id\s*=\s*channel\.id/);
assert.doesNotMatch(calibration, /kind === 'torque' \? 'torque_main' : 'thrust_main'/);

for (const [name, source, pattern] of [
  ['rules', rules, /case THRUST/],
  ['session logger', logger, /thrust_n/],
  ['cluster telemetry', cluster, /THRUST_N/],
  ['MAVLink telemetry', mavlink, /THRUST_N/],
]) assert.match(source, pattern, `${name} is missing thrust integration`);

console.log('I2C/load-cell support audit passed.');
