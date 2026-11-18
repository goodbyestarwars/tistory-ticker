# 디자인 스냅샷 (복구 지점)

사용자가 이름을 붙여 저장한 디자인 상태. 복구 요청 시 이 표의 브랜치를 기준으로 되돌린다.
복구 브랜치는 저장 시점 저장소 전체(코드·CSS·JS·문서)를 가리키는(이 브랜치에는 커밋·push 금지) 완전판이다.

| 이름 | Git 복구 브랜치 | 커밋 | 저장일(KST) | 내용 |
|---|---|---|---|---|
| 윤미경 1 | `design/yunmigyeong-1` | `d8b63796ec3bd59bbfdfb52856bf1e507f966118` | 2026-11-19 | Soft UI(라이트, 배경 #FEFDFA·강조 #075759) + 모노크롬 글래스 다크(--dk-*) + 양피지 설계도 스케치 로그인 랜딩 + 푸터 기존색 원복 상태. css/ 트리 `42cdd81886c3d4810e25769eb6d82a6e55214b14` |

## 복구 방법

디자인만 되돌리기(데이터·API·자동매매 로직은 현재 유지 권장):

```bash
git fetch origin design/yunmigyeong-1
git checkout origin/design/yunmigyeong-1 -- style.css css/ js/skin-shell.js js/access-landing.js js/skin-menu.js
```

- 디자인 소유 파일: `style.css`, `css/`(soft-ui·ui-system·ui-spacing·fonts 등 59개), 로더/랜딩 `js/skin-shell.js`·`js/access-landing.js`·`js/skin-menu.js`.
- 위 JS는 기능 코드도 포함하므로 복구 전 `git diff origin/design/yunmigyeong-1 -- <파일>`로 이후 기능 변경 유무를 확인하고, 기능 변경이 있으면 CSS만 되돌리거나 해당 부분만 병합한다.
- 복구 후 `skin-shell.js`의 soft-ui 로더 `?v=`를 새 값으로 올려 캐시를 무효화한다. `skin.html`은 고정본이라 수정하지 않는다.
- 전체 상태 확인용: `git checkout origin/design/yunmigyeong-1`(분리 HEAD, 읽기 전용 확인).
