"""9Pay 화면 접근 정책(2026-11-11).

- 비회원/미등록 로그인 계정의 기존 공개 화면과 로그인 시장지표를 유지한다.
- Google 검증 이메일 허용목록 회원은 일반 화면 확대, 검색기·전략검색·운영은 관리자만.
- 역할별 화면 표시와 제한 시세/분석 REST·WS 및 주문 권한은 별개다.
- 저장 실패·파일 손상 시 기본 정책(전부 ON)으로 읽고, 쓰기 실패는 이전 정책을 유지한다.
"""
import os
import threading
import time
import json
import re
from contextlib import contextmanager

import snapshot_io

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.environ.get('ACCESS_POLICY_PATH') or os.path.join(HERE, 'access_policy_state.json')

# key -> (label, level). member 확대 화면은 검증 Google 허용목록이 추가로 필요하다.
# 2026-11-11: 시장지표는 로그인 후에만 보인다(비로그인 메뉴에는 이야기 시리즈).
SCREENS = {
    'guestbook': ('대화방', 'public'),
    'calendar': ('캘린더', 'public'),
    'briefing': ('마켓브리핑', 'public'),
    'news': ('주요 뉴스', 'public'),
    'stories': ('이야기 시리즈', 'public'),
    'indicators': ('시장지표', 'member'),
    'home': ('홈 대시보드', 'member'),
    'stocks': ('국내 주요종목', 'member'),
    'analysis': ('종목분석', 'member'),
    'stock-search': ('종목검색', 'member'),
    'scanner': ('검색기', 'admin'),
    'strategy': ('전략검색', 'admin'),
    'tools': ('투자도구', 'member'),
    'chart': ('독립 차트', 'member'),
    'my': ('MY', 'member'),
    'watchlist': ('관심종목', 'member'),
    'memo': ('메모', 'member'),
    'market-temp': ('증시온도', 'member'),
    'market-map': ('마켓 아틀라스', 'member'),
    'autotrader': ('자동매매', 'admin'),
    'kis': ('KIS Trading Tool', 'admin'),
}
PUBLIC_SCREENS = frozenset(k for k, (_, lv) in SCREENS.items() if lv == 'public')
# 로그인 이동 목적지(/guestbook)와 비로그인 허용 화면이 꺼져 리다이렉트가 반복되지 않도록 고정한다.
LOCKED_ON = frozenset()
# 기존 public/member/admin 최대 등급은 관리자가 설정해도 넘길 수 없다.
ROLE_PERMISSIONS = {
    'public': ('guest', 'member', 'admin'),
    'member': ('member', 'admin'),
    'admin': ('admin',),
}

# 화면 설정과 원천 데이터/명령 권한은 독립. 운영 화면은 관리자 상한 유지.
SENSITIVE_SCREENS = frozenset({'autotrader', 'kis'})
SPLIT_FROM = {'analysis':'stocks', 'stock-search':'stocks', 'chart':'tools',
              'watchlist':'my', 'memo':'my', 'market-map':'market-temp'}

def editable_roles(key):
    return ('admin',) if key in SENSITIVE_SCREENS else ('guest', 'member', 'admin')

# 관리자 전용 REST 경로 접두사. 종목 단위 시세·분석·수급·검색기와 원천 시세가 섞인
# /futures(하위 /futures/avg 등 포함)를 보호한다. 회원 시장지표 메뉴가 열려 있어도
# 데이터 재제공 권한은 별개이므로 로그인만으로 원천 시세 조회를 허용하지 않는다.
# 뉴스·캘린더·브리핑 및 다른 미확인 경로는 기존 정책을 유지한다.
RESTRICTED_PREFIXES = (
    '/market-atlas-rs', '/sector-quotes', '/domestic-quotes', '/quote', '/us-search', '/us-quote', '/us-quotes',
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
    '/binance-kr-equity', '/market-temp', '/watchlist/disclosures', '/futures',
)

_lock = threading.Lock()

