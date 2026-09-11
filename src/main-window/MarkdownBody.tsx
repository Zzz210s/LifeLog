import type { MouseEvent, ReactNode } from 'react';
import { linkHrefFrom, openExternal } from '../shared/links';

export interface MarkdownBodyProps {
  /** 必须来自 renderMarkdown/sanitize 的消毒产物 */
  html: string;
  className: string;
}

/**
 * markdown 渲染区统一出口:任何链接点击都 preventDefault 后交系统浏览器,
 * 避免 Tauri webview 同窗导航到外站导致应用被锁死(流内与编辑预览共用)。
 */
export function MarkdownBody({ html, className }: MarkdownBodyProps): ReactNode {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const href = linkHrefFrom(e.target);
    if (!href) return;
    e.preventDefault();
    void openExternal(href);
  };
  return (
    <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
