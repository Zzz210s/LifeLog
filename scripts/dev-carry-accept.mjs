#!/usr/bin/env node
/**
 * 标签携带标签(spec docs/superpowers/specs/2026-10-05-tag-carry-design.md §8)的端到端读数 1–10 + S1/S2:
 *   1 数据:添加/移除后 'tag' 行数正确、重复添加不增行、删携带者随 CASCADE 消失
 *   2 拒绝:自携带 / 2 环 / 3 环 → 中文提示且不写库
 *   3 筛选:命中 = 直接挂的 + 经由携带的(两路分别量,先量无携带基线)
 *   4 排除:与包含侧互补(无黑洞)
 *   5 摘要:条件栏出现 `+携带` 小字(先用库/命令侧确认该标签确有携带者)
 *   6 计数:侧栏标签行计数前后逐值不变
 *   7 回归:笔记 tags 列 / FTS / 导出结果不因携带行变化(R1)
 *   8 孤儿:只被携带的空壳标签不被回收(R2)
 *   9 性能:筛一个标签 带携带 vs 无携带 的**比值**(抓数量级劣化)
 *   10 悬空:删掉被携带的标签后不留悬空行(R5)
 *   S1 继承:携带沿子树向下继承 —— 挂 甲/子 的笔记也因「甲携带乙」命中 乙
 *   S2 不传递:甲携带乙、乙携带丙 ≠ 甲携带丙 —— 筛 丙 不得命中只挂 甲 的笔记
 * 夹具一律 `携带测试` 前缀,自建自删并打印前后计数;不碰物理鼠标(合成键鼠 + IPC)。
 * 用法:先以 CDP 端口启动应用,再 `node scripts/dev-carry-accept.mjs`;库路径见 carry-accept-lib.mjs。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ensureMain, recorder } from './cdp-lib.mjs';
import {
  addCarryViaPanel, appNoteTags, carrierPathsOf, carryRowsFrom, carryRowsTo, cascadeDeleteProbe, clearChips, clickTagPath, condIds,
  counts, danglingTagRows, excludeCond, fixtureNoteIds, fixtureTagIds, fmt, ipc, noteIdOf, orphanShellProbe,
  pressEsc, purgeCarryFixtures, queryCount, relationOutPaths, requireApp, sleep, summaryCarryMarks, summaryText,
  tagCond, tagCountsViaApp, tagIdOf, timeWithAndWithoutCarry, waitFor, xlsxContentDigest,
} from './carry-accept-lib.mjs';

const NS = '携带测试';
const A = `${NS}甲`, B = `${NS}乙`, C = `${NS}丙`, D = `${NS}丁`, AS = `${A}/子`;
const NA = `${NS}甲笔记`, NB = `${NS}乙笔记`, NC = `${NS}丙笔记`, ND = `${NS}丁笔记`, NAS = `${NS}甲子笔记`, NO = `${NS}其他笔记`;
const [E1, E2] = ['before', 'after'].map((n) => join(tmpdir(), `carry-accept-${n}.xlsx`));
const r = recorder(), { record } = r;

await requireApp();
const conn = await ensureMain(), cdp = conn.cdp;
const call = (cmd, args = {}) => ipc(cdp, cmd, args);

let failure = null, filterBefore = null;
const pre = [...fixtureNoteIds()];
if (pre.length) console.log(`INFO 清掉上一次残留夹具笔记 ${pre.length} 条`);
await purgeCarryFixtures(call);
await sleep(400);
const base = counts();
filterBefore = await call('get_setting', { key: 'filter_current' });
console.log(`INFO 基线=${fmt(base)}`);

try {
  // --- 夹具:五条笔记(甲/甲子/乙/丙 各一条 + 一条无标签),都走真实保存路径 ---
  for (const [title, tag] of [[NA, A], [NAS, AS], [NB, B], [NC, C], [NO, null]]) {
    await call('save_input_note', { content: tag === null ? title : `${title}\n#${tag}` });
  }
  await cdp.send('Page.reload'); // 夹具落库后重载,侧栏标签树才拿得到这几行
  await waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 500);
  await sleep(1100);
  const idA = noteIdOf(NA), idAs = noteIdOf(NAS), idB = noteIdOf(NB), idC = noteIdOf(NC), idN = noteIdOf(NO);
  const tA = tagIdOf(A), tAs = tagIdOf(AS), tB = tagIdOf(B), tC = tagIdOf(C);
  const tagBefore = await tagCountsViaApp(cdp);
  const tagsBefore = await appNoteTags(cdp, NS, idA), ftsBefore = counts().fts;
  await call('export_notes', { path: E1 });
  const d1 = xlsxContentDigest(E1);
  record('夹具就绪', [idA, idAs, idB, idC, idN, tA, tAs, tB, tC].every((x) => x != null),
    `笔记=${fmt({ idA, idAs, idB, idC, idN })} 标签=${fmt({ tA, tAs, tB, tC })} 基线=${fmt(base)}`);

  // --- 8.1 数据:先经界面「引用…」面板添加(甲 携带 乙,携带已并入标签关系档) ---
  const panel = await addCarryViaPanel(cdp, A, B, tB);
  const added = await waitFor(() => (carryRowsFrom(tA) === 1 && carryRowsTo(tB) === 1 ? true : null), 12, 250);
  record('读数1a 界面「引用…」面板添加 甲→乙:库 tag 行 =1 且方向正确',
    panel.menu === true && panel.menuItem === true && panel.paneOpen === true && panel.picked === true && added === true,
    `菜单=${panel.menu}/${panel.menuItem} 面板=${panel.paneOpen} 选候选=${panel.picked} 库行=${carryRowsFrom(tA)}/${carryRowsTo(tB)} 面板读数=${fmt(panel.pane)}`);

  // 8.1b/idempotent + 8.1c 双向读数(IPC 路径)
  await call('set_tag_relation', { fromTag: tA, toTag: tB, remark: '' });
  const idem = carryRowsFrom(tA);
  const outA = await relationOutPaths(call, tA);
  const carriersB = carrierPathsOf(tB);
  record('读数1b 重复添加不增行 + 出边/入边双向一致',
    idem === 1 && fmt(outA) === fmt([B]) && fmt(carriersB) === fmt([A]),
    `重复后甲行=${idem}(期望 1) 甲出边=${fmt(outA)} 乙携带者=${fmt(carriersB)}`);

  // --- 8.2 拒绝:自携带 / 2 环 / 3 环。真实库有既有携带行,故按「拒绝前后不变」相对判定(被拒的两次不动,仅合法那笔 +1) ---
  const carryPre = counts().carryRows;
  const selfErr = await call('set_tag_relation', { fromTag: tA, toTag: tA, remark: '' }).then(() => '', (e) => String(e));
  const cyc2 = await call('set_tag_relation', { fromTag: tB, toTag: tA, remark: '' }).then(() => '', (e) => String(e));
  const rows1 = counts().carryRows;
  await call('set_tag_relation', { fromTag: tB, toTag: tC, remark: '' });
  const cyc3 = await call('set_tag_relation', { fromTag: tC, toTag: tA, remark: '' }).then(() => '', (e) => String(e));
  const rows2 = counts().carryRows;
  record('读数2 自携带/2 环/3 环都给中文提示且不写库(基线相对:拒绝不动、仅合法一笔 +1)',
    selfErr.includes('指向自己') && cyc2.includes('循环') && cyc3.includes('循环') && rows1 === carryPre && rows2 === carryPre + 1,
    `拒绝前 carryRows=${carryPre}(含真实库既有 24 行);自携带=「${selfErr}」→${rows1}(须=${carryPre});2环=「${cyc2}」→${rows1}(须=${carryPre});3环=「${cyc3}」→${rows2}(须=${carryPre + 1},仅合法 乙→丙 的一笔)`);

  // --- 8.3 筛选:拆两路 —— 先量「无携带」基线的直接命中,再加携带量继承来的 ---
  await call('remove_tag_relation', { fromTag: tA, toTag: tB });
  const hitDirect = await queryCount(cdp, tagCond(B));
  await call('set_tag_relation', { fromTag: tA, toTag: tB, remark: '' });
  const hitB = await queryCount(cdp, tagCond(B));
  const hitA = await queryCount(cdp, tagCond(A));
  record('读数3 筛 乙 = 直接挂 1 + 经 甲 携带 2(含 挂 甲/子 的那条);筛 甲 = 2',
    hitDirect === 1 && hitB === 3 && hitA === 2,
    `无携带时 筛乙=${hitDirect}(直接 N=1);加携带后 筛乙=${hitB}(直接 ${hitDirect} + 经携带 ${hitB - hitDirect});筛甲=${hitA}(甲 1 + 甲/子 1);全库=${counts().notes}`);

  // --- S1(spec §4):携带沿子树向下继承 —— 挂 甲/子(甲的子孙)的笔记也命中 乙 ---
  const setB = await condIds(cdp, tagCond(B));
  record('读数S1 携带者子树继承:挂 甲 与 挂 甲/子 的笔记都因「甲携带乙」命中 乙',
    setB.includes(idA) && setB.includes(idAs) && !setB.includes(idC),
    `筛乙 命中 id=${fmt(setB)};含挂甲=${setB.includes(idA)} 含挂甲/子=${setB.includes(idAs)} 含挂丙=${setB.includes(idC)}(应 false)`);

  // --- S2(spec §4):只查一跳,不传递 —— 甲→乙、乙→丙 时,筛 丙 不得命中只挂 甲 的笔记 ---
  const [setA, setC] = await Promise.all([tagCond(A), tagCond(C)].map((c) => condIds(cdp, c)));
  record('读数S2 只查一跳不传递:只挂 甲 的笔记 不因 甲→乙→丙 命中 丙;筛甲/筛乙 正常命中',
    !setC.includes(idA) && !setC.includes(idAs) && setC.includes(idB) && setC.includes(idC) && setA.includes(idA) && setB.includes(idA),
    `筛丙 命中 id=${fmt(setC)}(须不含 甲笔记 ${idA} / 甲子笔记 ${idAs});筛甲 含甲笔记=${setA.includes(idA)};筛乙 含甲笔记=${setB.includes(idA)}`);

  // --- 8.4 排除与包含互补 ---
  const total = counts().notes;
  const exclB = await queryCount(cdp, excludeCond(B));
  record('读数4 包含 + 排除 = 全库(无黑洞)', hitB + exclB === total, `包含(乙)=${hitB} + 排除(乙)=${exclB} = ${hitB + exclB}(全库 ${total})`);

  // --- 8.5 摘要 `+携带`:库/命令侧独立确认「乙 有携带者、甲 没有」,再与 DOM 标记比对 ---
  await clearChips(cdp);
  await clickTagPath(cdp, B);
  await sleep(500);
  const marks = await summaryCarryMarks(cdp);
  const stext = await summaryText(cdp);
  const carriersOfB = carrierPathsOf(tB);
  await clearChips(cdp);
  await clickTagPath(cdp, A);
  await sleep(500);
  const marksA = await summaryCarryMarks(cdp);
  await clearChips(cdp);
  record('读数5 条件栏 `+携带`:库/命令侧确认 乙 有携带者(甲)、甲 无携带者,再与 DOM 标记比对',
    carryRowsTo(tB) === 1 && fmt(carriersOfB) === fmt([A]) && marks === 1 && String(stext).includes('+携带') && marksA === 0,
    `库:指向乙的携带行=${carryRowsTo(tB)}、命令 carriersOf=${fmt(carriersOfB)} | DOM:筛乙 片段=${marks} 摘要=「${stext}」;筛甲 片段=${marksA}(应 0)`);

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

  // --- 8.9 性能 + 8.1d 移除:比值口径。携带只在筛选谓词里多一次物化集合成员判定,
  //     集合大小 = 携带行数(此处个位数),本机 40 次均值的噪声远低于 2 倍;
  //     故 3x 既能抓「数量级劣化」,又不会因调度抖动误报(绝对阈值 50ms 会放过 3–5x 劣化) ---
  const perf = await timeWithAndWithoutCarry(call, cdp, { carrierId: tA, carriedId: tB }, tagCond(B));
  const ratio = perf.msWith / perf.msWithout;
  record('读数1d+9 移除后甲行归零;筛 乙 耗时 带携带/无携带 比值 ≤3x(抓数量级劣化,不惩罚噪声)',
    carryRowsFrom(tA) === 0 && ratio <= 3,
    `移除后行=${carryRowsFrom(tA)};带携带=${perf.msWith.toFixed(2)}ms 无携带=${perf.msWithout.toFixed(2)}ms 比值=${ratio.toFixed(2)}x(阈值 3x)`);

  // --- 8.8 孤儿:只被携带的空壳标签不被 gc 回收 ---
  const shell = await orphanShellProbe(call, ND, D, tA);
  record('读数8 只被携带的空壳标签 丁 不被 gc 回收(R2)',
    shell.before != null && shell.after === shell.before && shell.notes === 0 && carryRowsTo(shell.before) === 1,
    `摘链接后 丁 id=${shell.after}(原 ${shell.before}) 笔记链接=${shell.notes} 指向 丁 的携带行=${carryRowsTo(shell.before)}`);

  // --- 8.10 悬空:删掉被携带的 丁 ---
  await call('delete_tag', { tagId: shell.before });
  await sleep(400);
  record('读数10 删掉被携带的标签后悬空携带行 = 0(R5)',
    danglingTagRows() === 0 && carryRowsTo(shell.before) === 0, `悬空行=${danglingTagRows()} 指向 丁 的行=${carryRowsTo(shell.before)}`);

  // --- 8.1e 删携带者随 CASCADE 消失 ---
  await call('remove_tag_relation', { fromTag: tB, toTag: tC });
  const casc = await cascadeDeleteProbe(call, tC, tB);
  record('读数1e 删除携带者 丙:它的携带行随 CASCADE 消失',
    casc.rowsFromX === 0 && casc.after === casc.before - 1,
    `删前 carryRows=${casc.before} 删后=${casc.after} 丙 出行=${casc.rowsFromX}`);
} catch (e) {
  failure = e;
}

// --- 收尾:条件栏还原 + 夹具删净 + 库对账 ---
try {
  await pressEsc(cdp).catch(() => null);
  await clearChips(cdp).catch(() => null);
  if (filterBefore != null) await call('set_setting', { key: 'filter_current', value: filterBefore });
  await purgeCarryFixtures(call);
  await sleep(500);
  const after = counts();
  const diff = Object.keys(base).filter((k) => after[k] !== base[k]);
  record('收尾 夹具删净 + 库对账(回基线 + integrity)',
    fixtureNoteIds().length === 0 && fixtureTagIds().length === 0 && diff.length === 0 && after.integrity === 'ok',
    `残留=${fmt({ notes: fixtureNoteIds(), tags: fixtureTagIds() })} 不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 收尾=${fmt(after)}`);
} catch (e) {
  record('收尾 异常', false, String(e?.message ?? e));
}
for (const f of [E1, E2]) rmSync(f, { force: true });

if (failure) record('异常中断', false, String(failure?.message ?? failure));
r.finish();
conn.close();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
