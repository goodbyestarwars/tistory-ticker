"""Bounded cap-universe and raw-USD regressions without importing server startup."""
import ast
import math
import pathlib
import re
import time
import types
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

def functions(path, names, env):
    tree = ast.parse((ROOT / path).read_text(encoding='utf-8'))
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(ast.Module(body=selected, type_ignores=[]), path, 'exec'), env)
    return env

class CapUniverseTests(unittest.TestCase):
    def test_domestic_two_pages_filter_and_order(self):
        def row(i, kind='stock', cap=None):
            amount = cap if cap is not None else 100000000 * (300-i)
            return dict(itemCode=f'{i:05d}0',stockName=f'Company{i}',
                        stockEndType=kind,marketValueRaw=amount,marketValue=amount/1e8,
                        closePriceRaw=10000,fluctuationsRatio='1.5')
        calls=[]
        def get_json(url, timeout):
            calls.append(url)
            rows = [row(i) for i in (range(1,91) if len(calls)==1 else range(91,111))]
            if len(calls)==1:
                rows += [row(120,'etf'),dict(row(121),itemCode='012345'),
                         dict(row(122),stockName='시험스팩'),row(1),
                         dict(row(123),marketValue=1),row(124,cap=float('nan'))]
            return dict(stockListCategoryType='KOSPI',stocks=rows)
        module=types.ModuleType('market_temp_data');module._get_json=get_json
        prior=sys.modules.get('market_temp_data')
        sys.modules['market_temp_data']=module
        try:
            env=dict(math=math,re=re,time=time,load_wics_map=lambda:{},
                     _number=lambda x:float(str(x).replace(',','')) if x is not None else None)
            functions('scripts/cloud-vm/market_board.py',{'_fetch_domestic_cap_top100'},env)
            data=env['_fetch_domestic_cap_top100']('kospi',100)
            self.assertEqual(len(data['rows']),100)
            self.assertEqual(len(calls),2)
            self.assertEqual(len({r['code'] for r in data['rows']}),100)
            self.assertEqual(data['rows'][0]['code'],'000010')
            self.assertEqual(data['rows'][-1]['code'],'001000')
        finally:
            if prior is None: sys.modules.pop('market_temp_data',None)
            else: sys.modules['market_temp_data']=prior

    def test_us_native_dollars_normalized_and_bad_units_rejected(self):
        calls=[]
        def fetch(*args):
            calls.append(args)
            return [dict(symb='AAPL',tomv='5177386894000',shar='14532200000',last_org='356.2700'),
                    dict(symb='BAD',tomv='5177386',shar='14532200000',last_org='356.2700')]
        env={'_fetch_us_rank_rows':fetch}
        functions('scripts/cloud-vm/kis_client.py',{'fetch_us_market_cap_rank'},env)
        rows=env['fetch_us_market_cap_rank']('token','key','secret','NAS',100)
        self.assertAlmostEqual(rows[0]['tomv'],5177386.894)
        self.assertIsNone(rows[1]['tomv'])
        self.assertEqual(calls[0][-2]['CURR_GB'],'1')
        self.assertIn('KEYB',calls[0][-2])
        self.assertEqual(calls[0][-1],100)

if __name__ == '__main__':
    unittest.main()
