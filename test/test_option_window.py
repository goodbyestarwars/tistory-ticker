# -*- coding: utf-8 -*-
"""옵션 수급 ATM 창 수집 테스트 (2026-10-16). 증상: 전광판이 행사가 높은 100행만 줘 중앙 구간이 빠지고 콜만 크게 보였다. 합성 데이터만 사용."""
import io
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import option_window as ow  # noqa: E402


def read(*parts):
    with io.open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


class SuffixTests(unittest.TestCase):
    def test_codes_below_1000_use_the_integer_part_of_the_strike(self):
        self.assertEqual([ow.strike_suffix(s) for s in (960, 992.5, 995, 997.5, 987.5, 850)], ['960', '992', '995', '997', '987', '850'])

    def test_codes_from_1000_follow_the_observed_sequence(self):
        # 2026-10-16 실측: A01=1000, A50=1122.5, A99=1245, B01=1247.5, B41=1347.5, C41=1595
        got = [ow.strike_suffix(s) for s in (1000, 1122.5, 1245, 1247.5, 1347.5, 1595)]
        self.assertEqual(got, ['A01', 'A50', 'A99', 'B01', 'B41', 'C41'])

    def test_prefix_comes_from_board_rows_not_from_guessing_year_and_month(self):
        rows = [{'optn_shrn_iscd': ''}, {'optn_shrn_iscd': 'B01611C41'}]
        self.assertEqual(ow.prefix_of(rows), 'B01611')
        self.assertIsNone(ow.prefix_of([{'optn_shrn_iscd': 'X'}]))


class WindowTests(unittest.TestCase):
    def test_window_is_centered_on_spot_in_2_5_steps(self):
        strikes = ow.window_strikes(960, 7)
        self.assertEqual((strikes[0], strikes[-1]), (892.5, 1027.5))          # 960 ± 7%
        self.assertTrue(all(abs((b - a) - 2.5) < 1e-9 for a, b in zip(strikes, strikes[1:])))
        self.assertIn(960.0, strikes)

    def test_window_never_reaches_only_the_far_out_of_the_money_strikes(self):
        """원 버그: 전광판 100행은 1,347.5~1,595뿐이었다. 창은 현물 근처에 있어야 한다."""
        strikes = ow.window_strikes(960)
        self.assertLess(max(strikes), 1347.5)
        self.assertGreater(min(strikes), 700)

    def test_spot_from_put_call_parity_matches_the_observed_board_row(self):
        calls = [{'acpr': '1595.00', 'optn_prpr': '0.03'}]
        puts = [{'acpr': '1595.00', 'optn_prpr': '635.70'}]
        self.assertAlmostEqual(ow.spot_from_parity(calls, puts), 959.33, places=2)
        self.assertIsNone(ow.spot_from_parity([], []))


def make_quote(volumes, listed=None):
    """코드 → output1. volumes[(side, strike)] = (volume, oi). listed가 있으면 그 행사가만 존재."""
    def quote(code):
        side = 'CALL' if code.startswith('B') else 'PUT'
        for strike in listed or [k[1] for k in volumes]:
            if code[6:] == ow.strike_suffix(strike):
                vol, oi = volumes.get((side, strike), (0, 0))
                return {'acpr': '%.2f' % strike, 'acml_vol': str(vol), 'hts_otst_stpl_qty': str(oi), 'otst_stpl_qty_icdc': '0'}
        return {'acpr': '0.00'}
    return quote


def aggregate(rows):
    """option_flow._aggregate와 같은 합산(리눅스 전용 이웃 모듈을 끌어오지 않으려고 소스에서 떼어 실행)."""
    text = read('scripts', 'cloud-vm', 'option_flow.py')
    start = text.index('def _aggregate(rows):')
    end = text.index('def _number(', start)
    ns = {}
    exec(compile(text[start:end], 'option_flow', 'exec'), ns)  # noqa: S102
    return ns['_aggregate'](rows)


