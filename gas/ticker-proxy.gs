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

  if (params.bubble === '1') {
    return jsonResponse(getMarketcapBubble());
  }

  if (params.action === 'foreignFlow') {
    return jsonResponse(getForeignFlow((params.code || '').trim()));
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

// 시가총액 버블차트 (코스피20/코스닥15/ETF10 + 삼성전자·SK하이닉스 단일종목레버리지 합산).
// data/marketcap-codes.js와 종목 구성이 동일해야 함 - 종목 교체 시 두 파일 다 수정.
// SERVICE_ITEM 쿼리는 시가총액 필드가 없어 countOfListedStock(상장주식수) x nv(현재가)로 계산.
// (KODEX 200으로 검증: /api/realtime/domestic/stock/ 의 marketValueFullRaw와 정확히 일치)
var MARKETCAP_CODES = {
  KOSPI: ['005930', '000660', '402340', '005935', '009150', '005380', '373220', '032830', '028260', '207940',
          '000270', '105560', '329180', '012450', '055550', '034020', '012330', '034730', '068270', '086790'],
  KOSDAQ: ['196170', '247540', '086520', '277810', '036930', '950160', '028300', '058470', '240810', '298380',
           '141080', '000250', '319660', '039030', '222800'],
  ETF: ['069500', '360750', '133690', '102110', '396500', '122630', '233740', '229200', '411060', '091160'],
  LEV_SAMSUNG: ['0193W0', '0195R0', '0194M0', '0192M0', '0193K0', '0194N0', '0198B0'],
  LEV_HYNIX: ['0193T0', '0195S0', '0194T0', '0192L0', '0197W0', '0194R0', '0198D0']
};
var MARKETCAP_BATCH_SIZE = 40; // Naver polling API 배치 크기 - 40개까지 안정적으로 검증됨

function getMarketcapBubble() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CACHE_PREFIX + 'bubble_v1';
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var allCodes = [].concat(
    MARKETCAP_CODES.KOSPI, MARKETCAP_CODES.KOSDAQ, MARKETCAP_CODES.ETF,
    MARKETCAP_CODES.LEV_SAMSUNG, MARKETCAP_CODES.LEV_HYNIX
  );
  var quoteByCode = fetchQuotesWithCap(allCodes);

  var result = {
    updatedAt: formatKstTime(Date.now()),
    data: {
      KOSPI: pickQuotes(MARKETCAP_CODES.KOSPI, quoteByCode),
      KOSDAQ: pickQuotes(MARKETCAP_CODES.KOSDAQ, quoteByCode),
      ETF: pickQuotes(MARKETCAP_CODES.ETF, quoteByCode),
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
// 차트 패턴 스캔: 저점상승형(ascending) / 쌍바닥(double bottom) / 역헤드앤숄더.
// 섹터 대시보드 종목 풀(GitHub Pages의 data/sectors-v3.js)을 그때그때 fetch해서
// 스캔 대상으로 재사용 - 별도 종목 리스트를 GAS에 하드코딩하지 않는다.
// 하루 1회 시간 트리거(scanChartPatterns)로 스캔해 PropertiesService에 저장하고,
// 블로그는 캐싱된 결과만 읽는다(방문자가 몰려도 매번 재스캔하지 않음).
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

var GOLD_DROP_MIN = 0.15;        // 골파기: 직전 고점 대비 저점까지 최소 15% 하락
var GOLD_RECOVER_MIN = 0.05;     // 저점 대비 랠리고점까지 최소 5% 반등해야 유효
var GOLD_MIN_DAYS_SINCE_TROUGH = 3; // 저점->랠리고점까지 최소 3거래일 지나야 반등 확인 가능
var GOLD_REBREAK_TOL = 0.98;     // 저점 형성 후 이 비율 밑으로 다시 빠지면(저점 재이탈) 무효
var GOLD_PULLBACK_MAX = 0.15;    // 랠리고점 대비 눌림폭 15% 이내여야 "눌림목"으로 인정(너무 깊으면 재붕괴로 간주)

var BREAKOUT_TOL = 1.02;         // 저항선/넥라인을 2% 넘게 뚫었으면 "이미 지나간 패턴"으로 제외

function scanChartPatterns() {
  var startedAt = Date.now();
  var universe = fetchSectorUniverse_();
  var results = { risingLows: [], doubleBottom: [], invHeadShoulders: [], boxRangeLow: [], goldPitReversal: [] };
  var scanned = 0;

  for (var i = 0; i < universe.length; i++) {
    if (Date.now() - startedAt > PATTERN_TIME_BUDGET_MS) break; // 시간 초과 시 지금까지 결과로 저장하고 중단

    var stock = universe[i];
    try {
      var daily = fetchDailyOhlc_(stock.code, PATTERN_PAGES);
      if (daily.length < 15) continue;
      scanned++;

      var rl = detectRisingLows_(daily);
      if (rl && !rl.breakout && results.risingLows.length < PATTERN_MAX_MATCHES) {
        results.risingLows.push(buildPatternMatch_(stock, daily));
      }

      var db = detectDoubleBottom_(daily);
      if (db && !db.breakout && results.doubleBottom.length < PATTERN_MAX_MATCHES) {
        results.doubleBottom.push(buildPatternMatch_(stock, daily));
      }

      var ihs = detectInvHeadShoulders_(daily);
      if (ihs && !ihs.breakout && results.invHeadShoulders.length < PATTERN_MAX_MATCHES) {
        results.invHeadShoulders.push(buildPatternMatch_(stock, daily));
      }

      var box = detectBoxRangeLow_(daily);
      if (box && results.boxRangeLow.length < PATTERN_MAX_MATCHES) {
        results.boxRangeLow.push(buildPatternMatch_(stock, daily));
      }

      var gold = detectGoldPitReversal_(daily);
      if (gold && results.goldPitReversal.length < PATTERN_MAX_MATCHES) {
        results.goldPitReversal.push(buildPatternMatch_(stock, daily));
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
    PATTERN_SCAN_BOX: JSON.stringify(results.boxRangeLow),
    PATTERN_SCAN_GOLD: JSON.stringify(results.goldPitReversal)
  });

  return results;
}

// 이 함수를 스크립트 편집기에서 한 번 실행하면 매일 자동 스캔 트리거가 설치된다.
// (배포와 별개 - 트리거는 코드 push/재배포로 자동 설치되지 않으므로 최초 1회 수동 실행 필요)
function setupPatternScanTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scanChartPatterns') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scanChartPatterns')
    .timeBased()
    .atHour(16) // 장마감(15:30) 이후 여유 두고 16시(Asia/Seoul, 스크립트 기본 시간대 기준)
    .everyDays(1)
    .create();
}

function getPatternScanResult() {
  var props = PropertiesService.getScriptProperties();
  var meta = props.getProperty('PATTERN_SCAN_META');
  return {
    scannedAt: meta ? JSON.parse(meta).scannedAt : null,
    universe: meta ? JSON.parse(meta).universe : 0,
    scanned: meta ? JSON.parse(meta).scanned : 0,
    patterns: {
      risingLows: JSON.parse(props.getProperty('PATTERN_SCAN_RISING') || '[]'),
      doubleBottom: JSON.parse(props.getProperty('PATTERN_SCAN_DB') || '[]'),
      invHeadShoulders: JSON.parse(props.getProperty('PATTERN_SCAN_IHS') || '[]'),
      boxRangeLow: JSON.parse(props.getProperty('PATTERN_SCAN_BOX') || '[]'),
      goldPitReversal: JSON.parse(props.getProperty('PATTERN_SCAN_GOLD') || '[]')
    }
  };
}

// 클릭 시 온디맨드 차트: 그 종목만 다시 크롤링해서 캔들 데이터 + 패턴 좌표를 반환.
// (스캔 결과에는 캔들 전체를 저장하지 않음 - PropertiesService 9KB/속성 제한 때문)
function getPatternChart(code, patternType) {
  if (!/^[0-9A-Za-z]{6}$/i.test(code)) {
    return { error: 'INVALID_CODE', message: '6자리 종목코드가 필요합니다.' };
  }

  var daily = fetchDailyOhlc_(code, PATTERN_PAGES);
  if (daily.length < 15) {
    return { error: 'NO_DATA', message: '일봉 데이터를 가져오지 못했습니다.' };
  }

  var detail = null;
  if (patternType === 'risingLows') detail = detectRisingLows_(daily);
  else if (patternType === 'doubleBottom') detail = detectDoubleBottom_(daily);
  else if (patternType === 'invHeadShoulders') detail = detectInvHeadShoulders_(daily);
  else if (patternType === 'boxRangeLow') detail = detectBoxRangeLow_(daily);
  else if (patternType === 'goldPitReversal') detail = detectGoldPitReversal_(daily);

  return { code: code.toUpperCase(), daily: daily, pattern: patternType, detail: detail };
}

function buildPatternMatch_(stock, daily) {
  var last = daily[daily.length - 1];
  var prev = daily.length > 1 ? daily[daily.length - 2] : null;
  var changeRate = (prev && prev.close) ? ((last.close - prev.close) / prev.close * 100) : null;
  return {
    code: stock.code,
    name: stock.name,
    price: last.close,
    changeRate: changeRate,
    date: last.date
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

  return {
    low_swings: lowSwingPoints,
    // 라인은 마지막 스윙 저점에서 끊기지 않고 오늘(현재가)까지 이어서 그린다 -
    // "이미 지나간 패턴"처럼 보이지 않게 하기 위함
    low_swings_display: lowSwingPoints.concat([current]),
    high_swings: highIdxs.map(function (idx) { return { date: win[idx].date, price: win[idx].high }; }),
    resistance: resistance,
    signal: current, // 확인 지점은 항상 "오늘"
    breakout: lastClose > resistance * BREAKOUT_TOL
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
      return {
        low1: { date: win[i1].date, price: low1 },
        low2: { date: win[i2].date, price: low2 },
        neckline: { date: neck.date, price: neck.high },
        current: current, // 저점2 이후 현재가까지 이어야 진짜 W(두번째 상승 다리)가 됨
        signal: current,  // 확인 지점은 항상 "오늘"
        breakout: lastClose > neck.high * BREAKOUT_TOL
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
        return {
          left_shoulder: { date: win[iL].date, price: left },
          left_peak: { date: peak1.date, price: peak1.high },
          head: { date: win[iH].date, price: head },
          right_peak: { date: peak2.date, price: peak2.high },
          right_shoulder: { date: win[iR].date, price: right },
          neckline: { date: necklinePoint.date, price: necklinePrice },
          current: current, // 우어깨 이후 현재가까지 이어서 패턴이 "지금도 진행 중"임을 보여줌
          signal: current,  // 확인 지점은 항상 "오늘"
          breakout: lastClose > necklinePrice * BREAKOUT_TOL
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

  return {
    support: support,
    resistance: resistance,
    low_swings: lowIdxs.map(function (i) { return { date: win[i].date, price: win[i].low }; }),
    high_swings: highIdxs.map(function (i) { return { date: win[i].date, price: win[i].high }; }),
    signal: { date: win[win.length - 1].date, price: lastClose },
    breakout: false
  };
}

// 골파기 후 추세 전환: 직전 고점 대비 큰 폭 하락(골) -> 랠리(반등 고점) -> 눌림목(현재가)
// 3단 구조. "그냥 반등"이 아니라 반등 후 되돌림이 들어와 있는 지점(매수 검토 구간)까지 확인한다.
function detectGoldPitReversal_(daily) {
  var win = daily.slice(Math.max(0, daily.length - PATTERN_WINDOW));
  var n = win.length;
  if (n < 15) return null;

  // 저점(골)은 최근 구간을 제외한 앞 75% 안에서 찾는다 - 랠리+눌림목이 들어갈 자리를 남겨둬야 함
  var searchEnd = Math.floor(n * 0.75);
  var troughIdx = 0;
  for (var i = 1; i < searchEnd; i++) if (win[i].low < win[troughIdx].low) troughIdx = i;
  var troughLow = win[troughIdx].low;

  var preHighIdx = 0;
  for (var j = 0; j <= troughIdx; j++) if (win[j].high > win[preHighIdx].high) preHighIdx = j;
  var preHigh = win[preHighIdx].high;

  var dropPct = (preHigh - troughLow) / preHigh;
  if (dropPct < GOLD_DROP_MIN) return null;

  // 저점 이후 랠리 고점(반등 최고점) 탐색
  var rallyPeakIdx = troughIdx;
  for (var k = troughIdx + 1; k < n; k++) if (win[k].high > win[rallyPeakIdx].high) rallyPeakIdx = k;
  if (rallyPeakIdx <= troughIdx) return null;
  if (rallyPeakIdx - troughIdx < GOLD_MIN_DAYS_SINCE_TROUGH) return null;
  if (rallyPeakIdx >= n - 1) return null; // 랠리 고점이 마지막 봉이면 아직 눌림목이 나오기 전

  var rallyPeak = win[rallyPeakIdx].high;
  var rallyPct = (rallyPeak - troughLow) / troughLow;
  if (rallyPct < GOLD_RECOVER_MIN) return null;

  // 랠리 고점 이후 저점을 재이탈하지 않았는지 확인
  for (var m = troughIdx + 1; m < n; m++) {
    if (win[m].low < troughLow * GOLD_REBREAK_TOL) return null;
  }

  // 눌림목: 현재가가 랠리 고점보다는 낮고(=신고가 갱신 중이 아니고) 저점보다는 높아야 함
  var lastClose = win[n - 1].close;
  if (lastClose >= rallyPeak) return null;
  if (lastClose <= troughLow) return null;

  var pullbackPct = (rallyPeak - lastClose) / rallyPeak;
  if (pullbackPct > GOLD_PULLBACK_MAX) return null; // 눌림이 너무 깊으면 재붕괴 우려로 제외

  return {
    pre_high: { date: win[preHighIdx].date, price: preHigh },
    trough: { date: win[troughIdx].date, price: troughLow },
    rally_peak: { date: win[rallyPeakIdx].date, price: rallyPeak },
    pullback: { date: win[n - 1].date, price: lastClose },
    signal: { date: win[n - 1].date, price: lastClose },
    drop_pct: dropPct,
    rally_pct: rallyPct,
    pullback_pct: pullbackPct,
    breakout: false
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
