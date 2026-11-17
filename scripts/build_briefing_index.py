#!/usr/bin/env python3
"""티스토리 공개 마켓 브리핑 → 검색 메타데이터 색인.

원문 HTML/원시 시세는 새 공개 파일에 복제하지 않는다. 제목·요약과 검색 가능한
중복제거 단어만 수록한다. 사건일을 게시일에서 추정하지 않는다.
별도 로그인/API 키, KRX/증권사 API 호출이 없다.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.error import URLError
from urllib.parse import quote, urljoin, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "briefing-index.js"
SECTOR_FILE = ROOT / "data" / "sectors-v3.js"
BASE = "https://ghlee.tistory.com"
CATEGORY = BASE + "/category/" + quote("마켓 브리핑")
POST_PATH = re.compile(r"^/([0-9]+)$")
TOKEN = re.compile(r"[가-힣A-Za-z0-9][가-힣A-Za-z0-9_/-]{1,35}")
DATE = re.compile(r"(?<!\d)(20\d{2})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})(?!\d)")
OLD_DATE = re.compile(r"(?<!\d)(\d{2})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})(?!\d)")
STAMP = re.compile(r"(?<!\d)(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{1,2}):(\d{2})")

# 2026년 기존 사이트 종목 사전에서 이름·코드를 동적으로 가져온다.
# 사명 변경은 동일 기업으로 조회하기 위한 별칭일 뿐, 역사적 상장 상태를 바꾸지 않는다.
ALIASES = {
    "HMM": ["현대상선"],
    "한화오션": ["대우조선해양"],
    "삼성전자": ["삼전"],
    "SK하이닉스": ["하이닉스", "하닉"],
    "NVIDIA": ["엔비디아", "NVDA"],
    "Moderna": ["모더나", "MRNA"],
    "Solidigm": ["솔리다임"],
    "CoreWeave": ["코어위브", "CRWV"],
    "Alphabet": ["알파벳", "구글", "GOOGL"],
    "Intel": ["인텔", "INTC"],
    "Amazon": ["아마존", "AMZN"],
    "Microsoft": ["마이크로소프트", "MSFT"],
}
FOREIGN = {
    "NVIDIA": "NVDA", "Moderna": "MRNA", "CoreWeave": "CRWV",
    "Alphabet": "GOOGL", "Intel": "INTC", "Amazon": "AMZN",
    "Microsoft": "MSFT",
}
# 산업은 종목을 자동 생성하는 분류가 아니다. 각 글에 명시된 분야만 연결한다.
# 에너지·전력 대분류 아래 원전 / 전력망 / 신재생은 서로 독립된 산업이다.
INDUSTRY_GROUPS = {
    "에너지·전력": ("원자력·원전", "전력·전력기기", "신재생에너지", "에너지·자원")
}
INDUSTRIES = {
    "반도체·AI": r"반도체|메모리|HBM|D램|낸드|AI.?반도체",
    "2차전지": r"2차전지|이차전지|배터리|양극재|음극재",
    "제약·바이오": r"제약|바이오|임상시험|임상\s*[123]상|신약|항암|암백신|mRNA",
    "원자력·원전": r"원자력|원전|소형모듈원자로|소형\s*모듈\s*원자로|\bSMR\b|핵연료|우라늄",
    "전력·전력기기": r"전력기기|송배전|변압기|전력망|배전망|전력\s*설비",
    "신재생에너지": r"태양광|풍력|재생에너지|신재생|수소(?:경제|발전)",
    "에너지·자원": r"원유|국제유가|천연가스|\bLNG\b|석탄",
    "방산": r"방산|방위산업|방위사업|잠수함|KDDX|무기체계",
    "해운": r"해운|해상운임|컨테이너선|벌크선|\bSCFI\b",
    "조선": r"조선업|조선주|조선소|선박건조|잠수함|KDDX",
    "자동차": r"자동차|완성차|전기차|모빌리티",
    "로봇": r"로봇|자동화",
    "우주항공": r"우주항공|우주개발|발사체|위성",
    "금융": r"금융주|은행주|보험주|증권사|은행업",
    "철강·화학": r"철강|철광석|석유화학|제철",
}
# 제목을 우선하여 1~2개의 검증 가능한 주제를 선정한다.
# 본문 초입의 주변 언급 때문에 기사 핵심 주제가 왜곡되는 문제를 피한다.
TOPICS = {
    "재정·부채": r"국가채무|국가부채|정부\s*부채|미국\s*부채|재정적자|부채한도|국가재정|재정위기",
    "가상자산": r"비트코인|이더리움|가상자산|암호화폐|스테이블코인|\bBTC\b|\bETH\b",
    "연구·임상": r"임상\s*[123]상|임상시험|항암|암백신|mRNA|신약|바이오\s*연구",
    "기업·사건": r"압수수색|고발|소송|의혹|상장\s*철회|기업\s*논란|법적\s*분쟁",
    "금리·환율": r"금리|환율|국채|연준|FOMC|달러|엔저|엔화|원화|채권",
    "수급·자금": r"외국인|기관|수급|순매수|순매도|공매도|거래대금|유상증자|리밸런싱|레버리지|청산",
    "기업·실적": r"실적|영업이익|어닝|공시|상장|인수합병|합병|IPO|수주|배당|주주환원|자사주",
    "정책·경제": r"관세|정부|정책|규제|선거|인플레이션|물가|고용|대통령",
    "시장 흐름": r"코스피|코스닥|증시|시장급락|폭락|급등|서킷브레이커|사이드카|주가|반등",
    "해외 시장": r"미국증시|나스닥|다우|S&P.?500|일본증시|중국증시",
    "산업 동향": r"산업\s*동향|산업\s*투자|산업\s*전망|데이터센터|전력\s*수요",
}
# 유행 테마는 안정된 산업 분류와 별도로 검색한다. 추측·수혜주 연결 금지.
THEMES = {
    "AI 데이터센터": r"(?:\bAI\b|인공지능).{0,14}데이터센터|데이터센터.{0,14}(?:\bAI\b|인공지능)",
    "SMR": r"\bSMR\b|소형\s*모듈\s*원자로",
    "전력 수요": r"전력\s*수요|전력\s*소비|전력난",
    "원전 수출": r"원전.{0,8}수출|원자력.{0,8}수출",
    "원전 건설": r"원전.{0,8}건설|신규\s*원전|원전\s*증설",
    "원전 기자재": r"원전.{0,8}기자재|원자력.{0,8}기자재|원전.{0,8}부품",
    "핵연료·우라늄": r"핵연료|우라늄",
    "원전 해체·폐기물": r"원전.{0,8}해체|원전.{0,8}폐기물|방사성\s*폐기물",
    "전력망": r"전력망|송배전|변압기",
    "방산 수출": r"방산.{0,8}수출|방위산업.{0,8}수출",
    "해운 운임": r"해상\s*운임|운임\s*지수|\bSCFI\b",
    "비트코인": r"비트코인|\bBTC\b",
    "mRNA": r"\bmRNA\b",
}

def classify_topics(title: str, summary: str):
    in_title = [name for name, pattern in TOPICS.items() if re.search(pattern, title, flags=re.I)]
    if in_title:
        return in_title[:2]
    in_summary = [name for name, pattern in TOPICS.items() if re.search(pattern, summary[:180], flags=re.I)]
    return in_summary[:1] if in_summary else ["브리핑·해설"]

def classify_facets(title: str, summary: str):
    focus = title + " " + summary[:180]
    industries = [name for name, pattern in INDUSTRIES.items() if re.search(pattern, focus, flags=re.I)]
    themes = [name for name, pattern in THEMES.items() if re.search(pattern, focus, flags=re.I)]
    return classify_topics(title, summary), industries, themes


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def canonical_url(url: str) -> str:
    p = urlsplit(urljoin(BASE, url))
    if p.netloc != "ghlee.tistory.com":
        return ""
    m = POST_PATH.fullmatch(p.path.rstrip("/"))
    return BASE + "/" + m.group(1) if m else ""

def attrs_map(attrs):
    return dict(attrs)

class CardParser(HTMLParser):
    """티스토리 skin.html의 article.post-card / post-title / post-date 계약."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.card = None
        self.cards = []

    def handle_starttag(self, tag, attrs):
        a = attrs_map(attrs)
        classes = a.get("class", "").split()
        if tag == "article" and "post-card" in classes and self.card is None:
            self.card = {"url": canonical_url(a.get("data-url", "")), "title": "", "date": "", "summary": ""}
            self.stack = [(tag, classes)]
            return
        if self.card is not None and tag not in {"br", "img", "hr", "meta", "input", "link", "source", "wbr"}:
            self.stack.append((tag, classes))
            if tag == "a" and not self.card["url"]:
                self.card["url"] = canonical_url(a.get("href", ""))

    def handle_data(self, data):
        if self.card is None: return
        if any("post-title" in c for _, c in self.stack): self.card["title"] += data
        elif any("post-date" in c for _, c in self.stack): self.card["date"] += data
        elif any("post-excerpt" in c for _, c in self.stack): self.card["summary"] += data

    def handle_endtag(self, tag):
        if self.card is None: return
        while self.stack:
            name, _ = self.stack.pop()
            if name == tag: break
        if not self.stack:
            if self.card["url"] and clean(self.card["title"]):
                self.cards.append({k: clean(v) for k,v in self.card.items()})
            self.card = None

