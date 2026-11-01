"""Oracle-only adapter: historical data, no brokerage credentials or network."""
import os,json,sqlite3,sys
from pathlib import Path
from urllib.parse import urlsplit
import requests
from fastapi.responses import JSONResponse

ROOT=Path.home()/'ninepay-lab'
APP=ROOT/'app-20261101'
CATALOG_SYMBOLS=[dict(row,exchange=row.get('exchange','krx'),exchange_name=row.get('exchange_name','KRX'))
    for row in json.loads((ROOT/'symbols.json').read_text())]
KIND=os.environ['NINEPAY_COMPONENT']
COMPONENT=APP/'open-trading-api'/KIND
sys.path.insert(0,str(COMPONENT))
_request=requests.sessions.Session.request
def guarded(session,method,url,**kwargs):
    host=urlsplit(url).hostname or ''
    if 'koreainvestment.com' in host or 'kiwoom.com' in host:
        raise requests.RequestException('Oracle Lab is historical-cache-only; brokerage network blocked')
    return _request(session,method,url,**kwargs)
requests.sessions.Session.request=guarded

if KIND=='strategy_builder':
    import pandas as pd
    from core import data_fetcher
    def daily(code,days=100,env_dv='offline'):
        path=APP/'open-trading-api/backtester/.lean-workspace/data/equity/krx/daily'/(code.lower()+'.csv')
        if not path.is_file():return pd.DataFrame()
        frame=pd.read_csv(path,header=None,names=['date','open','high','low','close','volume'],dtype={'date':str})
        return frame.tail(days).reset_index(drop=True)
    def price(code,env_dv='offline'):
        frame=daily(code,260)
        if frame.empty:return {}
        last=frame.iloc[-1];prev=frame.iloc[-2] if len(frame)>1 else last
        return {'price':int(last.close),'change':int(last.close-prev.close),
            'change_rate':float((last.close/prev.close-1)*100) if prev.close else None,
            'open':float(last.open),'high':float(last.high),'low':float(last.low),'volume':float(last.volume),
            'w52_high':float(frame.high.max()),'w52_low':float(frame.low.min()),'source':'historical-cache','asOf':str(last.date)}
    data_fetcher.get_daily_prices=daily
    data_fetcher.get_current_price=price

from backend.main import app
if KIND=='strategy_builder':
    from backend.routers import strategy as strategy_router
    # This is only the strategy-data gate. Broker auth status stays FALSE.
    strategy_router.is_authenticated=lambda:True
    strategy_router.authenticate=lambda *args,**kwargs:True
    strategy_router.get_current_mode=lambda:'offline'

try:
    if KIND=='strategy_builder':from backend.routers import symbols
    else:from backend.routes import symbols
    if hasattr(symbols,'_get_all_symbols'):
        symbols._get_all_symbols=lambda:CATALOG_SYMBOLS
except ImportError:
    pass

@app.middleware('http')
async def lab_boundary(request,call_next):
    path=request.url.path
    if path=='/api/symbols/status' and request.method in ('GET','HEAD'):
        return JSONResponse(content={'kospi_count':0,'kosdaq_count':0,'total_count':len(CATALOG_SYMBOLS),
            'kospi_updated':None,'kosdaq_updated':None,'needs_update':False,
            'source':'historical-catalog','exchangeBreakdownAvailable':False})
    if path=='/api/symbols/collect':
        return JSONResponse(status_code=403,content={'detail':'서버에 저장된 과거 종목 목록을 사용합니다.'})
    if path.startswith(('/api/orders','/api/account')):
        return JSONResponse(status_code=403,content={'detail':'백데이터 분석 전용: 주문·계좌 경로 차단'})
    if path.startswith('/api/auth/') and request.method not in ('GET','HEAD'):
        return JSONResponse(status_code=409,content={'detail':'백데이터 전용 환경입니다. 브로커 인증·실거래 설정을 사용하지 않습니다.'})
    response=await call_next(request)
    response.headers['X-NinePay-Mode']='historical-read-only'
    return response

@app.get('/api/lab/status')
def lab_status():
    return {'mode':'historical-cache-only','ordersEnabled':False,'brokerCredentialsPresent':False,
        'datasets':json.loads((ROOT/'dataset-catalog.json').read_text()),'autoIncrementEnabled':False}
