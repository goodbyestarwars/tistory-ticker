/* 3장 물가와 인플레이션: 이 페이지에서만 쓰는 학습 계산기.
   출처/단위가 다른 역사 가격을 공식 물가지수로 오해하지 않도록 입력값과 계산 결과를 분리한다. */
(function () {
  'use strict';
  var root = document.getElementById('inflation-tools');
  if (!root) return;
  function el(id) { return document.getElementById(id); }
  function num(id, fallback) {
    var node = el(id), val = node ? Number(node.value) : NaN;
    return Number.isFinite(val) ? val : fallback;
  }
  function write(id, value) { var node = el(id); if (node) node.textContent = String(value); }
  function won(value) { return Math.round(value).toLocaleString('ko-KR') + '원'; }
  function signed(value) { return (value > 0 ? '+' : '') + value.toFixed(2) + '%'; }
  function bar(id, value) {
    var node = el(id);
    if (node) node.style.width = Math.max(2, Math.min(100, Math.abs(value) / 15 * 100)).toFixed(2) + '%';
  }
  function renderNoodle() {
    var past = num('in-old-price', 800), now = num('in-now-price', 7808);
    if (past <= 0 || now <= 0) {
      write('in-noodle-result', '두 가격 모두 0보다 큰 값을 입력해 주세요.');
      return;
    }
    var ratio = now / past;
    write('in-noodle-result', '가격 ' + ratio.toFixed(2) + '배 · 누적 ' + signed((ratio - 1) * 100));
    write('in-noodle-old-count', (8000 / past).toFixed(2) + '그릇');
    write('in-noodle-now-count', (8000 / now).toFixed(2) + '그릇');
    write('in-noodle-compare', '8,000원으로 당시 ' + (8000 / past).toFixed(1) + '그릇, 비교 시점에는 ' + (8000 / now).toFixed(1) + '그릇을 살 수 있습니다.');
  }
  function renderBasket() {
    var market = num('in-market-weight', 30) / 100;
    var home = num('in-home-weight', 70) / 100;
    var food = num('in-food-rate', 10);
    var others = num('in-other-rate', -2);
    var avg = market * food + (1 - market) * others;
    var mine = home * food + (1 - home) * others;
    write('in-market-label', Math.round(market * 100) + '%');
    write('in-home-label', Math.round(home * 100) + '%');
    write('in-market-result', signed(avg));
    write('in-home-result', signed(mine));
    bar('in-market-bar', avg);
    bar('in-home-bar', mine);
    write('in-basket-gap', '같은 품목 가격변화라도 가중치가 달라 차이가 ' + Math.abs(mine - avg).toFixed(2) + '%p 납니다.');
  }
  function renderWage() {
    var wage = num('in-wage-rate', 4), price = num('in-price-rate', 6);
    if (wage <= -100 || price <= -100) {
      write('in-real-wage', '두 변화율 모두 -100%보다 커야 합니다.');
      return;
    }
    var real = ((1 + wage / 100) / (1 + price / 100) - 1) * 100;
    write('in-real-wage', signed(real));
    write('in-wage-example', '100만 원 → ' + won(1000000 * (1 + wage / 100)));
    write('in-wage-purchasing', '기준 시점 가격으로 환산한 월급 → ' + won(1000000 * (1 + wage / 100) / (1 + price / 100)));
  }
  [
    ['in-old-price', renderNoodle], ['in-now-price', renderNoodle],
    ['in-market-weight', renderBasket], ['in-home-weight', renderBasket],
    ['in-food-rate', renderBasket], ['in-other-rate', renderBasket],
    ['in-wage-rate', renderWage], ['in-price-rate', renderWage]
  ].forEach(function (pair) {
    var node = el(pair[0]);
    if (node) node.addEventListener('input', pair[1]);
  });
  renderNoodle();
  renderBasket();
  renderWage();
})();
