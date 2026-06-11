'use strict';

const params = new URLSearchParams(location.search);
const SYMBOL = params.get('symbol');
const NAME = params.get('name') || SYMBOL;
const IS_INDEX = params.get('type') === 'index';
const MARKET = params.get('market') === 'US' ? 'US' : 'KR';
const APICODE = params.get('apiCode') || SYMBOL;
const ITEM = { symbol: SYMBOL, market: MARKET, apiCode: APICODE };
const DECIMAL = IS_INDEX || MARKET === 'US'; // 지수·미국주식은 소수점 표시

const $ = (s) => document.querySelector(s);
const fmt = (n) =>
  DECIMAL
    ? Number(n).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Number(n).toLocaleString('ko-KR');
const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

$('#nm').textContent = NAME;
$('#cd').textContent = IS_INDEX ? '' : MARKET === 'US' ? ` ${SYMBOL} · 미국` : ` ${SYMBOL}`;
document.title = IS_INDEX ? NAME : `${NAME} (${SYMBOL})`;

// 네이버 링크: 종목만 Chrome으로 열기 (지수는 숨김)
if (IS_INDEX) {
  $('#naverLink').style.display = 'none';
} else {
  $('#naverLink').addEventListener('click', () => {
    const url =
      MARKET === 'US'
        ? `https://m.stock.naver.com/worldstock/stock/${APICODE}/total`
        : `https://finance.naver.com/item/main.naver?code=${SYMBOL}`;
    window.api.openExternal(url);
  });
}

// ---------------- 차트 ----------------
const chartEl = $('#chart');
const chart = LightweightCharts.createChart(chartEl, {
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

// 시작가를 기준선으로: 위(시작가 초과)=빨강, 아래=파랑
const priceSeries = chart.addBaselineSeries({
  baseValue: { type: 'price', price: 0 },
  lineWidth: 2,
  topLineColor: '#f23645',
  topFillColor1: 'rgba(242,54,69,0.30)',
  topFillColor2: 'rgba(242,54,69,0.03)',
  bottomLineColor: '#2962ff',
  bottomFillColor1: 'rgba(41,98,255,0.03)',
  bottomFillColor2: 'rgba(41,98,255,0.30)',
});
const volumeSeries = chart.addHistogramSeries({
  priceFormat: { type: 'volume' },
  priceScaleId: '',
});
volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

let lastPoint = null; // { time, value }
let startPrice = null; // 시작가(기준선)
let openLine = null;
let supportLine = null;

function applyChartTheme() {
  chart.applyOptions({
    layout: { background: { color: cssVar('--chart-bg') }, textColor: cssVar('--muted') },
    grid: {
      vertLines: { color: cssVar('--chart-grid') },
      horzLines: { color: cssVar('--chart-grid') },
    },
    rightPriceScale: { borderColor: cssVar('--border') },
    timeScale: { borderColor: cssVar('--border') },
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  applyChartTheme();
}

function resize() {
  chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
}
window.addEventListener('resize', resize);

/** 지지선(최근 저점) + 시작가(현재 봉 시가) 수평선 */
function drawLevelLines(candles) {
  if (openLine) { priceSeries.removePriceLine(openLine); openLine = null; }
  if (supportLine) { priceSeries.removePriceLine(supportLine); supportLine = null; }
  if (!candles.length) return;
  const last = candles[candles.length - 1];
  openLine = priceSeries.createPriceLine({
    price: last.open,
    color: '#9aa0a6',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: '시작가',
  });
  const lookback = candles.slice(-20);
  const support = Math.min(...lookback.map((c) => c.low));
  supportLine = priceSeries.createPriceLine({
    price: support,
    color: '#26a69a',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: '지지선',
  });
}

async function loadChart(period) {
  const res = IS_INDEX
    ? await window.api.getIndexChart(SYMBOL, period)
    : await window.api.getDailyChart(ITEM, period);
  if (!res.ok) {
    console.error(res.error);
    return;
  }
  const candles = res.candles;
  const last = candles[candles.length - 1];
  // 시작가 = 현재(마지막) 봉의 시가 → 기준선
  startPrice = last ? last.open : 0;
  priceSeries.applyOptions({ baseValue: { type: 'price', price: startPrice } });

  const line = candles.map((c) => ({ time: c.time, value: c.close }));
  const volumes = candles.map((c) => ({
    time: c.time, value: c.volume,
    color: c.close >= c.open ? 'rgba(242,54,69,.5)' : 'rgba(41,98,255,.5)',
  }));
  priceSeries.setData(line);
  volumeSeries.setData(volumes);
  lastPoint = line[line.length - 1] || null;
  drawLevelLines(candles);
  chart.timeScale().fitContent();
  resize();
}

document.querySelectorAll('.period-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadChart(btn.dataset.p);
  });
});

// ---------------- 현재가 헤더 (시세 강조) ----------------
let lastPrice = null;
function setPrice(price, change, rate) {
  const cls = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const sign = change > 0 ? '▲' : change < 0 ? '▼' : '-';
  const prEl = $('#pr');
  prEl.className = `pr ${cls}`;
  prEl.textContent = fmt(price);
  $('#rt').className = `rate ${cls}`;
  $('#rt').textContent = `${sign} ${fmt(Math.abs(change))} (${rate}%)`;

  if (lastPrice != null && price !== lastPrice) {
    prEl.classList.remove('flash-up', 'flash-down');
    void prEl.offsetWidth;
    prEl.classList.add(price > lastPrice ? 'flash-up' : 'flash-down');
  }
  lastPrice = price;
}

function onTick(price) {
  if (lastPoint) {
    lastPoint = { time: lastPoint.time, value: price };
    priceSeries.update(lastPoint);
  }
}

// ---------------- 실시간 ----------------
if (IS_INDEX) {
  // 지수는 렌더러에서 직접 폴링
  async function pollIndex() {
    const q = await window.api.getIndexQuote(SYMBOL);
    if (q.ok) {
      setPrice(q.quote.price, q.quote.change, q.quote.changeRate);
      onTick(q.quote.price);
    }
  }
  setInterval(pollIndex, 8000);
} else {
  window.api.onRealtime(({ symbol, type, payload }) => {
    if (symbol !== SYMBOL || type !== 'trade') return;
    setPrice(payload.price, payload.change, payload.changeRate);
    onTick(payload.price);
  });
}

// 테마 변경 반영
window.api.onThemeChange((t) => applyTheme(t));

// ---------------- 초기화 ----------------
(async function init() {
  const theme = await window.api.getTheme();
  applyTheme(theme);
  await loadChart('D');
  const q = IS_INDEX
    ? await window.api.getIndexQuote(SYMBOL)
    : await window.api.getQuote(ITEM);
  if (q.ok) setPrice(q.quote.price, q.quote.change, q.quote.changeRate);
  if (!IS_INDEX) await window.api.subscribe(ITEM);
})();
