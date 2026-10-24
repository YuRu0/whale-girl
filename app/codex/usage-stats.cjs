'use strict';
/**
 * CC Switch 用量统计数据层（只读，独立于旧桥接器）。
 *
 * 数据源：%USERPROFILE%\.cc-switch\cc-switch.db
 *   - proxy_request_logs  逐请求记录（created_at = unix 秒）
 *   - usage_daily_rollups CC Switch 归档后的旧日汇总；按「应用 + 日期」与原始日志去重后并入
 *   - providers           当前供应商；对外只给名称/模型/主机，密钥只在 queryBalances 内部使用
 *
 * Token 口径（2026-10-22 用「cache_read_tokens > input_tokens 的行数」核实）：
 *   - Codex（codex_session）的 input_tokens 已包含缓存读取：3324 行里 0 行 cache_read > input；
 *   - Claude（session_log）、OpenCode 与 rollups（semantics = 2）的 input_tokens 不含缓存。
 *   fresh  = 含缓存口径 ? input - cacheRead : input
 *   prompt = fresh + cacheRead + cacheWrite；total = prompt + output；命中率 = cacheRead / prompt
 *   成本取 CC Switch 记录的 total_cost_usd；未定价模型记为 0，并计入 unpricedRequests，不做估算。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const DEFAULT_DB = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
const DEFAULT_CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const KNOWN_APPS = ['codex', 'claude', 'opencode'];
const PERIOD_KEYS = ['today', 'd7', 'month', 'all'];
const LIVE_TAIL_BYTES = 4 * 1024 * 1024;
const SESSION_DAY_DIRS = 14;
const SCRIPT_TIMEOUT_MS = 1000;

// ---------- 通用工具 ----------

let sqliteModule = null;
function loadSqlite() {
  if (!sqliteModule) sqliteModule = require('node:sqlite');
  return sqliteModule;
}

const pad2 = (n) => String(n).padStart(2, '0');

function localDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 6) {
  const f = 10 ** digits;
  return Math.round(toNumber(value) * f) / f;
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(text) {
  if (!text || typeof text !== 'string') return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function openDb(dbPath) {
  if (!fs.existsSync(dbPath)) {
    const error = new Error('未找到 CC Switch 数据库');
    error.code = 'ENOENT';
    throw error;
  }
  const { DatabaseSync } = loadSqlite();
  return new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
}

function withDb(dbPath, fn) {
  const db = openDb(dbPath);
  try {
    return fn(db);
  } finally {
    try { db.close(); } catch { /* 已关闭 */ }
  }
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function describeDbError(error) {
  const text = String((error && error.message) || error || '');
  if (error && error.code === 'ENOENT') return '未找到 CC Switch 数据库';
  if (/SQLITE_BUSY|database is locked/i.test(text)) return 'CC Switch 正在写入数据库，稍后自动重试';
  if (/no such table/i.test(text)) return 'CC Switch 数据库结构不兼容';
  if (/node:sqlite|No such built-in module/i.test(text)) return '当前运行环境不支持 SQLite';
  return text.slice(0, 120) || '读取 CC Switch 数据失败';
}

// ---------- SQL 片段（原始日志与 rollups 字段同名，共用） ----------

// created_at 理论上是秒；万一某版本写成毫秒，统一折算成秒
const TS = '(CASE WHEN created_at > 100000000000 THEN created_at / 1000 ELSE created_at END)';
const SEM = 'COALESCE(input_token_semantics, 0)';
const IN_T = 'COALESCE(input_tokens, 0)';
const CR_T = 'COALESCE(cache_read_tokens, 0)';
const CW_T = 'COALESCE(cache_creation_tokens, 0)';
const OUT_T = 'COALESCE(output_tokens, 0)';
const COST = 'COALESCE(CAST(total_cost_usd AS REAL), 0)';
// 含缓存口径：semantics = 1，或旧数据（semantics = 0）里 OpenAI 风格的 Codex / Gemini 记录。
// 标为含缓存却出现 cache_read > input（物理上不可能）时按不含缓存处理，避免 fresh 被压成 0。
const INCLUSIVE = `(${SEM} = 1 OR (${SEM} = 0 AND app_type IN ('codex', 'gemini')))`;
const FRESH = `(CASE WHEN ${INCLUSIVE} AND ${CR_T} <= ${IN_T} THEN ${IN_T} - ${CR_T} ELSE ${IN_T} END)`;
const HAS_TOKENS = `((${IN_T} + ${OUT_T} + ${CR_T} + ${CW_T}) > 0)`;
const APP = "COALESCE(NULLIF(app_type, ''), 'other')";
const MODEL = "COALESCE(NULLIF(model, ''), NULLIF(request_model, ''), 'unknown')";

