#!/usr/bin/env node
/**
 * 笔记间链接 L4 的真机读数(设计 docs/superpowers/specs/2026-10-01-note-links-design.md §6 读数 8,D12):
 *   8a 后端:`graph_data` 里有两条 `kind:'link'` 的边,两端是**笔记** id,与库 note_links 逐条一致
 *   8b 画布:展开夹具标签 -> 恰好 2 条 accent 1.5 的 link 段,四个端点就是那两个笔记小圆
 *      (展开前 0 条);段与点都是画布原型的真实调用,不经视图代码
 *   8c 信息条:「出链 2 / 入链 2」,与库(该标签含子孙的已解析链接数)一致
 *   收尾 夹具(两条笔记 + LINK测试 标签)删净 + 库对账逐项回基线
 *
 * 夹具一律 `LINK测试` 前缀、自建自删;真实库除本脚本自建的笔记与标签外只读。
 * 用法:先起应用(WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" pnpm tauri dev),
 *      再 LIFELOG_CDP_PORT=9222 node scripts/dev-links-accept-l4.mjs
 */
import { CDP_PORT, ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { BOX, driver } from './unified-accept-lib.mjs';
import { bindUi } from './no-tabs-accept-lib.mjs';
import { all, counts, degreeOf, fixtureNoteIds, fixtureTagIds, get } from './graph-accept-l4-db.mjs';
import { armGraph, closeGraph } from './graph-accept-lib.mjs';
import { clickText, positionsEqual, setSearch } from './graph-accept-g3-lib.mjs';
import { focusSearch, keyPress } from './graph-accept-g2-lib.mjs';
import { installL4, linkSegs, readL4, samePair, waitL4 } from './graph-accept-l4-canvas.mjs';

const NS = 'LINK测试';
const TAG = `${NS}/L4`;
const A = `${NS} L4甲`;
const B = `${NS} L4乙`;
const SRC_B = `${B}\n#${TAG}`; // 先建 B:那时 A 还不存在
const SRC_A = `${A}\n#${TAG}\n[[${B}]]`;
const SRC_B2 = `${SRC_B}\n[[${A}]]`; // A 落库后再补 B -> A

const fmt = (v) => JSON.stringify(v);

const r = recorder();
const { record, finish } = r;

if (!(await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((x) => x.ok, () => false))) {
  console.log(`需要先起应用:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT}" pnpm tauri dev`);
  process.exit(2);
}
const conn = await ensureMain();
const ui = bindUi(conn.cdp);
const d = driver(conn.cdp);
const ev = (e) => conn.cdp.eval(e);
const call = (cmd, args = {}) =>
  ev(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

/** 回信息流并重载(新笔记要进 DOM;上次跑完可能留在关系图里) */
const gotoStream = async () => {
  await d.esc();
  await d.clearChips();
  await conn.cdp.send('Page.reload');
  await waitFor(() => ev(`!!document.querySelector('${BOX}')`).catch(() => false), 60, 500);
  await sleep(1200);
};

/** 走真实保存路径建笔记(统一输入框 + Ctrl+Enter),返回落库 id */
const createNote = async (text) => {
  await d.clearBox();
  await d.type(text);
  await d.ctrlEnter();
  const id = await waitFor(() => get(`SELECT id FROM notes WHERE content LIKE ?1 ORDER BY id DESC LIMIT 1`, `${text.split('\n')[0]}%`)?.id, 24, 250);
  if (id == null) throw new Error(`建笔记失败:库里找不到首行为 ${fmt(text.split('\n')[0])} 的笔记`);
  return id;
};

let failure = null;
const stale = [...fixtureNoteIds()];
if (stale.length) console.log(`INFO 清掉上一次残留夹具笔记 ${stale.length} 条`);
for (const id of stale) await call('delete_note', { id }).catch(() => null);
for (const id of fixtureTagIds()) await call('delete_tag', { tagId: id }).catch(() => null);
await sleep(400);
const base = { ...counts(), positions: await call('get_setting', { key: 'graph_positions' }) };
console.log(`INFO 基线=${fmt(base)}`);

try {
  await gotoStream();
  const bId = await createNote(SRC_B);
  const aId = await createNote(SRC_A);
  // A 落库后把 B 的链接补上(先建 B 时 A 还不存在,那条写进去只会是未解析)
  await call('update_note', { id: bId, content: SRC_B2 });
  await sleep(500);
  const rows = all(
    `SELECT source_id, target_id FROM note_links WHERE source_id IN (?1, ?2) OR target_id IN (?1, ?2) ORDER BY id`,
    aId,
    bId,
  );
  const tagId = get(`SELECT id FROM tags WHERE path = ?1`, TAG)?.id ?? null;
  console.log(`INFO 夹具 id:甲=${aId} 乙=${bId} 标签=${tagId};库 note_links=${fmt(rows)}`);

  // --- 读数 8a:后端 link 边 ---
  const data = await call('graph_data');
  const links = (data.edges ?? []).filter((e) => e.kind === 'link').map((e) => [e.a, e.b]).sort((x, y) => x[0] - y[0]);
  const wantLinks = rows.map((x) => [x.source_id, x.target_id]).sort((x, y) => x[0] - y[0]);
  record(
    '读数8a graph_data 的 kind:link 边与库 note_links 逐条一致(两端是笔记 id)',
    tagId !== null && rows.length === 2 && fmt(links) === fmt(wantLinks),
    `graph_data 的 link 边=${fmt(links)}(期望 ${fmt(wantLinks)};库两行=${fmt(rows.map((x) => [x.source_id, x.target_id]))})`,
  );

  // --- 读数 8b/8c:进图 -> 搜索选中夹具标签 -> 信息条 -> 展开 -> 画布 ---
  await armGraph(ui);
  const opened = await waitFor(() => ev(`!!document.querySelector('[data-testid="graph-view"] canvas')`), 40, 400);
  await installL4(conn.cdp);
  await setSearch(conn.cdp, TAG);
  await sleep(400);
  await focusSearch(conn.cdp);
  await keyPress(conn.cdp, 'Enter', 'Enter', 13);
  const barPath = await waitFor(
    () => ev(`document.querySelector('[data-testid="graph-info-bar"] div')?.textContent ?? null`),
    20,
    300,
  );
  const before = await readL4(conn.cdp);
  const degreesText = await waitFor(async () => {
    const t = await ev(`document.querySelector('[data-testid="graph-link-degrees"]')?.textContent ?? null`);
    return t !== null && !t.includes('–') ? t : null;
  }, 24, 300);
  const want = degreeOf(tagId);
  const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  record(
    '读数8c 信息条「出链 N / 入链 M」与库一致(该标签含子孙的已解析链接)',
    barPath === TAG && flat(degreesText) === `出链 ${want.outbound} / 入链 ${want.backlinks}` && want.outbound === 2 && want.backlinks === 2,
    `信息条路径=「${barPath}」(期望 ${TAG});度数文案=「${flat(degreesText)}」;库=${fmt({ outbound: want.outbound, backlinks: want.backlinks })}`,
  );

  await clickText(conn.cdp, '展开笔记', '[data-testid="graph-info-bar"]');
  const frame = await waitL4(conn.cdp, (f) => f.dots.length === 2 && linkSegs(f).length > 0);
  const segs = frame === null ? [] : linkSegs(frame);
  const dotsOk = frame !== null && frame.dots.length === 2;
  record(
    '读数8b 展开标签:两条互引笔记之间画出 2 条 accent 1.5 的 link 段(展开前 0 条)',
    opened === true &&
      before !== null &&
      linkSegs(before).length === 0 &&
      dotsOk &&
      segs.length === 2 &&
      segs.every((s) => samePair(s, segs[0], frame.dots)),
    `展开前 link 段=${before === null ? 'null' : linkSegs(before).length};展开后笔记小圆=${frame === null ? 'null' : frame.dots.length} ` +
      `(期望 2)link 段=${segs.length}(期望 2)端点均落在小圆上=${frame !== null && dotsOk && segs.every((s) => samePair(s, segs[0], frame.dots))};` +
      `段=${fmt(segs.map((s) => [s.x1, s.y1, s.x2, s.y2]))} 小圆=${fmt(frame?.dots ?? [])} accent=${frame?.accent ?? 'null'}`,
  );
} catch (e) {
  failure = e;
} finally {
  await closeGraph(ui).catch(() => false);
  for (const id of fixtureNoteIds()) await call('delete_note', { id }).catch(() => null);
  for (const id of fixtureTagIds()) await call('delete_tag', { tagId: id }).catch(() => null);
  const gone = await waitFor(() => (fixtureNoteIds().length === 0 && fixtureTagIds().length === 0 ? true : null), 16, 300);
  await sleep(400);
  const after = { ...counts(), positions: await call('get_setting', { key: 'graph_positions' }) };
  const diff = ['notes', 'tags', 'tagLinks', 'fts', 'noteLinks'].filter((k) => after[k] !== base[k]);
  record(
    '收尾 夹具(笔记 + LINK测试 标签)删净 + 库对账(逐项回基线 + integrity + user_version + graph_positions)',
    gone === true && diff.length === 0 && after.integrity === 'ok' && after.version === 27 && positionsEqual(after.positions, base.positions),
    `残留夹具=${fmt({ notes: fixtureNoteIds(), tags: fixtureTagIds() })} 不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 基线=${fmt(base)} 收尾=${fmt(after)}`,
  );
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
