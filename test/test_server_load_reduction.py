# -*- coding: utf-8 -*-
"""서버 부하 절감 계약(2026-09-15).

사용자 지시: "지금 돈 쓰는 건 무리야. 다른 방법으로 서버 부하를 낮춰야해", "커밋 표시하고".
e2-micro 한 대에서 국내 시장 수집기들이 장이 닫힌 시간에도 같은 주기로 돌고, 지연 모니터가
무거운 엔드포인트 7개를 5분마다 불렀다. 배포 반영 여부도 밖에서 알 수 없었다.
"""

import os
import sys
import unittest
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')
sys.path.insert(0, CLOUD_VM)

import market_clock  # noqa: E402

KST = market_clock.KST


def kst(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=KST)


def read(name):
    with open(os.path.join(CLOUD_VM, name), encoding='utf-8') as handle:
        return handle.read()


class MarketClockTests(unittest.TestCase):
    def test_kr_active_window_on_trading_day(self):
        self.assertFalse(market_clock.kr_market_active(kst(2026, 9, 15, 7, 49)))
        self.assertTrue(market_clock.kr_market_active(kst(2026, 9, 15, 7, 50)))    # NXT 프리마켓 직전
        self.assertTrue(market_clock.kr_market_active(kst(2026, 9, 15, 19, 59)))   # 애프터마켓
        self.assertTrue(market_clock.kr_market_active(kst(2026, 9, 15, 20, 10)))
        self.assertFalse(market_clock.kr_market_active(kst(2026, 9, 15, 20, 11)))

    def test_kr_inactive_on_weekend_and_holiday(self):
        self.assertFalse(market_clock.kr_market_active(kst(2026, 9, 19, 10, 0)))   # 토요일
        self.assertFalse(market_clock.kr_market_active(kst(2026, 9, 24, 10, 0)))   # 추석 연휴

    def test_us_futures_weekend_window(self):
        self.assertFalse(market_clock.us_futures_weekend_closed(kst(2026, 9, 19, 7, 59)))  # 토 새벽은 아직 열려 있을 수 있다
        self.assertTrue(market_clock.us_futures_weekend_closed(kst(2026, 9, 19, 8, 0)))
        self.assertTrue(market_clock.us_futures_weekend_closed(kst(2026, 9, 20, 23, 0)))   # 일요일
        self.assertTrue(market_clock.us_futures_weekend_closed(kst(2026, 9, 21, 5, 59)))
        self.assertFalse(market_clock.us_futures_weekend_closed(kst(2026, 9, 21, 6, 0)))
        self.assertFalse(market_clock.us_futures_weekend_closed(kst(2026, 9, 16, 3, 0)))   # 평일 새벽

    def test_sleep_seconds_never_shortens_the_original_interval(self):
        self.assertEqual(market_clock.sleep_seconds(True, 60), 60)
        self.assertEqual(market_clock.sleep_seconds(False, 60), market_clock.IDLE_SEC)
        self.assertEqual(market_clock.sleep_seconds(False, 3600), 3600)


class CollectorWiringTests(unittest.TestCase):
    def test_kr_market_collectors_slow_down_when_market_is_closed(self):
        main = read('main.py')
        self.assertIn('time.sleep(market_clock.sleep_seconds(market_clock.kr_market_active(),\n'
                      '                                              _DOMESTIC_MARKET_INDICATORS_TTL))', main)
        self.assertIn('time.sleep(market_clock.sleep_seconds(market_clock.kr_market_active(), interval))',
                      read('market_temp.py'))
        self.assertIn('time.sleep(market_clock.sleep_seconds(market_clock.kr_market_active(), _RECENT_POLL_SEC))',
                      read('investor_trend.py'))
        domestic = read('domestic_futures.py')
        self.assertIn('time.sleep(_REALTIME_POLL_SEC if kr_active else _OFF_HOURS_POLL_SEC)', domestic)
        self.assertIn('if kr_active and now - last_minute_refresh > _MINUTE_REFRESH_INTERVAL:', domestic)
        self.assertIn('market_clock.us_futures_weekend_closed()', read('foreign_futures.py'))

    def test_latency_monitor_runs_every_15_minutes(self):
        deploy = read('deploy_check.sh')
        gate = deploy.index('if [ $((10#$(date -u +%M) % 15)) -lt 5 ]; then')
        self.assertLess(gate, deploy.index('"$PYTHON" "$APP_DIR/latency_monitor.py" 200>&- >/dev/null 2>&1 &'))


class HealthCommitTests(unittest.TestCase):
    def test_health_reports_deployed_commit_and_process_start(self):
        main = read('main.py')
        start = main.index("@app.get('/health')\n")
        body = main[start:main.index('\n\n\n', start)]
        for key in ("'deployedCommit': sha", "'deployedCommitShort': sha[:7] if sha else None",
                    "'deployRecordedAt': recorded_at", "'processStartedAt': _PROCESS_STARTED_AT"):
            self.assertIn(key, body)
        self.assertIn("'.last_deployed_sha'", main)
        # deploy_check.sh가 쓰는 파일 이름과 같아야 한다.
        self.assertIn('DEPLOYED_FILE="$APP_DIR/.last_deployed_sha"', read('deploy_check.sh'))
        # 파일 내용이 SHA 모양이 아니면 내보내지 않는다.
        self.assertIn("re.fullmatch(r'[0-9a-f]{7,40}', sha or '')", main)


if __name__ == '__main__':
    unittest.main()
