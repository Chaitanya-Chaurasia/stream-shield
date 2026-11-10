const baseDomain = (h) => { const p = (h || '').split('.'); return p.length <= 2 ? h : p.slice(-2).join('.'); };
const $ = (id) => document.getElementById(id);
let current = null;

async function getSites() { const { sites = [] } = await chrome.storage.sync.get('sites'); return sites; }
async function setSites(sites) { await chrome.storage.sync.set({ sites: [...new Set(sites)].sort() }); render(); }

async function render() {
  const sites = await getSites();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { current = baseDomain(new URL(tab.url).hostname); } catch { current = null; }
  const webPage = current && /^https?:/.test(tab.url || '');
  $('site').textContent = webPage ? current : 'Not a web page';
  const t = $('toggle');
  if (webPage) {
    t.hidden = false;
    const on = sites.includes(current);
    t.textContent = on ? 'Stop protecting this site' : 'Protect this site';
    t.className = on ? 'on' : 'off';
    $('hint').textContent = on ? 'Reload the page after changes.' : 'Protection activates on the next page load.';
  } else { t.hidden = true; $('hint').textContent = ''; }

  const ul = $('list'); ul.innerHTML = '';
  for (const s of sites) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${s}</span><span class="x" title="remove">✕</span>`;
    li.querySelector('.x').onclick = () => setSites(sites.filter(x => x !== s));
    ul.appendChild(li);
  }
  const { stats = { total: 0, bySite: {} }, log = [] } = await chrome.storage.local.get(['stats', 'log']);
  $('total').textContent = stats.total;
  $('siteCount').textContent = (current && stats.bySite[current]) || 0;
  if (log[0]) $('last').textContent = `Last: ${log[0].kind} → ${log[0].detail}`;
}

$('toggle').onclick = async () => {
  const sites = await getSites();
  await setSites(sites.includes(current) ? sites.filter(s => s !== current) : [...sites, current]);
};
$('add').onclick = async () => {
  let v = $('manual').value.trim().toLowerCase();
  if (!v) return;
  try { v = new URL(v.includes('://') ? v : 'https://' + v).hostname; } catch {}
  v = baseDomain(v);
  await setSites([...(await getSites()), v]); $('manual').value = '';
};
render();
