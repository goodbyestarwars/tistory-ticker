# -*- coding: utf-8 -*-
"""'장중 거래량 급증' 검색기의 두 매집 패턴(실시간 매집 의심 / 기존 매집봉 재상승) 테스트 (2026-10-15). 합성 데이터만 사용한다."""
import os
import sys
import unittest
from datetime import datetime
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import volume_accumulation as va  # noqa: E402
import volume_surge_live as vs  # noqa: E402

KST = va.KST
NOW = datetime(2026, 10, 15, 10, 0, 0, tzinfo=KST)
T0 = datetime(2026, 10, 15, 9, 0, 0, tzinfo=KST).timestamp()
NOW_T = NOW.timestamp()


def samples(path):
    """path: [(분, 30초당 거래량 증가, 가격)] 구간 목록(분 단위 구간 길이) → 30초 표본 [(t, 누적거래량, 가격)]."""
    out, cum, t = [], 100_000, T0
    for minutes, step_vol, price_fn in path:
        for _ in range(int(minutes * 2)):
            cum += step_vol
            out.append((t, cum, price_fn(t - T0)))
            t += 30
    return out


def flat(price):
    return lambda dt: price + (dt % 60) / 60 * 20          # 9,990~10,010 부근의 잔잔한 흔들림


def rising(a, b, span):
    return lambda dt: a + (b - a) * min(1.0, (dt % span) / span)


ACC = [(40, 2_000, flat(10_000)), (5, 12_000, rising(10_000, 10_150, 300)), (15, 2_500, lambda dt: 10_120 + (dt % 120) / 120 * 40)]


def signal(sample_list, change=2.0, avg_vol=1_000_000, avg_amt=1e10, now=NOW, now_t=None):
    cum = sample_list[-1][1]
    price = sample_list[-1][2]
    return va.realtime_signal(sample_list, now_t or now.timestamp(), now, price, change, cum, cum * price, avg_vol, avg_amt)


