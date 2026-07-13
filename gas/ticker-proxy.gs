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

  if (params.marketTemp === '1') {
    return jsonResponse(getMarketTemp());
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

  if (params.action === 'investorFlow') {
    return jsonResponse(getInvestorFlowLive_((params.code || '').trim(), (params.name || '').trim()));
  }

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

  var ttl = isMarketOpenNow() ? CACHE_TTL_OPEN : CACHE_TTL_CLOSED;
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
      out.push({
        code: d.cd,
        name: d.nm,
        price: Number(d.nv) || 0,
        change: Math.abs(Number(d.cv) || 0) * sign,
        changeRate: Math.abs(Number(d.cr) || 0) * sign,
        volume: Number(d.aq) || 0,
        time: time
      });
    });
  }
  return out;
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
function parseIndexResponse_(res, label) {
  if (!res || res.getResponseCode() !== 200) return null;

  var body = JSON.parse(res.getContentText('EUC-KR'));
  var areas = (body && body.result && body.result.areas) || [];
  var d = areas[0] && areas[0].datas && areas[0].datas[0];
  if (!d) return null;

  var sign = (d.rf === '4' || d.rf === '5') ? -1 : 1;
  return {
    name: label,
    price: Number(d.nv) || 0,
    change: Math.abs(Number(d.cv) || 0) * sign,
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

  var ttl = isMarketOpenNow() ? CACHE_TTL_OPEN : CACHE_TTL_CLOSED;
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
        var price = Number(d.nv) || 0;
        var shares = Number(d.countOfListedStock) || 0;
        out[d.cd] = {
          code: d.cd,
          name: d.nm,
          cap: price * shares,
          changeRate: Math.abs(Number(d.cr) || 0) * sign
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
    '기술적 점수(이평선·지지·저항) ' + (params.techScore || '-') + '점 - ' + (params.techNote || '데이터 없음')
  ];
  var verdictLabel = (params.verdictLabel || '').trim();
  var verdictScore = params.verdictScore || '';
  // 별점 판정(가중합)이 이미 확정한 결론을 AI가 다시 판단하지 않도록, 결론을 프롬프트에
  // 못박고 근거 문장만 요청한다 - 화면에서 별점 배지와 AI 한줄평이 서로 다른 의견을
  // 가리키는 모순을 막기 위함(2026-07 사용자 피드백).
  var prompt = verdictLabel
    ? '"' + name + '" 종목은 아래 5가지 수급/기술 지표를 가중합해 이미 "' + verdictLabel + '"(' + verdictScore + '점/100) 의견으로 결론이 났어:\n' + lines.join('\n') +
      '\n\n이 결론과 다른 의견을 새로 내지 말고, "' + verdictLabel + '" 같은 라벨 단어도 다시 쓰지 말고, ' +
      '왜 이 결론인지 핵심 근거만 한국어 한 문장으로 요약해줘. 문장 외 다른 말은 붙이지 마.'
    : '"' + name + '" 종목의 오늘 5가지 수급/기술 지표야:\n' + lines.join('\n') +
      '\n\n이 지표들을 종합한 핵심 근거를 한국어 한 문장으로 요약해줘. 문장 외 다른 말은 붙이지 마.';

  var summary = safeCall(function () { return callGroq(prompt); });
  cache.put(cacheKey, summary || '', summary ? FLOW_AI_CACHE_TTL : FLOW_AI_FAIL_TTL);
  return { summary: summary };
}

// ---------------------------------------------------------------------------
// 수급 위젯용 가격 차트 (?action=flowChart&code=005930)
// 지지/저항(스윙 고점·저점) + 이동평균 5/20/60/224일선을 같이 계산해서 내려준다.
// 화면에는 최근 2년(약 500영업일)을 보여주고, MA224까지 그 구간 전체에서 계산되려면
// 앞에 224일치 여유가 더 필요해서 fetchDailyOhlc_를 훨씬 많은 페이지(74p ≈ 740영업일)로 호출한다.
// 크롤링이 무거워서 30분 캐싱을 건다.
// findSwingIndices_/movingAverage_는 gas/ticker-proxy.gs 안의 패턴스캔 로직과 공용.
// ---------------------------------------------------------------------------
var FLOW_CHART_PAGES = 74;          // 10행 x 74 ≈ 740영업일 (MA224 계산 여유 240일 + 최근 500일 표시)
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

  var daily = fetchDailyOhlc_(code, FLOW_CHART_PAGES);
  if (daily.length < 30) {
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
  var cacheKey = CACHE_PREFIX + 'market_analysis';
  var cached = cache.get(cacheKey);
  if (cached) return { analysis: cached };

  var kospi = safeCall(function () { return fetchIndex('KOSPI', '코스피'); });
  var kosdaq = safeCall(function () { return fetchIndex('KOSDAQ', '코스닥'); });
  if (!kospi && !kosdaq) return { analysis: null };

  var lines = [];
  if (kospi) lines.push('코스피 ' + kospi.price + ' (' + (kospi.changeRate >= 0 ? '+' : '') + kospi.changeRate.toFixed(2) + '%)');
  if (kosdaq) lines.push('코스닥 ' + kosdaq.price + ' (' + (kosdaq.changeRate >= 0 ? '+' : '') + kosdaq.changeRate.toFixed(2) + '%)');

  var prompt = '오늘 국내 증시 상황이야: ' + lines.join(', ') + '. ' +
    '증시/투자자 관점에서 오늘 시장 분위기를 분석하고, 투자자 입장에서 참고할 만한 의견까지 포함해서 3문장으로 한국어로 정리해줘.';

  var analysis = safeCall(function () { return callGroq(prompt); });
  cache.put(cacheKey, analysis || '', analysis ? MARKET_ANALYSIS_CACHE_TTL : MARKET_ANALYSIS_FAIL_TTL);
  return { analysis: analysis };
}

// ---------------------------------------------------------------------------
// 오늘의 증시온도: VIX(25) + 수급(30) + 상승종목비율(25) + 거래대금(20) = 100점.
// "시장 전체"를 직접 크롤링하는 대신(요청 수/신뢰도 문제) 이미 있는 섹터 대시보드
// 종목 풀(fetchSectorUniverse_, data/sectors-v3.js)을 상승비율·거래대금 산정에 재사용.
// 수급은 종목 하나하나를 다 돌 수 없어 KODEX 200(069500, 코스피200 추종 ETF)의
// 외국인+기관 5일 합산 순매매를 시장 수급 대리지표로 쓴다(getForeignFlow 그대로 재사용).
// 점수 구간(각 지표 밴드 경계값)은 지시서에 없어 이 구현에서 정한 값 - 실제 배포 후
// 점수 분포를 보고 조정 가능하도록 각 스코어 함수에 상수로 분리해둠.
// ---------------------------------------------------------------------------

var MARKET_TEMP_CACHE_TTL = 1800;   // 30분
var VIX_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX';
var MT_FLOW_CODE = '069500'; // KODEX 200 - 코스피200 추종 ETF, 수급 대리지표
var MT_VOL_HISTORY_KEY = 'mt_vol_hist_v1';
var MT_VOL_HISTORY_MAX = 10;

function getMarketTemp() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'market_temp_v1';
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var universe = fetchSectorUniverse_();
  var codes = universe.map(function (u) { return u.code; });
  var quotes = codes.length ? (safeCall(function () { return fetchFromNaver(codes); }) || []) : [];

  var vix = scoreVix_(safeCall(fetchVix_));
  var flow = computeFlowScore_();
  var rise = computeRiseRatioScore_(quotes);
  var vol = computeVolumeScore_(quotes);

  var total = Math.max(0, Math.min(100, vix.score + flow.score + rise.score + vol.score));

  var result = {
    score: total,
    grade: gradeForScore_(total),
    components: { vix: vix, flow: flow, riseRatio: rise, tradingValue: vol },
    updatedAt: formatKstTime(Date.now())
  };

  cache.put(cacheKey, JSON.stringify(result), MARKET_TEMP_CACHE_TTL);
  return result;
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

// VIX는 낮을수록 안정(고득점) - 구간 경계는 일반적인 VIX 해석(15/20/25/30) 기준.
function scoreVix_(vix) {
  if (vix == null) return { score: 13, value: null, note: 'VIX 조회 실패 - 중립 처리' };
  var score = vix < 15 ? 25 : vix < 20 ? 20 : vix < 25 ? 13 : vix < 30 ? 6 : 0;
  return { score: score, value: vix };
}

// KODEX 200 외국인+기관 5일 합산 순매매를, 그 종목 자신의 최근 20일 평균 일별
// 순매매 절대값 x5(=5일 기준선) 대비 비율로 환산해 -15~+15점으로 매핑(중립 15점).
function computeFlowScore_() {
  var flow = safeCall(function () { return getForeignFlow(MT_FLOW_CODE); });
  if (!flow || flow.error) return { score: 15, note: 'ETF 수급 데이터 조회 실패 - 중립 처리' };

  var daily = flow.daily;
  var v5 = flow.rolling['5d'].foreign + flow.rolling['5d'].inst;

  var n = Math.min(20, daily.length);
  var avgDaily = 0;
  for (var i = 0; i < n; i++) avgDaily += Math.abs(daily[i].foreign_net) + Math.abs(daily[i].inst_net);
  avgDaily = n ? avgDaily / n : 0;

  var baseline = avgDaily * 5;
  var ratio = baseline > 0 ? Math.max(-1, Math.min(1, v5 / baseline)) : 0;
  var score = Math.round(15 + ratio * 15);

  return { score: score, ratio: ratio, v5: v5, note: 'KODEX 200(069500) 외국인+기관 5일 합산 수급 기준' };
}

// 섹터 풀 종목 중 상승/하락 종목 수 비율. 보합(변동 0)은 분모에서 제외.
function computeRiseRatioScore_(quotes) {
  var up = 0, down = 0;
  quotes.forEach(function (q) {
    if (q.change > 0) up++;
    else if (q.change < 0) down++;
  });
  var total = up + down;
  var ratio = total ? up / total : 0.5;
  var score = ratio >= 0.7 ? 25 : ratio >= 0.55 ? 20 : ratio >= 0.45 ? 12 : ratio >= 0.3 ? 6 : 0;

  return { score: score, ratio: ratio, up: up, down: down, total: total };
}

// 섹터 풀 종목의 가격x거래량 합산(대금 근사치)을 PropertiesService에 최근 10거래일
// 롤링 저장해두고, 오늘 값을 그 이전 기록 평균과 비교해 상대적으로 점수화.
// (시장 전체 거래대금의 절대 원화 기준값은 확보할 수 없어 자기 자신의 과거 대비 상대치로 대체)
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

  var priorEntries = hist.slice(0, -1); // 오늘 제외 이전 기록
  if (priorEntries.length < 3) {
    return { score: 10, today: today, note: '기준 데이터 누적 중(3영업일 미만) - 중립 처리' };
  }

  var avg = priorEntries.reduce(function (s, e) { return s + e.total; }, 0) / priorEntries.length;
  var relative = avg > 0 ? today / avg : 1;
  var score = relative >= 1.3 ? 20 : relative >= 1.1 ? 15 : relative >= 0.9 ? 10 : relative >= 0.7 ? 5 : 0;

  return { score: score, today: today, avg: avg, relative: relative };
}

