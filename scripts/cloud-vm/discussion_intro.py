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
            or state['revision'] < 0 or not isinstance(state.get('audit'), list)):
        raise ValueError('저장된 인트로를 읽을 수 없습니다.')
    state['content'] = normalize(state.get('content'))
    if 'history' in state:
        history = state['history']
        if not isinstance(history, list) or not history:
            raise ValueError('인트로 이력 형식 오류')
        previous = None
        for entry in history:
            if (not isinstance(entry, dict) or type(entry.get('revision')) is not int
                    or entry['revision'] < 0 or (previous is not None and entry['revision'] != previous + 1)):
                raise ValueError('인트로 이력 순서 오류')
            normalize(entry.get('content'))
            previous = entry['revision']
        if history[-1]['revision'] != state['revision'] or history[-1]['content'] != state['content']:
            raise ValueError('인트로 현재 문구와 이력이 일치하지 않습니다.')
    return state


def view():
    state = _load()
    return {key: state[key] for key in ('content', 'revision', 'updatedAt')}


def _history(state):
    if 'history' in state:
        return list(state['history'])
    if state['content'] is None:
        return []
    actor = next((item.get('actor') for item in reversed(state['audit'])
                  if item.get('revision') == state['revision']), None)
    # A legacy snapshot is known; older overwritten contents must not be invented.
    return [{'content': state['content'], 'revision': state['revision'],
             'at': state['updatedAt'], 'actor': actor, 'source': 'existing-snapshot'}]


def preserve_current(default_content=None):
    """Run at deployment to retain the existing snapshot without editing it."""
    with _writing():
        state = _load()
        if state['content'] is None and default_content is not None:
            content = normalize(default_content)
            now = datetime.now(timezone.utc).isoformat()
            state = {'content': content, 'revision': 0, 'updatedAt': now, 'audit': [],
                     'history': [{'content': content, 'revision': 0, 'at': now,
                                  'actor': None, 'source': 'code-default-baseline'}]}
            snapshot_io.atomic_json(STATE_PATH, state)
        if state['content'] is None or 'history' in state:
            return {'revision': state['revision'], 'versions': len(state.get('history', []))}
        state['history'] = _history(state)
        snapshot_io.atomic_json(STATE_PATH, state)
        return {'revision': state['revision'], 'versions': len(state['history'])}


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
        # Current text and complete version history commit together in the same atomic snapshot.
        # Only the compact audit is capped; full content history is never truncated.
        saved['history'] = _history(state) + [{'content': content, 'revision': saved['revision'],
            'at': now, 'actor': actor, 'source': 'admin-save'}]
        snapshot_io.atomic_json(STATE_PATH, saved)
        return {key: saved[key] for key in ('content', 'revision', 'updatedAt')}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Preserve the current intro as a server-only baseline.')
    parser.add_argument('--baseline', help='Public code-default content JSON, used only when no saved intro exists.')
    args = parser.parse_args()
    baseline = None
    if args.baseline:
        with open(args.baseline, encoding='utf-8') as stream:
            baseline = json.load(stream)
    print(json.dumps(preserve_current(baseline)))

