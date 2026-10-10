# -*- coding: utf-8 -*-
"""research_job 테스트: 감시 구간, 10분 간격, 금요일 자정 경계, 늦은 시작(소급 금지), 중복 실행, 용량 상한, 상태 파일."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'local_bot'))
import candidate_gen as cg  # noqa: E402
import research_job as rj  # noqa: E402
from test_candidate_gen import payload  # noqa: E402

KST = timezone(timedelta(hours=9))


def dt(d, h, m=0):
    return datetime(2026, 10, d, h, m, tzinfo=KST)


class JobTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = cg.connect(os.path.join(self.tmp, 'r.db'))

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    @staticmethod
    def clock(start):
        c = {'t': start}
        return c, (lambda: c['t']), (lambda sec: c.update(t=c['t'] + timedelta(seconds=sec)))

    def test_session_mode_windows(self):
        self.assertEqual(rj.session_mode(dt(12, 20, 15)), ('poll', dt(13, 8, 15)))
        self.assertEqual(rj.session_mode(dt(12, 20, 14))[0], 'once')                 # 20:15 이전
        self.assertEqual(rj.session_mode(dt(16, 20, 15)), ('poll', dt(17, 8, 15)))   # 금 밤 -> 토 08:15
        self.assertEqual(rj.session_mode(dt(17, 1, 0)), ('poll', dt(17, 8, 15)))     # 금요일 스캔의 자정 이후 처리 허용
        self.assertEqual(rj.session_mode(dt(17, 21, 0))[0], 'once')                  # 토 저녁: 새 거래일 스캔을 기다리지 않음
        self.assertEqual(rj.session_mode(dt(18, 3, 0))[0], 'once')                   # 일 새벽
        self.assertEqual(rj.session_mode(dt(18, 21, 0))[0], 'once')                  # 일 저녁
        self.assertEqual(rj.session_mode(dt(13, 14, 0))[0], 'once')                  # 놓친 실행을 낮에 늦게 시작

    def test_next_start_skips_weekend(self):
        self.assertEqual(rj.next_start(dt(16, 21, 0)), dt(19, 20, 15))
        self.assertEqual(rj.next_start(dt(12, 9, 0)), dt(12, 20, 15))

    def test_polls_every_10_minutes_until_scan_confirmed_then_no_duplicate(self):
        c, now_fn, sleep = self.clock(dt(12, 20, 15))
        old = payload(dt(9, 23, 58), '2026-10-09')
        new = payload(dt(12, 23, 58), '2026-10-12')
        times = []

        def fetch():
            times.append(c['t'])
            return new if c['t'] >= dt(12, 23, 59) else old

        res = rj.run_cycle(self.conn, fetch, lambda x: [], now_fn, sleep, out_dir=self.tmp)
        self.assertEqual(res, ('OK', 2))
        self.assertTrue(all((b - a).total_seconds() == 600 for a, b in zip(times, times[1:])))
        self.assertLess(c['t'], dt(13, 8, 15))
        st = rj.load_status(self.tmp)
        self.assertEqual(st['runner'], 'done')
        self.assertEqual(st['candidatesToday'], 2)
        self.assertIn('lastSuccessAt', st)
        self.assertEqual(st['nextRunAt'][:13], '2026-10-13T20')
        # 같은 스캔 결과로 다시 실행해도 후보가 늘지 않는다
        c['t'] = dt(13, 0, 30)
        self.assertEqual(rj.run_cycle(self.conn, lambda: new, lambda x: [], now_fn, sleep, out_dir=self.tmp), ('OK', 0))
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM candidates').fetchone()[0], 2)

    def test_friday_scan_finishing_after_midnight_is_processed_saturday(self):
        c, now_fn, sleep = self.clock(dt(16, 20, 15))
        fri = payload(dt(17, 0, 20), '2026-10-16')   # 금요일 데이터, 토요일 00:20 저장
        stale = payload(dt(15, 23, 58), '2026-10-15')
        res = rj.run_cycle(self.conn, lambda: fri if c['t'] >= dt(17, 0, 21) else stale, lambda x: [], now_fn, sleep, out_dir=self.tmp)
        self.assertEqual(res[0], 'OK')
        self.assertEqual(self.conn.execute('SELECT MIN(scan_date) FROM candidates').fetchone()[0], '2026-10-16')
        self.assertEqual(c['t'].day, 17)

    def test_gives_up_at_0815_without_candidates(self):
        c, now_fn, sleep = self.clock(dt(12, 20, 15))
        old = payload(dt(9, 23, 58), '2026-10-09')
        res = rj.run_cycle(self.conn, lambda: old, lambda x: [], now_fn, sleep, out_dir=self.tmp)
        self.assertNotEqual(res[0], 'OK')
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM candidates').fetchone()[0], 0)
        self.assertGreaterEqual(c['t'], dt(13, 8, 15))
        self.assertEqual(rj.load_status(self.tmp)['runner'], 'no_scan')

    def test_late_start_checks_once_and_never_backfills(self):
        c, now_fn, sleep = self.clock(dt(13, 14, 0))   # PC가 꺼져 있다가 낮에 켜짐(월요일 밤 실행을 놓침)
        mon = payload(dt(12, 23, 58), '2026-10-12')
        calls = {'n': 0}

        def fetch():
            calls['n'] += 1
            return mon

        res = rj.run_cycle(self.conn, fetch, lambda x: [], now_fn, sleep, out_dir=self.tmp)
        self.assertEqual(calls['n'], 1)
        self.assertTrue(res[0].startswith('STALE_SCAN'))
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM candidates').fetchone()[0], 0)

    def test_disk_limit_blocks_generation(self):
        c, now_fn, sleep = self.clock(dt(12, 20, 15))
        new = payload(dt(12, 20, 40), '2026-10-12')
        res = rj.run_cycle(self.conn, lambda: new, lambda x: [], now_fn, sleep, out_dir=self.tmp, disk_ok=lambda: False)
        self.assertEqual(res[0], 'DISK_LIMIT')
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM candidates').fetchone()[0], 0)
        self.assertEqual(rj.load_status(self.tmp)['runner'], 'disk_limit')

    def test_fetch_error_does_not_crash_and_is_reported(self):
        c, now_fn, sleep = self.clock(dt(12, 20, 15))

        def boom():
            raise OSError('network down')

        rj.run_cycle(self.conn, boom, lambda x: [], now_fn, sleep, out_dir=self.tmp, mode='once')
        st = rj.load_status(self.tmp)
        self.assertEqual(st['runner'], 'no_scan')
        self.assertTrue(any('network down' in e for e in st['errors']))

    def test_lock_blocks_duplicate_process_and_recovers_from_dead_pid(self):
        lock = os.path.join(self.tmp, 'x.lock')
        self.assertTrue(rj.acquire_lock(lock))
        self.assertTrue(rj.acquire_lock(lock))   # 같은 프로세스 재진입
        with open(lock, 'w') as f:
            f.write('999999')                     # 존재하지 않는 pid -> 빼앗을 수 있다
        self.assertTrue(rj.acquire_lock(lock))
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
        try:
            with open(lock, 'w') as f:
                f.write(str(child.pid))           # 살아 있는 다른 프로세스가 쥔 잠금 -> 거절
            self.assertFalse(rj.acquire_lock(lock))
        finally:
            child.kill()
            child.wait()

    def test_missing_weekdays_and_dir_size(self):
        self.conn.execute("INSERT INTO gen_log VALUES ('2026-10-06T21:00:00','2026-10-06',1,'OK',3)")
        self.conn.execute("INSERT INTO gen_log VALUES ('2026-10-07T21:00:00','2026-10-07',0,'STALE_SCAN',0)")
        self.conn.commit()
        self.assertEqual(rj.missing_weekdays(self.conn, dt(9, 10, 0)), ['2026-10-07', '2026-10-08'])
        with open(os.path.join(self.tmp, 'a.bin'), 'wb') as f:
            f.write(b'x' * 1000)
        self.assertGreaterEqual(rj.dir_size(self.tmp), 1000)

    def test_status_served_by_local_api_helper(self):
        import server
        self.assertEqual(server.research_status(self.tmp), {'available': False})
        c, now_fn, sleep = self.clock(dt(12, 20, 15))
        rj.run_cycle(self.conn, lambda: payload(dt(12, 23, 58), '2026-10-12'), lambda x: [], now_fn, sleep, out_dir=self.tmp)
        self.conn.commit()
        shutil.copy(os.path.join(self.tmp, 'r.db'), os.path.join(self.tmp, 'research.db'))
        out = server.research_status(self.tmp)
        self.assertTrue(out['available'])
        self.assertEqual(out['candidatesToday'], 2)
        self.assertEqual(len(out['recentCandidates']), 2)
        self.assertNotIn('KIWOOM', str(out))


if __name__ == '__main__':
    unittest.main()
