#!/bin/bash
# kiwoom-batch.service/.timer를 등록해서 batch_scan.py가 하루 1회(20:00 KST=11:00 UTC,
# 장 마감 후 데이터 정산 시간 감안) 자동 실행되게 한다.
# VM에서 한 번만 실행하면 됨: bash scripts/cloud-vm/setup_batch_timer.sh
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-batch.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom investor-flow batch scan (sector pool)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/batch_scan.py
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-batch.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-batch daily at 20:00 KST (11:00 UTC)

[Timer]
OnCalendar=*-*-* 11:00:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-batch.timer
sudo systemctl start kiwoom-batch.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-batch.timer --no-pager
