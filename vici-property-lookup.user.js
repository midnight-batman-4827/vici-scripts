// ==UserScript==
// @name         Vici Property Lookup
// @namespace    mortgageusa.vici
// @version      15.1
// @description  ZILLOW / REALTOR / HOMES.COM / TRULIA tabs (next to SCRIPT 2) with each site's facts about the home
// @match        *://mtgusa.talkitpro.com/agc/*
// @match        *://www.homes.com/*
// @match        *://mtgusa.talkitpro.com/vicidial/admin_listloader*
// @match        *://mtgusa.talkitpro.com/vicidial/admin.php*
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
// @run-at       document-start
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

  // Lead loader: hide the page the moment it starts loading and show it once the new look is on,
  // so Vici's old screen never flashes. (Shown after 3 seconds no matter what.)
  const LL_PAGE = /\/vicidial\/admin_listloader/.test(location.pathname);
  const ADMIN_PAGE = /\/vicidial\/admin\.php$/.test(location.pathname);
  let reveal = () => {};
  if (LL_PAGE || ADMIN_PAGE) {
    const ph = document.createElement('style');
    ph.textContent = 'html{visibility:hidden!important}';
    const root = () => document.head || document.documentElement;
    if (root()) root().appendChild(ph);
    else new MutationObserver((m, o) => { if (root()) { root().appendChild(ph); o.disconnect(); } }).observe(document, { childList: true, subtree: true });
    reveal = () => ph.remove();
    setTimeout(reveal, 3000);
  }

  // everything else starts once the page's HTML is in (same moment as before)
  function __main() {

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
    // the tab name says what it is, in case an agent spots it in the tab bar
    const title = () => { if (document.title !== 'Vici lookup - closes by itself') document.title = 'Vici lookup - closes by itself'; };
    title(); setInterval(title, 500);
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
      // Edge slows timers in background tabs a lot, so this helper never decides "no match" by waiting:
      // it reports each step to the Vici tab (which runs at full speed) and Vici decides when to give up.
      const progress = (o) => GM_setValue('vpHomesProgress', Object.assign({ id: job.id, t: Date.now() }, o));
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
      const area = new RegExp('\\b' + String(job.state || '').toLowerCase() + ' ' + String(job.zip || '') + '\\b');
      const nearNow = () => [...new Set(addrBtns().filter((b) => area.test(norm(btnText(b)))).map(label))].slice(0, 5);
      progress({ stage: 'typed', near: [] });
      let lastSent = '';
      const report = new MutationObserver(() => { const n = nearNow(); const k = n.join('|'); if (k !== lastSent) { lastSent = k; progress({ stage: 'list', near: n }); } });
      report.observe(document.documentElement, { childList: true, subtree: true });
      let btn = await waitFor(() => addrBtns().find(isHit), job.pick ? 20000 : 6000);
      if (!btn && !job.pick) {
        // no exact suggestion: let the list finish filling, then offer the ones in the same State + ZIP
        await waitFor(() => addrBtns().length >= 3 && null, 3000);
        btn = addrBtns().find(isHit);
        if (!btn) { report.disconnect(); return finish({ ok: false, why: 'no exact address match on Homes.com', near: nearNow() }); }
      }
      report.disconnect();
      if (!btn) return finish({ ok: false, why: 'no matching address on Homes.com' });
      progress({ stage: 'clicked', near: [] });
      btn.click(); // the page navigates to the property; this helper runs again there
    })();
  }

  if (/(^|\.)homes\.com$/.test(location.hostname)) { setTimeout(() => { if (!stepAside()) homesWorker(); }, IS_EXT ? 0 : 1500); return; }
  // the lead loader (admins only) gets its own look; nothing else of this script runs there
  if (LL_PAGE) { try { if (!stepAside()) leadLoader(); } finally { reveal(); } return; }
  // admin pages (admins only): new sidebar, top bar and modern pages
  if (ADMIN_PAGE) { let r = false; try { if (!stepAside()) r = adminUI(); } finally { if (r !== 'redirect') reveal(); } return; }

  // =====================================================================
  //  Admin pages (admins only: agents can't open them). New sidebar + top bar on every admin page,
  //  and modern lists, settings forms, tabs, Reports cards, script editor and Admin tiles.
  //  Vici's own links, fields and buttons are kept and only restyled/moved: nothing is sent differently.
  // =====================================================================
  function adminCSS() { return `
  html.mu-adm,html.mu-adm body{background:#eef1f5!important}
  html.mu-adm body>center>table{margin:0!important;background:transparent!important;width:100%!important;min-height:100vh}
  html.mu-adm .mu-side{background:#0f2747!important;width:230px!important;min-width:230px;padding:0 12px 20px!important;vertical-align:top}
  html.mu-adm .mu-side,html.mu-adm .mu-side *{font-family:"Segoe UI",Arial,sans-serif!important}
  html.mu-adm .mu-side>a>img{display:block;margin:14px auto 6px}
  html.mu-adm .mu-side>b{display:block;text-align:left;margin:4px 6px 12px}
  html.mu-adm .mu-side>b font{font:700 11px "Segoe UI",Arial!important;letter-spacing:.12em;color:#8fa6c6!important}
  html.mu-adm .mu-side table{background:transparent!important;width:100%!important}
  html.mu-adm .mu-side .horiz_line{display:none}
  html.mu-adm .mu-side tr,html.mu-adm .mu-side td{background:transparent!important}
  html.mu-adm .mu-side td{padding:1px 0!important;font-size:0!important;line-height:0}
  html.mu-adm .mu-side td>font{display:none!important}
  html.mu-adm .mu-side td>a{display:flex!important;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;text-decoration:none!important;line-height:1.3}
  html.mu-adm .mu-side td>a:hover{background:rgba(255,255,255,.08)}
  html.mu-adm .mu-side td>a img{filter:brightness(0) invert(1);opacity:.8}
  html.mu-adm .mu-side td>a font,html.mu-adm .mu-side td>a b,html.mu-adm .mu-side td>a span{font:600 13px "Segoe UI",Arial!important;color:#dbe4f0!important}
  html.mu-adm .mu-side td.head_style_selected>a{background:#2563eb}
  html.mu-adm .mu-side td.head_style_selected>a font,html.mu-adm .mu-side td.head_style_selected>a b,html.mu-adm .mu-side td.head_style_selected>a span{color:#fff!important}
  html.mu-adm .mu-side td.head_style_selected>a img{opacity:1}
  html.mu-adm .mu-side td.mu-sub>a{padding:5px 10px 5px 34px;gap:8px}
  html.mu-adm .mu-side td.mu-sub>a:has(img){padding-left:22px}
  html.mu-adm .mu-side td.mu-sub>a img{width:14px;height:14px;opacity:.6}
  html.mu-adm .mu-side td.mu-sub>a font,html.mu-adm .mu-side td.mu-sub>a span,html.mu-adm .mu-side td.mu-sub>a b{font:500 12.5px "Segoe UI",Arial!important;color:#b9c7da!important}
  html.mu-adm .mu-side td.mu-sub>a:hover font,html.mu-adm .mu-side td.mu-sub>a:hover span{color:#fff!important}
  html.mu-adm .mu-side td.subhead_style_selected>a{background:rgba(255,255,255,.1)}
  html.mu-adm .mu-side td.subhead_style_selected>a font,html.mu-adm .mu-side td.subhead_style_selected>a span{color:#fff!important;font-weight:600!important}
  html.mu-adm .mu-main{vertical-align:top;background:#eef1f5!important}
  html.mu-adm .mu-main table{background:transparent!important}
  html.mu-adm tr.mu-topbar>td{background:#fff!important;border-bottom:1px solid #dde2e8!important;height:42px;padding:0 22px!important}
  html.mu-adm tr.mu-topbar *{font-family:"Segoe UI",Arial,sans-serif!important}
  html.mu-adm tr.mu-topbar font,html.mu-adm tr.mu-topbar a,html.mu-adm tr.mu-topbar b{color:#2b3a55!important;font-size:12.5px!important;font-weight:600!important;text-decoration:none!important}
  html.mu-adm tr.mu-topbar a:hover font{color:#2563eb!important}
  html.mu-adm tr.mu-tabs,html.mu-adm tr.mu-tabs>td{background:transparent!important;border:0!important}
  html.mu-adm tr.mu-tabs>td{padding:12px 22px 4px!important}
  html.mu-adm tr.mu-tabs a{display:inline-block;text-decoration:none!important;background:#fff;border:1px solid #d6dce4;border-radius:999px;padding:4px 12px;margin:0 6px 4px 0}
  html.mu-adm tr.mu-tabs a,html.mu-adm tr.mu-tabs a font{font:600 12px "Segoe UI",Arial!important;color:#2b3a55!important}
  html.mu-adm tr.mu-tabs a:hover{border-color:#2563eb}
  html.mu-adm .mu-foot>td{background:#eef1f5!important;border:0!important}
  html.mu-adm .mu-foot>td:first-child{background:#0f2747!important}
  html.mu-adm .mu-foot font{color:#8fa6c6!important;font-size:10.5px!important}
  .mu-gone{display:none!important}
  /* page titles */
  .mu-head2{display:flex;align-items:center;gap:12px;margin:14px 16px 14px;flex-wrap:wrap}
  .mu-head2 h1{margin:0;font:700 22px "Segoe UI",Arial;color:#1d2530}
  .mu-head2 .cnt{font:13px "Segoe UI",Arial;color:#6b7686}
  .mu-head2 a,.mu-head2 a font{font:600 12.5px "Segoe UI",Arial!important;color:#2563eb!important;text-decoration:none!important}
  .mu-head2 input{margin-left:auto;height:32px;width:260px;border:1px solid #cdd4dd;border-radius:8px;padding:0 10px;font:13px "Segoe UI",Arial;box-sizing:border-box}
  .mu-ttl{display:block;margin:14px 22px 8px;font:700 22px "Segoe UI",Arial;color:#1d2530}
  /* lists */
  .mu-card3{background:#fff;border:1px solid #dde2e8;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,50,.06);overflow-x:auto;margin:0 16px 24px}
  table.mu-ut{width:100%!important;border-collapse:collapse}
  table.mu-ut tr{background:#fff!important}
  table.mu-ut tr:hover td{background:#f5f8ff!important}
  table.mu-ut td{padding:7px 8px!important;border-bottom:1px solid #eef1f4;background:#fff!important;vertical-align:middle;white-space:nowrap}
  table.mu-ut td,table.mu-ut td *{font-family:"Segoe UI",Arial,sans-serif!important}
  table.mu-ut td font{font-size:12.5px!important;color:#1d2530!important}
  table.mu-ut tr:first-child td{background:#fafbfc!important;position:sticky;top:0;z-index:1;border-bottom:1px solid #e6eaef}
  table.mu-ut tr:first-child font,table.mu-ut tr:first-child a,table.mu-ut tr:first-child td{font-size:10.5px!important;font-weight:700!important;letter-spacing:.04em;color:#5b6675!important;text-decoration:none!important}
  table.mu-ut td:first-child a{font-weight:700;text-decoration:none!important}
  table.mu-ut td:first-child a font{color:#1d4ed8!important}
  table.mu-ut td.mu-wrap{white-space:normal}
  table.mu-ut td.mu-num{text-align:right!important}
  table.mu-ut td.mu-num font{font-weight:600}
  table.mu-ut td.mu-rt{white-space:normal;min-width:105px;max-width:112px}
  table.mu-ut td.mu-rt font{font-size:11.5px!important;color:#5b6675!important}
  table.mu-ut td.mu-name{white-space:normal;min-width:150px}
  table.mu-ut a.mu-act{display:inline-block;text-decoration:none!important;border:1px solid #d6dce4;border-radius:6px;padding:1px 8px;background:#fff;margin:1px 2px}
  table.mu-ut a.mu-act,table.mu-ut a.mu-act font{font-size:11.5px!important;font-weight:600!important;color:#2b3a55!important}
  table.mu-ut a.mu-act:hover{border-color:#2563eb}
  .mu-tag{display:inline-block;border-radius:999px;padding:1px 9px;font:600 11.5px "Segoe UI",Arial;white-space:nowrap;background:#f1f4f8;color:#4a5563}
  .mu-tag.adm{background:#f3ecff;color:#6b3fb5}.mu-tag.ag{background:#eef3ff;color:#1d4ed8}
  .mu-swatch{display:inline-block;width:16px;height:16px;border-radius:5px;border:1px solid #cdd4dd;vertical-align:middle}
  .mu-yes{display:inline-flex;align-items:center;gap:6px;font:600 12px "Segoe UI",Arial;color:#137a32;white-space:nowrap}.mu-yes i{width:8px;height:8px;border-radius:50%;background:#1aa33c}
  .mu-no{display:inline-flex;align-items:center;gap:6px;font:600 12px "Segoe UI",Arial;color:#8a94a3;white-space:nowrap}.mu-no i{width:8px;height:8px;border-radius:50%;background:#c4ccd6}
  .mu-sub2{display:block;font:11.5px "Segoe UI",Arial;color:#7a8494;white-space:normal;max-width:230px}
  .mu-today{display:inline-block;margin-left:6px;border-radius:999px;padding:0 7px;font:700 10.5px "Segoe UI",Arial;background:#e7f7ec;color:#137a32;vertical-align:1px}
  .mu-load{display:inline-block;text-decoration:none!important;border:1px solid #2563eb;border-radius:6px;padding:1px 8px;background:#2563eb;color:#fff!important;font:600 11.5px "Segoe UI",Arial;margin-right:4px}
  .mu-load:hover{background:#1d4ed8}
  .mu-switch{display:inline-flex;align-items:center;gap:8px;font:600 12.5px "Segoe UI",Arial;color:#2b3a55;cursor:pointer;user-select:none}
  .mu-switch i{width:34px;height:20px;border-radius:999px;background:#c4ccd6;position:relative;transition:.15s;flex:none}
  .mu-switch i::after{content:"";position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:.15s}
  .mu-switch.on i{background:#2563eb}.mu-switch.on i::after{left:17px}
  tr.mu-hidden-row{display:none!important}
  /* settings forms */
  html.mu-adm .mu-main,html.mu-adm .mu-main *{font-family:"Segoe UI",Arial,sans-serif}
  html.mu-adm .mu-form{margin:10px 22px 24px!important;width:calc(100% - 44px)!important;max-width:1150px;background:#fff!important;border:1px solid #dde2e8;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,50,.06);border-collapse:separate;border-spacing:0;overflow:hidden}
  html.mu-adm .mu-form>tbody>tr{background:#fff!important}
  html.mu-adm .mu-form>tbody>tr>td{padding:6px 14px!important;border-bottom:1px solid #f0f2f5;background:#fff!important}
  html.mu-adm .mu-form td font{font-size:13px!important}
  html.mu-adm .mu-form>tbody>tr>td:first-child font{color:#4a5563!important;font-weight:600}
  html.mu-adm .mu-form tr.mu-sec>td{background:#f5f8ff!important;border-top:1px solid #e3e9f5;padding:12px 14px!important;text-align:left!important}
  html.mu-adm .mu-form tr.mu-sec>td,html.mu-adm .mu-form tr.mu-sec>td *{font:700 12px "Segoe UI",Arial!important;letter-spacing:.06em;color:#1d4ed8!important}
  html.mu-adm .mu-form input[type=text],html.mu-adm .mu-form input[type=password],html.mu-adm .mu-form input:not([type]),html.mu-adm .mu-form select:not([multiple]){height:30px;border:1px solid #cdd4dd;border-radius:7px;padding:0 9px;font:13px "Segoe UI",Arial!important;background:#fff;color:#1d2530;box-sizing:border-box}
  html.mu-adm .mu-form select[multiple],html.mu-adm .mu-form textarea{border:1px solid #cdd4dd;border-radius:7px;padding:6px 9px;font:13px "Segoe UI",Arial!important;background:#fff;color:#1d2530;box-sizing:border-box}
  html.mu-adm .mu-form input:focus,html.mu-adm .mu-form select:focus,html.mu-adm .mu-form textarea:focus{outline:2px solid #2563eb;outline-offset:0;border-color:#2563eb}
  html.mu-adm .mu-form input[type=button]{height:30px;border:1px solid #c4ccd6;border-radius:7px;background:#fff;font:600 12px "Segoe UI",Arial;padding:0 12px;cursor:pointer}
  html.mu-adm .mu-form img[src*=help]{width:15px;height:15px;opacity:.5;vertical-align:middle}
  html.mu-adm .mu-form table td{padding:2px 6px!important;border:0!important}
  html.mu-adm .mu-form table td font{font-size:12px!important}
  html.mu-adm .mu-main input[type=submit]{background:#2563eb!important;color:#fff!important;border:0!important;border-radius:8px;height:36px;padding:0 22px;font:600 13px "Segoe UI",Arial!important;cursor:pointer}
  html.mu-adm .mu-ctabs{display:flex!important;flex-wrap:wrap;gap:6px;margin:12px 22px 4px;background:transparent!important}
  html.mu-adm .mu-ctabs td{background:transparent!important;border:0!important;padding:0!important}
  html.mu-adm .mu-ctabs a{display:inline-block;text-decoration:none!important;background:#fff;border:1px solid #d6dce4;border-radius:8px;padding:5px 12px}
  html.mu-adm .mu-ctabs a,html.mu-adm .mu-ctabs a font{font:600 12px "Segoe UI",Arial!important;color:#2b3a55!important}
  html.mu-adm .mu-ctabs td.mu-on a{background:#2563eb;border-color:#2563eb}
  html.mu-adm .mu-ctabs td.mu-on a,html.mu-adm .mu-ctabs td.mu-on a font{color:#fff!important}
  /* script editor */
  .mu-editor{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}
  html.mu-adm .mu-editor textarea{width:100%!important;height:520px!important;box-sizing:border-box;border:1px solid #cdd4dd;border-radius:9px;padding:10px 12px;font:12.5px/1.5 Consolas,"Cascadia Mono",monospace!important;background:#0f172a;color:#e2e8f0;resize:vertical}
  .mu-pv2{border:1px solid #dde2e8;border-radius:9px;overflow:hidden;display:flex;flex-direction:column;background:#f8fafc}
  .mu-pv2 b.h{display:flex;align-items:center;gap:8px;padding:8px 12px;font:700 11px "Segoe UI",Arial;letter-spacing:.06em;color:#5b6675;border-bottom:1px solid #e6eaef;background:#fff}
  .mu-pv2 b.h i{width:8px;height:8px;border-radius:50%;background:#1aa33c}
  .mu-pv2 iframe{flex:1;width:100%;height:500px;border:0;background:#fff}
  .mu-usedcard{margin:0 22px 16px;background:#fff;border:1px solid #dde2e8;border-radius:12px;padding:10px 16px;font:13px "Segoe UI",Arial;max-width:1120px}
  .mu-usedcard .mu-uh{display:block;font:700 11px "Segoe UI",Arial!important;letter-spacing:.05em;color:#5b6675!important;margin:8px 0 2px}
  .mu-usedcard a{color:#1d4ed8!important;font-weight:600;text-decoration:none!important}
  html.mu-adm a.mu-del{display:inline-block;margin:6px 0 6px 22px;color:#c4252b!important;font:600 12.5px "Segoe UI",Arial!important;border:1px solid #f0b4b6;border-radius:8px;padding:6px 12px;text-decoration:none!important;background:#fff}
  html.mu-adm a.mu-del font{color:#c4252b!important;font:inherit!important}
  /* reports home */
  .mu-page{padding:20px 26px 10px;max-width:1500px}
  .mu-title{display:flex;align-items:baseline;gap:12px;margin-bottom:18px}
  .mu-title h1{margin:0;font:700 22px "Segoe UI",Arial;color:#1d2530}
  .mu-title span{font:13px "Segoe UI",Arial;color:#6b7686}
  .mu-title a{font:600 12.5px "Segoe UI",Arial!important;color:#2563eb!important;text-decoration:none!important;background:#eef3ff;border-radius:999px;padding:3px 10px}
  .mu-title a font{color:#2563eb!important;font:inherit!important}
  .mu-grid{display:flex;gap:16px;align-items:flex-start}
  .mu-col{flex:1;display:flex;flex-direction:column;gap:16px;min-width:0}
  .mu-cardx{background:#fff;border:1px solid #dde2e8;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,50,.06);overflow:hidden}
  .mu-cardx h2{margin:0;padding:12px 16px;font:700 12px "Segoe UI",Arial;letter-spacing:.06em;text-transform:uppercase;color:#4a5563;border-bottom:1px solid #eef1f4;display:flex;align-items:center;gap:8px}
  .mu-cardx h2 i{flex:none;width:8px;height:8px;border-radius:2px;background:var(--c,#2563eb)}
  .mu-cardx ul{list-style:none;margin:0;padding:6px 8px 10px}
  .mu-cardx li{display:flex;align-items:center;flex-wrap:wrap;gap:4px;border-radius:7px;color:#b6bec8;font-size:0}
  .mu-cardx li:hover{background:#f3f6fb}
  .mu-cardx li br{display:none}
  .mu-cardx li>font{font-size:0!important;display:contents}
  .mu-cardx li a{text-decoration:none!important;display:block;padding:6px 8px}
  .mu-cardx li a font{font:13px "Segoe UI",Arial!important;color:#1d2530!important}
  .mu-cardx li a:hover font{color:#2563eb!important}
  .mu-cardx li a~a,.mu-cardx li>font>a{padding:0 2px}
  .mu-cardx li>font>a font,.mu-cardx li a~a font{font-size:11.5px!important;color:#2563eb!important;background:#eef3ff;border-radius:5px;padding:1px 6px}
  .mu-servers{margin-top:20px}
  .mu-servers table.mu-sv{border-collapse:collapse;width:100%;background:#fff!important;border:0!important}
  .mu-servers table.mu-sv tr{background:#fff!important}
  .mu-servers table.mu-sv td{padding:9px 14px!important;border:0!important;border-bottom:1px solid #eef1f4!important;background:#fff!important}
  .mu-servers table.mu-sv tr:first-child td{background:#fafbfc!important}
  .mu-servers table.mu-sv tr:first-child font,.mu-servers table.mu-sv tr:first-child a{font:700 11px "Segoe UI",Arial!important;letter-spacing:.05em;color:#5b6675!important;text-transform:uppercase}
  .mu-servers table.mu-sv td font,.mu-servers table.mu-sv td a{font:13px "Segoe UI",Arial!important;color:#1d2530!important;text-decoration:none!important}
  .mu-servers table.mu-sv td a,.mu-servers table.mu-sv td a font{color:#2563eb!important}
  .mu-pill{display:inline-block;border-radius:999px;padding:1px 9px;font:600 11.5px "Segoe UI",Arial;background:#e7f7ec;color:#137a32}
  .mu-pill.warn{background:#fff4dd;color:#7a4b00}.mu-pill.hot{background:#fde8e8;color:#b42318}
  /* admin tiles */
  html.mu-adm tr.adminmenu_style_selected{display:block;background:transparent!important}
  html.mu-adm tr.adminmenu_style_selected>td{display:none}
  html.mu-adm tr.adminmenu_style_selected>td:last-child{display:block;padding:0!important}
  html.mu-adm tr.adminmenu_style_selected>td:last-child>a{display:flex!important;align-items:center;gap:12px;background:#fff;border:1px solid #dde2e8;border-radius:12px;padding:12px 14px;margin:0 0 10px;text-decoration:none!important;box-shadow:0 1px 2px rgba(20,30,50,.05);transition:.12s}
  html.mu-adm tr.adminmenu_style_selected>td:last-child>a:hover{border-color:#2563eb;box-shadow:0 4px 12px rgba(37,99,235,.12)}
  html.mu-adm tr.adminmenu_style_selected>td:last-child>a span{font:600 14px "Segoe UI",Arial!important;color:#1d2530!important}
  html.mu-adm .mu-ico{width:34px;height:34px;border-radius:9px;background:#eef3ff;display:flex;align-items:center;justify-content:center;flex:none}
  html.mu-adm .mu-ico img{width:22px!important;height:22px!important;opacity:.85}
  html.mu-adm table.mu-grid4{width:calc(100% - 32px)!important;margin:6px 16px 30px!important;table-layout:fixed}
  html.mu-adm td.mu-col4{padding:0 6px!important;vertical-align:top}`; }

  function adminUI() {
    const top = document.querySelector('body>center>table');
    const cells = top && top.rows[0] ? [...top.rows[0].cells] : [];
    if (cells.length < 2 || !/ADMINISTRATION/i.test(cells[0].textContent)) return false;   // not Vici's admin frame
    const [side, main] = cells;
    const page = new URLSearchParams(location.search).get('ADD') || '';

    // Lists: always open with the lead counts (Vici's own "show list leads counts" link)
    if (page === '100') {
      const cl = [...main.querySelectorAll('a')].find((a) => /show list leads counts/i.test(a.textContent));
      if (cl && cl.href && cl.href !== location.href) { location.replace(cl.href); return 'redirect'; }
    }

    document.documentElement.classList.add('mu-adm');
    const st = document.createElement('style'); st.id = 'mu-adm-style'; st.textContent = adminCSS();
    document.head.appendChild(st);

    // ---------- frame: sidebar, top bar, link row, footer ----------
    side.classList.add('mu-side'); main.classList.add('mu-main');
    side.removeAttribute('bgcolor'); side.removeAttribute('width'); main.removeAttribute('width'); main.removeAttribute('bgcolor');
    [...side.querySelectorAll('td')].filter((td) => /subhead_style/.test(td.className) ||
      (!td.className && td.querySelector('a') && !td.querySelector('img') && td.textContent.trim())).forEach((td) => { td.classList.add('mu-sub'); td.closest('tr').removeAttribute('bgcolor'); });
    [...top.rows].slice(1).forEach((r) => r.classList.add('mu-foot'));
    const bar = [...main.querySelectorAll('tr')].filter((tr) => /\bHOME\b/.test(tr.textContent) && /Logout/i.test(tr.textContent) && tr.cells.length <= 3 && !tr.querySelector('table')).pop();
    let tabs = null;
    if (bar) {
      bar.classList.add('mu-topbar'); bar.querySelectorAll('[bgcolor]').forEach((e) => e.removeAttribute('bgcolor'));
      const bt = bar.closest('table'); bt.removeAttribute('bgcolor'); bt.removeAttribute('width'); bt.style.width = '100%';
      tabs = [...bt.rows].find((r) => r !== bar && r.querySelectorAll('a').length >= 2 && !r.querySelector('table,input,select,textarea') && /\|/.test(r.textContent));
      if (tabs) {
        tabs.classList.add('mu-tabs'); tabs.querySelectorAll('[bgcolor]').forEach((e) => e.removeAttribute('bgcolor'));
        const w = document.createTreeWalker(tabs, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) n.nodeValue = n.nodeValue.replace(/\|/g, ' ');
      }
      [...bt.rows].filter((r) => r !== bar && r !== tabs && !r.querySelector('a,input,select,textarea,table,img') && !r.textContent.replace(/ /g, ' ').trim()).forEach((r) => r.classList.add('mu-gone'));
    }
    const inPage = (e) => !e.closest('.mu-side,tr.mu-topbar,tr.mu-tabs');
    const bigIcons = () => [...main.querySelectorAll('img')].filter((i) => inPage(i) && (i.getAttribute('width') | 0) >= 30 && !i.closest('.mu-grid4,.mu-card3,.mu-form,.mu-page'));

    // ---------- Reports home ----------
    const uls = [...main.querySelectorAll('ul')];
    const heading = (ul) => { let b = ul.previousElementSibling; while (b && b.tagName !== 'B') b = b.previousElementSibling; return b; };
    if (uls.length >= 3 && uls.some((ul) => /Real-Time Reports/i.test((heading(ul) || {}).textContent || ''))) { reportsHome(main, uls, heading, bar); return true; }

    // ---------- Admin tiles ----------
    const tiles = [...main.querySelectorAll('tr.adminmenu_style_selected')];
    if (tiles.length >= 6) {
      tiles.forEach((r) => { const img = r.cells[0] && r.cells[0].querySelector('img'), a = r.cells[1] && r.cells[1].querySelector('a');
        if (img && a) { const b = document.createElement('span'); b.className = 'mu-ico'; b.appendChild(img.cloneNode()); a.insertBefore(b, a.firstChild); } });
      const grid = tiles[0].closest('table').parentElement.closest('table');
      if (grid) {
        grid.classList.add('mu-grid4'); grid.removeAttribute('width');
        [...grid.rows[0].cells].forEach((c) => { c.removeAttribute('width'); if (c.querySelector('tr.adminmenu_style_selected')) c.classList.add('mu-col4'); else c.style.display = 'none'; });
        for (let p = grid.parentElement; p && p !== main; p = p.parentElement) { p.removeAttribute('align'); if (p.tagName === 'TABLE') { p.removeAttribute('width'); p.style.width = '100%'; } }
      }
      retitle(main, /^\s*Administration\s*$/, 'Administration');
      bigIcons().forEach((i) => i.classList.add('mu-gone'));
      return true;
    }

    // ---------- lists (Vici's black header row) ----------
    const lt = [...main.querySelectorAll('table')].find((t) => !t.querySelector('table') && t.rows.length > 1 && !t.closest('form') &&
      /^black$/i.test((t.rows[0].getAttribute('bgcolor') || (t.rows[0].cells[0] && t.rows[0].cells[0].getAttribute('bgcolor')) || '').trim()));
    if (lt) listPage(main, lt, page, bigIcons);

    // ---------- settings forms ----------
    const forms = [...main.querySelectorAll('form')].filter((f) => f.querySelectorAll('input:not([type=hidden]),select,textarea').length >= 4);
    forms.forEach((form) => {
      const ft = [...form.querySelectorAll('table')].filter((t) => !t.classList.contains('mu-ut'))
        .sort((a, b) => b.querySelectorAll('input,select,textarea').length - a.querySelectorAll('input,select,textarea').length)[0];
      if (!ft || ft.closest('.mu-form')) return;
      ft.classList.add('mu-form'); ft.removeAttribute('width'); ft.removeAttribute('bgcolor');
      [...ft.rows].forEach((r) => {
        const t = r.textContent.trim();
        if (r.cells.length === 1 && !r.querySelector('input,select,textarea') && t && t.length < 80 && t === t.toUpperCase() && /[A-Z]{3}/.test(t)) r.classList.add('mu-sec');
        r.removeAttribute('bgcolor'); [...r.cells].forEach((c) => c.removeAttribute('bgcolor'));
      });
      const ta = form.querySelector('textarea[name=script_text]');
      if (ta) scriptEditor(ta);
    });
    if (forms.length) {
      // a settings page's own tab row (e.g. a campaign: Basic, Detail, Statuses, HotKeys…)
      const ct = [...main.querySelectorAll('table')].find((t) => !t.querySelector('table,input,select') && t.rows.length === 1 && t.rows[0].querySelectorAll('a').length >= 5 && !t.closest('.mu-form,tr.mu-topbar,tr.mu-tabs'));
      if (ct) {
        ct.querySelectorAll('[bgcolor]').forEach((e) => e.removeAttribute('bgcolor')); ct.removeAttribute('bgcolor'); ct.removeAttribute('width');
        const row = ct.rows[0]; row.classList.add('mu-ctabs');
        [...row.cells].forEach((c) => { if (!c.querySelector('a')) c.style.display = 'none'; });
        // the tab you're on: the one whose link points at this page's SUB (none = Detail)
        const sub = new URLSearchParams(location.search).get('SUB') || '';
        const subOf = (c) => { const a = c.querySelector('a'); return a ? new URLSearchParams((a.getAttribute('href') || '').split('?')[1] || '').get('SUB') || '' : null; };
        const on = [...row.cells].find((c) => sub && subOf(c) === sub) || (!sub && [...row.cells].find((c) => /^\s*Detail\s*$/i.test(c.textContent)));
        if (on) on.classList.add('mu-on');
        // the campaign's id in bold, then ":" -> "Campaign MortSB"
        const b = [...main.querySelectorAll('b')].find((e) => inPage(e) && !e.closest('.mu-form,.mu-ctabs') && /^\s*[A-Za-z0-9_-]+\s*$/.test(e.textContent) && /^\s*:/.test((e.nextSibling && e.nextSibling.nodeValue) || ''));
        if (b && ct.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING) { const h = document.createElement('span'); h.className = 'mu-ttl'; h.textContent = 'Campaign ' + b.textContent.trim(); b.parentNode.insertBefore(h, b); b.style.display = 'none'; b.nextSibling.nodeValue = b.nextSibling.nodeValue.replace(':', ''); }
      }
      // page titles: change only the words
      retitle(main, /^\s*MODIFY A USERS RECORD:?/i, 'User settings');
      retitle(main, /^\s*MODIFY A SCRIPT\s*$/i, 'Edit script');
      retitle(main, /^\s*MODIFY A (LIST|LISTS RECORD)[^:]*:?/i, 'List settings');
      [...main.querySelectorAll('a')].filter((a) => /^\s*DELETE THIS /i.test(a.textContent)).forEach((a) => { a.classList.add('mu-del'); const f = a.querySelector('font') || a; f.textContent = f.textContent.trim().charAt(0) + f.textContent.trim().slice(1).toLowerCase(); });
    }
    bigIcons().filter((i) => !i.closest('form')).forEach((i) => i.classList.add('mu-gone'));
    return true;
  }

  // change a page title's words into a heading (never touches the elements around it)
  function retitle(main, re, text) {
    const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
      if (!re.test(n.nodeValue) || n.parentElement.closest('.mu-side,tr.mu-topbar,tr.mu-tabs,.mu-form,.mu-grid4')) continue;
      const h = document.createElement('span'); h.className = 'mu-ttl'; h.textContent = text;
      n.parentNode.insertBefore(h, n); n.nodeValue = n.nodeValue.replace(re, '');
      return true;
    }
    return false;
  }

  function listPage(main, lt, page, bigIcons) {
    const TITLES = { '0A': 'Users', '10': 'Campaigns', '100': 'Lists', '1000000': 'Scripts', '10000000': 'Filters', '1001': 'Inbound groups', '100000': 'User groups', '10000': 'Remote agents' };
    let title = TITLES[page] || '';
    // the old "XXX LISTINGS:" words: take them as the title if this page isn't one we named, and keep their link
    let toggle = null;
    const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
      const m = n.nodeValue.match(/^\s*([A-Z][A-Z \-]+?)\s+LISTINGS:?\s*$/);
      if (!m || n.parentElement.closest('.mu-side,tr.mu-topbar,tr.mu-tabs')) continue;
      if (!title) title = m[1].charAt(0) + m[1].slice(1).toLowerCase();
      n.nodeValue = '';
      let p = n.parentElement; for (let i = 0; i < 3 && p && !toggle; i++, p = p.parentElement) toggle = [...p.querySelectorAll('a')].find((a) => /^\s*show /i.test(a.textContent) && !lt.contains(a));
      break;
    }
    bigIcons().filter((i) => !lt.contains(i)).forEach((i) => i.classList.add('mu-gone'));
    const hdr = document.createElement('div'); hdr.className = 'mu-head2';
    hdr.innerHTML = '<h1></h1><span class="cnt"></span>'; hdr.querySelector('h1').textContent = title || 'List';
    const count = lt.rows.length - 1;
    hdr.querySelector('.cnt').textContent = count + ' ' + (title || 'rows').toLowerCase();
    if (toggle && page !== '100') hdr.appendChild(toggle); else if (toggle) toggle.classList.add('mu-gone');
    const q = document.createElement('input'); q.placeholder = 'Filter…'; q.setAttribute('autocomplete', 'off'); hdr.appendChild(q);
    const card = document.createElement('div'); card.className = 'mu-card3';
    const anchor = lt.closest('center') || lt;
    anchor.parentNode.insertBefore(hdr, anchor); anchor.parentNode.insertBefore(card, anchor); card.appendChild(lt);
    lt.classList.add('mu-ut'); lt.removeAttribute('width');
    const head = [...lt.rows[0].cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim().toUpperCase());
    const colorOf = [...lt.rows].map((r) => { const i = head.indexOf('COLOR'); return i >= 0 && r.cells[i] ? r.cells[i].getAttribute('bgcolor') : null; });
    lt.removeAttribute('bgcolor'); lt.querySelectorAll('[bgcolor]').forEach((e) => e.removeAttribute('bgcolor'));
    const hide = (name) => { const i = head.indexOf(name); if (i >= 0) [...lt.rows].forEach((r) => r.cells[i] && r.cells[i].classList.add('mu-gone')); };
    const tag = (c, cls) => { const t = c.textContent.trim(); if (!t || c.querySelector('a')) return; c.textContent = ''; const s = document.createElement('span'); s.className = 'mu-tag' + (cls ? ' ' + cls : ''); s.textContent = t; c.appendChild(s); };
    const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    let leads = 0, live = 0;
    const ni = head.indexOf('LIST NAME'), di = head.indexOf('DESCRIPTION'), idi = 0;
    [...lt.rows].forEach((r, ri) => {
      head.forEach((h, i) => {
        const c = r.cells[i]; if (!c) return;
        if (h === 'RTIME') c.classList.add('mu-rt');
        if (h === 'LEADS COUNT') c.classList.add('mu-num');
        if (/NAME$/.test(h) && h !== 'FILTER NAME') c.classList.add('mu-wrap');
        if (!ri) return;
        if (h === 'ACTIVE') { const y = /^Y/i.test(c.textContent.trim()); c.innerHTML = `<span class="${y ? 'mu-yes' : 'mu-no'}"><i></i>${y ? 'Active' : 'Inactive'}</span>`; }
        else if (h === 'GROUP' && page === '0A') { const t = c.textContent.trim(); tag(c, /admin/i.test(t) ? 'adm' : /agent/i.test(t) ? 'ag' : ''); }
        else if (/^(GROUP|DIAL METHOD|LEAD ORDER|ADMIN GROUP)$/.test(h) || (h === 'CAMPAIGN' && page === '100')) tag(c);
        else if (h === 'COLOR') { c.textContent = ''; const s = document.createElement('span'); s.className = 'mu-swatch'; s.style.background = colorOf[ri] || '#fff'; c.appendChild(s); }
        else if (h === 'RTIME') { const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let m; while ((m = tw.nextNode())) m.nodeValue = m.nodeValue.replace(/-/g, '-​'); }
        else if (h === 'LEADS COUNT') { const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let m; while ((m = tw.nextNode())) if (/^\s*\d+\s*$/.test(m.nodeValue)) { leads += +m.nodeValue; m.nodeValue = Number(m.nodeValue).toLocaleString(); } }
        else if (h === 'LAST CALL DATE' && c.textContent.trim().startsWith(today)) { const t = document.createElement('span'); t.className = 'mu-today'; t.textContent = 'Today'; c.appendChild(t); }
      });
      if (!ri) return;
      r.querySelectorAll('a').forEach((a) => {
        const t = a.textContent.trim();
        if (/^(MODIFY|STATS|STATUS|TIME|DELETE|LEADS|VIEW|SHOW)$/i.test(t)) { a.classList.add('mu-act'); const f = a.querySelector('font') || a; f.textContent = t.charAt(0) + t.slice(1).toLowerCase(); }
      });
      if (page === '100' && ni >= 0) {
        const nameC = r.cells[ni], descC = di >= 0 ? r.cells[di] : null;
        nameC.classList.add('mu-name');
        if (/^\s*live leads\s*$/i.test(nameC.textContent)) { r.dataset.live = '1'; live++; }
        if (descC) { const d = descC.textContent.trim(); if (d && d.toLowerCase() !== nameC.textContent.trim().toLowerCase()) { const s = document.createElement('span'); s.className = 'mu-sub2'; s.textContent = d; nameC.appendChild(s); } }
        const mi = head.indexOf('MODIFY'), id = r.cells[idi].textContent.trim();
        if (mi >= 0 && r.cells[mi] && /^\d+$/.test(id)) { const a = document.createElement('a'); a.className = 'mu-load'; a.textContent = 'Load leads'; a.href = 'admin_listloader_fourth_gen.php#mu-list=' + encodeURIComponent(id); r.cells[mi].insertBefore(a, r.cells[mi].firstChild); }
      }
    });
    if (page === '10') hide('DIAL STATUSES');
    if (page === '100') {
      hide('DESCRIPTION'); hide('CALL TIME');
      if (ni >= 0) lt.rows[0].cells[ni].classList.add('mu-name');
      hdr.querySelector('.cnt').textContent = count + ' lists' + (leads ? ' · ' + leads.toLocaleString() + ' leads' : '');
      if (live) {
        const sw = document.createElement('span'); sw.className = 'mu-switch on'; sw.innerHTML = '<i></i><span></span>';
        const lbl = sw.querySelector('span');
        const apply = () => { const on = sw.classList.contains('on'); lbl.textContent = on ? `Live Leads hidden (${live})` : `Showing Live Leads (${live})`;
          [...lt.rows].forEach((r) => r.classList.toggle('mu-hidden-row', on && r.dataset.live === '1')); };
        sw.addEventListener('click', () => { sw.classList.toggle('on'); apply(); });
        hdr.insertBefore(sw, q); apply();
      }
    }
    q.addEventListener('input', () => { const v = q.value.toLowerCase(); [...lt.rows].slice(1).forEach((r) => { r.style.display = !v || r.textContent.toLowerCase().includes(v) ? '' : 'none'; }); });
  }

  function scriptEditor(ta) {
    const ed = document.createElement('div'); ed.className = 'mu-editor';
    ta.parentNode.insertBefore(ed, ta); ed.appendChild(ta);
    const pv = document.createElement('div'); pv.className = 'mu-pv2';
    pv.innerHTML = '<b class="h"><i></i>LIVE PREVIEW · sample lead</b><iframe sandbox=""></iframe>';
    ed.appendChild(pv);
    const SAMPLE = { first_name: 'John', last_name: 'Sample', fullname: 'Agent Name', address1: '123 Main St', city: 'Springfield', state: 'IL', postal_code: '62701', phone_number: '5555550100', user: '1001' };
    const render = () => { pv.querySelector('iframe').srcdoc = '<!doctype html><body style="margin:12px;font-family:Arial">' + ta.value.replace(/--A--([a-z0-9_]+)--B--/gi, (m, k) => SAMPLE[k] || ('[' + k + ']')) + '</body>'; };
    ta.addEventListener('input', render); render();
    // "… USING THIS SCRIPT" sections into one card
    const main = ta.closest('.mu-main'); const form = ta.closest('form');
    const hb = [...main.querySelectorAll('b,font')].find((e) => /^\s*CAMPAIGNS USING THIS SCRIPT:?\s*$/.test(e.textContent) && !e.closest('form'));
    if (hb) {
      let start = hb; while (start.parentElement && start.parentElement !== form.parentElement && !start.parentElement.contains(form)) start = start.parentElement;
      const box = start.parentElement, card = document.createElement('div'); card.className = 'mu-usedcard';
      const nodes = []; for (let e = start; e; e = e.nextSibling) { if (e.nodeType === 1 && /DELETE THIS SCRIPT|Admin changes/i.test(e.textContent) && !/USING THIS SCRIPT/.test(e.textContent)) break; nodes.push(e); }
      box.insertBefore(card, start); nodes.forEach((x) => card.appendChild(x));
      [...card.querySelectorAll('b,font')].filter((e) => /USING THIS SCRIPT/.test(e.textContent) && !e.querySelector('b,font')).forEach((e) => e.classList.add('mu-uh'));
    }
  }

  function reportsHome(main, uls, heading, bar) {
    const holder = uls[0].closest('table');
    const pg = document.createElement('div'); pg.className = 'mu-page';
    pg.innerHTML = '<div class="mu-title"><h1>Reports</h1><span>Server stats and reports</span></div><div class="mu-grid"></div>';
    const grid = pg.querySelector('.mu-grid');
    holder.parentNode.insertBefore(pg, holder);
    const colors = ['#2563eb', '#7c3aed', '#0f9d58', '#d97706', '#0891b2'];
    const cards = uls.map((ul, i) => {
      const b = heading(ul), card = document.createElement('div'); card.className = 'mu-cardx'; card.style.setProperty('--c', colors[i % colors.length]);
      card.innerHTML = '<h2><i></i><span></span></h2>'; card.querySelector('span').textContent = b ? b.textContent.trim() : ''; card.appendChild(ul); return card;
    });
    const cols = [0, 1, 2].map(() => { const d = document.createElement('div'); d.className = 'mu-col'; grid.appendChild(d); return d; });
    const size = (c) => c.querySelectorAll('li').length + 2, h = [0, 0, 0];
    cards.slice().sort((a, b) => size(b) - size(a)).forEach((c) => { const i = h.indexOf(Math.min(...h)); h[i] += size(c); cols[i].appendChild(c); });
    cols.forEach((col) => [...col.children].sort((a, b) => cards.indexOf(a) - cards.indexOf(b)).forEach((c) => col.appendChild(c)));
    holder.classList.add('mu-gone');
    const sum = [...main.querySelectorAll('a')].find((a) => /System Summary/i.test(a.textContent) && !pg.contains(a));
    if (sum) { pg.querySelector('.mu-title').appendChild(sum); sum.querySelectorAll('font').forEach((f) => { f.textContent = 'System summary'; }); if (!sum.querySelector('font')) sum.textContent = 'System summary'; }
    [...main.querySelectorAll('img')].filter((im) => !pg.contains(im) && !(bar && bar.contains(im))).forEach((im) => {
      const tr = im.closest('tr'), td = im.closest('td');
      (tr && !tr.contains(pg) && !tr.querySelector('ul') ? tr : (td && !td.contains(pg) ? td : im)).classList.add('mu-gone');
    });
    [...main.querySelectorAll('font,b,span')].filter((e) => !pg.contains(e) && (/^\s*Server Stats and Reports\s*$/i.test(e.textContent) || /^[\s ]*\(\s*\)[\s ]*$/.test(e.textContent))).forEach((e) => e.classList.add('mu-gone'));
    const sv = [...main.querySelectorAll('table')].find((t) => !t.querySelector('table') && t.rows[0] && /SERVER/.test(t.rows[0].textContent) && /LOAD/.test(t.rows[0].textContent));
    if (sv) {
      const box = document.createElement('div'); box.className = 'mu-cardx mu-servers'; box.innerHTML = '<h2><i></i>Servers</h2>';
      pg.appendChild(box); box.appendChild(sv); sv.classList.add('mu-sv'); sv.removeAttribute('width'); sv.setAttribute('border', '0');
      const hd = [...sv.rows[0].cells].map((c) => c.textContent.trim().toUpperCase());
      const li = hd.findIndex((x) => /^LOAD/.test(x)), di = hd.findIndex((x) => /^DISK/.test(x));
      [...sv.rows].slice(1).forEach((r) => [[li, (v) => parseInt(String(v).split('-').pop(), 10)], [di, (v) => parseInt(v, 10)]].forEach(([i, num]) => {
        const c = r.cells[i]; if (i < 0 || !c) return;
        const t = c.textContent.trim(), nn = num(t);
        const pill = document.createElement('span'); pill.className = 'mu-pill' + (nn >= 85 ? ' hot' : nn >= 60 ? ' warn' : ''); pill.textContent = t;
        c.textContent = ''; c.appendChild(pill);
      }));
    }
  }

  // =====================================================================
  function leadLoader() {
    const KEY = { 'TITLE': 'FICO', 'ADDRESS2': 'Loan amount', 'ADDRESS3': 'Cash out amount', 'PROVINCE': 'Value',
      'VENDOR LEAD CODE': 'Loan type', 'ALT PHONE': 'SSN', 'SECURITY PHRASE': 'Rate', 'EMAIL': 'Revolving debt', 'COMMENTS': 'Installments' };
    const PV_KEY = 'muLeadPreview';   // the picked file's preview: this browser tab only (sessionStorage), never sent anywhere
    const h = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fileIn = document.querySelector('input[type=file][name=leadfile]');
    const th = [...document.querySelectorAll('th')].find((x) => /^\s*VICIDIAL Column\s*$/i.test(x.textContent));
    const mapTable = th && th.closest('table');
    if (!fileIn && !(mapTable && mapTable.closest('form'))) { try { sessionStorage.removeItem(PV_KEY); } catch (e) {} return; }   // results page: done with the file

    document.documentElement.classList.add('mu-ll');
    const st = document.createElement('style');
    st.textContent = `
    html.mu-ll body{background:#eef1f5!important}
    .mu-wrap{display:flex;gap:18px;align-items:flex-start;justify-content:center;margin:22px 20px 40px;font:13px "Segoe UI",Arial,sans-serif;color:#1d2530}
    .mu-wrap *{box-sizing:border-box}
    .mu-card,.mu-pv{background:#fff;border:1px solid #dde2e8;border-radius:12px;box-shadow:0 2px 10px rgba(20,30,50,.08);overflow:hidden}
    .mu-card{width:760px;flex:none}
    .mu-pv{flex:1;min-width:380px;max-width:820px;position:sticky;top:12px}
    .mu-head{padding:16px 20px 12px;border-bottom:1px solid #e6eaef}
    .mu-head h1{margin:0;font:700 18px "Segoe UI",Arial}.mu-head p{margin:4px 0 0;color:#5b6675}
    .mu-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
    .mu-chip{background:#f1f4f8;border:1px solid #dde2e8;border-radius:999px;padding:3px 10px;font-size:12px;color:#4a5563}.mu-chip b{color:#1d2530}
    .mu-legend{display:flex;gap:16px;align-items:center;padding:10px 20px;font-size:12px;color:#5b6675;background:#fafbfc;border-bottom:1px solid #e6eaef}
    .mu-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;background:#2563eb;margin-right:6px;vertical-align:-1px}
    /* both screens: Vici's table restyled */
    table.mu-t{width:100%!important;background:#fff!important;border-collapse:collapse}
    table.mu-t tr{background:#fff!important}
    table.mu-t td{padding:9px 20px!important;border-bottom:1px solid #eef1f4;text-align:left!important;vertical-align:middle}
    table.mu-t td font,table.mu-t td b{font:13px "Segoe UI",Arial!important;color:#4a5563}
    table.mu-t td:first-child font,table.mu-t td:first-child b{font-weight:600!important;color:#1d2530}
    table.mu-t select{height:32px;border:1px solid #cdd4dd;border-radius:8px;padding:0 10px;font:13px "Segoe UI",Arial;background:#fff;color:#1d2530;max-width:440px}
    table.mu-t select[multiple]{height:110px;padding:4px;width:440px}
    table.mu-t select:focus{outline:2px solid #2563eb;outline-offset:0;border-color:#2563eb}
    table.mu-t input[type=radio],table.mu-t input[type=checkbox]{accent-color:#2563eb;margin:0 5px 0 0;vertical-align:-2px}
    table.mu-t input[type=checkbox]{margin-left:10px}
    table.mu-t img[alt=HELP]{width:16px;height:16px;opacity:.55;vertical-align:middle;cursor:pointer}
    table.mu-t input[type=file]{font:13px "Segoe UI",Arial;color:#1d2530}
    table.mu-t input[type=file]::file-selector-button{background:#2563eb;color:#fff;border:0;border-radius:8px;height:34px;padding:0 16px;font:600 13px "Segoe UI",Arial;margin-right:12px;cursor:pointer}
    table.mu-t tr.mu-file td{background:#f5f8ff!important;padding:16px 20px!important}
    html.mu-ll input[name=submit_file],html.mu-ll input[name=OK_to_process]{background:#2563eb!important;color:#fff;border:0;border-radius:8px;height:36px;padding:0 22px;font:600 13px "Segoe UI",Arial;cursor:pointer}
    html.mu-ll input[name=reload_page]{background:#fff!important;color:#1d2530;border:1px solid #c4ccd6;border-radius:8px;height:36px;padding:0 16px;font:600 13px "Segoe UI",Arial;cursor:pointer}
    table.mu-up td:first-child{width:210px!important}
    table.mu-up tr:nth-last-child(2) td{text-align:right!important;background:#fafbfc!important;padding:14px 20px!important}
    table.mu-up tr:last-child td{border:0;padding:8px 20px!important}table.mu-up tr:last-child font{font-size:11px!important;color:#8a94a3!important}
    table.mu-map tr:first-child{display:none}
    table.mu-map td{padding:7px 20px!important}
    table.mu-map td:first-child{width:52%}
    table.mu-map font.standard{font:600 13px "Segoe UI",Arial!important;color:#1d2530}
    table.mu-map select{width:100%;max-width:none}
    table.mu-map select.mu-set{border-color:#1aa33c;background:#f2fbf4}
    table.mu-map select.mu-auto{border-style:dashed}
    table.mu-map tr.mu-row{background:#f5f8ff!important}
    table.mu-map tr:last-child{background:#fafbfc!important}
    table.mu-map tr:last-child th{padding:14px 20px!important;text-align:right}
    .mu-lbl{display:flex;align-items:center;gap:8px;font:700 13px "Segoe UI",Arial;color:#1d4ed8}
    .mu-lbl::before{content:"";width:10px;height:10px;border-radius:3px;background:#2563eb}
    .mu-orig{display:block;margin-left:18px;font:11px "Segoe UI",Arial;color:#7a8494}
    .mu-old,html.mu-ll form>hr{display:none}
    /* the file preview */
    .mu-pv table{width:100%;border-collapse:collapse}
    .mu-pv th{text-align:left;font:700 11px "Segoe UI",Arial;letter-spacing:.05em;color:#5b6675;background:#fafbfc;padding:8px 14px;border-bottom:1px solid #e6eaef}
    .mu-pv td{padding:7px 14px;border-bottom:1px solid #eef1f4;vertical-align:top}
    .mu-pv td.col{font-weight:700;white-space:nowrap}
    .mu-pv td.ex span{display:inline-block;background:#f1f4f8;border-radius:6px;padding:1px 7px;margin:0 4px 3px 0;white-space:nowrap;max-width:170px;overflow:hidden;text-overflow:ellipsis;vertical-align:top}
    .mu-pv td.to{white-space:nowrap}
    .mu-pv .tag{display:inline-block;border-radius:999px;padding:2px 9px;font:600 11.5px "Segoe UI",Arial}
    .mu-pv .tag.on{background:#e7f7ec;color:#137a32;border:1px solid #b6e3c3}
    .mu-pv .tag.off{background:#f1f4f8;color:#8a94a3;border:1px dashed #c9d0d9}
    .mu-pv tr.on td.col{color:#137a32}
    .mu-pv .note{padding:10px 14px;font-size:11.5px;color:#7a8494;background:#fafbfc}
    .mu-empty{padding:28px 20px;color:#7a8494;text-align:center}`;
    document.head.appendChild(st);

    // put Vici's table into a card (still inside Vici's form), with the preview beside it
    const frame = (table, title, sub) => {
      const wrap = document.createElement('div'); wrap.className = 'mu-wrap';
      const card = document.createElement('div'); card.className = 'mu-card';
      card.innerHTML = `<div class="mu-head"><h1>${title}</h1>${sub}</div>`;
      table.parentNode.insertBefore(wrap, table); wrap.appendChild(card); card.appendChild(table);
      table.classList.add('mu-t'); table.removeAttribute('width'); table.removeAttribute('bgcolor');
      const pv = document.createElement('div'); pv.className = 'mu-pv'; wrap.appendChild(pv);
      return { card, pv };
    };
    const loadPV = () => { try { return JSON.parse(sessionStorage.getItem(PV_KEY) || 'null'); } catch (e) { return null; } };
    const chipsFor = (p, extra) => `<div class="mu-chips"><span class="mu-chip"><b>${h(p.name)}</b></span><span class="mu-chip"><b>${Number(p.total).toLocaleString()}</b> leads</span>${extra}</div>`;
    const note = '<div class="note">Read on this PC only and kept only while this tab is open. Cleared once the leads are processed.</div>';

    // ---------- screen 1: pick the file ----------
    if (fileIn) {
      const table = fileIn.closest('table');
      const { pv } = frame(table, 'Load leads', '<p>Pick the file and the list. You match the columns on the next screen.</p>');
      table.classList.add('mu-up');
      fileIn.closest('tr').classList.add('mu-file');
      // Mortgageusa's usual settings, picked for you each time (you can still change them before Submit)
      const pick = (name, test) => { const sel = document.querySelector(`select[name=${name}]`); const o = sel && [...sel.options].find(test); if (o) sel.value = o.value, o.selected = true; };
      pick('phone_code_override', (o) => /^\s*1\s*-\s*USA\s*$/i.test(o.textContent));
      pick('postalgmt', (o) => o.value === 'POSTAL');
      // came from a list's "Load leads" button: that list is picked for you
      const want = (location.hash.match(/mu-list=([^&]+)/) || [])[1];
      if (want) pick('list_id_override', (o) => o.value.replace(/[\\'"]/g, '') === decodeURIComponent(want));
      const show = (p, msg) => {
        pv.innerHTML = !p ? `<div class="mu-head"><h1>Your file</h1></div><div class="mu-empty">${msg || 'Pick a file to see what\'s in it.'}</div>`
          : `<div class="mu-head"><h1>Your file</h1>${chipsFor(p, `<span class="mu-chip"><b>${p.headers.length}</b> columns</span>`)}</div>
             <table><thead><tr><th>COLUMN</th><th>FIRST LEADS</th></tr></thead><tbody>${p.headers.map((c, i) =>
               `<tr><td class="col">${h(c)}</td><td class="ex">${p.rows.slice(0, 2).map((r) => `<span>${h(r[i])}</span>`).join('') || '<i>empty</i>'}</td></tr>`).join('')}</tbody></table>${note}`;
      };
      try { sessionStorage.removeItem(PV_KEY); } catch (e) {}
      show(null);
      fileIn.addEventListener('change', async () => {
        const f = fileIn.files && fileIn.files[0];
        try { sessionStorage.removeItem(PV_KEY); } catch (e) {}
        if (!f) return show(null);
        show(null, 'Reading the file…');
        try {
          const p = await readLeadFile(f);
          if (!p) return show(null, 'No preview for this kind of file (.xls). The upload itself still works. Save it as .xlsx or .csv to see the preview.');
          try { sessionStorage.setItem(PV_KEY, JSON.stringify(p)); } catch (e) {}
          show(p);
        } catch (e) { show(null, 'Couldn\'t read this file for the preview. The upload itself still works.'); }
      });
      return;
    }

    // ---------- screen 2: match the columns ----------
    const hv = (n) => ((document.querySelector(`input[name=${n}]`) || {}).value || '').trim();
    const info = mapTable.previousElementSibling && mapTable.previousElementSibling.tagName === 'CENTER' ? mapTable.previousElementSibling : null;
    if (info) info.classList.add('mu-old');
    const chip = (label, v) => v ? `<span class="mu-chip">${label} <b>${h(v)}</b></span>` : '';
    const { card, pv } = frame(mapTable, 'Match your file\'s columns',
      `<div class="mu-chips">${chip('File', hv('leadfile_name'))}${chip('List', hv('list_id_override'))}${chip('Phone code', hv('phone_code_override'))}${chip('Duplicate check', hv('dupcheck'))}</div>`);
    mapTable.classList.add('mu-map');
    card.querySelector('.mu-head').insertAdjacentHTML('afterend',
      '<div class="mu-legend"><span><i></i>Mortgageusa name (Vici\'s own name underneath)</span><span style="margin-left:auto">Green = matched · dashed = matched for you, check it</span></div>');
    mapTable.querySelectorAll('td > font.standard').forEach((f) => {
      const name = f.textContent.replace(/:\s*$/, '').trim().toUpperCase();
      if (KEY[name]) { f.innerHTML = `<span class="mu-lbl">${h(KEY[name])}</span><span class="mu-orig">Vici: ${h(name.toLowerCase())}</span>`; f.closest('tr').classList.add('mu-row'); }
      else f.textContent = name.charAt(0) + name.slice(1).toLowerCase().replace(/\bid\b/, 'ID');
    });
    const sels = [...mapTable.querySelectorAll('select')];
    // Columns whose meaning is clear get matched for you (marked "auto"); any pick of your own always wins.
    const SAME = {
      first_name_field: ['first', 'first name', 'firstname', 'fname'], last_name_field: ['last', 'last name', 'lastname', 'lname'],
      address1_field: ['address', 'address1', 'street', 'street address', 'property address'], city_field: ['city'], state_field: ['state', 'st'],
      postal_code_field: ['postal', 'postal code', 'zip', 'zip code', 'zipcode'], phone_number_field: ['phone', 'phone number', 'phone1', 'cell', 'mobile'],
      province_field: ['value', 'home value', 'property value', 'est value'], security_phrase_field: ['interest', 'interest rate', 'rate'],
      vendor_lead_code_field: ['mort type', 'mortgage type', 'loan type'], title_field: ['fico', 'credit', 'credit score'],
      address2_field: ['loan amount', 'loan amt', 'balance'], address3_field: ['cash out', 'cash out amount', 'cashout'],
      alt_phone_field: ['ssn'], email_field: ['revolving', 'revolving debt'], comments_field: ['installment', 'installments', 'source'],   // Mortgageusa's files: Source always goes into Installments
      date_of_birth_field: ['dob', 'date of birth', 'birthday'], middle_initial_field: ['middle', 'middle initial', 'mi'] };
    const nm = (x) => String(x || '').toLowerCase().replace(/["']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const autoMatch = () => {
      const taken = new Set(sels.map((s) => s.value).filter((v) => v !== '-1'));
      sels.forEach((s) => {
        if (s.value !== '-1' || !SAME[s.name]) return;
        const o = [...s.options].find((o) => o.value !== '-1' && !taken.has(o.value) && SAME[s.name].includes(nm(o.textContent)));
        if (o) { s.value = o.value; s.dataset.auto = '1'; taken.add(o.value); }
      });
    };
    const labelOf = (s) => { const f = s.closest('tr').querySelector('td font.standard'); const b = f && f.querySelector('.mu-lbl'); return (b ? b.textContent : f ? f.textContent : '').trim(); };
    const p = loadPV();
    const ok = p && p.name === hv('leadfile_name');
    const draw = () => {
      sels.forEach((s) => { s.classList.toggle('mu-set', s.value !== '-1'); s.classList.toggle('mu-auto', !!s.dataset.auto && s.value !== '-1'); });
      if (!ok) {
        pv.innerHTML = '<div class="mu-head"><h1>Your file</h1></div><div class="mu-empty">The preview shows up when the file is picked on the first screen. Click START OVER and pick it again to see it here.</div>';
        return;
      }
      const used = p.headers.filter((c, i) => sels.some((s) => s.value === String(i))).length;
      pv.innerHTML = `<div class="mu-head"><h1>Your file</h1>${chipsFor(p, `<span class="mu-chip"><b>${used}</b> of ${p.headers.length} columns matched</span>`)}</div>
        <table><thead><tr><th>FILE COLUMN</th><th>FIRST FEW LEADS</th><th>GOES INTO</th></tr></thead><tbody>${p.headers.map((c, i) => {
          const to = sels.filter((s) => s.value === String(i)).map((s) => labelOf(s) + (s.dataset.auto ? ' · auto' : ''));
          const ex = p.rows.map((r) => r[i]).filter((v) => v !== '' && v != null).slice(0, 3);
          return `<tr class="${to.length ? 'on' : ''}"><td class="col">${h(c)}</td><td class="ex">${ex.map((v) => `<span>${h(v)}</span>`).join('') || '<i>empty</i>'}</td>
            <td class="to">${to.length ? to.map((t) => `<span class="tag on">→ ${h(t)}</span>`).join(' ') : '<span class="tag off">not used</span>'}</td></tr>`;
        }).join('')}</tbody></table>${note}`;
    };
    sels.forEach((s) => s.addEventListener('change', () => { delete s.dataset.auto; draw(); }));
    autoMatch();
    draw();
    const form = mapTable.closest('form');
    form.addEventListener('submit', () => { try { sessionStorage.removeItem(PV_KEY); } catch (e) {} });
  }

  // Reads the first rows of a lead file in the browser: .xlsx (Excel), .csv, .txt (comma, tab or pipe).
  // Returns { name, headers, rows (first 3 leads), total } or null for kinds it can't read (.xls).
  async function readLeadFile(f) {
    const name = f.name;
    if (/\.xlsx$/i.test(name)) return Object.assign({ name }, await readXlsx(await f.arrayBuffer()));
    if (/\.xls$/i.test(name)) return null;
    const text = await f.text();
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
    if (!lines.length) return { name, headers: [], rows: [], total: 0 };
    const first = lines[0];
    const delim = ['\t', '|', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const split = (line) => {
      if (delim !== ',') return line.split(delim).map((x) => x.trim());
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
      }
      out.push(cur.trim()); return out;
    };
    return { name, headers: split(first), rows: lines.slice(1, 4).map(split), total: lines.length - 1 };
  }

  // Minimal .xlsx reader (an .xlsx is a zip of XML files): first sheet only, header row + first 3 leads + count.
  async function readXlsx(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip');
    const files = {};
    let p = dv.getUint32(eocd + 16, true);
    const n = dv.getUint16(eocd + 10, true);
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const fl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const fname = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + fl));
      files[fname] = { method, csize, off };
      p += 46 + fl + xl + cl;
    }
    const read = async (fname) => {
      const e = files[fname]; if (!e) return null;
      const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return new TextDecoder().decode(data);
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(ds).text();
    };
    const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
    // the first sheet, as the workbook lists it
    let sheetPath = 'xl/worksheets/sheet1.xml';
    try {
      const wb = xml(await read('xl/workbook.xml')), rels = xml(await read('xl/_rels/workbook.xml.rels'));
      const s1 = wb.getElementsByTagName('sheet')[0];
      const rid = s1 && (s1.getAttribute('r:id') || s1.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      const rel = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
      if (rel) { const t = rel.getAttribute('Target').replace(/^\//, ''); sheetPath = t.startsWith('xl/') ? t : 'xl/' + t; }
    } catch (e) {}
    const ssText = await read('xl/sharedStrings.xml');
    const shared = ssText ? [...xml(ssText).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
    const sheet = xml(await read(sheetPath));
    const rowsEl = [...sheet.getElementsByTagName('row')];
    const colIdx = (ref) => { const m = String(ref || '').match(/^[A-Z]+/); if (!m) return -1; let x = 0; for (const ch of m[0]) x = x * 26 + ch.charCodeAt(0) - 64; return x - 1; };
    const cellsOf = (row) => {
      const out = []; let next = 0;
      for (const c of row.getElementsByTagName('c')) {
        const i = c.hasAttribute('r') ? colIdx(c.getAttribute('r')) : next; next = i + 1;
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        out[i] = t === 's' ? (shared[+(v && v.textContent)] || '') : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : (v ? v.textContent : '');
      }
      for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
      return out;
    };
    const filled = rowsEl.filter((r) => [...r.getElementsByTagName('v'), ...r.getElementsByTagName('t')].some((x) => x.textContent.trim() !== ''));
    if (!filled.length) return { headers: [], rows: [], total: 0 };
    const headers = cellsOf(filled[0]);
    return { headers, rows: filled.slice(1, 4).map(cellsOf), total: filled.length - 1 };
  }



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
  // Address searches: try up to 3 times. Returns null only when the site never answered properly,
  // so a dropped connection is never mistaken for "this address doesn't exist".
  async function suggestJSON(url, ok) {
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise((r) => setTimeout(r, i * 2000));
      const r = await gmGet(url);
      if (r.status === 200) { try { const j = JSON.parse(r.text); if (ok(j)) return j; } catch (e) {} }
    }
    return null;
  }

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
    const qs = [a.full, `${a.street} ${a.state} ${a.zip}`];
    const answers = await Promise.all(qs.map((q) => suggestJSON('https://www.zillowstatic.com/autocomplete/v3/suggestions?q=' + encodeURIComponent(q),
      (j) => j && Array.isArray(j.results))));
    for (const j of answers) {
      for (const r of ((j && j.results) || [])) {
        const m = r.metaData;
        if (!m || !m.zpid || !m.streetNumber || !sameArea(a, m.state, m.zipCode)) continue;
        if (sameProperty(a, `${m.streetNumber} ${m.streetName}`, m.city, m.state, m.zipCode)) return zItem(m);
        near.push(zItem(m));
      }
    }
    return { near: rankNear(a, near), failed: answers.some((j) => !j) };
  }

  // Realtor.com's own autocomplete -> property id
  const rItem = (r) => ({ id: String(r.mpr_id), line: r.line, city: r.city, state: r.state_code, zip: r.postal_code });
  async function lookupRealtor(a) {
    const near = [];
    const qs = [a.full, `${a.street} ${a.state} ${a.zip}`];
    const answers = await Promise.all(qs.map((q) => suggestJSON('https://parser-external.geo.moveaws.com/suggest?client_id=rdc-home&limit=8&area_types=address&input=' +
      encodeURIComponent(q), (j) => j && (Array.isArray(j.autocomplete) || (j.meta && j.meta.es_total_hits === 0)))));
    for (const j of answers) {
      for (const r of ((j && j.autocomplete) || [])) {
        if (!r.mpr_id || !r.line || !sameArea(a, r.state_code, r.postal_code)) continue;
        if (sameProperty(a, r.line, r.city, r.state_code, r.postal_code)) return rItem(r);
        near.push(rItem(r));
      }
    }
    return { near: rankNear(a, near), failed: answers.some((j) => !j) };
  }

  const cache = {}; // full address -> { zillow, realtor, done, info }
  function lookup(a) {
    if (cache[a.full]) return cache[a.full];
    const c = cache[a.full] = { done: false, sites: {} };
    c.promise = Promise.all([lookupZillow(a), lookupRealtor(a)]).then(([z, r]) => {
      // an exact hit has an id; otherwise we keep the close matches for the agent to pick from
      c.zillow = z.zpid ? z : null; c.zNear = z.near || []; c.zFail = !z.zpid && !!z.failed;
      c.realtor = r.id ? r : null; c.rNear = r.near || []; c.rFail = !r.id && !!r.failed;
      c.done = true;
      refresh();
      loadDetails(a, c);
    });
    return c;
  }

  // A site that didn't answer gets asked again: by itself after 20s and 60s, or when the agent clicks Try again.
  async function retrySites(a, c, manual) {
    if (c.retrying) return;
    c.retrying = true;
    if (!manual) c.retries = (c.retries || 0) + 1;
    const z = c.zFail ? lookupZillow(c.pick || a) : null, r = c.rFail ? lookupRealtor(c.pick || a) : null;
    const keys = [].concat(c.zFail ? ['zillow', 'trulia'] : [], c.rFail ? ['realtor'] : [],
      siteState(c, 'homes').state === 'error' ? ['homes'] : []);
    keys.forEach((k) => { c.sites[k] = { state: 'loading' }; });
    renderAll();
    const [zz, rr] = await Promise.all([z, r]);
    if (zz) { c.zillow = zz.zpid ? zz : null; c.zNear = zz.near || []; c.zFail = !zz.zpid && !!zz.failed; c.zHistory = null; }
    if (rr) { c.realtor = rr.id ? rr : null; c.rNear = rr.near || []; c.rFail = !rr.id && !!rr.failed; }
    c.retrying = false;
    keys.forEach((k) => { c.sites[k] = { state: 'idle' }; loadSite(a, c, k); });
  }
  function scheduleRetry(a, c) {
    if (c.retryTimer || (c.retries || 0) >= 2) return;
    c.retryTimer = setTimeout(() => {
      c.retryTimer = null;
      if (getAddress().full === a.full) retrySites(a, c, false);
    }, (c.retries || 0) ? 60000 : 20000);
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
    if ((key === 'zillow' || key === 'trulia') && !c.zillow) return done({ state: c.zFail ? 'offline' : 'nomatch', near: c.zNear || [] });
    if (key === 'realtor' && !c.realtor) return done({ state: c.rFail ? 'offline' : 'nomatch', near: c.rNear || [] });

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
      else { c.zillow = null; c.zNear = (z && z.near) || []; c.zFail = !!(z && z.failed); ['zillow', 'trulia'].forEach((k) => { c.sites[k] = { state: c.zFail ? 'offline' : 'nomatch', near: c.zNear, url: SITES.find((y) => y.key === k).url(a, c) }; }); }
    }
    if (rNeeds) {
      const r = key === 'realtor' ? x : await lookupRealtor(p);
      if (r && r.id) { c.realtor = r; c.realtorPicked = true; c.sites.realtor = { state: 'idle' }; loadSite(a, c, 'realtor'); }
      else { c.realtor = null; c.rNear = (r && r.near) || []; c.rFail = !!(r && r.failed); c.sites.realtor = { state: c.rFail ? 'offline' : 'nomatch', near: c.rNear, url: SITES.find((y) => y.key === 'realtor').url(a, c) }; }
    }
    renderAll();
  }

  function loadDetails(a, c) {
    ['zillow', 'trulia', 'realtor'].forEach((k) => loadSite(a, c, k)); // Homes.com starts from renderAll (background tab)
  }

  // Opens homes.com in a background tab, lets the homes.com helper search the address, waits for its answer
  function homesLookup(a, pick) {
    return new Promise((resolve) => {
      const id = Date.now();
      GM_setValue('vpHomesJob', { id, t: id, query: pick || a.full, street: a.street, city: a.city, state: a.state, zip: a.zip, pick: pick || '' });
      let tab = null, done = false, alive = false, near = [], giveUp = null;
      const timers = [];
      const finish = (v) => {
        if (done) return;
        done = true; GM_removeValueChangeListener(listener); GM_removeValueChangeListener(prog);
        timers.concat(giveUp ? [giveUp] : []).forEach(clearTimeout);
        try { tab && tab.close(); } catch (e) {}
        resolve(v);
      };
      const listener = GM_addValueChangeListener('vpHomesResult', (name, oldV, v) => { if (v && v.id === id) finish(v); });
      // The helper reports as it goes. Once it has typed the address, Vici (not the slowed-down
      // background tab) keeps the clock: no matching suggestion in 9 seconds = no exact match.
      const prog = GM_addValueChangeListener('vpHomesProgress', (name, oldV, v) => {
        if (!v || v.id !== id || done) return;
        alive = true;
        if (v.near) near = v.near;
        if (v.stage === 'typed' && !giveUp) giveUp = setTimeout(() => finish({ ok: false, why: 'no exact address match on Homes.com', near }), pick ? 20000 : 9000);
        if (v.stage === 'clicked' && giveUp) { clearTimeout(giveUp); giveUp = null; }   // found it; the property page is loading
      });
      // First a background tab the agent never sees (it renames itself and closes when done).
      // If it hasn't even started after 15 seconds, switch to the small pop-up window (full speed).
      const url = 'https://www.homes.com/#vprop-' + id;
      tab = GM_openInTab(url, { active: false, insert: true, setParent: true });
      timers.push(setTimeout(() => {
        if (done || alive) return;
        try { tab && tab.close(); } catch (e) {}
        const w = 520, h = 420;
        let pop = null;
        try { pop = window.open(url, 'vprop-homes', `popup=yes,width=${w},height=${h},left=${Math.max(0, screen.availWidth - w - 20)},top=${Math.max(0, screen.availHeight - h - 60)}`); } catch (e) { pop = null; }
        tab = pop ? { close: () => { try { pop.close(); } catch (e) {} } } : GM_openInTab(url, { active: false, insert: true, setParent: true });
      }, 15000));
      timers.push(setTimeout(() => finish(null), 60000));
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
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    retry: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>'
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
          <div class="vp-wait-sub">Homes.com is being looked up in a background tab named <b>\u201cVici lookup\u201d</b>. It closes by itself when it's done (usually 5 to 20 seconds).</div></div></div>`);
        return msg('Looking up the property…');
      case 'ok': return body((st.picked ? `<div class="vp-banner">${icon('pin')}<div><b>Showing a close match, not the exact lead address:</b> ${esc(nearLabel(st.picked))}. Confirm the address with the borrower.</div></div>` : '') + modelHTML(a, st.model, key));
      case 'shared':
        return z.state === 'ok' ? body(`<div class="vp-note">Trulia uses the same property records as Zillow.</div>` + modelHTML(a, z.model, key))
          : msg('Couldn\'t read this home\'s details from Trulia right now.');
      case 'nosource': return fallback('the site doesn\'t allow it');
      case 'blocked':
        if (key === 'realtor' || key === 'homes') return fallback('it blocks background lookups');
        return msg(`${esc(s.label)} asked for a bot check. Click <b>Open on ${esc(s.label)}</b>, complete the check once, and the next lead will fill in.`);
      case 'offline': {
        const near = st.near || [];
        return msg(`<b>${esc(s.label)} didn't answer just now</b>, so this address hasn't been checked yet. It isn't a \u201cno match\u201d.
          ${c && c.retrying ? '<div class="vp-wait-sub">Trying again…</div>' : `<div class="vp-wait-sub">${c && c.retryTimer ? 'Trying again by itself in a few seconds. ' : ''}You can also click <b>Try again</b>.</div>`}
          <div class="vp-near" style="margin-top:12px"><button type="button" data-vp-retry="1">${icon('retry')}<span>Try again</span></button></div>` +
          (near.length ? `<div class="vp-near-h">Close matches it did find in ${esc(a.state)} ${esc(a.zip)}:</div>
          <div class="vp-near">${near.map((x, i) => `<button type="button" data-vp-near="${i}" data-vp-key="${key}">${icon('pin')}<span>${esc(nearLabel(x))}</span></button>`).join('')}</div>` : ''));
      }
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
        if (key === 'homes' && z.state !== 'ok') return msg(`Homes.com couldn't be read this time. <div class="vp-near" style="margin-top:12px"><button type="button" data-vp-retry="1">${icon('retry')}<span>Try again</span></button></div>`);
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
        if (e.target.closest('[data-vp-retry]')) {
          const a = getAddress(), c = cache[a.full];
          if (c) { if (c.retryTimer) { clearTimeout(c.retryTimer); c.retryTimer = null; } retrySites(a, c, true); }
          return;
        }
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
      tabs[s.key].classList.toggle('fail', ['blocked', 'nomatch', 'nosource', 'error', 'offline'].includes(st));
      tabs[s.key].title = `${s.label}: ` + ({ ok: 'facts ready', shared: 'facts ready', loading: 'loading…', blocked: 'blocked by the site – open it directly',
        nomatch: 'no exact match', offline: 'site didn\'t answer – trying again', nosource: 'open on the site', error: 'couldn\'t load', idle: 'waiting for a lead address' }[st] || st);
    });
    // Homes.com starts on its own as soon as a call's address is looked up (in a background tab)
    if (c && c.done && siteState(c, 'homes').state === 'idle') loadSite(a, c, 'homes');
    if (c && c.done && !c.retrying && (c.zFail || c.rFail || siteState(c, 'homes').state === 'error')) scheduleRetry(a, c);
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
  const LAYOUT_USERS = [];   // everyone
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
    // one grid: 12px left edge, 12px gaps; buttons, form and pitch sheet share a top line,
    // card + pitch sheet share a bottom line
    custtime: [12, 52], dialable: [12, 72], status: [12, -100],   // STATUS line hidden
    pause: [12, 107],                                            // button column top = 100
    form: [184, 100],
    card: [12, 424, 892],
    pitch: [916, 100, 626, 605],
    seconds: [1510, 30], liveLight: [1610, 25], groups: [1765, 5],
    agentsList: [1720, 45], agentsLink: [1742, 30], hotkeys: [1724, 556],
    // old separate-button spots (Vici's real buttons, now hidden behind the modern column)
    webform: [10, 160], park: [10, 185], transfer: [10, 210], hangup: [10, 235], dtmf: [10, 265],
    manual: [40, 305], leadsearch: [35, 335], callbacks: [5, 365]
  };
  const byId = (id) => document.getElementById(id);
  let laidOut = false, viewsSet = false, styleSet = false, viewsTicks = 0, viewsLastClick = -9, viewsGood = 0;

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
    if (!styleSet) {   // (re)write our styles once per page load, replacing any older copy
      styleSet = true;
      const st = byId('vl-style') || document.createElement('style'); st.id = 'vl-style';
      st.textContent = `
        #DiaLlOgButtonspan{left:${L.manual[0]}px!important;top:${L.manual[1]}px!important}
        #ManuaLDiaLButtons a[onclick*="'FAST'"]{display:none!important}
        #CallbacksButtons{left:${L.callbacks[0]}px!important;top:${L.callbacks[1]}px!important}
        #SecondSspan{left:${L.seconds[0]}px!important;top:${L.seconds[1]}px!important}
        #AgentViewSpan{left:${L.agentsList[0]}px!important;top:${L.agentsList[1]}px!important}
        #webphoneLinkSpan{visibility:hidden!important}
        #dialableleadsspan{left:${L.dialable[0]}px!important;top:${L.dialable[1]}px!important}
        #AgentViewLinkSpan{left:${L.agentsLink[0]}px!important;top:${L.agentsLink[1]}px!important}
        #AgentViewLinkSpan td{text-align:left!important;white-space:nowrap}
        #vl-hkwrap{z-index:30!important}
        #MainCommit,#MaiNfooterspan,#hotkeysdisplay,#HotKeyEntriesBox{visibility:hidden!important}
        html,body,#Header table,#Tabs table,#Tabs td,#AgentViewSpan,#AgentViewSpan table{background:#ccc!important;background-color:#ccc!important}
        #vl-form{width:720px;display:grid;grid-template-columns:1fr 1fr;gap:10px;font:12px "Segoe UI",Arial,sans-serif;color:#1d2530}
        #vl-form .col{display:flex;flex-direction:column;gap:10px;min-width:0}
        #vl-form .sec{background:#fff;border:1px solid #dde2e8;border-radius:9px;padding:9px 12px 11px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
        #vl-form .sec.grow{flex:1;display:flex;flex-direction:column}
        #vl-form h3{margin:0 0 7px;font:700 11px "Segoe UI",Arial;letter-spacing:.06em;color:#4a5563;display:flex;align-items:center;gap:7px}
        #vl-form h3 svg{width:14px;height:14px;color:#2563eb}
        #vl-form .g{display:grid;gap:7px 10px}#vl-form .g+.g{margin-top:7px}
        #vl-form .c2{grid-template-columns:1fr 1fr}#vl-form .c3{grid-template-columns:1fr 1fr 1fr}#vl-form .s3{grid-column:1/-1}
        #vl-form .fl{display:flex;flex-direction:column;gap:2px;min-width:0}
        #vl-form .fl>label{font-size:10.5px;color:#5b6675;font-weight:600}
        #vl-form .slot{display:block;min-width:0}
        #vl-form input[type=text],#vl-form select,#vl-form textarea{width:100%;box-sizing:border-box;height:24px;border:1px solid #cdd4dd;border-radius:6px;padding:2px 8px;
          font:13px "Segoe UI",Arial,sans-serif;background:#fff;color:#1d2530;margin:0}
        #vl-form select{padding:2px 4px;font-size:12px}
        #vl-form input:focus,#vl-form select:focus,#vl-form textarea:focus{outline:2px solid #2563eb;outline-offset:0;border-color:#2563eb}
        #vl-form .ro .slot{height:24px;display:flex;align-items:center;font:600 13px "Segoe UI",Arial;white-space:nowrap}
        #vl-form .notes{flex:1;display:flex}
        #vl-form #call_notes{height:auto;min-height:60px;flex:1;resize:none;padding:6px 8px}
        /* one font for the whole screen (property tabs keep each site's own look) */
        body{font-family:"Segoe UI",Arial,sans-serif!important}
        body font,body td,body a,body [class*="_text"],body [class*="body_"],body [class*="queue_"],body .log_title,body .cust_form{font-family:inherit!important}
        .vl-btn{width:154px;text-align:center}
        #vl-pause,[id^="vl-b-"],#DiaLlOgButtonspan,#vl-leadsearch,#CallbacksButtons{visibility:hidden!important}
        #vl-col{width:160px;display:flex;flex-direction:column;gap:6px}
        #vl-col *{box-sizing:border-box}
        #vl-col .mb{display:flex;align-items:center;gap:8px;height:30px;padding:0 11px;border-radius:8px;font:600 12px "Segoe UI",Arial;letter-spacing:.02em;
          border:1px solid transparent;box-shadow:0 1px 2px rgba(0,0,0,.15);cursor:pointer;text-align:left;width:100%;user-select:none}
        #vl-col .mb svg{width:15px;height:15px;flex:none}
        #vl-col .mb small{display:block;font-weight:400;font-size:10px;opacity:.85;letter-spacing:0}
        #vl-col .neutral{background:#fff;color:#1d2530;border-color:#c4ccd6}
        #vl-col .park{background:#eef2ff;color:#3346a8;border-color:#b8c3f2}
        #vl-col .xfer{background:#f3ecff;color:#6b3fb5;border-color:#d4c3f2}
        #vl-col .hang{background:#c4252b;color:#fff}
        #vl-col .paused{background:#ffd84d;color:#5c4400;border-color:#e0b800;height:40px}
        #vl-col .active{background:#1aa33c;color:#fff;height:40px}
        #vl-col .other{background:#2563eb;color:#fff;height:40px}
        #vl-col .dis{opacity:.4;box-shadow:none;filter:grayscale(1);cursor:default}
        #vl-col .pz.dis{height:40px}
        #vl-col .dtmf{display:flex;gap:6px}#vl-col .dtmf .mb{flex:1}
        #vl-col .dtmf input{width:44px;height:30px;border:1px solid #c4ccd6;border-radius:8px;font:13px Arial;padding:0 6px;box-sizing:border-box}
        #vl-col .lks{margin-top:6px;display:flex;flex-direction:column;gap:1px}
        #vl-col .lk{display:flex;align-items:center;gap:7px;height:26px;padding:0 8px;border-radius:7px;color:#2b3a55;font:600 12px "Segoe UI",Arial;cursor:pointer;user-select:none}
        #vl-col .lk:hover{background:#e2e6eb}#vl-col .lk svg{width:14px;height:14px;color:#2563eb;flex:none}
        #vl-col .lk.dis{opacity:.45;cursor:default}
        #vl-col .lk b{margin-left:auto;font-weight:600;font-size:10.5px;background:#e2e6eb;color:#5b6675;border-radius:9px;padding:1px 7px}
        #vl-col .lk b.hot{background:#c4252b;color:#fff}
        #vl-hk{width:166px;height:38px;border:0;border-radius:9px;background:linear-gradient(#3d78d6,#2a5bb0);color:#fff;display:flex;align-items:center;justify-content:center;gap:8px;
          font:600 14px "Segoe UI",Arial,sans-serif;box-shadow:0 2px 5px rgba(0,0,0,.25);cursor:pointer}
        #vl-hk i{width:10px;height:10px;border-radius:50%;background:#9fb7de}
        #vl-hk.on{background:linear-gradient(#2fbf4f,#159a35)} #vl-hk.on i{background:#d9ffd9}
        #vl-livebadge{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:12px;font:700 11px "Segoe UI",Arial;letter-spacing:.04em;white-space:nowrap}
        #vl-status{visibility:hidden!important}
        /* Transfer - Conf: Vici's panel stays (Vici opens/closes it) but is see-through; our card shows instead */
        #TransferMain{left:${L.card[0]}px!important;top:${L.pitch[1] + L.pitch[3] + 12}px!important;opacity:0!important;pointer-events:none!important}
        #vl-xfer{width:${L.pitch[0] + L.pitch[2] - L.card[0]}px;background:#fff;border:1px solid #dde2e8;border-radius:9px;box-shadow:0 1px 2px rgba(0,0,0,.08);
          padding:10px 14px 12px;font:12px "Segoe UI",Arial,sans-serif;color:#1d2530;box-sizing:border-box;display:none}
        #vl-xfer.open{display:block}
        #vl-xfer *{box-sizing:border-box}
        #vl-xfer h3{margin:0 0 9px;font:700 11px "Segoe UI",Arial;letter-spacing:.06em;color:#4a5563;display:flex;align-items:center;gap:8px}
        #vl-xfer h3 svg{width:15px;height:15px;color:#6b3fb5}
        #vl-xfer h3 .meta{margin-left:auto;font-weight:400;letter-spacing:0;color:#5b6675;font-size:11.5px;display:flex;align-items:center;gap:6px}
        #vl-xfer h3 .meta input{width:70px;height:22px;border:0;background:transparent;font:600 12px "Segoe UI",Arial;color:#1d2530;padding:0}
        #vl-xfer .row{display:flex;gap:18px;align-items:stretch}
        #vl-xfer .grp{display:flex;flex-direction:column;gap:6px;min-width:0}
        #vl-xfer .lbl{font-size:10.5px;color:#5b6675;font-weight:600}
        #vl-xfer .line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        #vl-xfer select,#vl-xfer input[type=text]{height:30px;border:1px solid #cdd4dd;border-radius:7px;padding:0 9px;font:13px "Segoe UI",Arial;background:#fff;color:#1d2530}
        #vl-xfer .grpslot{flex:1;min-width:0}#vl-xfer .grpslot select{width:100%}
        #vl-xfer #xfernumber{width:220px}
        #vl-xfer .chk{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#2b3a55}
        #vl-xfer .chk input{width:15px;height:15px;margin:0}
        #vl-xfer .agents a{color:#2563eb;font:600 12px "Segoe UI",Arial;text-decoration:none}
        #vl-xfer .div{width:1px;background:#e3e7ec}
        #vl-xfer .b{height:30px;display:inline-flex;align-items:center;gap:7px;padding:0 12px;border-radius:8px;font:600 12px "Segoe UI",Arial;border:1px solid transparent;
          white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.12);cursor:pointer;user-select:none}
        #vl-xfer .b svg{width:14px;height:14px}
        #vl-xfer .pri{background:#6b3fb5;color:#fff}#vl-xfer .sec{background:#f3ecff;color:#6b3fb5;border-color:#d4c3f2}
        #vl-xfer .neu{background:#fff;color:#1d2530;border-color:#c4ccd6}
        #vl-xfer .red{background:#c4252b;color:#fff}#vl-xfer .redo{background:#fff;color:#c4252b;border-color:#f0b4b6}
        #vl-xfer .amb{background:#fff4dd;color:#7a4b00;border-color:#f0d39a}
        #vl-xfer .b.dis{opacity:.4;box-shadow:none;filter:grayscale(1);cursor:default}
        #vl-xfer .b.gone{display:none}
        #AgentViewSpan{overflow:auto!important;scrollbar-width:none!important}#AgentViewSpan::-webkit-scrollbar{display:none}   /* no sliders; wheel still scrolls */
        #vl-groups a[onclick*="OpeNGrouPSelectioN"]{display:none!important}   /* GROUPS hidden, LOGOUT stays */
        #dialableleadsspan,#vl-custtime{font-size:13px!important;line-height:18px}#dialableleadsspan *{font-size:13px!important}
        #vl-livebadge i{width:9px;height:9px;border-radius:50%}
        #vl-livebadge.off{background:#e3e6ea;color:#6b7480;border:1px solid #b9c0c8}#vl-livebadge.off i{background:#9aa3ad}
        #vl-livebadge.on{background:#1aa33c;color:#fff}#vl-livebadge.on i{background:#d9ffd9;box-shadow:0 0 0 3px rgba(255,255,255,.35)}
        #vl-livebadge.dead{background:#c4252b;color:#fff}#vl-livebadge.dead i{background:#ffd5d5}
        .vl-full{left:0!important;top:0!important;width:100vw!important;height:100vh!important;background:#fff;z-index:2147483000!important}
        .vl-full>table{width:100%!important;height:100%!important}
        html.vl-takeover #vprop-tabbar,html.vl-takeover #vprop-card,html.vl-takeover #vprop-screen,html.vl-takeover [id^="vl-"]:not(#vl-hidden):not(#vl-style):not(#vl-pitch-style),
        html.vl-takeover #AgentViewSpan,html.vl-takeover #AgentViewLinkSpan,html.vl-takeover #webphoneSpan,html.vl-takeover #SecondSspan{visibility:hidden!important}
        html.vl-takeover #vl-pitch{display:none!important}
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
        const fl = (lab, ids, cls = '') => `<div class="fl ${cls}"><label>${lab}</label><span class="slot" data-s="${ids}"></span></div>`;
        f.innerHTML = `<div class="col">
          <div class="sec"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/></svg>PROPERTY</h3><div class="g c3">${fl('Address', 'address1', 's3')}${fl('City', 'city')}${fl('State', 'state')}${fl('ZIP', 'postal_code')}</div></div>
          <div class="sec"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>BORROWER</h3><div class="g c2">${fl('First name', 'first_name')}${fl('Last name', 'last_name')}</div>
            <div class="g c3">${fl('Phone', 'phone_numberDISP,phone_number', 'ro')}${fl('Date of birth', 'date_of_birthDISP', 'ro')}${fl('Gender', 'GENDERhideFORie')}</div>
            <div class="g" style="grid-template-columns:1fr 2fr">${fl('FICO', 'title')}${fl('SSN', 'alt_phone')}</div></div></div>
          <div class="col">
          <div class="sec"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18"/><path d="M17 7H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H6"/></svg>LOAN</h3><div class="g c2">${fl('Loan amount', 'address2')}${fl('Value', 'province')}${fl('Rate', 'security_phrase')}${fl('Loan type', 'vendor_lead_code')}${fl('Cash out', 'address3')}${fl('Revolving debt', 'email')}</div></div>
          <div class="sec grow"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/></svg>CALL NOTES</h3><span class="slot notes" data-s="call_notes"></span></div></div>`;
        f.querySelectorAll('[data-s]').forEach((slot) => slot.dataset.s.split(',').forEach((id) => move(field(id), slot)));
        // Edge was autofilling these (e.g. the login number into Revolving Debt); a made-up token stops it
        f.querySelectorAll('input[type=text],textarea').forEach((i) => i.setAttribute('autocomplete', 'vici-lead-' + (i.id || 'x')));
        // Name row: First / MI / Last side by side
        stash(byId('comments')); stash(byId('viewcommentsdisplay'));
        stash(byId('middle_initial')); stash(byId('phone_code'));   // MI and Dial code hidden (still in Vici's form)
      }
      byId('MainPanelCustInfo').style.visibility = 'hidden';
      // Date / session ID / Calls in Queue at the top
      const clock = byId('status') && byId('status').closest('td');
      if (clock) clock.style.visibility = 'hidden';
    }


    // after login: WebPhone panel hidden (it keeps running), Agents View shown. Vici can ignore an early
    // click while it's still loading, so keep checking for the first minute until both have stuck
    // for a few seconds, then stop (so we never fight an agent who changes them later).
    if (!viewsSet && byId('webphoneLink') && byId('AgentViewLink') && !document.documentElement.classList.contains('vl-takeover')) {
      viewsTicks++;
      const wp = byId('webphoneLink').querySelector('a'), av = byId('AgentViewLink').querySelector('a');
      const wpOpen = !!wp && /View\s*-/.test(wp.textContent), avClosed = !!av && /View\s*\+/.test(av.textContent);
      if ((wpOpen || avClosed) && viewsTicks - viewsLastClick >= 3) {
        if (wpOpen) wp.click();
        if (avClosed) av.click();
        viewsLastClick = viewsTicks; viewsGood = 0;
      } else if (!wpOpen && !avClosed) viewsGood++;
      if (viewsGood >= 5 || viewsTicks > 60) viewsSet = true;
    }
    liveBadge();
    modernButtons();
    xferCard();
    takeover();
    watchTakeover();
    hotKeysSwitch();
    try { pitchSheet(); } catch (e) {}
    scrollLock();
  }


  // ---------- Modern button column. Each button mirrors Vici's real button (still on the page, hidden):
  // same available / greyed-out state, and clicking it clicks Vici's own button. ----------
  const BI = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    form: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    park: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M10 16V8h3a2.5 2.5 0 010 5h-3"/></svg>',
    xfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
    hang: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-3.2 0-6.2.8-8.6 2.3-.6.4-.9 1.1-.8 1.8l.4 2c.1.7.8 1.2 1.5 1.1l3-.5c.6-.1 1-.6 1.1-1.2l.2-1.6c1-.3 2.1-.4 3.2-.4s2.2.1 3.2.4l.2 1.6c.1.6.5 1.1 1.1 1.2l3 .5c.7.1 1.4-.4 1.5-1.1l.4-2c.1-.7-.2-1.4-.8-1.8C18.2 9.8 15.2 9 12 9z"/></svg>',
    pad: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="11" r="2"/><circle cx="12" cy="11" r="2"/><circle cx="18" cy="11" r="2"/><circle cx="6" cy="17" r="2"/><circle cx="12" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></svg>',
    dial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>',
    cb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };
  // what Vici's button currently is: its link (if clickable), picture and alt text
  const viciBtn = (el) => { if (!el) return null; const a = el.querySelector('a'), img = el.querySelector('img');
    const src = img ? img.getAttribute('src') || '' : ''; return { a, src, alt: img ? img.alt || '' : (a ? a.textContent : ''), on: !!a && !/_OFF\.|blank/i.test(src) }; };
  const clickVici = (a) => { if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); };
  const btnLabel = (alt) => ({ 'hangup customer': 'HANG UP', 'transfer - conference': 'TRANSFER · CONF', 'send dtmf': 'DTMF' }[String(alt).toLowerCase().trim()] || String(alt).toUpperCase().trim());
  function modernButtons() {
    const col = box('vl-col', L.pause[0], L.pause[1] - 7);
    if (!col.childElementCount) {
      col.innerHTML = `<div class="mb pz" data-b="pause"></div>
        <div class="mb neutral" data-b="WebFormSpan">${BI.form}<span></span></div>
        <div class="mb park" data-b="ParkControl">${BI.park}<span></span></div>
        <div class="mb xfer" data-b="XferControl">${BI.xfer}<span></span></div>
        <div class="mb hang" data-b="HangupControl">${BI.hang}<span></span></div>
        <div class="dtmf"><div class="mb neutral" data-b="SendDTMF">${BI.pad}<span>DTMF</span></div></div>
        <div class="lks"><div class="lk" data-l="manual">${BI.dial}<span>Manual dial</span></div>
          <div class="lk" data-l="search">${BI.search}<span>Lead search</span></div>
          <div class="lk" data-l="cb">${BI.cb}<span>Callbacks</span><b>0</b></div></div>`;
      const dt = document.querySelector('input[name="conf_dtmf"]'); if (dt) col.querySelector('.dtmf').appendChild(dt);  // Vici's own DTMF box
      col.addEventListener('click', (e) => {
        const b = e.target.closest('[data-b],[data-l]'); if (!b || b.classList.contains('dis')) return;
        e.preventDefault();
        if (b.dataset.b === 'pause') clickVici(byId('DiaLControl') && byId('DiaLControl').querySelector('a'));
        else if (b.dataset.b) { const v = viciBtn(byId(b.dataset.b)); clickVici(v && v.a); }
        else clickVici(linkFor(b.dataset.l));
        setTimeout(modernButtons, 150);
      });
    }
    // pause / resume (Vici swaps this picture as your status changes)
    const pz = col.querySelector('[data-b="pause"]'), pv = viciBtn(byId('DiaLControl'));
    if (pz && pv) {
      const st = /paused/i.test(pv.src) ? ['paused', BI.play, 'YOU ARE PAUSED', 'Click to take calls']
        : /active/i.test(pv.src) ? ['active', BI.pause, 'YOU ARE ACTIVE', 'Click to pause']
        : pv.on ? ['other', BI.play, btnLabel(pv.alt), '']
        : ['neutral dis', BI.pause, 'ON A CALL', 'Pause after this call'];
      const key = st.join('|');
      if (pz.dataset.k !== key) { pz.dataset.k = key; pz.className = 'mb pz ' + st[0]; pz.innerHTML = `${st[1]}<div>${st[2]}${st[3] ? `<small>${st[3]}</small>` : ''}</div>`; }
    }
    col.querySelectorAll('[data-b]:not([data-b="pause"])').forEach((b) => {
      const v = viciBtn(byId(b.dataset.b)); if (!v) return;
      b.classList.toggle('dis', !v.on);
      if (b.dataset.b !== 'SendDTMF' && v.alt) b.querySelector('span').textContent = btnLabel(v.alt);
    });
    // links: Manual dial, Lead search, Callbacks (with the count Vici shows)
    col.querySelectorAll('[data-l]').forEach((l) => l.classList.toggle('dis', !linkFor(l.dataset.l)));
    const cba = linkFor('cb'), n = cba ? (cba.textContent.match(/\d+/) || ['0'])[0] : '0';
    const badge = col.querySelector('[data-l="cb"] b'); badge.textContent = n; badge.classList.toggle('hot', n !== '0');
  }
  function linkFor(k) {
    if (k === 'manual') return byId('MDstatusSpan') && byId('MDstatusSpan').querySelector('a');
    if (k === 'cb') return byId('CBstatusSpan') && byId('CBstatusSpan').querySelector('a');
    const ls = byId('vl-leadsearch'); return ls && ls.querySelector('a');
  }

  // ---------- Vici's full-page messages (another session took over, admin kicked you out, logout,
  // system disabled...) fill the whole window, and everything we added steps out of the way ----------
  function takeover() {
    let full = null, top = -1;   // the one on top, if several are open
    document.querySelectorAll('body > span[id], #vicidial_form > span[id]').forEach((el) => {
      if (/^vl-|^vprop/.test(el.id)) return;
      const cs = getComputedStyle(el), z = parseInt(cs.zIndex, 10) || 0;
      if (cs.visibility !== 'visible' || cs.display === 'none' || z < 40 || z <= top) return;
      const t = el.querySelector('table'); if (!t) return;
      const w = parseInt(t.getAttribute('width'), 10) || 0, h = parseInt(t.getAttribute('height'), 10) || 0;
      if (w >= 1500 && h >= 600 && (el.textContent || '').trim()) { full = el; top = z; }
    });
    document.querySelectorAll('.vl-full').forEach((el) => { if (el !== full) el.classList.remove('vl-full'); });
    if (full) full.classList.add('vl-full');
    document.documentElement.classList.toggle('vl-takeover', !!full);
  }

  // React the instant Vici shows/hides one of those messages (Vici flips the box's style), instead of
  // waiting for the once-a-second check, so nothing of ours flashes on top of it.
  let tkObs = null, tkQueued = false;
  function watchTakeover() {
    if (tkObs) return;
    tkObs = new MutationObserver((recs) => {
      // only Vici's own boxes matter (our pieces restyle themselves all the time)
      if (!recs.some((r) => !/^(vl-|vprop)/.test(r.target.id || '') && !(r.target.closest && r.target.closest('[id^="vl-"],[id^="vprop"]')))) return;
      if (tkQueued) return; tkQueued = true;
      queueMicrotask(() => { tkQueued = false; try { takeover(); scriptCover(); xferCard(); } catch (e) {} });
    });
    tkObs.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });
  }

  // SCRIPT / SCRIPT 2 just opened: hide the card and pitch sheet right away (they come back on the next check)
  function scriptCover() {
    const up = ['ScriptPanel', 'Script2Panel'].some((id) => { const e = byId(id); return e && getComputedStyle(e).visibility === 'visible'; });
    if (!up) return;
    ['vprop-card', 'vl-pitch'].forEach((id) => { const e = byId(id); if (e) e.style.display = 'none'; });
  }


  // ---------- Transfer - Conference as a modern card. Vici's real controls are moved in (same ids, still in
  // Vici's form) or mirrored (same available/greyed state; a click goes to Vici's own button). ----------
  const XB = [
    ['LocalCloser', 'LOCAL CLOSER', 'sec', 'g1'],
    ['DialBlindTransfer', 'BLIND TRANSFER', 'pri', 'g2', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h14l-4-4M18 12l-4 4"/></svg>'],
    ['DialWithCustomer', 'DIAL WITH CUSTOMER', 'sec', 'g2', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/></svg>'],
    ['ParkCustomerDial', 'PARK CUSTOMER DIAL', 'neu', 'g2'], ['PresetPullDown', 'PRESETS', 'neu', 'g2'], ['DialBlindVMail', 'VOICEMAIL', 'neu', 'g2'],
    ['Leave3WayCall', 'LEAVE 3-WAY CALL', 'amb', 'g3'], ['ParkXferLine', 'PARK TRANSFER LINE', 'neu', 'g3'],
    ['HangupXferLine', 'HANG UP TRANSFER LINE', 'redo', 'g3'], ['HangupBothLines', 'HANG UP BOTH LINES', 'red', 'g3']];
  function xferCard() {
    const tm = byId('TransferMain'); if (!tm) return;
    const x = box('vl-xfer', L.card[0], L.pitch[1] + L.pitch[3] + 12, 'z-index:46');
    if (!x.childElementCount) {
      x.innerHTML = `<h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>TRANSFER · CONFERENCE
          <span class="meta">Seconds on transfer line <span data-m="xferlength"></span> · Channel <span data-m="xferchannel"></span></span></h3>
        <div class="row">
          <div class="grp" style="flex:1.2"><span class="lbl">Send the call to a group</span><div class="line g1"><span class="grpslot" data-m="XfeRGrouPLisT"></span></div>
            <span class="lbl" style="margin-top:4px">Or dial a number</span>
            <div class="line"><span data-m="xfernumber"></span><span class="agents" data-m="agentdirectlink"></span>
              <label class="chk"><span data-m="consultativexfer"></span>Consultative</label><label class="chk"><span data-m="xferoverride"></span>Dial override</label></div></div>
          <div class="div"></div>
          <div class="grp" style="flex:1"><span class="lbl">Start the transfer</span><div class="line g2"></div></div>
          <div class="div"></div>
          <div class="grp" style="flex:.75"><span class="lbl">Once connected</span><div class="line g3"></div></div>
        </div>`;
      x.querySelectorAll('[data-m]').forEach((slot) => move(byId(slot.dataset.m), slot));   // Vici's own boxes, links and checkboxes
      XB.forEach(([id, label, cls, g, ic]) => x.querySelector('.' + g).insertAdjacentHTML('beforeend', `<span class="b ${cls}" data-x="${id}">${ic || ''}${label}</span>`));
      x.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (!b || b.classList.contains('dis')) return; e.preventDefault();
        const v = viciBtn(byId(b.dataset.x)); clickVici(v && v.a); setTimeout(xferCard, 150); });
    }
    // open/closed exactly when Vici opens/closes its panel
    x.classList.toggle('open', tm.style.visibility === 'visible' && !document.documentElement.classList.contains('vl-takeover'));
    x.querySelectorAll('[data-x]').forEach((b) => {
      const el = byId(b.dataset.x), v = viciBtn(el);
      b.classList.toggle('gone', !el || (el.style && el.style.visibility === 'hidden'));   // e.g. Park Transfer Line when Vici hides it
      b.classList.toggle('dis', !v || !v.on);
    });
  }

  // ---------- Live-call light as a badge (Vici's own picture stays, hidden; it tells us the state) ----------
  function liveBadge() {
    const img = document.querySelector('img[name="livecall"]'), wrap = byId('vl-live');
    if (!img || !wrap) return;
    img.style.visibility = 'hidden'; img.style.position = 'absolute';
    let b = byId('vl-livebadge');
    if (!b) { b = document.createElement('span'); b.id = 'vl-livebadge'; b.innerHTML = '<i></i><span></span>'; wrap.appendChild(b); }
    const src = img.getAttribute('src') || '';
    const st = /_ON\./i.test(src) ? ['on', 'LIVE CALL'] : /DEAD/i.test(src) ? ['dead', 'CALL HUNG UP'] : ['off', 'NO LIVE CALL'];
    if (b.className !== st[0]) { b.className = st[0]; b.querySelector('span').textContent = st[1]; }
  }

  // ---------- HOT KEYS on/off switch (drives Vici's own hot keys) ----------
  const hkOn = () => { const i = byId('hotkeysdisplay') && byId('hotkeysdisplay').querySelector('img'); return !!i && /ACTIVE/i.test(i.alt || '') && !/INACTIVE/i.test(i.alt || ''); };
  const hkSet = (on) => {
    const a = byId('hotkeysdisplay') && byId('hotkeysdisplay').querySelector('a');
    if (a && on !== hkOn()) a.dispatchEvent(new MouseEvent(on ? 'mouseover' : 'mouseout', { bubbles: true }));
  };
  const hkWanted = () => !!GM_getValue('vpHotKeysOn', false);
  function hotKeysSwitch() {
    if (!byId('hotkeysdisplay')) return;
    const wrap = box('vl-hkwrap', ...L.hotkeys);
    if (!byId('vl-hk')) {
      wrap.innerHTML = '<button type="button" id="vl-hk" title="Click to turn Hot Keys on or off. Your choice is remembered on this PC, even after logging out."><i></i><span>HOT KEYS: OFF</span></button><div id="vl-hklist"></div>';
      byId('vl-hk').addEventListener('click', (e) => { e.preventDefault(); const want = !hkWanted(); GM_setValue('vpHotKeysOn', want); hkSet(want); hotKeysSwitch(); });
    }
    // The agent's choice sticks (saved on this PC). Vici turns Hot Keys off at every hang up and only
    // allows them on a live call, so this switches them back on by itself as each call comes in.
    const want = hkWanted();
    const img = document.querySelector('img[name="livecall"]'), live = !!img && /_ON\./i.test(img.getAttribute('src') || '');
    if (!want && hkOn()) hkSet(false);
    else if (want && live && !hkOn()) hkSet(true);
    const on = want;
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
    if (!LAYOUT_ON || !(hkOn() || hkWanted())) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t.type !== 'button') e.stopImmediatePropagation();
  }, true);


  // ---------- Pitch sheet (Mortgageusa's paper pitch sheet, filled in from the lead + property sites) ----------
  // Blue fields were filled in automatically; once the LO types in one it turns white and is never overwritten.
  // Nothing is saved: the sheet clears when the next call (lead) comes up.
  const PS_PICK1 = ['vet', 'married', 'inc', 'cmarried', 'cinc', 'occ', 'rtype', 'escrow', 'ptype', 'pitch'];   // pick-one groups
  function pitchHTML() {
    const F = (k, label, cls = '', extra = '') => `<div class="fl ${cls}"><label>${label}</label><input class="in" data-k="${k}"${extra}></div>`;
    const T = (k, label, rows = 2, cls = '') => `<div class="fl ${cls}"><label>${label}</label><textarea class="in grow" data-k="${k}" rows="${rows}"></textarea></div>`;
    const C = (g, label, list, cls = '', y = false) => `<div class="fl ${cls}"><label>${label}</label><div class="ch" data-g="${g}">${list.map((x) => `<button type="button" class="${y ? 't' : 'p'}">${x}</button>`).join('')}</div></div>`;
    const SEC = (n, title, body, aside = '', cls = '') => `<div class="sec ${cls}"><h3><span class="n">${n}</span>${title}${aside}</h3>${body}</div>`;
    const G = (cols, inner) => `<div class="g c${cols}">${inner}</div>`, SUB = (x) => `<div class="sub">${x}</div>`;
    const job = (p) => SUB('EMPLOYMENT &amp; INCOME') + G(3, F(p + 'emp', 'Employer') + F(p + 'title1', 'Position / title') + F(p + 'yrs', 'Years') +
        F(p + 'income', 'Income') + C(p + 'inc', 'Paid on', ['W-2', '1099'], '', true) + F(p + 'prev', 'Previous employer')) +
      SUB('OTHER INCOME') + G(4, F(p + 'ssi', 'SSI') + F(p + 'pension', 'Pension') + F(p + 'dis', 'Disability') + F(p + 'ira', 'IRA') + F(p + 'addl', 'Additional income', 's4'));
    return `<div class="bar"><b>Pitch sheet<span data-k="title"></span></b><button type="button" data-a="pdf">Save as PDF</button><button type="button" class="go" data-a="send" title="Coming next: tell Claude how sheets get to the team lead">Send to Team Lead</button></div>
      <div class="page">
      ${SEC(1, 'GOALS &amp; NOTES', `<div class="g">${T('goals', 'What does the borrower want?')}${T('notes', 'Notes')}</div>`)}
      ${SEC(2, 'BORROWER', G(3, F('borrower', 'Full name', 's2') + F('dob', 'Date of birth') + F('credit', 'Credit score') +
          F('ssn', 'SSN <span class="lock">· same as Vici\'s SSN box</span>', '', ' type="password" autocomplete="off"') + F('email', 'Email') +
          F('phone', 'Home phone') + F('cell', 'Cell') + F('work', 'Work') +
          C('married', 'Married?', ['Yes', 'No'], '', true) + '<div class="prompt s2">Ask: "Are you and your spouse on the same page?"</div>' +
          C('vet', 'Veteran?', ['Yes', 'No'], '', true) + F('disab', '% disability')) +
        SUB('PRESENT ADDRESS') + G(4, F('addr', 'Street', 's4') + F('city', 'City', 's2') + F('state', 'State') + F('zip', 'ZIP') + F('county', 'County', 's2')) +
        job(''))}
      ${SEC(3, 'CO-BORROWER', `<div class="cob-off">Opens the same name, credit, employment and income fields when there is one.</div>
          <div class="cob" hidden>${G(3, F('cob', 'Full name', 's2') + F('cdob', 'Date of birth') + F('ccredit', 'Credit score') + C('cmarried', 'Married?', ['Yes', 'No'], '', true)) +
          SUB('EMPLOYER ADDRESS') + G(1, F('cempaddr', 'Street, city, state')) + job('c')}</div>`, '<button type="button" class="aside" data-a="cob">+ Add co-borrower</button>')}
      ${SEC(4, 'PROPERTY', G(3, C('occ', 'Occupancy', ['Primary', 'Second home', 'Investment'], 's3') +
          C('ptype', 'Property type', ['Condo', 'SFR', 'Townhouse', 'Manufactured', 'Mobile', '2-4 Unit'], 's3') +
          F('pyear', 'Purchase year') + F('pprice', 'Purchase price') + F('refi', 'Last refi') +
          `<div class="fl"><label>Client value</label><input class="in" data-k="value"><div class="hint" data-k="estnote"></div></div>`))}
      ${SEC(5, 'CURRENT MORTGAGE', G(3, F('holder', '1st mortgage holder', 's2') + F('balance', 'Balance') + F('rate', 'Rate') + F('term', 'Term') + F('payment', 'Payment') +
          `<div class="fl s3"><label>Loan</label><div class="ch2"><span class="ch" data-g="rtype">${['Fixed', 'Adjustable', 'Interest only'].map((x) => `<button type="button" class="p">${x}</button>`).join('')}</span>
            <span class="ch" data-g="prog">${['FHA', 'Conv', 'VA', 'Fannie', 'Freddie'].map((x) => `<button type="button" class="p">${x}</button>`).join('')}</span></div></div>` +
          C('escrow', 'Escrowed?', ['Yes', 'No'], '', true) + F('taxes', 'Taxes') + F('ins', 'Insurance') + F('pmi', 'PMI') + F('hoa', 'HOA')))}
      ${SEC(6, 'ASSETS', G(3, F('checking', 'Checking / savings') + F('retire', 'Retirement') + F('broker', 'Brokerage')))}
      ${SEC(7, 'OTHER OFFER RECEIVED', `<textarea class="in grow" data-k="offer" rows="2"></textarea>`)}
      ${SEC(8, 'PITCH', `<div class="ch" data-g="pitch" style="margin-bottom:6px">${['CONV', 'FHA', 'VA'].map((x) => `<button type="button" class="p">${x}</button>`).join('')}</div>
          <textarea class="in grow" data-k="pitch" rows="3" placeholder="Program, rate, payment, cash out, savings…"></textarea>`, '', 'pitchsec')}
      </div>`;
  }
  const PS_CSS = `
    #vl-pitch{background:#f4f6f9;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;font:12px "Segoe UI",Arial,sans-serif;color:#1d2530}
    #vl-pitch *{box-sizing:border-box}
    #vl-pitch .bar{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#fff;border-bottom:1px solid #dde2e8}
    #vl-pitch .bar b{font-size:14px;flex:1}#vl-pitch .bar b span{font-weight:400;color:#5b6675}
    #vl-pitch .bar button{font:600 12px "Segoe UI",Arial;border:1px solid #c4ccd6;background:#fff;color:#1d2530;border-radius:6px;padding:6px 11px;cursor:pointer}
    #vl-pitch .bar button.go{background:#2563eb;border-color:#2563eb;color:#fff;opacity:.6}
    #vl-pitch .page{flex:1;overflow:auto;overscroll-behavior:contain;padding:10px 12px 20px;display:flex;flex-direction:column;gap:10px}
    #vl-pitch .sec{background:#fff;border:1px solid #dde2e8;border-radius:9px;padding:9px 12px 11px}
    #vl-pitch .sec.pitchsec{border-color:#2563eb}#vl-pitch .sec.pitchsec .n{background:#2563eb}
    #vl-pitch h3{margin:0 0 7px;font:700 11px "Segoe UI",Arial;letter-spacing:.06em;color:#4a5563;display:flex;align-items:center;gap:8px}
    #vl-pitch h3 .n{width:18px;height:18px;border-radius:50%;background:#1f2f4d;color:#fff;font-size:10px;display:inline-flex;align-items:center;justify-content:center;letter-spacing:0}
    #vl-pitch h3 .aside{margin-left:auto;font:600 11.5px "Segoe UI",Arial;letter-spacing:0;color:#2563eb;background:none;border:0;cursor:pointer;padding:0}
    #vl-pitch .g{display:grid;gap:7px 10px}#vl-pitch .c1{grid-template-columns:1fr}#vl-pitch .c2{grid-template-columns:1fr 1fr}
    #vl-pitch .c3{grid-template-columns:1fr 1fr 1fr}#vl-pitch .c4{grid-template-columns:1fr 1fr 1fr 1fr}
    #vl-pitch .s2{grid-column:span 2}#vl-pitch .s3{grid-column:span 3}#vl-pitch .s4{grid-column:1/-1}
    #vl-pitch .fl{display:flex;flex-direction:column;gap:2px;min-width:0}
    #vl-pitch .fl label{font-size:10.5px;color:#5b6675;font-weight:600}
    #vl-pitch .in{height:24px;border:1px solid #cdd4dd;border-radius:5px;padding:2px 7px;font:12px "Segoe UI",Arial;background:#fff;color:#1d2530;width:100%;margin:0}
    #vl-pitch .in.auto{background:#e8f0ff;border-color:#9db8e8}
    #vl-pitch .in:focus{outline:2px solid #2563eb;outline-offset:0;border-color:#2563eb;background:#fff}
    #vl-pitch textarea.in{height:auto;min-height:40px;resize:none;overflow:hidden;line-height:16px}
    #vl-pitch .ch,#vl-pitch .ch2{display:flex;gap:5px;flex-wrap:wrap;align-items:center}#vl-pitch .ch2{gap:12px}
    #vl-pitch .t,#vl-pitch .p{font:11.5px "Segoe UI",Arial;border:1px solid #c4ccd6;border-radius:12px;padding:2px 9px;background:#fff;color:#1d2530;cursor:pointer;margin:0}
    #vl-pitch .t.on,#vl-pitch .p.on{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600}
    #vl-pitch .p.on.auto{background:#4a77c8;border-color:#4a77c8}
    #vl-pitch .prompt{font-size:11.5px;color:#7a4b00;background:#fff4dd;border:1px solid #f0d39a;border-radius:6px;padding:4px 8px;align-self:end}
    #vl-pitch .hint{font-size:10.5px;color:#2563eb;margin-top:1px}
    #vl-pitch .sub{font:700 10.5px "Segoe UI",Arial;color:#4a5563;letter-spacing:.05em;margin:9px 0 5px;border-top:1px dashed #dde2e8;padding-top:7px}
    #vl-pitch .cob-off{color:#5b6675}
    #vl-pitch .lock{font-weight:400;color:#5b6675}`;

  let psLead = null;
  const typeToPill = (t) => { t = String(t || '').toLowerCase();
    return /condo/.test(t) ? 'Condo' : /town/.test(t) ? 'Townhouse' : /manufactured/.test(t) ? 'Manufactured' : /mobile/.test(t) ? 'Mobile'
      : /multi|duplex|triplex|fourplex|2-4|2 to 4/.test(t) ? '2-4 Unit' : /single|sfr|house/.test(t) ? 'SFR' : ''; };
  function pitchSheet() {
    const [x, y, w, h] = L.pitch;
    const ps = box('vl-pitch', x, y, `width:${w}px;height:${h}px;z-index:7`);
    if (!ps.childElementCount) {
      { const st = byId('vl-pitch-style') || document.createElement('style'); st.id = 'vl-pitch-style'; st.textContent = PS_CSS; document.head.appendChild(st); }
      ps.innerHTML = pitchHTML();
      ps.querySelectorAll('input:not([type=password]),textarea').forEach((i) => i.setAttribute('autocomplete', 'pitch-' + (i.dataset.k || 'x')));
      ps.addEventListener('input', (e) => { const f = e.target.closest('[data-k]'); if (!f) return; f.dataset.touched = '1'; f.classList.remove('auto');
        if (f.classList.contains('grow')) { f.style.height = 'auto'; f.style.height = f.scrollHeight + 2 + 'px'; }
        if (f.dataset.k === 'ssn' && byId('alt_phone')) byId('alt_phone').value = f.value; });
      ps.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]');
        if (a) { e.preventDefault();
          if (a.dataset.a === 'pdf') pitchPDF();
          else if (a.dataset.a === 'cob') { const cb = ps.querySelector('.cob'), open = cb.hidden; cb.hidden = !open; ps.querySelector('.cob-off').hidden = open; a.textContent = open ? '− Remove co-borrower' : '+ Add co-borrower'; }
          else a.title = 'Coming next: tell Claude how sheets get to the team lead';
          return; }
        const b = e.target.closest('.t,.p'); if (!b) return;
        e.preventDefault();
        const g = b.parentElement; g.dataset.touched = '1';
        if (PS_PICK1.includes(g.dataset.g) || b.classList.contains('t')) [...g.children].forEach((o) => { if (o !== b) o.classList.remove('on'); });
        b.classList.toggle('on'); g.querySelectorAll('.auto').forEach((o) => o.classList.remove('auto'));
      });
    }
    // hidden whenever a property tab or Vici's SCRIPT panels are up
    const sp = byId('ScriptPanel'), sp2 = byId('Script2Panel');
    const covered = openKey || [sp, sp2].some((e) => e && getComputedStyle(e).visibility === 'visible');
    ps.style.display = covered ? 'none' : 'flex';

    // new call: start a clean sheet
    const lead = byId('lead_id') ? byId('lead_id').value : '';
    if (lead !== psLead) {
      psLead = lead;
      ps.querySelectorAll('[data-k]').forEach((f) => { if ('value' in f) f.value = ''; else f.textContent = ''; delete f.dataset.touched; f.classList.remove('auto'); if (f.classList.contains('grow')) f.style.height = ''; });
      ps.querySelectorAll('[data-g]').forEach((g) => { delete g.dataset.touched; g.querySelectorAll('.on,.auto').forEach((o) => o.classList.remove('on', 'auto')); });
      ps.querySelector('.page').scrollTop = 0;
      const cb = ps.querySelector('.cob'); if (cb) { cb.hidden = true; ps.querySelector('.cob-off').hidden = false; ps.querySelector('[data-a="cob"]').textContent = '+ Add co-borrower'; }
    }
    // fill in what we know (never over the LO's own typing)
    const val = (id) => (byId(id) ? String(byId(id).value || '').trim() : '');
    const set = (k, v) => { const f = ps.querySelector(`[data-k="${k}"]`); if (!f || f.dataset.touched || !v) return;
      if ('value' in f && f.tagName !== 'SPAN') { if (f.value !== v) { f.value = v; f.classList.add('auto'); } } else f.textContent = v; };
    const pick = (g, label) => { const grp = ps.querySelector(`[data-g="${g}"]`); if (!grp || grp.dataset.touched || !label) return;
      grp.querySelectorAll('.p').forEach((b) => { const on = b.textContent.toLowerCase() === label.toLowerCase(); b.classList.toggle('on', on); b.classList.toggle('auto', on); }); };
    const name = [val('first_name'), val('last_name')].filter(Boolean).join(' ');
    set('borrower', name); ps.querySelector('[data-k="title"]').textContent = name ? ' · ' + name : '';
    const ph = val('phone_number').replace(/\D/g, '');
    set('phone', ph.length === 10 ? `${ph.slice(0, 3)}-${ph.slice(3, 6)}-${ph.slice(6)}` : ph);
    set('addr', val('address1')); set('city', val('city')); set('state', val('state')); set('zip', val('postal_code').slice(0, 5));
    set('credit', val('title')); set('rate', val('security_phrase')); set('value', val('province'));
    const ssnF = ps.querySelector('[data-k="ssn"]'); if (ssnF && !ssnF.dataset.touched && val('alt_phone')) ssnF.value = val('alt_phone');
    const lt = val('vendor_lead_code').toLowerCase();
    pick('prog', /fha/.test(lt) ? 'FHA' : /\bva\b/.test(lt) ? 'VA' : /conv/.test(lt) ? 'Conv' : /fannie/.test(lt) ? 'Fannie' : /freddie/.test(lt) ? 'Freddie' : '');
    // property sites (whichever have loaded)
    const a = getAddress(), c = a.missing.length ? null : cache[a.full];
    if (c) {
      const ms = CARD_ORDER.map((k) => siteState(c, k)).filter((st) => st.state === 'ok' && st.model).map((st) => st.model);
      const first = (f) => { for (const m of ms) if (m[f] !== undefined && m[f] !== null && m[f] !== '' && m[f] !== '—') return m[f]; return null; };
      set('county', String(first('county') || '').replace(/\s*county$/i, ''));
      let sd = null, sp0 = null, sT = -Infinity;   // latest sale any site knows about
      ms.forEach((m) => [{ date: m.soldDate, price: m.soldPrice }].concat((m.priceHistory || []).filter((e) => /sold/i.test(e.event || ''))).forEach((e) => {
        const t = Date.parse(String(e.date || '').slice(0, 10)); if (!isNaN(t) && t > sT) { sT = t; sd = e.date; sp0 = isNum(e.price) ? e.price : null; } }));
      if (sd) set('pyear', String(new Date(sT).getUTCFullYear()));
      if (isNum(sp0)) set('pprice', money(sp0));
      pick('ptype', typeToPill(first('type')));
      const taxes = ms.map((m) => (m.taxHistory || []).filter((t) => isNum(t.tax)).sort((p, q) => (+q.year) - (+p.year))[0]).find(Boolean);
      if (taxes) set('taxes', money(taxes.tax) + '/yr');
      const hoa = first('hoa'); if (hoa) set('hoa', String(hoa));
      const z = ms[0]; const note = ps.querySelector('[data-k="estnote"]');
      if (note && z && isNum(z.estimate)) note.textContent = 'Zillow est. ' + money(z.estimate);
    }
  }
  // one-page printable copy; Edge's print window has "Save as PDF"
  function pitchPDF() {
    const ps = byId('vl-pitch'); if (!ps) return;
    const clone = ps.querySelector('.page').cloneNode(true);
    clone.querySelectorAll('input').forEach((i) => {
      const v = i.dataset.k === 'ssn' ? (i.value ? '***-**-' + i.value.replace(/\D/g, '').slice(-4) : '') : i.value;
      const s = document.createElement('div'); s.className = i.className.replace('auto', ''); s.textContent = v; i.replaceWith(s); });
    clone.querySelectorAll('textarea').forEach((t) => { const d = document.createElement('div'); d.className = 'in'; d.textContent = t.value; t.replaceWith(d); });
    const win = window.open('', '_blank', 'width=820,height=1000');
    if (!win) { alert('Allow pop-ups for Vici to save the pitch sheet as a PDF.'); return; }
    win.document.write(`<!DOCTYPE html><title>Pitch sheet</title><style>${PS_CSS.replace(/#vl-pitch /g, '')}
      body{margin:0;font:12px "Segoe UI",Arial,sans-serif;color:#111}.page{display:flex;flex-direction:column;gap:8px}
      .in{display:block;height:auto;min-height:22px;white-space:pre-wrap}.in.auto{background:#fff;border-color:#cdd4dd}
      .t,.p{border:1px solid #888}.t.on,.p.on{background:#111!important;color:#fff;border-color:#111}
      .sec{break-inside:avoid}.aside,.cob-off,.cob[hidden]{display:none}
      @page{size:letter;margin:.45in}@media print{.row{margin:5px 0}}</style><div class="page">${clone.innerHTML}</div>`);
    win.document.close();
    setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 300);
  }

  // ---------- no page scrollbars when everything fits ----------
  function scrollLock() {
    const parts = ['MainTable', 'vl-form', 'vl-groups', 'vl-hkwrap', 'vl-pitch', 'vprop-card', 'AgentViewSpan', 'webphoneSpan']
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
    if (!ok.length && (c.retrying || CARD_ORDER.some((k) => st(k).state === 'offline')))
      return head() + `<div class="${c.retrying ? 'vc-wait' : 'vc-msg'}">${c.retrying ? '<span class="vc-spin"></span>' : ''}The property sites didn't answer just now. ${c.retrying ? 'Trying again…' : c.retryTimer ? 'Trying again by itself in a few seconds.' : 'Open a property tab and click <b>Try again</b>.'}</div>`;
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
    const scriptUp = ['ScriptPanel', 'Script2Panel'].some((id) => { const e = byId(id); return e && getComputedStyle(e).visibility === 'visible'; });
    const why = !anchor ? 'no Call Notes box' : a.missing.length ? 'lead missing ' + a.missing.join(', ') : openKey ? 'a property tab is open' : scriptUp ? 'a SCRIPT panel is open' : '';
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __main); else __main();
})();
