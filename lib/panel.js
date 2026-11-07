/**
 * 20 Maçlık İstatistik Paneli (Nexora tarzı) — bwin oran eşleşmesi
 * UMD: Node'da require, tarayıcıda window.OranPanel
 *
 * Mantık:
 *   Girilen bwin 1-X-2 (ve varsa 2.5 Alt/Üst) oranına en yakın N geçmiş maç bulunur.
 *   Uzaklık, oranların logaritmik farkıdır:  Σ |ln(o_i / q_i)|
 *   (1.40 ile 1.45 arasındaki fark, 6.00 ile 6.05 arasındakinden daha önemli sayılır.)
 *   Bulunan maçlardan İY 0.5/1.5 Üst, KG Var, MS 2.5/3.5 Üst, 1-X-2, İY/MS ve skor trendleri çıkar.
 *
 * Maç dizisi alanları (tools/build.js, şema v2):
 *   0 tarih, 1 lig, 2 ev, 3 dep, 4 evGol, 5 depGol, 6 evİY, 7 depİY,
 *   11-13 bwin kapanış 1-X-2 (2019/20'den beri), 17 2.5 Üst, 18 2.5 Alt, 19 sezon, 22-24 bwin açılış 1-X-2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OranPanel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const I = { DATE: 0, LG: 1, HOME: 2, AWAY: 3, HG: 4, AG: 5, HTG: 6, ATG: 7, BCH: 11, BCD: 12, BCA: 13, O25: 17, U25: 18, SEASON: 19, BWH: 22, BWD: 23, BWA: 24 };

  /** maç başına ortalama golü bu değerin altında kalan ligler "düşük skorlu" sayılır */
  const LOW_SCORING_AVG = 2.45;

  /** 2.5 Alt/Üst oranının uzaklıktaki ağırlığı (1-X-2'nin her biri = 1) */
  const OU_WEIGHT = 0.8;

  const resOf = (h, a) => (h > a ? '1' : h === a ? 'X' : '2');

  function wilson(k, n, z = 1.96) {
    if (!n) return { lo: 0, hi: 0 };
    const p = k / n;
    const den = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / den;
    const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
    return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
  }

  function createPanel(engine) {
    const M = engine.matches;
    const n = M.length;

    /* ---- önhesap: log oranlar (hızlı tarama için) ---- */
    const lh = new Float64Array(n), ld = new Float64Array(n), la = new Float64Array(n);
    const lo = new Float64Array(n), lu = new Float64Array(n);
    const ok = new Uint8Array(n);   // bwin açılış 1-X-2 var mı
    const ch = new Float64Array(n), cd = new Float64Array(n), ca = new Float64Array(n);
    const okC = new Uint8Array(n);  // bwin kapanış 1-X-2 var mı
    const okOU = new Uint8Array(n); // 2.5 Alt/Üst var mı
    for (let i = 0; i < n; i++) {
      const m = M[i];
      const h = m[I.BWH], d = m[I.BWD], a = m[I.BWA];
      if (h > 1 && d > 1 && a > 1) {
        ok[i] = 1;
        lh[i] = Math.log(h); ld[i] = Math.log(d); la[i] = Math.log(a);
      }
      if (m[I.BCH] > 1 && m[I.BCD] > 1 && m[I.BCA] > 1) {
        okC[i] = 1;
        ch[i] = Math.log(m[I.BCH]); cd[i] = Math.log(m[I.BCD]); ca[i] = Math.log(m[I.BCA]);
      }
      if (m[I.O25] > 1 && m[I.U25] > 1) {
        okOU[i] = 1;
        lo[i] = Math.log(m[I.O25]); lu[i] = Math.log(m[I.U25]);
      }
    }

    let bwinRows = 0;
    for (let i = 0; i < n; i++) bwinRows += ok[i];

    /* ---- lig ortalamaları + düşük skorlu ligler ---- */
    const lowLeagues = new Set();
    engine.leagues.forEach((l, i) => {
      const avg = (l.avgHome || 0) + (l.avgAway || 0);
      if (avg && avg < LOW_SCORING_AVG) lowLeagues.add(i);
    });

    /* ---- arşiv geneli taban oranlar (karşılaştırma için) ---- */
    const base = (() => {
      const s = newStats();
      for (let i = 0; i < n; i++) if (ok[i]) addStats(s, M[i]);
      return finishStats(s);
    })();

    function newStats() {
      return { n: 0, htN: 0, iy05: 0, iy15: 0, kg: 0, o25: 0, o35: 0, g6: 0, goals: 0, r1: 0, rX: 0, r2: 0, htft: {}, ht: {}, ft: {} };
    }

    function addStats(s, m) {
      const hg = m[I.HG], ag = m[I.AG], t = hg + ag;
      s.n++;
      s.goals += t;
      if (hg > 0 && ag > 0) s.kg++;
      if (t >= 3) s.o25++;
      if (t >= 4) s.o35++;
      if (t >= 6) s.g6++;
      const r = resOf(hg, ag);
      if (r === '1') s.r1++; else if (r === 'X') s.rX++; else s.r2++;
      const ft = hg + '-' + ag;
      s.ft[ft] = (s.ft[ft] || 0) + 1;
      const hh = m[I.HTG], ha = m[I.ATG];
      if (hh >= 0 && ha >= 0) {
        s.htN++;
        if (hh + ha >= 1) s.iy05++;
        if (hh + ha >= 2) s.iy15++;
        const k = resOf(hh, ha) + '/' + r;
        s.htft[k] = (s.htft[k] || 0) + 1;
        const hs = hh + '-' + ha;
        s.ht[hs] = (s.ht[hs] || 0) + 1;
      }
    }

    function finishStats(s) {
      const N = s.n || 1, H = s.htN || 1;
      const card = (k, den) => ({ k, n: den, p: den ? k / den : 0, ci: wilson(k, den) });
      const trend = (obj, den) => Object.entries(obj)
        .map(([score, c]) => ({ score, count: c, p: c / (den || 1) }))
        .sort((a, b) => b.count - a.count || a.score.localeCompare(b.score));
      return {
        n: s.n,
        htN: s.htN,
        iy05: card(s.iy05, s.htN),
        iy15: card(s.iy15, s.htN),
        kg: card(s.kg, s.n),
        o25: card(s.o25, s.n),
        o35: card(s.o35, s.n),
        g6: card(s.g6, s.n),
        avgGoals: s.goals / N,
        res: { h: s.r1 / N, d: s.rX / N, a: s.r2 / N, counts: { h: s.r1, d: s.rX, a: s.r2 } },
        htft: trend(s.htft, H),
        htTrend: trend(s.ht, H),
        ftTrend: trend(s.ft, N),
      };
    }

    /** Tahmin etiketi — yalnızca bulunan maçların dağılımına dayanır */
    function verdict(st) {
      const o25 = st.o25.p, kg = st.kg.p;
      let label, tone;
      if (o25 >= 0.70 && kg >= 0.65) { label = '2.5 ÜST / KG VAR — Güçlü Gollü Maç'; tone = 'up'; }
      else if (o25 >= 0.65) { label = '2.5 ÜST — Gollü Maç Eğilimi'; tone = 'up'; }
      else if (o25 <= 0.30 && kg <= 0.35) { label = '2.5 ALT / KG YOK — Düşük Skorlu Maç'; tone = 'down'; }
      else if (o25 <= 0.35) { label = '2.5 ALT — Az Gollü Maç Eğilimi'; tone = 'down'; }
      else if (kg >= 0.65) { label = 'KG VAR Eğilimi'; tone = 'up'; }
      else if (kg <= 0.35) { label = 'KG YOK Eğilimi'; tone = 'down'; }
      else { label = 'Net sinyal yok — Dengeli dağılım'; tone = 'flat'; }

      const r = st.res;
      const mx = Math.max(r.h, r.d, r.a);
      let side = null;
      if (mx >= 0.6) side = mx === r.h ? `Ev sahibi ağırlıklı (%${Math.round(r.h * 100)})` : mx === r.a ? `Deplasman ağırlıklı (%${Math.round(r.a * 100)})` : `Beraberlik ağırlıklı (%${Math.round(r.d * 100)})`;
      return { label, tone, side };
    }

    /**
     * @param input { h, d, a, o?, u?, homeName?, awayName?, date? }  bwin oranları
     * @param opts  { count=20, useOU=true, excludeLow=false, sameLeague=-1, before=0 (yyyymmdd; bu tarihten önceki maçlar) }
     */
    function analyze(input, opts = {}) {
      const h = +input.h, d = +input.d, a = +input.a;
      if (!(h > 1 && d > 1 && a > 1)) throw new Error('1, X ve 2 oranlarını girin (hepsi 1,00\'den büyük olmalı).');
      if (!bwinRows) throw new Error('Bu veri paketinde bwin oranları yok (eski paket). Veri sekmesinden veriyi güncelleyin.');
      const count = Math.max(5, Math.min(100, Number(opts.count) || 20));
      const o = +input.o || 0, u = +input.u || 0;
      const useOU = opts.useOU !== false && o > 1;
      const excludeLow = !!opts.excludeLow;
      const sameLeague = opts.sameLeague != null ? Number(opts.sameLeague) : -1;
      const before = Number(opts.before) || 0;
      const close = opts.line === 'close';
      const exactMode = opts.match !== 'near'; // varsayılan: en az 2 oran birebir aynı olanlar önce
      const rawH = close ? I.BCH : I.BWH, rawD = close ? I.BCD : I.BWD, rawA = close ? I.BCA : I.BWA;
      const A1 = close ? ch : lh, AX = close ? cd : ld, A2 = close ? ca : la, OK = close ? okC : ok;

      const th = Math.log(h), td = Math.log(d), ta = Math.log(a);
      const to = o > 1 ? Math.log(o) : 0, tu = u > 1 ? Math.log(u) : 0;

      // en iyi N'i tut (küçük N için ekleme sıralaması yeterli)
      const best = []; // [dist, i]
      let worst = Infinity;
      for (let i = 0; i < n; i++) {
        if (!OK[i]) continue;
        if (useOU && !okOU[i]) continue;
        const m = M[i];
        if (before && m[I.DATE] >= before) continue;
        if (excludeLow && lowLeagues.has(m[I.LG])) continue;
        if (sameLeague >= 0 && m[I.LG] !== sameLeague) continue;
        let dist = Math.abs(A1[i] - th) + Math.abs(AX[i] - td) + Math.abs(A2[i] - ta);
        if (useOU) {
          let dou = Math.abs(lo[i] - to);
          if (tu) dou = (dou + Math.abs(lu[i] - tu)) / 2;
          dist += OU_WEIGHT * dou;
        }
        if (exactMode) {
          const ex = (Math.abs(m[rawH] - h) < 0.005) + (Math.abs(m[rawD] - d) < 0.005) + (Math.abs(m[rawA] - a) < 0.005);
          if (ex < 2) dist += 10; // birebir olmayanlar ancak yeterli birebir maç yoksa girer
        }
        if (best.length >= count && dist >= worst) continue;
        // yerleştir (eşitlikte yeni tarih önde)
        let p = best.length;
        while (p > 0 && (best[p - 1][0] > dist || (best[p - 1][0] === dist && M[best[p - 1][1]][I.DATE] < m[I.DATE]))) p--;
        best.splice(p, 0, [dist, i]);
        if (best.length > count) best.pop();
        worst = best.length >= count ? best[best.length - 1][0] : Infinity;
      }

      const s = newStats();
      let exactRows = 0;
      const rows = best.map(([dist0, i]) => {
        const m = M[i];
        const exact = dist0 < 10;
        if (exactMode && exact) exactRows++;
        const dist = exactMode && !exact ? dist0 - 10 : dist0;
        addStats(s, m);
        const hg = m[I.HG], ag = m[I.AG], hh = m[I.HTG], ha = m[I.ATG];
        const lg = engine.leagues[m[I.LG]] || {};
        return {
          date: m[I.DATE],
          league: lg.name || lg.code || '',
          leagueCode: lg.code || '',
          home: engine.teams[m[I.HOME]] ? engine.teams[m[I.HOME]].n : '?',
          away: engine.teams[m[I.AWAY]] ? engine.teams[m[I.AWAY]].n : '?',
          ht: hh >= 0 ? `${hh}-${ha}` : '',
          ft: `${hg}-${ag}`,
          htft: hh >= 0 ? `${resOf(hh, ha)}/${resOf(hg, ag)}` : '',
          goals: hg + ag,
          rocket: hg + ag >= 6,
          o1: close ? m[I.BCH] : m[I.BWH], oX: close ? m[I.BCD] : m[I.BWD], o2: close ? m[I.BCA] : m[I.BWA],
          c1: m[I.BCH] || 0, cX: m[I.BCD] || 0, c2: m[I.BCA] || 0,
          under25: m[I.U25] || 0, over25: m[I.O25] || 0,
          dist: +dist.toFixed(4),
          exact: exactMode ? exact : null,
        };
      });
      rows.sort((x, y) => y.date - x.date);

      const stats = finishStats(s);
      const maxDist = best.length ? (best[best.length - 1][0] % 10) : 0;
      const notes = [];
      if (o > 1 && !useOU) notes.push('2.5 Alt/Üst oranı eşleştirmeye katılmadı.');
      if (close) notes.push('bwin kapanış oranı 2019/20 sezonundan beri var; eşleşme bu maçlardan yapıldı.');
      else if (useOU) notes.push('2.5 Alt/Üst oranı yalnızca 2017/18 sonrası maçlarda var; eşleşme bu maçlardan yapıldı.');
      if (maxDist > 0.25) notes.push('Bu oran dizilimi arşivde nadir; en uzak eşleşme oranlardan belirgin şekilde farklı.');
      if (best.length < count) notes.push(`Yalnızca ${best.length} uygun maç bulundu.`);
      if (exactMode) notes.unshift(exactRows >= best.length
        ? `${exactRows} maçın hepsinde en az 2 oran birebir aynı.`
        : `${exactRows} maçta en az 2 oran birebir aynı; kalan ${best.length - exactRows} maç en yakın oranlardan tamamlandı.`);

      const homeId = resolveTeam(input.home, input.homeName);
      const awayId = resolveTeam(input.away, input.awayName);
      const model = opts.model === false ? null : teamModel(homeId, awayId);
      // İY/MS: 9 kombinasyonun tamamı (benzer maçlar)
      const htftAll = ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'].map((k) => {
        const f = stats.htft.find((x) => x.score === k);
        return { k, count: f ? f.count : 0, p: f ? f.p : 0, model: model && model.htft ? model.htft[k] : null };
      });

      return {
        source: 'bwin',
        model,
        htftAll,
        input: { h, d, a, o: o || null, u: u || null, homeName: input.homeName || '', awayName: input.awayName || '' },
        options: { count, useOU, excludeLow, sameLeague, before, line: close ? 'close' : 'open', match: exactMode ? 'exact' : 'near' },
        exactRows,
        found: best.length,
        maxDist: +maxDist.toFixed(4),
        stats,
        base: { iy05: base.iy05.p, iy15: base.iy15.p, kg: base.kg.p, o25: base.o25.p, o35: base.o35.p, g6: base.g6.p },
        verdict: verdict(stats),
        rows,
        notes,
        lowLeagues: [...lowLeagues].map((i) => engine.leagues[i].name),
      };
    }

    /** Takım id'si ya da adından takım bul */
    function resolveTeam(id, name) {
      if (id != null && id !== '' && Number(id) >= 0 && engine.teams[Number(id)]) return Number(id);
      const nm = String(name || '').trim();
      if (!nm || !engine.searchTeams) return null;
      const hit = engine.searchTeams(nm, 1)[0];
      return hit ? hit.id : null;
    }

    const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

    /** Gol modeli (Poisson/Dixon-Coles): MS ve İY skor tahmini, İY/MS, 2.5 Üst, KG */
    function teamModel(home, away) {
      if (home == null || away == null || home === away || !engine.goalModel) return null;
      try {
        const g = engine.goalModel(home, away, { league: engine.leagueOf(home), seasonFrom: engine.maxSeason() - 4 });
        const share = (g.halves && g.halves.share) || 0.45;
        const hH = g.lambda.home * share, hA = g.lambda.away * share;
        const ht = [];
        let iy05 = 0, iy15 = 0;
        for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) {
          const p = pois(i, hH) * pois(j, hA);
          ht.push({ s: `${i}-${j}`, p });
          if (i + j >= 1) iy05 += p;
          if (i + j >= 2) iy15 += p;
        }
        ht.sort((a, b) => b.p - a.p);
        const ou = g.ou || {};
        const o25 = ou.over2_5 != null ? ou.over2_5 : null;
        const o35 = ou.over3_5 != null ? ou.over3_5 : null;
        return {
          home: engine.teams[home].n, away: engine.teams[away].n,
          lambda: g.lambda,
          res: g.probs,
          ftScores: (g.topScores || []).slice(0, 6),
          htScores: ht.slice(0, 6),
          htft: g.halves ? g.halves.combos : null,
          iy05, iy15,
          o25, o35,
          kg: typeof g.btts === 'number' ? g.btts : null,
        };
      } catch (_) { return null; }
    }

    /**
     * Dürüstlük testi: panelin etiketleri geçmişte ne kadar tuttu?
     * Her test maçı için yalnızca o maçtan ÖNCEKİ maçlarla panel kurulur (veri sızıntısı yok).
     */
    function backtest(opts = {}) {
      const from = Number(opts.from) || 20240701;
      const to = Number(opts.to) || 99999999;
      const limit = Math.max(50, Math.min(5000, Number(opts.limit) || 1500));
      const count = Number(opts.count) || 20;
      const useOU = opts.useOU !== false;
      const idx = [];
      for (let i = 0; i < n; i++) {
        const m = M[i];
        if (!ok[i] || m[I.DATE] < from || m[I.DATE] > to) continue;
        if (useOU && !okOU[i]) continue;
        idx.push(i);
      }
      // eşit aralıklı örnek
      const step = Math.max(1, Math.floor(idx.length / limit));
      const sample = idx.filter((_, k) => k % step === 0).slice(0, limit);

      const byLabel = {};
      const mk = () => ({ n: 0, o25: 0, kg: 0, o35: 0, u25: 0, kgNo: 0 });
      const all = mk();
      let o25Brier = 0, o25BaseBrier = 0;
      for (const i of sample) {
        const m = M[i];
        const r = analyze(
          { h: m[I.BWH], d: m[I.BWD], a: m[I.BWA], o: useOU ? m[I.O25] : 0, u: useOU ? m[I.U25] : 0 },
          { count, useOU, before: m[I.DATE] }
        );
        const t = m[I.HG] + m[I.AG];
        const kg = m[I.HG] > 0 && m[I.AG] > 0;
        const b = byLabel[r.verdict.label] || (byLabel[r.verdict.label] = mk());
        for (const x of [b, all]) {
          x.n++;
          if (t >= 3) x.o25++; else x.u25++;
          if (t >= 4) x.o35++;
          if (kg) x.kg++; else x.kgNo++;
        }
        const y = t >= 3 ? 1 : 0;
        o25Brier += (r.stats.o25.p - y) ** 2;
        // piyasa: 2.5 Üst oranından marjsız olasılık
        if (m[I.O25] > 1 && m[I.U25] > 1) {
          const po = (1 / m[I.O25]) / (1 / m[I.O25] + 1 / m[I.U25]);
          o25BaseBrier += (po - y) ** 2;
        }
      }
      const fmt = (x) => ({ n: x.n, o25: x.o25 / (x.n || 1), kg: x.kg / (x.n || 1), o35: x.o35 / (x.n || 1) });
      return {
        sample: sample.length,
        from, to, count, useOU,
        all: fmt(all),
        labels: Object.entries(byLabel).map(([label, x]) => ({ label, ...fmt(x) })).sort((p, q) => q.n - p.n),
        brier: {
          panel: o25Brier / (sample.length || 1),
          market: useOU ? o25BaseBrier / (sample.length || 1) : null,
        },
      };
    }

    return { analyze, backtest, base, lowLeagues };
  }

  return { createPanel, LOW_SCORING_AVG };
});
