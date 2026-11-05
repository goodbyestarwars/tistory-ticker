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

**2026-11-04 차트 추세선 재설계: 저점/고점 추세선 + 이탈·전환 판정**

요청: 박스 안 채널은 추세선이 아님, 허용 오차 안에서 일직선을 이탈하면 '추세 이탈'. 변경: `js/chart-wave-overlay.js`의 `channelOf/fitLine`을 `trendLinesOf`로 교체(상승=저점끼리 붉은색, 하락=고점끼리 파란색, 현재 봉까지 연장). 허용 오차 ATR14 기준(닿음 max(0.5ATR,1.5%), 이탈 max(1ATR,2.5%) 종가 2봉 연속), 닿음 3회↑ 실선·2회 점선, 이탈 라벨·추세 전환 라벨·이탈 후 옅은 점선. 파동 엔진·VM/API 변경 없음. 검증: `test/test_chart_studies.js`(추세선 시험으로 교체, 상승/하락/하루 이탈 무시/2봉 이탈/데이터 부족) 통과. 미확인: 실제 종목 일봉에서의 임계값 적합도·PC/모바일 실화면, `test_site_guide_chart.js`는 변경 전부터 실패(가이드 '2026년 10월 26일 업데이트' 문구). 갱신: UI_GUIDE·이용방법·릴리스 노트. 배포: master→Pages.

**2026-11-04 국내 시세 세션 표기 후속 적용(홈·관심종목·툴팁)**

목적: 정규장/애프터마켓·거래소 표기를 남은 화면에도 공통 함수로 적용. 변경: `krQuoteSession`에 `clockOnly` 옵션(시세 근거 없을 때 '애프터마켓 시간대'처럼 시간대만), `js/home-realtime-table.js` 제목이 이를 사용, `js/watchlist.js` 국내 카드 배지와 `js/ticker-tooltip-v5.js` 기준시각이 공급자 `market_state` 있을 때 같은 문구 사용. 시세·등락률 계산, WebSocket/REST, 호출량, 주문 로직 변경 없음. 검증: `test/test_kr_quote_session.js` 17건·`test_closed_countdown.js` 통과, 변경 JS node --check. 갱신: 이용방법·릴리스 노트. 미확인: 실화면 PC/모바일 줄바꿈(병합 후 확인). 배포: master→Pages(미머지).

**2026-11-04 운영센터 내역 보강: 번호·평단·추천 이유·기간 CSV**

요청: 주문 번호·시간·평단·보유수량, 추천 종목의 검색기·이유·추천 단가, 기간 선택 다운로드. 변경: 에이전트가 주문 순번(`no`)·보유 평단(보유수량을 채우는 최근 매수 주문가 가중평균 추정)·후보 선정 이유(`reasons`)·과거 후보 20거래일(30분마다)을 올리고, `autotrader_control.py` 허용 목록·history 유지·주문 상한 400, `main.py` 본문 상한 256KB. `js/auto-trader.js`: 번호 열, 보유 수량·평단가(추정), 검색기별 후보 표(점수·추천 단가·이유), 기간 선택 + 주문/추천 CSV(UTF-8 BOM). 한계: 장부가 주문 접수 기록뿐이라 주문별 체결가·평단·손익은 없고, 보유 평단은 주문가 기준 추정이다. 검증: `test/test_autotrader_control.py` 13건, 렌더·CSV 단위 확인, VM에서 에이전트 `activity()` 실측. 미확인: 로그인 상태 실제 화면. 배포: master→Oracle·Pages, 에이전트 autotrader-private main.

**2026-11-04 운영센터 주문 내역·보유·연구 후보 표시**

