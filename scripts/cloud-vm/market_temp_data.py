# -*- coding: utf-8 -*-
"""증시온도 데이터 수집 - gas/ticker-proxy.gs getMarketTemp()의 입력 수집부 이식.

`docs/BACKEND_CONSOLIDATION.md` 1-b단계. 배점은 `market_temp_score.py`가 이미 이식했고
(GAS 응답과 12건 일치 확인) 이 파일은 그 배점에 넣을 값을 모은다.

**VM에 이미 있는 것은 다시 안 받는다** - 이게 이번 일원화의 핵심이다:

| 입력 | GAS가 받던 곳 | VM에서 쓰는 곳 |
|---|---|---|
| VIX | Yahoo `^VIX` | `foreign_futures.py` 폴러가 이미 수집(.VIX) → DB |
| S&P500 선물 | Yahoo `ES=F` | `foreign_futures.py` 폴러(EScv1) → DB |
| 원/달러 | 네이버 marketindex | `domestic_futures.py` 폴러(FX_USDKRW) → DB, **GAS와 같은 소스** |
| 52주 신고저 | VM `/week52-batch` 호출 | 같은 캐시를 직접 읽음 |
| 신용융자 | VM `/kofia-market` 호출 | 같은 모듈을 직접 호출 |
| 섹터 유니버스 | GitHub Pages fetch | `sector_cards.load_static_sector_map()` 로컬 파일 |
| 전종목 시세 | 네이버 polling API | 동일 API(여기서 신규 수집) |
| 수급(KODEX200) | 네이버 종목별 외국인/기관 | 동일(여기서 신규 수집) |

즉 새로 받는 건 시세와 수급 둘뿐이고 나머지 5종은 이미 VM 안에 있다. GAS가 VM을 부르던
홉(`fetchKofiaMarketFromVm_`, `computeWeek52Score_`)이 그대로 사라진다.

**알려진 차이(의도적)**: VIX와 S&P500 선물의 출처가 Yahoo → 네이버로 바뀐다. 같은 지수라
값은 거의 같지만 소수점이 달라 배점 경계(VIX 15/20/25/30)를 스칠 수 있다. 외부 호출을
새로 늘리지 않으려고 기존 폴러 데이터를 쓰기로 했고, 종단 비교에서 점수가 갈리면
경계값 때문인지 먼저 확인할 것.
"""

import json
import logging
import os
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import market_temp_score as score

LOGGER = logging.getLogger('market_temp')

NAVER_POLLING_URL = 'https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:'
NAVER_BATCH_SIZE = 40      # GAS MARKETCAP_BATCH_SIZE - 40개까지 안정 검증된 값
NAVER_MAX_WORKERS = 8      # GAS는 fetchAll 15개씩 - VM은 스레드라 보수적으로 잡는다
HTTP_TIMEOUT = 12
FLOW_CODE = '069500'       # KODEX 200 - 코스피200 추종 ETF, 수급 대리지표(GAS MT_FLOW_CODE)
USER_AGENT = 'tistory-ticker/1.0'


def _get_json(url, timeout=HTTP_TIMEOUT, encoding='utf-8'):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            return None
        return json.loads(response.read().decode(encoding, 'replace'))


# ---- 전종목 시세 ----

def _parse_naver_batch(body):
    """네이버 polling 응답 한 배치를 표준 형태로 편다.

    GAS applyNxtOverride_(장 종료 후 NXT 시간외 단일가 우선)는 여기선 적용하지 않는다 -
    증시온도는 정규장 기준 지표이고, 시간외 가격을 섞으면 GAS와 값이 갈린다.
    (GAS도 isMarketOpenNow()가 참이면 그대로 쓰므로 장중에는 동일하다.)
    """
    areas = ((body or {}).get('result') or {}).get('areas') or []
    item_area = next((a for a in areas if a.get('name') == 'SERVICE_ITEM'), None)
    rows = []
    for d in (item_area or {}).get('datas') or []:
        sign = -1 if d.get('rf') in ('4', '5') else 1
        try:
            price = float(d.get('nv') or 0)
            change = abs(float(d.get('cv') or 0)) * sign
            change_rate = abs(float(d.get('cr') or 0)) * sign
            volume = float(d.get('aq') or 0)
        except (TypeError, ValueError):
            continue
        rows.append({'code': d.get('cd'), 'name': d.get('nm'), 'price': price,
                     'change': change, 'changeRate': change_rate, 'volume': volume})
    return rows


