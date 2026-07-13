#!/bin/bash
# scripts/cloud-vm/*.py가 바뀌면 자동으로 받아서 서비스 재시작.
# systemd timer(kiwoom-deploy.timer)로 5분마다 실행 - VM이 GitHub으로 나가는 방향으로만
# 통신하므로 새 인바운드 포트나 SSH 키 관리가 필요 없다(GitHub Actions push-to-deploy 대안).
set -e
cd "$(dirname "$0")/../.."   # scripts/cloud-vm -> 저장소 루트(cp 대상 경로가 루트 기준 상대경로라 여기로 와야 함)

# "git이 최신인지"가 아니라 "cp+재시작까지 실제로 끝난 커밋"을 별도 파일로 추적한다.
# git pull은 성공했는데 cp가 실패하는 경우(과거 실제로 있었던 버그) LOCAL==REMOTE가 되어버려서
# 다음 실행부터 "새로운 거 없음"으로 오판하고 cp를 영원히 재시도 안 하는 문제를 막기 위함.
DEPLOYED_FILE=".last_deployed_sha"
LAST_DEPLOYED=$(cat "$DEPLOYED_FILE" 2>/dev/null || echo "")

git fetch origin master -q
REMOTE=$(git rev-parse origin/master)

if [ "$LAST_DEPLOYED" = "$REMOTE" ]; then
  exit 0
fi

git pull origin master -q
cp scripts/cloud-vm/*.py .
sudo systemctl restart kiwoom-api

echo "$REMOTE" > "$DEPLOYED_FILE"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deployed $REMOTE" >> deploy.log
