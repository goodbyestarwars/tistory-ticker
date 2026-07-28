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
PILOT_CODES="000660,005930,005380,083650,042660,035420,066570,247540"
LAST_NEWS_RUN_FILE=".news_momentum_last_run_date"

git fetch origin master -q
REMOTE=$(git rev-parse origin/master)

if [ "$LAST_DEPLOYED" = "$REMOTE" ]; then
  NEWS_RELEASE=$(cat scripts/cloud-vm/news_momentum_release.txt 2>/dev/null || echo "none")
  DISABLED_RELEASE=$(cat .news_momentum_disabled_release 2>/dev/null || echo "")
  TODAY_KST=$(TZ=Asia/Seoul date +%F)
  LAST_NEWS_RUN=$(cat "$LAST_NEWS_RUN_FILE" 2>/dev/null || echo "")
  # 기존 kiwoom-deploy.timer(5분 주기)를 재사용하되 KST 날짜 마커로 하루 한 번만 실행한다.
  if [ "$NEWS_RELEASE" != "$DISABLED_RELEASE" ] \
      && grep -q '^NEWS_MOMENTUM_ENABLED=1$' .env 2>/dev/null \
      && [ "$LAST_NEWS_RUN" != "$TODAY_KST" ]; then
    if ./venv/bin/python news_momentum_scan.py --codes "$PILOT_CODES"; then
      echo "$TODAY_KST" > "$LAST_NEWS_RUN_FILE"
    else
      bash scripts/cloud-vm/rollback_news_momentum.sh "daily-pilot-batch-failed" "$NEWS_RELEASE"
      exit 1
    fi
  fi
  exit 0
fi

git pull origin master -q
NEWS_RELEASE=$(cat scripts/cloud-vm/news_momentum_release.txt 2>/dev/null || echo "none")
DISABLED_RELEASE=$(cat .news_momentum_disabled_release 2>/dev/null || echo "")
NEWS_ATTEMPT=1
if [ "$NEWS_RELEASE" = "$DISABLED_RELEASE" ]; then
  NEWS_ATTEMPT=0
fi

# 기존 204MB 시세 DB는 파일 복사가 아니라 Python sqlite3 backup API로 일관성 있게 백업한다.
# backup_sqlite.py가 integrity_check까지 통과해야 배포를 계속한다.
./venv/bin/python scripts/cloud-vm/backup_sqlite.py \
  --source "$(pwd)/ohlc_snapshot.db" \
  --backup-dir "$(pwd)/backups" \
  --keep 7

cp scripts/cloud-vm/*.py .

if [ "$NEWS_ATTEMPT" = "1" ]; then
  if grep -q '^NEWS_MOMENTUM_ENABLED=' .env 2>/dev/null; then
    sed -i 's/^NEWS_MOMENTUM_ENABLED=.*/NEWS_MOMENTUM_ENABLED=1/' .env
  else
    printf '\nNEWS_MOMENTUM_ENABLED=1\n' >> .env
  fi
fi

if ! sudo systemctl restart kiwoom-api; then
  bash scripts/cloud-vm/rollback_news_momentum.sh "api-restart-failed" "$NEWS_RELEASE"
  exit 1
fi

if [ "$NEWS_ATTEMPT" = "1" ]; then
  # 지정 8종목만 실행한다. 파일 잠금으로 timer와 중복되어도 한 번만 돈다.
  if ! bash scripts/cloud-vm/setup_news_momentum_timer.sh --run-now; then
    bash scripts/cloud-vm/rollback_news_momentum.sh "pilot-batch-failed" "$NEWS_RELEASE"
    exit 1
  fi

  # 키·응답 본문을 출력하지 않는 로컬 회귀 검사.
  if ! ./venv/bin/python post_deploy_check.py; then
    bash scripts/cloud-vm/rollback_news_momentum.sh "regression-check-failed" "$NEWS_RELEASE"
    exit 1
  fi
  rm -f .news_momentum_disabled_release
  TZ=Asia/Seoul date +%F > "$LAST_NEWS_RUN_FILE"
  printf '{"status":"active","release":"%s","at":"%s"}\n' \
    "$NEWS_RELEASE" "$(date -u +%Y%m%dT%H%M%SZ)" > news_momentum_status.json
fi

echo "$REMOTE" > "$DEPLOYED_FILE"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deployed $REMOTE" >> deploy.log
