/**
 * Web sürümü üretici (GitHub Pages için): sunucusuz, statik site.
 * Kullanim: node tools/web.js
 * Cikti:    site/  (index.html + varlıklar + data/db.json, bwin-fixtures.json, bulletin.json)
 *
 * Tüm hesap tarayıcıda yapılır (engine + panel), veri dosyaları data/ klasöründen okunur.
 * GitHub Actions bu klasörü her güncellemede yeniden üretip yayınlar.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'site');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

/* 1) statik dosyalar: arayüz web/ klasöründen (sol maç listesi + tek sayfa analiz) */
const WEB = path.join(ROOT, 'web');
for (const f of ['icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'local-api.js']) {
  fs.copyFileSync(path.join(PUB, f), path.join(OUT, f));
}
for (const f of ['web.css', 'web.js']) fs.copyFileSync(path.join(WEB, f), path.join(OUT, f));
// eski sürümün service worker'ını kaldır (önbellekte eski arayüz kalmasın)
fs.writeFileSync(path.join(OUT, 'sw.js'), "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.map(x=>caches.delete(x)))).then(()=>self.registration.unregister())));\n");

/* 2) motor: CommonJS -> tarayıcı global */
let engine = fs.readFileSync(path.join(ROOT, 'lib', 'engine.js'), 'utf8');
engine = engine.replace(
  /module\.exports\s*=\s*\{[^}]*\};?\s*$/m,
  'window.OranEngine = { Engine, F, implied, impliedPower, wilson, poissonPmf, seasonLabel };\n'
);
if (!engine.includes('window.OranEngine')) throw new Error('engine export degisimi basarisiz');
fs.writeFileSync(path.join(OUT, 'engine.browser.js'), '(function(){\n' + engine + '\n})();\n');

/* 3) UMD modüller olduğu gibi */
fs.copyFileSync(path.join(ROOT, 'lib', 'analyze.js'), path.join(OUT, 'analyze.browser.js'));
fs.copyFileSync(path.join(ROOT, 'lib', 'fixtures.js'), path.join(OUT, 'fixtures.browser.js'));
fs.copyFileSync(path.join(ROOT, 'lib', 'panel.js'), path.join(OUT, 'panel.browser.js'));

/* 4) veri dosyaları */
const dbRaw = fs.readFileSync(path.join(DATA, 'db.json'));
fs.writeFileSync(path.join(OUT, 'data', 'db.json'), dbRaw);
const version = crypto.createHash('sha1').update(dbRaw).digest('hex').slice(0, 10);

const copyOr = (name, fallback) => {
  const src = path.join(DATA, name);
  const dst = path.join(OUT, 'data', name);
  if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  else fs.writeFileSync(dst, JSON.stringify(fallback));
};
copyOr('bwin-fixtures.json', { fetchedAt: null, source: 'none', count: 0, matches: [] });
copyOr('bulletin.json', { date: 0, dateText: '', count: 0, matches: [] });

/* 5) index.html */
let html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
html = html.replace('<meta name="theme-color" content="#0d0f12">',
  `<meta name="theme-color" content="#0d0f12">\n<meta name="data-version" content="${version}">\n<meta name="robots" content="noindex">`);
const scripts = ['engine.browser.js', 'analyze.browser.js', 'fixtures.browser.js', 'panel.browser.js', 'local-api.js', 'web.js']
  .map((f) => `<script src="${f}?v=${version}"></script>`).join('\n');
html = html.replace('<!--SCRIPTS-->', scripts + `\n<script>if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(r=>r.forEach(x=>x.unregister())).catch(()=>{});}</script>`);
html = html.replace('web.css"', `web.css?v=${version}"`);
if (!html.includes('web.js?v=')) throw new Error('index.html script enjeksiyonu basarisiz');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, '404.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./">');

/* 6) özet */
let total = 0;
const walk = (d) => fs.readdirSync(d).forEach((f) => {
  const p = path.join(d, f);
  if (fs.statSync(p).isDirectory()) walk(p); else total += fs.statSync(p).size;
});
walk(OUT);
console.log(`site/ hazır · veri sürümü ${version} · toplam ${(total / 1048576).toFixed(1)} MB`);