def fetch_quotes(codes):
    """전종목 현재가/등락률/거래량. 실패한 배치는 건너뛰고 나머지는 유지한다."""
    batches = [codes[i:i + NAVER_BATCH_SIZE] for i in range(0, len(codes), NAVER_BATCH_SIZE)]
    out = []

    def one(batch):
        url = NAVER_POLLING_URL + urllib.parse.quote(','.join(batch), safe=',')
        try:
            return _parse_naver_batch(_get_json(url, encoding='euc-kr'))
        except Exception:
            LOGGER.debug('naver polling batch failed', exc_info=True)
            return []

    with ThreadPoolExecutor(max_workers=NAVER_MAX_WORKERS) as pool:
        for rows in pool.map(one, batches):
            out.extend(rows)
    return out


# ---- 컴포넌트 조립 ----

def build_quote_components(quotes, universe_with_sectors, prior_trading_values):
    """시세 하나로 나오는 4개 컴포넌트(거래대금·평균등락·상승비율·섹터강세)를 만든다."""
    today_value = sum((q.get('price') or 0) * (q.get('volume') or 0) for q in quotes)
    trading_value = score.score_trading_value(today_value, prior_trading_values)

    if quotes:
        avg = sum(q.get('changeRate') or 0 for q in quotes) / len(quotes)
        avg_change = score.score_avg_change(avg, len(quotes))
    else:
        avg_change = score.score_avg_change(0, 0)

    up = sum(1 for q in quotes if (q.get('change') or 0) > 0)
    down = sum(1 for q in quotes if (q.get('change') or 0) < 0)
    rise_ratio = score.score_rise_ratio(up, down)

    by_code = {q['code']: q for q in quotes if q.get('code')}
    by_sector = {}
    for u in universe_with_sectors:
        q = by_code.get(u.get('code'))
        if not q:
            continue
        for sector in u.get('sectors') or []:
            bucket = by_sector.setdefault(sector, {'up': 0, 'down': 0, 'sum_change': 0.0, 'total': 0})
            bucket['total'] += 1
            bucket['sum_change'] += q.get('changeRate') or 0
            if (q.get('change') or 0) > 0:
                bucket['up'] += 1
            elif (q.get('change') or 0) < 0:
                bucket['down'] += 1

    strong = 0
    for bucket in by_sector.values():
        avg_change_sector = bucket['sum_change'] / bucket['total'] if bucket['total'] else 0
        rise = bucket['up'] / bucket['total'] if bucket['total'] else 0
        if avg_change_sector > 0:
            strong += 1
        if rise >= 0.5:
            strong += 1
    sector_strength = score.score_sector_strength(len(by_sector), strong)

    return {
        'tradingValue': trading_value,
        'avgChange': avg_change,
        'riseRatio': rise_ratio,
        'sectorStrength': sector_strength,
        'todayTradingValue': today_value,
    }


def prior_trading_values(conn, codes, today_kst, limit=5):
    """직전 거래일들의 유니버스 총 거래대금을 `daily_prices`에서 재구성한다.

    GAS는 이 이력을 `PropertiesService`에 직접 쌓아뒀고(`mt_vol_hist_v2`), 그래서 VM으로
    옮기면 이력이 비어 3영업일간 중립(7.5)이 나오는 줄 알았다. 그런데 `daily_scan.py`가
    이미 **KRX 전종목 일봉을 daily_prices에 넣고 있어** 같은 값을 그냥 계산해낼 수 있다 -
    이관도, 중립 기간도 필요 없다. 오히려 GAS 쪽이 프로퍼티가 초기화되면 이력을 잃는
    구조라 이쪽이 더 튼튼하다.

    `today_kst` 당일은 제외한다(GAS도 오늘을 뺀 직전 5거래일 평균을 쓴다).
    종가×거래량이라 마감된 날 기준이고, 오늘치는 장중 시세로 따로 계산해 비교한다.
    """
    if not codes:
        return []
    placeholders = ','.join('?' * len(codes))
    rows = conn.execute(
        'SELECT date, SUM(close * volume) AS total FROM daily_prices '
        'WHERE code IN (%s) AND date < ? AND close IS NOT NULL AND volume IS NOT NULL '
        'GROUP BY date ORDER BY date DESC LIMIT ?' % placeholders,
        list(codes) + [today_kst, int(limit)],
    ).fetchall()
    # 최신순으로 뽑았으니 되돌려 오래된 날부터 담는다(평균만 쓰므로 순서는 무해하지만
    # 로그·디버깅에서 날짜 순서가 뒤집혀 보이지 않게 한다).
    totals = [r[1] for r in rows if r[1]]
    totals.reverse()
    return totals


