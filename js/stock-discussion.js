(function () {
  'use strict';

  var root = document.querySelector('[data-market-discussion]');
  if (!root) return;

  var input = root.querySelector('#discussionStockInput');
  var current = root.querySelector('[data-discussion-current]');
  var count = root.querySelector('[data-discussion-count]');
  var entries = Array.prototype.slice.call(root.querySelectorAll('[data-discussion-entry]'));
  var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-discussion-stock]'));
  var names = { '005930': '삼성전자', '000660': 'SK하이닉스', '042660': '한화오션' };
  var US_API_BASE = 'https://goodbyestar.cloud';
  var LOCAL_US_SYMBOLS = [
    { symbol: 'AAPL', name: 'Apple Inc.', aliases: '애플 apple nasdaq 나스닥' },
    { symbol: 'MSFT', name: 'Microsoft Corporation', aliases: '마이크로소프트 microsoft nasdaq 나스닥' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', aliases: '엔비디아 nvidia nasdaq 나스닥' },
    { symbol: 'AMZN', name: 'Amazon.com, Inc.', aliases: '아마존 amazon nasdaq 나스닥' },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', aliases: '알파벳 google nasdaq 나스닥' },
    { symbol: 'TSLA', name: 'Tesla, Inc.', aliases: '테슬라 tesla nasdaq 나스닥' },
    { symbol: 'META', name: 'Meta Platforms, Inc.', aliases: '메타 meta nasdaq 나스닥' },
    { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', aliases: 'amd nasdaq 나스닥' },
    { symbol: 'NFLX', name: 'Netflix, Inc.', aliases: '넷플릭스 netflix nasdaq 나스닥' },
    { symbol: 'QQQ', name: 'Invesco QQQ Trust', aliases: 'qqq nasdaq 나스닥' },
    { symbol: 'LLY', name: 'Eli Lilly and Company', aliases: '일라이릴리 일라이 릴리 eli lilly lilly nyse' },
    { symbol: 'SKHY', name: 'SK하이닉스(ADR)', aliases: 'SK하이닉스 하이닉스 sk hynix nasdaq' },
    { symbol: 'SPCX', name: 'SpaceX', aliases: '스페이스X spacex' },
    { symbol: 'MRVL', name: 'Marvell Technology', aliases: '마벨 마벨테크놀로지 marvell' },
    { symbol: 'RGTI', name: 'Rigetti Computing', aliases: '리게티 rigetti' },
    { symbol: 'RKLB', name: 'Rocket Lab', aliases: '로켓랩 로켓 랩 rocket lab' },
    { symbol: 'AVGO', name: 'Broadcom Inc.', aliases: '브로드컴 broadcom' },
    { symbol: 'ORCL', name: 'Oracle Corporation', aliases: '오라클 oracle' },
    { symbol: 'MU', name: 'Micron Technology', aliases: '마이크론 마이크론테크놀로지 micron' },
    { symbol: 'INTC', name: 'Intel Corporation', aliases: '인텔 intel' },
    { symbol: 'CBRS', name: 'Cerebras Systems', aliases: '세레브라스 cerebras' },
    { symbol: 'PLTR', name: 'Palantir Technologies', aliases: '팔란티어 palantir' },
    { symbol: 'SNDK', name: 'Sandisk', aliases: '샌디스크 sandisk' },
    { symbol: 'DELL', name: 'Dell Technologies', aliases: '델 델테크놀로지스 dell' },
    { symbol: 'IONQ', name: 'IonQ', aliases: '아이온큐 ionq' },
    { symbol: 'ASTS', name: 'AST SpaceMobile', aliases: 'ast asts 스페이스모바일 spacemobile' }
  ];
  var krxMap = window.KRX_MAP || {};
  Object.keys(krxMap).forEach(function (name) { names[krxMap[name]] = name; });
  var suggestionBox = document.createElement('ul');
  suggestionBox.className = 'discussion-stock-suggest';
  suggestionBox.setAttribute('role', 'listbox');
  var inputWrap = input.parentNode;
  if (!inputWrap.classList.contains('discussion-stock-input-wrap')) {
    inputWrap = document.createElement('div');
    inputWrap.className = 'discussion-stock-input-wrap';
    input.parentNode.insertBefore(inputWrap, input);
    inputWrap.appendChild(input);
  }
  inputWrap.appendChild(suggestionBox);
  var suggestionItems = [];
  var suggestionRequestId = 0;

  function normalize(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }
  function initials(value) {
    var cho = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
    return normalize(value).split('').map(function (char) {
      var code = char.charCodeAt(0);
      if (code < 0xAC00 || code > 0xD7A3) return char;
      return cho[Math.floor((code - 0xAC00) / 588)];
    }).join('');
  }
  function findLocalSuggestions(value) {
    var query = normalize(value).toLowerCase();
    if (!query) return [];
    return Object.keys(names).map(function (code) {
      return { code: code, name: names[code] };
    }).filter(function (item) {
      var name = item.name.toLowerCase();
      return name.indexOf(query) !== -1 || item.code.indexOf(query) !== -1 || initials(item.name).indexOf(query) !== -1;
    }).sort(function (a, b) {
      function rank(item) {
        var name = item.name.toLowerCase();
        var initial = initials(item.name);
        if (name === query || item.code === query) return 0;
        if (name.indexOf(query) === 0) return 1;
        if (initial.indexOf(query) === 0) return 2;
        if (name.indexOf(query) !== -1) return 3;
        if (initial.indexOf(query) !== -1) return 4;
        return 5;
      }
      var rankDiff = rank(a) - rank(b);
      if (rankDiff) return rankDiff;
      return a.name.localeCompare(b.name, 'ko');
    }).slice(0, 8);
  }
  function findUsSuggestions(value) {
    var query = normalize(value).toLowerCase();
    var localRows = LOCAL_US_SYMBOLS.filter(function (row) {
      return (row.symbol + ' ' + row.name + ' ' + row.aliases).toLowerCase().indexOf(query) !== -1;
    }).map(function (row) {
      return { code: 'US:' + row.symbol, name: row.name, market: 'us' };
    });
    if (!localRows.length && /^[a-z][a-z0-9.\-^=]{0,11}$/i.test(query)) {
      localRows.push({ code: 'US:' + query.toUpperCase(), name: query.toUpperCase(), market: 'us' });
    }
    if (localRows.length) return Promise.resolve(localRows.slice(0, 8));
    var request = typeof window.fetch === 'function'
      ? window.fetch(US_API_BASE + '/us-search?q=' + encodeURIComponent(value) + '&limit=8')
      : Promise.reject(new Error('fetch unavailable'));
    return request.then(function (response) {
      if (!response.ok) throw new Error('US stock search failed');
      return response.json();
    }).then(function (body) {
      var remoteRows = (body && body.data ? body.data : []).map(function (row) {
        var symbol = String(row.symbol || row.code || '').replace(/^US:/i, '').toUpperCase();
        return { code: 'US:' + symbol, name: row.name || symbol, market: 'us' };
      }).filter(function (row) { return row.code !== 'US:'; });
      var seen = {};
      return localRows.concat(remoteRows).filter(function (row) {
        if (seen[row.code]) return false;
        seen[row.code] = true;
        return true;
      }).slice(0, 8);
    }).catch(function () {
      return localRows.slice(0, 8);
    });
  }
  // 2026-08-21 코드 감사: 자동완성 항목의 종목명·코드가 이스케이프 없이 innerHTML에
  // 그대로 삽입되고 있었다(로컬 목록은 신뢰할 수 있지만, findUsSuggestions가 /us-search
  // 응답의 row.name을 그대로 옮겨 쓰는 경로도 같은 함수를 거침) - 다른 위젯(stock-news.js
  // 등)과 동일하게 이스케이프 후 삽입한다.
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function closeSuggestions() {
    suggestionBox.classList.remove('is-open');
    suggestionItems = [];
  }
  function showSuggestions(value) {
    var results = findSuggestions(value);
    suggestionBox.innerHTML = '';
    suggestionItems = results;
    results.forEach(function (item, index) {
      var li = document.createElement('li');
      li.className = 'discussion-stock-suggest-row';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'discussion-stock-suggest-select';
      button.setAttribute('role', 'option');
      button.setAttribute('data-suggestion-index', index);
      button.innerHTML = '<img class="discussion-stock-suggest-icon" data-icon-code="' + escapeHtml(item.code) + '" src="https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/' + encodeURIComponent(item.code) + '.svg" alt="" onerror="window.StockIconFallback ? window.StockIconFallback(this) : this.style.display=\'none\'">' + '<span class="name">' + escapeHtml(item.name) + '</span><span class="code">' + escapeHtml(item.code) + '</span>';
      button.addEventListener('click', function () {
        input.value = item.name;
        applyFilter(item.code, true);
        closeSuggestions();
        input.focus();
      });
      var favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'discussion-stock-suggest-favorite';
      favorite.setAttribute('aria-label', item.name + ' 관심종목');
      favorite.textContent = '☆';
      favorite.addEventListener('click', function (event) {
        event.stopPropagation();
        favorite.classList.toggle('is-active');
        favorite.textContent = favorite.classList.contains('is-active') ? '★' : '☆';
      });
      li.appendChild(button);
      li.appendChild(favorite);
      suggestionBox.appendChild(li);
    });
    suggestionBox.classList.toggle('is-open', results.length > 0);
  }
  function renderSuggestionResults(results) {
    suggestionBox.innerHTML = '';
    suggestionItems = results;
    results.forEach(function (item, index) {
      var li = document.createElement('li');
      li.className = 'discussion-stock-suggest-row';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'discussion-stock-suggest-select';
      button.setAttribute('role', 'option');
      button.setAttribute('data-suggestion-index', index);
      var iconCode = String(item.code).replace(/^US:/i, '');
      button.innerHTML = '<img class="discussion-stock-suggest-icon" data-icon-code="' + escapeHtml(iconCode) + '" src="https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/' + encodeURIComponent(iconCode) + '.svg" alt="" onerror="window.StockIconFallback ? window.StockIconFallback(this) : this.style.display=\'none\'">' + '<span class="name">' + escapeHtml(item.name) + '</span><span class="code">' + escapeHtml(iconCode) + '</span>';
      button.addEventListener('click', function () {
        names[item.code] = item.name;
        input.value = item.name;
        applyFilter(item.code, true);
        closeSuggestions();
        input.focus();
      });
      var favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'discussion-stock-suggest-favorite';
      favorite.setAttribute('aria-label', item.name + ' 관심종목');
      favorite.textContent = '♡';
      favorite.addEventListener('click', function (event) {
        event.stopPropagation();
        favorite.classList.toggle('is-active');
        favorite.textContent = favorite.classList.contains('is-active') ? '♥' : '♡';
      });
      li.appendChild(button);
      li.appendChild(favorite);
      suggestionBox.appendChild(li);
    });
    suggestionBox.classList.toggle('is-open', results.length > 0);
  }

  showSuggestions = function (value) {
    var requestId = ++suggestionRequestId;
    var localResults = findLocalSuggestions(value);
    renderSuggestionResults(localResults);
    findUsSuggestions(value).then(function (usResults) {
      if (requestId !== suggestionRequestId) return;
      var merged = usResults.concat(localResults);
      var seen = {};
      renderSuggestionResults(merged.filter(function (item) {
        if (seen[item.code]) return false;
        seen[item.code] = true;
        return true;
      }).slice(0, 8));
    });
  };

  function resolve(value) {
    value = normalize(value);
    if (!value || value === '전체' || value === 'all') return '';
    if (/^\d{6}$/.test(value)) return value;
    if (/^[A-Z][A-Z0-9.\-^=]{0,11}$/i.test(value)) return 'US:' + value.toUpperCase();
    for (var i = 0; i < LOCAL_US_SYMBOLS.length; i++) {
      var us = LOCAL_US_SYMBOLS[i];
      if (us.name.toLowerCase() === value.toLowerCase() || us.aliases.toLowerCase().split(' ').indexOf(value.toLowerCase()) !== -1) {
        return 'US:' + us.symbol;
      }
    }
    for (var code in names) if (names[code] === value) return code;
    return value;
  }
  function applyFilter(value, updateUrl) {
    var code = resolve(value);
    var label = code ? (names[code] ? names[code] + ' · ' + code : code) : '전체 종목';
    current.textContent = label;
    input.value = code && names[code] ? names[code] : code;
    buttons.forEach(function (button) { button.classList.toggle('is-active', button.getAttribute('data-discussion-stock') === (code || 'all')); });
    var shown = 0;
    entries.forEach(function (entry) {
      var text = entry.getAttribute('data-discussion-search') || entry.textContent || '';
      entry.setAttribute('data-discussion-search', text);
      var match = !code || text.indexOf('[' + code + ']') !== -1;
      entry.hidden = !match;
      if (match) shown++;
      entry.querySelectorAll('.discussion-item-body').forEach(function (body) {
        if (!body.getAttribute('data-discussion-original')) body.setAttribute('data-discussion-original', body.innerHTML);
        body.innerHTML = body.getAttribute('data-discussion-original').replace(/\[(?:\d{6}|US:[A-Z][A-Z0-9.\-^=]{0,11})\]\s*/g, '');
      });
    });
    count.textContent = code ? (shown ? shown + '개 의견' : '아직 의견이 없습니다') : (entries.length + '개 의견');
    if (updateUrl && window.history && history.replaceState) {
      var url = new URL(location.href);
      if (code) url.searchParams.set('stock', code); else url.searchParams.delete('stock');
      history.replaceState(null, '', url.toString());
    }
  }
  buttons.forEach(function (button) { button.addEventListener('click', function () { applyFilter(button.getAttribute('data-discussion-stock'), true); }); });
  root.querySelector('[data-discussion-clear]').addEventListener('click', function () { applyFilter('', true); });
  input.addEventListener('input', function () {
    if (normalize(input.value)) showSuggestions(input.value);
    else closeSuggestions();
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') return closeSuggestions();
    if (event.key === 'Enter') {
      event.preventDefault();
      if (suggestionItems.length) {
        names[suggestionItems[0].code] = suggestionItems[0].name;
        input.value = suggestionItems[0].name;
        applyFilter(suggestionItems[0].code, true);
        closeSuggestions();
      } else applyFilter(input.value, true);
    }
  });
  document.addEventListener('click', function (event) { if (!input.parentNode.contains(event.target)) closeSuggestions(); });

  root.addEventListener('click', function (event) {
    var submit = event.target.closest && event.target.closest('.discussion-write input[type=submit]');
    if (!submit) return;
    var code = resolve(input.value);
    if (!code) return;
    var textarea = root.querySelector('.discussion-write textarea');
    if (textarea && textarea.value.indexOf('[' + code + ']') !== 0) textarea.value = '[' + code + '] ' + textarea.value;
  }, true);

  var initial = new URLSearchParams(location.search).get('stock') || '';
  applyFilter(initial, false);
}());
