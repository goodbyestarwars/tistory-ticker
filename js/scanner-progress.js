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
    var validProgress = p && Number.isFinite(p.total) && p.total > 0 && Number.isFinite(p.processed) && p.processed >= 0 && p.processed <= p.total;
    var stamp = p && p.updatedAt || execution.startedAt || execution.queuedAt;
    var updated = Date.parse(stamp || '');
    var age = now - updated;
    var running = state === 'running';
    // The server owns execution state. Batch progress is reported every 25 stocks; age is advisory only.
    var stale = running && (!Number.isFinite(updated) || age < -60000 || age > 180000);
    var percent = state === 'success' ? 100 : state === 'running' && validProgress ? Math.min(99, Math.floor(p.processed / p.total * 100)) : null;
    var labels = { running: '스캔 진행 중', waiting: '앞선 스캔 완료 대기', success: '스캔 완료',
      failed: '스캔 오류', timeout: '스캔 시간 초과', interrupted: '스캔 중단', deadline: '스캔 실행창 종료',
      run_timeout: '스캔 시간 초과', wait_timeout: '스캔 대기 시간 초과', launch_failed: '스캔 실행 실패',
      outside_window: '실행 시간 밖 종료', holiday: '휴장일 스캔 없음', prerequisite_stale: '선행 데이터 갱신 필요',
      skipped: '스캔 건너뜀', unknown: '스캔 상태 확인 중', unverified: '실행 상태 미확인' };
    var scope = target && target.id === 'strategyscan' ? '전략 배치' : '일봉 배치';
    var detail = state === 'running' && validProgress ? (p.phase ? p.phase + ' · ' : '') + p.processed.toLocaleString('ko-KR') + ' / ' + p.total.toLocaleString('ko-KR') + (p.unit || '종목') + ' 처리' : '';
    return { state: state, percent: percent, compact: state === 'success' || state === 'skipped',
      title: scope + ' · ' + (labels[state] || '스캔 상태 확인 필요'),
      detail: detail || (execution.reason ? String(execution.reason) : /failed|timeout|interrupted|deadline|outside_window|prerequisite_/.test(state) && Number.isFinite(execution.exitCode) ? '실행 종료 코드 '+execution.exitCode+' · 상세 원인은 실행 로그 확인' : ''), stale: stale, updatedAt: running ? stamp : execution.finishedAt || stamp,
      note: stale ? '진행 정보 갱신 대기 · 마지막 확인 진행률 유지'
        : state === 'outside_window' ? '허용 시간 밖 실행이 종료됨 · 완료 확인 안 됨' + (target && target.nextRunAt && Number.isFinite(Date.parse(target.nextRunAt)) ? ' · 다음 예정 ' + new Date(target.nextRunAt).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}) : '')
        : strategy && target === daily ? '일봉 데이터 확인 후 전략 계산 · 기존 결과 유지'
        : '장중 단타 감시와 별도인 배치 상태 · 완료 후 검색 결과 갱신' };

  }
  global.ScannerProgress = { model: model };
  if (!global.document) return;
  var document = global.document;
  var strategy = /strategy-search/.test(global.location.pathname);
  var selector = strategy ? '#strategy-search' : '#pattern-scan';
  var selfUrl = document.currentScript && document.currentScript.src;
  var strip, pending = false, attempts = 0, previousCompletion, publicSummary;
  function updatePublicCount() {
    var el=strip && strip.querySelector('.scan-public-count');
    var summary=publicSummary || global.PatternScan && global.PatternScan.publicSummary;
    if(el)el.textContent=summary && summary.known?'현재 유효 확정 '+summary.counts.confirmed+'종목':'현재 유효 확정 확인 중';
  }
  document.addEventListener('scanner-public-state',function(event){publicSummary=event.detail;updatePublicCount();});
  var esc = function (s) { return global.NineUI.escapeHtml(String(s || '')); };
  function render(value) {
    strip.classList.toggle('is-complete', value.compact);
    var known = value.percent !== null;
    var label = known ? value.percent + '%' : value.state === 'unverified' ? '확인 필요' : value.state === 'running' ? '진행 중' : value.state === 'waiting' ? '대기' : /failed|timeout|interrupted|deadline|outside_window|prerequisite_stale/.test(value.state) ? '중단' : '집계 대기';
    var panel = strip.querySelector('.scan-status-panel') || strip;
    strip.setAttribute('data-state', value.state);
    global.ScannerProgress.latest = value;
    if (typeof global.CustomEvent === 'function') document.dispatchEvent(new global.CustomEvent('scanner-progress-data', {detail:value}));
    panel.innerHTML = '<div class="scan-progress-gauge" role="img" aria-label="' + esc(label) + '">'
      + '<svg class="scan-progress-ring" viewBox="0 0 112 112" aria-hidden="true"><circle class="scan-progress-track" cx="56" cy="56" r="47"/>'
      + '<circle class="scan-progress-value" cx="56" cy="56" r="47" pathLength="100" style="stroke-dasharray:' + (known ? value.percent : 0) + ' 100"/></svg>'
      + '<svg class="scan-progress-bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 10-13h-8z"/></svg>'
      + '<span class="scan-progress-percent">' + esc(label) + '</span></div>'
      + '<div class="scan-progress-copy"><span class="scan-progress-label">검색기 업데이트</span>'
      + '<strong>' + esc(value.title) + '</strong>'
      + (!strategy ? '<span>' + esc(label) + ' · <span class="scan-public-count">현재 유효 확정 확인 중</span></span>' : '')
      + (value.detail ? '<span>' + esc(value.detail) + '</span>' : '')
      + '<small>' + esc(!strategy && value.note==='장중 단타 감시와 별도인 배치 상태 · 완료 후 검색 결과 갱신'?'배치 완료와 신호 검증은 별도':value.note) + '</small>'
      + (value.updatedAt && Number.isFinite(Date.parse(value.updatedAt)) ? '<small>' + (value.state==='success'?'마지막 완료 ':'기준 ') + esc(new Date(value.updatedAt).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})) + '</small>' : '') + '</div>';
    updatePublicCount();
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
    strip.className = 'scanner-progress-status' + (strategy ? '' : ' is-dashboard');
    if (!strategy) strip.innerHTML = '<div class="scan-status-panel" aria-live="polite"></div>';
    strip.setAttribute('aria-label', '검색기 업데이트 진행 상황');
    container.parentNode.insertBefore(strip, container);
    render(model([], strategy, Date.now()));
    refresh();
    if (!strategy && selfUrl) {
      var dashboard = document.createElement('script');
      dashboard.src = new URL('scanner-dashboard.js', selfUrl).href;
      document.head.appendChild(dashboard);
    }
    global.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})(typeof window === 'undefined' ? globalThis : window);

