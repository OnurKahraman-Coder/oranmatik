'use strict';
/* OranMatik web — sol maç listesi + tek sayfa bwin benzer maç analizi */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const o2 = (x) => (x > 1 ? (+x).toFixed(2) : '—');
const P1 = (x) => (x == null || !isFinite(x) ? '—' : '%' + (Math.round(x * 1000) / 10).toString().replace(/\.0$/, ''));
const fair = (p) => (p > 0.001 ? (1 / p).toFixed(2) : '—');
const pad = (n) => String(n).padStart(2, '0');
const dnum = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dnum(d); };
const dTxt = (n) => `${pad(n % 100)}.${pad(Math.floor((n % 10000) / 100))}.${Math.floor(n / 10000)}`;
const GUN = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const dShort = (n) => { const d = new Date(Math.floor(n / 10000), Math.floor((n % 10000) / 100) - 1, n % 100); return `${GUN[d.getDay()]} ${pad(n % 100)}.${pad(Math.floor((n % 10000) / 100))}`; };

const S = { meta: null, items: [], tab: 'today', sel: null, q: '', last: null, fxAt: null };

function toast(m, ms = 2600) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms); }
const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };
const api = (url, opts) => window.LocalAPI.handle(url, opts || {});
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });

/* ------------------------------------------------------------------ */
/*  Maç listesi: bwin fikstür + günün bülteni + ESPN canlı skorları      */
/* ------------------------------------------------------------------ */

function leagueInfo(code) {
  const l = (S.meta.leagues || []).find((x) => x.code === code);
  return l ? { name: l.name, country: l.country || '' } : { name: code, country: '' };
}
const keyOf = (m) => (m.home >= 0 && m.away >= 0 ? `${m.home}|${m.away}` : `${String(m.homeName).toLowerCase()}|${String(m.awayName).toLowerCase()}`);

function upsert(map, m) {
  const k = keyOf(m);
  const list = map.get(k) || [];
  const hit = list.find((x) => Math.abs(x.date - m.date) <= 1);
  if (hit) {
    for (const f of ['status', 'hg', 'ag', 'clock', 'time']) if (m[f] != null && m[f] !== '') hit[f] = m[f];
    if (!(hit.h > 1) && m.h > 1) Object.assign(hit, { h: m.h, d: m.d, a: m.a, o: m.o, u: m.u });
  } else {
    list.push(m);
    map.set(k, list);
  }
}

