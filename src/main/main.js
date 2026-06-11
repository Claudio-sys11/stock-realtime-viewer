'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

// 실시간 폴링 구독: symbol → 참조 수
const subs = new Map();
let pollTimer = null;
const POLL_INTERVAL = 4000; // ms

function createMainWindow() {
  mainWindow = new BrowserWindow({
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
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** 종목 차트 창 열기 (이미 있으면 포커스) */
function openStockWindow(symbol, name) {
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
    title: `${name || symbol} (${symbol})`,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const url = new URL(`file://${path.join(__dirname, '..', 'renderer', 'stock.html')}`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('name', name || symbol);
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

function subscribe(symbol) {
  subs.set(symbol, (subs.get(symbol) || 0) + 1);
  startPolling();
}

function unsubscribe(symbol) {
  const cur = subs.get(symbol) || 0;
  if (cur <= 1) subs.delete(symbol);
  else subs.set(symbol, cur - 1);
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
  try {
    const list = await naver.pollMany(symbols);
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

  ipcMain.handle('watchlist:add', async (_e, symbol) => {
    symbol = String(symbol).trim();
    if (!/^\d{6}$/.test(symbol)) {
      return { ok: false, error: '종목코드는 6자리 숫자입니다.' };
    }
    try {
      const quote = await naver.getQuote(symbol);
      store.addToWatchlist({ symbol, name: quote.name });
      return { ok: true, item: { symbol, name: quote.name }, quote };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('watchlist:remove', (_e, symbol) => {
    store.removeFromWatchlist(symbol);
    return { ok: true };
  });

  ipcMain.handle('window:openStock', (_e, { symbol, name }) => {
    openStockWindow(symbol, name);
    return { ok: true };
  });

  ipcMain.handle('chart:daily', async (_e, { symbol, period }) => {
    try {
      const candles = await naver.getDailyChart(symbol, period || 'D');
      return { ok: true, candles };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('quote:get', async (_e, symbol) => {
    try {
      return { ok: true, quote: await naver.getQuote(symbol) };
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

  ipcMain.handle('stocks:search', async (_e, query) => {
    try {
      return { ok: true, results: await naver.search(query) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('realtime:subscribe', (_e, symbol) => {
    subscribe(symbol);
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

function setupAutoUpdater() {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('update', { type: 'available', info });
  });
  autoUpdater.on('download-progress', (p) => {
    if (mainWindow) mainWindow.webContents.send('update', { type: 'progress', percent: p.percent });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    if (mainWindow) mainWindow.webContents.send('update', { type: 'downloaded', info });
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      title: '업데이트 준비 완료',
      message: `새 버전(${info.version})이 다운로드되었습니다. 지금 설치하시겠어요?`,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => {
    console.error('자동 업데이트 오류:', err);
  });
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
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
