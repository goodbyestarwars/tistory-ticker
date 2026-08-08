# 미국 종목 뉴스 공급자

`/us-news/{symbol}`는 한 화면에 종목 관련 뉴스를 합쳐서 반환합니다.

- Alpha Vantage `NEWS_SENTIMENT`: 미국 금융뉴스와 종목별 감성 메타데이터
- Finnhub `company-news`: 기업뉴스·보도자료 보완
- Naver News API HUB: 국내 언론·한국어 뉴스 fallback

Alpha Vantage와 Finnhub는 선택 공급자입니다. 환경변수가 없거나 호출에 실패하면 네이버 뉴스만으로 응답합니다.

```text
ALPHA_VANTAGE_API_KEY=...
FINNHUB_API_KEY=...
NAVER_APIHUB_CLIENT_ID=...
NAVER_APIHUB_CLIENT_SECRET=...
```

기사 본문은 저장하지 않고 제목, 출처, 발행시각, 원문 링크와 감성 메타데이터만 전달합니다. 중복 기사는 URL 기준으로 제거하고 최신순으로 최대 10건을 반환합니다.
