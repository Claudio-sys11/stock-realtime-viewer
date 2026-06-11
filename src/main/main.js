'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const { KisClient } = require('./kis');
const { RealtimeManager } = require('./ws');
const { Store } = require('./store');

const isDev = process.argv.includes('--dev');

let store;
let kis;
let realtime;
let mainWindow = null;

// 종목별로 열린 차트 창: symbol → BrowserWindow
const stockWindows = new Map();

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 360,
    minHeight: 480,
    title: 'StockViewer — 관심종목',
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

/** 종목 차트/호가 창 열기 (이미 있으면 포커스) */
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
    width: 900,
    height: 680,
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
    if (realtime) realtime.unsubscribe(symbol);
  });
}

/** 실시간 데이터를 해당 종목 창으로 전달 */
function routeRealtime(symbol, type, payload) {
  const win = stockWindows.get(symbol);
  if (win && !win.isDestroyed()) {
    win.webContents.send('realtime', { symbol, type, payload });
  }
  // 관심종목 리스트의 현재가 갱신용으로 메인 창에도 체결가 전달
  if (type === 'trade' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('realtime', { symbol, type, payload });
  }
}

function initServices() {
  store = new Store(app.getPath('userData'));
  kis = new KisClient({
    appKey: store.get('appKey'),
    appSecret: store.get('appSecret'),
    mock: store.get('mock'),
  });
  realtime = new RealtimeManager({
    getApprovalKey: () => kis.getApprovalKey(),
    getWsHost: () => kis.wsHost,
    onData: routeRealtime,
    onStatus: (status, detail) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ws-status', { status, detail });
      }
    },
  });
}

// ---------------- IPC 핸들러 ----------------

function registerIpc() {
  ipcMain.handle('config:get', () => {
    const all = store.getAll();
    // 시크릿은 보유 여부만 노출
    return {
      appKey: all.appKey,
      hasSecret: !!all.appSecret,
      mock: all.mock,
      watchlist: all.watchlist || [],
    };
  });

  ipcMain.handle('config:setCredentials', (_e, creds) => {
    // appSecret이 null/undefined면 기존 시크릿 유지
    const appSecret =
      creds.appSecret == null ? store.get('appSecret') : creds.appSecret;
    store.setCredentials({ appKey: creds.appKey, appSecret, mock: creds.mock });
    kis.setConfig({
      appKey: store.get('appKey'),
      appSecret: store.get('appSecret'),
      mock: store.get('mock'),
    });
    return { ok: true };
  });

  ipcMain.handle('watchlist:add', async (_e, symbol) => {
    symbol = String(symbol).trim();
    if (!/^\d{6}$/.test(symbol)) {
      return { ok: false, error: '종목코드는 6자리 숫자입니다.' };
    }
    try {
      const quote = await kis.getQuote(symbol);
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
      const candles = await kis.getDailyChart(symbol, period || 'D');
      return { ok: true, candles };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('quote:get', async (_e, symbol) => {
    try {
      return { ok: true, quote: await kis.getQuote(symbol) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('realtime:subscribe', async (_e, symbol) => {
    try {
      await realtime.subscribe(symbol);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('realtime:unsubscribe', (_e, symbol) => {
    realtime.unsubscribe(symbol);
    return { ok: true };
  });

  ipcMain.handle('app:version', () => app.getVersion());
}

// ---------------- 자동 업데이트 ----------------

function setupAutoUpdater() {
  if (isDev) return; // 개발 모드에서는 비활성화
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
  initServices();
  registerIpc();
  createMainWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (realtime) realtime.close();
  if (process.platform !== 'darwin') app.quit();
});
