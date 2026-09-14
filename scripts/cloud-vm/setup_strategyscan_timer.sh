#!/bin/bash
# kiwoom-strategyscan.service/.timer를 등록해서 strategy_scan.py(저평가 종목 전종목 스캔
# - 2026-08 전엔 kisyaml 프리셋 전략 스캔이었음)가 하루 1회(20:30 KST=11:30 UTC, 예전 16:20 KST) 자동
# 실행되게 한다. daily_scan.py(20:10 KST)가 그날의 daily_prices를 다 채운 뒤에 돌아야
# 하므로 20분 뒤로 잡았다.
# 2026-09-14 사용자 지시("20:00시까지는 스캔 돌리지마. 장 끝나고 돌려")로 KRX 애프터마켓·NXT
# 마감(20:00) 뒤로 옮겼다. 이 파일이 바뀌면 deploy_check.sh(ensure_scan_timers_current)가
# VM에 다시 설치하고 타이머를 재시작한다 - 사람이 VM에서 다시 돌릴 필요는 없다.
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
Description=Run kiwoom-strategyscan daily at 20:30 KST (11:30 UTC, daily_scan 이후)

[Timer]
OnCalendar=*-*-* 11:30:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-strategyscan.timer
sudo systemctl start kiwoom-strategyscan.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-strategyscan.timer --no-pager
