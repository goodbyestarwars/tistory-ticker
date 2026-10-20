"""Major-wave preflight/live QA on both production chart pages (no order actions).
CHART_OBS_LOCAL=1 substitutes only local frontend assets before master deployment.
Checks desktop/mobile touch, 1/3/5y, historical dates, tooltips and preserved controls.
"""
import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import websockets

REPO=Path(__file__).resolve().parents[1]
OUT=REPO.parents[1]/'outputs/major-wave-20261020'
LOCAL=os.environ.get('CHART_OBS_LOCAL')=='1'
ASSETS=['js/chart-core.js','js/chart-wave-overlay.js','js/stock-search.js','js/foreign-flow.js','css/stock-search.css','css/order-book.css']
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
                await call('Emulation.setTouchEmulationEnabled',{'enabled':width==390})
                for screen,prefix,host in [('stock-search','ss','ssChart'),('foreign-flow','ff','ffLwChart')]:
                    print('START',screen,width,flush=True)
                    await call('Page.navigate',{'url':'https://ghlee.tistory.com/page/'+screen+'?code=011200&name=HMM'})
                    if prefix=='ff':
                        await wait('!!document.querySelector("#foreign-flow [data-view=chart]")')
                        await ev('document.querySelector("#foreign-flow [data-view=chart]").click()')
                    await wait('!!window.NineChartCore && !!document.querySelector("#'+host+' canvas")')
                    assert await ev('NineChartCore.VERSION')=='2026-10-20-major-context-8'
                    assert await ev('document.querySelectorAll("[id$=TrendToggle], .nine-trend-bands, .nine-trend-boxes").length')==0
                    await ev('NineChartCore.loadModule("wave")')
                    await ev('window.qaWave=null;window.qaOpts=null;let attach=NineChartWave.attach;NineChartWave.attach=function(opts){qaOpts=opts;qaWave=attach(opts);return qaWave;}')
                    toggle='ssAutoWaveToggle' if prefix=='ss' else 'ffWaveToggle'
                    await ev('document.getElementById("'+toggle+'").click()')
                    await wait('!!qaWave && !!qaWave.picked()')
                    await ev('document.querySelector("[data-wave-level=major]").click()')
                    await wait('qaWave.picked().level==="major" && document.querySelectorAll("#'+host+' .nine-wave-tip").length===1')
                    ranges=[]
                    for period in ('1y','3y','5y'):
                        print('RANGE',screen,width,period,flush=True)
                        assert await ev('(()=>{let b=Array.from(document.getElementById("'+host+'").parentElement.querySelectorAll("[data-range]")).find(x=>x.dataset.range==="'+period+'");if(b){b.click();return true;}return false;})()')
                        await wait('!!qaWave && !!qaWave.picked() && !!document.querySelector("#'+host+' .nine-wave-tip")')
                        await wait('(()=>{let s=document.getElementById("'+host+'").parentElement.querySelector(".nine-chart-range-status");return !s || !s.textContent.includes("불러오는");})()')
                        await asyncio.sleep(1)
                        expression='(()=>{let r=qaOpts.ctl.shapes.chart.timeScale().getVisibleRange();function day(t){if(typeof t==="string")return Date.parse(t);if(typeof t==="number")return t*1000;return Date.UTC(t.year,t.month-1,t.day);}return {bars:qaOpts.bars.length,spanDays:(day(r.to)-day(r.from))/86400000,from:r.from,to:r.to};})()'
                        visible=await ev(expression)
                        for _ in range(24):
                            if visible['spanDays']>={'1y':365,'3y':1095,'5y':1825}[period]*.97:break
                            await asyncio.sleep(.5);visible=await ev(expression)
                        assert visible['spanDays']>={'1y':365,'3y':1095,'5y':1825}[period]*.97,visible
                        assert await ev('document.querySelectorAll("#'+host+' .nine-wave-tip").length')==1
                        assert await ev('document.querySelectorAll("#'+host+' .nine-supply-tip").length')==1
                        assert await ev('Object.keys(qaWave.analysis().levels).join(",")')=='major,medium,minor'
                        ranges.append({'period':period,**visible})
                    await ev('window.scrollBy(0,document.getElementById("'+host+'").getBoundingClientRect().top-150)')
                    point=await ev('(()=>{let s=qaOpts.ctl.shapes,i=s.bars.length-60,b=s.bars[i],r=document.getElementById("'+host+'").querySelector("canvas").getBoundingClientRect();return {x:r.left+s.chart.timeScale().timeToCoordinate(b.date),y:r.top+s.series.priceToCoordinate(b.close),date:b.date};})()')
                    if width==390:
                        await call('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':point['x'],'y':point['y']}]})
                        await asyncio.sleep(.8)
                        await call('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                    else:
                        await call('Input.dispatchMouseEvent',{'type':'mouseMoved','x':point['x']-20,'y':point['y']-20})
                        await call('Input.dispatchMouseEvent',{'type':'mouseMoved','x':point['x'],'y':point['y']})
                    await wait('document.querySelector("#'+host+' .nine-wave-tip").style.display==="block" && document.querySelector("#'+host+' .nine-wave-tip").textContent.includes("'+point['date']+' 당시 자료 기준")')
                    tip=await ev('document.querySelector("#'+host+' .nine-wave-tip").textContent')
                    assert point['date']+' 당시 자료 기준' in tip,tip
                    assert '화면 영역은 현재 자료로 재구성한 파동' in tip,tip
                    shot=await call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
                    (OUT/f'major-{prefix}-{width}.png').write_bytes(base64.b64decode(shot['data']))
                    # 규모 전환과 반복 토글 시 툴팁/구독을 중복 생성하지 않는다.
                    await ev('document.querySelector("[data-wave-level=minor]").click()')
                    await wait('qaWave.picked().level==="minor" && !document.querySelector("#'+host+' .nine-wave-tip")')
                    await ev('document.querySelector("[data-wave-level=medium]").click()')
                    await wait('qaWave.picked().level==="medium"')
                    await ev('document.querySelector("[data-wave-level=major]").click()')
                    await wait('document.querySelectorAll("#'+host+' .nine-wave-tip").length===1')
                    await ev('document.getElementById("'+toggle+'").click()')
                    await wait('!document.querySelector("#'+host+' .nine-wave-tip")')
                    await ev('document.getElementById("'+toggle+'").click()')
                    await wait('document.querySelectorAll("#'+host+' .nine-wave-tip").length===1')
                    assert not await ev('document.documentElement.scrollWidth>innerWidth')
                    assert await ev('!!document.getElementById("'+prefix+'MovingAverageToggle")')
                    # 같은 차트에서 확대/축소하고 파동 자료·저장된 작도/설정이 그대로인지 확인한다.
                    saved=await ev('JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>!k.includes("cache"))))')
                    zoom=await ev('(async()=>{let c=document.getElementById("'+host+'"),t=qaOpts.ctl.shapes.chart.timeScale(),r=t.getVisibleLogicalRange(),before=r.to-r.from;NineChartCore.zoomBars(c,.8);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));let a=t.getVisibleLogicalRange();NineChartCore.zoomBars(c,1.25);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));let b=t.getVisibleLogicalRange();return {before,after:a.to-a.from,restored:b.to-b.from};})()')
                    assert zoom['after']<zoom['before'] and abs(zoom['restored']-zoom['before'])<.01,zoom
                    assert saved==await ev('JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>!k.includes("cache"))))')
                    assert await ev('!!qaOpts.ctl.shapes.lines && !!qaOpts.ctl.setMode')
                    result={'screen':screen,'width':width,'ranges':ranges,'tip':tip,'noSeparateTrend':True}
                    results.append(result);print('PASS',screen,width,flush=True)
            (OUT/'live-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
    finally:proc.terminate()


if __name__=='__main__':asyncio.run(main())
