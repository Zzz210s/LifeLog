import type { ErrorKind } from './ErrorBar';

/**
 * 按来源留存错误:G4 单值错误槽会被跨源覆盖(标签失败 -> 查询失败顶替 -> 查询重试清空,
 * 标签失败痕迹彻底消失),改为每个来源一份,多源失败互不覆盖、并存渲染。
 */
export type ErrorMap = Partial<Record<ErrorKind, string>>;

/**
 * 来源 -> 渲染/无障碍名称。Record<ErrorKind, ...> 让 "新增来源却漏登记" 直接编译失败,
 * 不再靠人工同步数组(旧写法加来源忘加数组会静默不渲染)。
 */
const KIND_META: Record<ErrorKind, { name: string }> = {
  query: { name: '查询' },
  tags: { name: '标签' },
  action: { name: '操作' },
};

/** 多错误纵向堆叠的固定渲染顺序(查询 -> 标签 -> 操作);顺序即 Record 键序 */
export const ERROR_KINDS: readonly ErrorKind[] = Object.keys(KIND_META) as ErrorKind[];

/** 关闭按钮的无障碍名称,按来源派生:多条错误同屏时读屏才能区分关的是哪条 */
export function dismissLabel(kind: ErrorKind): string {
  return `关闭${KIND_META[kind].name}错误提示`;
}

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
