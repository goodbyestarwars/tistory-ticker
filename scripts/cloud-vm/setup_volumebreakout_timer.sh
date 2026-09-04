#!/bin/bash
# kiwoom-volumebreakout.service/.timer를 등록해서 volume_breakout_scan.py가 평일
# 09:10 KST(00:10 UTC)에 한 번 실행되게 한다.
#
# 다른 스캔 타이머와 달리 장중에 돈다. "전일 거래량을 개장 10분 만에 넘었는가"는
# 09:10에만 확정되는 조건이라, 장 마감 뒤에 돌리는 daily_scan으로는 알 수 없다.
# 장중 계속 감시할 이유는 없다 - 09:10 판정 이후로는 결과가 바뀌지 않는다.
#
# 주말·공휴일에도 타이머는 뜨지만 순위 API가 당일 거래를 돌려주지 않아 후보가 비고,
# 그 경우 빈 목록으로 저장된다(화면은 "조건에 맞는 종목이 없습니다"로 표시).
#
# VM에서 한 번만 실행하면 됨: bash scripts/cloud-vm/setup_volumebreakout_timer.sh
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-volumebreakout.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom volume breakout scan (previous-day volume passed within 10 minutes of open)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/volume_breakout_scan.py
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-volumebreakout.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-volumebreakout on weekdays at 09:10 KST (00:10 UTC)

[Timer]
OnCalendar=Mon..Fri *-*-* 00:10:00
Persistent=false

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-volumebreakout.timer
sudo systemctl start kiwoom-volumebreakout.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-volumebreakout.timer --no-pager
