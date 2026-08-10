/* 홈 상단 경제 종합뉴스: 국내 뉴스·공시 API의 최신 항목을 compact timeline으로 표시한다. */
(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/domestic-news?limit=10';
  var REFRESH_MS = 5 * 60 * 1000;
  var state = { mount: null, timer: null };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function parseDate(value) {
    var text = String(value || '').trim();
    if (/^\d{8}$/.test(text)) {
      text = text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6) + 'T00:00:00+09:00';
    }
    return new Date(text);
  }

  function dateValue(value) {
    var parsed = parseDate(value);
    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  function timeLabel(value) {
    var parsed = parseDate(value);
    if (isNaN(parsed.getTime())) return '--:--';
    return parsed.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function kindLabel(item) {
    if (item && item.kind === 'disclosure') return '공시';
    return item && item.category && item.category !== '일반' ? item.category : '뉴스';
  }

  function render(items) {
    var list = state.mount.querySelector('[data-hen-list]');
    var updated = state.mount.querySelector('[data-hen-updated]');
    var rows = (items || []).slice().sort(function (a, b) {
      var disclosure = Number(b.kind === 'disclosure') - Number(a.kind === 'disclosure');
      return disclosure || dateValue(b.pubDate) - dateValue(a.pubDate);
    }).slice(0, 8);
    if (!rows.length) {
      list.innerHTML = '<p class="home-card-state">현재 표시할 경제 뉴스가 없습니다.</p>';
      return;
    }
    list.innerHTML = rows.map(function (item, index) {
      var tone = item.kind === 'disclosure' ? ' is-disclosure' : '';
      return '<a class="hen-row' + tone + '" href="' + escapeHtml(item.link || '#') + '" target="_blank" rel="noopener">'
        + '<span class="hen-rail"><i class="' + (index === 0 ? 'is-latest' : '') + '"></i></span>'
        + '<time>' + escapeHtml(timeLabel(item.pubDate)) + '</time>'
        + '<span class="hen-main"><strong>' + escapeHtml(item.title || '') + '</strong>'
        + '<small><em>' + escapeHtml(kindLabel(item)) + '</em>' + escapeHtml(item.source || item.provider || '') + '</small></span>'
        + '</a>';
    }).join('');
    if (updated) updated.textContent = '업데이트 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  function fetchNews() {
    return fetch(API_URL).then(function (response) {
      if (!response.ok) throw new Error('economic-news ' + response.status);
      return response.json();
    }).then(function (json) {
      var payload = json.data || json;
      render(payload.items || []);
    }).catch(function () {
      var list = state.mount && state.mount.querySelector('[data-hen-list]');
      if (list && !list.querySelector('.hen-row')) list.innerHTML = '<p class="home-card-state">경제 뉴스를 잠시 불러오지 못했습니다.</p>';
    });
  }

  function init(options) {
    var mount = options && options.mount;
    if (!mount || mount.getAttribute('data-hen-ready') === '1') return;
    state.mount = mount;
    mount.setAttribute('data-hen-ready', '1');
    fetchNews();
    state.timer = setInterval(function () { if (!document.hidden) fetchNews(); }, REFRESH_MS);
  }

  global.HomeEconomicNews = { init: init };
})(window);
