# -*- coding: utf-8 -*-
"""시장 전체 사이드카·서킷브레이커 표시 계약(2026-10-15). 공식 수신 경로가 없으면 '확인 불가'이고 가격 급락으로 추정하지 않는다."""
import json
import os
import subprocess
import sys
import unittest
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import circuit_breaker as cb  # noqa: E402

KST = cb.KST


def kst(h, m, s=0, day=15):
    return datetime(2026, 10, day, h, m, s, tzinfo=KST)


def ev(market='KOSPI', kind='SIDECAR', status='active', hh=10, mm=0, stage=None, **extra):
    base = {'market': market, 'kind': kind, 'status': status, 'triggered_at': kst(hh, mm).isoformat(), 'stage': stage}
    base.update(extra)
    return base


class BackendTests(unittest.TestCase):
    def setUp(self):
        with cb._lock:
            cb._halt.update({'events': [], 'source': None, 'received_at': None})
            cb._state.update({'date': None, 'rows': [], 'fetchedAt': None, 'error': None})

    def test_without_a_verified_source_the_state_is_unknown_not_normal(self):
        halt = cb.build_market_halt(kst(10, 0))
        self.assertFalse(halt['available'])
        self.assertEqual((halt['reason'], halt['events'], halt['active_count']), ('NO_VERIFIED_SOURCE', [], 0))
        self.assertIn('확인할 수 없습니다', halt['note'])
        payload = cb.get_payload(kst(10, 0))
        self.assertFalse(payload['market_halt']['available'])
        self.assertFalse(payload['sidecar']['available'])                       # 헤더 배지도 숨김 유지
        self.assertIn('vi_list', payload)                                         # 개별 종목 VI 필드는 그대로

    def test_price_drop_alone_never_creates_an_event(self):
        # 이 모듈은 가격 데이터를 받지 않는다 - 수신 경로가 넣은 이벤트만 존재한다
        self.assertEqual(cb.build_market_halt(kst(10, 0))['events'], [])
        self.assertNotIn('price', cb.build_market_halt.__code__.co_varnames)

    def test_ingest_validates_and_dedupes_events(self):
        events = [ev(), ev(), ev(kind='CIRCUIT_BREAKER', stage=1, hh=11), ev(kind='CIRCUIT_BREAKER', stage=None, hh=11, mm=5),   # 단계 없는 CB는 버림
                  ev(market='NASDAQ'), ev(status='gone'), {'market': 'KOSPI', 'kind': 'SIDECAR', 'status': 'active', 'triggered_at': '2026-10-15T10:00:00'},  # 시간대 없음
                  ev(status='released'), ev(day=None) if False else ev(hh=9, mm=30, status='released', released_at=kst(9, 35).isoformat())]
        kept = cb.ingest_market_halt(events, 'test-source', kst(12, 0))
        halt = cb.build_market_halt(kst(12, 1))
        self.assertTrue(halt['available'])
        self.assertEqual(kept, len(halt['events']))
        ids = [e['id'] for e in halt['events']]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual({e['kind'] for e in halt['events']}, {'SIDECAR', 'CIRCUIT_BREAKER'})
        self.assertTrue(all(e['stage'] in (1, 2, 3) for e in halt['events'] if e['kind'] == 'CIRCUIT_BREAKER'))
        self.assertEqual(halt['active_count'], sum(1 for e in halt['events'] if e['status'] == 'active'))

    def test_only_todays_events_are_kept(self):
        old = ev(hh=10)
        old['triggered_at'] = kst(10, 0, day=14).isoformat()
        cb.ingest_market_halt([old, ev(hh=11)], 'src', kst(12, 0))
        self.assertEqual(len(cb.build_market_halt(kst(12, 1))['events']), 1)

    def test_stale_reception_turns_back_into_unknown(self):
        cb.ingest_market_halt([], 'src', kst(12, 0))
        self.assertTrue(cb.build_market_halt(kst(12, 2))['available'])           # 빈 목록 = 확인된 이벤트 없음
        late = cb.build_market_halt(kst(12, 0) + timedelta(seconds=cb.HALT_STALE_SEC + 1))
        self.assertFalse(late['available'])
        self.assertEqual(late['reason'], 'STALE')
        self.assertEqual(late['events'], [])

    def test_header_sidecar_badge_follows_the_same_source(self):
        cb.ingest_market_halt([ev(market='KOSDAQ')], 'src', kst(12, 0))
        side = cb.get_payload(kst(12, 1))['sidecar']
        self.assertEqual((side['available'], side['active'], side['market']), (True, True, 'KOSDAQ'))
        cb.ingest_market_halt([ev(market='KOSDAQ', status='released', released_at=kst(10, 5).isoformat())], 'src', kst(12, 2))
        self.assertFalse(cb.get_payload(kst(12, 3))['sidecar']['active'])

    def test_normalize_requires_end_time_for_released_events(self):
        self.assertIsNone(cb.normalize_halt_event(ev(status='released')))
        self.assertIsNotNone(cb.normalize_halt_event(ev(status='resumed', resumed_at=kst(10, 20).isoformat(), kind='CIRCUIT_BREAKER', stage=2)))


