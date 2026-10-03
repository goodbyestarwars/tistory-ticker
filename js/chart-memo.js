/**
 * 차트 메모 공용 모듈(2026-10-03). 종목분석(foreign-flow.js)에서 지연 로드해 쓴다.
 * 실시간 검색(stock-search.js)에는 같은 내용이 내장돼 있다 - 저장소 키(`ss_chart_memos_v1`)와
 * 서버 배열(`/memo`)은 공유하므로 어느 차트에서 달아도 같은 메모가 보인다.
 * 사용: NineChartMemo.install({ container, chart, series, bars:[{date}], code, name, formatPrice, isDrawing })
 *       -> { setMode(on), isMode(), dispose() }
 */
(function (global) {
  'use strict';
  var memoDrawingProbe = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- 차트 메모 (2026-10-03 사용자 요청: "로그인 안 하면 브라우저에, 로그인하면 DB에") ----
  // 차트의 봉을 눌러 그 날짜·가격에 메모를 단다. 핀으로 표시되고 누르면 내용·삭제가 보인다.
  // 저장: 로그인(Google)하면 계정의 메모 배열(`GET/PUT /memo`, 사이트 전역 메모와 같은 데이터)에,
  // 아니면 이 브라우저(localStorage)에 둔다. 로그인하면 브라우저에 있던 차트 메모를 계정으로 한 번 옮긴다.
  // 메모는 텍스트라 용량이 작다(종목당 30개 상한, 메모당 500자).
  var CHART_MEMO_URL = 'https://goodbyestar.cloud/memo';
  var CHART_MEMO_AUTH_URL = 'https://goodbyestar.cloud/auth/google/me';
  var CHART_MEMO_LOCAL_KEY = 'ss_chart_memos_v1';
  var CHART_MEMO_MAX_PER_CODE = 30;
  var CHART_MEMO_MAX_BODY = 500;
  var CHART_MEMO_MAX_TOTAL = 200;
  var chartMemoStore = { auth: null, items: [], revision: 0, loadPromise: null };
  var chartMemoCtl = null;

  function chartMemoReadLocal() {
    try {
      var saved = JSON.parse(global.localStorage.getItem(CHART_MEMO_LOCAL_KEY) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch (e) { return []; }
  }

  function chartMemoWriteLocal(items) {
    try {
      if (items.length) global.localStorage.setItem(CHART_MEMO_LOCAL_KEY, JSON.stringify(items));
      else global.localStorage.removeItem(CHART_MEMO_LOCAL_KEY);
    } catch (e) { /* 저장소가 막혀도 화면은 동작 */ }
  }

  function chartMemoPut(items) {
    return fetch(CHART_MEMO_URL, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items, revision: chartMemoStore.revision })
    }).then(function (response) {
      if (response.status === 409) throw new Error('CONFLICT');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (body) {
      var data = body && body.data ? body.data : body;
      chartMemoStore.items = data.items || items;
      chartMemoStore.revision = data.revision || chartMemoStore.revision;
      return chartMemoStore;
    });
  }

  function chartMemoLoad(force) {
    if (chartMemoStore.loadPromise && !force) return chartMemoStore.loadPromise;
    chartMemoStore.loadPromise = fetch(CHART_MEMO_AUTH_URL, { credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        var auth = body && body.data ? body.data : {};
        chartMemoStore.auth = !!(auth.configured && auth.authenticated);
        if (!chartMemoStore.auth) {
          chartMemoStore.items = chartMemoReadLocal();
          chartMemoStore.revision = 0;
          return chartMemoStore;
        }
        return fetch(CHART_MEMO_URL, { credentials: 'include', cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (res) {
            var data = res && res.data ? res.data : res;
            chartMemoStore.items = data.items || [];
            chartMemoStore.revision = data.revision || 0;
            // 로그인 전에 이 브라우저에 달아 둔 차트 메모를 계정으로 한 번 옮긴다.
            var local = chartMemoReadLocal();
            if (!local.length) return chartMemoStore;
            var have = {};
            chartMemoStore.items.forEach(function (item) { have[item.id] = true; });
            var merged = chartMemoStore.items.concat(local.filter(function (item) { return !have[item.id]; })).slice(0, CHART_MEMO_MAX_TOTAL);
            return chartMemoPut(merged).then(function () { chartMemoWriteLocal([]); return chartMemoStore; })
              .catch(function () { return chartMemoStore; });
          });
      })
      .catch(function () {
        chartMemoStore.auth = false;
        chartMemoStore.items = chartMemoReadLocal();
        return chartMemoStore;
      });
    return chartMemoStore.loadPromise;
  }

  // fn(items) -> 새 배열. 로그인 상태에서 다른 기기가 먼저 바꿨으면(409) 다시 받아 한 번 더 적용한다.
  function chartMemoMutate(fn) {
    return chartMemoLoad().then(function (store) {
      var next = fn(store.items.slice());
      if (!store.auth) {
        store.items = next;
        chartMemoWriteLocal(next);
        return store;
      }
      return chartMemoPut(next).catch(function (err) {
        if (err.message !== 'CONFLICT') throw err;
        return chartMemoLoad(true).then(function (fresh) { return chartMemoPut(fn(fresh.items.slice())); });
      });
    });
  }

  function chartMemoTimeKey(time) {
    if (time && typeof time === 'object' && time.year) {
      return time.year + '-' + String(time.month).padStart(2, '0') + '-' + String(time.day).padStart(2, '0');
    }
    return time == null ? '' : String(time);
  }

  function chartMemoCodeKey(code) { return String(code || '').toUpperCase(); }

  function installChartMemoLayer(container, chart, candleSeries, bars, timeframe, code, name, formatPrice) {
    var key = chartMemoCodeKey(code);
    if (!key) return function () {};
    var layer = document.createElement('div');
    layer.className = 'ss-memo-layer';
    container.appendChild(layer);
    var mode = false;
    var popup = null;
    var frameId = 0;
    var resizeObserver = null;
    var disposed = false;

    function closePopup() { if (popup) { popup.remove(); popup = null; } }
    function barFor(dateKey) {
      var found = null;
      for (var i = 0; i < bars.length; i++) {
        if (String(bars[i].date) <= dateKey) found = bars[i]; else break;
      }
      return found;
    }
    function itemsHere() {
      return chartMemoStore.items.filter(function (it) { return chartMemoCodeKey(it.code) === key && it.date && isFinite(Number(it.price)); });
    }
    function placePopup(x, y) {
      if (!popup) return;
      var w = container.clientWidth;
      var h = container.clientHeight;
      var pw = popup.offsetWidth || 260;
      var ph = popup.offsetHeight || 170;
      popup.style.left = Math.max(6, Math.min(x - pw / 2, w - pw - 6)) + 'px';
      popup.style.top = Math.max(6, Math.min(y + 14, h - ph - 6)) + 'px';
    }
    function storageNote() {
      return chartMemoStore.auth ? '로그인 계정에 저장되어 다른 기기에서도 보입니다.' : '이 브라우저에만 저장됩니다. 로그인하면 계정에 저장됩니다.';
    }
    function openEditor(dateKey, price, x, y) {
      closePopup();
      var count = itemsHere().length;
      popup = document.createElement('div');
      popup.className = 'ss-memo-pop';
      popup.innerHTML = '<div class="ss-memo-pop-head"><strong>' + escapeHtml(dateKey) + '</strong><span>' + escapeHtml(formatPrice(price)) + '</span></div>'
        + '<textarea maxlength="' + CHART_MEMO_MAX_BODY + '" placeholder="이 자리에 남길 메모 (예: 지지 확인 후 분할 진입)" aria-label="차트 메모"></textarea>'
        + '<small class="ss-memo-pop-note">' + storageNote() + '</small>'
        + '<div class="ss-memo-pop-actions"><button type="button" data-memo-cancel>취소</button><button type="button" data-memo-save>저장</button></div>';
      layer.appendChild(popup);
      placePopup(x, y);
      var text = popup.querySelector('textarea');
      var note = popup.querySelector('.ss-memo-pop-note');
      text.focus();
      popup.querySelector('[data-memo-cancel]').addEventListener('click', closePopup);
      popup.querySelector('[data-memo-save]').addEventListener('click', function () {
        var body = text.value.trim();
        if (!body) { note.textContent = '메모 내용을 입력하세요.'; return; }
        if (count >= CHART_MEMO_MAX_PER_CODE) { note.textContent = '한 종목에는 메모를 ' + CHART_MEMO_MAX_PER_CODE + '개까지 달 수 있어요.'; return; }
        var nowIso = new Date().toISOString();
        var item = { id: 'cm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), code: key, name: name || key, body: body,
          date: dateKey, price: price, createdAt: nowIso, updatedAt: nowIso };
        note.textContent = '저장 중...';
        chartMemoMutate(function (items) { return items.concat([item]); }).then(function () {
          closePopup();
          scheduleDraw();
        }).catch(function () { note.textContent = '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'; });
      });
    }
    function openViewer(item, x, y) {
      closePopup();
      popup = document.createElement('div');
      popup.className = 'ss-memo-pop';
      popup.innerHTML = '<div class="ss-memo-pop-head"><strong>' + escapeHtml(item.date) + '</strong><span>' + escapeHtml(formatPrice(item.price)) + '</span></div>'
        + '<p class="ss-memo-pop-body">' + escapeHtml(item.body) + '</p>'
        + '<div class="ss-memo-pop-actions"><button type="button" data-memo-close>닫기</button><button type="button" data-memo-delete>삭제</button></div>';
      layer.appendChild(popup);
      placePopup(x, y);
      popup.querySelector('[data-memo-close]').addEventListener('click', closePopup);
      popup.querySelector('[data-memo-delete]').addEventListener('click', function () {
        chartMemoMutate(function (items) { return items.filter(function (it) { return it.id !== item.id; }); }).then(function () {
          closePopup();
          scheduleDraw();
        }).catch(function () { /* 다음 시도 때 다시 */ });
      });
    }
    function draw() {
      frameId = 0;
      if (disposed || !document.body.contains(container)) return;
      layer.querySelectorAll('.ss-memo-pin').forEach(function (pin) { pin.remove(); });
      itemsHere().forEach(function (item) {
        var bar = barFor(String(item.date));
        if (!bar) return;
        var x = chart.timeScale().timeToCoordinate(bar.date);
        var y = candleSeries.priceToCoordinate(Number(item.price));
        if (![x, y].every(Number.isFinite)) return;
        if (x < 0 || x > container.clientWidth || y < 0 || y > container.clientHeight) return;
        var pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'ss-memo-pin';
        pin.style.left = x + 'px';
        pin.style.top = y + 'px';
        pin.title = item.date + ' · ' + item.body;
        pin.setAttribute('aria-label', '차트 메모 보기');
        pin.textContent = '✎';
        pin.addEventListener('click', function (event) { event.stopPropagation(); openViewer(item, x, y); });
        layer.appendChild(pin);
      });
    }
    function scheduleDraw() {
      if (frameId) global.clearTimeout(frameId);
      frameId = global.setTimeout(draw, 16);
    }
    // 모바일 터치에서는 차트 라이브러리의 click 이벤트가 안정적이지 않아, 컨테이너의 포인터 탭(이동 8px 미만)으로 직접 받는다.
    var downAt = null;
    function onDown(event) {
      downAt = mode ? { x: event.clientX, y: event.clientY, t: Date.now() } : null;
    }
    function onUp(event) {
      var start = downAt;
      downAt = null;
      if (!mode || !start) return;
      if (Math.abs(event.clientX - start.x) > 8 || Math.abs(event.clientY - start.y) > 8 || Date.now() - start.t > 700) return;
      if (event.target.closest && event.target.closest('.ss-memo-pin, .ss-memo-pop')) return;
      if (memoDrawingProbe && memoDrawingProbe()) return;
      var box = container.getBoundingClientRect();
      var px = event.clientX - box.left;
      var py = event.clientY - box.top;
      var time = chart.timeScale().coordinateToTime(px);
      var price = candleSeries.coordinateToPrice(py);
      if (time == null || !Number.isFinite(price) || price <= 0) return;
      openEditor(chartMemoTimeKey(time), Math.round(price * 100) / 100, px, py);
    }
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointerup', onUp);
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleDraw);
    if ('ResizeObserver' in global) {
      resizeObserver = new ResizeObserver(scheduleDraw);
      resizeObserver.observe(container);
    } else {
      global.addEventListener('resize', scheduleDraw);
    }
    chartMemoLoad().then(scheduleDraw);
    var settle = global.setTimeout(scheduleDraw, 300);

    chartMemoCtl = {
      setMode: function (on) {
        mode = !!on;
        container.classList.toggle('is-memo-mode', mode);
        if (!mode) closePopup();
      },
      isMode: function () { return mode; }
    };
    return function () {
      disposed = true;
      if (frameId) global.cancelAnimationFrame(frameId);
      global.clearTimeout(settle);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerup', onUp);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleDraw); } catch (e) { /* 이미 제거 */ }
      if (resizeObserver) resizeObserver.disconnect();
      else global.removeEventListener('resize', scheduleDraw);
      container.classList.remove('is-memo-mode');
      layer.remove();
      chartMemoCtl = null;
    };
  }

  function ensureStyles() {
    if (document.getElementById('chartMemoCss')) return;
    var link = document.createElement('link');
    link.id = 'chartMemoCss';
    link.rel = 'stylesheet';
    link.href = 'https://goodbyestarwars.github.io/tistory-ticker/css/chart-memo.css';
    document.head.appendChild(link);
  }

  global.NineChartMemo = {
    install: function (o) {
      ensureStyles();
      try { if (global.getComputedStyle(o.container).position === 'static') o.container.style.position = 'relative'; } catch (e) { /* 무시 */ }
      memoDrawingProbe = o.isDrawing || null;
      var dispose = installChartMemoLayer(o.container, o.chart, o.series, o.bars, 'day', o.code, o.name, o.formatPrice);
      var ctl = chartMemoCtl;
      return {
        setMode: function (on) { if (ctl) ctl.setMode(on); },
        isMode: function () { return !!(ctl && ctl.isMode()); },
        dispose: function () { dispose(); }
      };
    }
  };
})(window);
