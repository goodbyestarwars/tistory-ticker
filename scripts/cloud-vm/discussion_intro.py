"""Public discussion copy; Google-admin writes are guarded by main.py."""
import json
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
import snapshot_io

STATE_PATH = os.environ.get('DISCUSSION_INTRO_PATH') or os.path.join(os.path.dirname(__file__), 'discussion_intro_state.json')
_lock = threading.Lock()
LIMITS = {'title': 100, 'body': 4000, 'art': 2000, 'etiquette': 200}


class Conflict(ValueError):
    pass


def normalize(content):
    if not isinstance(content, dict) or set(content) != set(LIMITS):
        raise ValueError('제목·본문·문자 그림·하단 안내를 확인해 주세요.')
    result = {}
    for key, limit in LIMITS.items():
        value = content[key]
        if not isinstance(value, str):
            raise ValueError('문자만 입력해 주세요.')
        value = value.replace('\r\n', '\n').replace('\r', '\n')
        if key != 'art':
            value = value.strip()
        if (not value.strip() and key != 'art') or len(value) > limit or any(ord(c) < 32 and c not in '\n\t' for c in value):
            raise ValueError('빈 문구 또는 글자 수 제한을 확인해 주세요.')
        if key in ('title', 'etiquette') and '\n' in value:
            raise ValueError('제목과 하단 안내는 한 줄로 입력해 주세요.')
        result[key] = value
    return result


def _load():
    try:
        with open(STATE_PATH, encoding='utf-8') as stream:
            state = json.load(stream)
    except FileNotFoundError:
        return {'content': None, 'revision': 0, 'updatedAt': None, 'audit': []}
    if (not isinstance(state, dict) or type(state.get('revision')) is not int
            or state['revision'] < 1 or not isinstance(state.get('audit'), list)):
        raise ValueError('저장된 인트로를 읽을 수 없습니다.')
    state['content'] = normalize(state.get('content'))
    return state


def view():
    state = _load()
    return {key: state[key] for key in ('content', 'revision', 'updatedAt')}


@contextmanager
def _writing():
    with _lock:
        with open(STATE_PATH + '.lock', 'a') as handle:
            if os.name == 'posix':
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == 'posix':
                    fcntl.flock(handle, fcntl.LOCK_UN)


def update(body, actor):
    if not isinstance(body, dict) or type(body.get('revision')) is not int or body['revision'] < 0:
        raise ValueError('다시 열어 최신 문구를 확인해 주세요.')
    content = normalize(body.get('content'))
    with _writing():
        state = _load()  # Corrupt files must never be silently overwritten.
        if body['revision'] != state['revision']:
            raise Conflict('다른 곳에서 변경했습니다. 닫고 다시 열어 주세요.')
        now = datetime.now(timezone.utc).isoformat()
        saved = {'content': content, 'revision': state['revision'] + 1, 'updatedAt': now,
                 'audit': (state['audit'] + [{'actor': actor, 'at': now, 'revision': state['revision'] + 1}])[-100:]}
        snapshot_io.atomic_json(STATE_PATH, saved)
        return {key: saved[key] for key in ('content', 'revision', 'updatedAt')}

