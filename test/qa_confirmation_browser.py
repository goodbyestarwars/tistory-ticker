"""Synthetic, offline PC/mobile QA. No live broker calls or order endpoints."""
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
FIXTURE = Path(os.environ.get('CONFIRMATION_FIXTURE',str(REPO/'test/confirmation-scanner.html')))
BASELINE = os.environ.get('CONFIRMATION_BASELINE')=='1'


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    edge = os.environ.get('NINEPAY_QA_BROWSER', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    process = subprocess.Popen([edge, '--headless=new', '--disable-gpu', '--no-first-run',
        '--remote-debugging-port=9257', '--user-data-dir='+str(REPO.parent/'edge-confirmation'),
        '--allow-file-access-from-files', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            try:
                with urllib.request.urlopen('http://127.0.0.1:9257/json/list') as r:
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
            for width in (1440,390):
                for mode in ('active','delayed','partial','error','closed','legacy'):
                    await call('Emulation.setDeviceMetricsOverride', dict(width=width,height=1000,deviceScaleFactor=1,mobile=width<500))
                    await call('Page.navigate', {'url':FIXTURE.as_uri()+'?mode='+mode})
                    await asyncio.sleep(1.5)
                    result = await evaluate('({rows:document.querySelectorAll("#psList .ps-state-row").length,overflow:document.documentElement.scrollWidth>innerWidth,errors:qaErrors,text:document.querySelector("#psList").innerText})')
                    assert not result['overflow'] and not result['errors'], result
                    if mode=='active' and not BASELINE:
                        assert result['rows']==1, result
                        assert 'A/B' in result['text'],result
                        assert await evaluate('PatternScan.publicSummary.counts.confirmed')==1
                    if not BASELINE and mode in ('delayed','partial','closed','legacy'):
                        # Synthetic daily results can remain available, but
                        # an unavailable intraday feed must never yield A/B.
                        assert await evaluate('PatternScan.publicSummary.counts.confirmed')==0,result
                    if mode=='active':
                        shot = await call('Page.captureScreenshot', {'format':'png','captureBeyondViewport':True})
                        (OUT/f'confirmation-{width}.png').write_bytes(base64.b64decode(shot['data']))
                        if BASELINE:
                            reports.append(dict(width=width,mode=mode,**result))
                            continue
                        for group,tab in ([] if BASELINE else [('swing','bottomFormation'),('long','longTermQuality')]):
                            await evaluate('document.querySelector(\'[data-horizon="'+group+'"]\').click()')
                            await evaluate('document.querySelector(\'[data-tab="'+tab+'"]\').click()')
                            assert await evaluate('document.querySelectorAll("#psList .ps-state-row").length')==1
                        await evaluate('document.querySelector(\'[data-horizon="short"]\').click()')
                        await evaluate("document.querySelector('[data-status=research]').click()")
                        assert await evaluate('document.querySelector("[data-status=research]").getAttribute("aria-pressed")')=='true'
                        assert not await evaluate('qaRequests.some(u=>/order|buy_limit|sell_limit/.test(u))')
                    reports.append(dict(width=width,mode=mode,**result))
            (OUT/'browser-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf8')
            print('PASS',len(reports),'offline browser cases')
    finally:
        process.terminate()


if __name__=='__main__':
    asyncio.run(main())
