// `[[` 补全三个 N 脚本(dev-links-accept-n2/n3/n4.mjs)的共用件:
// CDP 连接前置、夹具建删、只读库对账、候选读取。只做「发合成事件 / 读值 / 读库」,
// 每条读数的判定留在各主脚本(与 graph-accept-lib.mjs 同风格)。
// 三个脚本的 DOM 形态只差两个选择器(输入框 / 候选容器 / 行),其余动作完全一致。
import { DatabaseSync } from 'node:sqlite';
import { CDP_PORT, sleep, waitFor } from './cdp-lib.mjs';

export { sleep, waitFor };
export const DB_PATH = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
export const fmt = (v) => JSON.stringify(v);

/** 应用没在 CDP 端口上时打印启动提示并以码 2 退出(各脚本开头 await) */
export async function requireApp() {
  const ok = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((x) => x.ok, () => false);
  if (!ok) {
    console.log(`需要先起应用:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}" pnpm tauri dev`);
    process.exit(2);
  }
}

/** 只读库对账:notes / note_links 计数 + integrity(收尾对比基线用) */
export function counts() {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  const n = (sql) => db.prepare(sql).get().n;
  try {
    return {
      notes: n('SELECT COUNT(*) n FROM notes'),
      noteLinks: n('SELECT COUNT(*) n FROM note_links'),
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
  } finally {
    db.close();
  }
}

/** 只读库里的笔记 MRU(`ui.mru.notes`):返回 [{id,count}](数组序即最近序),坏数据给 [] */
export function readMruNotes() {
  try {
    const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get('ui.mru.notes');
      const parsed = row ? JSON.parse(row.value) : null;
      return Array.isArray(parsed) ? parsed : [];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/** 夹具按标题前缀圈定:关键字条件 */
export const kw = (keyword) => ({ keyword, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null });
/** 空条件(只看全局计数时用) */
export const EMPTY = kw(null);

/** 合成输入:原型 value setter + input 事件 + 光标落末尾(与组件用例同一手法,不碰物理键鼠) */
export const setText = (cdp, sel, text) =>
  cdp.eval(`(() => { const el = document.querySelector('${sel}');
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(el, ${JSON.stringify(text)}); el.setSelectionRange(${text.length}, ${text.length});
    el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);

/** 合成 keydown(isComposing 等附加项经 extra 片段拼入) */
export const keyOn = (cdp, sel, key, extra = '') =>
  cdp.eval(`(() => { const el = document.querySelector('${sel}');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true${extra} }));
    return el.value; })()`);

/** 非受控输入框的值/光标读数 */
export const boxState = (cdp, sel) =>
  cdp.eval(`(() => { const el = document.querySelector('${sel}');
    return { value: el.value, caret: el.selectionStart, len: el.value.length }; })()`);

/** 候选下拉探针:开关 / 行文案 / 高亮行数 / `<mark>`(统一输入框与卡片框同形,只差选择器) */
export function linkSuggest(cdp, { list, row }) {
  return {
    open: () => cdp.eval(`!!document.querySelector('${list}')`),
    labels: () =>
      cdp.eval(`Array.from(document.querySelectorAll('${list} ${row}')).map((x) => x.textContent.trim())`),
    marks: () => cdp.eval(`Array.from(document.querySelectorAll('${list} mark')).map((x) => x.textContent)`),
    selected: () => cdp.eval(`document.querySelectorAll('${list} ${row}[aria-selected="true"]').length`),
  };
}

/** 建两条夹具(经真实保存路径 IPC),返回 {target, other, pool} */
export async function seedFixtures(call, target, other) {
  const t = await call('save_input_note', { content: target });
  const o = await call('save_input_note', { content: other });
  const pool = await call('complete_notes');
  return { target: t, other: o, pool };
}

/** 按关键字删净夹具,返回本次删除条数 */
export async function purgeFixtures(call, ns) {
  const left = await call('query_notes', { conditions: kw(ns), offset: 0 });
  for (const n of left) await call('delete_note', { id: n.id });
  return left.length;
}

/** 收尾:删净 + 等确认 + 库对账(回基线 + integrity),写一条 record */
export async function settleFixtures(call, r, ns, base) {
  const removed = await purgeFixtures(call, ns);
  const gone = await waitFor(
    async () => ((await call('query_notes', { conditions: kw(ns), offset: 0 })).length === 0 ? true : null),
    12,
    250,
  );
  const after = counts();
  const diff = ['notes', 'noteLinks'].filter((k) => after[k] !== base[k]);
  r.record(
    '收尾 夹具删净 + 库对账(回基线 + integrity)',
    gone === true && diff.length === 0 && after.integrity === 'ok',
    `删除 ${removed} 条夹具;不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 收尾=${fmt(after)}`,
  );
}
