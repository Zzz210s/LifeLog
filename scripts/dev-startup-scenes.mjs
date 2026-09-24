// 冷启动验收(scripts/dev-cdp-accept-startup.mjs)的场景库:窗口/托盘取证件 + 主题镜像三态与
// 首帧插桩 + 既有功能回归。拆成独立文件只为满足「代码文件 <= 200 行」的仓库规则。
// 口径:窗口可见性一律用 user32 IsWindowVisible(CDP 的 visibilityState 对已隐藏窗口仍报 visible)。
// 计数口径:信息流一页 50 条(与后端 PAGE 一致),界面条数按 min(50, 命中数) 断言。
import { sleep, waitFor } from './cdp-lib.mjs';
import { bindDom } from './cdp-dom.mjs';
import { os } from './cdp-os.mjs';
import { EMPTY_FILTER, TEST_NOTE } from './dev-startup-clean.mjs';

const PAGE = 50; // 信息流一页条数(与后端一致)
const firstPage = (n) => Math.min(PAGE, n);

// 转出给既有调用点(dev-cdp-accept-startup.mjs 等按 `os` 从本文件导入)
export { os };

export const KEY = 'lifelog.theme';
/** 设置页判定:只有设置态顶栏才有「返回信息流」按钮 */
export const ON_SETTINGS =
  `Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === '返回信息流')`;
/** 首帧 class 时间线:文档开始(start)/ 头内联脚本(mut + loading)/ DCL / load。
 *  观察 document(而非 documentElement:文档开始阶段 documentElement 还是 null,直接 observe 会抛), 
 *  readyState=loading 期间的 class 变化只可能来自头内联脚本(app 读库是异步的,晚于解析)。 */
export const FRAME_LOG = `(() => {
  window.__frame = [];
  const push = (src) => window.__frame.push([
    Math.round(performance.now()),
    document.documentElement ? document.documentElement.className : null,
    document.readyState, src,
  ]);
  new MutationObserver(() => push('mut')).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  push('start');
  document.addEventListener('DOMContentLoaded', () => push('dcl'));
  window.addEventListener('load', () => push('load'));
  return true;
})()`;
/** 头内联脚本落地的 class(镜像或系统偏好);无 dark = 该阶段判为亮色 */
export const mirrorCls = (r) => {
  const hit = r.frame.filter((x) => x[3] === 'mut' && x[2] === 'loading' && x[1] !== null).pop();
  return hit ? hit[1] : '';
};

// 原生窗口/托盘取证件已抽到 scripts/cdp-os.mjs(cdp-lib 的 ensureMain 复用同一份);这里转出保持既有调用点不变


/** 设置页 -> 信息流(顶栏返回按钮) */
export const clickBack = (cdp) => cdp.eval(`(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '返回信息流');
  if (b) { b.click(); return true; }
  return false;
})()`);

/**
 * 关键词筛选:入口已随统一输入框 1/3 从侧栏搬进统一输入框的 `/` 模式(侧栏关键词框已删)。
 * 受控输入走原生 setter + input 事件(见 cdp-dom.mjs setBox);返回框内实际值,调用点按 `'/' + 关键词` 断言。
 * 传 '' 时**留在 `/` 模式**提交空查询:若把框清空回到记录模式,use-unified-filter-sync 会取消挂起的
 * 那次防抖,已写进条件的关键词留在 chip 上,那就清不掉了(方案 A:走新入口,不删读数)。
 */
export const setKeyword = async (cdp, v) => {
  if (!(await bindDom(cdp).setBox('/' + v))) return null;
  return cdp.eval(`document.querySelector('[data-testid="unified-input"]').value`);
};

/**
 * 主题镜像场景:设置里切暗色 -> 两窗镜像回写 -> 重载输入栏并按「系统偏好 x 镜像值」读首帧 class。
 * 首帧证据 = 头内联脚本落地的 class 时刻 <= first-paint 时刻(像素级白框计数见 release 读数表)。
 */
