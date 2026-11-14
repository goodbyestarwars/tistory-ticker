import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import discussion_intro as mod

CONTENT = dict(title='제목', body='첫 줄\n둘째 줄', art='  /\\\n장미', etiquette='안내')


class IntroTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.object(mod, 'STATE_PATH', self.temp.name + '/state.json')
        self.patch.start()
    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()
    def test_roundtrip_and_private_audit(self):
        self.assertIsNone(mod.view()['content'])
        saved = mod.update(dict(content=CONTENT, revision=0), 'admin@example.com')
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(mod.view()['content']['body'], CONTENT['body'])
        self.assertNotIn('admin@example.com', json.dumps(mod.view()))
        self.assertEqual(json.loads(Path(mod.STATE_PATH).read_text(encoding='utf-8'))['audit'][0]['actor'], 'admin@example.com')
    def test_stale_revision_cannot_overwrite(self):
        mod.update(dict(content=CONTENT, revision=0), 'admin')
        with self.assertRaises(mod.Conflict):
            mod.update(dict(content=dict(CONTENT, title='다른 제목'), revision=0), 'admin')
        self.assertEqual(mod.view()['content']['title'], CONTENT['title'])
    def test_invalid_input(self):
        for body in [None, {}, dict(content=CONTENT, revision=True), dict(content=dict(CONTENT,title=''), revision=0),
                     dict(content=dict(CONTENT,title='x'*101),revision=0),
                     dict(content=dict(CONTENT,body='x'*4001),revision=0),
                     dict(content=dict(CONTENT,etiquette='a\nb'),revision=0),
                     dict(content=dict(CONTENT,body='\x00'),revision=0)]:
            with self.assertRaises(ValueError): mod.update(body,'admin')
    def test_corruption_and_failed_write_preserve_old(self):
        mod.update(dict(content=CONTENT,revision=0),'admin')
        with patch.object(mod.snapshot_io,'atomic_json',side_effect=OSError('disk')):
            with self.assertRaises(OSError): mod.update(dict(content=CONTENT,revision=1),'admin')
        self.assertEqual(mod.view()['revision'],1)
        Path(mod.STATE_PATH).write_text('{broken',encoding='utf-8')
        with self.assertRaises(ValueError): mod.update(dict(content=CONTENT,revision=1),'admin')
        self.assertEqual(Path(mod.STATE_PATH).read_text(),'{broken')

    def state(self):
        return json.loads(Path(mod.STATE_PATH).read_text(encoding='utf-8'))

    def test_full_history_retains_all_versions_beyond_audit_limit(self):
        for revision in range(105):
            mod.update(dict(content=dict(CONTENT, body='버전 '+str(revision+1)),revision=revision),'admin')
        state=self.state()
        self.assertEqual(len(state['audit']),100)
        self.assertEqual(len(state['history']),105)
        self.assertEqual(state['history'][0]['content']['body'],'버전 1')
        self.assertEqual(state['history'][-1]['content']['body'],'버전 105')
        self.assertNotIn('history',mod.view())
        self.assertNotIn('actor',mod.view())

    def test_legacy_migration_preserves_known_snapshot_without_fabricating_old_versions(self):
        legacy=dict(content=CONTENT,revision=7,updatedAt='2026-11-14T12:00:00Z',
                    audit=[dict(actor='owner',revision=7,at='2026-11-14T12:00:00Z')])
        Path(mod.STATE_PATH).write_text(json.dumps(legacy),encoding='utf-8')
        self.assertEqual(mod.preserve_current()['versions'],1)
        self.assertEqual(self.state()['history'][0]['revision'],7)
        self.assertEqual(self.state()['history'][0]['source'],'existing-snapshot')
        mod.update(dict(content=dict(CONTENT,title='새 제목'),revision=7),'owner')
        self.assertEqual([x['revision'] for x in self.state()['history']],[7,8])
        self.assertEqual(self.state()['history'][0]['content'],CONTENT)

    def test_initial_default_baseline_and_restart_survive(self):
        mod.preserve_current(CONTENT)
        self.assertEqual(mod.view()['revision'],0)
        self.assertEqual(self.state()['history'][0]['source'],'code-default-baseline')
        mod.update(dict(content=dict(CONTENT,title='변경'),revision=0),'owner')
        self.assertEqual(mod.preserve_current(dict(CONTENT,title='다른 기본값'))['versions'],2)
        self.assertEqual(mod.view()['content']['title'],'변경')
        self.assertEqual(self.state()['history'][0]['content'],CONTENT)

    def test_history_and_current_fail_atomically(self):
        mod.preserve_current(CONTENT)
        before=Path(mod.STATE_PATH).read_bytes()
        with patch.object(mod.snapshot_io,'atomic_json',side_effect=OSError('disk')):
            with self.assertRaises(OSError):mod.update(dict(content=CONTENT,revision=0),'owner')
        self.assertEqual(Path(mod.STATE_PATH).read_bytes(),before)
        state=self.state()
        state['history'][-1]['content']['title']='손상'
        Path(mod.STATE_PATH).write_text(json.dumps(state),encoding='utf-8')
        before=Path(mod.STATE_PATH).read_bytes()
        with self.assertRaises(ValueError):mod.update(dict(content=CONTENT,revision=0),'owner')
        self.assertEqual(Path(mod.STATE_PATH).read_bytes(),before)


if __name__ == '__main__': unittest.main()

