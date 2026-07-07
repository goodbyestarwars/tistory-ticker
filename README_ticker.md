# 글 내 티커 자동 툴팁 (1단계 MVP)

본문에 `$삼성전자`, `$005930` 같은 표기를 쓰면 자동으로 등락 뱃지를 붙이고,
호버(PC)/탭(모바일) 시 시세 툴팁을 보여주는 기능입니다.
기존 "KRX 공시 티커" GAS 프록시([skin.html:819-920](skin.html)의 `fetch(GAS + ...)` 패턴)와
동일한 방식으로, 프론트 JS가 GAS 웹앱을 거쳐 네이버 금융 API를 호출합니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `gas/ticker-proxy.gs` | GAS 프록시. `?codes=005930,083650` 배치 요청 → 네이버 polling API 중계, 캐싱 |
| `js/ticker-tooltip-v3.js` | 본문 파싱 + 뱃지/툴팁 렌더링 (vanilla JS, 의존성 없음) |
| `css/ticker-tooltip-v2.css` | 뱃지/툴팁 스타일 (스킨 톤 유지, 다크모드 대응) |
| `data/krx_map.js` | 종목명 → 코드 매핑 (`window.KRX_MAP`, KOSPI+KOSDAQ 전 종목 약 2,766개) — `<script>`로 로드, JSON 아님 |
| `test/sample.html` | 로컬 검증용 샘플 페이지 (GAS 호출만 mock 처리) |

## 1. GAS 배포 절차

