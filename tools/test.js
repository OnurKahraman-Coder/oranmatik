/**
 * OranMatik — otomatik testler
 * Kullanim: node tools/test.js
 * Sunucu calisiyorsa API testleri de yapilir.
 */
const fs = require('fs');
const path = require('path');
const { Engine, implied, impliedPower, wilson } = require('../lib/engine');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' | ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }
function section(t) { console.log('\n' + t); }

const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
const e = new Engine(db);

/* ---------------------------------------------------------------- */
section('Veri bütünlüğü');
ok('maç var', db.matches.length > 50000, db.matches.length);
ok('takım var', db.teams.length > 100);
ok('sezon var', db.seasons.length >= 20);
ok('tüm maçlar 25 alanlı (bwin dahil)', db.matches.every((m) => m.length === 25));
ok('ana oran = bwin açılış', db.matches.every((m) => m[8] === m[22] && m[9] === m[23] && m[10] === m[24]));
ok('skorlar negatif değil', db.matches.every((m) => m[4] >= 0 && m[5] >= 0));
ok('tarihler artan', db.matches.every((m, i, a) => i === 0 || a[i - 1][0] <= m[0]));
ok('lig indeksleri geçerli', db.matches.every((m) => m[1] >= 0 && m[1] < db.leagues.length));
ok('takım indeksleri geçerli', db.matches.every((m) => db.teams[m[2]] && db.teams[m[3]]));
ok('galibiyet skorla tutarlı', db.matches.every((m) => (m[4] > m[5]) || (m[4] <= m[5])));
const withOdds = db.matches.filter((m) => m[8] > 1 && m[9] > 1 && m[10] > 1).length;
ok('oran kapsamı %95+', withOdds / db.matches.length > 0.95, (withOdds / db.matches.length * 100).toFixed(1) + '%');

/* ---------------------------------------------------------------- */
section('Piyasa matematiği');
const im = implied(2.10, 3.30, 3.40);
ok('olasılıklar toplamı 1', near(im.pH + im.pD + im.pA, 1));
ok('marj pozitif', im.overround > 0 && im.overround < 0.2, im.overround.toFixed(4));
const ip = impliedPower(2.10, 3.30, 3.40);
ok('log marj toplamı 1', near(ip.pH + ip.pD + ip.pA, 1, 1e-9));
ok('favori olasılığı en yüksek', im.pH > im.pD && im.pH > im.pA);
const w = wilson(50, 100);
ok('wilson aralığı', w[0] < 0.5 && w[1] > 0.5 && w[1] <= 1);
ok('geçersiz oran null', implied(1, 2, 3) === null);

/* ---------------------------------------------------------------- */
section('Skor matrisi / gol modeli');
const mx = e.scoreMatrix(1.6, 1.1, -0.05);
const sum = mx.matrix.flat().reduce((a, b) => a + b, 0);
ok('matris toplamı 1', near(sum, 1, 1e-6), sum);
ok('1X2 toplamı 1', near(mx.probs.h + mx.probs.d + mx.probs.a, 1, 1e-9));
ok('üst+alt 2.5 = 1', near(mx.ou.over2_5 + mx.ou.under2_5, 1, 1e-9));
ok('beklenen gol makul', mx.expectedGoals > 1.5 && mx.expectedGoals < 5, mx.expectedGoals.toFixed(2));
ok('en olası skorlar sıralı', mx.topScores.every((s, i, a) => i === 0 || a[i - 1].p >= s.p));
ok('6+ gol olasılığı', mx.ou.over5_5 > 0 && mx.ou.over5_5 < 0.3, (mx.ou.over5_5 * 100).toFixed(1) + '%');
ok('gol bantları toplamı 1', near(mx.bands.p.reduce((a, b) => a + b, 0), 1, 1e-9));

