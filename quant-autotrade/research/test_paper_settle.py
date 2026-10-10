# -*- coding: utf-8 -*-
"""모의매매 병렬 청산 기록 테스트: 3개 전략 행 생성·중복/재실행 방지·미확정(PENDING_EXIT)·기존 DB 마이그레이션·전략별 독립 계좌."""
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import candidate_gen as cg  # noqa: E402
import paper_exits as pe  # noqa: E402
import research_job as rj  # noqa: E402
from test_paper_exits import walk  # noqa: E402

KST = timezone(timedelta(hours=9))


def seed_candidate(conn, scan_date, code='000100', scanner='pullback', score=90.0, base=10000.0):
    conn.execute("INSERT OR IGNORE INTO candidates(scan_date, scanner, code, name, score, base_price, scanned_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
                 (scan_date, scanner, code, 'N' + code, score, base, 'x', 'x'))
    conn.commit()


def rising_then(closes_tail, n_up=40, start_date=datetime(2026, 1, 1)):
    """완만히 오르다 closes_tail 로 끝나는 일봉. 마지막 인덱스의 날짜는 start_date + len-1."""
    closes = [100 + k * 0.5 for k in range(n_up)] + list(closes_tail)
    out = []
    for k, c in enumerate(closes):
        prev = closes[k - 1] if k else c
        out.append({'date': (start_date + timedelta(days=k)).strftime('%Y-%m-%d'), 'open': prev, 'close': c,
                    'high': max(prev, c) * 1.004, 'low': min(prev, c) * 0.996})
    return out


class ParallelPaperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = cg.connect(os.path.join(self.tmp, 'r.db'))

    def tearDown(self):
        self.conn.close()

    def test_one_candidate_creates_three_variant_rows_once(self):
        daily = rising_then([121, 122, 123])
        scan_date = daily[39]['date']
        seed_candidate(self.conn, scan_date)
        self.assertEqual(cg.paper_enter(self.conn, lambda c: daily, '2026-03-01'), 1)
        rows = self.conn.execute('SELECT variant, entry_date, entry_price, max_hold FROM paper_trades ORDER BY variant').fetchall()
        self.assertEqual([r[0] for r in rows], ['atr_close', 'dead35', 'trail_atr'])
        self.assertEqual(len({(r[1], r[2]) for r in rows}), 1)                   # 같은 진입
        self.assertEqual({r[0]: r[3] for r in rows}, {'trail_atr': 30, 'atr_close': 150, 'dead35': 150})   # 최대 보유 구분
        self.assertEqual(cg.paper_enter(self.conn, lambda c: daily, '2026-03-02'), 0)          # 재실행: 후보가 이미 처리됨
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM paper_trades').fetchone()[0], 3)

    def test_settle_is_idempotent_and_never_rewrites_closed_rows(self):
        daily = walk(5, n=300, vol=0.03)
        scan_idx = 60
        seed_candidate(self.conn, daily[scan_idx]['date'], base=daily[scan_idx]['close'])
        daily[scan_idx + 1]['open'] = daily[scan_idx]['close']          # 갭 제외를 피한다
        cg.paper_enter(self.conn, lambda c: daily, '2027-01-01')
        first = cg.paper_settle(self.conn, lambda c: daily, '2027-01-01')
        snap = self.conn.execute('SELECT * FROM paper_trades ORDER BY variant').fetchall()
        again = cg.paper_settle(self.conn, lambda c: daily, '2027-01-02')
        self.assertEqual(again, 0)
        self.assertEqual(self.conn.execute('SELECT * FROM paper_trades ORDER BY variant').fetchall(), snap)   # 확정 행은 그대로
        self.assertGreaterEqual(first, 1)
        # 이후 데이터가 달라져도(예: 값이 정정되어도) 확정된 기록은 바뀌지 않는다
        changed = [dict(b, close=b['close'] * 0.5, open=b['open'] * 0.5) for b in daily]
        cg.paper_settle(self.conn, lambda c: changed, '2027-01-03')
        self.assertEqual(self.conn.execute("SELECT * FROM paper_trades WHERE status='CLOSED' ORDER BY variant").fetchall(),
                         [r for r in snap if r[8] == 'CLOSED'])

    def test_signal_on_last_bar_stays_pending_without_price_then_confirms(self):
        tail = [60.0 + 2 * k for k in range(0)]  # 상승 40봉 뒤 급락 종가 하나
        daily = rising_then([121, 123, 125, 127, 129, 131, 108])
        scan_date = daily[39]['date']
        seed_candidate(self.conn, scan_date, base=daily[39]['close'])
        daily[40]['open'] = daily[39]['close']
        cg.paper_enter(self.conn, lambda c: daily, '2026-03-01')
        cg.paper_settle(self.conn, lambda c: daily, '2026-03-01')
        row = self.conn.execute("SELECT status, exit_date, exit_price, ret, signal_date, exit_reason, stop_price, trail_price FROM paper_trades WHERE variant='atr_close'").fetchone()
        self.assertEqual(row[0], 'PENDING_EXIT')
        self.assertIsNone(row[1])
        self.assertIsNone(row[2])
        self.assertIsNone(row[3])          # 체결 전에는 수익률을 만들지 않는다
        self.assertEqual(row[4], daily[-1]['date'])
        self.assertIsNotNone(row[6])       # 손절선(초기 추적선)은 기록된다
        # 다음 거래일 봉이 나오면 그 시가로 확정
        nxt = {'date': (datetime.strptime(daily[-1]['date'], '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d'), 'open': 107.0, 'high': 109.0, 'low': 104.0, 'close': 105.0}
        daily2 = daily + [nxt]
        cg.paper_settle(self.conn, lambda c: daily2, '2026-03-02')
        row = self.conn.execute("SELECT status, exit_date, exit_price, ret, exit_reason, hold_days FROM paper_trades WHERE variant='atr_close'").fetchone()
        self.assertEqual(row[0], 'CLOSED')
        self.assertEqual(row[1], nxt['date'])
        self.assertAlmostEqual(row[2], 107.0 * (1 - pe.EXIT_SLIP))
        self.assertEqual(row[4], 'SIGNAL_ATR_CLOSE')
        self.assertIsNotNone(row[3])

    def test_missing_daily_data_stays_unconfirmed_with_note(self):
        seed_candidate(self.conn, '2026-02-10')
        self.conn.execute("UPDATE candidates SET status='PAPER_ENTERED'")
        cg.ensure_variant_rows(self.conn, '2026-02-12')
        self.assertEqual(cg.paper_settle(self.conn, lambda c: [], '2026-02-12'), 0)
        rows = self.conn.execute('SELECT status, note FROM paper_trades').fetchall()
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r[0] == 'OPEN' and '데이터 부족' in r[1] for r in rows))

    def test_existing_database_is_migrated_without_losing_rows(self):
        path = os.path.join(self.tmp, 'old.db')
        old = sqlite3.connect(path)
        old.executescript("""
CREATE TABLE candidates (scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL, name TEXT, score REAL, base_price REAL, scanned_at TEXT NOT NULL,
  created_at TEXT NOT NULL, strategy_status TEXT NOT NULL DEFAULT 'RESEARCH', live_eligible INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'NEW', reason TEXT,
  PRIMARY KEY (scan_date, scanner, code));
CREATE TABLE paper_trades (scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL, variant TEXT NOT NULL, entry_date TEXT, entry_price REAL, exit_date TEXT,
  ret REAL, status TEXT NOT NULL, reason TEXT, updated_at TEXT, PRIMARY KEY (scan_date, scanner, code, variant));
INSERT INTO candidates VALUES ('2026-10-12','pullback','000100','A',90,10000,'x','x','RESEARCH',0,'PAPER_ENTERED',NULL);
INSERT INTO paper_trades VALUES ('2026-10-12','pullback','000100','trail_atr','2026-10-13',10020.0,'2026-10-20',0.034,'CLOSED',NULL,'x');
""")
        old.commit()
        old.close()
        conn = cg.connect(path)                      # 마이그레이션 + 재실행 안전
        conn.close()
        conn = cg.connect(path)
        try:
            self.assertEqual(cg.ensure_variant_rows(conn, '2026-10-21'), 2)    # 새 전략 2개만 보충
            self.assertEqual(cg.ensure_variant_rows(conn, '2026-10-21'), 0)    # 중복 없음
            row = conn.execute("SELECT status, ret, exit_date FROM paper_trades WHERE variant='trail_atr'").fetchone()
            self.assertEqual(row, ('CLOSED', 0.034, '2026-10-20'))               # 기존 기록 보존
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM paper_trades').fetchone()[0], 3)
            cols = {r[1] for r in conn.execute('PRAGMA table_info(paper_trades)')}
            for c in ('stop_price', 'exit_price', 'exit_reason', 'signal_date', 'hold_days', 'gross_ret', 'max_hold'):
                self.assertIn(c, cols)
        finally:
            conn.close()

    def test_independent_accounts_per_variant_are_not_combined(self):
        for k, code in enumerate(['000100', '000101']):
            seed_candidate(self.conn, '2026-10-12', code=code, score=90 - k)
        self.conn.execute("UPDATE candidates SET status='PAPER_ENTERED'")
        cg.ensure_variant_rows(self.conn, '2026-10-30')
        results = {'trail_atr': (0.10, -0.02), 'atr_close': (0.20, 0.05), 'dead35': (-0.03, -0.04)}
        for variant, (r1, r2) in results.items():
            for code, ret in zip(['000100', '000101'], (r1, r2)):
                self.conn.execute("UPDATE paper_trades SET status='CLOSED', entry_date='2026-10-13', entry_price=100.0, exit_date='2026-10-20', ret=?, exit_reason='SIGNAL_DEAD35' WHERE variant=? AND code=?", (ret, variant, code))
        for code in ('000100', '000101'):      # 종가 평가용 일봉(가격 변동 없음 -> 미실현 손익 0, 청산일에 실현)
            for day in range(13, 21):
                self.conn.execute('INSERT OR IGNORE INTO paper_bars(code, date, open, high, low, close) VALUES (?,?,?,?,?,?)', (code, '2026-10-%02d' % day, 100, 101, 99, 100))
        self.conn.commit()
        acct = cg.paper_portfolios(self.conn)
        self.assertEqual(set(acct), {'trail_atr', 'atr_close', 'dead35'})
        self.assertAlmostEqual(acct['atr_close']['cumRet'], 0.10 * 0.20 + 0.10 * 0.05, places=6)   # 종목당 10%씩, 전략별로 따로 계산
        self.assertAlmostEqual(acct['dead35']['cumRet'], 0.10 * -0.03 + 0.10 * -0.04, places=6)
        self.assertNotAlmostEqual(acct['trail_atr']['cumRet'], acct['atr_close']['cumRet'])
        self.assertEqual(acct['atr_close']['closed'], 2)
        self.assertEqual(acct['atr_close']['maxHold'], 150)
        self.assertEqual(acct['trail_atr']['maxHold'], 30)
        self.assertNotIn('ALL', acct)

    def test_todays_unfinished_bar_is_not_used_before_the_close(self):
        # 14:00 에는 오늘 봉(진행 중)을 확정 봉으로 쓰지 않는다 -> 오늘 봉만 있는 상태에서는 진입도 하지 않는다
        now = datetime(2026, 10, 13, 14, 0, tzinfo=KST)
        self.assertEqual(rj.confirmed_cutoff(now), '2026-10-12')
        self.assertEqual(rj.confirmed_cutoff(datetime(2026, 10, 13, 20, 30, tzinfo=KST)), '2026-10-13')
        daily = walk(9, n=70)
        scan_idx = 60
        seed_candidate(self.conn, daily[scan_idx]['date'], base=daily[scan_idx]['close'])
        daily[scan_idx + 1]['open'] = daily[scan_idx]['close']
        cutoff = daily[scan_idx]['date']          # 확정 봉은 스캔일까지
        confirmed = lambda c: [b for b in daily if b['date'] <= cutoff]
        self.assertEqual(cg.paper_enter(self.conn, confirmed, '2026-12-31'), 0)   # 다음 거래일 봉이 확정되기 전에는 진입하지 않음
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM paper_trades').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