const RAW_GROUPS_SQL = `
  SELECT date(${TS} + ?, 'unixepoch') AS day, ${APP} AS app, ${MODEL} AS model,
         COUNT(*) AS requests,
         SUM(${FRESH}) AS fresh, SUM(${CR_T}) AS cacheRead, SUM(${CW_T}) AS cacheWrite,
         SUM(${OUT_T}) AS output, SUM(${COST}) AS cost,
         SUM(CASE WHEN ${COST} <= 0 AND ${HAS_TOKENS} THEN 1 ELSE 0 END) AS unpriced
    FROM proxy_request_logs
   GROUP BY day, app, model`;

const ROLLUP_GROUPS_SQL = `
  SELECT date AS day, ${APP} AS app, ${MODEL} AS model,
         SUM(COALESCE(request_count, 0)) AS requests,
         SUM(${FRESH}) AS fresh, SUM(${CR_T}) AS cacheRead, SUM(${CW_T}) AS cacheWrite,
         SUM(${OUT_T}) AS output, SUM(${COST}) AS cost,
         SUM(CASE WHEN ${COST} <= 0 AND ${HAS_TOKENS} THEN COALESCE(request_count, 0) ELSE 0 END) AS unpriced
    FROM usage_daily_rollups
   WHERE date IS NOT NULL AND date <> ''
   GROUP BY day, app, model`;

function normalizeGroup(row) {
  const group = {
    day: String(row.day || ''),
    app: String(row.app || 'other'),
    model: String(row.model || 'unknown'),
    requests: toNumber(row.requests),
    fresh: toNumber(row.fresh),
    cacheRead: toNumber(row.cacheRead),
    cacheWrite: toNumber(row.cacheWrite),
    output: toNumber(row.output),
    cost: toNumber(row.cost),
    unpriced: toNumber(row.unpriced)
  };
  group.total = group.fresh + group.cacheRead + group.cacheWrite + group.output;
  return group;
}

// ---------- 汇总 ----------

function emptyAppTotals() {
  return { requests: 0, total: 0, costUsd: 0, unpricedRequests: 0 };
}

function summarize(groups, sessions) {
  const totals = { requests: 0, fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0, unpricedRequests: 0 };
  const byApp = {};
  for (const app of KNOWN_APPS) byApp[app] = emptyAppTotals();
  for (const g of groups) {
    totals.requests += g.requests;
    totals.fresh += g.fresh;
    totals.cacheRead += g.cacheRead;
    totals.cacheWrite += g.cacheWrite;
    totals.output += g.output;
    totals.costUsd += g.cost;
    totals.unpricedRequests += g.unpriced;
    const app = byApp[g.app] || (byApp[g.app] = emptyAppTotals());
    app.requests += g.requests;
    app.total += g.total;
    app.costUsd += g.cost;
    app.unpricedRequests += g.unpriced;
  }
  for (const app of Object.values(byApp)) app.costUsd = round(app.costUsd);
  const prompt = totals.fresh + totals.cacheRead + totals.cacheWrite;
  return {
    requests: totals.requests,
    fresh: totals.fresh,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    output: totals.output,
    total: prompt + totals.output,
    costUsd: round(totals.costUsd),
    cacheHitRate: prompt > 0 ? totals.cacheRead / prompt : 0,
    sessions: toNumber(sessions),
    unpricedRequests: totals.unpricedRequests,
    byApp
  };
}

