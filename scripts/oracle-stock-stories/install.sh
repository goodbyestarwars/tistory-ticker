#!/bin/bash
# Run on Oracle from the existing source checkout; no credential provisioning.
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")" && pwd)"
sudo install -d -m 755 /opt/ninepay-stock-stories
sudo install -m 644 "$SOURCE/refresh_stock_stories.py" /opt/ninepay-stock-stories/
sudo install -d -m 700 -o goodbyestarwars -g goodbyestarwars /var/lib/ninepay-stock-stories
sudo install -m 644 "$SOURCE/ninepay-stock-stories.service" "$SOURCE/ninepay-stock-stories.timer" /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/ninepay-stock-stories.service /etc/systemd/system/ninepay-stock-stories.timer
sudo systemd-analyze calendar 'Sun *-*-* 10:00:00 Asia/Seoul'
sudo systemctl daemon-reload
sudo systemctl enable --now ninepay-stock-stories.timer
sudo systemctl list-timers ninepay-stock-stories.timer --no-pager
