// Stream Shield - service worker.
// Jobs: register content scripts for protected sites, close escaped pop-up tabs, keep counters.

const baseDomain = (h) => { const p = (h || '').split('.'); return p.length <= 2 ? h : p.slice(-2).join('.'); };
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

async function getSites() {
  const { sites = [] } = await chrome.storage.sync.get('sites');
  const { followed = [] } = await chrome.storage.session.get('followed');
  return [...new Set([...sites, ...followed])];
}

async function registerScripts(sites) {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map(s => s.id) });
  if (!sites.length) return;
  const matches = sites.flatMap(s => [`*://${s}/*`, `*://*.${s}/*`]);
  await chrome.scripting.registerContentScripts([
    { id: 'ss-main', js: ['main-world.js'], matches, runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, world: 'MAIN', persistAcrossSessions: false },
    { id: 'ss-isolated', js: ['content.js'], matches, runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, world: 'ISOLATED', persistAcrossSessions: false },
    // Third-party ad iframes inside a protected page: this tiny script asks us to inject the guards into them.
    { id: 'ss-frames', js: ['frame-guard.js'], matches: ['<all_urls>'], runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, world: 'ISOLATED', persistAcrossSessions: false }
  ]);
}

// A site the user deliberately navigated to from a protected site inherits protection for this browser session.
async function follow(hostname) {
  const site = baseDomain(hostname);
  const { followed = [] } = await chrome.storage.session.get('followed');
  if (followed.includes(site)) return site;
  await chrome.storage.session.set({ followed: [...followed, site] });
  await registerScripts(await getSites());
  return site;
}

chrome.runtime.onInstalled.addListener(async () => registerScripts(await getSites()));
chrome.runtime.onStartup.addListener(async () => registerScripts(await getSites()));
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.sites) registerScripts(await getSites());
});

// ---------- User intent: links the user really clicked ----------
// Content script intercepts a trusted click on a cross-site link, we open it ourselves so we can
// (a) protect the destination before it loads and (b) tell it apart from pop-unders riding the same click.
const intents = new Map(); // site -> expiry
const allowIntent = (site) => intents.set(site, Date.now() + 8000);
const hasIntent = (site) => (intents.get(site) || 0) > Date.now();

// ---------- Escaped pop-up tabs ----------
// Any tab opened FROM a protected tab is a suspect for 15 seconds. If it lands on a different site, close it.
const suspects = new Map(); // tabId -> { site, until }
const protectedTabs = new Map(); // tabId -> site

async function isProtectedUrl(url) {
  const h = hostOf(url); if (!h) return null;
  const b = baseDomain(h);
  const sites = await getSites();
  return sites.includes(b) ? b : null;
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url && !tab.url) return;
  const site = await isProtectedUrl(info.url || tab.url);
  if (site) protectedTabs.set(tabId, site); else protectedTabs.delete(tabId);
});
chrome.tabs.onRemoved.addListener((id) => { protectedTabs.delete(id); suspects.delete(id); });

// Last user gesture on a protected tab (pop-ups opened with rel=noopener carry no openerTabId).
let lastGesture = { site: null, windowId: null, at: 0 };

chrome.tabs.onCreated.addListener(async (tab) => {
  let site = null;
  if (tab.openerTabId != null) {
    site = protectedTabs.get(tab.openerTabId);
    if (!site) { try { const opener = await chrome.tabs.get(tab.openerTabId); site = await isProtectedUrl(opener.url || opener.pendingUrl); } catch {} }
  }
  if (!site && lastGesture.site && Date.now() - lastGesture.at < 3000 && (tab.windowId === lastGesture.windowId || tab.windowId == null)) {
    site = lastGesture.site; // opened with no opener right after a click on a protected tab
  }
  if (!site) return;
  suspects.set(tab.id, { site, until: Date.now() + 15000 });
  await judge(tab.id, tab.pendingUrl || tab.url, site);
});

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url, transitionType, transitionQualifiers }) => {
  if (frameId !== 0) return;
  const s = suspects.get(tabId);
  if (s) {
    if (Date.now() > s.until) suspects.delete(tabId); else { await judge(tabId, url, s.site); return; }
  }
  // Redirect guard: a protected tab got pushed to another site without the user asking. Go back.
  const from = protectedTabs.get(tabId);
  if (!from) return;
  const b = baseDomain(hostOf(url));
  if (!b || b === from) return;
  if (hasIntent(b) || (await getSites()).includes(b)) return;
  const q = transitionQualifiers || [];
  const pushed = ['link', 'client_redirect', 'auto_subframe', 'manual_subframe'].includes(transitionType) || q.includes('client_redirect') || q.includes('server_redirect');
  if (!pushed) return;
  try { await chrome.tabs.goBack(tabId); } catch { try { await chrome.tabs.update(tabId, { url: `https://${from}/` }); } catch {} }
  await bump('redirect', url, from, tabId);
});

async function judge(tabId, url, site) {
  if (!url || url === 'about:blank' || url.startsWith('chrome')) return;
  const h = hostOf(url);
  const b = baseDomain(h);
  if (!h || b === site) { suspects.delete(tabId); return; } // same site, user probably meant it
  if (hasIntent(b) || (await getSites()).includes(b)) { suspects.delete(tabId); return; } // user asked for this
  try { await chrome.tabs.remove(tabId); } catch {}
  suspects.delete(tabId);
  await bump('tab', url, site);
}

// ---------- Counters & badge ----------
async function bump(kind, detail, site, tabId) {
  const { stats = { total: 0, bySite: {} }, log = [] } = await chrome.storage.local.get(['stats', 'log']);
  stats.total++; stats.bySite[site] = (stats.bySite[site] || 0) + 1;
  log.unshift({ t: Date.now(), kind, detail: String(detail).slice(0, 200), site });
  await chrome.storage.local.set({ stats, log: log.slice(0, 200) });
  if (tabId != null) {
    const { tabCounts = {} } = await chrome.storage.session.get('tabCounts');
    tabCounts[tabId] = (tabCounts[tabId] || 0) + 1;
    await chrome.storage.session.set({ tabCounts });
    chrome.action.setBadgeText({ tabId, text: String(tabCounts[tabId]) });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#c0392b' });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  const tabId = sender.tab && sender.tab.id;
  if (msg.type === 'blocked') bump(msg.kind, msg.detail, msg.site, tabId);
  if (msg.type === 'gesture' && sender.tab) lastGesture = { site: protectedTabs.get(tabId) || msg.site, windowId: sender.tab.windowId, at: Date.now() };
  if (msg.type === 'follow') {
    (async () => {
      const h = hostOf(msg.url); if (!h) return;
      const site = await follow(h);
      allowIntent(site);
      if (msg.sameTab) await chrome.tabs.update(tabId, { url: msg.url });
      else await chrome.tabs.create({ url: msg.url, openerTabId: tabId, active: true });
    })();
  }
  if (msg.type === 'guard-frame') {
    // A third-party iframe inside a protected page asked for the guards.
    (async () => {
      const top = baseDomain(hostOf(msg.top));
      if (!(await getSites()).includes(top)) { sendResponse(false); return; }
      const target = { tabId, frameIds: [sender.frameId] };
      try { await chrome.scripting.executeScript({ target, files: ['main-world.js'], world: 'MAIN', injectImmediately: true }); } catch {}
      try { await chrome.scripting.executeScript({ target, files: ['content.js'], world: 'ISOLATED', injectImmediately: true }); } catch {}
      sendResponse(true);
    })();
    return true;
  }
});
