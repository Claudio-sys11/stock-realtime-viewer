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

// ---- 미니차트 (스파크라인) ----
function drawSparkline(it) {
  const closes = it.closes;
  const svg = it.spark;
  if (!svg || !closes || closes.length < 2) return;
  const w = 72, h = 30, pad = 3;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pts = closes
    .map((c, i) => {
      const x = pad + (i / (closes.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (c - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const up = closes[closes.length - 1] >= closes[0];
  const stroke = up ? 'var(--up)' : 'var(--down)';
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML =
    `<polyline points="${pts}" fill="none" stroke="${stroke}" ` +
    `stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
}

async function loadSparkline(symbol) {
  const it = items.get(symbol);
  if (!it) return;
  const res = await window.api.getDailyChart(symbol, 'D');
  if (!res.ok || !res.candles.length) return;
  it.closes = res.candles.slice(-30).map((c) => c.close);
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

// ---- 주요 지수 (코스피/나스닥/S&P500) ----
const indexBar = $('#indexBar');
function fmt2(n) {
  return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
async function loadIndices() {
  const res = await window.api.getIndices();
  if (!res.ok) return;
  indexBar.innerHTML = res.indices
    .map((ix) => {
      const cls = colorClass(ix.changeRate);
      const sign = ix.changeRate > 0 ? '▲' : ix.changeRate < 0 ? '▼' : '-';
      const val = ix.error ? '-' : fmt2(ix.price);
      const rate = ix.error ? '' : `${sign} ${Math.abs(ix.changeRate).toFixed(2)}%`;
      return `<div class="idx" data-key="${ix.key}" data-name="${ix.name}" title="${ix.name} 차트 보기">
        <span class="idx-name">${ix.name}</span>
        <span class="idx-val">${val}</span>
        <span class="idx-rate ${cls}">${rate}</span>
      </div>`;
    })
    .join('');
}

// 지수 클릭 → 차트 창 열기
indexBar.addEventListener('click', (e) => {
  const cell = e.target.closest('.idx');
  if (!cell || !cell.dataset.key) return;
  window.api.openStockWindow(cell.dataset.key, cell.dataset.name, 'index');
});

// ---- 초기화 ----
loadIndices();
setInterval(loadIndices, 20000);
window.api.getTheme().then(applyTheme);
window.api.getVersion().then(
  (v) => ($('#appVersion').textContent = `제작 Claudio Lim · v${v}`)
);
loadWatchlist();
