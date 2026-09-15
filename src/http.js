// HTTP vanuit het hoofdproces via Chromium's netwerkstack (volgt systeemproxy, VPN en certificaten).
const { app, net } = require('electron');

// Chromium breekt lopende verzoeken af zodra macOS een netwerkwijziging meldt, bv. een nieuw
// tijdelijk IPv6-adres, een VPN of een netwerkadapter die aan/uit gaat: net::ERR_NETWORK_CHANGED.
// Na zo'n melding gebruiken we een kwartier Node's eigen fetch, die daar niet op reageert.
const NODE_FALLBACK_MS = 15 * 60 * 1000;
let nodeUntil = 0;

const TRANSIENT =
  /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_IO_SUSPENDED|ERR_CONNECTION_(RESET|CLOSED|ABORTED|TIMED_OUT|REFUSED)|ERR_EMPTY_RESPONSE|ERR_HTTP2_|ERR_QUIC_PROTOCOL_ERROR|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_SSL_PROTOCOL_ERROR|fetch failed|terminated|other side closed|socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|ENETUNREACH|EAI_AGAIN|UND_ERR/i;

function electronNetReady() {
  return typeof app?.isReady === 'function' && app.isReady() && typeof net?.fetch === 'function';
}

function httpFetch(url, init) {
  if (electronNetReady() && Date.now() >= nodeUntil) return net.fetch(url, init);
  return fetch(url, init);
}

// Maakt van "fetch failed" een bruikbare melding met de echte oorzaak.
function describeNetError(e) {
  const cause = e?.cause;
  const detail = cause?.code || cause?.message;
  return detail && detail !== e.message ? `${e.message} (${detail})` : e?.message || String(e);
}

// Tijdelijke netwerkfout (verbinding even weg of netwerk gewisseld): opnieuw proberen heeft zin.
function isTransientNetError(e) {
  if (!e || e.name === 'AbortError') return false;
  return TRANSIENT.test(`${e.message || ''} ${e.cause?.code || ''} ${e.cause?.message || ''}`);
}

// Na een netwerkwijziging schakelen we tijdelijk over op Node's fetch.
function noteNetError(e) {
  if (/ERR_NETWORK_CHANGED|ERR_NETWORK_IO_SUSPENDED/i.test(describeNetError(e))) nodeUntil = Date.now() + NODE_FALLBACK_MS;
}

module.exports = { httpFetch, describeNetError, isTransientNetError, noteNetError };
