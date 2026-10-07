"""First-pullback structure, confirmation and common scanner integration."""
import json
import pathlib
import sys
import subprocess
import unittest
from datetime import date, timedelta
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'cloud-vm'))
import pattern_detect as pd


def sample():
    rows = []
    for i in range(75):
        close = 10000 + i * 20
        rows.append(dict(open=close - 10, high=close + 20, low=close - 20,
                         close=close, volume=100000))
    # Breakout, continued ascent, first quiet correction, then rebreak.
    for o, h, l, c, v in [
        (11500, 11900, 11480, 11880, 300000),
        (11880, 12100, 11860, 12080, 250000),
        (12060, 12080, 11900, 11940, 90000),
        (11940, 11980, 11850, 11900, 80000),
        (11900, 11960, 11880, 11930, 70000),
        (11940, 12120, 11920, 12100, 240000),
    ]:
        rows.append(dict(open=o, high=h, low=l, close=c, volume=v))
    for i, row in enumerate(rows):
        row['date'] = (date(2026, 1, 1) + timedelta(days=i)).isoformat()
    return rows


class FirstPullbackTests(unittest.TestCase):
    def test_confirmed_first_pullback_has_renderable_coordinates(self):
        result = pd.detect_first_pullback_breakout(sample())
        self.assertIsNotNone(result)
        self.assertEqual(result['pullbackDays'], 3)
        self.assertEqual(result['support'], 11850)
        self.assertEqual(result['resistance'], 12080)
        self.assertEqual(result['signal']['date'], sample()[-1]['date'])
        self.assertEqual(result['status'], 'BREAKOUT_CONFIRMED')
        self.assertGreater(result['score'], 80)

    def test_no_signal_before_rebreak(self):
        self.assertIsNone(pd.detect_first_pullback_breakout(sample()[:-1]))

    def test_weak_initial_breakout_is_rejected(self):
        rows = sample()
        rows[-6]['volume'] = 100000
        rows[-5]['volume'] = 100000
        self.assertIsNone(pd.detect_first_pullback_breakout(rows))

    def test_loud_correction_is_rejected(self):
        rows = sample()
        for row in rows[-4:-1]:
            row['volume'] = 300000
        self.assertIsNone(pd.detect_first_pullback_breakout(rows))

    def test_low_volume_rebreak_is_rejected(self):
        rows = sample()
        rows[-1]['volume'] = 100000
        self.assertIsNone(pd.detect_first_pullback_breakout(rows))

    def test_support_break_and_late_chase_are_rejected(self):
        for changes in ({'low': 11800}, {'close': 12600, 'high': 12650},
                        {'close': 12050}):
            rows = sample()
            rows[-1].update(changes)
            self.assertIsNone(pd.detect_first_pullback_breakout(rows))

    def test_previous_correction_during_ascent_is_rejected(self):
        rows = sample()
        rows[-5].update(close=11600, low=11580)
        self.assertIsNone(pd.detect_first_pullback_breakout(rows))

    def test_repeated_signal_after_breakout_is_rejected(self):
        rows = sample()
        row = dict(rows[-1], date='2026-04-01', open=12100, close=12150,
                   high=12170, low=12080)
        rows.append(row)
        self.assertIsNone(pd.detect_first_pullback_breakout(rows))

    def test_invalid_prices_and_short_history_are_rejected(self):
        self.assertIsNone(pd.detect_first_pullback_breakout(sample()[-20:]))
        rows = sample()
        rows[-1]['low'] = 0
        self.assertIsNone(pd.detect_first_pullback_breakout(rows))

    def test_common_cap_filter_and_snapshot_shape(self):
        for cap, expected in ((2999, 0), (3000, 1), (None, 0)):
            stock = dict(code='000001', name='테스트전자', market_cap_eok=cap)
            groups = {key: [] for key in ('risingLows', 'doubleBottom', 'invHeadShoulders', 'boxRangeLow')}
            pd.scan_stock(stock, sample(), groups, [], require_common_market_cap=True)
            matches = groups['firstPullbackBreakout']
            self.assertEqual(len(matches), expected)
            if matches:
                self.assertEqual(len(matches[0]['miniChart']), 20)
                self.assertIn('signal', matches[0]['patternDetail'])
                self.assertIn('interpretation', matches[0])

    def test_common_etf_filter(self):
        groups = {}
        pd.scan_stock(dict(code='000001', name='ETF', is_etf=True, market_cap_eok=5000),
                      sample(), groups, [], require_common_market_cap=True)
        self.assertEqual(groups['firstPullbackBreakout'], [])

    def test_common_ranking_and_quality_gates(self):
        groups = {'firstPullbackBreakout': [dict(code=str(i), score=80 if i < 20 else 100)
                                          for i in range(23)]}
        pd.finalize_pattern_results(groups)
        self.assertEqual(len(groups['firstPullbackBreakout']), 3)

    def test_public_api_exposes_existing_snapshot_without_rescan(self):
        import main
        item = pd.build_pattern_match(dict(code='000001', name='테스트전자'), sample(),
                                     pd.detect_first_pullback_breakout(sample()))
        with patch.object(main, 'load_daily_scan_cache_cached', return_value={
                'patternScan': {'patterns': {'firstPullbackBreakout': [item]}}}):
            self.assertEqual(main._build_pattern_scan()['patterns']['firstPullbackBreakout'], [item])

    def test_actual_javascript_tabs_and_chart_overlay(self):
        payload = json.dumps({'daily': sample(), 'detail': pd.detect_first_pullback_breakout(sample())})
        script = r'''
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let source = fs.readFileSync('js/pattern-scan.js', 'utf8');
source = source.replace('global.PatternScan =',
  'global.__test = {tabs:TABS, overlay:addPatternOverlay}; global.PatternScan =');
const context = {window:{}, document:{readyState:'loading', addEventListener(){}}, console};
vm.runInNewContext(source, context);
const api = context.window.__test;
assert.equal(api.tabs.find(t => t.key === 'pullback').label, '이평선 눌림');
assert.equal(api.tabs.filter(t => t.key === 'firstPullbackBreakout').length, 1);
const p = JSON.parse(fs.readFileSync(0, 'utf8'));
const lines = []; let markers = [];
const lwc = {LineSeries:{}, LineStyle:{Solid:0}, createSeriesMarkers(s,m){markers=m;}};
const chart = {addSeries(){return {setData(d){lines.push(d);}};}};
api.overlay(lwc, chart, {}, p.daily, 'firstPullbackBreakout', p.detail);
assert.equal(lines.length, 3); // ascent/pullback/rebreak, resistance, support
assert.equal(lines[0].length, 4);
assert.equal(lines[0][3].time, p.daily.at(-1).date);
assert.equal(lines[1][0].value, p.detail.resistance);
assert.equal(lines[2][0].value, p.detail.support);
assert.equal(markers.length, 3);
'''
        result = subprocess.run(['node', '-e', script], input=payload, text=True,
                                encoding='utf-8', cwd=ROOT, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
