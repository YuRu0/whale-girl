'use strict';
// 守岸人 · 用量观测面板（渲染进程）。所有数据文本一律走 textContent，样式只用 CSSOM（配合严格 CSP）。
(() => {
  const api = window.usagePanel || null;
  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PERIOD_LABEL = { today: '今日', d7: '近 7 天', month: '本月', all: '全部' };
  const APP_META = {
    codex: { label: 'Codex', color: '#9fe3ff' },
    claude: { label: 'Claude', color: '#e8d5a0' },
    opencode: { label: 'OpenCode', color: '#8ea4d8' },
    gemini: { label: 'Gemini', color: '#93c9b4' }
  };
  const APP_ORDER = ['codex', 'claude', 'opencode', 'gemini'];
  const HEAT = [null, 'rgba(63, 132, 168, .34)', 'rgba(79, 158, 199, .52)', 'rgba(112, 190, 228, .7)', 'rgba(159, 227, 255, .88)', 'rgba(232, 213, 160, .92)'];
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const RING_C = 2 * Math.PI * 40;

  let snapshot = null;
  let period = loadPeriod();
  let readyTimer = 0;
  let toastTimer = 0;

  // ---------- DOM 小工具 ----------
  function append(node, children) {
    if (children === undefined || children === null || children === false) return node;
    for (const child of Array.isArray(children) ? children : [children]) {
      if (child === undefined || child === null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  function h(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'style') for (const [p, v] of Object.entries(value)) node.style.setProperty(p, v);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    return append(node, children);
  }
  function s(tag, attrs, children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null) continue;
      if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, String(value));
    }
    return append(node, children);
  }
  function replace(node, children) {
    node.replaceChildren();
    return append(node, children);
  }
  function empty(title, desc) {
    return h('div', { class: 'empty' }, [h('b', { text: title }), desc || null]);
  }
  function swap(node) {
    if (!node) return;
    node.classList.remove('swap');
    void node.offsetWidth;
    node.classList.add('swap');
  }

  // ---------- 格式化 ----------
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  function fmtTokens(value) {
    const n = num(value);
    const a = Math.abs(n);
    if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(Math.round(n));
  }
  function fmtAxis(value) {
    const trim = (x) => String(Number(x.toFixed(1)));
    if (value >= 1e9) return `${trim(value / 1e9)}B`;
    if (value >= 1e6) return `${trim(value / 1e6)}M`;
    if (value >= 1e3) return `${trim(value / 1e3)}k`;
    return String(Math.round(value));
  }
  function symbol(unit) {
    const u = String(unit || '').toUpperCase();
    return u === 'CNY' || u === 'RMB' ? '¥' : u === 'USD' ? '$' : '';
  }
  function fmtMoney(value, unit = 'USD') {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const n = Number(value);
    const fixed = n !== 0 && Math.abs(n) < 0.01 ? n.toFixed(4) : n.toFixed(2);
    const sym = symbol(unit);
    return sym ? `${sym}${fixed}` : `${fixed} ${unit || ''}`.trim();
  }
  const fmtPct = (ratio, digits = 0) => `${(num(ratio) * 100).toFixed(digits)}%`;
  const fmtInt = (n) => Math.round(num(n)).toLocaleString('zh-CN');
  function hhmm(iso) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '--:--';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function relTime(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '—';
    const diff = Math.max(0, Date.now() - t) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    const d = new Date(t);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm(iso)}`;
  }
  function dateOf(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function dayTitle(key) {
    const d = dateOf(key);
    return d ? `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}` : String(key || '');
  }
  function appMeta(key) {
    return APP_META[key] || { label: key ? key.charAt(0).toUpperCase() + key.slice(1) : '其他', color: '#6f8998' };
  }
  function appKeys(present) {
    const extra = Object.keys(present || {}).filter((k) => !APP_ORDER.includes(k)).sort();
    return APP_ORDER.concat(extra);
  }
  function costText(costUsd, requests, unpriced) {
    if (!requests) return '$0';
    if (num(costUsd) > 0) return fmtMoney(costUsd, 'USD');
    return num(unpriced) > 0 ? '未计价' : '$0';
  }

  // ---------- 状态 ----------
  function loadPeriod() {
    try {
      const saved = localStorage.getItem('whalegirl.usage.period');
      if (saved && PERIOD_LABEL[saved]) return saved;
    } catch { /* 无存储 */ }
    return 'today';
  }
  function savePeriod() {
    try { localStorage.setItem('whalegirl.usage.period', period); } catch { /* 无存储 */ }
  }
  const stats = () => (snapshot && snapshot.stats) || null;
  // ---------- 头部 / 周期 ----------
  function renderHeader() {
    const sub = $('subtitle');
    const st = stats();
    const dot = h('i', { class: !snapshot || (st && st.ok) ? 'dot' : 'dot warn' });
    if (!snapshot) return replace(sub, [dot, 'CC Switch 本地记录 · 读取中']);
    if (!st || !st.ok) return replace(sub, [dot, (st && st.error) || 'CC Switch 数据暂不可用']);
    return replace(sub, [dot, `CC Switch 本地记录 · 更新于 ${hhmm(snapshot.updatedAt)}`]);
  }
  function renderTabs() {
    for (const tab of document.querySelectorAll('.tab')) {
      const on = tab.dataset.period === period;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    }
  }

  // ---------- 主数字 ----------
  const PARTS = [
    ['fresh', '输入', 'var(--c-fresh)'],
    ['cacheRead', '缓存读', 'var(--c-cread)'],
    ['cacheWrite', '缓存写', 'var(--c-cwrite)'],
    ['output', '输出', 'var(--c-output)']
  ];
  function renderHero() {
    const st = stats();
    const p = st && st.ok && st.periods ? st.periods[period] : null;
    $('hero-period').textContent = PERIOD_LABEL[period];
    const totalEl = $('hero-total');
    const bar = $('compose-bar');
    const legend = $('compose-legend');
    const note = $('hero-note');
    if (!p) {
      totalEl.textContent = '—';
      $('st-req').textContent = '—';
      $('st-cost').textContent = '—';
      $('st-hit').textContent = '—';
      replace(bar, null);
      replace(legend, null);
      note.textContent = st && !st.ok ? '读取不到 CC Switch 数据库，确认 CC Switch 已安装并开启用量记录。' : '';
      return;
    }
    totalEl.textContent = fmtTokens(p.total);
    $('st-req').textContent = fmtInt(p.requests);
    const cost = $('st-cost');
    cost.textContent = costText(p.costUsd, p.requests, p.unpricedRequests);
    cost.className = num(p.costUsd) > 0 ? 'gold' : '';
    const hit = $('st-hit');
    hit.textContent = p.total > 0 ? fmtPct(p.cacheHitRate, 1) : '—';
    hit.className = p.total > 0 ? 'ice' : '';

    if (p.total > 0) {
      replace(bar, PARTS.filter(([key]) => num(p[key]) > 0).map(([key, , color]) =>
        h('i', { style: { width: `${(num(p[key]) / p.total) * 100}%`, background: color } })));
      replace(legend, PARTS.filter(([key]) => num(p[key]) > 0).map(([key, label, color]) =>
        h('span', null, [h('em', { style: { background: color } }), label, h('b', { text: fmtTokens(p[key]) })])));
    } else {
      replace(bar, null);
      replace(legend, h('span', { text: `${PERIOD_LABEL[period]}还没有用量记录` }));
    }
    if (p.requests > 0 && num(p.unpricedRequests) > 0) {
      note.textContent = num(p.unpricedRequests) >= p.requests
        ? '本期模型均未在 CC Switch 定价，成本无法计算。'
        : `部分模型未定价：${fmtInt(p.unpricedRequests)} / ${fmtInt(p.requests)} 次请求未计入成本。`;
    } else {
      note.textContent = '';
    }
  }

  // ---------- 按应用 ----------
  function renderApps() {
    const st = stats();
    const p = st && st.ok && st.periods ? st.periods[period] : null;
    const box = $('app-list');
    $('apps-aux').textContent = p && p.sessions ? `${fmtInt(p.sessions)} 个会话` : '';
    if (!p) return replace(box, empty('暂无数据', st && !st.ok ? 'CC Switch 数据库暂时读不到' : '等待 CC Switch 记录'));
    const keys = appKeys(p.byApp).filter((k) => p.byApp[k] && (num(p.byApp[k].requests) > 0 || APP_ORDER.slice(0, 3).includes(k)));
    const rows = keys.map((key) => {
      const a = p.byApp[key] || { requests: 0, total: 0, costUsd: 0 };
      const meta = appMeta(key);
      const share = p.total > 0 ? a.total / p.total : 0;
      const detail = a.requests > 0
        ? `${fmtInt(a.requests)} 次 · ${costText(a.costUsd, a.requests, a.unpricedRequests)} · ${fmtPct(share)}`
        : '无记录';
      return h('div', { class: a.requests > 0 ? 'app-row' : 'app-row dim' }, [
        h('div', { class: 'app-name' }, [h('i', { style: { background: meta.color } }), meta.label]),
        h('div', { class: 'app-bar' }, h('i', { style: { width: `${Math.max(share > 0 ? 1.5 : 0, share * 100)}%`, background: meta.color } })),
        h('div', { class: 'app-val' }, [h('b', { text: a.requests > 0 ? fmtTokens(a.total) : '—' }), h('span', { text: detail })])
      ]);
    });
    replace(box, h('div', { class: 'card', style: { padding: '4px 12px' } }, rows));
  }

  // ---------- Codex 当前会话 ----------
  function renderLive() {
    const live = snapshot && snapshot.live;
    const ring = $('ring-val');
    const pctEl = $('ring-pct');
    const kv = $('live-kv');
    const aux = $('live-aux');
    const wrap = kv.parentElement;
    wrap.classList.add('card');
    if (!live || !live.ok) {
      ring.setAttribute('stroke-dasharray', `0 ${RING_C}`);
      ring.setAttribute('class', 'ring-val');
      pctEl.textContent = '—';
      aux.textContent = live && live.lastActivityAt ? relTime(live.lastActivityAt) : '';
      replace(kv, [
        h('dt', { text: '状态' }), h('dd', null, h('span', { class: 'muted', text: (live && live.status) || '等待 Codex 会话' })),
        h('dt', { text: '模型' }), h('dd', null, h('span', { class: 'mono', text: (live && live.model) || '—' }))
      ]);
      return;
    }
    const pct = Math.max(0, Math.min(100, num(live.contextPercent)));
    const len = (pct / 100) * RING_C;
    ring.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${RING_C.toFixed(2)}`);
    ring.setAttribute('class', pct >= 85 ? 'ring-val hot' : pct >= 65 ? 'ring-val warn' : 'ring-val');
    pctEl.textContent = `${Math.round(pct)}%`;
    const idle = (Date.now() - Date.parse(live.lastActivityAt || '')) / 60000;
    aux.textContent = Number.isFinite(idle) && idle < 3 ? '活跃中' : '';
    replace(kv, [
      h('dt', { text: '上下文' }),
      h('dd', null, [h('span', { class: 'n', text: fmtTokens(live.contextTokens) }), h('span', { class: 'muted', text: ` / ${fmtTokens(live.contextWindow)}` })]),
      h('dt', { text: '会话累计' }), h('dd', null, h('span', { class: 'n', text: fmtTokens(live.threadTotal) })),
      h('dt', { text: '上一轮' }),
      h('dd', null, [h('span', { class: 'n', text: fmtTokens(live.lastTurnTotal) }), h('span', { class: 'muted', text: ` · 缓存 ${Math.min(99.9, num(live.cachePercent)).toFixed(1)}%` })]),
      h('dt', { text: '模型' }), h('dd', null, h('span', { class: 'mono', text: live.model || '—', title: live.model || '' })),
      h('dt', { text: '最后活动' }), h('dd', null, h('span', { class: 'muted', text: relTime(live.lastActivityAt) }))
    ]);
  }
  // ---------- 浮动提示 ----------
  function tipRow(color, label, value) {
    return h('div', { class: 'row' }, [
      h('span', null, [color ? h('i', { style: { background: color } }) : null, label]),
      h('span', { text: value })
    ]);
  }
  function showTip(target, children) {
    const tip = $('tip');
    replace(tip, children);
    const shell = $('shell').getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    const ht = tip.offsetHeight;
    const left = Math.max(8, Math.min(shell.width - w - 8, r.left + r.width / 2 - shell.left - w / 2));
    let top = r.top - shell.top - ht - 8;
    if (top < 8) top = r.bottom - shell.top + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.classList.add('show');
  }
  function hideTip() {
    $('tip').classList.remove('show');
  }

  // ---------- 近 30 天趋势 ----------
  function niceCeil(value) {
    if (value <= 0) return 1;
    const exp = 10 ** Math.floor(Math.log10(value));
    const f = value / exp;
    const nice = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => f <= step + 1e-9) || 10;
    return nice * exp;
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function shortDay(key) {
    const d = dateOf(key);
    return d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
  }
  function renderTrend() {
    hideTip();
    const st = stats();
    const box = $('trend-chart');
    const legendBox = $('trend-legend');
    const days = st && Array.isArray(st.daily) ? st.daily : [];
    const max = days.reduce((m, d) => Math.max(m, num(d.total)), 0);
    if (!days.length || max <= 0) {
      box.className = 'chart-box';
      replace(box, empty('近 30 天没有记录', '使用 Codex 或 Claude 后，这里会出现每日用量'));
      replace(legendBox, null);
      $('trend-aux').textContent = '';
      return;
    }
    box.className = 'chart-box card';
    const present = {};
    for (const d of days) for (const [k, v] of Object.entries(d.byApp || {})) if (num(v) > 0) present[k] = true;
    const keys = appKeys(present).filter((k) => present[k]);
    const W = 356, H = 116, L = 30, R = 2, T = 8, B = 18;
    const cw = W - L - R;
    const ch = H - T - B;
    const top = niceCeil(max);
    const slot = cw / days.length;
    const bw = Math.min(8, slot * 0.64);
    const tKey = todayKey();
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `近 30 天每日用量，峰值 ${fmtTokens(max)} tokens` });
    for (const f of [0, 0.5, 1]) {
      const y = Math.round(T + ch * (1 - f)) + 0.5;
      svg.append(s('line', { class: 'grid', x1: L, x2: W - R, y1: y, y2: y }));
      svg.append(s('text', { class: 'axis', x: L - 6, y: y + 3, 'text-anchor': 'end' }, f === 0 ? '0' : fmtAxis(top * f)));
    }
    const bars = s('g', { class: 'bars' });
    const hits = s('g');
    days.forEach((day, i) => {
      const x0 = L + i * slot;
      const isToday = day.date === tKey;
      if (isToday) {
        bars.append(s('rect', { class: 'today-mark', x: x0, y: T - 4, width: slot, height: ch + 4, rx: 3 }));
        bars.append(s('line', { class: 'today-base', x1: x0 + 1.5, x2: x0 + slot - 1.5, y1: T + ch + 1.5, y2: T + ch + 1.5 }));
      }
      const total = num(day.total);
      if (total > 0) {
        const totalH = Math.max(1.5, (total / top) * ch);
        let y = T + ch;
        for (const key of keys) {
          const v = num(day.byApp && day.byApp[key]);
          if (v <= 0) continue;
          const segH = (v / total) * totalH;
          y -= segH;
          bars.append(s('rect', { x: x0 + (slot - bw) / 2, y, width: bw, height: segH, fill: appMeta(key).color, opacity: isToday ? 1 : 0.72 }));
        }
        if (isToday) bars.append(s('circle', { cx: x0 + slot / 2, cy: y - 4, r: 1.6, fill: '#e8d5a0' }));
      }
      const hit = s('rect', { class: 'col-hit', x: x0, y: T - 4, width: slot, height: ch + 4 });
      hit.addEventListener('mouseenter', () => {
        const rows = [h('b', { text: `${dayTitle(day.date)}${isToday ? ' · 今天' : ''}` })];
        if (total > 0) {
          rows.push(tipRow(null, '合计', `${fmtTokens(total)} tokens`));
          for (const key of keys) {
            const v = num(day.byApp && day.byApp[key]);
            if (v > 0) rows.push(tipRow(appMeta(key).color, appMeta(key).label, fmtTokens(v)));
          }
          rows.push(tipRow(null, '请求', `${fmtInt(day.requests)} 次`));
          rows.push(tipRow(null, '成本', num(day.costUsd) > 0 ? fmtMoney(day.costUsd, 'USD') : '未计价 / $0'));
        } else {
          rows.push(h('div', { text: '没有记录' }));
        }
        showTip(hit, rows);
      });
      hit.addEventListener('mouseleave', hideTip);
      hits.append(hit);
    });
    svg.append(bars);
    const labelAt = [0, 7, 14, 21];
    for (const i of labelAt) {
      if (!days[i] || days[i].date === tKey) continue;
      svg.append(s('text', { class: 'axis', x: L + i * slot + (i === 0 ? 0 : slot / 2), y: H - 4, 'text-anchor': i === 0 ? 'start' : 'middle' }, shortDay(days[i].date)));
    }
    const last = days[days.length - 1];
    svg.append(s('text', { class: last.date === tKey ? 'axis today' : 'axis', x: W - R, y: H - 4, 'text-anchor': 'end' }, last.date === tKey ? '今天' : shortDay(last.date)));
    svg.append(hits);
    replace(box, svg);

    const sum = days.reduce((a, d) => a + num(d.total), 0);
    const peak = days.reduce((best, d) => (num(d.total) > num(best.total) ? d : best), days[0]);
    $('trend-aux').textContent = `合计 ${fmtTokens(sum)} · 峰值 ${shortDay(peak.date)}`;
    replace(legendBox, keys.map((k) => h('span', null, [h('i', { style: { background: appMeta(k).color } }), appMeta(k).label])));
  }

  // ---------- 7 × 24 热力图 ----------
  function renderHeat() {
    const st = stats();
    const box = $('heat-grid');
    const hm = st && st.heatmap;
    if (!hm || !Array.isArray(hm.cells) || !num(hm.max)) {
      box.className = 'heat';
      replace(box, empty('近 7 天没有活跃记录'));
      $('heat-aux').textContent = '';
      return;
    }
    box.className = 'heat card';
    const grid = h('div', { class: 'heat-grid', 'aria-label': '近 7 天每小时请求数' });
    let peak = { v: 0, di: 0, hour: 0 };
    hm.cells.forEach((row, di) => {
      const key = hm.dates ? hm.dates[di] : null;
      const isToday = key === todayKey();
      const d = dateOf(key);
      grid.append(h('div', { class: isToday ? 'heat-day today' : 'heat-day', text: isToday ? '今天' : d ? WEEK[d.getDay()] : hm.days[di] }));
      row.forEach((value, hour) => {
        const v = num(value);
        if (v > peak.v) peak = { v, di, hour };
        const level = v > 0 ? Math.min(5, Math.max(1, Math.ceil((v / hm.max) * 5))) : 0;
        const cell = h('div', { class: isToday ? 'heat-cell today-row' : 'heat-cell', style: level ? { background: HEAT[level] } : undefined });
        cell.addEventListener('mouseenter', () => showTip(cell, [
          h('b', { text: `${dayTitle(key)} ${String(hour).padStart(2, '0')}:00` }),
          tipRow(null, '请求', `${fmtInt(v)} 次`)
        ]));
        cell.addEventListener('mouseleave', hideTip);
        grid.append(cell);
      });
    });
    const hours = h('div', { class: 'heat-hours' }, [h('span')].concat(Array.from({ length: 24 }, (_, i) => h('span', { text: i % 6 === 0 ? String(i) : '' }))));
    const scale = h('div', { class: 'heat-scale' }, ['少', ...HEAT.slice(1).map((c) => h('i', { style: { background: c } })), '多']);
    replace(box, [grid, hours, scale]);
    const pd = dateOf(hm.dates && hm.dates[peak.di]);
    const peakDay = hm.dates && hm.dates[peak.di] === todayKey() ? '今天' : pd ? WEEK[pd.getDay()] : '';
    $('heat-aux').textContent = peak.v ? `高峰 ${peakDay} ${peak.hour} 时 · ${fmtInt(peak.v)} 次` : '';
  }

  // ---------- 模型排行 ----------
  function renderModels() {
    const st = stats();
    const list = (st && st.ok && st.models && st.models[period]) || [];
    const box = $('model-list');
    $('models-aux').textContent = list.length ? `${PERIOD_LABEL[period]} · 按 tokens` : '';
    if (!list.length) {
      box.className = 'models';
      replace(box, h('li', null, empty(`${PERIOD_LABEL[period]}没有模型记录`)));
      return;
    }
    box.className = 'models card';
    replace(box, list.slice(0, 6).map((m, i) => {
      const meta = appMeta(m.app);
      const share = num(m.share);
      const costPart = num(m.costUsd) > 0 ? ` · ${fmtMoney(m.costUsd, 'USD')}` : '';
      return h('li', { class: 'model', title: `${m.model} · ${fmtInt(m.requests)} 次请求${costPart}` }, [
        h('span', { class: 'rank', text: String(i + 1) }),
        h('span', { class: 'name' }, [h('b', { text: m.model }), h('span', { class: 'tag', text: meta.label, style: { color: meta.color } })]),
        h('span', { class: 'val' }, [h('b', { text: fmtTokens(m.total) }), h('span', { text: fmtPct(share, share > 0 && share < 0.1 ? 1 : 0) })]),
        h('span', { class: 'bar' }, h('i', { style: { width: `${Math.max(1, share * 100)}%` } }))
      ]);
    }));
  }
  // ---------- 供应商与余额 ----------
  function balanceView(bal, pending) {
    if (!bal) {
      return pending
        ? [h('b', { class: 'none', text: '查询中…' }), h('span', { text: '正在同步' })]
        : [h('b', { class: 'none', text: '—' }), h('span', { text: '未查询' })];
    }
    const label = bal.kind === 'deepseek' ? '账户余额' : bal.kind === 'script' ? '剩余额度' : '余额';
    if (bal.ok && bal.remaining !== null && bal.remaining !== undefined) {
      const unit = bal.currency || bal.unit || 'USD';
      const parts = [h('b', { text: fmtMoney(bal.remaining, unit) })];
      if (bal.stale) parts.push(h('span', { class: 'stale', text: bal.status }));
      else if (bal.kind === 'deepseek' && (num(bal.granted) > 0 || num(bal.toppedUp) > 0)) {
        parts.push(h('span', { text: `充值 ${fmtMoney(bal.toppedUp, unit)} · 赠送 ${fmtMoney(bal.granted, unit)}` }));
      } else parts.push(h('span', { text: `${label} · ${hhmm(bal.checkedAt)}` }));
      return parts;
    }
    return [h('b', { class: 'none', text: bal.kind === 'none' ? '无接口' : '暂不可用' }), h('span', { class: bal.kind === 'none' ? '' : 'bad', text: bal.status || '查询失败' })];
  }
  function renderProviders() {
    const st = stats();
    const box = $('prov-list');
    const providers = (st && st.providers) || {};
    const balances = (snapshot && snapshot.balances) || {};
    const pending = Boolean(balances.pending);
    $('prov-aux').textContent = pending ? '余额同步中…' : balances.checkedAt ? `余额 ${hhmm(balances.checkedAt)}` : '';
    const cards = [];
    for (const app of ['codex', 'claude']) {
      const p = providers[app];
      if (!p) continue;
      const meta = appMeta(app);
      const metaLine = [p.model, p.host].filter(Boolean).join(' · ') || '未读取到模型与地址';
      cards.push(h('div', { class: 'prov-card card' }, [
        h('div', { class: 'prov-app' }, [h('i', { style: { background: meta.color } }), `${meta.label} 当前供应商`]),
        h('div', { class: 'prov-name', text: p.name, title: p.name }),
        h('div', { class: 'prov-bal' }, balanceView(balances[app], pending)),
        h('div', { class: 'prov-meta', text: metaLine, title: metaLine })
      ]));
    }
    if (!cards.length) {
      return replace(box, empty(st && st.ok ? 'CC Switch 中没有当前供应商' : '读取不到供应商配置', '在 CC Switch 里为 Codex / Claude 选择供应商后会显示在这里'));
    }
    replace(box, cards);
  }

  function renderFoot() {
    const st = stats();
    $('foot-src').textContent = st && st.dbPath ? `数据源 ${st.dbPath}` : '';
  }

  // ---------- 渲染入口 ----------
  function render() {
    renderHeader();
    renderTabs();
    renderHero();
    renderApps();
    renderLive();
    renderTrend();
    renderHeat();
    renderModels();
    renderProviders();
    renderFoot();
  }
  function renderPeriod() {
    renderTabs();
    renderHero();
    renderApps();
    renderModels();
    swap($('hero'));
    swap($('app-list'));
    swap($('model-list'));
  }
  function setSnapshot(next) {
    if (!next || typeof next !== 'object') return;
    snapshot = next;
    render();
    markReady();
  }
  function markReady() {
    clearTimeout(readyTimer);
    requestAnimationFrame(() => $('shell').classList.add('ready'));
  }

  // ---------- 交互 ----------
  function toast(text) {
    const node = $('toast');
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
  }
  async function refresh(manual) {
    const btn = $('btn-refresh');
    if (manual) {
      btn.classList.remove('spin');
      void btn.offsetWidth;
      btn.classList.add('spin');
    }
    if (!api) return;
    try {
      const next = await api.refresh();
      if (next) setSnapshot(next);
      if (manual) toast('已刷新');
    } catch {
      if (manual) toast('刷新失败，稍后再试');
    } finally {
      if (manual) setTimeout(() => btn.classList.remove('spin'), 750);
    }
  }
  function close() {
    hideTip();
    $('shell').classList.add('leaving');
    setTimeout(() => {
      if (api) api.close();
      $('shell').classList.remove('leaving');
    }, 170);
  }
  function selectPeriod(next) {
    if (!PERIOD_LABEL[next] || next === period) return;
    period = next;
    savePeriod();
    renderPeriod();
  }

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => selectPeriod(tab.dataset.period));
  }
  // 截图/调试：?period=month 指定初始周期
  const initial = new URLSearchParams(location.search).get('period');
  if (initial && PERIOD_LABEL[initial]) period = initial;
  document.querySelector('.tabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const order = Object.keys(PERIOD_LABEL);
    const index = order.indexOf(period) + (event.key === 'ArrowRight' ? 1 : -1);
    const next = order[(index + order.length) % order.length];
    selectPeriod(next);
    const btn = document.querySelector(`.tab[data-period="${next}"]`);
    if (btn) btn.focus();
    event.preventDefault();
  });
  $('btn-refresh').addEventListener('click', () => refresh(true));
  $('btn-broadcast').addEventListener('click', () => {
    if (api) api.broadcast();
    toast('已发送到鲸鱼娘气泡');
  });
  $('btn-close').addEventListener('click', close);
  $('btn-ccswitch').addEventListener('click', () => {
    if (api) api.openCcSwitch();
  });
  $('scroll').addEventListener('scroll', hideTip, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  // 面板常驻时，每分钟刷新一次相对时间（无动画）
  setInterval(() => {
    if (snapshot && !document.hidden) {
      renderLive();
      renderHeader();
    }
  }, 60000);

  // 测试钩子：截图脚本用来切换周期（不暴露任何数据通道）
  window.__usagePanelDebug = { setPeriod: (p) => { selectPeriod(p); return period; }, period: () => period };

  render();
  readyTimer = setTimeout(markReady, 450); // 主进程没有及时回数据时也先展示骨架
  if (api) {
    api.onData(setSnapshot);
    refresh(false);
  }
})();