1. [script.google.com](https://script.google.com) → 새 프로젝트 생성
2. `gas/ticker-proxy.gs` 내용을 전체 복사해 붙여넣기
3. 우측 상단 **배포 → 새 배포**
4. 유형: **웹 앱**
5. 설정
   - 실행 사용자: **나**
   - 액세스 권한: **모든 사용자**
6. **배포** 클릭 → 표시되는 웹 앱 URL(`https://script.google.com/macros/s/XXXXX/exec`)을 복사
7. 브라우저에서 `{URL}?codes=005930,083650` 로 직접 열어 JSON 배열이 나오는지 확인
   - 코드를 수정한 뒤에는 **배포 → 배포 관리 → 수정(연필 아이콘) → 새 버전**으로 다시 배포해야 반영됩니다 (URL은 유지)

## 2. 프론트 설정값 채우기

- `js/ticker-tooltip-v3.js` 상단의 `GAS_TICKER_URL`에 위에서 복사한 URL을 넣습니다.
  ```js
  var GAS_TICKER_URL = 'https://script.google.com/macros/s/XXXXX/exec';
  ```
- `data/krx_map.js`는 별도 설정 없이 `<script>` 태그로 불러오기만 하면 됩니다 (아래 3번 참고).
  - 티스토리 파일 업로드는 확장자가 `.json`이면 막힐 수 있어, `window.KRX_MAP = {...}`을 할당하는
    평범한 `.js` 파일로 만들었습니다 — jQuery처럼 `<script src="...">`로 불러오면 그만입니다.
  - 종목을 추가/수정하려면 이 파일만 고쳐서 다시 업로드하면 됩니다 (GAS 재배포 불필요).

## 3. 티스토리 스킨 HTML에 삽입

먼저 티스토리 **스킨 편집 → HTML 편집 → 파일 업로드** 탭에서 `css/ticker-tooltip-v2.css`, `data/krx_map.js`,
`js/ticker-tooltip-v3.js`를 각각 올립니다. 업로드하면 파일명 앞에 자동으로 `images/`가 붙어 저장되므로
(예: `images/krx_map.js`), skin.html에서는 아래처럼 **상대경로로 바로 참조**하면 됩니다.
별도로 CDN URL을 찾아 넣을 필요는 없습니다.

`skin.html` 기준으로:

- **CSS**: `<head>` 안, 기존 `<link rel="stylesheet" href="./style.css" />` ([skin.html:7](skin.html)) 아래에 추가
  ```html
  <link rel="stylesheet" href="./images/ticker-tooltip-v2.css" />
  ```
- **JS**: `</s_t3>` 직전, 기존 공시 티커 스크립트가 끝나는 `</script>` ([skin.html:922](skin.html)) 바로 뒤에 추가
  (순서 중요 — `krx_map.js`가 `ticker-tooltip.js`보다 먼저 로드되어야 함)
  ```html
  <script src="./images/krx_map.js"></script>
  <script src="./images/ticker-tooltip-v3.js"></script>
  ```

## 4. 로컬 테스트 방법

`test/sample.html`은 `data/krx_map.js`는 실제 배포와 동일하게 `<script>`로 그대로 로드하고,
GAS만 로컬에 없으므로 `TickerTooltip.fetchTickerData`를 mock으로 교체해 검증합니다.

```bash
# 리포지토리 루트에서
python -m http.server 8532
# 또는
npx serve .
```

브라우저에서 `http://localhost:8532/test/sample.html` 접속 후, 페이지 안내된 체크리스트를 확인하세요.
(`<script>` 로드만 쓰므로 `file://`로 직접 열어도 대부분 동작하지만, 로컬 서버 사용을 권장합니다.)

`GAS_TICKER_URL`을 실제 값으로 채운 뒤 `test/sample.html`의 mock `<script>` 블록을 지우면
실제 GAS 호출로도 검증할 수 있습니다.

## krx_map.js 재생성 방법 (전 종목 매핑)

`data/krx_map.js`는 KRX 상장(KOSPI+KOSDAQ) 전 종목 명단을 한 번 생성해 고정 파일로 커밋해둔 것입니다.
종목 상장/폐지/이름 변경은 자주 일어나지 않으므로 GitHub Actions 같은 주기적 자동화는 두지 않았고,
필요할 때(신규 상장 종목이 많이 생겼다 싶을 때, 대략 연 1회 정도) 아래처럼 다시 생성하면 됩니다.

```bash
python -m pip install finance-datareader
python -c "
import FinanceDataReader as fdr, json
df = fdr.StockListing('KRX')
df = df[df['Market'].isin(['KOSPI', 'KOSDAQ', 'KOSDAQ GLOBAL'])][['Name', 'Code']].dropna()
mapping = {}
for _, row in df.iterrows():
    name, code = str(row['Name']).strip(), str(row['Code']).strip()
    if name and code and name not in mapping:
        mapping[name] = code
js = 'window.KRX_MAP=' + json.dumps(mapping, ensure_ascii=False) + ';'
open('data/krx_map.js', 'w', encoding='utf-8').write(js)
print(len(mapping), '개 종목 생성')
"
```

생성 후 티스토리 **파일 업로드**로 다시 올리면 되는데, **같은 파일명으로 재업로드하면 CDN/브라우저 캐시 때문에
새 내용이 한동안 반영 안 될 수 있습니다** (이번에 `ticker-tooltip.js` → `ticker-tooltip-v2.js`로 실제로 겪었던 문제).
확실하게 하려면 `krx_map-v2.js`처럼 파일명을 바꿔 올리고, skin.html의 `<script src="...">` 경로도 같이 바꿔주세요.

## 알려진 제한사항

- KOSPI/KOSDAQ 전 종목은 커버하지만 KONEX, 미국 주식(`$AAPL` 등)은 지원하지 않습니다 (3단계 예정)
- `$삼성전자를`처럼 조사가 바로 붙은 표기는 매핑 조회에 실패해 스킵됩니다 — `$삼성전자` 뒤에 공백을 두는 걸 권장
- GAS 프록시는 KOSPI/KOSDAQ 상장 종목만 대상으로 하며, 네이버 polling API 응답 스키마가 바뀌면
  `gas/ticker-proxy.gs`의 `fetchFromNaver()` 필드 매핑(`cd`, `nm`, `nv`, `cv`, `cr`, `rf`, `aq`)을 다시 확인해야 합니다
