/**
 * 글 내 티커 자동 툴팁 - GAS 프록시 (1단계 MVP)
 *
 * 네이버 금융 polling API를 중계해 CORS를 우회하고, 결과를 캐싱한다.
 * 기존 "KRX 공시 티커" GAS 프록시와 동일한 배포 패턴을 따른다.
 *
 * 호출: GET {WEB_APP_URL}?codes=005930,083650,247540
 * 응답: [{ code, name, price, change, changeRate, volume, time }, ...]
 *
 * 배포 방법은 README_ticker.md 참고.
 */

var NAVER_POLLING_URL = 'https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:';
var CACHE_PREFIX = 'ticker_';
var CACHE_TTL_OPEN = 60;       // 장중(평일 09:00~15:40 KST): 60초
var CACHE_TTL_CLOSED = 1800;   // 장외/주말: 1800초

function doGet(e) {
  var params = (e && e.parameter) || {};

  if (params.market === '1') {
    return jsonResponse(getMarketRibbon());
  }

  if (params.news === '1') {
    return jsonResponse(getStockNews((params.code || '').trim(), (params.name || '').trim()));
  }

  if (params.marketAnalysis === '1') {
    return jsonResponse(getMarketAnalysis());
  }

  if (params.action === 'kospiFuturesAnalysis') {
    return jsonResponse(getKospiFuturesAnalysis());
  }

  if (params.action === 'subIndexAnalysis') {
    return jsonResponse(getSubIndexAnalysis());
  }

  if (params.marketTemp === '1') {
    return jsonResponse(getMarketTemp());
  }

  if (params.marketTempBriefing === '1') {
    return jsonResponse(getMarketTempBriefing());
  }

  if (params.bubble === '1') {
    return jsonResponse(getMarketcapBubble());
  }

  if (params.action === 'foreignFlow') {
    return jsonResponse(getForeignFlow((params.code || '').trim()));
  }

  if (params.action === 'shortPressure') {
    return jsonResponse(getShortPressure((params.code || '').trim()));
  }

  if (params.action === 'pensionFund') {
    return jsonResponse(getPensionFund((params.code || '').trim()));
  }

  if (params.action === 'flowAiSummary') {
    return jsonResponse(getFlowAiSummary(params));
  }

  if (params.action === 'flowChart') {
    return jsonResponse(getFlowChart((params.code || '').trim()));
  }

  if (params.action === 'indexChart') {
    return jsonResponse(getIndexChart((params.symbol || '').trim()));
  }

  // 2026-07-13: ?action=investorFlow(GAS 경유)는 폐기됨 - GAS->VM 구간이 간헐적으로
  // 통째로 막히는 원인 불명 현상 때문에, js/foreign-flow.js가 VM을 직접 호출하도록 전환
  // (호출 도메인은 2026-07-16 https://ghlee.duckdns.org -> https://goodbyestar.cloud로 교체됨,
  // 사내망이 duckdns 동적DNS 카테고리를 차단해서 응답을 못 받던 문제 때문 - 커밋 13fd0d6).
  // getInvestorFlowLive_()/kiwoomVmFetch_('/investor-flow/...')는
  // 더 이상 아무도 안 씀(kiwoomVmFetch_ 자체는 다른 VM 배치 엔드포인트에 계속 씀).

  if (params.action === 'fundamentals') {
    return jsonResponse(getFundamentals_((params.code || '').trim()));
  }

  if (params.debugShortNaver === '1') {
    return jsonResponse(debugShortTradeNaver((params.code || '').trim()));
  }

  if (params.rankNews === '1') {
    return jsonResponse(getRankingNews());
  }

  if (params.patternScan === '1') {
    return jsonResponse(getPatternScanResult());
  }

  if (params.patternChart === '1') {
    return jsonResponse(getPatternChart((params.code || '').trim(), (params.pattern || '').trim()));
  }

  if (params.investSignal === '1') {
    return jsonResponse(getInvestSignalResult());
  }

  var raw = (params.codes || '').trim();

  if (!raw) {
    return jsonResponse([]);
  }

  var codes = uniqueList(
    raw.split(',')
      .map(function (c) { return c.trim(); })
      .filter(Boolean)
  );

  if (!codes.length) {
    return jsonResponse([]);
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = cacheKeyFor(codes);
  var cached = cache.get(cacheKey);
  if (cached) {
    return jsonResponse(JSON.parse(cached));
  }

  var result;
  try {
    result = fetchFromNaver(codes);
  } catch (err) {
    // 네이버 쪽 오류/스키마 변경 시 빈 배열로 응답 (프론트가 원문 유지로 처리)
    return jsonResponse([]);
  }

  var ttl = isAnyTradingSessionOpen_() ? CACHE_TTL_OPEN : CACHE_TTL_CLOSED;
  cache.put(cacheKey, JSON.stringify(result), ttl);

  return jsonResponse(result);
}

// 종목 코드가 많을 때(섹터 풀 전체 등) URL 하나에 다 넣으면 길이가 너무 길어져
// 네이버 쪽 응답이 느려지거나 실패할 수 있어(fetchQuotesWithCap에서 이미 40개를
// 안정 배치 크기로 검증해 둠, MARKETCAP_BATCH_SIZE 참고), 동일 기준으로 배치 분할한다.
function fetchFromNaver(codes) {
  var out = [];
  for (var i = 0; i < codes.length; i += MARKETCAP_BATCH_SIZE) {
    var batch = codes.slice(i, i + MARKETCAP_BATCH_SIZE);
    var url = NAVER_POLLING_URL + batch.join(',');
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (res.getResponseCode() !== 200) continue;

    // 네이버 polling API는 Content-Type: text/plain;charset=EUC-KR 로 응답한다 -> EUC-KR 명시
    var body = JSON.parse(res.getContentText('EUC-KR'));
    var areas = (body && body.result && body.result.areas) || [];
    var itemArea = null;
    for (var a = 0; a < areas.length; a++) {
      if (areas[a].name === 'SERVICE_ITEM') { itemArea = areas[a]; break; }
    }
    var datas = (itemArea && itemArea.datas) || [];
    var time = formatKstTime((body.result && body.result.time) || Date.now());

    datas.forEach(function (d) {
      // rf: 등락 구분 (1 상한, 2 상승, 3 보합, 4 하한, 5 하락)
      var sign = (d.rf === '4' || d.rf === '5') ? -1 : 1;
      var q = applyNxtOverride_(d, Number(d.nv) || 0, Math.abs(Number(d.cv) || 0) * sign, Math.abs(Number(d.cr) || 0) * sign);
      out.push({
        code: d.cd,
        name: d.nm,
        price: q.price,
        change: q.change,
        changeRate: q.changeRate,
        volume: Number(d.aq) || 0,
        time: time
      });
    });
  }
  return out;
}

// 정규장(09:00~15:40) 마감 후엔 네이버 폴링 API의 원장(KRX) 필드(nv/cv/cr)가 더 안 바뀌어서
// "15:00 시세에 고정된 것처럼" 보였다(2026-07-16 사용자 지적). 같은 응답의 각 종목 데이터에
// 딸려오는 nxtOverMarketPriceInfo(NXT 대체거래소 프리마켓 08:00~09:00/애프터마켓 15:30~20:00
// 시세)가 있으면 그걸 최신가로 우선한다 - 실측 확인(2026-07-16, 삼성전자 005930):
// overPrice="273,500"(NXT 애프터마켓 종가), compareToPreviousClosePrice/fluctuationsRatio는
// 정규장 종가 대비 등락. 정규장 중엔 원장 값이 이미 최신이라 건드리지 않는다(신뢰도 낮은 데이터로
// 덮어쓰지 않기 위함 - 이 필드가 장중에도 남아있을 때의 동작이 실측 확인이 안 됐음).
function applyNxtOverride_(d, price, change, changeRate) {
  if (isMarketOpenNow()) return { price: price, change: change, changeRate: changeRate };
  var over = d.nxtOverMarketPriceInfo;
  if (!over) return { price: price, change: change, changeRate: changeRate };
  var nxtPrice = parseFloat(String(over.overPrice || '').replace(/,/g, ''));
  if (!nxtPrice) return { price: price, change: change, changeRate: changeRate };
  var code = over.compareToPreviousPrice && over.compareToPreviousPrice.code;
  var sign = (code === '4' || code === '5') ? -1 : 1;
  var nxtChange = Math.abs(parseFloat(String(over.compareToPreviousClosePrice || '').replace(/,/g, '')) || 0) * sign;
  var nxtChangeRate = Math.abs(parseFloat(String(over.fluctuationsRatio || '').replace(/,/g, '')) || 0) * sign;
  return { price: nxtPrice, change: nxtChange, changeRate: nxtChangeRate };
}

// 상단 지수/환율/코인 리본용 (2단계): 코스피/코스닥/원달러환율/BTC 4종을 한 번에 묶어 응답.
// 각 종목은 서로 다른 API(폴링/marketindex/업비트)라 개별 실패해도 나머지는 살리도록 감싼다.
function getMarketRibbon() {
  var cache = CacheService.getScriptCache();
  // market_ribbon3: BTC 소스 교체(빗썸 1순위 + 코인게코 폴백) 배포와 함께 옛 null 캐시 무효화
  var cacheKey = CACHE_PREFIX + 'market_ribbon3';
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // 코스피/코스닥/환율은 서로 독립적인 요청이라 fetchAll로 동시에 쏴서 지연시간을 줄인다.
  // (코인은 빗썸->코인게코 순차 폴백 로직이라 별도로 둔다.)
  var indexExchangeReqs = [
    { url: 'https://polling.finance.naver.com/api/realtime?query=SERVICE_INDEX:KOSPI', muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } },
    { url: 'https://polling.finance.naver.com/api/realtime?query=SERVICE_INDEX:KOSDAQ', muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } },
    { url: 'https://api.stock.naver.com/marketindex/exchange/FX_USDKRW', muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }
  ];
  var responses = safeCall(function () { return UrlFetchApp.fetchAll(indexExchangeReqs); }) || [];

  var result = {
    kospi: safeCall(function () { return parseIndexResponse_(responses[0], '코스피'); }),
    kosdaq: safeCall(function () { return parseIndexResponse_(responses[1], '코스닥'); }),
    usdkrw: safeCall(function () { return parseExchangeResponse_(responses[2]); }),
    btc: safeCall(function () { return fetchCrypto(); })
  };

  // BTC 실패(null)가 장외 30분 캐시에 박제되지 않도록, 실패 시엔 120초만 캐싱
  var ttl = result.btc ? (isMarketOpenNow() ? CACHE_TTL_OPEN : CACHE_TTL_CLOSED) : 120;
  cache.put(cacheKey, JSON.stringify(result), ttl);
  return result;
}

function safeCall(fn) {
  try {
    return fn();
  } catch (err) {
    return null;
  }
}

// 코스피/코스닥 지수 - 종목과 동일한 네이버 polling API, prefix만 SERVICE_INDEX
function fetchIndex(code, label) {
  var url = 'https://polling.finance.naver.com/api/realtime?query=SERVICE_INDEX:' + code;
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  return parseIndexResponse_(res, label);
}

// fetchIndex()의 파싱부만 분리 - getMarketRibbon()이 fetchAll로 받은 응답을 재사용하기 위함.
// 2026-07-14: nv/cv를 100으로 안 나누던 버그 수정 - 네이버 폴링 API가 지수를 100배로 반환함
// (실측: KOSPI nv=685683는 실제 6856.83). 안 나눈 원값이 AI 시황요약(getMarketAnalysis) 프롬프트에
// 그대로 들어가서 Groq가 엉뚱한 숫자(2,856.83)를 지어내는 결과로 이어졌음 - 사용자가 발견.
function parseIndexResponse_(res, label) {
  if (!res || res.getResponseCode() !== 200) return null;

  var body = JSON.parse(res.getContentText('EUC-KR'));
  var areas = (body && body.result && body.result.areas) || [];
  var d = areas[0] && areas[0].datas && areas[0].datas[0];
  if (!d) return null;

  var sign = (d.rf === '4' || d.rf === '5') ? -1 : 1;
  return {
    name: label,
    price: (Number(d.nv) || 0) / 100,
    change: (Math.abs(Number(d.cv) || 0) / 100) * sign,
    changeRate: Math.abs(Number(d.cr) || 0) * sign
  };
}

// 원/달러 환율 - 네이버 marketindex API (finance.naver.com/marketindex 뒷단, 지수 폴링 API와 다른 스키마)
function fetchExchange(marketIndexCd) {
  var url = 'https://api.stock.naver.com/marketindex/exchange/' + marketIndexCd;
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  return parseExchangeResponse_(res);
}

// fetchExchange()의 파싱부만 분리 - getMarketRibbon()이 fetchAll로 받은 응답을 재사용하기 위함.
function parseExchangeResponse_(res) {
  if (!res || res.getResponseCode() !== 200) return null;

  var body = JSON.parse(res.getContentText('UTF-8'));
  var info = body && body.exchangeInfo;
  if (!info) return null;

  // fluctuations/fluctuationsRatio는 "-12.50" 처럼 부호가 이미 포함된 문자열 + 천단위 콤마
  return {
    name: '원/달러',
    price: parseFloat(String(info.closePrice).replace(/,/g, '')) || 0,
    change: parseFloat(String(info.fluctuations).replace(/,/g, '')) || 0,
    changeRate: parseFloat(String(info.fluctuationsRatio).replace(/,/g, '')) || 0
  };
}

// BTC/KRW.
// 2026-07-06: 원래 업비트를 썼는데 GAS UrlFetchApp에서 "사용할 수 없는 주소" 예외로
// 호출 자체가 막혀있는 걸 확인(구글 쪽 도메인 차단으로 추정) -> 빗썸을 1순위로 쓰고,
// 실패하면 코인게코로 폴백 (코인게코 무료 API는 구글 공용 IP에서 429가 잦음).
function fetchCrypto() {
  return safeCall(fetchCryptoBithumb) || safeCall(fetchCryptoCoinGecko);
}

function fetchCryptoBithumb() {
  var url = 'https://api.bithumb.com/public/ticker/BTC_KRW';
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (res.getResponseCode() !== 200) return null;

  var body = JSON.parse(res.getContentText('UTF-8'));
  var d = body && body.status === '0000' && body.data;
  if (!d || !d.closing_price) return null;

  return {
    name: 'BTC',
    price: Number(d.closing_price) || 0,
    change: Number(d.fluctate_24H) || 0,
    changeRate: Number(d.fluctate_rate_24H) || 0
  };
}

function fetchCryptoCoinGecko() {
  var url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=krw&include_24hr_change=true';
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (res.getResponseCode() !== 200) return null;

  var body = JSON.parse(res.getContentText('UTF-8'));
  var d = body && body.bitcoin;
  if (!d || d.krw == null) return null;

  var price = d.krw;
  var changeRate = d.krw_24h_change || 0;
  // 코인게코는 등락률(%)만 주고 등락액은 안 줘서, 24시간 전 가격을 역산해 등락액을 구한다.
  var prevPrice = price / (1 + changeRate / 100);

  return {
    name: 'BTC',
    price: price,
    change: price - prevPrice,
    changeRate: changeRate
  };
}

// 시가총액 히트맵(트리맵) - ETF10/INVERSE4 + 삼성전자·SK하이닉스 단일종목레버리지 합산 +
// 코스피/코스닥은 섹터 대시보드 종목 풀 전체(fetchSectorUniverseWithSectors_, ~238종목,
// 업종 태그 포함)를 재사용 - "최대한 많은 종목" + 업종 필터 요구사항 때문에 2026-07-11
// 히트맵 개편 때 하드코딩 20/15종목 목록에서 전환. ETF/LEV/INVERSE는 data/marketcap-codes.js와
// 종목 구성이 동일해야 함 - 종목 교체 시 두 파일 다 수정.
// SERVICE_ITEM 쿼리는 시가총액 필드가 없어 countOfListedStock(상장주식수) x nv(현재가)로 계산.
// (KODEX 200으로 검증: /api/realtime/domestic/stock/ 의 marketValueFullRaw와 정확히 일치)
var MARKETCAP_CODES = {
  ETF: ['069500', '360750', '133690', '102110', '396500', '122630', '233740', '229200', '411060', '091160'],
  INVERSE: ['114800', '252670', '252710', '251340'],
  LEV_SAMSUNG: ['0193W0', '0195R0', '0194M0', '0192M0', '0193K0', '0194N0', '0198B0'],
  LEV_HYNIX: ['0193T0', '0195S0', '0194T0', '0192L0', '0197W0', '0194R0', '0198D0']
};
var MARKETCAP_BATCH_SIZE = 40; // Naver polling API 배치 크기 - 40개까지 안정적으로 검증됨

function getMarketcapBubble() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'bubble_v2'; // v1(코스피20/코스닥15 고정) -> v2(섹터 풀 전체+업종+인버스)로 캐시 키 분리
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var universe = fetchSectorUniverseWithSectors_(); // [{code,name,market,sectors:[...]}, ...]
  var universeCodes = universe.map(function (u) { return u.code; });

  var allCodes = [].concat(
    universeCodes, MARKETCAP_CODES.ETF, MARKETCAP_CODES.INVERSE,
    MARKETCAP_CODES.LEV_SAMSUNG, MARKETCAP_CODES.LEV_HYNIX
  );
  var quoteByCode = fetchQuotesWithCap(allCodes);

  var result = {
    updatedAt: formatKstTime(Date.now()),
    data: {
      KOSPI: pickUniverseQuotes(universe, 'KOSPI', quoteByCode),
      KOSDAQ: pickUniverseQuotes(universe, 'KOSDAQ', quoteByCode),
      ETF: pickQuotes(MARKETCAP_CODES.ETF, quoteByCode),
      INVERSE: pickQuotes(MARKETCAP_CODES.INVERSE, quoteByCode),
      LEV: [
        aggregateLeverage('삼성전자 단일종목레버리지(7종 합산)', MARKETCAP_CODES.LEV_SAMSUNG, quoteByCode),
        aggregateLeverage('SK하이닉스 단일종목레버리지(7종 합산)', MARKETCAP_CODES.LEV_HYNIX, quoteByCode)
      ].filter(Boolean)
    }
  };

  var ttl = isAnyTradingSessionOpen_() ? CACHE_TTL_OPEN : CACHE_TTL_CLOSED;
  cache.put(cacheKey, JSON.stringify(result), ttl);
  return result;
}

// 코드 목록 순서대로 조회 결과를 뽑는다(실패한 종목은 건너뛰어 나머지는 살린다).
function pickQuotes(codes, quoteByCode) {
  var out = [];
  codes.forEach(function (code) {
    var q = quoteByCode[code];
    if (q) out.push(q);
  });
  return out;
}

// fetchSectorUniverseWithSectors_() 결과 중 해당 market(KOSPI/KOSDAQ)만 골라
// 시세를 붙이고, 업종 필터용 sectors 배열을 그대로 실어 보낸다.
function pickUniverseQuotes(universe, market, quoteByCode) {
  var out = [];
  universe.forEach(function (u) {
    if (u.market !== market) return;
    var q = quoteByCode[u.code];
    if (!q) return;
    out.push({ code: u.code, name: q.name || u.name, cap: q.cap, changeRate: q.changeRate, sectors: u.sectors });
  });
  return out;
}

