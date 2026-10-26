# 2026-10-27 이전 작업 이력

**2026-10-24 마루부리 제목 글꼴 전체를 Regular에서 Bold로(`--font-title`)**

사용자 지시(전체 전환). `style.css`의 `--font-title`을 `"MaruBuriBold", "MaruBuri", …`로 바꿔 이 변수를 쓰는 곳 전부(학습 문서·전략검색·종목 상세·검색기 제목·방명록 글쓰기 제목·메인 뉴스 머리말 등)가 Bold 파일로 나온다. 글꼴 파일 자체가 굵어서 `font-weight`는 400이어야 해서 `font: 700 …`이던 한 곳(`style.css` 2328행)은 400으로 맞춰 가짜 굵기(이중 굵게)를 막았다. `MaruBuriBold`를 이미 직접 지정한 곳(홈 헤드라인·증시온도 제목 등)은 그대로. 뉴스 기사 제목은 #959에서 이미 Bold. 미확인: 학습 문서 등 변수 사용 화면의 실제 모양(굵기 체감·줄바꿈 폭 변화). 배포: style.css master 머지 후 Pages 자동.

**2026-10-24 뉴스 기사 제목을 마루부리 Regular에서 Bold(MaruBuriBold)로**

사용자 지시(마루부리 Regular 쓰기 싫음). 하드코딩된 Regular는 `style.css`의 경제 종합뉴스·주요 뉴스 기사 제목 규칙(`font-family: "MaruBuri"` + 400) 한 곳이라, 직전 가독성 블록에서 이 제목들을 `MaruBuriBold` 파일(다른 큰 제목과 같은 방식, 파일 자체가 굵은 글꼴이라 `font-weight:400`)로 바꿨다. 크기 15px·행간 1.55·짙은 색은 유지. `--font-title` 변수(Regular, 약 12곳이 참조)는 그대로라 그 화면들(학습 문서·일부 제목)은 아직 Regular다 - 원하면 변수 한 줄로 일괄 전환 가능. 미확인: 실제 체감. 배포: style.css master 머지 후 Pages 자동.

**2026-10-24 다크모드 홈 시장판의 패널색 띠 제거(`.home-index-strip`·`.hmb-summary-head`)**

사용자 지적(스크린샷: 미국 시장 요약·주요 ETF 수익률·지수 차트 영역이 카드 가장자리까지 번진 짙은 띠로 보이고 위쪽 여백만 있음). 원인: 다크 팔레트 통일(#935) 때 들어간 `html.dark body :where(th, .hrt-head, .home-index-strip, .hmb-summary-head, …) { background-color: var(--dk-panel) !important }` 일괄 규칙이 이 두 요소에도 패널색을 입혔다(본래 배경 없음, 여백은 위쪽만 있는 구조). `style.css`: 이 규칙에서 `.home-index-strip`과 `.hmb-summary-head`를 뺐다 - 라이트 모드·표 머리글·상태 영역 패널색은 불변. 미확인: 다크 화면 실제 모양. 배포: style.css master 머지 후 Pages 자동.

**2026-10-24 홈 시장판 띠 잔존 원인 수정·안쪽 여백 균일화**

사용자 추가 스크린샷(차트 출처·미국 시장 요약·ETF 제목 주변). 직전 작업은 다크 전용 배경 규칙에서만 두 선택자를 빼서, 공통 `@layer np`의 `--np-tint` 배경(다크에서는 페이지색)이 그대로 남았다. `style.css` 공통 배경 목록에서도 지수 띠·요약 머리말을 제외하고, `css/home-market-board.css` 원래 부품 규칙에 투명 배경을 명시했다. 요약·ETF 머리말의 위쪽 패딩과 margin이 중복되던 빈 공간은 공통 섹션 간격 20px/모바일 16px 한 번으로 정리. 바깥 카드 사방 18px/모바일 14px 유지, 지수 칸 좌우 패딩도 같은 토큰 사용, 좁은 제목·기준일 줄은 wrap 허용. 데이터/차트/표/뉴스 글꼴/스킨 마크업 변경 없음.

검증: 운영 DOM에 후보 CSS를 같은 위치로 적용해 375/390/768/1440px 라이트·다크에서 띠 배경 투명, 카드 사방 14/18px, 가로 넘침 없음 확인. 미국 세션 테스트 5 pass·diff check 통과. 배포: style.css/css의 master→Pages, 티스토리 관리자 수동 반영 없음.
