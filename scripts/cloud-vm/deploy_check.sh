#!/bin/bash
# 기존 kiwoom-deploy.timer가 5분마다 이 파일을 goodbyestarwars 사용자로 실행한다.
# 코드 배포/FastAPI 재시작과 뉴스 모멘텀 일일 배치는 서로 실패 상태를 전파하지 않는다.
set -euo pipefail

APP_DIR="/home/goodbyestarwars/kiwoom-api"
PYTHON="$APP_DIR/venv/bin/python"
DEPLOYED_FILE="$APP_DIR/.last_deployed_sha"
MOMENTUM_MARKER="$APP_DIR/.news_momentum_last_run_date"
MOMENTUM_SCHEMA_MARKER="$APP_DIR/.news_momentum_batch_schema_version"
MOMENTUM_SCHEMA_VERSION="3"
MOMENTUM_LOCK="$APP_DIR/.news_momentum_timer.lock"
MOMENTUM_DB="$APP_DIR/news_momentum.db"

cd "$APP_DIR"

run_news_momentum_if_due() {
  local verify_after_deploy="${1:-0}"
  local today_kst
  local last_run
  local schema_version
  local lock_status

  if [ "$(id -un)" != "goodbyestarwars" ]; then
    echo "뉴스 모멘텀 건너뜀: 실행 사용자가 goodbyestarwars가 아닙니다." >&2
    return 0
  fi
  if ! grep -q '^NEWS_MOMENTUM_ENABLED=1$' "$APP_DIR/.env" 2>/dev/null; then
    echo "뉴스 모멘텀 건너뜀: feature flag 비활성화"
    return 0
  fi

  today_kst="$(TZ=Asia/Seoul date +%F)"
  last_run="$(cat "$MOMENTUM_MARKER" 2>/dev/null || echo "")"
  schema_version="$(cat "$MOMENTUM_SCHEMA_MARKER" 2>/dev/null || echo "")"
  if [ "$last_run" = "$today_kst" ] && [ "$schema_version" = "$MOMENTUM_SCHEMA_VERSION" ]; then
    if [ "$verify_after_deploy" = "1" ]; then
      "$PYTHON" "$APP_DIR/verify_news_momentum_db.py" \
        && "$PYTHON" "$APP_DIR/post_deploy_check.py" --momentum-only \
        || echo "뉴스 모멘텀 배포 후 확인 실패(다음 배치 날짜에 재검증)" >&2
    fi
    return 0
  fi

  # flock 종료코드 75는 다른 5분 회차가 이미 배치를 실행 중이라는 뜻이다.
  # --full은 전 상장종목이 대상이지만 한 회차에 20분 시간 예산과 KST 하루 단위
  # API 호출 예산까지만 쓰고 커서를 남긴다(news_momentum_cursor.json).
  # 첫 전수 커버리지는 며칠에 걸쳐 채워지고 이후에는 같은 순서로 순환 갱신된다.
  if flock -n -E 75 "$MOMENTUM_LOCK" \
      "$PYTHON" "$APP_DIR/news_momentum_scan.py" \
      --full \
      --db "$MOMENTUM_DB" \
      --lock-file "$APP_DIR/.news_momentum_python.lock"; then
    if "$PYTHON" "$APP_DIR/verify_news_momentum_db.py" \
        && "$PYTHON" "$APP_DIR/post_deploy_check.py" --momentum-only; then
      # 배치·DB·API 검증이 모두 성공한 뒤에만 KST 날짜 마커를 원자적으로 교체한다.
      printf '%s\n' "$today_kst" > "$MOMENTUM_MARKER.tmp"
      mv "$MOMENTUM_MARKER.tmp" "$MOMENTUM_MARKER"
      printf '%s\n' "$MOMENTUM_SCHEMA_VERSION" > "$MOMENTUM_SCHEMA_MARKER.tmp"
      mv "$MOMENTUM_SCHEMA_MARKER.tmp" "$MOMENTUM_SCHEMA_MARKER"
      echo "뉴스 모멘텀 일일 배치 완료: $today_kst"
    else
      echo "뉴스 모멘텀 검증 실패: 날짜 마커 미기록, 5분 뒤 재시도" >&2
    fi
  else
    lock_status=$?
    if [ "$lock_status" = "75" ]; then
      echo "뉴스 모멘텀 건너뜀: 이전 배치 실행 중"
    else
      echo "뉴스 모멘텀 배치 실패(exit=$lock_status): 날짜 마커 미기록, 5분 뒤 재시도" >&2
    fi
  fi
  return 0
}

LAST_DEPLOYED="$(cat "$DEPLOYED_FILE" 2>/dev/null || echo "")"
git fetch origin master -q
REMOTE="$(git rev-parse origin/master)"
DEPLOY_OCCURRED=0

if [ "$LAST_DEPLOYED" != "$REMOTE" ]; then
  git pull origin master -q

  # 기존 시세 DB는 서비스 재시작 전에 Python sqlite3 backup API로 백업·검증한다.
  "$PYTHON" "$APP_DIR/scripts/cloud-vm/backup_sqlite.py" \
    --source "$APP_DIR/ohlc_snapshot.db" \
    --backup-dir "$APP_DIR/backups" \
    --keep 7

  cp "$APP_DIR"/scripts/cloud-vm/*.py "$APP_DIR"/

  # 이 sudo는 기존 FastAPI 배포가 원래 사용하던 재시작 권한이다.
  # 모멘텀 배치 자체에는 sudo나 별도 systemd 유닛이 없다.
  sudo systemctl restart kiwoom-api
  "$PYTHON" "$APP_DIR/post_deploy_check.py" --base-only

  printf '%s\n' "$REMOTE" > "$DEPLOYED_FILE"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deployed $REMOTE" >> "$APP_DIR/deploy.log"
  DEPLOY_OCCURRED=1
fi

# 실패해도 위 배포 결과와 FastAPI 재시작 성공을 되돌리거나 비정상 종료시키지 않는다.
run_news_momentum_if_due "$DEPLOY_OCCURRED" || true
