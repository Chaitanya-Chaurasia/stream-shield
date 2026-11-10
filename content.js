// Stream Shield - isolated-world content script.
// Job: kill transparent click-hijack overlays, block cross-site new-tab links, relay reports to background.
(() => {
  if (window.__streamShieldContent) return;
  window.__streamShieldContent = true;
  const site = baseDomain(location.hostname);
  const MARK = 'data-stream-shield';
  let blocked = 0;

  function baseDomain(h) { const p = h.split('.'); return p.length <= 2 ? h : p.slice(-2).join('.'); }

  function notify(kind, detail) {
    blocked++;
    try { chrome.runtime.sendMessage({ type: 'blocked', kind, detail, site }); } catch {}
  }

  // Relay reports from the MAIN-world script.
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__streamShield) notify(e.data.kind, e.data.detail);
  });

  // ---------- Overlay detection ----------
  function isTransparent(cs) {
    const op = parseFloat(cs.opacity);
    if (!isNaN(op) && op < 0.1) return true;
    const bg = cs.backgroundColor;
    const bgImg = cs.backgroundImage;
    const noBg = (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && (bgImg === 'none');
    return noBg;
  }

  function isOverlay(el) {
    if (!el || el === document.documentElement || el === document.body) return false;
    if (el.hasAttribute(MARK)) return false;
    const tag = el.tagName;
    if (tag === 'VIDEO' || tag === 'CANVAS' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return false;
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none' || cs.display === 'none' || cs.visibility === 'hidden') return false;
    const positioned = cs.position === 'fixed' || cs.position === 'absolute';
    if (!positioned) return false;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    const viewport = innerWidth * innerHeight;
    const big = area > viewport * 0.15;
    const z = parseInt(cs.zIndex, 10);
    const highZ = !isNaN(z) && z >= 100;
    const empty = !el.children.length && !(el.textContent || '').trim();

    // Case A: cross-site iframe parked over the content.
    if (tag === 'IFRAME') {
      let host = '';
      try { host = new URL(el.src, location.href).hostname; } catch {}
      const crossSite = host && baseDomain(host) !== site;
      return (crossSite || isTransparent(cs)) && (big || highZ);
    }
    // Case B: empty, see-through, positioned element with a high z-index or covering a big area.
    if (empty && isTransparent(cs) && (highZ || big)) return true;
    // Case C: empty element that is a link or has a click handler and covers a big area.
    if (empty && big && (tag === 'A' || el.onclick || el.getAttribute('onclick'))) return true;
    return false;
  }

  function neutralize(el, reason) {
    try {
      el.setAttribute(MARK, reason);
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('display', 'none', 'important');
      notify('overlay', `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''}`);
      toast('Stream Shield removed a hidden overlay. Click again.');
    } catch {}
  }

  // On the way down of every press, peel off overlays sitting under the cursor.
  function onPress(e) {
    if (!e.isTrusted) return;
    try { chrome.runtime.sendMessage({ type: 'gesture', site: window.top === window ? site : baseDomain((location.ancestorOrigins && location.ancestorOrigins.length) ? new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname : location.hostname) }); } catch {}
    let x = e.clientX, y = e.clientY, removed = false;
    for (let i = 0; i < 6; i++) {
      const el = document.elementFromPoint(x, y);
      if (!el) break;
      let hit = null;
      for (let n = el, d = 0; n && d < 4 && n !== document.body; n = n.parentElement, d++) {
        if (isOverlay(n)) { hit = n; break; }
      }
      if (!hit) break;
      neutralize(hit, 'press');
      removed = true;
    }
    if (removed) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  for (const t of ['pointerdown', 'mousedown', 'touchstart']) {
    document.addEventListener(t, onPress, true);
  }

  // Cross-site links. A real click on a real, visible link is user intent: hand it to the background,
  // which protects the destination and opens it itself. Anything else (synthetic click, invisible link,
  // link that is really an overlay) is an ad and gets blocked.
  const looksLikeRealLink = (a) => {
    const r = a.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const hasContent = (a.textContent || '').trim().length > 0 || a.querySelector('img, svg, picture, video');
    return hasContent && !isOverlay(a);
  };
  document.addEventListener('click', (e) => {
    if (e.button !== 0 && e.button !== undefined) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    let url; try { url = new URL(a.href, location.href); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || baseDomain(url.hostname) === site) return;
    e.preventDefault(); e.stopImmediatePropagation();
    // Only a link in the top-level page can be user intent. Links inside iframes are ads.
    if (window === window.top && e.isTrusted && looksLikeRealLink(a)) {
      const sameTab = a.target !== '_blank' && !e.metaKey && !e.ctrlKey;
      try { chrome.runtime.sendMessage({ type: 'follow', url: url.href, sameTab }); } catch {}
      toast('Stream Shield: opening ' + url.hostname + ' with protection');
    } else {
      notify('link', url.href);
      toast('Stream Shield blocked a link to ' + url.hostname);
    }
  }, true);

  // Catch overlays as soon as they are injected.
  const scan = (root) => {
    if (!(root instanceof Element)) return;
    const candidates = [root, ...root.querySelectorAll('div, a, span, iframe, section')];
    for (const el of candidates) if (isOverlay(el)) neutralize(el, 'inject');
  };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(scan);
      else if (m.type === 'attributes' && m.target instanceof Element && !m.target.hasAttribute(MARK) && isOverlay(m.target)) neutralize(m.target, 'style');
    }
  });
  const start = () => {
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    scan(document.body);
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });

  // ---------- Tiny toast ----------
  let toastEl, toastTimer;
  function toast(msg) {
    if (window !== window.top) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute(MARK, 'toast');
      Object.assign(toastEl.style, {
        position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483647', padding: '10px 14px',
        background: 'rgba(20,20,20,.92)', color: '#fff', font: '13px/1.3 system-ui, sans-serif',
        borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,.4)', pointerEvents: 'none', transition: 'opacity .3s'
      });
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.textContent = msg; toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2500);
  }
})();
