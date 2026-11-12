/* Public catalog -> official TradingView widget. No brokerage transport or quote API. */
(function (global) {
  'use strict';
  var doc = global.document, base = 'https://goodbyestarwars.github.io/tistory-ticker/';
  function mount(feed, options) {
  if (!feed || feed.querySelector('.public-stock-chart')) return;
  options = options || {};
  doc.documentElement.classList.remove('home-render-pending', 'access-pending');
  var css = doc.createElement('link'); css.rel = 'stylesheet'; css.href = base + 'css/public-stock-chart.css'; doc.head.appendChild(css);
  feed.innerHTML = '<section class="public-stock-chart ui-content-block" data-no-swipe><h1 class="ui-section-title">국내 종목 차트</h1><p>공개 종목 목록에서 검색하고 TradingView 공식 차트를 확인하세요.</p><div data-public-search></div><div class="public-stock-shortcuts" aria-label="시험 종목"></div><h2 class="ui-section-title" data-public-title>종목을 선택해 주세요</h2><p role="status" data-public-status></p><div data-public-widget></div><p>차트·시세 제공: TradingView. 지원 종목과 지연 여부는 제공사 정책에 따릅니다. 검색 목록에 있어도 위젯에서 지원되지 않을 수 있습니다.</p><p>차트가 비어 있거나 지원되지 않는다는 안내가 나오면 다른 종목을 선택하거나 <a data-public-link target="_blank" rel="noopener noreferrer" href="https://www.tradingview.com/">TradingView에서 확인</a>해 주세요. 외부 위젯 내부의 데이터 수신 여부는 이 화면에서 자동 판별할 수 없습니다. <button type="button" data-public-retry>다시 불러오기</button></p></section>';
  var page = feed.firstElementChild, selected = null, timer, generation = 0;
  var status = page.querySelector('[data-public-status]');
  function open(code, name) {
    if (!/^\d{6}$/.test(code)) return;
    selected = [code, name]; var id = ++generation; clearTimeout(timer);
    var symbol = 'KRX:' + code, url = 'https://www.tradingview.com/symbols/KRX-' + code + '/';
    page.querySelector('[data-public-title]').textContent = name + ' · ' + symbol;
    page.querySelector('[data-public-link]').href = url;
    var verifiedUnavailable = ['005930', '000660', '042660', '006280'].indexOf(code) >= 0;
    var unavailableText = '2026-11-13 확인: 이 종목은 공식 외부 위젯에서 “TradingView에서만 제공되는 심볼”로 표시되어 가격 차트를 제공하지 않았습니다. 아래 TradingView에서 확인 링크를 이용해 주세요.';
    status.textContent = verifiedUnavailable ? unavailableText : 'TradingView 차트를 불러오는 중입니다.';
    var widget = page.querySelector('[data-public-widget]'); widget.replaceChildren();
    var container = doc.createElement('div'); container.className = 'tradingview-widget-container';
    var inner = doc.createElement('div'); inner.className = 'tradingview-widget-container__widget'; container.appendChild(inner);
    var credit = doc.createElement('div'); credit.className = 'tradingview-widget-copyright';
    var link = doc.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener nofollow';
    var span = doc.createElement('span'); span.className = 'blue-text'; span.textContent = name + ' chart'; link.appendChild(span);
    credit.appendChild(link); credit.appendChild(doc.createTextNode(' by TradingView')); container.appendChild(credit);
    var script = doc.createElement('script'); script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'; script.async = true;
    script.textContent = JSON.stringify({autosize:true,symbol:symbol,interval:'D',timezone:'Asia/Seoul',theme:doc.documentElement.classList.contains('dark')?'dark':'light',style:'1',locale:'kr',allow_symbol_change:false,hide_side_toolbar:false,calendar:false,support_host:'https://www.tradingview.com'});
    script.onerror = function () { if (id === generation) { clearTimeout(timer); status.textContent = '외부 차트 로드에 실패했습니다. 네트워크·광고 차단 설정을 확인하고 다시 시도해 주세요.'; } };
    container.appendChild(script); widget.appendChild(container);
    if (!verifiedUnavailable) timer = setTimeout(function () { if (id === generation) status.textContent = '차트가 표시되지 않으면 아래 TradingView 링크에서 지원 여부를 확인해 주세요.'; }, 15000);
    // iframe creation is not evidence of successful market-data rendering.
    var observer = new MutationObserver(function () {
      var frame = container.querySelector('iframe');
      if (frame) { frame.title = name + ' TradingView 공식 차트'; observer.disconnect(); }
    }); observer.observe(container, {childList:true,subtree:true});
    setTimeout(function () { observer.disconnect(); }, 16000);
    if (options.embedded) return;
    var next = new URL(global.location.href); next.searchParams.set('code', code); next.searchParams.set('name', name); global.history.replaceState(null, '', next);
  }
  [['005930','삼성전자'],['000660','SK하이닉스'],['042660','한화오션'],['006280','GC녹십자']].forEach(function (row) {
    var button = doc.createElement('button'); button.type = 'button'; button.textContent = row[1]; button.onclick = function () { open(row[0], row[1]); }; page.querySelector('.public-stock-shortcuts').appendChild(button);
  });
  page.querySelector('[data-public-retry]').onclick = function () { if (selected) open(selected[0], selected[1]); };
  var wasDark = doc.documentElement.classList.contains('dark');
  new MutationObserver(function () {
    var dark = doc.documentElement.classList.contains('dark');
    if (dark !== wasDark) { wasDark = dark; if (selected) open(selected[0], selected[1]); }
  }).observe(doc.documentElement, {attributes:true,attributeFilter:['class']});
  function searchReady() { global.StockSearchPanel.mountDomesticSearch(page.querySelector('[data-public-search]'), open); }
  if (global.StockSearchPanel) searchReady();
  else {
    var s = doc.createElement('script'); s.src = base + 'js/stock-search-panel.js'; s.onload = searchReady;
    s.onerror = function () { page.querySelector('[data-public-search]').textContent = '검색 화면 로드 실패. 새로고침해 주세요.'; }; doc.head.appendChild(s);
  }
  var query = new URLSearchParams(options.embedded ? '' : global.location.search), code = query.get('code');
  if (/^\d{6}$/.test(code || '')) open(code, (query.get('name') || code).slice(0, 80));
  }
  global.NinePublicStockChart = { mount: mount };
  if (global.location.pathname === '/' && new URLSearchParams(global.location.search).get('view') === 'public-chart') mount(doc.querySelector('.feed'));
})(window);

