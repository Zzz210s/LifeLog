/** 时间标签根名(与后端 `timetag::TIME_ROOT` 一致);时间标签是系统元数据,不是用户标签 */
export const TIME_ROOT = '时间排序';

/** 路径是否属于时间子树(`时间排序` 自身或 `时间排序/...`);与后端 is_time_path 同规则 */
export function isTimeTagPath(path: string): boolean {
  return path === TIME_ROOT || path.startsWith(TIME_ROOT + '/');
}

/** 界面 chip / 条件摘要用的标签集合:滤掉时间标签(日期在笔记头部单独显示,不重复堆 chip) */
export function normalTags(tags: string[]): string[] {
  return tags.filter((t) => !isTimeTagPath(t));
}