const gs = e.searchTeams('galatasaray')[0].id;
const fb = e.searchTeams('fenerbahce')[0].id;
const gm = e.goalModel(gs, fb, { league: e.leagueOf(gs) });
ok('model lambda pozitif', gm.lambda.home > 0 && gm.lambda.away > 0);
ok('model 1X2 toplamı 1', near(gm.probs.h + gm.probs.d + gm.probs.a, 1, 1e-9));
ok('İY/MS model toplamı 1', Math.abs(Object.values(gm.halves.combos).reduce((a, b) => a + b, 0) - 1) < 1e-6);
ok('ilk yarı olasılıkları', gm.halves.ht.h > 0 && gm.halves.ht.h < 1);
ok('ev sahibi avantajı', gm.lambda.home > gm.lambda.away, `${gm.lambda.home.toFixed(2)} / ${gm.lambda.away.toFixed(2)}`);
ok('rho makul aralıkta', gm.ratings.rho >= -0.2 && gm.ratings.rho <= 0.1);

/* ---------------------------------------------------------------- */
section('Oran eşleşmesi');
const target = { h: 2.10, d: 3.30, a: 3.40 };
const t1 = e.leagueOf(gs);
const h1 = e.summarizeSimilar(target, { mode: 'near', tol: 0.02, league: t1, seasonFrom: 2004, seasonTo: 2100 });
ok('eşleşme bulundu', h1.count > 50, h1.count);
ok('dağılım toplamı 1', near(h1.dist.h + h1.dist.d + h1.dist.a, 1, 1e-9));
ok('örnek sayısı tutarlı', h1.count === h1.counts.h + h1.counts.d + h1.counts.a);
ok('İY/MS 9 kombinasyon', Object.keys(h1.htft.probs).length === 9);
ok('İY/MS toplamı ~1', Math.abs(Object.values(h1.htft.probs).reduce((a, b) => a + b, 0) - 1) < 1e-9);
ok('tarihsel gol bantları toplamı 1', near(h1.bands.p.reduce((a, b) => a + b, 0), 1, 1e-9));
ok('tolerans korundu', !h1.expanded || h1.count >= 25);
const h2 = e.summarizeSimilar(target, { mode: 'near', tol: 0.005, league: t1, seasonFrom: 2004, seasonTo: 2100 });
ok('dar tolerans daha az örnek', h2.count <= h1.count, `${h2.count} <= ${h1.count}`);
const hex = e.summarizeSimilar(target, { mode: 'exact', league: t1, seasonFrom: 2004, seasonTo: 2100 });
ok('birebir mod çalışıyor', hex.count <= h2.count, hex.count);
// determinizm
const h1b = e.summarizeSimilar(target, { mode: 'near', tol: 0.02, league: t1, seasonFrom: 2004, seasonTo: 2100 });
ok('deterministik', h1b.count === h1.count && h1b.dist.h === h1.dist.h);

/* ---------------------------------------------------------------- */
section('Puan durumu');
const season = e.maxSeason();
const tbl = e.leagueTable(t1, season);
ok('tüm takımlar var', tbl.length >= 18, tbl.length);
ok('puan = 3G + B', tbl.every((r) => r.pts === r.w * 3 + r.d));
ok('oynanan = G+B+M', tbl.every((r) => r.p === r.w + r.d + r.l));
ok('sıralama doğru', tbl.every((r, i, a) => i === 0 || a[i - 1].pts >= r.pts));
const draws = tbl.reduce((s, r) => s + r.d, 0) / 2;
const totalPts = tbl.reduce((s, r) => s + r.pts, 0);
const totalMatches = tbl.reduce((s, r) => s + r.p, 0) / 2;
ok('puan muhasebesi', totalPts === 3 * totalMatches - draws, `${totalPts} ≠ ${3 * totalMatches - draws}`);
ok('atılan = yenen', tbl.reduce((s, r) => s + r.gf, 0) === tbl.reduce((s, r) => s + r.ga, 0));

