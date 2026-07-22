'use strict';
// 브라우저용 네이버 클라이언트 — 모든 요청은 /api/proxy 경유 (CORS 우회)

(function () {
  const PROXY = '/api/proxy?url=';
  async function pJson(url) {
    const r = await fetch(PROXY + encodeURIComponent(url));
    if (!r.ok) throw new Error('요청 실패 ' + r.status);
    return r.json();
  }
  async function pText(url) {
    const r = await fetch(PROXY + encodeURIComponent(url));
    if (!r.ok) throw new Error('요청 실패 ' + r.status);
    return r.text();
  }

  function num(s) {
    if (s == null) return 0;
    const n = Number(String(s).replace(/[,%\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  function toIso(d) {
    const s = String(d);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  function yyyymmdd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  function normalizeItem(item) {
    if (typeof item === 'string') return { symbol: item, market: 'KR', apiCode: item };
    const m = item.market;
    return {
      symbol: item.symbol || item.code,
      market: m === 'US' || m === 'JP' ? m : 'KR',
      apiCode: item.apiCode || item.symbol || item.code,
    };
  }

  const TIMEFRAME = { D: 'day', W: 'week', M: 'month' };
  const WORLD_SCT = { D: 'candleDay', W: 'candleWeek', M: 'candleMonth' };
  const INDEX_DEFS = {
    KOSPI: { name: '코스피', code: 'KOSPI', poll: 'domestic', chart: 'domestic' },
    IXIC: { name: '나스닥', code: '.IXIC', poll: 'worldstock', chart: 'world' },
    SPX: { name: 'S&P500', code: '.INX', poll: 'worldstock', chart: 'world' },
  };

  function parseQuote(x) {
    const rate = num(x.fluctuationsRatio);
    const dir = x.compareToPreviousPrice && (x.compareToPreviousPrice.code === '4' || x.compareToPreviousPrice.code === '5') ? -1 : 1;
    return {
      name: x.stockName || x.indexName,
      price: num(x.closePrice),
      change: num(x.compareToPreviousClosePrice),
      changeRate: rate !== 0 ? dir * Math.abs(rate) : 0,
    };
  }

  async function search(query) {
    query = String(query || '').trim();
    if (!query) return [];
    const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock&st=111`;
    const data = await pJson(url);
    const MK = { KOR: 'KR', USA: 'US', JPN: 'JP' };
    return (data.items || [])
      .filter((it) => (it.nationCode === 'KOR' && /^\d{6}$/.test(it.code)) || it.nationCode === 'USA' || it.nationCode === 'JPN')
      .slice(0, 20)
      .map((it) => ({
        code: it.code,
        name: it.name,
        market: MK[it.nationCode] || 'KR',
        apiCode: it.nationCode === 'KOR' ? it.code : it.reutersCode,
        exchange: it.typeName || '',
      }));
  }

  async function getQuote(item) {
    const { symbol, market, apiCode } = normalizeItem(item);
    const url = market !== 'KR'
      ? 'https://polling.finance.naver.com/api/realtime/worldstock/stock/' + encodeURIComponent(apiCode)
      : 'https://polling.finance.naver.com/api/realtime/domestic/stock/' + apiCode;
    const data = await pJson(url);
    const x = (data.datas || [])[0];
    if (!x) throw new Error('종목 정보를 찾을 수 없습니다.');
    const q = parseQuote(x);
    return { symbol, name: q.name, price: q.price, change: q.change, changeRate: q.changeRate };
  }

  async function pollMany(items) {
    const list = items.map(normalizeItem);
    const kr = list.filter((i) => i.market === 'KR');
    const us = list.filter((i) => i.market !== 'KR');
    const out = [];
    if (kr.length) {
      try {
        const url = 'https://polling.finance.naver.com/api/realtime/domestic/stock/' + kr.map((i) => i.apiCode).join(',');
        const data = await pJson(url);
        for (const x of data.datas || []) {
          const q = parseQuote(x);
          out.push({ symbol: x.itemCode, name: q.name, price: q.price, change: q.change, changeRate: q.changeRate });
        }
      } catch (_) {}
    }
    await Promise.all(us.map(async (i) => {
      try {
        const data = await pJson('https://polling.finance.naver.com/api/realtime/worldstock/stock/' + encodeURIComponent(i.apiCode));
        const x = (data.datas || [])[0];
        if (!x) return;
        const q = parseQuote(x);
        out.push({ symbol: i.symbol, name: q.name, price: q.price, change: q.change, changeRate: q.changeRate });
      } catch (_) {}
    }));
    return out;
  }

  async function getDailyChart(item, period = 'D') {
    const { market, apiCode } = normalizeItem(item);
    if (market !== 'KR') return worldChart(apiCode, period, 'exchangeWorld', 'item');
    const tf = TIMEFRAME[period] || 'day';
    const now = new Date();
    const start = new Date(now);
    if (tf === 'day') start.setDate(start.getDate() - 400);
    else if (tf === 'week') start.setFullYear(start.getFullYear() - 5);
    else start.setFullYear(start.getFullYear() - 20);
    const url = `https://api.finance.naver.com/siseJson.naver?symbol=${apiCode}&requestType=1&startTime=${yyyymmdd(start)}&endTime=${yyyymmdd(now)}&timeframe=${tf}`;
    const text = await pText(url);
    let rows;
    try { rows = JSON.parse(text.replace(/'/g, '"')); } catch (_) { throw new Error('차트 파싱 실패'); }
    return rows.slice(1).filter((r) => Array.isArray(r) && r[0]).map((r) => ({
      time: toIso(r[0]), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]),
    }));
  }

  async function worldChart(code, period, category, infoType) {
    const sct = WORLD_SCT[period] || 'candleDay';
    const url = `https://m.stock.naver.com/front-api/chart/pricesByPeriod?reutersCode=${encodeURIComponent(code)}&category=${category}&chartInfoType=${infoType}&scriptChartType=${sct}`;
    const data = await pJson(url);
    const rows = (data.result && data.result.priceInfos) || [];
    return rows.filter((r) => r.localDate).map((r) => ({
      time: toIso(r.localDate), open: num(r.openPrice), high: num(r.highPrice), low: num(r.lowPrice), close: num(r.closePrice), volume: num(r.accumulatedTradingVolume),
    }));
  }

  async function fetchIndexQuote(key) {
    const d = INDEX_DEFS[key];
    const url = `https://polling.finance.naver.com/api/realtime/${d.poll}/index/` + encodeURIComponent(d.code);
    const data = await pJson(url);
    const x = (data.datas || [])[0] || {};
    const sig = x.compareToPreviousPrice && x.compareToPreviousPrice.code;
    const dir = sig === '4' || sig === '5' ? -1 : 1;
    const rate = num(x.fluctuationsRatio);
    return { key, symbol: key, name: d.name, price: num(x.closePrice), change: num(x.compareToPreviousClosePrice), changeRate: rate !== 0 ? dir * Math.abs(rate) : 0 };
  }

  async function getIndices() {
    return Promise.all(Object.keys(INDEX_DEFS).map(async (key) => {
      try { return await fetchIndexQuote(key); }
      catch (_) { return { key, symbol: key, name: INDEX_DEFS[key].name, price: 0, change: 0, changeRate: 0, error: true }; }
    }));
  }

  async function getIndexQuote(key) { return fetchIndexQuote(key); }

  async function getIndexChart(key, period = 'D') {
    const d = INDEX_DEFS[key];
    if (d.chart === 'domestic') return getDailyChart(d.code, period);
    return worldChart(d.code, period, 'major', 'index');
  }

  async function getUsdKrw() {
    const url = 'https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW';
    const data = await pJson(url);
    const r = data.result || {};
    const rate = num(r.calcPrice != null ? r.calcPrice : r.closePrice);
    if (!rate) throw new Error('환율 값을 찾을 수 없습니다.');
    return rate;
  }

  async function getJpyKrw() {
    const url = 'https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_JPYKRW';
    const data = await pJson(url);
    const r = data.result || {};
    const per100 = num(r.calcPrice != null ? r.calcPrice : r.closePrice);
    if (!per100) throw new Error('환율 값을 찾을 수 없습니다.');
    return per100 / 100; // 1엔당 원
  }

  window.NV = {
    search, getQuote, pollMany, getDailyChart,
    getIndices, getIndexQuote, getIndexChart, getUsdKrw, getJpyKrw,
    INDEX_DEFS,
  };
})();
