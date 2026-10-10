/* 자동매매(소유자 전용) 화면 - 감시 종목 손절·익절(매수 기능 없음).
 *
 * 이 화면은 이 PC에서 돌고 있는 로컬 봇(http://127.0.0.1:8765)만 읽는다. 사이트 서버(VM)·외부 서버로는 아무 것도 보내지 않는다.
 * 접속 토큰: 봇 폴더의 .token 파일 값을 한 번 붙여 넣으면 이 브라우저(localStorage)에만 저장된다.
 * 흐름: 차트검색에서 "자동매매 감시 추가" -> 증권앱에서 직접 매수 -> 봇이 감시 종목의 보유분을 손절·익절한다.
 * 조작: 정지/재개, 감시 종목 추가·해제. 주문 버튼·설정 변경은 화면에 없다(LIVE_SELL·손절 값은 PC의 .env/config.json).
 * 새 VM API·타이머 없음(15초 갱신은 이 PC 안에서만 일어난다).
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

  function api(path, method, body) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var t = controller ? setTimeout(function () { controller.abort(); }, 4000) : null;
    var headers = { 'X-AutoTrader-Token': getToken() };
    var init = { method: method || 'GET', headers: headers, cache: 'no-store', signal: controller ? controller.signal : undefined };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(API + path, init).then(function (r) {
      if (t) clearTimeout(t);
      if (r.status === 401) throw new Error('token');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { if (t) clearTimeout(t); throw e; });
  }

  function fmtPrice(v) { return v == null || v === 0 ? '-' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 0 }); }
  function pct(v) { return v == null ? '-' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%'; }
  function tone(v) { return v > 0 ? 'at-up' : v < 0 ? 'at-down' : ''; }

  var TYPE_LABEL = { SIGNAL: '신호', DRY_SELL: '매도(기록만)', SELL_SENT: '매도 전송', POSITION_CLOSED: '보유 종료', SKIP: '건너뜀',
    ERROR: '오류', CRITICAL: '긴급', START: '시작', STOP: '정지', RESUME: '재개', WATCH_ADD: '감시 추가', WATCH_REMOVE: '감시 해제' };
  var REASON_LABEL = { STOP: '손절', TP_CAP: '익절(상한)', TP_FLOOR: '익절(하한 이탈)' };
  var ORDER_STATUS = { DRY: '기록만', SENT: '전송됨', ERROR: '실패' };

  function shellDisconnected(message) {
    root.innerHTML = '<section class="at-card at-connect"><h2>자동매매</h2>'
      + '<p class="at-lead">이 화면은 <b>이 PC에서 실행 중인 자동매매 프로그램</b>과만 연결됩니다. ' + esc(message) + '</p>'
      + '<ol class="at-steps"><li>PC에서 <code>autotrader\\run.bat</code> 을 실행합니다(키움 키는 <code>.env</code> 에 직접 입력).</li>'
      + '<li>브라우저가 "로컬 네트워크 접근" 허용을 물으면 허용합니다.</li>'
      + '<li>프로그램 폴더의 <code>.token</code> 파일을 메모장으로 열어 내용을 복사하고, 아래에 붙여 넣은 뒤 연결을 누릅니다(이 브라우저에만 저장됩니다).</li></ol>'
      + '<form class="at-token" data-token-form><input type="password" autocomplete="off" placeholder="접속 토큰" aria-label="접속 토큰" data-token-input>'
      + '<button type="submit">연결</button></form></section>';
    root.querySelector('[data-token-form]').addEventListener('submit', function (event) {
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
      + '<div class="at-head"><div><h2>자동매매 <span class="at-badge' + (s.live_sell ? ' is-live' : '') + '">' + esc(s.mode) + '</span></h2>'
      + '<p class="at-sub">' + esc(s.now) + ' 기준 · ' + (s.market_open ? '장 시간' : '장 마감/휴장') + ' · 마지막 폴링 ' + esc(s.last_poll || '-') + '</p></div>'
      + '<div class="at-actions"><button type="button" class="' + (running ? 'is-stop' : 'is-go') + '" data-toggle>' + (running ? '정지' : '재개') + '</button></div></div>'
      + '<dl class="at-kv"><div><dt>상태</dt><dd class="' + (running ? 'at-up' : 'at-down') + '">' + (running ? '실행 중' : '정지됨') + '</dd></div>'
      + '<div><dt>손절</dt><dd>-' + esc(s.stop_loss_pct) + '%</dd></div>'
      + '<div><dt>익절</dt><dd>+' + esc(s.take_profit_floor_pct) + '% ~ +' + esc(s.take_profit_cap_pct) + '%</dd></div>'
      + '<div><dt>감시 종목</dt><dd>' + esc(s.watch_count) + '개</dd></div>'
      + '<div><dt>오늘 매도 주문</dt><dd>' + esc(s.sells_today) + ' / ' + esc(s.max_sells_per_day) + '건</dd></div></dl>'
      + '<p class="at-note">익절 규칙: +' + esc(s.take_profit_cap_pct) + '% 이상이면 즉시 매도, 한 번 +' + esc(s.take_profit_floor_pct) + '%를 넘겼다가 그 아래로 내려오면 매도합니다. 시장가 주문이라 체결가는 달라질 수 있습니다. 매수는 직접 하세요.</p>'
      + (s.last_error ? '<p class="at-error">최근 오류: ' + esc(s.last_error) + '</p>' : '') + '</section>';
  }

  function watchHtml(watch) {
    var rows = watch.length ? '<div class="at-chips">' + watch.map(function (w) {
      return '<span class="at-chip">' + esc(w.name || '') + ' <code>' + esc(w.code) + '</code><button type="button" data-unwatch="' + esc(w.code) + '" aria-label="' + esc(w.code) + ' 감시 해제">×</button></span>';
    }).join('') + '</div>' : '<p class="at-empty">감시 중인 종목이 없습니다. 차트검색 종목 상세의 "자동매매 감시 추가"로 올리거나 아래에 종목코드를 직접 입력하세요.</p>';
    return '<section class="at-card"><h3>감시 종목 <small>여기에 있는 종목의 보유분만 자동 손절·익절합니다</small></h3>' + rows
      + '<form class="at-token at-add" data-watch-form><input type="text" inputmode="numeric" maxlength="6" placeholder="종목코드 6자리" aria-label="종목코드" data-watch-code>'
      + '<input type="text" maxlength="20" placeholder="종목명(선택)" aria-label="종목명" data-watch-name><button type="submit">감시 추가</button></form></section>';
  }

  function holdingsHtml(list) {
    if (!list.length) return '<p class="at-empty">잔고에 보유 종목이 없거나 아직 장 시간 조회 전입니다.</p>';
    return '<div class="at-table-wrap"><table class="at-table"><thead><tr><th>종목</th><th class="n">수량</th><th class="n">매입가</th><th class="n">현재가</th><th class="n">수익률</th><th class="n">최고 수익률</th><th>자동 관리</th></tr></thead><tbody>'
      + list.map(function (h) {
        return '<tr><td>' + esc(h.name || '') + ' <code>' + esc(h.code) + '</code></td><td class="n">' + esc(h.qty) + '</td><td class="n">' + fmtPrice(h.avg) + '</td>'
          + '<td class="n">' + fmtPrice(h.price) + '</td><td class="n ' + tone(h.gain) + '">' + pct(h.gain) + '</td><td class="n">' + pct(h.peak) + '</td>'
          + '<td>' + (h.watched ? '감시 중' : '<span class="at-mute">감시 안 함(건드리지 않음)</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function ordersHtml(rows) {
    if (!rows.length) return '<p class="at-empty">아직 매도 주문 기록이 없습니다.</p>';
    return '<div class="at-table-wrap"><table class="at-table"><thead><tr><th>시각</th><th>종목</th><th class="n">수량</th><th>사유</th><th>상태</th><th>내용</th></tr></thead><tbody>'
      + rows.map(function (o) {
        return '<tr><td>' + esc(o.ts) + '</td><td>' + esc(o.code) + '</td><td class="n">' + esc(o.qty) + '</td><td>' + esc(REASON_LABEL[o.reason] || o.reason) + '</td>'
          + '<td>' + esc(ORDER_STATUS[o.status] || o.status) + '</td><td>' + esc(o.detail || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function eventsHtml(rows) {
    var options = ['', 'DRY_SELL', 'SELL_SENT', 'POSITION_CLOSED', 'ERROR', 'CRITICAL', 'SKIP', 'WATCH_ADD', 'WATCH_REMOVE'];
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

  function render(d) {
    root.innerHTML = statusHtml(d.status) + watchHtml(d.watch)
      + '<section class="at-card"><h3>보유 종목 <small>키움 잔고 기준, 30초마다 갱신</small></h3>' + holdingsHtml(d.holdings) + '</section>'
      + '<section class="at-card"><h3>매도 주문 기록</h3>' + ordersHtml(d.orders) + '</section>' + eventsHtml(d.events);
    root.querySelector('[data-toggle]').addEventListener('click', function () {
      api(d.status.stopped ? '/api/resume' : '/api/stop', 'POST').then(refresh).catch(refresh);
    });
    root.querySelector('[data-type-filter]').addEventListener('change', function (event) { typeFilter = event.target.value; refresh(); });
    root.querySelector('[data-watch-form]').addEventListener('submit', function (event) {
      event.preventDefault();
      var code = root.querySelector('[data-watch-code]').value.trim();
      var name = root.querySelector('[data-watch-name]').value.trim();
      if (!/^\d{6}$/.test(code)) return;
      api('/api/watch', 'POST', { code: code, name: name }).then(refresh).catch(refresh);
    });
    root.querySelectorAll('[data-unwatch]').forEach(function (button) {
      button.addEventListener('click', function () {
        api('/api/unwatch', 'POST', { code: button.getAttribute('data-unwatch') }).then(refresh).catch(refresh);
      });
    });
  }

  function refresh() {
    if (!root) return;
    if (!getToken()) { shellDisconnected('아직 접속 토큰이 없습니다.'); return; }
    Promise.all([api('/api/status'), api('/api/watch'), api('/api/holdings'), api('/api/orders?limit=50'),
      api('/api/events?limit=200' + (typeFilter ? '&type=' + encodeURIComponent(typeFilter) : ''))])
      .then(function (out) {
        render({ status: out[0], watch: out[1].watch || [], holdings: out[2].holdings || [], orders: out[3].orders || [], events: out[4].events || [] });
      })
      .catch(function (error) {
        if (error && error.message === 'token') { setToken(''); shellDisconnected('토큰이 맞지 않습니다. .token 파일 내용을 다시 붙여 넣으세요.'); return; }
        shellDisconnected('프로그램에 연결하지 못했습니다(실행 중인지, 이 PC의 브라우저인지 확인).');
      });
  }

  function init() {
    root = document.getElementById(ROOT_ID);
    if (!root) return;
    // 티스토리 관리자(블로그 운영자) 로그인 상태에서만 화면을 연다. 방문자에게는 안내 한 줄만 보인다.
    var c = global.T && global.T.config;
    if (!(c && c.IS_LOGIN && c.ROLE && c.ROLE !== 'guest')) { root.innerHTML = '<p class="at-empty">블로그 관리자 로그인 후 이용할 수 있습니다.</p>'; return; }
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden && getToken()) refresh(); }, REFRESH_MS);
  }

  global.AutoTraderPage = { init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
