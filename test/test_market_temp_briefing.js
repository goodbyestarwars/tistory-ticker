// 시장 브리핑(07:00 서버 확정) 화면 + 장중 갱신 레인 계약 (2026-10-23).
// 브라우저는 신호를 계산하지 않고 서버 스냅샷을 그리기만 한다. 갱신은 국내 정규장 단계별 레인으로 나뉜다.
const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('js/market-temp.js', 'utf8').replace('global.MarketTemp = MarketTemp;',
  'global.MarketTemp = MarketTemp; global.t={renderBriefing_,briefingMeta_,briefingTitle_,marketPhase_,lanePeriod_,nextRunAt_,dueLanes_,liveStatusText_,' +
  'buildCheckContext_,checkpointContextHtml_,intradayChanges_,sectorAsOf_,rankChangeHtml_,sharedMarketJson_,loadBriefing_,paintBriefing_,buildStrategy,marketRefreshDelay_,LANE_TTL_,LANE_PERIODS_,AI_STATE_,loadAiComments_};');
const sb = { window: {}, document: { readyState: 'loading', addEventListener() {} }, console, setTimeout, clearTimeout, fetch: async () => ({ ok: true, json: async () => ({}) }) };
vm.runInNewContext(source, sb);
const t = sb.window.t;
const kst = (y, m, d, hh, mm, ss = 0) => Date.UTC(y, m - 1, d, hh - 9, mm, ss);

// ---------- 화면: 서버 스냅샷 그대로 ----------
const bucket = { key: 'down', label: '하락 우세', gap: '시초 하락 출발 86%', close: '하락 마감 51% · 장중 반등도 잦음', n: 35, span: '최근 232일' };
const inputs = (o = {}) => Object.assign({
  spx: { name: 'S&P 500', pct: -1.21, date: '20261023' }, nas: { name: '나스닥 종합', pct: -2.6, date: '20261023' }, dji: { name: '다우존스', pct: 0.02, date: '20261023' },
  sox: { name: '필라델피아 반도체', pct: -6.72, date: '20261023' }, vix: { name: 'VIX', pct: 14.09, date: '20261023' }, fx: { name: '원/달러', pct: 0.4, date: '20261023' } }, o);
const snap = (o = {}) => Object.assign({ usSessionDate: '20261023', usHoliday: null, usHolidayAssumed: null, inputs: inputs(),
  night: { included: true, sessionDate: '20261023', close: 834.6, dayClose: 857, change: -22.4, gapPct: -2.61 },
  signal: { zsum: -2.4, model: 7, tone: 'down', bucket } }, o);
const brief = (o = {}) => Object.assign({ targetDate: '2026-10-26', targetLabel: '10/26(월)', status: 'final', scheduledAt: '2026-10-26 07:00:00',
  firstConfirmedAt: '2026-10-26 07:00:05', revisedAt: null, revision: 0, revisions: [], attempts: 1, nextRetryAt: null, lastError: null, snapshot: snap() }, o);
const payload = (b, o = {}) => Object.assign({ today: '2026-10-26', session: { phase: 'open', tradingDay: true, openAt: '09:00', closeAt: '15:30', postCloseMinutes: 60, today: '2026-10-26' },
  briefing: b, next: { targetDate: '2026-10-27', targetLabel: '10/27(화)', scheduledAt: '2026-10-27 07:00:00' } }, o);

