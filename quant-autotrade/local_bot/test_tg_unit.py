# -*- coding: utf-8 -*-
"""텔레그램 연동 단위·시나리오 테스트(키·네트워크 불필요): python -m unittest test_tg_unit -v

가짜 키움 클라이언트 + 가짜 텔레그램 API(HTML 규칙을 실제처럼 엄격히 검사)로, 알림 중복 방지·장애 상태 머신·감시자·인가·서식을 검증한다.
실제 텔레그램 서버와의 통신은 test_tg_integration.py(가짜 HTTP 서버)와 사용자 PC 실사용 테스트에서 따로 확인한다.
"""
import codecs
import json
import os
import shutil
import sys
import tempfile
import time
import unittest
import warnings
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (HERE, os.path.join(HERE, '..', 'research'), os.path.join(HERE, '..', 'backtest')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bot as bot_mod  # noqa: E402
import candidate_gen as cg  # noqa: E402
import fake_telegram  # noqa: E402
import tg_config  # noqa: E402
import tg_data  # noqa: E402
import tg_format as F  # noqa: E402
import tg_monitor  # noqa: E402
import tg_notify  # noqa: E402
from tg_api import TelegramError  # noqa: E402
from tg_service import TelegramService  # noqa: E402
from tg_store import TelegramStore  # noqa: E402
from test_autotrader import FakeClient, holding  # noqa: E402

warnings.simplefilter('ignore', ResourceWarning)      # 기존 Store 가 with 문으로만 연결을 닫는 방식이라 GC 시점에 경고가 난다(기존 동작)
KST = timezone(timedelta(hours=9))
TOKEN = '123456789:FAKEfakeFAKEfakeFAKEfakeFAKEfake12'
USER = 777001


def epoch(y, m, d, h=0, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=KST).timestamp()


class FakeAPI:
    """TelegramAPI 대역. 보낸 메시지를 기록하고, 실제 텔레그램처럼 잘못된 HTML 은 400 으로 거부한다."""

    def __init__(self):
        self.sent, self.fail, self.callbacks, self.commands = [], None, [], None

    def send_message(self, chat_id, text, parse_mode='HTML', reply_markup=None, silent=False):
        if self.fail is not None:
            raise self.fail
        if parse_mode == 'HTML':
            problem = fake_telegram.html_problem(text)
            if problem:
                raise TelegramError("sendMessage 실패 400 can't parse entities: " + problem, code=400, transient=False)
        assert len(text) <= 4096, 'message too long'
        self.sent.append({'chat_id': chat_id, 'text': text, 'markup': reply_markup, 'parse_mode': parse_mode})

    def answer_callback(self, callback_id, text=None):
        self.callbacks.append(callback_id)

    def set_my_commands(self, commands):
        self.commands = commands

    def set_menu_button_commands(self):
        pass

    def delete_webhook(self):
        pass

    def texts(self):
        return [s['text'] for s in self.sent]


class Env:
    """봇 + 연구 폴더 + 텔레그램 서비스를 한 임시 폴더에 구성한다. 시간은 가짜 시계(env.t[0])로 움직인다."""

    def __init__(self, start=(2026, 10, 12, 10, 0), user=USER):
        self.dir = tempfile.mkdtemp()
        self.research = os.path.join(self.dir, 'research')
        os.makedirs(self.research)
        self.t = [epoch(*start)]
        self.orig_now = bot_mod.now_kst
        bot_mod.now_kst = lambda: datetime.fromtimestamp(self.t[0], KST)
        self.orig_flag = bot_mod.STOP_FLAG
        bot_mod.STOP_FLAG = os.path.join(self.dir, 'STOP')
        os.environ.pop('LIVE_SELL', None)
        self.store = bot_mod.Store(os.path.join(self.dir, 'autotrader.db'))
        self.client = FakeClient()
        self.bot = bot_mod.Bot(self.client, self.store, dict(bot_mod.DEFAULT_CONFIG))
        self.store.watch_add('005930', '삼성전자')
        self.settings = tg_config.Settings(token=TOKEN, allowed_user_id=user, chat_id=None)
        self.api = FakeAPI()
        self.uptime = 99999
        self.svc = self.new_service()

    def new_service(self):
        svc = TelegramService(self.bot, self.store, self.settings, self.dir, clock=lambda: self.t[0], api=self.api, uptime=lambda: self.uptime)
        svc.sender._sleep = lambda s: None
        self.svc = svc
        return svc

    def close(self):
        bot_mod.now_kst = self.orig_now
        bot_mod.STOP_FLAG = self.orig_flag
        os.environ.pop('LIVE_SELL', None)
        shutil.rmtree(self.dir, ignore_errors=True)

    # 시간·봇
    def at(self, *args):
        self.t[0] = epoch(*args)

    def advance(self, sec):
        self.t[0] += sec

    def poll(self, price=None, avg=100000.0, code='005930', qty=10):
        if price is not None:
            self.client.holdings = [holding(code, avg=avg, price=price, qty=qty)]
        self.bot.poll_once()

    # 연구 DB
    def research_db(self):
        return cg.connect(os.path.join(self.research, 'research.db'))

    def write_status(self, **kw):
        now = datetime.fromtimestamp(self.t[0], KST).isoformat(timespec='seconds')
        base = {'updatedAt': now, 'heartbeatAt': now, 'pid': 1, 'runner': 'waiting', 'mode': 'poll',
                'candidatesToday': 0, 'nextRunAt': '2026-10-13T20:15+09:00', 'errors': [], 'missingWeekdays': [], 'diskLimitBytes': 5 * 1024 ** 3,
                'diskUsedBytes': 45000, 'startedAt': now, 'paperVariants': {}}
        base.update(kw)
        with open(os.path.join(self.research, 'status.json'), 'w', encoding='utf-8') as f:
            json.dump(base, f, ensure_ascii=False)

    def flush(self):
        """대기열을 비운다(백오프 대기가 있으면 시간을 앞으로 감는다)."""
        for _ in range(6):
            self.svc.sender.step()
            self.advance(1)
        return self.api.texts()

    def tick(self):
        self.svc.monitor.tick()

    def baseline(self):
        self.tick()


def add_candidate(conn, scan_date, scanner, code, name, score=90.0, price=10000.0, reasons=None):
    conn.execute('INSERT OR IGNORE INTO candidates(scan_date, scanner, code, name, score, base_price, scanned_at, created_at, reasons) VALUES (?,?,?,?,?,?,?,?,?)',
                 (scan_date, scanner, code, name, score, price, '2026-10-12T14:58:00+00:00', '2026-10-13T00:00:00+09:00', json.dumps(reasons, ensure_ascii=False) if reasons else None))
    conn.commit()


def add_paper(conn, scan_date, scanner, code, variant, **kw):
    row = {'status': 'OPEN', 'entry_date': None, 'entry_price': None, 'stop_price': None, 'trail_price': None, 'signal_date': None, 'exit_date': None,
           'exit_price': None, 'ret': None, 'exit_reason': None, 'hold_days': None, 'last_bar_date': '2026-10-13', 'note': None}
    row.update(kw)
    cols = ['scan_date', 'scanner', 'code', 'variant'] + list(row)
    conn.execute('INSERT OR REPLACE INTO paper_trades(%s) VALUES (%s)' % (','.join(cols), ','.join('?' * len(cols))), [scan_date, scanner, code, variant] + list(row.values()))
    conn.commit()


def log_gen(conn, ts_iso, scan_date, ok, reason, created=0):
    conn.execute('INSERT INTO gen_log VALUES (?,?,?,?,?)', (ts_iso, scan_date, ok, reason, created))
    conn.commit()


class ConfigTests(unittest.TestCase):
    def test_redact_hides_token_and_account_like_numbers(self):
        text = '실패 %s 계좌 1234567890123 주문 12,345,678원 가격 71200' % TOKEN
        out = tg_config.redact(text)
        self.assertNotIn(TOKEN, out)
        self.assertNotIn('FAKEfakeFAKEfakeFAKEfakeFAKEfake12', out)
        self.assertNotIn('1234567890123', out)
        self.assertIn('12,345,678원', out)         # 쉼표로 끊은 금액은 그대로
        self.assertIn('71200', out)
        self.assertNotIn('SECRETVALUE', tg_config.redact('x SECRETVALUE y', ['SECRETVALUE']))

    def test_settings_rules(self):
        s = tg_config.load_settings({'TELEGRAM_BOT_TOKEN': TOKEN, 'TELEGRAM_ALLOWED_USER_ID': '777001'})
        self.assertTrue(s.ready)
        self.assertEqual(s.target_chat_id, 777001)           # CHAT_ID 없으면 허용 사용자 ID(개인 채팅)
        self.assertFalse(tg_config.load_settings({'TELEGRAM_BOT_TOKEN': TOKEN}).ready)       # 허용 사용자 없으면 동작 안 함
        self.assertFalse(tg_config.load_settings({}).enabled)
        group = tg_config.load_settings({'TELEGRAM_BOT_TOKEN': TOKEN, 'TELEGRAM_ALLOWED_USER_ID': '777001', 'TELEGRAM_CHAT_ID': '-100123456'})
        self.assertFalse(group.ready)                          # 그룹/채널(음수 ID)은 거부
        self.assertTrue(group.problems())
        mismatch = tg_config.load_settings({'TELEGRAM_BOT_TOKEN': TOKEN, 'TELEGRAM_ALLOWED_USER_ID': '777001', 'TELEGRAM_CHAT_ID': '888'})
        self.assertFalse(mismatch.ready)

    def test_api_base_override_only_loopback(self):
        evil = tg_config.load_settings({'TELEGRAM_BOT_TOKEN': TOKEN, 'TELEGRAM_API_BASE': 'https://evil.example.com'})
        self.assertEqual(evil.api_base, tg_config.DEFAULT_API_BASE)
        local = tg_config.load_settings({'TELEGRAM_BOT_TOKEN': TOKEN, 'TELEGRAM_API_BASE': 'http://127.0.0.1:9999'})
        self.assertEqual(local.api_base, 'http://127.0.0.1:9999')

    def test_update_env_file_preserves_other_lines(self):
        d = tempfile.mkdtemp()
        try:
            path = os.path.join(d, '.env')
            with open(path, 'w', encoding='utf-8') as f:
                f.write('# 주석\nKIWOOM_APPKEY=abc\nLIVE_SELL=\nTELEGRAM_BOT_TOKEN=old\n')
            tg_config.update_env_file(path, {'TELEGRAM_BOT_TOKEN': 'new', 'TELEGRAM_ALLOWED_USER_ID': 5})
            text = open(path, encoding='utf-8').read()
            self.assertIn('# 주석', text)
            self.assertIn('KIWOOM_APPKEY=abc', text)
            self.assertIn('LIVE_SELL=', text)
            self.assertIn('TELEGRAM_BOT_TOKEN=new', text)
            self.assertNotIn('=old', text)
            self.assertIn('TELEGRAM_ALLOWED_USER_ID=5', text)
        finally:
            shutil.rmtree(d, ignore_errors=True)


class FormatTests(unittest.TestCase):
    NOW = datetime(2026, 10, 12, 23, 59, tzinfo=KST)

    def valid(self, text):
        self.assertIsNone(fake_telegram.html_problem(text), text)
        self.assertLessEqual(len(text), 4096)
        return text

    def cands(self, n=7):
        out = []
        for i in range(n):
            out.append({'scan_date': '2026-10-12', 'scanner': ['pullback', 'maCloudBreakout', 'doubleBottom', 'invHeadShoulders'][i % 4], 'code': '00%04d' % i,
                        'name': 'S&T <코퍼레이션> %d' % i, 'score': 95 - i, 'base_price': 10000 + i, 'status': 'NEW', 'reasons': json.dumps(['5일선 지지 & 거래량 증가', '224일선 위'], ensure_ascii=False)})
        return out

    def variants(self):
        return {'trail_atr': {'closed': 5, 'cumRet': 0.0123, 'mdd': -0.021, 'mddExact': True, 'win': 0.6, 'openPositions': 2, 'pendingExit': 0, 'candidateTrades': 7, 'unsettled': 2},
                'atr_close': {'closed': 0, 'cumRet': None, 'mdd': None, 'win': None, 'unsettled': 3},
                'dead35': {'closed': 2, 'cumRet': -0.0042, 'mdd': None, 'mddApprox': -0.01, 'mddExact': False, 'win': 0.5, 'unsettled': 1}}

    def test_scan_selected_and_zero_candidates(self):
        text = self.valid(F.fmt_scan_selected('2026-10-12', self.cands(), {'scanned': 2387, 'scannedAt': '2026-10-12T14:58:00+00:00'}, self.NOW))
        self.assertIn('연구 후보 선정', text)
        self.assertIn('총 <b>7종목</b>', text)
        self.assertIn('S&amp;T &lt;코퍼레이션&gt;', text)           # 종목명 이스케이프
        self.assertIn('5일선 지지 &amp; 거래량 증가', text)          # 선정 이유 표시
        self.assertIn('자동 매수와 연결되어 있지 않습니다', text)
        zero = self.valid(F.fmt_scan_selected('2026-10-12', [], None, self.NOW))
        self.assertIn('0종목', zero)
        self.assertIn('정상', zero)

    def test_paper_update_labels_and_no_mixing(self):
        events = [{'kind': 'entry', 'scan_date': '2026-10-12', 'scanner': 'pullback', 'code': '005930', 'name': '삼성전자', 'entry_date': '2026-10-13', 'entry_price': 71500.0,
                   'variants': {'trail_atr': {'stop_price': 66900.0}, 'atr_close': {'stop_price': 66900.0}, 'dead35': {'stop_price': None}}},
                  {'kind': 'signal', 'scan_date': '2026-10-09', 'scanner': 'doubleBottom', 'code': '003550', 'name': 'LG', 'variant': 'atr_close', 'signal_date': '2026-10-13', 'trail_price': 90100.0},
                  {'kind': 'close', 'scan_date': '2026-10-01', 'scanner': 'pullback', 'code': '035420', 'name': '네이버', 'variant': 'trail_atr', 'exit_date': '2026-10-13',
                   'ret': 0.042, 'exit_reason': 'STOP_INTRADAY', 'hold_days': 7}]
        text = self.valid(F.fmt_paper_update(events, self.variants(), self.NOW))
        for needle in ('[모의]' if False else '모의매매 갱신', '가상 기록 · 실계좌 주문 아님', '신규 진입 1건', '손절선 66,900', '가격 손절선 없음', '다음 시가 체결 대기', '체결가·수익률은 다음 거래일 시가',
                       '+4.20%', '추적선 장중 이탈', '독립 계좌'):
            self.assertIn(needle, text)
        self.assertNotIn('실계좌]', text)

    def test_order_events_distinguish_stages(self):
        info = {'code': '005930', 'name': '삼성전자', 'reason': 'STOP', 'gain': -3.2, 'avg': 71000, 'price': 68700, 'qty': 10, 'ord_no': '0000123456'}
        dry = self.valid(F.fmt_order_event('DRY', info, self.NOW))
        self.assertIn('주문은 전송되지 않았습니다', dry)
        self.assertIn('🔵', dry)                                   # 하락은 파랑
        self.assertNotIn('접수', dry)
        sent = self.valid(F.fmt_order_event('SENT', info, self.NOW))
        self.assertIn('접수', sent)
        self.assertIn('체결 확인이 아닙니다', sent)
        self.assertIn('…3456', sent)
        self.assertNotIn('0000123456', sent)                       # 주문번호 전체는 노출하지 않는다
        rej = self.valid(F.fmt_order_event('REJECTED', dict(info, message='8010 장 종료'), self.NOW))
        self.assertIn('거부', rej)
        failed = self.valid(F.fmt_order_event('FAILED', dict(info, message='timeout'), self.NOW))
        self.assertIn('불명확', failed)
        closed_bot = self.valid(F.fmt_order_event('CLOSED', dict(info, had_order=True), self.NOW))
        self.assertIn('체결로 판단', closed_bot)
        closed_ext = self.valid(F.fmt_order_event('CLOSED', dict(info, had_order=False), self.NOW))
        self.assertIn('외부 변동', closed_ext)
        self.assertNotIn('체결로 판단', closed_ext)
        self.valid(F.fmt_order_event('PARTIAL', {'code': '005930', 'name': '삼성전자', 'before': 10, 'after': 6}, self.NOW))

    def test_daily_report_sections_are_separate(self):
        data = {'scan_date': '2026-10-12', 'now': self.NOW, 'scan_ok': True, 'scanned': {'scanned': 2387, 'scannedAt': '2026-10-12T14:58:00+00:00'}, 'cands': self.cands(),
                'paper_events': [{'kind': 'entry', 'scanner': 'pullback', 'code': '005930', 'name': '삼성전자', 'entry_price': 71500.0}], 'variants': self.variants(),
                'errors': [], 'health': {'active_alerts': []},
                'bot': {'live_sell': False, 'holdings_n': 3, 'watch_count': 2, 'last_poll': '2026-10-12 15:20:00', 'dry_today': 1, 'sent_today': 0, 'error_today': 0}}
        text = self.valid(F.fmt_daily(data))
        for needle in ('일일 보고서', '① 시스템', '② 연구 후보', '③ 모의매매', '④ 전략별 누적', '⑤ 실계좌 감시', '[연구]', '[모의]', '[실계좌]', '합산 아님', '백테스트/모의와 별개'):
            self.assertIn(needle, text)
        self.assertLess(text.index('[연구]'), text.index('[모의]'))
        self.assertLess(text.index('[모의]'), text.index('[실계좌]'))
        empty = self.valid(F.fmt_daily(dict(data, scan_ok=False, cands=[], paper_events=[], variants={})))
        self.assertIn('후보 0종목', empty)

    def test_command_outputs_are_valid_html(self):
        status = {'now': self.NOW, 'level': 'warn', 'alerts': [{'label': '키움 잔고 조회 실패', 'age': '5분'}],
                  'bot': {'live_sell': False, 'market_open': True, 'last_poll': '2026-10-12 10:00:00', 'stopped': False, 'balance_failures': 2, 'watch_count': 1, 'sells_today': 0, 'max_sells_per_day': 10},
                  'research': {'available': True, 'runner': 'waiting', 'updatedAt': '2026-10-12T20:15:00+09:00', 'lastGen': {'ok': False, 'reason': 'WAIT_STABLE(30s)'}, 'candidatesToday': 0,
                               'nextRunAt': '2026-10-13T20:15+09:00', 'diskUsedBytes': 45000, 'diskLimitBytes': 5 * 1024 ** 3},
                  'telegram': {'net_ok': True, 'pending': 0, 'last_ok': epoch(2026, 10, 12, 9, 59), 'mute_until': None}, 'pc': {'free_bytes': 20 * 1024 ** 3}}
        text = self.valid(F.fmt_status(status))
        self.assertIn('🟡 주의', text)
        self.assertIn('기록 전용', text)
        self.assertIn('연속 2회 실패', text)
        self.valid(F.fmt_status(dict(status, level='ok', alerts=[], research={'available': False})))
        self.valid(F.fmt_candidates({'now': self.NOW, 'scan_date': None, 'cands': []}))
        self.valid(F.fmt_candidates({'now': self.NOW, 'scan_date': '2026-10-12', 'cands': self.cands(12)}))
        self.valid(F.fmt_candidates({'now': self.NOW, 'scan_date': '2026-10-12', 'cands': self.cands(12)}, 'pullback'))
        rows = [{'variant': 'trail_atr', 'code': '035420', 'name': '네이버', 'ret': -0.01, 'exit_date': '2026-10-13', 'hold_days': 3}]
        self.valid(F.fmt_paper({'now': self.NOW, 'variants': self.variants(), 'open_counts': {'trail_atr': {'open': 2, 'pending': 0}}, 'recent_closed': rows}))
        self.valid(F.fmt_paper({'now': self.NOW, 'variants': self.variants(), 'open_counts': {}, 'recent_closed': rows}, 'trail_atr'))
        self.valid(F.fmt_paper({'now': self.NOW, 'variants': {}, 'open_counts': {}, 'recent_closed': []}))
        holds = [{'code': '005930', 'name': '삼성전자', 'qty': 10, 'avg': 70000.0, 'price': 72100.0, 'watched': True}, {'code': '000660', 'name': 'SK하이닉스', 'qty': 3, 'avg': 200000.0, 'price': 190000.0}]
        text = self.valid(F.fmt_holdings({'now': self.NOW, 'holdings': holds, 'fresh': True}))
        self.assertIn('🔴', text)
        self.assertIn('🔵', text)
        self.assertNotIn('계좌번호', text)
        self.valid(F.fmt_holdings({'now': self.NOW, 'holdings': [], 'fresh': False, 'updated': '2026-10-12 10:00:00', 'note': '실시간 조회에 실패'}))
        orders = [{'ts': '2026-10-12 10:00:00', 'code': '005930', 'name': '삼성전자', 'qty': 10, 'reason': 'STOP', 'status': 'DRY', 'ord_no': None},
                  {'ts': '2026-10-12 10:05:00', 'code': '005930', 'name': '삼성전자', 'qty': 10, 'reason': 'STOP', 'status': 'ERROR', 'kind': 'REJECTED', 'ord_no': None},
                  {'ts': '2026-10-12 10:10:00', 'code': '005930', 'name': '삼성전자', 'qty': 10, 'reason': 'TP_CAP', 'status': 'SENT', 'ord_no': '0001234567'}]
        text = self.valid(F.fmt_orders({'now': self.NOW, 'orders': orders, 'sent_today': 1, 'live_sell': True}))
        self.assertIn('기록만(주문 미전송)', text)
        self.assertIn('접수(체결 확인 전)', text)
        self.assertIn('증권사 거부', text)
        self.assertNotIn('0001234567', text)
        self.valid(F.fmt_risk({'now': self.NOW, 'config': dict(bot_mod.DEFAULT_CONFIG), 'live_sell': False, 'sells_today': 0, 'disk_limit': 5 * 1024 ** 3}))
        self.valid(F.fmt_help())
        self.valid(F.fmt_test({'now': self.NOW, 'latency': '0.4', 'uid_tail': '001', 'net_ok': True, 'mute_until': None}))
        self.valid(F.fmt_startup({'kind': 'unclean', 'last_heartbeat': epoch(2026, 10, 12, 9, 0), 'gap_text': '1.0시간', 'live_sell': False, 'watch_count': 2, 'mode_changed': True}, self.NOW))
        self.valid(F.fmt_alert('테스트', ['줄1', '줄2 <b>굵게</b>'], 'critical', '조치', self.NOW))

    def test_paper_rules_match_research_constants(self):
        import allocation
        lim = allocation.LIMITS
        self.assertEqual(F.PAPER_RULES, {'max_pos': lim['max_pos'], 'per_pos_pct': round(lim['per_pos'] * 100), 'total_cap_pct': round(lim['total_cap'] * 100),
                                         'gap_skip_pct': cg.GAP_SKIP * 100, 'entry_slip_pct': cg.ENTRY_SLIP * 100})
        self.assertEqual(set(F.VARIANT_LABELS), set(cg.PAPER_VARIANTS))
        self.assertEqual(set(F.SCANNER_LABELS), set(cg.RESEARCH_SCANNERS))


class StoreNotifierTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.t = [1_000_000.0]
        self.store = TelegramStore(os.path.join(self.dir, 't.db'))
        self.notifier = tg_notify.Notifier(self.store, lambda: self.t[0])
        self.api = FakeAPI()
        self.sender = tg_notify.Sender(self.store, self.api, self.notifier, USER, clock=lambda: self.t[0], sleep=lambda s: None)
        self._backoff = tg_notify.BACKOFF_BASE_SEC

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_dedupe_key_sends_once(self):
        self.assertTrue(self.notifier.notify('k1', 'a'))
        self.assertFalse(self.notifier.notify('k1', 'a'))
        self.sender.step()
        self.assertFalse(self.notifier.notify('k1', 'a'))          # 이미 보낸 뒤에도 중복 불가
        self.sender.step()
        self.assertEqual(self.api.texts(), ['a'])

    def test_critical_goes_first(self):
        self.notifier.notify('a', 'info-msg', 'general', 'info')
        self.notifier.notify('b', 'warn-msg', 'alert', 'warn')
        self.notifier.notify('c', 'crit-msg', 'alert', 'critical')
        self.sender.step()
        self.assertEqual(self.api.texts(), ['crit-msg', 'warn-msg', 'info-msg'])

    def test_alert_state_machine(self):
        n = self.notifier
        self.assertEqual(n.raise_alert('x', 'down', renotify_sec=3600), 'raised')
        self.assertEqual(n.raise_alert('x', 'down', renotify_sec=3600), 'quiet')
        self.t[0] += 1800
        self.assertEqual(n.raise_alert('x', 'down', renotify_sec=3600), 'quiet')
        self.t[0] += 1900
        self.assertEqual(n.raise_alert('x', 'down', renotify_sec=3600), 'renotified')
        self.assertEqual(n.raise_alert('x', 'down', renotify_sec=3600), 'quiet')
        self.assertTrue(n.clear_alert('x', 'up'))
        self.assertFalse(n.clear_alert('x', 'up'))                   # 복구 알림은 한 번
        self.assertEqual(n.raise_alert('x', 'down again', renotify_sec=3600), 'raised')    # 다시 발생하면 새 알림
        self.sender.step()
        texts = self.api.texts()
        self.assertEqual(len(texts), 4)
        self.assertEqual(sum('계속 중' in t for t in texts), 1)
        self.assertEqual(sum('복구' in t for t in texts), 1)

    def test_mute_only_general(self):
        n = self.notifier
        n.set_mute(3600)
        n.notify('g', 'general-msg', 'general')
        n.notify('o', 'order-msg', 'order', 'warn')
        n.notify('a', 'alert-msg', 'alert', 'warn')
        self.sender.step()
        self.assertEqual(sorted(self.api.texts()), ['alert-msg', 'order-msg'])
        self.assertEqual(n.clear_mute(), 1)
        self.assertFalse(n.is_muted())
        n.notify('g2', 'later-general', 'general')
        self.sender.step()
        self.assertIn('later-general', self.api.texts())

    def test_expiry_and_delayed_note(self):
        self.notifier.notify('old', 'stale-alert', 'alert', 'warn', ttl=100)
        self.notifier.notify('slow', 'slow-alert', 'alert', 'warn')
        self.t[0] += 400
        self.sender.step()
        texts = self.api.texts()
        self.assertEqual(len(texts), 1)
        self.assertIn('지연 전달', texts[0])
        self.assertIn('slow-alert', texts[0])

    def test_network_failure_backoff_then_recovery_notice_and_no_duplicates(self):
        tg_notify.BACKOFF_BASE_SEC = 30
        try:
            self.api.fail = TelegramError('sendMessage 연결 실패: URLError', ambiguous=False)
            self.notifier.notify('m1', 'first', 'alert', 'warn')
            self.notifier.notify('m2', 'second', 'alert', 'warn')
            self.sender.step()
            self.assertEqual(self.api.sent, [])
            self.assertIsNotNone(self.sender.net_down_since)
            self.t[0] += 10
            self.sender.step()                                    # 백오프 중 - 시도하지 않음
            self.assertEqual(self.api.sent, [])
            self.t[0] += 700                                      # 연결 복구 + 5분 넘게 끊김
            self.api.fail = None
            self.sender.step()
            self.sender.step()
            texts = self.api.texts()
            self.assertEqual([t for t in texts if 'first' in t or 'second' in t].__len__(), 2)       # 둘 다 한 번씩
            self.assertTrue(any('연결 복구' in t for t in texts))
            self.assertIsNone(self.sender.net_down_since)
            self.sender.step()
            self.assertEqual(len(self.api.texts()), len(texts))   # 더 보내지 않음
        finally:
            tg_notify.BACKOFF_BASE_SEC = self._backoff

    def test_html_parse_error_falls_back_to_plain(self):
        self.notifier.notify('bad', '<b>안녕 <i>세계</b>', 'alert', 'warn')
        self.sender.step()
        self.assertEqual(self.api.sent[-1]['parse_mode'], None)
        self.assertEqual(self.api.sent[-1]['text'], '안녕 세계')

    def test_rate_limit_429_retries_after_delay(self):
        self.api.fail = TelegramError('429', code=429, retry_after=7)
        self.notifier.notify('r', 'x', 'alert', 'warn')
        self.sender.step()
        self.api.fail = None
        self.sender.step()
        self.assertEqual(self.api.sent, [])
        self.t[0] += 9
        self.sender.step()
        self.assertEqual(self.api.texts(), ['x'])

    def test_long_message_is_split(self):
        text = '\n'.join('<b>line</b> %d ' % i + 'x' * 60 for i in range(150))
        self.notifier.notify('long', text, 'alert', 'warn')
        self.sender.step()
        self.assertGreater(len(self.api.sent), 1)
        self.assertTrue(all(len(s['text']) <= 4096 for s in self.api.sent))

    def test_fatal_auth_does_not_spin(self):
        self.api.fail = TelegramError('401', code=401)
        self.notifier.notify('a', 'x', 'alert', 'warn')
        self.sender.step()
        self.assertIn('토큰', self.sender.fatal)
        self.assertNotIn(TOKEN, self.sender.fatal)


class DataTests(unittest.TestCase):
    def test_label_round_trip_with_real_bot_messages(self):
        env = Env()
        try:
            env.poll(price=96000.0)
            ev = env.store.events(10)
            dry = next(e for e in ev if e['type'] == 'DRY_SELL')
            self.assertEqual(tg_data.parse_label(dry['detail']), {'reason': 'STOP', 'gain': -4.0, 'avg': 100000.0, 'price': 96000.0, 'qty': 10})
            os.environ['LIVE_SELL'] = 'true'
            env.advance(600)
            env.poll(price=106000.0)
            sent = next(e for e in env.store.events(10) if e['type'] == 'SELL_SENT')
            self.assertEqual(tg_data.parse_label(sent['detail'])['reason'], 'TP_CAP')
            self.assertEqual(tg_data.parse_ord_no(sent['detail']), '0001')
            env.client.sell_result = {'ok': False, 'ord_no': None, 'return_code': 8010, 'return_msg': '장 종료'}
            env.advance(600)
            env.poll(price=106000.0)
            rej = next(e for e in env.store.events(10) if e['type'] == 'ERROR')
            self.assertTrue(rej['detail'].startswith(bot_mod.MSG_ORDER_REJECTED))
            self.assertEqual(tg_data.parse_label(rej['detail'])['reason'], 'TP_CAP')
        finally:
            env.close()

    def test_diff_paper(self):
        def row(variant, status='OPEN', **kw):
            base = {'scan_date': '2026-10-12', 'scanner': 'pullback', 'code': '005930', 'name': '삼성전자', 'variant': variant, 'entry_date': '2026-10-13', 'entry_price': 100.0,
                    'stop_price': 90.0, 'trail_price': 90.0, 'signal_date': None, 'exit_date': None, 'exit_price': None, 'ret': None, 'exit_reason': None, 'hold_days': None,
                    'status': status, 'last_bar_date': '2026-10-13', 'note': None}
            base.update(kw)
            return base

        rows = [row('trail_atr'), row('atr_close'), row('dead35')]
        events, updates = tg_data.diff_paper(rows, {}, first_run=True)
        self.assertEqual(events, [])                                  # 기준선은 조용히
        seen = dict(updates)
        events, updates = tg_data.diff_paper(rows, seen, first_run=False)
        self.assertEqual((events, updates), ([], []))
        # 새 후보 진입
        new = [dict(r, code='000660', name='SK하이닉스') for r in rows]
        events, updates = tg_data.diff_paper(rows + new, seen, False)
        self.assertEqual([e['kind'] for e in events], ['entry'])
        self.assertEqual(events[0]['code'], '000660')
        seen.update(dict(updates))
        # 아직 판정 전(last_bar_date 없음)이면 알리지 않는다
        unsettled = [dict(r, code='035420', last_bar_date=None) for r in rows]
        events, updates = tg_data.diff_paper(rows + new + unsettled, seen, False)
        self.assertEqual(events, [])
        # 신호 -> 청산
        sig = [row('trail_atr'), row('atr_close', 'PENDING_EXIT', signal_date='2026-10-14'), row('dead35')]
        events, updates = tg_data.diff_paper(sig + new, seen, False)
        self.assertEqual([(e['kind'], e['variant']) for e in events], [('signal', 'atr_close')])
        seen.update(dict(updates))
        closed = [row('trail_atr'), row('atr_close', 'CLOSED', signal_date='2026-10-14', exit_date='2026-10-15', ret=0.05, exit_reason='SIGNAL_ATR_CLOSE', hold_days=3), row('dead35')]
        events, updates = tg_data.diff_paper(closed + new, seen, False)
        self.assertEqual([(e['kind'], e['variant'], e['ret']) for e in events], [('close', 'atr_close', 0.05)])
        seen.update(dict(updates))
        self.assertEqual(tg_data.diff_paper(closed + new, seen, False)[0], [])

    def test_partial_fill_tracking(self):
        holds = [{'code': '005930', 'name': 'A', 'qty': 6, 'price': 1}, {'code': '000660', 'name': 'B', 'qty': 1, 'price': 1}]
        events, known = tg_data.track_partial_fills(holds, {'005930': 10, '000660': 5}, {'005930'})
        self.assertEqual([(e['code'], e['before'], e['after']) for e in events], [('005930', 10, 6)])      # 감시 종목만
        self.assertEqual(known, {'005930': 6})
        self.assertEqual(tg_data.track_partial_fills([], {'005930': 6}, {'005930'})[0], [])               # 전량 소멸은 다른 경로


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.env.baseline()

    def tearDown(self):
        self.env.close()

    def test_dry_sell_notified_once_per_day(self):
        e = self.env
        e.poll(price=96000.0)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('주문은 전송되지 않았습니다', texts[0])
        self.assertIn('삼성전자', texts[0])
        self.assertIn('손절', texts[0])
        for _ in range(3):             # 5분 쿨다운마다 DRY 기록이 쌓여도 같은 날 같은 사유는 반복 알림하지 않는다
            e.advance(400)
            e.poll(price=96000.0)
            e.tick()
        self.assertEqual(len(e.flush()), 1)
        e.advance(86400)               # 다음 날은 새 알림
        e.poll(price=96000.0)
        e.tick()
        self.assertEqual(len(e.flush()), 2)

    def test_live_sent_then_position_closed_is_fill_by_balance(self):
        e = self.env
        os.environ['LIVE_SELL'] = 'true'
        e.poll(price=96000.0)
        e.tick()
        self.assertEqual(e.client.sells, [('005930', 10)])
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('매도 주문 접수', texts[0])
        self.assertIn('체결 확인이 아닙니다', texts[0])
        e.advance(60)
        e.client.holdings = []
        e.poll()
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 2)
        self.assertIn('체결로 판단', texts[1])
        self.assertIn('잔고 기준', texts[1])

    def test_closed_without_bot_order_is_external(self):
        e = self.env
        e.poll(price=100500.0)
        e.tick()
        e.advance(60)
        e.client.holdings = []
        e.poll()
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('외부 변동', texts[0])

    def test_partial_decrease_is_reported_once(self):
        e = self.env
        e.poll(price=100500.0, qty=10)
        e.tick()
        e.advance(40)
        e.poll(price=100500.0, qty=6)
        e.tick()
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('10주 → 6주', texts[0])

    def test_rejected_and_failed_are_different_messages(self):
        e = self.env
        os.environ['LIVE_SELL'] = 'true'
        e.client.sell_result = {'ok': False, 'ord_no': None, 'return_code': 8010, 'return_msg': '주문 불가'}
        e.poll(price=96000.0)
        e.tick()
        rej = e.flush()
        self.assertEqual(len(rej), 1)
        self.assertIn('매도 주문 거부', rej[0])
        self.assertIn('주문은 들어가지 않았습니다', rej[0])

        def boom(code, qty):
            raise RuntimeError('timeout')

        e.client.sell_market = boom
        e.advance(600)
        e.poll(price=96000.0)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 2)
        self.assertIn('전송 실패', texts[1])
        self.assertIn('불명확', texts[1])
        self.assertNotIn('거부', texts[1])

    def test_balance_failure_alert_renotify_and_recovery(self):
        e = self.env
        e.client.fail_balance = True
        e.poll()
        e.tick()
        self.assertEqual(e.flush(), [])                      # 1회 실패는 알리지 않는다
        e.advance(31)
        e.poll()
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('잔고 조회 실패', texts[0])
        self.assertIn('손절·익절 판단이 멈춰', texts[0])
        e.advance(31)
        e.poll()
        e.tick()
        self.assertEqual(len(e.flush()), 1)                  # 3회째에도 같은 장애는 반복하지 않는다
        e.advance(1900)
        e.poll()
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 2)
        self.assertIn('계속 중', texts[1])
        e.client.fail_balance = False
        e.advance(31)
        e.poll(price=100000.0)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 3)
        self.assertIn('복구', texts[2])

    def test_stalled_loop_needs_two_ticks_and_clears(self):
        e = self.env
        e.bot.last_poll = (datetime.fromtimestamp(e.t[0], KST) - timedelta(minutes=20)).strftime('%Y-%m-%d %H:%M:%S')
        e.tick()
        self.assertEqual(e.flush(), [])
        e.advance(15)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('판단 루프 정지', texts[0])
        e.advance(15)
        e.bot.last_poll = datetime.fromtimestamp(e.t[0], KST).strftime('%Y-%m-%d %H:%M:%S')
        e.tick()
        self.assertIn('복구', e.flush()[-1])

    def test_sleep_gap_resets_streaks(self):
        e = self.env
        e.bot.last_poll = (datetime.fromtimestamp(e.t[0], KST) - timedelta(minutes=20)).strftime('%Y-%m-%d %H:%M:%S')
        e.tick()                                             # 1회째
        e.advance(3600)                                      # PC 절전
        e.bot.last_poll = (datetime.fromtimestamp(e.t[0], KST) - timedelta(minutes=20)).strftime('%Y-%m-%d %H:%M:%S')
        e.tick()                                             # 절전 직후 - 연속 횟수 초기화
        self.assertEqual(e.flush(), [])

    def test_scan_done_sends_selection_and_daily_exactly_once_even_after_restart(self):
        e = self.env
        conn = e.research_db()
        e.baseline()
        add_candidate(conn, '2026-10-12', 'pullback', '005930', '삼성전자', 92, 71200, ['5일선 지지', '거래량 증가'])
        add_candidate(conn, '2026-10-12', 'maCloudBreakout', '000660', 'SK하이닉스', 88, 190000, ['224일선 돌파'])
        e.write_status(runner='done', startedAt='2026-10-12T20:15:00+09:00', lastGen={'ok': True, 'reason': 'OK', 'created': 2, 'at': '2026-10-12T23:59:00+09:00'},
                       paperVariants=FormatTests().variants())
        conn.execute("INSERT INTO scan_seen(scanned_at, first_seen, scanned, ok) VALUES ('2026-10-12T14:58:00+00:00', 1, 2387, 1)")
        log_gen(conn, '2026-10-12T23:58:30+09:00', '2026-10-12', 0, 'WAIT_STABLE(30s)')
        log_gen(conn, '2026-10-13T00:01:40+09:00', '2026-10-12', 1, 'OK', 2)
        e.at(2026, 10, 13, 0, 5)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 2)
        self.assertIn('연구 후보 선정', texts[0])
        self.assertIn('5일선 지지', texts[0])
        self.assertIn('일일 보고서', texts[1])
        self.assertIn('2026-10-12(월)', texts[1])
        for _ in range(3):
            e.advance(15)
            e.tick()
        self.assertEqual(len(e.flush()), 2)
        svc2 = e.new_service()                                # 봇 재시작
        e.tick()
        self.assertEqual(len(e.flush()), 2)
        self.assertEqual(len(svc2.api.texts()), 2)
        log_gen(conn, '2026-10-13T00:11:40+09:00', '2026-10-12', 1, 'ALREADY_DONE', 0)     # 같은 스캔의 재확인
        e.advance(900)
        e.tick()
        self.assertEqual(len(e.flush()), 2)
        conn.close()

    def test_zero_candidates_is_reported_as_normal(self):
        e = self.env
        conn = e.research_db()
        e.baseline()
        e.write_status(runner='done', startedAt='2026-10-12T20:15:00+09:00')
        log_gen(conn, '2026-10-12T23:59:00+09:00', '2026-10-12', 1, 'OK', 0)
        e.at(2026, 10, 13, 0, 5)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 2)
        self.assertIn('0종목', texts[0])
        self.assertIn('오류 아님', texts[0])
        conn.close()

    def test_failed_or_stale_scan_does_not_announce(self):
        e = self.env
        conn = e.research_db()
        e.baseline()
        e.write_status(runner='no_scan', mode='once')
        for reason in ('STALE_SCAN(2026-10-08)', 'PARTIAL_SCAN(100<2000)', 'FETCH_ERROR', 'WAIT_STABLE(10s)'):
            log_gen(conn, '2026-10-12T23:59:00+09:00', '2026-10-08', 0, reason, 0)
        e.at(2026, 10, 13, 0, 5)
        e.tick()
        self.assertEqual(e.flush(), [])                      # 실패·오래된 스캔은 후보/보고서를 지어내지 않고, once 모드 no_scan 도 경고 없음
        conn.close()

    def test_very_old_ok_rows_are_not_replayed_on_first_install(self):
        e = self.env
        conn = e.research_db()
        log_gen(conn, '2026-10-05T23:59:00+09:00', '2026-10-05', 1, 'OK', 3)
        e.at(2026, 10, 12, 10, 0)
        e.tick()
        self.assertEqual(e.flush(), [])
        conn.close()

    def test_scan_not_announced_before_status_settles(self):
        e = self.env
        conn = e.research_db()
        e.baseline()
        e.at(2026, 10, 13, 0, 5)
        e.write_status(runner='waiting', startedAt='2026-10-12T20:15:00+09:00')
        log_gen(conn, '2026-10-13T00:04:50+09:00', '2026-10-12', 1, 'OK', 1)     # 10초 전 - 아직 상태 파일 기록 중일 수 있음
        e.tick()
        self.assertEqual(e.flush(), [])
        e.advance(30)
        e.tick()
        self.assertEqual(len(e.flush()), 2)
        conn.close()

    def test_paper_notifications_grouped_and_deduped(self):
        e = self.env
        conn = e.research_db()
        e.baseline()                                         # 기준선(DB 있음)
        e.write_status(paperVariants=FormatTests().variants())
        for v in ('trail_atr', 'atr_close', 'dead35'):
            add_paper(conn, '2026-10-12', 'pullback', '005930', v, entry_date='2026-10-13', entry_price=71500.0, stop_price=None if v == 'dead35' else 66900.0)
        conn.execute("INSERT INTO candidates(scan_date, scanner, code, name, score, base_price, scanned_at, created_at, status) VALUES ('2026-10-12','pullback','005930','삼성전자',90,71000,'x','x','PAPER_ENTERED')")
        conn.commit()
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('신규 진입 1건', texts[0])
        self.assertIn('삼성전자', texts[0])
        e.tick()
        self.assertEqual(len(e.flush()), 1)
        add_paper(conn, '2026-10-12', 'pullback', '005930', 'atr_close', status='PENDING_EXIT', entry_date='2026-10-13', entry_price=71500.0, signal_date='2026-10-14', trail_price=69000.0)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 2)
        self.assertIn('청산 신호', texts[1])
        self.assertIn('체결가·수익률은 다음 거래일 시가', texts[1])
        add_paper(conn, '2026-10-12', 'pullback', '005930', 'atr_close', status='CLOSED', entry_date='2026-10-13', entry_price=71500.0, signal_date='2026-10-14',
                  exit_date='2026-10-15', exit_price=73000.0, ret=0.0165, exit_reason='SIGNAL_ATR_CLOSE', hold_days=3)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 3)
        self.assertIn('청산 확정', texts[2])
        self.assertIn('+1.65%', texts[2])
        self.assertIn('전략별 누적', texts[2])
        for _ in range(3):
            e.tick()
        self.assertEqual(len(e.flush()), 3)
        conn.close()

    def test_paper_baseline_is_silent_for_existing_rows(self):
        e2 = Env()
        try:
            conn = e2.research_db()
            for v in ('trail_atr', 'atr_close', 'dead35'):
                add_paper(conn, '2026-10-05', 'pullback', '005930', v, entry_date='2026-10-06', entry_price=1.0)
            e2.tick()
            e2.tick()
            self.assertEqual(e2.flush(), [])
            conn.close()
        finally:
            e2.close()

    def test_research_errors_and_scan_failure_modes(self):
        e = self.env
        e.at(2026, 10, 13, 8, 20)
        e.write_status(runner='no_scan', mode='poll', startedAt='2026-10-12T20:15:00+09:00', lastGen={'ok': False, 'reason': 'STALE_SCAN(2026-10-09)'},
                       errors=['2026-10-12T21:00 fetch: URLError', '2026-09-01T10:00 paper: 오래된 오류'], heartbeatAt='2026-10-13T08:15:00+09:00')
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 2)
        self.assertTrue(any('연구 엔진 오류' in t and 'URLError' in t for t in texts))
        self.assertTrue(any('장 마감 스캔 미확정' in t and '휴장일이면 정상' in t for t in texts))
        self.assertFalse(any('오래된 오류' in t for t in texts))            # 오래된 오류는 다시 알리지 않는다
        e.tick()
        self.assertEqual(len(e.flush()), 2)

    def test_retired_research_heartbeat_is_ignored_but_disk_is_watched(self):
        e = self.env
        e.at(2026, 10, 13, 21, 0)
        e.write_status(runner='done', mode='poll', startedAt='2026-10-12T20:15:00+09:00')
        e.tick()
        texts = e.flush()
        self.assertEqual(texts, [])
        e.write_status(runner='waiting', mode='poll', startedAt='2026-10-13T20:15:00+09:00', heartbeatAt='2026-10-13T20:20:00+09:00', diskUsedBytes=4.5 * 1024 ** 3)
        e.tick()
        texts = e.flush()
        self.assertFalse(any('연구 작업' in t for t in texts))
        self.assertTrue(any('연구 데이터 용량' in t for t in texts))

    def test_research_log_kiwoom_daily_failures(self):
        e = self.env
        log = os.path.join(e.research, 'research.log')
        lines = ['2026-10-12 09:30:%02d,100 일봉 조회 실패 %s: HTTP 500' % (i, c) for i, c in enumerate(('005930', '000660'))]
        open(log, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
        e.tick()
        self.assertEqual(e.flush(), [])                          # 2종목까지는 개별 실패로 본다
        lines.append('2026-10-12 09:31:05,200 일봉 조회 실패 035420: timeout')
        lines.append('2026-10-11 01:00:00,000 일봉 조회 실패 111111: 오래된 실패')
        open(log, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
        e.tick()
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('키움 일봉 조회 실패', texts[0])
        self.assertIn('3종목', texts[0])

    def test_mute_blocks_only_general(self):
        e = self.env
        conn = e.research_db()
        e.baseline()
        e.svc.notifier.set_mute(2 * 86400)
        add_candidate(conn, '2026-10-12', 'pullback', '005930', '삼성전자')
        e.poll(price=96000.0)                               # 실계좌 감시 알림은 무음이어도 온다
        e.at(2026, 10, 13, 0, 5)
        e.write_status(runner='done', startedAt='2026-10-12T20:15:00+09:00')
        log_gen(conn, '2026-10-13T00:01:00+09:00', '2026-10-12', 1, 'OK', 1)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('주문은 전송되지 않았습니다', texts[0])
        self.assertEqual(e.svc.notifier.clear_mute(), 2)
        conn.close()

    def test_start_detection_variants(self):
        e = Env()
        self.addCleanup(e.close)
        svc = e.svc
        self.assertEqual(svc.detect_start()['kind'], 'first')
        svc.tstore.kv_set('run_state', {'state': 'running', 'heartbeat': e.t[0] - 3600})
        e.uptime = 300
        self.assertEqual(svc.detect_start()['kind'], 'boot')                       # PC 부팅 직후 = 재부팅으로 인한 시작
        e.uptime = 99999
        self.assertEqual(svc.detect_start()['kind'], 'unclean')
        flag = os.path.join(e.dir, 'planned_stop.flag')
        open(flag, 'w').write('x')
        os.utime(flag, (e.t[0], e.t[0]))
        self.assertEqual(svc.detect_start()['kind'], 'planned')                    # restart.bat 이 남긴 표식
        self.assertFalse(os.path.exists(flag))
        svc.tstore.kv_set('run_state', {'state': 'stopped', 'heartbeat': e.t[0] - 60})
        self.assertEqual(svc.detect_start()['kind'], 'planned')

    def test_start_notice_rate_limited(self):
        e = Env()
        self.addCleanup(e.close)
        e.svc.tstore.kv_set('run_state', {'state': 'running', 'heartbeat': e.t[0] - 300})
        ok1 = e.svc.start(threads=False)
        self.assertTrue(ok1)
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('비정상 종료 후 복구', texts[0])
        svc2 = e.new_service()
        svc2.tstore.kv_set('run_state', {'state': 'running', 'heartbeat': e.t[0] - 60})
        svc2.start(threads=False)
        e.advance(10)
        self.assertEqual(len(e.flush()), 1)                   # 5분 안의 재시작 반복은 알림을 또 보내지 않는다


class LivePaperAlertTests(unittest.TestCase):
    """장중 가상매매(C) 이벤트 알림: [모의매매] 표시, 한 번만, 재시작 후에도 중복 없음, /sim 현황."""
    def setUp(self):
        self.env = Env()
        self.env.baseline()
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'research'))
        import live_paper as lp
        self.lp = lp
        self.conn = self.env.research_db()
        lp.ensure_schema(self.conn)

    def tearDown(self):
        self.conn.close()
        self.env.close()

    def add(self, kind, sid=None, code=None, level='info', **payload):
        ts = datetime.fromtimestamp(self.env.t[0], KST)
        with self.conn:
            self.lp.Engine.event(type('E', (), {'conn': self.conn})(), ts, kind, sid, code, level, payload, key='%s:%s:%s:%s' % (kind, sid, code, self.env.t[0]))

    def test_buy_sell_batched_tagged_and_not_repeated(self):
        e = self.env
        self.add('BUY', 'trail_atr', '005930', name='삼성전자', scanner='pullback', qty=10, price=70140.0, quote=70000.0, quoteTs='2026-10-12T09:01:00+09:00', cost=701400.0)
        self.add('BUY', 'dead35', '005930', name='삼성전자', scanner='pullback', qty=10, price=70140.0, quote=70000.0, quoteTs='2026-10-12T09:01:00+09:00', cost=701400.0)
        self.add('SELL_STOP', 'trail_atr', '000660', name='SK하이닉스', reason='STOP_INTRADAY', netRet=-0.035, price=190000.0, pnl=-35000.0)
        e.tick()
        texts = e.flush()
        self.assertEqual(len(texts), 1)
        self.assertIn('[모의매매]', texts[0])
        self.assertIn('가상 매수 1종목', texts[0])
        self.assertIn('삼성전자', texts[0])
        self.assertIn('가상 매도 1건', texts[0])
        self.assertIn('실계좌 주문 아님', texts[0])
        e.advance(120)
        e.tick()
        self.assertEqual(e.flush(), texts)            # 새 메시지 없음
        e.new_service()                                # 프로세스 재시작
        e.tick()
        self.assertEqual(len(e.flush()), 1)           # 이전 메시지만(대기열 재전송 없음)

    def test_feed_down_is_alert_and_live_sell_critical(self):
        e = self.env
        self.add('FEED_DOWN', level='error', msg='시세 수신 중단')
        e.tick()
        self.assertIn('시세 수신 중단', e.flush()[0])
        e.advance(10)
        self.add('LIVE_SELL_ACTIVE', level='critical', msg='x')
        e.tick()
        self.assertIn('LIVE_SELL', e.flush()[-1])

    def test_sim_command_reads_livepaper_json(self):
        e = self.env
        out, _ = e.svc.commands.sim('')
        self.assertIn('상태 파일 없음', out)
        with open(os.path.join(e.research, 'livepaper.json'), 'w', encoding='utf-8') as f:
            json.dump({'engine': 'running', 'feedOk': True, 'liveSellActive': False, 'accounts': {'trail_atr': {'equity': 10100000, 'cumRet': 0.01, 'cash': 9000000, 'positions': 1,
                       'realizedPnl': 0, 'mdd': 0, 'closed': 0}}, 'positions': [{'code': '005930', 'name': '삼성전자', 'ret': 0.01, 'entryPrice': 70000, 'lastPrice': 70700}]}, f)
        out, _ = e.svc.commands.sim('')
        self.assertIn('[모의매매]', out)
        self.assertIn('차단됨', out)
        self.assertIsNone(fake_telegram.html_problem(out), out)


class AuthAndCommandTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.svc = self.env.svc

    def tearDown(self):
        self.env.close()

    def msg(self, text, user=USER, chat_id=None, chat_type='private', date=None):
        return {'update_id': 1, 'message': {'message_id': 1, 'date': date or int(self.env.t[0]), 'text': text, 'from': {'id': user, 'is_bot': False},
                                            'chat': {'id': chat_id if chat_id is not None else user, 'type': chat_type}}}

    def test_authorization_matrix(self):
        a = self.svc.authorize
        self.assertEqual(a({'id': USER}, {'type': 'private', 'id': USER}), 'ok')
        self.assertEqual(a({'id': 999}, {'type': 'private', 'id': 999}), 'denied')                 # 다른 사용자
        self.assertEqual(a({'id': USER}, {'type': 'group', 'id': -1001}), 'ignore')                 # 그룹은 허용 사용자라도 무응답
        self.assertEqual(a({'id': USER}, {'type': 'supergroup', 'id': -1001}), 'ignore')
        self.assertEqual(a({'id': USER}, {'type': 'channel', 'id': -1002}), 'ignore')
        self.assertEqual(a({'id': USER, 'is_bot': True}, {'type': 'private', 'id': USER}), 'ignore')
        self.assertEqual(a({'id': USER}, {'type': 'private', 'id': 123}), 'denied')                 # 채팅 ID 가 다르면 거부

    def test_unauthorized_user_gets_nothing_and_owner_is_warned(self):
        self.svc.handle_update(self.msg('/holdings', user=999))
        self.svc.handle_update(self.msg('/status', user=999))
        replies = self.env.api.texts()
        self.assertEqual(len(replies), 1)                                        # 안내는 한 번만
        self.assertIn('개인 전용', replies[0])
        self.assertNotIn('삼성전자', replies[0])
        self.env.flush()
        alert = [t for t in self.env.api.texts() if '허용되지 않은 접근 시도' in t]
        self.assertEqual(len(alert), 1)
        self.assertNotIn('999', alert[0].replace('***999', ''))               # ID 는 끝 3자리만

    def test_group_chat_is_silent_even_for_owner(self):
        self.svc.handle_update(self.msg('/holdings', chat_id=-100555, chat_type='group'))
        self.svc.handle_update(self.msg('/status', user=999, chat_id=-100555, chat_type='group'))
        self.assertEqual(self.env.api.sent, [])

    def test_commands_read_only_table(self):
        names = set(self.svc.commands.table)
        for forbidden in ('buy', 'sell', 'order', 'watch', 'unwatch', 'stop', 'resume', 'set', 'config', 'live'):
            self.assertNotIn(forbidden, names)
        self.assertEqual(set(self.svc.commands.table) - {'menu'}, {'start', 'help', 'status', 'candidates', 'paper', 'holdings', 'orders', 'risk', 'daily', 'mute', 'unmute', 'test', 'sim'})

    def test_every_command_replies_with_valid_html(self):
        self.env.client.holdings = [holding('005930', avg=70000.0, price=72000.0)]
        for cmd in ('/start', '/help', '/status', '/candidates', '/paper', '/holdings', '/orders', '/risk', '/daily', '/test', '/mute 2h', '/unmute',
                    '/status@ninepay_bot', '/candidates pullback', '/paper trail_atr', '/sim', '📊 상태', '🔎 후보', '💼 보유', '/unknown', '그냥 글'):
            self.env.api.sent.clear()
            self.env.advance(2)
            self.svc.handle_update(self.msg(cmd))
            self.assertGreaterEqual(len(self.env.api.sent), 1, cmd)

    def test_holdings_command_live_fetch_and_fallback(self):
        e = self.env
        e.client.holdings = [holding('005930', avg=70000.0, price=72000.0)]
        self.svc.handle_update(self.msg('/holdings'))
        text = e.api.texts()[-1]
        self.assertIn('삼성전자' if False else '테스트', text)            # FakeClient 종목명
        self.assertIn('실시간 조회', text)
        self.assertIn('👁 감시', text)
        self.svc.holdings_fetched_at = 0.0
        e.client.fail_balance = True
        e.bot.holdings = [dict(holding('005930'), gain=0, watched=True)]
        self.svc.handle_update(self.msg('/holdings'))
        text = e.api.texts()[-1]
        self.assertIn('실시간 조회에 실패', text)
        self.assertNotIn('RuntimeError: 잔고 오류', text)

    def test_mute_unmute_commands(self):
        self.svc.handle_update(self.msg('/mute 2h'))
        self.assertTrue(self.svc.notifier.is_muted())
        self.assertAlmostEqual(self.svc.notifier.mute_until() - self.env.t[0], 7200, delta=1)
        self.svc.handle_update(self.msg('/mute zzz'))
        self.assertIn('시간 형식', self.env.api.texts()[-1])
        self.svc.handle_update(self.msg('/mute 99d'))
        self.assertAlmostEqual(self.svc.notifier.mute_until() - self.env.t[0], 7 * 86400, delta=1)     # 최대 7일
        self.svc.handle_update(self.msg('/unmute'))
        self.assertFalse(self.svc.notifier.is_muted())

    def test_stale_commands_after_downtime_are_ignored(self):
        self.svc.handle_update(self.msg('/status', date=int(self.env.t[0]) - 3 * 3600))
        self.assertEqual(self.env.api.sent, [])

    def test_callbacks(self):
        conn = self.env.research_db()
        add_candidate(conn, '2026-10-12', 'pullback', '005930', '삼성전자', reasons=['5일선 지지'])
        conn.close()
        self.svc.handle_update({'update_id': 2, 'callback_query': {'id': 'cb1', 'from': {'id': USER, 'is_bot': False}, 'data': 'c:candidates:pullback',
                                                                  'message': {'date': int(self.env.t[0]), 'chat': {'id': USER, 'type': 'private'}}}})
        self.assertEqual(self.env.api.callbacks, ['cb1'])
        self.assertIn('눌림목', self.env.api.texts()[-1])
        self.svc.handle_update({'update_id': 3, 'callback_query': {'id': 'cb2', 'from': {'id': 999, 'is_bot': False}, 'data': 'c:candidates:pullback',
                                                                  'message': {'date': int(self.env.t[0]), 'chat': {'id': 999, 'type': 'private'}}}})
        self.assertNotIn('5일선 지지', self.env.api.texts()[-1])
        self.svc.handle_update({'update_id': 4, 'callback_query': {'id': 'cb3', 'from': {'id': USER, 'is_bot': False}, 'data': 'c:buy:005930',
                                                                  'message': {'date': int(self.env.t[0]), 'chat': {'id': USER, 'type': 'private'}}}})
        self.assertIn('만료', self.env.api.texts()[-1])

    def test_candidates_and_paper_views_read_real_tables(self):
        e = self.env
        conn = e.research_db()
        add_candidate(conn, '2026-10-12', 'pullback', '005930', '삼성전자', 92, 71200, ['5일선 지지'])
        add_candidate(conn, '2026-10-12', 'doubleBottom', '000660', 'SK하이닉스', 85, 190000)
        add_paper(conn, '2026-10-12', 'pullback', '005930', 'trail_atr', entry_date='2026-10-13', entry_price=71500.0)
        conn.close()
        e.write_status(paperVariants=FormatTests().variants())
        self.svc.handle_update(self.msg('/candidates'))
        text = e.api.texts()[-1]
        self.assertIn('총 2종목', text)
        self.assertIsNotNone(e.api.sent[-1]['markup'])                  # 검색기별 상세 버튼
        self.svc.handle_update(self.msg('/paper'))
        text = e.api.texts()[-1]
        self.assertIn('ATR 추적', text)
        self.assertIn('독립 계좌', text)
        self.assertNotIn('합계', text)

    def test_status_reports_active_alerts_and_level(self):
        e = self.env
        e.client.fail_balance = True
        e.poll()
        e.advance(31)
        e.poll()
        e.tick()
        self.svc.handle_update(self.msg('/status'))
        text = e.api.texts()[-1]
        self.assertIn('🔴 이상', text)
        self.assertIn('키움 잔고 조회 실패', text)


