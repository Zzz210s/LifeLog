#!/usr/bin/env node
import { DB_PATH, openReadOnly } from './db-compat.mjs';
/**
 * 卡片「被引用 N」下线后的真机读数(用户 2026-10-11「被引用不显示标签,仅引用的显示」)。
 *   1 目标笔记卡片底部**没有**「被引用 2」徽标(无 `backlink-count` 节点、卡片文本不含「被引用」)
 *   2 打开目标编辑面板:底部反向引用面板仍列出两条来源首行(只读,无按钮);Esc 收起
 *   3 卡片不因入链发起任何读取(读数 1 的负向口径)
 *   收尾 夹具删净 + 库对账(entities/edges/entities_fts 逐项回基线 + integrity + user_version)
 *
 * 夹具一律 `LINK测试` 前缀,自建自删;真实库除本脚本自建的笔记外只读。
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-links-accept-l3.mjs(先起 pnpm tauri dev)
 */
import { CDP_PORT, ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { BOX, driver } from './unified-accept-lib.mjs';

const NS = 'LINK测试';
const TARGET = `${NS} L3目标`;
const S1 = `${NS} L3来源甲`;
const S2 = `${NS} L3来源乙`;
const SOURCE1 = `${S1}\n[[${TARGET}]]`;
const SOURCE2 = `${S2}\n[[${TARGET}]]`;

const ro = (fn) => {
  const db = openReadOnly(DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const get = (sql, ...args) => ro((db) => db.prepare(sql).get(...args));
const all = (sql, ...args) => ro((db) => db.prepare(sql).all(...args));

const counts = () =>
  ro((db) => {
    const n = (sql) => db.prepare(sql).get().n;
    return {
      entities: n('SELECT COUNT(*) n FROM entities'),
      edges: n('SELECT COUNT(*) n FROM edges'),
      fts: n('SELECT COUNT(*) n FROM entities_fts'),
      version: db.prepare('PRAGMA user_version').get().user_version,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
  });

const fixtureIds = () =>
  all(`SELECT id FROM entities WHERE path IS NULL AND meta LIKE '${NS}%' ORDER BY id`).map((r) => r.id);
const fmt = (v) => JSON.stringify(v);

const r = recorder();
const { record, finish } = r;

if (!(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((x) => x.ok, () => false))) {
  console.log(`需要先起应用:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}" pnpm tauri dev`);
  process.exit(2);
}

const conn = await ensureMain();
const call = (cmd, args = {}) =>
  conn.cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const d = driver(conn.cdp);

/** 回信息流:退编辑态 + 清掉条件栏全部 chip + 重载(否则新笔记可能不在 DOM 里) */
const gotoStream = async () => {
  await d.esc();
  await d.clearChips();
  await conn.cdp.send('Page.reload');
  await waitFor(() => d.ev(`!!document.querySelector('${BOX}')`).catch(() => false), 60, 500);
  await sleep(1200);
};

/** 走真实保存路径建笔记(统一输入框 + Ctrl+Enter),返回落库 id */
const createNote = async (text) => {
  await d.clearBox();
  await d.type(text);
  await d.ctrlEnter();
  const id = await waitFor(
    () => get('SELECT id FROM entities WHERE meta = ?1 AND path IS NULL ORDER BY id DESC LIMIT 1', text)?.id,
    24,
    250
  );
  if (id == null) throw new Error(`建笔记失败:库里找不到正文等于 ${fmt(text)} 的行`);
  return id;
};

const cardOf = (id) => `document.querySelector('[data-note-body="${id}"]')?.closest('li')`;
/** 卡片底部徽标读数:节点存在性与卡片文本(负向口径:不得出现「被引用」) */
const readBadge = (id) =>
  d.ev(`(() => { const li = ${cardOf(id)}; if (!li) return { found: false };
    return { found: true, badge: !!li.querySelector('[data-testid="backlink-count"]'), text: li.textContent }; })()`);
/** 编辑面板底部的反向引用面板(只读):条目文本数组 */
const readEditorBacklinks = (id) =>
  d.ev(`(() => { const li = ${cardOf(id)}; if (!li) return { found: false };
    li.querySelector('[data-note-body]')?.click();
    return { found: true }; })()`);
const readPanel = () =>
  d.ev(`(() => { const p = document.querySelector('[data-testid="backlinks-panel"]');
    return p ? Array.from(p.querySelectorAll('li')).map((x) => x.textContent.trim()) : null; })()`);

let failure = null;
const stale = fixtureIds();
if (stale.length) console.log(`INFO 清掉上一次残留夹具 ${stale.length} 条`);
for (const id of stale) await call('delete_note', { id });
await sleep(400);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

try {
  await gotoStream();
  const targetId = await createNote(TARGET);
  const source1Id = await createNote(SOURCE1);
  const source2Id = await createNote(SOURCE2);
  console.log(`INFO 夹具 id:目标=${targetId} 来源甲=${source1Id} 来源乙=${source2Id}`);

  // --- 读数 1:目标卡片底部没有「被引用 2」徽标 ---
  const badge = await waitFor(() => readBadge(targetId).then((x) => (x?.found ? x : null)), 30, 300);
  record(
    '读数1 目标卡片无「被引用」徽标(无 backlink-count 节点、文本不含「被引用」)',
    badge?.badge === false && badge?.text.includes('被引用') === false,
    `卡片读数=${fmt(badge)}`
  );

  // --- 读数 2:编辑面板反向引用面板仍列出两条来源(只读无按钮) ---
  const opened = await readEditorBacklinks(targetId);
  const inEdit = await waitFor(() => d.ev(`!!document.querySelector('[data-testid="edit-panel"]')`), 20, 250);
  const items = await waitFor(() => readPanel(), 20, 250);
  const btnCount = await d.ev(`document.querySelectorAll('[data-testid="backlinks-panel"] button').length`);
  const sorted = (items ?? []).slice().sort();
  record(
    '读数2 编辑面板底部仍列出两条来源首行(只读,无跳转按钮)',
    opened.found === true &&
      inEdit === true &&
      btnCount === 0 &&
      fmt(sorted) === fmt([S1, S2].sort()),
    `进编辑=${inEdit} 面板条目=${fmt(items)} 按钮数=${btnCount}`
  );

  await d.esc();
  await sleep(500);
  const afterEsc = await readBadge(targetId);
  record(
    '读数3 收起编辑后面板消失、卡片仍无「被引用」徽标',
    afterEsc?.badge === false && afterEsc?.text.includes('被引用') === false,
    `卡片读数=${fmt(afterEsc)}`
  );
} catch (e) {
  failure = e;
} finally {
  for (const id of fixtureIds()) await call('delete_note', { id });
  const gone = await waitFor(() => (fixtureIds().length === 0 ? true : null), 12, 250);
  const after = counts();
  const diff = ['entities', 'edges', 'fts'].filter((k) => after[k] !== base[k]);
  record(
    '收尾 夹具删净 + 库对账(逐项回到基线 + integrity + user_version)',
    gone === true && diff.length === 0 && after.integrity === 'ok' && after.version === base.version,
    `残留夹具=${fmt(fixtureIds())} 不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 基线=${fmt(base)} 收尾=${fmt(after)}`
  );
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
