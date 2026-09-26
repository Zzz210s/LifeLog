/**
 * 标签名的行内 markdown(T1,spec 2026-09-26 标签 md 渲染):
 *
 * 标签名里用 md 链接语法承载备注 —— `[郴](chēn)州市` 显示为「郴州市」,
 * 鼠标悬浮在「郴」上显示「chēn」。两种口径**同源**于一个 tokenizer,不许各写一份:
 * - `tagLabelPlain`:去掉语法后的可见文本(给 title / 条件摘要 / `#` 补全 / 导出 / 确认文案);
 * - `renderTagLabel`:可见文本 -> **React 节点**(给树行、chip 等显示位)。
 *
 * 硬约束:**链接渲染为纯文本 span + title,绝不渲染成 `<a>`** ——
 * 标签不是链接,渲染成蓝色可点链接会误导;且全仓只在笔记正文处允许 innerHTML。
 *
 * 语法范围刻意收得很窄(标签名不是文档):链接、粗体、斜体、行内代码四种。
 * 非法 / 未闭合 / 嵌套一律**逐字退化**(不猜后半段、不递归内层),这比"聪明的半解析"可预测。
 */
import { createElement } from 'react';
import type { ReactNode } from 'react';

export type TagLabelToken =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; title: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string };

/** sticky 正则:从给定下标起匹配,失败即 null(不向后搜索,保证"就地解析") */
const LINK_RE = /\[([^[\]]+)\]\(([^()]*)\)/y;
const STRONG_RE = /\*\*([^*]+)\*\*/y;
const EM_RE = /\*([^*]+)\*/y;
const CODE_RE = /`([^`]+)`/y;

function matchAt(re: RegExp, s: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(s);
}

/** 取从 at 起连续的同一字符(用于把失败的 `*` / `` ` `` 整串当字面量吞掉) */
function runOf(s: string, at: number): string {
  const c = s[at];
  let end = at;
  while (end < s.length && s[end] === c) end++;
  return s.slice(at, end);
}

/**
 * 行内 token 序列(唯一解析入口)。
 * 逐字符左到右扫描,只在当前位置尝试四种语法;失败就把该字符(或整串 `*` / `` ` ``)并进文本。
 */
export function parseTagLabel(raw: string): TagLabelToken[] {
  const tokens: TagLabelToken[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf !== '') {
      tokens.push({ kind: 'text', text: buf });
      buf = '';
    }
  };
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
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
      const run = runOf(raw, i);
      buf += run;
      i += run.length;
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
      const run = runOf(raw, i);
      buf += run;
      i += run.length;
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

/** 行内代码的等宽样式(与正文 .md-body code 同口径:chrome-tag 底 + 4px 圆角 + 等宽) */
const CODE_CLASS = 'rounded-xs bg-tag px-0.5 font-mono';

function tokenNode(t: TagLabelToken, key: number): ReactNode {
  switch (t.kind) {
    case 'text':
      return t.text;
    case 'strong':
      return createElement('strong', { key }, t.text);
    case 'em':
      return createElement('em', { key }, t.text);
    case 'code':
      return createElement('code', { key, className: CODE_CLASS }, t.text);
    case 'link':
      // 纯文本 + title:永不渲染成 <a>(标签不该看起来像可点链接)
      return createElement('span', t.title === '' ? { key } : { key, title: t.title }, t.text);
  }
}

/** 行内 md -> React 节点(纯文本原样返回字符串,不套多余元素) */
export function renderTagLabel(raw: string): ReactNode {
  const tokens = parseTagLabel(raw);
  if (tokens.length === 1 && tokens[0].kind === 'text') return tokens[0].text;
  return tokens.map(tokenNode);
}
