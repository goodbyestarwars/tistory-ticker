#!/bin/bash
# kiwoom-gongpasanscan.service/.timer를 등록해서 gongpasan_scan.py("공파산 타점" - 역매공파
# 전종목 스캔 + 백테스트)가 하루 1회 자동 실행되게 한다. angle_momentum_scan(20:35 KST)보다
# 5분 뒤인 20:40 KST(11:40 UTC, 예전 16:30 KST)로 잡았다 - daily_scan.py가 그날의 daily_prices를 다 채운
# 뒤에 돌아야 한다.
# 2026-09-14 사용자 지시("20:00시까지는 스캔 돌리지마. 장 끝나고 돌려")로 KRX 애프터마켓·NXT
# 마감(20:00) 뒤로 옮겼다. 이 파일이 바뀌면 deploy_check.sh(ensure_scan_timers_current)가
# VM에 다시 설치하고 타이머를 재시작한다 - 사람이 VM에서 다시 돌릴 필요는 없다.
# VM에서 한 번만 실행하면 됨: bash scripts/cloud-vm/setup_gongpasanscan_timer.sh
# 주의: gongpasan_scan.py는 pandas/numpy가 필요하다(accumulation_angle.py 모듈 docstring
# 참고) - 이 저장소엔 requirements.txt가 없어 VM venv에 없으면 먼저
# `$HOME/kiwoom-api/venv/bin/pip install pandas numpy`를 수동으로 실행해야 한다.
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-gongpasanscan.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom gongpasan(yeokmaegongpa) scan (full universe, DB-only, no external API calls)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/gongpasan_scan.py
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-gongpasanscan.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-gongpasanscan daily at 20:40 KST (11:40 UTC, anglemomentumscan 이후)

[Timer]
OnCalendar=*-*-* 11:40:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-gongpasanscan.timer
sudo systemctl start kiwoom-gongpasanscan.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-gongpasanscan.timer --no-pager
