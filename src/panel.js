// Brug tussen de agent en het zijpaneel: de agent leest en bedient de browser
// die in het paneel openstaat. Het paneel voert het uit en stuurt het antwoord terug.
let seq = 0;
const pending = new Map();
let sendToWindow = () => {};

function init(send) {
  sendToWindow = send;
}

function run(op, args = {}, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: 'Het zijpaneel reageerde niet op tijd.' });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    sendToWindow('panel:open', { tab: 'browser' });
    sendToWindow('panel:request', { id, op, args });
  });
}

function resolve(payload) {
  const p = pending.get(payload?.id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(payload.id);
  p.resolve(payload.error ? { error: payload.error } : payload.result ?? {});
  return true;
}

module.exports = { init, run, resolve };
