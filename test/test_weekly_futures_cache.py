"""Exercise the actual weekly futures reader without importing the live API app."""
import ast
import json
import logging
from pathlib import Path
from unittest.mock import Mock


SOURCE = Path(__file__).resolve().parents[1] / 'scripts/cloud-vm/main.py'


def load_reader():
    tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
    endpoint = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                    and n.name == 'weekly_report_endpoint')
    reader = next(n for n in endpoint.body if isinstance(n, ast.FunctionDef)
                  and n.name == 'safe_futures')
    cache = {}
    request = object()
    namespace = {'_futures_cache': cache, 'request': request, 'logging': logging}
    exec(compile(ast.Module(body=[reader], type_ignores=[]), str(SOURCE), 'exec'), namespace)
    return namespace, cache, request


def test_weekly_reader_uses_the_four_part_futures_key():
    namespace, cache, request = load_reader()
    rows = [{'symbol': 'USDKRW', 'chart': [{'date': '20261023', 'close': 1300}]}]

    def serve(req, interval, days, symbols, stored_only=False):
        # Same cache partition used by futures(): live and DB-only must not mix.
        cache[(interval, days, symbols, stored_only)] = {'data': rows}

    namespace['futures'] = Mock(side_effect=serve)
    assert namespace['safe_futures']() is rows
    call = namespace['futures'].call_args
    assert call.args == (request,)
    assert call.kwargs['stored_only'] is False
    assert call.kwargs['days'] == 365
    assert 'USDKRW' in call.kwargs['symbols'].split(',')


def test_missing_cached_rows_remain_missing():
    namespace, cache, _ = load_reader()
    namespace['futures'] = Mock()
    assert namespace['safe_futures']() == []
    assert cache == {}


def test_failed_futures_read_does_not_break_the_report():
    namespace, _, _ = load_reader()
    namespace['futures'] = Mock(side_effect=RuntimeError('unavailable'))
    assert namespace['safe_futures']() == []


def test_invalid_snapshot_version_is_rejected(tmp_path):
    tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
    version = next(n.value.value for n in tree.body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == '_WEEKLY_REPORT_SNAPSHOT_VERSION'
                           for t in n.targets))
    # v9 could permanently retain empty assets for the same completed week.
    assert version > 9
    loader = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                  and n.name == '_load_weekly_report_snapshot')
    path = tmp_path / 'weekly_report_cache.json'
    namespace = {'json': json, '_WEEKLY_REPORT_SNAPSHOT_VERSION': version,
                 '_WEEKLY_REPORT_SNAPSHOT_FILE': str(path)}
    exec(compile(ast.Module(body=[loader], type_ignores=[]), str(SOURCE), 'exec'), namespace)
    data = {'fx': {'analysis': {'status': 'unknown'}}}
    snapshot = {'version': 9, 'week_end': '2026-10-23', 'data': data}
    path.write_text(json.dumps(snapshot), encoding='utf-8')
    assert namespace['_load_weekly_report_snapshot']('2026-10-23') is None
    snapshot['version'] = version
    path.write_text(json.dumps(snapshot), encoding='utf-8')
    assert namespace['_load_weekly_report_snapshot']('2026-10-23') == data
