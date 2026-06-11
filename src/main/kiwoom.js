'use strict';

const WebSocket = require('ws');

/**
 * 키움증권 REST API 클라이언트 (신규 REST/WebSocket API, api.kiwoom.com)
 * - 옛 OpenAPI+(32bit OCX)가 아니라 2024년 이후의 REST API 기준이다.
 * - REST: 접근토큰 발급, 일/주/월봉 차트, 주식기본정보(현재가/종목명)
 * - WebSocket: 실시간 체결(0B)/호가(0D)
 *
 * 참고: https://openapi.kiwoom.com/ (REST API 문서)
 * 응답 필드/FID는 키움 명세를 따른다. 명세가 바뀌면 이 파일의 매핑만 손보면 된다.
 */

const REST_HOST = {
  real: 'https://api.kiwoom.com',
  mock: 'https://mockapi.kiwoom.com',
};

const WS_URL = {
  real: 'wss://api.kiwoom.com:10000/api/dostk/websocket',
  mock: 'wss://mockapi.kiwoom.com:10000/api/dostk/websocket',
};

// 기간 → 차트 TR (api-id) 및 응답 배열 키 후보
const CHART_TR = {
  D: 'ka10081', // 주식일봉차트조회
  W: 'ka10082', // 주식주봉차트조회
  M: 'ka10083', // 주식월봉차트조회
};