function rankModels(groups, periodTotal, limit = 8) {
  const map = new Map();
  for (const g of groups) {
    const key = `${g.app}\u0000${g.model}`;
    const item = map.get(key) || { model: g.model, app: g.app, requests: 0, total: 0, costUsd: 0, unpricedRequests: 0 };
    item.requests += g.requests;
    item.total += g.total;
    item.costUsd += g.cost;
    item.unpricedRequests += g.unpriced;
    map.set(key, item);
  }
  return [...map.values()]
    .filter((item) => item.total > 0 || item.requests > 0)
    .sort((a, b) => b.total - a.total || b.requests - a.requests)
    .slice(0, limit)
    .map((item) => ({ ...item, costUsd: round(item.costUsd), share: periodTotal > 0 ? item.total / periodTotal : 0 }));
}

function emptyPeriods() {
  const periods = {};
  for (const key of PERIOD_KEYS) periods[key] = summarize([], 0);
  return periods;
}

function emptyHeatmap(at) {
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const dates = [];
  for (let i = 6; i >= 0; i -= 1) dates.push(localDateKey(addDays(today, -i)));
  return { days: dates.map((d) => d.slice(5)), dates, cells: dates.map(() => new Array(24).fill(0)), max: 0 };
}

function emptyDaily(today) {
  const daily = [];
  for (let i = 29; i >= 0; i -= 1) {
    daily.push({ date: localDateKey(addDays(today, -i)), requests: 0, total: 0, costUsd: 0, byApp: { codex: 0, claude: 0, opencode: 0 } });
  }
  return daily;
}

