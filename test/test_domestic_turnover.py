import sys
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import patch
import pytest
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/cloud-vm'))
import domestic_turnover as m

NOW = datetime(2026, 10, 28, 14, 35, tzinfo=m.KST)


def rows(now=NOW, slot='140000'):
    day=now.date()
    output=[]
    for i in range(6):
        output.append({'stck_bsop_date':day.strftime('%Y%m%d'),'stck_cntg_hour':slot,'acml_tr_pbmn':'11000000' if i==0 else '10000000'})
        day=m.market_clock.prev_kr_trading_day(day)
    return output


def test_actual_cumulative_amount_same_clock_five_prior_days_and_units():
    data=rows()
    data.append({'stck_bsop_date':'20261028','stck_cntg_hour':'143000','acml_tr_pbmn':'99999999'})
    r=m.parse_turnover(data,NOW)
    assert r['status']=='ok' and r['index100']==pytest.approx(110)
    assert r['current']==11000000000000 and r['baseline']==10000000000000
    assert r['asOf']=='2026-10-28T14:30:00+09:00'
    assert r['baselineDates']==['2026-10-27','2026-10-26','2026-10-23','2026-10-22','2026-10-21']
    assert r['sampleDays']==5 and r['market']=='KRX' and r['unit']=='KRW'


@pytest.mark.parametrize('bad',[None,'',True,'NaN','Infinity','-1'])
def test_missing_or_invalid_denominator_is_not_zero(bad):
    data=rows();data[1]['acml_tr_pbmn']=bad
    assert m.parse_turnover(data,NOW)['index100'] is None


def test_missing_day_or_wrong_clock_cannot_substitute_daily_total():
    data=rows();data[1]['stck_cntg_hour']='153000'
    assert m.parse_turnover(data,NOW)['status']=='unavailable'
    assert m.parse_turnover(rows()[1:],NOW)['current'] is None
    data=rows();data.append(data[1].copy())
    assert m.parse_turnover(data,NOW)['reason']=='duplicate-observation'


@pytest.mark.parametrize('current,index', [('0',0),('5000000',50),('10000000',100),('20000000',200)])
def test_actual_zero_and_index_values(current,index):
    data=rows();data[0]['acml_tr_pbmn']=current
    assert m.parse_turnover(data,NOW)['index100']==index


def test_opening_grace_period_and_closing_auction():
    assert m.parse_turnover(rows(),NOW.replace(hour=9,minute=31))['reason']=='first-completed-bar-pending'
    start=NOW.replace(hour=9,minute=32)
    assert m.parse_turnover(rows(start,'090000'),start)['asOf'].endswith('09:30:00+09:00')
    close=NOW.replace(hour=15,minute=32)
    assert m.parse_turnover(rows(close,'153000'),close)['asOf'].endswith('15:30:00+09:00')


def test_weekend_preserves_previous_session_date():
    saturday=NOW.replace(day=31,hour=12)
    friday=NOW.replace(day=30,hour=16)
    result=m.parse_turnover(rows(friday,'153000'),saturday)
    assert result['status']=='ok' and result['asOf']=='2026-10-30T15:30:00+09:00'


@pytest.mark.parametrize('hour,minute', [(15,32),(19,0),(23,59)])
def test_after_close_keeps_final_session_amount(hour, minute):
    now = NOW.replace(hour=hour, minute=minute)
    result = m.parse_turnover(rows(NOW, '153000'), now)
    assert result['status'] == 'ok' and result['index100'] == pytest.approx(110)
    assert result['sessionClosed'] is True
    assert result['asOf'] == '2026-10-28T15:30:00+09:00'


def test_before_open_keeps_previous_close_and_date():
    now = NOW.replace(day=29, hour=8, minute=30)
    result = m.parse_turnover(rows(NOW, '153000'), now)
    assert result['status'] == 'ok' and result['sessionClosed'] is True
    assert result['asOf'] == '2026-10-28T15:30:00+09:00'


def test_changed_session_hours_do_not_mix():
    with patch.object(m.market_clock,'kr_session_minutes',side_effect=lambda d:(600,990) if d.isoformat()=='2026-10-27' else (540,930)):
        assert m.parse_turnover(rows(),NOW)['reason']=='session-hours-mismatch'


def test_provider_wrapper_one_bounded_page_and_no_orders():
    with patch.object(m.kis_client,'_get_domestic_quote',return_value={'output2':[{'x':1}]}) as get:
        assert m.kis_client.fetch_index_turnover_chart('t','a','s','1001')==[{'x':1}]
        assert get.call_count==1
        assert get.call_args.args[3].endswith('/inquire-time-indexchartprice')
        assert get.call_args.args[4]=='FHKUP03500200'
        assert get.call_args.args[5]['FID_ETC_CLS_CODE']=='1'
        assert get.call_args.args[5]['FID_INPUT_HOUR_1']=='1800'


def test_provider_failure_never_exposes_exception_or_secrets():
    with patch.dict(m.os.environ,{'KIS_APPKEY':'a','KIS_APPSECRET':'s'}),patch.object(m.kis_client,'get_token',side_effect=RuntimeError('secret payload')):
        assert m.fetch_turnover('KOSPI',NOW.timestamp())=={'status':'unavailable','reason':'provider-error'}
