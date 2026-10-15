# -*- coding: utf-8 -*-
"""KIND 시장조치 공시 수신(market_halt_kind) 테스트 - 2026-10-15 실제 공시 문구(코스피 사이드카 09:07:42, 코스닥 사이드카 09:12:23,
코스닥 CB 12:23:13~재개 12:43:13, 코스피 CB 12:38:12~재개 12:58:12)를 고정해 쓴다. 네트워크 호출 없음."""
import os
import sys
import unittest
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import circuit_breaker as cb  # noqa: E402
import market_halt_kind as mk  # noqa: E402

KST = mk.KST


def kst(h, m, s=0, day=15):
    return datetime(2026, 10, day, h, m, s, tzinfo=KST)


def row(hhmm, acpt, title, submitter):
    return ('<tr id="parkman"><td class="first txc">%s</td><td></td><td><a href="#viewer" onclick="openDisclsViewer(\'%s\',\'\')" title=\'%s\'>%s</a></td>'
            '<td>%s</td><td class="txc"><a href="#">차트</a></td></tr>' % (hhmm, acpt, title, title, submitter))


LIST_ROWS = [
    ('12:58', '20261015000248', '유가증권시장 매매거래재개 (CB 해제)', '유가증권시장본부'),
    ('12:43', '20261015000244', '코스닥시장 매매거래 재개(CB 해제)', '코스닥시장본부'),
    ('12:38', '20261015000243', '파생상품시장거래 중단ㆍ재개 및 가격제한폭 확대(유가증권시장 CB발동)', '파생상품시장본부'),
    ('12:38', '20261015000242', '유가증권시장 매매거래 일시중단(1단계 CB 발동)', '유가증권시장본부'),
    ('12:23', '20261015000237', '코스닥시장 매매거래 일시중단(1단계 CB 발동)', '코스닥시장본부'),
    ('12:19', '20261015000235', '주식선물 2단계 가격제한폭 확대요건 도달(하락)', '파생상품시장본부'),
    ('09:12', '20261015000075', '코스닥시장 프로그램매도호가 일시효력정지(Sidecar 발동)', '코스닥시장본부'),
    ('09:07', '20261015000069', '유가증권시장 매도 사이드카(Side car) 발동', '유가증권시장본부'),
    ('09:01', '20261015000050', '기업설명회(IR) 개최', '이뮨온시아'),
]
LIST_HTML = '<table><tbody>' + ''.join(row(*r) for r in LIST_ROWS) + '</tbody></table>'

BODIES = {
    '20261015000242': '유가증권시장 매매거래 일시중단(1단계 CB 발동) 1. 일자 및 시각 2026-10-15 12:38:12 2. 주가지수 변동내역 현재지수(P) 전일지수(P) 등락폭(P) 등락율(%) 5,528.05 6,008.81 -480.76 -8.00 3. 내용 코스피종합주가지수가 전일종가지수 대비 8% 이상 하락(1분간 지속)하여 향후 20분간 유가증권시장의 매매거래가 중단됨',
    '20261015000237': '코스닥시장 매매거래 일시중단(1단계 CB 발동) 1. 일자 및 시각 2026-10-15 12:23:13 2. 주가지수 변동내역 현재지수(P) 전일지수(P) 등락폭(P) 등락율(%) 757.88 823.88 -66.00 -8.01 3. 내용 향후 20분간 코스닥시장의 매매거래가 중단됨',
    '20261015000248': '유가증권시장 매매거래재개 (CB 해제) 1. 일자 및 시각 2026-10-15 12:58:12 2. 재개시 매매방법 - 매매거래 재개시 10분간 호가를 접수하여 단일가매매로 매매체결',
    '20261015000244': '코스닥시장 매매거래 재개(CB 해제) 1. 일자 및 시각 2026-10-15 12:43:13 2. 재개시 매매방법',
    '20261015000069': '유가증권시장 매도 사이드카(Side car) 발동 1. 조치 프로그램 매도호가 일시 효력정지 (사이드카 발동) 2. 발동일시 2026년10월15일 09시07분42초 3. KOSPI200을 기초자산으로 하는 선물 가격 변동내역 현재가(P) 기준가격(P) 등락폭(P) 등락율(%) 892.58 942.26 -49.68 -5.27 4. 내용 해당 선물 가격 하락 (5%이상, 1분이상)으로 향후 5분간 유가증권시장의 프로그램 매도호가 효력이 정지됨',
    '20261015000075': '코스닥시장 프로그램매도호가 일시효력정지(Sidecar 발동) 1. 일자 및 시각 2026-10-15 09:12:23 2. 코스닥150선물가격 및 현물지수 변동내역 구분 현재가(P) 전일종가(P) 등락폭(P) 등락율(%) 선물가격 1,317.20 1,405.10 -87.90 -6.25 현물지수(코스닥150) 1,312.01 1,403.60 -91.59 -6.52 3. 내용 향후 5분간 프로그램매도호가의 효력이 정지됨',
}


