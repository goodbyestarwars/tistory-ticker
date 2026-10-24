'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('js/home-weekly-report.js','utf8');
const block=js.slice(js.indexOf('  var contentSources ='),js.indexOf('  function render(root, payload)'));
class Node {
  constructor(name){this.name=name;this.children=[];this.parentNode=null;this.hidden=false;this.attributes={};}
  get isConnected(){return this.name==='document'||!!this.parentNode?.isConnected;}
  appendChild(n){n.remove();this.children.push(n);n.parentNode=this;return n;}
  insertBefore(n,b){n.remove();const i=this.children.indexOf(b);assert(i>=0);this.children.splice(i,0,n);n.parentNode=this;}
  remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
}
function fixture(){
  const doc=new Node('document'),feed=doc.appendChild(new Node('feed')),widget=feed.appendChild(new Node('widget')),
    footer=doc.appendChild(new Node('footer')),root=feed.appendChild(new Node('report'));
  const briefing=widget.appendChild(new Node('briefing')),stories=footer.appendChild(new Node('stories'));
  briefing.children=Array.from({length:8},(_,i)=>Object.assign(new Node('post'+i),{url:'/post/'+i,parentNode:briefing}));
  stories.children=Array.from({length:11},(_,i)=>Object.assign(new Node('story'+i),{url:'/learn/'+i,parentNode:stories}));
  const b=root.appendChild(new Node('bMount')),s=root.appendChild(new Node('sMount'));
  root.querySelector=q=>q==='[data-wd-briefing]'?b:q==='[data-wd-stories]'?s:null;
  doc.createComment=name=>Object.assign(new Node(name),{comment:true});
  doc.querySelector=q=>q==='.home-briefing-section'&&briefing.isConnected?briefing:q==='.site-footer-learn'&&stories.isConnected?stories:null;
  doc.getElementById=()=>root;
  const api=new Function('document',block+';return {syncContent,restoreContent};')(doc);
  return {doc,feed,widget,footer,root,briefing,stories,b,s,api};
}
test('move all original cards and their event identities; no clone or truncation',()=>{
  const f=fixture(),posts=[...f.briefing.children],stories=[...f.stories.children];let clicks=0;posts[0].click=()=>clicks++;
  f.api.syncContent(f.root,true);
  assert.equal(f.briefing.parentNode,f.b);assert.equal(f.stories.parentNode,f.s);
  assert.deepEqual(f.briefing.children,posts);assert.deepEqual(f.stories.children,stories);
  assert.equal(posts.length,8);assert.equal(stories.length,11);assert.equal(posts[0].url,'/post/0');posts[0].click();assert.equal(clicks,1);
  assert.equal(f.footer.children.filter(n=>n.name==='stories').length,0);
  assert.equal(f.footer.attributes['data-weekend-learn-slot'],'');
});
test('repeated sync and a cached/fresh rerender preserve originals and exact weekday slots',()=>{
  const f=fixture();for(let i=0;i<10;i++)f.api.syncContent(f.root,true);
  assert.equal(f.widget.children.filter(n=>n.comment).length,1);
  f.api.restoreContent();assert.equal(f.briefing.parentNode,f.widget);assert.equal(f.stories.parentNode,f.footer);
  f.api.syncContent(f.root,true);f.api.syncContent(f.root,false);
  assert.equal(f.widget.children.length,1);assert.equal(f.footer.children.length,1);
  assert.equal(f.briefing.attributes['data-weekend-content'],undefined);
  assert.equal(f.footer.attributes['data-weekend-learn-slot'],undefined);
  const start=js.indexOf('  function render(root, payload)');
  const render=js.slice(start,js.indexOf('  // 2026-08-30:',start));
  assert(render.indexOf('restoreContent();')<render.indexOf('root.innerHTML'));
  assert.doesNotMatch(render,/contentShelf|cloneNode|\.slice\(0, 3\)/);
});
test('widget manager moving the original is reconciled without losing weekday visibility',()=>{
  const f=fixture();f.api.syncContent(f.root,true);
  const newWidget=f.feed.appendChild(new Node('newWidget'));newWidget.appendChild(f.briefing);f.briefing.hidden=true;
  f.api.syncContent(f.root,true);assert.equal(f.briefing.hidden,false);
  f.api.syncContent(f.root,false);assert.equal(f.briefing.parentNode,newWidget);assert.equal(f.briefing.hidden,true);
  assert.equal(f.widget.children.length,0);assert.equal(f.stories.parentNode,f.footer);
});
test('missing source hides its mount without fabricating replacement content',()=>{
  const f=fixture();f.stories.remove();f.api.syncContent(f.root,true);
  assert.equal(f.s.hidden,true);assert.equal(f.s.children.length,0);assert.equal(f.b.children[0],f.briefing);
});
