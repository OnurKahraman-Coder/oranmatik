/**
 * Wayback arsivinden football-data.co.uk sezon CSV'lerini indirir.
 * Kullanim: node tools/fetch.js
 * Cikti: data/raw/<sezon>/<LIG>.csv  +  data/raw/_manifest.json
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');

const LEAGUES = ['T1', 'E0', 'E1', 'E2', 'D1', 'D2', 'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'SC0', 'SC1'];
const SEASON_START = 2004; // 2004/05
const SEASON_END = 2026;   // 2026/27

const UA = 'curl/8.9.1';

function request(url, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seasonCode(startYear) {
  const a = String(startYear % 100).padStart(2, '0');
  const b = String((startYear + 1) % 100).padStart(2, '0');
  return a + b;
}

function seasonStamp(startYear) {
  // sezon bittikten ~2 ay sonra: temmuz
  return `${startYear + 1}0801`;
}

/** CDX indeksini oku, her (sezon, lig) icin en iyi snapshot'i sec */
function buildPlan() {
  const cdxPath = path.join(RAW, 'cdx.txt');
  const lines = fs.readFileSync(cdxPath, 'utf8').split(/\r?\n/);
  const best = new Map();
  for (const line of lines) {
    const m = line.match(/mmz4281\/(\d{4})\/([A-Za-z0-9]+)\.csv\s+(\d{14})\s+(\d+)\s+200/);
    if (!m) continue;
    const [, season, code, ts, len] = m;
    if (!LEAGUES.includes(code.toUpperCase())) continue;
    const sY = 2000 + parseInt(season.slice(0, 2), 10);
    if (sY < SEASON_START || sY > SEASON_END) continue;
    const key = `${season}|${code.toUpperCase()}`;
    const cand = { ts, len: parseInt(len, 10), season, code: code.toUpperCase() };
    const cur = best.get(key);
    // en buyuk dosya = sezon sonuna en yakin; esitlikte daha yeni ts
    if (!cur || cand.len > cur.len || (cand.len === cur.len && cand.ts > cur.ts)) best.set(key, cand);
  }
  return best;
}

async function fetchWithRetry(url, tries = 4, timeout = 90000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await request(url, timeout);
      if (r.status === 200 && r.body.length > 200) return r.body;
      if (r.status === 429 || r.status >= 500) {
        await sleep(4000 * (i + 1));
        continue;
      }
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
      await sleep(2500 * (i + 1));
    }
  }
  throw lastErr || new Error('bilinmeyen hata');
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  if (!fs.existsSync(path.join(RAW, 'cdx.txt'))) {
    console.error('cdx.txt yok');
    process.exit(1);
  }
  const plan = buildPlan();
  const entries = [...plan.entries()].sort();
  console.log(`Plan: ${entries.length} dosya`);

  const manifest = {};
  const queue = entries.slice();
  let done = 0, failed = 0;

  async function worker(id) {
    while (queue.length) {
      const [key, item] = queue.shift();
      const outDir = path.join(RAW, item.season);
      const outFile = path.join(outDir, `${item.code}.csv`);
      done++;
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 500) {
        manifest[key] = { ok: true, cached: true, bytes: fs.statSync(outFile).size };
        continue;
      }
      const url = `https://web.archive.org/web/${item.ts}id_/https://www.football-data.co.uk/mmz4281/${item.season}/${item.code}.csv`;
      try {
        const body = await fetchWithRetry(url);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outFile, body);
        manifest[key] = { ok: true, bytes: body.length, ts: item.ts };
      } catch (e) {
        manifest[key] = { ok: false, error: e.message, ts: item.ts };
        failed++;
      }
      if (done % 20 === 0) console.log(`  ${done}/${entries.length} (hata: ${failed})`);
      await sleep(350);
    }
  }

  await Promise.all([worker(0), worker(1), worker(2)]);

  // eksik sezonlar icin ikinci en iyi snapshot denemesi
  const missing = entries.filter(([k]) => !manifest[k] || !manifest[k].ok);
  if (missing.length) {
    console.log(`Eksik: ${missing.length} dosya, alternatif snapshotlar deneniyor...`);
    const cdxLines = fs.readFileSync(path.join(RAW, 'cdx.txt'), 'utf8').split(/\r?\n/);
    const all = new Map();
    for (const line of cdxLines) {
      const m = line.match(/mmz4281\/(\d{4})\/([A-Za-z0-9]+)\.csv\s+(\d{14})\s+(\d+)\s+200/);
      if (!m) continue;
      const key = `${m[1]}|${m[2].toUpperCase()}`;
      if (!all.has(key)) all.set(key, []);
      all.get(key).push({ ts: m[3], len: parseInt(m[4], 10) });
    }
    for (const [key, item] of missing) {
      const cands = (all.get(key) || []).sort((a, b) => b.len - a.len).slice(1, 4);
      for (const c of cands) {
        const url = `https://web.archive.org/web/${c.ts}id_/https://www.football-data.co.uk/mmz4281/${item.season}/${item.code}.csv`;
        try {
          const body = await fetchWithRetry(url, 1, 20000);
          fs.writeFileSync(path.join(RAW, item.season, `${item.code}.csv`), body);
          manifest[key] = { ok: true, bytes: body.length, ts: c.ts, alt: true };
          console.log(`  + ${key} alternatif ile alindi (${c.ts})`);
          break;
        } catch (_) { /* yoksay */ }
      }
      await sleep(500);
    }
  }

  fs.writeFileSync(path.join(RAW, '_manifest.json'), JSON.stringify(manifest, null, 1));
  const ok = Object.values(manifest).filter((m) => m.ok).length;
  console.log(`Bitti: ${ok}/${entries.length} basarili, ${entries.length - ok} eksik`);
  const byCode = {};
  for (const [k, v] of Object.entries(manifest)) {
    const code = k.split('|')[1];
    byCode[code] = byCode[code] || { ok: 0, total: 0 };
    byCode[code].total++;
    if (v.ok) byCode[code].ok++;
  }
  console.log(Object.entries(byCode).map(([c, v]) => `${c}:${v.ok}/${v.total}`).join('  '));
}

main();
