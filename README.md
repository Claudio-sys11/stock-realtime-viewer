# StockViewer — 실시간 주식 차트/호가 뷰어

한국투자증권(KIS) Open API로 국내 주식의 **실시간 차트·호가·체결**을 보여주는 Windows 데스크톱 앱입니다.
관심종목을 더블클릭하면 **새 창**으로 차트+호가가 열리고, **GitHub Releases로 자동 업데이트**됩니다.

## 주요 기능
- 관심종목 리스트 (종목코드 추가/삭제, 실시간 현재가)
- 종목별 **독립 창**: 캔들 차트(일/주/월) + 10단계 실시간 호가창
- KIS **WebSocket** 실시간 체결/호가 구독
- `electron-updater` 기반 자동 업데이트
- API 키는 로컬 `userData/config.json`에만 저장 (레포에 올라가지 않음)

---

## 1. 사전 준비: KIS API 키 발급
1. [한국투자증권 KIS Developers](https://apiportal.koreainvestment.com/) 가입
2. 계좌 연결 후 **앱 등록** → `App Key` / `App Secret` 발급
3. (선택) 모의투자 신청 시 모의 도메인 사용 가능

> ⚠️ 실시간 시세 WebSocket은 계좌/약관 동의가 필요합니다. 발급한 키가 실시간 시세 권한을 포함하는지 확인하세요.

## 2. 개발 모드 실행
```powershell
cd stock-viewer
npm install
npm run dev
```
앱 실행 후 우측 상단 **⚙ 설정**에서 App Key / App Secret 입력 → 저장.
종목코드 6자리(예: `005930` 삼성전자)를 입력해 추가하고, 항목을 클릭하면 차트 창이 열립니다.

## 3. .exe 빌드
```powershell
npm run build:win
```
`dist/StockViewer-Setup-1.0.0.exe` 설치 파일이 생성됩니다.

---

## 4. GitHub 자동 업데이트 설정 (한 번만)

### 4-1. 레포 정보 입력
`package.json`의 `build.publish` 와 워크플로의 owner/repo를 본인 것으로 바꿉니다.
```jsonc
"publish": [
  { "provider": "github", "owner": "본인깃허브아이디", "repo": "레포이름" }
]
```

### 4-2. 레포에 코드 푸시
```powershell
git init
git add .
git commit -m "init: stock viewer"
git branch -M main
git remote add origin https://github.com/본인아이디/레포이름.git
git push -u origin main
```

### 4-3. 릴리스 배포 (자동 빌드)
버전 태그를 푸시하면 `.github/workflows/release.yml`이 Windows에서 빌드 후
GitHub Releases에 설치 파일과 `latest.yml`을 자동 업로드합니다.
```powershell
# package.json의 version을 올린 뒤
git commit -am "release: v1.0.1" -m ""
git tag v1.0.1
git push origin v1.0.1
```

### 4-4. 사용자 측 자동 업데이트
설치된 앱은 실행 시 GitHub Releases의 `latest.yml`을 확인합니다.
새 버전이 있으면 백그라운드로 내려받고, 완료되면 "지금 재시작" 안내가 뜹니다.
**개발자는 버전 올리고 태그만 푸시하면 끝**입니다.

> 비공개(private) 레포라면 사용자 측에서 토큰이 필요합니다. 공개 레포 사용을 권장합니다.

---

## 디렉터리 구조
```
stock-viewer/
├─ package.json            # 의존성 + electron-builder 설정
├─ src/
│  ├─ main/
│  │  ├─ main.js           # 앱/창 관리, IPC, 자동 업데이트
│  │  ├─ kis.js            # KIS REST(토큰, 차트, 현재가)
│  │  ├─ ws.js             # KIS WebSocket(호가/체결)
│  │  └─ store.js          # 설정/관심종목 저장
│  ├─ preload/preload.js   # 안전한 IPC 브리지
│  └─ renderer/
│     ├─ index.html/js     # 관심종목 창
│     └─ stock.html/js     # 차트+호가 창
└─ .github/workflows/release.yml
```

## 라이선스 / 주의
- 본 프로그램은 학습/개인용 예시입니다. 투자 판단의 책임은 사용자에게 있습니다.
- KIS API 이용약관 및 호출 한도(분당/일별)를 준수하세요.