요청: 매매내역 표시, 최근 30건+더 보기, 텔레그램 추천 종목을 접는 리본으로. 변경: 에이전트(autotrader-private `control/control_agent.py`)가 장부 `live_orders.db`(최근 주문 200건·열린 보유)와 `research/research.db` 최신 후보를 읽기 전용으로 올린다(주문번호·상세·비고·계좌·잔고는 읽지 않음). `scripts/cloud-vm/autotrader_control.py`에 `sanitize_activity`(허용 필드만·행 수 상한)와 `/autotrader/status`의 `activity`(수신 중일 때만), `main.py` 동기화 본문 상한 64→128KB. `js/auto-trader.js`·`css/auto-trader.css`에 주문 표(30건+'더 보기' 접힘 유지)·보유 표·연구 후보 리본. 기존 죽은 `ordersHtml`은 데이터 모양이 달라 재사용하지 않았다. 검증: `test/test_autotrader_control.py` 12건, 렌더 단위 확인(30행+더 보기 5건), VM에서 `activity()` 9.8KB(주문 35·보유 1·후보 42) 실측. 미확인: 로그인 상태의 실제 화면. 제외: 체결가·손익(장부에 없음). 배포: master→Oracle·Pages, 에이전트는 autotrader-private main→VM 자동 반영.

**2026-11-04 국내 시세 세션·거래소 표기 공통 함수**

목적: 사용자가 보는 국내 가격이 정규장인지 애프터마켓인지, 어느 거래소 값인지 혼동하지 않게. 변경: `js/skin-shell.js`에 `MarketHours.krQuoteSession(quote)` 추가(공급자 `market_state`·`price_session`·`exchange` 근거로만 프리/애프터 표기, 네이버 NXT 시간외 값은 '애프터마켓 · NXT', 거래소 불명은 거래소 생략, 시계만으로 애프터 판정 안 함, 20:00 이후 '장 마감', 휴장), `js/foreign-flow.js` 종목 상세 `quoteStatusLabel`이 이를 사용. 시세·등락률 계산, WebSocket/REST, 호출량은 변경 없음. 검증: `test/test_kr_quote_session.js` 13건·`test_closed_countdown.js` 통과, `test_market_hours.py`는 Windows subprocess 오류 6건이 변경 전과 동일. 미적용: 홈 실시간 표 제목(시계 기반 세션명 유지)·관심종목 국내 행·티커 툴팁(세션 문구 없음, 후속). 갱신: 이용방법(`legal/guide.html`)·릴리스 노트. 배포: master→Pages.

**2026-11-04 미국 종목 거래량 기준 표기 · SPCX 마감 비교**

요청: 한투 거래량이 일봉보다 낮아 보이는 문제 확인. 비교(11/3 마감 후): 한투 71,164,835 = Yahoo 정규장 71,164,835, 토스 61.7M(약 13% 낮음, 다른 피드). 장중 차이(한투 39.9M·토스 47.5M·Yahoo 55.6M)는 소스별 반영 지연. 변경: `js/us-stocks.js` 거래량 옆에 '(마감 전 누적)'(장중)·'(정규장 누적)'(마감 후) 표기, 출처 교체 없음. 검증: node --check. 배포: master→Pages.

**2026-11-04 거래량 게이지 3칸 규칙 위치 수정**

원인 정정: 직전 변경에서 3칸 규칙이 `@media (max-width: 600px)` 블록 안에 끼어 들어가 데스크톱에 적용되지 않았다(`:has()` 때문이 아님). 변경: `css/home-market-board.css` 3칸 규칙을 미디어 블록 앞으로 옮기고 모바일용 한 줄만 블록 안에 둠(중괄호 균형 확인). 검증: 배포 후 라이브 계산값 확인 예정(아래 보고). 배포: master → Pages.

**2026-11-04 거래량 게이지 3개 한 줄 · KOSPI200 야간선물 카드 축소**

요청: 필라델피아 반도체 게이지를 옆으로 한 줄에, 야간선물 카드가 너무 큼. 원인: 3칸 확장을 `:has()` 선택자로 걸어 운영 CSS에서 적용되지 않아(같은 규칙을 주입하면 적용) 게이지가 2+1로 줄바꿈. 변경: `js/skin-main.js`가 게이지 3개일 때 `.has-three-gauges`를 붙이고 `css/home-market-board.css`가 그 클래스로 칸 폭 176px(국내 2개는 그대로). 야간선물 카드는 가격·등락·고저(왼쪽)와 30분 차트(오른쪽)를 2열로 두고 차트 높이 90→64px, 고가·저가와 중복인 차트 아래 "관측 고점/저점" 줄 숨김, 모바일(≤640px)은 기존 세로 배치. 측정(라이브 주입): 카드 높이 345→약 285~298px. 검증: 구문·`test_market_participation*.js` 통과. 미확인: 배포 후 실화면(PC/모바일). 배포: master → Pages.

