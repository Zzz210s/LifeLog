#!/usr/bin/env node
/**
 * 标签拖拽(P1)CDP 端到端验收:拖成子级 / 还原原路径 / 自身子树被拒。
 * 用法: node scripts/dev-cdp-accept-drag.mjs   (先以 9222 调试端口启动 pnpm tauri dev;冷启动即可 —— 主窗由 ensureMain 前置自动打开)
 * 夹具自建自删:在「验收拖拽/甲」「验收拖拽/乙」两个自建标签间来回搬动,结束时删净夹具,
 * 末尾用 list_tags 全量路径 + 笔记 id 清单 + filter_current / theme 做库存前后对照。
 * 两条已作废用例(不再保留):
 *   - 「时间子树不可拖也不作目标」:侧栏独立时间分区已随时间标签降级删除,时间标签现在是普通标签(可拖、可作目标)
 *   - 「拖到分区空白=拖回根级」:移到根级会调 move_tag -> apply_sibling_order 给**真实根层重排 sort_order**
 *     (实测把 17 个真实根的 0 改写成 0..18 并留下空洞),与「真实库不得被改动」冲突,而 sort_order 只能直写库还原,
 *     故该用例不再保留(夹具改为在自建子树内搬运,只影响自建层的兄弟序)。
 * 读数口径:拖动源行 data-drag-source、悬停目标行 data-drop-target / 根级指示条 border-accent 高亮、
 * 操作回执 [data-testid=tag-flash] 文案,以及真实 IPC 落库后的标签路径。
 */
import { ensureMain, recorder, sleep, bindMain } from './cdp-lib.mjs';

const { record, finish } = recorder();
const { cdp, close } = await ensureMain();
const { call, hits, paths, inventory } = bindMain(cdp);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ROOT = '验收拖拽';
const A = `${ROOT}/甲`;
const B = `${ROOT}/乙`;
const AB = `${A}/乙`;
const NOTE_A = '验收拖拽夹具甲';
const NOTE_B = '验收拖拽夹具乙';

/** 合成一次 HTML5 拖拽:目标 to 为标签路径。
 *  落点坐标必须给目标行的「垂直中部」(S8 行内落点分区:上 25% 前插 / 中 50% 成为子级 /
 *  下 25% 后插);DragEvent 默认 clientY=0 会被钳到 0 -> 判成「同级前插」,拖不出子级。 */
const selOf = (to) => `[data-tag-path="${to}"]`;
async function drag(from, to) {
  const [fromSel, toSel] = [`[data-tag-path="${from}"]`, selOf(to)];
  return cdp.eval(`(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 90));
    const find = () => document.querySelector(${JSON.stringify(fromSel)});
    if (!find()) return { error: 'no-source' };
    const draggable = find().getAttribute('draggable');
    const fire = (el, type) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer(),
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    };
    fire(find(), 'dragstart');
    await tick();
    const src = find();
    const marked = src ? src.getAttribute('data-drag-source') : null;
    const tgt = document.querySelector(${JSON.stringify(toSel)});
    if (!tgt) return { error: 'no-target', draggable, marked };
    fire(tgt, 'dragover');
    await tick();
    const t2 = document.querySelector(${JSON.stringify(toSel)});
    const highlight = !!t2 && (t2.hasAttribute('data-drop-target') || t2.className.includes('border-accent'));
    fire(t2 || tgt, 'drop');
    await tick();
    const flash = document.querySelector('[data-testid="tag-flash"]');
    return { draggable, marked, highlight, flash: flash ? flash.textContent.trim() : null };
  })()`);
}

const inv0 = await inventory();
const p0 = await paths();
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, theme: inv0.theme, tagPaths: inv0.paths.length, filterCurrent: inv0.filterCurrent !== null }));

