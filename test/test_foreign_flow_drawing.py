"""종목분석 그리기 도구(공용 js/chart-drawing.js + foreign-flow.js 연결부)의 입력·저장·투영·정리를 실제 JS로 검증한다."""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs = require('fs'), vm = require('vm');
let source = fs.readFileSync('js/foreign-flow.js', 'utf8').replace('global.ForeignFlow = ForeignFlow;',
  'global.ForeignFlow = ForeignFlow; global.testDrawing = {setup:setupFlowOverlays, destroy:destroyFlowOverlays, card:buildFlowChartCard, ctl:()=>drawingCtl, store:FLOW_DRAWING_STORE};');
const storage = {}, frames = new Map(), operations = [];
let nextFrame = 0, disconnected = 0, primitives = [];
function classes() { const values = new Set(); return {toggle(k,on){on?values.add(k):values.delete(k);},remove(k){values.delete(k);},contains(k){return values.has(k);},add(k){values.add(k);}}; }
const buttons = ['line','circle','pencil','clear'].map(mode=>({
  attributes:{'data-ff-draw':mode,'aria-pressed':'false'},classList:classes(),disabled:true,
  getAttribute(k){return this.attributes[k];},setAttribute(k,v){this.attributes[k]=v;},hasAttribute(k){return k in this.attributes;}
}));
const ctx = Object.fromEntries(['setTransform','clearRect','beginPath','moveTo','lineTo','ellipse','stroke'].map(k=>[k,(...args)=>operations.push([k,...args])]));
let canvas;
const window = {addEventListener(){},removeEventListener(){},devicePixelRatio:2,
  localStorage:{getItem(k){return storage[k]||null;},setItem(k,v){storage[k]=v;}},
  requestAnimationFrame(cb){frames.set(++nextFrame,cb);return nextFrame;},cancelAnimationFrame(id){frames.delete(id);},
  ResizeObserver:class {observe(){} unobserve(){} disconnect(){disconnected++;}}
};
const document = {documentElement:{classList:classes()},readyState:'loading',addEventListener(){},querySelector(){return null;},head:{appendChild(){}},createElement(){
  const listeners = {}, captures = new Set();
  canvas={style:{},classList:classes(),width:0,height:0,isConnected:true,
    setAttribute(){},getContext(){return ctx;},addEventListener(k,cb){listeners[k]=cb;},removeEventListener(){},
    getBoundingClientRect(){return {left:0,top:0,width:parseFloat(this.style.width),height:parseFloat(this.style.height)};},
    setPointerCapture(id){captures.add(id);},hasPointerCapture(id){return captures.has(id);},releasePointerCapture(id){captures.delete(id);},
    remove(){this.isConnected=false;},emit(k,x,y,id=1){listeners[k]({clientX:x,clientY:y,pointerId:id,button:0,preventDefault(){}});}
  };return canvas;
}};
const context = vm.createContext({window,document,console,setTimeout,clearTimeout,Promise});
for (const f of ['js/chart-core.js','js/chart-drawing.js']) vm.runInContext(fs.readFileSync(f,'utf8'), context);
vm.runInContext(source, context);
const api=window.testDrawing, Drawing=window.NineChartDrawing;
let scale=1, paneHeight=400;
const chart={panes(){return [{getHeight(){return paneHeight;}}];},timeScale(){return {
  width(){return 600;},coordinateToTime(x){return Math.round(x);},timeToCoordinate(t){return t*scale;},subscribeVisibleLogicalRangeChange(){},unsubscribeVisibleLogicalRangeChange(){}
};}};
const series={coordinateToPrice(y){return 1000-y;},priceToCoordinate(p){return (1000-p)*scale;},
  attachPrimitive(p){primitives.push(p);},detachPrimitive(p){primitives=primitives.filter(x=>x!==p);}};
