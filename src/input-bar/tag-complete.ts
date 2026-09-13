/**
 * 标签路径补全的纯匹配层(spec 6.3):
 * 取数据由 UI 调 completeTags 命令,这里只做前缀过滤 + 去重 + 路径排序 + 限长。
 */
/** 下拉最多展示的候选条数(与 Rust 端 COMPLETE_LIMIT 一致) */
export const COMPLETE_LIMIT = 8;

/**
 * 前缀匹配候选:按路径排序、去重(保留首个)、默认限 8 条。
 * 空词元匹配全部;Rust 端已排好序,这里重排是为了对任意来源的候选都稳定。
 */
export function completeMatch(candidates: string[], token: string, limit = COMPLETE_LIMIT): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...candidates].sort()) {
    if (!c.startsWith(token) || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
