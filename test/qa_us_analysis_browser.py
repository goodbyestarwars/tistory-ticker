"""Offline browser QA: synthetic licensed snapshots only; no provider holdings fetched."""
import asyncio,base64,json,subprocess,urllib.request
from pathlib import Path
import websockets
REPO=Path(__file__).resolve().parents[1]
OUT=REPO.parents[1]/'outputs/us-analysis-etf'
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 proc=subprocess.Popen(['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9260','--user-data-dir='+str(REPO.parent/'edge-us-analysis'),'about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for _ in range(60):
   try:
    targets=json.load(urllib.request.urlopen('http://127.0.0.1:9260/json/list'));break
   except OSError:await asyncio.sleep(.1)
  async with websockets.connect(next(t for t in targets if t['type']=='page')['webSocketDebuggerUrl'],max_size=20_000_000) as ws:
   seq=0
   async def call(method,params={}):
    nonlocal seq
    seq+=1;await ws.send(json.dumps({'id':seq,'method':method,'params':params}))
    while True:
     msg=json.loads(await ws.recv())
     if msg.get('id')==seq:
      if 'error' in msg:raise AssertionError(msg)
      return msg.get('result',{})
   async def ev(expr):
    result=await call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True})
    if result.get('exceptionDetails'):raise AssertionError(result)
    return result.get('result',{}).get('value')
   await call('Page.enable')
   frame=(await call('Page.getFrameTree'))['frameTree']['frame']['id']
   css=(REPO/'css/us-stocks.css').read_text(encoding='utf-8')
   await call('Page.setDocumentContent',{'frameId':frame,'html':'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:12px;font-family:Arial}*{box-sizing:border-box}'+css+'</style><div class="us-stocks-shell"><div id="usStocksAnalysis" class="us-stocks-analysis-grid"></div></div>'})
   source=(REPO/'js/us-stocks.js').read_text(encoding='utf-8').replace('  global.UsStocks = {','  global.qa={renderAnalysis, analysisCard, state, loadAnalysis};\n  global.UsStocks = {')
   await ev(source)
   await ev('window.errors=[];window.addEventListener("error",e=>errors.push(e.message));window.mount=document.getElementById("usStocksAnalysis");mount.innerHTML=["financials","statements","earnings","recommendation","insider"].map(k=>qa.analysisCard(k,"-",k)).join("");')
   payload={'symbol':'TEST','instrument':{'quote_type':'ETF'},'fetched_at':'2026-10-19T00:00:00Z','summary':{'pe':32,'pb':8,'roe':25,'latest_revenue':1000000000,'latest_net_income':50000000,'recommendation':{'available':True,'period':'2026-10-01','strongBuy':5,'buy':10,'hold':3,'sell':1},'statement_period':{'start':'2026-01-01','end':'2026-06-30','filed':'2026-07-30'},'metric_basis':{'pe':{'field':'peTTM'},'pb':{'field':'pb'},'roe':{'field':'roeTTM'}}},'etf_holdings':{'status':'pending','issuer_url':'https://www.roundhillinvestments.com/etf/'}}
   await ev('window.sample='+json.dumps(payload)+';')
   reports=[]
   for width in [1440,390]:
    await call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1000,'deviceScaleFactor':1,'mobile':width<500})
    for dark in [False,True]:
     await ev('document.documentElement.classList.toggle("dark",'+json.dumps(dark)+');qa.renderAnalysis(sample);qa.renderAnalysis(sample);')
     result=await ev('JSON.stringify({pending:mount.innerText.includes("구성종목 데이터 준비 중"),count:mount.querySelectorAll("[data-etf-holdings]").length,sources:mount.querySelectorAll(".us-analysis-source").length,month:mount.innerText.includes("2026-10"),overflow:document.documentElement.scrollWidth>innerWidth,underline:Array.from(mount.querySelectorAll("a")).some(a=>getComputedStyle(a).textDecorationLine.includes("underline"))})')
     result=json.loads(result);assert result['pending'] and result['count']==1 and result['sources']==5 and result['month'] and not result['overflow'] and not result['underline'],result
     await call('Input.dispatchKeyEvent',{'type':'keyDown','key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
     await call('Input.dispatchKeyEvent',{'type':'keyUp','key':'Tab','code':'Tab','windowsVirtualKeyCode':9})
     await ev('mount.querySelector("a").focus()')
     assert await ev('getComputedStyle(document.activeElement).outlineStyle')!='none'
     reports.append({'width':width,'dark':dark,**result})
     if not dark:
      (OUT/f'pending-{width}.png').write_bytes(base64.b64decode((await call('Page.captureScreenshot',{'format':'png'}))['data']))
    rows=[{'name':'Synthetic foreign equity '+str(i),'ticker':'TEST'+str(i),'weight_percent':5,'kind':'equity' if i else 'derivative','basis':'holding_value' if i else 'economic_exposure','country':'KR'} for i in range(25)]
    await ev('sample.etf_holdings='+json.dumps({'status':'ready','holdings':rows,'as_of':'2026-10-18','total_count':25,'source':'Synthetic QA only','source_url':'https://example.org/','issuer_url':'https://www.roundhillinvestments.com/etf/'})+';qa.renderAnalysis(sample);')
    assert await ev('mount.querySelector("[data-etf-holdings] details").open')==False
    await ev('mount.querySelector("[data-etf-holdings] summary").click()')
    assert await ev('mount.querySelectorAll("[data-etf-holdings] li").length')==25
    assert await ev('mount.innerText.includes("실질 노출")&&mount.innerText.includes("KR")')
    assert not await ev('document.documentElement.scrollWidth>innerWidth')
    payload['etf_holdings']['status']='pending'
    await ev('sample='+json.dumps(payload)+';')
   # Missing financial/recommendation data must remain explicit; equities hide ETF card.
   await ev('qa.renderAnalysis({instrument:{quote_type:"EQUITY"},summary:{recommendation:{available:false}}})')
   assert await ev('mount.querySelectorAll("[data-etf-holdings]").length')==0
   assert await ev('mount.innerText.includes("집계 자료 없음")')
   # Ignore a late analysis response after a symbol switch.
   await ev('window.resolveFetch=null;window.fetch=()=>new Promise(r=>resolveFetch=r);qa.state.symbol="OLD";qa.loadAnalysis();qa.state.symbol="NEW";resolveFetch({ok:true,json:()=>Promise.resolve({success:true,data:{instrument:{quote_type:"ETF"},summary:{pe:999}}})});')
   await asyncio.sleep(.1)
   assert not await ev('mount.innerText.includes("999")')
   assert await ev('errors')==[]
   (OUT/'browser-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
   print('PASS PC/mobile light/dark, repeated render, source month, no underline, keyboard focus, top20 expansion, foreign/derivative synthetic rows, missing data, stale response')
 finally:proc.terminate()
if __name__=='__main__':asyncio.run(main())
