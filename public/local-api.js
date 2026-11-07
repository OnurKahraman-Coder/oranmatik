/**
 * Mobil / çevrimdışı çalışma için tarayıcı içi API.
 * Sunucudaki uç noktaların birebir karşılığını verir; ağ gerekmez.
 *
 * Veri kaynağı sırası:
 *   1) window.__DB            (doğrudan gömülü)
 *   2) NativeStore.readDb()   (telefonda indirilmiş güncel paket)
 *   3) db-data.js             (APK içindeki varsayılan paket)
 */
(function () {
  'use strict';

  let engine = null;
  let analyzer = null;
  let meta = null;
  let booting = null;
  let fxIndex = null;
  let panel = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Veri dosyası yüklenemedi: ' + src));
      document.head.appendChild(s);
    });
  }

  function fromNative() {
    try {
      const N = window.NativeStore;
      if (!N || !N.hasDb || !N.hasDb()) return null;
      const text = N.readDb();
      if (!text) return null;
      const db = JSON.parse(text);
      if (!db || !db.matches || !db.matches.length) return null;
      return db;
    } catch (_) {
      return null;
    }
  }

  /* Web sürümü (GitHub Pages): veri dosyaları sitenin data/ klasöründen okunur */
  const WEB = !!window.OM_WEB;
  async function webJson(name, fresh) {
    const r = await fetch('data/' + name + (fresh ? '?t=' + Date.now() : ''), { cache: fresh ? 'no-store' : 'default' });
    if (!r.ok) throw new Error('Veri dosyası okunamadı: ' + name + ' (HTTP ' + r.status + ')');
    return r.json();
  }
  function setSplash(t) { const el = document.getElementById('splashMsg'); if (el) el.textContent = t; }

  async function loadDb() {
    if (WEB) {
      setSplash('119 bin maçlık veri indiriliyor…');
      const v = (document.querySelector('meta[name="data-version"]') || {}).content || '';
      const r = await fetch('data/db.json' + (v ? '?v=' + v : ''));
      if (!r.ok) throw new Error('Veri indirilemedi (HTTP ' + r.status + ')');
      setSplash('veri hazırlanıyor…');
      return r.json();
    }
    if (window.__DB && window.__DB.matches) return window.__DB;
    const stored = fromNative();
    if (stored) return stored;
    if (!window.__DB_FALLBACK) await loadScript('db-data.js');
    if (window.__DB_FALLBACK && window.__DB_FALLBACK.matches) return window.__DB_FALLBACK;
    throw new Error('Veri paketi bulunamadı.');
  }

  async function boot() {
    if (engine) return;
    if (booting) return booting;
    booting = (async () => {
      const db = await loadDb();
      const E = window.OranEngine;
      engine = new E.Engine(db);
      meta = {
        builtAt: db.builtAt,
        schemaVersion: db.schemaVersion || 2,
        matches: db.matches.length,
        fixtures: (db.fixtures || []).length,
        teams: db.teams.length,
        leagues: db.leagues,
        seasons: db.seasons,
        coverage: db.coverage,
        loadMs: 0,
        firstDate: db.matches.length ? db.matches[0][0] : 0,
        lastDate: db.matches.length ? db.matches[db.matches.length - 1][0] : 0,
        today: engine.today,
        offline: true,
        source: WEB ? 'web' : ((window.__DB && window.__DB.matches) ? 'gomulu' : 'paket'),
        web: WEB,
      };
      analyzer = window.OranAnalyze.createAnalyzer(engine, E, {
        matches: meta.matches, firstDate: meta.firstDate, lastDate: meta.lastDate,
      });
    })();
    try {
      await booting;
    } finally {
      booting = null;
    }
  }

  function parse(url) {
    const u = new URL(url, 'http://local');
    return { path: u.pathname, q: u.searchParams };
  }

  function savedServer() {
    try {
      let v = null;
      if (window.NativeStore && window.NativeStore.get) v = window.NativeStore.get('om_server');
      else v = localStorage.getItem('om_server');
      if (v) return v;
    } catch (_) {}
    const m = document.querySelector('meta[name="default-server"]');
    return m ? m.getAttribute('content') : null;
  }

  async function handle(url, opts) {
    await boot();
    const { path, q } = parse(url);
    let body = {};
    if (opts && opts.body) {
      try { body = JSON.parse(opts.body); } catch (_) { throw new Error('Geçersiz istek'); }
    }

    if (path === '/api/health') return { ok: true, offline: true };

    if (path === '/api/meta') return { ...meta, teams: engine.teamNames() };

    if (path === '/api/teams') return { items: engine.searchTeams(q.get('q') || '', 25) };

    if (path.startsWith('/api/team/')) {
      const id = Number(path.split('/').pop());
      if (!Number.isInteger(id) || !engine.teams[id]) throw new Error('Takım yok');
      return engine.teamProfile(id, 12);
    }

    if (path === '/api/h2h') {
      const a = Number(q.get('a')), b = Number(q.get('b'));
      if (!engine.teams[a] || !engine.teams[b]) throw new Error('Takım bulunamadı');
      return engine.h2h(a, b, 20);
    }

    if (path === '/api/find') {
      const home = Number(q.get('home')), away = Number(q.get('away')), date = Number(q.get('date') || 0);
      if (!engine.teams[home] || !engine.teams[away]) throw new Error('Takım bulunamadı');
      return { match: engine.findMatch(home, away, date) };
    }

    if (path === '/api/table') {
      const league = Number(q.get('league') || 0);
      const season = Number(q.get('season') || engine.maxSeason());
      if (!engine.leagues[league]) throw new Error('Lig bulunamadı');
      return { league, season, rows: engine.leagueTable(league, season) };
    }

    if (path === '/api/matches') {
      const league = q.get('league');
      return {
        items: engine.matchList({
          league: league != null && league !== '' ? Number(league) : -1,
          mode: q.get('mode') || 'recent',
          limit: Math.min(200, Number(q.get('limit') || 40)),
        }),
      };
    }

    if (path === '/api/analyze') {
      const t0 = Date.now();
      const out = analyzer.analyze(body);
      out.tookMs = Date.now() - t0;
      return out;
    }

    if (path === '/api/bands') {
      return {
        rows: engine.bandTable({
          league: q.get('league') != null && q.get('league') !== '' ? Number(q.get('league')) : -1,
          seasonFrom: Number(q.get('from') || 2004),
          seasonTo: Number(q.get('to') || 2599),
          column: q.get('column') || 'home',
          step: Number(q.get('step') || 0.2),
        }),
      };
    }

    if (path === '/api/backtest') {
      const league = Number(q.get('league') || 0);
      if (!engine.leagues[league]) throw new Error('Lig bulunamadı');
      return engine.backtest({
        league,
        seasonFrom: Number(q.get('from') || engine.maxSeason() - 1),
        seasonTo: Number(q.get('to') || engine.maxSeason()),
      });
    }

    if (WEB && path === '/api/bwfixtures') {
      try { return { ...(await webJson('bwin-fixtures.json', q.get('refresh') === '1')), via: 'web' }; }
      catch (e) { return { count: 0, matches: [], error: e.message }; }
    }
    if (WEB && path === '/api/bulletin') {
      try { return await webJson('bulletin.json', q.get('refresh') === '1'); }
      catch (e) { return { date: 0, dateText: '', count: 0, matches: [], error: e.message }; }
    }
    if (path === '/api/panel') {
      if (!window.OranPanel) throw new Error('panel modülü yüklenmemiş');
      if (!panel) panel = window.OranPanel.createPanel(engine);
      const t0 = Date.now();
      const out = panel.analyze(body.input || body, body.options || {});
      out.tookMs = Date.now() - t0;
      return out;
    }
    if (path === '/api/bwfixtures') {
      // bwin oranlı fikstürü bilgisayardaki sunucu indirir (football-data tarayıcıdan indirmeye izin vermiyor)
      const srv = savedServer();
      if (srv) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15000);
          const r = await fetch(srv.replace(/\/+$/, '') + '/api/bwfixtures' + (q.get('refresh') === '1' ? '?refresh=1' : ''), { signal: ctrl.signal, cache: 'no-store' });
          clearTimeout(t);
          if (r.ok) return { ...(await r.json()), via: 'pc' };
        } catch (_) { /* bos doner */ }
      }
      return { count: 0, matches: [], error: 'no_server' };
    }
    if (path === '/api/bulletin') {
      const srv = savedServer();
      if (srv) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(srv.replace(/\/+$/, '') + '/api/bulletin' + (q.get('refresh') === '1' ? '?refresh=1' : ''), { signal: ctrl.signal, cache: 'no-store' });
          clearTimeout(t);
          if (r.ok) return await r.json();
        } catch (_) { /* bos doner */ }
      }
      return { date: 0, dateText: '', count: 0, matches: [], error: 'no_server' };
    }
    if (path === '/api/live') {
      const FX = window.OranFixtures;
      if (!FX) throw new Error('canlı veri modülü yüklenmemiş');
      const lid = Number(q.get('league') || -1);
      let code = 'T1';
      if (lid >= 0 && engine.leagues[lid]) code = engine.leagues[lid].code;
      if (!fxIndex) fxIndex = FX.buildIndex(engine.teams);

      // 1) Bilgisayardaki sunucu ayarlıysa ondan al (PC ESPN'e erişir)
      const srv = WEB ? null : savedServer();
      if (srv) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 7000);
          const r = await fetch(srv.replace(/\/+$/, '') + '/api/live?league=' + lid, { signal: ctrl.signal, cache: 'no-store' });
          clearTimeout(t);
          if (r.ok) {
            const j = await r.json();
            if (j && j.events && j.events.length) return { ...j, via: 'pc' };
          }
        } catch (_) { /* PC yoksa doğrudan dene */ }
      }

      // 2) Doğrudan ESPN
      const out = await FX.leagueEvents(code, { index: fxIndex, refresh: q.get('refresh') === '1' });
      return { ...out, leagueCode: code, supported: !!FX.LEAGUE_IDS[code], via: 'direct' };
    }

    if (path === '/api/update/status') {
      return { running: false, step: 'mobil', ok: null, startedAt: null, finishedAt: null, log: [], offline: true };
    }

    if (path === '/api/update') {
      throw new Error('Mobil uygulamada veri, "Veri" sekmesindeki güncelleme ile alınır.');
    }

    throw new Error('Bilinmeyen istek: ' + path);
  }

  window.LocalAPI = { handle, boot };
})();
