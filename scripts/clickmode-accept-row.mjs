// T6 逐格验收的行内格(B filter / C「select 无痕」/ D open):从 clickmode-accept.mjs 抽出守 200 行红线。
// 每格都读三样:条件对象(filter_current)、行态(DOM)、命中数(应用自己的 query_notes 逐页)。
import { sleep } from './cdp-lib.mjs';

export async function runRowCells(ctx) {
  const { cdp, call, rec, eq, useMode, setFilter, readFilter, hits, L, F } = ctx;
  const shots = [];
  /** 标签类条件的路径读数(兼容平铺 `tags`/`excludeTags` 与 `groups[].items[]` 两种形态) */
  const tagPaths = (c, kind) => {
    const out = ((kind === 'tag' ? c.tags : c.excludeTags) ?? []).map((t) => (typeof t === 'string' ? t : t.path));
    for (const g of c.groups ?? []) for (const it of g.items ?? []) if (it.kind === kind) out.push(it.path);
    return out;
  };
  /** filter_current 原文(设计口径:「条件一字未变」= 原文逐字节相同;写回是 500ms 节流的) */
  const raw = async () => (await call('get_setting', { key: 'filter_current' })) ?? 'null';
  const emptyNow = (r) => {
    const c = JSON.parse(r);
    return tagPaths(c, 'tag').length === 0 && tagPaths(c, 'excludeTag').length === 0 && !c.keyword && !c.expr;
  };
  const shape = (c) => ({ groupOp: c.groupOp, groups: (c.groups ?? []).map((g) => ({ op: g.op, items: g.items.map((i) => `${i.kind}:${i.path ?? i.value ?? ''}`) })), legacy: [(c.tags ?? []).length, (c.excludeTags ?? []).length] });

  // ---------- B filter 模式:无键 / Ctrl / Alt / Shift ----------
  await useMode('filter');
  await setFilter(F());
  const tags = await call('list_tags');
  const pool = tags.filter((t) => t.subtree_count > 0).sort((a, b) => b.subtree_count - a.subtree_count).map((t) => t.path);
  const A = pool.find((p) => pool.some((q) => q !== p && !q.startsWith(p + '/') && !p.startsWith(q + '/') && q.split('/')[0] === p.split('/')[0])) ?? pool[0];
  const B = pool.find((p) => p !== A && !p.startsWith(A + '/') && !A.startsWith(p + '/'));
  const total = await hits(F());
  const hA = await hits(F({ groups: [{ op: 'and', items: [{ kind: 'tag', path: A, includeChildren: true }] }] }));
  rec(`B0 夹具行就位(${A} / ${B})`, !!A && !!B && (await L.rowExists(cdp, A)) && (await L.rowExists(cdp, B)), `全库命中 ${total} / #${A} 命中 ${hA}`);
  await L.clickRow(cdp, A);
  await sleep(600);
  const b1 = { f: await readFilter(), row: await L.rowState(cdp, A), hits: await hits(await readFilter()) };
  rec('B1 filter 无键:单击 = 加入筛选(包含侧 + 行态 pressed)', tagPaths(b1.f, 'tag').includes(A) && b1.row.pressed === 'true' && b1.hits === hA && b1.hits < total,
    `条件 ${JSON.stringify(shape(b1.f))} 命中 ${b1.hits} / 行 ${JSON.stringify(b1.row)}`);
  shots.push(await L.shot(cdp, 'B1-filter-no-key'));
  await L.clickRow(cdp, B, { ctrl: true });
  await sleep(600);
  const b2 = { f: await readFilter(), row: await L.rowState(cdp, B), hits: await hits(await readFilter()) };
  rec('B2 filter Ctrl:单击 = AND 追加(两标签同组同 op,命中 < 单标签)', tagPaths(b2.f, 'tag').includes(B) && b2.f.groupOp === 'and' && b2.hits < b1.hits && b2.hits > 0,
    `条件 ${JSON.stringify(shape(b2.f))} 命中 ${b2.hits}(单 ${b1.hits}) 行 ${JSON.stringify(b2.row)}`);
  const before3 = JSON.stringify(b2.f);
  await L.clickRow(cdp, B, { ctrl: true });
  await sleep(600);
  rec('B3 filter Ctrl 重复:提示「已在筛选中」且条件一字未动',
    (await L.flashText(cdp)) === `已在筛选中：#${B}` && JSON.stringify(await readFilter()) === before3,
    `回执「${await L.flashText(cdp)}」`);
  await L.clickRow(cdp, B, { alt: true });
  await sleep(600);
  const b4 = { f: await readFilter(), row: await L.rowState(cdp, B) };
  rec('B4 filter Alt:单击 = 排除(排除侧 + 行态 danger + 移出包含侧)',
    tagPaths(b4.f, 'excludeTag').includes(B) && !tagPaths(b4.f, 'tag').includes(B) && b4.row.danger === true && b4.row.pressed === 'false',
    `条件 ${JSON.stringify(shape(b4.f))} 行 ${JSON.stringify(b4.row)}`);
  shots.push(await L.shot(cdp, 'B4-filter-alt-exclude'));
  await L.clickRow(cdp, B, { alt: true });
  await sleep(600);
  const b5 = await readFilter();
  rec('B5 filter Alt 再点:移出排除(两侧都不含)', !tagPaths(b5, 'excludeTag').includes(B) && !tagPaths(b5, 'tag').includes(B) && tagPaths(b5, 'tag').includes(A),
    `条件 ${JSON.stringify(shape(b5))}`);
  await L.clickRow(cdp, B, { shift: true });
  await sleep(600);
  const b6 = { f: await readFilter(), flash: await L.flashText(cdp), hits: await hits(await readFilter()) };
  rec('B6 filter Shift:只看这条(清掉其它标签条件:只剩 B)',
    eq(tagPaths(b6.f, 'tag'), [B]) && tagPaths(b6.f, 'excludeTag').length === 0 && b6.flash === `已只看 #${B}` && b6.hits === (await hits(F({ groups: [{ op: 'and', items: [{ kind: 'tag', path: B, includeChildren: true }] }] }))),
    `条件 ${JSON.stringify(shape(b6.f))} 回执「${b6.flash}」 命中 ${b6.hits}`);

  // ---------- C 已删除的 select:DOM / 设置页都取不到痕迹 ----------
  await useMode('filter');
  await setFilter(F());
  const c1 = await cdp.eval(`(() => ({ bar: document.querySelector('[data-testid="tag-cursor-bar"]') !== null,
    rows: document.querySelectorAll('aside [data-cursor]').length, current: document.querySelectorAll('aside [aria-current]').length }))()`);
  rec('C1 select 的 DOM 痕迹为 0(无底部光标条、无 data-cursor、无 aria-current)', !c1.bar && c1.rows === 0 && c1.current === 0,
    `光标条 ${c1.bar} / data-cursor 行 ${c1.rows} / aria-current 行 ${c1.current}`);
  await L.openSettings(cdp);
  await sleep(700);
  await L.openSettingsSection(cdp, '实体关系'); // 那一行只在「实体关系」分区里
  const c2 = await cdp.eval(`(() => { const g = document.querySelector('[role="group"][aria-label="单击实体行的行为"]'); if (!g) return null;
    return { items: Array.from(g.querySelectorAll('button')).map((b) => b.textContent.trim()), selected: g.querySelectorAll('[aria-pressed="true"]').length }; })()`);
  await L.backToStream(cdp);
  await sleep(600);
  rec('C2 设置页那一行只有两档(筛选 / 打开),没有「选中」', eq(c2?.items, ['筛选', '打开']) && c2.selected === 1,
    `档位 ${JSON.stringify(c2?.items)} 选中 ${c2?.selected}`);
  await L.clickRow(cdp, A);
  await sleep(600);
  const c3 = { bar: await L.cursorBar(cdp), row: await L.rowState(cdp, A) };
  rec('C3 点行后也没有光标:光标条仍是 null、行上 cursor/current 都是 null(filter 模式下只改条件)',
    c3.bar === null && c3.row.cursor === null && c3.row.current === null && c3.row.pressed === 'true',
    `光标条 ${JSON.stringify(c3.bar)} 行 ${JSON.stringify(c3.row)}`);

  // ---------- D open 模式 ----------
  await useMode('open');
  await setFilter(F());
  const rawD = await raw();
  await L.clickRow(cdp, A);
  await sleep(600);
  const d1 = { f: await readFilter(), raw: await raw(), card: await L.previewCard(cdp), row: await L.rowState(cdp, A) };
  rec('D1 open 无键:出预览卡片(只看这条 / 关闭)+ 条件一字未变 + 行上 aria-controls 指向卡片',
    d1.raw === rawD && emptyNow(d1.raw) && !!d1.card && eq(d1.card.buttons, ['只看这条', '关闭']) && d1.row.preview === 'true' && d1.row.controls === 'tag-preview-card' && d1.card.focused === false,
    `条件 ${JSON.stringify(d1.f)} 卡片 ${JSON.stringify(d1.card)}`);
  shots.push(await L.shot(cdp, 'D1-open-preview'));
  await L.esc(cdp); // 先关掉 D1 那张卡(同一点击是"再点同一行 = 关闭"的切换语义,不能带卡切视图)
  await sleep(500);
  await L.openSettings(cdp);
  await sleep(700);
  const onSet = await L.onSettings(cdp);
  await L.clickRow(cdp, A);
  await sleep(700);
  rec('D2 open 单击同时切回信息流(卡片在流里)', onSet === true && (await L.onSettings(cdp)) === false && !!(await L.previewCard(cdp)),
    `设置页 ${onSet} -> 点行后设置页 ${await L.onSettings(cdp)} 卡片 ${JSON.stringify(await L.previewCard(cdp))}`);
  await L.clickCardButton(cdp, '只看这条');
  await sleep(700);
  const d3 = { f: await readFilter(), card: await L.previewCard(cdp) };
  rec('D3 卡片「只看这条」:筛到流并关卡片', tagPaths(d3.f, 'tag').includes(A) && d3.card === null,
    `条件 ${JSON.stringify(shape(d3.f))} 卡片 ${JSON.stringify(d3.card)}`);
  const beforeD4 = JSON.stringify(await readFilter());
  await L.clickRow(cdp, B);
  await sleep(500);
  const d4 = { card: await L.previewCard(cdp), flash: await L.flashText(cdp) };
  const closed = await L.clickCardButton(cdp, '关闭');
  await sleep(500);
  rec('D4 卡片「关闭」:关卡片、不改条件', !!d4.card && closed === true && (await L.previewCard(cdp)) === null && JSON.stringify(await readFilter()) === beforeD4,
    `卡片 ${JSON.stringify(d4.card)} 关闭后 ${JSON.stringify(await L.previewCard(cdp))}`);
  const d5 = { ctrl: null, alt: null, shift: null };
  await setFilter(F()); // 清掉 D3 留下的「只看这条」:三格从空条件出发(否则 Ctrl 命中幂等分支)
  await L.clickRow(cdp, A); // 先开一张卡:修饰键不该碰卡片(§4.1 第 10-12 行)
  await sleep(700);
  const cardOpen = await L.previewCard(cdp);
  await L.clickRow(cdp, A, { ctrl: true });
  await sleep(600);
  d5.ctrl = { f: await readFilter(), flash: await L.flashText(cdp) };
  await L.clickRow(cdp, A, { alt: true });
  await sleep(600);
  d5.alt = { f: await readFilter(), flash: await L.flashText(cdp) };
  await L.clickRow(cdp, A, { shift: true });
  await sleep(600);
  d5.shift = { f: await readFilter(), flash: await L.flashText(cdp) };
  rec('D5 open 模式下 Ctrl/Alt/Shift 仍是那三种条件动作(都有一句回执,且全程不碰卡片)',
    !!cardOpen && (await L.previewCard(cdp)) !== null && d5.ctrl.flash === `已追加为同时满足：#${A}`
      && d5.alt.flash === `已排除 #${A}` && d5.shift.flash === `已只看 #${A}` && eq(tagPaths(d5.shift.f, 'tag'), [A]),
    [d5.ctrl.flash, d5.alt.flash, d5.shift.flash].join(' -> '));
  const beforeEsc = { card: await L.previewCard(cdp), cursor: await L.cursorBar(cdp) };
  await L.esc(cdp);
  await sleep(500);
  rec('D6 Esc 退出预览(卡片被清;已删的光标条也不在)', !!beforeEsc.card && beforeEsc.cursor === null && (await L.previewCard(cdp)) === null && (await L.cursorBar(cdp)) === null,
    `Esc 前 卡片 ${!!beforeEsc.card} / Esc 后 ${JSON.stringify(await L.previewCard(cdp))}`);
  return { shots, A, B };
}
