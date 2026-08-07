/**
 * 9bolt 스킨 공통 스크립트 (git 관리)
 * 원래 skin.html 하단 인라인 <script> 블록에 있던 코드를 그대로 이전한 것.
 * 수정 후 push하면 GitHub Pages 캐시(최대 10분) 지나 블로그에 반영된다.
 *
 * skin.html에는 다음만 남아 있어야 함:
 *  - head의 다크모드/폰트 조기 적용 스크립트 (FOUC 방지 - 외부화 금지)
 *  - head의 full-width-page 경로 감지 스크립트
 *  - 피드의 pinnedNotice 스크립트 (피드 마크업과 한 몸)
 *  - 이 파일과 skin-menu.js를 불러오는 <script src> 두 줄
 *
 * 포함 기능: iframe 모드 / 다크모드·폰트 토글 / 카테고리 파싱·필터 탭 /
 * 아티클 모달 / 공유·더보기 / 표 스크롤 래핑 / 요약 줄바꿈 / 모바일 드로어·검색
 *
 * 2026-07-17(9차): KRX 공시 티커 fetch/파싱/렌더 로직을 js/quick-indices.js로 옮겼다
 * (관심지수 바의 "긴급속보" 패널로 흡수) - 이 파일에서는 제거됨.
 *
 * 2026-07-22: 증시캘린더(구글 캘린더 위젯)를 이 파일의 중앙 모달(openCalendarModal)
 * 방식에서 독립 페이지(js/stock-calendar.js, #stock-calendar 마운트)로 옮겼다 - 여기
 * 있던 openCalendarModal/initCalendarWidget은 삭제됨.
 */
  /* ── iframe 모드 감지 (모달 안에서 열릴 때 껍데기 숨김) ── */
  if (window !== window.top) {
    document.body.classList.add('iframe-mode');
  }

  /* ── 다크모드 토글 (조기 적용 스크립트는 head에 있음) ── */
  (function() {
    var btn = document.getElementById('darkModeBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var on = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('bolt-dark', on ? '1' : '0'); } catch (e) {}
    });
  })();

  /* 시세·증시온도 페이지의 공통 시각 개선은 페이지별 위젯이 비동기로 DOM을
     만든 뒤에도 연결되어야 하므로 별도 모듈로 지연 로드한다. */
  (function loadDashboardEnhancements() {
    if (document.querySelector('script[data-dashboard-enhancements]')) return;
    var script = document.createElement('script');
    script.src = 'https://goodbyestarwars.github.io/tistory-ticker/js/dashboard-enhancements.js?v=20260807-2';
    script.defer = true;
    script.setAttribute('data-dashboard-enhancements', '1');
    document.body.appendChild(script);
  })();

  /* 홈은 기존 위젯/API를 시장 상황판 구조로 재배치한다. 백엔드 계산과 URL은 그대로 두고,
     여기서는 카드 배치·요약 집계·수급 부호 기반 규칙문만 담당한다. */
  (function buildHomeDashboard() {
    if (location.pathname !== '/' && location.pathname !== '') return;
    var feed = document.querySelector('.feed');
    var investorMount = document.getElementById('investor-trend-widget');
    var rankMount = document.getElementById('sidebar-rank');
    if (!feed || !investorMount || !rankMount) return;

    var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
    var CALENDAR_SCRIPT_URL = 'https://goodbyestarwars.github.io/tistory-ticker/js/stock-calendar.js';
    var HOME_WIDGETS_SCRIPT_URL = document.currentScript && document.currentScript.src
      ? document.currentScript.src.replace(/skin-main(?:\.min)?\.js(?:\?.*)?$/, 'home-widgets.js')
      : 'https://goodbyestarwars.github.io/tistory-ticker/js/home-widgets.js';
    var homeState = { foreign: null, institution: null, flowReady: false };

    function escapeHomeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fetchHomeJson(url, timeoutMs) {
      var hasAbort = 'AbortController' in window;
      var controller = hasAbort ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 15000) : null;
      return fetch(url, controller ? { signal: controller.signal } : {})
        .then(function (response) {
          if (!response.ok) throw new Error('홈 데이터 응답 오류: ' + response.status);
          return response.json();
        })
        .then(function (data) {
          if (timer) clearTimeout(timer);
          return data;
        })
        .catch(function (error) {
          if (timer) clearTimeout(timer);
          throw error;
        });
    }

    function readHomeDataCache(key, maxAgeMs) {
      try {
        var cached = JSON.parse(localStorage.getItem(key) || 'null');
        if (!cached || !cached.data || !cached.savedAt) return null;
        if (Date.now() - Number(cached.savedAt) > maxAgeMs) return null;
        return cached.data;
      } catch (error) {
        return null;
      }
    }

    function writeHomeDataCache(key, data) {
      try {
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: data }));
      } catch (error) {
        /* 저장 공간이 없으면 이번 응답만 표시한다. */
      }
    }

    function loadHomeScript(src, globalName) {
      if (window[globalName]) return Promise.resolve(window[globalName]);
      return new Promise(function (resolve, reject) {
        var existing = document.querySelector('script[data-home-source="' + src + '"]');
        var settled = false;
        var timeout = setTimeout(function () {
          finish(new Error(globalName + ' 스크립트 로드 시간 초과'));
        }, 10000);

        function finish(error) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve(window[globalName]);
        }

        function bind(script) {
          script.addEventListener('load', function () {
            script.setAttribute('data-home-state', 'loaded');
            finish(window[globalName] ? null : new Error(globalName + ' 모듈 없음'));
          }, { once: true });
          script.addEventListener('error', function () {
            script.setAttribute('data-home-state', 'error');
            finish(new Error(globalName + ' 스크립트 로드 실패'));
          }, { once: true });
        }

        if (existing) {
          if (existing.getAttribute('data-home-state') === 'loaded') {
            finish(window[globalName] ? null : new Error(globalName + ' 모듈 없음'));
            return;
          }
          if (existing.getAttribute('data-home-state') === 'error') existing.remove();
          else {
            bind(existing);
            return;
          }
        }
        if (window[globalName]) {
          finish();
          return;
        }
        var script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.setAttribute('data-home-source', src);
        script.setAttribute('data-home-state', 'loading');
        bind(script);
        document.head.appendChild(script);
      });
    }

    function dashboardHtml() {
      return '<section class="home-dashboard" aria-label="오늘의 시장 상황판">'
        + '<div class="home-overview-grid">'
        + '<div class="home-investor-slot"></div>'
        + '<article class="card home-market-board" id="homeMarketBoard">'
        + '<div class="home-card-heading"><div><strong>오늘의 시장판</strong><span id="hmbUpdated">기존 시장 데이터 기준</span></div></div>'
        + '<dl class="hmb-list">'
        + '<div><dt>증시온도</dt><dd data-market-field="temperature">데이터 확인 중</dd></div>'
        + '<div><dt>시장 방향</dt><dd data-market-field="direction">데이터 확인 중</dd></div>'
        + '<div><dt>외국인</dt><dd data-market-field="foreign">데이터 확인 중</dd></div>'
        + '<div><dt>기관</dt><dd data-market-field="institution">데이터 확인 중</dd></div>'
        + '<div><dt>원/달러</dt><dd data-market-field="exchange">데이터 확인 중</dd></div>'
        + '<div><dt>주도 업종</dt><dd data-market-field="leaders">데이터 확인 중</dd></div>'
        + '<div><dt>주의 업종</dt><dd data-market-field="cautions">데이터 확인 중</dd></div>'
        + '</dl>'
        + '<p class="hmb-interpretation" data-market-field="interpretation">수급 데이터 확인 중입니다.</p>'
        + '</article></div>'
        + '<div class="home-card-grid">'
        + '<div class="home-rank-slot"></div>'
        + '<article class="card home-mini-card home-pattern-card">'
        + '<div class="home-card-heading"><div><strong>오늘의 패턴</strong><span id="homePatternUpdated"></span></div></div>'
        + '<p class="home-pattern-explainer">오늘 신규 발견은 최신 스캔 거래일에 패턴 조건을 만족한 고유 종목 수입니다 · 신규 상장 의미 아님</p>'
        + '<div class="home-pattern-list" id="homePatternList"><p class="home-card-state">패턴 데이터를 불러오는 중...</p></div>'
        + '<a class="home-card-more" href="/page/pattern-scan">패턴 종목 보기 →</a>'
        + '</article>'
        + '<article class="card home-mini-card home-schedule-card">'
        + '<div class="home-card-heading"><div><strong>주요 일정</strong><span id="homeScheduleLabel">오늘 또는 가장 가까운 일정</span></div></div>'
        + '<div class="home-schedule-list" id="homeScheduleList"><p class="home-card-state">일정을 불러오는 중...</p></div>'
        + '<a class="home-card-more" href="/page/stock-calendar">전체 일정 보기 →</a>'
        + '</article></div></section>';
    }

    var dashboard = document.createElement('div');
    dashboard.innerHTML = dashboardHtml();
    var dashboardSection = dashboard.firstElementChild;
    feed.insertBefore(dashboardSection, investorMount);
    dashboardSection.querySelector('.home-investor-slot').appendChild(investorMount);
    dashboardSection.querySelector('.home-rank-slot').appendChild(rankMount);
    var oldSidebar = document.querySelector('.sidebar-right');
    if (oldSidebar) oldSidebar.hidden = true;

    function field(name) {
      return dashboardSection.querySelector('[data-market-field="' + name + '"]');
    }

    function setField(name, text, tone) {
      var element = field(name);
      if (!element) return;
      element.textContent = text;
      element.classList.remove('home-positive', 'home-negative', 'home-neutral');
      if (tone) element.classList.add(tone);
    }

    function formatFlow(value) {
      if (value == null || isNaN(value)) return '데이터 확인 중';
      if (value === 0) return '0억';
      var sign = value > 0 ? '+' : '-';
      var absolute = Math.abs(value);
      return absolute >= 10000
        ? sign + (absolute / 10000).toFixed(1) + '조'
        : sign + Math.round(absolute).toLocaleString('ko-KR') + '억';
    }

    function renderRuleInterpretation() {
      if (!homeState.flowReady) {
        setField('interpretation', '장 마감 후 수급 데이터가 업데이트됩니다.', 'home-neutral');
        return;
      }
      if (homeState.flowStale) {
        setField('interpretation', '장 마감 후 마지막 정상 확정 수급을 표시하고 있습니다.', 'home-neutral');
        return;
      }
      var foreign = homeState.foreign;
      var institution = homeState.institution;
      var sentence;
      if (foreign > 0 && institution > 0) sentence = '외국인과 기관이 동반 순매수 중입니다.';
      else if (foreign < 0 && institution > 0) sentence = '외국인 매도 물량을 기관이 일부 받아내고 있습니다.';
      else if (foreign > 0 && institution < 0) sentence = '기관 매도에도 외국인이 시장을 방어하고 있습니다.';
      else if (foreign < 0 && institution < 0) sentence = '외국인과 기관이 동반 매도하며 수급 부담이 큽니다.';
      else sentence = '수급 방향이 뚜렷하지 않아 추가 확인이 필요합니다.';
      setField('interpretation', sentence, 'home-neutral');
    }

    window.addEventListener('investor-trend-data', function (event) {
      var detail = event.detail || {};
      if (detail.period !== 'day' || detail.market !== 'kospi') return;
      var rows = detail.result && detail.result.rows;
      var latestRow = rows && rows.length ? rows[rows.length - 1] : null;
      var validRows = (rows || []).filter(function (row) {
        return [row && row.ind, row && row.frgn, row && row.orgn].some(function (value) {
          return value != null && isFinite(Number(value)) && Number(value) !== 0;
        });
      });
      var latest = validRows.length ? validRows[validRows.length - 1] : null;
      if (!latest) {
        setField('foreign', '장 마감 후 업데이트', 'home-neutral');
        setField('institution', '장 마감 후 업데이트', 'home-neutral');
        homeState.flowReady = false;
        homeState.flowStale = false;
        renderRuleInterpretation();
        return;
      }
      homeState.foreign = Number(latest.frgn);
      homeState.institution = Number(latest.orgn);
      homeState.flowReady = !isNaN(homeState.foreign) && !isNaN(homeState.institution);
      homeState.flowStale = latestRow !== latest;
      setField('foreign', formatFlow(homeState.foreign), homeState.foreign > 0 ? 'home-positive' : homeState.foreign < 0 ? 'home-negative' : 'home-neutral');
      setField('institution', formatFlow(homeState.institution), homeState.institution > 0 ? 'home-positive' : homeState.institution < 0 ? 'home-negative' : 'home-neutral');
      renderRuleInterpretation();
    });

    function sectorSummary(data) {
      var groups = {};
      var all = data && data.data ? (data.data.KOSPI || []).concat(data.data.KOSDAQ || []) : [];
      all.forEach(function (item) {
        if (typeof item.changeRate !== 'number') return;
        (item.sectors || []).forEach(function (sector) {
          if (!groups[sector]) groups[sector] = { total: 0, count: 0 };
          groups[sector].total += item.changeRate;
          groups[sector].count += 1;
        });
      });
      var rows = Object.keys(groups).map(function (sector) {
        return { sector: sector, average: groups[sector].total / groups[sector].count };
      }).sort(function (a, b) { return b.average - a.average; });
      return {
        leaders: rows.filter(function (item) { return item.average > 0; }).slice(0, 3),
        cautions: rows.filter(function (item) { return item.average < 0; }).slice(-3).reverse()
      };
    }

    function resolveMarketDirection(marketTemp) {
      var components = marketTemp && marketTemp.components;
      var rise = components && components.riseRatio;
      var avgChange = components && components.avgChange;
      var riseRatio = rise && typeof rise.ratio === 'number' ? rise.ratio : null;
      var averageRate = avgChange && typeof avgChange.avgChangeRate === 'number'
        ? avgChange.avgChangeRate
        : null;

      // 증시온도 계산에 이미 포함된 전체 시장 상승 비율과 평균등락률을 함께 본다.
      // 숫자가 없는 경우에는 임의 상태를 만들지 않는다.
      if (riseRatio != null && averageRate != null && riseRatio <= 0.15 && averageRate <= -1) {
        return { label: '급락', tone: 'home-negative' };
      }
      if ((riseRatio != null && riseRatio <= 0.3) || (averageRate != null && averageRate <= -1)) {
        return { label: '강한 약세', tone: 'home-negative' };
      }
      if (riseRatio != null && averageRate != null && riseRatio >= 0.85 && averageRate >= 1) {
        return { label: '급등', tone: 'home-positive' };
      }
      if ((riseRatio != null && riseRatio >= 0.7) || (averageRate != null && averageRate >= 1)) {
        return { label: '강한 강세', tone: 'home-positive' };
      }
      if (riseRatio != null && riseRatio <= 0.45) return { label: '약세 우위', tone: 'home-negative' };
      if (riseRatio != null && riseRatio >= 0.55) return { label: '상승 우위', tone: 'home-positive' };
      if (riseRatio != null || averageRate != null) {
        return { label: '혼조', tone: 'home-neutral' };
      }
      return { label: '데이터 확인 중', tone: 'home-neutral' };
    }

    function renderMarketTemperature(market) {
      if (market && typeof market.temp === 'number') {
        var grade = market.grade && market.grade.label ? ' ' + market.grade.label : '';
        setField('temperature', market.temp.toFixed(market.temp % 1 ? 1 : 0) + '℃' + grade, 'home-neutral');
        var direction = resolveMarketDirection(market);
        setField('direction', direction.label, direction.tone);
        var exchange = market.components && market.components.exchange;
        if (exchange && typeof exchange.price === 'number') {
          var exchangeRate = Number(exchange.changeRate);
          var arrow = exchangeRate > 0 ? ' ▲' : exchangeRate < 0 ? ' ▼' : '';
          setField('exchange', exchange.price.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '원' + arrow,
            exchangeRate > 0 ? 'home-positive' : exchangeRate < 0 ? 'home-negative' : 'home-neutral');
        }
        var updated = document.getElementById('hmbUpdated');
        if (updated && market.updatedAt) updated.textContent = market.updatedAt + ' 기준';
      }
    }

    function renderMarketSectors(bubble) {
      var summary = sectorSummary(bubble);
      setField('leaders', summary.leaders.length ? summary.leaders.map(function (item) { return item.sector; }).join(' · ') : '데이터 확인 중', 'home-positive');
      setField('cautions', summary.cautions.length ? summary.cautions.map(function (item) { return item.sector; }).join(' · ') : '데이터 확인 중', 'home-negative');
    }

    var marketTempCacheKey = 'home_market_temp_v1';
    var marketSectorCacheKey = 'home_market_sectors_v1';
    var cachedMarketTemp = readHomeDataCache(marketTempCacheKey, 10 * 60 * 1000);
    var cachedMarketSectors = readHomeDataCache(marketSectorCacheKey, 30 * 60 * 1000);
    if (cachedMarketTemp) renderMarketTemperature(cachedMarketTemp);
    if (cachedMarketSectors) renderMarketSectors(cachedMarketSectors);

    fetchHomeJson(GAS_TICKER_URL + '?marketTemp=1', 12000)
      .then(function (market) {
        writeHomeDataCache(marketTempCacheKey, market);
        renderMarketTemperature(market);
      })
      .catch(function () {
        if (!cachedMarketTemp) {
          setField('temperature', '일시 지연', 'home-neutral');
          setField('direction', '데이터 확인 중', 'home-neutral');
          setField('exchange', '일시 지연', 'home-neutral');
        }
      });

    // 시총 버블은 전 종목·업종을 여러 배치로 묶어 만드는 느린 응답이다.
    // 첫 페인트와 수급/패턴/랭킹 렌더를 막지 않고, 브라우저가 유휴 상태가 된 뒤
    // 업종 요약만 채운다. 이전 정상 응답은 위에서 즉시 재사용한다.
    var loadHomeSectors = function () {
      fetchHomeJson(GAS_TICKER_URL + '?bubble=1', 12000)
        .then(function (bubble) {
          writeHomeDataCache(marketSectorCacheKey, bubble);
          renderMarketSectors(bubble);
        })
        .catch(function () {
          if (!cachedMarketSectors) {
            setField('leaders', '일시 지연', 'home-neutral');
            setField('cautions', '일시 지연', 'home-neutral');
          }
        });
    };
    if (window.requestIdleCallback) window.requestIdleCallback(loadHomeSectors, { timeout: 2500 });
    else setTimeout(loadHomeSectors, 0);

    function renderPatterns(data) {
      var list = document.getElementById('homePatternList');
      if (!list) return;
      var patterns = (data && data.patterns) || {};
      var items = [
        { key: 'risingLows', label: '저점상승형' },
        { key: 'doubleBottom', label: '쌍바닥' },
        { key: 'invHeadShoulders', label: '역헤드앤숄더' },
        { key: 'boxRangeLow', label: '박스권 하단' }
      ];
      function patternItems(item) {
        return Array.isArray(patterns[item.key]) ? patterns[item.key] : [];
      }
      function rateText(value) {
        var rate = Number(value);
        if (isNaN(rate)) return '';
        return (rate > 0 ? '+' : '') + rate.toFixed(2) + '%';
      }
      function renderPatternOverview() {
        list.innerHTML = items.map(function (item) {
          var count = patternItems(item).length;
          return '<button type="button" class="home-pattern-row" data-pattern-key="' + item.key + '"'
            + ' aria-expanded="false" aria-controls="homePatternPreview">'
            + '<span>' + item.label + '</span><strong>' + count.toLocaleString('ko-KR') + '종목'
            + '<span class="home-pattern-chevron" aria-hidden="true">›</span></strong></button>';
        }).join('')
          + '<div class="home-pattern-new" title="최신 스캔 거래일에 패턴 조건을 만족한 고유 종목 수입니다. 신규 상장 종목 수가 아닙니다."><span>오늘 신규 발견</span><strong>'
          + Object.keys(newCodes).length.toLocaleString('ko-KR') + '종목</strong></div>';

        list.querySelectorAll('.home-pattern-row').forEach(function (button) {
          button.addEventListener('click', function () {
            var key = button.getAttribute('data-pattern-key');
            var item = items.filter(function (candidate) { return candidate.key === key; })[0];
            if (item) renderPatternPreview(item);
          });
        });
      }
      function renderPatternPreview(item) {
        var stocks = patternItems(item).slice().sort(function (a, b) {
          return Number(b.score || 0) - Number(a.score || 0);
        });
        var rows = stocks.length ? stocks.map(function (stock) {
          var rate = Number(stock.changeRate);
          var tone = isNaN(rate) || rate === 0 ? 'home-neutral' : rate > 0 ? 'home-positive' : 'home-negative';
          return '<a class="home-pattern-stock" href="/page/pattern-scan">'
            + '<span><strong>' + escapeHomeHtml(stock.name || stock.code || '종목명 확인 중') + '</strong>'
            + (stock.code ? '<small>' + escapeHomeHtml(stock.code) + '</small>' : '') + '</span>'
            + '<em class="' + tone + '">' + rateText(stock.changeRate) + '</em></a>';
        }).join('') : '<p class="home-pattern-empty">현재 이 패턴에 해당하는 종목이 없습니다.</p>';

        list.innerHTML = '<div class="home-pattern-preview" id="homePatternPreview">'
          + '<button type="button" class="home-pattern-preview-back">← 전체 패턴</button>'
          + '<div class="home-pattern-preview-heading"><strong>' + item.label + '</strong>'
          + '<span>' + patternItems(item).length.toLocaleString('ko-KR') + '종목 · 스크롤</span></div>'
          + '<div class="home-pattern-stock-list">' + rows + '</div></div>';
        var back = list.querySelector('.home-pattern-preview-back');
        if (back) back.addEventListener('click', renderPatternOverview);
      }
      var newCodes = {};
      // item.date는 마지막 거래일이다. 주말/휴장일에는 브라우저의 오늘 날짜와
      // 거래일이 달라져 기존 로직이 계속 0건을 보여줬다. 최신 스캔 결과에 포함된
      // 가장 최근 거래일을 기준일로 사용한다.
      var scanDate = data && data.scannedAt ? new Date(data.scannedAt) : null;
      var scanDateKey = scanDate && !isNaN(scanDate.getTime())
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(scanDate)
        : '';
      var latestPatternDate = '';
      Object.keys(patterns).forEach(function (key) {
        (patterns[key] || []).forEach(function (item) {
          if (item && item.date && item.date <= (scanDateKey || '9999-12-31') && item.date > latestPatternDate) {
            latestPatternDate = item.date;
          }
        });
      });
      var referencePatternDate = latestPatternDate || scanDateKey;
      Object.keys(patterns).forEach(function (key) {
        (patterns[key] || []).forEach(function (item) {
          if (item && item.date === referencePatternDate && item.code) newCodes[item.code] = true;
        });
      });
      renderPatternOverview();
      var updated = document.getElementById('homePatternUpdated');
      if (updated && data.scannedAt) {
        var date = new Date(data.scannedAt);
        updated.textContent = isNaN(date.getTime()) ? '' : (date.getMonth() + 1) + '.' + date.getDate() + '. 스캔';
      }
    }

    var patternCacheKey = 'home_pattern_scan_v1';
    var cachedPatterns = readHomeDataCache(patternCacheKey, 18 * 60 * 60 * 1000);
    if (cachedPatterns) renderPatterns(cachedPatterns);
    fetchHomeJson(GAS_TICKER_URL + '?patternScan=1', 25000)
      .then(function (data) {
        writeHomeDataCache(patternCacheKey, data);
        renderPatterns(data);
      })
      .catch(function () {
        var list = document.getElementById('homePatternList');
        if (list && !cachedPatterns) list.innerHTML = '<p class="home-card-state">패턴 데이터를 불러오지 못했습니다.</p>';
      });

    function calendarMeta(rawTitle) {
      var segments = String(rawTitle || '').split('|').map(function (item) { return item.trim(); });
      var head = segments[0] || '(제목 없음)';
      var category = segments[1] || '';
      var stock = head.match(/^\$(\S+)\s*(.*)$/);
      var flag = !stock && head.match(/^(\p{Regional_Indicator}{2})\s*(.*)$/u);
      return {
        title: stock ? ((stock[1] ? stock[1] + ' ' : '') + stock[2]).trim() : flag ? flag[2].trim() : head,
        category: category || (stock ? '종목' : flag ? flag[1] : '증시')
      };
    }

    function eventDate(event) {
      var value = event.start.indexOf('T') === -1 ? event.start + 'T00:00:00+09:00' : event.start;
      return new Date(value);
    }

    function scheduleTime(event, includeDate) {
      var allDay = event.start.indexOf('T') === -1;
      var date = eventDate(event);
      var dateLabel = (date.getMonth() + 1) + '.' + date.getDate() + '.';
      var timeLabel = allDay ? '종일' : String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
      return includeDate ? dateLabel + ' ' + timeLabel : timeLabel;
    }

    function nearestEvents(events) {
      var now = new Date();
      var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
      var upcoming = (events || []).filter(function (event) { return eventDate(event) >= todayStart; })
        .sort(function (a, b) { return eventDate(a) - eventDate(b); });
      var todayItems = upcoming.filter(function (event) { return eventDate(event) < tomorrow; });
      if (todayItems.length) return { items: todayItems.slice(0, 4), includeDate: false, label: '오늘 일정' };
      if (!upcoming.length) return { items: [], includeDate: true, label: '오늘 또는 가장 가까운 일정' };
      var nearest = eventDate(upcoming[0]).toDateString();
      return {
        items: upcoming.filter(function (event) { return eventDate(event).toDateString() === nearest; }).slice(0, 4),
        includeDate: true,
        label: '가장 가까운 일정'
      };
    }

    function renderSchedule(result) {
      var list = document.getElementById('homeScheduleList');
      var label = document.getElementById('homeScheduleLabel');
      if (!list) return;
      if (label) label.textContent = result.label;
      if (!result.items.length) {
        list.innerHTML = '<p class="home-card-state">오늘 예정된 주요 일정이 없습니다.</p>';
        return;
      }
      list.innerHTML = result.items.map(function (event) {
        var meta = calendarMeta(event.title);
        return '<a class="home-schedule-row" href="' + escapeHomeHtml(event.link || '/page/stock-calendar') + '" target="_blank" rel="noopener">'
          + '<time>' + scheduleTime(event, result.includeDate) + '</time>'
          + '<span class="home-schedule-content">'
          + '<span class="home-schedule-category">' + escapeHomeHtml(meta.category) + '</span>'
          + '<span class="home-schedule-title">' + escapeHomeHtml(meta.title) + '</span></span></a>';
      }).join('');
    }

    loadHomeScript(CALENDAR_SCRIPT_URL, 'StockCalendar')
      .then(function (calendar) {
        if (!calendar || !calendar.fetchEvents) throw new Error('캘린더 모듈 없음');
        var today = new Date();
        return calendar.fetchEvents(today.getFullYear(), today.getMonth())
          .then(function (events) {
            var current = nearestEvents(events);
            if (current.items.length) return current;
            return calendar.fetchEvents(today.getFullYear(), today.getMonth() + 1).then(nearestEvents);
          });
      })
      .then(renderSchedule)
      .catch(function () {
        var list = document.getElementById('homeScheduleList');
        if (list) list.innerHTML = '<p class="home-card-state">일정을 불러오지 못했습니다.</p>';
      });

    /* 최신 마켓브리핑 8건: 대표 1건 + 오른쪽 3건 + 왼쪽 아래 4건으로 재구성한다. */
    var allCards = Array.prototype.slice.call(feed.querySelectorAll(':scope > .post-card:not(.notice-card)'));
    var marketCards = allCards.filter(function (card) { return card.getAttribute('data-cat') === '마켓 브리핑'; });
    var selectedCards = (marketCards.length ? marketCards : allCards).slice(0, 8);
    allCards.forEach(function (card) {
      if (selectedCards.indexOf(card) === -1) card.remove();
    });
    feed.querySelectorAll(':scope > .notice-card').forEach(function (card) { card.remove(); });

    var briefing = null;
    if (selectedCards.length) {
      briefing = document.createElement('section');
      briefing.className = 'home-briefing-section';
      briefing.innerHTML = '<div class="home-section-heading"><div><strong>마켓브리핑</strong>'
        + '<span>투자 판단에 필요한 핵심 해석</span></div></div>'
        + '<div class="home-briefing-grid"><div class="home-briefing-left-column">'
        + '<div class="home-briefing-featured-slot"></div><div class="home-briefing-left-more"></div></div>'
        + '<div class="home-briefing-small-stack"></div></div>'
        + '<a class="home-briefing-more" href="/category/마켓 브리핑">마켓브리핑 전체보기 →</a>';
      feed.appendChild(briefing);
      selectedCards[0].classList.add('home-briefing-featured');
      briefing.querySelector('.home-briefing-featured-slot').appendChild(selectedCards[0]);
      selectedCards.slice(1, 4).forEach(function (card) {
        card.classList.add('home-briefing-small');
        briefing.querySelector('.home-briefing-small-stack').appendChild(card);
      });
      selectedCards.slice(4, 8).forEach(function (card) {
        card.classList.add('home-briefing-small', 'home-briefing-left-small');
        briefing.querySelector('.home-briefing-left-more').appendChild(card);
      });
    } else {
      briefing = document.createElement('section');
      briefing.className = 'home-briefing-section';
      briefing.innerHTML = '<div class="home-section-heading"><div><strong>마켓브리핑</strong>'
        + '<span>투자 판단에 필요한 핵심 해석</span></div></div>'
        + '<div class="home-card-state">최신 마켓브리핑을 확인하는 중입니다.</div>'
        + '<a class="home-briefing-more" href="/category/마켓 브리핑">마켓브리핑 전체보기 →</a>';
      feed.appendChild(briefing);
    }

    var pagination = feed.querySelector(':scope > .pagination');
    if (pagination) pagination.remove();

    loadHomeScript(HOME_WIDGETS_SCRIPT_URL, 'HomeDashboardWidgets')
      .then(function (widgets) {
        if (!widgets || !widgets.init) return;
        widgets.init({
          dashboard: dashboardSection,
          briefing: briefing,
          gasUrl: GAS_TICKER_URL,
          fetchJson: fetchHomeJson
        });
      })
      .catch(function () {
        /* 위젯 관리 모듈이 막혀도 기존 고정형 대시보드는 그대로 사용할 수 있게 둔다. */
      });
  })();

  /* ── 카테고리 글목록: 블록 단위 무작위 배치(2026-08-05, 재요청으로 재설계) ──
     처음엔 카드 하나하나에 독립적으로 크기만 다른 클래스를 줬는데(모두 세로 1열, "왜 일열이야"
     피드백) - 사용자가 표로 예를 들어 요구한 건 그게 아니라 진짜 구조가 다른 "블록"들이
     섞이는 것. 처음엔 "제목만 목록"을 독립된 블록으로 뒀는데, 사용자가 "그럴 땐 왼쪽에 포스팅
     하나 + 오른쪽에 제목만 있는 목록으로 해야 하지 않을까?"라고 재지적 - 제목만 있는 목록이
     혼자 둥둥 떠 있는 것보다 큰 글 옆에 붙어야 자연스럽다는 지적이 맞아서, single(대표 1개)과
     headline(제목 목록)을 하나의 hero 블록(왼쪽 대표 1 + 오른쪽 제목 목록 최대 4)으로 합쳤다.
     글을 앞에서부터 순서대로(최신순 그대로, 절대 재정렬 안 함) 소비하면서, 매번 남은 글 수에
     맞는 블록 타입을 무작위로 골라 그만큼씩 묶어 서로 다른 모양의 블록으로 렌더링한다. */
  (function buildCategoryFeedBlocks() {
    if (location.pathname.indexOf('/category/') !== 0) return;
    var feed = document.querySelector('.feed');
    if (!feed) return;
    var cards = Array.prototype.slice.call(feed.querySelectorAll(':scope > .post-card:not(.notice-card)'));
    if (cards.length < 2) return; /* 카드가 1개뿐이면 다양화할 의미가 없음 */

    var BLOCK_TYPES = [
      { key: 'single', min: 1, max: 1 }, // 1개 단독 - 대표 글만(feed-featured)
      { key: 'hero', min: 2, max: 5 },   // 왼쪽 대표 1 + 오른쪽 제목 목록 최대 4(최소 1개는 있어야 hero다움)
      { key: 'cards', min: 3, max: 3 },  // 작은 카드형 3개 그리드
      { key: 'duo', min: 2, max: 2 }     // 가로로 나란한 2개
    ];
    var tailAnchor = cards[cards.length - 1].nextSibling; /* 마지막 카드 뒤 요소(페이지네이션 등) 앞에 삽입 */

    function renderBlock(type, slice, beforeNode) {
      if (type === 'single') {
        slice[0].classList.add('feed-featured'); // 이미 제자리에 있으므로 이동 없이 클래스만
        return;
      }
      if (type === 'hero') {
        var hero = document.createElement('div');
        hero.className = 'feed-block feed-block-hero';
        feed.insertBefore(hero, beforeNode);
        var featuredSlot = document.createElement('div');
        featuredSlot.className = 'feed-hero-featured-slot';
        hero.appendChild(featuredSlot);
        slice[0].classList.add('feed-featured');
        featuredSlot.appendChild(slice[0]);
        if (slice.length > 1) {
          var headlineList = document.createElement('div');
          headlineList.className = 'feed-block-headline';
          hero.appendChild(headlineList);
          slice.slice(1).forEach(function (card) {
            card.classList.add('feed-headline-item');
            headlineList.appendChild(card);
          });
        }
        return;
      }
      var wrap = document.createElement('div');
      wrap.className = 'feed-block feed-block-' + type;
      feed.insertBefore(wrap, beforeNode);
      slice.forEach(function (card) {
        card.classList.add('feed-' + type + '-item');
        wrap.appendChild(card);
      });
    }

    var idx = 0;
    while (idx < cards.length) {
      var remaining = cards.length - idx;
      // 남은 글 수보다 최소 소요량이 큰 블록 타입은 후보에서 뺀다(single은 1개라 항상 가능).
      var candidates = BLOCK_TYPES.filter(function (b) { return b.min <= remaining; });
      var block = candidates[Math.floor(Math.random() * candidates.length)];
      var take = Math.min(block.max, remaining);
      var slice = cards.slice(idx, idx + take);
      var beforeNode = idx + take < cards.length ? cards[idx + take] : tailAnchor;
      renderBlock(block.key, slice, beforeNode);
      idx += take;
    }
  })();

  /* ── 폰트 전환 토글 (명조 ⇄ 고딕, 조기 적용 스크립트는 head에 있음) ── */
  (function() {
    var btn = document.getElementById('fontModeBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var on = document.documentElement.classList.toggle('font-gothic');
      try { localStorage.setItem('bolt-font', on ? 'gothic' : ''); } catch (e) {}
    });
  })();

  /* ── 데스크톱 사이드바 토글 (완전 숨김 ↔ 복원, 2026-07-21 사이드바 리디자인 #3)
     조기 적용 스크립트(head)가 이미 html.sidebar-collapsed를 붙여놨을 수 있으므로
     버튼 아이콘(햄버거 ⇄ X) 상태만 여기서 동기화. 모바일 드로어(#mobileMenuBtn)와는
     완전히 별개 기능 - CSS가 min-width:721px 안에서만 .sidebar-collapsed를 해석하므로
     모바일에서는 이 클래스가 있어도 레이아웃에 영향 없음. ── */
  (function() {
    var btn = document.getElementById('sidebarToggleBtn');
    if (!btn) return;
    if (document.documentElement.classList.contains('sidebar-collapsed')) btn.classList.add('open');
    btn.addEventListener('click', function() {
      var collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
      btn.classList.toggle('open', collapsed);
      try { localStorage.setItem('bolt-sidebar-collapsed', collapsed ? '1' : '0'); } catch (e) {}
    });
  })();

  /* ── 카테고리 동적 파싱 ([##_category_list_##] 기반) ── */
  var catColors = ['#2563eb','#16a34a','#d97706','#7c3aed','#e11d48','#0891b2','#b45309','#0f766e'];
  /* 2026-07-12: 마켓 브리핑은 왼쪽 페이지 메뉴(skin-menu.js)로 승격돼서
     사이드바 "카테고리" 목록에는 중복 노출 안 함 */
  var sidebarCatExclude = ['마켓 브리핑'];
  /* 카테고리명 → 아이콘 수동 매핑. 카테고리 이름을 바꾸면 이 키도 같이 고쳐야 함(안 그러면 기본 아이콘으로 대체됨) */
  var catIconPaths = {
    '종목 분석': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    '일상다반사': '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
    '일기장': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'Insight Archive': '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>'
  };
  var catIconDefault = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
  var subCatMap = {};
  var catDataEl = document.getElementById('categoryData');
  var catCustomList = document.getElementById('catCustomList');

  if (catDataEl) {
    var allLinks = Array.from(catDataEl.querySelectorAll('a'));

    /* depth-1 = /category/NAME (슬래시 딱 1개) */
    var depth1Links = allLinks.filter(function(a) {
      return /\/category\/[^/]+$/.test(a.getAttribute('href') || '');
    });

    /* depth-2 = /category/NAME/SUBNAME */
    var depth2Links = allLinks.filter(function(a) {
      return /\/category\/[^/]+\/[^/]+$/.test(a.getAttribute('href') || '');
    });

    /* ── 좌측 사이드바: depth-1 만 표시 ── */
    if (catCustomList) {
      depth1Links.forEach(function(a, idx) {
        var href = a.getAttribute('href');
        var countEl = a.querySelector('span');
        var name = '', count = '';
        if (countEl) {
          count = countEl.textContent.replace(/[()]/g, '').trim();
          name  = a.childNodes[0] ? a.childNodes[0].textContent.trim() : '';
        } else {
          var m = a.textContent.trim().match(/^(.*?)\s*\((\d+)\)\s*$/);
          name  = m ? m[1].trim() : a.textContent.trim();
          count = m ? m[2] : '';
        }
        if (!name) return;
        var bareName = name.replace(/\s*\(비공개\)\s*$/, '').trim();
        if (sidebarCatExclude.indexOf(bareName) > -1) return;
        var color = catColors[idx % catColors.length];
        var iconPath = catIconPaths[bareName] || catIconDefault;
        var li = document.createElement('li');
        li.innerHTML = '<a href="' + href + '" data-parent="' + name + '">'
          + '<svg class="cat-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconPath + '</svg>'
          + name
          + (count ? '<span class="cat-cnt">' + count + '</span>' : '')
          + '</a>';
        catCustomList.appendChild(li);
      });
    }

    /* ── 상단 필터 탭: 2026-07-11 UI에서 제거(디자인상 불필요 판단) ──
       skin.html의 #filterBar 자체는 스킨 편집 없이 유지하고, 여기서 DOM에서 떼어낸다. */
    var filterBar = document.getElementById('filterBar');
    if (filterBar) { filterBar.remove(); filterBar = null; }
    var topBarExclude = ['일기장', 'Insight Archive'];

    /* ── subCatMap: depth-2를 부모 기준으로 그루핑 ── */
    depth2Links.forEach(function(a) {
      var href = a.getAttribute('href') || '';
      var parentSlug = (href.match(/\/category\/([^/]+)\//) || [])[1] || '';
      var parentA = depth1Links.filter(function(p) {
        return (p.getAttribute('href') || '').indexOf('/category/' + parentSlug) > -1;
      })[0];
      var parentName = '';
      if (parentA) {
        var pCountEl = parentA.querySelector('span');
        parentName = pCountEl
          ? (parentA.childNodes[0] ? parentA.childNodes[0].textContent.trim() : '')
          : parentA.textContent.trim().replace(/\s*\(\d+\)\s*$/, '').trim();
      } else {
        parentName = decodeURIComponent(parentSlug.replace(/\+/g, ' '));
      }
      var cntEl = a.querySelector('span');
      var subName = cntEl
        ? (a.childNodes[0] ? a.childNodes[0].textContent.trim() : '')
        : a.textContent.trim().replace(/\s*\(\d+\)\s*$/, '').trim();
      if (!parentName || !subName) return;
      if (!subCatMap[parentName]) subCatMap[parentName] = [];
      subCatMap[parentName].push({ name: subName, url: href });
    });
  }

  /* ── 카테고리 필터 탭 active ── */
  var path = decodeURIComponent(location.pathname).toLowerCase();
  var activeCat = '';
  document.querySelectorAll('.filter-tab').forEach(function(tab) {
    var tabCat = (tab.dataset.cat || '').toLowerCase();
    if (tabCat === 'all') {
      if (path === '/' || path === '') { tab.classList.add('active'); activeCat = 'all'; }
    } else {
      var slug = tabCat.replace(/ /g, '+');
      if (path.indexOf(slug) > -1 || path.indexOf(tabCat.replace(/ /g, '%20')) > -1 || path.indexOf(tabCat) > -1) {
        tab.classList.add('active');
        activeCat = tab.dataset.cat;
      }
    }
  });
  /* 상단 탭에 없는 카테고리(일기장/Insight Archive 등 topBarExclude 대상)도
     카테고리 페이지에 들어가면 서브 카테고리 바는 뜨도록 URL에서 직접 감지 */
  if (!activeCat) {
    Object.keys(subCatMap).forEach(function(parentName) {
      var p = parentName.toLowerCase();
      if (path.indexOf('/category/' + p.replace(/ /g, '+')) === 0 ||
          path.indexOf('/category/' + p.replace(/ /g, '%20')) === 0 ||
          path.indexOf('/category/' + p) === 0) {
        activeCat = parentName;
      }
    });
  }

  if (!activeCat) {
    var allTab = document.querySelector('.filter-tab[data-cat="all"]');
    if (allTab) { allTab.classList.add('active'); activeCat = 'all'; }
  }

  /* ── 세부 카테고리 서브 필터 렌더링 ──
     상단 탭에서 제외된 카테고리(일기장/Insight Archive)는 서브 바 대신
     상단 필터 바 자체를 하위 카테고리 탭으로 교체한다(전체글/마켓 브리핑 자리에 표시). */
  var subBar = document.getElementById('subFilterBar');
  if (subCatMap[activeCat]) {
    var subs = subCatMap[activeCat];
    var isExcludedCat = topBarExclude.indexOf(activeCat.replace(/\s*\(비공개\)\s*$/, '').trim()) > -1;
    var tabClass = isExcludedCat ? 'filter-tab' : 'sub-filter-tab';
    var html = '';
    subs.forEach(function(s) {
      var isActive = path.indexOf(decodeURIComponent(s.url).toLowerCase().split('/').pop()) > -1;
      html += '<a href="' + s.url + '" class="' + tabClass + (isActive ? ' active' : '') + '">' + s.name + '</a>';
    });
    if (isExcludedCat && filterBar) {
      filterBar.innerHTML = html;
    } else if (subBar) {
      subBar.innerHTML = html;
      subBar.style.display = 'flex';
    }
  }

  /* ── 좌측 카테고리 active 표시 ── */
  document.querySelectorAll('.cat-custom-list a').forEach(function(a) {
    var p = (a.dataset.parent || '').toLowerCase();
    if (p && path.indexOf(p.replace(/ /g, '+')) > -1) {
      a.classList.add('active');
    }
  });


  /* ── 아티클 모달 ── */
  function openArticleModal(url, title, wide, zoom) {
    var old = document.getElementById('bolt-modal');
    if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'bolt-modal';
    var iframeHTML = wide
      ? '<div class="nm-scale-wrap"><div class="nm-scale-inner"><iframe src="' + url + '" class="nm-iframe nm-iframe-fixed"></iframe></div></div>'
      : '<iframe src="' + url + '" class="nm-iframe"></iframe>';
    m.innerHTML =
      '<div class="nm-overlay"></div>' +
      '<div class="nm-card' + (wide ? ' nm-wide' : '') + '">' +
        '<div class="nm-header">' +
          '<span class="nm-title">' + (title || '') + '</span>' +
          '<div class="nm-actions">' +
            '<a href="' + url + '" target="_blank" class="nm-ext">새창 열기 ↗</a>' +
            '<button class="nm-close" id="nmClose">✕</button>' +
          '</div>' +
        '</div>' +
        iframeHTML +
      '</div>';
    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    document.getElementById('nmClose').onclick = closeArticleModal;
    m.querySelector('.nm-overlay').onclick = closeArticleModal;

    if (wide) {
      var wrap = m.querySelector('.nm-scale-wrap');
      var inner = m.querySelector('.nm-scale-inner');
      var ifr = m.querySelector('.nm-iframe-fixed');
      if (wrap && inner && ifr) {
        var rescale = function() {
          var w = wrap.clientWidth;
          if (!w) return;
          var virtualWidth = zoom ? (w / zoom) : 1200;
          var scale = w / virtualWidth;
          ifr.style.width = virtualWidth + 'px';
          ifr.style.transform = 'scale(' + scale + ')';
          inner.style.width = w + 'px';
          inner.style.height = (1300 * scale) + 'px';
        };
        rescale();
        window.addEventListener('resize', rescale);
        m._rescale = rescale;
      }
    }
  }
  function closeArticleModal() {
    var m = document.getElementById('bolt-modal');
    if (m) {
      if (m._rescale) window.removeEventListener('resize', m._rescale);
      m.classList.add('nm-closing'); setTimeout(function(){ m.remove(); }, 200);
    }
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeArticleModal();
  });

  /* ── 전역 노출 ── */
  window.readPost = function(btn) {
    var card = btn.closest('.post-card');
    if (!card) return;
    var postUrl = card.dataset.url;
    var titleEl = card.querySelector('.post-title');
    var title = titleEl ? titleEl.textContent.trim() : '';
    openArticleModal(postUrl, title, true, 1.0);
  };

  window.sharePost = function(btn) {
    var card = btn.closest('.post-card');
    if (!card) return;
    var url = card.dataset.url || location.href;
    var titleEl = card.querySelector('.post-title');
    var title = titleEl ? titleEl.textContent.trim() : '';
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function(){});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() {
        var orig = btn.textContent;
        btn.textContent = '✓ 복사됨';
        btn.style.background = '#dcfce7'; btn.style.borderColor = '#86efac'; btn.style.color = '#15803d';
        setTimeout(function() {
          btn.textContent = orig; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = '';
        }, 2000);
      });
    } else { window.open(url, '_blank'); }
  };

  /* ── 카테고리 없는 글/페이지(예: /page/market-temp 등 개별 Page)의
     "카테고리 없음" 뱃지 숨김 ── */
  document.querySelectorAll('.post-cat-badge').forEach(function(el) {
    if (el.textContent.trim() === '카테고리 없음') el.style.display = 'none';
  });

  /* ── 표 가로 스크롤 래핑: table에 overflow-x:auto만 주면 auto 테이블 레이아웃이
     칸 너비를 억지로 욱여넣어 찌그러지길래, div로 감싸서 그 div가 스크롤되게 함 ── */
  document.querySelectorAll('.post-single-body table, .post-expand-body table').forEach(function(table) {
    if (table.parentElement && table.parentElement.classList.contains('table-scroll-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'table-scroll-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  /* ── 인덱스 요약 텍스트 줄바꿈 개선 ── */
  document.querySelectorAll('.post-excerpt').forEach(function(el) {
    /* innerHTML 기반 처리: 티스토리가 삽입한 <br> 보존 */
    var raw = el.innerHTML;
    /* ① <br> → \n */
    raw = raw.replace(/<br\s*\/?>/gi, '\n');
    /* ② 나머지 태그 제거 */
    raw = raw.replace(/<[^>]+>/g, '');
    /* ③ HTML 엔티티 디코딩 */
    var tmp = document.createElement('div');
    tmp.innerHTML = raw;
    raw = tmp.textContent.replace(/\r\n|\r/g, '\n').trim();
    /* ④ 중복 텍스트 제거 */
    if (raw.length > 20) {
      var check = raw.slice(0, 30);
      var dupIdx = raw.indexOf(check, 5);
      if (dupIdx > 0 && dupIdx <= 60) { raw = raw.slice(dupIdx); }
    }
    /* ⑤ "숫자.\n내용" → "숫자. 내용" (번호 혼자 떠있는 현상 방지) */
    raw = raw.replace(/(\d+)\.\n+/g, '$1. ');
    /* ⑥ 숫자 목록 앞 줄바꿈 (공백 유무 무관) */
    /* "?1. " "할인).2. " 처럼 구두점/괄호 뒤 숫자가 바로 붙는 경우 포함 */
    raw = raw.replace(/([.!?)\]][\s]*(\d+)\.\s+)/g, function(m) {
      var parts = m.match(/^([.!?)\]])\s*(\d+)\.\s+$/);
      if (!parts) return m;
      return parts[1] + '\n' + parts[2] + '. ';
    });
    raw = raw.replace(/([^\n])\s+(\d+)\.\s+/g, function(m, before, num) {
      return before + '\n' + num + '. ';
    });
    /* ⑦ 대시·불릿 앞 줄바꿈 */
    raw = raw.replace(/([^\n])\s*[-•·✦▸]\s+/g, '$1\n- ');
    /* ⑧ 마침표/느낌표/물음표 뒤 새 한글 문장 단락 구분 */
    /* 앞 글자가 숫자면 제외: "1. 일단..." 같은 번호목록 점을 건드리지 않음 */
    raw = raw.replace(/([^\d\n][.!?])\s+([가-힣A-Z])/g, '$1\n$2');
    /* ⑨ 연속 줄바꿈 정리 */
    raw = raw.replace(/\n{3,}/g, '\n\n');
    /* ⑩ 최종 출력 (3줄 클램프는 style.css .post-excerpt 규칙이 담당) */
    el.innerHTML = raw.replace(/\n/g, '<br>');
  });

  /* 뉴스 티커 초기 패딩 보정 (RSS 로드 전부터 공간 확보) */
  (function() {
    var pw = document.querySelector('.page-wrap');
    var sl = document.querySelector('.sidebar-left');
    var sr = document.querySelector('.sidebar-right');
    if (pw) pw.style.paddingTop = '122px'; /* navbar+disc-ticker 여백(90px) + market-ribbon(32px) */
    /* 모바일에서는 사이드바가 드로어이므로 top 고정하지 않음 */
    if (sl && window.innerWidth > 720) sl.style.top = '142px';
    if (sr && window.innerWidth > 1100) sr.style.top = '142px';
  })();

  /* ── 모바일 드로어 & 검색 오버레이 ── */
  (function() {
    var menuBtn    = document.getElementById('mobileMenuBtn');
    var overlay    = document.getElementById('mobileOverlay');
    var sidebar    = document.querySelector('.sidebar-left');
    var searchBtn  = document.getElementById('mobileSearchBtn');
    var searchOv   = document.getElementById('mobileSearchOverlay');
    var msoClose   = document.getElementById('msoCloseBtn');
    var msoInput   = document.getElementById('msoInput');
    var scrollBtn  = document.getElementById('scrollTopBtn');
    var drawerHdr  = document.querySelector('.drawer-header');

    /* 드로어 열기/닫기 */
    function openDrawer() {
      if (!sidebar || !menuBtn || !overlay) return;
      menuBtn.classList.add('open');
      menuBtn.setAttribute('aria-label', '메뉴 닫기');
      sidebar.classList.add('drawer-open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      if (drawerHdr) drawerHdr.style.display = 'flex';
    }
    function closeDrawer() {
      if (!sidebar || !menuBtn || !overlay) return;
      menuBtn.classList.remove('open');
      menuBtn.setAttribute('aria-label', '메뉴 열기');
      sidebar.classList.remove('drawer-open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (menuBtn) menuBtn.addEventListener('click', function() {
      sidebar && sidebar.classList.contains('drawer-open') ? closeDrawer() : openDrawer();
    });
    if (overlay) overlay.addEventListener('click', closeDrawer);

    /* 드로어 내부 링크 클릭 시 자동 닫힘 */
    if (sidebar) sidebar.addEventListener('click', function(e) {
      if (e.target.tagName === 'A' && window.innerWidth <= 720) {
        setTimeout(closeDrawer, 120);
      }
    });

    /* 검색 오버레이 */
    if (searchBtn) searchBtn.addEventListener('click', function() {
      if (!searchOv) return;
      searchOv.classList.add('open');
      setTimeout(function() { msoInput && msoInput.focus(); }, 150);
    });
    if (msoClose) msoClose.addEventListener('click', function() {
      searchOv && searchOv.classList.remove('open');
    });
    if (searchOv) searchOv.addEventListener('click', function(e) {
      if (e.target === searchOv) searchOv.classList.remove('open');
    });

    /* ESC 키 닫힘 */
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeDrawer();
        searchOv && searchOv.classList.remove('open');
      }
    });

    /* 스크롤 탑 버튼 */
    if (scrollBtn) {
      window.addEventListener('scroll', function() {
        if (window.scrollY > 300) scrollBtn.classList.add('visible');
        else scrollBtn.classList.remove('visible');
      }, { passive: true });
      scrollBtn.addEventListener('click', function() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    /* 리사이즈 시 드로어 정리 */
    window.addEventListener('resize', function() {
      if (window.innerWidth > 720) {
        closeDrawer();
        /* 데스크탑 전환 시 sidebar top 복원 */
        var sl2 = document.querySelector('.sidebar-left');
        if (sl2) sl2.style.top = '';
      }
    });
  })();

