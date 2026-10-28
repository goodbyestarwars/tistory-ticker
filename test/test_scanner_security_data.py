"""Official instrument flag parsing, independent of names or market feeds."""
import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('scanner_security', Path(__file__).resolve().parents[1] / 'scripts/build_scanner_security_data.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def row(market, code, flag, name='합성종목', group='ST'):
    tail, offset = module.LAYOUTS[market]
    fields = list(' ' * (tail-1))
    fields[:2] = group
    fields[offset] = flag
    return code.ljust(9)+'KR7000000000'+name.ljust(40)+''.join(fields)+'\n'


@pytest.mark.parametrize('market', ['KOSPI', 'KOSDAQ'])
def test_explicit_flag_overrides_name(market):
    data = row(market,'399999','Y','이름에 표기 없음')+row(market,'377777','N','스팩트럼')
    assert module.parse_master(data, market) == {'399999': True, '377777': False}
    assert module.parse_master(data.replace('\n','\r\n'), market) == {'399999': True, '377777': False}
    assert module.parse_master(row(market,'333333','Y',group='EF'),market) == {}


@pytest.mark.parametrize('market', ['KOSPI', 'KOSDAQ'])
def test_fail_closed_preserves_snapshot(market):
    for data in ['truncated\n',row(market,'399999','?'),row(market,'399999','Y')*2]:
        with pytest.raises(ValueError):
            module.parse_master(data,market)
