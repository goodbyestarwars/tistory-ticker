#!/bin/bash
# 모멘텀 기능만 격리하고 기존 시세 API를 유지하는 운영 롤백.
set -euo pipefail
APP_DIR="$HOME/kiwoom-api"
ENV_FILE="$APP_DIR/.env"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

sudo systemctl stop kiwoom-news-momentum.timer 2>/dev/null || true
sudo systemctl stop kiwoom-news-momentum.service 2>/dev/null || true

if grep -q '^NEWS_MOMENTUM_ENABLED=' "$ENV_FILE" 2>/dev/null; then
  sed -i 's/^NEWS_MOMENTUM_ENABLED=.*/NEWS_MOMENTUM_ENABLED=0/' "$ENV_FILE"
else
  printf '\nNEWS_MOMENTUM_ENABLED=0\n' >> "$ENV_FILE"
fi

if [ -f "$APP_DIR/news_momentum.db" ]; then
  mv "$APP_DIR/news_momentum.db" "$APP_DIR/news_momentum.db.disabled.$STAMP"
fi

sudo systemctl restart kiwoom-api
echo "뉴스 모멘텀 롤백 완료: feature flag 비활성화, DB 격리"
