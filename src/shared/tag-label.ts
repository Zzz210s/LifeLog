/**
 * 标签名行内 markdown 的**显示口径**:token 序列 -> React 节点。
 *
 * 解析(语法范围、退化规则、与正文的差异)全在 `tag-label-plain.ts`,这里只负责渲染,
 * 并把解析口径**再导出**,调用方继续从 `shared/tag-label` 取全部三样,不必知道有拆分。
 *
 * 硬约束:**链接渲染为纯文本 span + title,绝不渲染成 `<a>`** ——
 * 标签不是链接,渲染成蓝色可点链接会误导;且全仓只在笔记正文处允许 innerHTML。
 */
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { parseTagLabel } from './tag-label-plain';
import type { TagLabelToken } from './tag-label-plain';

export { parseTagLabel, tagLabelPlain } from './tag-label-plain';
export type { TagLabelToken } from './tag-label-plain';

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
    case 'del':
      // 与正文一致:markdown-it 的 s_open/s_close 也渲染成 <del>(见 shared/markdown.ts)
      return createElement('del', { key }, t.text);
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
