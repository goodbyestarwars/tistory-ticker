"""Forward performance contracts, independent of direction rules and real providers."""
import copy
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'cloud-vm'))
import hour_validation as validation
import hour_direction_engine as engine
from test_hour_candidate_engine import snapshot

NOW = datetime.fromisoformat('2026-10-06T09:05:08+09:00')


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = os.path.join(self.temp.name, 'validation.db')
        self.patch = mock.patch.dict(os.environ, HOUR_VALIDATION_DB=self.path)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.data = snapshot()
        self.verdict = engine.evaluate_direction(self.data)
        self.target = NOW + timedelta(minutes=60)

    def add(self, direction='up', reference=100, code='111111', checked=NOW, model='hour-direction-rules-v6', scope='in-session'):
        verdict = dict(self.verdict, code=code, direction=direction, referencePrice=reference,
                       checkedAt=checked.isoformat(), rulesVersion=model)
        return validation.record_prediction(verdict, self.data, scope)

    def trade(self, offset=0, price=101, quantity=1, **extra):
        return dict(stck_cntg_hour=(self.target + timedelta(seconds=offset)).strftime('%H%M%S'),
                    stck_prpr=str(price), cntg_vol=str(quantity), **extra)

    def observe(self, rows, code='111111', received=None):
        return validation.observe_trades(code, rows, received or self.target + timedelta(seconds=65))

    def finish(self):
        return validation.finalize_due(self.target + timedelta(seconds=90))

    def test_rule_inputs_unchanged_and_covariates_saved(self):
        data = copy.deepcopy(self.data)
        verdict = copy.deepcopy(self.verdict)
        validation.record_prediction(verdict, data)
        self.assertEqual(data, self.data)
        self.assertEqual(verdict, engine.evaluate_direction(self.data))
        row = validation.records()['records'][0]
        self.assertEqual(row['snapshot'], self.data)
        for key in ('fiveMinuteChangePct', 'strengthRaw', 'tradePriceTolerancePct', 'recentLows', 'recentHighs', 'volumeAcceleration'):
            self.assertIn(key, row['metrics'])

    def test_duplicate_prediction_and_outcome_and_immutability(self):
        first = self.add()
        self.assertEqual(first, self.add())
        self.observe([self.trade()])
        self.assertEqual(self.finish(), 1)
        self.assertEqual(self.finish(), 0)
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM predictions').fetchone()[0], 1)
            for sql in ('UPDATE predictions SET reason="changed"', 'DELETE FROM predictions',
                        'UPDATE outcomes SET price=999', 'DELETE FROM outcomes'):
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(sql)

    def test_exact_precedes_prior_and_after(self):
        self.add()
        self.observe([self.trade(-3, 95), self.trade(0, 101), self.trade(4, 110)])
        self.finish()
        row = validation.records()['records'][0]
        self.assertEqual((row['price'], row['selection'], row['hit']), (101, 'exact', 1))

    def test_last_before_and_first_available_after(self):
        for offsets, expected, method in [([-10, -1, 2], 99, 'last-before-10s'), ([3, 60], 103, 'first-after-60s')]:
            with self.subTest(offsets=offsets):
                rows = [{'stamp_ts': self.target.timestamp() + offset, 'price': 100 + offset} for offset in offsets]
                chosen, selection = validation.select_price(rows, self.target.timestamp())
                self.assertEqual((chosen['price'], selection), (expected, method))

    def test_microsecond_target_uses_same_second(self):
        rows = [{'stamp_ts': self.target.timestamp(), 'price': 101}]
        self.assertEqual(validation.select_price(rows, self.target.timestamp() + .75)[1], 'exact')

    def test_boundaries_and_ambiguous_second_excluded(self):
        self.add()
        self.observe([self.trade(-11), self.trade(61)])
        self.finish()
        self.assertEqual(validation.records()['records'][0]['exclusion'], 'no_eligible_trade')
        rows = [{'stamp_ts': self.target.timestamp(), 'price': price} for price in (100, 101)]
        self.assertEqual(validation.select_price(rows, self.target.timestamp())[1], 'ambiguous_trade_second')

    def test_same_price_duplicates_do_not_make_ambiguity(self):
        self.add()
        self.observe([self.trade(), self.trade()])
        self.finish()
        self.assertEqual(validation.records()['records'][0]['state'], 'evaluated')

    def test_invalid_future_zero_quantity_and_wrong_day_not_used(self):
        self.add()
        for row in [self.trade(2), self.trade(quantity=0), self.trade(stck_bsop_date='20261005')]:
            self.assertEqual(self.observe([row], received=self.target), 0)
        self.finish()
        self.assertEqual(validation.records()['records'][0]['state'], 'excluded')

    def test_no_early_evaluation(self):
        self.add()
        self.observe([self.trade()])
        self.assertEqual(validation.finalize_due(self.target + timedelta(seconds=89)), 0)
        self.assertEqual(self.finish(), 1)

    def test_flat_is_miss_unclear_is_not_prediction(self):
        self.add('up')
        self.add('down')
        self.add('unclear')
        self.observe([self.trade(price=100)])
        self.finish()
        data = validation.summary()
        self.assertEqual(data['totals']['directionalEvaluated'], 2)
        self.assertEqual(data['totals']['hitRatePct'], 0)
        self.assertAlmostEqual(data['totals']['holdRatePct'], 100 / 3)
        self.assertIsNone(next(row for row in data['groups'] if row['direction'] == 'unclear')['hitRatePct'])

    def test_missing_reference_excluded_without_fake_return(self):
        self.add('unclear', None)
        self.observe([self.trade()])
        self.finish()
        row = validation.records()['records'][0]
        self.assertEqual(row['exclusion'], 'missing_reference')
        self.assertIsNone(row['change_pct'])

    def test_statistics_signed_returns_payoff_profitfactor(self):
        for code, price in [('111111', 104), ('222222', 98), ('333333', 102)]:
            self.add('up', code=code)
            self.observe([self.trade(price=price)], code)
        self.add('down', code='444444')
        self.observe([self.trade(price=97)], '444444')
        self.finish()
        data = validation.summary()
        up = next(row for row in data['groups'] if row['direction'] == 'up')
        down = next(row for row in data['groups'] if row['direction'] == 'down')
        self.assertAlmostEqual(up['meanSignedReturnPct'], 4 / 3)
        self.assertAlmostEqual(up['payoffRatio'], 1.5)
        self.assertAlmostEqual(up['profitFactor'], 3)
        self.assertAlmostEqual(up['hitRatePct'], 200 / 3)
        self.assertAlmostEqual(down['meanChangePct'], -3)
        self.assertAlmostEqual(down['meanSignedReturnPct'], 3)
        self.assertIsNone(down['payoffRatio'])

    def test_version_hour_code_and_dates_separate(self):
        self.add(model='v6')
        self.add(model='v7', code='222222', checked=NOW.replace(hour=10))
        self.add(scope='outside-window')
        self.assertEqual(validation.summary()['totals']['predictions'], 2)
        self.assertEqual(validation.summary(model='v6')['totals']['predictions'], 1)
        self.assertEqual(validation.summary(code='222222')['totals']['predictions'], 1)
        self.assertEqual(len(validation.summary(group_by='hour')['groups']), 2)
        self.assertEqual(validation.summary(start='2026-10-07')['totals']['predictions'], 0)
        self.assertEqual(validation.summary(scope='outside-window')['totals']['predictions'], 1)

    def test_no_due_rows_no_external_calls(self):
        self.add()
        fetch = mock.Mock()
        validation.run_due(now=NOW, fetch=fetch)
        fetch.assert_not_called()

    def test_only_due_codes_and_two_code_bound(self):
        for code in ('111111', '222222', '333333'):
            self.add(code=code)
        fetch = mock.Mock(return_value=[self.trade()])
        result = validation.run_due(now=self.target + timedelta(seconds=1), fetch=fetch)
        self.assertEqual(result['fetchedCodes'], 2)
        self.assertEqual(fetch.call_count, 2)

    def test_existing_cached_observation_reused_after_full_window(self):
        self.add()
        self.observe([self.trade()], received=self.target + timedelta(seconds=65))
        fetch = mock.Mock()
        validation.run_due(now=self.target + timedelta(seconds=70), fetch=fetch)
        fetch.assert_not_called()

    def test_overlapping_prediction_not_hidden_by_older_cached_result(self):
        self.add()
        self.observe([self.trade()], received=self.target + timedelta(seconds=65))
        self.add(checked=NOW + timedelta(seconds=50))
        fetch = mock.Mock(return_value=[self.trade(50)])
        validation.run_due(now=self.target + timedelta(seconds=70), fetch=fetch)
        fetch.assert_called_once_with('111111')

    def test_failed_fetch_retried_then_excluded(self):
        self.add()
        fetch = mock.Mock(side_effect=RuntimeError('no data'))
        validation.run_due(now=self.target + timedelta(seconds=1), fetch=fetch)
        validation.run_due(now=self.target + timedelta(seconds=5), fetch=fetch)
        self.assertEqual(fetch.call_count, 1)
        validation.run_due(now=self.target + timedelta(seconds=21), fetch=fetch)
        self.assertEqual(fetch.call_count, 2)
        validation.run_due(now=self.target + timedelta(seconds=90), fetch=fetch)
        self.assertEqual(validation.records()['records'][0]['state'], 'excluded')

    def test_restart_recovery_never_backfills_with_next_day_price(self):
        self.add()
        fetch = mock.Mock(return_value=[self.trade(price=999)])
        validation.run_due(now=NOW + timedelta(days=1), fetch=fetch)
        fetch.assert_not_called()
        self.assertEqual(validation.records()['records'][0]['state'], 'excluded')

    def test_stored_evidence_survives_connection_reopen(self):
        self.add()
        self.observe([self.trade()])
        validation.run_due(now=self.target + timedelta(seconds=90), fetch=mock.Mock())
        self.assertEqual(validation.summary()['totals']['evaluated'], 1)
        self.assertEqual(validation.records()['records'][0]['evidence']['origin'], 'existing-kis-request')

    def test_legacy_import_archives_without_changing_source_and_is_idempotent(self):
        legacy = Path(self.temp.name) / 'hour_candidate_checks.jsonl'
        legacy.write_text(json.dumps({'rows': [{'code': self.verdict['code'], 'directionVerdict': self.verdict}],
                                     'inputs': {self.verdict['code']: self.data}}) + '\n', encoding='utf-8')
        digest = hashlib.sha256(legacy.read_bytes()).digest()
        validation.prepare_store(str(legacy))
        validation.prepare_store(str(legacy))
        self.assertEqual(hashlib.sha256(legacy.read_bytes()).digest(), digest)
        self.assertEqual((Path(self.temp.name) / 'hour_validation_archive' / legacy.name).read_bytes(), legacy.read_bytes())
        self.assertEqual(validation.summary()['totals']['predictions'], 1)

    def test_backup_is_integral_and_capacity_failure_explicit(self):
        self.add()
        backup = validation.backup_store()
        self.assertEqual(backup['integrity'], 'ok')
        with mock.patch.object(validation, 'MAX_DB_BYTES', 1):
            with self.assertRaises(OSError):
                self.add(code='222222')

    def test_records_cursor_and_snapshot_export(self):
        for code in ('111111', '222222'):
            self.add(code=code)
        first = validation.records(limit=1)
        second = validation.records(first['nextCursor'], limit=1)
        self.assertNotEqual(first['records'][0]['id'], second['records'][0]['id'])
        self.assertEqual(first['records'][0]['snapshot'], self.data)


