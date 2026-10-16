# -*- coding: utf-8 -*-
"""국내주요지수(js/domestic-market-indicators.js)·선물지표(js/kospi-futures.js) 차트의 그리기 도구가
공통 차트 엔진(js/chart-drawing.js)을 쓰는지 확인한다(2026-10-16 사용자 요청: 끌어서 그리기, 공통 차트와 같은 도구)."""

import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


class IndexFuturesCommonDrawingTest(unittest.TestCase):
    CASES = (
        ('js/domestic-market-indicators.js', 'dmi', 'dmi-drawings', 'dmi-drawing-layer'),
        ('js/kospi-futures.js', 'kf', 'kf-drawings', 'kf-drawing-layer'),
    )

    def test_uses_shared_engine_with_all_tools_and_anchored_points(self):
        for path, prefix, storage, layer in self.CASES:
            src = read(path)
            self.assertIn('Drawing.attach({', src, path)
            self.assertIn("core.loadModule('drawing')", src, path)
            self.assertIn('chart-core.js?v=', src, path)
            self.assertIn("point: 'anchored'", src, path)          # 마지막 봉 오른쪽 빈 공간에도 그릴 수 있다
            self.assertIn("tools: ['line', 'pencil', 'circle', 'box', 'hline']", src, path)
            self.assertIn("className: '%s'" % layer, src, path)
            self.assertIn("'tistory-ticker:%s:'" % storage, src, path)   # 저장 키는 예전 그대로(옛 도형 보존)
            self.assertIn('legacyArray: true', src, path)
            self.assertIn('sync: false', src, path)                 # 지수·선물은 서버 계정 저장 대상이 아니다

    def test_old_click_click_implementation_is_gone(self):
        for path, *_ in self.CASES:
            src = read(path)
            self.assertNotIn('state.pending', src, path)
            self.assertNotIn('orderedDrawingShape_', src, path)
            self.assertNotIn('orderedKfDrawingShape_', src, path)
            self.assertNotIn("overlay.addEventListener('click'", src, path)
            self.assertNotIn('xRatio', src, path)

    def test_toolbar_has_same_tools_as_common_chart_in_same_order(self):
        for path, prefix, *_ in self.CASES:
            src = read(path)
            order = ['%s-line-toggle' % prefix, '%s-circle-toggle' % prefix, '%s-box-toggle' % prefix,
                     '%s-hline-toggle' % prefix, '%s-pencil-toggle' % prefix, '%s-draw-clear' % prefix]
            positions = [src.index('class="%s' % c) if 'draw-clear' in c else src.index('%s-draw-toggle %s' % (prefix, c)) for c in order]
            self.assertEqual(positions, sorted(positions), path)
            for label in ('>직선<', '>동그라미<', '>박스<', '>가로선<', '>연필<', '>지우기<'):
                self.assertIn(label, src, path)
            self.assertIn('끌면 직선이 완성됩니다', src, path)
            self.assertNotIn('한 번 클릭', src, path)

    def test_buttons_are_still_moved_by_dashboard_layout_script(self):
        enh = read('js/dashboard-enhancements.js')
        for sel in ('.dmi-draw-toggle', '.dmi-draw-clear', '.kf-draw-toggle', '.kf-draw-clear'):
            self.assertIn(sel, enh)


if __name__ == '__main__':
    unittest.main()
