'use strict';

const $ = (sel) => document.querySelector(sel);

const watchEl = $('#watchlist');
const items = new Map(); // symbol → {el, name, prevClose}

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

  // 클릭 → 차트 창 열기
  li.addEventListener('click', (e) => {
    if (e.target.classList.contains('del')) return;
    window.api.openStockWindow(item.symbol, item.name);
  });
  // 삭제
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
  pxEl.textContent = fmt(price);
  const cls = colorClass(change);
  rateEl.className = `rate ${cls}`;
  pxEl.className = `px ${cls}`;
  const sign = change > 0 ? '▲' : change < 0 ? '▼' : '-';
  rateEl.textContent = `${sign} ${fmt(Math.abs(change))} (${rate}%)`;
}

async function addSymbol(symbol) {
  const res = await window.api.addWatch(symbol);
  if (!res.ok) {
    alert(res.error || '추가 실패');
    return;
  }
  if (!items.has(res.item.symbol)) {
    renderItem(res.item);
  }
  if (res.quote) {
    updatePrice(res.item.symbol, res.quote.price, res.quote.change, res.quote.changeRate);
  }
  await window.api.subscribe(res.item.symbol);
  $('#symbolInput').value = '';
}

async function loadWatchlist() {
  const cfg = await window.api.getConfig();
  for (const item of cfg.watchlist) {
    renderItem(item);
    window.api.subscribe(item.symbol);
    // 초기 현재가 1회 조회
    window.api.getQuote(item.symbol).then((r) => {
      if (r.ok) updatePrice(item.symbol, r.quote.price, r.quote.change, r.quote.changeRate);
    });
  }
}

// ---- 실시간 체결 → 가격 갱신 ----
window.api.onRealtime(({ symbol, type, payload }) => {
  if (type === 'trade') {
    updatePrice(symbol, payload.price, payload.change, payload.changeRate);
  }
});

// ---- WebSocket 상태 표시 ----
const STATUS_TEXT = {
  connecting: '연결 중...',
  connected: '실시간 연결됨',
  disconnected: '연결 끊김',
  error: '연결 오류',
};
window.api.onWsStatus(({ status, detail }) => {
  $('#wsDot').className = `dot ${status}`;
  $('#wsText').textContent = STATUS_TEXT[status] || status;
  if (detail && status === 'error') $('#wsText').textContent += ` (${detail})`;
});

// ---- 업데이트 알림 ----
window.api.onUpdate((u) => {
  if (u.type === 'available') $('#wsText').textContent = '새 업데이트 다운로드 중...';
  if (u.type === 'downloaded') $('#wsText').textContent = '업데이트 준비됨 — 재시작 대기';
});

// ---- 설정 모달 ----
const modal = $('#settingsModal');
$('#btnSettings').addEventListener('click', async () => {
  const cfg = await window.api.getConfig();
  $('#cfgAppKey').value = cfg.appKey || '';
  $('#cfgAppSecret').value = cfg.hasSecret ? '********' : '';
  $('#cfgMock').checked = !!cfg.mock;
  modal.classList.add('show');
});
$('#cfgCancel').addEventListener('click', () => modal.classList.remove('show'));
$('#cfgSave').addEventListener('click', async () => {
  const appKey = $('#cfgAppKey').value.trim();
  const raw = $('#cfgAppSecret').value;
  // 마스킹('********')을 그대로 두면 시크릿 변경 안 함(null=기존 유지)
  const appSecret = raw === '********' ? null : raw;
  await window.api.setCredentials({
    appKey,
    appSecret, // null이면 메인에서 기존 시크릿 유지
    mock: $('#cfgMock').checked,
  });
  modal.classList.remove('show');
  alert('저장되었습니다. 종목을 추가해 보세요.');
});

// ---- 종목 추가 ----
$('#btnAdd').addEventListener('click', () => addSymbol($('#symbolInput').value));
$('#symbolInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addSymbol($('#symbolInput').value);
});

// ---- 초기화 ----
window.api.getVersion().then((v) => ($('#appVersion').textContent = `v${v}`));
loadWatchlist();
