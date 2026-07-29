/**
 * 실시간 호가창(증권사 HTS 스타일) - 독립 Tistory Page(/page/order-book 예정,
 * <div id="order-book"> 임베드) 위젯. 2026-07-27 신설.
 *
 * 매도/매수 각 10단계 잔량 사다리는 VM(goodbyestar.cloud/order-book/{code}, 키움 REST
 * ka10004 주식호가요청)을 브라우저가 직접 호출(인증 없음, CORS로 블로그 도메인만 허용) -
 * js/kospi-futures.js의 /futures와 동일 패턴. 현재가/등락률은 이미 검증된 기존 GAS 시세
 * 프록시(?codes=)를 그대로 재사용한다(호가 사다리와 별도 소스지만 같은 2초 주기로 갱신).
 *
 * 종목 검색은 watchlist.js/foreign-flow.js와 동일한 KRX_MAP 자동완성 패턴.
 * window.KRX_MAP(종목명->코드)이 이 스크립트보다 먼저 로드되어야 함.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var VM_ORDER_BOOK_URL = 'https://goodbyestar.cloud/order-book/';
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var CONTAINER_SELECTOR = '#order-book';
  var POLL_MS = 2000;
  var MAX_SUGGESTIONS = 8;
  var FETCH_TIMEOUT_MS = 8000;
  // 2026-07-27: "9Pay 증권" 개편 작업지시서 #7 - 3D 산점도 뷰를 완전히 삭제(5차례 개편에도
  // 원하는 그림이 안 나와 폐기하기로 확정됨). 저항/지지 HUD·체결강도·매도벽 돌파 기록은
  // "유지" 대상이라 3D 패널 밖으로 꺼내 호가창(ladder) 화면에 그대로 옮겨 붙였다.
  // 체결강도 계산에는 최근 몇 틱 비교가 필요해 짧은 히스토리 버퍼는 계속 유지한다.
  var HISTORY_MAX = 6;

  // "매도벽 하나를 완전히 소진해야 돌파"(2026-07-27 사용자 확인) 판정 기준 - 다른 9개
  // 매도호가 평균보다 이 배수 이상 많이 쌓인 호가만 "벽"으로 인정(사소한 잔량 튐 배제).
  var WALL_RATIO = 1.8;
  var WALL_BREAK_RATIO = 0.15; // 최초로 확인한 벽 잔량의 이 비율 이하로 줄면 "소진"으로 판정
  var MILESTONE_MAX = 8;
  var TOAST_MS = 3500;
  var TRADE_LIST_MAX = 20; // 최근 체결 리스트 표시 개수(ka10003 스냅샷을 폴링마다 누적)
  // 체결강도(근사치) - 실제 체결(0B 웹소켓) 데이터 없이 "추적 중인 매도벽이 틱 사이에 얼마나
  // 빨리 줄어드는가"만으로 추정한다(2026-07-27 사용자 확인: "지금 데이터로 근사치 계산"
  // 추천안으로 진행 - 진짜 체결강도는 별도 데이터소스 연동이 필요해 범위 밖으로 미룸).
  // peakQty 대비 이 비율(%)만큼 한 틱 사이 줄면 강도 100으로 포화되도록 잡은 경험적 배율.
  var STRENGTH_SCALE = 7;

  var state = {
    code: null,
    name: null,
    timer: null,
    // history[i] = { t: ms, base: 그 시점 현재가(없으면 직전 값 유지), asks:[{price,qty}], bids:[{price,qty}] }
    history: [],
    trades: [],          // 최근 체결(ka10003 스냅샷 누적) - [{time,price,qty,up,down}], 최신이 앞
    startTime: null,
    lastBase: null,      // 직전 tick의 현재가(quote 조회가 실패한 틱에서 이어받을 기준가)
    trackedWall: null,   // { price, peakQty } - 지금 지켜보고 있는 매도벽
    milestones: [],      // [{ price, t }] - 소진(돌파) 기록, 최신이 앞
    toastTimer: null
  };

  // 종목코드.svg -> 실패 시 .png -> 그마저 없으면 숨김(3단 폴백, img/stock-icons/README.md 규칙)
  global.__stockIconFallback = global.__stockIconFallback || function (img) {
    if (img.getAttribute('data-fb') === '1') { img.style.display = 'none'; return; }
    img.setAttribute('data-fb', '1');
    img.src = img.src.replace(/\.svg(\?.*)?$/, '.png');
  };
  function stockIconHtml(code) {
    if (!code) return '';
    return '<img class="ob-icon" src="' + STOCK_ICON_BASE + encodeURIComponent(code) + '.svg" alt="" loading="lazy" onerror="window.__stockIconFallback(this)">';
  }

  // selector/opts 인자는 2026-07-27 "증시검색" 페이지(js/stock-search.js)가 이 모듈을
  // 그대로 재사용하려고 추가함 - 기본값(#order-book, 검색창 표시)은 기존 단독 페이지
  // (/page/order-book)와 100% 하위호환. 두 페이지가 동시에 로드될 일은 없어서(티스토리
  // 페이지 1개당 위젯 1개) 모듈 전역 state를 그대로 공유해도 안전하다.
  // opts.hideSearch: true면 자체 검색창(.ob-search)을 안 그림 - 증시검색은 상위 페이지의
  // 검색 결과 클릭으로 종목이 정해지므로 이 위젯 안에 검색창이 하나 더 있으면 중복이다.
  function init(selector, opts) {
    var container = document.querySelector(selector || CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildShell(opts);
    if (!opts || !opts.hideSearch) wireSearch(container);
  }

  function buildShell(opts) {
    var searchHtml = (opts && opts.hideSearch) ? '' : ''
      + '<div class="ob-search">'
      + '<div class="ob-input-wrap">'
      + '<input type="text" id="obInput" class="ob-input" placeholder="종목명을 입력하세요 (예: 삼성전자)" autocomplete="off" />'
      + '<div id="obSuggest" class="ob-suggest"></div>'
      + '</div>'
      + '<button type="button" id="obGoBtn" class="ob-go-btn">조회</button>'
      + '</div>';
    return searchHtml
      + '<div id="obHud" class="ob-hud">'
      + '<div class="ob-hud-row"><span class="ob-hud-label ob-ask-text">저항(매도벽)</span><div class="ob-hud-bar"><span id="obResistBar" class="ob-hud-fill ob-hud-fill-ask"></span></div><span id="obResistVal" class="ob-hud-val">-</span></div>'
      + '<div class="ob-hud-row"><span class="ob-hud-label ob-bid-text">지지(매수벽)</span><div class="ob-hud-bar"><span id="obSupportBar" class="ob-hud-fill ob-hud-fill-bid"></span></div><span id="obSupportVal" class="ob-hud-val">-</span></div>'
      + '<div class="ob-hud-row"><span class="ob-hud-label">체결강도</span><div class="ob-hud-bar"><span id="obStrengthBar" class="ob-hud-fill ob-hud-fill-strength"></span></div><span id="obStrengthVal" class="ob-hud-val">-</span></div>'
      + '<div id="obHudNote" class="ob-hud-note">종목을 선택하면 실시간으로 계산됩니다.</div>'
      + '<div id="obBreakoutNote" class="ob-breakout-note"></div>'
      + '</div>'
      + '<div id="obToast" class="ob-toast"></div>'
      + '<div id="obBoard" class="ob-board"><div class="ob-hint">종목을 검색해서 호가창을 확인해보세요.</div></div>'
      + '<div id="obMilestones" class="ob-milestones"></div>';
  }

  // ---- 검색/자동완성 (watchlist.js와 동일 패턴) ----

  function wireSearch(container) {
    var input = container.querySelector('#obInput');
    var suggestBox = container.querySelector('#obSuggest');
    var goBtn = container.querySelector('#obGoBtn');

    input.addEventListener('input', function () {
      renderSuggestions(container, suggestBox, input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        hideSuggestions(suggestBox);
        selectByQuery(container, input.value.trim());
      } else if (e.key === 'Escape') {
        hideSuggestions(suggestBox);
      }
    });
    goBtn.addEventListener('click', function () {
      hideSuggestions(suggestBox);
      selectByQuery(container, input.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) hideSuggestions(suggestBox);
    });
  }

  function hideSuggestions(box) {
    box.innerHTML = '';
    box.classList.remove('active');
  }

  function renderSuggestions(container, box, query) {
    var map = global.KRX_MAP;
    if (!query || !map) { hideSuggestions(box); return; }

    var q = query.toLowerCase();
    var starts = [], contains = [];
    for (var name in map) {
      if (!map.hasOwnProperty(name)) continue;
      var lower = name.toLowerCase();
      if (lower.indexOf(q) === 0) { if (starts.length < MAX_SUGGESTIONS) starts.push(name); }
      else if (lower.indexOf(q) > -1) { if (contains.length < MAX_SUGGESTIONS) contains.push(name); }
    }
    var matches = starts.concat(contains).slice(0, MAX_SUGGESTIONS);
    if (!matches.length) { hideSuggestions(box); return; }

    box.innerHTML = matches.map(function (name) {
      return '<div class="ob-suggest-item" data-name="' + escapeAttr(name) + '">' + stockIconHtml(map[name]) + escapeHtml(name) + '</div>';
    }).join('');
    box.classList.add('active');

    box.querySelectorAll('.ob-suggest-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var name = el.getAttribute('data-name');
        container.querySelector('#obInput').value = name;
        hideSuggestions(box);
        selectByQuery(container, name);
      });
    });
  }

  // 종목명/코드 -> { code, name }. 정확일치 우선, 부분일치는 1개일 때만(watchlist.js와 동일 로직).
  function resolveStock(query) {
    if (!query) return null;
    var map = global.KRX_MAP || {};
    if (/^[0-9A-Z]{6}$/i.test(query)) {
      for (var nm in map) {
        if (map.hasOwnProperty(nm) && map[nm].toUpperCase() === query.toUpperCase()) {
          return { code: map[nm], name: nm };
        }
      }
      return null;
    }
    if (map.hasOwnProperty(query)) return { code: map[query], name: query };

    var q = query.toLowerCase();
    var matches = [];
    for (var name in map) {
      if (map.hasOwnProperty(name) && name.toLowerCase().indexOf(q) > -1) matches.push(name);
    }
    if (matches.length === 1) return { code: map[matches[0]], name: matches[0] };
    return null;
  }

  function selectByQuery(container, query) {
    var stock = resolveStock(query);
    var board = container.querySelector('#obBoard');
    if (!stock) {
      board.innerHTML = '<div class="ob-hint ob-error">종목을 찾을 수 없습니다: "' + escapeHtml(query) + '"</div>';
      return;
    }
    selectStock(container, stock.code, stock.name);
  }

  // ---- 폴링 ----

  function selectStock(container, code, name) {
    state.code = code;
    state.name = name;
    state.history = [];
    state.trades = [];
    state.startTime = Date.now();
    state.lastBase = null;
    state.trackedWall = null;
    state.milestones = [];
    clearTimeout(state.toastTimer);
    if (state.timer) clearInterval(state.timer);

    var board = container.querySelector('#obBoard');
    board.innerHTML = '<div class="ob-hint"><div class="ob-spinner"></div>' + escapeHtml(name) + ' 호가 불러오는 중...</div>';
    var toast = container.querySelector('#obToast');
    if (toast) { toast.className = 'ob-toast'; toast.textContent = ''; }
    var milestoneBox = container.querySelector('#obMilestones');
    if (milestoneBox) milestoneBox.innerHTML = '';
    resetHud(container);

    tick(container);
    state.timer = setInterval(function () { tick(container); }, POLL_MS);
  }

  function tick(container) {
    var code = state.code;
    if (!code) return;
    // 호가(order-book)와 시세(quote)는 서로 다른 소스라 하나만 실패할 수 있다 - 특히 시세만
    // 실패해도 호가 사다리/3D 누적은 계속돼야 하므로(recordSnapshot의 기준가 이어받기가
    // 뜻이 있으려면) 각각 독립적으로 실패를 흡수하고, 정작 중요한 호가만 없을 때만 에러로 취급.
    Promise.all([
      OrderBook.fetchOrderBook(code),
      OrderBook.fetchQuote(code).catch(function () { return null; })
    ])
      .then(function (results) {
        if (state.code !== code) return; // 응답 오는 사이 다른 종목을 골랐으면 무시(레이스 방지)
        var book = results[0];
        var quote = results[1];
        if (book) recordTrade(book);
        if (book && (book.asks.length || book.bids.length)) {
          recordSnapshot(book, quote);
          // 강도 계산은 checkWallBreakthrough가 trackedWall을 초기화(돌파 시 null)하기 전에
          // 먼저 계산해야 "돌파 직전 100에 가까운 강도"가 자연스럽게 찍힌다.
          var strength = computeExecutionStrength();
          checkWallBreakthrough(container, book, quote);
          updateHud(container, book, strength, quote);
          updateBreakoutNote(container, book, quote);
        }
        renderBoard(container, book, quote);
        // 새 이벤트가 없어도 상대시간(예: 10초 전)이 폴링 주기마다 계속 갱신되도록 한다.
        renderMilestoneLog(container);
      })
      .catch(function () {
        if (state.code !== code) return;
        var board = container.querySelector('#obBoard');
        if (board && !board.querySelector('.ob-table')) {
          board.innerHTML = '<div class="ob-hint ob-error">호가 데이터를 불러오지 못했어요. 다음 갱신에 자동으로 재시도합니다.</div>';
        }
      });
  }

  function recordSnapshot(book, quote) {
    // quote 조회가 이번 틱에 실패했으면(호가는 왔는데 시세만 실패) 직전 기준가를 그대로
    // 이어받는다 - 기준가가 갑자기 사라져서 X축(현재가 대비 가격차)이 튀는 걸 방지.
    var base = (quote && quote.price != null) ? Number(quote.price) : state.lastBase;
    if (base != null) state.lastBase = base;
    state.history.push({ t: Date.now(), base: base, asks: book.asks, bids: book.bids });
    if (state.history.length > HISTORY_MAX) state.history.shift();
  }

  // ---- 최근 체결(ka10003) ----
  // 이 TR은 호출 시점의 마지막 체결 1건만 돌려주는 스냅샷이라(order_book.py 주석 참고),
  // 2초 폴링마다 값을 누적해서 리스트를 만든다 - 직전 스냅샷과 시간/가격/수량이 모두
  // 같으면 그 사이 새 체결이 없었다는 뜻이라 중복으로 넣지 않는다.
  function recordTrade(book) {
    var t = book && book.trade;
    if (!t || t.price == null || !t.qty) return;
    var last = state.trades[0];
    if (last && last.time === t.time && last.price === t.price && last.qty === t.qty) return;
    state.trades.unshift({ time: t.time, price: t.price, qty: t.qty, up: t.up, down: t.down });
    if (state.trades.length > TRADE_LIST_MAX) state.trades.length = TRADE_LIST_MAX;
  }

  // ---- 매도벽 돌파 감지("게임처럼 뚫는 느낌", 2026-07-27 사용자 요청) ----
  // 다른 매도호가 평균보다 눈에 띄게 잔량이 많은 한 단계를 "벽"으로 찍어두고, 그 잔량이
  // 거의 다 소진되거나(체결로 흡수) 아예 사라지면(현재가가 그 가격대를 완전히 지나감)
  // "돌파"로 판정한다 - 한 번에 벽 하나만 추적(요청 확인).
  function findWallCandidate(asks) {
    if (asks.length < 3) return null;
    var best = null;
    asks.forEach(function (r) {
      var others = asks.filter(function (o) { return o !== r; });
      var avgOthers = others.reduce(function (s, o) { return s + o.qty; }, 0) / others.length;
      if (avgOthers > 0 && r.qty >= avgOthers * WALL_RATIO && (!best || r.qty > best.qty)) {
        best = r;
      }
    });
    return best;
  }

  // 2026-07-28 사용자 리포트: SK하이닉스가 -10%로 급락 중인데도 "매도벽 돌파!"가 떴음 -
  // 이 감지 로직은 "추적하던 매도호가가 사다리에서 사라지거나 거의 소진됨"만 보는데, 이건
  // 진짜 매수세가 벽을 뚫은 경우뿐 아니라 가격이 급락해서 그 가격대가 화면에 보이는 상위
  // 10호가 창 밖으로 밀려난 경우에도 똑같이 "사라짐"으로 잡힌다. 후자는 돌파가 아니라
  // 오히려 그 반대(하락)인데 "돌파!"라고 표현하면 오해를 준다. 감지 로직 자체(벽 소진 여부)는
  // 그대로 두고, 그 순간 캔들 방향(양봉/음봉, quote.changeRate)에 따라 문구만 다르게 낸다 -
  // 양봉=진짜 돌파, 음봉=지지라인 관련 문구(사용자 제안).
  function isUpCandle(quote) {
    return !quote || quote.changeRate == null || quote.changeRate >= 0;
  }

  function checkWallBreakthrough(container, book, quote) {
    var asks = book.asks || [];
    if (!state.trackedWall) {
      var candidate = findWallCandidate(asks);
      if (candidate) state.trackedWall = { price: candidate.price, peakQty: candidate.qty };
      return;
    }

    var found = asks.filter(function (r) { return r.price === state.trackedWall.price; })[0];
    if (found) {
      if (found.qty > state.trackedWall.peakQty) state.trackedWall.peakQty = found.qty;
      if (found.qty > Math.max(1, state.trackedWall.peakQty * WALL_BREAK_RATIO)) return; // 아직 안 무너짐
    }
    // found가 없으면(그 가격대가 더 이상 매도 사다리에 없음 = 현재가가 완전히 지나감) 또는
    // 잔량이 임계치 밑으로 줄었으면 이벤트로 판정(문구는 캔들 방향에 따라 분기).
    recordMilestone(container, state.trackedWall.price, isUpCandle(quote));
    state.trackedWall = null;
  }

  function recordMilestone(container, price, up) {
    state.milestones.unshift({ price: price, t: Date.now(), up: up });
    if (state.milestones.length > MILESTONE_MAX) state.milestones.length = MILESTONE_MAX;
    renderMilestoneLog(container);
    showMilestoneToast(container, price, up);
  }

  // 이벤트가 발생한 시각을 기준으로 현재까지의 경과시간을 사람이 읽기 쉬운 상대시간으로 표시.
  function fmtElapsed(t) {
    var sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (sec < 60) return sec + '초 전';

    var min = Math.floor(sec / 60);
    if (min < 60) return min + '분 ' + (sec % 60) + '초 전';

    var hour = Math.floor(min / 60);
    return hour + '시간 ' + (min % 60) + '분 전';
  }

  function renderMilestoneLog(container) {
    var box = container.querySelector('#obMilestones');
    if (!box) return;
    if (!state.milestones.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="ob-milestones-title">🧱 매물벽 이벤트 기록</div>'
      + '<ul class="ob-milestones-list">' + state.milestones.map(function (m) {
        var label = m.up
          ? Math.round(m.price).toLocaleString('ko-KR') + '원 돌파'
          : Math.round(m.price).toLocaleString('ko-KR') + '원대 지지라인 재구축';
        return '<li>' + label + ' <span class="ob-milestone-time">' + fmtElapsed(m.t) + '</span></li>';
      }).join('') + '</ul>';
  }

  function showMilestoneToast(container, price, up) {
    var toast = container.querySelector('#obToast');
    if (!toast) return;
    toast.textContent = up
      ? '🎉 ' + Math.round(price).toLocaleString('ko-KR') + '원 돌파!'
      : '🔄 ' + Math.round(price).toLocaleString('ko-KR') + '원대 지지라인 재구축';
    toast.className = 'ob-toast show';
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      toast.className = 'ob-toast';
    }, TOAST_MS);
  }

  // ---- 체결강도(근사치) - 추적 중인 매도벽이 최근 한 틱 사이 얼마나 줄었는지로 추정 ----
  function computeExecutionStrength() {
    if (!state.trackedWall || state.history.length < 2) return null;
    var wall = state.trackedWall;
    var latest = state.history[state.history.length - 1];
    var prev = state.history[state.history.length - 2];
    var prevLevel = (prev.asks || []).filter(function (r) { return r.price === wall.price; })[0];
    if (!prevLevel) return null; // 직전 틱에도 벽이 있어야 변화량을 잴 수 있음
    var latestLevel = (latest.asks || []).filter(function (r) { return r.price === wall.price; })[0];
    var currQty = latestLevel ? latestLevel.qty : 0; // 사다리에서 사라졌으면 완전 소진으로 간주
    var depleted = prevLevel.qty - currQty; // 양수=소진(체결 추정), 음수=오히려 더 쌓임
    var pctOfPeak = wall.peakQty > 0 ? (depleted / wall.peakQty) * 100 : 0;
    var score = Math.max(0, Math.min(100, Math.round(pctOfPeak * STRENGTH_SCALE)));
    return { score: score, growing: depleted < 0 };
  }

  function resetHud(container) {
    ['#obResistBar', '#obSupportBar', '#obStrengthBar'].forEach(function (sel) {
      var el = container.querySelector(sel);
      if (el) el.style.width = '0%';
    });
    ['#obResistVal', '#obSupportVal', '#obStrengthVal'].forEach(function (sel) {
      var el = container.querySelector(sel);
      if (el) el.textContent = '-';
    });
    var note = container.querySelector('#obHudNote');
    if (note) note.textContent = '종목을 선택하면 실시간으로 계산됩니다.';
    var breakoutNote = container.querySelector('#obBreakoutNote');
    if (breakoutNote) breakoutNote.textContent = '';
  }

  // 2026-07-28: "체결량이 얼마 정도면 뚫을 수 있는지"(사용자 요청) - 추적 중인 매도벽이
  // checkWallBreakthrough의 판정 기준(WALL_BREAK_RATIO, 최초 확인한 잔량의 15% 이하)
  // 밑으로 줄면 "돌파"로 잡으므로, 그 임계치까지 남은 잔량을 그대로 역산해서 보여준다.
  // 실제 체결량과의 대응은 근사치(체결강도와 동일한 한계 - 2초 폴링 스냅샷 비교라
  // 그 사이 체결은 누락될 수 있음).
  function updateBreakoutNote(container, book, quote) {
    var el = container.querySelector('#obBreakoutNote');
    if (!el) return;
    var wall = state.trackedWall;
    if (!wall) { el.textContent = ''; return; }
    var level = (book.asks || []).filter(function (r) { return r.price === wall.price; })[0];
    var currQty = level ? level.qty : 0;
    var breakThreshold = Math.max(1, Math.ceil(wall.peakQty * WALL_BREAK_RATIO));
    var remaining = currQty - breakThreshold;
    var up = isUpCandle(quote);
    var priceLabel = Math.round(wall.price).toLocaleString('ko-KR');
    if (remaining <= 0) {
      el.textContent = up
        ? '🎯 ' + priceLabel + '원 매도벽, 곧 돌파 판정 예정'
        : '🛡️ ' + priceLabel + '원대 지지라인 방어중, 곧 재구축 신호 예정';
    } else if (up) {
      el.textContent = '🎯 ' + priceLabel + '원 매도벽 - 앞으로 약 '
        + fmtQty(remaining) + '주 더 소진되면 돌파로 판정돼요(근사치).';
    } else {
      el.textContent = '🛡️ ' + priceLabel + '원대 지지라인 방어중 - 앞으로 약 '
        + fmtQty(remaining) + '주 더 소진되면 재구축 신호로 바뀌어요(근사치).';
    }
  }

  // 저항(매도벽)/지지(매수벽) 강도는 "위쪽 매도벽과 아래쪽 매수벽의 높이 차이"(사용자 요청)를
  // 그대로 숫자화 - 각 방향에서 가장 큰 단일 호가 잔량을 서로 비교해 막대 길이로 보여준다.
  function updateHud(container, book, strength, quote) {
    var maxAsk = 0, maxBid = 0;
    (book.asks || []).forEach(function (r) { if (r.qty > maxAsk) maxAsk = r.qty; });
    (book.bids || []).forEach(function (r) { if (r.qty > maxBid) maxBid = r.qty; });
    var barMax = Math.max(maxAsk, maxBid) || 1;

    var resistBar = container.querySelector('#obResistBar');
    var supportBar = container.querySelector('#obSupportBar');
    var resistVal = container.querySelector('#obResistVal');
    var supportVal = container.querySelector('#obSupportVal');
    if (resistBar) resistBar.style.width = (maxAsk / barMax * 100) + '%';
    if (supportBar) supportBar.style.width = (maxBid / barMax * 100) + '%';
    if (resistVal) resistVal.textContent = fmtQty(maxAsk);
    if (supportVal) supportVal.textContent = fmtQty(maxBid);

    var strengthBar = container.querySelector('#obStrengthBar');
    var strengthVal = container.querySelector('#obStrengthVal');
    var score = strength ? strength.score : 0;
    if (strengthBar) strengthBar.style.width = score + '%';
    if (strengthVal) strengthVal.textContent = strength ? score : '-';

    var note = container.querySelector('#obHudNote');
    if (note) {
      if (maxAsk === 0 && maxBid === 0) {
        note.textContent = '종목을 선택하면 실시간으로 계산됩니다.';
      } else if (maxAsk > maxBid * 1.3) {
        note.textContent = '저항(매도벽)이 지지보다 두꺼워요 - 위로 뚫기 쉽지 않을 수 있어요.';
      } else if (maxBid > maxAsk * 1.3) {
        note.textContent = '지지(매수벽)가 저항보다 두꺼워요 - 아래쪽 방어가 튼튼해 보여요.';
      } else {
        note.textContent = '저항과 지지가 팽팽해요.';
      }
      // 2026-07-28: "매도벽을 미는 중"이라는 문구가 급락 중에도 뜨는 게 이상하다는 지적으로
      // 캔들 방향에 따라 어휘를 분기(위 checkWallBreakthrough 주석 참고 - 감지 로직은 동일,
      // 표현만 다르게).
      if (strength) {
        var up = isUpCandle(quote);
        if (strength.growing) note.textContent += ' 체결강도: 매도벽이 오히려 두꺼워지는 중.';
        else if (score >= 70) note.textContent += up ? ' 체결강도: 🔥 매도벽을 강하게 미는 중.' : ' 체결강도: 🔥 지지라인이 강하게 흔들리는 중.';
        else if (score >= 30) note.textContent += up ? ' 체결강도: 매도벽을 서서히 미는 중.' : ' 체결강도: 지지라인이 서서히 흔들리는 중.';
      }
    }
  }

  function fetchOrderBook(code) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(VM_ORDER_BOOK_URL + encodeURIComponent(code), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('order-book API 오류: ' + r.status);
        return r.json();
      })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        return json.data || null;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function fetchQuote(code) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(GAS_TICKER_URL + '?codes=' + encodeURIComponent(code), hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return (data && data[0]) || null;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  // ---- 렌더링 ----

  function renderBoard(container, book, quote) {
    var board = container.querySelector('#obBoard');
    if (!book || (!book.asks.length && !book.bids.length)) {
      board.innerHTML = '<div class="ob-hint">호가 정보가 없는 종목이거나 장 운영시간이 아니에요.</div>';
      return;
    }

    var maxQty = 0;
    book.asks.forEach(function (r) { if (r.qty > maxQty) maxQty = r.qty; });
    book.bids.forEach(function (r) { if (r.qty > maxQty) maxQty = r.qty; });
    if (!maxQty) maxQty = 1;

    var priceCls = quote ? signClass(quote.changeRate) : '';
    var priceNum = quote ? Number(quote.price).toLocaleString('ko-KR') + '원' : '-';
    var changeText = quote
      ? (quote.changeRate >= 0 ? '+' : '') + quote.changeRate.toFixed(2) + '% (' + (quote.change >= 0 ? '+' : '') + Number(quote.change).toLocaleString('ko-KR') + '원)'
      : '';

    var headerHtml = '<div class="ob-header">'
      + stockIconHtml(state.code)
      + '<span class="ob-header-name">' + escapeHtml(state.name) + '</span>'
      + '<span class="ob-header-code">(' + escapeHtml(state.code) + ')</span>'
      + '<span class="ob-header-price ' + priceCls + '">' + priceNum + '</span>'
      + (changeText ? '<span class="ob-header-change ' + priceCls + '">' + changeText + '</span>' : '')
      + '</div>';

    var askRows = book.asks.map(function (r) { return rowHtml(r, maxQty, 'ask'); }).join('');
    var bidRows = book.bids.map(function (r) { return rowHtml(r, maxQty, 'bid'); }).join('');

    var totalAsk = book.totalAskQty || 0;
    var totalBid = book.totalBidQty || 0;
    var totalSum = totalAsk + totalBid || 1;
    var askPct = (totalAsk / totalSum * 100).toFixed(1);
    var bidPct = (totalBid / totalSum * 100).toFixed(1);

    var footerHtml = '<div class="ob-footer">'
      + '<div class="ob-footer-label">총잔량 <span class="ob-ask-text">매도 ' + fmtQty(totalAsk) + '</span> · <span class="ob-bid-text">매수 ' + fmtQty(totalBid) + '</span></div>'
      + '<div class="ob-footer-bar"><span class="ob-footer-bar-ask" style="width:' + askPct + '%"></span><span class="ob-footer-bar-bid" style="width:' + bidPct + '%"></span></div>'
      + '</div>';

    board.innerHTML = headerHtml
      + '<div class="ob-table">' + askRows + '<div class="ob-current-row ' + priceCls + '">' + priceNum + (changeText ? ' <span class="ob-current-change">' + changeText + '</span>' : '') + '</div>' + bidRows + '</div>'
      + footerHtml
      + buildTradesHtml();
  }

  function fmtTime(tm) {
    var s = String(tm == null ? '' : tm).replace(/[^0-9]/g, '');
    if (s.length < 6) return '-';
    return s.slice(0, 2) + ':' + s.slice(2, 4) + ':' + s.slice(4, 6);
  }

  // 최근 체결 리스트(시간/체결가/체결량) - 2초 폴링으로 누적한 근사치라는 걸 범례에 명시.
  function buildTradesHtml() {
    if (!state.trades.length) return '';
    var rows = state.trades.map(function (t) {
      var cls = t.up ? 'ob-up' : (t.down ? 'ob-down' : 'ob-flat');
      var arrow = t.up ? '▲' : (t.down ? '▼' : '-');
      return '<div class="ob-trade-row">'
        + '<span class="ob-trade-time">' + fmtTime(t.time) + '</span>'
        + '<span class="ob-trade-price ' + cls + '">' + Math.round(t.price).toLocaleString('ko-KR') + ' ' + arrow + '</span>'
        + '<span class="ob-trade-qty ' + cls + '">' + fmtQty(t.qty) + '</span>'
        + '</div>';
    }).join('');
    return '<div class="ob-trades">'
      + '<div class="ob-trades-title">최근 체결 <span class="ob-trades-note">(2초 간격 폴링 기준 근사치, 그 사이 체결은 생략될 수 있음)</span></div>'
      + '<div class="ob-trades-header"><span>시간</span><span>체결가</span><span>체결량</span></div>'
      + '<div class="ob-trades-list">' + rows + '</div>'
      + '</div>';
  }

  function rowHtml(row, maxQty, side) {
    var pct = Math.max(2, Math.round(row.qty / maxQty * 100));
    var barCls = side === 'ask' ? 'ob-bar-ask' : 'ob-bar-bid';
    var textCls = side === 'ask' ? 'ob-ask-text' : 'ob-bid-text';
    return '<div class="ob-row ob-row-' + side + '">'
      + '<span class="ob-qty ' + textCls + '">' + fmtQty(row.qty) + '</span>'
      + '<span class="ob-bar-wrap"><span class="' + barCls + '" style="width:' + pct + '%"></span></span>'
      + '<span class="ob-price ' + textCls + '">' + Math.round(row.price).toLocaleString('ko-KR') + '</span>'
      + '</div>';
  }

  function fmtQty(v) {
    if (v == null || isNaN(v)) return '-';
    return Math.round(v).toLocaleString('ko-KR');
  }

  function signClass(rate) {
    if (rate > 0) return 'ob-up';
    if (rate < 0) return 'ob-down';
    return 'ob-flat';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  var OrderBook = { init: init, fetchOrderBook: fetchOrderBook, fetchQuote: fetchQuote, select: selectStock };
  global.OrderBook = OrderBook;

  // init(selector)에 selector 인자가 추가된 뒤로 addEventListener가 콜백에 넘기는
  // Event 객체를 selector로 오인하는 버그가 생겨(실측 발견) 인자 없는 래퍼로 감쌌다.
  function autoInit() { init(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