function aggregateLeverage(label, codes, quoteByCode) {
  var quotes = codes.map(function (c) { return quoteByCode[c]; }).filter(Boolean);
  if (!quotes.length) return null;

  var totalCap = quotes.reduce(function (s, q) { return s + q.cap; }, 0);
  var weightedChg = totalCap > 0
    ? quotes.reduce(function (s, q) { return s + q.changeRate * q.cap; }, 0) / totalCap
    : 0;

  return {
    name: label,
    cap: totalCap,
    changeRate: weightedChg,
    breakdown: quotes.map(function (q) { return q.name + ' ' + Math.round(q.cap / 1e8) + '억'; }).join(' · ')
  };
}

// 40개씩 배치로 나눠 SERVICE_ITEM 쿼리 호출, code -> {code,name,cap,changeRate} 맵으로 반환.
// 한 배치가 실패해도 나머지 배치는 살리도록 개별 try/catch.
function fetchQuotesWithCap(codes) {
  var out = {};
  for (var i = 0; i < codes.length; i += MARKETCAP_BATCH_SIZE) {
    var batch = codes.slice(i, i + MARKETCAP_BATCH_SIZE);
    try {
      var url = 'https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:' + batch.join(',');
      var res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.getResponseCode() !== 200) continue;

      var body = JSON.parse(res.getContentText('EUC-KR'));
      var areas = (body && body.result && body.result.areas) || [];
      var itemArea = null;
      for (var a = 0; a < areas.length; a++) {
        if (areas[a].name === 'SERVICE_ITEM') { itemArea = areas[a]; break; }
      }
      var datas = (itemArea && itemArea.datas) || [];

      datas.forEach(function (d) {
        var sign = (d.rf === '4' || d.rf === '5') ? -1 : 1;
        var shares = Number(d.countOfListedStock) || 0;
        var q = applyNxtOverride_(d, Number(d.nv) || 0, 0, Math.abs(Number(d.cr) || 0) * sign);
        out[d.cd] = {
          code: d.cd,
          name: d.nm,
          cap: q.price * shares,
          changeRate: q.changeRate
        };
      });
    } catch (err) {
      // 이 배치만 스킵 - 나머지 배치 결과는 유지
      continue;
    }
  }
  return out;
}

// 종목 뉴스: 네이버 모바일 증권 뉴스 API를 중계. 30분 캐싱 - "그때그때" 요구사항과
// GAS 호출 비용/네이버 부하를 절충한 값.
// 2026-07-06: AI 요약을 Groq로 교체하며 부활 - Gemini 무료 티어(하루 20건)로는 못 버텼지만
// Groq 무료 티어는 하루 14,400건/분당 30건이라 방문자 트래픽 + 30분 캐시로 충분히 감당됨.
// AI 요약 실패(null) 시엔 30분 캐시에 박제되지 않도록 120초만 캐싱(성공 시 30분).
var NEWS_CACHE_TTL = 1800;   // 30분
var NEWS_FAIL_TTL = 120;     // AI 요약 실패 시

function getStockNews(code, name) {
  if (!code) return { items: [] };

  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'news5_' + code;
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var items;
  try {
    items = fetchStockNews(code);
  } catch (err) {
    items = [];
  }

  var aiSummary = items.length ? safeCall(function () { return summarizeStockNews(name || code, items); }) : null;

  var result = { items: items, aiSummary: aiSummary };
  var ttl = (items.length && !aiSummary) ? NEWS_FAIL_TTL : NEWS_CACHE_TTL;
  cache.put(cacheKey, JSON.stringify(result), ttl);
  return result;
}

// 종목뉴스 AI 요약: 최근 뉴스 제목/스니펫을 묶어 Groq에 3문장 요약 요청.
// (톤은 사용자 요청대로 "투자자 참고 의견 포함" - 사실-only로 되돌리라는 요청 없는 한 유지)
function summarizeStockNews(name, items) {
  var lines = items.slice(0, 10).map(function (it, i) {
    return (i + 1) + '. ' + it.title + (it.body ? ' - ' + it.body : '');
  });
  var prompt = '다음은 "' + name + '" 종목 관련 최근 뉴스야:\n' + lines.join('\n') + '\n\n' +
    '이 뉴스들을 종합해서 단기 주가 흐름에 미칠 영향과 투자자 입장에서 참고할 만한 의견까지 포함해 3문장으로 한국어로 요약해줘. 문장 외 다른 말은 붙이지 마.';
  return callGroq(prompt);
}

// Groq API (OpenAI 호환). 키는 PropertiesService에 저장(코드에 노출 안 함):
// Apps Script 편집기 > 프로젝트 설정 > 스크립트 속성 > GROQ_API_KEY.
// 무료 티어: llama-3.3-70b-versatile 기준 분당 30건/하루 14,400건 - Gemini(하루 20건)와
// 비교가 안 되게 널널해서 종목뉴스 요약 + 시황분석을 둘 다 감당 가능.
var GROQ_MODEL = 'llama-3.3-70b-versatile';

// Groq chat completions 공용 호출. 429(레이트리밋)면 1.5초 쉬고 1번 더 시도
// (실패 캐시 TTL이 짧아서 그래도 안 되면 곧 자동 재시도됨 - Gemini 때와 동일 패턴).
function callGroq(prompt) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
  if (!apiKey) return null;

  var url = 'https://api.groq.com/openai/v1/chat/completions';
  var payload = JSON.stringify({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 1024
  });

  for (var attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) Utilities.sleep(1500);

    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: payload,
      muteHttpExceptions: true
    });

    if (res.getResponseCode() === 429) continue; // 재시도

    if (res.getResponseCode() !== 200) return null;

    var body = JSON.parse(res.getContentText('UTF-8'));
    var choice = body && body.choices && body.choices[0];
    var text = choice && choice.message && choice.message.content;
    return text ? text.trim() : null;
  }

  return null; // 재시도까지 다 429면 포기(짧은 캐시 TTL 덕에 곧 다시 시도됨)
}

// ---------------------------------------------------------------------------
// 종목 수급 요약판 AI 한 줄평 (?action=flowAiSummary)
// 수급/공매도/연기금/차트패턴 4개 점수는 이미 js/foreign-flow.js가 계산해서(각각
// getForeignFlow 응답, data/investor-flow-cache.js, ?patternScan=1 결과를 재료로) 쿼리
// 파라미터로 넘겨준다 - GAS가 점수 산출 로직을 중복 구현하지 않고 프롬프트 재료로만 쓴다.
// 같은 종목 반복 조회 시 Groq 재호출을 막기 위해 코드+당일 날짜로 캐싱.
// ---------------------------------------------------------------------------
var FLOW_AI_CACHE_TTL = 3 * 3600; // 3시간
var FLOW_AI_FAIL_TTL = 120;       // 2분

function getFlowAiSummary(params) {
  var code = (params.code || '').trim();
  if (!/^[0-9A-Za-z]{6}$/.test(code)) return { summary: null };

  var cache = CacheService.getScriptCache();
  var todayKey = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var cacheKey = CACHE_PREFIX + 'flow_ai_' + code + '_' + todayKey;
  var cached = cache.get(cacheKey);
  if (cached) return { summary: cached };

  var name = (params.name || code).trim();
  var lines = [
    '수급(외국인·기관 5일/20일 방향) 점수 ' + (params.flowScore || '-') + '점 - ' + (params.flowNote || '데이터 없음'),
    '외국인·기관 연속매매 점수 ' + (params.foreignInstScore || '-') + '점 - ' + (params.foreignInstNote || '데이터 없음'),
    '공매도 압박 점수 ' + (params.shortScore || '-') + '점 - ' + (params.shortNote || '데이터 없음'),
    '연기금 점수 ' + (params.pensionScore || '-') + '점 - ' + (params.pensionNote || '데이터 없음'),
    '기술적 점수(이평선·지지·저항) ' + (params.techScore || '-') + '점 - ' + (params.techNote || '데이터 없음'),
    '거래대금(20일 평균 대비) - ' + (params.volNote || '데이터 없음'),
    'RSI(14) - ' + (params.rsiNote || '데이터 없음')
  ];
  var verdictLabel = (params.verdictLabel || '').trim();
  var verdictScore = params.verdictScore || '';
  // 별점 판정(가중합)이 이미 확정한 결론을 AI가 다시 판단하지 않도록, 결론을 프롬프트에
  // 못박고 근거 문장만 요청한다 - 화면에서 별점 배지와 AI 한줄평이 서로 다른 의견을
  // 가리키는 모순을 막기 위함(2026-07 사용자 피드백). 거래대금/RSI는 verdict 점수 계산에는
  // 안 쓰고(가중치 공식은 그대로 5개 유지) 프롬프트의 참고 근거로만 추가한 것 - 근거 문장이
  // "외국인 5일 연속 순매수"처럼 구체적 수치를 인용하게 하려는 목적(2026-07-13 사용자 피드백).
  var prompt = verdictLabel
    ? '"' + name + '" 종목은 아래 7가지 수급/기술 지표를 가중합해 이미 "' + verdictLabel + '"(' + verdictScore + '점/100) 의견으로 결론이 났어:\n' + lines.join('\n') +
      '\n\n이 결론과 다른 의견을 새로 내지 말고, "' + verdictLabel + '" 같은 라벨 단어도 다시 쓰지 말고, ' +
      '위 지표 중 근거가 되는 구체적인 수치(예: "외국인 5일 연속 순매수", "거래대금 20일 평균 대비 4.3배")를 1~2개 인용해서 ' +
      '왜 이 결론인지 핵심 근거만 한국어 한 문장으로 요약해줘. 문장 외 다른 말은 붙이지 마.'
    : '"' + name + '" 종목의 오늘 7가지 수급/기술 지표야:\n' + lines.join('\n') +
      '\n\n이 지표들을 종합한 핵심 근거를 구체적인 수치를 인용해서 한국어 한 문장으로 요약해줘. 문장 외 다른 말은 붙이지 마.';

  var summary = safeCall(function () { return callGroq(prompt); });
  cache.put(cacheKey, summary || '', summary ? FLOW_AI_CACHE_TTL : FLOW_AI_FAIL_TTL);
  return { summary: summary };
}

// ---------------------------------------------------------------------------
// 수급 위젯용 가격 차트 (?action=flowChart&code=005930)
// 지지/저항(스윙 고점·저점) + 이동평균 5/20/60/224일선을 같이 계산해서 내려준다.
// 2026-07-13: 네이버 sise_day.naver 74페이지 크롤링(FLOW_CHART_PAGES) 대신 VM의 /ohlc
// (키움 ka10081)를 한 번만 호출하도록 교체 - 종목당 UrlFetchApp 74회 -> 1회로 감소.
// ka10081 한 번 호출로는 보통 600영업일 안팎(약 2.4년)까지만 나와서, 예전(740영업일) 대비
// 짧다 - 화면에는 여전히 최근 500일을 보여주지만, MA224(224일 이동평균)은 데이터가 있는
// 구간(대략 최근 376일)에서만 그려지고 그 이전 구간은 비어 보일 수 있음(다른 이평선/지지·
// 저항선/캔들은 영향 없음, 감수하기로 결정한 트레이드오프).
// findSwingIndices_/movingAverage_는 gas/ticker-proxy.gs 안의 패턴스캔 로직과 공용.
// ---------------------------------------------------------------------------
var FLOW_CHART_DISPLAY_DAYS = 500;  // 화면에 보여줄 최근 캔들 수 (KRX 연간 거래일수 기준 약 2년)
var FLOW_CHART_CACHE_TTL = 1800;    // 30분

function getFlowChart(code) {
  if (!/^[0-9A-Za-z]{6}$/i.test(code)) {
    return { error: 'INVALID_CODE', message: '6자리 종목코드가 필요합니다.' };
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'flow_chart_' + code;
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var daily = kiwoomVmFetch_('/ohlc/' + encodeURIComponent(code));
  if (!daily || daily.length < 30) {
    return { error: 'NO_DATA', message: '일봉 데이터를 가져오지 못했습니다.' };
  }

  var ma5 = movingAverage_(daily, 'close', 5);
  var ma20 = movingAverage_(daily, 'close', 20);
  var ma60 = movingAverage_(daily, 'close', 60);
  var ma224 = movingAverage_(daily, 'close', 224);
  var levels = computeSupportResistance_(daily);

  var start = Math.max(0, daily.length - FLOW_CHART_DISPLAY_DAYS);
  function tail(arr) { return arr.slice(start); }

  var result = {
    code: code.toUpperCase(),
    daily: tail(daily),
    ma: { ma5: tail(ma5), ma20: tail(ma20), ma60: tail(ma60), ma224: tail(ma224) },
    levels: levels
  };

  cache.put(cacheKey, JSON.stringify(result), FLOW_CHART_CACHE_TTL);
  return result;
}

// ---------------------------------------------------------------------------
// 홈 대시보드 대형차트용 지수 차트 (?action=indexChart&symbol=KOSPI). getFlowChart와
// 완전히 동일한 응답 포맷({daily, ma, levels})을 반환해서 프론트(js/home-dashboard.js)가
// 지수/종목 상관없이 같은 렌더 함수 하나로 그릴 수 있게 한다. 코스피/코스닥은 종목코드가
// 아니라 kiwoomVmFetch_('/ohlc/...')로는 조회 불가 - 대신 이미 있는 futures VM
// (js/kospi-futures.js/quick-indices.js가 브라우저에서 직접 쓰는 것과 동일한
// fetchFuturesFromVm_/FUTURES_API_URL)에서 일봉을 받아온다. movingAverage_/
// computeSupportResistance_는 getFlowChart와 완전히 공용.
// MA224 계산에 224영업일 이상 필요해서 fetchFuturesFromVm_에 넉넉히 800(캘린더일 기준,
// 주말/공휴일 감안) 요청 - VM/네이버 쪽이 실제로 이만큼 돌려주는지는 별도 실측 필요.
// ---------------------------------------------------------------------------
var INDEX_CHART_HISTORY_DAYS = 800;
var INDEX_CHART_CACHE_TTL = 1800; // 30분

function getIndexChart(symbol) {
  if (!symbol) return { error: 'INVALID_SYMBOL', message: '지수 심볼이 필요합니다.' };

  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'index_chart_' + symbol;
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var bySymbol = safeCall(function () { return fetchFuturesFromVm_(INDEX_CHART_HISTORY_DAYS); });
  var item = bySymbol && bySymbol[symbol];
  var daily = item && item.chart;
  if (!daily || daily.length < 30) {
    return { error: 'NO_DATA', message: '일봉 데이터를 가져오지 못했습니다.' };
  }

  var ma5 = movingAverage_(daily, 'close', 5);
  var ma20 = movingAverage_(daily, 'close', 20);
  var ma60 = movingAverage_(daily, 'close', 60);
  var ma224 = movingAverage_(daily, 'close', 224);
  var levels = computeSupportResistance_(daily);

  var start = Math.max(0, daily.length - FLOW_CHART_DISPLAY_DAYS);
  function tail(arr) { return arr.slice(start); }

  var result = {
    symbol: symbol,
    daily: tail(daily),
    ma: { ma5: tail(ma5), ma20: tail(ma20), ma60: tail(ma60), ma224: tail(ma224) },
    levels: levels
  };

  cache.put(cacheKey, JSON.stringify(result), INDEX_CHART_CACHE_TTL);
  return result;
}

// 최근 120영업일 스윙 고점/저점(findSwingIndices_ 재사용) 중 현재가 기준 위/아래로
// 가장 가까운 2개씩을 저항/지지로 채택. 1% 이내로 겹치는 레벨은 dedupeLevels_로 하나로 합친다.
function computeSupportResistance_(daily) {
  var win = daily.slice(Math.max(0, daily.length - 120));
  var lowIdx = findSwingIndices_(win, 'low', true);
  var highIdx = findSwingIndices_(win, 'high', false);
  var lastClose = daily[daily.length - 1].close;

  var lowLevels = dedupeLevels_(lowIdx.map(function (i) { return win[i].low; }));
  var highLevels = dedupeLevels_(highIdx.map(function (i) { return win[i].high; }));

  var support = lowLevels.filter(function (v) { return v < lastClose; })
    .sort(function (a, b) { return b - a; }).slice(0, 2);
  var resistance = highLevels.filter(function (v) { return v > lastClose; })
    .sort(function (a, b) { return a - b; }).slice(0, 2);

  // 스윙 조건을 만족하는 레벨이 하나도 없을 때(가격이 구간 최저/최고 부근일 때) 지지/저항선이
  // 아예 안 보이는 문제가 있었음 - 구간 전체 최저/최고가로 대체해 항상 하나는 표시되게 한다.
  if (!support.length) {
    var minLow = Math.min.apply(null, win.map(function (w) { return w.low; }));
    if (minLow < lastClose) support = [minLow];
  }
  if (!resistance.length) {
    var maxHigh = Math.max.apply(null, win.map(function (w) { return w.high; }));
    if (maxHigh > lastClose) resistance = [maxHigh];
  }

  return { support: support, resistance: resistance };
}

function dedupeLevels_(levels) {
  var sorted = levels.slice().sort(function (a, b) { return a - b; });
  var out = [];
  sorted.forEach(function (v) {
    var last = out[out.length - 1];
    if (last != null && Math.abs(v - last) / last < 0.01) return; // 1% 이내는 같은 레벨로 취급
    out.push(v);
  });
  return out;
}

// 오늘의 증시 온도 페이지용 코스피/코스닥 AI 시황 분석.
// 2026-07-06: Groq 교체로 한도 여유가 생겨 캐시를 2시간 -> 30분으로 되돌림(더 신선한 분석).
var MARKET_ANALYSIS_CACHE_TTL = 1800;      // 30분
var MARKET_ANALYSIS_FAIL_TTL = 120;        // 2분

function getMarketAnalysis() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'market_analysis_v2';
  var cached = cache.get(cacheKey);
  if (cached) return { analysis: cached };

  var kospi = safeCall(function () { return fetchIndex('KOSPI', '코스피'); });
  var kosdaq = safeCall(function () { return fetchIndex('KOSDAQ', '코스닥'); });
  if (!kospi && !kosdaq) return { analysis: null };

  var lines = [];
  if (kospi) lines.push('코스피 ' + fmtCommaNum_(kospi.price) + ' (' + (kospi.changeRate >= 0 ? '+' : '') + kospi.changeRate.toFixed(2) + '%)');
  if (kosdaq) lines.push('코스닥 ' + fmtCommaNum_(kosdaq.price) + ' (' + (kosdaq.changeRate >= 0 ? '+' : '') + kosdaq.changeRate.toFixed(2) + '%)');

  var prompt = '오늘 국내 증시 상황이야: ' + lines.join(', ') + '. ' +
    '증시/투자자 관점에서 오늘 시장 분위기를 분석하고, 투자자 입장에서 참고할 만한 의견까지 포함해서 3문장으로 한국어로 정리해줘.';

  var analysis = safeCall(function () { return callGroq(prompt); });
  cache.put(cacheKey, analysis || '', analysis ? MARKET_ANALYSIS_CACHE_TTL : MARKET_ANALYSIS_FAIL_TTL);
  return { analysis: analysis };
}

