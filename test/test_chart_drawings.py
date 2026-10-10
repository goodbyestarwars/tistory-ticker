# -*- coding: utf-8 -*-
import os
import sqlite3
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))

import chart_drawings as cd
import db_schema


def pt(price=100.0, time='2026-10-01', logical=10):
    return {'time': time, 'price': price, 'logical': logical, 'anchorTime': '2026-10-08', 'logicalOffset': -5}


def sample():
    return {
        'lines': [{'start': pt(), 'end': pt(120)}],
        'circles': [{'start': pt(), 'end': pt(130)}],
        'boxes': [{'start': pt(), 'end': pt(90), 'label': '상승 파동'}],
        'hlines': [{'price': 123.5}],
        'paths': [[pt(1), pt(2), pt(3)]],
    }


class NormalizeTests(unittest.TestCase):
    def test_roundtrip_and_label_cut(self):
        d = sample()
        d['boxes'][0]['label'] = 'x' * 50
        out = cd.normalize_drawings(d)
        self.assertEqual(len(out['boxes'][0]['label']), cd.MAX_LABEL)
        self.assertEqual(out['hlines'], [{'price': 123.5}])

    def test_rejects_bad_input(self):
        for bad in ({'lines': 'x'}, {'hlines': [{'price': -1}]}, {'hlines': [{'price': float('nan')}]},
                    {'lines': [{'start': pt(), 'end': {'price': 1}}]}, {'paths': [[pt()] * (cd.MAX_PATH_POINTS + 1)]},
                    {'boxes': [{'start': pt(), 'end': pt()}] * (cd.MAX_PER_KIND['boxes'] + 1)}):
            with self.assertRaises(cd.ChartDrawingsError):
                cd.normalize_drawings(bad)

    def test_size_cap(self):
        big = {'paths': [[pt(i, time='2026-10-01') for i in range(cd.MAX_PATH_POINTS)] for _ in range(60)]}
        with self.assertRaises(cd.ChartDrawingsError):
            cd.normalize_drawings(big)

    def test_code_and_timeframe(self):
        self.assertEqual(cd.normalize_code('aapl'), 'AAPL')
        self.assertEqual(cd.normalize_timeframe('Week'), 'week')
        for bad in ('', 'a b', 'x' * 21, '../x'):
            with self.assertRaises(cd.ChartDrawingsError):
                cd.normalize_code(bad)
        with self.assertRaises(cd.ChartDrawingsError):
            cd.normalize_timeframe('minute')

    def test_unknown_keys_dropped(self):
        d = sample()
        d['evil'] = 'x'
        d['lines'][0]['start']['extra'] = 'y'
        out = cd.normalize_drawings(d)
        self.assertNotIn('evil', out)
        self.assertNotIn('extra', out['lines'][0]['start'])


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.isolation_level = None
        self.conn.execute('PRAGMA foreign_keys=ON')
        self.conn.executescript(db_schema.SCHEMA)
        self.conn.execute("INSERT INTO app_users (id, google_sub, email, name, picture, created_at, last_login_at) VALUES (1,'s','e','n','p','t','t')"
                          ) if False else None
        cols = [r[1] for r in self.conn.execute('PRAGMA table_info(app_users)')]
        values = {c: ('1' if c == 'id' else 'x') for c in cols}
        values['id'] = 1
        self.conn.execute('INSERT INTO app_users (%s) VALUES (%s)' % (','.join(cols), ','.join('?' * len(cols))), [values[c] for c in cols])

    def test_save_load_conflict_delete_limit(self):
        d = cd.normalize_drawings(sample())
        self.assertEqual(db_schema.load_user_chart_drawings(self.conn, 1, '005930', 'day')['revision'], 0)
        saved = db_schema.save_user_chart_drawings(self.conn, 1, '005930', 'day', d, 't1', expected_revision=0)
        self.assertEqual(saved['revision'], 1)
        loaded = db_schema.load_user_chart_drawings(self.conn, 1, '005930', 'day')
        self.assertEqual(loaded['drawings']['hlines'], [{'price': 123.5}])
        # 다른 봉 주기는 별도 행
        self.assertIsNone(db_schema.load_user_chart_drawings(self.conn, 1, '005930', 'week')['drawings'])
        with self.assertRaises(RuntimeError):
            db_schema.save_user_chart_drawings(self.conn, 1, '005930', 'day', d, 't2', expected_revision=0)
        again = db_schema.save_user_chart_drawings(self.conn, 1, '005930', 'day', d, 't2', expected_revision=1)
        self.assertEqual(again['revision'], 2)
        # 비우면 행 삭제
        db_schema.save_user_chart_drawings(self.conn, 1, '005930', 'day', cd.normalize_drawings({}), 't3', expected_revision=2, delete_if_empty=True)
        self.assertEqual(db_schema.load_user_chart_drawings(self.conn, 1, '005930', 'day')['revision'], 0)
        # 행 수 상한
        for i in range(3):
            db_schema.save_user_chart_drawings(self.conn, 1, 'C%d' % i, 'day', d, 't', max_rows=3)
        with self.assertRaises(RuntimeError):
            db_schema.save_user_chart_drawings(self.conn, 1, 'NEW', 'day', d, 't', max_rows=3)
        # 기존 행 갱신은 상한과 무관
        db_schema.save_user_chart_drawings(self.conn, 1, 'C0', 'day', d, 't', max_rows=3)


if __name__ == '__main__':
    unittest.main()
