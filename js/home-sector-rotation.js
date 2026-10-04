/* 홈 "국내 시장" 카드 하단 업종 로테이션 정보 스트립 (2026-10-04)
   서버(/sector-rotation)가 일봉 확정값으로 계산해 둔 결과만 읽는다. 브라우저는 계산하지 않고,
   장 마감 후에만 값이 바뀌므로 한 번 읽고 10분마다 다시 확인한다. */
(function (global) {
  'use strict';

  var API = 'https://goodbyestar.cloud/sector-rotation';
  // 2026-10-04 사용자 요청("미국장에도 넣어줘"): 홈이 미국 시장일 때(host data-us="1")는 SPDR 섹터 ETF 11개를
  // SPY 대비로 분류한 /us-sector-rotation을 읽는다. 응답 모양은 국내판과 같다.
  var US_API = 'https://goodbyestar.cloud/us-sector-rotation';
  var US_HELP = 'S&P500 섹터 ETF 11개(XLK·XLF 등)를 SPY 대비 상대강도, 최근 5일 순위 변화, 거래대금 강도, ETF가 자기 20일 평균 위에 있는지로 유입 · 주도 · 둔화 · 이탈 단계로 구분합니다. 미국 일봉 종가 기준입니다.';
  var CSS = 'https://goodbyestarwars.github.io/tistory-ticker/css/home-sector-rotation.css?v=20261005-us-v1';
  var COLUMNS = [
    { key: 'emerging', label: '유입', desc: '새롭게 강해지는 업종', cls: 'is-emerging' },
    { key: 'leading', label: '주도', desc: '시장을 이끄는 업종', cls: 'is-leading' },
    { key: 'weakening', label: '둔화', desc: '강도가 약해지는 업종', cls: 'is-weakening' },
    { key: 'lagging', label: '이탈', desc: '관심에서 멀어지는 업종', cls: 'is-lagging' }
  ];
  var PER_COLUMN = 3;
  var HELP = '시장 대비 상대강도, 최근 5일 순위 변화, 업종 내부 확산도와 거래대금을 종합해 유입 · 주도 · 둔화 · 이탈 단계로 구분합니다. 일봉 종가 확정 기준이며 장중에는 바뀌지 않습니다.';
  var PHASE_LABEL = { EMERGING: '유입', LEADING: '주도', WEAKENING: '둔화', LAGGING: '이탈', NEUTRAL: '중립' };
  var data = null;
  var host = null;
  var cache = {};
  function isUs() { return !!host && host.getAttribute('data-us') === '1'; }

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
    return '–';
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

  function groupHtml(col) {
    var items = (data[col.key] || []).slice(0, PER_COLUMN);
    var rows = items.length ? items.map(function (it, i) {
      return '<button type="button" class="hsr-item' + (i === 0 ? ' is-first' : '') + '" data-sector="' + esc(it.sector) + '">'
        + '<span class="hsr-name">' + esc(it.sector.replace(/\//g, '·')) + (it.ticker ? ' <small class="hsr-ticker">' + esc(it.ticker) + '</small>' : '') + '</span>'
        + '<span class="hsr-chg ' + changeCls(it.rankChange5d) + '">' + changeText(it.rankChange5d) + '</span></button>';
    }).join('') : '<div class="hsr-empty"><b>—</b><span>해당 업종 없음</span></div>';
    return '<div class="hsr-col ' + col.cls + '"><div class="hsr-col-head"><div class="hsr-phase"><i class="hsr-dot"></i>' + col.label + '</div>'
      + '<p>' + col.desc + '</p></div><div class="hsr-list">' + rows + '</div></div>';
  }

  function render() {
    if (!host || !data || !data.available) { if (host) host.hidden = true; return; }
    var us = data.market === 'us';
    var help = us ? US_HELP : HELP;
    host.innerHTML = '<div class="hsr-head"><div><div class="hsr-title-row"><strong>' + (us ? '미국 업종 로테이션' : '업종 로테이션') + '</strong>'
      + '<button type="button" class="hsr-help" aria-label="업종 로테이션 설명" title="' + esc(help) + '" data-hsr-help>ⓘ</button></div>'
      + '<p class="hsr-desc">' + (us ? 'S&P500 섹터 ETF를 SPY 대비 상대강도와 최근 순위 변화로 분류합니다.' : '시장 대비 상대강도와 최근 순위 변화를 기준으로 업종 흐름을 분류합니다.') + '</p></div>'
      + '<span class="hsr-meta">5일 기준 · ' + esc(dateLabel(data.date)) + (us ? ' 미국' : '') + ' 종가' + (data.final ? '' : ' (잠정)') + '</span></div>'
      + '<div class="hsr-help-pop" data-hsr-pop hidden>' + esc(help) + '</div>'
      + '<div class="hsr-grid">' + COLUMNS.map(groupHtml).join('') + '</div>'
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
    if (data.market === 'us') {
      box.innerHTML = '<div class="hsr-detail-head"><strong>' + esc(sector) + (it.ticker ? ' · ' + esc(it.ticker) : '') + '</strong><span>' + PHASE_LABEL[it.phase] + '</span>'
        + '<button type="button" class="hsr-close" aria-label="닫기">✕</button></div>'
        + '<div class="hsr-detail-grid">'
        + row('현재 순위', it.rank + '위')
        + row('5일 전', it.rank5DaysAgo == null ? '-' : it.rank5DaysAgo + '위')
        + row('순위 변화', '<em class="' + changeCls(it.rankChange5d) + '">' + changeText(it.rankChange5d) + '</em>')
        + row('5일 수익률', pct(it.return5d))
        + row('5일 SPY 대비', pct(it.rs5))
        + row('20일 SPY 대비', pct(it.rs20))
        + row('20일 평균 위', it.aboveMa20 == null ? '-' : (it.aboveMa20 ? '예' : '아니오'))
        + row('거래대금 강도', it.tradingValueRatio == null ? '-' : it.tradingValueRatio.toFixed(2) + '배')
        + '</div><div class="hsr-note">섹터 ETF 종가 기준 SPY 대비 상대수익. 투자 권유가 아닙니다.</div>';
      box.hidden = false;
      return;
    }
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
    var url = isUs() ? US_API : API;
    if (cache[url] && Date.now() - cache[url].t < 600000) { data = cache[url].data; render(); return; }
    fetch(url).then(function (r) { return r.json(); }).then(function (env) {
      var next = env && env.data ? env.data : env;
      cache[url] = { t: Date.now(), data: next };
      if ((isUs() ? US_API : API) !== url) return; // 그 사이 시장 탭이 바뀐 경우
      data = next;
      render();
    }).catch(function () { if (host) host.hidden = true; });
  }

  function mount(el) {
    host = el;
    ensureCss();
    host.addEventListener('click', function (event) {
      var helpBtn = event.target.closest && event.target.closest('[data-hsr-help]');
      if (helpBtn) { var pop = host.querySelector('[data-hsr-pop]'); if (pop) pop.hidden = !pop.hidden; return; }
      var item = event.target.closest && event.target.closest('.hsr-item');
      if (item) { showDetail(item.getAttribute('data-sector')); return; }
      if (event.target.closest && event.target.closest('.hsr-close')) host.querySelector('[data-hsr-detail]').hidden = true;
    });
    load();
    // 홈의 한국/미국 탭이 바뀌면 skin-main.js가 data-us를 바꾼다 - 그때 맞는 시장 데이터로 다시 그린다.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () { load(); }).observe(host, { attributes: true, attributeFilter: ['data-us'] });
    }
    setInterval(function () { if (!document.hidden) { cache = {}; load(); } }, 600000);
  }

  global.HomeSectorRotation = { mount: mount };
})(window);
