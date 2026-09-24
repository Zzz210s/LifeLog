/**
 * 唯一输入框的前缀解析(设计 2026-09-24 §4)。
 *
 * 规则(与正文里的 #标签 语法共存,这是设计 D7):
 *  - **前缀只在第一个字符生效**;`#`/`>`/`/`/`@` 出现在中间是普通文本;
 *  - 前缀后允许空格(忽略):`/ 牛奶` 与 `/牛奶` 等价;
 *  - 剥掉前缀与紧邻空格后剩下的就是 query(不做 trim,正文可能故意以空格开头)。
 */
export type InputMode = 'note' | 'filter' | 'tag' | 'command' | 'open';

export interface PrefixSpec {
  prefix: string;
  mode: InputMode;
  /** 模式短名(提示行与小字里用) */
  label: string;
  /** 空闲态提示行里那一段的文案 */
  hint: string;
}

export const PREFIXES: readonly PrefixSpec[] = [
  { prefix: '>', mode: 'command', label: '命令', hint: '命令' },
  { prefix: '/', mode: 'filter', label: '筛选', hint: '筛选' },
  { prefix: '#', mode: 'tag', label: '标签筛选', hint: '标签筛选' },
  { prefix: '@', mode: 'open', label: '打开笔记', hint: '打开笔记' },
];

export const NOTE_PREFIX: PrefixSpec = {
  prefix: '',
  mode: 'note',
  label: '记笔记',
  hint: '记点什么…',
};

export interface ParsedInput {
  mode: InputMode;
  query: string;
  prefix: string;
}

export function parseInput(raw: string): ParsedInput {
  for (const spec of PREFIXES) {
    if (raw.startsWith(spec.prefix)) {
      return {
        mode: spec.mode,
        query: stripLeadingSpace(raw.slice(spec.prefix.length)),
        prefix: spec.prefix,
      };
    }
  }
  return { mode: NOTE_PREFIX.mode, query: raw, prefix: '' };
}

/** 切换前缀时保留已输入内容(设计 §4 规则 3):剥掉旧前缀,再带上新前缀 */
export function withPrefix(raw: string, prefix: string): string {
  const { query } = parseInput(raw);
  return prefix + query;
}

function stripLeadingSpace(s: string): string {
  return s.startsWith(' ') ? s.slice(1) : s;
}
