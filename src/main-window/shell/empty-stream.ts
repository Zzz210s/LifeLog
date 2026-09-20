/**
 * 信息流空态判定(纯函数,spec 7.2 的三种空状态)。
 * 「有收窄条件却没有命中」与「库里一条笔记都没有」在数据上都表现为空列表,
 * 只能靠条件是否为空区分;失败态优先级最高(错误行可能已被用户关掉)。
 */
export type StreamEmptyState = 'failed' | 'empty-library' | 'no-match';

/** 空态文案:失败 / 库为空(引导写第一条)/ 有筛选但无命中(引导清空条件) */
export const EMPTY_STATE_TEXT: Record<StreamEmptyState, string> = {
  failed: '加载失败,请检查后重试',
  'empty-library': '还没有记录,在输入栏写点什么就会出现在这里',
  'no-match': '没有匹配的记录,换个关键词或清空条件试试',
};

/** 空态上唯一的动作按钮文案(与 EMPTY_STATE_TEXT 一一对应) */
export const EMPTY_STATE_ACTION: Record<StreamEmptyState, string> = {
  failed: '重试',
  'empty-library': '打开输入栏',
  'no-match': '清空条件',
};

/**
 * noteCount>0 时不需要空态(返回 null);
 * 其余情况按「失败 > 库为空 > 无匹配」判定。
 * filterEmpty 采用 isFilterEmpty 口径:排序不算收窄条件。
 */
export function streamEmptyState(args: {
  noteCount: number;
  queryFailed: boolean;
  filterEmpty: boolean;
}): StreamEmptyState | null {
  if (args.noteCount > 0) return null;
  if (args.queryFailed) return 'failed';
  return args.filterEmpty ? 'empty-library' : 'no-match';
}
