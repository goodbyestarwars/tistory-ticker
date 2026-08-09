# US news cache

The `/us-news/{symbol}` endpoint reads a per-symbol SQLite cache first.

- Cache file on the VM: `scripts/cloud-vm/us_news_cache.db`
- Default refresh interval: 30 minutes
- On expiry: call the configured providers, delete that symbol's old rows, and insert the refreshed result in one transaction
- An empty result is cached too, preventing repeated calls on every screen load
- Stored fields: title, link, publication date, source, provider, and sentiment metadata; article bodies are not stored

The cache database is excluded from Git. Set `US_NEWS_CACHE_TTL_SEC` in the VM
`.env` to change the interval, or `US_NEWS_CACHE_DB` to use another path.
