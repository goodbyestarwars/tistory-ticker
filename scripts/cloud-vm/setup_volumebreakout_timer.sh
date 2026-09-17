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
# 2026-09-04: 이 스크립트를 사람이 직접 돌릴 필요는 없다. deploy_check.sh가 5분마다
# 돌면서 /etc/systemd/system/kiwoom-volumebreakout.timer가 없으면 여기를 실행한다
# (ensure_volume_breakout_timer). 배포가 VM에 닿고 5분 안에 자동 등록된다. 2026-09-17부터는
# ensure_scan_timers_current 목록에도 들어 있어, 이 파일이 바뀌면 해시 비교로 다시 설치된다.
#
# 2026-09-17 사용자 지적("10분에 잡으니까 너무 떠서 가는데, 5분으로 줄일까?").
# 그날 09:10 실측 16종목의 등락률 중앙값이 +9.34%였다. 다만 조건이 "누적 >= 전일 하루치"라
# 시각만 5분으로 당기면 문턱이 두 배로 세져 잡히는 종목이 급감한다(그날 절반이 1.0~1.3배
# 턱걸이였다). 앞당기려면 문턱도 같이 낮춰야 하는데 그 값을 모른다.
# 그래서 09:05에 **관측 전용** 패스(--probe)를 하나 더 둔다. 화면에 쓰는 결과는 건드리지
# 않고 "5분 시점에 전일 대비 몇 배였나"만 기록한다. 09:10 본 스캔이 자기 결과와 맞춰
# "5분 시점 X배면 10분에 1.0배가 되더라"를 로그로 남기므로, 며칠이면 X가 나온다.
#
# 수동으로 돌려야 할 때는 GCP VM 안에서만 된다 - Cloud Shell에는 이 리포 체크아웃도
# ~/kiwoom-api도 없어서 "No such file or directory"가 난다.
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

sudo tee /etc/systemd/system/kiwoom-volumebreakout-probe.service > /dev/null << PROBESERVICEEOF
[Unit]
Description=Kiwoom volume breakout PROBE (records 5-minute ratios only, writes no screen data)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/volume_breakout_scan.py --probe
PROBESERVICEEOF

sudo tee /etc/systemd/system/kiwoom-volumebreakout-probe.timer > /dev/null << PROBETIMEREOF
[Unit]
Description=Run volume breakout probe on weekdays at 09:05 KST (00:05 UTC)

[Timer]
OnCalendar=Mon..Fri *-*-* 00:05:00
Persistent=false

[Install]
WantedBy=timers.target
PROBETIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-volumebreakout.timer kiwoom-volumebreakout-probe.timer
sudo systemctl restart kiwoom-volumebreakout.timer kiwoom-volumebreakout-probe.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-volumebreakout.timer kiwoom-volumebreakout-probe.timer --no-pager
