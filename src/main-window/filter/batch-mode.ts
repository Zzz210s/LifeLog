/**
 * 批量编辑的纯逻辑(spec 2026-10-17 §3):选中集增删 + 两个「全选」按钮的态与文案。
 * 状态本体住在 `use-batch-selection`;这里只有纯函数,便于单测钉住每一条态迁移。
 * 文案与态在同一个函数里出 —— 两处各判一次必然漂移(按钮写着「全选」但点了是取消)。
 */
export const BATCH_SELECT_WARN = 500;
export const BATCH_DELETE_WARN = 200;

/** 单条切换:在集合里就移出,否则加入(返回新集合,不原地改) */
export function toggleId(sel: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(sel);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function addIds(sel: ReadonlySet<number>, ids: readonly number[]): Set<number> {
  const next = new Set(sel);
  for (const id of ids) next.add(id);
  return next;
}

export function removeIds(sel: ReadonlySet<number>, ids: readonly number[]): Set<number> {
  const next = new Set(sel);
  for (const id of ids) next.delete(id);
  return next;
}

/** 这组 id 是否已全部在选中集里;空组恒 false(没有东西可「全选」,按钮不该变「取消」) */
export function containsAll(sel: ReadonlySet<number>, ids: readonly number[]): boolean {
  return ids.length > 0 && ids.every((id) => sel.has(id));
}

/** 「全选本页」按钮文案:已全选时是取消档 */
export function selectPageLabel(all: boolean): string {
  return all ? '取消本页' : '全选本页';
}

/** 「全选筛选结果」按钮文案:已知总数且超过提醒阈值时带上读数(不拦,只是让用户看清规模) */
export function selectAllLabel(all: boolean, total: number | null): string {
  if (all) return '取消全选';
  return total !== null && total > BATCH_SELECT_WARN ? `全选筛选结果（${total}）` : '全选筛选结果';
}

/** 加标签回执(added = 0 时不是成功文案,而是「没什么可改的」) */
export function addTagNotice(added: number, existed: number, label: string): string {
  if (added === 0 && existed === 0) return '没有需要改动的条目';
  return existed > 0
    ? `已给 ${added} 条加 #${label}（${existed} 条已有）`
    : `已给 ${added} 条加 #${label}`;
}

/** 去标签回执:名线被保留时必须在文案里交代(否则用户以为关系也被删了) */
export function removeTagNotice(removed: number, keptNamed: number, label: string): string {
  if (removed === 0 && keptNamed === 0) return '没有需要改动的条目';
  return keptNamed > 0
    ? `已从 ${removed} 条去掉 #${label}（${keptNamed} 条带同名关系，未动）`
    : `已从 ${removed} 条去掉 #${label}`;
}
