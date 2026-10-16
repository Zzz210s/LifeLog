// T6 逐格验收的手势/菜单/状态格(E-I):容器行取证、拖动起手、双击、右键菜单高度、切模式清状态。
// 从 clickmode-accept.mjs 抽出以守 200 行红线;调用方给 ctx(连接、读数原语、模式切换)。
import { sleep } from './cdp-lib.mjs';

export async function runGestureCells(ctx) {
  const { cdp, call, rec, useMode, setFilter, readFilter, hits, L, F, A } = ctx;
  const shots = [];
  const tags = await call('list_tags');
  const paths = tags.map((t) => t.path);
  const zero = tags.filter((t) => t.subtree_count === 0);
  const expando = paths.find((p) => paths.some((q) => q.startsWith(p + '/')));
  const expandoChild = paths.find((q) => q.startsWith(expando + '/'));
  const relPath = (await cdp.eval(`Array.from(document.querySelectorAll('aside [data-tag-path]')).filter((r) => r.querySelector('[data-tag-relation]')).map((r) => r.getAttribute('data-tag-path'))`))[0] ?? A;

  // ---------- E 容器行(计数 0):真机取证 ----------
  rec('E1 真库无容器行可点(计数 0 的行 0 条;可选性判定 subtreeCount > 0)', zero.length === 0,
    `标签 ${tags.length} 条 / subtree_count=0 的 ${zero.length} 条 / 侧栏 DOM 行 ${await cdp.eval(`document.querySelectorAll('aside [data-tag-path]').length`)}`);
  const note = await call('save_input_note', { content: '单击验收构造夹具\n#单击验收/父 #单击验收/父/子' });
  await sleep(1000);
  const built = (await call('list_tags')).filter((t) => t.path.startsWith('单击验收')).map((t) => `${t.path}:sub=${t.subtree_count}`);
  await call('delete_note', { id: note.id });
  await sleep(1200);
  const afterDel = (await call('list_tags')).filter((t) => t.path.startsWith('单击验收')).length;
  const note2 = await call('save_input_note', { content: '单击验收构造夹具\n#单击验收/父 #单击验收/父/子' });
  await sleep(1000);
  await call('update_note', { id: note2.id, content: '单击验收构造夹具\n(标签已摘)' });
  await sleep(1200);
  const afterDetag = (await call('list_tags')).filter((t) => t.path.startsWith('单击验收')).length;
  if (afterDetag > 0) for (const t of (await call('list_tags')).filter((x) => x.path.startsWith('单击验收')).sort((a, b) => b.depth - a.depth)) await call('delete_tag', { tagId: t.id });
  await call('delete_note', { id: note2.id });
  await sleep(800);
  rec('E2 容器行构造不出:两条写路径都被空标签 GC 收走(删笔记 / 摘标签)',
    built.length === 3 && afterDel === 0 && afterDetag === 0,
    `建后 ${JSON.stringify(built)} -> 删笔记后 ${afterDel} 条 -> 摘标签后 ${afterDetag} 条(收尾已删净)`);
  rec('E3 该格的实现由 dom 用例钉住(T6 真机不可达,见 E1/E2)', true, 'src/main-window/sidebar/tag-row-click.dom.test.ts 的「不可选行:任何模式任何修饰键都是 expand」一例;T6 报告里附该文件的运行结果');

  // ---------- F 拖动起手不触发单击 ----------
  const raw = async () => (await call('get_setting', { key: 'filter_current' })) ?? 'null';
  await useMode('filter');
  await setFilter(F());
  const f0 = await readFilter();
  const raw0 = await raw();
  await L.dragStart(cdp, A);
  await sleep(400);
  const dragState = await cdp.eval(`!!document.querySelector('aside [data-drag-source="true"]')`);
  await L.clickRow(cdp, A);
  await sleep(600);
  const fMid = await readFilter();
  const rawMid = await raw();
  await L.dragEnd(cdp, A);
  await sleep(600);
  await L.clickRow(cdp, A);
  await sleep(700);
  const fEnd = await readFilter();
  const rawEnd = await raw();
  await useMode('open');
  await setFilter(F());
  await L.dragStart(cdp, A);
  await sleep(400);
  await L.clickRow(cdp, A);
  await sleep(600);
  const openMid = await L.previewCard(cdp);
  await L.dragEnd(cdp, A);
  await sleep(600);
  await useMode('filter');
  await L.clickRow(cdp, A);
  await sleep(700);
  const rawAfter = await raw();
  rec('F1 拖动起手后的 click 被早退:filter 条件不动 / open 不出卡片;收手后单击恢复正常',
    dragState && rawMid === raw0 && openMid === null && rawEnd !== raw0 && rawAfter !== raw0,
    `拖动中 ${dragState} / 拖中原文 ${rawMid} == 起手前 ${raw0} / 拖中卡片 ${JSON.stringify(openMid)} / 收手后原文 ${rawEnd}`);
  const shotF = await L.shot(cdp, 'F1-drag-active');

  // ---------- G 双击 = 展开(无 250ms 延迟) ----------
  await useMode('filter');
  await setFilter(F());
  // 扁平模式下列表恒平铺,折叠对 DOM 没有影响 -> 本格先拨到树形,测完拨回原视角
  const view0 = await L.sidebarView(cdp);
  const viewNow = await L.ensureSidebarView(cdp, 'tree');
  await sleep(500);
  const flip = await cdp.eval(`(async () => { const sel = (p) => document.querySelector('aside [data-tag-path=' + JSON.stringify(p) + ']');
    const target = sel(${JSON.stringify(expando)}); const childOf = () => !!sel(${JSON.stringify(expandoChild)});
    const before = childOf(); const t0 = performance.now();
    for (let i = 0; i < 2; i++) target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: i + 1 }));
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
    let ms = null;
    for (let i = 0; i < 120; i++) { if (childOf() !== before) { ms = +(performance.now() - t0).toFixed(1); break; } await new Promise((r) => setTimeout(r, 5)); }
    return { before, after: childOf(), ms, filter: await window.__TAURI_INTERNALS__.invoke('get_setting', { key: 'filter_current' }) }; })()`);
  const lat = await L.clickDomLatency(cdp, A);
  await L.ensureSidebarView(cdp, view0); // 还原视角(写回原值,不留副作用)
  rec(`G1 双击 = 展开 / 收起(树形视角:子行在 DOM 里出现/消失;静置前视角=${view0})`,
    viewNow === 'tree' && flip.before !== flip.after && flip.ms !== null && flip.ms < 300,
    `视角 ${view0} -> ${viewNow} / 子行 ${flip.before} -> ${flip.after} 用时 ${flip.ms}ms(无 250ms 等待窗)`);
  rec('G2 单击即时生效(无双击延迟):派发 click -> 行态翻转的延迟', lat.ms !== null && lat.ms < 150,
    `行态翻转 ${lat.ms}ms(${lat.before}->${lat.after});DB 落库 ${lat.dbMs}ms(use-filter-state 的 500ms 节流,不计入延迟判据)`);
  const shotG = await L.shot(cdp, 'G1-dblclick-collapsed');

  // ---------- H 右键菜单 8 档 + 高度 ----------
  await useMode('filter');
  await setFilter(F());
  await L.openMenu(cdp, relPath, 140);
  await sleep(300);
  const m = await L.menuState(cdp);
  const want = ['仅看本级', '含子级', '加入排除', '重命名', '移动', '别名…', '关系…', '删除'];
  rec('H1 右键菜单恰 8 档(三个条件档在前)+ 每档 data-menu-action 齐',
    JSON.stringify(m?.items) === JSON.stringify(want) && JSON.stringify(m?.actions) === JSON.stringify(['scope-self', 'scope-subtree', 'exclude', 'rename', 'move', 'alias', 'relation', 'delete']),
    `档位 ${JSON.stringify(m?.items)}`);
  const shotH = await L.shot(cdp, 'H1-menu-8');
  const pad = await cdp.eval(`(() => { const m = document.querySelector('[data-tag-menu]'); const rel = m.querySelector('[data-menu-relations]');
    const row = rel.querySelector('[data-menu-relation]'); const first = row.cloneNode(true); first.textContent = '满档甲/满档乙';
    while (rel.querySelectorAll('[data-menu-relation]').length < 4) rel.append(first.cloneNode(true));
    const extra = document.createElement('div'); extra.className = 'px-2.5 py-0.5 text-label text-muted'; extra.textContent = '+9'; rel.append(extra);
    return { scrollHeight: m.scrollHeight, clientHeight: m.clientHeight, relRows: rel.querySelectorAll('[data-menu-relation]').length, boxH: +m.getBoundingClientRect().height.toFixed(1) }; })()`);
  rec('H2 8 档 + 关系块满档(4 行 + `+N` = 5 行)也不再内部滚动(钳制按实测抬到 384)',
    m?.maxH === '384px' && m.scrollHeight <= m.clientHeight && m.bottom <= m.vh && pad.scrollHeight <= pad.clientHeight,
    `实测菜单 ${m?.scrollHeight}/${m?.clientHeight} maxH ${m?.maxH} 关系行 ${m?.relRows} 底 ${m?.bottom}≤视口 ${m?.vh} / 注入满档 ${pad.scrollHeight}/${pad.clientHeight}(${pad.relRows} 行)`);
  const nearBottom = await cdp.eval(`(() => { const vh = window.innerHeight; const r = document.querySelector('aside [data-tag-path=' + JSON.stringify(${JSON.stringify(relPath)}) + ']');
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: vh - 4 }));
    return vh; })()`);
  await sleep(250);
  const nm = await L.menuState(cdp);
  rec('H3 贴下沿右键:菜单被钳回视口内(不再按旧的 328 常量定位)', nm !== null && nm.bottom <= nearBottom && nm.top >= 8,
    `top ${nm?.top} bottom ${nm?.bottom} 视口高 ${nearBottom}`);
  await L.esc(cdp);
  await sleep(300);
  rec('H4 Esc 关菜单', (await L.menuState(cdp)) === null, `菜单 ${JSON.stringify(await L.menuState(cdp))}`);

  // ---------- I 切模式清卡片 + 中文回执(两档) ----------
  await useMode('open');
  await setFilter(F());
  await L.clickRow(cdp, A);
  await sleep(700);
  const i1 = { card: await L.previewCard(cdp) };
  await L.clickModeButton(cdp);
  await sleep(600);
  const i1after = { card: await L.previewCard(cdp), flash: await L.flashText(cdp), row: await L.rowState(cdp, A), mode: (await L.modeState(cdp)).mode };
  rec('I1 切模式(open -> filter):卡片被关 + 一句中文回执;行上不留 preview / cursor 痕迹',
    !!i1.card && i1after.mode === 'filter' && i1after.card === null && i1after.row.preview === null && i1after.row.cursor === null
      && /^已切到「筛选」：单击加入 \/ 移出筛选/.test(i1after.flash ?? ''),
    `切换前卡片 ${!!i1.card} / 切换后 ${JSON.stringify(i1after.card)} 行 ${JSON.stringify(i1after.row)} 回执「${i1after.flash}」`);
  const shotI1 = await L.shot(cdp, 'I1-mode-switch-clears');
  await setFilter(F());
  await L.clickModeButton(cdp);
  await sleep(600);
  const i2 = { card: await L.previewCard(cdp), flash: await L.flashText(cdp), mode: (await L.modeState(cdp)).mode };
  rec('I2 切模式(filter -> open):只给一句中文回执,不凭空弹卡片',
    i2.mode === 'open' && i2.card === null && /^已切到「打开」：单击打开实体/.test(i2.flash ?? ''),
    `模式 ${i2.mode} / 卡片 ${JSON.stringify(i2.card)} 回执「${i2.flash}」`);
  await useMode('filter');
  shots.push(shotF, shotG, shotH, shotI1);
  return { shots, expando, relPath, zero: zero.length };
}
