# -*- coding: utf-8 -*-
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import candidate_gen as cg  # noqa: E402

KST = timezone(timedelta(hours=9))


def payload(scanned_at_kst, date, universe=2700, scanned=2650, n=2):
    utc = scanned_at_kst.astimezone(timezone.utc).isoformat()
    items = [{'code': '00%04d' % i, 'name': 'N%d' % i, 'price': 10000 + i, 'score': 80 + i, 'date': date} for i in range(n)]
    return {'scannedAt': utc, 'universe': universe, 'scanned': scanned, 'patterns': {'pullback': items, 'maCloudBreakout': []}}


class GateTests(unittest.TestCase):
    def setUp(self):
        self.conn = cg.connect(':memory:')
        self.scan = datetime(2026, 10, 12, 23, 58, tzinfo=KST)   # 실제 운영처럼 자정 직전에 저장된 스캔
        self.now = datetime(2026, 10, 13, 0, 10, tzinfo=KST)

    def run_gen(self, p, now=None, epoch=1000.0):
        return cg.generate(self.conn, p, now or self.now, now_epoch=epoch)

    def test_ok_after_stable(self):
        p = payload(self.scan, '2026-10-12')
        ok, reason, n = self.run_gen(p, epoch=1000.0)
        self.assertFalse(ok)
        self.assertTrue(reason.startswith('WAIT_STABLE'))
        ok, reason, n = self.run_gen(p, epoch=1000.0 + cg.STABLE_SEC + 1)
        self.assertTrue(ok)
        self.assertEqual(n, 2)
        ok, reason, n = self.run_gen(p, epoch=5000.0)  # 같은 스캔 재실행은 중복 후보를 만들지 않는다
        self.assertEqual(n, 0)
        self.assertEqual(self.conn.execute('SELECT COUNT(*), SUM(live_eligible), MIN(scan_date) FROM candidates').fetchone(), (2, 0, '2026-10-12'))

    def test_fixed_2100_would_be_too_early(self):
        # 21:00에 가져오면 아직 전일 스캔 결과(10-09 데이터, 10-09 23:58 저장)다 -> 오늘 데이터가 아니므로 STALE
        old = payload(datetime(2026, 10, 9, 23, 58, tzinfo=KST), '2026-10-09')
        ok, reason, n = self.run_gen(old, now=datetime(2026, 10, 12, 21, 0, tzinfo=KST), epoch=9999.0)
        self.assertFalse(ok)
        self.assertTrue(reason.startswith('STALE_SCAN'))
        self.assertEqual(n, 0)

    def test_weekend_gap_still_valid_before_monday_open(self):
        fri = payload(datetime(2026, 10, 9, 23, 58, tzinfo=KST), '2026-10-09')
        ok, reason, n = self.run_gen(fri, now=datetime(2026, 10, 12, 8, 30, tzinfo=KST), epoch=1.0)
        self.assertTrue(reason.startswith('WAIT_STABLE'))
        ok, reason, n = self.run_gen(fri, now=datetime(2026, 10, 12, 8, 40, tzinfo=KST), epoch=1.0 + cg.STABLE_SEC + 5)
        self.assertTrue(ok)

    def test_partial_scan_blocked_by_history(self):
        for i, scanned in enumerate((2390, 2380, 2400)):
            self.conn.execute('INSERT INTO scan_seen(scanned_at, first_seen, scanned, ok) VALUES (?,?,?,1)', ('h%d' % i, float(i), scanned))
        ok, reason, n = self.run_gen(payload(self.scan, '2026-10-12', scanned=900), epoch=9999.0)
        self.assertFalse(ok)
        self.assertTrue(reason.startswith('PARTIAL_SCAN'))

    def test_mixed_bar_dates_blocked(self):
        p = payload(self.scan, '2026-10-12', n=4)
        for it in p['patterns']['pullback'][:3]:
            it['date'] = '2026-10-08'
        ok, reason, n = self.run_gen(p, epoch=9999.0)
        self.assertFalse(ok)
        self.assertTrue(reason.startswith('MIXED_BAR_DATES'))

    def test_scan_saved_before_data_close_blocked(self):
        early = datetime(2026, 10, 12, 16, 0, tzinfo=KST)  # 마감 데이터가 아닌 장중 저장물
        ok, reason, n = self.run_gen(payload(early, '2026-10-12'), now=datetime(2026, 10, 12, 16, 30, tzinfo=KST), epoch=9999.0)
        self.assertFalse(ok)
        self.assertTrue(reason.startswith('SCAN_BEFORE_CLOSE_DATA'))


