'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const { Provider, BROKERS } = require('./provider');
const { Store } = require('./store');

const isDev = process.argv.includes('--dev');

let store;
let provider;
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

function buildRealtime() {
  return provider.createRealtime({
    onData: routeRealtime,
    onStatus: (status, detail) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ws-status', { status, detail });
      }
    },
  });
}

function initServices() {
  store = new Store(app.getPath('userData'));
  const broker = store.getBroker();
  provider = new Provider(broker, store.getCreds(broker));
  realtime = buildRealtime();
}

/** 증권사/자격증명 변경 후 provider·실시간 재구성 + 기존 구독 복구 */
async function rebuildProvider() {
  if (realtime) realtime.close();
  const broker = store.getBroker();
  provider = new Provider(broker, store.getCreds(broker));
  realtime = buildRealtime();
  // 관심종목 + 열린 차트창의 합집합을 새 증권사로 재구독
  const symbols = new Set([
    ...store.getWatchlist().map((x) => x.symbol),
    ...stockWindows.keys(),
  ]);
  for (const symbol of symbols) {
    try {
      await realtime.subscribe(symbol);
    } catch (_) {
      /* 자격증명 미입력 등은 조용히 무시 */
    }
  }
}

// ---------------- IPC 핸들러 ----------------

function registerIpc() {
  ipcMain.handle('config:get', () => {
    // 증권사별 자격증명(시크릿은 보유 여부만 노출)
    const brokers = {};
    for (const b of BROKERS) {
      const c = store.getCreds(b.id);
      brokers[b.id] = { appKey: c.appKey, hasSecret: !!c.appSecret, mock: c.mock };
    }
    return {
      broker: store.getBroker(),
      brokerList: BROKERS,
      brokers,
      watchlist: store.getWatchlist(),
    };
  });

  ipcMain.handle('config:setCredentials', async (_e, creds) => {
    const broker = BROKERS.some((b) => b.id === creds.broker) ? creds.broker : 'kis';
    // appSecret이 null/undefined면 기존 시크릿 유지
    const prev = store.getCreds(broker);
    const appSecret = creds.appSecret == null ? prev.appSecret : creds.appSecret;
    store.setCredentials(broker, {
      appKey: creds.appKey,
      appSecret,
      mock: creds.mock,
    });
    await rebuildProvider();
    return { ok: true };
  });

  ipcMain.handle('watchlist:add', async (_e, symbol) => {
    symbol = String(symbol).trim();
    if (!/^\d{6}$/.test(symbol)) {
      return { ok: false, error: '종목코드는 6자리 숫자입니다.' };
    }
    try {
      const quote = await provider.getQuote(symbol);
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
      const candles = await provider.getDailyChart(symbol, period || 'D');
      return { ok: true, candles };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('quote:get', async (_e, symbol) => {
    try {
      return { ok: true, quote: await provider.getQuote(symbol) };
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
