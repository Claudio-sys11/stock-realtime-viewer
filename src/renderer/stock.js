'use strict';

const params = new URLSearchParams(location.search);
const SYMBOL = params.get('symbol');
const NAME = params.get('name') || SYMBOL;

const $ = (s) => document.querySelector(s);
const fmt = (n) => Number(n).toLocaleString('ko-KR');

$('#nm').textContent = NAME;
$('#cd').textContent = ` ${SYMBOL}`;
document.title = `${NAME} (${SYMBOL})`;

// ---------------- 차트 ----------------
const chartEl = $('#chart');
const chart = LightweightCharts.createChart(chartEl, {
  layout: { background: { color: '#0e1116' }, textColor: '#8b949e' },
  grid: { vertLines: { color: '#1c232c' }, horzLines: { color: '#1c232c' } },
  rightPriceScale: { borderColor: '#2a323d' },
  timeScale: { borderColor: '#2a323d' },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: '#f23645', downColor: '#2962ff',
  borderUpColor: '#f23645', borderDownColor: '#2962ff',
  wickUpColor: '#f23645', wickDownColor: '#2962ff',
});
const volumeSeries = chart.addHistogramSeries({
  priceFormat: { type: 'volume' },
  priceScaleId: '',
});
volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

let lastCandle = null;

function resize() {
  chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
}
window.addEventListener('resize', resize);

async function loadChart(period) {
  const res = await window.api.getDailyChart(SYMBOL, period);
  if (!res.ok) {
    console.error(res.error);
    return;
  }
  const candles = res.candles.map((c) => ({
    time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
  }));
  const volumes = res.candles.map((c) => ({
    time: c.time, value: c.volume,
    color: c.close >= c.open ? 'rgba(242,54,69,.5)' : 'rgba(41,98,255,.5)',
  }));
  candleSeries.setData(candles);
  volumeSeries.setData(volumes);
  lastCandle = candles[candles.length - 1] || null;
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

// ---------------- 현재가 헤더 ----------------
function setPrice(price, change, rate) {
  const cls = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const sign = change > 0 ? '▲' : change < 0 ? '▼' : '-';
  $('#pr').className = `pr ${cls}`;
  $('#pr').textContent = fmt(price);
  $('#rt').className = `rate ${cls}`;
  $('#rt').textContent = `${sign} ${fmt(Math.abs(change))} (${rate}%)`;
}

// ---------------- 실시간(폴링) 수신 ----------------
window.api.onRealtime(({ symbol, type, payload }) => {
  if (symbol !== SYMBOL || type !== 'trade') return;
  setPrice(payload.price, payload.change, payload.changeRate);
  // 마지막 봉을 현재가로 갱신
  if (lastCandle) {
    lastCandle = {
      time: lastCandle.time,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, payload.price),
      low: Math.min(lastCandle.low, payload.price),
      close: payload.price,
    };
    candleSeries.update(lastCandle);
  }
});

// ---------------- 초기화 ----------------
(async function init() {
  await loadChart('D');
  const q = await window.api.getQuote(SYMBOL);
  if (q.ok) setPrice(q.quote.price, q.quote.change, q.quote.changeRate);
  await window.api.subscribe(SYMBOL);
})();
