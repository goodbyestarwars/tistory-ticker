"""신규 상장 종목 자동 등록 회귀: 추가 전용·교차 확인·ETN 분리·VM 유니버스 비오염.

네트워크 없이 실행된다(소스는 합성 데이터). 마지막 클래스만 저장소의 실제 data/krx_map.js를 읽는다.
실행: python -m unittest discover -s test -p 'test_sync_listings.py'
"""
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import kis_master  # noqa: E402
import krx_map_io  # noqa: E402
import sync_listings as sync  # noqa: E402

# daily_scan/batch_scan/strategy_scan이 쓰는 VM 유니버스 정규식(복사본이 아니라 같은 식을 검증용으로 둔다).
VM_PAIR = re.compile(r'"([^"]+)":"([0-9A-Za-z]{6})"')

OLD_FORMAT = (
    'window.KRX_MAP={"삼성전자":"005930","KODEX 200":"069500"};\n'
    'window.KRX_MAP["래블업"]="0147B0";\n'
    'window.KRX_ETF_NAMES=["KODEX 200"];\n'
    'window.KRX_MAP["동원파츠"]="0162D0";'
)


def kis_row(code, name, group, market):
    tail = kis_master.TAIL[market]
    head = code.ljust(9) + 'KR7' + code + '000'
    return head + name + (group + 'X' * (tail - 3)) + '\n'


def kis(code, name, group='ST', market='KOSDAQ'):
    return {'code': code, 'name': name, 'group': group, 'market': market}


def base_kis(extra=()):
    rows = [kis('005930', '삼성전자', 'ST', 'KOSPI')]
    rows += [kis('%06d' % (100000 + i), 'K%d' % i, 'ST', 'KOSPI') for i in range(1800)]
    rows += [kis('%06d' % (300000 + i), 'Q%d' % i, 'ST', 'KOSDAQ') for i in range(1500)]
    return rows + list(extra)


def base_naver(extra_kospi=None, extra_kosdaq=None, etn=250):
    kospi = {'005930': {'name': '삼성전자', 'type': 'stock'}}
    for i in range(1800):
        kospi['%06d' % (100000 + i)] = {'name': 'K%d' % i, 'type': 'stock'}
    for i in range(etn):
        kospi['%06d' % (600000 + i)] = {'name': 'ETN%d' % i, 'type': 'etn'}
    kosdaq = {}
    for i in range(1500):
        kosdaq['%06d' % (300000 + i)] = {'name': 'Q%d' % i, 'type': 'stock'}
    kospi.update(extra_kospi or {})
    kosdaq.update(extra_kosdaq or {})
    return {'KOSPI': kospi, 'KOSDAQ': kosdaq}


def known_map():
    mapping = {'삼성전자': '005930'}
    mapping.update({'K%d' % i: '%06d' % (100000 + i) for i in range(1800)})
    mapping.update({'Q%d' % i: '%06d' % (300000 + i) for i in range(1500)})
    return krx_map_io.KrxMap(mapping, [], [])


class KrxMapIoTest(unittest.TestCase):
    def test_old_format_appended_lines_are_folded_into_main_map(self):
        data = krx_map_io.parse(OLD_FORMAT)
        self.assertEqual(data.map['래블업'], '0147B0')
        self.assertEqual(data.map['동원파츠'], '0162D0')
        self.assertEqual(data.etf_names, ['KODEX 200'])
        text = krx_map_io.render(data)
        self.assertNotIn('window.KRX_MAP["', text)  # 덧붙임 줄은 본 맵 안으로 이동
        pairs = dict((n, c) for n, c in VM_PAIR.findall(text))
        self.assertEqual(pairs['동원파츠'], '0162D0')  # VM 유니버스 정규식에 이제 보인다

    def test_roundtrip_is_stable_and_keeps_etn(self):
        data = krx_map_io.parse(OLD_FORMAT)
        data.etn = [['삼성 인버스 ETN', '500001']]
        once = krx_map_io.render(data)
        twice = krx_map_io.render(krx_map_io.parse(once))
        self.assertEqual(once, twice)
        self.assertIn('window.KRX_ETN=[["삼성 인버스 ETN","500001"]];', once)

    def test_etn_is_invisible_to_vm_universe_regex(self):
        data = krx_map_io.parse(OLD_FORMAT)
        data.etn = [['삼성 인버스 ETN', '500001']]
        text = krx_map_io.render(data)
        self.assertNotIn('500001', [c for _, c in VM_PAIR.findall(text)])

    def test_unrecognised_file_is_rejected(self):
        with self.assertRaises(ValueError):
            krx_map_io.parse('var x = 1;')


