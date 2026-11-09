import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const result = await build({
  configFile:false,
  build:{write:false,target:'es2022',lib:{entry:fileURLToPath(new URL('./entry.ts',import.meta.url)),name:'InvestorSquare',formats:['iife']}}
});
const bundle = result[0].output.find(item => item.type === 'chunk').code;
const markup = await readFile(new URL('./plaza.html',import.meta.url),'utf8');
const snippet = markup + '<script>\n(() => {\n' +
  'const enter = document.getElementById("investor-square-enter");\n' +
  'function initialize(){\n' +
  'window.removeEventListener("hashchange", direct);\n' +
  bundle.replace(/<\/script/gi,'<\\/script') + '\n}\n' +
  'function direct(){if(location.hash==="#metaverse") initialize();}\n' +
  'if(typeof HTMLDialogElement==="undefined" || !HTMLDialogElement.prototype.showModal) return;\n' +
  'enter.hidden=false; enter.onclick=()=>{location.hash="metaverse"; initialize();};\n' +
  'window.addEventListener("hashchange", direct); direct();\n' +
  '})();\n</script>\n';
const skinPath = process.argv[2];
const marker = '          <div class="discussion-stockbar">';
const begin = '<!-- BEGIN INVESTOR SQUARE -->';
const end = '<!-- END INVESTOR SQUARE -->';
const skin = (await readFile(skinPath,'utf8')).replace(/\uFEFF/g,'');
const original = skin.replace(/<!-- BEGIN INVESTOR SQUARE -->[\s\S]*?<!-- END INVESTOR SQUARE -->\r?\n/g,'');
if (original.split(marker).length !== 2) throw new Error('Expected exactly one discussion toolbar');
await writeFile(skinPath, original.replace(marker, () => begin+'\n'+snippet+end+'\n'+marker));
