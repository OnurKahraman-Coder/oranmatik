/**
 * Gunluk bulten — ESPN uzerinden tum kapsanan liglerin tek gunluk mac listesi.
 * Her gun 00:30'da (ve sunucu acilirken eksikse) yenilenir.
 *
 * Cikti: data/bulletin.json  { date, fetchedAt, matches: [...] }
 */
const fs = require('fs');
const path = require('path');
const FX = require('./fixtures');

const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const SLUGS = FX.LEAGUE_IDS;

function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(d) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }
function dateNum(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

async function fetchDay(index, date, opts = {}) {
  const d = date || new Date();
  const s = stamp(d);
  const out = [];
  const codes = Object.keys(SLUGS);

  for (const code of codes) {
    const slug = SLUGS[code];
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 9000);
      const r = await fetch(`${API}/${slug}/scoreboard?dates=${s}`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      for (const ev of j.events || []) {
        const m = FX.mapEvent(ev, index, code);
        if (m) out.push(m);
      }
    } catch (_) { /* lig atlanir */ }
  }

  // tekille
  const seen = new Set();
  const uniq = out.filter((m) => {
    const k = m.id || `${m.date}|${m.homeName}|${m.awayName}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const rank = (m) => (m.status === 'live' ? 0 : m.status === 'ns' ? 1 : 2);
  uniq.sort((a, b) => rank(a) - rank(b) || a.date - b.date || (a.time || '').localeCompare(b.time || ''));

  return {
    date: dateNum(d),
    dateText: `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`,
    fetchedAt: new Date().toISOString(),
    count: uniq.length,
    matches: uniq,
  };
}

function save(dir, payload) {
  fs.mkdirSync(dir, { recursive: true });
  // internet yokken gelen bos liste, ayni gunun dolu listesinin uzerine yazilmasin
  if (!payload.count) {
    const cur = load(dir);
    if (cur && cur.date === payload.date && cur.count > 0) return;
  }
  fs.writeFileSync(path.join(dir, 'bulletin.json'), JSON.stringify(payload), 'utf8');
  fs.writeFileSync(path.join(dir, `bulletin-${payload.date}.json`), JSON.stringify(payload), 'utf8');
}

function load(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'bulletin.json'), 'utf8'));
  } catch (_) { return null; }
}

module.exports = { fetchDay, save, load, stamp, dateNum };
