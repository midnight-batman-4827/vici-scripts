// Background service worker: does the cross-site requests the content script can't
// (what Tampermonkey's GM_xmlhttpRequest did), and opens/closes the Homes.com helper tab.

// Only these sites may be fetched – the same list as host_permissions in manifest.json
const ALLOWED = ['www.zillowstatic.com', 'parser-external.geo.moveaws.com', 'www.zillow.com', 'www.trulia.com', 'www.realtor.com'];

// Zillow's value-history endpoint expects requests to come from zillow.com
async function setHeaderRules() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [
          { header: 'Origin', operation: 'set', value: 'https://www.zillow.com' },
          { header: 'Referer', operation: 'set', value: 'https://www.zillow.com/' }] },
        condition: { requestDomains: ['www.zillow.com'], tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] }
      }]
    });
  } catch (e) { /* header rule is best-effort */ }
}
chrome.runtime.onInstalled.addListener(setHeaderRules);
chrome.runtime.onStartup.addListener(setHeaderRules);
setHeaderRules();

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || !sender.tab) return;
  if (m.t === 'xhr') {
    let host = '';
    try { host = new URL(m.url).hostname; } catch (e) {}
    const flow = m.method === 'POST' && /\.(powerplatform\.com|logic\.azure\.com)$/.test(host);   // Send to Team Lead flow
    if (!ALLOWED.includes(host) && !flow) { reply({ error: 'blocked host' }); return; }
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), m.timeout || 20000);
    fetch(m.url, { method: m.method || 'GET', headers: m.headers || {}, body: m.data, credentials: 'include', signal: ctl.signal })
      .then(async (r) => { clearTimeout(tm); reply({ status: r.status, text: await r.text() }); })
      .catch((e) => { clearTimeout(tm); reply(e && e.name === 'AbortError' ? { timeout: true } : { error: String(e) }); });
    return true; // answer comes later
  }
  if (m.t === 'open') {
    if (!/^https:\/\/www\.homes\.com\//.test(m.url)) { reply({}); return; }
    chrome.tabs.create({ url: m.url, active: !!m.active, openerTabId: sender.tab.id }, (t) => reply({ id: t && t.id }));
    return true;
  }
  if (m.t === 'close' && m.id) { chrome.tabs.remove(m.id).catch(() => {}); }
});
