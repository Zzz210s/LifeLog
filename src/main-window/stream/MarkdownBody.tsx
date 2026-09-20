import type { MouseEvent, ReactNode } from 'react';
import { linkHrefFrom, openExternal } from '../../shared/links';

export interface MarkdownBodyProps {
  /** 必须来自 renderMarkdown/sanitize 的消毒产物 */
  html: string;
  className: string;
  /** 链接打开失败上报(可选):由调用方接入既有错误机制,此处不弹窗、不引入全局状态 */
  onLinkError?: (message: string) => void;
  /** 可交互开关(默认关闭):开启后任务列表复选框可点击并回调 onToggleTask;只读调用方保持默认 */
  interactive?: boolean;
  /** 交互态下点击第 index 个任务复选框(0 起,文档顺序,取自 data-task-index) */
  onToggleTask?: (index: number) => void;
}

/** 事件目标 -> 任务复选框序号;非任务复选框(含未标序号的只读框)返回 null */
function taskIndexFrom(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const raw = target.getAttribute('data-task-index');
  if (raw === null) return null;
  const index = Number.parseInt(raw, 10);
  return Number.isInteger(index) ? index : null;
}

/**
 * markdown 渲染区统一出口:任何链接点击都 preventDefault 后交系统浏览器,
 * 避免 Tauri webview 同窗导航到外站导致应用被锁死(笔记流渲染区统一出口)。
 * 交互态下任务复选框优先处理:它嵌在链接里时也不能顺带打开外链。
 */
export function MarkdownBody({
  html,
  className,
  onLinkError,
  interactive = false,
  onToggleTask,
}: MarkdownBodyProps): ReactNode {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const task = taskIndexFrom(e.target);
    if (task !== null && interactive && onToggleTask) {
      // 取消原生勾选:勾选态以正文为准,等改写的正文回来再重渲(失败时不留假象)
      e.preventDefault();
      onToggleTask(task);
      return;
    }
    const href = linkHrefFrom(e.target);
    if (!href) return;
    e.preventDefault();
    void openExternal(href, onLinkError);
  };
  return (
    <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
