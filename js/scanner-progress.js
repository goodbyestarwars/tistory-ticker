/* Shared scanner status: stored schedule telemetry only, no collection requests. */
(function (global) {
  'use strict';
  if (global.ScannerProgress) return;
  function model(jobs, strategy, now) {
    var daily = jobs.find(function (j) { return j.id === 'dailyscan'; });
    var target = jobs.find(function (j) { return j.id === (strategy ? 'strategyscan' : 'dailyscan'); });
    var execution = target && target.lastExecution || {};
    if (strategy && execution.state === 'waiting' && daily && (daily.lastExecution || {}).state === 'running') {
      target = daily;
      execution = daily.lastExecution;
    }
    var state = execution.state || 'unknown';
    var p = target && target.progress;
    var percent = null;
    if (state === 'success') percent = 100;
    if (state === 'running' && p && p.total > 0 && Number.isFinite(p.processed) && p.processed >= 0 && p.processed <= p.total) {
      percent = Math.min(99, Math.floor(p.processed / p.total * 100));
    }
    var labels = { running: '스캔 진행 중', waiting: '앞선 스캔 완료 대기', success: '스캔 완료',
      failed: '스캔 오류', timeout: '스캔 시간 초과', interrupted: '스캔 중단', deadline: '스캔 실행창 종료',
      skipped: '스캔 건너뜀', unknown: '스캔 상태 확인 중' };
    var updated = p && Date.parse(p.updatedAt);
    var stale = state === 'running' && Number.isFinite(updated) && now - updated > 180000;
    var detail = state === 'running' && p ? p.processed.toLocaleString('ko-KR') + ' / ' + p.total.toLocaleString('ko-KR') + (p.unit || '종목') + ' 처리' : '';
    return { state: state, percent: percent, compact: state === 'success' || state === 'skipped',
      title: state === 'running' && p ? p.phase : labels[state] || '스캔 상태 확인 필요',
      detail: detail, stale: stale, updatedAt: execution.finishedAt || p && p.updatedAt || execution.startedAt || execution.queuedAt,
      note: stale ? '진행 정보 갱신 지연 · 마지막 확인값' : strategy && target === daily ? '데이터 확인 후 전략 계산 · 기존 결과 유지' : '완료 후 검색 결과 갱신' };
  }
  global.ScannerProgress = { model: model };
  if (!global.document) return;
  var document = global.document;
  var strategy = /strategy-search/.test(global.location.pathname);
  var selector = strategy ? '#strategy-search' : '#pattern-scan';
  var strip, pending = false, attempts = 0, previousCompletion;
  var esc = function (s) { return global.NineUI.escapeHtml(String(s || '')); };
  function render(value) {
    strip.classList.toggle('is-complete', value.compact);
    var known = value.percent !== null;
    var label = known ? value.percent + '%' : value.state === 'waiting' ? '대기' : /failed|timeout|interrupted|deadline/.test(value.state) ? '중단' : '집계 대기';
    strip.innerHTML = '<div class="scan-progress-gauge" role="img" aria-label="' + esc(label) + '">'
      + '<svg class="scan-progress-ring" viewBox="0 0 112 112" aria-hidden="true"><circle class="scan-progress-track" cx="56" cy="56" r="47"/>'
      + '<circle class="scan-progress-value" cx="56" cy="56" r="47" pathLength="100" style="stroke-dasharray:' + (known ? value.percent : 0) + ' 100"/></svg>'
      + '<svg class="scan-progress-bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 10-13h-8z"/></svg>'
      + '<span class="scan-progress-percent">' + esc(label) + '</span></div>'
      + '<div class="scan-progress-copy"><span class="scan-progress-label">검색기 업데이트</span>'
      + '<strong>' + esc(value.title) + '</strong>'
      + (value.detail ? '<span>' + esc(value.detail) + '</span>' : '')
      + '<small>' + esc(value.note) + '</small>'
      + (value.updatedAt ? '<small>기준 ' + esc(new Date(value.updatedAt).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})) + '</small>' : '') + '</div>';
  }
  function refresh() {
    if (pending || document.hidden || !strip.isConnected) return;
    pending = true;
    global.NineHttp.json('https://goodbyestar.cloud/health/schedules', { timeoutMs: 12000, ttlMs: 30000 })
      .then(function (body) {
        var data = body && body.data || body;
        if (!data || !Array.isArray(data.jobs)) throw new Error('Missing schedules');
        render(model(data.jobs, strategy, Date.now()));
        var job = data.jobs.find(function (j) { return j.id === (strategy ? 'strategyscan' : 'dailyscan'); });
        var execution = job && job.lastExecution || {};
        var completed = execution.state === 'success' ? execution.finishedAt : null;
        if (previousCompletion !== undefined && completed && completed !== previousCompletion) {
          var consumer = strategy ? global.StrategySearch : global.PatternScan;
          if (consumer && consumer.refresh) consumer.refresh();
        }
        previousCompletion = completed;
      }).catch(function () {
        render({ state:'unknown', percent:null, compact:false, title:'스캔 상태를 확인하지 못했어요',
          note:'잠시 후 다시 확인합니다. 기존 검색 결과는 유지됩니다.' });
      }).finally(function () { pending = false; });
  }
  function mount() {
    var container = document.querySelector(selector);
    if (!container || !global.NineHttp || !global.NineUI) {
      if (++attempts < 15) global.setTimeout(mount, 1000);
      return;
    }
    if (document.getElementById('scanner-progress-status')) return;
    strip = document.createElement('section');
    strip.id = 'scanner-progress-status';
    strip.className = 'scanner-progress-status';
    strip.setAttribute('aria-label', '검색기 업데이트 진행 상황');
    container.parentNode.insertBefore(strip, container);
    render(model([], strategy, Date.now()));
    refresh();
    global.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})(typeof window === 'undefined' ? globalThis : window);
