require('./helpers/common_runtime');
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const win={};vm.runInNewContext(fs.readFileSync('js/stock-story-template.js','utf8'),{window:win});
const {build,merge,validate,DUPLICATE_METRICS}=win.StockStoryTemplate;
const q=[];for(let i=0;i<8;i++){const y=2024+Math.floor(i/4),n=i%4+1;const end=new Date(Date.UTC(y,n*3,0)).toISOString().slice(0,10);q.push({year:y,quarter:n,period_end:end,rcept_dt:y+'-12-31',rcept_no:y+'1231000001',fs_div:'CFS',amount_basis:'standalone_3m',revenue:100e8,operating_income:(i<4?10:20)*1e8,net_income:15e8,net_income_parent:12e8,ordinary_shares:1e8});}
const daily=[];for(let i=0;i<1100;i++){const d=new Date(Date.UTC(2023,0,1+i));daily.push({date:d.toISOString().slice(0,10),close:200-i/10});}
const input={fundamentals:{fundamentals:{quarters:q}},chartData:{daily},currentPrice:100,priceAsOf:'2026-01-01',volumeProfile:{price:100,asOf:'2025-12-31',analysis:{total:100,zones:[{low:120,high:130,share:18},{low:150,high:170,share:35}],support:{low:80,high:90,share:20}}}};
let cards=build(input);assert.equal(cards.length,3);assert(cards.every(validate));
assert(cards[0].conclusion.includes('괴리'));assert(cards[0].pair.some(p=>p.k.includes('PER')));
assert(cards[1].conclusion.includes('마진'));assert(cards[2].conclusion.includes('150원~170원'));assert(cards[2].conclusion.includes('+50.0%'));
assert.equal(build({}).length,0);assert.equal(build({fundamentals:{fundamentals:{quarters:q.slice(1)}}}).length,0);
const missing=structuredClone(input);missing.fundamentals.fundamentals.quarters[7].revenue=null;assert(!build(missing).some(c=>c.topic.startsWith('earnings')));
const badBasis=structuredClone(input);badBasis.fundamentals.fundamentals.quarters[7].amount_basis='annual';assert(!build(badBasis).some(c=>c.topic.startsWith('earnings')));
const loss=structuredClone(input);loss.fundamentals.fundamentals.quarters.slice(0,4).forEach(r=>r.operating_income=-10);assert(!build(loss).some(c=>c.topic==='earnings-price'));
assert(!build({...input,chartData:{daily:daily.slice(-300)}}).some(c=>c.topic==='earnings-price'));
assert(!build({...input,volumeProfile:{...input.volumeProfile,price:99}}).some(c=>c.topic==='volume-profile'),'old profile/current price mismatch is omitted');
const cb=structuredClone(input);cb.fundamentals.fundamentals.potential_supply={status:'ok',items:[{label:'CB',price:80,shares_pct:4,as_of:'2025-12-20',start_date:'2026-12-20',end_date:'2028-12-20',rcpNo:'20251220000001'}]};
cards=build(cb);assert.equal(cards.length,4);assert(cards[3].conclusion.includes('-20.0%'));assert.equal(merge(cards,cards).length,4);
const expired=structuredClone(cb);expired.priceAsOf='2030-01-01';assert(!build(expired).some(c=>c.topic==='potential-supply'));
for(const id of DUPLICATE_METRICS)assert(!validate({...cards[0],metricIds:[id]}));
assert(!validate({topic:'flow',title:'20일 순매수',asOf:'2026-01-01'}));
assert(!validate({...cards[0],inputs:['fake','fake2']}));
assert(!validate({...cards[0],conclusion:''}));
const a=q[3],b=q[7];const margin=b.revenue*(b.operating_income/b.revenue-a.operating_income/a.revenue),sales=(b.revenue-a.revenue)*a.operating_income/a.revenue;assert.equal(margin+sales,b.operating_income-a.operating_income);
console.log('Interpretation cards: 8-quarter alignment, loss/missing suppression, price/profile freshness, CB expiry, max4 and duplicate ban passed');