class KisMasterTest(unittest.TestCase):
    def test_parse_rows_reads_code_name_group(self):
        text = kis_row('495910', '이에스티', 'ST', 'KOSDAQ') + kis_row('0222E0', '아이엠스팩1호', 'ST', 'KOSDAQ')
        rows = kis_master.parse_rows(text, 'KOSDAQ')
        self.assertEqual([(r['code'], r['name'], r['group']) for r in rows],
                         [('495910', '이에스티', 'ST'), ('0222E0', '아이엠스팩1호', 'ST')])

    def test_duplicate_or_truncated_rows_fail(self):
        row = kis_row('495910', '이에스티', 'ST', 'KOSDAQ')
        with self.assertRaises(ValueError):
            kis_master.parse_rows(row + row, 'KOSDAQ')
        with self.assertRaises(ValueError):
            kis_master.parse_rows('495910   short\n', 'KOSDAQ')


class NaverFetchTest(unittest.TestCase):
    def test_paginates_until_short_page(self):
        pages = {1: [{'itemCode': '%06d' % i, 'stockName': 'N%d' % i, 'stockEndType': 'stock'} for i in range(100)],
                 2: [{'itemCode': '900001', 'stockName': '막페이지', 'stockEndType': 'etn'}]}

        def getter(url):
            page = int(re.search(r'page=(\d+)', url).group(1))
            return {'stockListCategoryType': 'KOSPI', 'stocks': pages[page]}

        rows = sync.fetch_naver_market('KOSPI', getter=getter, sleep=lambda _s: None)
        self.assertEqual(len(rows), 101)
        self.assertEqual(rows['900001']['type'], 'etn')

    def test_market_mismatch_and_empty_first_page_fail(self):
        with self.assertRaises(ValueError):
            sync.fetch_naver_market('KOSPI', getter=lambda u: {'stockListCategoryType': 'KOSDAQ', 'stocks': [{}]},
                                    sleep=lambda _s: None)
        with self.assertRaises(ValueError):
            sync.fetch_naver_market('KOSPI', getter=lambda u: {'stockListCategoryType': 'KOSPI', 'stocks': []},
                                    sleep=lambda _s: None)


