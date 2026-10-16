"""Durable, account-free history of the two intraday scanner signals."""

import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone

DB_FILE = os.path.join(os.path.dirname(__file__), 'volume_surge_history.db')


def record(events, db_file=None):
    """Keep the first observation of each signal per trading day and stock."""
    if not events:
        return
    with closing(sqlite3.connect(db_file or DB_FILE, timeout=5)) as conn, conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS signal_history (
            trading_date TEXT NOT NULL,
            code TEXT NOT NULL,
            signal_type TEXT NOT NULL,
            detected_at TEXT NOT NULL,
            usable_at TEXT NOT NULL,
            detected_price REAL NOT NULL,
            cumulative_volume REAL,
            cumulative_value_raw REAL,
            value_field TEXT,
            value_unit TEXT,
            vwap_relative_pct REAL,
            index_relative_pct REAL,
            rejection_reason TEXT,
            source TEXT NOT NULL,
            source_as_of TEXT,
            PRIMARY KEY (trading_date, code, signal_type)
        )''')
        conn.executemany('''INSERT OR IGNORE INTO signal_history VALUES
            (:trading_date, :code, :signal_type, :detected_at, :usable_at,
             :detected_price, :cumulative_volume, :cumulative_value_raw,
             :value_field, :value_unit, :vwap_relative_pct, :index_relative_pct,
             :rejection_reason, :source, :source_as_of)''', events)


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()
