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
  var krxMap = window.KRX_MAP || {};
  Object.keys(krxMap).forEach(function (name) { names[krxMap[name]] = name; });
  var suggestionBox = document.createElement('ul');
  suggestionBox.className = 'discussion-stock-suggest';
  suggestionBox.setAttribute('role', 'listbox');
  input.parentNode.appendChild(suggestionBox);
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
  function findSuggestions(value) {
    var query = normalize(value).toLowerCase();
    if (!query) return [];
    return Object.keys(names).map(function (code) {
      return { code: code, name: names[code] };
    }).filter(function (item) {
      var name = item.name.toLowerCase();
      return name.indexOf(query) !== -1 || item.code.indexOf(query) !== -1 || initials(item.name).indexOf(query) !== -1;
    }).sort(function (a, b) {
      var aExact = a.name.toLowerCase() === query || a.code === query;
      var bExact = b.name.toLowerCase() === query || b.code === query;
      if (aExact !== bExact) return aExact ? -1 : 1;
      return a.name.localeCompare(b.name, 'ko');
    }).slice(0, 10);
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
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.setAttribute('data-suggestion-index', index);
      button.innerHTML = '<span>' + item.name + '</span><span class="code">' + item.code + '</span>';
      button.addEventListener('click', function () {
        input.value = item.name;
        applyFilter(item.code, true);
        closeSuggestions();
        input.focus();
      });
      li.appendChild(button);
      suggestionBox.appendChild(li);
    });
    suggestionBox.classList.toggle('is-open', results.length > 0);
  }
  function resolve(value) {
    value = normalize(value);
    if (!value || value === '전체' || value === 'all') return '';
    if (/^\d{6}$/.test(value)) return value;
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
        body.innerHTML = body.getAttribute('data-discussion-original').replace(/\[\d{6}\]\s*/g, '');
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
  input.addEventListener('input', function () { showSuggestions(input.value); });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') return closeSuggestions();
    if (event.key === 'Enter') {
      event.preventDefault();
      if (suggestionItems.length) {
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
