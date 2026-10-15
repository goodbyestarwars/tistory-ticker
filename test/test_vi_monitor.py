# -*- coding: utf-8 -*-
"""시장 변동성 모니터 - VI 당일 이력 저장소·실시간 H0STVIC0 파싱·요약 표시 테스트 (2026-10-15). 합성 데이터만 사용(실발동 수신 검증은 운영에서 별도)."""
import json
import os
import subprocess
import sys
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import circuit_breaker as cb  # noqa: E402
import vi_kis  # noqa: E402
import vi_store  # noqa: E402

KST = timezone(timedelta(hours=9))
NOW = datetime(2026, 10, 15, 10, 30, 0, tzinfo=KST)


def rec(code='123456', trig=(10, 29, 0), rel=None, **kw):
    base = {'code': code, 'name': '테스트', 'triggered_at': datetime(2026, 10, 15, *trig, tzinfo=KST),
            'released_at': datetime(2026, 10, 15, *rel, tzinfo=KST) if rel else None}
    base.update(kw)
    return base


def ws_frame(code='123456', cancel='000000', trig='102900', n=1):
    vals = ['20261015', code, '테스트', 'J', 'Y', cancel, trig, '1', '10000', '11000', '-9.09', '0', '0', '2', 'N']
    return '0|H0STVIC0|%03d|' % n + '^'.join(vals * n)


class StoreTests(unittest.TestCase):
    def setUp(self):
        vi_store._store.update({'date': None, 'records': {}, 'markets': {}, 'ws_events': 0, 'rest_events': 0})

    def test_rest_and_websocket_events_merge_into_one_record(self):
        self.assertTrue(vi_store.merge(rec(price=10000.0), 'REST', NOW))
        self.assertFalse(vi_store.merge(rec(static_price=11000.0, static_dprt=-9.09), 'WS', NOW))      # 같은 (코드, 발동시각) - 중복 제거, 필드만 채움
        rows, counts = vi_store.snapshot(NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['sources'], rows[0]['static_price'], rows[0]['price']), (['REST', 'WS'], 11000.0, 10000.0))
        self.assertEqual(counts, {'ws': 1, 'rest': 1})

    def test_same_stock_triggering_again_is_a_separate_event_and_release_is_filled(self):
        vi_store.merge(rec(trig=(9, 10, 0)), 'REST', NOW)
        vi_store.merge(rec(trig=(9, 10, 0), rel=(9, 12, 0)), 'WS', NOW)
        vi_store.merge(rec(trig=(10, 29, 0), count=2), 'REST', NOW)
        rows, _ = vi_store.snapshot(NOW)
        self.assertEqual([(r['triggered_at'][11:19], r['status']) for r in rows], [('10:29:00', 'active'), ('09:10:00', 'released')])   # 발동 중 우선

    def test_missing_release_does_not_stay_active_forever(self):
        vi_store.merge(rec(trig=(10, 0, 0)), 'REST', NOW)
        rows, _ = vi_store.snapshot(NOW)
        self.assertEqual(rows[0]['status'], 'unknown')                                                   # 30분 넘게 해제 미수신 -> 확인 불가

    def test_stale_feed_never_shows_old_active_as_current(self):
        vi_store.merge(rec(), 'REST', NOW)
        rows, _ = vi_store.snapshot(NOW, fresh=False)
        self.assertEqual(rows[0]['status'], 'unknown')

    def test_static_dynamic_kind_comes_from_reference_prices_only(self):
        self.assertEqual(vi_store.kind_from_prices({'static_price': 7755.0, 'dyn_price': 0.0}), 'STATIC')
        self.assertEqual(vi_store.kind_from_prices({'static_price': 0.0, 'dyn_price': 1588.0}), 'DYNAMIC')
        self.assertEqual(vi_store.kind_from_prices({'static_price': 1.0, 'dyn_price': 1.0}), 'BOTH')
        self.assertIsNone(vi_store.kind_from_prices({}))

    def test_history_is_bounded_and_resets_on_a_new_day(self):
        for i in range(vi_store.MAX_RECORDS + 20):
            vi_store.merge(rec(code='%06d' % i, rel=(10, 0, 0)), 'REST', NOW)
        self.assertLessEqual(len(vi_store._store['records']), vi_store.MAX_RECORDS)
        vi_store.merge(rec(), 'REST', NOW + timedelta(days=1))
        self.assertEqual(len(vi_store._store['records']), 1)


