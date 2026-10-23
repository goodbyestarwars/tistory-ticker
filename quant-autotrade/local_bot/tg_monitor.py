# -*- coding: utf-8 -*-
"""텔레그램 자동 알림 감시자(읽기 전용 관찰자).

봇·연구 작업의 코드를 호출하거나 바꾸지 않는다. 이미 남는 기록(autotrader.db 이벤트·research.db·status.json)과 Bot 의 읽기 전용 상태만 본다.
그래서 이 스레드가 느려지거나 죽어도 손절·익절 판단 루프와 연구 엔진은 영향을 받지 않는다.

감시 항목(15초 주기)
  events    봇 이벤트 스트림 -> 감시 종목 조건(DRY_SELL)·주문 접수/거부/실패·보유 종료·정지/재개·치명 오류. 워터마크로 한 번씩만.
  positions 감시 종목의 보유 수량 감소(일부 체결/직접 매도 추정)
  health    잔고 조회 연속 실패·판단 루프 정지·STOP 상태 (발생/지속/복구)
  research  연구 작업 오류·스캔 미확정 종료·작업 미시작/응답 없음·용량·갱신 지연
  paper     모의 거래 상태 변화(진입·청산 신호·청산 확정)
  scan      스캔 정상 완료 -> 종목 선정 알림 + 일일 보고서 (실제 완료 기록 gen_log 기준, 고정 시각 발송 없음)
  pc        PC 디스크 여유
"""
import hashlib
import logging
import os
import shutil
from datetime import timedelta

import tg_data
import tg_format as F
import tg_live_orders
import tg_live_status
import tg_volume_surge
from bot import MSG_ORDER_FAILED, MSG_ORDER_REJECTED
from tg_notify import fmt_duration
from tg_views import Views, recent_errors

log = logging.getLogger('autotrader.telegram')
TICK_SEC = 15
SLEEP_GAP_SEC = 120
SNAPSHOT_KEEP_SEC = 1800
SCAN_SETTLE_SEC = 20
SCAN_FRESH = timedelta(hours=36)
DISK_WARN_BYTES, DISK_CRIT_BYTES, DISK_OK_BYTES = 3 * 1024 ** 3, 1 * 1024 ** 3, 4 * 1024 ** 3


def digest(text):
    return hashlib.sha1(str(text).encode('utf-8')).hexdigest()[:12]


def in_poll_window(now_dt):
    """연구 작업의 감시 구간(평일 20:15 ~ 다음 날 08:15, research_job.session_mode 와 같은 규칙)."""
    hm = (now_dt.hour, now_dt.minute)
    if now_dt.weekday() < 5 and hm >= (20, 15):
        return True
    return hm < (8, 15) and (now_dt - timedelta(days=1)).weekday() < 5


