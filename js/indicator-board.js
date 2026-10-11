/* 시장지표 공용 '표 + 추이 차트' 부품 (2026-10-12)
 *
 * 환율 탭(js/fx-rates.js)과 같은 모양 - 신문식 표 한 장 + 선택한 지표의 추이 차트(기간 버튼·시작/종료/기간 변동/최고/최저/평균).
 * 글로벌 시장지표·주요 미국 발표·가상자산·증시자금이 카드 대신 이 부품을 쓴다. 데이터는 각 탭이 가져오고, 이 부품은 그리기만 한다.
 *
 * 사용: var board = IndicatorBoard.create(hostElement, { columns: [...5개], ranges: [...], defaultRange: '3m' });
 *       board.setRows(rows, groups);   // 값이 바뀔 때마다 다시 불러도 된다(선택·포커스·차트 호버를 유지하며 바뀐 칸만 고친다)
 *   column : { label: '현재값', short: '현재' }                  - 표 머리글(short 는 모바일 두 번째 줄 라벨)
 *   row    : { id, group, name, code, sub, cells: [{ t: '1,339.20', tone: 'up'|'down'|'flat' }, ...5개],
 *              series: [['2026-10-08', 1339.2], ...], fmt: fn(v), axisFmt: fn(v), dateUnit: 'day'|'month',
 *              note: '<p>…</p>'(차트 아래 설명 HTML), loading: true, title: '차트 제목' }
 *   group  : { key, label, hint }
 * 상승 = 빨강, 하락 = 파랑(사이트 공통). 차트는 의존성 없는 SVG.
 *
 * createChart(host, { height }) (2026-10-12): 표 없이 다중 시계열만 그리는 차트. 묶음 막대(양수 0선 위·음수 아래)·여러 선·오른쪽 보조 축·기준선,
 *   범례로 계열 켜고 끄기, 호버/터치로 날짜별 수치, 억·조 원 단위(fmtEok). 국내 증시 자금 흐름(js/investor-flow.js)이 쓴다.
 */
