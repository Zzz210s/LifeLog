import { openReadOnly } from './db-compat.mjs';
// 标签携带端到端验收(scripts/dev-carry-accept.mjs)的共用件:只做「只读库对账 / 发 IPC /
// 发 DOM 事件 / 读值」,判定全部留在主脚本(与 link-accept-lib.mjs / graph-accept-g3-lib.mjs 同风格)。
// 库路径可用 LIFELOG_DB 覆盖 —— 跑独立 identifier 的副本库时用得上;默认是本机真实库。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CDP_PORT, sleep, waitFor } from './cdp-lib.mjs';

// 主脚本用的机械动作(搬数据 / 发事件)在 scripts/carry-accept-ops.mjs,这里再出口。
export * from './carry-accept-ops.mjs';
export { sleep, waitFor };
export const DB_PATH = process.env.LIFELOG_DB ?? 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
/** 空条件(与前端 EMPTY_FILTER / Rust FilterConditions 同形) */
export const EMPTY = { keyword: null, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };
export const tagCond = (path) => ({ ...EMPTY, tags: [{ path, includeChildren: true }] });
export const excludeCond = (path) => ({ ...EMPTY, excludeTags: [{ path, includeChildren: true }] });
export const fmt = (v) => JSON.stringify(v);

const ro = (fn) => {
  const db = openReadOnly(DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
export const get = (sql, ...a) => ro((db) => db.prepare(sql).get(...a));
export const all = (sql, ...a) => ro((db) => db.prepare(sql).all(...a));

/** 库对账口径:笔记/标签/链接/携带行/FTS + user_version + integrity */
export const counts = () =>
  ro((db) => {
    const n = (s) => db.prepare(s).get().n;
    return {
      notes: n('SELECT COUNT(*) n FROM notes'),
      tags: n('SELECT COUNT(*) n FROM tags'),
      tagLinks: n('SELECT COUNT(*) n FROM tag_links'),
      carryRows: n("SELECT COUNT(*) n FROM tag_links WHERE target_type = 'tag'"),
      noteLinks: n('SELECT COUNT(*) n FROM note_links'),
      fts: n('SELECT COUNT(*) n FROM notes_fts'),
      version: db.prepare('PRAGMA user_version').get().user_version,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
  });

/** 悬空携带行:target_type='tag' 但 target_id 已不在 tags 里(R5 的独立读数,不走实现那条 SQL) */
export const danglingTagRows = () =>
  get("SELECT COUNT(*) n FROM tag_links WHERE target_type = 'tag' AND target_id NOT IN (SELECT id FROM tags)").n;
export const carryRowsTo = (id) => get("SELECT COUNT(*) n FROM tag_links WHERE target_type = 'tag' AND target_id = ?1", id).n;
export const carryRowsFrom = (id) => get("SELECT COUNT(*) n FROM tag_links WHERE target_type = 'tag' AND tag_id = ?1", id).n;
/** 某标签的全部出边目标路径(IPC list_tag_relations;关系/携带统一后同一份) */
export const relationOutPaths = async (call, id) =>
  (await call('list_tag_relations', { fromTag: id })).map((x) => x.path).sort();
/** 指向某标签的携带者路径(库侧独立读数,不依赖已删的 list_tag_carries) */
export const carrierPathsOf = (id) =>
  all("SELECT t.path FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE l.target_type = 'tag' AND l.target_id = ?1 ORDER BY t.path", id).map((r) => r.path);
export const tagIdOf = (path) => get('SELECT id FROM tags WHERE path = ?1', path)?.id ?? null;
export const noteIdOf = (firstLine) => get('SELECT id FROM notes WHERE content LIKE ?1 ORDER BY id DESC LIMIT 1', firstLine + '%')?.id ?? null;
export const fixtureNoteIds = () => all("SELECT id FROM notes WHERE content LIKE '携带测试%' ORDER BY id").map((r) => r.id);
export const fixtureTagIds = () => all("SELECT id FROM tags WHERE path LIKE '携带测试%' ORDER BY depth DESC").map((r) => r.id);
/** 侧栏标签行计数的数据源(IPC list_tags,与侧栏同一份):按 path 排序的 (本级, 含子级) 二元组 */
export const tagCountsViaApp = async (cdp) =>
  (await ipc(cdp, 'list_tags')).map((t) => `${t.path}|${t.self_count}|${t.subtree_count}`).sort();
export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
/** xlsx 的**确定性**内容摘要:zip 逐条拼接,跳过写了当前时间的 docProps/core.xml(rust_xlsxwriter 每次都刷新它) */
export const xlsxContentDigest = (file) =>
  execFileSync('python', ['-c', [
    'import hashlib, zipfile, sys',
    'z = zipfile.ZipFile(sys.argv[1])',
    'h = hashlib.sha256()',
    'for n in sorted(z.namelist()):',
    "    if n == 'docProps/core.xml': continue",
    '    h.update(n.encode()); h.update(z.read(n))',
    'print(h.hexdigest())',
  ].join('\n'), file], { encoding: 'utf8' }).trim();
/** 侧栏计数(按 path 排序的 "path|self|subtree")前后差异:非命名空间行的变化 + 每个变化行的 [前, 后] 计数 */
export const sidebarDiff = (before, after, ns) => {
  const m = (rows) => new Map(rows.map((r) => { const [p, ...v] = r.split('|'); return [p, v.map(Number)]; }));
  const b = m(before), a = m(after);
  const keys = [...new Set([...b.keys(), ...a.keys()])];
  const changed = keys.filter((p) => JSON.stringify(b.get(p)) !== JSON.stringify(a.get(p)));
  return { outside: changed.filter((p) => !p.startsWith(ns)), changed: changed.map((p) => [p, b.get(p), a.get(p)]) };
};
/** 两个 xlsx「条目」表的逐单元格差异:[{id, col, before, after}](ids 取左侧表头第一列) */
export const xlsxCellDiff = (a, b) =>
  JSON.parse(execFileSync('python', ['-c', [
    'import json, sys, openpyxl',
    'def rows(p):',
    "    ws = openpyxl.load_workbook(p)['条目']",
    '    it = ws.iter_rows(values_only=True)',
    '    hdr = list(next(it))',
    '    return hdr, {r[0]: list(r) for r in it}',
    'ha, x = rows(sys.argv[1]); hb, y = rows(sys.argv[2])',
    "assert ha == hb, '表头不一致'",
    'out = []',
    'for k in sorted(set(x) | set(y)):',
    '    ra, rb = x.get(k), y.get(k)',
    '    if ra is None or rb is None:',
    "        out.append({'id': k, 'col': '*', 'before': ra is not None, 'after': rb is not None}); continue",
    '    for i, c in enumerate(ha):',
    '        if ra[i] != rb[i]:',
    "            out.append({'id': k, 'col': c, 'before': ra[i], 'after': rb[i]})",
    "print(json.dumps(out, ensure_ascii=False))",
  ].join('\n'), a, b], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).trim());
/** 应用读路径(R1):query_notes 里这条笔记的 tags —— 走后端过滤,不是直连库自证 */
export const appNoteTags = async (cdp, keyword, id) =>
  (await ipc(cdp, 'query_notes', { conditions: { ...EMPTY, keyword }, offset: 0 })).find((n) => n.id === id)?.tags ?? null;

/** 应用没在 CDP 端口上时打印启动提示并以码 2 退出 */
export async function requireApp() {
  const ok = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((x) => x.ok, () => false);
  if (!ok) {
    console.log(`需要先起应用(装 机 版 或 dev):WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}"`);
    process.exit(2);
  }
}

// --- CDP 侧:IPC 与 DOM 事件(全部合成事件,不碰物理键鼠) ---
export const ipc = (cdp, cmd, args = {}) =>
  cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

/** 右键侧栏某标签行,打开 TagMenu */
export const openTagMenu = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside [data-tag-path=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    if (!r) return false; r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 })); return true; })()`);
/** 标签菜单「引用…」档(标签关系统一后「携带…」并入此档) */
export const clickCarryMenuItem = (cdp) =>
  cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('[data-tag-menu] button')).find((x) => x.textContent.trim() === '引用…');
    if (!b) return false; b.click(); return true; })()`);
