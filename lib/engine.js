'use strict';
/**
 * OranMatik Klon - Analiz motoru (sema v2)
 *
 *  - Oran eslesmesi: ayni/yakin oranli tarihsel maclarin sonuc dagilimi
 *  - Poisson / Dixon-Coles gol modeli
 *  - Puan durumu, H2H, backtest/kalibrasyon
 *  - Deger bahsi: EV / Kelly
 */

const DAY = 86400000;

/** mac dizisi alanlari */
const F = {
  DATE: 0, LG: 1, HOME: 2, AWAY: 3, HG: 4, AG: 5, HTG: 6, ATG: 7,
  OH: 8, OD: 9, OA: 10,
  PH: 11, PD: 12, PA: 13,
  MAXH: 14, MAXD: 15, MAXA: 16,
  O25: 17, U25: 18, SEASON: 19,
  HST: 20, AST: 21,
};

/* ---------------------------- yardimcilar ---------------------------- */

function implied(oh, od, oa) {
  if (!(oh > 1 && od > 1 && oa > 1)) return null;
  const rh = 1 / oh, rd = 1 / od, ra = 1 / oa;
  const s = rh + rd + ra;
  return { pH: rh / s, pD: rd / s, pA: ra / s, overround: s - 1, raw: { h: rh, d: rd, a: ra } };
}

/** logaritmik (power) marj temizleme */
function impliedPower(oh, od, oa) {
  if (!(oh > 1 && od > 1 && oa > 1)) return null;
  const raw = [1 / oh, 1 / od, 1 / oa];
  const s = raw[0] + raw[1] + raw[2];
  let lo = 0.4, hi = 3;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const t = Math.pow(raw[0], k) + Math.pow(raw[1], k) + Math.pow(raw[2], k);
    if (t > 1) lo = k; else hi = k;
  }
  const k = (lo + hi) / 2;
  const p = raw.map((r) => Math.pow(r, k));
  const t = p[0] + p[1] + p[2];
  return { pH: p[0] / t, pD: p[1] / t, pA: p[2] / t, overround: s - 1 };
}

/** Wilson %95 guven araligi */
const COMBO_KEYS = ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'];
const resOf = (h, a) => (h > a ? '1' : h === a ? 'X' : '2');

function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logp = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logp -= Math.log(i);
  return Math.exp(logp);
}

function seasonLabel(y) {
  return y ? `${y}/${String((y + 1) % 100).padStart(2, '0')}` : '—';
}

/* ---------------------------- motor ---------------------------- */

class Engine {
  constructor(db) {
    this.db = db;
    this.matches = db.matches || [];
    this.fixtures = db.fixtures || [];
    this.teams = db.teams;
    this.leagues = db.leagues;

    this.byLeague = this.leagues.map(() => []);
    this.teamMatches = this.teams.map(() => []);

    for (let i = 0; i < this.matches.length; i++) {
      const m = this.matches[i];
      this.byLeague[m[F.LG]].push(i);
      this.teamMatches[m[F.HOME]].push(i);
      this.teamMatches[m[F.AWAY]].push(i);
    }

    this.today = this.matches.length ? this.matches[this.matches.length - 1][F.DATE] : 0;
    this.shotWeight = db.shotWeight != null ? db.shotWeight : 0.75; // isabetli sut katkisi (0 = kapali)
    this._ratingCache = new Map();
    this._btCache = new Map();
  }

  leagueOf(teamId) { return this.teams[teamId] ? this.teams[teamId].l : -1; }

  ageDays(matchDate, asOf) { return Math.max(0, (asOf - matchDate) / DAY); }

  maxSeason() {
    let mx = 0;
    for (const s of this.matches) if (s[F.SEASON] > mx) mx = s[F.SEASON];
    return mx;
  }

  /* ---------------- ORAN ESLESMESI ---------------- */

  findSimilarOdds(target, opts = {}) {
    const { mode = 'near', tol = 0.02, league = -1, seasonFrom = 0, seasonTo = 9999 } = opts;
    const tp = implied(target.h, target.d, target.a);
    if (!tp) return { matches: [], tolUsed: tol, expanded: false };

    const scan = (tolerance, exact) => {
      const out = [];
      for (let i = 0; i < this.matches.length; i++) {
        const m = this.matches[i];
        const oH = m[F.OH], oD = m[F.OD], oA = m[F.OA];
        if (!oH || !oD || !oA) continue;
        if (league >= 0 && m[F.LG] !== league) continue;
        if (m[F.SEASON] < seasonFrom || m[F.SEASON] > seasonTo) continue;
        if (exact) {
          if (Math.abs(oH - target.h) < 0.005 && Math.abs(oD - target.d) < 0.005 && Math.abs(oA - target.a) < 0.005) {
            out.push({ i, dist: 0 });
          }
          continue;
        }
        const q = implied(oH, oD, oA);
        if (!q) continue;
        const dist = 0.5 * (Math.abs(q.pH - tp.pH) + Math.abs(q.pD - tp.pD) + Math.abs(q.pA - tp.pA));
        if (dist <= tolerance) out.push({ i, dist });
      }
      return out;
    };

    if (mode === 'exact') return { matches: scan(0, true), tolUsed: 0, expanded: false };

    let t = tol;
    let res = scan(t, false);
    let expanded = false;
    for (let k = 0; k < 6 && res.length < 25 && t < 0.25; k++) {
      t = Math.min(0.25, t * 1.45);
      res = scan(t, false);
      expanded = true;
    }
    return { matches: res, tolUsed: t, expanded };
  }

