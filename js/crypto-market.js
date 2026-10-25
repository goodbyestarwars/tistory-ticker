/* 가상자산 전용 시장지표. 토큰 이력은 브라우저 조회/1시간 캐시, VM 수집 추가 없음.
 * 2026-10-12: 카드 격자 대신 js/indicator-board.js 의 '표 + 추이 차트'로 보여 준다(환율 탭과 같은 모양).
 *   표 한 장에서 코인·토큰을 고르면 아래 추이 차트(1개월~5년)와 기간 통계(평균 포함)가 그 지표로 바뀐다.
 *   시세·이력·뉴스를 가져오는 경로는 그대로이고, 52주·6개월 평균은 차트 기간별 '평균'이 직접 계산한다. */
(function (global) {
  'use strict';
  var base = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var api = 'https://goodbyestar.cloud';
  var root, tools, timer, busy, board, boardJob, newsAt = 0, history = {};
  var COINS = [['BTC', '비트코인'], ['ETH', '이더리움'], ['USDT', '테더']];
  // The indicator page and closed home share the same source, units and request.
  var coinQuoteMemo;
  function fetchCoinQuotes() {
    if (coinQuoteMemo && (coinQuoteMemo.pending || Date.now() - coinQuoteMemo.at < 30000)) return coinQuoteMemo.promise;
    var memo = { at: Date.now(), pending: true };
    memo.promise = global.NineHttp.json(api + '/futures?days=365&symbols=BTC,ETH,USDT', {timeoutMs:8000})
      .then(function (out) { if (!Array.isArray(out.data)) throw new Error('coin quote payload'); return out.data; })
      .catch(function (error) { if (coinQuoteMemo === memo) coinQuoteMemo = null; throw error; })
      .finally(function () { memo.pending = false; });
    coinQuoteMemo = memo;
    return memo.promise;
  }
  var COIN_DIGITS = { BTC: 0, ETH: 0, USDT: 2 };
  var coinItems = {}, tokenItems = {}, tokenPairs = [], tokenQuoteAt = '';
  var COLUMNS = [
    { label: '현재값', short: '현재' }, { label: '전일 대비', short: '전일' }, { label: '등락률', short: '등락' },
    { label: '고가', short: '고가' }, { label: '저가', short: '저가' }
  ];
  var RANGES = [
    { key: '1m', label: '1개월', days: 31 }, { key: '3m', label: '3개월', days: 92 },
    { key: '1y', label: '1년', days: 366 }, { key: '5y', label: '5년', days: 1830 }
  ];
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
  function ensureBoard() {
    if (global.IndicatorBoard) return Promise.resolve();
    if (boardJob) return boardJob;
    if (!document.querySelector('link[href*="/css/indicator-board.css"]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = base + 'css/indicator-board.css?v=20261012-board';
      document.head.appendChild(link);
    }
    boardJob = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = base + 'js/indicator-board.js?v=20261012-board';
      script.onload = script.onerror = function () { resolve(); };
      document.head.appendChild(script);
    });
    return boardJob;
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

  /* ---- 표 ---- */
  function fmtNum(v, digits) { return v == null || !isFinite(Number(v)) ? '-' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
  function signedNum(v, digits) { return v == null || !isFinite(Number(v)) ? '-' : (Number(v) > 0 ? '+' : '') + fmtNum(v, digits); }
  function toneOf(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  function tokenQuoteTime(stamp) {
    var time = Date.parse(stamp);
    if (!isFinite(time)) return '';
    var kst = new Date(time + 9 * 3600000).toISOString();
    return kst.slice(0, 10).replace(/-/g, '.') + ' ' + kst.slice(11, 19) + ' KST';
  }

  // 일봉 이력 + 오늘 값. 코인(원화)은 한국 날짜, 토큰은 UTC 날짜 기준(기존 차트와 같다).
  function withToday(points, price, utc) {
    if (!points.length || typeof price !== 'number' || !isFinite(price)) return points;
    var today = new Date(Date.now() + (utc ? 0 : 9 * 60 * 60000)).toISOString().slice(0, 10);
    var last = points[points.length - 1];
    if (last[0] >= today) last[1] = price; else if (last[1] !== price) points.push([today, price]);
    return points;
  }

  function coinRow(pair) {
    var symbol = pair[0], item = coinItems[symbol];
    var digits = COIN_DIGITS[symbol] == null ? 2 : COIN_DIGITS[symbol];
    var row = { id: symbol, group: 'coin', name: pair[1], code: symbol, loading: false,
      fmt: function (v) { return fmtNum(v, digits) + '원'; },
      axisFmt: function (v) { return v >= 100000000 ? fmtNum(v / 100000000, 1) + '억' : v >= 10000 ? fmtNum(v / 10000, 0) + '만' : fmtNum(v, digits); },
      title: pair[1] + ' 추이 (원)', note: '' };
    if (!item) { row.loading = !coinItems.__failed; row.cells = [{ t: '확인 불가' }, { t: '-' }, { t: '-' }, { t: '-' }, { t: '-' }]; row.series = []; return row; }
    var rate = Number(item.change_rate), change = Number(item.change), t = toneOf(rate), arrow = rate > 0 ? '▲ ' : rate < 0 ? '▼ ' : '';
    var rows = global.MarketChartHistory ? global.MarketChartHistory.merge(symbol, item.chart) : (item.chart || []);
    row.series = withToday(global.IndicatorBoard.util.series(rows, 'date', 'close'), item.price, false);
    row.cells = [
      { t: fmtNum(item.price, digits) + '원' },
      { t: arrow + (isFinite(change) ? fmtNum(Math.abs(change), digits) : '-'), tone: t },
      { t: isFinite(rate) ? signedNum(rate, 2) + '%' : '-', tone: t },
      { t: item.high > 0 ? fmtNum(item.high, digits) : '-' }, { t: item.low > 0 ? fmtNum(item.low, digits) : '-' }
    ];
    return row;
  }

  function tokenRow(pair) {
    var symbol = pair[0], item = tokenItems[symbol], stats = history[symbol] && history[symbol].stats;
    var row = { id: symbol, group: 'token', name: pair[1], code: symbol.replace(/USDT$/, ''), loading: false, series: [], seriesPending: !history[symbol],
      fmt: function (v) { return fmtNum(v, 2) + ' USDT'; }, axisFmt: function (v) { return fmtNum(v, 2); },
      title: pair[1] + ' 토큰 추이 (USDT)',
      note: '<div class="ibd-ln">국내 주식 이름을 붙인 바이낸스 무기한선물 토큰의 참고 가격입니다. 실제 주식 시세·수급과 다르며 원화로 환산하지 않았습니다.</div>' };
    if (!item) { row.loading = !tokenItems.__failed; row.cells = [{ t: '확인 불가' }, { t: '-' }, { t: '-' }, { t: '-' }, { t: '-' }]; return row; }
    var price = Number(item.price), rate = Number(item.changeRate), t = toneOf(rate), arrow = rate > 0 ? '▲ ' : rate < 0 ? '▼ ' : '';
    // 24시간 등락률에서 거슬러 계산한 금액(원자료에는 등락 금액이 없다).
    var change = isFinite(price) && isFinite(rate) && rate > -100 ? price - price / (1 + rate / 100) : NaN;
    if (stats && stats.chart) row.series = withToday(global.IndicatorBoard.util.series(stats.chart, 'date', 'close'), price, true);
    row.cells = [
      { t: fmtNum(price, 2) + ' USDT' },
      { t: arrow + (isFinite(change) ? fmtNum(Math.abs(change), 2) : '-'), tone: t },
      { t: isFinite(rate) ? signedNum(rate, 2) + '%' : '-', tone: t },
      { t: item.high > 0 ? fmtNum(item.high, 2) : '-' }, { t: item.low > 0 ? fmtNum(item.low, 2) : '-' }
    ];
    return row;
  }

  function renderBoard() {
    if (!board || !global.IndicatorBoard) return;
    var rows = COINS.map(coinRow);
    tokenPairs.forEach(function (pair) { rows.push(tokenRow(pair)); });
    var tokenHint = 'USDT 기준 · 등락률은 24시간 · ' + (tokenQuoteAt ? '마지막 시세 수신 ' + tokenQuoteAt : '시세 수신 전');
    board.setRows(rows, [
      { key: 'coin', label: '가상자산', hint: '원화 기준 · 전일 대비는 24시간' },
      { key: 'token', label: '바이낸스 국내주식 토큰', hint: tokenHint }
    ]);
    // IndicatorBoard는 같은 행 구조에서 표의 숫자만 갱신하므로 제목 옆 시각은 별도로 반영한다.
    var groupHints = board.root.querySelectorAll('.ibd-section small');
    if (groupHints[1]) groupHints[1].textContent = tokenHint;
  }

  function shell() {
    return '<div class="cm-status" role="status">30초마다 시세 갱신 · 추이는 완료 일봉 기준</div>'
      +'<p class="cm-note mi-tab-explainer">코인은 원화, 토큰은 USDT 기준입니다. 국내주식 토큰은 무기한선물 참고 가격으로 실제 주식 시세와 다릅니다. 차트의 평균은 선택한 기간의 종가 평균입니다.</p>'
      +'<div class="cm-board" data-cm-board></div>'
      +'<section class="cm-news"><div class="cm-news-head"><h3>가상자산 뉴스</h3><button type="button" data-news-refresh>새로고침</button></div><div data-news-status role="status">뉴스 확인 중...</div><div class="app-news-timeline" data-news-list></div></section>';
  }
  function coins() {
    return fetchCoinQuotes().then(function (items) {
      coinItems = { __failed: false };
      items.forEach(function(item){coinItems[item.symbol]=item;});
      renderBoard();
    }).catch(function(error){console.warn('[CryptoMarket] coin quote',error.message);if(!Object.keys(coinItems).length)coinItems.__failed=true;renderBoard();});
  }
  function tokens() {
    return tools.fetchTokens().then(function(data){
      if(data&&data.items.length)return data;
      return tools.get(api+'/binance-kr-equity').then(function(json){return json.data;});
    }).then(function(data){
      var items=data&&data.items||[], index=0;
      tokenPairs = tools.symbols;
      tokenItems = { __failed: false };
      items.forEach(function(item){tokenItems[item.symbol]=item;});
      if(items.length) tokenQuoteAt=tokenQuoteTime(data.updatedAt);
      renderBoard();
      // Three concurrent histories instead of an eight-request burst.
      function worker(){var item=items[index++];if(!item)return Promise.resolve();return tokenHistory(item.symbol).then(function(){renderBoard();}).then(worker);}
      return Promise.all([worker(),worker(),worker()]);
    }).catch(function(){tokenPairs = tools.symbols; if(!Object.keys(tokenItems).length)tokenItems.__failed=true; renderBoard();});
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
    if(tools&&board){board.redraw();refresh();return;}
    if(busy)return;busy=true;
    Promise.all([helpers(),ensureBoard()]).then(function(out){
      tools=out[0].cryptoTools;tokenPairs=tools.symbols;
      root.innerHTML=shell();
      board=global.IndicatorBoard?global.IndicatorBoard.create(root.querySelector('[data-cm-board]'),{
        columns:COLUMNS,ranges:RANGES,defaultRange:'3m',prevLabel:'전일',countLabel:'일봉',
        caption:'가상자산 시세 표',emptyText:'시세를 불러오는 중입니다.',height:210}):null;
      root.querySelector('[data-news-refresh]').onclick=function(){news(true);};
      busy=false;renderBoard();refresh();if(!timer)timer=setInterval(refresh,30000);
    }).catch(function(){busy=false;root.textContent='가상자산 화면을 불러오지 못했습니다.';});
  }
  global.CryptoMarket={init:init,dailyStats:dailyStats,fetchCoinQuotes:fetchCoinQuotes,coins:COINS};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