function gradeForScore_(score) {
  if (score <= 20) return { emoji: '🧊', label: '매우 차가움' };
  if (score <= 40) return { emoji: '🔵', label: '약세' };
  if (score <= 60) return { emoji: '🟡', label: '중립' };
  if (score <= 80) return { emoji: '🟠', label: '강세' };
  return { emoji: '🔥', label: '매우 강세' };
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
// 랭킹뉴스: "증시"+"코스피"+"코스닥" 3개 키워드로 네이버 뉴스 검색 오픈API를 조회해
// 라운드로빈으로 섞고 URL 기준 중복 제거한 뒤 상위 10건만 응답 (?rankNews=1).
// 종목뉴스(getStockNews)와 달리 특정 종목이 아닌 시황 헤드라인이라 별도 API를 씀.
// 키는 PropertiesService에 저장(코드에 노출 안 함): Apps Script 편집기 > 프로젝트 설정 >
// 스크립트 속성 > NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
// (developers.naver.com에서 애플리케이션 등록 후 "검색" API 사용 신청 - 무료, 일 25,000건).
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
  var clientId = PropertiesService.getScriptProperties().getProperty('NAVER_CLIENT_ID');
  var clientSecret = PropertiesService.getScriptProperties().getProperty('NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) return [];

  var url = 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURIComponent(query) + '&display=10&sort=date';
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret
    }
  });
  if (res.getResponseCode() !== 200) return [];

  var body = JSON.parse(res.getContentText('UTF-8'));
  return (body.items || []).map(function (it) {
    return {
      title: stripNaverHtml(it.title),
      link: it.originallink || it.link,
      pubDate: it.pubDate
    };
  });
}

