**2026-11-13 관심종목 서랍 첫 표시·시세 대기 단축**

- 원인(코드 흐름): ① 목록 표시가 `/watchlist`와 중복 로그인 확인 `/auth/google/me` 둘 다를 기다림 ② 국내·미국 시세를 `Promise.all`로 묶어 국내 카드·미국 포함 시 실시간 연결까지 가장 느린 미국 조회(최대 8초)를 기다림 ③ 서랍을 열 때 watchlist.js 73KB를 그때 받고 매번 빈 목록부터 시작.
- 변경: `js/watchlist.js` 목록 성공=세션 확인(/me는 비차단 표시용, 목록 실패 시에만 로그인 판단), 탭 미리보기(`wl_preview_v1`, 코드·이름·그룹만, inert·흐림, 시세 조회·실시간·저장은 서버 목록 확정 뒤 1회, 401/미로그인 시 삭제), `fetchQuotesProgressive`로 국내·미국 도착 즉시 표시(미국 실시간 등록 순서 유지, 공개 fetchQuotes 불변). `js/stock-search-panel.js` 닫힌 서랍은 유휴 시 watchlist.js prefetch만(실행·서버 요청 없음), 자산 `?v=` 갱신. `css/watchlist.css` 미리보기 흐림 1줄.
- 검증: `test_watchlist_loading.js` 10개(미리보기·보유수량 제외·401 삭제·/me 지연 비차단·미국 지연 중 국내 캐시 신규 포함) 통과, startup/group_delete/config/first_paint/readonly·신규상장 회귀 통과, `test_ui_ia.py` 실패 16건은 변경 전과 동일(낡은 토큰 1개 갱신). 실제 관리자 세션 체감 시간은 미측정.
- 배포: master → Pages. VM·GAS·스킨·주문 변경 없음.
- 2026-11-13 후속 UI: 관심종목 서랍 손잡이만 밝은 선홍색 `#FF3B30`·흰색 화살표로 변경. 라이트/다크 공통, 본문 패널 배경·열림 동작 불변. CSS 선택자·다크 우선순위 정적 검증, master→Pages 자동 배포 대상(운영 브라우저 확인 미실시).