**2026-11-04 의회 거래 링크: 하원 공식 → Capitol Trades 검색**

요청: 하원 공식 자료는 원천 데이터라 쓰기 어렵고 종목별 매칭 필요. 변경: `js/us-stocks.js` `renderCongressLinks`에서 하원 공식 링크를 `capitoltrades.com/issuers?search=티커`로 교체(검색 결과가 종목 1건, TSLA→435211 등 4종목 확인; 번호는 내부 ID라 티커로 직접 못 만듦). Quiver 종목 링크는 유지. 미확인: 운영 화면 클릭. 배포: master → Pages.

**2026-11-04 미국 시장 카드에 필라델피아 반도체(SOX) 추가**

요청: S&P 500·나스닥 거래량 게이지에 필라델피아 반도체도. 변경: `scripts/cloud-vm/us_market_breadth.py` 지수 목록에 `SOX`=`NASDAQ:SOX`(TradingView 스캐너, 라이브 확인: 30종목 전부 거래량·평균 대비 값 있음, `CBOE:SOX`는 0건), 갱신당 외부 요청 2→3회·기존 2분 캐시 유지. `js/skin-main.js` 거래량 게이지·상승/하락 막대 행에 SOX 추가(시장 방향 계산은 S&P 500·나스닥 종합 두 지수만 유지), `css/home-market-board.css` 게이지 3개일 때만 칸 폭 116→176px(국내 2개는 그대로). 검증: `test_us_market_breadth` 14건·`test_market_participation*.js` 통과, 라이브 페이지에 CSS 주입해 3칸 폭 176px 확인. 미확인: 서버 반영 후 실제 SOX 값, PC/모바일 실화면. 배포: master → Pages·VM 자동 배포.

**2026-11-04 의회 거래 공식 링크를 검색 화면으로**

요청: 하원 공식 링크가 안내문만 있는 화면이라 어떻게 보는지 모르겠음. 변경: `js/us-stocks.js` 링크를 `ViewReport`(안내 페이지)에서 `ViewSearch`(성·연도 검색, 200 응답·LastName 입력 확인)로, 문구를 "미 하원 공식 신고 검색 · 의원 성·연도로 검색 → 거래 보고서(PDF) 원문"으로. 미확인: 운영 화면 클릭·검색 화면 렌더. 배포: master → Pages.

**2026-11-04 내부자 공시 내역을 모달로**

요청: "내부자 공시 내역 (176건)"을 모달로. 변경: `js/us-stocks.js` 카드 안 접이식 목록(`<details>`)을 "내부자 공시 내역 (N건) 보기" 버튼으로 바꾸고 클릭 시 모달(`openInsiderModal`, 바깥 클릭·✕·Esc 닫기, 내용·SEC 원문 링크·완전성 안내 유지), `css/us-stocks.css` `.us-modal*`(공통 면 토큰, 다크·모바일). 검증: 구문 검사, `test_us_orderbook_refresh` 통과. 미확인: 운영 화면 클릭·모달 렌더(PC/모바일/다크). 배포: master → Pages.

**2026-11-04 미국 애널리스트 기관별 의견 문구 · Finnhub 무료 범위 재확인**

요청: "권한 미확보" 문구 변경, 무료 여부 재확인. 변경: `js/us-stocks.js` 기관별 투자의견 머리말을 "제공하지 않음"으로(코드 `access_denied` 처리는 그대로). 확인(2026-11-04 Finnhub 공식 문서 사이드바): Recommendation Trends는 Premium 표시 없음(무료), Upgrade Downgrade·Price Target은 Premium. 한도: 전 플랜 초당 30회 상한(무료 분당 한도는 문서에서 못 찾음). 미확인: 무료 키 데이터의 사이트 재표시 약관. 배포: master → Pages.

**2026-11-04 미국 호가강도를 10단계 총잔량 비율로**

요청: 미국 호가강도가 초 단위로 요동침. 원인: 매도·매수 각 최대 한 칸끼리 나눈 값이라 주문 한두 건에 크게 변동. 변경: `js/us-stocks.js` 호가강도·우위 문구를 10단계 총잔량(매수÷매도) 기준으로(저항·지지 막대는 기존 최대 한 칸 그대로). 검증: test_us_stocks.py 15 passed, 실제 화면 확인 미실시. 배포: master → Pages.

