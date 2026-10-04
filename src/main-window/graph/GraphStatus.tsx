/**
 * 关系图的状态文字(计数 / 加载失败 / 展开笔记的进度)。
 *
 * 纯展示:文案由 `GraphView` 合成(展开状态优先占位);G3 起它是 `GraphToolbar` 里的一行,
 * 定位交给工具栏(自己不再 absolute),这样"计数 + 过滤器 + 重置视图"能排在同一行。
 */
import type { ReactNode } from 'react';

export function GraphStatus(p: { text: string }): ReactNode {
  return (
    <div
      role="status"
      data-testid="graph-status"
      className="pointer-events-none flex h-8 items-center rounded-sm border border-border bg-raised px-2 text-label text-muted"
    >
      {p.text}
    </div>
  );
}
