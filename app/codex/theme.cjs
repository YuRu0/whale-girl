"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CODEX_PACKAGE_NAME = "OpenAI.Codex";
const CODEX_APP_ID = "OpenAI.Codex_2p2nqsd0c76g0!App";

// 可切换的界面主题注册表：id → 注入器 / 目录
// 每个主题自带 theme-css.cjs 与 assets/，与 id 一一对应，新增主题只需往这里加一行 + 一个目录
const THEME_IDS = ["shorekeeper", "midnight-deepseek"];
const THEME_DIRS = THEME_IDS.reduce((acc, id) => {
  acc[id] = path.join(__dirname, "themes", id);
  return acc;
}, {});
const DEEPSEEK_THEME_DIR = THEME_DIRS["midnight-deepseek"];
const DEEPSEEK_STYLE_VERSION = "deepseek-v7";

// 通用"去黑底"运行时检测（注入到 Codex 页面里执行）。
// 不同机器上的 Codex 版本不同，容器类名（如 _WorkspaceContent_etoz9_2）带版本哈希，写死选择器会失效。
// 这里在页面里实时扫描：网格采样 → 取每个点上的完整绘制栈 → 找出"大面积 + 不透明深色"的伪元素/容器
// → 打 data 标记 → 用一条 CSS 统一透明化。不依赖任何类名，换机器/换版本都成立。
const UNBLACK_JS = `
      (function () {
        var st = document.getElementById("deepseek-unblack-style");
        if (!st) { st = document.createElement("style"); st.id = "deepseek-unblack-style"; document.head.appendChild(st); }
        st.textContent =
          '[data-ds-unblack="1"]::before,[data-ds-unblack="1"]::after{' +
          'background:transparent!important;background-image:none!important;' +
          'backdrop-filter:none!important;-webkit-backdrop-filter:none!important;' +
          'box-shadow:none!important;display:none!important;}' +
          '[data-ds-unblack-self="1"]{' +
          'background-color:transparent!important;background-image:none!important;' +
          'backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}';

        function lum(c) {
          var m = String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
          if (!m) return null;
          return { l: (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3, a: m[4] === undefined ? 1 : Number(m[4]) };
        }
        // 在一串颜色（如 linear-gradient(...)）里找最暗的那个
        function darkest(s) {
          var re = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/g, m, best = null;
          while ((m = re.exec(String(s))) !== null) {
            var o = { l: (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3, a: m[4] === undefined ? 1 : Number(m[4]) };
            if (!best || o.l < best.l) best = o;
          }
          return best;
        }
        function darkSheet(cs) { // 判断一个"绘制层"是不是不透明的深色大被子
          var bg = lum(cs.backgroundColor);
          if (bg && bg.a >= 0.6 && bg.l < 62) return true;
          if (String(cs.backgroundImage || "").indexOf("gradient") >= 0) {
            var g = darkest(cs.backgroundImage);
            if (g && g.a >= 0.6 && g.l < 32) return true;
          }
          var bf = String(cs.backdropFilter || cs.webkitBackdropFilter || "");
          if (bf && bf !== "none" && bf.indexOf("brightness(0.") >= 0) return true;
          return false;
        }

        var clean = new Set(), runs = 0;

        function skip(el) {
          if (!el || el.nodeType !== 1 || clean.has(el)) return true;
          var tag = String(el.tagName || "").toUpperCase();
          if (tag === "HTML" || tag === "BODY" || tag === "SCRIPT" || tag === "STYLE") return true;
          if (el.id && String(el.id).indexOf("deepseek") === 0) return true;
          if (el.closest && el.closest("#deepseek-hud")) return true;
          if (el.hasAttribute("data-ds-unblack") || el.hasAttribute("data-ds-unblack-self")) return true;
          return false;
        }
        // 判定一个元素是不是"大面积不透明深色遮罩"，是则返回 pseudo / self / null
        function judge(el, vArea, minPct) {
          var r = el.getBoundingClientRect();
          if (r.width < 200 || r.height < 150) return null;
          if (r.width * r.height < vArea * minPct) return null;
          var mark = null;
          for (var q = 0; q < 2; q++) {
            var cs = getComputedStyle(el, q === 0 ? "::before" : "::after");
            if (!cs || cs.display === "none" || cs.content === "none" || cs.content === "normal") continue;
            if (darkSheet(cs)) { mark = "pseudo"; break; }
          }
          if (!mark) {
            var own = getComputedStyle(el);
            if (darkSheet(own)) {
              // 自身就是黑底：只在它"看起来只是个遮罩/空容器"时才动，避免误伤正常深色面板
              if (!String(el.textContent || "").trim()) mark = "self";
              else if (own.pointerEvents === "none") mark = "self";
              else if (String(own.backdropFilter || "").indexOf("brightness(0.") >= 0) mark = "self";
            }
          }
          if (mark === "self") el.setAttribute("data-ds-unblack-self", "1");
          else if (mark === "pseudo") el.setAttribute("data-ds-unblack", "1");
          else clean.add(el);
          return mark;
        }

        window.dsUnblack = function () {
          try {
            runs++;
            if (runs % 4 === 0) clean.clear(); // 每 ~16s 清一次"已判定干净"缓存，Codex 换页面/晚渲染的黑底也能及时抓到
            var vw = window.innerWidth, vh = window.innerHeight, vArea = vw * vh;
            if (!vw || !vh) return;

            // ① 网格采样：取每个采样点上的完整绘制栈（能覆盖绝大多数遮罩）
            var xs = [0.3, 0.45, 0.6, 0.75], ys = [0.25, 0.45, 0.65, 0.85];
            for (var i = 0; i < xs.length; i++) for (var j = 0; j < ys.length; j++) {
              var stack = document.elementsFromPoint(Math.round(vw * xs[i]), Math.round(vh * ys[j]));
              if (!stack) continue;
              for (var k = 0; k < stack.length; k++) {
                var el = stack[k];
                if (skip(el)) continue;
                judge(el, vArea, 0.18);
              }
            }

            // ② 低频 DOM 兜底扫描：pointer-events:none 的遮罩不会被命中测试返回，只能靠遍历找
            if (runs % 12 === 1 && document.body) {
              var all = document.body.querySelectorAll("*"), budget = 300;
              for (var n = 0; n < all.length && budget > 0; n++) {
                var e2 = all[n];
                if (skip(e2)) continue;
                var rr = e2.getBoundingClientRect();
                if (rr.width < 200 || rr.height < 150) continue;
                if (rr.width * rr.height < vArea * 0.12) continue;
                budget--;
                judge(e2, vArea, 0.12);
              }
            }
          } catch (e) {}
        };
        window.dsUnblack();
        if (window.__deepseekUnblackTimer) clearInterval(window.__deepseekUnblackTimer);
        window.__deepseekUnblackTimer = setInterval(window.dsUnblack, 4000);
      })();
`;

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  return { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4" }[ext] || "application/octet-stream";
}

