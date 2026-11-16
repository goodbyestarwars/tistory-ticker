'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../js/chart-drawing.js'),'utf8');
const ctx=new Proxy({measureText:t=>({width:String(t).length*7})},{get:(o,k)=>k in o?o[k]:(()=>{})});
function element(){return {clientWidth:600,clientHeight:400,style:{},classList:{toggle(){},remove(){}},setAttribute(){},hasAttribute(){return true;},getBoundingClientRect(){return {left:0,top:0,right:600,bottom:400,width:600,height:400};},getContext(){return ctx;},setPointerCapture(){},hasPointerCapture(){return false;},remove(){}};}
const events=[],storage={};let confirmResult=false,confirmCount=0,promptResult='123.45';
const win={localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>{storage[k]=v;}},devicePixelRatio:1,
 requestAnimationFrame:()=>1,cancelAnimationFrame(){},confirm(){confirmCount++;return confirmResult;},prompt:()=>promptResult,
 NineUI:{number:x=>String(x)},addEventListener(){}};
const document={createElement:element};vm.runInNewContext(source,{window:win,document});
const api=win.NineChartDrawing;
const scale={coordinateToTime:x=>x,timeToCoordinate:x=>x,coordinateToLogical:x=>x,logicalToCoordinate:x=>x,width:()=>600};
const chart={timeScale:()=>scale};const series={priceToCoordinate:y=>y,coordinateToPrice:y=>y};
const container=element();container.appendChild=()=>{};
const core={createScope:()=>({on:(target,type,fn)=>events.push({target,type,fn}),add(){},resize(){},dispose(){}})};
const clear=element(),buyline=element();
const ctl=api.attach({core,container,chart,series,key:'TEST',timeframe:'minute',sync:false,
 store:{key:()=> 'test-only',kinds:['lines','paths','circles','boxes','hlines']},buttons:{clear,buyline}});
function fire(type,x,y,button=0){const e={clientX:x,clientY:y,button,pointerId:1,preventDefault(){this.prevented=true;},stopPropagation(){}};events.filter(r=>r.type===type).forEach(r=>r.fn(e));return e;}
const point=(x,y)=>({time:x,logical:x,price:y});const shape=(a,b)=>({start:point(...a),end:point(...b)});
const d=ctl.shapes;d.lines.push(shape([10,10],[100,100]));d.circles.push(shape([200,100],[300,200]));d.boxes.push(shape([350,100],[450,200]));d.paths.push([point(20,250),point(100,250)]);d.hlines.push({price:300});
const coord=p=>({x:p.logical,y:p.price});
assert.equal(api.shapeAt(d,coord,50,50,600).kind,'lines');
assert.equal(api.shapeAt(d,coord,250,100,600).kind,'circles');
assert.equal(api.shapeAt(d,coord,350,150,600).kind,'boxes');
assert.equal(api.shapeAt(d,coord,50,250,600).kind,'paths');
assert.equal(api.shapeAt(d,coord,500,300,600).kind,'hlines');
assert.equal(api.shapeAt(d,coord,250,150,600),null,'circle interior must not erase');
assert.equal(api.shapeAt(d,coord,400,150,600),null,'box interior must not erase');
fire('contextmenu',50,50,2);assert.equal(d.lines.length,0,'right click deletes only one stroke even when no tool is active');assert.equal(d.circles.length,1);
fire('contextmenu',550,350,2);assert.equal(d.hlines.length,1,'empty right click preserves drawings');
clear.onclick();assert.equal(confirmCount,1);assert.equal(d.circles.length,1,'cancel clear preserves drawings');
ctl.setMode('buyline');fire('pointerdown',150,180,2);fire('pointerup',150,180,2);assert.equal(d.lines.length,0,'right button never draws');
fire('pointerdown',150,180);fire('pointerup',150,180);assert.equal(d.lines.length,1);assert(api.isPurchaseLine(d.lines[0]));assert.equal(d.lines[0].start.price,123.45);
const payload=api._sync.payload(d);assert.equal(payload.lines[0].label,'매입가');assert.equal(JSON.parse(storage['test-only']).lines[0].start.price,123.45);
ctl.redraw();fire('pointerdown',200,123.45);fire('pointermove',200,140);fire('pointerup',200,140);assert.equal(d.lines[0].start.price,140);assert.equal(d.lines[0].end.price,140);
fire('contextmenu',500,140,2);assert.equal(d.lines.length,0,'right click deletes the purchase line alone');assert.equal(d.hlines.length,1);
confirmResult=true;clear.onclick();assert.equal(confirmCount,2);assert(['lines','circles','boxes','paths','hlines'].every(k=>d[k].length===0));
assert.equal(clear.textContent,'전체 지우기');
console.log('Drawing actions: stroke hit tests, right-button isolation, purchase line/drag/storage, clear cancel/confirm passed');

