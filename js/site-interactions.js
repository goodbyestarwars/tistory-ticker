/* Shared local-only pointer and carousel interactions. No data requests. */
(function (global) {
  'use strict';
  if (global.SiteInteractions) return;
  var excluded = '[data-no-pointer-effect],[data-drag-ready],[draggable="true"],[role="scrollbar"],canvas,iframe,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[role="slider"],.ss-chart,[class$="-chart"],[class*="-chart-"],[id*="Chart"],.ss-lw-chart-root,.de-chart-overlay,.de-chart-modal,.dmi-chart,.ff-chart,.kf-chart,[class*="drawing-layer"],[class*="chart-tools"],[class*="carousel"],[class*="slider"],.learn-card-grid,.learn-track,.learn-grid,.dcf-table-wrap';
  function selectionActive() { var s = global.getSelection(); return !!(s && !s.isCollapsed); }
  function isExcluded(target) { return !target || !target.closest || !!target.closest(excluded); }
  function scrollbar(event) {
    if(event.clientX>=document.documentElement.clientWidth||event.clientY>=document.documentElement.clientHeight)return true;
    var el=event.target;
    if(!el||!el.getBoundingClientRect)return false;
    // Only measure a scrollable element with a real scrollbar gutter.
    var vertical=el.scrollHeight>el.clientHeight&&el.offsetWidth-el.clientWidth>2;
    var horizontal=el.scrollWidth>el.clientWidth&&el.offsetHeight-el.clientHeight>2;
    if(!vertical&&!horizontal)return false;
    var rect=el.getBoundingClientRect();
    return (vertical&&event.clientX>=rect.left+el.clientLeft+el.clientWidth)||(horizontal&&event.clientY>=rect.top+el.clientTop+el.clientHeight);
  }
  function initPointer() {
    if (document.querySelector('[data-site-pointer]')) return;
    var fine = global.matchMedia('(hover: hover) and (pointer: fine)');
    var reduced = global.matchMedia('(prefers-reduced-motion: reduce)');
    var ns = 'http://www.w3.org/2000/svg', pointer = document.createElementNS(ns, 'svg');
    pointer.setAttribute('data-site-pointer', ''); pointer.setAttribute('aria-hidden', 'true');
    pointer.setAttribute('class', 'site-press-pointer');
    pointer.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2147483000;pointer-events:none;overflow:hidden;visibility:hidden';
    var trail = document.createElementNS(ns, 'path');
    trail.setAttribute('fill', 'none'); trail.setAttribute('stroke', '#d24f45');
    trail.setAttribute('stroke-linecap', 'round'); trail.setAttribute('stroke-linejoin', 'round');
    pointer.appendChild(trail); document.body.appendChild(pointer);
    var held = false, size = 40, points = [], head = { x:0,y:0 }, frame = 0, lastTime = 0;
    function hide() {
      held = false; global.cancelAnimationFrame(frame); frame = 0; lastTime = 0;
      trail.removeAttribute('d'); pointer.style.visibility = 'hidden';
    }
    function draw(time) {
      frame = 0;
      if (!held || document.hidden) return;
      var delta = lastTime ? Math.min(40,time-lastTime) : 16; lastTime = time;
      var follow = 1-Math.exp(-delta/(size*.65)); points[0] = {x:head.x,y:head.y};
      for (var i=1;i<points.length;i++) {
        points[i].x += (points[i-1].x-points[i].x)*follow;
        points[i].y += (points[i-1].y-points[i].y)*follow;
      }
      var d='M '+head.x+' '+head.y;
      for(var j=1;j<points.length-1;j++) d+=' Q '+points[j].x+' '+points[j].y+' '+((points[j].x+points[j+1].x)/2)+' '+((points[j].y+points[j+1].y)/2);
      var tail=points[points.length-1]; trail.setAttribute('d',d+' L '+tail.x+' '+tail.y);
      trail.setAttribute('stroke-width',Math.max(2,size/10)); frame=global.requestAnimationFrame(draw);
    }
    document.addEventListener('pointerdown',function(event) {
      hide();
      if(event.pointerType!=='mouse'||event.button!==0||!fine.matches||reduced.matches||document.hidden||scrollbar(event)||isExcluded(event.target)||selectionActive())return;
      held=true; head={x:event.clientX,y:event.clientY};
      points=Array.from({length:16},function(){return {x:head.x,y:head.y};});
      pointer.style.visibility='visible'; frame=global.requestAnimationFrame(draw);
    },{passive:true,capture:true});
    document.addEventListener('pointermove',function(event) {
      if(!held)return;
      // Hit-test the actual hovered element even when another widget has capture.
      if(event.pointerType!=='mouse'||!(event.buttons&1)||scrollbar(event)||isExcluded(event.target)||isExcluded(document.elementFromPoint(event.clientX,event.clientY))||selectionActive()){hide();return;}
      head.x=event.clientX; head.y=event.clientY;
    },{passive:true,capture:true});
    global.addEventListener('pointerup',hide,true); global.addEventListener('pointercancel',hide,true);
    global.addEventListener('blur',hide); global.addEventListener('pagehide',hide);
    document.addEventListener('pointerout',function(e){if(!e.relatedTarget)hide();},{passive:true});
    document.addEventListener('selectionchange',function(){if(held&&selectionActive())hide();});
    document.addEventListener('visibilitychange',function(){if(document.hidden)hide();});
    fine.addEventListener('change',hide); reduced.addEventListener('change',hide);
    document.addEventListener('wheel',function(event) {
      if(!held)return;
      if(isExcluded(event.target)||scrollbar(event)||selectionActive()){hide();return;}
      if(event.deltaY){event.preventDefault();size=Math.max(20,Math.min(96,size+(event.deltaY<0?6:-6)));}
    },{passive:false,capture:true});
  }
  var carousels = new WeakMap();
  function carousel(section,options) {
    if(carousels.has(section))return carousels.get(section);
    var track=section.querySelector(options.track),previous=section.querySelector(options.previous),next=section.querySelector(options.next);
    if(!track||!previous||!next)return null;
    track.setAttribute('data-no-pointer-effect','');
    var progress=options.progress&&section.querySelector(options.progress),page=options.page&&section.querySelector(options.page);
    var drag=null,suppressClick=false,clearClick=0,frame=0;
    function sync() {
      var cards=Array.from(track.querySelectorAll(options.card)).filter(function(c){return !c.hidden;});
      var max=Math.max(0,track.scrollWidth-track.clientWidth);
      previous.disabled=max<=1||track.scrollLeft<=1;next.disabled=max<=1||track.scrollLeft>=max-1;
      if(progress){progress.disabled=max<=1;progress.value=max?Math.round(track.scrollLeft/max*1000):0;}
      if(page){
        var width=cards.length?cards[0].getBoundingClientRect().width:track.clientWidth;
        var gap=parseFloat(global.getComputedStyle(track).columnGap)||0;
        var per=Math.max(1,Math.floor((track.clientWidth+gap+1)/(width+gap)));
        var total=Math.ceil(cards.length/per),current=total?Math.min(total,Math.round(track.scrollLeft/((width+gap)*per))+1):0;
        if(max>1&&track.scrollLeft>=max-1)current=total;
        page.textContent=current+' / '+total;
      }
    }
    function requestSync(){if(!frame)frame=global.requestAnimationFrame(function(){frame=0;sync();});}
    function move(direction) {
      var card=Array.from(track.querySelectorAll(options.card)).find(function(c){return !c.hidden;});
      var gap=parseFloat(global.getComputedStyle(track).columnGap)||0;
      var step=card?card.getBoundingClientRect().width+gap:track.clientWidth;
      if(options.page)step*=Math.max(1,Math.floor((track.clientWidth+gap+1)/step));
      track.scrollBy({left:direction*step,behavior:global.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    }
    previous.addEventListener('click',function(){move(-1);});next.addEventListener('click',function(){move(1);});
    if(progress)progress.addEventListener('input',function(){track.scrollLeft=Math.max(0,track.scrollWidth-track.clientWidth)*Number(progress.value)/1000;});
    track.addEventListener('scroll',requestSync,{passive:true});
    track.addEventListener('keydown',function(event) {
      if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.target.closest('input,textarea,select'))return;
      event.preventDefault();move(event.key==='ArrowLeft'?-1:1);
    });
    track.addEventListener('pointerdown',function(event) {
      if(event.pointerType!=='mouse'||event.button!==0||event.target.closest('button,input'))return;
      global.clearTimeout(clearClick);suppressClick=false;
      drag={id:event.pointerId,x:event.clientX,scroll:track.scrollLeft,moved:false};
    });
    track.addEventListener('pointermove',function(event) {
      if(!drag||drag.id!==event.pointerId)return;
      if(!(event.buttons&1)){finishDrag();return;}
      var delta=event.clientX-drag.x;
      if(!drag.moved&&Math.abs(delta)>6){drag.moved=true;track.setPointerCapture(event.pointerId);track.classList.add('is-dragging');}
      if(drag.moved){event.preventDefault();track.scrollLeft=drag.scroll-delta;}
    });
    function finishDrag(){
      if(!drag)return;
      var completed=drag;drag=null;suppressClick=completed.moved;
      if(track.hasPointerCapture(completed.id))track.releasePointerCapture(completed.id);
      track.classList.remove('is-dragging');
      clearClick=global.setTimeout(function(){suppressClick=false;},0);
    }
    track.addEventListener('pointerup',finishDrag);track.addEventListener('pointercancel',finishDrag);
    track.addEventListener('lostpointercapture',finishDrag);
    track.addEventListener('pointerleave',function(){if(drag&&!drag.moved)finishDrag();});
    // Per-widget global listeners are removed when its report DOM is replaced.
    global.addEventListener('pointerup',finishDrag);global.addEventListener('blur',finishDrag);
    track.addEventListener('click',function(event){if(suppressClick){suppressClick=false;event.preventDefault();event.stopPropagation();}},true);
    track.addEventListener('dragstart',function(event){event.preventDefault();});
    var resize=global.ResizeObserver?new ResizeObserver(requestSync):null;
    if(resize)resize.observe(track);else global.addEventListener('resize',requestSync);
    var changes=new MutationObserver(function(){track.scrollLeft=0;requestSync();});
    changes.observe(track,{subtree:true,attributes:true,attributeFilter:['hidden']});
    var api={refresh:requestSync,destroy:function(){
      finishDrag();global.clearTimeout(clearClick);global.cancelAnimationFrame(frame);
      global.removeEventListener('pointerup',finishDrag);global.removeEventListener('blur',finishDrag);
      global.removeEventListener('resize',requestSync);if(resize)resize.disconnect();changes.disconnect();carousels.delete(section);
    }};
    carousels.set(section,api);sync();return api;
  }
  global.SiteInteractions={carousel:carousel,isExcluded:isExcluded};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPointer,{once:true});else initPointer();
})(window);