// 검색 API는 title에 <b> 태그와 HTML 엔티티가 섞여 온다
function stripNaverHtml(s) {
  return String(s || '')
    .replace(/<\/?b>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

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
// 하루 1회 시간 트리거(scanChartPatterns/scanPullback)로 스캔해 PropertiesService에
// 저장하고, 블로그는 캐싱된 결과만 읽는다(방문자가 몰려도 매번 재스캔 안 함).
// 클릭 시 차트는 온디맨드로 그 종목만 다시 크롤링(foreignFlow와 동일 패턴).
//
// Swing Low/High 정의(지시서): 최근 5개 캔들 중 좌우 각각 2개의 캔들보다 저가가
// 낮은/고가가 높은 캔들 - findSwingIndices_(PATTERN_SWING=2)가 그대로 구현.
// ---------------------------------------------------------------------------

var PATTERN_SWING = 2;           // 스윙 판정 시 좌우로 비교할 봉 수(지시서: 좌우 2개씩 = 5개 캔들 중 극값)
var PATTERN_MAX_MATCHES = 30;    // 패턴별 저장 개수 상한 (PropertiesService 9KB/속성 제한 대비)
var PATTERN_TIME_BUDGET_MS = 5 * 60 * 1000; // GAS 6분 실행 제한 대비 5분에서 안전 중단

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

// 이어달리기(relay) 공용 상수/헬퍼 - scanDailyAllWorker_()가 쓰는 패턴: ~5분 일하다
// 남으면 커서+중간결과를 저장하고 1분 뒤 자기 자신을 재예약. 재예약 트리거 이름은
// 고정 일일 킥오프 트리거(scanChartPatterns)와 달라서(scanDailyAllWorker_) 서로 안 건드림.
var RELAY_DELAY_MS = 60 * 1000;
var RELAY_MAX_CYCLE_MS = 3 * 60 * 60 * 1000; // 안전장치: 한 사이클이 3시간 넘으면 강제 종료

function scheduleRelay_(fnName, delayMs) {
  clearRelayTriggers_(fnName);
  ScriptApp.newTrigger(fnName).timeBased().after(delayMs).create();
}

function clearRelayTriggers_(fnName) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fnName) ScriptApp.deleteTrigger(t);
  });
}

// ---------------------------------------------------------------------------
// 통합 일일 스캔 (2026-07-13): 차트패턴(4종)+눌림목+투자시그널이 각자 fetchDailyOhlc_로
// 종목당 일봉을 따로 크롤링하던 걸(합치면 종목당 10+9+10=29페이지 x 2,691종목 ≈ 하루
// 78,000+회 UrlFetchApp - 무료 할당량 20,000회를 몇 배 초과) 종목당 1회(PATTERN_PAGES=10
// 페이지, 세 스캔이 필요한 페이지 수 중 최댓값)만 크롤링해서 세 스캔이 공유하도록 통합했다.
// getForeignFlow(투자시그널 전용 - 일봉과 다른 소스인 수급 데이터)만 여전히 별도 호출하므로
// 종목당 10(일봉)+2(수급)=12페이지로 줄어든다(기존 29페이지 대비 약 59% 절감).
// 결과 저장 위치(PATTERN_SCAN_*/PATTERN_SCAN_PULLBACK*/INVEST_SIGNAL_*)와 프론트가 읽는
// getPatternScanResult()/getInvestSignalResult()는 그대로 유지 - 프론트 변경 불필요.
// 고정 일일 트리거는 setupPatternScanTrigger()가 16:00 KST 하나만 설치한다(과거 17:00
// 눌림목/18:00 투자시그널 트리거는 setupPatternScanTrigger() 재실행 시 자동 정리됨).
// ---------------------------------------------------------------------------

// 고정 일일 트리거(setupPatternScanTrigger, 16:00 KST) 진입점 - 이어달리기 워커를 시작만 시킨다.
function scanChartPatterns() {
  scanDailyAllWorker_();
}

