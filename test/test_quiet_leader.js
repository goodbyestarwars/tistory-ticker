// 2026-11-14 quiet-v1(조용함 표시)·quietLeaderPullback(주도주 조용한 눌림) 연구 태그 회귀.
require('./helpers/common_runtime');
const assert=require('assert'),AW=require('../js/auto-wave.js'),fs=require('fs'),cp=require('child_process'),os=require('os'),path=require('path');
const day=i=>new Date(Date.UTC(2025,0,1)+i*86400000).toISOString().slice(0,10);
// 상승 뒤 저점을 높인 눌림(기존 shape 테스트와 같은 앵커), 거래량 배율·잡음 배율로 변형
const anchors=[[0,100],[90,110],[130,145],[150,130],[160,135],[170,131],[180,132]],base=[];
for(let j=1;j<anchors.length;j++)for(let i=0;i<anchors[j][0]-anchors[j-1][0];i++)base.push(anchors[j-1][1]+(anchors[j][1]-anchors[j-1][1])*i/(anchors[j][0]-anchors[j-1][0]));
base.push(anchors.at(-1)[1]);
function make(volMul,noise,seed){let s=seed;const rnd=()=>{s=(s*9301+49297)%233280;return s/233280-.5;};
  return base.map((c,i)=>{const cc=c*(1+noise*rnd());return {date:day(i),open:cc-.1,high:cc+.8,low:cc-.8,close:cc,volume:(i<30?2000:800)*volMul};});}

// 1) quietnessOf: 입력 불변·결측 null·잡음이 클수록 ivol60 증가
const market={};base.forEach((_,i)=>{market[day(i)]=0;});
const calm=make(1,0,1),noisy=make(1,.06,2);
const before=JSON.stringify(calm),qc=AW.quietnessOf(calm,market),qn=AW.quietnessOf(noisy,market);
assert.strictEqual(JSON.stringify(calm),before,'입력 봉을 바꾸지 않는다');
assert.ok(qc.ivol60<qn.ivol60,'잡음이 큰 종목의 고유 변동성이 더 크다');
assert.ok(qc.upvol20>=0 && qc.upvol20<=1 && qc.amt20>0);
assert.strictEqual(AW.quietnessOf(calm,{}).ivol60,null,'시장 평균 수익률이 없으면 고유 변동성을 만들지 않는다');
assert.strictEqual(AW.quietnessOf(calm.slice(0,10),market).upvol20,null,'봉 부족은 null');

