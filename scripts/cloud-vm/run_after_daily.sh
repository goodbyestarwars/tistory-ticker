#!/bin/bash
# Compatibility entry point: locking, deadlines, prerequisites and metrics live in Python.
set -eu
APP_DIR="/home/goodbyestarwars/kiwoom-api"
exec "$APP_DIR/venv/bin/python" "$APP_DIR/scheduled_job.py" "$@"
