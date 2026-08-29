# -*- coding: utf-8 -*-
"""main.py는 fastapi 의존이라 import 불가 - /earnings-calendar 응답 슬리밍 계약을
소스 텍스트로 검사한다(test_main_ohlc_minute_cache.py와 동일 패턴)."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class EarningsCalendarResponseTest(unittest.TestCase):
    def read(self):
        return (ROOT / 'scripts' / 'cloud-vm' / 'main.py').read_text(encoding='utf-8')

    def test_endpoint_drops_frontend_unused_fields_before_caching(self):
        src = self.read()
        # 프론트(home-widgets/home-weekly-report/stock-calendar) 어디서도 안 쓰는
        # 무거운 내부 필드를 HTTP 응답에서 뺀다. merge_month 내부 계산에는 남는다.
        for field in (
            'corp_code', 'report_name', 'receipt_date',
            'eps_actual', 'eps_estimate', 'revenue_actual', 'revenue_estimate',
            'operating_profit_actual', 'net_income_actual',
        ):
            self.assertIn("'%s'" % field, src.split('_EARNINGS_CLIENT_DROP_FIELDS')[1].split(')')[0])
        # 슬리밍은 캐시 저장 직전에 한 번만 - 캐시도 슬림 상태로 재사용된다.
        self.assertIn("data = _slim_calendar_events(data)\n    _earnings_calendar_cache[key] = {'t': time.time(), 'data': data}", src)
        # 표시용 요약 문자열은 그대로 남겨야 한다.
        self.assertNotIn("'result'", src.split('_EARNINGS_CLIENT_DROP_FIELDS')[1].split(')')[0])


if __name__ == '__main__':
    unittest.main()
