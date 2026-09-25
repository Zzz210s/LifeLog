#!/usr/bin/env node
/**
 * 首次使用引导的端到端验收(计划 Task 4 的六条读数)。
 *
 *   ① 未看过时**主窗自己出现**(不经托盘)且教程停在第 1 步
 *   ② 洞口矩形 = 锚点矩形外扩 4px(四块遮罩拼出)
 *   ③ 连点「下一步」到末步 -> 「完成」-> 覆盖层消失 + ui.tutorial_seen === '1'
 *   ④ 已看过时重启**不弹**(CDP 里只有输入栏,主窗 webview 未创建)
 *   ⑤ 托盘打开主窗 -> 设置页「重新观看」-> 引导回来且在第 1 步
 *   ⑥ 隐藏侧栏后重看:第 3 步的前置动作把侧栏显示出来,且真的停在「标签就是分类」
 *
 * 前置:无需先起应用(脚本自己重启),但要给出可执行文件路径:
 *   node scripts/dev-tutorial-accept.mjs [exe路径]     默认 E:/1-LifeLog/LifeLog.exe
 * 端口用 LIFELOG_CDP_PORT(默认 9222)。
 *
 * 开窗发生在 **Rust 启动路径**(读 ui.tutorial_seen 后自己开主窗)—— 早期版本从前端 IPC 命令里建窗
 * 会把主线程卡死(窗口停在 about:blank、后续 IPC 永不返回),所以这里也不从页面里调开窗。
 * 脚本只写 `ui.tutorial_seen`(结束时复原为 '1'),不写笔记。
 */
