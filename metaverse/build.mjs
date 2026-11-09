import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const result = await build({
  configFile:false,
  build:{write:false,target:'es2022',lib:{entry:fileURLToPath(new URL('./entry.ts',import.meta.url)),name:'InvestorSquare',formats:['iife']}}
});
const bundle = result[0].output.find(item => item.type === 'chunk').code;
const markup = await readFile(new URL('./plaza.html',import.meta.url),'utf8');

const [html, css] = markup.split('<style>');
const jsPath = new URL('../js/stock-discussion.js', import.meta.url);
const cssPath = new URL('../css/stock-discussion.css', import.meta.url);
const loader = [
  '(() => {',
  'const toolbar = document.querySelector("[data-market-discussion] .discussion-stockbar");',
  'if (!toolbar || document.getElementById("investor-square-enter")) return;',
  'if (typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal) return;',
  'toolbar.insertAdjacentHTML("beforebegin", ' + JSON.stringify(html) + ');',
  'const enter = document.getElementById("investor-square-enter");',
  'toolbar.closest("[data-market-discussion]").addEventListener("click", event => {',
  '  const submit = event.target.closest(".discussion-write input[type=submit]");',
  '  const form = submit?.closest(".discussion-write");',
  '  const text = form?.querySelector("textarea")?.value.trim();',
  '  if (!text || form.querySelector("input[name=secret]:checked")) return;',
  '  const existing = [...toolbar.closest("[data-market-discussion]").querySelectorAll("[data-discussion-entry][id]")].map(row => row.id);',
  '  try { sessionStorage.setItem("nine-square-pending", JSON.stringify({text,existing,at:Date.now()})); } catch {}',
  '}, true);',
  'function initialize() {',
  'window.removeEventListener("hashchange", direct);',
  bundle,
  '}',
  'function direct() { if (location.hash === "#metaverse") initialize(); }',
  'enter.hidden = false;',
  'enter.onclick = () => { location.hash = "metaverse"; initialize(); };',
  'window.addEventListener("hashchange", direct);',
  'direct();',
  '})();',
].join('\n');

for (const [path, code] of [[jsPath, loader], [cssPath, css.split('</style>')[0].trim()]]) {
  const start = '/* BEGIN INVESTOR SQUARE */';
  const end = '/* END INVESTOR SQUARE */';
  const original = (await readFile(path, 'utf8')).split(start)[0].trimEnd();
  await writeFile(path, [original, start, code, end, ''].join('\n'));
}
