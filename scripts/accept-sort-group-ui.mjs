// T6 端到端验收的界面驱动件(CDP/DOM,不碰物理鼠标):写 filter_current + 重载让界面按
// 应用自己的回读路径渲染,再读 DOM 读数(条件栏 chip / 摘要 / 排序面板 / 组头折叠)。
import { sleep, waitFor } from './cdp-lib.mjs';

export const evalJs = (cdp, expr) => cdp.eval(expr);

/** 主窗外壳挂载(统一输入框在 = 信息流态) */
export const uiReady = (cdp) =>
  waitFor(() => evalJs(cdp, `!!document.querySelector('#root [data-testid="unified-input"]')`), 40, 250);

/** 写 filter_current -> 重载 -> 等界面挂载(走应用真实的 parseFilterState 回读路径) */
export async function setFilterAndReload(cdp, call, payload) {
  await call('set_setting', { key: 'filter_current', value: JSON.stringify(payload) });
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(2200);
  await uiReady(cdp);
  await sleep(400);
}

/** 条件栏 chip 文案(直接子 span,避开「命中 N 条」内层 span) */
export const readChips = (cdp) =>
  evalJs(cdp, `[...document.querySelectorAll('#root [aria-label="已生效的筛选条件"] > span')].map((s) => s.textContent.trim())`);

/** 条件栏中文摘要(N 条排序 等) */
export const readSummary = (cdp) =>
  evalJs(cdp, `document.querySelector('#root [data-testid="condition-bar-summary"]')?.textContent?.trim() ?? ''`);

/** 条件组工具条读数:组头文案 + 是否带「组命中 N 条」 */
export const readGroupBar = (cdp) =>
  evalJs(cdp, `[...document.querySelectorAll('#root [data-testid^="filter-group-"]')].map((el) => ({ text: el.textContent.trim() }))`);

/** 打开「>添加条件」浮层并点指定菜单项(排序 / 分组 …) */
export async function openAddMenu(cdp, itemText) {
  return evalJs(
    cdp,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const box = document.querySelector('#root [data-testid="unified-input"]');
      if (!box) return { ok: false, why: '没有统一输入框' };
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(box, '>添加条件'); box.dispatchEvent(new Event('input', { bubbles: true }));
      const rows = () => [...document.querySelectorAll('#root [data-testid="unified-dropdown"] li[role="option"]')].filter((li) => li.textContent.includes('添加条件'));
      let row = rows()[0];
      for (let i = 0; i < 12 && !row; i++) { await sleep(250); row = rows()[0]; }
      if (!row) return { ok: false, why: '没有「>添加条件」候选行' };
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      await sleep(600);
      set.call(box, ''); box.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      const items = [...document.querySelectorAll('#root [role=menuitem]')];
      const item = items.find((b) => b.textContent.trim() === ${JSON.stringify(itemText)});
      if (!item) return { ok: false, why: '菜单里没有该项', menuItems: items.map((b) => b.textContent.trim()) };
      item.click(); await sleep(350);
      return { ok: true };
    })()`
  );
}

/** 关掉浮层(Esc),便于截干净视图 */
export const pressEsc = (cdp) =>
  evalJs(cdp, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

/** 排序面板读数 */
export const readSortPanel = (cdp) =>
  evalJs(
    cdp,
    `(() => {
      const p = document.querySelector('#root [data-testid="sort-panel"]');
      if (!p) return null;
      const rows = [...p.querySelectorAll('[data-testid="sort-row"]')].map((r) => ({
        axis: r.querySelector('span')?.textContent.trim() ?? '',
        enabled: r.querySelector('input[type=checkbox]')?.checked ?? null,
        options: [...r.querySelectorAll('select option')].map((o) => o.textContent.trim()),
        dir: r.querySelector('select')?.value ?? null,
        up: !r.querySelector('button[aria-label^="上移"]')?.disabled,
        down: !r.querySelector('button[aria-label^="下移"]')?.disabled,
      }));
      const add = p.querySelector('[data-testid="sort-add"]');
      return {
        rows,
        addDisabled: add?.disabled ?? null,
        capHint: p.querySelector('[data-testid="sort-cap-hint"]')?.textContent.trim() ?? null,
      };
    })()`
  );

/** 点排序面板第 i 行的启用勾选框 */
export const toggleSortRow = (cdp, i) =>
  evalJs(cdp, `(() => { const r = document.querySelectorAll('#root [data-testid="sort-row"]')[${i}]; if (!r) return false; r.querySelector('input[type=checkbox]').click(); return true; })()`);

/** 组头 + 组内卡片读数 */
export const readGroups = (cdp) =>
  evalJs(
    cdp,
    `[...document.querySelectorAll('#root [data-testid="group-section"]')].map((s) => ({
      label: s.querySelector('[data-testid="group-header"] span:nth-child(2)')?.textContent.trim() ?? null,
      count: Number((s.querySelector('[data-testid="group-count"]')?.textContent ?? '').replace(/[^0-9]/g, '')) || 0,
      expanded: s.querySelector('[data-testid="group-header"]')?.getAttribute('aria-expanded') === 'true',
      notes: s.querySelectorAll('li').length,
      more: !!s.querySelector('[data-testid="group-more"]'),
    }))`
  );

export const clickGroupMore = (cdp, i) =>
  evalJs(cdp, `(() => { const s = document.querySelectorAll('#root [data-testid="group-section"]')[${i}]; if (!s) return false; const b = s.querySelector('[data-testid="group-more"]'); if (!b) return false; b.click(); return true; })()`);

export const toggleGroupHeader = (cdp, i) =>
  evalJs(cdp, `(() => { const s = document.querySelectorAll('#root [data-testid="group-section"]')[${i}]; if (!s) return false; s.querySelector('[data-testid="group-header"]').click(); return true; })()`);

/** 跑一条命令面板命令(如「最新在前」一键复位排序) */
export async function runCommand(cdp, query) {
  return evalJs(
    cdp,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const box = document.querySelector('#root [data-testid="unified-input"]');
      if (!box) return { ok: false, why: '没有统一输入框' };
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(box, ${JSON.stringify('>' + query)}); box.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(500);
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      await sleep(800);
      return { ok: true };
    })()`
  );
}
