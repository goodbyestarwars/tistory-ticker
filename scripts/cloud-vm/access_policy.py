"""9Pay 화면 접근 정책(2026-11-11).

- 비로그인·일반 회원: 대화방·캘린더·마켓브리핑·시장지표 4개 화면만.
- 관리자(Google 관리자 세션): 기존 9Pay 전체. 일반 회원에게 시세/분석 API를 인증만으로 열지 않는다.
- 관리자가 화면별 ON/OFF를 서버에 저장한다. 공개 범위는 PUBLIC_SCREENS 고정 집합이며
  ON/OFF로 넓힐 수 없다(증권사 시세 이용허가는 별개의 결정이다).
- 저장 실패·파일 손상 시 기본 정책(전부 ON)으로 읽고, 쓰기 실패는 이전 정책을 유지한다.
"""
import os
import threading
import time

import snapshot_io

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.environ.get('ACCESS_POLICY_PATH') or os.path.join(HERE, 'access_policy_state.json')

# key -> (label, public). public=True 인 화면만 비로그인에게 보인다.
SCREENS = {
    'guestbook': ('대화방', True),
    'calendar': ('캘린더', True),
    'briefing': ('마켓브리핑', True),
    'indicators': ('시장지표', True),
    'home': ('홈 대시보드', False),
    'stocks': ('종목(주요종목·분석·검색기·전략검색·종목검색)', False),
    'tools': ('투자도구·독립 차트', False),
    'my': ('MY·관심종목·메모', False),
    'market-temp': ('증시온도·주요 뉴스', False),
    'autotrader': ('자동매매', False),
    'kis': ('KIS Trading Tool', False),
}
PUBLIC_SCREENS = frozenset(k for k, (_, pub) in SCREENS.items() if pub)
# 로그인 이동 목적지(/guestbook)와 비로그인 허용 화면이 꺼져 리다이렉트가 반복되지 않도록 고정한다.
LOCKED_ON = frozenset({'guestbook'})

# 인증이 필요한(관리자 전용) REST 경로 접두사. 종목 단위 시세·분석·수급·검색기 계열이다.
# 시장지표·캘린더·브리핑·뉴스·환율·선물 계열(/futures, /fx-rates, /domestic-market-indicators ...)은
# 공개 화면의 데이터이므로 포함하지 않는다. 공급자별 공개 이용 권한은 운영자가 별도로 확인한다.
RESTRICTED_PREFIXES = (
    '/sector-quotes', '/domestic-quotes', '/quote', '/us-search', '/us-quote', '/us-quotes',
    '/us-orderbook', '/us-options', '/us-chart', '/us-news', '/us-analysis', '/us-sector-rotation',
    '/us-etf-returns', '/us-market-breadth', '/ohlc', '/flow-chart', '/ohlc-minute', '/pbar-tratio',
    '/etf-components', '/investor-flow', '/foreign-flow', '/invest-opinion', '/research-reports',
    '/investor-flow-batch', '/fundamentals', '/fundamentals-batch', '/fundamentals-meta',
    '/_diag', '/daily-scan-batch', '/invest-signal', '/pattern-scan', '/strategy-scan',
    '/strategy-scan-batch', '/scan-performance', '/scan-performance-public', '/sector-rotation',
    '/pattern-tracks', '/home-session-chart', '/money-picks', '/theme-list', '/theme-stocks',
    '/theme-flow', '/hour-direction', '/hour-candidates', '/volume-surge-live', '/gap-shadow',
    '/market-rank', '/market-participation', '/market-board', '/order-book', '/stock-members',
    '/investor-trend', '/week52-batch', '/news-momentum', '/option-flow', '/industry-flow',
    '/binance-kr-equity', '/market-temp', '/watchlist/disclosures',
)

_lock = threading.Lock()


def is_restricted_path(path):
    path = str(path or '')
    for prefix in RESTRICTED_PREFIXES:
        if path == prefix or path.startswith(prefix + '/'):
            return True
    return False


def default_state():
    return {'screens': {k: True for k in SCREENS}, 'revision': 0, 'updatedAt': None, 'updatedBy': None}


def load_state():
    state = default_state()
    try:
        import json
        with open(STATE_PATH, 'r', encoding='utf-8') as f:
            saved = json.load(f)
        for key, value in (saved.get('screens') or {}).items():
            if key in SCREENS and isinstance(value, bool):
                state['screens'][key] = value
        state['revision'] = int(saved.get('revision') or 0)
        state['updatedAt'] = saved.get('updatedAt')
        state['updatedBy'] = saved.get('updatedBy')
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    for key in LOCKED_ON:
        state['screens'][key] = True
    return state


def view(authenticated, is_admin):
    """뷰어에게 보여 줄 정책. 비관리자에게는 공개 화면의 ON/OFF만 계산해 내려보낸다."""
    state = load_state()
    screens = {}
    for key, (label, public) in SCREENS.items():
        enabled = state['screens'][key]
        allowed = enabled and (public or is_admin)
        screens[key] = {'label': label, 'public': public, 'enabled': enabled, 'allowed': bool(allowed),
                        'locked': key in LOCKED_ON}
    data = {'authenticated': bool(authenticated), 'isAdmin': bool(is_admin), 'screens': screens,
            'revision': state['revision']}
    if is_admin:
        data['updatedAt'] = state['updatedAt']
    return data


def update(changes, email):
    """changes: {screenKey: bool}. 검증 실패는 ValueError, 저장 실패는 OSError(이전 정책 유지)."""
    if not isinstance(changes, dict) or not changes:
        raise ValueError('변경할 화면이 없습니다.')
    for key, value in changes.items():
        if key not in SCREENS:
            raise ValueError('알 수 없는 화면: %s' % key)
        if not isinstance(value, bool):
            raise ValueError('ON/OFF 값이 올바르지 않습니다.')
        if key in LOCKED_ON and value is False:
            raise ValueError('%s 화면은 끌 수 없습니다(비로그인 이동 목적지).' % SCREENS[key][0])
    with _lock:
        state = load_state()
        state['screens'].update(changes)
        state['revision'] += 1
        state['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        state['updatedBy'] = str(email or '')
        snapshot_io.atomic_json(STATE_PATH, state)  # 실패하면 예외 - 기존 파일은 그대로
    return state
