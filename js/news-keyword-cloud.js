/* Shared collision-free news keyword cloud. Counts are article frequency, never sentiment. */
(function (global) {
  'use strict';
  // Dense readable rows for the market overview's expanded 80-word set.
  // Keeps every rank visible without a multi-thousand-pixel spiral fallback.
  function layoutRows(area, words, makeButton) {
    var width = area.clientWidth;
    if (!width) return;
    area.replaceChildren();
    if (!words.length) { area.textContent = '기사 제목에서 2건 이상 반복된 키워드가 없습니다.'; area.style.height = 'auto'; return; }
    var max = Math.max.apply(null, words.map(function (w) { return w.count; }));
    var min = Math.min.apply(null, words.map(function (w) { return w.count; }));
    var margin = width < 500 ? 10 : 14, horizontalGap = width < 500 ? 9 : 14;
    var verticalGap = width < 500 ? 9 : 14;
    var row = [], rowWidth = 0, rowHeight = 0, top = margin;
    function flush() {
      if (!row.length) return;
      var x = Math.max(margin, (width - rowWidth) / 2);
      row.forEach(function (item) {
        item.button.style.left = x + 'px';
        item.button.style.top = top + (rowHeight - item.h) / 2 + 'px';
        item.button.style.visibility = 'visible';
        x += item.w + horizontalGap;
      });
      top += rowHeight + verticalGap;
      row = []; rowWidth = 0; rowHeight = 0;
    }
    words.forEach(function (word, index) {
      var button = makeButton(word);
      button.classList.add('nkc-word');
      var label = document.createElement('span'); label.textContent = word.text;
      button.replaceChildren(label);
      button.style.setProperty('--nkc-delay', -(index % 9) * .83 + 's');
      button.style.setProperty('--nkc-duration', 6 + (index % 5) + 's');
      area.appendChild(button);
      var size = min === max ? 22 : 14 + 30 * Math.sqrt((word.count - min) / (max - min));
      if (width < 500) size = Math.min(size, 32);
      button.style.fontSize = size + 'px';
      button.style.fontWeight = index < 5 ? '700' : '500';
      button.style.position = 'absolute'; button.style.visibility = 'hidden';
      var w = button.offsetWidth, h = button.offsetHeight;
      var allowed = Math.max(60, width - 2 * margin);
      if (w > allowed) {
        button.style.fontSize = Math.max(12, size * allowed / w) + 'px';
        w = button.offsetWidth; h = button.offsetHeight;
      }
      if (row.length && rowWidth + horizontalGap + w > allowed) flush();
      row.push({button:button,w:w,h:h});
      rowWidth += (rowWidth ? horizontalGap : 0) + w;
      rowHeight = Math.max(rowHeight,h);
    });
    flush();
    area.style.height = Math.max(180,Math.ceil(top + margin - verticalGap)) + 'px';
  }
  function layout(area, words, makeButton, options) {
    if (options && options.packed) return layoutRows(area, words, makeButton);
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
      else button.remove(); // The caller retains the complete frequency list.
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
  // Use existing verified company aliases and linked people, not new name lists.
  function maskRecognizedTerm(text, term) {
    if (!term) return text;
    var escaped = term.replace(/[\^$.*+?()[\]{}|]/g, '\\$&');
    return text.replace(new RegExp('(^|[^A-Za-z0-9가-힣])' + escaped +
      '(?=$|[^A-Za-z0-9가-힣]|[은는이가을를의에와과도만])', 'gi'), '$1 ');
  }
  function fromHeadlines(items, titleOf, safeHref, matcher) {
    var seenLinks = new Set(), seenTitles = new Set(), buckets = new Map(), articles = [];
    var entities = matcher || global.NineNewsStocks;
    items.forEach(function (item) {
      var title = titleOf(item), url = safeHref(item.link);
      var key = String(title || '').replace(/[^A-Za-z0-9가-힣]/g, '').toLowerCase();
      if (!url || !key || seenLinks.has(url) || seenTitles.has(key)) return;
      seenLinks.add(url); seenTitles.add(key);
      var article = {title:title, url:url, date:item.pubDate || ''}; articles.push(article);
      var inArticle = new Set(), freeText = String(title);
      function add(text, kind, id, extra) {
        var bucketKey = kind + ':' + (id || text);
        if (inArticle.has(bucketKey)) return;
        inArticle.add(bucketKey);
        if (!buckets.has(bucketKey)) buckets.set(bucketKey, {
          text:text, kind:kind, group:kind === 'topic' ? 'topic' : 'entity',
          count:0, articles:[], relation:extra || '', key:bucketKey
        });
        var bucket = buckets.get(bucketKey);
        bucket.count++; bucket.articles.push(article);
      }
      if (entities && typeof entities.headlineEntities === 'function') {
        var recognized = entities.headlineEntities(item);
        (recognized.companies || []).forEach(function (company) {
          add(company.name, 'company', company.market + ':' + company.code);
          (company.terms || []).forEach(function (term) { freeText = maskRecognizedTerm(freeText, term); });
        });
        (recognized.people || []).forEach(function (person) {
          add(person.name, 'person', person.market + ':' + person.code + ':' + person.name, person.companyName);
          (person.terms || []).forEach(function (term) { freeText = maskRecognizedTerm(freeText, term); });
        });
      }
      terms(freeText).forEach(function (term) { add(term, 'topic', term); });
    });
    var keywords = Array.from(buckets.values())
      .filter(function (word) { return word.count >= 2; })
      .sort(function (a, b) { return b.count - a.count || a.text.localeCompare(b.text, 'ko'); });
    var totalKeywords = keywords.length;
    // Top 80 across all classes, not 80 for each tab.
    keywords = keywords.slice(0, 80);
    return {articleCount:articles.length,keywords:keywords,totalKeywords:totalKeywords};
  }
  global.NineKeywordCloud = { layout:layout, fromHeadlines:fromHeadlines };
})(window);
