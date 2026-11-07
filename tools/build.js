/**
 * data/raw/<sezon>/<LIG>.csv  ->  data/db.json   (sema v2)
 * Kullanim: node tools/build.js
 *
 * Mac semasi (dizi):
 *  0 date, 1 league, 2 home, 3 away, 4 hg, 5 ag, 6 htg, 7 atg,
 *  8 bwH, 9 bwD, 10 bwA,        (bwin ACILIS 1-X-2 — sistemin ana orani)
 *  11 bwcH, 12 bwcD, 13 bwcA,    (bwin KAPANIS 1-X-2; 2019/20'den beri, yoksa 0)
 *  14 maxH, 15 maxD, 16 maxA,    (bwin kapanis, yoksa bwin acilis)
 *  17 over25, 18 under25,
 *  19 season (baslangic yili),
 *  20 hst, 21 ast                 (isabetli sut; yoksa -1)
 *  22 bwH, 23 bwD, 24 bwA         (bwin acilis 1-X-2; yoksa 0)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'db.json');

const LEAGUE_META = {
  T1: { name: 'Türkiye Süper Lig', country: 'Türkiye', tier: 1 },
  E0: { name: 'İngiltere Premier Lig', country: 'İngiltere', tier: 1 },
  E1: { name: 'İngiltere Championship', country: 'İngiltere', tier: 2 },
  E2: { name: 'İngiltere League One', country: 'İngiltere', tier: 3 },
  D1: { name: 'Almanya Bundesliga', country: 'Almanya', tier: 1 },
  D2: { name: 'Almanya 2. Bundesliga', country: 'Almanya', tier: 2 },
  SP1: { name: 'İspanya La Liga', country: 'İspanya', tier: 1 },
  SP2: { name: 'İspanya Segunda', country: 'İspanya', tier: 2 },
  F1: { name: 'Fransa Ligue 1', country: 'Fransa', tier: 1 },
  F2: { name: 'Fransa Ligue 2', country: 'Fransa', tier: 2 },
  N1: { name: 'Hollanda Eredivisie', country: 'Hollanda', tier: 1 },
  B1: { name: 'Belçika Pro Lig', country: 'Belçika', tier: 1 },
  P1: { name: 'Portekiz Primeira Liga', country: 'Portekiz', tier: 1 },
  G1: { name: 'Yunanistan Süper Lig', country: 'Yunanistan', tier: 1 },
  SC0: { name: 'İskoçya Premiership', country: 'İskoçya', tier: 1 },
  SC1: { name: 'İskoçya Championship', country: 'İskoçya', tier: 2 },
};

// Ayni kulubun farkli yazimlari: lib/aliases.js (fikstur okuyucu da kullanir)
const TEAM_ALIASES = require('../lib/aliases');

function parseCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function num(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

function parseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    let yy = parseInt(y, 10);
    if (y.length === 2) yy = yy <= 40 ? 2000 + yy : 1900 + yy;
    return yy * 10000 + parseInt(mo, 10) * 100 + parseInt(d, 10);
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
  return 0;
}

function canonTeam(name) {
  let n = String(name || '').replace(/\s+/g, ' ').trim();
  if (/[ÃÂ]/.test(n)) {
    try { n = Buffer.from(n, 'latin1').toString('utf8'); } catch (_) {}
  }
  return TEAM_ALIASES[n] || n;
}

function pick(row, map, keys) {
  for (const k of keys) {
    const i = map[k];
    if (i !== undefined && row[i] !== undefined && row[i] !== '') {
      const v = num(row[i]);
      if (v > 1) return v;
    }
  }
  return 0;
}

function valid1x2(h, d, a) {
  if (!(h > 1 && d > 1 && a > 1)) return false;
  const s = 1 / h + 1 / d + 1 / a;
  return s >= 0.9 && s <= 1.45;
}

function main() {
  const leagues = [];
  const leagueIndex = new Map();
  const teams = [];
  const teamIndex = new Map();
  const matches = [];
  const fixtures = [];
  const seasonsSet = new Set();
  const coverage = {};

  const leagueId = (code) => {
    if (!leagueIndex.has(code)) {
      leagueIndex.set(code, leagues.length);
      leagues.push({ code, ...(LEAGUE_META[code] || { name: code, country: '?' }) });
    }
    return leagueIndex.get(code);
  };
  const teamId = (name, lg) => {
    if (!teamIndex.has(name)) {
      teamIndex.set(name, teams.length);
      teams.push({ n: name, l: lg, c: LEAGUE_META[leagues[lg].code]?.country || '' });
    }
    return teamIndex.get(name);
  };

  const seasonDirs = fs.readdirSync(RAW)
    .filter((d) => /^\d{4}$/.test(d) && fs.statSync(path.join(RAW, d)).isDirectory())
    .sort();

  for (const season of seasonDirs) {
    const dir = path.join(RAW, season);
    const startYear = 2000 + parseInt(season.slice(0, 2), 10);
    for (const file of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv'))) {
      const code = file.replace(/\.csv$/i, '').toUpperCase();
      if (!LEAGUE_META[code]) continue;
      let text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (!lines.length) continue;
      const header = parseCSVLine(lines[0]).map((h) => h.trim());
      const map = {};
      header.forEach((h, i) => { if (map[h] === undefined) map[h] = i; });
      if (map.Date === undefined || map.FTHG === undefined) continue;

      const lg = leagueId(code);
      seasonsSet.add(startYear);
      const cov = coverage[code] || (coverage[code] = { rows: 0, odds: 0, pinnacle: 0, max: 0, ou: 0, bwin: 0, seasons: 0, fixtures: 0 });
      cov.seasons++;

      for (let li = 1; li < lines.length; li++) {
        const row = parseCSVLine(lines[li]);
        if (row.length < 5) continue;
        const date = parseDate(row[map.Date]);
        if (!date) continue;
        const home = canonTeam(row[map.HomeTeam]);
        const away = canonTeam(row[map.AwayTeam]);
        if (!home || !away) continue;
        if (home === away) continue;

        const played = row[map.FTHG] !== '' && row[map.FTHG] !== undefined && row[map.FTAG] !== '' && row[map.FTAG] !== undefined;

        // tum 1-X-2 oranlari bwin: acilis (BW) ve kapanis (BWC)
        const bH = pick(row, map, ['BWH']);
        const bD = pick(row, map, ['BWD']);
        const bA = pick(row, map, ['BWA']);
        const pH = pick(row, map, ['BWCH']);
        const pD = pick(row, map, ['BWCD']);
        const pA = pick(row, map, ['BWCA']);
        const mH = pick(row, map, ['BWCH', 'BWH']);
        const mD = pick(row, map, ['BWCD', 'BWD']);
        const mA = pick(row, map, ['BWCA', 'BWA']);
        const wH = pick(row, map, ['BWH']);
        const wD = pick(row, map, ['BWD']);
        const wA = pick(row, map, ['BWA']);
        const okW = valid1x2(wH, wD, wA);
        let o25 = pick(row, map, ['B365>2.5', 'Avg>2.5', 'P>2.5', 'Max>2.5', 'GB>2.5']);
        let u25 = pick(row, map, ['B365<2.5', 'Avg<2.5', 'P<2.5', 'Max<2.5', 'GB<2.5']);
        if (o25 && u25) {
          const s = 1 / o25 + 1 / u25;
          if (s < 0.9 || s > 1.45) { o25 = 0; u25 = 0; }
        } else { o25 = 0; u25 = 0; }

        const ok1x2 = valid1x2(bH, bD, bA);
        const okP = valid1x2(pH, pD, pA);
        const okM = valid1x2(mH, mD, mA);

        const rec = [
          date, lg, teamId(home, lg), teamId(away, lg),
          played ? num(row[map.FTHG]) : -1,
          played ? num(row[map.FTAG]) : -1,
          played && row[map.HTHG] !== undefined && row[map.HTHG] !== '' ? num(row[map.HTHG]) : -1,
          played && row[map.HTAG] !== undefined && row[map.HTAG] !== '' ? num(row[map.HTAG]) : -1,
          ok1x2 ? bH : 0, ok1x2 ? bD : 0, ok1x2 ? bA : 0,
          okP ? pH : 0, okP ? pD : 0, okP ? pA : 0,
          okM ? mH : 0, okM ? mD : 0, okM ? mA : 0,
          o25, u25, startYear,
          played && map.HST !== undefined && row[map.HST] !== undefined && row[map.HST] !== '' ? num(row[map.HST]) : -1,
          played && map.AST !== undefined && row[map.AST] !== undefined && row[map.AST] !== '' ? num(row[map.AST]) : -1,
          okW ? wH : 0, okW ? wD : 0, okW ? wA : 0,
        ];

        if (played) {
          matches.push(rec);
          cov.rows++;
          if (ok1x2) cov.odds++;
          if (okP) cov.pinnacle++;
          if (okM) cov.max++;
          if (o25) cov.ou++;
          if (okW) cov.bwin++;
        } else {
          fixtures.push(rec);
          cov.fixtures++;
        }
      }
    }
  }

  matches.sort((a, b) => a[0] - b[0]);
  fixtures.sort((a, b) => a[0] - b[0]);

  // lig istatistikleri
  const lgStats = leagues.map(() => ({ n: 0, hg: 0, ag: 0, btts: 0, over: 0 }));
  for (const m of matches) {
    const s = lgStats[m[1]];
    s.n++; s.hg += m[4]; s.ag += m[5];
    if (m[4] > 0 && m[5] > 0) s.btts++;
    if (m[4] + m[5] > 2.5) s.over++;
  }

  const db = {
    builtAt: new Date().toISOString(),
    schemaVersion: 2,
    leagues: leagues.map((l, i) => ({
      ...l,
      id: i,
      matches: lgStats[i].n,
      avgHome: +(lgStats[i].hg / Math.max(1, lgStats[i].n)).toFixed(3),
      avgAway: +(lgStats[i].ag / Math.max(1, lgStats[i].n)).toFixed(3),
      btts: +(lgStats[i].btts / Math.max(1, lgStats[i].n)).toFixed(3),
      over25: +(lgStats[i].over / Math.max(1, lgStats[i].n)).toFixed(3),
    })),
    teams,
    seasons: [...seasonsSet].sort((a, b) => a - b),
    coverage,
    matches,
    fixtures,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(db));

  const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  console.log(`Mac: ${matches.length}  Fikstur: ${fixtures.length}  Takim: ${teams.length}  Lig: ${leagues.length}  Sezon: ${db.seasons.length}`);
  console.log(`db.json: ${mb} MB`);
  for (const [code, c] of Object.entries(coverage)) {
    console.log(`  ${code.padEnd(4)} ${String(c.rows).padStart(6)} mac | bwin açılış %${Math.round((c.odds / c.rows) * 100)} | bwin kapanış %${Math.round((c.pinnacle / c.rows) * 100)} | ou %${Math.round((c.ou / c.rows) * 100)} | fikstur ${c.fixtures} | sezon ${c.seasons}`);
  }
}

main();