// 夹具:两条自建笔记带 验收拖拽/甲、验收拖拽/乙 两个标签(链接数用于证明拖动不丢笔记)
const noteA = await call('save_input_note', { content: `#${A} ${NOTE_A}` });
const noteB = await call('save_input_note', { content: `#${B} ${NOTE_B}` });
await sleep(800);
const p1 = await paths();
record(
  'C0 自建夹具就位(验收拖拽/甲、验收拖拽/乙 各自挂一条笔记)',
  p1.includes(A) && p1.includes(B) && (await hits({ tags: [{ path: A, includeChildren: true }] })) === 1,
  `tags=${JSON.stringify(p1.filter((p) => p.startsWith(ROOT)))} ids=${JSON.stringify([noteA.id, noteB.id])}`
);

// 1 拖成子级:验收拖拽/乙 落到 验收拖拽/甲 之下(笔记链接不得丢)
const d1 = await drag(B, A);
await sleep(700);
const p2 = await paths();
const movedHit = await hits({ tags: [{ path: AB, includeChildren: true }] });
record(
  'C1 拖到标签上成为其子级(验收拖拽/乙 -> 验收拖拽/甲/乙,笔记链接不丢)',
  d1.draggable === 'true' && d1.marked === 'true' && d1.highlight === true && d1.flash === '已移动标签' &&
    p2.includes(AB) && !p2.includes(B) && movedHit === 1,
  `${JSON.stringify(d1)} 笔记命中=${movedHit}`
);

// 2 还原为原路径(把子级拖回自建根「验收拖拽」下,让夹具回到起始形态)
const d2 = await drag(AB, ROOT);
await sleep(700);
const p3 = await paths();
record(
  'C2 还原为原路径(验收拖拽/甲/乙 -> 验收拖拽/乙,路径集合与拖动前一致)',
  d2.flash === '已移动标签' && p3.includes(B) && !p3.includes(AB),
  `${JSON.stringify(d2)} 路径还原=${same([...p3].sort(), [...p1].sort())}`
);

// 3 自身/子孙不可作目标(预校验拒绝,不落库)
const d3 = await drag(ROOT, A);
await sleep(500);
const p4 = await paths();
record(
  'C3 自身子树被拒(验收拖拽 -> 验收拖拽/甲:目标不高亮、给出中文提示、不落库)',
  d3.highlight === false && (d3.flash || '').includes('不能移动到自身或其子孙下') && same(p4, p3),
  `${JSON.stringify(d3)} 路径不变=${same(p4, p3)}`
);
await sleep(3200); // 等错误回执过期,避免与清理读数混淆

// 4 清收夹具 + 库存对照
await call('delete_note', { id: noteA.id });
await call('delete_note', { id: noteB.id });
await sleep(800);
// 标签节点不会随笔记删除自动消失:按「不在基线里」的路径反向删净自建节点(深的先删)
const base = new Set(inv0.paths);
let list = await call('list_tags');
for (const t of list.filter((t) => !base.has(t.path) && (t.path === ROOT || t.path.startsWith(ROOT + '/'))).sort((a, b) => b.depth - a.depth)) {
  await call('delete_tag', { tagId: t.id });
}
await sleep(400);
list = await call('list_tags');
const inv1 = await inventory();
record(
  'D1 夹具删净 + 库存前后一致(笔记 id 清单 / 标签路径 / filter_current / theme)',
  inv1.notes === inv0.notes && same(inv1.ids, inv0.ids) && same(inv1.paths, inv0.paths) &&
    !list.some((t) => t.path === ROOT || t.path.startsWith(ROOT + '/')) &&
    inv1.filterCurrent === inv0.filterCurrent && inv1.theme === inv0.theme,
  `notes ${inv1.notes}/${inv0.notes} ids同=${same(inv1.ids, inv0.ids)} paths同=${same(inv1.paths, inv0.paths)} ` +
    `filter_current同=${inv1.filterCurrent === inv0.filterCurrent} theme ${inv1.theme}/${inv0.theme}`
);

finish();
close();
