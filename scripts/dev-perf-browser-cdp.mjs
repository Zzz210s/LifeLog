// 浏览器级 CDP 客户端(任务 E 的主窗「首开」插桩用):dev-perf-firstopen.mjs 靠它做
// Target.setAutoAttach + waitForDebuggerOnStart,在页面导航前插打点脚本与 Profiler。
// 与 cdp-lib.mjs 的 Cdp 区别:Cdp 面向单个页面 socket,这里面向浏览器 socket 且要带 sessionId。
export const BASE = `http://127.0.0.1:${Number(process.env.LIFELOG_CDP_PORT ?? 9222)}`;

export class BrowserCdp {
  static id = 0;
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        this.handlers.forEach((h) => h(m));
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++BrowserCdp.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

/** 连上 WebView2 的浏览器级调试端点(需要先以 --remote-debugging-port=9222 启动应用) */
export async function connectBrowser(sessionWsUrl) {
  const url = sessionWsUrl || (await (await fetch(`${BASE}/json/version`)).json()).webSocketDebuggerUrl;
  const ws = new globalThis.WebSocket(url);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  return { bc: new BrowserCdp(ws), close: () => ws.close() };
}
