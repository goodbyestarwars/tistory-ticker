#!/bin/bash
# kiwoom-week52.service/.timer를 등록해서 week52_scan.py(섹터 풀 238종목 52주 신고가/신저가)가
# 하루 1회(19:30 KST=10:30 UTC, 장마감 이후 - batch_scan.py의 20:00 KST 시작 전 여유를 둠)
# 자동 실행되게 한다. VM에서 한 번만 실행하면 됨: bash scripts/cloud-vm/setup_week52_timer.sh
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-week52.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom week52 high/low scan (sector pool, 238 stocks)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/week52_scan.py
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-week52.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-week52 daily at 19:30 KST (10:30 UTC)

[Timer]
OnCalendar=*-*-* 10:30:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-week52.timer
sudo systemctl start kiwoom-week52.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-week52.timer --no-pager