**2026-11-04 업종 표 거래대금 배수 한 줄 표시**

요청: `1.34배`가 `1.34`/`배` 두 줄로 꺾임. 변경: `css/home-market-board.css` 업종 행 마지막 열을 고정폭에서 auto로, 등락률·배수에 nowrap. 검증: 열 폭 합산 계산상 390px 행 폭(234px) 이내, 실제 화면 확인은 미실시. 배포: master → Pages.

**2026-11-04 홈 지수 차트 면적/막대 전환을 카드별로 분리**

요청: 한 카드에서 면적/막대를 바꾸면 다른 카드까지 전부 바뀜. 원인: `homePriceMode` 하나를 모든 세션 차트가 공유하고 토글 시 전체 재렌더. 변경: `js/skin-main.js` `homePriceModes[차트키]`로 카드별 저장(`homeModeOf`, 미선택 차트 기본값은 기존 `homePriceMode`=면적), 클릭 시 해당 차트만 다시 그림(렌더러·DOM 계약 그대로). 검증: test_home_session_chart 통과(test_home_chart_history 실패는 기존 기준선), 실제 화면 클릭 확인은 미실시. 배포: master → Pages.

**2026-11-04 주도·주의 업종 막대를 행 옆으로**

요청: 업종 밑이 아니라 옆에 그래프. 변경: `css/home-market-board.css` `.hus-rot-list li`를 업종명·막대·등락률·배수 4열 그리드로 바꿔 막대를 같은 줄에 배치(막대 8px, 중앙 기준선 유지). 검증: 1400px 막대 48~51px·390px 69~72px, 가로 넘침 없음. 배포: master → Pages.

**2026-11-04 홈 미국 지수 3카드 차트·설명 가로줄 정렬**

요청: 나스닥·S&P500·SOX 카드의 그래프와 설명 줄 높이가 서로 어긋남. 원인: 현재가·등락률이 숫자 길이에 따라 한 줄/두 줄로 달라 아래 전부가 밀림. 변경: `css/home-market-board.css` 미국 모드 3열(>560px)에서 가격 행을 항상 두 줄(column)로 고정. 검증: 1400px에서 세 카드의 컨트롤·차트·축·고저·기준 줄 위치(카드 상단 기준)가 모두 동일(101/137/227/246/268px). 배포: master → Pages.

**2026-11-04 모바일 미국 의회 거래 공시 칸 축소**

요청: 미국 의회 공시 칸이 모바일에서 큼. 변경: `css/us-stocks.css` ≤700px에서 링크 2개 나란히·보조 설명 줄 숨김·안내문 2줄 클램프(링크·문구 자체는 그대로). 검증: 라이브 AAPL 390px에 CSS 주입해 칸 높이 245→143px, 가로 넘침 없음. 배포: master → Pages.

**2026-11-04 홈 SOX 카드도 나스닥·S&P500과 같은 30분 세션 차트로**

요청: 필라델피아 지수도 옆 카드와 같은 정보·같은 그래프. 변경: `scripts/cloud-vm/home_session_chart.py` `US_SPOT`에 SOX 추가(기존 foreign_futures 수집 루프가 이미 받는 .SOX 시세의 정규장 30분 관측값을 같은 방식으로 기록, 새 호출 없음), `js/skin-main.js` 세션 차트 키에 SOX 추가. 검증: test_home_session_chart 15 passed(기존 실패 1건은 Windows AF_UNIX). 주의: SOX 세션 기록은 VM 배포 이후 장중부터 쌓이므로 첫 장중에는 차트가 짧게 보일 수 있음. 배포: master → Pages·VM 자동 배포.

**2026-11-04 미국 종목 상세 모바일 분석 카드 높이 축소**

