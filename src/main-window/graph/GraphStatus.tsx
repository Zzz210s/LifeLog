/**
 * 关系图左上角的状态行(G2):计数 / 加载失败 / 展开笔记的进度。
 *
 * 纯展示:`pointer-events-none` 让它不吃指针(压在画布上也不挡命中);文案由 `GraphView` 合成
 * (展开状态优先占位)。自 `GraphView` 抽出以守 200 行红线。
 */
import type { ReactNode } from 'react';

export function GraphStatus(p: { text: string }): ReactNode {
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-border bg-raised px-2 py-1 text-xs text-muted"
    >
      {p.text}
    </div>
  );
}
