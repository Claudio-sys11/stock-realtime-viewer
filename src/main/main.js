'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const { autoUpdater } = require('electron-updater');

const { NaverClient } = require('./naver');
const { Store } = require('./store');

const isDev = process.argv.includes('--dev');

let store;
let naver;
let mainWindow = null;

// 종목별로 열린 차트 창: symbol → BrowserWindow
const stockWindows = new Map();

// 실시간 폴링 구독: symbol → 참조 수, symbol → {market, apiCode}
const subs = new Map();
const subInfo = new Map();
let pollTimer = null;
const POLL_INTERVAL = 4000; // ms

/** 저장된 창 위치가 현재 연결된 모니터 안에 보이는지 */
function boundsOnScreen(b) {
  if (!b || b.x == null || b.y == null) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });
}

function createMainWindow() {
  const opts = {
    width: 420,
    height: 640,
    minWidth: 360,
    minHeight: 480,
    title: '주식 뷰어 — 관심종목',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  // 마지막 창 위치/크기 복원
  const saved = store.getWindowBounds();
  if (saved && saved.width && saved.height) {
    opts.width = saved.width;
    opts.height = saved.height;
    if (boundsOnScreen(saved)) {
      opts.x = saved.x;
      opts.y = saved.y;
    }
  }
  mainWindow = new BrowserWindow(opts);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // 종료 시 위치/크기 저장
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
      store.setWindowBounds(mainWindow.getBounds());
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** 종목/지수 차트 창 열기 (이미 있으면 포커스) */
function openStockWindow(symbol, name, type, market, apiCode) {
  if (stockWindows.has(symbol)) {
    const w = stockWindows.get(symbol);
    if (!w.isDestroyed()) {
      w.focus();
      return;
    }
    stockWindows.delete(symbol);
  }

  const win = new BrowserWindow({
    width: 880,
    height: 620,
    title: type === 'index' ? `${name}` : `${name || symbol} (${symbol})`,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const url = new URL(`file://${path.join(__dirname, '..', 'renderer', 'stock.html')}`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('name', name || symbol);
  url.searchParams.set('type', type === 'index' ? 'index' : 'stock');
  url.searchParams.set('market', market === 'US' ? 'US' : 'KR');
  url.searchParams.set('apiCode', apiCode || symbol);
  win.loadURL(url.toString());
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  stockWindows.set(symbol, win);
  win.on('closed', () => {
    stockWindows.delete(symbol);
    unsubscribe(symbol);
  });
}

/** 실시간(폴링) 시세를 해당 종목 창 + 메인 창으로 전달 */
function routeRealtime(symbol, payload) {
  const win = stockWindows.get(symbol);
  if (win && !win.isDestroyed()) {
    win.webContents.send('realtime', { symbol, type: 'trade', payload });
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('realtime', { symbol, type: 'trade', payload });
  }
}

function sendStatus(status, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ws-status', { status, detail });
  }
}

// ---------------- 실시간 폴링 ----------------

function subscribe(item) {
  const it = typeof item === 'string' ? { symbol: item, market: 'KR', apiCode: item } : item;
  subs.set(it.symbol, (subs.get(it.symbol) || 0) + 1);
  subInfo.set(it.symbol, { market: it.market || 'KR', apiCode: it.apiCode || it.symbol });
  startPolling();
}

function unsubscribe(symbol) {
  const cur = subs.get(symbol) || 0;
  if (cur <= 1) {
    subs.delete(symbol);
    subInfo.delete(symbol);
  } else {
    subs.set(symbol, cur - 1);
  }
  if (subs.size === 0) stopPolling();
}

function startPolling() {
  if (pollTimer) return;
  sendStatus('connecting');
  pollTick();
  pollTimer = setInterval(pollTick, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function pollTick() {
  const symbols = [...subs.keys()];
  if (!symbols.length) {
    stopPolling();
    return;
  }
  const items = symbols.map((s) => ({ symbol: s, ...(subInfo.get(s) || { market: 'KR', apiCode: s }) }));
  try {
    const list = await naver.pollMany(items);
    for (const d of list) {
      routeRealtime(d.symbol, {
        price: d.price,
        change: d.change,
        changeRate: d.changeRate,
      });
    }
    sendStatus('connected');
  } catch (e) {
    sendStatus('error', e.message);
  }
}

// ---------------- IPC 핸들러 ----------------

function registerIpc() {
  ipcMain.handle('watchlist:get', () => store.getWatchlist());

  ipcMain.handle('watchlist:add', async (_e, input) => {
    // input: 6자리 문자열(한국) 또는 {code/symbol, name, market, apiCode}
    let item;
    if (typeof input === 'string') {
      const symbol = input.trim();
      if (!/^\d{6}$/.test(symbol)) {
        return { ok: false, error: '종목코드는 6자리 숫자이거나 검색해서 선택해야 합니다.' };
      }
      item = { symbol, market: 'KR', apiCode: symbol };
    } else {
      item = {
        symbol: input.symbol || input.code,
        name: input.name,
        market: input.market === 'US' ? 'US' : 'KR',
        apiCode: input.apiCode || input.symbol || input.code,
      };
    }
    try {
      const quote = await naver.getQuote(item);
      const saved = { symbol: item.symbol, name: item.name || quote.name, market: item.market, apiCode: item.apiCode };
      store.addToWatchlist(saved);
      return { ok: true, item: saved, quote };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('watchlist:remove', (_e, symbol) => {
    store.removeFromWatchlist(symbol);
    return { ok: true };
  });

  ipcMain.handle('watchlist:reorder', (_e, symbols) => {
    store.reorderWatchlist(symbols || []);
    return { ok: true };
  });

  ipcMain.handle('window:openStock', (_e, { symbol, name, type, market, apiCode }) => {
    openStockWindow(symbol, name, type, market, apiCode);
    return { ok: true };
  });

  ipcMain.handle('chart:daily', async (_e, { symbol, market, apiCode, period }) => {
    try {
      const candles = await naver.getDailyChart({ symbol, market, apiCode }, period || 'D');
      return { ok: true, candles };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('quote:get', async (_e, item) => {
    try {
      return { ok: true, quote: await naver.getQuote(item) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('indices:get', async () => {
    try {
      return { ok: true, indices: await naver.getIndices() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('indexChart:get', async (_e, { key, period }) => {
    try {
      return { ok: true, candles: await naver.getIndexChart(key, period || 'D') };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('indexQuote:get', async (_e, key) => {
    try {
      return { ok: true, quote: await naver.getIndexQuote(key) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('stocks:search', async (_e, query) => {
    try {
      return { ok: true, results: await naver.search(query) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('fx:usdkrw', async () => {
    try {
      return { ok: true, rate: await naver.getUsdKrw() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('realtime:subscribe', (_e, item) => {
    subscribe(item);
    return { ok: true };
  });

  ipcMain.handle('realtime:unsubscribe', (_e, symbol) => {
    unsubscribe(symbol);
    return { ok: true };
  });

  ipcMain.handle('link:open', (_e, url) => {
    openInChrome(url);
    return { ok: true };
  });

  ipcMain.handle('theme:get', () => store.getTheme());
  ipcMain.handle('theme:set', (_e, theme) => {
    const t = theme === 'dark' ? 'dark' : 'light';
    store.setTheme(t);
    // 모든 창에 테마 변경 알림
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('theme', t);
    }
    return { ok: true };
  });

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('update:check', () => {
    checkForUpdates();
    return { ok: true };
  });
}

/** 외부 링크를 Chrome으로 연다 (없으면 기본 브라우저). */
function openInChrome(url) {
  if (!/^https?:\/\//i.test(url)) return;
  const candidates = [
    `${process.env.PROGRAMFILES || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  const chrome = candidates.find((p) => {
    try {
      return p && fs.existsSync(p);
    } catch (_) {
      return false;
    }
  });
  try {
    if (chrome) {
      cp.spawn(chrome, [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal(url); // Chrome 미설치 시 기본 브라우저
    }
  } catch (_) {
    shell.openExternal(url);
  }
}

// ---------------- 자동 업데이트 ----------------

function checkForUpdates() {
  // 패키징(설치)된 앱에서만 동작 (개발/포터블 실행 시 비활성)
  if (isDev || !app.isPackaged) return;
  autoUpdater.checkForUpdates().catch((e) => console.error('업데이트 확인 실패:', e));
}

function setupAutoUpdater() {
  if (isDev || !app.isPackaged) return;
  autoUpdater.autoDownload = true; // 새 버전 발견 시 자동 다운로드
  autoUpdater.autoInstallOnAppQuit = true; // '나중에' 선택해도 종료 시 자동 설치

  const send = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update', payload);
  };

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ type: 'available', info }));
  autoUpdater.on('update-not-available', () => send({ type: 'latest' }));
  autoUpdater.on('download-progress', (p) => send({ type: 'progress', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', async (info) => {
    send({ type: 'downloaded', info });
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
      title: '업데이트 준비 완료',
      message: `새 버전(${info.version})이 준비되었습니다.`,
      detail: "'지금 재시작'을 누르면 바로 설치됩니다. '나중에'를 누르면 프로그램 종료 시 자동 설치됩니다.",
    });
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });
  autoUpdater.on('error', (err) => {
    console.error('자동 업데이트 오류:', err);
    send({ type: 'error', message: String((err && err.message) || err) });
  });

  checkForUpdates(); // 실행 직후 최종 버전 확인
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000); // 4시간마다 재확인
}

// ---------------- 앱 라이프사이클 ----------------

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  naver = new NaverClient();
  registerIpc();
  createMainWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  stopPolling();
  if (process.platform !== 'darwin') app.quit();
});