  summarizeSimilar(target, opts = {}) {
    const { matches, tolUsed, expanded } = this.findSimilarOdds(target, opts);
    const n = matches.length;
    let h = 0, d = 0, a = 0, goals = 0, over = 0, btts = 0, over15 = 0, over35 = 0, over55 = 0;
    const bands = [0, 0, 0, 0]; // 0-1, 2-3, 4-5, 6+
    const htft = {};
    COMBO_KEYS.forEach((k) => { htft[k] = 0; });
    let htN = 0;
    const rows = [];

    for (const { i, dist } of matches) {
      const m = this.matches[i];
      const hg = m[F.HG], ag = m[F.AG];
      if (hg > ag) h++; else if (hg === ag) d++; else a++;
      const tot = hg + ag;
      goals += tot;
      if (tot > 2.5) over++;
      if (tot > 1.5) over15++;
      if (tot > 3.5) over35++;
      if (tot > 5.5) over55++;
      bands[tot <= 1 ? 0 : tot <= 3 ? 1 : tot <= 5 ? 2 : 3]++;
      if (hg > 0 && ag > 0) btts++;
      const htg = m[F.HTG], atg = m[F.ATG];
      if (htg >= 0 && atg >= 0) {
        htN++;
        htft[resOf(htg, atg) + '/' + resOf(hg, ag)]++;
      }
      rows.push({
        date: m[F.DATE], league: m[F.LG], home: m[F.HOME], away: m[F.AWAY], hg, ag,
        htg, atg,
        odds: [m[F.OH], m[F.OD], m[F.OA]], dist: +dist.toFixed(4), season: m[F.SEASON],
      });
    }
    rows.sort((x, y) => y.date - x.date);

    const p = (k) => (n ? k / n : 0);
    const htftProbs = {};
    COMBO_KEYS.forEach((k) => { htftProbs[k] = htN ? htft[k] / htN : 0; });

    return {
      count: n,
      tolUsed: +tolUsed.toFixed(3),
      expanded,
      dist: { h: p(h), d: p(d), a: p(a) },
      counts: { h, d, a },
      ci: { h: wilson(h, n), d: wilson(d, n), a: wilson(a, n) },
      avgGoals: n ? goals / n : 0,
      ou25: n ? { over: over / n, under: 1 - over / n, n } : null,
      over15: n ? over15 / n : 0,
      over35: n ? over35 / n : 0,
      over55: n ? over55 / n : 0,
      bands: n ? { p: bands.map((x) => x / n), n } : null,
      htft: { probs: htftProbs, counts: htft, n: htN },
      btts: n ? btts / n : 0,
      rows: rows.slice(0, 80),
      totalRows: n,
      decades: this._byDecade(rows),
    };
  }

  _byDecade(rows) {
    const map = new Map();
    for (const r of rows) {
      const dec = Math.floor(r.season / 10) * 10;
      if (!map.has(dec)) map.set(dec, { key: dec, n: 0, h: 0, d: 0, a: 0 });
      const b = map.get(dec);
      b.n++;
      if (r.hg > r.ag) b.h++; else if (r.hg === r.ag) b.d++; else b.a++;
    }
    return [...map.values()].sort((x, y) => x.key - y.key)
      .map((b) => ({ ...b, ph: b.h / b.n, pd: b.d / b.n, pa: b.a / b.n }));
  }

  /* ---------------- POISSON / DIXON-COLES ---------------- */

