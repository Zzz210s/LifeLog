// 标签关系端到端读数的 UI 层(设计 §11 的 5-8):菜单 / 侧栏行内与档案卡片 / 关系面板 / 关系图 / 回归。
// 口径(2026-10-06 用户定,后经 c0aa4041「悬浮卡片简化」):行内**只显示值**、悬停值给属性名、
// 悬停标签名出**档案式卡片**(标题一行=末段名 + 每条关系一行两列);标题不再有计数行(无「本级」)。
// 从 dev-relations-accept.mjs 抽出(守 200 行红线),调用方只负责把 records 打出来。
import {
  NS, FIX, fmt, sleep, waitFor, openTagMenu, pressEsc, xlsxContentDigest, tagIdOf,
  danglingTagRows, tagStructRows, ftsTagsOf, appNoteTags, writeSetting, deleteSetting,
  relationChipsOf, rowTipOf, rowFactsOf, hoverInside, bubbleFactsOf,
  menuItemsOf, relToggleState, clickByLabelIn, clickRelationToggle, openSettings, pickRelationSection, backToStream,
  relationDegreesText, installRelationProbe, relationFrame, zoomBy, setSearch, pickSearchItem,
} from './relations-accept-lib.mjs';
import { armGraph, closeGraph } from './graph-accept-lib.mjs';

