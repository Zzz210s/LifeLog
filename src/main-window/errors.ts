import type { ErrorKind } from './ErrorBar';

/**
 * 按来源留存错误:G4 单值错误槽会被跨源覆盖(标签失败 -> 查询失败顶替 -> 查询重试清空,
 * 标签失败痕迹彻底消失),改为每个来源一份,多源失败互不覆盖、并存渲染。
 */
export type ErrorMap = Partial<Record<ErrorKind, string>>;

/** 多错误纵向堆叠的固定渲染顺序(查询 -> 标签 -> 操作) */
export const ERROR_KINDS: readonly ErrorKind[] = ['query', 'tags', 'action'];

/** 记下某来源的错误(同源后到覆盖先到,以该来源最新失败为准) */
export function putError(map: ErrorMap, kind: ErrorKind, message: string): ErrorMap {
  return { ...map, [kind]: message };
}

/** 清除某来源的错误:不牵连其他来源;该源本无错误时返回原引用 */
export function dropError(map: ErrorMap, kind: ErrorKind): ErrorMap {
  if (!map[kind]) return map;
  const next = { ...map };
  delete next[kind];
  return next;
}
