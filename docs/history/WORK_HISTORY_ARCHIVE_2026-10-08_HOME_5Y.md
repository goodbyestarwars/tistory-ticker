# 작업 이력 아카이브

**2026-10-04 증시온도·주말 리포트 보정(공통 상자 규칙 덮어쓰기)**

사용자 지적: `style.css` 13번 공통 규칙(`html body :where(.mt-strategy-panel, .mt-strategy-action, .mt-sf-disclaimer, .hwr-schedule, .hwr-index-card, .hwr-fx-card …)` 테두리·둥근 모서리 `!important`)이 앞선 카드 제거를 덮어, 체크포인트 안에 상자가 또 생기고 주말 리포트 카드가 그대로 남아 있었다. 같은 `!important`로 상자를 걷고, 체크포인트 3열 비율·`word-break: keep-all`로 문구를 한 줄에 유지, 대표 종목은 가로 나열, 안내문·섹터 카드 안쪽 여백 확대. 주말 리포트: 다음 주 핵심 스케줄은 안쪽 여백 있는 한 구역 상자, 주간 자산 요약은 지수 4개와 겹치는 항목을 빼고(원유·금·국채·비트코인) 크게, 구역 사이 가로줄은 양끝으로 옅어지는 1px 선. Markets Closed 얇은 배너는 되돌려 기존 WEEKEND MARKET NOTE·말풍선 유지("다음 주 일정 보기" 링크만 유지). 배포: master 반영 시 GitHub Pages 자동.
