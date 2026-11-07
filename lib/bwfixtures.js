'use strict';
/**
 * Oynanacak maçlar + bwin oranları
 *
 * Kaynak: football-data.co.uk/fixtures.csv — önümüzdeki günlerin maçları ve açılış oranları
 * (1-X-2 yalnızca bwin = BWH/BWD/BWA; 2.5 Alt/Üst kaynakta bwin için yok → B365 ya da piyasa ortalaması). Site haftada birkaç kez
 * günceller (genelde hafta sonu maçları için cuma, hafta içi maçları için salı).
 * Doğrudan erişilemezse İnternet Arşivi'ndeki son kopya denenir.
 *
 * Çıktı: data/bwin-fixtures.json  { fetchedAt, source, count, matches: [...] }
 */
const fs = require('fs');
const path = require('path');
const ALIASES = require('./aliases');

const URLS = [
  { url: 'https://www.football-data.co.uk/fixtures.csv', via: 'football-data.co.uk' },
  { url: 'https://web.archive.org/web/2id_/https://www.football-data.co.uk/fixtures.csv', via: 'İnternet Arşivi (son kopya)' },
];
const FILE = 'bwin-fixtures.json';

function parseCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function num(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

function parseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let yy = parseInt(m[3], 10);
    if (m[3].length === 2) yy += 2000;
    return yy * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[1], 10);
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  return 0;
}

/** Londra saatini (football-data saatleri) bilgisayarın yerel saatine çevir */
function londonToLocal(dateNum, hhmm) {
  if (!dateNum || !/^\d{1,2}:\d{2}$/.test(hhmm || '')) return { date: dateNum, time: hhmm || '' };
  const y = Math.floor(dateNum / 10000), mo = Math.floor((dateNum % 10000) / 100), d = dateNum % 100;
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  let offMin = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(guess));
    const g = (t) => +parts.find((p) => p.type === t).value;
    const asLondon = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
    offMin = (asLondon - guess) / 60000; // BST'de +60
  } catch (_) { /* Intl yoksa Londra = UTC say */ }
  const t = new Date(guess - offMin * 60000);
  const pad = (x) => String(x).padStart(2, '0');
  return {
    date: t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate(),
    time: `${pad(t.getHours())}:${pad(t.getMinutes())}`,
  };
}

function pick(row, map, keys) {
  for (const k of keys) {
    const i = map[k];
    if (i !== undefined && row[i] !== undefined && row[i] !== '') {
      const v = num(row[i]);
      if (v > 1) return { v, key: k };
    }
  }
  return { v: 0, key: null };
}

/**
 * CSV metnini maç listesine çevir
 * @param text     fixtures.csv içeriği
 * @param engine   takım/lig eşleştirmesi için
 * @param FX       lib/fixtures (bulanık takım eşleştirme)
 */
function parseFixtures(text, engine, FX) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]).map((h) => h.trim());
  const map = {};
  header.forEach((h, i) => { if (map[h] === undefined) map[h] = i; });
  if (map.Div === undefined || map.HomeTeam === undefined) throw new Error('fixtures.csv biçimi tanınmadı');

  const leagueByCode = new Map(engine.leagues.map((l, i) => [l.code, i]));
  const exact = new Map(engine.teams.map((t, i) => [t.n, i]));
  const fxIndex = FX ? FX.buildIndex(engine.teams) : null;
  const teamOf = (raw) => {
    const n = String(raw || '').replace(/\s+/g, ' ').trim();
    const c = ALIASES[n] || n;
    if (exact.has(c)) return exact.get(c);
    if (FX && fxIndex) {
      const r = FX.matchTeam(c, fxIndex);
      if (r != null && r >= 0) return r;
    }
    return -1;
  };

  const out = [];
  for (let li = 1; li < lines.length; li++) {
    const row = parseCSVLine(lines[li]);
    const code = String(row[map.Div] || '').trim().toUpperCase();
    if (!leagueByCode.has(code)) continue;
    const date = parseDate(row[map.Date]);
    if (!date) continue;
    const homeName = String(row[map.HomeTeam] || '').trim();
    const awayName = String(row[map.AwayTeam] || '').trim();
    if (!homeName || !awayName) continue;

    // yalnizca bwin: bwin orani yoksa mac listelenir ama oran bos kalir (kullanici girer)
    const h = pick(row, map, ['BWH']), d = pick(row, map, ['BWD']), a = pick(row, map, ['BWA']);
    const bwin = h.v > 1 && d.v > 1 && a.v > 1;
    const o = pick(row, map, ['B365>2.5', 'Avg>2.5', 'Max>2.5', 'P>2.5']);
    const u = pick(row, map, ['B365<2.5', 'Avg<2.5', 'Max<2.5', 'P<2.5']);

    const local = londonToLocal(date, String(row[map.Time] || '').trim());
    const lg = leagueByCode.get(code);
    out.push({
      league: code,
      leagueId: lg,
      leagueName: engine.leagues[lg].name,
      country: engine.leagues[lg].country,
      date: local.date,
      time: local.time,
      homeName, awayName,
      home: teamOf(homeName),
      away: teamOf(awayName),
      h: bwin ? h.v : 0, d: bwin ? d.v : 0, a: bwin ? a.v : 0,
      o: o.v || null, u: u.v || null,
      oddsSource: bwin ? 'bwin' : null,
    });
  }
  out.sort((x, y) => x.date - y.date || x.time.localeCompare(y.time) || x.league.localeCompare(y.league));
  return out;
}

async function download(timeoutMs = 20000) {
  let lastErr = null;
  for (const src of URLS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(src.url, { signal: ctrl.signal, headers: { 'User-Agent': 'OranMatik/2.2', Accept: 'text/csv,*/*' } });
      clearTimeout(t);
      if (!r.ok) { lastErr = new Error(`${src.via}: HTTP ${r.status}`); continue; }
      const text = await r.text();
      if (!/^﻿?Div,/.test(text)) { lastErr = new Error(`${src.via}: beklenmeyen içerik`); continue; }
      return { text, via: src.via };
    } catch (e) {
      lastErr = new Error(`${src.via}: ${e.name === 'AbortError' ? 'zaman aşımı' : e.message}`);
    }
  }
  throw lastErr || new Error('indirilemedi');
}

function todayNum() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

async function refresh(dataDir, engine, FX) {
  const { text, via } = await download();
  const all = parseFixtures(text, engine, FX);
  const t = todayNum();
  const matches = all.filter((m) => m.date >= t);
  const payload = {
    fetchedAt: new Date().toISOString(),
    source: via,
    count: matches.length,
    bwinCount: matches.filter((m) => m.oddsSource === 'bwin').length,
    stale: all.length > 0 && matches.length === 0,
    matches,
  };
  fs.writeFileSync(path.join(dataDir, FILE), JSON.stringify(payload));
  return payload;
}

function load(dataDir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), 'utf8'));
    const t = todayNum();
    p.matches = (p.matches || []).filter((m) => m.date >= t);
    p.count = p.matches.length;
    return p;
  } catch (_) {
    return null;
  }
}

module.exports = { parseFixtures, refresh, load, londonToLocal, FILE };
