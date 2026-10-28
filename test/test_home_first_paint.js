const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const skin=fs.readFileSync('skin.html','utf8'),main=fs.readFileSync('js/skin-main.js','utf8');
const boot=skin.match(/<script id="home-first-paint">([\s\S]*?)<\/script>/)[1];
for(const pathname of ['/','','/category/마켓 브리핑','/page/stock-search','/1310']){
 const classes=new Set(),timers=[];
 vm.runInNewContext(boot,{location:{pathname},document:{documentElement:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}},setTimeout:(fn,ms)=>timers.push({fn,ms})});
 const home=pathname==='/'||pathname==='';assert.equal(classes.has('home-render-pending'),home);
 assert.equal(timers.length,home?1:0);
 if(home){assert.equal(timers[0].ms,6000);timers[0].fn();assert.equal(classes.has('home-render-pending'),false,'script failure releases the original article list');}
}
const css=skin.match(/<style id="initial-paint-guard">([\s\S]*?)<\/style>/)[1];
assert(css.includes('html.home-render-pending .feed > :is(.post-card, .notice-card, .pagination)'));
assert(css.includes('.feed > .home-boot-status { display: none; }'));
assert(!css.includes('visibility: hidden'));assert(!css.includes('!important'));
assert.match(skin,/<p class="home-boot-status" role="status">홈 화면 준비 중<\/p>/);
const link=skin.indexOf('data-home-market-board-css="1"');assert(link>0&&link<skin.indexOf('</head>'),'market styles are parser-discovered and render blocking');
assert(skin.slice(link,skin.indexOf('>',link)).includes('css/home-market-board.css?v=20261027-open-block-columns'));
const begin=main.indexOf('(function buildHomeDashboard()'),end=main.indexOf('(function buildCategoryFeedBlocks()',begin),build=main.slice(begin,end);
const release=build.indexOf("document.documentElement.classList.remove('home-render-pending')");
assert(release>build.indexOf('var allCards ='),'publish only after original cards are regrouped');
assert(release>build.indexOf('feed.insertBefore(dashboardSection'),'publish after dashboard insertion');
assert(!build.slice(release).includes('fetch('),'publication does not start another network loader');
console.log('PASS home-only first-paint staging, head CSS, synchronized publication and six-second failure recovery');