class PlanTest(unittest.TestCase):
    def test_adds_only_when_both_sources_agree(self):
        kis_rows = base_kis([kis('493410', '넥스아이'), kis('471800', '에이엘로봇'),
                             kis('0232A0', 'MIDAS 머니마켓액티브', 'EF', 'KOSPI')])
        naver = base_naver(
            extra_kosdaq={'493410': {'name': '넥스아이', 'type': 'stock'}},
            extra_kospi={'0232A0': {'name': 'MIDAS 머니마켓액티브', 'type': 'etf'}})
        # 471800은 KIS에만 있다 → 보류
        result = sync.plan(known_map(), kis_rows, naver)
        self.assertEqual([i['code'] for i in result['add_map']], ['493410', '0232A0'])
        self.assertEqual(result['add_etf'], ['MIDAS 머니마켓액티브'])
        self.assertEqual(result['single_source'], [{'code': '471800', 'name': '에이엘로봇', 'only': 'KIS'}])

    def test_etn_comes_from_naver_only_and_goes_to_etn_list(self):
        result = sync.plan(known_map(), base_kis(), base_naver())
        self.assertEqual(len(result['add_etn']), 250)
        self.assertEqual(result['add_map'], [])
        data = sync.apply(known_map(), result)
        self.assertEqual(len(data.etn), 250)
        self.assertEqual(len(data.map), 3301)  # ETN은 본 맵에 들어가지 않는다

    def test_never_removes_and_reports_stale(self):
        data = known_map()
        data.map['옛상장사'] = '123456'
        result = sync.plan(data, base_kis(), base_naver(etn=250))
        self.assertIn('123456', result['stale'])
        sync.apply(data, result)
        self.assertEqual(data.map['옛상장사'], '123456')

    def test_name_conflict_with_other_code_is_skipped(self):
        data = known_map()
        data.map['넥스아이'] = '111111'
        kis_rows = base_kis([kis('493410', '넥스아이')])
        naver = base_naver(extra_kosdaq={'493410': {'name': '넥스아이', 'type': 'stock'}})
        result = sync.plan(data, kis_rows, naver)
        self.assertEqual(result['add_map'], [])
        self.assertEqual(result['name_conflict'][0]['owner'], '111111')

    def test_second_run_is_idempotent(self):
        kis_rows = base_kis([kis('493410', '넥스아이')])
        naver = base_naver(extra_kosdaq={'493410': {'name': '넥스아이', 'type': 'stock'}})
        data = known_map()
        sync.apply(data, sync.plan(data, kis_rows, naver))
        again = sync.plan(data, kis_rows, naver)
        self.assertEqual((again['add_map'], again['add_etn']), ([], []))


class RunGuardTest(unittest.TestCase):
    def _file(self):
        handle = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8')
        handle.write(krx_map_io.render(known_map()))
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_source_shortage_aborts_without_touching_file(self):
        path = self._file()
        before = Path(path).read_text(encoding='utf-8')
        with self.assertRaises(ValueError):
            sync.run(kis_rows=base_kis()[:100], naver=base_naver(), path=path)
        with self.assertRaises(ValueError):
            sync.run(kis_rows=base_kis(), naver=base_naver(etn=10), path=path)
        self.assertEqual(Path(path).read_text(encoding='utf-8'), before)

    def test_bulk_guard_and_allow_bulk(self):
        path = self._file()
        many = {'%06d' % (700000 + i): {'name': 'X%d' % i, 'type': 'etn'} for i in range(700)}
        naver = base_naver(extra_kospi=many)
        with self.assertRaises(ValueError):
            sync.run(kis_rows=base_kis(), naver=naver, path=path)
        sync.run(kis_rows=base_kis(), naver=naver, path=path, allow_bulk=True)
        self.assertEqual(len(krx_map_io.load(path).etn), 950)

    def test_dry_run_writes_nothing(self):
        path = self._file()
        before = Path(path).read_text(encoding='utf-8')
        sync.run(dry_run=True, kis_rows=base_kis(), naver=base_naver(), path=path)
        self.assertEqual(Path(path).read_text(encoding='utf-8'), before)


class RepositoryFileTest(unittest.TestCase):
    """저장소의 실제 data/krx_map.js: 형식과 VM 유니버스 비오염."""

    @classmethod
    def setUpClass(cls):
        cls.text = (ROOT / 'data' / 'krx_map.js').read_text(encoding='utf-8')
        cls.data = krx_map_io.parse(cls.text)

    def test_no_leftover_appended_lines(self):
        self.assertNotRegex(self.text, r'(?m)^window\.KRX_MAP\["')

    def test_codes_are_unique_across_map_and_etn(self):
        codes = list(self.data.map.values()) + [r[1] for r in self.data.etn]
        self.assertEqual(len(codes), len(set(codes)))

    def test_vm_universe_regex_sees_every_map_entry_but_no_etn(self):
        vm = dict(VM_PAIR.findall(self.text))
        self.assertEqual(vm, self.data.map)
        for _name, code in self.data.etn:
            self.assertNotIn(code, vm.values())

    def test_known_manual_registrations_survive(self):
        for name, code in (('래블업', '0147B0'), ('동원파츠', '0162D0'), ('이에스티', '495910')):
            self.assertEqual(self.data.map.get(name), code)


if __name__ == '__main__':
    unittest.main()
