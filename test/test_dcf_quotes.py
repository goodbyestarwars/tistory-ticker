import sys
from pathlib import Path
from datetime import datetime, timezone
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_dcf_quotes import parse_quotes


class PriceSnapshots(unittest.TestCase):
    def body(self, timestamp='2026-10-08T20:00:00+09:00', price='262,500'):
        return {'result': {'time': 1791542930856, 'areas': [{'name': 'SERVICE_ITEM', 'datas': [
            {'cd': '005930', 'nv': 263000, 'nxtOverMarketPriceInfo': {'overPrice': price, 'localTradedAt': timestamp}}]}]}}

    def test_trade_timestamp_and_market_preserved(self):
        result = parse_quotes(self.body(), ['005930'], datetime(2026, 10, 9, tzinfo=timezone.utc))
        self.assertEqual(result['005930']['value'], 262500)
        self.assertEqual(result['005930']['market'], 'NXT')
        self.assertTrue(result['005930']['asOf'].startswith('2026-10-08T20:00:00'))

    def test_server_time_does_not_replace_missing_trade_time(self):
        self.assertEqual(parse_quotes(self.body(None), ['005930'], datetime(2026, 10, 9, tzinfo=timezone.utc)), {})

    def test_stale_future_wrong_symbol_and_invalid_prices_rejected(self):
        for stamp, price in [('2026-01-01T20:00:00+09:00', '123'), ('2027-01-01T20:00:00+09:00', '123'),
                             ('2026-10-08T20:00:00+09:00', 'NaN'), ('2026-10-08T20:00:00', '123')]:
            self.assertEqual(parse_quotes(self.body(stamp, price), ['005930'], datetime(2026, 10, 9, tzinfo=timezone.utc)), {})
        self.assertEqual(parse_quotes(self.body(), ['000660'], datetime(2026, 10, 9, tzinfo=timezone.utc)), {})



class ResumeGuard(unittest.TestCase):
    def run_case(self, calls=0, targets=None, queued=False):
        from unittest.mock import patch
        import resume_dcf_collection as resume
        now = resume.datetime.now(resume.KST)
        index = {'collectionUsage': {'date': now.date().isoformat(), 'calls': calls},
                 'stocks': [{'sourceCode': '005930'}], 'available': {}, 'attempts': {}, 'cursor': 0}
        runs = {'workflow_runs': [{'status': 'queued' if queued else 'in_progress'}]}
        import json
        with patch.object(resume, 'read_js', return_value=index), patch.object(resume, 'target_codes', return_value=targets or []), \
             patch.dict(resume.os.environ, {'GITHUB_REPOSITORY': 'test/repo'}), \
             patch.object(resume.subprocess, 'check_output', return_value=json.dumps(runs)), \
             patch.object(resume.subprocess, 'run') as dispatch:
            resume.main()
            return dispatch.call_count

    def test_quota_stops_recursive_dispatch(self):
        self.assertEqual(self.run_case(calls=12000, targets=['005930']), 0)

    def test_cooldown_or_no_targets_stops_dispatch(self):
        self.assertEqual(self.run_case(targets=[]), 0)

    def test_queued_run_prevents_duplicate(self):
        self.assertEqual(self.run_case(targets=['005930'], queued=True), 0)

    def test_one_eligible_continuation_is_dispatched(self):
        self.assertEqual(self.run_case(targets=['005930']), 1)

if __name__ == '__main__':
    unittest.main()
