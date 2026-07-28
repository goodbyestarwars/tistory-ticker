#!/bin/bash
# 뉴스·검색 관심도 모멘텀 8종목 파일럿을 하루 1회 실행한다.
set -euo pipefail
HOME_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_USER="$(stat -c '%U' "$HOME_DIR")"
PILOT_CODES="000660,005930,005380,083650,042660,035420,066570,247540"
RUN_NOW="${1:-}"

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

sudo systemctl daemon-reload
sudo systemctl enable --now kiwoom-news-momentum.timer
if [ "$RUN_NOW" = "--run-now" ]; then
  if ! sudo systemctl start kiwoom-news-momentum.service; then
    ACTIVE_STATE="$(systemctl show kiwoom-news-momentum.service -p ActiveState --value 2>/dev/null || echo unknown)"
    RESULT="$(systemctl show kiwoom-news-momentum.service -p Result --value 2>/dev/null || echo unknown)"
    EXEC_CODE="$(systemctl show kiwoom-news-momentum.service -p ExecMainCode --value 2>/dev/null || echo unknown)"
    EXEC_STATUS="$(systemctl show kiwoom-news-momentum.service -p ExecMainStatus --value 2>/dev/null || echo unknown)"
    printf '{"status":"failed-before-batch","activeState":"%s","result":"%s","execMainCode":"%s","execMainStatus":"%s","user":"%s","workingDirectory":"%s"}\n' \
      "$ACTIVE_STATE" "$RESULT" "$EXEC_CODE" "$EXEC_STATUS" "$APP_USER" "$HOME_DIR" \
      > "$HOME_DIR/news_momentum_batch_status.json"
    exit 1
  fi
fi
systemctl list-timers kiwoom-news-momentum.timer --no-pager
