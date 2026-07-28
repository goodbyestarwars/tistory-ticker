#!/bin/bash
# scripts/cloud-vm/*.py가 바뀌면 자동으로 받아서 서비스 재시작.
# systemd timer(kiwoom-deploy.timer)로 5분마다 실행 - VM이 GitHub으로 나가는 방향으로만
# 통신하므로 새 인바운드 포트나 SSH 키 관리가 필요 없다(GitHub Actions push-to-deploy 대안).
set -euo pipefail
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

# 기존 204MB 시세 DB는 파일 복사가 아니라 Python sqlite3 backup API로 일관성 있게 백업한다.
# backup_sqlite.py가 integrity_check까지 통과해야 배포를 계속한다.
./venv/bin/python scripts/cloud-vm/backup_sqlite.py \
  --source "$(pwd)/ohlc_snapshot.db" \
  --backup-dir "$(pwd)/backups" \
  --keep 7

cp scripts/cloud-vm/*.py .
sudo systemctl restart kiwoom-api

# 초기/갱신 배포 모두 지정 8종목만 실행한다. 파일 잠금으로 timer와 중복되어도 한 번만 돈다.
bash scripts/cloud-vm/setup_news_momentum_timer.sh --run-now

# 키·응답 본문을 출력하지 않는 로컬 회귀 검사. 실패하면 모멘텀만 비활성화하고 DB 이름을
# 바꿔 격리한 뒤 기존 kiwoom-api를 다시 올린다.
if ! ./venv/bin/python post_deploy_check.py; then
  bash scripts/cloud-vm/rollback_news_momentum.sh
  exit 1
fi

echo "$REMOTE" > "$DEPLOYED_FILE"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deployed $REMOTE" >> deploy.log
