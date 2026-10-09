// 「主脚本用的机械动作」(自 `carry-accept-lib.mjs` 拆出,守 200 行上限):只搬数据 / 发事件,
// 判定一律留在主脚本。经 carry-accept-lib 再出口,既有 import 路径不变。
import { sleep, waitFor } from './cdp-lib.mjs';
import {
  carryRowsFrom, carryPane, clickCarryMenuItem, counts, fixtureNoteIds, fixtureTagIds,
  get, noteIdOf, openTagMenu, pickCarryCandidate, pressEsc, tagIdOf, timeQuery, typeCarryQuery,
} from './carry-accept-lib.mjs';

/** 删净全部 `携带测试*` 夹具(笔记先删 → 标签按 depth DESC 删) */
export async function purgeCarryFixtures(call) {
  for (const id of fixtureNoteIds()) await call('delete_note', { id }).catch(() => null);
  for (const id of fixtureTagIds()) await call('delete_tag', { tagId: id }).catch(() => null);
}

/** 走界面「引用…」面板添加一条关系:回各步 DOM 读数(判定留在主脚本) */
export async function addCarryViaPanel(cdp, from, to, toId) {
  const menu = await openTagMenu(cdp, from);
  const menuItem = await waitFor(() => clickCarryMenuItem(cdp).catch(() => false), 8, 200);
  const paneOpen = await waitFor(() => cdp.eval(`!!document.querySelector('[aria-label="添加引用目标"]')`), 10, 150);
  await typeCarryQuery(cdp, to);
  await sleep(200);
  const picked = await waitFor(() => pickCarryCandidate(cdp, toId), 8, 200);
  const pane = await carryPane(cdp);
  await pressEsc(cdp);
  return { menu, menuItem, paneOpen, picked, pane };
}

/** 带携带 vs 移除携带 后筛同一条件的耗时(各 n 次均值)+ 移除后的携带行数 */
export async function timeWithAndWithoutCarry(call, cdp, { carrierId, carriedId }, cond, n = 40) {
  const msWith = await timeQuery(cdp, cond, n);
  await call('remove_tag_relation', { fromTag: carrierId, toTag: carriedId });
  const removed = carryRowsFrom(carrierId);
  const msWithout = await timeQuery(cdp, cond, n);
  return { msWith, msWithout, removed };
}

/** 空壳标签探针:笔记挂 tagPath → 该标签被 carrierId 携带 → 摘掉笔记链接(触发 gc),回读前后 id / 笔记链接数 */
export async function orphanShellProbe(call, noteTitle, tagPath, carrierId) {
  await call('save_input_note', { content: `${noteTitle}\n#${tagPath}` });
  await sleep(500);
  const before = tagIdOf(tagPath);
  await call('set_tag_relation', { fromTag: carrierId, toTag: before, remark: '' });
  await call('update_note', { id: noteIdOf(noteTitle), content: noteTitle });
  await sleep(500);
  const after = tagIdOf(tagPath);
  const notes = get("SELECT COUNT(*) n FROM tag_links WHERE target_type='note' AND tag_id=?1", before).n;
  return { before, after, notes };
}

/** CASCADE 探针:让 x 携带 y 之后删掉 x,回读删前/删后的携带行总数与 x 名下的行数 */
export async function cascadeDeleteProbe(call, x, y) {
  await call('set_tag_relation', { fromTag: x, toTag: y, remark: '' });
  const before = counts().carryRows;
  await call('delete_tag', { tagId: x });
  await sleep(400);
  return { before, after: counts().carryRows, rowsFromX: carryRowsFrom(x) };
}