요청: 모바일에서 기본 재무·재무 흐름·실적 일정·애널리스트·내부자 거래가 줄을 너무 많이 차지. 변경: `css/us-stocks.css` ≤700px에서 2열 격자(합 약 1,100px)를 1열 가로 행으로(라벨·값 한 줄, 상세 한 줄, 출처 문단 1줄 클램프, 애널리스트 도넛 56px 가로 배치). 내용·데이터·출처 접힘은 그대로. 검증: 라이브 AAPL 390px에 CSS 주입해 카드 높이 137/137/295/295/252 → 77/77/56/149/177, 가로 넘침 없음(다크 확인). 배포: master → Pages.

**2026-11-04 SOX를 글로벌 지수에서 빼 나스닥·S&P500 옆 세 번째 지수 카드로**

요청: 필라델피아 반도체지수를 글로벌 지수에서 빼고 나스닥·S&P500 옆에 배치. 변경: `js/skin-main.js` 상단 지수 띠에 `data-home-index-slot="tertiary"` SOX 카드 추가(미국 모드에서만, 기존 `/futures` SOX·공통 차트 렌더러, 현물 거래중/마지막 값 표기), 글로벌 지수는 WTI·원/달러·미 10년물·VIX 4종 2×2. `css/home-market-board.css` 미국 모드 지수 띠 3열(>560px)·모바일 1열. 검증: 1400px 3카드 한 줄, 400px 1열·가로 넘침 없음, 국내 모드 2카드 유지. 배포: master → Pages.

**2026-11-04 글로벌 지수에서 현물 지수 제거·SOX 지표 추가 · 업종 표형 막대 · 모바일 야간선물 차트 넘침 수정**

요청: 글로벌 지수의 현물 지수 3종을 빼고 반도체 하나만 지표로 추가, 주도/주의 업종을 표 형태 그래프로, 모바일 야간선물 차트가 카드 밖으로 나오는 문제. 변경: `js/skin-main.js` 글로벌 지수는 WTI·원/달러·미 10년물·VIX·SOX 5개 타일만, 업종은 등락률 0선 기준 양방향 막대 표(두 표 같은 눈금, 등락률·거래대금 강도 열). `css/home-market-board.css` 야간선물 차트 `has-session-chart` 높이·컨트롤 규칙이 보드 범위에만 적용돼 차트(30px 고정)가 카드 밖으로 넘치던 것을 `.home-night-content`까지 확대. 검증: 390px/1400px 가로 넘침 없음, 차트가 카드 안에 포함, 라이브 API 값 일치. 배포: master → Pages.

**2026-11-04 메인 미국시장 개편 · 업종 이동 · 글로벌 지수 · KOSPI200 야간선물 독립 카드**

요청: 미국시장 박스에 주도/주의 업종, '미국 시장 요약'을 '글로벌 지수'로, 경제뉴스 아래 야간선물 카드. 변경: `js/skin-main.js` — 시장 방향·상승/하락 바로 아래에 주도(유입·주도)/주의(둔화·이탈) 업종 각 3개(`/us-sector-rotation`, ETF 확정 일봉·실시간 아님 표기), 요약 칸을 미국 모드에서 '글로벌 지수'로 바꿔 지표 4종(WTI 선물·원/달러·미 10년물 %p·VIX)과 현물 지수 3종(나스닥 종합·S&P500·SOX, 기존 `home-index-card` 모양·PC 한 줄, 현물 거래중/마지막 값·수집시각)을 표시, 기존 핵심 지표 목록은 국내 모드 전용. 야간선물은 `data-home-night-futures`·`nightFutures`·`data-night-futures-chart` 계약을 유지한 채 경제뉴스 박스 아래 독립 카드로 이동(현재가·등락·고저·세션 차트·마지막 수신·거래중/장마감/휴장/미수신, 기존 요약 안 표시는 제거). `css/home-market-board.css`에 공통 `ui-kpi-*` 타일·다크 토큰 추가(`!important` 없음), `js/quick-indices.js`는 `/futures` 요청에 US10Y만 추가. 신규 API: `/us-sector-rotation` 10분 1회(기존 엔드포인트), 그 외 새 호출·수집·WebSocket 없음. 총 거래대금(USD): `/us-market-breadth`·`/market-participation`은 주식 수 기준 거래량뿐이고 시장 전체 달러 거래대금이 없어 생략. 확인 필요: TradingView 기반 상승·하락 집계의 공개 사이트 이용약관·재배포 권한. 검증: 라이브 API 값과 일치, 1400/390px 가로 넘침 없음, 다크 토큰, 국내 모드 무변화(핵심 지표 복귀·신규 요소 숨김), test_home_*.js 기존 실패 3건 외 신규 실패 없음. 미확인: 휴장일 화면·실기기.
**2026-11-04 미국 옵션 카드 늦게 뜸·화면 밀림 개선**