let r = t.renderBriefing_(payload(brief()));
assert.equal(r.title, '시장 브리핑 · 10/26(월)');
assert.equal(r.meta, '07:00 확정 · 미국장 마감 기준');
assert(r.final && r.body.includes('하락 우세') && r.body.includes('오늘 시초는 내려서 시작할 가능성이 높습니다'), '오늘 브리핑 결론');
assert(r.body.includes('-1.21%') && r.body.includes('-2.60%') && r.body.includes('+14.09%') && r.body.includes('-6.72%'), '미국 지표 수치');
assert(r.body.includes('코스피200 야간선물') && r.body.includes('-2.61%') && r.body.includes('data-ai-slot="night"'), '야간선물 칸 기본: 이름·등락률·AI 코멘트 자리');
assert(r.body.includes('mt-tm-nd') && r.body.includes('834.60') && r.body.includes('-22.40') && r.body.includes('KIS 야간선물') && r.body.includes('최종 마감') && r.body.includes('반영됨'), '상세에 종가·등락폭·상태·출처');
assert.equal((r.body.match(/mt-tm-item/g) || []).length, 6, '6칸(S&P·나스닥·다우·SOX·VIX·야간선물)');
assert(!r.body.includes('mt-tm-nd" open') && t.renderBriefing_(payload(brief()), { nightOpen: true }).body.includes('mt-tm-nd" open'), '야간선물 상세 열림 상태 유지');
// 지표별 한 줄 해설은 서버 AI 코멘트(GET /ai-comments)다. 코멘트가 없으면 빈 칸(고정 문구로 채우지 않는다).
assert(!/가까스로 버텼네|기술주 매도세|반도체 급락… 국내도|시장 불안이 커지고 있네/.test(r.body), '고정 해설 문구가 남아 있지 않다');
assert(['spx', 'nas', 'dji', 'sox', 'vix', 'night'].every((k) => r.body.includes('data-ai-slot="' + k + '"')) && !/data-ai-slot=\"[a-z_]+\"[^>]*>[^<]/.test(r.body.replace(/<small/g, '<')), '코멘트 없음: 자리만 있고 비어 있음');
t.AI_STATE_.comments = { sox: { text: '반도체가 크게 꺾여서 국내 반도체가 걱정되네', generatedAt: '2026-10-26 07:03:00', dataAsOf: '2026-10-23', tradeDate: '2026-10-26', model: 'm' },
  brief_summary: { text: '미국이 밀려서 시초는 무거울 수 있어 보이네', generatedAt: '2026-10-26 07:03:00', dataAsOf: '2026-10-26', tradeDate: '2026-10-26', model: 'm' },
  nas: { text: '<b>x</b> 기술주 이야기', generatedAt: '2026-10-26 07:03:00', dataAsOf: '2026-10-23', tradeDate: '2020-01-02', model: 'm' } };
{ const ai = t.renderBriefing_(payload(brief())).body;
  assert(ai.includes('반도체가 크게 꺾여서') && ai.includes('미국이 밀려서 시초는') && ai.includes('mt-ai-summary'), 'AI 코멘트 표시(칸·요약)');
  assert(!ai.includes('<b>x</b>') && ai.includes('&lt;b&gt;x&lt;/b&gt;'), 'AI 문장은 HTML 이스케이프');
  assert(ai.includes('1.2 기준'), '지난 거래일 코멘트는 원래 기준일을 표시: ' + ai.slice(ai.indexOf('data-ai-slot="nas"') - 40, ai.indexOf('data-ai-slot="nas"') + 220));
  assert(ai.includes('title="AI 코멘트 · 생성 2026-10-26 07:03:00 · 데이터 기준 2026-10-23 · m"'), '생성 시각·데이터 기준일 툴팁');
  t.AI_STATE_.comments = {};
}
assert(r.body.includes('환율 상승(원화 약세)') && !r.body.includes('원/달러</span>'), '원/달러는 한국장 영향 문장에만(칸 없음)');
assert(r.body.includes('<b>35거래일</b>') && r.body.includes('시초 하락 출발 86%'), '과거 통계');
// 같은 응답이면 언제 그려도 같다(브라우저 시각·새로고침에 따라 바뀌지 않음)
const realNow = Date.now; Date.now = () => kst(2026, 10, 26, 14, 0);
const again = t.renderBriefing_(payload(brief()));
Date.now = realNow;
assert.equal(again.body, r.body); assert.equal(again.meta, r.meta);

// 정정은 최초 확정 시각과 구분해서 보인다 / 늦게 생성되면 지연 표시
r = t.renderBriefing_(payload(brief({ revision: 1, revisedAt: '2026-10-26 08:03:10', revisions: [{ at: '2026-10-26 08:03:10', reason: '야간선물 최종 봉 확보 후 반영' }] })));
assert.equal(r.meta, '07:00 확정 · 08:03 정정(야간선물 최종 봉 확보 후 반영) · 미국장 마감 기준');
r = t.renderBriefing_(payload(brief({ firstConfirmedAt: '2026-10-26 07:40:00' })));
assert(r.meta.startsWith('07:40 확정(지연 생성)'), r.meta);

// 지난 거래일 브리핑(주말·개장 전)은 그렇게 표시하고 다음 예정을 알린다
r = t.renderBriefing_(payload(brief({ targetDate: '2026-10-23', targetLabel: '10/23(금)', firstConfirmedAt: '2026-10-23 07:00:02', scheduledAt: '2026-10-23 07:00:00' }),
  { today: '2026-10-24', next: { targetDate: '2026-10-26', targetLabel: '10/26(월)', scheduledAt: '2026-10-26 07:00:00' } }));
assert.equal(r.title, '시장 브리핑 · 10/23(금)');
assert(r.meta.includes('지난 거래일 브리핑') && r.meta.includes('다음 10/26(월) 07:00 확정 예정'), r.meta);
assert(r.body.includes('10/23(금) 시초는 내려서'), '오늘이 아니면 날짜로 쓴다');

// 미확정·실패·없음: 숫자나 전망을 만들지 않는다
r = t.renderBriefing_(payload(brief({ status: 'pending', snapshot: null, firstConfirmedAt: null, nextRetryAt: '2026-10-26 07:05:00', lastError: 'S&P 500 최신 일봉 20261022 (기대 20261023)' })));
assert(!r.final && r.meta === '미확정 · 07:00 확정 예정 · 07:05 다시 확인' && r.body.includes('브리핑 미확정') && r.body.includes('S&amp;P 500 최신 일봉'), r.meta);
assert(!/[+-]\d+\.\d\d%/.test(r.body.replace(/20261022|20261023/g, '')), '미확정에는 수치 없음');
r = t.renderBriefing_(payload(brief({ status: 'failed', snapshot: null, firstConfirmedAt: null, lastError: null })));
assert(r.meta.includes('확정하지 못했습니다') && r.body.includes('브리핑 미확정'));
r = t.renderBriefing_(payload(null, { today: '2026-10-24' }));
assert(r.title === '시장 브리핑 · 10/27(화)' && r.meta.includes('아직 확정된 브리핑이 없습니다'), r.title);

// 야간선물 없음 / 미국 휴장 표기
r = t.renderBriefing_(payload(brief({ snapshot: snap({ night: { included: false, reason: 'missing' } }) })));
assert(r.body.includes('시세 없음') && r.body.includes('대체하지 않음') && !r.body.includes('KIS 야간선물'), '야간선물이 없으면 시세 없음');
r = t.renderBriefing_(payload(brief({ snapshot: snap({ usSessionDate: '20260904', usHoliday: [{ date: '2026-09-07', name: '노동절' }] }) })));
assert(r.body.includes('미국 휴장(9/7 노동절) 직전 거래일 종가 기준'), '미국 휴장 구분');
r = t.renderBriefing_(payload(brief({ snapshot: snap({ usHolidayAssumed: '20261022' }) })));
assert(r.body.includes('미국 휴장 추정, 10/22 종가 기준'));
// 흐름이 약하면 단정하지 않는다
r = t.renderBriefing_(payload(brief({ snapshot: snap({ signal: { zsum: 0, model: 7, tone: 'flat', bucket: Object.assign({}, bucket, { key: 'flat', label: '방향 모름' }) } }) })));
assert(r.body.includes('방향은 알 수 없습니다') && r.body.includes('방향을 단정할 수 없습니다'));

// ---------- 국내 정규장 단계 ----------
const P = (ms, session) => t.marketPhase_(ms, session);
assert.equal(P(kst(2026, 10, 26, 8, 59)).phase, 'pre');
assert.equal(P(kst(2026, 10, 26, 9, 0)).phase, 'open');
assert.equal(P(kst(2026, 10, 26, 15, 29)).phase, 'open');
assert.equal(P(kst(2026, 10, 26, 15, 30)).phase, 'post');
assert.equal(P(kst(2026, 10, 26, 16, 29)).phase, 'post');
assert.equal(P(kst(2026, 10, 26, 16, 30)).phase, 'closed');
assert.equal(P(kst(2026, 10, 24, 11, 0)).phase, 'holiday', '토요일');
// 서버 시간표가 오늘 날짜와 맞으면 그것을 쓴다(수능일처럼 늦게 열고 늦게 닫는 날, 휴장일)
const csat = { today: '2026-11-19', tradingDay: true, openAt: '10:00', closeAt: '16:30', postCloseMinutes: 60 };
assert.equal(P(kst(2026, 11, 19, 9, 30), csat).phase, 'pre');
assert.equal(P(kst(2026, 11, 19, 16, 0), csat).phase, 'open');
assert.equal(P(kst(2026, 11, 19, 16, 30), csat).phase, 'post');
assert.equal(P(kst(2026, 10, 9, 11, 0), { today: '2026-10-09', tradingDay: false, openAt: '09:00', closeAt: '15:30' }).phase, 'holiday');
assert.equal(P(kst(2026, 11, 19, 16, 0), { today: '2026-11-18', tradingDay: true, openAt: '10:00', closeAt: '16:30' }).phase, 'post', '다른 날 시간표는 쓰지 않음(기본 09:00~15:30)');

// ---------- 레인: 단계별 주기, 중복·불필요 요청 없음 ----------
const mkPage = (o = {}) => Object.assign({ data: { updatedAt: '2026-10-26 09:00:10' }, indicators: {}, briefing: payload(brief()), lanes: {} }, o);
function simulate(page, startMs, endMs) {
  let now = startMs; const calls = { brief: 0, live: 0, snap: 0, sector: 0, macro: 0, check: 0, ai: 0 }; let guard = 0;
  while (now <= endMs && guard++ < 5000) {
    t.dueLanes_(page, now).forEach((lane) => { page.lanes[lane] = now; calls[lane]++; });
    const next = t.nextRunAt_(page, now);
    if (!isFinite(next)) break;
    now = Math.max(now + 1000, next);
  }
  return { calls, stopped: guard < 5000 && now <= endMs ? now : null, now };
}
{ // 정규장 09:00~10:00 한 시간: 브리핑 고정(확정이라 요청 없음), 국내 지표 1분, 요약·섹터 2분, 체크포인트 5분, 해외 5분
  const page = mkPage({ lanes: { brief: kst(2026, 10, 26, 8, 0), live: kst(2026, 10, 26, 8, 0), snap: kst(2026, 10, 26, 8, 0), sector: kst(2026, 10, 26, 8, 0), macro: kst(2026, 10, 26, 8, 0), check: kst(2026, 10, 26, 8, 0) } });
  const { calls } = simulate(page, kst(2026, 10, 26, 9, 0, 3), kst(2026, 10, 26, 10, 0, 3));
  assert.equal(calls.brief, 0, '확정된 브리핑은 장중에 다시 요청하지 않는다');
  assert(calls.live >= 59 && calls.live <= 62, 'live ' + calls.live);
  assert(calls.snap >= 29 && calls.snap <= 32, 'snap ' + calls.snap);
  assert(calls.sector >= 29 && calls.sector <= 32, 'sector ' + calls.sector);
  assert(calls.check >= 11 && calls.check <= 13, 'check ' + calls.check);
  assert(calls.macro >= 11 && calls.macro <= 13, 'macro ' + calls.macro);
  assert(calls.ai >= 29 && calls.ai <= 32, 'AI 코멘트 읽기(DB 읽기만) 장중 2분: ' + calls.ai);
}
{ // 개장 전(07:10 이후): 처음 한 번 + 브리핑 정정 확인만. 국내 지표 주기 갱신 없음, 09:00:02에 깨어난다
  const page = mkPage();
  let first = simulate(page, kst(2026, 10, 26, 7, 10), kst(2026, 10, 26, 7, 10));
  assert.deepEqual(Object.values(first.calls), [1, 1, 1, 1, 1, 1, 1], '처음에는 모든 레인을 한 번(AI 코멘트 포함)');
  const { calls } = simulate(page, kst(2026, 10, 26, 7, 10, 2), kst(2026, 10, 26, 8, 58));
  assert.equal(calls.live + calls.snap + calls.sector + calls.check, 0, '개장 전 국내 지표 폴링 없음');
  assert(calls.brief >= 20 && calls.brief <= 24, '정정 확인 5분 간격 ' + calls.brief);
  assert.equal(t.nextRunAt_(page, kst(2026, 10, 26, 8, 58)) <= kst(2026, 10, 26, 9, 0, 2), true, '개장 시각에 깨어남');
}
{ // 07:00 전(새벽): 브리핑이 확정되는 07:00:20까지 폴링하지 않는다
  const page = mkPage({ lanes: { brief: kst(2026, 10, 26, 3, 0), live: kst(2026, 10, 26, 3, 0), snap: kst(2026, 10, 26, 3, 0), sector: kst(2026, 10, 26, 3, 0), macro: kst(2026, 10, 26, 3, 0), check: kst(2026, 10, 26, 3, 0) },
    briefing: payload(brief({ targetDate: '2026-10-23', targetLabel: '10/23(금)' }), { today: '2026-10-26', next: { targetDate: '2026-10-26', targetLabel: '10/26(월)', scheduledAt: '2026-10-26 07:00:00' } }) });
  const next = t.nextRunAt_(page, kst(2026, 10, 26, 3, 0, 5));
  assert(next <= kst(2026, 10, 26, 3, 5, 0) + 1000, '해외 지표 5분 레인만 남는다(브리핑은 07:00:20 대기)');
  assert.equal(t.lanePeriod_('brief', page, P(kst(2026, 10, 26, 3, 0), sb.window.sess), kst(2026, 10, 26, 3, 0)), null);
  assert.equal(t.lanePeriod_('brief', page, P(kst(2026, 10, 26, 7, 1)), kst(2026, 10, 26, 7, 1)), 60000, '07:00 지나 아직 어제 확정본을 보고 있으면 오늘 것을 1분마다 확인');
}
{ // 브리핑 미확정이면 07:00 이후 1분마다 확인, 장중에는 5분
  const pending = payload(brief({ status: 'pending', snapshot: null }));
  const page = mkPage({ briefing: pending });
  assert.equal(t.lanePeriod_('brief', page, P(kst(2026, 10, 26, 7, 30)), kst(2026, 10, 26, 7, 30)), 60000);
  assert.equal(t.lanePeriod_('brief', page, P(kst(2026, 10, 26, 10, 0)), kst(2026, 10, 26, 10, 0)), 300000);
  assert.equal(t.lanePeriod_('brief', mkPage({ briefing: null }), P(kst(2026, 10, 26, 10, 0)), kst(2026, 10, 26, 10, 0)), 60000, '첫 응답 실패 시 재시도');
  { // 새벽에 열어 둔 페이지: 어제 확정본을 보고 있다가 07:00:20에 깨어나면 오늘 것을 바로(1분 레인) 받는다
    const old = mkPage({ briefing: payload(brief({ targetDate: '2026-10-23', targetLabel: '10/23(금)' }), { today: '2026-10-26' }), lanes: { brief: kst(2026, 10, 26, 6, 58), live: kst(2026, 10, 26, 6, 58), snap: kst(2026, 10, 26, 6, 58), sector: kst(2026, 10, 26, 6, 58), macro: kst(2026, 10, 26, 6, 58), check: kst(2026, 10, 26, 6, 58) } });
    assert(t.dueLanes_(old, kst(2026, 10, 26, 7, 0, 20)).includes('brief'), '07:00:20에 브리핑 확인');
  }
}
{ // 마감 후 후속: 15:30~16:30 10분 간격, 그 뒤엔 국내 지표 요청 멈춤
  const stamp = kst(2026, 10, 26, 15, 29);
  const page = mkPage({ lanes: { brief: stamp, live: stamp, snap: stamp, sector: stamp, macro: stamp, check: stamp } });
  const { calls } = simulate(page, kst(2026, 10, 26, 15, 30, 3), kst(2026, 10, 26, 16, 29));
  assert(calls.live >= 5 && calls.live <= 7 && calls.snap === calls.live, '마감 후 후속 10분 간격 ' + calls.live);
  const after = simulate(page, kst(2026, 10, 26, 16, 31), kst(2026, 10, 26, 22, 0));
  assert.equal(after.calls.live + after.calls.snap + after.calls.sector + after.calls.check, 0, '16:30 이후 국내 장중 요청 중지');
  assert(after.calls.macro >= 20 && after.calls.macro <= 24, '해외·가상자산은 별도 주기(15분) ' + after.calls.macro);
}
{ // 휴장일(일요일): 처음 한 번 뒤 국내 요청 없음. 다음 07:00에 브리핑만 확인
  const sun = kst(2026, 10, 25, 11, 0);
  const page = mkPage({ briefing: payload(brief({ targetDate: '2026-10-23', targetLabel: '10/23(금)' }), { today: '2026-10-25', session: { today: '2026-10-25', tradingDay: false, openAt: '09:00', closeAt: '15:30', postCloseMinutes: 60 }, next: { targetDate: '2026-10-26', targetLabel: '10/26(월)', scheduledAt: '2026-10-26 07:00:00' } }) });
  simulate(page, sun, sun);
  const { calls } = simulate(page, sun + 1000, kst(2026, 10, 26, 6, 59));
  assert.equal(calls.live + calls.snap + calls.sector + calls.check + calls.brief, 0, '휴장일에는 불필요한 요청 중지');
  assert(calls.macro >= 128 && calls.macro <= 142, '남는 것은 해외·가상자산 레인뿐(일요일 15분, 월요일 새벽은 거래일 5분) ' + calls.macro);
}
{ // 첫 시장 자료를 못 받았으면 단계와 무관하게 다시 시도한다
  const page = mkPage({ data: null, lanes: { snap: kst(2026, 10, 25, 11, 0) } });
  assert.equal(t.lanePeriod_('snap', page, P(kst(2026, 10, 25, 11, 0)), kst(2026, 10, 25, 11, 0)), 60000);
}

// 공용 fetch 재사용 시간은 레인 주기(레인은 0.5초 일찍 깨어날 수 있다)보다 짧아야 한다 - 아니면 갱신이 한 번씩 건너뛰어진다
{
  const periods = { live: Math.min(...Object.values(t.LANE_PERIODS_.live)), snap: Math.min(...Object.values(t.LANE_PERIODS_.snap)), check: Math.min(...Object.values(t.LANE_PERIODS_.check)), macro: 300000, ai: 120000 };
  Object.keys(t.LANE_TTL_).forEach((lane) => assert(t.LANE_TTL_[lane] < periods[lane] - 500, lane + ' TTL < 주기'));
  assert(t.LANE_PERIODS_.sector.open === t.LANE_PERIODS_.snap.open && t.LANE_TTL_.snap < t.LANE_PERIODS_.sector.open - 500, '섹터는 snap TTL을 쓴다');
}

// ---------- 상태 문구: 실제 단계와 갱신 시각 ----------
const stText = (ms, over = {}) => t.liveStatusText_(mkPage(over), ms, {});
assert.equal(stText(kst(2026, 10, 26, 10, 24, 30)), '장중 자동 갱신 · 09:00 기준'.replace('09:00', '09:00'), '자료 시각 기준');
assert.equal(stText(kst(2026, 10, 26, 10, 24), { data: { updatedAt: '2026-10-26 10:24:03' } }), '장중 자동 갱신 · 10:24 기준');
assert.equal(stText(kst(2026, 10, 26, 8, 0)), '장 시작 전 · 국내 지표는 전 거래일 값 · 09:00 개장 후 자동 갱신');
assert(stText(kst(2026, 10, 26, 15, 40), { data: { updatedAt: '2026-10-26 15:40:11' } }).startsWith('장 마감 · 15:40 기준 · 늦게 확정되는 수급은 16:30까지 확인'));
assert.equal(stText(kst(2026, 10, 26, 18, 0), { data: { updatedAt: '2026-10-26 15:41:11' } }), '장 마감 · 15:41 기준 · 마지막 확정 자료 · 자동 갱신 없음');
assert(stText(kst(2026, 10, 25, 12, 0), { data: { updatedAt: '2026-10-23 15:41:11' } }).startsWith('휴장일 · 마지막 거래일 자료 · 10.23 15:41 기준 · 자동 갱신 없음'));
assert(t.liveStatusText_(mkPage(), kst(2026, 10, 26, 10, 0), { partial: true, delay: 120000 }).includes('마지막 정상 수신값 유지 · 다음 확인 2분 후'));
assert(t.liveStatusText_(mkPage(), kst(2026, 10, 26, 10, 0), { paused: true }).startsWith('자동 갱신 대기'));

// ---------- 체크포인트: 07:00 브리핑 vs 장중 변화 ----------
const flow = (frgns, date = '2026-10-26') => ({ state: 'ok', date, rows: frgns.map((v, i) => ({ slot: i, frgn: v, asOf: '2026-10-26T' + String(9 + Math.floor(i / 2)).padStart(2, '0') + ':' + (i % 2 ? '29' : '59') + ':30+09:00' })) });
const dom = (rate, at = '2026-10-26T02:20:00Z') => ({ indices: { KOSPI: { quote: { change_rate: rate, updated_at: at } } } });
const ph = P(kst(2026, 10, 26, 11, 20));
let ctx = t.buildCheckContext_(payload(brief()), dom(-1.2), flow([-300, -250, 150]), ph, kst(2026, 10, 26, 11, 20), kst(2026, 10, 26, 11, 20));
assert.equal(ctx.time, '11:20');
assert.deepEqual(JSON.parse(JSON.stringify(ctx.brief)), { label: '07:00 브리핑', text: '하락 우세 · 시초 하락 출발 86%', tone: 'down' });
assert(ctx.changes.some((c) => c.text.startsWith('외국인 코스피 누적 순매수 전환') && c.text.includes('+150억원')), '외국인 순매수 전환');
assert(ctx.changes.some((c) => c.text.includes('코스피 -1.20%') && c.text.includes('같은 흐름')), '코스피 방향이 브리핑과 같음');
let html = t.checkpointContextHtml_(ctx);
assert(html.includes('07:00 브리핑') && html.includes('하락 우세') && html.includes('장중 변화'), html);
// 반대로 움직이면 그렇게 쓴다
ctx = t.buildCheckContext_(payload(brief()), dom(0.9), flow([200, 300, 400]), ph, kst(2026, 10, 26, 11, 20), kst(2026, 10, 26, 11, 20));
assert(ctx.changes.length === 1 && ctx.changes[0].text.includes('반대로 움직이는 중'), JSON.stringify(ctx.changes));
// 변화가 확인되지 않으면 '없음'만(지어내지 않는다) / 자료가 없으면 아무것도 쓰지 않는다
ctx = t.buildCheckContext_(payload(brief()), dom(-0.2), flow([-100, -120, -90]), ph, kst(2026, 10, 26, 11, 20), kst(2026, 10, 26, 11, 20));
assert.equal(ctx.changes.length, 0); assert(t.checkpointContextHtml_(ctx).includes('뚜렷한 변화 없음'));
ctx = t.buildCheckContext_(payload(brief()), null, null, ph, kst(2026, 10, 26, 11, 20), null);
assert.equal(ctx.changes.length, 0); assert(!t.checkpointContextHtml_(ctx).includes('장중 변화'), '자료가 없으면 변화 문장을 쓰지 않는다');
// 어제 데이터·휴장 중에는 변화로 표시하지 않는다 / 브리핑이 오늘 것이 아니면 브리핑 줄도 없다
ctx = t.buildCheckContext_(payload(brief()), dom(-1.2, '2026-10-23T06:20:00Z'), flow([-300, 150], '2026-10-23'), ph, kst(2026, 10, 26, 11, 20), null);
assert.equal(ctx.changes.length, 0);
ctx = t.buildCheckContext_(payload(brief({ targetDate: '2026-10-23' })), dom(-1.2), flow([-300, 150]), ph, kst(2026, 10, 26, 11, 20), null);
assert.equal(ctx.brief, null); assert.equal(t.checkpointContextHtml_(ctx), '');
ctx = t.buildCheckContext_(payload(brief()), dom(-1.2), flow([-300, 150]), P(kst(2026, 10, 26, 8, 0)), kst(2026, 10, 26, 8, 0), null);
assert(ctx.brief && ctx.changes.length === 0 && ctx.time === '', '개장 전에는 브리핑만, 갱신 시각 없음');

// ---------- 섹터: 기준 시각과 직전 갱신 대비 순위 변화 ----------
assert.equal(t.sectorAsOf_({ updatedAt: '2026-10-26 10:21:07' }, '2026-10-26'), '10:21 기준');
assert.equal(t.sectorAsOf_({ updatedAt: '2026-10-23 15:31:00' }, '2026-10-26'), '10.23 15:31 기준');
assert.equal(t.sectorAsOf_({}, '2026-10-26'), '');
assert(t.rankChangeHtml_({ rank_change: 2, prev_rank: 4, rank_basis: 'x' }).includes('▲2'));
assert(t.rankChangeHtml_({ rank_change: -1, prev_rank: 1, rank_basis: 'x' }).includes('▼1'));
assert(t.rankChangeHtml_({ rank_change: 0, prev_rank: 3, rank_basis: 'x' }).includes('–'));
assert(t.rankChangeHtml_({ rank_change: null, prev_rank: null, rank_basis: '2026-10-26 10:18:00' }).includes('NEW'));
assert.equal(t.rankChangeHtml_({ rank_change: null, prev_rank: null, rank_basis: null }), '', '비교 기준이 없으면 표시하지 않는다');

// ---------- 브리핑 요청은 한 번만(공용 fetch), 확정 뒤에는 느리게 ----------
(async () => {
  let net = 0; const calls = [];
  sb.fetch = async (url) => { net++; calls.push(url); return { ok: true, json: async () => ({ data: payload(brief()) }) }; };
  const container = { __mtLivePage: { briefing: null }, querySelector: () => null };
  await Promise.all([t.loadBriefing_(container), t.loadBriefing_(container)]);
  assert.equal(net, 1, '같은 순간의 중복 요청은 하나로');
  assert(calls[0].endsWith('/morning-briefing'));
  // 정적 확인: 신호를 브라우저가 계산하지 않고, 증권사 API를 직접 부르지 않는다
  assert(!/tomorrowSignal_|nightSignal_|TOMORROW_BUCKETS|nightQuote_/.test(source), '신호 계산은 서버로 옮겼다');
  assert(!/openapi\.kiwoom|koreainvestment\.com|polling\.finance\.naver/.test(source), '증권사·네이버를 브라우저가 직접 호출하지 않는다');
  assert(source.includes('stored_only=true'));
  console.log('briefing render, phases, lanes, status text, checkpoint context, sector rank, single-flight ok');
})().catch((e) => { console.error(e); process.exit(1); });