class FakeKind:
    """KIND 응답 흉내(목록 → 뷰어 → 본문 경로 → 본문). 요청 횟수를 센다."""

    def __init__(self, bodies=None, rows_html=LIST_HTML, fail=False):
        self.bodies, self.rows_html, self.fail = BODIES if bodies is None else bodies, rows_html, fail
        self.calls = []

    def __call__(self, url, data=None):
        self.calls.append((url, data))
        if self.fail:
            raise OSError('KIND down')
        if url.startswith(mk.LIST_URL):
            return self.rows_html
        if 'method=search&acptno=' in url:
            acpt = url.split('acptno=')[1].split('&')[0]
            return "<select id='mainDoc'><option value='%s|Y'selected>x</option></select>" % acpt
        if 'method=searchContents&docNo=' in url:
            doc = url.split('docNo=')[1]
            return "parent.setPath('t','https://kind.krx.co.kr/external/%s.htm','p','05','20');" % doc
        doc = url.split('/external/')[1].replace('.htm', '')
        return '<html><body><style>x{}</style>%s</body></html>' % self.bodies[doc]


class Base(unittest.TestCase):
    def setUp(self):
        with cb._lock:
            cb._halt.update({'events': [], 'source': None, 'source_url': None, 'refresh_sec': None, 'received_at': None, 'last_error': None})
        mk.DETAIL_GAP_SEC = 0
        mk._docs.clear()
        mk._rows.clear()
        mk._state.update({'date': None, 'primed': False, 'last_ok': None, 'last_error': None})


class ParsingTests(Base):
    def test_list_rows_and_market_level_classification(self):
        rows = mk.parse_list(LIST_HTML)
        self.assertEqual(len(rows), len(LIST_ROWS))
        by = {r['acptno']: r for r in rows}
        self.assertEqual(by['20261015000242']['hhmm'], '12:38')
        self.assertEqual(by['20261015000242']['submitter'], '유가증권시장본부')
        kinds = {a: mk.classify(r['title'], r['submitter']) for a, r in by.items()}
        self.assertEqual((kinds['20261015000242']['kind'], kinds['20261015000242']['market'], kinds['20261015000242']['stage'], kinds['20261015000242']['role']),
                         ('CIRCUIT_BREAKER', 'KOSPI', 1, 'START'))
        self.assertEqual((kinds['20261015000237']['market'], kinds['20261015000237']['stage']), ('KOSDAQ', 1))
        self.assertEqual((kinds['20261015000248']['role'], kinds['20261015000248']['market']), ('END', 'KOSPI'))
        self.assertEqual((kinds['20261015000244']['role'], kinds['20261015000244']['market']), ('END', 'KOSDAQ'))
        self.assertEqual((kinds['20261015000069']['kind'], kinds['20261015000069']['direction'], kinds['20261015000069']['market']), ('SIDECAR', 'SELL', 'KOSPI'))
        self.assertEqual((kinds['20261015000075']['kind'], kinds['20261015000075']['direction'], kinds['20261015000075']['market']), ('SIDECAR', 'SELL', 'KOSDAQ'))
        # 파생상품시장본부의 CB 연동·가격제한폭 공시, 개별 회사 공시는 시장 전체 조치가 아니다
        self.assertIsNone(kinds['20261015000243'])
        self.assertIsNone(kinds['20261015000235'])
        self.assertIsNone(kinds['20261015000050'])

    def test_company_named_like_a_halt_is_not_misread(self):
        self.assertIsNone(mk.classify('사이드카 발동 관련 안내', '삼성전자'))
        self.assertEqual(mk.classify('유가증권시장 매수 사이드카 발동', '유가증권시장본부')['direction'], 'BUY')

    def test_body_parsing_reads_seconds_change_and_duration(self):
        cbp = mk.parse_body(BODIES['20261015000242'])
        self.assertEqual(cbp['at'], kst(12, 38, 12))
        self.assertEqual((cbp['change_pct'], cbp['index_value']), (-8.0, 5528.05))
        side = mk.parse_body(BODIES['20261015000069'])
        self.assertEqual((side['at'], side['minutes'], side['change_pct']), (kst(9, 7, 42), 5, -5.27))
        kq = mk.parse_body(BODIES['20261015000075'])
        self.assertEqual((kq['at'], kq['change_pct']), (kst(9, 12, 23), -6.25))     # 선물 행(첫 행)을 쓴다
        self.assertIsNone(mk.parse_body('시각 정보 없음')['at'])


