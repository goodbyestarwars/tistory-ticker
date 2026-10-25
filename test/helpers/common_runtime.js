/* Browser page fixtures use the same common entry point as the live Tistory skin.
 * Only provide missing shared globals; page code and assertions are unchanged.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load_http_client');
const shell = fs.readFileSync(path.join(__dirname, '../../js/skin-shell.js'), 'utf8');
const runNew = vm.runInNewContext, runContext = vm.runInContext;
const ui = '/* NineUI:' + shell.split('/* NineUI:')[1].split('/* End NineUI */')[0];
runNew(ui, {window:globalThis}); // Pure render snippets created with new Function.
let preparing = false;
function prepare(source, context) {
  if (!preparing && /(?:global|window)\.Nine(?:UI|API|Http)\./.test(String(source))) {
    preparing = true;
    try { load(context); } finally { preparing = false; }
  }
  return context;
}
vm.runInNewContext = function(source, context={}, options) { return runNew(source, prepare(source, context), options); };
vm.runInContext = function(source, context, options) { return runContext(source, prepare(source, context), options); };
