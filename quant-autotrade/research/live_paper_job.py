# -*- coding: utf-8 -*-
"""장중 페이퍼 트레이딩 실행기 (2026-10-12). 실주문 없음 - 키움 **조회**(1분봉·일봉)만 쓴다.

거래일 08:50~15:50 사이에 30초 간격으로 live_paper.Engine.tick 을 돌리고, 15:45 이후 확정 일봉으로 end_of_day 를 한 번 실행한다.
프로세스가 중간에 죽거나 PC가 재시작돼도 모든 상태가 research.db 에 있어 다시 켜면 이어서 동작한다(중복 매수 없음, 단절 구간은 채우지 않음).

실행: python live_paper_job.py            (정상: 거래일 장중 루프)
      python live_paper_job.py --status   (DB 요약만 출력)
저장: AUTOTRADER_DIR/research/ - research.db(lp_* 테이블), livepaper.json(웹 연동용 상태), live_paper.log(순환), live_paper.lock
"""
import json
import logging
import logging.handlers
import os
import sys
import time
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import candidate_gen as cg  # noqa: E402
import krx_calendar  # noqa: E402
import live_paper as lp  # noqa: E402
import research_job as rj  # noqa: E402

KST = lp.KST
POLL_SEC = 30
START_HM = (8, 50)
END_HM = (15, 50)
SKEW_NOTE = '시세는 키움 1분봉 종가(마지막 관측가)이며 호가는 쓰지 않습니다'


class KiwoomQuotes:
    """키움 1분봉 조회로 마지막 관측가를 얻는다(읽기 전용). 시각 필드를 못 읽으면 ts=None 으로 돌려주어 엔진이 '시세 없음'으로 처리한다."""
    def __init__(self, client):
        self.client = client

    def quote(self, code):
        price, stamp = self.client.last_price(code)
        ts = None
        if stamp:
            try:
                ts = datetime.strptime(stamp, '%Y-%m-%d %H:%M').replace(tzinfo=KST)
            except ValueError:
                ts = None
        return {'price': price, 'ts': ts, 'source': 'kiwoom_1m_close'}


def build_status(eng, now, state, cands=None, extra=None):
    conn = eng.conn
    pos = []
    for r in conn.execute("SELECT strategy_id, code, name, scanner, scan_date, qty, entry_ts, entry_price, last_price, last_ts, trail_price, stop_price, status, signal_date, "
                          "signal_reason, hold_days, max_hold, quality FROM lp_positions WHERE status IN ('OPEN','PENDING_EXIT') ORDER BY entry_ts DESC"):
        d = dict(zip(('strategyId', 'code', 'name', 'scanner', 'scanDate', 'qty', 'entryTs', 'entryPrice', 'lastPrice', 'lastTs', 'trailPrice', 'stopPrice', 'status',
                      'signalDate', 'signalReason', 'holdDays', 'maxHold', 'quality'), r))
        d['ret'] = (d['lastPrice'] / d['entryPrice'] - 1) if d['lastPrice'] and d['entryPrice'] else None
        pos.append(d)
    trades = [dict(zip(('strategyId', 'code', 'name', 'scanner', 'entryTs', 'entryPrice', 'exitTs', 'exitPrice', 'exitReason', 'netRet', 'pnl', 'fee', 'qty', 'quality'), r))
              for r in conn.execute("SELECT strategy_id, code, name, scanner, entry_ts, entry_price, exit_ts, exit_price, exit_reason, net_ret, pnl_krw, fee_krw, qty, quality "
                                    "FROM lp_positions WHERE status='CLOSED' ORDER BY exit_ts DESC LIMIT 60")]
    equity = {}
    for sid in eng.cfg.strategies:
        equity[sid] = [{'date': r[0], 'equity': r[1]} for r in conn.execute('SELECT date, equity FROM lp_equity WHERE strategy_id=? ORDER BY date DESC LIMIT 250', (sid,))][::-1]
    sel = [dict(zip(('scanDate', 'scanner', 'code', 'name', 'rankNorm', 'decision', 'reason'), r)) for r in conn.execute(
        'SELECT scan_date, scanner, code, name, rank_norm, decision, reason FROM lp_selection ORDER BY scan_date DESC, rank_in_scanner LIMIT 120')]
    dec = {}
    for scan_date, sid, d, n in conn.execute('SELECT scan_date, strategy_id, decision, COUNT(*) FROM lp_decisions GROUP BY 1,2,3 ORDER BY scan_date DESC LIMIT 60'):
        dec.setdefault(scan_date, {}).setdefault(sid, {})[d] = n
    events = [dict(zip(('ts', 'kind', 'strategyId', 'code', 'level'), r)) for r in conn.execute('SELECT ts, kind, strategy_id, code, level FROM lp_events ORDER BY id DESC LIMIT 30')]
    st = {'simulationType': lp.SIM_TYPE, 'generatedAt': now.isoformat(timespec='seconds'), 'dataDate': now.strftime('%Y-%m-%d'), 'engine': state, 'halted': eng.halted,
          'feedOk': eng.feed_ok, 'lastQuoteAt': eng._last_ok.isoformat(timespec='seconds') if eng._last_ok else None, 'pid': os.getpid(),
          'liveSellActive': lp.live_sell_active(), 'orderApi': 'none', 'note': SKEW_NOTE, 'assumptions': eng.cfg.assumptions(),
          'accounts': eng.summary(), 'positions': pos, 'trades': trades, 'equityCurves': equity, 'selection': sel, 'decisions': dec, 'events': events}
    st.update(extra or {})
    return st


