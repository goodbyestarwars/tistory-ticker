#!/bin/bash
# kiwoom-swingmonitor.service/.timer를 등록해서 monitor_swing_recommendations.py
# (저장된 스윙 추천의 T+5/T+10 결과 채우기)가 하루 1회(07:45 KST=22:45 UTC) 돈다.
#
# 원래 이 작업은 kiwoom-dailyscan.service의 ExecStartPost였다. 2026-09-18에 떼어냈다.
#
# 왜 뗐나: 두 자리 모두 공용 잠금(.scan_serial.lock)을 쓰는데, daily_scan이 끝나는 순간
# 잠금은 이미 줄 서 있던 batch_scan이 가져간다. 그래서 ExecStartPost는 batch_scan이
# 끝날 때까지 기다리고, 그동안 kiwoom-dailyscan.service는 `activating(start-post)`으로
# 남는다. 2026-09-17 실측으로 **3시간 36분**을 그 상태로 있었다. 결과는 두 가지다.
#   1) 07:30 마감 리퍼가 `activating` 유닛을 멈추므로, 줄이 길었던 날은 이 작업이
#      한 번도 못 돌고 죽는다.
#   2) 유닛 상태만 봐서는 daily_scan이 아직 스캔 중인지 후속 작업을 기다리는 중인지
#      구분이 안 된다(실제로는 14:57에 이미 스캔을 마치고 캐시까지 저장했다).
#
# 잠금 자체는 그대로 둔다. 2026-09-17에 이 작업을 잠금 밖에서 돌렸다가, 잠금을 넘겨받은
# strategy_scan과 동시에 실행되면서 둘이 각각 150~190MB를 써 1GB VM의 스왑 2GB를 전부
# 소진했고 API가 몇 시간 응답하지 못했다. 그 교훈은 유효하다.
#
# 대신 기다리는 시간에 상한을 둔다(-w 1800). 30분 안에 잠금을 못 잡으면 76으로 끝내고
# 그날은 넘어간다. 이 작업은 **여러 번 돌려도 안전하고**(monitor_swing_recommendations.py
# 독스트링: "safe to run repeatedly") t10_return이 비어 있는 행만 다시 본다. 하루 걸러도
# 다음 날 같은 행을 그대로 채운다 - 영영 못 도는 것보다 낫다.
#
# 시각(22:45 UTC = 07:45 KST)은 **07:30 마감 리퍼 직후**다. 스캔 줄이 빈 시각을 고르려
# 했지만, 2026-09-17 실측으로 batch_scan이 펀더멘탈 구간에서 종목당 17초씩 쓰며 10시간
# 넘게 잠금을 쥐고 있었다. 하루 중 "줄이 비는 시각"을 달력으로 맞히는 건 믿을 수 없다.
# 리퍼가 남은 스캔을 멈추고 잠금까지 정리한 직후가 유일하게 비어 있음이 보장되는 순간이다.
# 장 시작(09:00 KST)과 거래량 돌파 관측(09:05 KST)보다는 앞이라 장중 작업과도 안 겹친다.
#
# 이 파일이 바뀌면 deploy_check.sh(ensure_scan_timers_current)가 VM에 다시 설치한다 -
# 사람이 VM에서 다시 돌릴 필요는 없다.
# VM에서 수동으로 한 번만 실행할 때: bash scripts/cloud-vm/setup_swingmonitor_timer.sh
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-swingmonitor.service > /dev/null << SERVICEEOF
[Unit]
Description=Fill T+5/T+10 outcomes for saved swing recommendations

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$HOME_DIR
# -w 1800: 잠금을 최대 30분만 기다린다. -E 76: 못 잡고 끝났을 때의 종료코드(deploy_check.sh가
# 쓰는 값과 같은 뜻 - "잠금이 바빠서 건너뜀"). SuccessExitStatus로 실패가 아니라고 알려 준다.
ExecStart=/usr/bin/flock -w 1800 -E 76 $HOME_DIR/.scan_serial.lock $HOME_DIR/venv/bin/python $HOME_DIR/monitor_swing_recommendations.py
SuccessExitStatus=76
Nice=10
CPUWeight=20
IOSchedulingClass=idle
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-swingmonitor.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-swingmonitor daily at 07:45 KST (22:45 UTC), just after the 07:30 reaper

[Timer]
OnCalendar=*-*-* 22:45:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-swingmonitor.timer
sudo systemctl start kiwoom-swingmonitor.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-swingmonitor.timer --no-pager
