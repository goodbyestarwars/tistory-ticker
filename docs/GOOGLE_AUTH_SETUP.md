# Google 로그인 설정

증시온도 카테고리·종목 편집은 Google 로그인 후 관리자 이메일이 허용목록과 일치할 때만 저장할 수 있다.

## Google Cloud Console

OAuth 클라이언트 ID를 `웹 애플리케이션` 유형으로 만들고 다음 값을 등록한다.

- 승인된 JavaScript 원본: `https://ghlee.tistory.com`
- 승인된 리디렉션 URI: `https://goodbyestar.cloud/auth/google/callback`

클라이언트 Secret은 저장소에 커밋하지 않는다.

## VM `.env`

`/home/goodbyestarwars/kiwoom-api/.env`에 다음을 추가한다.

```dotenv
GOOGLE_OAUTH_CLIENT_ID=발급받은_클라이언트_ID
GOOGLE_OAUTH_CLIENT_SECRET=발급받은_클라이언트_Secret
GOOGLE_OAUTH_REDIRECT_URI=https://goodbyestar.cloud/auth/google/callback
GOOGLE_AUTH_SUCCESS_REDIRECT=https://ghlee.tistory.com/page/market-temp
GOOGLE_ADMIN_EMAIL=goodbyestarwars@gmail.com
AUTH_SESSION_SECRET=충분히_긴_랜덤_문자열
```

`AUTH_SESSION_SECRET`를 지정하지 않으면 기존 `API_TOKEN`을 임시 서명 키로 사용한다. 운영에서는 별도 랜덤 값을 지정하는 것을 권장한다.

설정 전에는 기존 `X-API-Key` 방식이 유지되고, Google OAuth 설정이 완료되면 브라우저의 카드 저장은 Google 관리자 세션만 허용한다.

## 확인

브라우저에서 증시온도 카드 편집기를 열었을 때 `Google로 로그인` 버튼이 보이면 OAuth 설정이 로드된 상태다. 로그인 성공 후에는 `/auth/google/me`가 `configured: true`, `isAdmin: true`를 반환해야 한다.
