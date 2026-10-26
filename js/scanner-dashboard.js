/* Compact pattern-scan dashboard. Uses the consumer's existing read-only data. */
(function (global) {
  'use strict';
  if (global.ScannerDashboard) return;
  function timestamp(value) {
    if (value == null || value === '') return NaN;
    return typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value);
  }
  function kstDay(value) {
    var ms = timestamp(value);
    return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0, 10) : '';
  }
  function count(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
  function model(snapshot, days, now) {
    snapshot = snapshot || {};
    days = [7,30,90].indexOf(days) >= 0 ? days : 7;
    var today = kstDay(now), since = kstDay(now - (days - 1) * 86400000);
    var current = snapshot.current || [], hits = (snapshot.hits || []).filter(function (r) {
      return r && r.scanner === snapshot.source && r.code && /^\d{4}-\d{2}-\d{2}$/.test(r.scanDate);
    });
    var dates = hits.map(function (r) { return r.scanDate; }).sort();
    var truncated = hits.length >= (snapshot.historyLimit || 1500);
    // The API caps its rows. Exclude the oldest possibly partial date from aggregates.
    var partialDay = truncated ? dates[0] : '';
    var buckets = {}, recent = {}, todayCodes = new Set(), readyCodes = new Set();
    function addRecent(row) {
      if (!row.code || !Number.isFinite(timestamp(row.at)) || timestamp(row.at) > now) return;
      var prev = recent[row.code];
      if (!prev || timestamp(row.at) > timestamp(prev.at)) recent[row.code] = row;
    }
    hits.forEach(function (hit) {
      if (hit.scanDate > today) return;
      if (hit.scanDate !== partialDay) {
        if (!buckets[hit.scanDate]) buckets[hit.scanDate] = new Set();
        buckets[hit.scanDate].add(String(hit.code));
        if (hit.scanDate === today) todayCodes.add(String(hit.code));
      }
      addRecent({ code:String(hit.code), name:hit.name || hit.code, at:hit.scanDate,
        reason:snapshot.label, badge:'포착 기록', stage:'hold', basePrice:hit.basePrice });
    });
    current.forEach(function (row) {
      var day = kstDay(row.at);
      if (day === today && timestamp(row.at) <= now) todayCodes.add(String(row.code));
      if (row.stage === 'ready') readyCodes.add(String(row.code));
      addRecent(row);
    });
    var historyDays = Object.keys(buckets).sort();
    var previousDay = historyDays.filter(function (d) { return d < today; }).pop();
    var recordedToday = buckets[today];
    // Compare like-for-like saved scan days only, never a live snapshot against a daily record.
    var comparable = recordedToday && previousDay && recordedToday.size === todayCodes.size;
    var previous = comparable ? buckets[previousDay].size : null;
    var delta = comparable ? todayCodes.size - previous : null;
    var stats = snapshot.stats;
    var todayKnown = (snapshot.historyLoaded || snapshot.currentLoaded) && partialDay !== today;
    return { source:snapshot.source || '', label:snapshot.label || '이력 기준 확인 중', days:days,
      counts:[todayKnown ? todayCodes.size : null, snapshot.currentLoaded ? readyCodes.size : null,
        stats ? count(stats.success) : null, stats ? count(stats.failed) : null],
      delta:delta, deltaPct:previous > 0 ? delta / previous * 100 : null, previousDay:comparable ? previousDay : '',
      points:historyDays.filter(function (d) { return d >= since && d <= today; }).map(function (d) { return {time:d,value:buckets[d].size}; }),
      recent:Object.keys(recent).map(function (code) { return recent[code]; }).sort(function (a,b) {
        return timestamp(b.at) - timestamp(a.at) || a.code.localeCompare(b.code);
      }).slice(0,5), truncated:truncated, partialDay:partialDay,
      loaded:!!(snapshot.historyLoaded || snapshot.currentLoaded), historyLoaded:!!snapshot.historyLoaded, historyError:!!snapshot.historyError };
  }
  global.ScannerDashboard = { model:model, kstDay:kstDay };
  if (!global.document) return;
  var document = global.document, root = document.getElementById('scanner-progress-status');
  if (!root || !root.classList.contains('is-dashboard')) return;
  var esc = function (s) { return global.NineUI.escapeHtml(String(s == null ? '' : s)); };
  var histories = {}, visibleRows = [];
  var latest = null, period = 7, chart = null, chartScope = null, chartVersion = 0, signature = '';
  var panel = document.createElement('div');
  panel.className = 'scan-dashboard-main';
  panel.innerHTML = '<div class="scan-dashboard-stats" aria-label="스캔 요약 통계"></div>'
    + '<div class="scan-dashboard-bottom"><section class="scan-dashboard-trend" aria-labelledby="scan-trend-title">'
    + '<div class="scan-dashboard-heading"><h3 id="scan-trend-title">스캔 추이</h3><div class="scan-dashboard-periods" aria-label="스캔 추이 기간">'
    + [7,30,90].map(function (d) { return '<button type="button" data-scan-days="'+d+'" aria-pressed="'+(d===period)+'">'+d+'일</button>'; }).join('')
    + '</div></div><div class="scan-dashboard-plot" aria-label="일별 포착 종목 수"></div><p class="scan-dashboard-chart-note"></p></section>'
    + '<section class="scan-dashboard-recent" aria-labelledby="scan-recent-title"><div class="scan-dashboard-heading"><h3 id="scan-recent-title">최근 포착 신호</h3>'
    + '<button type="button" class="scan-dashboard-all">전체 보기</button></div><ul class="scan-dashboard-signals"></ul></section></div>'
    + '<p class="scan-dashboard-basis"></p>';
  root.appendChild(panel);
  var statBox = panel.querySelector('.scan-dashboard-stats'), list = panel.querySelector('.scan-dashboard-signals');
  var plot = panel.querySelector('.scan-dashboard-plot');
  function setHtml(element, html) { if (element.dataset.rendered !== html) { element.innerHTML = html; element.dataset.rendered = html; } }
  function timeLabel(at) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(at))) return String(at).replace(/-/g,'.') + ' · 시각 미제공';
    return new Date(timestamp(at)).toLocaleString('ko-KR', {timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  }
  function chartTheme(core) {
    var dark = document.documentElement.classList.contains('dark'), css = global.getComputedStyle(root);
    return { layout:{background:{color:dark ? css.getPropertyValue('--dk-card').trim() || '#202731' : '#fff'},
      textColor:dark ? css.getPropertyValue('--dk-mute').trim() || '#a6b5c5' : '#64748b', fontSize:10},
      grid:{vertLines:{visible:false},horzLines:{color:dark ? css.getPropertyValue('--dk-line').trim() : '#edf0f4'}} };
  }
  function seriesTheme() {
    var color = global.getComputedStyle(root).getPropertyValue('--scan-neon').trim();
    return {lineColor:color,topColor:color+'26',bottomColor:color+'02'};
  }
  function drawChart(value) {
    var next = JSON.stringify([value.source,period,value.points,value.historyLoaded,value.historyError]);
    if (next === signature) return;
    signature = next;
    var version = ++chartVersion;
    if (chartScope) { chartScope.dispose(); chartScope = null; }
    if (chart) { chart.remove(); chart = null; }
    plot.innerHTML = '';
    if (!value.points.length) {
      plot.textContent = value.historyError && !value.historyLoaded ? '스캔 이력을 불러오지 못했습니다. 기존 검색 결과는 유지됩니다.' : value.historyLoaded ? '선택한 기간에 저장된 스캔 이력이 없습니다.' : '스캔 이력을 확인하고 있습니다.';
      return;
    }
    var api = global.PatternScan;
    if (!api || !api.loadChartCore) { plot.textContent = '차트를 불러오지 못했습니다.'; return; }
    api.loadChartCore().then(function (core) {
      return core.loadLibrary().then(function (LWC) { return {core:core,LWC:LWC}; });
    }).then(function (loaded) {
      if (version !== chartVersion || !root.isConnected) return;
      var core = loaded.core, LWC = loaded.LWC;
      chart = LWC.createChart(plot, Object.assign(chartTheme(core), {autoSize:true,
        rightPriceScale:{borderVisible:false,entireTextOnly:true}, timeScale:{borderVisible:false,fixLeftEdge:true,fixRightEdge:true,timeVisible:false},
        handleScroll:false,handleScale:false,localization:{locale:'ko-KR',priceFormatter:function (n) { return Math.round(n).toLocaleString('ko-KR')+'건'; }}}));
      var series = chart.addSeries(LWC.AreaSeries, Object.assign(seriesTheme(), {lineWidth:2,
        priceLineVisible:false,lastValueVisible:false,pointMarkersVisible:value.points.length===1,priceFormat:{type:'price',precision:0,minMove:1}}));
      series.setData(value.points);
      chart.timeScale().fitContent();
      chartScope = core.createScope('scanner-dashboard');
      chartScope.theme(function () { if (chart) { chart.applyOptions(chartTheme(core)); series.applyOptions(seriesTheme()); } });
    }).catch(function () {
      if (version === chartVersion) { plot.textContent = '추이 차트를 불러오지 못했습니다. 기간을 다시 선택해 주세요.'; signature = ''; }
    });
  }
  function render(snapshot) {
    latest = snapshot;
    var history = histories[snapshot && snapshot.source];
    var value = model(Object.assign({}, snapshot, {hits:history && history.data && history.data.hits, historyLoaded:!!(history && history.data), historyError:!!(history && history.error)}),period,Date.now());
    visibleRows = value.recent;
    var labels = ['오늘 포착','돌파 준비','돌파 성공','실패'];
    setHtml(statBox, labels.map(function (label,i) {
      var note = i===0 ? '오늘 · 종목 중복 제외' : i===1 ? '현재 검색 결과' : '최근 90일 이력';
      if (i===0 && value.delta !== null) note = value.previousDay.slice(5).replace('-','/')+' 대비 '+(value.delta>0?'+':'')+value.delta+'건'
        +(value.deltaPct===null?'':' ('+(value.deltaPct>0?'+':'')+value.deltaPct.toFixed(1)+'%)');
      return '<div class="scan-dashboard-stat"><span>'+label+'</span><strong>'+(value.counts[i]===null?'—':value.counts[i].toLocaleString('ko-KR'))+'</strong><small>'+esc(note)+'</small></div>';
    }).join(''));
    setHtml(list, value.recent.length ? value.recent.map(function (row) {
      var code = String(row.code), safeCode = /^\d{6}$/.test(code);
      return '<li><button type="button" class="scan-dashboard-signal" data-scan-code="'+esc(code)+'">'
        + '<span class="scan-dashboard-logo"><span aria-hidden="true">'+esc(String(row.name || code).slice(0,1))+'</span>'
        + (safeCode ? '<img data-icon-code="'+esc(code)+'" data-icon-market="domestic" src="https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/'+encodeURIComponent(code)+'.svg" width="26" height="26" alt="" loading="lazy">' : '')+'</span>'
        + '<span class="scan-dashboard-signal-copy"><span class="scan-dashboard-signal-top"><b>'+esc(row.name)+'</b><time>'+esc(timeLabel(row.at))+'</time></span>'
        + '<span class="scan-dashboard-reason" title="'+esc(row.reason)+'">'+esc(row.reason)+'</span></span><span class="scan-dashboard-badge">'+esc(row.badge)+'</span></button></li>';
    }).join('') : '<li class="scan-dashboard-empty">'+(value.loaded?'최근 포착 신호가 없습니다.':'포착 신호를 확인하고 있습니다.')+'</li>');
    list.querySelectorAll('img').forEach(function (img) {
      img.onerror = function () {
        img.previousElementSibling.hidden=false;
        if (img.getAttribute('data-icon-stage') === 'generated') { img.hidden=true; return; }
        if (global.StockIconFallback) global.StockIconFallback(img);
        else if (!img.dataset.pngTried) { img.dataset.pngTried='1'; img.src=img.src.replace(/\.svg$/,'.png'); }
        else img.hidden=true;
      };
      img.onload = function () { img.previousElementSibling.hidden=true; };
      if (img.complete && img.naturalWidth) img.onload();
    });
    panel.querySelector('.scan-dashboard-basis').textContent = '이력 기준: '+value.label+' · 오늘은 KST 기준 · 성공·실패는 최근 90일 포착 이력';
    panel.querySelector('.scan-dashboard-chart-note').textContent = (history && history.error ? '이력 조회 지연 · ' : '')+'일별 포착 종목 수 · 기록이 있는 날짜만 표시'+(value.truncated?' · 최대 1,500건, 가장 오래된 날짜의 부분 집계 제외':'');
    drawChart(value);
  }
  panel.querySelectorAll('[data-scan-days]').forEach(function (button) {
    button.addEventListener('click',function () {
      period = Number(button.dataset.scanDays);
      panel.querySelectorAll('[data-scan-days]').forEach(function (b) { b.setAttribute('aria-pressed',String(b===button)); });
      render(latest);
    });
  });
  panel.querySelector('.scan-dashboard-all').addEventListener('click',function () {
    if (global.PatternScan) global.PatternScan.showDashboardResults();
  });
  list.addEventListener('click',function (event) {
    var button=event.target.closest('[data-scan-code]');
    if (button && global.PatternScan) global.PatternScan.openDashboardSignal(button.dataset.scanCode, visibleRows.filter(function (r) { return r.code === button.dataset.scanCode; })[0]);
  });
  function update(snapshot) {
    render(snapshot);
    if (!snapshot || !snapshot.source || !global.PatternScan) return;
    var key = snapshot.source, cached = histories[key];
    if (cached && (cached.pending || Date.now()-cached.at < 120000)) return;
    cached = histories[key] = {pending:true,at:Date.now(),data:cached && cached.data};
    var url = 'https://goodbyestar.cloud/scan-performance-public?scanner='+encodeURIComponent(key)
      +'&since='+kstDay(Date.now()-89*86400000)+'&horizons=1&limit=1500';
    global.PatternScan.fetchJson(url).then(function (body) {
      var data = body && body.data || body;
      if (!data || !Array.isArray(data.hits)) throw new Error('Missing scan history');
      histories[key] = {at:Date.now(),data:data};
    }).catch(function () { cached.pending=false; cached.error=true; }).finally(function () {
      if (latest && latest.source===key) render(latest);
    });
  }
  document.addEventListener('pattern-scan-data',function (event) { update(event.detail); });
  update(global.PatternScan && global.PatternScan.dashboardSnapshot ? global.PatternScan.dashboardSnapshot() : null);
})(typeof window === 'undefined' ? globalThis : window);
