// Explicit bench-only write test. Never starts the engine or energizes outputs.
// Changes only the description, restores it, and checks Settings preservation.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
if (!process.argv.includes('--allow-write')) throw new Error('Requires --allow-write on an idle bench ECU');
const base = process.argv.find(a => /^http/.test(a)) || 'http://192.168.4.1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function reconnect() {
  await delay(8000);
  if (process.platform === 'win32' && base === 'http://192.168.4.1')
    execFileSync('netsh', ['wlan','connect','name=OpenTurbine'], {stdio:'ignore'});
  for (let i=0; i<25; i++) {
    try {
      const r = await fetch(base+'/api/status', {signal:AbortSignal.timeout(2000)});
      if(r.ok && (await r.json()).mode === 'STANDBY') return;
    } catch (_) {}
    await delay(1000);
  }
  throw new Error('ECU did not reconnect');
}
(async () => {
  const original = await fetch(base+'/api/ecu_config').then(r=>r.json());
  const status = await fetch(base+'/api/status').then(r=>r.json());
  assert.equal(status.mode,'STANDBY');
  const executablePath = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
    .filter(Boolean).flatMap(p=>[path.join(p,'Google/Chrome/Application/chrome.exe'),path.join(p,'Microsoft/Edge/Application/msedge.exe')])
    .find(p=>fs.existsSync(p));
  const browser = await chromium.launch({headless:true,...(executablePath ? {executablePath}: {})});
  const page = await browser.newPage();
  try {
    await page.addInitScript(()=>{
      localStorage.setItem('ot_beta_notice_ack_v1','1');
      localStorage.setItem('ot_theme_onboarded_v1','1');
    });
    await page.goto(base+'/system.html');
    await page.waitForSelector('#system-engine-description',{state:'attached'});
    await page.evaluate(()=>document.querySelectorAll('details').forEach(e=>e.open=true));
    const value = original.hardware.profile_desc;
    await page.locator('#system-engine-description').fill('Development save audit');
    await page.locator('#system-engine-description').dispatchEvent('change');
    assert.equal(await page.evaluate(()=>_cfgDirty),true);
    // Cancel before navigation tears down telemetry or pending page fetches.
    await page.locator('nav a[href^="/controllers.html"]').click();
    await page.waitForSelector('#ot-app-dialog.show');
    assert.match(await page.locator('#ot-app-dialog').innerText(),/unsaved changes/i);
    await page.locator('#ot-dialog-cancel').click();
    assert.match(page.url(),/system.html/);
    await page.locator('#btn-save').click();
    await page.waitForSelector('#save-recap-modal',{state:'visible'});
    assert.doesNotMatch(await page.locator('#save-recap-body').innerText(), /Controller assignments|N1 pullback/);
    await page.locator('#save-recap-confirm-btn').click();
    await page.waitForFunction(()=>document.querySelector('#save-msg')?.textContent.includes('Saved — ECU rebooting'),null,{timeout:15000});
    await reconnect();
    let saved = await fetch(base+'/api/ecu_config').then(r=>r.json());
    assert.equal(saved.hardware.profile_desc,'Development save audit');
    assert.deepEqual(saved.settings,original.settings);
    // Exercise the combined page-save function with unchanged cosmetic settings:
    // the first reboot must finish before the second PATCH is transmitted.
    await page.goto(base+'/system.html');
    await page.waitForSelector('#system-engine-description',{state:'attached'});
    await page.evaluate(({value,theme})=>{
      setSystemHardware('profile_desc',value);
      window.__auditSave = _saveSystemChanges({ui_theme:theme},document.getElementById('save-msg'),document.getElementById('btn-save'));
    },{value,theme:original.settings.ui_theme});
    // Reconnect Windows while the page waits for the first reboot.
    await reconnect();
    await page.evaluate(()=>window.__auditSave);
    await reconnect();
    saved = await fetch(base+'/api/ecu_config').then(r=>r.json());
    assert.equal(saved.hardware.profile_desc,value);
    assert.deepEqual(saved.settings,original.settings);
    console.log('PASS: System recap, unsaved navigation, page-only save, combined save across reboot, exact Settings preservation, and description restoration');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
