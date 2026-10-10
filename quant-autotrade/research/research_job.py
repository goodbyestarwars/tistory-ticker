# -*- coding: utf-8 -*-
"""월~금 자동 실행용 연구 후보 생성 작업 (2026-10-11). 읽기 전용 - 주문 코드가 없고 키움 조회(일봉)만 쓴다.

실행 한 번의 흐름
 1) 열린 모의 포지션·후보를 일봉으로 갱신한다(만료 → 모의 진입 → 모의 청산).
 2) 감시 구간 안이면 10분 간격으로 `GET /pattern-scan` 을 확인한다(고정 시각 조회가 아니라 candidate_gen.check_scan 의 완료 판정).
    스캔이 확정되면 후보를 한 번만 만들고 종료한다. 같은 스캔 결과(scannedAt)로는 다시 만들지 않는다.
 3) 상태를 research/status.json 에 남긴다(웹의 로컬 봇 API `/api/research` 가 읽는다).

감시 구간(KST)
 - 평일(월~금) 20:15 시작 → 다음 날 08:15 종료. 금요일 밤 시작분은 토요일 08:15까지 이어서 확인한다(자정을 넘겨 완료돼도 처리).
 - 토·일요일 저녁에는 새 거래일 스캔을 기다리지 않는다. 작업 스케줄러가 놓친 실행을 늦게 시작한 경우(구간 밖)에는 한 번만 확인하고 끝낸다
   (오래된 스캔은 candidate_gen 이 거절하므로 지난 후보를 소급 생성하지 않는다).

저장 위치: AUTOTRADER_DIR(기본 ~/autotrader)/research/ - research.db, status.json, research.log(순환), research.lock.
키는 AUTOTRADER_DIR/.env 에서만 읽고 어디에도 기록하지 않는다. 연구 데이터 폴더 총 용량 상한은 5GB(DISK_LIMIT_BYTES)이며 넘으면 후보 생성을 멈춘다.
"""
import ctypes
import json
import logging
import logging.handlers
import os
import sys
import time
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
for _p in (HERE, os.path.join(REPO, 'quant-autotrade', 'backtest'), os.path.join(REPO, 'scripts', 'analysis'), os.path.join(REPO, 'scripts', 'cloud-vm')):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import candidate_gen as cg  # noqa: E402

AUTOTRADER_DIR = os.environ.get('AUTOTRADER_DIR') or os.path.join(os.path.expanduser('~'), 'autotrader')
KST = cg.KST
START_HM = (20, 15)
END_HM = (8, 15)
POLL_SEC = 600
DISK_LIMIT_BYTES = 5 * 1024 ** 3
LOG_MAX_BYTES, LOG_BACKUPS = 1_000_000, 5
LOCK_STALE_SEC = 20 * 3600


# ---- 실행 구간 -------------------------------------------------------------
def session_mode(now):
    """('poll', 종료시각) 또는 ('once', None). 평일 20:15~다음 날 08:15 안이면 감시(poll), 밖이면 한 번만 확인(once)."""
    if now.weekday() < 5 and (now.hour, now.minute) >= START_HM:
        end = (now + timedelta(days=1)).replace(hour=END_HM[0], minute=END_HM[1], second=0, microsecond=0)
        return 'poll', end
    prev = now - timedelta(days=1)
    if (now.hour, now.minute) < END_HM and prev.weekday() < 5:
        return 'poll', now.replace(hour=END_HM[0], minute=END_HM[1], second=0, microsecond=0)
    return 'once', None


def next_start(now):
    """다음 정기 실행 예정 시각(평일 20:15)."""
    d = now.replace(hour=START_HM[0], minute=START_HM[1], second=0, microsecond=0)
    if now >= d:
        d += timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


