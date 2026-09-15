#!/usr/bin/env node
/**
 * 标签拖拽(P1)CDP 端到端验收:拖成子级 / 拖回根级 / 自身子树被拒 / 时间子树不可拖。
 * 用法: node scripts/dev-cdp-accept-drag.mjs   (先以 9222 调试端口启动 pnpm tauri dev)
 * 不带入库清理:用例只在「工作」子树内来回搬动既有标签,结束时还原为原路径,
 * 末尾用 list_tags 全量路径 + 笔记 id 清单 + 视图数做库存前后对照。
 * 读数口径:拖动源行 data-drag-source、悬停目标行 data-drop-target / 根级指示条 border-accent 高亮、
 * 操作回执 [data-testid=tag-flash] 文案,以及真实 IPC 落库后的标签路径。
 */
import { open, recorder, sleep, bindMain, conditions } from './cdp-lib.mjs';

const { record, finish } = recorder();
const { cdp, close } = await open('main');
const { call, hits, paths, inventory } = bindMain(cdp);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 合成一次 HTML5 拖拽:目标 to 传路径(时间行自动用 data-time-path)或 null(分区空白=根级) */
const selOf = (to) =>
  to === null ? '[data-testid="tag-root-drop"]' : to.startsWith('时间排序') ? `[data-time-path="${to}"]` : `[data-tag-path="${to}"]`;
async function drag(from, to) {
  const [fromSel, toSel] = [`[data-tag-path="${from}"]`, selOf(to)];
  return cdp.eval(`(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 90));
    const find = () => document.querySelector(${JSON.stringify(fromSel)});
    if (!find()) return { error: 'no-source' };
    const draggable = find().getAttribute('draggable');
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
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
const workBefore = (await call('list_tags')).find((t) => t.path === '工作').subtree_count;
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, views: inv0.views, tagPaths: inv0.paths.length }), '工作子树', workBefore);

// 1 拖成子级:工作/项目B 落到 工作/项目A 之下(笔记链接不得丢)
const d1 = await drag('工作/项目B', '工作/项目A');
await sleep(700);
const p1 = await paths();
const movedHit = await hits({ tags: [{ path: '工作/项目A/项目B', includeChildren: true }] });
record(
  'C1 拖到标签上成为其子级(工作/项目B -> 工作/项目A/项目B,笔记链接不丢)',
  d1.draggable === 'true' && d1.marked === 'true' && d1.highlight === true && d1.flash === '已移动标签' && p1.includes('工作/项目A/项目B') && !p1.includes('工作/项目B') && movedHit === 1,
  `${JSON.stringify(d1)} 笔记命中=${movedHit}`
);

// 2 拖回根级(分区空白指示条)
const d2 = await drag('工作/项目A/项目B', null);
await sleep(700);
const p2 = await paths();
record(
  'C2 拖到分区空白=拖回根级(工作/项目A/项目B -> 项目B)',
  d2.highlight === true && d2.flash === '已移动标签' && p2.includes('项目B') && !p2.includes('工作/项目A/项目B'),
  `${JSON.stringify(d2)} 相关路径=${JSON.stringify(p2.filter((x) => x.includes('项目B')))}`
);

// 3 还原为原路径(让真实库回到验收前)
const d3 = await drag('项目B', '工作');
await sleep(700);
const p3 = await paths();
const workAfter = (await call('list_tags')).find((t) => t.path === '工作').subtree_count;
record(
  'C3 还原为原路径(项目B -> 工作/项目B,工作子树计数不变)',
  d3.highlight === true && same([...p3].sort(), [...p0].sort()) && workAfter === workBefore,
  `${JSON.stringify(d3)} 路径还原=${same([...p3].sort(), [...p0].sort())} 工作子树 ${workBefore} -> ${workAfter}`
);

// 4 自身/子孙不可作目标(预校验拒绝,不落库)
const d4 = await drag('工作', '工作/项目A');
await sleep(500);
const p4 = await paths();
record(
  'C4 自身子树被拒(工作 -> 工作/项目A:目标不高亮、给出中文提示、不落库)',
  d4.highlight === false && (d4.flash || '').includes('不能移动到自身或其子孙下') && same(p4, p3),
  `${JSON.stringify(d4)} 路径不变=${same(p4, p3)}`
);
await sleep(3200); // 等错误回执过期,避免与下一条读数混淆

// 5 时间子树既不可拖也不作目标
const d5 = await drag('生活/健身', `时间排序/2026`);
await sleep(500);
const p5 = await paths();
const timeRows = await cdp.eval(`(() => {
  const rows = Array.from(document.querySelectorAll('[data-time-path]'));
  return { count: rows.length, allNotDraggable: rows.every((r) => r.getAttribute('draggable') === 'false') };
})()`);
record(
  'C5 时间子树不可拖也不作目标(行 draggable=false + 拖上去不高亮不落库)',
  timeRows.allNotDraggable && timeRows.count > 0 && d5.highlight === false && same(p5, p3),
  `时间行=${JSON.stringify(timeRows)} 拖拽=${JSON.stringify(d5)} 路径不变=${same(p5, p3)}`
);

// 6 库存对照
const inv1 = await inventory();
record(
  'D1 库存前后一致(笔记 id 清单 / 标签路径 / 视图数)',
  inv1.notes === inv0.notes && same(inv1.ids, inv0.ids) && same(inv1.paths, inv0.paths) && inv1.views === inv0.views,
  `notes ${inv1.notes}/${inv0.notes} ids同=${same(inv1.ids, inv0.ids)} paths同=${same(inv1.paths, inv0.paths)} views ${inv1.views}/${inv0.views}`
);

finish();
close();