async function espnToday() {
  const FX = window.OranFixtures;
  if (!FX) return [];
  const idx = FX.buildIndex(S.meta.teams);
  const d = new Date();
  const ds = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const jobs = Object.entries(FX.LEAGUE_IDS).map(async ([code, slug]) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${ds}`, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!r.ok) return [];
      const j = await r.json();
      return (j.events || []).map((e) => FX.mapEvent(e, idx, code)).filter(Boolean);
    } catch (_) { return []; }
  });
  return (await Promise.all(jobs)).flat();
}

async function loadList(withLive = true) {
  const today = addDays(0);
  const map = new Map();
  const norm = (m, extra) => {
    const li = leagueInfo(m.league);
    return {
      league: m.league, leagueName: li.name, country: li.country,
      date: m.date, time: m.time || '', home: m.home, away: m.away,
      homeName: m.home >= 0 && S.meta.teams[m.home] ? S.meta.teams[m.home].n : m.homeName,
      awayName: m.away >= 0 && S.meta.teams[m.away] ? S.meta.teams[m.away].n : m.awayName,
      h: m.h || 0, d: m.d || 0, a: m.a || 0, o: m.o || 0, u: m.u || 0,
      status: m.status || 'ns', hg: m.hg, ag: m.ag, clock: m.clock || '', ...extra,
    };
  };
  const [fx, bl] = await Promise.all([api('/api/bwfixtures').catch(() => null), api('/api/bulletin').catch(() => null)]);
  if (fx && fx.matches) { S.fxAt = fx.fetchedAt; fx.matches.filter((m) => m.date >= today).forEach((m) => upsert(map, norm(m))); }
  // bülten birkaç saat eski olabilir: durumunu kullanma, canlı bilgisi ESPN'den gelir
  if (bl && bl.matches) bl.matches.filter((m) => m.date >= today && m.status !== 'ft').forEach((m) => upsert(map, norm(m, { h: 0, d: 0, a: 0, status: 'ns', hg: null, ag: null, clock: '' })));
  if (withLive) (await espnToday()).forEach((m) => upsert(map, norm(m, { h: 0, d: 0, a: 0 })));
  S.items = [...map.values()].flat().filter((m) => m.status !== 'ft')
    .sort((x, y) => (x.status === 'live' ? 0 : 1) - (y.status === 'live' ? 0 : 1) || x.date - y.date || x.time.localeCompare(y.time));
  renderList();
}

function inTab(m) {
  const t = addDays(0);
  switch (S.tab) {
    case 'today': return m.date === t;
    case 'tomorrow': return m.date === addDays(1);
    case 'week': return m.date <= addDays(6);
    case 'live': return m.status === 'live';
    default: return true;
  }
}

function renderList() {
  const FXn = window.OranFixtures ? window.OranFixtures.norm : (s) => String(s).toLowerCase();
  const q = FXn(S.q || '');
  const items = S.items.filter((m) => inTab(m) && (!q || FXn(m.homeName + ' ' + m.awayName).includes(q)));
  // sayaçlar
  const cnt = { today: 0, tomorrow: 0, week: 0, all: S.items.length, live: 0 };
  const save = S.tab;
  for (const tb of ['today', 'tomorrow', 'week', 'live']) { S.tab = tb; cnt[tb] = S.items.filter(inTab).length; }
  S.tab = save;
  $$('#dtabs button').forEach((b) => {
    const n = cnt[b.dataset.d];
    b.innerHTML = b.textContent.replace(/\s*\d+$/, '') + (n ? ` <span class="n">${n}</span>` : '');
  });

  const box = $('#mlist');
  if (!items.length) {
    box.innerHTML = `<div class="empty">${S.tab === 'live' ? 'Şu an canlı maç yok.' : 'Bu aralıkta maç yok.'}<br>Oranları sağdan elle girebilirsin.</div>`;
    return;
  }
  // ülke → lig → maç
  const groups = new Map();
  items.forEach((m) => {
    const c = m.country || 'Diğer';
    if (!groups.has(c)) groups.set(c, new Map());
    const lg = groups.get(c);
    if (!lg.has(m.leagueName)) lg.set(m.leagueName, []);
    lg.get(m.leagueName).push(m);
  });
  const closed = new Set(JSON.parse(store.get('om_closed') || '[]'));
  let html = '';
  for (const [c, lgs] of groups) {
    const n = [...lgs.values()].reduce((s, x) => s + x.length, 0);
    html += `<div class="cgroup${closed.has(c) ? ' closed' : ''}" data-c="${esc(c)}">
      <div class="country"><span class="ar">▼</span>${esc(c.toLocaleUpperCase('tr'))}<span class="c">${n}</span></div><div class="lgroup">`;
    for (const [lg, ms] of lgs) {
      html += `<div class="league">${esc(lg)}<span class="c">${ms.length}</span></div>`;
      ms.forEach((m) => {
        const i = S.items.indexOf(m);
        const on = S.sel === m ? ' on' : '';
        const left = m.status === 'live'
          ? `<span class="badge-live">CANLI</span>`
          : `<span class="badge-time">${S.tab === 'today' ? esc(m.time) : dShort(m.date) + '<br>' + esc(m.time)}</span>`;
        const sc = m.status === 'live' && m.hg != null ? `<small class="sc">${m.hg}-${m.ag} · ${esc(m.clock)}</small>` : '';
        const od = m.h > 1 ? `<span>${o2(m.h)}</span><span>${o2(m.d)}</span><span>${o2(m.a)}</span>` : '<span class="no">oran yok</span>';
        html += `<div class="m${on}" data-i="${i}">${left}<div class="tm">${esc(m.homeName)}<br>${esc(m.awayName)}${sc}</div><div class="odds">${od}</div></div>`;
      });
    }
    html += '</div></div>';
  }
  box.innerHTML = html;
  box.querySelectorAll('.m').forEach((el) => el.addEventListener('click', () => pick(S.items[+el.dataset.i])));
  box.querySelectorAll('.country').forEach((el) => el.addEventListener('click', () => {
    const g = el.parentElement; g.classList.toggle('closed');
    const all = [...box.querySelectorAll('.cgroup.closed')].map((x) => x.dataset.c);
    store.set('om_closed', JSON.stringify(all));
  }));
}

function pick(m) {
  S.sel = m;
  $('#iH').value = m.h > 1 ? m.h : ''; $('#iD').value = m.d > 1 ? m.d : ''; $('#iA').value = m.a > 1 ? m.a : '';
  $('#iO').value = m.o > 1 ? m.o : ''; $('#iU').value = m.u > 1 ? m.u : '';
  renderList();
  $('#side').classList.remove('open');
  if (m.h > 1) run();
  else {
    $('#out').innerHTML = `<div class="res"><div class="rhead"><div><div class="t">${esc(m.homeName)} – ${esc(m.awayName)}</div>
      <div class="sub">${esc(m.leagueName)} · ${dTxt(m.date)} ${esc(m.time)}</div></div></div>
      <div class="verd"><div class="v">bwin oranı listede yok</div><div class="s">Yukarıdaki kutulara bwin'deki 1-X-2 (ve varsa 2.5 üst/alt) oranlarını yazıp <b>Analiz et</b>'e bas.</div></div></div>`;
    $('#iH').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/* ------------------------------------------------------------------ */
/*  Analiz                                                             */
/* ------------------------------------------------------------------ */

function opts() {
  return {
    count: +($('#oCount') ? $('#oCount').value : 20),
    match: $('#oMatch') ? $('#oMatch').value : 'exact',
    line: $('#oLine') ? $('#oLine').value : 'open',
    excludeLow: $('#oLow') ? $('#oLow').checked : false,
    useOU: true,
  };
}

async function run() {
  const h = +$('#iH').value, d = +$('#iD').value, a = +$('#iA').value;
  if (!(h > 1 && d > 1 && a > 1)) { toast('1, X ve 2 oranlarını gir.'); return; }
  const m = S.sel; // seçili maçın takımları korunur (gol modeli için)
  const input = { h, d, a, o: +$('#iO').value || 0, u: +$('#iU').value || 0 };
  if (m) Object.assign(input, { home: m.home, away: m.away, homeName: m.homeName, awayName: m.awayName });
  const o = opts();
  store.set('om_web_opts', JSON.stringify(o));
  $('#out').innerHTML = '<div class="res"><div class="sub" style="color:#8a8579">Benzer maçlar aranıyor…</div></div>';
  try {
    const r = await post('/api/panel', { input, options: o });
    S.last = { r, m };
    $('#out').innerHTML = render(r, m);
    if (window.innerWidth < 900) $('#out').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    $('#out').innerHTML = `<div class="res"><div class="verd"><div class="v">Hata</div><div class="s">${esc(e.message)}</div></div></div>`;
  }
}

function render(r, m) {
  const st = r.stats, md = r.model, I = r.input;
  const mk = I.h > 1 ? (() => { const s = 1 / I.h + 1 / I.d + 1 / I.a; return { h: 1 / I.h / s, d: 1 / I.d / s, a: 1 / I.a / s }; })() : null;
  const ouP = I.o > 1 && I.u > 1 ? (1 / I.o) / (1 / I.o + 1 / I.u) : (I.o > 1 ? Math.min(0.97, 1 / I.o / 1.05) : null);
  const home = (m && m.homeName) || I.homeName || (md && md.home) || 'Ev sahibi';
  const away = (m && m.awayName) || I.awayName || (md && md.away) || 'Deplasman';
  const live = m && m.status === 'live';

  /* kartlar: tarihsel % · adil oran · piyasa (bwin/2.5) ya da model ile kıyas */
  const ref = { o25: ouP != null ? { p: ouP, t: 'piyasa' } : null, u25: ouP != null ? { p: 1 - ouP, t: 'piyasa' } : null };
  const card = (k, title, c) => {
    let cmp = '';
    const rf = ref[k] || (md && md[k] != null ? { p: md[k], t: 'model' } : null);
    if (rf) {
      const diff = (c.p - rf.p) * 100;
      cmp = `${rf.t} ${P1(rf.p)} · <b class="${diff >= 0 ? 'u' : 'd'}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}</b> ${diff >= 0 ? 'tarihsel üstün' : rf.t + ' üstün'}`;
    } else cmp = `genel ${P1(r.base[k])}`;
    return `<div class="c4"><div class="k">${title}</div><div class="v">${P1(c.p)}</div>
      <div class="n">${c.k}/${c.n} maç · <b>${fair(c.p)}</b></div>
      <div class="bar"><i style="width:${Math.round(c.p * 100)}%"></i></div><div class="cmp">${cmp}</div></div>`;
  };

  /* değer fırsatları: bwin 1-X-2 ve 2.5 oranlarına göre tarihsel fazla */
  const val = [];
  const addV = (lbl, odd, hp, mp) => { if (odd > 1 && mp != null && hp - mp >= 0.05) val.push({ lbl, odd, hp, mp, e: hp - mp }); };
  if (mk) { addV('MS 1', I.h, st.res.h, mk.h); addV('MS X', I.d, st.res.d, mk.d); addV('MS 2', I.a, st.res.a, mk.a); }
  if (ouP != null) { addV('2.5 ÜST', I.o, st.o25.p, ouP); addV('2.5 ALT', I.u, st.u25.p, 1 - ouP); }
  val.sort((x, y) => y.e - x.e);

  const trend = (list, den, ml) => {
    const mx = Math.max(...list.map((x) => x.p), 0.01);
    return list.slice(0, 8).map((x) => {
      const mp = ml ? ml.find((y) => y.s === x.score) : null;
      return `<div class="trow"><span class="dot"></span><span class="s">${esc(x.score)}</span>
        <span class="tb"><i style="width:${(x.p / mx) * 100}%"></i></span><span class="p">${P1(x.p)}</span><span class="c">${x.count}</span>
        <span class="md">${mp ? 'model ' + P1(mp.p) : ''}</span></div>`;
    }).join('') || '<div class="hs">veri yok</div>';
  };

  const hf = [...r.htftAll].sort((x, y) => y.p - x.p);
  const hfMax = Math.max(...hf.map((x) => x.p), 0.01);
  const hfRows = hf.map((x) => `<div class="trow"><span class="dot"></span><span class="s">${x.k}</span>
      <span class="tb"><i style="width:${(x.p / hfMax) * 100}%"></i></span><span class="p">${P1(x.p)}</span><span class="c">${x.count}</span>
      <span class="md">${x.model != null ? 'model ' + P1(x.model) : ''}</span></div>`).join('');

  const x12 = (k, lbl, hp, odd, mp) => `<div class="x12"><b>${k}</b><span class="d">${lbl}${mp != null ? ` · piyasa ${P1(mp)}` : ''}${md ? ` · model ${P1(md.res[k === '1' ? 'h' : k === 'X' ? 'd' : 'a'])}` : ''}</span><span class="p">${P1(hp)}</span><b>${o2(odd)}</b></div>`;

  const hit = (v, t) => (Math.abs(v - t) < 0.005 ? ' class="eq"' : '');
  const rows = r.rows.map((x) => `<tr class="${x.rocket ? 'g6' : ''}"><td class="dt">${dTxt(x.date)}</td><td class="l">${esc(x.league)}</td>
      <td class="match">${esc(x.home)} - ${esc(x.away)}${x.rocket ? ' 🚀' : ''}</td><td><span class="pill">${esc(x.ht || '—')}</span></td>
      <td><span class="ms">${esc(x.ft)}</span></td><td>${esc(x.htft || '—')}</td>
      <td${hit(x.o1, I.h)}>${o2(x.o1)}</td><td${hit(x.oX, I.d)}>${o2(x.oX)}</td><td${hit(x.o2, I.a)}>${o2(x.o2)}</td>
      <td>${o2(x.under25)}</td><td>${o2(x.over25)}</td></tr>`).join('');
  const mrows = r.rows.map((x) => `<div class="hrow${x.rocket ? ' g6' : ''}"><div class="a"><span>${dTxt(x.date)}</span><span>${esc(x.league)}</span></div>
      <div class="b"><span class="h">${esc(x.home)}</span><span class="sc"><span class="ms">${esc(x.ft)}</span><small>İY ${esc(x.ht || '—')} · ${esc(x.htft || '')}</small></span><span>${esc(x.away)}${x.rocket ? ' 🚀' : ''}</span></div>
      <div class="c"><span${hit(x.o1, I.h)}>1 ${o2(x.o1)}</span><span${hit(x.oX, I.d)}>X ${o2(x.oX)}</span><span${hit(x.o2, I.a)}>2 ${o2(x.o2)}</span><span>A ${o2(x.under25)}</span><span>Ü ${o2(x.over25)}</span></div></div>`).join('');

  const v = r.verdict;
  const vtxt = v.label.split(' — ');
  return `<div class="res">
    <div class="rhead">
      <div>
        <div class="t">${live ? '<span class="badge-live">CANLI</span>' : ''}${esc(home)} – ${esc(away)}${live && m.hg != null ? ` <span class="lsc">${m.hg}-${m.ag} · ${esc(m.clock)}</span>` : ''}</div>
        <div class="sub">${m ? `${esc(m.country || '')} · ${esc(m.leagueName || '')} · ${dTxt(m.date)} ${esc(m.time || '')} · ` : ''}<b>bwin</b>${r.options.line === 'close' ? ' kapanış' : ''}</div>
      </div>
      <div class="rodds"><span><i>1</i>${o2(I.h)}</span><span><i>X</i>${o2(I.d)}</span><span><i>2</i>${o2(I.a)}</span>${I.o ? `<span><i>2.5 Ü</i>${o2(I.o)}</span>` : ''}${I.u ? `<span><i>2.5 A</i>${o2(I.u)}</span>` : ''}</div>
    </div>

    <div class="verd ${v.tone}"><div class="v">${esc(vtxt[0])}${vtxt[1] ? ` <span>— ${esc(vtxt[1])}</span>` : ''}</div>
      <div class="s">2.5 üst ${P1(st.o25.p)} — alt ${P1(st.u25.p)} (${r.found} benzer maç) · KG var ${P1(st.kg.p)} · İY 0.5 üst ${P1(st.iy05.p)} · maç başı ${st.avgGoals.toFixed(2)} gol${v.side ? ' · ' + esc(v.side) : ''}</div></div>

    <div class="sect"><h3>${r.found} Maçlık İstatistik Paneli</h3>
      <div class="hs">${r.found} benzer maç${mk ? ` · bwin: 1 ${P1(mk.h)} · X ${P1(mk.d)} · 2 ${P1(mk.a)}` : ''}${ouP != null ? ` · 2.5 üst ${P1(ouP)}` : ''} · % = benzer maçlarda gerçekleşme sıklığı · yanındaki oran = adil oran</div>
      <div class="cards">
        ${card('iy05', 'İY 0.5 Üst', st.iy05)}${card('iy15', 'İY 1.5 Üst', st.iy15)}${card('kg', 'KG Var', st.kg)}${card('o25', '2.5 Üst', st.o25)}
        ${card('o35', '3.5 Üst', st.o35)}${card('o15', '1.5 Üst', st.o15)}${card('u25', '2.5 Alt', st.u25)}${card('kg25', 'KG + 2.5 Üst', st.kg25)}
      </div></div>

    ${val.length ? `<div class="sect"><h3>Değer Fırsatları</h3><div class="hs">bwin oranına göre tarihsel olarak daha sık gerçekleşenler</div><div class="box">
      ${val.map((x) => `<div class="vrow"><b>${x.lbl}</b><span class="o">${o2(x.odd)}</span><span class="d">tarihsel ${P1(x.hp)} · piyasa ${P1(x.mp)}</span><span class="e">+${(x.e * 100).toFixed(1)}</span></div>`).join('')}
    </div></div>` : ''}

    <div class="sect two">
      <div><h3>İlk Yarı Skor Trendi</h3><div class="box">${trend(st.htTrend, st.htN, md && md.htScores)}</div></div>
      <div><h3>Maç Sonu Skor Trendi</h3><div class="box">${trend(st.ftTrend, st.n, md && md.ftScores)}</div></div>
    </div>

    <div class="sect two">
      <div><h3>İY / MS Kombinasyonları</h3><div class="box">${hfRows}</div></div>
      <div><h3>1X2 ve Gol Beklentisi</h3><div class="box">
        ${x12('1', 'ev sahibi', st.res.h, I.h, mk && mk.h)}${x12('X', 'beraberlik', st.res.d, I.d, mk && mk.d)}${x12('2', 'deplasman', st.res.a, I.a, mk && mk.a)}
        <div class="hs" style="margin:10px 0 0">${ouP != null ? `Marj temizlenmiş 2.5 üst olasılığı: <b>${P1(ouP)}</b> · ` : ''}benzer maçlarda maç başı <b>${st.avgGoals.toFixed(2)}</b> gol${md ? ` · model beklenen gol <b>${md.lambda.home.toFixed(2)} – ${md.lambda.away.toFixed(2)}</b>` : ''} · 6+ gol 🚀 ${st.g6.k}/${st.g6.n}</div>
      </div></div>
    </div>

    ${md ? `<div class="sect"><h3>Model Adil Oranları</h3><div class="hs">takımların gol gücünden hesaplanır (bwin oranı değildir)</div>
      <div class="lbl2">İY/MS</div><div class="chips">${['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'].map((k) => `<span>${k}<b>${fair(md.htft[k])}</b></span>`).join('')}</div>
      <div class="lbl2">Skor (en olası 12)</div><div class="chips">${md.ftScores.map((x) => `<span>${x.s}<b>${fair(x.p)}</b></span>`).join('')}</div>
      <div class="lbl2">İlk yarı skor</div><div class="chips">${md.htScores.map((x) => `<span>${x.s}<b>${fair(x.p)}</b></span>`).join('')}</div></div>` : ''}

    <div class="sect"><h3>Geçmiş Maçlar</h3>
      <div class="tbl"><table class="hist"><thead><tr><th>Tarih</th><th class="l">Lig</th><th class="l">Maç</th><th>İY</th><th>MS</th><th>İY/MS</th><th>1</th><th>X</th><th>2</th><th>2.5 Alt</th><th>2.5 Üst</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="cards-m">${mrows}</div>
    </div>

    <div class="rfoot"><b>Yöntem:</b> bwin 1-X-2 (ve 2.5) oranı aynı ya da en yakın geçmiş maçlar bulunur${r.options.match === 'exact' ? '; en az 2 oranı birebir aynı olanlar önce gelir' : ''}. Turuncu oran = birebir aynı.
      <b>Kaynak:</b> oranlar bwin · sonuçlar ${(S.meta.matches || 0).toLocaleString('tr-TR')} maçlık arşiv (16 lig, 2004–). ${esc(r.notes.join(' '))}
      <b>Not:</b> geçmiş performans geleceğin garantisi değildir · 18+</div>
  </div>`;
}

