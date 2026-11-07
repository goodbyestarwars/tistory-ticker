**2026-11-08 모바일 긴 목록 10개+더보기·헤더 sticky·활성 섹션 높이·비활성 갱신 생략**

요청: 홈 스와이프 섹션의 긴 목록 정리. 변경: `home-realtime-table.js`(상위10+더보기 10개씩·상한50 후 상세 링크, 접힌 행/비활성은 데이터만 반영, 같은 종목의 모든 순위 사본 갱신), `home-economic-news.js`(10→50 더보기 후 뉴스 링크), `home-mobile-tabs.js`(활성 패널만 ResizeObserver, 비활성 `data-mtab-idle`·`home-mtab-activate`, translateY 가짜 sticky 헤더), `css/home-mobile-tabs.css`(content-visibility, 더보기·sticky 스타일). 모두 `body.m-tabs`/≤720px 한정, PC·`!important` 무변경, 새 구독·폴링 없음. 검증: 390px 라이브 페이지에서 더보기 10→20→30→링크, 뉴스 10→50→링크, 탭 전환 시 초기화, 그리드 높이=활성 패널 높이, 헤더가 칩 아래에 고정(top 58), 비활성 틱 무갱신·활성화 시 최신값 재렌더(22,222원), ratchet·node --check 통과. 미확인: 실기기 스와이프·실제 WS 틱, 다크/320px 육안. 배포: master → Pages.

**2026-11-08 모바일(≤720px) 하단 탭바 + 얇은 헤더 + 홈 섹션 스와이프**

요청: 모바일만 상단 1·2차 메뉴 제거·하단 탭바·홈 좌우 스와이프, PC 무변경. 변경: 신규 `css/home-mobile-tabs.css`·`js/home-mobile-tabs.js`(`body.m-tabs`가 롤백 스위치), `js/skin-main.js`에 `loadMobileTabs` 로더(720px 이하에서만 파일을 받음). 헤더=로고+검색+다크모드 한 줄(53px), 1·2차 메뉴는 숨기고 더보기 서랍이 `#nav-menu-mount`를 읽어 전 항목 구성(투자도구·관리자·글쓰기는 원래 요소 click 위임). 탭바=홈/시장/종목/더보기, `--mobile-tabbar-h`(safe-area 포함) 단일 변수로 본문 여백·메모 버튼·맨 위로·sidebar-right 재계산, z-index 층 정리, 서랍·검색·관심종목 서랍·모달·전체화면 차트·입력 포커스·키보드(visualViewport)에서 탭바 숨김. 홈=시장/종목판/공시·뉴스/브리핑 4그룹을 `.home-widget-grid` 직속 섹션의 flex 가로 배열·CSS order로 전환(DOM 이동 없음), scroll-snap·IntersectionObserver 칩/점 동기화·해시 복원, `data-no-swipe`(스크롤러 contain, 차트 touch-action pan-y)·왼쪽 20px 양보. 휴장 탭은 그리드·칩 숨김. `!important` 신규 0. 문서: `docs/UI_GUIDE.md`·`CLAUDE.md` 규칙. 참고: 2026-09-04에 걷어낸 5칸 탭바와 달리 4칸+서랍이며 이번엔 모든 항목을 서랍에 둔다. 스펙과 다른 점: 충돌 요소 `touch-action: pan-x` 대신 `pan-y`(pan-x는 차트 위 세로 스크롤을 막음, 가로 스크롤러는 `overscroll-behavior-x: contain`). 검증(운영 페이지에 브랜치 파일 주입, 390/360/320px): 가로 넘침 0, 라이트·다크 색, KR/US/휴장 전환, 그룹 높이 KR 1744/1656/1275/551·US 1981/1196, 그룹 전환·스냅 후 칩·점·해시 동기화, 서랍 항목 15개+계정=원 메뉴와 일치, 투자도구 모달 열림 시 탭바 숨김·닫힘 시 복귀, 검색 포커스 시 숨김, 시장·종목 페이지 활성 탭, 전체화면 차트(z 10000) 위에 탭바 없음, 1440px 모든 모바일 규칙 비활성(탭바·칩·서랍 display none). 미확인: 실제 손가락 스와이프·iOS 왼쪽 에지·가상 키보드(실기기), 평일 장중 화면. 배포: master → Pages.

**2026-11-07 CI 3종 실패(regression·offline·calendar-browser) 낡은 테스트 정리**

원인: 코드 결함이 아니라 테스트가 바뀐 제품을 따라가지 못함. regression=캘린더가 쓰는 NineUI.escapeHtml을 테스트가 싣지 않음. offline=test_market_participation_bars.js가 폐기된 거래대금 화면을 검증(거래량 통일 후 test_market_volume_unified.js가 반대로 검증). calendar-browser=검색기 합성 데이터에 shapeSelection 없음 + 폐기된 그리기 도구·패턴 선택 검증(0fff2d1f). 변경: test/test_calendar_market_tabs.js, test/test_market_participation_bars.js(API 오류 시 캐시 제거 검증만 유지), test/scanner-states.html(inline 모드 shapeSelection 3종목), test/qa_scanner_inline_chart.py(그리기 제거·모바일 행 높이 250). 제품 코드 변경 없음. 검증: 로컬에서 3개 모두 통과(캘린더 4/4, participation 2종, inline QA 4케이스). CI 나머지 단계가 처음 실행되며 추가로 드러난 2건도 같은 유형: test_binance_shared_quotes.js(e58e4a90이 종목당 체결시각용 가격 티커 요청을 추가했는데 기대 호출 수 3·5가 그대로 → 5·9, 가격 티커 모의 응답 추가), test_public_scan_routes.py(/pattern-scan 응답 키 목록에 shapeSelection 누락, Windows는 AF_UNIX 없어 로컬 미실행·CI로 확인).

**2026-11-07 !important 정리 보정: @layer 안 선언만 복원 (정리분 유지)**

현상: 직전 정리(929개 제거) 후 증시온도 '시장 브리핑' 결론 박스가 여백 0·모서리 직각·배경 투명·파란 테두리만 남고 번호 원이 글자와 겹침(모바일 실화면). 원인: `@layer np.np` 안 규칙은 레이어 밖 규칙(`#market-temp .mt-tm-verdict{padding:0;border-radius:0;background:transparent}`, `style.css`의 `*{margin:0;padding:0}`)에 !important 없이는 져서, 레이어 안에서 지운 !important가 실제로 필요했음. 변경: 정리 커밋을 그대로 두고(되돌림 e474eab5를 다시 되돌림) 레이어 블록(중첩 @media 포함) 안의 선언 349줄만 !important 복원, 레이어 밖 정리분 275줄은 유지. 제거는 style.css 174개·market-temp.css 172개 순감. 기준선 test/important_baseline.json 갱신. 검증: 운영 증시온도 페이지에서 정리 전 CSS와 이번 CSS를 교체해 요소 3,053개의 계산 스타일(+::before/::after) 해시 비교 — 모바일 375px·PC 1400px 모두 변경 0건(같은 CSS 2회 측정 노이즈 0건). 결론 박스 복구 값: 여백 8px 12px·모서리 8px·옅은 파란 배경·grid. 후속: 다른 페이지 상태(다크·홈·종목)는 이번에 비교하지 않았음.

**2026-11-07 미국 주식 이야기: 옵션 화면 읽기 · 미국 옵션시장이 큰 이유**

요청: 종목 화면 옵션 종합·옵션 감마 항목별 상세 설명과 미국 옵션시장 활성화 배경. 변경: `learn/us-market.html`에 두 섹션(`#sec-options-screen`, `#sec-options-why`)과 SVG 4개(감마 표 구성·맥스 페인 예시·감마 플립 헤지·OCC 연간 거래량) 추가. 설명은 `scripts/cloud-vm/us_options.py`·`js/us-stocks.js` 실제 계산(맥스 페인, P/C, 프리미엄 추정, 3일 평균 대비, 월·플립 ±15%, Net GEX=콜−풋, 신규=거래량>OI·300계약)과 일치시킴. `data/learn-search.js` 재생성. 검증: 로컬 서버 PC·모바일(375px) 가로 넘침 없음·SVG 글자 겹침 없음. 배포: master → Pages.

**2026-11-07 검색기 모양 선정 상대강도('My way') 필터**

목적: 지수와 무관하게 제 갈 길 가는 종목만 남겨 후보 축소. 기록 근거: 포착 656건 중 지수 하락일 포착은 이후 20일 고가 지수 초과 +3.5%p, 상승일 포착은 −3.8%p. 변경: 공통 `js/auto-wave.js`에 `relativeStrengthOf`(KOSPI·KOSDAQ 각각 대비 20/60일 초과수익, 비율선 20일 범위 위치, 지수 하락일 버팀 비율, 두 지수 중 약한 쪽을 요약값으로 씀)·`myWayOf`(단타 2메뉴: 두 지수 초과+자체 20일 상승+비율선 상단+하락일 버팀, 눌림: 60일 초과·상승+비율선 중단 이상, 바닥: 20일 초과·상승+버팀, 장기는 기존 재무 관문 유지). `shape_scan.py`는 저장된 지수 일봉(`future_chart` KOSPI/KOSDAQ, signal_review와 같은 출처, 공급자 호출 없음)을 넘기고, 기준일 종가가 없으면 필터를 끄고 `relativeStrength.status=missing`으로 밝힘(통과/탈락으로 간주하지 않음). `shape_scan.js`는 필터를 60개 상한 전에 적용, 필터 전 후보는 추적에만 기록(`patternDetail.myWay`로 사후 비교). `js/pattern-scan.js` 안내 문구에 필터 기준·제외 수. 추정: 11/06 후보 136건(90종목) → 약 55건(33종목)(20일 미니차트 기반, 실제는 상한 전 적용이라 더 많을 수 있음). 검증: `test_shape_selection.js`(상대강도·폭락장 덜 빠진 종목 제외·지수 결측·워커 필터)·`test_shape_selection.py` 17개·`test_chart_scanner_shape.js`·auto-wave 회귀 통과, 로컬 하네스 안내 문구 확인(하네스는 NineHttp/NineUI 미로딩으로 기존부터 깨져 있어 수동 주입). 미확인: 첫 적용은 11/09 장마감 후 스캔. 배포: master → Pages/VM 자동.
**2026-11-07 홈 국내 '시장 핵심 지표' 분리: 투자자 동향 유지 · 시장 보조 지표는 종합뉴스 아래**

