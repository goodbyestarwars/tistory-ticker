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
const labelLayer = dialog.querySelector('.square-author-labels')!;
const authorLabels = new Map<string, HTMLElement>();
let selectedAuthor = '';
function selectAuthor(author: string, body: string) {
  selectedAuthor = author;
  for (const [name,label] of authorLabels) {
    const selected = name === selectedAuthor;
    label.textContent = selected ? name + ' · ' + body : name;
    label.classList.toggle('is-selected',selected);
  }
}

function update() {
  const list = root.querySelector('.discussion-list');
  const rows = list ? readGuestbook(list) : [];
  const next = JSON.stringify([!!list,rows]);
  if (next === snapshot) return;
  snapshot = next;
  panel.replaceChildren();
  labelLayer.replaceChildren();
  authorLabels.clear();
  selectedAuthor = '';
  stage.dispatchEvent(new Event('square-authors'));
  if (!rows.length) {
    panel.textContent = list ? '등록된 글이 없습니다' : '목록을 읽을 수 없습니다. 토론방에서 확인해 주세요.';
    return;
  }
  for (const row of rows) {
    const article = document.createElement('article');
    if (!authorLabels.has(row.author)) {
      const label = document.createElement('p');
      label.className = 'square-bubble';
      label.hidden = true;
      label.textContent = row.author;
      authorLabels.set(row.author,label);
      labelLayer.append(label);
    }
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'square-author';
    header.onclick = () => selectAuthor(row.author,row.body);
    const body = document.createElement('p');
    header.textContent = row.author+' · '+row.date;
    body.textContent = row.body;
    article.append(header,body);
    panel.append(article);
  }
  try {
    const pending = JSON.parse(sessionStorage.getItem('nine-square-pending') || 'null');
    if (pending && Date.now() - pending.at < 5*60_000) {
      const normalize = (text: string) => text.replace(/^\[[A-Z0-9]{1,10}\]\s*/i,'').replace(/\s+/g,' ').trim();
      const match = rows.find(row => !pending.existing.includes(row.id) && normalize(row.body) === normalize(pending.text));
      if (match) selectAuthor(match.author,match.body);
    }
  } catch {}
  stage.dispatchEvent(new Event('square-authors'));
}
const marketLink = stage.querySelector<HTMLAnchorElement>('.square-market')!;
const chartPanel = stage.querySelector<HTMLElement>('#square-chart')!;
const chartFrame = chartPanel.querySelector('iframe')!;
const chartClose = chartPanel.querySelector<HTMLButtonElement>('button')!;
function closeChart() {
  chartPanel.hidden = true;
  chartFrame.removeAttribute('src');
  marketLink.setAttribute('aria-expanded','false');
}
marketLink.onclick = event => {
  event.preventDefault();
  chartFrame.src = marketLink.href;
  chartPanel.hidden = false;
  marketLink.setAttribute('aria-expanded','true');
  chartClose.focus();
};
chartClose.onclick = () => {
  closeChart();
  marketLink.focus();
};
function stop() {
  closeChart();
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
function updateMarket() {
  const selected = new URLSearchParams(location.search).get('stock')?.toUpperCase() || '';
  const code = /^(?:\d{6}|US:[A-Z][A-Z0-9.\-^=]{0,11})$/.test(selected) ? selected : '';
  const selectedLabel = root.querySelector('[data-discussion-current]')?.textContent?.trim();
  const name = code ? selectedLabel?.split(' · ')[0] || code : '코스피';
  const market = stage.querySelector<HTMLAnchorElement>('.square-market')!;
  const chart = new URL('/page/stock-search',location.origin);
  chart.searchParams.set('tool','independent-chart');
  chart.searchParams.set('code',code || 'INDEX:KOSPI');
  chart.searchParams.set('name',name);
  market.href = chart.href;
  market.querySelector('strong')!.textContent = name;
}
function sync() {
  if (location.hash !== '#metaverse') {
    if (dialog.open) { stop(); dialog.close(); }
    return;
  }
  if (dialog.open) return;
  stage.hidden = false;
  status.textContent = '';
  updateMarket();
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