요청: 옵션 종합·감마가 몇 초 늦게 뜨고 한참 뒤 제자리로 돌아감. 원인: `js/us-stocks.js` `loadOptionsCard`가 일부러 2.5초 늦게 요청하고 카드가 `hidden`이라 도착 순간 아래 화면이 밀림(서버 `/us-options`는 캐시 포함 0.15~0.9초 실측). 변경: 요청 지연 2.5초→0.3초, 첫 로드 때 "옵션 데이터를 불러오는 중입니다" 자리표시(`.us-opt-loading`, 최소 높이 280px, 공통 면 토큰)로 높이를 먼저 확보, 실패·옵션 없음이면 다시 숨김. 검증: 구문 검사, `test_us_orderbook_refresh` 9건. 미확인: 운영 화면 체감·자리표시 높이와 실제 카드 높이 차이. 배포: master → Pages.

**2026-11-03 자동매매 제목 글꼴을 다른 도구 화면과 통일**

요청: "자동매매"·"자동매매 운영센터" 제목을 전역 글꼴로. 변경: `style.css` 페이지 제목(`.post-single-title`) 마루부리 Bold 목록 2곳에 `#auto-trader` 추가, 소제목 UI 목록에 `#auto-trader h2`·`.at-brand` 추가(Pretendard 600·`--ui-section-size`). 검증: 로컬 프로브에서 제목=MaruBuriBold 700 24px(종목검색 제목과 동일), 운영센터 제목=Pretendard 600 17px(`.ss-title`과 동일). 미확인: 관리자 로그인 상태의 실제 운영 화면. 배포: master → Pages.

**2026-11-03 Cboe 옵션 요청 실패 기록**

요청: 사용량 집계 없이 Cboe 요청 실패만 남김. 변경: `scripts/cloud-vm/us_options.py` `_fetch_chain` 실패(HTTP 상태, 타임아웃/네트워크 예외, gzip·JSON 오류)를 `us_options` 로거 경고로 기록(`symbol`·사유만, 같은 종목·사유는 10분에 한 번). 성공·호출 횟수는 기록하지 않고 응답·요청 동작은 불변. 검증: `test/test_us_options_overview.py` 6건 통과(중복 억제·타임아웃 기록). 미확인: VM 반영 후 실제 로그 출력(journalctl). 배포: master → VM 자동 배포.

**2026-11-03 경제 이야기 3장 전면 확장 · 짜장면 물가와 계산 실험**

요청: '3장 물가와 인플레이션'을 짜장면 800원의 어린 시절 기억에서 시작해 대학 경제학 수준을 쉬운 이야기로 풀고 그래프·보조 계산기를 늘림. 변경: `learn/econ-inflation.html` 본문 11개 절(물가 수준/상승률, CPI 가중치·라스파이레스, 실질임금·실질금리, 채무 재분배, 수요·비용 충격, 기대·디플레이션, 한국은행 물가목표)·SVG 7개·독자문제 4개; `js/learn-inflation.js` 페이지 전용 입력 계산기 3개; `css/legal.css` 이야기 공통 토큰 기반 PC/모바일/다크 스타일; `learn/economy-story.html` 목차 소개; `data/learn-search.js` 기존 생성기와 동일 규칙으로 색인 갱신. 근거: 800원은 개인 회상값, 1980~1990년 서울연구데이터서비스 역사 가격과 2026-09 서울 평균 7,808원(한국소비자원 참가격 인용 보도)을 명확히 구분. 검증: HTML 내 11개 절·7개 그림·8개 입력·4개 확인문제·이전/다음 링크·출처 존재를 정적 검증, `scripts/build_learn_search.js` 파싱 규칙과 미변경 페이지 검색 색인 일치 확인. 미검증: 실제 PC/모바일·다크 브라우저 렌더, 계산기 실인터랙션 및 Pages 운영 반영(별도 확인 필요). 배포: master 커밋 → Pages 자동 반영 대상, 실운영 반영 미확인.

