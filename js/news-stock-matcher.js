/* Shared listed-company matcher for public/home news. Reuses KRX_MAP and StockSearchPanel;
 * title-based only, no price/news fetch or theme-stock speculation. */
(function (global) {
  'use strict';
  if (global.NineNewsStocks) return;
  var doc = global.document;
  /* 뉴스 제목에 직접 등장한 상장사만 표시한다. '테마 연관주' 추측이나 시세 조회는 하지 않는다. */
  var stockCatalog = null, stockCatalogMap = null, stockCatalogPanel = null;
  var STOCK_MAP_URL = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js';

  function loadCatalog(url, name, attribute, timeout) {
    if (global[name]) return Promise.resolve();
    return new Promise(function (resolve) {
      var tag = doc.querySelector('script[src*="' + url.slice(url.lastIndexOf('/')) + '"]');
      var timer, finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        global.clearTimeout(timer);
        resolve();
      }
      if (!tag) {
        tag = doc.createElement('script');
        tag.src = url;
        tag.setAttribute(attribute, '1');
      }
      tag.addEventListener('load', finish, { once: true });
      tag.addEventListener('error', finish, { once: true });
      // 종목 사전 실패·지연도 뉴스 자체를 막지 않는다.
      timer = global.setTimeout(finish, timeout);
      if (!tag.parentNode) (doc.head || doc.documentElement).appendChild(tag);
    });
  }

  function loadStockCatalog() { return loadCatalog(STOCK_MAP_URL, 'KRX_MAP', 'data-guest-news-stock-map', 5000); }
  var sectorReady = null;
  function loadSectorCatalog() {
    if (!sectorReady) sectorReady = loadCatalog('https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js', 'SECTOR_MAP', 'data-news-sector-map', 2500);
    return sectorReady;
  }
  function relatedSectors(item) {
    var provided = Array.isArray(item && item.krSectors) ? item.krSectors.filter(function(s){return typeof s === 'string' && s.trim();}) : [];
    var codes = relatedStocks(item).filter(function(stock){return stock.market === 'kr';}).map(function(stock){return stock.code;});
    var map = global.SECTOR_MAP || {};
    Object.keys(map).forEach(function(name){
      if (name.replace(/\s/g,'') === '코스피3대장' || !Array.isArray(map[name])) return;
      if(map[name].some(function(stock){return stock && codes.indexOf(String(stock.code)) >= 0;}))provided.push(name);
    });
    return provided.filter(function(name,i,rows){return rows.indexOf(name) === i;}).slice(0,4);
  }

  function stockCandidates() {
    if (stockCatalog && stockCatalogMap === global.KRX_MAP && stockCatalogPanel === global.StockSearchPanel) return stockCatalog;
    var map = global.KRX_MAP || {};
    var etfs = new Set(global.KRX_ETF_NAMES || []);
    var rows = [];
    Object.keys(map).forEach(function (name) {
      var code = String(map[name] || '');
      // ETF·스팩·우선주·짧은 일반 단어는 기업 매칭 후보에서 제외.
      if (name.length < 3 || !/^[0-9A-Z]{6}$/.test(code) || etfs.has(name) ||
          /(?:우[A-Z0-9]?|스팩|기업인수목적)$/.test(name)) return;
      rows.push({ name: name, code: code, terms: [name].concat(code === '000660' ? ['하이닉스'] : []).concat(code === '035420' ? ['네이버'] : []), market: 'kr' });
    });
    var us = global.StockSearchPanel && global.StockSearchPanel.knownUsStocks
      ? global.StockSearchPanel.knownUsStocks() : [];
    var ignore = { SPCX: 1, SKHY: 1, CBRS: 1, SPY: 1, QQQ: 1 };
    us.forEach(function (row) {
      if (!row || !/^[A-Z]{2,5}$/.test(row.symbol) || ignore[row.symbol]) return;
      var terms = [row.name, row.symbol].concat(String(row.aliases || '').split(/\s+/).filter(function (word) {
        return word.length >= 5 && !/^(?:inc|corporation|technology|technologies|advanced|systems|company|group|global|spacemobile)$/i.test(word);
      }));
      if (row.symbol === 'NVDA') terms = terms.concat(['젠슨 황', '젠슨황', 'Jensen Huang']);
      rows.push({ name: row.name, code: row.symbol, terms: terms, market: 'us' });
    });
    if (stockCatalogMap !== global.KRX_MAP || stockCatalogPanel !== global.StockSearchPanel) stockMatchesCache.clear();
    stockCatalogMap = global.KRX_MAP;
    stockCatalogPanel = global.StockSearchPanel;
    stockCatalog = rows;
    return rows;
  }

  /* 부분문자열 오인식 방지: 독립된 회사명 또는 조사로 끝나는 명시적 언급만 허용한다. */
  function mentionAt(title, term) {
    if (!title || !term) return -1;
    var text = String(title), needle = String(term);
    var low = text.toLowerCase(), target = needle.toLowerCase(), at = 0;
    while ((at = low.indexOf(target, at)) >= 0) {
      var before = at ? text.charAt(at - 1) : '';
      var end = at + needle.length;
      var after = text.slice(end);
      at += 1;
      if (/[a-z0-9가-힣]/i.test(before)) continue;
      if (/^[a-z0-9]/i.test(after)) continue;
      if (/^우(?:[A-Z0-9]|$)/.test(after)) continue;
      if (/^[가-힣]/.test(after) && !/^(?:은|는|이|가|을|를|의|에|와|과|도|만|로|으로|에서|에게|측|발|주가|주식|실적)(?=$|[^a-z0-9]|[가-힣])/i.test(after)) continue;
      // 짧은 영문 약어는 대문자 티커로 명시됐을 때만 종목으로 해석.
      if (/^[a-z]{2,5}$/i.test(needle) && needle === needle.toUpperCase() && text.slice(at - 1, end) !== needle) continue;
      return at - 1;
    }
    return -1;
  }

  var stockMatchesCache = new Map();
  function relatedStocks(item) {
    if (!item) return [];
    var titles = [item.title, item.title_ko].filter(Boolean);
    var catalog = stockCandidates();
    var key = titles.join('\u0001');
    if (stockMatchesCache.has(key)) return stockMatchesCache.get(key).slice();
    var seen = {}, found = [];
    catalog.forEach(function (row) {
      var best = Infinity;
      row.terms.forEach(function (term) {
        if (!term || term.length < 2) return;
        titles.forEach(function (title) {
          var at = mentionAt(title, term);
          if (at >= 0 && at < best) best = at;
        });
      });
      if (best === Infinity || seen[row.market + ':' + row.code]) return;
      seen[row.market + ':' + row.code] = true;
      found.push({ name: row.name, code: row.code, market: row.market, at: best });
    });
    found.sort(function (a, b) { return a.at - b.at || b.name.length - a.name.length; });
    var result = found.slice(0, 3);
    stockMatchesCache.set(key, result);
    if (stockMatchesCache.size > 150) stockMatchesCache.delete(stockMatchesCache.keys().next().value);
    return result.slice();
  }


  // Display-only editorial filter. Raw provider headlines and history stay intact
  // so new classifications can be applied later without recollecting old feeds.
  // Reuse the existing listed-company/verified-alias matcher, not a new stock list.
  var MARKET_TERMS = /(?:증시|주식|주가|지수|코스피|코스닥|나스닥|거래소|채권|국채|기준금리|금리|환율|원\/달러|물가|인플레이션|경제성장|경기침체|경기둔화|고용지표|실업률|외국인\s*(?:순매수|순매도)|기관\s*(?:순매수|순매도)|실적|영업이익|당기순이익|매출액|배당|기업공개|상장|증자|자사주|공모주|유상증자|인수합병|관세|무역전쟁|수출규제|보조금|설비투자|투자유치|수주계약|신용등급|파산|부도|유가|원자재\s*가격)|\b(?:stocks?|shares?|shareholders?|equities|nasdaq|wall street|s&p\s*500|dow jones|earnings?|revenues?|profits?|dividends?|investors?|investments?|fundrais(?:e|ing)|valuations?|ipo|bonds?|treasur(?:y|ies)|yields?|interest rates?|inflation|federal reserve|central bank|economic|economy|gdp|cpi|unemployment|tariffs?|export controls?|sanctions?|mergers?|acquisitions?|buyouts?|bankrupt(?:cy|cies)|securities|capex|crude oil|oil prices?)\b/i;
  var INDUSTRY_TERMS = /(?:인공지능|반도체|데이터센터|전력망|원자력|원전|방산|조선|해운|이차전지|2차전지|배터리|제약|바이오|자동차|정유|철강|수출산업)|\b(?:artificial intelligence|ai|semiconductors?|chipmakers?|foundries|data\s*centers?|hbm|gpus?|cloud infrastructure|electric vehicles?|batter(?:y|ies)|pharma(?:ceutical)?|biotech|defense|shipbuilding|shipping|nuclear power|energy infrastructure)\b/i;
  var BUSINESS_TERMS = /(?:투자|공급|수급|수요|생산|수출|수입|공장|증설|매출|실적|계약|경영|규제|정책|관세|시장|기업|업체|자금|자본|가격|감산|주문|위기|공급망|인수|합병)|\b(?:invest(?:s|ed|ment|ments|ing)?|fund(?:ing|s|ed)?|spend(?:ing|s)?|manufactur(?:e|ing)|produc(?:e|tion)|supply|demand|exports?|imports?|capacity|factory|factories|contracts?|regulat(?:ion|ory|ions)|policy|tariffs?|market|companies|business|industr(?:y|ies)|customers?|order(?:s|ed)?|prices?|sales|strategy|expansion|shortage)\b/i;
  // Product reviews/how-to content is not financial reporting merely because a
  // listed maker is named. Explicit financial reporting still passes.
  var CONSUMER_TERMS = /(?:사용법|사용기|체험기|구매\s*가이드|제품\s*리뷰|앱\s*리뷰|게임\s*리뷰|추천\s*앱|핸즈온)|\b(?:hands.on|review|reviews|how.to|tutorial|buying guide|gift guide|best apps?|best phones?|product test|unboxing)\b/i;

  function isMarketRelevant(item) {
    if (!item) return false;
    if (item.kind === 'disclosure' || item.official === true || item.sourceStatus === 'official-release'
        || item.provider === 'SEC EDGAR') return true;
    var title = [item.title, item.title_ko].filter(Boolean).join(' ').trim();
    if (!title) return false;
    var financial = MARKET_TERMS.test(title);
    if (CONSUMER_TERMS.test(title) && !financial) return false;
    if (relatedStocks(item).length) return true;
    return financial || (INDUSTRY_TERMS.test(title) && BUSINESS_TERMS.test(title));
  }

  global.NineNewsStocks = { relatedStocks: relatedStocks, loadStockCatalog: loadStockCatalog, loadSectorCatalog:loadSectorCatalog, relatedSectors:relatedSectors, isMarketRelevant:isMarketRelevant };
})(window);
