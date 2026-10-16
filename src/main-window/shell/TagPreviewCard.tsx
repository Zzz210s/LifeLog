/**
 * 信息流首部的「预览中」实体卡片(设计 2026-10-16 §5.4):只放路径 + 两个计数 + 两个入口。
 * 卡片不拉笔记列表、零新 IPC —— 要看内容就点「只看这条」,信息流本身就是预览;
 * 也不参与 `notes` / 分组 / 空态的任何判断(不进 `notes` 数组)。
 * 不抢焦点(不 autoFocus):键盘用户走 Esc(挂在流视图的 window 监听)或 Tab 到「关闭」。
 * 容器行(`subtreeCount === 0`)不打开,由上层决定是否渲染本组件。
 */
import type { ReactNode } from 'react';
import { renderTagLabel } from '../../shared/tag-label';
import { hoverTitle } from '../../shared/truncate-title';
import { BTN_TEXT } from './button-classes';

export interface TagPreviewCardProps {
  /** 被打开的实体路径(纯文本,显示位走行内 md 预览态) */
  path: string;
  /** 本级条数 */
  selfCount: number;
  /** 含子级条数 */
  subtreeCount: number;
  /** 「只看这条」:等价 Shift+单击(上层筛到流并关卡片) */
  onOnlyThis: () => void;
  /** 「关闭」:等价 Esc(上层清 previewPath) */
  onClose: () => void;
}

export function TagPreviewCard({ path, selfCount, subtreeCount, onOnlyThis, onClose }: TagPreviewCardProps): ReactNode {
  return (
    <section
      id="tag-preview-card"
      data-testid="tag-preview-card"
      aria-label={'实体预览：' + path}
      className="mx-4 my-1 shrink-0 rounded-sm border border-border bg-hover px-3 py-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-label text-muted">预览中</span>
        <span className="min-w-0 flex-1 truncate text-ui text-text" onMouseEnter={hoverTitle(path)}>
          {renderTagLabel(path)}
        </span>
        <span className="shrink-0 text-label text-muted">
          本级 {selfCount} 条 / 含子级 {subtreeCount} 条
        </span>
        <button type="button" aria-label="只看这条" className={BTN_TEXT + ' text-accent-text'} onClick={onOnlyThis}>
          只看这条
        </button>
        <button type="button" aria-label="关闭" className={BTN_TEXT} onClick={onClose}>
          关闭
        </button>
      </div>
    </section>
  );
}
