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
  var LOCAL_US_SYMBOLS = [
    { symbol: 'AAPL', name: '애플', aliases: '애플 apple apple inc nasdaq 나스닥' },
    { symbol: 'MSFT', name: '마이크로소프트', aliases: '마이크로소프트 microsoft microsoft corporation nasdaq 나스닥' },
    { symbol: 'NVDA', name: '엔비디아', aliases: '엔비디아 nvidia nvidia corporation nasdaq 나스닥' },
    { symbol: 'AMZN', name: '아마존', aliases: '아마존 amazon amazon.com inc nasdaq 나스닥' },
    { symbol: 'GOOGL', name: '알파벳 A', aliases: '알파벳 google alphabet alphabet inc nasdaq 나스닥' },
    { symbol: 'TSLA', name: '테슬라', aliases: '테슬라 tesla tesla inc nasdaq 나스닥' },
    { symbol: 'META', name: '메타', aliases: '메타 meta meta platforms inc nasdaq 나스닥' },
    { symbol: 'AMD', name: 'AMD', aliases: 'amd advanced micro devices nasdaq 나스닥' },
    { symbol: 'NFLX', name: '넷플릭스', aliases: '넷플릭스 netflix netflix inc nasdaq 나스닥' },
    { symbol: 'QQQ', name: '인베스코 QQQ ETF', aliases: 'qqq invesco qqq trust nasdaq 나스닥' },
    { symbol: 'LLY', name: '일라이 릴리', aliases: '일라이릴리 일라이 릴리 eli lilly lilly nyse' },
    { symbol: 'SKHY', name: 'SK하이닉스(ADR)', aliases: 'SK하이닉스 하이닉스 sk hynix nasdaq' },
    { symbol: 'SPCX', name: '스페이스X', aliases: '스페이스X spacex' },
    { symbol: 'MRVL', name: '마벨 테크놀로지', aliases: '마벨 마벨테크놀로지 marvell marvell technology' },
    { symbol: 'RGTI', name: '리게티 컴퓨팅', aliases: '리게티 rigetti' },
    { symbol: 'RKLB', name: '로켓 랩', aliases: '로켓랩 로켓 랩 rocket lab' },
    { symbol: 'AVGO', name: '브로드컴', aliases: '브로드컴 broadcom broadcom inc' },
    { symbol: 'ORCL', name: '오라클', aliases: '오라클 oracle oracle corporation' },
    { symbol: 'MU', name: '마이크론 테크놀로지', aliases: '마이크론 마이크론테크놀로지 micron' },
    { symbol: 'INTC', name: '인텔', aliases: '인텔 intel intel corp intel corporation' },
    { symbol: 'CBRS', name: '세레브라스 시스템즈', aliases: '세레브라스 cerebras' },
    { symbol: 'PLTR', name: '팔란티어', aliases: '팔란티어 palantir palantir technologies' },
    { symbol: 'SNDK', name: '샌디스크', aliases: '샌디스크 sandisk' },
    { symbol: 'DELL', name: '델 테크놀로지스', aliases: '델 델테크놀로지스 dell dell technologies' },
    { symbol: 'IONQ', name: '아이온큐', aliases: '아이온큐 ionq' },
    { symbol: 'ASTS', name: 'AST 스페이스모바일', aliases: 'ast asts 스페이스모바일 spacemobile' }
  ];
  LOCAL_US_SYMBOLS.forEach(function (row) { names['US:' + row.symbol] = row.name; });
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
    var rows = LOCAL_US_SYMBOLS.filter(function (row) {
      return (row.symbol + ' ' + row.name + ' ' + row.aliases).toLowerCase().indexOf(query) !== -1;
    }).map(function (row) {
      return { code: 'US:' + row.symbol, name: row.name };
    });
    if (!rows.length && /^[a-z][a-z0-9.\-^=]{0,11}$/i.test(query)) {
      rows.push({ code: 'US:' + query.toUpperCase(), name: query.toUpperCase() });
    }
    return rows;
  }
  // 2026-08-21 코드 감사: 자동완성 항목의 종목명·코드가 이스케이프 없이 innerHTML에
  // 그대로 삽입되고 있었다(로컬 목록은 신뢰할 수 있지만, findUsSuggestions가 /us-search
  // 응답의 row.name을 그대로 옮겨 쓰는 경로도 같은 함수를 거침) - 다른 위젯(stock-news.js
  // 등)과 동일하게 이스케이프 후 삽입한다.
  function escapeHtml(s) { return window.NineUI.escapeHtml(s); }

  function closeSuggestions() {
    suggestionBox.classList.remove('is-open');
    suggestionItems = [];
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

  function showSuggestions(value) {
    var seen = new Set();
    var merged = findUsSuggestions(value).concat(findLocalSuggestions(value));
    renderSuggestionResults(merged.filter(function (item) {
      if (seen.has(item.code)) return false;
      seen.add(item.code);
      return true;
    }).slice(0, 8));
  }

  function resolve(value) {
    value = normalize(value);
    if (!value || value === '전체' || value === '일반방' || value === 'all') return '';
    if (/^\d{6}$/.test(value)) return value;
    var query = value.toLowerCase();
    for (var i = 0; i < LOCAL_US_SYMBOLS.length; i++) {
      var local = LOCAL_US_SYMBOLS[i];
      if (local.symbol.toLowerCase() === query || local.name.toLowerCase() === query || local.aliases.toLowerCase().split(' ').indexOf(query) !== -1) {
        return 'US:' + local.symbol;
      }
    }
    if (/^[A-Z][A-Z0-9.\-^=]{0,11}$/i.test(value)) return 'US:' + value.toUpperCase();
    for (var code in names) if (names[code] === value) return code;
    return value;
  }
  var tagPattern = /^\s*\[(\d{6}|US:[A-Z][A-Z0-9.\-^=]{0,11})\]\s*/;
  var entryRooms = new Map();
  entries.forEach(function (entry) {
    var body = entry.querySelector('.discussion-item-body');
    var tag = body && body.textContent.match(tagPattern);
    entryRooms.set(entry, tag ? tag[1] : '');
    if (tag && body.firstChild && body.firstChild.nodeType === 3) {
      body.firstChild.data = body.firstChild.data.replace(tagPattern, '');
    }
  });
  var activeCode = '';
  var renderClassic = function () {};

  function addText(parent, tag, className, text) {
    var element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function messageText(node) {
    if (node.nodeType === 3) return node.data;
    if (node.nodeName === 'BR') return '\n';
    if (node.nodeType !== 1 || node.hidden ||
        /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(node.nodeName)) return '';
    return Array.from(node.childNodes).map(messageText).join('');
  }

  // Edit these three fields to refresh the terminal intro.
  var intro = {
    title: '실패할 수 있는 용기',
    art: [
      '      ▧▨',
      ' ▨▤ ▨▧ ▧▨',
      ' ▥▨▓▓▓▧▨',
      '   ▓▓▓▓',
      '▤▨▓▓▓▓▩▥',
      ' ▧▥▓▓▓ ▤▧',
      '     ▥▧ ▩▥',
      '     ▨▥ ▨₩',
      '           ₩',
      '           ₩',
      ' ▧▨        ₩',
      '   ▨▥▤     ₩',
      '  ▨▥▤▧▥₩',
      '      ▨▤  ₩',
      '            ₩'
    ],
    lines: [
      '눈부신 아침은',
      '하루에 두 번 오지 않습니다.',
      '찬란한 그대 젊음도',
      '인생에 두 번 다시 오지 않습니다.',
      '어처구니 사랑도',
      '슬픔도, 꿈과 이상도',
      '몸부림친 고뇌와 보석과',
      '같은 눈물이 가슴앓이로',
      '젖는 용기입니다.',
      '실패를 겁내지 않는',
      '실패도 할 수 있는 용기도 오롯',
      '그대 젊음의 것입니다.'
    ]
  };

  function setupClassic() {
    var form = root.querySelector('.discussion-native-guestbook');
    var stockbar = root.querySelector('.discussion-stockbar');
    var room = root.querySelector('.discussion-current');
    var heading = root.querySelector('.discussion-heading');
    var nativeHeading = root.querySelector('.discussion-list-heading');
    var nativeList = root.querySelector('.discussion-list');
    if (!form || !stockbar || !room || !nativeHeading) return;

    var panel = document.createElement('section');
    panel.className = 'discussion-terminal';
    panel.setAttribute('aria-label', '클래식 종목 채팅');
    var welcome = addText(panel, 'div', 'discussion-terminal-welcome', '');
    var screen = addText(welcome, 'div', 'discussion-terminal-screen', '');
    var rose = addText(screen, 'pre', 'discussion-terminal-rose', intro.art.join('\n'));
    rose.setAttribute('aria-hidden', 'true');
    var poem = addText(screen, 'div', 'discussion-terminal-poem', '');
    addText(poem, 'h2', '', intro.title);
    addText(poem, 'p', '', intro.lines.join('\n'));
    addText(welcome, 'p', 'discussion-terminal-etiquette', '대화실 이용시 건전한 언어를 사용합시다.');
    var toolbar = addText(panel, 'div', 'discussion-terminal-bar', '');
    var banner = addText(toolbar, 'div', 'discussion-terminal-banner', '');
    addText(banner, 'strong', '', '9PAY PC통신  ▸  종목 채팅');
    addText(banner, 'small', 'discussion-terminal-modem', '56K 로 가느라 좀 느립니다.');
    var refresh = addText(toolbar, 'button', '', '[ 새로고침 ]');
    refresh.type = 'button';
    refresh.addEventListener('click', function () {
      var textarea = form.querySelector('textarea');
      if (!textarea || !textarea.value.trim() || window.confirm('작성 중인 글을 지우고 새로고침할까요?')) {
        location.reload();
      }
    });
    panel.append(stockbar, room);
    var log = addText(panel, 'ol', 'discussion-terminal-log', '');
    log.setAttribute('aria-label', '공개 채팅 목록, 최신 글부터');
    log.tabIndex = 0;
    form.querySelector('.discussion-write-note')?.remove();
    var title = form.querySelector('.discussion-write-title');
    if (title) title.textContent = '> 메시지 입력';
    var help = form.querySelector('.discussion-write-help');
    if (help) help.textContent = '메시지는 현재 보고 있는 방에 표시됩니다.';
    var textarea = form.querySelector('textarea');
    if (textarea) {
      textarea.placeholder = '메시지를 입력하세요.';
      textarea.setAttribute('aria-label', '메시지');
    }
    var submit = form.querySelector('.discussion-write input[type=submit]');
    if (submit) submit.value = '보내기';
    var messages = entries.filter(function (entry) {
      return entry.classList.contains('guest_general') &&
        !entry.hidden && !entry.matches('.guest_secret, .secret, [data-secret="true"]');
    }).map(function (entry) {
      return {
        entry: entry,
        date: entry.querySelector('.discussion-item-head .date'),
        name: entry.querySelector('.discussion-item-head .name'),
        body: entry.querySelector('.discussion-item-body')
      };
    }).filter(function (message) { return message.date && message.name && message.body; });

    renderClassic = function () {
      var visible = messages.filter(function (message) { return !message.entry.hidden; });
      log.replaceChildren();
      log.scrollTop = 0;
      if (!visible.length) addText(log, 'li', '', '표시할 공개 의견이 없습니다.');
      visible.forEach(function (message) {
        var line = addText(log, 'li', '', '');
        addText(line, 'span', 'discussion-terminal-date', Array.from(message.date.childNodes).filter(function (node) { return node.nodeType === 3; }).map(messageText).join('').trim());
        addText(line, 'bdi', 'discussion-terminal-name', message.name.textContent.trim());
        addText(line, 'span', 'discussion-terminal-body', messageText(message.body).trim());
      });
    };

    form.before(panel);
    panel.append(form);
    if (heading) heading.hidden = true;
    root.classList.add('discussion-classic');
    nativeHeading.hidden = true;
    if (nativeList) nativeList.hidden = true;
  }

  function applyFilter(value, updateUrl) {
    var code = resolve(value);
    activeCode = code;
    var label = code ? (names[code] ? names[code] + ' · ' + code : code) : '일반방';
    current.textContent = label;
    input.value = code && names[code] ? names[code] : code;
    buttons.forEach(function (button) {
      var selected = button.getAttribute('data-discussion-stock') === (code || 'all');
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    var shown = 0;
    entries.forEach(function (entry) {
      var match = entryRooms.get(entry) === code;
      entry.hidden = !match;
      if (match) shown++;
    });
    count.textContent = shown ? shown + '개 의견' : '아직 의견이 없습니다';
    renderClassic();
    if (updateUrl && window.history && history.replaceState) {
      var url = new URL(location.href);
      if (code) url.searchParams.set('stock', code); else url.searchParams.delete('stock');
      history.replaceState(null, '', url.toString());
    }
  }
  buttons.forEach(function (button) { button.addEventListener('click', function () { applyFilter(button.getAttribute('data-discussion-stock'), true); }); });
  var generalButton = root.querySelector('[data-discussion-stock="all"]');
  if (generalButton) generalButton.textContent = '일반방';
  var clear = root.querySelector('[data-discussion-clear]');
  clear.textContent = '일반방으로';
  clear.addEventListener('click', function () { applyFilter('', true); });
  input.addEventListener('input', function () {
    if (normalize(input.value)) showSuggestions(input.value);
    else closeSuggestions();
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') return closeSuggestions();
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
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
    var code = activeCode;
    if (!code) return;
    var textarea = root.querySelector('.discussion-write textarea');
    if (textarea && textarea.value.trim() && textarea.value.indexOf('[' + code + ']') !== 0) textarea.value = '[' + code + '] ' + textarea.value;
  }, true);

  var initial = new URLSearchParams(location.search).get('stock') || '';
  setupClassic();
  applyFilter(initial, false);
}());
