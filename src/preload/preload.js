'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 렌더러(웹페이지)에 노출되는 안전한 API.
 * nodeIntegration 없이 IPC만 통과시킨다.
 */
contextBridge.exposeInMainWorld('api', {
  // 종목 검색 (이름/코드)
  searchStocks: (query) => ipcRenderer.invoke('stocks:search', query),

  // 환율 (USD→KRW)
  getUsdKrw: () => ipcRenderer.invoke('fx:usdkrw'),

  // 주요 지수 (코스피/나스닥/S&P500)
  getIndices: () => ipcRenderer.invoke('indices:get'),
  getIndexChart: (key, period) => ipcRenderer.invoke('indexChart:get', { key, period }),
  getIndexQuote: (key) => ipcRenderer.invoke('indexQuote:get', key),

  // 관심종목
  getWatchlist: () => ipcRenderer.invoke('watchlist:get'),
  addWatch: (input) => ipcRenderer.invoke('watchlist:add', input),
  removeWatch: (symbol) => ipcRenderer.invoke('watchlist:remove', symbol),

  // 창 (item: {symbol, name, type, market, apiCode})
  openStockWindow: (symbol, name, type, market, apiCode) =>
    ipcRenderer.invoke('window:openStock', { symbol, name, type, market, apiCode }),

  // 데이터 (item: {symbol, market, apiCode})
  getDailyChart: (item, period) =>
    ipcRenderer.invoke('chart:daily', { ...item, period }),
  getQuote: (item) => ipcRenderer.invoke('quote:get', item),

  // 실시간(폴링) (item: {symbol, market, apiCode})
  subscribe: (item) => ipcRenderer.invoke('realtime:subscribe', item),
  unsubscribe: (symbol) => ipcRenderer.invoke('realtime:unsubscribe', symbol),
  onRealtime: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('realtime', handler);
    return () => ipcRenderer.removeListener('realtime', handler);
  },
  onWsStatus: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('ws-status', handler);
    return () => ipcRenderer.removeListener('ws-status', handler);
  },
  onUpdate: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('update', handler);
    return () => ipcRenderer.removeListener('update', handler);
  },

  // 외부 링크 (Chrome으로 열기)
  openExternal: (url) => ipcRenderer.invoke('link:open', url),

  // 테마 (light/dark)
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onThemeChange: (cb) => {
    const handler = (_e, theme) => cb(theme);
    ipcRenderer.on('theme', handler);
    return () => ipcRenderer.removeListener('theme', handler);
  },

  getVersion: () => ipcRenderer.invoke('app:version'),
});
