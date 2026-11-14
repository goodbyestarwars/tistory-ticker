(function () {
  'use strict';

  var root = document.querySelector('[data-market-discussion]');
  if (!root) return;
  document.title = 'PC통신';

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
  var returnRoomKey = '9pay.discussion.returnRoom';
  var guestSessionKey = '9pay.discussion.guest';
  var guestFieldsSelector = '.discussion-guest-fields input[name=name], .discussion-guest-fields input[type=password]';
  var showAll = false;
  var renderClassic = function () {};
  // The stock quote feed is manager-only. Never open /ws/quotes for public visitors.
  var roomQuoteSocket = null, roomQuoteRetry = null, roomQuotePing = null;
  function stopRoomQuote() {
    clearTimeout(roomQuoteRetry); clearInterval(roomQuotePing);
    roomQuoteRetry = null; roomQuotePing = null;
    if (roomQuoteSocket) { var old = roomQuoteSocket; roomQuoteSocket = null; old.onclose = null; old.close(); }
  }
  function startRoomQuote(code) {
    stopRoomQuote();
    if (!/^\\d{6}$/.test(code) || document.hidden ||
        !window.NineAccess || !window.NineAccess.isAdmin() || !('WebSocket' in window)) return;
    var badge = document.createElement('span');
    badge.className = 'discussion-current-quote';
    badge.setAttribute('role', 'status');
    badge.textContent = '실시간 시세 연결 중';
    current.appendChild(badge);
    function connect() {
      if (code !== activeCode || document.hidden || !window.NineAccess || !window.NineAccess.isAdmin()) return;
      var socket = new WebSocket('wss://goodbyestar.cloud/ws/quotes?codes=' + encodeURIComponent(code));
      roomQuoteSocket = socket;
      socket.onopen = function () {
        clearInterval(roomQuotePing);
        roomQuotePing = setInterval(function () {
          if (socket.readyState === WebSocket.OPEN) socket.send('ping');
        }, 20000);
      };
      socket.onmessage = function (event) {
        if (socket !== roomQuoteSocket || code !== activeCode) return;
        try {
          var item = JSON.parse(event.data);
          if (item.type === 'quote' && item.code === code && Number(item.price) > 0) {
            var rate = Number(item.changeRate);
            var price = Number(item.price).toLocaleString('ko-KR') + '원';
            badge.textContent = price + (isFinite(rate) ? ' · ' + (rate > 0 ? '+' : '') + rate.toFixed(2) + '%' : '') + (item.delayed ? ' · 지연' : '');
            badge.classList.toggle('is-up', isFinite(rate) && rate > 0);
            badge.classList.toggle('is-down', isFinite(rate) && rate < 0);
          } else if (item.type === 'coverage' && Array.isArray(item.delayed) && item.delayed.indexOf(code) !== -1) {
            badge.textContent = '실시간 등록 대기 · 지연 시세';
          }
        } catch (error) { /* malformed feed ignored */ }
      };
      socket.onerror = function () { socket.close(); };
      socket.onclose = function () {
        clearInterval(roomQuotePing); roomQuotePing = null;
        if (socket !== roomQuoteSocket) return;
        roomQuoteSocket = null; badge.textContent = '시세 연결 지연';
        if (code === activeCode && !document.hidden) roomQuoteRetry = setTimeout(connect, 7000);
      };
    }
    connect();
  }

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

  // Public text is rendered with textContent; writes always require server Google-admin verification.
  function setupIntroEditor(welcome, poem, rose, etiquette) {
    var endpoint = 'https://goodbyestar.cloud/discussion-intro';
    var data = { revision: 0, content: {
      title: intro.title, body: intro.lines.join('\n'), art: intro.art.join('\n'),
      etiquette: etiquette.textContent
    } };
    var edit = addText(welcome, 'button', 'discussion-intro-edit', '문구 편집');
    welcome.insertBefore(edit, etiquette);
    edit.type = 'button'; edit.hidden = true;
    var dialog = null, busy = false;
    function admin() { return !!(window.NineAccess && window.NineAccess.isAdmin()); }
    function syncAdmin() {
      edit.hidden = !admin();
      if (!admin() && dialog && !busy) dialog.close();
    }
    function request(body) {
      return window.NineHttp.json(endpoint, { private: !!body, retries: 0, fetchOptions: {
        method: body ? 'PUT' : 'GET', credentials: 'include', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      } }).then(function (result) {
        if (!result.data || !Number.isInteger(result.data.revision)) throw new Error('response');
        return result.data;
      });
    }
    function apply(saved) {
      if (saved.revision < data.revision) return;
      data.revision = saved.revision;
      if (saved.content) data.content = saved.content;
      poem.querySelector('h2').textContent = data.content.title;
      poem.querySelector('p').textContent = data.content.body;
      rose.textContent = data.content.art;
      etiquette.textContent = data.content.etiquette;
    }
    request().then(apply).catch(function () { /* Preserve the existing intro on read failure. */ });
    if (window.NineAccess) window.NineAccess.ready.then(syncAdmin);
    window.addEventListener('nineaccess:change', syncAdmin);
    window.addEventListener('nineaccess:ready', syncAdmin);
    edit.addEventListener('click', function () {
      if (!admin() || dialog) return;
      dialog = document.createElement('dialog');
      dialog.className = 'discussion-intro-dialog';
      dialog.setAttribute('aria-labelledby', 'discussionIntroTitle');
      dialog.innerHTML = '<form><h2 id="discussionIntroTitle">인트로 문구 편집</h2>' +
        '<p>저장하면 모든 방문자에게 적용됩니다. 줄바꿈은 그대로 표시하며 HTML은 실행되지 않습니다.</p>' +
        '<label>제목 · 최대 100자<input name="title" required maxlength="100"></label>' +
        '<label>본문 · 최대 4,000자<textarea name="body" required maxlength="4000" rows="9"></textarea></label>' +
        '<label>문자 그림 · 최대 2,000자<textarea name="art" maxlength="2000" rows="5" spellcheck="false"></textarea></label>' +
        '<label>하단 안내 · 최대 200자<input name="etiquette" required maxlength="200"></label>' +
        '<p class="discussion-intro-status" role="status" aria-live="polite">불러오는 중…</p>' +
        '<div class="discussion-intro-actions"><button type="button" data-intro-close>닫기</button><button type="submit" disabled>저장</button></div></form>';
      document.body.appendChild(dialog);
      var form = dialog.querySelector('form'), status = dialog.querySelector('[role="status"]');
      var save = form.querySelector('[type="submit"]');
      function close() { if (!busy) dialog.close(); }
      dialog.addEventListener('close', function () { dialog.remove(); dialog = null; edit.focus(); });
      dialog.addEventListener('cancel', function (event) { if (busy) event.preventDefault(); });
      dialog.addEventListener('click', function (event) {
        if (event.target.closest('[data-intro-close]')) close();
        if (event.target === dialog) {
          var r = dialog.getBoundingClientRect();
          if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
        }
      });
      dialog.showModal();
      request().then(function (saved) {
        if (!dialog || !admin()) return;
        apply(saved);
        Object.keys(data.content).forEach(function (key) { form.elements[key].value = data.content[key]; });
        status.textContent = ''; save.disabled = false; form.elements.title.focus();
      }).catch(function () { if (dialog) status.textContent = '읽기에 실패했습니다. 닫고 다시 열어 주세요.'; });
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (busy || !admin() || !form.reportValidity()) return;
        var content = {};
        Object.keys(data.content).forEach(function (key) { content[key] = form.elements[key].value; });
        busy = true; save.disabled = true; status.textContent = '저장 중…';
        request({ content: content, revision: data.revision }).then(function (saved) {
          apply(saved); busy = false; dialog.close();
        }).catch(function () {
          busy = false; save.disabled = false;
          status.textContent = '저장하지 못했습니다. 로그인·글자 수를 확인해 주세요. 다른 곳에서 수정했다면 닫고 다시 열어 주세요.';
        });
      });
    });
  }



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
    var etiquette = addText(welcome, 'p', 'discussion-terminal-etiquette', '대화실 이용시 건전한 언어를 사용합시다.');
    setupIntroEditor(welcome, poem, rose, etiquette);
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
    log.setAttribute('aria-label', '공개 채팅 목록, 오래된 글부터');
    log.tabIndex = 0;
    var adminBar = addText(panel, 'div', 'discussion-terminal-bar', '');
    adminBar.hidden = true;
    log.before(adminBar);
    var all = addText(adminBar, 'button', '', '모든 방 글 보기');
    all.type = 'button';
    all.setAttribute('aria-pressed', 'false');
    function syncDiscussionAdmin() {
      var admin = !!(window.NineAccess && window.NineAccess.isAdmin());
      adminBar.hidden = !admin;
      if (!admin) {
        showAll = false;
        all.setAttribute('aria-pressed', 'false');
        all.textContent = '모든 방 글 보기';
        renderClassic();
      }
    }
    all.addEventListener('click', function () {
      if (!window.NineAccess || !window.NineAccess.isAdmin()) return;
      showAll = !showAll;
      all.setAttribute('aria-pressed', String(showAll));
      all.textContent = showAll ? '현재 방 글 보기' : '모든 방 글 보기';
      renderClassic();
    });
    if (window.NineAccess) window.NineAccess.ready.then(syncDiscussionAdmin);
    window.addEventListener('nineaccess:ready', syncDiscussionAdmin);
    window.addEventListener('nineaccess:change', syncDiscussionAdmin);
    form.querySelector('.discussion-write-note')?.remove();
    var textarea = form.querySelector('textarea');
    if (textarea) {
      form.querySelector('.discussion-write-title')?.remove();
      form.querySelector('.discussion-write-help')?.remove();
      var composer = document.createElement('div');
      composer.className = 'discussion-composer';
      textarea.before(composer);
      var prompt = addText(composer, 'label', 'discussion-composer-prompt', '> 메시지 입력');
      composer.before(prompt);
      textarea.id = 'discussionMessage';
      prompt.htmlFor = textarea.id;
      var inputArea = addText(composer, 'div', 'discussion-composer-input', '');
      inputArea.append(textarea);
      textarea.rows = 2;
      textarea.placeholder = ' ';
      textarea.setAttribute('aria-label', '메시지');
      var guestFields = form.querySelector('.discussion-guest-fields');
      if (guestFields) {
        composer.append(guestFields);
        var savedGuest = [];
        try {
          savedGuest = JSON.parse(sessionStorage.getItem(guestSessionKey) || '[]');
        } catch (error) {
          // The fields can still be filled manually.
        }
        form.querySelectorAll(guestFieldsSelector).forEach(function (field, index) {
          field.required = true;
          if (!field.value && Array.isArray(savedGuest) && typeof savedGuest[index] === 'string') {
            field.value = savedGuest[index];
          }
          field.addEventListener('input', function () {
            try { sessionStorage.removeItem(guestSessionKey); } catch (error) {}
          });
        });
      }
    }
    var submit = form.querySelector('.discussion-write input[type=submit]');
    if (submit) {
      submit.value = '↵';
      submit.setAttribute('aria-label', '보내기');
      submit.title = '보내기 (Ctrl+Enter)';
      submit.setAttribute('aria-keyshortcuts', 'Control+Enter');
      if (textarea) textarea.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' || !event.ctrlKey || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (!event.repeat && textarea.value.trim()) submit.click();
      });
    }
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
      var visible = messages.filter(function (message) { return showAll || !message.entry.hidden; });
      log.replaceChildren();
      if (!visible.length) addText(log, 'li', '', '표시할 공개 의견이 없습니다.');
      visible.reverse().forEach(function (message) {
        var line = addText(log, 'li', '', '');
        addText(line, 'span', 'discussion-terminal-date', Array.from(message.date.childNodes).filter(function (node) { return node.nodeType === 3; }).map(messageText).join('').trim());
        addText(line, 'bdi', 'discussion-terminal-name', message.name.textContent.trim());
        addText(line, 'span', 'discussion-terminal-body', messageText(message.body).trim());
      });
      log.scrollTop = log.scrollHeight;
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
    startRoomQuote(code);
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
  if (generalButton) {
    generalButton.textContent = '일반방';
    var recentHeading = document.createElement('span');
    recentHeading.className = 'discussion-recent-heading';
    recentHeading.textContent = '최근 이야기한 토론방';
    generalButton.insertAdjacentElement('afterend', recentHeading);
  }
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
    var fields = root.querySelectorAll(guestFieldsSelector);
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (field.value.trim()) continue;
      event.preventDefault();
      event.stopImmediatePropagation();
      field.setCustomValidity(field.type === 'password' ? '비밀번호를 입력하세요.' : '이름을 입력하세요.');
      field.reportValidity();
      field.addEventListener('input', function clearValidity(event) {
        event.currentTarget.setCustomValidity('');
      }, { once: true });
      return;
    }
    var textarea = root.querySelector('.discussion-write textarea');
    if (!textarea || !textarea.value.trim()) return;
    var code = activeCode;
    try {
      if (fields.length === 2) {
        sessionStorage.setItem(guestSessionKey, JSON.stringify(Array.from(fields, function (field) {
          return field.value.trim();
        })));
      }
      if (code) sessionStorage.setItem(returnRoomKey, code);
      else sessionStorage.removeItem(returnRoomKey);
    } catch (error) {
      // Posting still works when browser storage is unavailable.
    }
    if (code && textarea.value.indexOf('[' + code + ']') !== 0) textarea.value = '[' + code + '] ' + textarea.value;
  }, true);

  var initial = new URLSearchParams(location.search).get('stock') || '';
  var returnRoom = '';
  try {
    returnRoom = sessionStorage.getItem(returnRoomKey) || '';
    sessionStorage.removeItem(returnRoomKey);
  } catch (error) {
    // The URL still selects the room when browser storage is unavailable.
  }
  setupClassic();
  applyFilter(initial || returnRoom, !initial && !!returnRoom);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopRoomQuote(); else startRoomQuote(activeCode);
  });
  window.addEventListener('nineaccess:ready', function () { startRoomQuote(activeCode); });
  window.addEventListener('nineaccess:change', function () { startRoomQuote(activeCode); });
}());
