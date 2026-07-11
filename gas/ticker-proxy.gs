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

function fetchFromNaver(codes) {
  var url = NAVER_POLLING_URL + codes.join(',');
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  if (res.getResponseCode() !== 200) return [];

  // 네이버 polling API는 Content-Type: text/plain;charset=EUC-KR 로 응답한다 -> EUC-KR 명시
  var body = JSON.parse(res.getContentText('EUC-KR'));
  var areas = (body && body.result && body.result.areas) || [];
  var itemArea = null;
  for (var i = 0; i < areas.length; i++) {
    if (areas[i].name === 'SERVICE_ITEM') { itemArea = areas[i]; break; }
  }
  var datas = (itemArea && itemArea.datas) || [];
  var time = formatKstTime((body.result && body.result.time) || Date.now());

  return datas.map(function (d) {
    // rf: 등락 구분 (1 상한, 2 상승, 3 보합, 4 하한, 5 하락)
    var sign = (d.rf === '4' || d.rf === '5') ? -1 : 1;
    return {
      code: d.cd,
      name: d.nm,
      price: Number(d.nv) || 0,
      change: Math.abs(Number(d.cv) || 0) * sign,
      changeRate: Math.abs(Number(d.cr) || 0) * sign,
      volume: Number(d.aq) || 0,
      time: time
    };
  });
}

