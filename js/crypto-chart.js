/* Korean crypto chart search adapter.
 * Upbit public minute/day candles backfill REST, then shared ticker WebSocket.
 * Only price is intrabar live; volume stays the original REST snapshot.
 */
(function (global) {
  'use strict';
  if (global.NineCryptoChart) return;
  var ASSETS = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var NAMES = { BTC:'비트코인', ETH:'이더리움', USDT:'테더' };
  var PERIODS = [
    {key:'1',title:'1분',path:'minutes/1',ms:60000},
    {key:'5',title:'5분',path:'minutes/5',ms:300000},
    {key:'15',title:'15분',path:'minutes/15',ms:900000},
    {key:'60',title:'1시간',path:'minutes/60',ms:3600000},
    {key:'240',title:'4시간',path:'minutes/240',ms:14400000},
    {key:'day',title:'일봉',path:'days',ms:86400000}
  ];
  var state = {symbol:'',period:'5',gen:0,chart:null,candles:null,volume:null,bars:[],liveOff:null,watchOff:null};
  var readyJob = null;
  function getPeriod(key) { return PERIODS.filter(function (p) { return p.key === key; })[0] || PERIODS[1]; }
  function fmt(num, digits) {
    return Number(num).toLocaleString('ko-KR',{minimumFractionDigits:0,maximumFractionDigits:digits == null ? 2:digits});
  }
  function status(host,text) { var node=host.querySelector('[data-crypto-status]'); if(node)node.textContent=text; }
  function clear() {
    if(state.liveOff) {state.liveOff();state.liveOff=null;}
    if(state.watchOff){state.watchOff();state.watchOff=null;}
    if(state.chart){try{state.chart.remove();}catch(err){} state.chart=null;}
    state.candles=null;state.volume=null;state.bars=[];
  }
  function loadLive() {
    if (global.NineCryptoLive) return Promise.resolve(global.NineCryptoLive);
    if(readyJob) return readyJob;
    readyJob=new Promise(function (resolve,reject) {
      var script=document.createElement('script');
      script.src=ASSETS+'js/crypto-live.js?v=20261115-live-v1';
      script.onload=function () {global.NineCryptoLive?resolve(global.NineCryptoLive):reject(new Error('공통 실시간 모듈 오류'));};
      script.onerror=function(){reject(new Error('공통 실시간 모듈 로드 실패'));};
      document.head.appendChild(script);
    }).catch(function(e){readyJob=null;throw e;});
    return readyJob;
  }
  function historical(symbol,period) {
    var url='https://api.upbit.com/v1/candles/'+period.path+'?market=KRW-'+encodeURIComponent(symbol)+'&count=200';
    return fetch(url,{headers:{Accept:'application/json'},cache:'no-store'})
      .then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})
      .then(function(rows) {
        if(!Array.isArray(rows))throw new Error('캔들 형식 오류');
        var seen={};
        rows.forEach(function(row){
          var kst=String(row.candle_date_time_kst||'');
          var time=/^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d$/.test(kst)?Date.parse(kst+'+09:00'):NaN;
          var open=Number(row.opening_price),high=Number(row.high_price),low=Number(row.low_price),close=Number(row.trade_price);
          if(!isFinite(time)||!(open>0&&high>0&&low>0&&close>0))return;
          var date=Math.floor(time/1000);
          seen[date]={date:date,open:open,high:high,low:low,close:close,volume:Math.max(0,Number(row.candle_acc_trade_volume)||0)};
        });
        return Object.keys(seen).map(Number).sort(function(a,b){return a-b;}).map(function(time){return seen[time];});
      });
  }
  function bucketOf(stamp,period) {
    // Upbit KST day/hour grids are anchored at local midnight.
    var offset=9*3600000,ms=period.ms;
    return Math.floor((stamp+offset)/ms)*ms-offset;
  }
  function updateLive(host,quotes,connection) {
    if(!state.symbol||host.hidden)return;
    var live=global.NineCryptoLive,quote=quotes[state.symbol],fresh=live&&live.isFresh(quote);
    if(fresh){
      var label=host.querySelector('[data-crypto-price]');
      if(label)label.textContent=fmt(quote.price,state.symbol==='USDT'?2:0)+'원';
      var change=host.querySelector('[data-crypto-change]');
      if(change) {
        change.textContent=(quote.change_rate>0?'+':'')+quote.change_rate.toFixed(2)+'%';
        change.className='nine-crypto-change'+(quote.change_rate>0?' is-up':quote.change_rate<0?' is-down':'');
      }
      if(state.candles&&state.bars.length) {
        var p=getPeriod(state.period),bucket=Math.floor(bucketOf(quote.at,p)/1000);
        var last=state.bars[state.bars.length-1],previous=last&&last.date;
        if(bucket>=previous){
          var next=bucket===previous?{date:previous,open:last.open,high:Math.max(last.high,quote.price),low:Math.min(last.low,quote.price),close:quote.price,volume:last.volume}:
            {date:bucket,open:quote.price,high:quote.price,low:quote.price,close:quote.price,volume:0};
          try{state.candles.update({time:next.date,open:next.open,high:next.high,low:next.low,close:next.close});}catch(error){}
          if(bucket>previous)state.bars.push(next);
          else state.bars[state.bars.length-1]=next;
        }
      }
      status(host,'업비트 WebSocket 실시간 · 전일 대비 UTC 0시 기준 · 거래량 REST 확인값');
    } else status(host,connection==='connecting'?'업비트 실시간 연결 중': '실시간 수신 지연 · 마지막 REST 캔들');
  }
  function render(host,bars,symbol,period,id) {
    if(id!==state.gen||host.hidden)return;
    if(!bars.length){status(host,'최근 캔들을 확인하지 못했습니다.');return;}
    state.bars=bars;
    return global.NineChartCore.loadLibrary().then(function(LWC) {
      if(id!==state.gen||host.hidden)return;
      var core=global.NineChartCore;
      var mount=host.querySelector('[data-crypto-chart]');
      if(!mount)return;
      mount.textContent='';
      var opts=core.chartOptions(LWC,'search',{autoSize:true,height:390,timeframe:'minute'});
      opts.timeScale.timeVisible=true;
      opts.timeScale.secondsVisible=false;
      state.chart=LWC.createChart(mount,opts);
      state.candles=core.addCandles(state.chart,LWC,bars,{type:'price',precision:symbol==='USDT'?2:0,minMove:symbol==='USDT'?.01:1},{top:.08,bottom:.05});
      // The volume pane stays snapshot-based (not estimated from ticker updates).
      if(bars.length>5) {
        var v=core.addVolumePane(state.chart,LWC,bars,{multipleLabels:false,ma5:false});
        state.volume=v&&v.series?v.series:null;
      }
      state.chart.timeScale().fitContent();
      state.watchOff=core.onThemeChange(function () {
        if(state.chart)state.chart.applyOptions(core.themeUpdateOptions(LWC,'search',{timeframe:'minute'}));
      });
      status(host,'캔들 '+bars.length+'개 · 과거 REST 확인 · 실시간 연결 중');
      return loadLive().then(function(live) {
        if(id!==state.gen)return;
        state.liveOff=live.subscribe(function (quotes,connection) {updateLive(host,quotes,connection);});
      });
    });
  }
  function load(host) {
    if(!state.symbol||host.hidden)return;
    var id=++state.gen,period=getPeriod(state.period),symbol=state.symbol;
    clear();
    status(host,'업비트 '+NAMES[symbol]+' '+period.title+' 캔들 조회 중');
    historical(symbol,period).then(function(bars){return render(host,bars,symbol,period,id);})
      .catch(function(error){if(id===state.gen)status(host,'캔들 조회 실패: '+String(error.message||error));});
  }
  function mount(host,symbol) {
    if(!host||!NAMES[symbol])return;
    clear();
    state.symbol=symbol;state.period='5';state.gen++;
    host.hidden=false;
    host.innerHTML='<section class="nine-crypto-header">'
      +'<div><h3>'+NAMES[symbol]+' <small>KRW-'+symbol+'</small></h3><p>24시간 거래 · 업비트 원화마켓 · 실시간 차트</p></div>'
      +'<div class="nine-crypto-quote"><strong data-crypto-price>시세 확인 중</strong><span data-crypto-change></span></div></section>'
      +'<div class="nine-crypto-periods" role="group" aria-label="가상자산 캔들 간격">'
      +PERIODS.map(function(p){return '<button type="button" data-crypto-period="'+p.key+'"'+(p.key==='5'?' class="is-active"':'')+'>'+p.title+'</button>';}).join('')+'</div>'
      +'<div class="nine-crypto-chart" data-crypto-chart></div>'
      +'<p class="nine-crypto-status" data-crypto-status role="status">차트 준비 중</p>';
    host.querySelectorAll('[data-crypto-period]').forEach(function(btn) {
      btn.addEventListener('click',function(){
        state.period=btn.getAttribute('data-crypto-period');
        host.querySelectorAll('[data-crypto-period]').forEach(function(b){b.classList.toggle('is-active',b===btn);});
        load(host);
      });
    });
    load(host);
  }
  function hide(host) {
    state.gen++;clear();state.symbol='';
    if(host){host.hidden=true;host.innerHTML='';}
  }
  global.NineCryptoChart={mount:mount,hide:hide, names:NAMES};
})(window);
