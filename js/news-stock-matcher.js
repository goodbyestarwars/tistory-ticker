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


  global.NineNewsStocks = { relatedStocks: relatedStocks, loadStockCatalog: loadStockCatalog, loadSectorCatalog:loadSectorCatalog, relatedSectors:relatedSectors };
})(window);
