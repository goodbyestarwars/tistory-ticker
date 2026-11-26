/* Shared KIS market-cap top100 sector map (KOSPI, KOSDAQ, S&P500).
 * One bootstrap /market-board/sector-top20 request then authenticated
 * /ws/quotes ticks; all cap/sector classification remains snapshot-based.
 * S&P constituents are verified server-side against a dated public index list.
 */
(function (global) {
  'use strict';
  var API='https://goodbyestar.cloud';
  var MAX=100, WS_MAX=20, active=null, retry=null, heartbeat=null, paintTimer=null;
  var SECTOR_KO={'Information Technology':'정보기술','Communication Services':'커뮤니케이션','Consumer Discretionary':'경기소비재','Consumer Staples':'필수소비재','Financials':'금융','Health Care':'헬스케어','Industrials':'산업재','Energy':'에너지','Materials':'소재','Utilities':'유틸리티','Real Estate':'부동산'};
  function number(x){if(x==null||x==='')return NaN;var v=Number(x);return isFinite(v)?v:NaN;}
  function label(m){return m==='kosdaq'?'코스닥':m==='sp500'?'S&P 500':'코스피';}
  function currency(m,cap) {
    var v=number(cap);
    if(!(v>0))return '시총 미확인';
    if(m==='sp500')return v>=1000000?'$'+(v/1000000).toFixed(2)+'조':'$'+(v/1000).toFixed(1)+'십억';
    return v>=10000?(v/10000).toFixed(2)+'조원':v.toLocaleString('ko-KR',{maximumFractionDigits:0})+'억원';
  }
  function price(m,p){var v=number(p);return v>0?(m==='sp500'?'$'+v.toFixed(2):v.toLocaleString('ko-KR')+'원'):'가격 미확인';}
  function pct(v){var n=number(v);return isFinite(n)?(n>0?'+':'')+n.toFixed(2)+'%':'등락 미확인';}
  function isAdmin(){return !!(global.NineAccess&&global.NineAccess.isAdmin&&global.NineAccess.isAdmin());}
  function visible(){
    return active&&active.panel.isConnected&&!document.hidden&&!active.panel.hidden&&!active.panel.closest('[hidden]');
  }
  function stateText(t){var el=active&&active.panel.querySelector('[data-uh-status]');if(el)el.textContent=t;}
  function disconnect(){
    clearTimeout(retry);retry=null;clearInterval(heartbeat);heartbeat=null;
    var ws=active&&active.socket;
    if(active)active.socket=null;
    if(ws){ws.onclose=null;try{ws.close();}catch(e){}}
  }
  function pause(){disconnect();}
  function scheduleDraw(){
    if(paintTimer)return;
    paintTimer=setTimeout(function(){paintTimer=null;if(visible())draw();},220);
  }
  function connect(){
    if(!visible()||!isAdmin()||!active.rows.length||active.socket||!global.WebSocket)return;
    var market=active.market,codes=active.rows.slice(0,WS_MAX).map(function(x){return encodeURIComponent(x.code);});
    var socket;
    try{socket=new WebSocket('wss://goodbyestar.cloud/ws/quotes?codes='+codes.join(','));}
    catch(e){stateText('WebSocket 접속 실패');reconnect();return;}
    active.socket=socket;
    var owner=active;
    stateText('KIS WebSocket 연결 중 · 시총 상위 최대20종목 수신 대기 · 나머지는 조회값');
    socket.onopen=function(){
      if(active!==owner||owner.socket!==socket)return;
      clearInterval(heartbeat);
      heartbeat=setInterval(function(){if(socket.readyState===1)socket.send('ping');},20000);
    };
    socket.onmessage=function(event){
      if(active!==owner||owner.socket!==socket)return;
      var msg;
      try{msg=JSON.parse(event.data);}catch(e){return;}
      if(!msg||msg.type!=='quote')return;
      var row=owner.byCode[msg.code],p=number(msg.price),r=number(msg.changeRate);
      if(!row||!(p>0))return;
      row.price=p;if(isFinite(r))row.change_rate=r;
      row.lastSeen=Date.now();row.source=String(msg.source||'WebSocket');
      stateText('WebSocket 체결 수신 '+new Date(row.lastSeen).toLocaleTimeString('ko-KR')+
        ' · 확인 '+owner.rows.filter(function(a){return isCurrent(a);}).length+'/'+Math.min(WS_MAX,owner.rows.length)+'종목 · 나머지는 조회값');
      scheduleDraw();
    };
    socket.onerror=function(){try{socket.close();}catch(e){}};
    socket.onclose=function(){
      if(active!==owner||owner.socket!==socket)return;
      owner.socket=null;clearInterval(heartbeat);heartbeat=null;
      stateText('연결 끊김 · 조회값 또는 마지막 WS 수신값 표시');
      reconnect();
    };
  }
  function reconnect(){
    if(retry||!visible()||!isAdmin())return;
    retry=setTimeout(function(){retry=null;connect();},9500);
  }
  function isCurrent(row){
    return !!(active&&active.socket&&active.socket.readyState===1&&row.lastSeen&&Date.now()-row.lastSeen<90000);
  }
  function treemap(items,x,y,w,h,out){
    if(!items.length||w<=0||h<=0)return;
    if(items.length===1){out.push({item:items[0],x:x,y:y,w:w,h:h});return;}
    var total=items.reduce(function(sum,a){return sum+a.cap;},0),half=0,split=1,near=Infinity;
    for(var i=1;i<items.length;i++){
      half+=items[i-1].cap;
      var diff=Math.abs(half/total-.5);
      if(diff<near){near=diff;split=i;} else if(i>2)break;
    }
    var a=items.slice(0,split),b=items.slice(split);
    var weight=a.reduce(function(sum,r){return sum+r.cap;},0)/total;
    if(w>=h){
      var cut=w*weight;treemap(a,x,y,cut,h,out);treemap(b,x+cut,y,w-cut,h,out);
    }else{
      var cutY=h*weight;treemap(a,x,y,w,cutY,out);treemap(b,x,y+cutY,w,h-cutY,out);
    }
  }
  function draw(){
    if(!active||!active.panel)return;
    var root=active.panel,chart=root.querySelector('[data-uh-tiles]'),tbody=root.querySelector('[data-uh-rows]');
    if(!chart||!tbody)return;
    chart.replaceChildren();
    var w=Math.max(300,Math.round(chart.clientWidth||root.clientWidth||720)),h=w<580?680:780;
    chart.style.height=h+'px';
    var groups={},rows=active.rows;
    rows.forEach(function(r){
      var sector=r.sector||'업종 미분류';
      (groups[sector]=groups[sector]||[]).push(r);
    });
    var areas=Object.keys(groups).map(function(key){
      return {sector:key,items:groups[key],cap:groups[key].reduce(function(sum,r){return sum+r.cap;},0)};
    }).sort(function(a,b){return b.cap-a.cap;});
    var layout=[];treemap(areas,0,0,w,h,layout);
    layout.forEach(function(group){
      var sector=group.item,space=document.createElement('section');
      space.className='uh-sector';
      Object.assign(space.style,{left:group.x.toFixed(1)+'px',top:group.y.toFixed(1)+'px',
        width:group.w.toFixed(1)+'px',height:group.h.toFixed(1)+'px'});
      var title=document.createElement('span');title.className='uh-sector-title';
      title.textContent=sector.sector;space.appendChild(title);
      var head=group.h>=76?22:0;
      var cells=[];
      var items=sector.items.slice().sort(function(a,b){return b.cap-a.cap;});
      treemap(items,0,head,Math.max(group.w-3,1),Math.max(group.h-head-3,1),cells);
      cells.forEach(function(cell){
        var row=cell.item,up=number(row.change_rate),tile=document.createElement('a');
        tile.className='uh-tile '+(up>0?'uh-up':up<0?'uh-down':'uh-flat');
        tile.href='/page/stock-search?code='+encodeURIComponent(row.code);
        Object.assign(tile.style,{left:cell.x.toFixed(1)+'px',top:cell.y.toFixed(1)+'px',
          width:cell.w.toFixed(1)+'px',height:cell.h.toFixed(1)+'px'});
        tile.style.setProperty('--uh-strength',Math.round(Math.min(.68,Math.max(.25,Math.abs(up||0)/10))*100)+'%');
        var fullLabel=row.name+' '+pct(row.change_rate)+' '+currency(active.market,row.cap);
        tile.setAttribute('aria-label',fullLabel);tile.title=fullLabel;
        if(cell.w>58&&cell.h>28){
          var title=document.createElement('strong');title.textContent=active.market==='sp500'?row.symbol:row.name;tile.appendChild(title);
        }
        if(cell.w>75&&cell.h>63&&active.market==='sp500'){
          var name=document.createElement('span');name.className='uh-name';name.textContent=row.name;tile.appendChild(name);
        }
        if(cell.w>65&&cell.h>62){
          var rate=document.createElement('b');rate.textContent=pct(row.change_rate);tile.appendChild(rate);
        }
        if(cell.w>105&&cell.h>95){
          var cap=document.createElement('small');cap.textContent=currency(active.market,row.cap);tile.appendChild(cap);
        }
        space.appendChild(tile);
      });
      chart.appendChild(space);
    });
    drawTable(tbody, rows, active.market);
    var count=root.querySelector('[data-uh-count]');
    if(count)count.textContent=label(active.market)+' '+rows.length+'종목 · '+areas.length+'개 섹터';
  }
  function drawTable(tbody, rows, market) {
    // Rows are cleared only when the market changes. Quotes update the existing
    // cells so the scroll position and focused stock link survive each redraw.
    rows.forEach(function (row, index) {
      var tr = tbody.rows[index];
      if (!tr) {
        tr = tbody.insertRow();
        var link = document.createElement('a');
        link.href = '/page/stock-search?code=' + encodeURIComponent(row.code);
        link.textContent = row.symbol || row.code;
        tr.insertCell().appendChild(link);
        [row.name, row.sector, currency(market, row.cap)].forEach(function (value) {
          tr.insertCell().textContent = value;
        });
        for (var i = 0; i < 3; i++) tr.insertCell();
      }
      var rate = number(row.change_rate);
      var values = [price(market, row.price), pct(rate), isCurrent(row) ? 'WS 수신' : row.lastSeen ? '마지막 WS' : '조회값'];
      values.forEach(function (value, offset) {
        var cell = tr.cells[4 + offset];
        if (cell.textContent !== value) cell.textContent = value;
      });
      var rateClass = rate > 0 ? 'is-up' : rate < 0 ? 'is-down' : '';
      if (tr.cells[5].className !== rateClass) tr.cells[5].className = rateClass;
    });
  }
  function load(market){
    disconnect();
    var owner=active,id=++owner.seq;
    owner.market=market;owner.rows=[];owner.byCode={};
    var chart=owner.panel.querySelector('[data-uh-tiles]');
    var table=owner.panel.querySelector('[data-uh-rows]');
    if(chart)chart.replaceChildren();if(table)table.replaceChildren();
    ['[data-uh-count]','[data-uh-source]','[data-uh-disclaimer]'].forEach(function(k){var el=owner.panel.querySelector(k);if(el)el.textContent='';});
    stateText(label(market)+' 시총순위 확인 중');
    var buttonWrap=owner.panel.querySelector('[data-uh-select]');
    if(buttonWrap)buttonWrap.querySelectorAll('button').forEach(function(b){
      b.classList.toggle('is-active',b.getAttribute('data-mkt')===market);
    });
    return global.NineHttp.json(API+'/market-board/sector-top20?market='+encodeURIComponent(market)+'&limit=100',{timeoutMs:26000})
      .then(function(payload){
        if(active!==owner||id!==owner.seq)return;
        var data=payload&&payload.data||payload;
        var raw=data&&data.rows;
        if(!Array.isArray(raw)||!raw.length)throw Error('시총순위 응답 없음');
        var seen={};
        owner.rows=raw.filter(function(r){
          var key=String(r.code||''),cap=number(r.market_cap);
          if(!key||seen[key]||!(cap>0))return false;
          seen[key]=true;return true;
        }).sort(function(a,b){return number(b.market_cap)-number(a.market_cap);}).slice(0,MAX).map(function(r){
          return {code:String(r.code),symbol:String(r.symbol||r.code).replace(/^US:/,''),
            name:String(r.name_ko||r.name||r.symbol||r.code),sector:SECTOR_KO[String(r.sector||'')]||String(r.sector||'업종 미분류'),
            cap:number(r.market_cap),price:number(r.price),change_rate:number(r.change_rate),lastSeen:0};
        });
        if(!owner.rows.length)throw Error('시총 정보 미제공');
        owner.byCode={};owner.rows.forEach(function(r){owner.byCode[r.code]=r;});
        var source=owner.panel.querySelector('[data-uh-source]');
        if(source)source.textContent=(data.source||'KIS 시총순위')+' · '+(data.universe||'검증 가능한 조회 표본')+
          ' · 시총 '+(data.market_cap_unit||'단위 미확인')+
          ' · 서버 조회 '+(data.updated_at?new Date(data.updated_at*1000).toLocaleString('ko-KR'):'시각 미확인');
        if(source && market==='sp500' && data.sector_source) {
          var cite=document.createElement('a');
          cite.href=String(data.sector_source);
          cite.target='_blank';cite.rel='noopener noreferrer';
          cite.textContent=' · S&P 500 구성종목·GICS 섹터 원문(Wikipedia, CC BY-SA 4.0)';
          source.appendChild(cite);
        }
        var note=owner.panel.querySelector('[data-uh-disclaimer]');
        if(note)note.textContent=market==='sp500'
          ? 'S&P 500 편입 확인: Wikipedia 목록(GICS 섹터, CC BY-SA 4.0) · '+(data.membership_count||'?')+
            '개 편입 종목 명단과 KIS 거래소별 최대100개 조회 표본 교집합 중 최대100개. S&P 500 전체 시총순위나 공식 지수 가중치가 아닙니다.'
          : 'NAVER '+label(market)+' 보통주 시총순위 상위100(확인된 종목만). WICS 섹터·시총 구역면적 기준, 시장 전체 종목 수와는 다릅니다.';
        if(note)note.textContent+=' 실제 확인 '+owner.rows.length+'/100종목. 면적은 시총, 색은 전일 대비 등락이며 실제 자금 유입·유출액은 아닙니다. WS는 시총 상위 최대20종목만 구독하며 나머지는 조회값입니다.';
        draw();connect();
      }).catch(function(e){
        if(active!==owner||id!==owner.seq)return;
        stateText(label(market)+' 섹터 지도 조회 실패');
        var error=owner.panel.querySelector('[data-uh-count]');
        if(error)error.textContent='확인된 순위 데이터가 없습니다. '+(e&&e.message||'서버 자료 오류');
      });
  }
  function init(panel,kind){
    if(!panel)return;
    disconnect();
    active={panel:panel,kind:kind||'sp500',market:kind==='domestic'?'kospi':/^(kospi|kosdaq)$/.test(kind)?kind:'sp500',
      seq:0,rows:[],byCode:{},socket:null};
    var domestic=kind==='domestic';
    panel.innerHTML='<section class="uh-panel">'
      +'<div class="uh-head"><div><h3>'+(domestic?'국내 시가총액 TOP100':/^(kospi|kosdaq)$/.test(kind)?label(kind)+' 시가총액 TOP100':'S&P 500 표본 시총 TOP100')+'</h3>'
      +'<p>섹터별 구역 · 종목 시총에 비례하는 면적 · 전일 대비 상승 빨강 / 하락 파랑</p></div>'
      +'<span class="uh-status" data-uh-status role="status">준비 중</span></div>'
      +(domestic?'<div class="uh-filters" data-uh-select role="group" aria-label="국내 시장">'
        +'<button type="button" class="is-active" data-mkt="kospi">코스피 TOP100</button>'
        +'<button type="button" data-mkt="kosdaq">코스닥 TOP100</button></div>':'')
      +'<div class="uh-count" data-uh-count></div>'
      +'<div class="uh-tiles" data-uh-tiles aria-label="섹터별 시가총액 히트맵"></div>'
      +'<p class="uh-source" data-uh-source></p>'
      +'<p class="uh-disclaimer" data-uh-disclaimer></p>'
      +'<details class="uh-details"><summary>시가총액·섹터·수신상태 표 보기</summary>'
      +'<div class="uh-table-scroller" tabindex="0" role="region" aria-label="시가총액·섹터·수신상태 표"><table class="uh-table"><thead><tr><th>코드</th><th>회사</th><th>섹터</th><th>시가총액</th><th>가격</th><th>등락률</th><th>상태</th></tr></thead>'
      +'<tbody data-uh-rows></tbody></table></div></details></section>';
    if(domestic)panel.querySelector('[data-uh-select]').addEventListener('click',function(e){
      var b=e.target.closest('[data-mkt]');if(b&&visible())load(b.getAttribute('data-mkt'));
    });
    load(active.market);
  }
  document.addEventListener('visibilitychange',function(){
    if(document.hidden)disconnect();else if(visible())connect();
  });
  global.addEventListener('resize',function(){if(visible())scheduleDraw();});
  global.addEventListener('nineaccess:change',function(){disconnect();if(visible())connect();});
  // Keep the legacy export (the main page loader already refers to it).
  global.NineUsHeatmap={init:init,pause:pause,resume:function(){if(visible())connect();}};
})(window);
