export function readGuestbook(list: Element) {
  const seen = new Set<string>();
  const rows = [];
  for (const item of list.querySelectorAll(':scope > ol > li[data-discussion-entry].guest_general')) {
    if (!/^comment\d+$/.test(item.id) || seen.has(item.id) ||
        [...item.classList].some(name => !['discussion-item','guest_general'].includes(name))) continue;
    const head = item.querySelector(':scope > .discussion-item-head');
    const body = item.querySelector(':scope > .discussion-item-body');
    const author = head?.querySelector(':scope > .name')?.textContent?.trim();
    const date = head?.querySelector(':scope > .date')?.textContent?.trim();
    const value = body && [...body.childNodes].map(node =>
      node.nodeType === Node.TEXT_NODE ? node.textContent : node.nodeName === 'BR' ? '\n' : ''
    ).join('').trim();
    if (!author || !date || !value || /비밀글|비공개/.test(value)) continue;
    seen.add(item.id);
    const parts = /^(\d{4})[.-]\s*(\d{1,2})[.-]\s*(\d{1,2})\.?\s+(\d{1,2}):(\d{2})$/.exec(date);
    let time = NaN;
    if (parts) {
      const [y,m,d,h,min] = parts.slice(1).map(Number);
      const parsed = new Date(Date.UTC(y,m-1,d,h,min));
      if (parsed.getUTCMonth() === m-1 && parsed.getUTCDate() === d && h < 24 && min < 60) time = +parsed;
    }
    const shorten = (text: string, limit: number) => {
      const chars = [...text];
      return chars.length > limit ? chars.slice(0,limit-1).join('')+'…' : text;
    };
    rows.push({author:shorten(author,20),date,body:shorten(value,150),time});
  }
  if (rows.every(row => Number.isFinite(row.time))) rows.sort((a,b) => b.time-a.time);
  return rows.slice(0,10);
}
