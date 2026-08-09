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
```

기사 본문은 저장하지 않고 제목, 출처, 발행시각, 원문 링크와 감성 메타데이터만 전달합니다. 중복 기사는 URL 기준으로 제거하고 해외 2건 + 국내 1건을 최신순으로 반환합니다.
