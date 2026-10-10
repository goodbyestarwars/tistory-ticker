# -*- coding: utf-8 -*-
"""명령 응답·일일 보고서가 공유하는 화면 조립(읽기 전용). 데이터는 tg_data 에서, 서식은 tg_format 에서 가져온다.

`svc`(TelegramService) 에서 쓰는 것: clock/now_dt, bot, store, db_path, research_dir, tstore, notifier, sender, poll 상태.
"""
import logging
import os
import re
import shutil
import time
from datetime import timedelta

import tg_data
import tg_format as F
from tg_notify import fmt_duration

log = logging.getLogger('autotrader.telegram')
ERR_TS_RE = re.compile(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})')


def recent_errors(status, now_dt, hours=36):
    """status.json 의 errors 는 실행을 넘겨 쌓이므로(지워지지 않음) 앞쪽 시각으로 최근 것만 고른다."""
    out = []
    for text in (status or {}).get('errors') or []:
        m = ERR_TS_RE.match(str(text))
        dt = F.to_dt(m.group(1)) if m else None
        if dt is not None and now_dt - dt <= timedelta(hours=hours):
            out.append(str(text))
    return out


class Views:
    def __init__(self, svc):
        self.svc = svc

    # ---- 공통 ----
    def research_status(self):
        data = tg_data.read_status_json(self.svc.research_dir)
        return dict(data, available=True) if data else {'available': False}

    def active_alerts(self):
        now = self.svc.clock()
        out = []
        for a in self.svc.tstore.alerts_active():
            label, level = F.ALERT_META.get(a['key'], (a['key'], 'warn'))
            out.append({'key': a['key'], 'label': label, 'level': level, 'age': fmt_duration(now - (a['since'] or now))})
        return out

    def level(self, alerts):
        if any(a['level'] == 'critical' for a in alerts):
            return 'bad'
        return 'warn' if alerts else 'ok'

    # ---- /status ----
    def status(self):
        svc = self.svc
        s, h = svc.bot.status(), svc.bot.health()
        alerts = self.active_alerts()
        sender = svc.sender.health()
        stats = svc.tstore.outbox_stats()
        mute_until = svc.notifier.mute_until()
        try:
            free = shutil.disk_usage(svc.base_dir).free
        except OSError:
            free = None
        data = {'now': svc.now_dt(), 'level': self.level(alerts), 'alerts': alerts,
                'bot': {'live_sell': s['live_sell'], 'market_open': s['market_open'], 'last_poll': s['last_poll'], 'stopped': s['stopped'],
                        'balance_failures': h['balance_failures'], 'watch_count': s['watch_count'], 'sells_today': s['sells_today'],
                        'max_sells_per_day': s['max_sells_per_day']},
                'research': self.research_status(),
                'telegram': {'net_ok': sender['ok'], 'pending': stats.get('PENDING', 0), 'last_ok': sender['last_ok'],
                             'mute_until': mute_until if mute_until > svc.clock() else None},
                'pc': {'free_bytes': free}}
        return F.fmt_status(data), None

    # ---- /candidates ----
    def latest_scan_date(self):
        return tg_data.latest_candidate_date(self.svc.research_dir)

    def candidates(self, arg=None):
        scan_date = self.latest_scan_date()
        cands = tg_data.candidates_for(self.svc.research_dir, scan_date) if scan_date else []
        scanner = self.match_scanner(arg)
        text = F.fmt_candidates({'now': self.svc.now_dt(), 'scan_date': scan_date, 'cands': cands}, scanner)
        markup = None
        if cands and not scanner:
            buttons = [{'text': '%s %d' % (F.SCANNER_LABELS.get(k, k), len(v)), 'callback_data': 'c:candidates:%s' % k} for k, v in F.group_by_scanner(cands)]
            markup = {'inline_keyboard': [buttons[i:i + 2] for i in range(0, len(buttons), 2)]}
        return text, markup

    @staticmethod
    def match_scanner(arg):
        arg = (arg or '').strip().lower()
        if not arg:
            return None
        for key, label in F.SCANNER_LABELS.items():
            if arg in (key.lower(), label.replace(' ', '')):
                return key
        return None

    # ---- /paper ----
    def paper(self, arg=None):
        rows = tg_data.paper_rows(self.svc.research_dir)
        variants = self.research_status().get('paperVariants') or {}
        open_counts = {}
        for r in rows:
            c = open_counts.setdefault(r['variant'], {'open': 0, 'pending': 0})
            if r['status'] == 'OPEN' and r.get('entry_date'):
                c['open'] += 1
            elif r['status'] == 'PENDING_EXIT':
                c['pending'] += 1
        closed = sorted((r for r in rows if r['status'] == 'CLOSED'), key=lambda r: (r.get('exit_date') or '', r['code']), reverse=True)
        variant = (arg or '').strip() if (arg or '').strip() in F.VARIANT_LABELS else None
        text = F.fmt_paper({'now': self.svc.now_dt(), 'variants': variants, 'open_counts': open_counts, 'recent_closed': closed[:40]}, variant)
        markup = None
        if variants and not variant:
            markup = {'inline_keyboard': [[{'text': F.VARIANT_SHORT[k], 'callback_data': 'c:paper:%s' % k}] for k in F.VARIANT_ORDER if k in variants]}
        return text, markup

    # ---- /holdings ----
    def holdings(self):
        svc = self.svc
        bot = svc.bot
        watched = {w['code'] for w in bot.store.watch_list()}
        note, fresh, holdings, updated = None, False, None, bot.last_poll
        if time.time() - svc.holdings_fetched_at < 8 and svc.holdings_cache is not None:
            holdings, fresh = svc.holdings_cache, True
        else:
            try:
                holdings = bot.client.balance()            # 읽기 전용 조회(kt00018). 주문 함수는 호출하지 않는다.
                svc.holdings_cache, svc.holdings_fetched_at, fresh = holdings, time.time(), True
            except Exception as exc:
                note = '실시간 조회에 실패해 마지막 조회 값을 보여줍니다 (%s)' % type(exc).__name__
                log.warning('/holdings 실시간 조회 실패: %s', exc)
                holdings = [dict(h) for h in (bot.holdings or [])]
        rows = [dict(h, watched=h['code'] in watched) for h in holdings]
        return F.fmt_holdings({'now': svc.now_dt(), 'holdings': rows, 'fresh': fresh, 'updated': updated, 'note': note}), None

    # ---- /orders ----
    def orders(self):
        svc = self.svc
        names = {w['code']: w.get('name') for w in svc.bot.store.watch_list()}
        names.update({h['code']: h.get('name') for h in (svc.bot.holdings or [])})
        rows = tg_data.recent_orders(svc.db_path, 8)
        for o in rows:
            o['name'] = names.get(o['code'])
            if o['status'] == 'ERROR':
                o['kind'] = tg_data.order_error_kind(svc.db_path, o)
        return F.fmt_orders({'now': svc.now_dt(), 'orders': rows, 'sent_today': svc.bot.store.orders_today(), 'live_sell': svc.bot.status()['live_sell']}), None

    # ---- /risk ----
    def risk(self):
        svc = self.svc
        s = svc.bot.status()
        rs = self.research_status()
        return F.fmt_risk({'now': svc.now_dt(), 'config': svc.bot.config, 'live_sell': s['live_sell'], 'sells_today': s['sells_today'],
                           'disk_limit': rs.get('diskLimitBytes')}), None

    # ---- /daily ----
    def daily_data(self, scan_date=None):
        svc = self.svc
        now_dt = svc.now_dt()
        scan_date = scan_date or self.latest_scan_date() or ((tg_data.latest_ok_gen(svc.research_dir) or {}).get('scan_date'))
        status = self.research_status()
        gen = tg_data.latest_ok_gen(svc.research_dir)
        events = svc.tstore.paper_events_since(svc.clock() - 20 * 3600)
        day = scan_date or now_dt.strftime('%Y-%m-%d')      # 자정을 넘겨 보고서가 나가도 '그날'(데이터 기준일)의 감시 기록을 센다
        orders = [o for o in tg_data.recent_orders(svc.db_path, 300) if o['day'] == day]
        bot = svc.bot
        return {'scan_date': scan_date, 'now': now_dt, 'scan_ok': bool(gen and gen.get('scan_date') == scan_date),
                'scanned': tg_data.scanned_count(svc.research_dir, scan_date) if scan_date else None,
                'cands': tg_data.candidates_for(svc.research_dir, scan_date) if scan_date else [],
                'paper_events': [dict(e['payload'], kind=e['kind']) for e in events],
                'variants': status.get('paperVariants') or {},
                'errors': recent_errors(status, now_dt),
                'health': {'active_alerts': [a['label'] for a in self.active_alerts()]},
                'bot': {'live_sell': bot.status()['live_sell'], 'holdings_n': len(bot.holdings or []), 'watch_count': len(bot.store.watch_list()),
                        'last_poll': bot.last_poll, 'dry_today': sum(1 for o in orders if o['status'] == 'DRY'),
                        'sent_today': sum(1 for o in orders if o['status'] == 'SENT'), 'error_today': sum(1 for o in orders if o['status'] == 'ERROR')}}

    def daily(self):
        data = self.daily_data()
        if not data['scan_date']:
            return F.head('📊', '일일 보고서') + '\n\n아직 완료된 스캔이 없어 보고서를 만들 수 없습니다. 평일 20:15 이후 스캔이 확정되면 자동으로 발송됩니다.', None
        return F.fmt_daily(data), None
