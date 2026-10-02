#!/usr/bin/env node
/**
 * 表格单元格编辑的真机读数(设计 2026-10-02-table-cell-edit-design.md §6 的 10 条):
 *   1 改一格后其余字节不变 / 2 Tab 链 / 3 Esc 不写库 / 4 +行 +列 / 5 删行 删列 /
 *   6 chip 仍能跳转 + 复选框仍能打勾 / 7 `\|` 转义表定位 / 8 围栏里的假表不被识别 /
 *   9 两条逃生口(编辑源码 / 点表外正文)/ 10 只读对账(夹具删净 + 逐项回基线)。
 * 夹具一律 `TABLE编辑测试` 前缀,自建自删;全用合成事件,不碰物理鼠标。
 * 注:存库会逐行归一空白(连续空白折成一个空格),故空/宽格期望值按单空格写。
 * 另:写回正文末尾比原夹具多一个换行 —— 保存路径是 composeSource(正文 + "\n" + #标签),
 * 剥离标签后留下分隔换行(编辑面板同一条路径,非单元格编辑引入)。
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-table-edit-accept.mjs(先起应用)
 */
import { ensureMain, recorder } from './cdp-lib.mjs';
import { driver } from './unified-accept-lib.mjs';
import {
  NS, contentOf, counts, createFixture, fixtureIds, fmt, requireApp, sleep, tableDom, waitFor,
} from './table-edit-accept-lib.mjs';

const L = (...xs) => xs.join('\n');
const T = {
  edit: L(`${NS} 改格`, '| 名称 | 数量 | 备注 |', '| --- | --- | --- |', '| 甲 | 1 | 第一 |', '| 乙 | 2 | 第二 |'),
  nav: L(`${NS} 导航`, '| 头一 | 头二 | 头三 |', '| --- | --- | --- |', '| 甲 | 一 | 壹 |', '| 乙 | 二 | 贰 |'),
  esc: L(`${NS} 放弃`, '| 甲 | 乙 |', '| --- | --- |', '| 1 | 2 |'),
  add: L(`${NS} 加行`, '| 列一 | 列二 |', '| --- | --- |', '| A | 1 |', '| B | 2 |'),
  del: L(`${NS} 删行`, '| 列一 | 列二 |', '| --- | --- |', '| A | 1 |', '| B | 2 |'),
  link: L(`${NS} 链接`, '| 项 | 链接 |', '| --- | --- |', `| 一 | [[${NS} 目标]] |`, '| 二 | x |', '', '- [ ] 待办'),
  out: L(`${NS} 逃生`, '| 列 | 值 |', '| --- | --- |', '| a | 1 |', '| b | 2 |', '', '表格外的正文'),
  fence: L(`${NS} 围栏`, '', '```text', '| 假 | 表 |', '| --- | --- |', '| 1 | 2 |', '```', '', '正文'),
  escape: L(`${NS} 转义`, '| 名称 | 说明 |', '| --- | --- |', '| a | x \\| y |', '| b | z |'),
  tgt: `${NS} 目标`,
};
const NL = '\n'; // 保存路径留下的分隔换行(见文件头)