// 상단 지수/환율/코인 리본용 (2단계): 코스피/코스닥/원달러환율/BTC 4종을 한 번에 묶어 응답.
// 각 종목은 서로 다른 API(폴링/marketindex/업비트)라 개별 실패해도 나머지는 살리도록 감싼다.
function getMarketRibbon() {
  var cache = CacheService.getScriptCache();
  // market_ribbon3: BTC 소스 교체(빗썸 1순위 + 코인게코 폴백) 배포와 함께 옛 null 캐시 무효화
  var cacheKey = CACHE_PREFIX + 'market_ribbon3';
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var result = {
    kospi: safeCall(function () { return fetchIndex('KOSPI', '코스피'); }),
    kosdaq: safeCall(function () { return fetchIndex('KOSDAQ', '코스닥'); }),
    usdkrw: safeCall(function () { return fetchExchange('FX_USDKRW'); }),
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
  if (res.getResponseCode() !== 200) return null;

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
  if (res.getResponseCode() !== 200) return null;

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
      pageDebug.push({ page: page, status: status, htmlLen: html.length, htmlHead: html.slice(0, 400) });
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
// 차트 패턴 스캔: 저점상승형(ascending) / 쌍바닥(double bottom) / 역헤드앤숄더 / 박스권하단 /
// 골파기반전(MA60 상향돌파, 지시서 5종 외 이 구현에서 추가) / 눌림목(pullback).
// 지시서 원칙대로 AI가 패턴을 임의 판단하지 않고, 모든 패턴을 0~100점 수치 조건으로 채점해
// 70점 이상만 노출한다(patternGrade_) - 결과에는 점수 + 원인(부분점수 breakdown) +
// AI 한 줄 해석(규칙 기반 문자열, LLM 호출 아님)을 함께 실어보낸다(buildPatternMatch_).
// 섹터 대시보드 종목 풀(GitHub Pages의 data/sectors-v3.js)을 그때그때 fetch해서
// 스캔 대상으로 재사용 - 별도 종목 리스트를 GAS에 하드코딩하지 않는다.
// 하루 1회 시간 트리거(scanChartPatterns/scanGoldPitReversal/scanPullback)로 스캔해
// PropertiesService에 저장하고, 블로그는 캐싱된 결과만 읽는다(방문자가 몰려도 매번 재스캔 안 함).
// 클릭 시 차트는 온디맨드로 그 종목만 다시 크롤링(foreignFlow와 동일 패턴).
// ---------------------------------------------------------------------------

var PATTERN_WINDOW = 30;         // 스캔에 쓰는 최근 거래일 수 (골파기 패턴은 20일로는 부족해 30일로 확대)
var PATTERN_PAGES = 3;           // fetchDailyOhlc_ 페이지 수 (10행/페이지 x 3 ≈ 30영업일)
var PATTERN_SWING = 2;           // 스윙 판정 시 좌우로 비교할 봉 수
var PATTERN_MAX_MATCHES = 30;    // 패턴별 저장 개수 상한 (PropertiesService 9KB/속성 제한 대비)
var PATTERN_TIME_BUDGET_MS = 5 * 60 * 1000; // GAS 6분 실행 제한 대비 5분에서 안전 중단

var WEDGE_MIN_SWINGS = 3;        // 저점 2개만 있으면 쌍바닥과 구분이 안 돼서 3개 이상으로 상향
var WEDGE_LOW_RISE_MIN = 0.005;  // 저점 간 최소 0.5% 상승해야 "높아짐"으로 인정
var WEDGE_HIGH_CAP_MAX = 0.02;   // 고점 간 상승폭 2% 이내여야 "막혀있음"으로 인정
var WEDGE_MIN_SPAN_DAYS = 3;
var WEDGE_MIN_TOTAL_RISE = 0.03; // 첫 저점 대비 마지막 저점이 최소 3% 이상 높아야 "상승형"(쌍바닥과 구분)
// 마지막 스윙이 최근 며칠 안에 있어야 "지금 진행 중"으로 인정. 스윙 판정 자체가
// 좌우 PATTERN_SWING(2)봉을 확인해야 하는 구조라 이론상 가장 최근이어도 끝에서 2봉 전이
// 최소값 - 그 최소값 바로 위(3)로 빡빡하게 잡아 "이미 지나간 패턴"을 걸러낸다.
var RECENCY_MAX_GAP = 3;

var DB_LOW_TOL = 0.02;           // 쌍바닥 두 저점 가격差 2% 이내
var DB_MIN_GAP_DAYS = 5;         // 두 저점 사이 최소 간격(거래일)
var DB_PEAK_MIN_RISE = 0.03;     // 사이 고점이 첫 저점 대비 최소 3% 반등해야 유효
var DB_NECK_PROXIMITY_MIN = -0.05; // 현재가가 넥라인보다 5% 넘게 낮으면(아직 멀면) 제외

var IHS_SHOULDER_TOL = 0.05;     // 역헤드앤숄더 양 어깨 가격差 5% 이내 (기존 3%는 너무 빡빡해서 0건 -> 완화)
var IHS_HEAD_MIN_DROP = 0.01;    // 헤드가 양 어깨보다 각각 최소 1% 더 낮아야 함 (기존 2%에서 완화)

var BOX_TOL = 0.035;             // 박스권: 고점끼리/저점끼리 3.5% 이내로 평평해야 함
var BOX_MIN_RANGE = 0.05;        // 박스 상단-하단 폭이 최소 5% 이상이어야 의미있는 박스(너무 좁으면 제외)
var BOX_NEAR_LOW_TOL = 0.03;     // 현재가가 박스 하단에서 3% 이내여야 "저점 근처"로 인정

// 골파기 반전: 60일 이동평균 기준 하락추세->상승추세 전환을 잡아야 해서 다른 패턴보다
// 훨씬 긴 과거 데이터(90영업일)가 필요함. 4개 패턴과 같이 스캔하면 전체가 느려지므로
// scanGoldPitReversal()로 완전히 분리된 함수/트리거/저장 공간을 쓴다.
var GOLD_MA_PERIOD = 60;         // 이동평균 기간(거래일)
var GOLD_WINDOW = 90;            // 스캔에 쓰는 최근 거래일 수(MA60 계산 + 추세전환 관찰 여유분)
var GOLD_PAGES = 9;              // fetchDailyOhlc_ 페이지 수 (10행 x 9 ≈ 90영업일)
var GOLD_TREND_LOOKBACK = 15;    // 전환 직전 이 기간 동안 MA 아래였는지로 "하락추세"였는지 판정
var GOLD_TREND_BELOW_RATIO = 0.6; // 그 기간의 60% 이상 MA 아래였어야 하락추세로 인정
// 랠리/눌림목까지 기다리면 이미 많이 오른 뒤라 늦은 신호가 됨 - "돌파 직후(V자 초반)"만
// 잡도록 크로스 지점이 RECENCY_MAX_GAP(다른 패턴과 공용) 거래일 이내여야 인정.
var GOLD_TIME_BUDGET_MS = 5 * 60 * 1000; // scanGoldPitReversal 전용 시간 예산(6분 실행 제한 대비)

var BREAKOUT_TOL = 1.02;         // 저항선/넥라인을 2% 넘게 뚫었으면 "이미 지나간 패턴"으로 제외

function scanChartPatterns() {
  var startedAt = Date.now();
  var universe = fetchSectorUniverse_();
  var results = { risingLows: [], doubleBottom: [], invHeadShoulders: [], boxRangeLow: [] };
  var scanned = 0;

  for (var i = 0; i < universe.length; i++) {
    if (Date.now() - startedAt > PATTERN_TIME_BUDGET_MS) break; // 시간 초과 시 지금까지 결과로 저장하고 중단

    var stock = universe[i];
    try {
      var daily = fetchDailyOhlc_(stock.code, PATTERN_PAGES);
      if (daily.length < 15) continue;
      scanned++;

      var rl = detectRisingLows_(daily);
      if (rl && !rl.breakout && patternGrade_(rl.score) && results.risingLows.length < PATTERN_MAX_MATCHES) {
        results.risingLows.push(buildPatternMatch_(stock, daily, rl));
      }

      var db = detectDoubleBottom_(daily);
      if (db && !db.breakout && patternGrade_(db.score) && results.doubleBottom.length < PATTERN_MAX_MATCHES) {
        results.doubleBottom.push(buildPatternMatch_(stock, daily, db));
      }

      var ihs = detectInvHeadShoulders_(daily);
      if (ihs && !ihs.breakout && patternGrade_(ihs.score) && results.invHeadShoulders.length < PATTERN_MAX_MATCHES) {
        results.invHeadShoulders.push(buildPatternMatch_(stock, daily, ihs));
      }

      var box = detectBoxRangeLow_(daily);
      if (box && patternGrade_(box.score) && results.boxRangeLow.length < PATTERN_MAX_MATCHES) {
        results.boxRangeLow.push(buildPatternMatch_(stock, daily, box));
      }
    } catch (err) {
      continue; // 이 종목만 스킵
    }
  }

  PropertiesService.getScriptProperties().setProperties({
    PATTERN_SCAN_META: JSON.stringify({
      scannedAt: formatKstTime(Date.now()),
      universe: universe.length,
      scanned: scanned
    }),
    PATTERN_SCAN_RISING: JSON.stringify(results.risingLows),
    PATTERN_SCAN_DB: JSON.stringify(results.doubleBottom),
    PATTERN_SCAN_IHS: JSON.stringify(results.invHeadShoulders),
    PATTERN_SCAN_BOX: JSON.stringify(results.boxRangeLow)
  });

  return results;
}

// 골파기 반전 전용 스캔. MA60 계산 때문에 종목당 90영업일(9페이지)을 크롤링해야 해서
// scanChartPatterns보다 훨씬 느림 - 같이 돌리면 나머지 4개 패턴 커버리지가 줄어들어 분리함.
function scanGoldPitReversal() {
  var startedAt = Date.now();
  var universe = fetchSectorUniverse_();
  var matches = [];
  var scanned = 0;

  for (var i = 0; i < universe.length; i++) {
    if (Date.now() - startedAt > GOLD_TIME_BUDGET_MS) break;

    var stock = universe[i];
    try {
      var daily = fetchDailyOhlc_(stock.code, GOLD_PAGES);
      if (daily.length < GOLD_MA_PERIOD + 20) continue;
      scanned++;

      var gold = detectGoldPitReversal_(daily);
      if (gold && patternGrade_(gold.score) && matches.length < PATTERN_MAX_MATCHES) {
        matches.push(buildPatternMatch_(stock, daily, gold));
      }
    } catch (err) {
      continue;
    }
  }

  PropertiesService.getScriptProperties().setProperties({
    PATTERN_SCAN_GOLD_META: JSON.stringify({
      scannedAt: formatKstTime(Date.now()),
      universe: universe.length,
      scanned: scanned
    }),
    PATTERN_SCAN_GOLD: JSON.stringify(matches)
  });

  return matches;
}

// 눌림목 전용 스캔. 골파기와 마찬가지로 MA60이 필요해 긴 윈도(90영업일)를 크롤링하므로
// 다른 4개 패턴과 분리하고, 골파기와도 시간대를 띄워 6분 실행 제한을 피한다.
function scanPullback() {
  var startedAt = Date.now();
  var universe = fetchSectorUniverse_();
  var matches = [];
  var scanned = 0;

  for (var i = 0; i < universe.length; i++) {
    if (Date.now() - startedAt > PULLBACK_TIME_BUDGET_MS) break;

    var stock = universe[i];
    try {
      var daily = fetchDailyOhlc_(stock.code, PULLBACK_PAGES);
      if (daily.length < 65) continue;
      scanned++;

      var pullback = detectPullback_(daily);
      if (pullback && patternGrade_(pullback.score) && matches.length < PATTERN_MAX_MATCHES) {
        matches.push(buildPatternMatch_(stock, daily, pullback));
      }
    } catch (err) {
      continue;
    }
  }

  PropertiesService.getScriptProperties().setProperties({
    PATTERN_SCAN_PULLBACK_META: JSON.stringify({
      scannedAt: formatKstTime(Date.now()),
      universe: universe.length,
      scanned: scanned
    }),
    PATTERN_SCAN_PULLBACK: JSON.stringify(matches)
  });

  return matches;
}

// 이 함수를 스크립트 편집기에서 한 번 실행하면 매일 자동 스캔 트리거가 설치된다.
// (배포와 별개 - 트리거는 코드 push/재배포로 자동 설치되지 않으므로 최초 1회 수동 실행 필요)
// scanChartPatterns/scanGoldPitReversal/scanPullback 셋 다 설치하고, 서로 겹치지 않게 시간을 띄운다.
function setupPatternScanTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'scanChartPatterns' || fn === 'scanGoldPitReversal' || fn === 'scanPullback') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scanChartPatterns')
    .timeBased()
    .atHour(16) // 장마감(15:30) 이후 여유 두고 16시(Asia/Seoul, 스크립트 기본 시간대 기준)
    .everyDays(1)
    .create();
  ScriptApp.newTrigger('scanGoldPitReversal')
    .timeBased()
    .atHour(17) // scanChartPatterns와 겹치지 않게 1시간 뒤
    .everyDays(1)
    .create();
  ScriptApp.newTrigger('scanPullback')
    .timeBased()
    .atHour(18) // scanGoldPitReversal과도 겹치지 않게 1시간 더 뒤
    .everyDays(1)
    .create();
}