const container={parentElement:{querySelectorAll(){return buttons;}},appendChild(){}};
const daily=[{date:50,open:100,high:110,low:90,close:100,volume:1}];
function flush(){for(const [id,cb] of [...frames]){frames.delete(id);cb();}}
function drag(mode,a,b){buttons.find(x=>x.getAttribute('data-ff-draw')===mode).onclick();canvas.emit('pointerdown',...a);canvas.emit('pointermove',...b);canvas.emit('pointerup',...b);}
const load=(code)=>Drawing.loadShapes(api.store,code,'day');
const three=(o)=>({lines:o.lines,circles:o.circles,paths:o.paths});
api.setup(container,chart,series,daily,'005930','sans-serif');
const card=api.card({daily:[{},{}]},null);
drag('line',[50,100],[150,180]);
drag('circle',[60,120],[180,240]);
drag('pencil',[70,130],[160,220]);
const saved=three(load('005930'));
const first={saved,active:buttons[2].getAttribute('aria-pressed'),captureReleased:!canvas.hasPointerCapture(1),width:canvas.width,height:canvas.height};
buttons[0].onclick(); canvas.emit('pointerdown',100,100); canvas.emit('pointermove',200,200);canvas.emit('pointercancel',200,200);
const cancelled=load('005930').lines.length;
canvas.emit('pointerdown',100,100);canvas.emit('pointerup',100,100);
const click=load('005930').lines.length;
canvas.emit('pointerdown',100,100);canvas.emit('pointerup',200,450); // 가격 패널 바깥
const outside=load('005930').lines.length;
scale=2;paneHeight=300;operations.length=0;primitives[0].updateAllViews();flush();
const projected=operations.some(x=>x[0]==='moveTo'&&x[1]===100&&x[2]===200);
const resizedHeight=canvas.height;
api.destroy();
const cleanup={primitives:primitives.length,frames:frames.size,disconnected,connected:canvas.isConnected,disabled:buttons.every(x=>x.disabled)};
api.setup(container,chart,series,daily,'000660','sans-serif');const other=three(load('000660'));api.destroy();
api.setup(container,chart,series,daily,'005930','sans-serif');const restored=api.ctl().shapes.lines.length;
buttons[3].onclick();const cleared=three(load('005930'));
storage['tistory-ticker:flow-drawings:bad:day']='invalid';const corrupt=three(load('bad'));
window.localStorage.setItem=()=>{throw Error('blocked');};drag('line',[20,30],[80,90]);
console.log(JSON.stringify({card,first,cancelled,click,outside,projected,resizedHeight,cleanup,other,restored,cleared,corrupt,blocked:api.ctl().shapes.lines.length,key:Object.keys(storage)[0]}));
"""


@unittest.skipUnless(shutil.which('node'), 'node가 없으면 건너뛴다')
class ForeignFlowDrawingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(['node', '-e', HARNESS], cwd=ROOT, check=True,
                                capture_output=True, text=True, encoding='utf-8')
        cls.result = json.loads(result.stdout)

    def test_toolbar_has_all_four_tools(self):
        for tool in ['직선', '동그라미', '연필', '지우기']:
            self.assertIn(tool, self.result['card'])

    def test_left_to_right_line_circle_and_pencil_are_saved(self):
        saved = self.result['first']['saved']
        for kind in ['lines', 'circles', 'paths']:
            self.assertEqual(len(saved[kind]), 1)
        self.assertEqual(saved['lines'][0]['start'], {'time': 50, 'price': 900})
        self.assertEqual(saved['lines'][0]['end'], {'time': 150, 'price': 820})
        self.assertTrue(self.result['first']['captureReleased'])
        # 저장 키는 예전과 같다(기존 사용자 도형이 사라지지 않는다)
        self.assertEqual(self.result['key'], 'tistory-ticker:flow-drawings:005930:day')

    def test_cancel_click_and_subpane_do_not_save_spurious_shapes(self):
        for key in ['cancelled', 'click', 'outside']:
            self.assertEqual(self.result[key], 1)

    def test_zoom_resize_and_destroy(self):
        self.assertTrue(self.result['projected'])
        self.assertEqual(self.result['resizedHeight'], 600)
        self.assertEqual(self.result['cleanup'], dict(primitives=0, frames=0, disconnected=1,
                                                    connected=False, disabled=True))

    def test_per_stock_restore_clear_and_storage_errors(self):
        self.assertEqual(self.result['restored'], 1)
        for key in ['other', 'cleared', 'corrupt']:
            self.assertEqual(self.result[key], dict(lines=[], circles=[], paths=[]))
        self.assertEqual(self.result['blocked'], 1)
