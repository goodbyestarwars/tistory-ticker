"""On-demand adapter checks: coverage, failure, clocks and bounded concurrency."""
import copy
import os
import sys
import threading
import unittest
from datetime import datetime
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import hour_candidates as checks
from test_hour_candidate_engine import snapshot

NOW = datetime.fromisoformat('2026-10-06T09:05:08+09:00')


def collect(row, *_args):
    value = snapshot()
    value.update(code=row['code'], name=row.get('name', row['code']))
    return value


class ManualCheckTests(unittest.TestCase):
    def setUp(self):
        self.token = mock.patch.object(checks.kis_client, 'get_token', return_value='test-token').start()
        self.record = mock.patch.object(checks, '_record').start()
        self.calendar = mock.patch.object(checks.market_clock, 'is_kr_trading_day', side_effect=lambda dt: dt.weekday() < 5).start()
        self.addCleanup(mock.patch.stopall)
        checks._previous_cache.clear()

    def run_scan(self, **kwargs):
        options = dict(mode='selected', code='111111', key='test-key', secret='test-secret',
                       clock=lambda: NOW, collector=collect)
        options.update(kwargs)
        return checks.scan(**options)

    def test_closed_window_uses_no_live_reads_or_previous_signal(self):
        provider = mock.Mock()
        result = self.run_scan(clock=lambda: NOW.replace(hour=17), collector=provider)
        self.assertEqual(result['state'], 'outside_window')
        self.assertEqual(result['items'], [])
        provider.assert_not_called()
        self.token.assert_not_called()
        self.record.assert_not_called()

    def test_exact_window_boundaries_and_weekend(self):
        for stamp, allowed in [('2026-10-06T09:04:59+09:00', False),
                               ('2026-10-06T09:05:00+09:00', True),
                               ('2026-10-06T09:14:59+09:00', True),
                               ('2026-10-06T09:15:00+09:00', False),
                               ('2026-10-10T09:05:00+09:00', False)]:
            self.assertEqual(checks.in_check_window(datetime.fromisoformat(stamp)), allowed)

    def test_selected_check_has_capture_price_and_no_probability(self):
        result = self.run_scan()
        self.assertEqual(len(result['items']), 1)
        row = result['items'][0]
        self.assertEqual(row['entryPrice'], 10060)
        self.assertGreaterEqual(row['targetPct'], 3)
        self.assertLessEqual(abs(row['stopPct']), 3)
        self.assertIsNone(row['probability'])
        self.assertFalse(result['coverage']['fullMarket'])
        self.assertEqual(result['coverage']['evaluatedCount'], 1)
        self.record.assert_called_once()

    def test_detail_limit_does_not_claim_all_symbols_tested(self):
        rows = [{'code': '%06d' % index, 'name': 'sample'} for index in range(30)]
        result = self.run_scan(mode='ranked', pool_fetcher=lambda *_: (rows, []))
        self.assertEqual(result['coverage']['poolCount'], 30)
        self.assertEqual(result['coverage']['evaluatedCount'], checks.MAX_DETAILS)
        self.assertEqual(result['coverage']['skippedCount'], 6)
        self.assertFalse(result['coverage']['fullMarket'])

    def test_partial_failure_stays_unknown_and_rank_failures_visible(self):
        rows = [{'code': '111111'}, {'code': '222222'}]
        def sometimes(row, *args):
            if row['code'] == '222222':
                raise RuntimeError('provider missing')
            return collect(row, *args)
        result = self.run_scan(mode='ranked', pool_fetcher=lambda *_: (rows, ['1']), collector=sometimes)
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(len(result['unknown']), 1)
        self.assertEqual(result['coverage']['failedRankSections'], ['1'])
        self.assertEqual(result['coverage']['evaluatedCount'], 2)

    def test_initially_fresh_candidate_expires_during_scan(self):
        clocks = iter([NOW, NOW + checks.timedelta(seconds=20)])
        result = self.run_scan(clock=lambda: next(clocks))
        self.assertEqual(result['items'], [])
        self.assertEqual(len(result['unknown']), 1)
        self.assertIn('10초', result['unknown'][0]['reasons'][0])

    def test_budget_timeout_keeps_concurrency_lock_until_http_read_finishes(self):
        release = threading.Event()
        finished = threading.Event()
        def blocked(*args):
            release.wait(1)
            finished.set()
            return collect(*args)
        try:
            with mock.patch.object(checks, 'SCAN_BUDGET_SEC', 0.02):
                result = self.run_scan(collector=blocked)
                self.assertEqual(len(result['unknown']), 1)
                with self.assertRaises(checks.BusyError):
                    self.run_scan()
        finally:
            release.set()
            self.assertTrue(finished.wait(1))
            # Acquiring verifies the completion callback released the lock.
            self.assertTrue(checks._scan_lock.acquire(timeout=1))
            checks._scan_lock.release()

    def test_missing_source_clock_is_never_replaced_by_receipt_clock(self):
        self.assertIsNone(checks._source_time(None, '20261006'))
        self.assertIsNone(checks._source_time('259999', '20261006'))
        self.assertEqual(checks._source_time('090506', '20261006'), '2026-10-06T09:05:06+09:00')

    def test_rank_dedup_preserves_denominator_and_excludes_etf_in_request(self):
        responses = [{'output': [{'mksc_shrn_iscd': '111111', 'hts_kor_isnm': 'sample',
                                  'acml_tr_pbmn': '10000', 'prdy_vol': '500000'}]},
                     {'output': [{'mksc_shrn_iscd': '111111', 'acml_tr_pbmn': '11000'}]},
                     {'output': [{'mksc_shrn_iscd': '0035S0', 'acml_tr_pbmn': '1000', 'prdy_vol': '10000'}]}]
        with mock.patch.object(checks, '_request', side_effect=responses) as request:
            rows, errors = checks._ranking_pool('token', 'key', 'secret', 100)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['previousVolume'], '500000')
        self.assertEqual(errors, [])
        for call in request.call_args_list:
            self.assertEqual(call.args[5]['FID_COND_MRKT_DIV_CODE'], 'J')
            self.assertEqual(call.args[5]['FID_TRGT_EXLS_CLS_CODE'], '1111111101')

    def test_settings_validated_before_any_query(self):
        for settings in [{'maxOpenRisePct': float('nan')}, {'madeUpProbability': 100}]:
            with self.assertRaises(ValueError):
                self.run_scan(settings=settings)
        self.token.assert_not_called()

    def test_feature_dispatches_are_spaced_and_work_deadline_is_respected(self):
        ticks = [100.0]
        def sleep(seconds):
            ticks[0] += seconds
        with mock.patch.object(checks, '_next_request_at', 0), \
             mock.patch.object(checks.time, 'monotonic', side_effect=lambda: ticks[0]), \
             mock.patch.object(checks.time, 'sleep', side_effect=sleep) as wait, \
             mock.patch.object(checks.kis_client, '_get_domestic_quote', return_value={}) as api:
            checks._request('t', 'k', 's', '/path', 'TR', {}, 110)
            checks._request('t', 'k', 's', '/path', 'TR', {}, 110)
            self.assertAlmostEqual(wait.call_args.args[0], checks.REQUEST_INTERVAL_SEC)
            self.assertEqual(api.call_count, 2)
            with self.assertRaises(checks.TimeoutError):
                checks._request('t', 'k', 's', '/path', 'TR', {}, 100.15)
            self.assertEqual(api.call_count, 2)

    def test_collect_retains_real_provider_clocks_and_krx_denominator(self):
        fixture = snapshot()
        minute = {'output2': [dict(stck_bsop_date='20261006',
                                   stck_cntg_hour=bar['time'].replace(':', ''),
                                   stck_oprc=bar['open'], stck_hgpr=bar['high'],
                                   stck_lwpr=bar['low'], stck_prpr=bar['close'], cntg_vol=bar['volume'])
                             for bar in fixture['bars']]}
        quote = {'output': {'stck_oprc': fixture['quote']['open'], 'stck_hgpr': fixture['quote']['high'],
                            'stck_sdpr': 10000, 'stck_mxpr': fixture['quote']['upperLimit'], 'temp_stop_yn': 'N'}}
        book = {'output1': {'aspr_acpt_hour': '090506'}}
        for index, level in enumerate(fixture['book']['asks'], 1):
            book['output1'].update({'askp%d' % index: level['price'], 'askp_rsqn%d' % index: level['qty']})
        for index, level in enumerate(fixture['book']['bids'], 1):
            book['output1'].update({'bidp%d' % index: level['price'], 'bidp_rsqn%d' % index: level['qty']})
        trade = {'output': [{'stck_cntg_hour': '090506', 'stck_prpr': fixture['trade']['price'],
                             'cntg_vol': fixture['trade']['qty'], 'tday_rltv': fixture['trade']['strength']}]}
        self.raw_responses = [minute, quote, book, trade]
        with mock.patch.object(checks, '_request', side_effect=self.raw_responses) as request:
            value = checks._collect({'code': '111111', 'previousVolume': fixture['previousVolume']['value']},
                                    'token', 'key', 'secret', 100, lambda: NOW)
        self.assertEqual(checks.engine.evaluate(value)['status'], 'candidate')
        self.assertEqual(value['book']['time'], '2026-10-06T09:05:06+09:00')
        self.assertEqual(value['minuteRequestedAt'], NOW.isoformat())
        self.assertEqual(value['trade']['strength'], fixture['trade']['strength'])
        self.assertEqual(value['previousVolume']['market'], 'KRX')
        for call in request.call_args_list:
            self.assertEqual(call.args[5]['FID_COND_MRKT_DIV_CODE'], 'J')

    def test_minute_change_during_collection_cannot_finalize_partial_bar(self):
        self.test_collect_retains_real_provider_clocks_and_krx_denominator()
        clocks = iter([NOW.replace(second=59), NOW.replace(minute=6, second=2)])
        with mock.patch.object(checks, '_request', side_effect=copy.deepcopy(self.raw_responses)):
            with self.assertRaises(checks.MinuteBoundaryError):
                checks._collect({'code': '111111', 'previousVolume': 500000},
                                'token', 'key', 'secret', 100, lambda: next(clocks))


if __name__ == '__main__':
    unittest.main()