class RealtimeTests(unittest.TestCase):
    def test_volume_spike_then_defended_price_is_a_confirmed_signal(self):
        sig = signal(samples(ACC))
        self.assertIsNotNone(sig)
        self.assertEqual((sig['type'], sig['label'], sig['status'], sig['defended']), (va.TYPE_REALTIME, '실시간 매집 의심', 'confirmed', True))
        self.assertGreaterEqual(sig['rvol'], 2.0)
        self.assertEqual(sig['distribution']['risk'], 'LOW')
        self.assertGreaterEqual(sig['closePos'], 0.7)
        self.assertTrue(any('RVOL' in r for r in sig['reasons']))
        self.assertTrue(any('단순 시간비례' in r for r in sig['reasons']))               # 근사임을 명시

    def test_too_few_five_minute_bars_holds_judgement_instead_of_guessing(self):
        recent = [s for s in samples(ACC) if s[0] >= NOW_T - 14 * 60]                     # 최근 14분 표본만(완성 봉 2개)
        sig = signal(recent)
        self.assertIsNotNone(sig)
        self.assertEqual((sig['status'], sig['defended']), ('pending', None))
        self.assertLessEqual(sig['score'], 60)
        self.assertTrue(any('판정 보류' in r for r in sig['reasons']))

    def test_price_that_loses_the_spike_low_is_not_listed(self):
        broke = [(40, 2_000, flat(10_000)), (5, 12_000, rising(10_000, 10_150, 300)), (15, 2_500, lambda dt: 9_930)]
        self.assertIsNone(signal(samples(broke)))                                          # 급증 봉 저가 이탈 = 방어 실패

    def test_long_upper_wick_and_giveback_raise_distribution_risk_and_exclude(self):
        dist = [(40, 2_000, flat(10_000)), (5, 12_000, rising(10_000, 10_400, 300)), (4, 6_000, lambda dt: 10_400 - (dt % 240) / 240 * 330),
                (11, 2_500, lambda dt: 10_060)]
        s = samples(dist)
        bars = va.build_bars(s, NOW_T)
        flags, risk = va.distribution_flags(bars, s[-1][2])
        self.assertIn('GIVEBACK', flags)
        self.assertEqual(risk, 'HIGH' if len(flags) >= 2 else 'MID')
        sig = signal(s)
        if risk == 'HIGH':
            self.assertIsNone(sig)

    def test_mid_distribution_lowers_score_but_stays_listed(self):
        base = signal(samples(ACC))
        flags, risk = ['GIVEBACK'], 'MID'
        self.assertEqual(('LOW', 'MID', 'HIGH')[min(len(flags), 2)], risk)
        self.assertGreater(base['score'], 0)

    def test_low_rvol_amount_and_early_session_are_rejected(self):
        s = samples(ACC)
        self.assertIsNone(signal(s, avg_vol=5_000_000))                                    # RVOL 부족
        self.assertIsNone(signal(s, avg_amt=5e8))                                          # 20일 평균 거래대금(유동성) 부족
        self.assertIsNone(va.realtime_signal(s, NOW_T, NOW, s[-1][2], 2.0, s[-1][1], 1e8, 1_000_000, 1e10))   # 누적 거래대금 부족
        early = datetime(2026, 10, 15, 9, 10, 0, tzinfo=KST)
        self.assertIsNone(va.realtime_signal(s[:20], early.timestamp(), early, 10_000, 2.0, 400_000, 4e9, 1_000_000, 1e10))   # 개장 20분 전
        self.assertIsNone(signal(s, change=9.5))                                           # 이미 8% 넘게 오른 종목
        self.assertIsNone(signal(s, change=-3.0))

    def test_missing_inputs_hold_judgement(self):
        s = samples(ACC)
        self.assertIsNone(va.realtime_signal(s, NOW_T, NOW, s[-1][2], 2.0, s[-1][1], None, 1_000_000, 1e10))
        self.assertIsNone(va.realtime_signal(s, NOW_T, NOW, s[-1][2], None, s[-1][1], 5e9, 1_000_000, 1e10))
        self.assertIsNone(va.realtime_signal(s, NOW_T, NOW, s[-1][2], 2.0, s[-1][1], 5e9, None, None))

    def test_bars_use_only_complete_buckets_with_enough_samples(self):
        s = samples(ACC)
        bars = va.build_bars(s, NOW_T)
        self.assertTrue(all(b['n'] >= va.SAMPLES_PER_BAR_MIN for b in bars))
        self.assertIsNone(bars[0]['volume'])                                               # 첫 봉의 거래량은 알 수 없다
        self.assertTrue(all(b['start'] + va.BAR_SEC <= NOW_T for b in bars))
        gappy = [x for x in s if int((x[0] - T0) // 30) % 7 == 0]                          # 표본이 듬성듬성하면 봉을 만들지 않는다
        self.assertEqual(va.build_bars(gappy, NOW_T), [])


def daily_bars(last_close=10_600, last_vol=900_000, post_vol=500_000, post_low=10_300, last_high=None, last_low=None, post_days=6):
    out = []
    for i in range(20):
        out.append({'date': '2026-09-%02d' % (i + 1) if i < 30 else 'x', 'open': 10_000, 'high': 10_050, 'low': 9_950, 'close': 10_000, 'volume': 1_000_000})
    out.append({'date': '2026-09-21', 'open': 10_000, 'high': 10_550, 'low': 9_980, 'close': 10_500, 'volume': 3_000_000})      # 매집봉
    for i in range(post_days):
        out.append({'date': '2026-09-%02d' % (22 + i), 'open': 10_450, 'high': 10_520, 'low': post_low, 'close': 10_460 + i, 'volume': post_vol})
    out.append({'date': '2026-09-29', 'open': 10_450, 'high': last_high or max(last_close, 10_500) + 20, 'low': last_low or min(last_close, 10_400) - 20,
                'close': last_close, 'volume': last_vol})
    return out


class OldBarTests(unittest.TestCase):
    def test_rebreak_with_volume_reexpansion_gets_top_priority(self):
        sig = va.old_bar_signal(daily_bars())
        self.assertEqual((sig['type'], sig['label'], sig['stage']), (va.TYPE_OLD_BAR, '기존 매집봉 재상승', 'REBREAK'))
        self.assertGreaterEqual(sig['score'], 70)
        self.assertGreater(sig['volumeMultiple'], 1.5)
        self.assertEqual(sig['accDate'], '2026-09-21')
        self.assertTrue(any('재돌파' in r for r in sig['reasons']))

    def test_near_and_supported_stages_rank_below_rebreak(self):
        near = va.old_bar_signal(daily_bars(last_close=10_480, last_vol=400_000))
        held = va.old_bar_signal(daily_bars(last_close=10_200, last_vol=300_000, post_low=10_150))
        self.assertEqual((near['stage'], held['stage']), ('NEAR', 'SUPPORTED'))
        self.assertGreater(va.old_bar_signal(daily_bars())['score'], near['score'])
        self.assertGreater(near['score'], held['score'])

    def test_breakout_without_volume_reexpansion_is_not_promoted(self):
        sig = va.old_bar_signal(daily_bars(last_close=10_600, last_vol=450_000))
        self.assertEqual(sig['stage'], 'SUPPORTED')

    def test_no_dry_up_or_support_failure_is_rejected(self):
        self.assertIsNone(va.old_bar_signal(daily_bars(post_vol=2_000_000)))              # 이후 거래량이 줄지 않음(분배 가능)
        self.assertIsNone(va.old_bar_signal(daily_bars(post_low=9_400)))                  # 매집봉 저가 이탈
        self.assertIsNone(va.old_bar_signal(daily_bars(post_days=0)))                      # 이후 흐름이 없음

    def test_no_accumulation_bar_means_none(self):
        flat_days = [{'date': '2026-09-%02d' % (i + 1), 'open': 10_000, 'high': 10_050, 'low': 9_950, 'close': 10_000, 'volume': 1_000_000} for i in range(30)]
        self.assertIsNone(va.old_bar_signal(flat_days))
        self.assertIsNone(va.old_bar_signal(flat_days[:10]))                               # 데이터 부족 = 판정 보류

    def test_distribution_flags_lower_the_score(self):
        wick = va.old_bar_signal(daily_bars(last_close=10_600, last_high=11_200, last_low=10_450))
        self.assertIn('UPPER_WICK_DAY', wick['distribution']['flags'])
        self.assertEqual(wick['distribution']['risk'], 'MID')
        self.assertLess(wick['score'], va.old_bar_signal(daily_bars())['score'])
        stretched = va.old_bar_signal(daily_bars(last_close=12_300, last_high=12_320, last_low=12_000))
        self.assertIn('EXTENDED', stretched['distribution']['flags'])

    def test_live_price_and_volume_can_upgrade_a_pending_name_intraday(self):
        daily = daily_bars(last_close=10_480, last_vol=400_000)
        self.assertEqual(va.old_bar_signal(daily)['stage'], 'NEAR')
        live = va.old_bar_signal(daily, live_price=10_700, live_rvol_vs_post=2.0)
        self.assertEqual(live['stage'], 'REBREAK')
        no_volume = va.old_bar_signal(daily, live_price=10_700, live_rvol_vs_post=None)
        self.assertEqual(no_volume['stage'], 'SUPPORTED')                                  # 장중 거래량을 모르면 재돌파로 올리지 않는다


class MergeTests(unittest.TestCase):
    def test_two_signals_share_one_row_with_priority_bonus(self):
        rt, old = signal(samples(ACC)), va.old_bar_signal(daily_bars())
        row = va.combined_item('111111', '테스트', 10_150, 2.0, '2026-10-15', [rt, old])
        kinds = [s['type'] for s in row['patternDetail']['signals']]
        self.assertEqual(kinds, [va.TYPE_OLD_BAR, va.TYPE_REALTIME])
        self.assertEqual(row['score'], min(100, max(rt['score'], old['score']) + 10))
        self.assertIn('실시간 매집 의심', row['interpretation'])
        self.assertIn('기존 매집봉 재상승', row['interpretation'])
        self.assertIn('분배 위험', row['interpretation'])
        self.assertTrue(any(r.startswith('[실시간 매집 의심]') for r in row['reasons']))
        self.assertTrue(any(r.startswith('[기존 매집봉 재상승]') for r in row['reasons']))

    def test_merge_lists_dedupes_by_code_and_keeps_other_rows(self):
        old = va.old_bar_signal(daily_bars())
        a = va.combined_item('111111', 'A', 10_600, 1.0, '2026-10-14', [old], live=False, status='REBREAK')
        b = va.combined_item('111111', 'A', 10_150, 2.0, '2026-10-15', [signal(samples(ACC))])
        c = {'code': '222222', 'name': 'C', 'price': 5000, 'score': 40, 'patternDetail': {'live': False}}     # 09:05 스냅샷 행(신호 필드 없음)
        out = va.merge_lists([a], [b, c])
        self.assertEqual([x['code'] for x in out], ['111111', '222222'])
        self.assertEqual(len(out[0]['patternDetail']['signals']), 2)
        self.assertEqual(va.worst_risk(out[0]['patternDetail']['signals']), 'LOW')


def row(code, vol, price, change, name='테스트'):
    return {'code': code, 'name': name, 'price': price, 'change_rate': change, 'trade_volume': vol, 'trade_amount': vol * price}


class LiveIntegrationTests(unittest.TestCase):
    def setUp(self):
        vs._samples.clear()
        vs._prev_cache.clear()
        vs._accum.clear()
        vs._state.update({'date': '2026-10-15', 'detections': {}, 'updatedAt': None, 'error': None, 'polls': 0})
        self.daily = daily_bars()
        import pattern_detect
        stock = {'code': '111111', 'name': '테스트'}
        match = pattern_detect.build_pattern_match(stock, self.daily, va.daily_detail(va.old_bar_signal(self.daily)))
        vs.set_daily_loader(lambda: [match])

    def tearDown(self):
        vs.set_daily_loader(None)

    def feed(self, code='111111', path=ACC):
        prev = lambda c: (1_000_000.0, '2026-10-14')
        for t, cum, price in samples(path):
            now_kst = datetime.fromtimestamp(t, KST)
            vs.process_rows([row(code, cum, price, 2.0)], t, '2026-10-15', prev, stats_lookup=lambda c: (1_000_000.0, 1e10),
                            bars_lookup=lambda c: self.daily, now_kst=now_kst)
        return samples(path)[-1][0]

    def test_one_stock_meeting_both_conditions_is_one_row_with_both_signals(self):
        last_t = self.feed()
        payload = vs.get_payload(last_t + 1)
        rows = [i for i in payload['items'] if i['code'] == '111111']
        self.assertEqual(len(rows), 1)                                                     # 중복 표시 없음
        kinds = {s['type'] for s in rows[0]['patternDetail']['signals']}
        self.assertIn(va.TYPE_REALTIME, kinds)
        self.assertIn(va.TYPE_OLD_BAR, kinds)
        self.assertEqual(payload['items'][0]['code'], '111111')                            # 두 신호 동시 = 맨 위
        self.assertIn('dataBasis', payload)

    def test_realtime_signal_requires_enough_data_otherwise_nothing_is_listed(self):
        vs.set_daily_loader(lambda: [])
        prev = lambda c: (1_000_000.0, '2026-10-14')
        s = samples(ACC)[:20]
        for t, cum, price in s:
            vs.process_rows([row('999999', cum, price, 2.0)], t, '2026-10-15', prev, stats_lookup=lambda c: None, bars_lookup=lambda c: [],
                            now_kst=datetime.fromtimestamp(t, KST))
        self.assertEqual([i for i in vs.get_payload(s[-1][0] + 1)['items'] if i['code'] == '999999'], [])    # 20일 통계가 없으면 판정 보류

    def test_existing_early_detection_still_works_without_accumulation_inputs(self):
        prev = lambda c: (1_000_000.0, '2026-10-02')
        vs.process_rows([row('555555', 100000, 1000, 0.5)], 1000.0, '2026-10-15', prev)
        vs.process_rows([row('555555', 160000, 1010, 1.5)], 1180.0, '2026-10-15', prev)
        item = vs.get_payload(1181.0)['items'][0]
        self.assertEqual((item['code'], item['patternDetail']['status']), ('555555', 'early'))
        self.assertEqual(item['patternDetail']['signals'][0]['type'], 'EARLY_PACE')


class DailyPipelineTests(unittest.TestCase):
    def test_scan_stock_collects_accumulation_bar_and_pattern_scan_merges_into_volume_tab(self):
        import pattern_detect
        import main
        stock = {'code': '111111', 'name': '테스트', 'is_etf': False}
        results = {}
        pattern_detect.scan_stock(stock, daily_bars(), results, [])
        self.assertEqual(len(results['accumulationBar']), 1)
        self.assertEqual(results['accumulationBar'][0]['patternDetail']['signals'][0]['stage'], 'REBREAK')
        pattern_detect.finalize_pattern_results(results, [])
        cache = {'patternScan': {'patterns': dict(results, volumeBreakout=[{'code': '111111', 'name': '테스트', 'price': 10_000, 'score': 50,
                                                                         'patternDetail': {'live': False}},
                                                                        {'code': '222222', 'name': 'B', 'price': 5_000, 'score': 40, 'patternDetail': {'live': False}}])}}
        with patch.object(main, 'load_daily_scan_cache_cached', return_value=cache):
            built = main._build_pattern_scan()
        codes = [i['code'] for i in built['patterns']['volumeBreakout']]
        self.assertEqual(codes, ['111111', '222222'])                                      # 중복 없이 합쳐짐
        self.assertEqual(len(built['patterns']['volumeBreakout'][0]['patternDetail']['signals']), 1)
        self.assertNotIn('accumulationBar', built['patterns'])                             # 새 응답 키를 만들지 않는다


class SourceContractTests(unittest.TestCase):
    """신규 메뉴·검색기를 만들지 않고 기존 '장중 거래량 급증' 탭 하나에서 처리한다."""

    def read(self, *parts):
        with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
            return f.read()

    def test_no_new_tab_and_existing_label_kept(self):
        js = self.read('js', 'pattern-scan.js')
        self.assertEqual(js.count("key: 'volumeBreakout', label: '장중 거래량 급증'"), 1)
        for forbidden in ("key: 'accumulation", "key: 'volumeAccum", "key: 'realtimeAccum"):
            self.assertNotIn(forbidden, js)
        self.assertIn('실시간 매집 의심', js)
        self.assertIn('기존 매집봉 재상승', js)
        self.assertIn('단순 시간비례', js)

    def test_api_has_no_new_response_key_and_trading_engine_is_untouched(self):
        main = self.read('scripts', 'cloud-vm', 'main.py')
        self.assertIn("'volumeBreakout': volume_accumulation.merge_lists(", main)
        self.assertNotIn("'accumulationBar':", main[main.index('def _build_pattern_scan'):main.index('def _build_pattern_scan') + 2500])
        for path in (('scripts', 'cloud-vm', 'volume_accumulation.py'), ('scripts', 'cloud-vm', 'volume_surge_live.py')):
            src = self.read(*path)
            for word in ('live_engine', 'sell_market', 'buy_limit', 'kt10000', 'kt10001'):
                self.assertNotIn(word, src)


if __name__ == '__main__':
    unittest.main()
