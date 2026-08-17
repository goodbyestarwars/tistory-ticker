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
  var activeEtfSort = 'return1m';
  var activeEtfFilters = { major: '', middle: '', leverage: '', aum: '' };
  var activeDividendSort = 'yield';
  var activeDividendMarket = '';
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
        var keys = Object.keys((scanData && scanData.categories) || {});
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
    // ETN 데이터가 공급되기 전에도 ETF·ETN을 명확히 분리해 보여준다. ETN을 ETF
    // 목록에 섞거나 임의 수치를 복사하지 않고, 실제 공급 데이터가 들어오면 같은 테이블
    // 렌더러가 그대로 사용할 수 있는 빈 카테고리로 둔다.
    if (!data.categories.etnReturn) {
      data.categories.etnReturn = {
        name: 'ETN',
        productKind: 'etn',
        methodology: '현재 ETN 상품 데이터가 제공되지 않습니다. 데이터 연동 후 표시합니다.',
        sectors: {}
      };
    }
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
      + '<div class="ss-intro">'
      + '<h1>전략은 두뇌다.</h1>'
      + '<p>전략 조건으로 후보군을 찾고, 차트와 종목분석에서 진입 여부를 별도로 확인합니다.</p>'
      + '</div>'
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

  function categoryLabel(key, category) {
    if (key === 'undervalued') return '재무건전 장기 눌림';
    if (key === 'etfReturn') return 'ETF';
    if (key === 'etnReturn') return 'ETN';
    return (category && category.name) || key;
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
        + escapeHtml(categoryLabel(key, c)) + '</button>';
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
      var productTab = event.target.closest ? event.target.closest('.ss-product-tab') : null;
      if (productTab) {
        var productKey = productTab.getAttribute('data-product-key');
        if (productKey && productKey !== activeKey) {
          activeKey = productKey;
          renderAll(container);
        }
        return;
      }
      var watchButton = event.target.closest ? event.target.closest('.ss-watch-toggle') : null;
      if (watchButton) {
        event.preventDefault();
        event.stopPropagation();
        toggleWatchlist(watchButton);
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
      if (activeKey === 'etfReturn' || activeKey === 'etnReturn') {
        openEtfComponentsModal(code, name);
        return;
      }
      global.location.href = STOCK_DETAIL_PAGE + '?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(name);
    });
      container.addEventListener('keydown', function (event) {
      var row = event.target.closest ? event.target.closest('.ss-row') : null;
      if (!row || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      row.click();
    });
    container.addEventListener('change', function (event) {
      var etfControl = event.target.closest ? event.target.closest('.ss-etf-control') : null;
      if (etfControl) {
        var field = etfControl.getAttribute('data-etf-filter');
        if (field === 'sort') activeEtfSort = etfControl.value;
        else if (Object.prototype.hasOwnProperty.call(activeEtfFilters, field)) activeEtfFilters[field] = etfControl.value;
        renderCards(container);
        return;
      }
      var dividendSelect = event.target.closest ? event.target.closest('.ss-dividend-sort-select') : null;
      if (dividendSelect) {
        if (dividendSelect.getAttribute('data-dividend-filter') === 'market') activeDividendMarket = dividendSelect.value;
        else activeDividendSort = dividendSelect.value;
        renderCards(container);
      }
    });
  }

  function renderMeta(container) {
    var meta = container.querySelector('#ssMeta');
    if (!meta) return;
    if (!scanData || !scanData.scannedAt) {
      meta.textContent = '아직 스캔 결과가 없어요.';
      return;
    }
    var text = '스캔 기준시각 ' + scanData.scannedAt + ' · 전체 대상 ' + (scanData.universe || 0) + '종목';
    if (scanData.skippedIlliquid != null) text += ' · 유동성 부족 제외 ' + scanData.skippedIlliquid + '종목';
    meta.textContent = text;
  }

  function methodologySummary(key) {
    if (key === 'undervalued') return '재무 조건을 통과한 종목 중 120일선 대비 가격이 눌린 종목을 섹터별로 표시합니다.';
    if (key === 'dividend') return '과거 현금배당 공시를 기준으로 배당수익률과 주당 배당금을 비교합니다.';
    if (key === 'etfReturn') return '기간 수익률과 편입 구성을 비교하는 화면이며, 매수 의견이 아닙니다.';
    if (key === 'etnReturn') return '현재 ETN 상품 데이터가 제공되지 않습니다. 데이터 연동 후 표시합니다.';
    return '전략 조건으로 후보군을 탐색하고, 세부 기준을 확인합니다.';
  }

  // 첫 화면은 핵심 한 줄만 보여주고, 서버가 내려준 전체 조건·제외 조건·데이터 한계는
  // details 안에 그대로 보존한다. 조건을 숨기는 것이 아니라 정보량만 접는다.
  function renderMethodology(container) {
    var box = container.querySelector('#ssMethodology');
    if (!box) return;
    var cat = scanData.categories[activeKey];
    var full = (cat && cat.methodology) || '상세 조건 정보가 없습니다.';
    box.innerHTML = '<p class="ss-methodology-summary">' + escapeHtml(methodologySummary(activeKey)) + '</p>'
      + '<details class="ss-methodology-details"><summary>조건 자세히</summary>'
      + '<p>' + escapeHtml(full) + '</p></details>';
  }

  function renderCards(container) {
    var wrap = container.querySelector('#ssCards');
    if (!wrap) return;
    if (activeKey === 'etfReturn' || activeKey === 'etnReturn') {
      wrap.innerHTML = renderEtfProductView(activeKey);
      return;
    }
    if (activeKey === 'dividend') {
      wrap.innerHTML = renderDividendTable();
      return;
    }
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
        + '<div class="ss-card-heading"><div class="ss-card-title">' + escapeHtml(group.name) + '</div>'
        + '<p class="ss-card-note">' + escapeHtml(cardNote(activeKey)) + '</p></div>'
        + '<div class="ss-rows">' + rows + '</div>'
        + moreBtn
        + '</div>';
    }).join('');
    wrap.innerHTML = periodTabs + dividendTabs + '<div class="ss-cards-grid">' + html + '</div>';
  }

  function allMatches(key) {
    var category = scanData.categories[key] || {};
    var sectors = category.sectors || {};
    return Object.keys(sectors).reduce(function (all, sector) {
      return all.concat((sectors[sector] && sectors[sector].matches) || []);
    }, []);
  }

  function productTabs(active) {
    return '<div class="ss-product-tabs" role="tablist" aria-label="상품 유형">'
      + '<button type="button" class="ss-product-tab' + (active === 'etfReturn' ? ' active' : '')
      + '" data-product-key="etfReturn" role="tab" aria-selected="' + (active === 'etfReturn') + '">ETF</button>'
      + '<button type="button" class="ss-product-tab' + (active === 'etnReturn' ? ' active' : '')
      + '" data-product-key="etnReturn" role="tab" aria-selected="' + (active === 'etnReturn') + '">ETN</button>'
      + '</div>';
  }

  function optionList(items, selected) {
    return ['전체'].concat(items).map(function (value, index) {
      var actual = index === 0 ? '' : value;
      return '<option value="' + escapeAttr(actual) + '"' + (actual === selected ? ' selected' : '') + '>'
        + escapeHtml(value) + '</option>';
    }).join('');
  }

  function etfSortOptions() {
    return [
      ['return1m', '1개월 수익률'], ['return3m', '3개월 수익률'], ['return6m', '6개월 수익률'],
      ['return12m', '12개월 수익률'], ['changeUp', '당일 상승률'], ['changeDown', '당일 하락률'],
      ['volume', '거래량 상위'], ['volumeSurge', '거래량 급증'], ['turnover', '거래대금 상위'],
      ['newListing', '신규상장']
    ].map(function (entry) {
      return '<option value="' + entry[0] + '"' + (entry[0] === activeEtfSort ? ' selected' : '') + '>' + entry[1] + '</option>';
    }).join('');
  }

  function optionalNumber(item) {
    var value = item && (item.aum != null ? item.aum : item.assets != null ? item.assets : item.assetUnderManagement);
    return value == null ? null : Number(value);
  }

  function etfType(item) {
    if (item && item.leverageType) return item.leverageType;
    var name = String(item && item.name || '');
    if (/인버스/i.test(name)) return '인버스';
    if (/레버리지/i.test(name)) return '레버리지';
    return '일반';
  }

  function etfMajor(item) {
    return item && (item.majorCategory || item.categoryMajor || item.assetClass) || '';
  }

  function etfMiddle(item) {
    return item && (item.middleCategory || item.categoryMiddle || item.subcategory) || '';
  }

  function etfAumBucket(item) {
    var aum = optionalNumber(item);
    if (aum == null) return '';
    // 서버 단위가 원화라는 기존 계약을 우선하고, 이미 억원 단위로 내려온 값은
    // 화면에서 다시 확대하지 않는다.
    var eok = aum > 100000000 ? aum / 100000000 : aum;
    if (eok >= 5000) return '5000eok';
    if (eok >= 1000) return '1000eok';
    if (eok >= 500) return '500eok';
    if (eok >= 100) return '100eok';
    return '';
  }

  function etfFilteredMatches(key) {
    var query = etfSearchQuery.trim().toUpperCase();
    return allMatches(key).filter(function (item) {
      var name = String(item.name || '').toUpperCase();
      var code = String(item.code || '').toUpperCase();
      if (query && name.indexOf(query) === -1 && code.indexOf(query) === -1) return false;
      if (activeEtfFilters.major && etfMajor(item) !== activeEtfFilters.major) return false;
      if (activeEtfFilters.middle && etfMiddle(item) !== activeEtfFilters.middle) return false;
      if (activeEtfFilters.leverage && etfType(item) !== activeEtfFilters.leverage) return false;
      if (activeEtfFilters.aum && etfAumBucket(item) !== activeEtfFilters.aum) return false;
      return true;
    });
  }

  function sortEtfMatches(matches) {
    var field = activeEtfSort.indexOf('return') === 0 ? 'returnRate' + activeEtfSort.slice(6) + 'Pct' : null;
    return matches.slice().sort(function (a, b) {
      var av;
      var bv;
      if (field) { av = a[field]; bv = b[field]; }
      else if (activeEtfSort === 'changeUp' || activeEtfSort === 'changeDown') { av = a.changeRate; bv = b.changeRate; }
      else if (activeEtfSort === 'volume') { av = a.volume; bv = b.volume; }
      else if (activeEtfSort === 'volumeSurge') { av = a.volumeSurgePct; bv = b.volumeSurgePct; }
      else if (activeEtfSort === 'turnover') { av = a.turnover || a.tradingValue; bv = b.turnover || b.tradingValue; }
      else if (activeEtfSort === 'newListing') { av = a.listedDate || a.listingDate; bv = b.listedDate || b.listingDate; return String(bv || '').localeCompare(String(av || '')); }
      var aMissing = av == null || isNaN(Number(av));
      var bMissing = bv == null || isNaN(Number(bv));
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      av = aMissing ? 0 : Number(av);
      bv = bMissing ? 0 : Number(bv);
      // 하락률순은 가장 낮은 등락률(-값)부터, 나머지는 큰 값부터 표시한다.
      var direction = activeEtfSort === 'changeDown' ? -1 : 1;
      if (bv !== av) return direction * (bv - av);
      return String(a.code || '').localeCompare(String(b.code || ''));
    });
  }

  function watchButtonHtml(item) {
    var watched = global.Watchlist && typeof global.Watchlist.has === 'function' && global.Watchlist.has(item.code);
    return '<button type="button" class="ss-watch-toggle' + (watched ? ' active' : '') + '" data-code="'
      + escapeAttr(item.code) + '" data-name="' + escapeAttr(item.name) + '" aria-label="'
      + (watched ? '관심종목에서 삭제' : '관심종목에 추가') + '" aria-pressed="' + watched + '">'
      + (watched ? '★' : '☆') + '</button>';
  }

  function etfTableRow(item, index) {
    var rateClass = chgClass(item.changeRate);
    var selectedRate = activeEtfSort.indexOf('return') === 0 ? item['returnRate' + activeEtfSort.slice(6) + 'Pct'] : null;
    var asset = optionalNumber(item);
    return '<tr class="ss-table-row ss-row" data-code="' + escapeAttr(item.code) + '" data-name="' + escapeAttr(item.name) + '" tabindex="0" role="button">'
      + '<td class="ss-col-watch" data-label="관심등록">' + watchButtonHtml(item) + '</td>'
      + '<td class="ss-col-rank" data-label="순위">' + (index + 1) + '</td>'
      + '<td class="ss-col-product" data-label="상품명"><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.code) + '</small></td>'
      + '<td class="ss-col-price" data-label="현재가">' + fmt(item.price) + '원</td>'
      + '<td class="ss-col-change ' + rateClass + '" data-label="전일대비">' + chgSign(item.changeRate) + '</td>'
      + '<td class="ss-col-volume" data-label="거래량">' + fmt(item.volume) + '</td>'
      + '<td class="ss-col-turnover" data-label="거래대금">' + fmt(item.turnover || item.tradingValue) + '</td>'
      + '<td class="ss-col-aum" data-label="운용자산">' + (asset == null ? '—' : fmt(asset)) + '</td>'
      + '<td class="ss-col-type" data-label="유형">' + escapeHtml(etfType(item)) + '</td>'
      + '<td class="ss-col-return ' + chgClass(selectedRate) + '" data-label="1개월">' + fmtPct(item.returnRate1mPct) + '</td>'
      + '<td class="ss-col-return ' + chgClass(item.returnRate3mPct) + '" data-label="3개월">' + fmtPct(item.returnRate3mPct) + '</td>'
      + '<td class="ss-col-return ' + chgClass(item.returnRate6mPct) + '" data-label="6개월">' + fmtPct(item.returnRate6mPct) + '</td>'
      + '<td class="ss-col-return ' + chgClass(item.returnRate12mPct) + '" data-label="12개월">' + fmtPct(item.returnRate12mPct) + '</td>'
      + '</tr>';
  }

  function renderEtfProductView(key) {
    var category = scanData.categories[key] || {};
    var matches = key === 'etnReturn' ? allMatches(key) : sortEtfMatches(etfFilteredMatches(key));
    if (key === 'etnReturn' && !matches.length) {
      return productTabs(key) + '<div class="ss-product-empty">현재 ETN 상품 데이터가 제공되지 않습니다.<br><small>ETN 유니버스와 시세 데이터 연동 후 표시됩니다.</small></div>';
    }
    var all = allMatches(key);
    var majors = Array.from(new Set(all.map(etfMajor).filter(Boolean))).sort();
    var middles = Array.from(new Set(all.map(etfMiddle).filter(Boolean))).sort();
    var controls = '<div class="ss-product-toolbar">'
      + '<label>정렬 <select class="ss-etf-control" data-etf-filter="sort">' + etfSortOptions() + '</select></label>'
      + '<label>대분류 <select class="ss-etf-control" data-etf-filter="major">' + optionList(majors, activeEtfFilters.major) + '</select></label>'
      + '<label>중분류 <select class="ss-etf-control" data-etf-filter="middle">' + optionList(middles, activeEtfFilters.middle) + '</select></label>'
      + '<label>운용배수 <select class="ss-etf-control" data-etf-filter="leverage"><option value="">전체</option><option value="일반"' + (activeEtfFilters.leverage === '일반' ? ' selected' : '') + '>일반</option><option value="레버리지"' + (activeEtfFilters.leverage === '레버리지' ? ' selected' : '') + '>레버리지</option><option value="인버스"' + (activeEtfFilters.leverage === '인버스' ? ' selected' : '') + '>인버스</option></select></label>'
      + '<label>운용자산 <select class="ss-etf-control" data-etf-filter="aum"><option value="">전체</option><option value="100eok"' + (activeEtfFilters.aum === '100eok' ? ' selected' : '') + '>100억 이상</option><option value="500eok"' + (activeEtfFilters.aum === '500eok' ? ' selected' : '') + '>500억 이상</option><option value="1000eok"' + (activeEtfFilters.aum === '1000eok' ? ' selected' : '') + '>1,000억 이상</option><option value="5000eok"' + (activeEtfFilters.aum === '5000eok' ? ' selected' : '') + '>5,000억 이상</option></select></label>'
      + '<input type="search" class="ss-etf-search-input" placeholder="상품명 또는 코드 검색" value="' + escapeAttr(etfSearchQuery) + '" aria-label="ETF 검색">'
      + '</div>';
    var note = category.methodology ? '<p class="ss-product-note">' + escapeHtml(category.methodology) + '</p>' : '';
    var table = '<div class="ss-table-wrap"><table class="ss-comparison-table ss-etf-table"><thead><tr>'
      + ['관심등록', '순위', '상품명', '현재가', '전일대비', '거래량', '거래대금', '운용자산', '유형', '1개월 수익률', '3개월 수익률', '6개월 수익률', '12개월 수익률'].map(function (label) { return '<th>' + label + '</th>'; }).join('')
      + '</tr></thead><tbody>' + matches.map(etfTableRow).join('') + '</tbody></table></div>';
    return productTabs(key) + controls + note + (matches.length ? table : '<div class="ss-product-empty">조건에 맞는 상품이 없습니다.</div>');
  }

  function dividendSortOptions() {
    return [['yield', '수익률순'], ['dps', '배당금순'], ['payout', '배당성향순'], ['roe', 'ROE순'], ['per', 'PER 낮은 순'], ['pbr', 'PBR 낮은 순'], ['dps1y', '1년 전 대비 배당금 증가순'], ['stability', '3년 배당금 안정성순']].map(function (entry) {
      return '<option value="' + entry[0] + '"' + (entry[0] === activeDividendSort ? ' selected' : '') + '>' + entry[1] + '</option>';
    }).join('');
  }

  function dividendHistoryValue(item, index) {
    var rows = item.dividendHistory || item.dividendYears || [];
    if (!rows.length) return null;
    var sorted = rows.slice().sort(function (a, b) { return Number(b.year || 0) - Number(a.year || 0); });
    var row = sorted[index];
    return row && (row.cashDividendPerShare != null ? row.cashDividendPerShare : row.dps);
  }

  function sortedDividendMatches() {
    var matches = allMatches('dividend').filter(function (item) {
      if (!activeDividendMarket) return true;
      var market = String(item.market || item.marketName || item.exchange || '').toUpperCase();
      return activeDividendMarket === 'KOSPI' ? /KOSPI|코스피/.test(market) : /KOSDAQ|코스닥/.test(market);
    });
    return matches.sort(function (a, b) {
      var av, bv;
      if (activeDividendSort === 'yield') { av = a.dividendYieldPct; bv = b.dividendYieldPct; }
      else if (activeDividendSort === 'dps') { av = a.cashDividendPerShare; bv = b.cashDividendPerShare; }
      else if (activeDividendSort === 'payout') { av = a.payoutRatioPct; bv = b.payoutRatioPct; }
      else if (activeDividendSort === 'roe') { av = a.roe; bv = b.roe; }
      else if (activeDividendSort === 'per') { av = a.per; bv = b.per; }
      else if (activeDividendSort === 'pbr') { av = a.pbr; bv = b.pbr; }
      else if (activeDividendSort === 'dps1y') { av = (a.cashDividendPerShare || 0) - (dividendHistoryValue(a, 1) || 0); bv = (b.cashDividendPerShare || 0) - (dividendHistoryValue(b, 1) || 0); }
      else { av = a.dividendStreak; bv = b.dividendStreak; }
      av = av == null ? -Infinity : Number(av); bv = bv == null ? -Infinity : Number(bv);
      var ascending = activeDividendSort === 'per' || activeDividendSort === 'pbr';
      if (av !== bv) return ascending ? av - bv : bv - av;
      return String(a.code || '').localeCompare(String(b.code || ''));
    });
  }

  function dividendTableRow(item, index) {
    var rateClass = chgClass(item.changeRate);
    var payout = item.payoutRatioPct;
    var warning = payout != null && (Number(payout) < 0 || Number(payout) > 100) ? '배당성향 ' + (Number(payout) > 100 ? '100% 초과' : '음수') + ' · 지속 가능성 확인 필요' : '';
    var row = '<tr class="ss-table-row ss-row" data-code="' + escapeAttr(item.code) + '" data-name="' + escapeAttr(item.name) + '" tabindex="0" role="button">'
      + '<td class="ss-col-watch" data-label="관심등록">' + watchButtonHtml(item) + '</td>'
      + '<td class="ss-col-rank" data-label="순위">' + (index + 1) + '</td>'
      + '<td class="ss-col-product" data-label="종목명"><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.code) + '</small></td>'
      + '<td class="ss-col-price" data-label="현재가">' + fmt(item.price) + '원</td>'
      + '<td class="ss-col-change ' + rateClass + '" data-label="전일대비">' + chgSign(item.changeRate) + '</td>'
      + '<td data-label="배당금">' + fmt(item.cashDividendPerShare) + '원</td>'
      + '<td data-label="배당수익률">' + fmtPct(item.dividendYieldPct) + '</td>'
      + '<td data-label="배당성향">' + fmtPct(item.payoutRatioPct) + '</td>'
      + '<td data-label="ROE">' + fmtPct(item.roe) + '</td>'
      + '<td data-label="PER">' + fmtMultiple(item.per) + '</td>'
      + '<td data-label="PBR">' + fmtMultiple(item.pbr) + '</td>'
      + '<td data-label="1년 전">' + fmt(dividendHistoryValue(item, 1)) + '원</td>'
      + '<td data-label="2년 전">' + fmt(dividendHistoryValue(item, 2)) + '원</td>'
      + '<td data-label="3년 전">' + fmt(dividendHistoryValue(item, 3)) + '원</td>'
      + '</tr>';
    return row + (warning ? '<tr class="ss-warning-row"><td class="ss-row-warning" colspan="14">' + escapeHtml(warning) + '</td></tr>' : '');
  }

  function renderDividendTable() {
    var category = scanData.categories.dividend || {};
    var matches = sortedDividendMatches();
    var table = '<div class="ss-table-wrap"><table class="ss-comparison-table ss-dividend-table"><thead><tr>'
      + ['관심등록', '순위', '종목명', '현재가', '전일대비', '배당금', '배당수익률', '배당성향', 'ROE', 'PER', 'PBR', '1년 전 배당금', '2년 전 배당금', '3년 전 배당금'].map(function (label) { return '<th>' + label + '</th>'; }).join('')
      + '</tr></thead><tbody>' + matches.map(dividendTableRow).join('') + '</tbody></table></div>';
    return '<div class="ss-dividend-toolbar"><label>시장 <select class="ss-dividend-sort-select" data-dividend-filter="market"><option value="">전체</option><option value="KOSPI"' + (activeDividendMarket === 'KOSPI' ? ' selected' : '') + '>KOSPI</option><option value="KOSDAQ"' + (activeDividendMarket === 'KOSDAQ' ? ' selected' : '') + '>KOSDAQ</option></select></label><label>정렬 <select class="ss-dividend-sort-select" data-dividend-filter="sort">' + dividendSortOptions() + '</select></label></div>'
      + '<p class="ss-product-note">' + escapeHtml(category.methodology || '최근 확정 배당 공시 기준입니다.') + '</p>'
      + (matches.length ? table : '<div class="ss-product-empty">배당 데이터가 없습니다.</div>');
  }

  function fmtMultiple(value) {
    return value == null || isNaN(Number(value)) ? '—' : Number(value).toFixed(2) + '배';
  }

  function toggleWatchlist(button) {
    if (!global.Watchlist || typeof global.Watchlist.has !== 'function') return;
    var code = button.getAttribute('data-code');
    var name = button.getAttribute('data-name') || code;
    if (global.Watchlist.has(code)) global.Watchlist.remove(code);
    else {
      var result = global.Watchlist.add(code, name);
      if (!result || !result.ok) {
        button.title = result && result.reason === 'login' ? 'Google 로그인 후 관심종목을 등록할 수 있습니다.' : '관심종목 등록에 실패했습니다.';
        return;
      }
    }
    button.classList.toggle('active', global.Watchlist.has(code));
    button.textContent = global.Watchlist.has(code) ? '★' : '☆';
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

  function cardNote(key) {
    if (key === 'undervalued') return '장기 가격 눌림 상위 후보';
    if (key === 'dividend') return '현금배당 기준 비교 후보';
    if (key === 'etfReturn') return '운용사별 기간 성과 비교';
    return '전략 조건을 충족한 후보군';
  }

  function periodLabel(key) {
    var period = ETF_RETURN_PERIODS.filter(function (item) { return item.key === key; })[0];
    return period ? period.label : key;
  }

  function rowHtml(it) {
    var cc = chgClass(it.changeRate);
    var primary = '';
    var secondary = '';
    var basis = it.date ? '기준일 ' + it.date : '';
    var extra = '';
    if (it.strategy === 'etfReturn') {
      var selectedField = 'returnRate' + activeEtfPeriod + 'Pct';
      primary = periodLabel(activeEtfPeriod) + ' 수익률 ' + fmtPct(it[selectedField]);
      secondary = '<span class="ss-etf-return-metric">'
        + '<span>1개월 <b>' + fmtPct(it.returnRate1mPct) + '</b></span>'
        + '<span>3개월 <b>' + fmtPct(it.returnRate3mPct) + '</b></span>'
        + '<span>6개월 <b>' + fmtPct(it.returnRate6mPct) + '</b></span>'
        + '<span>12개월 <b>' + fmtPct(it.returnRate12mPct) + '</b></span></span>';
      extra = '<button type="button" class="ss-etf-components-btn" aria-label="' + escapeAttr(it.name) + ' 구성종목 보기">구성종목 보기</button>';
    } else if (it.strategy === 'dividend') {
      primary = it.dividendYieldPct == null ? '공시 데이터 수집 대기' : '배당수익률 ' + fmtPct(it.dividendYieldPct);
      secondary = it.cashDividendPerShare == null ? '주당 현금배당 데이터 없음' : '주당 현금배당 ' + fmt(it.cashDividendPerShare) + '원';
      basis = it.reportYear ? String(it.reportYear) + ' 사업연도 공시 기준' : '공시 기준연도 확인 대기';
    } else if (it.disparity != null) {
      primary = '120일선 대비 ' + fmtPctSigned(Number(it.disparity) - 100);
      secondary = 'ROE ' + fmtPct(it.roe) + ' · 부채비율 ' + fmtPct(it.debtRatio);
    } else if (it.envelope) {
      primary = '주봉 엔벨로프 하단 ' + fmtPct(it.envelope.closeDistancePct);
      secondary = 'ROE ' + fmtPct(it.roe) + ' · 부채비율 ' + fmtPct(it.debtRatio);
    } else {
      primary = it.gapRatePct != null ? '시초갭 ' + fmtPct(it.gapRatePct) : '전략 조건 충족';
      secondary = it.intradayRatePct != null ? '시가→종가 ' + fmtPct(it.intradayRatePct) + ' · 거래대금 ' + fmtMillion(it.turnoverMillion) + '백만원' : '';
    }
    return '<div class="ss-row" data-code="' + escapeAttr(it.code) + '" data-name="' + escapeAttr(it.name) + '" tabindex="0" role="button" title="눌러서 종목분석 보기">'
      + '<div class="ss-row-top"><span class="ss-row-name">' + escapeHtml(it.name) + '<span class="ss-row-code">(' + escapeHtml(it.code) + ')</span></span></div>'
      + '<div class="ss-row-primary">' + escapeHtml(primary) + '</div>'
      + (secondary ? '<div class="ss-row-secondary">' + (it.strategy === 'etfReturn' ? secondary : escapeHtml(secondary)) + '</div>' : '')
      + '<div class="ss-row-bottom"><span class="ss-row-quote"><span class="ss-row-price">' + fmt(it.price) + '</span><span class="ss-row-rate ' + cc + '">' + chgSign(it.changeRate) + '</span></span>'
      + (basis ? '<span class="ss-row-basis">' + escapeHtml(basis) + '</span>' : '') + extra + '</div>'
      + '</div>';
  }

  // ---- 유틸(js/pattern-scan.js와 동일, 등락 표시는 js/sector-dashboard-v4.js와 동일 형식) ----

  function fetchJson(url) {
    if (typeof global.__strategySearchFetch === 'function') return global.__strategySearchFetch(url);
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
  function fmt(n) { return n == null || isNaN(Number(n)) ? '—' : Math.round(Number(n)).toLocaleString('ko-KR'); }
  function fmtPct(n) { return n == null || isNaN(Number(n)) ? '—' : Number(n).toFixed(1) + '%'; }
  function fmtPctSigned(n) {
    if (n == null || !isFinite(Number(n))) return '—';
    var value = Number(n);
    return (value > 0 ? '+' : '') + value.toFixed(1) + '%';
  }
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

  function etfComponentRowHtml(item, index) {
    var cls = chgClass(item.changeRatePct);
    return '<tr class="ss-etf-comp-row" data-code="' + escapeAttr(item.code) + '" data-name="' + escapeAttr(item.name || item.code || '-') + '" tabindex="0">'
      + '<td class="ss-etf-comp-rank">' + (index + 1) + '</td>'
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
    var totalCount = data.componentCount != null ? Number(data.componentCount) : components.length;
    var top10Weight = components.slice(0, 10).reduce(function (sum, item) { return sum + (Number(item.weightPct) || 0); }, 0);
    var basisDate = data.asOf || data.baseDate || data.dataDate || data.updatedAt || '';
    body.innerHTML = '<div class="ss-etf-summary">'
      + '<span>현재가 <b class="' + summaryCls + '">' + fmt(data.price) + '원 ' + chgSign(data.changeRatePct) + '</b></span>'
      + (data.nav != null ? '<span>NAV <b>' + fmt(data.nav) + '</b></span>' : '')
      + '<span>구성종목 수 <b>' + totalCount + '개</b></span>'
      + '<span>상위 10종목 비중 <b>' + top10Weight.toFixed(1) + '%</b></span>'
      + '<span>' + (basisDate ? '구성 기준 ' + escapeHtml(basisDate) : '구성 기준일 API 미제공') + '</span>'
      + '<span>현재 표시 <b>' + components.length + '개</b></span>'
      + '</div>'
      + '<div class="ss-etf-table-wrap"><table class="ss-etf-table">'
      + '<thead><tr><th>순위</th><th>종목명</th><th>비중</th><th>현재가</th><th>등락률</th></tr></thead>'
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
      var componentRow = event.target.closest ? event.target.closest('.ss-etf-comp-row') : null;
      if (componentRow) {
        var componentCode = componentRow.getAttribute('data-code');
        var componentName = componentRow.getAttribute('data-name') || componentCode;
        if (componentCode) global.location.href = STOCK_DETAIL_PAGE + '?code=' + encodeURIComponent(componentCode) + '&name=' + encodeURIComponent(componentName);
      }
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
