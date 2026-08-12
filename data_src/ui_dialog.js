(function () {
  'use strict';

  // Abort API reads that are still in flight when leaving a page. Otherwise
  // they can occupy the Classic ESP32's small TCP pool behind the next page
  // load. Combine this page-lifetime signal with caller timeout signals.
  const nativeFetch = window.fetch.bind(window);
  let pageFetchController = new AbortController();
  let pendingPageFetches = 0;
  const pageFetchWaiters = new Set();
  const waitForPageFetches = (timeoutMs) => {
    if (!pendingPageFetches) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = value => {
        clearTimeout(timer);
        pageFetchWaiters.delete(done);
        resolve(value);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      pageFetchWaiters.add(done);
    });
  };
  window.fetch = (input, init = {}) => {
    const requestUrl = typeof input === 'string' ? input : input.url;
    const method = String(init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const pathname = new URL(requestUrl, location.href).pathname;
    const cacheableConfig = method === 'GET' && location.hostname !== '127.0.0.1'
      && location.hostname !== 'localhost'
      && (pathname === '/api/config' || pathname === '/api/hardware');
    const cacheKey = `ot-page-cache:${pathname}`;
    if (cacheableConfig) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
        if (cached && Date.now() - cached.at < 5000) {
          return Promise.resolve(new Response(cached.body, {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
      } catch (_) {}
    } else if (method !== 'GET' && (pathname === '/api/config' || pathname === '/api/hardware'
        || pathname === '/api/ecu_config')) {
      try {
        sessionStorage.removeItem('ot-page-cache:/api/config');
        sessionStorage.removeItem('ot-page-cache:/api/hardware');
      } catch (_) {}
    }
    const requestController = new AbortController();
    const signals = [pageFetchController.signal, init.signal].filter(Boolean);
    const abort = () => requestController.abort();
    for (const signal of signals) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    pendingPageFetches++;
    return nativeFetch(input, { ...init, signal: requestController.signal })
      .then(async response => {
        // Do not report a JSON fetch as settled merely because its headers
        // arrived. Navigation must wait until the small ECU response body has
        // actually drained from the Classic's one-shot HTTP connection.
        let body = null;
        if (method === 'GET' && response.headers.get('content-type')?.includes('application/json')) {
          body = await response.clone().text();
        }
        if (cacheableConfig && response.ok && body !== null) {
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), body })); } catch (_) {}
        }
        return response;
      })
      .finally(() => {
        signals.forEach(signal => signal.removeEventListener('abort', abort));
        pendingPageFetches = Math.max(0, pendingPageFetches - 1);
        if (!pendingPageFetches) {
          for (const done of [...pageFetchWaiters]) done(true);
        }
      });
  };
  const abortPageFetches = () => pageFetchController.abort();
  const waitForWindowLoad = (timeoutMs) => {
    if (document.readyState === 'complete') return Promise.resolve(true);
    return new Promise(resolve => {
      const done = value => {
        clearTimeout(timer);
        window.removeEventListener('load', loaded);
        resolve(value);
      };
      const loaded = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      window.addEventListener('load', loaded, { once: true });
    });
  };
  window.addEventListener('pagehide', abortPageFetches);
  window.addEventListener('beforeunload', abortPageFetches);
  window.addEventListener('pageshow', event => {
    if (event.persisted && pageFetchController.signal.aborted) {
      pageFetchController = new AbortController();
    }
  });
  let navigationStarting = false;
  document.addEventListener('click', async event => {
    const anchor = event.target.closest?.('nav a[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey
        || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === '_blank') return;
    const target = new URL(anchor.href, location.href);
    if (target.origin !== location.origin) return;
    const release = document.querySelector('script[data-ot-version]')?.dataset.otVersion;
    if (release) target.searchParams.set('v', release);
    if (target.href === location.href) return;
    event.preventDefault();
    if (navigationStarting) return;
    navigationStarting = true;
    window.dispatchEvent(new Event('ot:navigation-start'));
    document.documentElement.style.cursor = 'progress';
    // The navigation bar can be clicked while the Classic is still streaming
    // this page's CSS/JS. Finish load-blocking files before leaving so Chrome
    // does not abandon a LittleFS response and occupy a scarce TCP connection.
    await Promise.all([waitForWindowLoad(6000), waitForPageFetches(4000)]);
    abortPageFetches();
    // Give the async TCP task one scheduling window to process the old page's
    // request aborts and WebSocket close before opening the replacement page.
    setTimeout(() => location.assign(target.href), 200);
  });

  let activeResolve = null;
  let previousFocus = null;
  let activeOptions = null;

  function ensureDialog() {
    let overlay = document.getElementById('ot-app-dialog');
    if (overlay) return overlay;

    const style = document.createElement('style');
    style.textContent = `
      .ot-dialog-overlay{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;padding:1rem;background:rgba(0,0,0,.76)}
      .ot-dialog-overlay.show{display:flex}
      .ot-dialog-card{width:min(620px,96vw);max-height:88vh;display:flex;flex-direction:column;background:var(--surface,#17171a);color:var(--text,#f5f5f7);border:1px solid var(--border-light,#42424a);border-radius:10px;box-shadow:0 20px 70px rgba(0,0,0,.55)}
      .ot-dialog-header{padding:1rem 1.1rem .7rem;font-size:.9rem;font-weight:800;letter-spacing:.04em}
      .ot-dialog-message{padding:.25rem 1.1rem 1rem;color:var(--text-2,#cecdd4);font-size:.82rem;line-height:1.55;white-space:pre-wrap;overflow:auto}
      .ot-dialog-input{box-sizing:border-box;margin:0 1.1rem 1rem;width:calc(100% - 2.2rem);max-width:calc(100% - 2.2rem);min-width:0;min-height:44px;padding:.55rem .7rem;background:var(--bg,#101012);color:var(--text,#f5f5f7);border:1px solid var(--border-light,#42424a);border-radius:6px;font:inherit}
      .ot-dialog-check{display:none;align-items:center;gap:.5rem;margin:0 1.1rem 1rem;color:var(--text-2,#cecdd4);font-size:.76rem;line-height:1.4}
      .ot-dialog-check input{flex:0 0 auto}
      .ot-dialog-actions{display:flex;justify-content:flex-end;gap:.6rem;padding:.85rem 1.1rem;border-top:1px solid var(--border,#313135)}
      .ot-dialog-actions button{min-height:44px}
      .ot-dialog-actions .danger{background:var(--red,#ff4d5f);border-color:var(--red,#ff4d5f);color:#fff}
      @media(max-width:520px){.ot-dialog-overlay{align-items:flex-end;padding:.6rem}.ot-dialog-card{width:100%;max-height:92vh}.ot-dialog-actions{flex-wrap:wrap}.ot-dialog-actions button{flex:1 1 120px}}
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'ot-app-dialog';
    overlay.className = 'ot-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="ot-dialog-card">
        <div class="ot-dialog-header" id="ot-dialog-title"></div>
        <div class="ot-dialog-message" id="ot-dialog-message"></div>
        <input class="ot-dialog-input" id="ot-dialog-input" type="text" style="display:none">
        <label class="ot-dialog-check" id="ot-dialog-check-wrap"><input id="ot-dialog-check" type="checkbox"><span id="ot-dialog-check-label"></span></label>
        <div class="ot-dialog-actions">
          <button type="button" id="ot-dialog-cancel" style="display:none">Cancel</button>
          <button type="button" id="ot-dialog-confirm">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById('ot-dialog-cancel').style.display !== 'none') finish(false);
    });
    document.getElementById('ot-dialog-cancel').addEventListener('click', () => finish(false));
    document.getElementById('ot-dialog-confirm').addEventListener('click', () => finish(true));
    return overlay;
  }

  function finish(accepted) {
    const overlay = document.getElementById('ot-app-dialog');
    if (!overlay) return;
    const input = document.getElementById('ot-dialog-input');
    const value = accepted ? (input.style.display === 'none' ? true : input.value) : false;
    if (accepted && activeOptions?.rememberKey && document.getElementById('ot-dialog-check')?.checked) {
      try { localStorage.setItem(activeOptions.rememberKey, '1'); } catch (_) {}
    }
    overlay.classList.remove('show');
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    const resolve = activeResolve;
    activeResolve = null;
    activeOptions = null;
    if (resolve) resolve(value);
  }

  function open(message, options) {
    const overlay = ensureDialog();
    if (activeResolve) activeResolve(false);
    activeOptions = options;
    previousFocus = document.activeElement;
    document.getElementById('ot-dialog-title').textContent = options.title || 'OpenTurbine';
    document.getElementById('ot-dialog-message').textContent = String(message || '');
    const input = document.getElementById('ot-dialog-input');
    input.style.display = options.prompt ? '' : 'none';
    input.value = options.value || '';
    input.placeholder = options.placeholder || '';
    const checkWrap = document.getElementById('ot-dialog-check-wrap');
    const check = document.getElementById('ot-dialog-check');
    checkWrap.style.display = options.checkboxLabel ? 'flex' : 'none';
    check.checked = false;
    document.getElementById('ot-dialog-check-label').textContent = options.checkboxLabel || '';
    const cancel = document.getElementById('ot-dialog-cancel');
    cancel.style.display = options.cancel ? '' : 'none';
    cancel.textContent = options.cancelLabel || 'Cancel';
    const confirm = document.getElementById('ot-dialog-confirm');
    confirm.textContent = options.confirmText || options.confirmLabel || 'OK';
    confirm.classList.toggle('danger', !!options.danger);
    overlay.classList.add('show');
    setTimeout(() => (options.prompt ? input : confirm).focus(), 0);
    return new Promise(resolve => { activeResolve = resolve; });
  }

  window.OTDialog = {
    alert(message, options = {}) {
      return open(message, {title:'Attention required', confirmLabel:'OK', ...options});
    },
    confirm(message, options = {}) {
      return open(message, {title:'Confirm action', cancel:true, confirmLabel:'Continue', ...options});
    },
    prompt(message, options = {}) {
      return open(message, {title:'Confirmation required', cancel:true, prompt:true, confirmLabel:'Confirm', ...options});
    }
  };

  const setupKey = 'openturbine_setup_progress_v1';
  window.OTSetup = {
    mark(step) {
      try {
        const state = JSON.parse(localStorage.getItem(setupKey) || '{}');
        // An upstream commissioning change makes selected later evidence stale.
        // Keep this conservative: these are browser activity marks, never a
        // substitute for the operator's physical verification.
        const invalidates = {
          hardware: ['config', 'calibration', 'sequence', 'tools'],
          config: ['tools'],
          calibration: ['tools'],
          sequence: ['tools']
        };
        (invalidates[step] || []).forEach(key => delete state[key]);
        state[step] = Date.now();
        localStorage.setItem(setupKey, JSON.stringify(state));
      } catch (_) {}
    },
    state() {
      try { return JSON.parse(localStorage.getItem(setupKey) || '{}'); }
      catch (_) { return {}; }
    }
  };

  // Existing alert call sites stop their operation immediately after showing the
  // message. Replacing the browser primitive here preserves that control flow
  // while making every message persistent and immune to browser suppression.
  window.alert = function (message) { window.OTDialog.alert(message); };
})();
