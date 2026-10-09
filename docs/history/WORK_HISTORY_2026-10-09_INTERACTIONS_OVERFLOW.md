**2026-10-05 사이트 로고를 송골매로 교체**

사용자 요청. 제세동기 그림 대신 송골매 그림(원본 `img/falcon-logo-source.webp`)의 머리 부분 정사각 크롭으로 `img/brand-banner.png`(네비 128px)·`favicon.png`(64px)·`apple-touch-icon.png`(180px, 여백 포함)을 다시 구웠다. 전신은 34px에서 가는 사선으로 뭉개져 머리만 쓴다. 파일명이 같아 경로 변경 없음, `?v=`만 `20261005-falcon`(style.css·skin-shell.js·skin.html). 로고 옆 문구는 그대로. 검증: 34px 축소 미리보기, `test_ui_ia.py` 변경 전과 같은 실패만. 배포: GitHub Pages 자동, skin.html은 `?v=`·alt만 바뀌어 수동 반영 불필요.