function scanDailyAllWorker_() {
  clearRelayTriggers_('scanDailyAllWorker_');

  var props = PropertiesService.getScriptProperties();
  var universe = fetchFullUniverse_();
  var flowCache = fetchInvestorFlowCache_();

  var cursor = parseInt(props.getProperty('DAILY_SCAN_CURSOR') || '0', 10);
  var cycleStartedAt = parseInt(props.getProperty('DAILY_SCAN_CYCLE_STARTED_AT') || '0', 10);
  var isNewCycle = cursor === 0 || !cycleStartedAt;
  if (isNewCycle) cycleStartedAt = Date.now();

  var patternResults = isNewCycle
    ? { risingLows: [], doubleBottom: [], invHeadShoulders: [], boxRangeLow: [] }
    : {
      risingLows: JSON.parse(props.getProperty('PATTERN_SCAN_WIP_RISING') || '[]'),
      doubleBottom: JSON.parse(props.getProperty('PATTERN_SCAN_WIP_DB') || '[]'),
      invHeadShoulders: JSON.parse(props.getProperty('PATTERN_SCAN_WIP_IHS') || '[]'),
      boxRangeLow: JSON.parse(props.getProperty('PATTERN_SCAN_WIP_BOX') || '[]')
    };
  var patternScanned = isNewCycle ? 0 : parseInt(props.getProperty('PATTERN_SCAN_WIP_SCANNED') || '0', 10);

  var pullbackMatches = isNewCycle ? [] : JSON.parse(props.getProperty('PATTERN_PULLBACK_WIP_MATCHES') || '[]');
  var pullbackScanned = isNewCycle ? 0 : parseInt(props.getProperty('PATTERN_PULLBACK_WIP_SCANNED') || '0', 10);

  var signalState = isNewCycle ? freshInvestSignalState_() : loadInvestSignalWip_(props);

  var startedAt = Date.now();
  var forceFinish = (Date.now() - cycleStartedAt) > RELAY_MAX_CYCLE_MS;
  var i = cursor;

  for (; i < universe.length; i++) {
    if (Date.now() - startedAt > PATTERN_TIME_BUDGET_MS) break; // forceFinish여도 이번 호출 시간예산은 항상 지킨다

    var stock = universe[i];
    try {
      // 4개 패턴 + 눌림목 + 투자시그널 기술점수가 전부 같은 100영업일치 일봉을 쓰므로 종목당 1회만 크롤링
      var daily = fetchDailyOhlc_(stock.code, PATTERN_PAGES);

      if (daily.length >= BOX_WINDOW) {
        patternScanned++;

        var rl = detectRisingLows_(daily);
        if (rl && !rl.breakout && patternGrade_(rl.score) && patternResults.risingLows.length < PATTERN_MAX_MATCHES) {
          patternResults.risingLows.push(buildPatternMatch_(stock, daily, rl));
        }

        var db = detectDoubleBottom_(daily);
        if (db && !db.breakout && patternGrade_(db.score) && patternResults.doubleBottom.length < PATTERN_MAX_MATCHES) {
          patternResults.doubleBottom.push(buildPatternMatch_(stock, daily, db));
        }

        var ihs = detectInvHeadShoulders_(daily);
        if (ihs && !ihs.breakout && patternGrade_(ihs.score) && patternResults.invHeadShoulders.length < PATTERN_MAX_MATCHES) {
          patternResults.invHeadShoulders.push(buildPatternMatch_(stock, daily, ihs));
        }

        var box = detectBoxRangeLow_(daily);
        if (box && patternGrade_(box.score) && patternResults.boxRangeLow.length < PATTERN_MAX_MATCHES) {
          patternResults.boxRangeLow.push(buildPatternMatch_(stock, daily, box));
        }
      }

      if (daily.length >= 65) {
        pullbackScanned++;
        var pullback = detectPullback_(daily);
        if (pullback && patternGrade_(pullback.score) && pullbackMatches.length < PATTERN_MAX_MATCHES) {
          pullbackMatches.push(buildPatternMatch_(stock, daily, pullback));
        }
      }

      var flow = getForeignFlow(stock.code);
      if (flow && !flow.error && flow.daily && flow.daily.length) {
        var tech = computeTechScoreServer_(daily);

        var entry = flowCache[stock.code];
        var shortScore = (entry && entry.short && entry.short.pressure) ? entry.short.pressure.score : null;
        var pensionScore = entry && entry.pension ? computePensionScoreServer_(entry.pension) : null;

        var flowScore = computeFlowScoreServer_(flow);
        var foreignInstScore = computeForeignInstScoreServer_(flow.streak);
        var verdict = computeVerdictServer_(flowScore, foreignInstScore, tech, shortScore, pensionScore);

        var last = flow.daily[0]; // getForeignFlow는 최신일 우선 정렬
        var r5 = flow.rolling && flow.rolling['5d'];
        var row = {
          code: stock.code,
          name: flow.name || stock.name,
          price: last.close,
          changeRate: last.change_pct,
          stars: verdict.stars,
          label: verdict.label,
          foreign5d: r5 ? r5.foreign : 0,
          inst5d: r5 ? r5.inst : 0,
          pension5d: (entry && entry.pension && entry.pension.net_5d != null) ? entry.pension.net_5d : null,
          shift: foreignInstShiftScore_(flow.rolling)
        };
        signalState.scanned++;

        signalState.counts[verdict.label] = (signalState.counts[verdict.label] || 0) + 1;
        var bucket = signalState.buckets[verdict.label];
        if (bucket && bucket.length < INVEST_SIGNAL_BUCKET_CAP) {
          bucket.push([row.code, row.name, row.price, row.changeRate, row.stars]);
        }

        upsertRanked_(signalState.topForeign, row, 'foreign5d', INVEST_SIGNAL_TOP_N, 'desc');
        upsertRanked_(signalState.topInst, row, 'inst5d', INVEST_SIGNAL_TOP_N, 'desc');
        upsertRanked_(signalState.topPension, row, 'pension5d', INVEST_SIGNAL_TOP_N, 'desc');
        upsertRanked_(signalState.improved, row, 'shift', INVEST_SIGNAL_TOP_N, 'desc');
        upsertRanked_(signalState.worsened, row, 'shift', INVEST_SIGNAL_TOP_N, 'asc');
      }
    } catch (err) {
      continue; // 이 종목만 스킵
    }
  }

  if (i < universe.length && !forceFinish) {
    props.setProperties({
      DAILY_SCAN_CURSOR: String(i),
      DAILY_SCAN_CYCLE_STARTED_AT: String(cycleStartedAt),
      PATTERN_SCAN_WIP_SCANNED: String(patternScanned),
      PATTERN_SCAN_WIP_RISING: JSON.stringify(patternResults.risingLows),
      PATTERN_SCAN_WIP_DB: JSON.stringify(patternResults.doubleBottom),
      PATTERN_SCAN_WIP_IHS: JSON.stringify(patternResults.invHeadShoulders),
      PATTERN_SCAN_WIP_BOX: JSON.stringify(patternResults.boxRangeLow),
      PATTERN_PULLBACK_WIP_SCANNED: String(pullbackScanned),
      PATTERN_PULLBACK_WIP_MATCHES: JSON.stringify(pullbackMatches)
    });
    saveInvestSignalWip_(props, i, cycleStartedAt, signalState);
    scheduleRelay_('scanDailyAllWorker_', RELAY_DELAY_MS);
    return;
  }

  // 한 바퀴 완료(또는 안전장치로 강제 종료) - 세 스캔 결과를 모두 공식 발행하고 커서 리셋(재예약 없음)
  props.setProperties({
    PATTERN_SCAN_META: JSON.stringify({ scannedAt: formatKstTime(Date.now()), universe: universe.length, scanned: patternScanned }),
    PATTERN_SCAN_RISING: JSON.stringify(patternResults.risingLows),
    PATTERN_SCAN_DB: JSON.stringify(patternResults.doubleBottom),
    PATTERN_SCAN_IHS: JSON.stringify(patternResults.invHeadShoulders),
    PATTERN_SCAN_BOX: JSON.stringify(patternResults.boxRangeLow),
    PATTERN_SCAN_PULLBACK_META: JSON.stringify({ scannedAt: formatKstTime(Date.now()), universe: universe.length, scanned: pullbackScanned }),
    PATTERN_SCAN_PULLBACK: JSON.stringify(pullbackMatches),
    INVEST_SIGNAL_META: JSON.stringify({ scannedAt: formatKstTime(Date.now()), universe: universe.length, scanned: signalState.scanned }),
    INVEST_SIGNAL_COUNTS: JSON.stringify(signalState.counts),
    INVEST_SIGNAL_BUCKET_ACTIVE_BUY: JSON.stringify(signalState.buckets['적극 매수']),
    INVEST_SIGNAL_BUCKET_BUY: JSON.stringify(signalState.buckets['매수 우위']),
    INVEST_SIGNAL_BUCKET_HOLD: JSON.stringify(signalState.buckets['보유']),
    INVEST_SIGNAL_BUCKET_REDUCE: JSON.stringify(signalState.buckets['비중축소']),
    INVEST_SIGNAL_BUCKET_SELL: JSON.stringify(signalState.buckets['매도']),
    INVEST_SIGNAL_TOP_FOREIGN: JSON.stringify(signalState.topForeign),
    INVEST_SIGNAL_TOP_INST: JSON.stringify(signalState.topInst),
    INVEST_SIGNAL_TOP_PENSION: JSON.stringify(signalState.topPension),
    INVEST_SIGNAL_IMPROVED: JSON.stringify(signalState.improved),
    INVEST_SIGNAL_WORSENED: JSON.stringify(signalState.worsened),
    DAILY_SCAN_CURSOR: '0'
  });
  props.deleteProperty('DAILY_SCAN_CYCLE_STARTED_AT');
  ['PATTERN_SCAN_WIP_SCANNED', 'PATTERN_SCAN_WIP_RISING', 'PATTERN_SCAN_WIP_DB', 'PATTERN_SCAN_WIP_IHS', 'PATTERN_SCAN_WIP_BOX',
    'PATTERN_PULLBACK_WIP_SCANNED', 'PATTERN_PULLBACK_WIP_MATCHES']
    .forEach(function (key) { props.deleteProperty(key); });
  deleteInvestSignalWip_(props);
}

