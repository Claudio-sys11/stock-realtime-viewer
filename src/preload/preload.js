'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 렌더러(웹페이지)에 노출되는 안전한 API.
 * nodeIntegration 없이 IPC만 통과시킨다.
 */
contextBridge.exposeInMainWorld('api', {
  // 설정
  getConfig: () => ipcRenderer.invoke('config:get'),
  setCredentials: (creds) => ipcRenderer.invoke('config:setCredentials', creds),

  // 종목 검색 (이름/코드)
  searchStocks: (query) => ipcRenderer.invoke('stocks:search', query),

  // 관심종목
  addWatch: (symbol) => ipcRenderer.invoke('watchlist:add', symbol),
  removeWatch: (symbol) => ipcRenderer.invoke('watchlist:remove', symbol),

  // 창
  openStockWindow: (symbol, name) =>
    ipcRenderer.invoke('window:openStock', { symbol, name }),

  // 데이터
  getDailyChart: (symbol, period) =>
    ipcRenderer.invoke('chart:daily', { symbol, period }),
  getQuote: (symbol) => ipcRenderer.invoke('quote:get', symbol),

  // 실시간
  subscribe: (symbol) => ipcRenderer.invoke('realtime:subscribe', symbol),
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

  getVersion: () => ipcRenderer.invoke('app:version'),
});
