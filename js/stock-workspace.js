/**
 * 종목 작업 화면 (2026-11-12).
 *
 * /page/stock-search(js/stock-search.js)의 기존 셸을 [호가 | 차트] 작업 화면으로 꾸민다(종목정보는 머리말 버튼으로 여는 서랍).
 * 새 화면을 따로 만들지 않는 이유: 호가(js/order-book.js)·차트(js/chart-core.js 계열)·관련 뉴스·실시간 소켓이
 * 이미 이 페이지 한 곳에 묶여 있고(소켓 1개), 종목 URL 계약(?code=&name=)도 여기에 있다. 이 파일은 그 위에
 *   - 종목 머리말(기존 #ssSummary에 시장·자료 기준시각 보강)
 *   - 종목정보(수급 / 공시·뉴스 / 기업정보) - 기존 제공 자료만 사용. 버튼으로 여닫는 비모달 오른쪽 열(넓은 PC)·떠 있는 패널(좁은 PC)
 *   - 호가 패널 시가·고가·저가 아래 전일 대비·거래량
 *   - 검색 옆 관심·최근 서랍(헤더 검색과 같은 저장소 stock:recent·관심종목 목록 재사용)
 *   - 첫 종목 결정(URL → 마지막 선택 → 관심종목 첫 항목), 종목 변경 시 주소 기록(뒤로가기)
 *   - 좁은 화면 전환(종목정보 서랍, 모바일 차트/호가/종목정보 탭)
 * 만 더한다. 호가·차트·뉴스 노드는 옮기기만 하고 다시 만들지 않으므로 구독·타이머·요청이 늘지 않는다.
 * 주문 기능은 없다. 미국 종목·지수 화면과 독립 차트(?tool=independent-chart)는 기존 화면 그대로 둔다.
 */
