'use strict';
/**
 * 用量服务：定时读取 CC Switch 统计 + Codex 当前会话，按需查询余额，并生成桌宠气泡文案。
 *
 *   const service = createUsageService({ onUpdate, onActivity });
 *   service.start(30000);              // 立即刷新一次，之后每 30 秒
 *   await service.refresh({ forceBalance: true });
 *   service.bubbleText();              // ≤ 4 行短文案
 *
 * onUpdate(snapshot)：每次刷新会回调 1~2 次（先本地统计，余额查询结束后再一次）。
 * onActivity(snapshot, { reason })：检测到新的用量（CC Switch 最新记录或 Codex 会话活动变新）时回调，
 *   首次读取只记基线不触发；两次触发至少间隔 activityMinIntervalMs（默认 90 秒）。
 */

const {
  DEFAULT_DB,
  DEFAULT_CODEX_HOME,
  readCcSwitchStats,
  readCodexLiveSession,
  queryBalances,
  formatTokens,
  formatMoney
} = require('./usage-stats.cjs');

const BALANCE_TTL_MS = 5 * 60 * 1000;
const BALANCE_FORCE_MIN_MS = 60 * 1000;

function timeOf(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : 0;
}

function hhmm(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '--:--';
}

function providerSignature(stats) {
  const p = (stats && stats.providers) || {};
  const one = (x) => (x ? `${x.name}|${x.host}|${x.model}` : '-');
  return `${one(p.codex)}#${one(p.claude)}`;
}

/** 本次查询失败但同一供应商上次成功：沿用上次数值并标记 stale，避免面板/气泡闪成空白 */
function mergeBalance(prev, next) {
  if (!next) return null;
  if (!next.ok && prev && prev.ok && prev.provider === next.provider && prev.kind === next.kind) {
    return { ...prev, stale: true, status: `沿用 ${hhmm(prev.checkedAt)} 的结果 · ${next.status}` };
  }
  return { ...next, stale: false };
}

/** 气泡里按显示宽度截断：汉字算 1，ASCII 算 0.5 */
function clipWidth(text, maxWidth) {
  let width = 0;
  let out = '';
  for (const ch of String(text)) {
    width += ch.charCodeAt(0) > 0xff ? 1 : 0.5;
    if (width > maxWidth) return `${out}…`;
    out += ch;
  }
  return out;
}

