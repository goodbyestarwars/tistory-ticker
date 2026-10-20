import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'cloud-vm'))
import batch_scan  # noqa: E402
import dart_client  # noqa: E402
import fundamentals  # noqa: E402


def filing(no, year=2026, month=6, code='11012'):
    return {'year': year, 'month': month, 'reprt_code': code, 'rcept_no': no, 'rcept_dt': no[:8]}


def bs(fs='CFS', parent=300.0):
    rows = [{'sj_div': 'BS', 'account_id': 'ifrs-full_Equity', 'account_nm': '자본총계', 'thstrm_amount': '400', 'fs_div': fs}]
    if fs == 'CFS' and parent is not None:
        rows.append({'sj_div': 'BS', 'account_id': 'ifrs-full_EquityAttributableToOwnersOfParent',
                     'account_nm': '지배기업 소유주지분', 'thstrm_amount': str(parent), 'fs_div': fs})
    return rows


SHARES = [{'se': '보통주', 'istc_totqy': '1,000', 'tesstk_co': '100'},
          {'se': '우선주', 'istc_totqy': '200', 'tesstk_co': '0'}]


class BpsTest(unittest.TestCase):
    def test_share_count_sums_classes_and_excludes_treasury(self):
        self.assertEqual(fundamentals.adjusted_share_count(SHARES), 1100)

    def test_total_row_preferred(self):
        rows = SHARES + [{'se': '합계', 'istc_totqy': '1,200', 'tesstk_co': '100'}]
        self.assertEqual(fundamentals.adjusted_share_count(rows), 1100)

    def test_missing_or_nonpositive_shares(self):
        self.assertIsNone(fundamentals.adjusted_share_count([]))
        self.assertIsNone(fundamentals.adjusted_share_count([{'se': '보통주', 'istc_totqy': '-', 'tesstk_co': '0'}]))
        self.assertIsNone(fundamentals.adjusted_share_count([{'se': '보통주', 'istc_totqy': '10', 'tesstk_co': '10'}]))

    def _bps(self, rows, shares):
        with mock.patch.object(dart_client, 'call_stock_totqy', return_value=shares), \
                mock.patch.object(fundamentals.time, 'sleep'):
            return fundamentals.compute_bps('k', 'c', rows, 2026, '11012')

    def test_bps_uses_parent_equity_over_adjusted_shares(self):
        r = self._bps(bs(), SHARES)
        self.assertAlmostEqual(r['bps'], 300 / 1100)
        self.assertEqual((r['year'], r['reprt_code']), (2026, '11012'))

    def test_ofs_uses_total_equity(self):
        self.assertAlmostEqual(self._bps(bs('OFS'), SHARES)['bps'], 400 / 1100)

    def test_no_value_when_evidence_missing(self):
        self.assertEqual(self._bps(bs(parent=None), SHARES)['reason'], 'PARENT_EQUITY_MISSING')
        self.assertEqual(self._bps(bs(), [])['reason'], 'SHARES_MISSING')
        with mock.patch.object(dart_client, 'call_stock_totqy', side_effect=RuntimeError('x')), \
                mock.patch.object(fundamentals.time, 'sleep'):
            r = fundamentals.compute_bps('k', 'c', bs(), 2026, '11012')
        self.assertIsNone(r['bps'])
        self.assertEqual(r['reason'], 'SHARES_LOOKUP_FAILED')


class DisclosureTest(unittest.TestCase):
    entry = {'latest_quarter': {'rcept_no': '20260814000001'},
             'disclosure': {'filing': filing('20260814000001')}}

    def test_same_filing_keeps(self):
        self.assertEqual(fundamentals.disclosure_check(self.entry, filing('20260814000001')), 'keep')

    def test_new_filing_refetches(self):
        self.assertEqual(fundamentals.disclosure_check(self.entry, filing('20261114000009', month=9, code='11014')), 'refetch')

    def test_correction_filing_refetches(self):
        self.assertEqual(fundamentals.disclosure_check(self.entry, filing('20260820000005')), 'refetch')

    def test_legacy_entry_compares_with_quarter_rcept_no(self):
        legacy = {'latest_quarter': {'rcept_no': '20260814000001'}}
        self.assertEqual(fundamentals.disclosure_check(legacy, filing('20260814000001')), 'keep')

    def test_no_filing_list_keeps(self):
        self.assertEqual(fundamentals.disclosure_check(self.entry, None), 'keep')

    def test_status_values(self):
        q = {'rcept_no': 'A'}
        self.assertEqual(fundamentals.make_disclosure({'rcept_no': 'A'}, q)['status'], 'ok')
        self.assertEqual(fundamentals.make_disclosure({'rcept_no': 'B'}, q)['status'], 'pending')
        self.assertEqual(fundamentals.make_disclosure(None, q)['status'], 'unverified')