요청: 투자자 동향은 그대로 두고 원/달러·주간선물은 경제 종합뉴스 밑으로(국내증시만). 변경: `js/skin-main.js` 기존 박스 제목을 '투자자 동향'으로, 원/달러·KOSPI200 주간선물 2열과 20거래일 [면적][막대] 버튼을 `#homeEconomicNews` 안 새 `#homeMarketAux`('시장 보조 지표', 미국 모드 숨김)로 이동. data-market-field·data-home-day-*·data-home-metric-* 계약과 렌더러·폴링은 그대로(dashboardSection 범위 조회). `css/home-market-board.css` 해당 규칙 45줄을 `:is(#homeMarketBoard.hmb2, #homeMarketAux)`로 공유, 루트 변수·간격은 야간선물 카드와 공유, 투자자 동향 위 구분선 제거·중복 dt는 화면에서만 숨김. CSS `?v=20261107-market-aux`. CLAUDE.md·UI_GUIDE 규칙 갱신. 검증: 운영 페이지에 브랜치 CSS·같은 배치 주입 실측(1400px: 종합뉴스 아래 20px, 2열 297px·차트 56px / 375px: 1열, 가로 넘침 0), 관련 테스트 2개 실패 수 master와 동일(기존 실패). 미확인: 평일 장중 실제 화면, 미국 모드 전환 실측. 배포: master → Pages.

**2026-11-07 검색기 모양 선정 5개 메뉴 포착 추적 기록**

목적: 고가 기준(포착가 대비 이후 20거래일 최고가 상승률) 평가에서 현재 화면의 모양 선정 메뉴만 기록이 없어 판정 불가. 같은 날 원래 검색기 11개 판정(관측 10/06~11/06, 지수 대비 초과 고가 상승률): 유지 단기이평돌파·역헤드앤숄더·쌍바닥, 관찰 눌림·저점상승, 수정 이평구름·박스하단·시초갭·매집봉·장기224(폭락장 1개월 표본). 변경: `scripts/cloud-vm/shape_scan.py` `record_tracks` - 모양 선정 스냅샷 저장 후 공통 `pattern_tracker.record_new`로 `pattern:shape:<메뉴>` 키에 관찰 추적 등록(기존 검색기 통계·scan_hits·주문 피드 불변, 같은 날 재실행·열린 추적 중복 없음, 실패해도 스냅샷 유지). 갱신은 기존 `update_tracks`가 담당하고 조회는 기존 공개 `/pattern-tracks?scanner=pattern:shape:<메뉴>`. 참고: 메뉴별 공개 목록 60개 상한은 `shape_scan.js`. 검증: `test_shape_selection.py`(신규 1건)·`test_pattern_tracker.py` 16개, `test_shape_selection.js` 통과. 미확인: 첫 기록은 다음 일봉 스캔(11/09 장마감 후). 배포: master → VM 자동.

**2026-11-07 미국 SEC 공시 제목 한국어 변환**

문제: 홈 경제 종합뉴스 속보 레일에 `8-K - Fox Corp (0001754301) (Filer)` 원문이 그대로 노출(서식·CIK만 있어 내용 파악 불가). 변경: `news_aggregator.get_sec_filings`가 EDGAR 피드 요약의 8-K Item 번호를 공식 항목표로 한국어화해 `title_ko`(예: `Fox Corp 수시공시: 중요 계약 체결, 자산 인수·처분 완료 외 1건`, 10-Q는 `분기보고서(10-Q) 제출`)와 `company`·`items`를 추가. 9.01(첨부서류)은 다른 항목이 있으면 제목에서 제외, Item 2.02는 `category='실적'`. 원문 `title`·링크 보존, 화면은 기존 `title_ko` 우선 표시 재사용. 검증: `test_news_aggregator.py` 23개 통과(신규 1), 실제 EDGAR 피드 변환 확인. 배포: master → VM.

**2026-11-07 목표가 매수 금액 기준 입력**

요청: 금액 기준으로 매매할 수 있는 UI. 변경: `js/auto-trader.js` 목표가 매수 폼에 주문 기준(금액/수량, 기본 금액) 선택과 투자금액 입력, 실시간 계산 줄(주문 주 수·예상 주문금액·남는 금액) 추가. 금액 기준은 투자금액÷목표가 내림 주 수를 계산해 기존 `{action:'target-add', code, price, qty}` 그대로 전송(VM 계약·주문 경계 불변), 1주 미만·100,000주 초과는 전송 차단, 확인창에 금액×수량 표시. `css/auto-trader.css` select·계산 줄. 검증: `test_auto_trader_target_search.js`(금액 계산 4건 추가)·orders 테스트 통과, 로컬 목업 하네스 PC/375px(가로 스크롤 없음, 전송 qty=17 확인, 모드 전환). 미확인: 운영 관리자 화면, 실제 등록·주문. 배포: master → Pages.

**2026-11-07 KIS 도구 웹 백테스터 제거 (전략 빌더만 유지)**

