**2026-11-13 선물 수급 당일 확인용 샘플**

- 사용자 승인으로 오늘만 실관측이 없을 때 화면 전용 샘플을 표시. 실제 현재 누적·가격과 구분하고 샘플 문구/끄기 제공. KST 날짜 제한, 실제 이력 우선, DB/API 저장 없음. 기존 공통 차트·주체/구간/누적·시간 연동 재사용. 날짜 경계/실이력 우선/원본 불변·JS 문법 검증 후 Pages 배포.
**2026-11-13 첫 화면 속도 점검·전송량 24% 감소**

- 측정(운영 https://ghlee.tistory.com/ 비로그인, PC 1440, Playwright): 111요청·3,854KB·load 6.2~6.8s. 큰 항목: 정적 `Pretendard-Regular.woff2` 748KB(원인: 랜딩 사진 출처 `Räsänen`의 ä 2글자가 가변 서브셋에 없어 스킨의 정적 pretendard.css로 대체), `landing-murren.jpg` 675KB, 로고 `falcon-logo-source.webp` 276KB(1536×1024를 34~80px로 표시), 명조 서브셋 16개 약 600KB, 티스토리 코드 하이라이트 언어팩 12개.
- 변경: `style.css` 공통 `--font-title/ui/data` 대체 글꼴에서 정적 "Pretendard" 제거(→ Apple SD Gothic Neo/맑은 고딕). `js/access-landing.js` 출처 문구 시스템 글꼴. `img/landing-murren.jpg` 1680px·q70 프로그레시브(675→344KB), `img/falcon-logo-source.webp` 768×512(276→67KB, 배경 % 크롭 비율 동일). `skin.html` 정적 pretendard.css 링크 삭제(운영 수동 반영 대기, SKIN_HTML_PENDING 기록).
- 검증: 같은 운영 페이지에 변경 파일만 바꿔 끼운 비교 — 3,854→2,916KB(−24%), 정적 Pretendard 다운로드 1→0, load 6.2→4.9s(1회 측정, 네트워크 변동 있음). 랜딩 화면 스크린샷 동일(로고 글자 ‘ㄱㅖ조 ㅏ’는 원래 의도된 표기).
- 운영 확인(스킨 반영 후, 2회): 108요청·2,561KB(최초 3,854KB 대비 −34%), 정적 Pretendard·maru-buri 다운로드 0, 글꼴 1,080KB(가변 서브셋+명조), DCL 약 4.9s, load 5.3~7.5s(변동). 남은 선택 정리: hangeul preconnect 한 줄.
- 배포: master→Pages. 미완료: 스킨 링크 수동 삭제, 로그인 후 관리자 화면(API 지연)은 인증 없이 측정 불가, 티스토리 코드 하이라이트 플러그인·광고 스크립트는 사이트 코드 밖.

**2026-11-13 내 카테고리 시총비례 히트맵 카테고리별 구역·활성 종목 묶음 편입**

- 사용자 지적: 시총비례 히트맵이 카테고리 구성과 달리 시총 풀(sectors-v3) 종목만 표시(반도체_전공정장비 7종목 중 주성엔지니어링만)·전체 보기가 카테고리별로 나뉘지 않음. 활성 종목은 하나씩 ＋해야 함.
- 변경: `scripts/cloud-vm/domestic_quotes.py` 같은 네이버 응답의 상장주식수로 `listedShares`·`marketCap` 추가(없으면 생략, 새 호출 없음). `js/marketcap-bubble.js` `codeFilter.groups/extra` 지원(카테고리별 구역, 구역 면적 √시총, 다중 소속 종목은 구역별 노드 키). `js/market-temp.js` 시총비례 히트맵을 카테고리별 구역으로, 풀 밖 종목은 `/sector-quotes` 시총으로 채움(2분 갱신, 숨김·이탈 시 중단), 개수 안내. 활성 종목 편입 후보 업종 제목에 ‘N종목 한 번에 편입’(기존 선택창 재사용, 업종명 새 카테고리 기본). `css/market-temp.css` 버튼 스타일.
- 검증: 실제 네이버 응답 parse → 주성엔지니어링 시총 8.09조(화면 툴팁 8.1조와 일치). Playwright에서 실제 `?bubble=1` 응답+카테고리 3개(풀 밖 6종목 extra)로 12종목·3구역 렌더, 노드 키 충돌 없음. `test_domestic_quotes` 8개 중 fastapi 미설치 1건은 변경 전과 같은 기존 오류.
- 배포: master→Pages 즉시, VM은 deploy_check의 평일 08~20시 보호로 20시 이후 반영(그 전엔 시총 풀 종목만 표시). 운영 브라우저 실측 미확인. 주문 경계 불변.

