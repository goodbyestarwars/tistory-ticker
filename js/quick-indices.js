/**
 * 관심 지수 카드 - 공시 티커 바로 아래 고정 바 (모든 페이지 공통)
 *
 * 이전 버전은 <s_notice_rep>/<s_article_rep> 글 목록의 `.post-card`를 앵커로 삼아 그 위에
 * 끼워 넣었는데, 종목분석 같은 "페이지"(글 목록이 없는 커스텀 Tistory 페이지)에서는
 * `.post-card`가 아예 없어 body 맨 앞에 끼워지면서 레이아웃이 깨졌다(2026-07-16 실사 확인).
 * 그래서 페이지 종류와 무관하게 항상 같은 자리에 뜨도록 공시 티커 바로 아래 position:fixed
 * 바로 바꿨다 - style.css의 콘텐츠 시작 좌표(.page-wrap padding-top, .sidebar-left/
 * .sidebar-right top)는 이 바의 실제 높이(--qi-height CSS 변수)를 그대로 참조하게 해뒀다.
 *
 * 폭/위치: 처음엔 뷰포트 전체 폭을 썼는데 "화면을 너무 full로 쓴다"는 피드백을 받아
 * .main-layout과 동일한 max-width로 맞췄다(css의 .qi-wrap 참고).
 *
 * 접기/펼치기: qi_collapsed_v1(localStorage)에 저장하고, --qi-height를 40px/175px로
 * 바꿔서 그 값을 그대로 아래 콘텐츠 좌표 계산에 재사용한다(style.css :root 주석 참고).
 * 페이지 로드 시 깜빡임 없이 바로 반영되도록 DOMContentLoaded를 기다리지 않고
 * 스크립트가 평가되는 즉시(동기) documentElement에 세팅한다.
 *
 * "+" 버튼: 처음엔 가로 스크롤되는 카드 줄(.qi-grid) 안에 같이 있어서 스크롤 위치에 따라
 * 팝오버가 화면 오른쪽 끝 이상한 곳에 뜨는 문제가 있었다(2026-07-16 피드백) - 스크롤 영역
 * 밖의 별도 .qi-controls로 빼서 항상 버튼 바로 아래에 뜨게 고쳤다.
 *
 * 데이터 소스:
 * - 원달러/BTC 시세: GAS ?market=1 (과거 시세 이력 없음). BTC 차트/자정 기준점은 12차부터
 *   업비트 공개 API(CORS 전체 허용)를 브라우저에서 직접 호출해 보충(fetchUpbitBtc 참고)
 * - 코스피/코스닥/코스피200 야간선물/나스닥100/S&P500/필라델피아(SOX)/VIX/WTI:
 *   VM(https://goodbyestar.cloud/futures) (js/overnight-market.js와 같은 응답을 쓰는데, 그
 *   응답엔 최근 시세 배열(chart)이 이미 들어있어서 그걸 그대로 미니 스파크라인으로 그린다 -
 *   렌더링 방식도 overnight-market.js와 동일)
 *
 * 2026-07-16: 코스피/코스닥을 'market'(GAS, 이력 없음)에서 'futures'(VM, 이력 있음)로 전환해
 * 미니차트가 뜨게 했다 - VM의 chart/domestic/index/{KOSPI|KOSDAQ}/day 데이터를 "변동폭이
 * 튀어 신뢰 불가"로 오판해서 한동안 코스피 현물지수 수집 자체를 뺐었는데, 실시간 시세와
 * 대조해보니 실제로 정확한 데이터였음이 밝혀져 정정함(scripts/cloud-vm/domestic_futures.py
 * 상단 주석 참고). 원달러/BTC는 그대로 market 소스 유지(원달러는 VM에도 USDKRW로 있지만
 * 이 리본까지 굳이 바꿀 필요는 없어서 손대지 않음, BTC는 VM이 아예 안 다룸).
 *
 * 60초마다 갱신하되, 매번 카드를 통째로 비웠다가 다시 그리면 깜빡임이 생겨서(2026-07-16
 * 피드백) 최초 1회만 "불러오는 중" 틀을 그리고, 이후 갱신은 기존 DOM 노드의 텍스트/톤만 바꾼다.
 *
 * 2026-07-17: 가로 드래그 스크롤을 없애고 좌우 화살표 페이징으로 교체. 선택된 지수 전체
 * 데이터는 그대로 fetch해서 dataCache에 담아두고, 화면에는 현재 페이지 분량만 그린다 -
 * 페이지를 넘겨도 새로 fetch하지 않고 캐시에서 바로 채운다.
 *
 * 2026-07-17(6차): 토스증권 위젯 참고해 "큰 카드 1개 + 작은 카드 그리드" 배치로 재구성
 * (사용자 요청 - AI 한줄 코멘트/52주 최고·최저는 뒷받침할 데이터가 없어서 제외, 레이아웃만
 * 반영). 페이지 크기를 동적으로 정하던 방식(getPerPage)은 이 비대칭 레이아웃엔 안 맞아서
 * PER_PAGE 상수로 단순화했다.
 * 2026-07-17(8차): 그리드를 4x2(8개)에서 2x3(6개)로 변경(사용자가 직접 그린 스케치 반영) -
 * 한 페이지당 1(큰 카드) + 6(그리드) = 7개.
 *
 * 2026-07-17(9차): 원래 navbar 바로 아래 별도 고정 바였던 KRX 공시 티커(js/skin-main.js +
 * js/skin-shell.js)를 이 리본 오른쪽 "긴급속보" 패널로 흡수(사용자가 직접 그린 스케치 반영).
 * skin.html의 #shell-discTicker mount는 티스토리 치환 태그가 없는 순수 mount였어서
 * skin-shell.js가 더 이상 그 안을 채우지 않으면 그냥 빈 div로 남아 스킨 자체는 안 건드려도
 * 됐다(skin.html 원본 텍스트 배포 불필요). 공시 데이터 fetch/파싱 로직은 skin-main.js에서
 * 그대로 옮겨왔고(같은 GAS ?market=0), 가로 스크롤 대신 세로 스크롤 목록으로 렌더링 방식만
 * 바꿨다. 별도 바가 사라지면서 navbar(56px) 바로 아래로 이 리본 자체의 top이 올라왔다(이전:
 * navbar+disc-ticker=94px) - style.css의 콘텐츠 시작 좌표 오프셋도 같이 줄었다.
 *
 * 2026-07-17(10차): 그리드 열 폭을 168px로 고정해 카드를 왼쪽에 밀집시키자(사용자 피드백:
 * "넓게 벌려 놓으면 직관성이 떨어짐") 최대 선택(11종)이 전부 한 화면에 들어가게 돼서
 * 좌우 화살표 페이징을 제거하고 항상 전체를 그린다. 긴급속보는 장외 시간에 공시 RSS가
 * 통째로 비어 "속보 없음"만 떠 있던 걸 GAS ?rankNews=1(네이버 뉴스 헤드라인)로 폴백.
 *
 * 2026-07-17(13차): position:fixed -> absolute(스크롤하면 페이지와 함께 사라짐 - 사용자
 * 요청). 금 선물(GOLD) 추가(VM 수집기에도 같이 추가), 시세 소수점 표기, 갱신 20초, 카드
 * 폭 200px(풀네임).
 *
 * 2026-07-17(14차): BTC 미니차트가 라이브에서 간헐적으로 안 뜨는 문제(사용자 재확인) -
 * 13차의 "클라이언트가 직접 업비트 호출" 방식은 방문자 브라우저마다 업비트 레이트리밋/
 * CORS에 노출돼 근본적으로 불안정했다(레이트리밋 응답엔 CORS 헤더가 없어 "Failed to
 * fetch"로만 보임 - 원인 진단에 시간이 걸렸음). 다른 해외지수와 동일하게 VM 서버사이드
 * 수집(scripts/cloud-vm/btc_futures.py)으로 옮겨 BTC 전용 클라이언트 코드를 전부 제거 -
 * 이제 모든 지수가 완전히 같은 경로(futures 소스)를 탄다.
 */
