'use strict';

const fs = require('fs');
const path = require('path');

/**
 * userData 폴더에 관심종목 목록만 보관하는 초경량 저장소.
 * (네이버 조회 방식이라 API 키 저장이 필요 없다.)
 */
class Store {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, 'config.json');
    this.data = this._load();
  }

  _load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      return { watchlist: d.watchlist || [] };
    } catch (_) {
      return { watchlist: [] };
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('설정 저장 실패:', e);
    }
  }

  getWatchlist() {
    return this.data.watchlist || [];
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
