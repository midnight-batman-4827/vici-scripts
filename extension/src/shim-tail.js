  }
  // load stored values first (GM_getValue must answer immediately), then run
  // + the settings the company pushes through Edge policy (managed storage): the Send to Team Lead flow URL
  const managed = (done) => { try { chrome.storage.managed.get(null, (m) => { if (!chrome.runtime.lastError && m && typeof m.flowUrl === 'string') cache.vpPolicyFlowUrl = m.flowUrl.trim(); done(); }); } catch (e) { done(); } };
  try { chrome.storage.local.get(null, (all) => { Object.assign(cache, all || {}); delete cache.vpPolicyFlowUrl; managed(main); }); } catch (e) { main(); }
})();
