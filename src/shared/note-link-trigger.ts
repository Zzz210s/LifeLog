/**
 * `[[` 补全的**触发**与**采纳**纯函数(设计 N2/N5/N7;三处输入点共用)。
 *
 * 语法口径与 Rust `links.rs::link_spans` 一致:直接复用 `note-link-syntax.ts` 的扫描器
 * (`lastUnclosedOpen` / `inFencedBlock`),不另写一份围栏 / 行内代码 / 转义判断。
 * 触发范围只在**光标所在行**内(链接标题不能含换行);`]]` 出现在光标之前即视为已完成。
 */
import { inFencedBlock, lastUnclosedOpen } from './note-link-syntax';

/** 一处未闭合链接的触发点 */
export interface LinkTrigger {
  /** `[[` 在原文里的下标 */
  start: number;
  /** `[[` 与光标之间的文本(授权的候选过滤词,不含 `]]`、不含换行) */
  query: string;
}

/** caret 夹到 [0, len](越界按末位、负值按行首处理) */
function clamp(n: number, len: number): number {
  return n < 0 ? 0 : n > len ? len : n;
}

/**
 * 光标前是否处于「未闭合的 `[[` 链接」上下文;不满足返回 null。
 * 围栏代码块内、行内代码里的 `[[`、`\[[` 转义、已闭合的 `[[...]]` 都不算。
 */
export function detectLinkTrigger(text: string, caret: number): LinkTrigger | null {
  const pos = clamp(caret, text.length);
  if (inFencedBlock(text, pos)) return null;
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const line = text.slice(lineStart, pos);
  const open = lastUnclosedOpen(line);
  if (open < 0) return null;
  // query 不含 `]`(单个 `]` 也是标题终止符,设计 §2)
  const raw = line.slice(open + 2);
  const cut = raw.indexOf(']');
  return { start: lineStart + open, query: cut >= 0 ? raw.slice(0, cut) : raw };
}

/**
 * 采纳候选:用 `[[title]]` 替换从 `[[` 到「光标处(或光标后已有的 `]]` 闭合)」的那段,
 * 光标落在 `]]` 之后;后面已是 `]]` 时不重复补(设计 N5)。没有触发点则原样返回。
 */
export function acceptLink(
  text: string,
  caret: number,
  title: string
): { text: string; caret: number } {
  const trigger = detectLinkTrigger(text, caret);
  if (!trigger) return { text, caret };
  const pos = clamp(caret, text.length);
  const close = text.indexOf(']]', trigger.start + 2);
  const end = close >= 0 ? close + 2 : pos;
  const inserted = `[[${title}]]`;
  return {
    text: text.slice(0, trigger.start) + inserted + text.slice(end),
    caret: trigger.start + inserted.length,
  };
}