class ProcGuardTests(unittest.TestCase):
    def test_pid_alive_dead_process_with_open_handle(self):
        import subprocess
        import procguard
        self.assertTrue(procguard.pid_alive(os.getpid()))
        p = subprocess.Popen([sys.executable, '-c', 'pass'])
        p.wait()
        self.assertFalse(procguard.pid_alive(p.pid))        # Popen 이 핸들을 쥐고 있어도 종료된 프로세스는 '죽음'

    def test_lock_rules(self):
        import subprocess
        import procguard
        d = tempfile.mkdtemp()
        sleeper = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
        try:
            path = os.path.join(d, 'bot.lock')
            open(path, 'w').write(str(sleeper.pid))
            self.assertEqual(procguard.held_by_other(path), sleeper.pid)             # 살아 있고 갱신이 최근 -> 점유 중
            old = time.time() - procguard.STALE_SEC - 10
            os.utime(path, (old, old))
            self.assertIsNone(procguard.held_by_other(path))                         # 갱신이 끊겼으면 인계
            open(path, 'w').write('999999')
            self.assertIsNone(procguard.held_by_other(path))                         # 없는 PID
            lock = procguard.InstanceLock(path)
            self.assertTrue(lock.acquire())
            self.assertEqual(open(path).read().strip(), str(os.getpid()))
            lock.release()
            self.assertFalse(os.path.exists(path))
        finally:
            sleeper.kill()
            sleeper.wait()
            shutil.rmtree(d, ignore_errors=True)


