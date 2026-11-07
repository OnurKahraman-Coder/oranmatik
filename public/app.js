'use strict';
/* OranMatik — arayüz mantığı */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const pct = (x, d = 1) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%');
const pct0 = (x) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(0) + '%');
const f2 = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(2));
const signed = (x, d = 1) => (x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const AYLAR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const fmtDate = (n) => {
  if (!n) return '—';
  const y = Math.floor(n / 10000), m = Math.floor((n % 10000) / 100), d = n % 100;
  return `${d} ${AYLAR[m - 1] || ''} ${y}`;
};
const seasonLabel = (s) => (s ? `${s}/${String((Number(s) + 1) % 100).padStart(2, '0')}` : '—');

const state = {
  meta: null,
  home: null,
  away: null,
  lastBody: null,
  lastResult: null,
  updateTimer: null,
  abortDb: null,
};

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), ms);
}

/** Kalıcı depolama: tarayıcıda localStorage, Android'de NativeStore köprüsü */
const Store = {
  get(k) {
    try {
      if (window.NativeStore && window.NativeStore.get) return window.NativeStore.get(k);
      return localStorage.getItem(k);
    } catch (_) { return null; }
  },
  set(k, v) {
    try {
      if (window.NativeStore && window.NativeStore.set) { window.NativeStore.set(k, v); return; }
      localStorage.setItem(k, v);
    } catch (_) {}
  },
};

/** Sunucu API'si; mobil pakette window.LocalAPI devreye girer */
async function api(url, opts) {
  if (window.LocalAPI) return window.LocalAPI.handle(url, opts || {});
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
const post = (url, body) => api(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

/* ---------------------------- grafikler ---------------------------- */

function lineChart(series, opt = {}) {
  const W = opt.w || 640, H = opt.h || 220;
  const pad = { l: 46, r: 14, t: 14, b: 26 };
  const all = series.flatMap((s) => s.points);
  if (!all.length) return '<div class="hint">Grafik için veri yok.</div>';

  let xMin = opt.xMin != null ? opt.xMin : Math.min(...all.map((p) => p.x));
  let xMax = opt.xMax != null ? opt.xMax : Math.max(...all.map((p) => p.x));
  let yMin = opt.yMin != null ? opt.yMin : Math.min(...all.map((p) => p.y));
  let yMax = opt.yMax != null ? opt.yMax : Math.max(...all.map((p) => p.y));
  if (opt.diagonal) { xMin = yMin = Math.min(xMin, yMin); xMax = yMax = Math.max(xMax, yMax); }
  if (xMax === xMin) xMax = xMin + 1;
  if (yMax === yMin) yMax = yMin + 1;
  const yPad = (yMax - yMin) * 0.12;
  yMin -= yPad; yMax += yPad;

  const sx = (x) => pad.l + ((x - xMin) / (xMax - xMin)) * (W - pad.l - pad.r);
  const sy = (y) => H - pad.b - ((y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const ticks = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

  let grid = '';
  const seenY = new Set();
  for (const t of ticks(yMin, yMax, 4)) {
    const lab = opt.fmtY ? opt.fmtY(t) : t.toFixed(2);
    if (seenY.has(lab)) continue;
    seenY.add(lab);
    const y = sy(t);
    grid += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#1e2a38"/>`;
    grid += `<text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#5f7185">${lab}</text>`;
  }
  const seenX = new Set();
  for (const t of ticks(xMin, xMax, 5)) {
    const lab = opt.fmtX ? opt.fmtX(t) : String(Math.round(t));
    if (seenX.has(lab)) continue;
    seenX.add(lab);
    grid += `<text x="${sx(t)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#5f7185">${lab}</text>`;
  }  if (opt.zeroLine && yMin < 0 && yMax > 0) {
    grid += `<line x1="${pad.l}" y1="${sy(0)}" x2="${W - pad.r}" y2="${sy(0)}" stroke="#42566b" stroke-dasharray="4 3"/>`;
  }
  if (opt.diagonal) {
    grid += `<line x1="${sx(xMin)}" y1="${sy(yMin)}" x2="${sx(xMax)}" y2="${sy(yMax)}" stroke="#42566b" stroke-dasharray="5 4"/>`;
  }

  let paths = '';
  for (const s of series) {
    const pts = [...s.points].sort((a, b) => a.x - b.x);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    if (s.area) {
      paths += `<path d="${d} L${sx(pts[pts.length - 1].x).toFixed(1)},${sy(Math.max(yMin, 0))} L${sx(pts[0].x).toFixed(1)},${sy(Math.max(yMin, 0))} Z" fill="${s.color}" opacity="0.10"/>`;
    }
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round"/>`;
    if (s.dots) for (const p of pts) paths += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="2.6" fill="${s.color}"/>`;
  }

  const legend = series.map((s) => `<span class="lg"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${paths}</svg>
    <div class="legend">${legend}</div></div>`;
}

/* ---------------------------- başlat ---------------------------- */

let splashHidden = false;
function hideSplash(text) {
  const sp = $('#splash');
  if (text) { const m = $('#splashMsg'); if (m) m.textContent = text; }
  if (splashHidden || !sp) return;
  splashHidden = true;
  sp.classList.add('off');
  setTimeout(() => { try { sp.remove(); } catch (_) {} }, 450);
}

async function init() {
  /* açılış perdesi 15 sn içinde kapanmazsa kullanıcıyı bekletme */
  setTimeout(() => { if (!splashHidden) { hideSplash(); toast('Yükleme uzun sürdü — sayfayı yenilemeyi dene'); } }, 15000);
  try {
    const meta = await api('/api/meta');
    state.meta = meta;
    renderDataTab(meta);

    $('#badgeData').innerHTML = `<span class="dot"></span> <b>${meta.matches.toLocaleString('tr-TR')}</b> maç · <b>${meta.teams.length}</b> takım`;
    $('#badgeRange').textContent = `${fmtDate(meta.firstDate)} → ${fmtDate(meta.lastDate)}`;

    const leagueOpts = meta.leagues.filter((l) => l.matches)
      .map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    $('#selLeague').insertAdjacentHTML('beforeend', leagueOpts);
    $('#mLeague').insertAdjacentHTML('beforeend', leagueOpts);
    $('#pickLeague').insertAdjacentHTML('beforeend', leagueOpts);
    $('#tLeague').innerHTML = leagueOpts;
    $('#btLeague').innerHTML = leagueOpts;

    const seasonOpts = meta.seasons.map((s) => `<option value="${s}">${seasonLabel(s)}</option>`).join('');
    for (const id of ['#selFrom', '#btFrom', '#tSeason', '#selTo', '#btTo']) $(id).innerHTML = seasonOpts;
    $('#tSeason').value = meta.seasons[meta.seasons.length - 1];
    $('#selTo').value = meta.seasons[meta.seasons.length - 1];
    $('#btFrom').value = meta.seasons[Math.max(0, meta.seasons.length - 2)];
    $('#btTo').value = meta.seasons[meta.seasons.length - 1];

    // varsayılan lig: Türkiye Süper Lig
    const tr = meta.leagues.find((l) => l.code === 'T1');
    if (tr) {
      for (const id of ['#tLeague', '#btLeague', '#pickLeague', '#mLeague']) $(id).value = String(tr.id);
    }

    restoreSettings();
    bindUI();
    loadTable();
    loadPicker();
    calcMarket();
    calcKelly();
    calcBankroll();
    renderBets();
    renderSaved();
    applyDeepLink();
    updateBankHint();
    hideSplash();
    if (meta.web) {
      // web sürümü: veri her gün sunucuda (GitHub Actions) otomatik güncellenir
      ['#btnUpdate', '#mobileCard', '#mobileUpdateCard'].forEach((s) => { const el = $(s); if (el) el.style.display = 'none'; });
      const h = $('#updateHint');
      if (h) h.innerHTML = `Veri her gün otomatik güncellenir. Son derleme: <b>${new Date(meta.builtAt).toLocaleString('tr-TR')}</b>`;
      if (!location.search) showTab('panel'); // web sürümü 20 maçlık panelle açılır
    } else if (window.LocalAPI) {
      const b = $('#btnUpdate');
      if (b) b.style.display = 'none';
      const h = $('#updateHint');
      if (h) h.textContent = 'Bu sürümde veri paket içinde gelir.';
      const mc = $('#mobileCard');
      if (mc) mc.style.display = 'none';
      const mu = $('#mobileUpdateCard');
      if (mu) mu.style.display = '';
      const srv = $('#srvUrl');
      if (srv) {
        const meta = document.querySelector('meta[name="default-server"]');
        srv.value = Store.get('om_server') || (meta ? meta.getAttribute('content') : '') || '';
      }
      const st = $('#mobileUpdateStatus');
      if (st) st.textContent = `Mevcut veri: ${fmtDate(meta.lastDate)} · ${meta.matches.toLocaleString('tr-TR')} maç`;
      const bu = $('#btnMobileUpdate');
      if (bu) bu.addEventListener('click', mobileUpdate);
    } else if (meta.lanUrls && meta.lanUrls.length) {
      const hint = $('#apkUrlHint');
      if (hint) {
        hint.innerHTML = `Telefonda: <b>${meta.lanUrls[0]}/OranMatik.apk</b>`;
      }
      const mu = $('#mobileUpdateCard');
      if (mu) mu.style.display = 'none';
    }
  } catch (e) {
    console.error(e);
    hideSplash('yüklenemedi');
    $('#badgeData').innerHTML = '<span class="dot off"></span> sunucuya bağlanılamadı';
    toast('Sunucu hatası: ' + e.message);
  }
}

/* ---------------------------- ayarlar ---------------------------- */

function restoreSettings() {
  try {
    const s = JSON.parse(Store.get('om_settings') || '{}');
    const set = (id, v) => { if (v != null && $(id)) $(id).value = v; };
    set('#tolRange', s.tol); set('#selMode', s.mode); set('#selLeague', s.league);
    set('#selFrom', s.from); set('#selTo', s.to);
    set('#wMarket', s.wMarket); set('#wModel', s.wModel); set('#wHistory', s.wHistory);
  } catch (_) {}
  syncWeightLabels();
  $('#tolVal').textContent = Number($('#tolRange').value).toFixed(3);
}

function saveSettings() {
  Store.set('om_settings', JSON.stringify({
    tol: $('#tolRange').value, mode: $('#selMode').value, league: $('#selLeague').value,
    from: $('#selFrom').value, to: $('#selTo').value,
    wMarket: $('#wMarket').value, wModel: $('#wModel').value, wHistory: $('#wHistory').value,
  }));
}

function syncWeightLabels() {
  $('#wMVal').textContent = $('#wMarket').value + '%';
  $('#wModVal').textContent = $('#wModel').value + '%';
  $('#wHVal').textContent = $('#wHistory').value + '%';
}

/* ---------------------------- sekmeler ---------------------------- */

function showTab(name) {
  const btn = document.querySelector(`#tabs .tab[data-view="${name}"]`);
  if (!btn) return;
  $$('#tabs .tab').forEach((x) => x.classList.remove('on'));
  btn.classList.add('on');
  $$('.view').forEach((v) => v.classList.remove('on'));
  $('#v-' + name).classList.add('on');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'veri') renderDataTab(state.meta);
  if (name === 'hesap') { calcMarket(); calcKelly(); calcBankroll(); }
  if (name === 'kupon') { renderBets(); autoSettleBets(true); }
  if (name === 'maclar' && !$('#matchOut').dataset.loaded) loadMatches();
  if (name === 'panel' && !NP.loaded) npLoadFixtures(false);
}

function bindUI() {
  $$('#tabs .tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.view)));

  $$('.subtab').forEach((b) => b.addEventListener('click', () => {
    $$('.subtab').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
  }));

  setupAC('#homeInput', '#homeList', 'home');
  setupAC('#awayInput', '#awayList', 'away');

  npBind();
  $('#btnAnalyze').addEventListener('click', () => runAnalysis());
  $('#btnClear').addEventListener('click', clearForm);
  $('#btnSaveAnalysis').addEventListener('click', saveCurrentAnalysis);

  ['#oH', '#oD', '#oA'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); }));

  $('#tolRange').addEventListener('input', (e) => {
    $('#tolVal').textContent = Number(e.target.value).toFixed(3);
    saveSettings();
  });
  ['#selMode', '#selLeague', '#selFrom', '#selTo'].forEach((s) => $(s).addEventListener('change', saveSettings));
  ['#wMarket', '#wModel', '#wHistory'].forEach((s) => $(s).addEventListener('input', () => { syncWeightLabels(); saveSettings(); }));

  ['#pickLeague', '#pickMode'].forEach((s) => $(s).addEventListener('change', loadPicker));
  $('#pickMatch').addEventListener('change', pickMatchChanged);
  $('#btnLoadTable').addEventListener('click', loadTable);
  ['#tLeague', '#tSeason'].forEach((s) => $(s).addEventListener('change', loadTable));
  $('#btnBacktest').addEventListener('click', runBacktest);
  $('#btnLoadMatches').addEventListener('click', () => loadMatches(true));
  ['#mLeague', '#mMode', '#mLimit'].forEach((s) => $(s).addEventListener('change', () => loadMatches(false)));

  ['#cH', '#cD', '#cA'].forEach((s) => $(s).addEventListener('input', calcMarket));
  ['#kOdds', '#kProb', '#kBank'].forEach((s) => $(s).addEventListener('input', calcKelly));
  ['#brBank', '#brUnit', '#brOdds'].forEach((s) => $(s).addEventListener('input', calcBankroll));
  $('#btnApplyBank').addEventListener('click', calcBankroll);

  $('#btnBetAdd').addEventListener('click', addBet);
  $('#btnBetSettle').addEventListener('click', () => autoSettleBets(false));
  $('#btnBetExport').addEventListener('click', exportBets);
  $('#btnBetImport').addEventListener('click', () => $('#betFile').click());
  $('#betFile').addEventListener('change', importBets);

  $('#btnSaveBank').addEventListener('click', () => {
    const v = Number($('#bankMain').value);
    if (v > 0) {
      Store.set('om_bank', String(v));
      toast('Banka kaydedildi: ' + v.toLocaleString('tr-TR') + ' ₺');
      updateBankHint();
      if (state.lastResult) renderResults(state.lastResult);
    } else {
      toast('Geçerli bir tutar gir');
    }
  });

  $('#btnUpdate').addEventListener('click', startUpdate);
  $('#btnTestLive').addEventListener('click', testLive);

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
      e.preventDefault(); showTab('analiz'); $('#homeInput').focus();
    }
  });
}