// 2) 워커: 대형·조용한 눌림만 연구 태그, 모든 행에 조용함 표시, 기존 후보는 지우지 않음
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-leader-')),file=path.join(temp,'in.jsonl'),bench=path.join(temp,'b.json');
try{
  const rows=[{code:'000010',name:'대형조용',daily:make(50,0,3)},{code:'000020',name:'대형시끄',daily:make(50,.08,4)}];
  for(let k=0;k<18;k++)rows.push({code:String(100+k).padStart(6,'0'),name:'소형'+k,daily:make(1,.02+.004*k,10+k)});
  fs.writeFileSync(file,rows.map(r=>JSON.stringify(Object.assign({financialScreen:{passed:false}},r))).join('\n')+'\n');
  const kospi=base.map((_,i)=>({date:day(i),close:3000-i})),kosdaq=base.map((_,i)=>({date:day(i),close:900}));
  fs.writeFileSync(bench,JSON.stringify({KOSPI:kospi,KOSDAQ:kosdaq}));
  const out=JSON.parse(cp.execFileSync(process.execPath,['scripts/cloud-vm/shape_scan.js',file,bench],{encoding:'utf8'}));
  const tagged=out.research.pullbackRebreak.filter(r=>r.patternDetail.edgeSignals.some(t=>t.key==='quietLeaderPullback'));
  assert.deepStrictEqual(tagged.map(r=>r.code),['000010'],'거래대금 상위·조용함 상위·120봉 눌림만 태그');
  const d=tagged[0].patternDetail;
  assert.strictEqual(d.orderAuthorized,false);assert.strictEqual(d.observationOnly,true);
  assert.strictEqual(d.exitPlan.stopLossPct,-10);assert.strictEqual(d.exitPlan.maxHoldDays,60);
  assert.strictEqual(d.exitPlan.marketRestActive,true,'하락 중인 KOSPI는 60일선 아래 → 쉬기 구간');
  assert.strictEqual(d.quiet.band,'quiet');
  assert.strictEqual(out.edgeSignals.counts.quietLeaderPullback,1);
  assert.strictEqual(out.quiet.version,'quiet-v1');assert.strictEqual(out.quiet.checked,20);
  const all=Object.values(out.groups).flat().concat(Object.values(out.research).flat());
  assert.ok(all.length && all.every(r=>r.patternDetail.quiet && r.patternDetail.quiet.observationOnly===true),'모든 후보에 조용함 표시');
  const shown=Object.values(out.groups).flat().concat(Object.values(out.extended).flat());
  assert.ok(shown.every(r=>r.patternDetail.quiet.band!=='noisy'),'하위 30%(noisy)는 기본·확장 후보에서 제외');
  assert.strictEqual(out.quiet.role,'filter');assert.ok(out.quiet.excluded && typeof out.quiet.excluded.pullbackRebreak==='number');
  // 지수 자료가 없으면 쉬기 판정은 null(미확인)
  const out2=JSON.parse(cp.execFileSync(process.execPath,['scripts/cloud-vm/shape_scan.js',file],{encoding:'utf8'}));
  assert.strictEqual(out2.quiet.marketRest,null);
}finally{fs.rmSync(temp,{recursive:true,force:true});}

// 3) 화면: 연구 태그 설명·조용함 표시 문구
const src=fs.readFileSync('js/pattern-scan.js','utf8');
assert.ok(/quietLeaderPullback:'주도주 조용한 눌림'/.test(src));
assert.ok(/pullbackRebreak:\['rsHighResidual','quietLeaderPullback'\]/.test(src));
assert.ok(/기본 후보에서 제외합니다/.test(src),'조용함 하위 30% 제외 안내');
assert.ok(!/quietHtml/.test(src),'조용함 배지는 화면에 표시하지 않음');
assert.ok(/function renderSimpleList/.test(src) && /자세히 보기/.test(src),'간단 화면 + 자세히 보기 접기');
console.log('test_quiet_leader ok');

// 4) 시간차 매집 입력(accum-v1): 수급 없으면 sm60 null, 55일 이상이면 계산, 박스·거래량 비율
(function(){
  const bars=[];for(let i=0;i<200;i++){const c=100+(i<140?0:Math.sin(i)*0.5);bars.push({date:day(i),open:c,high:c+.5,low:c-.5,close:c,volume:i<140?1000:(i<190?3000:1500)});}
  const none=AW.accumulationOf(bars,null);
  assert.strictEqual(none.sm60,null,'수급 없으면 매수 비중을 만들지 않는다');
  assert.ok(none.volUp>2.5 && none.dry10<1 && none.box60<0.02 && none.drift60<0.01);
  const flow={};bars.slice(-60).forEach(b=>{flow[b.date.replace(/-/g,'')]=500;});
  const a=AW.accumulationOf(bars,flow);assert.ok(Math.abs(a.sm60-500*60/bars.slice(-60).reduce((s,b)=>s+b.volume,0))<1e-12);
  const sparse={};bars.slice(-50).forEach(b=>{sparse[b.date.replace(/-/g,'')]=500;});
  assert.strictEqual(AW.accumulationOf(bars,sparse).sm60,null,'수급 55일 미만은 미확인');
  assert.ok(/longTermQuality:\['timeLagAccumulation'\]/.test(fs.readFileSync('js/pattern-scan.js','utf8')));
  console.log('accumulation ok');
})();
