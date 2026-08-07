# 관심종목 Google 계정별 저장

관심종목은 브라우저 `localStorage`가 아니라 VM SQLite에 Google 계정별로 저장한다.

- Google의 `sub` 값을 사용자 고유 식별자로 사용한다.
- `app_users`에 Google 계정을 등록한다.
- `watchlist_configs`에 계정별 종목, 그룹, 순서, 접힘 상태를 JSON으로 저장한다.
- 브라우저 쿠키에는 관심종목을 저장하지 않는다. 쿠키는 HttpOnly 세션 확인 용도로만 사용한다.
- 증시온도 카드 구성은 개인별 데이터가 아니라 관리자 계정만 수정하는 전역 설정이다.

## API

- `GET /watchlist`: 로그인한 Google 계정의 관심종목 조회
- `PUT /watchlist`: 로그인한 Google 계정의 관심종목 전체 저장

`PUT` 요청은 `items`, `groups`, `revision`을 보내며 revision이 다르면 409로 거부해 다른 기기의 변경을 덮어쓰지 않는다.

OAuth callback은 로그인한 페이지로 돌아갈 수 있도록 `return_to`를 지원하며 `https://ghlee.tistory.com` 주소만 허용한다.
