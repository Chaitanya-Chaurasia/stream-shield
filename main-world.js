// Stream Shield - runs in the PAGE's JavaScript context before any site code.
// Job: make window.open useless for ad scripts, including the iframe bypass trick.
(() => {
  if (window.__streamShield) return;
  Object.defineProperty(window, '__streamShield', { value: true });

  const report = (kind, detail) => {
    try { window.postMessage({ __streamShield: true, kind, detail: String(detail || '').slice(0, 300) }, '*'); } catch {}
  };

  // A fake window object so ad scripts that do `w = window.open(); w.document.write(...)` don't crash
  // and don't notice anything went wrong.
  const makeDecoy = () => {
    const noop = () => {};
    const decoyDoc = { write: noop, writeln: noop, open: noop, close: noop, body: {}, createElement: () => ({}) };
    const decoy = {
      closed: false, opener: null, document: decoyDoc,
      location: { href: '', assign: noop, replace: noop, reload: noop },
      focus: noop, blur: noop, close: noop, moveTo: noop, resizeTo: noop,
      postMessage: noop, addEventListener: noop, removeEventListener: noop,
      setTimeout: noop, setInterval: noop
    };
    return new Proxy(decoy, { get: (t, k) => (k in t ? t[k] : noop) });
  };

  const guardedOpen = function (url) {
    report('window.open', url);
    return makeDecoy();
  };

  const lock = (target, label) => {
    try {
      Object.defineProperty(target, 'open', { value: guardedOpen, writable: false, configurable: false, enumerable: true });
    } catch { try { target.open = guardedOpen; } catch {} }
  };
  lock(window, 'window');

  // Bypass #1: grab a fresh window.open from a newly created iframe.
  const iframeProto = HTMLIFrameElement.prototype;
  const cwDesc = Object.getOwnPropertyDescriptor(iframeProto, 'contentWindow');
  if (cwDesc && cwDesc.get) {
    Object.defineProperty(iframeProto, 'contentWindow', {
      get() {
        const w = cwDesc.get.call(this);
        if (w) { try { if (w.open !== guardedOpen) lock(w, 'iframe'); } catch {} }
        return w;
      },
      configurable: true
    });
  }

  // Bypass #2: programmatic clicks on hidden <a target="_blank"> links.
  const realClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    if (this instanceof HTMLAnchorElement && this.target === '_blank') {
      report('anchor.click', this.href);
      return;
    }
    return realClick.apply(this, arguments);
  };

  // Bypass #3: form submission to a new tab (form.target=_blank, used by some popunder kits).
  const realSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (this.target === '_blank') { report('form.submit', this.action); return; }
    return realSubmit.apply(this, arguments);
  };
})();
