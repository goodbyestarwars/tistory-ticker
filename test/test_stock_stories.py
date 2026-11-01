"""Stock story card: data file shape, lazy load, stale response, no empty card."""
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class StockStoriesTests(unittest.TestCase):
    def test_story_loads_renders_and_skips_unknown_or_stale(self):
        script = r'''
const fs=require('fs'), vm=require('vm'), assert=require('assert');
let src=fs.readFileSync('js/foreign-flow.js','utf8');
src=src.replace('global.ForeignFlow =', 'global.__t={buildStockStoryPlaceholder,loadStockStory}; global.ForeignFlow =');
let appended=[];
const win={addEventListener(){},NineUI:{escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}};
const doc={readyState:'loading',addEventListener(){},createElement(){return {}},head:{appendChild(s){appended.push(s);}}};
vm.runInNewContext(src,{window:win,document:doc,console,fetch(){throw new Error('api');},setTimeout,clearTimeout});
const api=win.__t;
vm.runInNewContext(fs.readFileSync('data/stock-stories.js','utf8'),{window:win});
assert(appended.length===0);
(async()=>{
 assert.equal(api.buildStockStoryPlaceholder('bad'),'');
 const mount={hidden:true,innerHTML:''};
 let attached=true;
 const box={querySelector(sel){return /data-ff-story/.test(sel)?mount:null;},contains(){return attached;},closest(){return null;}};
 api.loadStockStory(box,'042660');
 await new Promise(setImmediate);
 assert.equal(mount.hidden,false);
 assert(mount.innerHTML.includes('한화오션'));
 assert(mount.innerHTML.includes('틀렸다면'));
 assert(!mount.innerHTML.includes('<script'));
 const m2={hidden:true,innerHTML:''};
 api.loadStockStory({querySelector(sel){return /data-ff-story/.test(sel)?m2:null;},contains(){return true;},closest(){return null;}},'005930');
 await new Promise(setImmediate);
 assert.equal(m2.hidden,true);
 const m3={hidden:true,innerHTML:''};
 api.loadStockStory({querySelector(sel){return /data-ff-story/.test(sel)?m3:null;},contains(){return false;},closest(){return null;}},'042660');
 await new Promise(setImmediate);
 assert.equal(m3.hidden,true);
})().catch(e=>{console.error(e);process.exitCode=1;});
'''
        r = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == '__main__':
    unittest.main()
