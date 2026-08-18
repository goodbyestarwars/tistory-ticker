import os
import sqlite3
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import db_schema
import backtest_swing
import swing_model
import weekly_report


def bars(values):
    return [
        {'date': '2026-01-%02d' % ((index % 28) + 1), 'open': value,
         'high': value * 1.01, 'low': value * .99, 'close': value, 'volume': 100}
        for index, value in enumerate(values)
    ]


class SwingModelTests(unittest.TestCase):
    def test_rising_trend_never_outputs_reduce_or_sell(self):
        assessment = swing_model.build_swing_assessment(
            bars([100 + index for index in range(260)]), flow_score=80,
            foreign_inst_score=75, fundamental_score=70,
        )
        self.assertEqual(assessment['chartRegime']['key'], 'uptrend')
        self.assertNotIn('비중축소', assessment['holderAction'])
        self.assertNotIn('매도', assessment['holderAction'])
        self.assertNotIn('매도', assessment['entryOpinion'])

    def test_v_rebound_is_detection_or_confirmation_not_reduce(self):
        assessment = swing_model.build_swing_assessment(
            bars([220 - index * 1.2 for index in range(70)] + [136 + index * 2 for index in range(30)]),
            flow_score=70, foreign_inst_score=65,
        )
        self.assertIn(assessment['chartRegime']['key'], ('upturn', 'uptrend'))
        self.assertNotIn('비중축소', assessment['holderAction'])

    def test_downside_turn_cannot_be_a_buy_candidate(self):
        assessment = swing_model.build_swing_assessment(
            bars([100 + index * .8 for index in range(70)] + [156 - index * 2 for index in range(30)]),
            flow_score=80, foreign_inst_score=80,
        )
        self.assertIn(assessment['chartRegime']['key'], ('downturn', 'downtrend'))
        self.assertNotIn('매수 후보', assessment['entryOpinion'])

    def test_downtrend_cannot_be_a_new_buy_candidate(self):
        assessment = swing_model.build_swing_assessment(
            bars([200 - index * 1.5 for index in range(100)]), flow_score=90,
            foreign_inst_score=90, fundamental_score=90,
        )
        self.assertEqual(assessment['currentRegime']['key'], 'downtrend')
        self.assertNotIn('매수 후보', assessment['entryOpinion'])

    def test_downside_exhaustion_remains_observe_only(self):
        assessment = swing_model.build_swing_assessment(
            bars([200 - index * 1.5 for index in range(90)] + [66.5] * 10),
        )
        self.assertEqual(assessment['currentRegime']['key'], 'downtrend')
        self.assertIn('exhaustion', [item['key'] for item in assessment['auxiliaryStates']])
        self.assertNotIn('매수 후보', assessment['entryOpinion'])

    def test_fake_breakout_and_breakdown_cancel_the_previous_signal(self):
        for values, event_key in (
            ([100] * 77 + [115, 105, 100], 'fake_breakout'),
            ([100] * 77 + [85, 95, 100], 'fake_breakdown'),
        ):
            assessment = swing_model.build_swing_assessment(bars(values))
            self.assertEqual(assessment['recentEvent']['key'], event_key)
            self.assertEqual(assessment['entryOpinion'], '관찰')

    def test_current_regime_and_recent_event_are_separate_and_auxiliary_is_bounded(self):
        assessment = swing_model.build_swing_assessment(bars([100 + index for index in range(100)]))
        self.assertIn(assessment['currentRegime']['key'], ('uptrend', 'neutral', 'downtrend'))
        self.assertIn('recentEvent', assessment)
        self.assertLessEqual(len(assessment['auxiliaryStates']), 2)

    def test_risk_warning_blocks_new_entry_even_with_high_legacy_score(self):
        assessment = swing_model.build_swing_assessment(
            bars([100 + index for index in range(260)]), flow_score=95,
            foreign_inst_score=95, fundamental_score=95, short_score=10,
            entry={'short': {'pressure': {'score': 10, 'danger_gate': {'triggered': True}}}},
            legacy={'score': 98, 'stars': 5, 'label': '적극 매수'},
        )
        self.assertTrue(assessment['risk']['blocksEntry'])
        self.assertEqual(assessment['entryOpinion'], '신규 진입 금지')

    def test_holder_and_non_holder_actions_are_separate(self):
        assessment = swing_model.build_swing_assessment(bars([100 + index for index in range(260)]))
        self.assertIn('보유', assessment['holderAction'])
        self.assertNotEqual(assessment['holderAction'], '보유')
        self.assertIn('후보', assessment['entryOpinion'])

    def test_224_is_preserved_as_context(self):
        assessment = swing_model.classify_chart_regime(bars([100 + index for index in range(260)]))
        self.assertIsNotNone(assessment['ma']['ma224'])
        self.assertIn('224일선은 장기 추세 참고값', ' '.join(assessment['reasons']))

    def test_weekly_candidates_use_swing_scan_and_do_not_fallback_to_us_or_board_rank(self):
        scan = {'candidates': [{
            'code': '005930', 'name': '삼성전자', 'price': 70000, 'changeRate': 1.2,
            'swing': {
                'chartRegime': {'key': 'upturn', 'label': '상방 변곡', 'turningPoint': 'confirmed', 'invalidation': '20일선 회복 실패'},
                'waves': {
                    'big': {'key': 'uptrend', 'label': '상승 추세', 'available': True},
                    'mid': {'key': 'uptrend', 'label': '상승 추세', 'available': True},
                    'small': {'key': 'uptrend', 'label': '상승 추세', 'available': True},
                    'diagnosis': '장기·중기·단기 추세 정렬',
                },
                'momentum': {'state': '강화'}, 'fundamental': {'state': '지지'},
                'risk': {'state': '없음', 'blocksEntry': False},
                'entryOpinion': '초기 매수 후보', 'holderAction': '보유 / 강제 비중축소 금지',
                'internalPriorityScore': 90,
            },
        }]}
        result = weekly_report.build_report(
            __import__('datetime').date(2026, 8, 10), __import__('datetime').date(2026, 8, 14),
            futures_rows=[], domestic_board={'sections': {'rising': [{'code': 'BAD', 'name': '순위만', 'change_rate': 99}]}},
            us_board={'sections': {'rising': [{'code': 'US:A', 'name': '미국', 'change_rate': 99}]}},
            domestic_swing_scan=scan,
        )
        self.assertEqual([item['code'] for item in result['hotCandidates']['domestic']], ['005930'])
        self.assertEqual(result['hotCandidates']['us'], [])
        self.assertEqual(result['coldCandidates']['domestic'], [])

    def test_backtest_alternative_has_deterministic_46_stock_universe_and_no_fake_result(self):
        self.assertEqual(len(backtest_swing.load_46_universe()), 46)
        result = backtest_swing.run(db_file=os.path.join(os.path.dirname(__file__), 'missing-ohlc.db'))
        self.assertEqual(result['status'], 'data unavailable')
        self.assertEqual(len(result['universe']), 46)

    def test_snapshot_schema_and_upsert_preserve_legacy_for_comparison(self):
        conn = sqlite3.connect(':memory:')
        db_schema.create_schema(conn)
        assessment = swing_model.build_swing_assessment(bars([100 + index for index in range(260)]), legacy={'score': 77, 'stars': 4, 'label': '매수 우위'})
        db_schema.upsert_swing_snapshot(conn, {
            'asOfDate': '2026-08-14', 'code': '005930', 'name': '삼성전자', 'close': 70000,
            'createdAt': '2026-08-14T08:00:00Z', **assessment,
        })
        row = conn.execute('SELECT chart_regime, current_regime, recent_event, auxiliary_states_json, big_wave, mid_wave, small_wave, wave_diagnosis, wave_events_json, holder_action, entry_opinion, legacy_score, ma224 FROM swing_recommendation_snapshots').fetchone()
        self.assertEqual(row[0], 'uptrend')
        self.assertEqual(row[1], 'uptrend')
        self.assertTrue(row[2])
        self.assertIsNotNone(row[3])
        self.assertEqual(row[9], '보유 / 추가매수 검토')
        self.assertEqual(row[11], 77)
        self.assertIsNotNone(row[12])
        self.assertEqual(row[4:8], ('uptrend', 'uptrend', 'uptrend', '장기·중기·단기 추세 정렬'))
        self.assertIsNotNone(row[8])
        conn.close()

    def test_big_mid_down_small_upturn_forbids_new_entry(self):
        base = [220 - index * .45 for index in range(280)]
        last = base[-1]
        values = base + [last - index * .2 for index in range(15)] + [last - 14 * .2 + index * 5 for index in range(5)]
        assessment = swing_model.build_swing_assessment(bars(values))
        self.assertEqual(assessment['waves']['big']['key'], 'downtrend')
        self.assertEqual(assessment['waves']['mid']['key'], 'downtrend')
        self.assertEqual(assessment['waves']['small']['key'], 'uptrend')
        self.assertEqual(assessment['diagnosis'], '하락 추세 안의 기술적 반등')
        self.assertEqual(assessment['entryOpinion'], '신규 진입 금지')

    def test_big_mid_up_small_resume_is_a_pullback_candidate(self):
        values = [100 + index * .4 for index in range(300)]
        assessment = swing_model.build_swing_assessment(bars(values))
        self.assertEqual(assessment['waves']['big']['key'], 'uptrend')
        self.assertEqual(assessment['waves']['mid']['key'], 'uptrend')
        self.assertEqual(assessment['waves']['small']['key'], 'uptrend')
        self.assertEqual(assessment['diagnosis'], '장기·중기·단기 추세 정렬')
        self.assertEqual(assessment['entryOpinion'], '눌림목 매수 후보')

    def test_big_up_mid_down_small_upturn_waits_for_mid_confirmation(self):
        values = [100 + index * .5 for index in range(230)]
        values += [values[-1] - index * .6 for index in range(35)]
        values += [values[-1] + index * 1 for index in range(15)]
        assessment = swing_model.build_swing_assessment(bars(values))
        self.assertEqual(assessment['waves']['big']['key'], 'uptrend')
        self.assertEqual(assessment['waves']['mid']['key'], 'downtrend')
        self.assertEqual(assessment['waves']['small']['key'], 'uptrend')
        self.assertEqual(assessment['entryOpinion'], '중기 확인 대기')

    def test_big_wave_is_unavailable_before_224_trading_days(self):
        assessment = swing_model.build_swing_assessment(bars([100 + index for index in range(223)]))
        self.assertFalse(assessment['waves']['big']['available'])
        self.assertEqual(assessment['waves']['big']['label'], '장기 데이터 부족')
        self.assertNotIn('매수 후보', assessment['entryOpinion'])

    def test_snapshot_stores_all_wave_layers_and_recent_events(self):
        assessment = swing_model.build_swing_assessment(bars([100 + index * .4 for index in range(300)]))
        conn = sqlite3.connect(':memory:')
        db_schema.create_schema(conn)
        db_schema.upsert_swing_snapshot(conn, {
            'asOfDate': '2026-08-14', 'code': '005930', 'name': '삼성전자',
            'close': 220, 'createdAt': '2026-08-14T08:00:00Z', **assessment,
        })
        row = conn.execute('SELECT big_wave, mid_wave, small_wave, wave_diagnosis, wave_events_json FROM swing_recommendation_snapshots').fetchone()
        self.assertEqual(row[:4], ('uptrend', 'uptrend', 'uptrend', '장기·중기·단기 추세 정렬'))
        self.assertIsNotNone(row[4])
        conn.close()

    def test_short_signal_reports_five_day_average_recovery(self):
        values = [100] * 23 + [90, 102]
        assessment = swing_model.build_swing_assessment(bars(values))
        self.assertEqual(assessment['shortSignal']['key'], 'ma5_recovery')
        self.assertEqual(assessment['shortSignal']['label'], '5일선 회복')
        self.assertEqual(assessment['waves']['shortSignal']['key'], 'ma5_recovery')


if __name__ == '__main__':
    unittest.main()
