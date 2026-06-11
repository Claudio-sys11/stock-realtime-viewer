'use strict';

const { KisClient } = require('./kis');
const { RealtimeManager: KisRealtime } = require('./ws');
const { KiwoomClient, KiwoomRealtime } = require('./kiwoom');

/**
 * 증권사 어댑터 통합 레이어.
 * main.js는 이 Provider 하나만 보고 동작하며, 내부에서 KIS/키움 구현을 선택한다.
 *
 * 모든 증권사 구현은 동일한 형태의 데이터를 돌려준다:
 *  - getQuote(symbol)      → { symbol, name, price, change, changeRate }
 *  - getDailyChart(s, p)   → [{ time, open, high, low, close, volume }]
 *  - 실시간 onData(symbol, 'trade'|'orderbook', payload) (KIS/키움 동일 스키마)
 */

const BROKERS = [
  { id: 'kis', label: '한국투자증권 (KIS)' },
  { id: 'kiwoom', label: '키움증권 (REST API)' },
];

class Provider {
  constructor(broker, creds) {
    this.setConfig(broker, creds);
  }

  setConfig(broker, creds) {
    this.broker = BROKERS.some((b) => b.id === broker) ? broker : 'kis';
    this.creds = creds || {};
    if (this.broker === 'kiwoom') {
      this.client = new KiwoomClient(this.creds);
    } else {
      this.client = new KisClient(this.creds);
    }
  }

  isConfigured() {
    return this.client.isConfigured();
  }

  getQuote(symbol) {
    return this.client.getQuote(symbol);
  }

  getDailyChart(symbol, period) {
    return this.client.getDailyChart(symbol, period);
  }

  /** 현재 증권사에 맞는 실시간 매니저 생성 */
  createRealtime({ onData, onStatus }) {
    if (this.broker === 'kiwoom') {
      return new KiwoomRealtime({ client: this.client, onData, onStatus });
    }
    return new KisRealtime({
      getApprovalKey: () => this.client.getApprovalKey(),
      getWsHost: () => this.client.wsHost,
      onData,
      onStatus,
    });
  }
}

module.exports = { Provider, BROKERS };
