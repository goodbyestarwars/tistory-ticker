"""Weekly backup of the public Tistory guestbook (Tistory's own backup excludes it).

- Reads the public /guestbook pages only (no login, secret posts are not visible and not backed up).
- Always downloads every page, then merges by Tistory comment id: new entries are added, existing
  entries are never overwritten or deleted. A changed or vanished entry keeps its older text in
  `revisions` / `missingSince`.
- Stores one private JSON file outside the git work tree (never served by the API).
- Standard library only; one short run per week, no new long-lived process.
"""
import argparse
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

import snapshot_io

KST = timezone(timedelta(hours=9))
BASE_URL = os.environ.get('GUESTBOOK_BACKUP_URL') or 'https://ghlee.tistory.com/guestbook'
DATA_DIR = Path(os.environ.get('GUESTBOOK_BACKUP_DIR') or (Path.home() / 'guestbook-backup'))
FILE_NAME = 'guestbook.json'
MAX_PAGES = 60
PAGE_DELAY_SEC = 1.0
VOID_TAGS = {'br', 'img', 'hr', 'input', 'meta', 'link', 'wbr'}
STOCK_TAG = re.compile(r'^\s*\[(\d{6}|US:[A-Z][A-Z0-9.\-^=]{0,11})\]')
CONTENT_KEYS = ('kind', 'name', 'date', 'body', 'replies')


