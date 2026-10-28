"""Real chart engine + local synthetic data. Never calls broker or order APIs."""
import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import websockets

REPO = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('SCANNER_INLINE_QA_DIR', REPO.parent/'scanner-inline-qa'))


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    library = Path(os.environ.get('NINEPAY_QA_LWC', REPO.parent/'lightweight-charts-5.2.js'))
    if not library.exists():
        library.write_bytes(urllib.request.urlopen('https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js', timeout=30).read())
    shell = (REPO/'js/skin-shell.js').read_text(encoding='utf8')
    common = '\n'.join('/* '+name+':'+shell.split('/* '+name+':')[1].split('/* End '+name+' */')[0] for name in ('NineHttp','NineUI','NineAPI'))
    modules = '\n'.join((REPO/'js'/name).read_text(encoding='utf8') for name in ['chart-core.js','chart-data.js','chart-drawing.js','chart-memo.js','chart-sr.js'])
    setup = '''window.qaCharts=[];window.qaMaSeries=[];
      var originalRegister=NineChartCore.registerChart;
      NineChartCore.registerChart=function(el,chart,opts){qaChart=chart;qaCharts.push(chart);return originalRegister(el,chart,opts);};
      var originalMa=NineChartCore.addMovingAverageLine;
      NineChartCore.addMovingAverageLine=function(){var series=originalMa.apply(this,arguments);qaMaSeries.push(series);return series;};
      document.addEventListener('DOMContentLoaded',function(){var link=document.createElement('link');link.rel='stylesheet';link.href=QA_STYLE;link.setAttribute('data-dashboard-enhancements-style','1');document.head.appendChild(link);});
    '''.replace('QA_STYLE', json.dumps((REPO/'css/dashboard-enhancements.css').as_uri()))
    preload = common+'\n'+library.read_text(encoding='utf8')+'\n'+modules+'\n'+setup+'\n'+(REPO/'js/dashboard-enhancements.js').read_text(encoding='utf8')
    edge = os.environ.get('NINEPAY_QA_BROWSER','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    process = subprocess.Popen([edge,'--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9261','--user-data-dir='+str(REPO.parent/'edge-scanner-inline'),'--allow-file-access-from-files','about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            try:
                targets=json.load(urllib.request.urlopen('http://127.0.0.1:9261/json/list'));break
            except OSError:
                await asyncio.sleep(.1)
        async with websockets.connect(next(t for t in targets if t['type']=='page')['webSocketDebuggerUrl'],max_size=40_000_000) as ws:
            seq=0
            async def call(method,params=None):
                nonlocal seq
                seq+=1;await ws.send(json.dumps(dict(id=seq,method=method,params=params or {})))
                while True:
                    msg=json.loads(await ws.recv())
                    if msg.get('id')==seq:
                        assert 'error' not in msg,msg
                        return msg.get('result',{})
            async def evaluate(js):
                r=await call('Runtime.evaluate',dict(expression=js,returnByValue=True,awaitPromise=True))
                assert 'exceptionDetails' not in r,r
                return r['result'].get('value')
            async def wait_for(js):
                for _ in range(100):
                    if await evaluate(js):return
                    await asyncio.sleep(.05)
                raise AssertionError('Timed out: '+js+' '+str(await evaluate('window.qaErrors')))
            await call('Page.enable')
            await call('Page.addScriptToEvaluateOnNewDocument',dict(source=preload))
            results=[]
            for width in (1440,375):
                for theme in ('light','dark'):
                    await call('Emulation.setDeviceMetricsOverride',dict(width=width,height=1000,deviceScaleFactor=1,mobile=width<500))
                    await call('Page.navigate',dict(url=(REPO/'test/scanner-states.html').as_uri()+'?mode=inline'))
                    await wait_for('window.mode==="inline" && !!document.querySelector(".ps-state-actions > button")')
                    await evaluate('localStorage.removeItem("tistory-ticker:pattern-drawings:005930:day");'+("document.documentElement.classList.add('dark');" if theme=='dark' else ''))
                    before=await evaluate('window.startY=scrollY;document.querySelector(\'.ps-state-row[data-code="005930"] .ps-state-actions > button\').click();startY')
                    await wait_for('!!document.querySelector(".ps-drawing-layer") && !document.querySelector("[data-ps-draw=line]").disabled')
                    assert await evaluate('document.querySelector("#psDetail").previousElementSibling.dataset.code')=='005930'
                    assert await evaluate('scrollY')==before,'opening an inline chart must not force page scrolling'
                    row_height=await evaluate('document.querySelector(\'.ps-state-row[data-code="005930"]\').getBoundingClientRect().height')
                    assert row_height<(150 if width>500 else 190)
                    assert await evaluate('document.querySelectorAll("#psDetail").length')==1
                    assert await evaluate('document.querySelectorAll("[data-ps-draw]").length')==7
                    assert await evaluate('document.querySelectorAll("[data-ps-ma]").length')==4
                    await evaluate('document.querySelector("[data-ps-ma=\\"5\\"]").click()')
                    assert not await evaluate('qaMaSeries[0].options().visible')
                    await evaluate('document.querySelector("[data-ps-ma=\\"5\\"]").click()')
                    assert await evaluate('qaMaSeries[0].options().visible')
                    assert await evaluate('qaChart.panes().length')==2
                    await evaluate('document.querySelector("[data-ps-volume]").click()')
                    assert await evaluate('qaChart.panes().length')==1
                    await evaluate('document.querySelector("[data-ps-volume]").click()')
                    assert await evaluate('qaChart.panes().length')==2
                    for selector in ('#psIchimokuToggle','#psBollingerToggle','#psSupportResistanceToggle','[data-ps-memo]'):
                        await evaluate('document.querySelector('+json.dumps(selector)+').click()')
                    await evaluate('document.querySelector("[data-ps-memo]").click()')
                    await evaluate('document.querySelector("#psChart").scrollIntoView({block:"center"})')
                    await asyncio.sleep(.15)
                    await evaluate('document.querySelector("[data-ps-draw=line]").click()')
                    rect=await evaluate('(()=>{var r=document.querySelector(".ps-drawing-layer").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()')
                    await call('Input.dispatchMouseEvent',dict(type='mousePressed',x=rect['x']+rect['w']*.3,y=rect['y']+rect['h']*.35,button='left',buttons=1,clickCount=1))
                    await call('Input.dispatchMouseEvent',dict(type='mouseMoved',x=rect['x']+rect['w']*.55,y=rect['y']+rect['h']*.55,button='left',buttons=1))
                    await call('Input.dispatchMouseEvent',dict(type='mouseReleased',x=rect['x']+rect['w']*.55,y=rect['y']+rect['h']*.55,button='left',buttons=0,clickCount=1))
                    await wait_for('JSON.parse(localStorage.getItem("tistory-ticker:pattern-drawings:005930:day") || "{}").lines?.length===1')
                    for tool in ('pencil','circle','box','hline','measure'):
                        await evaluate('document.querySelector("[data-ps-draw='+tool+']").click()')
                        assert await evaluate('document.querySelector("[data-ps-draw='+tool+']").getAttribute("aria-pressed")')=='true'
                    await evaluate('document.querySelector("[data-ps-memo]").click()')
                    assert not await evaluate('!!document.querySelector("[data-ps-draw][aria-pressed=true]")')
                    await evaluate('document.querySelector("[data-ps-draw=line]").click()')
                    assert await evaluate('document.querySelector("[data-ps-memo]").getAttribute("aria-pressed")')=='false'
                    await evaluate('document.querySelector(".ps-drawing-layer").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))')
                    assert not await evaluate('!!document.querySelector("[data-ps-draw][aria-pressed=true]")')
                    await evaluate('qaSavedChart=qaChart;NineHttp.clearCache();PatternScan.refresh()')
                    await asyncio.sleep(.3)
                    assert await evaluate('qaSavedChart===qaChart && document.querySelector("#psDetail").previousElementSibling.dataset.code==="005930"')
                    await wait_for('!!document.querySelector("#psDetail .de-expand-button")')
                    await evaluate('document.querySelector("#psDetail .de-expand-button").click()')
                    await wait_for('!!document.querySelector(".de-chart-overlay #psChart")')
                    await evaluate('NineHttp.clearCache();PatternScan.refresh()')
                    await asyncio.sleep(.2)
                    await evaluate('document.querySelector(".de-chart-restore").click()')
                    await wait_for('!document.querySelector(".de-chart-overlay") && document.querySelector("#psDetail").previousElementSibling?.dataset.code==="005930"')
                    await evaluate('document.querySelector("[data-ps-chart-next]").click()')
                    await wait_for('!!document.querySelector(".ps-drawing-layer") && document.querySelector("#psDetail").previousElementSibling?.dataset.code!=="005930"')
                    await evaluate('document.querySelector("#psClose").click()')
                    assert await evaluate('document.querySelector("#psDetail").hidden && !document.querySelector(".ps-drawing-layer")')
                    # A slow response for a previous stock must not replace the current one.
                    await evaluate('qaChartDelay=150;document.querySelector(\'.ps-state-row[data-code="005930"] .ps-state-actions > button\').click();document.querySelector(\'.ps-state-row[data-code="000660"] .ps-state-actions > button\').click()')
                    await wait_for('!!document.querySelector(".ps-drawing-layer") && document.querySelector("#psDetail").previousElementSibling?.dataset.code==="000660"')
                    assert '000660' in await evaluate('document.querySelector(".ps-detail-name").innerText')
                    assert not await evaluate('qaRequests.some(u=>/order|buy_limit|sell_limit/.test(u))')
                    assert not await evaluate('document.documentElement.scrollWidth>innerWidth')
                    assert not await evaluate('qaErrors')
                    await evaluate('document.querySelector("#psDetail").scrollIntoView({block:"start"})')
                    size=(await call('Page.getLayoutMetrics'))['cssContentSize']
                    shot=await call('Page.captureScreenshot',dict(format='png',captureBeyondViewport=True,clip=dict(x=0,y=0,width=size['width'],height=size['height'],scale=1)))
                    (OUT/f'inline-{width}-{theme}.png').write_bytes(base64.b64decode(shot['data']))
                    await evaluate('document.querySelector("[data-status=research]").click()')
                    assert await evaluate('document.querySelector("#psDetail").hidden')
                    await evaluate('document.querySelector("[data-status=all]").click();qaChartDelay=150;var button=document.querySelector(\'.ps-state-row[data-code="005930"] .ps-state-actions > button\');button.click();button.click()')
                    await asyncio.sleep(.25)
                    assert await evaluate('document.querySelector("#psDetail").hidden && !document.querySelector(".ps-drawing-layer")'),'closed chart must stay closed after a late response'
                    await evaluate('qaChartDelay=0;qaDaily[0].volume=null;document.querySelector(\'.ps-state-row[data-code="005930"] .ps-state-actions > button\').click()')
                    await wait_for('!!document.querySelector(".ps-drawing-layer")')
                    assert await evaluate('document.querySelector("[data-ps-volume]").disabled && qaChart.panes().length===1'),'missing volume must not be drawn as zero'
                    await evaluate('document.querySelector("#psClose").click()')
                    assert not await evaluate('qaErrors')
                    results.append(dict(width=width,theme=theme,rowHeight=row_height,inline=True,tools=True,refresh=True,fullscreen=True,staleResponseGuard=True))
            (OUT/'results.json').write_text(json.dumps(results,indent=2),encoding='utf8')
            print('PASS',len(results),'real-engine inline chart cases: layout, controls, drawing, refresh, fullscreen, switching, stale responses')
    finally:
        process.terminate()


if __name__=='__main__':
    asyncio.run(main())
