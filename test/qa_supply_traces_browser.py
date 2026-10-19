"""Offline Edge QA of both production chart renderers with cached real OHLCV.
Private test exports are injected in memory only; no API/broker requests.
Set SUPPLY_QA_EXAMPLE, SUPPLY_QA_LWC, SUPPLY_QA_OUT for other workspaces.
"""
import asyncio, base64, json, os, subprocess, urllib.request
from pathlib import Path
import websockets
REPO=Path(__file__).resolve().parents[1]
EXAMPLE=Path(os.environ.get('SUPPLY_QA_EXAMPLE',REPO.parent/'supply-example.json'))
LIB=Path(os.environ.get('SUPPLY_QA_LWC',REPO.parent/'lwc-supply.js'))
OUT=Path(os.environ.get('SUPPLY_QA_OUT',REPO.parents[1]/'outputs/supply-traces'))
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 proc=subprocess.Popen(['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9251','--user-data-dir='+str(REPO.parent/'edge-supply-qa'),'about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for _ in range(80):
   try:
    with urllib.request.urlopen('http://127.0.0.1:9251/json/list') as r: targets=json.load(r)
    break
   except OSError: await asyncio.sleep(.1)
  target=next(t for t in targets if t['type']=='page')
  async with websockets.connect(target['webSocketDebuggerUrl'],max_size=30_000_000) as ws:
   seq=0
   async def call(method,params=None):
    nonlocal seq
    seq+=1;await ws.send(json.dumps({'id':seq,'method':method,'params':params or {}}))
    while True:
     m=json.loads(await ws.recv())
     if m.get('id')==seq:
      if 'error' in m: raise AssertionError(m)
      return m.get('result',{})
   async def ev(expr):
    r=await call('Runtime.evaluate',{'expression':expr,'returnByValue':True,'awaitPromise':True})
    if 'exceptionDetails' in r: raise AssertionError(r)
    return r.get('result',{}).get('value')
   await call('Page.enable')
   css='\n'.join((REPO/'css'/n).read_text(encoding='utf-8') for n in ['stock-search.css','foreign-flow.css'])
   await call('Page.setDocumentContent',{'frameId':(await call('Page.getFrameTree'))['frameTree']['frame']['id'],'html':'<!doctype html><meta charset="utf-8"><style>'+css+' [hidden]{display:none!important} body{margin:0;padding:10px;font-family:Arial,sans-serif}*{box-sizing:border-box}#chart{position:relative;width:100%;height:580px}#legend{font-size:12px;padding:8px}h3{margin:4px 0}</style><h3>HMM 011200 · 수급 흔적 (저장 일봉)</h3><div id="legend"></div><div id="chart"></div>'})
   await ev('window.errors=[];window.addEventListener("error",e=>errors.push(e.message));window.fetch=()=>Promise.reject(new Error("offline QA"));')
   for path in [LIB,REPO/'js/chart-core.js',REPO/'js/chart-data.js']:
    await ev(path.read_text(encoding='utf-8'))
   await ev('NineChartCore.ready=()=>Promise.resolve([LightweightCharts]);NineChartCore.loadModule=()=>Promise.resolve(null);window.example='+EXAMPLE.read_text(encoding='utf-8')+';')
   source=(REPO/'js/stock-search.js').read_text(encoding='utf-8').replace('  global.StockSearch = {','  global.qaStock={render:renderLwChart,state:state,get:()=>({chart:lwcChart,series:lwcCandleSeries,holder:supplyMarkerHolder})};\n  global.StockSearch = {')
   await ev(source)
   source=(REPO/'js/foreign-flow.js').read_text(encoding='utf-8').replace('  global.ForeignFlow = ForeignFlow;','  global.qaFlow={render:renderLwChart,enable:v=>{accumulationEnabled=v;},get:()=>({chart:lwcChart,series:lwcCandleSeries,holder:flowMarkerHolder})};\n  global.ForeignFlow = ForeignFlow;')
   await ev(source)
   await ev('window.core=NineChartCore;window.handlers=new Map();let original=LightweightCharts.createChart;window.LightweightCharts=Object.assign({},LightweightCharts);LightweightCharts.createChart=function(...args){let c=original(...args),sub=c.subscribeCrosshairMove.bind(c),unsub=c.unsubscribeCrosshairMove.bind(c);handlers.set(c,[]);c.subscribeCrosshairMove=fn=>{handlers.get(c).push(fn);sub(fn);};c.unsubscribeCrosshairMove=fn=>{handlers.set(c,handlers.get(c).filter(f=>f!==fn));unsub(fn);};return c;};window.bars=example.bars.slice(0,example.hit.index+12);qaStock.state.selectedCode="011200";qaStock.state.accumulationEnabled=true;qaFlow.enable(true);')
   reports=[]
   for width in [1440,390]:
    await call('Emulation.setDeviceMetricsOverride',{'width':width,'height':850,'deviceScaleFactor':1,'mobile':False})
    await call('Emulation.setTouchEmulationEnabled',{'enabled':width==390})
    for screen in ['stock','flow']:
     await ev('(()=>{let old=document.getElementById("chart");if(old){old.id="chart-"+(window.screenName||"initial");old.hidden=true;if(old.parentElement!==document.body)old.parentElement.hidden=true;}window.screenName='+json.dumps(screen)+';let host=document.getElementById("chart-"+screenName);if(!host){host=document.createElement("div");let wrap=document.createElement("div");wrap.id=screenName==="stock"?"stock-search":"foreign-flow";wrap.appendChild(host);document.body.appendChild(wrap);}host.id="chart";host.className=screenName==="stock"?"ss-chart":"ff-chart-candle";host.hidden=false;host.parentElement.hidden=false;})()')
     await ev('window.qa='+('qaStock' if screen=='stock' else 'qaFlow')+';')
     tfs=['day','week','month','day'] if screen=='stock' else ['day','day']
     for tf in tfs:
      expr='qa.render(document.getElementById("chart"),NineChartData.barsForTimeframe(bars,"'+tf+'"),"'+tf+'")' if screen=='stock' else 'qa.render(document.getElementById("chart"),{daily:bars,ma:{},flow:[]},"011200",bars.at(-1).close)'
      await ev(expr);await asyncio.sleep(.35)
      result=await ev('({canvas:document.querySelectorAll("#chart canvas").length,tips:document.querySelectorAll("#chart .nine-supply-tip").length,errors:errors})')
      assert result['canvas']>0,result
      assert result['tips']==(1 if tf=='day' else 0),result
      if tf!='day':
       assert await ev('document.getElementById("chart").innerText.includes("수급 흔적은 국내 일봉에서만 표시됩니다")')
      else:
       await ev('window.current=qa.get();current.chart.timeScale().setVisibleLogicalRange({from:example.hit.index-32,to:example.hit.index+12});document.getElementById("legend").innerHTML=core.supplyTraceLegendHtml(core.supplyTraceSummary(bars));')
       await asyncio.sleep(.1)
       point=await ev('(()=>{let b=document.getElementById("chart").getBoundingClientRect();return {x:b.left+current.chart.timeScale().timeToCoordinate(example.hit.date),y:b.top+current.series.priceToCoordinate(example.bars[example.hit.index].close)};})()')
       if width==1440:
        await call('Input.dispatchMouseEvent',{'type':'mouseMoved',**point})
       else:
        await call('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':point['x'],'y':point['y']}]})
        await asyncio.sleep(.5)
       await asyncio.sleep(.1)
       visible=await ev('(()=>{let tip=document.querySelector("#chart .nine-supply-tip");return tip.style.display!=="none"&&tip.innerText.includes("회복 확인");})()')
       assert visible,{'screen':screen,'width':width,'point':point,'gesture':'mouse' if width==1440 else 'touch long press'}
       if width==390: await call('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
       info=await ev('(()=>{let c=document.getElementById("chart"),p={x:c.clientWidth-2,y:c.clientHeight-2};handlers.get(current.chart).forEach(fn=>fn({time:example.hit.date,point:p}));let tip=c.querySelector(".nine-supply-tip"),r=tip.getBoundingClientRect(),b=c.getBoundingClientRect();return {text:tip.innerText,bounded:r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom&&r.bottom<=innerHeight,count:core.supplyTraceMarkers(bars).filter(m=>m.time===example.hit.date).length,subscriptions:handlers.get(current.chart).length};})()')
       assert info['bounded'] and info['count']==3,info
       for text in ['거래량 급증','장기선 공방','회복 확인','4.95배']: assert text in info['text'],info
       png=(await call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False}))['data']
       (OUT/f'{screen}-{width}.png').write_bytes(base64.b64decode(png))
      reports.append({'screen':screen,'width':width,'timeframe':tf,**result})
   assert await ev('errors')==[],await ev('errors')
   (OUT/'browser-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
   print('PASS',len(reports),'production renderer cases: 1440px / 390px, repeated day/week/month, tooltip bounds and triple overlap')
 finally: proc.terminate()
if __name__=='__main__':asyncio.run(main())