요청: 백테스트는 명령으로 돌리므로 불필요한 기능 정리. 명령 연구(`run-history.sh`→`analysis/history_*.py`)는 웹 백테스터와 무관함 확인. 변경: `scripts/kis-lab/gateway.py`(backtest 경로·18802 중계 제거, 404), `portal.html`(메뉴·기본 화면을 빌더로), 테스트·README(PR #1154). Oracle 운영: `web-gateway`에 반영(백업 `backups/web-gateway-20261107`), `ninepay-kis-web` 재시작, 사용자 서비스 `ninepay-kis-backtest-ui`(18301)·`-api`(18802) 중지·비활성화. 소스·빌드·Lean 데이터 보존. 검증: `test_gateway.py` 10개 통과, 서버 내부 빌더 UI/API 200·백테스터 API 응답 없음, 외부 미인증 차단 유지, 메모리 사용 1,537→1,363MB. 미확인: 관리자 로그인 화면 표시. 복구: 두 서비스 `systemctl --user enable --now` + 백업 게이트웨이 복원.

**2026-11-07 차트 보조지표 설정 팝오버 · 이동평균선 선별 설정(종목·미국·지수 공통)**

원인: '내 이평선' 입력(11-06)이 미국 차트 템플릿에만 추가돼 국내·지수 차트에 없었음(보조지표 줄 HTML이 세 곳에 따로 복사돼 있었음). 변경: 공통 `NineUI.chartOptions`(skin-shell.js)를 접기 줄 대신 '+ 보조지표' 팝오버로 교체(왼쪽은 기존 체크박스 label 노드를 그대로 옮긴 목록, 오른쪽은 설명·상세, 720px 이하 하단 시트, Esc·바깥·× 닫기, PC는 패널 overflow를 피해 버튼 기준 fixed). 화면별 상세는 `opts.details`로 등록. `chart-core.js`에 `defaultMaLines`·`normalizeMaLines`·`maLineStudies`(최대 8선, 기간 2~600, 굵기 1~4, 기준가 종가·시가·고가·저가, 색 미지정 시 기본/224 테마색). `stock-search.js`는 국내·미국·지수 차트가 공통 `maToggleHtml`·`maDetailRenderer`·`state.maLines`를 사용하고, 예전 단기/장기·'내 이평선' 저장값은 지우지 않고 처음 한 번 옮김. 보조지표 줄 전용 배치 CSS(stock-search·foreign-flow)는 제거, 목록 모양은 ui-system.css 한 곳. 이용방법 6-3 갱신. 미적용: 종목분석(foreign-flow) 차트는 팝오버만 공유하고 이평선은 기존 단기/장기 토글(서버 MA 값 사용) 유지. 검증: 로컬 서버에서 국내 종목(목업)·지수(합성 응답) PC 1280/모바일 375·다크 실측(기간·기준가·추가·삭제·저장·토글·닫기), JS 테스트 150개 전후 비교 신규 실패 0(기준선 실패 41개 동일, site_guide는 통과로 바뀜), Playwright 테스트 2개(팝오버·종목 툴바)는 재작성했으나 로컬에 playwright가 없어 미실행. 배포: master → Pages.

**2026-11-07 반복 포맷 함수 8곳을 NineUI.number/signedPercent 위임으로 통일**

목적: 본문이 NineUI와 같은 지역 포맷 함수 제거. 변경: auto-trader(pct·fmtWon)·home-sector-rotation(pct)·investor-flow(pctText)·crypto-market(fmtNum)·strategy-search(pctSigned·fmt, 결측 '—'은 missing 옵션)·skin-main(미국 ETF pct)을 `NineUI.signedPercent`/`number` 위임으로 교체. 의도적 유지: 결측을 0으로 표시하거나(market-temp), 0을 '-'로 표시하거나(skin-main fmtPct), 단위·자릿수·부호 규칙이 NineUI와 다른 함수(foreign-flow·learn-inflation·stock-search 등)는 호출부 소유. 차이: 숫자가 아닌 값(NaN 등)은 이전 'NaN%' 대신 '-'. 검증: node --check, 전체 py/js 테스트 변경 전후 실패 목록 동일(auto-trader 2개 테스트는 샌드박스에 실제 NineUI 로드하도록 보정). 한계: 화면 실측 미실시. 배포: master → Pages.

**2026-11-07 자동매매 VM 목표가 매수 활성화 (사용자 승인)**

요청: 운영센터에 수동매매(목표가 매수)가 안 보임. 원인: 코드(`autotrader-private` ce30232, Pages 073a3fcb·c76fbabc)는 반영됐으나 기본 비활성 설정이라 에이전트가 `target-buy-v1`을 보고하지 않음. 조치: 사용자 승인 후 자동매매 Google VM `/home/autotrader/autotrader/.env`에 `TARGET_BUY_ENABLED=1` 추가(백업 `.env.bak-targetbuy-20261107`, 소유 autotrader·600), 토요일 장외 05:03 KST. 서비스 재시작·주문 없음. 검증: `main.load_env()` 후 `target_buy.enabled()`=True, 제어 에이전트 05:04:25 정상 종료(0)·`read_env`=1. 미확인: 관리자 로그인 화면의 등록 폼 표시, 실제 조건 등록·주문(첫 거래일 11/09). 기존 계좌 승인·MANUAL_STOP·HOLD_BUY·예산·14:00 경계는 그대로.

**2026-11-07 모의진단 후속: 뉴스 링크 스킴 검증(javascript: 차단)**

목적: 외부 뉴스 피드의 link가 http(s)가 아니면(javascript: 등) 클릭 시 스크립트가 실행될 수 있어 방어. 점검: innerHTML 싱크 중 메모·종목명·본문은 escapeHtml 적용 확인(메모 위젯·차트 메모·관심종목 메시지는 textContent). 변경: `NineUI.safeUrl` 추가(skin-shell.js), stock-news(4곳)·main-news·home-economic-news(2곳) href에 적용, 비-http(s)는 빈 값/#. 검증: node --check, 관련 테스트 중 chart 관련 3건 실패는 별도 세션의 미커밋 chart-core 변경 영향으로 이 변경과 무관(미확인). 한계: 화면 실측 미실시. 미조치: Google API 키(js/stock-calendar.js)를 콘솔에서 Calendar API 한정·쿼터 상한 설정(사용자 수동). 배포: master → Pages.

**2026-11-07 모의진단(OWASP) 후속: API 문서 비공개 · nginx 보안 헤더 스니펫**

목적: 진단 결과 M1(보안 헤더 없음)·M2(`/docs`·`/openapi.json` 공개, 운영 경로 109개 노출) 조치. 변경: `scripts/cloud-vm/main.py` FastAPI 문서 경로를 기본 비활성(`ENABLE_API_DOCS=1`일 때만 개발용 활성), `ops/nginx/security-headers.conf` 신규(HSTS·nosniff·DENY·no-referrer·CSP, server_tokens off, 80→443 리다이렉트 안내). M3는 서버 확인 결과 문제 없음(nginx가 X-Forwarded-For 설정, uvicorn 기본이 127.0.0.1 신뢰). 미조치: innerHTML 샘플 점검, Google API 키 허용 API 한정. 검증: 구문 검사만. 배포: main.py는 master → VM 자동(문서 경로 404 확인 필요), nginx는 2026-11-07 Oracle VM에 적용·reload 완료(백업 보관): 보안 헤더(HSTS·nosniff·X-Frame SAMEORIGIN·no-referrer, /kis-tool 때문에 CSP 제외), server_tokens off, goodbyestar.cloud 80→443 301, 통합 에러페이지 include(API JSON 오류는 유지, nginx 자체 오류만 HTML). 실측: 헤더·301·CORS·401 JSON 정상.

**2026-11-07 직접 fetch 읽기 조회 11곳을 NineHttp.json으로 통일**

목적: 화면마다 따로 쓰던 읽기 전용 공개 GET 조회의 타임아웃(15초)·중복 요청 공유·HTTP 오류 처리를 공통 전송으로 일원화. 변경: home-sector-rotation(2)·skin-main(미국 ETF)·invest-tools(환율)·home-realtime-table(52주)·home-weekly-report(실적 폴백)·domestic-market-indicators(2)·foreign-flow(회원사)·watchlist(미국 시세 2)에서 `fetch`+수동 ok/json 처리를 `NineHttp.json`으로 교체. 응답 가공·단위·폴백 판단은 호출부 그대로. 제외(의도적 유지): 쓰기(PUT/DELETE)·로그인 쿠키(credentials) 요청(chart-drawing·memo·chart-memo·market-temp 사용자 카드·auth), 텍스트 응답(dcf·GAS 공시), 자체 타이머/중단(pattern-scan·미국 검색 4곳), 번역(home-economic-news), us-macro-indicators 갱신(PUT). 검증: node --check, 관련 테스트 557건 중 실패 15건은 변경 전과 동일(Windows 기준선, 전후 diff 동일). 한계: 화면 실측 미실시. 배포: master → Pages.

**2026-11-07 !important 929개 제거 (style.css 377·market-temp.css 552) · escapeHtml 복사본 13곳 통합**

목적: 정책(새 !important 금지)에 맞게 기존 누적분을 화면 비교로 안전하게 정리. 방법: 운영 화면 16개 페이지 x PC(1400)/모바일(375) x 라이트/다크 = 64개 상태에서 요소별 계산 스타일(+::before/::after) 해시를 비교. 스타일 시트를 메모리에서 교체해 후보를 24개씩 묶어 제거하고 달라지면 이분 탐색으로 원인 규칙을 가려내 남김(보수적: 어느 한 상태에서라도 달라지면 유지, 호버·포커스 등 동적 의사클래스·미디어 조건 불일치·화면에 없는 요소는 검증 불가라 유지). 3회 라운드 + 전 상태 교차 검증. 결과: 후보 1,966 중 929 제거, 1,037 유지. !important 5,125→약 4,200. 홈 모바일 라이트/미국 종목 PC·모바일 다크 각 1~7곳은 규칙과 무관한 시간 변동 요소로 판단(규칙을 걸러내도 불변). 변경: `style.css`·`css/market-temp.css`, `test/important_baseline.json`(래칫 기준선 하향). 별도: `esc`/`escapeHtml` 동일 구현 13곳을 `NineUI.escapeHtml` 위임으로 교체(dcf.js·learn-search.js는 독립/변형이라 제외), 달력 테스트에 NineUI 대역 추가. 검증: 위 비교(최종 교차 후 안정 상태 차이 0), 괄호 균형, 래칫 테스트. 한계: 로그인·호버·모달·미방문 페이지는 미검증이라 해당 규칙은 유지. 배포: master → Pages, 반영 후 라이브 육안 확인 필요.

**2026-11-07 자동매매 보유 종목을 증권사 잔고 형식으로 표시**

요청: 키움 실시간 잔고처럼 보유 종목을 보여 줄 것. 변경: `js/auto-trader.js` 보유 종목 카드에 총매입(추정)·총평가·총손익·총수익률 요약과 종목명·보유수량·매입가(추정)·현재가·등락률·평가금액·평가손익·수익률·상태·매수일 표. 현재가는 공통 `NineAPI.domesticQuotes`(30초 재사용), 시세·평단 미확인 종목은 `-`로 두고 합계 제외 안내. VM이 계좌 잔고를 받지 않으므로 실현손익·추정자산·예수금은 표시하지 않음. `css/auto-trader.css` 4칸(모바일 2칸) 요약. 주문·제어 경로 불변. 검증: `test_auto_trader_orders.js`(지난 escapeHtml 위임 이후 깨져 있던 샌드박스 NineUI 보정 포함)·목표가 검색 테스트 통과, 로컬 하네스 PC/375px 확인(가로 스크롤 없음, 콘솔 오류 0). 배포: master → Pages.

**2026-11-06 라이트모드 저대비 회색 글자 7곳 보정 (모바일 375px 실측 기준)**

점검: 운영 홈을 375px에서 다크·라이트 각각 텍스트 대비(WCAG AA) 측정. 가로 스크롤 없음, 다크는 2곳(4.35:1) 경미. 라이트는 7곳 미달(2.4~3.9:1): 미국 정규장 시각 문구, 실시간 표 순위·종목 보조 문구, 카운트다운 라벨/구분자, 관심종목 `>>`, 차트 하락 글자색. 변경: `style.css`(hrt/hen 보조 회색→#6b7684, 다크 전용 규칙 추가), `css/home-market-board.css`(hsc 라벨/구분자, `--hmb-chart-down-text` 라이트값만), `css/watchlist.css`. 다크 값·!important 개수 불변(래칫 통과). 검증: 반영 후 재측정 필요(Pages 약 10분). 미완: 모바일 10px 이하 글자 14곳, 터치영역 28px 미만 8개.

**2026-11-06 중복 정리 1차: 차트 라이브러리 로더 단일화 · 고아 임시파일 정리 · !important 래칫**

점검 결과: ① `quick-indices`·`overnight-market`·`kospi-futures`·`pattern-scan`이 chart-core와 별개로 Lightweight Charts 로더를 각자 보유(같은 스크립트 중복 다운로드 위험). ② `snapshot_io` 임시파일(`.*.tmp`)이 쓰던 프로세스 사망 시 남음(Oracle `.earnings_calendar_store.json.*.tmp` 4MB, 11/1) - 유지보수가 청소하지 않음. ③ `!important` 5,125개(style.css 2,371·market-temp 1,141 등), 최근 30일 +3,412/-2,474. 변경: `NineUI.loadChartLibrary`(skin-shell.js, chart-core와 같은 `__nineChartLoads.lwc` 약속) 추가, 4개 모듈은 이를 우선 사용(없으면 기존 경로 유지, 테스트 하네스용). `maintenance.sweep_orphan_temp_files`(24시간 이상 된 점-시작 `.tmp`만) 추가. `test/test_important_ratchet.py`+`important_baseline.json`: 파일별 !important 증가 시 실패. 검증: node --check, 로컬 서버에서 로더 2회 호출 시 스크립트 태그 1개·같은 객체, pytest 13건. 미완: 직접 `LWC.createChart` 8개 파일의 옵션·테마 통합, 지역 escapeHtml 30곳 → NineUI.escapeHtml, !important 실제 삭제는 화면 검증이 필요해 보류. 배포: master → Pages/VM 자동.

**2026-11-06 종목판 캐시 워머 유지 180초→600초**

목적: 3분 이상 방문이 없던 뒤 첫 방문자가 `/market-board?market=us` 캐시 미스(실측 5.3초, 히트 0.3~0.7초)를 맞던 지연 완화. 변경: `scripts/cloud-vm/main.py` `_MARKET_BOARD_WARM_ACTIVE_WINDOW_SEC` 600, 테스트 기대값 동기화. 영향: 방문 후 10분간 20초 주기로 외부 순위 API 호출 지속(주기·휴장 판정 불변). 검증: 워머 테스트. 배포: master → VM 자동(장중 재시작 금지 규칙은 deploy_check 소관), 반영 후 `/health` 확인 필요.

**2026-11-06 종목 차트 '내 이평선' 기간 직접 설정**

요청: 이동평균선을 사용자가 직접 설정. 변경: `js/stock-search.js` 종목 차트 지표줄에 쉼표 입력칸(2~600일, 최대 6개) 추가, 입력 시 기본 단기·장기 묶음 대신 지정 기간만 그림, 비우면 기본값. 값은 기존 `persistPrefs` 키로 저장. 지수 차트·외국인 수급 차트는 미변경. 검증: `node --check` 통과, 브라우저 실화면 미확인. 배포: master push → Pages 자동.

**2026-11-06 검색기 차트 패턴선 복구·작도 제거**

눌림·재돌파의 선을 복구한 뒤 거래량·가격 회복, 추세 돌파, 바닥 형성, 장기 재무까지 다섯 메뉴의 근거선을 연결했다. 선정 당시 일봉을 공통 auto-wave로 재계산하며 일치한 경우만 표시한다. 작도·측정·메모를 제거하고 지표 옵션은 유지했다. 5개 메뉴 실제 후보 좌표와 회귀 4개, 운영 오리온 상세의 작도 0·지표 8 확인. Pages 배포 42198673128(0fff2d1f).

**2026-11-06 목표가 매수 종목명·코드 검색**

공통 KRX 종목 사전을 재사용해 종목명 또는 6자리 코드로 자동완성한다. 선택한 종목의 코드만 등록 요청에 전송한다. 주문 연결 없는 가상 데이터 미리보기에서 '삼성'과 '005930'을 각각 확인했고 검색·주문내역 회귀 통과. Pages 배포 42178123649(c76fbabc). 실계좌 비활성.

**2026-11-06 자동매매 보유 종목 표를 주문 내역 위로 이동**

열린 장부 포지션과 추정 평단 안내를 주문 내역 바로 앞에 배치. 표 순서·빈 상태·주문 내역·CSV 회귀 통과, 운영 JS 일치 확인. Pages 배포 42166929185(6d0a40e9).

**2026-11-06 휴장 대시보드 그래프·등락 아이콘 통일**

주요 지수와 원유·금은 같은 미니 그래프 높이·선 두께·방향별 채움 토큰을 적용하고, 시세 등락 아이콘은 선형 화살표·보합 가로선으로 맞췄다. UI_GUIDE 갱신, 관련 테스트 22개 통과, 운영 JS/CSS 일치 확인. Pages 배포 42159814058(fd662104).

**2026-11-06 홈 거래량·상승하락 종목 비율 막대 대비 강화**

한국·미국 공통 세로 거래량 막대와 상승·보합·하락 가로 막대의 채움 대비를 높였다. UI_GUIDE 갱신, 공통 팔레트 회귀 통과 및 운영 CSS 일치 확인. Pages 배포 42143915784(52b21d79).

**2026-11-06 자동매매 목표가 지정가 조건 등록·취소**

관리자 UI와 기존 인증 명령 중계를 연결한다. 엔진은 당일 목표가 도달 시 기존 승인·예산·주문 경계를 통과한 조건만 한 번 시도한다. 모의 주문 및 중계 회귀 검증. Pages 42171338911 배포 완료(073a3fcb), 중계 CI 42171339674 통과. 19:07 KST 확인 당시 Oracle API는 장중 배포 보류, 주문 VM 반영은 미확인. 실계좌는 기본 비활성.

**2026-11-06 자동매매 주문·보유·추천 종목명 공통 사전 폴백 수정**

운영센터 Google VM `order_names.json`의 누락 종목이 코드로만 보이던 문제를 웹 활성 주문 내역·열린 보유·추천 목록·CSV에서 해결. 기존 `data/krx_map.js` 공통 종목명 사전 재사용(서버명 우선, 없는 종목만 폴백), 사전 로딩 완료 시 기존 수신 자료만 다시 렌더(추가 VM 조회 없음), 실패 시 60초 재시도. 021240 코웨이·012330 현대모비스·000080 하이트진로 및 모르는 코드 표시 회귀 테스트 추가. VM/DB/계좌/주문/매도 차단/서비스 변경 없음. master→Pages 배포·운영 렌더 별도 검증.

**2026-11-06 코스피·코스닥 당일 일봉 갱신 복구**

시세 이력이 전일에 멈추면 기존 KIS 거래량 조회의 당일 OHLC를 재사용한다. 시장지표는 KST 거래일이 바뀔 때 원본 일봉을 재조회하고 지난 봉에 현재가를 덮어쓰지 않는다. 분봉에는 마지막 관측시각을 표시한다. 회귀 검증 후 master → Pages 배포.

**2026-11-06 OHLC 캔들·거래량 채움 가독성 복원**

공통 종목/지수 거래량과 국내 시장지표에 전용 빨강 #E88D86·파랑 #79A7DE 적용. 기존 면적·일반 막대, 숫자·선 색, 데이터와 거래 계약 보존. 공통 팔레트·시리즈/갱신 회귀 검증. 배포 경로: master → Pages.

**2026-11-06 홈 거래량 중복 제거·공통 차트 툴바 정렬**

한국·미국 활동성 제목/평균 기준 한 번, 지수별 숫자만 표시. 막대 높이와 시장 요약 열 정렬, 차트 일봉/메모·작도/독립차트 윗선 통일. 기존 데이터와 기능 유지.

**2026-11-06 전역 그래프 채움 팔레트 통일 · 숫자 의미색 보존**

사용자 요청: 빨강 그래프 채움 #FAE8E7, 파랑 #E4EDF8로 통일, 숫자 색 변경 금지. 항상 로드되는 css/ui-system.css에 --chart-fill-up/down 단일 토큰 추가, js/skin-shell.js에 NineUI.chartFill(캔버스 실색 조회) 공통 기능 추가. 홈 거래대금/등락·업종·외국인기관 가로 막대, 공통 IndicatorBoard SVG 면적·투자자 막대, 국내 LWC 캔들 몸통/거래량 히스토그램, 퀵지수/글로벌/코인 면적, 시장온도, 종목분석 RSI/매수매도 막대, 주말 카드 면적에 적용. 가격·이평·꼬리/테두리·축/범례·상승/하락 숫자색은 그대로. 개별 중립/초록 및 버블 단계색은 가독성 때문에 유지. 기존 시세/API/캐시/VM/실계좌/주문 변경 없음. test/test_global_chart_fill_palette.js 회귀 추가 및 V8 주입 실행 통과. 실제 PC/모바일/다크 브라우저 렌더와 GitHub Pages 배포 확인은 별도 보고.

**2026-11-06 홈 한국·미국 활동성 막대를 동일 거래량 기준으로 통일**

운영 응답 직접 대조: 한국 KIS turnoverIndex 있음, 미국 turnoverIndex 없음; 두 시장 volumeIndex(same-time-5m-volume-sum/10일) 정상. 사용자 대안 지시에 따라 공통 homeParticipationModel/렌더러를 양 시장 거래량으로 통일. 평균100·5분봉(하루누적 아님)·유효95%·산식·시장별 신선도·결측/지연 검증, 거래대금/미연동/보조 중복 문구 제거. 기존 국내 참여비율/중앙값은 펼침 보존. 수집KST/공급자지연·원본 관측일시 미제공·장외 마지막5분봉 명시. API/VM·수집·KIS 저장값·skin.html·주문 변경 없음. 신규 동일계약/오류/상태/실응답 렌더 회귀 검증; master→Pages 결과는 최종 보고.

**2026-11-06 지수 6종 공통 차트 생성·가격축 드래그 및 툴바 정렬**

지수 별도 생성 옵션을 chart-core.chartOptions(search)로 통합하고 공통 휠/세로이동/차트등록 재사용. 공통 오른쪽 가격축 마우스 드래그로 중심 고정 범위 조절·포인터 해제/터치 보존. 일봉/기간 간격 축소 및 PC 좌측2줄/우측도구·모바일 줄바꿈, 독립차트 외곽 테두리 제거·저장/복사 직사각형. 기존 np 반경 규칙을 CSS 변수로 확장하고 공통 CSS 버전 갱신. 검증: core/interaction/smooth wheel(축 드래그·해제·터치·정리 포함)/지수 마크업/캡처 도구 회귀 통과. 실제 LWC5.2 로컬 렌더 PC1690/모바일488에서 넘침 없음·버튼 반경0/외곽0; 실제 마우스 축 드래그 범위94~206→69.13~230.87 확인. 운영 사이트 직접 조작은 별도 검증이며 master→Pages 배포·공개 파일 반영은 최종 보고. skin.html·API/VM·주문/실계좌 변경 없음.

**2026-11-06 한국·미국 시장 활동성 거래대금 기준 검증 및 US 권한 차단 회귀 정리**

요청: 국내 KIS 거래대금과 미국 기존 TradingView 거래량을 동일한 거래대금·5거래일 동시간대 평균=100 기준으로 맞추기. 확인: 국내 KIS actual 거래대금 30분 누적·5일 비교 가능, 미국 기존 /us-market-breadth는 지수 구성종목 5분 거래량/10거래일 상대량만 제공하고 USD 거래대금·과거 5일 동시간대 누적 금액이나 공개 재표시 권한이 없음. 기존 최신 프런트는 미국 turnoverIndex 검증이 모두 충족될 때만 막대를 표시하고, 미연동 시 값 없음/거래량 보조 표시. 새 라이선스 데이터 없이 거래량×가격·ETF 대리값으로 지수 거래대금을 합성하지 않음. 이전 테스트가 한국 KIS turnoverIndex를 미국에도 허용하던 잘못된 단언을 수정하고, 미국 USD/5일/공개 권한/시각·오류·독립 보조 거래량 회귀를 신규 추가해 통과. CLAUDE.md/UI_GUIDE 정책 명시. 데이터/API/수집 주기/실거래/주문/VM 변경 없음. GitHub master 커밋 및 Pages 운영 반영은 별도 확인. 미국 실수치 구현은 승인된 재표시 계약·공급처가 확보될 때까지 보류.

**2026-11-06 홈 투자자 동향을 샘플형 가로 막대로 변경**

공통 InvestorFlow.miniBars로 마지막 유효 장중 슬롯의 외국인/기관/개인 당일 누적 3행 표시. 샘플형 옅은 주체색 배경·내부 금액·부호/순매수/순매도·두 시장 동일 절대금액 눈금, 카드 폭/70px 유지. 기존 조회·캐시·관측일/시각·지연 처리와 원본 차트 보존. skin.html·API/VM·주문/실계좌 변경 없음. 부호·결측·공유 눈금 및 기존 계산 회귀 검증; master→Pages 결과와 실화면 검증은 최종 보고에서 구분.

**2026-11-06 홈 KR 투자자 동향을 당일 30분 슬롯별 누적 수급으로 전환**

홈 최근20일 이력 조회를 기존 /investor-trend?period=intraday KOSPI/KOSDAQ 조회로 전환. InvestorFlow.miniChart 공통 렌더러에 intraday 모드를 확장해 ind/frgn/orgn 누적값 그대로 표시(재합산 금지), 09:00~15:30 고정축·3색·카드 폭·70px 유지. 관측일/슬롯 검증·중복 최신값 선택·누락/주체별 결측 선 분리·단일점 표시. 같은 슬롯 지수 미제공 명시, 일별 지수 혼합/일별 폴백 제거. 시장별 실패/당일 무관측은 마지막 장중 캐시와 기준 날짜·실제 관측 KST·조회/관측 지연·장외 저장값·슬롯 수를 표시. 공통 HTTP/로더·5분 조회 재사용. 원본 일별 누적 차트·Tistory skin.html·API/VM·주문/실계좌 무변경. 검증: JS 구문, 기존 InvestorFlow 계산/차트, 신규 장중 결측/관측일/중복/부분 실패/날짜 전환/빈값/중복요청 회귀 통과. master→Pages 배포 및 운영 PC/모바일 렌더 결과는 커밋 후 별도 확인.

**2026-11-05 바이낸스 주식·ETF 선물 거래 시각과 API 수신 시각 분리**

요청: 30초 주기 조회가 실제 체결 시세인지 확인 후 시각·지연 표시 개선. overnight-market.js 기존 24시간 통계 외에 공식 USD-M /fapi/v2/ticker/price로 동일 종목 최신가격과 transaction time 조회(각 종목 한 요청 추가); 24시간 통계 closeTime은 통계 종료 시각으로만 저장하고 거래 시각으로 표시하지 않음. crypto-market.js 종목명 아래 체결시각(KST)·경과초/분·5분 이상 거래 공백, 그룹 머리말에 실제 API 수신/서버 저장/조회 실패 상태를 분리. indicator-board.js의 행 sub를 재렌더 없이 동기화해 선택/포커스 유지. 가격 시간 API 실패면 기존 24hr 가격만 유지하되 체결시각 미확인으로 표시. 기존 30초 조회·24시간 등락/고저·일봉 캐시·서버 타이머·주문/실계좌 무변경. 검증: JS 구문·직접/시간조회 실패/지연/서버 저장 표시 V8 모의 API 스모크 통과, Node 회귀 테스트 원본 추가. 브라우저 운영 직접 조회와 GitHub Pages 배포 결과는 별도 확인 필요.

**2026-11-05 홈 투자자 동향을 원본 20거래일 누적 순매수 미니 그래프로 교체**

버튼 방식 대신 시장지표의 원본 `InvestorFlow._calc.cumulative`를 재사용해 KOSPI/KOSDAQ 각 70px 차트에 외국인 빨강·기관 파랑·개인 초록 및 지수 회색 점선(독립 스케일) 표시. 홈 헤더의 개별 선택/면적막대 UI를 삭제하고 단일 색상 범례·20거래일 기준을 둠. /investor-trend/history 원본 저장 일봉 21일(20거래일+기준점), 홈 5분 조회·기존 JS 공통 로더·24시간 캐시·잠정/기준일/지연 표기, 자료 없음 시 0 합성 금지. 기존 30분 장중 원본 렌더러와 API는 장애 시 출처 명시 폴백으로 보존. PC/모바일 차트 높이와 홈 카드 폭, 시장지표 원본 전체 그래프·VM/실계좌/주문·Tistory skin.html 변경 없음. 배포·회귀는 GitHub 기록으로 확인.

**2026-11-05 홈 KR/US 차트 면적·막대 두 버튼 전역 통일**

시장 핵심 지표에서 사용하는 `면적 | 막대` 2버튼을 홈 KR/US 지수 세션 차트와 국내 투자자 동향에도 동일 적용. 공통 `homeModeSegment`를 만들어 DOM/ARIA/버튼 스타일을 통일하고 기존 화살표 토글·중복 가운데 텍스트를 제거. 지수 차트별 독립 설정/수급 공통 설정/원달러·주간선물 공통 설정, 선택 상태·면적/막대 렌더러, 시장 의미색과 70px 차트 높이 그대로. PC/모바일 터치 크기·키보드 포커스 보정. Tistory HTML·VM API·실계좌·주문 변경 없음. 테스트/Pages 상태는 해당 GitHub 실행 결과 확인.

**2026-11-05 KR 홈 핵심 지표 렌더링 정렬 및 중복 그래프 제어 제거**

스크린샷에서 원/달러/주간선물 버튼·최근20일·이력 날짜가 각 SVG 주변에 중복 표출되고 주간선물 시간만 차트 위에 있어 상하 차트 불일치. 기존 CSS·JS 안에서 핵심지표 헤더에 최근20거래일+면적/막대 1조로 이동(두 차트 동시 전환), 지표는 제목/한줄 시세/56px 차트/단일 KST 수신시각 4행 그리드로 통일. 기존 `renderHomeIndexChart` 계산/면적-막대 SVG 의미색 유지, 반복 이력은 DOM에서 제거하되 title/속성에 남김. KOSPI/KOSDAQ 외국인/기관 비교/70px 유지. PC·모바일 실제 픽셀 미리보기 후 테스트, Pages 배포 확인 예정. Tistory skin.html·API·VM·주문 변경 없음.

**2026-11-05 주간선물 상태 제목 우측·환율/선물 면적↔막대·수급 주체 분리**

KOSPI200 주간선물 거래상태는 제목 우측, 하단은 수신시각만 표시. 홈 원/달러/주간선물은 기존 20거래일 미니 차트 계산 및 공통 `homePriceSwitchControls`를 결합해 각각 면적/막대 변환(기존 1분 시세 재사용). 투자자 동향은 기존 70px 차트에 외국인/기관/비교 선택 추가(기본 비교), 선택 주체 시리즈만 표시·누적값 명시·기존 면적/막대와 장중 결측 보존. 홈 CSS 기존 레이어 범위 내 수정, PC/모바일/다크 의미색 유지. 신규 API·서버·주문·Tistory HTML 변경 없음. 검증·배포 결과는 GitHub run 기준.

**2026-11-05 KR 업종 이동·두 미니 차트·기관 수급 동시 표시**

국내시장 박스로 주도/주의 업종을 이동하고 기존 미국시장 `hus-rotation`을 공유(국내 업종별 표본 평균률·표본 건수, 별도 공급처 설명). ‘시장 핵심 지표’는 원/달러/주간선물 2칸+기존 대표지수 미니차트 렌더러를 재사용한 실제 일봉(20개) 그래프, 기존 1분 /futures 요청에 USDKRW만 추가하고 응답 실패 시 마지막 정상 차트를 유지. 투자자 동향 KOSPI/KOSDAQ 카드/차트 70px는 그대로 두고 기존 /investor-trend의 `frgn` 외국인 실선+ `orgn` 기관 점선(같은 축, 30분 단위, 결측 유지), 두 총액과 면적/막대 전환 표시. API 신규 수집·VM·주문·Tistory HTML 없음. 테스트/배포 상태는 GitHub run 기준으로 기록.

**2026-11-05 운영 UI 반영 점검: 차트 확장 CSS 버전 동기화**

차트 독립 버튼 스타일은 공통 `dashboard-enhancements.css`에 추가됐지만 이를 로드하는 `dashboard-enhancements.js`의 `ENHANCEMENT_VERSION`이 이전 그리기 툴바 값으로 남아 CSS 캐시의 구버전 재사용 가능. JS 소유 CSS 링크를 최신 expand-segment 버전으로 동기화하고 같은 data 표식의 오래된 CSS 링크는 중복 주입하지 않고 href만 최신 버전으로 변경한다. 차트 마크업·캡처·홈 주간선물·주문/VM 및 티스토리 `skin.html`은 수정하지 않았다. 코드·CSS 계약 검증 및 기존 링크 재사용 테스트 추가. GitHub Pages 배포와 운영 브라우저 실제 화면을 구분한다.

**2026-11-05 정정: HTML 수동 반영 요구 취소·버전 URL 원상복구**

사용자 운영 원칙과 `CLAUDE.md` 재확인: GitHub Pages 정적 경로의 `?v=`만 바꾸는 변경은 티스토리 관리자 수동 수정 사유가 아니다(기존 URL은 CDN 약 10분 내 갱신). 11/05 앞선 작업에서 저장소 `skin.html`의 CSS·JS 버전 문자열만 변경했으나 그 변경은 운영 HTML에 적용되지 않았고 필수도 아니므로 원상복구. `docs/SKIN_HTML_PENDING.md`에 추가했던 수동 반영 요구 삭제. JS/CSS 신규 기능과 Pages 배포 유지. 운영 브라우저 표시 검증은 별도이며, 캐시만으로 모든 미반영 현상을 단정하지 않는다.

**2026-11-05 GitHub Pages 배포 완료와 티스토리 스킨 캐시 URL 불일치 점검**

운영 미반영 신고 후 점검: GitHub Pages 코드는 배포됐으나 저장소 `skin.html`의 CSS `?v=20261027`, 홈 JS `?v=20261025`가 최신 UI 버전과 달랐다. 홈 CSS는 기존 `data-home-market-board-css`를 확인한 뒤 재로드를 생략하는 설계라 오래된 브라우저 캐시 가능. 스킨 원본의 두 정적 자산 버전과 `skin-main.js`의 동적 `dashboard-enhancements.js` 버전을 동기화, 누락 방지 정적 회귀 검사 추가. master→Pages 배포는 티스토리 스킨 적용이 아니므로 `docs/SKIN_HTML_PENDING.md`에 운영 수동 반영 필요를 명시. 실계좌·API·수집·거래 로직 변경 없음.

**2026-11-05 KR 시장 핵심 지표 주간선물·독립차트 세그먼트 통일**

요청: 핵심 지표 칸을 압축해 KOSPI200 주간선물 추가, 독립 차트도 봉 주기와 같은 세그먼트 버튼으로. 변경: 홈 핵심지표 PC4/모바일2열, 수급 미니차트 90→70px, 저장된 KOSPI200_DAY 시세를 국내 홈에서만 1분 조회해 가격·등락·기준시각·거래/장마감/지연/휴장 구분. 공통 expandSegment로 독립차트 버튼만 세그먼트 스타일 통일하고 저장/복사 아래 유지. 신규 수집/주문/VM/스킨 HTML 변경 없음. 검증·배포는 이번 GitHub 실행 기준.

**2026-11-05 차트 작도 버튼 세그먼트·독립차트 하단 캡처 배치**

요청: 메모~지우기를 일봉/주봉/월봉과 같은 세그먼트 디자인으로, 저장/복사를 독립 차트 버튼 아래로 이동. 변경: 실시간 시세 국내·미국·지수와 종목분석의 그리기 버튼/액션 스택 분리; 공통 dashboard-enhancements가 독립차트를 캡처 상단에 주입. stock-search 레이어와 dashboard-enhancements 공통 CSS로 PC/모바일/다크 스타일 통일. 기존 버튼 선택자·이벤트·모달/캡처 경로·주문 변경 없음. 검증: JS 문법, 4종 차트 마크업 그룹·주입 경로·스타일 정적 검사 통과. 배포: master→Pages (최종 확인 별도).

**2026-11-05 MY 매물대 미니 SVG 검은 막대·확대 표시 수정**

원인: MY가 공통 종목분석 매물대 HTML(`ff-vp-host`)을 재사용하지만 미니 그래프 CSS(`ff-apt-split/mini/svg/ff-mini-bar`)는 `#foreign-flow`에만 한정됨. SVG 기본 fill=검정·너비 제한 없음으로 장문의 검은 막대와 큰 ‘현재’ 문구 노출. 변경: 미니 그래프 CSS를 `:is(#foreign-flow,.ff-vp-host)` 공통 범위로 확장, MY 2열 카드에서는 기존 가격 행 아래 폭 120px(모바일 96px) 썸네일로 제한, 다크 현재가선/텍스트 보정. 계산·데이터·분석 기간·매매 로직·스킨 HTML 변경 없음. 검증: CSS 공통 선택자·SVG 채우기·모바일·다크·원본 재사용 회귀 테스트 추가, GitHub Pages 배포 결과와 운영 화면은 별도 확인.

**2026-11-05 공통 차트 PNG 캡처·클립보드 복사**

요청: 차트 도구 모음에서 현재 표시 중인 화면을 고화질로 저장·복사. 변경: 공통 chart-core의 LWC 스크린샷 + 별도 캔버스(수동 도형·자동 파동/추세·구름·지지저항) + 범례 합성, 2배 PNG·종목/티커/주기/선택기간/KST 헤더·파일명, 국내/미국 실시간 시세·지수·종목분석 차트 3종 도구 모음에 저장/복사 버튼, 실패 시 버튼 안내. 기존 공통 차트 호출·옵션·데이터/서버/주문 변경 없음. 검증: JS 문법·핵심 함수 mock 스모크 및 GitHub 반영 확인; 실제 모바일·운영 브라우저 캡처와 Pages 완료는 별도 확인.

**2026-11-05 종목분석 카드 일반 흰 박스·축소 차트·보조 5분봉 복원**

요청: Liquid Glass가 과하고 전체폭 차트가 커서 아래 콘텐츠 카드와 정렬 불일치. 변경: 종목분석 카드만 투명 유리 제거, 공통 흰 박스·테두리와 본문 동일 폭으로 복원, 카드 안 왼쪽 MA 위치·이격률 짧은 해석/오른쪽 최대250px 차트, 모바일 세로 배치·205px. 1600px 이상 남는 왼쪽 여백에 기존 5분봉(분봉 종가/고·저) 표시, 좁은 화면은 추가 API 요청 생략. 공통 MA/일목 26거래일 선행 파란 구름, 작은 범례, 단일 카드 및 원본 스토리 보존, Noto Serif KR/전역 Glass/주문/서버 무변경. 검증: JS 구문·조회 데이터 기반 차트/이평률·단일 카드/스토리 원본·5분봉 보너스/좁은 화면 추가요청 방지 및 CSS 계약 스모크 통과. 운영 Pages 실제 반영은 별도 검증으로 구분.

**2026-11-05 종목분석 차트 단일 카드·범례·Clear Glass 누락 보완**

요청: 기존 UI 작업 중 남아 있던 다중 카드·중앙 범례·일목 약칭·미약한 유리 시인성 보정. 변경: 차트가 있으면 카드 1장만 노출(기존 판정·스토리 원본 데이터와 no-chart 폴백 보존), 자동 넘김/페이지 제거, 정식 범례 `일목균형표(구름대)`를 차트 하단 왼쪽 10~11px로 정리, 공통 clear 글래스 rim/반사·그림자와 종목분석 영역에만 은은한 광원 배경 추가. 기존 MA/일목 계산·파란 채우기/stroke none·Noto Serif KR 굵기 및 크기 변경 없음. 검증: 실제 공통 chart-core와 현재 JS를 격리 실행한 스모크에서 차트·구름·범례·단일 카드·원본 유지·단기 자료 폴백 통과. 테스트 단언을 새 UI 정책으로 갱신. 운영 Pages 배포·실화면 확인은 별도 기록이 있을 때만 완료로 간주. 주문/VM/API 변경 없음.

**2026-11-05 홈 다우 선물 30분 세션 차트 통일**

목적: 미국 세 번째 카드의 DOW도 NASDAQ100/SP500과 같은 정보·30분 차트 표시. 변경: home_session_chart.US_FUTURES에 DOW 추가, 기존 foreign_futures 수집·DB/세션/기준가 저장 경로 재사용(추가 호출 없음). 프론트 DOW↔SOX 전환·관측값 없을 때만 일봉 fallback 유지, 전환 시 이전 일봉 기간/세션 속성 정리. 검증: Python 세션/API 17건, JS 10개 장 경계·공통 렌더 240/390폭·단일 관측·막대·결측/복귀, 기존 세션 차트 회귀 통과. Windows 테스트 개행·syslog 의존성 보정, API 종목 계약 9개 검증. 인접 single_status 테스트 4건은 기존 HEAD에서도 DOM mock classList.toggle 누락으로 동일 실패(이번 변경과 무관). 배포: master→Pages/Oracle 자동 배포, 운영 반영은 최종 보고 기준. 과거 관측값을 합성하지 않으며 최초 실제 관측 전만 일봉 허용.

**2026-11-05 종목분석 차트 우선·파란 일목 구름·Clear Glass·Noto Serif KR**

변경: 공통 chart-core의 MA/일목 9·26·52 재사용, 카드에 26봉 선행 파란 채우기만 표시(stroke none), 결측 창 분리·부족/실패 처리. 차트 첫 카드·전폭, 장문 판정/이평 해석/이격률 타일 제거, 판정표·심층 카드·캐러셀/기존 엔진 유지. 공통 clear 유리 토큰(PC4/모바일2px·정적 반사광), 접근성 폴백 유지. fonts.css 단일 Noto Serif KR 가변/부분집합/swap·기존 Bold400→실제700, 독립 학습 문서·파동 라벨 포함, 기존 UI 고딕 유지. 검증: 신규 카드 계산/26봉/결측·단기·상수·실패, 기존 stock_stories·chart_core·chart_studies 통과. Edge1440/390×라이트/다크 넘침0·JS오류0·구름stroke none·Noto Serif KR 실제700 로드, 투명도 축소 폴백·reduced-motion 확인. 배포: 1dbfdcf master→Pages 성공 확인. Tistory 구형 폰트 link 정리는 SKIN_HTML_PENDING 참고. 주문/실계좌/API 공급자 변경 없음.

후속 UI 시인성/폰트 보정(2026-11-05): 운영에서 reduced-transparency=true일 때 clear 면/그림자까지 사라지는 원인 확인. 공통 clear 토큰·정적 마스크 rim·내부 곡면 반사 보강, 1px 테두리 유지·여백으로 잘리는 반사 프레임 노출, reduce에서는 블러만 끄고 알파.28·프레임 유지(다른 카드/강제색/인쇄 폴백 보존). 모바일 범례 간격 조정으로 한 줄 유지. 공통 fonts.css의 공식 가변 WOFF2 부분집합을 직접 선언해 중간 Google CSS 요청 제거, size-adjust96%/행메트릭110·29·0으로 기존 명조 광학 크기 맞춤, font-size/자간/지정 행간·Bold700·UI고딕 유지. 운영 기본 CSS에 동일 이름의 별도400 face가 있어 공통 내부 패밀리를 Noto Serif KR Site로 분리(실제 공식폰트 불변), 400·600·700 모두 보정 보장. 검증: 동일 삼성전자 운영 DOM/데이터를 고정한 PC1440/모바일390×라이트/다크×투명도설정 전후16 렌더, 제목·범례 줄바꿈 증가0·가로넘침0·구름경로/stroke 불변, 공통 캐러셀 다음/이전8조합 통과. 24px Bold 잉크 ascent21→20px(마루부리20), 독립 normal 행 표본35→32px(마루부리32). 전후 스크린샷 확인. 후속 배포는 master→Pages, 운영 자산/배포 상태는 최종 보고에서 구분.

**2026-11-05 검색기 후보 선정 자체를 OHLCV 모양 기준으로 전환**

요청: 기존 후보 정렬뿐 아니라 뽑는 기준도 변경. 변경: 공통 auto-wave.selectShapesOf를 Node 1회 배치로 재사용해 전체 저장 일봉에서 5개 메뉴별 신규 후보 선정, 기존 DB/원자 캐시/daily_scan/rescan 완료 경로 재사용, 공개 shapeSelection 분리·기본 웹 후보 전환·구버전 대기. 기존 수치 patterns/포착·추적·확정/주문 경로 보존, 유형/최신일봉/유동성/장기재무 관문 유지. 검증: 신규 JS·Python 통합4개/API 보존·입력/시효·얕은 조정 양성/지속하락 음성, 기존 탐지기92·검색기/파동 인과성 통과. PC/모바일5메뉴 신규선정/대기·넘침0·오류0·주문0. 운영 확인(11/05 01시 KST): 코드 e7bf20c Oracle 자동 배포 및 API active/종료코드0, DB-only 재선정 약9초. 저장3,917종목 중 기본관문 통과400, 거래량·가격43/추세51/바닥60/눌림60/장기재무6. 공개 API 200·관찰전용/주문불가·기존13개 patterns 내용 불변 확인. 기존 수치 후보에 없던 새 후보는 각40/51/54/60/3개. 실제 응답으로 모바일5메뉴 렌더·집계·넘침0·오류0 확인. 후속 확인(11/05): Pages run 41866645393 성공, 운영 auto-wave/pattern-scan/chart-core 새 선정 코드 제공 확인. 실제 ghlee.tistory.com/page/pattern-scan에서 PC1440/모바일390×5개 메뉴가 각43/51/60/60/6 후보를 표시하고 집계 known=true·검색기 가로 넘침 없음 확인. 눌림 후보 KT&G 상세 차트·근거 패널 및 캔버스 로딩 확인. 웹 운영 반영 완료. GitHub 공식 상태에서 Actions/Pages 성능 저하 확인(01:05 KST 공지); 웹 배포 지연과 코드/서버 반영을 구분한다.

**2026-11-05 추세선·전체 검색기 모양 우선 공통 적용**

요청: 숫자보다 모양·흐름·맥락 우선, 전체 검색기 공통 적용. 변경: 기존 auto-wave에 공유 shapeOf(기울기 중앙값·방향 일관성·저점/고점 흐름·상승 뒤 조정/반등·변동폭 축소), 공통 추세선 강건 적합·명확한 짧은 구조 허용/긴 잡음 제외, 검색기 5개 메뉴 동일 상태 안의 기존 후보 모양 정렬·종가 형태 설명·자료/로딩 실패 구분. 원래 탐지·확정/재무·집계·주문 조건 및 5봉 투영 보존, 신규 API 호출/VM 변경 없음. 검증: 신규 모양·기존 public_states/groups/loading·chart_studies/trend_local·auto_wave/causality 통과, PC/모바일 검색기 10조합 라벨/넘침0·오류0·주문요청0, NVDA 실제 일봉 차트 렌더 확인. 범위: 기존 후보의 최근20일 종가 비교이며 전종목 신규 탐지·수익성 검증 아님. 배포: master→Pages, 운영 파일 일치는 최종 보고 기준.

**2026-11-04 자동매매 14:00 절대 종료·영구 웹 중지·봇/엔진 주문 공통 방어**

요청: 단타 2차 필터 실코드 확인, 14:00 시간 우선 종료, 웹 중지는 사용자 시작 명령 전까지 Runner·봇 주문 모두 차단, 매도 충돌 방지, 잘못된 웹 중지 문구 수정, 실거래 스윙/중장기 우선순위·신호 안전 경계 일치. 변경: `autotrader-private/main`의 `order_guard.py` 공통 14시·수동중지·STOP·OS 주문 잠금, `live_runner.py` 14시 종료, `live_engine.py` 검색기 화이트리스트·스윙 우선·진입 게이트, `ninepay_signal_client.py` shadow/무효·14시 이후 거부, `ninepay_trade.py` 최종 게이트, `bot.py` 엔진 보유 자동 매도 차단, `control/control_agent.py` 영구 중지·수동 시작 및 sudoers 명세, 텔레그램 안내. `tistory-ticker/master`의 `autotrader_control.py` 수동 재시작 허용, `auto-trader.js` 상태·확인창 및 테스트·규칙 문서 정합화. 단타 A/B가 기존 2차 신호이며 20일 거래대금/추세 최종 필터는 별도 검증 전 임의 추가하지 않음. 검증: [비공개 안전 CI](https://github.com/goodbyestarwars/autotrader-private/actions/runs/41847575107), [공개 제어 CI](https://github.com/goodbyestarwars/tistory-ticker/actions/runs/41847715113) 통과(모의/구문). 배포: GitHub 각 기본 브랜치 직접 반영, Pages 자동 빌드 대상, Google VM 자동 pull 대상. **미완료/운영 확인 필요**: VM git SHA·프로세스/장부·서버 설치 sudoers 재등록(기존 설치본은 교체되지 않음), 11/05 장중 신호·수동 중지·재시작 관측; VM 실계좌 주문·재시작 직접 실행 없음. `LIVE_SELL`·승인/계좌/.env/장부 값 변경 없음.

**2026-11-04 파동 눌림목 계산·후보/확정 라벨**

요청: 상승 후 조정 구간에 ‘눌림목’ 표시. 변경: 기존 auto-wave 파동·지표를 재사용해 상승폭·25~75% 되돌림·시작 저점 유지·거래량 변화·반등 확정을 계산하는 보조 메타데이터, 공통 오버레이의 눌림목/후보 라벨 및 대파동 툴팁 근거, 엔진/모듈 캐시 버전 갱신. 기존 극점·파동 label 계약·신호·색·추세선 유지. 검증: 신규 pullback 시험·기존 wave/차트/국소 추세 회귀 통과, 실제 27개 차트 32,604 파동 메타데이터 미래 안정성 검증, 실제 사례 PC1260/모바일374 라벨 표시 확인. 세부 기준: AUTO_WAVE_VALIDATION_2026-10-13.md. 배포: master→Pages 자동 배포, 운영 파일 확인은 최종 보고 기준. 실계좌·주문·API/VM 변경 없음.

**2026-11-04 홈 미국 세 번째 카드: 정규장 전후 다우 선물 / 정규장 SOX**

요청: 미국시장 3개 카드 중 세 번째를 정규장 시작 전 다우존스30 선물(CME YM), 정규장 중 필라델피아 반도체(SOX)로 자동 교체. 변경: `js/skin-main.js`에서 공통 `MarketHours.us()`(뉴욕 시간·DST·휴장·조기 마감)를 기준으로 DOW↔SOX 전환, 카드명·시세·상태·차트를 같은 슬롯에서 교체. 기존 `quick-indices`/`foreign_futures`의 `DOW` 시세를 재사용하고 신규 수집 호출 없음. DOW 30분 관측값은 현재 `home_session_chart.py` 수집 대상이 아니므로 해당 데이터가 없는 동안 `/futures`의 실제 일봉 차트로 표시(30분 그래프인 것처럼 가장하지 않음), 기존 SOX 30분 차트 유지. 검증: JS 파싱 성공 및 EST/EDT 개장·마감·휴장·조기 마감 8경계 판정 통과, `test/test_home_us_third_index.js` 10조건/DOM 계약 회귀 추가(실행 환경에서의 Node 테스트와 PC/모바일 실제 운영 화면은 미확인). 배포: `master` Pages 반영 대상. VM·실계좌·주문 변경 없음.

**2026-11-04 추세선 짧은 구간 제외·현재 추세 5봉 투영**

요청: 상승 빨강·하락 파랑, 너무 짧은 추세 제외, 현재 기울기를 3~5봉 앞까지 표시. 변경: 공통 chart-wave-overlay에서 15봉 미만·화면 36px 미만 국소 선 제외, 최근 5봉 이내 끝난 유효 선은 현재 종가까지 검증 후 5봉 점선 투영(가상 가격봉 생성 없음), 진행 채널 최근 2봉은 적합에서 분리하여 허용치 2봉 연속 이탈 시 양 경계 투영 중단·이탈 표시. core 공통 초기 표시 우측 여백 3→6봉·모듈 버전 갱신. 검증: chart_studies·local 회귀 통과(빨강/파랑·미래 논리좌표 정확히 5봉·짧은 선 제거·완료구간/이탈 투영 금지), NVDA 실제 501일봉 및 Lightweight Charts 5.2 PC1260/모바일374 렌더·투영 좌표가 plot 안임·브라우저 오류0 확인. 배포: master→Pages 자동 배포, 운영 파일 일치 여부는 최종 보고 기준. 주문/API/VM 변경 없음.

**2026-11-04 자동매매 운영센터 중지 안내 사실 정정(제어 정책 변경 없음)**

목적: 현재 VM 중지 명령은 Runner 서비스만 정지하며 다음날 타이머·별도 봇 매도가 유지되는데 웹에는 영구 중지로 오표기된 위험 해소. 변경: `js/auto-trader.js`에서 상태 안내·중지 확인문·주석을 현재 동작에 맞춰 정정하고 전체 주문 지속 중지 기능 미적용 경고를 명시. 검증: GitHub 반영본 문구·이전 잘못된 문구 부재 확인, Node/브라우저 회귀 미실행. 배포: master→Pages 자동 반영 대상, 실제 운영 화면·캐시 반영 미확인. **실계좌 엔진·봇·타이머·주문 경로 변경 없음.**

**2026-11-04 차트 추세선 국소 파동·평행 채널·횡보 경계 보존**

목적: NVDA 1년 일봉의 손그림처럼 여러 상승·조정·횡보를 함께 표시. 변경: 공통 `chart-wave-overlay.js`에서 선택 규모의 숨겨진 방향 파동도 국소 분석, 회귀 방향과 양쪽 분리 접점으로 평행 경계 검증(단발 꼬리 5% 완화·연속 종가 위반 제외), 과거 구간 종료·보조 장기선 이탈 후 8봉 제한·유사 선 중복 제거·18px 미만 숨김. 기존 up/down 계약·이탈 판정·의미색·진행 점선 유지, core 모듈 버전 갱신. 검증: 기존 chart_studies 전체 및 신규 local 다중 파동/평행/횡보/진행/완료구간 안정성/결측/일봉 픽스처 통과. 운영 읽기 전용 NVDA 501일봉 분석·PC 1440/모바일 390 캔버스 렌더 확인(사이트 전체 상호작용 검증과 구분). 배포: master→Pages 자동 배포, 운영 자산 해시 확인은 최종 보고 기준. VM/API·실계좌·주문 변경 없음.

**2026-11-04 Oracle 종목 스토리 격주 타이머 설치**

목적: 금융 키 Oracle 전용 수집·검증·공개 JS 배포 자동화. 변경: `scripts/oracle-stock-stories/` oneshot/timer·격리 실행기·설치기, 잠금/중단·수기 보존·감소 차단·응답/JS/단위 테스트·동시 master 변경 차단·Pages 해시 확인. 공통 scheduled_job/snapshot_io와 기존 생성기를 재사용하며 실거래/주문 경로 변경 없음. 검증: 안전 회귀 3+기존 9건, calendar/verify·enable/active·11/08 10:00 KST·날짜/실제 잠금 skip. 첫 수집/Pages는 운영 후속 검증 기록에서 확정한다. 배포: master 및 Oracle 타이머 등록, API 재시작 없음.

**2026-11-04 종목 스토리 금융 키 Oracle 전용 전환 · GitHub Actions 수집 폐지**

사용자 보안 지시: 키움 API 키를 GitHub에 두지 않음. 변경: `.github/workflows/stock-stories-fortnightly.yml` 삭제로 Actions 키 요구·예약/수동 실행 경로 제거, `CLAUDE.md`에 Oracle 전용 키 정책, `docs/ORACLE_STOCK_STORY_REFRESH.md`에 서버 Claude Code 설치 지시서(2026-11-08부터 격주 일요일 10:00 KST systemd, 기존 API 3종 읽기 전용, 격리 수집·검증 뒤 공개 카드 JS만 push) 추가. GitHub 키 업로드 없음. 검증: 해당 워크플로 삭제 커밋과 정책·지시서 원본 확인. 배포: `master` 문서/워크플로 직접 반영. **미완료: Oracle systemd 등록·첫 수집·Pages 갱신은 서버 Claude Code 실행/운영 확인 필요**. 기존 카드와 실거래 주문 기능은 변경하지 않음.

**2026-11-04 자동매매 보류·중지·알림·봇 매도 (autotrader-private + 문서)**

요청: 신규 매수 보류(`HOLD_BUY`), 중지는 오늘만(타이머 유지), 텔레그램 오경보 정리, 활동 내역 업로드 확인, 봇 매도 켜기, PC 표기 정정. 변경(비공개 저장소 `autotrader-private` main): `control/control_agent.py` — `hold`/`resume`(HOLD_BUY 원자 저장·삭제, ack), `snapshot.capabilities=["hold"]`·`flags.hold`, `stop`은 `autotrader-live.service`만 정지(타이머 유지)하고 `MANUAL_STOP` 표시 기록, `start` 때 삭제, sudoers에서 `disable --now timer` 제거(VM 설치본은 미교체). `live_engine.py`·`ninepay_trade.py` — `hold_buy_active()`(오늘이면 신규 매수만 건너뛰고 사유 `HOLD_BUY` 기록, 파일 불량=보류, 날짜 지남·없음=무시, 청산·정합 무변경, ninepay는 브로커 호출 전과 주문 직전 2회 확인). `tg_live_status.py`·`tg_monitor.py` — "응답 없음" 문구에서 PC 절전/AutotraderLiveTrading 제거, 직접 중지(MANUAL_STOP 또는 서비스 inactive+ExecMainStatus 15)는 "직접 중지됨" 1회. `bot.py` — `live_sell_enabled()`가 `.env`의 `LIVE_SELL`(1/true/yes/on)을 읽도록 변경(사용자 승인, 감시 목록 확정 종목만 대상이며 현재 감시 목록 비어 있음, 켜면 모의 실매매 엔진 live_paper는 LIVE_SELL_ACTIVE로 중지). 활동(주문·보유·후보) 업로드는 d887834로 main 반영 확인. 커밋: d887834(활동 업로드), e4a79c0(보류·중지·알림), 6319dc4(봇 매도 스위치). 운영: VM `.env`에 `LIVE_SELL=1` 추가(백업 `.env.bak-livesell-20261104`, 권한 600), `autotrader-deploy`가 e4a79c0을 19:34 KST, 6319dc4를 20:51 KST에 수신, 봇 재시작 20:52(START "실주문 ON(매도 전용)"), 모두 장외. Oracle `kiwoom-api/.env.bak-20261104-071218`(키 포함 백업)은 사용자가 직접 삭제. 문서: PR #1148 — `LIVE_OPERATIONS.md` 전면 개정(실행 위치=자동매매 Google VM, 이력 표의 PC는 이전 위치 표시), `SERVICE_MAP.md` PC 표기 7곳 정정. 검증: `test_hold_buy.py` 12개 통과(오늘/어제/깨진 파일/없음, 매도 경로 무변경, hold→파일→ack→resume 왕복, 직접 중지 판정), 기존 4개 테스트 파일 실패 12건은 Windows 기준선과 동일, VM py_compile·제어 에이전트 1회 실행 종료코드 0. 미검증: 실주문 경로(보류 포함)는 11/05 08:55 첫 실행에서만 확인 가능, 운영센터 보류 버튼·내역 표는 관리자 로그인 화면에서 미확인, 새 sudoers 미설치, 셀트리온(068270) 장부 OPEN 4주는 사용자가 수동 매도했으므로 다음 엔진 점검에서 CLOSED 정리될 예정(미확인). 배포: autotrader-private은 위 시각 자동 반영, tistory-ticker 문서는 PR #1148 병합.

**2026-11-04 운영센터 보류 표시: 에이전트가 보류 파일 불량을 보고하면 '보류 중'으로 표시**

**2026-11-04 종목 스토리 기본 카드 전 종목 노출·격주 주말 재생성 예약**

원인: 11/3 전체 2,696종목 수집 중 1,308종목만 심층 카드 생성; 셀트리온(068270)은 색인·분할 파일 모두 없어 카드 전체가 숨겨짐. 변경: `js/foreign-flow.js`는 심층 카드가 없거나 로딩에 실패해도 이미 조회한 스윙 판정·일봉 차트가 있으면 '종목 분석' 기본 카드로 표시(기존 공통 캐러셀·심층 카드는 그대로, 추가 API 호출 없음), `test/test_stock_stories.py`에 셀트리온 회귀 추가. `.github/workflows/stock-stories-fortnightly.yml`은 2026-11-08부터 격주 일요일 10:00 KST(GitHub Actions, 키움 읽기 전용 인증은 Actions secrets, 실행 예외는 수동 dispatch) 전체 스냅샷 생성·테스트·전번 대비 카드 수 15% 초과 감소 차단·종목별 파일 무결성 점검·변경분 master 반영·Pages 빌드 요청. `deploy_check.sh`에서 스토리 정적 데이터는 Oracle API 재시작·검색 재스캔 감시 제외, `CLAUDE.md` 배포 규칙 반영. 검증: JS 구문 검사·기존 스윙/차트 데이터로 셀트리온 기본 카드 노출 자체 모의 실행 성공. 배포: master 직접 push, Pages 운영 응답 확인 불가. 미완료: 키움 GitHub Actions secrets 존재 여부 미확인, 격주 실제 실행·새 스냅샷 생성 및 운영 페이지 표시 확인 필요. 실계좌·주문·API 공급자 변경 없음.

**2026-11-04 자동매매 운영센터 화면 단순화**

요청: 상태 한 줄·시작/중지·매매내역·로그만. 변경: `js/auto-trader.js`에 상태 한 줄(`statusLine`, 기존 필드 조합·직접 중지(SIGTERM 15)는 장애와 구분)·명령 기록 목록, 기존 상세 칸과 보류 버튼은 접기, `autotrader_control.recent_log`(감사 로그의 최근 명령·계정은 @ 앞만)을 `/autotrader/status.log`로 제공, `css/auto-trader.css` 보강, `test_auto_trader_research_ui`의 허용 명령 목록을 hold/resume 포함으로 갱신(앞선 보류 변경이 깨뜨린 테스트). 검증: control 19개·UI 10개·research UI 8개·주문 JS 통과, 390px/1100px 렌더 가로 넘침 없음. 배포: master 병합 시 Pages/Oracle 반영(Oracle 재시작은 장외). 미완료: 매매내역은 VM 에이전트가 내역을 올려야 채워짐, `stop`이 타이머를 끄는 동작 변경은 에이전트 쪽(작업지시서에 추가).

**2026-11-04 국내 뉴스 같은 매체 같은 제목 중복 제거**

요청: 주요 뉴스에 같은 제목이 반복 표시. 원인: `/domestic-news`의 중복 판정이 링크 기준이라, 연합뉴스가 같은 제목을 기사 번호만 달리 여러 건 내면(PYH…) 모두 통과. 변경: `domestic_news._merge`에 같은 매체·같은 제목(공백·구두점 무시) 묶기 추가(공시 제외, 다른 매체의 같은 제목은 유지, 같으면 직접 관련 우선·최신 유지). 검증: `test_domestic_news` 23개(신규 2)·warmer 통과, 실제 응답 25건→17건(쿠팡 12건→4건) 재현 확인. 배포: master 병합 시 Oracle `kiwoom-api` 재시작되므로 장외(15:40 이후)에 병합.

**2026-11-04 운영센터 '오늘 신규 매수 보류' (Oracle 쪽 선구현)**

요청: STOP 파일을 수동으로 만들지 않고 웹에서 당일 신규 매수만 보류. 변경: `autotrader_control.py`에 `hold`/`resume` 명령(대상 에이전트가 `capabilities`에 `hold`를 올릴 때만 접수, 날짜(KST)·scope=buy 동봉, 보류 여부는 에이전트 보고값이고 날짜가 오늘이 아니면 무효), `js/auto-trader.js` 버튼·확인창·상태 칸, 테스트 5개, VM 쪽 작업지시서 `docs/AUTOTRADER_HOLD_AGENT_SPEC_2026-11-04.md`. 검증: `test_autotrader_control` 18개·`test_auto_trader_ui` 10개·주문 JS 통과. 배포: master 병합 시 Oracle/Pages 반영, **에이전트·엔진 미반영이라 버튼은 비활성**(실주문 코드 diff 승인 대기). 미완료: 에이전트·엔진·텔레그램 문구(비공개 저장소).

**2026-11-04 구성 문서 정정·자동매매 경고 문구 정정**

요청: GCP 자동매매 점검 중 문서와 실제 구성 불일치 발견. 변경: `CLAUDE.md`·`docs/SERVICE_MAP.md`·`LIVE_OPERATIONS.md`의 백엔드=Oracle A1·자동매매=전용 Google VM(2026-10-30 인계 기준) 정정, `tg_live_status.fmt_stale`·`tg_monitor` 연구 경고의 "PC 절전" 문구를 VM 기준으로 변경(판단·주기 로직 무변경, 주문 코드 무변경). 검증: 아래 기록. 배포: 알림 문구는 autotrader-private 반영 필요(이 저장소 push는 VM 자동 반영 아님), 문서는 즉시. 미완료: 수동 중지를 경고에서 구분하는 상태 표식(비공개 control-agent 쪽 설계 필요).