function clearForm() {
  state.home = state.away = null;
  $('#homeInput').value = ''; $('#awayInput').value = '';
  ['#oH', '#oD', '#oA', '#ouOver', '#ouUnder', '#bttsYes', '#bttsNo'].forEach((s) => ($(s).value = ''));
  $('#results').innerHTML = '';
  $('#emptyState').style.display = '';
  $('#leagueHint').textContent = '';
}

/* ------------------------ takım otomatik tamamlama ------------------------ */

function setupAC(inputSel, listSel, side) {
  const inp = $(inputSel);
  const list = $(listSel);
  let items = [], sel = -1, timer = null;
  const close = () => { list.classList.remove('on'); sel = -1; };
  const choose = (it) => {
    state[side] = it.id;
    inp.value = it.name;
    close();
    const lg = state.meta.leagues[state.meta.teams[it.id].l];
    $('#leagueHint').textContent = lg ? lg.name : '';
    if ($('#selLeague').value !== 'all') $('#selLeague').value = 'auto';
  };
  const render = () => {
    if (!items.length) { close(); return; }
    list.innerHTML = items.map((it, i) =>
      `<div class="ac-item ${i === sel ? 'sel' : ''}" data-i="${i}"><span style="color:var(--text)">${esc(it.name)}</span><span>${esc(it.leagueName || '')}</span></div>`).join('');
    list.classList.add('on');
    [...list.children].forEach((c) => c.addEventListener('mousedown', (e) => { e.preventDefault(); choose(items[+c.dataset.i]); }));
  };

  inp.addEventListener('input', () => {
    state[side] = null;
    clearTimeout(timer);
    const q = inp.value.trim();
    if (q.length < 2) { items = []; close(); return; }
    timer = setTimeout(async () => {
      try { items = (await api('/api/teams?q=' + encodeURIComponent(q))).items || []; sel = -1; render(); } catch (_) {}
    }, 110);
  });

  inp.addEventListener('keydown', (e) => {
    if (!list.classList.contains('on')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); choose(items[sel]); }
    else if (e.key === 'Escape') close();
  });
  inp.addEventListener('blur', () => setTimeout(close, 140));
}

/* ---------------------------- analiz ---------------------------- */

function buildAnalyzeBody() {
  const odds = { h: +$('#oH').value, d: +$('#oD').value, a: +$('#oA').value };
  const hasOdds = odds.h > 1 && odds.d > 1 && odds.a > 1;
  return {
    homeId: state.home, awayId: state.away,
    odds: hasOdds ? odds : null,
    ou: (+$('#ouOver').value > 1 && +$('#ouUnder').value > 1) ? { over: +$('#ouOver').value, under: +$('#ouUnder').value } : null,
    btts: (+$('#bttsYes').value > 1 && +$('#bttsNo').value > 1) ? { yes: +$('#bttsYes').value, no: +$('#bttsNo').value } : null,
    leagueScope: $('#selLeague').value,
    leagueId: ($('#selLeague').value === 'auto' || $('#selLeague').value === 'all') ? null : +$('#selLeague').value,
    seasonFrom: +$('#selFrom').value,
    seasonTo: +$('#selTo').value,
    mode: $('#selMode').value,
    tol: +$('#tolRange').value,
    wMarket: +$('#wMarket').value / 100,
    wModel: +$('#wModel').value / 100,
    wHistory: +$('#wHistory').value / 100,
    minute: state.liveMinute || null,
    liveH: state.liveScore ? state.liveScore.h : null,
    liveA: state.liveScore ? state.liveScore.a : null,
  };
}