class EventBuildingTests(Base):
    def test_events_from_todays_real_notices(self):
        getter = FakeKind()
        events = {e['id']: e for e in mk.build_events(mk.parse_list(LIST_HTML), kst(13, 0), getter)}
        self.assertEqual(set(events), {'20261015000069', '20261015000075', '20261015000237', '20261015000242'})
        kospi_cb, kosdaq_cb = events['20261015000242'], events['20261015000237']
        self.assertEqual((kospi_cb['status'], kospi_cb['resumed_at'][11:19], kospi_cb['triggered_at'][11:19]), ('resumed', '12:58:12', '12:38:12'))
        self.assertEqual((kosdaq_cb['status'], kosdaq_cb['resumed_at'][11:19], kosdaq_cb['stage']), ('resumed', '12:43:13', 1))   # 코스닥 재개가 코스피 CB에 붙지 않는다
        side = events['20261015000069']
        self.assertEqual((side['market'], side['direction'], side['ends_at'][11:19], side['time_precision']), ('KOSPI', 'SELL', '09:12:42', 'second'))

    def test_each_notice_body_is_downloaded_once(self):
        getter = FakeKind()
        rows = mk.parse_list(LIST_HTML)
        mk.build_events(rows, kst(13, 0), getter)
        first = len(getter.calls)
        mk.build_events(rows, kst(13, 1), getter)
        self.assertEqual(len(getter.calls), first)                  # 같은 공시를 다시 받지 않는다
        self.assertEqual(first, 6 * 3)                              # 시장조치 6건 x (뷰어·문서번호·본문)

    def test_missing_timestamp_falls_back_to_list_minute_and_is_marked(self):
        bodies = dict(BODIES, **{'20261015000069': '유가증권시장 매도 사이드카(Side car) 발동 내용 없음'})
        events = {e['id']: e for e in mk.build_events(mk.parse_list(LIST_HTML), kst(13, 0), FakeKind(bodies))}
        e = events['20261015000069']
        self.assertEqual((e['time_precision'], e['triggered_at'][11:16]), ('minute', '09:07'))

    def test_failed_body_fetch_is_retried_not_cached(self):
        class Flaky(FakeKind):
            def __call__(self, url, data=None):
                if 'searchContents' in url and not getattr(self, 'ok', False):
                    raise OSError('x')
                return super().__call__(url, data)
        getter = Flaky()
        rows = mk.parse_list(LIST_HTML)
        self.assertEqual(mk.build_events(rows, kst(13, 0), getter), [])
        getter.ok = True
        self.assertEqual(len(mk.build_events(rows, kst(13, 1), getter)), 4)


class PollingTests(Base):
    def test_poll_feeds_the_dashboard_payload_with_source_and_not_realtime_label(self):
        getter = FakeKind()
        events = mk.poll_once(kst(13, 0), getter)
        self.assertEqual(len(events), 4)
        halt = cb.build_market_halt(kst(13, 0, 20))
        self.assertTrue(halt['available'])
        self.assertEqual(halt['source'], mk.SOURCE_LABEL)
        self.assertTrue(halt['source_url'].startswith('https://kind.krx.co.kr/'))
        self.assertIn('실시간 체결 데이터가 아니라', halt['delay_note'])
        self.assertEqual(halt['active_count'], 0)
        statuses = {e['id']: e['status'] for e in halt['events']}
        self.assertEqual(statuses['20261015000242'], 'resumed')
        self.assertEqual(statuses['20261015000069'], 'released')       # 발동 후 5분 경과(지속시간)로 해제
        side = [e for e in halt['events'] if e['id'] == '20261015000069'][0]
        self.assertEqual((side['basis'], side['released_at'][11:19]), ('DURATION_ELAPSED', '09:12:42'))

    def test_sidecar_is_active_for_its_stated_duration_then_released(self):
        mk.poll_once(kst(9, 8), FakeKind())
        active = cb.build_market_halt(kst(9, 8, 30))
        side = [e for e in active['events'] if e['id'] == '20261015000069'][0]
        self.assertEqual(side['status'], 'active')
        self.assertEqual(active['active_count'] >= 1, True)
        self.assertEqual(cb.get_payload(kst(9, 8, 30))['sidecar']['active'], True)
        mk.poll_once(kst(9, 12, 30), FakeKind())                                          # 30초 주기 확인이 이어진다
        later = [e for e in cb.build_market_halt(kst(9, 12, 43))['events'] if e['id'] == '20261015000069'][0]
        self.assertEqual(later['status'], 'released')

    def test_failure_keeps_last_events_then_turns_unknown(self):
        mk.poll_once(kst(13, 0), FakeKind())
        self.assertIsNone(mk.poll_once(kst(13, 0, 30), FakeKind(fail=True)))
        self.assertTrue(cb.build_market_halt(kst(13, 1))['available'])                     # 직전 수신이 3분 안이면 유지
        halt = cb.build_market_halt(kst(13, 4))
        self.assertFalse(halt['available'])                                                  # 수신이 끊긴 채 3분이 넘으면 확인 불가
        self.assertEqual((halt['reason'], halt['events']), ('FETCH_FAILED', []))                      # 수신이 끊긴 채 실패가 이어지면 '수신 실패'
        self.assertIn('KIND down', halt['last_error'])

    def test_after_first_poll_only_the_latest_page_is_requested_but_old_events_are_kept(self):
        getter = FakeKind()
        mk.poll_once(kst(13, 0), getter)
        getter.calls.clear()
        newer = '<table>' + row('13:05', '20261015000300', '기업설명회(IR) 개최', '회사') + '</table>'
        getter.rows_html = newer                                                              # 최신 1쪽에는 이전 시장조치가 없다
        events = mk.poll_once(kst(13, 1), getter)
        self.assertEqual(len([c for c in getter.calls if c[0].startswith(mk.LIST_URL)]), 1)
        self.assertEqual(len(events), 4)                                                      # 누적해 둔 이벤트는 사라지지 않는다

    def test_empty_list_after_ten_is_an_error_not_normal(self):
        getter = FakeKind(rows_html='<table></table>')
        self.assertIsNone(mk.poll_once(kst(11, 0), getter))
        self.assertIsNone(cb.build_market_halt(kst(11, 0, 10))['received_at'])

    def test_no_events_day_is_available_with_empty_list(self):
        quiet = '<table>' + row('09:01', '20261015000050', '기업설명회(IR) 개최', '회사') + '</table>'
        mk.poll_once(kst(10, 0), FakeKind(rows_html=quiet))
        halt = cb.build_market_halt(kst(10, 0, 20))
        self.assertEqual((halt['available'], halt['events']), (True, []))


