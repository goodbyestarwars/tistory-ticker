# -*- coding: utf-8 -*-
"""일회성 검증 스크립트 - 코스피200 야간선물 분봉이 KIS API로 되는지 확인용.
domestic_futures.py에 실제로 붙이기 전에, 이 파일을 VM에서 한 번 실행해서 원본 응답을
직접 눈으로 확인하기 위한 용도. 확인 끝나면 지워도 됨(정식 코드가 아님).

사용법 (VM에서):
    cd ~/kiwoom-api
    python3 scripts/cloud-vm/_probe_night_minute.py
main.py와 같은 방식(main.py의 load_dotenv() 참고)으로 실행 위치의 .env에서
KIS_APPKEY/KIS_APPSECRET을 자동으로 읽는다 - systemd Environment=가 아니라 .env 파일에서
읽는 구조라 `systemctl show ... Environment`로는 안 보인다.

TR ID(FHKIF03020200)와 엔드포인트(inquire-time-fuopchartprice)는 KIS 공식 일봉 API
(inquire-daily-fuopchartprice, TR FHKIF03020100)와 짝을 이루는 이름 규칙을 따른 추정치이며
아직 실측 확인 전이다 - 이 스크립트로 확인해서 맞으면 domestic_futures.py/night_futures_ws.py에
정식으로 반영한다."""

import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kis_client
import night_futures_code


def load_dotenv():
    """main.py의 load_dotenv()와 동일 - 실행 위치(cwd)의 .env를 읽어 os.environ에 채운다."""
    env_path = os.path.join(os.getcwd(), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv()
APPKEY = os.environ.get('KIS_APPKEY')
APPSECRET = os.environ.get('KIS_APPSECRET')


def try_endpoint(token, path, tr_id, params):
    url = kis_client.BASE_URL + path + '?' + '&'.join('%s=%s' % (k, v) for k, v in params.items())
    req = urllib.request.Request(
        url,
        headers={
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': 'Bearer ' + token,
            'appkey': APPKEY,
            'appsecret': APPSECRET,
            'tr_id': tr_id,
            'custtype': 'P',
        },
        method='GET',
    )
    print('\n=== %s (tr_id=%s) ===' % (path, tr_id))
    print('URL:', url)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print('HTTP ERROR', e.code, e.read().decode('utf-8', 'ignore')[:1000])
        return
    print('rt_cd:', data.get('rt_cd'), 'msg1:', data.get('msg1'))
    print('output1 (요약):', json.dumps(data.get('output1'), ensure_ascii=False)[:500])
    out2 = data.get('output2')
    if isinstance(out2, list):
        print('output2 rows:', len(out2))
        if out2:
            print('첫 행:', json.dumps(out2[0], ensure_ascii=False))
            print('마지막 행:', json.dumps(out2[-1], ensure_ascii=False))
    else:
        print('output2 (list 아님):', json.dumps(out2, ensure_ascii=False)[:800])


def main():
    if not APPKEY or not APPSECRET:
        print('KIS_APPKEY/KIS_APPSECRET을 못 찾았습니다. cwd(%s)에 .env가 있는지, '
              'KIS_APPKEY=.../KIS_APPSECRET=... 줄이 있는지 확인해주세요.' % os.getcwd())
        return
    token = kis_client.get_token(APPKEY, APPSECRET)
    mst_text = night_futures_code._download_mst_text()
    contracts = night_futures_code.parse_outright_contracts(mst_text)
    contracts.sort(key=lambda c: c['expiry_yyyymm'])
    code = contracts[0]['code']
    print('근월물 코드:', code, '만기:', contracts[0]['expiry_yyyymm'])

    # 후보 1: 야간선물 분봉 - KIS 공식 예제(koreainvestment/open-trading-api,
    # examples_user/domestic_futureoption/domestic_futureoption_functions.py의
    # inquire_time_fuopchartprice)와 TR/경로 이름이 일치하는 것까지 확인됨(2026-07-16).
    try_endpoint(
        token,
        '/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice',
        'FHKIF03020200',
        {'FID_COND_MRKT_DIV_CODE': 'CM', 'FID_INPUT_ISCD': code, 'FID_HOUR_CLS_CODE': '60',
         'FID_PW_DATA_INCU_YN': 'Y', 'FID_FAKE_TICK_INCU_YN': 'N'},
    )

    # 후보 2: 선물 시세(inquire_price, FHMIF10000000) - 미결제약정(OI) 필드가 여기 포함되는지 확인.
    # 야간선물(CM)이 이 TR도 되는지는 미검증 - 에러가 나면 mrkt_div_code를 바꿔가며 재시도 필요.
    try_endpoint(
        token,
        '/uapi/domestic-futureoption/v1/quotations/inquire-price',
        'FHMIF10000000',
        {'FID_COND_MRKT_DIV_CODE': 'CM', 'FID_INPUT_ISCD': code},
    )

    # 후보 3: 옵션 시세판(display_board_callput, FHPIF05030100) - 콜/풋 옵션 거래량·OI가
    # 나오는지 확인용. 파라미터는 KIS 예제 기준 추정치라 에러 메시지를 보고 조정이 필요할 수 있음
    # (옵션 기초자산 코드 자체를 아직 안 구했으므로 코스피200 지수옵션 표준 코드 '201'로 시도).
    try_endpoint(
        token,
        '/uapi/domestic-futureoption/v1/quotations/display-board-callput',
        'FHPIF05030100',
        {'FID_COND_MRKT_DIV_CODE': 'O', 'FID_COND_SCR_DIV_CODE': '20503', 'FID_MRKT_CLS_CODE': 'CO',
         'FID_MTRT_CNT': '', 'FID_MRKT_CLS_CODE1': 'PO', 'FID_COND_MRKT_CLS_CODE': ''},
    )


if __name__ == '__main__':
    main()
