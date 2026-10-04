# 네이버 로그인 설정

일반 사용자가 Google 대신 네이버 계정으로 로그인해 관심종목·메모·내 대시보드를 쓸 수 있다(2026-10-04).
네이버 로그인 API는 무료다. 세션 쿠키는 Google 로그인과 같은 것을 쓰므로 로그아웃·`/auth/google/me`도 공용이다.

## 네이버 개발자센터

https://developers.naver.com → Application → 애플리케이션 등록

- 사용 API: `네이버 로그인`
- 제공 정보: 회원이름 필수, 연락처 이메일은 "추가"(선택)로 두거나 뺀다. 이메일이 없어도 로그인된다(서버는 회원 id만 필수)
- 개인정보처리방침: `https://goodbyestarwars.github.io/tistory-ticker/legal/privacy.html`(3-2 네이버 로그인 정보, 2026-10-05)
- 환경: PC 웹 / 모바일 웹
- 서비스 URL: `https://ghlee.tistory.com`
- Callback URL: `https://goodbyestar.cloud/auth/naver/callback`

등록 직후는 "개발 중" 상태라 **멤버관리에 등록한 아이디만** 로그인된다. 일반 방문자에게 열려면
"검수요청"을 해야 한다(보통 며칠).

## VM `.env`

`/home/goodbyestarwars/kiwoom-api/.env`에 추가하고 서비스를 재시작한다. 값은 저장소에 커밋하지 않는다.

```dotenv
NAVER_OAUTH_CLIENT_ID=발급받은_Client_ID
NAVER_OAUTH_CLIENT_SECRET=발급받은_Client_Secret
# 기본값이 아래와 같으면 생략 가능
NAVER_OAUTH_REDIRECT_URI=https://goodbyestar.cloud/auth/naver/callback
```

세션 서명에는 기존 `AUTH_SESSION_SECRET`(없으면 `API_TOKEN`)을 그대로 쓴다.

## 확인

`/auth/google/me`가 `naverConfigured: true`를 반환하면 상단 톱니(계정) 선택창에 "네이버로 로그인"이 보인다.
로그인 후에는 `provider: "naver"`, `isAdmin: false`가 나와야 한다.

## 주의

- 네이버 email은 사용자가 제공을 끌 수 있고 소유 검증이 보장되지 않는다. 그래서 관리자 판정에 쓰지 않는다.
  관리자 기능은 계속 Google 관리자 계정으로만 된다.
- 같은 사람이 Google과 네이버로 각각 로그인하면 서로 다른 계정이다(관심종목이 합쳐지지 않는다).