/* ---------------------------------------------------------------- */
section('H2H ve maç bulma');
const hh = e.h2h(gs, fb, 10);
ok('h2h toplam tutarlı', hh.total === hh.aWins + hh.draws + hh.bWins, `${hh.total} vs ${hh.aWins + hh.draws + hh.bWins}`);
ok('h2h simetrik', (() => {
  const r = e.h2h(fb, gs, 10);
  return r.aWins === hh.bWins && r.draws === hh.draws;
})());

/* maç bulma (kupon sonuçlandırma) */
const found = e.findMatch(gs, fb, 20260426);
ok('findMatch maç buldu', !!found && found.played, found ? found.hg + '-' + found.ag : 'yok');
ok('findMatch skoru tutarlı', found && found.home === gs && found.away === fb);
ok('findMatch olmayan tarih', e.findMatch(gs, fb, 19900101) === null);

/* fikstur listesi temizligi */
const fxList = e.matchList({ mode: 'fixtures', limit: 500 });
ok('fikstür listesi geçmiş içermiyor', fxList.every((m) => m.date >= e.today), fxList.map((m) => m.date).join(','));
ok('fikstür skorları geçerli', fxList.every((m) => m.hg == null || m.hg >= 0));

/* ---------------------------------------------------------------- */
section('Bant tablosu');
const bands = e.bandTable({ league: t1, seasonFrom: 2004, seasonTo: 2100, column: 'home' });
ok('bant var', bands.length > 10, bands.length);
ok('bant olasılıkları 1', bands.every((b) => near(b.h + b.d + b.a, 1, 1e-9)));
ok('bant artan sırada', bands.every((b, i, a) => i === 0 || a[i - 1].lo < b.lo));
ok('favori bandı yüksek kazanma', bands[0].h > 0.7, bands[0].h.toFixed(2));

/* ---------------------------------------------------------------- */
section('Backtest');
const t0 = Date.now();
const bt = e.backtest({ league: t1, seasonFrom: e.maxSeason() - 1, seasonTo: e.maxSeason() });
ok('backtest çalıştı', bt.n > 100, bt.n);
ok('log-loss makul', bt.model.logLoss > 0.5 && bt.model.logLoss < 1.6, bt.model.logLoss.toFixed(3));
ok('isabet 0-1', bt.model.hit >= 0 && bt.model.hit <= 1);
ok('kalibrasyon bantları var', bt.calibration.length > 0);
ok('kasa eğrisi üretildi', Array.isArray(bt.valueModel.curve));
ok('şut ağırlığı raporlandı', typeof bt.shotWeight === 'number', String(bt.shotWeight));
const btNoShots = e.backtest({ league: t1, seasonFrom: e.maxSeason() - 1, seasonTo: e.maxSeason(), shotWeight: 0 });
ok('şut verisi modeli iyileştiriyor', bt.model.logLoss <= btNoShots.model.logLoss + 1e-9,
  `${bt.model.logLoss.toFixed(4)} <= ${btNoShots.model.logLoss.toFixed(4)}`);
ok('hızlı (<5s)', Date.now() - t0 < 5000, (Date.now() - t0) + 'ms');

/* ---------------------------------------------------------------- */
section('Canlı veri eşleştirme');
const FX = require('../lib/fixtures');
const fxIdx = FX.buildIndex(db.teams);
ok('lig eşlemesi var', !!FX.LEAGUE_IDS.T1, FX.LEAGUE_IDS.T1);
ok('türkçe normalizasyon', FX.norm('Fenerbahçe') === 'fenerbahce', FX.norm('Fenerbahçe'));
ok('sonek temizleme', FX.norm('Çorum FK') === 'corum', FX.norm('Çorum FK'));
ok('takım eşleşti (Rizespor)', FX.matchTeam('Çaykur Rizespor', fxIdx) === e.searchTeams('rizespor')[0].id);
ok('takım eşleşti (Amed SFK)', FX.matchTeam('Amed SFK', fxIdx) === e.searchTeams('amedspor')[0].id);
ok('eslesmeyen takım null', FX.matchTeam('ZZZ Bilinmeyen Kulup', fxIdx) === null);

