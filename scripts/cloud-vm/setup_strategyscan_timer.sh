#!/bin/bash
# kiwoom-strategyscan.service/.timer를 등록해서 strategy_scan.py(저평가 종목 전종목 스캔
# - 2026-08 전엔 kisyaml 프리셋 전략 스캔이었음)가 하루 1회(16:20 KST=07:20 UTC) 자동
# 실행되게 한다. daily_scan.py(16:00 KST)가 그날의 daily_prices를 다 채운 뒤에 돌아야
# 하므로 20분 뒤로 잡았다.
# VM에서 한 번만 실행하면 됨: bash scripts/cloud-vm/setup_strategyscan_timer.sh
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-strategyscan.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom undervalued-stock scan (full universe, DB-only, no external API calls)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/strategy_scan.py
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-strategyscan.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-strategyscan daily at 16:20 KST (07:20 UTC, daily_scan 이후)

[Timer]
OnCalendar=*-*-* 07:20:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-strategyscan.timer
sudo systemctl start kiwoom-strategyscan.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-strategyscan.timer --no-pager
