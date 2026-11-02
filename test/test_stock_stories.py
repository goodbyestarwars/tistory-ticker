"""Interpretation renderer: omit legacy/empty sources, never prepend duplicate summary cards."""
import pathlib,subprocess,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class StockStoriesTests(unittest.TestCase):
 def test_interpretation_only_render_and_missing_omission(self):
  script=r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let src=fs.readFileSync('js/foreign-flow.js','utf8').replace('global.ForeignFlow =','global.__t={loadStockStory,buildStockStoryCard}; global.ForeignFlow =');
const win={addEventListener(){},NineUI:{escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}};
const doc={readyState:'loading',addEventListener(){},createElement(){return {}},head:{appendChild(){}}};
vm.runInNewContext(src,{window:win,document:doc,console,setTimeout,clearTimeout});
vm.runInNewContext(fs.readFileSync('js/stock-story-template.js','utf8'),{window:win});
win.STOCK_STORIES_INDEX={'005930':{name:'삼성전자'}};win.STOCK_STORIES={'005930':{name:'삼성전자',cards:[{topic:'earnings',title:'단순 실적표'}]}};
const mount={hidden:true,innerHTML:''};const box={querySelector:s=>s.includes('data-ff-story')?mount:null,contains:()=>true};
(async()=>{win.__t.loadStockStory(box,'005930',{},{});await new Promise(setImmediate);assert(mount.hidden);assert.equal(mount.innerHTML,'');
const data={name:'삼성전자',fundamentals:{fundamentals:{potential_supply:{status:'ok',items:[{label:'CB',price:8000,shares_pct:2,as_of:'2026-11-02',start_date:'2027-11-02',end_date:'2029-11-02',rcpNo:'20261102000001'}]}}},chartData:{daily:[{date:'2026-11-02',close:10000}]}};
win.__t.loadStockStory(box,'005930',{},data.chartData,data);await new Promise(setImmediate);
assert.equal(mount.hidden,false);assert(mount.innerHTML.includes('data-story-conclusion'));assert(mount.innerHTML.includes('현재가 대비 -20.0%'));
assert(!mount.innerHTML.includes('단순 실적표'));assert(!mount.innerHTML.includes('ff-wide--verdict'));assert(!mount.innerHTML.includes('ff-wide--chart'));
assert.equal((mount.innerHTML.match(/<article /g)||[]).length,1);
const html=win.__t.buildStockStoryCard({title:'<script>',conclusion:'<img onerror=x>',asOf:'2026-11-02',src:'DART'},0,0);assert(!html.includes('<script>'));assert(!html.includes('<img onerror'));
})().catch(e=>{console.error(e);process.exitCode=1;});'''
  r=subprocess.run(['node','-e',script],cwd=ROOT,capture_output=True,text=True,encoding='utf-8');self.assertEqual(r.returncode,0,r.stderr)
if __name__=='__main__':unittest.main()