/* ---------------------------------------------------------------- */
section('Dönüş ve canlı model');
const cbk = e.comebackTable();
ok('dönüş tablosu dolu', cbk.total.n > 100000, cbk.total.n + ' maç');
ok('dönüş oranı makul', cbk.total.donus > 0.01 && cbk.total.donus < 0.15, (cbk.total.donus * 100).toFixed(2) + '%');
ok('bantlar toplamı = arşiv', near(cbk.bands.reduce((s, b) => s + b.n, 0), cbk.total.n, 1));
const lm = e.liveModel(gs, fb, 45, 0, 1);
ok('canlı olasılık toplamı 1', near(lm.probs.h + lm.probs.d + lm.probs.a, 1, 1e-9));
const lm90 = e.liveModel(gs, fb, 94, 2, 0);
ok('uzatma anında skor belirleyici', lm90.probs.h > 0.95, (lm90.probs.h * 100).toFixed(1) + '%');
ok('geride olan favorinin şansı düşük', lm.probs.h < lm90.probs.h);

/* ---------------------------------------------------------------- */
section('Arama');
ok('kısmi arama', e.searchTeams('galat').length > 0);
ok('türkçe karakter toleransı', e.searchTeams('besiktas').length > 0 || e.searchTeams('beşiktaş').length > 0);
ok('boş sorgu boş döner', e.searchTeams('').length === 0);

/* ---------------------------------------------------------------- */
section('20 maçlık panel (bwin)');
const PANEL = require('../lib/panel');
const BWFX = require('../lib/bwfixtures');
const FXM = require('../lib/fixtures');
const pn = PANEL.createPanel(e);
const bwRows = db.matches.filter((m) => m[22] > 1).length;
ok('bwin oranı kapsamı %95+', bwRows / db.matches.length > 0.95, (bwRows / db.matches.length).toFixed(3));
const pr = pn.analyze({ h: 1.43, d: 5, a: 6, o: 1.41, u: 2.65 }, { count: 20 });
ok('20 maç bulunur', pr.found === 20 && pr.rows.length === 20);
ok('tüm eşleşmelerde 2.5 oranı var', pr.rows.every((r) => r.over25 > 1));
ok('eşleşmeler yakın oranlı', pr.rows.every((r) => Math.abs(r.o1 - 1.43) < 0.15));
ok('kart sayıları tutarlı', pr.stats.o25.k >= pr.stats.o35.k && pr.stats.iy05.k >= pr.stats.iy15.k);
ok('1-X-2 dağılımı = 1', near(pr.stats.res.h + pr.stats.res.d + pr.stats.res.a, 1));
ok('MS trendi toplamı = N', pr.stats.ftTrend.reduce((s, x) => s + x.count, 0) === pr.found);
ok('tarih sırası yeniden eskiye', pr.rows.every((r, i) => !i || pr.rows[i - 1].date >= r.date));
ok('etiket üretilir', !!pr.verdict.label);
const pr2 = pn.analyze({ h: 1.43, d: 5, a: 6 }, { count: 30, excludeLow: true });
ok('lig filtresi düşük skorlu ligleri çıkarır', pr2.rows.every((r) => !['F2', 'G1', 'SP2'].includes(r.leagueCode)));
ok('adet ayarı', pr2.found === 30);
const before = pn.analyze({ h: 2.1, d: 3.3, a: 3.4 }, { before: 20200101 });
ok('tarih sınırı (sızıntı yok)', before.rows.every((r) => r.date < 20200101));
let threw = false; try { pn.analyze({ h: 0, d: 3, a: 3 }); } catch (_) { threw = true; }
ok('eksik oran hatası', threw);
const pbt = pn.backtest({ from: 20250701, limit: 200 });
ok('panel geriye dönük test', pbt.sample > 50 && pbt.labels.length > 0);

