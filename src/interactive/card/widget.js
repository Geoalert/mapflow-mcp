// The session widget (PLAN.md 26.9, T3): the MCP Apps view claude.ai and ChatGPT show inline on start-session,
// run and finish. Plain JavaScript, no build step; agent/widget.py inlines it with Leaflet into the ui:// resource.
//
// It speaks JSON-RPC 2.0 with the host over postMessage (MCP Apps 2026-01-26): the host hands it the tool's
// arguments and result, which say the session and the run to show. The rest comes from the demo itself, as on
// the live page (agent.js): the session's state every 2 s while a run runs (10 s otherwise, and not at all while
// the card is out of sight), the run's outlines and the map's tiles. A click on an outline or on the image makes a
// mark for the agent: stored with the session (the agent's next tool call on it gets the marks) and handed to the
// model as context; "Send to the agent" also writes them into the chat.
//
// Hosts mount a new card for every such call, so a card folds into its head line once its session has a newer one
// (the result's _meta numbers the cards, the state counts them): the chat keeps one map open, the latest.
//
// On add-image the card is the upload link's file picker instead (claude.ai's connectors never see chat attachments):
// the file goes straight to the demo, and the card then tells the chat. On list-images it shows the images'
// thumbnails, which come in the result's _meta; on the platform the user's MyImagery, each mosaic with its images'
// previews, a click opening a mosaic's map to pick a session's area on, as select-area's card is (PLAN.md 28.21,
// 28.22), and on list-sessions the user's sessions.
(() => {
  'use strict';

  const CONFIG = JSON.parse(document.getElementById('mapflow-interactive-config').textContent);
  const BASE = CONFIG.base;
  const BRAND = CONFIG.brand || 'Mapflow Interactive', PLATFORM = !!CONFIG.platform; // it names no model (PLAN.md 28.21)
  const PROTOCOL = '2026-01-26';
  const FAST_MS = 2000, SLOW_MS = 10000, FETCH_MS = 20000;
  const CALL_MS = 60000; // a tool the card calls through the host: an area's check reads the images' headers
  const TOUCH_MS = 15000; // a card the user worked in this recently doesn't fold yet
  const GREEN = '#46eb64', BLUE = '#2563eb', RED = '#dc2626', YELLOW = '#ffdc00', ORANGE = '#f97316', CYAN = '#4cc9f0';
  const MAX_MARKS_SHOWN = 40;
  const enc = encodeURIComponent;
  // Leaflet puts a string tooltip in as HTML: every one is escaped (the security audit, PLAN.md 28.30 item 3).
  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const $ = (sel) => document.querySelector(sel);

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
    return node;
  }

  const fmt = (v, digits = 2) => (v === null || v === undefined ? '–' : (+v).toFixed(digits));
  const scaleText = (s) => (s === 1 ? 'native' : s < 1 ? `÷${1 / s}` : `×${s}`);
  const px = (p) => `(${Math.round(p[0])}, ${Math.round(p[1])})`;
  const gsdText = (g) => (g >= 1 ? `${fmt(g, 1)} m/px` : `${Math.round(g * 100)} cm/px`);
  const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso
      : d.toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  };

  // A tool's answer to a call the card made through the host: its JSON, or {error}.
  function callData(r) {
    const text = ((r && r.content) || []).find((c) => c.type === 'text');
    if (r && r.isError) return {error: text ? text.text : 'the tool failed'};
    if (r && r.structuredContent) return r.structuredContent;
    try { return JSON.parse(text.text); } catch (_) { return {error: 'an answer the card can’t read'}; }
  }

  // --- A mosaic's thumbnail: its map layer, as Mapflow renders it -------------------------
  //
  // The layer's tiles at the zoom where the mosaic's bounds fit a square of 256 px, placed around its centre, with its
  // outline over them; positions are in percent of the square, so the picture fills whatever square holds it.

  const THUMB = 256;
  function worldPx(lon, lat, z) {
    const k = 256 * 2 ** z, sin = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
    return [(lon + 180) / 360 * k, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * k];
  }
  function footprintRings(g) {
    if (!g) return null;
    if (g.type === 'Polygon') return [g.coordinates[0]];
    if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0]);
    return null;
  }
  function mosaicThumb(m) {
    const box = el('div', {class: 'm-thumb'});
    const b = m.bounds;
    if (!b) return box;
    let z = 22;
    for (; z > 0; z--) {
      const [x0, y0] = worldPx(b[0], b[3], z), [x1, y1] = worldPx(b[2], b[1], z);
      if (x1 - x0 <= THUMB * 0.9 && y1 - y0 <= THUMB * 0.9) break;
    }
    // The square shows `view` world px (the zoom's steps would leave the mosaic as small as half of it).
    const [x0, y0] = worldPx(b[0], b[3], z), [x1, y1] = worldPx(b[2], b[1], z);
    const view = Math.min(THUMB, Math.max(THUMB / 2, Math.max(x1 - x0, y1 - y0) / 0.9));
    const left = (x0 + x1 - view) / 2, top = (y0 + y1 - view) / 2, n = 2 ** z;
    const pct = (v) => `${(100 * v / view).toFixed(3)}%`;
    if (m.tile_url) {
      for (let ty = Math.floor(top / 256); ty * 256 < top + view; ty++) {
        for (let tx = Math.floor(left / 256); tx * 256 < left + view; tx++) {
          if (ty < 0 || ty >= n) continue;
          const src = m.tile_url.replace('{z}', z).replace('{x}', ((tx % n) + n) % n).replace('{y}', ty)
            .replace('{s}', 'a');
          box.append(el('img', {src, alt: '', loading: 'lazy', onerror: (e) => e.target.remove(),
                                style: `left:${pct(tx * 256 - left)};top:${pct(ty * 256 - top)};width:${pct(256)};`
                                  + `height:${pct(256)}`}));
        }
      }
    }
    const rings = footprintRings(m.footprint) || [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]];
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${view.toFixed(1)} ${view.toFixed(1)}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', rings.map((ring) => `M${ring.map(([lon, lat]) => {
      const [x, y] = worldPx(lon, lat, z);
      return `${(x - left).toFixed(1)},${(y - top).toFixed(1)}`;
    }).join('L')}Z`).join(''));
    svg.append(path);
    box.append(svg);
    return box;
  }

  // On the platform the session's data opens for the card's key, which the result's _meta brings (PLAN.md 28.30
  // item 3; 24 hours): every request to it carries the key. Off the platform there is none.
  function authed(url) {
    const key = W.shown && W.shown.key;
    return key && W.sid && url.startsWith(`${BASE}/agent/${enc(W.sid)}/`)
      ? `${url}${url.includes('?') ? '&' : '?'}k=${enc(key)}` : url;
  }

  async function fetchJSON(url, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
    url = authed(url);
    try {
      const r = await fetch(url, {cache: 'no-store', ...options, signal: ctrl.signal});
      let body = null;
      try { body = await r.json(); } catch (_) { /* not JSON */ }
      if (!r.ok) throw new Error((body && body.detail) || `HTTP ${r.status}`);
      return body;
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'no answer from the server' : e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  // --- The host: JSON-RPC 2.0 over postMessage ---------------------------------------

  const host = (() => {
    let nextId = 1;
    const pending = new Map();
    const handlers = {};
    const post = (message) => window.parent.postMessage({jsonrpc: '2.0', ...message}, '*');

    function request(method, params, timeoutMs = 15000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: no answer`)); }, timeoutMs);
        pending.set(id, {resolve, reject, timer});
        post({id, method, params});
      });
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const m = event.data;
      if (!m || m.jsonrpc !== '2.0') return;
      if (m.method === undefined) { // an answer to one of ours
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(new Error(m.error.message || 'error')); else p.resolve(m.result || {});
        return;
      }
      const fn = handlers[m.method];
      let result = {};
      try { if (fn) result = fn(m.params || {}) || {}; } catch (e) { console.error(e); }
      if (m.id === undefined) return; // a notification
      if (fn || m.method === 'ping') post({id: m.id, result});
      else post({id: m.id, error: {code: -32601, message: `Method not found: ${m.method}`}});
    });

    return {
      request,
      notify: (method, params) => post({method, params}),
      on: (method, fn) => { handlers[method] = fn; },
    };
  })();

  // --- What the card shows ------------------------------------------------------------

  const W = {
    context: {},       // the host's context: theme, display mode, sizes, the tool
    capabilities: {},  // what the host can do
    hostInfo: {},      // its name and version
    args: null,        // the tool's arguments
    data: null,        // the tool's JSON
    shown: null,       // {tool, sid, run, card} from the result's _meta
    tool: null, sid: null, run: null, card: null,
    state: null, picked: null, sent: new Set(),
    folded: false,     // folded into its head line: the session has a newer card
    opened: false,     // the user opened it again
  };
  let lastTouch = 0;

  function toolName() {
    if (W.shown && W.shown.tool) return W.shown.tool;
    const info = W.context.toolInfo && W.context.toolInfo.tool;
    if (info && info.name) return info.name;
    const d = W.data || {}, a = W.args || {};
    if ('sessions' in d && 'models' in d) return 'list-sessions';
    if (('images' in d && 'models' in d) || 'mosaics' in d) return 'list-images';
    if ('whole' in d && 'area' in d) return 'select-area';
    if ('upload' in d && 'mosaic' in d) return 'upload-image';
    if ('upload_url' in d || 'folder' in d || 'job' in d) return 'add-image';
    if ('scales' in d || ('image' in a && !('sid' in a))) return 'start-session';
    if ('summary' in d || 'summary' in a) return 'finish';
    return 'run';
  }

  // The session ID the pages take: the result's _meta has it; the JSON and the arguments name the session by its
  // handle (s4), so without _meta it comes from the live page's link.
  const FULL_SID = /^[A-Za-z0-9_-]{22}$/;
  function sidOf() {
    if (W.shown && W.shown.sid) return W.shown.sid;
    const link = W.data && typeof W.data.live_url === 'string' && W.data.live_url.match(/\/agent\/([A-Za-z0-9_-]{22})$/);
    if (link) return link[1];
    for (const v of [W.data && W.data.sid, W.args && W.args.sid]) if (typeof v === 'string' && FULL_SID.test(v)) return v;
    return null;
  }

  function bind() {
    // Answers from before PLAN.md 28.30 item 8 name their tool in snake_case (start_session).
    W.tool = String(toolName()).replace(/_/g, '-');
    if (W.tool === 'add-image' || W.tool === 'upload-image') { intake.show(); return; }
    if (W.tool === 'list-images' || W.tool === 'list-sessions' || W.tool === 'list-mosaics') { gallery.show(); return; }
    if (W.tool === 'select-area') { picker.fromResult(); return; }
    W.sid = sidOf();
    W.run = (W.shown && W.shown.run) || (W.tool !== 'start-session' && W.data && W.data.run) || null;
    W.card = (W.shown && W.shown.card) || null; // results from before cards were numbered never fold
    if (cards && W.sid && W.card) cards.postMessage({sid: W.sid, card: W.card});
    if (W.sid) poll.start();
    else if (W.data) message(W.data.error ? `The tool failed: ${W.data.error}` : 'No session to show.');
  }

  function parseResult(result) {
    W.shown = (result._meta && result._meta['mapflow-interactive/widget']) || null;
    if (result.structuredContent) return result.structuredContent;
    const text = (result.content || []).find((c) => c.type === 'text');
    if (!text) return {};
    try { return JSON.parse(text.text); } catch (_) { return result.isError ? {error: text.text} : {}; }
  }

  // The run the map shows: the one clicked, else the card's own (start-session follows the latest run, finish the
  // finished one).
  function shownRun() {
    const runs = (W.state && W.state.runs) || [];
    if (!runs.length) return null;
    const find = (id) => runs.find((r) => r.run === id);
    if (W.picked && find(W.picked)) return find(W.picked);
    if (W.tool === 'finish') {
      const f = W.state.finished;
      return find(W.run) || (f && find(f.run)) || runs[runs.length - 1];
    }
    if (W.tool === 'run' && W.run) return find(W.run) || runs[runs.length - 1];
    return runs[runs.length - 1];
  }

  // --- Polling the demo ---------------------------------------------------------------

  const poll = (() => {
    let timer = null, busy = false, started = false, stopped = false, visible = true;

    async function tick() {
      timer = null;
      if (stopped || !visible) return;
      busy = true;
      try {
        W.state = await fetchJSON(`${BASE}/agent/${enc(W.sid)}/state`);
        message(null);
        render();
      } catch (e) {
        message(`Could not reach the server: ${e.message}. Retrying…`);
      }
      busy = false;
      schedule();
    }

    // A folded card has nothing more to show once its run is done, unless it still owes the model a context update.
    function schedule() {
      if (stopped || timer || busy || !visible) return;
      const running = W.state && W.state.runs.some((r) => r.status === 'running');
      if (W.folded && !running && !(contextOwner && pending().length)) return;
      timer = setTimeout(tick, !W.state || running ? FAST_MS : SLOW_MS);
    }

    // Out of sight (scrolled away in the chat, or the tab hidden), the card stops asking.
    function setVisible(v) {
      visible = v && document.visibilityState !== 'hidden';
      if (!visible && timer) { clearTimeout(timer); timer = null; }
      if (visible && started && !timer && !busy) tick();
    }
    document.addEventListener('visibilitychange', () => setVisible(true));
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting))).observe($('#app'));
    }

    return {
      start() { if (!started) { started = true; tick(); } },
      now() { if (timer) { clearTimeout(timer); timer = null; } if (!busy) tick(); },
      stop() { stopped = true; if (timer) clearTimeout(timer); },
    };
  })();

  // --- The map ------------------------------------------------------------------------

  let map = null, Z = 0, layers = null, runKey = '', outlines = new Map(), imageBounds = null, imageWidth = 0;

  function zoomMax(w, h) { let z = 0; while ((256 << z) < Math.max(w, h)) z++; return z; }
  const unproject = (x, y) => map.unproject([x, y], Z);
  const project = (latlng) => { const p = map.project(latlng, Z); return [p.x, p.y]; };
  const boxBounds = (b) => L.latLngBounds(unproject(b[0], b[3]), unproject(b[2], b[1]));
  const rings = (outline) => outline.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => unproject(x, y))));
  const fullscreen = () => W.context.displayMode === 'fullscreen';

  function ensureMap(info) {
    if (map || !info || !info.width) return;
    Z = zoomMax(info.width, info.height);
    imageWidth = info.width;
    const touch = 'ontouchstart' in window;
    // zoomSnap 0: the fitted view fills the map's width exactly; the buttons still zoom in half steps.
    map = L.map('w-map', {crs: L.CRS.Simple, minZoom: -2, maxZoom: Z + 3, zoomSnap: 0, zoomDelta: 0.5,
                          preferCanvas: true, attributionControl: false, scrollWheelZoom: fullscreen(),
                          dragging: !touch || fullscreen()});
    map._rsTouch = touch;
    const bounds = imageBounds = L.latLngBounds(unproject(0, info.height), unproject(info.width, 0));
    L.tileLayer(authed(`${BASE}/agent/${enc(W.sid)}/view/{z}/{x}/{y}.jpg?v=${info.version}`), {
      tileSize: 256, minZoom: -2, maxZoom: Z + 3, minNativeZoom: 0, maxNativeZoom: Z, bounds, noWrap: true,
    }).addTo(map);
    modeShown = fullscreen();
    fit();
    map.setMaxBounds(bounds.pad(0.5));
    map.on('resize', refit);
    for (const type of ['pointerdown', 'wheel', 'keydown']) {
      map.getContainer().addEventListener(type, () => { autoFit = false; }, {passive: true});
    }
    layers = {aoi: L.layerGroup().addTo(map), runs: L.layerGroup().addTo(map), examples: L.layerGroup().addTo(map),
              marks: L.layerGroup().addTo(map)};
    map.on('click', (e) => {
      const [x, y] = project(e.latlng);
      if (x < 0 || y < 0 || x > info.width || y > info.height) return;
      missedPopup(e.latlng, x, y);
    });
  }

  // Inline, the map shows the image's centre with the image's width filling the card (an aerial image is rarely as
  // wide as the card, so the whole of it would be small); full screen shows the whole image. The map keeps that fit
  // at whatever size the host gives the frame (claude.ai resizes its full-screen panel in steps after answering),
  // until the user zooms or drags; a new display mode fits again.
  let modeShown = null, fitTimer = null, autoFit = true;
  function fit() {
    const width = map.getSize().x;
    if (fullscreen() || !width) map.fitBounds(imageBounds, {animate: false});
    else map.setView(imageBounds.getCenter(), Z + Math.log2(width / imageWidth), {animate: false});
  }
  const refit = () => { if (autoFit) fit(); };
  function applyDisplayMode() {
    document.documentElement.classList.toggle('fullscreen', fullscreen());
    const button = $('#w-full');
    if (button) button.textContent = fullscreen() ? 'Exit full screen' : 'Full screen';
    picker.displayMode();
    if (!map) return;
    if (fullscreen()) { map.scrollWheelZoom.enable(); map.dragging.enable(); } else {
      map.scrollWheelZoom.disable();
      if (map._rsTouch) map.dragging.disable();
    }
    if (modeShown !== null && modeShown !== fullscreen()) autoFit = true;
    modeShown = fullscreen();
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      map.invalidateSize();
      refit();
    }, 100);
  }

  function drawExamples() {
    layers.examples.clearLayers();
    layers.aoi.clearLayers();
    const aoi = W.state.intent.aoi_px;
    if (aoi) {
      L.polygon(aoi.map(([x, y]) => unproject(x, y)), {color: YELLOW, weight: 2, dashArray: '6 6', fill: false,
                                                       interactive: false}).addTo(layers.aoi);
    }
    for (const e of W.state.examples) {
      const style = {color: e.sign > 0 ? BLUE : RED, weight: 3, fill: false, interactive: false};
      if (e.point_px) L.circleMarker(unproject(...e.point_px), {...style, radius: 5}).addTo(layers.examples);
      else if (e.polygon_px) L.polygon(e.polygon_px.map(([x, y]) => unproject(x, y)), style).addTo(layers.examples);
      else if (e.box) L.rectangle(boxBounds(e.box), style).addTo(layers.examples);
    }
  }

  async function drawRun(run) {
    if (!run) { layers.runs.clearLayers(); outlines = new Map(); runKey = ''; return; }
    const key = `${run.run}|${run.status}|${run.count}|${run.tiles_done}`;
    if (key === runKey) return;
    runKey = key;
    let data;
    try {
      data = await fetchJSON(`${BASE}/agent/${enc(W.sid)}/runs/${enc(run.run)}.json`);
    } catch (_) { runKey = ''; return; }
    if (shownRun() && shownRun().run !== run.run) return; // another run was picked meanwhile
    layers.runs.clearLayers();
    outlines = new Map();
    for (const d of data.detections) {
      const options = {color: GREEN, weight: 2, fillOpacity: 0.08, bubblingMouseEvents: false};
      const layer = d.outline ? L.polygon(rings(d.outline), options) : L.rectangle(boxBounds(d.box), options);
      layer.on('click', (e) => detectionPopup(e.latlng, d));
      layer.addTo(layers.runs);
      outlines.set(d.id, layer);
    }
    styleMarked();
    const legend = $('#w-legend');
    legend.hidden = false;
    legend.textContent = `${run.run}: ${data.detections.length} outlines · click one that is wrong, or a missed object`;
  }

  // --- Marks: click-to-correct --------------------------------------------------------

  const marks = () => (W.state && W.state.marks) || [];
  const pending = () => marks().filter((m) => !m.seen);
  const markOf = (detId) => marks().find((m) => m.kind === 'wrong' && m.det === detId);

  function styleMarked() {
    for (const [id, layer] of outlines) {
      const m = markOf(id);
      layer.setStyle(m ? {color: RED, weight: 3, dashArray: '5 4', fillColor: RED, fillOpacity: 0.25}
        : {color: GREEN, weight: 2, dashArray: null, fillColor: GREEN, fillOpacity: 0.08});
    }
    layers.marks.clearLayers();
    for (const m of marks()) {
      if (m.kind === 'missed') {
        const marker = L.circleMarker(unproject(...m.point_px), {radius: 8, color: '#fff', weight: 2, fillColor: ORANGE,
                                                                 fillOpacity: 0.9, bubblingMouseEvents: false});
        marker.bindTooltip(escapeHTML(`${m.id}: missed${m.seen ? ' (the agent has it)' : ''}`));
        marker.on('click', (e) => markPopup(e.latlng, m));
        marker.addTo(layers.marks);
      } else if (!outlines.has(m.det) && m.box) { // a wrong detection of another run: its box
        L.rectangle(boxBounds(m.box), {color: RED, weight: 2, dashArray: '5 4', fill: false, interactive: false})
          .addTo(layers.marks);
      }
    }
  }

  function popup(latlng, ...children) {
    L.popup({closeButton: true, autoPan: true}).setLatLng(latlng).setContent(el('div', {class: 'w-pop'}, ...children))
      .openOn(map);
  }

  function detectionPopup(latlng, d) {
    const m = markOf(d.id);
    const head = el('div', {}, el('b', {text: d.id}), d.score === null ? '' : ` · score ${fmt(d.score)}`);
    if (!m) {
      popup(latlng, head, el('button', {class: 'w-button primary', text: 'Wrong: not what we want',
                                        onclick: () => { map.closePopup(); addMark({kind: 'wrong', det: d.id}); }}));
    } else {
      markPopup(latlng, m, head);
    }
  }

  function missedPopup(latlng, x, y) {
    popup(latlng, el('div', {text: `Image px ${px([x, y])}`}),
      el('button', {class: 'w-button primary', text: 'An object was missed here',
                    onclick: () => { map.closePopup(); addMark({kind: 'missed', x, y, run: (shownRun() || {}).run}); }}));
  }

  function markPopup(latlng, m, head = null) {
    const what = m.kind === 'wrong' ? `${m.det} marked wrong (${m.id})` : `${m.id}: missed at ${px(m.point_px)}`;
    popup(latlng, head, el('div', {text: what}),
      m.seen ? el('div', {class: 'w-hint', text: 'The agent has it; correct it in the chat.'})
        : el('button', {class: 'w-button', text: 'Take back', onclick: () => { map.closePopup(); removeMark(m.id); }}));
  }

  async function addMark(body) {
    status('Saving…');
    try {
      const m = await fetchJSON(`${BASE}/agent/${enc(W.sid)}/marks`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      if (!marks().some((x) => x.id === m.id)) W.state.marks.push(m);
      contextOwner = true;
      status('');
      renderMarks();
      styleMarked();
      updateContext();
    } catch (e) {
      status(`Could not save the mark: ${e.message}`, true);
    }
  }

  async function removeMark(id) {
    try {
      await fetchJSON(`${BASE}/agent/${enc(W.sid)}/marks/${enc(id)}`, {method: 'DELETE'});
      W.state.marks = marks().filter((m) => m.id !== id);
      contextOwner = true;
      status('');
      renderMarks();
      styleMarked();
      updateContext();
    } catch (e) {
      status(`Could not take it back: ${e.message}`, true);
      poll.now();
    }
  }

  // The marks the agent hasn't got, in words for the model.
  function marksText(list) {
    const wrong = list.filter((m) => m.kind === 'wrong').map((m) => m.det);
    const missed = list.filter((m) => m.kind === 'missed').map((m) => px(m.point_px));
    const parts = [];
    if (wrong.length) parts.push(`these detections are wrong: ${wrong.join(', ')}`);
    if (missed.length) parts.push(`objects were missed at image px ${missed.join(', ')}`);
    return parts.join('; ');
  }

  // Each call replaces the model's context from this card, so it always carries every mark the agent hasn't got.
  // Only the card the user marked on sends it (ChatGPT shows each card's context as an attachment), and it clears
  // it once the agent has them.
  let contextKey = '', contextOwner = false;
  function updateContext() {
    if (!contextOwner) return;
    const list = pending();
    const key = list.map((m) => m.id).join(',');
    if (key === contextKey) return;
    contextKey = key;
    const handle = (W.state && W.state.handle) || 'this session';
    const text = list.length ? `On the card of session ${handle} the user marked corrections: ${marksText(list)}. `
      + 'Act on them before going on: − on the wrong ones (set-query add {"source": "<id>", "sign": "-"}); the wand '
      + 'at each missed point (wand include [{"x": .., "y": ..}], image px), then + its selection; then run again.' : '';
    host.request('ui/update-model-context', {content: text ? [{type: 'text', text}] : []}).catch(() => {});
  }

  async function sendToAgent() {
    const list = pending().filter((m) => !W.sent.has(m.id));
    if (!list.length) return;
    const run = shownRun();
    const text = `I marked ${list.length} correction${list.length > 1 ? 's' : ''} on the map`
      + `${run ? ` of ${run.run}` : ''}: ${marksText(list)}. Please take them into account and run again.`;
    try {
      const r = await host.request('ui/message', {role: 'user', content: [{type: 'text', text}]});
      if (r.isError) throw new Error('refused');
      for (const m of list) W.sent.add(m.id);
      // claude.ai puts the message into the chat box for the user to send; ChatGPT sends it.
      status(/claude/i.test((W.hostInfo || {}).name || '') ? 'It is in the chat box: press Send.' : 'Sent to the chat.');
    } catch (e) {
      status(`The chat didn't take it (${e.message}); tell the agent yourself, it also gets the marks with its next `
        + 'tool call.', true);
    }
    renderMarks();
  }

  // --- add-image: the upload link's file picker, in the chat --------------------------
  //
  // Without a source, add-image answers an upload link: the card PUTs the file the user picks or drops to it (CORS lets
  // the sandbox, as on the link's own page), shows the progress, and then hands the chat a message saying what came in
  // (claude.ai puts it into the chat box for the user to send; ChatGPT sends it). The link's page stays the fallback.
  // With a source, the card just says what came in.
  //
  // On Mapflow, upload-image's card (PLAN.md 28.21) takes a GeoTIFF into the user's MyImagery the same way: it checks
  // the file is the one the agent named, has the host renew the link's sign-in (upload-refresh, a tool only the card
  // calls) just before sending, tells the chat once the file is in, and follows MyImagery's checks until it is ready.
  // For a ChatGPT attachment it only follows the upload.

  const intake = (() => {
    const ACCEPT = '.tif,.tiff,.png,.jpg,.jpeg,.webp,image/tiff,image/png,image/jpeg,image/webp';
    const GEOTIFF = '.tif,.tiff,image/tiff';
    const FOLLOW_MS = 3000, FOLLOW_FOR_MS = 15 * 60000;
    let built = false, token = null, maxBytes = 0, busy = false, finished = false, checked = false;
    let expect = {}, confirmed = null, following = false, told = false;
    const myImagery = () => W.tool === 'upload-image';
    const fmtBytes = (n) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20
      ? `${Math.round(n / (1 << 20))} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

    function say(text, kind = '') {
      const line = $('#u-status');
      line.textContent = text;
      line.className = `w-status ${kind}`;
    }

    function build() {
      if (built) return;
      built = true;
      const drop = el('label', {class: 'u-drop', id: 'u-drop', hidden: true},
        el('input', {type: 'file', id: 'u-file', accept: myImagery() ? GEOTIFF : ACCEPT,
                     onchange: (e) => send(e.target.files[0])}),
        el('span', {text: myImagery() ? 'Drop the GeoTIFF here, or' : 'Drop the image here, or'}),
        el('span', {class: 'w-button primary', text: 'Choose a file'}));
      for (const type of ['dragenter', 'dragover']) {
        drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
      }
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      // A file dropped anywhere on the card goes up too, rather than opening in the frame.
      document.addEventListener('dragover', (e) => e.preventDefault());
      document.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        if (token && e.dataTransfer && e.dataTransfer.files.length) send(e.dataTransfer.files[0]);
      });
      $('#app').replaceChildren(el('div', {class: 'w'},
        el('div', {class: 'w-head'},
          el('span', {class: 'w-title', text: myImagery() ? 'A GeoTIFF for your MyImagery' : 'An image for the agent'}),
          el('span', {class: 'w-sub', id: 'u-sub'})),
        drop,
        el('div', {class: 'w-progress', id: 'u-progress', hidden: true},
          el('div', {class: 'w-bar'}, el('div', {class: 'w-fill', id: 'u-fill'})), el('span', {id: 'u-pct'})),
        el('div', {class: 'w-status', id: 'u-status', text: 'Waiting for the agent…'}),
        el('div', {class: 'u-alt', id: 'u-alt', hidden: true}, 'If choosing a file does nothing here, ',
          el('button', {text: 'open the upload page', onclick: () => token && openLink(`${BASE}/agent/upload/${enc(token)}`)}),
          '.')));
    }

    async function show() {
      build();
      const d = W.data, s = W.shown || {};
      if (!d) return;
      if (d.error) { say(`The tool failed: ${d.error}`, 'error'); return; }
      if (myImagery()) { await showMyImagery(d, s); return; }
      token = s.upload || d.upload || null;
      if (!token) { // another source: what came in
        say(d.image ? `${d.image} is in the demo${d.state && d.state !== 'ready' ? ` (${d.state})` : ''}.`
          : d.job ? `A satellite area: job ${d.job}, being fetched.` : 'Done.', 'ok');
        return;
      }
      maxBytes = s.max_bytes || 0;
      $('#u-sub').textContent = `PNG, JPEG, WebP or TIFF${maxBytes ? `, up to ${fmtBytes(maxBytes)}` : ''}`;
      if (checked) return;
      checked = true;
      let link = d;
      try { link = await fetchJSON(`${BASE}/agent/upload/${enc(token)}/status`); } catch (_) { /* as answered */ }
      if (link.state === 'done' && link.image) { done(link.image, null); return; }
      if (link.state === 'expired') { say('This upload link has expired; ask the agent for a new one.', 'error'); return; }
      $('#u-drop').hidden = false;
      $('#u-alt').hidden = false;
      say(link.state === 'receiving' ? 'An upload through this link is in progress.' : '');
    }

    // --- upload-image on Mapflow: into the user's MyImagery ---

    async function showMyImagery(d, s) {
      token = s.upload || d.upload || null;
      if (!token) { say('No upload to show.', 'error'); return; }
      expect = s.expect || d.file || {};
      maxBytes = s.max_bytes || (d.limits && d.limits.max_file_bytes) || 2 * (1 << 30);
      $('#u-sub').textContent = `GeoTIFF, up to ${fmtBytes(maxBytes)}`;
      if (checked) return;
      checked = true;
      let status = d;
      try { status = await fetchJSON(`${BASE}/agent/upload/${enc(token)}/status`); } catch (_) { /* as answered */ }
      if (status.state === 'expired') { say('This upload link has expired; ask the agent for a new one.', 'error'); return; }
      if (status.source === 'attachment' || ['receiving', 'processing', 'ready'].includes(status.state)) {
        follow(status);
        return;
      }
      $('#u-drop').hidden = false;
      $('#u-alt').hidden = false;
      say(status.state === 'failed' ? `${status.error} Drop it again, or another file.`
        : expect.name ? `The agent expects ${expect.name}${expect.size ? ` (${fmtBytes(expect.size)})` : ''}.` : '');
    }

    // Where the upload is: MyImagery checks the file after it came, then it is ready (or failed).
    function follow(status, until = Date.now() + FOLLOW_FOR_MS) {
      const mosaic = status.mosaic && status.mosaic.name ? `the mosaic “${status.mosaic.name}”` : 'a new mosaic';
      $('#u-drop').hidden = true;
      if (!told) $('#u-alt').hidden = true; // what the chat was told stays
      $('#u-progress').hidden = true;
      if (status.state === 'ready') {
        finished = true;
        say(`In your MyImagery${status.existing ? ' already' : ''}, as ${mosaic}.`, 'ok');
        return;
      }
      if (status.state === 'failed') {
        say(status.error || 'The upload failed.', 'error');
        if (status.source === 'link' && status.expires_in_s) { busy = false; $('#u-drop').hidden = false; }
        return;
      }
      say(status.state === 'processing' ? `In MyImagery as ${mosaic}; Mapflow is checking it (a minute or more for a `
        + 'large file).' : status.source === 'attachment' ? 'Uploading the attachment to MyImagery…'
        : 'An upload through this link is in progress.');
      if (following || Date.now() > until) return;
      following = true;
      setTimeout(async () => {
        following = false;
        try { follow(await fetchJSON(`${BASE}/agent/upload/${enc(token)}/status`), until); } catch (_) { follow(status, until); }
      }, FOLLOW_MS);
    }

    // `fileName` is null on a card mounted again after the upload: the chat was told then.
    async function uploaded(status, fileName) {
      follow(status);
      if (!fileName) return;
      const mosaic = status.mosaic || {};
      const text = `I uploaded ${fileName} to my MyImagery: the mosaic “${mosaic.name}” (${mosaic.id}; upload ${token}).`;
      told = true;
      try {
        const r = await host.request('ui/message', {role: 'user', content: [{type: 'text', text}]});
        if (r.isError) throw new Error('refused');
        $('#u-alt').hidden = false;
        $('#u-alt').replaceChildren(/claude/i.test((W.hostInfo || {}).name || '')
          ? 'The message is in the chat box: press Send.' : 'The agent has been told.');
      } catch (_) {
        $('#u-alt').hidden = false;
        $('#u-alt').replaceChildren('Tell the agent in the chat that the file is in.');
      }
    }

    // A file that isn't the one the agent named goes up on the second try only.
    function wrongFile(file) {
      if (!/\.tiff?$/i.test(file.name)) {
        say(`${file.name} is not a GeoTIFF (.tif): MyImagery takes GeoTIFFs only.`, 'error');
        return true;
      }
      if (expect.name && file.name !== expect.name && confirmed !== file.name) {
        confirmed = file.name;
        say(`This is ${file.name}, and the agent expects ${expect.name}. Drop it again to upload it anyway.`, 'error');
        return true;
      }
      return false;
    }

    async function send(file) {
      if (busy || finished || !file || !token) return;
      if (maxBytes && file.size > maxBytes) {
        say(`${file.name} is ${fmtBytes(file.size)}; the limit is ${fmtBytes(maxBytes)}.`, 'error');
        return;
      }
      if (myImagery() && wrongFile(file)) return;
      busy = true;
      if (myImagery()) { // the host signs this call in, so the link holds a fresh sign-in for the file
        say('Getting ready…');
        try { await host.request('tools/call', {name: 'upload-refresh', arguments: {upload: token}}, 20000); } catch (_) {
          /* the link may still hold a valid one; if not, the upload says so */
        }
      }
      $('#u-drop').hidden = true;
      $('#u-progress').hidden = false;
      say(`Uploading ${file.name} (${fmtBytes(file.size)})…`);
      const xhr = new XMLHttpRequest(); // fetch can't report an upload's progress
      xhr.open('PUT', `${BASE}/agent/upload/${enc(token)}?name=${enc(file.name)}`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round(100 * e.loaded / e.total);
        $('#u-fill').style.width = `${pct}%`;
        $('#u-pct').textContent = e.loaded === e.total ? 'checking…' : `${pct}%`;
      };
      const failed = (text) => {
        busy = false;
        $('#u-progress').hidden = true;
        $('#u-drop').hidden = false;
        say(text, 'error');
      };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch (_) { /* not JSON */ }
        if (xhr.status === 201) { if (myImagery()) uploaded(body, file.name); else done(body, file.name); return; }
        failed(body.detail || `The upload failed (HTTP ${xhr.status}).`);
      };
      xhr.onerror = () => failed('The upload failed: no answer from the server.');
      xhr.send(file);
    }

    // `fileName` is null on a card mounted again after the upload: the chat was told then.
    async function done(image, fileName) {
      finished = true;
      $('#u-drop').hidden = true;
      $('#u-alt').hidden = true;
      $('#u-progress').hidden = true;
      const got = `Received as ${image.image}${image.existing ? ' (it was already there)' : ''}.`;
      if (!fileName) { say(got, 'ok'); return; }
      const text = `I uploaded ${fileName}; it is in the demo as ${image.image}.`;
      try {
        const r = await host.request('ui/message', {role: 'user', content: [{type: 'text', text}]});
        if (r.isError) throw new Error('refused');
        say(`${got} ${/claude/i.test((W.hostInfo || {}).name || '') ? 'It is in the chat box: press Send.'
          : 'The agent has been told.'}`, 'ok');
      } catch (_) {
        say(`${got} Tell the agent in the chat.`, 'ok');
      }
    }

    return {show};
  })();

  // --- list-images: the images' thumbnails, for the user ------------------------------
  //
  // The result's _meta carries every image with its thumbnail as a data URL (the card can't fetch /thumb, which is
  // behind the demo's password) and its latest agent session: a click on an image with one opens its live page.
  // Without the _meta the tiles come from the JSON, without pictures. The card never folds.
  //
  // On the platform (PLAN.md 28.22) list-images shows the user's MyImagery: each mosaic, its thumbnail drawn from
  // Mapflow's own map layer, with its images' previews under it (Mapflow's too, no sign-in). A click on a mosaic or an
  // image opens the mosaic's map to pick the area on (the select-area card, `picker`), asking select-area through the
  // host for the images' outlines and whether the whole mosaic fits; an image's extent is the area to start from.
  // list-sessions shows the user's sessions as the demo's images, under their titles.

  const gallery = (() => {
    function progress(img) {
      if (img.state === 'error') return 'error';
      if (img.state !== 'ready') return img.state || '';
      const [done, total] = img.index || [];
      return total && done < total ? `indexing ${Math.floor(100 * done / total)}%` : '';
    }

    function head(title, sub) {
      return el('div', {class: 'w-head'},
        el('span', {class: 'w-title', text: title}),
        el('span', {class: 'w-sub', text: sub}),
        el('div', {class: 'w-actions'},
          el('button', {class: 'w-button', id: 'w-full', text: 'Full screen', hidden: true, onclick: toggleFullscreen})));
    }

    // Before the result, or the tool's failure; null once there is something to show.
    function waiting(d) {
      return !d ? el('div', {class: 'w-status', text: 'Waiting for the agent…'})
        : d.error ? el('div', {class: 'w-status error', text: `The tool failed: ${d.error}`}) : null;
    }

    // An image of the demo, or a session of the platform (its title, its mosaic's name: the JSON's is an object).
    function tile(img) {
      const s = img.session, name = img.title || img.name;
      const mosaic = typeof img.mosaic === 'string' ? img.mosaic : img.mosaic && img.mosaic.name;
      const pic = el('div', {class: 'g-pic'},
        img.thumb ? el('img', {src: img.thumb, alt: name, loading: 'lazy',
                               onerror: (e) => e.target.replaceWith(el('span', {class: 'g-none', text: 'no picture'}))})
          : el('span', {class: 'g-none', text: img.state === 'ready' ? 'no picture' : 'no picture yet'}),
        img.folder === 'agent' ? el('span', {class: 'g-badge', text: 'agent'}) : null);
      const size = img.width ? `${img.width} × ${img.height} px${img.gsd_m ? ` · ${gsdText(img.gsd_m)}` : ''}` : '';
      const state = progress(img);
      const children = [pic, el('div', {class: 'g-name', text: name, title: img.title ? `${name} (${img.name})` : name}),
        mosaic ? el('div', {class: 'g-meta', text: mosaic, title: `Of the mosaic ${mosaic}`}) : null,
        size ? el('div', {class: 'g-meta', text: `${size}${img.georeferenced === false ? ' · no georeference' : ''}`})
          : null,
        img.added ? el('div', {class: 'g-meta', text: `added ${when(img.added)}`}) : null,
        state ? el('div', {class: `g-meta${img.state === 'error' ? ' error' : ''}`, text: state}) : null,
        s ? el('div', {class: 'g-session', text: [`session ${s.handle || ''}`.trim(),
          `${s.runs} run${s.runs === 1 ? '' : 's'}`, s.finished ? 'finished' : null].filter(Boolean).join(' · ')})
          : null];
      if (!s) return el('div', {class: 'g-tile'}, ...children);
      return el('button', {class: 'g-tile link', title: 'Open its session’s live page',
                           onclick: () => openLink(`${BASE}/agent/${enc(s.sid)}`)}, ...children);
    }

    // A MyImagery image: Mapflow's preview, its file's name, size and state. The JSON's (no _meta) have no preview
    // and no extent, so they open nothing.
    function imageTile(m, img) {
      const name = img.name || img.filename, state = (img.state || '').toUpperCase();
      const size = [img.width ? `${img.width} × ${img.height} px` : null, img.gsd_m ? gsdText(img.gsd_m) : null]
        .filter(Boolean).join(' · ');
      const children = [
        el('div', {class: 'g-pic'},
          img.preview ? el('img', {src: img.preview, alt: name, loading: 'lazy',
                                   onerror: (e) => e.target.replaceWith(el('span', {class: 'g-none', text: 'no preview'}))})
            : el('span', {class: 'g-none', text: 'no preview'})),
        el('div', {class: 'g-name', text: name, title: name}),
        size ? el('div', {class: 'g-meta', text: size}) : null,
        state && state !== 'READY' ? el('div', {class: `g-meta${state === 'FAILED' ? ' error' : ''}`,
                                                 text: state.toLowerCase().replace(/_/g, ' ')}) : null];
      if (!img.bounds) return el('div', {class: 'g-tile'}, ...children);
      return el('button', {class: 'g-tile link', title: 'Pick the area to work on in this image',
                           onclick: () => openMosaic(m, img)}, ...children);
    }

    // A mosaic: its map's thumbnail, name and size, and its images under it.
    function mosaicSection(m) {
      const images = m.images, total = m.images_total || (images ? images.length : 0);
      const open = () => openMosaic(m);
      return el('section', {class: 'g-mosaic'},
        el('div', {class: 'g-mosaic-head'},
          el('button', {class: 'g-mosaic-pic', title: 'Pick the area to work on in this mosaic', onclick: open},
            mosaicThumb(m)),
          el('div', {class: 'g-mosaic-text'},
            el('div', {class: 'g-name', text: m.name, title: m.name}),
            el('div', {class: 'g-meta', text: [plural(total, 'image'), m.created ? `added ${when(m.created)}` : null]
              .filter(Boolean).join(' · ')})),
          el('button', {class: 'w-button', text: 'Pick area', title: 'Pick the area to work on in this mosaic',
                        onclick: open})),
        m.images_error ? el('div', {class: 'w-status error', text: `Its images can’t be listed: ${m.images_error}`})
          : !images ? null
            : !images.length ? el('div', {class: 'w-status', text: 'No images in it.'})
              : el('div', {class: 'g-grid'}, images.map((i) => imageTile(m, i))),
        images && total > images.length
          ? el('p', {class: 'w-hint', text: `${plural(total - images.length, 'more image')} not shown here.`}) : null);
    }

    // The mosaic's map; with `image`, its extent is the area to start from.
    async function openMosaic(m, image = null) {
      const d = W.data || {}, s = W.shown || {};
      const key = picker.show({mosaic: m, images: [], area: null, check: null, focus: image,
                               max_tiles: s.max_tiles || d.max_tiles}, showImagery, true);
      let r;
      try {
        r = await host.request('tools/call', {name: 'select-area', arguments: {mosaic: m.id}}, CALL_MS);
      } catch (_) {
        picker.more(key, null); // this chat doesn't let the card call tools: the user draws, the agent checks
        return;
      }
      const meta = r._meta && r._meta['mapflow-interactive/widget'];
      picker.more(key, meta && meta.mosaic ? meta : callData(r));
    }

    // list-images on the platform: the user's MyImagery.
    function showImagery() {
      const d = W.data, s = W.shown || {};
      const mosaics = 'mosaics' in s ? s.mosaics : d ? d.mosaics : undefined; // the JSON's have no map layers
      const failed = d && !d.error && !mosaics ? s.mosaics_error || d.mosaics_error || 'Mapflow didn’t list them' : null;
      const images = (mosaics || []).reduce((n, m) => n + (m.images_total || (m.images ? m.images.length : 0)), 0);
      const sub = !d || d.error || !mosaics ? '' : [plural(mosaics.length, 'mosaic'),
        images ? plural(images, 'image') : null].filter(Boolean).join(' · ');
      $('#app').replaceChildren(el('div', {class: 'w g'},
        head('Your MyImagery', sub),
        waiting(d) || (failed ? el('div', {class: 'w-status error', text: `Your mosaics can’t be listed: ${failed}`})
          : !mosaics.length ? el('div', {class: 'w-status', text: 'No mosaics in your MyImagery yet: give the agent a '
            + 'GeoTIFF to upload, or upload imagery on Mapflow.'})
            : el('div', {class: 'g-list', id: 'g-grid'}, mosaics.map(mosaicSection))),
        mosaics && mosaics.length
          ? el('p', {class: 'w-hint', text: 'Click an image or a mosaic to pick the area to work on.'}) : null));
      applyContext();
    }

    // list-sessions on the platform: the user's sessions, each a mosaic cut to an area.
    function showSessions() {
      const d = W.data;
      const sessions = (W.shown && W.shown.images) || (d && d.sessions) || [];
      const hint = !d || d.error || !sessions.length ? null : [
        sessions.some((i) => i.session) ? 'Click a session an agent worked on to open its live page.' : null,
        'Tell the agent which session to work on.'].filter(Boolean).join(' ');
      $('#app').replaceChildren(el('div', {class: 'w g'},
        head('Your sessions', !d || d.error ? '' : plural(sessions.length, 'session')),
        waiting(d) || (!sessions.length ? el('div', {class: 'w-status', text: 'No sessions yet: pick the area of one '
          + 'of your mosaics to make one.'})
          : el('div', {class: 'g-grid', id: 'g-grid'}, sessions.map(tile))),
        hint ? el('p', {class: 'w-hint', text: hint}) : null));
      applyContext();
    }

    // The platform MCP's list-mosaics, which this card is attached to (PLAN.md 28.29, the manifest's `attach`): its
    // answer is a page of the user's mosaics without their images, so the card asks list-images, through the host, for
    // those mosaics' images and previews and shows them as list-images' card does. Without tool calls here, the
    // mosaics alone.
    let askedFor = null;
    async function showMosaics() {
      const d = W.data, items = d && Array.isArray(d.items) ? d.items : [];
      if (!d || d.error) { showImagery(); return; }
      const ids = items.map((m) => m && m.id).filter((id) => typeof id === 'string').slice(0, 50);
      const key = ids.join(',');
      if (askedFor === key && W.shown && 'mosaics' in W.shown) { showImagery(); return; }
      askedFor = key;
      const bare = items.filter((m) => m && typeof m.id === 'string')
        .map((m) => ({id: m.id, name: m.name, created: m.created_at, images: null}));
      W.shown = {tool: 'list-mosaics', mosaics: bare};
      showImagery();
      if (!ids.length) return;
      let r;
      try {
        r = await host.request('tools/call', {name: 'list-images', arguments: {mosaics: ids}}, CALL_MS);
      } catch (_) {
        return; // the mosaics stay, without their images
      }
      if (askedFor !== key) return; // a newer answer came meanwhile
      const meta = r && r._meta && r._meta['mapflow-interactive/widget'];
      if (meta && Array.isArray(meta.mosaics)) W.shown = {...meta, tool: 'list-mosaics'};
      showImagery();
    }

    function show() {
      if (PLATFORM) {
        if (W.tool === 'list-sessions') showSessions();
        else if (W.tool === 'list-mosaics') showMosaics();
        else showImagery();
        return;
      }
      const d = W.data, folder = (W.args || {}).folder;
      const title = folder === 'agent' ? 'Images agents brought in'
        : folder === 'images' ? 'The gallery’s images' : 'Images in the demo';
      const images = (W.shown && W.shown.images) || (d && d.images) || [];
      const fromAgents = images.filter((i) => i.folder === 'agent').length;
      const sub = !d ? '' : [`${images.length} image${images.length === 1 ? '' : 's'}`,
        fromAgents && fromAgents < images.length ? `${fromAgents} from agents` : null].filter(Boolean).join(' · ');
      const pictures = images.filter((i) => i.thumb).length;
      const hint = !d || d.error || !images.length ? null : [
        images.some((i) => i.session) ? 'Click an image with a session to open its live page.' : null,
        'Tell the agent which image to work on.',
        W.shown && pictures < images.filter((i) => i.state === 'ready').length
          ? 'Some have no picture here: ask the agent to list one folder.' : null].filter(Boolean).join(' ');
      $('#app').replaceChildren(el('div', {class: 'w g'},
        head(title, sub),
        waiting(d) || (!images.length ? el('div', {class: 'w-status', text: folder === 'agent'
          ? 'No images from agents yet.' : 'No images yet.'})
          : el('div', {class: 'g-grid', id: 'g-grid'}, images.map(tile))),
        hint ? el('p', {class: 'w-hint', text: hint}) : null));
      applyContext();
    }

    return {show};
  })();

  // --- select-area: a mosaic's map, to pick a session's area on (PLAN.md 28.21) -------
  //
  // Mapflow's own map layer of the mosaic (its tiles need no sign-in; the card's CSP names their host), the mosaic's
  // and its images' outlines, and the area: the whole mosaic when a session of it fits the tile cap at ×1, else the
  // user drags a rectangle. Each area is checked through the host (check-area, a tool only the card calls), as the
  // page checks it; a chat that doesn't let the card call tools leaves the check to the agent. "Use this area" writes
  // the mosaic and the area into the chat, and the agent makes the session (add-image). Opened for an image of
  // list-images' card (PLAN.md 28.22), the map shows that image, and its extent is the area when it fits likewise.

  const picker = (() => {
    const AREA = {color: YELLOW, weight: 2, fillOpacity: 0.08, interactive: false};
    const OUTLINE = {color: CYAN, weight: 1.5, fill: false, interactive: false};
    const IMAGE = {color: CYAN, weight: 1, opacity: 0.7, dashArray: '4 4', fill: false, interactive: false};
    const FOCUS = {color: CYAN, weight: 2.5, fill: false, interactive: false};
    const SCALES = [['0.25', '÷4'], ['0.5', '÷2'], ['1', '×1'], ['2', '×2'], ['4', '×4']];
    // As the page words them (app.js).
    const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
    const fmtKm2 = (a) => (a < 0.01 ? `${fmtInt(a * 1e6)} m²`
      : `${a.toLocaleString('en-US', {maximumSignificantDigits: a < 1000 ? 3 : 21, maximumFractionDigits: 3})} km²`);
    const fmtGsd = (m) => `${m >= 10 ? fmtInt(m) : m.toPrecision(2)} m/px`;
    // Degrees to 6 decimals (10 cm), outwards: what the chat is told is what was checked.
    const outwards = (b) => [Math.floor(b[0] * 1e6) / 1e6, Math.floor(b[1] * 1e6) / 1e6, Math.ceil(b[2] * 1e6) / 1e6,
                             Math.ceil(b[3] * 1e6) / 1e6];
    let amap = null, rect = null, imageLayer = null, drawing = false, loaded = 0, failed = 0;
    let home = null, moved = false; // the mosaic's bounds, fitted again on a new display mode until the user moves
    let P = null, key = 0, aoi = null, verdict = null, checks = 0, canCheck = true, shownFor = null;

    // The card of select-area: its _meta, else its JSON (no map layer then, only the mosaic's bounds).
    function fromResult() {
      const d = W.data, s = W.shown || {};
      if (!d || d.error) {
        teardown();
        shownFor = null;
        $('#app').replaceChildren(el('div', {class: 'w'},
          el('div', {class: 'w-head'}, el('span', {class: 'w-title', text: BRAND}),
            el('span', {class: 'w-sub', text: 'the area to work on'})),
          el('div', {class: `w-status${d ? ' error' : ''}`, text: d ? `The tool failed: ${d.error}`
            : 'Waiting for the agent…'})));
        return;
      }
      if (shownFor === d) return;
      shownFor = d;
      show(s.mosaic ? s : {mosaic: d.mosaic, images: [], area: d.area, check: d.whole, max_tiles: d.max_tiles});
    }

    // `back` returns to list-images' card; `pending`: the rest comes with `more`; `p.focus`, an image of that card,
    // whose extent to start from. The key names this showing.
    function show(p, back = null, pending = false) {
      teardown();
      P = {...p};
      key++;
      aoi = verdict = null;
      checks++;
      loaded = failed = 0;
      drawing = false;
      $('#app').replaceChildren(el('div', {class: 'w a'},
        el('div', {class: 'w-head'},
          back ? el('button', {class: 'w-button', text: '← MyImagery', title: 'Back to your MyImagery',
                               onclick: () => { teardown(); back(); }}) : null,
          el('span', {class: 'w-title', text: P.mosaic.name, title: P.mosaic.name}),
          el('span', {class: 'w-sub', text: P.focus ? `${P.focus.name} · the area to work on` : 'the area to work on'}),
          el('div', {class: 'w-actions'},
            el('button', {class: 'w-button', id: 'a-draw', text: 'Draw area', title: 'Then drag a rectangle on the map',
                          onclick: () => setDrawing(!drawing)}),
            el('button', {class: 'w-button', id: 'w-full', text: 'Full screen', hidden: true, onclick: toggleFullscreen}))),
        el('div', {class: 'w-map-wrap'},
          el('div', {class: 'w-map', id: 'a-map'}),
          el('div', {class: 'w-message', id: 'a-message', hidden: true}),
          el('div', {class: 'w-legend', id: 'a-legend', hidden: true})),
        el('div', {class: 'a-verdict', id: 'a-verdict'}),
        el('div', {class: 'w-send'},
          el('button', {class: 'w-button primary', id: 'a-use', text: 'Use this area', disabled: true, onclick: use}),
          el('span', {class: 'w-status', id: 'a-status'}))));
      applyContext();
      buildMap();
      if (pending) say('Loading the mosaic…', 'muted'); else begin();
      return key;
    }

    // select-area's answer for a mosaic opened from the grid (null: the card can't call tools here).
    function more(k, p) {
      if (k !== key || !amap) return; // the user went back meanwhile
      if (!p) canCheck = false;
      else if (p.error) note(p.error);
      else {
        if (p.mosaic && p.mosaic.tile_url && !P.mosaic.tile_url) P.mosaic = p.mosaic;
        if (p.images && p.images.some((i) => i.footprint)) P.images = p.images;
        P.area = p.area || null;
        P.check = p.check || p.whole || null;
        P.max_tiles = p.max_tiles || P.max_tiles;
        drawImages();
      }
      begin();
    }

    // The area to start from: the image's extent or the whole mosaic when it fits, else the user draws.
    function begin() {
      if (P.focus) focus();
      else if (P.area) setArea(P.area, P.check);
      else setDrawing(true);
    }

    // The image's extent, checked first: a session of it that takes more tiles at ×1 than one may has the user draw,
    // told why, as the whole mosaic's does. Unchecked (no tools/call here) it is the area, and the agent checks it.
    async function focus() {
      const k = key, b = P.focus.bounds;
      say('Checking the image…', 'muted');
      const v = canCheck ? await checked(b) : null;
      if (k !== key || !amap) return; // the user went back meanwhile
      const cap = P.max_tiles || (v && v.max_tiles);
      if (v && v.ok && v.tiles && cap && v.tiles['1'] > cap) {
        P.check = v;
        P.what = 'image';
        setDrawing(true);
        return;
      }
      setArea(b, v);
    }

    function buildMap() {
      const m = P.mosaic, touch = 'ontouchstart' in window;
      amap = L.map('a-map', {zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 1, maxZoom: 22, boxZoom: false,
                             attributionControl: false, worldCopyJump: true, scrollWheelZoom: fullscreen(),
                             dragging: !touch || fullscreen()});
      amap._rsTouch = touch;
      if (m.tile_url) {
        const layer = L.tileLayer(m.tile_url, {maxZoom: 22});
        layer.on('tileload', () => { loaded++; tilesNote(); });
        layer.on('tileerror', () => { failed++; tilesNote(); });
        layer.addTo(amap);
      } else {
        note('Only the mosaic’s outline: this chat didn’t pass its map.');
      }
      const b = m.bounds;
      const outline = m.footprint ? L.geoJSON(m.footprint, {style: OUTLINE})
        : b ? L.rectangle(L.latLngBounds([b[1], b[0]], [b[3], b[2]]), OUTLINE) : null;
      imageLayer = L.layerGroup().addTo(amap);
      const f = P.focus && P.focus.bounds;
      home = f ? L.latLngBounds([f[1], f[0]], [f[3], f[2]]) : outline ? outline.getBounds() : null;
      moved = false;
      if (outline) outline.addTo(amap);
      if (home) amap.fitBounds(home, {padding: [16, 16], animate: false}); else amap.setView([20, 0], 2);
      const c = amap.getContainer();
      c.addEventListener('wheel', () => { if (fullscreen()) moved = true; }, {passive: true}); // inline it scrolls the chat
      for (const type of ['keydown', 'dblclick']) c.addEventListener(type, () => { moved = true; });
      c.addEventListener('pointerdown', (e) => { if (e.target.closest('.leaflet-control')) moved = true; });
      amap.on('dragstart', () => { moved = true; });
      drawImages();
      enableDrawing();
    }

    function drawImages() {
      if (!imageLayer) return;
      imageLayer.clearLayers();
      const focused = P.focus && P.focus.name;
      for (const i of P.images || []) {
        if (i.footprint) {
          L.geoJSON(i.footprint, {style: i.name === focused ? FOCUS : IMAGE}).bindTooltip(escapeHTML(i.name), {sticky: true})
            .addTo(imageLayer);
        }
      }
    }

    function tilesNote() {
      if (loaded || failed < 2) { if (loaded) note(null); return; }
      note('The mosaic’s map doesn’t load here; its outline shows where it is.');
    }

    function note(text) {
      const box = $('#a-message');
      if (!box) return;
      box.hidden = !text;
      if (text) box.textContent = text;
    }

    function say(text, kind = '') {
      const box = $('#a-verdict');
      box.textContent = text;
      box.className = `a-verdict ${kind}`;
    }

    function said(text, kind = '') {
      const line = $('#a-status');
      line.textContent = text;
      line.className = `w-status ${kind}`;
    }

    function setDrawing(on) {
      drawing = on && !!amap;
      const button = $('#a-draw');
      button.classList.toggle('active', drawing);
      button.textContent = drawing ? 'Drawing…' : aoi ? 'Redraw area' : 'Draw area';
      amap.getContainer().classList.toggle('drawing', drawing);
      if (drawing) amap.dragging.disable(); else if (!amap._rsTouch || fullscreen()) amap.dragging.enable();
      const legend = $('#a-legend');
      legend.hidden = !drawing;
      legend.textContent = 'Drag a rectangle over the area to work on';
      showVerdict();
    }

    // Pointer events, so that a finger draws too; the map doesn't pan meanwhile.
    function enableDrawing() {
      const c = amap.getContainer();
      let start = null, last = null, draft = null;
      c.addEventListener('pointerdown', (e) => {
        if (!drawing || e.button !== 0 || e.target.closest('.leaflet-control')) return;
        e.preventDefault();
        c.setPointerCapture(e.pointerId);
        start = last = amap.mouseEventToLatLng(e);
        draft = L.rectangle(L.latLngBounds(start, start), {...AREA, dashArray: '5 4'}).addTo(amap);
      });
      c.addEventListener('pointermove', (e) => {
        if (!start) return;
        last = amap.mouseEventToLatLng(e);
        draft.setBounds(L.latLngBounds(start, last));
      });
      const finish = () => {
        if (!start) return;
        const a = amap.latLngToContainerPoint(start), b = amap.latLngToContainerPoint(last);
        const bounds = L.latLngBounds(start, last);
        start = null;
        draft.remove();
        draft = null;
        setDrawing(false);
        if (Math.abs(a.x - b.x) < 4 || Math.abs(a.y - b.y) < 4) return; // a click, not an area
        const w = L.Util.wrapNum(bounds.getWest(), [-180, 180], true);
        setArea([w, bounds.getSouth(), w + bounds.getEast() - bounds.getWest(), bounds.getNorth()]);
      };
      c.addEventListener('pointerup', finish);
      c.addEventListener('pointercancel', finish);
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawing) setDrawing(false); });

    // `given`: the area's check came with it (select-area's of the whole mosaic).
    function setArea(b, given = null) {
      aoi = outwards(b);
      const ll = L.latLngBounds([aoi[1], aoi[0]], [aoi[3], aoi[2]]);
      if (rect) rect.setBounds(ll); else rect = L.rectangle(ll, AREA).addTo(amap);
      $('#a-draw').textContent = 'Redraw area';
      said('');
      if (!given) { check(); return; }
      checks++;
      verdict = given;
      showVerdict();
      update();
    }

    async function check() {
      const seq = ++checks;
      verdict = null;
      showVerdict();
      update();
      if (!canCheck) return;
      const d = await checked(aoi);
      if (seq !== checks) return;
      verdict = d; // null: the agent checks the area
      showVerdict();
      update();
    }

    // check-area's answer for an area through the host ({ok: false, problem} when it failed), or null when this chat
    // doesn't let the card call tools.
    async function checked(b) {
      let r;
      try {
        r = await host.request('tools/call', {name: 'check-area', arguments: {mosaic: P.mosaic.id, aoi: b}}, CALL_MS);
      } catch (_) {
        canCheck = false;
        return null;
      }
      const d = callData(r);
      return d.error ? {ok: false, problem: d.error} : d;
    }

    function showVerdict() {
      const r = verdict, whole = P.check, cap = P.max_tiles || (r && r.max_tiles);
      if (!aoi) {
        const tiles = whole && whole.tiles && whole.tiles['1'];
        say(tiles && cap && tiles > cap ? `The whole ${P.what || 'mosaic'} takes ${fmtInt(tiles)} tiles at ×1, and a `
          + `session at most ${fmtInt(cap)}: drag a rectangle over the part to work on.`
          : drawing ? 'Drag a rectangle over the part of the mosaic to work on.'
            : 'Press Draw area and drag a rectangle over the part of the mosaic to work on.', 'muted');
        return;
      }
      if (!r) {
        say(canCheck ? 'Checking the area…' : 'This chat doesn’t let the card check the area: the agent checks it when '
          + 'you use it.', 'muted');
        return;
      }
      if (!r.width) { say(r.problem || 'The area can’t be checked.', 'error'); return; }
      const tiles = SCALES.filter(([k]) => r.tiles && k in r.tiles).map(([k, label]) => `${label} ${fmtInt(r.tiles[k])}`)
        .join(', ');
      const parts = [`${fmtInt(r.width)} × ${fmtInt(r.height)} px`];
      if (r.area_km2 !== undefined && r.area_km2 !== null) parts.push(fmtKm2(r.area_km2));
      if (r.gsd_m) parts.push(fmtGsd(r.gsd_m));
      if (r.images) parts.push(plural(r.images.length, 'image'));
      let text = `${parts.join(' · ')}. Tiles: ${tiles}${cap ? ` (at most ${fmtInt(cap)} at the resolution a prompt `
        + 'runs at)' : ''}.`;
      if (r.left_out && r.left_out.length) text += ` Left out: ${r.left_out.map((o) => `${o.image} (${o.why})`).join('; ')}.`;
      say(r.ok ? text : `${text} ${r.problem}`, r.ok ? '' : 'error');
    }

    function update() {
      $('#a-use').disabled = !aoi || (verdict ? verdict.ok === false : canCheck);
    }

    // Into the chat as the user's message (claude.ai puts it into the chat box; ChatGPT sends it), and into the
    // model's context, should the message not go.
    async function use() {
      if (!aoi) return;
      const m = P.mosaic, box = `[${aoi.join(', ')}]`;
      const size = verdict && verdict.ok ? `, ${fmtInt(verdict.width)} × ${fmtInt(verdict.height)} px` : '';
      const text = `Please work on this area of my mosaic “${m.name}” (mosaic ${m.id}): ${box} (west, south, east, `
        + `north in degrees${size}).`;
      host.request('ui/update-model-context', {content: [{type: 'text', text: 'On the map card the user picked the '
        + `area to work on: the mosaic ${m.id}, aoi ${box}. Make its session with add-image(mosaic, aoi).`}]})
        .catch(() => {});
      try {
        const r = await host.request('ui/message', {role: 'user', content: [{type: 'text', text}]});
        if (r.isError) throw new Error('refused');
        said(/claude/i.test((W.hostInfo || {}).name || '') ? 'It is in the chat box: press Send.' : 'Sent to the chat.',
             'ok');
      } catch (_) {
        said(`The chat didn’t take it; tell the agent: ${text}`, 'error');
      }
    }

    function teardown() {
      if (amap) amap.remove();
      amap = rect = imageLayer = null;
    }

    // Full screen: the wheel zooms and the map pans; inline they leave the chat's scrolling alone.
    function displayMode() {
      if (!amap) return;
      if (fullscreen()) {
        amap.scrollWheelZoom.enable();
        if (!drawing) amap.dragging.enable();
      } else {
        amap.scrollWheelZoom.disable();
        if (amap._rsTouch) amap.dragging.disable();
      }
      setTimeout(() => {
        if (!amap) return;
        amap.invalidateSize();
        if (home && !moved) amap.fitBounds(home, {padding: [16, 16], animate: false});
      }, 100);
    }

    return {fromResult, show, more, displayMode};
  })();

  // --- Rendering ----------------------------------------------------------------------

  function message(text) {
    const box = $('#w-message');
    if (!box) return; // the upload card
    box.hidden = !text;
    if (text) box.textContent = text;
  }

  function status(text, error = false) {
    const line = $('#w-status-line');
    line.textContent = text;
    line.classList.toggle('error', error);
  }

  function queryLine(q) {
    if (!q) return '';
    const pos = q.examples.filter((e) => e.sign === '+').length, neg = q.examples.length - pos;
    const parts = [q.texts.length ? q.texts.map((t) => `“${t}”`).join(', ') : 'no text'];
    if (q.examples.length) parts.push(`examples +${pos}${neg ? ` −${neg}` : ''}`);
    parts.push(scaleText(q.scale));
    return parts.join(' · ');
  }

  function renderRun(run) {
    const box = $('#w-run');
    const runs = W.state.runs;
    if (!run) {
      box.replaceChildren(el('div', {class: 'w-run-query', text: W.state.intent.text
        ? `Intent: ${W.state.intent.text}` : 'No run yet: the agent is getting ready.'}));
      return;
    }
    const last = runs[runs.length - 1];
    const done = run.tiles_total ? run.tiles_done / run.tiles_total : 0;
    const inAoi = run.count_in_aoi !== null && run.count_in_aoi !== undefined ? ` (${run.count_in_aoi} in the area)` : '';
    box.replaceChildren(...[
      el('div', {class: 'w-run-line'}, el('b', {text: run.run}),
        el('span', {text: `${run.count} objects${inAoi}`}),
        run.threshold !== null ? el('span', {class: 'w-run-query', text: `score ≥ ${fmt(run.threshold)}`}) : null,
        el('span', {class: 'w-run-query', text: queryLine(run.query)})),
      run.note ? el('div', {class: 'w-note', text: run.note}) : null,
      run.status === 'running' ? el('div', {class: 'w-progress'},
        el('div', {class: 'w-bar'}, el('div', {class: 'w-fill', style: `width:${Math.round(done * 100)}%`})),
        el('span', {text: run.waiting_for ? `waiting for ${run.waiting_for}`
          : `${run.tiles_done}/${run.tiles_total} tiles`})) : null,
      run.error ? el('div', {class: 'w-status error', text: run.error}) : null,
      last && last.run !== run.run ? el('div', {class: 'w-newer'}, `${last.run} is newer. `,
        el('button', {text: `Show ${last.run}`, onclick: () => { W.picked = last.run; render(); }})) : null,
      W.picked && W.picked !== (W.run || last.run) ? el('div', {class: 'w-newer'},
        el('button', {text: 'Back to this card’s run', onclick: () => { W.picked = null; render(); }})) : null,
    ].filter(Boolean));
  }

  function renderFinished(run) {
    const box = $('#w-finished');
    const f = W.state.finished;
    box.hidden = !f || !run || f.run !== run.run;
    if (box.hidden) return;
    const base = `${BASE}/agent/${enc(W.sid)}/export/${enc(f.run)}`;
    const links = [['pixels.geojson', 'GeoJSON (pixels)'], ['mask.png', 'Mask PNG'], ['csv', 'CSV']];
    if (W.state.image_info.georeferenced) links.unshift(['geojson', 'GeoJSON']);
    box.replaceChildren(el('p', {class: 'w-summary', text: f.summary}),
      el('div', {class: 'w-links'}, links.map(([ext, label]) => el('button', {class: 'w-button', text: label,
                                                                            onclick: () => openLink(authed(`${base}.${ext}`))}))));
  }

  function renderMarks() {
    const list = marks().slice(-MAX_MARKS_SHOWN);
    $('#w-mark-list').replaceChildren(...list.map((m) => el('span', {class: `w-mark ${m.kind}`},
      m.kind === 'wrong' ? `✕ ${m.det} wrong` : `+ missed ${px(m.point_px)}`,
      el('span', {class: `w-mark-state${m.seen ? ' seen' : ''}`,
                  text: m.seen ? '✓ agent has it' : W.sent.has(m.id) ? 'sent' : 'new'}),
      m.seen ? null : el('button', {title: 'Take back', text: '×', onclick: () => removeMark(m.id)}))));
    const unsent = pending().filter((m) => !W.sent.has(m.id)).length;
    const send = $('#w-send');
    send.disabled = !unsent;
    send.textContent = unsent ? `Send ${unsent} to the agent` : 'Send to the agent';
  }

  // --- Folding: one open map in the chat ---------------------------------------------
  //
  // A card folds when its session has a newer card, unless the user opened it again or worked in it a moment ago
  // (then it folds at a later poll). Folded, it keeps its head line with the run in brief.

  const superseded = () => !!(W.card && W.state && W.state.cards > W.card);

  // A connector's cards share an origin, so a new card tells the older ones of its session at once (claude.ai's
  // docs suggest this, "instance supersession"); the polled state is the fallback, e.g. for a reopened chat.
  const cards = (() => { try { return new BroadcastChannel('mapflow-interactive-cards'); } catch (_) { return null; } })();
  if (cards) {
    cards.onmessage = (e) => {
      const m = e.data || {};
      if (m.sid !== W.sid || !W.card || !(m.card > W.card) || !W.state) return;
      W.state.cards = Math.max(W.state.cards || 0, m.card);
      render();
    };
  }

  function foldSummary(run) {
    if (!run) return W.state.intent.text ? `Intent: ${W.state.intent.text}` : 'no run yet';
    return [`${run.count} objects`, queryLine(run.query), run.note].filter(Boolean).join(' · ');
  }

  function setFolded(folded) {
    W.folded = folded;
    W.opened = !folded;
    render();
    if (folded) return;
    if (map) setTimeout(() => { map.invalidateSize(); refit(); }, 0);
    poll.now();
  }

  function render() {
    const s = W.state;
    if (!W.folded && !W.opened && superseded() && Date.now() - lastTouch > TOUCH_MS) W.folded = true;
    $('.w').classList.toggle('folded', W.folded);
    $('#w-fold').hidden = W.folded || !superseded();
    const run = shownRun();
    $('#w-title').textContent = s.image;
    const what = W.tool === 'start-session' ? 'session' : W.tool;
    $('#w-sub').textContent = PLATFORM ? what : `${s.model} · ${what}`; // the model's key ("sam3") isn't for users
    const pill = $('#w-status');
    pill.className = `w-pill ${!run ? '' : run.status === 'ready' ? 'done' : run.status === 'failed' ? 'error' : 'partial'}`;
    pill.textContent = s.finished && run && s.finished.run === run.run ? 'finished'
      : !run ? 'getting ready' : `${run.run}: ${run.status}`;
    $('#w-fold-sum').textContent = W.folded ? foldSummary(run) : '';
    if (W.folded) { updateContext(); return; }
    ensureMap(s.image_info);
    renderRun(run);
    renderFinished(run);
    renderMarks();
    if (map) {
      drawExamples();
      drawRun(run);
      styleMarked();
    } else if (s.image_info.state !== 'ready') {
      message(`The image is ${s.image_info.state || 'not ready'}…`);
    }
    updateContext();
  }

  function openLink(url) {
    host.request('ui/open-link', {url}).catch(() => window.open(url, '_blank', 'noopener'));
  }

  // --- The host's context: theme, styles, display mode, size --------------------------

  function applyContext() {
    const ctx = W.context;
    const root = document.documentElement;
    if (ctx.theme) root.dataset.theme = ctx.theme;
    const styles = ctx.styles || {};
    for (const [k, v] of Object.entries(styles.variables || {})) if (v) root.style.setProperty(k, v);
    if (styles.css && styles.css.fonts && !$('#w-fonts')) {
      document.head.append(el('style', {id: 'w-fonts', text: styles.css.fonts}));
    }
    // ChatGPT draws its own display-mode buttons; claude.ai leaves them to the app.
    const modes = ctx.availableDisplayModes || [];
    const full = $('#w-full'), wrap = $('.w-map-wrap'), grid = $('#g-grid'); // no map on the upload card or gallery
    if (full) full.hidden = !modes.includes('fullscreen') || 'openai' in window;
    const dims = ctx.containerDimensions || {};
    const limit = dims.height || dims.maxHeight;
    if (limit && !fullscreen() && wrap) wrap.style.height = `${Math.max(200, Math.min(340, limit - 190))}px`;
    if (grid) grid.style.maxHeight = limit && !fullscreen() ? `${Math.max(200, Math.min(560, limit - 110))}px` : '';
    applyDisplayMode();
  }

  async function toggleFullscreen() {
    const mode = fullscreen() ? 'inline' : 'fullscreen';
    try {
      const r = await host.request('ui/request-display-mode', {mode});
      W.context.displayMode = r.mode || mode;
    } catch (_) { return; }
    applyContext();
  }

  // As the ext-apps SDK measures it: the content's height (html at max-content) and the window's width.
  function reportSize() {
    let last = '', queued = false;
    const send = () => {
      queued = false;
      const html = document.documentElement;
      const before = html.style.height;
      html.style.height = 'max-content';
      const height = Math.ceil(html.getBoundingClientRect().height);
      html.style.height = before;
      const size = {width: Math.ceil(window.innerWidth), height};
      const key = `${size.width}x${size.height}`;
      if (key === last) return;
      last = key;
      host.notify('ui/notifications/size-changed', size);
    };
    const observer = new ResizeObserver(() => { if (!queued) { queued = true; requestAnimationFrame(send); } });
    observer.observe(document.documentElement);
    observer.observe(document.body);
    send();
  }

  // --- Start --------------------------------------------------------------------------

  function buildDom() {
    $('#app').replaceChildren(el('div', {class: 'w'},
      el('div', {class: 'w-head'},
        el('span', {class: 'w-title', id: 'w-title', text: BRAND}),
        el('span', {class: 'w-sub', id: 'w-sub', text: 'session'}),
        el('span', {class: 'w-pill', id: 'w-status', text: 'starting'}),
        el('span', {class: 'w-fold-sum', id: 'w-fold-sum'}),
        el('div', {class: 'w-actions'},
          el('button', {class: 'w-button', id: 'w-unfold', text: 'Show map', title: 'A newer card is below',
                        onclick: () => setFolded(false)}),
          el('button', {class: 'w-button', id: 'w-fold', text: 'Fold', hidden: true, title: 'A newer card is below',
                        onclick: () => setFolded(true)}),
          el('button', {class: 'w-button', id: 'w-live', text: 'Live page', title: 'The session’s live page',
                        onclick: () => W.sid && openLink(`${BASE}/agent/${enc(W.sid)}`)}),
          el('button', {class: 'w-button', id: 'w-demo', text: PLATFORM ? 'Continue by hand' : 'Open in demo',
                        title: 'The image page with this run’s query',
                        onclick: () => { const r = shownRun(); const url = r ? r.open_in_demo : W.state && W.state.open_in_demo; if (url) openLink(url); }}),
          el('button', {class: 'w-button', id: 'w-full', text: 'Full screen', hidden: true, onclick: toggleFullscreen}))),
      el('div', {class: 'w-map-wrap'},
        el('div', {class: 'w-map', id: 'w-map'}),
        el('div', {class: 'w-message', id: 'w-message', text: 'Waiting for the session…'}),
        el('div', {class: 'w-legend', id: 'w-legend', hidden: true})),
      el('div', {class: 'w-run', id: 'w-run'}),
      el('div', {class: 'w-finished', id: 'w-finished', hidden: true}),
      el('div', {class: 'w-marks'},
        el('p', {class: 'w-hint', text: 'Click an outline that is wrong, or a place where an object was missed. The agent '
          + 'gets your marks with its next step; “Send” also writes them into the chat.'}),
        el('div', {class: 'w-mark-list', id: 'w-mark-list'}),
        el('div', {class: 'w-send'},
          el('button', {class: 'w-button primary', id: 'w-send', text: 'Send to the agent', disabled: true,
                        onclick: sendToAgent}),
          el('span', {class: 'w-status', id: 'w-status-line'})))));
  }

  host.on('ui/notifications/tool-input', (p) => { W.args = p.arguments || {}; bind(); });
  host.on('ui/notifications/tool-input-partial', () => {});
  host.on('ui/notifications/tool-result', (p) => { W.data = parseResult(p); bind(); });
  host.on('ui/notifications/tool-cancelled', (p) => {
    if (!W.sid) message(`The call was cancelled${p.reason ? `: ${p.reason}` : ''}.`);
  });
  host.on('ui/notifications/host-context-changed', (p) => { Object.assign(W.context, p); applyContext(); });
  host.on('ui/resource-teardown', () => { poll.stop(); return {}; });

  async function start() {
    buildDom();
    for (const type of ['pointerdown', 'wheel', 'keydown']) {
      document.addEventListener(type, () => { lastTouch = Date.now(); }, {passive: true, capture: true});
    }
    reportSize();
    try {
      const r = await host.request('ui/initialize', {
        appInfo: {name: 'mapflow-interactive-session', version: '1'},
        appCapabilities: {availableDisplayModes: ['inline', 'fullscreen']},
        protocolVersion: PROTOCOL,
      });
      W.context = r.hostContext || {};
      W.capabilities = r.hostCapabilities || {};
      W.hostInfo = r.hostInfo || {};
      applyContext();
      host.notify('ui/notifications/initialized', {});
    } catch (e) {
      message(`This card shows a session of ${BRAND}; open it from a chat.`);
    }
  }

  start();
})();
