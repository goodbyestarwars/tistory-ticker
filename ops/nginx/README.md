# 9Pay 통합 오류 페이지 운영

## 구현 현황
- 웹 페이지 원본: 저장소 루트 `404.html`. 탄천·흰 강아지 일러스트를 WebP data URI로 HTML에 포함해 **이미지·CSS·JS 외부 의존성이 없음**.
- GitHub Pages: 프로젝트 경로에서 존재하지 않는 정적 자원에 대해 `404.html`을 표시하도록 Pages가 자동 처리함. 저장소 반영과 운영 배포 완료는 구분하며, 실측 필요.
- Nginx용 설정: `ops/nginx/unified-error-page.conf`; 400/404/500/502/503/504 등 일반 오류를 같은 로컬 HTML로 표시. **상태 코드는 유지**하고 외부 302 리다이렉트 금지.
- 서버 실제 Nginx 설정에 include를 넣는 일은 root 권한이 필요한 **별도 서버 적용 작업**. 이 커밋은 `scripts/cloud-vm/`을 변경하지 않아 VM FastAPI를 재시작하지 않음.
- 티스토리(ghlee.tistory.com) 플랫폼이 자체 생성하는 404/50x는 GitHub Pages 변경만으로 교체되지 않으며 서버 소유자 권한 없이 강제할 수 없음.

## VM 적용 절차 (접속 권한 있는 운영자)
기존 SSL `server { }` 블록을 읽고 해당 블록에 아래 include 한 줄을 **수동으로 추가**한다. 기존 프록시, WebSocket, TLS, OAuth 설정은 변경하지 않는다.

```nginx
include /etc/nginx/snippets/9pay-unified-error-page.conf;
```

그 다음 VM에서 (저장소 체크아웃 경로는 실제 값 확인, 현재 문서 기준 /home/goodbyestarwars/kiwoom-api):

```bash
sudo install -d -m 0755 /var/www/9pay-errors /etc/nginx/snippets
sudo install -m 0644 /home/goodbyestarwars/kiwoom-api/404.html /var/www/9pay-errors/404.html
sudo install -m 0644 /home/goodbyestarwars/kiwoom-api/ops/nginx/unified-error-page.conf /etc/nginx/snippets/9pay-unified-error-page.conf
sudo nginx -t && sudo systemctl reload nginx
```

**주의:** `nginx -t`가 실패하면 설정부터 되돌리고 reload하지 않는다. `error_page`는 기존 HTTPS server 블록에 넣어야 하며 `location`을 전역 `http` 블록에 둘 수 없다. 기존 설정과 `error_page` 경로가 중복되는지 먼저 확인한다. 원격 VM 접근, 실제 site 설정 파일 및 적용 여부는 이 저장소만으로 검증할 수 없다.

## 검증 / 경계
- 적당한 없는 웹 경로를 요청해 응답 헤더의 404를 유지한 채 새 화면이 나오는지 확인한다.
- 502/503/504는 Nginx가 실제로 발생시킬 때 동일 화면으로 제공되어야 한다. 검증을 위해 **운영 백엔드를 중단하지 않는다**.
- 인증 API의 JSON 401/403/404/500 응답을 HTML로 덮어쓰지 않도록 `proxy_intercept_errors`는 기본값 off를 유지한다. 프록시 내부 502에는 Nginx 자체 error_page가 적용된다.
- HTTP 상태 코드를 사용자 화면에 크게 표시하지 않는 것과 실제 HTTP 상태 코드를 200으로 바꾸는 것은 다르다.
- PHP/FastAPI 프로세스 장애 자체를 해결하는 기능이 아니라, 오류 중 표시될 정적 HTML이다.
