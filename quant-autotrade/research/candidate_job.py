# -*- coding: utf-8 -*-
"""Legacy entry point; scheduled candidate production belongs to research_job."""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import candidate_gen as cg

KST = timezone(timedelta(hours=9))


def run(conn, now_fn=None, sleep_fn=time.sleep, interval=60):
    now_fn = now_fn or (lambda: datetime.now(KST))
    start = now_fn()
    end = start.replace(hour=8, minute=15, second=0, microsecond=0)
    if start >= end:
        end += timedelta(days=1)
    while now_fn() < end:
        now = now_fn()
        try:
            ok, reason, created = cg.generate(conn, cg.fetch_scan(), now, now_epoch=now.timestamp())
            if ok:
                return {'ok': True, 'reason': reason, 'created': created}
        except Exception as exc:
            reason = type(exc).__name__
        sleep_fn(interval)
    return {'ok': False, 'reason': reason if 'reason' in locals() else 'NO_SCAN', 'created': 0}


def main():
    # Keep the old executable safe if an exported task is restored. Both names
    # then use research.lock, research.db and the same status/paper workflow.
    import research_job
    research_job.main()


if __name__ == '__main__':
    main()
