# 시장지표 > 환율 탭 (한국수출입은행 일별 고시환율, 2026-10-11)

시장지표 지면(`/pages/overnight-market`·`/pages/kospi-futures`)의 다섯째 탭 **환율**. 한국수출입은행이 영업일마다 고시하는 **일별 공식 환율(매매기준율)** 을 표로 보여 주고,
선택한 통화의 1개월·3개월·1년 추이를 그린다. **실시간 시장환율이 아니다** — 실시간 원/달러는 기존 글로벌 시장지표 탭의 카드가 그대로 담당한다(변경 없음).

접속: <https://ghlee.tistory.com/pages/overnight-market> → 맨 오른쪽 **환율** 탭 (`?tab=fx` 를 붙이면 처음부터 이 탭, 예 `/pages/overnight-market?tab=fx`).
`skin.html` 변경 없음 — 탭은 `js/skin-main.js` 의 `TABS` 배열이 만들고, 마운트(`#fx-rates`)도 JS가 만든다. 수동 반영 항목 없음.

## 데이터 출처·성격

| 항목 | 내용 |
|---|---|
| 출처 | 한국수출입은행 환율정보 Open API — `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON` (`authkey`, `searchdate=YYYYMMDD`, `data=AP01` 일반 고시환율) |
| 도메인 | 2025-06-25 `www.koreaexim.go.kr` → `oapi.koreaexim.go.kr` 로 변경(공공데이터포털 공지, 구 도메인 2026-04-30 종료 예정). 새 도메인만 쓴다 |
| 이용 조건 | 공공데이터포털 표기 이용허락범위 **제한 없음**. 출처(한국수출입은행)를 화면에 표시한다. 재배포 세부 조건은 포털 정책 페이지에 따른다 |
| 호출 한도 | **일일 한도 숫자는 공표되지 않았다**(포털: "제공자 정책에 따라 다를 수 있음"). 그래서 하루 호출을 스스로 제한(`KOREAEXIM_DAILY_BUDGET`, 기본 300)하고, 한도 소진 응답(result=4)을 받으면 그날은 멈춘다 |
| 공개 시각 | 영업일 오전 11시경 이후(비공식 안내 + 아래 실측). 공개 전·공휴일·주말은 빈 배열 `[]` |
| 인증키 | 서버 환경변수 `KOREAEXIM_API_KEY` 에만 있다. GitHub·티스토리 HTML·공개 JS·로그·응답에 없다(테스트가 정적으로 검사) |

### 실측으로 확인한 응답 형식 (2026-10-11, 로컬 PC·운영 VM(미국) 모두 동일)

- HTTP 200, `application/json`. 영업일: **23개 행**, 모두 `result:1`. 공휴일(2026-10-09 한글날)·주말: **`[]`**(오류 아님). 잘못된 키: `result:3` + 값 전부 null.
- 필드: `result, cur_unit, ttb, tts, deal_bas_r, bkpr, yy_efee_r, ten_dd_efee_r, kftc_bkpr, kftc_deal_bas_r, cur_nm`. 숫자 값은 **쉼표가 든 문자열**(`"1,339.2"`).
- **기준 단위**: `cur_unit` 이 `JPY(100)`·`IDR(100)` 이면 100단위 기준 환율이다. 1단위로 환산하지 않고 `100 JPY당` 으로 표시한다. 그 외는 1단위.
- 위안화는 `CNY` 가 아니라 **`CNH`**(`cur_nm` "위안화")로 내려온다. `KRW` 행(`deal_bas_r:"1"`, `ttb/tts:"0"`)은 외화가 아니라 저장하지 않는다.
- 결과 코드: 1 성공 · 3 인증 오류는 실측. 2(DATA 코드 오류)·4(일일 제한 마감)는 공식 안내 기준이며 응답을 본 적 없다.
- `yy_efee_r`·`ten_dd_efee_r`·`kftc_bkpr` 은 저장만 하고 화면·계산에 쓰지 않는다(값 의미 미검증).

화면에 쓰는 값: 매매기준율(`deal_bas_r`), 송금 받을 때(`ttb`, TTB), 송금 보낼 때(`tts`, TTS), 전일 대비·등락률(서버가 같은 통화·같은 단위의 직전 고시일과 비교해 계산).

## 구조

```
 방문자 브라우저 ──GET /fx-rates, /fx-rates/history──▶ FastAPI(goodbyestar.cloud) ──읽기만──▶ fx_koreaexim.db (SQLite)
                                                        ▲                                        ▲
                                          요청 경로는 외부 호출 없음           fx-koreaexim-poll 스레드 1개(FastAPI 프로세스 안) ──▶ oapi.koreaexim.go.kr
```

- 모듈 `scripts/cloud-vm/fx_koreaexim.py`. 새 프로세스·systemd 타이머 없음(e2-micro 보호 원칙). `main.py` startup 에서 `fx_koreaexim.start_background()`.
- 저장: `scripts/cloud-vm/fx_koreaexim.db`(gitignore `*.db`) — `fx_rates`(날짜×통화), `fx_dates`(날짜별 조회 결과: DATA/EMPTY/WEEKEND, 확정 여부), `fx_meta`(마지막 확인·성공·오류·일일 호출 수). 약 380일×22통화 ≈ 8천 행.
- 경로: `GET /fx-rates`(최신 고시일 전 통화 + 전일 대비 + 수집 상태), `GET /fx-rates/history?cur=USD&range=1m|3m|1y`. 공개(CORS는 블로그 도메인), IP별 분당 30/60회, 응답 30초 캐시. 상세는 `API_REFERENCE.md`.

