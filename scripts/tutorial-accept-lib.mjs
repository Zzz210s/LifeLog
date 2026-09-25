// 首次使用引导验收的公共件(自 dev-tutorial-accept.mjs 拆出:合起来会破 200 行红线)。
// 依赖 Node 22+ 的全局 WebSocket/fetch;端口用 LIFELOG_CDP_PORT(默认 9222)。
import { spawn, spawnSync } from 'node:child_process';
import { open, pages, sleep, waitFor } from './cdp-lib.mjs';
import { bindMain } from './cdp-report.mjs';

export const PORT = Number(process.env.LIFELOG_CDP_PORT ?? 9222);

/** 给 eval 加超时:CDP 目标半死不活时把挂住的 promise 变成显式错误。定时器要清掉,否则留下 unhandled rejection */
export const withTimeout = (promise, ms) => {
  let timer = null;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`eval 超时(${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/** 重启应用(杀掉 + 带调试端口拉起),返回「输入栏页面已加载完成」 */
export async function restart(exe) {
  spawnSync('taskkill', ['/F', '/IM', 'LifeLog.exe'], { encoding: 'utf8' });
  await sleep(1800);
  spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  }).unref();
  const up = await waitFor(
    async () => ((await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok).catch(() => false)) ? true : null),
    40, 500
  );
  if (!up) return null;
  return waitFor(async () => {
    const page = await open('input').catch(() => null);
    if (page === null) return null;
    const ready = await withTimeout(page.cdp.eval('document.readyState'), 3000).catch(() => null);
    return ready === 'complete' ? true : null;
  }, 40, 500);
}

/** 主窗**已加载**在 CDP 里(冷启动态它不该出现;刚创建时可能还停在 about:blank) */
export const mainTarget = async () =>
  (await pages()).find((p) => !p.url.includes('input.html') && /tauri\.localhost|5173/.test(p.url)) ?? null;

/** 引导层读数:步序 / 覆盖层 / 洞口 / 侧栏可见性 / 锚点与气泡矩形 */
export const PROBE = `(() => {
  const step = document.querySelector('[data-testid="tutorial-step"]');
  const root = document.querySelector('[data-testid="tutorial-root"]');
  const bubble = document.querySelector('[data-testid="tutorial-bubble"]');
  const anchor = document.querySelector('[data-testid="unified-input"]');
  const bands = root === null ? [] : [...root.querySelectorAll('div')].filter((d) => d.className.includes('bg-overlay'));
  const r = (el) => { if (el === null) return null; const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) }; };
  return {
    step: step === null ? null : step.textContent,
    title: bubble === null ? null : (bubble.querySelector('h2') || {}).textContent || null,
    open: root !== null && bubble !== null,
    bands: bands.length,
    bubbleRect: r(bubble),
    anchorRect: r(anchor),
    sidebarVisible: document.querySelector('[data-testid="sidebar"]') !== null,
  };
})()`;

/** 四块遮罩拼出的洞口矩形(与 PROBE 的 anchorRect 对照) */
export const HOLE_RECT = `(() => {
  const root = document.querySelector('[data-testid="tutorial-root"]');
  if (root === null) return null;
  const bands = [...root.querySelectorAll('div')].filter((d) => d.className.includes('bg-overlay'));
  if (bands.length !== 4) return null;
  const r = (i) => bands[i].getBoundingClientRect();
  return {
    top: Math.round(r(0).height),
    left: Math.round(r(2).width),
    width: Math.round(window.innerWidth - r(2).width - r(3).width),
    height: Math.round(window.innerHeight - r(0).height - r(1).height),
  };
})()`;

export const callOn = async (kind, cmd, args = {}) => {
  const page = await open(kind);
  return withTimeout(
    page.cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`),
    10000
  );
};
export const call = (cmd, args = {}) => callOn('main', cmd, args);

/** 读主窗引导状态:主窗刚创建时页面可能还在加载,重试几次;全失败返回 null(调用方据此判失败,别拿假数据当通过) */
export async function readMain() {
  for (let i = 0; i < 8; i++) {
    try {
      const page = await open('main');
      return await withTimeout(page.cdp.eval(PROBE), 8000);
    } catch {
      await sleep(400);
    }
  }
  return null;
}
export async function click(testid) {
  const page = await open('main');
  await withTimeout(
    page.cdp.eval(`(() => { const el = document.querySelector('[data-testid="${testid}"]'); if (el) el.click(); return !!el; })()`),
    8000
  );
  await sleep(300);
}
/** 按可见文本或 aria-label 点主窗里的某个按钮 */
export async function clickBy(kind, value) {
  const page = await open('main');
  return withTimeout(
    page.cdp.eval(`(() => {
      const el = [...document.querySelectorAll('button')].find((b) => ${kind === 'label'
        ? `b.getAttribute('aria-label') === ${JSON.stringify(value)}`
        : `b.textContent.trim() === ${JSON.stringify(value)}`});
      if (el) el.click();
      return !!el;
    })()`),
    8000
  );
}
export const mark = (value) => call('set_setting', { key: 'ui.tutorial_seen', value });

/** 库存快照(笔记数 / 标签路径 / 时间戳设置),用来核对"引导期间没写库" */
export async function inventory() {
  const page = await open('main');
  const { inventory: snap } = bindMain(page.cdp);
  return withTimeout(snap(), 20000);
}

/** 本进程的顶层窗口矩形(Win32 读数:输入栏永远置顶,要看它有没有盖住洞口/气泡) */
export const windowRects = async () => {
  const { os } = await import('./cdp-os.mjs');
  return os.wins(os.pidOf());
};
