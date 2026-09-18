#!/bin/bash
# ETF 수익률 카테고리는 가격 변화를 반영해야 하므로 매일 갱신한다.
# 나머지 전략은 kiwoom-strategyscan.timer가 월요일 주 1회 갱신한다.
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-etfstrategyscan.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom ETF strategy return scan (daily)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=/usr/bin/flock $HOME_DIR/.scan_serial.lock $HOME_DIR/venv/bin/python $HOME_DIR/etf_strategy_scan.py
Nice=10
CPUWeight=20
IOSchedulingClass=idle
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-etfstrategyscan.timer > /dev/null << TIMEREOF
[Unit]
Description=Run daily ETF strategy return scan at 20:30 KST (11:30 UTC)

[Timer]
OnCalendar=*-*-* 11:30:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-etfstrategyscan.timer
sudo systemctl start kiwoom-etfstrategyscan.timer
systemctl list-timers kiwoom-etfstrategyscan.timer --no-pager
