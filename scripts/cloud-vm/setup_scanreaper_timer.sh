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
# 2026-09-17 첫 실전에서 두 가지가 드러나 구조를 바꿨다.
#  (1) 스캔 유닛은 전부 Type=oneshot이라 ExecStart가 도는 동안 ActiveState가 "active"가 아니라
#      **"activating"** 이다. 처음 쓰던 `systemctl is-active --quiet`는 batch_scan이 멀쩡히
#      돌고 있는데도 거짓을 돌려줬고, 유닛 중단 루프가 통째로 건너뛰어졌다("실행 중인 스캔
#      없음"이라고 찍고 지나감). 마감을 실제로 지킨 건 뒤의 잠금 정리(fuser -k)였는데, 그건
#      systemd가 모르는 죽음이라 유닛이 failed로 남는다. ActiveState를 직접 읽어 activating까지
#      잡는다 - 그래야 systemctl stop으로 얌전히 끊기고 상태도 깨끗하다.
#  (2) 로직을 ExecStart 한 줄에 인라인으로 넣으면 heredoc의 $(...)와 systemd의 $VAR 확장이
#      겹쳐 무엇이 언제 펼쳐지는지 확신할 수 없다. 별도 스크립트 파일로 빼서 bash만 해석하게
#      한다(ExecStart에는 $가 하나도 없다).
#
# 이 파일이 바뀌면 deploy_check.sh(ensure_scan_timers_current)가 VM에 다시 설치한다.
set -e
HOME_DIR="$HOME/kiwoom-api"
REAPER_BIN=/usr/local/sbin/kiwoom-scan-reaper.sh

# 실제 마감 로직. 따옴표 heredoc이라 여기 있는 $는 전부 실행 시점의 bash 것이다.
sudo tee "$REAPER_BIN" > /dev/null << 'REAPEREOF'
#!/bin/bash
# 07:30 KST 마감: 남아 있는 스캔을 멈추고, 공용 잠금을 쥔 채 죽지 않는 프로세스를 정리한다.
# 실행 주체는 kiwoom-scanreaper.service(위 setup_scanreaper_timer.sh가 설치).
set -u
LOCK="$SCAN_HOME/.scan_serial.lock"

stopped=""
for unit in dailyscan strategyscan anglemomentumscan gongpasanscan week52 batch; do
  # oneshot은 도는 동안 activating이다. active만 보면 영영 못 잡는다(위 주석 (1)).
  state=$(systemctl show -p ActiveState --value "kiwoom-$unit.service" 2>/dev/null || echo unknown)
  case "$state" in
    active|activating|reloading)
      stopped="$stopped kiwoom-$unit($state)"
      systemctl stop "kiwoom-$unit.service" || true
      ;;
  esac
done

if [ -n "$stopped" ]; then
  echo "07:30 마감으로 중단:$stopped"
else
  echo "07:30 마감 확인: 실행 중인 스캔 없음"
fi

# 유닛을 멈춰도 잠금을 쥔 프로세스가 남을 수 있다(2026-09-17 strategy_scan이 그랬다).
if ! flock -n "$LOCK" true; then
  echo "잠금을 아직 쥔 프로세스가 있어 정리한다"
  fuser -k -TERM "$LOCK" || true
  sleep 20
  fuser -k -KILL "$LOCK" || true
fi
REAPEREOF
sudo chmod 755 "$REAPER_BIN"

sudo tee /etc/systemd/system/kiwoom-scanreaper.service > /dev/null << SERVICEEOF
[Unit]
Description=Stop leftover kiwoom scans at 07:30 KST deadline

[Service]
Type=oneshot
Environment=SCAN_HOME=$HOME_DIR
ExecStart=$REAPER_BIN
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
