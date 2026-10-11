# -*- coding: utf-8 -*-
"""텔레그램 연동 전용 SQLite(telegram.db). 기존 autotrader.db·research.db 는 건드리지 않는다.

- kv        : 수신 오프셋, 무음 만료 시각, 실행 상태(생존 신호), 감시 워터마크 등
- outbox    : 보낼 메시지 대기열. dedupe_key 가 UNIQUE 라서 같은 사건은 한 번만 쌓이고, 재시작·네트워크 장애 뒤에도 남아 있다
- alerts    : 지속되는 장애의 상태(발생·재알림·복구)
- paper_seen: 모의 거래의 마지막으로 본 상태(변화 감지용)
- blocked   : 허용되지 않은 사용자의 접근 시도(안내 답장 횟수 제한용)
"""
import json
import sqlite3
import time

LEVEL_ORDER = {'critical': 0, 'warn': 1, 'info': 2}

SCHEMA = '''
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated REAL);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, dedupe_key TEXT UNIQUE NOT NULL, created REAL NOT NULL, category TEXT NOT NULL, level TEXT NOT NULL,
  text TEXT NOT NULL, markup TEXT, status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, next_try REAL NOT NULL,
  expires REAL NOT NULL, sent REAL, error TEXT);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_try);
CREATE TABLE IF NOT EXISTS alerts (key TEXT PRIMARY KEY, active INTEGER NOT NULL, since REAL, last_sent REAL, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS paper_seen (key TEXT PRIMARY KEY, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS paper_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, kind TEXT NOT NULL, ekey TEXT NOT NULL, variant TEXT, payload TEXT);
CREATE TABLE IF NOT EXISTS blocked (user_id TEXT PRIMARY KEY, first_seen REAL, last_seen REAL, count INTEGER NOT NULL DEFAULT 0, last_reply REAL);
'''


class TelegramStore:
    def __init__(self, path):
        self.path = path
        conn = self._conn()
        try:
            try:
                conn.execute('PRAGMA journal_mode=WAL')
            except sqlite3.DatabaseError:
                pass
            conn.executescript(SCHEMA)
            conn.commit()
        finally:
            conn.close()

    def _conn(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _run(self, sql, params=(), fetch=None):
        conn = self._conn()
        try:
            with conn:
                cur = conn.execute(sql, params)
                if fetch == 'one':
                    row = cur.fetchone()
                    return dict(row) if row else None
                if fetch == 'all':
                    return [dict(r) for r in cur.fetchall()]
                return cur.rowcount
        finally:
            conn.close()

    # ---- kv ----
    def kv_get(self, key, default=None):
        row = self._run('SELECT value FROM kv WHERE key=?', (key,), 'one')
        if not row:
            return default
        try:
            return json.loads(row['value'])
        except (TypeError, ValueError):
            return default

    def kv_set(self, key, value):
        self._run('INSERT INTO kv(key, value, updated) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated',
                  (key, json.dumps(value, ensure_ascii=False), time.time()))

    # ---- outbox ----
    def outbox_add(self, dedupe_key, category, level, text, now, ttl_sec, markup=None):
        """새로 쌓였으면 True, 같은 dedupe_key 가 이미 있으면 False(중복 방지)."""
        n = self._run('INSERT OR IGNORE INTO outbox(dedupe_key, created, category, level, text, markup, next_try, expires) VALUES (?,?,?,?,?,?,?,?)',
                      (dedupe_key, now, category, level, text, json.dumps(markup) if markup else None, now, now + ttl_sec))
        return n > 0

    def outbox_due(self, now, limit=20):
        rows = self._run("SELECT * FROM outbox WHERE status='PENDING' AND next_try<=? ORDER BY id LIMIT 200", (now,), 'all')
        rows.sort(key=lambda r: (LEVEL_ORDER.get(r['level'], 2), r['id']))
        return rows[:limit]

    def outbox_update(self, row_id, **fields):
        cols = ', '.join('%s=?' % k for k in fields)
        self._run('UPDATE outbox SET %s WHERE id=?' % cols, tuple(fields.values()) + (row_id,))

    def outbox_stats(self):
        out = {r['status']: r['n'] for r in self._run('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status', (), 'all')}
        oldest = self._run("SELECT MIN(created) AS c FROM outbox WHERE status='PENDING'", (), 'one')
        out['oldest_pending'] = oldest['c'] if oldest else None
        return out

    def outbox_reset_sending(self):
        return self._run("UPDATE outbox SET status='PENDING' WHERE status='SENDING'")

    def outbox_prune(self, before):
        return self._run("DELETE FROM outbox WHERE status IN ('SENT','MUTED','EXPIRED','FAILED') AND created<?", (before,))

    def outbox_recent(self, limit=10):
        return self._run('SELECT id, created, category, level, status, attempts, dedupe_key FROM outbox ORDER BY id DESC LIMIT ?', (limit,), 'all')

    # ---- alerts ----
    def alert_get(self, key):
        return self._run('SELECT * FROM alerts WHERE key=?', (key,), 'one')

    def alert_put(self, key, active, since, last_sent, count):
        self._run('INSERT INTO alerts(key, active, since, last_sent, count) VALUES (?,?,?,?,?) '
                  'ON CONFLICT(key) DO UPDATE SET active=excluded.active, since=excluded.since, last_sent=excluded.last_sent, count=excluded.count',
                  (key, 1 if active else 0, since, last_sent, count))

    def alerts_active(self):
        return self._run('SELECT * FROM alerts WHERE active=1 ORDER BY since', (), 'all')

    # ---- 모의 거래 상태 ----
    def paper_seen_all(self):
        return {r['key']: r['state'] for r in self._run('SELECT key, state FROM paper_seen', (), 'all')}

    def paper_seen_put(self, pairs):
        conn = self._conn()
        try:
            with conn:
                conn.executemany('INSERT INTO paper_seen(key, state) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state', list(pairs))
        finally:
            conn.close()

    def paper_event_add(self, ts, kind, ekey, variant, payload):
        self._run('INSERT INTO paper_events(ts, kind, ekey, variant, payload) VALUES (?,?,?,?,?)', (ts, kind, ekey, variant, json.dumps(payload, ensure_ascii=False)))

    def paper_events_since(self, ts):
        rows = self._run('SELECT * FROM paper_events WHERE ts>? ORDER BY id', (ts,), 'all')
        for r in rows:
            r['payload'] = json.loads(r['payload'] or '{}')
        return rows

    # ---- 허용되지 않은 접근 ----
    def blocked_note(self, user_id, now, reply_gap_sec=600):
        """접근 시도를 기록하고, 이번에 안내 답장을 보내도 되는지(마지막 답장 후 reply_gap_sec 경과) 돌려준다."""
        user_id = str(user_id)
        row = self._run('SELECT * FROM blocked WHERE user_id=?', (user_id,), 'one')
        reply = row is None or (now - (row['last_reply'] or 0)) >= reply_gap_sec
        self._run('INSERT INTO blocked(user_id, first_seen, last_seen, count, last_reply) VALUES (?,?,?,1,?) '
                  'ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen, count=count+1, last_reply=CASE WHEN ? THEN excluded.last_reply ELSE last_reply END',
                  (user_id, now, now, now if reply else None, 1 if reply else 0))
        return reply

    def blocked_summary(self):
        return self._run('SELECT COUNT(*) AS users, COALESCE(SUM(count),0) AS attempts FROM blocked', (), 'one')
