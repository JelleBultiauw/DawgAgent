// The Brain in de interface: de levende graaf van alles wat DawgAgent onthoudt.
//
// app.js geeft zijn hulpfuncties mee via createBrain(ctx). De pagina bestaat uit:
//   - een canvas met een krachten-graaf (nodes = herinneringen, lijnen = verbindingen)
//     met zoomen, pannen, slepen, hoveren en een pulserend effect als de agent iets schrijft;
//   - een balk met zoeken, typefilters en de knoppen Nieuw / Ordenen / In beeld;
//   - een lade rechts met de volledige herinnering, de verbindingen en de acties;
//   - een lijstweergave voor wie rustig wil lezen in plaats van kijken.
import { t } from './i18n.js';

export const BRAIN_ICONS = {
  brain:
    '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
  graph: '<circle cx="6" cy="7" r="2.6"/><circle cx="18" cy="7" r="2.6"/><circle cx="12" cy="18" r="2.6"/><path d="M8.1 8.6l2.6 6.9M15.9 8.6l-2.6 6.9M8.6 7h6.8"/>',
  fit: '<path d="M3 9V5a2 2 0 0 1 2-2h4"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M21 15v4a2 2 0 0 1-2 2h-4"/><path d="M9 21H5a2 2 0 0 1-2-2v-4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z"/>',
};

// De soorten herinneringen. Kleuren werken op de donkere graaf achtergrond.
export const BRAIN_TYPES = [
  { id: 'note', label: 'Notitie', color: '#6f9dff' },
  { id: 'project', label: 'Project', color: '#5cc98a' },
  { id: 'person', label: 'Persoon', color: '#e5b45a' },
  { id: 'decision', label: 'Beslissing', color: '#c08cf0' },
  { id: 'task', label: 'Actiepunt', color: '#ff8f6e' },
  { id: 'idea', label: 'Idee', color: '#63d8e8' },
  { id: 'meeting', label: 'Vergadering', color: '#f2a0c8' },
  { id: 'source', label: 'Bron', color: '#9aa4b2' },
];
const TYPE = (id) => BRAIN_TYPES.find((tp) => tp.id === id) || BRAIN_TYPES[0];