class Monitor:
    def __init__(self, svc):
        self.svc = svc
        self.views = Views(svc)
        self.fail_counts = {}
        self.streaks = {}
        self._last_tick = None

    # ---- 루프 ----
    def run(self, stop_event):
        while not stop_event.is_set():
            self.tick()
            stop_event.wait(TICK_SEC)

    def tick(self):
        svc = self.svc
        now = svc.clock()
        if self._last_tick is not None and now - self._last_tick > SLEEP_GAP_SEC:
            self.streaks.clear()           # PC 절전에서 깬 직후의 오래된 값으로 경고를 내지 않는다
        self._last_tick = now
        for name, fn in (('events', self.watch_bot_events), ('positions', self.watch_positions), ('health', self.watch_bot_health),
                         ('research', self.watch_research), ('researchlog', self.watch_research_log), ('paper', self.watch_paper), ('live', self.watch_live_paper), ('liveorders', self.watch_live_orders), ('livestatus', self.watch_live_status), ('surge', self.watch_volume_surge), ('scan', self.watch_scan_done),
                         ('pc', self.watch_pc)):
            try:
                fn()
                self.fail_counts[name] = 0
            except Exception as exc:       # 한 감시자의 오류가 나머지를 막지 않게 한다
                self.fail_counts[name] = self.fail_counts.get(name, 0) + 1
                log.error('텔레그램 감시자(%s) 오류 %d회: %s', name, self.fail_counts[name], type(exc).__name__)
                log.debug('상세', exc_info=True)
                if self.fail_counts[name] >= 5:
                    svc.notifier.raise_alert('tg_monitor_' + name, F.fmt_alert('알림 감시 오류', '알림 감시 항목 <b>%s</b>이(가) 반복해서 실패하고 있습니다. 해당 알림이 오지 않을 수 있습니다.' % name,
                                                                                'warn', 'logs 폴더의 로그를 확인하세요', svc.now_dt()), 'warn', 6 * 3600)
        try:
            svc.heartbeat()
        except Exception as exc:
            log.error('생존 신호 기록 실패: %s', type(exc).__name__)

    # ---- 1) 봇 이벤트 ----
    def watch_bot_events(self):
        svc, t = self.svc, self.svc.tstore
        last = t.kv_get('events_last_id')
        if last is None:        # 처음 켠 날의 과거 이벤트를 쏟아내지 않는다
            t.kv_set('events_last_id', tg_data.bot_events_max_id(svc.db_path))
            return
        for ev in tg_data.bot_events_since(svc.db_path, last):
            try:
                self.handle_event(ev)
            except Exception as exc:
                log.error('이벤트 %s 알림 처리 실패: %s', ev.get('id'), type(exc).__name__)
            t.kv_set('events_last_id', ev['id'])

    def _name(self, code):
        for w in self.svc.bot.store.watch_list():
            if w['code'] == code and w.get('name'):
                return w['name']
        for h in self.svc.bot.holdings or []:
            if h['code'] == code and h.get('name'):
                return h['name']
        return (self.svc.tstore.kv_get('snapshot') or {}).get(code, {}).get('name')

    def _order_info(self, ev):
        info = tg_data.parse_label(ev.get('detail'))
        info.update(code=ev['code'], name=self._name(ev['code']))
        return info

    def handle_event(self, ev):
        svc = self.svc
        typ, code, detail = ev['type'], ev.get('code'), ev.get('detail') or ''
        when = F.to_dt(ev['ts']) or svc.now_dt()
        day = str(ev['ts'])[:10]
        notify = svc.notifier.notify
        if typ == 'DRY_SELL' and code:
            info = self._order_info(ev)
            notify('dry:%s:%s:%s' % (code, info.get('reason'), day), F.fmt_order_event('DRY', info, when), 'order', 'warn')
        elif typ == 'SELL_SENT' and code:
            info = self._order_info(ev)
            info['ord_no'] = tg_data.parse_ord_no(detail)
            notify('sent:%s' % ev['id'], F.fmt_order_event('SENT', info, when), 'order', 'critical')
        elif typ == 'ERROR' and code and detail.startswith((MSG_ORDER_REJECTED, MSG_ORDER_FAILED)):
            kind = 'REJECTED' if detail.startswith(MSG_ORDER_REJECTED) else 'FAILED'
            info = self._order_info(ev)
            info['message'] = detail.split(': ', 1)[1].split(' | ')[0] if ': ' in detail else detail
            notify('%s:%s' % (kind.lower(), ev['id']), F.fmt_order_event(kind, info, when), 'order', 'critical')
        elif typ in ('ERROR', 'CRITICAL') and '잔고 조회 실패' in detail:
            return          # 연속 실패 경고(health)가 따로 다룬다
        elif typ == 'ERROR':
            normalized = ''.join(c for c in detail if not c.isdigit())[:120]
            notify('err:%s:%s' % (digest(normalized), str(ev['ts'])[:13]),
                   F.fmt_alert('봇 오류', ['봇이 오류를 기록했습니다.', F.esc(F.clip(detail, 200))], 'warn', '반복되면 logs 폴더의 로그를 확인하세요', when), 'alert', 'warn')
        elif typ == 'CRITICAL':
            notify('crit:%s' % ev['id'], F.fmt_alert('봇 치명 알림', [F.esc(F.clip(detail, 240))], 'critical', '증권사 앱에서 직접 확인하세요', when), 'alert', 'critical')
        elif typ == 'POSITION_CLOSED' and code:
            snap = (svc.tstore.kv_get('snapshot') or {}).get(code, {})
            had_order = tg_data.orders_today_sent(svc.db_path, code, day) > 0
            info = {'code': code, 'name': self._name(code) or snap.get('name'), 'had_order': had_order, 'gain': snap.get('gain')}
            notify('closed:%s' % ev['id'], F.fmt_order_event('CLOSED', info, when), 'order', 'warn')
        elif typ == 'STOP' and '종료' not in detail:
            notify('stop:%s' % ev['id'], F.fmt_alert('봇 정지 요청', '운영센터 화면에서 정지가 요청되었습니다. 정지 중에는 손절·익절 판단을 하지 않습니다.', 'warn', '재개는 운영센터의 재개 버튼 또는 STOP 파일 삭제', when), 'alert', 'warn')
        elif typ == 'RESUME':
            notify('resume:%s' % ev['id'], F.head('▶️', '봇 정지 해제') + '\n\n운영센터 화면에서 재개되었습니다. 손절·익절 판단을 다시 합니다.\n\n' + F.foot(when), 'alert', 'info')

    # ---- 2) 보유 수량 변화 ----
    def watch_positions(self):
        svc, t = self.svc, self.svc.tstore
        holdings = [h for h in (svc.bot.holdings or []) if h.get('code')]
        snap = t.kv_get('snapshot') or {}
        now = svc.clock()
        if holdings:
            watched = {w['code'] for w in svc.bot.store.watch_list()}
            events, new_known = tg_data.track_partial_fills(holdings, t.kv_get('known_qty') or {}, watched)
            for e in events:
                svc.notifier.notify('partial:%s:%s:%s:%s' % (e['code'], e['before'], e['after'], svc.now_dt().strftime('%Y-%m-%d')),
                                    F.fmt_order_event('PARTIAL', e, svc.now_dt()), 'order', 'warn')
            t.kv_set('known_qty', new_known)
            for h in holdings:
                gain = (h['price'] / h['avg'] - 1) * 100 if h.get('avg') and h.get('price') else None
                snap[h['code']] = {'name': h.get('name'), 'gain': gain, 'qty': h.get('qty'), 'seen': now}
        snap = {k: v for k, v in snap.items() if now - v.get('seen', 0) <= SNAPSHOT_KEEP_SEC or k in {h['code'] for h in holdings}}
        t.kv_set('snapshot', snap)

    # ---- 3) 봇 상태 ----
    def watch_bot_health(self):
        svc = self.svc
        n = svc.notifier
        s, h = svc.bot.status(), svc.bot.health()
        market = s['market_open']
        now_dt = svc.now_dt()
        if market:
            fails = h['balance_failures']
            if fails >= 2:
                n.raise_alert('kiwoom_balance', F.fmt_alert('키움 잔고 조회 실패', ['잔고 조회가 <b>%d회 연속</b> 실패했습니다.' % fails, '조회가 복구될 때까지 <b>손절·익절 판단이 멈춰 있습니다</b>.',
                                                                              F.esc(F.clip(h.get('last_error'), 160))],
                                                            'critical' if fails >= 3 else 'warn', '키움 API 점검·IP 등록·네트워크를 확인하고, 필요하면 증권사 앱에서 직접 관리하세요', now_dt),
                              'critical' if fails >= 3 else 'warn', 1800)
            elif fails == 0:
                n.clear_alert('kiwoom_balance', '키움 잔고 조회가 정상으로 돌아왔습니다. 손절·익절 판단을 다시 하고 있습니다.')
            if s['stopped']:
                n.raise_alert('bot_stopped', F.fmt_alert('봇 정지(STOP) 상태', '장중인데 정지 상태입니다. 감시 종목의 손절·익절 판단을 하지 않습니다.', 'warn', '의도한 정지가 아니면 운영센터 재개 또는 STOP 파일을 삭제하세요', now_dt), 'warn', 7200)
        if not s['stopped']:
            n.clear_alert('bot_stopped', '정지가 해제되었습니다.')
        # 판단 루프 정지: last_poll 은 장 시간 여부와 무관하게 매 주기 갱신된다
        last_poll = F.to_dt(h.get('last_poll'))
        limit = max(300, h['poll_seconds'] * 6)
        if last_poll and (now_dt - last_poll).total_seconds() > limit:
            self.streaks['stalled'] = self.streaks.get('stalled', 0) + 1
            if self.streaks['stalled'] >= 2:
                n.raise_alert('bot_stalled', F.fmt_alert('봇 판단 루프 정지', ['마지막 조회가 %s 전입니다(%s). 봇 프로세스는 살아 있지만 판단 루프가 멈춘 것으로 보입니다.'
                                                                           % (fmt_duration((now_dt - last_poll).total_seconds()), F.ts(last_poll))], 'critical', 'restart.bat 으로 봇을 다시 시작하세요', now_dt),
                              'critical', 1800)
        else:
            self.streaks['stalled'] = 0
            n.clear_alert('bot_stalled', '봇 판단 루프가 다시 동작합니다.')
        # 텔레그램 수신 충돌(같은 토큰으로 다른 곳에서 getUpdates)
        if svc.poll_conflicts >= 3:
            n.raise_alert('tg_conflict', F.fmt_alert('텔레그램 수신 충돌', '같은 봇 토큰으로 다른 프로그램이 메시지를 받고 있습니다. 명령이 정상 응답하지 않을 수 있습니다(알림 전송은 가능).', 'warn',
                                                      '봇이 두 곳에서 실행 중인지 확인하세요', now_dt), 'warn', 6 * 3600)
        elif svc.poll_conflicts == 0:
            n.clear_alert('tg_conflict', '텔레그램 수신 충돌이 해소되었습니다.')

    # ---- 4) 연구 엔진 ----
    def watch_research(self):
        svc = self.svc
        n = svc.notifier
        rs = tg_data.read_status_json(svc.research_dir)
        if rs is None:
            return
        now_dt = svc.now_dt()
        runner, mode = rs.get('runner'), rs.get('mode')
        for text in recent_errors(rs, now_dt):
            n.notify('rerr:%s' % digest(text), F.fmt_alert('연구 엔진 오류', [F.esc(F.clip(text, 220))], 'warn', '반복되면 research 폴더의 research.log 를 확인하세요', now_dt), 'alert', 'warn')
        if runner == 'no_scan' and mode == 'poll':      # 밤새 기다렸지만 스캔 결과가 확정되지 않음(구간 밖 단발 확인은 정상 동작이라 제외)
            gen = rs.get('lastGen') or {}
            n.notify('scanfail:%s' % rs.get('startedAt'),
                     F.fmt_alert('장 마감 스캔 미확정', ['감시 구간(다음 날 08:15)까지 스캔 결과가 확정되지 않아 오늘 후보를 만들지 못했습니다.', '마지막 판정: %s' % F.esc(F.clip(gen.get('reason'), 60)),
                                                       '휴장일이면 정상입니다. 평일 거래일인데 반복되면 서버 스캔(20:10)을 확인하세요.'], 'warn', None, now_dt), 'alert', 'warn')
        ratio = (rs.get('diskUsedBytes') or 0) / rs['diskLimitBytes'] if rs.get('diskLimitBytes') else 0
        if runner == 'disk_limit' or ratio >= 0.8:
            n.raise_alert('research_disk', F.fmt_alert('연구 데이터 용량', ['연구 데이터 폴더가 %s / %s (%.0f%%)입니다.' % (F.gb(rs.get('diskUsedBytes')), F.gb(rs.get('diskLimitBytes')), ratio * 100),
                                                                       '상한에 닿으면 후보 생성이 멈춥니다.' + (' <b>현재 정지됨</b>' if runner == 'disk_limit' else '')],
                                                             'critical' if runner == 'disk_limit' else 'warn', 'research 폴더의 오래된 로그·파일을 정리하세요', now_dt),
                          'critical' if runner == 'disk_limit' else 'warn', 12 * 3600)
        elif ratio < 0.7:
            n.clear_alert('research_disk', '연구 데이터 용량이 정상 범위로 돌아왔습니다.')
        hb = F.to_dt(rs.get('heartbeatAt'))
        if runner in ('starting', 'waiting') and in_poll_window(now_dt) and hb and now_dt - hb > timedelta(minutes=25):
            n.raise_alert('research_hb', F.fmt_alert('연구 작업 응답 없음', '스캔 대기 중이어야 하는 시간인데 연구 작업의 마지막 생존 신호가 %s 전입니다(%s).' % (fmt_duration((now_dt - hb).total_seconds()), F.ts(hb)),
                                                      'warn', '작업 스케줄러의 AutotraderResearch 작업 상태를 확인하세요', now_dt), 'warn', 3 * 3600)
        else:
            n.clear_alert('research_hb', '연구 작업이 다시 응답합니다.')
        started = F.to_dt(rs.get('startedAt'))
        if now_dt.weekday() < 5 and (now_dt.hour, now_dt.minute) >= (20, 45) and (started is None or started.strftime('%Y-%m-%d') != now_dt.strftime('%Y-%m-%d')):
            n.raise_alert('research_not_started', F.fmt_alert('오늘 연구 작업 미시작', '평일 20:15 연구 작업이 오늘 아직 시작되지 않았습니다(마지막 시작 %s).' % F.ts(started), 'warn',
                                                              'PC 절전·작업 스케줄러 상태를 확인하세요. PC에 로그온하면 자동으로 따라잡습니다', now_dt), 'warn', 6 * 3600)
        elif started and started.strftime('%Y-%m-%d') == now_dt.strftime('%Y-%m-%d'):
            n.clear_alert('research_not_started', '오늘 연구 작업이 시작되었습니다.')
        success = F.to_dt(rs.get('lastSuccessAt'))
        if success and now_dt - success > timedelta(days=4) and now_dt.weekday() < 5 and now_dt.hour >= 9:
            n.raise_alert('research_stale', F.fmt_alert('연구 데이터 갱신 지연', ['마지막 후보 생성이 %s 전(%s)입니다.' % (fmt_duration((now_dt - success).total_seconds()), F.ts(success)),
                                                                           '연휴가 길었다면 정상일 수 있습니다.'], 'warn', 'research.log 와 서버 스캔을 확인하세요', now_dt), 'warn', 24 * 3600)
        elif success and now_dt - success <= timedelta(days=3):
            n.clear_alert('research_stale', '연구 후보가 다시 갱신되었습니다.')

    def watch_research_log(self):
        """연구 작업은 키움 일봉 조회 실패를 status.json 이 아니라 research.log 에만 남긴다(종목별 경고). 최근 로그 꼬리를 읽어 실패가 몰리면 알린다."""
        svc = self.svc
        path = os.path.join(svc.research_dir, 'research.log')
        if not os.path.exists(path):
            return
        now_dt = svc.now_dt()
        with open(path, 'rb') as f:
            f.seek(max(0, os.path.getsize(path) - 65536))
            tail = f.read().decode('utf-8', 'replace')
        failed = {}
        for line in tail.splitlines():
            if '일봉 조회 실패' not in line:
                continue
            stamp = F.to_dt(line[:19].replace(',', '.'))
            if stamp is not None and now_dt - stamp <= timedelta(hours=3):
                failed[line.split('일봉 조회 실패', 1)[1].split(':', 1)[0].strip()] = stamp
        if len(failed) >= 3:
            latest = max(failed.values())
            svc.notifier.notify('kiwoom_daily:%s' % latest.strftime('%Y-%m-%d %H'),
                                F.fmt_alert('키움 일봉 조회 실패(연구 엔진)', ['최근 3시간 동안 %d종목의 일봉 조회가 실패했습니다(마지막 %s).' % (len(failed), F.ts(latest)),
                                                                       '키움 접속·토큰·IP 등록 문제일 수 있습니다. 모의 진입·청산 판정이 미확정으로 남을 수 있습니다.'],
                                                  'warn', '봇 폴더에서 check.bat 으로 키움 접속을 확인하세요', now_dt), 'alert', 'warn')

    # ---- 5) 모의 거래 ----
    def watch_paper(self):
        svc, t = self.svc, self.svc.tstore
        if not os.path.exists(tg_data.research_db_path(svc.research_dir)):
            return
        rows = tg_data.paper_rows(svc.research_dir)
        first_run = t.kv_get('paper_baseline') is None
        events, updates = tg_data.diff_paper(rows, t.paper_seen_all(), first_run)
        if updates:
            t.paper_seen_put(updates)
        if first_run:
            t.kv_set('paper_baseline', svc.clock())
        if not events:
            return
        now = svc.clock()
        for e in events:
            t.paper_event_add(now, e['kind'], '%s|%s|%s' % (e['scan_date'], e['scanner'], e['code']), e.get('variant'), e)
        status = tg_data.read_status_json(svc.research_dir) or {}
        key = 'paper:' + digest('|'.join(sorted('%s|%s|%s|%s|%s' % (e['kind'], e['scan_date'], e['scanner'], e['code'], e.get('variant')) for e in events)))
        svc.notifier.notify(key, F.fmt_paper_update(events, status.get('paperVariants') or {}, svc.now_dt()), 'general', 'info')

    # ---- 5-2) 장중 가상매매(C) 이벤트 ----
    def watch_live_paper(self):
        """live_paper_job 이 research.db(lp_events)에 남긴 이벤트를 한 주기에 한 메시지로 묶어 보낸다. 커서(마지막 id)와 알림 대기열 키로 재시작에도 중복 없음."""
        svc, t = self.svc, self.svc.tstore
        if not os.path.exists(tg_data.research_db_path(svc.research_dir)):
            return
        last = int(t.kv_get('lp_last_id') or 0)
        events = tg_data.live_events_since(svc.research_dir, last)
        if not events:
            return
        alert = [e for e in events if e['kind'] in F.LIVE_ALERT_KINDS and e['level'] in ('error', 'critical', 'warn')]
        key = 'live:%d-%d' % (events[0]['id'], events[-1]['id'])
        category = 'alert' if alert and len(alert) == len(events) else 'general'
        level = 'critical' if any(e['level'] == 'critical' for e in events) else ('warn' if alert else 'info')
        svc.notifier.notify(key, F.fmt_live_events(events, svc.now_dt()), category, level)   # 같은 key 는 대기열이 한 번만 받는다
        t.kv_set('lp_last_id', events[-1]['id'])

    # ---- 5-3) 실계좌 엔진 매수·매도 주문 (2026-10-18) ----
    def watch_live_orders(self):
        """PC 실계좌 엔진의 장부(live_orders.db intents)를 읽기 전용으로 읽어 오늘 주문을 알린다. 단계(접수·부분/전량 체결·거부·실패)나
        확인된 체결이 바뀌면 알림 키가 달라져 한 번 더 나가고, 같으면 대기열이 중복을 막는다(재시작 후에도 같다). 엔진은 건드리지 않는다."""
        svc = self.svc
        path = os.path.join(svc.base_dir, 'live_orders.db')
        if not os.path.exists(path):
            return
        now_dt = svc.now_dt()
        intents = tg_live_orders.read_intents(path, now_dt.strftime('%Y-%m-%d'))
        if not intents:
            return
        fills = tg_live_orders.read_fills(svc.base_dir)
        for intent in intents:
            try:
                name = self._name(intent['code']) or self._saved_name(intent['code'])
                key, data = tg_live_orders.build(intent, intents, fills, name)
                svc.notifier.notify(key, tg_live_orders.fmt_live_order(data, now_dt), 'order', 'critical')
            except Exception as exc:
                log.error('실계좌 주문 %s 알림 처리 실패: %s', intent.get('id'), type(exc).__name__)

    # ---- 5-4) 실계좌 runner 상태·요약 (2026-10-23) ----
    def watch_live_status(self):
        """live_status.json·오늘 장부를 읽기 전용으로 읽어 막힘 상태·피드 장애·runner 응답 없음을 알리고, 평일 09:05/14:05/15:35 요약을 보낸다.
        runner·엔진은 건드리지 않는다. 같은 사건은 알림 상태(alerts)와 키로 한 번만 나간다."""
        svc = self.svc
        n = svc.notifier
        status = tg_live_status.read_status(svc.base_dir)
        if status is None:
            return
        now_dt = svc.now_dt()
        market = bool(svc.bot.status().get('market_open'))
        state = status.get('state')
        age = tg_live_status.status_age_sec(status, now_dt)
        fresh = age is not None and age <= tg_live_status.STALE_SEC
        # runner 응답 없음(장중에만)
        if market and age is not None and age > tg_live_status.STALE_SEC:
            self.streaks['live_stale'] = self.streaks.get('live_stale', 0) + 1
            if self.streaks['live_stale'] >= 2:
                n.raise_alert('live_stale', tg_live_status.fmt_stale(age, now_dt), 'critical', 1800)
        else:
            self.streaks['live_stale'] = 0
            if fresh:
                n.clear_alert('live_stale', 'runner 가 다시 점검을 기록하고 있습니다.')
        # 막힘 상태(신선한 상태 파일일 때만 - 어제 값으로 오늘 경고하지 않는다)
        prev = self.streaks.get('live_block_key')
        key = ('live_state_' + str(state)) if fresh and tg_live_status.is_blocking(state) else None
        if prev and prev != key:
            n.clear_alert(prev, 'runner 막힘 상태가 풀렸습니다(현재 상태: %s).' % F.esc(str(state)))
        if key:
            level, text = tg_live_status.fmt_blocking(state, now_dt)
            n.raise_alert(key, text, level, 3600)
        self.streaks['live_block_key'] = key
        # 신호 피드 장애(개장 직후 짧은 불가는 무시)
        fstate, freason = tg_live_status.feed_info(status)
        down = market and fresh and state == '9PAY_FEED_UNAVAILABLE' and fstate == 'UNAVAILABLE'
        if down:
            since = self.streaks.get('live_feed_since') or now_dt
            self.streaks['live_feed_since'] = since
            if (now_dt - since).total_seconds() >= tg_live_status.FEED_DOWN_SEC:
                n.raise_alert('live_feed', tg_live_status.fmt_feed_down(freason, now_dt), 'warn', 3600)
        else:
            self.streaks['live_feed_since'] = None
            if fstate == 'OK':
                n.clear_alert('live_feed', '9Pay 신호 피드가 정상으로 돌아왔습니다.')
        # 요약(거래일에만: 장중이거나 오늘 runner 가 점검을 기록했을 때)
        for slot, label in tg_live_status.due_slots(now_dt):
            ran_today = status.get('checked_at', '')[:10] == tg_live_status.parse_day(now_dt)
            if not (market or ran_today):
                continue
            today = tg_live_status.read_today(svc.base_dir, tg_live_status.parse_day(now_dt))
            text = tg_live_status.fmt_summary(label, status, today, now_dt, lambda c: self._name(c) or self._saved_name(c))
            n.notify('live_sum:%s:%s' % (tg_live_status.day_key(now_dt), slot), text, 'order', 'info')

    def _saved_name(self, code):
        """order_names.json(운영센터가 쌓는 종목명 사전). 못 찾으면 None - 알림에는 종목코드가 항상 들어간다."""
        try:
            import json
            with open(os.path.join(self.svc.base_dir, 'order_names.json'), encoding='utf-8') as f:
                data = json.load(f)
            value = data.get(code) if isinstance(data, dict) else None
            return value if isinstance(value, str) and value.strip() else None
        except (OSError, ValueError):
            return None

    # ---- 5-4) 거래량 급증 관찰 알림 (2026-10-18) ----
    def watch_volume_surge(self):
        """VM 장중 감시(volume_surge_live)의 실시간 감지 행을 관찰용 알림으로 보낸다. 새 스캔을 하지 않고, 30초 이상 간격으로 공개 응답만 읽는다.
        같은 거래일·종목·감지 시각은 알림 키가 같아 한 번만 나가고 재시작 뒤에도 같다. 주문·판단에는 영향이 없다."""
        svc, t = self.svc, self.svc.tstore
        now_dt = svc.now_dt()
        if not tg_volume_surge.in_session(now_dt):
            return
        now = svc.clock()
        last = t.kv_get('surge_last_fetch') or 0
        if now - last < tg_volume_surge.POLL_MIN_SEC:
            return
        t.kv_set('surge_last_fetch', now)
        fetch = getattr(svc, 'surge_fetch', None) or tg_volume_surge.fetch
        payload = fetch()                       # 실패는 tick 이 삼켜 다음 주기에 다시 시도한다
        for d in tg_volume_surge.live_detections(payload):
            d['name'] = d.get('name') or self._name(d['code']) or self._saved_name(d['code'])
            if svc.notifier.notify(tg_volume_surge.alert_key(d), tg_volume_surge.fmt_surge(d, now_dt), 'general', 'info'):
                tg_volume_surge.record(t, d, now)

    # ---- 6) 스캔 정상 완료 -> 종목 선정 + 일일 보고서 ----
    def watch_scan_done(self):
        svc, t = self.svc, self.svc.tstore
        last = t.kv_get('genlog_last_rowid') or 0
        now_dt = svc.now_dt()
        for r in tg_data.gen_log_since(svc.research_dir, last):
            gen_dt = F.to_dt(r['ts'])
            if r['ok'] and r['reason'] in ('OK', 'ALREADY_DONE') and r['scan_date'] and gen_dt and now_dt - gen_dt <= SCAN_FRESH:
                if (now_dt - gen_dt).total_seconds() < SCAN_SETTLE_SEC:
                    return          # 연구 작업이 상태 파일까지 쓰는 중 - 다음 확인에서 처리
                self.announce_scan(r['scan_date'], gen_dt)
            last = r['rid']
            t.kv_set('genlog_last_rowid', last)

    def announce_scan(self, scan_date, gen_dt):
        svc = self.svc
        cands = tg_data.candidates_for(svc.research_dir, scan_date)
        scanned = tg_data.scanned_count(svc.research_dir, scan_date)
        svc.notifier.notify('scandone:%s' % scan_date, F.fmt_scan_selected(scan_date, cands, scanned, gen_dt), 'general', 'info')
        svc.notifier.notify('daily:%s' % scan_date, F.fmt_daily(self.views.daily_data(scan_date)), 'general', 'info')

    # ---- 7) PC ----
    def watch_pc(self):
        svc = self.svc
        try:
            free = shutil.disk_usage(svc.base_dir).free
        except OSError:
            return
        if free < DISK_WARN_BYTES:
            level = 'critical' if free < DISK_CRIT_BYTES else 'warn'
            svc.notifier.raise_alert('pc_disk', F.fmt_alert('PC 디스크 여유 부족', 'PC 디스크 여유가 <b>%s</b>입니다. 로그·DB 기록이 실패할 수 있습니다.' % F.gb(free), level,
                                                          '불필요한 파일을 정리하세요', svc.now_dt()), level, 12 * 3600)
        elif free > DISK_OK_BYTES:
            svc.notifier.clear_alert('pc_disk', 'PC 디스크 여유가 %s로 회복되었습니다.' % F.gb(free))
