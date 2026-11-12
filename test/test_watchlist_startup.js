'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('js/stock-search-panel.js', 'utf8');
const loader = source.slice(source.indexOf('  function loadWatchlistOnDemand()'), source.indexOf('  function bootGlobalWatchlist()'));
test('a stalled search catalog never blocks the watchlist module; failed catalog does not reload it', async () => {
  for (const rejectCatalog of [false, true]) {
    let loads = 0, catalogRequests = 0;
    const catalog = rejectCatalog ? Promise.reject(new Error('offline')) : new Promise(() => {});
    const scope = vm.createContext({ ensureKrxMap: () => { catalogRequests++; return catalog; }, loadWatchlistScript: () => { loads++; } });
    vm.runInContext(loader + '\nloadWatchlistOnDemand();', scope);
    assert.equal(catalogRequests, 1);
    assert.equal(loads, 1, 'module starts without waiting for the catalog');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(loads, 1, 'catalog errors do not start a duplicate module');
  }
});