const TWO_PI = Math.PI * 2;
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)));
  return `rgb(${ch.join(',')})`;
}
const fmtWhen = (ts) => {
  const d = new Date(ts || Date.now());
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ` ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

export function createBrain(ctx) {
  const { h, icon, call, toast, openModal, closeModal, confirmDialog, btn, iconBtn, md, state, askInChat } = ctx;

  const B = {
    nodes: [],
    links: [],
    stats: null,
    query: '',
    filter: null,
    mode: 'graph', // graph | list
    selected: null, // { id }
    full: null, // volledige tekst van de geselecteerde node ({ id, content })
    adj: new Map(),
    ready: false,
    busy: false,
  };

  const pos = new Map(); // id -> { x, y, vx, vy, pin }
  const cam = { x: 0, y: 0, zoom: 1 };
  let camTarget = null; // waar de camera rustig naartoe glijdt (fit, focus)
  const pulse = new Map(); // id -> 1..0
  const pendingPulse = new Set();
  let hover = null;
  let drag = null;
  let panning = null;
  let userCam = false; // heeft de gebruiker zelf gepand/gezoomd? dan niet meer automatisch passend maken
  let alpha = 1;
  let frame = 0;
  let raf = 0;
  let dom = null;
  let refreshTimer = 0;

  // ---------- data ----------
  function rebuildAdjacency() {
    const adj = new Map();
    for (const n of B.nodes) adj.set(n.id, new Set());
    for (const l of B.links) {
      adj.get(l.from)?.add(l.to);
      adj.get(l.to)?.add(l.from);
    }
    B.adj = adj;
  }

  const degree = (id) => (B.adj.get(id)?.size || 0) || 0;

  function ensurePositions() {
    const ids = new Set(B.nodes.map((n) => n.id));
    for (const id of [...pos.keys()]) if (!ids.has(id)) pos.delete(id);
    for (const n of B.nodes) {
      if (pos.has(n.id)) continue;
      const near = [...(B.adj.get(n.id) || [])].map((id) => pos.get(id)).filter(Boolean);
      if (near.length) {
        const p = near[Math.floor(Math.random() * near.length)];
        pos.set(n.id, { x: p.x + (Math.random() - 0.5) * 110, y: p.y + (Math.random() - 0.5) * 110, vx: 0, vy: 0 });
      } else {
        // Nieuwe losse nodes komen in een spiraal om het midden; de simulatie trekt ze daarna bij.
        const a = Math.random() * TWO_PI;
        const r = 120 + Math.random() * 220;
        pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 });
      }
    }
  }

  async function refresh() {
    try {
      const data = await call('brain:list');
      B.nodes = data.nodes || [];
      B.links = data.links || [];
      B.stats = data.stats || null;
      B.ready = true;
    } catch (e) {
      B.ready = true;
      if (dom) toast(e.message, 'error');
    }
    rebuildAdjacency();
    ensurePositions();
    for (const id of pendingPulse) if (B.nodes.some((n) => n.id === id)) pulse.set(id, 1);
    pendingPulse.clear();
    updateBadge();
    if (dom) {
      renderBar();
      renderList();
      renderDetail();
      renderEmpty();
      if (pulse.size) flashHud();
      wake();
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = 0;
      refresh();
    }, 450);
  }

  function updateBadge() {
    const dot = document.querySelector('#brain-count');
    if (!dot) return;
    const n = B.stats?.nodes || 0;
    dot.textContent = n ? String(n) : '';
    dot.hidden = !n;
  }

  // ---------- tekenen ----------
  const wake = () => {
    alpha = Math.max(alpha, 0.55);
  };

  function radiusOf(node) {
    const len = (node.content || '').length;
    return 4.6 + Math.min(degree(node.id), 9) * 0.95 + Math.min(len / 900, 1.6);
  }

  function resize() {
    if (!dom) return;
    const c = dom.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(1, Math.round(c.clientWidth * dpr));
    c.height = Math.max(1, Math.round(c.clientHeight * dpr));
    wake();
  }

  function tick() {
    const list = B.nodes.filter((n) => pos.has(n.id)).map((n) => pos.get(n.id));
    const repel = 1500 * Math.max(alpha, 0.02);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 260000) continue;
        if (d2 < 36) {
          dx = (Math.random() - 0.5) * 12;
          dy = (Math.random() - 0.5) * 12;
          d2 = 36;
        }
        const d = Math.sqrt(d2);
        const f = repel / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    for (const l of B.links) {
      const a = pos.get(l.from);
      const b = pos.get(l.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const want = (l.auto ? 185 : 125) + Math.min(degree(l.from) + degree(l.to), 12) * 6;
      const f = ((d - want) / d) * 0.055 * alpha;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    for (const p of list) {
      if (p.pin) {
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      p.vx += -p.x * 0.0034 * alpha;
      p.vy += -p.y * 0.0034 * alpha;
      p.vx *= 0.87;
      p.vy *= 0.87;
      p.x += Math.max(-40, Math.min(40, p.vx));
      p.y += Math.max(-40, Math.min(40, p.vy));
    }
    alpha *= 0.987;
    if (alpha < 0.012) alpha = 0;
  }

  function visualState() {
    const dim = new Set();
    const q = B.query.toLowerCase();
    for (const n of B.nodes) {
      if (B.filter && n.type !== B.filter) dim.add(n.id);
      else if (q && !matchesQuery(n, q)) dim.add(n.id);
    }
    const focusId = (hover && hover.id) || B.selected?.id || null;
    let hi = null;
    if (focusId && B.nodes.some((n) => n.id === focusId)) {
      hi = new Set([focusId]);
      for (const id of B.adj.get(focusId) || []) hi.add(id);
    }
    return { dim, hi, focusId };
  }

  function matchesQuery(node, q) {
    return (
      node.title.toLowerCase().includes(q) ||
      node.tags.some((tag) => tag.toLowerCase().includes(q)) ||
      (node.content || '').toLowerCase().includes(q)
    );
  }

  function project(p, W, H) {
    return { x: W / 2 + cam.x + p.x * cam.zoom, y: H / 2 + cam.y + p.y * cam.zoom };
  }

  function draw() {
    if (!dom) return;
    const c = dom.canvas;
    const g = dom.g;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) resize();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const st = visualState();
    const zoom = cam.zoom;
    const byId = new Map(B.nodes.map((n) => [n.id, n]));
    g.save();
    g.translate(W / 2 + cam.x, H / 2 + cam.y);
    g.scale(zoom, zoom);

    // achtergrond: fijn stipraster dat meebeweegt
    const step = 48 * (zoom < 0.5 ? 3 : zoom < 0.85 ? 2 : 1);
    const halfW = W / 2 / zoom;
    const halfH = H / 2 / zoom;
    const cx = -cam.x / zoom;
    const cy = -cam.y / zoom;
    g.fillStyle = 'rgba(150,180,255,0.10)';
    for (let x = Math.floor((cx - halfW) / step) * step; x <= cx + halfW; x += step) {
      for (let y = Math.floor((cy - halfH) / step) * step; y <= cy + halfH; y += step) {
        g.beginPath();
        g.arc(x, y, Math.max(0.7 / zoom, 0.7), 0, TWO_PI);
        g.fill();
      }
    }

    // verbindingen
    const seenPairs = new Set();
    for (const l of B.links) {
      const a = pos.get(l.from);
      const b = pos.get(l.to);
      if (!a || !b) continue;
      const key = l.from < l.to ? `${l.from}|${l.to}` : `${l.to}|${l.from}`;
      const double = seenPairs.has(key);
      seenPairs.add(key);
      const active = st.focusId && (l.from === st.focusId || l.to === st.focusId);
      const dimmed = st.dim.has(l.from) && st.dim.has(l.to);
      const other = l.from === st.focusId ? l.to : l.from;
      const col = TYPE(byId.get(other)?.type).color;
      g.setLineDash(l.auto && !active ? [5 / zoom, 6 / zoom] : []);
      g.lineWidth = (active ? 1.7 : 1) / zoom;
      g.strokeStyle = active ? hexA(col, 0.75) : dimmed ? 'rgba(150,170,220,0.05)' : 'rgba(160,185,235,0.17)';
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const bend = double ? 0.12 : 0.05;
      const mx = (a.x + b.x) / 2 - dy * bend;
      const my = (a.y + b.y) / 2 + dx * bend;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo(mx, my, b.x, b.y);
      g.stroke();
      if (active && l.label) {
        g.setLineDash([]);
        g.font = `${11 / zoom}px -apple-system, BlinkMacSystemFont, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const lx = (a.x + 2 * mx + b.x) / 4;
        const ly = (a.y + 2 * my + b.y) / 4;
        const w = g.measureText(l.label).width + 12 / zoom;
        g.fillStyle = 'rgba(10,14,24,0.85)';
        g.beginPath();
        if (g.roundRect) g.roundRect(lx - w / 2, ly - 9 / zoom, w, 18 / zoom, 9 / zoom);
        else g.rect(lx - w / 2, ly - 9 / zoom, w, 18 / zoom);
        g.fill();
        g.fillStyle = 'rgba(220,232,255,0.92)';
        g.fillText(l.label, lx, ly);
      }
    }
    g.setLineDash([]);

    // nodes
    for (const n of B.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const stl = TYPE(n.type);
      const r = radiusOf(n);
      const dimmed = st.dim.has(n.id);
      const hot = st.hi ? st.hi.has(n.id) : false;
      const chosen = B.selected?.id === n.id;
      const glowR = r * (hot || chosen ? 4.6 : 3);
      const grd = g.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, glowR);
      grd.addColorStop(0, hexA(stl.color, dimmed ? 0.05 : hot || chosen ? 0.45 : 0.22));
      grd.addColorStop(1, hexA(stl.color, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(p.x, p.y, glowR, 0, TWO_PI);
      g.fill();

      const body = g.createRadialGradient(p.x - r * 0.4, p.y - r * 0.45, r * 0.1, p.x, p.y, r * 1.05);
      body.addColorStop(0, dimmed ? 'rgba(70,80,105,0.5)' : shade(stl.color, 0.45));
      body.addColorStop(1, dimmed ? 'rgba(28,34,48,0.5)' : shade(stl.color, -0.45));
      g.beginPath();
      g.arc(p.x, p.y, r, 0, TWO_PI);
      g.fillStyle = body;
      g.fill();
      g.lineWidth = (chosen ? 2 : 1) / zoom;
      g.strokeStyle = dimmed ? 'rgba(140,155,190,0.18)' : hexA(stl.color, chosen ? 1 : 0.72);
      g.stroke();
      if (n.pinned) {
        g.beginPath();
        g.arc(p.x, p.y, r + 3.4 / zoom, 0, TWO_PI);
        g.lineWidth = 1 / zoom;
        g.strokeStyle = hexA(stl.color, dimmed ? 0.12 : 0.4);
        g.stroke();
      }
    }

    // pulsen (nieuwe of zojuist beschreven herinneringen)
    for (const [id, value] of [...pulse]) {
      const p = pos.get(id);
      const v = value - 0.016;
      if (v <= 0 || !p) {
        pulse.delete(id);
        continue;
      }
      pulse.set(id, v);
      const n = B.nodes.find((x) => x.id === id);
      const r = (n ? radiusOf(n) : 6) + (1 - v) * 46;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, TWO_PI);
      g.lineWidth = 2.2 / zoom;
      g.strokeStyle = hexA(TYPE(n?.type).color, v * 0.7);
      g.stroke();
    }

    g.restore();

    // labels en hover: in schermcoördinaten, zodat ze altijd scherp en even groot zijn
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '11.5px -apple-system, BlinkMacSystemFont, sans-serif';
    for (const n of B.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const chosen = B.selected?.id === n.id;
      const hot = st.hi ? st.hi.has(n.id) : false;
      const show = chosen || hot || zoom > 1.35 || degree(n.id) >= 4;
      if (!show || st.dim.has(n.id)) continue;
      const s = project(p, W, H);
      const r = radiusOf(n) * zoom;
      const label = n.title.length > 34 ? `${n.title.slice(0, 33)}…` : n.title;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(7,10,18,0.85)';
      g.strokeText(label, s.x + r + 5, s.y);
      g.fillStyle = chosen || hot ? 'rgba(236,241,255,0.98)' : 'rgba(210,220,245,0.8)';
      g.fillText(label, s.x + r + 5, s.y);
    }
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!dom || dom.page.hidden) return;
    frame++;
    const active = alpha > 0.012 || pulse.size || drag || panning || hover || camTarget;
    if (!active && frame % 3) return;
    if (alpha > 0) tick();
    stepCamera();
    draw();
  }

  // ---------- besturing ----------
  function pointerWorld(e) {
    const rect = dom.canvas.getBoundingClientRect();
    const W = dom.canvas.clientWidth;
    const H = dom.canvas.clientHeight;
    return {
      x: (e.clientX - rect.left - W / 2 - cam.x) / cam.zoom,
      y: (e.clientY - rect.top - H / 2 - cam.y) / cam.zoom,
      sx: e.clientX - rect.left,
      sy: e.clientY - rect.top,
    };
  }

  function hitTest(w) {
    let best = null;
    let bestD = Infinity;
    for (const n of B.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      const r = radiusOf(n) + Math.max(6, 6 / cam.zoom);
      if (d < r && d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  function onDown(e) {
    if (e.button !== 0 || !dom) return;
    camTarget = null;
    const w = pointerWorld(e);
    const node = hitTest(w);
    dom.canvas.setPointerCapture(e.pointerId);
    if (node) {
      const p = pos.get(node.id);
      drag = { id: node.id, ox: p.x - w.x, oy: p.y - w.y, moved: 0 };
      p.pin = true;
      userCam = true;
    } else {
      panning = { x: e.clientX - cam.x, y: e.clientY - cam.y };
      userCam = true;
    }
    wake();
  }

  function onMove(e) {
    if (!dom) return;
    const w = pointerWorld(e);
    if (drag) {
      const p = pos.get(drag.id);
      if (p) {
        p.x = w.x + drag.ox;
        p.y = w.y + drag.oy;
        p.vx = 0;
        p.vy = 0;
        drag.moved += 1;
      }
      wake();
      return;
    }
    if (panning) {
      cam.x = e.clientX - panning.x;
      cam.y = e.clientY - panning.y;
      camTarget = null;
      wake();
      return;
    }
    const node = hitTest(w);
    const changed = (node?.id || null) !== (hover?.id || null);
    hover = node || null;
    dom.canvas.style.cursor = node ? 'pointer' : 'grab';
    if (changed) {
      renderTip(w.sx, w.sy);
      wake();
    } else if (node) {
      renderTip(w.sx, w.sy);
    }
  }

  function onUp(e) {
    if (!dom) return;
    if (drag) {
      const dragId = drag.id;
      const p = pos.get(dragId);
      const node = B.nodes.find((n) => n.id === dragId);
      const moved = drag.moved > 3;
      drag = null;
      if (p) setTimeout(() => { if (pos.get(dragId) === p) p.pin = false; }, 1800);
      if (!moved && node) select(node.id);
    } else if (panning) {
      panning = null;
    }
    wake();
  }

  function onWheel(e) {
    if (!dom) return;
    e.preventDefault();
    userCam = true;
    const W = dom.canvas.clientWidth;
    const H = dom.canvas.clientHeight;
    const rect = dom.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left - W / 2;
    const sy = e.clientY - rect.top - H / 2;
    const z = Math.max(0.22, Math.min(3.6, cam.zoom * Math.exp(-e.deltaY * 0.0016)));
    cam.x = sx - (sx - cam.x) * (z / cam.zoom);
    cam.y = sy - (sy - cam.y) * (z / cam.zoom);
    cam.zoom = z;
    camTarget = null;
    wake();
  }

  function renderTip(sx, sy) {
    const tip = dom.tip;
    if (!hover) {
      tip.hidden = true;
      return;
    }
    const stl = TYPE(hover.type);
    const deg = degree(hover.id);
    tip.textContent = '';
    tip.append(
      h('div', { class: 'bt-head' }, h('i', { class: 'bt-dot', style: `--c:${stl.color}` }), h('b', {}, hover.title)),
      h('div', { class: 'bt-sub' }, `${t(stl.label)}${hover.tags.length ? ` · #${hover.tags.join(' #')}` : ''} · ${deg} ${t(deg === 1 ? 'verbinding' : 'verbindingen')}`),
      hover.content ? h('div', { class: 'bt-text' }, hover.content.replace(/\s+/g, ' ').slice(0, 130)) : null,
    );
    tip.hidden = false;
    const rect = dom.canvas.getBoundingClientRect();
    const w = tip.offsetWidth || 240;
    const left = Math.min(Math.max(sx - w / 2, 8), rect.width - w - 8);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(sy - tip.offsetHeight - 16, 8)}px`;
  }

  function fit() {
    if (!B.nodes.length) {
      camTarget = { x: 0, y: 0, zoom: 1 };
      wake();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of B.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    if (!dom || !Number.isFinite(minX)) return;
    const W = dom.canvas.clientWidth || 800;
    const H = dom.canvas.clientHeight || 600;
    const w = Math.max(maxX - minX, 120) + 180;
    const h = Math.max(maxY - minY, 120) + 180;
    const zoom = Math.max(0.25, Math.min(1.5, Math.min(W / w, H / h)));
    camTarget = { x: -((minX + maxX) / 2) * zoom, y: -((minY + maxY) / 2) * zoom, zoom };
    wake();
  }

  function focusOn(id) {
    const p = pos.get(id);
    if (!p) return;
    camTarget = { x: -p.x * cam.zoom, y: -p.y * cam.zoom, zoom: cam.zoom };
    pulse.set(id, 1);
    wake();
  }

  // De camera glijdt naar zijn doel in plaats van te springen.
  function stepCamera() {
    if (!camTarget) return;
    const k = 0.14;
    cam.x += (camTarget.x - cam.x) * k;
    cam.y += (camTarget.y - cam.y) * k;
    cam.zoom += (camTarget.zoom - cam.zoom) * k;
    if (Math.abs(camTarget.x - cam.x) < 0.6 && Math.abs(camTarget.y - cam.y) < 0.6 && Math.abs(camTarget.zoom - cam.zoom) < 0.002) {
      Object.assign(cam, camTarget);
      camTarget = null;
    }
  }

  function relayout() {
    for (const n of B.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const a = Math.random() * TWO_PI;
      const r = 90 + Math.random() * 260;
      p.x = Math.cos(a) * r;
      p.y = Math.sin(a) * r;
      p.vx = 0;
      p.vy = 0;
    }
    alpha = 1;
    wake();
    setTimeout(fit, 1200);
  }

  // ---------- selectie en lade ----------
  async function select(id) {
    B.selected = id ? { id } : null;
    B.full = null;
    renderDetail();
    if (!id) return;
    const node = B.nodes.find((n) => n.id === id);
    if (node && (node.content || '').length >= 590) {
      try {
        const full = await call('brain:get', id);
        if (B.selected?.id === id) {
          B.full = { id, content: full.node.content };
          renderDetail();
        }
      } catch {}
    }
  }

  function connectionList(node) {
    const rows = h('div', { class: 'bd-links' });
    const conns = [];
    for (const l of B.links) {
      if (l.from !== node.id && l.to !== node.id) continue;
      const otherId = l.from === node.id ? l.to : l.from;
      const other = B.nodes.find((n) => n.id === otherId);
      if (other) conns.push({ other, label: l.label, auto: l.auto });
    }
    if (!conns.length) rows.append(h('div', { class: 'bd-empty' }, 'Nog niet verbonden. Koppel hem aan iets anders zodat de lijnen zichtbaar worden.'));
    for (const c of conns) {
      const stl = TYPE(c.other.type);
      rows.append(
        h(
          'button',
          { class: 'bd-link', onclick: () => { select(c.other.id); focusOn(c.other.id); } },
          h('i', { class: 'bd-dot', style: `--c:${stl.color}` }),
          h('span', { class: 'bd-link-title' }, c.other.title),
          c.label ? h('span', { class: 'bd-link-label' }, c.label) : null,
          c.auto ? h('span', { class: 'bd-link-label auto' }, 'auto') : null,
        ),
      );
    }
    return rows;
  }

  function renderDetail() {
    const box = dom.detail;
    const node = B.selected && B.nodes.find((n) => n.id === B.selected.id);
    if (!node) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    const stl = TYPE(node.type);
    const content = B.full && B.full.id === node.id ? B.full.content : node.content;
    box.textContent = '';
    box.hidden = false;
    box.append(
      h(
        'div',
        { class: 'bd-head' },
        h('span', { class: 'bd-type', style: `--c:${stl.color}` }, t(stl.label)),
        node.pinned ? h('span', { class: 'bd-pin' }, icon('pin', 12), 'Vastgezet') : null,
        iconBtn('x', 'Sluiten', () => select(null), 'bd-close'),
      ),
      h('h2', { class: 'bd-title' }, node.title),
      h(
        'div',
        { class: 'bd-meta' },
        `bijgewerkt ${fmtWhen(node.updated)}`,
        node.tags.length ? h('span', { class: 'bd-tags' }, ...node.tags.map((tag) => h('button', { class: 'bd-tag', onclick: () => { B.filter = null; B.query = tag; dom.search.value = tag; renderBar(); renderList(); wake(); } }, `#${tag}`))) : null,
      ),
      h('div', { class: 'bd-text md', html: md(content || '_Nog geen tekst._') }),
      h('h3', { class: 'bd-h3' }, `Verbindingen (${B.adj.get(node.id)?.size || 0})`),
      connectionList(node),
      h(
        'div',
        { class: 'bd-actions' },
        btn('Bewerken', 'ghost', () => editModal(node), 'pencil'),
        btn('Koppelen', 'ghost', () => linkModal(node), 'link'),
        btn('Vraag in chat', 'ghost', () => askInChat(`Wat staat er in The Brain over "${node.title}"? Vat het samen en vertel wat eraan hangt.`), 'bulb'),
        btn('Verwijderen', 'ghost danger', () => removeNode(node), 'trash'),
      ),
    );
  }

  async function removeNode(node) {
    const ok = await confirmDialog('Herinnering verwijderen?', `"${node.title}" verdwijnt uit The Brain, met de verbindingen eromheen.`, 'Verwijderen', true);
    if (!ok) return;
    try {
      await call('brain:delete', node.id);
      B.selected = null;
      await refresh();
      toast('Vergeten.');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---------- lijstweergave ----------
  function visibleNodes() {
    const q = B.query.toLowerCase();
    return B.nodes
      .filter((n) => (!B.filter || n.type === B.filter) && (!q || matchesQuery(n, q)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
  }

  function renderList() {
    if (!dom) return;
    const box = dom.listBox;
    box.hidden = B.mode !== 'list';
    if (B.mode !== 'list') return;
    box.textContent = '';
    const list = visibleNodes();
    if (!list.length) {
      box.append(h('div', { class: 'empty-card' }, B.nodes.length ? 'Niets gevonden met deze zoekopdracht.' : 'The Brain is nog leeg.'));
      return;
    }
    for (const node of list) {
      const stl = TYPE(node.type);
      box.append(
        h(
          'button',
          { class: `brain-card ${B.selected?.id === node.id ? 'on' : ''}`, onclick: () => select(node.id) },
          h('div', { class: 'bc-top' }, h('i', { class: 'bc-dot', style: `--c:${stl.color}` }), h('b', {}, node.title), node.pinned ? icon('pin', 12) : null, h('span', { class: 'bc-type' }, t(stl.label))),
          node.content ? h('div', { class: 'bc-text' }, node.content.replace(/\s+/g, ' ').slice(0, 180)) : null,
          h(
            'div',
            { class: 'bc-foot' },
            h('span', {}, `#${(node.tags || []).join(' #') || 'geen tags'}`),
            h('span', {}, `${degree(node.id)} ${t(degree(node.id) === 1 ? 'verbinding' : 'verbindingen')}`),
            h('span', {}, fmtWhen(node.updated)),
          ),
        ),
      );
    }
  }

  function renderEmpty() {
    if (!dom) return;
    const empty = B.nodes.length === 0;
    dom.empty.hidden = !empty;
    if (!empty) return;
  }

  function flashHud() {
    if (!dom) return;
    dom.hud.classList.add('flash');
    setTimeout(() => dom.hud?.classList.remove('flash'), 1400);
  }

  // ---------- balk ----------
  function renderBar() {
    if (!dom) return;
    const box = dom.chips;
    box.textContent = '';
    const counts = B.stats?.types || {};
    const total = B.stats?.nodes || 0;
    const links = B.stats?.links || 0;
    box.append(
      h('button', { class: `brain-chip ${!B.filter ? 'on' : ''}`, onclick: () => { B.filter = null; renderBar(); renderList(); wake(); } }, 'Alles', h('i', {}, String(total))),
    );
    for (const tp of BRAIN_TYPES) {
      const n = counts[tp.id] || 0;
      if (!n) continue;
      box.append(
        h(
          'button',
          { class: `brain-chip ${B.filter === tp.id ? 'on' : ''}`, style: `--c:${tp.color}`, onclick: () => { B.filter = B.filter === tp.id ? null : tp.id; renderBar(); renderList(); select(B.selected?.id); wake(); } },
          h('i', { class: 'bd-dot', style: `--c:${tp.color}` }),
          t(tp.label),
          h('i', {}, String(n)),
        ),
      );
    }
    dom.stats.textContent = total ? `${total} ${t(total === 1 ? 'herinnering' : 'herinneringen')} · ${links} ${t(links === 1 ? 'verbinding' : 'verbindingen')}` : '';
    dom.mode.forEach((b) => b.classList.toggle('on', b.dataset.mode === B.mode));
    dom.graphOnly.forEach((b) => (b.hidden = B.mode !== 'graph'));
    renderHud();
  }

  function renderHud() {
    if (!dom) return;
    const s = B.stats;
    dom.hud.textContent = '';
    if (!s || !s.nodes) return;
    dom.hud.append(
      h('b', {}, 'The Brain'),
      h('span', {}, `${s.nodes} ${t('herinneringen')} · ${s.links} ${t('lijnen')}`),
      s.updated ? h('span', { class: 'bh-when' }, `laatst bijgewerkt ${fmtWhen(Date.parse(s.updated))}`) : null,
    );
  }

  // ---------- vensters ----------
  function linkPicker(excludeId, initial = []) {
    const picked = [...initial];
    const chips = h('div', { class: 'blk-chips' });
    const input = h('input', { class: 'input', placeholder: 'Zoek een herinnering om te koppelen…', spellcheck: 'false' });
    const menu = h('div', { class: 'blk-menu', hidden: true });
    const drawChips = () => {
      chips.textContent = '';
      for (const item of picked) {
        chips.append(
          h(
            'span',
            { class: 'blk-chip' },
            item.title,
            h('button', { class: 'blk-x', title: 'Losmaken', onclick: () => { picked.splice(picked.indexOf(item), 1); drawChips(); drawMenu(); } }, '×'),
          ),
        );
      }
    };
    const drawMenu = () => {
      const q = input.value.trim().toLowerCase();
      const cands = B.nodes
        .filter((n) => n.id !== excludeId && !picked.some((p) => p.id === n.id))
        .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.tags || []).some((tag) => tag.includes(q)))
        .slice(0, 7);
      menu.textContent = '';
      for (const n of cands) {
        const stl = TYPE(n.type);
        menu.append(
          h(
            'button',
            { class: 'blk-item', onclick: () => { picked.push({ id: n.id, title: n.title, label: 'gerelateerd' }); input.value = ''; drawChips(); drawMenu(); } },
            h('i', { class: 'bd-dot', style: `--c:${stl.color}` }),
            n.title,
          ),
        );
      }
      menu.hidden = !cands.length;
    };
    input.addEventListener('focus', drawMenu);
    input.addEventListener('input', drawMenu);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        menu.querySelector('.blk-item')?.click();
      }
    });
    drawChips();
    return { el: h('div', { class: 'blk-wrap' }, chips, input, menu), value: () => picked };
  }

  function editModal(node = null) {
    const isNew = !node;
    const title = h('input', { class: 'input', value: node?.title || '', placeholder: 'bv. Voorkeur — werkwijze' });
    const type = h(
      'select',
      { class: 'input' },
      ...BRAIN_TYPES.map((tp) => h('option', { value: tp.id, selected: tp.id === (node?.type || 'note') }, t(tp.label))),
    );
    const tags = h('input', { class: 'input', value: (node?.tags || []).join(', '), placeholder: 'dawgagent, voorkeur' });
    const content = h('textarea', { class: 'textarea', rows: 8, placeholder: 'Wat moet er onthouden worden? Eén feit of beslissing per herinnering.' }, node?.content || '');
    let pinned = Boolean(node?.pinned);
    const picker = linkPicker(node?.id || '', []);

    const save = async () => {
      const payload = {
        id: node?.id,
        title: title.value.trim(),
        type: type.value,
        tags: tags.value,
        content: content.value,
        pinned,
        links: picker.value().map((p) => ({ to: p.id, label: p.label })),
        origin: 'user',
      };
      if (!payload.title) return toast('Geef eerst een titel op.', 'error');
      try {
        const res = await call('brain:save', payload);
        closeModal();
        await refresh();
        select(res.node.id);
        toast(isNew ? 'Aan The Brain toegevoegd.' : 'Bijgewerkt.');
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    openModal(
      h(
        'div',
        {},
        h('h2', {}, isNew ? 'Nieuwe herinnering' : 'Herinnering bewerken'),
        h('p', { class: 'lead' }, 'DawgAgent gebruikt dit in elke chat. Eén feit of beslissing per herinnering houdt het overzichtelijk; de tags en verbindingen maken de graaf.'),
        h('div', { class: 'field' }, h('label', {}, 'Titel'), title),
        h(
          'div',
          { class: 'field-row' },
          h('div', { class: 'field' }, h('label', {}, 'Soort'), type),
          h('div', { class: 'field' }, h('label', {}, 'Tags'), tags),
        ),
        h('div', { class: 'field' }, h('label', {}, 'Herinnering'), content),
        h('div', { class: 'field' }, h('label', {}, 'Verbinden met'), picker.el),
        h(
          'label',
          { class: 'field inline' },
          h('input', { type: 'checkbox', checked: pinned, onchange: (e) => (pinned = e.target.checked) }),
          'Vastzetten — altijd in de systeemprompt van DawgAgent',
        ),
        h('div', { class: 'modal-actions' }, btn('Opslaan', 'primary', save, 'check'), btn('Annuleren', 'ghost', closeModal)),
      ),
      'wide',
    );
    setTimeout(() => title.focus(), 50);
  }

  function linkModal(node) {
    const input = h('input', { class: 'input', placeholder: 'Zoek…', spellcheck: 'false' });
    const list = h('div', { class: 'blk-list' });
    const linked = new Set();
    for (const l of B.links) if (l.from === node.id || l.to === node.id) linked.add(l.from === node.id ? l.to : l.from);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      list.textContent = '';
      const cands = B.nodes.filter((n) => n.id !== node.id).filter((n) => !q || n.title.toLowerCase().includes(q));
      if (!cands.length) list.append(h('div', { class: 'empty-card' }, 'Nog geen andere herinneringen.'));
      for (const n of cands) {
        const stl = TYPE(n.type);
        const on = linked.has(n.id);
        list.append(
          h(
            'div',
            { class: 'blk-row' },
            h('i', { class: 'bd-dot', style: `--c:${stl.color}` }),
            h('span', { class: 'blk-name' }, n.title),
            h(
              'button',
              {
                class: `btn ghost ${on ? 'on' : ''}`,
                onclick: async () => {
                  try {
                    if (on) await call('brain:unlink', node.id, n.id);
                    else await call('brain:link', node.id, n.id, 'gerelateerd');
                    await refresh();
                    linkModal(node);
                  } catch (e) {
                    toast(e.message, 'error');
                  }
                },
              },
              on ? 'Losmaken' : 'Verbinden',
            ),
          ),
        );
      }
    };
    input.addEventListener('input', draw);
    draw();
    openModal(
      h('div', {}, h('h2', {}, `Koppelen aan "${node.title}"`), h('p', { class: 'lead' }, 'Elke verbinding is een lijn in de graaf. Hoe meer samenhang, hoe meer DawgAgent ziet wat bij elkaar hoort.'), h('div', { class: 'field' }, input), list, h('div', { class: 'modal-actions' }, btn('Klaar', 'primary', closeModal))),
      'wide',
    );
    setTimeout(() => input.focus(), 50);
  }

  // ---------- de pagina ----------
  function build() {
    const page = document.querySelector('#view-brain');
    if (!page) return;
    page.textContent = '';

    const canvas = h('canvas', { class: 'brain-canvas' });
    const tip = h('div', { class: 'brain-tip', hidden: true });
    const hud = h('div', { class: 'brain-hud' });
    const empty = h('div', { class: 'brain-empty', hidden: true });
    const listBox = h('div', { class: 'brain-list', hidden: true });
    const detail = h('aside', { class: 'brain-detail', hidden: true });
    const stage = h('div', { class: 'brain-stage' }, canvas, tip, hud, empty, listBox, detail);

    const search = h('input', { class: 'brain-search-input', placeholder: 'Zoek in je herinneringen…', spellcheck: 'false' });
    search.addEventListener('input', () => {
      B.query = search.value.trim();
      renderList();
      renderBar();
      wake();
    });
    const chips = h('div', { class: 'brain-chips' });
    const stats = h('span', { class: 'brain-stats' });

    const modeBtns = [
      h('button', { class: 'brain-seg', dataset: { mode: 'graph' }, onclick: () => setMode('graph') }, icon('graph', 14), 'Graaf'),
      h('button', { class: 'brain-seg', dataset: { mode: 'list' }, onclick: () => setMode('list') }, icon('list', 14), 'Lijst'),
    ];
    const btnLayout = btn('Ordenen', 'ghost', relayout, 'refresh');
    const btnFit = btn('In beeld', 'ghost', fit, 'fit');
    const btnNew = btn('Nieuw', 'primary', () => editModal(), 'plus');

    const head = h(
      'div',
      { class: 'brain-head' },
      h(
        'div',
        { class: 'brain-heading' },
        h('h1', {}, 'The Brain'),
        h('p', {}, 'Het tweede geheugen van DawgAgent: alles wat hij over jou, je projecten en je werk onthoudt — als één levende graaf.'),
      ),
      h('div', { class: 'brain-head-actions' }, h('div', { class: 'brain-seg-group' }, ...modeBtns), btnLayout, btnFit, btnNew),
    );
    const bar = h('div', { class: 'brain-bar' }, h('div', { class: 'brain-search' }, icon('search', 14), search), chips, h('div', { class: 'brain-bar-right' }, stats));
    const inner = h('div', { class: 'brain-inner' }, head, bar, stage);
    page.append(inner);

    empty.append(
      icon('brain', 40),
      h('b', {}, 'The Brain is nog leeg'),
      h('p', {}, 'Zodra DawgAgent iets leert dat hij moet onthouden — een voorkeur, beslissing, project of plan — verschijnt het hier als knooppunt. Je kunt zelf ook iets toevoegen.'),
      btn('Eerste herinnering maken', 'primary', () => editModal(), 'plus'),
    );

    dom = { page, canvas, g: canvas.getContext('2d'), tip, hud, empty, listBox, detail, chips, stats, search, mode: modeBtns, graphOnly: [btnLayout, btnFit] };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', () => {
      hover = null;
      tip.hidden = true;
      wake();
    });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      const w = pointerWorld(e);
      const node = hitTest(w);
      if (node) editModal(node);
    });
    new ResizeObserver(() => resize()).observe(canvas);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.view === 'brain' && B.selected) select(null);
    });

    resize();
    renderBar();
    renderList();
    renderDetail();
    renderEmpty();
  }

  function setMode(mode) {
    B.mode = mode;
    if (dom) {
      dom.canvas.parentElement.classList.toggle('list-mode', mode === 'list');
      dom.listBox.hidden = mode !== 'list';
      renderBar();
      renderList();
      if (mode === 'graph') {
        resize();
        wake();
      }
    }
  }

  function open() {
    if (!dom) build();
    if (dom) dom.page.hidden = false;
    resize();
    setMode(B.mode);
    if (!raf) raf = requestAnimationFrame(loop);
    refresh();
    // De krachten zijn nog bezig: eerst rustig laten uitwaaieren, daarna netjes in beeld zetten.
    if (!B.fitted) {
      B.fitted = true;
      if (!dom) return;
      for (const ms of [400, 1500, 3000]) setTimeout(() => { if (!userCam) { resize(); fit(); } }, ms);
    }
  }

  function onChanged(info = {}) {
    if (info.nodeId) pendingPulse.add(info.nodeId);
    if (info.otherId) pendingPulse.add(info.otherId);
    scheduleRefresh();
  }

  return { open, refresh, onChanged, state: B, editModal, select };
}
