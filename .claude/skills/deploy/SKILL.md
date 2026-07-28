---
name: deploy
description: 9Pay 변경의 Git 반영과 GitHub Pages, VM, GAS, Tistory 배포 경로를 점검할 때 사용
---

# 배포 점검

1. 변경 파일과 현재 브랜치를 확인한다.
2. 관련 없는 변경을 포함하지 않는다.
3. 필요한 검증을 실행한다.
4. `master` 반영 여부를 확인한다.
5. 파일별 배포 경로를 판정한다.
   - `js/`, `css/`, `data/`: GitHub Pages 자동 반영
   - `scripts/cloud-vm/`: VM 자동 배포 확인
   - `gas/ticker-proxy.gs`: GAS 새 버전 수동 배포
   - `skin.html`: Tistory 관리자 수동 반영
6. 커밋, 검증, 자동·수동 배포 항목을 요약한다.
