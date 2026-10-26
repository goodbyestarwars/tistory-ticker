const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/home-widgets.js', 'utf8');
const block = source.slice(source.indexOf('  function buildRegistry('), source.indexOf('  function syncEconomicHeight('));
class Node {
  constructor(name) { this.name=name; this.children=[]; }
  appendChild(node) {
    if (node.parent) node.parent.children=node.parent.children.filter(n=>n!==node);
    node.parent=this; this.children.push(node);
  }
  set innerHTML(value) {assert.equal(value,''); this.children.forEach(n=>{n.parent=null;}); this.children=[];}
  querySelector(selector) {
    for (const node of this.children) {
      if ('.'+node.name===selector) return node;
      const found=node.querySelector(selector); if(found) return found;
    }
    return null;
  }
}
const dashboard = new Node('home-dashboard');
const toolbar = new Node('home-market-toolbar');
const clock = new Node('home-switch-countdown');
const tabs = new Node('home-market-switch');
toolbar.appendChild(tabs); toolbar.appendChild(clock); dashboard.appendChild(toolbar);
const overview = new Node('home-overview-grid');
const market = new Node('home-market-board'); const news = new Node('home-economic-news');
overview.appendChild(market); overview.appendChild(news); dashboard.appendChild(overview);
const realtime = new Node('home-realtime-board'); dashboard.appendChild(realtime);
const closed = new Node('home-closed-page'); dashboard.appendChild(closed);
const briefing = new Node('briefing');
const scope={document:{createElement:()=>new Node('grid')},decorate(){}};
vm.runInNewContext('var grid;'+block+';this.buildRegistry=buildRegistry;',scope);
assert.equal(scope.buildRegistry({dashboard,briefing}),true);
assert.equal(dashboard.children[0],toolbar);
assert.equal(dashboard.querySelector('.home-switch-countdown'),clock);
assert.equal(dashboard.querySelector('.home-market-switch'),tabs);
assert.equal(dashboard.querySelector('.home-closed-page'),closed);
assert.equal(dashboard.querySelector('.home-market-board'),market);
assert.equal(dashboard.querySelector('.home-economic-news'),news);
assert.equal(scope.buildRegistry({dashboard,briefing}),false,'No second destructive reconstruction');
console.log('PASS original toolbar, timer, tabs, closed page and widget identities survive registry build');
