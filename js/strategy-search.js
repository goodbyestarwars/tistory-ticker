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
 * 안에서는 전체 결과를 하나의 순위표로 평탄화해 보여준다. ETF·배당주와 같은
 * 목록형 결과 컴포넌트를 재사용하고, 섹터는 행의 컬럼으로 표시한다.
 *
 * 리스트는 VM(strategy_scan.py)이 하루 1회 미리 스캔해둔 결과(?strategyScan=1)를 그대로
 * 보여준다(가벼움) - js/pattern-scan.js와 동일한 패턴.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var CONTAINER_SELECTOR = '#strategy-search';
  var FETCH_TIMEOUT_MS = 15000;
  var STOCK_ICON_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  // 종목분석 상세 페이지 - js/stock-search-panel.js·js/watchlist.js와 동일한 이동 방식
  // (?code=&name=). 펀더멘탈(PER·PBR·DART 재무)·차트·수급을 바로 확인할 수 있어 "왜 이
  // 종목이 뽑혔는지" 근거를 확인하기 가장 가까운 기존 페이지다.
  var STOCK_DETAIL_PAGE = '/page/foreign-flow';

  var scanData = null;
  var activeKey = null;
  var activeEtfSort = 'return1m';
  var activeEtfFilters = { major: '', middle: '', leverage: '' };
  var activeDividendSort = 'yield';
  var activeDividendMarket = '';
  var etfSearchQuery = '';
  function stockIconHtml(code, cls) {
    if (!code) return '';
    var iconCode = String(code).replace(/^US:/i, '').toUpperCase();
    var iconClass = cls || 'ss-stock-icon';
    return '<img class="' + iconClass + '" data-icon-code="' + escapeAttr(iconCode)
      + '" data-icon-market="domestic" src="' + STOCK_ICON_BASE + encodeURIComponent(iconCode)
      + '.svg" alt="" loading="lazy" onerror="window.StockIconFallback ? window.StockIconFallback(this) : (window.__stockIconFallback ? window.__stockIconFallback(this) : this.style.display=\'none\')">';
  }
  var ETF_PROVIDER_PREFIXES = [
    ['KODEX', '삼성자산운용'], ['TIGER', '미래에셋자산운용'], ['ACE', '한국투자신탁운용'],
    ['HANARO', 'NH-Amundi자산운용'], ['RISE', 'KB자산운용'], ['KBSTAR', 'KB자산운용'],
    ['PLUS', '한화자산운용'], ['ARIRANG', '한화자산운용'], ['SOL', '신한자산운용'],
    ['KOSEF', '키움투자자산운용'], ['TIMEFOLIO', '타임폴리오자산운용'], ['1Q', '하나자산운용'],
    ['FOCUS', '브이아이자산운용']
  ];

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
    // ETN은 현재 화면에서 제공하지 않는다. 백엔드 응답에 ETN 카테고리가
    // 남아 있어도 프론트 결과에는 노출하지 않는다.
    delete data.categories.etnReturn;
    var periods = ['1m', '3m', '6m', '12m'];
    if (data.categories.etfReturn) {
      periods.forEach(function (period) { delete data.categories['etf_' + period]; });
      Object.keys(data.categories.etfReturn.sectors || {}).forEach(function (sector) {
        var group = data.categories.etfReturn.sectors[sector] || {};
        group.matches = (group.matches || []).filter(function (row) { return !isEtnProduct(row); });
      });
      return data;
    }

    var merged = {};
    periods.forEach(function (period) {
      var category = data.categories['etf_' + period];
      if (!category || !category.sectors) return;
      Object.keys(category.sectors).forEach(function (sector) {
        var group = category.sectors[sector] || {};
        (group.matches || []).forEach(function (row) {
          if (isEtnProduct(row)) return;
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
    if (data.categories.etfReturn && data.categories.etfReturn.sectors) {
      Object.keys(data.categories.etfReturn.sectors).forEach(function (sector) {
        var group = data.categories.etfReturn.sectors[sector] || {};
        group.matches = (group.matches || []).filter(function (row) { return !isEtnProduct(row); });
      });
    }
    return data;
  }

  function isEtnProduct(item) {
    var text = String(item && (item.name || item.productName || item.itmsNm || item.productKind) || '');
    return /(^|[^A-Z])ETN([^A-Z]|$)/i.test(text);
  }

  function buildShell() {
    // 페이지 제목은 Tistory 글 제목으로 한 번만 표시한다. 위젯 안에서
    // 같은 제목을 다시 출력하면 "전략은 두뇌다." 제목이 중복된다.
    return ''
      + '<div class="ss-intro">'
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
    return Object.keys(scanData.categories).filter(function (key) { return key !== 'etnReturn'; });
  }

  function categoryLabel(key, category) {
    if (key === 'undervalued') return '재무건전 장기 눌림';
    if (key === 'etfReturn') return 'ETF';
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
      var row = event.target.closest ? event.target.closest('.ss-row') : null;
      if (!row) return;
      var code = row.getAttribute('data-code');
      if (!code) return;
      var name = row.getAttribute('data-name') || code;
      // 2026-08-14 요청: ETF 수익률 상위에서 종목(=ETF)을 클릭하면 개별주식 종목분석
      // 대신 ETF가 실제로 어떤 종목을 얼마나 담고 있는지(구성종목·비중)를 보여준다.
      // 다른 카테고리(저평가 종목·배당주)는 기존처럼 종목분석으로 이동.
      if (activeKey === 'etfReturn') {
        openEtfComponentsModal(code, name, findItemByCode(activeKey, code));
        return;
      }
      if (activeKey === 'dividend') {
        openDividendInfoModal(code, name, findItemByCode(activeKey, code));
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
    if (key === 'dividend') return '과거 현금배당 공시를 기준으로 배당수익률과 주당 현금배당금을 비교합니다.';
    if (key === 'etfReturn') return '기간 수익률과 편입 구성을 비교하는 화면이며, 매수 의견이 아닙니다.';
    if (key === 'nationalPension') return '국민연금공단이 공시한 국내주식 보유정보 중 지분율 상위 100개를 표시합니다(연 1회 공시 스냅샷).';
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
    if (activeKey === 'etfReturn') {
      wrap.innerHTML = renderEtfProductView(activeKey);
      return;
    }
    if (activeKey === 'dividend') {
      wrap.innerHTML = renderDividendTable();
      return;
    }
    if (activeKey === 'undervalued') {
      wrap.innerHTML = renderStrategyTable();
      return;
    }
    if (activeKey === 'nationalPension') {
      wrap.innerHTML = renderNpsTable();
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
    var html = sectorNames.map(function (name) {
      var matches = sectors[name].matches || [];
      return '<div class="ss-card">'
        + '<div class="ss-card-heading"><div class="ss-card-title">' + escapeHtml(name) + '</div>'
        + '<p class="ss-card-note">' + escapeHtml(cardNote(activeKey)) + '</p></div>'
        + '<div class="ss-rows">' + matches.map(rowHtml).join('') + '</div>'
        + '</div>';
    }).join('');
    wrap.innerHTML = '<div class="ss-cards-grid">' + html + '</div>';
  }

  function strategySignal(item) {
    if (item.disparity != null) return '120일선 대비 ' + fmtPctSigned(Number(item.disparity) - 100);
    if (item.envelope && item.envelope.closeDistancePct != null) return '주봉 엔벨로프 하단 ' + fmtPct(item.envelope.closeDistancePct);
    if (item.gapRatePct != null) return '시초갭 ' + fmtPct(item.gapRatePct);
    return '전략 조건 충족';
  }

  function strategyFundamentals(item) {
    var parts = [];
    if (item.roe != null) parts.push('ROE ' + fmtPct(item.roe));
    if (item.debtRatio != null) parts.push('부채비율 ' + fmtPct(item.debtRatio));
    return parts.join(' · ');
  }

  function strategyTableRow(item, index, showFundamentals) {
    var rate = item.changeRate != null ? item.changeRate : item.changeRatePct;
    var fundamentals = strategyFundamentals(item);
    return '<tr class="ss-table-row ss-row" data-code="' + escapeAttr(item.code) + '" data-name="' + escapeAttr(item.name) + '" tabindex="0" role="button">'
      + '<td class="ss-col-watch" data-label="관심">' + watchButtonHtml(item) + '</td>'
      + '<td class="ss-col-rank" data-label="순위">' + (index + 1) + '</td>'
      + '<td class="ss-col-product" data-label="종목명"><strong>' + stockIconHtml(item.code) + '<span>' + escapeHtml(item.name || '—') + '</span></strong></td>'
      + '<td class="ss-col-code" data-label="종목코드">' + escapeHtml(item.code || '—') + '</td>'
      + '<td class="ss-col-sector" data-label="업종">' + escapeHtml(cleanIndustryLabel(item.sector || item.industry)) + '</td>'
      + '<td class="ss-col-price" data-label="현재가">' + fmtWon(item.price) + '</td>'
      + '<td class="ss-col-change ' + chgClass(rate) + '" data-label="등락률">' + fmtChange(rate) + '</td>'
      + '<td class="ss-col-signal" data-label="전략 지표">' + escapeHtml(strategySignal(item)) + '</td>'
      + (showFundamentals ? '<td class="ss-col-fundamentals" data-label="재무 지표">' + escapeHtml(fundamentals || '—') + '</td>' : '')
      + '</tr>';
  }

  function renderStrategyTable() {
    var matches = allMatches('undervalued');
    if (!matches.length) return '<div class="ss-hint">지금은 이 카테고리 조건에 맞는 종목이 없어요.</div>';
    var showFundamentals = matches.some(function (item) { return item.roe != null || item.debtRatio != null; });
    var headers = ['관심', '순위', '종목명', '종목코드', '업종', '현재가', '등락률', '전략 지표'];
    if (showFundamentals) headers.push('재무 지표');
    return '<div class="ss-table-wrap"><table class="ss-comparison-table ss-strategy-table"><thead><tr>'
      + headers.map(function (label) { return '<th>' + label + '</th>'; }).join('')
      + '</tr></thead><tbody>' + matches.map(function (item, index) { return strategyTableRow(item, index, showFundamentals); }).join('')
      + '</tbody></table></div>';
  }

  // 2026-08-20: "국민연금이 가진 종목 조회" 요청 - scripts/cloud-vm/public_data.py에 이미
  // 있었지만 어디서도 안 쓰이던 fetch_nps_holding()(data.go.kr 국민연금공단 국내주식
  // 투자정보)을 strategy_scan.py의 새 카테고리(nationalPension)로 노출한 것을 여기서
  // 표로 그린다. 클릭 시 이동은 wireContainer()의 기본 분기(종목분석 이동)를 그대로 쓴다 -
  // dividend/etfReturn처럼 별도 상세 모달이 필요할 만큼 복잡한 데이터가 아니다.
  function npsTableRow(item, index) {
    var rate = item.changeRate != null ? item.changeRate : item.changeRatePct;
    return '<tr class="ss-table-row ss-row" data-code="' + escapeAttr(item.code) + '" data-name="' + escapeAttr(item.name) + '" tabindex="0" role="button">'
      + '<td class="ss-col-watch" data-label="관심">' + watchButtonHtml(item) + '</td>'
      + '<td class="ss-col-rank" data-label="순위">' + (index + 1) + '</td>'
      + '<td class="ss-col-product" data-label="종목명"><strong>' + stockIconHtml(item.code) + '<span>' + escapeHtml(item.name || '—') + '</span></strong></td>'
      + '<td class="ss-col-code" data-label="종목코드">' + escapeHtml(item.code || '—') + '</td>'
      + '<td class="ss-col-sector" data-label="업종">' + escapeHtml(cleanIndustryLabel(item.sector)) + '</td>'
      + '<td class="ss-col-price" data-label="현재가">' + fmtWon(item.price) + '</td>'
      + '<td class="ss-col-change ' + chgClass(rate) + '" data-label="등락률">' + fmtChange(rate) + '</td>'
      + '<td class="ss-col-signal" data-label="보유 지분율">' + fmtPctExact(item.holdingPct) + '</td>'
      + '<td class="ss-col-fundamentals" data-label="평가액">' + (item.evaluationAmountEok == null ? '—' : fmt(item.evaluationAmountEok) + '억원') + '</td>'
      + '</tr>';
  }

  function renderNpsTable() {
    // allMatches()는 섹터별 그룹을 순서대로 이어붙이기만 해서(저평가 종목처럼 섹터
    // 단위 순위가 의미 있는 카테고리엔 맞지만) 여기서는 섹터 경계에서 전역 지분율
    // 순위가 깨진다 - 서버가 이미 지분율 내림차순으로 정렬해 보내지만, 여기서도
    // 한 번 더 정렬해 항상 전역 순위를 보장한다.
    var matches = allMatches('nationalPension').sort(function (a, b) {
      return (b.holdingPct || 0) - (a.holdingPct || 0);
    });
    if (!matches.length) return '<div class="ss-hint">지금은 국민연금 보유 정보를 확인할 수 있는 종목이 없어요.</div>';
    var asOf = matches[0] && matches[0].asOf;
    var headers = ['관심', '순위', '종목명', '종목코드', '업종', '현재가', '등락률', '보유 지분율', '평가액'];
    return (asOf ? '<div class="ss-hint">기준일 ' + escapeHtml(asOf) + ' 공시 스냅샷입니다(매일 갱신되지 않습니다).</div>' : '')
      + '<div class="ss-table-wrap"><table class="ss-comparison-table ss-strategy-table"><thead><tr>'
      + headers.map(function (label) { return '<th>' + label + '</th>'; }).join('')
      + '</tr></thead><tbody>' + matches.map(npsTableRow).join('')
      + '</tbody></table></div>';
  }

  function allMatches(key) {
    var category = scanData.categories[key] || {};
    var sectors = category.sectors || {};
    var rows = Object.keys(sectors).reduce(function (all, sector) {
      return all.concat(((sectors[sector] && sectors[sector].matches) || []).map(function (item) {
        var copy = Object.assign({}, item);
        if (!copy.sector) copy.sector = sector;
        return copy;
      }));
    }, []);
    return key === 'etfReturn'
      ? rows.map(function (item) { return normalizeEtfItem(item, key); })
      : key === 'dividend'
        ? rows.map(normalizeDividendItem)
        : rows;
  }

  function firstValue(item, fields) {
    for (var i = 0; i < fields.length; i += 1) {
      if (item && item[fields[i]] != null && item[fields[i]] !== '') return item[fields[i]];
    }
    return null;
  }

  function cleanIndustryLabel(value) {
    var text = String(value == null ? '' : value).trim();
    text = text.replace(/^[\s—-]+/, '').replace(/^·\s*/, '').trim();
    return text || '—';
  }

  function providerFromName(name) {
    var upper = String(name || '').trim().toUpperCase();
    for (var i = 0; i < ETF_PROVIDER_PREFIXES.length; i += 1) {
      if (upper.indexOf(ETF_PROVIDER_PREFIXES[i][0]) === 0) return ETF_PROVIDER_PREFIXES[i][1];
    }
    return '—';
  }

  function normalizeEtfItem(item, key) {
    item = item || {};
    var name = String(firstValue(item, ['name', 'productName', 'itmsNm']) || '—');
    var code = String(firstValue(item, ['code', 'symbol', 'srtnCd']) || '');
    var normalized = Object.assign({}, item);
    normalized.id = firstValue(item, ['id', 'code', 'symbol', 'srtnCd']) || code || name;
    normalized.name = name;
    normalized.code = code;
    normalized.provider = firstValue(item, ['provider', 'issuer', 'assetManager', 'managementCompany']) || providerFromName(name);
    normalized.sector = firstValue(item, ['sector', 'industry', 'middleCategory', 'categoryMiddle', 'category']) || '—';
    normalized.price = firstValue(item, ['price', 'currentPrice', 'close', 'stckPrpr']);
    normalized.changeRate = firstValue(item, ['changeRate', 'change_rate', 'changeRatePct', 'rate', 'prdyCrt']);
    normalized.volume = firstValue(item, ['volume', 'tradeVolume', 'tradingVolume', 'acmlVol']);
    normalized.tradingValue = firstValue(item, ['tradingValue', 'turnover', 'tradeAmount', 'trade_amount', 'acmlTrPbmn']);
    normalized.aum = firstValue(item, ['aum', 'assets', 'assetUnderManagement', 'netAssetValue']);
    normalized.leverageType = firstValue(item, ['leverageType', 'productType', 'leverage']) || etfType(item);
    normalized.returnRate1mPct = firstValue(item, ['returnRate1mPct', 'return1m', 'return1mPct']);
    normalized.returnRate3mPct = firstValue(item, ['returnRate3mPct', 'return3m', 'return3mPct']);
    normalized.returnRate6mPct = firstValue(item, ['returnRate6mPct', 'return6m', 'return6mPct']);
    normalized.returnRate12mPct = firstValue(item, ['returnRate12mPct', 'return12m', 'return12mPct']);
    normalized.volumeSurgePct = firstValue(item, ['volumeSurgePct', 'volumeGrowthPct', 'volumeSurge']);
    normalized.listedDate = firstValue(item, ['listedDate', 'listingDate', 'listDate']);
    normalized.productKind = 'ETF';
    return normalized;
  }

  function normalizeDividendItem(item) {
    item = item || {};
    var normalized = Object.assign({}, item);
    normalized.id = firstValue(item, ['id', 'code', 'symbol']) || '';
    normalized.name = String(firstValue(item, ['name', 'corpName']) || '—');
    normalized.code = String(firstValue(item, ['code', 'symbol']) || '');
    normalized.market = firstValue(item, ['market', 'marketName', 'exchange']) || '—';
    normalized.sector = cleanIndustryLabel(firstValue(item, ['sector', 'industry', 'wicsSector']));
    normalized.price = firstValue(item, ['price', 'currentPrice', 'close']);
    normalized.cashDividendPerShare = firstValue(item, ['cashDividendPerShare', 'dividend', 'dps']);
    normalized.dividendYieldPct = firstValue(item, ['dividendYieldPct', 'dividendYield', 'yieldPct']);
    normalized.payoutRatioPct = firstValue(item, ['payoutRatioPct', 'payoutRatio']);
    normalized.roe = firstValue(item, ['roe', 'roePct']);
    normalized.per = firstValue(item, ['per', 'perValue']);
    normalized.pbr = firstValue(item, ['pbr', 'pbrValue']);
    normalized.reportYear = firstValue(item, ['reportYear', 'dividendYear', 'fiscalYear']);
    normalized.dividendStatus = firstValue(item, ['dividendStatus', 'dividendType']) || (item.isEstimated ? '예상' : '실제');
    normalized.changeRate = firstValue(item, ['changeRate', 'change_rate', 'changeRatePct']);
    return normalized;
  }

  function findItemByCode(key, code) {
    return allMatches(key).filter(function (item) { return String(item.code) === String(code); })[0] || null;
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
      ['return12m', '12개월 수익률'], ['changeUp', '상승률'], ['changeDown', '하락률'],
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

  function etfFilteredMatches(key) {
    var query = etfSearchQuery.trim().toUpperCase();
    return allMatches(key).filter(function (item) {
      var name = String(item.name || '').toUpperCase();
      var code = String(item.code || '').toUpperCase();
      if (query && name.indexOf(query) === -1 && code.indexOf(query) === -1) return false;
      if (activeEtfFilters.major && etfMajor(item) !== activeEtfFilters.major) return false;
      if (activeEtfFilters.middle && etfMiddle(item) !== activeEtfFilters.middle) return false;
      if (activeEtfFilters.leverage && etfType(item) !== activeEtfFilters.leverage) return false;
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
      else if (activeEtfSort === 'newListing') { av = a.listedDate; bv = b.listedDate; return String(bv || '').localeCompare(String(av || '')); }
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
    return '<tr class="ss-table-row ss-row" data-code="' + escapeAttr(item.code) + '" data-name="' + escapeAttr(item.name) + '" tabindex="0" role="button">'
      + '<td class="ss-col-watch" data-label="관심등록">' + watchButtonHtml(item) + '</td>'
      + '<td class="ss-col-rank" data-label="순위">' + (index + 1) + '</td>'
      + '<td class="ss-col-product" data-label="상품명"><strong>' + stockIconHtml(item.code) + '<span>' + escapeHtml(item.name) + '</span></strong></td>'
      + '<td class="ss-col-code" data-label="종목코드">' + escapeHtml(item.code || '—') + '</td>'
      + '<td class="ss-col-provider" data-label="운용사">' + escapeHtml(item.provider || '—') + '</td>'
      + '<td class="ss-col-price" data-label="현재가">' + fmtWon(item.price) + '</td>'
      + '<td class="ss-col-change ' + rateClass + '" data-label="전일대비">' + fmtChange(item.changeRate) + '</td>'
      + '<td class="ss-col-type" data-label="유형">' + escapeHtml(etfType(item)) + '</td>'
      + '<td class="ss-col-return ' + chgClass(item.returnRate1mPct) + '" data-label="1개월">' + fmtPct(item.returnRate1mPct) + '</td>'
      + '<td class="ss-col-return ' + chgClass(item.returnRate3mPct) + '" data-label="3개월">' + fmtPct(item.returnRate3mPct) + '</td>'
      + '<td class="ss-col-return ' + chgClass(item.returnRate6mPct) + '" data-label="6개월">' + fmtPct(item.returnRate6mPct) + '</td>'
      + '<td class="ss-col-return ' + chgClass(item.returnRate12mPct) + '" data-label="12개월">' + fmtPct(item.returnRate12mPct) + '</td>'
      + '</tr>';
  }

  function renderEtfProductView(key) {
    var matches = sortEtfMatches(etfFilteredMatches(key));
    var all = allMatches(key);
    var majors = Array.from(new Set(all.map(etfMajor).filter(Boolean))).sort();
    var middles = Array.from(new Set(all.map(etfMiddle).filter(Boolean))).sort();
    var controls = '<div class="ss-product-toolbar">'
      + '<label>정렬 <select class="ss-etf-control" data-etf-filter="sort">' + etfSortOptions() + '</select></label>'
      + '<label>대분류 <select class="ss-etf-control" data-etf-filter="major">' + optionList(majors, activeEtfFilters.major) + '</select></label>'
      + '<label>중분류 <select class="ss-etf-control" data-etf-filter="middle">' + optionList(middles, activeEtfFilters.middle) + '</select></label>'
      + '<label>운용배수 <select class="ss-etf-control" data-etf-filter="leverage"><option value="">전체</option><option value="일반"' + (activeEtfFilters.leverage === '일반' ? ' selected' : '') + '>일반</option><option value="레버리지"' + (activeEtfFilters.leverage === '레버리지' ? ' selected' : '') + '>레버리지</option><option value="인버스"' + (activeEtfFilters.leverage === '인버스' ? ' selected' : '') + '>인버스</option></select></label>'
      + '<input type="search" class="ss-etf-search-input" placeholder="상품명 또는 코드 검색" value="' + escapeAttr(etfSearchQuery) + '" aria-label="ETF 검색">'
      + '</div>';
    var table = '<div class="ss-table-wrap"><table class="ss-comparison-table ss-etf-table"><thead><tr>'
      + ['관심', '순위', '상품명', '종목코드', '운용사', '현재가', '전일대비', '유형', '1개월 수익률', '3개월 수익률', '6개월 수익률', '12개월 수익률'].map(function (label) { return '<th>' + label + '</th>'; }).join('')
      + '</tr></thead><tbody>' + matches.map(etfTableRow).join('') + '</tbody></table></div>';
    return controls + (matches.length ? table : '<div class="ss-product-empty">조건에 맞는 ETF가 없습니다.</div>');
  }

  function dividendSortOptions(matches) {
    var entries = [['yield', '수익률순'], ['dps', '배당금순']];
    if (matches.some(function (item) { return item.payoutRatioPct != null; })) entries.push(['payout', '배당성향순']);
    return entries.map(function (entry) {
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
      else { av = a.payoutRatioPct; bv = b.payoutRatioPct; }
      var aMissing = av == null || isNaN(Number(av));
      var bMissing = bv == null || isNaN(Number(bv));
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      av = aMissing ? 0 : Number(av); bv = bMissing ? 0 : Number(bv);
      if (av !== bv) return bv - av;
      return String(a.code || '').localeCompare(String(b.code || ''));
    });
  }

  function dividendTableColumns(matches) {
    var columns = [
      { label: '관심', html: function (item) { return '<td class="ss-col-watch" data-label="관심">' + watchButtonHtml(item) + '</td>'; } },
      { label: '순위', html: function (item, index) { return '<td class="ss-col-rank" data-label="순위">' + (index + 1) + '</td>'; } },
      { label: '종목명', html: function (item) { return '<td class="ss-col-product" data-label="종목명"><strong>' + stockIconHtml(item.code) + '<span>' + escapeHtml(item.name) + '</span></strong></td>'; } },
      { label: '종목코드', cls: 'ss-col-code', html: function (item) { return '<td class="ss-col-code" data-label="종목코드">' + escapeHtml(item.code || '—') + '</td>'; } },
      { label: '업종', cls: 'ss-col-sector', html: function (item) { return '<td class="ss-col-sector" data-label="업종">' + escapeHtml(cleanIndustryLabel(item.sector)) + '</td>'; } },
      { label: '현재가', cls: 'ss-col-price', html: function (item) { return '<td class="ss-col-price" data-label="현재가">' + fmtWon(item.price) + '</td>'; } },
      { label: '배당금', html: function (item) { return '<td data-label="배당금">' + fmtWon(item.cashDividendPerShare) + ' <small class="ss-dividend-status">' + escapeHtml(item.dividendStatus || '실제') + '</small></td>'; } },
      { label: '배당수익률', html: function (item) { return '<td data-label="배당수익률">' + fmtPctExact(item.dividendYieldPct) + '</td>'; } }
    ];
    if (matches.some(function (item) { return item.payoutRatioPct != null; })) {
      columns.push({ label: '배당성향', html: function (item) { return '<td data-label="배당성향">' + fmtPct(item.payoutRatioPct) + '</td>'; } });
    }
    if (matches.some(function (item) { return dividendHistoryValue(item, 2) != null; })) {
      columns.push({ label: '2년 전 배당금', html: function (item) { return '<td data-label="2년 전 배당금">' + fmtWon(dividendHistoryValue(item, 2)) + '</td>'; } });
    }
    if (matches.some(function (item) { return dividendHistoryValue(item, 3) != null; })) {
      columns.push({ label: '3년 전 배당금', html: function (item) { return '<td data-label="3년 전 배당금">' + fmtWon(dividendHistoryValue(item, 3)) + '</td>'; } });
    }
    return columns;
  }

  function dividendTableRow(item, index, columns) {
    var payout = item.payoutRatioPct;
    var warning = payout != null && (Number(payout) < 0 || Number(payout) > 100) ? '배당성향 ' + (Number(payout) > 100 ? '100% 초과' : '음수') + ' · 지속 가능성 확인 필요' : '';
    var row = '<tr class="ss-table-row ss-row" data-code="' + escapeAttr(item.code) + '" data-name="' + escapeAttr(item.name) + '" tabindex="0" role="button">'
      + columns.map(function (column) { return column.html(item, index); }).join('')
      + '</tr>';
    return row + (warning ? '<tr class="ss-warning-row"><td class="ss-row-warning" colspan="' + columns.length + '">' + escapeHtml(warning) + '</td></tr>' : '');
  }

  function renderDividendTable() {
    var matches = sortedDividendMatches();
    var columns = dividendTableColumns(matches);
    var table = '<div class="ss-table-wrap"><table class="ss-comparison-table ss-dividend-table"><thead><tr>'
      + columns.map(function (column) { return '<th>' + column.label + '</th>'; }).join('')
      + '</tr></thead><tbody>' + matches.map(function (item, index) { return dividendTableRow(item, index, columns); }).join('') + '</tbody></table></div>';
    var reportYears = matches.map(function (item) { return Number(item.reportYear); }).filter(function (year) { return isFinite(year) && year > 0; });
    var reportYear = reportYears.length ? Math.max.apply(Math, reportYears) : null;
    var basis = reportYear ? '최근 결산 연도 기준 · 배당 데이터 ' + reportYear + '년 결산' : '최근 결산 연도 기준 · 배당 기준일 확인 대기';
    return '<div class="ss-dividend-toolbar"><label>시장 <select class="ss-dividend-sort-select" data-dividend-filter="market"><option value="">전체</option><option value="KOSPI"' + (activeDividendMarket === 'KOSPI' ? ' selected' : '') + '>KOSPI</option><option value="KOSDAQ"' + (activeDividendMarket === 'KOSDAQ' ? ' selected' : '') + '>KOSDAQ</option></select></label><label>정렬 <select class="ss-dividend-sort-select" data-dividend-filter="sort">' + dividendSortOptions(matches) + '</select></label></div>'
      + '<p class="ss-dividend-basis">' + escapeHtml(basis) + '</p>'
      + (matches.length ? table : '<div class="ss-product-empty">배당 데이터가 없습니다.</div>');
  }

  var dividendModalOverlay = null;

  function closeDividendInfoModal() {
    if (!dividendModalOverlay) return;
    dividendModalOverlay.remove();
    dividendModalOverlay = null;
    document.removeEventListener('keydown', onDividendModalKeydown);
  }

  function onDividendModalKeydown(event) {
    if (event.key === 'Escape') closeDividendInfoModal();
  }

  function dividendModalValue(value, suffix) {
    return value == null || value === '' ? '—' : escapeHtml(String(value)) + (suffix || '');
  }

  function dividendHistoryRows(item) {
    return (item && (item.dividendHistory || item.dividendYears) || []).slice().sort(function (a, b) {
      return Number(b.year || 0) - Number(a.year || 0);
    });
  }

  function openDividendInfoModal(code, name, item) {
    closeDividendInfoModal();
    item = item || { code: code, name: name };
    var history = dividendHistoryRows(item);
    var facts = [
      ['종목명', item.name || name], ['종목코드', item.code || code],
      ['시장', item.market], ['업종', cleanIndustryLabel(item.sector)],
      ['현재가', fmtWon(item.price)],
      ['주당 현금배당금', fmtWon(item.cashDividendPerShare)],
      ['배당수익률', fmtPctExact(item.dividendYieldPct)],
      ['배당성향', fmtPct(item.payoutRatioPct)],
      ['ROE', fmtPct(item.roe)], ['PER', fmtMultiple(item.per)], ['PBR', fmtMultiple(item.pbr)],
      ['배당 기준연도', item.reportYear ? String(item.reportYear) + '년 결산' : null]
    ];
    var overlay = document.createElement('div');
    overlay.className = 'ss-dividend-modal-overlay';
    overlay.innerHTML = '<div class="ss-dividend-modal" role="dialog" aria-modal="true" aria-label="'
      + escapeAttr(item.name || name) + ' 배당 정보">'
      + '<div class="ss-dividend-modal-head"><strong>' + escapeHtml(item.name || name) + ' 배당 정보</strong>'
      + '<button type="button" class="ss-dividend-modal-close" aria-label="닫기">✕</button></div>'
      + '<div class="ss-dividend-modal-body">'
      + '<dl class="ss-dividend-facts">' + facts.map(function (fact) {
        return '<div><dt>' + escapeHtml(fact[0]) + '</dt><dd>' + dividendModalValue(fact[1]) + '</dd></div>';
      }).join('') + '</dl>'
      + '<div class="ss-dividend-history"><strong>최근 배당 이력</strong>'
      + (history.length ? '<ul>' + history.slice(0, 4).map(function (row) {
        var year = row.year || row.reportYear || '기준연도';
        var value = row.cashDividendPerShare != null ? row.cashDividendPerShare : row.dps;
        return '<li><span>' + escapeHtml(String(year)) + '년</span><b>' + fmtWon(value) + '</b></li>';
      }).join('') + '</ul>' : '<p>배당 이력이 없습니다.</p>')
      + '</div></div></div>';
    document.body.appendChild(overlay);
    dividendModalOverlay = overlay;
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeDividendInfoModal();
    });
    overlay.querySelector('.ss-dividend-modal-close').addEventListener('click', closeDividendInfoModal);
    document.addEventListener('keydown', onDividendModalKeydown);
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

  function cardNote(key) {
    if (key === 'undervalued') return '장기 가격 눌림 상위 후보';
    return '전략 조건을 충족한 후보군';
  }

  function rowHtml(it) {
    var cc = chgClass(it.changeRate);
    var primary = '';
    var secondary = '';
    var basis = it.date ? '기준일 ' + it.date : '';
    if (it.disparity != null) {
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
      + '<div class="ss-row-top"><span class="ss-row-name">' + stockIconHtml(it.code) + '<span>' + escapeHtml(it.name) + '</span><span class="ss-row-code">(' + escapeHtml(it.code) + ')</span></span></div>'
      + '<div class="ss-row-primary">' + escapeHtml(primary) + '</div>'
      + (secondary ? '<div class="ss-row-secondary">' + (it.strategy === 'etfReturn' ? secondary : escapeHtml(secondary)) + '</div>' : '')
      + '<div class="ss-row-bottom"><span class="ss-row-quote"><span class="ss-row-price">' + fmt(it.price) + '</span><span class="ss-row-rate ' + cc + '">' + chgSign(it.changeRate) + '</span></span>'
      + (basis ? '<span class="ss-row-basis">' + escapeHtml(basis) + '</span>' : '') + '</div>'
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
  function fmtChange(rt) { return rt == null || isNaN(Number(rt)) ? '—' : chgSign(rt); }
  function fmt(n) { return n == null || isNaN(Number(n)) ? '—' : Math.round(Number(n)).toLocaleString('ko-KR'); }
  function fmtWon(n) { return n == null || isNaN(Number(n)) ? '—' : fmt(n) + '원'; }
  function fmtPct(n) { return n == null || isNaN(Number(n)) ? '—' : Number(n).toFixed(1) + '%'; }
  function fmtPctExact(n) { return n == null || isNaN(Number(n)) ? '—' : Number(n).toFixed(2) + '%'; }
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
      + '<td class="ss-etf-comp-name">' + stockIconHtml(item.code) + '<span>' + escapeHtml(item.name || item.code || '-') + '</span></td>'
      + '<td class="ss-etf-comp-weight">' + fmtPct(item.weightPct) + '</td>'
      + '<td>' + fmt(item.price) + '원</td>'
      + '<td class="' + cls + '">' + chgSign(item.changeRatePct) + '</td>'
      + '</tr>';
  }

  function modalValue(value, suffix) {
    return value == null || value === '' ? '—' : escapeHtml(String(value)) + (suffix || '');
  }

  function renderEtfComponentsBody(body, data, product) {
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
    product = product || {};
    var deviation = firstValue(data, ['deviationRate', 'deviationRatePct', 'trackingError', '괴리율']);
    var aum = firstValue(data, ['aum', 'assets', 'assetUnderManagement']) || product.aum;
    var fee = firstValue(data, ['totalExpenseRatio', 'expenseRatio', 'fee']);
    var listedDate = firstValue(data, ['listedDate', 'listingDate']) || product.listedDate;
    var underlyingIndex = firstValue(data, ['underlyingIndex', 'baseIndex', 'indexName']);
    var modalFacts = [
      ['상품명', product.name || data.name], ['종목코드', product.code || data.code],
      ['운용사', product.provider], ['현재가', firstValue(data, ['price', 'currentPrice']) || product.price, '원'],
      ['NAV', data.nav], ['괴리율', deviation, '%'], ['운용자산', aum], ['총보수', fee, '%'],
      ['상장일', listedDate], ['기초지수', underlyingIndex], ['구성종목 수', totalCount, '개'],
      ['데이터 기준일', basisDate || product.date]
    ];
    modalFacts = modalFacts.filter(function (fact) { return fact[1] != null && String(fact[1]).trim() !== ''; });
    body.innerHTML = '<div class="ss-etf-facts">' + modalFacts.map(function (fact) {
      return '<div><dt>' + escapeHtml(fact[0]) + '</dt><dd>' + modalValue(fact[1], fact[2]) + '</dd></div>';
    }).join('') + '</div>'
      + '<div class="ss-etf-summary">'
      + '<span>현재가 <b class="' + summaryCls + '">' + fmtWon(firstValue(data, ['price', 'currentPrice']) || product.price) + ' ' + fmtChange(data.changeRatePct != null ? data.changeRatePct : product.changeRate) + '</b></span>'
      + '<span>상위 10종목 비중 <b>' + top10Weight.toFixed(1) + '%</b></span>'
      + '<span>현재 표시 <b>' + components.length + '개</b></span>'
      + '</div>'
      + '<div class="ss-etf-table-wrap"><table class="ss-etf-table">'
      + '<thead><tr><th>순위</th><th>종목명</th><th>비중</th><th>현재가</th><th>등락률</th></tr></thead>'
      + '<tbody>' + components.map(etfComponentRowHtml).join('') + '</tbody>'
      + '</table></div>';
  }

  function openEtfComponentsModal(code, name, product) {
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
        renderEtfComponentsBody(body, (payload && payload.data) || payload, product);
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