async function runAnalysis(body) {
  const btn = $('#btnAnalyze');
  const data = body || buildAnalyzeBody();
  const hasOdds = data.odds && data.odds.h > 1 && data.odds.d > 1 && data.odds.a > 1;
  if (!hasOdds && data.homeId == null) { toast('Oran gir ya da takım seç.'); return; }
  if (data.homeId == null && $('#homeInput').value.trim()) {
    toast('Takımı listeden seçmelisin (ismin üzerine tıkla).'); return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> hesaplanıyor…';
  try {
    const res = await post('/api/analyze', data);
    state.lastResult = res;
    state.lastBody = data;
    renderResults(res);
    $('#emptyState').style.display = 'none';
    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    toast('Hata: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analiz Et';
  }
}

function triBar(p) {
  const h = Math.max(0, p.h), d = Math.max(0, p.d), a = Math.max(0, p.a);
  return `<div class="tri">
    <div class="h" style="width:${h * 100}%">${h > 0.08 ? pct0(h) : ''}</div>
    <div class="d" style="width:${d * 100}%">${d > 0.08 ? pct0(d) : ''}</div>
    <div class="a" style="width:${a * 100}%">${a > 0.08 ? pct0(a) : ''}</div>
  </div>`;
}

function big3(p, sub) {
  return `<div class="big3">
    <div class="b h"><b>${pct(p.h)}</b><small>1 · ${sub || 'Ev'}</small></div>
    <div class="b d"><b>${pct(p.d)}</b><small>X · Berabere</small></div>
    <div class="b a"><b>${pct(p.a)}</b><small>2 · Dep</small></div>
  </div>`;
}

function cmpRow(label, p) {
  return `<div class="cmp-row">
    <div class="lbl">${label}</div>
    <div class="cmp-bar">
      <div class="h" style="width:${p.h * 100}%">${p.h > 0.1 ? pct0(p.h) : ''}</div>
      <div class="d" style="width:${p.d * 100}%">${p.d > 0.1 ? pct0(p.d) : ''}</div>
      <div class="a" style="width:${p.a * 100}%">${p.a > 0.1 ? pct0(p.a) : ''}</div>
    </div>
  </div>`;
}

function teamName(id) {
  return id != null && state.meta.teams[id] ? esc(state.meta.teams[id].n) : '?';
}

function renderResults(r) {
  const inp = r.input;
  const title = inp.home && inp.away ? `${teamName(inp.home.id)} <span style="color:var(--dim)">vs</span> ${teamName(inp.away.id)}` : 'Oran Analizi';
  let html = '';

  if (r.consensus) {
    html += `<div class="card">
      <h3>Konsensüs Tahmin <span class="spacer"></span>
        <span class="pill">${r.dataInfo ? 'veri ' + fmtDate(r.dataInfo.lastDate) : ''}</span>
        <span class="pill">${r.consensus.weights.map((w) => `${w.name === 'market' ? 'Piyasa' : w.name === 'model' ? 'Model' : 'Tarihsel'} ${Math.round(w.w * 100)}%`).join(' · ')}</span></h3>
      <div style="font-size:17px;font-weight:800;margin-bottom:12px">${title}
        <span style="float:right;font-size:13px;color:var(--muted);font-weight:600">${r.input.odds ? `${f2(r.input.odds.h)} · ${f2(r.input.odds.d)} · ${f2(r.input.odds.a)}` : '—'}</span></div>
      ${triBar(r.consensus.probs)}
      <div style="margin-top:14px">${big3(r.consensus.probs, 'Konsensüs')}</div>
      <div class="cmp" style="margin-top:16px">
        ${r.market ? cmpRow('Piyasa', r.market.probs) : ''}
        ${r.model ? cmpRow('Model', r.model.probs) : ''}
        ${r.history && r.history.count ? cmpRow('Tarihsel', r.history.dist) : ''}
      </div>
      ${r.verdict && r.verdict.length ? `<div class="verdict" style="margin-top:16px">${r.verdict.map((v) => `<div>${esc(v)}</div>`).join('')}</div>` : ''}
    </div>`;
  } else {
    html += `<div class="card"><h3>Özet</h3><div style="font-size:16px;font-weight:700;margin-bottom:10px">${title}</div>
      <div class="hint">Takım seçmediğin için konsensüs üretilmedi.</div></div>`;
  }

  if (r.history) {
    const h = r.history;
    html += `<div class="grid g2" style="margin-top:16px">
      <div class="card">
        <h3>Tarihsel Oran Eşleşmesi <span class="spacer"></span>
          <span class="pill ${h.count >= 100 ? 'g' : h.count >= 30 ? 'y' : 'r'}">${h.count} maç</span></h3>
        ${h.count ? `
          ${big3(h.dist, 'Tarihsel')}
          <div class="row" style="justify-content:space-between;font-size:11px;color:var(--dim);margin-top:6px">
            <span>GA ${pct(h.ci.h[0])}–${pct(h.ci.h[1])}</span>
            <span>GA ${pct(h.ci.d[0])}–${pct(h.ci.d[1])}</span>
            <span>GA ${pct(h.ci.a[0])}–${pct(h.ci.a[1])}</span>
          </div>
          <div class="kv" style="margin-top:12px"><span>Eşleşme</span><b>${r.input.mode === 'exact' ? 'Birebir' : 'Yakın (Δ ≤ ' + h.tolUsed.toFixed(3) + ')'}</b></div>
          ${h.expanded ? '<div class="hint" style="margin-top:6px">Örnek artırmak için tolerans genişletildi.</div>' : ''}
          <div class="kv"><span>Maç başına gol</span><b>${f2(h.avgGoals)}</b></div>
          <div class="kv"><span>Üst 2.5 / Alt 2.5</span><b>${pct(h.ou25.over)} / ${pct(h.ou25.under)}</b></div>
          <div class="kv"><span>Karşılıklı gol</span><b>${pct(h.btts)}</b></div>
        ` : '<div class="hint">Bu oran için eşleşen maç bulunamadı. Toleransı artır veya tüm ligleri seç.</div>'}
      </div>
      <div class="card">
        <h3>On Yıllara Göre Dağılım</h3>
        ${h.decades && h.decades.length ? h.decades.map((b) => `
          <div style="margin-bottom:10px">
            <div class="row" style="justify-content:space-between;font-size:12px;margin-bottom:3px">
              <span style="color:var(--muted)">${b.key}–${String(b.key + 9).slice(2)} <span style="color:var(--dim)">(${b.n} maç)</span></span>
              <span class="mono">${pct0(b.ph)} / ${pct0(b.pd)} / ${pct0(b.pa)}</span>
            </div>
            <div class="cmp-bar" style="height:16px">
              <div class="h" style="width:${b.ph * 100}%"></div>
              <div class="d" style="width:${b.pd * 100}%"></div>
              <div class="a" style="width:${b.pa * 100}%"></div>
            </div>
          </div>`).join('') : '<div class="hint">Veri yok.</div>'}
        ${r.positions ? positionsBox(r.positions) : ''}
      </div>
    </div>`;
  }

  if (r.model) {
    const m = r.model;
    html += `<div class="grid g2" style="margin-top:16px">
      <div class="card">
        <h3>Gol Modeli <span class="spacer"></span><span class="pill">ρ = ${f2(m.ratings.rho)}</span></h3>
        <div class="big3" style="margin-bottom:14px">
          <div class="b"><b style="color:var(--accent)">${f2(m.lambda.home)}</b><small>Ev gol bekl.</small></div>
          <div class="b"><b style="color:var(--accent)">${f2(m.lambda.away)}</b><small>Dep gol bekl.</small></div>
          <div class="b"><b style="color:var(--draw)">${f2(m.lambda.total)}</b><small>Toplam</small></div>
        </div>
        ${triBar(m.probs)}
        <div class="lab" style="margin:16px 0 6px">En olası skorlar</div>
        <div class="score-list">
          ${m.topScores.slice(0, 8).map((s) => `<div class="s"><b>${s.s}</b><div class="bar"><i style="width:${(s.p / m.topScores[0].p) * 100}%"></i></div><span class="mono" style="text-align:right">${pct(s.p)}</span></div>`).join('')}
        </div>
        <div class="lab" style="margin:16px 0 6px">Skor matrisi (%)</div>
        ${heatMatrix(m.matrix)}
      </div>

      <div class="card">
        <h3>Marketler &amp; Adil Oran</h3>
        <div class="tbl"><table class="t">
          <thead><tr><th>Market</th><th>Model</th><th>Piyasa</th><th>Adil oran</th></tr></thead>
          <tbody>${marketRows(r)}</tbody>
        </table></div>
        ${!(r.input.ou || r.input.btts) ? '<div class="hint" style="margin-top:6px">Alt/üst ve KG oranlarını girersen piyasa karşılaştırması da dolar.</div>' : ''}

        ${r.value && r.value.length ? `
          <div class="lab" style="margin:20px 0 8px">Değer bahsi <span class="pill">EV'ye göre</span></div>
          <div class="tbl"><table class="t">
            <thead><tr><th>Tercih</th><th>Oran</th><th>Model</th><th>Piyasa</th><th>EV</th><th>Kelly</th><th>Öneri</th><th></th></tr></thead>
            <tbody>${r.value.map((v, i) => {
              const bank = bankValue();
              const stake = bank > 0 && v.kelly > 0 ? Math.round((bank * v.kelly) / 2) : 0;
              return `<tr>
              <td>${esc(v.label)}</td>
              <td class="mono">${f2(v.odds)}</td>
              <td class="mono">${pct(v.modelP)}</td>
              <td class="mono">${pct(v.marketP)}</td>
              <td class="mono ${v.ev > 0.02 ? 'pos' : v.ev < -0.05 ? 'neg' : ''}">${signed(v.ev)}</td>
              <td class="mono">${pct(v.kelly)}</td>
              <td class="mono">${stake > 0 ? stake + ' ₺' : '—'}</td>
              <td><button class="btn ghost sm" data-bet-add="${i}" title="Kupona ekle">+</button></td>
            </tr>`;
            }).join('')}</tbody>
          </table></div>
          <div class="hint" style="margin-top:8px">Kelly = bakiyenin önerilen yüzdesi. ${bankValue() > 0 ? 'Öneri sütunu yarım Kelly ile hesaplandı.' : 'Banka girersen (Hesap sekmesi) ₺ cinsinden öneri çıkar.'}</div>
        ` : '<div class="hint" style="margin-top:14px">Değer hesabı için 1-X-2 oranlarını da gir.</div>'}
      </div>
    </div>`;
  }

  /* ---- fikstur zinciri ---- */
  if (r.chain && (r.chain.home.length || r.chain.away.length)) {
    const mk = (rows) => {
      const m = new Map();
      let t = rows.findIndex((x) => x.isTarget);
      if (t < 0) t = rows.length;
      rows.forEach((x, i) => m.set(i - t, x));
      return m;
    };
    const H = mk(r.chain.home), A = mk(r.chain.away);
    const span = r.chain.span || 5;
    const keys = [];
    for (let k = -span; k <= span; k++) if (H.has(k) || A.has(k)) keys.push(k);
    const cell = (x) => {
      if (!x) return '<span style="color:var(--dim)">·</span>';
      const opp = esc(state.meta.teams[x.opp] ? state.meta.teams[x.opp].n : '?');
      const res = x.res === 'G' ? '<b class="pos">G</b>' : x.res === 'B' ? '<b style="color:var(--draw)">B</b>' : x.res === 'M' ? '<b class="neg">M</b>' : '';
      return `<span style="white-space:nowrap">${fmtDate(x.date).slice(0, 6)} ${x.home ? '🏠' : '✈️'} ${opp}</span>
        <span class="mono" style="color:var(--dim);font-size:11px">${x.ht ? x.ht + ' → ' : ''}${x.hg}-${x.ag}</span> ${res}
        ${x.comeback ? '<span class="pill r" style="font-size:9px">D</span>' : ''}`;
    };
    html += `<div class="card" style="margin-top:16px">
      <h3>Fikstür Zinciri <span class="spacer"></span><span class="pill">−${span} … +${span}</span></h3>
      <div class="hint" style="margin-bottom:8px">Ortadaki <b>*</b> bu maç. <b>D</b> = dönüş (İY önde bitiren kaybetti).
        🏠 iç saha · ✈️ deplasman.</div>
      <div class="tbl"><table class="t">
        <thead><tr><th style="width:34px">#</th><th>${esc(state.meta.teams[r.home] ? state.meta.teams[r.home].n : 'Ev')}</th><th>${esc(state.meta.teams[r.away] ? state.meta.teams[r.away].n : 'Dep')}</th></tr></thead>
        <tbody>${keys.map((k) => `<tr${k === 0 ? ' style="background:rgba(45,212,191,.07)"' : ''}>
          <td class="mono" style="color:var(--dim)">${k === 0 ? '*' : (k > 0 ? '+' + k : k)}</td>
          <td style="font-size:12px">${cell(H.get(k))}</td>
          <td style="font-size:12px">${cell(A.get(k))}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  /* ---- ilk yari cift sans ---- */
  if (r.hdc) {
    const D = r.hdc;
    html += `<div class="card" style="margin-top:16px">
      <h3>1. Yarı Çifte Şans <span class="spacer"></span><span class="pill">model</span></h3>
      <div class="grid g3">
        <div class="stat"><div class="k">1X</div><div class="v">${pct(D.p1x)}</div><div class="s">ev önde veya berabere</div></div>
        <div class="stat"><div class="k">12</div><div class="v">${pct(D.p12)}</div><div class="s">beraberlik olmaz</div></div>
        <div class="stat"><div class="k">X2</div><div class="v">${pct(D.px2)}</div><div class="s">dep önde veya berabere</div></div>
      </div>
      <div class="verdict" style="margin-top:12px">
        <div><b>1,71–1,75 kuralı:</b> net favorili maçta (MS 1,15–1,40) zayıf takımın İY çifte şansı ~1,73 ise
          piyasa zayıfa %58 veriyor demektir. Bu maçta model zayıf tarafa
          <b>${pct(Math.min(D.p1x, D.px2))}</b> veriyor.</div>
        <div class="hint" style="margin-top:6px">Arşiv zemini (176 favorili maç): zayıf İY gol attı %33,5 · İY önde %14,8 · dönüş %4,5.</div>
      </div>
    </div>`;
  }

  /* ---- canli (mac ici) model ---- */
  if (r.live) {
    const L = r.live;
    html += `<div class="card" style="margin-top:16px;border-color:rgba(255,93,115,.45)">
      <h3>Canlı Durum <span class="spacer"></span>
        <span class="pill r">${L.minute}' · ${L.score.h}-${L.score.a}</span></h3>
      <div class="big3">
        <div class="b h"><b>${pct(L.probs.h)}</b><small>EV SAHİBİ</small></div>
        <div class="b d"><b>${pct(L.probs.d)}</b><small>BERABERLİK</small></div>
        <div class="b a"><b>${pct(L.probs.a)}</b><small>DEPLASMAN</small></div>
      </div>
      <div class="verdict" style="margin-top:12px">
        <div>Maç öncesi model: <b>${pct(L.pre.h)}</b> / ${pct(L.pre.d)} / ${pct(L.pre.a)} —
        kalan ${Math.round(95 - L.minute)} dakikada beklenen gol <b>${f2(L.remainingGoals.total)}</b>.</div>
        <div class="hint" style="margin-top:6px">Hız çarpanı: ev ${f2(L.multipliers.home)}× · dep ${f2(L.multipliers.away)}×
          (skor durumuna göre; Maçkolik devre arası modelinden kalibre).</div>
      </div>
    </div>`;
  }

  /* ---- donus (1/2 - 2/1) ---- */
  if (r.comeback && r.comeback.total) {
    const C = r.comeback;
    const hist = r.history && r.history.htft && r.history.htft.n ? r.history.htft.probs : null;
    const m12 = r.model && r.model.halves ? r.model.halves.combos['1/2'] : null;
    const m21 = r.model && r.model.halves ? r.model.halves.combos['2/1'] : null;
    html += `<div class="card" style="margin-top:16px">
      <h3>Dönüş (1/2 – 2/1) <span class="spacer"></span>
        <span class="pill">arsiv ${C.total.n.toLocaleString('tr-TR')} maç</span></h3>
      <div class="grid g3">
        <div class="stat"><div class="k">Dönüş oranı</div><div class="v">${pct(C.total.donus)}</div>
          <div class="s">ilk yarıyı önde bitiren kaybetti</div></div>
        <div class="stat"><div class="k">1/2</div><div class="v">${pct(C.total.d12)}</div>
          <div class="s">ev önde → dep kazandı${hist ? ` · benzer maçlarda ${pct(hist['1/2'])}` : ''}</div></div>
        <div class="stat"><div class="k">2/1</div><div class="v">${pct(C.total.d21)}</div>
          <div class="s">dep önde → ev kazandı${hist ? ` · benzer maçlarda ${pct(hist['2/1'])}` : ''}</div></div>
      </div>
      <div class="verdict" style="margin-top:12px">
        <div><b>Favori öne geçip kaybetme:</b> ${pct(C.total.favLostRate)}
          <span class="hint">(${C.total.favLedN.toLocaleString('tr-TR')} maçta favori ilk yarıyı önde bitirdi)</span></div>
        ${C.band ? `<div style="margin-top:6px">Senin oran bandın <b>${C.band.label}</b> (favori ${f2(C.favOdds)}):
          dönüş <b>${pct(C.band.donus)}</b> · favori yatması <b>${pct(C.band.favLostRate)}</b>
          <span class="hint">(${C.band.n.toLocaleString('tr-TR')} maç)</span></div>` : ''}
        ${m12 != null ? `<div class="hint" style="margin-top:8px">Model bu maç için 1/2 = ${pct(m12)}, 2/1 = ${pct(m21)} veriyor.</div>` : ''}
      </div>
    </div>`;
  }

  /* ---- İY / MS ve gol bantları ---- */
  if (r.model && r.model.halves) {
    const hv = r.model.halves;
    const hist = (r.history && r.history.htft && r.history.htft.n) ? r.history.htft : null;
    const bandsM = r.model.bands ? r.model.bands.p : null;
    const bandsH = (r.history && r.history.bands) ? r.history.bands.p : null;
    const H3 = ['1', 'X', '2'];
    const cell = (k) => {
      const mp = hv.combos[k] || 0;
      const hp = hist ? (hist.probs[k] || 0) : null;
      const hot = mp >= 0.12;
      return `<td class="mono" style="text-align:center;${hot ? 'color:var(--accent);font-weight:700' : ''}">${pct0(mp)}${hp != null ? `<span style="color:var(--dim);font-weight:400"> / ${pct0(hp)}</span>` : ''}</td>`;
    };
    const bandNames = ['0–1 gol', '2–3 gol', '4–5 gol', '6+ gol'];
    html += `<div class="card" style="margin-top:16px">
      <h3>İY / MS ve Gol Bantları <span class="spacer"></span>
        <span class="pill">model / tarihsel</span></h3>
      <div class="grid g2">
        <div>
          <div class="lab">İlk yarı / maç sonu</div>
          <div class="tbl"><table class="t">
            <thead><tr><th>İY \\ MS</th><th>1</th><th>X</th><th>2</th></tr></thead>
            <tbody>${H3.map((h) => `<tr>
              <td><b>${h}</b></td>
              ${cell(h + '/1')}${cell(h + '/X')}${cell(h + '/2')}
            </tr>`).join('')}</tbody>
          </table></div>
          <div class="hint" style="margin-top:8px">Örnek: <b>1/2</b> = ilk yarıyı ev sahibi önde bitirir, maçı deplasman kazanır.</div>
        </div>
        <div>
          <div class="lab">Gol bantları</div>
          <div class="tbl"><table class="t">
            <thead><tr><th>Bant</th><th>Model</th><th>Tarihsel</th></tr></thead>
            <tbody>${bandNames.map((n, i) => `<tr>
              <td>${n}</td>
              <td class="mono ${i === 3 ? 'pos' : ''}">${bandsM ? pct0(bandsM[i]) : '—'}</td>
              <td class="mono">${bandsH ? pct0(bandsH[i]) : '—'}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          <div class="verdict" style="margin-top:12px">
            <div><b>6+ gol:</b> model ${pct(r.model.ou.over5_5)}${r.history ? ` · tarihsel ${pct(r.history.over55)}` : ''}.
            ${bandsM && bandsH && Math.abs(bandsM[3] - bandsH[3]) > 0.05 ? 'İki kaynak ayrışıyor — piyasa ve tarihsel dağılım daha güvenilir olabilir.' : ''}</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  if (r.h2h && r.h2h.total) {
    const h = r.h2h;
    html += `<div class="card" style="margin-top:16px">
      <h3>Karşılıklı Maçlar (H2H) <span class="spacer"></span><span class="hint">${h.total} maç</span></h3>
      <div class="row wrap" style="gap:8px;margin-bottom:12px">
        <span class="chip">${teamName(inp.home.id)} <b>${h.aWins}</b></span>
        <span class="chip">Beraberlik <b>${h.draws}</b></span>
        <span class="chip">${teamName(inp.away.id)} <b>${h.bWins}</b></span>
        <span class="chip">Gol ort. <b>${f2(h.avgGoals)}</b></span>
        <span class="chip">KG <b>${pct0(h.btts)}</b></span>
        <span class="chip">Üst 2.5 <b>${pct0(h.over25)}</b></span>
      </div>
      <div class="list">
        ${h.matches.map((x) => {
          const gs = x.home === inp.home.id ? (x.hg > x.ag) : (x.ag > x.hg);
          const cls = x.draw ? '' : (gs ? 'w' : 'l');
          return `<div class="it">
            <div class="d">${fmtDate(x.date)}</div>
            <div>${teamName(x.home)} <b>${x.hg}-${x.ag}</b> ${teamName(x.away)}${x.htg >= 0 ? ` <span class="tag-league">(İY ${x.htg}-${x.atg})</span>` : ''}</div>
            <div class="sc ${cls}">${x.draw ? 'B' : (gs ? 'G' : 'M')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  if (r.form) {
    const card = (f, last) => {
      const s = f.stats;
      return `<div class="formcol"${last ? ' style="border-left:1px solid var(--line);padding-left:16px"' : ''}>
        <div class="row" style="margin-bottom:8px">
          <b style="font-size:14.5px">${esc(f.team.n)}</b><span style="flex:1"></span>
          <span class="pill">${s.w}G ${s.d}B ${s.l}M</span>
        </div>
        <div class="row" style="gap:4px;margin-bottom:10px">
          ${f.matches.slice(0, 8).map((x) => `<span class="pill ${x.res === 'G' ? 'g' : x.res === 'B' ? 'y' : 'r'}" style="padding:2px 8px">${x.res}</span>`).join('')}
        </div>
        <div class="list">
          ${f.matches.slice(0, 8).map((x) => `<div class="it" style="grid-template-columns:64px 1fr auto">
            <div class="d">${fmtDate(x.date)}</div>
            <div><span style="color:var(--dim)">${x.home ? 'vs' : '@'}</span> ${teamName(x.opponent)}</div>
            <div class="sc ${x.res === 'G' ? 'w' : x.res === 'M' ? 'l' : ''}">${x.gf}-${x.ga}</div>
          </div>`).join('')}
        </div>
      </div>`;
    };
    html += `<div class="card" style="margin-top:16px">
      <h3>Form <span class="spacer"></span><span class="hint">son 8 maç</span></h3>
      <div class="grid g2">${card(r.form.home)}${card(r.form.away, true)}</div>
    </div>`;
  }

  if (r.history && r.history.rows && r.history.rows.length) {
    html += `<div class="card" style="margin-top:16px">
      <h3>Eşleşen Son Maçlar <span class="spacer"></span><span class="hint">${r.history.rows.length} / ${r.history.totalRows}</span></h3>
      <div class="list">
        ${r.history.rows.map((x) => `<div class="it">
          <div class="d">${fmtDate(x.date)}<br>${seasonLabel(x.season)}</div>
          <div>${teamName(x.home)} <b>${x.hg}-${x.ag}</b> ${teamName(x.away)}${x.htg >= 0 ? ` <span class="tag-league">(İY ${x.htg}-${x.atg})</span>` : ''}
            <span class="tag-league">· ${esc(state.meta.leagues[x.league].name)}</span></div>
          <div class="sc">${f2(x.odds[0])} / ${f2(x.odds[1])} / ${f2(x.odds[2])}</div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  $('#results').innerHTML = html;
  $$('#results [data-bet-add]').forEach((b) => b.addEventListener('click', () => addBetFromValue(+b.dataset.betAdd)));
}

function positionsBox(pos) {
  const row = (lbl, p) => p
    ? `<div class="kv"><span>${lbl}</span><b>${p.pos}. sıra · ${p.pts} puan <span style="color:var(--dim);font-weight:400">(${p.p} maç)</span></b></div>`
    : `<div class="kv"><span>${lbl}</span><b>—</b></div>`;
  return `<div style="margin-top:14px"><div class="lab" style="margin-bottom:6px">Güncel sezon (${seasonLabel(pos.season)})</div>${row('Ev sahibi', pos.home)}${row('Deplasman', pos.away)}</div>`;
}

function marketRows(r) {
  const m = r.model;
  const rows = [];
  const add = (label, mp, pp) => {
    rows.push(`<tr><td>${label}</td><td class="mono">${pct(mp)}</td><td class="mono">${pp == null ? '—' : pct(pp)}</td><td class="mono">${mp > 0 ? (1 / mp).toFixed(2) : '—'}</td></tr>`);
  };
  const ou = r.input.ou, bt = r.input.btts;
  const ouMarket = (o) => (o && o > 1 && ou ? (1 / o) / (1 / ou.over + 1 / ou.under) : null);
  const btMarket = (o) => (o && o > 1 && bt ? (1 / o) / (1 / bt.yes + 1 / bt.no) : null);
  add('Üst 1.5', m.ou.over1_5, null);
  add('Alt 1.5', m.ou.under1_5, null);
  add('Üst 2.5', m.ou.over2_5, ouMarket(ou && ou.over));
  add('Alt 2.5', m.ou.under2_5, ouMarket(ou && ou.under));
  add('Üst 3.5', m.ou.over3_5, null);
  add('Alt 3.5', m.ou.under3_5, null);
  add('Üst 5.5 (6+ gol)', m.ou.over5_5, null);
  add('KG Var', m.btts, btMarket(bt && bt.yes));
  add('KG Yok', 1 - m.btts, btMarket(bt && bt.no));
  return rows.join('');
}

function heatMatrix(mat) {
  const n = 6;
  let max = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) max = Math.max(max, mat[i][j]);
  let cells = '<div class="c lbl"></div>';
  for (let j = 0; j < n; j++) cells += `<div class="c lbl">${j}</div>`;
  for (let i = 0; i < n; i++) {
    cells += `<div class="c lbl">${i}</div>`;
    for (let j = 0; j < n; j++) {
      const v = mat[i][j];
      const t = Math.sqrt(v / (max || 1));
      const bg = `rgba(${Math.round(26 + 50 * t)},${Math.round(60 + 120 * t)},${Math.round(90 + 165 * t)},${0.12 + 0.88 * t})`;
      cells += `<div class="c" style="background:${bg}" title="${i}-${j}: ${pct(v)}">${v >= 0.03 ? Math.round(v * 100) : ''}</div>`;
    }
  }
  return `<div class="heat" style="grid-template-columns:repeat(${n + 1},1fr)">${cells}</div>
    <div class="hint" style="margin-top:6px">Satır = ev sahibi gol, sütun = deplasman gol.</div>`;
}

/* ---------------------------- kayıtlı analizler ---------------------------- */

function getSaved() {
  try { return JSON.parse(Store.get('om_saved') || '[]'); } catch (_) { return []; }
}

function saveCurrentAnalysis() {
  if (!state.lastBody) { toast('Önce bir analiz yap.'); return; }
  const b = state.lastBody;
  const label = [
    b.homeId != null ? state.meta.teams[b.homeId].n : '',
    b.awayId != null ? state.meta.teams[b.awayId].n : '',
  ].filter(Boolean).join(' - ') || (b.odds ? `${b.odds.h}/${b.odds.d}/${b.odds.a}` : 'Analiz');
  const arr = getSaved();
  arr.unshift({ id: Date.now(), label, body: b });
  Store.set('om_saved', JSON.stringify(arr.slice(0, 20)));
  renderSaved();
  toast('Analiz kaydedildi');
}

function renderSaved() {
  const arr = getSaved();
  const box = $('#savedList');
  if (!box) return;
  if (!arr.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<span class="hint">Kayıtlı:</span>` + arr.map((s) =>
    `<span class="chip" data-saved="${s.id}" style="cursor:pointer">${esc(s.label)} ▸</span>`).join('');
  box.querySelectorAll('[data-saved]').forEach((c) => c.addEventListener('click', () => {
    const s = arr.find((x) => x.id === +c.dataset.saved);
    if (!s) return;
    state.home = s.body.homeId; state.away = s.body.awayId;
    $('#homeInput').value = s.body.homeId != null ? state.meta.teams[s.body.homeId].n : '';
    $('#awayInput').value = s.body.awayId != null ? state.meta.teams[s.body.awayId].n : '';
    if (s.body.odds) { $('#oH').value = s.body.odds.h; $('#oD').value = s.body.odds.d; $('#oA').value = s.body.odds.a; }
    showTab('analiz');
    runAnalysis(s.body);
  }));
}

/* ---------------------------- maçlar ---------------------------- */

async function loadMatches(refresh) {
  const out = $('#matchOut');
  out.innerHTML = '<div class="hint">yükleniyor…</div>';
  const mode = $('#mMode').value;
  let liveMeta = null;
  try {
    let items;
    if (mode === 'bulletin') {
      const b = await api('/api/bulletin' + (refresh ? '?refresh=1' : ''));
      const byCode = {};
      state.meta.leagues.forEach((l, i) => { byCode[l.code] = i; });
      items = (b.matches || []).map((m) => ({
        ...m,
        league: byCode[m.league] != null ? byCode[m.league] : -1,
        played: m.status === 'ft',
        odds: [0, 0, 0],
      }));
      liveMeta = { via: 'bulten', dateText: b.dateText };
    } else if (mode === 'live') {
      const res = await api('/api/live?league=' + encodeURIComponent($('#mLeague').value) + (refresh ? '&refresh=1' : ''));
      liveMeta = res;
      if (!res.supported) {
        out.innerHTML = '<div class="empty"><div class="big">📡</div><div style="font-size:15px;color:var(--muted)">Bu lig için canlı veri yok</div>'
          + '<div class="hint" style="margin-top:8px">Canlı veri şu liglerde destekli: Türkiye, İngiltere (PL/Championship), Almanya (1/2), İspanya La Liga, Fransa (1/2), Hollanda, Belçika, İskoçya Premiership.</div></div>';
        return;
      }
      if (!res.events || !res.events.length) {
        const why = res.error === 'rate_limited'
          ? 'Canlı veri sınırı — birkaç dakika sonra tekrar dene'
          : (window.LocalAPI
            ? 'Telefon ESPN\'e ulaşamadı. Bilgisayar adresini bir kez gir; canlı veriyi oradan alır.'
            : 'Canlı veri alınamadı (ağ/API).');
        out.innerHTML = '<div class="empty"><div class="big">📡</div><div style="font-size:15px;color:var(--muted)">' + esc(why) + '</div>'
          + (window.LocalAPI
            ? '<div class="row" style="justify-content:center;margin-top:14px;gap:8px;flex-wrap:wrap">'
              + '<input id="quickSrv" placeholder="http://192.168.1.20:5178" style="max-width:230px" value="' + esc(Store.get('om_server') || (document.querySelector('meta[name="default-server"]') || {}).content || '') + '">'
              + '<button class="btn sm" id="quickSrvSave">Kaydet ve dene</button></div>'
              + '<div class="hint" style="margin-top:8px">Adres, masaüstü uygulamasının Veri sekmesinde yazar.</div>'
            : '')
          + '</div>';
        const qs2 = $('#quickSrvSave');
        if (qs2) qs2.addEventListener('click', () => {
          const v = ($('#quickSrv').value || '').trim();
          if (!/^https?:\/\//i.test(v)) { toast('http://… biçiminde gir'); return; }
          Store.set('om_server', v.replace(/\/+$/, ''));
          loadMatches(true);
        });
        return;
      }
      items = res.events.map((e) => ({
        date: e.date, league: e.home != null ? (state.meta.teams[e.home].l) : -1,
        home: e.home, away: e.away, hg: e.hg, ag: e.ag,
        played: e.status === 'ft', odds: [0, 0, 0],
        status: e.status, time: e.time, clock: e.clock,
        homeName: e.homeName, awayName: e.awayName,
      }));
    } else {
      const qs = new URLSearchParams({ league: $('#mLeague').value, mode, limit: $('#mLimit').value });
      items = (await api('/api/matches?' + qs)).items;
    }
    out.dataset.loaded = '1';
    $('#matchCount').textContent = `${items.length} maç` + (mode === 'live' ? ` · canlı veri${liveMeta && liveMeta.via ? ' (' + liveMeta.via.toUpperCase() + ')' : ''}` : mode === 'bulletin' ? ` · bülten ${liveMeta && liveMeta.dateText ? liveMeta.dateText : ''}` : '');
    if (!items.length) {
      out.innerHTML = mode === 'fixtures'
        ? '<div class="empty"><div class="big">🗓️</div><div style="font-size:15px;color:var(--muted)">Arşivde oynanacak maç kaydı yok</div>'
          + '<div class="hint" style="margin-top:8px">Canlı maçlar için <b>Liste → Canlı / yaklaşan</b> seç.</div></div>'
        : '<div class="hint">Kayıt yok. "Veriyi Güncelle" ile arşivi yenileyebilirsin.</div>';
      return;
    }
    const badge = (m) => {
      if (m.status === 'live') return `<span class="pill r">CANLI${m.clock ? ' ' + esc(m.clock) : ''}</span>`;
      if (m.status === 'ft') return `<span class="pill">BİTTİ</span>`;
      if (m.status === 'ns') return `<span class="pill y">${m.time || 'BAŞLAMADI'}</span>`;
      return '';
    };
    const nm = (id, fallback) => (id != null && state.meta.teams[id] ? esc(state.meta.teams[id].n) : esc(fallback || '?'));
    const canAnalyze = (m) => m.home != null && m.away != null;

    out.innerHTML = `<div class="tbl"><table class="t">
      <thead><tr><th>Tarih</th><th>Durum</th><th>Ev</th><th>Skor</th><th>Deplasman</th><th>1</th><th>X</th><th>2</th><th></th></tr></thead>
      <tbody>${items.map((m, i) => `<tr>
        <td class="mono" style="font-size:11.5px;color:var(--dim)">${fmtDate(m.date)}</td>
        <td>${badge(m)}</td>
        <td>${nm(m.home, m.homeName)}</td>
        <td class="mono" style="font-weight:800">${m.hg != null && m.hg >= 0 ? m.hg + '-' + m.ag : '—'}</td>
        <td>${nm(m.away, m.awayName)}</td>
        <td class="mono">${m.odds && m.odds[0] ? f2(m.odds[0]) : '—'}</td>
        <td class="mono">${m.odds && m.odds[1] ? f2(m.odds[1]) : '—'}</td>
        <td class="mono">${m.odds && m.odds[2] ? f2(m.odds[2]) : '—'}</td>
        <td>${canAnalyze(m) ? `<button class="btn ghost sm" data-analyze="${i}">Analiz</button>` : '<span class="hint">eşleşmedi</span>'}</td>
      </tr>`).join('')}</tbody></table></div>`;

    out.querySelectorAll('[data-analyze]').forEach((b) => b.addEventListener('click', () => {
      const m = items[+b.dataset.analyze];
      state.home = m.home; state.away = m.away;
      $('#homeInput').value = state.meta.teams[m.home].n;
      $('#awayInput').value = state.meta.teams[m.away].n;
      if (m.status === 'live' && m.hg != null) {
        const mm = String(m.clock || '').match(/(\d+)/);
        state.liveMinute = mm ? Number(mm[1]) : 0;
        state.liveScore = { h: m.hg, a: m.ag };
      } else {
        state.liveMinute = null;
        state.liveScore = null;
      }
      if (m.odds && m.odds[0] > 1) {
        $('#oH').value = m.odds[0]; $('#oD').value = m.odds[1]; $('#oA').value = m.odds[2];
      } else {
        ['#oH', '#oD', '#oA'].forEach((s) => ($(s).value = ''));
      }
      showTab('analiz');
      runAnalysis();
    }));
  } catch (e) {
    out.innerHTML = `<div class="hint">Hata: ${esc(e.message)}</div>`;
  }
}

/* ---------------------------- maç seçici ---------------------------- */

async function loadPicker(refresh) {
  const sel = $('#pickMatch');
  if (!sel) return;
  const mode = $('#pickMode').value;
  sel.innerHTML = '<option value="">yükleniyor…</option>';
  try {
    let items = [];
    if (mode === 'bulletin') {
      const b = await api('/api/bulletin');
      const byCode = {};
      state.meta.leagues.forEach((l, i) => { byCode[l.code] = i; });
      items = (b.matches || [])
        .filter((m) => m.home != null && m.away != null)
        .map((m) => ({ ...m, league: byCode[m.league] != null ? byCode[m.league] : -1, played: m.status === 'ft', odds: [0, 0, 0] }));
    } else if (mode === 'live') {
      const lgId = $('#pickLeague').value;
      const res = await api('/api/live?league=' + encodeURIComponent(lgId) + (refresh ? '&refresh=1' : ''));
      if (!res.supported) {
        sel.innerHTML = '<option value="">Bu lig için canlı veri yok</option>';
        return;
      }
      if (!res.events || !res.events.length) {
        sel.innerHTML = '<option value="">' + (res.error === 'rate_limited'
          ? 'Canlı veri sınırı — birkaç dakika sonra tekrar dene'
          : 'Canlı/yaklaşan maç bulunamadı') + '</option>';
        return;
      }
      items = res.events.filter((e) => e.home != null && e.away != null).map((e) => ({
        date: e.date, league: Number(lgId) >= 0 ? Number(lgId) : -1,
        home: e.home, away: e.away, hg: e.hg, ag: e.ag,
        played: e.status === 'ft', odds: [0, 0, 0],
        status: e.status, time: e.time,
      }));
      if (!items.length) {
        sel.innerHTML = '<option value="">Maçlar veritabanındaki takımlarla eşleşmedi</option>';
        return;
      }
    } else {
      const qs = new URLSearchParams({ league: $('#pickLeague').value, mode, limit: '150' });
      items = (await api('/api/matches?' + qs)).items;
    }
    state.pickerItems = items;

    const label = (m) => {
      const h = esc(state.meta.teams[m.home].n);
      const a = esc(state.meta.teams[m.away].n);
      let tail = '';
      if (m.status === 'live') tail = ` · ${m.hg}-${m.ag} CANLI${m.clock ? ' ' + m.clock : ''}`;
      else if (m.status === 'ft') tail = ` · ${m.hg}-${m.ag}`;
      else if (m.status === 'ns') tail = ` · ${m.time || ''} başlamadı`;
      else if (m.played) tail = ` · ${m.hg}-${m.ag}`;
      return `${fmtDate(m.date)} · ${h} – ${a}${tail}`;
    };
    sel.innerHTML = '<option value="">— maç seç —</option>' + items.map((m, i) => `<option value="${i}">${label(m)}</option>`).join('');
  } catch (e) {
    sel.innerHTML = '<option value="">Liste yüklenemedi</option>';
  }
}

function pickMatchChanged() {
  const i = Number($('#pickMatch').value);
  const m = state.pickerItems && state.pickerItems[i];
  if (!m) return;
  state.home = m.home;
  state.away = m.away;
  $('#homeInput').value = state.meta.teams[m.home].n;
  $('#awayInput').value = state.meta.teams[m.away].n;
  if (m.odds && m.odds[0] > 1 && m.odds[1] > 1 && m.odds[2] > 1) {
    $('#oH').value = m.odds[0];
    $('#oD').value = m.odds[1];
    $('#oA').value = m.odds[2];
  } else {
    ['#oH', '#oD', '#oA'].forEach((s) => ($(s).value = ''));
  }
  if (m.league >= 0 && state.meta.leagues[m.league]) $('#leagueHint').textContent = state.meta.leagues[m.league].name;

  // canli mac secildiyse dakika + skor tasi
  if (m.status === 'live' && m.hg != null) {
    const mm = String(m.clock || '').match(/(\d+)/);
    state.liveMinute = mm ? Number(mm[1]) : 0;
    state.liveScore = { h: m.hg, a: m.ag };
  } else {
    state.liveMinute = null;
    state.liveScore = null;
  }
  runAnalysis();
}

/* ---------------------------- tablolar ---------------------------- */

async function loadTable() {
  const out = $('#tableOut');
  if (!out) return;
  out.innerHTML = '<div class="hint">yükleniyor…</div>';
  try {
    const qs = new URLSearchParams({ league: $('#tLeague').value, season: $('#tSeason').value });
    const { rows } = await api('/api/table?' + qs);
    out.dataset.loaded = '1';
    if (!rows.length) { out.innerHTML = '<div class="hint">Bu sezon için veri yok.</div>'; return; }
    out.innerHTML = `<div class="tbl"><table class="t">
      <thead><tr><th>#</th><th>Takım</th><th>O</th><th>G</th><th>B</th><th>M</th><th>A</th><th>Y</th><th>AV</th><th>P</th><th>Form</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="mono" style="color:var(--dim)">${r.pos}</td>
        <td>${esc(state.meta.teams[r.team].n)}</td>
        <td class="mono">${r.p}</td><td class="mono">${r.w}</td><td class="mono">${r.d}</td><td class="mono">${r.l}</td>
        <td class="mono">${r.gf}</td><td class="mono">${r.ga}</td>
        <td class="mono ${r.gd > 0 ? 'pos' : r.gd < 0 ? 'neg' : ''}">${r.gd > 0 ? '+' : ''}${r.gd}</td>
        <td class="mono" style="font-weight:800">${r.pts}</td>
        <td>${[...r.form].map((c) => `<span class="pill ${c === 'G' ? 'g' : c === 'B' ? 'y' : 'r'}" style="padding:1px 6px;font-size:10px">${c}</span>`).join('')}</td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) {
    out.innerHTML = `<div class="hint">Hata: ${esc(e.message)}</div>`;
  }
}

/* ---------------------------- başarım ---------------------------- */

async function runBacktest() {
  const out = $('#btOut');
  const btn = $('#btnBacktest');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> test ediliyor…';
  out.innerHTML = '';
  try {
    const qs = new URLSearchParams({ league: $('#btLeague').value, from: $('#btFrom').value, to: $('#btTo').value });
    const bt = await api('/api/backtest?' + qs);
    out.innerHTML = renderBacktest(bt);
  } catch (e) {
    out.innerHTML = `<div class="hint">Hata: ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Testi Çalıştır';
  }
}

function renderBacktest(bt) {
  if (!bt.n) return `<div class="hint">${esc(bt.message || 'Veri yok.')}</div>`;
  const lg = state.meta.leagues[bt.league];
  const better = (a, b) => (a < b ? 'pos' : a > b ? 'neg' : '');
  const card = (label, v, sub) =>
    `<div class="b"><b>${v}</b><small>${label}</small>${sub ? `<div class="hint" style="margin-top:2px">${sub}</div>` : ''}</div>`;

  const calib = bt.calibration.map((c) => ({ x: c.predicted, y: c.actual }));
  const calibM = bt.calibrationMarket.map((c) => ({ x: c.predicted, y: c.actual }));
  const curve = (bt.valueModel.curve || []).map((p) => ({ x: p.n, y: p.equity }));
  const curve2 = (bt.valueCons.curve || []).map((p) => ({ x: p.n, y: p.equity }));

  return `
    <div class="row wrap" style="gap:8px;margin-bottom:14px">
      <span class="chip">${esc(lg.name)}</span>
      <span class="chip">${seasonLabel(bt.seasonFrom)} – ${seasonLabel(bt.seasonTo)}</span>
      <span class="chip">Test edilen maç <b>${bt.n}</b></span>
      ${bt.skipped ? `<span class="chip">Atlanan <b>${bt.skipped}</b></span>` : ''}
    </div>

    <div class="lab">1-X-2 tahmin kalitesi (düşük daha iyi)</div>
    <div class="big3" style="margin-bottom:14px">
      ${card('Model log-loss', bt.model.logLoss.toFixed(4), 'isabet ' + pct(bt.model.hit))}
      ${card('Piyasa log-loss', bt.market.logLoss.toFixed(4), 'isabet ' + pct(bt.market.hit))}
      ${card('Konsensüs log-loss', bt.consensus.logLoss.toFixed(4), 'isabet ' + pct(bt.consensus.hit))}
    </div>

    <div class="grid g2" style="margin-top:6px">
      <div>
        <div class="lab">Kalibrasyon — tahmin vs gerçekleşme</div>
        ${lineChart([
          { name: 'Model', color: '#4cc9ff', points: calib, dots: true },
          { name: 'Piyasa', color: '#ffc857', points: calibM, dots: true },
        ], { h: 230, xMin: 0, xMax: 1, yMin: 0, yMax: 1, diagonal: true, fmtY: (v) => (v * 100).toFixed(0) + '%', fmtX: (v) => (v * 100).toFixed(0) + '%' })}
        <div class="hint">Nokta köşegene yakınsa kalibrasyon iyi.</div>
      </div>
      <div>
        <div class="lab">Değer stratejisi — kasa eğrisi (1 birim sabit bahis)</div>
        ${lineChart([
          { name: 'Model', color: '#2ee6a8', points: curve, area: true },
          { name: 'Konsensüs', color: '#8b7cff', points: curve2 },
        ], { h: 230, zeroLine: true, fmtY: (v) => v.toFixed(0) })}
        <div class="hint">${bt.valueModel.bets} bahis · ROI ${signed(bt.valueModel.roi)} · maks. düşüş ${bt.valueModel.maxDrawdown.toFixed(1)} birim</div>
      </div>
    </div>

    ${bt.ou25 ? `
      <div class="lab" style="margin-top:20px">Üst/Alt 2.5</div>
      <div class="tbl"><table class="t">
        <thead><tr><th>Kaynak</th><th>Log-loss</th><th>İsabet</th></tr></thead>
        <tbody>
          <tr><td>Model</td><td class="mono ${better(bt.ou25.logLossModel, bt.ou25.logLossMarket)}">${bt.ou25.logLossModel.toFixed(4)}</td><td class="mono">${pct(bt.ou25.hitModel)}</td></tr>
          <tr><td>Piyasa</td><td class="mono">${bt.ou25.logLossMarket.toFixed(4)}</td><td class="mono">${pct(bt.ou25.hitMarket)}</td></tr>
        </tbody>
      </table></div>
      <div class="hint" style="margin-top:6px">${bt.ou25.bets} değer bahsi, kâr ${bt.ou25.profit.toFixed(1)} birim (ROI ${signed(bt.ou25.roi)}).</div>
    ` : ''}

    <div class="verdict" style="margin-top:18px">
      <div>${bt.consensus.logLoss < bt.market.logLoss
        ? 'Konsensüs tek başına piyasadan daha iyi kalibre: model piyasaya bilgi katıyor.'
        : 'Piyasa tek başına modelden daha iyi. Bu normaldir — kapanış oranları en güçlü tek tahmincidir. Sistemi "piyasanın neyi yanlış fiyatladığını" aramak için kullan.'}</div>
      <div>Model log-loss ${bt.model.logLoss.toFixed(4)} · Brier ${bt.model.brier.toFixed(4)} · ${bt.n} maç. Rastgele tahmin ≈ 1.0986.</div>
    </div>`;
}

/* ---------------------------- hesap ---------------------------- */

function calcMarket() {
  const oh = +$('#cH').value, od = +$('#cD').value, oa = +$('#cA').value;
  const out = $('#calcOut');
  if (!(oh > 1 && od > 1 && oa > 1)) { out.innerHTML = '<div class="hint">Geçerli oran gir.</div>'; return; }
  const raw = [1 / oh, 1 / od, 1 / oa];
  const s = raw[0] + raw[1] + raw[2];
  const p = raw.map((r) => r / s);
  let lo = 0.4, hi = 3;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const t = Math.pow(raw[0], k) + Math.pow(raw[1], k) + Math.pow(raw[2], k);
    if (t > 1) lo = k; else hi = k;
  }
  const k = (lo + hi) / 2;
  const pp = raw.map((r) => Math.pow(r, k));
  const ps = pp[0] + pp[1] + pp[2];
  const pw = pp.map((x) => x / ps);

  out.innerHTML = `
    <div class="kv"><span>Marj (overround)</span><b style="color:${s - 1 > 0.08 ? 'var(--bad)' : s - 1 > 0.05 ? 'var(--draw)' : 'var(--good)'}">${pct(s - 1, 2)}</b></div>
    <div class="tbl"><table class="t" style="margin-top:10px">
      <thead><tr><th></th><th>Ham</th><th>Oransal</th><th>Log</th><th>Adil oran</th></tr></thead>
      <tbody>${['1', 'X', '2'].map((l, i) => `<tr><td>${l}</td>
        <td class="mono">${pct(raw[i], 2)}</td><td class="mono">${pct(p[i], 2)}</td>
        <td class="mono">${pct(pw[i], 2)}</td><td class="mono">${(1 / pw[i]).toFixed(2)}</td></tr>`).join('')}
      </tbody>
    </table></div>
    <div class="hint" style="margin-top:8px">Log yöntemi favori tarafı daha isabetli temizler. Adil orandan yüksek oran bulursan aynı bahis için daha iyi fiyat almış olursun.</div>`;
}

function calcKelly() {
  const o = +$('#kOdds').value, p = Math.min(100, Math.max(0, +$('#kProb').value)) / 100, bank = +$('#kBank').value;
  const out = $('#kellyOut');
  if (!(o > 1)) { out.innerHTML = '<div class="hint">Geçerli oran gir.</div>'; return; }
  const ev = p * o - 1;
  const kelly = (p * (o - 1) - (1 - p)) / (o - 1);
  out.innerHTML = `
    <div class="kv"><span>EV</span><b style="color:${ev > 0 ? 'var(--good)' : 'var(--bad)'}">${signed(ev)}</b></div>
    <div class="kv"><span>Tam Kelly</span><b>${kelly > 0 ? pct(kelly) : '0%'}</b></div>
    <div class="kv"><span>Yarım Kelly</span><b>${kelly > 0 ? pct(kelly / 2) : '0%'}</b></div>
    <div class="kv"><span>Önerilen miktar (yarım)</span><b>${kelly > 0 ? (bank * kelly / 2).toFixed(2) + ' ₺' : '—'}</b></div>
    <div class="kv"><span>Kazanırsa net</span><b>${kelly > 0 ? (bank * kelly / 2 * (o - 1)).toFixed(2) + ' ₺' : '—'}</b></div>
    ${ev <= 0 ? '<div class="hint" style="margin-top:8px;color:var(--bad)">Negatif EV: uzun vadede kaybettirir.</div>' : ''}`;
}

function calcBankroll() {
  const bank = +$('#brBank').value, unit = +$('#brUnit').value / 100, odds = +$('#brOdds').value;
  const out = $('#brOut');
  if (!(bank > 0) || !(unit > 0) || !(odds > 1)) { out.innerHTML = '<div class="hint">Değerleri kontrol et.</div>'; return; }
  const rows = [];
  let b = bank;
  for (let i = 1; i <= 10; i++) {
    rows.push(`<tr><td class="mono">${i}</td><td class="mono">${b.toFixed(0)} ₺</td><td class="mono">${(b * unit).toFixed(2)} ₺</td><td class="mono">${(b * unit * (odds - 1)).toFixed(2)} ₺</td></tr>`);
    b = b * (1 - unit) + b * unit * odds;
  }
  out.innerHTML = `
    <div class="kv"><span>Birim bahis</span><b>${(bank * unit).toFixed(2)} ₺ (%${(unit * 100).toFixed(1)})</b></div>
    <div class="kv"><span>10 kayıp üst üste</span><b>${(bank * Math.pow(1 - unit, 10)).toFixed(2)} ₺ kalır</b></div>
    <div class="kv"><span>10 kazanç üst üste</span><b>${(bank * Math.pow(1 + unit * (odds - 1), 10)).toFixed(0)} ₺</b></div>
    <div class="tbl" style="margin-top:10px"><table class="t">
      <thead><tr><th>#</th><th>Banka</th><th>Bahis</th><th>Net kazanç</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>
    <div class="hint" style="margin-top:8px">Tablo, her bahsi kazanma varsayımıyla bileşik büyümeyi gösterir. Gerçekte kayıplar da olur; %1–2 birim en güvenli aralıktır.</div>`;
}

/* ---------------------------- banka & kupon otomasyonu ---------------------------- */

function bankValue() {
  const n = Number(Store.get('om_bank') || 0);
  return n > 0 ? n : 0;
}

function updateBankHint() {
  const el2 = $('#bankHint');
  if (!el2) return;
  const v = bankValue();
  el2.textContent = v > 0
    ? `Analizlerde ${v.toLocaleString('tr-TR')} ₺ banka kullanılıyor (yarım Kelly).`
    : 'Banka girersen değer tablosunda ₺ cinsinden öneri çıkar.';
  const inp = $('#bankMain');
  if (inp && !inp.value && v > 0) inp.value = String(v);
}

/** "1 (Ev Sahibi)", "Üst 2.5", "kg var" gibi serbest metni normalize eder */
function normPick(s) {
  const t = String(s || '').toLocaleLowerCase('tr').trim();
  if (/^1\b|ev sahibi/.test(t)) return '1';
  if (/^x\b|beraber/.test(t)) return 'X';
  if (/^2\b|deplasman/.test(t)) return '2';
  if (/üst\s*2[.,]?5|over\s*2[.,]?5/.test(t)) return 'U25';
  if (/alt\s*2[.,]?5|under\s*2[.,]?5/.test(t)) return 'A25';
  if (/kg\s*yok|btts\s*no/.test(t)) return 'KGY';
  if (/kg\s*var|btts\s*yes/.test(t)) return 'KG';
  return null;
}

/** "Galatasaray - Fenerbahce" metninden takım kimliklerini bulur */
function parseTeams(str) {
  const parts = String(str || '').split(/\s+[-–—]\s+/);
  if (parts.length !== 2) return null;
  const find = (name) => {
    const q = name.trim().toLocaleLowerCase('tr');
    if (!q) return null;
    const teams = state.meta.teams;
    return teams.find((t) => t.n.toLocaleLowerCase('tr') === q)
      || teams.find((t) => t.n.toLocaleLowerCase('tr').startsWith(q))
      || teams.find((t) => t.n.toLocaleLowerCase('tr').includes(q));
  };
  const a = find(parts[0]), b = find(parts[1]);
  return a && b ? { home: a.id, away: b.id } : null;
}

function settleOne(bet, match) {
  const pick = normPick(bet.pick);
  if (!pick) return null;
  const hg = match.hg, ag = match.ag, tot = hg + ag;
  let ok;
  if (pick === '1') ok = hg > ag;
  else if (pick === 'X') ok = hg === ag;
  else if (pick === '2') ok = ag > hg;
  else if (pick === 'U25') ok = tot > 2.5;
  else if (pick === 'A25') ok = tot < 2.5;
  else if (pick === 'KG') ok = hg > 0 && ag > 0;
  else if (pick === 'KGY') ok = !(hg > 0 && ag > 0);
  else return null;
  return ok ? 'win' : 'lose';
}

/** Bekleyen kuponları veritabanındaki sonuçlarla eşleştirip kapatır */
async function autoSettleBets(silent) {
  const bets = getBets();
  if (!bets.some((b) => b.result === 'pending')) { if (!silent) toast('Bekleyen kupon yok'); return; }
  let settled = 0;
  for (const b of bets) {
    if (b.result !== 'pending') continue;
    const ids = (b.homeId != null && b.awayId != null) ? { home: b.homeId, away: b.awayId } : parseTeams(b.match);
    if (!ids) continue;
    const date = String(b.date || '').replace(/-/g, '');
    try {
      const r = await api(`/api/find?home=${ids.home}&away=${ids.away}&date=${date}`);
      if (r && r.match && r.match.played) {
        const res = settleOne(b, r.match);
        if (res) {
          b.result = res;
          b.score = `${r.match.hg}-${r.match.ag}`;
          b.settledAt = r.match.date;
          settled++;
        }
      }
    } catch (_) { /* sessiz */ }
  }
  if (settled) {
    setBets(bets);
    renderBets();
    toast(`${settled} kupon otomatik sonuçlandı`);
  } else if (!silent) {
    toast('Eşleşen oynanmış maç bulunamadı');
  }
}

/** Analizdeki değer satırını kupon listesine ekler */
function addBetFromValue(i) {
  const r = state.lastResult;
  if (!r || !r.value || !r.value[i]) return;
  const v = r.value[i];
  const H = r.input.home, A = r.input.away;
  const match = H && A ? `${H.name} - ${A.name}` : 'Analiz';
  const bank = bankValue();
  const stake = bank > 0 ? Math.max(10, Math.round((bank * v.kelly) / 2)) : 100;
  const bets = getBets();
  bets.unshift({
    id: Date.now(), date: new Date().toISOString().slice(0, 10),
    match, pick: v.label, odds: v.odds, stake, result: 'pending',
    homeId: H ? H.id : null, awayId: A ? A.id : null,
  });
  setBets(bets);
  toast('Kupona eklendi: ' + v.label + ' @' + f2(v.odds));
}

/* ---------------------------- kupon ---------------------------- */

function getBets() {
  try { return JSON.parse(Store.get('om_bets') || '[]'); } catch (_) { return []; }
}
function setBets(b) { Store.set('om_bets', JSON.stringify(b)); }

function addBet() {
  const match = $('#betMatch').value.trim();
  const pick = $('#betPick').value.trim();
  const odds = +$('#betOdds').value;
  const stake = +$('#betStake').value;
  if (!match || !pick || !(odds > 1) || !(stake > 0)) { toast('Maç, tercih, oran ve miktar gerekli.'); return; }
  const bets = getBets();
  bets.unshift({
    id: Date.now(), date: new Date().toISOString().slice(0, 10),
    match, pick, odds, stake, result: $('#betResult').value,
  });
  setBets(bets);
  ['#betMatch', '#betPick', '#betOdds', '#betStake'].forEach((s) => ($(s).value = ''));
  renderBets();
  toast('Kupon eklendi');
}

function renderBets() {
  const bets = getBets();
  const box = $('#betStats');
  const list = $('#betList');
  const chart = $('#betChart');
  if (!box) return;

  let staked = 0, returned = 0, won = 0, lost = 0, pending = 0, voided = 0;
  const settled = bets.filter((b) => b.result !== 'pending').sort((a, b) => a.id - b.id);
  const curve = [];
  let eq = 0;
  for (const b of settled) {
    staked += b.stake;
    if (b.result === 'win') { returned += b.stake * b.odds; won++; eq += b.stake * (b.odds - 1); }
    else if (b.result === 'lose') { lost++; eq -= b.stake; }
    else if (b.result === 'void') { returned += b.stake; voided++; }
    curve.push({ x: curve.length + 1, y: +eq.toFixed(2) });
  }
  for (const b of bets) if (b.result === 'pending') pending++;

  const profit = returned - staked;
  const roi = staked ? profit / staked : 0;

  box.innerHTML = `<div class="big3">
      <div class="b"><b style="color:${profit >= 0 ? 'var(--good)' : 'var(--bad)'}">${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ₺</b><small>Net kâr</small></div>
      <div class="b"><b>${pct(roi)}</b><small>ROI</small></div>
      <div class="b"><b>${won + lost ? pct(won / (won + lost), 0) : '—'}</b><small>Kazanma</small></div>
    </div>
    <div class="row wrap" style="margin-top:12px;gap:8px">
      <span class="chip">Kupon <b>${bets.length}</b></span>
      <span class="chip">Yatırılan <b>${staked.toFixed(2)} ₺</b></span>
      <span class="chip">Bekleyen <b>${pending}</b></span>
      <span class="chip">Kazanan <b>${won}</b></span>
      <span class="chip">Kaybeden <b>${lost}</b></span>
      <span class="chip">İade <b>${voided}</b></span>
      <span style="flex:1"></span>
      <button class="btn ghost sm" id="btnBetClear">Geçmişi temizle</button>
    </div>`;

  chart.innerHTML = curve.length > 1
    ? `<div class="lab">Kasa eğrisi (₺)</div>` + lineChart([{ name: 'Kâr', color: '#2ee6a8', points: curve, area: true }], { h: 190, zeroLine: true, fmtY: (v) => v.toFixed(0) })
    : '';

  if (!bets.length) {
    list.innerHTML = '<div class="empty" style="padding:26px"><div class="hint">Henüz kupon yok. Kişisel takip için ekleyebilirsin.</div></div>';
  } else {
    list.innerHTML = `<div class="tbl"><table class="t">
      <thead><tr><th>Tarih</th><th>Maç</th><th>Tercih</th><th>Oran</th><th>Miktar</th><th>Durum</th><th></th></tr></thead>
      <tbody>${bets.map((b) => `<tr>
        <td class="mono" style="font-size:11.5px;color:var(--dim)">${b.date}</td>
        <td>${esc(b.match)}</td>
        <td>${esc(b.pick)}</td>
        <td class="mono">${f2(b.odds)}</td>
        <td class="mono">${b.stake} ₺</td>
        <td><select data-bet="${b.id}" class="betres" style="padding:4px 6px;font-size:12px;width:auto">
          <option value="pending" ${b.result === 'pending' ? 'selected' : ''}>Bekliyor</option>
          <option value="win" ${b.result === 'win' ? 'selected' : ''}>Kazandı</option>
          <option value="lose" ${b.result === 'lose' ? 'selected' : ''}>Kaybetti</option>
          <option value="void" ${b.result === 'void' ? 'selected' : ''}>İade</option>
        </select></td>
        <td><button class="btn ghost sm" data-del="${b.id}">Sil</button></td>
      </tr>`).join('')}</tbody></table></div>`;

    list.querySelectorAll('.betres').forEach((s) => s.addEventListener('change', () => {
      const arr = getBets();
      const b = arr.find((x) => x.id === +s.dataset.bet);
      if (b) { b.result = s.value; setBets(arr); renderBets(); }
    }));
    list.querySelectorAll('[data-del]').forEach((s) => s.addEventListener('click', () => {
      setBets(getBets().filter((x) => x.id !== +s.dataset.del));
      renderBets();
    }));
  }
  const clr = $('#btnBetClear');
  if (clr) clr.addEventListener('click', () => {
    if (confirm('Tüm kupon kayıtları silinsin mi?')) { setBets([]); renderBets(); }
  });
}

function exportBets() {
  const bets = getBets();
  if (!bets.length) { toast('Dışa aktarılacak kupon yok.'); return; }
  const head = 'tarih,mac,tercih,oran,miktar,durum';
  const body = bets.map((b) => [b.date, b.match, b.pick, b.odds, b.stake, b.result]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + head + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `oranmatik-kupon-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importBets(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lines = String(reader.result).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
      const rows = lines.slice(1).map((l) => {
        const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
        return cells;
      }).filter((c) => c.length >= 5 && c[1]);
      const bets = getBets();
      let added = 0;
      for (const c of rows) {
        const odds = parseFloat(c[3]), stake = parseFloat(c[4]);
        if (!(odds > 1) || !(stake > 0)) continue;
        bets.unshift({
          id: Date.now() + added, date: c[0] || new Date().toISOString().slice(0, 10),
          match: c[1], pick: c[2], odds, stake,
          result: ['win', 'lose', 'void', 'pending'].includes(c[5]) ? c[5] : 'pending',
        });
        added++;
      }
      setBets(bets);
      renderBets();
      toast(`${added} kupon içe alındı`);
    } catch (e) { toast('CSV okunamadı: ' + e.message); }
  };
  reader.readAsText(f, 'utf-8');
  ev.target.value = '';
}

/* ---------------------------- veri ---------------------------- */

function renderDataTab(meta) {
  if (!meta) return;
  $('#dataInfo').innerHTML = `
    <div class="kv"><span>Toplam maç</span><b>${meta.matches.toLocaleString('tr-TR')}</b></div>
    <div class="kv"><span>Fikstür (oynanmamış)</span><b>${(meta.fixtures || 0).toLocaleString('tr-TR')}</b></div>
    <div class="kv"><span>Takım</span><b>${meta.teams.length}</b></div>
    <div class="kv"><span>Lig</span><b>${meta.leagues.filter((l) => l.matches).length}</b></div>
    <div class="kv"><span>Sezonlar</span><b>${seasonLabel(meta.seasons[0])} – ${seasonLabel(meta.seasons[meta.seasons.length - 1])}</b></div>
    <div class="kv"><span>Tarih aralığı</span><b>${fmtDate(meta.firstDate)} – ${fmtDate(meta.lastDate)}</b></div>
    <div class="kv"><span>Derleme</span><b>${new Date(meta.builtAt).toLocaleString('tr-TR')}</b></div>
    <div class="kv"><span>Kaynak</span><b>football-data.co.uk</b></div>
    <div class="kv"><span>Oran</span><b>bwin 1-X-2 (açılış + kapanış)</b></div>
    <div class="hint" style="margin-top:12px">Tüm 1-X-2 oranları bwin'dir: açılış oranı 2004'ten, kapanış oranı 2019/20'den beri. 2.5 Alt/Üst için kaynakta bwin oranı yok; bet365 ya da piyasa ortalaması gösterilir. İY/MS, KG, skor gibi pazarlar oranlardan değil, eşleşen maçların sonuçlarından ve gol modelinden hesaplanır.</div>`;

  $('#dataLeagues').innerHTML = meta.leagues.filter((l) => l.matches)
    .sort((a, b) => b.matches - a.matches)
    .map((l) => {
      const c = meta.coverage[l.code] || {};
      const pin = c.rows ? Math.round((c.odds / c.rows) * 100) : 0;
      const bwc = c.rows ? Math.round((c.pinnacle / c.rows) * 100) : 0;
      return `<div class="lgrow">
        <div class="lgname">${esc(l.name)}</div>
        <div class="lgstats">
          <span><b>${l.matches.toLocaleString('tr-TR')}</b> maç</span>
          <span>bwin <b>%${pin}</b></span>
          <span>kapanış <b>%${bwc}</b></span>
          <span>gol <b>${f2(l.avgHome + l.avgAway)}</b></span>
          <span>üst 2.5 <b>${pct0(l.over25)}</b></span>
        </div>
      </div>`;
    }).join('');
}

async function startUpdate() {
  const btn = $('#btnUpdate');
  const log = $('#updateLog');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> güncelleniyor…';
  log.style.display = 'block';
  log.textContent = 'Başlatılıyor…\n';
  try {
    await post('/api/update', {});
    pollUpdate();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = 'Veriyi Güncelle';
  }
}

/** Adresi çöz: PC sunucusu, doğrudan .json linki veya Drive paylaşım linki */
function resolveDbUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) throw new Error('adres boş');
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;

  const drive = u.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (drive) {
    return { kind: 'drive', url: `https://drive.google.com/uc?export=download&id=${drive[1]}` };
  }
  if (/\.json(\?|#|$)/i.test(u)) return { kind: 'file', url: u };
  return { kind: 'server', url: u.replace(/\/+$/, '') + '/api/db' };
}

/** Mobil: veri paketini indir (PC sunucusu veya bulut linki) */
async function mobileUpdate() {
  const btn = $('#btnMobileUpdate');
  const stat = $('#mobileUpdateStatus');
  if (btn.dataset.busy === '1') { if (state.abortDb) state.abortDb.abort(); return; }

  let target;
  try { target = resolveDbUrl($('#srvUrl').value); } catch (e) {
    toast('Adres gerekli');
    if (stat) stat.textContent = 'Adres yaz: http://192.168.1.20:5178 veya bir .json linki';
    return;
  }
  Store.set('om_server', $('#srvUrl').value.trim());

  const ac = new AbortController();
  state.abortDb = ac;
  const timer = setTimeout(() => ac.abort(), 240000);

  btn.dataset.busy = '1';
  btn.textContent = 'İptal';
  const say = (t) => { if (stat) stat.textContent = t; };
  say('Bağlanılıyor… ' + target.url);

  try {
    const t0 = Date.now();
    const r = await fetch(target.url, { cache: 'no-store', signal: ac.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 404 ? ' — adres yanlış olabilir' : ''));

    const total = Number(r.headers.get('content-length')) || 0;
    let text;
    if (r.body && r.body.getReader) {
      const reader = r.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        say(`İndiriliyor… ${(got / 1048576).toFixed(1)}${total ? ' / ' + (total / 1048576).toFixed(1) : ''} MB`);
      }
      const buf = new Uint8Array(got);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
      text = new TextDecoder('utf-8').decode(buf);
    } else {
      text = await r.text();
    }

    say(`İndirildi: ${(text.length / 1048576).toFixed(1)} MB (${((Date.now() - t0) / 1000).toFixed(1)} sn). Doğrulanıyor…`);
    let db;
    try { db = JSON.parse(text); } catch (_) {
      throw new Error('indirilen dosya JSON değil (link yanlış veya giriş sayfası)');
    }
    if (!db || !db.matches || !Array.isArray(db.matches) || db.matches.length < 1000) {
      throw new Error('veri biçimi geçersiz');
    }
    if (db.schemaVersion && db.schemaVersion < 2) throw new Error('eski şema (v' + db.schemaVersion + ')');

    const cur = state.meta && state.meta.builtAt ? new Date(state.meta.builtAt) : null;
    const neu = db.builtAt ? new Date(db.builtAt) : null;
    if (cur && neu && neu <= cur) {
      if (!confirm(`Bu paket mevcut veriden daha eski görünüyor (${neu.toLocaleDateString('tr-TR')}). Yine de yüklensin mi?`)) {
        say('İptal edildi — mevcut veri korundu.');
        throw new Error('__cancelled__');
      }
    }

    if (!(window.NativeStore && window.NativeStore.saveDb)) {
      throw new Error('bu sürümde kalıcı kayıt yok (APK kullan)');
    }
    if (!window.NativeStore.saveDb(text)) throw new Error('dosya yazılamadı (yer yok?)');

    say(`Tamam: ${db.matches.length.toLocaleString('tr-TR')} maç · ${fmtDate(db.matches[db.matches.length - 1][0])}. Yenileniyor…`);
    toast('Veri güncellendi: ' + db.matches.length.toLocaleString('tr-TR') + ' maç');
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    const aborted = e.name === 'AbortError';
    let msg = aborted ? 'iptal edildi / zaman aşımı' : String(e.message || e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      msg = 'bağlanılamadı (adres yanlış, CORS engeli veya internet yok)';
    }
    if (msg !== '__cancelled__') {
      say('Hata: ' + msg);
      toast('Güncelleme başarısız: ' + msg);
    }
    if (target.kind === 'drive') {
      say('Hata: ' + msg + ' — Google Drive CORS izni vermiyor; GitHub/Gist linki kullan.');
    } else if (target.kind === 'server') {
      say('Hata: ' + msg + ' — bilgisayarda baslat.cmd açık mı, aynı Wi-Fi ağında mısın?');
    } else {
      say('Hata: ' + msg + ' — linkin doğrudan bir .json dosyası olduğundan ve herkese açık olduğundan emin ol.');
    }
    btn.dataset.busy = '0';
    btn.disabled = false;
    btn.textContent = 'Veriyi Güncelle';
  } finally {
    clearTimeout(timer);
    state.abortDb = null;
    if (btn.dataset.busy === '1' && !/Tamam/.test(stat ? stat.textContent : '')) {
      btn.dataset.busy = '0';
      btn.disabled = false;
      btn.textContent = 'Veriyi Güncelle';
    }
  }
}

function pollUpdate() {
  clearInterval(state.updateTimer);
  state.updateTimer = setInterval(async () => {
    try {
      const s = await api('/api/update/status');
      $('#updateLog').textContent = s.log.join('\n') || '…';
      $('#updateLog').scrollTop = 1e9;
      if (!s.running) {
        clearInterval(state.updateTimer);
        const btn = $('#btnUpdate');
        btn.disabled = false;
        btn.textContent = 'Veriyi Güncelle';
        if (s.ok) {
          toast('Veri güncellendi, sayfa yenileniyor…');
          setTimeout(() => location.reload(), 1200);
        } else {
          toast('Güncelleme tamamlanamadı: ' + (s.error || s.step));
        }
      }
    } catch (_) {}
  }, 1800);
}

/* ---------------------------- canlı veri testi ---------------------------- */

async function testLive() {
  const out = $('#liveTestOut');
  if (!out) return;
  out.style.display = 'block';
  out.textContent = 'test ediliyor…';
  const lines = [];
  const t1 = state.meta && state.meta.leagues.find((l) => l.code === 'T1');
  const lid = t1 ? t1.id : 0;

  const t0 = Date.now();
  try {
    const r = await api('/api/live?league=' + lid + '&refresh=1');
    const n = (r.events || []).length;
    const canli = (r.events || []).filter((e) => e.status === 'live').length;
    lines.push(`uygulama yolu : ${n} maç (${canli} canlı) · kaynak=${r.via || 'sunucu'} · ${Date.now() - t0} ms`);
    lines.push(`hata          : ${r.error || 'yok'}`);
    if (n) {
      const e = r.events[0];
      lines.push(`ilk maç       : ${e.homeName || e.home} - ${e.awayName || e.away} (${e.status} ${e.clock || e.time || ''})`);
    }
  } catch (e) {
    lines.push('uygulama yolu : HATA — ' + e.message);
  }

  if (window.LocalAPI && window.OranFixtures) {
    // PC erişimi
    const srv = Store.get('om_server');
    if (srv) {
      const t3 = Date.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(srv.replace(/\/+$/, '') + '/api/health', { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(to);
        lines.push(`bilgisayar    : ${r.ok ? 'ULAŞILDI' : 'HTTP ' + r.status} · ${Date.now() - t3} ms · ${srv}`);
      } catch (e) {
        lines.push(`bilgisayar    : ULAŞILAMADI (${e.message}) · ${srv}`);
      }
    } else {
      lines.push('bilgisayar    : adres girilmemiş');
    }

    const t2 = Date.now();
    try {
      const idx = window.OranFixtures.buildIndex(state.meta.teams);
      const d = await window.OranFixtures.leagueEvents('T1', { index: idx, refresh: true });
      lines.push(`doğrudan ESPN : ${(d.events || []).length} maç · hata=${d.error || 'yok'} · ${Date.now() - t2} ms`);
    } catch (e) {
      lines.push('doğrudan ESPN : HATA — ' + e.message);
    }
  } else {
    lines.push('doğrudan ESPN : masaüstünde gerekmez (sunucu çeker)');
  }

  out.textContent = lines.join('\n');
  toast('Canlı veri testi tamam');
}

/* ---------------------------- derin bağlantı ---------------------------- */

function applyDeepLink() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return;
  const tab = q.get('tab');
  if (tab) showTab(tab);
  const setVal = (sel, v) => { if (v) $(sel).value = v; };
  setVal('#oH', q.get('oH')); setVal('#oD', q.get('oD')); setVal('#oA', q.get('oA'));
  setVal('#ouOver', q.get('ouOver')); setVal('#ouUnder', q.get('ouUnder'));
  const pick = (name) => {
    if (!name) return null;
    const t = state.meta.teams.find((x) => x.n.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'));
    return t ? t.id : null;
  };
  const hid = pick(q.get('home')), aid = pick(q.get('away'));
  if (hid != null) { state.home = hid; $('#homeInput').value = state.meta.teams[hid].n; }
  if (aid != null) { state.away = aid; $('#awayInput').value = state.meta.teams[aid].n; }
  if (q.get('run') === '1') runAnalysis();
  if (q.get('runbt') === '1') setTimeout(() => runBacktest(), 300);
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

/* =====================================================================
   20 MAÇLIK İSTATİSTİK PANELİ (bwin oran eşleşmesi)
   ===================================================================== */

const NP = { mode: 'mac', fixtures: [], picked: null, loaded: false, last: null };

function npBind() {
  $$('#npSeg button').forEach((b) => b.addEventListener('click', () => npSetMode(b.dataset.np)));
  $('#npGo').addEventListener('click', npRun);
  $('#npSearch').addEventListener('input', npRenderList);
  $('#npFxRefresh').addEventListener('click', () => npLoadFixtures(true));
  ['#npH', '#npD', '#npA', '#npO', '#npU'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') npRun(); }));
  try {
    const saved = JSON.parse(Store.get('om_np_opts') || '{}');
    if (saved.count) $('#npCount').value = String(saved.count);
    if (saved.low != null) $('#npLow').checked = !!saved.low;
    if (saved.ou != null) $('#npOU').checked = !!saved.ou;
    if (saved.line) $('#npLine').value = saved.line;
    if (saved.match) $('#npMatch').value = saved.match;
  } catch (_) {}
}

function npSetMode(m) {
  NP.mode = m;
  $$('#npSeg button').forEach((b) => b.classList.toggle('on', b.dataset.np === m));
  $('#npMacBox').style.display = m === 'mac' ? '' : 'none';
  $('#npOranBox').style.display = m === 'oran' ? '' : 'none';
}

const npDateTxt = (n) => {
  if (!n) return '';
  const y = Math.floor(n / 10000), m = Math.floor((n % 10000) / 100), d = n % 100;
  return `${d} ${['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][m - 1]} ${y}`;
};
const npIso = (n) => `${Math.floor(n / 10000)}-${String(Math.floor((n % 10000) / 100)).padStart(2, '0')}-${String(n % 100).padStart(2, '0')}`;
const npO = (x) => (x > 1 ? (+x).toFixed(2) : '—');

async function npLoadFixtures(refresh) {
  const info = $('#npFxInfo');
  info.textContent = refresh ? '· yenileniyor…' : '· yükleniyor…';
  const [fx, bl] = await Promise.allSettled([
    api('/api/bwfixtures' + (refresh ? '?refresh=1' : '')),
    api('/api/bulletin' + (refresh ? '?refresh=1' : '')),
  ]);
  const list = [];
  const seen = new Set();
  const key = (d, h, a) => `${d}|${String(h).toLowerCase()}|${String(a).toLowerCase()}`;
  const fxv = fx.status === 'fulfilled' ? fx.value : null;
  if (fxv && fxv.matches) {
    for (const m of fxv.matches) {
      list.push({ ...m, hasOdds: m.h > 1 && m.d > 1 && m.a > 1 });
      seen.add(key(m.date, m.home >= 0 ? m.home : m.homeName, m.away >= 0 ? m.away : m.awayName));
    }
  }
  // günün bülteninden oranı olmayan, başlamamış maçlar (oranı sen girersin)
  const blv = bl.status === 'fulfilled' ? bl.value : null;
  if (blv && blv.matches) {
    for (const m of blv.matches) {
      if (m.status !== 'ns') continue;
      const k = key(m.date, m.home >= 0 ? m.home : m.homeName, m.away >= 0 ? m.away : m.awayName);
      if (seen.has(k)) continue;
      seen.add(k);
      const lg = state.meta && state.meta.leagues ? state.meta.leagues.find((l) => l.code === m.league) : null;
      list.push({ league: m.league, leagueName: lg ? lg.name : m.league, date: m.date, time: m.time, homeName: m.homeName, awayName: m.awayName, home: m.home, away: m.away, hasOdds: false });
    }
  }
  list.sort((a, b) => a.date - b.date || (a.time || '').localeCompare(b.time || '') || a.league.localeCompare(b.league));
  NP.fixtures = list;
  NP.loaded = true;

  const nb = list.filter((m) => m.hasOdds).length;
  let msg = `· ${list.length} maç, ${nb} tanesi bwin oranlı`;
  if (fxv && fxv.fetchedAt) msg += ` · oranlar ${new Date(fxv.fetchedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  if (fxv && fxv.error === 'no_server') msg = `· ${list.length} maç · bwin listesi için bilgisayar adresi gerekli (Veri sekmesi)`;
  else if (fxv && fxv.source === 'none') msg = `· ${list.length} maç · bwin oran listesi henüz oluşmadı`;
  else if (fxv && fxv.error && !nb) msg += ` · bwin listesi alınamadı (${fxv.error})`;
  if (!list.length) msg = '· liste boş — "Oran Gir" ile devam edebilirsin';
  info.textContent = msg;
  npRenderList();
}

function npRenderList() {
  const box = $('#npFxList');
  const q = (window.OranFixtures ? window.OranFixtures.norm : (s) => String(s).toLowerCase())($('#npSearch').value || '');
  const norm = window.OranFixtures ? window.OranFixtures.norm : (s) => String(s).toLowerCase();
  const items = NP.fixtures.filter((m) => !q || norm(m.homeName + ' ' + m.awayName).includes(q));
  if (!items.length) { box.innerHTML = NP.loaded ? '<div class="np-fx"><span class="hint">Eşleşen maç yok.</span></div>' : ''; return; }
  let html = '';
  let lastDate = 0;
  items.slice(0, 250).forEach((m) => {
    if (m.date !== lastDate) { html += `<div class="np-fxgroup">${npDateTxt(m.date)}</div>`; lastDate = m.date; }
    const idx = NP.fixtures.indexOf(m);
    const on = NP.picked && NP.picked.idx === idx ? ' on' : '';
    const od = m.hasOdds
      ? `1 <b>${npO(m.h)}</b> · X <b>${npO(m.d)}</b> · 2 <b>${npO(m.a)}</b>${m.o ? ` · Ü <b>${npO(m.o)}</b> A <b>${npO(m.u)}</b>` : ''}`
      : '<span class="nood">oran yok — sen gir</span>';
    html += `<div class="np-fx${on}" data-fx="${idx}">
      <div><div class="when">${esc(m.time || '')} · ${esc(m.leagueName || m.league)}</div><div class="teams">${esc(m.homeName)} – ${esc(m.awayName)}</div></div>
      <div class="od">${od}</div></div>`;
  });
  box.innerHTML = html;
  box.querySelectorAll('[data-fx]').forEach((el) => el.addEventListener('click', () => npPick(+el.dataset.fx)));
}

function npPick(idx) {
  const m = NP.fixtures[idx];
  if (!m) return;
  NP.picked = { idx, m };
  $('#npPicked').innerHTML = `
    <div style="font-size:12px;color:var(--dim)">${npDateTxt(m.date)} · ${esc(m.time || '')} · ${esc(m.leagueName || m.league)}</div>
    <div style="font-weight:800;font-size:15px">${esc(m.homeName)} – ${esc(m.awayName)}</div>
    <div class="np-odds">
      <div class="field"><label>1</label><input type="number" step="0.01" id="npPH" value="${m.h || ''}" class="o1"></div>
      <div class="field"><label>X</label><input type="number" step="0.01" id="npPD" value="${m.d || ''}" class="oX"></div>
      <div class="field"><label>2</label><input type="number" step="0.01" id="npPA" value="${m.a || ''}" class="o2"></div>
      <div class="field"><label>2.5 Üst</label><input type="number" step="0.01" id="npPO" value="${m.o || ''}"></div>
      <div class="field"><label>2.5 Alt</label><input type="number" step="0.01" id="npPU" value="${m.u || ''}"></div>
    </div>
    <div class="hint" style="margin-top:6px">${m.hasOdds ? 'Oranlar açılış oranlarıdır; bwin\'de güncel oran farklıysa buradan düzeltebilirsin.' : 'Bu maçın oranı listede yok: bwin\'deki 1-X-2 (ve varsa 2.5 Alt/Üst) oranlarını yaz.'}</div>`;
  npRenderList();
  if (m.hasOdds) npRun();
  else { const f = $('#npPH'); if (f) f.focus(); }
}

function npInput() {
  if (NP.mode === 'mac') {
    if (!NP.picked) throw new Error('Listeden bir maç seç ya da "Oran Gir" sekmesine geç.');
    const m = NP.picked.m;
    return { h: +$('#npPH').value, d: +$('#npPD').value, a: +$('#npPA').value, o: +$('#npPO').value || 0, u: +$('#npPU').value || 0, homeName: m.homeName, awayName: m.awayName, date: m.date, time: m.time, league: m.leagueName };
  }
  return { h: +$('#npH').value, d: +$('#npD').value, a: +$('#npA').value, o: +$('#npO').value || 0, u: +$('#npU').value || 0, homeName: $('#npHome').value.trim(), awayName: $('#npAway').value.trim() };
}

async function npRun() {
  let input;
  try { input = npInput(); } catch (e) { toast(e.message); return; }
  if (!(input.h > 1 && input.d > 1 && input.a > 1)) { toast('1, X ve 2 oranlarını gir.'); return; }
  const options = { count: +$('#npCount').value, excludeLow: $('#npLow').checked, useOU: $('#npOU').checked, line: $('#npLine').value, match: $('#npMatch').value };
  Store.set('om_np_opts', JSON.stringify({ count: options.count, low: options.excludeLow, ou: options.useOU, line: options.line, match: options.match }));
  const out = $('#npOut');
  out.innerHTML = '<div class="card"><div class="hint">Benzer maçlar aranıyor…</div></div>';
  try {
    const r = await post('/api/panel', { input, options });
    NP.last = r;
    out.innerHTML = npRender(r, input);
    const applyColor = (c) => { ['#npCardsList', '#npTblWrap'].forEach((s) => { const el = $(s); if (el) { if (c) el.style.setProperty('--npc', c); else el.style.removeProperty('--npc'); } }); };
    $('#npColor').addEventListener('input', (e) => { Store.set('om_np_color', e.target.value); applyColor(e.target.value); });
    $('#npColorReset').addEventListener('click', (e) => { e.preventDefault(); Store.set('om_np_color', ''); $('#npColor').value = '#ff8c28'; applyColor(''); });
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    out.innerHTML = `<div class="card"><div class="hint" style="color:var(--bad)">${esc(e.message)}</div></div>`;
  }
}

function npRender(r, input) {
  const st = r.stats;
  const card = (title, c, baseP) => {
    const diff = c.p - baseP;
    const cls = diff >= 0.08 ? 'hi' : diff <= -0.08 ? 'lo' : '';
    return `<div class="np-c"><div class="k">${title}</div><div class="v">%${Math.round(c.p * 100)}</div>
      <div class="n">${c.k}/${c.n} maç</div><div class="b ${cls}">arşiv geneli %${Math.round(baseP * 100)}</div></div>`;
  };
  const home = r.input.homeName || 'Ev sahibi', away = r.input.awayName || 'Deplasman';
  const ou = r.input.o ? ` · 2.5 Üst ${npO(r.input.o)}${r.input.u ? ` / Alt ${npO(r.input.u)}` : ''}` : '';
  const res = st.res;
  const htft = st.htft.slice(0, 4).map((x) => `<span class="chip">İY/MS ${esc(x.score)} <b>%${Math.round(x.p * 100)}</b></span>`).join('');

  const tgt = r.input;
  const hit = (v, t) => (Math.abs(v - t) < 0.005 ? ' class="eq"' : '');
  const rows = r.rows.map((x) => `<tr class="${x.rocket ? 'g6' : ''}">
      <td>${npIso(x.date)}</td><td>${esc(x.league)}</td>
      <td class="m">${esc(x.home)} – ${esc(x.away)}${x.rocket ? ' 🚀' : ''}</td>
      <td>${esc(x.ht || '—')}</td><td class="ms">${esc(x.ft)}</td><td>${esc(x.htft || '—')}</td>
      <td${hit(x.o1, tgt.h)}>${npO(x.o1)}</td><td${hit(x.oX, tgt.d)}>${npO(x.oX)}</td><td${hit(x.o2, tgt.a)}>${npO(x.o2)}</td>
      <td>${npO(x.under25)}</td><td>${npO(x.over25)}</td></tr>`).join('');
  // telefon: skor önde, kart görünümü
  const cards = r.rows.map((x) => `<div class="np-row${x.rocket ? ' g6' : ''}">
      <div class="np-r1"><span>${npIso(x.date)}</span><span>${esc(x.league)}</span></div>
      <div class="np-r2">
        <span class="tm h">${esc(x.home)}</span>
        <span class="sc"><b>${esc(x.ft)}</b><small>İY ${esc(x.ht || '—')}${x.htft ? ' · ' + esc(x.htft) : ''}</small></span>
        <span class="tm a">${esc(x.away)}${x.rocket ? ' 🚀' : ''}</span>
      </div>
      <div class="np-r3"><span${hit(x.o1, tgt.h)}>1 ${npO(x.o1)}</span><span${hit(x.oX, tgt.d)}>X ${npO(x.oX)}</span><span${hit(x.o2, tgt.a)}>2 ${npO(x.o2)}</span><span>A ${npO(x.under25)}</span><span>Ü ${npO(x.over25)}</span></div>
    </div>`).join('');
  const tcol = Store.get('om_np_color') || '';

  const trend = (list, den, zeroRed) => list.slice(0, 8).map((x) => `<div class="np-tr">
      <span class="d${zeroRed && x.score === '0-0' ? ' z' : ''}"></span><span class="sc">${esc(x.score)}</span>
      <span class="c">${x.count} maç</span><span class="p">%${Math.round(x.p * 100)}</span></div>`).join('') || '<div class="hint">Veri yok</div>';

  const v = r.verdict;
  return `
  <div class="card">
    <div class="lab" style="color:#ff9a3c">bwin analiz</div>
    <h3 style="margin-top:2px">${r.found} Maçlık İstatistik Paneli <span class="spacer"></span><span class="np-src">bwin</span></h3>
    <div class="np-head"><div class="t">${esc(home)}</div><div class="vs">VS</div><div class="t">${esc(away)}</div></div>
    <div class="np-oddsline">1 ${npO(r.input.h)} · X ${npO(r.input.d)} · 2 ${npO(r.input.a)}${ou}</div>
    <div class="np-verdict ${v.tone}"><span class="k">TAHMİN</span><span class="v">${esc(v.label)}</span>${v.side ? `<span class="s">${esc(v.side)}</span>` : ''}</div>
    <div class="np-cards">
      ${card('İY 0.5 Üst', st.iy05, r.base.iy05)}
      ${card('İY 1.5 Üst', st.iy15, r.base.iy15)}
      ${card('KG Var', st.kg, r.base.kg)}
      ${card('MS 2.5 Üst', st.o25, r.base.o25)}
      ${card('MS 3.5 Üst', st.o35, r.base.o35)}
    </div>
    <div class="np-mini">
      <span class="chip">1 <b>%${Math.round(res.h * 100)}</b></span>
      <span class="chip">X <b>%${Math.round(res.d * 100)}</b></span>
      <span class="chip">2 <b>%${Math.round(res.a * 100)}</b></span>
      <span class="chip">Maç başı gol <b>${st.avgGoals.toFixed(2)}</b></span>
      <span class="chip">6+ gol 🚀 <b>${st.g6.k}/${st.g6.n}</b></span>
      ${htft}
    </div>
    ${r.notes.length ? `<div class="hint" style="margin-top:10px">${r.notes.map(esc).join(' ')}</div>` : ''}
  </div>

  <div class="card">
    <h3>Geçmiş Maçlar <span class="spacer"></span>
      <label class="np-color">Tablo rengi <input type="color" id="npColor" value="${tcol || '#ff8c28'}"></label>
      <a href="#" class="np-reset" id="npColorReset">Sıfırla</a></h3>
    <div class="np-cards-list" id="npCardsList" style="${tcol ? `--npc:${tcol}` : ''}">${cards}</div>
    <div class="tbl np-tblwrap" id="npTblWrap" style="${tcol ? `--npc:${tcol}` : ''}"><table class="t np-t">
      <thead><tr><th>Tarih</th><th>Lig</th><th>Maç</th><th>İY</th><th>MS</th><th>İY/MS</th><th>1</th><th>X</th><th>2</th><th>2.5 Alt</th><th>2.5 Üst</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="hint" style="margin-top:8px">Turuncu oran = girdiğin oranla birebir aynı. 🚀 = 6 ve üzeri gol. 1-X-2 sütunları bwin ${r.options.line === 'close' ? 'kapanış' : 'açılış'} oranıdır; 2.5 Alt/Üst bet365 ya da piyasa ortalamasıdır (kaynakta bwin'in gol oranı yok).</div>
  </div>

  <div class="np-trends">
    <div class="card"><h3>İlk Yarı Skor Trendi</h3>${trend(st.htTrend, st.htN, true)}</div>
    <div class="card"><h3>Maç Sonu Skor Trendi</h3>${trend(st.ftTrend, st.n, true)}</div>
  </div>

  <div class="card"><div class="hint">Bu panel <b>tahmin değil</b>, benzer oranlı ${r.found} geçmiş maçın dökümüdür. 20 maç küçük bir örneklem: tek bir maç yüzdeyi 5 puan oynatır.
    "Arşiv geneli" satırı, aynı istatistiğin 117 bin maçtaki ortalamasıdır; yeşil = belirgin yüksek, mavi = belirgin düşük. Bahis tavsiyesi değildir, 18+.</div></div>`;
}
