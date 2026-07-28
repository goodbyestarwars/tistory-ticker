---
paths:
  - "gas/**/*.gs"
  - "scripts/cloud-vm/**/*.py"
  - "scripts/**/*.py"
---

# 백엔드 규칙

- API 키와 토큰은 환경변수 또는 GAS 스크립트 속성에서만 읽는다.
- API 작업 전 `API_REFERENCE.md`의 관련 구간만 읽는다.
- 인증, 캐시 TTL, 단위, 시장 범위(KRX/NXT)를 확인한다.
- 미검증 필드는 실제 응답이나 공식 문서 확인 전 계산에 사용하지 않는다.
- KRX 차단 경로를 다시 도입하지 않는다.
- GAS 6분 실행 제한을 고려한다.
