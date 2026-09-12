# -*- coding: utf-8 -*-
"""종목분석 종목조회가 첫 화면을 그리기까지 물고 있는 시간의 상한을 고정한다.

배경(2026-09-12 실측, page-speed 모바일 3회 중앙값): 종목분석(종목조회)의
"쓸 수 있게 되기까지"가 30.24초였고 3회 중 1회는 45초 안에도 안 떴다.
같은 시각 개별 API는 /foreign-flow 10.5초, /flow-chart 4.0초,
/investor-flow 2.7초, GAS fundamentals 2.1초였다 - 즉 어느 하나가 30초인 게
아니라, renderResult가 Promise.all로 전부 기다리는 동안 상한이 사실상
없었던 것이 원인이다.

여기서 고정하는 건 "무엇을 화면에 그리는가"가 아니라 "얼마나 기다리다
포기하는가"다. 정상 응답(실측치)은 전부 한도 안에 들어오므로 평소 화면
내용은 달라지지 않는다.
"""
import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class ForeignFlowTimeoutTest(unittest.TestCase):
    def read(self):
        return (ROOT / 'js' / 'foreign-flow.js').read_text(encoding='utf-8')

    def const(self, src, name):
        match = re.search(r'var %s = (\d+);' % name, src)
        self.assertIsNotNone(match, '%s 상수가 없다' % name)
        return int(match.group(1))

    def test_flow_fetch_no_longer_waits_a_full_minute(self):
        """수급 본조회는 60초를 기다렸다. 실측 10.5초라 60초는 정상 응답을
        기다리는 시간이 아니라 죽은 요청을 붙들고 있는 시간이다. 재시도 1회 +
        GAS 폴백까지 겹치면 최악 140초 동안 화면이 막혔다."""
        src = self.read()
        self.assertNotIn('fetchJson(vmUrl, 60000)', src)
        self.assertIn('fetchJson(vmUrl, FLOW_VM_TIMEOUT_MS)', src)
        self.assertLessEqual(self.const(src, 'FLOW_VM_TIMEOUT_MS'), 20000)

    def test_gas_chart_fallback_is_bounded(self):
        """GAS ?action=flowChart는 VM /ohlc를 다시 부르는 경유지라 28~30초가
        걸린 적이 있다(2026-09-03). renderResult는 차트가 없으면
        buildFlowChartFallback으로 대체하므로 무한정 기다릴 이유가 없다."""
        src = self.read()
        self.assertIn(
            "fetchJson(GAS_TICKER_URL + '?action=flowChart&code=' + encodeURIComponent(code), FLOW_CHART_GAS_TIMEOUT_MS)",
            src,
        )
        self.assertLessEqual(self.const(src, 'FLOW_CHART_GAS_TIMEOUT_MS'), 10000)

    def test_investor_flow_has_a_deadline_but_not_a_tight_one(self):
        """공매도·신용·연기금 보조지표는 실측 2.7초다. 한도가 그보다 넉넉해야
        평소에는 값이 그대로 실리고 병적인 꼬리만 잘린다. entry는 코드 전역이
        `entry && ...`로 다루는 값이라 null이 이미 정상 입력이다."""
        src = self.read()
        self.assertIn(
            'var investorFlowRaced = withDeadline(investorFlowPromise, INVESTOR_FLOW_DEADLINE_MS, null);',
            src,
        )
        # 검색 경로와 랭킹 리스트 클릭 경로(loadSignalSummary) 둘 다여야 한다 -
        # 한쪽만 고치면 같은 증상이 다른 입구로 그대로 남는다.
        self.assertEqual(2, src.count('investorFlowRaced = withDeadline('))
        self.assertNotIn('investorFlowPromise, quotePromise', src)
        self.assertNotIn('investorFlowPromise, quoteRaced', src)
        deadline = self.const(src, 'INVESTOR_FLOW_DEADLINE_MS')
        self.assertGreaterEqual(deadline, 5000)   # 실측 2.7초를 자르면 안 된다
        self.assertLessEqual(deadline, 10000)

    def test_fundamentals_stays_blocking_on_purpose(self):
        """펀더멘탈은 computeFundamentalScore를 거쳐 화면의 '종합점수'에 들어간다.
        데드라인을 걸면 드물게 반쪽 데이터로 계산한 점수가 나온다 - 그러지 않기로
        한 결정이 코드에 적혀 있고, 이번에도 유지한다."""
        src = self.read()
        self.assertIn('fundamentalsPromise', src)
        self.assertNotIn('withDeadline(fundamentalsPromise', src)


if __name__ == '__main__':
    unittest.main()
