#!/bin/bash
# kiwoom-guestbookbackup.service/.timer: 티스토리 방명록 공개 글을 주 1회(일요일 03:00 KST, 타임존을
# 명시해 서버 시간대와 무관) guestbook_backup.py로 백업한다. 티스토리 관리자 백업은 댓글/방명록을
# 포함하지 않아서 직접 만든다(2026-11-21 사용자 지시).
#
# 가볍다: 공개 페이지 몇 장(수십 KB)을 받아 JSON 하나에 병합하는 1초 안팎 작업이라 스캔 공용
# 잠금(.scan_serial.lock)을 쓰지 않는다. 대신 우선순위를 낮춰 API를 방해하지 않는다.
# 저장 위치: $HOME/guestbook-backup/guestbook.json (git 작업 폴더 밖, 공개 API로 내보내지 않음).
# 이 파일이 바뀌면 deploy_check.sh(ensure_scan_timers_current)가 VM에 다시 설치한다.
# 배포 계정(goodbyestarwars)은 /etc/systemd 쓰기 sudo 권한이 없어 자동 재설치가 실패한다 -> ubuntu 계정에서 수동 설치:
# ssh 9pay "USER=goodbyestarwars HOME=/home/goodbyestarwars bash -s" < setup_guestbookbackup_timer.sh
# (참고) bash scripts/cloud-vm/setup_guestbookbackup_timer.sh
set -e
HOME_DIR="$HOME/kiwoom-api"

sudo tee /etc/systemd/system/kiwoom-guestbookbackup.service > /dev/null << SERVICEEOF
[Unit]
Description=Weekly backup of the public Tistory guestbook

[Service]
Type=oneshot
TimeoutStartSec=10min
TimeoutStopSec=35
User=$USER
WorkingDirectory=$HOME_DIR/scripts/cloud-vm
ExecStart=$HOME_DIR/venv/bin/python $HOME_DIR/scripts/cloud-vm/guestbook_backup.py
Nice=15
CPUWeight=10
IOSchedulingClass=idle
SERVICEEOF

sudo tee /etc/systemd/system/kiwoom-guestbookbackup.timer > /dev/null << TIMEREOF
[Unit]
Description=Run kiwoom-guestbookbackup weekly on Sunday 03:00 KST

[Timer]
OnCalendar=Sun *-*-* 03:00:00 Asia/Seoul
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable kiwoom-guestbookbackup.timer
sudo systemctl start kiwoom-guestbookbackup.timer

echo "=== timer 등록 결과 ==="
systemctl list-timers kiwoom-guestbookbackup.timer --no-pager