// 2026-07-13: 차트패턴+눌림목+투자시그널 스캔이 VM의 daily_scan.py(systemd timer,
// scripts/cloud-vm/setup_dailyscan_timer.sh)로 완전히 이전됨 - GAS UrlFetchApp 할당량을
// 태우던 원인(전종목 2,691개 x 종목당 최대 29페이지 크롤링)이 이거였음. 그래서 이 함수는
// 이제 트리거를 아무것도 설치하지 않고, 과거에 설치돼 있던 GAS 쪽 스캔 트리거만 정리한다.
// scanDailyAllWorker_()와 관련 헬퍼(아래쪽)는 VM 경로가 며칠간 안정적으로 확인될 때까지
// 폴백용으로 코드만 남겨둠 - 확인되면 그 코드는 통째로 삭제해도 된다.
// (getPatternChart의 클릭 시 온디맨드 차트는 이 스캔과 무관하게 계속 GAS에서 detect*_ 함수를
// 그대로 쓰므로, detect*_ 함수 자체는 절대 삭제하면 안 됨.)
function setupPatternScanTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'scanChartPatterns' || fn === 'scanGoldPitReversal' || fn === 'scanPullback' || fn === 'scanInvestSignal') ScriptApp.deleteTrigger(t);
  });
}

// 2026-07-13: 스캔 자체는 VM의 daily_scan.py(하루 1회 systemd timer)로 이전됨 - GAS는
// UrlFetchApp 할당량을 태우던 이어달리기 워커(scanDailyAllWorker_, 아래쪽에 코드는 남아있지만
// 트리거가 더 이상 설치되지 않아 비활성 상태) 대신 VM의 /daily-scan-batch 결과를 그대로
// 읽어와 원래 응답 형태로 재포장한다 - 프론트(js/pattern-scan.js)는 변경 불필요.
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
  var re = /name:\s*"([^"]+)",\s*code:\s*"([0-9A-Za-z]{6})"/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    if (seen[m[2]]) continue;
    seen[m[2]] = true;
    out.push({ name: m[1], code: m[2] });
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
// 윈도(PULLBACK_WINDOW≈90영업일)를 쓰지만, scanDailyAllWorker_()가 PATTERN_PAGES(10페이지,
// ≥90영업일)로 통합 크롤링한 daily를 그대로 슬라이스해서 쓰므로 별도 페이지 수는 없다.
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

