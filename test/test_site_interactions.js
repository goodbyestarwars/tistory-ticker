'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/site-interactions.js','utf8');
function fixture({fine=true,reduced=false}={}) {
  class Target {
    constructor(blocked=false){this.listeners={};this.blocked=blocked;this.style={};this.attrs={};this.children=[];}
    addEventListener(k,f){(this.listeners[k] ||= []).push(f);}
    removeEventListener(k,f){this.listeners[k]=(this.listeners[k]||[]).filter(x=>x!==f);}
    fire(k,props={}){const e={target:this,clientX:100,clientY:100,pointerType:'mouse',button:0,buttons:1,pointerId:1,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...props};for(const f of this.listeners[k]||[])f(e);return e;}
    closest(){return this.blocked?this:null;}
    setAttribute(k,v){this.attrs[k]=v;} removeAttribute(k){delete this.attrs[k];}
    appendChild(e){this.children.push(e);}
  }
  const window=new Target(),document=new Target(),normal=new Target(),blocked=new Target(true),body=new Target();
  let hovered=normal,selected=false;const frames=new Map();let id=0;
  Object.assign(document,{body,readyState:'complete',documentElement:{clientWidth:1000,clientHeight:800},hidden:false,
    querySelector:()=>body.children[0]||null,createElementNS:()=>new Target(),elementFromPoint:()=>hovered});
  Object.assign(window,{document,matchMedia:q=>Object.assign(new Target(),{matches:q.includes('reduced')?reduced:fine}),getSelection:()=>({isCollapsed:!selected}),
    requestAnimationFrame:f=>{frames.set(++id,f);return id;},cancelAnimationFrame:i=>frames.delete(i)});
  const context=vm.createContext({window,document,console});vm.runInContext(source,context);
  return {Target,window,document,normal,blocked,body,frames,context,hover(e){hovered=e;},select(v){selected=v;},
    down(target=normal,extra={}){return document.fire('pointerdown',{target,...extra});},move(target=normal,extra={}){return document.fire('pointermove',{target,...extra});},
    visible(){return body.children[0].style.visibility==='visible';},tick(){const [n,f]=frames.entries().next().value;frames.delete(n);f(16);}};
}
test('one overlay and one set of handlers despite duplicate script execution',()=>{const f=fixture();vm.runInContext(source,f.context);assert.equal(f.body.children.length,1);assert.equal(f.document.listeners.pointerdown.length,1);assert.equal(f.frames.size,0);});
test('mouse press starts a single frame loop; release clears path and frames',()=>{const f=fixture();f.down();assert.equal(f.frames.size,1);f.tick();assert.equal(f.frames.size,1);assert.ok(f.body.children[0].children[0].attrs.d.includes(' Q '));f.window.fire('pointerup');assert.equal(f.visible(),false);assert.equal(f.frames.size,0);assert.equal(f.body.children[0].children[0].attrs.d,undefined);});
test('excluded chart/input/carousel start does not block native events',()=>{const f=fixture();const e=f.down(f.blocked);assert.equal(f.visible(),false);assert.equal(e.prevented,undefined);assert.equal(f.frames.size,0);});
test('entering an excluded area ends effect; leaving cannot restart without a new press',()=>{const f=fixture();f.down();f.hover(f.blocked);f.move();assert.equal(f.visible(),false);f.hover(f.normal);f.move();assert.equal(f.visible(),false);f.down();assert.equal(f.visible(),true);});
test('chart wheel is untouched while ordinary held wheel changes only pointer size',()=>{const f=fixture();f.down();const wheel=f.document.fire('wheel',{target:f.normal,deltaY:-1});assert.equal(wheel.prevented,true);f.tick();assert.equal(Number(f.body.children[0].children[0].attrs['stroke-width']),4.6);const chartWheel=f.document.fire('wheel',{target:f.blocked,deltaY:1});assert.equal(chartWheel.prevented,undefined);assert.equal(f.frames.size,0);});
test('touch, stylus, coarse pointer, reduced motion, and scrollbar cannot start animation',()=>{for(const opts of [{fine:false},{reduced:true}]){const f=fixture(opts);f.down();assert.equal(f.frames.size,0);}for(const extra of [{pointerType:'touch'},{pointerType:'pen'},{clientX:1000},{clientY:800},{button:2}]){const f=fixture();f.down(f.normal,extra);assert.equal(f.frames.size,0);}});
test('cancel, blur, page hide, window exit, lost button and text selection each stop frames',()=>{
  for(const action of [f=>f.window.fire('pointercancel'),f=>f.window.fire('blur'),f=>f.window.fire('pagehide'),f=>f.document.fire('pointerout',{relatedTarget:null}),f=>f.move(f.normal,{buttons:0}),f=>{f.select(true);f.document.fire('selectionchange');},f=>{f.document.hidden=true;f.document.fire('visibilitychange');}]){const f=fixture();f.down();action(f);assert.equal(f.frames.size,0);assert.equal(f.visible(),false);}
});
function carouselFixture(count) {
  const f=fixture(),track=new f.Target(),previous=new f.Target(),next=new f.Target(),page=new f.Target(),section=new f.Target();
  const cards=Array.from({length:count},()=>Object.assign(new f.Target(),{hidden:false,getBoundingClientRect:()=>({width:920/3})}));
  track.clientWidth=960;track.scrollLeft=0;track.scrollWidth=Math.max(960,count*(920/3+20)-20);
  track.querySelectorAll=()=>cards;track.classList={add(){},remove(){}};
  let capture=false;track.setPointerCapture=()=>capture=true;track.hasPointerCapture=()=>capture;track.releasePointerCapture=()=>capture=false;
  track.scrollBy=({left})=>track.scrollLeft=Math.max(0,Math.min(track.scrollWidth-960,track.scrollLeft+left));
  section.querySelector=k=>({track,previous,next,page}[k]);
  f.window.getComputedStyle=()=>({columnGap:'20px'});f.window.setTimeout=()=>1;f.window.clearTimeout=()=>{};
  class Observer {observe(){}disconnect(){this.disconnected=true;}}
  f.window.ResizeObserver=Observer;f.context.ResizeObserver=Observer;f.context.MutationObserver=Observer;
  const options={track:'track',previous:'previous',next:'next',page:'page',card:'card'};
  const api=f.window.SiteInteractions.carousel(section,options);
  function sync(){api.refresh();for(const [n,fn] of [...f.frames]){f.frames.delete(n);fn(16);}}
  sync();return {...f,track,previous,next,page,section,cards,api,options,sync};
}
test('carousel handles zero and one card without enabled movement buttons',()=>{for(const count of [0,1]){const f=carouselFixture(count);assert.equal(f.previous.disabled,true);assert.equal(f.next.disabled,true);assert.equal(f.page.textContent,count?'1 / 1':'0 / 0');}});
test('carousel advances by viewport pages and reports partial final page correctly',()=>{const f=carouselFixture(10);assert.equal(f.page.textContent,'1 / 4');for(let i=0;i<3;i++){f.next.fire('click');f.sync();}assert.equal(f.page.textContent,'4 / 4');assert.equal(f.next.disabled,true);assert.equal(f.previous.disabled,false);f.previous.fire('click');f.sync();assert.equal(f.next.disabled,false);});
test('carousel only suppresses a dragged card click, preserving ordinary links',()=>{const f=carouselFixture(10);f.track.fire('pointerdown',{target:f.cards[0]});f.track.fire('pointerup');assert.equal(f.track.fire('click').prevented,undefined);f.track.fire('pointerdown',{target:f.cards[0],clientX:200});f.track.fire('pointermove',{target:f.cards[0],clientX:180});f.track.fire('pointerup');assert.equal(f.track.fire('click').prevented,true);assert.equal(f.track.fire('click').prevented,undefined);});
test('reinitialization is idempotent and replacing a report removes global handlers',()=>{const f=carouselFixture(10);assert.equal(f.window.SiteInteractions.carousel(f.section,f.options),f.api);assert.equal(f.track.listeners.pointerdown.length,1);assert.equal(f.window.listeners.pointerup.length,2);f.api.destroy();assert.equal(f.window.listeners.pointerup.length,1);assert.equal(f.frames.size,0);});
