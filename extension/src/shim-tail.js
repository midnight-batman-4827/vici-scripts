  }
  // load stored values first (GM_getValue must answer immediately), then run
  try { chrome.storage.local.get(null, (all) => { Object.assign(cache, all || {}); main(); }); } catch (e) { main(); }
})();
