#!/bin/bash
# scripts/cloud-vm/*.py가 바뀌면 자동으로 받아서 서비스 재시작.
# systemd timer(kiwoom-deploy.timer)로 5분마다 실행 - VM이 GitHub으로 나가는 방향으로만
# 통신하므로 새 인바운드 포트나 SSH 키 관리가 필요 없다(GitHub Actions push-to-deploy 대안).
set -e
cd "$(dirname "$0")"

git fetch origin master -q
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

git pull origin master -q
cp scripts/cloud-vm/*.py .
sudo systemctl restart kiwoom-api

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deployed $REMOTE" >> deploy.log
