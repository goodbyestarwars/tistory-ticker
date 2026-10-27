const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/watchlist.js', 'utf8');
const start = source.indexOf("    container.querySelectorAll('.wl-group-delete')");
const end = source.indexOf('\n  }', start);
function run(approved, id = 'custom') {
  let click, prompt, saves = 0, renders = 0;
  let groups = [{id:'default',name:'기본'}, {id:'custom',name:'장기 보유'}];
  let list = [{code:'005930',groupId:'custom'}];
  const before = JSON.stringify({groups,list});
  const container = {querySelectorAll:()=>[{addEventListener:(_, fn)=>click=fn,closest:()=>({getAttribute:()=>id})}]};
  vm.runInNewContext(source.slice(start,end), {container, DEFAULT_GROUP_ID:'default',
    global:{confirm:message=>{prompt=message;return approved;}},
    loadGroups:()=>groups,loadList:()=>list,
    saveGroups:value=>{groups=value;saves++;},saveList:value=>{list=value;saves++;},render:()=>renders++});
  click();
  return {groups,list,prompt,saves,renders,before};
}
const cancelled = run(false);
assert.equal(JSON.stringify({groups:cancelled.groups,list:cancelled.list}),cancelled.before);
assert.equal(cancelled.saves,0);assert.equal(cancelled.renders,0);
assert.match(cancelled.prompt,/장기 보유/);assert.match(cancelled.prompt,/삭제되지 않고/);
const confirmed = run(true);
assert.equal(confirmed.groups.length,1);assert.equal(confirmed.list[0].groupId,'default');
assert.equal(confirmed.list[0].code,'005930');assert.equal(confirmed.saves,2);assert.equal(confirmed.renders,1);
const protectedGroup = run(true,'default');assert.equal(protectedGroup.saves,0);assert.equal(protectedGroup.prompt,undefined);
console.log('PASS: cancellation preserves data; confirmation moves stocks safely; default group protected.');