# ---- 잠금·용량·상태 ---------------------------------------------------------
def pid_alive(pid):
    if pid <= 0:
        return False
    if os.name == 'nt':
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def acquire_lock(path, now_epoch=None):
    """이미 살아 있는 프로세스가 잠금을 쥐고 있으면 False. 프로세스가 죽었거나 잠금이 오래됐으면 빼앗는다."""
    now_epoch = time.time() if now_epoch is None else now_epoch
    if os.path.exists(path):
        try:
            pid = int(open(path).read().strip() or 0)
        except (OSError, ValueError):
            pid = 0
        if pid and pid != os.getpid() and pid_alive(pid) and now_epoch - os.path.getmtime(path) < LOCK_STALE_SEC:
            return False
    with open(path, 'w') as f:
        f.write(str(os.getpid()))
    return True


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def write_status(out_dir, status):
    path = os.path.join(out_dir, 'status.json')
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(status, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def load_status(out_dir):
    try:
        with open(os.path.join(out_dir, 'status.json'), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def missing_weekdays(conn, now, days=14):
    """최근 days일 중 후보 생성이 한 번도 성공하지 않은 평일(휴장일일 수 있음 - 참고용). 기록이 시작된 날 이후만 본다."""
    first = conn.execute('SELECT MIN(substr(ts,1,10)) FROM gen_log').fetchone()[0]
    if not first:
        return []
    ok_days = {r[0] for r in conn.execute("SELECT DISTINCT scan_date FROM gen_log WHERE ok=1")}
    out = []
    for k in range(1, days + 1):
        d = (now - timedelta(days=k)).date()
        s = d.strftime('%Y-%m-%d')
        if d.weekday() < 5 and s >= first and s not in ok_days:
            out.append(s)
    return sorted(out)


def prune(conn):
    conn.execute("DELETE FROM scan_seen WHERE first_seen < ?", (time.time() - 90 * 86400,))
    conn.execute("DELETE FROM gen_log WHERE ts < ?", ((datetime.now(KST) - timedelta(days=365)).isoformat(timespec='seconds'),))
    conn.commit()


# ---- 일봉 조회기 ------------------------------------------------------------
def _load_env(path):
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8-sig') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def make_daily_source():
    """키움 일봉 조회기(코드별 캐시). 키는 .env 에서 읽고 값은 로그에 남기지 않는다. 주문 함수는 호출하지 않는다."""
    bot_dir = os.environ.get('AUTOTRADER_BOT_DIR') or AUTOTRADER_DIR
    sys.path.insert(0, bot_dir)
    _load_env(os.path.join(bot_dir, '.env'))
    from kiwoom import KiwoomClient
    client = KiwoomClient(os.environ.get('KIWOOM_APPKEY', ''), os.environ.get('KIWOOM_SECRETKEY', ''))
    cache = {}

    def get_daily(code):
        if code not in cache:
            try:
                cache[code] = client.daily(code)
            except Exception as exc:  # 한 종목 실패가 전체를 막지 않게 한다
                logging.getLogger('research').warning('일봉 조회 실패 %s: %s', code, exc)
                cache[code] = []
        return cache[code]
    return get_daily


# ---- 한 번의 실행 ------------------------------------------------------------
def run_cycle(conn, fetch_scan, get_daily, now_fn, sleep_fn, out_dir=None, poll_sec=POLL_SEC, mode=None,
              disk_ok=lambda: True):
    """모의 갱신 → (감시 구간이면) 스캔 확정까지 poll_sec 간격 확인 → 후보 1회 생성. 반환 (결과, 신규 후보 수)."""
    log = logging.getLogger('research')
    now = now_fn()
    run_mode, end = session_mode(now) if mode is None else (mode, None)
    if run_mode == 'poll' and end is None:
        end = session_mode(now)[1]
    status = load_status(out_dir) if out_dir else {}
    errors = list(status.get('errors') or [])[-4:]

    def save(state, **extra):
        if not out_dir:
            return
        t = now_fn()
        today = t.strftime('%Y-%m-%d')
        cand_today = conn.execute("SELECT COUNT(*) FROM candidates WHERE substr(created_at,1,10)=?", (today,)).fetchone()[0]
        status.update({'updatedAt': t.isoformat(timespec='seconds'), 'heartbeatAt': t.isoformat(timespec='seconds'), 'pid': os.getpid(),
                       'runner': state, 'mode': run_mode, 'candidatesToday': cand_today,
                       'nextRunAt': next_start(t).isoformat(timespec='minutes'), 'errors': errors[-5:],
                       'missingWeekdays': missing_weekdays(conn, t), 'diskLimitBytes': DISK_LIMIT_BYTES})
        status.update(extra)
        write_status(out_dir, status)

    save('starting', startedAt=now.isoformat(timespec='seconds'))
    today = now.strftime('%Y-%m-%d')
    try:
        expired = cg.expire_old(conn, today)
        entered = cg.paper_enter(conn, get_daily, today)
        settled = cg.paper_settle(conn, get_daily, today)
        log.info('모의 갱신: 만료 %d, 진입 %d, 청산 %d', expired, entered, settled)
        status['lastPaperUpdateAt'] = now_fn().isoformat(timespec='seconds')
    except Exception as exc:
        errors.append('%s paper: %s' % (now_fn().isoformat(timespec='minutes'), exc))
        log.exception('모의 갱신 실패')
    result = ('NONE', 0)
    while True:
        t = now_fn()
        if not disk_ok():
            ok, reason, created = False, 'DISK_LIMIT', 0
            errors.append('%s 연구 데이터 폴더가 5GB 상한에 도달해 후보 생성을 멈춤' % t.isoformat(timespec='minutes'))
        else:
            try:
                payload = fetch_scan()
                ok, reason, created = cg.generate(conn, payload, t, now_epoch=t.timestamp())
            except Exception as exc:
                ok, reason, created = False, 'FETCH_ERROR', 0
                errors.append('%s fetch: %s' % (t.isoformat(timespec='minutes'), exc))
        log.info('후보 확인: ok=%s reason=%s 신규=%d', ok, reason, created)
        result = ('OK' if ok else reason, created)
        if ok:
            save('done', lastSuccessAt=t.isoformat(timespec='seconds'), lastScanConfirmedAt=t.isoformat(timespec='seconds'),
                 lastGen={'ok': True, 'reason': reason, 'created': created, 'at': t.isoformat(timespec='seconds')})
            break
        if run_mode == 'once' or t >= end:
            save('no_scan' if reason != 'DISK_LIMIT' else 'disk_limit', lastGen={'ok': False, 'reason': reason, 'created': 0, 'at': t.isoformat(timespec='seconds')})
            log.info('종료: 후보 확정 없이 끝남(%s)', reason)
            break
        save('waiting', lastGen={'ok': False, 'reason': reason, 'created': 0, 'at': t.isoformat(timespec='seconds')})
        sleep_fn(poll_sec)
    log.info('요약(모의 성과): %s', cg.summary(conn))
    return result


def main():
    out_dir = os.path.join(AUTOTRADER_DIR, 'research')
    os.makedirs(out_dir, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(os.path.join(out_dir, 'research.log'), maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUPS, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
    logger = logging.getLogger('research')
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    lock = os.path.join(out_dir, 'research.lock')
    if not acquire_lock(lock):
        logger.info('이미 실행 중인 프로세스가 있어 종료')
        return
    try:
        conn = cg.connect(os.path.join(out_dir, 'research.db'))
        prune(conn)
        run_cycle(conn, cg.fetch_scan, make_daily_source(), lambda: datetime.now(KST), time.sleep, out_dir=out_dir,
                  mode='once' if '--once' in sys.argv else None, disk_ok=lambda: dir_size(out_dir) < DISK_LIMIT_BYTES)
    except Exception:
        logger.exception('실행 실패')
    finally:
        try:
            os.remove(lock)
        except OSError:
            pass


if __name__ == '__main__':
    main()
