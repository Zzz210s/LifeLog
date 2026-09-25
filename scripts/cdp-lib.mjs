// dev 验收脚本共用的 CDP 公共件(极简客户端 / 页面发现 / 结果记录)。
// 依赖 Node 22+ 自带的全局 WebSocket 与 fetch;前置:以调试端口启动 pnpm tauri dev。
// 端口默认 9222,可用 LIFELOG_CDP_PORT 覆盖(同一台机器上别的调试会话占用 9222 时用得上)。
import { os } from './cdp-os.mjs';

export const CDP_PORT = Number(process.env.LIFELOG_CDP_PORT ?? 9222);
export const BASE = `http://127.0.0.1:${CDP_PORT}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 轮询直到 fn() 返回真值(返回该值)或超时(返回 null)。
 * 用于界面异步收敛(查询/刷新/广播)后再读断言值,避免固定 sleep 偶发读到中间态。
 */
export async function waitFor(fn, tries = 16, gap = 250) {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    await sleep(gap);
  }
  return null;
}

export async function pages() {
  const list = await (await fetch(`${BASE}/json/list`)).json();
  return list.filter((p) => p.type === 'page');
}

/** 极简 CDP 客户端(单连接,顺序请求) */
export class Cdp {
  static id = 0;
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.events = [];
    const onMsg = (raw) => {
      const m = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        this.events.push(m);
      }
    };
    if (ws.on) ws.on('message', onMsg);
    else ws.addEventListener('message', (e) => onMsg(e.data));
  }
  send(method, params = {}) {
    const id = ++Cdp.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

/** 主窗外壳已挂载的判定:齿轮(信息流态)或 返回信息流(设置态)任一存在,即可安全点交互 */
const SHELL_READY = `(() => {
  const gear = document.querySelector('button[aria-label="设置"]');
  const back = Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === '返回信息流');
  return !!(gear || back);
})()`;

/**
 * 连接页面:kind = 'main'(拾枝 主窗) | 'input'(输入栏)。
 * 主窗判定:非 input.html 且来源为 dev(5173) 或 release(tauri.localhost),优先 title 为 拾枝。
 */
export async function open(kind) {
  const list = await pages();
  const isMain = (p) => !p.url.includes('input.html') && (p.url.includes('5173') || p.url.includes('tauri.localhost'));
  const target =
    kind === 'input'
      ? list.find((p) => p.url.includes('input.html'))
      : list.find((p) => isMain(p) && p.title === '拾枝') || list.find(isMain);
  if (!target) {
    throw new Error(`未找到 ${kind} 页面;当前页面:` + list.map((p) => `${p.title}|${p.url}`).join(', '));
  }
  if (!globalThis.WebSocket) throw new Error('需要 Node 22+ 的全局 WebSocket');
  const ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  return { cdp, target, close: () => cdp.close() };
}

/**
 * 冷启动前置:主窗(标签 main)改为运行时按需创建后,启动后 CDP 里只有输入栏,
 * 「第一件事就 open('main')」的脚本会直接抛错。这里统一兜底:先直接连;连不到就等托盘图标就绪、
 * 点「打开主窗口」再轮询重试(托盘交互偶发落空,故最多试 3 次);最后等主窗外壳挂载。
 * 幂等 —— 已有 main 目标时就是一次普通 open。
 */
export async function ensureMain(opts = {}) {
  const existing = await open('main').catch(() => null);
  let conn = existing;
  if (!conn) {
    const pid = opts.pid ?? os.pidOf();
    if (!pid) throw new Error('冷启动下没有 main 页面,且取不到 LifeLog 进程 pid(先以 9222 调试端口启动 pnpm tauri dev)');
    console.log(`INFO 冷启动没有 main 页面:经托盘「打开主窗口」创建(pid=${pid})`);
    await waitFor(() => os.trayReady(pid), 20, 250); // 启动初期托盘图标可能尚未注册
    for (let i = 0; i < (opts.pickTries ?? 3) && !conn; i++) {
      const pick = os.pickTray(pid, 2);
      conn = await waitFor(() => open('main').catch(() => null), opts.tries ?? 30, opts.gap ?? 250);
      if (!conn) console.log(`WARN 第 ${i + 1} 次托盘「打开主窗口」未生效,重试:` + String(pick.stdout || '').trim().slice(0, 160));
    }
    if (!conn) throw new Error('托盘「打开主窗口」后仍未出现 main 页面:检查 dev 是否在 9222 上运行、托盘菜单第 2 项是否仍为「打开主窗口」');
  }
  const shell = await waitFor(() => conn.cdp.eval(SHELL_READY).catch(() => false), opts.readyTries ?? 40, opts.readyGap ?? 250);
  if (!shell) console.log('WARN 主窗外壳标志(设置齿轮/返回信息流)未在超时内出现,后续交互可能落空');
  return conn;
}

// 记录器 / 条件字面量 / 时间标签根 / 主窗绑定件已拆到 cdp-report.mjs(守 200 行红线);
// 这里再导出一次,调用方 import 路径不变。
export { recorder, F, conditions, timeTagRoot, bindMain } from './cdp-report.mjs';
