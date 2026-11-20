import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import guestbook_backup as mod

KST = timezone(timedelta(hours=9))


def li(entry_id, klass, name, date, body, replies=''):
    return f'''<li id="{entry_id}" class="discussion-item {klass}" data-discussion-entry>
      <div class="discussion-item-head">
        <span class="name"><img src="x.gif" alt="i" onerror="this.parentNode.removeChild(this)"/> <a href="#">{name}</a><span class="tistoryProfileLayerTrigger"></span></span>
        <span class="date">{date} <a href="/report">신고</a></span>
        <span class="control"><a href="#">삭제</a><a href="#">답글</a></span>
      </div>
      <p class="discussion-item-body">{body}</p>{replies}
    </li>'''


REPLY = '''<ul class="discussion-replies"><li class="discussion-reply"><div class="discussion-item-head">
  <span class="name">주인</span><span class="date">2026.11.12 09:00</span><span class="control"><a href="#">삭제</a></span></div>
  <p class="discussion-item-body">답글 본문</p></li></ul>'''


def page(*items):
    return '<html><body><ol>' + ''.join(items) + '</ol></body></html>'


PAGES = {
    1: page(li('comment3', 'guest_admin', '주인', '2026.11.21 03:12', '주인 글<br>둘째 줄'),
            li('comment2', 'guest_general', '방문자', '2026.11.10 01:51', '[005930] 삼성전자 글', REPLY)),
    2: page(li('comment1', 'guest_general', '옛 방문자', '2026.07.20 15:04', '옛 글'),
            li('comment0', 'guest_secret', '비밀', '2026.07.01 10:00', '비밀글입니다.')),
    3: page(),
}


def fetch_factory(pages):
    return lambda n: pages.get(n, '<html></html>')


class ParseTests(unittest.TestCase):
    def test_parse_fields(self):
        rows = {r['id']: r for r in mod.parse_entries(PAGES[1])}
        admin, general = rows['comment3'], rows['comment2']
        self.assertEqual((admin['kind'], admin['name'], admin['date']), ('admin', '주인', '2026.11.21 03:12'))
        self.assertEqual(admin['body'], '주인 글\n둘째 줄')
        self.assertEqual(general['stock'], '005930')
        self.assertEqual(general['replies'], [{'name': '주인', 'date': '2026.11.12 09:00', 'body': '답글 본문'}])
        self.assertNotIn('신고', admin['date'])
        self.assertNotIn('삭제', admin['body'])

    def test_secret_kind(self):
        self.assertEqual(mod.parse_entries(PAGES[2])[1]['kind'], 'secret')


class RunTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.now = datetime(2026, 11, 22, 3, 0, tzinfo=KST)

    def tearDown(self):
        self.temp.cleanup()

    def run_backup(self, pages, now=None):
        return mod.run(self.dir, fetch=fetch_factory(pages), delay=0, now=now or self.now)

    def state(self):
        return json.loads((self.dir / mod.FILE_NAME).read_text(encoding='utf-8'))

    def test_first_run_reads_all_pages_and_is_idempotent(self):
        summary = self.run_backup(PAGES)
        self.assertEqual((summary['fetched'], summary['new'], summary['complete']), (4, 4, True))
        again = self.run_backup(PAGES, self.now + timedelta(days=7))
        self.assertEqual((again['new'], again['changed'], again['newlyMissing']), (0, 0, 0))
        self.assertEqual(len(self.state()['entries']), 4)
        self.assertTrue((self.dir / 'guestbook-2026-11.json').exists())

    def test_changed_entry_keeps_old_text(self):
        self.run_backup(PAGES)
        edited = dict(PAGES)
        edited[1] = page(li('comment3', 'guest_admin', '주인', '2026.11.21 03:12', '수정된 글'), PAGES[1].split('</li>')[1] + '</li></ol></html>')
        summary = self.run_backup(edited, self.now + timedelta(days=7))
        self.assertEqual(summary['changed'], 1)
        row = self.state()['entries']['comment3']
        self.assertEqual(row['current']['body'], '수정된 글')
        self.assertEqual(row['revisions'][0]['content']['body'], '주인 글\n둘째 줄')

    def test_vanished_entry_is_marked_not_deleted(self):
        self.run_backup(PAGES)
        shrunk = {1: PAGES[1]}
        summary = self.run_backup(shrunk, self.now + timedelta(days=7))
        self.assertEqual(summary['newlyMissing'], 2)
        row = self.state()['entries']['comment1']
        self.assertTrue(row['missingSince'])
        self.assertEqual(row['current']['body'], '옛 글')

    def test_empty_response_does_not_touch_existing_backup(self):
        self.run_backup(PAGES)
        before = (self.dir / mod.FILE_NAME).read_text(encoding='utf-8')
        with self.assertRaises(RuntimeError):
            self.run_backup({}, self.now + timedelta(days=7))
        self.assertEqual((self.dir / mod.FILE_NAME).read_text(encoding='utf-8'), before)

    def test_corrupted_backup_is_not_overwritten(self):
        (self.dir / mod.FILE_NAME).write_text('{broken', encoding='utf-8')
        with self.assertRaises(ValueError):
            self.run_backup(PAGES)
        self.assertEqual((self.dir / mod.FILE_NAME).read_text(encoding='utf-8'), '{broken')

    def test_incomplete_fetch_does_not_mark_missing(self):
        self.run_backup(PAGES)
        always_new = lambda n: page(li('x%d' % n, 'guest_general', 'a', '2026.11.01 00:00', 'b'))
        summary = mod.run(self.dir, fetch=always_new, delay=0, now=self.now + timedelta(days=7))
        self.assertFalse(summary['complete'])
        self.assertEqual(summary['newlyMissing'], 0)

    def test_dry_run_writes_nothing(self):
        mod.run(self.dir, fetch=fetch_factory(PAGES), delay=0, now=self.now, dry_run=True)
        self.assertFalse((self.dir / mod.FILE_NAME).exists())


if __name__ == '__main__':
    unittest.main()
