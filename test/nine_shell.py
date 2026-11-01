"""JS 하네스용 공통 전역(NineHttp/NineUI/NineAPI) 로더.

js/skin-shell.js 의 NineHttp~NineAPI 구간은 DOM 없이 로드된다. 테스트가 이 구간을 따로 흉내 내지 않고
실제 코드를 그대로 싣도록 한 줄짜리 JS 접두사를 만들어 준다.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace('\\', '/')


def prefix(first='/* NineHttp:', last='/* End NineAPI */', target='globalThis'):
    """node -e 스크립트 맨 앞에 붙이는 JS. target 전역에 window 별칭을 만들고 구간을 실행한다."""
    return (
        "(function(){var s=require('fs').readFileSync(%r,'utf8');"
        "%s.window=%s.window||%s;"
        "require('vm').runInThisContext(s.slice(s.indexOf(%r),s.indexOf(%r)));})();\n"
    ) % (ROOT + '/js/skin-shell.js', target, target, target, first, last)


def ui_only():
    return prefix('/* NineUI:', '/* End NineUI */')