**2026-11-03 옵션 카드 박스 흰색 공통 면 · 당일 만기 없을 때 빈 칸 제거**

요청: 옵션 종합 칸·지표 타일이 투명해 흰색이 아님, 0DTE 칸이 비면 장애로 오해. 변경: `css/us-stocks.css` `.us-opt-col`·`.us-opt-tiles > div` 배경을 공통 `--ui-card-surface`로; `js/us-stocks.js` 당일 만기가 없으면 가장 가까운 만기의 같은 행사가 표를 '옵션 감마 · 만기 MM-DD'로 보여 주고 '서비스 정상' 안내 문구(행사가가 없을 때도 안내). 검증: 라이브 SPCX에 변경분 주입해 행 17개·머리말·박스 면 토큰 확인(다크 rgb(32,39,49), 라이트 흰색은 토큰 정의대로 미실측). 배포: master → Pages.

**2026-11-03 모바일 홈 시장 카드 가로 넘침 · 모바일 로그인 진입점**

요청: 모바일 홈 미국증시 탭에서 '나스닥100 · S&P500 선물(CME)' 라벨이 카드 밖으로 밀려 페이지가 옆으로 늘어남, 모바일엔 로그인 메뉴가 없음. 원인: `.home-card-heading`이 nowrap 부제와 라벨 때문에 카드(343px)보다 넓은 516px, 모바일(≤430px)에서 헤더 아이콘을 전부 숨김. 변경: `css/home-market-board.css` ≤640px에서 제목 줄 wrap·부제 줄바꿈 허용, `style.css` ≤430px에서 톱니(`.nav-manage-btn`, 로그인 선택창 진입)만 다시 표시. 검증: 라이브 375px에 CSS 주입해 scrollWidth 547→375, 톱니 클릭 시 로그인 선택창 열림 확인. 배포: master → Pages.

**2026-11-03 미국 호가창을 국내 호가창 모양으로 · 세부 시세 삭제 · 지난 만기 제외**

요청: 미국 호가창을 국내처럼(세로 사다리·증감·잔량 합계), 세부 시세 칸 삭제 후 거래량·전일 거래량 대비는 전일 종가 줄로, 새벽에 '당일 만기 없음 · 11/2' 표시 원인 수정. 변경: `js/us-stocks.js` 호가를 `ob-*` 세로 사다리로 렌더(증감은 직전 조회 대비, 실루엣은 `OrderBook.drawSilhouette` 공용 재사용·벽 판정만 미국 기준 전달), 시가·고가·저가는 호가 칸 맨 위(`ss-session`), 세부 시세 칸 삭제; `css/order-book.css`·`css/stock-search.css`의 `#order-book` 하위 규칙을 `:is(#order-book, #usStocksOrderbook)`로 확장(국내 규칙 값 변경 없음); `js/order-book.js`는 `drawSilhouette` 내보내기와 벽 판정 override 인자만 추가; `scripts/cloud-vm/us_options.py`는 뉴욕 기준 오늘보다 앞선 만기(프리마켓에 남은 전 거래일 체인)를 제외. 검증: pytest 26 passed(us_options·earnings), `test_us_orderbook_refresh.py` 9 passed(현재가 행 셀렉터 갱신), 라이브 NVDA에 변경분 주입해 20행 사다리·시가고저 줄·전일종가 줄 확인. 배포: master → Pages, VM 자동 배포(us_options).

**2026-11-03 옵션 패널 열 맞춤 · 호가 여백 · 카드 자동 넘김 10초**

요청: 옵션 종합은 호가 칸 아래, 0DTE 감마는 차트 칸 아래 왼쪽 정렬, 호가 위·아래 여백 동일, 카드형 자동 넘김 10초. 변경: 861px 이상에서 옵션 패널을 호가·차트와 같은 열 폭(--ss-left-width)으로 배치, 호가 줄 52px 고정 후 가운데 모음, `js/foreign-flow.js` 자동 넘김 6000→10000ms. 검증: 라이브 NVDA 1300px에서 CSS 주입(열 x=48/372 일치), 호가 위·아래 여백 68/75px. 배포: master → Pages.

