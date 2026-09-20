/**
 * 标签路径补全的纯匹配层(spec 6.3 / G3 §2):
 * 取数据由 UI 调 completeTags 命令,这里只做前缀过滤 + 去重 + 排序 + 限长。
 */
import type { CompleteItem } from '../shared/types';

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
 * 两份候选列表是否等价(路径与来源逐项都相同)。
 * 用途:输入事件里的重算必须**在结果未变时 bail out** —— 元素级 input 监听里的 setState
 * 会同步触发重渲染,而重渲染会把受控表单件的 value 写回陈旧状态(实测会把刚敲进去的字抹掉,
 * 并让 React 的变化检测误判“值未变”而不派发 onChange),详见 InputBar 的文件头注释。
 */
export function sameList(a: readonly CompleteItem[], b: readonly CompleteItem[]): boolean {
  return (
    a.length === b.length && a.every((x, i) => x.path === b[i].path && x.kind === b[i].kind)
  );
}

/**
 * 前缀匹配候选:标签项按词元前缀过滤,**别名项不做前缀过滤** —— 后端已按别名字符串前缀
 * 筛过,而别名项的 path 是目标标签路径,通常与词元不同形(别名 `日漫` -> `追番/日漫`)。
 * 按 path 去重且标签优先(别名不得遮蔽真实标签);标签项整体在前、别名项在后,
 * 各段内部按路径序;空词元匹配全部;默认限 8 条。
 */
export function completeMatch(
  candidates: readonly CompleteItem[],
  token: string,
  limit = COMPLETE_LIMIT
): CompleteItem[] {
  const byPath = (a: CompleteItem, b: CompleteItem): number =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  const ordered = [...candidates].sort((a, b) =>
    a.kind === b.kind ? byPath(a, b) : a.kind === 'tag' ? -1 : 1
  );
  const seen = new Set<string>();
  const out: CompleteItem[] = [];
  for (const c of ordered) {
    if (c.kind === 'tag' && !c.path.startsWith(token)) continue;
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
