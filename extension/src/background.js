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

// ---------- Send to Team Lead: Microsoft sign-in + the company's Power Automate flow ----------
// The flow only accepts requests signed in with a mortgageusa.com Microsoft account ("Any user in my tenant"),
// so these three values aren't secrets. IT can also set them through Edge policy (managed storage).
const TL = {
  tenant: '',   // Directory (tenant) ID
  client: '',   // Application (client) ID of the "Vici Pitch Sheets" app registration
  flow: ''      // HTTP URL of the Pitch Sheet to Team Lead flow
};
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function tlConfig() {
  let m = {}; try { m = await chrome.storage.managed.get(null); } catch (e) {}
  const c = { tenant: m.tlTenant || TL.tenant, client: m.tlClient || TL.client, flow: m.flowUrl || TL.flow };
  c.ready = GUID.test(c.tenant) && GUID.test(c.client) && /^https:\/\/[^/]+\.(powerplatform\.com|logic\.azure\.com)(:\d+)?\//i.test(c.flow);
  return c;
}
const claimsOf = (jwt) => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; } };
// The access token lives only here, in memory for this browser session; the Vici page never sees it.
async function msToken(interactive) {
  const c = await tlConfig(); if (!c.ready) throw new Error('not-setup');
  const t = (await chrome.storage.session.get('tlTok')).tlTok;
  if (t && t.exp > Date.now() + 120000) return t;
  const hint = (await chrome.storage.local.get('tlUser')).tlUser || '';
  const state = crypto.randomUUID();
  const u = new URL('https://login.microsoftonline.com/' + c.tenant + '/oauth2/v2.0/authorize');
  const q = { client_id: c.client, response_type: 'token', redirect_uri: chrome.identity.getRedirectURL(), response_mode: 'fragment',
    scope: 'https://service.flow.microsoft.com//.default', state };
  if (hint) q.login_hint = hint;
  if (!interactive) q.prompt = 'none'; else if (!hint) q.prompt = 'select_account';
  Object.keys(q).forEach((k) => u.searchParams.set(k, q[k]));
  const back = await chrome.identity.launchWebAuthFlow({ url: u.href, interactive: !!interactive });
  const f = new URLSearchParams(new URL(back).hash.slice(1));
  if (f.get('error')) throw new Error(f.get('error'));
  if (f.get('state') !== state || !f.get('access_token')) throw new Error('sign-in failed');
  const at = f.get('access_token'), cl = claimsOf(at);
  if (cl.tid && cl.tid.toLowerCase() !== c.tenant.toLowerCase()) throw new Error('wrong-tenant');
  const tok = { at, exp: Date.now() + (parseInt(f.get('expires_in'), 10) || 3600) * 1000, user: cl.upn || cl.unique_name || cl.preferred_username || '' };
  await chrome.storage.session.set({ tlTok: tok }); await chrome.storage.local.set({ tlUser: tok.user });
  return tok;
}
async function tlHandle(m) {
  const c = await tlConfig();
  const user = (await chrome.storage.local.get('tlUser')).tlUser || '';
  if (m.t === 'tl-status') return { setup: c.ready, user };
  if (m.t === 'tl-signout') { await chrome.storage.session.remove('tlTok'); await chrome.storage.local.remove('tlUser'); return { setup: c.ready, user: '' }; }
  if (m.t === 'tl-signin') { const tok = await msToken(true); return { setup: true, user: tok.user }; }
  if (m.t === 'tl-send') {
    let tok; try { tok = await msToken(false); } catch (e) { if (e.message === 'not-setup') throw e; tok = await msToken(true); }
    const r = await fetch(c.flow, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok.at }, body: JSON.stringify(m.payload) });
    if (r.status === 401 || r.status === 403) await chrome.storage.session.remove('tlTok');
    return { status: r.status, user: tok.user };
  }
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || !sender.tab) return;
  if (/^tl-/.test(m.t)) { tlHandle(m).then(reply, (e) => reply({ error: String(e && e.message || e) })); return true; }
  if (m.t === 'xhr') {
    let host = '';
    try { host = new URL(m.url).hostname; } catch (e) {}
    if (!ALLOWED.includes(host)) { reply({ error: 'blocked host' }); return; }
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