// ---------------------------------------------------------------------------
// 오늘의 투자시그널 (?investSignal=1): 전 종목(data/krx_map.js, 약 2,691개) 매수~매도
// 등급 분포 + 수급 랭킹(외국인/기관/연기금 TOP20, 수급개선/악화 TOP20).
//
// js/foreign-flow.js의 가중치 공식(수급40%+외국인기관25%+기술적20%+공매도10%+연기금5%,
// 공매도는 방향보정 없이 raw 점수 그대로)을 서버에서 동일하게 재계산한다.
// - 수급/외국인·기관/기술적 점수는 네이버 크롤링(getForeignFlow/fetchDailyOhlc_ 재사용).
// - 공매도/연기금은 GCP VM(/investor-flow-batch, 섹터풀 238종목만 커버)을 재사용 -
//   커버 안 되는 종목은 이 두 항목(가중치 15%)만 중립(50점) 처리(computeVerdictServer_).
//
// 스캔 자체(이어달리기 워커)는 scanDailyAllWorker_()로 차트패턴/눌림목과 통합됨
// (fetchDailyOhlc_ 중복 크롤링을 없애기 위함) - 여기 남은 건 상태 관리 헬퍼와
// SCORE_WEIGHTS_ 등 점수 계산 상수/결과 조회 함수(getInvestSignalResult)뿐이다.
// ---------------------------------------------------------------------------
var INVEST_SIGNAL_BUCKET_CAP = 100;  // 버킷 하나가 너무 커서 PropertiesService 9KB/속성을 넘지 않게 상한
var INVEST_SIGNAL_TOP_N = 20;
var INVEST_SIGNAL_BUCKET_KEYS = ['적극 매수', '매수 우위', '보유', '비중축소', '매도'];

var SCORE_WEIGHTS_ = { flow: 0.40, foreignInst: 0.25, tech: 0.20, short: 0.10, pension: 0.05 };
var PENSION_TONE_SCORE_ = { very_positive: 90, positive: 75, neutral_positive: 60, neutral: 50, caution: 25 };

// ---- 이어달리기 상태 관리 (WIP_* 접두사, 완료 시 공식 결과로 옮겨지고 삭제됨) ----

function freshInvestSignalState_() {
  var buckets = {}, counts = {};
  INVEST_SIGNAL_BUCKET_KEYS.forEach(function (k) { buckets[k] = []; counts[k] = 0; });
  return {
    scanned: 0,
    counts: counts,
    buckets: buckets,
    topForeign: [], topInst: [], topPension: [], improved: [], worsened: []
  };
}

function loadInvestSignalWip_(props) {
  function arr(key) { return JSON.parse(props.getProperty(key) || '[]'); }
  return {
    scanned: parseInt(props.getProperty('INVEST_SIGNAL_WIP_SCANNED') || '0', 10),
    counts: JSON.parse(props.getProperty('INVEST_SIGNAL_WIP_COUNTS') || '{}'),
    buckets: {
      '적극 매수': arr('INVEST_SIGNAL_WIP_BUCKET_ACTIVE_BUY'),
      '매수 우위': arr('INVEST_SIGNAL_WIP_BUCKET_BUY'),
      '보유': arr('INVEST_SIGNAL_WIP_BUCKET_HOLD'),
      '비중축소': arr('INVEST_SIGNAL_WIP_BUCKET_REDUCE'),
      '매도': arr('INVEST_SIGNAL_WIP_BUCKET_SELL')
    },
    topForeign: arr('INVEST_SIGNAL_WIP_TOP_FOREIGN'),
    topInst: arr('INVEST_SIGNAL_WIP_TOP_INST'),
    topPension: arr('INVEST_SIGNAL_WIP_TOP_PENSION'),
    improved: arr('INVEST_SIGNAL_WIP_IMPROVED'),
    worsened: arr('INVEST_SIGNAL_WIP_WORSENED')
  };
}

function saveInvestSignalWip_(props, cursor, cycleStartedAt, state) {
  props.setProperties({
    INVEST_SIGNAL_CURSOR: String(cursor),
    INVEST_SIGNAL_CYCLE_STARTED_AT: String(cycleStartedAt),
    INVEST_SIGNAL_WIP_SCANNED: String(state.scanned),
    INVEST_SIGNAL_WIP_COUNTS: JSON.stringify(state.counts),
    INVEST_SIGNAL_WIP_BUCKET_ACTIVE_BUY: JSON.stringify(state.buckets['적극 매수']),
    INVEST_SIGNAL_WIP_BUCKET_BUY: JSON.stringify(state.buckets['매수 우위']),
    INVEST_SIGNAL_WIP_BUCKET_HOLD: JSON.stringify(state.buckets['보유']),
    INVEST_SIGNAL_WIP_BUCKET_REDUCE: JSON.stringify(state.buckets['비중축소']),
    INVEST_SIGNAL_WIP_BUCKET_SELL: JSON.stringify(state.buckets['매도']),
    INVEST_SIGNAL_WIP_TOP_FOREIGN: JSON.stringify(state.topForeign),
    INVEST_SIGNAL_WIP_TOP_INST: JSON.stringify(state.topInst),
    INVEST_SIGNAL_WIP_TOP_PENSION: JSON.stringify(state.topPension),
    INVEST_SIGNAL_WIP_IMPROVED: JSON.stringify(state.improved),
    INVEST_SIGNAL_WIP_WORSENED: JSON.stringify(state.worsened)
  });
}

