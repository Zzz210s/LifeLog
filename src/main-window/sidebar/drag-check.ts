/**
 * 标签拖拽预校验(spec 6,纯函数):drop 前在内存里判定这次移动是否放行。
 * 校验项:补出的结构节点(id 为 null)不可拖也不可作目标、不能拖到自身、
 * 不能移进自己的子树(路径前缀判断)。时间标签已是普通标签(D3),与其他标签同权。
 * 同级重名不做前端预校验:直接放行,由后端 move_tag 拒绝并透传中文错误(任务裁定)。
 */

/** 拖拽校验的节点引用(结构上兼容 TagNode 与拖拽源记录) */
export interface DragNodeRef {
  id: number | null;
  path: string;
}

/** 行内落点分区(S8):上 25% 插到该行之前、下 25% 插到该行之后(均为同级),中 50% 成为其子级 */
export type DropZone = 'before' | 'after' | 'child';

/**
 * 按行内相对位置(0..1)判定落点分区(S8)。边界归属:上半区 [0,0.25) 前插、
 * 中部 [0.25,0.75) 成为子级、下半区 [0.75,1] 后插。越界值钳到 [0,1]。
 */
export function dropZoneFor(ratio: number): DropZone {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0.5;
  if (r < 0.25) return 'before';
  if (r >= 0.75) return 'after';
  return 'child';
}

/** 行内相对位置(0..1):clientY 相对行矩形顶边;高度非法时取中部 */
export function rowRatio(clientY: number, top: number, height: number): number {
  if (!Number.isFinite(height) || height <= 0) return 0.5;
  return Math.min(1, Math.max(0, (clientY - top) / height));
}

/** 判定结果:ok 为假时 reason 是面向用户的中文提示 */
export type DropVerdict = { ok: true } | { ok: false; reason: string };

/** 能否拖动该节点:补出的结构节点(id null)不可拖,其余真实标签行可拖 */
export function canDrag(node: DragNodeRef): boolean {
  return node.id !== null;
}

/**
 * 能否把 source 放到 target 上:target 为 null 表示分区空白 = 移到根级,
 * 任何真实标签都放行(拖到当前父级也放行,后端无变化即成功,与右键移动一致)。
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
