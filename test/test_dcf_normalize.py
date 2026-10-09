"""Synthetic boundary fixtures only; production archives contain real DART rows."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import dcf_normalize as N
import build_dcf_data as B

RECEIPT = '20260301000001'


def row(key, amount='100', **extra):
    divs, ids, names = N.RULES[key]
    return {'bsns_year': '2025', 'reprt_code': '11011', 'fs_div': 'CFS', 'sj_div': divs[0],
            'account_id': ids[0] if ids else 'nonstandard', 'account_nm': names[0],
            'account_detail': '-', 'thstrm_amount': amount, 'currency': 'KRW', 'rcept_no': RECEIPT, **extra}


def report(year=2025, receipt=RECEIPT):
    return {'report_nm': f'사업보고서 ({year}.12)', 'rcept_no': receipt, 'rcept_dt': '20260301', 'corp_cls': 'Y'}


class NormalizationTests(unittest.TestCase):
    def test_real_zero_and_missing_are_distinct(self):
        self.assertEqual(N.account([row('revenue', '0')], 'revenue', RECEIPT)['value'], 0)
        for v in ('', '-', None, 'NaN', 'inf'):
            self.assertIsNone(N.account([row('revenue', v)], 'revenue', RECEIPT)['value'])

    def test_negative_and_large_amounts(self):
        self.assertEqual(N.number('(1,234)'), -1234)
        self.assertEqual(N.number('123456789012345678'), 123456789012345678)

    def test_statement_boundary_not_profit_before_tax(self):
        self.assertIsNone(N.account([row('pretax')], 'ebit', RECEIPT)['value'])
        self.assertIsNone(N.account([row('revenue', sj_div='CF')], 'revenue', RECEIPT)['value'])

    def test_unknown_currency_is_not_converted(self):
        for currency in ('USD', None, '천원'):
            self.assertIsNone(N.account([row('revenue', currency=currency)], 'revenue', RECEIPT)['value'])

    def test_correction_receipt_requires_match(self):
        self.assertEqual(N.account([row('revenue')], 'revenue', RECEIPT)['status'], 'auto')
        self.assertEqual(N.account([row('revenue')], 'revenue', '20260401000001')['status'], 'review')
        self.assertEqual(N.account([row('revenue', rcept_no=None)], 'revenue', None)['status'], 'review')

    def test_nonstandard_exact_name_requires_review(self):
        self.assertEqual(N.account([row('revenue', account_id='custom')], 'revenue', RECEIPT)['status'], 'review')
        self.assertIsNone(N.account([row('revenue', account_id='custom', account_nm='기타 매출액')], 'revenue', RECEIPT)['value'])

    def test_duplicate_accounts_never_choose_first(self):
        self.assertIsNone(N.account([row('revenue'), row('revenue')], 'revenue', RECEIPT)['value'])
        self.assertIsNone(N.account([row('revenue', account_detail='사업부문')], 'revenue', RECEIPT)['value'])

    def test_quarter_and_comparative_values_excluded(self):
        data = N.annual([row('revenue', reprt_code='11012')], 2025, 'CFS', report())
        self.assertIsNone(data['fields']['revenue']['value'])
        data = N.annual([row('revenue', '120', frmtrm_amount='999')], 2025, 'CFS', report())
        self.assertEqual(data['fields']['revenue']['value'], 120)

    def test_basis_not_mixed(self):
        data = N.annual([row('revenue', fs_div='OFS')], 2025, 'CFS', report())
        self.assertIsNone(data['fields']['revenue']['value'])

    def test_capex_acquisition_only_and_positive_outflow(self):
        data = N.annual([row('ppeCapex', '-70'), row('intangibleCapex', '5'),
                         row('ppeCapex', '999', account_id='ifrs-full_ProceedsFromSalesOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', account_nm='유형자산 처분')], 2025, 'CFS', report())
        self.assertEqual(data['fields']['capex']['value'], 75)
        missing = N.annual([row('ppeCapex', '70')], 2025, 'CFS', report())
        self.assertIsNone(missing['fields']['capex']['value'])

    def test_no_double_counting_combined_amortisation(self):
        data = N.annual([row('daCombined', '10'), row('depreciation', '8'), row('amortisation', '2')], 2025, 'CFS', report())
        self.assertEqual(data['fields']['da']['value'], 10)
        self.assertIsNone(N.annual([row('depreciation', '8')], 2025, 'CFS', report())['fields']['da']['value'])

    def test_tax_expense_not_tax_paid_and_loss_no_ratio(self):
        data = N.annual([row('pretax', '100'), row('taxExpense', '25'), row('taxPaid', '10')], 2025, 'CFS', report())
        self.assertEqual(data['fields']['taxRate']['value'], .25)
        self.assertEqual(data['fields']['taxRate']['status'], 'review')
        self.assertIsNone(N.annual([row('pretax', '-100'), row('taxExpense', '25')], 2025, 'CFS', report())['fields']['taxRate']['value'])

    def test_working_capital_increase_decrease_and_gap(self):
        def entry(y, nwc, basis='CFS'):
            return {'year': y, 'basis': basis, 'fields': {'nwc': {'value': nwc, 'status': 'auto', 'sources': []}}}
        series = N.normalize_series([entry(2024, 130), entry(2023, 100), entry(2025, 90)])
        self.assertEqual([x['year'] for x in series], [2023, 2024, 2025])
        self.assertEqual(series[1]['fields']['deltaNwc']['value'], 30)
        self.assertEqual(series[2]['fields']['deltaNwc']['value'], -40)
        self.assertIsNone(N.normalize_series([entry(2023, 10), entry(2025, 20)])[1]['fields']['deltaNwc']['value'])
        self.assertIsNone(N.normalize_series([entry(2024, 10), entry(2025, 20, 'OFS')])[1]['fields']['deltaNwc']['value'])

    def test_total_liabilities_not_interest_bearing_debt(self):
        liability = row('shortDebt', account_id='ifrs-full_Liabilities', account_nm='부채총계')
        self.assertIsNone(N.annual([liability], 2025, 'CFS', report())['fields']['debt']['value'])

    def test_ocf_fcf_not_fcff(self):
        data = N.annual([row('ocf', '100'), row('ppeCapex', '30'), row('intangibleCapex', '0')], 2025, 'CFS', report())
        result = N.normalize_series([data])[0]
        self.assertEqual(result['fields']['simpleFcf']['value'], 70)
        self.assertIsNone(result['fields']['fcff']['value'])

    def test_budget_is_hard_bound(self):
        c = B.Collector('not-a-real-key', 1)
        self.assertEqual(c.call(lambda key: []), [])
        with self.assertRaises(B.BudgetExhausted):
            c.call(lambda key: [])

    def test_search_universe_preferred_finance_and_etf_exclusion(self):
        stocks = B.universe()
        self.assertEqual(stocks['005935']['sourceCode'], '005930')
        self.assertEqual(stocks['005935']['shareClass'], 'preferred')
        self.assertEqual(stocks['105560']['kind'], 'financial')
        self.assertEqual(stocks['005930']['market'], 'KOSPI')
        self.assertEqual(stocks['000660']['market'], 'KOSPI')
        self.assertNotIn('069500', stocks)

    def test_write_archive_is_parseable_and_html_safe(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test.js'
            B.write_js(path, 'DCF_FILES', {'text': '</script>'})
            self.assertNotIn('</script>', path.read_text(encoding='utf-8'))
            self.assertEqual(B.read_js(path, 'DCF_FILES'), {'text': '</script>'})

    def test_latest_valid_report_and_same_basis_across_history(self):
        stock = B.universe()['005930']
        old, new = report(receipt='20260201000001'), report(receipt='20260401000001')
        c = B.Collector('not-a-real-key', 60)
        calls = []
        def fake(fn, *args):
            if fn == c.reports:
                return [old, new, report(2024)]
            if fn == B.dart_client.call_stock_totqy:
                return []
            calls.append(args)
            return [row('revenue', bsns_year=str(args[1]), rcept_no=new['rcept_no'])] if args[1] == 2025 else []
        with patch.object(c, 'call', side_effect=fake):
            data = c.company(stock, '00126380', 2025)
        self.assertEqual(data['years'][-1]['report']['rcept_no'], new['rcept_no'])
        self.assertEqual(data['years'][-1]['fields']['revenue']['status'], 'auto')
        self.assertEqual([r['year'] for r in data['years']], [2021, 2022, 2023, 2024, 2025])
        self.assertTrue(all(args[-1] == 'CFS' for args in calls))

    def test_static_paths_do_not_trigger_vm_restart(self):
        deploy = (ROOT / 'scripts/cloud-vm/deploy_check.sh').read_text(encoding='utf-8')
        watch = deploy.split('VM_WATCH_PATHS="', 1)[1].split('"', 1)[0]
        self.assertNotIn('dcf-data', watch)
        self.assertNotIn('goodbyestar.cloud', (ROOT / 'js/dcf.js').read_text(encoding='utf-8'))

    def test_generated_real_archives_have_source_and_units(self):
        index = B.read_js(ROOT / 'dcf-data/index.js', 'DCF_INDEX')
        for code in index['available']:
            data = B.read_js(ROOT / 'dcf-data/companies' / (code + '.js'), 'DCF_FILES')[code]
            self.assertEqual(data['code'], code)
            self.assertEqual(data['amountUnit'], '원')
            self.assertEqual(data['currency'], 'KRW')
            self.assertEqual(len(data['years']), 5)
            self.assertTrue(all(r['basis'] == data['basis'] for r in data['years']))
            for r in data['years']:
                for field in r['fields'].values():
                    if field['status'] == 'auto':
                        self.assertTrue(field['sources'] or field.get('formula'))
                    self.assertNotIn('crtfc_key', json.dumps(field))


if __name__ == '__main__':
    unittest.main()
