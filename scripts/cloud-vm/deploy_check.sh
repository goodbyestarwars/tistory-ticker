#!/bin/bash
# 기존 kiwoom-deploy.timer가 5분마다 이 파일을 goodbyestarwars 사용자로 실행한다.
# 코드 배포/FastAPI 재시작과 뉴스 모멘텀 일일 배치는 서로 실패 상태를 전파하지 않는다.
set -euo pipefail

APP_DIR="/home/goodbyestarwars/kiwoom-api"
PYTHON="$APP_DIR/venv/bin/python"
DEPLOYED_FILE="$APP_DIR/.last_deployed_sha"
DEPLOY_LOCK="$APP_DIR/.deploy_check.lock"
MOMENTUM_MARKER="$APP_DIR/.news_momentum_last_run_date"
MOMENTUM_SCHEMA_MARKER="$APP_DIR/.news_momentum_batch_schema_version"
MOMENTUM_SCHEMA_VERSION="3"
MOMENTUM_LOCK="$APP_DIR/.news_momentum_timer.lock"
MOMENTUM_DB="$APP_DIR/news_momentum.db"
SEARCH_SCAN_LOCK="$APP_DIR/.search_scan_refresh.lock"
SEARCH_SCAN_LOG="$APP_DIR/search-scan-refresh.log"
# 2026-08-02: _issue_labels() 폴백이 만들던 "장중 하락"·"마감 상승" 같은 순수 가격서술
# 이슈를 코드 수정 이후에도 이미 저장된 행은 안 지워지므로, 배포 후 1회만 정리한다.
PRICE_RECAP_CLEANUP_MARKER="$APP_DIR/.news_momentum_price_recap_cleanup_v1_done"

cd "$APP_DIR"

# 2026-08-03 VM 장애 대응(2차): 2026-08-02 SQLite 백업 재시작 증폭 사고 당시 "짧은 시간에
# 여러 커밋을 연속 push하면 deploy_check.sh가 각 push마다 재트리거돼 겹쳐 실행될 수 있다"는
# 문제를 발견했지만 그때는 news_momentum 하위 작업에만 flock을 걸고 배포 블록 자체(git pull -
# backup_sqlite.py - sudo systemctl restart)는 잠금 없이 남겨뒀었다(당시 "후속 과제"로 미룸).
# 오늘 같은 세션에서 짧은 시간에 여러 PR을 연달아 머지하는 동안 실제로 여러 엔드포인트
# (/futures, /market-rank 등)가 한꺼번에 응답 불가 상태가 되는 게 재현돼, 그 후속 과제를
# 지금 처리한다 - 스크립트 전체를 하나의 flock으로 감싸 5분 타이머 회차가 겹치면 뒤 회차는
# 아무 것도 하지 않고 조용히 넘어가게 한다(다음 회차가 다시 최신 커밋을 반영하므로 배포
# 자체가 누락되지 않는다 - git fetch는 멱등이라 건너뛴 회차의 커밋도 다음 회차가 그대로 잡는다).
exec 200>"$DEPLOY_LOCK"
if ! flock -n 200; then
  echo "이전 배포/점검이 아직 진행 중 - 이번 5분 회차는 건너뜁니다."
  exit 0
fi

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
  # --full은 전 상장종목이 대상이지만 한 회차에 20분 시간 예산까지만 쓰고 커서를
  # 남긴다(news_momentum_cursor.json). 종료코드 2 = 시간 예산으로 슬라이스만 끝났고
  # 오늘 API 호출 예산이 남아 있다는 뜻이라, 날짜 마커를 기록하지 않고 다음 5분
  # 회차가 커서부터 이어받는다. 0 = 전수 완료 또는 오늘 호출 예산 소진(= 오늘 할 일 끝).
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
    elif [ "$lock_status" = "2" ]; then
      echo "뉴스 모멘텀 슬라이스 완료(전수 수집 진행 중): 날짜 마커 미기록, 다음 회차에서 이어서 수집"
    else
      echo "뉴스 모멘텀 배치 실패(exit=$lock_status): 날짜 마커 미기록, 5분 뒤 재시도" >&2
    fi
  fi
  return 0
}

