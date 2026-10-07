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
const context={window,document:{readyState:'loading',addEventListener(){}},
  Date,Promise,Number,setTimeout,clearTimeout,AbortController,
  fetch(url){return new Promise((resolve,reject)=>requests.push({url,resolve,reject}));}};
vm.createContext(context);
let src=fs.readFileSync('js/order-book.js','utf8').replace('global.OrderBook = OrderBook;',
  'OrderBook.fetchSummary=fetchSummary; global.OrderBook = OrderBook;');
vm.runInContext(src,context);
const api=window.OrderBook;
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const reply=(req,data)=>req.resolve({ok:true,json:()=>Promise.resolve(data)});
(async()=>{
 const chart=api.fetchChart('083650'),summary=api.fetchSummary('083650');
 assert.equal(requests.length,1);assert(requests[0].url.includes('/flow-chart/083650'));
 reply(requests[0],{data:{daily:[{open:60000,high:61000,low:57000,close:57200,volume:10}]}});
 assert.equal((await chart).daily.length,1);assert.equal((await summary).open,60000);
 await api.fetchChart('083650');assert.equal(requests.length,1);
 const a=api.fetchQuote('083650'),b=api.fetchQuote('083650');assert.strictEqual(a,b);
 assert(requests[1].url.includes('/domestic-quotes?codes=083650'));
 reply(requests[1],{data:[{code:'083650',price:57200,change:-1000,changeRate:-1.72}]});
 assert.equal((await a).price,57200);
 const failed=api.fetchQuote('083650');requests[2].reject(Error('offline'));
 await assert.rejects(failed);
 const retry=api.fetchQuote('083650');reply(requests[3],{data:[{price:57300}]});
 assert.equal((await retry).price,57300);
 const fallback=api.fetchChart('005930');requests[4].reject(Error('VM offline'));await flush();
 assert(requests[5].url.includes('action=flowChart'));
 reply(requests[5],{error:'NO_DATA',daily:[]});assert.equal((await fallback).error,'NO_DATA');
 const fresh=api.fetchChart('005930');assert(requests[6].url.includes('/flow-chart/'));
 reply(requests[6],{data:{daily:[{close:100}]}});await fresh;
 console.log(JSON.stringify({ok:true,requests:requests.length}));
})().catch(e=>{console.error(e);process.exitCode=1;});
'''
        result = subprocess.run(['node', '-e', script], cwd=ROOT, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['ok'])
