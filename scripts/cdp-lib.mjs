// dev 验收脚本共用的 CDP 公共件(极简客户端 / 页面发现 / 结果记录)。
// 依赖 Node 22+ 自带的全局 WebSocket 与 fetch;前置:以 9222 调试端口启动 pnpm tauri dev。
export const BASE = 'http://127.0.0.1:9222';
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

/**
 * 连接页面:kind = 'main'(LifeLog 主窗) | 'input'(输入栏)。
 * 主窗判定:5173 站点根且 title 为 LifeLog(改名后的页面标题),退化时取任意非 input.html 的站点页。
 */
export async function open(kind) {
  const list = await pages();
  const target =
    kind === 'input'
      ? list.find((p) => p.url.includes('input.html'))
      : list.find((p) => p.url.includes('5173') && !p.url.includes('input.html') && p.title === 'LifeLog') ||
        list.find((p) => p.url.includes('5173') && !p.url.includes('input.html'));
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

/** 逐项记录器:record(...) 打印并累计,finish() 汇总并设置退出码 */export function recorder() {
  const results = [];
  return {
    results,
    record(item, ok, detail) {
      results.push({ item, ok, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${item}  ${detail ?? ''}`);
    },
    finish() {
      console.log('\n=== 汇总 ===');
      const fails = results.filter((r) => !r.ok);
      console.log(`通过 ${results.length - fails.length}/${results.length}`);
      if (fails.length) {
        fails.forEach((f) => console.log('FAIL 明细:', f.item, f.detail));
        process.exitCode = 1;
      }
    },
  };
}

/** 全空条件的 JSON 字面量,over 覆盖个别字段(与 Rust FilterConditions 同构) */
export const F = (over) => JSON.stringify(conditions(over));

/** 条件对象(Rust FilterConditions 同构);排序不算收窄条件 */
export const conditions = (over = {}) => ({
  keyword: null,
  tags: [],
  excludeTags: [],
  from: null,
  to: null,
  tagPresence: null,
  sort: 'newest',
  expr: null,
  ...over,
});

/**
 * 绑定主窗页面的常用动作:验收脚本都只用主窗做 IPC 断言/库存对照。
 * call 走真实 IPC;inventory 是库存快照:笔记数 + `id|首行` 清单 + 全部标签路径 +
 * 视图数/视图 id/视图标题 + `filter_last` 原文(基线洁净断言与运行清单断言都基于它)。
 * liCount 数信息流里渲染出的笔记条数(条目根为 li 且内含 .md-body)。
 */
export function bindMain(cdp) {
  const call = (cmd, args = {}) =>
    cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
  return {
    call,
    hits: async (over) => (await call('query_notes', { conditions: conditions(over), offset: 0 })).length,
    paths: async () => (await call('list_tags')).map((t) => t.path),
    liCount: () => cdp.eval(`document.querySelectorAll('li .md-body').length`),
    inventory: () =>
      cdp.eval(`(async () => {
        const T = window.__TAURI_INTERNALS__.invoke;
        const notes = await T('query_notes', { conditions: ${JSON.stringify(conditions({}))}, offset: 0 });
        const tags = await T('list_tags');
        const views = await T('list_views');
        const filterLast = await T('get_setting', { key: 'filter_last' });
        return {
          notes: notes.length,
          ids: notes.map((n) => n.id + '|' + n.content.split(String.fromCharCode(10))[0]).sort(),
          paths: tags.map((t) => t.path).sort(),
          views: views.length,
          viewIds: views.map((v) => v.id).sort((a, b) => a - b),
          viewTitles: views.map((v) => v.title),
          filterLast: filterLast === undefined ? null : filterLast,
        };
      })()`),
  };
}
