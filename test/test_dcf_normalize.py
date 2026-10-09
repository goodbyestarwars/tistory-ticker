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
    def test_shared_thread_quota_cannot_exceed_call_limit(self):
        c = B.Collector('not-a-real-key', 5, 1500)
        def invoke():
            try:
                return c.call(lambda key: 'ok')
            except B.BudgetExhausted:
                return 'stopped'
        with patch.object(B.time, 'sleep'), B.ThreadPoolExecutor(max_workers=4) as pool:
            result = list(pool.map(lambda _: invoke(), range(20)))
        self.assertEqual(result.count('ok'), 5)
        self.assertEqual(c.calls, 5)

    def test_rate_limit_stops_other_workers_before_next_request(self):
        c = B.Collector('not-a-real-key', 100, 1500)
        def limited(key):
            raise B.dart_client.DartRateLimitError('test quota')
        with self.assertRaises(B.dart_client.DartRateLimitError):
            c.call(limited)
        with self.assertRaises(B.BudgetExhausted):
            c.call(lambda key: self.fail('network should not run'))
        self.assertEqual(c.calls, 1)

    def test_parallel_batch_preserves_failed_archive_and_publishes_successes(self):
        codes = ['005930','000660','005380','000270']
        stocks = {c: B.universe()[c] for c in codes}
        now = B.datetime.now(B.KST).isoformat()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);out = root / 'dcf-data'
            prior = {'old': True}
            B.write_js(out/'companies/005930.js', 'DCF_FILES', {'005930': prior})
            B.write_js(out/'index.js', 'DCF_INDEX', {'available': {'005930':now}, 'corpCodes': dict.fromkeys(codes,'12345678')})
            def fake_company(self, stock, corp, year):
                self.call(lambda key: None)
                if stock['sourceCode'] == '005930':
                    raise RuntimeError('sensitive exception must never be copied')
                return {'code':stock['sourceCode'], 'generatedAt':now}
            with patch.object(B, 'ROOT', root), patch.object(B, 'OUT', out), patch.object(B, 'universe', return_value=stocks), \
                    patch.object(B.Collector, 'company', fake_company), patch.object(B.time, 'sleep'), \
                    patch.dict(B.os.environ, {'DART_API_KEY':'not-a-real-key'}), \
                    patch.object(B.sys, 'argv', ['build_dcf_data.py','--codes',','.join(codes),'--force','--workers','4']):
                self.assertEqual(B.main(), 0)
            index = B.read_js(out/'index.js', 'DCF_INDEX')
            self.assertEqual(B.read_js(out/'companies/005930.js', 'DCF_FILES')['005930'], prior)
            self.assertEqual(index['collectionUsage']['calls'], 4)
            self.assertEqual(index['available']['005930'], now)
            self.assertIn('005930', index['failures'])
            self.assertNotIn('sensitive exception', json.dumps(index))
            self.assertEqual(len(index['available']), 4)

    def test_compaction_preserves_ambiguous_candidates_and_all_fields(self):
        rows = [row('revenue'), row('revenue', '200'), row('ppeCapex', '-25'),
                row('intangibleCapex', '-5'), row('revenue', account_detail='segment'),
                row('revenue', account_id='unrelated', account_nm='other')]
        original = N.annual(rows, 2025, 'CFS', report())
        compact = B.compact_record(N.annual(rows, 2025, 'CFS', report()))
        self.assertEqual(len(compact['rawRows']), 5)
        self.assertEqual(compact['rawRowCount'], 6)
        self.assertEqual(N.annual(compact['rawRows'], 2025, 'CFS', report())['fields'], original['fields'])
        self.assertIsNone(compact['fields']['revenue']['value'])

    def test_full_universe_queue_prioritizes_missing_and_retries_after_cooldown(self):
        now = B.datetime.now(B.KST)
        available = {'A': (now - B.timedelta(days=31)).isoformat(), 'B': now.isoformat()}
        attempts = {'C': now.isoformat(), 'D': (now - B.timedelta(hours=7)).isoformat()}
        self.assertEqual(B.target_codes(['A','B','C','D','E'], available, attempts, now, 0), ['D','E','A'])
        self.assertEqual(B.target_codes(['A','B','C','D','E'], available, attempts, now, 3), ['D','E','A'])
        self.assertEqual(B.target_codes(['A','B','C','D','E'], available, attempts, now, 0, failures={'B':'failed'}), ['D','E','A','B'])

    def test_daily_quota_stops_before_any_authenticated_request(self):
        stock = B.universe()['005930']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);out = root / 'dcf-data'
            original = {'stocks': [stock], 'available': {}, 'collectionUsage': {'date': B.datetime.now(B.KST).date().isoformat(), 'calls': 12000}}
            B.write_js(out / 'index.js', 'DCF_INDEX', original)
            with patch.object(B, 'ROOT', root), patch.object(B, 'OUT', out), patch.object(B, 'universe', return_value={'005930':stock}), \
                    patch.dict(B.os.environ, {'DART_API_KEY':'not-a-real-key'}), patch.object(B.sys, 'argv', ['build_dcf_data.py']), \
                    patch.object(B.dart_client, 'get_corp_code_map') as network:
                self.assertEqual(B.main(), 0)
                network.assert_not_called()
            self.assertEqual(B.read_js(out / 'index.js', 'DCF_INDEX'), original)

    def test_collector_enforces_time_and_api_call_limits(self):
        c = B.Collector('not-a-real-key', 0, 1500)
        with self.assertRaises(B.BudgetExhausted):
            c.call(lambda key: None)
        c = B.Collector('not-a-real-key', 100, 1)
        c.started -= 2
        with self.assertRaises(B.BudgetExhausted):
            c.call(lambda key: None)

    def test_current_master_includes_spacs_and_special_preferred_issuer_mapping(self):
        stocks = B.universe()
        self.assertTrue(any(s['kind'] == 'spac' for s in stocks.values()))
        self.assertEqual(stocks['294090']['shareClass'], 'common')
        self.assertEqual(stocks['458650']['shareClass'], 'common')
        for code, issuer in [('00104K','001040'), ('007815','007810'), ('008355','008350'),
                             ('097955','097950'), ('37550L','375500')]:
            self.assertEqual(stocks[code]['sourceCode'], issuer)
            self.assertEqual(stocks[code]['shareClass'], 'preferred')

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

    def test_cold_actions_runner_bootstraps_public_mapping_without_download(self):
        stock = B.universe()['005930']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = root / 'dcf-data'
            B.write_js(out / 'index.js', 'DCF_INDEX', {'available': {'005930': B.datetime.now(B.KST).isoformat()}, 'corpCodes': {'005930': '00126380'}})
            def mapper(key):
                data = json.loads((root / 'work/dart_corp_code_map.json').read_text(encoding='utf-8'))
                self.assertEqual(data, {'005930': '00126380'})
                return data
            with patch.object(B, 'ROOT', root), patch.object(B, 'OUT', out), patch.object(B, 'universe', return_value={'005930': stock}), \
                    patch.object(B.dart_client, 'get_corp_code_map', side_effect=mapper), patch.object(B.dart_client, 'CORP_CODE_MAP_FILE', 'unused'), \
                    patch.dict(B.os.environ, {'DART_API_KEY': 'not-a-real-key'}), patch.object(B.sys, 'argv', ['build_dcf_data.py', '--codes', '005930']):
                self.assertEqual(B.main(), 0)


if __name__ == '__main__':
    unittest.main()
