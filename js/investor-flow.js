/* �����ں� ���ż� ���� + ������Ź�ݡ��ſ��ܰ� �帧 (������ǥ > ���� ������ǥ 02��03, 2026-10-12)
 *
 * InvestorFlow.mount(host)        - 02 �����ں� �Ÿŵ���: �Ⱓ ���� ���ż� ��(���� ���� ���� ����, ��¥�� ������ ���ϡ��Ⱓ ����), �ϴ� ���ǥ,
 *                                   �����ں� ��Ģ ��� ���
 *                                   (2026-10-16: �Ϻ����ְ������� ���ż� ���� �׷����� �����ߴ�. �Ϻ� ��ġ�� ���� �� ������ ���ǥ���� ����.)
 * InvestorFlow.mountBalance(host) - 03 �����ڱ�: ������Ź�ݡ��ſ��ܰ� ���̡�5/20�ŷ��� ��ȭ��20�� ��� ��񡤱�Ģ ��� �ؼ�
 * (ó���� '04 ���� ���� �ڱ� �帧'�̶�� ���� �����̾�����, 02�� ���� ���ż� �����͸� �ٷ� 02�� ���ƴ�.)
 *
 * ������
 *  - �����ں�: VM `GET /investor-trend/history?market=kospi|kosdaq&days=300` (KIS ���庰 �����ڸŸŵ���(�Ϻ�) FHPTJ04040000�� SQLite�� ���� ��,
 *    ���� ���, �ŷ��ϸ�, ��¥ ��������). �ܱ����� ��� �ܱ��� ���ż� �����̴�. �� ���ڷῡ�� **���ż���** �־� �Ѹż����Ѹŵ��� �������� �ʴ´�
 *    (���ż����� �Ųٷ� ������� �ʴ´�).
 *  - ������Ź�ݡ��ſ��ܰ�: �θ� ���(js/domestic-market-indicators.js)�� �̹� ���� `funds.series`�� �״�� �Ѱ� �޴´�(�߰� ��û ����).
 * ǥ�� ��Ģ: �����ں� ���ż��� ���� �ȿ��� ��ü�� �Ÿ� ������ ���� �ִ� �ڷ��̸� ���� ��ü�� �ű� �ڱ� ���Ծ��� �ƴϴ�. ����� ������ ��� ��Ģ��
 * ������ �� �ż����ŵ� ��õ�̳� ������������ �ƴϴ�.
 */
