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
INDUSTRIES = {
    "반도체·AI": r"반도체|메모리|HBM|D램|낸드|AI.?반도체",
    "2차전지": r"2차전지|이차전지|배터리|양극재|음극재",
    "제약·바이오": r"제약|바이오|임상시험|신약|항암제|mRNA",
    "원자력·원전": r"원자력|원전|소형모듈원자로|\bSMR\b|핵연료",
    "방산": r"방산|방위산업|방위사업|잠수함|KDDX|무기체계",
    "해운": r"해운|해상운임|컨테이너선|벌크선|\bSCFI\b",
    "조선": r"조선업|조선주|조선소|선박건조|잠수함|KDDX",
    "전력기기": r"전력기기|송배전|변압기|전력망",
    "자동차": r"자동차|완성차|전기차|모빌리티",
    "로봇": r"로봇|자동화",
    "우주항공": r"우주항공|우주개발|발사체|위성",
    "금융": r"금융주|은행주|보험주|증권사|은행업",
    "철강·화학": r"철강|철광석|석유화학|제철",
    "에너지": r"원유|유가|태양광|풍력|수소경제|석탄",
}
TOPICS = {
    "시장 흐름": r"코스피|코스닥|증시|시장급락|폭락|급등|서킷브레이커|사이드카",
    "수급·자금": r"외국인|기관|수급|순매수|순매도|공매도|거래대금|유상증자",
    "금리·환율": r"금리|환율|국채|연준|FOMC|달러|엔저",
    "기업·실적": r"실적|영업이익|어닝|공시|상장|인수합병|IPO|계약",
    "정책·경제": r"관세|정부|정책|규제|선거|인플레이션|물가|고용",
    "해외 시장": r"미국증시|나스닥|다우|S&P.?500|일본증시|중국증시",
}

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

def mentioned(text, needle):
    if not needle: return False
    # 영문 약어가 다른 영문 단어의 일부로 나타나는 경우는 제외
    pat = re.escape(needle)
    if re.fullmatch(r"[A-Za-z0-9]+", needle):
        pat = r"(?<![A-Za-z0-9])" + pat + r"(?![A-Za-z0-9])"
    return re.search(pat, text, flags=re.I) is not None

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
    focus = title + " " + body[:300]
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
    industries = [k for k, pattern in INDUSTRIES.items() if re.search(pattern, focus, flags=re.I)]
    topics = [k for k, pattern in TOPICS.items() if re.search(pattern, focus, flags=re.I)]
    return {
        "id": card["url"].rsplit("/",1)[-1],
        "url": card["url"], "title": title, "publishedAt": date_info,
        "referenceDate": extract_reference_date(body),
        "summary": summary[:280], "coverage": coverage,
        "industries": industries, "topics": topics, "stocks": stocks,
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
