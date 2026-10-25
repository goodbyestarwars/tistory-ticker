import copy
import ast
from datetime import date, timedelta
import pathlib
import sqlite3
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import db_schema
import invest_signal
import kiwoom_market as market
from scan_inputs import ScanInputs

BASIS = '2026-10-23'


def fixture():
    return [{'date': (date(2026, 10, 23)-timedelta(days=i)).isoformat(),
             'close': 100+i, 'change_pct': 1., 'ind_net': -30., 'foreign_net': 10., 'inst_net': 20.}
            for i in range(25)]


class ScanFlowTest(unittest.TestCase):
    def test_partial_scan_response_does_not_overwrite_previous_kis_cache(self):
        rows = fixture()
        rows[0]['change_pct'] = None
        with patch.object(market, '_daily_rows_from_kis', return_value=rows), \
             patch.object(market.db_schema, 'get_conn'), \
             patch.object(market.db_schema, 'upsert_kis_flow_cache') as save, \
             patch.object(market.db_schema, 'load_kis_flow_cache', return_value=(None, None)):
            with self.assertRaisesRegex(RuntimeError, 'incomplete'):
                market._daily_rows_from_kis_with_fallback_cache('k', 's', '005930', '20261023', lambda: {}, 25, evidence={})
        save.assert_not_called()

    def test_real_kis_mapping_keeps_missing_quantity_and_uses_same_units(self):
        raw = {'stck_bsop_date': '20261023', 'stck_clpr': '100', 'prdy_ctrt': '1.2',
               'acml_vol': '10000', 'orgn_ntby_qty': '-200', 'frgn_reg_ntby_qty': '300', 'prsn_ntby_qty': ''}
        with patch.object(market.kis_client, 'get_token', return_value='t'), \
             patch.object(market.kis_client, 'fetch_investor_trade_daily', return_value=(None, [raw])):
            result = market._daily_rows_from_kis('k', 's', '005930', '20261023', lambda: {}, 1, strict=True)
        self.assertEqual(result[0]['foreign_net'], 300)
        self.assertEqual(result[0]['inst_net'], -200)
        self.assertEqual(result[0]['volume'], 10000)
        self.assertIsNone(result[0]['ind_net'])

    def test_kis_path_preserves_signal_fields_without_two_supplemental_trs(self):
        rows = fixture()
        def kis(*args, **kwargs):
            self.assertEqual(args[4](), {})
            kwargs['evidence'].update(source='kis-un', cached=False)
            return copy.deepcopy(rows)
        with patch.object(market, '_daily_rows_from_kis_with_fallback_cache', side_effect=kis), \
             patch.object(market, '_fetch_ka10059_rows') as live, \
             patch.object(market.kiwoom_client, 'call_tr') as holdings:
            result, evidence = market.fetch_confirmed_scan_flow('token', '005930', BASIS, 'key', 'secret')
        self.assertEqual(invest_signal.build_flow(result), invest_signal.build_flow(rows))
        self.assertEqual(evidence['source'], 'kis-un')
        live.assert_not_called()
        holdings.assert_not_called()

    def test_fallback_is_explicit_and_missing_individual_is_not_zero(self):
        rows = fixture()
        with patch.object(market, '_daily_rows_from_kis_with_fallback_cache', side_effect=RuntimeError), \
             patch.object(market, '_fetch_ka10059_rows', return_value=[]) as k59, \
             patch.object(market, '_daily_rows_from_kiwoom', return_value=rows) as fallback:
            result, evidence = market.fetch_confirmed_scan_flow('t', '005930', BASIS, 'k', 's')
        self.assertEqual(evidence['source'], 'kiwoom-krx-fallback')
        self.assertIsNone(result[0]['ind_net'])
        self.assertEqual(fallback.call_args.args[4], {})
        k59.assert_called_once()

    def test_old_and_new_consumer_outputs_match_with_two_fewer_supplemental_calls(self):
        with patch.object(market, '_daily_rows_from_kis_with_fallback_cache', side_effect=lambda *a, **k: [dict(r, foreign_shares=None, foreign_ratio=None) for r in fixture()]), \
             patch.object(market, '_fetch_ka10059_rows', return_value=[]) as k59, \
             patch.object(market.kiwoom_client, 'call_tr', return_value={}) as k08:
            old = market.fetch_foreign_inst_daily('t', '005930', 'k', 's', 25)
            before = k59.call_count + k08.call_count
            current, _ = market.fetch_confirmed_scan_flow('t', '005930', BASIS, 'k', 's')
            after = k59.call_count + k08.call_count - before
        self.assertEqual(invest_signal.build_flow(old), invest_signal.build_flow(current))
        self.assertEqual((before, after), (2, 0))


class AcquisitionTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        db_schema.create_schema(self.conn)
        self.timings = {k: 0. for k in ('dbRead', 'flowApi', 'ohlcApi', 'flowSave', 'ohlcSave', 'throttle')}
        def save(conn, code, rows):
            conn.executemany('INSERT OR REPLACE INTO daily_prices VALUES (?,?,?,?,?,?,?)',
                             [(code, r['date'], r['open'], r['high'], r['low'], r['close'], r['volume']) for r in rows])
        self.inputs = ScanInputs(self.conn, BASIS, 't', 'k', 's', self.timings, save, 0)

    def tearDown(self):
        self.conn.close()

    def test_same_day_rerun_uses_db_and_new_stock_fetches_once(self):
        with patch.object(market, 'fetch_confirmed_scan_flow', return_value=(fixture(), {'source': 'kis-un'})) as fetch:
            first = self.inputs.read('005930', 'flow')
            second = self.inputs.read('005930', 'flow')
        self.assertEqual(first, second)
        fetch.assert_called_once()
        self.assertEqual(self.inputs.counts['flow']['dbReuse'], 1)

    def test_stale_failure_preserves_existing_rows_and_never_returns_them_as_today(self):
        old = fixture()
        for row in old:
            row['date'] = (date.fromisoformat(row['date'])-timedelta(days=1)).isoformat()
        db_schema.upsert_investor_flow_daily(self.conn, '005930', old)
        self.conn.commit()
        with patch.object(market, 'fetch_confirmed_scan_flow', return_value=(old, {'source': 'kis-un-cache'})):
            self.assertEqual(self.inputs.read('005930', 'flow'), [])
        self.assertEqual(db_schema.load_investor_flow_daily(self.conn, '005930'), old)
        self.assertEqual(self.inputs.failures[0]['state'], 'stale')

    def test_invalid_partial_and_future_data_cannot_be_saved(self):
        for bad in (None, float('nan'), float('inf')):
            rows = fixture()
            rows[0]['ind_net'] = bad
            with patch.object(market, 'fetch_confirmed_scan_flow', return_value=(rows, {'source': 'kis-un'})):
                self.assertEqual(self.inputs.read('005930', 'flow'), [])
        self.assertEqual(db_schema.load_investor_flow_daily(self.conn, '005930'), [])

    def test_ohlc_failure_does_not_block_flow_and_pacing_is_kept(self):
        with patch.object(market, 'fetch_daily_ohlc', side_effect=RuntimeError('private text')), \
             patch.object(market, 'fetch_confirmed_scan_flow', return_value=(fixture(), {'source': 'kis-un'})), \
             patch('scan_inputs.time.sleep') as sleep:
            self.assertEqual(self.inputs.read('005930', 'ohlc'), [])
            self.assertTrue(self.inputs.read('005930', 'flow'))
        self.assertEqual(sleep.call_count, 2)
        self.assertNotIn('private text', str(self.inputs.summary()))

    def test_short_ipo_is_retained_without_inventing_history(self):
        with patch.object(market, 'fetch_confirmed_scan_flow', return_value=(fixture()[:2], {'source': 'kis-un'})):
            self.assertEqual(len(self.inputs.read('005930', 'flow')), 2)

    def test_ohlc_upsert_only_writes_new_and_corrected_rows(self):
        # Extract the real save function: daily_scan's Linux fcntl dependency is
        # unrelated to this SQLite write contract on Windows.
        path = pathlib.Path(__file__).resolve().parents[1] / 'scripts/cloud-vm/daily_scan.py'
        node = next(n for n in ast.parse(path.read_text(encoding='utf-8')).body
                    if isinstance(n, ast.FunctionDef) and n.name == 'save_ohlc_snapshot')
        scope = {}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), scope)
        save = scope['save_ohlc_snapshot']
        rows = [{'date': (date(2026, 10, 23)-timedelta(days=i)).isoformat(),
                 'open': 100, 'high': 105, 'low': 95, 'close': 100, 'volume': 1000} for i in range(500)]
        save(self.conn, '005930', rows)
        before = self.conn.total_changes
        save(self.conn, '005930', rows)
        self.assertEqual(self.conn.total_changes-before, 0)
        rows[100]['close'] = 101
        rows = [dict(rows[0], date='2026-10-24')] + rows[:-1]
        save(self.conn, '005930', rows)
        self.assertEqual(self.conn.total_changes-before, 2)


if __name__ == '__main__':
    unittest.main()
