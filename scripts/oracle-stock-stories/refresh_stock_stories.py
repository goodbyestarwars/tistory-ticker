#!/usr/bin/env python3
"""Oracle-only bounded refresh; only validated public JS enters Git."""
import argparse
from datetime import date, datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from zoneinfo import ZoneInfo

KST = ZoneInfo('Asia/Seoul')
ANCHOR = date(2026, 11, 8)
DATA = ['data/stock-stories.js', 'data/stories']
INPUTS = DATA + ['data/company-profiles.js', 'scripts/build_stock_stories.py',
    'scripts/fetch_investor_flow.py', 'js/foreign-flow.js',
    'test/test_build_stock_stories.py', 'test/test_stock_stories.py',
    'scripts/cloud-vm/scheduled_job.py', 'scripts/cloud-vm/snapshot_io.py',
    'scripts/cloud-vm/market_clock.py', 'scripts/cloud-vm/market_calendar.py']


def emit(event, **values):
    print(json.dumps(dict(event=event, **values), ensure_ascii=False), flush=True)


def due(day):
    delta = (day - ANCHOR).days
    return delta >= 0 and delta % 14 == 0


def clean_env():
    return {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/home/ubuntu',
            'LANG': 'C.UTF-8', 'TZ': 'Asia/Seoul', 'GIT_TERMINAL_PROMPT': '0'}


def git(repo, *args, input=None):
    command = ['git', '-C', str(repo), *args]
    if os.geteuid() == 0:
        command = ['/usr/sbin/runuser', '-u', 'ubuntu', '--', *command]
    result = subprocess.run(command, input=input, capture_output=True,
                            env=clean_env(), timeout=120)
    if result.returncode:
        raise RuntimeError('git_' + args[0] + '_failed')
    return result.stdout


def parse_main(root):
    src = (root / DATA[0]).read_text(encoding='utf-8')
    manual = re.fullmatch(r'window\.STOCK_STORIES=(\{.*\});\nwindow\.STOCK_STORY_INDEX=(\[.*\]);\n?', src)
    if not manual:
        raise ValueError('invalid_main')
    return json.loads(manual[1]), json.loads(manual[2])


def validate(root, previous, today):
    manual, index = parse_main(root)
    old_manual, old_index = previous
    if manual != old_manual or len(manual) != 4:
        raise ValueError('manual_changed')
    if len(index) != len(set(index)) or any(not re.fullmatch('[0-9A-Za-z]{6}', c) for c in index):
        raise ValueError('invalid_index')
    if len(index) < len(old_index) * .85:
        raise ValueError('count_drop_over_15_percent')
    files = {p.stem for p in (root / DATA[1]).glob('*.js')}
    if files != set(index):
        raise ValueError('index_files_mismatch')
    dates = {}
    for code in index:
        src = (root / DATA[1] / (code + '.js')).read_text(encoding='utf-8')
        prefix = "(window.STOCK_STORIES=window.STOCK_STORIES||{})['%s']=" % code
        if not src.startswith(prefix) or not src.endswith(';\n'):
            raise ValueError('invalid_shard')
        entry = json.loads(src[len(prefix):-2])
        asof = date.fromisoformat(entry['asOf'])
        if entry.get('auto') is not True or entry.get('written') != today.isoformat():
            raise ValueError('invalid_entry_date')
        if not 0 <= (today - asof).days <= 10:
            raise ValueError('stale_entry')
        if not entry.get('name') or not entry.get('cards'):
            raise ValueError('empty_entry')
        dates[str(asof)] = dates.get(str(asof), 0) + 1
        for card in entry['cards']:
            if not all(card.get(k) for k in ('title', 'src', 'asOf', 'topics', 'detail')):
                raise ValueError('invalid_card')
            if card['asOf'] != entry['asOf'] or '키움' not in card['src']:
                raise ValueError('invalid_source')
            for row in card.get('rows', []):
                if not 0 <= row.get('w', -1) <= 100 or not 0 <= row.get('m', 0) <= 100:
                    raise ValueError('invalid_bar')
    if '005930' not in manual or '042660' not in manual:
        raise ValueError('missing_manual_example')
    if '005380' not in manual and '005380' not in index:
        raise ValueError('missing_hyundai')
    emit('validated', manual=len(manual), selected=len(index), previous=len(old_index), asOf=dates)
    return manual, index