class ValidationRouteTests(unittest.TestCase):
    setUp = ValidationTests.setUp
    add = ValidationTests.add
    def test_public_summary_and_protected_raw_records(self):
        from fastapi.testclient import TestClient
        import main
        self.add()
        client = TestClient(main.app)
        self.addCleanup(client.close)
        with mock.patch.object(main, '_check_rate_limit'), mock.patch.dict(os.environ, API_TOKEN='test-only-key'):
            # Do not run production startup collectors in tests.
            response = client.get('/hour-direction/performance?group_by=hour')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(response.json()['data']['totals']['predictions'], 1)
            self.assertEqual(client.get('/hour-direction/records').status_code, 401)
            response = client.get('/hour-direction/records', headers={'X-API-Key': 'test-only-key'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()['data']['records']), 1)

    def test_invalid_group_and_limit_are_rejected(self):
        from fastapi.testclient import TestClient
        import main
        client = TestClient(main.app)
        self.addCleanup(client.close)
        for path in ('/hour-direction/performance?group_by=anything', '/hour-direction/records?limit=10000'):
            self.assertEqual(client.get(path).status_code, 422)

    def test_kis_reuses_j_trades_but_not_nxt_or_other_api(self):
        import kis_client
        response = {'output': []}
        with mock.patch.object(kis_client, '_with_token_retry', return_value=response), mock.patch.object(validation, 'observe_trades') as observe:
            for market in ('J', 'NX', 'UN'):
                result = kis_client._get_domestic_quote('token', 'key', 'secret', '/inquire-ccnl', 'test',
                    {'FID_COND_MRKT_DIV_CODE': market, 'FID_INPUT_ISCD': '111111'})
                self.assertEqual(result, response)
            self.assertEqual(observe.call_count, 1)

    def test_supplemental_recorder_failure_does_not_change_v6(self):
        import hour_candidates
        verdict = engine.evaluate_direction(self.data)
        payload = {'state': 'outside_window', 'items': [], 'rejected': [], 'unknown': [],
                   'checkedAt': NOW.isoformat(), 'note': 'outside'}
        with mock.patch.object(hour_candidates, 'scan', return_value=payload), mock.patch.object(validation, 'record_prediction', side_effect=OSError('full')):
            result = hour_candidates.check_direction('111111')
        self.assertEqual(result['direction'], 'unclear')
        self.assertFalse(result['validationRecorded'])
        self.assertIsNone(result['predictionId'])

    def test_real_service_preserves_prediction_and_input_snapshot(self):
        import hour_candidates
        row = dict(self.data, code='111111')
        expected = engine.evaluate_direction(row)
        with mock.patch.object(hour_candidates.kis_client, 'get_token', return_value='test'), mock.patch.object(hour_candidates, 'RECORD_FILE', os.path.join(self.temp.name, 'manual.jsonl')), mock.patch.object(hour_candidates.market_clock, 'is_kr_trading_day', return_value=True):
            result = hour_candidates.check_direction('111111', key='test', secret='test',
                         clock=lambda: NOW, collector=lambda *args: row)
        self.assertTrue(result['validationRecorded'])
        stored = validation.records()['records'][0]
        self.assertEqual(stored['snapshot'], row)
        for field in ('direction', 'referencePrice', 'checkedAt', 'reason', 'rulesVersion'):
            self.assertEqual(result[field], expected[field])
            self.assertEqual(stored['verdict'][field], expected[field])

    def test_existing_loop_callback_failure_does_not_stop_vi(self):
        import circuit_breaker
        callback = mock.Mock(side_effect=RuntimeError('db unavailable'))
        with mock.patch.object(circuit_breaker, 'in_poll_window', return_value=True), mock.patch.object(circuit_breaker, 'refresh_once') as refresh, mock.patch.object(circuit_breaker.time, 'sleep', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                circuit_breaker._loop('key', 'secret', callback)
        refresh.assert_called_once()
