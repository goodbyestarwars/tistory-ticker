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
  w.NineKeywordCloud.layout(area,words,button,{packed:true});
  assert.equal(area.children.length,80);
  assert(area.children.every(el=>el.style.visibility==='visible'));
  assert(parseFloat(area.style.height)>500 && parseFloat(area.style.height)<1700);
});


test('expanded cloud is scattered in two dimensions, with zero overlaps at desktop and mobile widths',()=>{
  const w={}, fakeDocument={createElement:()=>({textContent:''})};
  vm.runInNewContext(fs.readFileSync('js/news-keyword-cloud.js','utf8'),{window:w,document:fakeDocument,Set,Map});
  const labels='엔비디아 젠슨황 실적 삼성전자 AI 증시 달러 동반 붕괴 가격 뉴욕증시 시총 천피 투자자들 SK하이닉스 가능성 경고 규모 그룹 금리 기관 기술주 매도 다우 마이크론 수익 반도체 백신 반도체유출 빅테크 공매도 사임 정책 코스피 NVIDIA DISNEY ANTHROPIC DEPOT IPO NASDAQ 브로드컴 파산 금리인하 원달러 애플 마이크로소프트 오픈AI SK 현대차 기업경영 경영진 반등 전망 TSMC ASML AMD 메모리 전력 생산기술 배터리 이차전지 데이터센터 국채 채권 인플레이션 기술투자 기술실적 중국 일본 대만 지수 주요기업 하락장 투자금 공급망 투자자 투자시장 반도체장비 미국연준 매출 발표 혁신'.split(' ');
  const words=labels.slice(0,80).map((text,i)=>({text,count:80-i}));
  const button=word=>({
    classList:{add(){}},
    style:{setProperty(){}}, label:word.text,
    replaceChildren(span){this.label=span.textContent;},
    get offsetWidth(){const size=parseFloat(this.style.fontSize||'14'); return this.label.length*size*(/[가-힣]/.test(this.label)?0.88:0.61)+10;},
    get offsetHeight(){return parseFloat(this.style.fontSize||'14')*1.27+7;}
  });
  [320,360,390,720,1325].forEach(width=>{
    const area={clientWidth:width,style:{},children:[],replaceChildren(){this.children=[];},appendChild(el){this.children.push(el);}};
    w.NineKeywordCloud.layout(area,words,button,{packed:true});
    assert.equal(area.children.length,80,'no missing words at '+width);
    const rects=area.children.map(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top),w:el.offsetWidth,h:el.offsetHeight}));
    const height=parseFloat(area.style.height);
    assert(rects.every(r=>r.x>=0&&r.y>=0&&r.x+r.w<=width&&r.y+r.h<=height),'bounds at '+width);
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
      const a=rects[i],b=rects[j];
      assert(!(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y),
        'overlap between '+i+' and '+j+' at '+width);
    }
    assert(new Set(rects.map(r=>Math.round(r.y))).size>30,'not row-aligned at '+width);
  });
});