export async function runThemeScenes({ mp, ipa, call, record, j, themeBefore }) {
  await mp.cdp.send('Page.enable');
  await ipa.cdp.send('Page.enable');
  const mirror = (cdp) => cdp.eval(`localStorage.getItem(${j(KEY)})`);
  await mp.cdp.eval(`(() => { const b = document.querySelector('button[aria-label="设置"]'); if (b) b.click(); return true; })()`);
  await sleep(300);
  await mp.cdp.eval(`(() => { const r = document.querySelector('input[name="theme"][value="dark"]'); if (r) r.click(); return true; })()`);
  const toDark = await waitFor(async () => ((await call('get_setting', { key: 'theme' })) === 'dark' ? true : null), 16, 250);
  const mirrors = await waitFor(async () => {
    const m = { main: await mirror(mp.cdp), input: await mirror(ipa.cdp) };
    return m.main === 'dark' && m.input === 'dark' ? m : null;
  }, 16, 250);
  record('D1 设置里切暗色后镜像回写正确(主窗+输入栏 localStorage 均为 dark)', toDark === true && !!mirrors,
    j({ themeBefore, toDark, mirrors }));

  await ipa.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FRAME_LOG });
  const reloadProbe = async (mirrorValue, sys) => {
    await ipa.cdp.eval(mirrorValue === null
      ? `localStorage.removeItem(${j(KEY)})` : `localStorage.setItem(${j(KEY)}, ${j(mirrorValue)})`);
    await ipa.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: sys }] });
    await ipa.cdp.send('Page.reload', {});
    const frame = await waitFor(async () => {
      try {
        return await ipa.cdp.eval('(document.readyState === "complete" && window.__frame) || null');
      } catch {
        return null;
      }
    }, 40, 250);
    const paint = await ipa.cdp.eval(`(performance.getEntriesByType('paint').find((p) => p.name === 'first-paint') || {}).startTime ?? null`);
    const app = await ipa.cdp.eval(`getComputedStyle(document.documentElement).getPropertyValue('--color-app').trim()`);
    return { frame: frame || [], paint, app };
  };
  const darkFrame = await reloadProbe('dark', 'light');
  const d = darkFrame.frame.find((x) => x[3] === 'mut' && x[2] === 'loading' && String(x[1]).includes('dark'));
  record('D2 暗色主题 + 系统亮色:头内联脚本在 first-paint 之前落 dark 类,首帧即暗色(插桩证据)',
    !!d && darkFrame.paint !== null && d[0] <= darkFrame.paint && darkFrame.app === '#1e1e1e',
    j({ frame: darkFrame.frame, paint: darkFrame.paint, app: darkFrame.app }));

  const bogusLight = await reloadProbe('bogus', 'light');
  const bogusDark = await reloadProbe('bogus', 'dark');
  const hasDark = (r) => mirrorCls(r).includes('dark');
  record('D3 镜像非法值退化为跟随系统(系统亮色 -> 无 dark;系统暗色 -> dark)',
    !hasDark(bogusLight) && hasDark(bogusDark),
    j({ light: bogusLight.frame.map((x) => x[1]), dark: bogusDark.frame.map((x) => x[1]) }));
  const noneLight = await reloadProbe(null, 'light');
  const rewritten = await waitFor(async () => ((await mirror(ipa.cdp)) === 'dark' ? true : null), 20, 250);
  record('D4 清 localStorage(=首次运行)后启动按系统偏好(系统亮色 -> 无 dark),其后运行时校正把镜像回写为库内 dark',
    !hasDark(noneLight) && rewritten === true,
    j({ frame: noneLight.frame.map((x) => x[1]), mirror: await mirror(ipa.cdp) }));
  await ipa.cdp.send('Emulation.setEmulatedMedia', { features: [] });
}

