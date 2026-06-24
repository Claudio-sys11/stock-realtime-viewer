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
      return { watchlist: d.watchlist || [], theme: d.theme === 'dark' ? 'dark' : 'light' };
    } catch (_) {
      return { watchlist: [], theme: 'light' }; // 화이트 기본
    }
  }

  getWindowBounds() {
    return this.data.windowBounds || null;
  }

  setWindowBounds(bounds) {
    this.data.windowBounds = bounds;
    this._save();
  }

  getTheme() {
    return this.data.theme || 'light';
  }

  setTheme(theme) {
    this.data.theme = theme === 'dark' ? 'dark' : 'light';
    this._save();
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

  /** 주어진 심볼 순서대로 관심종목 재정렬 */
  reorderWatchlist(symbols) {
    const cur = this.data.watchlist || [];
    const map = new Map(cur.map((x) => [x.symbol, x]));
    const next = [];
    for (const s of symbols) if (map.has(s)) next.push(map.get(s));
    for (const x of cur) if (!symbols.includes(x.symbol)) next.push(x); // 누락 방지
    this.data.watchlist = next;
    this._save();
  }
}

module.exports = { Store };