/* ------------------------------------------------------------------ */

async function boot() {
  try {
    S.meta = await api('/api/meta');
    $('#eyebrow').textContent = `BWIN ORANLARI · ${S.meta.matches.toLocaleString('tr-TR')} MAÇLIK ARŞİV`;
    $('#splash').classList.add('off');
    $('#sfoot').textContent = `veri: ${dTxt(S.meta.lastDate)} · her 3 saatte güncellenir`;

    // ayarlar (küçük satır)
    const sv = JSON.parse(store.get('om_web_opts') || '{}');
    $('.manual').insertAdjacentHTML('beforeend', `<div class="opts">
      <label>Eşleşme <select id="oMatch"><option value="exact">Birebir (2 oran aynı)</option><option value="near">En yakın oran</option></select></label>
      <label>Maç sayısı <select id="oCount"><option>10</option><option selected>20</option><option>30</option><option>50</option></select></label>
      <label>bwin oranı <select id="oLine"><option value="open">Açılış</option><option value="close">Kapanış (2019–)</option></select></label>
      <label><input type="checkbox" id="oLow"> Düşük skorlu ligleri hariç tut</label></div>`);
    if (sv.match) $('#oMatch').value = sv.match;
    if (sv.count) $('#oCount').value = String(sv.count);
    if (sv.line) $('#oLine').value = sv.line;
    if (sv.excludeLow) $('#oLow').checked = true;

    $('#go').addEventListener('click', run);
    ['#iH', '#iD', '#iA', '#iO', '#iU'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); }));
    $$('#dtabs button').forEach((b) => b.addEventListener('click', () => {
      S.tab = b.dataset.d; $$('#dtabs button').forEach((x) => x.classList.toggle('on', x === b)); renderList();
    }));
    $('#q').addEventListener('input', (e) => { S.q = e.target.value; renderList(); });
    $('#sideToggle').addEventListener('click', () => $('#side').classList.add('open'));
    document.addEventListener('click', (e) => {
      if (window.innerWidth < 900 && $('#side').classList.contains('open') && !e.target.closest('#side') && !e.target.closest('#sideToggle')) $('#side').classList.remove('open');
    });

    await loadList(false);          // önce hızlı liste (bwin fikstür + bülten)
    loadList(true).then(() => {      // sonra canlı skorlar
      if (!S.items.some((m) => m.date === addDays(0)) && S.items.length) { S.tab = 'week'; $$('#dtabs button').forEach((x) => x.classList.toggle('on', x.dataset.d === 'week')); renderList(); }
    });
    // canlı skorları 90 sn'de bir yenile
    setInterval(async () => {
      if (document.hidden) return;
      const prevSel = S.sel ? keyOf(S.sel) : null;
      await loadList(true);
      if (prevSel) {
        const again = S.items.find((m) => keyOf(m) === prevSel);
        if (again) { S.sel = again; renderList(); if (S.last) { $('#out').innerHTML = render(S.last.r, again); } }
      }
    }, 90000);
  } catch (e) {
    $('#splashMsg').textContent = 'Yüklenemedi: ' + e.message;
  }
}

boot();
