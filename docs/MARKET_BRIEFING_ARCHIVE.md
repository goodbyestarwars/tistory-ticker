# 마켓 브리핑 기록실 — 날짜·종목·산업 통합 검색 (2026-11-18)

## 사용자 경로

- 공개 티스토리 /category/마켓 브리핑의 기존 본문·영구 URL·카드·페이지네이션을 보존한다.
- js/skin-main.js의 buildCategoryFeedBlocks()는 해당 경로에서만 js/briefing-archive.js와 css/briefing-archive.css를 지연 로드한다.
- 정적 전체 색인 data/briefing-index.js를 사용해 종목명/코드/별칭/주제/산업/본문 검색, 주제, 관련도 정렬, 15건씩 더 보기를 제공한다. 월별 검색 로직(게시일·본문 기준일)은 보존하되 현재 화면에서 입력을 숨긴다.
- 인덱스가 없거나 손상되면 기존 카드 선반/페이지 번호를 보존하고 '현재 페이지 검색'으로 축소한다고 명시한다. 실패를 전체 기록 0건으로 표시하지 않는다.
- 카테고리 상단의 기존 ‘마켓 브리핑’ 제목만 사용하고 검색 내부 중복 제목/설명을 제거한다. 검색 폼은 PC 최대 720px, 모바일 100% 폭이며 색인 건수/생성일 상태는 검색 폼 오른쪽(모바일 아래)에 표시한다.
- 기존 홈 미리보기 NineHomeBriefing 8건, 공개 접근 정책, 공유·더 보기, 사이트 공통 폰트·모바일 UI는 변경하지 않는다.

## 데이터 계약

- 사용자의 공개 티스토리 마켓 브리핑 카테고리 글 목록·본문만 읽는다. scripts/build_briefing_index.py → data/briefing-index.js. 스키마 window.NINE_BRIEFING_INDEX, schemaVersion=1.
- 각 글 id, url, title, publishedAt(게시일), referenceDate(본문의 명시된 기준일만), summary, industries[], topics[], stocks[{name,code,role,aliases?}], terms[](본문 고유 검색 단어), coverage(full 또는 excerpt)로 저장한다.
- role=primary는 제목에 기업 이름이 나온 경우, mentioned는 본문에서 언급된 경우다. 산업에 속했다는 이유로 해당 기업을 언급했다고 만들지 않는다.
- 국내 종목명/코드 사전은 기존 data/sectors-v3.js를 재사용한다. 주요 과거 사명과 일부 미국 종목 명칭은 빌더 ALIASES/FOREIGN으로 명시한다. 과거 사명 연결은 검색용이며 과거 상장 상태를 바꾸지 않는다.
- 산업/주제는 제목·본문의 앞 300자와 일치하는 경우에만 탐색용 복수 태그다. 공식 산업 분류가 아니며 일부 오분류 가능성이 있다. 한글 두 글자 키워드는 본문 색인에서 검색한다.
- 원문 HTML 전체, 원시 시세, 비공개 데이터, 인증키는 색인에 복제하지 않는다. 원문 전체는 Tistory에서만 연다. 비정형 HTML로 전문 파싱이 어려운 글은 카테고리 원문 요약을 색인하고 coverage=excerpt로 표시한다.
- 수집 글 수가 이전보다 줄거나 페이지 파싱 오류가 발생하면 덮어쓰지 않는다. 글 조회 실패 때는 기존 색인을 보존한다. 자료 기준일을 임의 사건일로 만들지 않는다.

## 생성·배포·검증

- .github/workflows/briefing-index.yml: 매일 KST 03:35, 빌더/워크플로 변경 push, 수동 실행. 새 VM 프로세스·DB·수집 시세 API 없음.
- Python 3.11 표준 라이브러리로 공개 카테고리 모든 페이지를 순회하고 원문에서 실제 단어를 색인한다. 변화가 있을 때만 Actions가 data/briefing-index.js를 master에 커밋하고 GitHub Pages에 반영한다. 스킨 HTML 수동 편집 필요 없음.
- 테스트: python -m unittest discover -s test -p 'test_briefing_index.py'; node --check js/briefing-archive.js; node --check js/skin-main.js.
- 운영 검증: Action 성공 → Pages에서 정적 색인 존재 확인 → 사이트 /category/마켓%20브리핑에서 실제 건수, 종목코드, 본문/월 검색, 모바일, 실패 폴백 검증.
- 원본 사이트의 마크업 변경 시 파서와 테스트를 함께 수정한다. data/briefing-index.js는 생성 파일이며 수동 수정 금지.

## 이번 범위에서 제외

- 사건별 독립 데이터베이스, AI 추정 사건일/성과, 원시 시세·캔들 재배포, 자동매매 주문/실계좌 변경.