(function (global) {
  'use strict';

  var API = global.INVESTOR_FLOW_API_BASE || 'https://goodbyestar.cloud';
  var HISTORY_DAYS = 300;
  var TTL_MS = 5 * 60 * 1000;
  var PERIODS = [{ key: 'w', label: '1��', n: 5 }, { key: 'm', label: '1����', n: 20 }, { key: 'q', label: '3����', n: 60 }, { key: 'y', label: '1��', n: 250 }];
  var INVESTORS = [
    { key: 'foreign', label: '�ܱ���', color: 'var(--mi-inv-foreign, #D94F45)' },
    { key: 'institution', label: '���', color: 'var(--mi-inv-inst, #3273C8)' },
    { key: 'individual', label: '����', color: 'var(--mi-inv-indiv, #168B70)' }
  ];
  var MARKETS = [{ key: 'kospi', label: 'KOSPI' }, { key: 'kosdaq', label: 'KOSDAQ' }];
  var TREND_PCT = 1.0;      // 20�ŷ��� ��ȭ���� �� ��(%) �̻��̸� ���� �߼�, ����(����)�� ���� �߼�, �����̸� ���ձ�
  var STREAK_MIN = 5;       // ���忡�� '����'�� ����ϴ� �ּ� �ŷ��� ��

  function esc(value) { return global.NineUI.escapeHtml(value); }

  /* �������������������������� ���(���� �Լ�, �׽�Ʈ ���) �������������������������� */
  function fmtEok(v, signed) { return global.IndicatorBoard ? global.IndicatorBoard.util.fmtEok(v, signed) : String(v); }

  function lastRows(rows, n) { return rows.slice(Math.max(0, rows.length - n)); }

  function sumOf(rows, key) {
    var total = 0;
    rows.forEach(function (r) { total += Number(r[key]) || 0; });
    return total;
  }

  /* �Ⱓ ����: �Ⱓ ���� �ŷ����� ������(0)���� �ΰ� �׳����� ���ż��� ���� ����. ���� �ŷ��� �ڷᰡ ������ '�Ⱓ ����'(0)�� �տ� �д�.
     ���� ������ ���� ����(���� ���)�� �Բ� �����. */
  function cumulative(rows, n) {
    var take = lastRows(rows, n);
    var before = rows.length > take.length ? rows[rows.length - take.length - 1] : null;
    var dates = [before ? before.date : '�Ⱓ ����'];
    var index = [before && before.indexClose != null ? before.indexClose : null];
    var out = {}, daily = {};
    INVESTORS.forEach(function (inv) { out[inv.key] = [0]; daily[inv.key] = [null]; });   // ������(0)���� '����' ���� ����
    take.forEach(function (r) {
      dates.push(r.date);
      index.push(r.indexClose != null ? r.indexClose : null);
      INVESTORS.forEach(function (inv) {
        var arr = out[inv.key], v = Number(r[inv.key]) || 0;
        arr.push(arr[arr.length - 1] + v);
        daily[inv.key].push(v);
      });
    });
    return { dates: dates, series: out, daily: daily, index: index, days: take.length, hasBaselineDate: !!before };
  }

  /* ���������� ���� ��ȣ�� �̾��� �ŷ��� ��. sign: 1 ���ż�, -1 ���ŵ�, 0 �� ���� */
  function streak(rows, key) {
    var sign = 0, days = 0;
    for (var i = rows.length - 1; i >= 0; i--) {
      var v = Number(rows[i][key]) || 0;
      var s = v > 0 ? 1 : v < 0 ? -1 : 0;
      if (i === rows.length - 1) { if (!s) break; sign = s; days = 1; continue; }
      if (s === sign) days++; else break;
    }
    return { sign: sign, days: days };
  }

  function pctChange(now, before) { return before ? (now - before) / Math.abs(before) * 100 : null; }

  /* �ܰ��� �ð迭([[��¥, ��], ...] ��������)�� �ֱ� 5��20�ŷ��� ��ȭ�� 20�ŷ��� ��� ��� */
  function balanceStats(points) {
    var n = points.length, out = { count: n, last: n ? points[n - 1][1] : null, lastDate: n ? points[n - 1][0] : null };
    function back(k) { return n > k ? points[n - 1 - k][1] : null; }
    var v5 = back(5), v20 = back(20);
    out.change5 = v5 != null ? out.last - v5 : null;
    out.pct5 = v5 != null ? pctChange(out.last, v5) : null;
    out.change20 = v20 != null ? out.last - v20 : null;
    out.pct20 = v20 != null ? pctChange(out.last, v20) : null;
    if (n >= 20) {
      var sum = 0; for (var i = n - 20; i < n; i++) sum += points[i][1];
      out.avg20 = sum / 20;
      out.vsAvg20Pct = pctChange(out.last, out.avg20);
    } else { out.avg20 = null; out.vsAvg20Pct = null; }
    out.trend = out.pct20 == null ? null : out.pct20 >= TREND_PCT ? 'up' : out.pct20 <= -TREND_PCT ? 'down' : 'flat';
    return out;
  }

  var TREND_TEXT = { up: '���� �߼�', down: '���� �߼�', flat: '���ձ�' };

  function balanceSeries(funds, field) {
    var out = [];
    ((funds && funds.series) || []).forEach(function (row) {
      var raw = field === 'credit' ? row.credit : row.market_funds;
      var picked = field === 'credit'
        ? (raw != null && typeof raw === 'object' ? raw.loan_total : raw)
        : (raw && raw.investor_deposits);
      var date = String(row.date || '').slice(0, 10);
      // null���� ���� 0���� �ƴ϶� '�� ����'�̹Ƿ� �ǳʶڴ�(Number(null) === 0 �̶� isFinite �����δ� �ɷ����� �ʴ´�).
      if (!date || picked == null || picked === '') return;
      var value = Number(picked);
      if (isFinite(value)) out.push([date, value]);
    });
    out.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    return out;
  }

  function round1(x) { return Math.round(x * 10) / 10; }
  function mmdd(iso) { return String(iso).slice(5).replace('-', '.'); }

  /* ���: ������ ��Ģ���θ� �����(��õ������������ ����). ������ ���(02)�� �ܰ� ���(03)�� ���� �����, summarize �� ���� �̾� ���� ���۴�. */
  function summarizeInvestors(rows, marketLabel) {
    var lines = [], sentences = [];
    var n20 = lastRows(rows, 20);
    if (n20.length >= 20) {
      var buyers = [], sellers = [];
      INVESTORS.forEach(function (inv) {
        var sum = sumOf(n20, inv.key);
        lines.push({ label: inv.label, text: '�ֱ� 20�ŷ��� ' + (sum >= 0 ? '���ż� ' : '���ŵ� ') + fmtEok(Math.abs(sum)), tone: sum > 0 ? 'up' : sum < 0 ? 'down' : '', sum: sum });
        (sum >= 0 ? buyers : sellers).push(inv.label);
      });
      var parts = [];
      if (buyers.length) parts.push(buyers.join('��') + ' ���ż�');
      if (sellers.length) parts.push(sellers.join('��') + ' ���ŵ�');
      var s1 = marketLabel + ' �ֱ� 20�ŷ��� �հ�� ' + parts.join(', ') + '�Դϴ�.';
      var best = null;
      INVESTORS.forEach(function (inv) { var st = streak(rows, inv.key); if (st.days >= STREAK_MIN && (!best || st.days > best.days)) best = { label: inv.label, days: st.days, sign: st.sign }; });
      if (best) s1 += ' ' + best.label + ' ' + best.days + '�ŷ��� ���� ' + (best.sign > 0 ? '���ż�' : '���ŵ�') + ' ���Դϴ�.';
      sentences.push(s1);
    } else {
      lines.push({ label: '�����ں�', text: n20.length ? 'Ȯ���� �ŷ��� ' + n20.length + '��(20�� �̸�)�̶� ������� �ʽ��ϴ�.' : '�����ں� �ڷᰡ ���� ������� �ʽ��ϴ�.', tone: '' });
    }
    return { lines: lines, sentences: sentences };
  }

  function summarizeBalances(deposits, credit) {
    var lines = [], sentences = [];
    function balanceLine(label, st) {
      if (!st || st.pct20 == null) { lines.push({ label: label, text: '�ڷ� ����(21�ŷ��� �̸�)', tone: '' }); return; }
      lines.push({ label: label, text: TREND_TEXT[st.trend] + ' (20�ŷ��� ' + (st.pct20 > 0 ? '+' : '') + st.pct20.toFixed(1) + '%)', tone: st.trend === 'up' ? 'up' : st.trend === 'down' ? 'down' : '' });
    }
    balanceLine('������Ź��', deposits);
    balanceLine('�ſ��ܰ�', credit);
    if (deposits && credit && deposits.trend && credit.trend) {
      var d = deposits.trend, c = credit.trend, s2;
      if (d === 'up' && c === 'up') s2 = '������Ź���� �þ� ����ڱ��� Ŀ���� �ְ�, �ſ��ܰ��� �Բ� �ð� �־� �������� Ȯ�� ���θ� ���캼 �ʿ䰡 �ֽ��ϴ�.';
      else if (d === 'up' && c === 'flat') s2 = '������Ź���� �ð� �ְ� �ſ��ܰ��� ���ձ��̶� ����ڱ��� Ŀ������ ���� ���� Ȯ��� �ѷ����� �ʽ��ϴ�.';
      else if (d === 'up' && c === 'down') s2 = '������Ź���� �ð� �ſ��ܰ��� �پ� ����ڱ��� Ŀ���� ���� ���� ���ڴ� �ٰ� �ֽ��ϴ�.';
      else if (d === 'flat' && c === 'up') s2 = '������Ź���� ���ձ��ε� �ſ��ܰ��� �þ� ���� ���� ������ Ŀ������ ���캼 �ʿ䰡 �ֽ��ϴ�.';
      else if (d === 'flat' && c === 'flat') s2 = '������Ź�ݰ� �ſ��ܰ� ��� ���ձ��Դϴ�.';
      else if (d === 'flat' && c === 'down') s2 = '������Ź���� ���ձ��̰� �ſ��ܰ��� �پ� ���� ���ڰ� �ٰ� �ֽ��ϴ�.';
      else if (d === 'down' && c === 'up') s2 = '������Ź���� �پ��µ� �ſ��ܰ��� �þ�, ����ڱ��� �ٰ� ���� ���� ������ Ŀ���� ����Դϴ�.';
      else if (d === 'down' && c === 'flat') s2 = '������Ź���� �پ��� �ſ��ܰ��� ���ձ��̶� ����ڱ��� �پ��� �帧�Դϴ�.';
      else s2 = '������Ź�ݰ� �ſ��ܰ��� ��� �پ� ����ڱݰ� ���� ���ڰ� �Բ� �پ��� �帧�Դϴ�.';
      sentences.push(s2);
    }
    return { lines: lines, sentences: sentences };
  }

  function summarize(rows, deposits, credit, marketLabel) {
    var a = summarizeInvestors(rows, marketLabel), b = summarizeBalances(deposits, credit);
    return { lines: a.lines.concat(b.lines), sentences: a.sentences.concat(b.sentences) };
  }

  /* �������������������������� ȭ�� �������������������������� */
  var NOTE_NET = '�����ں� ���ż��� ���� �ȿ��� ���� ��ü�� �Ÿ� ������ ���� �ִ� �ڷ��Դϴ�. �� ��ü�� ���ż��� ��ŭ �ٸ� ��ü�� ���ŵ�(����)�ϹǷ�, ���ż� �ݾ��� ���� ��ü�� �ű� �ڱ� ���Ծ����� ������ �� �˴ϴ�. ���Ρ��ܱ��Ρ���� �� ��ü�� ���� 0�� �ƴ� ���� ��Ÿ���� �� ������ ��ü�� �ֱ� �����Դϴ�.';

  function kstStamp(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '-';
    return new Date(t + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' KST';
  }

  function periodOf(key) { return PERIODS.filter(function (x) { return x.key === key; })[0]; }
  function marketOf(key) { return MARKETS.filter(function (m) { return m.key === key; })[0]; }


  /* ���� ���ż� �� �׷��� ����(IndicatorBoard.createChart �Է�). ������ �����ڸ��� [���� ���ż� | �Ⱓ ����]�� ������ ���̰�,
     ������(���� 0)���� ���� ���� ���� '-'�� �θ� ���� '���� ������'�̶�� ������. ���� ���� ���⸦ �Ѹ� ������ ������ �� ������ ���� �� �ٷ� ���´�. */
  function lineSpec(cum, label, showIndex) {
    var IB = global.IndicatorBoard;
    var hasIndex = showIndex && cum.index.some(function (v) { return v != null; });
    return {
      type: 'lines', dates: cum.dates,
      tipHeads: ['���� ���ż�', '�Ⱓ ����'],
      meta: cum.dates.map(function (d, i) { return i === 0 ? { tip: (cum.hasBaselineDate ? mmdd(d) + ' �� ' : '') + '���� ������(0)' } : null; }),
      series: INVESTORS.map(function (inv) { return { key: inv.key, label: inv.label, color: inv.color, fillColor: inv.key === 'foreign' ? 'var(--chart-fill-up)' : inv.key === 'institution' ? 'var(--chart-fill-down)' : inv.color, values: cum.series[inv.key], tipExtra: { label: '���� ���ż�', values: cum.daily[inv.key] } }; }),
      fmt: fmtEok, axisFmt: IB.util.fmtEokAxis, zero: true, ariaLabel: label + ' �����ں� ���� ���ż�',
      axisTitles: hasIndex ? { left: '���� ���ż�(��)', right: label + ' ����(����Ʈ)' } : { left: '���� ���ż�(��)' },
      secondary: hasIndex ? { label: label + ' ����', values: cum.index, fmt: function (v) { return IB.util.num(v, 2); }, axisFmt: function (v) { return IB.util.num(v, 0); } } : null
    };
  }

  /* 02 �����ں� �Ÿŵ��� - �����ں� ���ż� ����(�Ϻ� ���� �� ���� �� �� ���� �ż����ŵ� �� ���). ���� ��ȯ���Ⱓ�� �� ���� ��� �׷�����ǥ�� ���� ������. */
  function mount(host, options) {
    var opts = options || {};
    var IB = global.IndicatorBoard;
    var state = { market: 'kospi', period: 'm', showIndex: true, data: {}, error: null, loading: false };
    var charts = {};
    var timer = null;
    var api = opts.apiBase || API;

    function seg(name, items, current, attr) {
      return '<div class="ifl-seg" role="group" aria-label="' + name + '">' + items.map(function (it) {
        return '<button type="button" class="ui-btn ui-btn-tab ifl-seg-btn' + (it.key === current ? ' is-active active' : '') + '" ' + attr + '="' + it.key + '" aria-pressed="' + (it.key === current) + '">' + esc(it.label) + '</button>';
      }).join('') + '</div>';
    }

    host.innerHTML = '<div class="ibd ifl">'
      + '<div class="mi-sub-title">�����ں� ���ż� ����</div>'
      + '<div class="mi-sub-cap">�ܱ��Ρ������������ ���ż��� �Ⱓ ���� ������ ���ϴ�. ����� �Ⱓ�� ������ �Ʒ� �׷����� ǥ�� ��� ���� �ٲ�ϴ�. �׷����� ���콺�� �ø��� �׳��� ���� ���ż��� �Ⱓ ���� ���ż��� �Բ� ���ɴϴ�.</div>'
      + '<div class="ifl-controls">' + seg('����', MARKETS, 'kospi', 'data-if-market') + seg('�Ⱓ', PERIODS, 'm', 'data-if-period')
      + '<span class="ifl-asof nt-stamp" data-if-asof></span></div>'
      + '<div class="ifl-state" data-if-state role="status" hidden></div>'
      + '<section class="ifl-sec"><div class="ifl-sechead"><div class="mi-sub2-title">���� ���ż� ����</div>'
      + '<label class="ifl-check"><input type="checkbox" data-if-index checked /> ���� ���� ����(������ ��)</label></div>'
      + '<div class="ifl-cap" data-if-linecap></div><div data-if-lines></div>'
      + '<table class="ifl-table" data-if-cumtable><caption class="ibd-sr">�����ں� �Ⱓ ���� ���ż�</caption><thead><tr><th>������</th><th class="num">�Ⱓ ���� ���ż�</th><th class="num">�ֱ� 1��</th><th class="num">���� �ϼ�</th></tr></thead><tbody></tbody></table>'
      + '<div class="ifl-note">' + esc(NOTE_NET) + '</div><div class="ifl-note" data-if-basis></div></section>'
      + '<section class="ifl-sec ifl-summary"><div class="mi-sub2-title">�����ں� ���ż� ���</div><div data-if-summary></div></section>'
      + '</div>';
    var root = host.querySelector('.ifl');
    function q(sel) { return root.querySelector(sel); }
    charts.lines = IB.createChart(q('[data-if-lines]'), { height: 240, emptyText: '������ �Ⱓ�� �ڷᰡ �����ϴ�.' });

    function rowsOf() { var d = state.data[state.market]; return d && d.rows ? d.rows : []; }

    function setButtons() {
      var rows = rowsOf();
      Array.prototype.forEach.call(root.querySelectorAll('[data-if-market]'), function (b) {
        var on = b.getAttribute('data-if-market') === state.market;
        b.classList.toggle('is-active', on); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-if-period]'), function (b) {
        var p = periodOf(b.getAttribute('data-if-period'));
        var on = p.key === state.period, short = rows.length && rows.length < p.n;
        b.classList.toggle('is-active', on); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
        b.disabled = !!short;
        b.title = short ? 'Ȯ���� �ڷᰡ ' + rows.length + '�ŷ����̶� ������ �� �����ϴ�' : (p.n + '�ŷ��� ����');
      });
    }

    function renderAsOf() {
      var d = state.data[state.market], el = q('[data-if-asof]');
      if (!d) { el.textContent = ''; return; }
      el.textContent = ((window.NineTime && window.NineTime.asOf(d.latestDate)) || ('������ ' + (d.latestDate || '-'))) + ' �� ' + ((window.NineTime && window.NineTime.updated(d.asOf)) || ('���� ' + kstStamp(d.asOf))) + ' �� �ڷ� ' + d.count + '�ŷ���(' + (d.from || '-') + ' ~ ' + (d.to || '-') + ')';
    }

    function renderState() {
      var el = q('[data-if-state]'), d = state.data[state.market], msgs = [];
      if (state.error && !d) msgs.push('�����ں� ���ż� �ڷḦ �ҷ����� ���߽��ϴ�. ��� �� �ٽ� �õ��մϴ�.');
      if (state.loading && !d) msgs.push('�ҷ����� ���Դϴ�.');
      if (d && d.provisional) msgs.push('���� ���� ���� ���� �Ǵ� ���� ���� ����ġ�̸� ���� �� �Ϻ� ������ �� �ֽ��ϴ�.');
      if (d && d.count < 20) msgs.push('Ȯ���� �ڷᰡ ' + d.count + '�ŷ��ϻ��̶� �Ϻ� �Ⱓ�� ������ �� �����ϴ�.');
      el.hidden = !msgs.length; el.textContent = msgs.join(' ');
    }

    function renderLines() {
      var rows = rowsOf(), p = periodOf(state.period);
      var cum = cumulative(rows, p.n);
      var label = marketOf(state.market).label;
      q('[data-if-linecap]').textContent = '������ �Ⱓ�� ������ 0���� �ΰ� �ŷ��ϸ��� ���ż��� ���� ���Դϴ�. �Ⱓ�� �ٲٸ� �� �Ⱓ �������� �ٽ� �����մϴ�. ���콺�� �ø��� �׳��� ���� ���ż��� �Ⱓ ���� ���ż��� �Բ� ���ϴ�.' + (state.showIndex ? ' ��ȸ�� ������ ' + label + ' �����Դϴ�(������ ��).' : '');
      if (!cum.days) { charts.lines.update({ type: 'lines', dates: [], series: [], emptyText: '������ �Ⱓ�� �ڷᰡ �����ϴ�.' }); renderCumTable(rows, cum, p); return; }
      charts.lines.update(lineSpec(cum, label, state.showIndex));
      renderCumTable(rows, cum, p);
    }

    function renderCumTable(rows, cum, p) {
      var body = q('[data-if-cumtable] tbody'), take = lastRows(rows, p.n), last = take.length ? take[take.length - 1] : null;
      body.innerHTML = INVESTORS.map(function (inv) {
        var arr = cum.series[inv.key], total = take.length ? arr[arr.length - 1] : null, st = streak(rows, inv.key);
        function cell(v, label) { return '<td class="num ' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '" data-label="' + label + '">' + (v == null ? '-' : esc(fmtEok(v, true))) + '</td>'; }
        return '<tr><th scope="row"><i class="ibd-swatch" style="background:' + inv.color + '"></i> ' + inv.label + '</th>' + cell(total, '�Ⱓ ���� ���ż�') + cell(last ? Number(last[inv.key]) : null, '�ֱ� 1��')
          + '<td class="num" data-label="���� �ϼ�">' + (st.days ? st.days + '�� ���� ' + (st.sign > 0 ? '���ż�' : '���ŵ�') : '-') + '</td></tr>';
      }).join('');
    }

    function renderBasis() {
      var d = state.data[state.market];
      q('[data-if-basis]').textContent = d && d.foreignBasis ? '�ܱ����� ' + d.foreignBasis + ' �����Դϴ�. �� �ڷῡ�� ���ż��� �ְ� �ż����ŵ� �Ѿ��� �����ϴ�.' : '';
    }

    function renderSummary() {
      var label = marketOf(state.market).label, s = summarizeInvestors(rowsOf(), label);
      q('[data-if-summary]').innerHTML = '<ul class="ifl-lines">' + s.lines.map(function (l) {
        return '<li><span class="ifl-lk">' + esc(l.label) + '</span><span class="ifl-lv ' + (l.tone || '') + '">' + esc(l.text) + '</span></li>';
      }).join('') + '</ul>' + (s.sentences.length ? '<div class="ifl-sentence">' + s.sentences.map(esc).join(' ') + '</div>' : '')
        + '<div class="ifl-note">�� ������ ������ ��� ��Ģ(�ֱ� 20�ŷ��� ���ż� �հ��� ��ȣ)���� ���� �ڷ� ����̸� �ż����ŵ� ��õ�� �ƴմϴ�. ����� ������ ����(' + esc(label) + ') �����Դϴ�.</div>';
    }

    function renderAll() {
      setButtons(); renderAsOf(); renderState(); renderLines(); renderBasis(); renderSummary();
    }

    function load(market, force) {
      var hit = state.data[market];
      if (!force && hit && Date.now() - hit._at < TTL_MS) return Promise.resolve();
      state.loading = true; renderState();
      return global.NineHttp.json(api + '/investor-trend/history?market=' + market + '&days=' + HISTORY_DAYS, {timeoutMs:15000})
        .then(function (json) {
          if (!json || json.success !== true || !json.data || !Array.isArray(json.data.rows)) throw new Error('bad payload');
          json.data._at = Date.now();
          state.data[market] = json.data; state.error = null;
        })
        .catch(function (e) { state.error = e; })
        .then(function () { state.loading = false; renderAll(); });
    }

    root.addEventListener('click', function (event) {
      var t = event.target.closest ? event.target : null;
      if (!t) return;
      var mk = t.closest('[data-if-market]');
      if (mk) { state.market = mk.getAttribute('data-if-market'); renderAll(); load(state.market, false); return; }
      var pk = t.closest('[data-if-period]');
      if (pk && !pk.disabled) { state.period = pk.getAttribute('data-if-period'); renderAll(); return; }
    });
    q('[data-if-index]').addEventListener('change', function (e) { state.showIndex = !!e.target.checked; renderLines(); });

    renderAll();
    load('kospi', true).then(function () {
      // �⺻ �Ⱓ(1����)�� Ȯ���� �ڷẸ�� ��� ���� �� ���� ���� �Ⱓ���� �����.
      var rows = rowsOf(), cur = periodOf(state.period);
      if (rows.length && rows.length < cur.n) {
        var ok = PERIODS.filter(function (x) { return rows.length >= x.n; }).pop();
        if (ok) { state.period = ok.key; renderAll(); }
      }
    });
    timer = setInterval(function () { if (!document.hidden && document.body.contains(root) && root.offsetParent !== null) load(state.market, true); }, TTL_MS);

    return {
      update: function () { /* �����ں� �ڷ�� ��ü API �� ���Ƿ� �θ� �ѱ�� funds �� ���� �ʴ´� */ },
      redraw: function () { Object.keys(charts).forEach(function (k) { charts[k].redraw(); }); },
      destroy: function () { clearInterval(timer); Object.keys(charts).forEach(function (k) { charts[k].destroy(); }); }
    };
  }

  /* 03 �����ڱ� - ������Ź�ݡ��ſ��ܰ� �帧(�ֱ� �� �� 5��20�ŷ��� ��ȭ �� 20�� ��� ��� �� ��Ģ ��� �ؼ�). �θ� �ѱ�� funds.series �� ����. */
  var BALANCE_CHART_DAYS = 60;

  function mountBalance(host, options) {
    var opts = options || {};
    var IB = global.IndicatorBoard;
    var state = { funds: opts.funds || null };
    host.innerHTML = '<div class="ibd ifl ifl-bal">'
      + '<div class="mi-sub-title">������Ź�ݡ��ſ��ܰ� �帧</div>'
      + '<div class="mi-sub-cap">�� ���� ������ �޶� ��ġ�� �ʽ��ϴ�. ������Ź�� ������ ����ڱ� Ȯ��, �ſ��ܰ� ������ ���� ���� Ȯ�븦 ���� ���� ��ǥ�Դϴ�. �׷����� �ֱ� ' + BALANCE_CHART_DAYS + '�ŷ����̸� ������ 20�ŷ��� ����Դϴ�.</div>'
      + '<div class="ifl-pair"><div><div class="ifl-minih">������Ź��</div><div data-if-deposit></div></div><div><div class="ifl-minih">�ſ��ܰ�</div><div data-if-credit></div></div></div>'
      + '<table class="ifl-table" data-if-baltable><caption class="ibd-sr">������Ź�ݡ��ſ��ܰ� ��ȭ</caption><thead><tr><th>��ǥ</th><th class="num">�ֱ� ��</th><th class="num">5�ŷ��� ��ȭ</th><th class="num">20�ŷ��� ��ȭ</th><th class="num">20�� ��� ���</th></tr></thead><tbody></tbody></table>'
      + '<div class="ifl-note" data-if-balnote></div>'
      + '<div class="ifl-sec ifl-summary"><div class="mi-sub2-title">�帧 �ؼ� (��� ��Ģ ���)</div><div data-if-balsum></div></div>'
      + '</div>';
    var root = host.querySelector('.ifl');
    function q(sel) { return root.querySelector(sel); }
    var charts = {
      deposit: IB.createChart(q('[data-if-deposit]'), { height: 170, emptyText: '������Ź�� �ڷᰡ �����ϴ�.' }),
      credit: IB.createChart(q('[data-if-credit]'), { height: 170, emptyText: '�ſ��ܰ� �ڷᰡ �����ϴ�.' })
    };

    function render() {
      var depositPts = balanceSeries(state.funds, 'deposits'), creditPts = balanceSeries(state.funds, 'credit');
      var deposits = balanceStats(depositPts), credit = balanceStats(creditPts);
      function chartSpec(points, label) {
        var take = points.slice(Math.max(0, points.length - BALANCE_CHART_DAYS));
        var st = balanceStats(points), ref = st.avg20 != null ? [{ value: st.avg20, label: '20�� ���' }] : [];
        return { type: 'lines', dates: take.map(function (x) { return x[0]; }), series: [{ key: label, label: label, color: 'var(--ibd-num)', values: take.map(function (x) { return x[1]; }) }],
          fmt: fmtEok, axisFmt: IB.util.fmtEokAxis, zero: false, refLines: ref, ariaLabel: label + ' ����', emptyText: label + ' �ڷᰡ �����ϴ�.' };
      }
      charts.deposit.update(chartSpec(depositPts, '������Ź��'));
      charts.credit.update(chartSpec(creditPts, '�ſ��ܰ�'));
      function pctText(v) { return global.NineUI.signedPercent(v); }
      function chg(change, pct) {
        if (change == null) return '<td class="num">-</td>';
        return '<td class="num ' + (change > 0 ? 'up' : change < 0 ? 'down' : '') + '">' + esc(fmtEok(change, true)) + '<small> (' + pctText(pct) + ')</small></td>';
      }
      function rowHtml(label, st) {
        return '<tr><th scope="row">' + label + '</th><td class="num">' + (st.last == null ? '-' : esc(fmtEok(st.last))) + '</td>' + chg(st.change5, st.pct5) + chg(st.change20, st.pct20)
          + '<td class="num ' + (st.vsAvg20Pct > 0 ? 'up' : st.vsAvg20Pct < 0 ? 'down' : '') + '">' + pctText(st.vsAvg20Pct) + '</td></tr>';
      }
      q('[data-if-baltable] tbody').innerHTML = rowHtml('������Ź��', deposits) + rowHtml('�ſ��ܰ�', credit);
      q('[data-if-balnote]').textContent = '��ȭ�� ��' + TREND_PCT + '% �̳��� ���ձ����� ���ϴ�. ������ ' + (deposits.lastDate || '-') + ' �� �ڷ� ' + deposits.count + '�ŷ���(Ȯ���� ��ŭ�� ���).';
      var s = summarizeBalances(deposits, credit);
      q('[data-if-balsum]').innerHTML = '<ul class="ifl-lines">' + s.lines.map(function (l) {
        return '<li><span class="ifl-lk">' + esc(l.label) + '</span><span class="ifl-lv ' + (l.tone || '') + '">' + esc(l.text) + '</span></li>';
      }).join('') + '</ul>' + (s.sentences.length ? '<div class="ifl-sentence">' + s.sentences.map(esc).join(' ') + '</div>' : '')
        + '<div class="ifl-note">�� ������ ������ ��� ��Ģ(������Ź�ݡ��ſ��ܰ� 20�ŷ��� ��ȭ�� ��' + TREND_PCT + '%)���� ���� �ڷ� ����̸� �ż����ŵ� ��õ�� �ƴմϴ�.</div>';
    }
    render();

    return {
      update: function (funds) { state.funds = funds; render(); },
      redraw: function () { Object.keys(charts).forEach(function (k) { charts[k].redraw(); }); },
      destroy: function () { Object.keys(charts).forEach(function (k) { charts[k].destroy(); }); }
    };
  }

  /* Ȩ ���(���� ī��): ���� '���� ���ż� ����'�� ������ 20�ŷ��� ���� ����� ���.
     ������ �ϳ��� ����/���庰 ��Ʈ ��� �׸��� ��ú��忡 ���� ���� ����. */
  function miniChart(rows, options) {
    var opts = options || {}, intraday = opts.period === 'intraday';
    var data = Array.isArray(rows) ? rows : [], cum;
    if (intraday) {
      data = intradayRows(data, opts.date);
      if (!data.length) return '<div class="hmb-investor-spark-empty">���� ���� ������ ����</div>';
      cum = {dates: data.map(function (r) { return slotLabel(r.slot); }), series: {}, index: [], days: 1};
      INVESTORS.forEach(function (inv, i) {
        cum.series[inv.key] = data.map(function (r) { return validAmount(r[['frgn','orgn','ind'][i]]) ? Number(r[['frgn','orgn','ind'][i]]) : null; });
      });
    } else {
      data = data.filter(function (r) {
        return r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))
          && INVESTORS.every(function (i) { return validAmount(r[i.key]); });
      });
      if (!data.length) return '<div class="hmb-investor-spark-empty">���� ���� �ڷ� ����</div>';
      cum = cumulative(data, opts.days || 20);
    }
    var n = cum.dates.length;
    if (!intraday && n < 2) return '<div class="hmb-investor-spark-empty">���� ���� �ڷ� ����</div>';
    var width = 240, height = 70, left = 3, right = width - 3, top = 5, bottom = height - 5;
    var amounts = [0];
    INVESTORS.forEach(function (inv) {
      cum.series[inv.key].forEach(function (v) { if (validAmount(v)) amounts.push(v); });
    });
    var min = Math.min.apply(Math, amounts), max = Math.max.apply(Math, amounts);
    var gap = Math.max(1, (max - min) * .08);
    min -= gap; max += gap;
    function x(i) { return left + (right - left) * (intraday ? data[i].slot / 13 : i / (n - 1)); }
    function y(v) { return bottom - (v - min) / (max - min) * (bottom - top); }
    function fmt(v) {
      var a = Math.abs(v);
      return (v > 0 ? '+' : v < 0 ? '-' : '') + (a >= 10000 ? (a / 10000).toFixed(2) + '��' : Math.round(a).toLocaleString('ko-KR') + '��');
    }
    var svg = '<line x1="' + left + '" x2="' + right + '" y1="' + y(0).toFixed(2)
      + '" y2="' + y(0).toFixed(2) + '" stroke="var(--hmb-line, #e0e4e8)" stroke-width=".8" vector-effect="non-scaling-stroke"/>';
    INVESTORS.forEach(function (inv) {
      var arr = cum.series[inv.key], groups = [], group = [];
      arr.forEach(function (v, i) {
        if (!validAmount(v)) { if (group.length) groups.push(group); group = []; return; }
        if (intraday && group.length && data[i].slot !== data[group[group.length-1]].slot + 1) { groups.push(group); group = []; }
        group.push(i);
      });
      if (group.length) groups.push(group);
      groups.forEach(function (g) {
        if (g.length < 2) return;
        svg += '<polyline points="' + g.map(function (i) { return x(i).toFixed(2) + ',' + y(arr[i]).toFixed(2); }).join(' ')
          + '" fill="none" stroke="' + inv.color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke">'
          + '<title>' + inv.label + ' ���� ' + fmt(arr[g[g.length-1]]) + '</title></polyline>';
      });
      arr.forEach(function (v, i) {
        if (!validAmount(v)) return;
        // Isolated samples remain visible; never join missing slots or fields.
        if (intraday || i === n-1) svg += '<circle cx="' + x(i).toFixed(2) + '" cy="' + y(v).toFixed(2) + '" r="1.8" fill="' + inv.color + '"><title>'
          + esc(cum.dates[i] + ' �� ' + inv.label + ' ���� ' + fmt(v)) + '</title></circle>';
      });
    });
    var indexes = cum.index.filter(function (v) { return v != null && isFinite(Number(v)); });
    var showIndex = !intraday && opts.showIndex !== false && indexes.length >= 2;
    if (showIndex) {
      var low = Math.min.apply(Math, indexes), high = Math.max.apply(Math, indexes);
      var span = high - low || 1, paths = [], group = [];
      cum.index.forEach(function (v, i) {
        if (v == null || !isFinite(Number(v))) {
          if (group.length > 1) paths.push(group.join(' '));
          group = [];
          return;
        }
        group.push(x(i).toFixed(2) + ',' + (bottom - (Number(v) - low) / span * (bottom - top)).toFixed(2));
      });
      if (group.length > 1) paths.push(group.join(' '));
      paths.forEach(function (pts) {
        svg += '<polyline points="' + pts
          + '" fill="none" stroke="var(--hmb-mute, #808a96)" stroke-width="1.1" stroke-dasharray="3 3" opacity=".75" vector-effect="non-scaling-stroke">'
          + '<title>' + esc(opts.market || '����') + ' ����(���� ��)</title></polyline>';
      });
    }
    var points = [];
    cum.dates.forEach(function (date, i) {
      var tip = (intraday ? opts.date + ' �� ' + date + ' KST ����' : date) + '\n' + INVESTORS.map(function (inv) {
        return inv.label + ' ���� ' + (validAmount(cum.series[inv.key][i]) ? fmt(cum.series[inv.key][i]) : '�̰���');
      }).join(' �� ');
      if (intraday) tip += '\n���� ���� ' + data[i].asOf;
      else if (cum.index[i] != null && isFinite(cum.index[i])) tip += '\n���� ' + Number(cum.index[i]).toLocaleString('ko-KR', {maximumFractionDigits:2}) + ' (���� ��)';
      INVESTORS.forEach(function (inv) {
        var v = cum.series[inv.key][i];
        if (validAmount(v)) points.push([Math.round(x(i) / width * 10000) / 100, Math.round(y(v) / height * 10000) / 100, tip]);
      });
    });
    var first = cum.dates[0], last = cum.dates[n - 1];
    var label = (opts.market || '����') + (intraday ? ' ' + opts.date + ' ���� 30�� ���Ժ� ���� ���ż� (���ջ� ����)' : ' �ֱ� ' + cum.days + '�ŷ��� ���� ���ż�');
    return '<div class="hmb-investor-spark-wrap hmb-investor-mini-cumulative" data-hover-points="' + esc(JSON.stringify(points))
      + '"><svg class="hmb-investor-spark" viewBox="0 0 ' + width + ' ' + height
      + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '">'
      + svg + '</svg></div>'
      + (intraday ? '<div class="hmb-investor-mini-dates"><span>09:00</span><span>12:00</span><span>15:30</span></div>'
        : '<div class="hmb-investor-mini-dates"><span>' + esc(first === '�Ⱓ ����' ? '���� ����' : first.slice(5)) + '</span><span>' + esc(last.slice(5)) + '</span></div>');
  }

  function validAmount(v) { return v != null && v !== '' && typeof v !== 'boolean' && isFinite(Number(v)); }
  function slotLabel(slot) {
    var minutes = 540 + slot * 30;
    return String(Math.floor(minutes/60)).padStart(2, '0') + ':' + String(minutes%60).padStart(2, '0');
  }
  function intradayRows(rows, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return [];
    var slots = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !Number.isInteger(r.slot) || r.slot < 0 || r.slot > 13 || !r.asOf) return;
      var stamp = Date.parse(r.asOf), start = Date.parse(date + 'T09:00:00+09:00');
      var minute = (stamp - start) / 60000;
      // Backend stores each slot's last observation, including the final 15:30 minute.
      if (!isFinite(stamp) || minute < r.slot*30 || minute >= (r.slot === 13 ? 391 : (r.slot+1)*30)) return;
      if (!['frgn','orgn','ind'].some(function (k) { return validAmount(r[k]); })) return;
      if (!slots[r.slot] || stamp > Date.parse(slots[r.slot].asOf)) slots[r.slot] = r;
    });
    return Object.keys(slots).map(function (k) { return slots[k]; }).sort(function (a,b) { return a.slot-b.slot; });
  }


  // Compact summary of the same validated intraday snapshot; never sum cumulative slots.
  function miniBars(rows, options) {
    var opts = options || {}, contracts = opts.unit === 'contracts';
    var valid = contracts && opts.snapshot ? [opts.snapshot] : intradayRows(rows, opts.date);
    if (!valid.length) return '<div class="hmb-investor-spark-empty">���� ���� ������ ����</div>';
    var last = valid[valid.length-1], fields = ['frgn','orgn','ind'];
    var maximum = Math.max(1, Number(opts.maxAbs) || 0);
    fields.forEach(function (key) { if (validAmount(last[key])) maximum = Math.max(maximum, Math.abs(Number(last[key]))); });
    return '<div class="hmb-investor-bars" role="list" aria-label="' + esc((opts.market || '����') + ' ' + (opts.date || '') + ' ���� ���� ���ż�; ���� ���̴� ' + (contracts ? '�������' : '����ݾ�')) + '">'
      + INVESTORS.map(function (inv,i) {
        var raw = last[fields[i]], known = validAmount(raw), value = known ? Number(raw) : null;
        var width = known ? Math.min(100, Math.abs(value)/maximum*100) : 0;
        var amount = known ? (value > 0 ? '+' : value < 0 ? '?' : '') + Math.round(Math.abs(value)).toLocaleString('ko-KR') + (contracts ? '���' : '��') : '�̰���';
        var direction = known ? value > 0 ? '���ż�' : value < 0 ? '���ŵ�' : '����' : '';
        return '<div class="hmb-investor-bar-row" role="listitem" style="--investor-color:' + inv.color + ';--investor-fill:' + (i === 0 ? 'var(--chart-fill-up)' : i === 1 ? 'var(--chart-fill-down)' : 'color-mix(in srgb, var(--investor-color) 13%, transparent)') + '">'
          + '<span class="hmb-investor-bar-name">' + inv.label + '</span>'
          + '<div class="hmb-investor-bar-track"><i aria-hidden="true" style="width:' + width.toFixed(2) + '%"></i>'
          + '<span class="hmb-investor-bar-value">' + amount + '<small>' + direction + '</small></span></div></div>';
      }).join('') + '</div>';
  }

  // Futures observations use server retrieval timestamps, never fabricated exchange ticks.

  function futuresActivity(participants) {
    var checked = {}, total = 0, sells = 0;
    ['foreign','institution','individual','other'].forEach(function(key) {
      var p = participants && participants[key], fields = p && [p.buy,p.sell,p.net];
      if (!fields || !fields.every(function(v){return typeof v === 'number' && Number.isSafeInteger(v);}) || p.buy < 0 || p.sell < 0 || p.buy-p.sell !== p.net) return;
      checked[key] = {buy:p.buy,sell:p.sell,net:p.net};
      total += p.buy; sells += p.sell;
    });
    return {participants:checked,totalContracts:Object.keys(checked).length===4 && total===sells ? total : null};
  }

  function futuresRows(rows, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return [];
    var start = Date.parse(date + 'T08:45:00+09:00'), slots = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var ts = Number(r && r.ts), elapsed = (ts * 1000 - start) / 60000;
      if (!isFinite(ts) || ts <= 0 || elapsed < 0 || elapsed > 420) return;
      var slot = Math.floor(elapsed / 30);
      if (!slots[slot] || ts > slots[slot].ts) slots[slot] = Object.assign({}, r, {ts:ts,slot:slot});
    });
    var out = Object.keys(slots).map(function (k) { return slots[k]; }).sort(function (a,b) { return a.slot-b.slot; });
    out.forEach(function (r,i) {
      var before = out[i-1], continuous = before && r.slot === before.slot+1 && r.ts-before.ts <= 2400;
      r.previousTs = continuous ? before.ts : null;
      r.activity = futuresActivity(r.participants);
      r.activityDelta = {participants:{},totalContracts:null};
      if (continuous) {
        var deltas = {};
        ['foreign','institution','individual','other'].forEach(function(key) {
          var p=r.activity.participants[key], prev=before.activity.participants[key];
          if(p && prev && p.buy>=prev.buy && p.sell>=prev.sell)
            deltas[key]={buy:p.buy-prev.buy,sell:p.sell-prev.sell,net:p.net-prev.net};
        });
        r.activityDelta=futuresActivity(deltas);
      }
      ['foreign','institution','individual'].forEach(function (key) {
        r[key] = validAmount(r[key]) ? Number(r[key]) : null;
        r[key+'Delta'] = continuous && r[key]!=null && validAmount(before[key]) ? r[key]-Number(before[key]) : null;
      });
    });
    return out;
  }


  function futuresChart(rows, options) {
    var opts=options||{}, actor=['foreign','institution','individual','all'].indexOf(opts.actor)>=0?opts.actor:'foreign';
    var actors=actor==='all'?['foreign','institution','individual']:[actor];
    var names={foreign:'�ܱ���',institution:'���',individual:'����'};
    var data=futuresRows(rows,opts.date), interval=opts.mode!=='cumulative';
    var values=[];
    data.forEach(function(r){actors.forEach(function(key){values.push(r[key+(interval?'Delta':'')]);});});
    var max=Math.max.apply(null,[1].concat(values.filter(validAmount).map(Math.abs)));
    var marks='<line x1="4" x2="96" y1="45" y2="45" class="hmb-investor-zero" vector-effect="non-scaling-stroke"/>';
    data.forEach(function(r){
      actors.forEach(function(key,i){
        var value=r[key+(interval?'Delta':'')], width=actors.length===1?4:1.5;
        var x=4+r.slot/14*92+(i-(actors.length-1)/2)*1.7;
        if(value==null)return;
        var h=Math.abs(value)/max*34;
        marks+='<rect data-futures-slot="'+r.slot+'" class="hmb-investor-'+(value>=0?'buy':'sell')+(actors.length>1?' hff-actor-'+key:'')+'" x="'+(x-width/2)+'" y="'+(value>=0?45-h:45)+'" width="'+width+'" height="'+Math.max(.5,h)+'"><title>'+esc(names[key]+' '+(new Date(r.ts*1000)).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' ���� ���� �� '+(value>0?'+':'')+value.toLocaleString('ko-KR')+'���')+'</title></rect>';
      });
    });
    return (actors.length>1?'<div class="hff-legend"><span class="hff-actor-foreign">�ܱ���</span><span class="hff-actor-institution">���</span><span class="hff-actor-individual">����</span><small>�� ���ż� �� �Ʒ� ���ŵ� �� ���</small></div>':'')
      +'<div class="hmb-investor-spark-wrap hff-timeline"><svg class="hmb-investor-spark" viewBox="0 0 100 90" preserveAspectRatio="none" role="img" aria-label="'+esc((opts.date||'���� ���')+' '+(interval?'����':'����')+' ���ż� ���. ù ���� ������ ���� ������ ��� ��')+'">'+marks+'</svg>'
      +(!data.length?'<span class="hff-empty">���� ���� �̷� ��� �� ���� ���� ���� �� ��</span>':!values.some(validAmount)?'<span class="hff-empty">ù ���� �� ���� �������� ��ȭ ǥ��</span>':'')+'</div>'
      +'<div class="hmb-investor-axis"><span>08:45</span><span>15:45 KST</span></div>';
  }

  function futuresActivityTable(rows, options) {
    var opts=options||{}, interval=opts.mode==='interval', data=futuresRows(rows,opts.date);
    function num(v){return v==null?'������':Number(v).toLocaleString('ko-KR');}
    function cell(p,net) {
      return '<td><span>�ż� '+num(p&&p.buy)+'</span><span>�ŵ� '+num(p&&p.sell)+'</span><b>'+(net==null?'���ż� ������':(net>0?'���ż� +':net<0?'���ŵ� ?':'���ż� ')+num(Math.abs(net)))+'</b></td>';
    }
    function rowHtml(row,label,activity,fields,extra) {
      return '<tr'+(row.slot===opts.selectedSlot?' class="is-selected"':'')+'><th scope="row">'+esc(label)+(extra?'<small>'+esc(extra)+'</small>':'')+'</th>'
        +'<td>'+num(activity.totalContracts)+'</td>'
        +['foreign','institution','individual','other'].map(function(key){
          var p=activity.participants[key],net=fields?fields[key]:p?p.net:null;
          return cell(p,net);
        }).join('')+'</tr>';
    }
    var html=data.map(function(row){
      var time=new Date(row.ts*1000).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'});
      var start=interval&&row.previousTs?new Date(row.previousTs*1000).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})+'��':'';
      var fields={};['foreign','institution','individual'].forEach(function(k){fields[k]=row[k+(interval?'Delta':'')];});
      var activity=interval?row.activityDelta:row.activity;fields.other=activity.participants.other?activity.participants.other.net:null;
      return rowHtml(row,start+time,activity,fields,interval&&!row.previousTs?'���� ���� ����':'���� ����');
    }).join('');
    var snapshot=opts.snapshot, footer='';
    if(snapshot && snapshot.available && snapshot.participants) {
      var stamp=String(snapshot.retrievedAt||''),time=stamp?new Date(stamp).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}):'�ð� ��Ȯ��';
      footer='<tfoot>'+rowHtml({},'�ֱ� ��ȸ '+time,futuresActivity(snapshot.participants),null,'���� ���� �� ���� �ð� ������'+(snapshot.stale?' �� ����':''))+'</tfoot>';
    }
    return '<div class="hff-activity-scroll"><table class="hff-activity-table"><caption>'+(interval?'���� ���� ���� ���� ��� ��':'�� ���� �������� ���� ���� ��� ��')+' �� 30�к� ������ ���� �� ���� ���</caption><thead><tr><th>���� �ð�(KST)</th><th>��ü �ŷ���</th><th>�ܱ���</th><th>���</th><th>����</th><th>��Ÿ����</th></tr></thead><tbody>'+html+'</tbody>'+footer+'</table></div>'
      +'<p class="hff-activity-note">��ü=�ܱ��Ρ���������Ρ���Ÿ������ �ż� �հ�(�ŵ� �հ�� ��ġ�� ���� ǥ��). �ż�+�ŵ� �ջ� �ƴ�. ���� ���ż��� ����� �ð����� �ż����ŵ�����ü�� �������Դϴ�.</p>';
  }

  global.InvestorFlow = {
    mount: mount,
    miniChart: miniChart,
    miniBars: miniBars,
    futuresChart: futuresChart,
    futuresRows: futuresRows,
    futuresActivityTable: futuresActivityTable,
    futuresActivity: futuresActivity,
    intradayRows: intradayRows,
    mountBalance: mountBalance,
    _calc: { cumulative: cumulative, streak: streak, balanceStats: balanceStats, balanceSeries: balanceSeries, summarize: summarize, summarizeInvestors: summarizeInvestors, summarizeBalances: summarizeBalances, lastRows: lastRows, sumOf: sumOf, PERIODS: PERIODS, TREND_PCT: TREND_PCT, INVESTORS: INVESTORS,
      mmdd: mmdd, lineSpec: lineSpec }
  };
})(window);


