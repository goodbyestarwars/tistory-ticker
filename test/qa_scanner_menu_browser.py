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
ROOT = Path(os.environ.get('SCANNER_QA_DIR', str(REPO.parents[1] / 'outputs/scanner-menu-dashboard')))
(ROOT / 'work').mkdir(parents=True, exist_ok=True)
(ROOT / 'outputs').mkdir(exist_ok=True)
EDGE = os.environ.get('NINEPAY_QA_BROWSER', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')


async def main():
    base = os.environ.get('SCANNER_MENU_BASE_REF', '0da47273')
    for extension in ['js', 'css']:
        (REPO.parent / ('scanner-menu-before.' + extension)).write_bytes(subprocess.check_output(
            ['git', 'show', base + ':' + extension + '/pattern-scan.' + extension], cwd=REPO))
    fixture = (REPO / 'test/scanner-five-groups.html').read_text(encoding='utf-8')
    for version in ['before', 'after']:
        html = fixture.replace('../style.css', (REPO/'style.css').as_uri()).replace('../css/ui-system.css', (REPO/'css/ui-system.css').as_uri())
        for extension in ['js', 'css']:
            path = REPO.parent/('scanner-menu-before.' + extension) if version == 'before' else REPO/extension/('pattern-scan.' + extension)
            html = html.replace('../' + extension + '/pattern-scan.' + extension, path.as_uri())
        (REPO.parent/('scanner-menu-' + version + '.html')).write_text(html, encoding='utf-8')
    process = subprocess.Popen([EDGE, '--headless=new', '--disable-gpu', '--no-first-run',
        '--remote-debugging-port=9254', '--user-data-dir=' + str(REPO.parent / 'edge-scanner-five'),
        '--allow-file-access-from-files', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(80):
            try:
                with urllib.request.urlopen('http://127.0.0.1:9254/json/list') as r:
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

            reports=[]
            for version in ['before','after']:
                for width in [1440,768,390,320]:
                    await call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':False})
                    await call('Page.navigate',{'url':(REPO.parent/('scanner-menu-'+version+'.html')).as_uri()})
                    await asyncio.sleep(.4)
                    for group,tab in [('short','liveFlow'),('short','trendBreakout'),('swing','bottomFormation'),('swing','pullbackRebreak'),('long','longTermQuality')]:
                        await evaluate('document.querySelector(`[data-horizon="'+group+'"]`).click();document.querySelector(`[data-tab="'+tab+'"]`).click();')
                        await asyncio.sleep(.05)
                        metrics=await evaluate('(()=>{let r=document.getElementById("pattern-scan"),l=document.getElementById("psList"),t=document.querySelector(".ps-subnav .ps-tab.active"),d=document.querySelector(".ps-tab-desc");return {height:l.getBoundingClientRect().top-r.getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth,rows:Array.from(l.querySelectorAll(".ps-item")).map(e=>e.dataset.code),menu:Array.from(r.querySelectorAll("[data-tab]")).filter(e=>!e.hidden).length,closed:!document.querySelector(".ps-condition-fold[open]")&&!document.querySelector(".ps-review-fold[open]"),radius:t&&getComputedStyle(t).borderRadius,descBorder:d&&getComputedStyle(d).borderTopWidth,errors:qaErrors};})()')
                        assert not metrics['errors'],metrics
                        if version=='after':
                            if metrics['overflow']:
                                metrics['width']=width
                                metrics['overflowElements']=await evaluate('Array.from(document.querySelectorAll("#pattern-scan *")).filter(e=>e.getBoundingClientRect().right>innerWidth).slice(0,12).map(e=>({tag:e.tagName,text:e.textContent.slice(0,120),parent:e.parentElement.className,cls:e.className,right:e.getBoundingClientRect().right,width:e.clientWidth}))')
                            assert not metrics['overflow'],metrics
                            assert metrics['height']<280 and metrics['radius']=='0px' and metrics['descBorder']=='0px' and metrics['closed'],metrics
                            before=next(r for r in reports if r['version']=='before' and r['width']==width and r['tab']==tab)
                            assert before['rows']==metrics['rows'] and metrics['height']<before['height'],(before,metrics)
                            for dark in [False,True]:
                                await evaluate('document.documentElement.classList.toggle("dark",'+str(dark).lower()+')')
                                assert not await evaluate('document.documentElement.scrollWidth>innerWidth')
                            await evaluate('document.documentElement.classList.remove("dark")')
                            if width in [1440,390]:
                                png=(await call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False}))['data']
                                (ROOT/(tab+'-'+str(width)+'.png')).write_bytes(base64.b64decode(png))
                        reports.append(dict(version=version,width=width,tab=tab,**metrics))
            await evaluate('document.querySelector(".ps-condition-fold summary").click()')
            assert await evaluate('!!document.querySelector(".ps-condition-fold[open] .ps-condition-body")')
            await evaluate('document.querySelector(".ps-review-fold summary").click()')
            assert await evaluate('!!document.querySelector(".ps-review-fold[open]")')
            await evaluate('document.querySelector(`[data-horizon="short"]`).click();document.querySelector(`[data-horizon="short"]`).dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));')
            assert await evaluate('document.activeElement.dataset.horizon')=='swing'
            await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))')
            assert await evaluate('document.activeElement.dataset.horizon')=='long'
            await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true}))')
            assert await evaluate('document.activeElement.dataset.horizon')=='short'
            await evaluate('document.querySelector(`[data-tab="liveFlow"]`).dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));')
            assert await evaluate('document.activeElement.dataset.tab')=='trendBreakout'
            await evaluate('document.querySelector(`[data-view="all"]`).dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}));')
            assert await evaluate('document.activeElement.getAttribute("aria-selected")')=='true'
            assert await evaluate('document.activeElement.dataset.view')=='failed'
            (ROOT/'layout-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
            print('PASS 40 before/after layouts, unchanged rows, 320/390/768/1440 widths, light/dark, collapsed/expanded, keyboard navigation')

    finally:
        process.terminate()


if __name__ == '__main__':
    asyncio.run(main())