function num(v) {
  // 키움 값은 문자열이며 +/- 부호가 붙을 수 있다. 절대값 숫자로 변환.
  if (v == null) return 0;
  const n = Number(String(v).replace(/[+\s,]/g, ''));
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function signed(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[+\s,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

class KiwoomClient {
  constructor(config) {
    this.setConfig(config);
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  setConfig(config) {
    this.appKey = (config.appKey || '').trim();
    this.appSecret = (config.appSecret || '').trim();
    this.mock = !!config.mock;
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  get restHost() {
    return this.mock ? REST_HOST.mock : REST_HOST.real;
  }
  get wsUrl() {
    return this.mock ? WS_URL.mock : WS_URL.real;
  }
  isConfigured() {
    return this.appKey.length > 0 && this.appSecret.length > 0;
  }

  /** 접근토큰 발급 */
  async getAccessToken() {
    const now = Date.now();
    if (this._token && now < this._tokenExpiresAt - 60_000) return this._token;

    const res = await fetch(`${this.restHost}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: this.appKey,
        secretkey: this.appSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`토큰 발급 실패 (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    const token = data.token || data.access_token;
    if (!token) throw new Error(`토큰 발급 응답 오류: ${JSON.stringify(data)}`);
    this._token = token;
    // expires_dt: YYYYMMDDHHMMSS → 타임스탬프. 실패 시 6시간 캐시.
    this._tokenExpiresAt = this._parseExpiry(data.expires_dt) || now + 6 * 3600_000;
    return token;
  }

  _parseExpiry(s) {
    if (!s || String(s).length < 14) return 0;
    const t = String(s);
    const d = new Date(
      Number(t.slice(0, 4)),
      Number(t.slice(4, 6)) - 1,
      Number(t.slice(6, 8)),
      Number(t.slice(8, 10)),
      Number(t.slice(10, 12)),
      Number(t.slice(12, 14))
    );
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  /** 공통 POST 요청 (api-id 헤더로 TR 지정) */
  async _post(endpoint, apiId, body) {
    const token = await this.getAccessToken();
    const res = await fetch(`${this.restHost}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        authorization: `Bearer ${token}`,
        'api-id': apiId,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${apiId} 요청 실패 (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    if (data.return_code != null && Number(data.return_code) !== 0) {
      throw new Error(`${apiId} 오류: ${data.return_msg || JSON.stringify(data)}`);
    }
    return data;
  }

  /**
   * 일/주/월봉 차트
   * @returns {Promise<Array<{time,open,high,low,close,volume}>>}
   */
  async getDailyChart(symbol, period = 'D') {
    const apiId = CHART_TR[period] || CHART_TR.D;
    const today = this._yyyymmdd(new Date());
    const data = await this._post('/api/dostk/chart', apiId, {
      stk_cd: symbol,
      base_dt: today,
      upd_stkpc_tp: '1', // 수정주가 적용
    });
    // 응답에서 일자(dt)를 가진 차트 배열을 찾는다 (TR마다 키 이름이 달라 견고하게 탐색)
    const rows = this._findChartArray(data);
    return rows
      .filter((r) => r.dt)
      .map((r) => ({
        time: this._toIsoDate(r.dt),
        open: num(r.open_pric),
        high: num(r.high_pric),
        low: num(r.low_pric),
        close: num(r.cur_prc),
        volume: num(r.trde_qty),
      }))
      .sort((a, b) => (a.time < b.time ? -1 : 1)); // 과거→현재
  }

  _findChartArray(data) {
    for (const key of Object.keys(data)) {
      const v = data[key];
      if (Array.isArray(v) && v.length && v[0] && v[0].dt != null) return v;
    }
    return [];
  }

  /** 주식기본정보 (종목명/현재가/등락) */
  async getQuote(symbol) {
    const data = await this._post('/api/dostk/stkinfo', 'ka10001', {
      stk_cd: symbol,
    });
    // 전일대비기호(pred_pre_sig): 1상한 2상승 3보합 4하한 5하락 → 4/5 음수
    const sig = String(data.pred_pre_sig || '');
    const sign = sig === '4' || sig === '5' ? -1 : 1;
    return {
      symbol,
      name: data.stk_nm || symbol,
      price: num(data.cur_prc),
      change: sign * num(data.pred_pre),
      changeRate: sign * Math.abs(signed(data.flu_rt)),
    };
  }

  _yyyymmdd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  _toIsoDate(yyyymmdd) {
    const s = String(yyyymmdd);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
}

/**
 * 키움 실시간 WebSocket 매니저
 * - LOGIN(토큰) → REG(체결 0B + 호가 0D) → REAL 수신 → REMOVE 해제
 * - onData(symbol, 'trade'|'orderbook', payload)로 KIS와 동일한 형태로 정규화해 전달
 */
const REAL_TYPE = { TRADE: '0B', ORDERBOOK: '0D' };

class KiwoomRealtime {
  constructor({ client, onData, onStatus }) {
    this.client = client;
    this.onData = onData;
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.connecting = false;
    this.loggedIn = false;
    this.subs = new Map(); // symbol → refCount
    this.reconnectTimer = null;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.loggedIn) return;
    if (this.connecting) return;
    this.connecting = true;
    try {
      const token = await this.client.getAccessToken();
      const url = this.client.wsUrl;
      this.onStatus('connecting', url);
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        this.ws = ws;
        let settled = false;
        ws.on('open', () => {
          ws.send(JSON.stringify({ trnm: 'LOGIN', token }));
        });
        ws.on('message', (buf) => {
          const handledLogin = this._onMessage(buf.toString());
          if (handledLogin && !settled) {
            settled = true;
            this.connecting = false;
            this.loggedIn = true;
            this.onStatus('connected');
            // 재연결 시 기존 구독 복구
            for (const symbol of this.subs.keys()) this._sendReg(symbol);
            resolve();
          }
        });
        ws.on('close', () => {
          this.loggedIn = false;
          this.onStatus('disconnected');
          this._scheduleReconnect();
        });
        ws.on('error', (err) => {
          this.connecting = false;
          this.onStatus('error', err.message);
          if (!settled) reject(err);
        });
      });
    } catch (e) {
      this.connecting = false;
      this._scheduleReconnect();
      throw e;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.subs.size === 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, 3000);
  }

  async subscribe(symbol) {
    const cur = this.subs.get(symbol) || 0;
    this.subs.set(symbol, cur + 1);
    await this.connect();
    if (cur === 0) this._sendReg(symbol);
  }

  unsubscribe(symbol) {
    const cur = this.subs.get(symbol) || 0;
    if (cur <= 1) {
      this.subs.delete(symbol);
      if (cur === 1) this._sendRemove(symbol);
    } else {
      this.subs.set(symbol, cur - 1);
    }
  }

  _sendReg(symbol) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        trnm: 'REG',
        grp_no: '1',
        refresh: '1', // 기존 등록 유지하며 추가
        data: [{ item: [symbol], type: [REAL_TYPE.TRADE, REAL_TYPE.ORDERBOOK] }],
      })
    );
  }

  _sendRemove(symbol) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        trnm: 'REMOVE',
        grp_no: '1',
        data: [{ item: [symbol], type: [REAL_TYPE.TRADE, REAL_TYPE.ORDERBOOK] }],
      })
    );
  }

  /** @returns {boolean} LOGIN 성공 메시지를 처리했으면 true */
  _onMessage(msg) {
    let obj;
    try {
      obj = JSON.parse(msg);
    } catch (_) {
      return false;
    }
    switch (obj.trnm) {
      case 'PING':
        // 받은 그대로 되돌려 연결 유지
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(msg);
        return false;
      case 'LOGIN':
        if (Number(obj.return_code) !== 0) {
          this.onStatus('error', obj.return_msg || '로그인 실패');
          return false;
        }
        return true;
      case 'REAL':
        for (const rec of obj.data || []) this._handleReal(rec);
        return false;
      default:
        return false;
    }
  }

  _handleReal(rec) {
    const symbol = rec.item;
    const v = rec.values || {};
    if (rec.type === REAL_TYPE.TRADE) {
      // 전일대비기호(25): 1상한 2상승 3보합 4하한 5하락
      const sig = String(v['25'] || '');
      const sign = sig === '4' || sig === '5' ? -1 : 1;
      this.onData(symbol, 'trade', {
        time: v['20'] || '',
        price: num(v['10']),
        change: sign * num(v['11']),
        changeRate: sign * Math.abs(signed(v['12'])),
        open: num(v['16']),
        high: num(v['17']),
        low: num(v['18']),
        tradeVolume: num(v['15']),
        volume: num(v['13']),
      });
    } else if (rec.type === REAL_TYPE.ORDERBOOK) {
      const asks = [];
      const bids = [];
      for (let i = 0; i < 10; i++) {
        asks.push({ price: num(v[String(41 + i)]), qty: num(v[String(61 + i)]) });
        bids.push({ price: num(v[String(51 + i)]), qty: num(v[String(71 + i)]) });
      }
      this.onData(symbol, 'orderbook', {
        time: v['21'] || '',
        asks, // 매도호가 1(최우선)~10
        bids, // 매수호가 1(최우선)~10
        totalAskQty: num(v['121']),
        totalBidQty: num(v['125']),
      });
    }
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.subs.clear();
    this.loggedIn = false;
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}

module.exports = { KiwoomClient, KiwoomRealtime, REST_HOST, WS_URL };
