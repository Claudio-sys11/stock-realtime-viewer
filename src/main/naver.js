'use strict';

/**
 * 네이버 금융 데이터 클라이언트 (API 키 불필요, 조회 전용)
 * - 차트: api.finance.naver.com/siseJson.naver (일/주/월봉)
 * - 현재가: polling.finance.naver.com (다중 종목 동시 조회)
 * - 검색: ac.stock.naver.com (종목명/코드 자동완성)
 *
 * ⚠️ 네이버의 비공식 엔드포인트이므로 개인용 조회 목적에 한해 사용한다.
 */

const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://finance.naver.com/',
};

const TIMEFRAME = { D: 'day', W: 'week', M: 'month' };

// 지수 정의: poll=실시간 폴링 경로, chart=차트 소스
const INDEX_DEFS = {
  KOSPI: { name: '코스피', code: 'KOSPI', poll: 'domestic', chart: 'domestic' },
  IXIC: { name: '나스닥', code: '.IXIC', poll: 'worldstock', chart: 'world' },
  SPX: { name: 'S&P500', code: '.INX', poll: 'worldstock', chart: 'world' },
};
const WORLD_SCT = { D: 'candleDay', W: 'candleWeek', M: 'candleMonth' };

function num(s) {
  if (s == null) return 0;
  const n = Number(String(s).replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function yyyymmdd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

class NaverClient {
  /** 일/주/월봉 차트 */
  async getDailyChart(symbol, period = 'D') {
    const tf = TIMEFRAME[period] || 'day';
    const now = new Date();
    const start = new Date(now);
    // 기간별로 충분한 과거 데이터 확보
    if (tf === 'day') start.setDate(start.getDate() - 400);
    else if (tf === 'week') start.setFullYear(start.getFullYear() - 5);
    else start.setFullYear(start.getFullYear() - 20);

    const url =
      `https://api.finance.naver.com/siseJson.naver?symbol=${symbol}` +
      `&requestType=1&startTime=${yyyymmdd(start)}&endTime=${yyyymmdd(now)}&timeframe=${tf}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`차트 조회 실패 (${res.status})`);
    const text = await res.text();
    const rows = this._parseSiseJson(text);
    // rows[0]은 헤더, 이후 [날짜, 시가, 고가, 저가, 종가, 거래량, 외국인소진율]
    return rows
      .slice(1)
      .filter((r) => Array.isArray(r) && r[0])
      .map((r) => ({
        time: this._toIso(r[0]),
        open: num(r[1]),
        high: num(r[2]),
        low: num(r[3]),
        close: num(r[4]),
        volume: num(r[5]),
      }));
  }

  _parseSiseJson(text) {
    // 네이버 응답은 작은따옴표를 쓰는 JS 배열 → 큰따옴표로 바꿔 JSON 파싱
    try {
      return JSON.parse(text.replace(/'/g, '"'));
    } catch (_) {
      throw new Error('차트 데이터 파싱 실패');
    }
  }

  _toIso(yyyymmdd) {
    const s = String(yyyymmdd);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  /** 단일 종목 현재가 (이름 포함) */
  async getQuote(symbol) {
    const list = await this.pollMany([symbol]);
    const o = list[0];
    if (!o) throw new Error('종목 정보를 찾을 수 없습니다.');
    return { symbol, name: o.name, price: o.price, change: o.change, changeRate: o.changeRate };
  }

  /** 다중 종목 현재가 (실시간 폴링용) */
  async pollMany(symbols) {
    if (!symbols.length) return [];
    const url =
      'https://polling.finance.naver.com/api/realtime/domestic/stock/' +
      symbols.join(',');
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`시세 조회 실패 (${res.status})`);
    const data = await res.json();
    return (data.datas || []).map((x) => {
      // 전일대비 부호: compareToPreviousClosePrice에 부호 포함("-7,250")
      const change = num(x.compareToPreviousClosePrice);
      const rate = num(x.fluctuationsRatio);
      // 등락 방향 보정 (간혹 부호가 빠지는 값 대비)
      const dir = x.compareToPreviousPrice && (x.compareToPreviousPrice.code === '4' || x.compareToPreviousPrice.code === '5') ? -1 : 1;
      return {
        symbol: x.itemCode,
        name: x.stockName,
        price: num(x.closePrice),
        change: change !== 0 ? change : 0,
        changeRate: rate !== 0 ? dir * Math.abs(rate) : 0,
      };
    });
  }

  /** 주요 지수 (코스피 / 나스닥 / S&P500) 현재가 일괄 */
  async getIndices() {
    return Promise.all(
      Object.keys(INDEX_DEFS).map(async (key) => {
        try {
          return await this._fetchIndexQuote(key);
        } catch (_) {
          const d = INDEX_DEFS[key];
          return { key, symbol: key, name: d.name, price: 0, change: 0, changeRate: 0, error: true };
        }
      })
    );
  }

  /** 단일 지수 현재가 */
  async getIndexQuote(key) {
    return this._fetchIndexQuote(key);
  }

  async _fetchIndexQuote(key) {
    const d = INDEX_DEFS[key];
    if (!d) throw new Error('알 수 없는 지수');
    const url =
      `https://polling.finance.naver.com/api/realtime/${d.poll}/index/` +
      encodeURIComponent(d.code);
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`지수 조회 실패 (${res.status})`);
    const data = await res.json();
    const x = (data.datas || [])[0] || {};
    const sig = x.compareToPreviousPrice && x.compareToPreviousPrice.code;
    const dir = sig === '4' || sig === '5' ? -1 : 1;
    const rate = num(x.fluctuationsRatio);
    return {
      key,
      symbol: key,
      name: d.name,
      price: num(x.closePrice),
      change: num(x.compareToPreviousClosePrice),
      changeRate: rate !== 0 ? dir * Math.abs(rate) : 0,
    };
  }

  /** 지수 차트 (일/주/월) */
  async getIndexChart(key, period = 'D') {
    const d = INDEX_DEFS[key];
    if (!d) throw new Error('알 수 없는 지수');
    // 코스피는 종목과 동일한 siseJson 사용
    if (d.chart === 'domestic') return this.getDailyChart(d.code, period);
    // 해외 지수
    const sct = WORLD_SCT[period] || 'candleDay';
    const url =
      'https://m.stock.naver.com/front-api/chart/pricesByPeriod' +
      `?reutersCode=${encodeURIComponent(d.code)}&category=major&chartInfoType=index&scriptChartType=${sct}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`지수 차트 실패 (${res.status})`);
    const data = await res.json();
    const rows = (data.result && data.result.priceInfos) || [];
    return rows
      .filter((r) => r.localDate)
      .map((r) => ({
        time: this._toIso(r.localDate),
        open: num(r.openPrice),
        high: num(r.highPrice),
        low: num(r.lowPrice),
        close: num(r.closePrice),
        volume: num(r.accumulatedTradingVolume),
      }));
  }

  /** 종목명/코드 검색 */
  async search(query) {
    query = String(query || '').trim();
    if (!query) return [];
    const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock&st=111`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`검색 실패 (${res.status})`);
    const data = await res.json();
    return (data.items || [])
      .filter((it) => it.nationCode === 'KOR' && /^\d{6}$/.test(it.code))
      .slice(0, 20)
      .map((it) => ({ code: it.code, name: it.name, market: it.typeName || '' }));
  }
}

module.exports = { NaverClient };
