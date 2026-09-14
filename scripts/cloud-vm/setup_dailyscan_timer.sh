#!/bin/bash
# kiwoom-dailyscan.service/.timer를 등록해서 daily_scan.py(차트패턴+눌림목+투자시그널
# 전종목 스캔)가 하루 1회(20:10 KST=11:10 UTC, 예전 16:00 KST) 자동 실행되게 한다.
# 2026-09-14 사용자 지시("20:00시까지는 스캔 돌리지마. 장 끝나고 돌려")로 KRX 애프터마켓·NXT
# 마감(20:00) 뒤로 옮겼다. 이 파일이 바뀌면 deploy_check.sh(ensure_scan_timers_current)가
# VM에 다시 설치하고 타이머를 재시작한다 - 사람이 VM에서 다시 돌릴 필요는 없다.
# 스캔 성공 뒤에는 전일 이전 추천의 T+5/T+10/T+20 결과도 같은 DB에서 갱신한다.
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
ExecStartPost=$HOME_DIR/venv/bin/python $HOME_DIR/monitor_swing_recommendations.py
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-dailyscan.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-dailyscan daily at 20:10 KST (11:10 UTC)

[Timer]
OnCalendar=*-*-* 11:10:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-dailyscan.timer
sudo systemctl start kiwoom-dailyscan.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-dailyscan.timer --no-pager
