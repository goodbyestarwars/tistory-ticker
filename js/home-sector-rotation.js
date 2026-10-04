/* 홈 "국내 시장" 카드 하단 업종 로테이션 정보 스트립 (2026-10-04)
   서버(/sector-rotation)가 일봉 확정값으로 계산해 둔 결과만 읽는다. 브라우저는 계산하지 않고,
   장 마감 후에만 값이 바뀌므로 한 번 읽고 10분마다 다시 확인한다. */
(function (global) {
  'use strict';

  var API = 'https://goodbyestar.cloud/sector-rotation';
  var CSS = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-sector-rotation.css?v=20261004-rotation-v1';
  var COLUMNS = [
    { key: 'emerging', label: '유입', cls: 'is-emerging' },
    { key: 'leading', label: '주도', cls: 'is-leading' },
    { key: 'weakening', label: '둔화', cls: 'is-weakening' },
    { key: 'lagging', label: '이탈', cls: 'is-lagging' }
  ];
  var PER_COLUMN = 3;
  var HELP = '시장 대비 상대강도, 업종 내부 상승 확산도, 거래대금 변화를 분석해 유입·주도·둔화·이탈 단계로 분류합니다. 일봉 종가 확정 기준이며 장중에는 바뀌지 않습니다.';
  var PHASE_LABEL = { EMERGING: '유입', LEADING: '주도', WEAKENING: '둔화', LAGGING: '이탈', NEUTRAL: '중립' };
  var data = null;
  var host = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 순위는 숫자가 작을수록 좋다. 서버가 (과거 순위 - 현재 순위)로 줘서 양수 = 순위 상승(↑)이다.
  function changeText(n) {
    if (n == null) return '·';
    if (n > 0) return '↑' + n;
    if (n < 0) return '↓' + Math.abs(n);
    return '→0';
  }
  function changeCls(n) { return n > 0 ? 'is-up' : (n < 0 ? 'is-down' : 'is-flat'); }
  function pct(v, d) { return v == null ? '-' : (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d) + '%'; }
  function ratio(v) { return v == null ? '-' : Math.round(v * 100) + '%'; }

  function ensureCss() {
    if (document.querySelector('link[data-rotation-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS;
    link.setAttribute('data-rotation-css', '1');
    document.head.appendChild(link);
  }

  function dateLabel(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m ? (m[2] + '.' + m[3]) : '';
  }

  function render() {
    if (!host || !data || !data.available) { if (host) host.hidden = true; return; }
    var cols = COLUMNS.map(function (col) {
      var items = (data[col.key] || []).slice(0, PER_COLUMN);
      var body = items.length ? items.map(function (it) {
        return '<button type="button" class="hsr-item" data-sector="' + esc(it.sector) + '">'
          + '<span class="hsr-name">' + esc(it.sector) + '</span>'
          + '<em class="hsr-chg ' + changeCls(it.rankChange5d) + '">' + changeText(it.rankChange5d) + '</em></button>';
      }).join('') : '<span class="hsr-none">해당 업종 없음</span>';
      return '<div class="hsr-col ' + col.cls + '"><div class="hsr-col-head">' + col.label + '</div>' + body + '</div>';
    }).join('');
    host.innerHTML = '<div class="hsr-head"><strong>업종 로테이션'
      + '<span class="hsr-help" tabindex="0" role="img" aria-label="' + esc(HELP) + '" title="' + esc(HELP) + '">?</span></strong>'
      + '<span class="hsr-meta">5일 기준 · ' + esc(dateLabel(data.date)) + ' 종가' + (data.final ? '' : ' (잠정)') + '</span></div>'
      + '<div class="hsr-grid">' + cols + '</div>'
      + '<div class="hsr-detail" data-hsr-detail hidden></div>';
    host.hidden = false;
  }

  function find(sector) {
    var found = null;
    ['emerging', 'leading', 'weakening', 'lagging', 'neutral'].forEach(function (k) {
      (data[k] || []).forEach(function (it) { if (it.sector === sector) found = it; });
    });
    return found;
  }

  function showDetail(sector) {
    var box = host.querySelector('[data-hsr-detail]');
    var it = find(sector);
    if (!box || !it) return;
    if (!box.hidden && box.getAttribute('data-sector') === sector) { box.hidden = true; return; }
    function row(label, value) { return '<div><small>' + label + '</small><b>' + value + '</b></div>'; }
    box.setAttribute('data-sector', sector);
    box.innerHTML = '<div class="hsr-detail-head"><strong>' + esc(sector) + '</strong><span>' + PHASE_LABEL[it.phase] + '</span>'
      + '<button type="button" class="hsr-close" aria-label="닫기">✕</button></div>'
      + '<div class="hsr-detail-grid">'
      + row('현재 순위', it.rank + '위')
      + row('5일 전', it.rank5DaysAgo == null ? '-' : it.rank5DaysAgo + '위')
      + row('순위 변화', '<em class="' + changeCls(it.rankChange5d) + '">' + changeText(it.rankChange5d) + '</em>')
      + row('5일 상대수익', pct(it.rs5))
      + row('20일 상대수익', pct(it.rs20))
      + row('상승 종목 비율', ratio(it.breadthUpRatio))
      + row('20MA 위 종목', ratio(it.breadthAboveMA20))
      + row('거래대금 강도', it.tradingValueRatio == null ? '-' : it.tradingValueRatio.toFixed(2) + '배')
      + '</div><div class="hsr-leaders" data-hsr-leaders></div>'
      + '<div class="hsr-note">시장 대비 상대수익 기준(업종 구성종목 수익률의 중앙값). 투자 권유가 아닙니다.</div>';
    box.hidden = false;
    fetch(API + '/' + encodeURIComponent(sector)).then(function (r) { return r.json(); }).then(function (env) {
      var d = env && env.data ? env.data : env;
      var el = box.querySelector('[data-hsr-leaders]');
      if (!el || box.getAttribute('data-sector') !== sector || !d || !d.leaders || !d.leaders.length) return;
      el.innerHTML = '<small>대표 강세 종목 (5일 상대수익)</small>' + d.leaders.slice(0, 5).map(function (s) {
        return '<span>' + esc(s.name) + ' <em class="' + (s.excess5d > 0 ? 'is-up' : 'is-down') + '">' + pct(s.excess5d) + '</em></span>';
      }).join('');
    }).catch(function () { /* 상세는 보조 정보라 실패해도 화면을 막지 않는다 */ });
  }

  function load() {
    fetch(API).then(function (r) { return r.json(); }).then(function (env) {
      data = env && env.data ? env.data : env;
      render();
    }).catch(function () { if (host) host.hidden = true; });
  }

  function mount(el) {
    host = el;
    ensureCss();
    host.addEventListener('click', function (event) {
      var item = event.target.closest && event.target.closest('.hsr-item');
      if (item) { showDetail(item.getAttribute('data-sector')); return; }
      if (event.target.closest && event.target.closest('.hsr-close')) host.querySelector('[data-hsr-detail]').hidden = true;
    });
    load();
    setInterval(function () { if (!document.hidden) load(); }, 600000);
  }

  global.HomeSectorRotation = { mount: mount };
})(window);
