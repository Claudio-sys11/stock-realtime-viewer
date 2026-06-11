'use strict';

const WebSocket = require('ws');

/**
 * KIS 실시간 WebSocket 매니저
 * - 하나의 소켓으로 여러 종목의 호가(H0STASP0)/체결(H0STCNT0)을 구독한다.
 * - 들어온 데이터를 onData(symbol, type, payload) 콜백으로 흘려보낸다.
 *
 * tr_type: '1' 등록 / '2' 해제
 */

const TR = {
  ORDERBOOK: 'H0STASP0', // 실시간 호가
  TRADE: 'H0STCNT0', // 실시간 체결
};

class RealtimeManager {
  /**
   * @param {object} opts
   * @param {() => Promise<string>} opts.getApprovalKey
   * @param {() => string} opts.getWsHost
   * @param {(symbol:string, type:'orderbook'|'trade', payload:object) => void} opts.onData
   * @param {(status:string, detail?:string) => void} [opts.onStatus]
   */
  constructor(opts) {
    this.getApprovalKey = opts.getApprovalKey;
    this.getWsHost = opts.getWsHost;
    this.onData = opts.onData;
    this.onStatus = opts.onStatus || (() => {});
    this.ws = null;
    this.approvalKey = null;
    this.connecting = false;
    // 구독 카운트: key=`${tr_id}:${symbol}` → 참조 수
    this.subs = new Map();
    this.reconnectTimer = null;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) return;
    this.connecting = true;
    try {
      this.approvalKey = await this.getApprovalKey();
      const host = this.getWsHost();
      this.onStatus('connecting', host);
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(host);
        this.ws = ws;
        ws.on('open', () => {
          this.connecting = false;
          this.onStatus('connected');
          // 재연결 시 기존 구독 복구
          for (const key of this.subs.keys()) {
            const [trId, symbol] = key.split(':');
            this._send(trId, symbol, '1');
          }
          resolve();
        });
        ws.on('message', (buf) => this._onMessage(buf.toString()));
        ws.on('close', () => {
          this.onStatus('disconnected');
          this._scheduleReconnect();
        });
        ws.on('error', (err) => {
          this.onStatus('error', err.message);
          this.connecting = false;
          reject(err);
        });
      });
    } catch (e) {
      this.connecting = false;
      this._scheduleReconnect();
      throw e;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.subs.size === 0) return; // 구독 없으면 재연결 불필요
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, 3000);
  }

  /** 종목 구독 (호가 + 체결 동시) */
  async subscribe(symbol) {
    await this.connect();
    this._ref(TR.ORDERBOOK, symbol, +1);
    this._ref(TR.TRADE, symbol, +1);
  }

  /** 종목 구독 해제 */
  unsubscribe(symbol) {
    this._ref(TR.ORDERBOOK, symbol, -1);
    this._ref(TR.TRADE, symbol, -1);
  }

  _ref(trId, symbol, delta) {
    const key = `${trId}:${symbol}`;
    const cur = this.subs.get(key) || 0;
    const next = cur + delta;
    if (next <= 0) {
      this.subs.delete(key);
      if (cur > 0) this._send(trId, symbol, '2'); // 실제로 등록돼 있던 것만 해제
    } else {
      this.subs.set(key, next);
      if (cur === 0) this._send(trId, symbol, '1'); // 처음 등록될 때만 전송
    }
  }

  _send(trId, symbol, trType) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const frame = {
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: trType,
        'content-type': 'utf-8',
      },
      body: { input: { tr_id: trId, tr_key: symbol } },
    };
    this.ws.send(JSON.stringify(frame));
  }

  _onMessage(msg) {
    // 제어 메시지(JSON): PINGPONG, 구독 결과 등
    if (msg[0] === '{') {
      try {
        const obj = JSON.parse(msg);
        const trId = obj.header && obj.header.tr_id;
        if (trId === 'PINGPONG') {
          // 받은 그대로 되돌려 보내 연결 유지
          this.ws.send(msg);
        }
      } catch (_) {
        /* ignore */
      }
      return;
    }

    // 실시간 데이터: `암호화여부|tr_id|건수|본문`
    const head = msg.split('|', 3);
    if (head.length < 3) return;
    const trId = head[1];
    const count = Number(head[2]) || 1;
    const bodyStart = msg.indexOf('|', msg.indexOf('|', msg.indexOf('|') + 1) + 1) + 1;
    const body = msg.slice(bodyStart);
    const fields = body.split('^');

    if (trId === TR.TRADE) {
      this._parseTrades(fields, count);
    } else if (trId === TR.ORDERBOOK) {
      this._parseOrderbook(fields);
    }
  }

  _parseTrades(fields, count) {
    const FIELD_COUNT = 46; // 체결 레코드 1건당 필드 수
    for (let i = 0; i < count; i++) {
      const f = fields.slice(i * FIELD_COUNT);
      if (f.length < 14) break;
      const symbol = f[0];
      // 부호코드: 1상한 2상승 3보합 4하한 5하락 → 4/5는 음수
      const sign = f[3] === '4' || f[3] === '5' ? -1 : 1;
      const payload = {
        time: f[1], // HHMMSS
        price: Number(f[2]),
        changeSign: f[3],
        change: sign * Math.abs(Number(f[4])),
        changeRate: Number(f[5]), // 등락률은 이미 부호 포함
        open: Number(f[7]),
        high: Number(f[8]),
        low: Number(f[9]),
        tradeVolume: Number(f[12]),
        volume: Number(f[13]),
      };
      this.onData(symbol, 'trade', payload);
    }
  }

  _parseOrderbook(f) {
    if (f.length < 43) return;
    const symbol = f[0];
    const asks = [];
    const bids = [];
    for (let i = 0; i < 10; i++) {
      asks.push({ price: Number(f[3 + i]), qty: Number(f[23 + i]) });
      bids.push({ price: Number(f[13 + i]), qty: Number(f[33 + i]) });
    }
    const payload = {
      time: f[1],
      asks, // 매도호가 1~10 (낮은가→높은가)
      bids, // 매수호가 1~10 (높은가→낮은가)
      totalAskQty: Number(f[43]),
      totalBidQty: Number(f[44]),
    };
    this.onData(symbol, 'orderbook', payload);
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.subs.clear();
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}

module.exports = { RealtimeManager, TR };
