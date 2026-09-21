/**
 * 标签拖拽预校验(spec 6,纯函数):drop 前在内存里判定这次移动是否放行。
 * 校验项:补出的结构节点(id 为 null)不可拖也不可作目标、不能拖到自身、
 * 不能移进自己的子树(路径前缀判断)。时间标签已是普通标签(D3),与其他标签同权。
 * 同级重名不做前端预校验:直接放行,由后端 move_tag 拒绝并透传中文错误(任务裁定)。
 *
 * 落点分区(S8 -> 2026-09-21 重做):行内三分区(上 25/中 50/下 25)已废弃,
 * 改为「整行 = 成为子级 / 相邻行间 12px 边界带对半 = 同级插入」,分区数学不再需要,
 * 相应的 dropZoneFor / rowRatio 随之删除(见 fix-report 的 T3)。
 * 落点解析(冒泡 + 无变化判定)在 drag-resolve.ts。
 */

/** 拖拽校验的节点引用(结构上兼容 TagNode 与拖拽源记录) */
export interface DragNodeRef {
  id: number | null;
  path: string;
}

/** 落点分区:整行 = 'child'(成为其子级);边界带 = 'before' / 'after'(插到锚点行前/后,同级) */
export type DropZone = 'before' | 'after' | 'child';

/** 判定结果:ok 为假时 reason 是面向用户的中文提示 */
export type DropVerdict = { ok: true } | { ok: false; reason: string };

/** 能否拖动该节点:补出的结构节点(id null)不可拖,其余真实标签行可拖 */
export function canDrag(node: DragNodeRef): boolean {
  return node.id !== null;
}

/**
 * 能否把 source 放到 target 上:target 为 null 表示分区空白 = 移到根级,
 * 任何真实标签都放行(拖到当前父级也放行,后端无变化即成功,与右键移动一致)。
 * 注意:本函数只判"结构上允许";"原地不动"(无变化)与"无效目标向上冒泡"在 drag-resolve.ts 里收口。
 */
export function checkDrop(source: DragNodeRef, target: DragNodeRef | null): DropVerdict {
  if (!canDrag(source)) {
    return { ok: false, reason: '结构节点不可拖动' };
  }
  if (target === null) return { ok: true };
  if (target.id === null) return { ok: false, reason: '结构节点不可作为移动目标' };
  if (target.path === source.path) return { ok: false, reason: '不能移动到自身或其子孙下' };
  if (target.path.startsWith(source.path + '/')) {
    return { ok: false, reason: '不能移动到自身或其子孙下' };
  }
  return { ok: true };
}