// 深夜大肥鱼主题的静态配置（theme.json），Node 侧读一次缓存
let deepseekConfigCache = null;
function deepseekConfig() {
  if (deepseekConfigCache) return deepseekConfigCache;
  try {
    deepseekConfigCache = JSON.parse(fs.readFileSync(path.join(DEEPSEEK_THEME_DIR, "theme.json"), "utf8"));
  } catch {
    deepseekConfigCache = {};
  }
  return deepseekConfigCache;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url, timeoutMs = 1500) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

class CodexThemeController {
  constructor(options) {
    this.options = options;
    this.lastAppliedAt = 0;
    this.lastError = "";
    this.timer = null;
    this.running = false;
    this.debugPort = Number(options.debugPort || 9227);
    this.enabled = options.enabled !== false;
    this.activeTheme = THEME_IDS.includes(options.activeTheme) ? options.activeTheme : "midnight-deepseek";
    this.assetCache = new Map();
  }

  setOptions(options) {
    Object.assign(this.options, options);
    this.debugPort = Number(this.options.debugPort || this.debugPort || 9227);
    this.enabled = this.options.enabled !== false;
    if (THEME_IDS.includes(options.activeTheme)) this.activeTheme = options.activeTheme;
  }

  // 切换主题：清资产缓存 → 清掉旧主题的注入 → 立即重注入
  async setActiveTheme(id) {
    if (!THEME_IDS.includes(id) || id === this.activeTheme) return { ok: false, message: "主题未变化" };
    this.activeTheme = id;
    this.assetCache.clear();
    await this.removeTheme().catch(() => {});
    const result = await this.applyNow().catch((e) => ({ ok: false, message: e.message }));
    return { ok: Boolean(result && result.ok), theme: id, message: result && result.ok ? `已切换到 ${id}` : (result && result.message) || "切换失败" };
  }

