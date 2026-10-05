/**
 * 显示用:从表达式原文定位「标签叶子」区间(`#路径` / `#=路径`)。
 * 条件栏摘要把 `+携带` 插在每个标签叶子之后,所以需要叶子在原文里的位置。
 *
 * 这是**展示级字符扫描**,不做语义校验(合法性与求值一律走后端 `validate_expr`):
 * 只镜像后端词法的 token 边界(引号短语内、裸词内部的 `#` 都不算标签起点)与路径字符集,
 * 扫不出的 `#` 原样留给普通文本,绝不猜。
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
const isInnerPunct = (c: string): boolean => c === '.' || c === '·';

/** 裸词终止字符(与后端 `is_kw_break` 同口径;`#` 不是终止符,故裸词里的 `#` 不成标签) */
const isWordBreak = (c: string): boolean => /\s/.test(c) || '()"!&|'.includes(c);

/** 严格路径合法性(与后端 `tags::parse_tag_path` 同口径:空段 / 首尾斜杠 / 孤立标点都非法) */
function isValidPath(path: string): boolean {
  if (path === '') return false;
  return path.split('/').every((seg) => {
    if (seg === '') return false;
    for (let k = 0; k < seg.length; k += 1) {
      const c = seg[k];
      if (isNameChar(c)) continue;
      if (isInnerPunct(c) && k > 0 && isNameChar(seg[k - 1]) && isNameChar(seg[k + 1])) continue;
      return false;
    }
    return true;
  });
}

/** 引号短语:跳到未转义的收尾 `"`;未闭合则到文本末尾(错误交给后端报) */
function skipQuoted(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] === '"') {
      i += 2;
      continue;
    }
    if (text[i] === '"') return i + 1;
    i += 1;
  }
  return text.length;
}

/** 从 `#` 处读一个标签:返回区间;空路径或结构非法一律 null(原样留给文本) */
function readTag(text: string, hash: number): ExprTagSpan | null {
  let i = hash + 1;
  if (text[i] === '=') i += 1;
  const pathStart = i;
  while (i < text.length) {
    const c = text[i];
    if (isNameChar(c) || c === '/') {
      i += 1;
      continue;
    }
    if (isInnerPunct(c) && isNameChar(text[i + 1])) {
      i += 1;
      continue;
    }
    break;
  }
  const path = text.slice(pathStart, i);
  if (!isValidPath(path)) return null;
  // 后端词法:路径后紧跟内嵌标点(如 `#工作.`)整串非法,不当标签处理
  if (isInnerPunct(text[i] ?? '')) return null;
  return { path, start: hash, end: i };
}

/** 表达式原文里全部标签叶子的区间(按出现顺序) */
export function exprTagSpans(text: string): ExprTagSpan[] {
  const out: ExprTagSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c) || c === '(' || c === ')' || c === '!') {
      i += 1;
      continue;
    }
    if ((c === '&' || c === '|') && text[i + 1] === c) {
      i += 2;
      continue;
    }
    if (c === '"') {
      i = skipQuoted(text, i);
      continue;
    }
    if (c === '#') {
      const span = readTag(text, i);
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
    while (i < text.length && !isWordBreak(text[i])) i += 1;
    if (i === wordStart) i += 1;
  }
  return out;
}
