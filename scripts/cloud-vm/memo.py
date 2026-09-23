# -*- coding: utf-8 -*-
"""Google account-owned memo list validation.

2026-09-23 사용자 요청("메모 기능? DB는 직접 쓰지말고, 티스토리꺼 쓰고" -> 확인 결과
"이미 있는 구글 로그인으로" - watchlist.py/watchlist_configs와 같은 패턴을 그대로
재사용하라는 뜻이었다). 종목별 메모(`code`/`name` 있음)와 자유 메모(`code`가 null)
둘 다 이 하나의 배열에 같이 담는다.
"""

MAX_ITEMS = 200
MAX_BODY_LENGTH = 2000
MAX_NAME_LENGTH = 100


class MemoConfigError(ValueError):
    """Raised when a memo payload is malformed."""


def normalize_items(value):
    if not isinstance(value, list):
        raise MemoConfigError('memos must be an array')
    if len(value) > MAX_ITEMS:
        raise MemoConfigError('memos must have at most %d items' % MAX_ITEMS)

    items = []
    seen_ids = set()
    for raw in value:
        if not isinstance(raw, dict):
            raise MemoConfigError('memo entries must be objects')
        memo_id = str(raw.get('id', '')).strip()
        if not memo_id or len(memo_id) > 64:
            raise MemoConfigError('memo id must be 1-64 characters')
        if memo_id in seen_ids:
            raise MemoConfigError('duplicate memo id: ' + memo_id)
        seen_ids.add(memo_id)

        body = str(raw.get('body', '')).strip()
        if not body or len(body) > MAX_BODY_LENGTH:
            raise MemoConfigError('memo body must be 1-%d characters' % MAX_BODY_LENGTH)

        code = raw.get('code')
        code = str(code).strip().upper() if code else None
        if code and len(code) > 20:
            raise MemoConfigError('memo code is too long')

        name = raw.get('name')
        name = str(name).strip() if name else None
        if name and len(name) > MAX_NAME_LENGTH:
            raise MemoConfigError('memo name must be at most %d characters' % MAX_NAME_LENGTH)

        created_at = str(raw.get('createdAt', '')).strip()
        updated_at = str(raw.get('updatedAt', '')).strip()
        if not created_at:
            raise MemoConfigError('memo createdAt is required')

        items.append({
            'id': memo_id,
            'code': code,
            'name': name if code else None,
            'body': body,
            'createdAt': created_at,
            'updatedAt': updated_at or created_at,
        })
    return items
