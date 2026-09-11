import type { MouseEvent, ReactNode } from 'react';
import { linkHrefFrom, openExternal } from '../shared/links';

export interface MarkdownBodyProps {
  /** 必须来自 renderMarkdown/sanitize 的消毒产物 */
  html: string;
  className: string;
  /** 链接打开失败上报(可选):由调用方接入既有错误机制,此处不弹窗、不引入全局状态 */
  onLinkError?: (message: string) => void;
}

/**
 * markdown 渲染区统一出口:任何链接点击都 preventDefault 后交系统浏览器,
 * 避免 Tauri webview 同窗导航到外站导致应用被锁死(流内与编辑预览共用)。
 */
export function MarkdownBody({ html, className, onLinkError }: MarkdownBodyProps): ReactNode {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const href = linkHrefFrom(e.target);
    if (!href) return;
    e.preventDefault();
    void openExternal(href, onLinkError);
  };
  return (
    <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
