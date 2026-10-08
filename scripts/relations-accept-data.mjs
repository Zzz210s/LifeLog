// 关系端到端读数的**数据层**(设计 §11 的 1-4):只发 IPC / 读库,判定也在此。
// 从 dev-relations-accept.mjs 抽出(守 200 行红线),调用方只负责把 records 打出来。
import {
  NS, FIX, fmt, get, condIds, queryCount, sleep, noteIdOf, tagIdOf, counts,
  relCond, excludeRelCond, legacyRelCond, hasIsTypeColumn, typeEdgeRows, targetStates,
  relationRows, relationRowsFrom, relationRowsTo, danglingTagRows, mergeLogRows, tagStructRows,
} from './relations-accept-lib.mjs';

/** @returns {{records: {name:string,ok:boolean,detail:string}[], structAt8: string}} */
export async function runReadings1to4(call, cdp, { base, baseRelations, fixIds, nA }) {
  const records = [];
  const tA = tagIdOf(FIX.A), tB = tagIdOf(FIX.B_RAW), tD = tagIdOf(FIX.D);

  // 1 迁移 022+023
  const states = targetStates().map((x) => `${x.target_type}:${x.n}`).join(',');
  const onlyNoteTag = targetStates().every((x) => x.target_type === 'note' || x.target_type === 'tag');
  records.push({
    name: '读数1 迁移 022+023:版本 27 / is_type 列消失 / 目标只有 note+tag / 24 条原边原样 / integrity ok',
    ok: base.version === 27 && !hasIsTypeColumn() && typeEdgeRows() === 0 && onlyNoteTag
      && JSON.stringify(relationRows()) === JSON.stringify(baseRelations) && base.integrity === 'ok',
    detail: `version=${base.version} is_type列=${hasIsTypeColumn()} type边=${typeEdgeRows()} 目标=${states} 关系边=${relationRows().length} integrity=${base.integrity}`,
  });

  // 2 增删幂等 + 属性名 upsert 到边上(迁移 023) + 环拒绝 + 无悬空
  /** 边上存的属性名(迁移 023 后不再取目标标签名字里的 md 备注) */
  const edgeRemark = (from, to) => get("SELECT remark FROM tag_links WHERE tag_id=?1 AND target_type='tag' AND target_id=?2", from, to)?.remark ?? null;
  await call('set_tag_relation', { fromTag: tA, toTag: tB, remark: FIX.REMARK });
  await call('set_tag_relation', { fromTag: tA, toTag: tB, remark: `${NS}别名属性` }); // 同向边 upsert:只改属性名不增行
  const remarkUpsert = edgeRemark(tA, tB);
  await call('set_tag_relation', { fromTag: tA, toTag: tB, remark: FIX.REMARK });
  const idem = relationRowsFrom(tA);
  const selfMsg = await call('set_tag_relation', { fromTag: tA, toTag: tA, remark: '' }).then(() => '', (e) => String(e));
  const cy2 = await call('set_tag_relation', { fromTag: tB, toTag: tA, remark: '' }).then(() => '', (e) => String(e));
  const tC0 = tagIdOf(FIX.C);
  await call('set_tag_relation', { fromTag: tB, toTag: tC0, remark: '' });
  const cy3 = await call('set_tag_relation', { fromTag: tC0, toTag: tA, remark: '' }).then(() => '', (e) => String(e));
  await call('remove_tag_relation', { fromTag: tB, toTag: tC0 });
  await call('set_tag_relation', { fromTag: tA, toTag: tC0, remark: '' });
  await call('set_tag_relation', { fromTag: tA, toTag: tD, remark: '' });
  await call('remove_tag_relation', { fromTag: tA, toTag: tD });
  await call('set_tag_relation', { fromTag: tA, toTag: tD, remark: '' }); // 移除后再加
  const outA = relationRowsFrom(tA);
  await call('delete_tag', { tagId: tC0 });
  await sleep(400);
  const afterDel = { dangling: danglingTagRows(), toC: relationRowsTo(tC0), fromA: relationRowsFrom(tA) };
  await call('save_input_note', { content: `${NS}丙笔记二\n#${FIX.C}` });
  await sleep(400);
  await call('set_tag_relation', { fromTag: tA, toTag: tagIdOf(FIX.C), remark: '' });
  records.push({
    name: '读数2 加/移除幂等;属性名在边上(同向重复 set 只改 remark 不增行);自指向与 2/3 环被拒(中文);删被指向标签后无悬空边',
    ok: idem === 1 && remarkUpsert === `${NS}别名属性` && edgeRemark(tA, tB) === FIX.REMARK && outA === 3
      && selfMsg.includes('自己') && cy2.includes('循环') && cy3.includes('循环')
      && afterDel.dangling === 0 && afterDel.toC === 0 && afterDel.fromA === 2 && relationRowsFrom(tA) === 3,
    detail: `A出边=${idem}->${outA};属性名 upsert=${remarkUpsert}->${edgeRemark(tA, tB)};自指向=「${selfMsg}」;2环=「${cy2}」;3环=「${cy3}」;删丙后 悬空=${afterDel.dangling} 丙入边=${afterDel.toC} A出边=${afterDel.fromA}`,
  });

  // 3 筛选
  const hitIds = await condIds(cdp, relCond(FIX.B_RAW));
  const exclB = await queryCount(cdp, excludeRelCond(FIX.B_RAW));
  const legacy = await queryCount(cdp, legacyRelCond(FIX.B_RAW));
  const total = counts().notes;
  const wantIds = [nA, noteIdOf(`${NS}甲子笔记`)].sort((a, b) => a - b);
  records.push({
    name: '读数3 关系条件命中 = 指向该标签的标签(甲)子树下的笔记;排除互补;旧字段 types 回读一致',
    ok: JSON.stringify([...hitIds].sort((a, b) => a - b)) === JSON.stringify(wantIds) && hitIds.length + exclB === total
      && legacy === hitIds.length,
    detail: `命中=${fmt(hitIds)}(期望 ${fmt(wantIds)}) 排除=${exclB} 合计=${hitIds.length + exclB}/${total} 旧字段回读=${legacy}`,
  });

  // 4 自动合并(移动成同父同名)
  const rootDup = tagIdOf(FIX.DUP), parent = tagIdOf(FIX.PARENT);
  await call('set_tag_relation', { fromTag: rootDup, toTag: tD, remark: '' });
  await call('move_tag', { tagId: rootDup, newParentId: parent });
  await sleep(600);
  const merged = tagIdOf(FIX.DUP_CHILD);
  const mergedNotes = get("SELECT COUNT(*) n FROM tag_links WHERE target_type='note' AND tag_id=?1", merged).n;
  const leaf = FIX.DUP_GRAND.split('/')[1];
  const grandPath = get('SELECT path FROM tags WHERE path=?1', `${FIX.DUP_CHILD}/${leaf}`)?.path ?? null;
  const mergedEdges = relationRowsFrom(merged);
  const logs = mergeLogRows().filter((l) => fixIds.includes(l.source_tag_id) || fixIds.includes(l.target_tag_id));
  records.push({
    name: '读数4 移动成同父同名 → 整棵自动合并(笔记并集/子标签整棵搬/边并集),tag_merge_log 有记录',
    ok: tagIdOf(FIX.DUP) === null && merged != null && mergedNotes === 2
      && grandPath === `${FIX.DUP_CHILD}/${leaf}` && mergedEdges === 1
      && logs.some((l) => l.source_tag_id === rootDup && l.target_tag_id === merged),
    detail: `源标签已消失=${tagIdOf(FIX.DUP) === null} 合并后笔记=${mergedNotes} 孙标签路径=${grandPath} 边=${mergedEdges} 日志=${fmt(logs.map((l) => `${l.source_tag_id}->${l.target_tag_id}`))}`,
  });

  return { records, structAt8: JSON.stringify(tagStructRows(NS)) };
}
