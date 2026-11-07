/**
 * Analiz bilesenleri (sunucu ve mobil ortak kullanim)
 * UMD: Node'da require, tarayicida window.OranAnalyze
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OranAnalyze = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function blend(parts) {
    const tot = parts.reduce((s, x) => s + x.w, 0) || 1;
    const out = { h: 0, d: 0, a: 0 };
    for (const x of parts) {
      out.h += (x.p.h * x.w) / tot;
      out.d += (x.p.d * x.w) / tot;
      out.a += (x.p.a * x.w) / tot;
    }
    const s = out.h + out.d + out.a || 1;
    return { h: out.h / s, d: out.d / s, a: out.a / s };
  }

  function buildVerdict(r) {
    const out = [];
    if (r.history && r.history.count > 0) {
      const h = r.history;
      const max = Math.max(h.dist.h, h.dist.d, h.dist.a);
      const lbl = max === h.dist.h ? 'ev sahibi galibiyeti' : max === h.dist.d ? 'beraberlik' : 'deplasman galibiyeti';
      out.push(`Aynı oran bandındaki ${h.count} maçta en sık sonuç %${(max * 100).toFixed(0)} ile ${lbl}.`);
    }
    if (r.model) {
      out.push(`Model beklenen gol: ${r.model.lambda.home.toFixed(2)} – ${r.model.lambda.away.toFixed(2)} (toplam ${r.model.lambda.total.toFixed(2)}).`);
    }
    if (r.value && r.value.length) {
      const best = r.value[0];
      if (best.ev > 0.02) {
        out.push(`En yüksek değer: ${best.label} — model %${(best.modelP * 100).toFixed(1)}, piyasa %${(best.marketP * 100).toFixed(1)}, EV +%${(best.ev * 100).toFixed(1)}.`);
      } else {
        out.push('Model ile piyasa arasında anlamlı bir değer farkı görünmüyor.');
      }
    }
    if (r.h2h && r.h2h.total) {
      out.push(`Son ${r.h2h.total} karşılaşmada ${r.h2h.aWins} / ${r.h2h.draws} / ${r.h2h.bWins}.`);
    }
    return out;
  }

  /**
   * @param {object} engine  Engine ornegi
   * @param {object} meta    { matches, firstDate, lastDate }
   */
  function createAnalyzer(engine, impliedMod, meta) {
    const implied = impliedMod.implied;
    const impliedPower = impliedMod.impliedPower;

    function analyze(body) {
      const home = body.homeId != null && body.homeId >= 0 ? Number(body.homeId) : null;
      const away = body.awayId != null && body.awayId >= 0 ? Number(body.awayId) : null;
      const odds = body.odds && +body.odds.h > 1 && +body.odds.d > 1 && +body.odds.a > 1
        ? { h: +body.odds.h, d: +body.odds.d, a: +body.odds.a } : null;

      if (!odds && home == null) throw new Error('Oran veya maç seçmelisiniz.');

      const seasonFrom = Number(body.seasonFrom || 2004);
      const seasonTo = Number(body.seasonTo || 2599);
      const leagueScope = body.leagueScope === 'all'
        ? -1
        : (body.leagueId != null ? Number(body.leagueId) : (home != null ? engine.leagueOf(home) : -1));
      const mode = body.mode === 'exact' ? 'exact' : 'near';
      const tol = Math.min(0.25, Math.max(0.002, Number(body.tol || 0.02)));

      const result = {
        input: {
          home: home != null ? { id: home, name: engine.teams[home].n, league: engine.leagueOf(home) } : null,
          away: away != null ? { id: away, name: engine.teams[away].n, league: engine.leagueOf(away) } : null,
          odds, seasonFrom, seasonTo, mode, tol, leagueScope,
        },
        notes: [],
      };

      if (odds) {
        const p = implied(odds.h, odds.d, odds.a);
        const pw = impliedPower(odds.h, odds.d, odds.a);
        result.market = {
          probs: { h: p.pH, d: p.pD, a: p.pA },
          probsPower: pw && pw.pH ? { h: pw.pH, d: pw.pD, a: pw.pA } : null,
          overround: p.overround,
          fair: { h: 1 / p.pH, d: 1 / p.pD, a: 1 / p.pA },
          impliedRaw: p.raw,
        };
      }

      if (odds) {
        let hist = engine.summarizeSimilar(odds, { mode, tol, league: leagueScope, seasonFrom, seasonTo });
        if (hist.count < 15 && leagueScope >= 0) {
          const wide = engine.summarizeSimilar(odds, { mode, tol, league: -1, seasonFrom, seasonTo });
          if (wide.count > hist.count * 1.5) {
            wide.scopeAll = true;
            result.notes.push('Aynı ligde yeterli örnek yok; tüm ligler dahil edildi.');
            hist = wide;
          }
        }
        result.history = hist;
      }

      if (home != null && away != null && home !== away) {
        const lg = engine.leagueOf(home);
        result.model = engine.goalModel(home, away, { league: lg, seasonFrom: engine.maxSeason() - 4 });
        result.form = { home: engine.teamProfile(home, 8), away: engine.teamProfile(away, 8) };
        result.h2h = engine.h2h(home, away, 10);

        /* fikstur zinciri + ilk yari cift sans */
        try {
          result.chain = engine.chain(home, away, 5);
          result.hdc = engine.halfDoubleChance(home, away, { league: lg, seasonFrom: engine.maxSeason() - 4 });
        } catch (_) { result.chain = null; result.hdc = null; }

        /* donus (1/2 - 2/1) — arsiv geneli + favori oran bandi */
        try {
          const cb = engine.comebackTable();
          const favOdds = odds && odds.h > 1 && odds.a > 1
            ? Math.min(odds.h, odds.a)
            : Math.min(Number(body.oH) || 0, Number(body.oA) || 0);
          const band = favOdds > 1
            ? cb.bands.find((b) => favOdds >= b.lo && favOdds < b.hi) || cb.bands[cb.bands.length - 1]
            : null;
          result.comeback = { total: cb.total, band, favOdds: favOdds > 1 ? favOdds : null };
        } catch (_) { result.comeback = null; }

        /* canli model — yalniz mac basladiysa */
        const minute = Number(body.minute);
        const lh = body.liveH != null ? Number(body.liveH) : null;
        const la = body.liveA != null ? Number(body.liveA) : null;
        if (minute > 0 && lh != null && la != null && !isNaN(lh) && !isNaN(la)) {
          try {
            result.live = engine.liveModel(home, away, minute, lh, la, { league: lg, seasonFrom: engine.maxSeason() - 4 });
          } catch (_) { result.live = null; }
        }

        const season = engine.maxSeason();
        try {
          const tbl = engine.leagueTable(lg, season);
          const posOf = (id) => {
            const r = tbl.find((x) => x.team === id);
            return r ? { pos: r.pos, pts: r.pts, p: r.p, gd: r.gd, form: r.form } : null;
          };
          result.positions = { home: posOf(home), away: posOf(away), season, league: lg };
        } catch (_) { result.positions = null; }
      }

      const parts = [];
      if (result.market) parts.push({ p: result.market.probs, w: Number(body.wMarket != null ? body.wMarket : 0.45), name: 'market' });
      if (result.model) parts.push({ p: result.model.probs, w: Number(body.wModel != null ? body.wModel : 0.35), name: 'model' });
      if (result.history && result.history.count >= 10) {
        parts.push({ p: result.history.dist, w: Number(body.wHistory != null ? body.wHistory : 0.20), name: 'history' });
      }
      if (parts.length) {
        const b = blend(parts);
        const tot = parts.reduce((s, x) => s + x.w, 0) || 1;
        result.consensus = {
          probs: { h: b.h, d: b.d, a: b.a },
          parts: parts.map((x) => x.name),
          weights: parts.map((x) => ({ name: x.name, w: x.w / tot })),
        };
      }

      if (result.model) {
        const rows = [];
        const add = (label, modelP, marketP, o) => {
          if (!o || !(o > 1)) return;
          const ev = modelP * o - 1;
          const kelly = (modelP * (o - 1) - (1 - modelP)) / (o - 1);
          rows.push({
            label, odds: o, modelP, marketP, fairOdds: modelP > 0 ? 1 / modelP : 0,
            edge: modelP - marketP, ev, kelly: Math.max(0, kelly),
          });
        };
        const mk = result.market ? result.market.probs : null;
        const p = result.model.probs;
        if (odds && mk) {
          add('1 (Ev Sahibi)', p.h, mk.h, odds.h);
          add('X (Beraberlik)', p.d, mk.d, odds.d);
          add('2 (Deplasman)', p.a, mk.a, odds.a);
        }
        if (body.ou && +body.ou.over > 1 && +body.ou.under > 1) {
          const s = 1 / +body.ou.over + 1 / +body.ou.under;
          add('Üst 2.5', result.model.ou.over2_5, (1 / +body.ou.over) / s, +body.ou.over);
          add('Alt 2.5', result.model.ou.under2_5, (1 / +body.ou.under) / s, +body.ou.under);
        }
        if (body.btts && +body.btts.yes > 1 && +body.btts.no > 1) {
          const s = 1 / +body.btts.yes + 1 / +body.btts.no;
          add('KG Var', result.model.btts, (1 / +body.btts.yes) / s, +body.btts.yes);
          add('KG Yok', 1 - result.model.btts, (1 / +body.btts.no) / s, +body.btts.no);
        }
        rows.sort((a, b) => b.ev - a.ev);
        result.value = rows;

        result.modelFair = {
          h: 1 / p.h, d: 1 / p.d, a: 1 / p.a,
          over2_5: 1 / result.model.ou.over2_5,
          under2_5: 1 / result.model.ou.under2_5,
          bttsYes: 1 / result.model.btts,
          bttsNo: 1 / (1 - result.model.btts),
        };
      }

      result.verdict = buildVerdict(result);
      result.dataInfo = { matches: meta.matches, firstDate: meta.firstDate, lastDate: meta.lastDate };
      return result;
    }

    return { analyze };
  }

  return { createAnalyzer, blend, buildVerdict };
});