(function (global) {
  'use strict';

  var GAS_TICKER_URL = 'https://script.google.com/macros/s/AKfycbzhKxOqOzw6N1xjW0Jhj5tlbiN0PMRdrQQD6nORBTlP0NDAOvtKfidHU2xwMAbV33mOuQ/exec';
  var DISC_GAS_URL = 'https://script.google.com/macros/s/AKfycbxGl0gCeiQs4QFV1FmPZP_xJQSiVRa1-Dg8Mv23VpevpE9j4xdL9MFxud34teslWzL0wg/exec';
  var FUTURES_API = 'https://goodbyestar.cloud/futures';
  var CONTAINER_ID = 'quick-indices';
  var STORAGE_KEY = 'qi_selected_v1';
  var COLLAPSE_KEY = 'qi_collapsed_v1';
  // 11차: 등락률을 가격 옆 한 줄로 합치면서 카드가 한 줄씩 낮아져 175 -> 140
  var HEIGHT_EXPANDED = '140px';
  var HEIGHT_COLLAPSED = '40px';
  // 13차: 60초 -> 20초(사용자 요청: "토스처럼 실시간으로"). 진짜 실시간(웹소켓)은 소스가
  // 없어서 폴링 주기 단축으로 근사 - VM은 30초 주기 수집이라 이보다 짧게 줄여도 무의미.
  var REFRESH_MS = 20 * 1000;
  var FETCH_TIMEOUT_MS = 8000;
  var LWC_CDN = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
  var SPARKLINE_HEIGHT = 30;
  // 2026-07-17(10차): 카드가 왼쪽에 밀집되면서 선택 가능한 지수 전부(11종)가 한 화면에
  // 들어가게 됐다 - 좌우 화살표 페이징 제거, 항상 전체를 그린다(그리드는 CSS
  // grid-auto-flow:column으로 3줄씩 세로로 채우며 오른쪽으로 열이 늘어난다).

  // 페이지 파싱 도중이라도(DOMContentLoaded 전) 즉시 반영해 접힘 상태 깜빡임을 없앤다.
  (function applyCollapsedHeightEarly() {
    var collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (err) { /* 무시 */ }
    document.documentElement.style.setProperty('--qi-height', collapsed ? HEIGHT_COLLAPSED : HEIGHT_EXPANDED);
  })();

  var OPTIONS = [
    { key: 'kospi', label: '코스피', source: 'futures', sourceKey: 'KOSPI' },
    { key: 'kosdaq', label: '코스닥', source: 'futures', sourceKey: 'KOSDAQ' },
    // 2026-07-17: GAS(market, 시세 이력 없음) -> VM(futures, 일봉 이력 있음)로 전환해
    // 미니차트가 뜨게 함 - VM이 USDKRW를 upsert_future_chart_rows로 따로 수집해두고 있었음
    // (scripts/cloud-vm/domestic_futures.py fetch_fx_daily_chart 참고).
    { key: 'usdkrw', label: '원/달러', source: 'futures', sourceKey: 'USDKRW' },
    // 2026-07-17(14차): 클라이언트가 직접 업비트를 호출하던 방식(source:'market' 시절엔
    // GAS로도 이력이 없었음)을 폐기 - VM(scripts/cloud-vm/btc_futures.py)이 서버사이드로
    // 수집하도록 옮겼다. 방문자 브라우저가 매번 업비트 레이트리밋/CORS에 노출되던 문제가
    // 원천적으로 사라짐(VM 자신은 30초에 1번만 호출).
    { key: 'btc', label: 'BTC', source: 'futures', sourceKey: 'BTC' },
    { key: 'kospi_night', label: '코스피 야간선물', source: 'futures', sourceKey: 'KOSPI200_NIGHT' },
    { key: 'nasdaq', label: '나스닥 선물', source: 'futures', sourceKey: 'NASDAQ100' },
    { key: 'sp500', label: 'S&P500 선물', source: 'futures', sourceKey: 'SP500' },
    { key: 'dow', label: '다우 선물', source: 'futures', sourceKey: 'DOW' },
    { key: 'sox', label: '필라델피아 반도체', source: 'futures', sourceKey: 'SOX' },
    { key: 'wti', label: 'WTI 원유', source: 'futures', sourceKey: 'WTI' },
    // 2026-07-17(13차) 추가(사용자 요청) - VM 수집기(scripts/cloud-vm/foreign_futures.py)에
    // GOLD(GCcv1, COMEX 금 선물)를 같이 추가했다(push 후 5분 내 VM 자동배포).
    { key: 'gold', label: '금 선물', source: 'futures', sourceKey: 'GOLD' },
    { key: 'vix', label: 'VIX', source: 'futures', sourceKey: 'VIX' }
  ];
  var OPTION_BY_KEY = {};
  OPTIONS.forEach(function (o) { OPTION_BY_KEY[o.key] = o; });
  var DEFAULT_SELECTED = ['kospi', 'kosdaq', 'usdkrw', 'btc'];

  // 네이버 스타일 참고 - 카드 상단에 국기/원자재 아이콘을 붙인다(2026-07-17).
  var FLAG_BY_KEY = {
    kospi: '🇰🇷', kosdaq: '🇰🇷', kospi_night: '🇰🇷',
    usdkrw: '💵', btc: '🪙',
    nasdaq: '🇺🇸', sp500: '🇺🇸', dow: '🇺🇸', sox: '🇺🇸', vix: '🇺🇸',
    wti: '🛢️', gold: '🥇'
  };

  // 장중/장마감 표시(네이버 스타일). 공휴일 캘린더가 없어 요일+시간만으로 근사한다 -
  // 코스피/코스닥은 KRX 정규장(평일 09:00~15:30 KST), 코스피 야간선물은 대략 평일
  // 18:00~익일 05:00, 나머지(해외선물/원자재/환율/코인)는 사실상 24시간에 가까워
  // 주말만 장마감으로 취급한다. 정확한 거래소 캘린더(공휴일 등)는 반영하지 않은
  // 근사치라 실제와 몇 분~하루 단위로 어긋날 수 있음을 감안할 것.
  function marketStatus(key) {
    // Date.now()는 방문자 위치와 무관하게 항상 UTC epoch ms라서, 여기에 9시간만 더하면
    // 방문자의 로컬 시간대(getTimezoneOffset)와 상관없이 정확한 KST 시각이 나온다.
    var kst = new Date(Date.now() + 9 * 60 * 60000);
    var day = kst.getUTCDay();
    var mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    var isWeekday = day >= 1 && day <= 5;

    if (key === 'kospi' || key === 'kosdaq') {
      return (isWeekday && mins >= 9 * 60 && mins < 15 * 60 + 30) ? '실시간' : '장마감';
    }
    if (key === 'kospi_night') {
      return (mins >= 18 * 60 || mins < 5 * 60) ? '실시간' : '장마감';
    }
    if (key === 'btc') return '실시간';
    return (day === 0 || day === 6) ? '장마감' : '실시간';
  }

  var refreshTimer = null;
  var lwcLoadPromise = null;
  var chartInstances = {}; // key -> { chart, series }
  var themeObserver = null;
  var moduleContainer = null;
  var dataCache = {}; // key -> {price, change, changeRate, chart} - 마지막으로 받은 값(선택 변경 시 재사용)

  function logError() {
    if (global.console && console.error) console.error.apply(console, arguments);
  }

  // ---- localStorage: 선택 목록 ----

  function loadSelected() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) return DEFAULT_SELECTED.slice();
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return DEFAULT_SELECTED.slice();
      return list.filter(function (k) { return OPTION_BY_KEY.hasOwnProperty(k); });
    } catch (err) {
      return DEFAULT_SELECTED.slice();
    }
  }

  function saveSelected(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (err) { /* 프라이빗 모드 등 무시 */ }
  }

  function toggleSelected(key) {
    var list = loadSelected();
    var idx = list.indexOf(key);
    if (idx > -1) list.splice(idx, 1);
    else list.push(key);
    saveSelected(list);
    return list;
  }

  // ---- localStorage: 접힘 상태 ----

  function isCollapsed() {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (err) { return false; }
  }
  function saveCollapsed(collapsed) {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (err) { /* 무시 */ }
  }

  // ---- 데이터 조회 ----

  function fetchJson(url) {
    var hasAbort = 'AbortController' in global;
    var controller = hasAbort ? new AbortController() : null;
    var timer = hasAbort ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    return fetch(url, hasAbort ? { signal: controller.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error('응답 오류: ' + r.status); return r.json(); })
      .then(function (data) { if (timer) clearTimeout(timer); return data; })
      .catch(function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  function fetchMarket() { return fetchJson(GAS_TICKER_URL + '?market=1'); }
  function fetchFutures() { return fetchJson(FUTURES_API).then(function (json) { return json.data || []; }); }

  // 2026-07-17(14차): BTC를 클라이언트 직접 업비트 호출에서 VM 서버사이드 수집(futures
  // 소스, scripts/cloud-vm/btc_futures.py)으로 옮기면서 다른 해외지수와 완전히 같은
  // 경로를 타게 됐다 - 더 이상 BTC 전용 분기가 필요 없다.
  function fetchSelectedData(selected) {
    var needMarket = selected.some(function (k) { return OPTION_BY_KEY[k].source === 'market'; });
    var needFutures = selected.some(function (k) { return OPTION_BY_KEY[k].source === 'futures'; });

    return Promise.all([
      needMarket ? QuickIndices.fetchMarket().catch(function () { return null; }) : Promise.resolve(null),
      needFutures ? QuickIndices.fetchFutures().catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (results) {
      var marketData = results[0] || {};
      var futuresBySymbol = {};
      (results[1] || []).forEach(function (it) { futuresBySymbol[it.symbol] = it; });

      var out = {};
      selected.forEach(function (key) {
        var opt = OPTION_BY_KEY[key];
        if (opt.source === 'market') {
          var m = marketData[opt.sourceKey];
          if (m) out[key] = { price: m.price, change: m.change, changeRate: m.changeRate, chart: null };
        } else {
          var f = futuresBySymbol[opt.sourceKey];
          if (f && typeof f.price === 'number') out[key] = { price: f.price, change: f.change, changeRate: f.change_rate, chart: f.chart || null };
        }
      });
      return out;
    });
  }

  // ---- 긴급속보(KRX 공시 티커, 옛 js/skin-main.js에서 이식) ----
  // 파싱 로직은 원본과 동일(같은 GAS ?market=0), 렌더링만 가로->세로 스크롤 목록으로 변경.

  function discCleanCDATA(str) {
    var s = str.indexOf('<![CDATA[');
    var e = str.lastIndexOf(']]>');
    if (s > -1 && e > -1) return str.slice(s + 9, e).trim();
    return str.trim();
  }
  function discExtractTag(chunk, tag) {
    var open = '<' + tag + '>';
    var close = '</' + tag + '>';
    var s = chunk.indexOf(open);
    var e = chunk.indexOf(close, s);
    if (s === -1 || e === -1) return '';
    return discCleanCDATA(chunk.slice(s + open.length, e));
  }
  function discDetectMarket(title) {
    if (title.indexOf('[코]') === 0) return 'KOSDAQ';
    if (title.indexOf('[코넥스]') === 0) return 'KOSDAQ';
    return 'KOSPI';
  }
  function discExtractCorp(title) {
    if (title.charAt(0) !== '[') return { corp: '', disc: title };
    var close = title.indexOf(']');
    if (close === -1) return { corp: '', disc: title };
    var rest = title.slice(close + 1).trim();
    var spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return { corp: rest, disc: '' };
    return { corp: rest.slice(0, spaceIdx).trim(), disc: rest.slice(spaceIdx).trim() };
  }
  function discParseXML(text) {
    var items = [];
    var parts = text.split('<item>');
    for (var i = 1; i < parts.length; i++) {
      var chunk = parts[i].split('</item>')[0];
      var title = discExtractTag(chunk, 'title');
      var link = discExtractTag(chunk, 'link');
      if (!title) continue;
      var market = discDetectMarket(title);
      var parsed = discExtractCorp(title);
      items.push({ corp: parsed.corp, disc: parsed.disc || title, link: link || '#', market: market });
    }
    return items;
  }

  // 목록을 2번 이어붙이고 translateY로 절반만큼 움직여 끊김 없이 순환(원본 disc-track 트릭).
  function fillNewsTrack(track, itemHTMLs) {
    var html = itemHTMLs.join('') + itemHTMLs.join('');
    track.innerHTML = html;
    // 세로 스크롤 속도(초당 약 18px) - 가로 티커(disc-track)의 scrollWidth/60 방식을
    // scrollHeight 기준으로 그대로 옮긴 것.
    track.style.animationDuration = (track.scrollHeight / 2 / 18) + 's';
  }

  function setNewsTitle(text) {
    var el = document.getElementById('qiNewsTitle');
    if (el) el.textContent = text;
  }

  function renderDiscNewsInto(track, items) {
    if (!track) return;
    setNewsTitle('실시간 공시');
    fillNewsTrack(track, items.map(function (it) {
      var cls = it.market === 'KOSDAQ' ? 'qi-news-market-kosdaq' : 'qi-news-market-kospi';
      var disc = it.disc.replace(/\s*\|\s*/g, ' ').trim();
      var corp = it.corp.replace(/\s*\|\s*/g, ' ').trim();
      return '<a href="' + it.link + '" target="_blank" class="qi-news-item">'
        + '<span class="' + cls + '">' + it.market + '</span>'
        + (corp ? '<span class="qi-news-corp">' + corp + '</span>' : '')
        + disc + '</a>';
    }));
  }

  // 2026-07-17(10차): 장외 시간엔 KIND 공시 RSS가 통째로 비어 "속보 없음"만 떠 있었다
  // (사용자 피드백) - 공시가 없으면 기존 GAS ?rankNews=1(네이버 뉴스 검색: 증시/코스피/
  // 코스닥 헤드라인, 서버에서 15분 캐싱)로 폴백해 패널이 비지 않게 한다.
  function renderRankNewsInto(track, items) {
    if (!track) return;
    setNewsTitle('긴급속보');
    if (!items.length) { track.innerHTML = '<span class="qi-news-loading">속보 없음</span>'; return; }
    fillNewsTrack(track, items.map(function (it) {
      return '<a href="' + it.link + '" target="_blank" class="qi-news-item">'
        + '<span class="qi-news-market-news">뉴스</span>'
        + it.title + '</a>';
    }));
  }

  function loadRankNewsFallback(track) {
    fetchJson(GAS_TICKER_URL + '?rankNews=1')
      .then(function (json) { renderRankNewsInto(track, (json && json.items) || []); })
      .catch(function () {
        if (track) track.innerHTML = '<span class="qi-news-loading">속보 없음</span>';
      });
  }

  function loadDisclosures(container) {
    var track = container.querySelector('#qiNewsTrack');
    function handle(items) {
      if (items.length) renderDiscNewsInto(track, items);
      else loadRankNewsFallback(track);
    }
    fetch(DISC_GAS_URL + '?market=0')
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var t = text.trim().replace(/^﻿/, '');
        if (t.charAt(0) === '<') {
          handle(discParseXML(t));
        } else if (t.length > 0) {
          try {
            var clean = t.replace(/\s/g, '');
            var bin = atob(clean);
            var bytes = new Uint8Array(bin.length);
            for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
            handle(discParseXML(new TextDecoder('utf-8').decode(bytes)));
          } catch (err) {
            handle([]);
          }
        } else {
          handle([]);
        }
      })
      .catch(function () { loadRankNewsFallback(track); });
  }

  // ---- 포맷/톤 ----

  function toneClass(change) {
    if (change > 0) return 'qi-pos';
    if (change < 0) return 'qi-neg';
    return 'qi-zero';
  }
  function arrowSymbol(change) {
    if (change > 0) return '▲';
    if (change < 0) return '▼';
    return '';
  }
  function formatNumber(n) {
    var num = Number(n);
    if (isNaN(num)) return String(n);
    // 13차: 1000 이상이면 소수점을 버리던 규칙 폐지(사용자 피드백: 토스는 코스피를
    // 6,820.60처럼 소수점까지 보여주는데 우리만 6,821로 반올림돼 "시세가 달라" 보였음).
    return num.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }

  // ---- 마운트: 페이지 종류와 무관하게 항상 공시 티커 아래 고정 ----

  function ensureContainer() {
    var existing = document.getElementById(CONTAINER_ID);
    if (existing) return existing;

    var el = document.createElement('div');
    el.id = CONTAINER_ID;
    el.className = 'qi-wrap';
    document.body.appendChild(el); // position:fixed라 DOM 위치는 스타일에 영향 없음
    return el;
  }

  // ---- 최초 렌더(틀 생성) ----

  function buildCardShell(opt, variantClass, draggable) {
    return '<div class="qi-card ' + variantClass + '" data-key="' + opt.key + '"'
      + (draggable ? ' draggable="true"' : '') + '>'
      + '<div class="qi-card-top">'
      + '<span class="qi-card-flag" aria-hidden="true">' + (FLAG_BY_KEY[opt.key] || '') + '</span>'
      + '<span class="qi-card-label">' + opt.label + '</span>'
      + '<span class="qi-card-status" data-field="status"></span>'
      + '</div>'
      // 11차: 등락률을 가격 아래 줄에서 가격 옆(같은 줄)으로 이동(사용자 요청)
      + '<div class="qi-card-priceline">'
      + '<span class="qi-card-price" data-field="price">-</span>'
      + '<span class="qi-card-change" data-field="change"></span>'
      + '</div>'
      + '<div class="qi-card-chart" data-field="chart"></div>'
      + '</div>';
  }

  // ---- 카드 순서 드래그 (2026-07-16 추가: 바 위치 자체는 고정, 카드 순서만 바꿀 수 있게) ----

  var dragKey = null;

  function wireCardDrag(scroll) {
    scroll.addEventListener('dragstart', function (e) {
      var card = e.target.closest ? e.target.closest('.qi-card') : null;
      if (!card) return;
      dragKey = card.getAttribute('data-key');
      card.classList.add('qi-dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    scroll.addEventListener('dragend', function (e) {
      var card = e.target.closest ? e.target.closest('.qi-card') : null;
      if (card) card.classList.remove('qi-dragging');
      dragKey = null;
    });
    scroll.addEventListener('dragover', function (e) {
      if (!dragKey) return;
      e.preventDefault(); // 드롭 허용
      var card = e.target.closest ? e.target.closest('.qi-card') : null;
      if (!card) return;
      var targetKey = card.getAttribute('data-key');
      if (targetKey === dragKey) return;
      var dragging = scroll.querySelector('.qi-card[data-key="' + dragKey + '"]');
      if (!dragging) return;
      var rect = card.getBoundingClientRect();
      var before = (e.clientX - rect.left) < rect.width / 2;
      scroll.insertBefore(dragging, before ? card : card.nextSibling);
    });
    scroll.addEventListener('drop', function (e) {
      e.preventDefault();
      persistCardOrder(scroll);
    });
  }

  // 그리드에는 큰 카드를 뺀 나머지 전부가 들어있다 - 맨 앞(큰 카드) 뒤에 그리드의
  // 새 순서를 그대로 이어붙여 저장한다.
  function persistCardOrder(grid) {
    var gridOrder = Array.prototype.map.call(grid.querySelectorAll('.qi-card'), function (c) {
      return c.getAttribute('data-key');
    });
    var full = loadSelected();
    saveSelected(full.slice(0, 1).concat(gridOrder));
  }

  // 카드는 여기서 채우지 않는다 - renderPage()가 현재 페이지 분량만 그린다.
  function renderShell(container) {
    container.classList.toggle('qi-collapsed', isCollapsed());
    container.innerHTML = ''
      + '<div class="qi-scroll" id="qiScroll">'
      + '<div class="qi-featured" id="qiFeatured"></div>'
      + '<div class="qi-grid" id="qiGrid"></div>'
      + '<div class="qi-news" id="qiNews">'
      // 11차: 빨간 점 -> 확성기 SVG 아이콘(사용자 요청). 타이틀은 데이터 소스에 따라
      // "실시간 공시"(KIND 공시) / "긴급속보"(네이버 뉴스 폴백)로 바뀐다.
      + '<div class="qi-news-header">'
      + '<span class="qi-news-ico" aria-hidden="true">'
      + '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">'
      + '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3z"/>'
      + '<path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      + '</svg></span>'
      + '<span id="qiNewsTitle">긴급속보</span></div>'
      + '<div class="qi-news-wrap"><div class="qi-news-track" id="qiNewsTrack"><span class="qi-news-loading">불러오는 중...</span></div></div>'
      + '</div>'
      + '</div>'
      // 12차: "전체 지수보기" 링크 삭제(사용자 요청 - 사이드바 메뉴로 충분)
      + '<div class="qi-controls">'
      + '<div class="qi-controls-icons">'
      // 15차: 11차에서 붙였던 "리본 접기/펼치기" 한글 라벨 제거(사용자 요청) - 다시
      // 아이콘 전용 원형 버튼으로. 그만큼 좁아진 .qi-controls 폭은 옆 .qi-news(flex:1)가
      // 자동으로 흡수해 늘어난다(레이아웃 재계산 불필요, flexbox가 알아서 함).
      + '<button type="button" class="qi-collapse-btn" id="qiCollapseBtn" aria-label="관심지수 리본 접기/펼치기">' + (isCollapsed() ? '▸' : '▾') + '</button>'
      + '<div class="qi-add-wrap">'
      + '<button type="button" class="qi-add-btn" id="qiAddBtn" aria-label="지수 추가">+</button>'
      + '<div class="qi-popover" id="qiPopover"></div>'
      + '</div>'
      + '</div>'
      + '</div>';

    container.querySelector('#qiAddBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      togglePopover(container);
    });
    container.querySelector('#qiCollapseBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      setCollapsed(container, !isCollapsed());
    });
    wireCardDrag(container.querySelector('#qiGrid'));
  }

  function setCollapsed(container, collapsed) {
    saveCollapsed(collapsed);
    document.documentElement.style.setProperty('--qi-height', collapsed ? HEIGHT_COLLAPSED : HEIGHT_EXPANDED);
    container.classList.toggle('qi-collapsed', collapsed);
    var btn = container.querySelector('#qiCollapseBtn');
    if (btn) btn.textContent = collapsed ? '▸' : '▾';
  }

  // ---- 갱신(기존 카드 값만 업데이트 - 깜빡임 방지) ----

  function applyCardData(scroll, key, data) {
    var card = scroll.querySelector('.qi-card[data-key="' + key + '"]');
    if (!card) return;
    var statusEl = card.querySelector('[data-field="status"]');
    if (statusEl) statusEl.textContent = '· ' + marketStatus(key);
    var priceEl = card.querySelector('[data-field="price"]');
    var changeEl = card.querySelector('[data-field="change"]');
    var chartEl = card.querySelector('[data-field="chart"]');

    if (!data) {
      priceEl.textContent = '-';
      changeEl.textContent = '';
      return;
    }
    var tone = toneClass(data.change);
    priceEl.textContent = formatNumber(data.price);
    priceEl.className = 'qi-card-price ' + tone;
    changeEl.textContent = arrowSymbol(data.change) + Math.abs(data.changeRate).toFixed(2) + '%';
    changeEl.className = 'qi-card-change ' + tone;

    if (data.chart && data.chart.length > 1) renderSparkline(chartEl, key, data.chart, data.change >= 0, data.price, data.change);
  }

  // 선택된 지수 전부(큰 카드 1 + 나머지 그리드)를 새로 그리고, dataCache에 있는 값으로
  // 즉시 채운다(재조회 없음). 페이징 없음 - 최대 11종이 전부 한 화면에 들어간다.
  function renderPage(container) {
    var featured = container.querySelector('#qiFeatured');
    var grid = container.querySelector('#qiGrid');
    if (!featured || !grid) return;
    var selected = loadSelected();
    var featuredKey = selected[0];
    var gridKeys = selected.slice(1);

    Object.keys(chartInstances).forEach(function (key) {
      if (selected.indexOf(key) === -1) destroyChart(key);
    });

    featured.innerHTML = featuredKey ? (function () {
      var opt = OPTION_BY_KEY[featuredKey];
      return opt ? buildCardShell(opt, 'qi-card-featured', false) : '';
    })() : '';

    grid.innerHTML = gridKeys.map(function (key) {
      var opt = OPTION_BY_KEY[key];
      return opt ? buildCardShell(opt, 'qi-card-grid', true) : '';
    }).join('');

    selected.forEach(function (key) {
      if (dataCache.hasOwnProperty(key)) applyCardData(container, key, dataCache[key]);
    });
  }

  // 체크박스로 선택이 바뀌었을 때: 아직 캐시에 없는(새로 추가된) 항목만 조회하고,
  // 화면은 바로 현재 페이지 기준으로 다시 그린다.
  function onSelectionChanged(container, selected) {
    renderPage(container);
    var missing = selected.filter(function (k) { return !dataCache.hasOwnProperty(k); });
    if (!missing.length) return;
    fetchSelectedData(missing)
      .then(function (dataByKey) {
        Object.keys(dataByKey).forEach(function (k) { dataCache[k] = dataByKey[k]; });
        renderPage(container);
      })
      .catch(function (err) { logError('[quick-indices] 조회 실패', err); });
  }

  // ---- 미니 스파크라인 (js/overnight-market.js와 동일한 Lightweight Charts 지연 로드 패턴) ----

  function loadLightweightCharts() {
    if (global.LightweightCharts) return Promise.resolve(global.LightweightCharts);
    if (lwcLoadPromise) return lwcLoadPromise;
    lwcLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LWC_CDN;
      s.onload = function () { resolve(global.LightweightCharts); };
      s.onerror = function () { lwcLoadPromise = null; reject(new Error('차트 라이브러리 로드 실패')); };
      document.head.appendChild(s);
    });
    return lwcLoadPromise;
  }

  function chartThemeOptions() {
    return {
      layout: { background: { color: 'transparent' }, textColor: '#888', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } }
    };
  }

  function toLwcTime(yyyymmdd) {
    var s = String(yyyymmdd);
    if (s.indexOf('-') > -1) return s; // 이미 YYYY-MM-DD
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }

  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function destroyChart(key) {
    var inst = chartInstances[key];
    if (!inst) return;
    try { inst.chart.remove(); } catch (e) { /* 이미 제거된 DOM이면 무시 */ }
    delete chartInstances[key];
  }

  // 2026-07-16: 단일 색 영역차트 -> 베이스라인 차트(시가 기준 위/아래 이중톤)로 변경.
  // 2026-07-17(7차): 토스증권 참고 스크린샷에서 "선(등락률) 차이" 지적 - 토스는 이중톤이
  // 아니라 등락 방향에 따라 카드 전체가 빨강 또는 파랑 단색 한 줄이다. 다시 단색 영역
  // 차트로 되돌리되, 색은 changeRate 대신 실제 등락(positive)으로 정한다.
  // 2026-07-17(11차): 점선 기준선을 "차트 구간 첫 종가"에서 "전일 종가(price - change)"로
  // 변경(사용자 피드백: 하락 중인데 선 위에 떠 있음 - 몇 달 전 시세가 기준이라 오늘의
  // 등락 방향과 무관했음). 차트 마지막 점도 현재가로 맞춰서(일봉 이력의 마지막이 어제까지면
  // 오늘 점을 덧붙임) 선 위/아래가 항상 등락 방향과 일치한다. 60초 갱신 때도 값이 바뀌도록
  // 기존 인스턴스가 있으면 setData/기준선 갱신을 한다(예전엔 최초 1회만 그리고 끝이었음).
  function renderSparkline(container, key, rows, positive, price, change) {
    loadLightweightCharts().then(function (LWC) {
      if (!document.body.contains(container)) return;

      var seriesData = rows.map(function (r) { return { time: toLwcTime(r.date), value: r.close }; });
      if (typeof price === 'number') {
        var kst = new Date(Date.now() + 9 * 60 * 60000);
        var today = kst.toISOString().slice(0, 10);
        var last = seriesData[seriesData.length - 1];
        if (last.time >= today) last.value = price;
        else seriesData.push({ time: today, value: price });
      }
      var baseline = (typeof price === 'number' && typeof change === 'number') ? price - change : rows[0].close;
      var color = positive ? '#d24f45' : '#1261c4';

      var existing = chartInstances[key];
      if (existing) {
        existing.series.applyOptions({ lineColor: color, topColor: hexToRgba(color, 0.2), bottomColor: hexToRgba(color, 0.02) });
        existing.series.setData(seriesData);
        existing.priceLine.applyOptions({ price: baseline });
        existing.chart.timeScale().fitContent();
        return;
      }

      var chart = LWC.createChart(container, Object.assign({
        autoSize: true,
        height: SPARKLINE_HEIGHT,
        handleScroll: false,
        handleScale: false,
        rightPriceScale: { visible: false },
        leftPriceScale: { visible: false },
        timeScale: { visible: false },
        crosshair: { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } }
      }, chartThemeOptions()));

      var series = chart.addAreaSeries({
        lineColor: color,
        topColor: hexToRgba(color, 0.2),
        bottomColor: hexToRgba(color, 0.02),
        // 2026-07-17(10차): 1.5 -> 1 (사용자 피드백: "차트 선이 너무 굵어")
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      series.setData(seriesData);
      // 점선 기준선(8차에 도입, 11차부터 전일 종가 기준 - 위 주석 참고)
      var priceLine = series.createPriceLine({
        price: baseline,
        color: '#999',
        lineWidth: 1,
        lineStyle: LWC.LineStyle.Dashed,
        axisLabelVisible: false
      });
      chart.timeScale().fitContent();
      chartInstances[key] = { chart: chart, series: series, priceLine: priceLine };
    }).catch(function () { /* 차트 없이도 가격/등락률은 이미 보이므로 조용히 무시 */ });
  }

  // ---- "+ 지수 추가" 팝오버 (스크롤 영역 밖 .qi-controls에 있어 버튼 바로 아래에 뜬다) ----

  function renderPopover(container, selected) {
    var pop = container.querySelector('#qiPopover');
    if (!pop) return;
    pop.innerHTML = OPTIONS.map(function (opt) {
      var checked = selected.indexOf(opt.key) > -1;
      return '<label class="qi-pop-item">'
        + '<input type="checkbox" data-key="' + opt.key + '"' + (checked ? ' checked' : '') + ' />'
        + '<span>' + opt.label + '</span>'
        + '</label>';
    }).join('');
  }

  function togglePopover(container) {
    var pop = container.querySelector('#qiPopover');
    if (!pop) return;
    var willOpen = !pop.classList.contains('open');
    if (willOpen) renderPopover(container, loadSelected());
    pop.classList.toggle('open', willOpen);
  }

  function closePopover(container) {
    var pop = container.querySelector('#qiPopover');
    if (pop) pop.classList.remove('open');
  }

  function wireEvents(container) {
    container.addEventListener('click', function (e) {
      var input = e.target.closest ? e.target.closest('input[type="checkbox"]') : null;
      if (!input) return;
      var key = input.getAttribute('data-key');
      var list = toggleSelected(key);
      // 2026-07-16 버그 수정: 예전엔 여기서 rebuild()(전체 다시 그리기)를 불러서 팝오버
      // 자체가 통째로 새로 그려지며 열림 상태(class="open")가 사라졌다 - 체크할 때마다
      // 팝오버가 닫혀버려 하나씩만 추가/제거할 수 있었던 원인. 이제 팝오버는 그대로 두고
      // 카드 목록(현재 페이지)만 다시 그려 여러 개를 연달아 체크/해제해도 열려있는 채로 있다.
      onSelectionChanged(container, list);
    });

    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) closePopover(container);
    });
  }

  // 선택 목록 자체가 바뀔 때만(최초 로드) 틀을 다시 그린다.
  function rebuild(container, selected) {
    Object.keys(chartInstances).forEach(destroyChart);
    renderShell(container);
    if (!selected.length) { renderPage(container); return; }
    renderPage(container); // 캐시가 있으면(재초기화 등) 바로 채우고, 없으면 '-' 상태로 우선 표시
    fetchSelectedData(selected)
      .then(function (dataByKey) {
        dataCache = dataByKey;
        renderPage(container);
      })
      .catch(function (err) { logError('[quick-indices] 조회 실패', err); });
  }

  // 주기적 갱신은 틀을 다시 그리지 않고 값만 바꿔서 깜빡임을 없앤다(2026-07-16 피드백).
  // 페이지 전환과 무관하게 선택된 전체 종목을 계속 조회해 dataCache를 채워둔다.
  function refresh(container) {
    var selected = loadSelected();
    if (!selected.length) return;
    fetchSelectedData(selected)
      .then(function (dataByKey) {
        dataCache = dataByKey;
        var scroll = container.querySelector('#qiScroll');
        if (!scroll) return;
        Array.prototype.forEach.call(scroll.querySelectorAll('.qi-card'), function (card) {
          var key = card.getAttribute('data-key');
          applyCardData(scroll, key, dataByKey[key]);
        });
      })
      .catch(function (err) { logError('[quick-indices] 갱신 실패', err); });
  }

  function init() {
    var container = ensureContainer();
    moduleContainer = container;
    wireEvents(container);
    rebuild(container, loadSelected());
    loadDisclosures(container);

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (document.hidden) return;
      refresh(container);
    }, REFRESH_MS);

    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(function () {
      Object.keys(chartInstances).forEach(function (key) {
        chartInstances[key].chart.applyOptions(chartThemeOptions());
      });
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  var QuickIndices = { init: init, fetchMarket: fetchMarket, fetchFutures: fetchFutures };
  global.QuickIndices = QuickIndices;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
