# -*- coding: utf-8 -*-
"""자동매매 운영센터 화면(js/auto-trader.js)의 분석 판단·정책 문구·주문 안전 회귀 테스트 (2026-10-15)."""
import json
import os
import subprocess
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SOURCE = os.path.join(ROOT, 'js', 'auto-trader.js')

RUNNER = r'''
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('js/auto-trader.js', 'utf8');
const ctx = {window: {}, document: {readyState: 'loading', addEventListener() {}, getElementById() { return null; }}, console,
             localStorage: {getItem() { return ''; }, setItem() {}, removeItem() {}}};
ctx.window.localStorage = ctx.localStorage;
vm.runInNewContext(src, ctx);
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log(JSON.stringify(cases.map(c => { const r = ctx.window.AutoTraderPage.analyze(c); return {state: r.state, label: r.label, points: r.points, reasons: r.reasons.map(x => x.t), levels: r.levels}; })));
'''


def bars(n=120, end='2026-10-14', price=100.0, last_volume=None, last_down=False):
    from datetime import date, timedelta
    d = date.fromisoformat(end)
    days = []
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    out = [{'date': x.isoformat(), 'open': price, 'high': price + 1, 'low': price - 1, 'close': price, 'volume': 1000} for x in days]
    if last_volume:
        out[-1]['volume'] = last_volume
    if last_down:
        out[-2]['close'] = price + 2
    return out


def case(price=105.0, ma20=100.0, ma60=98.0, support=(95.0,), resistance=(110.0,), flow5=(100, 100), flow20=(100, 100),
         priceFresh=True, daily=None, today='2026-10-15', marketOpen=False, flow_asof='2026-10-14', **kw):
    d = daily if daily is not None else bars()
    base = {
        'price': price, 'avg': 110.0, 'priceAt': '2026-10-15 08:40:00', 'priceFresh': priceFresh, 'marketOpen': marketOpen, 'today': today,
        'daily': d, 'ma': {'ma20': [ma20] * len(d), 'ma60': [ma60] * len(d)},
        'levels': {'support': list(support), 'resistance': list(resistance)},
        'flow': {'as_of': flow_asof, 'rolling': {'5d': {'foreign': flow5[0], 'inst': flow5[1]}, '20d': {'foreign': flow20[0], 'inst': flow20[1]}}},
    }
    base.update(kw)
    return base


def run(cases):
    out = subprocess.run(['node', '-e', RUNNER], cwd=ROOT, input=json.dumps(cases), capture_output=True, text=True, encoding='utf-8')
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


class AnalysisTests(unittest.TestCase):
    def test_states_keep_caution_review_and_unknown(self):
        keep, caution, review, unknown = run([
            case(),                                                                   # 20·60일선 위, 지지 여유, 수급 순매수
            case(price=99.0, ma20=100.0, ma60=98.0, support=(98.5,)),                 # 20일선 아래 + 지지선 바로 위 -> 2점
            case(price=94.0, ma20=100.0, ma60=98.0, support=(95.0,), flow5=(-5, -5), flow20=(-5, -5)),   # 지지 이탈 + 약세 + 수급 -> 검토
            case(priceFresh=False, priceNote='잔고 FAILED'),
        ])
        self.assertEqual((keep['label'], keep['points']), ('보유 유지', 0))
        self.assertEqual(caution['label'], '매도 주의')
        self.assertEqual(review['label'], '매도 검토')
        self.assertEqual(unknown['label'], '판단 불가')
        self.assertIsNone(unknown['points'])

    def test_supported_levels_and_reasons_are_reported(self):
        r = run([case()])[0]
        self.assertEqual(r['levels']['ma20'], 100.0)
        self.assertEqual(r['levels']['support'], 95.0)
        self.assertEqual(r['levels']['resistance'], 110.0)
        self.assertTrue(any('20일선' in t for t in r['reasons']))

    def test_unknown_when_data_missing_or_stale(self):
        results = run([
            case(price=0),                                              # 현재가 없음
            case(daily=bars(end='2026-10-01')),                         # 일봉 오래됨
            case(daily=bars(n=30)),                                     # 일봉 부족
            case(ma20=0.0),                                             # 이동평균 계산 불가
        ])
        self.assertTrue(all(r['label'] == '판단 불가' for r in results), results)

    def test_stale_flow_is_left_out_not_guessed(self):
        r = run([case(flow_asof='2026-09-01', flow5=(-9, -9), flow20=(-9, -9))])[0]
        self.assertEqual(r['label'], '보유 유지')                        # 오래된 수급은 점수에 쓰지 않는다
        self.assertTrue(any('수급 데이터를 확인하지 못해' in t for t in r['reasons']))

    def test_no_fixed_stop_or_profit_rule_is_applied(self):
        # 매입가 대비 -50%여도 차트가 건강하면 '고정 손절'로 매도 검토가 되지 않는다.
        r = run([case(price=105.0, avg=210.0)])[0]
        self.assertEqual(r['label'], '보유 유지')
        self.assertTrue(any('고정 손절·익절 기준은 적용하지 않습니다' in t for t in r['reasons']))

    def test_down_day_heavy_volume_adds_a_caution_point(self):
        d = bars(last_volume=3000, last_down=True)
        r = run([case(daily=d)])[0]
        self.assertTrue(any('하락일 거래량' in t for t in r['reasons']))
        self.assertEqual(r['points'], 1)


class SourceSafetyTests(unittest.TestCase):
    def setUp(self):
        with open(SOURCE, encoding='utf-8') as f:
            self.src = f.read()

    def test_no_hardcoded_policy_values(self):
        for text in ('100만원', '최대 3종목', '종목당 최대 30만원', '10만원 유지'):
            self.assertNotIn(text, self.src)

    def test_page_has_no_order_endpoint_or_buy_sell_buttons(self):
        for text in ("'/api/order'", 'sell_market', 'buy_limit', '/api/sell', '/api/buy'):
            self.assertNotIn(text, self.src)
        # 허용된 POST는 정지·재개·감시·분석 전용·규칙 확인뿐
        posts = set()
        import re
        for m in re.finditer(r"['\"](/api/[a-z-]+)['\"]", self.src):
            posts.add(m.group(1))
        self.assertTrue(posts <= {'/api/status', '/api/watch', '/api/holdings', '/api/orders', '/api/events', '/api/analysis', '/api/stop',
                                  '/api/resume', '/api/unwatch', '/api/watch-confirm', '/api/analysis-remove'}, posts)

    def test_fill_is_never_claimed_complete(self):
        self.assertNotIn('체결 완료', self.src)
        self.assertIn('체결 확인 전', self.src)

    def test_dynamic_allocation_is_never_shown_as_applied_without_todays_engine_report(self):
        self.assertIn('아직 적용되지 않았습니다', self.src)
        self.assertIn("String(a.checked_at || '').slice(0, 10) !== today", self.src)   # 엔진 보고가 오늘 날짜일 때만 '적용 중'으로 표시

    def test_unknown_balance_is_not_rendered_as_zero(self):
        for text in ('조회 전', '확인 불가', '오래됨'):
            self.assertIn(text, self.src)


if __name__ == '__main__':
    unittest.main()
