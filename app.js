/* Ghost Vélo — interface. Le calcul est dans engine.js. */
(function () {
  'use strict';
  const E = window.GhostEngine;
  const $ = (id) => document.getElementById(id);

  // ===========================================================================
  // Réglages (stockés dans le téléphone)
  // ===========================================================================
  const SETTINGS_KEY = 'ghostvelo.settings';
  const settings = Object.assign(
    { beeps: true, voice: true, voiceEveryKm: 1 },
    (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })()
  );
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }

  // ===========================================================================
  // Base de données locale (IndexedDB)
  // ===========================================================================
  const DB = {
    db: null,
    memory: new Map(), // secours si IndexedDB est indisponible
    open() {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open('ghostvelo', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('routes', { keyPath: 'id' });
          req.onsuccess = () => { this.db = req.result; resolve(); };
          req.onerror = () => resolve();
        } catch (e) { resolve(); }
      });
    },
    _req(mode, fn) {
      return new Promise((resolve, reject) => {
        const store = this.db.transaction('routes', mode).objectStore('routes');
        const r = fn(store);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async all() {
      const list = this.db ? await this._req('readonly', (s) => s.getAll()) : [...this.memory.values()];
      return list.sort((a, b) => b.createdAt - a.createdAt);
    },
    async get(id) { return this.db ? this._req('readonly', (s) => s.get(id)) : this.memory.get(id); },
    async put(route) { if (this.db) return this._req('readwrite', (s) => s.put(route)); this.memory.set(route.id, route); },
    async del(id) { if (this.db) return this._req('readwrite', (s) => s.delete(id)); this.memory.delete(id); },
  };

  // ===========================================================================
  // Outils d'affichage
  // ===========================================================================
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  function fmtDelta(s) {
    const a = Math.round(Math.abs(s));
    if (a === 0) return '0 s';
    const sign = s > 0 ? '+' : '−';
    return a < 60 ? `${sign}${a} s` : `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  }
  function fmtDeltaM(m) {
    const a = Math.abs(m);
    const sign = m >= 0.5 ? '+' : m <= -0.5 ? '−' : '';
    return a >= 1000 ? `${sign}${(a / 1000).toFixed(2)} km` : `${sign}${Math.round(a)} m`;
  }
  function sayDelta(s) {
    const a = Math.round(Math.abs(s));
    const m = Math.floor(a / 60), sec = a % 60;
    let txt = m ? `${m} minute${m > 1 ? 's' : ''}${sec ? ' ' + sec : ''}` : `${sec} seconde${sec > 1 ? 's' : ''}`;
    if (a === 0) return 'à égalité avec le fantôme';
    return `${txt} ${s > 0 ? "d'avance" : 'de retard'}`;
  }
  const km = (m) => (m / 1000).toFixed(2);
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  function toast(msg, ms) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms || 2500);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
  }

  /** Modale générique. buttons : [{label, cls, onClick, keepOpen}] */
  function modal({ title, text, html, buttons }) {
    const root = $('modalRoot');
    root.innerHTML = '';
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = (title ? `<h3>${esc(title)}</h3>` : '') + (text ? `<p>${esc(text)}</p>` : '') + (html || '');
    const close = () => { root.innerHTML = ''; };
    (buttons || [{ label: 'OK' }]).forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.onclick = () => { if (!b.keepOpen) close(); b.onClick && b.onClick(box, close); };
      box.appendChild(btn);
    });
    bg.onclick = (e) => { if (e.target === bg) close(); };
    bg.appendChild(box);
    root.appendChild(bg);
    return { box, close };
  }

  /** Bouton à double appui (évite les arrêts accidentels avec les gants / en roulant). */
  function armDoubleTap(btn, label, armedLabel, action) {
    let timer = null;
    btn.onclick = () => {
      if (timer) { clearTimeout(timer); timer = null; btn.textContent = label; action(); return; }
      btn.textContent = armedLabel;
      timer = setTimeout(() => { timer = null; btn.textContent = label; }, 3000);
    };
  }

  // ===========================================================================
  // Son, voix, écran allumé
  // ===========================================================================
  let audioCtx = null;
  function unlockAudio() {
    // Doit être appelé pendant un appui de l'utilisateur (exigence d'iOS)
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const b = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = b; src.connect(audioCtx.destination); src.start(0);
    } catch (e) {}
    try { if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch (e) {}
  }
  function beep(freq, count) {
    if (!settings.beeps || !audioCtx) return;
    for (let i = 0; i < count; i++) {
      const t = audioCtx.currentTime + i * 0.22;
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.18);
    }
  }
  function say(text) {
    if (!settings.voice || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR'; u.rate = 1.05;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) {}
  }

  let wakeLock = null, wantAwake = false;
  async function keepAwake(on) {
    wantAwake = on;
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wantAwake) keepAwake(true);
  });

  // ===========================================================================
  // Horloge + GPS (réel ou simulé)
  // ===========================================================================
  const Clock = { sim: null, now() { return this.sim ? this.sim.now() : Date.now(); } };

  const LOG_KEY = 'ghostvelo.lastlog';
  const GPS = {
    watchId: null, sim: null, filter: null, log: [],
    /**
     * onFix reçoit la position LISSÉE par le filtre, ou {rejected:true, rawAccuracy}
     * quand la position brute a été écartée (imprécise ou aberrante).
     */
    start(onFix, onError) {
      this.stop();
      this.filter = new E.GpsFilter();
      this.log = [];
      const handle = (raw) => {
        const r = this.filter.process(raw);
        if (this.log.length < 30000) {
          this.log.push([raw.ts, raw.lat.toFixed(7), raw.lon.toFixed(7), Math.round(raw.accuracy || 0), raw.speed == null ? '' : raw.speed.toFixed(2),
            r.ok ? 1 : 0, r.ok ? r.fix.lat.toFixed(7) : '', r.ok ? r.fix.lon.toFixed(7) : '', r.ok ? '' : r.reason]);
        }
        if (!r.ok) { onFix({ rejected: true, reason: r.reason, rawAccuracy: raw.accuracy, ts: raw.ts }); return; }
        onFix(r.fix);
      };
      if (this.sim) { this.sim.start(handle); return; }
      if (!('geolocation' in navigator)) { onError({ code: 0, message: 'GPS non disponible sur cet appareil' }); return; }
      this.watchId = navigator.geolocation.watchPosition(
        (p) => handle({
          lat: p.coords.latitude, lon: p.coords.longitude,
          ele: p.coords.altitude, accuracy: p.coords.accuracy,
          speed: p.coords.speed != null && p.coords.speed >= 0 ? p.coords.speed : null,
          ts: p.timestamp || Date.now(),
        }),
        (err) => onError(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
      );
    },
    stop() {
      if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      if (this.sim) this.sim.stop();
      // On garde le journal brut de la dernière sortie (pour diagnostiquer le GPS)
      if (this.log.length > 5 && !this.sim) {
        try { localStorage.setItem(LOG_KEY, JSON.stringify({ date: Date.now(), rows: this.log })); } catch (e) {}
      }
      this.log = [];
    },
  };

  async function exportGpsLog() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(LOG_KEY)); } catch (e) {}
    if (!data || !data.rows || !data.rows.length) { toast('Aucun journal GPS pour l\'instant'); return; }
    const csv = 'horodatage_ms;lat_brute;lon_brute;precision_m;vitesse_ms;gardee;lat_lissee;lon_lissee;motif_rejet\n' +
      data.rows.map((r) => r.join(';')).join('\n');
    const name = `journal_gps_${new Date(data.date).toISOString().slice(0, 16).replace(/[-:T]/g, '')}.csv`;
    const file = new File([csv], name, { type: 'text/csv' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function gpsErrorText(err) {
    if (err && err.code === 1) return "Accès à la position refusé. Réglages > Confidentialité > Service de localisation : autorise « Sites web Safari » (Lorsque l'app est active, position exacte activée).";
    return 'Signal GPS faible… reste à découvert quelques secondes.';
  }

  function gpsLabel(fix) {
    if (!fix) return '<span class="dot" style="background:#8e8e93"></span>Recherche du GPS…';
    const a = Math.round(fix.rawAccuracy != null ? fix.rawAccuracy : fix.accuracy || 0);
    const c = a <= 10 ? 'var(--ahead-hi)' : a <= 25 ? 'var(--accent)' : 'var(--behind-hi)';
    return `<span class="dot" style="background:${c}"></span>GPS ± ${a} m${Clock.sim ? ' (simulé)' : ''}`;
  }

  /** Cycliste virtuel qui suit un fantôme, pour tester l'app sans rouler. */
  class Simulator {
    constructor(ghost, accel) {
      this.g = ghost; this.accel = accel || 10;
      this.timer = null; this.base = Date.now(); this.real0 = performance.now();
    }
    now() { return this.base + (performance.now() - this.real0) * this.accel; }
    start(onFix) {
      const g = this.g;
      this.base = Date.now(); this.real0 = performance.now();
      let s = -4, tau = 0, lastD = 0;
      const startTs = this.now();
      // Point de départ légèrement avant la ligne, dans l'axe du premier segment
      const d0 = E.posAtDist(g, 0), d1 = E.posAtDist(g, 30);
      const before = { lat: d0.lat - (d1.lat - d0.lat) / 3, lon: d0.lon - (d1.lon - d0.lon) / 3 };
      const tick = () => {
        let pos, speed;
        if (s < 0) { pos = s < -2 ? before : d0; speed = 0; }
        else {
          // Vitesse qui oscille autour de celle du fantôme → on passe devant puis derrière
          const f = 1.02 + 0.09 * Math.sin((2 * Math.PI * s) / 150);
          tau += f;
          const D = E.distAtTime(g, tau);
          speed = D - lastD; lastD = D;
          pos = E.posAtDist(g, D);
          if (tau > g.duration + 8) { this.stop(); return; }
        }
        const n = () => (Math.random() - 0.5) * 6 / 111320;
        onFix({ lat: pos.lat + n(), lon: pos.lon + n(), ele: null, accuracy: 5, speed, ts: startTs + (s + 4) * 1000 });
        s += 1;
      };
      tick();
      this.timer = setInterval(tick, 1000 / this.accel);
    }
    stop() { clearInterval(this.timer); this.timer = null; }
  }

  // ===========================================================================
  // Dessin de la trace (sans fond de carte, fonctionne hors ligne)
  // ===========================================================================
  function drawTrack(canvas, ghost, o) {
    o = o || {};
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!ghost) return;
    const xs = ghost.x, ys = ghost.y, n = ghost.n;
    if (!ghost._bb) {
      let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let i = 0; i < n; i++) { a = Math.min(a, xs[i]); b = Math.max(b, xs[i]); c = Math.min(c, ys[i]); d = Math.max(d, ys[i]); }
      ghost._bb = { minX: a, maxX: b, minY: c, maxY: d };
    }
    const bb = ghost._bb, pad = o.pad || 16;
    const sc = Math.min((w - 2 * pad) / Math.max(1, bb.maxX - bb.minX), (h - 2 * pad) / Math.max(1, bb.maxY - bb.minY));
    const ox = (w - (bb.maxX - bb.minX) * sc) / 2, oy = (h - (bb.maxY - bb.minY) * sc) / 2;
    const P = (x, y) => [ox + (x - bb.minX) * sc, h - (oy + (y - bb.minY) * sc)];
    const toP = (lat, lon) => P((lon - ghost.lon0) * ghost.kx, (lat - ghost.lat0) * ghost.ky);
    const step = Math.max(1, Math.floor(n / 1500));

    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = o.thumb ? '#5a5a60' : '#3a3a3e';
    ctx.lineWidth = o.thumb ? 3 : 6;
    ctx.beginPath();
    for (let i = 0; i < n; i += step) { const [px, py] = P(xs[i], ys[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    const [ex, ey] = P(xs[n - 1], ys[n - 1]); ctx.lineTo(ex, ey);
    ctx.stroke();

    if (o.userDist != null && o.userDist > 0) {
      ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 6;
      ctx.beginPath();
      for (let i = 0; i < n && ghost.cum[i] <= o.userDist; i += 1) { const [px, py] = P(xs[i], ys[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      const up = E.posAtDist(ghost, o.userDist); const [ux, uy] = toP(up.lat, up.lon); ctx.lineTo(ux, uy);
      ctx.stroke();
    }

    if (o.extra && o.extra.length > 1) { // trace en cours d'enregistrement
      ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 5; ctx.beginPath();
      o.extra.forEach((p, i) => { const [px, py] = toP(p.lat, p.lon); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
    }

    // Départ / arrivée
    const [sx, sy] = P(xs[0], ys[0]);
    ctx.fillStyle = '#2fe07a'; ctx.beginPath(); ctx.arc(sx, sy, o.thumb ? 4 : 6, 0, 7); ctx.fill();
    if (!o.thumb) { ctx.fillStyle = '#fff'; ctx.fillRect(ex - 5, ey - 5, 10, 10); }

    const dot = (p, fill, r) => {
      if (!p) return;
      const [px, py] = toP(p.lat, p.lon);
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(px, py, r + 3, 0, 7); ctx.fill();
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
    };
    dot(o.userPos, '#ffd60a', 9);
    dot(o.ghostPos, '#c7c7cc', 6); // dessiné par-dessus pour rester visible quand on est proches
  }

  // ===========================================================================
  // ACCUEIL
  // ===========================================================================
  const ghostCache = new Map();
  function ghostOf(route) {
    const key = route.id + ':' + route.updatedAt;
    if (!ghostCache.has(key)) ghostCache.set(key, E.prepareGhost(route.points));
    return ghostCache.get(key);
  }

  async function renderHome() {
    const list = await DB.all();
    const box = $('routeList');
    box.innerHTML = '';
    $('btnDemo').classList.toggle('hidden', list.some((r) => r.demo));
    if (!list.length) {
      box.innerHTML = `<div class="empty">Aucun fantôme pour l'instant.<br><br><b>1.</b> Appuie sur « Enregistrer un parcours » et fais ta sortie de référence.<br><b>2.</b> Reviens ici et choisis « Rouler contre » pour l'affronter.<br><br>Pour essayer tout de suite sans rouler : « Parcours démo ».</div>`;
      return;
    }
    for (const r of list) {
      const card = document.createElement('div');
      card.className = 'route';
      card.innerHTML = `
        <div class="route-head"><div class="name">${esc(r.name)}</div><button class="icon-btn" data-act="more" aria-label="Options">⋯</button></div>
        <canvas></canvas>
        <div class="route-meta num">
          <span><b>${km(r.distance)}</b> km</span>
          <span>Fantôme <b>${fmtTime(r.duration)}</b></span>
          <span><b>${(r.distance / r.duration * 3.6).toFixed(1)}</b> km/h</span>
          <span>${(r.history || []).length ? (r.history.length + ' essai' + (r.history.length > 1 ? 's' : '')) : 'aucun essai'}</span>
        </div>
        <button class="btn go" data-act="race">▶ Rouler contre ce fantôme</button>`;
      card.querySelector('[data-act=race]').onclick = () => startRace(r, null);
      card.querySelector('[data-act=more]').onclick = () => routeMenu(r);
      box.appendChild(card);
      requestAnimationFrame(() => { try { drawTrack(card.querySelector('canvas'), ghostOf(r), { thumb: true, pad: 8 }); } catch (e) {} });
    }
  }

  function routeMenu(r) {
    const hist = (r.history || []).slice(-8).reverse();
    const histHtml = hist.length
      ? `<div class="small">Derniers essais :<br>${hist.map((h) => `${fmtDate(h.date)} — ${h.finished ? fmtTime(h.time) + ' (' + fmtDelta(h.delta) + ')' : 'abandon'}`).join('<br>')}</div>`
      : '';
    modal({
      title: r.name,
      html: histHtml,
      buttons: [
        { label: '🧪 Simuler une course (test sans rouler)', onClick: () => askSimSpeed(r) },
        { label: '⬆︎ Exporter en GPX', onClick: () => exportGPX(r) },
        { label: '✎ Renommer', onClick: () => renameRoute(r) },
        { label: '🗑 Supprimer', onClick: () => confirmDelete(r) },
        { label: 'Fermer', cls: 'ghostly' },
      ],
    });
  }

  function askSimSpeed(r) {
    modal({
      title: 'Simulation',
      text: 'Un cycliste virtuel parcourt la trace en alternant avance et retard. Pratique pour tester l\'affichage depuis un ordinateur.',
      buttons: [
        { label: 'Vitesse réelle (×1)', onClick: () => startRace(r, 1) },
        { label: 'Accélérée ×10', cls: 'primary', onClick: () => startRace(r, 10) },
        { label: 'Très rapide ×40', onClick: () => startRace(r, 40) },
        { label: 'Annuler', cls: 'ghostly' },
      ],
    });
  }

  function renameRoute(r) {
    const m = modal({
      title: 'Renommer',
      html: `<input type="text" id="renameInput" value="${esc(r.name)}" maxlength="60">`,
      buttons: [
        { label: 'Enregistrer', cls: 'primary', onClick: async (box) => {
          const v = box.querySelector('#renameInput').value.trim();
          if (v) { r.name = v; await DB.put(r); renderHome(); }
        } },
        { label: 'Annuler', cls: 'ghostly' },
      ],
    });
    setTimeout(() => m.box.querySelector('input').focus(), 50);
  }

  function confirmDelete(r) {
    modal({
      title: 'Supprimer ce fantôme ?',
      text: `« ${r.name} » et son historique seront effacés de ce téléphone.`,
      buttons: [
        { label: 'Supprimer', cls: 'rec', onClick: async () => { await DB.del(r.id); renderHome(); } },
        { label: 'Annuler', cls: 'ghostly' },
      ],
    });
  }

  async function exportGPX(r) {
    const gpx = E.toGPX(r.name, r.points, r.createdAt);
    const fname = (r.name.replace(/[^\w\- ]+/g, '').trim() || 'parcours').replace(/\s+/g, '_') + '.gpx';
    const file = new File([gpx], fname, { type: 'application/gpx+xml' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: r.name }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function importGPX(file) {
    try {
      const text = await file.text();
      const { name, points } = E.parseGPX(text);
      const g = E.prepareGhost(points);
      if (g.total < 100) throw new Error('Trace trop courte (moins de 100 m).');
      const route = {
        id: uid(), name: name || file.name.replace(/\.gpx$/i, ''), createdAt: Date.now(), updatedAt: Date.now(),
        points: g.pts, distance: g.total, duration: g.duration, history: [],
      };
      await DB.put(route);
      toast(`Importé : ${km(g.total)} km en ${fmtTime(g.duration)}`);
      renderHome();
    } catch (e) {
      modal({ title: 'Import impossible', text: e.message || String(e) });
    }
  }

  async function createDemo() {
    // Boucle d'environ 6 km avec une côte, roulée entre 20 et 35 km/h
    const lat0 = 45.0, lon0 = 4.0, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
    const pts = [];
    let t = 0, a = 0;
    const L = 6000;
    let d = 0;
    while (d < L) {
      const u = d / L;
      const v = (28 + 6 * Math.sin(u * 2 * Math.PI * 3) - (u > 0.35 && u < 0.5 ? 9 : 0)) / 3.6;
      a = u * 2 * Math.PI;
      const r = 900 + 180 * Math.sin(3 * a) + 60 * Math.sin(7 * a);
      const x = r * Math.sin(a), y = r * (1 - Math.cos(a)) * 0.8;
      pts.push({ lat: lat0 + y / 111320, lon: lon0 + x / kx, ele: 200 + (u > 0.35 && u < 0.5 ? (u - 0.35) * 600 : u >= 0.5 ? 90 * (1 - u) / 0.5 : 0), t });
      t += 1; d += v;
    }
    pts.push({ lat: lat0, lon: lon0, ele: 200, t });
    const g = E.prepareGhost(pts);
    await DB.put({ id: uid(), name: 'Boucle démo', demo: true, createdAt: Date.now(), updatedAt: Date.now(), points: g.pts, distance: g.total, duration: g.duration, history: [] });
    toast('Parcours démo créé — ouvre « ⋯ » puis « Simuler une course »', 3500);
    renderHome();
  }

  function openSettings() {
    modal({
      title: 'Réglages',
      html: `
        <label class="toggle">Bips quand on passe devant / derrière<input type="checkbox" id="setBeeps" ${settings.beeps ? 'checked' : ''}></label>
        <label class="toggle">Annonce vocale à chaque kilomètre<input type="checkbox" id="setVoice" ${settings.voice ? 'checked' : ''}></label>
        <p class="small">Conseils : fixe le téléphone au guidon, laisse l'app ouverte (le GPS s'arrête si tu changes d'app ou verrouilles l'écran). Le bouton silencieux de l'iPhone coupe les bips.<br>Les parcours sont stockés uniquement sur ce téléphone : exporte-les en GPX pour les sauvegarder.</p>`,
      buttons: [
        { label: 'Exporter le journal GPS de la dernière sortie', onClick: exportGpsLog },
        { label: 'Fermer', cls: 'primary', onClick: (box) => {
          settings.beeps = box.querySelector('#setBeeps').checked;
          settings.voice = box.querySelector('#setVoice').checked;
          saveSettings();
        } },
      ],
    });
  }

  // ===========================================================================
  // ENREGISTREMENT D'UN PARCOURS
  // ===========================================================================
  const Rec = { recorder: null, anchor: null, startedAt: null, timer: null, lastFix: null };

  function startRecording() {
    unlockAudio();
    keepAwake(true);
    Clock.sim = null; GPS.sim = null;
    Rec.recorder = new E.Recorder();
    Rec.anchor = null; Rec.startedAt = null; Rec.lastFix = null;
    $('recClock').textContent = '0:00'; $('recSpeed').textContent = '0.0'; $('recDist').textContent = '0.00';
    $('recGps').innerHTML = gpsLabel(null);
    showScreen('record');
    setRecStatus('Attente du GPS…');

    GPS.start((fix) => {
      $('recGps').innerHTML = gpsLabel(fix);
      if (fix.rejected) {
        if (Rec.startedAt == null) setRecStatus(`Calage GPS… ± ${Math.round(fix.rawAccuracy || 0)} m`);
        return;
      }
      Rec.lastFix = fix;
      $('recSpeed').textContent = ((fix.speed || 0) * 3.6).toFixed(1);
      if (Rec.startedAt == null) {
        // On attend 3 positions précises d'affilée avant de déclarer le GPS « calé »
        if (fix.warm < 3) { setRecStatus(`Calage GPS… ± ${Math.round(fix.rawAccuracy)} m`); return; }
        if (!Rec.anchor) { Rec.anchor = fix; setRecStatus('PRÊT — pars quand tu veux'); say('Prêt. Le chrono démarre dès que tu roules.'); return; }
        const d = E.haversine(Rec.anchor, fix);
        if (d < 8) { if (fix.accuracy < Rec.anchor.accuracy) Rec.anchor = fix; return; }
        // On s'est élancé : départ = point d'ancrage
        const t0 = fix.ts - (d / Math.max(fix.speed || 0, 2)) * 1000;
        Rec.startedAt = t0;
        Rec.recorder.start(t0, Rec.anchor);
        Rec.recorder.add(fix);
        setRecStatus('ENREGISTREMENT');
        beep(880, 1);
        return;
      }
      Rec.recorder.add(fix);
      setRecStatus('ENREGISTREMENT');
      $('recDist').textContent = km(Rec.recorder.distance);
      drawRecMap();
    }, (err) => {
      // Un hoquet du GPS en cours de route n'arrête rien : on l'affiche juste en bas.
      if (Rec.startedAt == null || (err && err.code === 1)) setRecStatus(err && err.code === 1 ? 'GPS refusé' : 'Attente du GPS…');
      $('recGps').textContent = gpsErrorText(err);
    });

    Rec.timer = setInterval(() => {
      if (Rec.startedAt != null) $('recClock').textContent = fmtTime((Clock.now() - Rec.startedAt) / 1000);
    }, 250);
  }

  function setRecStatus(txt) {
    const head = document.querySelector('#record .rec-head');
    head.lastChild.textContent = txt;
    document.querySelector('#record .rec-dot').style.visibility = Rec.startedAt != null ? 'visible' : 'hidden';
  }

  function drawRecMap() {
    const pts = Rec.recorder.points;
    if (pts.length < 2) return;
    try { drawTrack($('recMap'), E.prepareGhost(pts.length > 3000 ? pts.filter((_, i) => i % 2 === 0) : pts), { userPos: pts[pts.length - 1] }); } catch (e) {}
  }

  function trimStill(points) {
    // Retire les points « à l'arrêt » à la fin (le temps passé à arrêter l'enregistrement)
    const p = points.slice();
    while (p.length > 2 && p[p.length - 1].lat === p[p.length - 2].lat && p[p.length - 1].lon === p[p.length - 2].lon) p.pop();
    return p;
  }

  function stopRecording() {
    GPS.stop(); clearInterval(Rec.timer); keepAwake(false);
    const pts = trimStill(Rec.recorder.points);
    let g = null;
    try { g = E.prepareGhost(pts); } catch (e) {}
    if (!g || g.total < 100) {
      modal({ title: 'Rien à enregistrer', text: 'Le parcours fait moins de 100 m.', buttons: [{ label: 'OK', onClick: goHome }] });
      return;
    }
    const d = new Date();
    const def = `Parcours du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const m = modal({
      title: `${km(g.total)} km en ${fmtTime(g.duration)}`,
      text: 'Donne un nom à ce parcours :',
      html: `<input type="text" id="nameInput" value="${esc(def)}" maxlength="60">`,
      buttons: [
        { label: 'Enregistrer ce fantôme', cls: 'primary', onClick: async (box) => {
          const name = box.querySelector('#nameInput').value.trim() || def;
          await DB.put({ id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(), points: g.pts, distance: g.total, duration: g.duration, history: [] });
          toast('Fantôme enregistré');
          goHome();
        } },
        { label: 'Jeter', cls: 'ghostly', onClick: goHome },
      ],
    });
    void m;
  }

  // ===========================================================================
  // COURSE CONTRE LE FANTÔME
  // ===========================================================================
  const Race = { route: null, ghost: null, race: null, timer: null, side: 0, lastKm: 0, lastFix: null, snap: null };

  function startRace(route, simAccel) {
    unlockAudio();
    keepAwake(!simAccel);
    Race.route = route;
    Race.ghost = ghostOf(route);
    Race.race = new E.GhostRace(Race.ghost);
    Race.side = 0; Race.lastKm = 0; Race.lastFix = null; Race.snap = null; Race.wasSim = !!simAccel;

    if (simAccel) { const s = new Simulator(Race.ghost, simAccel); Clock.sim = s; GPS.sim = s; } else { Clock.sim = null; GPS.sim = null; }
    document.querySelectorAll('.sim-tag').forEach((e) => e.remove());
    if (simAccel) { const t = document.createElement('div'); t.className = 'sim-tag'; t.textContent = `SIMULATION ×${simAccel}`; document.body.appendChild(t); }

    $('armedName').textContent = `${route.name} · ${km(Race.ghost.total)} km · ${fmtTime(Race.ghost.duration)}`;
    $('armedText').textContent = 'Recherche du GPS…';
    $('armedDist').textContent = '—';
    $('raceArmed').classList.remove('hidden');
    $('raceLive').classList.add('hidden');
    $('btnStartNow').classList.remove('hidden');
    $('raceGps').innerHTML = gpsLabel(null);
    $('raceGps').classList.remove('hidden');
    $('raceTotal').textContent = `/ ${km(Race.ghost.total)} km`;
    showScreen('race');

    GPS.start(onRaceFix, (err) => {
      if (Race.race && Race.race.state === 'armed') $('armedText').textContent = gpsErrorText(err);
      else $('raceGpsLive').textContent = 'Signal GPS perdu…';
    });
    Race.timer = setInterval(raceTick, 250);
  }

  function onRaceFix(fix) {
    $('raceGps').innerHTML = gpsLabel(fix);
    $('raceGpsLive').innerHTML = gpsLabel(fix);
    if (fix.rejected) {
      if (Race.race.state === 'armed') $('armedText').textContent = `Calage GPS… ± ${Math.round(fix.rawAccuracy || 0)} m`;
      return;
    }
    Race.lastFix = fix;
    if (Race.race.state === 'armed' && fix.warm < 3) {
      $('armedText').textContent = `Calage GPS… ± ${Math.round(fix.rawAccuracy)} m`;
      return;
    }
    const wasArmed = Race.race.state === 'armed';
    const snap = Race.race.update(fix);
    Race.snap = snap;
    $('raceSpeed').textContent = ((fix.speed || 0) * 3.6).toFixed(1);

    if (snap.state === 'armed') {
      if (snap.distToStart == null) return;
      if (snap.nearStart) {
        $('armedText').textContent = 'Sur la ligne. Élance-toi !';
        $('armedDist').textContent = 'PRÊT';
      } else {
        $('armedText').textContent = 'Rejoins le point de départ';
        $('armedDist').textContent = snap.distToStart >= 1000 ? `${(snap.distToStart / 1000).toFixed(1)} km` : `${Math.round(snap.distToStart)} m`;
      }
      return;
    }
    if (wasArmed) goLive();
    renderLive(snap, fix);
    if (snap.state === 'finished') finishRace();
  }

  function goLive() {
    $('raceArmed').classList.add('hidden');
    $('raceLive').classList.remove('hidden');
    $('btnStartNow').classList.add('hidden');
    $('raceGps').classList.add('hidden');
    beep(1320, 2);
    say('Top départ !');
  }

  function renderLive(snap, fix) {
    const dt = snap.deltaT;
    // Hystérésis d'une seconde pour éviter les clignotements vert/rouge
    let side = Race.side;
    if (dt > 1) side = 1; else if (dt < -1) side = -1;
    if (side !== Race.side) {
      if (Race.side !== 0) beep(side > 0 ? 1175 : 330, side > 0 ? 2 : 1);
      Race.side = side;
    }
    const box = $('deltaBox');
    box.classList.toggle('ahead', side > 0);
    box.classList.toggle('behind', side < 0);
    $('deltaLabel').textContent = side > 0 ? 'EN AVANCE' : side < 0 ? 'EN RETARD' : 'AU COUDE À COUDE';
    $('deltaValue').textContent = fmtDelta(dt);
    $('deltaSub').textContent = fmtDeltaM(snap.deltaM);

    // Jauge : échelle qui s'adapte à l'écart
    const a = Math.abs(snap.deltaM);
    const scale = [50, 100, 200, 500, 1000, 2000, 5000].find((s) => a <= s * 0.9) || 10000;
    $('gaugeScale').textContent = `fantôme ±${scale >= 1000 ? scale / 1000 + ' km' : scale + ' m'}`;
    const me = $('gaugeMe');
    me.style.left = `${50 + Math.max(-48, Math.min(48, (snap.deltaM / scale) * 48))}%`;
    me.classList.toggle('ahead', side > 0);
    me.classList.toggle('behind', side < 0);

    $('offBanner').classList.toggle('hidden', !snap.offTrack);
    $('raceDist').textContent = km(snap.userDist);
    $('raceProgress').style.width = `${Math.min(100, (snap.userDist / snap.total) * 100)}%`;

    // Annonce vocale tous les N km
    const kmNow = Math.floor(snap.userDist / (1000 * settings.voiceEveryKm));
    if (kmNow > Race.lastKm && snap.state === 'running') {
      Race.lastKm = kmNow;
      say(`Kilomètre ${kmNow * settings.voiceEveryKm}. ${sayDelta(dt)}.`);
    }
    void fix;
  }

  function raceTick() {
    const r = Race.race;
    if (!r || r.state !== 'running') return;
    const now = Clock.now();
    $('raceTime').textContent = fmtTime(r.elapsed(now));
    const user = Race.lastFix ? E.posAtDist(Race.ghost, r.userDist) : null;
    drawTrack($('raceMap'), Race.ghost, { userDist: r.userDist, userPos: user, ghostPos: r.ghostPosition(now) });
  }

  function endRaceSession() {
    GPS.stop(); clearInterval(Race.timer); keepAwake(false);
    Clock.sim = null; GPS.sim = null;
    document.querySelectorAll('.sim-tag').forEach((e) => e.remove());
  }

  async function finishRace() {
    const r = Race.race, route = Race.route, ghost = Race.ghost;
    endRaceSession();
    const time = r.finalTime, delta = ghost.duration - time;
    if (!Race.wasSim) { // les simulations ne comptent pas dans l'historique
      route.history = route.history || [];
      route.history.push({ date: Date.now(), time, delta, finished: true });
      await DB.put(route);
    }

    const better = delta > 0;
    say(`Arrivée ! ${sayDelta(delta)}.`);
    beep(better ? 1320 : 440, 3);
    $('resTitle').textContent = better ? '🏆 Fantôme battu !' : 'Arrivée';
    $('resName').textContent = route.name;
    $('resTime').textContent = fmtTime(time);
    const box = $('resDelta');
    box.classList.toggle('ahead', better); box.classList.toggle('behind', !better);
    $('resDeltaLabel').textContent = better ? "D'AVANCE SUR LE FANTÔME" : 'DE RETARD SUR LE FANTÔME';
    $('resDeltaValue').textContent = fmtDelta(delta).replace(/^[+−]/, '');
    $('resGhostTime').textContent = `Fantôme : ${fmtTime(ghost.duration)}`;
    const replace = $('btnResReplace');
    replace.textContent = better ? 'Ce temps devient le nouveau fantôme' : 'Remplacer quand même le fantôme';
    replace.className = 'btn big ' + (better ? 'primary' : '');
    const pts = r.recorder.points;
    replace.onclick = async () => {
      const g = E.prepareGhost(pts);
      Object.assign(route, { points: g.pts, distance: g.total, duration: g.duration, updatedAt: Date.now() });
      await DB.put(route);
      toast('Nouveau fantôme enregistré');
      goHome();
    };
    $('btnResSaveNew').onclick = async () => {
      const g = E.prepareGhost(pts);
      await DB.put({ id: uid(), name: `${route.name} — ${fmtDate(Date.now())}`, createdAt: Date.now(), updatedAt: Date.now(), points: g.pts, distance: g.total, duration: g.duration, history: [] });
      toast('Enregistré comme nouveau parcours');
      goHome();
    };
    showScreen('result');
  }

  async function abortRace() {
    const r = Race.race;
    const wasRunning = r && r.state === 'running';
    endRaceSession();
    if (wasRunning && Race.route && !Race.wasSim) {
      Race.route.history = Race.route.history || [];
      Race.route.history.push({ date: Date.now(), finished: false, dist: r.userDist });
      await DB.put(Race.route);
    }
    goHome();
  }

  function goHome() { showScreen('home'); renderHome(); }

  // ===========================================================================
  // Démarrage
  // ===========================================================================
  async function init() {
    await DB.open();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

    $('btnRecord').onclick = startRecording;
    $('btnImport').onclick = () => $('fileInput').click();
    $('fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) importGPX(f); e.target.value = ''; };
    $('btnDemo').onclick = createDemo;
    $('btnSettings').onclick = openSettings;
    $('btnResHome').onclick = goHome;
    $('btnStartNow').onclick = () => {
      const f = Race.lastFix;
      Race.race.startNow(f ? f.ts : Clock.now(), f);
      goLive();
    };
    armDoubleTap($('btnRecStop'), '■ Arrêter', 'Appuie encore pour arrêter', stopRecording);
    armDoubleTap($('btnRaceStop'), '■ Arrêter', 'Appuie encore pour arrêter', abortRace);

    window.addEventListener('resize', () => { if (Race.race) raceTick(); });
    renderHome();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