// ---------------------------------------------------------------------------
// "코스피 선물" 페이지 및 "보조지수" 페이지 AI 해설 - VM(scripts/cloud-vm, /futures)이
// 상시 수집해둔 실시간 숫자를 그대로 프롬프트에 넣어 getMarketAnalysis와 동일한 패턴으로
// Groq 해설을 생성한다. 화면에 보이는 숫자와 AI 문장이 어긋나면 안 되므로(과거 코스피 100배
// 버그로 AI가 엉뚱한 숫자를 지어낸 전례 있음, 219~221줄 주석 참고) 반드시 이 VM 응답을
// 유일한 소스로 삼는다 - GAS 자체 fetchIndex 등으로 별도 재조회하지 않는다.
var FUTURES_API_URL = 'https://goodbyestar.cloud/futures';
var KOSPI_FUTURES_ANALYSIS_CACHE_TTL = 1800; // 30분
var KOSPI_FUTURES_ANALYSIS_FAIL_TTL = 120;   // 2분
var SUB_INDEX_ANALYSIS_CACHE_TTL = 1800;
var SUB_INDEX_ANALYSIS_FAIL_TTL = 120;

function fetchFuturesFromVm_(days) {
  var url = FUTURES_API_URL + (days ? '?interval=day&days=' + days : '');
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var body = JSON.parse(res.getContentText('UTF-8'));
  var list = body && body.data;
  if (!list) return null;
  var bySymbol = {};
  list.forEach(function (item) { bySymbol[item.symbol] = item; });
  return bySymbol;
}

// AI 프롬프트에 넣는 숫자는 AI가 그대로 베껴 쓰는 경향이 있어(예: "26107.01"), 여기서부터
// 천단위 콤마를 찍어줘야 화면에 나오는 문장도 콤마가 붙는다 - 사이트 공통 규칙(전체 페이지의
// 숫자 표기는 콤마 포함)을 AI 요약 텍스트에도 동일하게 적용.
function fmtCommaNum_(n) {
  if (typeof n !== 'number' || isNaN(n)) return String(n);
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function futuresLine_(item, label) {
  if (!item || typeof item.price !== 'number') return null;
  return label + ' ' + fmtCommaNum_(item.price) + ' (' + (item.change_rate >= 0 ? '+' : '') + item.change_rate.toFixed(2) + '%)';
}

function getKospiFuturesAnalysis() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'kospi_futures_analysis_v2';
  var cached = cache.get(cacheKey);
  if (cached) return { analysis: cached };

  var futures = safeCall(fetchFuturesFromVm_);
  var lines = [];
  if (futures) {
    [futuresLine_(futures.KOSPI200_DAY, '코스피200 주간선물'),
      futuresLine_(futures.KOSPI200_NIGHT, '코스피200 야간선물')].forEach(function (line) {
      if (line) lines.push(line);
    });
  }
  if (!lines.length) return { analysis: null };

  var prompt = '오늘/간밤 코스피 선물 지표야: ' + lines.join(', ') + '. ' +
    '코스피200 선물(주간·야간)과 코스피 현물지수의 관계를 설명하고, 특히 야간선물 동향이 ' +
    '다음 거래일 한국 증시 개장에 어떤 영향을 줄 수 있는지 투자자 관점에서 4문장으로 ' +
    '한국어로 정리해줘. 문장 외 다른 말은 붙이지 마.';

  var analysis = safeCall(function () { return callGroq(prompt); });
  cache.put(cacheKey, analysis || '', analysis ? KOSPI_FUTURES_ANALYSIS_CACHE_TTL : KOSPI_FUTURES_ANALYSIS_FAIL_TTL);
  return { analysis: analysis };
}

// 2026-07-16: "요약이 너무 빈약하다"는 피드백으로 4문장 단일 블록 대신 (1)미국 3대 지수
// (2)원자재·환율·BTC (3)한국 증시 시사점 세 그룹으로 나눠 6~8문장으로 늘렸는데, 이번엔
// "너무 길다"는 반대 피드백이 와서 4~5문장으로 다시 줄였다(2차). 대신 정보 밀도를 위해
// (a) 등락률 숫자를 문장에 직접 쓰라고 명시하고, (b) VIX/WTI/환율은 "오르면 호재"가 아니라
// 각각 위험회피심리·인플레이션우려·원화약세로 통상 악재라는 해석 원칙을 프롬프트에 박아서
// AI가 숫자만 보고 "다 올랐으니 좋다"는 식으로 뭉뚱그리지 않게 했다. 프론트(overnight-market.js
// renderAiSummary)는 결과를 <p> 하나에 그대로 넣으므로 소제목/줄바꿈 서식은 요청하지 않는다.
function getSubIndexAnalysis() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'sub_index_analysis_v4';
  var cached = cache.get(cacheKey);
  if (cached) return { analysis: cached };

  var futures = safeCall(fetchFuturesFromVm_);
  var usIndexLines = [], commodityFxLines = [];
  if (futures) {
    [
      ['NASDAQ_INDEX', '나스닥종합지수'], ['SP500_INDEX', 'S&P500지수'], ['DOW_INDEX', '다우존스지수'],
      ['NASDAQ100', '나스닥100 선물'], ['SP500', 'S&P500 선물'], ['DOW', '다우 선물'],
      ['SOX', '필라델피아 반도체지수']
    ].forEach(function (pair) {
      var line = futuresLine_(futures[pair[0]], pair[1]);
      if (line) usIndexLines.push(line);
    });
    [
      ['VIX', 'VIX(변동성지수)'], ['WTI', 'WTI 원유'], ['USDKRW', '원/달러 환율']
    ].forEach(function (pair) {
      var line = futuresLine_(futures[pair[0]], pair[1]);
      if (line) commodityFxLines.push(line);
    });
  }
  // BTC는 VM이 아니라 GAS 자체 fetchCrypto()(빗썸->코인게코 폴백, getMarketRibbon과 동일 소스)로
  // 가져온다 - VM은 시세 이력이 없는 지표(BTC)를 다루지 않는 정책(js/quick-indices.js 주석 참고).
  var btc = safeCall(fetchCrypto);
  if (btc && typeof btc.price === 'number') {
    commodityFxLines.push('BTC ' + btc.price + ' (' + (btc.changeRate >= 0 ? '+' : '') + btc.changeRate.toFixed(2) + '%)');
  }
  if (!usIndexLines.length && !commodityFxLines.length) return { analysis: null };

  var prompt = '오늘 보조지수 데이터야.\n'
    + '① 미국 3대 지수(현물+선물)/반도체지수: ' + (usIndexLines.join(', ') || '데이터 없음') + '\n'
    + '② 원자재·환율·비트코인: ' + (commodityFxLines.join(', ') || '데이터 없음') + '\n'
    + '해석 원칙(중요, 반드시 반영): 미국 지수·반도체지수·BTC는 상승=호재/하락=악재로 보고, '
    + '반대로 VIX(변동성지수)는 오를수록 위험회피 심리가 커지는 악재, WTI 원유는 오르면 '
    + '인플레이션·비용 부담 우려로 악재, 원/달러 환율은 오르면(원화 약세) 외국인 자금 이탈 '
    + '우려로 악재야 - 이 셋은 숫자가 올랐다고 무조건 좋게 쓰지 마.\n'
    + '위 원칙을 반영해서 아래 내용을 한국어 평문 4~5문장으로(소제목·번호·줄바꿈 없이) 정리해줘: '
    + '①번 미국 지수·반도체 동향을 등락률 숫자를 직접 인용해 1~2문장, ②번 원자재·환율·VIX·BTC '
    + '동향을 등락률 숫자를 직접 인용하고 해석 원칙에 맞게 1~2문장, 마지막으로 이를 종합했을 때 '
    + '오늘 한국 증시(코스피/코스닥)에 미칠 영향을 1문장으로. 문장 외 다른 말은 붙이지 마.';

  var analysis = safeCall(function () { return callGroq(prompt); });
  cache.put(cacheKey, analysis || '', analysis ? SUB_INDEX_ANALYSIS_CACHE_TTL : SUB_INDEX_ANALYSIS_FAIL_TTL);
  return { analysis: analysis };
}

// ---------------------------------------------------------------------------
// 오늘의 증시온도: 사용자 지정 스펙(2026-07-14) 기준 9개 지표.
// 코스피·코스닥 지수(시가총액 가중) 대신 섹터 대시보드 종목 풀(fetchSectorUniverse_,
// data/sectors-v3.js)을 동일가중(Equal Weight)으로 써서 삼성전자·SK하이닉스 등 초대형주
// 몇 개가 지수를 방어/왜곡하는 효과를 줄인다. 스펙 문서는 "268개 핵심 종목"이라고 되어
// 있지만 실제 풀은 238개라 코드는 그 실제 값을 그대로 쓴다(238 하드코딩 아님 - 풀이 늘면
// 자동 반영).
// 배점(문서 그대로): VIX20 + 수급(외국인75%+기관25% 통합)20 + 거래대금15 + 평균등락률15 +
// 상승비율10 + 섹터강도10 + 52주신고저10 + 환율5 + 미국선물5 = 110점. 문서에는 "총점 100점"
// 이라 적혀 있지만 항목을 다 더하면 110이라(사용자에게 확인 후 결정) 온도 환산식을
// "총점 x (40/실제만점)"으로 자기보정하게 만들어서, 만점이 100이든 110이든 105든 항상
// 만점=40.0℃가 되도록 했다 - 나중에 배점을 또 조정해도 이 식은 안 깨짐.
// 52주 신고가/신저가는 종목당 네이버 페이지 크롤링이 1건씩 필요해(배치 API 없음) GAS에서
// 라이브로 238번 돌리면 이 세션 초반에 겪은 UrlFetchApp 할당량 문제를 다시 유발할 위험이
// 있어, VM이 하루 1회 미리 계산해둔 캐시(week52_scan.py, /week52-batch)를 읽기만 한다.
// 점수 구간(각 지표 밴드 경계값)은 지시서에 정확한 공식이 없는 부분(평균등락률/상승비율/
// 섹터강도/52주신고저)은 이 구현에서 정한 값 - 배포 후 점수 분포를 보고 조정 가능.
// ---------------------------------------------------------------------------
var MARKET_TEMP_CACHE_TTL = 1800;   // 30분
var VIX_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX';
var US_FUTURES_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/ES=F'; // S&P500 E-mini 선물
var MT_FLOW_CODE = '069500'; // KODEX 200 - 코스피200 추종 ETF, 수급 대리지표
var MT_VOL_HISTORY_KEY = 'mt_vol_hist_v2'; // v1(10일 기록)->v2(5일 평균 기준으로 명확화) 캐시 키 분리
var MT_VOL_HISTORY_MAX = 6; // 오늘 포함 6개 = "오늘 제외 직전 5거래일 평균"의 기준
var MT_DAILY_HISTORY_KEY = 'mt_daily_history_v1'; // 전일 대비/1주일·1개월 평균용 일별 온도 기록
var MT_DAILY_HISTORY_MAX = 35; // 1개월(30일) 평균 계산 + 여유분
var MT_COMPONENT_MAX = { // 지표별 배점(문서 그대로) - 합계가 온도 환산의 실제 만점 기준이 됨
  vix: 20, flow: 20, tradingValue: 15, avgChange: 15,
  riseRatio: 10, sectorStrength: 10, week52: 10, exchange: 5, usFutures: 5
};

function getMarketTemp() {
  var cache = CacheService.getScriptCache();
  // v2->v3: 배점 개편(수급 통합, 평균등락률/섹터강도/52주신고저 추가). v3->v4(2026-07-18):
  // 응답에 recentDays/band 필드 추가 - 재배포해도 CacheService는 자동으로 안 비워지므로
  // (실측: 재배포 후에도 30분간 옛 스키마가 그대로 응답됨) 스키마 바뀔 때마다 캐시 키도
  // 같이 올려야 함(이 프로젝트 반복 관례, news_ 캐시 키 이력 참고).
  var cacheKey = CACHE_PREFIX + 'market_temp_v4';
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var universe = fetchSectorUniverse_();
  var codes = universe.map(function (u) { return u.code; });
  var quotes = codes.length ? (safeCall(function () { return fetchFromNaver(codes); }) || []) : [];

  var vix = scoreVix_(safeCall(fetchVix_));
  var flow = computeCombinedFlowScore_();
  var vol = computeVolumeScore_(quotes);
  var avgChange = computeAvgChangeScore_(quotes);
  var rise = computeRiseRatioScore_(quotes);
  var sectorStrength = computeSectorStrengthScore_(quotes);
  var week52 = computeWeek52Score_();
  var fx = computeExchangeScore_();
  var futures = computeUsFuturesScore_();

  var maxPossible = 0;
  Object.keys(MT_COMPONENT_MAX).forEach(function (k) { maxPossible += MT_COMPONENT_MAX[k]; });

  var total = Math.max(0, Math.min(maxPossible,
    vix.score + flow.score + vol.score + avgChange.score + rise.score
    + sectorStrength.score + week52.score + fx.score + futures.score));
  var temp = Math.round(total * (40 / maxPossible) * 10) / 10; // 만점(maxPossible) -> 40.0℃로 항상 정규화

  var result = {
    score: total,
    maxScore: maxPossible,
    temp: temp,
    grade: gradeForTemp_(temp),
    components: {
      vix: vix, flow: flow, tradingValue: vol, avgChange: avgChange,
      riseRatio: rise, sectorStrength: sectorStrength, week52: week52,
      exchange: fx, usFutures: futures
    },
    history: computeMarketTempHistory_(temp),
    recentDays: computeMarketTempSparkline_(temp),
    updatedAt: formatKstTime(Date.now())
  };

  cache.put(cacheKey, JSON.stringify(result), MARKET_TEMP_CACHE_TTL);
  return result;
}

// 장마감 후 하루 1회(setupMarketTempTrigger_로 등록한 트리거) 오늘의 온도를 PropertiesService에
// 날짜별로 누적 - "전일 대비/1주일 평균/1개월 평균" 계산의 재료. 같은 날 재실행되면 최신값으로 덮어씀.
function logDailyMarketTemp_() {
  var data = getMarketTemp();
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(MT_DAILY_HISTORY_KEY);
  var hist = raw ? JSON.parse(raw) : [];

  if (hist.length && hist[hist.length - 1].date === today) {
    hist[hist.length - 1].temp = data.temp;
  } else {
    hist.push({ date: today, temp: data.temp });
  }
  if (hist.length > MT_DAILY_HISTORY_MAX) hist = hist.slice(hist.length - MT_DAILY_HISTORY_MAX);
  props.setProperty(MT_DAILY_HISTORY_KEY, JSON.stringify(hist));
}

// 스크립트 편집기에서 이 함수를 딱 한 번 수동 실행하면(또는 배포 후 1회) 매일 15:40 KST(장마감 직후)
// logDailyMarketTemp_를 도는 트리거가 등록된다. 재실행해도 중복 트리거는 정리하고 하나만 유지.
function setupMarketTempTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'logDailyMarketTemp_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('logDailyMarketTemp_')
    .timeBased()
    .atHour(15)
    .nearMinute(40)
    .everyDays(1)
    .inTimezone('Asia/Seoul')
    .create();
}

// 오늘 이전(오늘 값은 아직 형성 중이라 제외)의 일별 기록으로 전일 대비/1주일·1개월 평균을 계산.
// 기록이 하나도 없으면(트리거 등록 직후 며칠) null을 반환 - 프론트에서 "데이터 수집 중" 처리.
function computeMarketTempHistory_(currentTemp) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(MT_DAILY_HISTORY_KEY);
  var hist = raw ? JSON.parse(raw) : [];
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var priorDays = hist.filter(function (h) { return h.date !== today; });
  if (!priorDays.length) return null;

  var yesterday = priorDays[priorDays.length - 1];
  var week = priorDays.slice(-7);
  var month = priorDays.slice(-30);
  function avg(arr) { return arr.reduce(function (s, e) { return s + e.temp; }, 0) / arr.length; }

  return {
    dayChange: Math.round((currentTemp - yesterday.temp) * 10) / 10,
    yesterday: yesterday.temp,
    weekAvg: Math.round(avg(week) * 10) / 10,
    weekDays: week.length,
    monthAvg: Math.round(avg(month) * 10) / 10,
    monthDays: month.length
  };
}

// 2026-07-18: "최근 7일 증시온도" 스파크라인용 - computeMarketTempHistory_와 같은 일별
// 기록(MT_DAILY_HISTORY_KEY)을 읽어 최근 6일(오늘 이전) + 오늘(currentTemp)을 이어붙여
// 최대 7포인트를 반환한다. 기록이 없으면(트리거 등록 초기) 오늘 1포인트만 반환 - 프론트는
// 2포인트 미만이면 "수집 중" 처리(history가 null일 때와 동일한 패턴).
function computeMarketTempSparkline_(currentTemp) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(MT_DAILY_HISTORY_KEY);
  var hist = raw ? JSON.parse(raw) : [];
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  var priorDays = hist.filter(function (h) { return h.date !== today; }).slice(-6);
  return priorDays.concat([{ date: today, temp: currentTemp }]);
}

// 2026-07-18: "AI 시장 브리핑" - 오늘 온도에 가장 큰 영향을 준 TOP5 요인(기여도 = 점수 -
// 만점/2, 양수=탐욕 방향/음수=공포 방향 - 프론트 js/market-temp.js와 동일한 계산식)을
// 프롬프트에 정확한 수치로 명시해 AI가 숫자를 지어내지 않게 한다(코스피 100배 버그 전례 -
// VM 응답을 유일한 소스로 삼는 기존 원칙과 동일하게 여기선 이 TOP5 계산 결과를 유일한
// 소스로 프롬프트에 박음). getMarketTemp()와 같은 30분 캐시 주기.
function getMarketTempBriefing() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'market_temp_briefing_v1';
  var cached = cache.get(cacheKey);
  if (cached) return { analysis: cached };

  var data = safeCall(getMarketTemp);
  if (!data) return { analysis: null };

  var LABELS = {
    vix: 'VIX', flow: '수급(외국인+기관)', tradingValue: '거래대금', avgChange: '평균등락률',
    riseRatio: '상승비율', sectorStrength: '섹터강도', week52: '52주 신고가/신저가',
    exchange: '환율', usFutures: '미국 선물지수'
  };
  var contributions = Object.keys(MT_COMPONENT_MAX).map(function (key) {
    var comp = data.components[key];
    var score = comp && typeof comp.score === 'number' ? comp.score : MT_COMPONENT_MAX[key] / 2;
    return { label: LABELS[key], contribution: score - MT_COMPONENT_MAX[key] / 2 };
  }).sort(function (a, b) { return Math.abs(b.contribution) - Math.abs(a.contribution); }).slice(0, 5);

  var lines = contributions.map(function (c) {
    return c.label + ' ' + (c.contribution >= 0 ? '+' : '') + c.contribution.toFixed(1) + '점';
  });

  var prompt = '오늘 국내 증시 "온도"는 ' + data.temp.toFixed(1) + '℃(' + data.grade.label + ') 입니다' +
    '(0~40 스케일, 낮을수록 공포·높을수록 탐욕). 오늘 온도에 가장 큰 영향을 준 요인 TOP5' +
    '(점수는 중립 대비 기여도, 양수=탐욕 방향/음수=공포 방향)는 다음과 같습니다: ' + lines.join(', ') + '. ' +
    '이 수치만 근거로, 왜 오늘 시장이 이런 상태인지 한국어 평문 3~5문장으로 설명해줘(제공되지 않은 ' +
    '다른 수치나 종목명을 지어내지 말고, 위 수치만 언급). 문장 외 다른 말은 붙이지 마.';

  var analysis = safeCall(function () { return callGroq(prompt); });
  cache.put(cacheKey, analysis || '', analysis ? MARKET_TEMP_CACHE_TTL : 120);
  return { analysis: analysis };
}