RUNNER = r'''
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('js/skin-main.js', 'utf8');
const start = src.indexOf("var MARKET_LABEL = { KOSPI");
const end = src.indexOf("function renderSidecar(el, sidecar)");
const body = src.slice(start, end);
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : new Date(d.getTime() + 9 * 3600000).toISOString().slice(11, 16); };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ctx = {hhmm, esc};
vm.runInNewContext(body + ';this.renderHalt = renderHalt;', ctx);
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log(JSON.stringify(cases.map((halt) => { const el = {hidden: true, className: '', innerHTML: ''}; ctx.renderHalt(el, halt); return el; })));
'''


def render(halts):
    out = subprocess.run(['node', '-e', RUNNER], cwd=ROOT, input=json.dumps(halts), capture_output=True, text=True, encoding='utf-8')
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def e(market, kind, status, trig, stage=None, rel=None, res=None, id_=None):
    return {'id': id_ or '%s-%s-%s-%s' % (market, kind, stage, trig), 'market': market, 'kind': kind, 'stage': stage, 'status': status,
            'triggered_at': '2026-10-15T%s:00+09:00' % trig, 'released_at': rel and '2026-10-15T%s:00+09:00' % rel, 'resumed_at': res and '2026-10-15T%s:00+09:00' % res}


class FrontendTests(unittest.TestCase):
    def test_unavailable_shows_unknown_note_not_a_warning_banner_and_never_normal(self):
        none, stale, absent = render([{'available': False, 'reason': 'NO_VERIFIED_SOURCE', 'events': []},
                                      {'available': False, 'reason': 'STALE', 'events': []}, None])
        self.assertFalse(none['hidden'])
        self.assertIn('is-unknown', none['className'])
        self.assertIn('자동 확인 불가', none['innerHTML'])
        self.assertIn('정상 여부를 알 수 없음', none['innerHTML'])
        self.assertIn('수신 지연', stale['innerHTML'])
        self.assertNotIn('정상입니다', none['innerHTML'] + stale['innerHTML'])
        self.assertTrue(absent['hidden'])                                         # 구버전 서버(필드 없음)는 숨김

    def test_no_events_means_no_banner(self):
        (box,) = render([{'available': True, 'events': []}])
        self.assertTrue(box['hidden'])

    def test_active_circuit_breaker_is_red_on_top_with_stage_and_market(self):
        halt = {'available': True, 'events': [e('KOSPI', 'SIDECAR', 'released', '09:40', rel='09:45'), e('KOSPI', 'CIRCUIT_BREAKER', 'active', '10:30', stage=1),
                                              e('KOSDAQ', 'SIDECAR', 'active', '10:10')]}
        (box,) = render([halt])
        html = box['innerHTML']
        self.assertIn('is-cb-active', box['className'])
        self.assertLess(html.index('코스피 서킷브레이커 1단계'), html.index('코스닥 사이드카'))     # 발동 중이 맨 위, CB가 사이드카보다 위(최근 순)
        self.assertLess(html.index('코스닥 사이드카'), html.index('오늘 해제·거래재개 이력'))
        self.assertIn('발동 중', html)
        self.assertIn('해제 09:45', html)
        self.assertIn('발동 10:30', html)

    def test_sidecar_only_is_orange_class_and_released_history_stays_visible(self):
        (active,) = render([{'available': True, 'events': [e('KOSDAQ', 'SIDECAR', 'active', '10:10')]}])
        self.assertIn('is-sidecar-active', active['className'])
        (history,) = render([{'available': True, 'events': [e('KOSPI', 'CIRCUIT_BREAKER', 'resumed', '10:30', stage=2, res='10:50'),
                                                              e('KOSPI', 'SIDECAR', 'released', '09:40', rel='09:45')]}])
        self.assertIn('is-history', history['className'])
        self.assertIn('오늘 시장 조치 이력', history['innerHTML'])
        self.assertIn('거래 재개 10:50', history['innerHTML'])
        self.assertIn('서킷브레이커 2단계', history['innerHTML'])

    def test_duplicate_event_ids_render_once(self):
        dup = e('KOSPI', 'SIDECAR', 'active', '10:10', id_='same')
        (box,) = render([{'available': True, 'events': [dup, dup, dup]}])
        self.assertEqual(box['innerHTML'].count('코스피 사이드카'), 1)


class WiringTests(unittest.TestCase):
    def read(self, *parts):
        with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
            return f.read()

    def test_banner_sits_above_the_market_card_heading_and_is_polled_from_the_cache_endpoint(self):
        js = self.read('js', 'skin-main.js')
        self.assertLess(js.index('data-home-halt hidden'), js.index('<div class="home-card-heading">'))
        self.assertIn("renderHalt(q('[data-home-halt]'), data.market_halt);", js)
        self.assertNotIn('KRX', js[js.index('homeCircuitBreakerBadges'):js.index('homeCircuitBreakerBadges') + 200])
        self.assertIn('class="home-cb-vi"', js)                                     # 개별 종목 VI 배지는 그대로

    def test_css_colors_circuit_breaker_red_and_sidecar_orange(self):
        css = self.read('style.css')
        self.assertIn('.home-halt.is-cb-active { border-color: #f3b4ae; background: #fdecea; color: #b42318; }', css)
        self.assertIn('.home-halt.is-sidecar-active { border-color: #f5c98a; background: #fff4e5; color: #b45309; }', css)
        self.assertIn('.home-halt[hidden] { display: none; }', css)


if __name__ == '__main__':
    unittest.main()
