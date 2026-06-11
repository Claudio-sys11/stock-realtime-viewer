'use strict';

const $ = (sel) => document.querySelector(sel);

const watchEl = $('#watchlist');
const items = new Map(); // symbol → {el, name}

function fmt(n) {
  return Number(n).toLocaleString('ko-KR');
}
function colorClass(change) {
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}

function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'watch-item';
  li.dataset.symbol = item.symbol;
  li.innerHTML = `
    <div>
      <div class="name">${item.name}</div>
      <div class="code">${item.symbol}</div>
    </div>
    <div class="row">
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
  items.set(item.symbol, { el: li, name: item.name });
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
  await window.api.subscribe(res.item.symbol);
  clearSearch();
}

async function loadWatchlist() {
  const list = await window.api.getWatchlist();
  for (const item of list) {
    renderItem(item);
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

// ---- 초기화 ----
window.api.getVersion().then(
  (v) => ($('#appVersion').textContent = `제작 Claudio Lim · v${v}`)
);
loadWatchlist();