function fetchVix_() {
  var res = UrlFetchApp.fetch(VIX_URL, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (res.getResponseCode() !== 200) return null;
  var body = JSON.parse(res.getContentText('UTF-8'));
  var meta = body && body.chart && body.chart.result && body.chart.result[0] && body.chart.result[0].meta;
  return (meta && typeof meta.regularMarketPrice === 'number') ? meta.regularMarketPrice : null;
}

// VIX는 낮을수록 안정(고득점) - 구간 경계는 일반적인 VIX 해석(15/20/25/30) 기준. 최대 20점.
// band: 프론트 "계산식 투명성" 툴팁용(2026-07-18 추가) - 점수 산정에 쓰인 구간 문자열.
function scoreVix_(vix) {
  if (vix == null) return { score: 10, value: null, note: 'VIX 조회 실패 - 중립 처리', band: '조회 실패' };
  var score = vix < 15 ? 20 : vix < 20 ? 16 : vix < 25 ? 10 : vix < 30 ? 5 : 0;
  var band = vix < 15 ? '15 미만' : vix < 20 ? '15~20' : vix < 25 ? '20~25' : vix < 30 ? '25~30' : '30 이상';
  return { score: score, value: vix, band: band };
}

// KODEX 200 외국인/기관 5일 합산 순매매를, 그 종목 자신의 최근 20일 평균 일별 순매매
// 절대값 x5(=5일 기준선) 대비 비율(-1~1)로 환산 - 외국인/기관 공통으로 재사용.
function computeFlowRatio_(field) {
  var flow = safeCall(function () { return getForeignFlow(MT_FLOW_CODE); });
  if (!flow || flow.error) return null;

  var daily = flow.daily;
  var v5 = flow.rolling['5d'][field];

  var n = Math.min(20, daily.length);
  var avgDaily = 0;
  for (var i = 0; i < n; i++) avgDaily += Math.abs(daily[i][field + '_net']);
  avgDaily = n ? avgDaily / n : 0;

  var baseline = avgDaily * 5;
  var ratio = baseline > 0 ? Math.max(-1, Math.min(1, v5 / baseline)) : 0;
  return { ratio: ratio, v5: v5 };
}

function flowRatioToScore100_(ratio) {
  return Math.max(0, Math.min(100, Math.round(50 + ratio * 50)));
}

// 수급(20점) = 외국인 75% + 기관 25% (사용자 지정 가중치 - 외국인 수급이 시장 영향력이
// 더 크다고 보고 비중을 더 줌). 외국인/기관 각각 0~100점으로 정규화한 뒤 가중합산하고,
// 그 결과를 다시 20점 만점으로 환산. 개별 외국인/기관 수치는 참고용으로 같이 반환한다.
function computeCombinedFlowScore_() {
  var foreignR = computeFlowRatio_('foreign');
  var instR = computeFlowRatio_('inst');
  var foreignScore100 = foreignR ? flowRatioToScore100_(foreignR.ratio) : 50;
  var instScore100 = instR ? flowRatioToScore100_(instR.ratio) : 50;
  var combined100 = foreignScore100 * 0.75 + instScore100 * 0.25;
  var score = Math.max(0, Math.min(20, Math.round(combined100 / 100 * 20)));

  return {
    score: score,
    foreign: { score100: foreignScore100, ratio: foreignR ? foreignR.ratio : null, v5: foreignR ? foreignR.v5 : null },
    inst: { score100: instScore100, ratio: instR ? instR.ratio : null, v5: instR ? instR.v5 : null },
    note: 'KODEX 200(069500) 5일 합산 수급 기준, 외국인75%+기관25% 가중합산',
    band: '가중 순매수강도 ' + Math.round(combined100) + '%(중립50%)'
  };
}

// 섹터 풀 종목 중 상승/하락 종목 수 비율(코스피+코스닥 통합). 보합(변동 0)은 분모에서 제외.
// 최대 10점.
function computeRiseRatioScore_(quotes) {
  var up = 0, down = 0;
  quotes.forEach(function (q) {
    if (q.change > 0) up++;
    else if (q.change < 0) down++;
  });
  var total = up + down;
  var ratio = total ? up / total : 0.5;
  var score = ratio >= 0.7 ? 10 : ratio >= 0.55 ? 8 : ratio >= 0.45 ? 5 : ratio >= 0.3 ? 3 : 0;
  var band = ratio >= 0.7 ? '70% 이상' : ratio >= 0.55 ? '55~70%' : ratio >= 0.45 ? '45~55%' : ratio >= 0.3 ? '30~45%' : '30% 미만';
  return { score: score, ratio: ratio, up: up, down: down, total: total, band: band };
}

// 섹터 풀 종목의 등락률을 동일가중(Equal Weight, 시가총액 가중 아님) 평균 - 최대 15점.
// 삼성전자 등 일부 대형주만 오르고 나머지가 빠지는 상황을 지수보다 더 잘 잡아낸다.
function computeAvgChangeScore_(quotes) {
  if (!quotes.length) return { score: 7.5, note: '데이터 없음 - 중립 처리' };
  var sum = 0;
  quotes.forEach(function (q) { sum += (q.changeRate || 0); });
  var avg = sum / quotes.length;
  var score = avg >= 2 ? 15 : avg >= 1 ? 12 : avg >= 0 ? 8 : avg >= -1 ? 4 : 0;
  var band = avg >= 2 ? '+2% 이상' : avg >= 1 ? '+1~2%' : avg >= 0 ? '0~+1%' : avg >= -1 ? '-1~0%' : '-1% 미만';
  return { score: score, avgChangeRate: avg, band: band };
}

// 섹터 강도(10점) - 각 섹터(data/sectors-v3.js의 업종 분류)의 평균등락률·상승비율을 종합.
// 평균등락률>0, 상승비율>=50% 두 조건 각각 만족할 때마다 "강세 포인트" 1개씩 부여하고
// (섹터당 최대 2개), 전체 섹터 대비 강세 포인트 비율을 10점 만점으로 환산.
// 지시서의 3요소(평균등락률/상승비율/거래대금 증가율) 중 거래대금 증가율은 섹터별 과거
// 거래대금 이력이 없어 이번 구현에서는 제외(2요소만 반영) - 필요하면 추후 보강 가능.
function computeSectorStrengthScore_(quotes) {
  var universeWithSectors = safeCall(fetchSectorUniverseWithSectors_) || [];
  if (!universeWithSectors.length) return { score: 5, note: '섹터 데이터 조회 실패 - 중립 처리' };

  var quoteByCode = {};
  quotes.forEach(function (q) { quoteByCode[q.code] = q; });

  var bySector = {};
  universeWithSectors.forEach(function (u) {
    var q = quoteByCode[u.code];
    if (!q) return;
    (u.sectors || []).forEach(function (s) {
      if (!bySector[s]) bySector[s] = { up: 0, down: 0, sumChange: 0, total: 0 };
      var b = bySector[s];
      b.total++;
      b.sumChange += (q.changeRate || 0);
      if (q.change > 0) b.up++;
      else if (q.change < 0) b.down++;
    });
  });

  var sectorNames = Object.keys(bySector);
  if (!sectorNames.length) return { score: 5, note: '섹터 데이터 조회 실패 - 중립 처리' };

  var strongCount = 0;
  sectorNames.forEach(function (s) {
    var b = bySector[s];
    var avgChange = b.total ? b.sumChange / b.total : 0;
    var riseRatio = b.total ? b.up / b.total : 0;
    if (avgChange > 0) strongCount++;
    if (riseRatio >= 0.5) strongCount++;
  });

  var score = Math.max(0, Math.min(10, Math.round(strongCount / (sectorNames.length * 2) * 10)));
  return {
    score: score, sectorCount: sectorNames.length, strongCount: strongCount,
    band: '강세포인트 ' + strongCount + '/' + (sectorNames.length * 2)
  };
}

// 52주 신고가/신저가(10점) - VM(week52_scan.py)이 섹터 풀 대상 하루 1회 미리 계산해둔
// 캐시를 읽기만 한다(GAS 라이브 호출 없음 - 네이버 종목당 1페이지 크롤링이라 무거움).
// 신고가-신저가 개수 차이를 5점(중립) 기준 ±로 환산 - 배점 경계는 지시서에 없어 임의 설정.
function computeWeek52Score_() {
  var w = safeCall(function () { return kiwoomVmFetch_('/week52-batch'); });
  if (!w || typeof w.newHighCount !== 'number') {
    return { score: 5, note: '52주 신고가/신저가 데이터 조회 실패(VM 배치 대기 중일 수 있음) - 중립 처리' };
  }
  var diff = w.newHighCount - w.newLowCount;
  var score = Math.max(0, Math.min(10, Math.round(5 + diff * 0.3)));
  return {
    score: score, newHigh: w.newHighCount, newLow: w.newLowCount, scanned: w.scanned,
    band: '신고가-신저가 차이 ' + (diff > 0 ? '+' : '') + diff
  };
}

// 섹터 풀 종목의 가격x거래량 합산(대금 근사치)을 PropertiesService에 최근 5거래일(오늘 제외)
// 평균으로 저장해두고, 오늘 값을 그 평균과 비교해 상대적으로 점수화(최대 15점).
// (시장 전체 거래대금의 절대 원화 기준값은 국내에 무료로 공개된 소스가 없어 확보 불가 -
// "무조건 몇 조원 이상이면 좋다"는 절대치 대신, 자기 자신의 최근 5일 평균 대비 상대치로 판단)
function computeVolumeScore_(quotes) {
  var today = 0;
  quotes.forEach(function (q) { today += (q.price || 0) * (q.volume || 0); });

  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(MT_VOL_HISTORY_KEY);
  var hist = raw ? JSON.parse(raw) : [];
  var todayDate = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');

  if (!hist.length || hist[hist.length - 1].date !== todayDate) {
    hist.push({ date: todayDate, total: today });
    if (hist.length > MT_VOL_HISTORY_MAX) hist.shift();
  } else {
    hist[hist.length - 1].total = today; // 같은 날 재조회 시 최신값으로 갱신
  }
  props.setProperty(MT_VOL_HISTORY_KEY, JSON.stringify(hist));

  var priorEntries = hist.slice(0, -1); // 오늘 제외 직전 최대 5거래일
  if (priorEntries.length < 3) {
    return { score: 7.5, today: today, note: '5일 평균 기준 데이터 누적 중(3영업일 미만) - 중립 처리' };
  }

  var avg5 = priorEntries.reduce(function (s, e) { return s + e.total; }, 0) / priorEntries.length;
  var relative = avg5 > 0 ? today / avg5 : 1;
  var score = relative >= 1.3 ? 15 : relative >= 1.1 ? 11 : relative >= 0.9 ? 7 : relative >= 0.7 ? 4 : 0;
  var band = relative >= 1.3 ? '평균대비 130% 이상' : relative >= 1.1 ? '평균대비 110~130%'
    : relative >= 0.9 ? '평균대비 90~110%' : relative >= 0.7 ? '평균대비 70~90%' : '평균대비 70% 미만';

  return { score: score, today: today, avg5: avg5, relative: relative, band: band };
}

// 원/달러 환율 - 전일대비 등락률로 점수화(원화 약세=환율 상승은 통상 외국인 이탈/악재로
// 취급, 원화 강세=환율 하락은 호재). 절대 레벨(예: 1,300원이 적정인지)은 시대별로 계속
// 바뀌어 기준 삼기 어려워, 하루 변동률만 본다. 최대 5점(중립 2.5점).
function computeExchangeScore_() {
  var fx = safeCall(function () { return fetchExchange('FX_USDKRW'); });
  if (!fx) return { score: 2.5, note: '환율 조회 실패 - 중립 처리', band: '조회 실패' };
  var score = Math.max(0, Math.min(5, Math.round((2.5 - fx.changeRate) * 10) / 10));
  return { score: score, changeRate: fx.changeRate, price: fx.price, band: '전일대비 ' + (fx.changeRate >= 0 ? '+' : '') + fx.changeRate.toFixed(2) + '%' };
}

// 09:00~11:00=100%, 11:00~13:00=70%, 13:00~장마감(15:30)=30%, 장마감 후=제외(null - 그날
// 선물 신호는 이미 반영이 다 끝났다고 보고 중립 처리). 장 시작 전(00:00~09:00)은 "한국장
// 개장 전 선행지표"라는 지시서 취지상 09:00~11:00과 동일하게 100%로 취급.
function usFuturesTimeWeight_() {
  var hm = parseInt(Utilities.formatDate(new Date(), 'Asia/Seoul', 'HHmm'), 10);
  if (hm < 900) return 1.0;
  if (hm < 1100) return 1.0;
  if (hm < 1300) return 0.7;
  if (hm < 1530) return 0.3;
  return null;
}

// 미국 S&P500 E-mini 선물(ES=F) - 전일 종가 대비 등락률로 점수화, 시간대별 가중치 적용
// (usFuturesTimeWeight_). 미국 증시 마감 후~한국 장 시작 전 사이의 선행지표로 취급된다.
// 최대 5점(중립 2.5점).
function computeUsFuturesScore_() {
  var res = safeCall(function () {
    return UrlFetchApp.fetch(US_FUTURES_URL, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  });
  if (!res || res.getResponseCode() !== 200) return { score: 2.5, note: '미국 선물지수 조회 실패 - 중립 처리', band: '조회 실패' };
  var meta = safeCall(function () {
    var body = JSON.parse(res.getContentText('UTF-8'));
    return body.chart.result[0].meta;
  });
  if (!meta || typeof meta.regularMarketPrice !== 'number' || !meta.previousClose) {
    return { score: 2.5, note: '미국 선물지수 조회 실패 - 중립 처리', band: '조회 실패' };
  }
  var changePct = (meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100;
  var weight = usFuturesTimeWeight_();
  if (weight === null) {
    return { score: 2.5, changePct: changePct, price: meta.regularMarketPrice, note: '장 종료 후 - 중립 처리', band: '장 종료 후(중립)' };
  }
  var score = Math.max(0, Math.min(5, Math.round((2.5 + changePct * weight) * 10) / 10));
  return { score: score, changePct: changePct, price: meta.regularMarketPrice, timeWeight: weight,
    band: (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%(가중치' + Math.round(weight * 100) + '%)' };
}

// 온도(℃) 구간 - 사용자 지정 밴드: 0~10 극도의공포 / 10~20 공포 / 20~28 중립 / 28~35 낙관 / 35+ 과열.
function gradeForTemp_(temp) {
  if (temp < 10) return { emoji: '🧊', label: '극도의 공포', tone: 'extreme-fear' };
  if (temp < 20) return { emoji: '🔵', label: '공포', tone: 'fear' };
  if (temp < 28) return { emoji: '🟡', label: '중립', tone: 'neutral' };
  if (temp < 35) return { emoji: '🟠', label: '낙관', tone: 'greed' };
  return { emoji: '🔥', label: '과열', tone: 'extreme-greed' };
}

// m.stock.naver.com 뉴스 API는 "유사 기사 묶음" 배열을 반환한다.
// 각 묶음(items)에서 대표 기사 1건만 뽑아 평평한 리스트로 만든다.
// body는 API 단계에서 이미 300자 안팎으로 잘려 "..." 처리돼 있어(원문 전체 아님),
// 프론트 모달에서는 스니펫 + 새창 링크로 안내한다 (네이버 뉴스는 X-Frame-Options: SAMEORIGIN이라 iframe 임베드 불가).
function fetchStockNews(code) {
  var url = 'https://m.stock.naver.com/api/news/stock/' + encodeURIComponent(code) + '?pageSize=20&page=1';
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (res.getResponseCode() !== 200) return [];

  var groups = JSON.parse(res.getContentText('UTF-8'));
  if (!groups || !groups.length) return [];

  var items = [];
  groups.forEach(function (g) {
    var it = g && g.items && g.items[0];
    if (!it) return;
    items.push({
      title: it.titleFull || it.title || '',
      body: it.body || '',
      press: it.officeName || '',
      datetime: it.datetime || '', // "yyyyMMddHHmm"
      link: it.mobileNewsUrl || '',
      image: it.imageOriginLink || null
    });
  });
  return items;
}

// ---------------------------------------------------------------------------
// 랭킹뉴스: "증시"+"코스피"+"코스닥" 3개 키워드로 네이버 뉴스 검색을 조회해 라운드로빈으로
// 섞고 URL 기준 중복 제거한 뒤 상위 10건만 응답 (?rankNews=1).
// 종목뉴스(getStockNews)와 달리 특정 종목이 아닌 시황 헤드라인이라 별도 API를 씀.
//
// 2026-07-18: 네이버가 이 검색 API를 개발자센터(openapi.naver.com)에서 NCP API HUB로
// 이관(2027-06-30 완전 종료 예고) - 이 참에 옮기면서, 신청한 앱에 IP 화이트리스트(최대
// 10개)도 걸기로 함. 그런데 GAS(UrlFetchApp)는 고정 IP가 없어서(Google 공개 IP 풀에서
// 매번 다른 IP로 나감 - 공식 확인됨) 화이트리스트를 걸 수가 없다. 그래서 실제 네이버
// 호출은 고정 IP(34.28.220.13)를 가진 VM(scripts/cloud-vm/naver_news.py)이 대신 하고,
// 여기선 그 VM의 /naver-news만 부른다(kiwoomVmFetch_ 재사용, X-API-Key 인증).
// NCP 콘솔엔 이 VM의 IP 하나만 등록하면 된다.
// ---------------------------------------------------------------------------

var RANK_NEWS_QUERIES = ['증시', '코스피', '코스닥'];
var RANK_NEWS_CACHE_TTL = 900; // 15분
var RANK_NEWS_FAIL_TTL = 120;  // 2분 (키 미설정/API 오류 시 빠르게 재시도되도록)

function getRankingNews() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'rank_news_v1';
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var perQuery = RANK_NEWS_QUERIES.map(function (q) {
    return safeCall(function () { return fetchNaverSearchNews(q); }) || [];
  });

  var seen = {};
  var merged = [];
  var maxLen = Math.max.apply(null, [0].concat(perQuery.map(function (l) { return l.length; })));
  // 라운드로빈으로 섞어 한 키워드 뉴스가 몰리지 않도록 함
  for (var i = 0; i < maxLen && merged.length < 10; i++) {
    for (var q = 0; q < perQuery.length; q++) {
      if (merged.length >= 10) break;
      var it = perQuery[q][i];
      if (!it || !it.link || seen[it.link]) continue;
      seen[it.link] = true;
      merged.push(it);
    }
  }

  var result = { items: merged, updatedAt: formatKstTime(Date.now()) };
  cache.put(cacheKey, JSON.stringify(result), merged.length ? RANK_NEWS_CACHE_TTL : RANK_NEWS_FAIL_TTL);
  return result;
}

function fetchNaverSearchNews(query) {
  var items = kiwoomVmFetch_('/naver-news?query=' + encodeURIComponent(query));
  return items || [];
}

// (구 stripNaverHtml - 2026-07-18 VM 이관으로 HTML 스트립이 naver_news.py._strip_html로
// 옮겨가 GAS 쪽에서는 더 이상 안 씀, 삭제됨)

// ---------------------------------------------------------------------------
// 종목별 외국인·기관 수급 조회 (?action=foreignFlow&code=005930)
// finance.naver.com/item/frgn.naver 일자별 테이블(EUC-KR)을 요청 시점에 크롤링.
// 한 페이지 = 20영업일이라 2페이지(40영업일)를 취합해 20일 합산 + 차트용 여유를 확보.
// 작업 지시서(2026-07-10) 스펙: 캐시 없음(온디맨드) - 클라이언트가 5분 메모리 캐시로 디바운스.
// ---------------------------------------------------------------------------

var FRGN_URL = 'https://finance.naver.com/item/frgn.naver';
var FRGN_PAGES = 2; // 20행/페이지 x 2 = 40영업일

function getForeignFlow(code) {
  // 삼성에피스홀딩스(0126Z0) 같은 특수코드도 6자리 영숫자라 허용
  if (!/^[0-9A-Z]{6}$/i.test(code)) {
    return { error: 'INVALID_CODE', message: '6자리 종목코드가 필요합니다.' };
  }

  var name = '';
  var daily = [];
  var seen = {};

  for (var page = 1; page <= FRGN_PAGES; page++) {
    var html;
    try {
      var res = UrlFetchApp.fetch(FRGN_URL + '?code=' + code + '&page=' + page, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.getResponseCode() !== 200) continue;
      // 페이지 인코딩이 EUC-KR이라 반드시 명시해야 한글이 안 깨진다
      html = res.getContentText('EUC-KR');
    } catch (err) {
      continue; // 이 페이지만 스킵 - 1페이지라도 성공하면 결과를 낸다
    }

    if (!name) name = parseFrgnName(html);
    parseFrgnRows(html).forEach(function (row) {
      if (!seen[row.date]) { seen[row.date] = true; daily.push(row); }
    });
  }

  if (!daily.length) {
    return {
      error: 'PARSE_FAILED',
      message: '네이버 수급 데이터를 가져오지 못했습니다. (페이지 구조 변경 또는 일시 오류)'
    };
  }

  daily.sort(function (a, b) { return a.date < b.date ? 1 : -1; }); // 최신일 우선

  var rolling = {
    today: { foreign: daily[0].foreign_net, inst: daily[0].inst_net },
    '5d': { foreign: frgnRollingSum(daily, 'foreign_net', 5), inst: frgnRollingSum(daily, 'inst_net', 5) },
    '10d': { foreign: frgnRollingSum(daily, 'foreign_net', 10), inst: frgnRollingSum(daily, 'inst_net', 10) },
    '20d': { foreign: frgnRollingSum(daily, 'foreign_net', 20), inst: frgnRollingSum(daily, 'inst_net', 20) }
  };

  // 금액 환산: 순매매량(주) x 해당일 종가의 합산 근사치 - 정확한 대금 아님(화면에 "추정치" 명시)
  var amountEstimate = {
    today_krw: frgnAmountSum(daily, 'foreign_net', 1),
    '5d_krw': frgnAmountSum(daily, 'foreign_net', 5),
    '10d_krw': frgnAmountSum(daily, 'foreign_net', 10),
    '20d_krw': frgnAmountSum(daily, 'foreign_net', 20),
    inst_today_krw: frgnAmountSum(daily, 'inst_net', 1),
    inst_5d_krw: frgnAmountSum(daily, 'inst_net', 5),
    inst_10d_krw: frgnAmountSum(daily, 'inst_net', 10),
    inst_20d_krw: frgnAmountSum(daily, 'inst_net', 20)
  };

  return {
    code: code.toUpperCase(),
    name: name,
    as_of: daily[0].date,
    daily: daily,
    rolling: rolling,
    amount_estimate: amountEstimate,
    streak: {
      foreign: frgnStreak(daily, 'foreign_net'),
      inst: frgnStreak(daily, 'inst_net')
    },
    signal: {
      foreign: frgnSignal(daily, rolling, 'foreign'),
      inst: frgnSignal(daily, rolling, 'inst')
    }
  };
}

function parseFrgnName(html) {
  // <div class="wrap_company"> <h2><a ...>삼성전자</a></h2>
  var m = html.match(/wrap_company"[\s\S]{0,300}?<a[^>]*>\s*([^<]+?)\s*<\/a>/);
  return m ? m[1] : '';
}

// 일자별 테이블 행 파싱. 각 데이터 행은 <tr onMouseOver="mouseOver(this)"...>로 시작하고,
// 값들은 순서대로 <span class="tah ...">에 담겨 있다:
// [0]날짜 [1]종가 [2]전일비 [3]등락률 [4]거래량 [5]기관순매매 [6]외국인순매매 [7]외국인보유주수 [8]보유율
function parseFrgnRows(html) {
  var out = [];
  var chunks = html.split(/<tr onMouseOver/i).slice(1);

  chunks.forEach(function (chunk) {
    chunk = chunk.split('</tr>')[0];

    var vals = [];
    var re = /<span class="tah[^"]*">\s*([^<]*?)\s*<\/span>/g;
    var m;
    while ((m = re.exec(chunk)) !== null) vals.push(m[1]);
    if (vals.length < 9) return;

    var dateM = vals[0].match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
    if (!dateM) return;

    out.push({
      date: dateM[1] + '-' + dateM[2] + '-' + dateM[3],
      close: frgnNum(vals[1]),
      change_pct: frgnNum(vals[3]),
      volume: frgnNum(vals[4]),
      inst_net: frgnNum(vals[5]),
      foreign_net: frgnNum(vals[6]),
      foreign_shares: frgnNum(vals[7]),
      foreign_ratio: frgnNum(vals[8])
    });
  });

  return out;
}

// "+1,107,761" / "-6.25%" / "29,703,616" -> 숫자 (콤마/+/% 제거, 음수 부호 유지)
function frgnNum(s) {
  var n = parseFloat(String(s == null ? '' : s).replace(/[+,%\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function frgnRollingSum(daily, field, n) {
  var s = 0;
  var len = Math.min(n, daily.length);
  for (var i = 0; i < len; i++) s += daily[i][field];
  return s;
}

function frgnAmountSum(daily, field, n) {
  var s = 0;
  var len = Math.min(n, daily.length);
  for (var i = 0; i < len; i++) s += daily[i][field] * daily[i].close;
  return s;
}

// 연속 순매수/순매도 일수: 최신일부터 역순으로 방향이 바뀌기 전까지 카운트.
// field: 'foreign_net' | 'inst_net' - 외국인/기관 공용으로 쓰도록 일반화.
function frgnStreak(daily, field) {
  var first = daily[0][field];
  var dir = first > 0 ? 1 : first < 0 ? -1 : 0;
  var days = 0;
  if (dir !== 0) {
    for (var i = 0; i < daily.length; i++) {
      var v = daily[i][field];
      var d = v > 0 ? 1 : v < 0 ? -1 : 0;
      if (d !== dir) break;
      days++;
    }
  }
  return {
    days: days,
    direction: dir > 0 ? 'buy' : dir < 0 ? 'sell' : 'flat'
  };
}

// 추세 전환 신호. 단순히 "5일 합산 vs 20일 합산 부호가 다르면 true"는
// (1) 크기 무시(노이즈에 취약) (2) v20이 v5를 포함하는 중첩 비교 (3) 하루 몰빵 매수도
// "전환"으로 잡히는 문제가 있어 아래 3개 조건을 모두 만족해야 true로 판정한다.
// kind: 'foreign' | 'inst' - rolling/daily의 필드명과 맞춰 외국인/기관 공용으로 씀.
function frgnSignal(daily, rolling, kind) {
  var field = kind + '_net';
  var v5 = rolling['5d'][kind];
  var v20 = rolling['20d'][kind];
  var prior15 = v20 - v5; // v20에서 최근 5일을 뺀, 겹치지 않는 "이전 15일" - 순수 비교용

  // (1) 크기 필터: 최근 20일 평균 하루 순매매 절대값의 2배(=평소 이틀치) 이상이어야 신호로 인정
  var n = Math.min(20, daily.length);
  var avgDaily = 0;
  for (var i = 0; i < n; i++) avgDaily += Math.abs(daily[i][field]);
  avgDaily = n ? avgDaily / n : 0;
  var magnitudeOk = Math.abs(v5) >= avgDaily * 2;

  // (2) 중첩 없는 방향 비교: 최근 5일 vs 그 이전 15일의 부호가 반대일 때만 전환 후보
  var dir = (v5 > 0 && prior15 < 0) ? 'buy' : (v5 < 0 && prior15 > 0) ? 'sell' : null;

  // (3) 연속성 필터: 최근 5일 중 3일 이상이 같은 방향이어야 함(하루 몰빵 매수 등 단발성 배제)
  var m = Math.min(5, daily.length);
  var sameDirDays = 0;
  for (var d = 0; d < m; d++) {
    var v = daily[d][field];
    if ((dir === 'buy' && v > 0) || (dir === 'sell' && v < 0)) sameDirDays++;
  }
  var consistencyOk = sameDirDays >= 3;

  var shift = !!dir && magnitudeOk && consistencyOk;

  // 가격 동반 여부(참고용, 조건에는 안 씀): 같은 5일 평균 등락률 방향이 수급 방향과 일치하는지.
  // 리밸런싱성 매수처럼 가격이 안 따라가는 정상 케이스도 있어 필터로 쓰지 않고 문구에만 참고 표시.
  var avgChangePct = 0;
  for (var c = 0; c < m; c++) avgChangePct += daily[c].change_pct;
  avgChangePct = m ? avgChangePct / m : 0;
  var priceConfirmed = dir === 'buy' ? avgChangePct > 0 : dir === 'sell' ? avgChangePct < 0 : false;

  return {
    trend_shift: shift,
    price_confirmed: priceConfirmed,
    note: shift
      ? '최근 5일 ' + (v5 > 0 ? '플러스' : '마이너스') + ' vs 이전 15일 ' + (prior15 > 0 ? '플러스' : '마이너스')
        + ' 전환' + (priceConfirmed ? ' · 주가 동반' : ' · 주가 미동반')
      : ''
  };
}

// ---------------------------------------------------------------------------
// 공매도 압박 (?action=shortPressure&code=005930)
// 2026-07-11: KRX 내부 크롤링 경로(data.krx.co.kr/comm/bldAttendant/getJsonData.cmd)를
// 시도했으나 실배포에서 세션 워밍업 후에도 "LOGOUT"(400)으로 거부됨 - KRX가 그 사이
// 로그인 기반 정식 Open API(openapi.krx.co.kr, 인증키 발급+서비스별 신청 필요) 체제로
// 전환하면서 예전 크롤링 경로를 막은 것으로 보이고, 그 정식 API에는 공매도 데이터
// 자체가 없다(카테고리: 지수/주식/증권상품/채권/파생상품/일반상품/ESG뿐). 그래서 네이버
// 금융의 "공매도현황" 탭(finance.naver.com/item/short_trade.naver)으로 대체.
// frgn.naver(외국인·기관 수급)와 같은 사이트·같은 시기 페이지라 테이블 템플릿
// (<tr onMouseOver>/<span class="tah">)이 같을 가능성이 높아 그 파싱 패턴을 그대로
// 재사용했지만, 이 개발 환경은 naver.com에 직접 접근이 안 돼(WebFetch 차단) 실제
// 컬럼 순서를 눈으로 확인하지 못했다 - ?debugShortNaver=1&code=005930으로 원본 행
// (raw 배열)을 먼저 확인하고 parseShortTradeRows_의 컬럼 인덱스를 맞출 것.
// 대차잔고는 네이버도 개별종목 단위로 공개하지 않아 여전히 제외, 압박 점수는 거래비중40 /
// 잔고증가30 / 외국인순매도15 / 기관순매도15로 재분배(computeShortPressureScore_).
// "공매도가 주가를 누른다"고 단정하지 않고 항상 가능성/추정/압박도로 표현(지시서 원칙).
// ---------------------------------------------------------------------------

var SHORT_TRADE_URL = 'https://finance.naver.com/item/short_trade.naver';
var SHORT_TRADE_PAGES = 2; // 20행/페이지 x 2 ≈ 40영업일(20일 평균거래량 계산 여유)

var SHORT_TRADE_LAST_DEBUG = null; // 직전 fetchShortTradeRows_ 호출의 진단 정보(상태코드/HTML 앞부분) - ?debugShortNaver=1 용

function fetchShortTradeRows_(code) {
  var rows = [];
  var seen = {};
  var pageDebug = [];
  for (var page = 1; page <= SHORT_TRADE_PAGES; page++) {
    try {
      var res = UrlFetchApp.fetch(SHORT_TRADE_URL + '?code=' + code + '&page=' + page, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      var status = res.getResponseCode();
      var html = res.getContentText('EUC-KR');
      var shortIdx = html.indexOf('공매도');
      var trIdx = html.search(/<tr onMouseOver/i);
      var tahIdx = html.indexOf('class="tah');
      pageDebug.push({
        page: page,
        status: status,
        htmlLen: html.length,
        hasShortWord: shortIdx > -1,
        hasTrOnMouseOver: trIdx > -1,
        hasTahClass: tahIdx > -1,
        aroundShortWord: shortIdx > -1 ? html.slice(Math.max(0, shortIdx - 100), shortIdx + 500) : null,
        aroundTah: tahIdx > -1 ? html.slice(Math.max(0, tahIdx - 200), tahIdx + 500) : null
      });
      if (status !== 200) continue;
      parseShortTradeRows_(html).forEach(function (row) {
        if (!seen[row.date]) { seen[row.date] = true; rows.push(row); }
      });
    } catch (err) {
      pageDebug.push({ page: page, error: String(err) });
      continue; // 이 페이지만 스킵
    }
  }
  SHORT_TRADE_LAST_DEBUG = pageDebug;
  rows.sort(function (a, b) { return a.date < b.date ? 1 : -1; }); // 최신일 우선
  return rows;
}

// 컬럼 순서는 frgn.naver와 같은 템플릿일 것으로 "추정"한 것 - 실제 미확인.
// 추정 순서: [0]날짜 [1]종가 [2]전일비 [3]등락률 [4]거래량 [5]공매도량 [6]공매도대금
// [7]공매도비중(%) [8]잔고수량 [9]잔고금액 [10]잔고비율(%) - raw에 전체를 같이 담아
// ?debugShortNaver=1로 바로 검증/수정 가능하게 함.
function parseShortTradeRows_(html) {
  var out = [];
  var chunks = html.split(/<tr onMouseOver/i).slice(1);

  chunks.forEach(function (chunk) {
    chunk = chunk.split('</tr>')[0];
    var vals = [];
    var re = /<span class="tah[^"]*">\s*([^<]*?)\s*<\/span>/g;
    var m;
    while ((m = re.exec(chunk)) !== null) vals.push(m[1]);
    if (vals.length < 6) return;

    var dateM = vals[0].match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
    if (!dateM) return;

    out.push({
      date: dateM[1] + '-' + dateM[2] + '-' + dateM[3],
      close: frgnNum(vals[1]),
      volume: frgnNum(vals[4]),
      shortVolume: frgnNum(vals[5]),
      shortValue: vals.length > 6 ? frgnNum(vals[6]) : 0,
      shortRatioPct: vals.length > 7 ? frgnNum(vals[7]) : null,
      balanceQty: vals.length > 8 ? frgnNum(vals[8]) : null,
      balanceValue: vals.length > 9 ? frgnNum(vals[9]) : null,
      balanceRatioPct: vals.length > 10 ? frgnNum(vals[10]) : null,
      raw: vals
    });
  });

  return out;
}

// 임시 진단용(?debugShortNaver=1&code=005930): 파싱한 행 원본(raw 배열 포함)을 그대로 노출.
// 실제 컬럼 순서 확인되면 parseShortTradeRows_의 인덱스 매핑을 맞추고 이 함수는 지울 것.
function debugShortTradeNaver(code) {
  var rows = fetchShortTradeRows_(code || '005930');
  return { rowCount: rows.length, sample: rows.slice(0, 3), pages: SHORT_TRADE_LAST_DEBUG };
}

function getShortPressure(code) {
  if (!/^[0-9A-Z]{6}$/i.test(code)) {
    return { error: 'INVALID_CODE', message: '6자리 종목코드가 필요합니다.' };
  }

  var rows = fetchShortTradeRows_(code);
  if (!rows.length) {
    return { error: 'PARSE_FAILED', message: '네이버 공매도 데이터를 가져오지 못했습니다.' };
  }

  var today = rows[0];
  var prior = rows.length > 1 ? rows[1] : null;

  var shortRatioPct = today.shortRatioPct != null
    ? today.shortRatioPct
    : (today.volume > 0 ? (today.shortVolume / today.volume) * 100 : 0);

  var avgN = Math.min(20, rows.length);
  var avgVolume = avgN ? rows.slice(0, avgN).reduce(function (s, r) { return s + r.volume; }, 0) / avgN : 0;

  var balanceQty = today.balanceQty;
  var daysToCover = (balanceQty != null && avgVolume > 0) ? balanceQty / avgVolume : null;
  var avgShortPrice = (balanceQty && today.balanceValue) ? today.balanceValue / balanceQty : null;
  var balanceChangePct = (prior && prior.balanceQty)
    ? ((balanceQty - prior.balanceQty) / prior.balanceQty) * 100
    : 0;

  var flow = safeCall(function () { return getForeignFlow(code); });
  var foreignNetToday = (flow && !flow.error && flow.daily && flow.daily[0]) ? flow.daily[0].foreign_net : 0;
  var instNetToday = (flow && !flow.error && flow.daily && flow.daily[0]) ? flow.daily[0].inst_net : 0;

  var pressure = computeShortPressureScore_(shortRatioPct, balanceChangePct, foreignNetToday, instNetToday);

  var shortSqueezeIndex = today.shortVolume > 0
    ? ((instNetToday + foreignNetToday) / today.shortVolume) * 100
    : null;

  return {
    code: code.toUpperCase(),
    name: (flow && flow.name) || '',
    as_of: today.date,
    balance: {
      qty: balanceQty,
      avg_price: avgShortPrice,
      change_pct: balanceChangePct
    },
    today: {
      short_volume: today.shortVolume,
      total_volume: today.volume,
      short_ratio_pct: shortRatioPct
    },
    avg_volume_20d: avgVolume,
    days_to_cover: daysToCover,
    foreign_net_today: foreignNetToday,
    inst_net_today: instNetToday,
    short_squeeze_index: shortSqueezeIndex,
    pressure: pressure,
    note: '대차잔고는 네이버·KRX 모두 개별종목 단위로 공개하지 않아 이 지표에서는 제외했습니다. ' +
      '공매도 압박은 항상 "가능성/추정"이며, 공매도가 주가를 누른다고 단정하지 않습니다.'
  };
}

// 공매도 압박 점수(100점, 대차잔고 제외 재분배): 거래비중40 / 잔고증가30 / 외국인순매도15 / 기관순매도15.
function computeShortPressureScore_(shortRatioPct, balanceChangePct, foreignNetToday, instNetToday) {
  var ratioScore = shortRatioPct >= 15 ? 40 : shortRatioPct >= 10 ? 32 : shortRatioPct >= 5 ? 20 : shortRatioPct >= 2 ? 10 : 0;
  var balScore = balanceChangePct >= 5 ? 30 : balanceChangePct >= 2 ? 22 : balanceChangePct >= 0 ? 12 : balanceChangePct >= -3 ? 5 : 0;
  var foreignScore = foreignNetToday < 0 ? 15 : 0;
  var instScore = instNetToday < 0 ? 15 : 0;

  var total = ratioScore + balScore + foreignScore + instScore;
  return {
    score: total,
    grade: shortPressureGrade_(total),
    breakdown: {
      short_ratio: ratioScore,
      balance_increase: balScore,
      foreign_sell: foreignScore,
      inst_sell: instScore
    }
  };
}

function shortPressureGrade_(score) {
  if (score <= 20) return { emoji: '🟢', label: '매우 약함' };
  if (score <= 40) return { emoji: '🟢', label: '약함' };
  if (score <= 60) return { emoji: '🟡', label: '보통' };
  if (score <= 80) return { emoji: '🟠', label: '강함' };
  return { emoji: '🔴', label: '매우 강함' };
}

// ---------------------------------------------------------------------------
// 연기금 분석 (?action=pensionFund&code=005930)
// 2026-07-11: 연기금 단독 매매 데이터를 주던 KRX 내부 API(MDCSTAT02303)가
// 공매도와 같은 이유로 막혔고, KRX 정식 Open API에는 투자자별 매매동향 서비스 자체가
// 없어(공매도와 동일 확인) 연기금만 따로 뽑을 수 있는 무료 소스가 없다. 네이버도
// "외국인/기관" 2분류만 주고 기관을 연기금/금융투자/보험 등으로 더 쪼개주지 않는다.
// 그래서 이 페이지는 기존 getForeignFlow(frgn.naver)의 기관(외국인 제외 전체) 순매매를
// "연기금 단독"이 아니라 "기관 합산 추정치"로 명확히 라벨링해서 대체 표시한다
// (연기금은 기관 안에 포함된 하위 항목이라 방향성 참고는 되지만 수치가 완전히 다름).
// 평균매수가(추정) = Σ(기관 순매수 거래량 x 종가) ÷ Σ(기관 순매수 거래량) - frgn.naver가
// 거래대금을 안 줘서 종가로 근사. 지시서의 해석 규칙(연속 순매수 구간별 긍정/중립 판정)은
// AI가 아니라 수치 조건으로 그대로 코드화한다("AI는 임의로 판단하지 않는다" 원칙).
// ---------------------------------------------------------------------------

function getPensionFund(code) {
  if (!/^[0-9A-Z]{6}$/i.test(code)) {
    return { error: 'INVALID_CODE', message: '6자리 종목코드가 필요합니다.' };
  }

  var flow = safeCall(function () { return getForeignFlow(code); });
  if (!flow || flow.error) {
    return { error: 'PARSE_FAILED', message: '네이버 수급 데이터를 가져오지 못했습니다.' };
  }

  var daily = flow.daily; // 최신일 우선, frgn.naver 2페이지 ≈ 40영업일
  var streak = flow.streak.inst; // {days, direction} - frgnStreak가 이미 계산해둔 것 재사용

  function sumInstValue(n) {
    var s = 0, len = Math.min(n, daily.length);
    for (var i = 0; i < len; i++) s += daily[i].inst_net * daily[i].close;
    return s;
  }
  function sumInstVolume(n) {
    var s = 0, len = Math.min(n, daily.length);
    for (var i = 0; i < len; i++) s += daily[i].inst_net;
    return s;
  }

  var net5 = sumInstValue(5);
  var net20 = sumInstValue(20);
  var netAllValue = sumInstValue(daily.length);
  var netAllVolume = sumInstVolume(daily.length);
  var avgBuyPrice = netAllVolume > 0 ? netAllValue / netAllVolume : null;

  var currentPrice = daily.length ? daily[0].close : null;
  var returnPct = (avgBuyPrice && currentPrice)
    ? ((currentPrice - avgBuyPrice) / avgBuyPrice) * 100
    : null;

  var foreignNet5d = flow.rolling['5d'].foreign;

  return {
    code: code.toUpperCase(),
    name: flow.name || '',
    as_of: daily.length ? daily[0].date : null,
    streak: streak,
    net_5d: net5,
    net_20d: net20,
    net_60d: null, // frgn.naver 조회 기간(~40영업일)이 60일보다 짧아 생략(프론트는 '-' 표시)
    net_cumulative: netAllValue,
    cumulative_window_days: daily.length,
    avg_buy_price: avgBuyPrice,
    current_price: currentPrice,
    return_pct: returnPct,
    foreign_net_5d: foreignNet5d,
    interpretation: pensionInterpretation_(streak, foreignNet5d),
    is_institution_aggregate: true,
    note: '연기금 단독 데이터는 무료로 구할 수 있는 곳이 없어(KRX 내부 API 차단, 정식 Open API에도 ' +
      '투자자별 매매동향 없음), 외국인을 제외한 "기관 합산" 순매매로 대체한 추정치입니다. 연기금만의 수치가 아닙니다.'
  };
}

// 지시서 해석표를 그대로 수치 조건화: (기관) 5일+연속순매수=긍정(외국인 동반이면 매우긍정),
// 순매수 중이나 5일 미만=중립~긍정, 5일+연속순매도=비중축소 가능성, 그 외=중립.
function pensionInterpretation_(streak, foreignNet5d) {
  if (streak.direction === 'buy' && streak.days >= 5) {
    return foreignNet5d > 0
      ? { tone: 'very_positive', label: '매우 긍정', text: '기관이 ' + streak.days + '일 연속 순매수 중이고 외국인도 최근 5일 순매수를 동반하고 있습니다.' }
      : { tone: 'positive', label: '긍정', text: '기관이 ' + streak.days + '일 연속 순매수 중입니다.' };
  }
  if (streak.direction === 'buy') {
    return { tone: 'neutral_positive', label: '중립~긍정', text: '기관이 순매수 중이나 연속성은 아직 짧습니다(' + streak.days + '일).' };
  }
  if (streak.direction === 'sell' && streak.days >= 5) {
    return { tone: 'caution', label: '비중 축소 가능성', text: '기관이 ' + streak.days + '일 연속 순매도 중입니다.' };
  }
  return { tone: 'neutral', label: '중립', text: '기관 매매 방향성이 뚜렷하지 않습니다.' };
}

// ---------------------------------------------------------------------------
// 차트 패턴 스캔(지시서 5종): 저점상승형(Higher Low) / 쌍바닥(double bottom) /
// 역헤드앤숄더 / 박스권하단 / 눌림목(pullback).
// 지시서 원칙대로 AI가 패턴을 임의 판단하지 않고, 모든 패턴을 0~100점 수치 조건으로 채점해
// 70점 이상만 노출한다(patternGrade_) - 결과에는 점수 + 원인(부분점수 breakdown) +
// AI 한 줄 해석(규칙 기반 문자열, LLM 호출 아님)을 함께 실어보낸다(buildPatternMatch_).
// 섹터 대시보드 종목 풀(GitHub Pages의 data/sectors-v3.js)을 그때그때 fetch해서
// 스캔 대상으로 재사용 - 별도 종목 리스트를 GAS에 하드코딩하지 않는다.
// 스캔 자체는 VM의 daily_scan.py(하루 1회 systemd timer)가 담당하고, 블로그는
// getPatternScanResult()가 VM 결과를 재포장한 값만 읽는다(방문자가 몰려도 매번 재스캔 안 함).
// 클릭 시 차트는 온디맨드로 그 종목만 다시 크롤링(foreignFlow와 동일 패턴, 아래 detect*_ 함수 재사용).
//
// Swing Low/High 정의(지시서): 최근 5개 캔들 중 좌우 각각 2개의 캔들보다 저가가
// 낮은/고가가 높은 캔들 - findSwingIndices_(PATTERN_SWING=2)가 그대로 구현.
// ---------------------------------------------------------------------------

var PATTERN_SWING = 2;           // 스윙 판정 시 좌우로 비교할 봉 수(지시서: 좌우 2개씩 = 5개 캔들 중 극값)
var PATTERN_MAX_MATCHES = 30;    // 패턴별 저장 개수 상한 (PropertiesService 9KB/속성 제한 대비)

// 4개 패턴(저점상승형/쌍바닥/역헤드앤숄더/박스권하단)이 종목당 필요한 표시 구간이 서로 달라서
// (60/90/60/40일) 크롤링은 그중 가장 긴 쌍바닥 기준(90일 + 스윙 판정 여유)으로 한 번만 하고,
// 각 detect*_ 함수가 daily.slice()로 자기 window만큼만 잘라 쓴다(종목당 크롤링 1회 유지).
var PATTERN_PAGES = 10;          // fetchDailyOhlc_ 페이지 수 (10행 x 10 ≈ 100영업일, 90일 window + 여유)
var PATTERN_CHART_PAGES = 50;    // 클릭 시 상세 차트 전용(10행 x 50 ≈ 500영업일 ≈ 2년) - 스캔 판정용 PATTERN_PAGES와 별개
                                  // (detect*_ 함수들은 daily.slice()로 자기 window만 쓰므로 판정 결과에는 영향 없음)
var RISING_LOWS_WINDOW = 60;     // ① 저점상승형: 지시서 "최근 60거래일"
var DOUBLE_BOTTOM_WINDOW = 90;   // ② 쌍바닥: 지시서 "최근 90거래일"
var IHS_WINDOW = 60;             // ③ 역헤드앤숄더: 지시서에 window 명시 없어 저점상승형과 동일하게 적용
var BOX_WINDOW = 40;             // ④ 박스권하단: 지시서 "최근 40거래일"

var WEDGE_MIN_SWINGS = 2;        // ① 지시서: Swing Low 2개 이상
var WEDGE_MIN_LOW_RISE = 0.03;   // ① 지시서: 최근 저점이 이전 저점보다 최소 3% 이상 높음
var WEDGE_MIN_GAP_DAYS = 5;      // ① 지시서: 두 저점 간격 5~20거래일
var WEDGE_MAX_GAP_DAYS = 20;
var WEDGE_MAX_EXTENSION = 0.10;  // ① 지시서: 현재가는 최근 저점 대비 10% 이상 상승하지 않을 것
// 마지막 스윙이 최근 며칠 안에 있어야 "지금 진행 중"으로 인정. 스윙 판정 자체가
// 좌우 PATTERN_SWING(2)봉을 확인해야 하는 구조라 이론상 가장 최근이어도 끝에서 2봉 전이
// 최소값 - 그 최소값 바로 위(3)로 빡빡하게 잡아 "이미 지나간 패턴"을 걸러낸다.
var RECENCY_MAX_GAP = 3;

var DB_LOW_TOL = 0.03;           // ② 지시서: 저점 가격 차이 ±3%
var DB_MIN_GAP_DAYS = 10;        // ② 지시서: 간격 10~40거래일
var DB_MAX_GAP_DAYS = 40;
var DB_PEAK_MIN_RISE = 0.03;     // 사이 고점(넥라인)이 첫 저점 대비 최소 3% 반등해야 유효
var DB_NECK_PROXIMITY_MIN = -0.05; // ② 지시서: 현재가 넥라인 아래 5%

var IHS_SHOULDER_TOL = 0.05;     // ③ 지시서: 양쪽 저점 차이 ±5%
var IHS_HEAD_MIN_DROP = 0.01;    // 헤드가 양 어깨보다 각각 최소 1% 더 낮아야 함(가운데가 최저라는 조건의 최소 여유)
var IHS_NECK_PROXIMITY_MIN = -0.03; // ③ 지시서: 현재가 넥라인 아래 3%

var BOX_TOL = 0.035;             // 박스권: 고점끼리/저점끼리 3.5% 이내로 평평해야 함
var BOX_MAX_RANGE = 0.15;        // ④ 지시서: 고점-저점 차이 15% 이하
var BOX_MIN_RANGE = 0.05;        // 박스 상단-하단 폭이 최소 5% 이상이어야 의미있는 박스(너무 좁으면 제외)
var BOX_NEAR_LOW_TOL = 0.03;     // ④ 지시서: 현재가 지지선 +3% 이내

var BREAKOUT_TOL = 1.02;         // 저항선/넥라인을 2% 넘게 뚫었으면 "이미 지나간 패턴"으로 제외

// 2026-07-13: 차트패턴+눌림목+투자시그널 스캔이 VM의 daily_scan.py(systemd timer,
// scripts/cloud-vm/setup_dailyscan_timer.sh)로 완전히 이전됨 - GAS UrlFetchApp 할당량을
// 태우던 원인(전종목 2,691개 x 종목당 최대 29페이지 크롤링)이 이거였음. 실제 전환도
// 검증됨(전종목 스캔 완주, 가격/등락률 값을 ka10001 조회로 대조 확인). GAS 쪽 이어달리기
// 워커(scanDailyAllWorker_)와 점수 계산 헬퍼는 daily_scan.py/pattern_detect.py/
// invest_signal.py로 완전히 옮겨갔으므로 삭제했다 - 이 함수는 이제 트리거를 아무것도
// 설치하지 않고, 과거에 설치돼 있던 GAS 쪽 스캔 트리거만 정리한다.
// (getPatternChart의 클릭 시 온디맨드 차트는 이 스캔과 무관하게 계속 GAS에서 detect*_ 함수를
// 그대로 쓰므로, detect*_ 함수 자체는 삭제하지 않았음.)
function setupPatternScanTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'scanChartPatterns' || fn === 'scanGoldPitReversal' || fn === 'scanPullback' || fn === 'scanInvestSignal') ScriptApp.deleteTrigger(t);
  });
}

// 2026-07-13: 스캔 자체는 VM의 daily_scan.py(하루 1회 systemd timer)로 이전됨 - GAS
// UrlFetchApp 할당량을 태우던 이어달리기 워커는 삭제되고, VM의 /daily-scan-batch 결과를
// 그대로 읽어와 원래 응답 형태로 재포장한다 - 프론트(js/pattern-scan.js)는 변경 불필요.
function getPatternScanResult() {
  var data = kiwoomVmFetch_('/daily-scan-batch');
  if (!data) {
    return { scannedAt: null, universe: 0, scanned: 0, pullbackScannedAt: null, pullbackScanned: 0, patterns: {} };
  }
  var patternScan = data.patternScan || {};
  var pullbackScan = data.pullbackScan || {};
  return {
    scannedAt: data.generatedAt || null,
    universe: data.universe || 0,
    scanned: patternScan.scanned || 0,
    pullbackScannedAt: data.generatedAt || null,
    pullbackScanned: pullbackScan.scanned || 0,
    patterns: {
      risingLows: (patternScan.patterns && patternScan.patterns.risingLows) || [],
      doubleBottom: (patternScan.patterns && patternScan.patterns.doubleBottom) || [],
      invHeadShoulders: (patternScan.patterns && patternScan.patterns.invHeadShoulders) || [],
      boxRangeLow: (patternScan.patterns && patternScan.patterns.boxRangeLow) || [],
      pullback: pullbackScan.matches || []
    }
  };
}

// 클릭 시 온디맨드 차트: 그 종목만 다시 크롤링해서 캔들 데이터 + 패턴 좌표를 반환.
// (스캔 결과에는 캔들 전체를 저장하지 않음 - PropertiesService 9KB/속성 제한 때문)
// 화면 표시는 PATTERN_CHART_PAGES(2년치)로 넉넉히 가져오고, 패턴 판정(detect*_)은 각 함수가
// daily.slice()로 자기 window(60/90/40일 등)만 잘라 쓰므로 스캔 리스트와 결과가 동일하게 유지된다.
function getPatternChart(code, patternType) {
  if (!/^[0-9A-Za-z]{6}$/i.test(code)) {
    return { error: 'INVALID_CODE', message: '6자리 종목코드가 필요합니다.' };
  }

  var daily = fetchDailyOhlc_(code, PATTERN_CHART_PAGES);
  if (daily.length < BOX_WINDOW) {
    return { error: 'NO_DATA', message: '일봉 데이터를 가져오지 못했습니다.' };
  }

  var detail = null;
  if (patternType === 'risingLows') detail = detectRisingLows_(daily);
  else if (patternType === 'doubleBottom') detail = detectDoubleBottom_(daily);
  else if (patternType === 'invHeadShoulders') detail = detectInvHeadShoulders_(daily);
  else if (patternType === 'boxRangeLow') detail = detectBoxRangeLow_(daily);
  else if (patternType === 'pullback') detail = detectPullback_(daily);

  return { code: code.toUpperCase(), daily: daily, pattern: patternType, detail: detail };
}

// detail: 각 detect*_ 함수의 반환값(score/reasons/interpretation 포함) - 스캔 리스트에도
// 점수+원인+AI 한 줄 해석을 같이 실어서, 프론트가 차트를 다시 열지 않고도 보여줄 수 있게 한다.
function buildPatternMatch_(stock, daily, detail) {
  var last = daily[daily.length - 1];
  var prev = daily.length > 1 ? daily[daily.length - 2] : null;
  var changeRate = (prev && prev.close) ? ((last.close - prev.close) / prev.close * 100) : null;
  return {
    code: stock.code,
    name: stock.name,
    price: last.close,
    changeRate: changeRate,
    date: last.date,
    score: detail.score,
    reasons: detail.reasons,
    interpretation: detail.interpretation
  };
}

// data/sectors-v3.js(GitHub Pages)를 fetch해서 { name, code } 유니크 목록으로 파싱.
// 섹터 데이터가 바뀌어도 GAS 쪽 코드를 따로 수정할 필요 없게 하기 위한 설계.
function fetchSectorUniverse_() {
  var url = 'https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return [];

  var text = res.getContentText('UTF-8');
  var out = [];
  var seen = {};
  var re = /name:\s*"([^"]+)",\s*code:\s*"([0-9A-Za-z]{6})",\s*market:\s*"(KOSPI|KOSDAQ)"/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    if (seen[m[2]]) continue;
    seen[m[2]] = true;
    out.push({ name: m[1], code: m[2], market: m[3] });
  }
  return out;
}

// fetchSectorUniverse_()와 같은 소스(data/sectors-v3.js)를 쓰되, 어느 섹터(업종)에
// 속하는지도 같이 반환한다(히트맵 업종 필터용). 한 종목이 여러 섹터에 의도적으로 중복
// 포함되는 경우(CLAUDE.md 규칙) 코드 기준으로 한 번만 담고 sectors 배열에 전부 모은다.
// sectors-v3.js는 "섹터명": [ { name, code, market }, ... ] 구조라, 먼저 섹터 블록 단위로
// 쪼갠 뒤(entries에 대괄호가 없어 non-greedy ]까지가 정확히 한 섹터 블록) 그 안에서
// 종목 객체를 뽑는 2단 정규식 파싱을 쓴다.
function fetchSectorUniverseWithSectors_() {
  var url = 'https://goodbyestarwars.github.io/tistory-ticker/data/sectors-v3.js';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return [];

  var text = res.getContentText('UTF-8');
  var byCode = {};
  var sectorRe = /"([^"]+)":\s*\[([\s\S]*?)\]/g;
  var itemRe = /name:\s*"([^"]+)",\s*code:\s*"([0-9A-Za-z]{6})",\s*market:\s*"([^"]+)"/g;

  var sm;
  while ((sm = sectorRe.exec(text)) !== null) {
    var sectorName = sm[1];
    var block = sm[2];
    var im;
    itemRe.lastIndex = 0;
    while ((im = itemRe.exec(block)) !== null) {
      var code = im[2];
      if (!byCode[code]) byCode[code] = { code: code, name: im[1], market: im[3], sectors: [] };
      if (byCode[code].sectors.indexOf(sectorName) === -1) byCode[code].sectors.push(sectorName);
    }
  }

  return Object.keys(byCode).map(function (c) { return byCode[c]; });
}

// 네이버 일별시세 페이지 크롤링 (2페이지 ≈ 20영업일). 오름차순(과거->최신) 반환.
// 페이지를 한 장씩 직렬로 받으면 flowChart(74페이지) 최초 조회가 수십 초 걸려서,
// UrlFetchApp.fetchAll로 FETCH_ALL_CHUNK장씩 묶어 병렬 요청한다(요청 수 자체는 동일,
// 왕복 대기만 겹치는 것이라 네이버 부하는 직렬과 같다).
var FETCH_ALL_CHUNK = 15;

function fetchDailyOhlc_(code, pages) {
  var rows = [];
  var seen = {};

  for (var start = 1; start <= pages; start += FETCH_ALL_CHUNK) {
    var reqs = [];
    for (var page = start; page <= Math.min(start + FETCH_ALL_CHUNK - 1, pages); page++) {
      reqs.push({
        url: 'https://finance.naver.com/item/sise_day.naver?code=' + code + '&page=' + page,
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
    }

    var responses;
    try {
      responses = UrlFetchApp.fetchAll(reqs);
    } catch (err) {
      continue; // 이 청크만 스킵(부분 실패 허용 - 기존 직렬 동작과 동일한 관용)
    }

    responses.forEach(function (res) {
      try {
        if (res.getResponseCode() !== 200) return;
        var html = res.getContentText('EUC-KR');
        parseSiseDayRows_(html).forEach(function (row) {
          if (!seen[row.date]) { seen[row.date] = true; rows.push(row); }
        });
      } catch (err) { /* 이 페이지만 스킵 */ }
    });
  }

  rows.sort(function (a, b) { return a.date < b.date ? -1 : 1; }); // 오름차순(과거->최신)
  return rows;
}

// 일자별 테이블 행 파싱. 각 행의 <span class="tah ...">가 순서대로
// [날짜, 종가, 전일비, 시가, 고가, 저가, 거래량]을 담고 있다.
function parseSiseDayRows_(html) {
  var out = [];
  var chunks = html.split(/<tr onMouseOver/i).slice(1);

  chunks.forEach(function (chunk) {
    chunk = chunk.split('</tr>')[0];

    var vals = [];
    var re = /<span class="tah[^"]*">\s*([^<]*?)\s*<\/span>/g;
    var m;
    while ((m = re.exec(chunk)) !== null) vals.push(m[1]);
    if (vals.length < 7) return;

    var dateM = vals[0].match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
    if (!dateM) return;

    out.push({
      date: dateM[1] + '-' + dateM[2] + '-' + dateM[3],
      close: frgnNum(vals[1]),
      open: frgnNum(vals[3]),
      high: frgnNum(vals[4]),
      low: frgnNum(vals[5]),
      volume: frgnNum(vals[6])
    });
  });

  return out;
}

// 스윙 저점/고점 인덱스: 좌우 PATTERN_SWING개씩 비교해 그 구간 내 극값인 지점만 채택.
function findSwingIndices_(win, field, isLow) {
  var idxs = [];
  for (var i = PATTERN_SWING; i < win.length - PATTERN_SWING; i++) {
    var v = win[i][field];
    var ok = true;
    for (var k = i - PATTERN_SWING; k <= i + PATTERN_SWING; k++) {
      if (k === i) continue;
      if (isLow ? win[k][field] < v : win[k][field] > v) { ok = false; break; }
    }
    if (ok) idxs.push(i);
  }
  return idxs;
}

function maxHighBetween_(win, i1, i2) {
  var maxHigh = -Infinity, idx = -1;
  for (var k = i1 + 1; k < i2; k++) {
    if (win[k].high > maxHigh) { maxHigh = win[k].high; idx = k; }
  }
  return idx === -1 ? null : { date: win[idx].date, high: maxHigh };
}

// period 이동평균 시리즈(win과 같은 길이, 앞쪽 period-1개는 null). 저점상승형(5일선)·
// 눌림목(20일선/60일선) 점수 계산에서 공용으로 쓴다.
function movingAverage_(win, field, period) {
  var n = win.length;
  var ma = new Array(n).fill(null);
  var sum = 0;
  for (var i = 0; i < n; i++) {
    sum += win[i][field];
    if (i >= period) sum -= win[i - period][field];
    if (i >= period - 1) ma[i] = sum / period;
  }
  return ma;
}

// 구간 뒤쪽 절반 평균 거래량이 앞쪽 절반보다 작으면 "거래량 감소"로 인정(여러 패턴 공용).
function isVolumeDeclining_(win, fromIdx, toIdx) {
  var mid = fromIdx + Math.floor((toIdx - fromIdx) / 2);
  if (mid <= fromIdx || toIdx <= mid) return false;
  var early = avgVolume_(win, fromIdx, mid);
  var late = avgVolume_(win, mid, toIdx);
  return early > 0 && late < early;
}

function avgVolume_(win, fromIdx, toIdx) {
  var s = 0, n = 0;
  for (var i = fromIdx; i < toIdx; i++) { s += win[i].volume; n++; }
  return n ? s / n : 0;
}

function isLastCandleBullish_(win) {
  var last = win[win.length - 1];
  return last.close > last.open;
}

// fromIdx 다음 캔들부터 끝까지 중 양봉(close>open)이 하나라도 있으면 true (쌍바닥 저점2 이후 반등 확인용)
function hasBullishAfter_(win, fromIdx) {
  for (var i = fromIdx + 1; i < win.length; i++) {
    if (win[i].close > win[i].open) return true;
  }
  return false;
}

// 부분점수 배점표에서 값이 속하는 구간의 점수를 찾는다. tiers: [{min, score}, ...]는
// min 내림차순으로 정렬돼 있어야 하고, 마지막 항목이 사실상 "그 외" 처리(min: -Infinity)를 맡는다.
function scoreTier_(value, tiers) {
  for (var i = 0; i < tiers.length; i++) {
    if (value >= tiers[i].min) return tiers[i].score;
  }
  return 0;
}

function clampScore_(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function patternGrade_(score) {
  return score >= 70;
}

// 저점상승형(Higher Low, 지시서 ①): 최근 60거래일 중 스윙 저점 2개 이상 + 마지막 저점이
// 그 전 저점보다 3%+ 높고(하락 압력 약화) + 두 저점 간격 5~20거래일 + 최근 고점이 5일선
// 근처에서 저항받고 + 현재가가 마지막 저점 대비 10% 넘게 오르지 않은(아직 안 늦은) 구간.
function detectRisingLows_(daily) {
  var win = daily.slice(Math.max(0, daily.length - RISING_LOWS_WINDOW));
  if (win.length < RISING_LOWS_WINDOW) return null;

  var lowIdxs = findSwingIndices_(win, 'low', true);
  var highIdxs = findSwingIndices_(win, 'high', false);
  if (lowIdxs.length < WEDGE_MIN_SWINGS) return null;

  // ③ 최근 저점이 "이전 저점"보다 최소 3%+ 높음 - 스윙 저점이 여러 개여도 최근 두 개만 비교
  var prevLowIdx = lowIdxs[lowIdxs.length - 2];
  var lastLowIdx = lowIdxs[lowIdxs.length - 1];
  var prevLow = win[prevLowIdx].low;
  var lastLow = win[lastLowIdx].low;
  var riseRatio = (lastLow - prevLow) / prevLow;
  if (riseRatio < WEDGE_MIN_LOW_RISE) return null;

  // ④ 두 저점 간격 5~20거래일
  var lowSpan = lastLowIdx - prevLowIdx;
  if (lowSpan < WEDGE_MIN_GAP_DAYS || lowSpan > WEDGE_MAX_GAP_DAYS) return null;

  // 최근성: 마지막 저점이 최근 RECENCY_MAX_GAP거래일 안이어야 "지금" 진행 중인 패턴
  if ((win.length - 1) - lastLowIdx > RECENCY_MAX_GAP) return null;

  var lastClose = win[win.length - 1].close;
  // 마지막 저점 이후 그 저점을 다시 깨고 내려갔으면(스윙으로는 아직 안 잡혀도) 무효
  if (lastClose < lastLow * 0.98) return null;
  // ⑥ 현재가는 최근 저점 대비 10% 이상 상승하지 않을 것(이미 많이 오른 뒤의 늦은 신호 배제)
  if ((lastClose - lastLow) / lastLow > WEDGE_MAX_EXTENSION) return null;

  var lowSwingPoints = lowIdxs.map(function (idx) { return { date: win[idx].date, price: win[idx].low }; });
  var current = { date: win[win.length - 1].date, price: lastClose };

  // ---- 점수(100점): 저점상승폭40 + 저점간격20(④ 필터 통과 시 고정) + 5일선저항20 + 거래량감소10 + 최근양봉10 ----
  var riseScore = scoreTier_(riseRatio, [
    { min: 0.08, score: 40 }, { min: 0.05, score: 30 }, { min: WEDGE_MIN_LOW_RISE, score: 20 }
  ]);
  var spanScore = 20;

  // ⑤ 최근 고점(가장 최근 스윙 고점)이 5일선 ±2% 구간에서 저항받는지
  var ma5 = movingAverage_(win, 'close', 5);
  var resistance = highIdxs.length ? Math.max.apply(null, highIdxs.map(function (idx) { return win[idx].high; })) : null;
  var resistanceIdx = highIdxs.length ? highIdxs[highIdxs.length - 1] : null;
  var ma5AtResistance = resistanceIdx != null ? ma5[resistanceIdx] : null;
  var ma5Diff = ma5AtResistance ? Math.abs(win[resistanceIdx].high - ma5AtResistance) / ma5AtResistance : 1;
  var ma5Score = ma5Diff <= 0.02 ? 20 : ma5Diff <= 0.05 ? 10 : 0;

  var volScore = isVolumeDeclining_(win, prevLowIdx, win.length) ? 10 : 0;
  var bullScore = isLastCandleBullish_(win) ? 10 : 0;

  var score = clampScore_(riseScore + spanScore + ma5Score + volScore + bullScore);
  var reasons = [
    '저점 ' + (riseRatio * 100).toFixed(1) + '% 상승(' + riseScore + '/40점)',
    '저점 간격 ' + lowSpan + '거래일(' + spanScore + '/20점)',
    '5일선 저항 근접도(' + ma5Score + '/20점)',
    '거래량 ' + (volScore ? '감소' : '유지/증가') + '(' + volScore + '/10점)',
    '최근 캔들 ' + (bullScore ? '양봉' : '음봉') + '(' + bullScore + '/10점)'
  ];

  return {
    low_swings: lowSwingPoints,
    // 라인은 마지막 스윙 저점에서 끊기지 않고 오늘(현재가)까지 이어서 그린다 -
    // "이미 지나간 패턴"처럼 보이지 않게 하기 위함
    low_swings_display: lowSwingPoints.concat([current]),
    high_swings: highIdxs.map(function (idx) { return { date: win[idx].date, price: win[idx].high }; }),
    resistance: resistance,
    signal: current, // 확인 지점은 항상 "오늘"
    breakout: resistance != null && lastClose > resistance * BREAKOUT_TOL,
    score: score,
    reasons: reasons,
    interpretation: '저점이 ' + (riseRatio * 100).toFixed(1) + '% 높아지며 하락 압력이 약해지는 구간으로 추정됩니다(' + score + '점).'
  };
}

// 쌍바닥(지시서 ②): 최근 90거래일 중 비슷한 높이의 저점 2개(±3%) + 그 사이에 충분히
// 반등한 고점(넥라인) + 간격 10~40거래일 + 두번째 저점 이후 양봉 확인 + 현재가가
// 넥라인 아래 5% 이내(너무 멀지 않음)여야 "확인" 단계로 인정.
function detectDoubleBottom_(daily) {
  var win = daily.slice(Math.max(0, daily.length - DOUBLE_BOTTOM_WINDOW));
  var lowIdxs = findSwingIndices_(win, 'low', true);
  if (lowIdxs.length < 2) return null;

  for (var a = 0; a < lowIdxs.length - 1; a++) {
    for (var b = a + 1; b < lowIdxs.length; b++) {
      var i1 = lowIdxs[a], i2 = lowIdxs[b];
      var gapDays = i2 - i1;
      if (gapDays < DB_MIN_GAP_DAYS || gapDays > DB_MAX_GAP_DAYS) continue; // 간격 10~40거래일
      if ((win.length - 1) - i2 > RECENCY_MAX_GAP) continue; // 두번째 저점이 너무 오래 전이면 스킵

      var low1 = win[i1].low, low2 = win[i2].low;
      var diff = Math.abs(low1 - low2) / Math.min(low1, low2);
      if (diff > DB_LOW_TOL) continue; // 가격 차이 ±3%

      var neck = maxHighBetween_(win, i1, i2);
      if (!neck) continue;
      var riseFromLow1 = (neck.high - low1) / low1;
      if (riseFromLow1 < DB_PEAK_MIN_RISE) continue;

      if (!hasBullishAfter_(win, i2)) continue; // 두번째 저점 이후 양봉(반등 확인)

      var lastClose = win[win.length - 1].close;
      var proximity = (lastClose - neck.high) / neck.high;
      if (proximity < DB_NECK_PROXIMITY_MIN) continue; // 넥라인 아래 5% 이내(너무 멀면 스킵)

      var current = { date: win[win.length - 1].date, price: lastClose };
      // 저점1 이전의 고점 - 차트에 W자 왼쪽 팔(하락 구간)까지 그려서 패턴이 한눈에 보이게 하기 위함
      // (판정 로직에는 안 씀, 순수 시각화용). 저점1 직전 최대 30거래일 구간에서 최고가를 찾는다.
      var leftPeak = maxHighBetween_(win, Math.max(-1, i1 - 31), i1);

      // ---- 점수(100점): 저점유사도40 + 간격20(필터 통과 시 고정) + 반등강도20 + 거래량10 + 넥라인10 ----
      var simScore = diff <= 0.01 ? 40 : diff <= DB_LOW_TOL ? 25 : 0;
      var gapScore = 20;
      var bounceScore = riseFromLow1 >= 0.08 ? 20 : riseFromLow1 >= DB_PEAK_MIN_RISE ? 12 : 0;
      var volScore = isVolumeDeclining_(win, i1, i2) ? 10 : 0;
      var neckScore = proximity >= -0.02 ? 10 : 5;

      var score = clampScore_(simScore + gapScore + bounceScore + volScore + neckScore);
      var reasons = [
        '저점 가격차 ' + (diff * 100).toFixed(1) + '%(' + simScore + '/40점)',
        '저점 간격 ' + gapDays + '거래일(' + gapScore + '/20점)',
        '넥라인 반등폭 ' + (riseFromLow1 * 100).toFixed(1) + '%(' + bounceScore + '/20점)',
        '거래량 ' + (volScore ? '감소' : '유지/증가') + '(' + volScore + '/10점)',
        '현재가-넥라인 근접도(' + neckScore + '/10점)'
      ];

      return {
        leftPeak: leftPeak ? { date: leftPeak.date, price: leftPeak.high } : null,
        low1: { date: win[i1].date, price: low1 },
        low2: { date: win[i2].date, price: low2 },
        neckline: { date: neck.date, price: neck.high },
        current: current, // 저점2 이후 현재가까지 이어야 진짜 W(두번째 상승 다리)가 됨
        signal: current,  // 확인 지점은 항상 "오늘"
        breakout: lastClose > neck.high * BREAKOUT_TOL,
        score: score,
        reasons: reasons,
        interpretation: '두 저점이 ' + (diff * 100).toFixed(1) + '% 차이로 비슷한 쌍바닥 구조로 추정됩니다(' + score + '점).'
      };
    }
  }
  return null;
}

// 역헤드앤숄더(지시서 ③): 저점 3개(좌어깨-헤드-우어깨), 헤드가 가장 낮고 양 어깨는
// 비슷한 높이(±5%), 넥라인 존재, 현재가 넥라인 아래 3% 이내.
function detectInvHeadShoulders_(daily) {
  var win = daily.slice(Math.max(0, daily.length - IHS_WINDOW));
  var lowIdxs = findSwingIndices_(win, 'low', true);
  if (lowIdxs.length < 3) return null;

  for (var a = 0; a < lowIdxs.length - 2; a++) {
    for (var b = a + 1; b < lowIdxs.length - 1; b++) {
      for (var c = b + 1; c < lowIdxs.length; c++) {
        var iL = lowIdxs[a], iH = lowIdxs[b], iR = lowIdxs[c];
        if ((win.length - 1) - iR > RECENCY_MAX_GAP) continue; // 우어깨가 너무 오래 전이면 스킵
        var left = win[iL].low, head = win[iH].low, right = win[iR].low;

        if (!(head < left && head < right)) continue;
        if ((left - head) / left < IHS_HEAD_MIN_DROP) continue;
        if ((right - head) / right < IHS_HEAD_MIN_DROP) continue;

        var shoulderDiff = Math.abs(left - right) / Math.min(left, right);
        if (shoulderDiff > IHS_SHOULDER_TOL) continue;

        var peak1 = maxHighBetween_(win, iL, iH);
        var peak2 = maxHighBetween_(win, iH, iR);
        if (!peak1 || !peak2) continue;
        var necklinePrice = Math.min(peak1.high, peak2.high);
        var necklinePoint = peak1.high <= peak2.high ? peak1 : peak2;

        var lastClose = win[win.length - 1].close;
        var proximity = (lastClose - necklinePrice) / necklinePrice;
        if (proximity < IHS_NECK_PROXIMITY_MIN) continue; // ③ 넥라인 아래 3% 이내(너무 멀면 스킵)

        var current = { date: win[win.length - 1].date, price: lastClose };

        // ---- 점수(100점): 형태유사도50 + 넥라인20 + 대칭성20 + 거래량10 ----
        var headDropAvg = ((left - head) / left + (right - head) / right) / 2;
        var shapeScore = headDropAvg >= 0.05 ? 50 : headDropAvg >= 0.03 ? 35 : 20;
        var neckScoreIhs = proximity >= -0.01 ? 20 : 10;
        var symScore = shoulderDiff <= 0.02 ? 20 : shoulderDiff <= IHS_SHOULDER_TOL ? 12 : 0;
        var volScoreIhs = isVolumeDeclining_(win, iL, iR) ? 10 : 0;

        var score = clampScore_(shapeScore + neckScoreIhs + symScore + volScoreIhs);
        var reasons = [
          '헤드 하락폭 평균 ' + (headDropAvg * 100).toFixed(1) + '%(' + shapeScore + '/50점)',
          '현재가-넥라인 근접도(' + neckScoreIhs + '/20점)',
          '양 어깨 가격차 ' + (shoulderDiff * 100).toFixed(1) + '%(' + symScore + '/20점)',
          '거래량 ' + (volScoreIhs ? '감소' : '유지/증가') + '(' + volScoreIhs + '/10점)'
        ];

        return {
          left_shoulder: { date: win[iL].date, price: left },
          left_peak: { date: peak1.date, price: peak1.high },
          head: { date: win[iH].date, price: head },
          right_peak: { date: peak2.date, price: peak2.high },
          right_shoulder: { date: win[iR].date, price: right },
          neckline: { date: necklinePoint.date, price: necklinePrice },
          current: current, // 우어깨 이후 현재가까지 이어서 패턴이 "지금도 진행 중"임을 보여줌
          signal: current,  // 확인 지점은 항상 "오늘"
          breakout: lastClose > necklinePrice * BREAKOUT_TOL,
          score: score,
          reasons: reasons,
          interpretation: '좌우 어깨가 비슷한 높이(차이 ' + (shoulderDiff * 100).toFixed(1) + '%)의 역헤드앤숄더 구조로 추정됩니다(' + score + '점).'
        };
      }
    }
  }
  return null;
}

// 박스권 하단(지시서 ④): 최근 40거래일 고점끼리·저점끼리 각각 평평(횡보 레인지)하고,
// 고점-저점 차이가 15% 이하이며, 현재가가 그 박스 하단(지지선) +3% 이내에 있는 경우.
function detectBoxRangeLow_(daily) {
  var win = daily.slice(Math.max(0, daily.length - BOX_WINDOW));
  var lowIdxs = findSwingIndices_(win, 'low', true);
  var highIdxs = findSwingIndices_(win, 'high', false);
  if (lowIdxs.length < 2 || highIdxs.length < 2) return null;

  var lowPrices = lowIdxs.map(function (i) { return win[i].low; });
  var highPrices = highIdxs.map(function (i) { return win[i].high; });

  var lowMin = Math.min.apply(null, lowPrices), lowMax = Math.max.apply(null, lowPrices);
  var highMin = Math.min.apply(null, highPrices), highMax = Math.max.apply(null, highPrices);

  if ((lowMax - lowMin) / lowMin > BOX_TOL) return null;   // 저점끼리 평평하지 않음
  if ((highMax - highMin) / highMin > BOX_TOL) return null; // 고점끼리 평평하지 않음

  var support = lowPrices.reduce(function (s, v) { return s + v; }, 0) / lowPrices.length;
  var resistance = highPrices.reduce(function (s, v) { return s + v; }, 0) / highPrices.length;
  if (resistance <= support) return null;
  if ((resistance - support) / support < BOX_MIN_RANGE) return null; // 박스 폭이 너무 좁음(노이즈)
  if ((resistance - support) / support > BOX_MAX_RANGE) return null; // ④ 고점-저점 차이 15% 이하

  var lastClose = win[win.length - 1].close;
  if (lastClose < support * (1 - 0.01)) return null; // 이미 지지선 이탈(박스 붕괴)했으면 제외
  if ((lastClose - support) / support > BOX_NEAR_LOW_TOL) return null; // 하단 근처가 아니면 제외

  // ---- 점수(100점): 박스유지30 + 지지선근접40 + 거래량감소20 + 최근양봉10 ----
  var flatness = Math.max((lowMax - lowMin) / lowMin, (highMax - highMin) / highMin);
  var boxScore = flatness <= 0.015 ? 30 : flatness <= BOX_TOL ? 18 : 0;
  var nearRatio = (lastClose - support) / support;
  var supportScore = nearRatio <= 0.01 ? 40 : nearRatio <= BOX_NEAR_LOW_TOL ? 25 : 0;
  var volScore = isVolumeDeclining_(win, lowIdxs[0], win.length) ? 20 : 0;
  var bullScore = isLastCandleBullish_(win) ? 10 : 0;

  var score = clampScore_(boxScore + supportScore + volScore + bullScore);
  var reasons = [
    '박스 상/하단 평평도(' + boxScore + '/30점)',
    '지지선 근접도 ' + (nearRatio * 100).toFixed(1) + '%(' + supportScore + '/40점)',
    '거래량 ' + (volScore ? '감소' : '유지/증가') + '(' + volScore + '/20점)',
    '최근 캔들 ' + (bullScore ? '양봉' : '음봉') + '(' + bullScore + '/10점)'
  ];

  return {
    support: support,
    resistance: resistance,
    low_swings: lowIdxs.map(function (i) { return { date: win[i].date, price: win[i].low }; }),
    high_swings: highIdxs.map(function (i) { return { date: win[i].date, price: win[i].high }; }),
    signal: { date: win[win.length - 1].date, price: lastClose },
    breakout: false,
    score: score,
    reasons: reasons,
    interpretation: '박스권 하단 지지선 부근(지지선 대비 +' + (nearRatio * 100).toFixed(1) + '%)에서 반등을 시도하는 구간으로 추정됩니다(' + score + '점).'
  };
}

// 눌림목(지시서 ⑤): 최근 20거래일 중 15% 이상 상승한 뒤, 고점 대비 5~15% 조정을 받고
// 20일선 또는 60일선 ±3% 부근까지 내려온 구간. MA60이 필요해 다른 4개 패턴보다 긴
// 윈도(PULLBACK_WINDOW≈90영업일)를 쓴다 - getPatternChart()가 PATTERN_CHART_PAGES(50페이지,
// ≥90영업일)로 크롤링한 daily를 그대로 슬라이스해서 쓰므로 이 함수 자체엔 크롤링이 없다.
var PULLBACK_WINDOW = 90;
var PULLBACK_LOOKBACK = 20;     // "최근 20거래일" 안에서 고점을 찾음
var PULLBACK_MIN_RISE = 0.15;   // 저점->고점 15% 이상 상승
var PULLBACK_MIN_DROP = 0.05;   // 고점 대비 조정폭 하한 5%
var PULLBACK_MAX_DROP = 0.15;   // 조정폭 상한 15%
var PULLBACK_MA_TOL = 0.03;     // 20일선/60일선 ±3%

function detectPullback_(daily) {
  var win = daily.slice(Math.max(0, daily.length - PULLBACK_WINDOW));
  var n = win.length;
  if (n < 65) return null; // MA60 계산 + 상승 관찰 여유

  var ma20 = movingAverage_(win, 'close', 20);
  var ma60 = movingAverage_(win, 'close', 60);

  var recentStart = Math.max(0, n - PULLBACK_LOOKBACK - 5); // 고점 탐색을 조금 넉넉하게
  var peakIdx = recentStart;
  for (var i = recentStart; i < n; i++) {
    if (win[i].close > win[peakIdx].close) peakIdx = i;
  }
  if ((n - 1) - peakIdx > PULLBACK_LOOKBACK) return null; // 고점이 너무 오래 전이면 "최근 상승" 아님

  var lowIdx = recentStart;
  for (var j = recentStart; j <= peakIdx; j++) {
    if (win[j].close < win[lowIdx].close) lowIdx = j;
  }
  if (lowIdx >= peakIdx) return null; // 상승 구간(저점->고점) 자체가 없음

  var lowClose = win[lowIdx].close;
  var peakClose = win[peakIdx].close;
  var riseRatio = (peakClose - lowClose) / lowClose;
  if (riseRatio < PULLBACK_MIN_RISE) return null;

  var lastClose = win[n - 1].close;
  var dropRatio = (peakClose - lastClose) / peakClose;
  if (dropRatio < PULLBACK_MIN_DROP || dropRatio > PULLBACK_MAX_DROP) return null;

  var ma20Now = ma20[n - 1];
  var ma60Now = ma60[n - 1];
  var diff20 = ma20Now ? Math.abs(lastClose - ma20Now) / ma20Now : Infinity;
  var diff60 = ma60Now ? Math.abs(lastClose - ma60Now) / ma60Now : Infinity;
  if (diff20 > PULLBACK_MA_TOL && diff60 > PULLBACK_MA_TOL) return null;

  // ---- 점수(100점): 상승추세30 + 조정폭30 + 이평선위치20 + 거래량감소10 + 최근양봉10 ----
  var riseScore = riseRatio >= 0.25 ? 30 : riseRatio >= 0.20 ? 22 : 15;
  var dropScore = (dropRatio >= 0.07 && dropRatio <= 0.12) ? 30 : 18;
  var maScore = (diff20 <= PULLBACK_MA_TOL && diff60 <= PULLBACK_MA_TOL) ? 20
    : (Math.min(diff20, diff60) <= PULLBACK_MA_TOL) ? 12 : 0;
  var volScore = isVolumeDeclining_(win, peakIdx, n) ? 10 : 0;
  var bullScore = isLastCandleBullish_(win) ? 10 : 0;

  var score = clampScore_(riseScore + dropScore + maScore + volScore + bullScore);
  var maLabel = diff20 <= diff60 ? '20일선' : '60일선';
  var reasons = [
    '상승폭 ' + (riseRatio * 100).toFixed(1) + '%(' + riseScore + '/30점)',
    '조정폭 ' + (dropRatio * 100).toFixed(1) + '%(' + dropScore + '/30점)',
    maLabel + ' 근접도(' + maScore + '/20점)',
    '거래량 ' + (volScore ? '감소' : '유지/증가') + '(' + volScore + '/10점)',
    '최근 캔들 ' + (bullScore ? '양봉' : '음봉') + '(' + bullScore + '/10점)'
  ];

  return {
    rise_start: { date: win[lowIdx].date, price: lowClose },
    peak: { date: win[peakIdx].date, price: peakClose },
    current: { date: win[n - 1].date, price: lastClose },
    signal: { date: win[n - 1].date, price: lastClose },
    ma20: ma20Now,
    ma60: ma60Now,
    breakout: false,
    score: score,
    reasons: reasons,
    interpretation: (riseRatio * 100).toFixed(1) + '% 상승 후 ' + (dropRatio * 100).toFixed(1) + '% 눌림목 조정을 받아 '
      + maLabel + ' 부근에서 지지를 시도하는 구간으로 추정됩니다(' + score + '점).'
  };
}

function isMarketOpenNow() {
  var now = new Date();
  var dow = Number(Utilities.formatDate(now, 'Asia/Seoul', 'u')); // 1=월 .. 7=일
  if (dow >= 6) return false;
  var hm = Number(Utilities.formatDate(now, 'Asia/Seoul', 'HHmm'));
  return hm >= 900 && hm <= 1540;
}

// isMarketOpenNow()는 정규장(09:00~15:40)만 본다 - applyNxtOverride_가 "정규장 값이 이미
// 최신이니 NXT로 덮어쓰지 않는다"를 판단하는 데 그대로 써야 해서 건드리지 않았다. 캐시 TTL은
// 별도로 이 함수를 써서, NXT 프리마켓(08:00~09:00)·애프터마켓(15:30~20:00)도 "장중"과 동일하게
// 60초로 캐싱한다 - 안 그러면 NXT 시세를 반영해도 최대 30분(CACHE_TTL_CLOSED)에 한 번만 갱신되어
// 실시간처럼 안 느껴진다는 지적(2026-07-16)을 반영.
function isAnyTradingSessionOpen_() {
  var now = new Date();
  var dow = Number(Utilities.formatDate(now, 'Asia/Seoul', 'u'));
  if (dow >= 6) return false;
  var hm = Number(Utilities.formatDate(now, 'Asia/Seoul', 'HHmm'));
  return hm >= 800 && hm <= 2000;
}

function formatKstTime(epochMs) {
  return Utilities.formatDate(new Date(epochMs), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

// CacheService 키는 250자 제한 -> 정렬된 codes 문자열이 길면 MD5 해시로 줄인다.
// (섹터 대시보드처럼 종목이 수백 개면 codes.join(',')만으로 쉽게 250자를 넘는다)
function cacheKeyFor(codes) {
  var joined = codes.slice().sort().join(',');
  if (joined.length <= 200) return CACHE_PREFIX + joined;
  var digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, joined);
  var hex = digestBytes.map(function (b) {
    return ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0');
  }).join('');
  return CACHE_PREFIX + hex;
}

function uniqueList(arr) {
  var seen = {};
  var out = [];
  arr.forEach(function (v) {
    if (!seen[v]) { seen[v] = true; out.push(v); }
  });
  return out;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 2026-07-13: 스캔 자체는 VM의 daily_scan.py로 이전됨(getPatternScanResult와 동일 사유) -
// VM의 /daily-scan-batch 결과를 원래 응답 형태로 재포장한다. 프론트(js/invest-signal.js)는
// 변경 불필요 - buckets/counts의 한글 라벨(적극 매수 등)만 기존 영문 키로 매핑해준다.
function getInvestSignalResult() {
  var data = kiwoomVmFetch_('/daily-scan-batch');
  if (!data) {
    return { scannedAt: null, universe: 0, scanned: 0, counts: {}, buckets: {}, rankings: {} };
  }
  var signal = data.investSignal || {};
  var buckets = signal.buckets || {};
  var rankings = signal.rankings || {};
  return {
    scannedAt: data.generatedAt || null,
    universe: data.universe || 0,
    scanned: signal.scanned || 0,
    counts: signal.counts || {},
    buckets: {
      activeBuy: buckets['적극 매수'] || [],
      buy: buckets['매수 우위'] || [],
      hold: buckets['보유'] || [],
      reduce: buckets['비중축소'] || [],
      sell: buckets['매도'] || []
    },
    rankings: {
      foreign: rankings.foreign || [],
      inst: rankings.inst || [],
      pension: rankings.pension || [],
      improved: rankings.improved || [],
      worsened: rankings.worsened || [],
      // 2026-07-20: 종목분석 페이지 통합(가중치 탭) - daily_scan.py가 새로 계산하는 5개
      // 랭킹(수급/외국인·기관 합산/기술적/공매도낮은순/펀더멘탈) passthrough.
      flow: rankings.flow || [],
      foreignInst: rankings.foreignInst || [],
      tech: rankings.tech || [],
      shortSafe: rankings.shortSafe || [],
      fundamental: rankings.fundamental || []
    }
  };
}

// 공매도/대차/연기금 - GCP VM(키움 REST API 상시 서버, 고정IP)을 호출.
// VM 주소·인증 토큰은 스크립트 속성(Apps Script 편집기 > 프로젝트 설정 > 스크립트 속성)에
// KIWOOM_VM_URL(예: http://34.28.220.13:8080), KIWOOM_VM_TOKEN으로 저장(코드에 노출 안 함).
// 2026-07-13: GAS->VM 구간이 간헐적으로 ~11초 타임아웃 나는 현상 확인됨(VM 자체는 로컬/외부
// 어디서 찍어도 항상 즉시 응답 - VM 문제가 아니라 GAS 쪽 네트워크 경로 문제로 추정). 원인을
// 못 잡아서 1회 재시도로 방어 - 재시도까지 실패하면 그때만 null(호출부는 기존처럼 폴백 처리).
function kiwoomVmFetch_(path) {
  var props = PropertiesService.getScriptProperties();
  var base = props.getProperty('KIWOOM_VM_URL');
  var token = props.getProperty('KIWOOM_VM_TOKEN');
  if (!base || !token) return null;

  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var res = UrlFetchApp.fetch(base.replace(/\/$/, '') + path, {
        headers: { 'X-API-Key': token },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) continue;
      var json = JSON.parse(res.getContentText('UTF-8'));
      return json.data;
    } catch (err) {
      continue; // 타임아웃 등 - 마지막 시도까지 실패하면 아래에서 null 반환
    }
  }
  return null;
}

// 종목분석 펀더멘탈 탭 (?action=fundamentals&code=). 밸류에이션 스냅샷(키움 ka10001, VM
// /quote - 온디맨드 실시간)과 5년 실적 추세·최근분기(DART, VM이 하루 1회 미리 계산해둔
// fundamentals_cache.json)를 합쳐서 반환. 캐시에 없는 종목(비상장·최근상장 등)은
// fundamentals: null로 내려줘서 화면이 "데이터 없음" 안내를 띄우게 한다.
function getFundamentals_(code) {
  if (!code) return { error: 'code required' };
  var quote = kiwoomVmFetch_('/quote?code=' + encodeURIComponent(code));
  var valuation = quote ? {
    market_cap_eok: toNum_(quote.mac),           // 시가총액(억원)
    listed_shares_thousand: toNum_(quote.flo_stk), // 발행주식수(천주)
    float_shares_thousand: toNum_(quote.dstr_stk),  // 유통주식수(천주)
    float_ratio_pct: toNum_(quote.dstr_rt),
    foreign_hold_ratio_pct: toNum_(quote.for_exh_rt),
    per: toNum_(quote.per),
    pbr: toNum_(quote.pbr),
    eps: toNum_(quote.eps),
    bps: toNum_(quote.bps),
  } : null;

  var fundamentals = fetchFundamentalsCache_()[code] || null;

  return { code: code, valuation: valuation, fundamentals: fundamentals };
}

function toNum_(v) {
  if (v === undefined || v === null || v === '') return null;
  var n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// DART 재무제표(5년 실적 추세 + 최근 분기 YoY) - VM의 batch_scan.py(scan_fundamentals)가
// 하루 1회 미리 계산해둔 캐시를 그대로 받아온다.
// 아직 어디서도 호출하지 않음 - 종목분석 펀더멘탈 탭에서 처음 소비할 예정.
function fetchFundamentalsCache_() {
  var batch = kiwoomVmFetch_('/fundamentals-batch');
  return (batch && batch.data) || {};
}

// 2026-07-13: 이 아래에 있던 투자시그널 점수 계산 헬퍼(computeFlowScoreServer_ 등)는
// scripts/cloud-vm/invest_signal.py로 이전되고 삭제됨 - daily_scan.py가 VM에서 직접 계산한다.
