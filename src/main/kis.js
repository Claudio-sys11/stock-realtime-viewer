'use strict';

/**
 * 한국투자증권(KIS) Open API 클라이언트
 * - REST: 접근토큰 발급, 일/분봉 차트 조회
 * - WebSocket 접속키(approval_key) 발급
 *
 * 실전계좌/모의계좌 도메인이 다르므로 config.mock 값으로 분기한다.
 * 참고 문서: https://apiportal.koreainvestment.com/
 */

const REST_HOST = {
  real: 'https://openapi.koreainvestment.com:9443',
  mock: 'https://openapivts.koreainvestment.com:29443',
};

const WS_HOST = {
  real: 'ws://ops.koreainvestment.com:21000',
  mock: 'ws://ops.koreainvestment.com:31000',
};

class KisClient {
  /**
   * @param {{appKey:string, appSecret:string, mock?:boolean}} config
   */
  constructor(config) {
    this.setConfig(config);
    this._token = null;
    this._tokenExpiresAt = 0;
    this._approvalKey = null;
  }

  setConfig(config) {
    this.appKey = (config.appKey || '').trim();
    this.appSecret = (config.appSecret || '').trim();
    this.mock = !!config.mock;
    // 설정이 바뀌면 캐시된 토큰 무효화
    this._token = null;
    this._tokenExpiresAt = 0;
    this._approvalKey = null;
  }

  get restHost() {
    return this.mock ? REST_HOST.mock : REST_HOST.real;
  }

  get wsHost() {
    return this.mock ? WS_HOST.mock : WS_HOST.real;
  }

  isConfigured() {
    return this.appKey.length > 0 && this.appSecret.length > 0;
  }

  /** OAuth 접근토큰 발급 (24시간 유효, 1분에 1회 제한) */
  async getAccessToken() {
    const now = Date.now();
    if (this._token && now < this._tokenExpiresAt - 60_000) {
      return this._token;
    }
    const res = await fetch(`${this.restHost}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: this.appKey,
        appsecret: this.appSecret,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`토큰 발급 실패 (${res.status}): ${text}`);
    }
    const data = await res.json();
    if (!data.access_token) {
      throw new Error(`토큰 발급 응답 오류: ${JSON.stringify(data)}`);
    }
    this._token = data.access_token;
    // expires_in(초) 만큼 유효
    this._tokenExpiresAt = now + (Number(data.expires_in || 86400) * 1000);
    return this._token;
  }

  /** 웹소켓 접속키 발급 */
  async getApprovalKey() {
    if (this._approvalKey) return this._approvalKey;
    const res = await fetch(`${this.restHost}/oauth2/Approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: this.appKey,
        secretkey: this.appSecret,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`approval_key 발급 실패 (${res.status}): ${text}`);
    }
    const data = await res.json();
    if (!data.approval_key) {
      throw new Error(`approval_key 응답 오류: ${JSON.stringify(data)}`);
    }
    this._approvalKey = data.approval_key;
    return this._approvalKey;
  }

  /**
   * 일봉 차트 조회 (국내주식기간별시세)
   * @param {string} symbol 종목코드 6자리
   * @param {'D'|'W'|'M'} period
   * @returns {Promise<Array<{time:string, open:number, high:number, low:number, close:number, volume:number}>>}
   */
  async getDailyChart(symbol, period = 'D') {
    const token = await this.getAccessToken();
    const today = this._yyyymmdd(new Date());
    const fromDate = this._yyyymmdd(this._daysAgo(220));
    const url = new URL(
      `${this.restHost}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
    );
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
    url.searchParams.set('FID_INPUT_ISCD', symbol);
    url.searchParams.set('FID_INPUT_DATE_1', fromDate);
    url.searchParams.set('FID_INPUT_DATE_2', today);
    url.searchParams.set('FID_PERIOD_DIV_CODE', period);
    url.searchParams.set('FID_ORG_ADJ_PRC', '0'); // 0: 수정주가

    const res = await fetch(url, {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        appkey: this.appKey,
        appsecret: this.appSecret,
        tr_id: 'FHKST03010100',
        custtype: 'P',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`차트 조회 실패 (${res.status}): ${text}`);
    }
    const data = await res.json();
    const rows = data.output2 || [];
    // 과거→현재 순으로 정렬해서 반환
    return rows
      .filter((r) => r.stck_bsop_date)
      .map((r) => ({
        time: this._toIsoDate(r.stck_bsop_date),
        open: Number(r.stck_oprc),
        high: Number(r.stck_hgpr),
        low: Number(r.stck_lwpr),
        close: Number(r.stck_clpr),
        volume: Number(r.acml_vol),
      }))
      .reverse();
  }

  /** 현재가 스냅샷 (이름/현재가 등) */
  async getQuote(symbol) {
    const token = await this.getAccessToken();
    const url = new URL(
      `${this.restHost}/uapi/domestic-stock/v1/quotations/inquire-price`
    );
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
    url.searchParams.set('FID_INPUT_ISCD', symbol);
    const res = await fetch(url, {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        appkey: this.appKey,
        appsecret: this.appSecret,
        tr_id: 'FHKST01010100',
        custtype: 'P',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`현재가 조회 실패 (${res.status}): ${text}`);
    }
    const data = await res.json();
    const o = data.output || {};
    // prdy_vrss_sign: 1상한 2상승 3보합 4하한 5하락 → 4/5는 음수
    const sign = o.prdy_vrss_sign === '4' || o.prdy_vrss_sign === '5' ? -1 : 1;
    return {
      symbol,
      name: o.hts_kor_isnm || symbol,
      price: Number(o.stck_prpr || 0),
      change: sign * Math.abs(Number(o.prdy_vrss || 0)),
      changeRate: Number(o.prdy_ctrt || 0), // 등락률은 이미 부호 포함
    };
  }

  // ---- 날짜 유틸 ----
  _yyyymmdd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  _toIsoDate(yyyymmdd) {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  }
  _daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }
}

module.exports = { KisClient, WS_HOST, REST_HOST };
