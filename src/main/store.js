'use strict';

const fs = require('fs');
const path = require('path');

/**
 * userData 폴더에 JSON 한 개로 설정을 보관하는 초경량 저장소.
 * 증권사별 자격증명을 분리 보관한다.
 *
 * 구조:
 * {
 *   broker: 'kis' | 'kiwoom',
 *   brokers: {
 *     kis:    { appKey, appSecret, mock },
 *     kiwoom: { appKey, appSecret, mock }
 *   },
 *   watchlist: [{ symbol, name }]
 * }
 */
function emptyCreds() {
  return { appKey: '', appSecret: '', mock: false };
}

class Store {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, 'config.json');
    this.data = this._migrate(this._load());
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    } catch (_) {
      return {};
    }
  }

  /** 구버전(플랫 appKey/appSecret) → 신버전(brokers) 마이그레이션 */
  _migrate(data) {
    const out = {
      broker: data.broker || 'kis',
      brokers: data.brokers || {},
      watchlist: data.watchlist || [],
    };
    if (!out.brokers.kis) out.brokers.kis = emptyCreds();
    if (!out.brokers.kiwoom) out.brokers.kiwoom = emptyCreds();
    // 예전 플랫 필드가 있으면 KIS 자격증명으로 이전
    if (data.appKey || data.appSecret) {
      out.brokers.kis = {
        appKey: data.appKey || '',
        appSecret: data.appSecret || '',
        mock: !!data.mock,
      };
    }
    return out;
  }

  _save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('설정 저장 실패:', e);
    }
  }

  getBroker() {
    return this.data.broker || 'kis';
  }

  setBroker(broker) {
    this.data.broker = broker;
    this._save();
  }

  getCreds(broker) {
    return { ...emptyCreds(), ...(this.data.brokers[broker] || {}) };
  }

  /** 특정 증권사 자격증명 저장 + 해당 증권사를 활성으로 전환 */
  setCredentials(broker, { appKey, appSecret, mock }) {
    this.data.brokers[broker] = {
      appKey: appKey || '',
      appSecret: appSecret || '',
      mock: !!mock,
    };
    this.data.broker = broker;
    this._save();
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