function getPatternScanResult() {
  var props = PropertiesService.getScriptProperties();
  var meta = props.getProperty('PATTERN_SCAN_META');
  var goldMeta = props.getProperty('PATTERN_SCAN_GOLD_META');
  var pullbackMeta = props.getProperty('PATTERN_SCAN_PULLBACK_META');
  return {
    scannedAt: meta ? JSON.parse(meta).scannedAt : null,
    universe: meta ? JSON.parse(meta).universe : 0,
    scanned: meta ? JSON.parse(meta).scanned : 0,
    // 골파기/눌림목은 별도 스캔(90일치 크롤링이라 훨씬 느림)이라 스캔 시각/대상이 다를 수 있어 따로 표기
    goldScannedAt: goldMeta ? JSON.parse(goldMeta).scannedAt : null,
    goldScanned: goldMeta ? JSON.parse(goldMeta).scanned : 0,
    pullbackScannedAt: pullbackMeta ? JSON.parse(pullbackMeta).scannedAt : null,
    pullbackScanned: pullbackMeta ? JSON.parse(pullbackMeta).scanned : 0,
    patterns: {
      risingLows: JSON.parse(props.getProperty('PATTERN_SCAN_RISING') || '[]'),
      doubleBottom: JSON.parse(props.getProperty('PATTERN_SCAN_DB') || '[]'),
      invHeadShoulders: JSON.parse(props.getProperty('PATTERN_SCAN_IHS') || '[]'),
      boxRangeLow: JSON.parse(props.getProperty('PATTERN_SCAN_BOX') || '[]'),
      goldPitReversal: JSON.parse(props.getProperty('PATTERN_SCAN_GOLD') || '[]'),
      pullback: JSON.parse(props.getProperty('PATTERN_SCAN_PULLBACK') || '[]')
    }
  };
}

