'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const scope = {window:{}, Set, Map}; vm.runInNewContext(fs.readFileSync('js/news-keyword-cloud.js','utf8'),scope);
const cloud = scope.window.NineKeywordCloud;
const title = row => row.title_ko || row.title;
const safe = url => /^https?:\/\//.test(url || '') ? url : '';
const row = (text,i,extra={}) => ({title:text,link:'https://example.test/'+i,...extra});
test('each repeated term counts once per deduplicated article, not word occurrences',()=>{
  const data=cloud.fromHeadlines([row('반도체 AI AI 투자',1),row('반도체 AI 실적',2),row('반도체 AI 실적!',3),row('반도체 AI 수출',1)],title,safe);
  assert.equal(data.articleCount,2);
  assert.equal(data.keywords.find(w=>w.text==='AI').count,2);
  assert.equal(data.keywords.find(w=>w.text==='반도체').articles.length,2);
});
test('translated display title is used; unsafe URLs and email/URL fragments are excluded',()=>{
  const data=cloud.fromHeadlines([row('original',1,{title_ko:'반도체 AI 정책 abc@example.com https://evil.test'}),row('반도체 AI 전망',2),row('반도체 AI',3,{link:'javascript:alert(1)'})],title,safe);
  assert.equal(data.articleCount,2);
  assert.deepEqual(Array.from(data.keywords,w=>w.text).sort(),['AI','반도체'].sort());
  assert(data.keywords.every(w=>w.articles.every(a=>a.url.startsWith('https://'))));
});
test('empty/single/boilerplate articles never create synthetic popular words',()=>{
  for(const items of [[],[row('반도체 AI 투자',1)],[row('속보 시장 전망',1),row('속보 시장 전망 변화',2)]]){
    assert.equal(cloud.fromHeadlines(items,title,safe).keywords.length,0);
  }
});
test('separate market inputs stay separate and evidence uses the original safe article',()=>{
  const kr=[row('반도체 수출',1),row('반도체 실적',2)], us=[row('금리 정책',3),row('금리 결정',4)];
  assert.equal(cloud.fromHeadlines(kr,title,safe).keywords[0].text,'반도체');
  assert.equal(cloud.fromHeadlines(us,title,safe).keywords[0].text,'금리');
});

test('80-keyword cap preserves ranked distinct terms and links to evidence',()=>{
  const rows=[];
  for(let i=0;i<100;i++){
    rows.push(row('TERM'+i+' stage',i*2+1));
    rows.push(row('TERM'+i+' result',i*2+2));
  }
  const data=cloud.fromHeadlines(rows,title,safe);
  assert.equal(data.articleCount,200);
  assert.equal(data.keywords.length,80);
  assert(data.totalKeywords > 80);
  assert.equal(new Set(data.keywords.map(w=>w.key)).size,80);
  assert(data.keywords.every(w=>w.articles.length===w.count));
});
test('company name aliases merge; linked CEO is a separate entity, no double count',()=>{
  const w={
    KRX_MAP:{'삼성전자':'005930'}, StockSearchPanel:{knownUsStocks:()=>[
      {symbol:'NVDA',name:'엔비디아',aliases:'엔비디아 nvidia nvidia corporation'}
    ]}
  };
  const inner={window:w,document:{},Set,Map};
  vm.runInNewContext(fs.readFileSync('js/news-stock-matcher.js','utf8'),inner);
  vm.runInNewContext(fs.readFileSync('js/news-keyword-cloud.js','utf8'),inner);
  const source=[
    row('NVIDIA doubles supply',1),
    row('엔비디아와 NVIDIA 실적',2),
    row('NVDA 주식 상승',3),
    row('Jensen Huang plans return',4),
    row('젠슨 황 사임 관련',5),
    row('젠슨 황, 엔비디아 경영 발언',6)
  ];
  const before=JSON.stringify(source);
  const model=w.NineKeywordCloud.fromHeadlines(source,title,safe,w.NineNewsStocks);
  const company=model.keywords.find(k=>k.kind==='company'&&k.text==='엔비디아');
  const person=model.keywords.find(k=>k.kind==='person'&&k.text==='젠슨 황');
  assert(company && person);
  assert.equal(company.count,4);
  assert.equal(person.count,3);
  assert.equal(person.relation,'엔비디아');
  assert.equal(model.keywords.filter(k=>/NVIDIA|NVDA|JENSEN|HUANG|젠슨/.test(k.text)&&k!==person).length,0);
  assert.equal(JSON.stringify(source),before,'raw provider articles unchanged');
});
test('expanded mobile cloud keeps every item visible without a dropped word',()=>{
  const w={}, fakeDocument={createElement:()=>({textContent:''})};
  const inner={window:w,document:fakeDocument,Set,Map};
  vm.runInNewContext(fs.readFileSync('js/news-keyword-cloud.js','utf8'),inner);
  const area={
    clientWidth:360,style:{},children:[],
    replaceChildren(){this.children=[];},
    appendChild(el){this.children.push(el);}
  };
  function button(word){
    return {
      classList:{add(){}},
      style:{setProperty(){}}, label:word.text,
      replaceChildren(span){this.label=span.textContent;},
      get offsetWidth(){return this.label.length*parseFloat(this.style.fontSize||'14')*.7+10;},
      get offsetHeight(){return parseFloat(this.style.fontSize||'14')*1.25+8;}
    };
  }
  const words=Array.from({length:80},(_,i)=>({text:'키워드'+String(i).padStart(2,'0'),count:80-i}));
  w.NineKeywordCloud.layout(area,words,button);
  assert.equal(area.children.length,80);
  assert(area.children.every(el=>el.style.visibility==='visible'));
  assert(parseFloat(area.style.height)>500);
});
