# -*- coding: utf-8 -*-
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import bond_yield


class FetchHistoryThrottleTests(unittest.TestCase):
    """fetch_history()가 최대 58페이지를 쉬는 시간 없이 순차 호출하던 문제(2026-08-21
    코드 감사) - 페이지 사이에 최소한의 쓰로틀을 넣었다."""

    def test_sleeps_between_pages_but_not_after_the_last_one(self):
        pages = [
            [{'date': '20260101', 'value': 3.0, 'change': 0.0, 'change_rate': 0.0}],
            [{'date': '20260102', 'value': 3.1, 'change': 0.1, 'change_rate': 3.2}],
            [],  # 세 번째 페이지가 비어서 여기서 멈춰야 함
        ]
        with mock.patch.object(bond_yield, '_fetch_page', side_effect=pages) as fetch_page, \
                mock.patch.object(bond_yield.time, 'sleep') as sleep:
            rows = bond_yield.fetch_history(days=bond_yield._ROWS_PER_PAGE * 3)

        self.assertEqual(len(rows), 2)
        self.assertEqual(fetch_page.call_count, 3)
        # 1페이지 뒤, 2페이지 뒤에는 쉬고(다음 페이지를 더 부를 예정이라), 3페이지는 빈
        # 값을 받고 바로 멈추므로 그 뒤엔 안 쉰다.
        self.assertEqual(sleep.call_count, 2)
        sleep.assert_called_with(bond_yield._PAGE_THROTTLE_SEC)


class KtbReplacementSourceTests(unittest.TestCase):
    def test_json_source_preserves_yield_and_signed_changes(self):
        import io, json
        payload = [{'localTradedAt': '2026-10-06T00:00:00+09:00', 'closePrice': '3.93',
                    'fluctuations': '-0.01', 'fluctuationsRatio': '-0.25'},
                   {'localTradedAt': 'bad', 'closePrice': 'nan', 'fluctuations': '0', 'fluctuationsRatio': '0'}]
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(payload).encode()
        with mock.patch.object(bond_yield.urllib.request, 'urlopen', return_value=response) as opening:
            rows = bond_yield._fetch_page(2)
        self.assertEqual(rows, [{'date':'20261006','value':3.93,'change':-0.01,'change_rate':-0.25}])
        url=opening.call_args.args[0].full_url
        self.assertIn('KFIA103000/prices?page=2&pageSize=60',url)


class FredMacroSymbolTests(unittest.TestCase):
    def test_market_macro_symbols_are_collected_from_fred(self):
        expected = {
            'US_CPI': 'CPIAUCSL',
            'US_CORE_CPI': 'CPILFESL',
            'US_CORE_PCE': 'PCEPILFE',
            'US_PPI': 'PPIACO',
            'US_REAL_GDP_GROWTH': 'A191RL1Q225SBEA',
            'US_NONFARM_PAYROLLS': 'PAYEMS',
            'US_UNEMPLOYMENT': 'UNRATE',
            'US_JOB_OPENINGS': 'JTSJOL',
            'US_RETAIL_SALES': 'RSAFS',
            'US_CONSUMER_SENTIMENT': 'UMCSENT',
        }
        self.assertEqual(
            {symbol: bond_yield.FRED_SYMBOLS[symbol]['series'] for symbol in expected},
            expected,
        )


class FredPollCadenceTests(unittest.TestCase):
    """2026-10-15: 9월 CPI(10/14 발표)가 6시간 주기 때문에 늦게 반영된 문제."""

    def kst(self, y, m, d, hh, mm):
        return bond_yield.datetime(y, m, d, hh, mm, tzinfo=bond_yield._KST)

    def test_release_window_polls_every_15_minutes_otherwise_two_hours(self):
        # 2026-10-14(수) 저녁 발표 구간, 다음날 새벽까지
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 14, 21, 30)), 15 * 60)
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 14, 23, 59)), 15 * 60)
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 15, 3, 59)), 15 * 60)
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 15, 4, 0)), 2 * 3600)
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 15, 12, 0)), 2 * 3600)
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 14, 21, 29)), 2 * 3600)
        # 금요일 저녁 -> 토요일 새벽까지는 창, 토요일·일요일 저녁은 아님
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 16, 22, 0)), 15 * 60)
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 17, 2, 0)), 15 * 60)
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 17, 22, 0)), 2 * 3600)
        self.assertEqual(bond_yield._fred_poll_seconds(self.kst(2026, 10, 18, 2, 0)), 2 * 3600)

    def test_stale_worst_case_is_no_longer_six_hours(self):
        self.assertLessEqual(bond_yield._FRED_POLL_SEC, 2 * 3600)
        self.assertLess(bond_yield._FRED_POLL_SEC, bond_yield._POLL_INTERVAL_SEC)

    def test_fred_polls_every_step_but_ktb3y_only_every_six_hours(self):
        with mock.patch.object(bond_yield, 'refresh_ktb3y') as ktb, mock.patch.object(bond_yield, 'refresh_fred_all') as fred:
            last = bond_yield._poll_step(None, now_ts=1000.0)
            last = bond_yield._poll_step(last, now_ts=1000.0 + 900)
            last = bond_yield._poll_step(last, now_ts=1000.0 + 1800)
            self.assertEqual((ktb.call_count, fred.call_count), (1, 3))
            bond_yield._poll_step(last, now_ts=1000.0 + bond_yield._POLL_INTERVAL_SEC + 1)
            self.assertEqual((ktb.call_count, fred.call_count), (2, 4))

    def test_one_failing_source_does_not_stop_the_other(self):
        with mock.patch.object(bond_yield, 'refresh_ktb3y', side_effect=RuntimeError('x')),                 mock.patch.object(bond_yield, 'refresh_fred_all') as fred:
            bond_yield._poll_step(None, now_ts=1.0)
            fred.assert_called_once()

    def test_fred_request_still_sends_no_user_agent(self):
        """FRED는 데스크톱 UA를 보내면 응답을 안 준다(2026-07-18 실측) - 기존 규칙 유지."""
        captured = {}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'observation_date,CPIAUCSL' + bytes([10]) + b'2026-09-01,336.298' + bytes([10])

        def fake_urlopen(req, timeout=0):
            captured['headers'] = dict(req.header_items())
            return Resp()

        with mock.patch.object(bond_yield.urllib.request, 'urlopen', side_effect=fake_urlopen):
            rows = bond_yield.fetch_fred_series('CPIAUCSL')
        self.assertEqual(rows, [{'date': '20260901', 'value': 336.298}])
        self.assertNotIn('User-agent', captured['headers'])


if __name__ == '__main__':
    unittest.main()
