#!/bin/bash
# kiwoom-dailyscan.service/.timer를 등록해서 daily_scan.py(차트패턴+눌림목+투자시그널
# 전종목 스캔)가 하루 1회(16:00 KST=07:00 UTC, 장마감 15:30 이후 여유) 자동 실행되게 한다.
# VM에서 한 번만 실행하면 됨: bash scripts/cloud-vm/setup_dailyscan_timer.sh
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-dailyscan.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom daily scan (chart patterns + pullback + invest signal, full universe)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/daily_scan.py
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-dailyscan.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-dailyscan daily at 16:00 KST (07:00 UTC)

[Timer]
OnCalendar=*-*-* 07:00:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-dailyscan.timer
sudo systemctl start kiwoom-dailyscan.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-dailyscan.timer --no-pager
