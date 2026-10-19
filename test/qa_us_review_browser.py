"""US analysis/fullscreen QA. Default overrides only changed assets and uses synthetic analysis.
US_REVIEW_LIVE=1 verifies deployed assets/API instead. Never submits orders.
"""
import asyncio
import base64
import json
import os
import subprocess
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import websockets

REPO = Path(__file__).resolve().parents[1]
OUT = REPO.parents[1] / 'outputs/us-review-20261020'
LIVE = os.environ.get('US_REVIEW_LIVE') == '1'
ASSETS = ['js/us-stocks.js', 'css/us-stocks.css', 'js/stock-search.js',
          'js/chart-core.js', 'js/chart-data.js', 'js/dashboard-enhancements.js',
          'css/dashboard-enhancements.css']
FIXTURE = {'symbol': 'INTC', 'instrument': {'quote_type': 'EQUITY'}, 'summary': {
    'recommendation': {'available': True, 'period': '2026-09-01', 'strongBuy': 4, 'buy': 15, 'hold': 34, 'sell': 2, 'strongSell': 0},
    'analyst_ratings': {'available': False, 'status': 'access_denied', 'items': []},
    'insider': {'available': True, 'buy_shares': 100, 'sell_shares': 20, 'buy_count': 1,
                'sell_count': 1, 'other_count': 1, 'from': '2026-07-23', 'to': '2026-10-20',
                'latest_filing': '2026-10-03', 'items': [{'name': 'SYNTHETIC QA INSIDER',
                    'transaction_date': '2026-10-01', 'filing_date': '2026-10-03', 'code': 'P',
                    'label': '공개시장·사적 매수', 'shares': 100, 'price': 10, 'currency': None,
                    'is_derivative': False, 'source_url': None}]}}}


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
        '--remote-debugging-port=9266', '--user-data-dir=' + str(REPO.parent/'edge-us-review'),
        'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9266/json/list'))
                break
            except OSError:
                await asyncio.sleep(.1)
        target = next(t for t in tabs if t['type'] == 'page' and t.get('url') == 'about:blank')
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=30_000_000) as ws:
            sequence = 0
            async def send(method, params):
                nonlocal sequence
                sequence += 1
                await ws.send(json.dumps({'id': sequence, 'method': method, 'params': params}))
                return sequence

            async def call(method, params=None):
                wanted = await send(method, params or {})
                while True:
                    msg = json.loads(await ws.recv())
                    if msg.get('method') == 'Fetch.requestPaused':
                        event = msg['params']; url = event['request']['url']; path = urlsplit(url).path
                        body, mime = None, None
                        for asset in ASSETS:
                            if path == '/tistory-ticker/' + asset:
                                body = (REPO/asset).read_bytes()
                                if asset == 'js/us-stocks.js':
                                    body = body.decode().replace('  global.UsStocks = {', '  global.reviewQa = {renderAnalysis:renderAnalysis};\n  global.UsStocks = {').encode()
                                mime = 'text/css' if asset.endswith('.css') else 'application/javascript'
                        if '/us-analysis/' in path:
                            body = json.dumps({'success': True, 'data': FIXTURE}).encode()
                            mime = 'application/json'
                        if body is None:
                            await send('Fetch.continueRequest', {'requestId': event['requestId']})
                        else:
                            await send('Fetch.fulfillRequest', {'requestId': event['requestId'], 'responseCode': 200,
                                'responseHeaders': [{'name': 'Content-Type', 'value': mime},
                                                    {'name': 'Access-Control-Allow-Origin', 'value': '*'}],
                                'body': base64.b64encode(body).decode()})
                    if msg.get('id') == wanted:
                        if 'error' in msg:
                            raise AssertionError(msg)
                        return msg.get('result', {})

            async def ev(expression):
                result = await call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True})
                if result.get('exceptionDetails'):
                    raise AssertionError(result)
                return result.get('result', {}).get('value')

            async def wait(expression, attempts=100):
                for _ in range(attempts):
                    if await ev(expression):
                        return
                    await asyncio.sleep(.25)
                raise AssertionError('Timed out: ' + expression)

            async def capture(name, selector):
                clip = await ev('(()=>{let r=document.querySelector(' + json.dumps(selector) + ').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:Math.min(r.height,1000),scale:1};})()')
                result = await call('Page.captureScreenshot', {'format': 'png', 'clip': clip, 'captureBeyondViewport': True})
                (OUT/name).write_bytes(base64.b64decode(result['data']))

            await call('Network.enable')
            await call('Network.setCacheDisabled', {'cacheDisabled': True})
            if not LIVE:
                await call('Fetch.enable', {'patterns': [
                    {'urlPattern': '*://goodbyestarwars.github.io/tistory-ticker/*'},
                    {'urlPattern': '*://goodbyestar.cloud/us-analysis/*'}]})
            results = []
            for width in [1440, 390]:
                await call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
                await call('Page.navigate', {'url': 'https://ghlee.tistory.com/page/stock-search?market=us&code=US:INTC'})
                await wait('!!document.querySelector(".us-consensus svg")')
                await ev('window.reviewErrors=[];addEventListener("error",e=>{if((e.filename||"").includes("tistory-ticker"))reviewErrors.push(e.message)});')
                await wait('!!document.querySelector("#usStocksChart canvas")')
                await wait('!!document.querySelector("#usStocksChart .de-expand-button")')
                check = await ev('(()=>{let c=document.querySelector("[data-analysis-card=recommendation]");return {label:c.querySelector("svg").getAttribute("aria-label"),source:c.querySelector("a").href,arcs:c.querySelectorAll("circle[stroke-dasharray]").length,ranges:document.querySelectorAll("#usStocksChart [data-range]").length};})()')
                assert check['label'] == '매수 19 · 보유 34 · 매도 2' and check['arcs'] == 3, check
                assert check['source'].endswith('recommendation?symbol=INTC') and check['ranges'] == 5, check
                if not LIVE:
                    available = json.loads(json.dumps(FIXTURE))
                    available['summary']['analyst_ratings'] = {'available': True, 'status': 'ready', 'items': [
                        {'company':'SYNTHETIC QA FIRM', 'fromGrade':'Sell', 'toGrade':'Hold', 'action':'up', 'gradeTime':1792368000}]}
                    await ev('reviewQa.renderAnalysis(' + json.dumps(available) + ')')
                    assert await ev('document.querySelector("[data-analysis-card=recommendation]").textContent.includes("SYNTHETIC QA FIRM")')
                    assert await ev('document.querySelector("[data-analysis-card=recommendation]").textContent.includes("매도 (Sell)")')
                    await ev('reviewQa.renderAnalysis(' + json.dumps(FIXTURE) + ')')
                await capture(('live-' if LIVE else 'fixture-') + 'analysis-' + str(width) + '.png', '#usStocksAnalysis')
                await ev('document.querySelector("[data-analysis-card=recommendation] details").open=true;document.querySelector("[data-analysis-card=insider] details").open=true;')
                assert await ev('document.querySelector("[data-analysis-card=insider]").innerText.includes("공시")')
                await ev('document.querySelector("[data-analysis-card=recommendation] details").open=false;document.querySelector("[data-analysis-card=insider] details").open=false;')
                for symbol in ['INTC', '042660']:
                    if symbol == '042660':
                        await ev('document.getElementById("ssInput").value="042660";document.getElementById("ssGoBtn").click()')
                        await wait('StockSearch.currentSelection().code==="042660"')
                        await wait('!!document.querySelector("#ssDetail #ssChart canvas")')
                    host = '#usStocksChart' if symbol == 'INTC' else '#ssDetail'
                    await ev('document.querySelector(' + json.dumps(host + ' [data-range="1m"]') + ').click()')
                    await ev('document.querySelector(' + json.dumps(host + ' .de-expand-button') + ').click()')
                    await wait('!!document.querySelector(".de-chart-overlay #ssChart canvas")')
                    await asyncio.sleep(.5)
                    metrics = await ev('(()=>{let o=document.querySelector(".de-chart-overlay"),b=o.querySelector(".de-chart-modal-body").getBoundingClientRect(),c=o.querySelector("#ssChart").getBoundingClientRect(),p=o.querySelector(".ss-panel-right,.us-stocks-chart-panel").getBoundingClientRect();return {body:b.height,chart:c.height,bottomGap:b.bottom-p.bottom,width:c.width,price:o.querySelector(".de-chart-stock-price").innerText,ranges:o.querySelectorAll("[data-range]").length};})()')
                    assert metrics['chart'] > metrics['body'] * (.5 if width == 1440 else .3) and abs(metrics['bottomGap']) < 65, metrics
                    if symbol == 'INTC':
                        assert metrics['price'].startswith('$'), metrics
                    await capture(('live-' if LIVE else 'fixture-') + symbol + '-' + str(width) + '.png', '.de-chart-modal')
                    for tf in ['week', 'month', 'day']:
                        await ev('document.querySelector(`.de-chart-overlay [data-tf="' + tf + '"]`).click()')
                        await asyncio.sleep(.2)
                        assert await ev('document.querySelectorAll(".de-chart-overlay #ssChart canvas").length') > 0
                    await ev('document.querySelector(".de-chart-close").click()')
                    assert not await ev('!!document.querySelector(".de-chart-overlay")')
                    results.append({'width': width, 'symbol': symbol, **metrics})
                    print('PASS', width, symbol, metrics, flush=True)
                assert await ev('reviewErrors') == []
            (OUT/('live-browser.json' if LIVE else 'fixture-browser.json')).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        proc.terminate()


if __name__ == '__main__':
    asyncio.run(main())
