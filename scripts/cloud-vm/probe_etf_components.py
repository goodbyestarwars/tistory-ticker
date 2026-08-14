# -*- coding: utf-8 -*-
"""KIS ETF구성종목시세(FHKST121600C0, 국내주식-073) 원본 응답을 확인하기 위한
1회성 진단 스크립트.

전략검색 > ETF 수익률 상위에서 ETF를 클릭하면 종목분석 대신 구성종목(편입 종목·비중)을
보여달라는 요청 때문에 추가한다. 이 TR의 정확한 필수 파라미터는 이 저장소에서 처음
쓰는 것이라 공식 문서를 직접 확인하지 못했다 - kis_client.py의 다른 국내주식 조회
TR들(FID_COND_MRKT_DIV_CODE=J, FID_COND_SCR_DIV_CODE=화면번호) 관례를 따라 추정한
파라미터로 우선 호출해보고, 실제 응답을 보고 필드명·단위를 확정한다.
모의투자는 지원하지 않는다(국내주식-073 공식 안내) - 반드시 실전 앱키로 호출해야 한다.

사용법 (VM에서):
  cd /home/goodbyestarwars/kiwoom-api
  python3 probe_etf_components.py            # KODEX 200(069500) 기본값
  python3 probe_etf_components.py 069500

출력된 JSON을 그대로 복사해서 알려주면, 실제 필드명(종목코드/종목명/비중)을 보고
strategy-search에 정식으로 반영한다. 정식 반영 전까지는 화면에 연결하지 않는다.
"""

import json
import os
import sys

import kis_client

DEFAULT_ETF_CODE = '069500'  # KODEX 200 - 국내주식으로만 구성된 대표 ETF


def load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main():
    load_dotenv()
    appkey = os.environ.get('KIS_APPKEY')
    appsecret = os.environ.get('KIS_APPSECRET')
    if not appkey or not appsecret:
        print('KIS_APPKEY/KIS_APPSECRET 환경변수가 없습니다.')
        sys.exit(1)

    code = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ETF_CODE

    token = kis_client.get_token(appkey, appsecret)
    params = {
        'FID_COND_MRKT_DIV_CODE': 'J',
        'FID_INPUT_ISCD': code,
        'FID_COND_SCR_DIV_CODE': '11216',
    }
    print('요청 params:', json.dumps(params, ensure_ascii=False))
    try:
        data = kis_client._get_domestic_quote(
            token, appkey, appsecret,
            '/uapi/etfetn/v1/quotations/inquire-component-stock-price',
            'FHKST121600C0', params,
        )
    except Exception as e:
        print('요청 실패:', e)
        sys.exit(1)
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
