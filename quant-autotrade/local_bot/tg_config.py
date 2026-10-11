# -*- coding: utf-8 -*-
"""텔레그램 설정·보안 유틸(표준 라이브러리만 사용).

- 토큰·채팅 ID는 .env 에서만 읽는다: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / TELEGRAM_ALLOWED_USER_ID.
  값은 저장소·로그·텔레그램 메시지 어디에도 남기지 않는다.
- redact(): 로그·오류 문구에서 봇 토큰 모양과 10자리 이상 숫자열(계좌번호 등)을 가린다.
"""
import os
import re
import tempfile
from urllib.parse import urlparse

DEFAULT_API_BASE = 'https://api.telegram.org'
TOKEN_RE = re.compile(r'\d{6,12}:[A-Za-z0-9_-]{30,}')
LONG_DIGITS_RE = re.compile(r'(?<![\d,.])\d{10,}(?![\d,.])')   # 쉼표로 끊은 금액은 제외, 붙어 있는 긴 숫자열(계좌번호 등)만


def redact(text, secrets=()):
    """토큰 모양·알려진 비밀값·긴 숫자열을 가린다(끝 3자리만 남김)."""
    out = TOKEN_RE.sub('<token>', str(text))
    for secret in secrets:
        if secret and len(str(secret)) >= 6:
            out = out.replace(str(secret), '***')
    return LONG_DIGITS_RE.sub(lambda m: '***' + m.group(0)[-3:], out)


def mask_id(value):
    """사용자·채팅 ID 표시용(끝 3자리만)."""
    text = str(value or '')
    return ('***' + text[-3:]) if len(text) > 3 else '***'


def _positive_int(value):
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _safe_api_base(value):
    """토큰이 엉뚱한 서버로 가지 않도록 공식 주소 또는 로컬 테스트 서버(127.0.0.1/localhost)만 허용한다."""
    value = (value or '').strip().rstrip('/')
    if not value:
        return DEFAULT_API_BASE
    parsed = urlparse(value)
    if parsed.hostname in ('127.0.0.1', 'localhost') and parsed.scheme == 'http':
        return value
    return DEFAULT_API_BASE


class Settings:
    def __init__(self, token='', chat_id=None, allowed_user_id=None, api_base=DEFAULT_API_BASE, raw_chat_id=''):
        self.token = (token or '').strip()
        self.chat_id = chat_id
        self.allowed_user_id = allowed_user_id
        self.api_base = api_base
        self._raw_chat_id = raw_chat_id

    @property
    def enabled(self):
        return bool(self.token)

    @property
    def target_chat_id(self):
        """알림을 보낼 개인 채팅. CHAT_ID 가 없으면 허용 사용자 ID(개인 채팅의 채팅 ID는 사용자 ID와 같다)."""
        return self.chat_id or self.allowed_user_id

    @property
    def ready(self):
        """토큰과 허용 사용자가 모두 있어야 알림·명령이 동작한다."""
        return self.enabled and bool(self.allowed_user_id) and not self.problems()

    def problems(self):
        out = []
        if self._raw_chat_id and self.chat_id is None:
            out.append('TELEGRAM_CHAT_ID 는 개인 채팅의 양수 숫자여야 합니다(그룹·채널 ID는 허용하지 않음)')
        if self.chat_id and self.allowed_user_id and self.chat_id != self.allowed_user_id:
            out.append('TELEGRAM_CHAT_ID 와 TELEGRAM_ALLOWED_USER_ID 가 다릅니다(개인 채팅이면 같은 값)')
        return out


def load_settings(env=None):
    env = os.environ if env is None else env
    raw_chat = (env.get('TELEGRAM_CHAT_ID') or '').strip()
    return Settings(token=env.get('TELEGRAM_BOT_TOKEN', ''), chat_id=_positive_int(raw_chat), allowed_user_id=_positive_int(env.get('TELEGRAM_ALLOWED_USER_ID')),
                    api_base=_safe_api_base(env.get('TELEGRAM_API_BASE')), raw_chat_id=raw_chat)


def update_env_file(path, updates):
    """.env 의 KEY=VALUE 줄을 바꾸거나 추가한다(다른 줄·주석은 그대로). 임시 파일에 쓴 뒤 원자적으로 교체한다. 값은 출력하지 않는다."""
    lines = []
    if os.path.exists(path):
        with open(path, encoding='utf-8-sig') as f:
            lines = f.read().splitlines()
    pending = dict(updates)
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or '=' not in stripped:
            continue
        key = stripped.split('=', 1)[0].strip()
        if key in pending:
            lines[i] = '%s=%s' % (key, pending.pop(key))
    for key, value in pending.items():
        lines.append('%s=%s' % (key, value))
    fd, tmp = tempfile.mkstemp(prefix='.env.', dir=os.path.dirname(os.path.abspath(path)))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(lines) + '\n')
        os.replace(tmp, path)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