class BatchRefetchTest(unittest.TestCase):
    def entry(self, days_ago):
        stamp = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
        return {'latest_quarter': {'rcept_no': '20260814000001'},
                'disclosure': {'filing': filing('20260814000001'), 'checked_at': stamp}}

    def test_due_only_after_interval(self):
        self.assertFalse(batch_scan.disclosure_due(self.entry(0)))
        self.assertTrue(batch_scan.disclosure_due(self.entry(batch_scan.DISCLOSURE_CHECK_DAYS + 1)))
        self.assertTrue(batch_scan.disclosure_due({'latest_quarter': {}}))

    def test_unchanged_stock_is_not_refetched_but_stamped(self):
        e = self.entry(5)
        with mock.patch.object(dart_client, 'call_periodic_reports',
                               return_value=[{'report_nm': '반기보고서 (2026.06)', 'rcept_no': '20260814000001', 'rcept_dt': '20260814'}]):
            self.assertFalse(batch_scan.disclosure_needs_refetch('k', 'c', e))
        self.assertFalse(batch_scan.disclosure_due(e))

    def test_new_filing_triggers_refetch(self):
        with mock.patch.object(dart_client, 'call_periodic_reports',
                               return_value=[{'report_nm': '분기보고서 (2026.09)', 'rcept_no': '20261114000002', 'rcept_dt': '20261114'}]):
            self.assertTrue(batch_scan.disclosure_needs_refetch('k', 'c', self.entry(5)))

    def test_dart_outage_keeps_existing_data(self):
        with mock.patch.object(dart_client, 'call_periodic_reports', side_effect=RuntimeError('down')):
            self.assertFalse(batch_scan.disclosure_needs_refetch('k', 'c', self.entry(5)))

    def test_rate_limit_propagates(self):
        with mock.patch.object(dart_client, 'call_periodic_reports', side_effect=dart_client.DartRateLimitError('x')):
            with self.assertRaises(dart_client.DartRateLimitError):
                batch_scan.disclosure_needs_refetch('k', 'c', self.entry(5))


class QuarterFetchTest(unittest.TestCase):
    def test_latest_quarter_carries_same_report_bps_and_filed_date(self):
        rows = [{'sj_div': 'IS', 'account_id': 'ifrs-full_Revenue', 'account_nm': '매출액', 'thstrm_amount': '100',
                 'frmtrm_q_amount': '50', 'rcept_no': '20260814000001', 'thstrm_nm': '제58기 반기', 'fs_div': 'CFS'}] + bs()
        with mock.patch.object(fundamentals, 'call_fnltt_any', return_value=rows) as c, \
                mock.patch.object(dart_client, 'call_stock_totqy', return_value=SHARES), \
                mock.patch.object(fundamentals.time, 'sleep'):
            q = fundamentals.fetch_latest_quarter('k', 'c', current_year=2026)
        # 가장 최신 후보((2026, 3분기))가 비면 다음 후보로 넘어가므로 첫 호출만 데이터가 있어도 같은 보고서 기준이어야 한다.
        self.assertEqual((q['year'], q['reprt_code']), (c.call_args_list[0][0][2], c.call_args_list[0][0][3]))
        self.assertEqual(q['rcept_dt'], '20260814')
        self.assertAlmostEqual(q['bps'], 300 / 1100)
        self.assertEqual(q['fs_div'], 'CFS')


if __name__ == '__main__':
    unittest.main()
