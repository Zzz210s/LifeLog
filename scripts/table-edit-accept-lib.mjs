// 表格单元格编辑真机验收的共用件:CDP DOM 动作 + 只读库对账(判定留在主脚本)。
// 夹具一律 `TABLE编辑测试` 前缀,自建自删;不碰物理鼠标,全用合成事件。
import { DatabaseSync } from 'node:sqlite';
import { CDP_PORT, sleep, waitFor } from './cdp-lib.mjs';

export { sleep, waitFor };
export const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
export const NS = 'TABLE编辑测试';
export const fmt = (v) => JSON.stringify(v);

/** 应用没在 CDP 端口上时打印启动提示并以码 2 退出 */
export async function requireApp() {
  const ok = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((x) => x.ok, () => false);
  if (!ok) {
    console.log(`需要先起应用:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}" pnpm tauri dev`);
    process.exit(2);
  }
}

const ro = (fn) => {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
};

/** 只读笔记正文(夹具逐字节对账用) */
export const contentOf = (id) => ro((db) => db.prepare('SELECT content FROM notes WHERE id=?').get(id)?.content ?? null);

/** 只读库对账(收尾回基线用) */
export const counts = () =>
  ro((db) => {
    const n = (sql) => db.prepare(sql).get().n;
    return {
      notes: n('SELECT COUNT(*) n FROM notes'),
      tags: n('SELECT COUNT(*) n FROM tags'),
      tagLinks: n('SELECT COUNT(*) n FROM tag_links'),
      fts: n('SELECT COUNT(*) n FROM notes_fts'),
      noteLinks: n('SELECT COUNT(*) n FROM note_links'),
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
  });

export const fixtureIds = () =>
  ro((db) => db.prepare('SELECT id FROM notes WHERE content LIKE ? ORDER BY id').all(`${NS}%`).map((r) => r.id));

/** 走真实保存路径建夹具,等它渲染进信息流后返回 id */
export async function createFixture(call, ev, content) {
  const note = await call('save_input_note', { content });
  const shown = await waitFor(() => ev(`!!document.querySelector('[data-note-body="${note.id}"]')`), 24, 300);
  if (!shown) throw new Error(`夹具 ${note.id} 未在信息流渲染`);
  return note.id;
}

/** 夹具里第 0 张表在 DOM 里的格;编辑框/控制条都挂在同一个 li 里(覆盖层是正文容器的兄弟) */
export function tableDom(ev) {
  const li = (id) => `document.querySelector('[data-note-body="${id}"]')?.closest('li')`;
  const clickTd = (id, row, col) =>
    ev(`(() => { const b = document.querySelector('[data-note-body="${id}"]');
      const td = b?.querySelectorAll('table')[0]?.rows[${row}]?.cells[${col}];
      if (!td) return false;
      // 就地编辑在 mousedown 开(浏览器落光标之前),所以要发 mousedown + click
      td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      td.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true; })()`);
  const clickIn = (id, sel) =>
    ev(`(() => { const el = document.querySelector('[data-note-body="${id}"] ${sel}');
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true; })()`);
  /** 就地编辑:正在编辑的格子是那个带 contenteditable 的 td/th */
  const box = (id) => `${li(id)}?.querySelector('td[contenteditable],th[contenteditable]')`;
  const clickLabel = (id, label) =>
    ev(`(() => { const b = ${li(id)}?.querySelector('[data-table-controls] button[aria-label=${JSON.stringify(label)}]');
      if (!b) return false; b.click(); return true; })()`);
  const hasEditor = (id) => ev(`!!(${box(id)})`);
  const editorValue = (id) => ev(`(${box(id)})?.textContent ?? null`);
  const setEditor = (id, v) =>
    ev(`(() => { const el = ${box(id)}; if (!el) return false; el.textContent = ${JSON.stringify(v)}; return el.textContent; })()`);
  const keyEditor = (id, key, extra = '') =>
    ev(`(() => { const el = ${box(id)}; if (!el) return null;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true${extra} })); return el.textContent; })()`);
  const openTd = async (id, row, col) => {
    await clickTd(id, row, col);
    const ok = await waitFor(() => hasEditor(id), 16, 200);
    if (!ok) throw new Error(`点夹具 ${id} 的格 (${row},${col}) 未进入编辑态`);
  };
  /** 退出该夹具的编辑态(及其它夹具残框),让下一条读数从干净态开始 */
  const closeEditor = async (id) => {
    if (await hasEditor(id)) await keyEditor(id, 'Escape');
    await waitFor(async () => ((await hasEditor(id)) ? null : true), 10, 120);
  };
  const hasPanel = () => ev(`!!document.querySelector('[data-testid="edit-panel"]')`);
  return { clickTd, clickIn, clickLabel, hasEditor, editorValue, setEditor, keyEditor, openTd, closeEditor, hasPanel };
}