class PostParser(HTMLParser):
    """본문 일부의 script/style/svg를 제외하고 텍스트만 추출."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.stack = []
        self.body = []
        self.date_text = []
        self.in_date = 0
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        classes = attrs_map(attrs).get("class", "").split()
        if not self.depth and "post-single-body" in classes:
            self.depth = 1
            return
        if self.depth:
            if tag not in {"br", "img", "hr", "meta", "input", "link", "source", "wbr"}:
                self.depth += 1
            if tag in {"script", "style", "svg"}: self.skip += 1
            if tag in {"p", "br", "li", "h1", "h2", "h3", "tr", "section", "div"}: self.body.append(" ")
            return
        if "post-date" in classes: self.in_date += 1
        elif self.in_date and tag not in {"br", "img", "hr", "meta"}: self.in_date += 1

    def handle_data(self, data):
        if self.depth and not self.skip: self.body.append(data + " ")
        if not self.depth and self.in_date: self.date_text.append(data)

    def handle_endtag(self, tag):
        if self.depth:
            if tag in {"script", "style", "svg"} and self.skip: self.skip -= 1
            self.depth -= 1
        elif self.in_date:
            self.in_date -= 1

def fetch(url, timeout=25):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; BriefingArchiveIndexer/1.0; +https://ghlee.tistory.com)"})
    with urlopen(req, timeout=timeout) as r:
        if r.status != 200: raise RuntimeError(f"HTTP {r.status} {url}")
        return r.read().decode("utf-8", errors="replace")

def cards_all(max_pages, delay):
    found = {}
    for page in range(1, max_pages + 1):
        url = CATEGORY + "?page=" + str(page)
        parsed = CardParser()
        parsed.feed(fetch(url))
        if not parsed.cards:
            if page == 1: raise RuntimeError("카테고리 글을 파싱하지 못함. 원문 보존")
            break
        fresh = [x for x in parsed.cards if x["url"] not in found]
        if not fresh: break
        for item in fresh: found[item["url"]] = item
        print(f"category page={page}, cards={len(parsed.cards)}, new={len(fresh)}", flush=True)
        if len(parsed.cards) < 30: break
        time.sleep(delay)
    else:
        raise RuntimeError("최대 페이지 한도 도달; 전체 수집 확인 전 색인 갱신 금지")
    return found

def stock_catalog():
    raw = SECTOR_FILE.read_text(encoding="utf-8")
    rows = re.findall(r'\{\s*name:\s*"([^"]+)",\s*code:\s*"([^"]+)",\s*market:\s*"([^"]+)"', raw)
    catalog = {}
    for name, code, market in rows:
        if len(name) >= 2 and len(code) == 6:
            catalog[(name,code)] = {"name":name, "code":code, "market":market}
    for name, code in FOREIGN.items():
        catalog[(name,code)] = {"name":name, "code":code, "market":"US"}
    if len(catalog) < 100: raise RuntimeError("기존 종목 사전을 충분히 읽지 못함")
    return list(catalog.values())

AMBIGUOUS_NAMES = {"대상", "한화", "SK", "LG", "CJ", "GS", "DB", "현대", "롯데", "LS"}
KOREAN_PARTICLES = r"(?:은|는|이|가|의|을|를|에|에서|과|와|으로|로|도|만|들|측|까지|보다|주가|관련주|그룹)?"

def mentioned(text, needle):
    if not needle: return False
    # 짧은 기업명은 일반어·그룹명과 충돌하므로 '$한화' 또는 명시적 코드처럼
    # 표기된 경우만 종목으로 확정한다. 텍스트 검색에서는 일반 단어로 찾을 수 있다.
    if needle in AMBIGUOUS_NAMES:
        return re.search(r"(?<![가-힣A-Za-z0-9])\$" + re.escape(needle) +
                         r"(?![가-힣A-Za-z0-9])", text, flags=re.I) is not None
    prefix = r"(?<![가-힣A-Za-z0-9])"
    if re.fullmatch(r"[A-Za-z0-9]+", needle):
        suffix = r"(?![가-힣A-Za-z0-9])"
    else:
        suffix = KOREAN_PARTICLES + r"(?=[^가-힣A-Za-z0-9]|$)"
    return re.search(prefix + re.escape(needle) + suffix, text, flags=re.I) is not None

def extract_reference_date(body):
    # '기준일' 명시 자료만 메타데이터화한다. 작성일을 사건일로 추정하지 않는다.
    front = body[:1100]
    m = re.search(r"(?:기준일|자료\s*기준|작성\s*기준)\s*(?:은|:|=)?\s*(20\d{2}[./-]\s*\d{1,2}[./-]\s*\d{1,2})", front)
    if not m: return None
    d = DATE.search(m.group(1))
    if not d: return None
    try: return datetime(*map(int,d.groups())).date().isoformat()
    except ValueError: return None

def tokenize(body):
    # 원문/원시 숫자 값을 공개 검색 파일에 복제하지 않음. 단어만 추출.
    out = set()
    for token in TOKEN.findall(body):
        if not re.search(r"[가-힣A-Za-z]", token): continue
        if token.isdigit() or token.startswith("http"): continue
        token = token.lower().strip("-_/")
        if 2 <= len(token) <= 32: out.add(token)
    return sorted(out)

def entry(card, html, catalog):
    p = PostParser()
    p.feed(html)
    body = clean("".join(p.body))
    coverage = "full"
    if len(body) < 70:
        # 일부 티스토리 글은 비정형 본문 HTML이다. 검색 누락/전체 실패보다
        # 공개 목록의 실제 요약을 부분 색인하고 이를 명시적으로 표시한다.
        body = card['summary']
        coverage = "excerpt"
    if len(body) < 70: raise RuntimeError(f"본문·요약 파싱 실패: {card['url']}")
    title = card["title"]
    summary = card["summary"] or body[:260]
    meta = clean("".join(p.date_text)) or card["date"]
    stamp = STAMP.search(meta)
    if stamp:
        date_info = "%04d-%02d-%02dT%02d:%02d:00+09:00" % tuple(map(int,stamp.groups()))
    else:
        date_info = None
        d = DATE.search(meta.replace(" ",""))
        if d:
            try: date_info = datetime(*map(int,d.groups())).date().isoformat()
            except ValueError: pass
    if not date_info: raise RuntimeError(f"게시일 파싱 실패: {card['url']}: {meta!r}")
    stocks = []
    for s in catalog:
        aliases = ALIASES.get(s["name"], [])
        names = [s["name"]] + aliases
        title_match = any(mentioned(title, a) for a in names)
        body_match = title_match or any(mentioned(body, a) for a in names)
        if not body_match: continue
        stocks.append({"name":s["name"], "code":s["code"],
                       "role":"primary" if title_match else "mentioned",
                       **({"aliases":aliases} if aliases else {})})
    stocks.sort(key=lambda s: (s["role"] != "primary", s["name"]))
    topics, industries, themes = classify_facets(title, summary)
    return {
        "id": card["url"].rsplit("/",1)[-1],
        "url": card["url"], "title": title, "publishedAt": date_info,
        "referenceDate": extract_reference_date(body),
        "summary": summary[:280], "coverage": coverage,
        "industries": industries, "topics": topics, "themes": themes, "stocks": stocks,
        "terms": tokenize(body)
    }

def previous():
    if not OUTPUT.exists(): return None
    raw = OUTPUT.read_text(encoding="utf-8")
    prefix = "window.NINE_BRIEFING_INDEX = "
    if not raw.startswith(prefix): return None
    try: return json.loads(raw[len(prefix):].rstrip().removesuffix(";"))
    except ValueError: return None

def main():
    args = argparse.ArgumentParser()
    args.add_argument("--max-pages", type=int, default=200)
    args.add_argument("--delay", type=float, default=0.35)
    a = args.parse_args()
    cards = cards_all(a.max_pages, a.delay)
    catalog = stock_catalog()
    old = previous()
    old_items = {e["url"]: e for e in (old or {}).get("posts", [])}
    if old and len(cards) < len(old_items):
        raise RuntimeError(f"글 목록 감소 {len(old_items)}→{len(cards)}: 누락/비공개 확인 전 보존")
    result = []
    for n, card in enumerate(cards.values(), start=1):
        try:
            doc = entry(card, fetch(card["url"]), catalog)
        except (URLError, RuntimeError, ValueError) as error:
            if card["url"] not in old_items: raise
            print(f"보존: {card['url']} 오류 {error}", flush=True)
            doc = old_items[card["url"]]
        result.append(doc)
        if n % 10 == 0: print(f"article {n}/{len(cards)}", flush=True)
        time.sleep(a.delay)
    result.sort(key=lambda p: (p["publishedAt"], p["id"]), reverse=True)
    if old and old.get("posts") == result:
        print(f"unchanged: {len(result)} posts")
        return
    if not result: raise RuntimeError("수집 결과 0건: 기존 색인을 변경하지 않음")
    generated = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")
    index = {"schemaVersion":1, "generatedAt":generated, "posts":result}
    content = "window.NINE_BRIEFING_INDEX = " + json.dumps(index, ensure_ascii=False, separators=(",",":")) + ";\n"
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".js.tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(OUTPUT)
    print(f"updated: {len(result)} posts; bytes={len(content.encode('utf-8'))}", flush=True)

if __name__ == "__main__":
    main()
