"""Read-only live Pages verification. Opens HMM charts; never submits orders."""
import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import websockets

REPO=Path(__file__).resolve().parents[1]
OUT=REPO.parents[1]/'outputs/chart-regime-traces-20261020'
LOCAL=os.environ.get('CHART_OBS_LOCAL')=='1'
ASSETS=['js/chart-core.js','js/stock-search.js','js/foreign-flow.js','css/stock-search.css','css/order-book.css']
if LOCAL:OUT=OUT/'preflight'


async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    proc=subprocess.Popen(['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','--headless=new','--disable-gpu','--no-first-run',
        '--remote-debugging-port=9269','--user-data-dir='+str(REPO.parent/'edge-chart-observation-live'),'about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(70):
            try:
                targets=json.load(urllib.request.urlopen('http://127.0.0.1:9269/json/list'));break
            except OSError:await asyncio.sleep(.1)
        async with websockets.connect(next(t for t in targets if t['type']=='page')['webSocketDebuggerUrl'],max_size=20000000) as ws:
            seq=0
            async def call(method,params=None):
                nonlocal seq
                seq+=1;await ws.send(json.dumps({'id':seq,'method':method,'params':params or {}}))
                while True:
                    result=json.loads(await ws.recv())
                    if result.get('method')=='Fetch.requestPaused':
                        p=result['params'];filename=next((f for f in ASSETS if '/'+f in p['request']['url']),None)
                        if filename:
                            params={'requestId':p['requestId'],'responseCode':200,'responseHeaders':[{'name':'Content-Type','value':('text/css' if filename.endswith('.css') else 'application/javascript')+'; charset=utf-8'}], 'body':base64.b64encode((REPO/filename).read_bytes()).decode()}
                            await ws.send(json.dumps({'id':100000+seq,'method':'Fetch.fulfillRequest','params':params}))
                        else:await ws.send(json.dumps({'id':200000+seq,'method':'Fetch.continueRequest','params':{'requestId':p['requestId']}}))
                    if result.get('id')==seq:return result.get('result',{})
            async def ev(source):
                r=await call('Runtime.evaluate',{'expression':source,'returnByValue':True,'awaitPromise':True})
                if 'exceptionDetails' in r:raise AssertionError(r)
                return r['result'].get('value')
            async def wait(source):
                for _ in range(100):
                    if await ev(source):return
                    await asyncio.sleep(.5)
                raise AssertionError(source)
            await call('Network.enable');await call('Network.setCacheDisabled',{'cacheDisabled':True})
            if LOCAL:await call('Fetch.enable',{'patterns':[{'urlPattern':'*://goodbyestarwars.github.io/tistory-ticker/'+f+'*'} for f in ASSETS]})
            results=[]
            for width in (1440,390):
                await call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':False})
                for screen,prefix,host in [('stock-search','ss','ssChart'),('foreign-flow','ff','ffLwChart')]:
                    await call('Page.navigate',{'url':'https://ghlee.tistory.com/page/'+screen+'?code=011200&name=HMM'})
                    if prefix=='ff':
                        await wait('!!document.querySelector("#foreign-flow [data-view=chart]")')
                        await ev('document.querySelector("#foreign-flow [data-view=chart]").click()')
                    await wait('!!document.querySelector("#'+host+' .nine-trend-bands")')
                    await ev('window.qaLiveChart=null;window.qaLiveBars=0;let register=NineChartCore.registerChart;NineChartCore.registerChart=function(el,chart,opts){if(el.id==="'+host+'"){qaLiveChart=chart;qaLiveBars=opts.bars;}return register.apply(this,arguments);}')
                    assert await ev('NineChartCore.VERSION')=='2026-10-20-period-boxes-5'
                    defaults=await ev('({trend:document.getElementById("'+prefix+'TrendToggle").checked,traces:document.getElementById("'+prefix+'AccumulationToggle").checked,mode:document.getElementById("'+prefix+'SupplyMode").value})')
                    assert defaults=={'trend':True,'traces':True,'mode':'detail'},defaults
                    assert await ev('document.querySelectorAll("#'+host+' .nine-supply-tip").length')==1
                    await ev('document.getElementById("'+prefix+'AccumulationToggle").click()')
                    await wait('document.querySelectorAll("#'+host+' .nine-supply-tip").length===0')
                    await ev('document.getElementById("'+prefix+'AccumulationToggle").click()')
                    await wait('document.querySelectorAll("#'+host+' .nine-supply-tip").length===1')
                    await ev('window.scrollBy(0,document.getElementById("'+host+'").getBoundingClientRect().top-150)')
                    shot=await call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
                    (OUT/f'live-{prefix}-{width}-important.png').write_bytes(base64.b64decode(shot['data']))
                    await ev('let m=document.getElementById("'+prefix+'SupplyMode");m.value="detail";m.dispatchEvent(new Event("change"))')
                    await wait('!!document.querySelector("#'+host+' .nine-supply-tip") && !!document.querySelector("#'+host+' .nine-trend-bands")')
                    ranges=[]
                    for period in ('1y','3y','5y'):
                        clicked=await ev('(()=>{let b=document.getElementById("'+host+'").parentElement.querySelector(\'[data-range="'+period+'"]\');if(b){b.click();return true;}return false;})()')
                        assert clicked,(screen,period)
                        await asyncio.sleep(1)
                        await wait('(()=>{let s=document.getElementById("'+host+'").parentElement.querySelector(".nine-chart-range-status");return !s || !s.textContent.includes("불러오는");})()')
                        await wait('document.querySelectorAll("#'+host+' .nine-trend-bands").length===1')
                        await wait('!!window.qaLiveChart')
                        visible=await ev('(()=>{let r=qaLiveChart.timeScale().getVisibleRange();function day(t){if(typeof t==="string")return Date.parse(t);if(typeof t==="number")return t*1000;return Date.UTC(t.year,t.month-1,t.day);}return {bars:qaLiveBars,spanDays:(day(r.to)-day(r.from))/86400000,from:r.from,to:r.to};})()')
                        expected={'1y':365,'3y':1095,'5y':1825}[period]
                        for _ in range(20):
                            if visible['spanDays']>=expected*.97:break
                            await asyncio.sleep(.5)
                            visible=await ev('(()=>{let r=qaLiveChart.timeScale().getVisibleRange();function day(t){if(typeof t==="string")return Date.parse(t);if(typeof t==="number")return t*1000;return Date.UTC(t.year,t.month-1,t.day);}return {bars:qaLiveBars,spanDays:(day(r.to)-day(r.from))/86400000,from:r.from,to:r.to};})()')
                        assert visible['spanDays']>=expected*.97,(screen,width,period,visible)
                        ranges.append({'period':period,**visible})
                    await ev('document.getElementById("'+prefix+'TrendToggle").click()')
                    await wait('!document.querySelector("#'+host+' .nine-trend-bands")')
                    await ev('document.getElementById("'+prefix+'TrendToggle").click()')
                    await wait('document.querySelectorAll("#'+host+' .nine-trend-bands").length===1')
                    await ev('window.scrollBy(0,document.getElementById("'+host+'").getBoundingClientRect().top-150)')
                    shot=await call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
                    (OUT/f'live-{prefix}-{width}-detail.png').write_bytes(base64.b64decode(shot['data']))
                    result=await ev('(()=>{let c=document.getElementById("'+host+'");return {bands:c.querySelectorAll(".nine-trend-bands").length,lanes:c.querySelectorAll(".nine-trend-lane").length,tips:c.querySelectorAll(".nine-supply-tip").length,width:c.clientWidth,summary:c.querySelector(".nine-trend-current").innerText};})()')
                    assert result['bands']==1 and result['lanes']==4 and result['tips']==1 and result['width']<=width,result
                    assert await ev('document.querySelectorAll("#'+host+' .nine-trend-box strong").length')==4
                    assert await ev('Array.from(document.querySelectorAll("#'+host+' .nine-trend-box strong")).every(x=>["상승","하락","중립","자료 부족"].includes(x.textContent))')
                    if prefix=='ss':
                        await wait('!!document.querySelector("#order-book .ob-trades")')
                        layout=await ev('(()=>{let p=document.querySelector(".ss-panel-left"),ob=document.getElementById("order-book");return {left:p.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,asks:ob.querySelectorAll(".ob-row-ask").length,bids:ob.querySelectorAll(".ob-row-bid").length,trades:!!ob.querySelector(".ob-trades"),header:!!ob.querySelector(".ob-header"),legend:document.querySelector(".nine-trace-legend").textContent};})()')
                        assert not layout['overflow'],layout
                        if width==1440:assert 390<=layout['left']<=400,layout
                        assert layout['asks']==10 and layout['bids']==10 and layout['trades'] and layout['header'],layout
                        assert layout['legend']=='● 거래량  ■ 장기선  ▲ 회복',layout
                        await ev('window.scrollBy(0,document.getElementById("order-book").getBoundingClientRect().top-40)')
                        shot=await call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
                        (OUT/f'live-orderbook-{width}.png').write_bytes(base64.b64decode(shot['data']))
                        result['orderbook']=layout
                    results.append({'screen':screen,'viewport':width,'defaults':defaults,'ranges':ranges,**result})
                    print('PASS',screen,width)
            (OUT/'live-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
    finally:proc.terminate()


if __name__=='__main__':asyncio.run(main())
