import importlib.util
from pathlib import Path

path = Path(__file__).parents[1] / 'scripts/research/kiwoom_9pay_observer.py'
spec = importlib.util.spec_from_file_location('observer', path)
module = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def test_candidates_bounded_and_unique():
    rows = [{'code': f'{i:06d}', 'price': 100, 'trade_volume': i + 1,
             'trade_amount': (40 - i) * 100} for i in range(40)]
    out = module.candidates(rows, 30)
    assert len(out) <= 30
    assert len({r['code'] for r in out}) == len(out)
    assert rows[-1]['code'] in {r['code'] for r in out}


def test_signal_requires_volume_and_first_pullback():
    o = module.Observer(['005930'], {'005930': 1000})
    assert o.observe('005930', 0, 100, None)['volumeMissing']
    assert o.observe('005930', 10, 102, 100)['stage'] == 'watch'
    assert o.observe('005930', 20, 104, 135)['stage'] == 'surge'
    assert o.observe('005930', 30, 102, 140)['stage'] == 'pullback'
    result = o.observe('005930', 40, 105, 145)
    assert result['signal'] and result['stage'] == 'signaled'
    result = o.observe('005930', 50, 100, 150)
    assert result['maePct'] < 0 and not result['signal']


def test_no_signal_without_verified_volume_or_previous_day():
    o = module.Observer(['005930'], {})
    for at, price in enumerate((100, 105, 102, 106)):
        result = o.observe('005930', at * 10, price, None)
    assert not result['signal'] and result['volumeMissing']
