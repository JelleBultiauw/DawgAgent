// HTTP vanuit het hoofdproces via Chromium's netwerkstack (volgt systeemproxy, VPN en certificaten).
const { app, net } = require('electron');

function httpFetch(url, init) {
  if (typeof app?.isReady === 'function' && app.isReady() && typeof net?.fetch === 'function') return net.fetch(url, init);
  return fetch(url, init);
}

// Maakt van "fetch failed" een bruikbare melding met de echte oorzaak.
function describeNetError(e) {
  const cause = e?.cause;
  const detail = cause?.code || cause?.message;
  return detail && detail !== e.message ? `${e.message} (${detail})` : e?.message || String(e);
}

module.exports = { httpFetch, describeNetError };