function deleteInvestSignalWip_(props) {
  ['INVEST_SIGNAL_WIP_SCANNED', 'INVEST_SIGNAL_WIP_COUNTS', 'INVEST_SIGNAL_WIP_BUCKET_ACTIVE_BUY',
    'INVEST_SIGNAL_WIP_BUCKET_BUY', 'INVEST_SIGNAL_WIP_BUCKET_HOLD', 'INVEST_SIGNAL_WIP_BUCKET_REDUCE',
    'INVEST_SIGNAL_WIP_BUCKET_SELL', 'INVEST_SIGNAL_WIP_TOP_FOREIGN', 'INVEST_SIGNAL_WIP_TOP_INST',
    'INVEST_SIGNAL_WIP_TOP_PENSION', 'INVEST_SIGNAL_WIP_IMPROVED', 'INVEST_SIGNAL_WIP_WORSENED'
  ].forEach(function (key) { props.deleteProperty(key); });
}

// 랭킹 후보 하나를 상위/하위 N개짜리 정렬 리스트에 삽입하고 N개 넘으면 자른다(전체 종목을
// 다 들고 있다가 마지막에 한 번에 정렬하면 PropertiesService 용량을 넘기므로, 종목 하나
// 처리할 때마다 이렇게 즉시 반영). field 값이 null이면 랭킹 후보에서 제외(연기금 데이터 없는
// 종목 등). order: 'desc'(클수록 상위) | 'asc'(작을수록 상위).
function upsertRanked_(list, row, field, n, order) {
  if (row[field] == null) return;
  list.push([row.code, row.name, row.price, row.changeRate, row[field]]);
  list.sort(function (a, b) { return order === 'desc' ? b[4] - a[4] : a[4] - b[4]; });
  if (list.length > n) list.length = n;
}

// data/krx_map.js(전 상장종목, window.KRX_MAP={"종목명":"코드",...})를 fetch해서
// { name, code } 목록으로 파싱. fetchSectorUniverse_()(섹터풀 238종목)와 별개로
// 투자시그널만 이 전 종목 유니버스를 쓴다.
function fetchFullUniverse_() {
  var url = 'https://goodbyestarwars.github.io/tistory-ticker/data/krx_map.js';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return [];

  var text = res.getContentText('UTF-8');
  var out = [];
  var re = /"([^"]+)":"([0-9A-Za-z]{6})"/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    out.push({ name: m[1], code: m[2] });
  }
  return out;
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
      worsened: rankings.worsened || []
    }
  };
}