def us_futures_time_weight(now_kst=None):
    """미국 선물 반영 가중치(GAS usFuturesTimeWeight_ 그대로).

    국내 장이 열려 있는 동안만 미국 선물을 반영하고, 시간이 갈수록 비중을 줄인다.
    15:30 이후엔 None - 호출부가 중립(2.5)으로 처리한다.
    """
    import datetime
    if now_kst is None:
        now_kst = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    hm = now_kst.hour * 100 + now_kst.minute
    if hm < 1100:
        return 1.0
    if hm < 1300:
        return 0.7
    if hm < 1530:
        return 0.3
    return None


def market_components_from_db(conn, now_kst=None):
    """VIX·원달러·미국선물 - 이미 폴러가 DB에 넣어둔 값을 읽어 점수만 낸다.

    GAS는 이 셋을 Yahoo/네이버에서 매번 새로 받았다. VM은 `foreign_futures.py`와
    `domestic_futures.py`가 상시 폴링해 `future_prices`에 넣고 있으므로 읽기만 하면 된다
    (외부 왕복 3회 제거). 원달러는 GAS와 **같은 소스**(네이버 marketindex)라 값이 같고,
    VIX·S&P500 선물만 Yahoo → 네이버로 출처가 바뀐다(문서의 "알려진 차이" 참고).
    """
    import db_schema
    prices = {p['symbol']: p for p in db_schema.load_all_future_prices(conn)}

    vix_row = prices.get('VIX') or {}
    vix = score.score_vix(vix_row.get('price'))

    # 원/달러는 DB 값이 뒤처질 수 있다. `/futures`가 이미 같은 함정을 알고 우회하고 있다
    # (main.py: "DB 수집 주기 사이에 이전 고시값을 내보내면 두 화면이 1416/1418처럼
    #  갈라지므로") - 실제로 종단 비교에서 VM 1418.5 vs GAS 1368.4로 50원이나 벌어졌다.
    # 같은 방식으로 실시간 고시값을 한 번 보강하고, 실패하면 DB 값으로 떨어진다.
    fx_row = prices.get('USDKRW') or {}
    fx_price = fx_row.get('price')
    fx_change_rate = fx_row.get('change_rate')
    try:
        import domestic_futures
        live_fx = domestic_futures.fetch_fx_realtime()
        if live_fx and live_fx.get('change_rate') is not None:
            fx_price = live_fx.get('price', fx_price)
            fx_change_rate = live_fx.get('change_rate')
    except Exception:
        LOGGER.debug('USDKRW 실시간 고시 조회 실패 - DB 값 사용', exc_info=True)
    exchange = score.score_exchange(fx_change_rate, fx_price)

    sp_row = prices.get('SP500') or {}
    weight = us_futures_time_weight(now_kst)
    us_futures = score.score_us_futures(sp_row.get('change_rate'), sp_row.get('price'), weight)

    return {'vix': vix, 'exchange': exchange, 'usFutures': us_futures}


def week52_component(cache_file):
    """52주 신고가/신저가 - `week52_scan.py`가 만든 캐시 파일을 직접 읽는다.

    GAS는 이걸 VM `/week52-batch`를 HTTP로 불러 썼다(브라우저 → GAS → VM). 같은 프로세스
    안이니 파일을 그대로 읽으면 홉이 사라진다.
    """
    try:
        with open(cache_file, 'r', encoding='utf-8') as fh:
            cached = json.load(fh)
    except (OSError, ValueError):
        return score.score_week52(None, None)
    return score.score_week52(cached.get('newHighCount'), cached.get('newLowCount'),
                              cached.get('scanned'))


