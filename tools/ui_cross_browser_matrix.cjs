const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require('playwright');

const port = 8781;
const base = `http://127.0.0.1:${port}`;
const pages = ['/', '/hardware.html', '/config.html', '/sequence.html', '/log.html', '/tools.html'];
const viewports = [
  { name: 'desktop', width: 1366, height: 768 },
  { name: 'narrow', width: 390, height: 844 },
];

// The UI simulator is intentionally HTTP-only. Browser engines report the
// missing optional telemetry socket through different channels and wording.
// Ignore only localhost /ws connection diagnostics; all application errors
// and every other console error remain release failures.
function isExpectedMockWsError(text) {
  return /(?:WebSocket connection to ['"]?ws:\/\/127\.0\.0\.1:8781\/ws|Firefox can.t establish a connection to the server at ws:\/\/127\.0\.0\.1:8781\/ws|connection to ws:\/\/127\.0\.0\.1:8781\/ws was interrupted)/i.test(String(text));
}

(async () => {
  globalThis.OT_UI_SIM_PORT = port;
  await import('./ui_mock_server.mjs');
  await new Promise(resolve => setTimeout(resolve, 100));
  const results = [];
  for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
    let browser;
    let launchError;
    for (let attempt = 0; attempt < 3 && !browser; attempt++) {
      try {
        browser = await browserType.launch({ headless: true });
      } catch (error) {
        launchError = error;
        if (!/spawn UNKNOWN|EBUSY|EPERM/i.test(String(error.message)) || attempt === 2) break;
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    if (!browser) {
      if (/Executable doesn't exist|browser.*not found|spawn UNKNOWN|EBUSY|EPERM/i.test(String(launchError?.message))) {
        console.warn(`${name}: browser process unavailable on this host; canonical CI installs and runs it`);
        continue;
      }
      throw launchError;
    }
    try {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on('pageerror', error => {
          if (!isExpectedMockWsError(error.message)) errors.push(error.message);
        });
        page.on('console', message => {
          if (message.type() !== 'error') return;
          const text = message.text();
          // The HTTP-only simulator deliberately has no /ws endpoint. WebKit
          // reports navigation closing that optional telemetry socket as a
          // console error; production reconnect behavior is covered by the
          // simulator's dedicated dashboard soak/reconnect audit.
          if (isExpectedMockWsError(text)) return;
          errors.push(text);
        });
        await page.addInitScript(() => {
          localStorage.setItem('ot_beta_notice_ack_v1', '1');
          localStorage.setItem('ot_theme_onboarded_v1', '1');
        });
        for (const route of pages) {
          const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
          assert.ok(response && response.ok(), `${name}/${viewport.name} failed ${route}`);
          assert.ok(await page.locator('body').isVisible(), `${name}/${viewport.name} blank ${route}`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(overflow <= 2, `${name}/${viewport.name} horizontal overflow ${overflow}px on ${route}`);
        }
        assert.deepEqual(errors, [], `${name}/${viewport.name} console errors`);
        await page.close();
        results.push(`${name} ${viewport.name}`);
      }
    } finally {
      await browser.close();
    }
  }
  assert.ok(results.length > 0, 'no browser engine was available');
  console.log(`Cross-browser matrix passed: ${results.join(', ')}`);
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
