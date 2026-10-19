import os
import sys
import unittest
import urllib.error
from datetime import date
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))
import us_analysis


class ProvenanceTests(unittest.TestCase):
    def row(self, code='P', change=100, derivative=False, **extra):
        row = {'name': 'Synthetic insider', 'transactionCode': code, 'change': change,
               'transactionDate': '2026-10-01', 'filingDate': '2026-10-03',
               'transactionPrice': 10, 'isDerivative': derivative,
               'id': '0000050863-26-000177', 'source': 'sec'}
        return dict(row, **extra)

    def summarize(self, rows):
        return us_analysis._insider_summary({'data': rows}, date(2026, 10, 20), issuer_cik=50863)

    def test_only_nonderivative_p_s_enter_buy_sell_and_deduplicate(self):
        rows = [self.row(), self.row(), self.row('S', -20), self.row('M', 50),
                self.row('A', 40), self.row('F', -5), self.row('P', 10, True)]
        result = self.summarize(rows)
        self.assertEqual((result['buy_shares'], result['sell_shares']), (100, 20))
        self.assertEqual((result['buy_count'], result['sell_count'], result['other_count']), (1, 1, 4))
        self.assertEqual(len(result['items']), 6)
        self.assertIn('/50863/', result['items'][0]['source_url'])
        self.assertIsNone(result['items'][0]['currency'])

    def test_90_day_window_future_filing_and_missing_dates(self):
        result = self.summarize([
            self.row(transactionDate='2026-07-22'),
            self.row(transactionDate='2026-07-23'),
            self.row(transactionDate='2026-10-21'),
            self.row(filingDate='2026-10-21'),
            self.row(transactionDate=None),
        ])
        self.assertEqual(result['buy_count'], 1)
        self.assertEqual(result['missing_dates'], 1)
        self.assertEqual((result['from'], result['to']), ('2026-07-23', '2026-10-20'))

    def test_unknown_derivative_and_missing_quantity_not_counted(self):
        result = self.summarize([self.row(derivative=None), self.row(change=None)])
        self.assertEqual(result['buy_count'], 0)
        self.assertEqual(result['other_count'], 2)

    def test_unavailable_is_distinct_from_empty(self):
        self.assertFalse(us_analysis._insider_summary({})['available'])
        self.assertTrue(self.summarize([])['available'])

    def test_sec_link_uses_issuer_cik_not_agent_accession_prefix(self):
        row = self.row(id='0001140361-26-039785')
        result = us_analysis._insider_summary({'data':[row]}, date(2026,10,20), issuer_cik=320193)
        self.assertIn('/data/320193/000114036126039785/', result['items'][0]['source_url'])
        unknown = us_analysis._insider_summary({'data':[row]}, date(2026,10,20))
        self.assertIsNone(unknown['items'][0]['source_url'])

    def test_access_denied_is_explicit_and_does_not_invent_firms(self):
        error = urllib.error.HTTPError('redacted', 403, 'Forbidden', {}, None)
        with patch.object(us_analysis, '_get_json', side_effect=error):
            result = us_analysis._analyst_ratings('INTC', 'test', date(2026, 10, 20))
        self.assertEqual(result['status'], 'access_denied')
        self.assertFalse(result['available'])
        self.assertEqual(result['items'], [])

    def test_available_firm_events_keep_original_grade_and_monthly_source(self):
        rows = [{'company': 'Synthetic firm', 'fromGrade': 'Sell', 'toGrade': 'Hold', 'gradeTime': 1792368000}]
        with patch.object(us_analysis, '_get_json', return_value=rows):
            result = us_analysis._analyst_ratings('INTC', 'test', date(2026, 10, 20))
        self.assertEqual(result['items'][0]['company'], 'Synthetic firm')
        summary = us_analysis._build_summary({'symbol': 'INTC', 'recommendations': [{'period':'2026-09-01','buy':15,'strongBuy':4,'hold':34,'sell':2}]})
        self.assertEqual(summary['recommendation']['period'], '2026-09-01')
        self.assertEqual(summary['recommendation']['source_url'], 'https://widget.finnhub.io/widgets/recommendation?symbol=INTC')


if __name__ == '__main__':
    unittest.main()
