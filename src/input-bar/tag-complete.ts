/**
 * 标签路径补全的纯匹配层(spec 6.3):
 * 取数据由 UI 调 completeTags 命令,这里只做前缀过滤 + 去重 + 路径排序 + 限长。
 */
/** 下拉最多展示的候选条数(前端展示上限;Rust 端 complete_tags 内部上限为 50,由 SQL LIMIT 兜底) */
export const COMPLETE_LIMIT = 8;

/**
 * 光标前紧邻的 # 词元:捕获组为词元本体(可空,即刚敲下的 #)。
 * 前导字符规则与 Rust tags.rs 逐字对齐:'#' 前若是 ASCII 字母数字、'#' 或 '&',
 * 则不是标签(C#、URL 片段、HTML 实体);行首、CJK、其余标点后均放行。
 */
const TOKEN_RE = /(?<![A-Za-z0-9#&])#([^\s#]*)$/;

/**
 * 取 text 末尾的 # 词元(调用方传“光标前文本”):
 * 在词元内时返回词元本体(可为空串);不在词元内返回 null。
 */
export function tokenAt(text: string): string | null {
  const m = TOKEN_RE.exec(text);
  return m === null ? null : m[1];
}

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
