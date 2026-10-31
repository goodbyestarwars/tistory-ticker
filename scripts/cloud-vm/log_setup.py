"""Route existing stdlib logging to local rsyslog; no queue, buffer or extra process.

local1 = application log (INFO+), local0 = user events (one short JSON line).
rsyslog files them under /var/log/9pay and collapses consecutive repeats.
"""
import json
import logging
import logging.handlers
import sys
import time

MAX_LINE = 512
_FACILITY = logging.handlers.SysLogHandler


class _Truncate(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        if record.exc_info and record.levelno >= logging.ERROR:
            message += '\n' + logging.Formatter().formatException(record.exc_info)
        record.msg, record.args, record.exc_info, record.exc_text = message[:MAX_LINE], None, None, None
        return True


def _handler(facility, fmt):
    try:
        handler = logging.handlers.SysLogHandler(address='/dev/log', facility=facility)
    except OSError:
        handler = logging.StreamHandler(sys.stderr)  # systemd captures stderr into journald
    handler.setFormatter(logging.Formatter(fmt))
    handler.addFilter(_Truncate())
    return handler


def configure(tag):
    """Replace root handlers once per process; existing getLogger() callers stay unchanged."""
    root = logging.getLogger()
    if getattr(root, '_ninepay_syslog', False):
        return
    root.handlers[:] = [_handler(_FACILITY.LOG_LOCAL1, tag + ': %(name)s %(levelname)s %(message)s')]
    root.setLevel(logging.INFO)
    events = logging.getLogger('events')
    events.handlers[:] = [_handler(_FACILITY.LOG_LOCAL0, tag + ': %(message)s')]
    events.propagate = False
    root._ninepay_syslog = True


def event(ev, u, **fields):
    """u must be a hash/internal id; callers never pass keys, tokens, accounts or raw IPs."""
    line = json.dumps(dict(ts=int(time.time()), u=u, ev=ev, **fields), ensure_ascii=False, separators=(',', ':'))
    logging.getLogger('events').info(line)


def user_ref(sub, secret):
    """Stable, non-reversible 12-char user reference for event lines."""
    if not sub or not secret:
        return '-'
    import hashlib
    import hmac
    key = secret if isinstance(secret, bytes) else str(secret).encode('utf-8')
    return hmac.new(key, str(sub).encode('utf-8'), hashlib.sha256).hexdigest()[:12]
