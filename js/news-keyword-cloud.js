/* Shared collision-free news keyword cloud. Counts are article frequency, never sentiment. */
(function (global) {
  'use strict';
  function layout(area, words, makeButton) {
    var width = area.clientWidth;
    if (!width) return;
    area.replaceChildren();
    if (!words.length) { area.textContent = '기사 제목에서 2건 이상 반복된 키워드가 없습니다.'; area.style.height = 'auto'; return; }
    var max = Math.max.apply(null, words.map(function (w) { return w.count; }));
    var min = Math.min.apply(null, words.map(function (w) { return w.count; }));
    var height = width < 500 ? 320 : 390, placed = [];
    area.style.height = height + 'px';
    words.forEach(function (word, index) {
      var button = makeButton(word);
      button.classList.add('nkc-word');
      var label = document.createElement('span'); label.textContent = word.text;
      button.replaceChildren(label);
      button.style.setProperty('--nkc-delay', -(index % 9) * .83 + 's');
      button.style.setProperty('--nkc-duration', 6 + (index % 5) + 's');
      area.appendChild(button);
      var size = min === max ? 23 : 14 + 34 * Math.sqrt((word.count - min) / (max - min));
      if (width < 500) size = Math.min(size, 36);
      button.style.fontSize = size + 'px'; button.style.fontWeight = index < 5 ? '700' : '500';
      button.style.position = 'absolute'; button.style.visibility = 'hidden';
      var w = button.offsetWidth, h = button.offsetHeight;
      if (w > width - 20) { button.style.fontSize = Math.max(12, size * (width - 20) / w) + 'px'; w = button.offsetWidth; h = button.offsetHeight; }
      var hit = null;
      for (var step = 0; step < 2400; step++) {
        var t = step * .26, radius = 4.1 * Math.sqrt(step);
        var x = width / 2 + radius * Math.cos(t) * (width / height) - w / 2;
        var y = height / 2 + radius * Math.sin(t) - h / 2;
        if (x < 8 || y < 8 || x + w > width - 8 || y + h > height - 8) continue;
        if (placed.some(function (p) { return x < p.x + p.w + 9 && x + w + 9 > p.x && y < p.y + p.h + 9 && y + h + 9 > p.y; })) continue;
        hit = {x:x,y:y,w:w,h:h}; break;
      }
      if (hit) { placed.push(hit); button.style.left = hit.x + 'px'; button.style.top = hit.y + 'px'; button.style.visibility = 'visible'; }
      else button.remove(); // All words remain available through the caller's full list.
    });
  }
  // Market overview: simple repeated title terms, distinct from company-verified 7/30-day snapshots.
  var stop = new Set(('가장 이후 인해 주식 코스피 코스닥 대해서 어떻게 모든 또한 함께 이미 아직 다시 위한 관련 대한 통해 위한 올해 내년 오늘 내일 전망 주가 증권 종목 기업 시장 업계 기자 단독 종합 속보 뉴스 경제 한국 서울 미국 최근 최대 최초 공개 확대 증가 감소 상승 하락 급등 급락 사진 제공 무단 전재 재배포 금지 이메일 메일 대해 위해 있는 있다 한다 기록 돌파 기대 주목 목표 목표가 유지 분석 보고서 이유 대비 발표 체결 사업 추진 진출 성과 달성 나선다 선정 가운데 장중 마감 장초반 거래 거래일 거래량 거래대금 현재 이번 지난 경우 확인 업데이트 실시간 소식 대한 것은 것을 있다며 했다 한다 된다 이다 향후 앞두고 따른 따라 OF TO IN ON AT BY AS IS IT AN OR BE NEW NOW HIS OUT UP DOWN THAN MORE CAN NOT BUT ABOUT WHEN WHY WHAT WHO HOW THE AND FOR WITH FROM THIS THAT WILL HAVE HAS ARE WAS WERE ITS INTO OVER AFTER SAYS SAID CEO CFO CNBC BLOOMBERG REUTERS KST ET US').split(' '));
  function terms(title) {
    var clean = String(title || '').replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]+/g, ' ')
      .replace(/\[[^\]]*\]|【[^】]*】/g, ' ');
    var found = new Set();
    (clean.match(/[A-Za-z][A-Za-z0-9]{1,14}|[가-힣]{2,12}/g) || []).forEach(function (raw) {
      var token = raw.replace(/(에서는|으로는|에서|으로|까지|부터|에도|보다|의|은|는|을|를|이|가|와|과)$/, '');
      if (token.length < 2 || stop.has(token.toUpperCase()) || /(했다|한다|된다|이다|하며|하는|위한|억원|조원|만원|퍼센트|습니다)$/.test(token)) return;
      found.add(/^[A-Za-z]/.test(token) ? token.toUpperCase() : token);
    });
    return Array.from(found);
  }
  function fromHeadlines(items, titleOf, safeHref) {
    var seenLinks = new Set(), seenTitles = new Set(), buckets = new Map(), articles = [];
    items.forEach(function (item) {
      var title = titleOf(item), url = safeHref(item.link);
      var key = String(title || '').replace(/[^A-Za-z0-9가-힣]/g, '').toLowerCase();
      if (!url || !key || seenLinks.has(url) || seenTitles.has(key)) return;
      seenLinks.add(url); seenTitles.add(key);
      var article = {title:title, url:url, date:item.pubDate || ''}; articles.push(article);
      terms(title).forEach(function (term) {
        if (!buckets.has(term)) buckets.set(term, []);
        buckets.get(term).push(article);
      });
    });
    var keywords = Array.from(buckets, function (pair) { return {text:pair[0],count:pair[1].length,articles:pair[1]}; })
      .filter(function (word) { return word.count >= 2; })
      .sort(function (a, b) { return b.count - a.count || a.text.localeCompare(b.text, 'ko'); }).slice(0, 40);
    return {articleCount:articles.length,keywords:keywords};
  }
  global.NineKeywordCloud = { layout:layout, fromHeadlines:fromHeadlines };
})(window);