class PersistTests(unittest.TestCase):
    def test_history_survives_restart(self):
        import tempfile
        vi_store.STORE_FILE = os.path.join(tempfile.mkdtemp(), 'vi.json')
        vi_store._store.update({'date': None, 'records': {}, 'markets': {}, 'ws_events': 0, 'rest_events': 0})
        vi_store.merge(rec(rel=(10, 0, 0), price=100.0), 'REST', NOW)
        vi_store.save()
        vi_store._store.update({'date': None, 'records': {}})
        self.assertEqual(vi_store.load(NOW), 1)
        rows, _ = vi_store.snapshot(NOW)
        self.assertEqual((len(rows), rows[0]['status'], rows[0]['price']), (1, 'released', 100.0))


class WsParseTests(unittest.TestCase):
    def setUp(self):
        vi_store._store.update({'date': None, 'records': {}, 'markets': {}, 'ws_events': 0, 'rest_events': 0})
        vi_kis._state.update({'frames': 0, 'raw': [], 'lastFrameAt': None})

    def test_fifteen_fields_in_official_order(self):
        (r,) = vi_kis.parse_records(ws_frame())
        self.assertEqual((r['code'], r['kind_code'], r['price'], r['static_price'], r['static_dprt'], r['count'], r['etp']), ('123456', '1', '10000', '11000', '-9.09', '2', 'N'))
        self.assertEqual(len(vi_kis.FIELDS), 15)

    def test_multiple_records_and_foreign_frames(self):
        self.assertEqual(len(vi_kis.parse_records(ws_frame(n=2))), 2)
        self.assertEqual(vi_kis.parse_records('0|H0STCNT0|001|a^b'), [])
        self.assertEqual(vi_kis.parse_records('{"header":{}}'), [])
        self.assertEqual(vi_kis.parse_records('0|H0STVIC0|001|a^b^c'), [])

    def test_frame_reaches_store_and_duplicate_with_rest_is_one_row(self):
        vi_store.merge(rec(), 'REST', NOW)
        self.assertEqual(vi_kis.handle_raw(ws_frame(), NOW), 1)
        self.assertEqual(vi_kis.handle_raw(ws_frame(cancel='103000'), NOW), 1)                         # 해제 프레임
        rows, counts = vi_store.snapshot(NOW)
        self.assertEqual((len(rows), rows[0]['status'], counts['ws']), (1, 'released', 2))

    def test_unverified_kind_code_is_not_interpreted(self):
        self.assertEqual(vi_store.KIND_LABELS, {})
        vi_kis.handle_raw(ws_frame(), NOW)
        rows, _ = vi_store.snapshot(NOW)
        self.assertEqual((rows[0]['kind_code'], rows[0]['kind']), ('1', 'STATIC'))                       # 종류는 코드가 아니라 기준가격(정적 기준가만 존재)으로 판정


class PayloadTests(unittest.TestCase):
    def setUp(self):
        vi_store._store.update({'date': None, 'records': {}, 'markets': {}, 'ws_events': 0, 'rest_events': 0})

    def test_existing_keys_kept_and_new_fields_added(self):
        cb._state.update({'date': NOW.strftime('%Y%m%d'), 'rows': [], 'fetchedAt': NOW.isoformat(timespec='seconds'), 'error': None})
        payload = cb.get_payload(NOW)
        for key in ('sidecar', 'vi_active_count', 'vi_list', 'fetchedAt', 'error', 'market_halt'):
            self.assertIn(key, payload)
        for key in ('vi_available', 'vi_today', 'vi_basis'):
            self.assertIn(key, payload)

    def test_stale_rest_hides_counts(self):
        cb._state.update({'date': NOW.strftime('%Y%m%d'), 'rows': [], 'fetchedAt': (NOW - timedelta(minutes=10)).isoformat(timespec='seconds'), 'error': None})
        payload = cb.get_payload(NOW)
        self.assertFalse(payload['vi_available'])
        self.assertIsNone(payload['vi_active_count'])
        self.assertEqual(payload['vi_list'], [])


