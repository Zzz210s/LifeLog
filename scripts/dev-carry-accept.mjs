#!/usr/bin/env node
/**
 * 标签携带标签(spec docs/superpowers/specs/2026-10-05-tag-carry-design.md §8)的端到端读数 1–10:
 *   1 数据:添加/移除后 'tag' 行数正确、重复添加不增行、删携带者随 CASCADE 消失
 *   2 拒绝:自携带 / 2 环 / 3 环 → 中文提示且不写库
 *   3 筛选:命中 = 直接挂的 + 经由携带的(自建夹具验证具体条数)
 *   4 排除:与包含侧互补(无黑洞)
 *   5 摘要:条件栏出现 `+携带` 小字
 *   6 计数:侧栏标签行计数前后逐值不变
 *   7 回归:笔记 tags 列 / FTS / 导出结果不因携带行变化(R1)
 *   8 孤儿:只被携带的空壳标签不被回收(R2)
 *   9 性能:筛一个标签的耗时前后读数(R3)
 *   10 悬空:删掉被携带的标签后不留悬空行(R5)
 * 夹具一律 `携带测试` 前缀,自建自删并打印前后计数;不碰物理鼠标(合成键鼠 + IPC)。
 * 用法:先以 CDP 端口启动应用,再 `node scripts/dev-carry-accept.mjs`;库路径见 carry-accept-lib.mjs。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ensureMain, recorder } from './cdp-lib.mjs';
import {
  carryPane, carryRowsFrom, carryRowsTo, clickCarryMenuItem, clickTagPath, clearChips, counts, danglingTagRows,
  appNoteTags, excludeCond, fmt, fixtureNoteIds, fixtureTagIds, get, ipc, noteIdOf, openTagMenu, pickCarryCandidate,
  pressEsc, queryCount, requireApp, sleep, summaryCarryMarks, summaryText, tagCond, tagCountsViaApp, tagIdOf,
  timeQuery, typeCarryQuery, waitFor, xlsxContentDigest,
} from './carry-accept-lib.mjs';

const NS = '携带测试';
const A = `${NS}甲`, B = `${NS}乙`, C = `${NS}丙`, D = `${NS}丁`;
const NA = `${NS}甲笔记`, NB = `${NS}乙笔记`, NC = `${NS}丙笔记`, ND = `${NS}丁笔记`, NO = `${NS}其他笔记`;
const E1 = join(tmpdir(), 'carry-accept-before.xlsx');
const E2 = join(tmpdir(), 'carry-accept-after.xlsx');
const r = recorder();
const { record } = r;

await requireApp();
const conn = await ensureMain();
const cdp = conn.cdp;
const call = (cmd, args = {}) => ipc(cdp, cmd, args);

let failure = null;
let filterBefore = null;
const pre = [...fixtureNoteIds()];
if (pre.length) console.log(`INFO 清掉上一次残留夹具笔记 ${pre.length} 条`);
for (const id of pre) await call('delete_note', { id }).catch(() => null);
for (const id of fixtureTagIds()) await call('delete_tag', { tagId: id }).catch(() => null);
await sleep(400);
const base = counts();
filterBefore = await call('get_setting', { key: 'filter_current' });
console.log(`INFO 基线=${fmt(base)}`);

try {
  // --- 夹具:三条带标签笔记 + 一条无标签笔记(都走真实保存路径) ---
  for (const [title, tag] of [[NA, A], [NB, B], [NC, C], [NO, null]]) {
    await call('save_input_note', { content: tag === null ? title : `${title}\n#${tag}` });
  }
  await cdp.send('Page.reload'); // 夹具落库后重载,侧栏标签树才拿得到这几行
  await waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 500);
  await sleep(1100);
  const idA = noteIdOf(NA), idB = noteIdOf(NB), idC = noteIdOf(NC), idN = noteIdOf(NO);
  const tA = tagIdOf(A), tB = tagIdOf(B), tC = tagIdOf(C);
  const tagBefore = await tagCountsViaApp(cdp);
  const tagsBefore = await appNoteTags(cdp, NS, idA);
  const ftsBefore = counts().fts;
  await call('export_notes', { path: E1 });
  const d1 = xlsxContentDigest(E1);
  record('夹具就绪', [idA, idB, idC, idN, tA, tB, tC].every((x) => x != null),
    `笔记=${fmt({ idA, idB, idC, idN })} 标签=${fmt({ tA, tB, tC })} 基线=${fmt(base)}`);

  // --- 8.1 数据:先经界面「携带…」面板添加(甲 携带 乙) ---
  const menuOk = await openTagMenu(cdp, A);
  const menuItem = await waitFor(() => clickCarryMenuItem(cdp).catch(() => false), 8, 200);
  const paneOk = await waitFor(() => cdp.eval(`!!document.querySelector('[aria-label="添加携带标签"]')`), 10, 150);
  await typeCarryQuery(cdp, B);
  await sleep(200);
  const picked = await waitFor(() => pickCarryCandidate(cdp, B), 8, 200);
  const added = await waitFor(() => (carryRowsFrom(tA) === 1 && carryRowsTo(tB) === 1 ? true : null), 12, 250);
  const pane = await carryPane(cdp);
  await pressEsc(cdp);
  record('读数1a 界面「携带…」面板添加 甲→乙:库 tag 行 =1 且方向正确',
    menuOk === true && menuItem === true && paneOk === true && picked === true && added === true,
    `菜单=${menuOk}/${menuItem} 面板=${paneOk} 选候选=${picked} 库行=${carryRowsFrom(tA)}/${carryRowsTo(tB)} 面板读数=${fmt(pane)}`);

  // 8.1b/idempotent + 8.1c 双向读数(IPC 路径)
  await call('set_tag_carry', { carrierId: tA, carriedId: tB });
  const idem = carryRowsFrom(tA);
  const repA = await call('list_tag_carries', { carrierId: tA });
  const repB = await call('list_tag_carries', { carrierId: tB });
  record('读数1b 重复添加不增行 + list_tag_carries 双向一致',
    idem === 1 && fmt(repA.carried.map((x) => x.path)) === fmt([B]) && fmt(repB.carriersOf.map((x) => x.path)) === fmt([A]),
    `重复后甲行=${idem}(期望 1) 甲.carried=${fmt(repA.carried.map((x) => x.path))} 乙.carriersOf=${fmt(repB.carriersOf.map((x) => x.path))}`);

  // --- 8.2 拒绝:自携带 / 2 环 / 3 环 ---
  const selfErr = await call('set_tag_carry', { carrierId: tA, carriedId: tA }).then(() => '', (e) => String(e));
  const cyc2 = await call('set_tag_carry', { carrierId: tB, carriedId: tA }).then(() => '', (e) => String(e));
  const rows1 = counts().carryRows;
  await call('set_tag_carry', { carrierId: tB, carriedId: tC });
  const cyc3 = await call('set_tag_carry', { carrierId: tC, carriedId: tA }).then(() => '', (e) => String(e));
  const rows2 = counts().carryRows;
  record('读数2 自携带/2 环/3 环都给中文提示且不写库',
    selfErr.includes('不能携带自己') && cyc2.includes('循环') && cyc3.includes('循环') && rows1 === 1 && rows2 === 2,
    `自携带=「${selfErr}」;2环=「${cyc2}」不增行(=${rows1});3环=「${cyc3}」不增行(=${rows2})`);

  // --- 8.3 筛选:甲 携带 乙 → 筛 乙 命中 = 直接 1 + 经甲 1 = 2 ---
  const hitB = await queryCount(cdp, tagCond(B));
  const hitA = await queryCount(cdp, tagCond(A));
  record('读数3 筛 乙 命中 2(=直接挂 1 + 经由 甲 携带 1);筛 甲 命中 1',
    hitB === 2 && hitA === 1, `命中(乙)=${hitB}(期望 2) 命中(甲)=${hitA}(期望 1) 全库=${counts().notes}`);

  // --- 8.4 排除与包含互补 ---
  const total = counts().notes;
  const exclB = await queryCount(cdp, excludeCond(B));
  record('读数4 包含 + 排除 = 全库(无黑洞)', hitB + exclB === total, `包含(乙)=${hitB} + 排除(乙)=${exclB} = ${hitB + exclB}(全库 ${total})`);

  // --- 8.5 摘要 `+携带` ---
  await clearChips(cdp);
  await clickTagPath(cdp, B);
  await sleep(500);
  const marks = await summaryCarryMarks(cdp);
  const stext = await summaryText(cdp);
  record('读数5 条件栏摘要出现 `+携带` 小字', marks === 1 && String(stext).includes('+携带'), `片段数=${marks} 摘要=「${stext}」`);

  // --- 8.6 侧栏计数前后逐值不变 ---
  const snap = await tagCountsViaApp(cdp);
  const snapDiff = snap.filter((x, i) => x !== tagBefore[i]);
  record('读数6 侧栏标签行计数前后逐值不变(不算携带命中)', fmt(snap) === fmt(tagBefore), `差异=${fmt(snapDiff)}`);

  // --- 8.7 回归:笔记 tags / FTS / 导出 ---
  await call('export_notes', { path: E2 });
  const tagsAfter = await appNoteTags(cdp, NS, idA);
  const regOk = fmt(tagsAfter) === fmt(tagsBefore) && counts().fts === ftsBefore && xlsxContentDigest(E2) === d1;
  record('读数7 笔记 tags 列 / FTS 计数 / 导出内容均不因携带行变化(R1)',
    regOk, `tags=${fmt(tagsAfter)}(前 ${fmt(tagsBefore)}) FTS=${counts().fts}(前 ${ftsBefore}) 导出内容摘要=${xlsxContentDigest(E2).slice(0, 16)} vs ${d1.slice(0, 16)}`);

  // --- 8.9 性能 + 8.1d 移除 ---
  const msWith = await timeQuery(cdp, tagCond(B));
  await call('remove_tag_carry', { carrierId: tA, carriedId: tB });
  const removed = carryRowsFrom(tA);
  const msWithout = await timeQuery(cdp, tagCond(B));
  record('读数1d+9 移除后甲行归零;筛 乙 耗时:带携带 vs 无携带',
    removed === 0 && msWith < 50 && msWithout < 50,
    `移除后行=${removed};带携带=${msWith.toFixed(2)}ms 无携带=${msWithout.toFixed(2)}ms(各 40 次均值)`);

  // --- 8.8 孤儿:只被携带的空壳标签不被 gc 回收 ---
  await call('save_input_note', { content: `${ND}\n#${D}` });
  await sleep(500);
  const tD = tagIdOf(D);
  await call('set_tag_carry', { carrierId: tA, carriedId: tD });
  await call('update_note', { id: noteIdOf(ND), content: ND }); // 摘掉笔记链接 → 触发 gc
  await sleep(500);
  const dShell = tagIdOf(D);
  const dNotes = get("SELECT COUNT(*) n FROM tag_links WHERE target_type='note' AND tag_id=?1", tD).n;
  record('读数8 只被携带的空壳标签 丁 不被 gc 回收(R2)',
    tD != null && dShell === tD && dNotes === 0 && carryRowsTo(tD) === 1,
    `摘链接后 丁 id=${dShell}(原 ${tD}) 笔记链接=${dNotes} 指向 丁 的携带行=${carryRowsTo(tD)}`);

  // --- 8.10 悬空:删掉被携带的 丁 ---
  await call('delete_tag', { tagId: tD });
  await sleep(400);
  record('读数10 删掉被携带的标签后悬空携带行 = 0(R5)',
    danglingTagRows() === 0 && carryRowsTo(tD) === 0, `悬空行=${danglingTagRows()} 指向 丁 的行=${carryRowsTo(tD)}`);

  // --- 8.1e 删携带者随 CASCADE 消失 ---
  await call('remove_tag_carry', { carrierId: tB, carriedId: tC });
  await call('set_tag_carry', { carrierId: tC, carriedId: tB });
  const beforeDel = counts().carryRows;
  await call('delete_tag', { tagId: tC });
  await sleep(400);
  record('读数1e 删除携带者 丙:它的携带行随 CASCADE 消失',
    carryRowsFrom(tC) === 0 && counts().carryRows === beforeDel - 1,
    `删前 carryRows=${beforeDel} 删后=${counts().carryRows} 丙 出行=${carryRowsFrom(tC)}`);
} catch (e) {
  failure = e;
}

// --- 收尾:条件栏还原 + 夹具删净 + 库对账 ---
try {
  await pressEsc(cdp).catch(() => null);
  await clearChips(cdp).catch(() => null);
  if (filterBefore != null) await call('set_setting', { key: 'filter_current', value: filterBefore });
  for (const id of fixtureNoteIds()) await call('delete_note', { id }).catch(() => null);
  for (const id of fixtureTagIds()) await call('delete_tag', { tagId: id }).catch(() => null);
  await sleep(500);
  const after = counts();
  const diff = Object.keys(base).filter((k) => after[k] !== base[k]);
  record('收尾 夹具删净 + 库对账(回基线 + integrity)',
    fixtureNoteIds().length === 0 && fixtureTagIds().length === 0 && diff.length === 0 && after.integrity === 'ok',
    `残留=${fmt({ notes: fixtureNoteIds(), tags: fixtureTagIds() })} 不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 收尾=${fmt(after)}`);
} catch (e) {
  record('收尾 异常', false, String(e?.message ?? e));
}
rmSync(E1, { force: true });
rmSync(E2, { force: true });

if (failure) record('异常中断', false, String(failure?.message ?? failure));
r.finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
