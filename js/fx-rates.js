/* 시장지표 > 환율 탭 (2026-10-11)
 *
 * 한국수출입은행이 영업일마다 고시하는 '일별 공식 환율(매매기준율)'을 표로 보여 준다. 실시간 시장환율이 아니다 -
 * 실시간 원/달러는 기존 글로벌 시장지표 탭이 그대로 담당한다.
 *
 * 데이터: VM `GET /fx-rates`(최신 고시일 전 통화 + 전일 대비), `GET /fx-rates/history?cur=USD&range=3m`(추이).
 *   인증키는 VM 서버 환경변수에만 있고 이 파일·브라우저에는 없다. 요청은 VM이 SQLite에 저장해 둔 값만 읽는다.
 * 단위: JPY(100)·IDR(100)처럼 API가 100단위로 주는 통화는 그 기준 단위 그대로 표시한다(1단위로 환산하지 않는다).
 * 차트: 의존성 없는 SVG. 상승(빨강)·하락(파랑) 의미색은 사이트 공통 규칙을 따른다.
 * 테스트 훅: window.FX_RATES_API_BASE 로 API 주소를 바꿀 수 있다(로컬 미리보기용, 기본은 운영 VM).
 */
(function (global) {
  'use strict';

  var ROOT_ID = 'fx-rates';
  var API = global.FX_RATES_API_BASE || 'https://goodbyestar.cloud';
  var REFRESH_MS = 5 * 60 * 1000;
  var HISTORY_TTL_MS = 10 * 60 * 1000;
  var RANGES = [['1m', '1개월'], ['3m', '3개월'], ['1y', '1년']];
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var UP = '#d24f45', DOWN = '#1261c4';

  var root = null, timer = null, busy = false, resizeTimer = null;
  var snapshot = null, snapshotAt = 0, selected = 'USD', range = '3m';
  var historyCache = {}, chartState = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(value, digits) {
    if (value == null || !isFinite(value)) return '-';
    return Number(value).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  /* 환율은 소수 둘째 자리까지가 기본이고, 원자료에 그보다 자세한 값이 있으면 넷째 자리까지 보여 준다. */
  function rate(value) {
    if (value == null || !isFinite(value)) return '-';
    var scaled = Math.abs(value * 100 - Math.round(value * 100));
    return num(value, scaled > 1e-6 ? 4 : 2);
  }

  function tone(value) { return value > 0 ? 'up' : value < 0 ? 'down' : 'flat'; }

  function dayLabel(iso) {
    if (!iso) return '-';
    var d = new Date(iso + 'T00:00:00Z');
    return isNaN(d) ? iso : iso + '(' + WEEKDAYS[d.getUTCDay()] + ')';
  }

  /* 서버 시각은 +09:00(KST) ISO 문자열이다. 시간대를 다시 계산하지 않고 표기만 자른다. */
  function kstStamp(iso) {
    if (!iso || String(iso).length < 16) return '-';
    return String(iso).slice(0, 10) + ' ' + String(iso).slice(11, 16) + ' KST';
  }

  function get(path, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 15000) : null;
    return fetch(API + path, controller ? { signal: controller.signal } : {}).then(function (response) {
      if (!response.ok) throw new Error('http ' + response.status);
      return response.json();
    }).then(function (json) {
      if (!json || json.success !== true || !json.data) throw new Error('bad payload');
      return json.data;
    }).finally(function () { if (timeout) clearTimeout(timeout); });
  }

  /* ---- 화면 뼈대 ---- */
  function shell() {
    return '<div class="fxr">'
      + '<p class="fxr-meta" data-fx-meta>데이터를 불러오는 중입니다.</p>'
      + '<p class="fxr-state" data-fx-state role="status" hidden></p>'
      + '<p class="fxr-note mi-tab-explainer">한국수출입은행의 일별 고시환율입니다. 영업일 오전 11시 이후 공개되므로 장중 실시간 환율과 다르며, 주말·공휴일에는 직전 고시일 값을 표시합니다. JPY·IDR은 100단위 기준이고 TTB·TTS는 은행 송금 적용 환율입니다. 실시간 원/달러는 글로벌 시장지표에서 확인하세요.</p>'
      + '<div class="fxr-tablewrap"><table class="fxr-table" data-fx-table><caption class="fxr-sr">매매기준율·전일 대비·송금환율 표</caption>'
      + '<thead><tr><th scope="col" class="fxr-h-cur">통화 (기준 단위)</th><th scope="col">매매기준율 (원)</th><th scope="col">전일 대비</th><th scope="col">등락률</th>'
      + '<th scope="col" title="송금 받을 때 적용 환율(TTB)">송금 받을 때</th><th scope="col" title="송금 보낼 때 적용 환율(TTS)">송금 보낼 때</th></tr></thead>'
      + '<tbody data-fx-body><tr><td colspan="6" class="fxr-empty">불러오는 중</td></tr></tbody></table></div>'
      + '<section class="fxr-chartsec" aria-live="polite">'
      + '<div class="fxr-charthead"><h3 class="fxr-subtitle" data-fx-chart-title>환율 추이</h3>'
      + '<div class="fxr-range" role="group" aria-label="추이 기간">'
      + RANGES.map(function (r) { return '<button type="button" class="fxr-range-btn' + (r[0] === range ? ' is-active' : '') + '" data-fx-range="' + r[0] + '" aria-pressed="' + (r[0] === range) + '">' + r[1] + '</button>'; }).join('')
      + '</div></div>'
      + '<div class="fxr-chart" data-fx-chart><span class="fxr-empty">추이를 불러오는 중</span></div>'
      + '<dl class="fxr-stats" data-fx-stats hidden></dl>'
      + '<p class="fxr-hint" data-fx-hint></p></section>'
      + '</div>';
  }

  /* ---- 표 ---- */
  function unitText(item) {
    return (item.unit > 1 ? item.unit : 1) + ' ' + item.code + '당';
  }

  /* 표시용 통화명. API 가 주는 이름 중 어색한 표기만 일반적인 한글 표기로 바꾼다(환율 값·코드는 그대로). */
  var DISPLAY_NAMES = { JPY: '일본 엔', CNH: '중국 위안', DKK: '덴마크 크로네', MYR: '말레이시아 링깃' };
  function displayName(item) { return DISPLAY_NAMES[item.code] || item.name || item.code; }

  function rowHtml(item) {
    var t = tone(item.change);
    var arrow = t === 'up' ? '▲' : t === 'down' ? '▼' : '';
    var pctText = item.changeRate == null ? '-' : (item.changeRate > 0 ? '+' : '') + num(item.changeRate, 2) + '%';
    var changeText = item.change == null ? '-' : arrow + ' ' + num(Math.abs(item.change), item.change !== Math.round(item.change * 100) / 100 ? 4 : 2);
    var on = item.code === selected;
    return '<tr class="fxr-row' + (on ? ' is-selected' : '') + '" data-code="' + esc(item.code) + '" tabindex="0" aria-selected="' + on + '">'
      + '<th scope="row" class="fxr-cur"><span class="fxr-name">' + esc(displayName(item)) + '</span> <span class="fxr-code">' + esc(item.code) + '</span><span class="fxr-unit">' + esc(unitText(item)) + '</span></th>'
      + '<td class="fxr-rate"><strong>' + rate(item.dealBasR) + '</strong></td>'
      + '<td class="fxr-chg ' + t + '" data-label="전일 대비" data-short="전일">' + changeText + '</td>'
      + '<td class="fxr-pct ' + t + '" data-label="등락률">' + pctText + '</td>'
      + '<td class="fxr-ttb" data-label="송금 받을 때" data-short="받을 때">' + rate(item.ttb) + '</td>'
      + '<td class="fxr-tts" data-label="송금 보낼 때" data-short="보낼 때">' + rate(item.tts) + '</td></tr>';
  }

  function renderTable() {
    var body = root.querySelector('[data-fx-body]');
    var items = (snapshot && snapshot.currencies) || [];
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="6" class="fxr-empty">' + esc(snapshot && snapshot.stateMessage ? snapshot.stateMessage : '표시할 환율 데이터가 아직 없습니다.') + '</td></tr>';
      return;
    }
    var html = '', section = '';
    items.forEach(function (item) {
      var name = item.featured ? '주요 통화' : '기타 통화';
      if (name !== section) {
        section = name;
        html += '<tr class="fxr-section"><th colspan="6" scope="colgroup">' + name + '</th></tr>';
      }
      html += rowHtml(item);
    });
    body.innerHTML = html;
  }

  function renderMeta() {
    var meta = root.querySelector('[data-fx-meta]');
    var state = root.querySelector('[data-fx-state]');
    if (!snapshot) { meta.textContent = '환율 정보를 불러오지 못했습니다. 잠시 후 다시 확인합니다.'; return; }
    var parts = [];
    parts.push('<span><em>고시 기준일</em> <b>' + esc(dayLabel(snapshot.baseDate)) + '</b></span>');
    if (snapshot.prevDate) parts.push('<span><em>전일 대비 기준</em> ' + esc(dayLabel(snapshot.prevDate)) + '</span>');
    parts.push('<span><em>마지막 수집</em> ' + esc(kstStamp(snapshot.lastCollectedAt)) + '</span>');
    if (snapshot.lastCheckedAt) parts.push('<span><em>마지막 확인</em> ' + esc(kstStamp(snapshot.lastCheckedAt)) + '</span>');
    parts.push('<span><em>출처</em> ' + esc(snapshot.source || '한국수출입은행 환율정보 Open API') + ' · ' + esc(snapshot.kind || '일별 공식 고시환율') + '</span>');
    meta.innerHTML = parts.join('');
    var messages = [];
    if (snapshot.pendingToday && snapshot.baseDate) {
      messages.push('오늘 고시는 영업일 오전 11시경 이후 공개됩니다. 공개 전이거나 공휴일이면 직전 정상 고시일(' + snapshot.baseDate + ') 데이터를 계속 표시합니다.');
    }
    if (snapshot.state && snapshot.state !== 'ok' && snapshot.stateMessage) messages.push(snapshot.stateMessage);
    state.hidden = messages.length === 0;
    state.className = 'fxr-state' + (snapshot.state && snapshot.state !== 'ok' && snapshot.state !== 'collecting' ? ' is-warn' : '');
    state.textContent = messages.join(' ');
  }

  /* ---- 추이 차트(SVG) ---- */
  function currentItem() {
    var items = (snapshot && snapshot.currencies) || [];
    for (var i = 0; i < items.length; i++) if (items[i].code === selected) return items[i];
    return null;
  }

  function chartTitle(item) {
    if (!item) return selected + '/KRW 환율 추이';
    return item.code + '/KRW 환율 추이 · ' + (item.unit > 1 ? item.unit + ' ' + item.code + '당 ' : '') + '매매기준율(원)';
  }

  function pointStats(points) {
    var first = points[0][1], last = points[points.length - 1][1], hi = -Infinity, lo = Infinity, sum = 0, hiDate = '', loDate = '';
    points.forEach(function (p) {
      sum += p[1];
      if (p[1] > hi) { hi = p[1]; hiDate = p[0]; }
      if (p[1] < lo) { lo = p[1]; loDate = p[0]; }
    });
    return { first: first, last: last, hi: hi, lo: lo, hiDate: hiDate, loDate: loDate, avg: sum / points.length, change: last - first, rate: first ? (last - first) / first * 100 : null };
  }

  function niceTicks(lo, hi, count) {
    var span = hi - lo || Math.abs(hi) * 0.01 || 1;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    step *= err >= 5 ? 5 : err >= 2 ? 2 : 1;
    var ticks = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }

  function drawChart(data) {
    var host = root.querySelector('[data-fx-chart]');
    var stats = root.querySelector('[data-fx-stats]');
    var hint = root.querySelector('[data-fx-hint]');
    var points = data && data.points || [];
    if (points.length < 2) {
      host.innerHTML = '<span class="fxr-empty">' + (points.length ? '수집된 고시일이 1일뿐이라 추이를 그릴 수 없습니다.' : '이 통화의 이력이 아직 수집되지 않았습니다.') + '</span>';
      stats.hidden = true;
      hint.textContent = '';
      chartState = null;
      return;
    }
    var width = Math.max(260, host.clientWidth || 640), height = 230;
    var m = { l: 6, r: 58, t: 14, b: 26 };
    var s = pointStats(points);
    var pad = (s.hi - s.lo) * 0.08 || s.hi * 0.002;
    var lo = s.lo - pad, hi = s.hi + pad;
    var x = function (i) { return m.l + (width - m.l - m.r) * (i / (points.length - 1)); };
    var y = function (v) { return m.t + (height - m.t - m.b) * (1 - (v - lo) / (hi - lo)); };
    var color = s.change >= 0 ? UP : DOWN;
    var path = points.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join('');
    var area = path + 'L' + x(points.length - 1).toFixed(1) + ' ' + (height - m.b) + 'L' + x(0).toFixed(1) + ' ' + (height - m.b) + 'Z';
    var grid = niceTicks(lo, hi, 4).map(function (v) {
      return '<line class="fxr-grid" x1="' + m.l + '" x2="' + (width - m.r) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>'
        + '<text class="fxr-axis" x="' + (width - m.r + 6) + '" y="' + (y(v) + 4).toFixed(1) + '">' + num(v, v === Math.round(v) ? 0 : 2) + '</text>';
    }).join('');
    var xlabels = [0, Math.floor((points.length - 1) / 2), points.length - 1].map(function (i, n) {
      var anchor = n === 0 ? 'start' : n === 2 ? 'end' : 'middle';
      return '<text class="fxr-axis" text-anchor="' + anchor + '" x="' + x(i).toFixed(1) + '" y="' + (height - 8) + '">' + esc(points[i][0].slice(2).replace(/-/g, '.')) + '</text>';
    }).join('');
    host.innerHTML = '<svg class="fxr-svg" viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '" role="img" aria-label="' + esc(chartTitle(currentItem())) + '">'
      + grid + '<path class="fxr-area" d="' + area + '" fill="' + color + '"/><path class="fxr-line" d="' + path + '" stroke="' + color + '"/>' + xlabels
      + '<circle class="fxr-last" cx="' + x(points.length - 1).toFixed(1) + '" cy="' + y(s.last).toFixed(1) + '" r="3.5" fill="' + color + '"/>'
      + '<line class="fxr-cross" data-fx-cross y1="' + m.t + '" y2="' + (height - m.b) + '" hidden/><circle class="fxr-dot" data-fx-dot r="4" hidden stroke="' + color + '"/>'
      + '<rect class="fxr-hit" x="' + m.l + '" y="' + m.t + '" width="' + (width - m.l - m.r) + '" height="' + (height - m.t - m.b) + '"/></svg>'
      + '<div class="fxr-tip" data-fx-tip hidden></div>';
    chartState = { points: points, x: x, y: y, width: width, height: height, m: m, unit: data.unit || 1 };
    wireHover(host);
    var t = tone(s.change);
    var cells = [['시작', num(s.first, 2) + ' <small>' + esc(points[0][0]) + '</small>'], ['종료', num(s.last, 2) + ' <small>' + esc(points[points.length - 1][0]) + '</small>'],
      ['기간 변동', '<span class="' + t + '">' + (s.change > 0 ? '+' : '') + num(s.change, 2) + (s.rate == null ? '' : ' (' + (s.rate > 0 ? '+' : '') + num(s.rate, 2) + '%)') + '</span>'],
      ['최고', '<span class="up">' + num(s.hi, 2) + '</span> <small>' + esc(s.hiDate) + '</small>'], ['최저', '<span class="down">' + num(s.lo, 2) + '</span> <small>' + esc(s.loDate) + '</small>'],
      ['평균', num(s.avg, 2)]];
    stats.innerHTML = cells.map(function (c) { return '<div class="fxr-stat"><dt>' + c[0] + '</dt><dd>' + c[1] + '</dd></div>'; }).join('');
    stats.hidden = false;
    var note = '고시일 ' + points.length + '일 · ' + data.from + ' ~ ' + data.to;
    if (data.incomplete) note += ' · 선택한 기간보다 수집된 이력이 짧습니다(실제 시작 ' + data.coverageFrom + '). 과거 고시환율을 순차적으로 채우는 중일 수 있습니다.';
    hint.textContent = note;
  }

  function wireHover(host) {
    var svg = host.querySelector('svg'), hit = host.querySelector('.fxr-hit');
    var cross = host.querySelector('[data-fx-cross]'), dot = host.querySelector('[data-fx-dot]'), tip = host.querySelector('[data-fx-tip]');
    function show(clientX) {
      var rect = svg.getBoundingClientRect();
      var scale = chartState.width / rect.width;
      var px = (clientX - rect.left) * scale, pts = chartState.points, m = chartState.m;
      var i = Math.round((px - m.l) / (chartState.width - m.l - m.r) * (pts.length - 1));
      i = Math.max(0, Math.min(pts.length - 1, i));
      var cx = chartState.x(i), cy = chartState.y(pts[i][1]);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.removeAttribute('hidden');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.removeAttribute('hidden');
      var prev = i ? pts[i - 1][1] : null;
      var diff = prev == null ? '' : '<br>전 고시일 대비 <span class="' + tone(pts[i][1] - prev) + '">' + (pts[i][1] - prev > 0 ? '+' : '') + num(pts[i][1] - prev, 2) + '</span>';
      tip.innerHTML = '<b>' + esc(dayLabel(pts[i][0])) + '</b><br>' + num(pts[i][1], 2) + '원' + (chartState.unit > 1 ? ' (' + chartState.unit + '단위)' : '') + diff;
      tip.hidden = false;
      var left = cx / scale + 10;
      if (left + 150 > rect.width) left = cx / scale - 160;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = Math.max(0, cy / scale - 56) + 'px';
    }
    function hide() { cross.setAttribute('hidden', ''); dot.setAttribute('hidden', ''); tip.hidden = true; }
    hit.addEventListener('pointermove', function (e) { show(e.clientX); });
    hit.addEventListener('pointerdown', function (e) { show(e.clientX); });
    hit.addEventListener('pointerleave', hide);
  }

  /* ---- 데이터 ---- */
  function loadHistory(force) {
    var key = selected + '|' + range, hit = historyCache[key];
    var title = root.querySelector('[data-fx-chart-title]');
    title.textContent = chartTitle(currentItem());
    if (!force && hit && Date.now() - hit.at < HISTORY_TTL_MS) { drawChart(hit.data); return Promise.resolve(); }
    return get('/fx-rates/history?cur=' + encodeURIComponent(selected) + '&range=' + range).then(function (data) {
      historyCache[key] = { at: Date.now(), data: data };
      if (key === selected + '|' + range) drawChart(data);
    }).catch(function () {
      if (key === selected + '|' + range) {
        root.querySelector('[data-fx-chart]').innerHTML = '<span class="fxr-empty">추이를 불러오지 못했습니다. 잠시 후 다시 시도합니다.</span>';
        root.querySelector('[data-fx-stats]').hidden = true;
      }
    });
  }

  function loadSnapshot(force) {
    if (!force && snapshot && Date.now() - snapshotAt < REFRESH_MS) return Promise.resolve();
    return get('/fx-rates').then(function (data) {
      snapshot = data; snapshotAt = Date.now();
      if (!currentItem() && data.currencies && data.currencies.length) selected = data.currencies[0].code;
    }).catch(function () {
      if (!snapshot) snapshot = null;
    }).then(function () { renderMeta(); renderTable(); });
  }

  function active() { return !!root && document.body.contains(root) && root.offsetParent !== null && !document.hidden; }

  function refresh(force) {
    if (busy || !root) return Promise.resolve();
    busy = true;
    return loadSnapshot(force).then(function () { return loadHistory(false); }).finally(function () { busy = false; });
  }

  function select(code) {
    if (!code || code === selected) return;
    selected = code;
    Array.prototype.forEach.call(root.querySelectorAll('.fxr-row'), function (row) {
      var on = row.getAttribute('data-code') === code;
      row.classList.toggle('is-selected', on);
      row.setAttribute('aria-selected', String(on));
    });
    loadHistory(false);
  }

  function bind() {
    root.addEventListener('click', function (event) {
      var rangeBtn = event.target.closest && event.target.closest('[data-fx-range]');
      if (rangeBtn) {
        range = rangeBtn.getAttribute('data-fx-range');
        Array.prototype.forEach.call(root.querySelectorAll('[data-fx-range]'), function (b) {
          var on = b === rangeBtn;
          b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on));
        });
        loadHistory(false);
        return;
      }
      var row = event.target.closest && event.target.closest('.fxr-row');
      if (row) select(row.getAttribute('data-code'));
    });
    root.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target.closest && event.target.closest('.fxr-row');
      if (row) { event.preventDefault(); select(row.getAttribute('data-code')); }
    });
    global.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var hit = historyCache[selected + '|' + range];
        if (active() && hit) drawChart(hit.data);
      }, 150);
    });
  }

  function init() {
    root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (!root.querySelector('.fxr')) {
      root.innerHTML = shell();
      bind();
    }
    // 탭을 열 때마다 호출된다: 보이는 상태에서 다시 그려 숨은 컨테이너의 0폭 차트 문제를 피한다.
    refresh(false).then(function () {
      var hit = historyCache[selected + '|' + range];
      if (hit && active()) drawChart(hit.data);
    });
    if (!timer) timer = setInterval(function () { if (active()) refresh(true); }, REFRESH_MS);
  }

  global.FxRates = { init: init, _util: { rate: rate, num: num, tone: tone, dayLabel: dayLabel, kstStamp: kstStamp, pointStats: pointStats, niceTicks: niceTicks, unitText: unitText, displayName: displayName } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
