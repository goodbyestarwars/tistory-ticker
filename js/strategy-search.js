/**
 * 전략검색 위젯
 *
 * 카테고리(전략)를 탭으로 여러 개 보여주는 틀 - 지금은 "저평가 종목" 1개뿐이지만 계속
 * 추가될 예정이라 탭 구조를 유지한다(2026-08 사용자 피드백: "전략검색은 냅두고 10개를
 * 1개로 줄이는 거였지, 페이지 자체를 저평가 종목으로 박아버리라는 게 아니었다").
 * scripts/cloud-vm/strategy_scan.py가 내려주는 categories(카테고리id -> {name,
 * methodology, sectors}) 그대로 탭 목록을 만든다 - 서버 쪽 카테고리가 늘거나 줄어도 이
 * 파일을 고칠 필요가 없다(js/pattern-scan.js와 동일한 설계 원칙).
 *
 * "저평가 종목" 카테고리의 판정 기준(품질 게이트: 펀더멘탈 점수, 가격 게이트: 120일 이평
 * 대비 이격도)은 strategy_scan.py 참고. 결과는 WICS 대분류 섹터별로 묶여 오므로, 카테고리
 * 안에서는 js/sector-dashboard-v4.js·js/market-temp.js의 카드보기와 같은 시각 언어
 * (섹터 = 카드, 종목 = 행)로 보여준다(2026-08 UI 피드백 "증시온도 카드보기 그대로 가져다
 * 써"). 다른 모양의 결과를 내는 카테고리가 나중에 추가되면 renderCategoryBody를 그
 * 카테고리 타입에 맞게 분기해야 한다 - 지금은 섹터 그룹 하나뿐이라 분기 없음.
 *
 * 리스트는 VM(strategy_scan.py)이 하루 1회 미리 스캔해둔 결과(?strategyScan=1)를 그대로
 * 보여준다(가벼움) - js/pattern-scan.js와 동일한 패턴.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#strategy-search';
  var FETCH_TIMEOUT_MS = 15000;
  // 종목분석 상세 페이지 - js/stock-search-panel.js·js/watchlist.js와 동일한 이동 방식
  // (?code=&name=). 펀더멘탈(PER·PBR·DART 재무)·차트·수급을 바로 확인할 수 있어 "왜 이
  // 종목이 뽑혔는지" 근거를 확인하기 가장 가까운 기존 페이지다.
  var STOCK_DETAIL_PAGE = '/page/foreign-flow';

  var scanData = null;
  var activeKey = null;
  var activeEtfPeriod = '1m';
  var activeDividendSort = 'yield';
  var etfSearchQuery = '';
  var ETF_RETURN_PERIODS = [
    { key: '1m', label: '1개월' },
    { key: '3m', label: '3개월' },
    { key: '6m', label: '6개월' },
    { key: '12m', label: '12개월' }
  ];
  // ETF 상품명 앞의 브랜드를 운용사별 대표 라벨로 사용한다. 화면 순서는 KODEX(삼성자산운용)를
  // 시작으로 국내 ETF 시장에서 통상 알려진 운용사 순자산 규모 순서를 따른다(2026-08-13 사용자
  // 요청 - "보통 KODEX부터 하지 않아? 운용사 순위로"). 이 저장소가 실시간 AUM 데이터를 갖고
  // 있지 않아 매체에 흔히 인용되는 통념상 순위이며, 매 순간의 실제 순자산 순위와는 다를 수
  // 있다(자동 갱신 아님, 필요 시 사람이 다시 정렬). RISE/KBSTAR, PLUS/ARIRANG은 같은
  // 운용사(각각 KB자산운용, 한화자산운용)의 리브랜딩 전후 이름이라 순위상 나란히 둔다.
  var ETF_ISSUER_GROUPS = [
    { key: 'KODEX', label: 'KODEX' },       // 삼성자산운용
    { key: 'TIGER', label: 'TIGER' },       // 미래에셋자산운용
    { key: 'RISE', label: 'RISE' },         // KB자산운용(구 KBSTAR)
    { key: 'KBSTAR', label: 'KBSTAR' },
    { key: 'ACE', label: 'ACE' },           // 한국투자신탁운용
    { key: 'PLUS', label: 'PLUS' },         // 한화자산운용(구 ARIRANG)
    { key: 'ARIRANG', label: 'ARIRANG' },
    { key: 'SOL', label: 'SOL' },           // 신한자산운용
    { key: 'HANARO', label: 'HANARO' },     // NH-Amundi자산운용
    { key: 'KOSEF', label: 'KOSEF' },       // 키움투자자산운용
    { key: 'TIMEFOLIO', label: 'TIMEFOLIO' },
    { key: '1Q', label: '1Q' },
    { key: 'FOCUS', label: 'FOCUS' }
  ];
  var ETF_LIST_PAGE_SIZE = 10;
  var expandedEtfGroups = {}; // 운용사 카드명 -> true(더보기로 전체 펼친 상태)

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    container.innerHTML = '<div class="ss-hint">불러오는 중...</div>';
    loadScan(container);
  }

  function loadScan(container) {
    StrategySearch.fetchJson(GAS_TICKER_URL + '?strategyScan=1')
      .then(function (data) {
        scanData = normalizeScanData(data);
        var keys = Object.keys((data && data.categories) || {});
        if (!keys.length) {
          container.innerHTML = '<div class="ss-error">아직 스캔 결과가 없어요. (VM에서 strategy_scan.py가 한 번 실행돼야 함)</div>';
          return;
        }
        if (!activeKey || keys.indexOf(activeKey) === -1) activeKey = keys[0];
        container.innerHTML = buildShell();
        wireContainer(container);
        renderAll(container);
      })
      .catch(function () {
        container.innerHTML = '<div class="ss-error">스캔 결과를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
      });
  }

  // Older VM/GAS caches still contain four separate etf_1m/3m/6m/12m
  // categories. Merge them on the client so the UI remains correct until the
  // next strategy scan has written the new combined schema.
  function normalizeScanData(data) {
    data = data || {};
    data.categories = data.categories || {};
    var periods = ['1m', '3m', '6m', '12m'];
    if (data.categories.etfReturn) {
      periods.forEach(function (period) { delete data.categories['etf_' + period]; });
      return data;
    }

    var merged = {};
    periods.forEach(function (period) {
      var category = data.categories['etf_' + period];
      if (!category || !category.sectors) return;
      Object.keys(category.sectors).forEach(function (sector) {
        var group = category.sectors[sector] || {};
        (group.matches || []).forEach(function (row) {
          var key = row.code || row.name;
          if (!key) return;
          if (!merged[key]) {
            merged[key] = {};
            Object.keys(row).forEach(function (field) { merged[key][field] = row[field]; });
          }
          merged[key]['returnRate' + period + 'Pct'] = row.returnRatePct;
          merged[key]['return' + period.toUpperCase() + 'Label'] = period;
        });
      });
    });

    if (Object.keys(merged).length) {
      var rows = Object.keys(merged).map(function (key) { return merged[key]; });
      rows.sort(function (a, b) {
        var ar = a.returnRate1mPct == null ? -Infinity : Number(a.returnRate1mPct);
        var br = b.returnRate1mPct == null ? -Infinity : Number(b.returnRate1mPct);
        return br - ar;
      });
      data.categories.etfReturn = {
        name: 'ETF 수익률 상위',
        methodology: '1개월 누적수익률 기준 상위 ETF이며, 각 종목의 1개월·3개월·6개월·12개월 누적수익률을 함께 표시합니다.',
        sectors: { ETF: { name: 'ETF', matches: rows } }
      };
      periods.forEach(function (period) { delete data.categories['etf_' + period]; });
    }
    return data;
  }

  function buildShell() {
    return ''
      + '<div class="ss-head">'
      + '<div class="ss-tabs" id="ssTabs"></div>'
      + '<div class="ss-meta" id="ssMeta"></div>'
      + '</div>'
      + '<div class="ss-methodology" id="ssMethodology"></div>'
      + '<div id="ssCards"></div>';
  }

  function categoryKeys() {
    return Object.keys(scanData.categories);
  }

  function renderAll(container) {
    renderTabs(container);
    renderMeta(container);
    renderMethodology(container);
    renderCards(container);
  }

  function renderTabs(container) {
    var tabsEl = container.querySelector('#ssTabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = categoryKeys().map(function (key) {
      var c = scanData.categories[key];
      return '<button type="button" class="ss-tab' + (key === activeKey ? ' active' : '') + '" data-key="' + key + '">'
        + escapeHtml((c && c.name) || key) + '</button>';
    }).join('');
  }

  // 탭 전환 클릭과 종목 행 클릭(종목분석 이동)을 컨테이너 하나에 위임한다 - renderCards()가
  // 매번 innerHTML을 새로 그려도 이 리스너는 컨테이너 자체에 붙어있어 재등록할 필요가 없다.
  function wireContainer(container) {
    // ETF 검색창은 renderCards()가 매 입력마다 innerHTML을 통째로 다시 그려서, 그냥
    // 두면 입력창 자체가 새 DOM으로 교체돼 포커스·커서 위치가 날아간다 - 입력 직후
    // 커서 위치를 기억해뒀다가 재렌더링 후 같은 자리에 되돌려준다.
    function applyEtfSearch(searchInput) {
      etfSearchQuery = searchInput.value;
      var cursor = searchInput.selectionStart;
      renderCards(container);
      var nextInput = container.querySelector('.ss-etf-search-input');
      if (nextInput) {
        nextInput.focus();
        try { nextInput.setSelectionRange(cursor, cursor); } catch (e) { /* 일부 입력 타입은 미지원 */ }
      }
    }
    // 한글 등 조합형 입력(IME)은 자모를 하나씩 합쳐 완성되는데, 조합이 끝나기 전
    // (compositionend 전)에 DOM을 다시 그리면 브라우저가 조합 중이던 글자를 잃어버려
    // "헬스케어"가 "헤ㄹㅋ케ㅇㅓ"처럼 자모가 낱개로 흩어져 버린다(2026-08-14 사용자
    // 스크린샷 제보). input 이벤트의 isComposing으로 조합 중 여부를 확인해 조합이 끝난
    // 뒤에만 반영한다 - compositionend는 별도로 처리하지 않는다. compositionend
    // 직후 브라우저가 isComposing=false인 input 이벤트를 자동으로 한 번 더 보내주는데,
    // 처음에는 이걸 몰라서 compositionend에서도 한 번 더 반영했다가 글자 하나가
    // 완성될 때마다 재렌더링이 두 번 겹쳐 일어났고, 그 사이에 다음 키 입력이 오면
    // 글자가 씹히는 문제가 있었다(2026-08-14 사용자 재제보 - "한글 조합은 되는데
    // 중간에 글자를 먹네").
    container.addEventListener('input', function (event) {
      var searchInput = event.target.closest ? event.target.closest('.ss-etf-search-input') : null;
      if (!searchInput || event.isComposing) return;
      applyEtfSearch(searchInput);
    });
    container.addEventListener('click', function (event) {
      var tabBtn = event.target.closest ? event.target.closest('.ss-tab') : null;
      if (tabBtn) {
        var key = tabBtn.getAttribute('data-key');
        if (key === activeKey) return;
        activeKey = key;
        renderAll(container);
        return;
      }
      var periodBtn = event.target.closest ? event.target.closest('.ss-return-period-tab') : null;
      if (periodBtn) {
        var period = periodBtn.getAttribute('data-return-period');
        if (!period || period === activeEtfPeriod) return;
        activeEtfPeriod = period;
        renderCards(container);
        return;
      }
      var dividendSortBtn = event.target.closest ? event.target.closest('.ss-dividend-sort-btn') : null;
      if (dividendSortBtn) {
        var sort = dividendSortBtn.getAttribute('data-dividend-sort');
        if (!sort || sort === activeDividendSort) return;
        activeDividendSort = sort;
        renderCards(container);
        return;
      }
      var moreBtn = event.target.closest ? event.target.closest('.ss-card-more') : null;
      if (moreBtn) {
        var groupName = moreBtn.getAttribute('data-more-group');
        if (!groupName) return;
        expandedEtfGroups[groupName] = !expandedEtfGroups[groupName];
        renderCards(container);
        return;
      }
      var row = event.target.closest ? event.target.closest('.ss-row') : null;
      if (!row) return;
      var code = row.getAttribute('data-code');
      if (!code) return;
      var name = row.getAttribute('data-name') || code;
      // 2026-08-14 요청: ETF 수익률 상위에서 종목(=ETF)을 클릭하면 개별주식 종목분석
      // 대신 ETF가 실제로 어떤 종목을 얼마나 담고 있는지(구성종목·비중)를 보여준다.
      // 다른 카테고리(저평가 종목·배당주)는 기존처럼 종목분석으로 이동.
      if (activeKey === 'etfReturn') {
        openEtfComponentsModal(code, name);
        return;
      }
      global.location.href = STOCK_DETAIL_PAGE + '?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(name);
    });
  }

  function renderMeta(container) {
    var meta = container.querySelector('#ssMeta');
    if (!meta) return;
    if (!scanData || !scanData.scannedAt) {
      meta.textContent = '아직 스캔 결과가 없어요.';
      return;
    }
    var text = '스캔 ' + scanData.scannedAt + ' · 대상 ' + (scanData.scanned || 0) + '/' + (scanData.universe || 0) + '종목';
    if (scanData.skippedIlliquid) {
      text += ' · 유동성 부족 제외 ' + scanData.skippedIlliquid + '종목';
    }
    meta.textContent = text;
  }

  // 카테고리의 실제 판정 기준을 화면에 그대로 밝힌다(예: "저평가 종목"은 PER/PBR 없이
  // 근사한 값이라는 한계까지) - scripts/cloud-vm/strategy_scan.py가 이미 문장으로 채워
  // 보내주는 methodology를 그대로 옮기기만 한다(프론트에서 새로 요약·해석하지 않음).
  function renderMethodology(container) {
    var box = container.querySelector('#ssMethodology');
    if (!box) return;
    var cat = scanData.categories[activeKey];
    box.textContent = (cat && cat.methodology) || '';
  }

  function renderCards(container) {
    var wrap = container.querySelector('#ssCards');
    if (!wrap) return;
    var cat = scanData.categories[activeKey];
    var sectors = (cat && cat.sectors) || {};
    var sectorNames = Object.keys(sectors).filter(function (name) {
      return sectors[name] && sectors[name].matches && sectors[name].matches.length;
    });
    if (!sectorNames.length) {
      wrap.innerHTML = '<div class="ss-hint">지금은 이 카테고리 조건에 맞는 종목이 없어요.</div>';
      return;
    }
    var periodTabs = activeKey === 'etfReturn'
      ? '<div class="ss-return-period-tabs" role="tablist" aria-label="ETF 수익률 기간">'
        + ETF_RETURN_PERIODS.map(function (period) {
          return '<button type="button" class="ss-return-period-tab' + (period.key === activeEtfPeriod ? ' active' : '')
            + '" data-return-period="' + period.key + '" role="tab" aria-selected="' + (period.key === activeEtfPeriod ? 'true' : 'false') + '">'
            + period.label + '</button>';
        }).join('')
        + '<input type="search" class="ss-etf-search-input" placeholder="ETF명 또는 코드 검색" '
        + 'value="' + escapeAttr(etfSearchQuery) + '" aria-label="ETF 검색">'
        + '</div>'
      : '';
    var dividendTabs = activeKey === 'dividend'
      ? '<div class="ss-dividend-sort-tabs" role="tablist" aria-label="배당주 정렬">'
        + '<button type="button" class="ss-dividend-sort-btn' + (activeDividendSort === 'yield' ? ' active' : '') + '" data-dividend-sort="yield">수익률순</button>'
        + '<button type="button" class="ss-dividend-sort-btn' + (activeDividendSort === 'dps' ? ' active' : '') + '" data-dividend-sort="dps">배당금순</button>'
        + '</div>'
      : '';
    var cardGroups = [];
    var etfQuery = activeKey === 'etfReturn' ? etfSearchQuery.trim().toUpperCase() : '';
    if (activeKey === 'etfReturn') {
      var allEtfMatches = [];
      sectorNames.forEach(function (name) {
        allEtfMatches = allEtfMatches.concat(sectors[name].matches || []);
      });
      if (etfQuery) {
        allEtfMatches = allEtfMatches.filter(function (item) {
          var name = String(item.name || '').toUpperCase();
          var code = String(item.code || '').toUpperCase();
          return name.indexOf(etfQuery) !== -1 || code.indexOf(etfQuery) !== -1;
        });
      }
      cardGroups = groupEtfMatches(allEtfMatches);
    } else {
      cardGroups = sectorNames.map(function (name) {
        return { name: name, matches: sectors[name].matches };
      });
    }
    if (etfQuery && !cardGroups.length) {
      wrap.innerHTML = periodTabs + dividendTabs + '<div class="ss-hint">"' + escapeHtml(etfSearchQuery.trim()) + '"에 맞는 ETF가 없어요.</div>';
      return;
    }
    var html = cardGroups.map(function (group) {
      var matches = sortMatches(group.matches);
      // ETF 수익률 상위는 운용사별 카드가 많으면 한 카드에 종목이 수십 개까지 쌓여
      // 화면이 길어지므로, 상위 10개만 먼저 보여주고 "더보기"로 전체를 펼친다
      // (2026-08-13 사용자 요청). 다른 전략 카테고리는 기존처럼 전체를 그대로 보여준다.
      var isEtf = activeKey === 'etfReturn';
      var expanded = !isEtf || !!expandedEtfGroups[group.name];
      var visible = expanded ? matches : matches.slice(0, ETF_LIST_PAGE_SIZE);
      var rows = visible.map(rowHtml).join('');
      var moreBtn = (isEtf && matches.length > ETF_LIST_PAGE_SIZE)
        ? '<button type="button" class="ss-card-more" data-more-group="' + escapeAttr(group.name) + '">'
          + (expanded ? '접기 ▲' : '더보기 · 전체 ' + matches.length + '개 ▼') + '</button>'
        : '';
      return '<div class="ss-card">'
        + '<div class="ss-card-title">' + escapeHtml(group.name) + '</div>'
        + '<div class="ss-rows">' + rows + '</div>'
        + moreBtn
        + '</div>';
    }).join('');
    wrap.innerHTML = periodTabs + dividendTabs + '<div class="ss-cards-grid">' + html + '</div>';
  }

  function groupEtfMatches(matches) {
    var grouped = {};
    ETF_ISSUER_GROUPS.forEach(function (group) { grouped[group.key] = []; });
    grouped.other = [];
    (matches || []).forEach(function (item) {
      var name = String(item && item.name || '').trim().toUpperCase();
      var group = ETF_ISSUER_GROUPS.find(function (candidate) {
        return name.indexOf(candidate.key) === 0;
      });
      (group ? grouped[group.key] : grouped.other).push(item);
    });
    return ETF_ISSUER_GROUPS.map(function (group) {
      return { name: group.label, matches: grouped[group.key] };
    }).filter(function (group) {
      return group.matches.length;
    }).concat(grouped.other.length ? [{ name: '기타 ETF', matches: grouped.other }] : []);
  }

  function sortMatches(matches) {
    if (activeKey === 'dividend') {
      var dividendField = activeDividendSort === 'dps' ? 'cashDividendPerShare' : 'dividendYieldPct';
      return matches.slice().sort(function (a, b) {
        var ar = a[dividendField] == null ? -Infinity : Number(a[dividendField]);
        var br = b[dividendField] == null ? -Infinity : Number(b[dividendField]);
        if (br !== ar) return br - ar;
        return String(a.code || '').localeCompare(String(b.code || ''));
      });
    }
    if (activeKey !== 'etfReturn') return matches;
    var field = 'returnRate' + activeEtfPeriod + 'Pct';
    return matches.slice().sort(function (a, b) {
      var ar = a[field] == null ? -Infinity : Number(a[field]);
      var br = b[field] == null ? -Infinity : Number(b[field]);
      if (br !== ar) return br - ar;
      return String(a.code || '').localeCompare(String(b.code || ''));
    });
  }

  function rowHtml(it) {
    var cc = chgClass(it.changeRate);
    var metric = it.strategy === 'etfReturn'
      ? '<span class="ss-etf-return-metric">'
        + '<span>1개월 <b>' + fmtPct(it.returnRate1mPct) + '</b></span>'
        + '<span>3개월 <b>' + fmtPct(it.returnRate3mPct) + '</b></span>'
        + '<span>6개월 <b>' + fmtPct(it.returnRate6mPct) + '</b></span>'
        + '<span>12개월 <b>' + fmtPct(it.returnRate12mPct) + '</b></span>'
        + '</span>'
      : it.strategy === 'dividend'
      ? '배당금 ' + fmt(it.cashDividendPerShare) + '원 · 배당수익률 ' + fmtPct(it.dividendYieldPct)
        + ' · 배당성향 ' + fmtPct(it.payoutRatioPct)
      : it.gapRatePct != null
      ? '시초갭 ' + fmtPct(it.gapRatePct) + ' · 시가→종가 ' + fmtPct(it.intradayRatePct)
        + ' · 거래대금 ' + fmtMillion(it.turnoverMillion) + '백만원'
      : it.envelope
      ? '엔벨로프 하단 ' + fmtPct(it.envelope.closeDistancePct) + ' · ROE ' + fmtPct(it.roe)
      : '이격도 ' + fmtPct(it.disparity) + ' · ROE ' + fmtPct(it.roe);
    return '<div class="ss-row" data-code="' + escapeAttr(it.code) + '" data-name="' + escapeAttr(it.name) + '" title="눌러서 종목분석 보기">'
      + '<div class="ss-row-top">'
      + '<span class="ss-row-name">' + escapeHtml(it.name) + '<span class="ss-row-code">(' + escapeHtml(it.code) + ')</span></span>'
      + '<span><span class="ss-row-price">' + fmt(it.price) + '</span>'
      + '<span class="ss-row-rate ' + cc + '">' + chgSign(it.changeRate) + '</span></span>'
      + '</div>'
      + '<div class="ss-row-metric">' + metric + '</div>'
      + '</div>';
  }

  // ---- 유틸(js/pattern-scan.js와 동일, 등락 표시는 js/sector-dashboard-v4.js와 동일 형식) ----

  function fetchJson(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GAS 응답 오류: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return data;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function chgClass(rt) {
    if (rt == null) return 'ss-flat';
    var r = parseFloat(rt);
    return r > 0 ? 'ss-up' : (r < 0 ? 'ss-down' : 'ss-flat');
  }
  function chgSign(rt) {
    if (rt == null) return '';
    var r = parseFloat(rt);
    var arrow = r > 0 ? '▲' : (r < 0 ? '▼' : '');
    return arrow + Math.abs(r).toFixed(2) + '%';
  }
  function fmt(n) { return n == null ? '-' : Math.round(n).toLocaleString('ko-KR'); }
  function fmtPct(n) { return n == null ? '-' : n.toFixed(1) + '%'; }
  function fmtMillion(n) { return n == null ? '-' : Math.round(n).toLocaleString('ko-KR'); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---- ETF 구성종목 모달 ----
  // scripts/cloud-vm/main.py의 /etf-components/{code}(KIS ETF구성종목시세)를 직접 호출한다
  // (다른 온디맨드 종목 데이터 - /domestic-news, /investor-flow 등 - 와 동일하게 GAS를
  // 거치지 않고 브라우저가 goodbyestar.cloud를 직접 호출).
  var ETF_COMPONENTS_URL = 'https://goodbyestar.cloud/etf-components/';
  var etfModalOverlay = null;
  var etfModalRequestId = 0;

  function closeEtfComponentsModal() {
    if (!etfModalOverlay) return;
    etfModalOverlay.remove();
    etfModalOverlay = null;
    document.removeEventListener('keydown', onEtfModalKeydown);
  }

  function onEtfModalKeydown(event) {
    if (event.key === 'Escape') closeEtfComponentsModal();
  }

  function etfComponentRowHtml(item) {
    var cls = chgClass(item.changeRatePct);
    return '<tr>'
      + '<td class="ss-etf-comp-name">' + escapeHtml(item.name || item.code || '-') + '</td>'
      + '<td class="ss-etf-comp-weight">' + fmtPct(item.weightPct) + '</td>'
      + '<td>' + fmt(item.price) + '원</td>'
      + '<td class="' + cls + '">' + chgSign(item.changeRatePct) + '</td>'
      + '</tr>';
  }

  function renderEtfComponentsBody(body, data) {
    var components = (data && data.components) || [];
    if (!components.length) {
      body.innerHTML = '<p class="ss-etf-empty">이 ETF는 구성종목 정보를 제공하지 않습니다. '
        + '해외 지수를 추종하는 ETF는 KIS 구성종목 조회 대상이 아닙니다.</p>';
      return;
    }
    var summaryCls = chgClass(data.changeRatePct);
    body.innerHTML = '<div class="ss-etf-summary">'
      + '<span>현재가 <b class="' + summaryCls + '">' + fmt(data.price) + '원 ' + chgSign(data.changeRatePct) + '</b></span>'
      + (data.nav != null ? '<span>NAV <b>' + fmt(data.nav) + '</b></span>' : '')
      + (data.componentCount != null ? '<span>구성종목 수 <b>' + data.componentCount + '개</b></span>' : '')
      + '</div>'
      + '<div class="ss-etf-table-wrap"><table class="ss-etf-table">'
      + '<thead><tr><th>종목명</th><th>비중</th><th>현재가</th><th>등락률</th></tr></thead>'
      + '<tbody>' + components.map(etfComponentRowHtml).join('') + '</tbody>'
      + '</table></div>';
  }

  function openEtfComponentsModal(code, name) {
    closeEtfComponentsModal();
    var requestId = ++etfModalRequestId;
    var overlay = document.createElement('div');
    overlay.className = 'ss-etf-modal-overlay';
    overlay.innerHTML = '<div class="ss-etf-modal" role="dialog" aria-modal="true" aria-label="'
      + escapeAttr(name) + ' 구성종목">'
      + '<div class="ss-etf-modal-head"><strong>' + escapeHtml(name) + ' 구성종목</strong>'
      + '<button type="button" class="ss-etf-modal-close" aria-label="닫기">✕</button></div>'
      + '<div class="ss-etf-modal-body"><p class="ss-etf-loading">불러오는 중...</p></div>'
      + '</div>';
    document.body.appendChild(overlay);
    etfModalOverlay = overlay;
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeEtfComponentsModal();
    });
    overlay.querySelector('.ss-etf-modal-close').addEventListener('click', closeEtfComponentsModal);
    document.addEventListener('keydown', onEtfModalKeydown);

    var body = overlay.querySelector('.ss-etf-modal-body');
    fetchJson(ETF_COMPONENTS_URL + encodeURIComponent(code))
      .then(function (payload) {
        if (requestId !== etfModalRequestId) return; // 그 사이 닫혔거나 다른 ETF를 다시 열었으면 무시
        renderEtfComponentsBody(body, (payload && payload.data) || payload);
      })
      .catch(function () {
        if (requestId !== etfModalRequestId) return;
        body.innerHTML = '<p class="ss-etf-empty ss-etf-error">구성종목을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>';
      });
  }

  global.StrategySearch = { init: init, fetchJson: fetchJson };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
