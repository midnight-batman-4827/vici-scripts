// ==UserScript==
// @name         Vici Property Lookup
// @namespace    mortgageusa.vici
// @version      9.4
// @description  ZILLOW / REALTOR / HOMES.COM / TRULIA tabs (next to SCRIPT 2) with each site's facts about the home
// @match        *://mtgusa.talkitpro.com/agc/*
// @grant        GM_xmlhttpRequest
// @connect      www.zillowstatic.com
// @connect      parser-external.geo.moveaws.com
// @connect      www.zillow.com
// @connect      www.trulia.com
// @run-at       document-idle
// @homepageURL  https://github.com/midnight-batman-4827/vici-scripts
// @updateURL    https://raw.githubusercontent.com/midnight-batman-4827/vici-scripts/main/vici-property-lookup.user.js
// @downloadURL  https://raw.githubusercontent.com/midnight-batman-4827/vici-scripts/main/vici-property-lookup.user.js
// ==/UserScript==

(function () {
  'use strict';

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

  // Zillow's own autocomplete -> zpid (Trulia uses the same id)
  async function lookupZillow(a) {
    const j = await getJSON('https://www.zillowstatic.com/autocomplete/v3/suggestions?q=' + encodeURIComponent(a.full));
    const hit = ((j && j.results) || []).find((r) => r.metaData && r.metaData.zpid &&
      sameProperty(a, `${r.metaData.streetNumber} ${r.metaData.streetName}`, r.metaData.city, r.metaData.state, r.metaData.zipCode));
    if (!hit) return null;
    const m = hit.metaData;
    return { zpid: m.zpid, line: `${m.streetNumber} ${m.streetName}`, city: m.city, state: m.state, zip: m.zipCode };
  }

  // Realtor.com's own autocomplete -> property id
  async function lookupRealtor(a) {
    const j = await getJSON('https://parser-external.geo.moveaws.com/suggest?client_id=rdc-home&limit=5&area_types=address&input=' +
      encodeURIComponent(a.full));
    const hit = ((j && j.autocomplete) || []).find((r) => r.mpr_id && sameProperty(a, r.line, r.city, r.state_code, r.postal_code));
    if (!hit) return null;
    return { id: String(hit.mpr_id), line: hit.line, city: hit.city, state: hit.state_code, zip: hit.postal_code };
  }

  const cache = {}; // full address -> { zillow, realtor, done, info }
  function lookup(a) {
    if (cache[a.full]) return cache[a.full];
    const c = cache[a.full] = { done: false, sites: {} };
    c.promise = Promise.all([lookupZillow(a), lookupRealtor(a)]).then(([z, r]) => {
      c.zillow = z; c.realtor = r; c.done = true;
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
      url: (a, c) => google('homes.com', c.zillow ? { street: c.zillow.line, city: c.zillow.city, state: c.zillow.state, zip: c.zillow.zip } : a),
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

  function findProperty(data, zpid) {
    let best = null;
    walkAll(data, (o) => {
      if (best) return false;
      if (!Array.isArray(o) && String(o.zpid) === String(zpid) &&
        ('homeStatus' in o || 'bedrooms' in o || 'livingArea' in o)) { best = o; return false; }
    });
    return best;
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
    const photos = (o.photos || []).map((ph) => ph && ph.href ? { full: ph.href.replace(/s\.jpg$/, 'od-w1024_h768.jpg'), thumb: ph.href, caption: '' } : null).filter(Boolean);
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

    if (key === 'homes') return done({ state: 'nosource' });
    if ((key === 'zillow' || key === 'trulia') && !c.zillow) return done({ state: 'nomatch' });
    if (key === 'realtor' && !c.realtor) return done({ state: 'nomatch' });

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
    done({ state: 'ok', model, raw: data });
  }

  function loadDetails(a, c) {
    ['zillow', 'trulia', 'realtor', 'homes'].forEach((k) => loadSite(a, c, k));
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
    .vprop-tab .vp-fav{vertical-align:middle;margin-right:4px;border-radius:4px;position:relative;top:-1px}
    .vp-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    .vprop-tab{position:relative}
    .vp-brand{display:inline-flex;align-items:center;gap:8px}
    .vp-brand .vp-fav{border-radius:4px}
    .vprop-tab{display:inline-block;cursor:pointer;user-select:none;font:bold 14px Arial,sans-serif;background:#e4e4e4;
      padding:0 8px;box-sizing:border-box;border-radius:2px}
    .vprop-tab:hover{background:#d4d4d4}
    .vprop-tab .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:5px;vertical-align:middle;background:#9aa4b2}
    .vprop-tab.ready .dot{background:#1aa33c}
    .vprop-tab.fail .dot{background:#d08a00}
    .vprop-tab.active{background:currentColor}
    .vprop-tab.active span.lbl{color:#fff}

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
    .vp-hl.wide{grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px 18px}
    .vp-sec{margin:16px 0 10px;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;border-top:1px solid var(--border);padding-top:14px}
    .vp-card h3 + .vp-sec{border-top:0;padding-top:0;margin-top:4px}
    .vp-ctabs{display:flex;gap:4px;margin:-4px 0 10px;border-bottom:1px solid var(--border)}
    .vp-ctabs button{border:0;background:none;padding:7px 12px;font:600 13px var(--font);color:var(--muted);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-1px}
    .vp-ctabs button.on{color:var(--accent);border-bottom-color:var(--accent)}
    .vp-hist{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px;border-top:1px solid var(--border);margin-top:16px}
    .vp-hist .vp-sec{border-top:0;padding-top:0;margin-top:14px}
    .vp-scroll{max-height:250px;overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--border);border-radius:var(--radius)}
    table.vp-t2{width:100%;border-collapse:collapse;font-size:13px}
    table.vp-t2 th{position:sticky;top:0;background:var(--card);text-align:left;font-size:12px;font-weight:700;color:var(--ink);padding:8px 12px;border-bottom:1px solid var(--border)}
    table.vp-t2 td{padding:7px 12px;border-bottom:1px solid var(--border);vertical-align:top}
    table.vp-t2 tr:last-child td{border-bottom:0}
    .vp-pct{font-size:11px;font-weight:600;margin-left:2px}
    .vp-sub{font-size:11px;color:var(--muted);margin-top:2px}
    .vp-count{font-size:13px;font-weight:600;color:var(--muted);margin-left:8px}
    .vp-gal{width:fit-content;max-width:100%}
    .vp-stage{position:relative;display:block;width:fit-content;max-width:100%;border-radius:var(--radius);overflow:hidden}
    .vp-stage img{display:block;max-width:100%;max-height:520px;width:auto;height:auto}
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
      case 'idle': case 'loading': return msg('Looking up the property…');
      case 'ok': return body(modelHTML(a, st.model, key));
      case 'shared':
        return z.state === 'ok' ? body(`<div class="vp-note">Trulia uses the same property records as Zillow.</div>` + modelHTML(a, z.model, key))
          : msg('Couldn\'t read this home\'s details from Trulia right now.');
      case 'nosource': return fallback('the site doesn\'t allow it');
      case 'blocked':
        if (key === 'realtor' || key === 'homes') return fallback('it blocks background lookups');
        return msg(`${esc(s.label)} asked for a bot check. Click <b>Open on ${esc(s.label)}</b>, complete the check once, and the next lead will fill in.`);
      case 'nomatch':
        if (key === 'realtor') return fallback('no exact address match');
        return msg(`${esc(s.label)} has no exact match for this address. Check the spelling, city and ZIP.`);
      default:
        if (key === 'realtor' || key === 'homes') return fallback('the page couldn\'t be read');
        return msg(`Couldn't read this home's details from ${esc(s.label)} right now.`);
    }
  }

  // Zillow and Trulia share the same photo files; Zillow hides old listing photos on off-market homes,
  // so when one site only has Street View, use the other site's full set.
  function photosFor(m) {
    const own = (m && m.photos) || [];
    const real = (x) => x && x.length && !x.every((p) => /streetview/i.test(p.full));
    if (real(own)) return { list: own, street: false };
    const a = getAddress(), c = cache[a.full];
    for (const k of ['trulia', 'zillow']) {
      const o = c && siteState(c, k).model;
      if (o && real(o.photos)) return { list: o.photos, street: false };
    }
    return { list: own, street: own.length > 0 };
  }
  let galleryPhotos = [];
  function otherCounty() {
    const a = getAddress(), c = cache[a.full];
    for (const k of ['zillow', 'trulia']) { const o = c && siteState(c, k).model; if (o && o.county) return o.county; }
    return '';
  }

  function modelHTML(a, m, key) {
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
        <div class="vp-tile"><div class="k">Last sold</div><div class="v">${esc(day(m.soldDate) || '—')}</div></div>
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
    const lead = (loan || lv) && est ? `<div class="vp-lead">
      <div class="k">This lead vs. estimate</div>
      ${loan ? `<div>Loan amt <b>${money(loan)}</b></div><div>LTV <b>${(loan / est * 100).toFixed(1)}%</b></div><div>Equity est. <b>${est - loan < 0 ? '−' : ''}${kMoney(Math.abs(est - loan))}</b></div>` : ''}
      ${leadHTML}
    </div>` : '';

    const chartW = Math.max(420, Math.round(((screen && screen.clientWidth) || 1400) - 58) * 1.15 / 2.15 - 38);
    const valueChart = m.history && m.history.length > 1 ? chartSVG(m.history, chartW, 260, th.chart, 'Home value estimate over time')
      : '<div class="vp-na">Value history isn\'t in this site\'s page data for this home.</div>';
    // Tax paid per year (from the tax history), like Zillow's "Tax paid" chart
    const taxPts = m.taxHistory.filter((t) => isNum(t.tax) && isNum(+t.year))
      .map((t) => ({ t: Date.UTC(+t.year, 0, 1), v: t.tax })).sort((x, y) => x.t - y.t);
    const chart = taxPts.length > 1
      ? `<div class="vp-ctabs" role="tablist"><button type="button" class="on" data-vp-chart="value">Home values</button><button type="button" data-vp-chart="tax">Tax paid</button></div>
         <div data-vp-pane="value">${valueChart}</div><div data-vp-pane="tax" hidden>${chartSVG(taxPts, chartW, 260, th.chart, 'Property tax paid by year')}</div>`
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
    const taxRows = m.taxHistory.slice().sort((x, y) => (+y.year || 0) - (+x.year || 0)).map((t, i, arr) => {
      const prev = arr[i + 1];
      const tr = isNum(t.taxRate) ? t.taxRate : (prev && isNum(t.tax) && isNum(prev.tax) && prev.tax ? (t.tax - prev.tax) / prev.tax : null);
      const vr = isNum(t.valueRate) ? t.valueRate : (prev && isNum(t.value) && isNum(prev.value) && prev.value ? (t.value - prev.value) / prev.value : null);
      return `<tr><td>${esc(t.year)}</td><td>${isNum(t.tax) ? money(t.tax) + pctTag(tr) : '--'}</td><td>${isNum(t.value) ? money(t.value) + pctTag(vr) : '--'}</td></tr>`;
    }).join('');
    const priceRows = m.priceHistory.map((e) => `<tr><td>${esc(day(e.date))}</td><td>${esc(e.event || '')}</td>
      <td>${isNum(e.price) ? money(e.price) + pctTag(e.rate) : '--'}${isNum(e.ppsf) ? `<div class="vp-sub">${money(e.ppsf)}/sqft</div>` : ''}${e.source ? `<div class="vp-sub">Source: ${esc(e.source)}</div>` : ''}</td></tr>`).join('');
    const histTables = (priceRows || taxRows) ? `<div class="vp-hist">
      <div><h4 class="vp-sec">Price history</h4>${priceRows ? `<div class="vp-scroll"><table class="vp-t2"><thead><tr><th>Date</th><th>Event</th><th>Price</th></tr></thead><tbody>${priceRows}</tbody></table></div>` : '<div class="vp-na">No price history.</div>'}</div>
      <div><h4 class="vp-sec">Public tax history</h4>${taxRows ? `<div class="vp-scroll"><table class="vp-t2"><thead><tr><th>Year</th><th>Property taxes</th><th>Tax assessment</th></tr></thead><tbody>${taxRows}</tbody></table></div>` : '<div class="vp-na">No tax history.</div>'}</div>
    </div>` : '';

    const facts = section('Highlights', hlItems) + section('Home details', detItems) + histTables;

    const pf = photosFor(m), ph = pf.list;
    galleryPhotos = ph;
    const gallery = ph.length ? `<div class="vp-card vp-gal" style="margin-bottom:14px">
      <h3>${pf.street ? 'Street view' : 'Photos'} <span class="vp-count">${ph.length > 1 ? `<span data-vp-n>1</span> of ${ph.length}` : ''}</span></h3>
      <div class="vp-stage">
        <img data-vp-main src="${esc(ph[0].full)}" alt="${esc(ph[0].caption || 'Photo of ' + (m.street || a.street))}" referrerpolicy="no-referrer">
        ${ph.length > 1 ? '<button type="button" class="vp-nav prev" data-vp-step="-1" aria-label="Previous photo">‹</button><button type="button" class="vp-nav next" data-vp-step="1" aria-label="Next photo">›</button>' : ''}
      </div>
      ${ph.length > 1 ? `<div class="vp-thumbs">${ph.map((x, i) => `<button type="button" data-vp-i="${i}" class="${i ? '' : 'on'}" aria-label="Photo ${i + 1}"><img src="${esc(x.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div>` : ''}
    </div>` : '';

    return hero + gallery + `
      <div class="vp-grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.15fr)">
        <div class="vp-card"><h3>Sale &amp; value</h3>${tiles}${lead}</div>
        <div class="vp-card"><h3>Value over time</h3>${chart}</div>
      </div>
      <div class="vp-card" style="margin-top:14px"><h3>Home highlights for ${esc(m.street || a.street)}</h3>${facts || '<div class="vp-na">No home facts listed.</div>'}</div>`;
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
        t.innerHTML = `${favicon(s, 20)}<span class="lbl vp-sr">${esc(s.label)}</span><span class="dot"></span>`;
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
    tabBar.querySelectorAll('.vprop-tab').forEach((t) => { t.style.height = h + 'px'; t.style.lineHeight = h + 'px'; });
    return true;
  }

  // cover the same area the SCRIPT screens use
  function placeScreen() {
    const sp = document.getElementById('ScriptPanel');
    const r = sp && sp.getBoundingClientRect();
    let left, top, width, height;
    if (r && r.width > 300 && r.height > 200) { left = r.left; top = r.top; width = r.width; height = r.height; }
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
    if (ph) main.src = ph.full;
    thumbs.forEach((t, k) => t.classList.toggle('on', k === photoIndex));
    thumbs[photoIndex].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const n = screen.querySelector('[data-vp-n]'); if (n) n.textContent = String(photoIndex + 1);
  }

  function closeScreen() {
    openKey = null;
    if (screen) screen.classList.remove('open');
    Object.keys(tabs).forEach((k) => tabs[k].classList.remove('active'));
  }
  function toggleScreen(key) { openKey === key ? closeScreen() : openScreen(key); }

  function renderAll() {
    if (!addTabs()) return;
    const a = getAddress(), c = a.missing.length ? null : cache[a.full];
    SITES.forEach((s) => {
      const st = c ? siteState(c, s.key).state : 'idle';
      tabs[s.key].classList.toggle('ready', st === 'ok' || st === 'shared');
      tabs[s.key].classList.toggle('fail', ['blocked', 'nomatch', 'nosource', 'error'].includes(st));
      tabs[s.key].title = `${s.label}: ` + ({ ok: 'facts ready', shared: 'facts ready', loading: 'loading…', blocked: 'blocked by the site – open it directly',
        nomatch: 'no exact match', nosource: 'open on the site', error: 'couldn\'t load', idle: 'waiting for a lead address' }[st] || st);
    });
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
  //  Main loop – Vici fills the fields by script (no input events), so check once a second
  // =====================================================================
  function refresh() {
    const a = getAddress();
    if (!a.missing.length) lookup(a); // starts the lookups as soon as a lead's address pops up
    renderAll();
  }

  refresh();
  setInterval(refresh, 1000);
  window.addEventListener('resize', () => { if (screen && screen.classList.contains('open')) placeScreen(); });
})();
