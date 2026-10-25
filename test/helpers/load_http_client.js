/* Load the real common transport into isolated page-module browser fixtures. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shell = fs.readFileSync(path.join(__dirname, '../../js/skin-shell.js'), 'utf8');
const source = '/* NineHttp:' + shell.split('/* NineHttp:')[1].split('/* End NineHttp */')[0];
module.exports = function loadHttp(context) {
  const win = context.window || context;
  win.fetch = (...args) => context.fetch(...args);
  win.AbortController = context.AbortController || globalThis.AbortController;
  win.Headers = globalThis.Headers;
  vm.runInContext(source, vm.isContext(context) ? context : vm.createContext(context));
};
