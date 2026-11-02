/* Interpretation-only story contract, shared by generated and editorial cards. */
(function (global) {
  'use strict';
  var LIMIT = 4;
  // Extracted from foreign-flow's lower flow/fundamental/opinion/technical sections.
  var DUPLICATE_METRICS = Object.freeze(['foreign_net_20d', 'inst_net_20d', 'quarterly_income_table',
    'ytd_income_table', 'annual_income_table', 'target_price_average', 'ma224_gap', 'week52_range', 'short_credit_ratio']);
  var TOPICS = ['earnings-price', 'earnings-source', 'volume-profile', 'potential-supply', 'segment-profit'];
  function num(v) { return v == null || v === '' || typeof v === 'boolean' || !isFinite(Number(v)) ? null : Number(v); }
  function date(v) { var s=String(v || ''); if (/^\d{8}$/.test(s)) s=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : null; }
  function pct(v) { return (v>0?'+':'')+v.toFixed(1)+'%'; }
  function money(v) { return Math.round(v).toLocaleString('ko-KR')+'원'; }
  function won(v) { return (v/1e8).toLocaleString('ko-KR',{maximumFractionDigits:1})+'억원'; }
  function pair(k,v) { return {k:k,v:v}; }
  function make(topic,title,conclusion,pairs,asOf,inputs,detail) {
    return {kind:'interpretation',topic:topic,title:title,conclusion:conclusion,sub:conclusion,pair:pairs,
      asOf:asOf,inputs:inputs,detail:detail || [],src:'공시·가격 결합 분석 · '+asOf+' 기준',tier:2};
  }
  function valid(c) {
    if (!c || c.kind!=='interpretation' || TOPICS.indexOf(c.topic)<0 || !date(c.asOf)
        || !c.title || !c.src || typeof c.conclusion!=='string' || c.conclusion.trim().length<10
        || !Array.isArray(c.inputs) || new Set(c.inputs).size<2
        || (c.metricIds || []).some(function(k){return DUPLICATE_METRICS.indexOf(k)>=0;})) return false;
    var required = {'earnings-price':['quarterly_operating_income','quarter_end_adjusted_close'], 'earnings-source':['quarterly_revenue','quarterly_operating_income','quarterly_net_income'], 'volume-profile':['volume_profile_analysis','current_price'], 'potential-supply':['structured_dart_supply','current_price'], 'segment-profit':['segment_operating_income','consolidated_operating_income']};
    if (required[c.topic].some(function(k){return c.inputs.indexOf(k)<0;})) return false;
    if (c.topic==='earnings-price' && (!c.chart || c.chart.points.length<8)) return false;
    if (c.topic==='segment-profit' && (c.tier!==1 || !/^\d{14}$/.test(String(c.rcpNo || '')))) return false;
    return true;
  }
  function quarters(f) {
    var rows=(f && f.quarters || []).slice().sort(function(a,b){return String(a.period_end).localeCompare(String(b.period_end));}).slice(-8);
    if (rows.length<8) return [];
    var fs=rows[0].fs_div;
    if (!fs || rows.some(function(q,i){
      var d=date(q.period_end), prev=i && rows[i-1];
      return !d || q.amount_basis!=='standalone_3m' || q.fs_div!==fs || !date(q.rcept_dt)
        || !/^\d{14}$/.test(String(q.rcept_no || ''))
        || ['revenue','operating_income','net_income'].some(function(k){return num(q[k])===null;})
        || (i && Number(q.year)*4+Number(q.quarter)!==Number(prev.year)*4+Number(prev.quarter)+1);
    })) return [];
    return rows;
  }
  function sum(q,key) { var vals=q.map(function(r){return num(r[key]);}); return vals.some(function(v){return v===null;})?null:vals.reduce(function(a,b){return a+b;},0); }
  function earningsPrice(q, chart) {
    var prices=(chart && chart.source!=='flow-fallback' && chart.daily || []).filter(function(r){return date(r.date) && num(r.close)>0;}).slice().sort(function(a,b){return date(a.date).localeCompare(date(b.date));});
    if (!prices.length || Date.parse(date(prices[prices.length-1].date))-Date.parse(date(prices[0].date))<730*864e5) return null;
    var points=q.map(function(r){
      var end=date(r.period_end), rows=prices.filter(function(p){return date(p.date)<=end;});
      var last=rows[rows.length-1];
      return !last || Date.parse(end)-Date.parse(date(last.date))>7*864e5 ? null : {time:end,profit:r.operating_income,price:Number(last.close)};
    });
    if (points.some(function(p){return !p;})) return null;
    var prior=sum(q.slice(0,4),'operating_income'), recent=sum(q.slice(4),'operating_income');
    if (!(prior>0) || !(recent>0)) return null; // loss transitions are not profit-growth percentages
    var growth=(recent/prior-1)*100, change=(points[7].price/points[3].price-1)*100;
    if (growth===0 || change===0) return null;
    var label=growth>0 && change<0?'괴리':growth<0 && change>0?'기대 선반영':'같이 간다';
    var c=make('earnings-price','실적 대비 주가 · '+label,'최근 4분기 영업이익은 '+pct(growth)+', 같은 기간 주가는 '+pct(change)+'로 '+label+' 흐름이다.',
      [pair('최근 4분기 이익 YoY',pct(growth)),pair('같은 기간 주가',pct(change))],date(q[7].rcept_dt),['quarterly_operating_income','quarter_end_adjusted_close'],
      ['주가 비교 '+points[3].time+' → '+points[7].time+' · 실적 공개 전 분기말 가격을 사용한 사후 비교다.']);
    c.chart={type:'profit-price',points:points};
    var beforeNet=sum(q.slice(0,4),'net_income_parent'), afterNet=sum(q.slice(4),'net_income_parent');
    if (beforeNet>0 && afterNet>0 && num(q[3].ordinary_shares)>0 && num(q[7].ordinary_shares)>0) {
      c.pair.push(pair('PER 시작 → 현재(분기말)',(points[3].price*q[3].ordinary_shares/beforeNet).toFixed(1)+'배 → '+(points[7].price*q[7].ordinary_shares/afterNet).toFixed(1)+'배'));
      c.detail.push('PER은 지배주주 순이익·분기말 보통주 발행주식 기준 근사치다.');
    }
    return c;
  }
  function earningsSource(q) {
    var a=q[3],b=q[7];
    if (!(a.revenue>0) || !(b.revenue>0)) return null;
    var delta=b.operating_income-a.operating_income;
    if (!delta) return null;
    var sales=(b.revenue-a.revenue)*(a.operating_income/a.revenue);
    var margin=b.revenue*(b.operating_income/b.revenue-a.operating_income/a.revenue);
    var nonOperating=b.operating_income-b.net_income;
    var conclusion;
    if (b.operating_income>0 && nonOperating>0 && nonOperating/b.operating_income>=.3) {
      conclusion='영업이익과 순이익의 차이가 영업이익의 '+(nonOperating/b.operating_income*100).toFixed(0)+'%로, 영업외·금융·세금 등이 순이익을 낮췄다.';
    } else {
      var effect=Math.abs(margin)>=Math.abs(sales)?margin:sales, name=Math.abs(margin)>=Math.abs(sales)?'마진 변화':'매출 변화';
      // Opposing effects may exceed 100%; never present such a result as a simple share.
      conclusion=delta*effect>0 && Math.abs(effect/delta)<=1
        ? '영업이익 '+(delta>0?'증가':'감소')+'의 '+Math.abs(effect/delta*100).toFixed(0)+'%는 '+name+'로 설명된다.'
        : name+' 효과 '+won(effect)+'가 반대 방향의 효과를 상쇄해 영업이익은 '+won(delta)+' 변했다.';
    }
    return make('earnings-source','이익은 어디서',conclusion,[pair('매출 효과',won(sales)),pair('마진 효과',won(margin)),pair('영업이익 − 순이익',won(nonOperating))],date(b.rcept_dt),
      ['quarterly_revenue','quarterly_operating_income','quarterly_net_income'],
      ['전년 동기 단독 분기 비교 · '+a.period_end+' → '+b.period_end,'매출효과 = 매출 증감 × 전년 영업이익률; 마진효과 = 당기 매출 × 영업이익률 변화.','영업이익과 순이익 차이는 영업외손익뿐 아니라 금융손익·법인세 등을 포함한다.']);
  }
  function volume(input) {
    var v=input.volumeProfile, price=num(input.currentPrice), asOf=date(input.priceAsOf), end=date(v && v.asOf), an=v && v.analysis;
    if (!an || !(price>0) || !asOf || !end || num(v.price)!==price || !(an.total>0)) return null;
    var zones=(an.zones || []).filter(function(z){return num(z.low)>0 && num(z.high)>=z.low && num(z.share)>0;});
    var above=zones.filter(function(z){return z.low>price;}).sort(function(a,b){return b.share-a.share;})[0];
    var below=an.support, inside=an.inZone, chosen=above || inside || below;
    if (!chosen) return null;
    var position=inside?'안':above?'아래':'위', gap=(chosen.low/price-1)*100;
    var conclusion=above?'위쪽 '+money(above.low)+'~'+money(above.high)+'에 추정 거래량 '+above.share.toFixed(1)+'%가 모여 있고, 하단까지 현재가 대비 '+pct(gap)+'다.'
      :'현재가는 '+money(chosen.low)+'~'+money(chosen.high)+' 집중 매물대 '+position+'에 있어 이 구간과의 관계를 먼저 확인할 자리다.';
    var c=make('volume-profile','매물대 · 현재가는 집중 구간 '+position,conclusion,[pair('현재가',money(price))],asOf,['volume_profile_analysis','current_price'],
      ['일봉 기반 추정 매물대 · '+end+'까지 · 실제 매도 대기 물량이나 지지 보장이 아니다.']);
    if (above) c.pair.push(pair('위쪽 최대 집중 구간',money(above.low)+'~'+money(above.high)+' · '+above.share.toFixed(1)+'%'));
    if (below && num(below.low)>0 && num(below.high)>0 && num(below.share)>0) c.pair.push(pair('아래 지지 후보',money(below.low)+'~'+money(below.high)+' · '+below.share.toFixed(1)+'% · '+pct((below.high/price-1)*100)));
    return c;
  }
  function supply(input,f) {
    var price=num(input.currentPrice), asOf=date(input.priceAsOf), cache=f && f.potential_supply;
    if (!(price>0) || !asOf || !cache || cache.status!=='ok') return null;
    var rows=(cache.items || []).filter(function(r){return num(r.price)>0 && num(r.shares_pct)>0 && date(r.start_date) && date(r.as_of) && /^\d{14}$/.test(String(r.rcpNo || '')) && (!date(r.end_date) || date(r.end_date)>=asOf);});
    if (!rows.length) return null;
    rows.sort(function(a,b){return b.shares_pct-a.shares_pct;}); var r=rows[0],gap=(r.price/price-1)*100;
    var c=make('potential-supply','잠재 물량 · '+r.label,'공시된 '+r.label+' 가격은 현재가 대비 '+pct(gap)+', 물량은 발행주식의 '+Number(r.shares_pct).toFixed(1)+'%로 '+date(r.start_date)+'부터 가능하다.',
      [pair('공시 가격 / 현재가',money(r.price)+' / '+money(price)),pair('발행주식 대비',Number(r.shares_pct).toFixed(1)+'%'),pair('가능 시작일',date(r.start_date))],date(r.as_of),['structured_dart_supply','current_price'],
      ['공시 결정 기준이며 실제 전환·처분 완료나 현재 잔여 물량을 뜻하지 않는다.','가격 기준 '+asOf+' · 다른 회차를 합산하지 않는다.']);
    c.rcpNo=r.rcpNo; c.sourceUrl='https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+r.rcpNo; return c;
  }
  function build(input) {
    input=input || {}; var f=input.fundamentals && input.fundamentals.fundamentals;
    var q=quarters(f), cards=[];
    if (q.length) cards.push(earningsPrice(q,input.chartData),earningsSource(q));
    cards.push(volume(input),supply(input,f));
    return merge([],cards);
  }
  function merge(primary,generated) {
    var seen=Object.create(null), conclusions=Object.create(null), out=[];
    (primary || []).concat(generated || []).forEach(function(c){
      if (!valid(c) || seen[c.topic] || conclusions[c.conclusion]) return;
      seen[c.topic]=true; conclusions[c.conclusion]=true; out.push(c);
    });
    return out.slice(0,LIMIT);
  }
  global.StockStoryTemplate={build:build,merge:merge,validate:valid,DUPLICATE_METRICS:DUPLICATE_METRICS,LIMIT:LIMIT};
})(window);
