#!/usr/bin/env node
/**
 * 表格单元格编辑的安装版冒烟(装到 E:\1-LifeLog 后):只跑读数 1 / 4 / 6。
 *  1 改一格其余字节不变 / 4 +行 +列 / 6 chip 跳转 + 复选框打勾。
 * 夹具 `TABLE编辑测试冒烟` 前缀,自建自删;全用合成事件,不碰物理鼠标。
 * 用法:启动安装版(带 --remote-debugging-port=9222)后 node scripts/table-edit-release-smoke.mjs
 */
import { ensureMain, recorder } from './cdp-lib.mjs';
import { driver } from './unified-accept-lib.mjs';
import {
  contentOf, counts, createFixture, fixtureIds, fmt, requireApp, sleep, tableDom, waitFor,
} from './table-edit-accept-lib.mjs';

const NS = 'TABLE编辑测试冒烟';
const L = (...xs) => xs.join('\n');
const NL = '\n';
const EDIT = L(`${NS} 改格`, '| 名称 | 数量 | 备注 |', '| --- | --- | --- |', '| 甲 | 1 | 第一 |', '| 乙 | 2 | 第二 |');
const ADD = L(`${NS} 加行`, '| 列一 | 列二 |', '| --- | --- |', '| A | 1 |', '| B | 2 |');
const LINK = L(`${NS} 链接`, '| 项 | 链接 |', '| --- | --- |', `| 一 | [[${NS} 目标]] |`, '', '- [ ] 待办');

await requireApp();
const { cdp } = await ensureMain();
const d = driver(cdp);
const ev = d.ev;
const call = (cmd, args = {}) => ev(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const dom = tableDom(ev);
const r = recorder();
const { record, finish } = r;
const settle = () => sleep(600);
const hitLabel = async (id, label) => {
  const ready = await waitFor(() => ev(`!!document.querySelector('[data-note-body="${id}"]')?.closest('li')?.querySelector('[data-table-controls] button[aria-label=${JSON.stringify(label)}]')`), 16, 200);
  return ready === true ? ((await dom.clickLabel(id, label)) === true) : false;
};

let failure = null;
for (const id of fixtureIds()) await call('delete_note', { id });
await sleep(300);
const base = counts();
console.log(`INFO 基线=${fmt(base)}`);

try {
  // 读数1改一格其余字节不变
  const a = await createFixture(call, ev, EDIT);
  await dom.openTd(a, 1, 2);
  const v1 = await dom.editorValue(a);
  await dom.setEditor(a, '改后');
  await dom.keyEditor(a, 'Enter');
  const want1 = L(`${NS} 改格`, '| 名称 | 数量 | 备注 |', '| --- | --- | --- |', '| 甲 | 1 | 改后 |', '| 乙 | 2 | 第二 |') + NL;
  const got1 = await waitFor(() => (contentOf(a) === want1 ? true : null), 16, 200);
  record('读数1 改一格 Enter:只有该格变', v1 === '第一' && got1 === true, `框内=${fmt(v1)} 写回=${got1}`);
  await dom.closeEditor(a);

  // 读数4+行 +列
  const b = await createFixture(call, ev, ADD);
  await dom.openTd(b, 1, 0);
  await hitLabel(b, '在下方插入一行');
  const wantAdd = L(`${NS} 加行`, '| 列一 | 列二 |', '| --- | --- |', '| A | 1 |', '| | |', '| B | 2 |') + NL;
  const gotAdd = await waitFor(() => (contentOf(b) === wantAdd ? true : null), 16, 200);
  await settle();
  await dom.openTd(b, 1, 0);
  await hitLabel(b, '在右侧插入一列');
  const wantCol = L(`${NS} 加行`, '| 列一 | | 列二 |', '| --- | --- | --- |', '| A | | 1 |', '| | | |', '| B | | 2 |') + NL;
  const gotCol = await waitFor(() => (contentOf(b) === wantCol ? true : null), 16, 200);
  record('读数4 +行/+列:行数列数各 +1、其余同步', gotAdd === true && gotCol === true, `+行=${gotAdd} +列=${gotCol}`);

  // 读数6chip 跳转 + 复选框
  const t = await createFixture(call, ev, `${NS} 目标`);
  const c = await createFixture(call, ev, LINK);
  await dom.clickIn(c, '[data-note-link]');
  const jump = await waitFor(async () => {
    const s = await ev(`(() => { const el = document.querySelector('[data-note-body="${t}"]'); if (!el) return null;
      const sc = el.closest('.scroll-gutter'); const a = el.getBoundingClientRect(), k = (sc ?? document.body).getBoundingClientRect();
      return { inView: a.top >= k.top && a.bottom <= k.bottom, cls: el.closest('li')?.className ?? '' }; })()`);
    return s && s.inView && s.cls.includes('bg-accent-soft') ? s : null;
  }, 16, 300);
  const box = await dom.hasEditor(c);
  await ev(`(() => { const b = document.querySelector('[data-note-body="${c}"] input[type=checkbox]'); if (b) b.click(); return !!b; })()`);
  const done = await waitFor(() => { const x = contentOf(c); return x && x.includes('- [x] 待办') ? true : null; }, 16, 250);
  record('读数6 chip 仍跳转(不开单元格框)、复选框仍打勾', jump !== null && box === false && done === true, `跳转=${jump !== null} 框=${box} 打勾=${done}`);
} catch (e) {
  failure = e;
} finally {
  for (const id of fixtureIds()) await call('delete_note', { id });
  const gone = await waitFor(() => (fixtureIds().length === 0 ? true : null), 16, 250);
  const after = counts();
  const diff = ['notes', 'tags', 'tagLinks', 'fts', 'noteLinks'].filter((k) => after[k] !== base[k]);
  record('收尾 夹具删净 + 逐项回基线', gone === true && diff.length === 0 && after.integrity === 'ok', `残留=${fmt(fixtureIds())} 不一致=${fmt(diff)}`);
}

if (failure) record('异常中断', false, String(failure?.message ?? failure));
finish();
cdp.close();
