/* Shared stock-icon fallback.
 *
 * A missing local asset is not treated as a dead end. The browser tries the
 * Naver market logo, then a local PNG, a known brand icon/favicon, and finally
 * a small generated initials badge. This keeps newly discovered symbols
 * visible without requiring a code change for every missing logo.
 */
(function (global) {
  'use strict';

  var LOCAL_BASE = 'https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/';
  var NAVER_BASE = 'https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock';
  var ICONIFY_BASE = 'https://api.iconify.design/';
  var FAVICON_BASE = 'https://icons.duckduckgo.com/ip3/';

  var BRAND_ICON_MAP = {
    AAPL: ['simple-icons', 'apple'], MSFT: ['simple-icons', 'microsoft'],
    NVDA: ['simple-icons', 'nvidia'], AMZN: ['simple-icons', 'amazon'],
    GOOGL: ['simple-icons', 'google'], GOOG: ['simple-icons', 'google'],
    TSLA: ['simple-icons', 'tesla'], META: ['simple-icons', 'meta'],
    INTC: ['simple-icons', 'intel'], CSCO: ['simple-icons', 'cisco'],
    AMD: ['simple-icons', 'amd'], AVGO: ['simple-icons', 'broadcom'],
    ORCL: ['simple-icons', 'oracle'],
    SPCX: ['simple-icons', 'spacex'],
    SNDK: ['thesvg-color', 'sandisk'], AZN: ['thesvg-color', 'astrazeneca']
  };

  var BRAND_DOMAIN_MAP = {
    RGTI: 'rigetti.com', RKLB: 'rocketlabusa.com', ORCL: 'oracle.com',
    LLY: 'lilly.com', DELL: 'dell.com', IONQ: 'ionq.com',
    SKHY: 'skhynix.com', ASTS: 'ast-science.com',
    MRVL: 'marvell.com', MCD: 'mcdonalds.com', WFC: 'wellsfargo.com',
    HWM: 'howmet.com', NSC: 'norfolksouthern.com', CCL: 'carnival.com'
  };

  function codeOf(image) {
    var explicit = image.getAttribute('data-icon-code');
    if (explicit) return String(explicit).replace(/^US:/i, '').toUpperCase();
    var match = String(image.src || '').match(/stock-icons\/([^./?]+)\.(?:svg|png)/i);
    return match ? decodeURIComponent(match[1]).replace(/^US:/i, '').toUpperCase() : '';
  }

  function marketOf(image, code) {
    var explicit = String(image.getAttribute('data-icon-market') || '').toLowerCase();
    if (explicit) return explicit;
    return /^[A-Z][A-Z0-9.-]*$/.test(code) ? 'us' : 'domestic';
  }

  function setStage(image, stage) {
    image.setAttribute('data-icon-stage', stage);
  }

  function generatedIcon(image, code) {
    if (!code) { image.style.display = 'none'; return; }
    var initials = code.slice(0, 2);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
      + '<rect width="48" height="48" rx="12" fill="#eef1f4"/>'
      + '<text x="24" y="29" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#657184">'
      + initials + '</text></svg>';
    setStage(image, 'generated');
    image.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  function fallback(image) {
    if (!image) return;
    var code = codeOf(image);
    var market = marketOf(image, code);
    var stage = image.getAttribute('data-icon-stage') || 'local';
    var brand = BRAND_ICON_MAP[code];
    var domain = BRAND_DOMAIN_MAP[code];

    if (stage === 'local') {
      setStage(image, 'naver');
      var naverCode = market === 'us' ? code + '.O' : code;
      image.setAttribute('data-icon-naver-code', naverCode);
      image.src = NAVER_BASE + encodeURIComponent(naverCode) + '.svg';
      return;
    }
    if (stage === 'naver' && market === 'us' && image.getAttribute('data-icon-naver-code') === code + '.O') {
      setStage(image, 'naver-bare');
      image.setAttribute('data-icon-naver-code', code);
      image.src = NAVER_BASE + encodeURIComponent(code) + '.svg';
      return;
    }
    if (stage === 'naver' || stage === 'naver-bare') {
      setStage(image, 'png');
      image.src = LOCAL_BASE + encodeURIComponent(code) + '.png';
      return;
    }
    if (stage === 'png' && brand) {
      setStage(image, 'iconify');
      image.src = ICONIFY_BASE + encodeURIComponent(brand[0]) + '/' + encodeURIComponent(brand[1]) + '.svg';
      return;
    }
    if ((stage === 'png' || stage === 'iconify') && domain) {
      setStage(image, 'favicon');
      image.src = FAVICON_BASE + encodeURIComponent(domain) + '.ico';
      return;
    }
    generatedIcon(image, code);
  }

  // Loaded before page modules in skin.html. Modules keep their local fallback
  // for standalone test pages, but production pages use this shared version.
  if (!global.__stockIconFallback) global.__stockIconFallback = fallback;
  global.StockIconFallback = fallback;
})(window);
