/**
 * 标签名行内 markdown 的**解析口径**(tokenizer + `tagLabelPlain`)。
 *
 * 两种口径**同源**于这一个 tokenizer,不许各写一份:
 * - `tagLabelPlain`:去掉语法后的可见文本(给 title / 条件摘要 / `#` 补全 / 导出 / 确认文案);
 * - `renderTagLabel`(见 `tag-label.ts`):可见文本 -> React 节点,绝不渲染成 `<a>`。
 *
 * 语法刻意收得很窄(标签名不是文档):链接、粗体、斜体、下划线强调、删除线、行内代码、反斜杠转义。
 * **不做实体解码**:`&amp;` 在标签名里保持字面(正文由 markdown-it 解码,这里有意与正文不同 ——
 * Rust 侧无依赖做实体表,而它又是 FTS/别名/导出的真源);不做 linkify / 图片 / raw HTML。
 * 非法 / 未闭合 / 嵌套一律**逐字退化**(不猜后半段、不递归内层),这比"聪明的半解析"可预测。
 * 与 Rust `src-tauri/src/tag_label_plain.rs` 逐条一致,由 `fixtures/tag-label.json` 两侧共读钉住。
 * 从 `tag-label.ts` 拆出只为守 200 行红线,不改变调用方(那边 `export ... from` 再导出)。
 */
export type TagLabelToken =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; title: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'del'; text: string }
  | { kind: 'code'; text: string };

/** 命中的 token 与它吃掉的源串长度 */
interface Hit {
  token: TagLabelToken;
  len: number;
}

/** sticky 正则:从给定下标起匹配,失败即 null(不向后搜索,保证"就地解析") */
const LINK_RE = /\[([^[\]]+)\]\(([^()]*)\)/y;
const STRONG_RE = /\*\*([^*]+)\*\*/y;
const EM_RE = /\*([^*]+)\*/y;
const DEL_RE = /~~([^~]+)~~/y;
const UNDER_STRONG_RE = /__([^_]+)__/y;
const UNDER_EM_RE = /_([^_]+)_/y;
const CODE_RE = /`([^`]+)`/y;

/** 反斜杠可转义的字符(正文转义一切标点;标签名只放行这几个) */
const ESCAPABLE = new Set(['\\', '*', '_', '`', '[', ']']);

/** 字母/数字(含 CJK,与 Rust `char::is_alphanumeric` 同口径) */
const WORD_RE = /[\p{L}\p{N}]/u;

function matchAt(re: RegExp, s: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(s);
}

/** 取从 at 起连续的同一字符(用于把失败的 `*` / `` ` `` / `~` / `_` 整串当字面量吞掉) */
function runOf(s: string, at: number): string {
  const c = s[at];
  let end = at;
  while (end < s.length && s[end] === c) end++;
  return s.slice(at, end);
}

/**
 * 下划线强调的 flanking 守卫(对齐 markdown-it 的判定;`*` 的宽松行为不受此约束):
 * 开定界符左侧不得是字母/数字、右侧不得是空白;收定界符右侧不得是字母/数字、左侧不得是空白。
 * 没有它,`a_b_c` / `snake_case` / `工作_重点_` 会被吃掉 —— 这些是真实标签名里最常见的形态。
 */
function flankOk(s: string, at: number, run: number, opening: boolean): boolean {
  const outer = opening ? s[at - 1] : s[at + run];
  const inner = opening ? s[at + run] : s[at - 1];
  return !(outer !== undefined && WORD_RE.test(outer)) && !(inner !== undefined && /\s/.test(inner));
}

/** 下划线强调:正则先取形,再由 flanking 守卫决定收不收(run=2 走 `__` 粗体,run=1 走 `_` 斜体) */
function matchUnder(re: RegExp, run: number, s: string, at: number): Hit | null {
  const m = matchAt(re, s, at);
  if (m === null) return null;
  if (!flankOk(s, at, run, true)) return null;
  if (!flankOk(s, at + m[0].length - run, run, false)) return null;
  return { token: { kind: run === 2 ? 'strong' : 'em', text: m[1] }, len: m[0].length };
}

/**
 * 行内 token 序列(唯一解析入口)。
 * 逐字符左到右扫描,只在当前位置尝试各种语法;失败就把该字符(或整串同类定界符)并进文本。
 */
export function parseTagLabel(raw: string): TagLabelToken[] {
  const tokens: TagLabelToken[] = [];
  let buf = '';
  let i = 0;
  const flush = (): void => {
    if (buf !== '') {
      tokens.push({ kind: 'text', text: buf });
      buf = '';
    }
  };
  const eatRun = (): void => {
    const run = runOf(raw, i);
    buf += run;
    i += run.length;
  };
  while (i < raw.length) {
    const c = raw[i];
    if (c === '\\') {
      const next = raw[i + 1];
      if (next !== undefined && ESCAPABLE.has(next)) {
        buf += next;
        i += 2;
      } else {
        buf += c;
        i++;
      }
      continue;
    }
    if (c === '*') {
      const strong = matchAt(STRONG_RE, raw, i);
      if (strong !== null) {
        flush();
        tokens.push({ kind: 'strong', text: strong[1] });
        i += strong[0].length;
        continue;
      }
      const em = matchAt(EM_RE, raw, i);
      if (em !== null) {
        flush();
        tokens.push({ kind: 'em', text: em[1] });
        i += em[0].length;
        continue;
      }
      eatRun();
      continue;
    }
    if (c === '_') {
      const hit = matchUnder(UNDER_STRONG_RE, 2, raw, i) ?? matchUnder(UNDER_EM_RE, 1, raw, i);
      if (hit !== null) {
        flush();
        tokens.push(hit.token);
        i += hit.len;
        continue;
      }
      eatRun();
      continue;
    }
    if (c === '~') {
      const del = matchAt(DEL_RE, raw, i);
      if (del !== null) {
        flush();
        tokens.push({ kind: 'del', text: del[1] });
        i += del[0].length;
        continue;
      }
      eatRun();
      continue;
    }
    if (c === '`') {
      const code = matchAt(CODE_RE, raw, i);
      if (code !== null) {
        flush();
        tokens.push({ kind: 'code', text: code[1] });
        i += code[0].length;
        continue;
      }
      eatRun();
      continue;
    }
    if (c === '[') {
      const link = matchAt(LINK_RE, raw, i);
      if (link !== null) {
        flush();
        tokens.push({ kind: 'link', text: link[1], title: link[2] });
        i += link[0].length;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return tokens;
}

/** 去掉 md 语法后的可见文本(空串原样返回空串) */
export function tagLabelPlain(raw: string): string {
  return parseTagLabel(raw)
    .map((t) => t.text)
    .join('');
}
