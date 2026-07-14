/**
 * 간밤 시황(나스닥·S&P500·코스피 야간선물·필라델피아 반도체·WTI 원유·VIX·국제 금)
 * 위젯 - 신규 페이지 전용.
 *
 * 상단 리본(js/market-ribbon.js, 코스피/코스닥/원달러/BTC)과는 완전히 별개 - 그쪽은 안 건드림.
 *
 * 데이터 소스: TradingView 공식 임베드 위젯(무료, API 키 불필요) - 우리 서버가 직접 값을
 * 받아오는 게 아니라 방문자 브라우저에서 TradingView가 직접 렌더링한다.
 * 이렇게 한 이유: 이 7개를 한 번에 받아오는 무료 API가 없고
 * (키움은 국내+미국 개별종목만, 야후 파이낸스도 코스피 야간선물 심볼 자체가 없음),
 * 예전에 야후로 직접 받아오다가 캐시가 1시간 넘게 갱신 안 되는 버그를 겪은 적이 있어
 * 공식 위젯으로 방문자 브라우저에서 직접 그리는 쪽이 더 안정적이라고 판단함(2026-07-14).
 * 단, TradingView 무료 위젯도 선물은 10분 지연 데이터라 완전한 실시간은 아님 - 유료
 * 거래소 데이터 구독(거래소당 월 $2~) 없이는 어떤 소스를 쓰든 이 지연은 못 없앤다.
 *
 * AI(Groq) 해설은 이번 1단계에서 제외함 - 위젯 안의 실시간 숫자를 서버가 못 읽어오는데
 * 다른 소스(야후 등)로 숫자를 받아 해설에 쓰면 위젯에 보이는 값과 어긋날 수 있어서
 * (신뢰도 문제), 정확한 숫자 소스가 정리되면 다음 단계에서 추가하기로 함.
 *
 * 2026-07-14: 처음엔 "Mini Symbol Overview" 위젯(작은 카드+스파크라인)으로 만들었으나,
 * CME_MINI:NQ1!/ES1!, NYMEX:CL1!, COMEX:GC1! 같은 **CME/NYMEX/COMEX 거래소 연결선물
 * 심볼**은 데이터 라이선스 제한으로 무료 위젯(Mini든 Advanced Chart든 동일)에서
 * "TradingView에서만 제공되는 심볼입니다" 알림만 뜨고 차트가 안 그려지는 문제를
 * 라이브에서 실제로 겪음(위젯 종류를 Advanced Chart로 바꿔도 동일하게 막힘 - 위젯 문제가
 * 아니라 심볼(거래소 데이터 소스) 문제였음). 해결: 같은 지표를 추적하는 **TVC/CAPITALCOM
 * CFD 심볼**로 교체(나스닥100→CAPITALCOM:NAS100, S&P500→CAPITALCOM:SPX500, WTI원유→
 * TVC:USOIL, 금→TVC:GOLD) - CFD 데이터는 라이선스가 더 자유로워 무료 위젯에서 정상
 * 렌더링됨. VIX(TVC:VIX)/반도체(TVC:SOX)는 처음부터 TVC라 문제없었음. 코스피 야간선물
 * (KRX:K2I1!)만 국내 거래소 데이터라 CFD 대안이 마땅치 않아 원래 심볼 유지 - 안 뜨면
 * 별도로 다시 봐야 함. 위젯은 다시 "Mini Symbol Overview"로 원복(요구사항이었던
 * "미니 차트" 그대로).
 */
(function (global) {
  'use strict';

  var CONTAINER_SELECTOR = '#overnight-market';

  var INSTRUMENTS = [
    { symbol: 'CAPITALCOM:NAS100', label: '나스닥 100 선물' },
    { symbol: 'CAPITALCOM:SPX500', label: 'S&P500 선물' },
    { symbol: 'KRX:K2I1!', label: '코스피200 야간선물' },
    { symbol: 'TVC:SOX', label: '필라델피아 반도체 지수' },
    { symbol: 'TVC:USOIL', label: 'WTI 원유 선물' },
    { symbol: 'TVC:VIX', label: 'VIX(변동성 지수)' },
    { symbol: 'TVC:GOLD', label: '국제 금 선물' }
  ];

  var TV_MINI_CHART_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';
  var themeObserver = null;

  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  // TradingView 위젯은 최초 스크립트 삽입 시점의 colorTheme으로 고정 렌더링되고 이후
  // 동적으로 못 바꾼다 - 다크모드 토글 시 위젯 div를 통째로 비우고 다시 그려서 대응한다.
  function renderWidget(container, instrument) {
    container.innerHTML =
      '<div class="om-widget-title">' + instrument.label + '</div>' +
      '<div class="tradingview-widget-container">' +
        '<div class="tradingview-widget-container__widget"></div>' +
      '</div>';

    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = TV_MINI_CHART_SRC;
    script.async = true;
    script.text = JSON.stringify({
      symbol: instrument.symbol,
      width: '100%',
      height: 240,
      locale: 'kr',
      dateRange: '12M',
      colorTheme: isDark() ? 'dark' : 'light',
      isTransparent: true,
      autosize: true
    });
    container.querySelector('.tradingview-widget-container').appendChild(script);
  }

  function renderAll(container) {
    var cards = container.querySelectorAll('.om-card');
    cards.forEach(function (card, i) {
      renderWidget(card, INSTRUMENTS[i]);
    });
  }

  function buildShell() {
    return '<div class="om-grid">' +
      INSTRUMENTS.map(function () { return '<div class="om-card"></div>'; }).join('') +
      '</div>';
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    container.innerHTML = buildShell();
    renderAll(container);

    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(function () {
      renderAll(container);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
