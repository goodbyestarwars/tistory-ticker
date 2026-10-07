# 이관 작업이력

**2026-10-04 금융용어사전(이야기 시리즈)**

목적: 푸터 이야기 시리즈에 용어사전 추가(사용자 요청, "서버 용량에 미미하게"). DB 대신 정적 데이터 `data/glossary.js`(`window.NINE_GLOSSARY`, 48개: 차트 15·수급 10·재무 12·보조지표 11)와 `learn/glossary.html`(검색·분류 칩·관련용어 이동)로 구성해 서버·DB 부하 0. 용어 추가는 배열에 한 줄 추가. 푸터 `js/skin-shell.js`에 카드 추가. 검증: `test_ui_ia.py` 통과, 용어 간 관련어 참조 전부 등록 확인. 배포: master 반영 시 GitHub Pages 자동.