def write_json(out_dir, name, data, retries=8, delay=0.25):
    path = os.path.join(out_dir, name)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    for _ in range(retries):
        try:
            os.replace(tmp, path)
            return True
        except PermissionError:
            time.sleep(delay)
    return False


def run(eng, out_dir, now_fn, sleep_fn, poll_sec=POLL_SEC):
    """하루치 실행 루프. 테스트에서는 now_fn/sleep_fn 을 주입한다. 반환: 종료 사유."""
    log = logging.getLogger('livepaper')
    now = now_fn()
    halted = eng.start(now)
    if halted:
        log.warning('시작하지 않음: %s', halted)
        if out_dir:
            write_json(out_dir, 'livepaper.json', build_status(eng, now, 'halted'))
        return halted
    cands = eng.load_candidates(now)
    log.info('후보 %d건 선정', len(cands))
    eod_done = bool(eng.conn.execute("SELECT 1 FROM lp_events WHERE dedupe_key=?", ('eod:%s' % now.strftime('%Y-%m-%d'),)).fetchone())
    while True:
        now = now_fn()
        hm = (now.hour, now.minute)
        if hm >= END_HM:
            break
        try:
            if eng.cfg.session_open <= hm <= eng.cfg.session_close:
                if not cands:
                    cands = eng.load_candidates(now)
                res = eng.tick(now, cands)
                if res['bought'] or res['sold']:
                    log.info('tick: 매수 %d 매도 %d', res['bought'], res['sold'])
            if hm >= eng.cfg.eod_after and not eod_done:
                eng.end_of_day(now)
                eod_done = True
                log.info('장 마감 후 갱신 완료')
        except Exception:
            log.exception('주기 처리 실패(다음 주기에 다시 시도)')
        if out_dir:
            try:
                write_json(out_dir, 'livepaper.json', build_status(eng, now, 'running'))
            except Exception:
                log.exception('상태 기록 실패')
        sleep_fn(poll_sec)
    if out_dir:
        write_json(out_dir, 'livepaper.json', build_status(eng, now_fn(), 'done'))
    return 'done'


def main():
    out_dir = os.path.join(rj.AUTOTRADER_DIR, 'research')
    os.makedirs(out_dir, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(os.path.join(out_dir, 'live_paper.log'), maxBytes=rj.LOG_MAX_BYTES, backupCount=rj.LOG_BACKUPS, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
    log = logging.getLogger('livepaper')
    log.setLevel(logging.INFO)
    log.addHandler(handler)
    lock = os.path.join(out_dir, 'live_paper.lock')
    if not rj.acquire_lock(lock):
        log.info('이미 실행 중인 프로세스가 있어 종료')
        return
    try:
        if rj.dir_size(out_dir) >= rj.DISK_LIMIT_BYTES:
            log.error('연구 데이터 폴더가 5GB 상한에 도달해 시작하지 않음')
            return
        # .env 의 LIVE_SELL 도 읽어 실주문 스위치가 켜져 있으면 엔진이 스스로 멈추게 한다.
        bot_dir = os.environ.get('AUTOTRADER_BOT_DIR') or rj.AUTOTRADER_DIR
        rj._load_env(os.path.join(bot_dir, '.env'))
        sys.path.insert(0, bot_dir)
        from kiwoom import KiwoomClient
        client = KiwoomClient(os.environ.get('KIWOOM_APPKEY', ''), os.environ.get('KIWOOM_SECRETKEY', ''))
        conn = cg.connect(os.path.join(out_dir, 'research.db'))
        eng = lp.Engine(conn, KiwoomQuotes(client), rj.make_daily_source())
        if '--status' in sys.argv:
            print(json.dumps(eng.summary(), ensure_ascii=False, indent=1))
            return
        reason = run(eng, out_dir, lambda: datetime.now(KST), time.sleep)
        log.info('종료: %s', reason)
    except Exception:
        log.exception('실행 실패')
    finally:
        try:
            os.remove(lock)
        except OSError:
            pass


if __name__ == '__main__':
    main()
