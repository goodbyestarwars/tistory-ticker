import json
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class RealtimeDataPathTests(unittest.TestCase):
    def test_real_js_requests_share_chart_quote_cache_and_recover_after_error(self):
        script = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let requests=[];
const window={addEventListener(){}};
// 공통 전송은 요청을 즉시 fetch로 넘기는 가짜로 두고, NineAPI는 실제 코드를 싣는다(microtask가 끼면 요청 수 검증이 어긋난다).
window.NineHttp={json:(url)=>context.fetch(url).then((r)=>r.json())};
const context={window,document:{readyState:'loading',addEventListener(){}},
  Date,Promise,Number,setTimeout,clearTimeout,AbortController,
  fetch(url){return new Promise((resolve,reject)=>requests.push({url,resolve,reject}));}};
vm.createContext(context);
{const shell=fs.readFileSync('js/skin-shell.js','utf8');
 vm.runInContext(shell.slice(shell.indexOf('/* NineUI:'),shell.indexOf('/* End NineUI */')),context);
 vm.runInContext(shell.slice(shell.indexOf('/* NineAPI:'),shell.indexOf('/* End NineAPI */')),context);}
let src=fs.readFileSync('js/order-book.js','utf8').replace('global.OrderBook = OrderBook;',
  'OrderBook.fetchSummary=fetchSummary; global.OrderBook = OrderBook;');
vm.runInContext(src,context);
const api=window.OrderBook;
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const reply=(req,data)=>req.resolve({ok:true,json:()=>Promise.resolve(data)});
(async()=>{
 const chart=api.fetchChart('083650'),summary=api.fetchSummary('083650');await flush();
 assert.equal(requests.length,1);assert(requests[0].url.includes('/flow-chart/083650'));
 // 공통 NineAPI.flowChart는 일봉에 date·OHLC가 있어야 받아들인다(skin-shell.js 형식 검증).
 reply(requests[0],{data:{daily:[{date:'2026-10-30',open:60000,high:61000,low:57000,close:57200,volume:10}]}});
 assert.equal((await chart).daily.length,1);assert.equal((await summary).open,60000);
 await api.fetchChart('083650');assert.equal(requests.length,1);
 const a=api.fetchQuote('083650'),b=api.fetchQuote('083650');assert.strictEqual(a,b);await flush();
 assert(requests[1].url.includes('/domestic-quotes?codes=083650'));
 reply(requests[1],{data:[{code:'083650',price:57200,change:-1000,changeRate:-1.72}]});
 assert.equal((await a).price,57200);
 const failed=api.fetchQuote('083650');await flush();requests[2].reject(Error('offline'));await flush();
 requests[3].reject(Error('offline'));   // 공통 NineAPI가 GAS 폴백을 한 번 더 시도한다
 await assert.rejects(failed);
 const retry=api.fetchQuote('083650');await flush();reply(requests[4],{data:[{code:'083650',price:57300}]});
 assert.equal((await retry).price,57300);
 const fallback=api.fetchChart('005930');await flush();requests[5].reject(Error('VM offline'));await flush();
 assert(requests[6].url.includes('action=flowChart'));
 // GAS 폴백 응답도 공통 NineAPI의 형식 검증을 거친다. 일봉 없음(NO_DATA) 처리는 test_stock_search_missing_daily가 따로 본다.
 reply(requests[6],{daily:[{date:'2026-10-30',open:100,high:101,low:99,close:100}]});assert.equal((await fallback).daily.length,1);
 // 정상 일봉은 5분 캐시되므로 같은 종목을 다시 불러도 새 요청이 없다.
 await api.fetchChart('005930');await flush();assert.equal(requests.length,7);
 console.log(JSON.stringify({ok:true,requests:requests.length}));
})().catch(e=>{console.error(e);process.exitCode=1;});
'''
        result = subprocess.run(['node', '-e', script], cwd=ROOT, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['ok'])