# 코드가 바뀌어도 news_topics에 이미 저장된 행은 자동으로 안 지워지므로(정리는 별도
# 마이그레이션 몫), 마커 파일이 없을 때만 1회 실행하고 성공해야 마커를 남긴다. 실패하면
# 마커를 안 남겨 다음 5분 회차가 재시도한다(모멘텀 배치와 동일한 재시도 패턴).
run_price_recap_cleanup_once() {
  if [ -f "$PRICE_RECAP_CLEANUP_MARKER" ]; then
    return 0
  fi
  if [ ! -f "$MOMENTUM_DB" ]; then
    return 0  # DB가 아직 없으면(모멘텀 배치 첫 실행 전) 정리할 것도 없음 - 다음 회차 재확인
  fi
  if "$PYTHON" "$APP_DIR/cleanup_price_recap_topics.py" \
      --db "$MOMENTUM_DB" --backup-dir "$APP_DIR/backups" --apply; then
    touch "$PRICE_RECAP_CLEANUP_MARKER"
    echo "가격서술 노이즈 이슈 정리 완료(1회성)"
  else
    echo "가격서술 노이즈 이슈 정리 실패: 5분 뒤 재시도" >&2
  fi
  return 0
}

# Pattern/strategy code changes used to wait for the next daily timer, which
# made a newly deployed search rule look broken for up to a day. Refresh the
# DB-only pattern cache and the strategy cache once after a deploy. The lock
# prevents overlapping refreshes when several commits arrive close together.
run_search_scan_refresh_after_deploy() {
  if [ "$(id -un)" != "goodbyestarwars" ]; then
    echo "검색 스캔 갱신 건너뜀: 실행 사용자가 goodbyestarwars가 아닙니다."
    return 0
  fi
  (
    flock -n 210 || exit 0
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) search scan refresh started"
    "$PYTHON" "$APP_DIR/rescan_patterns.py" \
      || echo "pattern cache refresh failed; daily timer will retry" >&2
    "$PYTHON" "$APP_DIR/strategy_scan.py" \
      || echo "strategy cache refresh failed; strategy timer will retry" >&2
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) search scan refresh finished"
  ) 210>"$SEARCH_SCAN_LOCK" >>"$SEARCH_SCAN_LOG" 2>&1 &
  disown
}

LAST_DEPLOYED="$(cat "$DEPLOYED_FILE" 2>/dev/null || echo "")"
git fetch origin master -q
REMOTE="$(git rev-parse origin/master)"
DEPLOY_OCCURRED=0

if [ "$LAST_DEPLOYED" != "$REMOTE" ]; then
  git pull origin master -q

  # SQLite 백업은 198MB DB에서 배포를 장시간 붙잡고 VM 자원을 소모하므로 비활성화한다.
  # 기존 backups 파일은 유지하며, 필요할 때 별도 수동 백업으로 처리한다.
  echo "SQLite deploy backup disabled"

  cp "$APP_DIR"/scripts/cloud-vm/*.py "$APP_DIR"/

  # 이 sudo는 기존 FastAPI 배포가 원래 사용하던 재시작 권한이다.
  # 모멘텀 배치 자체에는 sudo나 별도 systemd 유닛이 없다.
  sudo systemctl restart kiwoom-api
  "$PYTHON" "$APP_DIR/post_deploy_check.py" --base-only

  printf '%s\n' "$REMOTE" > "$DEPLOYED_FILE"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deployed $REMOTE" >> "$APP_DIR/deploy.log"
  DEPLOY_OCCURRED=1
  run_search_scan_refresh_after_deploy
fi

# 실패해도 위 배포 결과와 FastAPI 재시작 성공을 되돌리거나 비정상 종료시키지 않는다.
run_news_momentum_if_due "$DEPLOY_OCCURRED" || true
run_price_recap_cleanup_once || true

# 2026-08-03: 주요 엔드포인트 로컬 응답시간을 5분마다 기록(GET /health/latency로 노출) -
# VM 장애 진단 때 "느려진 것 같다"를 매번 SSH로 curl -w 재던 걸 자동화한 것. 엔드포인트가
# 느려도(최악의 경우 5개 x 25초 타임아웃) 이 배포 타이머 자체가 막히면 안 되므로 백그라운드로
# 던지고 기다리지 않는다 - latency_monitor.py 내부에서 각 호출을 개별 예외 처리하고 결과를
# 파일에 추가만 하므로, 이 회차가 안 끝난 채 다음 5분 회차가 겹쳐도(위 flock과 무관하게 이
# 백그라운드 프로세스는 별도) 로그 줄이 뒤섞이는 정도이지 크래시하지 않는다.
"$PYTHON" "$APP_DIR/latency_monitor.py" >/dev/null 2>&1 &
disown