(function (global) {
  'use strict';
  if (global.IndicatorBoard) return;

  var UP = '#d24f45', DOWN = '#1261c4';
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var DEFAULT_RANGES = [{ key: '1m', label: '1개월', days: 31 }, { key: '3m', label: '3개월', days: 92 }, { key: '1y', label: '1년', days: 366 }];
  var SEQ = 0;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(value, digits) {
    if (value == null || !isFinite(value)) return '-';
    return Number(value).toLocaleString('ko-KR', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }

  function signed(value, digits) {
    if (value == null || !isFinite(value)) return '-';
    return (value > 0 ? '+' : '') + num(value, digits);
  }

  function tone(value) { return value > 0 ? 'up' : value < 0 ? 'down' : 'flat'; }

  /* 'YYYYMMDD'·'YYYY-MM-DD'·'YYYYMM' 모두 'YYYY-MM-DD'로 맞춘다. 모르는 모양이면 ''. */
  function isoDate(value) {
    var s = String(value == null ? '' : value).trim();
    if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (/^\d{6}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-01';
    return '';
  }

  /* [{date, close}] 같은 행 배열 -> [['YYYY-MM-DD', 숫자], …] (날짜 오름차순, 같은 날짜는 뒤의 값, 숫자가 아니면 제외) */
  function series(rows, dateKey, valueKey) {
    var byDate = {};
    (rows || []).forEach(function (row) {
      if (!row) return;
      var date = isoDate(row[dateKey || 'date']);
      var value = row[valueKey || 'close'];
      if (!date || value == null || value === '' || !isFinite(Number(value))) return;
      byDate[date] = Number(value);
    });
    return Object.keys(byDate).sort().map(function (date) { return [date, byDate[date]]; });
  }

  function dayMs(iso) { return Date.parse(iso + 'T00:00:00Z'); }

  function dayLabel(iso) {
    var d = new Date(dayMs(iso));
    return isNaN(d) ? iso : iso + '(' + WEEKDAYS[d.getUTCDay()] + ')';
  }

  /* 마지막 자료 날짜에서 days일 전까지만 자른다. 자료가 그보다 짧으면 incomplete 로 알린다(월간 자료는 간격이 넓어 여유를 둔다). */
  function sliceRange(points, days) {
    if (!points || !points.length) return { points: [], incomplete: false, cutoff: '' };
    var last = dayMs(points[points.length - 1][0]);
    var cutoff = new Date(last - days * 86400000).toISOString().slice(0, 10);
    var out = points.filter(function (p) { return p[0] >= cutoff; });
    var gaps = [];
    for (var i = 1; i < points.length && gaps.length < 40; i++) gaps.push((dayMs(points[i][0]) - dayMs(points[i - 1][0])) / 86400000);
    gaps.sort(function (a, b) { return a - b; });
    var median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
    var tolerance = Math.max(6, median * 1.6 + 3);
    var incomplete = (dayMs(out[0][0]) - dayMs(cutoff)) / 86400000 > tolerance;
    return { points: out, incomplete: incomplete, cutoff: cutoff };
  }

  function pointStats(points) {
    var first = points[0][1], last = points[points.length - 1][1], hi = -Infinity, lo = Infinity, sum = 0, hiDate = '', loDate = '';
    points.forEach(function (p) {
      sum += p[1];
      if (p[1] > hi) { hi = p[1]; hiDate = p[0]; }
      if (p[1] < lo) { lo = p[1]; loDate = p[0]; }
    });
    return { first: first, last: last, hi: hi, lo: lo, hiDate: hiDate, loDate: loDate, avg: sum / points.length,
      change: last - first, rate: first ? (last - first) / Math.abs(first) * 100 : null };
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

  /* 값 서식(fmt)이 부호를 스스로 붙이는 경우(예: '+1.2조원')와 아닌 경우를 모두 받아, 양수에 '+'가 한 번만 붙게 한다. */
  function withSign(value, fmt) {
    var text = fmt(value);
    return value > 0 && text.charAt(0) !== '+' ? '+' + text : text;
  }

  function defaultFmt(v) {
    var abs = Math.abs(v);
    return num(v, abs >= 1000 ? 0 : abs >= 100 ? 1 : 2);
  }

  /* ---- 부품 만들기 ---- */
  function create(host, options) {
    var opts = options || {};
    var columns = opts.columns || [];
    var ranges = opts.ranges && opts.ranges.length ? opts.ranges : DEFAULT_RANGES;
    var range = opts.defaultRange || ranges[Math.min(1, ranges.length - 1)].key;
    var prevLabel = opts.prevLabel || '전일';
    var height = opts.height || 200;
    var uid = 'ibd' + (++SEQ);
    var state = { rows: [], groups: [], selected: null, struct: '', hovering: false, drawSig: '', noteRaw: '', view: null };
    var resizeTimer = null;
    var colCount = columns.length + 1;

    function rangeDef() {
      for (var i = 0; i < ranges.length; i++) if (ranges[i].key === range) return ranges[i];
      return ranges[0];
    }

    function shell() {
      var head = '<tr><th scope="col" class="ibd-h-name">' + esc(opts.nameLabel || '지표') + '</th>'
        + columns.map(function (c) { return '<th scope="col"' + (c.title ? ' title="' + esc(c.title) + '"' : '') + '>' + esc(c.label) + '</th>'; }).join('') + '</tr>';
      return '<div class="ibd" id="' + uid + '">'
        + '<div class="ibd-tablewrap"><table class="ibd-table"><caption class="ibd-sr">' + esc(opts.caption || '지표 표') + '</caption>'
        + '<thead>' + head + '</thead><tbody data-ib-body><tr><td colspan="' + colCount + '" class="ibd-empty">불러오는 중</td></tr></tbody></table></div>'
        + '<section class="ibd-chartsec" aria-live="polite">'
        + '<div class="ibd-charthead"><h3 class="ibd-subtitle" data-ib-title>추이</h3>'
        + '<div class="ibd-range" role="group" aria-label="추이 기간">'
        + ranges.map(function (r) { return '<button type="button" class="ibd-range-btn' + (r.key === range ? ' is-active' : '') + '" data-ib-range="' + esc(r.key) + '" aria-pressed="' + (r.key === range) + '">' + esc(r.label) + '</button>'; }).join('')
        + '</div></div>'
        + '<div class="ibd-chart" data-ib-chart style="height:' + height + 'px"><span class="ibd-empty">지표를 고르면 추이가 나옵니다</span></div>'
        + '<dl class="ibd-stats" data-ib-stats hidden></dl>'
        + '<div class="ibd-hint" data-ib-hint></div>'
        + '<div class="ibd-note" data-ib-note hidden></div></section></div>';
    }

    host.innerHTML = shell();
    var root = host.querySelector('#' + uid);

    /* ---- 표 ---- */
    function cellHtml(cell, col, index) {
      cell = cell || {};
      var cls = 'ibd-c ibd-c' + (index + 1) + (cell.tone ? ' ' + cell.tone : '');
      var short = col.short || col.label;
      return '<td class="' + cls + '" data-label="' + esc(col.label) + '" data-short="' + esc(short) + '">' + (index === 0 ? '<strong>' + esc(cell.t == null ? '-' : cell.t) + '</strong>' : esc(cell.t == null ? '-' : cell.t)) + '</td>';
    }

    function rowHtml(row) {
      var on = row.id === state.selected;
      return '<tr class="ibd-row' + (on ? ' is-selected' : '') + (row.loading ? ' is-loading' : '') + '" data-id="' + esc(row.id) + '" tabindex="0" aria-selected="' + on + '">'
        + '<th scope="row" class="ibd-name"><span class="ibd-nm">' + esc(row.name) + '</span>' + (row.code ? ' <span class="ibd-code">' + esc(row.code) + '</span>' : '')
        + (row.sub ? '<span class="ibd-sub">' + esc(row.sub) + '</span>' : '') + '</th>'
        + columns.map(function (col, i) { return cellHtml(row.loading ? { t: i === 0 ? '확인 중' : '-' } : (row.cells || [])[i], col, i); }).join('') + '</tr>';
    }

    function structure(rows) {
      return rows.map(function (r) { return r.id + '@' + (r.group || ''); }).join('|');
    }

    function renderBody() {
      var body = root.querySelector('[data-ib-body]');
      if (!state.rows.length) {
        body.innerHTML = '<tr><td colspan="' + colCount + '" class="ibd-empty">' + esc(opts.emptyText || '표시할 데이터가 아직 없습니다.') + '</td></tr>';
        return;
      }
      var groupMap = {};
      state.groups.forEach(function (g) { groupMap[g.key] = g; });
      var html = '', section = null;
      state.rows.forEach(function (row) {
        var key = row.group || '';
        if (key !== section) {
          section = key;
          var g = groupMap[key];
          if (g) html += '<tr class="ibd-section"><th colspan="' + colCount + '" scope="colgroup">' + esc(g.label) + (g.hint ? ' <small>' + esc(g.hint) + '</small>' : '') + '</th></tr>';
        }
        html += rowHtml(row);
      });
      body.innerHTML = html;
    }

    /* 구조(행 목록)가 같으면 바뀐 칸의 글자와 색만 고친다 - 실시간으로 자주 불려도 키보드 포커스·호버가 풀리지 않는다. */
    function patchBody() {
      var body = root.querySelector('[data-ib-body]');
      state.rows.forEach(function (row) {
        var tr = null, trs = body.querySelectorAll('.ibd-row');
        for (var i = 0; i < trs.length; i++) if (trs[i].getAttribute('data-id') === row.id) { tr = trs[i]; break; }
        if (!tr) return;
        tr.classList.toggle('is-loading', !!row.loading);
        var tds = tr.querySelectorAll('td');
        columns.forEach(function (col, idx) {
          var td = tds[idx];
          if (!td) return;
          var cell = row.loading ? { t: idx === 0 ? '확인 중' : '-' } : ((row.cells || [])[idx] || {});
          var text = cell.t == null ? '-' : String(cell.t);
          var holder = idx === 0 ? td.firstChild : td;
          if (holder && holder.textContent !== text) holder.textContent = text;
          var want = 'ibd-c ibd-c' + (idx + 1) + (cell.tone ? ' ' + cell.tone : '');
          if (td.className !== want) td.className = want;
        });
      });
    }

    /* ---- 차트 ---- */
    function selectedRow() {
      for (var i = 0; i < state.rows.length; i++) if (state.rows[i].id === state.selected) return state.rows[i];
      return null;
    }

    function setTitle(row) {
      var title = root.querySelector('[data-ib-title]');
      title.textContent = row ? (row.title || (row.name + ' 추이')) : '추이';
    }

    function emptyChart(message) {
      root.querySelector('[data-ib-chart]').innerHTML = '<span class="ibd-empty">' + esc(message) + '</span>';
      root.querySelector('[data-ib-stats]').hidden = true;
      root.querySelector('[data-ib-hint]').textContent = '';
      state.view = null;
    }

    function renderNote(row) {
      var note = root.querySelector('[data-ib-note]');
      state.noteRaw = row && row.note ? row.note : '';
      if (state.noteRaw) { note.innerHTML = state.noteRaw; note.hidden = false; } else { note.innerHTML = ''; note.hidden = true; }
    }

    function drawChart() {
      var row = selectedRow();
      state.hovering = false;   // 차트를 새로 그리면 이전 호버 요소는 사라진다
      setTitle(row);
      renderNote(row);
      if (!row) { emptyChart('지표를 고르면 추이가 나옵니다'); return; }
      if (row.loading) { emptyChart('불러오는 중'); return; }
      var all = row.series || [];
      if (all.length < 2) { emptyChart(all.length ? '이력이 1개뿐이라 추이를 그릴 수 없습니다.' : (row.seriesPending ? '추이를 불러오는 중' : '이 지표의 이력이 아직 없습니다.')); return; }
      var cut = sliceRange(all, rangeDef().days);
      var points = cut.points;
      if (points.length < 2) { emptyChart('선택한 기간에 자료가 2개 미만입니다. 더 긴 기간을 고르세요.'); return; }
      var fmt = row.fmt || defaultFmt;
      var axisFmt = row.axisFmt || fmt;
      var host = root.querySelector('[data-ib-chart]');
      var stats = root.querySelector('[data-ib-stats]');
      var width = Math.max(260, host.clientWidth || 640);
      var m = { l: 6, r: 58, t: 12, b: 24 };
      var s = pointStats(points);
      var pad = (s.hi - s.lo) * 0.08 || Math.abs(s.hi) * 0.002 || 1;
      var lo = s.lo - pad, hi = s.hi + pad;
      var x = function (i) { return m.l + (width - m.l - m.r) * (i / (points.length - 1)); };
      var y = function (v) { return m.t + (height - m.t - m.b) * (1 - (v - lo) / (hi - lo)); };
      var color = s.change >= 0 ? UP : DOWN;
      var path = points.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join('');
      var area = path + 'L' + x(points.length - 1).toFixed(1) + ' ' + (height - m.b) + 'L' + x(0).toFixed(1) + ' ' + (height - m.b) + 'Z';
      var grid = niceTicks(lo, hi, 3).map(function (v) {
        return '<line class="ibd-grid" x1="' + m.l + '" x2="' + (width - m.r) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>'
          + '<text class="ibd-axis" x="' + (width - m.r + 6) + '" y="' + (y(v) + 4).toFixed(1) + '">' + esc(axisFmt(v)) + '</text>';
      }).join('');
      var monthly = row.dateUnit === 'month';
      var xlabels = [0, Math.floor((points.length - 1) / 2), points.length - 1].map(function (i, n) {
        var anchor = n === 0 ? 'start' : n === 2 ? 'end' : 'middle';
        var label = points[i][0].slice(2).replace(/-/g, '.');
        if (monthly) label = label.slice(0, 5);
        return '<text class="ibd-axis" text-anchor="' + anchor + '" x="' + x(i).toFixed(1) + '" y="' + (height - 7) + '">' + esc(label) + '</text>';
      }).join('');
      host.innerHTML = '<svg class="ibd-svg" viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '" role="img" aria-label="' + esc(row.title || row.name) + '">'
        + grid + '<path class="ibd-area" d="' + area + '" fill="' + color + '"/><path class="ibd-line" d="' + path + '" stroke="' + color + '"/>' + xlabels
        + '<circle class="ibd-last" cx="' + x(points.length - 1).toFixed(1) + '" cy="' + y(s.last).toFixed(1) + '" r="3.5" fill="' + color + '"/>'
        + '<line class="ibd-cross" data-ib-cross y1="' + m.t + '" y2="' + (height - m.b) + '" hidden/><circle class="ibd-dot" data-ib-dot r="4" hidden stroke="' + color + '"/>'
        + '<rect class="ibd-hit" x="' + m.l + '" y="' + m.t + '" width="' + (width - m.l - m.r) + '" height="' + (height - m.t - m.b) + '"/></svg>'
        + '<div class="ibd-tip" data-ib-tip hidden></div>';
      state.view = { points: points, x: x, y: y, width: width, m: m, fmt: fmt, monthly: monthly };
      wireHover(host);
      var t = tone(s.change);
      // 순매수처럼 0을 오가는 값은 시작값 대비 %가 뜻이 없으므로 보이지 않는다.
      var showRate = !row.noRate && s.rate != null && s.first > 0;
      var cells = [
        ['시작', esc(fmt(s.first)) + ' <small>' + esc(points[0][0]) + '</small>'],
        ['종료', esc(fmt(s.last)) + ' <small>' + esc(points[points.length - 1][0]) + '</small>'],
        ['기간 변동', '<span class="' + t + '">' + esc(withSign(s.change, fmt)) + (showRate ? ' (' + signed(s.rate, 2) + '%)' : '') + '</span>'],
        ['최고', '<span class="up">' + esc(fmt(s.hi)) + '</span> <small>' + esc(s.hiDate) + '</small>'],
        ['최저', '<span class="down">' + esc(fmt(s.lo)) + '</span> <small>' + esc(s.loDate) + '</small>'],
        ['평균', esc(fmt(s.avg))]
      ];
      stats.innerHTML = cells.map(function (c) { return '<div class="ibd-stat"><dt>' + c[0] + '</dt><dd>' + c[1] + '</dd></div>'; }).join('');
      stats.hidden = false;
      var hint = (opts.countLabel || '자료') + ' ' + points.length + '개 · ' + points[0][0] + ' ~ ' + points[points.length - 1][0];
      if (cut.incomplete) hint += ' · 선택한 기간보다 확보된 이력이 짧아 ' + points[0][0] + '부터 표시합니다.';
      if (row.hint) hint += ' · ' + row.hint;
      root.querySelector('[data-ib-hint]').textContent = hint;
      state.drawSig = sigOf(row);
    }

    function sigOf(row) {
      var all = row && row.series || [];
      var last = all.length ? all[all.length - 1] : null;
      return [row ? row.id : '', range, all.length, last ? last[0] + ':' + last[1] : '', row && row.loading ? 'L' : ''].join('|');
    }

    function wireHover(host) {
      var svg = host.querySelector('svg'), hit = host.querySelector('.ibd-hit');
      var cross = host.querySelector('[data-ib-cross]'), dot = host.querySelector('[data-ib-dot]'), tip = host.querySelector('[data-ib-tip]');
      function show(clientX) {
        var view = state.view;
        if (!view) return;
        state.hovering = true;
        var rect = svg.getBoundingClientRect();
        var scale = view.width / rect.width;
        var px = (clientX - rect.left) * scale, pts = view.points, m = view.m;
        var i = Math.round((px - m.l) / (view.width - m.l - m.r) * (pts.length - 1));
        i = Math.max(0, Math.min(pts.length - 1, i));
        var cx = view.x(i), cy = view.y(pts[i][1]);
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.removeAttribute('hidden');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.removeAttribute('hidden');
        var diff = '';
        if (i) {
          var d = pts[i][1] - pts[i - 1][1];
          diff = '<br>' + esc(prevLabel) + ' 대비 <span class="' + tone(d) + '">' + esc(withSign(d, view.fmt)) + '</span>';
        }
        tip.innerHTML = '<b>' + esc(view.monthly ? pts[i][0].slice(0, 7) : dayLabel(pts[i][0])) + '</b><br>' + esc(view.fmt(pts[i][1])) + diff;
        tip.hidden = false;
        var left = cx / scale + 10;
        if (left + 150 > rect.width) left = cx / scale - 160;
        tip.style.left = Math.max(0, left) + 'px';
        tip.style.top = Math.max(0, cy / scale - 56) + 'px';
      }
      function hide() { state.hovering = false; cross.setAttribute('hidden', ''); dot.setAttribute('hidden', ''); tip.hidden = true; }
      hit.addEventListener('pointermove', function (e) { show(e.clientX); });
      hit.addEventListener('pointerdown', function (e) { show(e.clientX); });
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('pointercancel', hide);
    }

    /* ---- 공개 동작 ---- */
    function select(id, fromUser) {
      if (id == null) return;
      state.selected = id;
      Array.prototype.forEach.call(root.querySelectorAll('.ibd-row'), function (tr) {
        var on = tr.getAttribute('data-id') === id;
        tr.classList.toggle('is-selected', on);
        tr.setAttribute('aria-selected', String(on));
      });
      state.hovering = false;
      drawChart();
      if (typeof opts.onSelect === 'function') { try { opts.onSelect(id); } catch (e) { /* 호출한 쪽 오류가 화면을 멈추지 않게 한다 */ } }
      if (fromUser) {
        var sec = root.querySelector('.ibd-chartsec');
        if (sec && sec.scrollIntoView) { try { sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* 오래된 브라우저 */ } }
      }
    }

    function setRows(rows, groups) {
      state.rows = rows || [];
      state.groups = groups || state.groups || [];
      var sel = selectedRow();
      if (!sel) {
        var firstReady = null;
        for (var i = 0; i < state.rows.length; i++) { if (!state.rows[i].loading) { firstReady = state.rows[i]; break; } }
        var pick = firstReady || state.rows[0];
        state.selected = pick ? pick.id : null;
      }
      var struct = structure(state.rows);
      if (struct !== state.struct) { state.struct = struct; renderBody(); } else { patchBody(); }
      var row = selectedRow();
      if (sigOf(row) !== state.drawSig && !state.hovering) drawChart();
      else if (row && (row.note || '') !== (state.noteRaw || '')) renderNote(row);
    }

    function redraw() { if (state.rows.length) drawChart(); }

    function setEmpty(text) {
      opts.emptyText = text;
      if (!state.rows.length) renderBody();
    }

    function onClick(event) {
      var rangeBtn = event.target.closest && event.target.closest('[data-ib-range]');
      if (rangeBtn) {
        range = rangeBtn.getAttribute('data-ib-range');
        Array.prototype.forEach.call(root.querySelectorAll('[data-ib-range]'), function (b) {
          var on = b === rangeBtn;
          b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on));
        });
        state.hovering = false;
        drawChart();
        return;
      }
      var tr = event.target.closest && event.target.closest('.ibd-row');
      if (tr) select(tr.getAttribute('data-id'), true);
    }
    function onKey(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var tr = event.target.closest && event.target.closest('.ibd-row');
      if (tr) { event.preventDefault(); select(tr.getAttribute('data-id'), true); }
    }
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (document.body.contains(root) && root.offsetParent !== null) redraw(); }, 150);
    }
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    global.addEventListener('resize', onResize);

    function destroy() {
      clearTimeout(resizeTimer);
      global.removeEventListener('resize', onResize);
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
    }

    return { setRows: setRows, setEmpty: setEmpty, select: select, redraw: redraw, destroy: destroy, root: root, getSelected: function () { return state.selected; } };
  }

  /* ── 금액(억원) 표기: 1조 원 이상은 조, 그 아래는 억 ────────────────────────────────── */
  function fmtEok(value, signedOut) {
    if (value == null || !isFinite(value)) return '-';
    var abs = Math.abs(value), sign = value < 0 ? '-' : (signedOut && value > 0 ? '+' : '');
    if (abs >= 10000) return sign + num(abs / 10000, abs >= 100000 ? 1 : 2) + '조';
    return sign + num(abs, 0) + '억';
  }

  // step(눈금 간격, 억원)이 1조보다 작으면 소수 자릿수를 늘려 이웃한 눈금이 같은 글자로 겹치지 않게 한다(예: 32.5조, 33.0조).
  function fmtEokAxis(value, step) {
    if (value == null || !isFinite(value)) return '';
    if (value === 0) return '0';
    var abs = Math.abs(value), sign = value < 0 ? '-' : '';
    if (abs >= 10000) {
      var dec = step > 0 && step < 10000 ? (step < 1000 ? 2 : 1) : (abs >= 100000 ? 0 : 1);
      return sign + num(abs / 10000, dec) + '조';
    }
    return sign + num(abs, 0) + '억';
  }

  /* ── 날짜 도우미(UTC 기준 ISO 'YYYY-MM-DD'). 주는 월요일 시작이며 거래일 집계(주간·월간 합계)도 같은 규칙을 쓴다. ── */
  function isISO(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value)); }
  function weekKeyOf(iso) {
    if (!isISO(iso)) return null;
    var t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    var dow = (new Date(t).getUTCDay() + 6) % 7;   // 월요일 = 0
    return new Date(t - dow * 86400000).toISOString().slice(0, 10);
  }
  function monthKeyOf(iso) { return isISO(iso) ? String(iso).slice(0, 7) : null; }

  /* ── 다중 시계열 차트: 묶음 막대 / 계열별로 쌓은 막대 패널 / 여러 선(+ 오른쪽 보조 축·기준선) ─────────────────────
     createChart(host, { height, panelHeight, emptyText }) -> { update(spec), redraw(), destroy() }
     spec = { type: 'bars'|'lines',
              layout: 'grouped'(기본: 날짜마다 막대 나란히) | 'stacked'(막대만: 계열마다 위아래 패널, 날짜 위치·0선·Y축 범위가 모두 같다),
              dates: ['YYYY-MM-DD'|라벨...],
              meta: [{ label, tip, start }]   // 집계 막대(주간·월간 합계)의 축 라벨·툴팁 제목·구분선 기준. 없으면 dates 를 쓴다.
              series: [{ key, label, color, values: [수...|null], summary: [{ label, text, tone, sub }] }],   // summary 는 stacked 패널 머리의 요약 수치
              fmt(v, signed), axisFmt(v, step), zero: true, secondary: { label, values, fmt, axisFmt } | null,
              refLines: [{ value, label }], axisTitles: { left, right }, guides: { weeks, months, years }, note, ariaLabel, emptyText }
     범례 버튼으로 계열을 숨기거나 보인다. 거래가 없는 날은 날짜 자체가 없다(0으로 채우지 않는다). 막대 간격은 거래일(또는 집계 구간)마다 일정하다. */
  function createChart(host, options) {
    var copts = options || {};
    var height = copts.height || 220;
    var panelHeight = copts.panelHeight || 118;
    var uid = 'ibc' + (++SEQ);
    var state = { spec: null, hidden: {}, view: null };
    var resizeTimer = null;
    host.innerHTML = '<div class="ibd ibc" id="' + uid + '"><div class="ibd-legend" data-ic-legend role="group" aria-label="표시할 항목"></div>'
      + '<div class="ibd-chart" data-ic-chart style="height:' + height + 'px"><span class="ibd-empty">불러오는 중</span></div></div>';
    var root = host.querySelector('#' + uid);
    var chartEl = root.querySelector('[data-ic-chart]');
    var legendEl = root.querySelector('[data-ic-legend]');

    function visibleSeries() {
      return (state.spec && state.spec.series || []).filter(function (s) { return !state.hidden[s.key]; });
    }

    function renderLegend() {
      var spec = state.spec;
      if (!spec || !spec.series || spec.series.length < 2 && !spec.secondary) { legendEl.innerHTML = ''; legendEl.hidden = true; return; }
      legendEl.hidden = false;
      var html = spec.series.map(function (s) {
        var off = !!state.hidden[s.key];
        return '<button type="button" class="ibd-leg-btn' + (off ? ' is-off' : '') + '" data-ic-key="' + esc(s.key) + '" aria-pressed="' + (!off) + '">'
          + '<i class="ibd-swatch" style="background:' + s.color + '"></i>' + esc(s.label) + '</button>';
      }).join('');
      if (spec.secondary) html += '<span class="ibd-leg-sec"><i class="ibd-swatch ibd-swatch-line"></i>' + esc(spec.secondary.label) + ' (오른쪽 축)</span>';
      legendEl.innerHTML = html;
    }

    function scaleOf(values, withZero) {
      var lo = Infinity, hi = -Infinity;
      values.forEach(function (v) { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
      if (!isFinite(lo)) return null;
      if (withZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      var pad = (hi - lo) * 0.07 || Math.abs(hi) * 0.02 || 1;
      return { lo: withZero && lo === 0 ? 0 : lo - pad, hi: withZero && hi === 0 ? 0 : hi + pad };
    }

    function metaOf(spec, i) { return (spec.meta && spec.meta[i]) || null; }
    function startOf(spec, i) { var m = metaOf(spec, i); return (m && m.start) || spec.dates[i]; }
    function labelOf(spec, i) {
      var m = metaOf(spec, i);
      if (m && m.label != null) return String(m.label);
      var d = spec.dates[i], n = spec.dates.length;
      if (!isISO(d)) return String(d);
      return n > 70 ? String(d).slice(2).replace(/-/g, '.') : String(d).slice(5).replace('-', '.');
    }

    /* 날짜축: 라벨 간격은 막대 폭·라벨 길이로 자동(겹치지 않게, 가장 최근 날짜는 항상 포함), 월·주(·연) 경계 보조선과 월 표시 */
    function xAxisGeometry(spec, geo, bars) {
      var n = spec.dates.length, slot = geo.slot, labW = 0, i;
      for (i = 0; i < n; i++) labW = Math.max(labW, labelOf(spec, i).length * 6.4 + 8);
      var step = Math.max(1, Math.ceil((labW + 6) / slot)), idxs = [];
      for (i = n - 1; i >= 0; i -= step) idxs.unshift(i);
      var g = spec.guides || {};
      var useWeeks = g.weeks != null ? g.weeks : (bars && n <= 45), useMonths = g.months != null ? g.months : true, useYears = !!g.years;
      var lines = [], months = [];
      var cutX = function (k) { return bars ? (geo.xc(k - 1) + geo.xc(k)) / 2 : geo.xc(k); };
      for (i = 1; i < n; i++) {
        var a = startOf(spec, i - 1), b = startOf(spec, i);
        if (!isISO(a) || !isISO(b)) continue;
        var monthChange = monthKeyOf(a) !== monthKeyOf(b), yearChange = a.slice(0, 4) !== b.slice(0, 4);
        if (useYears && yearChange) lines.push({ x: cutX(i), kind: 'month' });
        else if (useMonths && monthChange) { lines.push({ x: cutX(i), kind: 'month' }); months.push({ x: cutX(i), text: (+b.slice(5, 7)) + '월', year: yearChange ? b.slice(2, 4) : null }); }
        else if (useWeeks && weekKeyOf(a) !== weekKeyOf(b)) lines.push({ x: cutX(i), kind: 'week' });
      }
      // 월 표시 줄: 첫 구간의 월도 적는다(경계가 아니라 시작이므로). 서로 28px 안에 있으면 뒤의 것을 건너뛴다.
      var monthLabels = [];
      if (useMonths && n && isISO(startOf(spec, 0))) monthLabels.push({ x: geo.m.l + 2, text: (+startOf(spec, 0).slice(5, 7)) + '월', year: null });
      months.forEach(function (mo) { monthLabels.push({ x: mo.x + 3, text: (mo.year ? mo.year + '년 ' : '') + mo.text, year: mo.year }); });
      var shown = [], lastX = -99;
      monthLabels.forEach(function (mo) { if (mo.x - lastX >= 30) { shown.push(mo); lastX = mo.x; } });
      return { idxs: idxs, lines: lines, months: useMonths ? shown : [] };
    }

    function guidesSvg(ax, geo, top, bottom) {
      return ax.lines.map(function (ln) {
        return '<line class="ibd-guide ibd-guide-' + ln.kind + '" x1="' + ln.x.toFixed(1) + '" x2="' + ln.x.toFixed(1) + '" y1="' + top + '" y2="' + bottom + '"/>';
      }).join('');
    }

    function labelsSvg(spec, ax, geo, yText, monthY) {
      var svg = '';
      ax.idxs.forEach(function (k) { svg += '<text class="ibd-axis" text-anchor="middle" x="' + geo.xc(k).toFixed(1) + '" y="' + yText + '">' + esc(labelOf(spec, k)) + '</text>'; });
      if (monthY != null) ax.months.forEach(function (mo) { svg += '<text class="ibd-axis ibd-axis-month" text-anchor="start" x="' + mo.x.toFixed(1) + '" y="' + monthY + '">' + esc(mo.text) + '</text>'; });
      return svg;
    }

    function drawEmpty(text) { chartEl.style.height = height + 'px'; chartEl.innerHTML = '<span class="ibd-empty">' + esc(text) + '</span>'; state.view = null; }

    function draw() {
      var spec = state.spec, vis = visibleSeries();
      state.view = null;
      if (!spec || !spec.dates || !spec.dates.length) { drawEmpty((spec && spec.emptyText) || copts.emptyText || '표시할 자료가 없습니다.'); return; }
      if (!vis.length) { drawEmpty('표시할 항목을 하나 이상 켜 주세요.'); return; }
      var n = spec.dates.length;
      if (spec.type === 'lines' && n < 2) { drawEmpty('자료가 1개뿐이라 선을 그릴 수 없습니다.'); return; }
      var width = Math.max(260, chartEl.clientWidth || 640);
      var withZero = spec.zero !== false;
      var all = []; vis.forEach(function (s) { all = all.concat(s.values); });
      if (spec.refLines) spec.refLines.forEach(function (r) { all.push(r.value); });
      var sc = scaleOf(all, withZero);
      if (!sc) { drawEmpty('표시할 수치가 없습니다.'); return; }
      if (spec.type === 'bars' && spec.layout === 'stacked') drawStacked(spec, vis, sc, width, n, withZero);
      else drawSingle(spec, vis, sc, width, n, withZero);
    }

    function frameOf(width, mL, mR, n, bars) {
      var plotW = width - mL - mR, slot = plotW / n;
      return { width: width, m: { l: mL, r: mR }, plotW: plotW, slot: slot,
        xc: function (i) { return bars ? mL + slot * (i + 0.5) : mL + (n > 1 ? plotW * (i / (n - 1)) : plotW / 2); } };
    }

    function barsSvg(vis, geo, y, y0, sc, offsetFn) {
      var k = vis.length, bw = Math.max(0.6, Math.min(14, geo.slot * (k > 1 ? 0.82 : 0.7) / k)), dense = bw < 1, svg = '';
      vis.forEach(function (s, si) {
        s.values.forEach(function (v, i) {
          if (v == null || !isFinite(v) || v === 0) return;
          var x = geo.xc(i) - (bw * k) / 2 + bw * si, yv = y(v), h = Math.max(1, Math.abs(yv - y0)), top = v > 0 ? y0 - h : y0;   // 아주 작은 값도 1px 로 보이되 방향은 0선 기준 위·아래를 지킨다
          svg += '<rect class="ibd-bar" x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" style="fill:' + s.color + (dense ? ';shape-rendering:auto' : '') + '"/>';
        });
      });
      return svg;
    }

    /* 한 장짜리 차트: 묶음 막대 또는 선 */
    function drawSingle(spec, vis, sc, width, n, withZero) {
      var bars = spec.type === 'bars';
      var hasSec = !!(spec.secondary && spec.secondary.values && spec.secondary.values.some(function (v) { return v != null; }));
      var titles = spec.axisTitles || null;
      var top = titles ? 26 : 12;
      var m = hasSec ? { l: 58, r: 62, t: top, b: 24 } : { l: 6, r: 62, t: top, b: 24 };
      var geo = frameOf(width, m.l, m.r, n, bars); geo.m = m;
      var ax = xAxisGeometry(spec, geo, bars), monthRow = bars && ax.months.length > 0;
      m.b = monthRow ? 38 : 24;
      var plotH = height - m.t - m.b;
      var y = function (v) { return m.t + plotH * (1 - (v - sc.lo) / (sc.hi - sc.lo)); };
      var axisFmt = spec.axisFmt || spec.fmt || defaultFmt;
      var axisX = hasSec ? m.l - 6 : width - m.r + 6, axisAnchor = hasSec ? 'end' : 'start';
      var svg = guidesSvg(ax, geo, m.t, height - m.b);
      var ticks = niceTicks(sc.lo, sc.hi, 4), tickStep = ticks.length > 1 ? ticks[1] - ticks[0] : 0;
      ticks.forEach(function (v) {
        svg += '<line class="ibd-grid" x1="' + m.l + '" x2="' + (width - m.r) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>'
          + '<text class="ibd-axis" text-anchor="' + axisAnchor + '" x="' + axisX + '" y="' + (y(v) + 4).toFixed(1) + '">' + esc(axisFmt(v, tickStep)) + '</text>';
      });
      if (titles) {
        if (titles.left) svg += '<text class="ibd-axis ibd-axis-title" text-anchor="start" x="' + (hasSec ? 2 : width - m.r + 6) + '" y="' + (m.t - 12) + '">' + esc(titles.left) + '</text>';
        if (titles.right && hasSec) svg += '<text class="ibd-axis ibd-axis-title ibd-axis-sec" text-anchor="end" x="' + (width - 2) + '" y="' + (m.t - 12) + '">' + esc(titles.right) + '</text>';
      }
      if (spec.refLines) spec.refLines.forEach(function (r) {
        svg += '<line class="ibd-ref" x1="' + m.l + '" x2="' + (width - m.r) + '" y1="' + y(r.value).toFixed(1) + '" y2="' + y(r.value).toFixed(1) + '"/>'
          + '<text class="ibd-ref-label" text-anchor="end" x="' + (width - m.r - 4) + '" y="' + (y(r.value) - 4).toFixed(1) + '">' + esc(r.label) + '</text>';
      });
      if (withZero && sc.lo < 0 && sc.hi > 0) svg += '<line class="ibd-zero" x1="' + m.l + '" x2="' + (width - m.r) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>';
      if (bars) {
        svg += barsSvg(vis, geo, y, y(Math.max(sc.lo, Math.min(sc.hi, 0))), sc);
      } else {
        vis.forEach(function (s) {
          var d = '', pen = false;
          s.values.forEach(function (v, i) {
            if (v == null || !isFinite(v)) { pen = false; return; }
            d += (pen ? 'L' : 'M') + geo.xc(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true;
          });
          svg += '<path class="ibd-mline" d="' + d + '" style="stroke:' + s.color + '"/>';
          for (var li = s.values.length - 1; li >= 0; li--) if (s.values[li] != null && isFinite(s.values[li])) { svg += '<circle class="ibd-last" cx="' + geo.xc(li).toFixed(1) + '" cy="' + y(s.values[li]).toFixed(1) + '" r="3.2" style="fill:' + s.color + '"/>'; break; }
        });
      }
      if (hasSec) {
        var secScale = scaleOf(spec.secondary.values, false);
        var ys = function (v) { return m.t + plotH * (1 - (v - secScale.lo) / (secScale.hi - secScale.lo)); };
        var d2 = '', pen2 = false;
        spec.secondary.values.forEach(function (v, i) { if (v == null || !isFinite(v)) { pen2 = false; return; } d2 += (pen2 ? 'L' : 'M') + geo.xc(i).toFixed(1) + ' ' + ys(v).toFixed(1); pen2 = true; });
        svg += '<path class="ibd-secline" d="' + d2 + '"/>';
        var secFmt = spec.secondary.axisFmt || spec.secondary.fmt || defaultFmt;
        var secTicks = niceTicks(secScale.lo, secScale.hi, 4), secStep = secTicks.length > 1 ? secTicks[1] - secTicks[0] : 0;
        secTicks.forEach(function (v) {
          svg += '<text class="ibd-axis ibd-axis-sec" x="' + (width - m.r + 6) + '" y="' + (ys(v) + 4).toFixed(1) + '">' + esc(secFmt(v, secStep)) + '</text>';
        });
      }
      svg += labelsSvg(spec, ax, geo, height - (monthRow ? 22 : 7), monthRow ? height - 8 : null);
      svg += '<line class="ibd-cross" data-ic-cross y1="' + m.t + '" y2="' + (height - m.b) + '" hidden/>'
        + '<rect class="ibd-hit" x="' + m.l + '" y="' + m.t + '" width="' + geo.plotW + '" height="' + plotH + '"/>';
      chartEl.style.height = height + 'px';
      chartEl.innerHTML = '<svg class="ibd-svg" viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '" role="img" aria-label="' + esc(spec.ariaLabel || '추이 차트') + '">' + svg + '</svg>'
        + '<div class="ibd-tip" data-ic-tip hidden></div>' + noteHtml(spec);
      state.view = { layout: 'single', width: width, m: m, n: n, slot: geo.slot, xc: geo.xc, vis: vis, spec: spec, plotW: geo.plotW, bars: bars };
      wire();
    }

    /* 계열별 패널을 위아래로: 같은 날짜 위치, 같은 Y축 범위(sc), 같은 0선 위치. 날짜 라벨은 맨 아래 패널에만 적고 보조선은 모든 패널에 긋는다. */
    function drawStacked(spec, vis, sc, width, n, withZero) {
      var m = { l: 6, r: 62, t: 8, b: 6 };
      var geo = frameOf(width, m.l, m.r, n, true); geo.m = m;
      var ax = xAxisGeometry(spec, geo, true), monthRow = ax.months.length > 0;
      var axisH = monthRow ? 40 : 26;
      var ticks = niceTicks(sc.lo, sc.hi, 3), tickStep = ticks.length > 1 ? ticks[1] - ticks[0] : 0;
      var axisFmt = spec.axisFmt || spec.fmt || defaultFmt;
      var html = '<div class="ibd-stack" data-ic-stack>';
      vis.forEach(function (s, idx) {
        var last = idx === vis.length - 1, h = panelHeight + (last ? axisH : 0), plotH = panelHeight - m.t - m.b;
        var y = function (v) { return m.t + plotH * (1 - (v - sc.lo) / (sc.hi - sc.lo)); };
        var svg = guidesSvg(ax, geo, m.t, m.t + plotH);
        ticks.forEach(function (v) {
          svg += '<line class="ibd-grid" x1="' + m.l + '" x2="' + (width - m.r) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>'
            + '<text class="ibd-axis" text-anchor="start" x="' + (width - m.r + 6) + '" y="' + (y(v) + 4).toFixed(1) + '">' + esc(axisFmt(v, tickStep)) + '</text>';
        });
        if (sc.lo < 0 && sc.hi > 0) svg += '<line class="ibd-zero" x1="' + m.l + '" x2="' + (width - m.r) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>';
        svg += barsSvg([s], geo, y, y(Math.max(sc.lo, Math.min(sc.hi, 0))), sc);
        if (last) svg += labelsSvg(spec, ax, geo, m.t + plotH + 15, monthRow ? m.t + plotH + 30 : null);
        svg += '<line class="ibd-cross" data-ic-cross y1="' + m.t + '" y2="' + (m.t + plotH) + '" hidden/>'
          + '<rect class="ibd-hit" x="' + m.l + '" y="' + m.t + '" width="' + geo.plotW + '" height="' + plotH + '"/>';
        var sums = (s.summary || []).map(function (it) {
          return '<span class="ibd-ps"><em>' + esc(it.label) + '</em><b class="' + (it.tone || '') + '">' + esc(it.text) + '</b>' + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</span>';
        }).join('');
        html += '<div class="ibd-panel" data-ic-panel="' + esc(s.key) + '"><div class="ibd-panel-head"><span class="ibd-panel-name"><i class="ibd-swatch" style="background:' + s.color + '"></i>' + esc(s.label) + '</span>'
          + '<span class="ibd-panel-sums">' + sums + '</span></div>'
          + '<svg class="ibd-svg" viewBox="0 0 ' + width + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="' + esc((spec.ariaLabel || '') + ' ' + s.label) + '">' + svg + '</svg></div>';
      });
      html += '</div><div class="ibd-tip" data-ic-tip hidden></div>' + noteHtml(spec);
      chartEl.style.height = 'auto';
      chartEl.innerHTML = html;
      state.view = { layout: 'stacked', width: width, m: m, n: n, slot: geo.slot, xc: geo.xc, vis: vis, spec: spec, plotW: geo.plotW, bars: true };
      wire();
    }

    function noteHtml(spec) { return spec.note ? '<div class="ibd-chart-note">' + esc(spec.note) + '</div>' : ''; }

    function headingOf(spec, i) {
      var meta = metaOf(spec, i);
      if (meta && meta.tip) return meta.tip;
      var d = spec.dates[i];
      return isISO(d) ? dayLabel(d) : String(d);
    }

    function wire() {
      var v0 = state.view, tip = chartEl.querySelector('[data-ic-tip]');
      if (!v0 || !tip) return;
      var hits = chartEl.querySelectorAll ? Array.prototype.slice.call(chartEl.querySelectorAll('.ibd-hit')) : [];
      if (!hits.length) { var one = chartEl.querySelector('.ibd-hit'); if (one) hits = [one]; }
      var svgs = chartEl.querySelectorAll ? Array.prototype.slice.call(chartEl.querySelectorAll('svg')) : [chartEl.querySelector('svg')];
      var crosses = chartEl.querySelectorAll ? Array.prototype.slice.call(chartEl.querySelectorAll('[data-ic-cross]')) : [chartEl.querySelector('[data-ic-cross]')];
      function show(clientX, clientY) {
        var v = state.view; if (!v || !svgs[0]) return;
        var rect = svgs[0].getBoundingClientRect(), scale = v.width / rect.width, px = (clientX - rect.left) * scale;
        var i = v.bars ? Math.floor((px - v.m.l) / v.slot) : Math.round((px - v.m.l) / (v.plotW) * (v.n - 1));
        i = Math.max(0, Math.min(v.n - 1, i));
        var cx = v.xc(i);
        crosses.forEach(function (c) { if (c) { c.setAttribute('x1', cx); c.setAttribute('x2', cx); c.removeAttribute('hidden'); } });
        var rows = v.vis.map(function (s) {
          var val = s.values[i], f = (s.fmt || v.spec.fmt || defaultFmt);
          return '<div class="ibd-tip-row"><i class="ibd-swatch" style="background:' + s.color + '"></i><span>' + esc(s.label) + '</span><b>' + (val == null ? '-' : esc(f(val, true))) + '</b></div>';
        }).join('');
        if (v.spec.secondary && v.spec.secondary.values[i] != null) {
          var sf = v.spec.secondary.fmt || defaultFmt;
          rows += '<div class="ibd-tip-row"><i class="ibd-swatch ibd-swatch-line"></i><span>' + esc(v.spec.secondary.label) + '</span><b>' + esc(sf(v.spec.secondary.values[i])) + '</b></div>';
        }
        tip.innerHTML = '<b class="ibd-tip-date">' + esc(headingOf(v.spec, i)) + '</b>' + rows;
        tip.hidden = false;
        // 툴팁이 차트 밖으로 잘리지 않게: 폭을 재서 좌우를 가두고, 막대 오른쪽에 두되 모자라면 왼쪽으로 뒤집는다.
        var box = chartEl.getBoundingClientRect ? chartEl.getBoundingClientRect() : rect, cw = box.width || rect.width;
        var tw = tip.offsetWidth || 190, th = tip.offsetHeight || 80;
        var left = cx / scale + 12;
        if (left + tw > cw - 2) left = cx / scale - tw - 12;
        tip.style.left = Math.max(2, Math.min(left, cw - tw - 2)) + 'px';
        var topPos = 4;
        if (v.layout === 'stacked' && clientY != null) topPos = Math.max(2, Math.min(clientY - box.top - th - 14, (box.height || 400) - th - 2));
        tip.style.top = topPos + 'px';
      }
      function hide() { crosses.forEach(function (c) { if (c) c.setAttribute('hidden', ''); }); tip.hidden = true; }
      state.hideTip = hide;
      hits.forEach(function (hit) {
        hit.addEventListener('pointermove', function (e) { show(e.clientX, e.clientY); });
        hit.addEventListener('pointerdown', function (e) { show(e.clientX, e.clientY); });
        // 터치는 손을 떼도 값을 읽을 수 있게 유지하고, 차트 밖을 누르면 닫는다. 마우스는 벗어나면 닫는다.
        hit.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hide(); });
        hit.addEventListener('pointercancel', function (e) { if (e.pointerType !== 'touch') hide(); });
      });
    }

    function onLegend(event) {
      var btn = event.target.closest && event.target.closest('[data-ic-key]');
      if (!btn) return;
      var key = btn.getAttribute('data-ic-key');
      state.hidden[key] = !state.hidden[key];
      renderLegend(); draw();
    }
    function onOutside(event) {
      if (!state.hideTip || !event.target || !event.target.closest) return;
      if (event.target.closest('#' + uid + ' .ibd-hit')) return;
      state.hideTip();
    }
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (document.body.contains(root) && root.offsetParent !== null) draw(); }, 150);
    }
    legendEl.addEventListener('click', onLegend);
    global.addEventListener('resize', onResize);
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('pointerdown', onOutside, true);

    return {
      update: function (spec) { state.spec = spec; renderLegend(); draw(); },
      redraw: draw,
      destroy: function () { clearTimeout(resizeTimer); global.removeEventListener('resize', onResize); legendEl.removeEventListener('click', onLegend); if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('pointerdown', onOutside, true); }
    };
  }

  global.IndicatorBoard = {
    create: create,
    createChart: createChart,
    util: { isISO: isISO, weekKeyOf: weekKeyOf, monthKeyOf: monthKeyOf, esc: esc, num: num, signed: signed, withSign: withSign, fmtEok: fmtEok, fmtEokAxis: fmtEokAxis, tone: tone, isoDate: isoDate, series: series, sliceRange: sliceRange, pointStats: pointStats, niceTicks: niceTicks, dayLabel: dayLabel, defaultFmt: defaultFmt }
  };
})(window);
