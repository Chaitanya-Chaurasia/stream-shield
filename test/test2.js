// Realistic path: match page -> click a stream row -> land on the stream host -> click the player.
const puppeteer = require('puppeteer-core'); const path = require('path'); const fs = require('fs');
const EXT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MATCH = process.argv[2]; const withExt = !process.argv.includes('--no-ext');
const protectHosts = process.argv.includes('--protect-hosts'); // also add the stream host to the protected list
const base = (h) => { const p = (h || '').split('.'); return p.length <= 2 ? h : p.slice(-2).join('.'); };
const host = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const R = { withExt, protectHosts, tabs: [], notes: [] };
const log = (s) => { R.notes.push(s); console.log(s); };

(async () => {
  const profile = fs.mkdtempSync('/tmp/ss-prof-');
  const args = ['--no-first-run', '--no-default-browser-check', '--window-size=1366,900', `--user-data-dir=${profile}`];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: false, args, pipe: true, enableExtensions: withExt, defaultViewport: { width: 1366, height: 800 } });
  if (withExt) { const id = await browser.installExtension(EXT); R.notes.push('installed extension ' + id); }
  const tracked = new WeakSet();
  const track = async (t) => {
    if (t.type() !== 'page') return;
    const rec = { urls: [t.url()], closed: false, opened: Date.now() }; R.tabs.push(rec);
    try { const p = await t.page(); if (!p) return; p.on('framenavigated', f => { if (f === p.mainFrame()) rec.urls.push(f.url()); }); p.on('close', () => { rec.closed = true; rec.lifeMs = Date.now() - rec.opened; }); p.on('dialog', d => d.dismiss().catch(() => {})); } catch {}
  };
  browser.on('targetcreated', track);

  let extId = null, setSites = async () => {};
  if (withExt) {
    const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 15000 }).catch(() => null);
    if (!sw) log('!! extension service worker never appeared');
    else {
      extId = new URL(sw.url()).host;
      setSites = async (sites) => { const c = await browser.newPage(); await c.goto(`chrome-extension://${extId}/popup.html`); await c.evaluate((s) => chrome.storage.sync.set({ sites: s }), sites); await c.evaluate(() => chrome.storage.local.set({ stats: { total: 0, bySite: {} }, log: [] })); await sleep(1500); await c.close(); };
      await setSites([base(host(MATCH))]);
    }
  }
  const page = (await browser.pages())[0];
  page.on('dialog', d => d.dismiss().catch(() => {}));
  R.tabs.length = 0;

  await page.goto(MATCH, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log('goto ' + e.message));
  await sleep(3000);
  if (withExt) log('MAIN-world guard on match page: ' + await page.evaluate(() => !!window.__streamShield).catch(() => 'err'));

  // Stream rows = external links with target=_blank and visible size
  const rows = await page.evaluate((s) => [...document.querySelectorAll('a[href]')].filter(a => { try { const u = new URL(a.href); return !u.hostname.endsWith(s) && !/t\.me|dmca/.test(u.hostname) && a.target === '_blank' && a.getBoundingClientRect().width > 300; } catch { return false; } }).slice(0, 3).map(a => { const r = a.getBoundingClientRect(); return { href: a.href, t: a.textContent.trim().slice(0, 25), x: r.left + r.width / 2, y: r.top + r.height / 2 + scrollY }; }), base(host(MATCH)));
  log(`Stream rows found: ${rows.map(r => r.t + ' -> ' + host(r.href)).join(' | ')}`);
  if (!rows.length) { await browser.close(); return; }

  const row = rows[parseInt(process.env.ROW || "0", 10)] || rows[0];
  await page.evaluate((y) => scrollTo(0, y - 300), row.y);
  await sleep(500);
  const yOnScreen = row.y - (await page.evaluate(() => scrollY));
  const before = R.tabs.length, beforeUrl = page.url();
  await page.mouse.click(row.x, yOnScreen);
  await sleep(6000);
  const spawned = R.tabs.slice(before);
  log(`Clicked stream row "${row.t}" (${host(row.href)}): ${spawned.length} new tab(s); main tab now ${page.url() === beforeUrl ? 'unchanged' : page.url()}`);
  spawned.forEach((t, i) => log(`  tab${i + 1}: ${t.urls.filter(Boolean).join(' -> ')}${t.closed ? ` [CLOSED by ext after ${t.lifeMs}ms]` : ''}`));

  // Find the stream host tab (may have been opened by click, or we navigate directly if blocked)
  let hostPage = null;
  for (const p of await browser.pages()) if (base(host(p.url())) === base(host(row.href)) && !p.isClosed()) hostPage = p;
  if (!hostPage) { log(`Stream host tab not open (blocked?). Navigating main tab to ${row.href} to test the host itself.`); hostPage = page; }
  const hostSite = base(host(row.href));
  if (withExt && protectHosts) { await setSites([base(host(MATCH)), hostSite]); log(`Added ${hostSite} to protected list`); }
  if (hostPage === page || (withExt && protectHosts)) { await hostPage.goto(row.href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log('goto host ' + e.message)); }
  await hostPage.bringToFront(); await sleep(5000);
  hostPage.on('dialog', d => d.dismiss().catch(() => {}));
  log(`On stream host: ${hostPage.url()}`);
  if (withExt) log('MAIN-world guard on host page: ' + await hostPage.evaluate(() => !!window.__streamShield).catch(() => 'err'));
  const layout = await hostPage.evaluate(() => {
    const ifr = [...document.querySelectorAll('iframe')].map(f => { const r = f.getBoundingClientRect(); return { src: (f.src || '').slice(0, 100), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
    const big = [...document.querySelectorAll('*')].filter(el => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return (cs.position === 'fixed' || cs.position === 'absolute') && r.width * r.height > innerWidth * innerHeight * 0.1; }).map(el => { const cs = getComputedStyle(el); return { tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 40), z: cs.zIndex, op: cs.opacity, bg: cs.backgroundColor, kids: el.children.length }; }).slice(0, 8);
    return { iframes: ifr, bigPositioned: big, scripts: [...new Set([...document.scripts].map(s => s.src && new URL(s.src).hostname).filter(Boolean))] };
  }).catch(e => ({ err: e.message }));
  log('Host layout: ' + JSON.stringify(layout));
  const player = (layout.iframes || []).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const px = player ? player.x : 683, py = player ? Math.min(player.y, 780) : 400;
  for (let i = 1; i <= 4; i++) {
    const b4 = R.tabs.length, u4 = hostPage.url();
    await hostPage.mouse.click(px, py).catch(e => log('click err ' + e.message));
    await sleep(5000);
    const sp = R.tabs.slice(b4);
    log(`Host player click #${i} @(${px},${py}): ${sp.length} new tab(s)${hostPage.url() !== u4 ? ` HOST TAB NAVIGATED -> ${hostPage.url()}` : ''}`);
    sp.forEach((t, j) => log(`  tab${j + 1}: ${t.urls.filter(Boolean).join(' -> ')}${t.closed ? ` [CLOSED by ext after ${t.lifeMs}ms]` : ''}`));
    if (base(host(hostPage.url())) !== hostSite) { await hostPage.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(2000); }
  }
  if (withExt) {
    const marked = await hostPage.evaluate(() => [...document.querySelectorAll('[data-stream-shield]')].map(e => e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 40) + '=' + e.getAttribute('data-stream-shield'))).catch(() => []);
    log('Neutralised by ext on host page: ' + JSON.stringify(marked));
    const c = await browser.newPage(); await c.goto(`chrome-extension://${extId}/popup.html`);
    const d = await c.evaluate(() => chrome.storage.local.get(['stats', 'log'])); await c.close();
    log('Extension block log: ' + JSON.stringify(d.log || []));
  }
  const stillOpen = (await browser.pages()).map(p => p.url()).filter(u => u && !/^about:|^chrome/.test(u) && ![base(host(MATCH)), hostSite].includes(base(host(u))));
  log(`STILL OPEN off-site tabs at end: ${stillOpen.length} ${JSON.stringify(stillOpen.map(u => host(u)))}`);
  const offsite = R.tabs.filter(t => t.urls.some(u => u && !/^about:|^chrome/.test(u) && ![base(host(MATCH)), hostSite].includes(base(host(u)))));
  log(`SUMMARY: tabs spawned=${R.tabs.length}, off-site tabs=${offsite.length}, auto-closed=${R.tabs.filter(t => t.closed).length}, offsite domains=${[...new Set(offsite.flatMap(t => t.urls).map(host).filter(h => h && ![base(host(MATCH)), hostSite].includes(base(h))))].join(', ')}`);
  fs.writeFileSync(`report2-${withExt ? (protectHosts ? 'ext-hosts' : 'ext') : 'noext'}.json`, JSON.stringify(R, null, 2));
  await browser.close(); fs.rmSync(profile, { recursive: true, force: true });
})().catch(e => { console.error('FATAL', e); process.exit(1); });