function collectStats(db, at) {
  const offsetSec = -at.getTimezoneOffset() * 60;
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const d7Start = addDays(today, -6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const dayKeys = { today: localDateKey(today), d7: localDateKey(d7Start), month: localDateKey(monthStart) };
  const startSec = {
    today: Math.floor(today.getTime() / 1000),
    d7: Math.floor(d7Start.getTime() / 1000),
    month: Math.floor(monthStart.getTime() / 1000),
    all: 0
  };
  const inPeriod = {
    today: (day) => day === dayKeys.today,
    d7: (day) => day >= dayKeys.d7,
    month: (day) => day >= dayKeys.month,
    all: () => true
  };

  const raw = db.prepare(RAW_GROUPS_SQL).all(offsetSec).map(normalizeGroup);
  // rollups 是 CC Switch 压缩掉的旧日志：只并入「早于该应用第一天原始日志」的日期，避免与原始日志重复计算
  const firstRawDay = {};
  for (const g of raw) {
    if (!firstRawDay[g.app] || g.day < firstRawDay[g.app]) firstRawDay[g.app] = g.day;
  }
  let rollups = [];
  if (tableExists(db, 'usage_daily_rollups')) {
    rollups = db
      .prepare(ROLLUP_GROUPS_SQL)
      .all()
      .map(normalizeGroup)
      .filter((g) => !firstRawDay[g.app] || g.day < firstRawDay[g.app]);
  }
  const groups = raw.concat(rollups);

  const sessionStmt = db.prepare(
    `SELECT COUNT(DISTINCT session_id) AS n FROM proxy_request_logs WHERE ${TS} >= ? AND session_id IS NOT NULL AND session_id <> ''`
  );
  const periods = {};
  const models = {};
  for (const key of PERIOD_KEYS) {
    const selected = groups.filter((g) => inPeriod[key](g.day));
    periods[key] = summarize(selected, (sessionStmt.get(startSec[key]) || {}).n);
    models[key] = rankModels(selected, periods[key].total);
  }

  const daily = emptyDaily(today);
  const dailyIndex = new Map(daily.map((d, i) => [d.date, i]));
  for (const g of groups) {
    const index = dailyIndex.get(g.day);
    if (index === undefined) continue;
    const day = daily[index];
    day.requests += g.requests;
    day.total += g.total;
    day.costUsd += g.cost;
    day.byApp[g.app] = (day.byApp[g.app] || 0) + g.total;
  }
  for (const day of daily) day.costUsd = round(day.costUsd);

  const heatmap = emptyHeatmap(at);
  const heatRows = db
    .prepare(
      `SELECT date(${TS} + ?, 'unixepoch') AS day, CAST(strftime('%H', ${TS} + ?, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS n
         FROM proxy_request_logs WHERE ${TS} >= ? GROUP BY day, hour`
    )
    .all(offsetSec, offsetSec, startSec.d7);
  for (const row of heatRows) {
    const di = heatmap.dates.indexOf(String(row.day));
    const hour = toNumber(row.hour);
    if (di < 0 || hour < 0 || hour > 23) continue;
    heatmap.cells[di][hour] += toNumber(row.n);
    heatmap.max = Math.max(heatmap.max, heatmap.cells[di][hour]);
  }

  const latestRow = db
    .prepare(
      `SELECT ${TS} AS ts, ${APP} AS app, ${MODEL} AS model, ${FRESH} AS fresh, ${CR_T} AS cr, ${CW_T} AS cw, ${OUT_T} AS out, ${COST} AS cost
         FROM proxy_request_logs ORDER BY created_at DESC LIMIT 1`
    )
    .get();
  const latest = latestRow
    ? {
        at: new Date(toNumber(latestRow.ts) * 1000).toISOString(),
        app: String(latestRow.app),
        model: String(latestRow.model),
        total: toNumber(latestRow.fresh) + toNumber(latestRow.cr) + toNumber(latestRow.cw) + toNumber(latestRow.out),
        output: toNumber(latestRow.out),
        costUsd: round(latestRow.cost)
      }
    : null;

  return { periods, daily, heatmap, models, latest, providers: readProviderInfo(db) };
}

/**
 * 同步读取 CC Switch 用量统计。
 * @param {{ dbPath?: string, now?: Date|number }} [options]
 */
function readCcSwitchStats({ dbPath = DEFAULT_DB, now = new Date() } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const base = { dbPath, generatedAt: new Date().toISOString() };
  try {
    return { ok: true, ...base, ...withDb(dbPath, (db) => collectStats(db, at)) };
  } catch (error) {
    const today = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    return {
      ok: false,
      error: describeDbError(error),
      ...base,
      periods: emptyPeriods(),
      daily: emptyDaily(today),
      heatmap: emptyHeatmap(at),
      models: { today: [], d7: [], month: [], all: [] },
      latest: null,
      providers: { codex: null, claude: null }
    };
  }
}
// ---------- 供应商（公开信息不含密钥） ----------

function parseTomlScalar(raw) {
  const text = String(raw).trim();
  if (text.startsWith('"')) {
    const m = text.match(/^"((?:[^"\\]|\\.)*)"/);
    return m ? m[1].replace(/\\(["\\])/g, '$1') : '';
  }
  if (text.startsWith("'")) {
    const m = text.match(/^'([^']*)'/);
    return m ? m[1] : '';
  }
  return text.replace(/\s+#.*$/, '').trim();
}

/** 只解析 Codex config.toml 里用得到的 key = 标量（足够取 model / model_provider / base_url） */
function parseCodexToml(text) {
  const top = {};
  const sections = {};
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (header) {
      current = header[1].replace(/["']/g, '');
      sections[current] = sections[current] || {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.\-"']+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].replace(/["']/g, '');
    const target = current === null ? top : sections[current];
    if (!(key in target)) target[key] = parseTomlScalar(kv[2]);
  }
  return { top, sections };
}

function configText(config) {
  if (!config) return '';
  if (typeof config === 'string') return config;
  if (typeof config === 'object') {
    // 兼容 CC Switch 偶见的「逐字符对象」序列化
    const values = Object.values(config);
    if (values.length && values.every((v) => typeof v === 'string' && v.length <= 2)) return values.join('');
  }
  return '';
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function firstString(values) {
  for (const value of values) {
    const s = str(value);
    if (s) return s;
  }
  return '';
}

function selectProviderRow(db, app) {
  const row = db
    .prepare('SELECT * FROM providers WHERE app_type = ? AND is_current = 1 ORDER BY rowid DESC LIMIT 1')
    .get(app);
  if (row) return row;
  // 兜底：CC Switch 的 settings.json 记录了当前供应商 id
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(path.dirname(DEFAULT_DB), 'settings.json'), 'utf8'));
    const id = app === 'codex' ? settings.currentProviderCodex : app === 'claude' ? settings.currentProviderClaude : null;
    if (id) return db.prepare('SELECT * FROM providers WHERE id = ? AND app_type = ? LIMIT 1').get(id, app) || null;
  } catch { /* 没有 settings.json */ }
  return null;
}

/** 内部行：含密钥，只在本模块里用于余额查询，绝不对外返回 */
function readProviderRow(db, app) {
  if (!tableExists(db, 'providers')) return null;
  const row = selectProviderRow(db, app);
  if (!row) return null;
  const settings = parseJson(row.settings_config);
  const meta = parseJson(row.meta);
  const script = meta.usage_script && typeof meta.usage_script === 'object' ? meta.usage_script : {};
  let baseUrl = '';
  let model = '';
  let apiKey = '';
  if (app === 'codex') {
    const toml = parseCodexToml(configText(settings.config));
    const providerKey = toml.top.model_provider;
    const providerSection = providerKey ? toml.sections[`model_providers.${providerKey}`] : null;
    const anySection = Object.entries(toml.sections).find(([name, sec]) => name.startsWith('model_providers.') && sec.base_url);
    baseUrl = firstString([providerSection && providerSection.base_url, anySection && anySection[1].base_url, toml.top.base_url]);
    model = str(toml.top.model);
    const auth = settings.auth && typeof settings.auth === 'object' ? settings.auth : {};
    apiKey = firstString([auth.OPENAI_API_KEY, ...Object.values(auth)]);
  } else {
    const env = settings.env && typeof settings.env === 'object' ? settings.env : {};
    baseUrl = str(env.ANTHROPIC_BASE_URL);
    model = firstString([env.ANTHROPIC_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL]);
    apiKey = firstString([env.ANTHROPIC_AUTH_TOKEN, env.ANTHROPIC_API_KEY]);
  }
  const host = hostOf(baseUrl);
  return {
    id: String(row.id),
    app,
    name: str(row.name) || '未命名供应商',
    category: str(row.category),
    model: model || null,
    baseUrl,
    host,
    isDeepSeekOfficial: host === 'api.deepseek.com' || host.endsWith('.deepseek.com'),
    apiKey,
    script,
    scriptCode: str(script.code)
  };
}

function publicProvider(row) {
  if (!row) return null;
  return {
    name: row.name,
    model: row.model,
    host: row.host || null,
    isDeepSeekOfficial: row.isDeepSeekOfficial,
    usageScript: {
      enabled: Boolean(row.script.enabled),
      templateType: str(row.script.templateType) || null,
      hasCode: Boolean(row.scriptCode)
    }
  };
}

function readProviderInfo(db) {
  return { codex: publicProvider(readProviderRow(db, 'codex')), claude: publicProvider(readProviderRow(db, 'claude')) };
}

// ---------- 余额 / 剩余额度 ----------

class UserFacingError extends Error {}

function redact(text, secrets = []) {
  let out = String(text || '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 6) out = out.split(secret).join('***');
  }
  return out
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer ***')
    .replace(/\b(sk|ak|pk|key|token)([-_])[A-Za-z0-9_\-]{8,}/gi, '$1$2***');
}

function httpError(status) {
  if (status === 401 || status === 403) return new UserFacingError(`密钥无效或无权限（HTTP ${status}）`);
  if (status === 404) return new UserFacingError('额度接口不存在（HTTP 404）');
  if (status === 429) return new UserFacingError('请求过于频繁（HTTP 429）');
  if (status >= 500) return new UserFacingError(`服务端暂时不可用（HTTP ${status}）`);
  return new UserFacingError(`额度接口返回 HTTP ${status}`);
}

function friendlyError(error, secrets) {
  if (!error) return '查询失败';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return '额度接口超时';
  if (error instanceof UserFacingError) return redact(error.message, secrets);
  const code = error.cause && error.cause.code;
  if (code) return `网络不可达（${code}）`;
  if (/fetch failed/i.test(String(error.message))) return '网络请求失败';
  return redact(String(error.message || error), secrets).slice(0, 100) || '查询失败';
}

async function queryDeepSeekBalance(row, timeoutMs) {
  if (!row.apiKey) throw new UserFacingError('当前供应商未配置 API Key');
  const response = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: `Bearer ${row.apiKey}`, Accept: 'application/json', 'User-Agent': 'whalegirl-usage/1.0' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw httpError(response.status);
  const body = await response.json();
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : [];
  const wallet = infos.find((item) => item && item.currency === 'CNY') || infos[0];
  if (!wallet) throw new UserFacingError('DeepSeek 未返回余额信息');
  const currency = str(wallet.currency) || 'CNY';
  const available = body.is_available !== false;
  return {
    ok: available,
    kind: 'deepseek',
    remaining: numberOrNull(wallet.total_balance),
    currency,
    unit: currency,
    granted: numberOrNull(wallet.granted_balance),
    toppedUp: numberOrNull(wallet.topped_up_balance),
    status: available ? '余额已同步' : 'DeepSeek 余额不足，账户暂不可用'
  };
}

function escapeJsString(value) {
  const map = { '\\': '\\\\', "'": "\\'", '"': '\\"', '`': '\\`', $: '\\$', '\n': '\\n', '\r': '\\r', '\u2028': '\\u2028', '\u2029': '\\u2029' };
  return String(value || '').replace(/[\\'"`$\n\r\u2028\u2029]/g, (c) => map[c]);
}

function runInSandbox(code, context) {
  try {
    return vm.runInContext(code, context, { timeout: SCRIPT_TIMEOUT_MS, displayErrors: false });
  } catch (error) {
    const reason = /timed out/i.test(String(error && error.message)) ? '执行超时' : String((error && error.message) || error);
    throw new UserFacingError(`额度脚本执行失败：${reason}`);
  }
}

/** 按 CC Switch 的约定执行用量脚本：({ request, extractor })；脚本在无 require/process 的 vm 上下文里求值 */
async function queryByUsageScript(row, timeoutMs) {
  const script = row.script;
  const vars = {
    baseUrl: firstString([script.baseUrl, row.baseUrl]),
    apiKey: firstString([script.apiKey, row.apiKey]),
    accessToken: str(script.accessToken),
    userId: str(script.userId)
  };
  const source = row.scriptCode
    .replace(/\{\{\s*(baseUrl|apiKey|accessToken|userId)\s*\}\}/g, (_, key) => escapeJsString(vars[key]))
    .trim()
    .replace(/;+\s*$/, '');
  // 无原型的沙箱对象：脚本拿不到宿主侧的 Object / Function，也无法 eval 出新代码
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate'
  });
  runInSandbox(`globalThis.__def = (\n${source}\n);`, context);
  const requestJson = runInSandbox('JSON.stringify(globalThis.__def && globalThis.__def.request)', context);
  const hasExtractor = runInSandbox('typeof (globalThis.__def && globalThis.__def.extractor)', context) === 'function';
  const request = parseJson(requestJson);
  const url = str(request.url);
  if (!/^https?:\/\//i.test(url) || !hasExtractor) throw new UserFacingError('额度脚本格式不受支持');

  const method = (str(request.method) || 'GET').toUpperCase();
  const headers = {};
  if (request.headers && typeof request.headers === 'object') {
    for (const [key, value] of Object.entries(request.headers)) headers[key] = String(value);
  }
  if (!Object.keys(headers).some((key) => key.toLowerCase() === 'accept')) headers.Accept = 'application/json';
  let body;
  if (method !== 'GET' && method !== 'HEAD' && request.body !== undefined && request.body !== null) {
    body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
  }
  const scriptTimeout = toNumber(script.timeout) > 0 ? toNumber(script.timeout) * 1000 : timeoutMs;
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(Math.min(timeoutMs, scriptTimeout)) });
  if (!response.ok) throw httpError(response.status);
  const text = await response.text();
  try {
    JSON.parse(text);
  } catch {
    throw new UserFacingError('额度接口返回的不是 JSON');
  }
  context.__respText = text;
  const resultJson = runInSandbox('JSON.stringify(globalThis.__def.extractor(JSON.parse(globalThis.__respText)))', context);
  let result = parseJsonValue(resultJson);
  if (Array.isArray(result)) result = result.find((item) => item && item.isValid !== false) || result[0];
  if (!result || typeof result !== 'object') throw new UserFacingError('额度脚本没有返回结果');

  const unit = str(result.unit) || 'USD';
  const remaining = numberOrNull(result.remaining);
  const common = { kind: 'script', remaining, currency: unit, unit, total: numberOrNull(result.total), used: numberOrNull(result.used), planName: str(result.planName) || null };
  if (result.isValid === false) return { ok: false, ...common, status: str(result.invalidMessage) || '额度接口报告密钥无效' };
  if (remaining === null) return { ok: false, ...common, status: '额度接口未返回剩余额度' };
  return { ok: true, ...common, status: '额度已同步' };
}

function parseJsonValue(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function balanceFor(row, timeoutMs) {
  const base = { provider: row.name, checkedAt: new Date().toISOString() };
  const kind = row.isDeepSeekOfficial ? 'deepseek' : row.script.enabled && row.scriptCode ? 'script' : 'none';
  try {
    if (kind === 'deepseek') return { ...base, ...(await queryDeepSeekBalance(row, timeoutMs)) };
    if (kind === 'script') return { ...base, ...(await queryByUsageScript(row, timeoutMs)) };
    return {
      ...base,
      ok: false,
      kind: 'none',
      remaining: null,
      currency: null,
      unit: null,
      status: row.category === 'official' ? '官方账号，无余额接口' : 'CC Switch 未配置额度查询'
    };
  } catch (error) {
    return { ...base, ok: false, kind, remaining: null, currency: null, unit: null, status: friendlyError(error, [row.apiKey, row.script.apiKey, row.script.accessToken]) };
  }
}

/**
 * 查询 CC Switch 当前 Codex / Claude 供应商的余额或剩余额度。
 * 先同步读完供应商配置并关闭数据库，再发网络请求。
 * @param {{ dbPath?: string, timeoutMs?: number }} [options]
 */
async function queryBalances({ dbPath = DEFAULT_DB, timeoutMs = 8000 } = {}) {
  let rows;
  try {
    rows = withDb(dbPath, (db) => ({ codex: readProviderRow(db, 'codex'), claude: readProviderRow(db, 'claude') }));
  } catch (error) {
    return { codex: null, claude: null, error: describeDbError(error) };
  }
  const [codex, claude] = await Promise.all([
    rows.codex ? balanceFor(rows.codex, timeoutMs) : null,
    rows.claude ? balanceFor(rows.claude, timeoutMs) : null
  ]);
  return { codex, claude };
}
// ---------- Codex 当前会话（本地 JSONL 尾部） ----------

function listSorted(dir, pattern) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function jsonlFilesIn(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

/** 只看最近若干个 YYYY/MM/DD 目录，避免每次刷新都遍历全部历史会话 */
function newestSessionFile(sessionsRoot) {
  const candidates = jsonlFilesIn(sessionsRoot);
  let dayDirs = 0;
  outer: for (const year of listSorted(sessionsRoot, /^\d{4}$/)) {
    for (const month of listSorted(path.join(sessionsRoot, year), /^\d{2}$/)) {
      for (const day of listSorted(path.join(sessionsRoot, year, month), /^\d{2}$/)) {
        candidates.push(...jsonlFilesIn(path.join(sessionsRoot, year, month, day)));
        dayDirs += 1;
        if (dayDirs >= SESSION_DAY_DIRS) break outer;
      }
    }
  }
  let best = null;
  for (const file of candidates) {
    try {
      const stat = fs.statSync(file);
      if (!best || stat.mtimeMs > best.stat.mtimeMs) best = { file, stat };
    } catch { /* 文件刚被移走 */ }
  }
  return best;
}

function readTail(file, size, maxBytes) {
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString('utf8');
}

function usageOf(value) {
  const u = value && typeof value === 'object' ? value : {};
  return {
    input: toNumber(u.input_tokens),
    cached: toNumber(u.cached_input_tokens),
    cacheWrite: toNumber(u.cache_write_input_tokens),
    output: toNumber(u.output_tokens),
    reasoning: toNumber(u.reasoning_output_tokens),
    total: toNumber(u.total_tokens)
  };
}

/** 从尾部倒序找最后一条 token 记录 / token_count / turn_context；先做子串过滤，只解析相关行 */
function scanTail(text) {
  const found = { record: null, tokenCount: null, turnContext: null };
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    const wantRecord = !found.record && line.includes('"token_usage_record"');
    const wantCount = !found.tokenCount && line.includes('"token_count"');
    const wantContext = !found.turnContext && line.includes('"turn_context"');
    if (!wantRecord && !wantCount && !wantContext) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue; // 尾部第一行可能被截断
    }
    if (wantRecord && item.type === 'token_usage_record') found.record = item;
    if (wantCount && item.type === 'event_msg' && item.payload && item.payload.type === 'token_count' && item.payload.info) found.tokenCount = item;
    if (wantContext && item.type === 'turn_context') found.turnContext = item;
    if (found.record && found.tokenCount && found.turnContext) break;
  }
  return found;
}

function emptyLive(status, extra = {}) {
  return {
    ok: false,
    status,
    model: null,
    contextWindow: 0,
    contextTokens: 0,
    contextPercent: 0,
    threadTotal: 0,
    lastTurnTotal: 0,
    lastRequestTotal: 0,
    cachePercent: 0,
    lastActivityAt: null,
    threadId: null,
    ...extra
  };
}

/**
 * 读取 Codex 当前（最新修改）会话的上下文与 token 统计。只读最新一个 .jsonl 的末尾 4MB。
 * @param {{ codexHome?: string }} [options]
 */
function readCodexLiveSession({ codexHome = DEFAULT_CODEX_HOME } = {}) {
  try {
    const newest = newestSessionFile(path.join(codexHome, 'sessions'));
    if (!newest) return emptyLive('没有找到 Codex 会话记录');
    const found = scanTail(readTail(newest.file, newest.stat.size, LIVE_TAIL_BYTES));
    const model = str(found.turnContext && found.turnContext.payload && found.turnContext.payload.model) || null;
    const info = found.tokenCount ? found.tokenCount.payload.info : null;
    const payload = found.record ? found.record.payload || {} : null;
    const last = usageOf(payload ? payload.usage : info && info.last_token_usage);
    const thread = usageOf(payload ? payload.thread_token_usage : info && info.total_token_usage);
    const turn = usageOf(payload ? payload.turn_token_usage : null);
    const activityAt = (found.record && found.record.timestamp) || (found.tokenCount && found.tokenCount.timestamp) || newest.stat.mtime.toISOString();
    if (!payload && !info) {
      return emptyLive('新会话，等待首轮响应', { model, lastActivityAt: activityAt });
    }
    const contextWindow = toNumber(
      (info && info.model_context_window) || (found.turnContext && found.turnContext.payload && found.turnContext.payload.model_context_window)
    );
    // 与 Codex 自身口径一致：上下文 = 最近一次请求的 total - reasoning（reasoning 不留在上下文里）
    const contextTokens = Math.max(0, (last.total || last.input + last.output) - last.reasoning);
    return {
      ok: true,
      status: '会话已同步',
      model,
      contextWindow,
      contextTokens,
      contextPercent: contextWindow > 0 ? Math.min(100, (contextTokens / contextWindow) * 100) : 0,
      threadTotal: thread.total,
      lastTurnTotal: turn.total,
      lastRequestTotal: last.total,
      cachePercent: last.input > 0 ? (last.cached / last.input) * 100 : 0,
      lastActivityAt: activityAt,
      threadId: (payload && str(payload.thread_id)) || null
    };
  } catch (error) {
    return emptyLive(`读取 Codex 会话失败：${String((error && error.message) || error).slice(0, 80)}`);
  }
}

// ---------- 格式化（服务层与气泡共用） ----------

function formatTokens(value) {
  const n = toNumber(value);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

function currencySymbol(unit) {
  const u = String(unit || '').toUpperCase();
  if (u === 'CNY' || u === 'RMB') return '¥';
  if (u === 'USD') return '$';
  return '';
}

function formatMoney(value, unit = 'USD', digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const symbol = currencySymbol(unit);
  const fixed = Math.abs(n) > 0 && Math.abs(n) < 0.01 ? n.toFixed(4) : n.toFixed(digits);
  return symbol ? `${symbol}${fixed}` : `${fixed} ${unit || ''}`.trim();
}

module.exports = {
  DEFAULT_DB,
  DEFAULT_CODEX_HOME,
  readCcSwitchStats,
  queryBalances,
  readCodexLiveSession,
  formatTokens,
  formatMoney,
  currencySymbol
};