MEMBERS_PATH = os.environ.get('ACCESS_MEMBERS_PATH') or os.path.join(HERE, 'access_members_state.json')


@contextmanager
def _member_lock():
    with _lock:
        with open(MEMBERS_PATH + '.lock', 'a') as handle:
            if os.name == 'posix':
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == 'posix':
                    fcntl.flock(handle, fcntl.LOCK_UN)


def normalize_email(value):
    if not isinstance(value, str):
        raise ValueError('이메일을 입력해 주세요.')
    email = value.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", email):
        raise ValueError('올바른 이메일 주소를 입력해 주세요.')
    return email


def _members():
    try:
        with open(MEMBERS_PATH, encoding='utf-8') as stream:
            state = json.load(stream)
        if (not isinstance(state, dict) or not isinstance(state.get('emails'), list)
                or not isinstance(state.get('audit'), list) or type(state.get('revision')) is not int
                or state['revision'] < 0 or len(state['emails']) > 1000):
            raise ValueError('회원 저장 형식 오류')
        state['emails'] = sorted({normalize_email(e) for e in state['emails']})
        return state
    except FileNotFoundError:
        return {'emails': [], 'audit': [], 'revision': 0}


def is_member(session):
    # Only signed, freshly verified Google sessions may use the allowlist.
    if not session or session.get('provider', 'google') != 'google' or session.get('email_verified') is not True:
        return False
    try:
        return normalize_email(session.get('email')) in _members()['emails']
    except (OSError, ValueError, TypeError):
        return False


def members_view():
    state = _members()
    return {'emails': state['emails'], 'revision': state['revision'], 'audit': state['audit'][-20:]}


def update_member(email, action, actor):
    email = normalize_email(email)
    if action not in ('add', 'remove'):
        raise ValueError('등록 또는 해제를 선택해 주세요.')
    with _member_lock():
        state = _members()  # Never overwrite a damaged allowlist.
        emails = set(state['emails'])
        if (email in emails) == (action == 'add'):
            return members_view()
        if action == 'add':
            if len(emails) >= 1000:
                raise ValueError('등록 한도는 1000명입니다.')
            emails.add(email)
        else:
            emails.discard(email)
        state['emails'] = sorted(emails)
        state['revision'] += 1
        state['audit'] = (state['audit'] + [{'action': action, 'email': email, 'actor': actor,
            'at': time.strftime('%Y-%m-%dT%H:%M:%S%z')}])[-200:]
        snapshot_io.atomic_json(MEMBERS_PATH, state)
    return members_view()


def is_restricted_path(path):
    path = str(path or '')
    for prefix in RESTRICTED_PREFIXES:
        if path == prefix or path.startswith(prefix + '/'):
            return True
    return False


def default_state():
    # 구형 screens bool은 관리자 열의 ON/OFF로 유지한다.
    return {
        'screens': {k: True for k in SCREENS},
        'roles': {k: {role: role in ROLE_PERMISSIONS[level] for role in ('guest', 'member', 'admin')}
                  for k, (_, level) in SCREENS.items()},
        'revision': 0, 'updatedAt': None, 'updatedBy': None,
    }


def load_state():
    state = default_state()
    try:
        import json
        with open(STATE_PATH, 'r', encoding='utf-8') as f:
            saved = json.load(f)
        # 구형 화면 ON/OFF 값을 허용되는 모든 역할에 그대로 이관한다.
        for key, value in (saved.get('screens') or {}).items():
            if key in SCREENS and isinstance(value, bool):
                for role in editable_roles(key):
                    state['roles'][key][role] = value
        # 신규 역할별 값이 있으면 우선하며, 최대 허용 등급 밖은 무시한다.
        for key, settings in (saved.get('roles') or {}).items():
            if key not in SCREENS or not isinstance(settings, dict):
                continue
            for role in editable_roles(key):
                if isinstance(settings.get(role), bool):
                    state['roles'][key][role] = settings[role]
        if saved.get('schemaVersion', 1) < 2:
            for key in ('home', 'stocks', 'tools', 'my', 'market-temp'):
                state['roles'][key]['member'] = True
            for key in ('scanner', 'strategy'):
                state['roles'][key]['admin'] = state['roles']['stocks']['admin']
        if saved.get('schemaVersion', 1) < 3:
            for key, old in SPLIT_FROM.items():
                state['roles'][key] = dict(state['roles'][old])
        state['revision'] = int(saved.get('revision') or 0)
        state['updatedAt'] = saved.get('updatedAt')
        state['updatedBy'] = saved.get('updatedBy')
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    for key in LOCKED_ON:
        for role in editable_roles(key):
            state['roles'][key][role] = True
    state['screens'] = {key: settings['admin'] for key, settings in state['roles'].items()}
    return state


