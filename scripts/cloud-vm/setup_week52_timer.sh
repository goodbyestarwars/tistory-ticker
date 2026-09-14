#!/bin/bash
# kiwoom-week52.service/.timer를 등록해서 week52_scan.py(섹터 풀 238종목 52주 신고가/신저가)가
# 하루 1회(20:50 KST=11:50 UTC, 예전 19:30 KST - daily_scan 20:10 뒤, batch_scan.py의 21:00 KST 시작 전)
# 자동 실행되게 한다. VM에서 한 번만 실행하면 됨: bash scripts/cloud-vm/setup_week52_timer.sh
# 2026-09-14 사용자 지시("20:00시까지는 스캔 돌리지마. 장 끝나고 돌려")로 KRX 애프터마켓·NXT
# 마감(20:00) 뒤로 옮겼다. 이 파일이 바뀌면 deploy_check.sh(ensure_scan_timers_current)가
# VM에 다시 설치하고 타이머를 재시작한다 - 사람이 VM에서 다시 돌릴 필요는 없다.
# 2026-09-14 장애: 타이머 재설치 직후(23:08 KST) VM 응답이 전부 25초 넘게 멈췄다 - 스캔 여러 개가
# 한꺼번에 떠 1코어 VM을 다 쓴 것으로 본다. 그래서 스캔은 공용 잠금(.scan_serial.lock)으로
# 한 번에 하나만 돌고(겹치면 줄 서서 기다린다), CPU·디스크 우선순위를 FastAPI보다 낮춘다.
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-week52.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom week52 high/low scan (sector pool, 238 stocks)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=/usr/bin/flock $HOME_DIR/.scan_serial.lock $HOME_DIR/venv/bin/python $HOME_DIR/week52_scan.py
Nice=10
CPUWeight=20
IOSchedulingClass=idle
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-week52.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-week52 daily at 20:50 KST (11:50 UTC)

[Timer]
OnCalendar=*-*-* 11:50:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-week52.timer
sudo systemctl start kiwoom-week52.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-week52.timer --no-pager