/** 在「添加关系」输入框里敲查询串(受控输入:原型 setter + input 事件),不按回车 */
export const typeCarryQuery = (cdp, q) =>
  cdp.eval(`(() => { const i = document.querySelector('[aria-label="添加引用目标"]'); if (!i) return false;
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, ${JSON.stringify(q)});
    i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
/** 点 data-relation-candidate == id 的候选行(mousedown 才走组件的 onPick) */
export const pickCarryCandidate = (cdp, id) =>
  cdp.eval(`(() => { const b = document.querySelector('[data-relation-candidate="' + ${JSON.stringify(String(id))} + '"]');
    if (!b) return false; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`);
/** 关系面板读数:是否开着 / 当前出边目标 id 列表 / 就地错误文本(旧的「被 N 个标签携带」行已随面板合并消失) */
export const carryPane = (cdp) =>
  cdp.eval(`(() => { const root = document.querySelector('[data-tag-menu]'); if (!root) return null;
    const carried = Array.from(root.querySelectorAll('[data-relation-remove]')).map((b) => b.getAttribute('data-relation-remove') ?? '');
    const err = Array.from(root.querySelectorAll('p')).map((p) => p.textContent.trim()).find((t) => t.includes('循环') || t.includes('指向自己'));
    return { open: !!document.querySelector('[aria-label="添加引用目标"]'), carried, info: null, error: err ?? null }; })()`);
/** 关掉浮层(菜单/面板):Esc 在捕获阶段被 useDismiss 收到 */
export const pressEsc = (cdp) => cdp.eval(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
/** 点侧栏标签行 = 加入/移出筛选 */
export const clickTagPath = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside [data-tag-path=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    if (!r) return false; r.click(); return true; })()`);
/** 条件栏摘要里 `+携带` 小字的个数(-1 表示条件栏摘要不存在) */
export const summaryCarryMarks = (cdp) =>
  cdp.eval(`(() => { const s = document.querySelector('[data-testid="condition-bar-summary"]'); if (!s) return -1;
    return Array.from(s.querySelectorAll('span')).filter((x) => x.textContent === '+携带').length; })()`);
export const summaryText = (cdp) =>
  cdp.eval(`document.querySelector('[data-testid="condition-bar-summary"]')?.textContent ?? null`);
/** 清空条件栏全部 chip */
export async function clearChips(cdp) {
  for (let i = 0; i < 8; i++) {
    const n = await cdp.eval(`(() => { const b = document.querySelector('[aria-label="已生效的筛选条件"] [aria-label^="移除条件"]'); if (!b) return 0; b.click(); return 1; })()`);
    if (!n) break;
    await sleep(300);
  }
}
/** 一个条件下的**全量**命中笔记 id(query_notes 分页取全,避免误把首页 50 当全库) */
export const condIds = async (cdp, cond) => {
  const ids = [];
  for (let off = 0; ; ) {
    const page = await ipc(cdp, 'query_notes', { conditions: cond, offset: off });
    ids.push(...page.map((n) => n.id));
    if (page.length < 50) return ids;
    off += page.length;
  }
};
export const queryCount = async (cdp, cond) => (await condIds(cdp, cond)).length;

/** 在页面里连打 n 次 query_notes,返回平均耗时 ms(含 IPC 往返,前后同口径) */
export const timeQuery = (cdp, cond, n = 40) =>
  cdp.eval(`(async () => { const T = window.__TAURI_INTERNALS__.invoke; const c = ${JSON.stringify(cond)};
    const t0 = performance.now(); for (let i = 0; i < ${n}; i++) await T('query_notes', { conditions: c, offset: 0 });
    return (performance.now() - t0) / ${n}; })()`);

