#!/usr/bin/env node
/**
 * 标签类型端到端读数,覆盖设计 §8 的 1–8:
 *   1 数据:登记/取消登记/认领/取消认领 的行数正确、重复认领幂等
 *   2 级联:删被登记标签 → is_type 标记与相关 type 行一起消失;删被认领标签 → 其认领行消失
 *   3 校验:携带目标指向未登记标签被拒(中文);指向已登记成功;携带面板候选只列已登记类型
 *   4 筛选:类型命中 = 被认领标签子树 ∪ 经携带命中;与排除侧互补;条件栏 chip 带命中数
 *   5 显示:树行类型徽章(最多 2 个 + `+N`);悬浮卡片列类型与携带;设置开关打开后树行出现携带
 *   6 建议:面板建议与依据正确;未确认前零写入;确认后只写被接受的条目
 *   7 回归:tags 的 path/depth/sort_order、笔记 tags 列、FTS、导出均不因类型而变
 *   8 性能:筛类型 与 筛同规模标签 耗时同量级
 * 夹具一律 `类型测试` 前缀(建议用例另加 `地点/类型测试城市`),自建自删并打印前后计数。
 * 用法:先以 CDP 端口启动 **dev 构建**,再 `node scripts/dev-types-accept.mjs`。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ensureMain, recorder } from './cdp-lib.mjs';
import {
  all, assertDevBuild, badgesOf, backToStream, carryToggleRoundTrip, checkSuggestion, chipTexts, claimTypeIds,
  claimRows, clickByLabel, counts, filterSuggestionsByType, findSuggestion, fixtureNoteIds,
  fixtureTagIds, FIX, fmt, ipc, isTypeTag, noteIdOf, pickTypeSection, purgeTypeFixtures, queryCount,
  raiseTypeFixtures, readCarryCandidates, requireApp, typeCond, excludeTypeCond, typeIdOfPath, typeRows,
  rowTipOf, sleep, suggestionRowText, tagCond, tagIdOf, timeQuery, waitFor, xlsxContentDigest,
} from './types-accept-lib.mjs';

const { NS, A, AS, B, C, E, F, R1, R2, R3, BASE, CITY } = FIX;
const [E1, E2] = ['before', 'after'].map((n) => join(tmpdir(), `types-accept-${n}.xlsx`));

await requireApp();
const dev = assertDevBuild();
const conn = await ensureMain(), cdp = conn.cdp;
const call = (cmd, args = {}) => ipc(cdp, cmd, args);
const r = recorder(), { record } = r;
let failure = null, filterBefore = null, suoWasType = false, suoTagId = null;
await purgeTypeFixtures(call);
await sleep(400);
const base = counts();
filterBefore = await call('get_setting', { key: 'filter_current' });
const tagsBefore = JSON.stringify(all("SELECT id,path,depth,sort_order FROM tags WHERE path NOT LIKE '时间/%' ORDER BY id"));
console.log(`INFO dev 构建=${dev} 基线=${fmt(base)}`);

try {
  // --- 夹具:每条标签各带一条笔记(类型标签也不例外);都走真实保存路径 ---
  await raiseTypeFixtures(call);
  await cdp.send('Page.reload');
  await waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 500);
  await sleep(1200);
  const tA = tagIdOf(A), tB = tagIdOf(B), tC = tagIdOf(C), tE = tagIdOf(E);
  const r1 = tagIdOf(R1), r2 = tagIdOf(R2), r3 = tagIdOf(R3), tCity = tagIdOf(CITY);
  const idA = noteIdOf(`${NS}甲笔记`), idB = noteIdOf(`${NS}乙笔记`);
  const ftsFixture = counts().fts;
  record('夹具就绪(dev 构建已确认)', [tA, tB, tC, tE, r1, r2, r3, tCity].every((x) => x != null),
    `dev=${dev} 标签=${fmt({ tA, tB, tC, tE, r1, r2, r3, tCity })} 笔记=${fmt({ idA, idB })}`);

  // --- §8.1 数据:登记幂等 / 认领整体替换幂等 / 取消认领 / 取消登记 ---
  const pre = { types: typeRows(), claims: claimRows() };
  await call('set_tag_type_flag', { tagId: r1, isType: true });
  await call('set_tag_type_flag', { tagId: r1, isType: true }); // 幂等
  await call('set_tag_type_flag', { tagId: r2, isType: true });
  await call('set_tag_type_flag', { tagId: r3, isType: true });
  const typesAfter = typeRows();
  await call('set_tag_types', { tagId: tB, typeIds: [r1, r2, r3] });
  await call('set_tag_types', { tagId: tB, typeIds: [r1, r2, r3] }); // 幂等
  const claimsAfter = claimRows();
  const bTypes = claimTypeIds(tB);
  await call('set_tag_types', { tagId: tC, typeIds: [r1] });
  await call('set_tag_types', { tagId: tC, typeIds: [] }); // 取消认领
  const cTypes = claimTypeIds(tC);
  await call('set_tag_type_flag', { tagId: r3, isType: false }); // 取消登记:连带删该类型的认领
  const afterUnreg = { types: typeRows(), claims: claimRows(), bTypes: claimTypeIds(tB) };
  await call('set_tag_type_flag', { tagId: r3, isType: true });
  await call('set_tag_types', { tagId: tB, typeIds: [r1, r2, r3] }); // 复原(后面徽章用例要用)
  record('读数1 登记/取消登记/认领/取消认领 行数正确且幂等',
    typesAfter === pre.types + 3 && claimsAfter === pre.claims + 3 && fmt(bTypes) === fmt([typeIdOfPath(R1), typeIdOfPath(R2), typeIdOfPath(R3)].sort((a, b) => a - b))
      && cTypes.length === 0 && afterUnreg.types === pre.types + 2 && afterUnreg.claims === pre.claims + 2 && afterUnreg.bTypes.length === 2,
    `types ${pre.types}->${typesAfter}->${afterUnreg.types};claims ${pre.claims}->${claimsAfter}->${afterUnreg.claims};乙认领=${fmt(bTypes.map((x) => x))};丙取消后=${cTypes.length};取消登记后乙=${afterUnreg.bTypes.length}`);

  // --- §8.2 级联 ---
  await call('set_tag_type_flag', { tagId: tE, isType: true });
  await call('set_tag_types', { tagId: tC, typeIds: [tE] });
  const cascPre = { types: typeRows(), claims: claimRows() };
  await call('delete_tag', { tagId: tE });
  await sleep(400);
  const cascMid = { types: typeRows(), claims: claimRows(), cTypes: claimTypeIds(tC) };
  record('读数2a 删被登记为类型的标签 → is_type 标记与相关 type 行一起消失',
    cascMid.types === cascPre.types - 1 && cascMid.claims === cascPre.claims - 1 && cascMid.cTypes.length === 0,
    `types ${cascPre.types}->${cascMid.types};claims ${cascPre.claims}->${cascMid.claims};丙的认领=${fmt(cascMid.cTypes)}`);
  await call('save_input_note', { content: `${NS}己笔记\n#${F}` });
  await sleep(400);
  const tf = tagIdOf(F);
  await call('set_tag_types', { tagId: tf, typeIds: [r1] });
  const delPre = { claims: claimRows(), fTypes: claimTypeIds(tf) };
  await call('delete_tag', { tagId: tf });
  await sleep(400);
  record('读数2b 删被认领的标签 → 其认领行消失,类型本身还在',
    delPre.fTypes.length === 1 && claimRows() === delPre.claims - 1 && isTypeTag(r1),
    `删前己认领=${fmt(delPre.fTypes)};claims ${delPre.claims}->${claimRows()};国籍仍是类型=${isTypeTag(r1)}`);

  // --- §8.3 校验:未登记目标被拒 / 已登记成功 / 候选只列类型 ---
  const carryPre = counts().carryRows;
  const err = await call('set_tag_carry', { carrierId: tA, carriedId: tC }).then(() => '', (e) => String(e));
  const rejected = counts().carryRows;
  await call('set_tag_carry', { carrierId: tA, carriedId: r1 });
  const okRows = counts().carryRows;
  const cands = await readCarryCandidates(cdp, A, NS);
  record('读数3 携带目标校验 + 候选只列已登记类型',
    err.includes('类型标签') && rejected === carryPre && okRows === carryPre + 1
      && cands.includes(R3) && !cands.includes(C) && !cands.includes(B),
    `未登记目标=「${err}」→carryRows ${carryPre}(须不变);已登记后=${okRows};候选=${fmt(cands)}`);

  // --- §8.4 筛选:类型命中 = 认领标签子树 ∪ 经携带;与排除互补 ---
  const hitType = await queryCount(cdp, typeCond(R1));
  const total = counts().notes;
  const exclType = await queryCount(cdp, excludeTypeCond(R1));
  await call('set_setting', { key: 'filter_current', value: JSON.stringify({ ...JSON.parse(filterBefore ?? '{}'), keyword: null, tags: [], excludeTags: [], types: [{ path: R1 }], excludeTypes: [], tagPresence: null, sort: 'newest', expr: null }) });
  await cdp.send('Page.reload');
  await waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 500);
  await sleep(1200);
  const chips = await waitFor(() => chipTexts(cdp).then((x) => (x.some((t) => t.includes('命中 3 条')) ? x : null)), 20, 300);
  record('读数4 类型命中(认领 1 + 携带 2 = 3)与排除互补;条件栏 chip 带「命中 N 条」',
    hitType === 3 && hitType + exclType === total
      && (chips ?? []).some((t) => t.includes(`类型:${R1}`)) && (chips ?? []).some((t) => t.includes('命中 3 条')),
    `筛类型=${hitType} + 排除=${exclType} = ${hitType + exclType}(全库 ${total});chips=${fmt(chips)}`);

  // --- §8.5 显示:徽章(2 + `+N`)/ 悬浮卡片 / 设置开关 ---
  const badgesB = await waitFor(() => badgesOf(cdp, B).then((x) => (x && x.length ? x : null)), 20, 300);
  const badgesA = await badgesOf(cdp, A);
  const tipB = await rowTipOf(cdp, B), tipA = await rowTipOf(cdp, A);
  const togg = await carryToggleRoundTrip(cdp, A);
  record('读数5 徽章 2 个 + `+1`;悬浮卡片(data-tip)列类型与携带;设置开关打开后树行出现携带',
    badgesB?.length === 3 && badgesB[2] === '+1' && (badgesA ?? []).length === 0
      && String(tipB).includes('类型：') && String(tipA).includes('携带：国籍')
      && togg.off === 'false' && togg.on === true && fmt(togg.carryOn) === fmt(['国籍']) && (togg.carryOff ?? []).length === 0,
    `乙徽章=${fmt(badgesB)} 甲徽章=${fmt(badgesA)};乙tip含类型=${String(tipB).includes('类型：')};甲tip=「${tipA}」;开关 ${togg.off}->${togg.on};携带 ${fmt(togg.carryOn)}->${fmt(togg.carryOff)}`);

  // --- §8.6 建议:依据正确 / 未确认零写入 / 确认后只写被接受的 ---
  suoTagId = tagIdOf('地点轴/所在');
  suoWasType = isTypeTag(suoTagId);
  const sugPre = { types: typeRows(), claims: claimRows() };
  await pickTypeSection(cdp);
  await waitFor(() => cdp.eval(`Array.from(document.querySelectorAll('select[aria-label="按建议类型筛选"] option')).some((o) => o.textContent.trim() === '所在')`), 40, 300);
  await filterSuggestionsByType(cdp, '所在');
  const sugText = await findSuggestion(cdp, CITY, 20);
  const sugZero = { types: typeRows(), claims: claimRows() };
  await clickByLabel(cdp, '全不选可见');
  await checkSuggestion(cdp, CITY);
  await clickByLabel(cdp, '批量确认');
  await waitFor(() => cdp.eval(`document.querySelector('[role="status"]')?.textContent?.includes('已写入')`), 20, 300);
  await sleep(300);
  const city = tagIdOf(CITY);
  const wrote = claimTypeIds(city);
  record('读数6 建议条数与依据正确;未确认零写入;确认后只写被接受的 1 条',
    sugText != null && sugText.includes(CITY) && sugText.includes('来自路径 地点/*')
      && sugZero.types === sugPre.types && sugZero.claims === sugPre.claims
      && wrote.length === 1 && claimRows() === sugPre.claims + 1,
    `建议行=「${sugText}」;未确认 types/claims=${fmt(sugZero)}(须=${fmt(sugPre)});确认后 city 认领=${fmt(wrote)} claims ${sugPre.claims}->${claimRows()}`);
  await backToStream(cdp);
  await sleep(400);

  // --- §8.7 回归:tags 结构 / 笔记 tags 列 / FTS / 导出 ---
  await call('export_notes', { path: E1 });
  const d1 = xlsxContentDigest(E1);
  await sleep(200);
  const tagsAfter = JSON.stringify(all('SELECT id,path,depth,sort_order FROM tags WHERE id IN (SELECT id FROM tags) AND (path NOT LIKE \'%类型测试%\') AND path NOT LIKE \'时间/%\' ORDER BY id'));
  const tagsBase = JSON.stringify(JSON.parse(tagsBefore).filter((t) => !String(t.path).includes('类型测试')));
  await call('export_notes', { path: E2 });
  record('读数7 tags 的 path/depth/sort_order 与 FTS/导出不因类型而变(剔除夹具对比)',
    tagsAfter === tagsBase && counts().fts === base.fts + fixtureNoteIds().length && xlsxContentDigest(E2) === d1,
    `结构一致=${tagsAfter === tagsBase} FTS=${counts().fts}(基线 ${base.fts} + 夹具笔记 ${fixtureNoteIds().length}) 导出摘要=${xlsxContentDigest(E2).slice(0, 16)}`);

  // --- §8.8 性能:类型条件 vs 同规模标签条件 ---
  const msType = await timeQuery(cdp, typeCond(R1), 30);
  const msTag = await timeQuery(cdp, tagCond(BASE), 30);
  record('读数8 筛类型 与 筛同规模标签 耗时同量级(比值 ≤5x)',
    msTag > 0 && msType / msTag <= 5,
    `类型=${msType.toFixed(2)}ms 同规模标签=${msTag.toFixed(2)}ms 比值=${(msType / msTag).toFixed(2)}x`);
} catch (e) {
  failure = e;
}

// --- 收尾:筛选还原 + 建议用例恢复(未登记则取消) + 夹具删净 + 库对账 ---
try {
  if (filterBefore != null) await call('set_setting', { key: 'filter_current', value: filterBefore });
  if (suoTagId != null && !suoWasType) await call('set_tag_type_flag', { tagId: suoTagId, isType: false }).catch(() => null);
  await purgeTypeFixtures(call);
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
