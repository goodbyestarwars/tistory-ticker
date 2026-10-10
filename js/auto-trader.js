/* 자동매매(소유자 전용) 화면 - 로그 전용 단계.
 *
 * 이 화면은 이 PC에서 돌고 있는 로컬 봇(http://127.0.0.1:8765)만 읽는다. 사이트 서버(VM)·외부 서버로는 아무 것도 보내지 않는다.
 * 접속 토큰은 봇 폴더의 .token 파일 값을 한 번 붙여 넣으면 이 브라우저(localStorage)에만 저장된다.
 * 보여주는 것: 상태, 가상 포지션(실제 주문 아님), 이벤트 로그. 할 수 있는 조작: 정지/재개(정지 파일 생성·삭제)뿐이다.
 * 로컬 서버가 없는 방문자(다른 PC)는 "연결되지 않음" 안내만 본다. 새 VM API·타이머 없음(15초 폴링은 이 PC 안에서만 일어난다).
 */
(function (global) {
  'use strict';

  var ROOT_ID = 'auto-trader';
  var API = 'http://127.0.0.1:8765';
  var TOKEN_KEY = 'autotrader_token_v1';
  var REFRESH_MS = 15000;
  var timer = null;
  var root = null;
  var typeFilter = '';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getToken() { try { return global.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(v) { try { if (v) global.localStorage.setItem(TOKEN_KEY, v); else global.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* */ } }

  function api(path, method) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var t = controller ? setTimeout(function () { controller.abort(); }, 4000) : null;
    return fetch(API + path, { method: method || 'GET', headers: { 'X-AutoTrader-Token': getToken() }, cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (r) {
        if (t) clearTimeout(t);
        if (r.status === 401) throw new Error('token');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }, function (e) { if (t) clearTimeout(t); throw e; });
  }

  function fmtPrice(v) { return v == null ? '-' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 0 }); }
  function pct(v) { return (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function tone(v) { return v > 0 ? 'at-up' : v < 0 ? 'at-down' : ''; }

  var TYPE_LABEL = { PRICE: '시세', SIGNAL: '신호', V_BUY: '가상 매수', V_STOP: '가상 손절', V_TAKE_PROFIT: '가상 익절', V_TIMEOUT: '기간 청산',
    SKIP: '건너뜀', SCAN: '스캔', ERROR: '오류', START: '시작', STOP: '정지', RESUME: '재개' };

  function shellDisconnected(message) {
    root.innerHTML = '<section class="at-card at-connect"><h2>자동매매</h2>'
      + '<p class="at-lead">이 화면은 <b>이 PC에서 실행 중인 자동매매 프로그램</b>과만 연결됩니다. ' + esc(message) + '</p>'
      + '<ol class="at-steps"><li>PC에서 <code>autotrader\\run.bat</code> 을 실행합니다(키움 키는 <code>.env</code> 에 직접 입력).</li>'
      + '<li>브라우저가 "로컬 네트워크 접근" 허용을 물으면 허용합니다.</li>'
      + '<li>프로그램 폴더의 <code>.token</code> 파일 내용을 아래에 붙여 넣고 연결합니다(이 브라우저에만 저장).</li></ol>'
      + '<form class="at-token" data-token-form><input type="password" autocomplete="off" placeholder="접속 토큰" aria-label="접속 토큰" data-token-input>'
      + '<button type="submit">연결</button></form></section>';
    var form = root.querySelector('[data-token-form]');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = root.querySelector('[data-token-input]').value.trim();
      if (!value) return;
      setToken(value);
      refresh();
    });
  }

  function statusHtml(s) {
    var running = !s.stopped;
    return '<section class="at-card at-status">'
      + '<div class="at-head"><div><h2>자동매매 <span class="at-badge">로그 전용 · 주문 없음</span></h2>'
      + '<p class="at-sub">' + esc(s.now) + ' 기준 · ' + (s.market_open ? '장 시간' : '장 마감/휴장') + ' · 마지막 폴링 ' + esc(s.last_poll || '-') + '</p></div>'
      + '<div class="at-actions"><button type="button" class="' + (running ? 'is-stop' : 'is-go') + '" data-toggle>'
      + (running ? '정지' : '재개') + '</button></div></div>'
      + '<dl class="at-kv"><div><dt>상태</dt><dd class="' + (running ? 'at-up' : 'at-down') + '">' + (running ? '실행 중' : '정지됨') + '</dd></div>'
      + '<div><dt>조건</dt><dd>' + esc(s.strategy) + '</dd></div>'
      + '<div><dt>손절 / 익절</dt><dd>-' + esc(s.stop_loss_pct) + '% / +' + esc(s.take_profit_pct) + '%</dd></div>'
      + '<div><dt>가상 보유</dt><dd>' + esc(s.open_positions) + '건</dd></div>'
      + '<div><dt>관찰 종목</dt><dd>' + esc((s.watchlist || []).join(', ')) + '</dd></div></dl>'
      + (s.last_error ? '<p class="at-error">최근 오류: ' + esc(s.last_error) + '</p>' : '') + '</section>';
  }

  function latestPrices(events) {
    var map = {};
    events.forEach(function (e) { if (e.type === 'PRICE' && e.code && !(e.code in map)) map[e.code] = e.price; });
    return map;
  }

  function positionsHtml(rows, prices) {
    if (!rows.length) return '<p class="at-empty">아직 가상 포지션이 없습니다. 신호가 나오면 여기에 쌓입니다.</p>';
    return '<div class="at-table-wrap"><table class="at-table"><thead><tr><th>종목</th><th>진입</th><th class="n">진입가</th><th class="n">현재/청산가</th><th class="n">수익률</th><th>상태</th></tr></thead><tbody>'
      + rows.map(function (p) {
        var closed = p.status === 'CLOSED';
        var last = closed ? p.exit_price : prices[p.code];
        var ret = last ? (last / p.entry_price - 1) * 100 : null;
        return '<tr><td>' + esc(p.code) + '</td><td>' + esc(p.entry_ts) + '</td><td class="n">' + fmtPrice(p.entry_price) + '</td>'
          + '<td class="n">' + fmtPrice(last) + '</td><td class="n ' + (ret == null ? '' : tone(ret)) + '">' + (ret == null ? '-' : pct(ret)) + '</td>'
          + '<td>' + (closed ? esc(TYPE_LABEL[p.exit_reason] || p.exit_reason) : '보유 중') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function eventsHtml(rows) {
    var options = ['', 'SIGNAL', 'V_BUY', 'V_STOP', 'V_TAKE_PROFIT', 'V_TIMEOUT', 'SKIP', 'SCAN', 'ERROR', 'PRICE'];
    var select = '<select data-type-filter aria-label="이벤트 종류">' + options.map(function (t) {
      return '<option value="' + t + '"' + (t === typeFilter ? ' selected' : '') + '>' + (t ? (TYPE_LABEL[t] || t) : '전체') + '</option>';
    }).join('') + '</select>';
    var body = rows.length ? '<div class="at-table-wrap"><table class="at-table"><thead><tr><th>시각</th><th>종류</th><th>종목</th><th class="n">가격</th><th>내용</th></tr></thead><tbody>'
      + rows.map(function (e) {
        return '<tr class="at-ev at-ev--' + esc(e.type) + '"><td>' + esc(e.ts) + '</td><td>' + esc(TYPE_LABEL[e.type] || e.type) + '</td><td>' + esc(e.code || '') + '</td>'
          + '<td class="n">' + (e.price == null ? '' : fmtPrice(e.price)) + '</td><td>' + esc(e.detail) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="at-empty">기록이 없습니다.</p>';
    return '<section class="at-card"><div class="at-head"><h3>이벤트 로그</h3>' + select + '</div>' + body + '</section>';
  }

  function render(status, positions, events, priceEvents) {
    root.innerHTML = statusHtml(status)
      + '<section class="at-card"><h3>가상 포지션 <small>실제 주문이 아닌 기록입니다</small></h3>' + positionsHtml(positions, latestPrices(priceEvents)) + '</section>'
      + eventsHtml(events);
    root.querySelector('[data-toggle]').addEventListener('click', function () {
      api(status.stopped ? '/api/resume' : '/api/stop', 'POST').then(refresh).catch(refresh);
    });
    root.querySelector('[data-type-filter]').addEventListener('change', function (event) {
      typeFilter = event.target.value;
      refresh();
    });
  }

  function refresh() {
    if (!root) return;
    if (!getToken()) { shellDisconnected('아직 접속 토큰이 없습니다.'); return; }
    Promise.all([api('/api/status'), api('/api/positions?limit=100'), api('/api/events?limit=200' + (typeFilter ? '&type=' + encodeURIComponent(typeFilter) : '')), api('/api/events?limit=300&type=PRICE')])
      .then(function (out) { render(out[0], out[1].positions || [], out[2].events || [], out[3].events || []); })
      .catch(function (error) {
        if (error && error.message === 'token') { setToken(''); shellDisconnected('토큰이 맞지 않습니다. .token 파일 내용을 다시 붙여 넣으세요.'); return; }
        shellDisconnected('프로그램에 연결하지 못했습니다(실행 중인지, 이 PC의 브라우저인지 확인).');
      });
  }

  function init() {
    root = document.getElementById(ROOT_ID);
    if (!root) return;
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden && getToken()) refresh(); }, REFRESH_MS);
  }

  global.AutoTraderPage = { init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