class FetchFailureTests(Base):
    def test_blocked_source_is_reported_as_fetch_failed_not_normal(self):
        """운영 VM은 KIND에서 403을 받는다(2026-10-15 실측) - 수신 실패는 정상으로도 '미연결'로도 보이면 안 되고 실패로 구분한다."""
        cb.declare_halt_source(mk.SOURCE_LABEL, mk.SOURCE_URL, mk.POLL_SEC)
        self.assertIsNone(mk.poll_once(kst(10, 0), FakeKind(fail=True)))
        halt = cb.build_market_halt(kst(10, 0, 30))
        self.assertEqual((halt['available'], halt['reason'], halt['events']), (False, 'FETCH_FAILED', []))
        self.assertEqual(halt['source'], mk.SOURCE_LABEL)
        self.assertIn('수신에 실패', halt['note'])
        self.assertIn('KIND down', halt['last_error'])

    def test_success_clears_the_failure_state(self):
        cb.declare_halt_source(mk.SOURCE_LABEL, mk.SOURCE_URL, mk.POLL_SEC)
        mk.poll_once(kst(10, 0), FakeKind(fail=True))
        mk.poll_once(kst(10, 0, 30), FakeKind())
        halt = cb.build_market_halt(kst(10, 0, 40))
        self.assertEqual((halt['available'], halt['last_error']), (True, None))


class PhaseTests(Base):
    def test_outside_hours_and_holidays_do_not_flag_unknown(self):
        cb.ingest_market_halt([], mk.SOURCE_LABEL, kst(12, 0), source_url=mk.SOURCE_URL, refresh_sec=30)
        self.assertTrue(cb.build_market_halt(datetime(2026, 10, 16, 7, 0, tzinfo=KST))['available'])       # 다음 날 장 시작 전
        self.assertTrue(cb.build_market_halt(datetime(2026, 10, 17, 11, 0, tzinfo=KST))['available'])      # 토요일
        self.assertFalse(cb.build_market_halt(kst(17, 0))['available'])                                      # 장 마감 뒤인데 오늘 15:45 이후 수신이 없음

    def test_post_close_history_stays_visible_after_the_final_poll(self):
        mk.poll_once(kst(15, 50), FakeKind())
        halt = cb.build_market_halt(kst(18, 0))
        self.assertTrue(halt['available'])
        self.assertEqual(len(halt['events']), 4)                                                              # 해제된 뒤에도 당일 이력 확인 가능

    def test_window_bounds(self):
        self.assertTrue(mk.in_window(kst(8, 50)))
        self.assertFalse(mk.in_window(kst(8, 49)))
        self.assertTrue(mk.in_window(kst(16, 10)))
        self.assertFalse(mk.in_window(kst(16, 11)))
        self.assertFalse(mk.in_window(datetime(2026, 10, 17, 10, 0, tzinfo=KST)))


if __name__ == '__main__':
    unittest.main()
