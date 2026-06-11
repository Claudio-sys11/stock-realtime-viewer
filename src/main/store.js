'use strict';

const fs = require('fs');
const path = require('path');

/**
 * userData 폴더에 JSON 한 개로 설정을 보관하는 초경량 저장소.
 * (앱키/시크릿, 모의투자 여부, 관심종목 목록 등)
 */
class Store {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, 'config.json');
    this.data = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    } catch (_) {
      return {
        appKey: '',
        appSecret: '',
        mock: false,
        watchlist: [], // [{symbol, name}]
      };
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('설정 저장 실패:', e);
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  getAll() {
    return { ...this.data };
  }

  setCredentials({ appKey, appSecret, mock }) {
    this.data.appKey = appKey;
    this.data.appSecret = appSecret;
    this.data.mock = !!mock;
    this._save();
  }

  addToWatchlist(item) {
    const list = this.data.watchlist || [];
    if (!list.find((x) => x.symbol === item.symbol)) {
      list.push(item);
      this.data.watchlist = list;
      this._save();
    }
  }

  removeFromWatchlist(symbol) {
    this.data.watchlist = (this.data.watchlist || []).filter(
      (x) => x.symbol !== symbol
    );
    this._save();
  }
}

module.exports = { Store };
