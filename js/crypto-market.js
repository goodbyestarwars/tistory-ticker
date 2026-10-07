/* 가상자산 전용 시장지표. 토큰 이력은 브라우저 조회/1시간 캐시, VM 수집 추가 없음. */
(function (global) {
  'use strict';
  var base = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var api = 'https://goodbyestar.cloud';
  var root, tools, timer, busy, newsAt = 0, history = {}, averages = {}, averagesAt = 0;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function active() { return root && !document.hidden && !root.closest('[hidden]'); }
  function helpers() {
    if (global.OvernightMarket && global.OvernightMarket.cryptoTools) return Promise.resolve(global.OvernightMarket);
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = base + 'js/overnight-market.js?v=20261008-five-year-charts';
      script.onload = function () { resolve(global.OvernightMarket); };
      script.onerror = reject; document.head.appendChild(script);
    });
  }
  // Only completed daily closes count. A short listing never becomes a fabricated 52-week mean.
  function dailyStats(rows, now) {
    var unique = {};
    (rows || []).forEach(function (r) {
      var close = Number(r[4]), end = Number(r[6]), start = Number(r[0]);
      if (!isFinite(start) || !isFinite(end) || end >= now || !isFinite(close) || close <= 0) return;
      unique[new Date(start).toISOString().slice(0, 10)] = close;
    });
    var dates = Object.keys(unique).sort();
    var chart = dates.map(function (date) { return {date:date.replace(/-/g,''), close:unique[date]}; });
    function mean(days) {
      var last = chart.slice(-days);
      // Require an uninterrupted calendar-day series as crypto trades every day.
      var span = last.length ? (Date.parse(dates[dates.length-1]) - Date.parse(dates[dates.length-last.length])) / 86400000 + 1 : 0;
      return last.length === days && span === days ? {avg:last.reduce(function (s,r) {return s+r.close;},0)/days, count:days} : null;
    }
    return {chart:chart, count:chart.length, year:mean(365), half:mean(180)};
  }
  function tokenHistory(symbol) {
    var cached = history[symbol];
    if (cached && Date.now()-cached.at < 3600000) return Promise.resolve(cached.stats);
    var all=[], cutoff=new Date(); cutoff.setUTCHours(0,0,0,0); cutoff.setUTCFullYear(cutoff.getUTCFullYear()-5);
    function page(end, count) {
      var url='https://fapi.binance.com/fapi/v1/klines?symbol='+encodeURIComponent(symbol)+'&interval=1d&limit=1000'+(end?'&endTime='+end:'');
      return tools.get(url).then(function(rows) {
        all=all.concat(rows);
        if (rows.length===1000 && count<2 && Number(rows[0][0])>cutoff.getTime()) return page(Number(rows[0][0])-1,count+1);
        return all.filter(function(r){return Number(r[0])>=cutoff.getTime();});
      });
    }
    return page(null,0)
      .then(function (rows) { var stats=dailyStats(rows,Date.now()); history[symbol]={at:Date.now(),stats:stats}; return stats; })
      .catch(function () { history[symbol]={at:Date.now(),stats:cached ? cached.stats : null}; return history[symbol].stats; });
  }
  function avgHtml(stats, price, unit) {
    return '<div class="om-crypto-averages">'+[['52주 평균','year','52w'],['6개월 평균','half','6m']].map(function (line) {
      var value = stats && stats[line[1]], avg = value && Number(value.avg);
      var valid = isFinite(avg) && avg > 0;
      return '<div class="om-crypto-avg-'+line[2]+'"><span>'+line[0]+'</span><strong>'
        +(valid ? avg.toLocaleString('ko-KR',{maximumFractionDigits:unit==='원'?0:2})+' '+unit : stats ? '기간 부족 ('+stats.count+'일)' : '자료 확인 불가')
        +'</strong><small>'+(valid ? '현재가 '+((price/avg-1)*100).toFixed(2)+'% · 평균 대비' : '완료 일봉 종가 기준')+'</small></div>';
    }).join('')+'</div>';
  }
  function shell() {
    function group(title,pairs) { return '<section class="om-category"><div class="om-cat-head"><h3 class="om-cat-label">'+title+'</h3></div><div class="om-grid">'+pairs.map(function (p) {return '<article class="om-card" data-asset="'+p[0]+'"><div class="om-title">'+esc(p[1])+' <small>'+p[0]+'</small></div><div data-body>시세 확인 중...</div></article>';}).join('')+'</div></section>'; }
    return '<div class="cm-status" role="status">30초마다 시세 갱신 · 평균은 완료 일봉 기준</div>'
      +group('가상자산',[['BTC','비트코인'],['ETH','이더리움']])
      +group('바이낸스 국내주식 토큰',tools.symbols)
      +'<p class="cm-note">코인은 원화, 토큰은 USDT 기준. 국내주식 토큰은 무기한선물 참고 가격이며 실제 주식 시세와 다릅니다.</p>'
      +'<section class="cm-news"><div class="cm-news-head"><h3>가상자산 뉴스</h3><button type="button" data-news-refresh>새로고침</button></div><div data-news-status role="status">뉴스 확인 중...</div><div class="app-news-timeline" data-news-list></div></section>';
  }
  function draw(item, stats, token) {
    var card=root.querySelector('[data-asset="'+item.symbol+'"]'); if(!card)return;
    tools.destroy(item.symbol);
    tools.setAverages(item.symbol,stats&&stats.year,stats&&stats.half);
    var host=card.querySelector('[data-body]');
    if (!token) {
      host.innerHTML=tools.body(item);
      var old=host.querySelector('.om-crypto-averages'); if(old)old.remove();
      host.insertAdjacentHTML('beforeend',avgHtml(stats,item.price,'원'));
    } else {
      var rate=Number(item.changeRate), tone=rate>=0?'om-pos':'om-neg';
      var range='<div class="om-hl"><span>고가 '+(item.high>0?Number(item.high).toLocaleString('ko-KR'):'-')+'</span><span>저가 '+(item.low>0?Number(item.low).toLocaleString('ko-KR'):'-')+'</span></div>';
      host.innerHTML='<div class="om-body"><div class="om-price '+tone+'">'+Number(item.price).toLocaleString('ko-KR',{maximumFractionDigits:2})+' USDT</div><div class="om-change '+tone+'">'+(rate>0?'+':'')+rate.toFixed(2)+'% <small>24시간</small></div><div class="om-chart"></div>'+range+avgHtml(stats,item.price,'USDT')+'</div>';
    }
    var rows=token ? stats&&stats.chart : item.chart;
    if(!rows||rows.length<2) {host.querySelector('.om-chart').textContent='차트 이력 확인 불가';return;}
    tools.chart(host.querySelector('.om-chart'),item.symbol,rows,token?item.changeRate>=0:item.change_rate>=0,item.price,token?null:item.change);
  }
  function coins() {
    var avgJob = Date.now()-averagesAt<3600000 ? Promise.resolve() : Promise.all(['BTC','ETH'].map(function(symbol){
      return Promise.all([global.OvernightMarket.fetchBenchmark(symbol,365),global.OvernightMarket.fetchBenchmark(symbol,180)]).then(function(values){averages[symbol]={year:values[0],half:values[1],count:0};}).catch(function(){});
    })).then(function(){averagesAt=Date.now();});
    return Promise.all([tools.get(api+'/futures?days=365&symbols=BTC,ETH'),avgJob]).then(function (out) {
      (out[0].data||[]).forEach(function(item){draw(item,averages[item.symbol],false);});
    }).catch(function(error){console.warn('[CryptoMarket] coin quote',error.message);['BTC','ETH'].forEach(unavailable);});
  }
  function unavailable(symbol) {
    var el=root.querySelector('[data-asset="'+symbol+'"] [data-body]');
    if(el&&!el.querySelector('.om-price'))el.textContent='시세 확인 불가 · 다음 갱신 때 다시 확인';
  }
  function tokens() {
    return tools.fetchTokens().then(function(data){
      if(data&&data.items.length)return data;
      return tools.get(api+'/binance-kr-equity').then(function(json){return json.data;});
    }).then(function(data){
      var items=data&&data.items||[], index=0;
      tools.symbols.forEach(function(pair){if(!items.some(function(item){return item.symbol===pair[0];}))unavailable(pair[0]);});
      // Three concurrent histories instead of an eight-request burst.
      function worker(){var item=items[index++];if(!item)return Promise.resolve();return tokenHistory(item.symbol).then(function(stats){draw(item,stats,true);}).then(worker);}
      return Promise.all([worker(),worker(),worker()]);
    }).catch(function(){tools.symbols.forEach(function(pair){unavailable(pair[0]);});});
  }
  function news(force) {
    if(!force&&Date.now()-newsAt<300000)return Promise.resolve();
    return tools.get(api+'/crypto-news?limit=20',20000).then(function(json){
      var data=json.data||{},items=(data.items||[]).filter(function(item){return item.market==='crypto'&&/^https:\/\//.test(item.link);});
      if(!items.length)throw new Error('empty');
      root.querySelector('[data-news-list]').innerHTML=items.map(function(item,index){
        var date=new Date(item.pubDate),parts={};
        if(!isNaN(date))new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).forEach(function(part){parts[part.type]=part.value;});
        var day=parts.month?parts.month+'/'+parts.day:'—',time=parts.hour?parts.hour+':'+parts.minute:'—';
        return '<a class="app-news-event cm-news-item" href="'+esc(item.link)+'" target="_blank" rel="noopener noreferrer">'
          +'<time class="app-news-date" datetime="'+esc(item.pubDate)+'"><strong>'+esc(day)+'</strong><small>'+esc(time)+'</small></time>'
          +'<span class="app-news-rail"><i'+(index===0?' class="is-latest"':'')+'></i></span>'
          +'<span class="app-news-body"><span class="app-news-meta"><b class="app-news-market cm-news-market">가상자산</b><b class="app-news-type app-news-type--뉴스">뉴스</b><small>'+esc(item.source)+'</small></span>'
          +'<strong>'+esc(item.title_ko||item.title)+'</strong></span></a>';
      }).join('');
      root.querySelector('[data-news-status]').textContent=data.stale?'최근 저장 뉴스 · 공급자 응답 지연':'가상자산 전문 매체 · 최근 기사';newsAt=Date.now();
    }).catch(function(){root.querySelector('[data-news-status]').textContent='뉴스 조회 지연 · 새로고침으로 다시 확인';});
  }
  function refresh(){if(!active()||busy)return;busy=true;Promise.allSettled([coins(),tokens(),news(false)]).then(function(){busy=false;root.querySelector('.cm-status').textContent='30초마다 시세 갱신 · 확인 '+new Date().toLocaleTimeString('ko-KR');});}
  function init() {
    root=document.getElementById('crypto-market');if(!active())return;
    if(tools){refresh();return;}
    if(busy)return;busy=true;
    helpers().then(function(module){tools=module.cryptoTools;root.innerHTML=shell();root.querySelector('[data-news-refresh]').onclick=function(){news(true);};busy=false;refresh();if(!timer)timer=setInterval(refresh,30000);}).catch(function(){busy=false;root.textContent='가상자산 화면을 불러오지 못했습니다.';});
  }
  global.CryptoMarket={init:init,dailyStats:dailyStats};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
