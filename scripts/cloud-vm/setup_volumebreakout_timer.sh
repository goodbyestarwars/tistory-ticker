#!/bin/bash
# kiwoom-volumebreakout.service/.timer를 등록해서 volume_breakout_scan.py가 평일
# 09:05 KST(00:05 UTC)에 한 번 실행되게 한다.
#
# 다른 스캔 타이머와 달리 장중에 돈다. "갭상승 + 전일 거래량의 절반을 개장 5분 만에
# 넘었는가"는 09:05에만 확정되는 조건이라, 장 마감 뒤에 돌리는 daily_scan으로는 알 수
# 없다. 장중 계속 감시할 이유는 없다 - 09:05 판정 이후로는 결과가 바뀌지 않는다.
#
# 주말·공휴일에도 타이머는 뜨지만 순위 API가 당일 거래를 돌려주지 않아 후보가 비고,
# 그 경우 빈 목록으로 저장된다(화면은 "조건에 맞는 종목이 없습니다"로 표시).
#
# 2026-09-04: 이 스크립트를 사람이 직접 돌릴 필요는 없다. deploy_check.sh가 5분마다
# 돌면서 /etc/systemd/system/kiwoom-volumebreakout.timer가 없으면 여기를 실행한다
# (ensure_volume_breakout_timer). 배포가 VM에 닿고 5분 안에 자동 등록된다. 2026-09-17부터는
# ensure_scan_timers_current 목록에도 들어 있어, 이 파일이 바뀌면 해시 비교로 다시 설치된다.
#
# 2026-09-17 사용자 지적("10분에 잡으니까 너무 떠서 가는데, 5분으로 줄일까?"): 그날 09:10
# 실측 16종목의 등락률 중앙값이 +9.34%였다. 시각만 당기면 조건("누적 >= 전일 하루치")이
# 그만큼 세져 잡히는 종목이 급감하므로, 관측 전용 09:05 패스(--probe)를 따로 둬 "5분
# 시점 몇 배면 10분에 1.0배가 되더라"를 로그로 남겼다.
# 2026-09-22 사용자 지시("일단 시초가 갭상승 + 거래량 50%는 09:05분에 검출 가능하겠지?" ->
# "거래량 돌파 탭을 내가 말한거로 수정해"): 그 관측으로 얻은 0.5배 문턱을 실제 조건으로
# 승격해 본 스캔 자체를 09:05·0.5배로 옮겼다. 관측 전용 --probe 타이머는 이제 본 스캔이
# 하는 일과 같아져 필요 없다 - 이미 VM에 설치돼 있을 수 있으니 여기서 지운다.
#
# 수동으로 돌려야 할 때는 GCP VM 안에서만 된다 - Cloud Shell에는 이 리포 체크아웃도
# ~/kiwoom-api도 없어서 "No such file or directory"가 난다.
set -e
HOME_DIR="$HOME/kiwoom-api"

# 2026-09-22: 예전 관측 전용 타이머 - 있으면 멈추고 지운다(없으면 조용히 넘어간다).
sudo systemctl disable --now kiwoom-volumebreakout-probe.timer 2>/dev/null || true
sudo rm -f /etc/systemd/system/kiwoom-volumebreakout-probe.service \
           /etc/systemd/system/kiwoom-volumebreakout-probe.timer

sudo tee /etc/systemd/system/kiwoom-volumebreakout.service > /dev/null << SERVICEEOF
[Unit]
Description=Kiwoom volume breakout scan (gap-up + half of previous-day volume within 5 minutes of open)

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/volume_breakout_scan.py
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-volumebreakout.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-volumebreakout on weekdays at 09:05 KST (00:05 UTC)

[Timer]
OnCalendar=Mon..Fri *-*-* 00:05:00
Persistent=false

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-volumebreakout.timer
sudo systemctl restart kiwoom-volumebreakout.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-volumebreakout.timer --no-pager
