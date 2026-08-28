# -*- coding: utf-8 -*-
import os
import sys
import unittest
from unittest import mock

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import invest_opinion  # noqa: E402


def _report(date, opinion, target_price, prev_close='0'):
    # KIS invest_opinion 응답 필드명 그대로(공식 예제 chk_invest_opinion.py COLUMN_MAPPING 참고).
    return {
        'stck_bsop_date': date,
        'invt_opnn': opinion,
        'hts_goal_prc': target_price,
        'stck_prdy_clpr': prev_close,
    }


class SummarizeOpinionsTests(unittest.TestCase):
    def test_no_reports_returns_unavailable(self):
        result = invest_opinion.summarize_opinions([])
        self.assertEqual(result, {'available': False, 'reportCount': 0})

    def test_averages_target_price_and_counts_buckets(self):
        rows = [
            _report('20260501', '매수', '80000'),
            _report('20260601', '매수', '90000'),
            _report('20260701', '중립', '0'),  # 목표가 0은 유효값이 아니라 평균에서 제외
        ]
        result = invest_opinion.summarize_opinions(rows)
        self.assertTrue(result['available'])
        self.assertEqual(result['reportCount'], 3)
        self.assertEqual(result['buyCount'], 2)
        self.assertEqual(result['holdCount'], 1)
        self.assertEqual(result['sellCount'], 0)
        self.assertEqual(result['avgTargetPrice'], 85000)  # (80000+90000)/2
        self.assertEqual(result['targetPriceSamples'], 2)
        self.assertEqual([row['date'] for row in result['reports']], ['20260701', '20260601', '20260501'])
        self.assertFalse(result['originalReportLinksAvailable'])
        self.assertEqual(result['sourceTrId'], 'FHKST663300C0')

    def test_target_price_uses_median_so_one_stale_outlier_report_cannot_skew_it(self):
        # 2026-08-23: strategy_scan.py 섹터 평균 PER/PBR 버그(산술평균이 이상치 하나에
        # 끌려간 사건) 이후 같은 위험(여러 값의 산술평균)이 있는 다른 계산도 점검하다가
        # 여기서도 같은 패턴을 발견해 미리 방어했다 - 액면분할 등으로 스케일이 다른
        # 옛 리포트 목표가가 하나 섞여도 중앙값이면 결과가 휘둘리지 않아야 한다.
        rows = [
            _report('20260501', '매수', '90000'),
            _report('20260601', '매수', '95000'),
            _report('20260701', '매수', '100000'),
            _report('20260801', '매수', '900000'),  # 분할 전 스케일이 남은 이상치 리포트
        ]
        result = invest_opinion.summarize_opinions(rows)
        # 산술평균이었다면 (90000+95000+100000+900000)/4 = 296250으로 튀었을 것.
        # 중앙값(95000, 100000의 평균인 97500)은 이상치 하나에 흔들리지 않는다.
        self.assertEqual(result['avgTargetPrice'], 97500)

    def test_latest_report_is_the_most_recent_date_not_last_in_input_order(self):
        # 입력 순서가 날짜순이 아닐 수 있다고 보고 direct 정렬로 최신을 골라야 한다.
        rows = [
            _report('20260701', '매도', '70000'),
            _report('20260301', '매수', '95000'),
        ]
        result = invest_opinion.summarize_opinions(rows)
        self.assertEqual(result['latestOpinion'], '매도')
        self.assertEqual(result['latestDate'], '20260701')

    def test_unrecognized_opinion_text_falls_into_other_bucket(self):
        rows = [_report('20260701', '모니터링', '50000')]
        result = invest_opinion.summarize_opinions(rows)
        self.assertEqual(result['otherCount'], 1)
        self.assertEqual(result['buyCount'], 0)

    def test_blank_opinion_rows_are_skipped_entirely(self):
        rows = [_report('20260701', '', '50000'), _report('20260601', '매수', '60000')]
        result = invest_opinion.summarize_opinions(rows)
        self.assertEqual(result['reportCount'], 1)
        self.assertEqual(result['buyCount'], 1)


class DateRangeTests(unittest.TestCase):
    def test_recent_date_range_spans_roughly_three_months(self):
        import datetime
        today = datetime.datetime(2026, 8, 23, tzinfo=invest_opinion.KST)
        date1, date2 = invest_opinion.recent_date_range(months=3, today=today)
        self.assertEqual(date2, '20260823')
        self.assertEqual(date1, '20260525')  # 2026-08-23 - 90일


class FetchRecentOpinionSummaryTests(unittest.TestCase):
    def test_delegates_to_kis_client_and_summarizes(self):
        fake_kis_client = mock.Mock()
        fake_kis_client.fetch_invest_opinion.return_value = [_report('20260701', '매수', '80000')]
        result = invest_opinion.fetch_recent_opinion_summary(
            fake_kis_client, 'token', 'appkey', 'appsecret', '005930')
        self.assertTrue(result['available'])
        self.assertEqual(result['buyCount'], 1)
        fake_kis_client.fetch_invest_opinion.assert_called_once()
        args = fake_kis_client.fetch_invest_opinion.call_args[0]
        self.assertEqual(args[:4], ('token', 'appkey', 'appsecret', '005930'))


if __name__ == '__main__':
    unittest.main()
