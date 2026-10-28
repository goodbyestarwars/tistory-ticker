"""Offline unified scanner QA: desktop/mobile, themes, failures, filters, zero, Shadow."""
import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import websockets

REPO = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('CONFIRMATION_QA_DIR', str(REPO.parent/'confirmation-qa')))
FIXTURE = Path(os.environ.get('CONFIRMATION_FIXTURE',str(REPO/'test/scanner-states.html')))
BASELINE = os.environ.get('CONFIRMATION_BASELINE')=='1'


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    edge = os.environ.get('NINEPAY_QA_BROWSER', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    process = subprocess.Popen([edge, '--headless=new', '--disable-gpu', '--no-first-run',
        '--remote-debugging-port=9258', '--user-data-dir='+str(REPO.parent/'edge-scanner-states'),
        '--allow-file-access-from-files', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            try:
                with urllib.request.urlopen('http://127.0.0.1:9258/json/list') as r:
                    targets = json.load(r)
                break
            except OSError:
                await asyncio.sleep(.1)
        target = next(t for t in targets if t['type']=='page')
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=30_000_000) as ws:
            seq = 0
            async def call(method, params=None):
                nonlocal seq
                seq += 1
                await ws.send(json.dumps(dict(id=seq, method=method, params=params or {})))
                while True:
                    msg = json.loads(await ws.recv())
                    if msg.get('id')==seq:
                        assert 'error' not in msg, msg
                        return msg.get('result', {})
            async def evaluate(js):
                r = await call('Runtime.evaluate', dict(expression=js, returnByValue=True, awaitPromise=True))
                assert 'exceptionDetails' not in r, r
                return r['result'].get('value')
            shell = (REPO/'js/skin-shell.js').read_text(encoding='utf8')
            common = '\n'.join('/* '+name+':'+shell.split('/* '+name+':')[1].split('/* End '+name+' */')[0]
                               for name in ('NineHttp','NineUI','NineAPI'))
            await call('Page.enable')
            await call('Page.addScriptToEvaluateOnNewDocument', {'source':common})
            reports = []
            for width in (1440,375):
                for theme in ('light','dark'):
                    modes=('active',) if BASELINE else ('active','shadow','delayed','partial','error','closed','legacy','zero','missing','running','waiting','failed','holiday','unknown','stale','history','metadata')
                    for mode in modes:
                        await call('Emulation.setDeviceMetricsOverride', dict(width=width,height=1000,deviceScaleFactor=1,mobile=width<500))
                        await call('Page.navigate', {'url':FIXTURE.as_uri()+'?mode='+mode})
                        for attempt in range(50):
                            if await evaluate('window.mode==='+json.dumps(mode)+' && !!window.PatternScan && !!document.querySelector("#psList") && !!window.PatternScan.publicSummary'):
                                break
                            await asyncio.sleep(.1)
                        await asyncio.sleep(.2)
                        if theme=='dark':
                            await evaluate("document.documentElement.classList.add('dark')")
                        result=await evaluate('({rows:document.querySelectorAll("#psList .ps-state-row").length,overflow:document.documentElement.scrollWidth>innerWidth,errors:qaErrors,text:document.querySelector("#psList").innerText})')
                        assert not result['overflow'] and not result['errors'], result
                        if not BASELINE:
                            received=await evaluate('PatternScan.publicSummary.counts')
                            labels=await evaluate('Object.fromEntries(Array.from(document.querySelectorAll("[data-status-count]")).map(el=>[el.dataset.statusCount,el.textContent]))')
                            for key in ('all','confirmed','observation','research','excluded','expired'):
                                expected=sum(received[k] for k in ('confirmed','observation','research')) if key=='all' else received[key]
                                assert labels[key]=='('+str(expected)+')',(key,labels,received)
                            assert await evaluate('!!document.querySelector(".scan-progress-bolt path")')
                            assert not await evaluate('!!document.querySelector(\'#psList [data-code="399999"],#psList [data-code="388888"]\')')
                            assert not await evaluate('qaRequests.some(u=>/order|buy_limit|sell_limit/.test(u))')
                            if mode in ('active','shadow','zero'):
                                counts=await evaluate('PatternScan.publicSummary')
                                assert counts['known'],counts
                                assert counts['counts']['confirmed']==(1 if mode=='active' else 0),counts
                                assert '100%' in await evaluate('document.querySelector(".scan-status-panel").innerText')
                                for status in ('confirmed','observation','research','excluded','expired','all'):
                                    await evaluate('document.querySelector(\'[data-status="'+status+'"]\').click()')
                                    number=await evaluate('document.querySelectorAll("#psList .ps-state-row").length')
                                    expected=sum(counts['counts'][k] for k in ('confirmed','observation','research')) if status=='all' else counts['counts'][status]
                                    assert number==expected,(status,number,expected)
                                if mode=='active':
                                    assert await evaluate('!!document.querySelector(\'#psList [data-code="377777"]\')')
                                    requests=await evaluate('qaRequests.length')
                                    for status in ('research','observation','all'):
                                        await evaluate('document.querySelector(\'[data-status="'+status+'"]\').click()')
                                    assert requests==await evaluate('qaRequests.length'),'filters must reuse cached data'
                                    for group in ('swing','long','short'):
                                        await evaluate('document.querySelector(\'[data-horizon="'+group+'"]\').click()')
                                        assert not await evaluate('document.documentElement.scrollWidth>innerWidth')
                                    await evaluate('document.querySelector(".ps-research-tools").open=true')
                                    assert await evaluate('!!document.querySelector("#psSourceHistory select")')
                                    await evaluate('document.querySelector(".ps-research-tools").open=false')
                                    await evaluate('window.qaRefreshes=0;var originalRefresh=PatternScan.refresh;PatternScan.refresh=function(){qaRefreshes++;originalRefresh();};NineHttp.clearCache();job.lastExecution.finishedAt=new Date((now-29)*1000).toISOString();qaTimers.find(t=>t.ms===60000 && t.fn.toString().includes("/health/schedules")).fn()')
                                    await asyncio.sleep(.15)
                                    assert await evaluate('qaRefreshes')==1,'a new batch completion must refresh the scanner'
                            if mode in ('partial','error','legacy','missing'):
                                assert not (await evaluate('PatternScan.publicSummary'))['known']
                                assert await evaluate('document.querySelector(\'[data-status-count="confirmed"]\').textContent')=='('+str((await evaluate('PatternScan.publicSummary'))['counts']['confirmed'])+')'
                                assert '집계 확인 중' in await evaluate('document.querySelector("#psConfirmationStatus").textContent')
                            if mode in ('delayed','partial','closed','legacy','error'):
                                assert await evaluate('PatternScan.publicSummary.counts.confirmed')==0
                            if mode=='history':
                                assert await evaluate('!!document.querySelector(`#psList [data-code="012345"]`)')
                                assert await evaluate('PatternScan.publicSummary.counts.confirmed')==1
                                assert '과거 돌파 성공' in result['text']
                            if mode=='metadata':
                                assert await evaluate('SCANNER_SECURITY_TYPES.spacCodes.length')>0
                                assert await evaluate('PatternScan.publicSummary.counts.confirmed')==1
                            if mode=='stale':
                                assert '갱신' in await evaluate('document.querySelector(".scan-status-panel").innerText')
                            if mode=='failed':
                                assert '합성 실행 오류' in await evaluate('document.querySelector(".scan-status-panel").innerText')
                        if mode in ('active','shadow'):
                            metrics=await call('Page.getLayoutMetrics')
                            size=metrics['cssContentSize']
                            shot=await call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True,'clip':dict(x=0,y=0,width=size['width'],height=size['height'],scale=1)})
                            (OUT/(f'scanner-{width}-{theme}'+('-shadow' if mode=='shadow' else '')+'.png')).write_bytes(base64.b64decode(shot['data']))
                        reports.append(dict(width=width,theme=theme,mode=mode,**result))
            (OUT/'browser-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf8')
            print('PASS',len(reports),'offline browser cases')
    finally:
        process.terminate()


if __name__=='__main__':
    asyncio.run(main())