// 클릭 시 온디맨드 차트: 그 종목만 다시 크롤링해서 캔들 데이터 + 패턴 좌표를 반환.
// (스캔 결과에는 캔들 전체를 저장하지 않음 - PropertiesService 9KB/속성 제한 때문)
// 골파기는 MA60 계산 때문에 다른 패턴보다 훨씬 긴 기간(90일)을 크롤링한다.
function getPatternChart(code, patternType) {
  if (!/^[0-9A-Za-z]{6}$/i.test(code)) {
    return { error: 'INVALID_CODE', message: '6자리 종목코드가 필요합니다.' };
  }

  var pages = (patternType === 'goldPitReversal' || patternType === 'pullback') ? GOLD_PAGES : PATTERN_PAGES;
  var daily = fetchDailyOhlc_(code, pages);
  if (daily.length < 15) {
    return { error: 'NO_DATA', message: '일봉 데이터를 가져오지 못했습니다.' };
  }

  var detail = null;
  if (patternType === 'risingLows') detail = detectRisingLows_(daily);
  else if (patternType === 'doubleBottom') detail = detectDoubleBottom_(daily);
  else if (patternType === 'invHeadShoulders') detail = detectInvHeadShoulders_(daily);
  else if (patternType === 'boxRangeLow') detail = detectBoxRangeLow_(daily);
  else if (patternType === 'goldPitReversal') detail = detectGoldPitReversal_(daily);
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
function fetchDailyOhlc_(code, pages) {
  var rows = [];
  var seen = {};

  for (var page = 1; page <= pages; page++) {
    try {
      var res = UrlFetchApp.fetch('https://finance.naver.com/item/sise_day.naver?code=' + code + '&page=' + page, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.getResponseCode() !== 200) continue;
      var html = res.getContentText('EUC-KR');
      parseSiseDayRows_(html).forEach(function (row) {
        if (!seen[row.date]) { seen[row.date] = true; rows.push(row); }
      });
    } catch (err) {
      continue; // 이 페이지만 스킵
    }
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

// 저점상승형: 스윙 저점 3개 이상이 순서대로 상승(첫-끝 3%+ 차이, 쌍바닥과 구분) +
// 스윙 고점 3개 이상이 좁은 범위에 묶여있음(막힘) + 마지막 저점이 최근이고 아직 안 깨졌음.
function detectRisingLows_(daily) {
  var win = daily.slice(Math.max(0, daily.length - PATTERN_WINDOW));
  if (win.length < PATTERN_WINDOW) return null;

  var lowIdxs = findSwingIndices_(win, 'low', true);
  var highIdxs = findSwingIndices_(win, 'high', false);
  if (lowIdxs.length < WEDGE_MIN_SWINGS || highIdxs.length < WEDGE_MIN_SWINGS) return null;

  for (var i = 1; i < lowIdxs.length; i++) {
    var prevLow = win[lowIdxs[i - 1]].low;
    var curLow = win[lowIdxs[i]].low;
    if (curLow < prevLow * (1 + WEDGE_LOW_RISE_MIN)) return null;
  }

  for (var j = 1; j < highIdxs.length; j++) {
    var prevHigh = win[highIdxs[j - 1]].high;
    var curHigh = win[highIdxs[j]].high;
    if (curHigh > prevHigh * (1 + WEDGE_HIGH_CAP_MAX)) return null;
  }

  // 첫 저점 대비 마지막 저점이 충분히 높아야 "상승형" - 안 그러면 저점 2~3개가 거의 같은
  // 높이인 쌍바닥류 구조도 여기 걸려버림
  var firstLow = win[lowIdxs[0]].low;
  var lastLow = win[lowIdxs[lowIdxs.length - 1]].low;
  if ((lastLow - firstLow) / firstLow < WEDGE_MIN_TOTAL_RISE) return null;

  var firstIdx = Math.min(lowIdxs[0], highIdxs[0]);
  var lastIdx = Math.max(lowIdxs[lowIdxs.length - 1], highIdxs[highIdxs.length - 1]);
  if (lastIdx - firstIdx < WEDGE_MIN_SPAN_DAYS) return null;

  // 최근성: 마지막 저점이 최근 RECENCY_MAX_GAP거래일 안이어야 "지금" 진행 중인 패턴
  var lastLowIdx = lowIdxs[lowIdxs.length - 1];
  if ((win.length - 1) - lastLowIdx > RECENCY_MAX_GAP) return null;

  var resistance = Math.max.apply(null, highIdxs.map(function (idx) { return win[idx].high; }));
  var lastClose = win[win.length - 1].close;

  // 마지막 저점 이후 그 저점을 다시 깨고 내려갔으면(스윙으로는 아직 안 잡혀도) 무효
  if (lastClose < lastLow * 0.98) return null;

  var lowSwingPoints = lowIdxs.map(function (idx) { return { date: win[idx].date, price: win[idx].low }; });
  var current = { date: win[win.length - 1].date, price: lastClose };

  // ---- 점수(100점): 저점상승폭40 + 저점간격20 + 5일선저항20 + 거래량감소10 + 최근양봉10 ----
  var riseRatio = (lastLow - firstLow) / firstLow;
  var riseScore = scoreTier_(riseRatio, [
    { min: 0.08, score: 40 }, { min: 0.05, score: 30 }, { min: WEDGE_MIN_TOTAL_RISE, score: 20 }
  ]);

  var lowSpan = lastLowIdx - lowIdxs[0];
  var spanScore = (lowSpan >= 5 && lowSpan <= 20) ? 20 : 10;

  var ma5 = movingAverage_(win, 'close', 5);
  var resistanceIdx = highIdxs[highIdxs.length - 1];
  var ma5AtResistance = ma5[resistanceIdx];
  var ma5Diff = ma5AtResistance ? Math.abs(win[resistanceIdx].high - ma5AtResistance) / ma5AtResistance : 1;
  var ma5Score = ma5Diff <= 0.02 ? 20 : ma5Diff <= 0.05 ? 10 : 0;

  var volScore = isVolumeDeclining_(win, lowIdxs[0], win.length) ? 10 : 0;
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
    breakout: lastClose > resistance * BREAKOUT_TOL,
    score: score,
    reasons: reasons,
    interpretation: '저점이 ' + (riseRatio * 100).toFixed(1) + '% 높아지며 하락 압력이 약해지는 구간으로 추정됩니다(' + score + '점).'
  };
}

// 쌍바닥: 비슷한 높이의 저점 2개 + 그 사이에 충분히 반등한 고점(넥라인) +
// 두번째 저점이 최근이고, 현재가가 넥라인에 근접(너무 멀지 않음)해야 "확인" 단계로 인정.
function detectDoubleBottom_(daily) {
  var win = daily.slice(Math.max(0, daily.length - PATTERN_WINDOW));
  var lowIdxs = findSwingIndices_(win, 'low', true);
  if (lowIdxs.length < 2) return null;

  for (var a = 0; a < lowIdxs.length - 1; a++) {
    for (var b = a + 1; b < lowIdxs.length; b++) {
      var i1 = lowIdxs[a], i2 = lowIdxs[b];
      if (i2 - i1 < DB_MIN_GAP_DAYS) continue;
      if ((win.length - 1) - i2 > RECENCY_MAX_GAP) continue; // 두번째 저점이 너무 오래 전이면 스킵

      var low1 = win[i1].low, low2 = win[i2].low;
      var diff = Math.abs(low1 - low2) / Math.min(low1, low2);
      if (diff > DB_LOW_TOL) continue;

      var neck = maxHighBetween_(win, i1, i2);
      if (!neck) continue;
      var riseFromLow1 = (neck.high - low1) / low1;
      if (riseFromLow1 < DB_PEAK_MIN_RISE) continue;

      var lastClose = win[win.length - 1].close;
      var proximity = (lastClose - neck.high) / neck.high;
      if (proximity < DB_NECK_PROXIMITY_MIN) continue; // 넥라인에서 너무 멀면(반등이 약하면) 스킵

      var current = { date: win[win.length - 1].date, price: lastClose };

      // ---- 점수(100점): 저점유사도40 + 간격20 + 반등강도20 + 거래량10 + 넥라인10 ----
      var simScore = diff <= 0.01 ? 40 : diff <= DB_LOW_TOL ? 25 : 0;
      var gapDays = i2 - i1;
      var gapScore = (gapDays >= 10 && gapDays <= 40) ? 20 : 10;
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

// 역헤드앤숄더: 저점 3개(좌어깨-헤드-우어깨), 헤드가 가장 낮고 양 어깨는 비슷한 높이.
function detectInvHeadShoulders_(daily) {
  var win = daily.slice(Math.max(0, daily.length - PATTERN_WINDOW));
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
        if (proximity < DB_NECK_PROXIMITY_MIN) continue; // 넥라인에서 너무 멀면(우어깨 반등이 약하면) 스킵

        var current = { date: win[win.length - 1].date, price: lastClose };

        // ---- 점수(100점): 형태유사도50 + 넥라인20 + 대칭성20 + 거래량10 ----
        var headDropAvg = ((left - head) / left + (right - head) / right) / 2;
        var shapeScore = headDropAvg >= 0.05 ? 50 : headDropAvg >= 0.03 ? 35 : 20;
        var neckScoreIhs = proximity >= -0.02 ? 20 : 10;
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

// 박스권 하단: 고점끼리·저점끼리 각각 평평(횡보 레인지)하고, 폭이 충분히 넓으며,
// 현재가가 그 박스 하단(지지선) 근처에 있는 경우.
function detectBoxRangeLow_(daily) {
  var win = daily.slice(Math.max(0, daily.length - PATTERN_WINDOW));
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

// 골파기 후 추세 전환(MA60 기준, 초반 포착): 종가가 한동안 60일 이평 아래(하락추세)에
// 있다가 이평을 위로 막 돌파한 시점만 잡는다 - 랠리/눌림목까지 기다리면 이미 많이 오른
// 뒤라 늦은 신호가 되므로, 돌파가 "최근 며칠 안"일 때만 인정(V자 바닥 초반 포착).
// daily는 GOLD_PAGES(9페이지 ≈ 90영업일)로 크롤링한, MA60 계산 여유가 있는 긴 시리즈여야 한다.
function detectGoldPitReversal_(daily) {
  var period = GOLD_MA_PERIOD;
  var win = daily.slice(Math.max(0, daily.length - GOLD_WINDOW));
  var n = win.length;
  if (n < period + 15) return null;

  // 60일 이동평균 시리즈 계산 (인덱스 period-1부터 값이 생김)
  var ma = new Array(n).fill(null);
  var sum = 0;
  for (var i = 0; i < n; i++) {
    sum += win[i].close;
    if (i >= period) sum -= win[i - period].close;
    if (i >= period - 1) ma[i] = sum / period;
  }

  // 하락추세->상승추세 전환(종가가 MA60 아래에서 위로 올라선) 지점 탐색.
  // 최근 RECENCY_MAX_GAP거래일 안에서만 찾는다 - 그보다 오래됐으면 "초반"이 아니므로 제외.
  // ma[j-1]이 null이 아니려면 j-1 >= period-1 즉 j >= period부터 검사해야 함(>만 쓰면 j===period를 놓침).
  var crossIdx = -1;
  for (var j = n - 1; j >= period; j--) {
    if ((n - 1) - j > RECENCY_MAX_GAP) break;
    if (ma[j] == null || ma[j - 1] == null) continue;
    if (win[j - 1].close < ma[j - 1] && win[j].close >= ma[j]) { crossIdx = j; break; }
  }
  if (crossIdx === -1) return null;

  // 전환 직전 GOLD_TREND_LOOKBACK봉 중 다수가 MA60 아래였어야 "하락추세에서의 전환"으로 인정
  var belowCount = 0, checked = 0;
  for (var k = Math.max(period - 1, crossIdx - GOLD_TREND_LOOKBACK); k < crossIdx; k++) {
    if (ma[k] == null) continue;
    checked++;
    if (win[k].close < ma[k]) belowCount++;
  }
  if (checked === 0 || belowCount / checked < GOLD_TREND_BELOW_RATIO) return null;

  // 돌파 이후 지금까지 이평 아래로 다시 꺼지지 않았는지(전환이 바로 무효화된 건 아닌지)만 확인
  var lastClose = win[n - 1].close;
  for (var m = crossIdx; m < n; m++) {
    if (ma[m] != null && win[m].close < ma[m] * 0.99) return null;
  }

  // ---- 점수(100점, 지시서 5종 외 패턴이라 이 구현에서 자체 배점): 하락추세강도40 +
  // 돌파초반도(최근일수록 고득점)30 + 상승모멘텀(과열아님)20 + 거래량10 ----
  var belowRatio = belowCount / checked;
  var trendScore = belowRatio >= 0.8 ? 40 : belowRatio >= GOLD_TREND_BELOW_RATIO ? 25 : 0;
  var gapFromCross = (n - 1) - crossIdx;
  var earlyScore = gapFromCross <= 1 ? 30 : gapFromCross <= RECENCY_MAX_GAP ? 18 : 0;
  var momentum = ma[n - 1] ? (lastClose - ma[n - 1]) / ma[n - 1] : 0;
  var momentumScore = (momentum >= 0 && momentum <= 0.03) ? 20 : (momentum > 0.03 && momentum <= 0.06) ? 10 : 0;
  var volScore = win[crossIdx].volume > avgVolume_(win, Math.max(0, crossIdx - 20), crossIdx) ? 10 : 0;

  var score = clampScore_(trendScore + earlyScore + momentumScore + volScore);
  var reasons = [
    '전환 전 하락추세 비율 ' + (belowRatio * 100).toFixed(0) + '%(' + trendScore + '/40점)',
    'MA60 돌파 후 ' + gapFromCross + '거래일 경과(' + earlyScore + '/30점)',
    'MA60 이격도 ' + (momentum * 100).toFixed(1) + '%(' + momentumScore + '/20점)',
    '돌파일 거래량 ' + (volScore ? '증가' : '평이') + '(' + volScore + '/10점)'
  ];

  return {
    ma_period: period,
    cross: { date: win[crossIdx].date, price: win[crossIdx].close },
    current: { date: win[n - 1].date, price: lastClose },
    signal: { date: win[n - 1].date, price: lastClose },
    breakout: false,
    score: score,
    reasons: reasons,
    interpretation: '장기 하락추세(전환 전 하락 비율 ' + (belowRatio * 100).toFixed(0) + '%) 이후 60일선을 막 돌파한 초기 구간으로 추정됩니다(' + score + '점).'
  };
}

// 눌림목: 최근 20거래일 중 15% 이상 상승한 뒤, 고점 대비 5~15% 조정을 받고
// 20일선 또는 60일선 ±3% 부근까지 내려온 구간. MA60이 필요해 골파기와 같은 긴
// 윈도(PULLBACK_WINDOW≈90영업일, 9페이지 크롤링)를 쓴다.
var PULLBACK_WINDOW = 90;
var PULLBACK_PAGES = 9;
var PULLBACK_LOOKBACK = 20;     // "최근 20거래일" 안에서 고점을 찾음
var PULLBACK_MIN_RISE = 0.15;   // 저점->고점 15% 이상 상승
var PULLBACK_MIN_DROP = 0.05;   // 고점 대비 조정폭 하한 5%
var PULLBACK_MAX_DROP = 0.15;   // 조정폭 상한 15%
var PULLBACK_MA_TOL = 0.03;     // 20일선/60일선 ±3%
var PULLBACK_TIME_BUDGET_MS = 5 * 60 * 1000;

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
