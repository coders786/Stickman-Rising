/** Runs from <head>, independent of Next chunks and React hydration. Only
 * static source goes in this script. No storage, identifiers or remote reporting. */
export const BOOT_WATCH = String.raw`(() => {
  const enabled = new URLSearchParams(location.search).get('boot') === '1';
  let problem = '', expired = false;
  const last = name => {
    const marks = performance.getEntriesByName('sr:' + name, 'mark');
    return marks.length ? marks[marks.length - 1].startTime : undefined;
  };
  const ms = time => Math.round(time) + ' ms';
  function render() {
    const panel = document.getElementById('sr-boot-report');
    if (!panel) return;
    const menu = last('menu'), request = last('engine-request'), code = last('engine-module'), ready = last('ready');
    const failed = last('engine-failed') !== undefined;
    const starting = ready === undefined;
    panel.hidden = !(enabled || (starting && (expired || failed || problem)));
    if (panel.hidden) return;
    const status = !starting ? 'Game ready.' : problem || (failed ? (code === undefined ? 'The game code could not load.' : 'The game could not initialize.') : expired ? 'The game is taking too long to start.' : 'Starting the game…');
    const nav = performance.getEntriesByType('navigation')[0];
    const scripts = performance.getEntriesByType('resource').filter(e => {
      if (!starting && e.responseEnd > ready) return false;
      const url = new URL(e.name);
      return url.origin === location.origin && url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js');
    });
    // Some embedded browsers hide Resource Timing sizes. A zero there is
    // not evidence that no bytes were needed, even on a same-origin chunk.
    const scriptSize = scripts.length && scripts.every(e => e.encodedBodySize > 0)
      ? Math.round(scripts.reduce((n, e) => n + e.encodedBodySize, 0) / 1024) + ' KiB' : 'size unavailable';
    const lines = [status,
      ...(nav?.responseStart > 0 ? ['Page response (first byte): ' + ms(nav.responseStart)] : []),
      'Menu: ' + (menu === undefined ? 'waiting for page scripts' : ms(menu) + ' from navigation'),
      'Engine import: ' + (code === undefined ? (request === undefined ? 'not requested' : 'waiting') : ms(code - request) + ' including script evaluation'),
      'Engage enabled: ' + (starting ? 'not yet' : ms(ready) + ' from navigation'),
      ...(last('title-submit') === undefined ? [] : ['Title scene submitted: ' + ms(last('title-submit')) + ' from navigation']),
      'Startup scripts: ' + scripts.length + ' (' + scriptSize + ')',
      'Preview: ' + document.visibilityState,
    ];
    const engage = last('engage'), retry = last('retry');
    const start = Math.max(engage ?? -1, retry ?? -1), playing = last('playing');
    if (start >= 0) {
      const action = start === retry ? 'Retry' : 'Engage';
      lines.push(action + ' → playing: ' +
        (playing >= start ? ms(playing - start) : last('run-failed') >= start ? 'failed' : last('cancelled') >= start ? 'cancelled' : 'preparing'));
      const frame = last('run-submit'), settled = last('run-settled'), cut = last('run-cut'), step = last('first-step');
      if (frame >= start) lines.push(action + ' → first covered scene submitted: ' + ms(frame - start));
      if (settled >= start) lines.push(action + ' → covered frames settled: ' + ms(settled - start));
      if (cut >= start && playing >= cut) lines.push('Cut → input unlocked: ' + ms(playing - cut));
      if (step >= start) lines.push(action + ' → first simulation frame submitted: ' + ms(step - start));
    }
    panel.querySelector('output').textContent = lines.join('\n');
  }
  window.addEventListener('error', event => {
    if (last('ready') !== undefined) return;
    if (event.target instanceof HTMLScriptElement && event.target.src) {
      const url = new URL(event.target.src);
      if (url.origin !== location.origin || !url.pathname.startsWith('/_next/static/')) return;
      problem = 'A game script failed to load: ' + url.pathname.split('/').pop();
    } else if (event.target === window) {
      problem ||= 'A script stopped before the game was ready.';
    }
    render();
  }, true);
  window.addEventListener('unhandledrejection', () => {
    if (last('ready') !== undefined) return;
    problem ||= 'Game initialization stopped unexpectedly.';
    render();
  });
  window.addEventListener('sr:boot', render);
  document.addEventListener('visibilitychange', render);
  setTimeout(() => { if (last('ready') === undefined) { expired = true; render(); } }, 12000);
  // A stalled script may also stall DOMContentLoaded. Delegate the controls
  // so they work as soon as the server-rendered report exists.
  document.addEventListener('click', async event => {
    const control = event.target instanceof Element && event.target.closest('#sr-boot-report a, #sr-boot-report button');
    if (!control) return;
    if (control instanceof HTMLAnchorElement) {
      const url = new URL(location.href);
      url.searchParams.set('_boot', Date.now().toString(36));
      control.href = url.href; // fresh HTML; retain preview options and saved progress
      return;
    }
    const text = document.querySelector('#sr-boot-report output');
    if (!text) return;
    try { await navigator.clipboard.writeText(text.textContent); control.textContent = 'Copied'; }
    catch {
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange(); range.selectNodeContents(text);
      selection.removeAllRanges(); selection.addRange(range);
      control.textContent = 'Selected — copy text';
    }
  });
  document.addEventListener('DOMContentLoaded', render, { once: true });
})();`
