import ast
import math
import types
import unittest
from datetime import timedelta, timezone
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/cloud-vm/kiwoom_market.py'

class FlowMissingValues(unittest.TestCase):
    def test_blank_and_invalid_are_missing_but_zero_is_valid(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_daily_rows_from_kis')
        qty = next(n for n in fn.body if isinstance(n, ast.FunctionDef) and n.name == 'quantity')
        env = dict(math=math, strict=False, to_num=lambda v: float(v or 0))
        exec(compile(ast.Module(body=[qty], type_ignores=[]), 'quantity', 'exec'), env)
        for field in ('orgn_ntby_qty', 'frgn_reg_ntby_qty', 'prsn_ntby_qty'):
            for value, expected in [(None, None), ('', None), (' ', None), ('bad', None), ('nan', None), ('0', 0), ('+1,200', 1200)]:
                with self.subTest(field=field, value=value):
                    self.assertEqual(env['quantity']({field: value}, field), expected)

    def test_personal_provisional_and_confirmed_zero(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_merge_live_row')
        class Clock:
            hour = '1400'
            @classmethod
            def now(cls, *args):
                return types.SimpleNamespace(strftime=lambda _: cls.hour)
        env = dict(datetime=Clock, timezone=timezone, timedelta=timedelta)
        exec(compile(ast.Module(body=[fn], type_ignores=[]), 'merge', 'exec'), env)
        for hour, expected in [('1400', None), ('1600', 0)]:
            Clock.hour = hour
            rows = [dict(date='2026-11-13', ind_net=0, inst_net=0)]
            env['_merge_live_row'](rows, dict(ind_net=None, foreign_net=-2, inst_net=0), '2026-11-13')
            self.assertEqual(rows[0]['ind_net'], expected)
            self.assertEqual(rows[0]['inst_net'], 0)

if __name__ == '__main__':
    unittest.main()
