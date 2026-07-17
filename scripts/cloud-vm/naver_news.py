# -*- coding: utf-8 -*-
"""NAVER API HUB 뉴스 검색 프록시 (2026-07-18).
네이버가 기존 openapi.naver.com 검색 API를 NCP(네이버클라우드플랫폼) API HUB로 이관하면서,
신청한 앱에 IP 화이트리스트(최대 10개)를 걸 수 있게 됐다. 그런데 이 검색을 쓰던
gas/ticker-proxy.gs(getRankingNews)는 Google Apps Script라 고정 IP가 없다(UrlFetchApp이
Google이 공개하는 넓은 IP 풀에서 매번 다른 IP로 나감 - 화이트리스트 10개로는 감당 불가,
실측/공식 문서로 확인됨). 그래서 이미 고정 IP(34.28.220.13)를 쓰는 이 VM이 네이버를
대신 호출하고, GAS는 이 VM의 /naver-news만 부르도록 바꿨다 - NCP 쪽엔 이 VM의 IP 하나만
등록하면 된다.

인증 필요 환경변수: NAVER_APIHUB_CLIENT_ID, NAVER_APIHUB_CLIENT_SECRET
(NCP API HUB 콘솔에서 Search API 신청 시 발급되는 "Client ID/Secret" - 계정 전체
IAM 액세스 키(ncp_iam_* 접두사)와는 다른 별개의 키이니 혼동하지 말 것)."""

import json
import logging
import urllib.parse
import urllib.request

logger = logging.getLogger('naver_news')

API_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/news'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'


def search_news(query, client_id, client_secret, display=10, sort='date'):
    if not client_id or not client_secret:
        return []

    url = API_URL + '?' + urllib.parse.urlencode({'query': query, 'display': display, 'sort': sort})
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'X-NCP-APIGW-API-KEY-ID': client_id,
        'X-NCP-APIGW-API-KEY': client_secret,
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            data = json.loads(res.read().decode('utf-8'))
    except Exception:
        logger.exception('naver news search failed: %s', query)
        return []

    items = []
    for it in data.get('items', []):
        items.append({
            'title': _strip_html(it.get('title', '')),
            'link': it.get('originallink') or it.get('link', ''),
            'pubDate': it.get('pubDate', ''),
        })
    return items


def _strip_html(s):
    return (
        (s or '')
        .replace('<b>', '').replace('</b>', '')
        .replace('&quot;', '"').replace('&amp;', '&')
        .replace('&lt;', '<').replace('&gt;', '>')
    )
