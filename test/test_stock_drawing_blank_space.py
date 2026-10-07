"""Exercise actual drawing events beyond the last candle, including restoration."""
import json
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs=require('fs'),vm=require('vm');
const storage={},events={},buttons={};let zoom=10,shift=0,logicalSubscribed=0,logicalUnsubscribed=0;
function classes(){return {toggle(){},remove(){}};}
for(const name of ['line','circle','pencil'])buttons[name]={classList:classes(),attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
const ctx=new Proxy({}, {get(o,k){return o[k] || (()=>{});},set(o,k,v){o[k]=v;return true;}});
const canvas={clientWidth:1000,clientHeight:400,classList:classes(),setAttribute(){},getContext(){return ctx;},getBoundingClientRect(){return {left:0,top:0};},addEventListener(k,f){events[k]=f;},setPointerCapture(){},remove(){}};
const window={addEventListener(){},removeEventListener(){},localStorage:{getItem(k){return storage[k]||null;},setItem(k,v){storage[k]=v;}},devicePixelRatio:1};
const document={readyState:'loading',addEventListener(){},createElement(){return canvas;}};
let src=fs.readFileSync('js/stock-search.js','utf8').replace('global.StockSearch = { init: init };','global.testDrawing={setupStockDrawing,setStockDrawingMode,loadStockDrawings,stockDrawingCoordinate,destroyStockDrawing,state};');
vm.runInNewContext(src,{window,document,console});const api=window.testDrawing;api.state.selectedCode='005930';
const scale={coordinateToTime(x){return x<=500?'last':null;},coordinateToLogical(x){return x/zoom;},timeToCoordinate(t){return t==='last'?(50+shift)*zoom:100;},logicalToCoordinate(l){return l*zoom;},subscribeVisibleTimeRangeChange(){},unsubscribeVisibleTimeRangeChange(){},subscribeVisibleLogicalRangeChange(){logicalSubscribed++;},unsubscribeVisibleLogicalRangeChange(){logicalUnsubscribed++;}};
const series={coordinateToPrice(y){return 1000-y;},priceToCoordinate(p){return 1000-p;}};
const chart={timeScale(){return scale;}};
const element={parentElement:{querySelector(s){return s.includes('pencil')?buttons.pencil:s.includes('circle')?buttons.circle:buttons.line;}},appendChild(){}};
api.setupStockDrawing(element,chart,series,'day',[{date:'last'}]);
function emit(k,x,y){events[k]({clientX:x,clientY:y,pointerId:1,preventDefault(){}});}
for(const mode of ['line','circle','pencil']){api.setStockDrawingMode(mode);emit('pointerdown',600,100);emit('pointermove',750,100);emit('pointermove',950,200);emit('pointerup',950,200);}
const saved=api.loadStockDrawings('005930','day');
const point=saved.lines[0].end;const original=api.stockDrawingCoordinate({chart,series},point);
zoom=20;shift=10;const shifted=api.stockDrawingCoordinate({chart,series},point);
const legacy=api.stockDrawingCoordinate({chart,series},{time:'old',price:900});
const pressed={...buttons.pencil.attrs};api.setStockDrawingMode(null);const released={...buttons.pencil.attrs};
api.destroyStockDrawing();
console.log(JSON.stringify({saved,original,shifted,legacy,pressed,released,logicalSubscribed,logicalUnsubscribed}));
"""


class BlankSpaceDrawingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(['node', '-e', HARNESS], cwd=ROOT, capture_output=True,
                                text=True, encoding='utf-8', check=True)
        cls.data = json.loads(result.stdout)

    def test_all_tools_save_shapes_started_and_finished_in_blank_space(self):
        saved = self.data['saved']
        self.assertEqual(len(saved['lines']), 1)
        self.assertEqual(len(saved['circles']), 1)
        self.assertEqual(len(saved['paths']), 1)
        self.assertEqual(saved['lines'][0]['end']['logical'], 95)
        self.assertEqual(len(saved['paths'][0]), 3)  # same-price horizontal motion survives

    def test_restored_future_point_follows_zoom_and_history_shift(self):
        self.assertEqual(self.data['original'], {'x': 950, 'y': 200})
        self.assertEqual(self.data['shifted'], {'x': 2100, 'y': 200})
        self.assertEqual(self.data['legacy'], {'x': 100, 'y': 100})
        self.assertEqual(self.data['logicalSubscribed'], 1)
        self.assertEqual(self.data['logicalUnsubscribed'], 1)

    def test_selected_tool_state_can_be_toggled_off(self):
        self.assertEqual(self.data['pressed']['aria-pressed'], 'true')
        self.assertEqual(self.data['released']['aria-pressed'], 'false')
