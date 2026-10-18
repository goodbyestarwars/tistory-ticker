"""Read-only browser QA using synthetic fixtures; requires websockets and Edge.

Set NINEPAY_QA_BROWSER / NINEPAY_QA_DIR to override browser and scratch output.
No broker calls or production writes are made.
"""
import asyncio
import os
import base64
import json
from pathlib import Path
import subprocess
import urllib.request
import websockets

REPO = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get('NINEPAY_QA_DIR', str(REPO.parent / 'work/ninepay-qa')))
(ROOT / 'work').mkdir(parents=True, exist_ok=True)
(ROOT / 'outputs').mkdir(exist_ok=True)
EDGE = os.environ.get('NINEPAY_QA_BROWSER', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')


async def main():
    process = subprocess.Popen([EDGE, '--headless=new', '--disable-gpu', '--no-first-run',
        '--remote-debugging-port=9247', '--user-data-dir=' + str(ROOT / 'work/edge-cdp-np'),
        '--allow-file-access-from-files', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            try:
                with urllib.request.urlopen('http://127.0.0.1:9247/json/list') as r:
                    targets = json.load(r)
                break
            except OSError:
                await asyncio.sleep(.1)
        target = next(t for t in targets if t['type'] == 'page')
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=30_000_000) as ws:
            seq = 0
            async def call(method, params=None):
                nonlocal seq
                seq += 1
                await ws.send(json.dumps({'id':seq,'method':method,'params':params or {}}))
                while True:
                    msg = json.loads(await ws.recv())
                    if msg.get('id') == seq:
                        if 'error' in msg:
                            raise RuntimeError(msg)
                        return msg.get('result', {})
            async def evaluate(expression):
                r = await call('Runtime.evaluate', {'expression':expression, 'returnByValue':True, 'awaitPromise':True})
                if 'exceptionDetails' in r:
                    raise AssertionError(r)
                return r['result'].get('value')
            reports = []
            for mode, width in [('active',1440),('active',390),('closed',390),('missing',390),('error',390),('legacy',1440)]:
                height = 1100
                await call('Emulation.setDeviceMetricsOverride', {'width':width,'height':height,'deviceScaleFactor':1,'mobile':width<500})
                await call('Page.navigate', {'url':(REPO / 'test/ninepay-scanner.html').as_uri()+'?mode='+mode})
                await asyncio.sleep(1)
                checks = json.loads(await evaluate("document.getElementById('qa-results').textContent"))
                assert all(checks[k] for k in ['defaultShort','newFirst','swing','long','legacyShort','safeOrder','signalDedup']), checks
                assert not checks['overflow'], checks
                expected={'active':'장중 감시 중','closed':'휴장·장외 대기','missing':'장중 데이터 미수신','error':'API 오류','legacy':'A/B 기준 미반영'}[mode]
                assert expected in checks['state'], checks
                actual_width = await evaluate('innerWidth')
                assert actual_width == width, (mode, width, actual_width, await evaluate('document.documentElement.scrollWidth'))
                dimensions = await call('Page.getLayoutMetrics')
                shot = await call('Page.captureScreenshot', {'format':'png','captureBeyondViewport':True,'clip':{
                    'x':0,'y':0,'width':width,'height':min(2400,dimensions['cssContentSize']['height']),'scale':1}})
                (ROOT/'outputs'/f'ninepay-{mode}-{width}.png').write_bytes(base64.b64decode(shot['data']))
                if mode == 'active' and width == 390:
                    scroll = await evaluate("(async()=>{let b=document.querySelector('.np-table tbody');b.style.scrollBehavior='auto';b.scrollLeft=b.scrollWidth;let before=b.scrollLeft;fixtureRow.price++;document.querySelector('[data-tab=\"ninepayLive\"]').click();await new Promise(r=>setTimeout(r,120));return {before:before,after:document.querySelector('.np-table tbody').scrollLeft,width:b.clientWidth,total:b.scrollWidth}})()")
                    assert scroll['before'] > 0 and abs(scroll['before']-scroll['after'])<3, scroll
                    checks['cardScrollPreserved']=True
                if mode == 'active' and width == 1440:
                    reused = await evaluate("(async()=>{document.querySelector('[data-np-code]').click();await new Promise(r=>setTimeout(r,120));return qaRequests.some(u=>u.includes('/flow-chart/005930'))})()")
                    assert reused
                    checks['existingChartReused']=True
                checks.pop('requests',None)
                reports.append({'width':width,**checks})
            (ROOT/'work/ninepay-browser-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
            print('Browser cases passed:',len(reports),'(1440px desktop / 390px emulated mobile)')
    finally:
        process.terminate()


if __name__ == '__main__':
    asyncio.run(main())
