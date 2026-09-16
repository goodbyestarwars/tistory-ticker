#!/bin/bash
# kiwoom-scanreaper.service/.timer - 저녁 스캔이 아침까지 늘어지는 것을 막는 마감 타이머.
#
# 2026-09-17 장애: 20:10 KST에 시작한 daily_scan이 3시간 50분 걸려 00:00에 끝났고, 잠금을
# 넘겨받은 strategy_scan은 01:31에 "완료" 로그까지 찍고도 프로세스가 죽지 않은 채(메인 스레드
# D 상태 - 디스크 대기) 05:38까지 남아 있었다. 그 사이 후속 작업·뉴스 배치·야간 정리가 겹쳐
# 스왑 2GB를 전부 소진했고, API는 몇 시간 동안 응답하지 못했다.
#
# 사용자 기준(2026-09-17): "스캔은 07:30분까지는 끝내야 한다". 그래서 07:30 KST(22:30 UTC)에
# 남아 있는 스캔을 정리한다. 스캔을 건너뛰는 게 아니라 **마감 시각을 강제**하는 장치다 -
# 정상적인 밤에는 이미 모두 끝나 있어 아무 일도 하지 않는다.
#
# 이 파일이 바뀌면 deploy_check.sh(ensure_scan_timers_current)가 VM에 다시 설치한다.
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-scanreaper.service > /dev/null << SERVICEEOF
[Unit]
Description=Stop leftover kiwoom scans at 07:30 KST deadline

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'stopped=""; for unit in dailyscan strategyscan anglemomentumscan gongpasanscan week52 batch; do if systemctl is-active --quiet kiwoom-\$unit.service; then stopped="\$stopped kiwoom-\$unit"; systemctl stop kiwoom-\$unit.service; fi; done; if [ -n "\$stopped" ]; then echo "07:30 마감으로 중단:\$stopped"; else echo "07:30 마감 확인: 실행 중인 스캔 없음"; fi; if ! flock -n $HOME_DIR/.scan_serial.lock true; then echo "잠금을 아직 쥔 프로세스가 있어 정리한다"; fuser -k -TERM $HOME_DIR/.scan_serial.lock || true; sleep 20; fuser -k -KILL $HOME_DIR/.scan_serial.lock || true; fi'
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-scanreaper.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-scanreaper daily at 07:30 KST (22:30 UTC)

[Timer]
OnCalendar=*-*-* 22:30:00
Persistent=false

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-scanreaper.timer
sudo systemctl start kiwoom-scanreaper.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-scanreaper.timer --no-pager
