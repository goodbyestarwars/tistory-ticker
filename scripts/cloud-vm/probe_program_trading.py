# -*- coding: utf-8 -*-
"""키움 ka90007(프로그램매매누적추이요청) 원본 응답을 확인하기 위한 1회성 진단 스크립트.

전략검색·국내시장지표처럼 실제 화면에 반영하기 전에, 이 TR의 필수 파라미터
(amt_qty_tp/mrkt_tp/stex_tp) 코드값과 응답 금액 단위(원/백만원)를 문서만으로는
확정할 수 없어서 먼저 실제 응답을 눈으로 확인한다(이 저장소의 다른 TR들도
investor_flow.py/kiwoom_market.py 주석에 남아있듯 전부 이렇게 실측 확인 후 반영했다).

사용법 (VM에서):
  cd /home/goodbyestarwars/kiwoom-api
  python3 probe_program_trading.py            # 코스피(mrkt_tp=0)
  python3 probe_program_trading.py 1          # 코스닥(mrkt_tp=1)

출력된 JSON 전체를 그대로 복사해서 알려주면, 실제 필드명·단위를 보고
domestic_market_indicators.py에 정식으로 반영한다. 정식 반영 전까지는
아무 화면에도 연결하지 않는다.
"""

import json
import os
import sys

import kiwoom_client


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
    appkey = os.environ.get('KIWOOM_APPKEY')
    secretkey = os.environ.get('KIWOOM_SECRETKEY')
    if not appkey or not secretkey:
        print('KIWOOM_APPKEY/KIWOOM_SECRETKEY 환경변수가 없습니다.')
        sys.exit(1)

    mrkt_tp = sys.argv[1] if len(sys.argv) > 1 else '0'  # 0:코스피, 1:코스닥(투자자별 TR 관례 기준 추정)

    token = kiwoom_client.get_token(appkey, secretkey)
    body = {'amt_qty_tp': '1', 'mrkt_tp': mrkt_tp, 'stex_tp': '3'}
    print('요청 body:', json.dumps(body, ensure_ascii=False))
    res = kiwoom_client.call_tr(token, 'ka90007', '/api/dostk/mrkcond', body)
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
