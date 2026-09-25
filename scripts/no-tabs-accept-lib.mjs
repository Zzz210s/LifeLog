// 「删标签页」批次端到端读数(scripts/dev-no-tabs-accept.mjs)的共用件:
// 只做「只读库读数 + DOM/受控输入动作 + 探针」,不做断言(判定留在主脚本)。
// 不碰物理鼠标:键鼠全走 DOM click / React 受控输入 / CDP Input 合成按键。
import { DatabaseSync } from 'node:sqlite';
import { sleep, waitFor } from './cdp-lib.mjs';

/** 真实库(工程约定路径);只以 readOnly 打开 */
export const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
/** 夹具命名空间:笔记关键词与标签名(自建自删;收尾断言库里没有 UI测试* 标签) */
export const KEYWORD_FIXTURE = 'UI测试无标签夹具';
export const TAG_FIXTURE = 'UI测试无标签';
export const TAG_FIXTURE_RENAMED = 'UI测试无标签改';
/** 空条件(与前端 EMPTY_FILTER 同形,IPC query_notes 用) */
export const EMPTY_CONDITIONS = { keyword: null, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };

/** 只读库读数:笔记/标签/链接/别名计数 + integrity + user_version(不依赖窗口) */
export function dbCounts() {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    const one = (sql) => db.prepare(sql).get();
    return {
      notes: one('SELECT COUNT(*) AS n FROM notes').n,
      tags: one('SELECT COUNT(*) AS n FROM tags').n,
      links: one('SELECT COUNT(*) AS n FROM tag_links').n,
      aliases: one('SELECT COUNT(*) AS n FROM tag_aliases').n,
      integrity: one('PRAGMA integrity_check').integrity_check,
      version: one('PRAGMA user_version').user_version,
      fixtureTags: one(`SELECT COUNT(*) AS n FROM tags WHERE path LIKE 'UI测试%'`).n,
    };
  } finally {
    db.close();
  }
}

