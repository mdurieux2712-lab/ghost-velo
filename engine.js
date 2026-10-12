/*
 * Ghost Vélo — moteur de calcul (aucune dépendance, aucun accès à l'écran).
 *
 * Principe :
 *  1. Le fantôme est une liste de points {lat, lon, ele, t} (t = secondes depuis le départ).
 *  2. À chaque position GPS, on projette le cycliste sur la trace (projection orthogonale
 *     sur le segment le plus proche) → distance parcourue le long de la trace (D).
 *  3. On cherche à quel instant le fantôme avait atteint cette même distance D.
 *  4. Écart en temps : Δt = T_fantôme(D) − T_cycliste   (Δt > 0  ⇒  EN AVANCE)
 *     Écart en distance : Δm = D_cycliste − D_fantôme(T) (Δm > 0  ⇒  devant)
 */
(function (root) {
  'use strict';

  const R = 6371008.8; // rayon terrestre moyen (m)
  const RAD = Math.PI / 180;

  // ---------------------------------------------------------------------------
  // Géométrie
  // ---------------------------------------------------------------------------
  function haversine(a, b) {
    const dLat = (b.lat - a.lat) * RAD;
    const dLon = (b.lon - a.lon) * RAD;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** Nettoie une liste de points : temps strictement croissants, coordonnées valides. */
  function cleanPoints(points) {
    const out = [];
    for (const p of points) {
      if (!isFinite(p.lat) || !isFinite(p.lon) || !isFinite(p.t)) continue;
      if (out.length && p.t <= out[out.length - 1].t) continue;
      out.push({ lat: +p.lat, lon: +p.lon, ele: isFinite(p.ele) ? +p.ele : null, t: +p.t });
    }
    if (out.length) {
      const t0 = out[0].t;
      for (const p of out) p.t = +(p.t - t0).toFixed(2);
    }
    return out;
  }

  /** Prépare un fantôme : coordonnées planes locales + distances cumulées. */
  function prepareGhost(points) {
    const pts = cleanPoints(points);
    if (pts.length < 2) throw new Error('Trace trop courte (moins de 2 points).');
    const lat0 = pts[0].lat;
    const lon0 = pts[0].lon;
    const kx = R * Math.cos(lat0 * RAD) * RAD;
    const ky = R * RAD;
    const n = pts.length;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const cum = new Float64Array(n);
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = (pts[i].lon - lon0) * kx;
      y[i] = (pts[i].lat - lat0) * ky;
      t[i] = pts[i].t;
      cum[i] = i === 0 ? 0 : cum[i - 1] + haversine(pts[i - 1], pts[i]);
    }
    return {
      pts, x, y, cum, t, n, lat0, lon0, kx, ky,
      total: cum[n - 1],
      duration: t[n - 1],
      start: pts[0],
      end: pts[n - 1],
    };
  }

  function toXY(g, lat, lon) {
    return { x: (lon - g.lon0) * g.kx, y: (lat - g.lat0) * g.ky };
  }

  /** Premier indice i tel que arr[i] >= v (tableau croissant au sens large). */
  function lowerBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < v) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** Instant (s) où le fantôme a atteint la distance d pour la première fois. */
  function timeAtDist(g, d) {
    if (d <= 0) return 0;
    if (d >= g.total) return g.duration;
    const i = lowerBound(g.cum, d);
    const a = i - 1;
    const f = (d - g.cum[a]) / (g.cum[i] - g.cum[a]);
    return g.t[a] + f * (g.t[i] - g.t[a]);
  }

  /** Distance (m) parcourue par le fantôme à l'instant s. */
  function distAtTime(g, s) {
    if (s <= 0) return 0;
    if (s >= g.duration) return g.total;
    const i = lowerBound(g.t, s);
    const a = i - 1;
    const f = (s - g.t[a]) / (g.t[i] - g.t[a]);
    return g.cum[a] + f * (g.cum[i] - g.cum[a]);
  }

  /** Coordonnées du point situé à la distance d le long de la trace. */
  function posAtDist(g, d) {
    if (d <= 0) return { lat: g.start.lat, lon: g.start.lon };
    if (d >= g.total) return { lat: g.end.lat, lon: g.end.lon };
    const i = lowerBound(g.cum, d);
    const a = i - 1;
    const f = (d - g.cum[a]) / (g.cum[i] - g.cum[a]);
    return {
      lat: g.pts[a].lat + f * (g.pts[i].lat - g.pts[a].lat),
      lon: g.pts[a].lon + f * (g.pts[i].lon - g.pts[a].lon),
    };
  }

  /**
   * Projette (lat, lon) sur la trace, entre les segments [from, to[.
   * Renvoie {dist, offset, seg} : distance le long de la trace, écart latéral, segment.
   */
  function projectRange(g, lat, lon, from, to) {
    const p = toXY(g, lat, lon);
    let best = null;
    from = Math.max(0, from);
    to = Math.min(g.n - 1, to);
    for (let i = from; i < to; i++) {
      const ax = g.x[i], ay = g.y[i];
      const dx = g.x[i + 1] - ax, dy = g.y[i + 1] - ay;
      const len2 = dx * dx + dy * dy;
      let f = len2 > 0 ? ((p.x - ax) * dx + (p.y - ay) * dy) / len2 : 0;
      f = Math.max(0, Math.min(1, f));
      const qx = ax + f * dx, qy = ay + f * dy;
      const off = Math.hypot(p.x - qx, p.y - qy);
      if (!best || off < best.offset - 0.01) {
        best = { seg: i, offset: off, dist: g.cum[i] + f * (g.cum[i + 1] - g.cum[i]) };
      }
    }
    return best;
  }

  /**
   * Projection « suivie » : on ne cherche que dans une fenêtre autour de la dernière
   * position connue (évite de sauter sur l'autre sens d'un aller-retour ou sur la fin
   * d'une boucle qui repasse par le départ).
   */
  function projectTracked(g, lat, lon, lastDist, opts) {
    const back = (opts && opts.lookBack) || 60;
    const ahead = (opts && opts.lookAhead) || 400;
    const from = Math.max(0, lowerBound(g.cum, lastDist - back) - 1);
    const to = Math.min(g.n - 1, lowerBound(g.cum, lastDist + ahead) + 1);
    return projectRange(g, lat, lon, from, to);
  }

  // ---------------------------------------------------------------------------
  // Enregistreur de trace
  // ---------------------------------------------------------------------------
  class Recorder {
    constructor(opts) {
      this.maxAccuracy = (opts && opts.maxAccuracy) || 35; // m
      this.minMove = (opts && opts.minMove) || 3; // m
      this.stillEvery = (opts && opts.stillEvery) || 5; // s : point « à l'arrêt »
      this.points = [];
      this.t0 = null;
      this.distance = 0;
    }
    /** t0Ms : instant du départ (ms). */
    start(t0Ms, firstFix) {
      this.t0 = t0Ms;
      this.points = [];
      this.distance = 0;
      if (firstFix) this.points.push({ lat: firstFix.lat, lon: firstFix.lon, ele: firstFix.ele ?? null, t: 0 });
    }
    /** fix : {lat, lon, ele, accuracy, ts(ms)} — renvoie true si le point a été gardé. */
    add(fix) {
      if (this.t0 == null) return false;
      if (fix.accuracy != null && fix.accuracy > this.maxAccuracy) return false;
      const t = (fix.ts - this.t0) / 1000;
      if (t < 0) return false;
      const last = this.points[this.points.length - 1];
      if (!last) {
        this.points.push({ lat: fix.lat, lon: fix.lon, ele: fix.ele ?? null, t: +t.toFixed(2) });
        return true;
      }
      if (t <= last.t) return false;
      const d = haversine(last, fix);
      const threshold = Math.max(this.minMove, (fix.accuracy || 0) * 0.4);
      if (d >= threshold) {
        this.distance += d;
        this.points.push({ lat: fix.lat, lon: fix.lon, ele: fix.ele ?? null, t: +t.toFixed(2) });
        return true;
      }
      if (t - last.t >= this.stillEvery) {
        // À l'arrêt : on répète la dernière position pour que le fantôme « attende » aussi.
        this.points.push({ lat: last.lat, lon: last.lon, ele: last.ele, t: +t.toFixed(2) });
        return true;
      }
      return false;
    }
    get duration() {
      return this.points.length ? this.points[this.points.length - 1].t : 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Course contre le fantôme
  // ---------------------------------------------------------------------------
  class GhostRace {
    /**
     * ghost : objet renvoyé par prepareGhost
     * opts.startRadius : rayon (m) de la zone de départ
     * opts.finishRadius : rayon (m) de la zone d'arrivée
     */
    constructor(ghost, opts) {
      opts = opts || {};
      this.g = ghost;
      this.startRadius = opts.startRadius || 30;
      this.finishRadius = opts.finishRadius || 35;
      this.maxAccuracy = opts.maxAccuracy || 40;
      this.offTrackLimit = opts.offTrackLimit || 50;
      this.state = 'armed'; // armed → running → finished
      this.t0 = null;
      this.userDist = 0;
      this.deltaT = 0;
      this.deltaM = 0;
      this.rawDeltaT = 0;
      this.offTrack = false;
      this.offCount = 0;
      this.distToStart = null;
      this.nearStart = false;
      this.lastFix = null;
      this.finalTime = null;
      this.recorder = new Recorder({ maxAccuracy: this.maxAccuracy });
    }

    /** Départ manuel (bouton). */
    startNow(tsMs, fix) {
      this.state = 'running';
      this.t0 = tsMs;
      this.userDist = 0;
      if (fix) {
        const pr = projectRange(this.g, fix.lat, fix.lon, 0, this.g.n - 1);
        if (pr && pr.offset < this.offTrackLimit) this.userDist = pr.dist;
      }
      this.recorder.start(tsMs, fix || null);
    }

    elapsed(nowMs) {
      return this.t0 == null ? 0 : Math.max(0, (nowMs - this.t0) / 1000);
    }

    /** À appeler à chaque position GPS. Renvoie un résumé de l'état. */
    update(fix) {
      if (fix.accuracy != null && fix.accuracy > this.maxAccuracy) {
        return this.snapshot(fix.ts, 'précision GPS insuffisante');
      }
      this.lastFix = fix;
      const g = this.g;

      if (this.state === 'armed') {
        this.distToStart = haversine(fix, g.start);
        if (this.distToStart <= this.startRadius) this.nearStart = true;
        if (this.nearStart) {
          const pr = projectTracked(g, fix.lat, fix.lon, 0, { lookBack: 0, lookAhead: 150 });
          // Le chrono part quand on a quitté la ligne de départ dans le bon sens.
          if (pr && pr.offset < this.startRadius && pr.dist >= 8 && this.distToStart >= 8) {
            const v = Math.max(fix.speed || 0, 2);
            const t0 = fix.ts - (pr.dist / v) * 1000; // instant estimé du passage sur la ligne
            this.state = 'running';
            this.t0 = t0;
            this.userDist = pr.dist;
            this.recorder.start(t0, { lat: g.start.lat, lon: g.start.lon, ele: g.start.ele });
            this.recorder.add(fix);
            this.computeDeltas(fix.ts);
          }
        }
        return this.snapshot(fix.ts);
      }

      if (this.state !== 'running') return this.snapshot(fix.ts);

      this.recorder.add(fix);
      let pr = projectTracked(g, fix.lat, fix.lon, this.userDist);
      if (!pr || pr.offset > this.offTrackLimit) {
        this.offCount++;
        // Après plusieurs positions hors parcours, on cherche à recoller plus loin.
        if (this.offCount >= 5) {
          const from = Math.max(0, lowerBound(g.cum, this.userDist - 100) - 1);
          const pr2 = projectRange(g, fix.lat, fix.lon, from, g.n - 1);
          if (pr2 && pr2.offset < 25) pr = pr2; else pr = null;
        } else pr = null;
      }
      if (pr) {
        this.offCount = 0;
        this.offTrack = false;
        // On tolère un petit recul (bruit GPS) mais pas de grand saut en arrière.
        if (pr.dist >= this.userDist - 15) this.userDist = pr.dist;
      } else {
        this.offTrack = true;
      }

      this.computeDeltas(fix.ts);

      // Arrivée
      if (this.userDist >= g.total - 15 && haversine(fix, g.end) <= this.finishRadius) {
        this.state = 'finished';
        // Instant estimé du passage sur la ligne d'arrivée (on complète les derniers mètres)
        const remain = Math.max(0, g.total - this.userDist) / Math.max(fix.speed || 0, 2);
        this.finalTime = this.elapsed(fix.ts) + remain;
        this.deltaT = g.duration - this.finalTime;
        this.recorder.add({ lat: g.end.lat, lon: g.end.lon, ele: g.end.ele, accuracy: 0, ts: this.t0 + this.finalTime * 1000 + 1 });
      }
      return this.snapshot(fix.ts);
    }

    computeDeltas(tsMs) {
      const el = this.elapsed(tsMs);
      this.rawDeltaT = timeAtDist(this.g, this.userDist) - el;
      // Lissage léger pour éviter que l'affichage « tremble »
      this.deltaT = this.deltaT === 0 ? this.rawDeltaT : this.deltaT + 0.5 * (this.rawDeltaT - this.deltaT);
      this.deltaM = this.userDist - distAtTime(this.g, el);
    }

    /** Position du fantôme à un instant donné (pour l'affichage sur la carte). */
    ghostPosition(nowMs) {
      return posAtDist(this.g, distAtTime(this.g, this.elapsed(nowMs)));
    }

    snapshot(tsMs, warning) {
      return {
        state: this.state,
        elapsed: this.state === 'finished' ? this.finalTime : this.elapsed(tsMs),
        userDist: this.userDist,
        total: this.g.total,
        deltaT: this.deltaT,
        deltaM: this.deltaM,
        offTrack: this.offTrack,
        distToStart: this.distToStart,
        nearStart: this.nearStart,
        warning: warning || null,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // GPX
  // ---------------------------------------------------------------------------
  function parseGPX(text, DOMParserImpl) {
    const P = DOMParserImpl || root.DOMParser;
    const doc = new P().parseFromString(text, 'application/xml');
    let nodes = Array.from(doc.getElementsByTagName('trkpt'));
    if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('rtept'));
    if (!nodes.length) throw new Error('Aucun point trouvé dans ce fichier GPX.');
    const nameEl = doc.getElementsByTagName('name')[0];
    const raw = [];
    let missingTime = 0;
    for (const n of nodes) {
      const timeEl = n.getElementsByTagName('time')[0];
      const eleEl = n.getElementsByTagName('ele')[0];
      if (!timeEl) { missingTime++; continue; }
      raw.push({
        lat: parseFloat(n.getAttribute('lat')),
        lon: parseFloat(n.getAttribute('lon')),
        ele: eleEl ? parseFloat(eleEl.textContent) : null,
        t: Date.parse(timeEl.textContent.trim()) / 1000,
      });
    }
    if (raw.length < 2) {
      throw new Error(
        missingTime
          ? "Ce GPX n'a pas d'horaires : c'est un itinéraire, pas une sortie enregistrée. Exporte plutôt une activité (Strava : « Exporter GPX » sur une activité)."
          : 'Trace trop courte.'
      );
    }
    return { name: nameEl ? nameEl.textContent.trim() : null, points: cleanPoints(raw) };
  }

  function toGPX(name, points, startDate) {
    const t0 = startDate ? new Date(startDate).getTime() : Date.now();
    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const pts = points
      .map((p) =>
        `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
        (p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : '') +
        `<time>${new Date(t0 + p.t * 1000).toISOString()}</time></trkpt>`
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ghost Velo" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
  }

  root.GhostEngine = {
    haversine, cleanPoints, prepareGhost, timeAtDist, distAtTime, posAtDist,
    projectRange, projectTracked, Recorder, GhostRace, parseGPX, toGPX,
  };
})(typeof window !== 'undefined' ? window : globalThis);