(function (global) {
  'use strict';
  if (global.StockWorkspace) return;
  var doc = global.document;
  var root = doc.querySelector('#stock-search');
  if (!root || root.classList.contains('ss-independent-chart')) return;

  var BASE = (function () {
    var src = doc.currentScript && doc.currentScript.src;
    var m = src && src.match(/^(.*\/)js\/stock-workspace\.js/);
    return m ? m[1] : 'https://goodbyestarwars.github.io/tistory-ticker/';
  }());
  var CSS_URL = BASE + 'css/stock-workspace.css?v=20261113-info-dock';
  var PROFILES_URL = BASE + 'data/company-profiles.js';
  var API = 'https://goodbyestar.cloud';
  var FLOW_TTL_MS = 5 * 60 * 1000; // 서버 캐시와 같은 5분
  var TABS = [['flow', '수급'], ['news', '공시·뉴스'], ['company', '기업정보']];
  var PANELS = [['chart', '차트'], ['book', '호가'], ['info', '종목정보']];

  var state = { code: '', name: '', tab: 'flow', panel: 'chart', session: null, quote: null, flowToken: 0, flowData: null, flowPeriod: 'today', profiles: null };
  var el = {};

  function esc(value) { return global.NineUI.escapeHtml(value); }
  function panelApi() { return global.StockSearchPanel || null; }
  function isDomestic(code) { return /^[0-9A-Z]{6}$/.test(String(code || '')); }
  function urlCode() { try { return (new URLSearchParams(global.location.search).get('code') || '').trim(); } catch (e) { return ''; } }
  function isUsUrl() { try { var p = new URLSearchParams(global.location.search); return p.get('market') === 'us' || /^US:/i.test(p.get('code') || ''); } catch (e) { return false; } }
  function num(value) { var n = Number(value); return value == null || value === '' || !isFinite(n) ? null : n; }
  function fmt(value) { var n = num(value); return n == null ? '—' : Math.round(n).toLocaleString('ko-KR'); }
  function signed(value) { var n = num(value); return n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR'); }
  function tone(value) { var n = num(value); return n == null || n === 0 ? '' : n > 0 ? ' up' : ' down'; }

  /* ───── 뼈대: 기존 노드는 옮기기만 한다 ───── */
  function build() {
    var panels = root.querySelector('.ss-panels');
    var detail = root.querySelector('#ssDetail');
    var summary = root.querySelector('#ssSummary');
    var search = root.querySelector('.ss-search');
    var news = root.querySelector('.ss-news-panel');
    if (!panels || !detail || !summary || !search) return false;

    // 머리말: 기존 요약 줄(#ssSummary - 종목명·코드·현재가·등락, 체결마다 stock-search.js가 갱신)을 3열 위로 올린다.
    detail.parentNode.insertBefore(summary, detail);

    // 검색 옆 관심·최근 서랍
    var drawerBtn = doc.createElement('button');
    drawerBtn.type = 'button';
    drawerBtn.className = 'ssw-drawer-btn';
    drawerBtn.setAttribute('aria-expanded', 'false');
    drawerBtn.setAttribute('aria-controls', 'sswDrawer');
    drawerBtn.textContent = '관심·최근';
    var drawer = doc.createElement('div');
    drawer.id = 'sswDrawer';
    drawer.className = 'ssw-drawer';
    drawer.hidden = true;
    search.appendChild(drawerBtn);
    search.appendChild(drawer);
    el.drawerBtn = drawerBtn; el.drawer = drawer;

    // 모바일 패널 전환(차트/호가/종목정보)
    var mtabs = doc.createElement('div');
    mtabs.className = 'ssw-mtabs';
    mtabs.setAttribute('role', 'tablist');
    mtabs.setAttribute('aria-label', '종목 화면 전환');
    mtabs.setAttribute('data-no-swipe', '');
    mtabs.innerHTML = PANELS.map(function (p) {
      return '<button type="button" role="tab" data-ssw-panel-btn="' + p[0] + '" aria-selected="' + (p[0] === state.panel) + '">' + p[1] + '</button>';
    }).join('');
    detail.insertBefore(mtabs, panels);
    el.mtabs = mtabs;

    // 오른쪽 종목정보
    var info = doc.createElement('aside');
    info.className = 'ssw-info';
    info.id = 'sswInfo';
    info.setAttribute('aria-label', '종목정보');
    info.innerHTML = '<div class="ssw-info-head"><div class="ssw-tabs" role="tablist" aria-label="종목정보">' + TABS.map(function (t) {
      return '<button type="button" role="tab" id="sswTab-' + t[0] + '" data-ssw-tab="' + t[0] + '" aria-controls="sswPane-' + t[0] + '" aria-selected="' + (t[0] === state.tab) + '">' + t[1] + '</button>';
    }).join('') + '</div><button type="button" class="ssw-info-close" aria-label="종목정보 닫기">×</button></div>' + TABS.map(function (t) {
      return '<section class="ssw-pane" role="tabpanel" id="sswPane-' + t[0] + '" aria-labelledby="sswTab-' + t[0] + '"' + (t[0] === state.tab ? '' : ' hidden') + '></section>';
    }).join('');
    panels.appendChild(info);
    el.info = info;
    if (news) info.querySelector('#sswPane-news').appendChild(news); // 기존 관련 뉴스·공시 패널을 그대로 옮긴다

    var backdrop = doc.createElement('div');
    backdrop.className = 'ssw-backdrop';
    backdrop.hidden = true;
    root.appendChild(backdrop);
    el.backdrop = backdrop;

    root.classList.add('ss-workspace');
    root.setAttribute('data-ssw-panel', state.panel);
    doc.documentElement.classList.add('ssw-page');
    wire();
    return true;
  }

  /* ───── 머리말 보강: 시장 구분·자료 기준시각·종목정보 열기 ───── */
  // data/sectors-v3.js: { 섹터명: [{ name, code, market }] } (stock-search.js lookupSectors와 같은 자료)
  function sectorEntries(code) {
    var map = global.SECTOR_MAP, out = [];
    if (!map || !code) return out;
    Object.keys(map).forEach(function (sector) {
      var list = map[sector];
      if (!Array.isArray(list)) return;
      list.forEach(function (row) { if (row && row.code === code) out.push({ sector: sector, market: row.market }); });
    });
    return out;
  }
  function marketLabel(code) {
    var hit = sectorEntries(code).filter(function (row) { return row.market; })[0];
    return hit ? String(hit.market).toUpperCase() : '';
  }
  function clockLabel(raw) {
    var text = String(raw == null ? '' : raw).trim();
    var m = text.match(/^(\d{2}):?(\d{2}):?(\d{2})$/);
    return m ? m[1] + ':' + m[2] + ':' + m[3] : '';
  }
  function decorateHead() {
    var summary = root.querySelector('#ssSummary');
    var head = summary && summary.querySelector('.ss-summary-head');
    if (!head || !state.code) return;
    var meta = head.querySelector('.ssw-head-meta');
    if (!meta) {
      meta = doc.createElement('span');
      meta.className = 'ssw-head-meta';
      meta.innerHTML = '<span class="ssw-head-market" hidden></span><span class="ssw-head-time"></span>';
      var code = head.querySelector('.ss-summary-code');
      if (code && code.nextSibling) head.insertBefore(meta, code.nextSibling); else head.appendChild(meta);
      var toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'ssw-info-toggle';
      toggle.setAttribute('aria-controls', 'sswInfo');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = '종목정보';
      head.appendChild(toggle);
    }
    var market = marketLabel(state.code);
    var marketEl = meta.querySelector('.ssw-head-market');
    marketEl.textContent = market;
    marketEl.hidden = !market;
    // 자료 기준시각: 체결값이 준 시각만 쓴다. 없으면 받은 시각으로 꾸미지 않고 상태(지연·대기)를 그대로 적는다.
    var quote = state.quote && state.quote.code === state.code ? state.quote : null;
    var clock = quote ? clockLabel((quote.trade && quote.trade.time) || quote.time) : '';
    var date = state.session && state.session.date ? String(state.session.date) : '';
    var text = !quote ? (date ? date + ' 일봉 기준 · 체결 수신 대기' : '시세 수신 대기')
      : quote.delayed ? '지연 시세(REST 조회)' + (clock ? ' · ' + clock + ' KST' : '')
      : clock ? '체결 ' + clock + ' KST' : '실시간 수신 · 체결시각 미제공';
    meta.querySelector('.ssw-head-time').textContent = text;
  }

  /* ───── 호가 패널의 시가·고가·저가 아래: 전일 대비·거래량(2026-11-12 사용자 지시로 오른쪽 요약 칸에서 옮김) ─────
     #ssSessionCandle은 stock-search.js가 통째로 다시 그리므로 바로 아래 형제 노드에 그린다. */
  function renderSessionExtra() {
    var anchor = root.querySelector('#ssSessionCandle');
    if (!anchor) return;
    var box = root.querySelector('#sswSessionExtra');
    if (!box) {
      box = doc.createElement('div');
      box.id = 'sswSessionExtra';
      box.className = 'ss-session ssw-session-extra';
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    var s = state.session || {}, q = state.quote && state.quote.code === state.code ? state.quote : {};
    var volume = num(s.liveVolume != null ? s.liveVolume : s.volume);
    var change = num(q.change);
    box.innerHTML = '<div class="ss-session-values">'
      + '<div><span>전일 대비</span><b class="' + tone(change).trim() + '">' + (change == null ? '—' : signed(change) + '원') + '</b></div>'
      + '<div><span>거래량</span><b>' + (volume > 0 ? fmt(volume) + '주' : '—') + '</b></div></div>'; // 0·미수신은 0으로 꾸미지 않는다
  }

  /* ───── 수급 탭: 기존 /foreign-flow/{code}(외국인·기관·개인 일별 순매수 수량, 서버 금액 추정 amount_estimate) ─────
     2026-11-13 재설계: 표 두 장 대신 ① 기간 선택 + 주체별 0 기준 막대(금액 추정, 세 주체 같은 눈금) ② 연속 매매·추세 전환
     ③ 외국인 보유율 변화 ④ 최근 10거래일 열지도. 같은 응답 하나만 쓰고 기간을 바꿔도 다시 요청하지 않는다. */
  var FLOW_WHO = [['foreign', '외국인', ''], ['inst', '기관', 'inst_'], ['ind', '개인', 'ind_']];
  var FLOW_PERIODS = [['today', '당일'], ['5d', '5일'], ['20d', '20일'], ['3m', '3개월']];
  function eok(value, digits) { // 원 → 억원 표기(부호 포함). 결측은 꾸미지 않는다.
    var n = num(value);
    if (n == null) return '—';
    var v = n / 1e8, a = Math.abs(v);
    var body = a >= 10000 ? (a / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '조'
      : a.toLocaleString('ko-KR', { maximumFractionDigits: a >= 100 ? 0 : (digits == null ? 1 : digits) }) + '억';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + body;
  }
  function flowStreak(st) {
    var days = st && num(st.days != null ? st.days : st.count);
    var dir = st && String(st.direction || st.dir || '');
    if (!days || days < 2 || !/buy|sell/.test(dir)) return ''; // 하루짜리는 '연속'이 아니다
    var buy = dir === 'buy';
    return '<small class="' + (buy ? 'up' : 'down') + '">' + days + '일 연속 ' + (buy ? '순매수' : '순매도') + '</small>';
  }
  function renderFlow(pane, data) {
    var period = state.flowPeriod || 'today';
    var rolling = data.rolling || {}, est = data.amount_estimate || {}, streak = data.streak || {}, signal = data.signal || {};
    var periods = FLOW_PERIODS.filter(function (p) { return rolling[p[0]]; });
    if (!periods.some(function (p) { return p[0] === period; })) period = periods.length ? periods[0][0] : 'today';
    var rows = FLOW_WHO.map(function (w) {
      var qty = rolling[period] ? num(rolling[period][w[0]]) : null;
      // 당일 개인 실시간 값은 서버가 null로 둘 수 있다 - 그때 금액 추정(0 합산)도 미집계로 표시한다.
      var amount = qty == null ? null : num(est[w[2] + period + '_krw']);
      return { key: w[0], label: w[1], qty: qty, amount: amount };
    });
    var scale = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.amount || 0); }).concat([1]));
    var shifts = FLOW_WHO.filter(function (w) { return signal[w[0]] && signal[w[0]].trend_shift; });
    var daily = (data.daily || []).slice(0, 10);
    var cellMax = 1;
    daily.forEach(function (d) { FLOW_WHO.forEach(function (w) { var v = num(d[w[0] + '_net']), c = num(d.close); if (v != null && c) cellMax = Math.max(cellMax, Math.abs(v * c)); }); });
    var ratioNow = daily.length ? num(daily[0].foreign_ratio) : null;
    var base = data.daily && data.daily[Math.min(20, data.daily.length - 1)];
    var ratioBase = base ? num(base.foreign_ratio) : null;

    pane.innerHTML = '<div class="ssw-seg" role="group" aria-label="수급 집계 기간">' + periods.map(function (p) {
        return '<button type="button" data-ssw-flow-period="' + p[0] + '" aria-pressed="' + (p[0] === period) + '">' + p[1] + '</button>';
      }).join('') + '</div>'
      + '<ul class="ssw-flow-rows" aria-label="주체별 순매수 금액 추정(막대 길이는 세 주체 같은 눈금)">' + rows.map(function (r) {
        var width = r.amount == null ? 0 : Math.min(50, Math.abs(r.amount) / scale * 50);
        var side = r.amount > 0 ? 'up' : r.amount < 0 ? 'down' : '';
        return '<li class="ssw-flow-row">'
          + '<div class="ssw-flow-name"><b>' + r.label + '</b>' + flowStreak(streak[r.key]) + '</div>'
          + '<div class="ssw-flow-bar" aria-hidden="true"><i class="' + side + '" style="width:' + width.toFixed(1) + '%"></i></div>'
          + '<div class="ssw-flow-val"><b class="' + side + '">' + (r.qty == null ? '미집계' : eok(r.amount)) + '</b><small>' + (r.qty == null ? '' : signed(r.qty) + '주') + '</small></div></li>';
      }).join('') + '</ul>'
      + (shifts.length ? '<ul class="ssw-flow-signals">' + shifts.map(function (w) {
        return '<li><b>' + w[1] + '</b> 추세 전환 · ' + esc(signal[w[0]].note || '') + '</li>';
      }).join('') + '</ul>' : '')
      + (ratioNow != null ? '<dl class="ssw-facts"><div><dt>외국인 보유율</dt><dd>' + ratioNow.toFixed(2) + '%'
        + (ratioBase != null ? ' <small class="' + tone(ratioNow - ratioBase).trim() + '">' + (ratioNow - ratioBase >= 0 ? '+' : '−') + Math.abs(ratioNow - ratioBase).toFixed(2) + '%p · ' + esc(String(base.date || '').slice(5)) + ' 대비</small>' : '')
        + '</dd></div></dl>' : '')
      + (daily.length ? '<table class="ssw-table ssw-heat"><caption>최근 ' + daily.length + '거래일 순매수 금액 추정(억원)</caption><thead><tr><th scope="col">일자</th><th scope="col">등락</th>'
        + FLOW_WHO.map(function (w) { return '<th scope="col">' + w[1] + '</th>'; }).join('') + '</tr></thead><tbody>'
        + daily.map(function (d) {
          var chg = num(d.change_pct), close = num(d.close);
          return '<tr><th scope="row">' + esc(String(d.date || '').slice(5).replace('-', '.')) + '</th>'
            + '<td class="' + tone(chg).trim() + '">' + (chg == null ? '—' : (chg > 0 ? '+' : chg < 0 ? '−' : '') + Math.abs(chg).toFixed(1) + '%') + '</td>'
            + FLOW_WHO.map(function (w) {
              var v = num(d[w[0] + '_net']);
              if (v == null || !close) return '<td class="ssw-heat-na">—</td>';
              var amount = v * close, level = Math.round(Math.min(1, Math.abs(amount) / cellMax) * 100);
              return '<td class="ssw-heat-cell ' + tone(amount).trim() + '" style="--heat:' + level + '%" title="' + signed(v) + '주">' + eok(amount, 0).replace(/[억조]$/, '') + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table>' : '')
      + '<p class="ssw-note">기준일 ' + esc(data.as_of || (data.daily[0] && data.daily[0].date) || '') + ' · 금액은 순매수 수량×당일 종가 추정 · 막대는 세 주체 같은 눈금</p>';
  }
  function loadFlow() {
    var pane = el.info.querySelector('#sswPane-flow');
    var code = state.code;
    if (!isDomestic(code)) { pane.innerHTML = '<p class="ssw-state">종목을 선택하면 수급이 표시됩니다.</p>'; return; }
    if (pane.getAttribute('data-code') === code) return; // 같은 종목은 다시 요청하지 않는다
    var token = ++state.flowToken;
    pane.setAttribute('data-code', code);
    state.flowData = null;
    pane.innerHTML = '<p class="ssw-state" role="status">수급 자료를 불러오는 중입니다.</p>';
    global.NineHttp.json(API + '/foreign-flow/' + encodeURIComponent(code), { timeoutMs: 15000, ttlMs: FLOW_TTL_MS }).then(function (body) {
      if (token !== state.flowToken || state.code !== code) return; // 빠른 종목 전환: 이전 응답은 버린다
      var data = (body && body.data) || body || {};
      if (!data.daily || !data.daily.length) throw new Error('empty');
      state.flowData = data;
      renderFlow(pane, data);
    }).catch(function () {
      if (token !== state.flowToken || state.code !== code) return;
      pane.removeAttribute('data-code'); // 다시 열면 재시도
      pane.innerHTML = '<p class="ssw-state ssw-error" role="status">수급 자료를 받지 못했습니다. 탭을 다시 열면 재시도합니다.</p>';
    });
  }

  /* ───── 기업정보 탭 ─────
     개요: data/company-profiles.js(정적, 처음 열 때 한 번). 핵심 지표·실적: 종목분석 펀더멘탈 탭과 같은 기존
     GAS ?action=fundamentals 응답(valuation=시세 기준 PER·PBR·시총, fundamentals=DART 배치 캐시)을 그대로 쓴다.
     새 계산·수집 경로는 없고, 자세한 표·차트는 종목분석 펀더멘탈로 연결한다. */
  var FUND_TTL_MS = 30 * 60 * 1000;
  function loadProfiles() {
    if (global.COMPANY_PROFILES) return Promise.resolve(global.COMPANY_PROFILES);
    if (state.profiles) return state.profiles;
    state.profiles = new Promise(function (resolve, reject) {
      var tag = doc.createElement('script');
      tag.src = PROFILES_URL;
      tag.onload = function () { if (global.COMPANY_PROFILES) resolve(global.COMPANY_PROFILES); else reject(new Error('profiles')); };
      tag.onerror = function () { state.profiles = null; reject(new Error('profiles')); };
      doc.head.appendChild(tag);
    });
    return state.profiles;
  }
  function loadFundamentals(code) {
    var gas = global.NineAPI && global.NineAPI.gasUrl;
    if (!gas) return Promise.reject(new Error('gas'));
    return global.NineHttp.json(gas + '?action=fundamentals&code=' + encodeURIComponent(code), { timeoutMs: 20000, ttlMs: FUND_TTL_MS })
      .then(function (body) { var d = global.NineAPI.unwrap(body); if (!d || (!d.valuation && !d.fundamentals)) throw new Error('empty'); return d; });
  }
  function pct(value, sign) {
    var n = num(value);
    if (n == null) return '—';
    return (sign ? (n > 0 ? '+' : n < 0 ? '−' : '') : n < 0 ? '−' : '') + Math.abs(n).toFixed(1) + '%';
  }
  function won(value) { var n = num(value); return n == null ? '—' : eok(n).replace(/^\+/, ''); }
  function multiple(value) { var n = num(value); return n == null || n <= 0 ? '—' : n.toFixed(1) + '배'; }
  function companyFundHtml(res) {
    var v = res.valuation || {}, f = res.fundamentals || {}, annual = f.annual || {}, q = f.latest_quarter;
    var cap = num(v.market_cap_eok);
    var kpis = [
      ['시가총액', cap == null ? '—' : won(cap * 1e8)],
      ['PER', multiple(v.per)],
      ['PBR', multiple(v.pbr)],
      ['ROE', pct(annual.latest_roe_pct)],
      ['부채비율', pct(annual.latest_debt_ratio_pct)],
      ['외국인 보유', pct(v.foreign_hold_ratio_pct)]
    ];
    var html = '<h5 class="ssw-sub">핵심 지표</h5><div class="ssw-kpis">' + kpis.map(function (k) {
      return '<div><span>' + k[0] + '</span><b>' + k[1] + '</b></div>';
    }).join('') + '</div>';
    function loss(value) { return num(value) != null && num(value) < 0 ? 'down' : ''; } // 금액은 손실만 표시색(상승색 남용 방지)
    if (q) {
      // 금융업처럼 매출액이 공시 구조상 비는 항목은 줄을 만들지 않는다(빈 값을 0으로 꾸미지 않음).
      var qRows = [['매출액', q.revenue, q.revenue_yoy_pct], ['영업이익', q.operating_income, q.operating_income_yoy_pct], ['순이익', q.net_income, q.net_income_yoy_pct]]
        .filter(function (r) { return num(r[1]) != null; });
      if (qRows.length) html += '<h5 class="ssw-sub">최근 실적 <small>' + esc(q.period_label || q.label || '') + ' · 전년 동기 대비</small></h5>'
        + '<table class="ssw-table"><tbody>' + qRows.map(function (r) {
          return '<tr><th scope="row">' + r[0] + '</th><td class="' + loss(r[1]) + '">' + won(r[1]) + '</td><td class="' + tone(r[2]).trim() + '">' + pct(r[2], true) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    var years = (annual.years || []).slice(-4);
    var hasRevenue = years.some(function (y) { return num(y.revenue) != null; });
    var cols = (hasRevenue ? [['매출액', 'revenue']] : []).concat([['영업이익', 'operating_income'], ['순이익', 'net_income']]);
    if (years.length) {
      html += '<h5 class="ssw-sub">연간 실적</h5><table class="ssw-table"><thead><tr><th scope="col">연도</th>' + cols.map(function (c) { return '<th scope="col">' + c[0] + '</th>'; }).join('')
        + (hasRevenue ? '<th scope="col">이익률</th>' : '') + '</tr></thead><tbody>'
        + years.slice().reverse().map(function (y) {
          var margin = num(y.revenue) && num(y.operating_income) != null ? y.operating_income / y.revenue * 100 : null;
          return '<tr><th scope="row">' + esc(y.year) + '</th>' + cols.map(function (c) { return '<td class="' + loss(y[c[1]]) + '">' + won(y[c[1]]) + '</td>'; }).join('')
            + (hasRevenue ? '<td>' + pct(margin) + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table>';
    }
    if (!q && !years.length) html += '<p class="ssw-note">공시 재무 자료가 없는 종목입니다(미제출 또는 배치 수집 전).</p>';
    return html + '<p class="ssw-note">PER·PBR·시가총액·외국인 보유는 조회 시점 시세 기준, 실적·ROE·부채비율은 DART 정기보고서 기준'
      + (f.collected_at ? '(수집 ' + esc(String(f.collected_at).slice(0, 10)) + ')' : '') + '</p>';
  }
  function loadCompany() {
    var pane = el.info.querySelector('#sswPane-company');
    var code = state.code;
    if (!isDomestic(code)) { pane.innerHTML = '<p class="ssw-state">종목을 선택하면 기업정보가 표시됩니다.</p>'; return; }
    if (pane.getAttribute('data-code') === code) return;
    pane.setAttribute('data-code', code);
    var themes = [];
    sectorEntries(code).forEach(function (row) { if (themes.indexOf(row.sector) < 0) themes.push(row.sector); });
    pane.innerHTML = '<div class="ssw-co-head"><b>' + esc(state.name) + '</b><small>' + esc(code) + '</small><span class="ssw-co-industry" hidden></span></div>'
      + (themes.length ? '<p class="ssw-chips" aria-label="테마">' + themes.slice(0, 6).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</p>' : '')
      + '<div class="ssw-co-profile"><p class="ssw-state" role="status">기업 개요를 불러오는 중입니다.</p></div>'
      + '<div class="ssw-co-fund"><p class="ssw-state" role="status">재무·지표를 불러오는 중입니다.</p></div>'
      + '<a class="ssw-more" href="/page/foreign-flow?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(state.name) + '">종목분석에서 펀더멘탈 자세히 보기 →</a>';
    var failed = 0;
    function retryable() { if (++failed === 2) pane.removeAttribute('data-code'); } // 둘 다 실패하면 다시 열 때 재시도
    loadProfiles().then(function (all) {
      if (state.code !== code) return;
      var item = all.companies && all.companies[code];
      var box = pane.querySelector('.ssw-co-profile');
      if (!item) { box.innerHTML = '<p class="ssw-note">이 종목의 기업 개요 자료가 없습니다.</p>'; return; }
      if (item.industry) { var ind = pane.querySelector('.ssw-co-industry'); ind.textContent = item.industry; ind.hidden = false; }
      box.innerHTML = '<p class="ssw-body">' + esc(item.summary || '') + '</p>'
        + '<p class="ssw-note">개요 출처 ' + esc(all.source || '') + (all.asOf ? ' · ' + esc(all.asOf) + ' 기준' : '') + '</p>';
    }).catch(function () {
      if (state.code !== code) return;
      pane.querySelector('.ssw-co-profile').innerHTML = '<p class="ssw-note ssw-error">기업 개요를 받지 못했습니다.</p>';
      retryable();
    });
    loadFundamentals(code).then(function (res) {
      if (state.code !== code) return;
      pane.querySelector('.ssw-co-fund').innerHTML = companyFundHtml(res);
    }).catch(function () {
      if (state.code !== code) return;
      pane.querySelector('.ssw-co-fund').innerHTML = '<p class="ssw-note ssw-error">재무·지표를 받지 못했습니다.</p>';
      retryable();
    });
  }

  function showTab(key) {
    state.tab = key;
    el.info.querySelectorAll('[data-ssw-tab]').forEach(function (btn) { btn.setAttribute('aria-selected', String(btn.getAttribute('data-ssw-tab') === key)); });
    el.info.querySelectorAll('.ssw-pane').forEach(function (pane) { pane.hidden = pane.id !== 'sswPane-' + key; });
    if (key === 'flow') loadFlow();
    else if (key === 'company') loadCompany();
  }

  /* ───── 관심·최근 서랍 ───── */
  function drawerRows(title, items, empty) {
    return '<section><h4>' + title + '</h4>' + (items.length ? '<ul>' + items.map(function (it) {
      return '<li><button type="button" data-ssw-pick="' + esc(it.code) + '" data-name="' + esc(it.name || it.code) + '"><b>' + esc(it.name || it.code) + '</b><small>' + esc(it.code) + '</small></button></li>';
    }).join('') + '</ul>' : '<p class="ssw-state">' + empty + '</p>') + '</section>';
  }
  function renderDrawer() {
    var api = panelApi();
    var favorites = api && api.getFavorites ? api.getFavorites() : [];
    var favCodes = favorites.map(function (it) { return it.code; });
    var recent = (api && api.getRecent ? api.getRecent() : []).filter(function (it) { return favCodes.indexOf(it.code) < 0; });
    el.drawer.innerHTML = drawerRows('관심종목', favorites.slice(0, 30), '관심종목이 없습니다. 검색 결과의 ★로 추가할 수 있습니다.')
      + drawerRows('최근 본 종목', recent.slice(0, 10), '최근 본 종목이 없습니다.');
  }
  function setDrawer(open) {
    if (open) renderDrawer();
    el.drawer.hidden = !open;
    el.drawerBtn.setAttribute('aria-expanded', String(open));
  }
  /* 종목정보는 비모달이다(2026-11-13): 넓은 PC는 차트 오른쪽 열로 붙고(차트가 그만큼 좁아질 뿐 계속 조작 가능),
     좁은 PC는 배경 가림 없이 오른쪽에 떠 있다. 같은 오른쪽을 쓰는 전역 관심종목과는 기존 닫기 API로 하나만 연다.
     열림 상태는 관심종목처럼 기억한다. 배경(.ssw-backdrop) 노드는 기존 계약 보존용으로 남기되 띄우지 않는다. */
  var INFO_OPEN_KEY = 'ssw_info_open_v1';
  function setInfoOpen(open, keep) {
    if (!el.backdrop) return;
    if (open && panelApi() && panelApi().closeGlobalWatchlist) panelApi().closeGlobalWatchlist();
    var was = root.classList.contains('ssw-info-open');
    root.classList.toggle('ssw-info-open', open);
    el.backdrop.hidden = true;
    var toggle = root.querySelector('.ssw-info-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (open) showTab(state.tab);
    if (!keep) { try { global.localStorage.setItem(INFO_OPEN_KEY, open ? '1' : '0'); } catch (e) { /* 저장소 차단 */ } }
    // 차트 열 폭이 바뀌므로 크기를 다시 재게 한다(showPanel과 같은 방식, 구독은 그대로).
    if (was !== open) global.requestAnimationFrame(function () { global.dispatchEvent(new global.Event('resize')); });
  }
  function storedInfoOpen() { try { return global.localStorage.getItem(INFO_OPEN_KEY) === '1'; } catch (e) { return false; } }
  function showPanel(key) {
    state.panel = key;
    root.setAttribute('data-ssw-panel', key);
    el.mtabs.querySelectorAll('[data-ssw-panel-btn]').forEach(function (btn) { btn.setAttribute('aria-selected', String(btn.getAttribute('data-ssw-panel-btn') === key)); });
    if (key === 'info') showTab(state.tab);
    // 숨겼던 차트가 다시 보일 때 크기를 다시 재도록 알린다(차트 엔진은 resize에 반응한다). 구독은 건드리지 않는다.
    if (key === 'chart') global.requestAnimationFrame(function () { global.dispatchEvent(new global.Event('resize')); });
  }

  function open(code, name) {
    if (!code || !global.StockSearch || !global.StockSearch.open) return;
    global.StockSearch.open(code, name || code);
  }

  function wire() {
    el.drawerBtn.addEventListener('click', function () { setDrawer(el.drawer.hidden); });
    el.drawer.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-ssw-pick]') : null;
      if (!btn) return;
      setDrawer(false);
      open(btn.getAttribute('data-ssw-pick'), btn.getAttribute('data-name'));
    });
    doc.addEventListener('click', function (e) {
      if (!el.drawer.hidden && !e.target.closest('.ssw-drawer, .ssw-drawer-btn')) setDrawer(false);
      if (e.target.closest && e.target.closest('.ssw-info-toggle')) setInfoOpen(!root.classList.contains('ssw-info-open'));
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!el.drawer.hidden) { setDrawer(false); el.drawerBtn.focus(); }
      // 비모달이므로 Esc는 종목정보 안에 초점이 있을 때만 닫는다(차트 작도 취소 등 다른 Esc와 겹치지 않게).
      else if (root.classList.contains('ssw-info-open') && el.info.contains(doc.activeElement)) {
        setInfoOpen(false);
        var t = root.querySelector('.ssw-info-toggle'); if (t) t.focus();
      }
    });
    el.backdrop.addEventListener('click', function () { setInfoOpen(false); });
    el.info.querySelector('.ssw-info-close').addEventListener('click', function () { setInfoOpen(false); });
    el.info.querySelector('.ssw-tabs').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-ssw-tab]') : null;
      if (btn) showTab(btn.getAttribute('data-ssw-tab'));
    });
    el.info.querySelector('#sswPane-flow').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-ssw-flow-period]') : null;
      if (!btn || !state.flowData) return;
      state.flowPeriod = btn.getAttribute('data-ssw-flow-period');
      renderFlow(el.info.querySelector('#sswPane-flow'), state.flowData);
      var again = el.info.querySelector('[data-ssw-flow-period="' + state.flowPeriod + '"]'); if (again) again.focus();
    });
    el.mtabs.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-ssw-panel-btn]') : null;
      if (btn) showPanel(btn.getAttribute('data-ssw-panel-btn'));
    });

    // 종목 선택(검색·결과 행·서랍·뒤로가기 모두 stock-search.js의 selectStock을 거친다)
    doc.addEventListener('nine-stock-selection', function (e) {
      var d = e.detail || {};
      if (!isDomestic(d.code)) return;
      var changed = d.code !== state.code;
      state.code = d.code; state.name = d.name || d.code;
      if (changed) { state.session = null; state.quote = null; }
      var api = panelApi();
      if (api && api.remember) api.remember(state.code, state.name);
      syncUrl();
      ['flow', 'company'].forEach(function (key) { if (changed) el.info.querySelector('#sswPane-' + key).removeAttribute('data-code'); });
      showTab(state.tab);
      renderSessionExtra();
      // #ssSummary는 이 이벤트 직후 stock-search.js가 다시 그린다 → 그 뒤에 머리말을 보강한다.
      global.setTimeout(decorateHead, 0);
    });
    doc.addEventListener('nine-stock-quote', function (e) {
      var q = e.detail || {};
      if (q.code !== state.code) return;
      state.quote = q;
      decorateHead();
      renderSessionExtra();
    });
    doc.addEventListener('nine-stock-session', function (e) {
      var d = e.detail || {};
      if (d.code !== state.code) return;
      state.session = d.summary || null;
      decorateHead();
      renderSessionExtra();
    });
    global.addEventListener('popstate', function () {
      var code = urlCode();
      if (code && code !== state.code && !isUsUrl()) open(code, (new URLSearchParams(global.location.search).get('name') || '').trim());
    });
  }

  /* 종목을 바꾸면 주소에 남긴다(새로고침·뒤로가기·직접 URL). 기존 ?code=&name= 계약 그대로. */
  function syncUrl() {
    try {
      var url = new URL(global.location.href);
      var current = (url.searchParams.get('code') || '').trim();
      if (current === state.code) return;
      url.searchParams.delete('market');
      url.searchParams.set('code', state.code);
      url.searchParams.set('name', state.name);
      var next = url.pathname + url.search + url.hash;
      if (current) global.history.pushState(null, '', next); else global.history.replaceState(null, '', next);
    } catch (e) { /* 주소 기록 없이 계속 사용 */ }
  }

  /* 첫 종목: URL 지정 → 마지막 선택 → 관심종목 첫 항목. 모두 없으면 검색 안내만 둔다. */
  function resolveInitial() {
    if (urlCode() || isUsUrl()) return;
    var api = panelApi();
    var last = api && api.getLast ? api.getLast() : '';
    var recent = api && api.getRecent ? api.getRecent() : [];
    if (isDomestic(last)) {
      var hit = recent.filter(function (it) { return it.code === last; })[0];
      open(last, hit ? hit.name : last);
      return;
    }
    function fromWatchlist() {
      if (state.code || urlCode()) return true;
      var list = api && api.getFavorites ? api.getFavorites() : [];
      var first = list.filter(function (it) { return isDomestic(it.code); })[0];
      if (first) { open(first.code, first.name); return true; }
      return false;
    }
    if (fromWatchlist()) return;
    // 관심종목은 로그인 확인 뒤에 채워진다 - 바뀌면 한 번만 다시 본다.
    if (global.Watchlist && global.Watchlist.onChange) global.Watchlist.onChange(function () { fromWatchlist(); });
    var results = root.querySelector('#ssResults');
    if (results && !results.innerHTML.trim()) results.innerHTML = '<div class="ss-hint">종목명이나 코드를 검색하거나 ‘관심·최근’에서 종목을 고르세요.</div>';
  }

  function start() {
    if (!build()) return;
    var current = global.StockSearch && global.StockSearch.currentSelection ? global.StockSearch.currentSelection() : null;
    if (current && isDomestic(current.code)) { // 이 모듈보다 먼저 선택된 종목
      state.code = current.code; state.name = current.name || current.code;
      decorateHead();
    }
    showTab(state.tab);
    // 지난번에 열어 둔 종목정보는 다시 연다(PC만, 전역 관심종목이 열린 채면 그쪽을 존중).
    if (storedInfoOpen() && global.matchMedia && global.matchMedia('(min-width: 861px)').matches
      && !doc.documentElement.classList.contains('wl-open')) setInfoOpen(true, true);
    resolveInitial();
  }

  global.StockWorkspace = { closeInfo: function () { setInfoOpen(false); }, showTab: showTab, showPanel: showPanel, state: function () { return { code: state.code, tab: state.tab, panel: state.panel }; } };
  // 배치 CSS가 온 뒤에 꾸민다(스타일 없는 3열이 잠깐 보이지 않게). 실패하면 기존 화면 그대로 둔다.
  global.NineUI.loadStyle(CSS_URL).then(start, function () { /* 기존 2열 화면 유지 */ });
})(window);

