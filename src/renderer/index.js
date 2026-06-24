'use strict';

const $ = (sel) => document.querySelector(sel);

const watchEl = $('#watchlist');
const items = new Map(); // symbol → {el, spark, closes, lastPrice}

// ---- 드래그 정렬 ----
let dragEl = null;
function dragAfter(y) {
  const els = [...watchEl.querySelectorAll('.watch-item:not(.dragging)')];
  let closest = { offset: -Infinity, el: null };
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
  }
  return closest.el;
}
function persistWatchOrder() {
  const order = [...watchEl.querySelectorAll('.watch-item')].map((li) => li.dataset.symbol);
  window.api.reorderWatch(order);
}
watchEl.addEventListener('dragover', (e) => {
  if (!dragEl) return;
  e.preventDefault();
  const after = dragAfter(e.clientY);
  if (after == null) watchEl.appendChild(dragEl);
  else watchEl.insertBefore(dragEl, after);
});

function fmt(n) {
  return Number(n).toLocaleString('ko-KR');
}
function fmtPrice(n, market) {
  // 미국 종목은 소수점 2자리
  return market === 'US'
    ? Number(n).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Number(n).toLocaleString('ko-KR');
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
  renderSparkline(it.spark, it.closes, it.startPrice);
}

function renderSparkline(svg, closes, startPrice) {
  if (!svg || !closes || closes.length < 2) return;
  const w = 72, h = 30, pad = 3;
  const base = startPrice != null ? startPrice : closes[0]; // 시작가 기준선
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
  const res = await window.api.getDailyChart({ symbol, market: it.market, apiCode: it.apiCode }, 'D');
  if (!res.ok || !res.candles.length) return;
  const recent = res.candles.slice(-30);
  it.closes = recent.map((c) => c.close);
  it.startPrice = recent[recent.length - 1].open; // 오늘 시가
  drawSparkline(it);
}

// 저장된 종목을 {symbol, market, apiCode}로 정규화
function asItem(o) {
  return {
    symbol: o.symbol,
    market: o.market === 'US' ? 'US' : 'KR',
    apiCode: o.apiCode || o.symbol,
  };
}

// ---- 관심종목 ----
function renderItem(item) {
  const market = item.market === 'US' ? 'US' : 'KR';
  const apiCode = item.apiCode || item.symbol;
  const codeLabel = market === 'US' ? `${item.symbol} · 미국` : item.symbol;
  const li = document.createElement('li');
  li.className = 'watch-item';
  li.dataset.symbol = item.symbol;
  li.innerHTML = `
    <div class="wi-info">
      <div class="name">${item.name}</div>
      <div class="code">${codeLabel}</div>
    </div>
    <svg class="spark" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="wi-right">
      <div class="price">
        <div class="px">-</div>
        <div class="krw"></div>
        <div class="rate flat">-</div>
      </div>
      <button class="del" title="삭제">×</button>
    </div>`;

  // 드래그로 순서 변경
  li.draggable = true;
  li.addEventListener('dragstart', () => {
    dragEl = li;
    setTimeout(() => li.classList.add('dragging'), 0);
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    dragEl = null;
    persistWatchOrder();
  });

  li.addEventListener('click', (e) => {
    if (e.target.classList.contains('del')) return;
    window.api.openStockWindow(item.symbol, item.name, 'stock', market, apiCode);
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
    market,
    apiCode,
  });
}