def worker(root, runtime, codes):
    """Existing collector, with strict API/response guards and redacted logs."""
    sys.path.insert(0, str(root / 'scripts'))
    import build_stock_stories as bss
    from collections import Counter
    fif = bss.fif
    fif.REPO_ROOT = str(runtime)
    fif.load_dotenv()
    fif.REPO_ROOT = str(root)
    fif.load_dotenv = lambda: None
    real_call, real_token = fif.call_tr, fif.get_token
    counts = Counter()
    missing = Counter()
    allowed = {'ka10001': ('/api/dostk/stkinfo', None),
               'ka10014': ('/api/dostk/shsa', 'shrts_trnsn'),
               'ka10059': ('/api/dostk/stkinfo', 'stk_invsr_orgn')}
    def token(key, secret):
        try:
            return real_token(key, secret)
        except Exception:
            raise RuntimeError('authentication_failed') from None
    def call(token, api, path, body):
        if api not in allowed or path != allowed[api][0]:
            raise RuntimeError('api_not_allowed')
        try:
            response = real_call(token, api, path, body)
            if not isinstance(response, dict) or str(response.get('return_code', 0)) != '0':
                raise ValueError()
            field = allowed[api][1]
            if field and not isinstance(response.get(field), list):
                raise ValueError()
            if api == 'ka10001' and not response.get('stk_nm'):
                raise ValueError()
        except Exception:
            counts['failed'] += 1
            raise RuntimeError('read_request_failed') from None
        counts[api] += 1
        if field and not response[field]:
            missing[api] += 1
        return response
    def log(message):
        if re.fullmatch(r'\d+/\d+ 수집, 실패 \d+', message):
            emit('progress', message=message)
    fif.get_token, fif.call_tr, fif.log = token, call, log
    original_write = bss.write_output
    def write(manual, auto, index, partial):
        total = len(bss.universe(sys.argv[1:]))
        emit('collection', target=total, completed=counts['ka10059'], failed=counts['failed'],
             selected=len(auto), notSelected=total - len(auto) - counts['failed'],
             notSelectedReason='selection_threshold_or_missing_data', emptyResponses=dict(missing))
        if counts['failed'] or counts['ka10059'] != total:
            raise RuntimeError('incomplete_collection_preserve_previous')
        original_write(manual, auto, index, partial)
    bss.write_output = write
    sys.argv = ['build_stock_stories.py', '--codes', codes] if codes else ['build_stock_stories.py', '--all']
    try:
        bss.main()
    finally:
        for key in ('KIWOOM_APPKEY', 'KIWOOM_SECRETKEY'):
            os.environ.pop(key, None)


