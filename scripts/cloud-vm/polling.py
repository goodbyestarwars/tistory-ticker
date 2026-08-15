# -*- coding: utf-8 -*-
"""VM 백그라운드 폴러가 공유하는 예외 처리·대기 루프."""

import time


def run_forever(refresh, interval_sec, logger, failure_message, stop_event=None):
    """refresh를 반복 실행한다.

    운영 코드는 기존처럼 daemon thread에서 호출하고, 테스트나 향후 graceful
    shutdown이 필요한 호출부는 stop_event를 넘길 수 있다.
    """
    while stop_event is None or not stop_event.is_set():
        try:
            refresh()
        except Exception:
            logger.exception(failure_message)
        if stop_event is None:
            time.sleep(interval_sec)
        else:
            stop_event.wait(interval_sec)
