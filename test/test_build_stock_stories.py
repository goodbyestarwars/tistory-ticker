"""build_stock_stories: 카드는 기준을 넘는 종목에만, 값은 입력에서만 나온다."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import build_stock_stories as bss  # noqa: E402


def short_row(dt, vol, sh, avg='100'):
    return {'dt': dt, 'trde_qty': str(vol), 'shrts_qty': str(sh), 'shrts_avg_pric': avg}


def days(n, start=20261001):
    return [str(start + i) for i in range(n)]


def invsr(frgn, orgn, ind, n=20):
    return [{'dt': d, 'frgnr_invsr': str(frgn), 'orgn': str(orgn), 'ind_invsr': str(ind)} for d in days(n)]


BASIC = {'stk_nm': '테스트', 'cur_prc': '-60000', '250hgst': '+100000', '250lwst': '-58000',
         'per': '10.5', 'pbr': '0.8', 'bps': '90000', 'mac': '50000', 'bus_pro': '3000'}


class BuildTests(unittest.TestCase):
    def entry(self, basic=BASIC, short=None, inv=None):
        return bss.build_entry('999999', basic, short or [], inv or [], '2026-11-03')

    def test_quiet_stock_gets_no_card(self):
        basic = dict(BASIC, cur_prc='95000', pbr='1.4', bus_pro='-10')
        short = [short_row(d, 1000, 10) for d in days(20)]
        inv = invsr(1, 1, -2)
        self.assertIsNone(self.entry(basic, short, inv))

    def test_profit_gap_and_below_book_and_risk_card(self):
        e = self.entry(short=[short_row(d, 1000, 10) for d in days(20)])
        titles = [c['title'] for c in e['cards']]
        self.assertTrue(titles[0].startswith('흑자인데 주가는 고점 대비 -40'))
        self.assertTrue(any('순자산보다 싼데' in t for t in titles))
        self.assertEqual(titles[-1], '이 이야기가 틀려지는 때')
        self.assertTrue(e['auto'])

    def test_flow_card_needs_offsetting_buyer_and_size(self):
        # 20일 합: 외국인 -600억(백만원 -60000*... 행당 -3000백만=-30억), 개인 +25억*20
        inv = invsr(-3000, 0, 2400)  # 외국인 -600억, 개인 +480억 (시총 50000억원의 1.2%)
        e = self.entry(dict(BASIC, bus_pro='-1', pbr='2'), inv=inv)
        self.assertIsNotNone(e)
        self.assertIn('외국인이 판 600억원을 개인이 받았다', e['cards'][0]['title'])
        small = invsr(-100, 0, 90)
        self.assertIsNone(self.entry(dict(BASIC, bus_pro='-1', pbr='2'), inv=small))

    def test_short_high_share_card_uses_volume_share_not_balance(self):
        short = [short_row(d, 1000, 120) for d in days(20)]  # 12%
        e = self.entry(dict(BASIC, bus_pro='-1', pbr='2'), short=short)
        self.assertEqual(e['cards'][0]['title'], '거래량의 12%가 공매도다')
        self.assertIn('잔고가 아니다', ' '.join(e['cards'][0]['detail']))

    def test_short_jump_card(self):
        rows = [short_row(d, 1000, 20) for d in days(15, 20261001)] + [short_row(d, 1000, 90) for d in days(5, 20261020)]
        e = self.entry(dict(BASIC, bus_pro='-1', pbr='2'), short=rows)
        self.assertTrue(e['cards'][0]['title'].startswith('공매도 비중이 4.5배로 뛰었다'))

    def test_merge_keeps_manual_and_replaces_old_auto(self):
        existing = {'042660': {'name': '한화오션', 'cards': []}, '111111': {'auto': True, 'cards': []}}
        out = bss.merge(existing, {'222222': {'auto': True}, '042660': {'auto': True}})
        self.assertEqual(set(out), {'042660', '222222'})
        self.assertNotIn('auto', out['042660'])


    def test_write_output_shards_auto_entries_and_indexes_them(self):
        import tempfile, os, json, re
        with tempfile.TemporaryDirectory() as d:
            old = (bss.OUTPUT_FILE, bss.STORIES_DIR)
            bss.OUTPUT_FILE, bss.STORIES_DIR = os.path.join(d, 'stock-stories.js'), os.path.join(d, 'stories')
            try:
                os.makedirs(bss.STORIES_DIR)
                open(os.path.join(bss.STORIES_DIR, '999999.js'), 'w').write('x')
                manual = {'042660': {'name': '한화오션', 'cards': []}}
                bss.write_output(manual, {'222222': {'auto': True, 'cards': []}, '042660': {'auto': True}}, [], False)
                self.assertEqual(sorted(os.listdir(bss.STORIES_DIR)), ['222222.js'])  # 오래된 파일 삭제, 수기 코드는 분할하지 않음
                main = open(bss.OUTPUT_FILE, encoding='utf-8').read()
                self.assertEqual(json.loads(re.search(r'STOCK_STORY_INDEX=(\[.*\]);', main).group(1)), ['222222'])
                existing, index = bss.load_existing()
                self.assertEqual((list(existing), index), (['042660'], ['222222']))
                bss.write_output(manual, {'333333': {'auto': True, 'cards': []}}, index, True)  # --codes는 기존 파일 보존
                self.assertEqual(sorted(os.listdir(bss.STORIES_DIR)), ['222222.js', '333333.js'])
            finally:
                bss.OUTPUT_FILE, bss.STORIES_DIR = old


if __name__ == '__main__':
    unittest.main()


class BelowBookScaleTests(unittest.TestCase):
    def test_bps_above_high_keeps_widths_within_100(self):
        b = {'pbr': 0.4, 'cur': 100.0, 'lo': 98.0, 'hi': 150.0, 'bps': 400.0}
        card = bss.card_below_book(b)
        self.assertTrue(all(1 <= r['w'] <= 100 for r in card['rows']))