def run_tests(root, python):
    for pattern in ('test_build_stock_stories.py', 'test_stock_stories.py'):
        result = subprocess.run([python, '-m', 'unittest', 'discover', '-s', 'test', '-p', pattern, '-q'],
            cwd=root, env=clean_env(), capture_output=True, timeout=120)
        if result.returncode:
            raise RuntimeError('unit_test_failed_' + pattern)
    # Parse every actual public JS file with the browser global contract.
    script = "const fs=require('fs'),vm=require('vm');let w={};const run=p=>vm.runInNewContext(fs.readFileSync(p,'utf8'),{window:w});run('data/stock-stories.js');for(const c of w.STOCK_STORY_INDEX)run('data/stories/'+c+'.js');console.log(Object.keys(w.STOCK_STORIES).length)"
    result = subprocess.run(['node', '-e', script], cwd=root, env=clean_env(),
                            capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError('javascript_validation_failed')
    emit('tests_passed', suites=2, javascriptEntries=int(result.stdout))


def health():
    started = time.monotonic()
    try:
        with urllib.request.urlopen('https://goodbyestar.cloud/health', timeout=10) as response:
            ok = response.status == 200
    except Exception:
        ok = False
    emit('api_health', ok=ok, latencySec=round(time.monotonic() - started, 3))
    return ok


def save_verified(state, root, base, today):
    """Keep public output only, so a push race does not waste a full collection."""
    from snapshot_io import atomic_json
    folder = state / 'verified-public-data'
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(mode=0o700)
    shutil.copy2(root / DATA[0], folder / 'stock-stories.js')
    shutil.copytree(root / DATA[1], folder / 'stories')
    hashes = {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in folder.rglob('*.js')}
    atomic_json(folder / 'manifest.json', dict(base=base, date=str(today), hashes=hashes))


def restore_verified(state, root, repo, base, today):
    folder = state / 'verified-public-data'
    manifest = json.loads((folder / 'manifest.json').read_text())
    collected = date.fromisoformat(manifest['date'])
    if not 0 <= (today - collected).days <= 1:
        raise RuntimeError('verified_output_too_old')
    sensitive = DATA + ['data/company-profiles.js', 'scripts/build_stock_stories.py', 'scripts/fetch_investor_flow.py']
    if git(repo, 'diff', '--name-only', manifest['base'], base, '--', *sensitive).strip():
        raise RuntimeError('collection_inputs_changed')
    actual = {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in folder.rglob('*.js')}
    if actual != manifest['hashes']:
        raise RuntimeError('verified_output_hash_changed')
    shutil.copy2(folder / 'stock-stories.js', root / DATA[0])
    shutil.rmtree(root / DATA[1])
    shutil.copytree(folder / 'stories', root / DATA[1])
    emit('verified_output_restored', collectionDate=str(collected))
    return collected


def bounded_worker(root, runtime, python, codes, timeout):
    sys.path.insert(0, str(root / 'scripts/cloud-vm'))
    from scheduled_job import stop_group
    import pwd
    account = pwd.getpwnam('goodbyestarwars')
    for folder, dirs, files in os.walk(root):
        os.chown(folder, account.pw_uid, account.pw_gid)
        for name in files:
            os.chown(Path(folder) / name, account.pw_uid, account.pw_gid)
    command = ['/usr/sbin/runuser', '-u', 'goodbyestarwars', '--', python, __file__,
               '--worker', str(root), '--runtime', str(runtime)]
    if codes:
        command += ['--codes', codes]
    env = clean_env()
    env['HOME'] = '/home/goodbyestarwars'
    process = subprocess.Popen(command, env=env, start_new_session=True)
    started = time.monotonic()
    try:
        while True:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise subprocess.TimeoutExpired(command, timeout)
            try:
                status = process.wait(timeout=min(60, remaining))
                if status:
                    raise RuntimeError('collector_failed')
                return
            except subprocess.TimeoutExpired:
                if not health():
                    raise RuntimeError('api_unhealthy')
    finally:
        if process.poll() is None:
            stop_group(process, 10)


def publish(repo, root, runtime, base):
    sys.path.insert(0, str(root / 'scripts/cloud-vm'))
    from scheduled_job import try_lock
    with open(runtime / '.deploy_check.lock', 'a+') as lock:
        if not try_lock(lock):
            raise RuntimeError('deploy_busy')
        git(repo, 'fetch', '-q', 'origin', 'master')
        if git(repo, 'rev-parse', 'origin/master').decode().strip() != base:
            raise RuntimeError('remote_changed_rerun_required')
        if git(repo, 'rev-parse', 'HEAD').decode().strip() != base:
            raise RuntimeError('checkout_changed')
        if git(repo, 'status', '--porcelain', '--untracked-files=no').strip():
            raise RuntimeError('checkout_dirty')
        # A private alternate index leaves the checkout and its index untouched.
        index = root / 'publish.index'
        env = clean_env()
        env['GIT_INDEX_FILE'] = str(index)
        def indexed(*args, data=None):
            result = subprocess.run(['git', '--git-dir=' + str(repo / '.git'), *args],
                env=env, input=data, capture_output=True, timeout=120)
            if result.returncode:
                raise RuntimeError('git_object_creation_failed')
            return result.stdout.decode().strip()
        indexed('read-tree', base)
        old = git(repo, 'ls-tree', '-r', '--name-only', base, '--', *DATA).decode().splitlines()
        for path in old:
            indexed('update-index', '--force-remove', '--', path)
        for path in [root / DATA[0], *sorted((root / DATA[1]).glob('*.js'))]:
            name = path.relative_to(root).as_posix()
            blob = indexed('hash-object', '-w', '--stdin', data=path.read_bytes())
            indexed('update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + name)
        tree = indexed('write-tree')
        # Git object ownership must stay with the existing repository owner.
        shutil.chown(index, user='ubuntu', group='ubuntu')
        for directory, _, files in os.walk(repo / '.git/objects'):
            if Path(directory).stat().st_uid == 0:
                shutil.chown(directory, user='ubuntu', group='ubuntu')
            for name in files:
                path = Path(directory) / name
                if path.stat().st_uid == 0:
                    shutil.chown(path, user='ubuntu', group='ubuntu')
        if tree == git(repo, 'rev-parse', base + '^{tree}').decode().strip():
            emit('no_data_change', sha=base)
            return base
        commit = git(repo, 'commit-tree', tree, '-p', base, '-m',
                     'Refresh verified stock stories (Oracle ' + datetime.now(KST).date().isoformat() + ')').decode().strip()
        changed = git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit).decode().splitlines()
        if not changed or any(p != DATA[0] and not p.startswith('data/stories/') for p in changed):
            raise RuntimeError('publish_path_violation')
        git(repo, 'push', 'origin', commit + ':refs/heads/master')
        emit('pushed', sha=commit, rollback=base, files=len(changed))
        return commit


def pages(root, index, timeout=900):
    paths = [DATA[0]] + ['data/stories/' + c + '.js' for c in ('005380', '068270') if c in index]
    expires = time.monotonic() + timeout
    pending = list(paths)
    while pending:
        for path in list(pending):
            try:
                url = 'https://goodbyestarwars.github.io/tistory-ticker/' + path
                request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
                with urllib.request.urlopen(request, timeout=15) as response:
                    actual = response.read()
                if hashlib.sha256(actual).digest() == hashlib.sha256((root / path).read_bytes()).digest():
                    pending.remove(path)
            except Exception:
                pass
        if not pending:
            emit('pages_verified', files=len(paths))
            return True
        if time.monotonic() >= expires:
            emit('pages_pending', files=len(pending))
            return False
        time.sleep(30)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, default=Path('/home/ubuntu/tistory-ticker'))
    parser.add_argument('--runtime', type=Path, default=Path('/home/goodbyestarwars/kiwoom-api'))
    parser.add_argument('--state', type=Path, default=Path('/var/lib/ninepay-stock-stories'))
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--smoke', action='store_true')
    parser.add_argument('--resume-verified', action='store_true')
    parser.add_argument('--worker', type=Path)
    parser.add_argument('--codes', default='')
    parser.add_argument('--worker-timeout', type=int, default=7200)
    args = parser.parse_args()
    os.umask(0o077)
    if args.worker:
        worker(args.worker, args.runtime, args.codes)
        return
    today = datetime.now(KST).date()
    if not args.force and not due(today):
        emit('not_due', date=str(today))
        return
    sys.path.insert(0, str(args.runtime / 'scripts/cloud-vm'))
    from scheduled_job import try_lock
    from snapshot_io import atomic_json
    args.state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.geteuid() == 0:
        shutil.chown(args.state, user='goodbyestarwars', group='goodbyestarwars')
    with open(args.state / 'refresh.lock', 'a+') as own, open(args.runtime / '.scan_serial.lock', 'a+') as scan:
        if not try_lock(own) or not try_lock(scan):
            emit('busy_skip')
            return
        if args.check:
            emit('locks_available')
            return
        git(args.repo, 'fetch', '-q', 'origin', 'master')
        base = git(args.repo, 'rev-parse', 'origin/master').decode().strip()
        if git(args.repo, 'rev-parse', 'HEAD').decode().strip() != base or git(args.repo, 'status', '--porcelain', '--untracked-files=no').strip():
            raise RuntimeError('checkout_not_clean_current')
        archive = git(args.repo, 'archive', base, '--', *INPUTS)
        with tempfile.TemporaryDirectory(prefix='refresh-', dir=args.state) as temporary:
            root = Path(temporary)
            with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
                bundle.extractall(root, filter='data')
            before = parse_main(root)
            python = str(args.runtime / 'venv/bin/python')
            if not health():
                raise RuntimeError('api_unhealthy_before_collection')
            if args.resume_verified:
                today = restore_verified(args.state, root, args.repo, base, today)
            else:
                bounded_worker(root, args.runtime, python,
                    '005930,042660,005380,068270' if args.smoke else '', args.worker_timeout)
            if args.smoke:
                emit('smoke_passed')
                return
            _, index = validate(root, before, today)
            run_tests(root, python)
            save_verified(args.state, root, base, today)
            if not health():
                raise RuntimeError('api_unhealthy_before_publish')
            sha = publish(args.repo, root, args.runtime, base)
            atomic_json(args.state / 'last-publish.json', dict(sha=sha, rollback=base, selected=len(index), at=datetime.now(KST).isoformat()))
            published = pages(root, index)
            atomic_json(args.state / 'last-result.json', dict(sha=sha, rollback=base, selected=len(index), pages=published, at=datetime.now(KST).isoformat()))
            emit('completed', sha=sha, selected=len(index), pages=published)


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        # Never print provider response bodies, environments or raw exception text.
        emit('failed', reason=str(error) if type(error) in (RuntimeError, ValueError) and re.fullmatch('[a-z_]+', str(error)) else type(error).__name__)
        sys.exit(1)
