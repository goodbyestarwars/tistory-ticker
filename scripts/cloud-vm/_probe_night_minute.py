# -*- coding: utf-8 -*-
"""일회성 검증 스크립트 - 코스피200 야간선물 분봉이 KIS API로 되는지 확인용.
domestic_futures.py에 실제로 붙이기 전에, 이 파일을 VM에서 한 번 실행해서 원본 응답을
직접 눈으로 확인하기 위한 용도. 확인 끝나면 지워도 됨(정식 코드가 아님).

사용법 (VM에서):
    cd ~/kiwoom-api   # 실제 경로
    export KIS_APPKEY=...   # 이미 서비스에 설정된 값과 동일하면 env로 다시 안 잡아줘도 되면
    export KIS_APPSECRET=...  # systemd EnvironmentFile을 source 하거나, 값을 직접 넣어서 실행
    python3 scripts/cloud-vm/_probe_night_minute.py

또는 systemd가 이미 쓰고 있는 환경변수를 그대로 재사용하려면:
    sudo systemctl show kiwoom-api -p Environment
로 값 확인 후 export 해서 실행.

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
    out2 = data.get('output2') or []
    print('output2 rows:', len(out2))
    if out2:
        print('첫 행:', json.dumps(out2[0], ensure_ascii=False))
        print('마지막 행:', json.dumps(out2[-1], ensure_ascii=False))


def main():
    if not APPKEY or not APPSECRET:
        print('KIS_APPKEY/KIS_APPSECRET 환경변수가 없습니다.')
        return
    token = kis_client.get_token(APPKEY, APPSECRET)
    mst_text = night_futures_code._download_mst_text()
    contracts = night_futures_code.parse_outright_contracts(mst_text)
    contracts.sort(key=lambda c: c['expiry_yyyymm'])
    code = contracts[0]['code']
    print('근월물 코드:', code, '만기:', contracts[0]['expiry_yyyymm'])

    # 후보 1: 일봉 API(inquire-daily-fuopchartprice, FHKIF03020100)와 이름 규칙이 대응되는 추정 엔드포인트.
    try_endpoint(
        token,
        '/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice',
        'FHKIF03020200',
        {'FID_COND_MRKT_DIV_CODE': 'CM', 'FID_INPUT_ISCD': code, 'FID_HOUR_CLS_CODE': '60', 'FID_PW_DATA_INCU_YN': 'Y'},
    )


if __name__ == '__main__':
    main()
