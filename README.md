# 주식 뷰어 (StockViewer)

네이버 금융 시세로 국내 주식의 **차트와 현재가**를 보여주는 Windows 데스크톱 앱입니다.
**API 키가 필요 없고**, 종목을 검색해 관심종목에 추가하면 **새 창**으로 차트가 열립니다.
**GitHub Releases로 자동 업데이트**됩니다. 제작: **Claudio Lim**

## 주요 기능
- **상단 지수 바**: 코스피 / 나스닥 / S&P500 실시간 + **미니차트(시작가 기준 색상)** — 클릭 시 지수 차트 창
- **현재 시간(한국시간)** 상단 표시
- **장 운영시간**: 각 지수 아래에 장시작·마감 + 전·후 경과(시작 전=빨강/후=파랑, 시작 전엔 마감 숨김). **코스피는 KRX·NXT 따로 표시**
- **차트 색상**: 시작가 기준 위=빨강 / 아래=파랑 — 종목 차트 **및 관심종목 미니차트**에 적용
- **차트 보조선**: 차트에 **지지선**(최근 저점) + **시작가**(현재 봉 시가) 표시
- 자동 업데이트는 **이전 버전을 정리하고 최신 버전으로 설치**(NSIS 클린 설치)
- **종목 검색**: 종목명(예: 삼성전자) 또는 코드(예: 005930)로 검색해 선택
- 관심종목 리스트 + 실시간(폴링) 현재가 + **항목별 미니차트(스파크라인)**
- **시세 변경 시 금액 강조**(상승=빨강/하락=파랑 깜빡임)
- **테마 선택**(화이트/블랙, 화이트 기본) — 우측 상단 버튼으로 전환
- 종목별 **독립 창**: 캔들 차트(일/주/월) + 거래량 + 현재가, **네이버 금융 바로가기(Chrome)**
- API 키 불필요 — 네이버 금융 데이터 사용 (조회 전용)
- `electron-updater` 기반 자동 업데이트

> ⚠️ 네이버의 비공식 엔드포인트를 사용합니다. 개인용 조회 목적에 한해 쓰세요. 시세는 실시간 대비 약간의 지연이 있을 수 있습니다.

---

## 개발 모드 실행
```powershell
cd stock-viewer
npm install
npm run dev
```
앱 실행 → 검색창에 **종목명 또는 코드**를 입력 → 결과를 클릭하면 관심종목에 추가됩니다.
관심종목 항목을 클릭하면 차트 창이 열립니다. (키 입력·설정 없음)

## .exe 빌드
```powershell
npm run build:win
```
`dist/StockViewer-Setup-<버전>.exe` 설치 파일이 생성됩니다.

> 로컬 빌드가 winCodeSign 심볼릭 링크 오류로 실패하면, Windows **개발자 모드**를 켜거나(설정 → 개발자용) GitHub Actions(아래)로 빌드하세요.

---

## GitHub 자동 빌드·배포
`.github/workflows/release.yml`이 **버전 태그 푸시 시** Windows 러너에서 `.exe`를 빌드해
GitHub Releases에 `latest.yml`과 함께 **자동 정식 배포**합니다.

```powershell
# package.json의 version을 올린 뒤
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```
설치된 앱은 실행 시 `latest.yml`을 확인해 새 버전을 백그라운드로 받고 "지금 재시작"을 안내합니다.
**개발자는 버전 올리고 태그만 푸시하면 끝**입니다.

---

## 디렉터리 구조
```
stock-viewer/
├─ package.json                # 의존성 + electron-builder 설정
├─ src/
│  ├─ main/
│  │  ├─ main.js               # 앱/창 관리, 폴링, IPC, 자동 업데이트
│  │  ├─ naver.js              # 네이버 차트/현재가/검색 클라이언트
│  │  └─ store.js              # 관심종목 저장
│  ├─ preload/preload.js       # 안전한 IPC 브리지
│  └─ renderer/
│     ├─ index.html/js         # 관심종목 + 검색 창
│     ├─ stock.html/js         # 차트 창
│     └─ vendor/lightweight-charts.js   # 차트 라이브러리(내장)
└─ .github/workflows/release.yml
```

## 주의
- 본 프로그램은 학습/개인용 예시입니다. 투자 판단의 책임은 사용자에게 있습니다.
- 네이버 시세 데이터의 정확성·가용성은 보장되지 않습니다.
