// 时间标签降级验收(2026-09-17 spec Step 3)共用件:CDP 连接与常用动作。
// 被 scripts/dev-cdp-accept-timetag.mjs(断言)与 ...-clean.mjs(清理)共用。
import { sleep, waitFor } from './cdp-lib.mjs';

export const MARK = '测试验收';
export const TPL_DEFAULT = '时间排序/{y}/{m}/{d}';
export const TPL_ALT = '日期/{y}/{m}/{d}';
export const SEL_SWITCH = 'button[role="switch"][aria-label="保存时自动带时间标签"]';
export const SEL_TPL = 'input[aria-label="时间标签格式"]';
export const SEL_TEXT = 'textarea[aria-label="输入栏内容"]';
export const EVIDENCE = '.superpowers/sdd/2026-09-17-time-tag-demotion/step3-evidence.json';
export const EXPORT_PATH = process.env.TIMETAG_EXPORT || 'C:/Users/23652/AppData/Local/Temp/lifelog-step3-export.xlsx';

/** 空条件对象(Rust FilterConditions 同构;不含已删除的 from/to) */
export const cond = (over = {}) => ({
  keyword: null,
  tags: [],
  excludeTags: [],
  tagPresence: null,
  sort: 'newest',
  expr: null,
  ...over,
});

/** 绑定 main/input 两个页面后的动作集 */
export function actions(main, input) {
  const call = (cmd, args = {}) =>
    main.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
  const clickSel = (sel) =>
    main.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const clickText = (sel, text) =>
    main.eval(`(() => {
      const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => (x.textContent || '').includes(${JSON.stringify(text)}));
      if (!e) return false; e.click(); return true;
    })()`);
  const setValue = (cdp, sel, value, proto = 'HTMLInputElement') =>
    cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      Object.getOwnPropertyDescriptor(window.${proto}.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  const tagList = () => call('list_tags');
  const getSetting = (key) => call('get_setting', { key });
  const page = (sort) => call('query_notes', { conditions: cond({ sort }), offset: 0 });
  return {
    call,
    clickSel,
    clickText,
    setValue,
    tagList,
    getSetting,
    /** 打开设置页并等「笔记」分区控件渲染完成(设置页是条件挂载 + 异步读数) */
    openSettings: async () => {
      await clickSel('button[aria-label="设置"]');
      return waitFor(
        () => main.eval(`!!document.querySelector(${JSON.stringify(SEL_SWITCH)}) && !!document.querySelector(${JSON.stringify(SEL_TPL)})`),
        30,
        120
      );
    },
    /** 切回信息流视图(设置页/菜单收起) */
    resetUi: async () => {
      await clickText('button', '返回');
      await main.eval(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
      await sleep(350);
    },
    /** 抽 3 条 id / 正文 / DOM 首 3 条正文 */
    idsHead: async (sort) => (await page(sort)).slice(0, 3).map((n) => n.id),
    backHead: async (sort) => (await page(sort)).slice(0, 3).map((n) => n.content.replace(/\s+/g, ' ').trim().slice(0, 6)),
    domHead: () =>
      main.eval(`[...document.querySelectorAll('li .md-body')].slice(0, 3)
        .map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 6))`),
    sortLabel: () =>
      main.eval(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').startsWith('排序:'));
        return b ? b.textContent.trim() : null;
      })()`),
    clickSort: () => clickText('button', '排序:'),
    /** 按关键词找测试笔记(带 tags) */
    findNote: async (marker) => {
      const list = await call('query_notes', { conditions: cond({ keyword: MARK }), offset: 0 });
      return list.find((n) => n.content.includes(marker)) ?? null;
    },
    /** 真输入栏路径:填入内容 + Ctrl+Enter 保存(保存成功会清空输入框) */
    saveNote: async (text) => {
      await setValue(input, SEL_TEXT, text, 'HTMLTextAreaElement');
      await input.eval(`(() => { document.querySelector(${JSON.stringify(SEL_TEXT)})
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); return true; })()`);
      return waitFor(() => input.eval(`document.querySelector(${JSON.stringify(SEL_TEXT)}).value === ''`), 25, 200);
    },
  };
}

/** 标签树读数工具 */
export const subtree = (list, root) => list.filter((t) => t.path === root || t.path.startsWith(root + '/'));
export const dayNodes = (list, root) =>
  list.filter((t) => new RegExp(`^${root}/\\d{4}/\\d{2}/\\d{2}$`).test(t.path));
export const datePath = (template, iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m === null ? '' : template.replace('{y}', m[1]).replace('{m}', m[2]).replace('{d}', m[3]);
};
