'use strict';
/**
 * OranMatik Klon - yerel sunucu (harici bagimlilik yok)
 * Calistirma: node server.js [port] [--open]
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Engine, implied, impliedPower } = require('./lib/engine');
const { createAnalyzer } = require('./lib/analyze');
const FX = require('./lib/fixtures');
const BULLETIN = require('./lib/bulletin');
const PANEL = require('./lib/panel');
const BWFX = require('./lib/bwfixtures');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const ARGS = process.argv.slice(2);
const PORT = parseInt(ARGS.find((a) => /^\d+$/.test(a)) || process.env.PORT || '5178', 10);
const AUTO_OPEN = ARGS.includes('--open');

let engine = null;
let dbMeta = null;
let analyzer = null;
let fxIndex = null;
let panel = null;
let bwfxState = { running: false, error: null, at: 0 };


/* ----------------------------- veri ----------------------------- */

/** Gunluk bulten: 00:30'dan sonra bugunun listesi yoksa cek */
function scheduleBulletin() {
  const needRefresh = () => {
    const cur = BULLETIN.load(DATA);
    if (!cur) return true;
    if (cur.date !== BULLETIN.dateNum(new Date())) return true;
    const age = Date.now() - Date.parse(cur.fetchedAt || 0);
    return !isFinite(age) || age > 6 * 3600 * 1000;
  };

  const run = async () => {
    try {
      const p = await BULLETIN.fetchDay(fxIndex);
      BULLETIN.save(DATA, p);
      console.log(`[bulten] ${p.dateText} · ${p.count} mac`);
    } catch (e) {
      console.error('[bulten] hata:', e.message);
    }
  };

  setTimeout(() => { if (needRefresh()) run(); }, 3000);

  // her 10 dk: 00:30 gectiyse ve gun degistiyse yenile
  setInterval(() => {
    const now = new Date();
    const after0030 = now.getHours() > 0 || (now.getHours() === 0 && now.getMinutes() >= 30);
    if (after0030 && needRefresh()) run();
  }, 10 * 60 * 1000);
}

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('!! data/db.json bulunamadi. Once "node tools/build.js" calistirin.');
    process.exit(1);
  }
  const t0 = Date.now();
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  engine = new Engine(db);
  dbMeta = {
    builtAt: db.builtAt,
    schemaVersion: db.schemaVersion || 1,
    matches: db.matches.length,
    fixtures: (db.fixtures || []).length,
    teams: db.teams.length,
    leagues: db.leagues,
    seasons: db.seasons,
    coverage: db.coverage,
    loadMs: Date.now() - t0,
    firstDate: db.matches.length ? db.matches[0][0] : 0,
    lastDate: db.matches.length ? db.matches[db.matches.length - 1][0] : 0,
  };
  analyzer = createAnalyzer(engine, { implied, impliedPower }, {
    matches: dbMeta.matches,
    firstDate: dbMeta.firstDate,
    lastDate: dbMeta.lastDate,
  });
  fxIndex = FX.buildIndex(engine.teams);
  panel = PANEL.createPanel(engine);

  scheduleBulletin();
  console.log(`Veritabani: ${dbMeta.matches} mac, ${dbMeta.teams} takim (${dbMeta.loadMs} ms)`);
}

/* ------------------- bwin fikstur (oynanacak maclar) ------------------- */

async function refreshBwinFixtures() {
  if (bwfxState.running) return BWFX.load(DATA);
  bwfxState.running = true;
  try {
    const p = await BWFX.refresh(DATA, engine, FX);
    bwfxState = { running: false, error: null, at: Date.now() };
    console.log(`[bwin] ${p.count} mac (${p.bwinCount} bwin oranli) · ${p.source}`);
    return p;
  } catch (e) {
    bwfxState = { running: false, error: e.message, at: Date.now() };
    console.error('[bwin] fikstur alinamadi:', e.message);
    throw e;
  }
}

let bwfxScheduled = false;
function scheduleBwinFixtures() {
  if (bwfxScheduled) return;
  bwfxScheduled = true;
  const stale = () => {
    const cur = BWFX.load(DATA);
    if (!cur || !cur.count) return true;
    return Date.now() - Date.parse(cur.fetchedAt || 0) > 6 * 3600 * 1000;
  };
  setTimeout(() => { if (stale()) refreshBwinFixtures().catch(() => {}); }, 5000);
  setInterval(() => { if (stale()) refreshBwinFixtures().catch(() => {}); }, 30 * 60 * 1000);
}

/* --------------------------- guncelleme --------------------------- */

let updateState = {
  running: false, step: '', ok: null, startedAt: null, finishedAt: null, log: [], error: null,
};

function pushLog(chunk) {
  const text = String(chunk).replace(/\r/g, '');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    updateState.log.push(line.slice(0, 300));
  }
  if (updateState.log.length > 300) updateState.log = updateState.log.slice(-300);
}

