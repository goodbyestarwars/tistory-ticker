/* Load the real common transport into isolated page-module browser fixtures. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shell = fs.readFileSync(path.join(__dirname, '../../js/skin-shell.js'), 'utf8');
const source = '/* NineHttp:' + shell.split('/* NineHttp:')[1].split('/* End NineHttp */')[0];
module.exports = function loadHttp(context) {
  const win = context.window || context;
  if (!context.fetch && win.fetch) context.fetch = win.fetch.bind(win);
  if (win !== context) win.fetch = (...args) => context.fetch(...args);
  win.AbortController = context.AbortController || globalThis.AbortController;
  win.Headers = globalThis.Headers;
  context = vm.isContext(context) ? context : vm.createContext(context);
  vm.runInContext(source, context);
  for (const name of ['NineUI', 'NineAPI']) {
    if (shell.includes('/* ' + name + ':')) vm.runInContext('/* ' + name + ':' + shell.split('/* ' + name + ':')[1].split('/* End ' + name + ' */')[0], context);
  }
};