class SetupHelperTests(unittest.TestCase):
    """토큰 입력 도우미: 메모장이 BOM 을 붙이거나 따옴표·공백이 섞여도 키움 키와 토큰이 깨지지 않아야 한다."""

    def test_notepad_edited_env_with_bom_is_handled(self):
        import telegram_setup
        import importlib.util
        spec = importlib.util.spec_from_file_location('autotrader_main', os.path.join(HERE, 'main.py'))     # sys.path 에 서버용 main.py 가 섞여 있어 경로로 읽는다
        main_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(main_mod)
        d = tempfile.mkdtemp()
        try:
            path = os.path.join(d, '.env')
            with open(path, 'w', encoding='utf-8-sig') as f:         # 메모장이 BOM 을 붙여 저장한 모양
                f.write('KIWOOM_APPKEY=abc\nTELEGRAM_BOT_TOKEN=  "%s" \n' % TOKEN)
            self.assertEqual(telegram_setup.read_env_value(path, 'KIWOOM_APPKEY'), 'abc')
            self.assertEqual(telegram_setup.read_env_value(path, 'TELEGRAM_BOT_TOKEN'), TOKEN)
            self.assertIsNone(telegram_setup.read_env_value(path, 'NOPE'))
            orig = main_mod.HERE
            main_mod.HERE = d
            os.environ.pop('KIWOOM_APPKEY', None)
            try:
                main_mod.load_env()
                self.assertEqual(os.environ.get('KIWOOM_APPKEY'), 'abc')      # 첫 줄 키가 BOM 때문에 깨지지 않는다
            finally:
                main_mod.HERE = orig
                os.environ.pop('KIWOOM_APPKEY', None)
                os.environ.pop('TELEGRAM_BOT_TOKEN', None)
            tg_config.update_env_file(path, {'TELEGRAM_BOT_TOKEN': TOKEN})   # 다시 쓰면 BOM 이 사라진다
            self.assertFalse(open(path, 'rb').read().startswith(codecs.BOM_UTF8))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_clean_token_and_shape(self):
        import telegram_setup
        self.assertEqual(telegram_setup.clean_token('  "%s"  ' % TOKEN), TOKEN)
        self.assertEqual(telegram_setup.clean_token('bot' + TOKEN), TOKEN)
        self.assertTrue(telegram_setup.TOKEN_SHAPE.match(TOKEN))
        self.assertFalse(telegram_setup.TOKEN_SHAPE.match('123456789:short'))
        self.assertFalse(telegram_setup.TOKEN_SHAPE.match('아무 글자'))
        self.assertEqual(telegram_setup.clean_token(None), '')


if __name__ == '__main__':
    unittest.main()
