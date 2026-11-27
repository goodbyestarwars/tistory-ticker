#!/bin/bash
# 코스닥 장중 모니터링 하루치 시작 스크립트 (연구 전용, 주문 없음). Oracle 연구 VM 크론이 평일 08:58 KST에 실행한다.
# 휴장일은 NAVER marketStatus 가 OPEN 이 아니어서 신호·호가가 기록되지 않는다.
set -u
BASE=$HOME/study_side/minute
S=$BASE/scripts/research
PY=$HOME/spring_venv/bin/python
D=$(TZ=Asia/Seoul date +%F)
OUT=$BASE/daily/$D
mkdir -p "$OUT/snap"
cd "$BASE"
nohup "$PY" "$S/live_angle_watch.py" "$HOME/lab5y/cache" "$BASE/market_split.json" "$OUT/live.jsonl" > "$OUT/live.log" 2>&1 &
nohup "$PY" "$S/monitor_snapshots.py" "$OUT/snap" 0905 0910 0920 0930 1000 1100 1300 1400 1500 1520 1535 > "$OUT/snap.log" 2>&1 &
nohup sudo -n bash "$BASE/run_as_service_env.sh" "$PY" "$S/live_orderbook_watch.py" "$OUT/live.jsonl" "$OUT/book.jsonl" 30 120 > "$OUT/book.log" 2>&1 &