def view(authenticated, is_admin, approved_member=False):
    """서버 인증 역할의 허용값만 적용. 관리자는 편집용 역할 행렬을 함께 받는다."""
    state = load_state()
    viewer = 'admin' if is_admin else ('member' if authenticated else 'guest')
    screens = {}
    for key, (label, level) in SCREENS.items():
        item = {'label': label, 'public': level == 'public', 'level': level,
                'enabled': state['screens'][key],
                'allowed': bool(state['roles'][key][viewer if (is_admin or approved_member or (authenticated and (key in PUBLIC_SCREENS or key == 'indicators'))) else 'guest']),
                'editableRoles': list(editable_roles(key)),
                'locked': key in LOCKED_ON}
        if is_admin:
            item['roles'] = dict(state['roles'][key])
        screens[key] = item
    data = {'authenticated': bool(authenticated), 'isAdmin': bool(is_admin), 'screens': screens,
            'revision': state['revision'], 'isMember': bool(approved_member)}
    if is_admin:
        data['updatedAt'] = state['updatedAt']
    return data


def update(changes, email, roles=None):
    """구형 changes={screen:bool} 또는 신규 roles={screen:{guest/member/admin:bool}}."""
    if changes is not None and not isinstance(changes, dict):
        raise ValueError('화면 설정 형식이 올바르지 않습니다.')
    if roles is not None and not isinstance(roles, dict):
        raise ValueError('역할별 화면 설정 형식이 올바르지 않습니다.')
    if not changes and not roles:
        raise ValueError('변경할 화면이 없습니다.')
    for key, value in (changes or {}).items():
        if key not in SCREENS:
            raise ValueError('알 수 없는 화면: %s' % key)
        if not isinstance(value, bool):
            raise ValueError('ON/OFF 값이 올바르지 않습니다.')
        if key in LOCKED_ON and value is False:
            raise ValueError('%s 화면은 끌 수 없습니다.' % SCREENS[key][0])
    for key, settings in (roles or {}).items():
        if key not in SCREENS:
            raise ValueError('알 수 없는 화면: %s' % key)
        if not isinstance(settings, dict) or not settings:
            raise ValueError('역할별 ON/OFF 형식이 올바르지 않습니다.')
        for role, enabled in settings.items():
            if role not in editable_roles(key):
                raise ValueError('%s 화면은 %s에게 공개할 수 없습니다.' % (SCREENS[key][0], role))
            if not isinstance(enabled, bool):
                raise ValueError('ON/OFF 값이 올바르지 않습니다.')
            if key in LOCKED_ON and enabled is False:
                raise ValueError('%s 화면은 끌 수 없습니다.' % SCREENS[key][0])
    with _lock:
        state = load_state()
        for key, enabled in (changes or {}).items():
            for role in ROLE_PERMISSIONS[SCREENS[key][1]]:
                state['roles'][key][role] = enabled
        for key, settings in (roles or {}).items():
            state['roles'][key].update(settings)
        state['screens'] = {key: settings['admin'] for key, settings in state['roles'].items()}
        state['revision'] += 1
        state['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        state['updatedBy'] = str(email or '')
        state['schemaVersion'] = 3
        snapshot_io.atomic_json(STATE_PATH, state)
    return state