/** @returns {{records: {name:string,ok:boolean,detail:string}[]}} */
export async function runReadings5to8(cdp, ui, { call, record, nA, structAt8, E1, E2 }) {
  const records = [];

  // --- 5 菜单五档 ---
  await openTagMenu(cdp, FIX.A);
  await sleep(300);
  const items = await menuItemsOf(cdp);
  await pressEsc(cdp);
  const want = ['重命名', '移动', '别名…', '引用…', '删除'];
  records.push({
    name: '读数5 菜单恰五档(重命名/移动/别名/引用…/删除),不含「合并」「携带」「类型」「设为类型」',
    ok: JSON.stringify(items) === JSON.stringify(want) && !/合并|携带|类型/.test((items ?? []).join('')),
    detail: `items=${fmt(items)}`,
  });

  // --- 6 行内只显示值 + 悬停值给属性名 + 悬停标签名出档案卡片 + 开关 ---
  await openSettings(cdp);
  await pickRelationSection(cdp);
  const initial = await waitFor(() => relToggleState(cdp), 20, 200);
  if (initial !== 'true') await clickRelationToggle(cdp); // 归一化到开:上一轮留下的状态不影响读数
  const on = await waitFor(async () => (await relToggleState(cdp)) === 'true', 10, 200);
  await clickRelationToggle(cdp); // 判别力:关掉后侧栏小字应当消失
  const offNow = await waitFor(async () => (await relToggleState(cdp)) === 'false', 10, 200);
  await backToStream(cdp);
  await sleep(400);
  const chipsOff = await relationChipsOf(cdp, FIX.A);
  await openSettings(cdp);
  await pickRelationSection(cdp);
  await clickRelationToggle(cdp); // 再打开,后续读数都在「开」态
  const onAgain = await waitFor(async () => (await relToggleState(cdp)) === 'true', 10, 200);
  await backToStream(cdp);
  await sleep(500);
  const chips = await relationChipsOf(cdp, FIX.A);
  const chipTip = await cdp.eval(`document.querySelector('aside [data-tag-path=' + JSON.stringify(${JSON.stringify(FIX.A)}) + '] [data-tag-relation]')?.getAttribute('data-tip') ?? null`);
  const facts = await rowFactsOf(cdp, FIX.A);
  const title = String(await rowTipOf(cdp, FIX.A) ?? '').split('\n');
  await hoverInside(cdp, FIX.A, `r.querySelector('[data-tag-relation]')`);
  await sleep(350);
  const valueTip = await bubbleFactsOf(cdp);
  await hoverInside(cdp, FIX.A, `r.querySelector('span.shrink-0.truncate')`);
  await sleep(350);
  const card = await bubbleFactsOf(cdp);
  const hasFact = (rs, label, value) => (rs ?? []).some((x) => x.label === label && x.value === value);
  const chipsPure = (chips ?? []).every((c) => !c.includes('→') && !c.includes(FIX.REMARK));
  records.push({
    name: '读数6 行内只显示值(无箭头/属性名);悬停值给属性名;悬停标签名出档案卡片(标题一行末段名 + 每条关系一行两列);开关生效',
    ok: (chips ?? []).length === 3 && chips[2] === '+1' && chipsPure && chips.includes(`${NS}乙`)
      && chipTip === FIX.REMARK && (valueTip?.text ?? '').trim() === FIX.REMARK && (valueTip?.labels ?? []).length === 0
      && title.length === 1 && title[0] === FIX.A && !title.join('').includes('→') && !title.join('').includes('本级')
      && (facts ?? []).length === 3 && hasFact(facts, FIX.REMARK, `${NS}乙`)
      && (card?.labels ?? []).length === 3 && (card?.values ?? []).includes(`${NS}乙`)
      && String(card?.text).includes(FIX.A) && !String(card?.text).includes('本级')
      && (chipsOff ?? []).length === 0 && offNow === true && on === true && onAgain === true,
    detail: `chips=${fmt(chips)} 值上属性名=${fmt(chipTip)} 值气泡=「${fmt((valueTip?.text ?? '').trim())}」 标题=${fmt(title)} 卡片行=${fmt((card?.labels ?? []).map((l, i) => `${l}/${card.values[i]}`))} 开关 关=${offNow}(关态 chips=${fmt(chipsOff)}) 开=${on}/${onAgain}`,
  });

  // --- 6b 新键删掉后默认开(旧键不再回读) ---
  await deleteSetting('tag_tree_show_relations');
  await writeSetting('tag_tree_show_carry', 'true'); // 旧键故意留着:默认开不该被它影响
  await cdp.send('Page.reload');
  await waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 500);
  await sleep(1200);
  const chipsDefault = await relationChipsOf(cdp, FIX.A);
  records.push({
    name: '读数6b 关系开关新键删掉后默认开、行内仍是纯值(旧键不再回读)',
    ok: (chipsDefault ?? []).length === 3 && (chipsDefault ?? []).every((c) => !c.includes('→')),
    detail: `删新键后 chips=${fmt(chipsDefault)}`,
  });

  // --- 6c 关系面板:每条边的属性名就地回显 + 添加关系(属性名输入框 + 目标标签选择器) ---
  await openTagMenu(cdp, FIX.A);
  const paneOpen = await waitFor(() => cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('[data-tag-menu] button')).find((x) => x.textContent.trim() === '引用…'); if (!b) return false; b.click(); return true; })()`), 8, 200);
  await sleep(700);
  const pane = await cdp.eval(`(() => { const t = document.querySelector('[data-tag-menu]'); if (!t) return null;
    return { remarkInput: t.querySelector('input[aria-label="引用属性名"]') !== null,
      picker: t.querySelector('input[aria-label="添加引用目标"]') !== null,
      rows: Array.from(t.querySelectorAll('[data-relation-remark]')).map((x) => x.value) }; })()`);
  await pressEsc(cdp);
  records.push({
    name: '读数6c 关系面板:属性名输入框 + 目标标签选择器 + 每条边的属性名就地回显(来自边上 remark)',
    ok: paneOpen === true && pane != null && pane.remarkInput && pane.picker && (pane.rows ?? []).includes(FIX.REMARK),
    detail: `面板开=${paneOpen} 属性名输入框=${pane?.remarkInput} 选择器=${pane?.picker} 行上属性名=${fmt(pane?.rows)}`,
  });

  // --- 7 关系图 ---
  await armGraph(ui);
  await sleep(2500);
  const opened = await cdp.eval(`!!document.querySelector('[data-testid="graph-view"] canvas')`);
  await installRelationProbe(cdp);
  await setSearch(cdp, FIX.A);
  await sleep(400);
  await pickSearchItem(cdp);
  await sleep(900);
  const degA = await relationDegreesText(cdp);
  const def = await relationFrame(cdp); // 默认自适应档(centerOn 不改 k):备注应当已经画出来
  await zoomBy(cdp, 15, 120); // 缩到 MIN_K=0.5(聚合档):备注应当收起
  await sleep(700);
  const out = await relationFrame(cdp);
  await zoomBy(cdp, 12, -120); // 再放大回去,验箭头无遮挡
  await sleep(700);
  const hi = await relationFrame(cdp);
  await setSearch(cdp, `${NS}乙`);
  await sleep(400);
  await pickSearchItem(cdp);
  await sleep(900);
  const degB = await relationDegreesText(cdp);
  // 箭头尖到目标圆心的距离必须 > 目标半径(挡住「画了但被后画的点盖住」):
  // 目标 = 离箭头终点最近的那个填充圆(非聚合档下就是目标节点的圆)
  const tipsClear = (frame) => {
    const dots = frame?.dots ?? [];
    const tips = frame?.arrowTips ?? [];
    if (tips.length === 0 || dots.length === 0) return false;
    return tips.every((a) => {
      const target = dots.reduce((best, d) => {
        const dist = Math.hypot(d.x - a.end[0], d.y - a.end[1]);
        return best === null || dist < best.dist ? { dist, r: d.r } : best;
      }, null);
      return Math.hypot(a.tip[0] - a.end[0], a.tip[1] - a.end[1]) > target.r;
    });
  };
  const clearHi = tipsClear(hi);
  records.push({
    name: '读数7 关系边带箭头;箭头中点的属性名=边上 remark;默认档就出、缩到聚合档(0.5)收起;箭头尖不被目标圆盖住;信息条出/入度正确',
    ok: opened && String(degA).includes('关系（含子孙）：出 3 / 入 0') && String(degB).includes('关系（含子孙）：出 0 / 入 1')
      && (def?.texts ?? []).includes(FIX.REMARK) && !(out?.texts ?? []).includes(FIX.REMARK) && (hi?.texts ?? []).includes(FIX.REMARK) && (hi?.arrowHeads ?? 0) > 0 && clearHi,
    detail: `开图=${opened} 甲=「${degA}」 乙=「${degB}」 默认备注=${(def?.texts ?? []).includes(FIX.REMARK)} 低缩备注=${(out?.texts ?? []).includes(FIX.REMARK)} 放大备注=${(hi?.texts ?? []).includes(FIX.REMARK)} 箭头头部=${hi?.arrowHeads ?? 0} 箭头尖无遮挡=${clearHi}`,
  });
  await closeGraph(ui);
  await sleep(400);

  // --- 8 回归:关系写入不改结构 / 笔记 tags 列 / FTS / 导出 ---
  const tA = tagIdOf(FIX.A), tB = tagIdOf(FIX.B_RAW);
  const tagsAt8 = await appNoteTags(cdp, `${NS}甲笔记`, nA), ftsAt8 = ftsTagsOf(nA);
  await call('export_notes', { path: E1 });
  const d1 = xlsxContentDigest(E1);
  await call('remove_tag_relation', { fromTag: tA, toTag: tB });
  await call('set_tag_relation', { fromTag: tA, toTag: tB, remark: FIX.REMARK }); // 幂等回写(带边上属性名)
  await call('export_notes', { path: E2 });
  const d2 = xlsxContentDigest(E2);
  records.push({
    name: '读数8 树 path/depth/sort_order、笔记 tags 列、FTS、导出不因关系而变',
    ok: JSON.stringify(tagStructRows(NS)) === structAt8 && JSON.stringify(await appNoteTags(cdp, `${NS}甲笔记`, nA)) === JSON.stringify(tagsAt8)
      && ftsAt8 != null && ftsTagsOf(nA) === ftsAt8 && d1 === d2 && danglingTagRows() === 0,
    detail: `结构一致=${JSON.stringify(tagStructRows(NS)) === structAt8} 笔记tags=${fmt(tagsAt8)} FTS=${fmt(ftsAt8)} 导出摘要=${d1.slice(0, 16)}==${d2.slice(0, 16)}`,
  });

  return { records };
}