function runNode(script, timeoutMs = 0) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'tools', script)], { cwd: ROOT, windowsHide: true });
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        pushLog(`[zaman aşımı] ${script} ${Math.round(timeoutMs / 60000)} dk içinde bitmedi, durduruldu.`);
        try { p.kill(); } catch (_) {}
      }, timeoutMs);
    }
    p.stdout.on('data', pushLog);
    p.stderr.on('data', pushLog);
    p.on('error', (e) => { pushLog('HATA: ' + e.message); if (timer) clearTimeout(timer); resolve(false); });
    p.on('close', (code) => { if (timer) clearTimeout(timer); resolve(code === 0); });
  });
}

async function runUpdate() {
  if (updateState.running) return;
  updateState = { running: true, step: 'indiriliyor', ok: null, startedAt: Date.now(), finishedAt: null, log: [], error: null };
  try {
    const okFetch = await runNode('fetch.js', 12 * 60 * 1000);
    if (!okFetch) {
      updateState.step = 'indirme hatasi (mevcut veri korunuyor)';
    }
    updateState.step = 'derleniyor';
    const okBuild = await runNode('build.js');
    if (okBuild) {
      loadDB();
      updateState.ok = true;
      updateState.step = 'tamamlandi';
    } else {
      updateState.ok = false;
      updateState.step = 'derleme hatasi';
    }
  } catch (e) {
    updateState.ok = false;
    updateState.error = e.message;
    updateState.step = 'hata';
  } finally {
    updateState.running = false;
    updateState.finishedAt = Date.now();
  }
}

/* ----------------------------- analiz ----------------------------- */

/* ----------------------------- HTTP ----------------------------- */