### 수집 규칙

1. **영업일(월~금) 11:00 KST 이후** 그날 고시를 확인한다. 아직 비었으면 11~13시 10분 간격, 이후 1시간 간격으로 23:30까지 재시도한다.
2. 빈 응답이 계속되는 날(공휴일)은 비어 있는 채로 둔다. **같은 날의 빈 응답은 확정하지 않고**, 다음 날 한 번 더 확인해 확정한다(늦은 공개·VM 중단 보정).
3. **과거 날짜는 한 번 받으면 다시 호출하지 않는다**(`fx_dates`). 주말은 호출하지 않는다. 처음 시작하면 최근 380일을 최신순으로 채운다(약 270회, 한 주기 25회·호출 간 1초·20초 간격, 하루 예산 300 안).
4. 주말·공휴일에는 새 데이터가 없으므로 화면은 **직전 정상 고시일** 값을 그대로 보여 준다(`baseDate`). 영업일 11시 이후 오늘 고시가 아직 없으면 `pendingToday` 로 안내 문구를 띄운다.
5. 오류: 통신 오류 5분 후, 인증 오류 1시간 후 재시도, 한도 소진은 그날 중단. 오류가 나도 저장된 데이터는 그대로 표시한다(`state`: `ok`·`collecting`·`no_key`·`auth_error`·`quota`·`network_error`).
6. 키는 `.env` 에 넣고 **서비스를 재시작하지 않아도** 다음 주기(최대 15분)에 읽는다. 키가 없으면 호출하지 않고 `no_key` 로 표시한다.

## 서버 환경변수 (운영 VM)

| 이름 | 용도 | 위치 |
|---|---|---|
| `KOREAEXIM_API_KEY` | 한국수출입은행 환율정보 인증키(필수) | VM `/home/goodbyestarwars/kiwoom-api/.env` 한 줄 `KOREAEXIM_API_KEY=키값` (권한 600, 소유 goodbyestarwars) |
| `KOREAEXIM_DAILY_BUDGET` | 하루 API 호출 상한(선택, 기본 300, 범위 10~900) | 같은 `.env` |

등록 후 `GET /fx-rates` 의 `state`(`ok`·`collecting`)와 `lastSuccessAt` 으로 확인한다. 키 교체는 `.env` 값만 바꾸면 된다. 키를 폐기·재발급하면 `state:auth_error` 가 보인다.

## 화면

- 표(카드 없음): 통화(코드·이름·기준 단위) · 매매기준율(원) · 전일 대비 · 등락률 · 송금 받을 때(TTB) · 송금 보낼 때(TTS). 주요 통화(USD·JPY·EUR·CNH·GBP·CHF) 먼저, 나머지는 "기타 통화".
- 행을 누르면(키보드 Enter/Space 포함) 아래 추이 차트가 그 통화로 바뀐다. 기본 USD, 기간 버튼 1개월·3개월·1년. SVG 차트(의존성 없음, 높이 230px, 호버/터치 툴팁), 하단에 시작·종료·기간 변동·최고·최저·평균.
- 상단에 고시 기준일·직전 고시일·마지막 수집·마지막 확인 시각(KST)·출처를 항상 표시하고, "일별 고시환율 · 실시간 시장환율 아님" 배지와 하단 안내문을 둔다.
- 선택한 기간보다 수집된 이력이 짧으면 실제 시작일을 표시한다(처음 수집 중일 때).
- 상승 빨강·하락 파랑, 다크모드 `html.dark`, 모바일(720px 이하)은 한 행을 두 줄로 바꿔 가로 스크롤 없이 모든 열을 보인다. 공용 `@layer np` 의 `th` 배경 `!important` 는 같은 레이어에서 `#fx-rates` 로 되돌린다.

## 검증

- `test/test_fx_koreaexim.py`(19건): 파싱(쉼표 문자열·단위·KRW 제외·CNH)·분류(result 코드·빈 배열)·키 비노출·수집 주기(11시 이전 금지, 10분/1시간 재시도, 과거 중복 호출 없음, 휴일 확정, 예산·한도·오류 백오프)·조회(변동·단위·기간·부분 이력)·정적 계약(공개 파일에 키 없음, 탭 등록, 요청 경로 외부 호출 없음).
- `test/test_fx_rates.js`: 표기·단위·색 구분·날짜·통계·눈금, 공개 JS에 키·수출입은행 직접 호출 없음.
- `test/fx-rates.html`: 운영 `style.css` 를 불러 온 로컬 하네스(`python -m http.server 8777` 후 `http://localhost:8777/test/fx-rates.html`, API는 `?api=` 로 지정). 1280/375px, 다크모드, 행·기간 전환, 키보드 선택 확인.
- 실 API 수집: 로컬 PC와 운영 VM 모두에서 2026-10-08 23개 통화 수신, 2026-10-09(공휴일) 빈 배열 확인.

## 한계

- 일별 한 번 고시되는 값이라 장중 변동을 반영하지 않는다. 휴일이 낀 날의 "전일"은 직전 **고시일**이다.
- 일일 호출 한도 숫자는 모른다. 하루 예산(기본 300)을 넘기지 않는다. 처음 이력을 채울 때 한 번에 약 270회를 쓴다.
- DB 파일이 사라지면 같은 규칙으로 최근 380일을 다시 수집한다(백업 대상 아님).