def flow_ratio_from_daily(daily_nets, net5):
    """일별 순매매에서 -1~+1 순매수강도를 낸다(GAS computeFlowRatioFromData_ 그대로).

    최근 20일 |일별 순매매| 평균 × 5를 기준선으로 잡고, 5일 합산을 그 기준선으로 나눈다.
    즉 "평소 5일치만큼 샀으면 1.0"이라는 상대 강도다.
    """
    if not daily_nets:
        return None
    window = daily_nets[:20]
    avg_daily = sum(abs(v or 0) for v in window) / len(window) if window else 0
    baseline = avg_daily * 5
    if baseline <= 0:
        return {'ratio': 0, 'v5': net5}
    return {'ratio': max(-1.0, min(1.0, (net5 or 0) / baseline)), 'v5': net5}


def _flow_ratio_to_score100(ratio):
    """GAS flowRatioToScore100_ - 중립 50, ±1이 0/100."""
    if ratio is None:
        return 50
    return score._clamp(int(score._round_half_up(50 + ratio * 50)), 0, 100)


def flow_component(foreign_ratio, inst_ratio):
    """수급 - KODEX 200(069500) 기준, 외국인 75% + 기관 25% 가중합산."""
    return score.score_flow(_flow_ratio_to_score100(foreign_ratio),
                            _flow_ratio_to_score100(inst_ratio))


def _has_investor_data(row):
    """개인·외국인·기관이 **모두** 0/None인 행은 거래가 없는 자리표시자로 본다.

    2026-09-01 확인: `investor_trend_daily`에는 개장 전에도 당일 행이 0으로 들어가 있다
    (그날 06시에 조회하니 09.01이 0/0/0). 이 행을 그대로 두면 두 방향으로 어긋난다.
      - 5일 합산: 실질 4일치를 5일로 취급해 수급 신호가 희석된다.
      - 20일 기준선: 0을 한 날로 세어 평균 |순매매|가 낮아지고 비율이 부풀려진다.
    실제 거래일이 개인·외국인·기관 셋 다 정확히 0.0이 되는 일은 없으므로 이 조건으로
    자리표시자만 안전하게 걸러진다. 장이 열려 값이 들어오면 자연히 다시 포함된다.
    """
    return any((row.get(k) or 0) != 0 for k in ('ind', 'frgn', 'orgn'))


def flow_component_from_market_trend(conn, market='KOSPI'):
    """수급 - **시장 전체** 외국인/기관 순매매(investor_trend_daily)로 낸다.

    2026-09-01: GAS는 KODEX 200(069500) ETF를 시장 수급의 대리지표로 썼다. VM으로 옮기며
    같은 ETF를 KIS 종목별투자자매매동향으로 받아봤더니 **과거 이력을 주지 않았다**
    (64일 중 63일이 0, 오늘 장중 실시간 한 줄만 값이 있음). 그러면 기준선
    (최근 20일 |순매매| 평균 x5)이 무너져 비율이 항상 ±1.0으로 포화된다 -
    실제로 종단 비교에서 VM 15점 vs GAS 13점으로 갈렸다.

    ETF 하나를 대리로 쓴 건 GAS가 시장 전체 수급을 구할 방법이 없어서였다. VM에는
    `investor_trend_daily`에 코스피/코스닥 **시장 전체** 일별 수급이 최대 140행 쌓여 있고
    (`/investor-trend`가 이미 쓰는 데이터) 시장 전체 온도에는 이쪽이 개념적으로 맞다.
    배점 공식(20일 기준선, 외국인75%+기관25%)은 GAS 그대로 두고 입력만 바꾼다.

    사용자 승인 후 교체(2026-09-01). GAS와 수급 점수가 달라질 수 있고 그만큼 온도도
    바뀔 수 있다 - 더 정확해지는 방향이다.
    """
    import db_schema
    rows = db_schema.load_investor_trend_daily(conn, market, limit_days=40)
    rows = [r for r in rows if _has_investor_data(r)]
    if not rows:
        return flow_component(None, None), {'foreign': None, 'inst': None}
    recent = list(reversed(rows))          # 최신일 우선 - GAS daily 배열과 같은 순서
    ratios = {}
    for field, key in (('foreign', 'frgn'), ('inst', 'orgn')):
        nets = [r.get(key) for r in recent]
        net5 = sum(v for v in nets[:5] if v is not None)
        got = flow_ratio_from_daily(nets, net5)
        ratios[field] = got['ratio'] if got else None
        ratios[field + '_v5'] = net5
    component = flow_component(ratios['foreign'], ratios['inst'])
    component['foreign'] = {'score100': _flow_ratio_to_score100(ratios['foreign']),
                            'ratio': ratios['foreign'], 'v5': ratios['foreign_v5']}
    component['inst'] = {'score100': _flow_ratio_to_score100(ratios['inst']),
                         'ratio': ratios['inst'], 'v5': ratios['inst_v5']}
    component['note'] = ('코스피 시장 전체 5일 합산 수급 기준, 외국인75%+기관25% 가중합산'
                         '(GAS는 KODEX200 ETF 대리지표를 썼으나 과거 이력이 없어 교체)')
    return component, ratios


