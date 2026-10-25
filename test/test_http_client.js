/* Transport failure/cancellation/cache isolation with a controlled fetch. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/skin-shell.js', 'utf8').split('/* NineHttp:')[1].split('/* End NineHttp */')[0];
let calls = [], responder;
const context = { Map, Promise, Object, Array, JSON, Date, Math, Number, TypeError, Error, Headers,
  AbortController, setTimeout, clearTimeout, isFinite,
  fetch: (url, init) => { calls.push({url, init}); return responder(url, init); } };
context.window = context;
vm.runInNewContext('/* NineHttp:' + source, context);
const http = context.NineHttp;
const response = value => ({ ok: true, status: 200, json: async () => value });
function reset(fn) { calls = []; http.clearCache(); responder = fn; }

(async () => {
  let complete;
  reset(() => new Promise(resolve => { complete = resolve; }));
  const a = http.json('/same'), b = http.json('/same');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.length, 1);
  complete(response({n: 1}));
  assert.deepEqual(await a, await b);

  reset(async () => response({n: calls.length}));
  assert.equal((await http.json('/ttl', {ttlMs: 100})).n, 1);
  assert.equal((await http.json('/ttl', {ttlMs: 100})).n, 1);
  await http.json('/ttl'); assert.equal(calls.length, 2);
  await http.json('/ttl', {fetchOptions:{headers:{Authorization:'example'}}});
  await http.json('/ttl', {fetchOptions:{headers:{Authorization:'example'}}});
  assert.equal(calls.length, 4);
  await http.json('/ttl', {fetchOptions:{credentials:'include'}, ttlMs:100});
  await http.json('/ttl', {fetchOptions:{credentials:'include'}, ttlMs:100});
  assert.equal(calls.length, 6);

  reset(async () => response({success: false}));
  await http.json('/error-envelope', {ttlMs:100});
  await http.json('/error-envelope', {ttlMs:100});
  assert.equal(calls.length, 2);

  reset(async () => calls.length === 1
    ? {ok:false,status:503,headers:new Headers({'Retry-After':'0'})} : response({ok:true}));
  assert.equal((await http.json('/retry', {retries:1,backoffMs:1})).ok, true);
  assert.equal(calls.length, 2);
  reset(async () => ({ok:false,status:503}));
  await assert.rejects(http.json('/post', {retries:2,fetchOptions:{method:'POST',body:'{}'}}), e => e.status === 503);
  assert.equal(calls.length, 1);

  reset(async () => ({ok:true,json:async () => { throw new SyntaxError('bad'); }}));
  await assert.rejects(http.json('/json', {retries:1}), e => e.kind === 'json');
  assert.equal(calls.length, 1);
  responder = async () => response({ok:true});
  await http.json('/json'); assert.equal(calls.length, 2);

  reset(async () => ({ok:true,json:() => new Promise(() => {})}));
  await assert.rejects(http.json('/slow-body', {timeoutMs:10}), e => e.kind === 'timeout');
  assert.equal(calls[0].init.signal.aborted, true);

  reset(() => new Promise(() => {}));
  const controller = new AbortController();
  const cancelled = http.json('/cancel', {signal:controller.signal});
  controller.abort();
  await assert.rejects(cancelled, e => e.name === 'AbortError');

  reset(async () => response({n:calls.length}));
  for (let i = 0; i < 66; i++) await http.json('/bounded/' + i, {ttlMs:10000});
  await http.json('/bounded/0', {ttlMs:10000});
  assert.equal(calls.length, 67);

  reset(async () => ({ok:false,status:404}));
  let errors=0;
  await Promise.allSettled([http.json('/fail', {onError:()=>errors++}),http.json('/fail', {onError:()=>errors++})]);
  assert.equal(calls.length, 1); assert.equal(errors,2);
  await assert.rejects(http.json('/fail'), e => e.status === 404);
  assert.equal(calls.length, 2);

  // Browsers without AbortController still get a bounded promise.
  delete context.AbortController;
  reset(() => new Promise(() => {}));
  await assert.rejects(http.json('/legacy', {timeoutMs:10}), e => e.kind === 'timeout');
  console.log('HTTP: dedupe, opt-in TTL, private isolation, retry, POST, JSON, body timeout, cancellation, cache bound, error callbacks and legacy timeout passed');
})().catch(error => { console.error(error); process.exitCode=1; });
