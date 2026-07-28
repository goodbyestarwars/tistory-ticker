#!/bin/bash
# 호환용 실행 래퍼. 별도 systemd 유닛을 만들지 않고 기존 kiwoom-deploy.timer가
# deploy_check.sh의 KST 날짜 마커를 통해 하루 한 번 이 8종목 배치를 실행한다.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PILOT_CODES="000660,005930,005380,083650,042660,035420,066570,247540"

exec "$APP_DIR/venv/bin/python" "$APP_DIR/news_momentum_scan.py" --codes "$PILOT_CODES"