await requireApp();
const { cdp } = await ensureMain();
const d = driver(cdp);
const ev = d.ev;
const call = (cmd, args = {}) => ev(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const dom = tableDom(ev);
const r = recorder();
const { record, finish } = r;

/** 结构改写后等界面重渲完再点下一格:DB 已提交但 React 可能还没换 source(range 会短暂对不上) */
const settle = () => sleep(600);
/** 点控制条按钮(等它随开格后的 layoutEffect 挂上);返回是否真的点到 */
const hitLabel = async (id, label) => {
  const ready = await waitFor(() => ev(`!!document.querySelector('[data-note-body="${id}"]')?.closest('li')?.querySelector('[data-table-controls] button[aria-label=${JSON.stringify(label)}]')`), 16, 200);
  return ready === true ? ((await dom.clickLabel(id, label)) === true) : false;
};
/** 退编辑面板回信息流 */
const leavePanel = async () => {
  await d.esc();
  await waitFor(() => ev(`!document.querySelector('[data-testid="edit-panel"]')`), 16, 250);
};

let failure = null;
const stale = fixtureIds();
if (stale.length) console.log(`INFO 清掉上一次残留夹具 ${stale.length} 条`);
for (const id of stale) await call('delete_note', { id });
await sleep(400);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

try {
  // --- 读数 1:改一格,其余逐字节不变 ---
  const idEdit = await createFixture(call, ev, T.edit);
  await dom.openTd(idEdit, 1, 2);
  const v1 = await dom.editorValue(idEdit);
  await dom.setEditor(idEdit, '改后');
  await dom.keyEditor(idEdit, 'Enter');
  const want1 = L(`${NS} 改格`, '| 名称 | 数量 | 备注 |', '| --- | --- | --- |', '| 甲 | 1 | 改后 |', '| 乙 | 2 | 第二 |') + NL;
  const got1 = await waitFor(() => (contentOf(idEdit) === want1 ? true : null), 16, 200);
  record('读数1 点第2行第3格改字后 Enter:库里只有这一格变(其余逐字节不变)',
    v1 === '第一' && got1 === true, `框内=${fmt(v1)}(期望 "第一") 写回=${got1 === true ? '逐字节等于期望(仅该格 + 末尾分隔换行)' : fmt(contentOf(idEdit))}`);
  await dom.closeEditor(idEdit);

  // --- 读数 2:Tab 链 ---
  const idNav = await createFixture(call, ev, T.nav);
  await dom.openTd(idNav, 1, 0);
  const seq = [await dom.editorValue(idNav)];
  for (const extra of ['', '', '', ', shiftKey: true']) {
    await dom.keyEditor(idNav, 'Tab', extra);
    await sleep(180);
    seq.push(await dom.editorValue(idNav));
  }
  record('读数2 Tab 提交并右移、行尾折下一行首格、Shift+Tab 左移(未改内容不写库)',
    fmt(seq) === fmt(['甲', '一', '壹', '乙', '壹']) && contentOf(idNav) === T.nav,
    `链=${fmt(seq)}(期望 甲/一/壹/乙/壹) 库未变=${contentOf(idNav) === T.nav}`);
  await dom.closeEditor(idNav);

  // --- 读数 3:Esc 不写库 ---
  const idEsc = await createFixture(call, ev, T.esc);
  await dom.openTd(idEsc, 1, 0);
  await dom.setEditor(idEsc, '999');
  await dom.keyEditor(idEsc, 'Escape');
  await sleep(220);
  record('读数3 Esc 放弃:关框且不写库',
    (await dom.hasEditor(idEsc)) === false && contentOf(idEsc) === T.esc,
    `框在=${await dom.hasEditor(idEsc)} 库未变=${contentOf(idEsc) === T.esc}`);

  // --- 读数 4:+行 / +列 ---
  const idAdd = await createFixture(call, ev, T.add);
  await dom.openTd(idAdd, 1, 0);
  const hit1 = await hitLabel(idAdd, '在下方插入一行');
  const wantAdd = L(`${NS} 加行`, '| 列一 | 列二 |', '| --- | --- |', '| A | 1 |', '| | |', '| B | 2 |') + NL;
  const gotAdd = await waitFor(() => (contentOf(idAdd) === wantAdd ? true : null), 16, 200);
  await settle();
  await dom.openTd(idAdd, 1, 0);
  const hit2 = await hitLabel(idAdd, '在右侧插入一列');
  const wantCol = L(`${NS} 加行`, '| 列一 | | 列二 |', '| --- | --- | --- |', '| A | | 1 |', '| | | |', '| B | | 2 |') + NL;
  const gotCol = await waitFor(() => (contentOf(idAdd) === wantCol ? true : null), 16, 200);
  record('读数4 +行(插在下方、列数不变)与 +列(每行列数+1、分隔行同步)',
    gotAdd === true && gotCol === true, `+行=${gotAdd}(click=${hit1}) +列=${gotCol}(click=${hit2}) 现值=${fmt(contentOf(idAdd))}`);

  // --- 读数 5:删行 / 删列 ---
  const idDel = await createFixture(call, ev, T.del);
  await dom.openTd(idDel, 1, 0);
  await hitLabel(idDel, '删除本行');
  const wantDel = L(`${NS} 删行`, '| 列一 | 列二 |', '| --- | --- |', '| B | 2 |') + NL;
  const gotDel = await waitFor(() => (contentOf(idDel) === wantDel ? true : null), 16, 200);
  await settle();
  await dom.openTd(idDel, 1, 1);
  await hitLabel(idDel, '删除本列');
  const wantDelCol = L(`${NS} 删行`, '| 列一 |', '| --- |', '| B |') + NL;
  const gotDelCol = await waitFor(() => (contentOf(idDel) === wantDelCol ? true : null), 16, 200);
  record('读数5 删除本行 / 删除本列(其余数据不动)',
    gotDel === true && gotDelCol === true, `删行=${gotDel} 删列=${gotDelCol}`);

  // --- 读数 6:chip 跳转 + 复选框打勾 ---
  const idTgt = await createFixture(call, ev, T.tgt);
  const idLink = await createFixture(call, ev, T.link);
  const chip = await ev(`(() => { const c = document.querySelector('[data-note-body="${idLink}"] [data-note-link]'); return c ? { id: c.getAttribute('data-note-link'), cls: c.className } : null; })()`);
  await dom.clickIn(idLink, '[data-note-link]');
  const hit = await waitFor(async () => {
    const s = await ev(`(() => { const el = document.querySelector('[data-note-body="${idTgt}"]'); if (!el) return null;
      const sc = el.closest('.scroll-gutter'); const a = el.getBoundingClientRect(), c = (sc ?? document.body).getBoundingClientRect();
      return { inView: a.top >= c.top && a.bottom <= c.bottom, cls: el.closest('li')?.className ?? '' }; })()`);
    return s && s.inView && s.cls.includes('bg-accent-soft') ? s : null;
  }, 16, 300);
  const boxAfterChip = await dom.hasEditor(idLink);
  await ev(`(() => { const b = document.querySelector('[data-note-body="${idLink}"] input[type=checkbox]'); if (b) b.click(); return !!b; })()`);
  const taskDone = await waitFor(() => { const c = contentOf(idLink); return c && c.includes('- [x] 待办') ? true : null; }, 16, 250);
  record('读数6 表格里的 chip 仍能跳转(高亮+在视野内、不开单元格框),任务复选框仍能打勾',
    chip?.id === String(idTgt) && hit !== null && boxAfterChip === false && taskDone === true,
    `chip=${fmt(chip)} 跳转=${fmt(hit)} 单元格框=${boxAfterChip} 打勾=${taskDone}`);
  await dom.closeEditor(idLink);

  // --- 读数 7:含 `\|` 的表格 ---
  const idEscape = await createFixture(call, ev, T.escape);
  await dom.openTd(idEscape, 1, 1);
  const v7 = await dom.editorValue(idEscape);
  await dom.setEditor(idEscape, 'p | q');
  await dom.keyEditor(idEscape, 'Enter');
  const want7 = L(`${NS} 转义`, '| 名称 | 说明 |', '| --- | --- |', '| a | p \\| q |', '| b | z |') + NL;
  const got7 = await waitFor(() => (contentOf(idEscape) === want7 ? true : null), 16, 200);
  record('读数7 含 \\| 的表格:格子定位正确(\\| 不当分隔),写回再转义',
    v7 === 'x | y' && got7 === true, `框内=${fmt(v7)}(期望 "x | y") 写回=${got7}`);
  await dom.closeEditor(idEscape);

  // --- 读数 8:围栏里的"表格" ---
  const idFence = await createFixture(call, ev, T.fence);
  await dom.clickIn(idFence, 'code');
  const panel8 = await waitFor(() => dom.hasPanel(), 16, 250);
  const editor8 = await dom.hasEditor(idFence);
  record('读数8 围栏里的"表格"不被识别:退化成整条编辑,不报错',
    panel8 === true && editor8 === false, `进整条编辑=${panel8} 单元格框=${editor8}`);
  await leavePanel();

  // --- 读数 9:两条逃生口 ---
  const idOut = await createFixture(call, ev, T.out);
  await dom.openTd(idOut, 1, 0);
  await hitLabel(idOut, '编辑源码');
  const panel9a = await waitFor(() => dom.hasPanel(), 16, 250);
  await leavePanel();
  await dom.clickIn(idOut, 'p');
  const panel9b = await waitFor(() => dom.hasPanel(), 16, 250);
  await leavePanel();
  record('读数9 两条逃生口:「编辑源码」与点表格外正文都进整条编辑',
    panel9a === true && panel9b === true, `编辑源码=${panel9a} 表外正文=${panel9b}`);
} catch (e) {
  failure = e;
} finally {
  for (const id of fixtureIds()) await call('delete_note', { id });
  const gone = await waitFor(() => (fixtureIds().length === 0 ? true : null), 16, 250);
  const after = counts();
  const diff = ['notes', 'tags', 'tagLinks', 'fts', 'noteLinks'].filter((k) => after[k] !== base[k]);
  record('读数10 只读对账:夹具删净 + 逐项回基线 + integrity',
    gone === true && diff.length === 0 && after.integrity === 'ok',
    `残留=${fmt(fixtureIds())} 不一致=${fmt(diff.map((k) => `${k} ${base[k]}->${after[k]}`))} 收尾=${fmt(after)}`);
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
cdp.close();
