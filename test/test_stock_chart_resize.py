import json
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class StockChartResizeTests(unittest.TestCase):
    def test_resize_notifications_settle_and_fullscreen_exit_restores_size(self):
        script = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const frames=new Map();let next=1,calls=[],factorWrites=0;
const panes=[0,1,2].map(()=>({factor:1,getStretchFactor(){return this.factor;},
 setStretchFactor(v){factorWrites++;this.factor=v;},getHeight(){return 200;}}));
const container={clientWidth:600,clientHeight:760,querySelector(){return null;}};
const window={addEventListener(){},requestAnimationFrame(cb){let id=next++;frames.set(id,cb);return id;},
 cancelAnimationFrame(id){frames.delete(id);}};
const context={window,document:{readyState:'loading',addEventListener(){}},URL,Date,Number,Promise,console};vm.createContext(context);
const source=fs.readFileSync('js/stock-search.js','utf8').replace('global.StockSearch = { init: init };',
 `global.resizeTest={resize:resizeStockChart,panes:sizeStockChartPanes,
 mount(chart,container){lwcChart=chart;lwcChartContainer=container;},
 reset(){stockChartMeasuredWidth=0;stockChartMeasuredHeight=0;}};`);
vm.runInContext(source,context);const api=window.resizeTest;
const chart={panes(){return panes;},resize(w,h){calls.push([w,h]);api.resize();}};
api.mount(chart,container);
function flush(){let count=0;while(frames.size){if(++count>10)throw Error('resize feedback loop');
 const pending=[...frames.values()];frames.clear();pending.forEach(cb=>cb());}}
for(let i=0;i<20;i++)api.resize();assert.equal(frames.size,1);flush();assert.equal(calls.length,1);
let writes=factorWrites;api.panes(panes,760);assert.equal(factorWrites,writes);
container.clientWidth=1400;container.clientHeight=540;api.resize();flush();
assert.deepEqual(calls[1],[1400,540]);
container.clientWidth=0;api.resize();flush();assert.equal(calls.length,2);
container.clientWidth=600;container.clientHeight=760;api.resize();flush();
assert.deepEqual(calls[2],[600,760]);api.resize();flush();assert.equal(calls.length,3);
api.reset();api.resize();flush();assert.equal(calls.length,4);
console.log(JSON.stringify({calls:calls.length,settled:true}));
'''
        result = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['settled'])

    def test_renderer_owns_resize_and_modal_has_a_bounded_flex_chart(self):
        source = (ROOT / 'js/stock-search.js').read_text(encoding='utf-8')
        renderer = source[source.index('function renderLwChart('):]
        self.assertIn('autoSize: false', renderer)
        self.assertIn('stockChartResizeObserver.disconnect()', renderer)
        self.assertIn('new global.ResizeObserver(resizeStockChart)', renderer)
        modal = (ROOT / 'js/dashboard-enhancements.js').read_text(encoding='utf-8')
        self.assertIn('if (chartTarget && !stockRoot)', modal)
        css = (ROOT / 'css/dashboard-enhancements.css').read_text(encoding='utf-8')
        self.assertIn('scrollbar-gutter: stable', css)
        self.assertIn('height: auto !important; min-height: 240px', css)