  fitRatings(league, opts = {}) {
    const {
      halfLifeDays = 400, seasonFrom = 0, reg = 0.03, iters = 240,
      asOf = this.today, shotWeight = 0,
    } = opts;
    const key = `${league}|${seasonFrom}|${halfLifeDays}|${asOf}|${shotWeight}`;
    if (this._ratingCache.has(key)) return this._ratingCache.get(key);

    const idxs = this.byLeague[league] || [];
    const rows = [];
    let sotSum = 0, goalSum = 0;
    for (const i of idxs) {
      const m = this.matches[i];
      if (m[F.SEASON] < seasonFrom) continue;
      if (m[F.DATE] >= asOf) continue;
      const age = this.ageDays(m[F.DATE], asOf);
      const w = Math.exp((-Math.LN2 * age) / halfLifeDays);
      if (w < 0.02) continue;
      const hst = m[F.HST], ast = m[F.AST];
      const hasShots = hst != null && ast != null && hst >= 0 && ast >= 0;
      if (hasShots) { sotSum += hst + ast; goalSum += m[F.HG] + m[F.AG]; }
      rows.push({
        h: m[F.HOME], a: m[F.AWAY], hg: m[F.HG], ag: m[F.AG], w,
        hst: hasShots ? hst : -1, ast: hasShots ? ast : -1,
      });
    }

    // isabetli sut -> gol donusum orani (lig bazli)
    const conv = sotSum > 200 ? Math.min(0.5, Math.max(0.18, goalSum / sotSum)) : 0.32;

    // sut verisi varsa hedefi yumusat: y = (gol + w * beklenen gol(sut)) / (1 + w)
    if (shotWeight > 0 && conv > 0) {
      for (const r of rows) {
        if (r.hst < 0) continue;
        r.hg = (r.hg + shotWeight * conv * r.hst) / (1 + shotWeight);
        r.ag = (r.ag + shotWeight * conv * r.ast) / (1 + shotWeight);
      }
    }

    if (rows.length < 40) {
      const res = { teams: new Map(), mu: 0.25, hadv: 0.2, n: rows.length, rho: 0, avgH: 1.4, avgA: 1.1, ok: false };
      this._ratingCache.set(key, res);
      return res;
    }

    const teamSet = new Set();
    for (const r of rows) { teamSet.add(r.h); teamSet.add(r.a); }
    const teams = [...teamSet];
    const ti = new Map(teams.map((t, i) => [t, i]));
    const nT = teams.length;

    const att = new Float64Array(nT);
    const def = new Float64Array(nT);
    let mu = 0.25, hadv = 0.22;

    const mAtt = new Float64Array(nT), vAtt = new Float64Array(nT);
    const mDef = new Float64Array(nT), vDef = new Float64Array(nT);
    let mMu = 0, vMu = 0, mH = 0, vH = 0;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8, lr = 0.35;
    let t = 0;

    let wSum = 0, sumH = 0, sumA = 0;
    for (const r of rows) { wSum += r.w; sumH += r.hg * r.w; sumA += r.ag * r.w; }
    mu = Math.log(Math.max(0.2, (sumH + sumA) / (2 * wSum)));
    hadv = Math.log(Math.max(0.5, sumH / Math.max(1e-6, sumA)));

    const upd = (p, g, m, v) => {
      m[0] = b1 * m[0] + (1 - b1) * g;
      v[0] = b2 * v[0] + (1 - b2) * g * g;
      const mh = m[0] / (1 - Math.pow(b1, t));
      const vh = v[0] / (1 - Math.pow(b2, t));
      return p - (lr * mh) / (Math.sqrt(vh) + eps);
    };

    for (let it = 0; it < iters; it++) {
      const gAtt = new Float64Array(nT), gDef = new Float64Array(nT);
      let gMu = 0, gH = 0;
      for (const r of rows) {
        const ih = ti.get(r.h), ia = ti.get(r.a);
        const lh = Math.exp(mu + hadv + att[ih] - def[ia]);
        const la = Math.exp(mu + att[ia] - def[ih]);
        const eh = (lh - r.hg) * r.w;
        const ea = (la - r.ag) * r.w;
        gMu += eh + ea;
        gH += eh;
        gAtt[ih] += eh; gDef[ia] -= eh;
        gAtt[ia] += ea; gDef[ih] -= ea;
      }
      for (let i = 0; i < nT; i++) { gAtt[i] += reg * att[i] * 2; gDef[i] += reg * def[i] * 2; }

      t++;
      for (let i = 0; i < nT; i++) {
        let m = [mAtt[i]], v = [vAtt[i]];
        att[i] = upd(att[i], gAtt[i] / wSum, m, v); mAtt[i] = m[0]; vAtt[i] = v[0];
        m = [mDef[i]]; v = [vDef[i]];
        def[i] = upd(def[i], gDef[i] / wSum, m, v); mDef[i] = m[0]; vDef[i] = v[0];
      }
      let m = [mMu], v = [vMu];
      mu = upd(mu, gMu / wSum, m, v); mMu = m[0]; vMu = v[0];
      m = [mH]; v = [vH];
      hadv = upd(hadv, gH / wSum, m, v); mH = m[0]; vH = v[0];

      let sa = 0, sd = 0;
      for (let i = 0; i < nT; i++) { sa += att[i]; sd += def[i]; }
      sa /= nT; sd /= nT;
      for (let i = 0; i < nT; i++) { att[i] -= sa; def[i] -= sd; }
    }

    // Dixon-Coles rho
    let bestRho = 0, bestLL = -Infinity;
    for (let rho = -0.16; rho <= 0.081; rho += 0.02) {
      let ll = 0;
      for (const r of rows) {
        const ih = ti.get(r.h), ia = ti.get(r.a);
        const lh = Math.exp(mu + hadv + att[ih] - def[ia]);
        const la = Math.exp(mu + att[ia] - def[ih]);
        const tau = this._tau(r.hg, r.ag, lh, la, rho);
        ll += r.w * Math.log(Math.max(1e-9, poissonPmf(r.hg, lh) * poissonPmf(r.ag, la) * tau));
      }
      if (ll > bestLL) { bestLL = ll; bestRho = rho; }
    }

    const map = new Map();
    teams.forEach((tid, i) => map.set(tid, { att: att[i], def: def[i] }));

    let avgH = 0, avgA = 0;
    for (const r of rows) { avgH += r.hg * r.w; avgA += r.ag * r.w; }
    avgH /= wSum; avgA /= wSum;

    const res = { teams: map, mu, hadv, n: rows.length, rho: bestRho, avgH, avgA, ok: true, conv, shotWeight };
    this._ratingCache.set(key, res);
    return res;
  }

  _tau(x, y, lh, la, rho) {
    if (x === 0 && y === 0) return 1 - lh * la * rho;
    if (x === 0 && y === 1) return 1 + lh * rho;
    if (x === 1 && y === 0) return 1 + la * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  }

  /** lam degerlerinden skor matrisi + marketler */
  scoreMatrix(lamH, lamA, rho, MAX = 9) {
    const mat = [];
    let sum = 0;
    for (let i = 0; i <= MAX; i++) {
      mat.push([]);
      for (let j = 0; j <= MAX; j++) {
        const p = Math.max(0, poissonPmf(i, lamH) * poissonPmf(j, lamA) * this._tau(i, j, lamH, lamA, rho));
        mat[i][j] = p;
        sum += p;
      }
    }
    for (let i = 0; i <= MAX; i++) for (let j = 0; j <= MAX; j++) mat[i][j] /= sum;

    let pH = 0, pD = 0, pA = 0, btts = 0, eg = 0;
    const ou = { 1.5: 0, 2.5: 0, 3.5: 0, 4.5: 0, 5.5: 0 };
    const bands = [0, 0, 0, 0];
    const scores = [];
    for (let i = 0; i <= MAX; i++) {
      for (let j = 0; j <= MAX; j++) {
        const p = mat[i][j];
        if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
        const tot = i + j;
        eg += tot * p;
        if (tot > 1.5) ou[1.5] += p;
        if (tot > 2.5) ou[2.5] += p;
        if (tot > 3.5) ou[3.5] += p;
        if (tot > 4.5) ou[4.5] += p;
        if (tot > 5.5) ou[5.5] += p;
        bands[tot <= 1 ? 0 : tot <= 3 ? 1 : tot <= 5 ? 2 : 3] += p;
        if (i > 0 && j > 0) btts += p;
        scores.push({ s: `${i}-${j}`, p, i, j });
      }
    }
    scores.sort((x, y) => y.p - x.p);
    const s = pH + pD + pA;
    return {
      probs: { h: pH / s, d: pD / s, a: pA / s },
      ou: {
        over1_5: ou[1.5], over2_5: ou[2.5], over3_5: ou[3.5], over4_5: ou[4.5], over5_5: ou[5.5],
        under1_5: 1 - ou[1.5], under2_5: 1 - ou[2.5], under3_5: 1 - ou[3.5],
      },
      bands: { p: bands, n: 1 },
      btts,
      expectedGoals: eg,
      topScores: scores.slice(0, 10).map((x) => ({ s: x.s, p: x.p })),
      matrix: mat,
    };
  }