NODE = r'''
const fs = require('fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
const a = src.indexOf('// ---- 시장 변동성 모니터');
const b = src.indexOf('function chip(', a);
const pre = "var MARKET_LABEL={KOSPI:'코스피',KOSDAQ:'코스닥'};function haltTitle(e){return (MARKET_LABEL[e.market]||'')+' 사이드카';}" +
  "function hhmm(i){return String(i).slice(11,16);}function hhmmss(i){return i?String(i).slice(11,19):'-';}function esc(s){return String(s==null?'':s);}var viView={mode:'active',market:'ALL',kind:'ALL'};";
const f = new Function(pre + src.slice(a, b) + 'return {haltSummary,viSummary,latestLine,viPanelHtml,viView};');
const api = f();
const data = JSON.parse(process.argv[2]);
const out = {summary: api.haltSummary(data.market_halt), vi: api.viSummary(data), latest: api.latestLine(data)};
out.panelActive = api.viPanelHtml(data);
api.viView.mode = 'today'; out.panelToday = api.viPanelHtml(data);
api.viView.market = 'KOSDAQ'; api.viView.kind = 'DYNAMIC'; out.panelFiltered = api.viPanelHtml(data);
console.log(JSON.stringify(out));
'''


def render(data):
    out = subprocess.run(['node', '-e', NODE, os.path.join(ROOT, 'js', 'skin-main.js'), json.dumps(data)], capture_output=True, text=True, encoding='utf-8')
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def vi_row(code, market, kind, status, trig='2026-10-15T10:29:00+09:00'):
    return {'code': code, 'name': '종목' + code, 'market': market, 'status': status, 'triggered_at': trig, 'released_at': None if status != 'released' else '2026-10-15T10:31:00+09:00',
            'kind': kind, 'price': 1490.0, 'static_price': 7755.0 if kind == 'STATIC' else 0, 'static_dprt': -10.19 if kind == 'STATIC' else 0,
            'dyn_price': 1588.0 if kind == 'DYNAMIC' else 0, 'dyn_dprt': -6.17 if kind == 'DYNAMIC' else 0, 'count': 3}


class FrontendTests(unittest.TestCase):
    def test_cb_and_sidecar_active_at_once_and_many_vi_rows(self):
        halt = {'available': True, 'events': [
            {'id': 'a', 'market': 'KOSPI', 'kind': 'CIRCUIT_BREAKER', 'stage': None, 'status': 'active', 'triggered_at': '2026-10-15T10:20:00+09:00'},
            {'id': 'b', 'market': 'KOSDAQ', 'kind': 'SIDECAR', 'direction': 'SELL', 'status': 'active', 'triggered_at': '2026-10-15T10:25:00+09:00'}]}
        data = {'market_halt': halt, 'vi_available': True, 'vi_active_count': 1,
                'vi_today': [vi_row('111111', 'KOSDAQ', 'DYNAMIC', 'active'), vi_row('222222', 'KOSPI', 'STATIC', 'released')]}
        r = render(data)
        self.assertEqual((r['summary']['cb']['tone'], r['summary']['side']['tone']), ('cb', 'side'))
        self.assertIn('매도', r['summary']['side']['text'])
        self.assertEqual((r['vi']['text'], r['vi']['tone']), ('발동 1건', 'vi'))
        self.assertIn('종목111111', r['panelActive'])
        self.assertNotIn('종목222222', r['panelActive'])                         # 발동 중 탭에는 해제 건 없음
        self.assertIn('종목222222', r['panelToday'])
        self.assertIn('동적 VI', r['panelToday'])
        self.assertIn('/page/stock-search?code=111111', r['panelToday'])
        self.assertIn('종목111111', r['panelFiltered'])
        self.assertNotIn('종목222222', r['panelFiltered'])                       # 코스닥·동적 필터

    def test_no_events_is_calm_and_unavailable_is_unknown(self):
        r = render({'market_halt': {'available': True, 'events': []}, 'vi_available': True, 'vi_active_count': 0, 'vi_today': []})
        self.assertEqual((r['summary']['cb']['tone'], r['vi']['text'], r['latest']), ('calm', '없음', ''))
        self.assertIn('지금 발동 중인 VI가 없습니다', r['panelActive'])
        r = render({'market_halt': {'available': False, 'events': []}, 'vi_available': False, 'vi_active_count': None, 'vi_today': []})
        self.assertEqual((r['summary']['cb']['text'], r['vi']['text']), ('확인 불가', '확인 불가'))
        self.assertIn('정상이라는 뜻이 아니며', r['panelActive'])

    def test_missing_values_show_dash(self):
        row = vi_row('333333', 'KOSDAQ', None, 'active')
        row.update(price=None, count=None)
        r = render({'market_halt': {'available': True, 'events': []}, 'vi_available': True, 'vi_active_count': 1, 'vi_today': [row]})
        self.assertIn('VI 종류 확인 불가', r['panelActive'])
        self.assertIn('발동가 -', r['panelActive'])
        self.assertIn('오늘 -회', r['panelActive'])


if __name__ == '__main__':
    unittest.main()
