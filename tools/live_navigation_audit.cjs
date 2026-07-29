const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

function installedBrowser() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

(async () => {
  const base = process.argv[2] || 'http://192.168.4.1';
  const cycles = Number(process.argv[3] || 10);
  const screenshotDir = process.argv[4] || path.join(os.tmpdir(), 'openturbine-live-audit');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const dwellMs = Number(process.argv[5] || 1000);
  const pages = ['/', '/hardware.html', '/config.html', '/calibration.html', '/sequence.html', '/log.html', '/tools.html'];
  const failures = [];
  const recoveredApiFailures = [];
  const browser = await chromium.launch({ headless: true, ...(installedBrowser() ? { executablePath: installedBrowser() } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    localStorage.setItem('ot_beta_notice_ack_v1', '1');
    localStorage.setItem('ot_theme_onboarded_v1', '1');
    localStorage.setItem('ot_theme', 'carbon');
  });
  const page = await context.newPage();
  let navigationEpoch = 0;
  const requestEpoch = new WeakMap();
  const navigate = async (url, options) => {
    navigationEpoch++;
    const target = new URL(url);
    if (page.url().startsWith(base)) {
      const link = page.locator(`nav a[href="${target.pathname}"]`).first();
      if (await link.count()) {
        const [response] = await Promise.all([
          page.waitForNavigation(options),
          link.click()
        ]);
        return response;
      }
    }
    return page.goto(url, options);
  };
  page.on('request', request => requestEpoch.set(request, navigationEpoch));
  page.on('requestfailed', request => {
    const errorText = request.failure()?.errorText || 'failed';
    const pathname = new URL(request.url()).pathname;
    // Moving to the next page intentionally cancels telemetry requests that
    // the page being left still had in flight. Those are not transport faults.
    if (errorText === 'net::ERR_ABORTED' && pathname.startsWith('/api/')) return;
    // Chrome reports an intentionally aborted fixed-length response as a
    // content-length mismatch when navigation wins the race with the abort.
    // Ignore it only when the request belongs to the page already left.
    if (errorText === 'net::ERR_CONTENT_LENGTH_MISMATCH' && pathname.startsWith('/api/')
        && requestEpoch.get(request) < navigationEpoch) return;
    const message = `${request.url()}: ${errorText}`;
    if (pathname.startsWith('/api/')) recoveredApiFailures.push(message);
    else failures.push(message);
    console.error(`REQUEST FAILED ${message}`);
  });
  page.on('pageerror', error => {
    failures.push(`page error: ${error.message}`);
    console.error(`PAGE ERROR ${error.message}`);
  });

  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const route of pages) {
      const started = Date.now();
      const response = await navigate(base + route, { waitUntil: 'domcontentloaded', timeout: 12000 });
      assert.ok(response && response.ok(), `${route} returned ${response?.status()}`);
      await page.waitForSelector('nav', { timeout: 5000 });
      await page.waitForTimeout(dwellMs);
      console.log(`cycle ${cycle + 1}/${cycles} ${route} ${Date.now() - started} ms`);
    }
    const status = await page.request.get(`${base}/api/status`, { timeout: 5000 });
    assert.equal(status.ok(), true, `status failed after navigation cycle ${cycle + 1}`);
  }

  await navigate(`${base}/config.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cf-sf_p1t');
  await page.evaluate(() => {
    document.querySelectorAll('.config-group').forEach(group => { group.open = true; });
  });
  for (const key of ['sf_tit', 'sf_p1t', 'sf_p2t']) {
    const field = page.locator(`#cf-${key}`);
    assert.equal(await field.count(), 1, `${key} missing from Engine Protection Limits`);
    assert.equal(await field.evaluate(el => el.closest('#engine-limits') !== null), true, `${key} is outside Engine Protection Limits`);
  }
  for (const key of ['pb_p1s', 'pb_p1h', 'pb_p2s', 'pb_p2h']) {
    assert.match(await page.locator(`#cf-${key}`).evaluate(el => el.closest('.cfg-field').querySelector('.cfg-label').textContent), /bar|PSI|kPa/);
  }
  await page.screenshot({ path: path.join(screenshotDir, 'classic-config-mobile.png'), fullPage: true });

  await navigate(`${base}/log.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#tab-session').click();
  for (const bit of ['p1', 'p2', 'torque', 'starter'])
    assert.equal(await page.locator(`[data-bit="${bit}"]`).count(), 1, `${bit.toUpperCase()} logging is missing from Log > Session Data`);

  await navigate(`${base}/tools.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-factory-reset:not([disabled])', { timeout: 10000 });
  await page.locator('#btn-factory-reset').click();
  await page.locator('#ot-dialog-confirm').click();
  await page.waitForSelector('#ot-dialog-input:visible');
  const card = await page.locator('.ot-dialog-card').boundingBox();
  const input = await page.locator('#ot-dialog-input').boundingBox();
  assert.ok(card && input && input.x >= card.x && input.x + input.width <= card.x + card.width,
    'factory-reset confirmation input overflows its dialog');
  await page.screenshot({ path: path.join(screenshotDir, 'classic-factory-reset-mobile.png'), fullPage: true });
  await page.locator('#ot-dialog-cancel').click();

  for (const endpoint of ['/api/status', '/api/data', '/api/hardware', '/api/config']) {
    let response = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await page.request.get(base + endpoint, { timeout: 8000 });
        if (response.ok()) break;
      } catch (_) {}
      await page.waitForTimeout(400);
    }
    assert.equal(response?.ok(), true, `${endpoint} did not recover after navigation soak`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  assert.ok(recoveredApiFailures.length <= Math.max(2, cycles),
    `too many recoverable API transport retries (${recoveredApiFailures.length}):\n${recoveredApiFailures.join('\n')}`);
  console.log(`Live navigation audit passed: ${cycles * pages.length} page loads, APIs recovered, mobile UI checks passed (${recoveredApiFailures.length} transient API retries).`);
  await browser.close();
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
