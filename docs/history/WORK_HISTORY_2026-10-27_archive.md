# 2026-10-27 이전 작업 이력

**2026-10-24 마루부리 제목 글꼴 전체를 Regular에서 Bold로(`--font-title`)**

사용자 지시(전체 전환). `style.css`의 `--font-title`을 `"MaruBuriBold", "MaruBuri", …`로 바꿔 이 변수를 쓰는 곳 전부(학습 문서·전략검색·종목 상세·검색기 제목·방명록 글쓰기 제목·메인 뉴스 머리말 등)가 Bold 파일로 나온다. 글꼴 파일 자체가 굵어서 `font-weight`는 400이어야 해서 `font: 700 …`이던 한 곳(`style.css` 2328행)은 400으로 맞춰 가짜 굵기(이중 굵게)를 막았다. `MaruBuriBold`를 이미 직접 지정한 곳(홈 헤드라인·증시온도 제목 등)은 그대로. 뉴스 기사 제목은 #959에서 이미 Bold. 미확인: 학습 문서 등 변수 사용 화면의 실제 모양(굵기 체감·줄바꿈 폭 변화). 배포: style.css master 머지 후 Pages 자동.

**2026-10-24 뉴스 기사 제목을 마루부리 Regular에서 Bold(MaruBuriBold)로**

사용자 지시(마루부리 Regular 쓰기 싫음). 하드코딩된 Regular는 `style.css`의 경제 종합뉴스·주요 뉴스 기사 제목 규칙(`font-family: "MaruBuri"` + 400) 한 곳이라, 직전 가독성 블록에서 이 제목들을 `MaruBuriBold` 파일(다른 큰 제목과 같은 방식, 파일 자체가 굵은 글꼴이라 `font-weight:400`)로 바꿨다. 크기 15px·행간 1.55·짙은 색은 유지. `--font-title` 변수(Regular, 약 12곳이 참조)는 그대로라 그 화면들(학습 문서·일부 제목)은 아직 Regular다 - 원하면 변수 한 줄로 일괄 전환 가능. 미확인: 실제 체감. 배포: style.css master 머지 후 Pages 자동.