/** Bilgisayarin yerel ag adresleri (telefondan guncelleme icin) */
function lanUrls() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // ev ağları önce gelsin (192.168 > 10 > diğer), VPN/sanal adaptörler sona
  const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  out.sort((a, b) => score(a) - score(b));
  return out.map((ip) => `http://${ip}:${PORT}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.apk': 'application/vnd.android.package-archive',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2e6) { reject(new Error('İstek çok büyük')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (_) { reject(new Error('Geçersiz JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('403'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bulunamadı: ' + rel);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const noCache = ext === '.html' || ext === '.js' || ext === '.css' || rel === '/sw.js';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (p === '/api/meta') {
      return json(res, 200, { ...dbMeta, teams: engine.teamNames(), today: engine.today, lanUrls: lanUrls() });
    }

    // Telefon uygulamasinin indirdigi guncel veritabani
    if (p === '/api/db' || p === '/db.json') {
      const stat = fs.statSync(DB_PATH);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': stat.size,
        'X-Db-Built': dbMeta.builtAt,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(DB_PATH).pipe(res);
      return;
    }

    if (p === '/api/teams') {
      return json(res, 200, { items: engine.searchTeams(url.searchParams.get('q') || '', 25) });
    }

    if (p.startsWith('/api/team/')) {
      const id = Number(p.split('/').pop());
      if (!Number.isInteger(id) || !engine.teams[id]) return json(res, 404, { error: 'Takım yok' });
      return json(res, 200, engine.teamProfile(id, 12));
    }

    if (p === '/api/h2h') {
      const a = Number(url.searchParams.get('a'));
      const b = Number(url.searchParams.get('b'));
      if (!engine.teams[a] || !engine.teams[b]) return json(res, 400, { error: 'Takım bulunamadı' });
      return json(res, 200, engine.h2h(a, b, 20));
    }

    if (p === '/api/find') {
      const home = Number(url.searchParams.get('home'));
      const away = Number(url.searchParams.get('away'));
      const date = Number(url.searchParams.get('date') || 0);
      if (!engine.teams[home] || !engine.teams[away]) return json(res, 400, { error: 'Takım bulunamadı' });
      return json(res, 200, { match: engine.findMatch(home, away, date) });
    }

    // Gunluk bulten (ESPN, tum kapsanan ligler)
    if (p === '/api/bulletin') {
      if (url.searchParams.get('refresh') === '1') {
        try {
          const fresh = await BULLETIN.fetchDay(fxIndex);
          BULLETIN.save(DATA, fresh);
        } catch (e) { /* eski veri doner */ }
      }
      const cur = BULLETIN.load(DATA) || { date: 0, dateText: '', count: 0, matches: [] };
      return json(res, 200, cur);
    }

    // Canli / yaklasan maclar (TheSportsDB, ucretsiz)
    if (p === '/api/live') {
      const lid = Number(url.searchParams.get('league') || -1);
      let code = 'T1';
      if (lid >= 0 && engine.leagues[lid]) code = engine.leagues[lid].code;
      const out = await FX.leagueEvents(code, {
        index: fxIndex,
        refresh: url.searchParams.get('refresh') === '1',
      });
      return json(res, 200, { ...out, leagueCode: code, supported: !!FX.LEAGUE_IDS[code] });
    }

    // 20 macilik istatistik paneli (bwin oran eslesmesi)
    if (p === '/api/panel' && req.method === 'POST') {
      const body = await readBody(req);
      const t0 = Date.now();
      const out = panel.analyze(body.input || body, body.options || {});
      out.tookMs = Date.now() - t0;
      return json(res, 200, out);
    }

    if (p === '/api/panel/backtest') {
      const q = url.searchParams;
      return json(res, 200, panel.backtest({
        from: Number(q.get('from') || 20240701),
        limit: Number(q.get('limit') || 1500),
        count: Number(q.get('count') || 20),
        useOU: q.get('ou') !== '0',
      }));
    }

    // oynanacak maclar + bwin oranlari (football-data fixtures.csv)
    if (p === '/api/bwfixtures') {
      let cur = BWFX.load(DATA);
      let error = null;
      if (url.searchParams.get('refresh') === '1' || !cur) {
        try { cur = await refreshBwinFixtures(); } catch (e) { error = e.message; cur = BWFX.load(DATA); }
      }
      cur = cur || { fetchedAt: null, source: null, count: 0, matches: [] };
      return json(res, 200, { ...cur, error: error || (cur.count ? null : bwfxState.error) }, { 'Access-Control-Allow-Origin': '*' });
    }

    if (p === '/api/table') {
      const league = Number(url.searchParams.get('league') || 0);
      const season = Number(url.searchParams.get('season') || engine.maxSeason());
      if (!engine.leagues[league]) return json(res, 400, { error: 'Lig bulunamadı' });
      return json(res, 200, { league, season, rows: engine.leagueTable(league, season) });
    }

    if (p === '/api/matches') {
      const league = url.searchParams.get('league');
      const mode = url.searchParams.get('mode') || 'recent';
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 40));
      return json(res, 200, {
        items: engine.matchList({ league: league != null && league !== '' ? Number(league) : -1, mode, limit }),
      });
    }

    if (p === '/api/analyze' && req.method === 'POST') {
      const body = await readBody(req);
      const t0 = Date.now();
      const out = analyzer.analyze(body);
      out.tookMs = Date.now() - t0;

      return json(res, 200, out);
    }

    if (p === '/api/bands') {
      const q = url.searchParams;
      return json(res, 200, {
        rows: engine.bandTable({
          league: q.get('league') != null && q.get('league') !== '' ? Number(q.get('league')) : -1,
          seasonFrom: Number(q.get('from') || 2004),
          seasonTo: Number(q.get('to') || 2599),
          column: q.get('column') || 'home',
          step: Number(q.get('step') || 0.2),
        }),
      });
    }

    if (p === '/api/backtest') {
      const q = url.searchParams;
      const league = Number(q.get('league') || 0);
      const from = Number(q.get('from') || engine.maxSeason() - 1);
      const to = Number(q.get('to') || engine.maxSeason());
      if (!engine.leagues[league]) return json(res, 400, { error: 'Lig bulunamadı' });
      return json(res, 200, engine.backtest({ league, seasonFrom: from, seasonTo: to }));
    }

    if (p === '/api/update' && req.method === 'POST') {
      if (updateState.running) return json(res, 409, { error: 'Güncelleme zaten çalışıyor', state: publicUpdate() });
      runUpdate();
      return json(res, 202, { started: true });
    }

    if (p === '/api/update/status') return json(res, 200, publicUpdate());

    if (p === '/api/health') return json(res, 200, { ok: true });

    return serveStatic(req, res, p);
  } catch (e) {
    console.error('HATA', p, e.message);
    return json(res, 500, { error: e.message });
  }
});

function publicUpdate() {
  return {
    running: updateState.running,
    step: updateState.step,
    ok: updateState.ok,
    error: updateState.error,
    startedAt: updateState.startedAt,
    finishedAt: updateState.finishedAt,
    log: updateState.log.slice(-40),
  };
}

loadDB();
scheduleBwinFixtures();
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  HATA: ${PORT} portu zaten kullanılıyor.`);
    console.error(`  Uygulama zaten açık olabilir: http://localhost:${PORT}`);
  } else {
    console.error('Sunucu hatası:', e.message);
  }
  setTimeout(() => process.exit(1), 200);
});
server.listen(PORT, '0.0.0.0', () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  OranMatik Klon çalışıyor');
  console.log(`  ${url}`);
  console.log(`  Ağ üzerinden (telefon): http://<bilgisayar-IP>:${PORT}`);
  console.log('');
  if (AUTO_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : (process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`);
    require('child_process').exec(cmd, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' }, () => {});
  }
});
