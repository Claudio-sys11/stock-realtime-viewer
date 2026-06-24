'use strict';

const $ = (s) => document.querySelector(s);
const fmtN = (n, dec) => Number(n).toLocaleString('ko-KR', dec ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});
const colorClass = (c) => (c > 0 ? 'up' : c < 0 ? 'down' : 'flat');
const isUS = (m) => m === 'US';

let fxRate = null;
let watch = loadWatch(); // [{symbol,name,market,apiCode}]
const state = new Map(); // symbol → {lastPrice, closes, startPrice}

// ---------------- localStorage ----------------
function loadWatch() {
  try { return JSON.parse(localStorage.getItem('watch') || '[]'); } catch (_) { return []; }
}
function saveWatch() { localStorage.setItem('watch', JSON.stringify(watch)); }

// ---------------- 시계 ----------------
function tickClock() {
  $('#clock').textContent = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
}

// ---------------- 스파크라인 (시작가 기준 위 빨강/아래 파랑) ----------------
function renderSparkline(svg, closes, startPrice) {
  if (!svg || !closes || closes.length < 2) return;
  const w = 76, h = 34, pad = 3;
  const base = startPrice != null ? startPrice : closes[0];
  const min = Math.min(base, ...closes), max = Math.max(base, ...closes);
  const range = max - min || 1;
  const X = (i) => pad + (i / (closes.length - 1)) * (w - pad * 2);
  const Y = (v) => pad + (1 - (v - min) / range) * (h - pad * 2);
  const baseY = Y(base);
  const red = [], blue = [];
  for (let i = 0; i < closes.length - 1; i++) {
    const x0 = X(i), y0 = Y(closes[i]), x1 = X(i + 1), y1 = Y(closes[i + 1]);
    const a0 = closes[i] >= base, a1 = closes[i + 1] >= base;
    if (a0 === a1) (a0 ? red : blue).push(`M${x0.toFixed(1)},${y0.toFixed(1)}L${x1.toFixed(1)},${y1.toFixed(1)}`);
    else {
      const t = (base - closes[i]) / (closes[i + 1] - closes[i]);
      const xc = x0 + (x1 - x0) * t;
      (a0 ? red : blue).push(`M${x0.toFixed(1)},${y0.toFixed(1)}L${xc.toFixed(1)},${baseY.toFixed(1)}`);
      (a1 ? red : blue).push(`M${xc.toFixed(1)},${baseY.toFixed(1)}L${x1.toFixed(1)},${y1.toFixed(1)}`);
    }
  }
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML =
    `<line x1="${pad}" y1="${baseY.toFixed(1)}" x2="${w - pad}" y2="${baseY.toFixed(1)}" stroke="var(--border)" stroke-width="0.8" stroke-dasharray="2 2"/>` +
    `<path d="${red.join('')}" fill="none" stroke="var(--up)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${blue.join('')}" fill="none" stroke="var(--down)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ---------------- 테마 (흰색 기본 / 검은색) ----------------
const cv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function applyChartTheme() {
  if (!chart) return;
  chart.applyOptions({
    layout: { background: { color: cv('--chart-bg') }, textColor: cv('--muted') },
    grid: { vertLines: { color: cv('--chart-grid') }, horzLines: { color: cv('--chart-grid') } },
    rightPriceScale: { borderColor: cv('--border') },
    timeScale: { borderColor: cv('--border') },
  });
}
function applyTheme(t) {
  const dark = t === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = $('#themeToggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = dark ? '#0e1116' : '#ffffff';
  applyChartTheme();
}
$('#themeToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
});

// ---------------- 장 운영시간 ----------------
const MARKET_HOURS = {
  KOSPI: { tz: 'Asia/Seoul', sessions: [
    { label: 'KRX', open: '09:00', close: '15:30' },
    { label: 'NXT', open: '08:00', close: '20:00' },
  ] },
  IXIC: { tz: 'America/New_York', sessions: [{ open: '09:30', close: '16:00' }] },
  SPX: { tz: 'America/New_York', sessions: [{ open: '09:30', close: '16:00' }] },
};
function parseHM(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function nowMinInTZ(tz) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  let h = 0, m = 0;
  for (const x of p) { if (x.type === 'hour') h = +x.value; if (x.type === 'minute') m = +x.value; }
  return (h % 24) * 60 + m;
}
function fmtDur(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
}
// 장시작/마감 시각은 항상 표시. 시작·마감 전/후는 비활성 시 하이픈.
// 시작 전·마감 30분 전 = 빨강, 그 외 = 회색
function sessionHtml(tz, s) {
  const nowM = nowMinInTZ(tz), openM = parseHM(s.open), closeM = parseHM(s.close);
  const beforeOpen = nowM < openM, afterClose = nowM >= closeM;
  const lbl = s.label ? `<b>${s.label}</b> ` : '';

  // 장시작: 개장 30분 전=빨강, 그 외 개장 전/장 중=회색, 마감 후=하이픈
  let openRel = '-', openCls = 'mkt-gray';
  if (beforeOpen) { openRel = `시작 전 ${fmtDur(openM - nowM)}`; if (openM - nowM <= 30) openCls = 'mkt-closing'; }
  else if (!afterClose) { openRel = `시작 후 ${fmtDur(nowM - openM)}`; }

  // 마감: 마감 30분 전=빨강, 장 중=회색, 개장 전/마감 후=하이픈
  let closeRel = '-', closeCls = 'mkt-gray';
  if (!beforeOpen && !afterClose) {
    const m2c = closeM - nowM;
    closeRel = `마감 전 ${fmtDur(m2c)}`;
    if (m2c <= 30) closeCls = 'mkt-closing';
  }

  const l1 = `<span class="im-line">${lbl}<span class="im-t">장시작 ${s.open}</span> · <span class="${openCls}">${openRel}</span></span>`;
  const l2 = `<span class="im-line">${lbl}<span class="im-t">마감 ${s.close}</span> · <span class="${closeCls}">${closeRel}</span></span>`;
  return `<span class="mkt-session">${l1}${l2}</span>`;
}
function marketHoursHtml(key) {
  const mh = MARKET_HOURS[key];
  if (!mh) return '';
  return `<div class="idx-mkt">${mh.sessions.map((s) => sessionHtml(mh.tz, s)).join('')}</div>`;
}

// ---------------- 지수 바 (상하 배치) ----------------
let indicesData = [];
function renderIndexBar() {
  if (!indicesData.length) return;
  $('#indexBar').innerHTML = indicesData.map((ix) => {
    const cls = colorClass(ix.changeRate);
    const sign = ix.changeRate > 0 ? '▲' : ix.changeRate < 0 ? '▼' : '-';
    return `<div class="idx-row" data-key="${ix.key}" data-name="${ix.name}">
      <div class="idx-head">
        <span class="idx-name">${ix.name}</span>
        <span class="idx-val">${ix.error ? '-' : fmtN(ix.price, true)}</span>
        <span class="idx-rate ${cls}">${ix.error ? '' : sign + ' ' + Math.abs(ix.changeRate).toFixed(2) + '%'}</span>
      </div>
      ${marketHoursHtml(ix.key)}
    </div>`;
  }).join('');
}
async function loadIndices() {
  try { indicesData = await NV.getIndices(); } catch (_) {}
  renderIndexBar();
}
$('#indexBar').addEventListener('click', (e) => {
  const c = e.target.closest('.idx-row');
  if (c) openChart({ type: 'index', symbol: c.dataset.key, name: c.dataset.name });
});

// ---------------- 드래그 정렬 (터치/마우스) ----------------
let dragItem = null;
function startDrag(e, li) {
  e.preventDefault();
  dragItem = li;
  li.classList.add('dragging');
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', endDrag, { once: true });
}
function onDragMove(e) {
  if (!dragItem) return;
  e.preventDefault();
  const wl = $('#watchlist');
  const els = [...wl.querySelectorAll('.w-item:not(.dragging)')];
  let after = null, closest = -Infinity;
  for (const c of els) {
    const b = c.getBoundingClientRect();
    const o = e.clientY - b.top - b.height / 2;
    if (o < 0 && o > closest) { closest = o; after = c; }
  }
  if (after == null) wl.appendChild(dragItem);
  else wl.insertBefore(dragItem, after);
}
function endDrag() {
  document.removeEventListener('pointermove', onDragMove);
  if (!dragItem) return;
  dragItem.classList.remove('dragging');
  dragItem = null;
  const order = [...$('#watchlist').querySelectorAll('.w-item')].map((li) => li.dataset.symbol);
  watch.sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol));
  saveWatch();
}

// ---------------- 관심종목 ----------------
function renderWatch() {
  const el = $('#watchlist');
  el.innerHTML = watch.map((it) => {
    const codeLabel = isUS(it.market) ? `${it.symbol} · 미국` : it.symbol;
    return `<li class="w-item" data-symbol="${it.symbol}">
      <div class="w-info"><div class="w-name">${it.name}</div><div class="w-code">${codeLabel}</div></div>
      <svg class="w-spark"></svg>
      <div class="w-right"><div class="w-px">-</div><div class="w-krw"></div><div class="w-rate flat">-</div></div>
      <button class="w-del" title="삭제">×</button>
      <button class="w-handle" title="순서 변경">⠿</button>
    </li>`;
  }).join('');
  el.querySelectorAll('.w-item').forEach((li) => {
    const sym = li.dataset.symbol;
    const it = watch.find((x) => x.symbol === sym);
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('w-del') || e.target.classList.contains('w-handle')) return;
      openChart({ type: 'stock', symbol: it.symbol, name: it.name, market: it.market, apiCode: it.apiCode });
    });
    li.querySelector('.w-del').addEventListener('click', (e) => {
      e.stopPropagation();
      watch = watch.filter((x) => x.symbol !== sym);
      saveWatch(); renderWatch();
    });
    li.querySelector('.w-handle').addEventListener('pointerdown', (e) => startDrag(e, li));
    // 초기 시세 + 스파크라인
    NV.getQuote(it).then((q) => setRow(sym, q.price, q.change, q.changeRate)).catch(() => {});
    loadSpark(it);
  });
}

function setRow(symbol, price, change, rate) {
  const it = watch.find((x) => x.symbol === symbol);
  if (!it) return;
  const li = document.querySelector(`.w-item[data-symbol="${symbol}"]`);
  if (!li) return;
  const cls = colorClass(change);
  const sign = change > 0 ? '▲' : change < 0 ? '▼' : '-';
  li.querySelector('.w-px').textContent = fmtN(price, isUS(it.market));
  li.querySelector('.w-px').className = `w-px ${cls}`;
  const rateEl = li.querySelector('.w-rate');
  rateEl.className = `w-rate ${cls}`;
  rateEl.textContent = `${sign} ${fmtN(Math.abs(change), isUS(it.market))} (${rate}%)`;
  const krwEl = li.querySelector('.w-krw');
  krwEl.textContent = isUS(it.market) && fxRate ? `≈ ${Math.round(price * fxRate).toLocaleString('ko-KR')}원` : '';
  const st = state.get(symbol);
  if (st && st.closes && st.closes.length) {
    st.closes[st.closes.length - 1] = price;
    renderSparkline(li.querySelector('.w-spark'), st.closes, st.startPrice);
  }
  if (st) st.lastPrice = price;
}

async function loadSpark(it) {
  try {
    const candles = await NV.getDailyChart(it, 'D');
    if (!candles.length) return;
    const recent = candles.slice(-30);
    const st = state.get(it.symbol) || {};
    st.closes = recent.map((c) => c.close);
    st.startPrice = recent[recent.length - 1].open;
    state.set(it.symbol, st);
    const li = document.querySelector(`.w-item[data-symbol="${it.symbol}"]`);
    if (li) renderSparkline(li.querySelector('.w-spark'), st.closes, st.startPrice);
  } catch (_) {}
}

async function pollWatch() {
  if (!watch.length) { $('#status').textContent = '관심종목 없음'; return; }
  try {
    const list = await NV.pollMany(watch);
    for (const d of list) setRow(d.symbol, d.price, d.change, d.changeRate);
    $('#status').textContent = '시세 갱신 중';
  } catch (_) { $('#status').textContent = '시세 오류'; }
}

async function loadFx() {
  try { fxRate = await NV.getUsdKrw(); renderWatch(); } catch (_) {}
}

// 최신 릴리스 버전 표시 (Windows 업데이트 시 자동 동기화). GitHub API는 CORS 허용.
async function loadVersion() {
  try {
    const r = await fetch('https://api.github.com/repos/Claudio-sys11/stock-realtime-viewer/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const j = await r.json();
    if (j.tag_name) $('#ver').textContent = j.tag_name;
    // 프로그램(Windows 설치파일) 다이렉트 다운로드 링크
    const assets = j.assets || [];
    const exe = assets.find((a) => /setup.*\.exe$/i.test(a.name)) || assets.find((a) => /\.exe$/i.test(a.name));
    if (exe && exe.browser_download_url) {
      const dl = $('#dl');
      dl.href = exe.browser_download_url;
      dl.textContent = `⬇ ${j.tag_name} 설치파일`;
    }
  } catch (_) {}
}

function addStock(item) {
  const it = { symbol: item.code || item.symbol, name: item.name, market: item.market === 'US' ? 'US' : 'KR', apiCode: item.apiCode || item.code };
  if (!watch.find((x) => x.symbol === it.symbol)) { watch.push(it); saveWatch(); renderWatch(); }
  clearSearch();
}

// ---------------- 검색 ----------------
const qEl = $('#q'), resEl = $('#results');
let timer = null, results = [];
function clearSearch() { qEl.value = ''; resEl.innerHTML = ''; results = []; }
qEl.addEventListener('input', () => {
  clearTimeout(timer);
  const q = qEl.value;
  timer = setTimeout(async () => {
    if (!q.trim()) { resEl.innerHTML = ''; return; }
    try { results = await NV.search(q); } catch (_) { return; }
    resEl.innerHTML = results.map((r, i) =>
      `<li data-i="${i}"><span><span class="nm">${r.name}</span><span class="ex">${r.exchange || ''}</span></span><span class="cd">${r.code}</span></li>`
    ).join('');
    resEl.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => addStock(results[+li.dataset.i])));
  }, 250);
});

// ---------------- 차트 오버레이 ----------------
let chart, series, volSeries, openLine, supportLine, lastPoint, cvTimer, current;
function ensureChart() {
  if (chart) return;
  chart = LightweightCharts.createChart($('#chart'), {
    layout: { background: { color: '#0e1116' }, textColor: '#8b949e' },
    grid: { vertLines: { color: '#1c232c' }, horzLines: { color: '#1c232c' } },
    rightPriceScale: { borderColor: '#2a323d' }, timeScale: { borderColor: '#2a323d' },
  });
  series = chart.addBaselineSeries({
    baseValue: { type: 'price', price: 0 }, lineWidth: 2,
    topLineColor: '#f23645', topFillColor1: 'rgba(242,54,69,0.3)', topFillColor2: 'rgba(242,54,69,0.03)',
    bottomLineColor: '#2962ff', bottomFillColor1: 'rgba(41,98,255,0.03)', bottomFillColor2: 'rgba(41,98,255,0.3)',
  });
  volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
  volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  applyChartTheme();
}
function cvResize() { const el = $('#chart'); chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }); }
window.addEventListener('resize', () => { if (chart && $('#chartView').classList.contains('show')) cvResize(); });

async function cvLoadChart(period) {
  const c = current;
  const candles = c.type === 'index' ? await NV.getIndexChart(c.symbol, period) : await NV.getDailyChart(c, period);
  if (!candles.length) return;
  const last = candles[candles.length - 1];
  series.applyOptions({ baseValue: { type: 'price', price: last.open } });
  series.setData(candles.map((x) => ({ time: x.time, value: x.close })));
  volSeries.setData(candles.map((x) => ({ time: x.time, value: x.volume, color: x.close >= x.open ? 'rgba(242,54,69,.5)' : 'rgba(41,98,255,.5)' })));
  lastPoint = { time: last.time, value: last.close };
  if (openLine) series.removePriceLine(openLine);
  if (supportLine) series.removePriceLine(supportLine);
  openLine = series.createPriceLine({ price: last.open, color: '#9aa0a6', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '시작가' });
  const support = Math.min(...candles.slice(-20).map((x) => x.low));
  supportLine = series.createPriceLine({ price: support, color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '지지선' });
  chart.timeScale().fitContent();
  cvResize();
}

function cvSetPrice(price, change, rate, dec) {
  const cls = colorClass(change), sign = change > 0 ? '▲' : change < 0 ? '▼' : '-';
  $('#cvPrice').textContent = fmtN(price, dec);
  $('#cvPrice').className = cls;
  $('#cvRate').textContent = `${sign} ${fmtN(Math.abs(change), dec)} (${rate}%)`;
  $('#cvRate').className = `rate ${cls}`;
  $('#cvKrw').textContent = current.type === 'stock' && isUS(current.market) && fxRate ? `≈ ${Math.round(price * fxRate).toLocaleString('ko-KR')}원` : '';
  if (lastPoint) { lastPoint = { time: lastPoint.time, value: price }; series.update(lastPoint); }
}

async function cvPoll() {
  try {
    const q = current.type === 'index' ? await NV.getIndexQuote(current.symbol) : await NV.getQuote(current);
    cvSetPrice(q.price, q.change, q.changeRate, current.type === 'index' || isUS(current.market));
  } catch (_) {}
}

async function openChart(c) {
  current = c;
  ensureChart();
  $('#cvName').textContent = c.name;
  $('#cvPrice').textContent = '-'; $('#cvRate').textContent = ''; $('#cvKrw').textContent = '';
  $('#chartView').classList.add('show');
  document.querySelectorAll('.cv-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.p === 'D'));
  cvResize();
  await cvLoadChart('D');
  cvPoll();
  clearInterval(cvTimer);
  cvTimer = setInterval(cvPoll, 5000);
}
$('#cvBack').addEventListener('click', () => {
  $('#chartView').classList.remove('show');
  clearInterval(cvTimer);
});
document.querySelectorAll('.cv-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cv-tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    cvLoadChart(btn.dataset.p);
  });
});

// ---------------- 초기화 ----------------
applyTheme(localStorage.getItem('theme') || 'light'); // 기본 흰색
tickClock(); setInterval(tickClock, 1000);
renderWatch();
loadIndices(); setInterval(loadIndices, 20000);
setInterval(renderIndexBar, 30000); // 경과 시간 갱신
loadFx(); setInterval(loadFx, 60000);
loadVersion();
pollWatch(); setInterval(pollWatch, 5000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