def universe_with_sectors():
    """`data/sectors-v3.js`에서 (코드, 업종목록)을 만든다 - GAS는 이 파일을 GitHub Pages에서
    받아왔지만 VM엔 저장소가 그대로 있으므로 로컬에서 읽는다."""
    import sector_cards
    parsed = sector_cards.load_static_sector_map()
    by_code = {}
    for category, stocks in (parsed or {}).items():
        for stock in stocks:
            code = stock.get('code')
            if not code:
                continue
            entry = by_code.setdefault(code, {'code': code, 'name': stock.get('name'),
                                              'market': stock.get('market'), 'sectors': []})
            if category not in entry['sectors']:
                entry['sectors'].append(category)
    return list(by_code.values())


# ---- 테마별 자금 흐름(증시온도 화면의 "오늘 업종 TOP") ----

# 테마가 아니라 시가총액 묶음인 카테고리. 거래대금 상위 종목이 그대로 모여 있어 매일
# 상단을 차지하는데, "오늘 어디로 돈이 도는가"에는 아무 정보가 없다(2026-09-01 사용자
# 지시 "3대장은 빼"). 우리가 관리하는 `data/sectors-v3.js`의 카테고리명이라 이름으로
# 거르는 게 취약하지 않다. 새 묶음이 생기면 여기에 추가한다.
BROAD_MARKET_BUCKETS = frozenset({'코스피 3대장'})


def build_industry_flow(quotes, universe, top_n=10, stocks_per=8):
    """테마별 거래대금·평균등락과 대표 종목을 만든다.

    2026-09-01 사용자 요청("TOP 10으로, 대표 종목이 너무 적어, 돈이 도는 흐름을 보고싶어").
    그때까지 화면은 `/market-board?limit=40`(거래대금 상위)을 브라우저가 테마로 묶어
    썼는데, 실측해보니 돌아오는 30종목 중 **17개가 ETF**(KODEX 200, TIGER 미국S&P500 등)라
    업종이 없어 통째로 버려지고 개별종목이 13개뿐이었다. 그래서 테마가 8개에 그치고
    테마당 종목도 1~3개였다. `market-board`의 limit 상한을 올리는 방법도 있지만 캐시
    키가 (시장, limit)이라 새 limit은 워머 밖이고, 방문자가 KIS 순위 조회와 종목별
    시세를 그만큼 더 물어야 한다.

    여기서는 증시온도가 이미 3분마다 받아두는 238종목(`data/sectors-v3.js`의 37개 테마)을
    그대로 재사용한다 - 외부 호출이 늘지 않는다.

    한 종목이 여러 테마에 속할 수 있다(238개 중 14개, 6%. 삼성전자=코스피 3대장+반도체).
    화면의 막대가 '1위 대비 비율'이라 합이 100%일 필요가 없으므로 중복을 그대로 각
    테마에 계상한다 - 어느 테마를 버릴지 임의로 정하지 않기 위해서다.
    """
    by_code = {q.get('code'): q for q in (quotes or []) if q.get('code')}
    groups = {}

    for entry in (universe or []):
        quote = by_code.get(entry.get('code'))
        if not quote:
            continue
        price = quote.get('price') or 0
        volume = quote.get('volume') or 0
        amount = price * volume
        if amount <= 0:
            continue
        for theme in (entry.get('sectors') or []):
            if theme in BROAD_MARKET_BUCKETS:
                continue
            group = groups.setdefault(theme, {'industry': theme, 'trade_amount': 0.0,
                                              'rate_total': 0.0, 'stock_count': 0, 'stocks': []})
            group['trade_amount'] += amount
            group['rate_total'] += quote.get('changeRate') or 0
            group['stock_count'] += 1
            group['stocks'].append({
                'code': entry.get('code'),
                'name': entry.get('name') or quote.get('name') or entry.get('code'),
                'price': price,
                'change_rate': quote.get('changeRate'),
                'trade_amount': amount,
            })

    rows = []
    for group in groups.values():
        group['stocks'].sort(key=lambda s: -(s['trade_amount'] or 0))
        rows.append({
            'industry': group['industry'],
            'trade_amount': group['trade_amount'],
            'avg_change_rate': (group['rate_total'] / group['stock_count']) if group['stock_count'] else 0,
            'stock_count': group['stock_count'],
            'stocks': group['stocks'][:max(1, int(stocks_per))],
        })
    rows.sort(key=lambda r: (-(r['trade_amount'] or 0), -(r['avg_change_rate'] or 0)))
    return rows[:max(1, int(top_n))]


