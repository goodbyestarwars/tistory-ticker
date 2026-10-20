/* 자동매매(소유자 전용) 운영센터 - 이 PC의 로컬 봇(http://127.0.0.1:8765)만 읽는다.
 *
 * 사이트 서버(VM)로 계좌·주문 정보를 보내지 않는다. 접속 토큰은 봇 폴더의 .token 값을 한 번 붙여 넣으면 이 브라우저(localStorage)에만 저장된다.
 * 화면에는 주문 버튼이 없다. 조작은 정지/재개, 감시 등록·해제, 분석 전용 등록·해제, "규칙 확인" 표시뿐이며
 * 규칙 확인과 실주문 활성은 별개다(로컬 감시 봇은 기록 전용, 실계좌 엔진은 PC에서 별도 승인·실행).
 *
 * 2026-10-15 개편: 장전 잔고 조회 상태(조회 전/확인 불가/오래됨)를 0개와 구분해 표시하고, 기존 수동 보유·엔진 보유를 나누며,
 * 분석 전용 종목(LG유플러스 등)은 고정 손절·익절 대신 분석 상태(보유 유지/매도 주의/매도 검토)만 보여 준다. 자동 매도는 없다.
 * 정책 문구는 PC 엔진(live_engine.py)에서 읽은 값만 쓰고, 읽지 못하면 고정값을 현재 설정처럼 표시하지 않는다.
 * 가상·모의매매 데이터나 백테스트는 이 화면이 요청하지 않는다.
 */