// 공매도/대차/연기금 - GCP VM(키움 REST API 상시 서버, 고정IP)을 호출.
// VM 주소·인증 토큰은 스크립트 속성(Apps Script 편집기 > 프로젝트 설정 > 스크립트 속성)에
// KIWOOM_VM_URL(예: http://34.28.220.13:8080), KIWOOM_VM_TOKEN으로 저장(코드에 노출 안 함).
function kiwoomVmFetch_(path) {
  try {
    var props = PropertiesService.getScriptProperties();
    var base = props.getProperty('KIWOOM_VM_URL');
    var token = props.getProperty('KIWOOM_VM_TOKEN');
    if (!base || !token) return null;
    var res = UrlFetchApp.fetch(base.replace(/\/$/, '') + path, {
      headers: { 'X-API-Key': token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    var json = JSON.parse(res.getContentText('UTF-8'));
    return json.data;
  } catch (err) {
    return null;
  }
}

// 종목 하나 온디맨드 조회 (js/foreign-flow.js 위젯용, ?action=investorFlow&code=&name=).
// VM의 /investor-flow는 종목코드 아무거나 다 되므로(섹터풀 제한 없음) 전 종목 커버.
function getInvestorFlowLive_(code, name) {
  if (!code) return { error: 'code required' };
  var path = '/investor-flow?code=' + encodeURIComponent(code) + (name ? '&name=' + encodeURIComponent(name) : '');
  var data = kiwoomVmFetch_(path);
  if (!data) return { error: 'vm_unavailable' };
  return data;
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

// 섹터풀 배치 캐시(scanInvestSignal용) - VM의 batch_scan.py가 하루 1회 미리 계산해둔 것을
// 그대로 받아온다. 예전엔 data/investor-flow-cache.js(PC 로컬 스냅샷)를 읽었지만
// 이제 VM이 상시 갱신하므로 그쪽으로 대체.
function fetchInvestorFlowCache_() {
  var batch = kiwoomVmFetch_('/investor-flow-batch');
  return (batch && batch.data) || {};
}

// DART 재무제표(5년 실적 추세 + 최근 분기 YoY) - VM의 batch_scan.py(scan_fundamentals)가
// 하루 1회 미리 계산해둔 캐시를 그대로 받아온다. fetchInvestorFlowCache_와 동일한 패턴.
// 아직 어디서도 호출하지 않음 - 종목분석 펀더멘탈 탭에서 처음 소비할 예정.
function fetchFundamentalsCache_() {
  var batch = kiwoomVmFetch_('/fundamentals-batch');
  return (batch && batch.data) || {};
}

// 외국인/기관 5일·20일 순매매 방향(4개) 각 ±12.5점, 기준 50점 -> 0~100점.
// js/foreign-flow.js의 computeFlowScore와 동일한 공식(클라이언트/서버 결과 일치 보장).
function computeFlowScoreServer_(flow) {
  var r = flow.rolling || {};
  var f5 = r['5d'] ? r['5d'].foreign : 0;
  var f20 = r['20d'] ? r['20d'].foreign : 0;
  var i5 = r['5d'] ? r['5d'].inst : 0;
  var i20 = r['20d'] ? r['20d'].inst : 0;
  function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  var score = 50 + 12.5 * (sgn(f5) + sgn(f20) + sgn(i5) + sgn(i20));
  return Math.max(0, Math.min(100, Math.round(score)));
}

// 연속매매(streak) 방향·일수를 0~100 점수로 환산. js/foreign-flow.js의
// computeForeignInstScore와 동일한 공식.
function computeForeignInstScoreServer_(streak) {
  streak = streak || {};
  function dirScore(st) {
    if (!st || st.direction === 'flat') return 0;
    var days = Math.min(st.days || 0, 10);
    return (st.direction === 'buy' ? 1 : -1) * (10 + days * 3);
  }
  var score = 50 + (dirScore(streak.foreign) + dirScore(streak.inst)) / 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// 이동평균 배열(40) + 지지선 근접도(30) + 저항선 근접도(30) = 0~100점.
// js/foreign-flow.js의 computeTechnicalScore와 동일한 공식이되, chartData(?action=flowChart
// 응답) 대신 fetchDailyOhlc_ 결과(daily)에서 movingAverage_/computeSupportResistance_를
// 직접 호출해 계산한다(배치라 종목당 flowChart 캐시를 새로 만들 필요 없음).
function computeTechScoreServer_(daily) {
  if (!daily || daily.length < 60) return null;
  var close = daily[daily.length - 1].close;

  function lastVal(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
  var ma5 = lastVal(movingAverage_(daily, 'close', 5));
  var ma20 = lastVal(movingAverage_(daily, 'close', 20));
  var ma60 = lastVal(movingAverage_(daily, 'close', 60));

  var maScore = 0;
  if (ma5 != null && ma20 != null && ma60 != null) {
    if (ma5 > ma20 && ma20 > ma60) maScore = 40;
    else if (ma20 > ma60) maScore = 30;
    else if (ma5 > ma20) maScore = 20;
    else maScore = 0;
  }

  var levels = computeSupportResistance_(daily);
  var support = levels.support || [];
  var supScore = 0;
  if (support.length) {
    var nearestSup = support.reduce(function (a, b) { return Math.abs(b - close) < Math.abs(a - close) ? b : a; });
    var supGap = (close - nearestSup) / nearestSup * 100;
    if (supGap < 0) supScore = 0;
    else if (supGap <= 2) supScore = 30;
    else if (supGap <= 5) supScore = 20;
    else if (supGap <= 8) supScore = 10;
    else supScore = 0;
  }

  var resistance = levels.resistance || [];
  var resScore = 0;
  if (resistance.length) {
    var nearestRes = resistance.reduce(function (a, b) { return Math.abs(b - close) < Math.abs(a - close) ? b : a; });
    var resGap = (nearestRes - close) / close * 100;
    if (resGap < 0) resScore = 30;
    else if (resGap <= 3) resScore = 20;
    else if (resGap <= 8) resScore = 10;
    else resScore = 0;
  }

  return { score: maScore + supScore + resScore };
}

// 연기금 톤(very_positive~caution) 기준점수 + 연속매매일수 가중치 -> 0~100점.
// js/foreign-flow.js의 computePensionScore와 동일한 공식.
function computePensionScoreServer_(p) {
  if (!p || !p.interpretation) return null;
  var base = PENSION_TONE_SCORE_[p.interpretation.tone];
  if (base == null) return null;
  var streak = p.streak || { days: 0, direction: 'flat' };
  var days = Math.min(streak.days || 0, 15);
  var adj = streak.direction === 'buy' ? days * 0.7 : streak.direction === 'sell' ? -days * 0.7 : 0;
  return Math.max(0, Math.min(100, Math.round(base + adj)));
}

// 가중치 기반 종합점수 -> 별점(0~5, 0.5단위) -> 추천 라벨. js/foreign-flow.js의
// computeVerdict와 동일한 공식(공매도 점수도 방향보정 없이 raw 값 그대로 사용).
// 데이터 없는 항목은 중립(50점)으로 채운다.
function computeVerdictServer_(flowScore, foreignInstScore, techScoreObj, shortScore, pensionScore) {
  var techVal = techScoreObj && techScoreObj.score != null ? techScoreObj.score : null;
  var vals = {
    flow: flowScore != null ? flowScore : 50,
    foreignInst: foreignInstScore != null ? foreignInstScore : 50,
    tech: techVal != null ? techVal : 50,
    short: shortScore != null ? shortScore : 50,
    pension: pensionScore != null ? pensionScore : 50
  };
  var composite = vals.flow * SCORE_WEIGHTS_.flow
    + vals.foreignInst * SCORE_WEIGHTS_.foreignInst
    + vals.tech * SCORE_WEIGHTS_.tech
    + vals.short * SCORE_WEIGHTS_.short
    + vals.pension * SCORE_WEIGHTS_.pension;
  var stars = Math.max(0, Math.min(5, Math.round(composite / 20 * 2) / 2));
  var label = stars >= 4.5 ? '적극 매수' : stars >= 3.8 ? '매수 우위' : stars >= 2.8 ? '보유' : stars >= 1.8 ? '비중축소' : '매도';
  return { score: composite, stars: stars, label: label };
}

// "최근 수급 개선/악화" 랭킹용 지표: 최근 5일 일평균 순매매(외국인+기관)에서 그 이전
// 15일 일평균을 뺀 값. 기간이 다른 두 구간(5일 vs 15일)을 그대로 합산 비교하면 왜곡되므로
// 일평균으로 정규화해서 뺀다 - 값이 클수록(+) 최근 수급이 좋아지는 중, 작을수록(-) 나빠지는 중.
function foreignInstShiftScore_(rolling) {
  if (!rolling || !rolling['5d'] || !rolling['20d']) return 0;
  var v5 = rolling['5d'].foreign + rolling['5d'].inst;
  var v20 = rolling['20d'].foreign + rolling['20d'].inst;
  var prior15 = v20 - v5;
  return (v5 / 5) - (prior15 / 15);
}