  /** takim -> mac indeksleri (tembel) */
  _teamIndex() {
    if (this._byTeam) return this._byTeam;
    const map = new Map();
    for (let i = 0; i < this.matches.length; i++) {
      const m = this.matches[i];
      for (const t of [m[F.HOME], m[F.AWAY]]) {
        let a = map.get(t);
        if (!a) { a = []; map.set(t, a); }
        a.push(i);
      }
    }
    for (const a of map.values()) a.sort((x, y) => this.matches[x][F.DATE] - this.matches[y][F.DATE]);
    this._byTeam = map;
    return map;
  }

  /**
   * Fikstur zinciri: iki takimin da sonraki/onceki lig maclari.
   * span=5 -> -5..+5
   */
  chain(homeId, awayId, span = 5) {
    const idx = this._teamIndex();
    const side = (teamId, oppId) => {
      const list = (idx.get(teamId) || []).map((i) => this.matches[i]);
      // hedef mac: oppId ile olan (en son / ilk gelecek)
      let target = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m[F.HOME] === oppId || m[F.AWAY] === oppId) { target = i; break; }
      }
      const from = target < 0 ? list.length : target;
      const start = Math.max(0, from - span);
      const end = Math.min(list.length, from + span + 1);
      const rows = [];
      for (let i = start; i < end; i++) {
        const m = list[i];
        const isHome = m[F.HOME] === teamId;
        const opp = isHome ? m[F.AWAY] : m[F.HOME];
        const hg = m[F.HG], ag = m[F.AG];
        const myG = isHome ? hg : ag, oppG = isHome ? ag : hg;
        const htg = m[F.HTG], atg = m[F.ATG];
        const htMine = isHome ? htg : atg, htOpp = isHome ? atg : htg;
        const res = hg < 0 ? null : myG > oppG ? 'G' : myG === oppG ? 'B' : 'M';
        const comeback = htg >= 0 && ((htMine > htOpp && myG < oppG) || (htMine < htOpp && myG > oppG));
        rows.push({
          i, date: m[F.DATE], opp, home: isHome, hg: myG, ag: oppG,
          ht: htg >= 0 ? `${htMine}-${htOpp}` : null,
          res, comeback: !!comeback, isTarget: i === target,
        });
      }
      return rows;
    };
    return { home: side(homeId, awayId), away: side(awayId, homeId), span };
  }

  /** Ilk yari cift sans olasiliklari (model) */
  halfDoubleChance(homeId, awayId, opts = {}) {
    const gm = this.goalModel(homeId, awayId, opts);
    const ht = gm.halves.ht;
    return { p1x: ht.h + ht.d, p12: ht.h + ht.a, px2: ht.d + ht.a, ht, homes: gm.lambda };
  }

  /**
   * Donus (1/2 - 2/1) istatistigi — tum arsiv, favori oran bandina gore.
   * Donus = ilk yariyi onde bitiren takim maci kaybeder.
   */
  comebackTable() {
    if (this._cb) return this._cb;
    const bands = [
      { lo: 1.0, hi: 1.3, label: '1.00–1.30' },
      { lo: 1.3, hi: 1.5, label: '1.30–1.50' },
      { lo: 1.5, hi: 1.7, label: '1.50–1.70' },
      { lo: 1.7, hi: 2.0, label: '1.70–2.00' },
      { lo: 2.0, hi: 2.5, label: '2.00–2.50' },
      { lo: 2.5, hi: 99, label: '2.50+' },
    ];
    const mk = () => ({ n: 0, d12: 0, d21: 0, favLed: 0, favLost: 0, htLead: 0 });
    const all = mk();
    const rows = bands.map(() => mk());

    for (const m of this.matches) {
      const oh = m[F.OH], oa = m[F.OA];
      if (!(oh > 1) || !(oa > 1)) continue;
      const htg = m[F.HTG], atg = m[F.ATG];
      if (htg < 0 || atg < 0) continue;
      const hg = m[F.HG], ag = m[F.AG];
      const favHome = oh <= oa;
      const favOdds = favHome ? oh : oa;
      let bi = bands.findIndex((b) => favOdds >= b.lo && favOdds < b.hi);
      if (bi < 0) bi = bands.length - 1;

      const htLeader = htg > atg ? 'h' : htg < atg ? 'a' : 'x';
      const ftHome = hg > ag ? 'h' : hg < ag ? 'a' : 'x';
      const is12 = htLeader === 'h' && ftHome === 'a';
      const is21 = htLeader === 'a' && ftHome === 'h';
      const favLed = (favHome && htLeader === 'h') || (!favHome && htLeader === 'a');
      const favWon = (favHome && ftHome === 'h') || (!favHome && ftHome === 'a');

      for (const t of [all, rows[bi]]) {
        t.n++;
        if (is12) t.d12++;
        if (is21) t.d21++;
        if (htLeader !== 'x') t.htLead++;
        if (favLed) { t.favLed++; if (!favWon) t.favLost++; }
      }
    }

    const pct = (a, b) => (b ? a / b : 0);
    const pack = (t) => ({
      n: t.n,
      donus: pct(t.d12 + t.d21, t.n),
      d12: pct(t.d12, t.n),
      d21: pct(t.d21, t.n),
      htLead: pct(t.htLead, t.n),
      favLedN: t.favLed,
      favLostRate: pct(t.favLost, t.favLed),
    });
    this._cb = {
      total: pack(all),
      bands: bands.map((b, i) => ({ ...b, ...pack(rows[i]) })),
    };
    return this._cb;
  }

  /**
   * Canli (mac ici) olasilik: mevcut skor + dakika.
   * Ikinci yari hiz carpanlari Maçkolik devre arasi modelinden (kalibre edilmis):
   *   favori 1 geride 1.22 · zayif 1 geride 1.09 · berabere 1.02/0.96
   *   favori 1 onde 0.93 · zayif 1 onde 0.92 · zayif 2+ onde 1.29
   */
  liveModel(homeId, awayId, minute, hg, ag, opts = {}) {
    const gm = this.goalModel(homeId, awayId, opts);
    const lamH = gm.lambda.home;
    const lamA = gm.lambda.away;
    const min = Math.max(0, Math.min(95, Number(minute) || 0));
    const remaining = Math.max(0, (95 - min) / 90);

    const favHome = lamH >= lamA;
    const diffH = hg - ag; // ev sahibinin farki

    const mult = (isFav, diff) => {
      const behind2 = diff <= -2, behind1 = diff === -1, level = diff === 0, ahead1 = diff === 1;
      if (isFav) return behind2 ? 1.06 : behind1 ? 1.22 : level ? 1.02 : ahead1 ? 0.93 : 0.96;
      return behind2 ? 1.04 : behind1 ? 1.09 : level ? 0.96 : ahead1 ? 0.92 : 1.29;
    };

    const mH = mult(favHome, diffH);
    const mA = mult(!favHome, -diffH);
    const rh = lamH * remaining * mH;
    const ra = lamA * remaining * mA;

    let pH = 0, pD = 0, pA = 0;
    const MAX = 8;
    for (let i = 0; i <= MAX; i++) {
      for (let j = 0; j <= MAX; j++) {
        const p = poissonPmf(i, rh) * poissonPmf(j, ra);
        const fh = hg + i, fa = ag + j;
        if (fh > fa) pH += p; else if (fh === fa) pD += p; else pA += p;
      }
    }
    const s = pH + pD + pA || 1;
    return {
      minute: min,
      score: { h: hg, a: ag },
      remainingGoals: { home: rh, away: ra, total: rh + ra },
      probs: { h: pH / s, d: pD / s, a: pA / s },
      multipliers: { home: mH, away: mA },
      favourite: favHome ? 'home' : 'away',
      pre: gm.probs,
    };
  }

  /** Ilk yari / mac sonu (IY/MS) olasiliklari — iki yariyi ayri Poisson ile modeller */
  halvesModel(lamH, lamA, share = 0.45) {
    const MAX = 7;
    const pmf = (k, l) => poissonPmf(k, l);
    const htH = lamH * share, htA = lamA * share;
    const shH = lamH * (1 - share), shA = lamA * (1 - share);

    const ht = [], sh = [];
    for (let i = 0; i <= MAX; i++) {
      ht.push([]); sh.push([]);
      for (let j = 0; j <= MAX; j++) {
        ht[i][j] = pmf(i, htH) * pmf(j, htA);
        sh[i][j] = pmf(i, shH) * pmf(j, shA);
      }
    }

    const htProbs = { h: 0, d: 0, a: 0 };
    for (let i = 0; i <= MAX; i++) {
      for (let j = 0; j <= MAX; j++) {
        const r = resOf(i, j);
        htProbs[r === '1' ? 'h' : r === 'X' ? 'd' : 'a'] += ht[i][j];
      }
    }

    const combos = {};
    COMBO_KEYS.forEach((k) => { combos[k] = 0; });
    for (let i = 0; i <= MAX; i++) {
      for (let j = 0; j <= MAX; j++) {
        const p1 = ht[i][j];
        if (p1 < 1e-7) continue;
        const r1 = resOf(i, j);
        for (let k = 0; k <= MAX; k++) {
          for (let l = 0; l <= MAX; l++) {
            const p2 = sh[k][l];
            if (p2 < 1e-7) continue;
            combos[r1 + '/' + resOf(i + k, j + l)] += p1 * p2;
          }
        }
      }
    }

    // kuyruk kirpilmasi nedeniyle normalize et
    let tsum = 0;
    COMBO_KEYS.forEach((k) => { tsum += combos[k]; });
    if (tsum > 0) COMBO_KEYS.forEach((k) => { combos[k] /= tsum; });

    return { ht: htProbs, combos, share };
  }

  goalModel(homeId, awayId, opts = {}) {
    const league = opts.league != null && opts.league >= 0 ? opts.league : this.leagueOf(homeId);
    const lg = this.leagues[league];
    const seasonFrom = opts.seasonFrom != null ? opts.seasonFrom : (this.maxSeason() - 4);
    const r = this.fitRatings(league, {
      seasonFrom, asOf: opts.asOf || this.today, shotWeight: opts.shotWeight != null ? opts.shotWeight : this.shotWeight,
    });
    const th = r.teams.get(homeId);
    const ta = r.teams.get(awayId);

    const attH = th ? th.att : 0, defH = th ? th.def : 0;
    const attA = ta ? ta.att : 0, defA = ta ? ta.def : 0;
    const lamH = Math.exp(r.mu + r.hadv + attH - defA);
    const lamA = Math.exp(r.mu + attA - defH);
    const mx = this.scoreMatrix(lamH, lamA, r.rho);

    return {
      league: lg,
      lambda: { home: lamH, away: lamA, total: lamH + lamA },
      probs: mx.probs,
      ou: mx.ou,
      bands: mx.bands,
      halves: this.halvesModel(lamH, lamA),
      btts: mx.btts,
      expectedGoals: mx.expectedGoals,
      topScores: mx.topScores,
      matrix: mx.matrix,
      ratings: {
        home: th ? { att: th.att, def: th.def } : null,
        away: ta ? { att: ta.att, def: ta.def } : null,
        fitted: r.n, rho: r.rho, avgH: r.avgH, avgA: r.avgA, ok: r.ok,
      },
    };
  }

  /* ---------------- TAKIM PROFILI / H2H ---------------- */

  /** Belirli iki takim arasindaki maci tarihe yakinlikla bulur (kupon sonuclandirma) */
  findMatch(homeId, awayId, dateNum, windowDays = 21) {
    const idxs = this.teamMatches[homeId] || [];
    let best = null, bestDiff = Infinity;
    const useDate = dateNum > 0;
    const target = useDate ? this._dayValue(dateNum) : 0;
    for (let k = idxs.length - 1; k >= 0; k--) {
      const m = this.matches[idxs[k]];
      if (m[F.HOME] !== homeId || m[F.AWAY] !== awayId) continue;
      const diff = useDate ? Math.abs(this._dayValue(m[F.DATE]) - target) : 0;
      if (useDate && diff > windowDays) continue;
      if (diff < bestDiff) { bestDiff = diff; best = m; }
    }
    if (!best) return null;
    return this._row(best, true);
  }

  _dayValue(n) {
    return Math.floor(Date.UTC(Math.floor(n / 10000), Math.floor((n % 10000) / 100) - 1, n % 100) / DAY);
  }

  teamProfile(teamId, limit = 12) {
    const idxs = this.teamMatches[teamId] || [];
    const list = [];
    for (let k = idxs.length - 1; k >= 0 && list.length < limit; k--) {
      const m = this.matches[idxs[k]];
      const isHome = m[F.HOME] === teamId;
      const gf = isHome ? m[F.HG] : m[F.AG];
      const ga = isHome ? m[F.AG] : m[F.HG];
      list.push({
        date: m[F.DATE], league: m[F.LG], opponent: isHome ? m[F.AWAY] : m[F.HOME], home: isHome,
        gf, ga, res: gf > ga ? 'G' : gf === ga ? 'B' : 'M',
        odds: [m[F.OH], m[F.OD], m[F.OA]],
      });
    }
    const stats = { n: list.length, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
    for (const x of list) {
      stats.gf += x.gf; stats.ga += x.ga;
      if (x.res === 'G') stats.w++; else if (x.res === 'B') stats.d++; else stats.l++;
    }
    return { team: this.teams[teamId], matches: list, stats };
  }

  h2h(aId, bId, limit = 15) {
    const out = [];
    let aw = 0, dr = 0, bw = 0, goals = 0, btts = 0, over = 0;
    for (let k = this.matches.length - 1; k >= 0; k--) {
      const m = this.matches[k];
      const h = m[F.HOME], a = m[F.AWAY];
      if (!((h === aId && a === bId) || (h === bId && a === aId))) continue;
      const hg = m[F.HG], ag = m[F.AG];
      goals += hg + ag;
      if (hg > 0 && ag > 0) btts++;
      if (hg + ag > 2.5) over++;
      const winner = hg === ag ? 0 : (h === aId ? (hg > ag ? 1 : -1) : (ag > hg ? 1 : -1));
      if (winner === 0) dr++; else if (winner === 1) aw++; else bw++;
      if (out.length < 400) {
        out.push({
          date: m[F.DATE], league: m[F.LG], home: h, away: a, hg, ag,
          homeWin: hg > ag, draw: hg === ag,
        });
      }
    }
    const n = out.length;
    return {
      total: n,
      aWins: aw, draws: dr, bWins: bw,
      avgGoals: n ? goals / n : 0,
      btts: n ? btts / n : 0,
      over25: n ? over / n : 0,
      matches: out.slice(0, limit),
    };
  }

  /* ---------------- PUAN DURUMU ---------------- */

  leagueTable(league, season) {
    const rows = new Map();
    const get = (t) => {
      if (!rows.has(t)) {
        rows.set(t, {
          team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0,
          hw: 0, hd: 0, hl: 0, aw: 0, ad: 0, al: 0, form: [],
        });
      }
      return rows.get(t);
    };
    for (const i of this.byLeague[league] || []) {
      const m = this.matches[i];
      if (m[F.SEASON] !== season) continue;
      const h = get(m[F.HOME]), a = get(m[F.AWAY]);
      const hg = m[F.HG], ag = m[F.AG];
      h.p++; a.p++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
      if (hg > ag) { h.w++; a.l++; h.hw++; a.al++; h.form.push('G'); a.form.push('M'); }
      else if (hg === ag) { h.d++; a.d++; h.hd++; a.ad++; h.form.push('B'); a.form.push('B'); }
      else { a.w++; h.l++; a.aw++; h.hl++; h.form.push('M'); a.form.push('G'); }
    }
    const list = [...rows.values()].map((r) => ({
      ...r,
      gd: r.gf - r.ga,
      pts: r.w * 3 + r.d,
      form: r.form.slice(-5).join(''),
    }));
    list.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || this.teams[x.team].n.localeCompare(this.teams[y.team].n));
    list.forEach((r, i) => { r.pos = i + 1; });
    return list;
  }

  /* ---------------- ORAN BANT TABLOSU ---------------- */

  bandTable(opts = {}) {
    const { league = -1, seasonFrom = 0, seasonTo = 9999, column = 'home', step = 0.2 } = opts;
    const buckets = new Map();
    for (const m of this.matches) {
      const oH = m[F.OH], oD = m[F.OD], oA = m[F.OA];
      if (!oH || !oD || !oA) continue;
      if (league >= 0 && m[F.LG] !== league) continue;
      if (m[F.SEASON] < seasonFrom || m[F.SEASON] > seasonTo) continue;
      let v;
      if (column === 'home') v = oH;
      else if (column === 'away') v = oA;
      else v = Math.min(oH, oA);
      if (v < 1 || v > 15) continue;
      const lo = Math.max(1, Math.floor(v / step) * step);
      const key = lo.toFixed(2);
      if (!buckets.has(key)) buckets.set(key, { lo, hi: lo + step, n: 0, h: 0, d: 0, a: 0, goals: 0, over: 0 });
      const b = buckets.get(key);
      b.n++; b.goals += m[F.HG] + m[F.AG];
      if (m[F.HG] > m[F.AG]) b.h++; else if (m[F.HG] === m[F.AG]) b.d++; else b.a++;
      if (m[F.HG] + m[F.AG] > 2.5) b.over++;
    }
    return [...buckets.values()].filter((b) => b.n >= 5).sort((a, b) => a.lo - b.lo).map((b) => ({
      label: `${b.lo.toFixed(2)} – ${b.hi.toFixed(2)}`,
      lo: b.lo, n: b.n,
      h: b.h / b.n, d: b.d / b.n, a: b.a / b.n,
      avgGoals: b.goals / b.n, over: b.over / b.n,
    }));
  }

  /* ---------------- BACKTEST / KALIBRASYON ---------------- */

  /**
   * Yurunen (walk-forward) test: model yalnizca gecmis veriyle egitilir,
   * her ay yeniden fit edilir; sonuclar log-loss, Brier, kalibrasyon ve ROI ile raporlanir.
   */
  backtest(opts = {}) {
    const {
      league = 0, seasonFrom = this.maxSeason() - 1, seasonTo = this.maxSeason(),
      refitDays = 35, shotWeight = this.shotWeight,
    } = opts;
    const key = `${league}|${seasonFrom}|${seasonTo}|${refitDays}|${shotWeight}`;
    if (this._btCache.has(key)) return this._btCache.get(key);

    const idxs = (this.byLeague[league] || []).filter((i) => {
      const s = this.matches[i][F.SEASON];
      return s >= seasonFrom && s <= seasonTo;
    });
    if (!idxs.length) {
      const empty = { n: 0, message: 'Bu lig/sezon için maç yok.' };
      this._btCache.set(key, empty);
      return empty;
    }

    let fit = null;
    let nextRefit = 0;
    const metrics = {
      n: 0, skipped: 0,
      llModel: 0, llMarket: 0, llCons: 0,
      brierModel: 0, brierMarket: 0, brierCons: 0,
      hit: 0, hitMarket: 0, hitCons: 0,
      strategies: {
        model: { bets: 0, staked: 0, returned: 0, wins: 0, equity: 0, peak: 0, dd: 0, curve: [] },
        cons: { bets: 0, staked: 0, returned: 0, wins: 0, equity: 0, peak: 0, dd: 0, curve: [] },
      },
      ou: { n: 0, llModel: 0, llMarket: 0, hitModel: 0, hitMarket: 0, bets: 0, profit: 0 },
    };
    const calib = Array.from({ length: 10 }, () => ({ n: 0, sumP: 0, hits: 0 }));
    const calibMarket = Array.from({ length: 10 }, () => ({ n: 0, sumP: 0, hits: 0 }));

    const betOne = (st, prob, odds, outcome, label) => {
      const ev = prob * odds - 1;
      if (ev <= 0.03) return;
      st.bets++;
      st.staked += 1;
      if (label === outcome) { st.returned += odds; st.wins++; st.equity += odds - 1; }
      else st.equity -= 1;
      st.peak = Math.max(st.peak, st.equity);
      st.dd = Math.max(st.dd, st.peak - st.equity);
      if (st.bets % 25 === 0) st.curve.push({ n: st.bets, equity: +st.equity.toFixed(2) });
    };

    for (const i of idxs.sort((a, b) => this.matches[a][F.DATE] - this.matches[b][F.DATE])) {
      const m = this.matches[i];
      const date = m[F.DATE];
      if (!fit || date >= nextRefit) {
        fit = this.fitRatings(league, { seasonFrom: seasonFrom - 3, asOf: date, shotWeight });
        const d = new Date(Date.UTC(Math.floor(date / 10000), Math.floor((date % 10000) / 100) - 1, date % 100));
        d.setUTCDate(d.getUTCDate() + refitDays);
        nextRefit = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
      }
      const th = fit.teams.get(m[F.HOME]);
      const ta = fit.teams.get(m[F.AWAY]);
      if (!th || !ta) { metrics.skipped++; continue; }

      const lamH = Math.exp(fit.mu + fit.hadv + th.att - ta.def);
      const lamA = Math.exp(fit.mu + ta.att - th.def);
      const mx = this.scoreMatrix(lamH, lamA, fit.rho, 8);
      const p = mx.probs;

      const hg = m[F.HG], ag = m[F.AG];
      const outcome = hg > ag ? 0 : hg === ag ? 1 : 2;
      const vec = [p.h, p.d, p.a];
      const onehot = [0, 0, 0];
      onehot[outcome] = 1;

      metrics.n++;
      metrics.llModel += -Math.log(Math.max(1e-9, vec[outcome]));
      metrics.brierModel += vec.reduce((s, v, k) => s + (v - onehot[k]) ** 2, 0);
      if (vec.indexOf(Math.max(...vec)) === outcome) metrics.hit++;

      const bin = Math.min(9, Math.floor(p.h * 10));
      calib[bin].n++; calib[bin].sumP += p.h; if (outcome === 0) calib[bin].hits++;

      const mk = implied(m[F.OH], m[F.OD], m[F.OA]);
      if (!mk) continue;

      const mv = [mk.pH, mk.pD, mk.pA];
      metrics.llMarket += -Math.log(Math.max(1e-9, mv[outcome]));
      metrics.brierMarket += mv.reduce((s, v, k) => s + (v - onehot[k]) ** 2, 0);
      if (mv.indexOf(Math.max(...mv)) === outcome) metrics.hitMarket++;
      const mbin = Math.min(9, Math.floor(mk.pH * 10));
      calibMarket[mbin].n++; calibMarket[mbin].sumP += mk.pH; if (outcome === 0) calibMarket[mbin].hits++;

      // konsensus: piyasa + model karisimi
      const cw = 0.55, cvec = [0, 1, 2].map((k) => cw * mv[k] + (1 - cw) * vec[k]);
      const cs = cvec[0] + cvec[1] + cvec[2];
      const cv = cvec.map((x) => x / cs);
      metrics.llCons += -Math.log(Math.max(1e-9, cv[outcome]));
      metrics.brierCons += cv.reduce((s, v, k) => s + (v - onehot[k]) ** 2, 0);
      if (cv.indexOf(Math.max(...cv)) === outcome) metrics.hitCons++;

      // --- ust/alt 2.5 (oran varsa) ---
      if (m[F.O25] && m[F.U25]) {
        const over = hg + ag > 2.5 ? 1 : 0;
        const po = mx.ou.over2_5;
        const mo = 1 / m[F.O25] / (1 / m[F.O25] + 1 / m[F.U25]);
        metrics.ou.n++;
        metrics.ou.llModel += -(over * Math.log(Math.max(1e-9, po)) + (1 - over) * Math.log(Math.max(1e-9, 1 - po)));
        metrics.ou.llMarket += -(over * Math.log(Math.max(1e-9, mo)) + (1 - over) * Math.log(Math.max(1e-9, 1 - mo)));
        if ((po > 0.5 ? 1 : 0) === over) metrics.ou.hitModel++;
        if ((mo > 0.5 ? 1 : 0) === over) metrics.ou.hitMarket++;
        if (po * m[F.O25] - 1 > 0.03) {
          metrics.ou.bets++;
          if (over) metrics.ou.profit += m[F.O25] - 1; else metrics.ou.profit -= 1;
        }
      }

      // deger stratejisi: ayni bahisci fiyatiyla (marj avantaji yok)
      const prices = [m[F.OH], m[F.OD], m[F.OA]];
      const bestM = vec.indexOf(Math.max(...vec));
      if (vec[bestM] * prices[bestM] - 1 > 0.03) betOne(metrics.strategies.model, vec[bestM], prices[bestM], outcome, bestM);
      const bestC = cv.indexOf(Math.max(...cv));
      if (cv[bestC] * prices[bestC] - 1 > 0.03) betOne(metrics.strategies.cons, cv[bestC], prices[bestC], outcome, bestC);
    }

    const n = metrics.n || 1;
    const strat = (s) => ({
      bets: s.bets,
      staked: s.staked,
      returned: +s.returned.toFixed(2),
      profit: +(s.returned - s.staked).toFixed(2),
      roi: s.staked ? (s.returned - s.staked) / s.staked : 0,
      hitRate: s.bets ? s.wins / s.bets : 0,
      maxDrawdown: +s.dd.toFixed(2),
      curve: s.curve,
    });

    const res = {
      n: metrics.n,
      skipped: metrics.skipped,
      model: {
        logLoss: metrics.llModel / n,
        brier: metrics.brierModel / n,
        hit: metrics.hit / n,
      },
      market: {
        logLoss: metrics.llMarket / n,
        brier: metrics.brierMarket / n,
        hit: metrics.hitMarket / n,
      },
      consensus: {
        logLoss: metrics.llCons / n,
        brier: metrics.brierCons / n,
        hit: metrics.hitCons / n,
      },
      calibration: calib.filter((b) => b.n > 0).map((b) => ({ n: b.n, predicted: b.sumP / b.n, actual: b.hits / b.n })),
      calibrationMarket: calibMarket.filter((b) => b.n > 0).map((b) => ({ n: b.n, predicted: b.sumP / b.n, actual: b.hits / b.n })),
      valueModel: strat(metrics.strategies.model),
      valueCons: strat(metrics.strategies.cons),
      ou25: metrics.ou.n ? {
        n: metrics.ou.n,
        logLossModel: metrics.ou.llModel / metrics.ou.n,
        logLossMarket: metrics.ou.llMarket / metrics.ou.n,
        hitModel: metrics.ou.hitModel / metrics.ou.n,
        hitMarket: metrics.ou.hitMarket / metrics.ou.n,
        bets: metrics.ou.bets,
        profit: +metrics.ou.profit.toFixed(2),
        roi: metrics.ou.bets ? metrics.ou.profit / metrics.ou.bets : 0,
      } : null,
      league, seasonFrom, seasonTo, shotWeight,
    };
    this._btCache.set(key, res);
    return res;
  }

  /* ---------------- FIKSTUR / MAC LISTESI ---------------- */

  matchList(opts = {}) {
    const { league = -1, limit = 60, mode = 'recent' } = opts;
    const out = [];
    if (mode === 'fixtures' || mode === 'all') {
      for (const m of this.fixtures) {
        if (league >= 0 && m[F.LG] !== league) continue;
        // yalnizca bugun veya sonrasi (arsivdeki eski "oynanmamis" kayitlar sizmasin)
        if (m[F.DATE] < this.today) continue;
        if (m[F.HG] < 0 || m[F.AG] < 0) continue;
        out.push(this._row(m, false));
      }
      if (mode === 'fixtures') {
        out.sort((a, b) => a.date - b.date);
        return out.slice(0, limit);
      }
      // mode === 'all': fikstur + son oynananlar birlikte, tarihe gore
      const pool = league >= 0 ? this.byLeague[league] : null;
      const src = pool || null;
      if (src) {
        for (let k = src.length - 1; k >= 0 && out.length < limit + 120; k--) out.push(this._row(this.matches[src[k]], true));
      } else {
        for (let k = this.matches.length - 1; k >= 0 && out.length < limit + 120; k--) out.push(this._row(this.matches[k], true));
      }
      out.sort((a, b) => b.date - a.date);
      return out.slice(0, limit);
    }
    const pool = league >= 0 ? this.byLeague[league] : null;
    const src = pool || null;
    if (src) {
      for (let k = src.length - 1; k >= 0 && out.length < limit; k--) out.push(this._row(this.matches[src[k]], true));
    } else {
      for (let k = this.matches.length - 1; k >= 0 && out.length < limit; k--) out.push(this._row(this.matches[k], true));
    }
    return out;
  }

  _row(m, played) {
    return {
      date: m[F.DATE], league: m[F.LG], home: m[F.HOME], away: m[F.AWAY],
      hg: m[F.HG], ag: m[F.AG], played,
      odds: [m[F.OH], m[F.OD], m[F.OA]],
      max: [m[F.MAXH], m[F.MAXD], m[F.MAXA]],
      season: m[F.SEASON],
    };
  }

  /* ---------------- ARAMA ---------------- */

  searchTeams(q, limit = 25) {
    const s = String(q || '').toLocaleLowerCase('tr');
    if (!s) return [];
    const out = [];
    for (let i = 0; i < this.teams.length; i++) {
      const t = this.teams[i];
      const n = t.n.toLocaleLowerCase('tr');
      const idx = n.indexOf(s);
      if (idx >= 0) out.push({ id: i, name: t.n, league: t.l, leagueName: (this.leagues[t.l] || {}).name, score: idx === 0 ? 0 : 1 + idx });
    }
    out.sort((a, b) => a.score - b.score || a.name.length - b.name.length);
    return out.slice(0, limit);
  }

  teamNames() {
    return this.teams.map((t, i) => ({ id: i, n: t.n, l: t.l }));
  }
}

module.exports = { Engine, F, implied, impliedPower, wilson, poissonPmf, seasonLabel };