// ---- 환율 (미국 종목 원화 환산) ----
let fxRate = null;
function setKrw(it, price) {
  const el = it.el.querySelector('.krw');
  if (!el) return;
  if (it.market === 'US' && fxRate && price != null) {
    el.textContent = `≈ ${Math.round(price * fxRate).toLocaleString('ko-KR')}원`;
  } else {
    el.textContent = '';
  }
}
async function loadFx() {
  const r = await window.api.getUsdKrw();
  if (r.ok) {
    fxRate = r.rate;
    for (const it of items.values()) if (it.market === 'US') setKrw(it, it.lastPrice);
  }
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
  pxEl.textContent = fmtPrice(price, it.market);
  pxEl.className = `px ${cls}`;
  rateEl.className = `rate ${cls}`;
  const sign = change > 0 ? '▲' : change < 0 ? '▼' : '-';
  rateEl.textContent = `${sign} ${fmtPrice(Math.abs(change), it.market)} (${rate}%)`;
  setKrw(it, price);

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

// input: 검색결과 객체 {code,name,market,apiCode} 또는 6자리 문자열(한국)
async function addStock(input) {
  const res = await window.api.addWatch(input);
  if (!res.ok) {
    alert(res.error || '추가 실패');
    return;
  }
  if (!items.has(res.item.symbol)) renderItem(res.item);
  if (res.quote) {
    updatePrice(res.item.symbol, res.quote.price, res.quote.change, res.quote.changeRate);
  }
  loadSparkline(res.item.symbol);
  await window.api.subscribe(asItem(res.item));
  clearSearch();
}

async function loadWatchlist() {
  const list = await window.api.getWatchlist();
  for (const item of list) {
    renderItem(item);
    loadSparkline(item.symbol);
    window.api.subscribe(asItem(item));
    window.api.getQuote(asItem(item)).then((r) => {
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
  const t = $('#wsText');
  if (u.type === 'checking') t.textContent = '업데이트 확인 중...';
  else if (u.type === 'available') t.textContent = `새 버전 발견 — 다운로드 중...`;
  else if (u.type === 'progress') t.textContent = `업데이트 다운로드 ${u.percent}%`;
  else if (u.type === 'downloaded') t.textContent = '업데이트 준비됨 — 재시작 시 설치';
  else if (u.type === 'latest') t.textContent = '최신 버전입니다';
  else if (u.type === 'error') t.textContent = '업데이트 확인 실패';
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
    <li class="search-result" data-idx="${i}">
      <span><span class="sr-name">${r.name}</span> <span class="sr-meta">${r.exchange || ''}</span></span>
      <span class="sr-code">${r.code}</span>
    </li>`
    )
    .join('');
  resultsEl.querySelectorAll('.search-result').forEach((li) => {
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addStock(currentResults[Number(li.dataset.idx)]);
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
    if (activeIdx >= 0 && currentResults[activeIdx]) addStock(currentResults[activeIdx]);
    else if (/^\d{6}$/.test(searchInput.value.trim())) addStock(searchInput.value.trim());
    else if (currentResults[0]) addStock(currentResults[0]);
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
const indexCharts = {}; // key → { closes:[], startPrice }

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

// 한 세션(KRX/NXT/미국장)의 장 운영시간 HTML (하루 24시간 기준)
// 시작 전 = 빨강, 장 중 = 회색, 마감 30분 전 = 빨강 네온, 마감 후 = 표시 안 함
function sessionHtml(tz, s) {
  const nowM = nowMinInTZ(tz);
  const openM = parseHM(s.open);
  const closeM = parseHM(s.close);
  // 마감 후에는 더 이상 표시하지 않음
  if (nowM >= closeM) return '';
  const beforeOpen = nowM < openM;
  const lbl = s.label ? `<b>${s.label}</b> ` : '';
  // 시작 라인: 시작 전=빨강, 장 중=회색
  const openCls = beforeOpen ? 'mkt-red' : 'mkt-gray';
  const openTxt = beforeOpen
    ? `시작 전 ${fmtDur(openM - nowM)}`
    : `시작 후 ${fmtDur(nowM - openM)}`;
  let html = `<span class="im-line ${openCls}">${lbl}장시작 ${s.open} · ${openTxt}</span>`;
  // 시작 전이면 마감 정보 숨김 / 장 중이면 마감 전 표시
  if (!beforeOpen) {
    const minsToClose = closeM - nowM;
    const closingSoon = minsToClose <= 30; // 마감 30분 전 = 빨강 네온
    const closeCls = closingSoon ? 'mkt-closing' : 'mkt-gray';
    html += `<span class="im-line ${closeCls}">${lbl}마감 ${s.close} · 마감 전 ${fmtDur(minsToClose)}</span>`;
  }
  return `<span class="mkt-session">${html}</span>`;
}

// 지수 셀 아래에 들어갈 장 운영시간 HTML
function marketHoursHtml(key) {
  const mh = MARKET_HOURS[key];
  if (!mh) return '';
  const inner = mh.sessions.map((s) => sessionHtml(mh.tz, s)).join('');
  if (!inner) return ''; // 모든 세션 마감 후면 표시 안 함
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
        <div class="idx-main">
          <div class="idx-pr">
            <span class="idx-val">${val}</span>
            <span class="idx-rate ${cls}">${rate}</span>
          </div>
          <svg class="idx-spark" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
        ${marketHoursHtml(ix.key)}
      </div>`;
    })
    .join('');
  // 지수 숫자 오른쪽 미니차트 그리기 (캐시된 차트 + 라이브 마지막점)
  indexBar.querySelectorAll('.idx').forEach((cell) => {
    const ch = indexCharts[cell.dataset.key];
    const svg = cell.querySelector('.idx-spark');
    if (ch && svg) renderSparkline(svg, ch.closes, ch.startPrice);
  });
}

async function loadIndices() {
  const res = await window.api.getIndices();
  if (res.ok) {
    indicesData = res.indices;
    // 미니차트 마지막 점을 실시간 지수값으로 갱신
    for (const ix of indicesData) {
      const ch = indexCharts[ix.key];
      if (ch && ch.closes.length && !ix.error) ch.closes[ch.closes.length - 1] = ix.price;
    }
  }
  renderIndexBar();
}

async function loadIndexCharts() {
  for (const key of Object.keys(MARKET_HOURS)) {
    try {
      const r = await window.api.getIndexChart(key, 'D');
      if (r.ok && r.candles.length) {
        const recent = r.candles.slice(-30);
        indexCharts[key] = {
          closes: recent.map((c) => c.close),
          startPrice: recent[recent.length - 1].open,
        };
      }
    } catch (_) {
      /* 무시 */
    }
  }
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
loadFx();
setInterval(loadFx, 60000); // 환율 1분마다 갱신
loadIndexCharts();
setInterval(loadIndexCharts, 300000); // 5분마다 지수 차트 갱신
loadIndices();
setInterval(loadIndices, 20000);
setInterval(renderIndexBar, 30000); // 경과 시간 갱신
window.api.getTheme().then(applyTheme);
window.api.getVersion().then((v) => {
  const el = $('#appVersion');
  el.textContent = `by Claudio Lim · v${v}`;
  el.style.cursor = 'pointer';
  el.title = '클릭하면 업데이트 확인';
  el.addEventListener('click', () => {
    $('#wsText').textContent = '업데이트 확인 중...';
    window.api.checkUpdate();
  });
});
loadWatchlist();
