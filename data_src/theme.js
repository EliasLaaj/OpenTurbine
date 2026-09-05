/* OpenTurbine UI theming — applies the saved theme, renders the pickers,
   and drives the one-time first-run chooser. Loaded on every page.
   Stage 1: choice persists per-browser in localStorage. (A portable
   ecu_config.json ui_theme field can be layered on later.) */
(function () {
  'use strict';
  var bootScript = document.currentScript;
  var KEY = 'ot_theme';
  var ONBOARD = 'ot_theme_onboarded_v1';

  // key, display name, tag, and a few colors for the swatch previews
  var THEMES = [
    { k: 'carbon',   n: 'Carbon',        t: 'clean',     bg: '#101012', tx: '#f5f5f7', dm: '#a0a0a8', ac: '#ee7620', gr: '#33cf7a', ye: '#ffcf4d', rd: '#ff4d5f' },
    { k: 'ember',    n: 'Ember',         t: 'warm',      bg: '#14110d', tx: '#f7f4ee', dm: '#a79f94', ac: '#ec7a22', gr: '#34d07a', ye: '#ffcf4d', rd: '#ff4d61' },
    { k: 'slate',    n: 'Slate Teal',    t: 'cool',      bg: '#101416', tx: '#f1f5f6', dm: '#97a4a7', ac: '#2fb6b0', gr: '#38d29a', ye: '#ffce55', rd: '#ff5a6b' },
    { k: 'midnight', n: 'Midnight',      t: 'deep blue', bg: '#0e1120', tx: '#f4f5ff', dm: '#8890c0', ac: '#00f0a0', gr: '#00f0a0', ye: '#ffc400', rd: '#ff4466' },
    { k: 'contrast', n: 'High Contrast', t: 'bright',    bg: '#000000', tx: '#ffffff', dm: '#b8b8c0', ac: '#ff8a1e', gr: '#00e676', ye: '#ffd000', rd: '#ff3b5c' },
    { k: 'daylight', n: 'Daylight',      t: 'light',     bg: '#f4f2ee', tx: '#1b1917', dm: '#7c766b', ac: '#c65d12', gr: '#12a150', ye: '#b47f00', rd: '#db2f43' }
  ];
  var VALID = THEMES.map(function (t) { return t.k; });
  function meta(k) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].k === k) return THEMES[i]; return THEMES[0]; }

  function get() {
    try { var v = localStorage.getItem(KEY); if (v && VALID.indexOf(v) >= 0) return v; } catch (e) {}
    return 'carbon';
  }
  function apply(k) {
    if (VALID.indexOf(k) < 0) k = 'carbon';
    document.documentElement.setAttribute('data-theme', k);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', meta(k).bg);
  }
  function markActive(k) {
    var all = document.querySelectorAll('[data-theme-key]');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i].getAttribute('data-theme-key') === k);
  }
  function set(k, silent) {
    if (VALID.indexOf(k) < 0) return;
    try { localStorage.setItem(KEY, k); } catch (e) {}
    apply(k);
    markActive(k);
    // Persist to the device so the theme travels inside ecu_config.json.
    if (!silent) { try { fetch('/api/theme?t=' + encodeURIComponent(k), { method: 'POST' }).catch(function () {}); } catch (e) {} }
  }
  // Fresh browser with no local choice yet → adopt whatever the device has saved,
  // so a theme stored in the engine file follows it to any new phone/browser.
  function reconcileFromDevice() {
    try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }
    try {
      fetch('/api/theme').then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.theme && VALID.indexOf(d.theme) >= 0) set(d.theme, true);
      }).catch(function () {});
    } catch (e) {}
  }

  /* ── theme tile: a mini preview in the theme's own colours ── */
  function tile(t) {
    return '<button class="ot-tile" type="button" data-theme-key="' + t.k + '" title="' + t.n + ' — ' + t.t +
      '" onclick="OTTheme.set(\'' + t.k + '\')" style="background:' + t.bg + '">' +
      '<span class="ot-tile-top" style="background:' + t.ac + '"></span>' +
      '<span class="ot-tile-dots"><i style="background:' + t.gr + '"></i><i style="background:' + t.ye +
        '"></i><i style="background:' + t.rd + '"></i></span>' +
      '<span class="ot-tile-name" style="color:' + t.tx + '">' + t.n +
        '<span class="ot-tile-tag" style="color:' + t.dm + '">' + t.t + '</span></span>' +
    '</button>';
  }

  /* ── Appearance strip (Tools page bottom) ── */
  function renderPicker(el) {
    if (!el) return;
    el.innerHTML = '<div class="ot-appx-label">Appearance</div><div class="ot-appx-grid">' +
      THEMES.map(tile).join('') + '</div>';
    markActive(get());
  }

  /* ── one-time first-run chooser (dashboard) ── */
  function maybeFirstRun() {
    try { if (localStorage.getItem(ONBOARD) === '1') return; } catch (e) {}
    var ov = document.getElementById('theme-firstrun');
    if (!ov) return;
    var grid = document.getElementById('theme-firstrun-grid');
    if (grid) grid.innerHTML = THEMES.map(tile).join('');
    markActive(get());
    ov.style.display = 'flex';
  }
  function finishFirstRun() {
    try { localStorage.setItem(ONBOARD, '1'); } catch (e) {}
    var ov = document.getElementById('theme-firstrun');
    if (ov) ov.style.display = 'none';
  }

  /* ── widget styles (kept here so style.css stays palette-only) ── */
  var css =
    '.ot-appx-label{font-size:.66rem;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);font-weight:600;margin-bottom:9px}' +
    '.ot-appx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:9px}' +
    '.ot-tile{padding:0;border:1px solid var(--border-light);border-radius:9px;overflow:hidden;cursor:pointer;text-align:left;display:flex;flex-direction:column;transition:transform .08s}' +
    '.ot-tile:hover{transform:translateY(-2px)}' +
    '.ot-tile.active{box-shadow:0 0 0 2px var(--accent);border-color:var(--accent)}' +
    '.ot-tile-top{display:block;height:24px}' +
    '.ot-tile-dots{display:flex;gap:4px;padding:8px 9px 0}' +
    '.ot-tile-dots i{width:12px;height:12px;border-radius:3px;display:block}' +
    '.ot-tile-name{display:block;padding:6px 9px 9px;font-size:.73rem;font-weight:600;line-height:1.25}' +
    '.ot-tile-tag{display:block;font-weight:400;font-size:.6rem;margin-top:1px}' +
    '.theme-firstrun-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;z-index:1100;padding:1rem}' +
    '.theme-firstrun-box{background:var(--surface-2);border:1px solid var(--border-light);border-radius:12px;padding:20px 22px;max-width:580px;width:100%;max-height:calc(100vh - 2rem);overflow:auto;box-shadow:0 24px 70px rgba(0,0,0,.6)}' +
    '.tfr-kicker{font-size:.64rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:.4rem}' +
    '.theme-firstrun-box h3{font-size:1.15rem;margin-bottom:.3rem}' +
    '.theme-firstrun-box p{font-size:.83rem;color:var(--text-2);margin-bottom:1rem;line-height:1.5}' +
    '.tfr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:9px;margin-bottom:1.1rem}' +
    '.tfr-actions{display:flex;justify-content:flex-end}';
  try {
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  } catch (e) {}

  window.OTTheme = {
    get: get, set: set, apply: apply,
    renderPicker: renderPicker, maybeFirstRun: maybeFirstRun, finishFirstRun: finishFirstRun,
    THEMES: THEMES
  };

  // Shared by every page, including the lightweight Hardware and Sequence
  // pages that intentionally do not load the dashboard telemetry script.
  window.OTShowRebootOverlay = function (options) {
    options = options || {};
    var nextWifiName = String(options.nextWifiName || '');
    var returnPath = options.returnPath || location.pathname || '/';
    var seconds = Math.max(3, Number(options.seconds || 12));
    var esc = function (value) {
      return String(value).replace(/[&<>"']/g, function (ch) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
      });
    };
    var overlay = document.getElementById('reboot-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'reboot-overlay';
      document.body.appendChild(overlay);
    }
    overlay.className = 'rebooting-overlay show';
    overlay.innerHTML = '<div class="spinner"></div><div>Device rebooting — reconnecting…</div>' +
      '<div id="reboot-wifi-note" style="font-size:.82rem;color:var(--text);max-width:32rem;text-align:center;line-height:1.45"></div>' +
      '<div id="reboot-timer" style="font-size:.85rem;color:var(--dim)"></div>';
    var note = overlay.querySelector('#reboot-wifi-note');
    var timer = overlay.querySelector('#reboot-timer');
    var target = 'http://192.168.4.1' + returnPath;
    note.innerHTML = nextWifiName
      ? 'Wi-Fi name changed. Connect to <strong>' + esc(nextWifiName) + '</strong>, then open <a href="' + target + '" style="color:var(--accent)">192.168.4.1</a>.'
      : 'Keep this page open while the ECU restarts. If it does not reconnect, open <a href="' + target + '" style="color:var(--accent)">192.168.4.1</a>.';
    if (window._otRebootOverlayTimer) clearInterval(window._otRebootOverlayTimer);
    var remaining = seconds;
    timer.textContent = 'Reconnecting in ~' + remaining + 's…';
    window._otRebootOverlayTimer = setInterval(function () {
      remaining--;
      timer.textContent = remaining > 0 ? 'Reconnecting in ~' + remaining + 's…' : 'Reconnecting…';
      if (remaining > 0) return;
      clearInterval(window._otRebootOverlayTimer);
      window._otRebootOverlayTimer = null;
      if (nextWifiName) {
        timer.textContent = 'Connect to Wi-Fi “' + nextWifiName + '”, then reopen 192.168.4.1.';
        return;
      }
      var poll = setInterval(function () {
        fetch('/api/status', {cache:'no-store'}).then(function (response) {
          if (!response.ok) return;
          clearInterval(poll);
          location.href = returnPath;
        }).catch(function () {});
      }, 1000);
    }, 1000);
    return overlay;
  };

  apply(get());
  // Classic ESP32 cannot reliably serve four cold browser requests in
  // parallel. theme.js is the one parser-blocking bootstrap; it then loads
  // CSS, dialogs and (where requested) the shared app strictly in sequence.
  // Synchronous same-origin reads are intentional here: they keep the parser
  // and preload scanner from creating parallel TCP clients on the ECU, and
  // ensure DOMContentLoaded still means the UI code is ready.
  function loadBootAssets() {
    var version = (bootScript && bootScript.getAttribute('data-ot-version')) || '';
    var suffix = version ? '?v=' + encodeURIComponent(version) : '';
    // HTML documents are immutable within one installed web release, just
    // like the shared assets. Carry the release token on every local page
    // link so the ECU can give exact-version navigation a long browser cache.
    // Without this, pages age out after 60 seconds and the Classic repeatedly
    // retransfers up to 110 KiB from LittleFS during ordinary navigation.
    if (version) {
      function versionLocalLinks(root) {
        var links = root.matches && root.matches('a[href]')
          ? [root] : root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
        Array.prototype.forEach.call(links, function (link) {
          var raw = link.getAttribute('href') || '';
          if (!raw || raw.charAt(0) !== '/' || raw.indexOf('//') === 0 || raw.indexOf('?v=') >= 0) return;
          var hashAt = raw.indexOf('#');
          var hash = hashAt >= 0 ? raw.slice(hashAt) : '';
          var path = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
          if (path !== '/' && !/\.html$/.test(path)) return;
          link.setAttribute('href', path + '?v=' + encodeURIComponent(version) + hash);
        });
      }
      versionLocalLinks(document);
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes, function (node) {
            if (node.nodeType === 1) versionLocalLinks(node);
          });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
    function read(url) {
      // One synchronous attempt preserves the normal single-request Classic
      // boot path. Repeating a blocked synchronous read can starve the very
      // connection that must serve it, so recovery below is asynchronous.
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.send(null);
        if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText)
          return xhr.responseText;
      } catch (e) {}
      return '';
    }
    function readAsync(url, attempts) {
      return new Promise(function (resolve) {
        function tryRead(left) {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.timeout = 5000;
          xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) resolve(xhr.responseText);
            else retry(left);
          };
          xhr.onerror = xhr.ontimeout = function () { retry(left); };
          function retry(remaining) {
            if (remaining <= 1) return resolve('');
            setTimeout(function () { tryRead(remaining - 1); }, 450);
          }
          try { xhr.send(null); } catch (e) { retry(left); }
        }
        tryRead(attempts);
      });
    }
    function installCss(text) {
      if (!text) return;
      var style = document.createElement('style');
      style.setAttribute('data-ot-shared-css', 'true');
      style.textContent = text;
      document.head.appendChild(style);
    }
    function installScript(text, marker) {
      if (!text) return;
      var script = document.createElement('script');
      script.setAttribute(marker, 'true');
      script.textContent = text;
      document.head.appendChild(script);
    }
    var sharedCss = read('/style.css' + suffix);
    if (sharedCss) {
      installCss(sharedCss);
    }
    var dialogs = read('/ui_dialog.js' + suffix);
    if (dialogs) {
      installScript(dialogs, 'data-ot-dialog');
    }
    if (bootScript && bootScript.getAttribute('data-ot-app') === 'true') {
      var app = read('/app.js' + suffix);
      if (app) {
        installScript(app, 'data-ot-shared-app');
      }
    }
    function finishBoot() {
      if (!sharedCss || !window.OTDialog ||
          (bootScript && bootScript.getAttribute('data-ot-app') === 'true' && !window.OTSaveConfigPatch)) return false;
      reconcileFromDevice();
      renderPicker(document.getElementById('appearance-picker'));
      document.documentElement.classList.add('ot-theme-ready');
      document.documentElement.removeAttribute('data-ot-assets-retrying');
      return true;
    }
    if (finishBoot()) return;

    // A page change can overlap the previous flash response on Classic. Let
    // that connection close, then fetch only the missing assets in sequence.
    // This avoids both parallel requests and the former infinite blank reload.
    document.documentElement.setAttribute('data-ot-assets-retrying', 'true');
    var recovery = Promise.resolve();
    if (!sharedCss) recovery = recovery.then(function () {
      return readAsync('/style.css' + suffix, 5).then(function (text) { sharedCss = text; installCss(text); });
    });
    if (!dialogs) recovery = recovery.then(function () {
      return readAsync('/ui_dialog.js' + suffix, 5).then(function (text) { dialogs = text; installScript(text, 'data-ot-dialog'); });
    });
    if (bootScript && bootScript.getAttribute('data-ot-app') === 'true' && !app) recovery = recovery.then(function () {
      return readAsync('/app.js' + suffix, 5).then(function (text) { app = text; installScript(text, 'data-ot-shared-app'); });
    });
    recovery.then(function () {
      if (finishBoot()) return;
      document.documentElement.classList.add('ot-theme-ready');
      document.documentElement.setAttribute('data-ot-assets-failed', 'true');
      var notice = document.createElement('div');
      notice.setAttribute('style', 'position:fixed;z-index:99999;left:12px;right:12px;top:12px;padding:14px 16px;background:#311;color:#fff;border:1px solid #f66;border-radius:8px;font:16px sans-serif');
      notice.innerHTML = 'Web interface files could not be loaded. The ECU is still running. <button style="margin-left:12px;padding:6px 10px" onclick="location.reload()">Reload interface</button>';
      document.body.insertBefore(notice, document.body.firstChild);
    });
  }
  loadBootAssets();
})();
