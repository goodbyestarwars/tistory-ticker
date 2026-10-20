#!/bin/bash
# One downstream job at a time, after the same trading day's daily_scan cache.
set -u
APP_DIR="/home/goodbyestarwars/kiwoom-api"
job="$1"
shift
queued="$(date +%s)"
exec 9>"$APP_DIR/.scan_serial.lock"
if ! flock -w 21600 9; then
  echo "[schedule] job=$job lock_timeout_sec=21600" >&2
  exit 76
fi
started="$(date +%s)"
echo "[schedule] job=$job waitSec=$((started - queued)) startedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
"$APP_DIR/venv/bin/python" "$APP_DIR/scan_prereq.py"
prereq=$?
if [ "$prereq" = 3 ]; then
  echo "[schedule] job=$job holiday_skip=1"
  exit 0
fi
if [ "$prereq" != 0 ]; then
  echo "[schedule] job=$job prerequisite_failed=1" >&2
  exit "$prereq"
fi
"$@"
result=$?
echo "[schedule] job=$job runSec=$(($(date +%s) - started)) exit=$result"
exit "$result"
