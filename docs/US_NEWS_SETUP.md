# 미국 종목 뉴스 공급자

`/us-news/{symbol}`는 한 화면에 종목 관련 뉴스를 합쳐서 반환합니다.

- Alpha Vantage `NEWS_SENTIMENT`: 미국 금융뉴스와 종목별 감성 메타데이터
- Finnhub `company-news`: 기업뉴스·보도자료 보완
- Google News RSS(영어권): 선택형 API 키가 없을 때 해외 뉴스 보완
- Naver News API HUB: 국내 언론·한국어 뉴스 fallback

Alpha Vantage와 Finnhub는 선택 공급자입니다. 두 공급자의 키가 없거나 호출에 실패해도 Google News RSS에서 해외 뉴스 2건을 보완하고, 네이버에서 국내 뉴스 1건을 더해 기본 3건을 반환합니다.

```text
ALPHA_VANTAGE_API_KEY=...
FINNHUB_API_KEY=...
NAVER_APIHUB_CLIENT_ID=...
NAVER_APIHUB_CLIENT_SECRET=...
DART_API_KEY=...
```

국내 뉴스·공시 통합 피드는 `GET /domestic-news`로 제공한다. `code`와 `name`을
함께 보내면 종목명 기반으로 직접 관련 기사를 우선 정렬하고, 제목·본문의 키워드로
실적/수주·계약/배당/증자·감자/M&A/규제·정책/목표주가·리포트/시장 카테고리를 붙인다.
같은 URL은 한 건으로 합치며, 최대 10건을 화면에 표시한다. 실시간 시세의 관련 뉴스는
국내·미국 모두 최근 24시간 기사만 기존 시간대별 타임라인 방식으로 보여준다. 기사
메타데이터는 서버 SQLite 캐시에 남겨 API가 잠시 실패해도 기존 기사가 사라지지 않는다.

기사 본문은 저장하지 않고 제목, 출처, 발행시각, 원문 링크와 감성 메타데이터만 전달합니다. 중복 기사는 URL 기준으로 제거하고 해외 2건 + 국내 1건을 최신순으로 반환합니다.
