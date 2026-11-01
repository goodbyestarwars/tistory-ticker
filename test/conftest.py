"""pytest 보조 설정.

node가 필요한 JS 하네스 테스트는 node가 없는 환경에서 실패가 아니라 건너뜀으로 처리한다.
(unittest로 직접 돌릴 때는 각 테스트의 skipUnless를 따른다.)
"""
import shutil

import pytest
from _pytest._code import ExceptionInfo


def _is_missing_node(exc):
    return isinstance(exc, FileNotFoundError) and "'node'" in str(exc) and not shutil.which('node')


def _skip_info():
    try:
        pytest.skip('node가 설치돼 있지 않아 건너뜀')
    except BaseException:
        return ExceptionInfo.from_current()


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_makereport(item, call):
    # unittest.TestCase 실패는 item._excinfo에 쌓였다가 보고서 단계에서 call.excinfo로 옮겨진다.
    queued = getattr(item, '_excinfo', None)
    if queued and _is_missing_node(queued[0].value):
        queued[0] = _skip_info()
    if call.excinfo is not None and _is_missing_node(call.excinfo.value):
        call.excinfo = _skip_info()
    yield
