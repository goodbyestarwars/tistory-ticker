#!/bin/bash
# kiwoom-anglemomentumscan.service/.timer를 등록해서 angle_momentum_scan.py("각도기
# 테스트" - 정규화 세력매집각도 전종목 스캔 + 백테스트)가 하루 1회 자동 실행되게 한다.
# strategy_scan.py(16:20 KST=07:20 UTC)보다 5분 뒤인 16:25 KST(07:25 UTC)로 잡았다 -
# daily_scan.py가 그날의 daily_prices를 다 채운 뒤에 돌아야 한다.
# VM에서 한 번만 실행하면 됨: bash scripts/cloud-vm/setup_anglemomentumscan_timer.sh
# 주의: angle_momentum_scan.py는 pandas/numpy가 필요하다(accumulation_angle.py 모듈
# docstring 참고) - 이 저장소엔 requirements.txt가 없어 VM venv에 없으면 먼저
# `$HOME/kiwoom-api/venv/bin/pip install pandas numpy`를 수동으로 실행해야 한다.
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-anglemomentumscan.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom normalized angle-momentum scan (full universe, DB-only, no external API calls)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/angle_momentum_scan.py
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-anglemomentumscan.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-anglemomentumscan daily at 16:25 KST (07:25 UTC, strategyscan 이후)

[Timer]
OnCalendar=*-*-* 07:25:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-anglemomentumscan.timer
sudo systemctl start kiwoom-anglemomentumscan.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-anglemomentumscan.timer --no-pager
