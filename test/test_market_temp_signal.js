// 신호 구성(2026-10-23): 미국 현물 3지수+SOX+VIX+원/달러(+야간선물). 나스닥100 선물은 입력이 아니다.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/market-temp.js','utf8').replace('global.MarketTemp = MarketTemp;','global.MarketTemp = MarketTemp; global.t={tomorrowSignal_};');
const sb={window:{},document:{readyState:'loading',addEventListener(){}},console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({})})};
vm.runInNewContext(src,sb);const f=sb.window.t.tomorrowSignal_;
const row=(symbol,a,b,extra={})=>({symbol,stale:false,chart:[{date:'20261021',close:b},{date:'20261022',close:a}],...extra});
const base=(m)=>({SP500_INDEX:row('SP500_INDEX',100*(1+m*0.008),100),NASDAQ_INDEX:row('NASDAQ_INDEX',100*(1+m*0.012),100),DOW_INDEX:row('DOW_INDEX',100*(1+m*0.008),100),SOX:row('SOX',100*(1+m*0.03),100),VIX:row('VIX',100*(1-m*0.08),100),USDKRW:row('USDKRW',100*(1-m*0.006),100)});
const night=(close)=>({KOSPI200_DAY:{symbol:'KOSPI200_DAY',stale:false,chart:[{date:'20261022',close:100}]},KOSPI200_NIGHT:{symbol:'KOSPI200_NIGHT',stale:false,chart:[{date:'20261022',close}]}});
const after=Date.UTC(2026,9,22,21,10);// 05:10 KST 다음날 = 세션 종료 후
let s=f({...base(-3),...night(97)},'20261023',after);
assert(s&&s.useNight&&s.bucket.key==='strongDown'&&Object.keys(s.vals).length===7&&!('nq' in s.vals));
s=f({...base(3),...night(103)},'20261023',after);assert.equal(s.bucket.key,'strongUp');
s=f({...base(0),...night(100.8)},'20261023',after);assert.equal(s.bucket.key,'flat');
s=f({...base(-3)},'20261023',after);assert(!s.useNight&&s.bucket.key==='strongDown'&&Object.keys(s.vals).length===6,'야간 없으면 6항');
const pending=f({...base(-3),...night(97)},'20261023',Date.UTC(2026,9,22,15,0));assert(!pending.useNight,'야간 세션 진행 중에는 점수 제외');
const miss=base(1);delete miss.DOW_INDEX;assert.equal(f(miss,'20261023',after),null,'지수 하나라도 없으면 판단 안 함');
const stale=base(1);stale.NASDAQ_INDEX.stale=true;
console.log('signal scenarios ok');
