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
win.NineChartCore=require('./js/chart-core.js');
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
 const lbl=t=>({label:t});
 const vm0={assessment:{diagnosis:'중기 하락',holderAction:'보유 주의',entryOpinion:'신규 진입 금지',momentum:{state:'중립'},fundamental:{state:'지지'}},
  chart:{invalidation:'20일선 회복'},risk:{state:'주의',flags:[]},waves:{},reasons:'근거',currentRegime:lbl('하락 추세'),recentEvent:lbl('이벤트 없음'),
  auxiliary:'없음',bigWave:lbl('하락 추세'),midWave:lbl('하락 추세'),smallWave:lbl('상승 추세'),shortSignal:lbl('없음'),transitionLabel:'없음'};
 const daily=[];for(let i=0;i<260;i++)daily.push({date:'2026-01-'+i,close:1000-i});
 const mw={hidden:true,innerHTML:''};
 const swingEl={classList:{add(c){mw.cls=c;}}};
 api.loadStockStory({querySelector(sel){return /data-ff-story/.test(sel)?mw:/ff-swing-summary/.test(sel)?swingEl:null;},contains(){return true;},closest(){return null;}},'042660',vm0,{daily});
 await new Promise(setImmediate);
 assert(mw.innerHTML.includes('ff-wide--verdict'));
 assert(mw.innerHTML.includes('ff-wide--chart'));
 assert(mw.innerHTML.includes('<path class="ff-wide-close"'));
 assert(mw.innerHTML.includes('ff-wide--story'));assert(!mw.innerHTML.includes('data-story-more'));
 assert.equal(mw.cls,'is-in-story');
 const mx={hidden:true,innerHTML:''};
 api.loadStockStory({querySelector(sel){return /data-ff-story/.test(sel)?mx:null;},contains(){return true;},closest(){return null;}},'042660',null,{daily:daily.slice(0,10)});
 await new Promise(setImmediate);
 assert(!mx.innerHTML.includes('ff-wide--verdict'));assert(mx.innerHTML.includes('ff-wide--chart'));
 assert(mx.innerHTML.includes('ff-wide--story'));
 const m2={hidden:true,innerHTML:''};
 api.loadStockStory({querySelector(sel){return /data-ff-story/.test(sel)?m2:null;},contains(){return true;},closest(){return null;}},'999999');
 await new Promise(setImmediate);
 assert.equal(m2.hidden,true);
 const m3={hidden:true,innerHTML:''};
 api.loadStockStory({querySelector(sel){return /data-ff-story/.test(sel)?m3:null;},contains(){return false;},closest(){return null;}},'042660');
 await new Promise(setImmediate);
 assert.equal(m3.hidden,true);
 // 셀트리온처럼 심층 데이터가 없어도 이미 계산한 스윙·차트 카드가 보인다.
 const m4={hidden:true,innerHTML:''}, m4s={classList:{add(c){m4s.cls=c;}}};
 const box4={querySelector(sel){return /data-ff-story/.test(sel)?m4:/ff-swing-summary/.test(sel)?m4s:null;},contains(){return true;},closest(){return null;}};
 api.loadStockStory(box4,'068270',vm0,{daily},'셀트리온');
 await new Promise(setImmediate);
 assert.equal(m4.hidden,false);
 assert(m4.innerHTML.includes('종목 분석 : 셀트리온'));
 assert(m4.innerHTML.includes('ff-wide--verdict') && m4.innerHTML.includes('ff-wide--chart'));
 assert(!m4.innerHTML.includes('ff-wide--story'));
 assert(m4.innerHTML.includes('심층 스토리 미제공'));
 assert.equal(m4s.cls,'is-in-story');
})().catch(e=>{console.error(e);process.exitCode=1;});
'''
        r = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == '__main__':
    unittest.main()