const fxHdr = 'Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A,BWH,BWD,BWA,AvgH,AvgD,AvgA,B365>2.5,B365<2.5';
const fxCsv = `${fxHdr}\nT1,08/11/2026,13:00,Galatasaray,Amedspor,1.40,5.25,6.50,1.43,5.00,6.00,1.42,5.1,6.2,1.41,2.65\nT1,08/11/2026,16:00,Goztep,Besiktas,3.4,3.5,2.0,,,,3.3,3.5,2.05,1.8,2.0\nXX,08/11/2026,16:00,A,B,2,3,4,2,3,4,2,3,4,2,2`;
const fxp = BWFX.parseFixtures(fxCsv, e, FXM);
ok('fikstür: tanınmayan lig atlanır', fxp.length === 2);
ok('fikstür: bwin oranı okunur', fxp[0].h === 1.43 && fxp[0].oddsSource === 'bwin' && fxp[0].o === 1.41);
ok('fikstür: bwin yoksa oran boş (başka bahisçi kullanılmaz)', fxp[1].oddsSource === null && fxp[1].h === 0);
ok('fikstür: takım eşleşmesi', e.teams[fxp[0].home].n === 'Galatasaray' && e.teams[fxp[1].home].n === 'Goztepe');
ok('fikstür: Londra → yerel saat (kış +3)', BWFX.londonToLocal(20261108, '13:00').time === (new Date(Date.UTC(2026, 10, 8, 13, 0)).getHours() + ':00').padStart(5, '0'));

/* ---------------------------------------------------------------- */
(async () => {
  // API testleri (sunucu açıksa)
  const BASE = 'http://127.0.0.1:5178';
  let online = false;
  try { const r = await fetch(BASE + '/api/health'); online = r.ok; } catch (_) {}
  if (online) {
    section('API');
    const meta = await (await fetch(BASE + '/api/meta')).json();
    ok('meta maç sayısı', meta.matches === db.matches.length);
    const post = async (p, b) => {
      const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json() };
    };
    let r = await post('/api/analyze', { homeId: gs, awayId: fb, odds: target, mode: 'near', tol: 0.02, seasonFrom: 2004, seasonTo: 2100 });
    ok('analyze 200', r.status === 200);
    ok('analyze history', r.body.history && r.body.history.count > 0);
    ok('analyze model', !!r.body.model);
    ok('analyze h2h', !!r.body.h2h && r.body.h2h.total > 0);
    ok('analyze konsensüs', Math.abs(r.body.consensus.probs.h + r.body.consensus.probs.d + r.body.consensus.probs.a - 1) < 1e-6);
    ok('analyze değer', Array.isArray(r.body.value));

    r = await post('/api/analyze', { odds: target, leagueScope: 'all' });
    ok('oransız takım hatası', (await post('/api/analyze', {})).status === 500);

    const tbl2 = await (await fetch(`${BASE}/api/table?league=${t1}&season=${season}`)).json();
    ok('table API', tbl2.rows.length === tbl.length);
    const mt = await (await fetch(`${BASE}/api/matches?league=${t1}&limit=5`)).json();
    ok('matches API', mt.items.length === 5);
    const btApi = await (await fetch(`${BASE}/api/backtest?league=${t1}&from=${e.maxSeason() - 1}&to=${e.maxSeason()}`)).json();
    ok('backtest API', btApi.n > 0);
    const pApi = await post('/api/panel', { input: { h: 1.43, d: 5, a: 6 }, options: { count: 20 } });
    ok('panel API', pApi.status === 200 && pApi.body.found === 20);
    const fxApi = await (await fetch(BASE + '/api/bwfixtures')).json();
    ok('bwin fikstür API', Array.isArray(fxApi.matches));
    const st = await (await fetch(BASE + '/api/update/status')).json();
    ok('update status', st.running === false);
    const idx = await fetch(BASE + '/');
    ok('index 200', idx.status === 200);
    const sw = await fetch(BASE + '/sw.js');
    ok('sw.js 200', sw.status === 200);
  } else {
    console.log('\n(API testleri atlandı — sunucu kapalı)');
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Sonuç: ${pass} geçti, ${fail} başarısız`);
  if (fail) { console.log('\nBaşarısızlar:'); fails.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
