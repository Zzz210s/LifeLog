/**
 * 标签拖拽预校验(spec 6,纯函数):drop 前在内存里判定这次移动是否放行。
 * 校验项:补出的结构节点(id 为 null)不可拖也不可作目标、不能拖到自身、
 * 不能移进自己的子树(路径前缀判断),以及**时间子树(系统维护)既不可拖也不可作目标**
 * (spec 4.5;标签分区已把它从数据层滤掉,这里是合成事件/数据异常时的兜底,后端另有守卫)。
 * 同级重名不做前端预校验:直接放行,由后端 move_tag 拒绝并透传中文错误(任务裁定)。
 */
import { isTimeTagPath } from '../../shared/time-tag';

/** 拖拽校验的节点引用(结构上兼容 TagNode 与拖拽源记录) */
export interface DragNodeRef {
  id: number | null;
  path: string;
}

/** 判定结果:ok 为假时 reason 是面向用户的中文提示 */
export type DropVerdict = { ok: true } | { ok: false; reason: string };

/** 能否拖动该节点:补出的结构节点(id null)与时间子树都不可拖,其余真实标签行可拖 */
export function canDrag(node: DragNodeRef): boolean {
  return node.id !== null && !isTimeTagPath(node.path);
}

/**
 * 能否把 source 放到 target 上:target 为 null 表示分区空白 = 移到根级,
 * 任何真实标签都放行(拖到当前父级也放行,后端无变化即成功,与右键移动一致)。
 */
export function checkDrop(source: DragNodeRef, target: DragNodeRef | null): DropVerdict {
  if (!canDrag(source)) {
    return {
      ok: false,
      reason: isTimeTagPath(source.path) ? '时间标签由系统维护,不可移动' : '结构节点不可拖动',
    };
  }
  if (target === null) return { ok: true };
  if (isTimeTagPath(target.path)) return { ok: false, reason: '不能移动到时间标签下' };
  if (target.id === null) return { ok: false, reason: '结构节点不可作为移动目标' };
  if (target.path === source.path) return { ok: false, reason: '不能移动到自身或其子孙下' };
  if (target.path.startsWith(source.path + '/')) {
    return { ok: false, reason: '不能移动到自身或其子孙下' };
  }
  return { ok: true };
}