class FetchWindowTests(unittest.TestCase):
    def setUp(self):
        self.strikes = ow.window_strikes(960, 7)
        self.volumes = {}
        for k in self.strikes:
            self.volumes[('CALL', k)] = (10, 100)
            self.volumes[('PUT', k)] = (30 if k <= 960 else 5, 200)   # 폭락장: 중앙 아래 풋 거래가 많다

    def test_put_volume_is_no_longer_zero_when_the_window_covers_the_money(self):
        calls, puts, stats = ow.fetch_window(make_quote(self.volumes), 'B01611', 'C01611', self.strikes)
        self.assertTrue(ow.window_ok(stats))
        call_v, _, _ = aggregate(calls)
        put_v, put_oi, _ = aggregate(puts)
        self.assertGreater(put_v, 500)                      # 전광판 100행 방식에서는 2였다
        self.assertGreater(put_v, call_v)                     # 이 합성 장세에서는 풋이 더 많다 - 콜 고정이 아니다
        self.assertEqual(stats['errors'], 0)

    def test_rows_with_a_different_strike_are_skipped_not_trusted(self):
        wrong = {'acpr': '1077.50', 'acml_vol': '999', 'hts_otst_stpl_qty': '1'}       # 1,090 요청에 1,077.5가 온 실측 사례
        calls, puts, stats = ow.fetch_window(lambda code: wrong, 'B01611', 'C01611', [1090.0, 1092.5])
        self.assertEqual((len(calls), len(puts), stats['skipped']), (0, 0, 4))

    def test_unlisted_codes_and_errors_are_counted(self):
        def flaky(code):
            if code.endswith('0'):
                raise RuntimeError('timeout')
            return {'acpr': '0.00'}
        _, _, stats = ow.fetch_window(flaky, 'B01611', 'C01611', ow.window_strikes(960, 3))
        self.assertGreater(stats['errors'], 0)
        self.assertFalse(ow.window_ok(stats))

    def test_window_is_rejected_when_too_few_rows_or_too_many_errors(self):
        self.assertFalse(ow.window_ok({'requested': 100, 'errors': 0, 'skipped': 90, 'calls': 5, 'puts': 5}))
        self.assertFalse(ow.window_ok({'requested': 100, 'errors': 40, 'skipped': 0, 'calls': 30, 'puts': 30}))
        self.assertTrue(ow.window_ok({'requested': 100, 'errors': 2, 'skipped': 10, 'calls': 44, 'puts': 44}))
        self.assertFalse(ow.window_ok(None))


class ScopeFileTests(unittest.TestCase):
    def test_scope_round_trip_and_missing_file(self):
        old = ow.SCOPE_FILE
        try:
            ow.SCOPE_FILE = os.path.join(tempfile.mkdtemp(), 'scope.json')
            self.assertIsNone(ow.read_scope())
            ow.write_scope({'mode': 'ATM_WINDOW', 'strike_min': 892.5, 'strike_max': 1027.5})
            got = ow.read_scope()
            self.assertEqual((got['mode'], got['strike_min']), ('ATM_WINDOW', 892.5))
            self.assertIn('updated_at', got)
        finally:
            ow.SCOPE_FILE = old


class WiringTests(unittest.TestCase):
    def test_refresh_uses_the_window_and_falls_back_with_a_warning(self):
        src = read('scripts', 'cloud-vm', 'option_flow.py')
        self.assertIn('_window_rows(token, appkey, appsecret, calls, puts)', src)
        self.assertIn("'mode': 'BOARD_TOP100'", src)                     # 폴백을 숨기지 않고 표시한다
        self.assertIn('option_window.write_scope', src)

    def test_api_and_screen_disclose_the_aggregation_scope(self):
        self.assertIn("data['scope'] = option_window.read_scope()", read('scripts', 'cloud-vm', 'main.py'))
        js = read('js', 'kospi-futures.js')
        self.assertIn('function optionScopeLabel(scope)', js)
        self.assertIn('콜/풋 비교 참고 불가', js)
        self.assertIn('optionScopeLabel(bySide.scope)', js)

    def test_quote_function_uses_the_documented_tr(self):
        src = read('scripts', 'cloud-vm', 'kis_client.py')
        self.assertIn("'FHMIF10000000'", src)
        self.assertIn('def fetch_option_quote(', src)


if __name__ == '__main__':
    unittest.main()
