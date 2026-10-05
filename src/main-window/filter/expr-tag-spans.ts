/**
 * 显示用:从表达式原文定位「标签叶子」区间(`#路径` / `#=路径`)。
 * 条件栏摘要把 `+携带` 插在每个标签叶子之后,所以需要叶子在原文里的位置。
 *
 * 语境里的**唯一例外**:仓库标准是「前端不实现标签语法、解析走后端」,但摘要要按叶子插小字,
 * 只能在前端做一次**展示级**镜像。它不参与语义/求值(合法性一律走后端 `validate_expr`),
 * 且由共享向量 `fixtures/expr-tag-spans.json` 两侧各跑一遍钉住
 * (前端断言在本目录 `expr-tag-spans.test.ts`,后端在 `expr/lexer_fixtures_tests.rs`)。
 *
 * 只镜像后端词法的 token 边界(引号短语内、裸词内部的 `#` 都不算标签起点)与路径字符集,
 * 扫不出的 `#` 原样留给普通文本,绝不猜。下标一律是**字符下标 = Unicode 码位**
 * (与后端 lexer 的 `pos` 同口径),所以迭代必须按码位(`[...text]`),不能拿 UTF-16 码元当字符。
 */

export interface ExprTagSpan {
  /** 标签路径(不含 `#` 与 `#=`) */
  path: string;
  /** 起始字符下标(指向 `#`) */
  start: number;
  /** 尾后字符下标 */
  end: number;
}

/** 名称字符(与后端 `tags::is_tag_char` 同口径:字母 / 数字 / 下划线 / 连字符) */
const isNameChar = (c: string | undefined): boolean =>
  c !== undefined && /[\p{L}\p{N}_-]/u.test(c);

/** 名称内部标点(与后端 `tags::is_inner_punct` 同口径:须夹在名称字符之间才算名称) */
const isInnerPunct = (c: string | undefined): boolean => c === '.' || c === '·';

/** 裸词终止字符(与后端 `is_kw_break` 同口径;`#` 不是终止符,故裸词里的 `#` 不成标签) */
const isWordBreak = (c: string): boolean => /\s/.test(c) || '()"!&|'.includes(c);

/** 严格路径合法性(与后端 `tags::parse_tag_path` 同口径:空段 / 首尾斜杠 / 孤立标点都非法) */
function isValidPath(path: string): boolean {
  if (path === '') return false;
  return path.split('/').every((seg) => {
    if (seg === '') return false;
    const cs = [...seg];
    for (let k = 0; k < cs.length; k += 1) {
      if (isNameChar(cs[k])) continue;
      if (isInnerPunct(cs[k]) && k > 0 && isNameChar(cs[k - 1]) && isNameChar(cs[k + 1])) continue;
      return false;
    }
    return true;
  });
}

/** 引号短语:跳到未转义的收尾 `"`;未闭合则到文本末尾(错误交给后端报) */
function skipQuoted(chars: string[], start: number): number {
  let i = start + 1;
  while (i < chars.length) {
    if (chars[i] === '\\' && chars[i + 1] === '"') {
      i += 2;
      continue;
    }
    if (chars[i] === '"') return i + 1;
    i += 1;
  }
  return chars.length;
}

/** 从 `#` 处读一个标签:返回区间;空路径或结构非法一律 null(原样留给文本) */
function readTag(chars: string[], hash: number): ExprTagSpan | null {
  let i = hash + 1;
  if (chars[i] === '=') i += 1;
  const pathStart = i;
  while (i < chars.length) {
    const c = chars[i];
    if (isNameChar(c) || c === '/') {
      i += 1;
      continue;
    }
    if (isInnerPunct(c) && isNameChar(chars[i + 1])) {
      i += 1;
      continue;
    }
    break;
  }
  const path = chars.slice(pathStart, i).join('');
  if (!isValidPath(path)) return null;
  // 后端词法:路径后紧跟内嵌标点(如 `#工作.`)整串非法,不当标签处理
  if (isInnerPunct(chars[i])) return null;
  return { path, start: hash, end: i };
}

/** 表达式原文里全部标签叶子的区间(按出现顺序,下标为码位) */
export function exprTagSpans(text: string): ExprTagSpan[] {
  const chars = [...text];
  const out: ExprTagSpan[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (/\s/.test(c) || c === '(' || c === ')' || c === '!') {
      i += 1;
      continue;
    }
    if ((c === '&' || c === '|') && chars[i + 1] === c) {
      i += 2;
      continue;
    }
    if (c === '"') {
      i = skipQuoted(chars, i);
      continue;
    }
    if (c === '#') {
      const span = readTag(chars, i);
      if (span !== null) {
        out.push(span);
        i = span.end;
        continue;
      }
      i += 1;
      continue;
    }
    // 裸词:吞到终止字符;落单的 `&` / `|` 不构成运算符,后移一格
    const wordStart = i;
    while (i < chars.length && !isWordBreak(chars[i])) i += 1;
    if (i === wordStart) i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 表达式展示片段:截断 + 按标签叶子插 `+携带`(从 filter-chips.ts 挪来,守 200 行上限)
// ---------------------------------------------------------------------------

/** 表达式 chip / 摘要里原文的截断长度(超出补省略号;全文放 title) */
export const EXPR_TEXT_MAX = 40;

/** 按字符(码点)截断表达式原文:不超长原样返回,超长截到 EXPR_TEXT_MAX 并补「…」 */
export function truncateExpr(text: string, max = EXPR_TEXT_MAX): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('') + '…';
}

/** 摘要片段:carry=true 的片段渲染成小字(目前只有 `+携带`);text 含分隔符 */
export type SummarySegment = { text: string; carry: boolean };

/** 携带标记:标签条件也含「携带它的标签子树」下的笔记(spec §5),摘要里用小字标出 */
export const CARRY_MARK = '+携带';

/** 有携带者的标签路径集合;null = 数据未就绪(退回现在的行为:都显示) */
export type CarryPaths = ReadonlySet<string> | null;

/** 是否给该路径标 `+携带`:数据未就绪时退回显示,拿到数据后只看它是否真有携带者 */
export const showCarry = (path: string, carryPaths: CarryPaths): boolean =>
  carryPaths === null || carryPaths.has(path);

/**
 * 表达式段:原文按标签叶子切成若干片段,每个叶子后按需跟 `+携带` 小字。
 * 截断先做(显示口径与 chip 一致),再在截断后的文本里定位叶子 —— 被截掉的半个标签不再标。
 * 切片按码位(与 `exprTagSpans` 的下标口径一致),否则 emoji/扩展汉字会切错位。
 */
export function exprSegments(
  text: string,
  truncate: boolean,
  carryPaths: CarryPaths
): SummarySegment[] {
  const shown = truncate ? truncateExpr(text) : text;
  const chars = [...shown];
  const at = (a: number, b: number): string => chars.slice(a, b).join('');
  const segs: SummarySegment[] = [{ text: '表达式:', carry: false }];
  let pos = 0;
  for (const tag of exprTagSpans(shown)) {
    if (tag.start > pos) segs.push({ text: at(pos, tag.start), carry: false });
    segs.push({ text: at(tag.start, tag.end), carry: false });
    if (showCarry(tag.path, carryPaths)) segs.push({ text: CARRY_MARK, carry: true });
    pos = tag.end;
  }
  if (pos < chars.length) segs.push({ text: at(pos, chars.length), carry: false });
  return segs;
}
