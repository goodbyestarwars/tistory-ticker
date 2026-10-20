"""Per-stock, per-call MA reuse. Exact original summation order is retained."""
from contextvars import ContextVar
from functools import wraps

_scope = ContextVar('scan_indicator_scope', default=None)


def shared(fn):
    @wraps(fn)
    def run(*args, **kwargs):
        if _scope.get() is not None:
            return fn(*args, **kwargs)
        # scan_stock's daily argument is read-only during its single call.
        daily = args[1] if len(args)>1 else kwargs.get('daily')
        token = _scope.set((daily, {}))
        try:
            return fn(*args, **kwargs)
        finally:
            _scope.reset(token)  # Release all per-stock arrays, including failures.
    return run


def lookup(win, field, period):
    scope = _scope.get()
    if scope is None or win is not scope[0]:
        return None, None
    # Distinct suffixes must retain their own starting summation order. Only
    # the same unmodified daily input is reused; never identify by length.
    cache = scope[1]
    key = (field, period)
    found = cache.get(key)
    if found is not None:
        return list(found), None  # Never expose a mutable shared result.
    return None, (cache, key)


def store(slot, values):
    if slot is not None:
        cache, key = slot
        cache[key] = tuple(values)
