# 주식 뷰어 — 아이폰 웹앱 (PWA)

아이폰 Safari에서 접속해 **홈 화면에 추가**하면 앱처럼 쓰는 PWA입니다.
데스크톱 버전과 동일하게 **지수·검색(국내/미국)·관심종목·차트(시작가 기준 색상, 지지선/시작가)·원화 환산**을 제공합니다.

네이버 API는 브라우저 CORS 때문에 **서버리스 프록시(`api/proxy.js`)** 를 거칩니다.

---

## 로컬에서 테스트
```powershell
node webapp/dev-server.js
# 브라우저에서 http://localhost:5180 접속
```

## 배포 (Vercel — 무료, 추천)
이 레포는 이미 GitHub에 있으므로 Vercel에 가져오기만 하면 됩니다.

1. https://vercel.com 가입(깃허브 계정으로 로그인)
2. **Add New → Project → 이 레포(`stock-realtime-viewer`) Import**
3. **Root Directory** 를 **`webapp`** 으로 지정 (중요!)
4. Framework Preset: **Other** (빌드 명령 없음)
5. **Deploy** → 잠시 후 `https://<프로젝트>.vercel.app` 주소 발급

> `webapp/api/proxy.js` 가 자동으로 서버리스 함수(`/api/proxy`)로 배포됩니다.

## 아이폰에 설치
1. 아이폰 **Safari**로 발급된 `https://....vercel.app` 접속
2. 하단 **공유 버튼(￪)** → **"홈 화면에 추가"**
3. 홈 화면에 **주식뷰어** 아이콘 생성 → 앱처럼 실행

## 대안: Cloudflare Pages
- Pages 프로젝트로 `webapp` 폴더 연결, Functions로 `api/proxy` 동작(약간의 설정 차이). Vercel이 가장 간단합니다.

---

## 구조
```
webapp/
├─ index.html / app.css / app.js   # 모바일 UI
├─ naver.js                        # 네이버 클라이언트(프록시 경유)
├─ lib/lightweight-charts.js       # 차트 라이브러리(내장)
├─ api/proxy.js                    # 서버리스 프록시 (네이버 CORS 우회)
├─ manifest.webmanifest / sw.js    # PWA (설치/오프라인 셸)
├─ icons/                          # 앱 아이콘
├─ vercel.json                     # Vercel 설정
└─ dev-server.js                   # 로컬 테스트 서버(정적+프록시)
```

제작: **Claudio Lim**