/** 把「读 DOM / 点按钮 / 走 React 受控输入」绑到一条 CDP 连接上 */
export function bindUi(cdp) {
  const ev = (expr) => cdp.eval(expr);
  const call = (cmd, args = {}) =>
    ev(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

  /** React 受控 textarea 的标准改值手法:原型 setter + input 事件 */
  const setBox = (value) =>
    ev(`(() => {
      const box = document.querySelector('[data-testid="unified-input"]');
      if (!box) return false;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(value)});
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

  const key = async (vk, name, code, modifiers = 0) => {
    const base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(200);
  };

  const clickByLabel = (label) =>
    ev(`(() => { const b = document.querySelector('button[aria-label="${label}"]'); if (!b) return false; b.click(); return true; })()`);
  /** 点侧栏某标签行(等价用户点标签做筛选) */
  const clickTag = (path) =>
    ev(`(() => { const b = document.querySelector('aside [data-tag-path="${path}"]'); if (!b) return false; b.click(); return true; })()`);
  const chips = () =>
    ev(`Array.from(document.querySelectorAll('[aria-label="已生效的筛选条件"] [aria-label^="移除条件"]'))
      .map((b) => b.getAttribute('aria-label').replace('移除条件 ', ''))`);
  const clearChips = async () => {
    for (let i = 0; i < 8; i++) {
      const n = await ev(`(() => { const b = document.querySelector('[aria-label="已生效的筛选条件"] [aria-label^="移除条件"]'); if (!b) return 0; b.click(); return 1; })()`);
      if (!n) break;
      await sleep(320);
    }
  };

  return {
    ev,
    call,
    setBox,    enter: () => key(13, 'Enter', 'Enter'),
    ctrlEnter: () => key(13, 'Enter', 'Enter', 2),
    clickByLabel,
    clickTag,
    chips,
    clearChips,
    box: () => ev(`(() => { const b = document.querySelector('[data-testid="unified-input"]'); return b === null ? null : { placeholder: b.getAttribute('placeholder'), aria: b.getAttribute('aria-label'), value: b.value }; })()`),
    focusBox: () => ev(`(() => { const b = document.querySelector('[data-testid="unified-input"]'); if (b === null) return false; b.focus(); return true; })()`),
    sidebar: () => ev(`!!document.querySelector('aside[data-testid="sidebar"]')`),
    streamCount: () => ev(`document.querySelectorAll('[data-note-body]').length`),
    stat: () => ev(`document.querySelector('[data-testid="prefix-stat"]')?.textContent ?? null`),
    rows: () =>
      ev(`Array.from(document.querySelectorAll('[data-testid="unified-dropdown"] li[role="option"]'))
        .map((li) => ({ id: li.getAttribute('data-row-id'), label: li.textContent.trim() }))`),
    /** 侧栏标签区两个入口的读数:aria-label / 文本 / 是否内联图标 */
    tagsHeader: () =>
      ev(`Array.from(document.querySelectorAll('aside button[aria-label]'))
        .filter((b) => ['切换为扁平列表', '切换为树形', '筛选标签'].includes(b.getAttribute('aria-label')))
        .map((b) => ({ label: b.getAttribute('aria-label'), text: (b.textContent || '').trim(), svg: !!b.querySelector('svg') }))`),
    /** 侧栏内是否还有收起按钮(应为 0) */
    asideHideButtons: () => ev(`document.querySelectorAll('aside [aria-label="隐藏侧栏"]').length`),
    tablistCount: () => ev(`document.querySelectorAll('#root [role="tablist"]').length`),
    textHasTabPage: () => ev(`document.body.innerText.includes('标签页')`),
    tutorial: () =>
      ev(`(() => {
        const step = document.querySelector('[data-testid="tutorial-step"]');
        const next = document.querySelector('[data-testid="tutorial-next"]');
        return { open: !!document.querySelector('[data-testid="tutorial-root"]'),
          step: step === null ? null : step.textContent, next: next === null ? null : next.textContent };
      })()`),
    clickTutorialNext: () =>
      ev(`(() => { const b = document.querySelector('[data-testid="tutorial-next"]'); if (!b) return false; b.click(); return true; })()`),
  };
}

/** 挑一个「含子级命中数 ≤ max」的真实标签(读数 2 用;拿不到返回 null) */
export async function pickSmallTag(call, exclude = [], max = 20, tries = 8) {
  const cands = (await call('list_tags')).filter((t) => t.self_count > 0 && !exclude.includes(t.path)).slice(0, tries);
  for (const t of cands) {
    const n = (await call('query_notes', { conditions: { ...EMPTY_CONDITIONS, tags: [{ path: t.path, includeChildren: true }] }, offset: 0 })).length;
    if (n > 0 && n <= max) return { path: t.path, n };
  }
  return null;
}

/** 走真实 UI 改标签名:右键标签行 -> 菜单「重命名」-> 输入新名 -> 确定 */
export async function renameTagViaMenu(ui, path, newName) {
  const opened = await ui.ev(`(() => {
    const row = document.querySelector('aside [data-tag-path="${path}"]');
    if (!row) return false;
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 8 }));
    return true;
  })()`);
  await sleep(300);
  const pane = await ui.ev(`(() => { const b = [...document.querySelectorAll('[data-tag-menu] [role="menuitem"]')].find((x) => x.textContent.trim() === '重命名'); if (!b) return false; b.click(); return true; })()`);
  await sleep(300);
  const filled = await ui.ev(`(() => {
    const i = document.querySelector('input[aria-label="新标签名"]');
    if (!i) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(newName)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
  const done = await ui.ev(`(() => { const b = [...document.querySelectorAll('[data-tag-menu] button')].find((x) => x.textContent.trim() === '确定'); if (!b) return false; b.click(); return true; })()`);
  return opened === true && pane === true && filled === true && done === true;
}

/** 等条件栏出现文案精确为 `#path`(可带「⊢ 」含子级前缀)的 chip;返回 chips 数组或 null */
export const chipIs = (ui, path) => waitFor(async () => {
  const c = await ui.chips();
  return c.some((x) => x.replace('⊢ ', '') === '#' + path) ? c : null;
}, 20, 250);

/** 等条件栏出现包含某子串的 chip(关键字等非精确场景) */
export const chipHas = (ui, text) => waitFor(async () => {
  const c = await ui.chips();
  return c.some((x) => x.includes(text)) ? c : null;
}, 20, 250);

/** 收尾:清掉夹具笔记与夹具标签,并把设置还原(只动夹具命名空间) */
export async function cleanupFixtures(bm, { noteId, settingsBefore }) {
  await bm.call('delete_note', { id: noteId });
  for (const t of await bm.call('list_tags')) {
    if (t.path === TAG_FIXTURE || t.path.startsWith(TAG_FIXTURE + '/') || t.path === TAG_FIXTURE_RENAMED) {
      await bm.call('delete_tag', { tagId: t.id });
    }
  }
  await sleep(900);
  if (settingsBefore.tutorial !== '1' && settingsBefore.tutorial !== null) {
    await bm.call('set_setting', { key: 'ui.tutorial_seen', value: settingsBefore.tutorial });
  }
  await bm.call('set_setting', { key: 'sidebar_visible', value: settingsBefore.sidebar ?? 'false' });
}

/** 引导四步:等它出现 -> 连点 3 次到末步 -> 再点「完成」，返回首/末步读数 */
export async function walkTutorial(ui) {
  const first = await waitFor(async () => {
    const s = await ui.tutorial();
    return s.open ? s : null;
  }, 40, 500);
  for (let i = 0; i < 3; i++) {
    await ui.clickTutorialNext();
    await sleep(600);
  }
  const last = await ui.tutorial();
  const clicked = await ui.clickTutorialNext();
  await sleep(900);
  return { first, last, clicked: clicked === true };
}
