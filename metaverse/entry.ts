import { readGuestbook } from './guestbook';
import { start } from './scene';

const dialog = document.querySelector<HTMLDialogElement>('#investor-square')!;
const enter = document.querySelector<HTMLButtonElement>('#investor-square-enter')!;
const root = enter.closest('[data-market-discussion]')!;
const stage = dialog.querySelector<HTMLElement>('.square-stage')!;
const panel = dialog.querySelector('.square-posts')!;
const status = dialog.querySelector('.square-status')!;
const close = dialog.querySelector<HTMLButtonElement>('[data-square-close]')!;
let lifetime: AbortController | undefined;
let observer: MutationObserver | undefined;
let timer = 0;
let snapshot = '';
function update() {
  const list = root.querySelector('.discussion-list');
  const rows = list ? readGuestbook(list) : [];
  const next = JSON.stringify([!!list,rows]);
  if (next === snapshot) return;
  snapshot = next;
  panel.replaceChildren();
  if (!rows.length) {
    panel.textContent = list ? '등록된 글이 없습니다' : '목록을 읽을 수 없습니다. 토론방에서 확인해 주세요.';
    return;
  }
  for (const row of rows) {
    const article = document.createElement('article');
    const header = document.createElement('strong');
    const body = document.createElement('p');
    header.textContent = row.author+' · '+row.date;
    body.textContent = row.body;
    article.append(header,body);
    panel.append(article);
  }
}
function stop() {
  lifetime?.abort();
  lifetime = undefined;
  observer?.disconnect();
  clearTimeout(timer);
}
function fail() {
  stop();
  status.textContent = '이 환경에서 3D 화면을 표시할 수 없습니다. 토론방으로 돌아갈 수 있습니다.';
  stage.hidden = true;
  close.focus();
}
function sync() {
  if (location.hash !== '#metaverse') {
    if (dialog.open) { stop(); dialog.close(); }
    return;
  }
  if (dialog.open) return;
  stage.hidden = false;
  status.textContent = '';
  dialog.showModal();
  update();
  const list = root.querySelector('.discussion-list');
  if (list) {
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(update,100);
    });
    observer.observe(list,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','id']});
  }
  lifetime = new AbortController();
  try {
    start(stage,lifetime.signal);
    stage.querySelector('canvas')?.focus();
  } catch {
    fail();
  }
}
function leave() {
  if (location.hash === '#metaverse') history.replaceState(history.state,'',location.pathname+location.search);
  if (dialog.open) { stop(); dialog.close(); }
}
enter.onclick = () => { location.hash = 'metaverse'; sync(); };
close.onclick = leave;
dialog.addEventListener('cancel', e => { e.preventDefault(); leave(); });
dialog.addEventListener('close', () => { if (!dialog.open && document.activeElement === document.body) enter.focus(); });
stage.addEventListener('square-context-lost',fail);
dialog.querySelector<HTMLButtonElement>('[data-square-refresh]')!.onclick = () => location.reload();
dialog.querySelector<HTMLButtonElement>('[data-square-write]')!.onclick = () => {
  leave();
  requestAnimationFrame(() => root.querySelector<HTMLTextAreaElement>('.discussion-write textarea')?.focus());
};
window.addEventListener('hashchange',sync);
window.addEventListener('pagehide', () => { stop(); if (dialog.open) { stop(); dialog.close(); } });
window.addEventListener('pageshow',sync);
sync();
