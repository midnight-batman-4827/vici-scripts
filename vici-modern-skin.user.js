// ==UserScript==
// @name         Vici Modern Skin
// @namespace    mortgageusa.vici
// @version      1.0
// @description  A cleaner, modern look for the VICIdial agent screen. Restyles only – nothing moves. Classic/Modern switch in the bottom-left corner.
// @match        *://mtgusa.talkitpro.com/agc/*
// @grant        none
// @run-at       document-start
// @homepageURL  https://github.com/midnight-batman-4827/vici-scripts
// @updateURL    https://raw.githubusercontent.com/midnight-batman-4827/vici-scripts/main/vici-modern-skin.user.js
// @downloadURL  https://raw.githubusercontent.com/midnight-batman-4827/vici-scripts/main/vici-modern-skin.user.js
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'vms_on';
  const isOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } };
  const root = document.documentElement;
  if (isOn()) root.classList.add('vms-on');

  // ---------- palette ----------
  const C = {
    page: '#eef2f7',      // replaces Vici's flat grey
    card: '#ffffff',
    ink: '#1f2937',
    label: '#475467',
    line: '#d0d7e2',
    accent: '#2563eb',
    accentSoft: '#dbe7ff'
  };

  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';

  const css = document.createElement('style');
  css.textContent = `
    html.vms-on body{background:${C.page}!important;color:${C.ink};-webkit-font-smoothing:antialiased}
    html.vms-on body, html.vms-on td, html.vms-on th, html.vms-on font, html.vms-on span, html.vms-on div,
    html.vms-on input, html.vms-on textarea, html.vms-on select, html.vms-on button{font-family:Inter,'Segoe UI',Arial,sans-serif!important}

    /* labels next to the fields */
    html.vms-on td{color:${C.label}}
    html.vms-on font.body_text, html.vms-on font.body_small, html.vms-on font.queue_text{color:${C.label}}

    /* inputs */
    html.vms-on input[type=text], html.vms-on input:not([type]), html.vms-on input[type=password],
    html.vms-on textarea, html.vms-on select{
      background:#fff!important;color:${C.ink}!important;border:1px solid ${C.line}!important;border-radius:6px!important;
      padding:2px 7px!important;box-shadow:0 1px 1px rgba(16,24,40,.04)!important;outline:none!important;
      transition:border-color .15s, box-shadow .15s}
    html.vms-on input[type=text]:focus, html.vms-on input:not([type]):focus, html.vms-on textarea:focus, html.vms-on select:focus{
      border-color:${C.accent}!important;box-shadow:0 0 0 3px ${C.accentSoft}!important}
    html.vms-on input[readonly]{background:#f7f9fc!important}

    /* the lead form becomes a white card */
    html.vms-on .vms-card{background:${C.card}!important;border-radius:14px!important;
      box-shadow:0 1px 2px rgba(16,24,40,.06), 0 4px 16px rgba(16,24,40,.06)!important}

    /* Vici's image buttons (WEB FORM, HANGUP, PARK…) and tabs */
    html.vms-on img[src*="vdc_LB_"], html.vms-on img[src*="vdc_XB_"], html.vms-on img[src*="vdc_RS_"], html.vms-on img[src*="vdc_volume"]{
      border-radius:7px;box-shadow:0 1px 2px rgba(16,24,40,.12);transition:transform .12s, box-shadow .12s}
    html.vms-on a:hover img[src*="vdc_LB_"], html.vms-on a:hover img[src*="vdc_XB_"]{
      transform:translateY(-1px);box-shadow:0 4px 10px rgba(16,24,40,.18)}
    html.vms-on img[src*="vdc_tab_"]{border-radius:6px 6px 0 0}

    /* text-style buttons, if this Vici skin uses them */
    html.vms-on .vms-btn{border-radius:7px!important;border-color:${C.line}!important;
      box-shadow:0 1px 2px rgba(16,24,40,.08)!important;transition:transform .12s, box-shadow .12s}
    html.vms-on .vms-btn, html.vms-on a .vms-btn, html.vms-on a:hover .vms-btn{color:#1f2937!important;text-decoration:none!important;font-weight:600!important;letter-spacing:.02em}
    html.vms-on .vms-btn:hover{transform:translateY(-1px);box-shadow:0 4px 10px rgba(16,24,40,.15)!important}

    /* links */
    html.vms-on a, html.vms-on a font{color:${C.accent}!important;text-decoration:none!important}
    html.vms-on a:hover, html.vms-on a:hover font{text-decoration:underline!important}

    /* Classic / Modern switch */
    #vms-toggle{position:fixed;left:10px;bottom:10px;z-index:2147483646;display:flex;gap:2px;padding:3px;
      background:#fff;border:1px solid #d0d7e2;border-radius:999px;box-shadow:0 2px 8px rgba(16,24,40,.12);
      font:600 11px Inter,'Segoe UI',Arial,sans-serif!important}
    #vms-toggle button{border:0;background:transparent;color:#475467;padding:4px 10px;border-radius:999px;cursor:pointer;
      font:inherit!important}
    #vms-toggle button[aria-pressed=true]{background:${C.accent};color:#fff}`;

  // Vici paints its grey with bgcolor attributes and inline styles, so swap that exact grey for the new page color
  const GREYS = new Set(['rgb(204, 204, 204)', 'rgb(211, 211, 211)', 'rgb(192, 192, 192)', 'rgb(221, 221, 221)']);
  function recolor() {
    const on = root.classList.contains('vms-on');
    document.querySelectorAll('body *').forEach((el) => {
      if (el.closest('#vprop-screen, #vprop-tabbar, #vms-toggle, #vqdnc-box')) return;
      if (on) {
        if (el.dataset.vmsBg !== undefined) return;
        const bg = getComputedStyle(el).backgroundColor;
        if (GREYS.has(bg)) { el.dataset.vmsBg = el.style.backgroundColor || ''; el.style.setProperty('background-color', C.page, 'important'); }
      } else if (el.dataset.vmsBg !== undefined) {
        el.style.backgroundColor = el.dataset.vmsBg;
        if (!el.dataset.vmsBg) el.style.removeProperty('background-color');
        delete el.dataset.vmsBg;
      }
    });
  }

  // Put the lead form (the table holding Address1) on a white card, and mark text-style buttons
  function decorate() {
    const addr = document.getElementById('address1') || document.querySelector('[name="address1"]');
    const form = addr && addr.closest('table');
    if (form && !form.classList.contains('vms-card')) form.classList.add('vms-card');
    document.querySelectorAll('a span, a div, a font, td[onclick], span[onclick], div[onclick]').forEach((el) => {
      const cs = getComputedStyle(el);
      if (parseFloat(cs.borderTopWidth) > 0 && el.textContent.trim().length > 2 && el.textContent.trim().length < 30 &&
        /^[A-Z0-9 \-:]+$/.test(el.textContent.trim())) el.classList.add('vms-btn');
    });
  }

  function addToggle() {
    if (document.getElementById('vms-toggle')) return;
    const box = document.createElement('div');
    box.id = 'vms-toggle';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Screen style');
    box.innerHTML = '<button type="button" data-v="0">Classic</button><button type="button" data-v="1">Modern</button>';
    const sync = () => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.v === '1') === isOn())));
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try { localStorage.setItem(KEY, b.dataset.v); } catch (err) {}
      root.classList.toggle('vms-on', b.dataset.v === '1');
      sync(); recolor();
    });
    document.body.appendChild(box);
    sync();
  }

  function start() {
    document.head.appendChild(font);
    document.head.appendChild(css);
    addToggle();
    const tick = () => { if (root.classList.contains('vms-on')) { decorate(); } recolor(); };
    tick();
    setInterval(tick, 1500); // Vici redraws parts of the screen during calls
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