/** 既有功能回归:输入栏保存 / 全局热键 / 托盘左键开主窗 / 筛选栏。返回自建数据 id 供清收。 */
export async function runRegressScenes({ pid, mp, ipa, call, liCount, base, kw, record, j }) {
  const li0 = await liCount();
  const typed = await ipa.cdp.eval(`(() => {
    const ta = document.querySelector('textarea[aria-label="输入栏内容"]');
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, ${j(TEST_NOTE)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    return ta.value;
  })()`);
  const savedNote = await waitFor(async () =>
    (await call('query_notes', { conditions: JSON.parse(EMPTY_FILTER), offset: 0 })).find((n) => n.content === TEST_NOTE) || null, 20, 250);
  const cleared = await waitFor(async () => {
    const v = await ipa.cdp.eval(`(() => ({
      value: document.querySelector('textarea[aria-label="输入栏内容"]').value,
      text: document.body.innerText.trim().slice(0, 24),
    }))()`);
    return v.value === '' && v.text.includes('已保存') ? v : null;
  }, 16, 250);
  const autoRefresh = await waitFor(async () => ((await liCount()) === firstPage(li0 + 1) &&
    (await mp.cdp.eval(`document.body.textContent.includes(${j(TEST_NOTE)})`)) ? true : null), 16, 250);
  record('G1 输入栏 Ctrl+Enter 保存:落库 + 输入框清空 + 保存浮层 + 主窗自动刷新出新条(信息流已含该条)',
    typed === TEST_NOTE && !!savedNote && !!cleared && autoRefresh === true,
    j({ typed, id: savedNote && savedNote.id, flash: cleared && cleared.text, li: [li0, await liCount()] }));

  const shownBefore = os.winVisible(pid, '输入栏');
  os.hotkey();
  const flipped = await waitFor(async () => (os.winVisible(pid, '输入栏') !== shownBefore ? true : null), 20, 250);
  os.hotkey();
  const restored = await waitFor(async () => (os.winVisible(pid, '输入栏') === shownBefore ? true : null), 20, 250);
  record('G2 全局热键 Ctrl+Shift+Q 切换输入栏显隐(真实按键 + IsWindowVisible)',
    flipped === true && restored === true, j({ shownBefore, flipped, restored }));

  // G3 托盘左键 = 打开主窗口(原「左键切换输入栏显隐」已随托盘行为调整删除,见 windowing/tray.rs:
  // 左键开主窗、输入栏切换只在菜单项与全局热键上)
  const trayClosed = os.closeWindow(pid, '拾枝');
  const trayHidden = await waitFor(async () => (os.winVisible(pid, '拾枝') ? null : true), 12, 250);
  const byMouse = await waitFor(async () => ((os.trayClick(pid, 'click'), os.winVisible(pid, '拾枝')) ? 'mouse' : null), 8, 250);
  const channel = byMouse || (os.trayClick(pid, 'toggle'),
    await waitFor(async () => (os.winVisible(pid, '拾枝') ? 'message' : null), 8, 250));
  record('G3 托盘左键打开主窗口(真实鼠标先行;未生效则走同一条 WM_USER_TRAYICON+WM_LBUTTONUP 消息路径)',
    trayClosed.closed === true && trayHidden === true && (channel === 'mouse' || channel === 'message'),
    j({ trayClosed, trayHidden, channel }));

  const setKw = await setKeyword(mp.cdp, kw);
  // 关键词有 300ms 防抖,先算出 IPC 命中数再等界面收敛到同一数字(首页上限 50 条)
  const ipcHits = (await call('query_notes', { conditions: { ...JSON.parse(EMPTY_FILTER), keyword: kw }, offset: 0 })).length;
  const uiHit = await waitFor(async () => ((await liCount()) === firstPage(ipcHits) ? true : null), 24, 300);
  record('G4 统一输入框 `/` 关键词生效(界面条数 = min(50, IPC 命中数))',
    setKw === '/' + kw && ipcHits >= 1 && uiHit === true,
    j({ kw, setKw, ipcHits, li: await liCount() }));

  // G5 清空关键词:回到首页全量(原 G5「保存为视图」随迁移 014 视图体系删除而作废)
  await setKeyword(mp.cdp, '');
  const clearedKw = await waitFor(async () => ((await liCount()) === firstPage(base.notes + 1) ? true : null), 24, 300);
  record('G5 清空关键词后回到首页全量', clearedKw === true, j({ li: await liCount(), want: firstPage(base.notes + 1) }));
  await bindDom(mp.cdp).setBox(''); // 收尾:框回记录模式(关键词已清,不会只剩一个 chip)
  return { noteId: savedNote && savedNote.id };
}
