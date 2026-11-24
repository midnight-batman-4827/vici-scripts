// ==UserScript==
// @name         Vici Property Lookup
// @namespace    mortgageusa.vici
// @version      12.4
// @description  ZILLOW / REALTOR / HOMES.COM / TRULIA tabs (next to SCRIPT 2) with each site's facts about the home
// @match        *://mtgusa.talkitpro.com/agc/*
// @match        *://www.homes.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @connect      www.zillowstatic.com
// @connect      parser-external.geo.moveaws.com
// @connect      www.zillow.com
// @connect      www.trulia.com
// @connect      www.realtor.com
// @run-at       document-idle
// @homepageURL  https://github.com/midnight-batman-4827/vici-scripts
// @updateURL    https://raw.githubusercontent.com/midnight-batman-4827/vici-scripts/main/vici-property-lookup.user.js
// @downloadURL  https://raw.githubusercontent.com/midnight-batman-4827/vici-scripts/main/vici-property-lookup.user.js
// ==/UserScript==

(function () {
  'use strict';
  // The same code runs as a Tampermonkey script and as the Edge extension. If a PC has both,
  // the extension wins and the Tampermonkey copy steps aside (the extension marks the page).
  const IS_EXT = typeof __VP_EXT !== 'undefined';
  const stepAside = () => !IS_EXT && document.documentElement.hasAttribute('data-vprop-ext');

function readHomesPage(doc) {
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const money = (s) => { const m = String(s || '').match(/\$[\d,]+(\.\d+)?/); return m ? parseFloat(m[0].replace(/[$,]/g, '')) : null; };
  const out = { photos: [], highlights: [], groups: [], priceHistory: [], taxHistory: [] };

  // structured listing block: beds, baths, size, year, type, photos
  let ent = null;
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      const j = JSON.parse(s.textContent);
      (j['@graph'] || [j]).forEach((n) => { if (!ent && n && n.mainEntity && n.mainEntity.address) ent = n.mainEntity; });
    } catch (e) {}
  });
  if (ent) {
    out.beds = ent.numberOfBedrooms; out.baths = ent.numberOfBathroomsTotal;
    out.sqft = ent.floorSize && ent.floorSize.value; out.yearBuilt = ent.yearBuilt || '';
    out.type = ent.accommodationCategory || ent['@type'] || '';
    out.street = ent.address && ent.address.streetAddress; out.city = ent.address && ent.address.addressLocality;
    out.photos = (ent.image || []).map((i) => (typeof i === 'string' ? i : i.url)).filter(Boolean).map((u) => ({ full: u, thumb: u, caption: '' }));
  }

  out.status = txt(doc.querySelector('.property-info-status-pill'));
  out.estimate = money(txt(doc.querySelector('.property-estimated-info')));
  out.listPrice = money(txt(doc.querySelector('.property-info-price')));
  doc.querySelectorAll('.content-widget-detail').forEach((el) => {
    const t = txt(el);
    let m = t.match(/Date Sold:\s*(.+)$/i); if (m) out.soldDate = m[1];
    m = t.match(/Last sale price\s*(\$[\d,]+)/i); if (m) out.soldPrice = money(m[1]);
  });

  doc.querySelectorAll('li.highlight .highlight-value').forEach((el) => { const t = txt(el); if (t) out.highlights.push(t); });
  doc.querySelectorAll('.subcategory').forEach((sc) => {
    const name = txt(sc.querySelector('.amenity-name'));
    const vals = [...sc.querySelectorAll('li.amenities-detail')].map(txt).filter(Boolean);
    if (name && vals.length) out.groups.push([name, vals]);
  });

  doc.querySelectorAll('table.price-table tbody tr').forEach((tr) => {
    out.priceHistory.push({ date: txt(tr.querySelector('.long-date')) || txt(tr.querySelector('th')), event: txt(tr.querySelector('.price-event')), price: money(txt(tr.querySelector('.price-price'))) });
  });
  // Mortgage History: recorded loans (original amounts), Open = still on the home
  out.mortgages = [];
  doc.querySelectorAll('table.mortgage-table tbody tr').forEach((tr) => {
    const b = tr.querySelector('.mortgage-borrower');
    out.mortgages.push({ date: txt(tr.querySelector('.shorter-date')) || txt(tr.querySelector('th')), status: txt(tr.querySelector('.mortgage-status')),
      borrower: b && b.querySelector('.sign-in-pill') ? '' : txt(b), amount: money(txt(tr.querySelector('.mortgage-amount'))) });
  });
  // Ownership History: date range, name (blank when Homes.com hides it behind sign-in), owned for, owner type
  out.ownership = [];
  doc.querySelectorAll('.ownership-history-container .accordion-button').forEach((row) => {
    const c = [...row.querySelectorAll('.accordion-item')];
    if (c.length < 3) return;
    out.ownership.push({ dates: txt(c[0]), name: c[1].querySelector('.sign-in-pill') ? '' : txt(c[1]), ownedFor: txt(c[2]), type: txt(c[3]) });
  });
  doc.querySelectorAll('table.tax-table tbody tr').forEach((tr) => {
    out.taxHistory.push({ year: txt(tr.querySelector('.tax-year')), tax: money(txt(tr.querySelector('.tax-amount'))), value: money(txt(tr.querySelector('.tax-assessment'))),
      land: money(txt(tr.querySelector('.tax-land'))), improvement: money(txt(tr.querySelector('.tax-improvement'))) });
  });
  return out;
}

  // also the photos shown in the page's own gallery
  function homesPhotos(doc, list) {
    const seen = new Set(list.map((p) => p.full));
    doc.querySelectorAll('img[src*="images.homes.com/listings"], img[data-src*="images.homes.com/listings"]').forEach((im) => {
      const u = im.getAttribute('data-src') || im.src;
      if (u && !seen.has(u) && !/logo|agent|headshot/i.test(u)) { seen.add(u); list.push({ full: u, thumb: u, caption: '' }); }
    });
    return list;
  }

  // Runs on homes.com ONLY in a background tab the Vici script opened (marked #vprop-<id>);
  // types the lead's address into Homes.com's search box, picks the matching suggestion,
  // reads the property page and hands the data back to the Vici tab.
  function homesWorker() {
    const hashId = (location.hash.match(/^#vprop-(\d+)/) || [])[1];
    if (hashId) sessionStorage.setItem('vpropJob', hashId);
    const id = sessionStorage.getItem('vpropJob');
    const job = GM_getValue('vpHomesJob', null);
    if (!id || !job || String(job.id) !== id || Date.now() - job.t > 90000) return; // normal browsing: do nothing
    // Tell the agent what this window is, so they don't close it mid-lookup
    const notice = () => {
      if (document.getElementById('vprop-homes-notice')) return;
      const n = document.createElement('div');
      n.id = 'vprop-homes-notice';
      n.setAttribute('role', 'status');
      n.innerHTML = `<style>@keyframes vprop-spin{to{transform:rotate(360deg)}}</style>
        <div style="width:28px;height:28px;border:3px solid #ffd9c7;border-top-color:#f25c05;border-radius:50%;animation:vprop-spin .8s linear infinite;flex:none"></div>
        <div><div style="font-weight:700;font-size:16px;margin-bottom:2px">Gathering Homes.com info for Vici. Please wait.</div>
        <div style="font-size:14px">Don't close this window. It closes by itself in a few seconds.</div></div>`;
      Object.assign(n.style, { position: 'fixed', zIndex: 2147483647, left: '12px', right: '12px', top: '12px', display: 'flex', alignItems: 'center', gap: '14px',
        padding: '14px 18px', background: '#fff', color: '#222', border: '2px solid #f25c05', borderRadius: '10px', boxShadow: '0 6px 24px rgba(0,0,0,.25)',
        font: '14px/1.35 Arial, sans-serif', pointerEvents: 'none' });
      (document.body || document.documentElement).appendChild(n);
    };
    notice();
    if (!document.body) document.addEventListener('DOMContentLoaded', notice);
    const finish = (payload) => {
      GM_setValue('vpHomesResult', Object.assign({ id: job.id }, payload));
      sessionStorage.removeItem('vpropJob');
      setTimeout(() => window.close(), 300);
    };
    // Wait for something to appear on the page. Uses a MutationObserver, which keeps working
    // in background windows/tabs where Edge slows timers down.
    const waitFor = (find, ms) => new Promise((resolve) => {
      const hit = find(); if (hit) return resolve(hit);
      const obs = new MutationObserver(() => { const h = find(); if (h) { obs.disconnect(); clearTimeout(tm); resolve(h); } });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const tm = setTimeout(() => { obs.disconnect(); resolve(find()); }, ms);
    });
    const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    (async () => {
      if (/^\/property\//.test(location.pathname)) {
        // property page: read it as soon as its main sections are in place
        await waitFor(() => document.querySelector('.property-info-status-pill, table.price-table, .property-estimated-info'), 15000);
        const d = readHomesPage(document);
        d.photos = homesPhotos(document, d.photos);
        return finish({ ok: true, url: location.href.split('#')[0], data: d });
      }
      // home page: type the address the way a person would and pick Homes.com's matching suggestion
      const input = await waitFor(() => [...document.querySelectorAll('input[type="text"], input:not([type])')]
        .find((el) => /place|address|city/i.test((el.getAttribute('aria-label') || '') + (el.placeholder || ''))), 20000);
      if (!input) return finish({ ok: false, why: 'search box not found' });
      const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      input.focus();
      setVal.call(input, job.query);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'r' }));
      // match on house number + city ("8615 West 81 st Street" vs "8615 W 81st St" both start 8615)
      const num = (norm(job.street).match(/^\d+[a-z]?/) || [''])[0];
      const city = norm(job.city);
      // join the suggestion's pieces ("104 Holland Trl" + "Pelham, AL 35124" + "Address") so words don't run together
      const btnText = (b) => {
        const parts = [...b.querySelectorAll('*')].filter((e) => !e.children.length).map((e) => e.textContent.trim()).filter(Boolean);
        return (parts.length ? parts.join(', ') : String(b.textContent || '')).replace(/\s+/g, ' ');
      };
      const addrBtns = () => [...document.querySelectorAll('button.suggestion-btn')].filter((b) => /address/.test(norm(btnText(b))));
      const label = (b) => btnText(b).replace(/[,\s]*Address[,\s]*$/i, '').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
      const isHit = (b) => {
        const t = norm(btnText(b));
        if (job.pick) return t.startsWith(norm(job.pick));
        return t.startsWith(num + ' ') && (!city || t.includes(city));
      };
      let btn = await waitFor(() => addrBtns().find(isHit), job.pick ? 20000 : 6000);
      if (!btn && !job.pick) {
        // no exact suggestion: let the list finish filling, then offer the ones in the same State + ZIP
        await waitFor(() => addrBtns().length >= 3 && null, 3000);
        btn = addrBtns().find(isHit);
        if (!btn) {
          const area = new RegExp('\\b' + String(job.state || '').toLowerCase() + ' ' + String(job.zip || '') + '\\b');
          const near = [...new Set(addrBtns().filter((b) => area.test(norm(btnText(b)))).map(label))].slice(0, 5);
          return finish({ ok: false, why: 'no exact address match on Homes.com', near });
        }
      }
      if (!btn) return finish({ ok: false, why: 'no matching address on Homes.com' });
      btn.click(); // the page navigates to the property; this helper runs again there
    })();
  }

  if (/(^|\.)homes\.com$/.test(location.hostname)) { setTimeout(() => { if (!stepAside()) homesWorker(); }, IS_EXT ? 0 : 1500); return; }


  // =====================================================================
  //  Read the lead
  // =====================================================================
  const field = (name) => document.getElementById(name) ||
    document.querySelector(`[name="${name}"]`);
  const val = (n) => ((field(n) || {}).value || '').trim();

  // All four must be filled in and valid, otherwise nothing is looked up
  function getAddress() {
    const street = val('address1').replace(/\s+/g, ' ');
    const city = val('city').replace(/\s+/g, ' ');
    const state = val('state').toUpperCase();
    const zip = val('postal_code').replace(/\D/g, '').slice(0, 5);
    const missing = [];
    if (!/^\d+\S*\s+\S/.test(street)) missing.push('Address');
    if (!city) missing.push('City');
    if (!/^[A-Z]{2}$/.test(state)) missing.push('State');
    if (zip.length !== 5) missing.push('ZIP');
    const full = `${street}, ${city}, ${state} ${zip}`;
    return { street, city, state, zip, missing, full };
  }

  // Read a lead field by its on-screen label (Loan Amount / Value are relabeled Vici fields)
  function byLabel(re) {
    // Mortgageusa's Vici keeps Loan Amount in address2 and Value in province
    const direct = /Loan/.test(re.source) ? 'address2' : /Value/.test(re.source) ? 'province' : '';
    if (direct && document.getElementById(direct)) return document.getElementById(direct).value;
    for (const td of document.querySelectorAll('td, th, font, span, b')) {
      if (td.closest('#vprop-screen')) continue;
      if (td.children.length > 2 || !re.test((td.textContent || '').trim())) continue;
      let el = td;
      for (let i = 0; i < 3 && el; i++) {
        el = el.nextElementSibling || (el.parentElement && el.parentElement.nextElementSibling);
        const inp = el && (el.matches && el.matches('input') ? el : el.querySelector && el.querySelector('input'));
        if (inp) return inp.value;
      }
    }
    return '';
  }

  // =====================================================================
  //  Address matching + lookups
  // =====================================================================
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const houseNum = (s) => (norm(s).match(/^\d+[a-z]?/) || [''])[0];
  // First real word of the street name, ignoring directions (East = E, North = N, …)
  // so "21161 East 63rd Drive" matches "21161 E 63rd Dr"
  const DIRS = /^(n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)$/;
  const firstWord = (s) => norm(s).split(' ').slice(1).find((w) => !DIRS.test(w)) || '';

  // Street number, first street word, city, state and ZIP must all agree
  function sameProperty(a, line, city, state, zip) {
    return houseNum(a.street) === houseNum(line) &&
      firstWord(a.street) === firstWord(line) &&
      norm(a.city) === norm(city) &&
      a.state === String(state || '').toUpperCase() &&
      a.zip === String(zip || '').slice(0, 5);
  }

  function gmGet(url, accept) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: 15000,
        headers: accept ? { Accept: accept } : {},
        onload: (r) => resolve({ status: r.status, text: r.responseText || '' }),
        onerror: () => resolve({ status: 0, text: '' }),
        ontimeout: () => resolve({ status: 0, text: '' })
      });
    });
  }
  const getJSON = async (url) => { try { return JSON.parse((await gmGet(url)).text); } catch (e) { return null; } };

  // How close a suggestion is to the lead: house number and street count most, city least.
  // Only used to rank "close matches"; State and ZIP must already agree.
  function lev(x, y) {
    if (x === y) return 0;
    const d = Array.from({ length: x.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return d[x.length][y.length];
  }
  function closeness(a, line, city) {
    const n1 = houseNum(a.street), n2 = houseNum(line), w1 = firstWord(a.street), w2 = firstWord(line);
    let sc = 0;
    if (n1 && n1 === n2) sc += 4; else if (n1 && n2 && lev(n1, n2) <= 1) sc += 2;
    if (w1 && w1 === w2) sc += 3; else if (w1 && w2 && lev(w1, w2) <= 2) sc += 2;
    if (norm(a.city) === norm(city)) sc += 1;
    return sc;
  }
  const sameArea = (a, state, zip) => a.state === String(state || '').toUpperCase() && a.zip === String(zip || '').slice(0, 5);
  // keep the best few, closest first, one per property
  function rankNear(a, list) {
    const seen = new Set();
    return list.filter((x) => !seen.has(x.id) && seen.add(x.id))
      .map((x) => Object.assign(x, { score: closeness(a, x.line, x.city) }))
      .filter((x) => x.score >= 3)
      .sort((x, y) => y.score - x.score).slice(0, 5);
  }

  // Zillow's own autocomplete -> zpid (Trulia uses the same id)
  const zItem = (m) => ({ id: m.zpid, zpid: m.zpid, line: `${m.streetNumber} ${m.streetName}`, city: m.city, state: m.state, zip: m.zipCode });
  async function lookupZillow(a) {
    const near = [];
    // second search leaves the city out, for leads whose city is the mailing city (e.g. Detroit vs Redford)
    for (const q of [a.full, `${a.street} ${a.state} ${a.zip}`]) {
      const j = await getJSON('https://www.zillowstatic.com/autocomplete/v3/suggestions?q=' + encodeURIComponent(q));
      for (const r of ((j && j.results) || [])) {
        const m = r.metaData;
        if (!m || !m.zpid || !m.streetNumber || !sameArea(a, m.state, m.zipCode)) continue;
        if (sameProperty(a, `${m.streetNumber} ${m.streetName}`, m.city, m.state, m.zipCode)) return zItem(m);
        near.push(zItem(m));
      }
    }
    return { near: rankNear(a, near) };
  }

  // Realtor.com's own autocomplete -> property id
  const rItem = (r) => ({ id: String(r.mpr_id), line: r.line, city: r.city, state: r.state_code, zip: r.postal_code });
  async function lookupRealtor(a) {
    const near = [];
    for (const q of [a.full, `${a.street} ${a.state} ${a.zip}`]) {
      const j = await getJSON('https://parser-external.geo.moveaws.com/suggest?client_id=rdc-home&limit=8&area_types=address&input=' +
        encodeURIComponent(q));
      for (const r of ((j && j.autocomplete) || [])) {
        if (!r.mpr_id || !r.line || !sameArea(a, r.state_code, r.postal_code)) continue;
        if (sameProperty(a, r.line, r.city, r.state_code, r.postal_code)) return rItem(r);
        near.push(rItem(r));
      }
    }
    return { near: rankNear(a, near) };
  }

  const cache = {}; // full address -> { zillow, realtor, done, info }
  function lookup(a) {
    if (cache[a.full]) return cache[a.full];
    const c = cache[a.full] = { done: false, sites: {} };
    c.promise = Promise.all([lookupZillow(a), lookupRealtor(a)]).then(([z, r]) => {
      // an exact hit has an id; otherwise we keep the close matches for the agent to pick from
      c.zillow = z.zpid ? z : null; c.zNear = z.near || [];
      c.realtor = r.id ? r : null; c.rNear = r.near || [];
      c.done = true;
      refresh();
      loadDetails(a, c);
    });
    return c;
  }

  // =====================================================================
  //  Link builders (the colored buttons)
  // =====================================================================
  const dash = (s) => String(s).replace(/[#\/?&.,]/g, ' ').trim().replace(/\s+/g, '-');
  const google = (site, a) => 'https://www.google.com/search?q=' + encodeURIComponent(`site:${site} ${a.street} ${a.city} ${a.state} ${a.zip}`);
  const zSlug = (z) => dash(`${z.line} ${z.city} ${z.state} ${z.zip}`);

  // each site's own browser-tab icon, via Google's public favicon service
  const favicon = (s, px) => `<img class="vp-fav" src="https://www.google.com/s2/favicons?domain=${s.domain}&sz=${px * 2}" width="${px}" height="${px}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;

  const SITES = [
    { key: 'zillow', domain: 'zillow.com', label: 'Zillow', color: '#006aff',
      url: (a, c) => c.zillow ? `https://www.zillow.com/homedetails/${zSlug(c.zillow)}/${c.zillow.zpid}_zpid/`
        : `https://www.zillow.com/homes/${dash(a.street)},-${dash(a.city)},-${a.state}-${a.zip}_rb/`,
      exact: (c) => !!c.zillow },
    { key: 'realtor', domain: 'realtor.com', label: 'Realtor', color: '#d92228',
      url: (a, c) => c.realtor
        ? `https://www.realtor.com/realestateandhomes-detail/${dash(c.realtor.line)}_${dash(c.realtor.city)}_${c.realtor.state}_${c.realtor.zip}_M${c.realtor.id.slice(0, 5)}-${c.realtor.id.slice(5)}`
        : google('realtor.com', a),
      exact: (c) => !!c.realtor },
    { key: 'homes', domain: 'homes.com', label: 'Homes.com', color: '#f05a28',
      url: (a, c) => c.homesUrl || google('homes.com', c.zillow ? { street: c.zillow.line, city: c.zillow.city, state: c.zillow.state, zip: c.zillow.zip } : a),
      exact: () => false },
    { key: 'trulia', domain: 'trulia.com', label: 'Trulia', color: '#007882',
      url: (a, c) => c.zillow ? `https://www.trulia.com/home/${zSlug(c.zillow).toLowerCase()}-${c.zillow.zpid}` : google('trulia.com', a),
      exact: (c) => !!c.zillow }
  ];

  // =====================================================================
  //  Property details – read from the Zillow and Trulia pages
  // =====================================================================
  const nextData = (html) => {
    const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
  };

  // Walk any JSON (also JSON hidden inside strings) and call fn on every object
  function walkAll(root, fn) {
    let seen = 0;
    const walk = (o, d) => {
      if (!o || d > 16 || ++seen > 300000) return;
      if (typeof o === 'string') {
        if (o.length > 200 && (o[0] === '{' || o[0] === '[') && /"zpid"|"price"|"value"/.test(o)) {
          try { walk(JSON.parse(o), d + 1); } catch (e) {}
        }
        return;
      }
      if (typeof o !== 'object') return;
      if (fn(o) === false) return;
      for (const k in o) walk(o[k], d + 1);
    };
    walk(root, 0);
  }

  // Zillow's page can hold several copies of the home (a light one and a full one with price/tax history).
  // Combine them all, richest last, so nothing in the full record is lost.
  function findProperty(data, zpid) {
    const found = [];
    walkAll(data, (o) => {
      if (!Array.isArray(o) && String(o.zpid) === String(zpid) &&
        ('homeStatus' in o || 'bedrooms' in o || 'livingArea' in o)) found.push(o);
    });
    if (!found.length) return null;
    const filled = (v) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length) && v !== '';
    found.sort((a, b) => Object.keys(a).length - Object.keys(b).length);
    const merged = {};
    found.forEach((o) => Object.keys(o).forEach((k) => {
      if (!filled(o[k])) return;
      if (Array.isArray(o[k]) && Array.isArray(merged[k]) && merged[k].length >= o[k].length) return; // keep the longer list
      if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && merged[k] && typeof merged[k] === 'object') merged[k] = Object.assign({}, merged[k], o[k]);
      else merged[k] = o[k];
    }));
    return merged;
  }

  const toTime = (t) => {
    if (typeof t === 'number') return t > 1e11 ? t : t > 1e8 ? t * 1000 : NaN;
    if (typeof t === 'string' && /\d{4}/.test(t)) return Date.parse(t.length === 7 ? t + '-01' : t);
    return NaN;
  };

  // Estimate history: the longest list of {date, value} points near today's estimate
  function findValueHistory(datas, estimate) {
    if (!estimate) return null;
    let best = null;
    const lo = estimate * 0.35, hi = estimate * 1.8;
    datas.forEach((d) => walkAll(d, (o) => {
      if (!Array.isArray(o) || o.length < 6 || typeof o[0] !== 'object' || !o[0] || o[0].event) return;
      const keys = Object.keys(o[0]);
      const tKey = keys.find((k) => /^(x|date|time|timestamp|month|period|d)$/i.test(k) && !isNaN(toTime(o[0][k])));
      const vKey = keys.find((k) => k !== tKey && typeof o[0][k] === 'number' && o[0][k] >= lo && o[0][k] <= hi);
      if (!tKey || !vKey) return;
      const pts = o.map((p) => ({ t: toTime(p && p[tKey]), v: p && p[vKey] }))
        .filter((p) => !isNaN(p.t) && typeof p.v === 'number' && p.v >= lo && p.v <= hi)
        .sort((x, y) => x.t - y.t);
      if (pts.length >= 6 && (!best || pts.length > best.length)) best = pts;
    }));
    return best;
  }

  // ---------- Zillow value history (the "Zestimate history" chart is loaded separately) ----------
  const CHART_QUERY = `query HomeValueChartDataQuery($zpid: ID!, $metricType: HomeValueChartMetricType, $timePeriod: HomeValueChartTimePeriod) {
    property(zpid: $zpid) { homeValueChartData(metricType: $metricType, timePeriod: $timePeriod) { points { x y } name } } }`;
  function fetchZillowHistory(zpid) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'POST', timeout: 15000,
        url: `https://www.zillow.com/graphql/?zpid=${zpid}&timePeriod=TEN_YEARS&metricType=LOCAL_HOME_VALUES&forecast=true&operationName=HomeValueChartDataQuery`,
        headers: { 'Content-Type': 'application/json', Accept: '*/*' },
        data: JSON.stringify({ query: CHART_QUERY, operationName: 'HomeValueChartDataQuery',
          variables: { zpid: Number(zpid), timePeriod: 'TEN_YEARS', metricType: 'LOCAL_HOME_VALUES', forecast: true } }),
        onload: (r) => {
          try {
            const series = JSON.parse(r.responseText).data.property.homeValueChartData || [];
            const home = series.find((x) => /this home/i.test(x.name || '')) || series[0];
            const now = Date.now() + 864e5;
            const pts = (home && home.points || []).filter((q) => q.x <= now && isNum(q.y)).map((q) => ({ t: q.x, v: q.y })).sort((a, b) => a.t - b.t);
            resolve(pts.length > 1 ? pts : null);
          } catch (e) { resolve(null); }
        },
        onerror: () => resolve(null), ontimeout: () => resolve(null)
      });
    });
  }

  // ---------- Realtor.com page -> property record ----------
  function findRealtor(data) {
    let best = null;
    walkAll(data, (o) => {
      if (best || Array.isArray(o)) return best ? false : undefined;
      if (o.property_id && (o.description || o.estimates || o.property_history)) { best = o; return false; }
    });
    return best;
  }

  // ---------- one common shape for every site ----------
  function fromZillow(p, datas) {
    const rf = p.resoFacts || {};
    const ph = p.priceHistory || [];
    const sale = ph.find((e) => /sold/i.test(e.event || ''));
    const estimate = p.zestimate || null;
    const history = findValueHistory(datas, estimate || p.price);
    const GROUPS = [
      ['Interior', ['bedrooms', 'bathroomsFull', 'bathroomsHalf', 'stories', 'storiesTotal', 'levels', 'flooring', 'appliances', 'interiorFeatures', 'fireplaces', 'fireplaceFeatures', 'laundryFeatures', 'basement']],
      ['Heating & Cooling', ['heating', 'cooling']],
      ['Exterior', ['roofType', 'constructionMaterials', 'exteriorFeatures', 'patioAndPorchFeatures', 'poolFeatures', 'hasPrivatePool', 'spaFeatures', 'hasSpa', 'fencing', 'architecturalStyle']],
      ['Parking & Garage', ['parkingFeatures', 'garageParkingCapacity', 'parkingCapacity', 'hasAttachedGarage', 'hasCarport']],
      ['Lot & Utilities', ['lotSize', 'lotFeatures', 'sewer', 'waterSource', 'utilities', 'zoning', 'parcelNumber']],
      ['Community & HOA', ['subdivisionName', 'communityFeatures', 'associationName', 'associationFee', 'hoaFee', 'associationAmenities']]
    ];
    const groups = GROUPS.map(([g, keys]) => [g, keys.map((k) => [words(k), show(rf[k])]).filter(([, v]) => v && v !== '0' && v !== 'No')]);
    const glance = (rf.atAGlanceFacts || []).filter((f) => f && f.factValue).map((f) => [f.factLabel, f.factValue]);
    if (glance.length) groups.unshift(['At a glance', glance]);
    // listing photos (or Zillow's Street View picture for homes with none)
    const pick = (srcs, want) => (srcs || []).slice().sort((a, b) => Math.abs((a.width || 0) - want) - Math.abs((b.width || 0) - want))[0];
    const photos = (p.originalPhotos || p.responsivePhotos || []).map((ph) => {
      const j = (ph.mixedSources && ph.mixedSources.jpeg) || [];
      const full = pick(j, 1152) || { url: ph.url }, thumb = pick(j, 192) || full;
      return full && full.url ? { full: full.url, thumb: thumb.url, caption: ph.caption || '' } : null;
    }).filter(Boolean);
    return {
      photos, streetViewOnly: photos.length > 0 && photos.every((x) => /streetview/i.test(x.full)), estimateLabel: 'Zestimate',
      status: nice(p.homeStatus),
      soldDate: sale ? (sale.date || sale.time) : p.dateSold, soldPrice: sale ? sale.price : p.lastSoldPrice,
      estimate: estimate || (history && history.length ? history[history.length - 1].v : null),
      listPrice: p.homeStatus === 'FOR_SALE' ? p.price : null,
      history,
      beds: p.bedrooms, baths: p.bathrooms, sqft: p.livingAreaValue || p.livingArea,
      yearBuilt: p.yearBuilt > 0 ? p.yearBuilt : '', type: nice(p.homeType),
      lot: p.lotAreaValue ? `${num(p.lotAreaValue)} ${p.lotAreaUnits || ''}`.trim() : (p.lotSize ? num(p.lotSize) + ' sqft' : show(rf.lotSize)),
      parking: rf.hasGarage || rf.hasAttachedGarage ? 'Garage' : show(rf.parkingFeatures).split(',')[0],
      hoa: p.monthlyHoaFee ? money(p.monthlyHoaFee) + '/mo' : show(rf.hoaFee),
      rent: p.rentZestimate ? money(p.rentZestimate) + '/mo' : '',
      county: p.county || '',
      groups,
      priceHistory: ph.map((e) => ({ date: e.date || e.time, event: e.event, price: e.price, ppsf: e.pricePerSquareFoot, source: e.source || e.attributeSource && e.attributeSource.infoString1, rate: e.priceChangeRate })),
      taxHistory: (p.taxHistory || []).map((t) => ({ year: t.time ? new Date(t.time).getUTCFullYear() : '', tax: t.taxPaid, value: t.value, taxRate: t.taxIncreaseRate, valueRate: t.valueIncreaseRate })),
      street: p.streetAddress || (p.address && p.address.streetAddress) || '',
      city: (p.address && p.address.city) || p.city || ''
    };
  }

  // County: Trulia's own field when filled, else its county page link ("/Adams-County-08001/"), e.g. "Adams County"
  function truliaCounty(hd) {
    const c = hd.location && hd.location.county;
    if (c) return typeof c === 'string' ? c : (c.name || c.formattedName || '');
    let found = '';
    walkAll(hd.secondaryNavigationPDP || {}, (o) => {
      if (found || Array.isArray(o)) return found ? false : undefined;
      const m = typeof o.uri === 'string' && o.uri.match(/\/([A-Za-z.\-]+)-County-\d+\//);
      if (m) { found = m[1].replace(/-/g, ' ') + ' County'; return false; }
    });
    return found;
  }

  // Trulia's page keeps everything under props.homeDetails (mapped from a real Trulia page)
  function fromTrulia(hd) {
    const attrs = (list) => (list || []).map((x) => [x.formattedName || '', x.formattedValue || '']).filter(([, v]) => v);
    const groups = [];
    (hd.features && hd.features.categories || []).forEach((c) => {
      if ((c.attributes || []).length) groups.push([c.formattedName || 'Details', attrs(c.attributes)]);
      (c.categories || []).forEach((sub) => groups.push([sub.formattedName || c.formattedName || 'Details', attrs(sub.attributes)]));
    });
    const hi = {};
    attrs(hd.features && hd.features.highlightedInfoAttributes).forEach(([k, v]) => { hi[k.toLowerCase()] = v; });
    const all = {};
    groups.forEach(([, rows]) => rows.forEach(([k, v]) => { if (k) all[k.toLowerCase()] = v; }));
    const pr = (x) => x && (isNum(x.price) ? x.price : parseMoney(x.formattedPrice));
    const series = hd.homeValue && hd.homeValue.history && hd.homeValue.history.series || [];
    const home = series.find((x) => /this home/i.test(x.name || '')) || series[0];
    const history = home && home.points ? home.points.map((q) => ({ t: q.timestamp, v: q.value }))
      .filter((q) => isNum(q.t) && isNum(q.v) && q.t <= Date.now() + 864e5).sort((a, b) => a.t - b.t) : null;
    const st = hd.currentStatus || {};
    const photos = (hd.media && hd.media.photos || []).map((ph) => ph && ph.url && (ph.url.large || ph.url.medium)
      ? { full: ph.url.large || ph.url.medium, thumb: ph.url.thumbnail || ph.url.smallSrc || ph.url.large, caption: ph.caption || '' } : null).filter(Boolean);
    const sqft = parseMoney(hd.floorSpace && hd.floorSpace.formattedDimension);
    const ov = hd.homeValue && hd.homeValue.overview || {};
    const delta = (d) => d && d.formattedValue ? { txt: d.formattedValue, pct: d.formattedPercent || '', up: /up/i.test(d.direction || '') } : null;
    const changes = { month: delta(ov.sinceLastMonth), year: delta(ov.sinceLastYear), sale: delta(ov.sinceLastSale) };
    return {
      photos, streetViewOnly: false, changes,
      estimateLabel: (hd.price && hd.price.typeDescription) || 'Trulia Estimate',
      status: st.label || '',
      soldDate: hd.lastSold && hd.lastSold.soldDate, soldPrice: hd.lastSold && pr(hd.lastSold.soldPrice),
      estimate: pr(hd.estimatedValue) || (st.isActiveForSale ? null : pr(hd.price)),
      listPrice: st.isActiveForSale ? pr(hd.price) : null,
      history: history && history.length > 1 ? history : null,
      beds: hd.bedrooms && hd.bedrooms.value, baths: hd.bathrooms && hd.bathrooms.value, sqft,
      yearBuilt: hi['year built'] || all['year built'] || '', type: hi['property type'] || all['property type'] || '',
      lot: (hd.lotSize && hd.lotSize.formattedDimension) || all['lot area'] || '',
      parking: all['parking spaces'] ? all['parking spaces'] + ' spaces' : (all['parking'] || ''),
      hoa: all['hoa fee'] || all['hoa'] || '', rent: hd.estimatedRent && hd.estimatedRent.formattedPrice || '',
      county: (hd.location && hd.location.county) ? truliaCounty(hd) : '', countyGuess: truliaCounty(hd),
      groups: groups.filter(([, rows]) => rows.length),
      priceHistory: (hd.priceHistory || []).map((e) => ({ date: e.date, event: words(String(e.event || '')).replace(/\bPrice Change\b/i, 'Price change'), price: pr(e.price), source: e.source && e.source !== 'N/A' ? e.source : '' })),
      taxHistory: (hd.taxes && hd.taxes.history || []).map((t) => ({ year: t.year, tax: pr(t.taxValue), value: pr(t.totalAssessment) })),
      street: (hd.location && (hd.location.streetAddress || hd.location.formattedLocation)) || '', city: (hd.location && hd.location.city) || ''
    };
  }

  function fromRealtor(o, datas) {
    const d = o.description || {}, loc = (o.location && o.location.address) || {};
    const ph = o.property_history || [];
    const sale = ph.find((e) => /sold/i.test(e.event_name || ''));
    const cur = ((o.estimates && o.estimates.current_values) || []).map((e) => e.estimate).filter(isNum);
    const estimate = cur.length ? cur.reduce((x, y) => x + y, 0) / cur.length : null;
    let history = null;
    const hv = (o.estimates && o.estimates.historical_values) || [];
    if (hv.length && hv[0].estimates) {
      history = hv[0].estimates.map((e) => ({ t: toTime(e.date), v: e.estimate })).filter((p) => !isNaN(p.t) && isNum(p.v)).sort((x, y) => x.t - y.t);
    }
    if (!history || history.length < 2) history = findValueHistory(datas, estimate);
    const groups = (o.details || []).map((g) => [g.category || 'Details', (g.text || []).map((t) => {
      const i = String(t).indexOf(':');
      return i > 0 ? [t.slice(0, i), t.slice(i + 1).trim()] : ['', t];
    })]).filter(([, rows]) => rows.length);
    // rdcpix photo links end in a size code (…s.jpg, …rd-w480_h360.jpg); ask for the large one
    const big = (u) => String(u).replace(/(?:s|[a-z]{1,2}-w\d+_h\d+)\.(jpg|jpeg|webp)(\?.*)?$/i, 'od-w1024_h768.$1');
    const photos = (o.photos || []).map((ph) => ph && ph.href ? { full: big(ph.href), thumb: ph.href, caption: ph.title || '' } : null).filter(Boolean);
    return {
      photos, streetViewOnly: false,
      status: nice(String(o.status || '').toUpperCase()),
      soldDate: sale ? sale.date : o.last_sold_date, soldPrice: sale ? sale.price : o.last_sold_price,
      estimate, listPrice: /for_sale/i.test(o.status || '') ? o.list_price : null, history,
      beds: d.beds, baths: d.baths_consolidated || d.baths, sqft: d.sqft, yearBuilt: d.year_built || '',
      type: nice(String(d.type || '').toUpperCase()), lot: d.lot_sqft ? num(d.lot_sqft) + ' sqft' : '',
      parking: d.garage ? d.garage + '-car garage' : '', hoa: o.hoa && o.hoa.fee ? money(o.hoa.fee) + '/mo' : '',
      rent: '', county: (o.location && o.location.county && o.location.county.name) || '',
      groups,
      priceHistory: ph.map((e) => ({ date: e.date, event: e.event_name, price: e.price })),
      taxHistory: (o.tax_history || []).map((t) => ({ year: t.year, tax: t.tax, value: t.assessment && t.assessment.total })),
      street: loc.line || '', city: loc.city || ''
    };
  }

  // ---------- load one site's tab ----------
  function siteState(c, key) { return (c.sites = c.sites || {})[key] || { state: 'idle' }; }

  async function loadSite(a, c, key) {
    c.sites = c.sites || {};
    if (c.sites[key] && c.sites[key].state !== 'idle') return;
    const s = SITES.find((x) => x.key === key);
    c.sites[key] = { state: 'loading', url: s.url(a, c) };
    renderAll();
    const done = (o) => { c.sites[key] = Object.assign({ url: s.url(a, c) }, o); renderAll(); };

    if (key === 'homes') {
      const r = await homesLookup(c.homesAddr || a, c.homesPick);
      if (r && !r.ok && r.near) return done({ state: 'nomatch', near: r.near.map((t) => ({ id: t, line: t, label: t })) });
      if (!r || !r.ok) return done({ state: 'error', code: r ? r.why : 'no answer from the Homes.com tab' });
      c.homesUrl = r.url;
      const hm = fromHomes(r.data);
      if (c.homesAddr) hm.street = c.homesAddr.street;
      return done({ state: 'ok', model: hm, url: r.url, picked: c.homesAddr ? { line: c.homesAddr.street, city: c.homesAddr.city, state: c.homesAddr.state, zip: c.homesAddr.zip } : null });
    }
    if ((key === 'zillow' || key === 'trulia') && !c.zillow) return done({ state: 'nomatch', near: c.zNear || [] });
    if (key === 'realtor' && !c.realtor) return done({ state: 'nomatch', near: c.rNear || [] });

    const r = await gmGet(c.sites[key].url, 'text/html');
    if (r.status === 403 || r.status === 429 || /px-captcha|Access to this page has been denied|press & hold|kasada|captcha/i.test(r.text.slice(0, 8000))) return done({ state: 'blocked', code: r.status });
    const data = r.status === 200 ? nextData(r.text) : null;
    if (!data) return done({ state: 'error', code: r.status ? r.status + (r.status === 200 ? ', unmapped page' : '') : 'no response' });

    let model = null;
    if (key === 'realtor') { const o = findRealtor(data); if (o) model = fromRealtor(o, [data]); }
    else if (key === 'trulia' && data.props && data.props.homeDetails) model = fromTrulia(data.props.homeDetails);
    else { const p = findProperty(data, c.zillow.zpid); if (p) model = fromZillow(p, [data]); }
    if (!model) return done({ state: key === 'trulia' ? 'shared' : 'error', code: '200, unmapped page', raw: data });

    if ((key === 'zillow' || key === 'trulia') && (!model.history || model.history.length < 2)) {
      c.zHistory = c.zHistory || fetchZillowHistory(c.zillow.zpid);
      model.history = await c.zHistory;
    }
    const picked = (key === 'realtor' ? c.realtorPicked : c.zillowPicked) ? (key === 'realtor' ? c.realtor : c.zillow) : null;
    if (picked) model.street = picked.line; // headings name the home shown, not the lead's typed address
    done({ state: 'ok', model, raw: data, picked });
  }

  // A close match the agent picked (on any tab) becomes the property for every tab that has no exact
  // match of its own, so they only pick once. Tabs that found the lead's exact address keep it.
  function nearAddr(x) {
    if (x.city) return { street: x.line, city: x.city, state: x.state, zip: String(x.zip || '').slice(0, 5) };
    const m = String(x.label || x.line).match(/^(.+?),\s*(.+?),\s*([A-Za-z]{2})\s+(\d{5})/); // Homes.com: "140 Holland Trl, Pelham, AL 35124"
    return m ? { street: m[1], city: m[2], state: m[3].toUpperCase(), zip: m[4] } : null;
  }
  async function pickNear(a, c, key, i) {
    const st = siteState(c, key), x = st.near && st.near[i];
    if (!x) return;
    const p = nearAddr(x);
    if (!p) return;
    p.full = `${p.street}, ${p.city}, ${p.state} ${p.zip}`; p.missing = [];
    c.pick = p;
    const reset = (k) => { c.sites[k] = { state: 'loading' }; };
    const zNeeds = !c.zillow || c.zillowPicked, rNeeds = !c.realtor || c.realtorPicked;
    if (zNeeds) ['zillow', 'trulia'].forEach(reset);
    if (rNeeds) reset('realtor');
    renderAll();

    // Homes.com: re-run only if its tab was already opened; otherwise it uses the pick when opened
    const hs = siteState(c, 'homes');
    const hExact = hs.state === 'ok' && !hs.picked;
    if (!hExact) {
      c.homesAddr = p;
      c.homesPick = key === 'homes' ? x.line : '';
      if (hs.state !== 'idle') { c.sites.homes = { state: 'idle' }; loadSite(a, c, 'homes'); }
    }

    if (zNeeds) {
      const z = (key === 'zillow' || key === 'trulia') ? x : await lookupZillow(p);
      c.zHistory = null;
      if (z && z.zpid) { c.zillow = z; c.zillowPicked = true; ['zillow', 'trulia'].forEach((k) => { c.sites[k] = { state: 'idle' }; loadSite(a, c, k); }); }
      else { c.zillow = null; c.zNear = (z && z.near) || []; ['zillow', 'trulia'].forEach((k) => { c.sites[k] = { state: 'nomatch', near: c.zNear, url: SITES.find((y) => y.key === k).url(a, c) }; }); }
    }
    if (rNeeds) {
      const r = key === 'realtor' ? x : await lookupRealtor(p);
      if (r && r.id) { c.realtor = r; c.realtorPicked = true; c.sites.realtor = { state: 'idle' }; loadSite(a, c, 'realtor'); }
      else { c.realtor = null; c.rNear = (r && r.near) || []; c.sites.realtor = { state: 'nomatch', near: c.rNear, url: SITES.find((y) => y.key === 'realtor').url(a, c) }; }
    }
    renderAll();
  }

  function loadDetails(a, c) {
    ['zillow', 'trulia', 'realtor'].forEach((k) => loadSite(a, c, k)); // Homes.com loads when its tab is opened
  }

  // Opens homes.com in a background tab, lets the homes.com helper search the address, waits for its answer
  function homesLookup(a, pick) {
    return new Promise((resolve) => {
      const id = Date.now();
      GM_setValue('vpHomesJob', { id, t: id, query: pick || a.full, street: a.street, city: a.city, state: a.state, zip: a.zip, pick: pick || '' });
      let tab = null, done = false;
      const listener = GM_addValueChangeListener('vpHomesResult', (name, oldV, v) => {
        if (!v || v.id !== id || done) return;
        done = true; GM_removeValueChangeListener(listener);
        try { tab && tab.close(); } catch (e) {}
        resolve(v);
      });
      // A small pop-up window keeps running at full speed (Edge slows down background tabs);
      // if pop-ups are blocked, fall back to a background tab.
      const url = 'https://www.homes.com/#vprop-' + id;
      const w = 520, h = 420;
      let pop = null;
      try {
        pop = window.open(url, 'vprop-homes', `popup=yes,width=${w},height=${h},left=${Math.max(0, screen.availWidth - w - 20)},top=${Math.max(0, screen.availHeight - h - 60)}`);
      } catch (e) { pop = null; }
      tab = pop ? { close: () => { try { pop.close(); } catch (e) {} } }
        : GM_openInTab(url, { active: false, insert: true, setParent: true });
      setTimeout(() => { if (done) return; done = true; GM_removeValueChangeListener(listener); try { tab && tab.close(); } catch (e) {} resolve(null); }, 45000);
    });
  }

  // Homes.com page data -> the common shape
  function fromHomes(d) {
    const g = {}; (d.groups || []).forEach(([k, v]) => { g[k.toLowerCase()] = v; });
    const first = (k) => (g[k] || [])[0] || '';
    const groups = [];
    if ((d.highlights || []).length) groups.push(['Highlights', d.highlights.map((v) => ['', v])]);
    (d.groups || []).forEach(([k, vals]) => { if (!/^(home type|year built|hoa fees|parking)$/i.test(k)) groups.push([k, vals.map((v) => ['', v])]); });
    const st = String(d.status || '');
    return {
      photos: d.photos || [], streetViewOnly: false, estimateLabel: 'Homes.com estimated value',
      status: /not listed/i.test(st) ? 'Off market' : st.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()),
      soldDate: d.soldDate, soldPrice: d.soldPrice, estimate: d.estimate || null, listPrice: /for sale/i.test(st) ? d.listPrice : null,
      history: null, beds: d.beds, baths: d.baths, sqft: d.sqft, yearBuilt: d.yearBuilt || '',
      type: first('home type') || words(String(d.type || '')).replace(/Residence$/, ''),
      lot: first('lot details'), parking: first('parking'), hoa: first('hoa fees'), rent: '', county: '',
      groups,
      priceHistory: (d.priceHistory || []).map((e) => ({ date: e.date, event: e.event, price: e.price })),
      taxHistory: (d.taxHistory || []).map((t) => ({ year: t.year, tax: t.tax, value: t.value, land: t.land, improvement: t.improvement })),
      ownership: d.ownership || [], mortgages: d.mortgages || [],
      street: d.street || '', city: d.city || ''
    };
  }

  // =====================================================================
  //  Formatting helpers
  // =====================================================================
  const isNum = (n) => n !== null && n !== '' && !isNaN(n);
  const money = (n) => isNum(n) ? '$' + Math.round(n).toLocaleString() : '';
  const kMoney = (n) => !isNum(n) ? '' : Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e4 ? '$' + Math.round(n / 1e3) + 'K' : Math.abs(n) >= 1e3 ? '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : '$' + Math.round(n);
  const num = (n) => isNum(n) ? Number(n).toLocaleString() : '';
  const day = (t) => {
    if (!t) return '';
    const m = typeof t === 'string' && t.match(/^(\d{4})-(\d{2})-(\d{2})/);   // ISO dates: show the calendar day as written
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(typeof t === 'number' ? t : String(t));
    return isNaN(d) ? String(t) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: m ? 'UTC' : undefined });
  };
  // "$500,000 - $749,999" -> { lo: 500000, hi: 749999 };  "$365,650.00" -> { lo: 365650, hi: 365650 }
  const parseRange = (s) => {
    const nums = (String(s || '').match(/\d[\d,]*(\.\d+)?/g) || []).map((x) => parseFloat(x.replace(/,/g, ''))).filter((n) => n > 0);
    if (!nums.length) return null;
    return { lo: Math.min(nums[0], nums[1] || nums[0]), hi: Math.max(nums[0], nums[1] || nums[0]) };
  };
  const parseMoney = (s) => { const r = parseRange(s); return r ? r.lo : null; };
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const words = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
  const show = (v) => Array.isArray(v) ? v.filter((x) => x !== null && typeof x !== 'object').join(', ')
    : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : (v === null || v === undefined || typeof v === 'object') ? '' : String(v);

  const STATUS = { RECENTLY_SOLD: 'Recently sold', SOLD: 'Sold', FOR_SALE: 'For sale', PENDING: 'Pending',
    OTHER: 'Off market', OFF_MARKET: 'Off market', FOR_RENT: 'For rent', SINGLE_FAMILY: 'Single-family home',
    TOWNHOUSE: 'Townhouse', CONDO: 'Condo', MULTI_FAMILY: 'Multi-family', MANUFACTURED: 'Manufactured', LOT: 'Lot / land' };
  const nice = (s) => s ? (STATUS[s] || String(s).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase())) : '';

  // change vs. the history point closest to `daysAgo`
  function change(history, now, daysAgo) {
    if (!history || !history.length || !now) return null;
    const target = history[history.length - 1].t - daysAgo * 864e5;
    let best = null;
    history.forEach((p) => { if (!best || Math.abs(p.t - target) < Math.abs(best.t - target)) best = p; });
    if (!best || Math.abs(best.t - target) > 45 * 864e5) return null;
    return { amt: now - best.v, pct: (now - best.v) / best.v * 100 };
  }
  // "Owned 3 yrs 2 mos" under Last sold; under a year is flagged, since many programs have ownership minimums
  function ownedFor(t) {
    if (!t) return '';
    const mm = typeof t === 'string' && t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const d = mm ? new Date(+mm[1], +mm[2] - 1, +mm[3]) : new Date(t);
    if (isNaN(d)) return '';
    const now = new Date();
    let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) - (now.getDate() < d.getDate() ? 1 : 0);
    if (months < 0) return '';
    const y = Math.floor(months / 12), mo = months % 12;
    const txt = (y ? `${y} yr${y > 1 ? 's' : ''}` : '') + (y && mo ? ' ' : '') + (mo || !y ? `${mo} mo${mo === 1 ? '' : 's'}` : '');
    return `<div class="vp-owned${months < 12 ? ' short' : ''}">Owned ${txt}</div>`;
  }

  function changeHTML(ch) {
    if (!ch) return '<div class="vp-na">Not available</div>';
    const up = ch.amt >= 0;
    return `<div class="vp-ch ${up ? 'up' : 'down'}">${up ? '↑' : '↓'} ${kMoney(Math.abs(ch.amt))}</div>
      <div class="vp-ch-p ${up ? 'up' : 'down'}">${up ? '+' : '−'}${Math.abs(ch.pct).toFixed(1)}%</div>`;
  }

  // simple line chart
  function chartSVG(pts, w, h, color, label) {
    if (!pts || pts.length < 2) return '';
    const vs = pts.map((p) => p.v), t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.12 || hi * 0.05; lo -= pad; hi += pad;
    const L = 18, R = 62, T = 8, B = 22, W = w - L - R, H = h - T - B;
    const X = (t) => L + (t - t0) / (t1 - t0 || 1) * W, Y = (v) => T + H - (v - lo) / (hi - lo) * H;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const v = lo + (hi - lo) * i / 3, y = Y(v).toFixed(1);
      grid += `<line x1="${L}" y1="${y}" x2="${L + W}" y2="${y}" stroke="#e6eaf0"/><text x="${L + W + 6}" y="${+y + 4}" font-size="11" fill="#4d5866">${kMoney(v)}</text>`;
    }
    let yrs = '';
    const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
    const stepY = Math.max(1, Math.ceil((y1 - y0) / 8));
    for (let y = y0 + 1; y <= y1; y += stepY) {
      const x = X(Date.UTC(y, 0, 1));
      yrs += `<line x1="${x.toFixed(1)}" y1="${T}" x2="${x.toFixed(1)}" y2="${T + H}" stroke="#f0f2f6"/><text x="${x.toFixed(1)}" y="${h - 6}" font-size="11" fill="#4d5866" text-anchor="middle">${y}</text>`;
    }
    const last = pts[pts.length - 1];
    return `<svg role="img" aria-label="${esc(label)}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;max-width:100%">
      ${grid}${yrs}
      <path d="${d} L ${X(t1).toFixed(1)} ${T + H} L ${L} ${T + H} Z" fill="${color}" fill-opacity=".08"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="4" fill="${color}"/></svg>`;
  }

  // =====================================================================
  //  PROPERTY screen (opened from the tab next to SCRIPT 2)
  // =====================================================================
  // ---- per-site themes (brand colors + a similar web font; no logos) ----
  const THEMES = {
    zillow:  { accent: '#006aff', accentDark: '#0041d9', ink: '#2a2a33', muted: '#596b82', bg: '#f7f7f7', card: '#ffffff', border: '#d1d1d5',
               tile: '#f1f6ff', chart: '#006aff', up: '#0f7a3b', down: '#c4252b', font: "'Open Sans', Arial, sans-serif", fontUrl: 'Open+Sans:wght@400;600;700', radius: '12px', heading: 'Home value' },
    realtor: { accent: '#d92228', accentDark: '#b01a1f', ink: '#000000', muted: '#555555', bg: '#f6f6f6', card: '#ffffff', border: '#dddddd',
               tile: '#fff4f4', chart: '#d92228', up: '#2c7a2c', down: '#d92228', font: "'Roboto', Arial, sans-serif", fontUrl: 'Roboto:wght@400;500;700', radius: '8px', heading: 'Property value' },
    homes:   { accent: '#f05a28', accentDark: '#c8441a', ink: '#1f2933', muted: '#5f6b76', bg: '#f8f6f4', card: '#ffffff', border: '#e3ddd8',
               tile: '#fff3ec', chart: '#f05a28', up: '#1d7a46', down: '#c0392b', font: "'Nunito Sans', Arial, sans-serif", fontUrl: 'Nunito+Sans:wght@400;600;800', radius: '10px', heading: 'Home value' },
    trulia:  { accent: '#007882', accentDark: '#005a62', ink: '#3b4144', muted: '#5c6670', bg: '#f5f7f7', card: '#ffffff', border: '#e3e5e6',
               tile: '#eef7f7', chart: '#3a7d44', up: '#2e7d32', down: '#d0021b', font: "'Inter', Arial, sans-serif", fontUrl: 'Inter:wght@400;500;600;700', radius: '8px', heading: 'Home value' }
  };
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?' + Object.values(THEMES).map((t) => 'family=' + t.fontUrl).join('&') + '&display=swap';
  document.head.appendChild(fonts);

  const css = document.createElement('style');
  css.textContent = `

    #vprop-tabbar{position:absolute;z-index:10001;display:flex;gap:4px;white-space:nowrap}
    .vprop-tab .vp-fav{display:block;border-radius:4px}
    .vp-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    .vprop-tab{position:relative;display:inline-flex!important;align-items:center;gap:5px;padding:0 6px!important}
    .vp-brand{display:inline-flex;align-items:center;gap:8px}
    .vp-brand .vp-fav{border-radius:4px}
    .vprop-tab{display:inline-block;cursor:pointer;user-select:none;font:bold 14px Arial,sans-serif;background:#e4e4e4;
      padding:0 8px;box-sizing:border-box;border-radius:7px 7px 0 0}
    .vprop-tab:hover{background:#d4d4d4}
    .vprop-tab .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:0;flex-shrink:0;background:#9aa4b2}
    .vprop-tab.ready .dot{background:#1aa33c}
    .vprop-tab.fail .dot{background:#d08a00}
    .vprop-tab.active{background:currentColor}
    .vprop-tab.active span.lbl{color:#fff}


    #vprop-card{position:absolute;z-index:8000;box-sizing:border-box;background:#fff;color:#1f2733;border:1px solid #cfd5dd;border-radius:12px;
      box-shadow:0 2px 10px rgba(20,30,50,.08);font:13px/1.4 'Segoe UI',Arial,sans-serif;padding:12px 16px 14px;cursor:pointer}
    #vprop-card:hover{border-color:#9fb0c6}
    #vprop-card .vc-head{display:flex;align-items:baseline;gap:12px;margin-bottom:10px}
    #vprop-card .vc-title{font-weight:700;font-size:14px}
    #vprop-card .vc-addr{color:#5b6675}
    #vprop-card .vc-sp{flex:1}
    #vprop-card .vc-hint{font-size:11px;color:#8a94a3}
    #vprop-card .vc-row{display:flex;gap:14px;align-items:stretch}
    #vprop-card .vc-hero{flex:0 0 210px;background:#f3f6fa;border-radius:10px;padding:10px 12px}
    #vprop-card .vc-hero:hover{background:#e9eff7}
    #vprop-card .vc-big{font-size:28px;font-weight:700;line-height:1.15;margin:2px 0 6px}
    #vprop-card .vc-sites{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    #vprop-card .vc-site{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;font-weight:600;color:#1f2733;background:#fff;
      border:1px solid #d6dce4;border-radius:999px;padding:2px 8px 2px 5px;cursor:pointer}
    #vprop-card .vc-site:hover{border-color:#6b7f99}
    #vprop-card .vc-site img{border-radius:3px}
    #vprop-card .vc-grid{flex:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    #vprop-card.vc-narrow .vc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    #vprop-card.vc-narrow .vc-hero{flex-basis:190px}
    #vprop-card .vc-tile{background:#f8fafc;border:1px solid #edf0f4;border-radius:8px;padding:7px 10px;min-width:0}
    #vprop-card .vc-k{font-size:11px;color:#6b7686;text-transform:uppercase;letter-spacing:.03em}
    #vprop-card .vc-v{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #vprop-card .vc-sub,#vprop-card .vp-owned{font-size:12px;color:#5b6675;display:inline}
    #vprop-card .vp-owned.short{color:#b45309;font-weight:600}
    #vprop-card .up{color:#0f7a3b} #vprop-card .down{color:#c4252b} #vprop-card .warn{color:#b45309}
    #vprop-card .vc-warn{background:#fff7e6;border:1px solid #f3d08a;border-radius:8px;padding:7px 10px;margin-bottom:10px}
    #vprop-card .vc-msg{padding:4px 0 2px;font-size:14px}
    #vprop-card .vc-wait{display:flex;align-items:center;gap:10px;padding:4px 0 2px;font-size:14px;color:#5b6675}
    #vprop-card .vc-spin{width:18px;height:18px;border:3px solid #e3e8ef;border-top-color:#4a6fa5;border-radius:50%;animation:vp-spin .8s linear infinite}

    #vprop-screen{position:absolute;z-index:9000;box-sizing:border-box;overflow:auto;overscroll-behavior:contain;display:none;padding:0 0 28px;
      background:var(--bg);color:var(--ink);font:14px/1.45 var(--font)}
    #vprop-screen.open{display:block}
    #vprop-screen *{box-sizing:border-box}
    .vp-top{display:flex;align-items:center;gap:14px;padding:12px 22px;background:var(--card);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:2}
    .vp-brand{font-weight:800;font-size:22px;color:var(--accent);letter-spacing:-.02em}
    .vp-top .addr{font-size:15px;font-weight:600}
    .vp-top .sp{flex:1}
    .vp-top button{font:600 12px var(--font);padding:7px 12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--ink);cursor:pointer}
    .vp-open{color:#fff!important;background:var(--accent);text-decoration:none;font:700 13px var(--font);padding:8px 16px;border-radius:var(--radius)}
    .vp-open:hover{background:var(--accentDark)}
    .vp-body{padding:18px 22px 0}
    .vp-hero{display:flex;align-items:flex-end;gap:28px;flex-wrap:wrap;margin-bottom:16px}
    .vp-hero .big{font-size:40px;font-weight:800;line-height:1;letter-spacing:-.02em}
    .vp-hero .lbl{font-size:13px;color:var(--muted);font-weight:600;margin-bottom:6px}
    .vp-pill{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;font-size:13px;background:var(--tile);color:var(--accent)}
    .vp-grid{display:grid;gap:14px}
    .vp-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;min-width:0}
    .vp-card h3{margin:0 0 12px;font-size:17px;font-weight:700;color:var(--ink)}
    .vp-tile{background:var(--tile);border-radius:var(--radius);padding:11px 14px}
    .vp-tile .k{font-size:12px;color:var(--muted);font-weight:600}
    .vp-tile .v{font-size:19px;font-weight:700;margin-top:3px}
    .vp-tile.w{background:var(--card);border:1px solid var(--border)}
    .vp-ch{font-size:18px;font-weight:700;margin-top:4px}
    .vp-ch-p{font-size:13px;font-weight:600}
    #vprop-screen .up{color:var(--up)} #vprop-screen .down{color:var(--down)}
    .vp-na{font-size:12px;color:var(--muted);margin-top:6px}
    .vp-lead{background:#fff8e6;border:1px solid #f0d9a0;border-radius:var(--radius);padding:10px 14px;display:flex;gap:22px;flex-wrap:wrap;margin-top:14px}
    .vp-lead .k{color:#5d4a14;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;width:100%}
    .vp-hl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .vp-hl>div{display:flex;gap:10px;align-items:center}
    .vp-hl .ic{width:30px;height:30px;border-radius:50%;background:var(--tile);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .vp-hl .k{font-size:12px;color:var(--muted)}.vp-hl .v{font-weight:700}
    .vp-det{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
    .vp-det>div{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
    .vp-det h4{margin:0;padding:8px 12px;font-size:13px;font-weight:700;background:var(--tile);color:var(--ink)}
    .vp-det div.r{padding:3px 12px}
    .vp-det div.r:last-child{padding-bottom:9px}
    .vp-det div.r:nth-child(2){padding-top:8px}
    .vp-det span.k{color:var(--muted)}
    table.vp-t{width:100%;border-collapse:collapse;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
    table.vp-t th{text-align:left;font-size:12px;color:var(--muted);padding:9px 12px;background:var(--tile);font-weight:700}
    table.vp-t td{padding:10px 12px;border-top:1px solid var(--border)}
    .vp-msg{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;font-size:15px}
    .vp-banner{background:var(--tile);border:1px solid var(--border);border-left:0;border-radius:var(--radius);padding:12px 16px;margin-bottom:14px;
      display:flex;gap:14px;align-items:center;font-size:13px}
    .vp-banner b{color:var(--accent)}
    .vp-note{font-size:12px;color:var(--muted);margin:0 0 12px}
    .vp-wait{display:flex;align-items:center;gap:14px}
    .vp-wait-sub{font-size:13px;color:var(--muted);margin-top:4px}
    .vp-spin{width:26px;height:26px;flex:none;border:3px solid var(--tile);border-top-color:var(--accent);border-radius:50%;animation:vp-spin .8s linear infinite}
    @keyframes vp-spin{to{transform:rotate(360deg)}}
    .vp-near-h{margin:14px 0 8px;font-size:13px;color:var(--muted)}
    .vp-near{display:flex;flex-direction:column;gap:6px;max-width:560px}
    .vp-near button{display:flex;align-items:center;gap:10px;text-align:left;font:inherit;font-size:14px;color:var(--ink);background:var(--tile);
      border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;cursor:pointer}
    .vp-near button:hover{border-color:var(--accent);color:var(--accent)}
    .vp-hl.wide{grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px 18px}
    .vp-sec{margin:16px 0 10px;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;border-top:1px solid var(--border);padding-top:14px}
    .vp-card h3 + .vp-sec{border-top:0;padding-top:0;margin-top:4px}
    .vp-ctabs{display:flex;gap:4px;margin:-4px 0 10px;border-bottom:1px solid var(--border)}
    .vp-ctabs button{border:0;background:none;padding:7px 12px;font:600 13px var(--font);color:var(--muted);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-1px}
    .vp-ctabs button.on{color:var(--accent);border-bottom-color:var(--accent)}
    .vp-hist{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px}
    .vp-hist .vp-sec{border-top:0;padding-top:0;margin-top:14px}
    .vp-scroll{max-height:250px;overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--border);border-radius:var(--radius)}
    table.vp-t2{width:100%;border-collapse:collapse;font-size:13px}
    table.vp-t2 th{position:sticky;top:0;background:var(--card);text-align:left;font-size:12px;font-weight:700;color:var(--ink);padding:8px 12px;border-bottom:1px solid var(--border)}
    table.vp-t2 td{padding:7px 12px;border-bottom:1px solid var(--border);vertical-align:top}
    table.vp-t2 tr:last-child td{border-bottom:0}
    .vp-pct{font-size:11px;font-weight:600;margin-left:2px}
    .vp-sub{font-size:11px;color:var(--muted);margin-top:2px}
    .vp-top-row{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,1fr);gap:14px;margin-bottom:14px;align-items:stretch}
    .vp-top-row .vp-gal{width:auto}
    .vp-side{position:relative;min-height:320px}
    .vp-side-scroll{position:absolute;top:52px;left:18px;right:8px;bottom:12px;overflow-y:auto;overscroll-behavior:contain;padding-right:8px}
    .vp-side .vp-hl.wide{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px 14px}
    .vp-side .vp-sec{margin-top:12px}
    .vp-side-scroll > .vp-sec:first-child{border-top:0;padding-top:0;margin-top:0}
    .vp-owned{font-size:12px;font-weight:600;color:var(--muted);margin-top:3px}
    .vp-owned.short{color:#b45309}
    .vp-own{max-height:250px}
    .vp-own-wrap{margin-top:18px}
    .vp-own-wrap .vp-sec{border-top:0;padding-top:0;margin-top:0}
    .vp-own table.vp-t2 th, .vp-own table.vp-t2 td{padding:6px 8px;font-size:12px}
    .vp-count{font-size:13px;font-weight:600;color:var(--muted);margin-left:8px}
    .vp-gal{width:fit-content;max-width:100%}
    .vp-stage{position:relative;display:block;width:100%;aspect-ratio:4/3;max-height:520px;border-radius:var(--radius);overflow:hidden;background:var(--tile)}
    .vp-stage img{display:block;width:100%;height:100%;object-fit:cover}
    .vp-nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:0;cursor:pointer;
      background:rgba(255,255,255,.92);color:#111;font:700 26px/1 Arial;box-shadow:0 2px 8px rgba(0,0,0,.3)}
    .vp-nav:hover{background:#fff}.vp-nav.prev{left:12px}.vp-nav.next{right:12px}
    .vp-thumbs{display:flex;gap:8px;overflow-x:auto;width:0;min-width:100%;padding:10px 2px 4px;scroll-snap-type:x mandatory}
    .vp-thumbs button{flex:0 0 auto;padding:0;border:2px solid transparent;border-radius:6px;overflow:hidden;cursor:pointer;background:none;scroll-snap-align:center}
    .vp-thumbs button.on{border-color:var(--accent)}
    .vp-thumbs img{width:96px;height:68px;object-fit:cover;display:block}`;
  document.head.appendChild(css);

  // --- one site's screen ---
  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    bed: '<path d="M3 18V7M21 18v-5a3 3 0 00-3-3H10v6"/><path d="M3 15h18"/><circle cx="6.5" cy="11.5" r="1.5"/>',
    tree: '<path d="M12 22v-6"/><path d="M12 3l6 9H6z"/><path d="M12 8l7 9H5z"/>',
    car: '<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="13" r="1"/><circle cx="16.5" cy="13" r="1"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 11a3 3 0 100-6M21 20c0-2.5-1.8-4.2-4-4.8"/>',
    dollar: '<path d="M12 3v18"/><path d="M17 7H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H6"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'
  };
  const icon = (n) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

  const nearLabel = (x) => x.label || `${x.line}, ${x.city}, ${x.state} ${String(x.zip || '').slice(0, 5)}`;

  function screenHTML(a, c, key) {
    const s = SITES.find((x) => x.key === key);
    const st = c ? siteState(c, key) : { state: 'idle' };
    const openBtn = st.url ? `<a class="vp-open" href="${esc(st.url)}" target="_blank" rel="noopener">Open on ${esc(s.label)} ↗</a>` : '';
    const top = `<div class="vp-top"><span class="vp-brand">${favicon(s, 24)}${esc(s.label)}</span><span class="addr">${esc(a.full)}</span><span class="sp"></span>
      ${openBtn}</div>`;
    if (a.missing.length) return `<div class="vp-body"><div class="vp-msg">No property yet. The lead needs: ${esc(a.missing.join(', '))}.</div></div>`;
    const body = (h) => top + `<div class="vp-body">${h}</div>`;
    const msg = (t) => body(`<div class="vp-msg">${t}</div>`);
    const z = c ? siteState(c, 'zillow') : {};
    // Realtor.com / Homes.com can't be read: show the shared public records instead, clearly labelled
    const fallback = (why) => z.state === 'ok'
      ? body(`<div class="vp-banner">${icon('pin')}<div><b>${esc(s.label)} couldn't be read automatically</b> (${why}${st.code ? ` – code ${esc(st.code)}` : ''}). Below are this home's public records and estimate from Zillow. Use <b>Open on ${esc(s.label)}</b> for ${esc(s.label)}'s own page.</div></div>` + modelHTML(a, z.model, key, 'Zillow'))
      : z.state === 'loading' || z.state === 'idle' ? msg('Looking up the property…')
      : msg(`${esc(s.label)} couldn't be read automatically (${why}). Use <b>Open on ${esc(s.label)}</b> above.`);
    switch (st.state) {
      case 'idle': case 'loading':
        if (key === 'homes') return msg(`<div class="vp-wait"><span class="vp-spin"></span><div><b>Gathering information from Homes.com. Wait a second.</b>
          <div class="vp-wait-sub">A small Homes.com window opens to look up the home. <b>Don't close it.</b> It closes by itself when it's done (usually 5 to 15 seconds).</div></div></div>`);
        return msg('Looking up the property…');
      case 'ok': return body((st.picked ? `<div class="vp-banner">${icon('pin')}<div><b>Showing a close match, not the exact lead address:</b> ${esc(nearLabel(st.picked))}. Confirm the address with the borrower.</div></div>` : '') + modelHTML(a, st.model, key));
      case 'shared':
        return z.state === 'ok' ? body(`<div class="vp-note">Trulia uses the same property records as Zillow.</div>` + modelHTML(a, z.model, key))
          : msg('Couldn\'t read this home\'s details from Trulia right now.');
      case 'nosource': return fallback('the site doesn\'t allow it');
      case 'blocked':
        if (key === 'realtor' || key === 'homes') return fallback('it blocks background lookups');
        return msg(`${esc(s.label)} asked for a bot check. Click <b>Open on ${esc(s.label)}</b>, complete the check once, and the next lead will fill in.`);
      case 'nomatch': {
        const near = st.near || [];
        if (!near.length) {
          if (key === 'realtor') return fallback('no exact address match');
          return msg(`${esc(s.label)} has no exact match for this address, and no close matches in ${esc(a.state)} ${esc(a.zip)}. Check the spelling, city and ZIP.`);
        }
        return msg(`${esc(s.label)} has no exact match for this address.
          <div class="vp-near-h">Close matches in ${esc(a.state)} ${esc(a.zip)}. Click one to load it:</div>
          <div class="vp-near">${near.map((x, i) => `<button type="button" data-vp-near="${i}" data-vp-key="${key}">${icon('pin')}<span>${esc(nearLabel(x))}</span></button>`).join('')}</div>`);
      }
      default:
        if (key === 'realtor' || key === 'homes') return fallback('the page couldn\'t be read');
        return msg(`Couldn't read this home's details from ${esc(s.label)} right now.`);
    }
  }

  // Zillow and Trulia share the same photo files; Zillow hides old listing photos on off-market homes,
  // so when one site only has Street View, use the other site's full set.
  function photosFor(m) {
    const own = (m && m.photos) || [];
    const real = (x) => (x || []).filter((p) => !/streetview/i.test(p.full));
    if (real(own).length >= 2) return { list: own, street: false };
    const a = getAddress(), c = cache[a.full];
    let best = real(own);
    for (const k of ['zillow', 'trulia', 'realtor']) {
      const o = c && siteState(c, k).model;
      if (o && real(o.photos).length > best.length) best = real(o.photos);
    }
    if (best.length) return { list: best, street: false };
    return { list: own, street: own.length > 0 };
  }
  let galleryPhotos = [];
  // price/tax history: use this site's, else the other Zillow-family site's for the same home
  function historyFor(m, field) {
    if (m[field] && m[field].length) return m[field];
    const a = getAddress(), c = cache[a.full];
    for (const k of ['zillow', 'trulia']) { const o = c && siteState(c, k).model; if (o && o[field] && o[field].length) return o[field]; }
    return [];
  }
  function otherCounty() {
    const a = getAddress(), c = cache[a.full];
    for (const k of ['zillow', 'trulia']) { const o = c && siteState(c, k).model; if (o && o.county) return o.county; }
    return '';
  }

  function modelHTML(a, m, key) {
    m = Object.assign({}, m, { priceHistory: historyFor(m, 'priceHistory'), taxHistory: historyFor(m, 'taxHistory') });
    // last sale date/price from the price history when the site doesn't give them directly
    const lastSale = m.priceHistory.find((e) => /sold/i.test(e.event || ''));
    if (lastSale) m = Object.assign(m, { soldDate: m.soldDate || lastSale.date, soldPrice: isNum(m.soldPrice) ? m.soldPrice : lastSale.price });
    const th = THEMES[key];
    const est = m.estimate;
    const sinceBuy = est && m.soldPrice ? { amt: est - m.soldPrice, pct: (est - m.soldPrice) / m.soldPrice * 100 } : null;
    const mo = change(m.history, est, 30), yr = change(m.history, est, 365);
    const siteCh = m.changes || {};
    const pill = (ch, label, sc) => sc ? `<span class="vp-pill ${sc.up ? 'up' : 'down'}">${sc.up ? '↑' : '↓'} ${esc(sc.txt)} (${esc(sc.pct)}) ${label}</span>`
      : ch ? `<span class="vp-pill ${ch.amt >= 0 ? 'up' : 'down'}">${ch.amt >= 0 ? '↑' : '↓'} ${kMoney(Math.abs(ch.amt))} (${ch.amt >= 0 ? '+' : '−'}${Math.abs(ch.pct).toFixed(1)}%) ${label}</span>` : '';

    const hero = `<div class="vp-hero">
      <div><div class="lbl">${esc(m.estimateLabel || th.heading + ' estimate')}</div><div class="big">${esc(money(est) || '—')}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;padding-bottom:4px">${pill(mo, 'this month', siteCh.month)}${pill(yr, 'this year', siteCh.year)}${pill(sinceBuy, 'since purchase', siteCh.sale)}</div>
    </div>`;

    const tiles = `
      <div class="vp-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="vp-tile"><div class="k">Listed status</div><div class="v">${esc(m.status || '—')}</div>${m.listPrice ? `<div class="vp-na">List price ${esc(money(m.listPrice))}</div>` : ''}</div>
        <div class="vp-tile"><div class="k">Last sold</div><div class="v">${esc(day(m.soldDate) || '—')}</div>${ownedFor(m.soldDate)}</div>
        <div class="vp-tile"><div class="k">Bought for</div><div class="v">${esc(money(m.soldPrice) || '—')}</div></div>
      </div>`;

    const loan = parseMoney(byLabel(/^Loan\s*Amount/i)), lv = parseRange(byLabel(/^Value\s*:?$/i));
    let leadHTML = '';
    if (lv && est) {
      const shown = lv.lo === lv.hi ? money(lv.lo) : `${money(lv.lo)} – ${money(lv.hi)}`;
      const cmp = est < lv.lo ? `<span class="down">estimate is ${kMoney(lv.lo - est)} below ${lv.lo === lv.hi ? 'it' : 'this range'}</span>`
        : est > lv.hi ? `<span class="up">estimate is ${kMoney(est - lv.hi)} above ${lv.lo === lv.hi ? 'it' : 'this range'}</span>`
        : `<span class="up">estimate is within this range</span>`;
      leadHTML = `<div>Lead value <b>${shown}</b> (${cmp})</div>`;
    }
    // the open recorded mortgage (Homes.com), from this tab or the Homes.com tab if it has loaded
    let openLoan = (m.mortgages || []).find((x) => /open/i.test(x.status) && isNum(x.amount));
    if (!openLoan) { const hm = cache[getAddress().full] && siteState(cache[getAddress().full], 'homes').model; openLoan = hm && (hm.mortgages || []).find((x) => /open/i.test(x.status) && isNum(x.amount)); }
    const openHTML = openLoan && est ? `<div style="width:100%">Recorded open loan <b>${money(openLoan.amount)}</b> <span class="vp-sub" style="display:inline">(${esc(openLoan.date)}, original amount)</span> · Equity est. <b>${est - openLoan.amount < 0 ? '−' : ''}${kMoney(Math.abs(est - openLoan.amount))}</b> · LTV <b>${(openLoan.amount / est * 100).toFixed(1)}%</b></div>` : '';
    const lead = (loan || lv) && est ? `<div class="vp-lead">
      <div class="k">This lead vs. estimate</div>
      ${loan ? `<div>Loan amt <b>${money(loan)}</b></div><div>LTV <b>${(loan / est * 100).toFixed(1)}%</b></div><div>Equity est. <b>${est - loan < 0 ? '−' : ''}${kMoney(Math.abs(est - loan))}</b></div>` : ''}
      ${leadHTML}
      ${openHTML}
    </div>` : '';

    const chartW = Math.max(420, Math.round(((screen && screen.clientWidth) || 1400) - 58) * 1.15 / 2.15 - 38);
    // value history: this site's, else Zillow's/Trulia's for the same home (labeled)
    let hist = m.history, histFrom = '';
    if (!hist || hist.length < 2) {
      const c0 = cache[getAddress().full];
      for (const k of ['zillow', 'trulia']) {
        const o = c0 && siteState(c0, k).model;
        if (k !== key && o && o.history && o.history.length > 1) { hist = o.history; histFrom = SITES.find((x) => x.key === k).label; break; }
      }
    }
    const valueChart = hist && hist.length > 1
      ? (histFrom ? `<div class="vp-note">${key === 'realtor' ? 'Realtor.com only shows its value history to signed-in users' : 'This site has no value history for this home'}, so this is ${esc(histFrom)}'s history for the same home.</div>` : '') + chartSVG(hist, chartW, 260, th.chart, 'Home value estimate over time')
      : '<div class="vp-na">Value history isn\'t in this site\'s page data for this home.</div>';
    // Tax paid per year (from the tax history), like Zillow's "Tax paid" chart
    const taxPts = m.taxHistory.filter((t) => isNum(t.tax) && isNum(+t.year))
      .map((t) => ({ t: Date.UTC(+t.year, 0, 1), v: t.tax })).sort((x, y) => x.t - y.t);
    const assessPts = m.taxHistory.filter((t) => isNum(t.value) && t.value > 0 && isNum(+t.year))
      .map((t) => ({ t: Date.UTC(+t.year, 0, 1), v: t.value })).sort((x, y) => x.t - y.t);
    const panes = [['value', 'Home values', valueChart]];
    if (taxPts.length > 1) panes.push(['tax', 'Tax paid', chartSVG(taxPts, chartW, 260, th.chart, 'Property tax paid by year')]);
    if (assessPts.length > 1) panes.push(['assess', 'Assessment', chartSVG(assessPts, chartW, 260, th.chart, 'Tax assessment by year')]);
    const chart = panes.length > 1
      ? `<div class="vp-ctabs" role="tablist">${panes.map(([k, l], i) => `<button type="button" class="${i ? '' : 'on'}" data-vp-chart="${k}">${l}</button>`).join('')}</div>
         ${panes.map(([k, , html], i) => `<div data-vp-pane="${k}"${i ? ' hidden' : ''}>${html}</div>`).join('')}`
      : valueChart;

    // one card, one look: icon + label + value for every fact
    const item = (ic, k, v, sub) => `<div><span class="ic">${icon(ic)}</span><div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${sub ? `<div class="k">${esc(sub)}</div>` : ''}</div></div>`;
    const section = (title, items) => items.length ? `<h4 class="vp-sec">${esc(title)}</h4><div class="vp-hl wide">${items.join('')}</div>` : '';

    const hlItems = [
      ['home', 'Type', m.type], ['cal', 'Built', m.yearBuilt], ['ruler', 'Size', m.sqft ? num(m.sqft) + ' sqft' : ''],
      ['tag', 'Price / sqft', est && m.sqft ? money(est / m.sqft) : ''], ['bed', 'Beds / baths', isNum(m.beds) && isNum(m.baths) ? `${m.beds} bd / ${m.baths} ba` : ''],
      ['tree', 'Lot', m.lot], ['car', 'Parking', m.parking], ['people', 'HOA', m.hoa], ['dollar', 'Rent estimate', m.rent], ['pin', 'County', m.county || otherCounty() || m.countyGuess]
    ].filter(([, , v]) => v).map(([ic, k, v]) => item(ic, k, v));

    const GROUP_ICON = { 'Interior': 'bed', 'Heating & Cooling': 'home', 'Exterior': 'tree', 'Parking & Garage': 'car',
      'Lot & Utilities': 'ruler', 'Community & HOA': 'people', 'At a glance': 'home' };
    const groupIcon = (g) => /park|garage/i.test(g) ? 'car' : /lot/i.test(g) ? 'ruler' : /exterior|roof/i.test(g) ? 'tree'
      : /community|hoa/i.test(g) ? 'people' : /year/i.test(g) ? 'cal' : /level|floor|bed|interior/i.test(g) ? 'bed' : 'home';
    const seen = new Set(['bedrooms', 'lot size', 'parking capacity', 'year built', 'property type', 'living area', 'lot area', 'parking spaces', 'price/sqft']); // already shown above
    const detItems = [];
    m.groups.map(([g, rows]) => {
      // value-only facts (e.g. Dishwasher, Disposal, Microwave) become one line under the group name
      const named = rows.filter(([k]) => k), bare = rows.filter(([k]) => !k).map(([, v]) => v);
      return (bare.length ? named.concat([['', bare.join(', ')]]) : named);
    }).forEach((rows, gi) => rows.forEach(([k, v]) => {
      const g = m.groups[gi][0];
      const label = k || g;
      if (seen.has(label.toLowerCase())) return;
      seen.add(label.toLowerCase());
      detItems.push(item(GROUP_ICON[g] || groupIcon(g), label, v));
    }));

    // Price history and public tax history as compact tables (like Zillow's), each scrolling in its own box
    const pctTag = (r) => isNum(r) && r !== 0 ? ` <span class="vp-pct ${r > 0 ? 'up' : 'down'}">${r > 0 ? '+' : '−'}${Math.abs(r * 100).toFixed(1).replace(/\.0$/, '')}%</span>` : '';
    // fill in tax/assessment % changes when the site doesn't give them (vs. the year before)
    const hasLand = m.taxHistory.some((t) => isNum(t.land) || isNum(t.improvement));
    const taxRows = m.taxHistory.slice().sort((x, y) => (+y.year || 0) - (+x.year || 0)).map((t, i, arr) => {
      const prev = arr[i + 1];
      // our own year-over-year % when the site gives none; hidden above 100% (exemptions/record quirks, e.g. $27 -> $1,954)
      const calc = (a, b) => (isNum(a) && isNum(b) && b > 0 && Math.abs((a - b) / b) <= 1) ? (a - b) / b : null;
      const tr = isNum(t.taxRate) ? t.taxRate : (prev ? calc(t.tax, prev.tax) : null);
      const vr = isNum(t.valueRate) ? t.valueRate : (prev ? calc(t.value, prev.value) : null);
      return `<tr><td>${esc(t.year)}</td><td>${isNum(t.tax) ? money(t.tax) + pctTag(tr) : '--'}</td><td>${isNum(t.value) ? money(t.value) + pctTag(vr) : '--'}</td>${hasLand ? `<td>${isNum(t.land) ? money(t.land) : '--'}</td><td>${isNum(t.improvement) ? money(t.improvement) : '--'}</td>` : ''}</tr>`;
    }).join('');
    const priceRows = m.priceHistory.map((e) => `<tr><td>${esc(day(e.date))}</td><td>${esc(e.event || '')}</td>
      <td>${isNum(e.price) ? money(e.price) + pctTag(e.rate) : '--'}${isNum(e.ppsf) ? `<div class="vp-sub">${money(e.ppsf)}/sqft</div>` : ''}${e.source ? `<div class="vp-sub">Source: ${esc(e.source)}</div>` : ''}</td></tr>`).join('');
    const histTables = (priceRows || taxRows) ? `<div class="vp-hist">
      <div><h4 class="vp-sec">Price history</h4>${priceRows ? `<div class="vp-scroll"><table class="vp-t2"><thead><tr><th>Date</th><th>Event</th><th>Price</th></tr></thead><tbody>${priceRows}</tbody></table></div>` : '<div class="vp-na">No price history.</div>'}</div>
      <div><h4 class="vp-sec">Public tax history</h4>${taxRows ? `<div class="vp-scroll"><table class="vp-t2"><thead><tr><th>Year</th><th>Property taxes</th><th>Tax assessment</th>${hasLand ? '<th>Land</th><th>Improvement</th>' : ''}</tr></thead><tbody>${taxRows}</tbody></table></div>` : '<div class="vp-na">No tax history.</div>'}</div>
    </div>` : '';

    const facts = section('Highlights', hlItems) + section('Home details', detItems);
    const own = (m.ownership || []).map((o) => `<tr><td>${esc(o.dates)}</td><td>${o.name ? esc(o.name) : '<span class="vp-sub">—</span>'}</td><td>${esc(o.ownedFor)}</td><td>${esc(o.type)}</td></tr>`).join('');
    const ownBlock = own ? `<div><h4 class="vp-sec">Ownership history</h4><div class="vp-scroll vp-own"><table class="vp-t2"><thead><tr><th>Date</th><th>Name</th><th>Owned for</th><th>Owner type</th></tr></thead><tbody>${own}</tbody></table></div></div>` : '';
    const mort = (m.mortgages || []).map((x) => `<tr><td>${esc(x.date)}</td><td>${/open/i.test(x.status) ? `<b class="up">${esc(x.status)}</b>` : esc(x.status)}</td><td>${x.borrower ? esc(x.borrower) : '<span class="vp-sub">—</span>'}</td><td>${isNum(x.amount) ? money(x.amount) : '--'}</td></tr>`).join('');
    const mortBlock = mort ? `<div><h4 class="vp-sec">Mortgage history</h4><div class="vp-scroll vp-own"><table class="vp-t2"><thead><tr><th>Date</th><th>Status</th><th>Borrower</th><th>Loan amount</th></tr></thead><tbody>${mort}</tbody></table></div><div class="vp-sub" style="margin-top:4px">Amounts are the original recorded loan amounts, not today's balance.</div></div>` : '';
    const ownership = (mortBlock || ownBlock) ? `<div class="vp-hist">${mortBlock}${ownBlock}</div>` : '';

    const pf = photosFor(m), ph = pf.list;
    galleryPhotos = ph;
    const gallery = ph.length ? `<div class="vp-card vp-gal">
      <h3>${pf.street ? 'Street view' : 'Photos'} <span class="vp-count">${ph.length > 1 ? `<span data-vp-n>1</span> of ${ph.length}` : ''}</span></h3>
      <div class="vp-stage">
        <img data-vp-main src="${esc(ph[0].full)}" data-fallback="${esc(ph[0].thumb || '')}" onerror="if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback}" alt="${esc(ph[0].caption || 'Photo of ' + (m.street || a.street))}" referrerpolicy="no-referrer">
        ${ph.length > 1 ? '<button type="button" class="vp-nav prev" data-vp-step="-1" aria-label="Previous photo">‹</button><button type="button" class="vp-nav next" data-vp-step="1" aria-label="Next photo">›</button>' : ''}
      </div>
      ${ph.length > 1 ? `<div class="vp-thumbs">${ph.map((x, i) => `<button type="button" data-vp-i="${i}" class="${i ? '' : 'on'}" aria-label="Photo ${i + 1}"><img src="${esc(x.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div>` : ''}
    </div>` : '';

    const factsTitle = `Home highlights for ${esc(m.street || a.street)}`;
    const factsBody = facts || '<div class="vp-na">No home facts listed.</div>';
    // photos on the left, Home highlights as a vertical panel beside them (same height, scrolls inside)
    const top = gallery
      ? `<div class="vp-top-row">${gallery}<div class="vp-card vp-side"><h3>${factsTitle}</h3><div class="vp-side-scroll">${factsBody}</div></div></div>`
      : `<div class="vp-card" style="margin-bottom:14px"><h3>${factsTitle}</h3>${factsBody}</div>`;
    return hero + top + `
      <div class="vp-grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.15fr)">
        <div class="vp-card"><h3>Sale &amp; value</h3>${tiles}${lead}</div>
        <div class="vp-card"><h3>Value over time</h3>${chart}</div>
      </div>
      ${histTables || ownership ? `<div class="vp-card" style="margin-top:14px"><h3>${ownership ? 'Price, tax, mortgage &amp; ownership history' : 'Price &amp; tax history'}</h3>${histTables}${ownership ? `<div class="vp-own-wrap">${ownership}</div>` : ''}</div>` : ''}`;
  }

  // --- the tabs next to SCRIPT 2 ---
  const tabs = {};
  let screen = null, openKey = null, lastScreenKey = '';

  function findScriptTab() {
    const els = [...document.querySelectorAll('a, td, span, div, b, font, img')].filter((e) => !e.closest('#vprop-screen, .vprop-tab'));
    const isTab = (e, re) => e.tagName === 'IMG' ? re.test(e.alt || '') || re.test(e.src || '')
      : e.children.length === 0 && re.test((e.textContent || '').trim());
    return els.filter((e) => isTab(e, /^SCRIPT\s*2$|script_?2|script2/i)).pop() ||
      els.filter((e) => isTab(e, /^SCRIPT$|tab_script/i)).pop() || null;
  }

  // The tabs float on top of Vici's header, right after SCRIPT 2 (no room in Vici's own row)
  let tabBar = null;
  function addTabs() {
    if (!tabBar || !document.body.contains(tabBar)) {
      tabBar = document.createElement('div');
      tabBar.id = 'vprop-tabbar';
      SITES.forEach((s) => {
        const t = document.createElement('span');
        t.className = 'vprop-tab';
        t.setAttribute('role', 'button');
        t.tabIndex = 0;
        t.style.color = s.color;
        t.innerHTML = `${favicon(s, 32)}<span class="lbl vp-sr">${esc(s.label)}</span><span class="dot"></span>`;
        t.setAttribute('aria-label', s.label);
        t.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleScreen(s.key); });
        t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleScreen(s.key); } });
        tabBar.appendChild(t);
        tabs[s.key] = t;
      });
      document.body.appendChild(tabBar);
      // clicking any of Vici's own tabs (MAIN / SCRIPT / SCRIPT 2) closes the site screen
      document.addEventListener('click', (e) => {
        if (!openKey || e.target.closest('#vprop-tabbar, #vprop-screen')) return;
        const a = e.target.closest('a');
        if (a && /PanelToFront|Script|MainPanel/i.test(a.getAttribute('onclick') || '')) closeScreen();
        else if (e.target.tagName === 'IMG' && /tab/i.test(e.target.src || '')) closeScreen();
      }, true);
    }
    return placeTabs();
  }

  // Is this element really showing (not hidden, and not covered by Vici's login/logout/pause boxes)?
  function onScreen(el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;            // scrolled out of view still counts as showing
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    }
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return true; // scrolled off – can't test cover
    const hit = document.elementFromPoint(x, y);
    const own = el.closest('a') || el;
    return !!hit && (own === hit || own.contains(hit) || hit.contains(own));
  }

  // Tabs only show on the logged-in agent screen: Vici's SCRIPT tab and the lead form are visible
  function agentScreenUp(ref) {
    const addr1 = field('address1');
    return !!(ref && onScreen(ref) && addr1);
  }

  function placeTabs() {
    const ref = findScriptTab();
    if (!agentScreenUp(ref)) {
      tabBar.style.display = 'none';
      if (openKey) closeScreen();
      return false;
    }
    tabBar.style.display = '';
    const r = ref.getBoundingClientRect();
    const h = Math.max(20, Math.min(r.height || 24, 34));
    Object.assign(tabBar.style, { left: r.right + 6 + window.scrollX + 'px', top: r.top + window.scrollY + 'px', height: h + 'px' });
    const icon = Math.max(16, h - 6);   // icon fills the tab, 3px breathing room top and bottom
    tabBar.querySelectorAll('.vprop-tab').forEach((t) => {
      t.style.height = h + 'px';
      const img = t.querySelector('.vp-fav');
      if (img) { img.width = icon; img.height = icon; }
    });
    return true;
  }

  // cover the same area the SCRIPT screens use
  function placeScreen() {
    const sp = document.getElementById('ScriptPanel');
    const r = sp && sp.getBoundingClientRect();
    let left, top, width, height;
    if (r && r.width > 300 && r.height > 200) {
      left = r.left; top = r.top;
      // never wider/taller than the window (zoomed in, Vici's panel can run past the edge)
      width = Math.min(r.width, window.innerWidth - Math.max(0, left) - 10);
      height = Math.min(r.height, window.innerHeight - Math.max(0, top) - 10);
    }
    else {
      const t = tabs[SITES[0].key].getBoundingClientRect();
      left = 157; top = t.bottom + 24;
      width = Math.min(1445, window.innerWidth - left - 10);
      height = window.innerHeight - top - 10;
    }
    Object.assign(screen.style, { left: left + window.scrollX + 'px', top: top + window.scrollY + 'px', width: width + 'px', height: height + 'px' });
  }

  function openScreen(key) {
    if (!screen) {
      screen = document.createElement('div');
      screen.id = 'vprop-screen';
      screen.addEventListener('click', (e) => {
        const nb = e.target.closest('[data-vp-near]');
        if (nb) {
          const a = getAddress(), c = cache[a.full];
          if (c) pickNear(a, c, nb.dataset.vpKey, Number(nb.dataset.vpNear));
          return;
        }
        const ct = e.target.closest('[data-vp-chart]');
        if (ct) {
          screen.querySelectorAll('[data-vp-chart]').forEach((b) => b.classList.toggle('on', b === ct));
          screen.querySelectorAll('[data-vp-pane]').forEach((p) => { p.hidden = p.dataset.vpPane !== ct.dataset.vpChart; });
          return;
        }
        const step = e.target.closest('[data-vp-step]'), th = e.target.closest('[data-vp-i]');
        if (step || th) showPhoto(step ? photoIndex + Number(step.dataset.vpStep) : Number(th.dataset.vpI));
      });
      screen.tabIndex = -1;
      screen.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') showPhoto(photoIndex + 1);
        if (e.key === 'ArrowLeft') showPhoto(photoIndex - 1);
      });
      document.body.appendChild(screen);
    }
    openKey = key;
    placeScreen();
    screen.classList.add('open');
    Object.keys(tabs).forEach((k) => tabs[k].classList.toggle('active', k === key));
    const a = getAddress();
    if (!a.missing.length) { const c = lookup(a); if (c.done) loadSite(a, c, key); }
    lastScreenKey = '';
    renderAll();
  }
  let photoIndex = 0;
  function showPhoto(i) {
    const thumbs = screen.querySelectorAll('[data-vp-i]');
    const main = screen.querySelector('[data-vp-main]');
    if (!main || !thumbs.length) return;
    photoIndex = (i + thumbs.length) % thumbs.length;
    const a = getAddress(), c = cache[a.full];
    const st = c && siteState(c, openKey);
    const ph = galleryPhotos[photoIndex];
    if (ph) { main.dataset.fallback = ph.thumb || ''; main.src = ph.full; }
    thumbs.forEach((t, k) => t.classList.toggle('on', k === photoIndex));
    thumbs[photoIndex].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const n = screen.querySelector('[data-vp-n]'); if (n) n.textContent = String(photoIndex + 1);
  }

  function closeScreen() {
    openKey = null;
    setTimeout(renderAll, 0);
    if (screen) screen.classList.remove('open');
    Object.keys(tabs).forEach((k) => tabs[k].classList.remove('active'));
  }
  function toggleScreen(key) { openKey === key ? closeScreen() : openScreen(key); }

  function renderAll() {
    if (!addTabs()) { if (card) card.style.display = 'none'; return; }
    const a = getAddress(), c = a.missing.length ? null : cache[a.full];
    renderCard(a, c);
    SITES.forEach((s) => {
      const st = c ? siteState(c, s.key).state : 'idle';
      tabs[s.key].classList.toggle('ready', st === 'ok' || st === 'shared');
      tabs[s.key].classList.toggle('fail', ['blocked', 'nomatch', 'nosource', 'error'].includes(st));
      tabs[s.key].title = `${s.label}: ` + ({ ok: 'facts ready', shared: 'facts ready', loading: 'loading…', blocked: 'blocked by the site – open it directly',
        nomatch: 'no exact match', nosource: 'open on the site', error: 'couldn\'t load', idle: 'waiting for a lead address' }[st] || st);
    });
    // Homes.com only loads when its tab is open
    if (openKey === 'homes' && c && c.done && siteState(c, 'homes').state === 'idle') loadSite(a, c, 'homes');
    if (!screen || !openKey) return;
    const st = c ? siteState(c, openKey) : {};
    const key = openKey + '|' + a.full + '|' + st.state + '|' + (c ? SITES.map((x) => siteState(c, x.key).state).join(',') : '') + '|' + byLabel(/^Loan\s*Amount/i) + '|' + byLabel(/^Value\s*:?$/i);
    if (key === lastScreenKey) return;
    lastScreenKey = key;
    const th = THEMES[openKey];
    Object.keys(th).forEach((k) => { if (typeof th[k] === 'string' && !/Url|heading/.test(k)) screen.style.setProperty('--' + k, th[k]); });
    screen.innerHTML = screenHTML(a, c, openKey);
    photoIndex = 0;
  }



  // =====================================================================
  //  Screen layout – rearranges Vici's own pieces (same elements, same ids, still inside
  //  Vici's form, so everything keeps saving and working). Positions come from the
  //  layout playground export. To bring a hidden piece back, change its line here.
  // =====================================================================
  // Who gets the new layout: Vici user IDs. Empty list = everyone.
  const LAYOUT_USERS = ['110'];
  let LAYOUT_ON = false, layoutUserChecked = false;
  function layoutAllowed() {
    if (layoutUserChecked) return LAYOUT_ON;
    const h = document.getElementById('Header');
    const m = h && (h.textContent || '').match(/Logged in as User\W+([\w.-]+)/i);
    if (!m) return false;
    layoutUserChecked = true;
    LAYOUT_ON = !LAYOUT_USERS.length || LAYOUT_USERS.includes(m[1]);
    return LAYOUT_ON;
  }
  const L = {
    status: [10, 55], custtime: [5, 80], dialable: [10, 105], pause: [10, 135],
    webform: [10, 160], park: [10, 185], transfer: [10, 210], hangup: [10, 235], dtmf: [10, 265],
    manual: [40, 355], leadsearch: [35, 385], callbacks: [5, 415],
    form: [170, 114],             // the form's own 14px top padding is drawn by Vici's grey, so 100 + 14
    card: [15, 465, 890],
    seconds: [1510, 30], liveLight: [1610, 25], groups: [1765, 5],
    agentsList: [1720, 45], agentsLink: [1725, 30], hotkeys: [1730, 300]
  };
  const byId = (id) => document.getElementById(id);
  let laidOut = false, viewsSet = false;

  function box(id, x, y, extra) {
    let b = byId(id);
    if (!b) {
      b = document.createElement('div');
      b.id = id;
      (byId('vicidial_form') || document.body).appendChild(b); // inside Vici's form, so fields still save
    }
    b.style.cssText = `position:absolute;left:${x}px;top:${y}px;z-index:6;${extra || ''}`;
    return b;
  }
  const move = (el, into) => { if (el && into && el.parentElement !== into) into.appendChild(el); return el; };
  // things we hide: kept in the page (Vici's code still uses them), just not shown
  function stash(el) { if (el) move(el, box('vl-hidden', 0, 0, 'visibility:hidden;width:0;height:0;overflow:hidden')); }

  function applyLayout() {
    if (!layoutAllowed()) return;
    const main = byId('MainPanel'), form = byId('vicidial_form');
    if (!main || !form || !byId('address1') || !byId('MainPanelCustInfo')) return;
    // pieces Vici moves around on its own are pinned with !important rules
    if (!byId('vl-style')) {
      const st = document.createElement('style'); st.id = 'vl-style';
      st.textContent = `
        #DiaLlOgButtonspan{left:${L.manual[0]}px!important;top:${L.manual[1]}px!important}
        #ManuaLDiaLButtons a[onclick*="'FAST'"]{display:none!important}
        #CallbacksButtons{left:${L.callbacks[0]}px!important;top:${L.callbacks[1]}px!important}
        #SecondSspan{left:${L.seconds[0]}px!important;top:${L.seconds[1]}px!important}
        #AgentViewSpan{left:${L.agentsList[0]}px!important;top:${L.agentsList[1]}px!important}
        #webphoneLinkSpan{visibility:hidden!important}
        #dialableleadsspan{left:${L.dialable[0]}px!important;top:${L.dialable[1]}px!important}
        #AgentViewLinkSpan{left:${L.agentsLink[0]}px!important;top:${L.agentsLink[1]}px!important}
        #AgentViewLinkSpan td{text-align:left!important}
        #vl-hkwrap{z-index:30!important}
        #MainCommit,#MaiNfooterspan,#hotkeysdisplay,#HotKeyEntriesBox{visibility:hidden!important}
        html,body,#Header table,#Tabs table,#Tabs td,#AgentViewSpan,#AgentViewSpan table{background:#ccc!important;background-color:#ccc!important}
        #vl-form{font:13px Arial,Helvetica,sans-serif;width:720px;padding:0 16px;box-sizing:content-box}
        #vl-form .vl-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        #vl-form fieldset{border:1px solid #a9a9a9;border-radius:6px;margin:0 0 12px;padding:6px 10px 10px;background:#d4d4d4}
        #vl-form legend{font-weight:bold;font-size:11px;letter-spacing:.04em;color:#333;padding:0 4px}
        #vl-form .r{display:grid;grid-template-columns:104px 1fr;align-items:center;gap:6px;margin-top:6px}
        #vl-form .r>label{text-align:right}
        #vl-form .g{display:grid;gap:8px;align-items:center}
        #vl-form .m{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:6px}
        #vl-form input[type=text],#vl-form select,#vl-form textarea{width:100%;box-sizing:border-box;min-width:0}
        #vl-form .ttl{font:bold 11px Arial;color:#333;margin:0 0 4px}
        #vl-form #call_notes{height:46px}
        .vl-btn{width:154px;text-align:center}
        #vl-pause.vl-empty{visibility:hidden}
        #vl-hk{width:166px;height:38px;border:0;border-radius:9px;background:linear-gradient(#3d78d6,#2a5bb0);color:#fff;display:flex;align-items:center;justify-content:center;gap:8px;
          font:600 14px "Segoe UI",Arial,sans-serif;box-shadow:0 2px 5px rgba(0,0,0,.25);cursor:pointer}
        #vl-hk i{width:10px;height:10px;border-radius:50%;background:#9fb7de}
        #vl-hk.on{background:linear-gradient(#2fbf4f,#159a35)} #vl-hk.on i{background:#d9ffd9}
        #vl-hklist{margin-top:8px;width:166px;box-sizing:border-box;background:#ffeebb;border:1px solid #e3c77a;border-radius:8px;padding:6px 8px;font:12px/1.5 Arial,sans-serif;display:none}
        #vl-hk.on+#vl-hklist{display:block}`;
      document.head.appendChild(st);
    }

    if (!laidOut) {
      laidOut = true;
      const field = (id) => byId(id);
      // STATUS line
      const statusFont = byId('MainStatuSSpan') && byId('MainStatuSSpan').closest('font');
      move(statusFont, box('vl-status', ...L.status, 'white-space:nowrap'));
      // Customer Time (Channel hidden)
      const ct = box('vl-custtime', ...L.custtime, 'white-space:nowrap');
      ct.className = 'body_text';
      ct.textContent = 'Customer Time: ';
      move(byId('custdatetime'), ct);
      stash(byId('callchannel'));
      // LEAD SEARCH (the "Customer Information:" label stays hidden)
      const ls = [...byId('MainPanelCustInfo').querySelectorAll('a')].find((x) => /LEAD SEARCH/i.test(x.textContent));
      move(ls && ls.closest('font'), box('vl-leadsearch', ...L.leadsearch));
      stash(byId('CusTInfOSpaN'));
      // pause / resume button and the dial-preview pieces that sit with it
      const pb = box('vl-pause', ...L.pause, 'width:154px;text-align:center');
      ['DiaLControl', 'ManualQueueNotice', 'ManualQueueChoice', 'DiaLLeaDPrevieW', 'DiaLDiaLAltPhonE'].forEach((id) => move(byId(id), pb));
      move(byId('NexTCalLPausE') && byId('NexTCalLPausE').closest('font'), pb);
      // Web form / Park / Transfer / Hangup / Send DTMF: each button is its own box
      [['webform', ['WebFormSpan']], ['park', ['ParkCounterSpan', 'ParkControl', 'ivrParkControl']],
       ['transfer', ['XferControl', 'ReQueueCall']], ['hangup', ['HangupControl']], ['dtmf', ['SendDTMFdiv']]].forEach(([k, ids]) => {
        const bx = box('vl-b-' + k, ...L[k]); bx.className = 'vl-btn';
        ids.forEach((id) => { let el = byId(id); if (!el) return; if (id === 'ParkCounterSpan') el = el.closest('font') || el; move(el, bx); });
      });
      stash(byId('SpacerSpanC')); stash(byId('SpacerSpanD')); stash(byId('WebFormSpanTwo')); // Web Form 2 hidden
      // live-call light and GROUPS / LOGOUT
      const live = document.querySelector('img[name="livecall"]');
      move(live, box('vl-live', ...L.liveLight));
      const grp = [...(byId('Header') || document).querySelectorAll('a')].find((x) => /GROUPS/.test(x.textContent));
      move(grp && grp.closest('font'), box('vl-groups', ...L.groups, 'white-space:nowrap'));
      // what's left of Vici's left column (recording file / record id / stop recording) is hidden
      const leftTd = byId('RecorDControl') && byId('RecorDControl').closest('td');
      if (leftTd) leftTd.style.visibility = 'hidden';
      // reorganized lead form: Borrower / Property / Loan, then Call Notes (Installments hidden)
      const f = box('vl-form', ...L.form);
      if (!f.childElementCount) {
        f.innerHTML = `<div class="vl-cols"><div>
          <fieldset><legend>BORROWER</legend>
            <div class="r"><label>Name:</label><div class="g" style="grid-template-columns:1.6fr .7fr 1fr" data-s="first_name,middle_initial,last_name"></div></div>
            <div class="r"><label>Phone:</label><div class="g" style="grid-template-columns:1fr 1fr"><span class="body_text" data-s="phone_numberDISP,phone_number"></span><div class="m"><label>DialCode:</label><span data-s="phone_code"></span></div></div></div>
            <div class="r"><label>Date of Birth:</label><div class="g" style="grid-template-columns:.75fr 1.4fr"><span class="body_text" data-s="date_of_birthDISP"></span><div class="m"><label>Gender:</label><span data-s="GENDERhideFORie"></span></div></div></div>
            <div class="r"><label>FICO:</label><div class="g" style="grid-template-columns:1fr 1fr"><span data-s="title"></span><div class="m"><label>SSN:</label><span data-s="alt_phone"></span></div></div></div>
          </fieldset>
          <fieldset><legend>PROPERTY</legend>
            <div class="r"><label>Address1:</label><span data-s="address1"></span></div>
            <div class="r"><label>City:</label><span data-s="city"></span></div>
            <div class="r"><label>State:</label><div class="g" style="grid-template-columns:.5fr 1.5fr"><span data-s="state"></span><div class="m"><label>PostCode:</label><span data-s="postal_code"></span></div></div></div>
          </fieldset></div>
          <fieldset><legend>LOAN</legend>
            <div class="r"><label>Loan Amount:</label><span data-s="address2"></span></div>
            <div class="r"><label>Value:</label><span data-s="province"></span></div>
            <div class="r"><label>Rate:</label><span data-s="security_phrase"></span></div>
            <div class="r"><label>Loan Type:</label><span data-s="vendor_lead_code"></span></div>
            <div class="r"><label>Cash Out:</label><span data-s="address3"></span></div>
            <div class="r"><label>Revolving Debt:</label><span data-s="email"></span></div>
          </fieldset></div>
          <div class="ttl">CALL NOTES</div><span data-s="call_notes"></span>`;
        f.querySelectorAll('[data-s]').forEach((slot) => slot.dataset.s.split(',').forEach((id) => move(field(id), slot)));
        // Name row: First / MI / Last side by side
        const mi = byId('middle_initial'); if (mi) mi.placeholder = 'MI';
        stash(byId('comments')); stash(byId('viewcommentsdisplay'));
      }
      byId('MainPanelCustInfo').style.visibility = 'hidden';
      // Date / session ID / Calls in Queue at the top
      const clock = byId('status') && byId('status').closest('td');
      if (clock) clock.style.visibility = 'hidden';
    }

    // pause bar only shows when it's a real button (paused / active), not the empty grey bar during calls
    const pb = byId('vl-pause'), dc = byId('DiaLControl');
    if (pb && dc) { const imgs = [...dc.querySelectorAll('img')]; pb.classList.toggle('vl-empty', !imgs.length || imgs.every((i) => /_OFF\.gif|blank/i.test(i.src))); }

    // once per login: WebPhone panel hidden (it keeps running), Agents View shown
    if (!viewsSet && byId('webphoneLink') && byId('AgentViewLink')) {
      viewsSet = true;
      const wp = byId('webphoneLink').querySelector('a'), av = byId('AgentViewLink').querySelector('a');
      if (wp && /View\s*-/.test(wp.textContent)) wp.click();
      if (av && /View\s*\+/.test(av.textContent)) av.click();
    }
    hotKeysSwitch();
    scrollLock();
  }

  // ---------- HOT KEYS on/off switch (drives Vici's own hot keys) ----------
  const hkOn = () => { const i = byId('hotkeysdisplay') && byId('hotkeysdisplay').querySelector('img'); return !!i && /ACTIVE/i.test(i.alt || '') && !/INACTIVE/i.test(i.alt || ''); };
  const hkSet = (on) => {
    const a = byId('hotkeysdisplay') && byId('hotkeysdisplay').querySelector('a');
    if (a && on !== hkOn()) a.dispatchEvent(new MouseEvent(on ? 'mouseover' : 'mouseout', { bubbles: true }));
  };
  let hkLead = null;
  function hotKeysSwitch() {
    if (!byId('hotkeysdisplay')) return;
    const wrap = box('vl-hkwrap', ...L.hotkeys);
    if (!byId('vl-hk')) {
      wrap.innerHTML = '<button type="button" id="vl-hk" title="Click to turn Hot Keys on or off"><i></i><span>HOT KEYS: OFF</span></button><div id="vl-hklist"></div>';
      byId('vl-hk').addEventListener('click', (e) => { e.preventDefault(); hkSet(!hkOn()); hotKeysSwitch(); });
    }
    // a new call starts with Hot Keys off
    const lead = byId('lead_id') ? byId('lead_id').value : '';
    if (hkLead !== null && lead !== hkLead && hkOn()) hkSet(false);
    hkLead = lead;
    const on = hkOn();
    byId('vl-hk').classList.toggle('on', on);
    byId('vl-hk').querySelector('span').textContent = 'HOT KEYS: ' + (on ? 'ON' : 'OFF');
    if (on) {
      // Vici's own list is hidden, so read its text (one line per <br>)
      const lines = ['HotKeyBoxA', 'HotKeyBoxB', 'HotKeyBoxC'].map((id) => byId(id) ? byId(id).innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ') : '')
        .join('\n').split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      byId('vl-hklist').textContent = lines;
      byId('vl-hklist').style.whiteSpace = 'pre-line';
    }
  }
  // typing a number in a box (Call Notes, Loan Amount…) must never disposition the call
  window.addEventListener('keypress', (e) => {
    if (!LAYOUT_ON || !hkOn()) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t.type !== 'button') e.stopImmediatePropagation();
  }, true);

  // ---------- no page scrollbars when everything fits ----------
  function scrollLock() {
    const parts = ['MainTable', 'vl-form', 'vl-groups', 'vl-hkwrap', 'vprop-card', 'AgentViewSpan', 'webphoneSpan']
      .map(byId).filter((e) => e && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none');
    let w = 0, h = 0;
    parts.forEach((e) => { const r = e.getBoundingClientRect(); w = Math.max(w, r.right + window.scrollX); h = Math.max(h, r.bottom + window.scrollY); });
    const fits = w && w <= window.innerWidth + 1 && h <= window.innerHeight + 1;
    const v = fits ? 'hidden' : '';
    if (document.documentElement.style.overflow !== v) { document.documentElement.style.overflow = v; document.body.style.overflow = v; if (fits) window.scrollTo(0, 0); }
  }

  // =====================================================================
  //  At-a-glance card in the empty grey area under Call Notes on the main screen
  // =====================================================================
  let card = null, lastCardKey = '';
  const CARD_ORDER = ['zillow', 'trulia', 'realtor', 'homes'];
  function cardAnchor() {
    const notes = field('call_notes') || [...document.querySelectorAll('textarea')].filter((t) => !t.closest('#vprop-screen, #vprop-card') && onScreen(t)).pop();
    return notes || field('address1');
  }
  function mainPanelOf(el) { for (let e = el; e && e !== document.body; e = e.parentElement) if (/MainPanel/i.test(e.id || '')) return e; return null; }

  function cardHTML(a, c) {
    const st = (k) => siteState(c, k);
    const ok = CARD_ORDER.filter((k) => st(k).state === 'ok' && st(k).model);
    const label = (k) => SITES.find((x) => x.key === k).label;
    const head = (extra) => `<div class="vc-head"><span class="vc-title">Property at a glance</span><span class="vc-addr">${esc(a.full)}</span><span class="vc-sp"></span>${extra || ''}</div>`;
    if (!c || !c.done || (!ok.length && CARD_ORDER.some((k) => ['loading'].includes(st(k).state) || (k !== 'homes' && st(k).state === 'idle'))))
      return head() + `<div class="vc-wait"><span class="vc-spin"></span>Looking up this property…</div>`;
    if (!ok.length) {
      const near = CARD_ORDER.some((k) => (st(k).near || []).length);
      return head() + `<div class="vc-msg">${near ? 'No exact match for this address. <b>Open a property tab to pick the right home</b> from the close matches.' : 'No property details found for this address. Check the spelling, city and ZIP.'}</div>`;
    }
    // main numbers from the first site that loaded (Zillow first); gaps filled from the others
    const ms = ok.map((k) => Object.assign({ key: k }, st(k).model));
    const pick = (f) => { for (const m of ms) if (m[f] !== undefined && m[f] !== null && m[f] !== '' && m[f] !== '—') return m[f]; return null; };
    const main = ms[0];
    const est = main.estimate;
    // most recent sale any site knows about (sites lag each other on recent sales)
    const when = (d) => { const t = Date.parse(String(d || '').replace(/^(\d{4}-\d{2}-\d{2}).*/, '$1')); return isNaN(t) ? null : t; };
    let soldDate = null, soldPrice = null, soldT = -Infinity;
    for (const m of ms.concat(st('homes').model && !ok.includes('homes') ? [st('homes').model] : [])) {
      const cands = [{ date: m.soldDate, price: m.soldPrice }].concat((m.priceHistory || []).filter((x) => /sold/i.test(x.event || '')));
      for (const x of cands) { const t = when(x.date); if (t !== null && t > soldT) { soldT = t; soldDate = x.date; soldPrice = isNum(x.price) ? x.price : null; } }
    }
    const others = ms.filter((m) => isNum(m.estimate)).map((m) =>
      `<button type="button" class="vc-site" data-vc-open="${m.key}" title="Open the ${esc(label(m.key))} tab">${favicon(SITES.find((x) => x.key === m.key), 14)}${kMoney(m.estimate)}</button>`).join('');

    const loan = parseMoney(byLabel(/^Loan\s*Amount/i)), lv = parseRange(byLabel(/^Value\s*:?$/i));
    const eq = (amt) => `${est - amt < 0 ? '−' : ''}${kMoney(Math.abs(est - amt))}`;
    const ltvCls = (amt) => amt / est > 0.97 ? 'down' : amt / est > 0.8 ? 'warn' : 'up';
    let vsLead = '—', vsSub = '';
    if (lv && isNum(est)) {
      vsLead = lv.lo === lv.hi ? money(lv.lo) : `${kMoney(lv.lo)}–${kMoney(lv.hi)}`;
      vsSub = est < lv.lo ? `<span class="down">Estimate ${kMoney(lv.lo - est)} below</span>` : est > lv.hi ? `<span class="up">Estimate ${kMoney(est - lv.hi)} above</span>` : '<span class="up">Estimate within range</span>';
    }
    const homes = st('homes').model;
    const openLoan = ms.concat(homes ? [homes] : []).map((m) => (m.mortgages || []).find((x) => /open/i.test(x.status) && isNum(x.amount))).find(Boolean);
    const bb = [isNum(main.beds) || main.beds ? `${pick('beds')} bd` : '', pick('baths') ? `${pick('baths')} ba` : '', pick('sqft') ? `${Number(pick('sqft')).toLocaleString()} sqft` : ''].filter(Boolean).join(' · ');
    const tile = (k, v, sub) => `<div class="vc-tile"><div class="vc-k">${k}</div><div class="vc-v">${v || '—'}</div>${sub ? `<div class="vc-sub">${sub}</div>` : ''}</div>`;
    const picked = CARD_ORDER.map((k) => st(k).picked).find(Boolean);
    const partial = CARD_ORDER.filter((k) => !ok.includes(k) && (st(k).state === 'loading'));

    return head(`<span class="vc-hint">Click a site for the full page</span>`) +
      (picked ? `<div class="vc-warn">Close match, not the exact lead address: <b>${esc(nearLabel(picked))}</b>. Confirm the address with the borrower.</div>` : '') +
      `<div class="vc-row">
        <div class="vc-hero" data-vc-open="${main.key}" title="Open the ${esc(label(main.key))} tab">
          <div class="vc-k">${esc(label(main.key))} estimate</div>
          <div class="vc-big">${esc(money(est) || '—')}</div>
          <div class="vc-sites">${others}${partial.length ? `<span class="vc-sub">${partial.map(label).join(', ')} loading…</span>` : ''}</div>
        </div>
        <div class="vc-grid">
          ${tile('Lead value', vsLead, vsSub)}
          ${tile('Lead loan / LTV', loan && isNum(est) ? `${kMoney(loan)} · <span class="${ltvCls(loan)}">${(loan / est * 100).toFixed(1)}%</span>` : (loan ? kMoney(loan) : ''), loan && isNum(est) ? `Equity est. ${eq(loan)}` : '')}
          ${tile('Last sold', esc(day(soldDate) || ''), [isNum(soldPrice) ? `for ${kMoney(soldPrice)}` : '', ownedFor(soldDate)].filter(Boolean).join(' · '))}
          ${tile('Open loan on record', openLoan ? `${kMoney(openLoan.amount)}${isNum(est) ? ` · <span class="${ltvCls(openLoan.amount)}">${(openLoan.amount / est * 100).toFixed(1)}%</span>` : ''}` : '',
            openLoan ? `${esc(openLoan.date)}, original amount${isNum(est) ? ` · Equity est. ${eq(openLoan.amount)}` : ''}` : (homes ? 'None recorded' : 'Open the Homes.com tab to check'))}
          ${tile('Home', esc(bb), esc([pick('yearBuilt') ? 'Built ' + pick('yearBuilt') : '', pick('type')].filter(Boolean).join(' · ')))}
          ${tile('Status', esc(pick('status') || ''), esc([pick('county'), main.listPrice ? 'List ' + kMoney(main.listPrice) : ''].filter(Boolean).join(' · ')))}
        </div>
      </div>`;
  }

  function renderCard(a, c) {
    if (!card || !document.body.contains(card)) {
      card = document.createElement('div');
      card.id = 'vprop-card';
      card.addEventListener('click', (e) => {
        const o = e.target.closest('[data-vc-open]');
        openScreen(o ? o.dataset.vcOpen : (CARD_ORDER.find((k) => c0() && siteState(c0(), k).state !== 'idle') || 'zillow'));
      });
      document.body.appendChild(card);
    }
    const c0 = () => cache[getAddress().full];
    const anchor = cardAnchor();
    const why = !anchor ? 'no Call Notes box' : a.missing.length ? 'lead missing ' + a.missing.join(', ') : openKey ? 'a property tab is open' : '';
    card.dataset.why = why;
    if (why) { card.style.display = 'none'; return; }
    const r = anchor.getBoundingClientRect();
    const fixed = LAYOUT_ON && byId('vl-form');
    const left = fixed ? L.card[0] - window.scrollX : Math.max(8, r.left - 64), top = fixed ? L.card[1] - window.scrollY : r.bottom + 18;
    // only on Vici's main screen: hide when a SCRIPT panel (or anything else) is on top of this spot
    card.style.display = 'none';
    // only hide when another Vici panel (SCRIPT, pause/login boxes…) is on top of this spot
    const hit = top + 20 < window.innerHeight && left + 40 < window.innerWidth ? document.elementFromPoint(left + 40, top + 20) : null;
    let cover = null;
    for (let e = hit; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (e.id && !/^(MainPanel|MainTable|vl-)/.test(e.id) && /panel|box|display|span\d*$/i.test(e.id) && !e.contains(anchor)) { cover = e; break; }
    }
    if (cover) { card.dataset.why = 'covered by #' + cover.id; return; }
    card.style.display = '';
    const phone = [...document.querySelectorAll('iframe, #webphone, [id*="webphone" i]')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 150 && b.left > left + 400).map((b) => b.left);
    const right = Math.min(window.innerWidth - 12, ...(phone.length ? phone.map((x) => x - 16) : [window.innerWidth - 12]));
    const cw = fixed ? L.card[2] : Math.max(560, Math.min(1180, right - left));
    Object.assign(card.style, { left: left + window.scrollX + 'px', top: top + window.scrollY + 'px', width: cw + 'px' });
    card.classList.toggle('vc-narrow', cw < 1000);
    const key = a.full + '|' + CARD_ORDER.map((k) => siteState(c || {}, k).state + (siteState(c || {}, k).picked ? 'p' : '')).join(',') + '|' + byLabel(/^Loan\s*Amount/i) + '|' + byLabel(/^Value\s*:?$/i);
    if (key === lastCardKey) return;
    lastCardKey = key;
    card.innerHTML = cardHTML(a, c);
  }

  // =====================================================================
  //  Main loop – Vici fills the fields by script (no input events), so check once a second
  // =====================================================================
  function refresh() {
    if (stepAside()) { // the Edge extension is running on this page: remove this copy's UI and stop
      [tabBar, card, screen].forEach((el) => el && el.remove());
      clearInterval(loop);
      return;
    }
    try { applyLayout(); } catch (e) { /* never let the layout stop the lookups */ }
    const a = getAddress();
    if (!a.missing.length) lookup(a); // starts the lookups as soon as a lead's address pops up
    renderAll();
  }



  const loop = setInterval(refresh, 1000);
  refresh();
  // zooming (Ctrl + / Ctrl -) fires resize: refit the screen and redraw its charts at the new width
  let resizeT = null, lastW = 0;
  window.addEventListener('resize', () => {
    if (screen && screen.classList.contains('open')) placeScreen();
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      lastCardKey = '';
      const w = screen ? screen.clientWidth : 0;
      if (screen && openKey && Math.abs(w - lastW) > 60) { lastW = w; const y = screen.scrollTop; lastScreenKey = ''; renderAll(); screen.scrollTop = y; }
      else renderAll();
    }, 300);
  });
})();
