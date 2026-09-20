// 冷启动验收(scripts/dev-cdp-accept-startup.mjs)的场景库:窗口/托盘取证件 + 主题镜像三态与
// 首帧插桩 + 既有功能回归。拆成独立文件只为满足「代码文件 <= 200 行」的仓库规则。
// 口径:窗口可见性一律用 user32 IsWindowVisible(CDP 的 visibilityState 对已隐藏窗口仍报 visible)。
import { sleep, waitFor } from './cdp-lib.mjs';
import { os } from './cdp-os.mjs';
import { HELPERS } from './dev-cdp-icon-ui.mjs';
import { EMPTY_FILTER, TEST_NOTE, TEST_VIEW } from './dev-startup-clean.mjs';

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

/** 筛选栏关键词(受控输入必须走原生 setter + input 事件) */
export const setKeyword = (cdp, v) => cdp.eval(`(() => {
  const i = document.querySelector('input[aria-label="搜索笔记与标签"]');
  if (!i) return null;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return i.value;
})()`);

/**
 * 主题镜像场景:设置里切暗色 -> 两窗镜像回写 -> 重载输入栏并按「系统偏好 x 镜像值」读首帧 class。
 * 首帧证据 = 头内联脚本落地的 class 时刻 <= first-paint 时刻(像素级白框计数见 release 读数表)。
 */
export async function runThemeScenes({ mp, ipa, call, record, j, themeBefore }) {
  await mp.cdp.send('Page.enable');
  await ipa.cdp.send('Page.enable');
  await mp.cdp.eval(HELPERS);
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

/** 既有功能回归:输入栏保存 / 热键 / 托盘切换 / 筛选栏 / 视图。返回自建数据 id 供清收。 */
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
  const autoRefresh = await waitFor(async () => ((await liCount()) === li0 + 1 ? true : null), 16, 250);
  record('G1 输入栏 Ctrl+Enter 保存:落库 + 输入框清空 + 保存浮层 + 主窗自动刷新出新条',
    typed === TEST_NOTE && !!savedNote && !!cleared && autoRefresh === true,
    j({ typed, id: savedNote && savedNote.id, flash: cleared && cleared.text, li: [li0, await liCount()] }));

  const shownBefore = os.winVisible(pid, '输入栏');
  os.hotkey();
  const flipped = await waitFor(async () => (os.winVisible(pid, '输入栏') !== shownBefore ? true : null), 20, 250);
  os.hotkey();
  const restored = await waitFor(async () => (os.winVisible(pid, '输入栏') === shownBefore ? true : null), 20, 250);
  record('G2 全局热键 Ctrl+Shift+Q 切换输入栏显隐(真实按键 + IsWindowVisible)',
    flipped === true && restored === true, j({ shownBefore, flipped, restored }));

  const trayBefore = os.winVisible(pid, '输入栏');
  os.trayClick(pid, 'click');
  const byMouse = await waitFor(async () => (os.winVisible(pid, '输入栏') !== trayBefore ? 'mouse' : null), 8, 250);
  const channel = byMouse || (os.trayClick(pid, 'toggle'),
    await waitFor(async () => (os.winVisible(pid, '输入栏') !== trayBefore ? 'message' : null), 8, 250));
  record('G3 托盘左键切换输入栏显隐(真实鼠标先行;未生效则走同一条 WM_USER_TRAYICON+WM_LBUTTONUP 消息路径)',
    channel === 'mouse' || channel === 'message', j({ trayBefore, channel }));

  const setKw = await setKeyword(mp.cdp, kw);
  // 关键词有 300ms 防抖,先算出 IPC 命中数再等界面收敛到同一数字
  const ipcHits = (await call('query_notes', { conditions: { ...JSON.parse(EMPTY_FILTER), keyword: kw }, offset: 0 })).length;
  const uiHit = await waitFor(async () => ((await liCount()) === ipcHits ? true : null), 24, 300);
  record('G4 筛选栏关键词生效(界面条数 = IPC 命中数)',
    setKw === kw && ipcHits >= 1 && uiHit === true,
    j({ kw, setKw, ipcHits, li: await liCount() }));

  const px = (expr) => mp.cdp.eval('window.__X.' + expr).catch(() => undefined);
  await px('openSave()');
  await waitFor(async () => ((await px('dialogOpen("保存为视图")')) === true ? true : null), 16, 250);
  await px('setTitle(' + j(TEST_VIEW) + ')');
  await px('clickDialog("保存")');
  const rowSeen = await waitFor(async () => ((await px('row(' + j(TEST_VIEW) + ')')) ? true : null), 20, 250);
  const view = (await call('list_views')).find((v) => v.title === TEST_VIEW);
  await setKeyword(mp.cdp, '');
  const clearedKw = await waitFor(async () => ((await liCount()) === base.notes + 1 ? true : null), 24, 300);
  await mp.cdp.eval(`(() => { const r = document.querySelector('[data-view-id="${view && view.id}"]'); if (r) r.click(); return !!r; })()`);
  const applied = await waitFor(async () => {
    const v = await mp.cdp.eval(`document.querySelector('input[aria-label="搜索笔记与标签"]').value`);
    return v === kw ? v : null;
  }, 24, 300);
  record('G5 视图可用:保存(带关键词条件)-> 侧栏出现该行 -> 清空条件 -> 点视图行还原条件',
    rowSeen === true && !!view && clearedKw === true && applied === kw,
    j({ viewId: view && view.id, rowSeen, clearedKw, applied }));
  return { noteId: savedNote && savedNote.id, viewId: view && view.id };
}
