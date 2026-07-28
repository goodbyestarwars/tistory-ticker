#!/bin/bash
# 뉴스·검색 관심도 모멘텀 8종목 파일럿을 하루 1회 실행한다.
set -euo pipefail
HOME_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_USER="$(stat -c '%U' "$HOME_DIR")"
PILOT_CODES="000660,005930,005380,083650,042660,035420,066570,247540"
RUN_NOW="${1:-}"
STATUS_FILE="$HOME_DIR/news_momentum_batch_status.json"
SETUP_STAGE="initialize"

write_setup_failure() {
  local exit_code="$1"
  printf '{"status":"failed-before-batch","stage":"%s","exitCode":"%s","user":"%s","workingDirectory":"%s"}\n' \
    "$SETUP_STAGE" "$exit_code" "$APP_USER" "$HOME_DIR" > "$STATUS_FILE"
}
trap 'code=$?; write_setup_failure "$code"; exit "$code"' ERR

SETUP_STAGE="write-service-unit"
sudo tee /etc/systemd/system/kiwoom-news-momentum.service > /dev/null << SERVICEEOF
[Unit]
Description=9Pay news and search-interest momentum 8-stock pilot batch
After=network-online.target

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/news_momentum_scan.py --codes $PILOT_CODES
Environment=PYTHONUNBUFFERED=1
UMask=0077
Nice=10
IOSchedulingClass=idle
SERVICEEOF

SETUP_STAGE="write-timer-unit"
sudo tee /etc/systemd/system/kiwoom-news-momentum.timer > /dev/null << TIMEREOF
[Unit]
Description=Run 9Pay news momentum pilot daily at 18:00 KST (09:00 UTC)

[Timer]
OnCalendar=*-*-* 09:00:00
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
TIMEREOF

SETUP_STAGE="daemon-reload"
sudo systemctl daemon-reload
SETUP_STAGE="enable-timer"
sudo systemctl enable --now kiwoom-news-momentum.timer
if [ "$RUN_NOW" = "--run-now" ]; then
  SETUP_STAGE="start-service"
  if ! sudo systemctl start kiwoom-news-momentum.service; then
    ACTIVE_STATE="$(systemctl show kiwoom-news-momentum.service -p ActiveState --value 2>/dev/null || echo unknown)"
    RESULT="$(systemctl show kiwoom-news-momentum.service -p Result --value 2>/dev/null || echo unknown)"
    EXEC_CODE="$(systemctl show kiwoom-news-momentum.service -p ExecMainCode --value 2>/dev/null || echo unknown)"
    EXEC_STATUS="$(systemctl show kiwoom-news-momentum.service -p ExecMainStatus --value 2>/dev/null || echo unknown)"
    printf '{"status":"failed-before-batch","activeState":"%s","result":"%s","execMainCode":"%s","execMainStatus":"%s","user":"%s","workingDirectory":"%s"}\n' \
      "$ACTIVE_STATE" "$RESULT" "$EXEC_CODE" "$EXEC_STATUS" "$APP_USER" "$HOME_DIR" \
      > "$STATUS_FILE"
    exit 1
  fi
fi
SETUP_STAGE="list-timer"
systemctl list-timers kiwoom-news-momentum.timer --no-pager