function createUsageService({
  dbPath = DEFAULT_DB,
  codexHome = DEFAULT_CODEX_HOME,
  onUpdate,
  onActivity,
  balanceTtlMs = BALANCE_TTL_MS,
  activityMinIntervalMs = 90 * 1000
} = {}) {
  let timer = null;
  let balances = { codex: null, claude: null, checkedAt: null, pending: false, error: null };
  let lastBalanceAt = 0;
  let balanceSignature = null;
  let balanceFlight = null;
  let marks = null;
  let lastActivityEmit = 0;
  let snapshot = { updatedAt: null, stats: null, live: null, balances };

  function emit() {
    if (typeof onUpdate !== 'function') return;
    try {
      onUpdate(snapshot);
    } catch (error) {
      console.warn('[usage-service] onUpdate 回调出错:', error && error.message);
    }
  }

  function detectActivity(stats, live) {
    const next = {
      ccswitch: timeOf(stats && stats.ok && stats.latest ? stats.latest.at : null),
      live: timeOf(live && live.ok ? live.lastActivityAt : null)
    };
    const prev = marks;
    marks = next;
    if (!prev) return null;
    if (next.live > prev.live) return 'codex-live';
    if (next.ccswitch > prev.ccswitch) return 'ccswitch';
    return null;
  }

  function refreshBalances(signature) {
    if (!balanceFlight) {
      balanceFlight = (async () => {
        try {
          const result = await queryBalances({ dbPath });
          balances = {
            codex: mergeBalance(balances.codex, result.codex),
            claude: mergeBalance(balances.claude, result.claude),
            checkedAt: new Date().toISOString(),
            pending: false,
            error: result.error || null
          };
        } catch (error) {
          balances = { ...balances, pending: false, error: String((error && error.message) || error) };
        } finally {
          lastBalanceAt = Date.now();
          balanceSignature = signature;
          balanceFlight = null;
        }
      })();
    }
    return balanceFlight;
  }

  async function refresh({ forceBalance = false } = {}) {
    const stats = readCcSwitchStats({ dbPath });
    const live = readCodexLiveSession({ codexHome });
    const reason = detectActivity(stats, live);
    const signature = providerSignature(stats);
    const age = Date.now() - lastBalanceAt;
    const needBalance =
      Boolean(balanceFlight) ||
      !lastBalanceAt ||
      age >= balanceTtlMs ||
      (forceBalance && age >= BALANCE_FORCE_MIN_MS) ||
      (stats.ok && balanceSignature !== null && signature !== balanceSignature); // CC Switch 切换了供应商

    snapshot = { updatedAt: new Date().toISOString(), stats, live, balances: { ...balances, pending: needBalance } };
    emit();

    if (needBalance) {
      await refreshBalances(signature);
      snapshot = { ...snapshot, balances: { ...balances, pending: false } };
      emit();
    }

    if (reason && typeof onActivity === 'function' && Date.now() - lastActivityEmit >= activityMinIntervalMs) {
      lastActivityEmit = Date.now();
      try {
        onActivity(snapshot, { reason });
      } catch (error) {
        console.warn('[usage-service] onActivity 回调出错:', error && error.message);
      }
    }
    return snapshot;
  }

  function safeRefresh(options) {
    return refresh(options).catch((error) => {
      console.warn('[usage-service] 刷新失败:', error && error.message);
      return snapshot;
    });
  }

  function start(intervalMs = 30000) {
    stop();
    safeRefresh();
    timer = setInterval(() => safeRefresh(), Math.max(5000, Number(intervalMs) || 30000));
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function balanceLine() {
    const seen = new Set();
    const parts = [];
    for (const item of [snapshot.balances.codex, snapshot.balances.claude]) {
      if (!item || !item.ok || item.remaining === null || item.remaining === undefined) continue;
      const text = `${clipWidth(item.provider, 5)} ${formatMoney(item.remaining, item.currency || item.unit)}`;
      if (seen.has(text)) continue;
      seen.add(text);
      parts.push(text);
    }
    if (parts.length) return parts.join(' · ');
    if (snapshot.balances.pending) return '余额同步中…';
    const failed = [snapshot.balances.codex, snapshot.balances.claude].find((item) => item && !item.ok);
    return failed ? `余额：${failed.status}` : '';
  }

  /** 桌宠气泡摘要：≤ 4 行，每行尽量 ≤ 18 个汉字宽 */
  function bubbleText() {
    const { stats, live } = snapshot;
    if (!stats) return '守岸人正在读取用量…';
    const lines = [];
    if (!stats.ok) {
      lines.push('CC Switch 数据暂不可用');
      lines.push(clipWidth(stats.error || '稍后再试', 18));
    } else {
      const today = stats.periods.today;
      if (today.requests > 0) {
        lines.push(`今日 ${formatTokens(today.total)} tokens · ${today.requests} 次`);
        const allUnpriced = today.costUsd <= 0 && today.unpricedRequests >= today.requests;
        const cost = allUnpriced ? '花费 未计价' : `花费 ${formatMoney(today.costUsd, 'USD')}`;
        lines.push(`${cost} · 缓存 ${Math.round(today.cacheHitRate * 100)}%`);
      } else {
        lines.push('今天还没有用量记录');
      }
    }
    if (live && live.ok) {
      lines.push(`上下文 ${Math.round(live.contextPercent)}% · 会话 ${formatTokens(live.threadTotal)}`);
    }
    const balance = balanceLine();
    if (balance) lines.push(clipWidth(balance, 18));
    return lines.slice(0, 4).join('\n');
  }

  return {
    start,
    stop,
    refresh: safeRefresh,
    getSnapshot: () => snapshot,
    bubbleText
  };
}

module.exports = { createUsageService, formatTokens, formatMoney };
