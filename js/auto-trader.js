/* 자동매매(소유자 전용) 화면 - 감시 종목 손절·익절(매수 기능 없음).
 *
 * 이 화면은 이 PC에서 돌고 있는 로컬 봇(http://127.0.0.1:8765)만 읽는다. 사이트 서버(VM)·외부 서버로는 아무 것도 보내지 않는다.
 * 접속 토큰: 봇 폴더의 .token 파일 값을 한 번 붙여 넣으면 이 브라우저(localStorage)에만 저장된다.
 * 흐름: 차트검색에서 "자동매매 감시 추가" -> 증권앱에서 직접 매수 -> 봇이 감시 종목의 보유분을 손절·익절한다.
 * 조작: 정지/재개, 감시 종목 추가·해제. 주문 버튼·설정 변경은 화면에 없다(LIVE_SELL·손절 값은 PC의 .env/config.json).
 * 새 VM API·타이머 없음(15초 갱신은 이 PC 안에서만 일어난다).
 *
 * 2026-10-11 연구 기능 통합(quant-autotrade, 작업 브랜치): 로컬 봇 GET /api/research(연구 엔진 상태·연구 후보·모의매매)와 정적 백테스트 요약
 * (data/quant-backtest.js)을 같은 화면에 보여준다. 연구 후보·모의매매는 실주문과 무관하다(live_eligible=0). 값이 없으면 빈 상태·연결 대기 상태를
 * 그대로 표시하고 예시 값을 만들지 않는다. 백테스트·모의·실거래 성과는 합치지 않는다.
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
  var PAGES_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/';
  var backtest = { state: 'idle', data: null };   // idle -> loading -> ok | fail

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

  function fmtWon(v) { return v == null ? '-' : Math.round(v).toLocaleString('ko-KR'); }
  function signed(v) { return v == null ? '-' : (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(Math.round(v)).toLocaleString('ko-KR'); }

  /* 운영센터 레이아웃(docs/mockups/quant-console.html 시안). 봇이 실제로 아는 값만 채우고, 없는 값은 '-'·'준비 중'으로 둔다. */
  function topbarHtml(s, research) {
    var running = !s.stopped;
    return '<div class="at-top"><span class="at-brand">자동매매 운영센터</span>'
      + '<span class="at-chip2' + (s.live_sell ? ' is-live' : ' is-paper') + '">' + esc(s.mode) + '</span>'
      + '<span class="at-st"><i class="at-dot' + (running ? '' : ' is-off') + '"></i>엔진 <b>' + (running ? '실행 중' : '정지됨') + '</b></span>'
      + '<span class="at-st"><i class="at-dot' + (s.last_error ? ' is-wait' : '') + '"></i>로컬 봇 <b>연결</b></span>'
      + '<span class="at-st"><i class="at-dot ' + researchDot(research) + '"></i>연구 엔진 <b>' + esc(researchStateLabel(research)) + '</b></span>'
      + '<span class="at-st at-hide-m">마지막 폴링 <b>' + esc(s.last_poll || '-') + '</b></span>'
      + '<span class="at-st at-hide-m">' + (s.market_open ? '장 시간' : '장 마감/휴장') + '</span>'
      + '<span class="at-sp"></span>'
      + '<button type="button" class="at-btn ' + (running ? 'is-stop' : 'is-go') + '" data-toggle>' + (running ? '정지' : '재개') + '</button></div>'
      + (s.last_error ? '<p class="at-error">최근 오류: ' + esc(s.last_error) + '</p>' : '');
  }

  function kpiHtml(s, holdings) {
    var value = 0, cost = 0;
    holdings.forEach(function (h) { value += (h.price || 0) * (h.qty || 0); cost += (h.avg || 0) * (h.qty || 0); });
    var pnl = value - cost;
    var rate = cost > 0 ? pnl / cost * 100 : null;
    var managed = holdings.filter(function (h) { return h.watched; }).length;
    function cell(label, val, sub, cls) { return '<div><small>' + label + '</small><b' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</b><i>' + (sub || '') + '</i></div>'; }
    return '<section class="at-kpi">'
      + cell('보유 종목', holdings.length + '개', '자동 관리 ' + managed + '개')
      + cell('보유 평가금액', holdings.length ? fmtWon(value) : '-', 'KRW')
      + cell('평가손익', holdings.length ? signed(pnl) : '-', rate == null ? '' : pct(rate), holdings.length ? tone(pnl) : '')
      + cell('감시 종목', s.watch_count + '개', '손절·익절 대상')
      + cell('오늘 매도 주문', s.sells_today + ' / ' + s.max_sells_per_day, '일 한도')
      + cell('손절 기준', '-' + s.stop_loss_pct + '%', '매입가 대비')
      + cell('익절 기준', '+' + s.take_profit_floor_pct + '~' + s.take_profit_cap_pct + '%', '상한 즉시 · 하한 이탈')
      + '</section>';
  }

  function watchHtml(watch) {
    var rows = watch.length ? '<div class="at-chips">' + watch.map(function (w) {
      return '<span class="at-chip">' + esc(w.name || '') + ' <code>' + esc(w.code) + '</code><button type="button" data-unwatch="' + esc(w.code) + '" aria-label="' + esc(w.code) + ' 감시 해제">×</button></span>';
    }).join('') + '</div>' : '<p class="at-empty">감시 중인 종목이 없습니다. 차트검색 종목 상세의 "자동매매 감시 추가"로 올리거나 아래에 종목코드를 직접 입력하세요.</p>';
    return '<section class="at-box"><div class="at-hd"><h3>감시 종목</h3><span>여기 있는 종목의 보유분만 자동 손절·익절</span></div>' + rows
      + '<form class="at-token at-add" data-watch-form><input type="text" inputmode="numeric" maxlength="6" placeholder="종목코드 6자리" aria-label="종목코드" data-watch-code>'
      + '<input type="text" maxlength="20" placeholder="종목명(선택)" aria-label="종목명" data-watch-name><button type="submit">추가</button></form></section>';
  }

  function ruleHtml(s) {
    return '<section class="at-box"><div class="at-hd"><h3>신규 운용 정책</h3><span>실계좌 1개 준비 · 주문 비활성</span></div>'
      + '<div class="at-row"><span>운용 예산</span><b>100만원 · 최대 3종목 · 종목당 최대 30만원</b></div>'
      + '<div class="at-row"><span>현금 예비금</span><b>10만원 유지</b></div>'
      + '<div class="at-row"><span>중복 매수</span><b>같은 종목 보유·주문 대기 중 재매수 금지</b></div>'
      + '<div class="at-row"><span>후보 선별</span><b>거래대금·유동성·변동성·추세 데이터</b></div>'
      + '<div class="at-row"><span>손절 목표</span><b>매매 비용 고려 순손익 -5%</b></div>'
      + '<div class="at-row"><span>익절 목표</span><b>순손익 +3~6% (세부 매도 규칙 확정 대기)</b></div>'
      + '<p class="at-note">시뮬레이션 가정: 순수익 +3% 도달 후 +3% 아래로 되돌아가거나 +6% 도달 시 청산. 사용자 확정 전 실주문에 적용하지 않습니다. 청산 신호가 없으면 기간 제한 없이 보유합니다. 실제 손절은 급변·갭·체결 비용 때문에 -5%에 보장되지 않습니다.</p>'
      + '<p class="at-note">기존 ATR 장중·ATR 종가·3·5일선 전략은 비교용 독립 모의 기록입니다. 새 정책의 청산 신호로 합치지 않습니다.</p></section>'
      + '<section class="at-box"><div class="at-hd"><h3>기존 로컬 감시 규칙</h3><span>기록 전용 · 신규 정책과 별개</span></div>'
      + '<div class="at-row"><span>매수</span><b>수동 (자동 매수 없음)</b></div>'
      + '<div class="at-row"><span>매도 방식</span><b>시장가</b></div>'
      + '<div class="at-row"><span>손절</span><b>-' + esc(s.stop_loss_pct) + '%</b></div>'
      + '<div class="at-row"><span>익절</span><b>+' + esc(s.take_profit_floor_pct) + '% ~ +' + esc(s.take_profit_cap_pct) + '%</b></div>'
      + '<div class="at-row"><span>일 매도 한도</span><b>' + esc(s.sells_today) + ' / ' + esc(s.max_sells_per_day) + '건</b></div>'
      + '<p class="at-note">기존 설정값입니다. 저장소의 새 봇 코드는 주문 게이트가 닫혀 있습니다. 현재 PC 실행본 상태: ' + (s.live_sell ? '매도 주문 활성 표시 — 실행본을 확인하세요' : '기록 전용') + '. 새 정책의 실주문 연결은 없습니다.</p></section>';
  }

  // ---- 연구 기능 (2026-10-11) -------------------------------------------------------------------
  var SCANNER_LABEL = { maCloudBreakout: '이동평균 구름 돌파', doubleBottom: '쌍바닥', invHeadShoulders: '역헤드앤숄더', pullback: '눌림목',
    shortTermMaBreakout: '단기이평 돌파', BASELINE: '무작위 진입(대조군)' };
  var VARIANT_LABEL = { trail_atr: 'ATR 추적(장중·30일)', atr_close: 'ATR 추적(종가→다음 시가·150일)', dead35: '3·5일선 데드크로스(다음 시가·150일)' };
  var VARIANT_ORDER = ['trail_atr', 'atr_close', 'dead35'];
  var EXIT_REASON = { STOP_INTRADAY: '추적선 이탈(장중)', SIGNAL_ATR_CLOSE: '종가가 추적선 이탈', SIGNAL_DEAD35: '3·5일선 데드크로스', MAX_HOLD_30: '30일 도달', MAX_HOLD_150: '150일 도달' };
  var PAPER_STATUS = { OPEN: '진행 중', PENDING_EXIT: '청산 신호·체결 대기', CLOSED: '종료' };
  var RUNNER_LABEL = { starting: '시작 중', waiting: '스캔 대기', done: '후보 생성 완료', no_scan: '스캔 미확정', disk_limit: '용량 상한' };
  var CAND_STATUS = { NEW: '대기', PAPER_ENTERED: '모의 진입', SKIPPED: '건너뜀', EXPIRED: '만료' };
  var REASON_LABEL = { STALE_SCAN: '오래된 스캔(새 스캔 대기)', PARTIAL_SCAN: '처리 종목 수 부족', WAIT_STABLE: '결과 안정화 대기', MIXED_BAR_DATES: '봉 날짜 불일치',
    SCAN_BEFORE_CLOSE_DATA: '마감 데이터 이전 저장물', FETCH_ERROR: '서버 응답 오류', DISK_LIMIT: '용량 상한', ALREADY_DONE: '이미 생성됨', OK: '생성 완료',
    NO_SCANNED_AT: '스캔 시각 없음', BAD_SCANNED_AT: '스캔 시각 형식 오류', 'GAP>=2%': '갭 +2% 이상', STALE: '기간 경과', ENTRY_TOO_LATE: '진입 시점 경과' };

  function reasonLabel(code) {
    var key = String(code || '').replace(/\(.*$/, '');
    return REASON_LABEL[key] || String(code || '');
  }
  function scannerLabel(k) { return SCANNER_LABEL[k] || k || '-'; }
  function dtShort(v) { return v ? String(v).replace('T', ' ').slice(0, 16) : '-'; }
  function pct1(v) { return v == null ? '-' : (v > 0 ? '+' : '') + (Number(v) * 100).toFixed(1) + '%'; }
  function pct2(v) { return v == null ? '-' : (v > 0 ? '+' : '') + (Number(v) * 100).toFixed(2) + '%'; }
  function toneOf(v) { return v > 0 ? 'at-up' : v < 0 ? 'at-down' : ''; }
  function mb(bytes) { return bytes == null ? '-' : bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + ' GB' : (bytes / 1048576).toFixed(1) + ' MB'; }

  // research: null(연결 못함/구버전 봇) | {available:false} | {available:true,...}
  function researchStateLabel(r) {
    if (!r) return '연결 대기';
    if (!r.available) return '미실행';
    return RUNNER_LABEL[r.runner] || r.runner || '-';
  }
  function researchDot(r) {
    if (!r || !r.available) return 'is-wait';
    return r.runner === 'no_scan' || r.runner === 'disk_limit' || (r.errors && r.errors.length) ? 'is-wait' : '';
  }

  function engineHtml(r) {
    var head = '<section class="at-box"><div class="at-hd"><h3>연구 엔진</h3><span>후보 생성·모의매매 전용 · 실거래 연결 없음</span></div>';
    if (!r) {
      return head + '<p class="at-empty">연결 대기 — 로컬 봇이 연구 API(<code>/api/research</code>)를 아직 제공하지 않습니다. 봇을 재시작하면 연결됩니다.</p></section>';
    }
    if (!r.available) {
      return head + '<p class="at-empty">연구 작업이 아직 실행되지 않았습니다. 평일 20:15(KST)에 시작하며 첫 실행 뒤 이 영역에 상태가 나타납니다.</p></section>';
    }
    var last = r.lastGen || {};
    var rows = [
      ['상태', esc(researchStateLabel(r))],
      ['마지막 스캔 확정', esc(dtShort(r.lastScanConfirmedAt))],
      ['후보 데이터 기준일', esc(r.dataDate || '-')],
      ['마지막 확인', last.at ? esc(reasonLabel(last.reason)) + ' · ' + esc(dtShort(last.at)) : '-'],
      ['오늘 생성된 후보', esc(r.candidatesToday == null ? '-' : r.candidatesToday + '건')],
      ['마지막 정상 실행', esc(dtShort(r.lastSuccessAt))],
      ['다음 실행 예정', esc(dtShort(r.nextRunAt))],
      ['최근 생존 신호', esc(dtShort(r.heartbeatAt))]
    ];
    var html = head + rows.map(function (x) { return '<div class="at-row"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('');
    var miss = r.missingWeekdays || [];
    html += '<div class="at-row"><span>후보 없는 평일(최근 14일)</span><b>' + (miss.length ? esc(miss.length + '일') : '없음') + '</b></div>';
    if (miss.length) html += '<p class="at-note">' + esc(miss.join(', ')) + ' — 휴장일이거나 스캔이 확정되지 않은 날입니다.</p>';
    if (r.errors && r.errors.length) html += '<p class="at-error">최근 오류: ' + esc(r.errors[r.errors.length - 1]) + '</p>';
    if (r.diskUsedBytes != null && r.diskLimitBytes) {
      var ratio = Math.min(100, r.diskUsedBytes / r.diskLimitBytes * 100);
      html += '<div class="at-row"><span>연구 데이터 폴더</span><b>' + esc(mb(r.diskUsedBytes)) + ' / ' + esc(mb(r.diskLimitBytes)) + '</b></div>'
        + '<div class="at-gauge" role="img" aria-label="연구 데이터 폴더 사용률 ' + ratio.toFixed(1) + '%"><i style="width:' + Math.max(ratio, 0.5).toFixed(1) + '%"></i></div>'
        + '<p class="at-note">후보·모의매매 기록과 로그 용량입니다. 분봉·호가 수집기는 아직 만들지 않아 해당 사용량은 없습니다.</p>';
    }
    return html + '</section>';
  }

  // ---- C 장중 실시간 페이퍼 트레이딩(가상 체결) ----
  // r.livePaper: 로컬 봇이 research/livepaper.json 을 그대로 전달. 없으면 엔진 미실행. A 백테스트·B 일봉 사후 모의와 합산하지 않는다.
  var LIVE_STATUS = { OPEN: '보유', PENDING_EXIT: '청산 신호 대기', CLOSED: '청산' };
  var LIVE_REASON = { STOP_INTRADAY: '추적선 장중 이탈', SIGNAL_EXIT: '신호 후 다음 거래일 관측가', MAX_HOLD_30: '최대 30일 종가', MAX_HOLD_150: '최대 150일 종가',
    SIGNAL_ATR_CLOSE: '종가 추적선 이탈', SIGNAL_DEAD35: '3·5 데드크로스', STOP_BREACH_UNOBSERVED: '장중 이탈(미관측)', FIX_STOP: '−3% 손절', FIX_TARGET: '+5% 익절' };
  var LIVE_HALT = { LIVE_SELL_ACTIVE: '실주문 스위치 감지 — 엔진 중지', NOT_TRADING_DAY: '휴장일', CALENDAR_UNKNOWN: '거래일 달력 확인 불가 — 진입 보류' };

  function sparkline(points) {
    if (!points || points.length < 2) return '<span class="at-mute">자산곡선은 장 마감 후 쌓입니다</span>';
    var vals = points.map(function (p) { return p.equity; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var w = 160, h = 36, span = hi - lo || 1;
    var d = vals.map(function (v, i) { return (i * w / (vals.length - 1)).toFixed(1) + ',' + (h - 3 - (v - lo) / span * (h - 6)).toFixed(1); }).join(' ');
    return '<svg class="at-spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="가상 계좌 자산곡선"><polyline points="' + d + '" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  }

  function liveHtml(r) {
    var head = '<section class="at-box at-live"><div class="at-hd"><h3>C 장중 실시간 가상매매</h3><span>관측 시세 기준 가상 체결 · 실제 체결·주문 아님 · A·B와 합산하지 않음</span></div>';
    var L = r && r.livePaper;
    if (!L) return head + '<p class="at-empty">장중 모의매매 엔진(<code>live_paper_job</code>)이 아직 실행되지 않았습니다. 실행되면 거래일 09:00~15:30 사이 가상 매수·매도와 가상 계좌가 여기에 나타납니다.</p></section>';
    var halted = L.halted ? '<p class="at-error">' + esc(LIVE_HALT[L.halted] || L.halted) + '</p>' : '';
    var rows = [
      ['엔진 상태', esc(L.engine || '-') + (L.feedOk === false ? ' · <b class="at-down">시세 단절</b>' : '')],
      ['마지막 시세 수신', esc(dtShort(L.lastQuoteAt))],
      ['데이터 기준일 · 생성', esc(L.dataDate || '-') + ' · ' + esc(dtShort(L.generatedAt))],
      ['실주문', L.liveSellActive ? '<b class="at-down">LIVE_SELL 켜짐 — 엔진 중지</b>' : '차단됨(주문 API 호출 없음)'],
      ['시뮬레이션 종류', esc(L.simulationType || 'LIVE_PAPER')]
    ];
    var html = head + rows.map(function (x) { return '<div class="at-row"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('') + halted;
    var acc = L.accounts || {};
    var ids = VARIANT_ORDER.concat(Object.keys(acc).filter(function (k) { return VARIANT_ORDER.indexOf(k) < 0; }));
    html += '<div class="at-table-wrap"><table class="at-table"><thead><tr><th>청산 전략(독립 계좌)</th><th class="n">초기자금</th><th class="n">평가자산</th><th class="n">예수금</th><th class="n">투자금</th>'
      + '<th class="n">평가손익</th><th class="n">실현손익</th><th class="n">누적수익률</th><th class="n">MDD</th><th class="n">청산·승률·PF</th><th>자산곡선</th></tr></thead><tbody>'
      + ids.map(function (k) {
        var a = acc[k]; if (!a) return '';
        var curve = (L.equityCurves || {})[k];
        return '<tr><td>' + esc(VARIANT_LABEL[k] || k) + '</td><td class="n">' + fmtWon(a.initialCash) + '</td><td class="n">' + fmtWon(a.equity) + '</td><td class="n">' + fmtWon(a.cash) + '</td>'
          + '<td class="n">' + fmtWon(a.invested) + '</td><td class="n ' + toneOf(a.unrealizedPnl) + '">' + signed(a.unrealizedPnl) + '</td><td class="n ' + toneOf(a.realizedPnl) + '">' + signed(a.realizedPnl) + '</td>'
          + '<td class="n ' + toneOf(a.cumRet) + '">' + esc(pct2(a.cumRet)) + '</td><td class="n at-down">' + esc(pct2(a.mdd)) + '</td>'
          + '<td class="n">' + esc(a.closed || 0) + '건' + (a.win == null ? '' : ' · ' + esc((a.win * 100).toFixed(0)) + '%') + (a.pf == null ? '' : ' · ' + esc(a.pf.toFixed(2))) + '</td>'
          + '<td class="' + toneOf(a.cumRet) + '">' + sparkline(curve) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    var pos = L.positions || [];
    html += '<h4 class="at-sub">가상 보유 종목</h4>';
    html += pos.length ? '<div class="at-table-wrap"><table class="at-table at-wide"><thead><tr><th>종목</th><th>검색기</th><th>청산 전략</th><th class="n">매수가(가상)</th><th class="n">현재가</th><th class="n">수익률</th><th class="n">보유일</th><th class="n">청산 기준</th><th>상태</th></tr></thead><tbody>'
      + pos.map(function (p) {
        var basis = p.trailPrice ? '추적선 ' + fmtPrice(p.trailPrice) : (p.stopPrice ? '손절 ' + fmtPrice(p.stopPrice) : '<span class="at-mute">가격선 없음(신호)</span>');
        return '<tr><td>' + esc(p.name || '') + ' <code>' + esc(p.code) + '</code></td><td>' + esc(scannerLabel(p.scanner)) + '</td><td>' + esc(VARIANT_LABEL[p.strategyId] || p.strategyId) + '</td>'
          + '<td class="n">' + fmtPrice(p.entryPrice) + '</td><td class="n">' + fmtPrice(p.lastPrice) + '</td><td class="n ' + toneOf(p.ret) + '">' + (p.ret == null ? '-' : esc(pct2(p.ret))) + '</td>'
          + '<td class="n">' + esc(p.holdDays || 0) + '/' + esc(p.maxHold || '-') + '</td><td class="n">' + basis + '</td>'
          + '<td>' + esc(LIVE_STATUS[p.status] || p.status) + (p.signalReason ? ' <small class="at-mute">' + esc(LIVE_REASON[p.signalReason] || p.signalReason) + '</small>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="at-empty">가상 보유 종목이 없습니다.</p>';
    var tr = L.trades || [];
    html += '<h4 class="at-sub">가상 거래 내역</h4>';
    html += tr.length ? '<div class="at-table-wrap"><table class="at-table at-wide"><thead><tr><th>종목</th><th>청산 전략</th><th>매수(가상)</th><th>매도(가상)</th><th>사유</th><th class="n">순수익</th><th class="n">손익(원)</th><th>체결 품질</th></tr></thead><tbody>'
      + tr.map(function (x) {
        return '<tr><td>' + esc(x.name || '') + ' <code>' + esc(x.code) + '</code></td><td>' + esc(VARIANT_LABEL[x.strategyId] || x.strategyId) + '</td>'
          + '<td>' + esc(dtShort(x.entryTs)) + ' @ ' + fmtPrice(x.entryPrice) + '</td><td>' + esc(dtShort(x.exitTs)) + ' @ ' + fmtPrice(x.exitPrice) + '</td>'
          + '<td>' + esc(LIVE_REASON[x.exitReason] || x.exitReason) + '</td><td class="n ' + toneOf(x.netRet) + '">' + esc(pct2(x.netRet)) + '</td><td class="n ' + toneOf(x.pnl) + '">' + signed(x.pnl) + '</td>'
          + '<td><small class="at-mute">' + esc(x.quality === 'CONFIRMED_CLOSE' ? '확정 종가' : '관측가 기준') + '</small></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="at-empty">아직 청산된 가상 거래가 없습니다.</p>';
    var sel = L.selection || [];
    if (sel.length) {
      var picked = sel.filter(function (s) { return s.decision === 'SELECTED'; }).length;
      html += '<p class="at-note">최근 스캔 후보 ' + esc(sel.length) + '건 중 선정 ' + esc(picked) + '건, 제외 ' + esc(sel.length - picked) + '건(중복 신호·감시 상한). 검색기마다 점수 체계가 달라 점수를 섞어 정렬하지 않고 검색기 안의 순위로 번갈아 배치합니다.</p>';
    }
    html += '<p class="at-note">가격은 키움 1분봉 종가(마지막 관측가)이며 호가는 쓰지 않습니다. 진입은 09:00 이후 처음 관측한 신선한 시세(09:30까지)에 슬리피지 ' + esc(L.assumptions ? (L.assumptions.entrySlip * 100).toFixed(1) : '0.2') + '%를 더해 가상 매수하고, 시세가 없으면 미체결로 남깁니다. 시세 단절 구간은 채우지 않습니다. KOSPI 대비 성과는 장중 지수 수집이 아직 연결되지 않아 표시하지 않습니다.</p></section>';
    return html;
  }

  function paperOverviewHtml(r) {
    var accounts = r && r.livePaper && r.livePaper.accounts;
    var head = '<section class="at-box at-paper-overview"><div class="at-hd"><h3>장중 가상계좌 합산 성과</h3><span>3개 독립 계좌 합산 · 실제 주문·체결 아님</span></div>';
    if (!accounts) return head + '<p class="at-empty">장중 가상계좌 기록이 아직 없습니다.</p></section>';
    var keys = Object.keys(accounts).filter(function (k) { return accounts[k] && accounts[k].initialCash != null && accounts[k].equity != null; });
    if (!keys.length) return head + '<p class="at-empty">평가 가능한 가상계좌 기록이 없습니다.</p></section>';
    var total = { initialCash: 0, equity: 0, realizedPnl: 0, unrealizedPnl: 0 };
    keys.forEach(function (k) { var a = accounts[k]; total.initialCash += Number(a.initialCash); total.equity += Number(a.equity); total.realizedPnl += Number(a.realizedPnl || 0); total.unrealizedPnl += Number(a.unrealizedPnl || 0); });
    var pnl = total.equity - total.initialCash, rate = total.initialCash ? pnl / total.initialCash : null;
    function card(label, value, cls) { return '<div><small>' + label + '</small><b class="' + (cls || '') + '">' + value + '</b></div>'; }
    return head + '<div class="at-summary-grid">'
      + card('합산 초기자금', fmtWon(total.initialCash) + '원') + card('합산 총평가잔고', fmtWon(total.equity) + '원')
      + card('누적 평가손익', signed(pnl) + '원', toneOf(pnl)) + card('누적 평가수익률', esc(pct2(rate)), toneOf(rate))
      + card('실현손익', signed(total.realizedPnl) + '원', toneOf(total.realizedPnl)) + card('미실현손익', signed(total.unrealizedPnl) + '원', toneOf(total.unrealizedPnl))
      + '</div><p class="at-note">평가손익·수익률은 각 계좌의 평가잔고와 초기자금으로 계산합니다. 실현·미실현손익은 별도 항목이며 평가손익에 다시 더하지 않습니다. 현재 기록된 ' + keys.length + '개 계좌 기준입니다.</p></section>';
  }

  function journalHtml(r) {
    var head = '<section class="at-box at-journal"><div class="at-hd"><h3>통합 시간순 거래 일지</h3><span>전략별 가상 거래 · 최신 활동순</span></div>';
    function balance(v) { return v == null ? '기록 없음' : fmtWon(v) + '원'; }
    var rows = [], live = r && r.livePaper;
    var selection = {};
    (live && live.selection || []).forEach(function (s) { selection[[s.scanDate, s.scanner, s.code].join('|')] = s; });
    function addLive(x, closed) {
      var selected = selection[[x.scanDate, x.scanner, x.code].join('|')];
      var basis = scannerLabel(x.scanner) + ' 신호' + (selected && /^RANK_\d+_OF_/.test(selected.reason || '') ? ' · 검색기 내 ' + selected.reason.split('_')[1] + '순위' : '');
      rows.push({ when: closed ? x.exitTs : x.entryTs, groupKey: ['C', x.code, x.entryTs].join('|'), name: x.name, code: x.code, entryTs: x.entryTs, html: '<article class="at-journal-item"><div class="at-journal-head"><time>' + esc(dtShort(closed ? x.exitTs : x.entryTs)) + '</time><b>' + esc(x.name || '') + ' <code>' + esc(x.code) + '</code></b><span>' + esc(VARIANT_LABEL[x.strategyId] || x.strategyId) + ' · 장중 가상매매</span></div>'
        + '<div class="at-journal-flow"><div><small>매수 시각 · 가격 · 수량</small><b>' + esc(dtShort(x.entryTs)) + ' · ' + fmtPrice(x.entryPrice) + '원 · ' + esc(x.qty == null ? '수량 미기록' : x.qty + '주') + '</b></div><div><small>매도 시각 · 가격 · 수량</small><b>' + (closed ? esc(dtShort(x.exitTs)) + ' · ' + fmtPrice(x.exitPrice) + '원 · ' + esc(x.qty == null ? '수량 미기록' : x.qty + '주') : '미매도') + '</b></div><div><small>수익률</small><b class="' + toneOf(closed ? x.netRet : x.ret) + '">' + esc(pct2(closed ? x.netRet : x.ret)) + '</b></div><div><small>전략 예수금</small><b>매수 후 ' + balance(x.balanceAfterBuy) + (closed ? ' · 매도 후 ' + balance(x.balanceAfterSell) : '') + '</b></div></div>'
        + '<p><b>매수 근거</b> ' + esc(basis) + '</p><p><b>매도 상태·사유</b> ' + (closed ? esc(LIVE_REASON[x.exitReason] || x.exitReason || '사유 미기록') : x.status === 'PENDING_EXIT' ? '청산 신호 · 다음 관측가 대기 (' + esc(LIVE_REASON[x.signalReason] || x.signalReason || '-') + ')' : '보유 중 · 청산 조건 미충족') + '</p></article>' });
    }
    (live && live.positions || []).forEach(function (x) { addLive(x, false); });
    (live && live.trades || []).forEach(function (x) { addLive(x, true); });
    (r && r.paperTrades || []).filter(function (x) { return x.entryDate; }).forEach(function (x) {
      var closed = x.status === 'CLOSED', when = closed ? x.exitDate : x.entryDate;
      rows.push({ when: when, html: '<article class="at-journal-item"><div class="at-journal-head"><time>' + esc(when || '-') + '</time><b>' + esc(x.name || '') + ' <code>' + esc(x.code) + '</code></b><span>' + esc(VARIANT_LABEL[x.variant] || x.variant) + ' · 일봉 사후 모의</span></div>'
        + '<div class="at-journal-flow"><div><small>매수일 · 가격 · 수량</small><b>' + esc(x.entryDate) + ' (시각 미기록) · ' + fmtPrice(x.entryPrice) + '원 · ' + esc(x.qty == null ? '수량 미기록' : x.qty + '주') + '</b></div><div><small>매도일 · 가격 · 수량</small><b>' + (closed ? esc(x.exitDate) + ' (시각 미기록) · ' + fmtPrice(x.exitPrice) + '원 · ' + esc(x.qty == null ? '수량 미기록' : x.qty + '주') : '미매도') + '</b></div><div><small>수익률</small><b class="' + toneOf(x.ret) + '">' + (closed ? esc(pct2(x.ret)) : '미확정') + '</b></div><div><small>거래 직후 잔고</small><b>기록 없음</b></div></div>'
        + '<p><b>매수 근거</b> ' + esc(scannerLabel(x.scanner)) + ' 신호</p><p><b>매도 상태·사유</b> ' + (closed ? esc(EXIT_REASON[x.exitReason] || x.exitReason || '사유 미기록') : x.status === 'PENDING_EXIT' ? '청산 신호 · 다음 거래일 시가 대기' : '보유 중 · 청산 조건 미충족') + '</p></article>' });
    });
    rows.sort(function (a, b) { return String(b.when || '').localeCompare(String(a.when || '')); });
    var groups = {};
    rows.forEach(function (x) { if (x.groupKey) (groups[x.groupKey] || (groups[x.groupKey] = [])).push(x); });
    var shown = {};
    return head + (rows.length ? rows.map(function (x) {
      if (!x.groupKey || groups[x.groupKey].length < 2) return x.html;
      if (shown[x.groupKey]) return '';
      shown[x.groupKey] = true;
      var members = groups[x.groupKey];
      return '<details class="at-journal-group"><summary><b>' + esc(x.name || '') + ' <code>' + esc(x.code) + '</code></b> · 매수 ' + esc(dtShort(x.entryTs)) + ' · ' + members.length + '개 전략 비교</summary>' + members.map(function (m) { return m.html; }).join('') + '</details>';
    }).join('') : '<p class="at-empty">아직 매수된 가상 거래가 없습니다.</p>')
      + '<p class="at-note">장중 가상매매와 일봉 사후 모의를 시간순으로 보여 줍니다. 두 성과는 합산하지 않습니다. 장중 과거 매도 내역의 예수금은 기록에 순수령액이 없으면 표시하지 않습니다. 실계좌 주문·체결 내역은 아래 별도 기록을 확인하세요.</p></section>';
  }

  function candidatesHtml(r) {
    var head = '<section class="at-box"><div class="at-hd"><h3>연구 후보</h3><span>스캔 확정 후에만 생성 · 연구용(실주문 없음)</span></div>';
    if (!r || !r.available) return head + '<p class="at-empty">연구 엔진이 연결되면 장 마감 스캔에서 확정된 후보가 여기에 나타납니다.</p></section>';
    var list = r.recentCandidates || [];
    if (!list.length) return head + '<p class="at-empty">아직 생성된 연구 후보가 없습니다. 후보가 0건인 날도 정상일 수 있습니다.</p></section>';
    return head + '<div class="at-table-wrap"><table class="at-table"><thead><tr><th>스캔일</th><th>종목</th><th>검색기</th><th class="n">점수</th><th class="n">기준가</th><th>상태</th></tr></thead><tbody>'
      + list.map(function (c) {
        var st = CAND_STATUS[c.status] || c.status;
        var why = c.reason ? ' · ' + reasonLabel(c.reason) : '';
        return '<tr><td>' + esc(c.scanDate) + '</td><td>' + esc(c.name || '') + ' <code>' + esc(c.code) + '</code></td><td>' + esc(scannerLabel(c.scanner)) + '</td>'
          + '<td class="n">' + (c.score == null ? '-' : esc(Number(c.score).toFixed(0))) + '</td><td class="n">' + fmtPrice(c.basePrice) + '</td>'
          + '<td><span class="at-tag at-tag--' + esc(String(c.status || '').toLowerCase()) + '">' + esc(st) + '</span>' + esc(why) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      + '<p class="at-note">기준가는 스캔 시점 종가입니다. 전략 검증을 통과한 검색기가 없어 모든 후보는 연구용이며 실제 주문으로 이어지지 않습니다.</p></section>';
  }

  // MDD: 종가로 미실현 손익을 평가한 자산곡선 기준. 평가 종가가 빠진 날이 있으면 정확한 값처럼 보이지 않게 '≈'와 안내를 붙인다.
  function mddCell(v) {
    if (v.mdd != null) return esc(pct2(v.mdd));
    if (v.mddApprox != null) return '<span class="at-mute" title="평가 종가 일부 없음">≈ ' + esc(pct2(v.mddApprox)) + ' (참고)</span>';
    return '-';
  }
  function sameDayCell(v) {
    var d = v.sameDay;
    if (!d || d.cumRet == null) return '<span class="at-mute">-</span>';
    return '<span class="' + toneOf(d.cumRet) + '">' + esc(pct2(d.cumRet)) + '</span> / ' + (d.mdd != null ? esc(pct2(d.mdd)) : '≈') + (d.reuseBuys ? ' <small class="at-mute">(재투입 ' + esc(d.reuseBuys) + '건)</small>' : '');
  }

  function paperHtml(r) {
    var head = '<section class="at-box"><div class="at-hd"><h3>B 일봉 사후 모의매매</h3><span>확정 일봉으로 다음 시가 체결을 가정 · 실제 주문 아님 · 청산 전략별 독립 계좌 · A·C와 합산하지 않음</span></div>';
    if (!r || !r.available) return head + '<p class="at-empty">연구 엔진이 연결되면 연구 후보의 가상 진입·청산 기록이 쌓입니다.</p></section>';
    var pv = r.paperVariants || null;
    var summary = '';
    if (pv) {
      summary = '<div class="at-table-wrap"><table class="at-table"><thead><tr><th>청산 전략(독립 계좌)</th><th>최대 보유</th><th class="n">종료</th><th class="n">미확정</th><th class="n">평균 수익</th><th class="n">승률</th><th class="n">PF</th><th class="n">누적(평가)</th><th class="n">MDD</th><th class="n">당일 재투입 시나리오</th></tr></thead><tbody>'
        + VARIANT_ORDER.map(function (k) {
          var v = pv[k]; if (!v) return '';
          return '<tr><td>' + esc(VARIANT_LABEL[k] || k) + '</td><td>' + esc(v.maxHold) + '일</td><td class="n">' + esc(v.closed || 0) + '</td>'
            + '<td class="n">' + esc(v.unsettled || 0) + (v.pendingExit ? ' <small class="at-mute">(신호 대기 ' + esc(v.pendingExit) + ')</small>' : '') + '</td>'
            + '<td class="n ' + toneOf(v.avg) + '">' + (v.avg == null ? '-' : esc(pct2(v.avg))) + '</td><td class="n">' + (v.win == null ? '-' : esc((v.win * 100).toFixed(0)) + '%') + '</td>'
            + '<td class="n">' + (v.pf == null ? '-' : esc(v.pf.toFixed(2))) + '</td><td class="n ' + toneOf(v.cumRet) + '">' + (v.cumRet == null ? '-' : esc(pct2(v.cumRet))) + '</td>'
            + '<td class="n at-down">' + mddCell(v) + '</td>' + '<td class="n">' + sameDayCell(v) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        + '<p class="at-note">전략마다 같은 후보·같은 진입에 자금 규칙(동시 5종목·종목당 10%·투자 30%)을 따로 적용한 계좌이며 세 전략을 합산하지 않습니다. 누적·MDD는 날짜순 자산곡선(현금 + 종가 평가한 미청산 포지션, 청산 신호 대기 포지션은 한도 점유)으로 계산합니다. 기본 값은 청산 대금을 다음 거래일부터 쓰는 보수적 가정이고, 당일 재투입 시나리오는 시가에 못 산 후보를 같은 날 종가에 매수하는 경우(매도가 종가보다 확실히 앞선 대금만 사용)를 따로 보여 줍니다.</p>';
    }
    var list = r.paperTrades || [];
    if (!list.length) return head + summary + '<p class="at-empty">아직 모의 진입 기록이 없습니다. 후보가 생성된 다음 거래일 일봉이 확인되면 기록됩니다.</p></section>';
    return head + summary + '<div class="at-table-wrap"><table class="at-table at-wide"><thead><tr><th>스캔일</th><th>종목</th><th>청산 전략</th><th>진입(가정)</th><th class="n">손절선→현재선</th><th>신호일</th><th>청산(체결)</th><th>사유</th><th class="n">순수익</th><th>상태</th></tr></thead><tbody>'
      + list.map(function (x) {
        var line = x.stopPrice == null ? '<span class="at-mute">가격 손절선 없음</span>' : fmtPrice(x.stopPrice) + ' → ' + fmtPrice(x.trailPrice);
        var exit = x.status === 'CLOSED' ? esc(x.exitDate) + ' @ ' + fmtPrice(x.exitPrice) + (x.holdDays ? ' <small class="at-mute">' + esc(x.holdDays) + '일 보유</small>' : '')
          : '<span class="at-mute">' + (x.status === 'PENDING_EXIT' ? '다음 거래일 시가 대기' : '미확정') + '</span>';
        return '<tr><td>' + esc(x.scanDate) + '</td><td>' + esc(x.name || '') + ' <code>' + esc(x.code) + '</code></td><td>' + esc(VARIANT_LABEL[x.variant] || x.variant) + '</td>'
          + '<td>' + (x.entryDate ? esc(x.entryDate) + ' @ ' + fmtPrice(x.entryPrice) : '<span class="at-mute">진입 대기</span>') + '</td><td class="n">' + line + '</td>'
          + '<td>' + esc(x.signalDate || '-') + '</td><td>' + exit + '</td><td>' + esc(EXIT_REASON[x.exitReason] || x.exitReason || (x.note ? x.note : '-')) + '</td>'
          + '<td class="n ' + toneOf(x.ret) + '">' + (x.ret == null ? '-' : esc(pct2(x.ret))) + '</td><td>' + esc(PAPER_STATUS[x.status] || x.status) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      + '<p class="at-note">진입가는 다음 거래일 시가 + 0.2%(갭 +2% 이상은 건너뜀). 종가로 청산 신호가 난 포지션은 다음 거래일 시가 봉이 확인되기 전까지 가격·수익률을 확정하지 않습니다. 순수익에는 왕복 비용·슬리피지가 반영됩니다.</p></section>';
  }

  function ensureBacktest() {
    if (backtest.state !== 'idle') return;
    if (global.QUANT_BACKTEST) { backtest = { state: 'ok', data: global.QUANT_BACKTEST }; return; }
    backtest.state = 'loading';
    var el = global.document.createElement('script');
    el.src = PAGES_BASE + 'data/quant-backtest.js?v=' + new Date().toISOString().slice(0, 10);
    el.async = true;
    el.onload = function () { backtest = global.QUANT_BACKTEST ? { state: 'ok', data: global.QUANT_BACKTEST } : { state: 'fail', data: null }; refreshSoft(); };
    el.onerror = function () { backtest = { state: 'fail', data: null }; refreshSoft(); };
    global.document.head.appendChild(el);
  }

  function backtestRow(r, showExit) {
    return '<tr><td>' + esc(r.scannerLabel) + (showExit ? ' <small class="at-mute">' + esc(r.exitLabel) + '</small>' : '') + '</td>'
      + '<td class="n ' + toneOf(r.ret) + '">' + esc(pct1(r.ret)) + '</td><td class="n ' + toneOf(r.cagr) + '">' + esc(pct1(r.cagr)) + '</td>'
      + '<td class="n at-down">' + esc(pct1(r.mdd)) + '</td><td class="n">' + esc(r.trades) + '</td><td class="n">' + (r.win == null ? '-' : esc((r.win * 100).toFixed(0)) + '%') + '</td>'
      + '<td class="n">' + (r.pf == null ? '-' : esc(r.pf.toFixed(2))) + '</td><td class="n">' + esc(pct1(r.devRet)) + ' / ' + esc(pct1(r.valRet)) + '</td></tr>';
  }

  function backtestHtml() {
    var head = '<section class="at-box"><div class="at-hd"><h3>A 검색기별 백테스트 성과</h3><span>과거 데이터 시뮬레이션 · B·C 모의매매·실거래 성과 아님</span></div>';
    if (backtest.state === 'loading' || backtest.state === 'idle') return head + '<p class="at-empty">백테스트 요약을 불러오는 중입니다.</p></section>';
    if (backtest.state === 'fail' || !backtest.data) return head + '<p class="at-empty">백테스트 요약을 불러오지 못했습니다(<code>data/quant-backtest.js</code>가 아직 배포되지 않았거나 네트워크 오류).</p></section>';
    var d = backtest.data, rows = d.rows || [];
    var by = {};
    rows.forEach(function (r) { if (r.exit !== 'fix3_5' && (!by[r.scanner] || r.ret > by[r.scanner].ret)) by[r.scanner] = r; });
    var best = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.ret - a.ret; });
    var cur = rows.filter(function (r) { return r.exit === 'fix3_5'; }).sort(function (a, b) { return b.ret - a.ret; });
    var k = d.benchmark && d.benchmark.KOSPI;
    var thead = '<thead><tr><th>검색기</th><th class="n">누적</th><th class="n">연환산</th><th class="n">MDD</th><th class="n">거래</th><th class="n">승률</th><th class="n">PF</th><th class="n">개발/검증 구간</th></tr></thead>';
    return head
      + '<p class="at-verdict">' + esc(d.verdict || '') + '</p>'
      + '<div class="at-table-wrap"><table class="at-table">' + thead + '<tbody>'
      + '<tr class="at-grp"><td colspan="8">검색기별 최고 청산 방식 (누적 수익률 순)</td></tr>' + best.map(function (r) { return backtestRow(r, true); }).join('')
      + '<tr class="at-grp"><td colspan="8">현행 규칙 — 손절 −3% / 익절 +5%</td></tr>' + cur.map(function (r) { return backtestRow(r, false); }).join('')
      + '</tbody></table></div>'
      + '<p class="at-note">기간 ' + esc((d.period || []).join(' ~ ')) + ' · 동시 ' + esc((d.config || {}).maxPositions) + '종목, 종목당 ' + esc(((d.config || {}).perPosition * 100).toFixed(0)) + '%, 투자 상한 '
      + esc(((d.config || {}).totalExposure * 100).toFixed(0)) + '% · ' + esc((d.config || {}).cost || '') + ' · ' + esc((d.config || {}).universe || '')
      + (k ? ' · 같은 기간 KOSPI ' + esc(pct1(k.ret)) + '(MDD ' + esc(pct1(k.mdd)) + ')' : '') + '</p>'
      + '<ul class="at-caveats">' + (d.caveats || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></section>';
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
    return '<section class="at-box"><div class="at-hd"><h3>이벤트 로그</h3>' + select + '</div>' + body + '</section>';
  }

  function render(d) {
    ensureBacktest();
    root.innerHTML = topbarHtml(d.status, d.research) + paperOverviewHtml(d.research) + kpiHtml(d.status, d.holdings)
      + '<div class="at-grid"><div class="at-col">'
      + '<section class="at-box"><div class="at-hd"><h3>보유 종목</h3><span>키움 잔고 기준 · 30초마다 갱신 · 수동 보유 종목은 건드리지 않음</span></div>' + holdingsHtml(d.holdings) + '</section>'
      + journalHtml(d.research) + candidatesHtml(d.research) + liveHtml(d.research) + paperHtml(d.research) + backtestHtml()
      + '<section class="at-box"><div class="at-hd"><h3>매도 주문 기록</h3><span>접수·체결은 별도 확인</span></div>' + ordersHtml(d.orders) + '</section>'
      + eventsHtml(d.events)
      + '</div><div class="at-col">' + watchHtml(d.watch) + engineHtml(d.research) + ruleHtml(d.status) + '</div></div>';
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

  var lastData = null;
  function refreshSoft() { if (lastData && root) render(lastData); }   // 백테스트 요약이 늦게 도착했을 때 마지막 데이터로 다시 그린다

  function refresh() {
    if (!root) return;
    if (!getToken()) { shellDisconnected('아직 접속 토큰이 없습니다.'); return; }
    // /api/research 는 구버전 봇(404)이나 연구 작업 미실행 상태에서도 화면 전체를 막지 않는다 -> null 이면 '연결 대기' 상태로 표시.
    var research = api('/api/research').catch(function (error) {
      if (error && error.message === 'token') throw error;
      return null;
    });
    Promise.all([api('/api/status'), api('/api/watch'), api('/api/holdings'), api('/api/orders?limit=50'),
      api('/api/events?limit=200' + (typeFilter ? '&type=' + encodeURIComponent(typeFilter) : '')), research])
      .then(function (out) {
        lastData = { status: out[0], watch: out[1].watch || [], holdings: out[2].holdings || [], orders: out[3].orders || [], events: out[4].events || [], research: out[5] };
        render(lastData);
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