import { spawn, spawnSync } from 'node:child_process';
import { ensureMain, open, pages, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { os } from './cdp-os.mjs';

const EXE = process.argv[2] ?? 'E:/1-LifeLog/LifeLog.exe';
const PORT = Number(process.env.LIFELOG_CDP_PORT ?? 9222);
const KEY = 'ui.tutorial_seen';
const { record, finish } = recorder();

/** 给 eval 加超时:CDP 目标半死不活时把挂住的 promise 变成显式错误。定时器要清掉,否则留下 unhandled rejection */
const withTimeout = (promise, ms) => {
  let timer = null;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`eval 超时(${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const restart = async () => {
  spawnSync('taskkill', ['/F', '/IM', 'LifeLog.exe'], { encoding: 'utf8' });
  await sleep(1800);
  spawn(EXE, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  }).unref();
  const up = await waitFor(
    async () => ((await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok).catch(() => false)) ? true : null),
    40, 500
  );
  if (!up) return null;
  // 输入栏页面加载完成再交出去(否则连上去 eval 会一直挂着)
  return waitFor(async () => {
    const page = await open('input').catch(() => null);
    if (page === null) return null;
    const ready = await withTimeout(page.cdp.eval('document.readyState'), 3000).catch(() => null);
    return ready === 'complete' ? true : null;
  }, 40, 500);
};

/** 主窗**已加载**在 CDP 里(冷启动态它不该出现;刚创建时可能还停在 about:blank) */
const mainTarget = async () =>
  (await pages()).find((p) => !p.url.includes('input.html') && /tauri\.localhost|5173/.test(p.url)) ?? null;

const PROBE = `(() => {
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

const callOn = async (kind, cmd, args = {}) => {
  const page = await open(kind);
  return withTimeout(
    page.cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`),
    10000
  );
};
const call = (cmd, args = {}) => callOn('main', cmd, args);

/** 读主窗引导状态:主窗刚创建时页面可能还在加载,重试几次 */
const readMain = async () => {
  let last = '';
  for (let i = 0; i < 8; i++) {
    try {
      const page = await open('main');
      return await withTimeout(page.cdp.eval(PROBE), 8000);
    } catch (e) {
      last = String(e).slice(0, 100);
      await sleep(400);
    }
  }
  console.log('WARN readMain 连续失败:', last);
  return { open: false, step: null, title: null, bands: 0, anchorRect: null, sidebarVisible: null };
};
const click = async (testid) => {
  const page = await open('main');
  await withTimeout(
    page.cdp.eval(`(() => { const el = document.querySelector('[data-testid="${testid}"]'); if (el) el.click(); return !!el; })()`),
    8000
  );
  await sleep(300);
};
/** 按可见文本/aria-label 点主窗里的某个按钮 */
const clickBy = async (kind, value) => {
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
};
const mark = async (value) => call('set_setting', { key: KEY, value });

// ---------- 前置:清标记(此时主窗可能不存在,故走输入栏页面) ----------
if (!(await restart())) throw new Error(`应用没起来(调试端口 ${PORT} 未就绪)`);
await callOn('input', 'set_setting', { key: KEY, value: '' });
record('前置:标记已清空(输入栏页面写库)', (await callOn('input', 'get_setting', { key: KEY })) === '', '');

// ---------- ① 主窗自己出现 + 第 1 步 ----------
await restart();
const appeared = await waitFor(async () => ((await mainTarget()) ? true : null), 80, 500);
record('① 未看过时主窗自己出现(不经托盘)', appeared === true, `等待 ${appeared ? '到位' : '超时'}`);
await waitFor(async () => ((await readMain()).open ? true : null), 60, 500);
const s1 = await readMain();
record('①b 教程停在第 1 步', s1.open === true && (s1.step ?? '').includes('1 / 5'), JSON.stringify({ step: s1.step, title: s1.title }));

// ---------- ② 洞口 = 锚点外扩 4px ----------
const anchor = s1.anchorRect;
const expected = anchor == null ? null : { top: anchor.top - 4, left: anchor.left - 4, width: anchor.width + 8, height: anchor.height + 8 };
const page = await open('main');
const holeRect = await withTimeout(page.cdp.eval(`(() => {
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
})()`), 8000);
const fit = (a, b) => a != null && b != null && ['top', 'left', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= 2);
record('② 洞口矩形 = 锚点外扩 4px(四块遮罩拼出)', fit(holeRect, expected), JSON.stringify({ hole: holeRect, expected }));

// ---------- ③ 走完 -> 写标记 ----------
for (let i = 0; i < 4; i++) await click('tutorial-next');
const lastBtn = await withTimeout(
  page.cdp.eval(`(() => { const b = document.querySelector('[data-testid="tutorial-next"]'); return b === null ? null : b.textContent; })()`),
  8000
);
record('③a 末步按钮是「完成」', lastBtn === '完成', JSON.stringify({ step: (await readMain()).step, btn: lastBtn }));
await click('tutorial-next');
await sleep(700);
const after = await readMain();
const seen = await call('get_setting', { key: KEY });
record('③b 完成后覆盖层消失且标记为 1', after.open === false && seen === '1', JSON.stringify({ open: after.open, seen }));

// ---------- ④ 再重启:不弹 ----------
await restart();
await sleep(4000);
const list = await pages();
record('④ 已看过时重启不弹(CDP 只有输入栏)', list.length === 1 && list[0].url.includes('input.html'), JSON.stringify(list.map((p) => p.url)));

// ---------- ⑤ 设置页「重新观看」 ----------
os.pickTray(os.pidOf(), 2); // 托盘「打开主窗口」
await waitFor(async () => ((await mainTarget()) ? true : null), 60, 500);
await ensureMain();
await sleep(600);
await clickBy('label', '设置');
await sleep(900);
const replay = await clickBy('text', '重新观看');
await sleep(1400);
const s5 = await readMain();
record('⑤ 设置页「重新观看」-> 引导回来且在第 1 步', replay === true && s5.open === true && (s5.step ?? '').includes('1 / 5'), JSON.stringify({ replay, step: s5.step }));

// ---------- ⑥ 侧栏隐藏时的第 3 步 ----------
await clickBy('label', '隐藏侧栏');
await sleep(700);
const hidden = await readMain();
await click('tutorial-skip'); // 退出当前引导
await sleep(500);
await clickBy('label', '设置');
await sleep(900);
await clickBy('text', '重新观看');
await sleep(1600);
await click('tutorial-next'); // 第 1 步 -> 第 2 步(前缀提示在场)
await click('tutorial-next'); // -> 第 3 步(标签;锚点因侧栏隐藏而缺失,靠前置动作救回)
const s6 = await readMain();
record(
  '⑥ 侧栏隐藏后重看:前置动作把侧栏显示出来并停在第 3 步',
  hidden.sidebarVisible === false && s6.sidebarVisible === true && (s6.step ?? '').includes('3 / 5'),
  JSON.stringify({ beforeHide: hidden.sidebarVisible, after: s6.sidebarVisible, step: s6.step })
);

// ---------- 收尾 ----------
await click('tutorial-skip');
await sleep(500);
await mark('1');
record('收尾:标记复原为 1、覆盖层已退出', (await readMain()).open === false, '');

finish();
