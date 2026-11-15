/* US major-cap heatmap. One cached KIS market-cap ranking bootstrap, then
 * authenticated broker WebSocket ticks only; no periodic REST price polling.
 * ETF membership is deliberately NOT inferred from a KIS market-cap ranking.
 */
(function (global) {
  'use strict';
  if (global.NineUsHeatmap) return;
  var API = 'https://goodbyestar.cloud';
  var MAX_LIVE = 24; // don't contend with the shared KIS session for hundreds of subscriptions
  var host = null, socket = null, retry = null, ping = null, paintTimer = null;
  var rows = [], byCode = {}, filter = 'ALL', viewSeq = 0, lastTickAt = 0;
  var sourceAt = '', busy = null, ready = false, initiated = false;
  var invalidSymbols = /^(SPY|QQQ|QQQM|IVV|VTI|VOO|DIA|IWM|VT|VUG|VTV|XLK|XLF|XLE|XLY|XLI|XLV|XLP|XLU|XLB|XLC)$/;
  function num(value) { if (value == null || value === '') return NaN; var n = Number(value); return isFinite(n) ? n : NaN; }
  function cleanSymbol(row) {
    var raw = String(row && (row.symbol || row.code) || '').toUpperCase().replace(/^US:/, '');
    return /^[A-Z][A-Z.]{0,7}$/.test(raw) && !invalidSymbols.test(raw) ? raw : '';
  }
  function cleanExchange(raw) {
    var x = String(raw || '').toUpperCase();
    return /^(NAS|NMS|ND|NASDAQ|DNAS)$/.test(x) ? 'NAS'
      : /^(NYS|NY|NYSE|DNYS)$/.test(x) ? 'NYS' : 'OTHER';
  }
  function formatCap(value) {
    var n = num(value);
    if (!(n > 0)) return '시총 미확인';
    // KIS overseas market-cap ranking's market_cap is in MILLION USD.
    return n >= 1000000 ? '$' + (n / 1000000).toFixed(2) + '조'
      : '$' + (n / 1000).toFixed(1) + '십억';
  }
  function formatPrice(v) {
    return num(v) > 0 ? '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) : '가격 미확인';
  }
  function formatRate(v) {
    var n = num(v);
    return isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : '등락 미확인';
  }
  function alive() {
    return !!(host && host.isConnected && !document.hidden && !host.hidden && !host.closest('[hidden]'));
  }
  function isAdmin() {
    return !!(global.NineAccess && typeof global.NineAccess.isAdmin === 'function' && global.NineAccess.isAdmin());
  }
  function status(message) {
    var node = host && host.querySelector('[data-uh-status]');
    if (node) node.textContent = message;
  }
  function close() {
    clearTimeout(retry);retry = null;
    clearInterval(ping);ping = null;
    if (socket) {
      var old = socket;socket = null;
      old.onclose = null;
      try { old.close(); } catch (err) {}
    }
  }
  function requestPaint() {
    if (paintTimer) return;
    paintTimer = setTimeout(function () {
      paintTimer = null;
      if (alive()) draw();
    }, 350);
  }
  function connect() {
    if (!alive() || !rows.length || socket || !global.WebSocket) return;
    if (!isAdmin()) {
      status('관리자 실시간 권한 필요 · 표시는 최근 KIS 시총순위 조회값(실시간 아님)');
      return;
    }
    status('해외 체결 WebSocket 연결 중 · 시총순위 조회값은 별도');
    var url = 'wss://goodbyestar.cloud/ws/quotes?codes=' +
      rows.map(function (r) {return encodeURIComponent(r.code);}).join(',');
    var current;
    try {current = new WebSocket(url);}
    catch (e) { status('WebSocket 연결 실패 · 실시간 미수신');scheduleRetry();return;}
    socket = current;
    current.onopen = function () {
      if (socket !== current) return;
      status('WebSocket 연결됨 · 실시간 체결 수신 대기');
      clearInterval(ping);
      ping = setInterval(function () {
        if (current.readyState === WebSocket.OPEN) current.send('ping');
      }, 20000);
    };
    current.onmessage = function (event) {
      if (socket !== current) return;
      var payload;
      try {payload=JSON.parse(event.data);} catch (e) {return;}
      if (!payload || payload.type !== 'quote' || !byCode[payload.code]) return;
      var price = num(payload.price);
      var rate = num(payload.changeRate);
      if (!(price > 0)) return;
      var row = byCode[payload.code];
      row.price = price;
      if (isFinite(rate)) row.change_rate = rate;
      row.live = true;
      row.lastSeen = Date.now(); // browser receipt time, NOT broker execution timestamp
      lastTickAt = row.lastSeen;
      status((payload.source || '해외 체결 WebSocket') + ' 수신 · ' +
        new Date(lastTickAt).toLocaleTimeString('ko-KR') + ' · ' +
        rows.filter(function (r) { return r.live; }).length + '/' + rows.length + '종목 WebSocket 수신 확인');
      requestPaint();
    };
    current.onerror = function () { try { current.close(); } catch (err) {} };
    current.onclose = function () {
      if (socket !== current) return;
      clearInterval(ping); ping=null; socket=null;
      status('해외 WebSocket 끊김 · 기존 표시값은 실시간 아님');
      scheduleRetry();
    };
  }
  function scheduleRetry() {
    if (retry || !alive() || !isAdmin()) return;
    retry = setTimeout(function () {retry=null;connect();}, 9000);
  }
  function layout(ordered, x, y, w, h, output) {
    if (!ordered.length) return;
    if (ordered.length === 1) {output.push({row:ordered[0],x:x,y:y,w:w,h:h});return;}
    var total = ordered.reduce(function (sum, r) {return sum + r.market_cap;},0);
    var leftSum=0, pivot=1, nearest=Infinity;
    for (var i=1;i<ordered.length;i++) {
      leftSum+=ordered[i-1].market_cap;
      var d=Math.abs(leftSum/total - .5);
      if (d<nearest){nearest=d;pivot=i;} else if(i>2)break;
    }
    var a=ordered.slice(0,pivot), b=ordered.slice(pivot);
    var sumA=a.reduce(function(sum,r){return sum+r.market_cap;},0);
    var portion=Math.max(.08,Math.min(.92,sumA/total));
    if(w>=h) {
      var cut=w*portion;
      layout(a,x,y,cut,h,output);
      layout(b,x+cut,y,w-cut,h,output);
    } else {
      var cutY=h*portion;
      layout(a,x,y,w,cutY,output);
      layout(b,x,y+cutY,w,h-cutY,output);
    }
  }
  function filtered() {
    return rows.filter(function (r) {return filter==='ALL'||r.exchange===filter;});
  }
  function isCurrent(r) {return !!(r.live && socket && socket.readyState === 1 && Date.now()-r.lastSeen < 90000);}
  function draw() {
    if (!host) return;
    var chart = host.querySelector('[data-uh-tiles]');
    var table = host.querySelector('[data-uh-rows]');
    if (!chart || !table) return;
    var items = filtered();
    var width = Math.max(300, chart.clientWidth || host.clientWidth || 700);
    var height = width<580?420:520;
    chart.style.height=height+'px';
    chart.textContent='';table.textContent='';
    var rects=[];
    layout(items,0,0,width,height,rects);
    rects.forEach(function (box) {
      var r=box.row, node=document.createElement('a');
      var rate=num(r.change_rate);
      node.className='uh-tile ' + (!isFinite(rate)?'uh-flat':rate>0?'uh-up':rate<0?'uh-down':'uh-flat');
      node.href='/page/stock-search?code='+encodeURIComponent(r.code);
      node.style.left=box.x.toFixed(2)+'px';
      node.style.top=box.y.toFixed(2)+'px';
      node.style.width=Math.max(0,box.w).toFixed(2)+'px';
      node.style.height=Math.max(0,box.h).toFixed(2)+'px';
      node.style.setProperty('--uh-strength', Math.round(Math.min(.68, Math.max(.25,Math.abs(rate||0)/10))*100)+'%');
      node.setAttribute('aria-label',r.name+' '+formatRate(r.change_rate)+' · 시총 '+formatCap(r.market_cap)+
        (isCurrent(r)?' · WebSocket 체결 수신':r.lastSeen?' · 마지막 WebSocket 수신값':' · 순위 조회값'));
      if (box.w>58 && box.h>32) {
        var sym=document.createElement('strong');
        sym.textContent=r.symbol;node.appendChild(sym);
      }
      if (box.w>100 && box.h>58) {
        var title=document.createElement('span');title.className='uh-name';title.textContent=r.name;node.appendChild(title);
      }
      if (box.w>66 && box.h>75) {
        var pct=document.createElement('b');pct.textContent=formatRate(r.change_rate);node.appendChild(pct);
      }
      if (box.w>114 && box.h>110) {
        var cap=document.createElement('small');cap.textContent=formatCap(r.market_cap);node.appendChild(cap);
      }
      chart.appendChild(node);
    });
    items.forEach(function(r){
      var tr=document.createElement('tr');
      var cells=[r.symbol,r.name,formatCap(r.market_cap),formatPrice(r.price),formatRate(r.change_rate),isCurrent(r)?'WebSocket 수신':r.lastSeen?'마지막 WS 수신값':'순위 조회값'];
      cells.forEach(function(val,i){
        var td=document.createElement('td');
        if(i===0){var a=document.createElement('a');a.href='/page/stock-search?code='+encodeURIComponent(r.code);a.textContent=val;td.appendChild(a);}
        else td.textContent=val;
        if(i===4){td.className='uh-rate '+(num(r.change_rate)>0?'is-up':num(r.change_rate)<0?'is-down':'');}
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    var count=host.querySelector('[data-uh-count]');
    if(count)count.textContent=items.length+'종목 · 전체 시총의 일부 표본';
  }
  function load() {
    if (busy) return busy;
    status('KIS 미국 시가총액 순위 확인 중');
    busy=global.NineHttp.json(API+'/market-board?market=us&limit=40',{timeoutMs:25000})
      .then(function(response){
        var result=response&&response.data||response;
        var ranked=result&&result.sections&&result.sections.marketCap;
        if (!Array.isArray(ranked)||!ranked.length) throw new Error('KIS 미국 시총순위 없음');
        var seen={};
        rows=ranked.map(function(item) {
          var sym=cleanSymbol(item), cap=num(item&&item.market_cap);
          if(!sym||seen[sym]||!(cap>0)||/ETF|ETN|INDEX FUND/i.test(String(item.name||item.name_en||'')))return null;
          seen[sym]=true;
          return {symbol:sym,code:'US:'+sym,name:String(item.name_ko||item.name||item.name_en||sym),
            exchange:cleanExchange(item.exchange),price:num(item.price),change_rate:num(item.change_rate),
            market_cap:cap,live:false,lastSeen:0};
        }).filter(Boolean).sort(function(a,b){return b.market_cap-a.market_cap;}).slice(0,MAX_LIVE);
        if(!rows.length)throw new Error('미국 시가총액 유효값 없음');
        byCode={};rows.forEach(function(r){byCode[r.code]=r;});
        sourceAt=result.updated_at?new Date(Number(result.updated_at)*1000).toLocaleString('ko-KR'):'조회시각 미제공';
        var source=host&&host.querySelector('[data-uh-source]');
        if(source)source.textContent='종목·시총: '+(result.source||'KIS 미국 시총 순위')+
          ' · 조회 '+sourceAt+' · 3개 거래소 상위40건/거래소에서 시총 상위 최대'+MAX_LIVE+'종목을 선정';
        draw();connect();
      })
      .catch(function(err){status('미국 시총 데이터 조회 실패 · ' + (err&&err.message||'자료 미수신'));});
    return busy;
  }
  function init(panel) {
    if(!panel)return;
    if(host&&host!==panel) {close();host=null;rows=[];byCode={};busy=null;}
    host=panel;
    if(panel.__usHeatmapReady){resume();return;}
    panel.__usHeatmapReady=true;
    panel.innerHTML='<section class="uh-panel">'
      +'<div class="uh-head"><div><h3>미국 주요 시총 히트맵</h3><p>KIS 미국 시가총액 상위 종목 표본 · 면적은 종목 시총, 색은 등락률</p></div>'
      +'<span class="uh-status" data-uh-status role="status">준비 중</span></div>'
      +'<div class="uh-filters" role="group" aria-label="미국 종목 거래소">'
      +'<button type="button" data-uh-exchange="ALL" class="is-active">전체</button>'
      +'<button type="button" data-uh-exchange="NAS">나스닥</button>'
      +'<button type="button" data-uh-exchange="NYS">뉴욕증권거래소</button></div>'
      +'<div class="uh-count" data-uh-count></div>'
      +'<div class="uh-tiles" data-uh-tiles aria-label="미국 종목 시총비례 히트맵"></div>'
      +'<p class="uh-source" data-uh-source>구성종목·시총: KIS 미국 순위 캐시 / 가격: 관리자 KIS 해외 체결 WebSocket</p>'
      +'<p class="uh-disclaimer">ETF 보유종목 또는 S&P 500·나스닥100 공식 구성종목 전체가 아닙니다. 시총·최초 가격은 순위 조회값이며 WebSocket으로 실제 수신한 종목만 WebSocket 수신 여부를 구분합니다. WebSocket 수신이 거래소 무지연 실시간을 보장하지 않으며 공급자·거래소 권한에 따라 지연될 수 있습니다. 시총 단위는 백만 미국달러(USD)를 변환했습니다.</p>'
      +'<details class="uh-details"><summary>전체 종목·시가총액·수신상태 표 보기</summary><div class="uh-table-scroller"><table class="uh-table"><thead><tr><th>티커</th><th>회사</th><th>시가총액</th><th>가격</th><th>등락률</th><th>상태</th></tr></thead><tbody data-uh-rows></tbody></table></div></details></section>';
    panel.querySelector('.uh-filters').addEventListener('click',function(event){
      var button=event.target.closest('[data-uh-exchange]');if(!button)return;
      filter=button.getAttribute('data-uh-exchange');
      panel.querySelectorAll('[data-uh-exchange]').forEach(function(b){b.classList.toggle('is-active',b===button);});
      draw();
    });
    if(!initiated) {
      initiated=true;
      document.addEventListener('visibilitychange',function(){if(document.hidden)close();else resume();});
      global.addEventListener('resize',function(){if(alive())requestPaint();});
      global.addEventListener('nineaccess:ready',resume);
      global.addEventListener('nineaccess:change',function(){close();resume();});
    }
    load();
  }
  function resume(){if(alive() && rows.length){draw();connect();}}
  function pause(){close();}
  global.NineUsHeatmap={init:init,resume:resume,pause:pause};
})(window);
