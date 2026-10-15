/**
 * 标签名行内 markdown 的**语法匹配器**(正则 + flanking 守卫),供 `tag-label-plain.ts` 的
 * 扫描器调用。自那边拆出(守 200 行红线),口径与 Rust `src-tauri/src/tag_label_plain.rs` 的
 * `pair` / `match_code` / `match_link` / `match_under` / `flank_ok` **逐条一致**:
 * 匹配一律**就地**(失败即 null,不向后搜索、不递归内层)。
 */
/** 命中的 token 与它吃掉的源串长度 */
interface Hit {
  token: { kind: 'strong' | 'em'; text: string };
  len: number;
}

/** sticky 正则:从给定下标起匹配,失败即 null(不向后搜索,保证"就地解析") */
export const LINK_RE = /\[([^[\]]+)\]\(([^()]*)\)/y;
export const STRONG_RE = /\*\*([^*]+)\*\*/y;
export const EM_RE = /\*([^*]+)\*/y;
export const DEL_RE = /~~([^~]+)~~/y;
export const CODE_RE = /`([^`]+)`/y;
const UNDER_STRONG_RE = /__([^_]+)__/y;
const UNDER_EM_RE = /_([^_]+)_/y;

/** 反斜杠可转义的字符(正文转义一切标点;标签名只放行这几个) */
export const ESCAPABLE = new Set(['\\', '*', '_', '`', '[', ']']);

/** 字母/数字(含 CJK,与 Rust `char::is_alphanumeric` 同口径) */
const WORD_RE = /[\p{L}\p{N}]/u;

export function matchAt(re: RegExp, s: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(s);
}

/** 取从 at 起连续的同一字符(用于把失败的 `*` / `` ` `` / `~` / `_` 整串当字面量吞掉) */
export function runOf(s: string, at: number): string {
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
function matchUnderRun(re: RegExp, run: number, s: string, at: number): Hit | null {
  const m = matchAt(re, s, at);
  if (m === null) return null;
  if (!flankOk(s, at, run, true)) return null;
  if (!flankOk(s, at + m[0].length - run, run, false)) return null;
  return { token: { kind: run === 2 ? 'strong' : 'em', text: m[1] }, len: m[0].length };
}

/** 下划线强调(先试 `__` 粗体,再试 `_` 斜体;两者取形一样、只差 run) */
export function matchUnder(s: string, at: number): Hit | null {
  return matchUnderRun(UNDER_STRONG_RE, 2, s, at) ?? matchUnderRun(UNDER_EM_RE, 1, s, at);
}
