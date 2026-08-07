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

  function normalize(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
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
  input.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); applyFilter(input.value, true); } });

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
