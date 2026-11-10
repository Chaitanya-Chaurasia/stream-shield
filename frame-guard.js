// Stream Shield - runs in every frame of every page, does nothing unless this is a third-party
// iframe inside a protected page. Then it asks the background to inject the guards here.
(() => {
  if (window === window.top) return;
  if (window.__streamShieldFrameAsked) return;
  window.__streamShieldFrameAsked = true;
  const origins = location.ancestorOrigins;
  const top = origins && origins.length ? origins[origins.length - 1] : document.referrer;
  if (!top) return;
  try { chrome.runtime.sendMessage({ type: 'guard-frame', top }); } catch {}
})();
