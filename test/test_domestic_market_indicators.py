import os
import sys
import unittest
from unittest.mock import patch


ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import domestic_market_indicators as dmi
import kis_client


class DomesticMarketIndicatorsTest(unittest.TestCase):
    def test_normalises_minute_and_daily_candles(self):
        minute = dmi._sort_rows([
            {'ts': 100, 'openPrice': '-10', 'highPrice': '-12', 'lowPrice': '-9', 'currentPrice': '-11'},
            {'ts': 200, 'openPrice': '11', 'highPrice': '13', 'lowPrice': '10', 'currentPrice': '12'},
        ], minute=True)
        daily = dmi._sort_rows([
            {'dt': '20260812', 'open_pric': '+10', 'high_pric': '+12', 'low_pric': '+9', 'cur_prc': '+11'},
        ])
        self.assertEqual(minute[-1]['ts'], 200)
        self.assertEqual(minute[0]['open'], 10.0)
        self.assertEqual(minute[0]['low'], 9.0)
        self.assertEqual(daily[0]['date'], '2026-08-12')

    def test_chart_rows_can_be_limited_to_futures_lookback(self):
        rows = dmi._sort_rows([
            {'dt': '20250101', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
            {'dt': '20260801', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
        ], since_date='2026-01-01')
        self.assertEqual([row['date'] for row in rows], ['2026-08-01'])

    def test_kiwoom_provider_uses_cash_index_chart_ids(self):
        responses = {
            'ka20005': {'inds_min_pole_qry': [
                {'cntr_tm': '20260812090000', 'open_pric': '10', 'high_pric': '11', 'low_pric': '9', 'cur_prc': '10'},
                {'cntr_tm': '20260812090100', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
            ]},
            'ka20006': {'inds_dt_pole_qry': [
                {'dt': '20260811', 'open_pric': '10', 'high_pric': '11', 'low_pric': '9', 'cur_prc': '10'},
                {'dt': '20260812', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
            ]},
            'ka20007': {'inds_stk_pole_qry': [
                {'dt': '20260804', 'open_pric': '10', 'high_pric': '11', 'low_pric': '9', 'cur_prc': '10'},
                {'dt': '20260811', 'open_pric': '10', 'high_pric': '12', 'low_pric': '9', 'cur_prc': '11'},
            ]},
        }
        calls = []

        def call(_token, api_id, _path, body):
            calls.append((api_id, body))
            return responses[api_id]

        with patch.object(dmi.kiwoom_client, 'call_tr', side_effect=call):
            for interval in ('minute', 'day', 'week'):
                result = dmi._fetch_kiwoom('token', 'KOSPI', interval)
                self.assertEqual(len(result), 2)
        self.assertEqual([item[0] for item in calls], ['ka20005', 'ka20006', 'ka20007'])
        self.assertEqual(calls[0][1]['inds_cd'], '001')

    def test_investor_rows_are_named_for_ui(self):
        rows = dmi._normalise_investor({'rows': [
            {'label': '08.12', 'ind': 1, 'frgn': -2, 'orgn': 3},
        ]})
        self.assertEqual(rows[0], {'label': '08.12', 'individual': 1.0, 'foreign': -2.0, 'institution': 3.0})

    def test_kis_funds_uses_documented_query_key(self):
        with patch.object(kis_client, '_get_domestic_quote', return_value={'output': [{'bsop_date': '20260812'}]}) as request:
            rows = kis_client.fetch_market_funds('token', 'appkey', 'secret', date='20260812')
        self.assertEqual(rows, [{'bsop_date': '20260812'}])
        self.assertEqual(request.call_args.args[5], {'FID_INPUT_DATE_1': '20260812'})

    def test_kis_funds_uses_kst_query_date(self):
        with patch.object(dmi.kis_client, 'get_token', return_value='token') as token:
            with patch.object(dmi.kis_client, 'fetch_market_funds', return_value=[{
                'bsop_date': '20260812',
                'cust_dpmn_amt': '1',
            }]) as request:
                result = dmi._fetch_kis_funds('appkey', 'secret')
        self.assertTrue(result['available'])
        self.assertRegex(request.call_args.kwargs['date'], r'^\d{8}$')
        token.assert_called_once_with('appkey', 'secret')

    def test_normalises_documented_kis_market_funds_fields(self):
        rows = dmi._normalise_kis_funds([{
            'bsop_date': '20260812',
            'crdt_loan_rmnd': '12345',
            'cust_dpmn_amt': '67890',
        }, {
            'bsop_date': '20260811',
            'crdt_loan_rmnd': '12000',
            'cust_dpmn_amt': '67000',
        }])
        self.assertEqual(rows[-1], {
            'date': '2026-08-12',
            'credit': 12345.0,
            'market_funds': {'date': '2026-08-12', 'investor_deposits': 67890.0},
        })
        self.assertEqual([row['date'] for row in rows], ['2026-08-11', '2026-08-12'])

    def test_number_collapses_doubled_leading_minus(self):
        # ka90007 실측(2026-08-14)에서 순매도 값이 "--239707"처럼 부호가 겹쳐 내려왔다.
        self.assertEqual(dmi._number('--239707'), -239707.0)
        self.assertEqual(dmi._number('+50602'), 50602.0)
        self.assertEqual(dmi._number('-1'), -1.0)

    def test_program_trading_parses_real_kiwoom_response_shape(self):
        # 2026-08-14 VM 실측 원본 응답(코스피, mrkt_tp='0') 그대로.
        # program_trading_history는 실제 파일을 건드리므로(program_trading_history.json)
        # 단위 테스트에서는 패치해서 디스크에 아무것도 남기지 않는다.
        fake_history = {
            '2026-08-13': {'arbitrage': -100.0, 'nonArbitrage': 40.0, 'total': -60.0},
        }
        with patch.object(dmi.kiwoom_client, 'call_tr', return_value={
            'prm_trde_acc_trnsn': [{
                'dt': '20260814', 'kospi200': '+1084.97', 'basis': '1.53',
                'dfrt_trde_tdy': '--239707', 'dfrt_trde_acc': '--239707',
                'ndiffpro_trde_tdy': '+50602', 'ndiffpro_trde_acc': '+50602',
                'all_tdy': '--189105', 'all_acc': '--189105',
            }],
            'return_code': 0, 'return_msg': '정상적으로 처리되었습니다',
        }) as call_tr, \
             patch.object(dmi.program_trading_history, 'record') as record, \
             patch.object(dmi.program_trading_history, 'load', return_value=fake_history):
            result = dmi.fetch_program_trading('token')
        self.assertTrue(result['available'])
        self.assertEqual(result['arbitrage'], -239707.0)
        self.assertEqual(result['nonArbitrage'], 50602.0)
        self.assertEqual(result['total'], -189105.0)
        self.assertEqual(result['arbitrage'] + result['nonArbitrage'], result['total'])
        self.assertEqual(call_tr.call_args.args[1], 'ka90007')
        self.assertIn('date', call_tr.call_args.args[3])
        record.assert_called_once_with('2026-08-14', -239707.0, 50602.0, -189105.0)
        # load()를 고정된 fake_history로 패치해뒀으므로(record()는 no-op) 평균은
        # 그 안의 값(2026-08-13 하루치)만 반영한다 - 오늘 방금 기록한 값은 이 목(mock)
        # 구성상 반영되지 않는다(실제로는 record 후 load가 갱신된 파일을 읽는다).
        self.assertEqual(result['recentAverage']['arbitrage'], -100.0)
        self.assertIn('history', result)

    def test_program_trading_unavailable_without_token(self):
        result = dmi.fetch_program_trading(None)
        self.assertFalse(result['available'])

    def test_program_trading_retries_previous_business_day_when_today_is_empty(self):
        # 2026-08-14 밤 실사용 중 발견: date에 "오늘"(KST)을 그대로 넣다 보니 자정을
        # 넘긴 새벽·주말에는 그날 거래가 없어 빈 배열이 와서 카드가 통째로 안 떴다.
        # 여기서는 "오늘"을 토요일(2026-08-15)로 고정해두고, 토요일은 API를 부르지도
        # 않고 건너뛴 뒤 직전 영업일(금요일)에서 값을 찾아오는지 확인한다.
        import datetime as datetime_module

        class FixedDatetime(datetime_module.datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime_module.datetime(2026, 8, 15, 3, 0, tzinfo=tz)

        responses = {
            '20260814': {'prm_trde_acc_trnsn': [{
                'dt': '20260814', 'dfrt_trde_tdy': '-100', 'ndiffpro_trde_tdy': '+40', 'all_tdy': '-60',
            }]},
        }

        def call(token, api_id, path, body):
            return responses.get(body['date'], {'prm_trde_acc_trnsn': []})

        with patch.object(dmi, 'datetime', FixedDatetime), \
             patch.object(dmi.kiwoom_client, 'call_tr', side_effect=call) as call_tr, \
             patch.object(dmi.program_trading_history, 'record'), \
             patch.object(dmi.program_trading_history, 'load', return_value={}):
            result = dmi.fetch_program_trading('token')

        self.assertTrue(result['available'])
        self.assertEqual(result['date'], '2026-08-14')
        queried_dates = [c.args[3]['date'] for c in call_tr.call_args_list]
        self.assertNotIn('20260815', queried_dates)  # 토요일은 아예 호출하지 않는다
        self.assertEqual(queried_dates, ['20260814'])


if __name__ == '__main__':
    unittest.main()
