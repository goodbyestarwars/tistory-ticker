"""공용 그리기 모듈(js/chart-drawing.js, 차트검색 설정)이 마지막 캔들 오른쪽 빈 공간의 입력과 복원을 처리하는지 실제 이벤트로 검증한다."""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs=require('fs'),vm=require('vm');
const storage={},events={},buttons={};let zoom=10,shift=0,logicalSubscribed=0,logicalUnsubscribed=0;
function classes(){return {toggle(){},remove(){},add(){}};}
for(const name of ['line','circle','pencil'])buttons[name]={classList:classes(),attrs:{},setAttribute(k,v){this.attrs[k]=v;},hasAttribute(k){return k in this.attrs;}};
const ctx=new Proxy({}, {get(o,k){return o[k] || (()=>{});},set(o,k,v){o[k]=v;return true;}});
const canvas={clientWidth:1000,clientHeight:400,width:0,height:0,style:{},classList:classes(),setAttribute(){},getContext(){return ctx;},getBoundingClientRect(){return {left:0,top:0,width:1000,height:400};},addEventListener(k,f){events[k]=f;},removeEventListener(){},setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){},remove(){}};
const frames=new Map();let nextFrame=0;
const window={addEventListener(){},removeEventListener(){},localStorage:{getItem(k){return storage[k]||null;},setItem(k,v){storage[k]=v;}},devicePixelRatio:1,
  requestAnimationFrame(cb){frames.set(++nextFrame,cb);return nextFrame;},cancelAnimationFrame(id){frames.delete(id);},
  ResizeObserver:class{observe(){}unobserve(){}disconnect(){}}};
const document={createElement(){return canvas;},documentElement:{classList:classes()}};
const context=vm.createContext({window,document,console});
for(const f of ['js/chart-core.js','js/chart-drawing.js'])vm.runInContext(fs.readFileSync(f,'utf8'),context);
const core=window.NineChartCore,Drawing=window.NineChartDrawing;
const scale={coordinateToTime(x){return x<=500?'last':null;},coordinateToLogical(x){return x/zoom;},timeToCoordinate(t){return t==='last'?(50+shift)*zoom:100;},logicalToCoordinate(l){return l*zoom;},subscribeVisibleTimeRangeChange(){},unsubscribeVisibleTimeRangeChange(){},subscribeVisibleLogicalRangeChange(){logicalSubscribed++;},unsubscribeVisibleLogicalRangeChange(){logicalUnsubscribed++;}};
const series={coordinateToPrice(y){return 1000-y;},priceToCoordinate(p){return 1000-p;}};
const chart={timeScale(){return scale;}};
const element={appendChild(){}};
const store={key:(k,tf)=>'tistory-ticker:stock-drawings:'+k+':'+tf,kinds:['lines','paths','circles','hlines','boxes'],legacyArray:true};
const ctl=Drawing.attach({core,container:element,chart,series,bars:[{date:'last'}],key:'005930',timeframe:'day',bounds:'container',point:'anchored',tools:['line','pencil','circle','box','hline'],buttons,store,sync:false});
function emit(k,x,y){events[k]({clientX:x,clientY:y,pointerId:1,preventDefault(){}});}
for(const mode of ['line','circle','pencil']){ctl.setMode(mode);emit('pointerdown',600,100);emit('pointermove',750,100);emit('pointermove',950,200);emit('pointerup',950,200);}
const saved=Drawing.loadShapes(store,'005930','day');
const point=saved.lines[0].end;const original=Drawing.anchoredToXY({chart,series},point);
zoom=20;shift=10;const shifted=Drawing.anchoredToXY({chart,series},point);
const legacy=Drawing.anchoredToXY({chart,series},{time:'old',price:900});
ctl.setMode('pencil');const pressed={...buttons.pencil.attrs};ctl.setMode(null);const released={...buttons.pencil.attrs};
ctl.detach();
console.log(JSON.stringify({saved,original,shifted,legacy,pressed,released,logicalSubscribed,logicalUnsubscribed}));
"""


@unittest.skipUnless(shutil.which('node'), 'node가 없으면 건너뛴다')
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
