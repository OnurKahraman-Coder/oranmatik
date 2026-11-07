/**
 * Otomatik güncelleme (GitHub Actions her 6 saatte bir çalıştırır)
 * Kullanim: node tools/update-live.js
 *
 *  1) Güncel sezonun lig dosyalarını football-data.co.uk'den indirir (bwin açılış + kapanış oranları)
 *     — ulaşılamazsa İnternet Arşivi'ndeki son kopya denenir
 *  2) Veritabanını derler (tools/build.js)
 *  3) Oynanacak maçları ve bwin oranlarını indirir (fixtures.csv → data/bwin-fixtures.json)
 *  4) Günün bültenini ESPN'den çeker (data/bulletin.json)
 *
 * Bir adım başarısız olursa önceki veriyle devam edilir; site yine yayınlanır.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const DATA = path.join(ROOT, 'data');
const LEAGUES = ['T1', 'E0', 'E1', 'E2', 'D1', 'D2', 'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'SC0', 'SC1'];
const UA = 'Mozilla/5.0 (compatible; OranMatik/2.3; +https://github.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (y) => String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0');

async function get(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function getCsv(rel) {
  const direct = `https://www.football-data.co.uk/${rel}`;
  const sources = [direct, `https://web.archive.org/web/2id_/${direct}`];
  let last;
  for (const u of sources) {
    for (let i = 0; i < 2; i++) {
      try {
        const text = await get(u);
        if (/^﻿?Div,/.test(text)) return { text, via: u === direct ? 'football-data' : 'arşiv' };
        last = new Error('beklenmeyen içerik');
      } catch (e) { last = e; await sleep(1500); }
    }
  }
  throw last;
}

function seasonsToRefresh(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const cur = m >= 7 ? y : y - 1;
  // yaz aylarında biten sezonun son halini de al
  return m >= 6 && m <= 9 ? [cur - 1, cur] : [cur];
}

async function main() {
  const report = [];

  /* 1) güncel sezon dosyaları */
  for (const sy of seasonsToRefresh()) {
    const sc = code(sy);
    const dir = path.join(RAW, sc);
    fs.mkdirSync(dir, { recursive: true });
    let ok = 0, fail = 0;
    for (const lg of LEAGUES) {
      try {
        const { text } = await getCsv(`mmz4281/${sc}/${lg}.csv`);
        const file = path.join(dir, `${lg}.csv`);
        const oldLen = fs.existsSync(file) ? fs.statSync(file).size : 0;
        // arşivdeki eski kopya mevcut dosyadan kısaysa üzerine yazma
        if (text.length >= oldLen * 0.9) fs.writeFileSync(file, text);
        ok++;
      } catch (e) {
        fail++;
        console.log(`  ! ${sc}/${lg}: ${e.message}`);
      }
      await sleep(300);
    }
    report.push(`sezon ${sc}: ${ok} lig güncellendi${fail ? `, ${fail} hata` : ''}`);
  }

  /* 2) derle */
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.js')], { stdio: 'inherit' });

  const { Engine } = require('../lib/engine');
  const FX = require('../lib/fixtures');
  const db = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
  const engine = new Engine(db);

  /* 3) bwin fikstür */
  try {
    const BW = require('../lib/bwfixtures');
    const p = await BW.refresh(DATA, engine, FX);
    report.push(`fikstür: ${p.count} maç, ${p.bwinCount} tanesi bwin oranlı (${p.source})`);
  } catch (e) {
    report.push(`fikstür: HATA ${e.message} (önceki liste korunur)`);
  }

  /* 4) günün bülteni (ESPN) */
  try {
    const B = require('../lib/bulletin');
    const p = await B.fetchDay(FX.buildIndex(engine.teams));
    B.save(DATA, p);
    report.push(`bülten: ${p.dateText} · ${p.count} maç`);
  } catch (e) {
    report.push(`bülten: HATA ${e.message}`);
  }

  console.log('\n' + report.map((r) => '• ' + r).join('\n'));
  console.log(`son maç: ${db.matches[db.matches.length - 1][0]}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