  async debugEndpoint() {
    try {
      return await getJson(`http://127.0.0.1:${this.debugPort}/json/version`);
    } catch {
      return null;
    }
  }

  // 在 Codex 页面里跑一段表达式，取第一个页面的返回值（returnByValue）
  async evalInPagesValue(expression, timeoutMs = 1500) {
    let targets;
    try {
      targets = await getJson(`http://127.0.0.1:${this.debugPort}/json/list`, timeoutMs);
    } catch {
      return null;
    }
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (target) => target.type === "page" && target.webSocketDebuggerUrl
    );
    for (const page of pages) {
      try {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        let id = 0;
        const pending = new Map();
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
          }
        };
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = () => reject(new Error("CDP"));
        });
        const call = (method, params = {}) =>
          new Promise((resolve) => {
            const callId = ++id;
            pending.set(callId, resolve);
            socket.send(JSON.stringify({ id: callId, method, params }));
          });
        const result = await call("Runtime.evaluate", { expression, returnByValue: true });
        socket.close();
        const value = result && result.result && result.result.result && result.result.result.value;
        if (value !== undefined && value !== null) return value;
      } catch {
        // 换下一个页面
      }
    }
    return null;
  }

  // Codex 窗口的屏幕位置（DIP）。Electron 的 CDP 不支持 Browser.getWindowForTarget，
  // 改从页面里读 window.screenX/screenY/outerWidth/outerHeight——页面自己最清楚自己在哪。
  // 比起 PowerShell 跟踪器（冷启动慢、偶尔全程失灵），这条通路又快又稳。
  async getWindowRect(timeoutMs = 1200) {
    const raw = await this.evalInPagesValue(
      `JSON.stringify((function () { try {
        return { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight, v: document.visibilityState };
      } catch (e) { return null; } })())`,
      timeoutMs
    );
    if (!raw) return null;
    try {
      const b = JSON.parse(raw);
      if (!b) return null;
      // 最小化的窗口 Windows 会把它挪到 -32000 附近，尺寸也缩成残影，先判状态再看尺寸
      if (b.x < -20000 || b.y < -20000 || b.v === "hidden") return { state: "minimized" };
      if (!(b.w > 50) || !(b.h > 50)) return null;
      return { x: b.x, y: b.y, width: b.w, height: b.h, state: "normal" };
    } catch {
      return null;
    }
  }

  // 在 Codex 页面里跑一段返回布尔的表达式；任一页面为真即返回 true
  async evalInPages(expression, timeoutMs = 1500) {
    let targets;
    try {
      targets = await getJson(`http://127.0.0.1:${this.debugPort}/json/list`, timeoutMs);
    } catch {
      return false;
    }
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (target) => target.type === "page" && target.webSocketDebuggerUrl
    );
    for (const page of pages) {
      try {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        let id = 0;
        const pending = new Map();
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
          }
        };
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = () => reject(new Error("CDP"));
        });
        const call = (method, params = {}) =>
          new Promise((resolve) => {
            const callId = ++id;
            pending.set(callId, resolve);
            socket.send(JSON.stringify({ id: callId, method, params }));
          });
        const result = await call("Runtime.evaluate", { expression, returnByValue: true });
        socket.close();
        if (result && result.result && result.result.result && result.result.result.value === true) return true;
      } catch {
        // 换下一个页面
      }
    }
    return false;
  }

  // Codex 界面是否真的画出来了：DOM 挂载完成 + #root 有内容 + body 有实际尺寸
  // 连续两次为真才算就绪，避免首屏还在重建时提前放行动画。
  // relaxAfterMs 之后放宽 #root 判定：Codex 换版本改了 DOM 结构时不至于把动画卡死。
  async waitAppReady(timeoutMs = 45000, settleMs = 400, relaxAfterMs = 7000) {
    const strict = `(() => { try {
      if (document.readyState !== "complete") return false;
      const root = document.getElementById("root");
      if (!root || !root.firstElementChild) return false;
      const b = document.body;
      if (!b || b.offsetWidth < 400 || b.offsetHeight < 260) return false;
      if (document.visibilityState === "hidden") return false;
      return true;
    } catch (e) { return false; } })()`;
    const relaxed = `(() => { try {
      if (document.readyState !== "complete") return false;
      const b = document.body;
      if (!b || b.offsetWidth < 400 || b.offsetHeight < 260) return false;
      const root = document.getElementById("root") || b;
      return root.childElementCount > 0;
    } catch (e) { return false; } })()`;
    const startedAt = Date.now();
    let streak = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const expr = Date.now() - startedAt > relaxAfterMs ? relaxed : strict;
      const ok = await this.evalInPages(expr).catch(() => false);
      streak = ok ? streak + 1 : 0;
      if (streak >= 2) {
        this.appReadyAt = Date.now();
        return true;
      }
      await sleep(settleMs);
    }
    return false;
  }

  async isCodexRunning() {
    if (await this.debugEndpoint()) return true;
    const result = await this.options.runPowerShell(
      "(Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Measure-Object).Count",
      4000
    );
    return Number(String(result).trim()) > 0;
  }

  async launchCodex() {
    if (await this.debugEndpoint()) {
      return { ok: true, mode: "debug", message: "Codex 主题通道已连接" };
    }

    if (await this.isCodexRunning()) {
      return {
        ok: false,
        mode: "restart-required",
        message: "Codex 已在普通模式运行。关闭 Codex 后从鲸鱼娘启动器打开，才能注入主题。"
      };
    }

    const exe = await this.resolveCodexExe();
    if (!exe) {
      return { ok: false, mode: "missing", message: "未找到 Codex 桌面应用" };
    }

    this.options.spawn(exe, [`--remote-debugging-port=${this.debugPort}`], {
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    }).unref();

    for (let attempt = 0; attempt < 45; attempt += 1) {
      if (await this.debugEndpoint()) {
        return { ok: true, mode: "debug", message: "Codex 已启动并连接到主题层" };
      }
      await sleep(500);
    }
    return { ok: false, mode: "timeout", message: "Codex 已启动，但主题调试通道未就绪" };
  }

  async resolveCodexExe() {
    if (this.options.codexExe && fs.existsSync(this.options.codexExe)) {
      return this.options.codexExe;
    }
    try {
      const raw = await this.options.runPowerShell(
        "$p=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1; if($p){Join-Path $p.InstallLocation 'app\\ChatGPT.exe'}",
        6000
      );
      const candidate = String(raw).trim().replace(/\r/g, "");
      if (candidate && fs.existsSync(candidate)) {
        this.options.codexExe = candidate;
        return candidate;
      }
    } catch {
      // Fall through to the standard package activation path.
    }
    return null;
  }

  async activateCodex() {
    this.options.spawn("explorer.exe", [`shell:AppsFolder\\${CODEX_APP_ID}`], {
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    }).unref();
    setTimeout(() => this.focusCodexWindow().catch(() => {}), 450);
  }

  async focusCodexWindow() {
    // 最小化时 AppActivate 不会还原窗口，先 ShowWindow(SW_RESTORE) 再激活
    const command = [
      "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport(\"user32.dll\")] public static extern bool IsIconic(System.IntPtr h); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(System.IntPtr h);'",
      "$p = Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
      "if ($p) { $h = $p.MainWindowHandle; if ([W.U]::IsIconic($h)) { [W.U]::ShowWindow($h, 9) | Out-Null }; (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null; [W.U]::SetForegroundWindow($h) | Out-Null }"
    ].join("; ");
    await this.options.runPowerShell(command, 5000);
  }

  start() {
    if (!this.enabled || this.running) return;
    this.running = true;
    this.applyNow().catch(() => {});
    this.timer = setInterval(() => {
      this.applyNow().catch(() => {});
    }, 3500);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  // 关闭主题：从所有 Codex 页面移除注入的样式与装饰层
  async removeTheme() {
    let targets;
    try { targets = await getJson(`http://127.0.0.1:${this.debugPort}/json/list`, 2200); } catch { return; }
    const pages = (Array.isArray(targets) ? targets : []).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    for (const page of pages) {
      try {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("CDP")); });
        socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(() => {
          // 清理守岸人主题
          ["codex-whale-theme-style", "whale-theme-overlay", "shorekeeper-theme-background", "shorekeeper-theme-character"].forEach((id) => document.getElementById(id)?.remove());
          delete document.documentElement.dataset.whaleTheme; delete document.documentElement.dataset.shorekeeperTheme;
          // 清理深夜大肥鱼主题
          ["deepseek-wallpaper-style", "deepseek-wallpaper-video", "deepseek-veil", "deepseek-hud", "deepseek-clock", "deepseek-date", "deepseek-greeting", "deepseek-weather", "deepseek-unblack-style"].forEach((id) => document.getElementById(id)?.remove());
          document.querySelectorAll('[data-ds-unblack], [data-ds-unblack-self]').forEach((el) => { el.removeAttribute("data-ds-unblack"); el.removeAttribute("data-ds-unblack-self"); });
          delete document.documentElement.dataset.deepseekWallpaper;
          if (window.__deepseekClockInterval) { clearInterval(window.__deepseekClockInterval); delete window.__deepseekClockInterval; }
          if (window.__deepseekWeatherTimer) { clearTimeout(window.__deepseekWeatherTimer); delete window.__deepseekWeatherTimer; }
          if (window.__deepseekVideoKeepAlive) { clearInterval(window.__deepseekVideoKeepAlive); delete window.__deepseekVideoKeepAlive; }
          if (window.__deepseekUnblackTimer) { clearInterval(window.__deepseekUnblackTimer); delete window.__deepseekUnblackTimer; }
          return true; })()` } }));
        await sleep(300);
        socket.close();
      } catch {}
    }
  }

  async applyNow() {
    if (!this.enabled) {
      return { ok: false, message: "主题注入已关闭" };
    }
    let targets;
    try {
      targets = await getJson(`http://127.0.0.1:${this.debugPort}/json/list`, 2200);
    } catch {
      this.lastError = "主题通道未连接";
      return { ok: false, message: this.lastError };
    }
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (target) => target.type === "page" && target.webSocketDebuggerUrl
    );
    if (!pages.length) {
      this.lastError = "等待 Codex 页面";
      return { ok: false, message: this.lastError };
    }

    let applied = 0;
    for (const page of pages) {
      try {
        await this.applyToTarget(page.webSocketDebuggerUrl);
        applied += 1;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (applied > 0) {
      this.lastAppliedAt = Date.now();
      this.lastError = "";
      return { ok: true, pages: applied };
    }
    return { ok: false, message: this.lastError || "主题注入失败" };
  }

  async applyToTarget(websocketUrl) {
    const socket = new WebSocket(websocketUrl);
    let id = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    };
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error("CDP WebSocket 连接失败"));
    });
    const call = (method, params = {}) =>
      new Promise((resolve) => {
        const callId = ++id;
        pending.set(callId, resolve);
        socket.send(JSON.stringify({ id: callId, method, params }));
      });

    try {
      // 先用一条很短的探测语句确认当前主题是否已在；已在就不再重发几 MB 的 CSS/图片/视频
      const probeExpr = this.activeTheme === "midnight-deepseek"
        ? `(() => {
            const s = document.getElementById("deepseek-wallpaper-style");
            const ok = Boolean(s && s.dataset.version === "${DEEPSEEK_STYLE_VERSION}" && document.getElementById("deepseek-wallpaper-video"));
            if (ok) {
              const v = document.getElementById("deepseek-wallpaper-video");
              // 保活：视频被任何原因暂停（窗口遮挡/页面隐藏/省电策略）都立即恢复，避免停在黑帧
              if (v && v.paused) {
                v.muted = true;
                v.play().catch(() => {});
              }
            }
            return ok;
          })()`
        : `(() => { const s = document.getElementById("codex-whale-theme-style"); return Boolean(s && s.dataset.version === "shorekeeper-v4" && document.getElementById("whale-theme-overlay")); })()`;
      const probe = await call("Runtime.evaluate", {
        expression: probeExpr,
        returnByValue: true
      });
      if (probe.result?.result?.value === true) return;
      const expression = this.themeExpression();
      const result = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (result.result?.exceptionDetails) {
        throw new Error(result.result.exceptionDetails.text || "主题脚本执行失败");
      }
    } finally {
      socket.close();
    }
  }

  themeCss() {
    return require('./themes/shorekeeper/theme-css.cjs')({
      logo: this.themeAsset('shorekeeper', 'avatar.png', this.logoDataUri()),
      background: this.themeAsset('shorekeeper', 'background.png'),
      portrait: this.themeAsset('shorekeeper', 'render.png')
    });
  }

  themeExpression() {
    if (this.activeTheme === "midnight-deepseek") return this.deepseekThemeExpression();
    const css = this.themeCss();
    return `(() => {
      document.documentElement.dataset.whaleTheme = "on";
      document.documentElement.dataset.shorekeeperTheme = "on";
      let style = document.getElementById("codex-whale-theme-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "codex-whale-theme-style";
        document.head.appendChild(style);
      }
      if (style.dataset.version === "shorekeeper-v4") return {
        theme: document.documentElement.dataset.shorekeeperTheme,
        title: document.title,
        cached: true
      };
      style.textContent = ${JSON.stringify(css)};
      style.dataset.version = "shorekeeper-v4";
      let bg = document.getElementById("shorekeeper-theme-background");
      if (!bg) {
        bg = document.createElement("div");
        bg.id = "shorekeeper-theme-background";
        document.body.prepend(bg);
      }
      let portrait = document.getElementById("shorekeeper-theme-character");
      if (!portrait) {
        portrait = document.createElement("div");
        portrait.id = "shorekeeper-theme-character";
        document.body.prepend(portrait);
      }
      let overlay = document.getElementById("whale-theme-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "whale-theme-overlay";
        const scan = document.createElement("span");
        scan.className = "whale-scan";
        overlay.appendChild(scan);
        document.body.appendChild(overlay);
      }
      return {
        theme: document.documentElement.dataset.shorekeeperTheme,
        title: document.title,
        overlay: Boolean(document.getElementById("whale-theme-overlay"))
      };
    })()`;
  }

  // ───── 深夜大肥鱼主题 ─────
  // 主题资产统一入口：themes/<id>/assets/<relativePath>，读取一次后进缓存
  themeAsset(themeId, relativePath, fallback = "") {
    const key = `${themeId}:${relativePath}`;
    if (this.assetCache.has(key)) return this.assetCache.get(key);
    try {
      const file = path.join(THEME_DIRS[themeId] || "", "assets", relativePath);
      const uri = `data:${mimeOf(file)};base64,${fs.readFileSync(file).toString("base64")}`;
      this.assetCache.set(key, uri);
      return uri;
    } catch {
      return fallback;
    }
  }

  deepseekThemeExpression() {
    const config = deepseekConfig();
    const css = require("./themes/midnight-deepseek/theme-css.cjs")({
      video: "",
      poster: this.themeAsset("midnight-deepseek", "bg-poster.jpg"),
      clockSize: config.hud && config.hud.clockSize
    });
    const videoUri = this.themeAsset("midnight-deepseek", "bg-loop.mp4");
    const posterUri = this.themeAsset("midnight-deepseek", "bg-poster.jpg");
    const weatherUrl = (config.weather && config.weather.source) || "";
    const weatherCacheMs = Number((config.weather && config.weather.cacheMinutes) || 30) * 60000;
    return `(() => {
      document.documentElement.dataset.deepseekWallpaper = "on";
      let style = document.getElementById("deepseek-wallpaper-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "deepseek-wallpaper-style";
        document.head.appendChild(style);
      }
      if (style.dataset.version !== ${JSON.stringify(DEEPSEEK_STYLE_VERSION)}) {
        style.textContent = ${JSON.stringify(css)};
        style.dataset.version = ${JSON.stringify(DEEPSEEK_STYLE_VERSION)};
      }
      // 视频壁纸（强制静音：主题不发声）
      let video = document.getElementById("deepseek-wallpaper-video");
      if (!video) {
        video = document.createElement("video");
        video.id = "deepseek-wallpaper-video";
        document.body.prepend(video);
      }
      // data URI 体积大，只用 dataset 标志判断是否已加载，避免在表达式里重复内联
      if (video.dataset.dsLoaded !== "v5") {
        video.src = ${JSON.stringify(videoUri)};
        video.dataset.dsLoaded = "v5";
        video.loop = true; video.autoplay = true; video.playsInline = true;
        video.muted = true; video.volume = 0;
        video.poster = ${JSON.stringify(posterUri)};
        // 任何原因被暂停都自动恢复：窗口遮挡 / 页面隐藏 / 应用省电策略都会 pause
        video.addEventListener("pause", () => setTimeout(() => {
          if (video.paused && video.isConnected) video.play().catch(() => {});
        }, 60));
        // 元数据就绪后若还没开播，先跳过片头黑帧，让静止画面也是真实场景
        video.addEventListener("loadedmetadata", () => {
          if (video.paused && video.currentTime === 0) { try { video.currentTime = 1.2; } catch {} }
        }, { once: true });
        // 双保险保活循环：2.5s 巡检一次
        if (window.__deepseekVideoKeepAlive) clearInterval(window.__deepseekVideoKeepAlive);
        window.__deepseekVideoKeepAlive = setInterval(() => {
          if (video.paused && video.isConnected) video.play().catch(() => {});
        }, 2500);
      }
      const tryPlay = (v) => {
        const p = v.play();
        if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); });
      };
      tryPlay(video);
      // 渐晕层
      let veil = document.getElementById("deepseek-veil");
      if (!veil) {
        veil = document.createElement("div");
        veil.id = "deepseek-veil";
        document.body.insertBefore(veil, video.nextSibling);
      }
      // HUD：时钟 / 日期 / 氛围文案 / 天气
      let hud = document.getElementById("deepseek-hud");
      if (!hud) {
        hud = document.createElement("div");
        hud.id = "deepseek-hud";
        const clock = document.createElement("div"); clock.id = "deepseek-clock";
        const date = document.createElement("div"); date.id = "deepseek-date";
        const greeting = document.createElement("div"); greeting.id = "deepseek-greeting";
        const weather = document.createElement("div"); weather.id = "deepseek-weather"; weather.setAttribute("data-hidden", "1");
        hud.append(clock, date, greeting, weather);
        document.body.appendChild(hud);
      }
      const clock = document.getElementById("deepseek-clock");
      const date = document.getElementById("deepseek-date");
      const greeting = document.getElementById("deepseek-greeting");
      const pad = (n) => String(n).padStart(2, "0");
      const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      const greet = (h) => h < 5 ? "夜深了，早点休息哦" : h < 8 ? "早起的一天，从早安开始" : h < 11 ? "上午好" : h < 13 ? "中午好，记得吃点东西" : h < 18 ? "下午好" : h < 23 ? "晚上好" : "夜深了，早点休息哦";
      const tick = () => {
        const now = new Date();
        clock.innerHTML = pad(now.getHours()) + '<span class="ds-colon">:</span>' + pad(now.getMinutes());
        date.textContent = (now.getMonth() + 1) + "月" + now.getDate() + "日 · " + WEEK[now.getDay()];
        greeting.textContent = greet(now.getHours());
      };
      tick();
      if (window.__deepseekClockInterval) clearInterval(window.__deepseekClockInterval);
      window.__deepseekClockInterval = setInterval(tick, 1000);
      // 天气：open-meteo 免费接口，定时刷新，失败保持隐藏
      const WMO = [[0,"晴"],[1,"晴间多云"],[2,"多云"],[3,"阴"],[45,"雾"],[48,"雾凇"],[51,"毛毛雨"],[53,"毛毛雨"],[55,"毛毛雨"],[56,"冻毛毛雨"],[57,"冻毛毛雨"],[61,"小雨"],[63,"中雨"],[65,"大雨"],[66,"冻雨"],[67,"冻雨"],[71,"小雪"],[73,"中雪"],[75,"大雪"],[77,"雪粒"],[80,"阵雨"],[81,"阵雨"],[82,"强阵雨"],[85,"阵雪"],[86,"阵雪"],[95,"雷阵雨"],[96,"雷阵雨伴冰雹"],[99,"雷阵雨伴冰雹"]];
      const refreshWeather = () => {
        fetch(${JSON.stringify(weatherUrl)}).then((r) => r.json()).then((data) => {
          const cur = data && data.current;
          if (!cur || cur.temperature_2m == null) return;
          let label = "多云";
          for (const [c, name] of WMO) { if (cur.weather_code === c) { label = name; break; } }
          const w = document.getElementById("deepseek-weather");
          if (w) { w.textContent = label + " " + Math.round(cur.temperature_2m) + "°"; w.setAttribute("data-hidden", "0"); }
        }).catch(() => {});
        window.__deepseekWeatherTimer = setTimeout(refreshWeather, ${JSON.stringify(weatherCacheMs)});
      };
      if (!window.__deepseekWeatherTimer) refreshWeather();
      ${UNBLACK_JS}
      return { theme: "midnight-deepseek", title: document.title };
    })()`;
  }

  logoDataUri() {
    const candidates = [
      this.options.logoPath,
      this.options.petHome
        ? `${this.options.petHome}\\resources\\app\\vendor\\dsh-pet\\assets\\logo.png`
        : null
    ].filter(Boolean);
    for (const file of candidates) {
      try {
        return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
      } catch {
        // Use the embedded fallback below.
      }
    }
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Cpath d='M11 48c12-20 42-21 58-5-5 18-22 27-40 21l-14 7 4-13c-4-3-6-7-8-10Z' fill='none' stroke='%2370efff' stroke-width='3'/%3E%3C/svg%3E";
  }

  assetDataUri(relativePath, fallback = "") {
    if (this.assetCache.has(relativePath)) return this.assetCache.get(relativePath);
    try {
      const file = path.join(this.options.assetRoot || "", relativePath);
      const ext = file.toLowerCase().endsWith(".webp") ? "webp" : "png";
      const uri = `data:image/${ext};base64,${fs.readFileSync(file).toString("base64")}`;
      this.assetCache.set(relativePath, uri);
      return uri;
    } catch {
      return fallback;
    }
  }

  state() {
    return {
      enabled: this.enabled,
      running: this.running,
      debugPort: this.debugPort,
      lastAppliedAt: this.lastAppliedAt || null,
      lastError: this.lastError || ""
    };
  }
}

module.exports = {
  CodexThemeController,
  CODEX_APP_ID,
  CODEX_PACKAGE_NAME
};