class GuestbookParser(HTMLParser):
    """Collects top-level entries (li.discussion-item) and their replies (li.discussion-reply)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.entries = []
        self.li_stack = []
        self.cur_entry = None
        self.cur_reply = None
        self.ctx = None      # 'name' | 'date' | 'body' | 'control'
        self.ctx_tag = None
        self.depth = 0
        self.in_a = 0
        self.parts = []

    @staticmethod
    def _classes(attrs):
        return (dict(attrs).get('class') or '').split()

    def _target(self):
        return self.cur_reply if self.cur_reply is not None else self.cur_entry

    def handle_starttag(self, tag, attrs):
        classes = self._classes(attrs)
        if self.ctx:
            if tag == 'br' and self.ctx == 'body':
                self.parts.append('\n')
            if tag == 'a':
                self.in_a += 1
            if tag not in VOID_TAGS:
                self.depth += 1
            return
        if tag == 'li':
            attrs_d = dict(attrs)
            if 'discussion-item' in classes and 'data-discussion-entry' in attrs_d:
                self.cur_entry = {'id': attrs_d.get('id') or '', 'classes': [c for c in classes if c != 'discussion-item'],
                                  'name': '', 'date': '', 'body': '', 'replies': []}
                self.li_stack.append('entry')
            elif 'discussion-reply' in classes and self.cur_entry is not None:
                self.cur_reply = {'name': '', 'date': '', 'body': ''}
                self.li_stack.append('reply')
            else:
                self.li_stack.append('other')
            return
        if self._target() is None:
            return
        if tag == 'span' and 'name' in classes:
            self._begin('name', tag)
        elif tag == 'span' and 'date' in classes:
            self._begin('date', tag)
        elif tag == 'span' and 'control' in classes:
            self._begin('control', tag)
        elif tag == 'p' and 'discussion-item-body' in classes:
            self._begin('body', tag)

    def _begin(self, ctx, tag):
        self.ctx, self.ctx_tag, self.depth, self.in_a, self.parts = ctx, tag, 1, 0, []

    def handle_endtag(self, tag):
        if self.ctx:
            if tag == 'a' and self.in_a:
                self.in_a -= 1
            if tag not in VOID_TAGS:
                self.depth -= 1
            if self.depth <= 0:
                self._finish_ctx()
            return
        if tag == 'li' and self.li_stack:
            kind = self.li_stack.pop()
            if kind == 'reply' and self.cur_reply is not None:
                self.cur_entry['replies'].append(self.cur_reply)
                self.cur_reply = None
            elif kind == 'entry' and self.cur_entry is not None:
                self.entries.append(self.cur_entry)
                self.cur_entry = None

    def _finish_ctx(self):
        text = ''.join(self.parts)
        target = self._target()
        if target is not None and self.ctx in ('name', 'date', 'body'):
            if self.ctx == 'body':
                target['body'] = '\n'.join(line.rstrip() for line in text.strip().splitlines())
            else:
                target[self.ctx] = ' '.join(text.split())
        self.ctx = self.ctx_tag = None
        self.depth = self.in_a = 0
        self.parts = []

    def handle_data(self, data):
        if not self.ctx or self.ctx == 'control':
            return
        if self.ctx == 'date' and self.in_a:
            return  # "신고" link text next to the date
        self.parts.append(data)


def parse_entries(html_text):
    parser = GuestbookParser()
    parser.feed(html_text)
    parser.close()
    result = []
    for raw in parser.entries:
        classes = raw['classes']
        kind = 'secret' if any('secret' in c for c in classes) else ('admin' if 'guest_admin' in classes else 'general')
        match = STOCK_TAG.match(raw['body'])
        result.append({'id': raw['id'], 'kind': kind, 'name': raw['name'], 'date': raw['date'], 'body': raw['body'],
                       'stock': match.group(1) if match else '', 'replies': raw['replies']})
    return result


def fetch_page(page):
    url = BASE_URL if page == 1 else '%s?page=%d' % (BASE_URL, page)
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; ninepay-guestbook-backup/1.0)'})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return response.read().decode('utf-8', 'replace')
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = error
            time.sleep(2 * (attempt + 1))
    raise RuntimeError('guestbook fetch failed: %s' % type(last).__name__)


def fetch_all(fetch=fetch_page, delay=PAGE_DELAY_SEC):
    """Returns (entries, complete). Stops on an empty or repeated page."""
    seen, ordered, previous_ids = set(), [], None
    for page in range(1, MAX_PAGES + 1):
        entries = parse_entries(fetch(page))
        ids = [e['id'] for e in entries if e['id']]
        if not ids or ids == previous_ids:
            return ordered, True
        previous_ids = ids
        for entry in entries:
            if entry['id'] and entry['id'] not in seen:
                seen.add(entry['id'])
                ordered.append(entry)
        if delay:
            time.sleep(delay)
    return ordered, False


def _content(entry):
    return {key: entry.get(key) for key in CONTENT_KEYS}


def merge(state, fetched, complete, now):
    """Adds new entries, keeps old text on change, marks vanished entries; never deletes."""
    stamp = now.isoformat()
    entries = state.setdefault('entries', {})
    new = changed = 0
    fetched_ids = set()
    for item in fetched:
        entry_id = item['id']
        fetched_ids.add(entry_id)
        current = _content(item)
        stored = entries.get(entry_id)
        if stored is None:
            entries[entry_id] = {'id': entry_id, 'stock': item['stock'], 'firstSeen': stamp, 'lastSeen': stamp,
                                 'missingSince': None, 'current': current, 'revisions': []}
            new += 1
            continue
        stored['lastSeen'] = stamp
        stored['missingSince'] = None
        if stored['current'] != current:
            stored['revisions'].append({'seenUntil': stamp, 'content': stored['current']})
            stored['current'] = current
            stored['stock'] = item['stock']
            changed += 1
    missing = 0
    if complete:
        for entry_id, stored in entries.items():
            if entry_id not in fetched_ids and not stored.get('missingSince'):
                stored['missingSince'] = stamp
                missing += 1
    run = {'at': stamp, 'fetched': len(fetched), 'new': new, 'changed': changed, 'newlyMissing': missing, 'complete': complete}
    runs = state.setdefault('runs', [])
    runs.append(run)
    del runs[:-100]
    state['version'] = 1
    state['updatedAt'] = stamp
    return run


def load_state(path):
    try:
        with open(path, encoding='utf-8') as stream:
            state = json.load(stream)
    except FileNotFoundError:
        return {'version': 1, 'entries': {}, 'runs': []}
    if not isinstance(state, dict) or not isinstance(state.get('entries'), dict):
        raise ValueError('guestbook backup file is corrupted; refusing to overwrite')
    return state


def run(directory=None, fetch=fetch_page, delay=PAGE_DELAY_SEC, now=None, dry_run=False):
    directory = Path(directory or DATA_DIR)
    now = now or datetime.now(KST)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    lock = None
    try:
        import fcntl
        lock = open(directory / '.lock', 'a+')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except ImportError:
        lock = None
    except OSError:
        raise RuntimeError('another guestbook backup is running')
    try:
        path = directory / FILE_NAME
        state = load_state(path)
        fetched, complete = fetch_all(fetch, delay)
        if not fetched and state['entries']:
            raise RuntimeError('guestbook returned no entries although a backup exists; nothing changed')
        summary = merge(state, fetched, complete, now)
        if dry_run:
            return summary
        snapshot_io.atomic_json(path, state)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        monthly = directory / ('guestbook-%s.json' % now.strftime('%Y-%m'))
        if not monthly.exists():
            shutil.copy2(path, monthly)
        return summary
    finally:
        if lock is not None:
            lock.close()


def status(directory=None):
    """Counts and last run only (no entry text) for the admin screen."""
    path = Path(directory or DATA_DIR) / FILE_NAME
    try:
        state = load_state(path)
    except (ValueError, OSError):
        return {'exists': False, 'broken': path.exists()}
    entries = state.get('entries', {})
    runs = state.get('runs') or []
    return {'exists': bool(entries) or bool(runs), 'broken': False, 'updatedAt': state.get('updatedAt'),
            'entries': len(entries), 'missing': sum(1 for e in entries.values() if e.get('missingSince')),
            'lastRun': runs[-1] if runs else None}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', help='backup directory (default ~/guestbook-backup)')
    parser.add_argument('--dry-run', action='store_true', help='parse and merge in memory only')
    args = parser.parse_args(argv)
    try:
        summary = run(args.dir, dry_run=args.dry_run)
    except Exception as error:  # print type only; never print page content
        print('guestbook backup failed: %s: %s' % (type(error).__name__, error), file=sys.stderr)
        return 1
    print('guestbook backup ok: fetched=%(fetched)d new=%(new)d changed=%(changed)d newlyMissing=%(newlyMissing)d complete=%(complete)s' % summary)
    return 0


if __name__ == '__main__':
    sys.exit(main())
