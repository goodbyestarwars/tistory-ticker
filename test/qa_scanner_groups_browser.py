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
ROOT = Path(os.environ.get('SCANNER_QA_DIR', str(REPO.parents[1] / 'outputs/scanner-five-groups')))
(ROOT / 'work').mkdir(parents=True, exist_ok=True)
(ROOT / 'outputs').mkdir(exist_ok=True)
EDGE = os.environ.get('NINEPAY_QA_BROWSER', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')


async def main():
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
            for mode,width in [('active',1440),('active',390),('closed',390),('missing',390),('stale',390),('loss',390),('error',390),('legacy',1440),('delayed',1440),('partial',390)]:
                await call('Emulation.setDeviceMetricsOverride',{'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<500})
                await call('Page.navigate',{'url':(REPO/'test/scanner-five-groups.html').as_uri()+'?mode='+mode})
                await asyncio.sleep(.6)
                async def click(selector):
                    await evaluate('document.querySelector('+json.dumps(selector)+').click()')
                    await asyncio.sleep(.1)
                for group,tab,expected in [('short','liveFlow',2),('short','trendBreakout',2),('swing','bottomFormation',2),('swing','pullbackRebreak',2),('long','longTermQuality',1)]:
                    await click('[data-horizon="'+group+'"]');await click('[data-tab="'+tab+'"]')
                    result=await evaluate('(()=>{let root=document.getElementById("pattern-scan");return {menu:Array.from(root.querySelectorAll("[data-tab]")).filter(x=>!x.hidden).length,total:root.querySelectorAll("[data-tab]").length,rows:Array.from(root.querySelectorAll("#psList .ps-item")).map(x=>x.dataset.code),text:root.querySelector("#psList").innerText,overflow:document.documentElement.scrollWidth>innerWidth,errors:qaErrors};})()')
                    assert result['menu']==expected and result['total']==5,result
                    assert len(result['rows'])==len(set(result['rows'])),result
                    assert not result['overflow'] and not result['errors'],result
                    if mode=='active':
                        needles={'liveFlow':['9Pay A/B','실시간 매집 의심','기존 매집봉 재상승'],'trendBreakout':['하락추세선 돌파','이평선 기울기 전환'],'bottomFormation':['저점상승','쌍바닥','역헤드앤숄더','박스권'],'pullbackRebreak':['이동평균 눌림목','첫 눌림목 재돌파','매집 관찰','상승 돌파','눌림 대기','지지 확인'],'longTermQuality':['ROE 12','부채비율 50','2분기 단독분기','제외 3']}
                        for needle in needles[tab]:assert needle in result['text'],(needle,result)
                        png=(await call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False}))['data']
                        (ROOT/'outputs'/f'{tab}-{width}.png').write_bytes(base64.b64decode(png))
                    if tab=='longTermQuality' and mode in ['missing','stale','loss']:assert result['rows']==[],result
                    if tab=='liveFlow' and mode in ['delayed','partial']:
                        assert '마지막 관측·기록 (신규 실시간 아님)' in result['text'],result
                        assert '실시간 확인 불가' in result['text'],result
                        if mode=='partial':assert '부분/전체 장애' in result['text'],result
                    reports.append({'mode':mode,'width':width,'tab':tab,'rows':result['rows'],'overflow':result['overflow']})
                # History/forward performance endpoints must keep the selected original key.
                await click('[data-horizon="swing"]')
                await evaluate('(()=>{let s=document.querySelector("[data-history-source]");s.value="doubleBottom";s.dispatchEvent(new Event("change"));})()')
                await click('[data-view="success"]')
                requests=await evaluate('qaRequests')
                assert any('scanner=pattern%3AdoubleBottom' in u for u in requests),requests
                assert not any('scanner=pattern%3AbottomFormation' in u for u in requests),requests
            (ROOT/'outputs/browser-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
            print('PASS',len(reports),'five-menu PC/mobile cases, tags/dedup, failed financials, original-source history')

    finally:
        process.terminate()


if __name__ == '__main__':
    asyncio.run(main())
