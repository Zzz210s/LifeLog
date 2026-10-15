/**
 * 「标签名不得包含裸括号」的谓词(设计 §3.4;Rust 镜像 `src-tauri/src/tag_label_paren.rs`)。
 *
 * 名字组的定界符就是 `(`:若段名里能自由出现 `(`,`#工作(重要)` 就有两种读法 ——
 * 目标 `工作` + 名字 `重要`,还是目标就叫 `工作(重要)`?故段名文本里每个 `(`/`)` 都必须由
 * 行内 md 链接记号 `[显示](备注)` 消费掉;剩下的一律非法。md 形态照旧放行 ——
 * 真库唯一含括号的段名就是 md 形态 `[郴](chēn)州市`。
 *
 * 判定复用 `tag-label-plain.ts` 的 tokenizer(不写第二份括号语法):只有落在 **link token
 * 区间内**的括号才算被消费。于是 `**a(b)**` / `` `a(b)` `` 里的括号仍是裸的 ——
 * tokenizer 不递归内层,粗体/代码 token 里的 `](…)` 只是字面文本,不是链接记号。
 * 两侧用例同表(见 `tag-label-paren.test.ts`),任一方改了判据同时红。
 */
import { parseTagLabelSpans } from './tag-label-plain';

/** 名字文本里是否含裸括号(不属于任何行内 md 链接记号的 `(` / `)`) */
export function hasBareParen(raw: string): boolean {
  const links = parseTagLabelSpans(raw).filter((s) => s.token.kind === 'link');
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if ((c === '(' || c === ')') && !links.some((s) => i >= s.start && i < s.end)) return true;
  }
  return false;
}
