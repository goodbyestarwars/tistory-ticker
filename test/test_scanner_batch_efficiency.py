import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime,timezone,timedelta

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/cloud-vm'))
import batch_scan as batch


class BatchEfficiencyTest(unittest.TestCase):
    def test_only_technical_gate_and_no_duplicate_refresh_preserves_evidence(self):
        now=datetime.now(timezone.utc)
        oldproof={'checked_at':'2020-01-01','version':1}
        cache={'000001':{'dividend':{}},'000002':{'dividend':{}},
               '000003':{'dividend':{},'screening':oldproof}}
        times={'000001':now.isoformat(),'000002':now.isoformat(),
               '000003':(now-timedelta(days=100)).isoformat()}
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder)
            (root/'daily_scan_cache.json').write_text(json.dumps({'patternScan':{'patterns':{'maCloudBreakout':[{'code':'000001'},{'code':'000001'}]}}}))
            def fetched(key,corp,include_screening=True):
                value={'annual':{},'latest_quarter':{},'dividend':{}}
                if include_screening:value['screening']={'version':1,'checked_at':'fresh'}
                return value
            with patch.dict(os.environ,{'DART_API_KEY':'test-only'}), \
                 patch.multiple(batch,__file__=str(root/'batch_scan.py'),FUNDAMENTALS_OUTPUT_FILE=str(root/'fund.json')), \
                 patch.object(batch.dart_client,'get_corp_code_map',return_value={c:c for c in cache}), \
                 patch.object(batch,'load_fundamentals_state',return_value=(cache,times,0)), \
                 patch.object(batch,'save_fundamentals_cursor') as cursor, \
                 patch.object(batch.fundamentals,'fetch_stock',side_effect=fetched) as fetch, \
                 patch.object(batch.migrate_fundamentals,'main'),patch.object(batch.time,'sleep'),patch.object(batch,'log'):
                batch.scan_fundamentals({c:c for c in cache})
                self.assertEqual(fetch.call_count,2)
                self.assertEqual(fetch.call_args_list[0].kwargs,{'include_screening':True})
                self.assertEqual(fetch.call_args_list[1].kwargs,{'include_screening':False})
                self.assertEqual(fetch.call_args_list[1].args[1],'000003')
                cursor.assert_called_once_with(3)
            result=json.loads((root/'fund.json').read_text())
            self.assertEqual(result['data']['000003']['screening'],oldproof)
            self.assertEqual(result['fetchedAt']['000002'],times['000002'])


if __name__=='__main__':unittest.main()
