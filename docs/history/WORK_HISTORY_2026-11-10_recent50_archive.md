# 과거 작업이력 (최근 50건 유지로 이동)

**2026-11-10 시장지표 요약 박스 제거**

시장지표 전 탭의 요약 박스와 요약 갱신 로직 제거. 표·차트와 국내/글로벌 연결 상태 유지. master → Pages.

**2026-11-10 보조지표 목록 너비 조절**

## 2026-11-11 접근 정책 VM 수동 배포·내부 호출 허용·로그인 유도

- 사용자 지시로 VM(Oracle)에 수동 배포(19:3x KST, 장 마감 후·자동매매 14:00 종료 후). 배포 후 점검이 제한 경로의 X-API-Key 내부 호출을 401로 막는 것을 발견해 main.py에서 비밀 X-API-Key 호출은 통과시킴(PR #1200). 비로그인이 홈·로고·배너를 누르면 로그인 창(NineLanding.showLogin).
- 검증: /access-policy 200, 비로그인 /quote 401, /futures 200, post_deploy_check PASS(/health,/ohlc). 관리자 로그인 화면은 사용자 확인 필요.

## 2026-11-11 시장지표 로그인 후 전환·랜딩 문구/폰트

- 목적: 시장지표는 로그인 후, 비로그인에는 이야기 시리즈. 랜딩 브랜드 문구·폰트 변경, 네이버 버튼 표시 보완.
- 변경: access_policy.py(level public/member/admin), access-gate/skin-menu/home-mobile-tabs/access-landing, 테스트·문서.
- 검증: test_access_policy.py, test_access_gate/menu/landing/kis_menu/early_bootstrap 통과. 배포·운영 확인은 병합 후.

## 2026-11-10 시장지표 Groq 요약 제거

증시자금 참고의견 마크업·렌더링·GAS 호출 제거. Node 구문 검사. master → Pages.

**2026-11-10 저장 시세 캐시 만료 동시 조회 제어**

변경: /futures의 저장 조회에서 동일 키의 캐시 미스를 한 번의 조회·직렬화로 합친다. 공개 요청 제한·응답 계약 유지. 검증: 컴파일, 50개 호출 경로 점검. 배포: master → VM.

