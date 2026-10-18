import importlib.util
from pathlib import Path

path = Path(__file__).parents[1] / 'scripts/cloud-vm/kiwoom_9pay_observer.py'
spec = importlib.util.spec_from_file_location('observer', path)
module = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def test_candidates_bounded_and_unique():
    rows = [{'code': f'{i:06d}', 'price': 100, 'trade_volume': i + 1,
             'trade_amount': (40 - i) * 100} for i in range(40)]
    out = module.candidates(rows, limit=30)
    assert len(out) <= 30
    assert len({r['code'] for r in out}) == len(out)
    assert rows[-1]['code'] in {r['code'] for r in out}


def test_amount_rank_uses_official_fields_and_union():
    calls = []
    def call(token, api, path, body):
        calls.append((api, body))
        return {'trde_prica_upper': [{'stk_cd': '005930_AL', 'stk_nm': 'A',
                'cur_prc': '+100', 'now_trde_qty': '1,000', 'trde_prica': '200'}]}
    amount = module.fetch_amount_top(call, 'dummy')
    assert calls == [('ka10032', {'mrkt_tp': '000', 'mang_stk_incls': '0', 'stex_tp': '3'})]
    assert amount[0]['code'] == '005930'
    assert '005930' in {r['code'] for r in module.candidates(
        [{'code': '000001', 'price': 100, 'trade_volume': 100}], amount, limit=2)}


from datetime import datetime
import pytest


def ts(hhmmss):
    return datetime.fromisoformat('2026-10-19T' + hhmmss + '+09:00').timestamp()


def observer(b=False):
    context = {'005930': {'prevClose': 99, 'lows': [90, 95],
                          'lowDates': ['2026-10-15', '2026-10-16']}} if b else {}
    return module.Observer(['005930'], {'005930': 1000}, context)


def feed(o, stamp, price, vol, **kwargs):
    return o.observe('005930', ts(stamp), price, vol, **kwargs)


def qualify(o):
    feed(o, '09:00:00', 100, 100, open_price=100)
    return feed(o, '09:01:00', 110, 800)


def test_a_only_requires_70_and_rebreak_not_three_percent():
    o = observer()
    feed(o, '09:00:00', 100, 100)
    assert feed(o, '09:00:30', 105, 135)['stage'] == 'watch'
    result = feed(o, '09:01:00', 110, 800)
    assert result['first70At'] == ts('09:01:00') and not result['priority80']
    assert feed(o, '09:02:00', 108, 810)['stage'] == 'pullback'
    result = feed(o, '09:03:00', 111, 820)
    assert result['signal'] and result['branches'] == ['A']
    assert not feed(o, '09:04:00', 112, 830)['signal']


@pytest.mark.parametrize('stamp,passed', [('09:29:59', True), ('09:30:00', False)])
def test_deadline_boundary(stamp, passed):
    o = observer()
    feed(o, '09:00:00', 100, 0)
    result = feed(o, stamp, 110, 700)
    assert bool(result['first70At']) is passed
    assert bool(result['excluded']) is not passed


def test_no_backdating_on_delayed_poll_or_late_first_discovery():
    o = observer()
    feed(o, '09:00:00', 100, 0)
    result = feed(o, '09:29:30', 110, 800, received_at=ts('09:30:01'))
    assert result['excluded'] and result['first70At'] is None
    late = observer()
    result = feed(late, '09:31:00', 110, 900)
    assert result['first70At'] is None


def test_80_priority_and_afternoon_monitoring():
    o = observer()
    qualify(o)
    assert feed(o, '09:29:59', 112, 900)['priority80']
    feed(o, '13:00:00', 110, 1100)
    result = feed(o, '13:01:00', 113, 1200)
    assert result['signal'] and result['first70At'] == ts('09:01:00')


def test_b_rebounds_without_high_rebreak():
    o = observer(True)
    qualify(o)
    feed(o, '09:02:00', 107, 810)
    result = feed(o, '09:03:00', 107.5, 820)
    assert result['signal'] and result['branches'] == ['B']
    assert result['price'] < result['peak']


def test_a_or_b_simultaneous_is_single_event_and_restores():
    o = observer(True)
    qualify(o)
    feed(o, '09:02:00', 107, 810)
    result = feed(o, '09:03:00', 111, 820)
    assert result['branches'] == ['A', 'B'] and result['signal']
    restored = observer(True)
    assert restored.restore_state(o.export_state('2026-10-19'), '2026-10-19')
    assert not feed(restored, '09:04:00', 112, 830)['signal']
    assert not restored.restore_state(o.export_state('2026-10-19'), '2026-10-20')


def test_missing_volume_context_and_source_switch_fail_closed():
    o = observer()
    assert feed(o, '09:00:00', 100, None)['volumeMissing']
    feed(o, '09:01:00', 105, 100)
    result = feed(o, '09:02:00', 110, 10000, source='KIS rank polling')
    assert result['volumeRatio'] == 0 and result['first70At'] is None
    empty = module.Observer(['005930'], {})
    assert feed(empty, '09:01:00', 110, 1000)['volumeMissing']


def test_b_support_failure_does_not_block_independent_a():
    o = observer(True)
    qualify(o)
    feed(o, '09:02:00', 99, 810)
    assert not feed(o, '09:03:00', 100, 820)['signal']
    result = feed(o, '09:04:00', 111, 830)
    assert result['signal'] and result['branches'] == ['A']


def test_80_first_observed_after_deadline_is_not_priority():
    o = observer()
    qualify(o)
    result = feed(o, '09:30:00', 111, 900)
    assert result['first70At'] and not result['priority80']


def test_second_pullback_cannot_be_relabelled_first():
    o = observer()
    qualify(o)
    feed(o, '09:02:00', 107, 810)
    feed(o, '09:03:00', 108, 820)
    result = feed(o, '09:04:00', 106, 830)
    assert result['entryInvalid']
    assert not feed(o, '09:05:00', 112, 840)['signal']
