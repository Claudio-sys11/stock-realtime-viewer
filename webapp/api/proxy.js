// 네이버 금융 API 프록시 (Vercel 서버리스 함수)
// 브라우저 CORS 우회용. 네이버 호스트만 허용한다.

const ALLOWED = new Set([
  'finance.naver.com',
  'api.finance.naver.com',
  'polling.finance.naver.com',
  'm.stock.naver.com',
  'api.stock.naver.com',
  'ac.stock.naver.com',
]);

export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    res.status(400).json({ error: 'url 파라미터가 필요합니다.' });
    return;
  }
  let u;
  try {
    u = new URL(target);
  } catch (_) {
    res.status(400).json({ error: '잘못된 URL' });
    return;
  }
  if (!ALLOWED.has(u.hostname)) {
    res.status(400).json({ error: '허용되지 않은 호스트' });
    return;
  }
  try {
    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://m.stock.naver.com/',
      },
    });
    const body = await r.text();
    res.setHeader('content-type', r.headers.get('content-type') || 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('access-control-allow-origin', '*');
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: String(e && e.message) });
  }
}