(function (global) {
  'use strict';

  var ROOT_ID = 'auto-trader';
  var API = 'http://127.0.0.1:8765';
  var VM = 'https://goodbyestar.cloud';
  var TOKEN_KEY = 'autotrader_token_v1';
  var REFRESH_MS = 15000;
  var ANALYSIS_TTL_MS = 120000;
  var timer = null;
  var root = null;
  var typeFilter = '';
  var anaCache = {};
  var scheduleCache = null;
  var scheduleCacheAt = 0;
  var schedulePromise = null;
  var scheduleExpanded = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getToken() { try { return global.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(v) { try { if (v) global.localStorage.setItem(TOKEN_KEY, v); else global.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* */ } }

  function api(path, method, body, timeoutMs) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var t = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 4000) : null;
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
  function fmtWon(v) { return v == null ? '-' : Math.round(v).toLocaleString('ko-KR'); }
  function signed(v) { return v == null ? '-' : (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(Math.round(v)).toLocaleString('ko-KR'); }
  function pct(v) { return v == null ? '-' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%'; }
  function tone(v) { return v > 0 ? 'at-up' : v < 0 ? 'at-down' : ''; }
  function hhmm(ts) { return ts ? String(ts).slice(11, 19) : '-'; }

  function scheduleTime(value) {
    if (!value) return '-';
    var date = new Date(value);
    return isNaN(date.getTime()) ? String(value) : date.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
  }

  function scheduleHtml(items) {
    var rows = (items || []).map(function (j) {
      return '<tr><td>' + esc(j.group) + '</td><td>' + esc(j.name) + '</td><td>' + esc(j.state || '미확인')
        + '</td><td>' + esc(scheduleTime(j.lastSuccessAt))
        + '</td><td>' + esc(j.nextRunAt ? scheduleTime(j.nextRunAt) : j.state === '의도적 비활성화' ? '없음' : j.id === 'deploy' ? '5분 간격' : '변경 시') + '</td></tr>';
    }).join('');
    return '<section class="at-box at-orders-wide"><div class="at-hd"><h3>갱신·스케줄 상태</h3><span>시각 KST · 작업 결과 기준 · 계좌 정보 제외</span></div>'
      + '<details data-schedule-details' + (scheduleExpanded ? ' open' : '') + '><summary>사이트 · Actions · GAS · VM · PC 확인</summary><div class="at-month-wrap"><table><thead><tr><th>영역</th><th>작업</th><th>상태</th><th>마지막 성공</th><th>다음 실행</th></tr></thead><tbody>'
      + (rows || '<tr><td colspan="5">상태를 확인하는 중입니다.</td></tr>') + '</tbody></table></div></details></section>';
  }

  function loadSchedules() {
    if (scheduleCache && Date.now() - scheduleCacheAt < 600000) return Promise.resolve(scheduleCache);
    if (schedulePromise) return schedulePromise;
    var gh = 'https://api.github.com/repos/goodbyestarwars/tistory-ticker/actions/workflows/';
    var workflows = [
      { id: 379360767, name: 'DCF 공시', next: '매시 :17·:47' },
      { id: 377890694, name: '5년 차트', next: '토 09:15' },
      { id: 333930783, name: 'GAS 배포', next: '변경 시' },
      { id: 308765062, name: 'Pages 배포', next: '변경 시' }
    ];
    schedulePromise = Promise.all([
      api('/api/schedules', 'GET', undefined, 15000).catch(function () { return { jobs: [] }; }),
      getJson(VM + '/health/schedules').catch(function () { return { jobs: [] }; }),
      Promise.all(workflows.map(function (w) {
        return getJson(gh + w.id + '/runs?per_page=10').then(function (res) {
          var run = (res.workflow_runs || [])[0];
          var lastGood = (res.workflow_runs || []).filter(function (item) { return item.conclusion === 'success'; })[0];
          return { group: w.name === 'GAS 배포' ? 'GAS' : '사이트', name: w.name,
            state: !run ? '미확인' : run.conclusion === 'success' ? '정상' : run.conclusion === 'failure' ? '오류' : '지연',
            lastSuccessAt: lastGood ? lastGood.updated_at : null, nextRunAt: w.next };
        }).catch(function () { return { group: '사이트', name: w.name, state: '미확인', nextRunAt: w.next }; });
      })),
      getJson('https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec?codes=005930')
        .then(function () { return { group: 'GAS', name: '시세 프록시 응답', state: '정상', lastSuccessAt: new Date().toISOString(), nextRunAt: '요청 시' }; })
        .catch(function () { return { group: 'GAS', name: '시세 프록시 응답', state: '미확인', nextRunAt: '요청 시' }; })
    ]).then(function (out) {
      var items = [{ group: '사이트', name: '운영 화면', state: '정상', lastSuccessAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }), nextRunAt: '요청 시' }];
      (out[2] || []).forEach(function (j) { items.push(j); });
      items.push(out[3]);
      var vmSchedule = out[1].data || out[1];
      (vmSchedule.jobs || []).forEach(function (j) { items.push(Object.assign({ group: 'VM' }, j)); });
      (out[0].jobs || []).forEach(function (j) { items.push(Object.assign({ group: 'PC' }, j)); });
      if (!(out[0].jobs || []).length) items.push({ group: 'PC', name: '작업 스케줄러', state: '미확인' });
      if (!(vmSchedule.jobs || []).length) items.push({ group: 'VM', name: 'systemd', state: '미확인' });
      scheduleCache = items;
      scheduleCacheAt = Date.now();
      schedulePromise = null;
      return items;
    }, function () { schedulePromise = null; return []; });
    return schedulePromise;
  }

  var TYPE_LABEL = { SIGNAL: '신호', SELL_SENT: '매도 전송', POSITION_CLOSED: '보유 종료', SKIP: '건너뜀',
    ERROR: '오류', CRITICAL: '긴급', START: '시작', STOP: '정지', RESUME: '재개', WATCH_ADD: '감시 추가', WATCH_REMOVE: '감시 해제',
    WATCH_CONFIRM: '규칙 확인', ANALYSIS_ADD: '분석 전용 등록', ANALYSIS_REMOVE: '분석 전용 해제' };
  var REASON_LABEL = { STOP: '손절', TP_CAP: '익절(상한)', TP_FLOOR: '익절(하한 이탈)', BUY: '매수', SELL: '매도' };
  // 체결 여부는 이 화면이 확인할 수 없다 - 접수·전송까지만 말하고 완료 표현은 쓰지 않는다.
  var ORDER_STATUS = { FILLED: '체결 확인(키움 일지)', DRY: '기록만(주문 안 보냄)', SENT: '전송됨 · 체결 확인 전', ACK: '접수됨 · 체결 확인 전',
    UNKNOWN: '전송 시도 · 응답 확인 필요', ERROR: '실패·거부' };
  var KIND_LABEL = { manual: '기존 수동 보유', engine: '엔진 보유', mixed: '엔진 + 기존 보유' };
  var ENGINE_STATES = { DISABLED_OR_UNCERTAIN: '승인·주문 확인 필요', INSUFFICIENT_STARTING_CASH: '입금 확인 필요',
    BUY_FILL_UNCONFIRMED: '매수 체결 확인 필요', SELL_FILL_UNCONFIRMED: '매도 체결 확인 필요',
    FOREIGN_HOLDINGS: '기존 보유 종목 때문에 멈춤', PENDING_ORDERS: '미체결 주문 대기',
    NO_ENTRY: '진입 조건 없음', NO_CANDIDATE: '적합한 후보 없음', BUY_SENT: '매수 주문 전송',
    STOP_3: '손절 주문 전송', STOP_EMERGENCY: '비상 손절 주문 전송', TRAIL_2_5: '추적 청산(익절) 주문 전송',
    PRICE_UNAVAILABLE: '현재가 확인 불가', CLOSED_OR_STOPPED: '장 시간 밖 또는 정지',
    EXCLUSION_UNCONFIRMED: '제외 목록 확인 실패 - 주문 중지' };

  /* ───────────── 분석 전용 종목 판단(순수 함수 - 테스트 대상) ─────────────
   * 고정 손절·익절 대신 현재가·이동평균·지지/저항·거래량·외국인/기관 수급을 점수화한다. 자동 주문과는 연결되지 않는다.
   * 입력이 없거나 오래되면 점수를 매기지 않고 "판단 불가"로 둔다.
   */
  function daysBetween(a, b) {
    var pa = String(a).slice(0, 10).split('-'), pb = String(b).slice(0, 10).split('-');
    if (pa.length < 3 || pb.length < 3) return null;
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
  }
  function lastOf(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  function mean(list) { return list.length ? list.reduce(function (s, v) { return s + v; }, 0) / list.length : null; }

  function analyze(inp) {
    var daily = inp.daily || [];
    var lastBar = lastOf(daily);
    var asOf = { price: inp.priceAt || '-', priceBasis: inp.marketOpen ? '장중 현재가' : '장 시작 전·마감 후(직전 종가 기준)',
      daily: lastBar ? lastBar.date : '-', flow: (inp.flow && inp.flow.as_of) || '-' };
    function unknown(why) {
      return { state: 'UNKNOWN', label: '판단 불가', tone: 'is-unknown', points: null, reasons: [{ k: 'warn', t: why }], levels: {}, asOf: asOf };
    }
    var p = Number(inp.price);
    if (!(p > 0)) return unknown('현재가를 확인하지 못했습니다.');
    if (!inp.priceFresh) return unknown('현재가가 오래됐거나 잔고 조회가 정상이 아닙니다(' + (inp.priceNote || '조회 상태 확인 필요') + ').');
    if (daily.length < 60 || !lastBar) return unknown('일봉 데이터가 부족합니다.');
    var gap = daysBetween(lastBar.date, inp.today);
    if (gap == null || gap > 5) return unknown('일봉 데이터가 오래됐습니다(마지막 ' + lastBar.date + ').');
    var ma = inp.ma || {};
    var ma20 = lastOf(ma.ma20), ma60 = lastOf(ma.ma60);
    if (!(ma20 > 0) || !(ma60 > 0)) return unknown('이동평균 데이터를 계산하지 못했습니다.');

    var points = 0, reasons = [];
    function add(pt, kind, text) { points += pt; reasons.push({ k: kind, t: text }); }

    // 1) 추세: 20일선·60일선 대비 위치
    var belowMa20 = p < ma20, belowMa60 = p < ma60;
    if (belowMa20) add(1, 'warn', '현재가 ' + fmtPrice(p) + '원이 20일선(' + fmtPrice(ma20) + '원) 아래입니다.');
    else reasons.push({ k: 'ok', t: '현재가가 20일선(' + fmtPrice(ma20) + '원) 위에 있습니다.' });
    if (belowMa60) add(1, 'warn', '60일선(' + fmtPrice(ma60) + '원)도 아래입니다.');

    // 2) 지지·저항
    var support = (inp.levels && inp.levels.support) || [], resistance = (inp.levels && inp.levels.resistance) || [];
    var below = support.filter(function (v) { return v <= p; });
    var nearestSupport = below.length ? Math.max.apply(null, below) : null;
    var supportBroken = false;
    if (support.length && nearestSupport == null) {
      var lowest = Math.min.apply(null, support);
      if (p < lowest * 0.995) { supportBroken = true; add(2, 'warn', '주요 지지선 ' + fmtPrice(lowest) + '원 아래로 내려왔습니다.'); }
    } else if (nearestSupport != null) {
      var room = (p - nearestSupport) / nearestSupport * 100;
      if (room <= 1.5) add(1, 'warn', '지지선 ' + fmtPrice(nearestSupport) + '원 바로 위입니다(여유 ' + room.toFixed(1) + '%).');
      else reasons.push({ k: 'ok', t: '지지선 ' + fmtPrice(nearestSupport) + '원 위(여유 ' + room.toFixed(1) + '%).' });
    }
    var above = resistance.filter(function (v) { return v > p; });
    var nearestRes = above.length ? Math.min.apply(null, above) : null;
    if (nearestRes != null) reasons.push({ k: 'info', t: '가까운 저항선 ' + fmtPrice(nearestRes) + '원(' + ((nearestRes - p) / p * 100).toFixed(1) + '% 위).' });

    // 3) 거래량: 마감된 마지막 봉이 하락일이면서 20일 평균의 1.5배 이상이면 경계
    var idx = daily.length - 1;
    if (daily[idx].date === String(inp.today).slice(0, 10) && inp.marketOpen) idx -= 1;
    if (idx >= 21) {
      var avgVol = mean(daily.slice(idx - 20, idx).map(function (b) { return Number(b.volume) || 0; }));
      var bar = daily[idx], prev = daily[idx - 1];
      if (avgVol > 0 && bar.volume > 0) {
        var ratio = bar.volume / avgVol;
        if (ratio >= 1.5 && bar.close < prev.close) add(1, 'warn', bar.date + ' 하락일 거래량이 20일 평균의 ' + ratio.toFixed(1) + '배입니다.');
        else reasons.push({ k: 'info', t: bar.date + ' 거래량 20일 평균의 ' + ratio.toFixed(1) + '배.' });
      }
    }

    // 4) 수급(외국인·기관): 확정 일별 데이터라 기준일이 오래되면 쓰지 않는다
    var flow = inp.flow, flowGap = flow && flow.as_of ? daysBetween(flow.as_of, inp.today) : null;
    var r5 = flow && flow.rolling && flow.rolling['5d'], r20 = flow && flow.rolling && flow.rolling['20d'];
    if (!r5 || flowGap == null || flowGap > 5) {
      reasons.push({ k: 'info', t: '외국인·기관 수급 데이터를 확인하지 못해 수급은 판단에서 뺐습니다.' });
    } else {
      if (r5.foreign < 0 && r5.inst < 0) add(1, 'warn', '최근 5거래일 외국인·기관이 모두 순매도입니다.');
      else reasons.push({ k: 'info', t: '최근 5거래일 외국인 ' + signed(r5.foreign) + '주 · 기관 ' + signed(r5.inst) + '주 순매수.' });
      if (r20 && r20.foreign < 0 && r20.inst < 0) add(1, 'warn', '최근 20거래일에도 외국인·기관이 모두 순매도입니다.');
    }

    var state = (points >= 4 || (supportBroken && belowMa20)) ? 'REVIEW' : points >= 2 ? 'CAUTION' : 'KEEP';
    var label = { KEEP: '보유 유지', CAUTION: '매도 주의', REVIEW: '매도 검토' }[state];
    var avg = Number(inp.avg);
    if (avg > 0) reasons.push({ k: 'info', t: '매입가 ' + fmtPrice(avg) + '원 대비 ' + pct((p / avg - 1) * 100) + '(비용 제외). 고정 손절·익절 기준은 적용하지 않습니다.' });
    return {
      state: state, label: label, tone: { KEEP: 'is-keep', CAUTION: 'is-caution', REVIEW: 'is-review' }[state], points: points, reasons: reasons,
      levels: { support: nearestSupport, resistance: nearestRes, ma20: ma20, ma60: ma60 }, asOf: asOf
    };
  }

  /* ───────────── 화면 ───────────── */
  function shellDisconnected(message) {
    root.innerHTML = '<section class="at-card at-connect"><h2>자동매매 운영센터</h2>'
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

  function balanceChip(b) {
    var map = { OK: ['정상', ''], STALE: ['오래됨', ' is-wait'], FAILED: ['조회 실패', ' is-off'], NOT_YET: ['조회 전', ' is-wait'] };
    var m = map[b && b.state] || map.NOT_YET;
    return '<span class="at-st"><i class="at-dot' + m[1] + '"></i>계좌 조회 <b>' + m[0] + '</b>'
      + (b && b.last_ok ? ' <small>마지막 정상 ' + esc(hhmm(b.last_ok)) + '</small>' : '') + '</span>';
  }

  function liveState(s) {
    var engineRunning = !!s.live_active;
    var armed = !!s.live_scheduled;
    var orders = engineRunning ? '활성' : armed ? '예약됨(08:55 시작 설정)' : '불가(승인·설정 전)';
    return { engine: engineRunning ? '실행 중' : '중지·신호 없음', orders: orders, orderTone: engineRunning ? ' is-live' : armed ? '' : ' is-paper' };
  }

  function topbarHtml(s, balance) {
    var running = !s.stopped;
    var live = liveState(s);
    return '<div class="at-top"><span class="at-brand">자동매매 운영센터</span>'
      + '<span class="at-st"><i class="at-dot"></i>로컬 연결 <b>정상</b></span>'
      + balanceChip(balance)
      + '<span class="at-st"><i class="at-dot' + (s.live_active ? '' : ' is-wait') + '"></i>엔진 <b>' + live.engine + '</b></span>'
      + '<span class="at-chip2' + live.orderTone + '">실주문 ' + live.orders + '</span>'
      + '<span class="at-st"><i class="at-dot' + (running ? '' : ' is-off') + '"></i>감시 봇 <b>' + (running ? '실행 중' : '정지됨') + '</b> <small>매도 기록 전용</small></span>'
      + '<span class="at-st at-hide-m">최종 동기화 <b>' + esc(hhmm(s.last_poll)) + '</b> · ' + (s.market_open ? '장 시간' : '장 시간 아님') + '</span>'
      + '<span class="at-sp"></span>'
      + '<button type="button" class="at-btn ' + (running ? 'is-stop' : 'is-go') + '" data-toggle>' + (running ? '감시 정지' : '감시 재개') + '</button></div>'
      + (s.last_error ? '<p class="at-error">최근 오류: ' + esc(s.last_error) + '</p>' : '');
  }

  function isToday(o, today) { return String(o.ts || '').slice(0, 10) === today; }

  function kpiHtml(s, holdings, orders, balance) {
    var ok = balance && (balance.state === 'OK' || balance.state === 'STALE');
    var known = balance && balance.state !== 'NOT_YET' && balance.last_ok;
    var value = 0, cost = 0, kinds = { manual: 0, engine: 0, mixed: 0 };
    holdings.forEach(function (h) { value += (h.price || 0) * (h.qty || 0); cost += (h.avg || 0) * (h.qty || 0); kinds[h.kind] = (kinds[h.kind] || 0) + 1; });
    var pnl = value - cost, rate = cost > 0 ? pnl / cost * 100 : null;
    var today = String(s.now || '').slice(0, 10);
    var real = orders.filter(function (o) { return o.status !== 'DRY' && isToday(o, today); });
    function side(o) { return o.reason === 'BUY' ? 'BUY' : 'SELL'; }
    var buys = real.filter(function (o) { return side(o) === 'BUY'; }).length;
    var sells = real.filter(function (o) { return side(o) === 'SELL'; }).length;
    var unconfirmed = real.filter(function (o) { return o.status === 'SENT' || o.status === 'ACK' || o.status === 'UNKNOWN'; }).length;
    function cell(label, val, sub, cls) { return '<div><small>' + label + '</small><b' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</b><i>' + (sub || '') + '</i></div>'; }
    var unavailable = !known ? (balance && balance.state === 'FAILED' ? '확인 불가' : '조회 전') : null;
    return '<section class="at-kpi">'
      + cell('총 평가금액', unavailable || fmtWon(value), unavailable ? '잔고 ' + (balance && balance.state === 'FAILED' ? '조회 실패' : '조회 전') : 'KRW · ' + (s.market_open ? '장중' : '직전 종가 기준') + (balance.state === 'STALE' ? ' · 오래됨' : ''))
      + cell('평가손익(비용 제외)', unavailable || signed(pnl), unavailable ? '' : pct(rate), unavailable ? '' : tone(pnl))
      + cell('보유 종목', unavailable || holdings.length + '개', unavailable ? '' : '기존 ' + kinds.manual + ' · 엔진 ' + kinds.engine + ' · 혼합 ' + kinds.mixed)
      + cell('오늘 매수 주문', buys + '건', '전송·접수 기준')
      + cell('오늘 매도 주문', sells + ' / ' + s.max_sells_per_day, '일 한도(로컬 봇)')
      + cell('체결 확인 전', unconfirmed + '건', '체결 여부는 키움에서 확인')
      + '</section>';
  }

  function badge(text, cls) { return '<span class="at-badge2 ' + (cls || '') + '">' + esc(text) + '</span>'; }

  function sellWatchCell(h, cfg) {
    var code = esc(h.code), name = esc(h.name || '');
    var out = [];
    if (h.kind !== 'manual') out.push(badge(h.engine_excluded === true ? '엔진 장부 ' + h.engine_qty + '주 · 엔진 제외' : '엔진 관리 ' + h.engine_qty + '주', 'is-engine'));
    if (h.sell_watch === 'analysis') {
      out.push(badge(h.kind === 'manual' ? '분석 전용 · 자동 매도 없음' : '분석 전용(이 화면·로컬 봇 기준)', 'is-analysis'));
      if (h.engine_excluded === true) out.push(badge('엔진 제외 확인됨', 'is-ok'), '<small class="at-mute">엔진 장부의 매수 기록은 보존되고, PC 엔진은 이 종목을 자동매수·자동매도하지 않습니다.</small>');
      else if (h.engine_excluded === null) out.push('<small class="at-warn-text">엔진 제외 목록을 읽지 못했습니다(확인 불가). 엔진 제외 여부를 직접 확인하세요.</small>');
      else if (h.kind !== 'manual') out.push('<small class="at-warn-text">PC 엔진 장부에 엔진 보유로 등록돼 있고 엔진 제외 목록에는 없습니다. 엔진이 가동되면 엔진의 고정 규칙(손절·익절)으로 매도 주문이 나갈 수 있습니다.</small>');
      out.push('<button type="button" class="at-mini" data-act="analysis-remove" data-code="' + code + '">분석 해제</button>');
    } else if (h.sell_watch === 'rule_confirmed') {
      out.push(badge('규칙 확인됨', 'is-ok'));
      out.push('<small class="at-mute">손절 -' + cfg.stop_loss_pct + '% · 익절 +' + cfg.take_profit_cap_pct + '% · 로컬 봇 실주문 비활성(기록만)</small>');
      out.push('<button type="button" class="at-mini" data-act="unwatch" data-code="' + code + '">감시 해제</button>');
    } else if (h.sell_watch === 'rule_unconfirmed') {
      out.push(badge('규칙 미확인 · 주문 미적용', 'is-wait'));
      if (h.rule_beyond) out.push('<small class="at-warn-text">등록 시점에 이미 기준을 넘은 상태입니다. 확인 전에는 판단·주문에 쓰이지 않습니다.</small>');
      out.push('<button type="button" class="at-mini" data-act="confirm" data-code="' + code + '" data-name="' + name + '" data-beyond="' + (h.rule_beyond ? '1' : '') + '">규칙 확인</button>');
      out.push('<button type="button" class="at-mini" data-act="unwatch" data-code="' + code + '">감시 해제</button>');
    } else {
      out.push('<span class="at-mute">매도 관리 없음</span>');
      out.push('<button type="button" class="at-mini" data-act="analysis-add" data-code="' + code + '" data-name="' + name + '">분석 전용 등록</button>');
      out.push('<button type="button" class="at-mini" data-act="watch-add" data-code="' + code + '" data-name="' + name + '">손절·익절 감시 등록</button>');
    }
    return '<div class="at-stack">' + out.join('') + '</div>';
  }

  function holdingsHtml(list, balance, cfg) {
    var state = balance && balance.state;
    if (state === 'NOT_YET') return '<p class="at-empty">잔고 <b>조회 전</b>입니다. 보유 종목이 없다는 뜻이 아닙니다. 로컬 봇이 첫 조회를 마치면 표시됩니다.</p>';
    if (state === 'FAILED' && !balance.last_ok) return '<p class="at-empty is-bad">잔고 <b>확인 불가</b>: ' + esc(balance.error || '조회 실패') + '. 보유 종목 수를 알 수 없습니다(0개가 아닙니다).</p>';
    var banner = '';
    if (state === 'FAILED') banner = '<p class="at-banner is-bad">최근 조회 실패(' + esc(balance.error || '') + '). 아래는 <b>마지막 정상 조회 ' + esc(balance.last_ok) + '</b> 기준입니다.</p>';
    else if (state === 'STALE') banner = '<p class="at-banner is-wait">잔고가 오래됐습니다(마지막 정상 ' + esc(balance.last_ok) + '). 최신 상태가 아닐 수 있습니다.</p>';
    if (!list.length) return banner + '<p class="at-empty">보유 종목 <b>0개</b>입니다(잔고 조회 정상, ' + esc(hhmm(balance.last_ok)) + ').</p>';
    return banner + '<div class="at-table-wrap"><table class="at-table at-hold"><thead><tr><th>종목</th><th>구분</th><th class="n">잔고</th><th class="n">주문 가능</th>'
      + '<th class="n">묶임</th><th class="n">매입가</th><th class="n">현재가</th><th class="n">평가 손익률</th><th>매도 관리</th></tr></thead><tbody>'
      + list.map(function (h) {
        var flags = [];
        if (h.pending_order) flags.push(badge('주문 진행 중 · 체결 확인 전', 'is-wait'));
        if (h.qty_mismatch) flags.push(badge('엔진 수량 불일치', 'is-bad'));
        return '<tr><td><b>' + esc(h.name || '') + '</b> <code>' + esc(h.code) + '</code></td>'
          + '<td>' + badge(KIND_LABEL[h.kind] || h.kind, 'is-' + h.kind) + (h.kind === 'mixed' ? '<small class="at-mute">엔진 ' + h.engine_qty + ' · 기존 ' + h.manual_qty + '주</small>' : '') + flags.join('') + '</td>'
          + '<td class="n">' + esc(h.qty) + '</td><td class="n">' + esc(h.sellable) + '</td>'
          + '<td class="n">' + (h.locked_qty ? '<span class="at-warn-text">' + h.locked_qty + '</span>' : '0') + '</td>'
          + '<td class="n">' + fmtPrice(h.avg) + '</td><td class="n">' + fmtPrice(h.price) + '</td>'
          + '<td class="n ' + tone(h.gain) + '">' + pct(h.gain) + '</td><td>' + sellWatchCell(h, cfg) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      + '<p class="at-note">잔고 = 보유 수량, 주문 가능 = 지금 매도 주문을 낼 수 있는 수량, 묶임 = 미체결 등으로 묶인 수량입니다. 장전·마감 후 현재가는 직전 종가입니다.</p>';
  }

  function analysisHtml(state) {
    var codes = state.analysis;
    if (!codes.length) return '';
    var cards = codes.map(function (a) {
      var h = state.holdings.filter(function (x) { return x.code === a.code; })[0];
      var res = state.analysisResult[a.code];
      var head = '<div class="at-ana-head"><b>' + esc(a.name || (h && h.name) || a.code) + '</b> <code>' + esc(a.code) + '</code>'
        + (h ? ' <span class="at-mute">' + esc(h.qty) + '주 · 매입가 ' + fmtPrice(h.avg) + '원</span>' : '') + '</div>';
      if (!h) return '<div class="at-ana">' + head + '<p class="at-empty">현재 잔고에 없는 종목입니다(분석 전용 등록만 유지).</p></div>';
      if (!res) return '<div class="at-ana">' + head + '<p class="at-empty">분석 데이터를 불러오는 중입니다…</p></div>';
      var lv = res.levels || {};
      var levels = [['지지', lv.support], ['저항', lv.resistance], ['20일선', lv.ma20], ['60일선', lv.ma60]].filter(function (x) { return x[1]; })
        .map(function (x) { return '<span><small>' + x[0] + '</small><b>' + fmtPrice(x[1]) + '</b></span>'; }).join('');
      return '<div class="at-ana">' + head
        + '<div class="at-ana-state"><span class="at-verdict2 ' + res.tone + '">' + esc(res.label) + '</span>'
        + '<span class="at-mute">가격 ' + esc(res.asOf.price) + ' (' + esc(res.asOf.priceBasis) + ') · 일봉 ' + esc(res.asOf.daily) + ' · 수급 ' + esc(res.asOf.flow) + '</span></div>'
        + (levels ? '<div class="at-levels">' + levels + '</div>' : '')
        + '<ul class="at-why">' + res.reasons.map(function (r) { return '<li class="is-' + r.k + '">' + esc(r.t) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    return '<section class="at-box"><div class="at-hd"><h3>분석 전용 보유 종목</h3><span>보유 유지 · 매도 주의 · 매도 검토 · 자동 주문 없음</span></div>'
      + '<p class="at-note at-note-top">고정 손절·익절 규칙을 적용하지 않고 현재가·이동평균·지지/저항·거래량·외국인/기관 수급으로 상태만 보여 줍니다. 매도는 자동으로 실행되지 않으며 직접 확인한 뒤 증권사에서 진행합니다. 데이터가 없거나 오래되면 판단 불가로 표시합니다.</p>'
      + cards + '</section>';
  }

  // 분석 전용으로 둔 종목이 PC 엔진 장부(live_orders.db)에도 엔진 보유로 있으면, 엔진의 고정 규칙이 별도로 적용될 수 있다(엔진은 이 화면과 무관).
  function engineConflictHtml(d) {
    var hit = d.holdings.filter(function (h) { return h.sell_watch === 'analysis' && h.kind !== 'manual' && h.engine_excluded !== true; });
    if (!hit.length) return '';
    var armed = d.status.live_active || d.status.live_scheduled;
    return '<p class="at-banner is-bad"><b>확인 필요:</b> ' + hit.map(function (h) { return esc(h.name || h.code); }).join(', ')
      + '은(는) 분석 전용이지만 PC 실계좌 엔진 장부에 엔진 보유 ' + hit.map(function (h) { return h.engine_qty + '주'; }).join(', ') + '로 등록돼 있습니다. '
      + (armed ? '오늘 실주문이 시작 설정되어 있어 엔진이 가동되면 엔진 규칙(손절·익절)으로 매도 주문을 낼 수 있습니다. ' : '엔진이 가동되면 엔진 규칙으로 매도 주문을 낼 수 있습니다. ')
      + '이 화면은 엔진 설정을 바꾸지 않습니다. 엔진 장부 처리는 직접 결정해야 합니다.</p>';
  }

  function policyHtml(s, holdings) {
    var pol = s.live_policy, live = s.live_engine, rows = [];
    function row(k, v) { rows.push('<div class="at-row"><span>' + k + '</span><b>' + v + '</b></div>'); }
    if (pol) {
      row('운용 예산', fmtWon(pol.budget) + '원 · 최대 ' + pol.max_stocks + '종목 · 종목당 최대 ' + fmtWon(pol.per_stock) + '원');
      row('현금 예비금', fmtWon(pol.reserve) + '원 유지');
      row('매매 비용 가정', pol.cost_pct + '% (순손익 계산용)');
      row('청산 규칙', pol.exit ? '매입가 대비 -' + pol.exit.stop_pct + '% 손절(연속 ' + pol.exit.confirm_checks + '회 확인) · -' + pol.exit.emergency_stop_pct + '% 비상 즉시 손절 · 고점이 +' + pol.exit.trail_arm_pct + '% 이상이면 고점 대비 -' + pol.exit.trail_pct + '% 이탈 시 추적 매도(고정 익절 없음, 비용 제외)' : '확인 불가(엔진 규칙 대조 실패 - 표시 안 함)');
    }
    var manual = holdings.filter(function (h) { return h.kind !== 'engine'; }).length;
    var note = pol ? '<p class="at-note">값 출처: PC 엔진 <code>live_engine.py</code>(읽기 전용). 이 화면의 문구를 고정값으로 쓰지 않습니다.</p>'
      : '<p class="at-note is-bad">PC 엔진 정책 값을 읽지 못했습니다(엔진 파일 없음 또는 확인 불가). 예산·종목 수·손절/익절 값은 <b>현재 설정으로 표시하지 않습니다</b>.</p>';
    var engineLine = live ? (ENGINE_STATES[live.state] || '점검 중') + ' · 확인 ' + esc(hhmm(live.checked_at && String(live.checked_at).replace('T', ' ')))
      + (live.candidate_count != null ? ' · 후보 ' + live.candidate_count + '개' : '')
      : '엔진 상태 신호 없음(90초 안 갱신 없음 - 중지됐거나 장 시간 밖)';
    var warn = manual ? '<p class="at-note is-wait">기존 수동 보유 ' + manual + '종목이 있습니다. PC 엔진 코드상 이런 보유가 있으면 신규 매수 전에 <code>FOREIGN_HOLDINGS</code>로 멈추고, 엔진은 직접 산 종목만 매도합니다(기존 보유는 건드리지 않음).</p>' : '';
    return '<section class="at-box"><div class="at-hd"><h3>오늘의 매매 규칙</h3><span>신규 후보 상태 포함</span></div>' + rows.join('') + note
      + '<div class="at-row"><span>엔진 상태</span><b>' + engineLine + '</b></div>'
      + '<div class="at-row"><span>엔진 제외 종목</span><b>' + (s.engine_excluded == null ? '확인 불가' : s.engine_excluded.length ? esc(s.engine_excluded.join(', ')) + ' (자동매수·매도 없음)' : '없음') + '</b></div>'
      + '<div class="at-row"><span>실주문</span><b>' + esc(liveState(s).orders) + '</b></div>'
      + '<div class="at-row"><span>로컬 감시 봇 매도</span><b>기록 전용(주문 없음)</b></div>' + warn + '</section>';
  }

  function watchHtml(watch) {
    var rows = watch.length ? '<div class="at-chips">' + watch.map(function (w) {
      return '<span class="at-chip">' + esc(w.name || '') + ' <code>' + esc(w.code) + '</code> ' + (w.confirmed ? '<small>확인됨</small>' : '<small class="at-warn-text">미확인</small>')
        + '<button type="button" data-unwatch="' + esc(w.code) + '" aria-label="' + esc(w.code) + ' 감시 해제">×</button></span>';
    }).join('') + '</div>' : '<p class="at-empty">손절·익절 감시 종목이 없습니다.</p>';
    return '<section class="at-box"><div class="at-hd"><h3>손절·익절 감시 등록</h3><span>등록만으로는 주문에 쓰이지 않음 · 규칙 확인 필요</span></div>' + rows
      + '<form class="at-token at-add" data-watch-form><input type="text" inputmode="numeric" maxlength="6" placeholder="종목코드 6자리" aria-label="종목코드" data-watch-code>'
      + '<input type="text" maxlength="20" placeholder="종목명(선택)" aria-label="종목명" data-watch-name><button type="submit">추가</button></form>'
      + '<p class="at-note">등록한 종목은 "규칙 미확인" 상태로 시작합니다. 보유 목록에서 규칙을 확인해도 로컬 봇의 실주문은 비활성이라 주문은 나가지 않습니다.</p></section>';
  }

  // 종목명: 서버가 준 name → 보유·감시 목록 → 사이트 종목 사전(data/krx_map.js, 없으면 한 번만 불러와 다시 그린다) 순서로 찾는다.
  var lastRendered = null, krxByCode = null, krxLoading = false;
  function loadKrxMap() {
    if (global.KRX_MAP || krxLoading) return;
    krxLoading = true;
    var sc = document.createElement('script');
    sc.src = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js';
    sc.onload = function () { krxByCode = null; if (lastRendered) render(lastRendered); };
    document.head.appendChild(sc);
  }
  function krxName(code) {
    if (!global.KRX_MAP) return '';
    if (!krxByCode) { krxByCode = {}; Object.keys(global.KRX_MAP).forEach(function (n) { krxByCode[global.KRX_MAP[n]] = n; }); }
    return krxByCode[code] || '';
  }
  function orderNames(d) {
    var m = {};
    (d.holdings || []).concat(d.watch || []).forEach(function (h) { if (h && h.code && h.name) m[h.code] = h.name; });
    return m;
  }
  // 매수 가격 = 주문 접수가(지정가), 매도 가격 = 시장가라 체결가가 없어 전송 시점 판정가(새 엔진) 또는 1분봉 종가 추정(예전 주문). 둘 다 실제 체결가가 아니다.
  var PRICE_KIND = { order: '주문가', decision: '판정가', estimate: '추정', actual: '체결가' };
  function priceCell(price, kind, empty) {
    if (!price) return '<td class="n at-mute" title="' + esc(empty || '') + '">-</td>';
    return '<td class="n">' + fmtPrice(price) + (kind && PRICE_KIND[kind] ? '<small class="at-sub">' + PRICE_KIND[kind] + '</small>' : '') + '</td>';
  }

  // ---- 주문 지표(등락률·평가금액·평가손익) ----
  // 등락률 = 매도 가격 / 이 매도가 닫는 매수 주문가 - 1. 평가금액 = 수량 x 가격(매수=매수금액, 매도=매도금액), 평가손익 = 매도 행의 수량 x (매도가 - 매수가).
  // 모두 비용(수수료·세금) 제외이며 매도 가격은 판정가·추정이라 실제 체결 손익과 다를 수 있다.
  function orderMetric(o) {
    var isBuy = o.reason === 'BUY', qty = Number(o.qty) || 0, price = Number(o.price) || 0, buy = Number(o.buy_price) || 0;
    var m = { isBuy: isBuy, qty: qty, price: price, amount: price && qty ? price * qty : null, pnl: null, ret: null, cost: null };
    if (!isBuy && price && buy && qty) { m.pnl = (price - buy) * qty; m.ret = (price / buy - 1) * 100; m.cost = buy * qty; }
    return m;
  }
  function realOrders(orders) { return (orders || []).filter(function (o) { return o.status !== 'DRY' && (o.reason === 'BUY' || o.reason === 'SELL'); }); }
  var selMonth = null, selDay = null, monthScroll = null;
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function daysInMonth(ym) { var p = ym.split('-'); return new Date(Number(p[0]), Number(p[1]), 0).getDate(); }
  function shiftMonth(ym, delta) { var p = ym.split('-'), d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function pad2(n) { return ('0' + n).slice(-2); }
  function monthAggregate(orders, ym) {
    var n = daysInMonth(ym), days = [], i;
    for (i = 1; i <= n; i++) days.push({ date: ym + '-' + pad2(i), buy: 0, sell: 0, pnl: 0, cost: 0, count: 0, unpriced: 0 });
    realOrders(orders).forEach(function (o) {
      var day = String(o.ts || '').slice(0, 10);
      if (day.slice(0, 7) !== ym) return;
      var row = days[Number(day.slice(8, 10)) - 1]; if (!row) return;
      var m = orderMetric(o); row.count++;
      if (m.isBuy) { if (m.amount != null) row.buy += m.amount; else row.unpriced++; }
      else if (m.amount != null) { row.sell += m.amount; if (m.pnl != null) { row.pnl += m.pnl; row.cost += m.cost; } else row.unpriced++; }
      else row.unpriced++;
    });
    return days;
  }
  function monthSummaryHtml(orders, today) {
    var ym = selMonth || String(today).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return '';
    var days = monthAggregate(orders, ym);
    var tot = days.reduce(function (a, r) { a.buy += r.buy; a.sell += r.sell; a.pnl += r.pnl; a.cost += r.cost; a.count += r.count; a.unpriced += r.unpriced; return a; }, { buy: 0, sell: 0, pnl: 0, cost: 0, count: 0, unpriced: 0 });
    var rate = tot.cost > 0 ? tot.pnl / tot.cost * 100 : null;
    var rows = days.map(function (r) {
      var dt = new Date(r.date + 'T00:00:00'), has = r.count > 0, sel = selDay === r.date;
      var rr = r.cost > 0 ? r.pnl / r.cost * 100 : null;
      return '<tr class="at-day' + (has ? ' has' : '') + (sel ? ' is-sel' : '') + '"' + (has ? ' data-day="' + r.date + '" tabindex="0"' : '') + '>'
        + '<td>' + Number(r.date.slice(8, 10)) + '일 <small class="at-sub-inline">' + WEEK[dt.getDay()] + '</small></td>'
        + '<td class="n">' + (r.buy ? fmtWon(r.buy) : '-') + '</td><td class="n">' + (r.sell ? fmtWon(r.sell) : '-') + '</td>'
        + '<td class="n ' + (r.cost ? tone(r.pnl) : '') + '">' + (r.cost ? signed(r.pnl) : '-') + '</td>'
        + '<td class="n ' + (rr != null ? tone(rr) : '') + '">' + (rr != null ? pct(rr) : '-') + '</td>'
        + '<td class="n">' + (has ? r.count + (r.unpriced ? ' <small class="at-sub-inline" title="가격이 없어 금액·손익에서 빠진 주문">(가격 없음 ' + r.unpriced + ')</small>' : '') : '-') + '</td></tr>';
    }).join('');
    return '<section class="at-box at-month"><div class="at-hd"><h3>월간 일자별 합계</h3><span>매수·매도 금액과 평가손익 · 비용 제외 · 매도가는 판정가·추정</span></div>'
      + '<div class="at-month-ctl"><button type="button" class="at-mini" data-mon="-1" aria-label="이전 달">◀</button>'
      + '<input type="month" data-month value="' + esc(ym) + '" aria-label="월 선택"><button type="button" class="at-mini" data-mon="1" aria-label="다음 달">▶</button>'
      + '<button type="button" class="at-mini" data-mon="today">이번 달</button>'
      + (selDay ? '<span class="at-day-pick">' + esc(selDay) + ' 주문만 보는 중 <button type="button" class="at-mini" data-day-clear>전체 보기</button></span>' : '<span class="at-mute">날짜 줄을 누르면 그날 주문만 아래 주문 기록에 보입니다.</span>') + '</div>'
      + '<div class="at-month-sum"><div><small>월 매수금액</small><b>' + fmtWon(tot.buy) + '</b></div><div><small>월 매도금액(평가금액)</small><b>' + fmtWon(tot.sell) + '</b></div>'
      + '<div><small>월 평가손익</small><b class="' + tone(tot.pnl) + '">' + (tot.cost ? signed(tot.pnl) : '-') + '</b></div>'
      + '<div><small>월 수익률</small><b class="' + (rate != null ? tone(rate) : '') + '">' + (rate != null ? pct(rate) : '-') + '</b></div>'
      + '<div><small>주문 건수</small><b>' + tot.count + '</b><i>' + (tot.unpriced ? '가격 없음 ' + tot.unpriced : '모두 가격 있음') + '</i></div></div>'
      + '<div class="at-table-wrap at-month-wrap"><table class="at-table at-month-table"><thead><tr><th>일</th><th class="n">매수금액</th><th class="n">매도금액(평가금액)</th><th class="n">평가손익</th><th class="n">수익률</th><th class="n">주문</th></tr></thead><tbody>'
      + rows + '</tbody><tfoot><tr><th>합계</th><th class="n">' + fmtWon(tot.buy) + '</th><th class="n">' + fmtWon(tot.sell) + '</th><th class="n ' + (tot.cost ? tone(tot.pnl) : '') + '">' + (tot.cost ? signed(tot.pnl) : '-') + '</th><th class="n">' + (rate != null ? pct(rate) : '-') + '</th><th class="n">' + tot.count + '</th></tr></tfoot></table></div></section>';
  }

  // ---- CSV 내려받기(브라우저에서만 만든다, 서버로 보내지 않음) ----
  function csvCell(v) { var s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function ordersCsv(orders, d) {
    var names = orderNames(d || {});
    var head = ['시각', '종목명', '종목코드', '구분', '수량', '매수 가격', '매도 가격', '가격 구분', '등락률(%)', '평가금액', '평가손익', '상태', '매도 사유', '내용'];
    var rows = realOrders(orders).slice().sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); }).map(function (o) {
      var m = orderMetric(o), name = o.name || names[o.code] || krxName(o.code);
      return [o.ts, name, o.code, m.isBuy ? '매수' : '매도', o.qty, m.isBuy ? o.price : o.buy_price, m.isBuy ? '' : o.price, PRICE_KIND[o.price_kind] || '',
        m.ret != null ? m.ret.toFixed(2) : '', m.amount != null ? Math.round(m.amount) : '', m.pnl != null ? Math.round(m.pnl) : '',
        ORDER_STATUS[o.status] || o.status, o.exit_reason || '', o.detail || ''].map(csvCell).join(',');
    });
    return '\ufeff' + head.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
  }
  function downloadCsv(orders, d, ym) {
    var list = ym ? realOrders(orders).filter(function (o) { return String(o.ts || '').slice(0, 7) === ym; }) : orders;
    var stamp = String((d.status && d.status.now) || '').slice(0, 10).replace(/-/g, '');
    var name = ym ? '주문기록_' + ym + '.csv' : '주문기록_전체_' + stamp + '.csv';
    var blob = new Blob([ordersCsv(list, d)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function ordersHtml(rows, today, d) {
    rows = rows.filter(function (o) { return o.status !== 'DRY'; });
    if (!rows.length) return '<p class="at-empty">아직 주문 기록이 없습니다.</p>';
    var names = orderNames(d || {});
    var list = selDay ? rows.filter(function (o) { return String(o.ts || '').slice(0, 10) === selDay; }) : rows;
    var shown = selDay ? list : list.slice(0, 30);
    var missing = false;
    var body = shown.map(function (o) {
      var isBuy = o.reason === 'BUY', m = orderMetric(o);
      var name = o.name || names[o.code] || krxName(o.code);
      if (!name) missing = true;
      // 익절(매수가 대비 +)은 연한 붉은 음영, 손절(-)은 연한 파란 음영. 가격이 없어 등락률을 못 구하면 음영 없음.
      var shade = m.ret == null ? '' : m.ret > 0 ? ' class="at-row-win"' : m.ret < 0 ? ' class="at-row-loss"' : '';
      return '<tr' + shade + '><td>' + esc(o.ts) + '</td><td>' + (name ? '<b>' + esc(name) + '</b><small class="at-sub">' + esc(o.code) + '</small>' : esc(o.code)) + '</td>'
        + '<td>' + (isBuy ? '매수' : '매도') + (REASON_LABEL[o.reason] && !isBuy && o.reason !== 'SELL' ? ' · ' + esc(REASON_LABEL[o.reason]) : '') + '</td>'
        + '<td class="n">' + esc(o.qty) + '</td>'
        + (isBuy ? priceCell(o.price, 'order', '매수 주문가 기록 없음') : priceCell(o.buy_price, 'order', '이 매도의 매수 기록을 찾지 못함'))
        + (isBuy ? '<td class="n at-mute">-</td>' : priceCell(o.price, o.price_kind, '매도 가격이 기록되지 않았고 추정할 분봉도 없음(전송 후 약 2거래일까지만 추정)'))
        + '<td class="n ' + (m.ret != null ? tone(m.ret) : 'at-mute') + '">' + (m.ret != null ? pct(m.ret) : '-') + '</td>'
        + '<td class="n">' + (m.amount != null ? fmtWon(m.amount) : '-') + '</td>'
        + '<td class="n ' + (m.pnl != null ? tone(m.pnl) : 'at-mute') + '">' + (m.pnl != null ? signed(m.pnl) : '-') + '</td>'
        + '<td class="at-st-' + esc(o.status) + '">' + esc(ORDER_STATUS[o.status] || o.status) + '</td><td>' + esc(o.detail || '') + '</td></tr>';
    }).join('');
    if (missing) loadKrxMap();
    var tools = '<div class="at-order-tools"><button type="button" class="at-mini" data-dl="all">CSV 내려받기(전체)</button>'
      + '<button type="button" class="at-mini" data-dl="month">CSV 내려받기(선택한 달)</button>'
      + '<span class="at-legend"><i class="at-sw at-sw-win"></i>익절(매수가 대비 +) <i class="at-sw at-sw-loss"></i>손절(-)</span></div>';
    return tools + (shown.length ? '<div class="at-table-wrap"><table class="at-table"><thead><tr><th>시각</th><th>종목</th><th>구분</th><th class="n">수량</th><th class="n">매수 가격</th><th class="n">매도 가격</th><th class="n">등락률</th><th class="n">평가금액</th><th class="n">평가손익</th><th>상태</th><th>내용</th></tr></thead><tbody>'
      + body + '</tbody></table></div>' : '<p class="at-empty">' + esc(selDay) + '에는 주문이 없습니다.</p>')
      + '<p class="at-note">"체결 확인 전"은 전송·접수까지만 확인된 상태입니다. 매수 가격은 주문 접수가이고, 매도는 시장가 주문이라 전송 시점의 판정가(2026-10-16 이후 주문) 또는 1분봉 종가 추정(그 이전 주문)을 보여 줍니다. 등락률은 매도 가격이 매수 주문가보다 얼마나 높고 낮은지, 평가금액·평가손익은 수량을 곱한 값(수수료·세금 제외)입니다. “체결가” 표시는 키움 당일매매일지로 확인한 실제 체결 평균가이고, 그 외 가격은 실제 체결가가 아니니 키움 체결내역에서 확인하세요.</p>';
  }

  function eventRows(rows) {
    return '<div class="at-table-wrap"><table class="at-table"><thead><tr><th>시각</th><th>종류</th><th>종목</th><th class="n">가격</th><th>내용</th></tr></thead><tbody>'
      + rows.map(function (e) {
        return '<tr class="at-ev at-ev--' + esc(e.type) + '"><td>' + esc(e.ts) + '</td><td>' + esc(TYPE_LABEL[e.type] || e.type) + '</td><td>' + esc(e.code || '') + '</td>'
          + '<td class="n">' + (e.price == null ? '' : fmtPrice(e.price)) + '</td><td>' + esc(e.detail) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function eventsHtml(rows) {
    rows = rows.filter(function (e) { return e.type !== 'DRY_SELL'; });
    var options = ['', 'SELL_SENT', 'POSITION_CLOSED', 'ERROR', 'CRITICAL', 'SKIP', 'WATCH_ADD', 'WATCH_CONFIRM', 'ANALYSIS_ADD'];
    var select = '<select data-type-filter aria-label="이벤트 종류">' + options.map(function (t) {
      return '<option value="' + t + '"' + (t === typeFilter ? ' selected' : '') + '>' + (t ? (TYPE_LABEL[t] || t) : '전체') + '</option>';
    }).join('') + '</select>';
    if (!rows.length) return '<section class="at-box"><div class="at-hd"><h3>이벤트 로그</h3>' + select + '</div><p class="at-empty">기록이 없습니다.</p></section>';
    var latest = rows.slice(0, 8);
    return '<section class="at-box"><div class="at-hd"><h3>이벤트 로그</h3>' + select + '</div>' + eventRows(latest)
      + (rows.length > latest.length ? '<details class="at-more"><summary>전체 로그 보기 (' + rows.length + '건)</summary>' + eventRows(rows.slice(latest.length)) + '</details>' : '')
      + '</section>';
  }

  function render(d) {
    lastRendered = d;
    var balance = d.holdingsMeta.balance || d.status.balance;
    // 구버전 봇은 조회 상태를 모른다: 보유 목록이 있으면 그대로 보여 주고(배너로 경고), 비어 있으면 0개가 아니라 '조회 전'으로 둔다.
    if (!balance) balance = { state: d.holdings.length ? 'OK' : 'NOT_YET', legacy: true, last_ok: d.status.last_poll || null, age_sec: null };
    root.innerHTML = (d.legacy ? '<p class="at-banner is-bad">PC에서 실행 중인 자동매매 프로그램이 이전 버전이라 잔고 조회 상태·분석 전용·정책 정보가 없습니다. 프로그램을 새 버전으로 업데이트하면 표시됩니다(보유 종목 수는 이 상태에서 신뢰하지 마세요).</p>' : '')
      + topbarHtml(d.status, balance) + engineConflictHtml(d) + kpiHtml(d.status, d.holdings, d.orders, balance) + monthSummaryHtml(d.orders, String(d.status.now || '').slice(0, 10))
      // 주문 기록은 표가 넓어(11칸) 두 칼럼 안에 두면 줄바꿈이 심해 전체 폭 구역으로 올렸다(2026-10-16).
      + '<section class="at-box at-orders-wide"><div class="at-hd"><h3>주문 기록</h3><span>최근 주문 먼저 · 전송과 체결은 구분</span></div>' + ordersHtml(d.orders, String(d.status.now || '').slice(0, 10), d) + '</section>'
      + scheduleHtml(d.schedules)
      + '<div class="at-grid"><div class="at-col">'
      + '<section class="at-box"><div class="at-hd"><h3>보유 종목</h3><span>키움 잔고 기준 · 장전에도 조회(주문 없음) · 마지막 정상 ' + esc(hhmm(balance && balance.last_ok)) + '</span></div>'
      + holdingsHtml(d.holdings, balance, d.status) + '</section>'
      + analysisHtml(d)
      + eventsHtml(d.events)
      + '</div><div class="at-col">' + policyHtml(d.status, d.holdings) + watchHtml(d.watch) + '</div></div>';
    wire(d);
  }

  function post(path, body) { return api(path, 'POST', body).then(refresh).catch(refresh); }

  function wire(d) {
    var scheduleDetails = root.querySelector('[data-schedule-details]');
    if (scheduleDetails) scheduleDetails.addEventListener('toggle', function () { scheduleExpanded = scheduleDetails.open; });
    var tdy = String(d.status.now || '').slice(0, 10);
    var mon = root.querySelector('[data-month]');
    if (mon) mon.addEventListener('change', function (e) { if (/^\d{4}-\d{2}$/.test(e.target.value)) { selMonth = e.target.value; selDay = null; monthScroll = null; render(d); } });
    root.querySelectorAll('[data-mon]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-mon'), cur = selMonth || tdy.slice(0, 7);
        selMonth = v === 'today' ? tdy.slice(0, 7) : shiftMonth(cur, Number(v)); selDay = null; monthScroll = null; render(d);
      });
    });
    root.querySelectorAll('[data-day]').forEach(function (r) {
      function pick() { var day = r.getAttribute('data-day'); selDay = selDay === day ? null : day; render(d); }
      r.addEventListener('click', pick);
      r.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    // 월간 표 스크롤: 15초마다 다시 그려도 보던 위치를 유지하고, 처음에는 주문이 있는 첫 날 근처에서 시작한다.
    var mw = root.querySelector('.at-month-wrap');
    if (mw) {
      var first = mw.querySelector('tr.is-sel') || mw.querySelector('tr.has');
      mw.scrollTop = monthScroll != null ? monthScroll : (first ? Math.max(0, first.offsetTop - 70) : 0);
      mw.addEventListener('scroll', function () { monthScroll = mw.scrollTop; });
    }
    var clr = root.querySelector('[data-day-clear]');
    if (clr) clr.addEventListener('click', function () { selDay = null; render(d); });
    root.querySelectorAll('[data-dl]').forEach(function (b) {
      b.addEventListener('click', function () { downloadCsv(d.orders, d, b.getAttribute('data-dl') === 'month' ? (selMonth || tdy.slice(0, 7)) : null); });
    });
    root.querySelector('[data-toggle]').addEventListener('click', function () {
      api(d.status.stopped ? '/api/resume' : '/api/stop', 'POST').then(refresh).catch(refresh);
    });
    root.querySelector('[data-type-filter]').addEventListener('change', function (event) { typeFilter = event.target.value; refresh(); });
    root.querySelector('[data-watch-form]').addEventListener('submit', function (event) {
      event.preventDefault();
      var code = root.querySelector('[data-watch-code]').value.trim();
      var name = root.querySelector('[data-watch-name]').value.trim();
      if (!/^\d{6}$/.test(code)) return;
      post('/api/watch', { code: code, name: name });
    });
    root.querySelectorAll('[data-unwatch]').forEach(function (button) {
      button.addEventListener('click', function () { post('/api/unwatch', { code: button.getAttribute('data-unwatch') }); });
    });
    root.querySelectorAll('[data-act]').forEach(function (button) {
      button.addEventListener('click', function () {
        var act = button.getAttribute('data-act'), code = button.getAttribute('data-code'), name = button.getAttribute('data-name') || '';
        if (act === 'analysis-add') post('/api/analysis', { code: code, name: name });
        else if (act === 'analysis-remove') post('/api/analysis-remove', { code: code });
        else if (act === 'watch-add') post('/api/watch', { code: code, name: name });
        else if (act === 'unwatch') post('/api/unwatch', { code: code });
        else if (act === 'confirm') {
          var st = d.status;
          var text = '이 종목에 손절 -' + st.stop_loss_pct + '% · 익절 +' + st.take_profit_cap_pct + '% 규칙을 적용하는 것을 확인합니다.\n'
            + (button.getAttribute('data-beyond') ? '\n※ 지금 이미 기준을 넘은 상태입니다. 확인하면 다음 판단 주기에 규칙 대상이 됩니다.\n' : '')
            + '\n로컬 감시 봇의 실주문은 현재 비활성이라 주문은 나가지 않고 기록만 남습니다. 계속할까요?';
          if (global.confirm(text)) post('/api/watch-confirm', { code: code, confirmed: true });
        }
      });
    });
  }

  /* ───────────── 분석 데이터 ───────────── */
  function getJson(url) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var t = controller ? setTimeout(function () { controller.abort(); }, 9000) : null;
    return fetch(url, { signal: controller ? controller.signal : undefined }).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { if (t) clearTimeout(t); throw e; }).then(function (b) { return b && b.data ? b.data : b; });
  }

  function loadAnalysisData(code) {
    var hit = anaCache[code];
    if (hit && Date.now() - hit.at < ANALYSIS_TTL_MS) return Promise.resolve(hit.data);
    return Promise.all([
      getJson(VM + '/flow-chart/' + code),
      getJson(VM + '/foreign-flow/' + code + '?days=20').catch(function () { return null; })
    ]).then(function (out) {
      anaCache[code] = { at: Date.now(), data: { chart: out[0], flow: out[1] } };
      return anaCache[code].data;
    });
  }

  function analysisInput(h, data, state, balance) {
    var fresh = balance && (balance.state === 'OK') && balance.age_sec != null && balance.age_sec <= balance.stale_after_sec;
    return { price: h.price, avg: h.avg, priceAt: balance && balance.last_ok, priceFresh: !!fresh,
      priceNote: balance ? ('잔고 ' + balance.state + (balance.age_sec != null ? ', ' + balance.age_sec + '초 전' : '')) : '',
      marketOpen: !!state.market_open, today: String(state.now || '').slice(0, 10),
      daily: data.chart && data.chart.daily, ma: data.chart && data.chart.ma, levels: data.chart && data.chart.levels, flow: data.flow };
  }

  function runAnalysis(d) {
    var balance = d.holdingsMeta.balance || d.status.balance;
    if (!balance) return Promise.resolve();
    var jobs = d.analysis.map(function (a) {
      var h = d.holdings.filter(function (x) { return x.code === a.code; })[0];
      if (!h) return Promise.resolve();
      return loadAnalysisData(a.code).then(function (data) {
        d.analysisResult[a.code] = analyze(analysisInput(h, data, d.status, balance));
      }).catch(function () {
        d.analysisResult[a.code] = analyze({ price: h.price, priceFresh: true, daily: [], today: String(d.status.now || '').slice(0, 10) });
        d.analysisResult[a.code].reasons = [{ k: 'warn', t: '분석 데이터(일봉·수급)를 불러오지 못했습니다.' }];
      });
    });
    return Promise.all(jobs);
  }

  var lastAnalysis = {};

  function refresh() {
    if (!root) return;
    if (!getToken()) { shellDisconnected('아직 접속 토큰이 없습니다.'); return; }
    Promise.all([api('/api/status'), api('/api/watch'), api('/api/holdings'), api('/api/orders?limit=1000'),
      api('/api/events?limit=200' + (typeFilter ? '&type=' + encodeURIComponent(typeFilter) : '')),
      api('/api/analysis').catch(function (e) { if (e && e.message === 'token') throw e; return { analysis: [], legacy: true }; })])
      .then(function (out) {
        var legacy = !out[0].balance;      // PC 실행본이 구버전이면 새 필드가 없다 - 0개·조회 전으로 오해하지 않게 따로 표시한다
        var holdings = (out[2].holdings || []).map(function (h) {
          return h.kind ? h : Object.assign({}, h, { kind: h.live_managed ? 'engine' : 'manual', engine_qty: h.live_managed ? h.qty : 0, manual_qty: h.live_managed ? 0 : h.qty,
            locked_qty: Math.max(0, (h.qty || 0) - (h.sellable || 0)), sell_watch: h.watched ? 'rule_confirmed' : 'none' });
        });
        var d = { status: out[0], watch: out[1].watch || [], holdings: holdings, holdingsMeta: out[2] || {}, orders: out[3].orders || [],
          events: out[4].events || [], analysis: out[5].analysis || [], analysisResult: lastAnalysis, legacy: legacy };
        render(d);
        loadSchedules().then(function (items) { d.schedules = items; render(d); });
        runAnalysis(d).then(function () { lastAnalysis = d.analysisResult; if (d.analysis.length) render(d); });
      })
      .catch(function (error) {
        if (error && error.message === 'token') { setToken(''); shellDisconnected('토큰이 맞지 않습니다. .token 파일 내용을 다시 붙여 넣으세요.'); return; }
        shellDisconnected('프로그램에 연결하지 못했습니다(실행 중인지, 이 PC의 브라우저인지 확인).');
      });
  }

  // 티스토리 본문 컨테이너가 좁아 표가 눌리므로, 이 화면을 감싼 조상의 max-width 제한만 풀어 준다(이 페이지에서만 실행).
  function widen() {
    var p = root.parentElement;
    for (var i = 0; i < 8 && p && p !== document.body; i++, p = p.parentElement) {
      try {
        var cs = global.getComputedStyle(p);
        if (cs.maxWidth && cs.maxWidth !== 'none') p.style.maxWidth = 'none';
      } catch (e) { /* */ }
    }
    root.classList.add('at-wide');
  }

  function init() {
    root = document.getElementById(ROOT_ID);
    if (!root) return;
    // 티스토리 관리자(블로그 운영자) 로그인 상태에서만 화면을 연다. 방문자에게는 안내 한 줄만 보인다.
    var c = global.T && global.T.config;
    if (!(c && c.IS_LOGIN && c.ROLE && c.ROLE !== 'guest')) { root.innerHTML = '<p class="at-empty">블로그 관리자 로그인 후 이용할 수 있습니다.</p>'; return; }
    widen();
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden && getToken()) refresh(); }, REFRESH_MS);
  }

  global.AutoTraderPage = { init: init, analyze: analyze, widen: function (el) { root = el; widen(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
