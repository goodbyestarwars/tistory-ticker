/* 9Pay Market Atlas · WICS industry → subgroup → stock. Administrator-only quotes.
   RS axes use verified cached daily closes and matching KOSPI/KOSDAQ benchmark,
   never random placement, custom categories or interpolated/missing returns. */
(function (global) {
  'use strict';

  var PER_SECTOR=24, W=1000, H=560, plot={l:78,t:55,r:950,b:495};
  var REFERENCE_CODES=[
    '005930','000660','035420','005380','000270','068270','207940','373220',
    '105560','055550','051910','012330','009540','010140','086790','000810',
    '066570','035720','096770','259960'
  ];
  function numeric(v) {
    if(v===undefined || v===null || v==='') return null;
    var n=Number(v); return Number.isFinite(n)?n:null;
  }
  function esc(v) { return global.NineUI.escapeHtml(String(v===undefined||v===null?'':v)); }
  function money(v) { return v===null?'—':Math.round(v).toLocaleString('ko-KR'); }
  function pct(v) { return v===null?'—':(v>0?'+':'')+v.toFixed(2)+'%'; }
  function pp(v) { return v===null?'—':(v>0?'+':'')+v.toFixed(2)+'%p'; }
  function capText(v) {
    if(v===null)return '미확인';
    return v>=1e12?(v/1e12).toFixed(1)+'조 원':(v/1e8).toFixed(0)+'억 원';
  }
  function klass(v) {return v===null?'flat':v>0?'up':v<0?'down':'flat';}
  // 기업 사업 소개는 기존 종목분석의 정적 COMPANY_PROFILES 단일 데이터를 재사용한다.
  // 추가 API/수집 없이 이 화면에서 한 번만 지연 로드하고, 실패해도 지도·시세를 막지 않는다.
  var companyProfilesPromise=null;
  function ensureCompanyProfiles(){
    if(global.COMPANY_PROFILES&&global.COMPANY_PROFILES.companies)return Promise.resolve(global.COMPANY_PROFILES);
    if(companyProfilesPromise)return companyProfilesPromise;
    companyProfilesPromise=new Promise(function(resolve,reject){
      var tag=document.createElement('script');
      tag.src='https://goodbyestarwars.github.io/tistory-ticker/data/company-profiles.js';
      tag.async=true;
      tag.onload=function(){
        if(global.COMPANY_PROFILES&&global.COMPANY_PROFILES.companies)resolve(global.COMPANY_PROFILES);
        else reject(new Error('company profiles unavailable'));
      };
      tag.onerror=function(){reject(new Error('company profiles failed to load'));};
      document.head.appendChild(tag);
    }).catch(function(err){companyProfilesPromise=null;throw err;});
    return companyProfilesPromise;
  }
  function businessSummary(state,stock){
    var company=stock&&state.profiles&&state.profiles.companies&&state.profiles.companies[stock.code];
    return company&&typeof company.summary==='string'&&company.summary.trim()||null;
  }
  function businessLine(state,stock){
    var summary=businessSummary(state,stock);
    if(summary)return summary;
    if(state.profileStatus==='loading')return '회사 소개를 불러오는 중입니다.';
    var industry=(stock&&stock.industry)||'업종 미확인';
    return (state.profileStatus==='error'?'회사 소개를 불러오지 못했습니다. ':'사업 소개가 없습니다. ')
      +'확인된 업종: '+industry;
  }
  function loadCompanyDescriptions(state){
    state.profileStatus='loading';
    ensureCompanyProfiles().then(function(data){
      state.profiles=data;
      state.profileStatus='ready';
      draw(state);
    }).catch(function(){
      state.profileStatus='error';
      draw(state);
    });
  }
  function chooseCandidates(wics) {
    var groups=Object.create(null),seen=Object.create(null),picked=[];
    Object.keys(wics||{}).forEach(function(code) {
      var item=wics[code];
      if(!/^[0-9]{6}$/.test(code)||!item||!item.sector||!item.name||seen[code])return;
      seen[code]=true;
      (groups[item.sector]||(groups[item.sector]=[])).push({
        code:code,name:item.name,sector:item.sector,industry:item.industry||'세부 업종 미분류'
      });
    });
    Object.keys(groups).forEach(function(sector){
      var rows=groups[sector],included=Object.create(null),chosen=[];
      function add(item){if(!item||included[item.code]||chosen.length>=PER_SECTOR)return;included[item.code]=true;chosen.push(item);}
      REFERENCE_CODES.forEach(function(code){add(rows.find(function(r){return r.code===code;}));});
      rows.slice(0,12).forEach(add);
      var extra=rows.filter(function(r){return !included[r.code];});
      var places=Math.min(PER_SECTOR-chosen.length,extra.length);
      for(var i=0;i<places;i++)add(extra[Math.floor((i+.5)*extra.length/places)]);
      picked=picked.concat(chosen);
    });
    return picked;
  }
  function getRS(quote,rsPayload) {
    var out={rs1m:null,rs1y:null,rsDate:null};
    var market=quote&&quote.market, benchmark=rsPayload&&rsPayload.benchmarks&&rsPayload.benchmarks[market];
    var dates=rsPayload&&rsPayload.prices&&rsPayload.prices[quote.code];
    if(!benchmark||!dates||!benchmark.asOf)return out;
    var end=numeric(dates[benchmark.asOf]);
    if(end===null||end<=0)return out;
    out.rsDate=benchmark.asOf;
    [['1m','base1m','index1m'],['1y','base1y','index1y']].forEach(function(pair){
      var base=benchmark[pair[1]]&&numeric(dates[benchmark[pair[1]]]),index=numeric(benchmark[pair[2]]);
      if(base!==null&&base>0&&index!==null)out['rs'+pair[0]]=100*(end/base-1)-index;
    });
    return out;
  }
  function toStock(row,quote,rs) {
    if(!quote||numeric(quote.price)===null||numeric(quote.price)<=0)return null;
    var stock={
      code:row.code,name:row.name,sector:row.sector,industry:row.industry,
      market:['KOSPI','KOSDAQ'].indexOf(quote.market)>=0?quote.market:'미분류',
      price:numeric(quote.price),rate:numeric(quote.changeRate),
      cap:numeric(quote.marketCap),volume:numeric(quote.volume),
      amount:numeric(quote.tradeValue),time:quote.time||'',date:quote.dataDate||''
    };
    var strength=getRS(stock,rs);
    stock.rs1m=strength.rs1m;stock.rs1y=strength.rs1y;stock.rsDate=strength.rsDate;
    return stock;
  }
  function stocksOf(state) {
    var byCode=Object.create(null);
    state.quotes.forEach(function(q){if(q&&q.code)byCode[q.code]=q;});
    var term=state.search.trim().toLocaleLowerCase('ko-KR');
    return state.candidates.map(function(row){return toStock(row,byCode[row.code],state.rs);})
      .filter(function(stock){
        if(!stock||state.market!=='ALL'&&stock.market!==state.market)return false;
        if(state.sector&&stock.sector!==state.sector)return false;
        if(state.industry&&stock.industry!==state.industry)return false;
        if(!term)return true;
        return [stock.name,stock.code,stock.sector,stock.industry].join(' ').toLocaleLowerCase('ko-KR').includes(term);
      });
  }
  function grouped(state) {
    var map=Object.create(null);
    stocksOf(state).forEach(function(stock){
      (map[stock.sector]||(map[stock.sector]=[])).push(stock);
    });
    return Object.keys(map).map(function(sector){
      var rows=map[sector],known=rows.filter(function(r){return r.rate!==null;});
      return {sector:sector,rows:rows,avg:known.length?known.reduce(function(t,r){return t+r.rate;},0)/known.length:null};
    }).sort(function(a,b){return a.sector.localeCompare(b.sector,'ko-KR');});
  }
  function aggregate(key,rows) {
    var good=rows.filter(function(r){return r.rs1m!==null&&r.rs1y!==null;});
    var mean=function(field){return good.length?good.reduce(function(n,r){return n+r[field];},0)/good.length:null;};
    var daily=rows.filter(function(r){return r.rate!==null;});
    var rate=daily.length?daily.reduce(function(n,r){return n+r.rate;},0)/daily.length:null;
    var caps=good.filter(function(r){return r.cap!==null;});
    return {key:key,name:key,rows:rows,rs1m:mean('rs1m'),rs1y:mean('rs1y'),rate:rate,
      cap:caps.length?caps.reduce(function(n,r){return n+r.cap;},0):null,coverage:good.length,
      total:rows.length,kind:'group'};
  }
  function nodesOf(state) {
    var stocks=stocksOf(state),groups=Object.create(null);
    if(state.industry){
      return stocks.map(function(stock){return Object.assign({key:stock.code,kind:'stock',total:1,coverage:stock.rs1m!==null&&stock.rs1y!==null?1:0},stock);});
    }
    stocks.forEach(function(stock){
      var key=state.sector?stock.industry:stock.sector;
      (groups[key]||(groups[key]=[])).push(stock);
    });
    return Object.keys(groups).map(function(key){return aggregate(key,groups[key]);});
  }
  function layout(nodes) {
    var valid=nodes.filter(function(n){return n.rs1m!==null&&n.rs1y!==null;});
    if(!valid.length)return {points:[],missing:nodes};
    var maxX=Math.max(6,...valid.map(function(n){return Math.abs(n.rs1y);}));
    var maxY=Math.max(6,...valid.map(function(n){return Math.abs(n.rs1m);}));
    maxX*=1.22;maxY*=1.22;
    var midX=(plot.l+plot.r)/2,midY=(plot.t+plot.b)/2,halfX=(plot.r-plot.l)/2,halfY=(plot.b-plot.t)/2;
    var maxCap=Math.max(1,...valid.map(function(n){return n.cap||0;}));
    var points=valid.map(function(n){
      var size=n.cap===null?12:10+Math.sqrt(Math.max(0,n.cap)/maxCap)*(n.kind==='stock'?20:31);
      var r=Math.min(n.kind==='stock'?31:42,Math.max(10,size));
      var ax=midX+n.rs1y/maxX*halfX,ay=midY-n.rs1m/maxY*halfY;
      return {node:n,ax:ax,ay:ay,x:ax,y:ay,r:r};
    }).sort(function(a,b){return b.r-a.r;});
    // Separate overlapping hit areas, then pull each bubble back toward its
    // true RS coordinates; displaced bubbles keep a tether to the actual axes.
    for(var step=0;step<95;step++){
      var moved=false;
      for(var i=0;i<points.length;i++)for(var j=i+1;j<points.length;j++){
        var a=points[i],b=points[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy);
        var minimum=a.r+b.r+8;
        if(d>=minimum)continue;
        if(d<.001){dx=((i*13+j*7)%5)-2;dy=((i*11+j*17)%7)-3;d=Math.sqrt(dx*dx+dy*dy)||1;}
        var shift=(minimum-d)*.52;
        a.x-=dx/d*shift;a.y-=dy/d*shift;
        b.x+=dx/d*shift;b.y+=dy/d*shift;moved=true;
      }
      points.forEach(function(p){
        p.x+=(p.ax-p.x)*.035;p.y+=(p.ay-p.y)*.035;
        p.x=Math.max(plot.l+p.r,Math.min(plot.r-p.r,p.x));
        p.y=Math.max(plot.t+p.r,Math.min(plot.b-p.r,p.y));
      });
      if(!moved&&step>20)break;
    }
    return {points:points,missing:nodes.filter(function(n){return n.rs1m===null||n.rs1y===null;}),
      maxX:maxX,maxY:maxY};
  }
  function svgMarkup(state,lay,ranked) {
    var mx=(plot.l+plot.r)/2,my=(plot.t+plot.b)/2;
    function xLabel(v){return (v>0?'+':'')+v.toFixed(0);}
    var shape='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="가로축은 최근 1년 시장보다 강한 정도, 세로축은 최근 한 달 시장보다 강한 정도. 오른쪽과 위쪽일수록 시장 대비 성적이 좋습니다.">';
    shape+='<rect x="0" y="0" width="'+W+'" height="'+H+'" rx="16" class="mtm-canvas-bg"/>';
    if(!lay.points.length)return shape+'<text x="500" y="248" text-anchor="middle" class="mtm-axis">지도에 표시할 비교 자료가 없습니다</text>'
      + '<text x="500" y="280" text-anchor="middle" class="mtm-axis">과거 자료가 부족한 항목은 임의로 표시하지 않습니다</text></svg>';
    shape+='<path d="M'+mx+' '+plot.t+'V'+plot.b+'M'+plot.l+' '+my+'H'+plot.r+'" class="mtm-axis-line"/>';
    var labels=[['최근 강해짐',plot.l+18,plot.t+20,'start'],['꾸준히 강함',plot.r-18,plot.t+20,'end'],
      ['시장보다 약함',plot.l+18,plot.b-10,'start'],['최근 주춤',plot.r-18,plot.b-10,'end']];
    labels.forEach(function(v){shape+='<text x="'+v[1]+'" y="'+v[2]+'" text-anchor="'+v[3]+'" class="mtm-quadrant">'+v[0]+'</text>';});
    [-.5,.5].forEach(function(k){
      var xx=mx+k*(plot.r-plot.l)/2,yy=my+k*(plot.b-plot.t)/2;
      shape+='<line x1="'+xx+'" y1="'+plot.t+'" x2="'+xx+'" y2="'+plot.b+'" class="mtm-gridline"/>';
      shape+='<line x1="'+plot.l+'" y1="'+yy+'" x2="'+plot.r+'" y2="'+yy+'" class="mtm-gridline"/>';
    });
    shape+='<text x="'+(plot.l+5)+'" y="'+(H-11)+'" text-anchor="start" class="mtm-axis">'+xLabel(-lay.maxX)+'%p</text>';
    shape+='<text x="'+(plot.r-8)+'" y="'+(H-11)+'" text-anchor="end" class="mtm-axis">지난 1년 시장보다 강함  '+xLabel(lay.maxX)+'%p →</text>';
    shape+='<text x="'+(plot.l-9)+'" y="'+(plot.t+10)+'" text-anchor="end" class="mtm-axis">+'+lay.maxY.toFixed(0)+'</text>';
    shape+='<text x="'+(plot.l-9)+'" y="'+(plot.b-5)+'" text-anchor="end" class="mtm-axis">'+(-lay.maxY).toFixed(0)+'</text>';
    shape+='<text x="28" y="'+plot.t+'" transform="rotate(-90 28 '+plot.t+')" text-anchor="end" class="mtm-axis">최근 한 달 시장보다 강함 ↑</text>';
    shape+='<text x="'+mx+'" y="'+(plot.b+20)+'" text-anchor="middle" class="mtm-zero">0</text>';
    lay.points.forEach(function(p,i){
      var n=p.node,active=state.selectedCode===n.code;
      var stockRank=n.kind==='stock'?ranked.findIndex(function(r){return r.code===n.code;})+1:0;
      var label=n.kind==='stock'?(lay.points.length<=8||stockRank<=5||active):(lay.points.length<=12||i<9||active);
      var tooltip=n.name+' · 지난 1년 시장 대비 '+pp(n.rs1y)+' · 최근 한 달 시장 대비 '+pp(n.rs1m)+' · 오늘 '+pct(n.rate);
      if(n.kind==='stock')tooltip+=' · 하는 일: '+businessLine(state,n);
      var displacement=Math.hypot(p.x-p.ax,p.y-p.ay);
      if(displacement>4)shape+='<path d="M'+p.ax.toFixed(1)+' '+p.ay.toFixed(1)+'L'+p.x.toFixed(1)+' '+p.y.toFixed(1)+'" class="mtm-tether"/>';
      shape+='<g class="mtm-point mtm-'+klass(n.rate)+(active?' is-active':'')+'" role="button" tabindex="0" data-mtm-node="'+esc(n.key)+'" aria-label="'+esc(tooltip)+'" transform="translate('+p.x.toFixed(1)+' '+p.y.toFixed(1)+')">'
        + '<circle r="'+p.r.toFixed(1)+'" class="mtm-bubble"/><title>'+esc(tooltip)+'</title>'
        + (n.kind==='group'?'<text y="4" text-anchor="middle" class="mtm-bubble-count">'+n.coverage+'</text>'
          :'<text y="3.5" text-anchor="middle" class="mtm-bubble-number">'+(stockRank<10?'0':'')+stockRank+'</text>')
        + (label?'<text y="'+(-p.r-8)+'" text-anchor="middle" class="mtm-bubble-label">'+esc(n.name)+'</text>':'')
        + '</g>';
    });
    return shape+'</svg>';
  }
  function summary(state) {
    var rows=stocksOf(state),nodes=nodesOf(state),valid=nodes.filter(function(n){return n.rs1m!==null&&n.rs1y!==null;});
    var level=state.industry?'종목':state.sector?'하위 업종':'산업';
    return {rows:rows,nodes:nodes,valid:valid,level:level};
  }
  function selectNode(state,key) {
    var node=nodesOf(state).find(function(n){return n.key===key;});
    if(!node)return;
    if(node.kind==='stock'){state.selectedCode=node.code;}
    else if(!state.sector){state.sector=node.key;state.selectedCode='';}
    else if(!state.industry){state.industry=node.key;state.selectedCode='';}
    state.zoom=1;draw(state);
  }
  function stockDetail(state,stock) {
    if(!stock)return '<div class="mtm-detail-empty">오른쪽 목록에 회사명과 사업 내용을 표시했습니다. 회사 이름을 누르면 자세한 정보를 확인할 수 있습니다.</div>';
    var summary=businessLine(state,stock);
    var source=state.profiles&&businessSummary(state,stock)
      ? (state.profiles.source||'기업개요')+' · '+(state.profiles.asOf||'기준일 미확인')+' 수집'
      : '기존 업종 분류 기반 · 사업 내용은 확인된 자료만 표시';
    var detail='<div class="mtm-detail-heading"><div><small>'+esc(stock.code)+' · '+esc(stock.market)+'</small><h3>'+esc(stock.name)+'</h3></div>'
      +'<strong class="mtm-'+klass(stock.rate)+'">'+pct(stock.rate)+'</strong></div>'
      +'<section class="mtm-business-panel" aria-label="회사 사업 소개"><strong>무슨 회사인가요?</strong>'
      +'<p>'+esc(summary)+'</p><small>'+esc(source)+'</small></section>'
      +'<div class="mtm-big-price">'+money(stock.price)+'<small> 원</small></div>';
    [
      ['지난 1년 시장 대비',pp(stock.rs1y)],['최근 한 달 시장 대비',pp(stock.rs1m)],
      ['시가총액',capText(stock.cap)],['거래대금',stock.amount===null?'미제공':capText(stock.amount)],
      ['거래량',stock.volume===null?'미제공':money(stock.volume)+'주'],
      ['시세 조회시각',stock.time?esc(stock.time)+' (공급자 수신)': '미제공'],
      ['비교 기준 날짜',esc(stock.rsDate||'미확인')]
    ].forEach(function(d){detail+='<div class="mtm-detail-row"><span>'+d[0]+'</span><b>'+d[1]+'</b></div>';});
    detail+='<a class="mtm-detail-open" href="/page/stock-search?code='+encodeURIComponent(stock.code)+'">종목정보 자세히 보기</a>';
    return detail;
  }
  function nodeBusinessRow(state,node,index) {
    var isCompany=node.kind==='stock',selected=isCompany&&state.selectedCode===node.code;
    var members=!isCompany&&node.rows?node.rows.slice().sort(function(a,b){return (b.cap||0)-(a.cap||0);})
      .slice(0,3).map(function(r){return r.name;}).join(' · '):'';
    var business=isCompany?businessLine(state,node):(members?'포함 종목: '+members:'포함 종목 정보 없음');
    return '<button type="button" data-mtm-list-node="'+esc(node.key)+'"'
      +' class="mtm-list-row'+(selected?' is-active':'')+'">'
      +'<span class="mtm-list-number '+(isCompany?'mtm-number-stock':'mtm-number-group')+'">'+(isCompany?String(index+1).padStart(2,'0'):'·')+'</span>'
      +'<span class="mtm-list-name"><strong>'+esc(node.name)+'</strong>'
      +'<small>'+((isCompany?esc(node.code)+' · '+money(node.price)+'원':node.total+'개 종목 표본'))+'</small>'
      +'<span class="mtm-list-business" title="'+esc(business)+'">'+esc(business)+'</span></span>'
      +'<span class="mtm-list-value mtm-'+klass(node.rate)+'">'+pct(node.rate)
      +'<small>최근 한 달 시장 대비 '+pp(node.rs1m)+'</small></span></button>';
  }
  function draw(state) {
    var root=state.root,view=summary(state),lay=layout(view.nodes),visible=new Set(lay.points.map(function(p){return p.node.key;}));
    root.querySelector('[data-mtm-headline]').textContent=state.industry?state.industry:state.sector||'전체 산업';
    root.querySelector('[data-mtm-scope]').textContent=view.level+' '+view.nodes.length+'개 · 지도에 표시 '+view.valid.length+'개 · 조회한 종목 '+view.rows.length+'/'+state.candidates.length+'개(표본)';
    root.querySelector('[data-mtm-status]').textContent=state.loading?'시세·일봉 확인 중…':
      state.error||('시세 조회 '+(state.checkedAt||'미확인')+' KST · 과거 비교 기준일: 코스피 '
      + (state.rs&&state.rs.benchmarks&&state.rs.benchmarks.KOSPI&&state.rs.benchmarks.KOSPI.asOf||'미확인')
      + ', 코스닥 '+(state.rs&&state.rs.benchmarks&&state.rs.benchmarks.KOSDAQ&&state.rs.benchmarks.KOSDAQ.asOf||'미확인')
      + ' · 지도 위치는 장중 실시간 변화가 아닙니다');
    root.querySelector('[data-mtm-breadcrumb]').innerHTML=
      '<button type="button" data-mtm-nav="root">산업 전체</button>'
      +(state.sector?'<span>›</span><button type="button" data-mtm-nav="sector">'+esc(state.sector)+'</button>':'')
      +(state.industry?'<span>›</span><span>'+esc(state.industry)+'</span>':'');
    var list=view.nodes.slice().sort(function(a,b){return (b.cap||0)-(a.cap||0);});
    root.querySelector('[data-mtm-chart]').innerHTML=svgMarkup(state,lay,list);
    var missing=lay.missing.length;
    root.querySelector('[data-mtm-quality]').textContent=missing?
      missing+'개 항목은 과거 자료가 부족해 지도에 표시하지 않았습니다. 오른쪽 목록에서 확인할 수 있습니다.':
      '지도 위치는 실제 과거 주가와 시장지수 자료를 비교한 결과입니다.';
    root.querySelector('[data-mtm-node-list]').innerHTML=list.length
      ?list.map(function(n,i){return nodeBusinessRow(state,n,i);}).join('')
      :'<p class="mtm-empty">선택한 조건에 해당하는 종목이 없습니다.</p>';
    var selected=view.rows.find(function(row){return row.code===state.selectedCode;});
    root.querySelector('[data-mtm-detail]').innerHTML=stockDetail(state,selected);
    root.querySelector('[data-mtm-list-title]').textContent=state.industry
      ? '회사 한눈에 보기 · 지도 번호 순서'
      : state.sector ? '하위 업종 · 포함 회사' : '산업별 포함 회사';
    root.querySelector('[data-mtm-identify]').textContent=state.industry
      ? '원 안 번호 = 오른쪽 회사 목록 · 목록에 회사가 하는 일 표시'
      : '산업과 하위 업종을 선택하면 포함된 회사와 사업을 볼 수 있습니다.';
    root.querySelectorAll('[data-mtm-market]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-mtm-market')===state.market));});
    root.querySelectorAll('[data-mtm-size]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-mtm-size')===state.size));});
    root.querySelector('[data-mtm-zoom-label]').textContent=Math.round(state.zoom*100)+'%';
    root.querySelector('[data-mtm-chart] svg').setAttribute('viewBox',
      [(W-W/state.zoom)/2,(H-H/state.zoom)/2,W/state.zoom,H/state.zoom].join(' '));
  }
  function load(state) {
    if(state.loading)return;
    var api=global.NineAPI;
    if(!api||!api.domesticQuotes||!api.data||!global.NineAccess||!global.NineAccess.isAdmin()){
      state.error='관리자 인증 또는 공통 API를 확인할 수 없습니다.';draw(state);return;
    }
    state.loading=true;state.error='';draw(state);
    var codes=state.candidates.map(function(s){return s.code;});
    api.domesticQuotes(codes,{fallback:false}).then(function(quotes){
      state.quotes=Array.isArray(quotes)?quotes:[];
      state.checkedAt=new Date().toLocaleTimeString('ko-KR',{hour12:false,timeZone:'Asia/Seoul'});
      var url=api.vmUrl+'/market-atlas-rs?codes='+codes.join(',');
      return api.data(url,{private:true,timeoutMs:15000,fetchOptions:{credentials:'include',cache:'no-store'}})
        .then(function(rs){state.rs=rs;if(!rs||!rs.benchmarks)throw Error('RS response invalid');})
        .catch(function(){state.rs=null;state.error='일봉 RS를 불러오지 못했습니다. 시세 목록은 제공하며 좌표는 표시하지 않습니다.';});
    }).catch(function(){
      state.error='시세를 불러오지 못했습니다. 관리자 세션과 네트워크를 확인하세요.';
    }).then(function(){state.loading=false;draw(state);});
  }
  function init(container,wics) {
    if(!container||container.__mtm)return;
    var state={root:container,candidates:chooseCandidates(wics),quotes:[],rs:null,
      market:'ALL',sector:'',industry:'',search:'',size:'cap',zoom:1,
      selectedCode:'',loading:false,error:'',checkedAt:'',profiles:null,profileStatus:'loading'};
    container.__mtm=state;
    container.innerHTML='<main class="mtm" aria-label="시장 흐름 지도">'
      +'<header class="mtm-header"><div><span class="mtm-eyebrow">9PAY MARKET ATLAS</span>'
      +'<h1>시장 흐름 지도</h1><p>어떤 산업과 종목이 강한지 한눈에 살펴보세요. 산업 → 하위 업종 → 종목</p></div>'
      +'<span class="mtm-admin-note">관리자 전용 · 종목 시세</span></header>'
      +'<div class="mtm-toolbar"><div class="mtm-segments" role="group" aria-label="시장 구분">'
      +'<button type="button" data-mtm-market="ALL" aria-pressed="true">전체</button>'
      +'<button type="button" data-mtm-market="KOSPI" aria-pressed="false">KOSPI</button>'
      +'<button type="button" data-mtm-market="KOSDAQ" aria-pressed="false">KOSDAQ</button></div>'
      +'<label class="mtm-search-label">업종·종목 검색<input type="search" data-mtm-search placeholder="종목명 / 코드 / 업종" autocomplete="off"></label>'
      +'<button type="button" class="mtm-refresh" data-mtm-refresh>자료 다시 조회</button></div>'
      +'<div class="mtm-info"><span data-mtm-scope>표본 데이터 확인 중</span><span data-mtm-status>권한 확인 중</span></div>'
      +'<div class="mtm-path"><div data-mtm-breadcrumb></div><strong data-mtm-headline>전체 산업</strong></div>'
      +'<div class="mtm-layout"><div class="mtm-chart-card">'
      +'<div class="mtm-chart-top"><span>오른쪽 = 지난 1년 시장보다 강함 · 위쪽 = 최근 한 달 시장보다 강함</span>'
      +'<div class="mtm-chart-actions"><span class="mtm-legend-up">● 오늘 상승</span><span class="mtm-legend-down">● 오늘 하락</span>'
      +'<button type="button" data-mtm-zoom="out" aria-label="축소">−</button>'
      +'<output data-mtm-zoom-label>100%</output><button type="button" data-mtm-zoom="in" aria-label="확대">+</button></div></div>'
      +'<div class="mtm-chart" data-mtm-chart></div><p class="mtm-quality" data-mtm-quality></p>'
      +'<div class="mtm-guide"><strong>이렇게 보세요</strong><span>오른쪽 = 지난 1년간 시장보다 강함</span>'
      +'<span>위쪽 = 최근 한 달간 시장보다 강함</span><span>원이 클수록 시가총액이 큽니다.</span>'
      +'<span data-mtm-identify>회사를 선택하면 이름과 사업 내용을 볼 수 있습니다.</span></div>'
      +'<details class="mtm-method"><summary>계산 기준과 데이터 안내 <span aria-hidden="true">＋</span></summary>'
      +'<div class="mtm-method-body">가로축은 최근 250거래일, 세로축은 최근 20거래일의 시장 대비 초과수익률(RS)입니다.'
      +' 종목 수익률에서 해당 시장(KOSPI 또는 KOSDAQ) 지수 수익률을 뺀 값(%p)이므로, 시장보다 강하다고 반드시 주가가 오른 것은 아닙니다.'
      +' 산업·하위 업종 원은 자료를 확보한 종목의 단순 평균이며 공식 업종지수가 아닙니다.'
      +' 원 크기는 확인된 시가총액을 기준으로 합니다. 겹친 원은 보기 좋게 이동하고 실제 좌표에 선으로 연결합니다.'
      +' 과거 자료가 부족한 종목은 임의 값으로 채우지 않습니다.</div></details></div>'
      +'<aside class="mtm-side"><div class="mtm-side-card"><h2 data-mtm-list-title>산업별 포함 회사</h2>'
      +'<p class="mtm-side-intro">회사명 아래에 실제 사업 소개를 표시합니다. 검색하지 않고 목록에서 바로 확인하세요.</p>'
      +'<div class="mtm-node-list" data-mtm-node-list></div></div>'
      +'<div class="mtm-side-card mtm-detail" data-mtm-detail></div></aside></div>'
      +'<footer class="mtm-footer">공식 산업분류 기준 · 업종별 일부 종목만 표시(전체 상장종목 아님).'
      +' 지도 위치는 저장된 과거 자료를 기준으로 하며 오늘 주가 등락과 갱신 시각이 다를 수 있습니다.'
      +' 제공되지 않은 가격·거래대금은 추정하지 않습니다. 주문·자동매매와 연결되지 않습니다.</footer></main>';
    container.addEventListener('click',function(event){
      var b=event.target.closest&&event.target.closest('button,[data-mtm-node]');if(!b)return;
      if(b.hasAttribute('data-mtm-market')){state.market=b.getAttribute('data-mtm-market');state.selectedCode='';draw(state);}
      else if(b.hasAttribute('data-mtm-nav')){
        if(b.getAttribute('data-mtm-nav')==='root'){state.sector='';state.industry='';}
        else state.industry='';
        state.selectedCode='';state.zoom=1;draw(state);
      }else if(b.hasAttribute('data-mtm-node'))selectNode(state,b.getAttribute('data-mtm-node'));
      else if(b.hasAttribute('data-mtm-list-node'))selectNode(state,b.getAttribute('data-mtm-list-node'));
      else if(b.hasAttribute('data-mtm-zoom')){state.zoom=Math.max(1,Math.min(2.4,state.zoom*(b.getAttribute('data-mtm-zoom')==='in'?1.2:1/1.2)));draw(state);}
      else if(b.hasAttribute('data-mtm-refresh'))load(state);
    });
    container.addEventListener('keydown',function(e){
      if((e.key==='Enter'||e.key===' ')&&e.target.hasAttribute('data-mtm-node')){
        e.preventDefault();selectNode(state,e.target.getAttribute('data-mtm-node'));
      }
    });
    container.querySelector('[data-mtm-search]').addEventListener('input',function(e){
      state.search=e.target.value;state.selectedCode='';draw(state);
    });
    draw(state);load(state);loadCompanyDescriptions(state);
  }
  global.MarketMap={init:init,chooseCandidates:chooseCandidates,grouped:grouped,getRS:getRS,layout:layout,nodesOf:nodesOf,
    businessSummary:businessSummary,businessLine:businessLine,nodeBusinessRow:nodeBusinessRow};
})(window);