class PaperTests(unittest.TestCase):
    def setUp(self):
        self.conn = cg.connect(':memory:')
        self.conn.execute("INSERT INTO candidates(scan_date, scanner, code, name, score, base_price, scanned_at, created_at) VALUES "
                          "('2026-10-12','pullback','000001','A',80,10000,'x','x'),('2026-10-12','pullback','000002','B',80,10000,'x','x')")
        self.conn.commit()

    @staticmethod
    def bars(code, opens):
        d0 = datetime(2026, 10, 12)
        out = [{'date': (d0 + timedelta(days=k)).strftime('%Y-%m-%d'), 'open': o, 'high': o * 1.01, 'low': o * 0.99, 'close': o} for k, o in enumerate(opens)]
        return out

    def test_gap_skip_and_entry(self):
        data = {'000001': self.bars('000001', [10000, 10100, 10100]), '000002': self.bars('000002', [10000, 10300, 10300])}
        n = cg.paper_enter(self.conn, lambda c: data[c], '2026-10-13')
        self.assertEqual(n, 1)
        st = dict(self.conn.execute('SELECT code, status FROM candidates').fetchall())
        self.assertEqual(st['000001'], 'PAPER_ENTERED')
        self.assertEqual(st['000002'], 'SKIPPED')

    def test_old_candidate_expires_without_entry(self):
        self.assertEqual(cg.expire_old(self.conn, '2026-10-30'), 2)
        self.assertEqual(cg.paper_enter(self.conn, lambda c: [], '2026-10-30'), 0)


class ReasonsTests(unittest.TestCase):
    """스캔 선정 이유(reasons)는 알림·표시용 기록이다: 저장되고, 옛 DB 에는 열만 덧붙으며, 판정(후보 생성 수)은 달라지지 않는다."""

    def test_reasons_saved_without_changing_candidate_set(self):
        conn = cg.connect(':memory:')
        scan = datetime(2026, 10, 12, 23, 58, tzinfo=KST)
        p = payload(scan, '2026-10-12', n=3)
        p['patterns']['pullback'][0]['reasons'] = ['5일선 지지', '거래량 증가']
        p['patterns']['pullback'][1]['reasons'] = []
        now = datetime(2026, 10, 13, 0, 10, tzinfo=KST)
        cg.generate(conn, p, now, now_epoch=1000.0)
        ok, reason, n = cg.generate(conn, p, now, now_epoch=1000.0 + cg.STABLE_SEC + 1)
        self.assertEqual((ok, n), (True, 3))
        rows = dict(conn.execute('SELECT code, reasons FROM candidates').fetchall())
        self.assertEqual(json.loads(rows['000000']), ['5일선 지지', '거래량 증가'])
        self.assertIsNone(rows['000001'])
        self.assertIsNone(rows['000002'])

    def test_old_database_gets_column(self):
        import sqlite3
        import tempfile
        path = os.path.join(tempfile.mkdtemp(), 'old.db')
        old = sqlite3.connect(path)
        old.execute("CREATE TABLE candidates (scan_date TEXT NOT NULL, scanner TEXT NOT NULL, code TEXT NOT NULL, name TEXT, score REAL, base_price REAL, "
                    "scanned_at TEXT NOT NULL, created_at TEXT NOT NULL, strategy_status TEXT NOT NULL DEFAULT 'RESEARCH', live_eligible INTEGER NOT NULL DEFAULT 0, "
                    "status TEXT NOT NULL DEFAULT 'NEW', reason TEXT, PRIMARY KEY (scan_date, scanner, code))")
        old.execute("INSERT INTO candidates(scan_date, scanner, code, name, score, base_price, scanned_at, created_at) VALUES ('2026-10-09','pullback','005930','삼성',90,1,'x','x')")
        old.commit()
        old.close()
        conn = cg.connect(path)
        cols = {r[1] for r in conn.execute('PRAGMA table_info(candidates)')}
        self.assertIn('reasons', cols)
        self.assertEqual(conn.execute('SELECT code, reasons FROM candidates').fetchall(), [('005930', None)])      # 기존 행 보존
        conn.close()


if __name__ == '__main__':
    unittest.main()
