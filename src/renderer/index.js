'use strict';

const $ = (sel) => document.querySelector(sel);

const watchEl = $('#watchlist');
const items = new Map(); // symbol → {el, spark, closes, lastPrice}

function fmt(n) {
  return Number(n).toLocaleString('ko-KR');
}
function colorClass(change) {
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}

// ---- 테마 ----
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  const btn = $('#themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️ 화이트' : '🌙 블랙';
  // 미니차트 색은 CSS 변수라 자동 반영되지만, 안전하게 다시 그림
  for (const it of items.values()) drawSparkline(it);
}
$('#themeToggle').addEventListener('click', async () => {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await window.api.setTheme(next);
});
window.api.onThemeChange((t) => applyTheme(t));

// ---- 미니차트 (스파크라인, 시작가 기준 위=빨강/아래=파랑) ----
function drawSparkline(it) {
  const closes = it.closes;
  const svg = it.spark;
  if (!svg || !closes || closes.length < 2) return;
  const w = 72, h = 30, pad = 3;
  const base = it.startPrice != null ? it.startPrice : closes[0]; // 시작가 기준선
  const min = Math.min(base, ...closes);
  const max = Math.max(base, ...closes);
  const range = max - min || 1;
  const X = (i) => pad + (i / (closes.length - 1)) * (w - pad * 2);
  const Y = (v) => pad + (1 - (v - min) / range) * (h - pad * 2);
  const baseY = Y(base);
  const red = [];
  const blue = [];
  for (let i = 0; i < closes.length - 1; i++) {
    const x0 = X(i), y0 = Y(closes[i]);
    const x1 = X(i + 1), y1 = Y(closes[i + 1]);
    const v0 = closes[i], v1 = closes[i + 1];
    const a0 = v0 >= base, a1 = v1 >= base;
    if (a0 === a1) {
      (a0 ? red : blue).push(`M${x0.toFixed(1)},${y0.toFixed(1)}L${x1.toFixed(1)},${y1.toFixed(1)}`);
    } else {
      const t = (base - v0) / (v1 - v0);
      const xc = x0 + (x1 - x0) * t;
      (a0 ? red : blue).push(`M${x0.toFixed(1)},${y0.toFixed(1)}L${xc.toFixed(1)},${baseY.toFixed(1)}`);
      (a1 ? red : blue).push(`M${xc.toFixed(1)},${baseY.toFixed(1)}L${x1.toFixed(1)},${y1.toFixed(1)}`);
    }
  }
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML =
    `<line x1="${pad}" y1="${baseY.toFixed(1)}" x2="${w - pad}" y2="${baseY.toFixed(1)}" stroke="var(--border)" stroke-width="0.7" stroke-dasharray="2 2"/>` +
    `<path d="${red.join('')}" fill="none" stroke="#f23645" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${blue.join('')}" fill="none" stroke="#2962ff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

async function loadSparkline(symbol) {
  const it = items.get(symbol);
  if (!it) return;
  const res = await window.api.getDailyChart(symbol, 'D');
  if (!res.ok || !res.candles.length) return;
  const recent = res.candles.slice(-30);
  it.closes = recent.map((c) => c.close);
  it.startPrice = recent[recent.length - 1].open; // 오늘 시가
  drawSparkline(it);
}

// ---- 관심종목 ----
function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'watch-item';
  li.dataset.symbol = item.symbol;
  li.innerHTML = `
    <div class="wi-info">
      <div class="name">${item.name}</div>
      <div class="code">${item.symbol}</div>
    </div>
    <svg class="spark" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="wi-right">
      <div class="price">
        <div class="px">-</div>
        <div class="rate flat">-</div>
      </div>
      <button class="del" title="삭제">×</button>
    </div>`;

  li.addEventListener('click', (e) => {
    if (e.target.classList.contains('del')) return;
    window.api.openStockWindow(item.symbol, item.name);
  });
  li.querySelector('.del').addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.removeWatch(item.symbol);
    await window.api.unsubscribe(item.symbol);
    li.remove();
    items.delete(item.symbol);
  });

  watchEl.appendChild(li);
  items.set(item.symbol, {
    el: li,
    spark: li.querySelector('.spark'),
    closes: null,
    startPrice: null,
    lastPrice: null,
  });
}

function flash(el, dir) {
  el.classList.remove('flash-up', 'flash-down');
  // 리플로우로 애니메이션 재시작 보장
  void el.offsetWidth;
  el.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
}

function updatePrice(symbol, price, change, rate) {
  const it = items.get(symbol);
  if (!it) return;
  const pxEl = it.el.querySelector('.px');
  const rateEl = it.el.querySelector('.rate');
  const cls = colorClass(change);
  pxEl.textContent = fmt(price);
  pxEl.className = `px ${cls}`;
  rateEl.className = `rate ${cls}`;
  const sign = change > 0 ? '▲' : change < 0 ? '▼' : '-';
  rateEl.textContent = `${sign} ${fmt(Math.abs(change))} (${rate}%)`;

  // 시세 변경 시 금액 강조 (직전 대비 방향으로 깜빡임)
  if (it.lastPrice != null && price !== it.lastPrice) {
    flash(pxEl, price > it.lastPrice ? 1 : -1);
    // 미니차트 마지막 점을 실시간 가격으로 갱신
    if (it.closes && it.closes.length) {
      it.closes[it.closes.length - 1] = price;
      drawSparkline(it);
    }
  }
  it.lastPrice = price;
}

async function addSymbol(symbol) {
  const res = await window.api.addWatch(symbol);
  if (!res.ok) {
    alert(res.error || '추가 실패');
    return;
  }
  if (!items.has(res.item.symbol)) renderItem(res.item);
  if (res.quote) {
    updatePrice(res.item.symbol, res.quote.price, res.quote.change, res.quote.changeRate);
  }
  loadSparkline(res.item.symbol);
  await window.api.subscribe(res.item.symbol);
  clearSearch();
}

async function loadWatchlist() {
  const list = await window.api.getWatchlist();
  for (const item of list) {
    renderItem(item);
    loadSparkline(item.symbol);
    window.api.subscribe(item.symbol);
    window.api.getQuote(item.symbol).then((r) => {
      if (r.ok) updatePrice(item.symbol, r.quote.price, r.quote.change, r.quote.changeRate);
    });
  }
}

// ---- 실시간(폴링) 시세 ----
window.api.onRealtime(({ symbol, type, payload }) => {
  if (type === 'trade') {
    updatePrice(symbol, payload.price, payload.change, payload.changeRate);
  }
});

const STATUS_TEXT = {
  connecting: '시세 불러오는 중...',
  connected: '시세 갱신 중',
  error: '시세 오류',
};
window.api.onWsStatus(({ status, detail }) => {
  $('#wsDot').className = `dot ${status}`;
  $('#wsText').textContent = STATUS_TEXT[status] || status;
  if (detail && status === 'error') $('#wsText').textContent += ` (${detail})`;
});

window.api.onUpdate((u) => {
  if (u.type === 'available') $('#wsText').textContent = '새 업데이트 다운로드 중...';
  if (u.type === 'downloaded') $('#wsText').textContent = '업데이트 준비됨 — 재시작 대기';
});

// ---- 종목 검색 + 선택 ----
const searchInput = $('#symbolInput');
const resultsEl = $('#searchResults');
let searchTimer = null;
let currentResults = [];
let activeIdx = -1;

function clearSearch() {
  searchInput.value = '';
  resultsEl.innerHTML = '';
  currentResults = [];
  activeIdx = -1;
}

function renderResults(results) {
  currentResults = results;
  activeIdx = -1;
  resultsEl.innerHTML = results
    .map(
      (r, i) => `
    <li class="search-result" data-idx="${i}" data-code="${r.code}">
      <span><span class="sr-name">${r.name}</span> <span class="sr-meta">${r.market}</span></span>
      <span class="sr-code">${r.code}</span>
    </li>`
    )
    .join('');
  resultsEl.querySelectorAll('.search-result').forEach((li) => {
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addSymbol(li.dataset.code);
    });
  });
}

async function doSearch(q) {
  q = q.trim();
  if (!q) {
    resultsEl.innerHTML = '';
    currentResults = [];
    return;
  }
  const res = await window.api.searchStocks(q);
  if (res.ok) renderResults(res.results);
}

function moveActive(d) {
  const lis = [...resultsEl.querySelectorAll('.search-result')];
  if (!lis.length) return;
  activeIdx = (activeIdx + d + lis.length) % lis.length;
  lis.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
  lis[activeIdx].scrollIntoView({ block: 'nearest' });
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value;
  searchTimer = setTimeout(() => doSearch(q), 200);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveActive(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveActive(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIdx >= 0 && currentResults[activeIdx]) addSymbol(currentResults[activeIdx].code);
    else if (/^\d{6}$/.test(searchInput.value.trim())) addSymbol(searchInput.value.trim());
    else if (currentResults[0]) addSymbol(currentResults[0].code);
  } else if (e.key === 'Escape') {
    resultsEl.innerHTML = '';
  }
});

searchInput.addEventListener('blur', () => setTimeout(() => (resultsEl.innerHTML = ''), 150));

// ---- 주요 지수 + 장 운영시간 (상단) ----
const indexBar = $('#indexBar');
const MARKET_HOURS = {
  // 코스피는 KRX(정규장)와 NXT(넥스트레이드, 연장거래)를 따로 표기
  KOSPI: {
    tz: 'Asia/Seoul',
    sessions: [
      { label: 'KRX', open: '09:00', close: '15:30' },
      { label: 'NXT', open: '08:00', close: '20:00' },
    ],
  },
  IXIC: { tz: 'America/New_York', sessions: [{ open: '09:30', close: '16:00' }] },
  SPX: { tz: 'America/New_York', sessions: [{ open: '09:30', close: '16:00' }] },
};
let indicesData = [];

function fmt2(n) {
  return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseHM(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
function nowMinInTZ(tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  let h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value);
    if (p.type === 'minute') m = Number(p.value);
  }
  return (h % 24) * 60 + m;
}
function fmtDur(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

// 한 세션(KRX/NXT/미국장)의 장 운영시간 HTML
function sessionHtml(tz, s) {
  const nowM = nowMinInTZ(tz);
  const openM = parseHM(s.open);
  const closeM = parseHM(s.close);
  const beforeOpen = nowM < openM;
  const lbl = s.label ? `<b>${s.label}</b> ` : '';
  // 시작 전=빨강(up), 시작 후=파랑(down)
  const openCls = beforeOpen ? 'up' : 'down';
  const openTxt = beforeOpen
    ? `시작 전 ${fmtDur(openM - nowM)}`
    : `시작 후 ${fmtDur(nowM - openM)}`;
  let html = `<span class="im-line">${lbl}<span class="im-t">장시작 ${s.open}</span> <span class="${openCls}">${openTxt}</span></span>`;
  // 시작 전이면 마감 정보 숨김
  if (!beforeOpen) {
    const closeTxt = nowM < closeM
      ? `마감 전 ${fmtDur(closeM - nowM)}`
      : `마감 후 ${fmtDur(nowM - closeM)}`;
    html += `<span class="im-line">${lbl}<span class="im-t">마감 ${s.close}</span> <span class="im-close">${closeTxt}</span></span>`;
  }
  return html;
}

// 지수 셀 아래에 들어갈 장 운영시간 HTML
function marketHoursHtml(key) {
  const mh = MARKET_HOURS[key];
  if (!mh) return '';
  const inner = mh.sessions.map((s) => sessionHtml(mh.tz, s)).join('');
  return `<span class="idx-mkt">${inner}</span>`;
}

function renderIndexBar() {
  if (!indicesData.length) return;
  indexBar.innerHTML = indicesData
    .map((ix) => {
      const cls = colorClass(ix.changeRate);
      const sign = ix.changeRate > 0 ? '▲' : ix.changeRate < 0 ? '▼' : '-';
      const val = ix.error ? '-' : fmt2(ix.price);
      const rate = ix.error ? '' : `${sign} ${Math.abs(ix.changeRate).toFixed(2)}%`;
      return `<div class="idx" data-key="${ix.key}" data-name="${ix.name}" title="${ix.name} 차트 보기">
        <span class="idx-name">${ix.name}</span>
        <span class="idx-val">${val}</span>
        <span class="idx-rate ${cls}">${rate}</span>
        ${marketHoursHtml(ix.key)}
      </div>`;
    })
    .join('');
}

async function loadIndices() {
  const res = await window.api.getIndices();
  if (res.ok) indicesData = res.indices;
  renderIndexBar();
}

// 지수 클릭 → 차트 창 열기
indexBar.addEventListener('click', (e) => {
  const cell = e.target.closest('.idx');
  if (!cell || !cell.dataset.key) return;
  window.api.openStockWindow(cell.dataset.key, cell.dataset.name, 'index');
});

// ---- 현재 시간 (한국시간) ----
function updateClock() {
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
  $('#clock').textContent = `🇰🇷 ${t}`;
}

// ---- 초기화 ----
updateClock();
setInterval(updateClock, 1000);
loadIndices();
setInterval(loadIndices, 20000);
setInterval(renderIndexBar, 30000); // 경과 시간 갱신
window.api.getTheme().then(applyTheme);
window.api.getVersion().then(
  (v) => ($('#appVersion').textContent = `제작 Claudio Lim · v${v}`)
);
loadWatchlist();