BASELINE_DAYS = 20          # "평소"의 기준 창. 한 달 남짓 거래일.
MIN_BASELINE_DAYS = 5       # 이보다 이력이 적은 종목은 기준선에서 뺀다(신규 상장 등)


def baseline_trade_amounts(conn, codes, today_kst, days=BASELINE_DAYS):
    """종목별 '평소 하루 거래대금'(최근 days 거래일 평균)을 낸다.

    2026-09-02 사용자 요청("돈이 도는 흐름을 보고싶어"). 거래대금 절대액만 보면 덩치
    순서라 매일 같은 테마가 1등이고(반도체가 2위의 5배) 오늘 어디로 돈이 새로 들어왔는지는
    안 보인다. 오늘 값을 이 평소값으로 나누면 '평소의 몇 배'가 나와서 대형주 편향이 사라진다.

    오늘은 제외한다(장중이라 아직 안 끝났고, 비교 대상은 마감된 날들이다).
    종가×거래량이라 `prior_trading_values`와 같은 정의이며, 거기는 유니버스 합계를
    날짜별로 내는 반면 여기는 종목별 평균이 필요해 따로 둔다.
    """
    if not codes:
        return {}
    placeholders = ','.join('?' * len(codes))
    rows = conn.execute(
        'SELECT code, AVG(amt) AS avg_amt, COUNT(*) AS n FROM ('
        '  SELECT code, close * volume AS amt,'
        '         ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn'
        '  FROM daily_prices'
        '  WHERE code IN (%s) AND date < ? AND close IS NOT NULL AND volume IS NOT NULL'
        ') WHERE rn <= ? GROUP BY code' % placeholders,
        list(codes) + [today_kst, int(days)],
    ).fetchall()
    out = {}
    for code, avg_amt, n in rows:
        if avg_amt and n >= MIN_BASELINE_DAYS:
            out[code] = avg_amt
    return out


def attach_flow_multiple(rows, baselines):
    """테마별 '평소 대비 배수'를 붙인다.

    테마의 평소값 = 그 테마에 든 종목들의 평소 하루 거래대금 합. 오늘 값과 같은 종목
    집합으로 계산해야 비율이 성립하므로, 기준선이 없는 종목(신규 상장 등)은 오늘 값에서도
    빼고 비교한다 - 분자에만 있고 분모에 없으면 배수가 부풀려진다.
    """
    for row in rows:
        base = 0.0
        today = 0.0
        covered = 0
        for stock in row.get('stocks') or []:
            b = baselines.get(stock.get('code'))
            if not b:
                continue
            base += b
            today += stock.get('trade_amount') or 0
            covered += 1
        row['baseline_trade_amount'] = base or None
        row['baseline_stock_count'] = covered
        row['flow_multiple'] = (today / base) if base > 0 else None
    return rows
