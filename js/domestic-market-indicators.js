(function (global) {
  'use strict';

  var API_URL = 'https://goodbyestar.cloud/domestic-market-indicators';
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var KST_OFFSET_SEC = 9 * 60 * 60;
  var chartInstances = {};
  var lwcPromise = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fetchJson() {
    return fetch(API_URL, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.success === false) throw new Error('invalid response');
      return payload.data || payload;
    });
  }

  function loadCharts() {
    if (global.LightweightCharts) return Promise.resolve(global.LightweightCharts);
    if (lwcPromise) return lwcPromise;
    lwcPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = LWC_CDN;
      script.onload = function () { resolve(global.LightweightCharts); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return lwcPromise;
  }

  function installStyle() {
    if (document.getElementById('dmi-style')) return;
    var link = document.createElement('link');
    link.id = 'dmi-style';
    link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/domestic-market-indicators.css';
    document.head.appendChild(link);
  }

  function formatNumber(value) {
    if (value == null || isNaN(Number(value))) return '-';
    return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  }

  function formatFunds(value, unit) {
    if (value == null || isNaN(Number(value))) return '-';
    var amount = Number(value);
    if (unit === 'million_krw') amount *= 1000000;
    if (unit === 'hundred_million_krw') amount *= 100000000;
    if (amount >= 1000000000000) return (amount / 1000000000000).toFixed(1) + '조원';
    if (amount >= 100000000) return (amount / 100000000).toFixed(1) + '억원';
    return formatNumber(amount) + '원';
  }

  function signed(value) {
    if (value == null || isNaN(Number(value))) return '-';
    var number = Number(value);
    return (number > 0 ? '+' : '') + formatNumber(number);
  }

  function pointFor(row, interval) {
    if (!row || row.open == null || row.high == null || row.low == null || row.close == null) return null;
    return {
      time: interval === 'minute' ? Number(row.ts) + KST_OFFSET_SEC : row.date,
      open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close)
    };
  }

  function makeChart(key, element, rows, interval) {
    var points = (rows || []).map(function (row) { return pointFor(row, interval); }).filter(Boolean);
    if (points.length < 2) {
      element.innerHTML = '<div class="dmi-chart-message">추이 데이터 없음</div>';
      return;
    }
    loadCharts().then(function (LWC) {
      if (!document.body.contains(element)) return;
      var current = chartInstances[key];
      if (current && current.interval === interval) {
        current.series.setData(points);
        return;
      }
      if (current) current.chart.remove();
      element.innerHTML = '';
      var chart = LWC.createChart(element, {
        autoSize: true,
        height: 330,
        layout: { background: { color: 'transparent' }, textColor: '#000' },
        grid: { vertLines: { color: '#edf1f5' }, horzLines: { color: '#edf1f5' } },
        crosshair: { mode: LWC.CrosshairMode.Normal },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: interval === 'minute', secondsVisible: false },
      });
      var series = chart.addCandlestickSeries({
        upColor: '#d84f48', downColor: '#1767c7',
        borderUpColor: '#d84f48', borderDownColor: '#1767c7',
        wickUpColor: '#d84f48', wickDownColor: '#1767c7'
      });
      series.setData(points);
      chart.timeScale().fitContent();
      chartInstances[key] = { chart: chart, series: series, interval: interval };
    }).catch(function () {
      element.innerHTML = '<div class="dmi-chart-message">차트 라이브러리를 불러오지 못했습니다.</div>';
    });
  }

  function renderCharts(root, indices) {
    var intervals = ['minute', 'day', 'week'];
    Object.keys(indices || {}).forEach(function (market) {
      var item = indices[market] || {};
      var panel = root.querySelector('[data-dmi-panel="' + market + '"]');
      if (!panel) return;
      var active = panel.getAttribute('data-dmi-interval') || 'day';
      var chart = panel.querySelector('.dmi-chart');
      var source = item.intervals && item.intervals[active];
      panel.querySelector('.dmi-provider').textContent = source && source.source ? '출처: ' + source.source : '데이터 준비 중';
      makeChart(market, chart, source && source.rows, active);
      panel.querySelectorAll('.dmi-tab').forEach(function (button) {
        button.classList.toggle('is-active', button.getAttribute('data-interval') === active);
      });
    });
  }

  function chartPanel(market, item) {
    return '<section class="dmi-panel" data-dmi-panel="' + market + '" data-dmi-interval="day">'
      + '<div class="dmi-panel-title"><span>' + escapeHtml(item.name || market) + '</span><span class="dmi-provider">데이터 준비 중</span></div>'
      + '<div class="dmi-tabs" role="tablist">'
      + ['minute', 'day', 'week'].map(function (interval) {
        var label = { minute: '분봉', day: '일봉', week: '주봉' }[interval];
        return '<button type="button" class="dmi-tab' + (interval === 'day' ? ' is-active' : '') + '" data-interval="' + interval + '">' + label + '</button>';
      }).join('')
      + '</div><div class="dmi-chart" aria-label="' + escapeHtml(item.name || market) + ' 표준 차트"></div></section>';
  }

  function renderInvestor(root, investor) {
    var html = Object.keys(investor || {}).map(function (market) {
      var item = investor[market] || {};
      var rows = (item.rows || []).slice(-10);
      return '<section class="dmi-flow-card"><div class="dmi-flow-title">' + market + '</div>'
        + '<table class="dmi-flow-table"><thead><tr><th>일자</th><th>개인</th><th>외국인</th><th>기관</th></tr></thead><tbody>'
        + (rows.length ? rows.map(function (row) {
          function cell(value) {
            var cls = Number(value) > 0 ? 'dmi-positive' : Number(value) < 0 ? 'dmi-negative' : '';
            return '<td class="' + cls + '">' + signed(value) + '</td>';
          }
          return '<tr><td>' + escapeHtml(row.label || '-') + '</td>' + cell(row.individual) + cell(row.foreign) + cell(row.institution) + '</tr>';
        }).join('') : '<tr><td colspan="4">데이터 준비 중</td></tr>')
        + '</tbody></table></section>';
    }).join('');
    root.querySelector('.dmi-flow-grid').innerHTML = html;
  }

  function renderFunds(root, funds) {
    funds = funds || {};
    var credit = funds.credit || {};
    var deposits = funds.market_funds || {};
    root.querySelector('.dmi-fund-grid').innerHTML = [
      '<article class="dmi-fund-card"><span class="dmi-fund-label">신용잔고</span><strong class="dmi-fund-value">' + formatFunds(credit.loan_total, funds.credit_unit) + '</strong><span class="dmi-fund-date">' + escapeHtml(credit.date || funds.latest_date || '-') + '</span></article>',
      '<article class="dmi-fund-card"><span class="dmi-fund-label">고객예탁금</span><strong class="dmi-fund-value">' + formatFunds(deposits.investor_deposits, funds.market_funds_unit) + '</strong><span class="dmi-fund-date">' + escapeHtml(deposits.date || funds.latest_date || '-') + '</span></article>'
    ].join('');
    root.querySelector('.dmi-funds-provider').textContent = funds.source ? '출처: ' + funds.source : '데이터 준비 중';
  }

  function init() {
    var root = document.getElementById('domestic-market-indicators');
    if (!root || root.getAttribute('data-dmi-ready') === '1') return;
    root.setAttribute('data-dmi-ready', '1');
    installStyle();
    root.innerHTML = '<div class="dmi-shell">'
      + '<div class="dmi-heading"><h2>국내시장지표</h2></div>'
      + '<div class="dmi-subheading"><h3>코스피 · 코스닥 주간현물 (09:00~15:45)</h3><span class="dmi-muted">분봉 · 일봉 · 주봉</span></div>'
      + '<div class="dmi-chart-grid">' + chartPanel('KOSPI', { name: '코스피' }) + chartPanel('KOSDAQ', { name: '코스닥' }) + '</div>'
      + '<div class="dmi-subheading"><h3>투자자별 매매동향</h3><span class="dmi-muted">개인 · 외국인 · 기관</span></div>'
      + '<div class="dmi-flow-grid"><div class="dmi-flow-card">데이터 준비 중</div><div class="dmi-flow-card">데이터 준비 중</div></div>'
      + '<div class="dmi-subheading"><h3>증시자금</h3><span class="dmi-funds-provider dmi-muted">데이터 준비 중</span></div>'
      + '<div class="dmi-fund-grid"><div class="dmi-fund-card">데이터 준비 중</div><div class="dmi-fund-card">데이터 준비 중</div></div>'
      + '</div>';
    fetchJson().then(function (data) {
      root._dmiData = data;
      renderCharts(root, data.indices || {});
      renderInvestor(root, data.investor || {});
      renderFunds(root, data.funds || {});
    }).catch(function () {
      root.querySelector('.dmi-shell').insertAdjacentHTML('beforeend', '<div class="dmi-error">국내시장지표 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>');
    });
    root.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('.dmi-tab') : null;
      if (!button) return;
      var panel = button.closest('[data-dmi-panel]');
      if (!panel) return;
      panel.setAttribute('data-dmi-interval', button.getAttribute('data-interval'));
      // The response is kept on the root so changing tabs never triggers an
      // extra provider request or changes the chart's data source.
      var data = root._dmiData;
      if (data) renderCharts(root, data.indices || {});
    });
  }

  global.DomesticMarketIndicators = { init: init };
})(window);
