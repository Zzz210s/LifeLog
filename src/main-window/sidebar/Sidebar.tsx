/**
 * 侧栏容器(spec 6.1):标签分区(视图分区已随视图模块删除,S6——标签页在顶栏下方),
 * 右缘 4px 热区拖宽(180-420,松手才落库),顶部「隐藏」按钮整栏收起(顶栏提供「显示侧栏」入口)。
 * 时间分区已删除(spec 2026-09-17 D3):时间标签降级为普通标签,就在标签分区里。
 * 窄窗口保护:内容区 min-w 在 App 侧声明,本栏允许被压缩(不设 shrink-0)。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import { TagsSection } from './TagsSection';
import { clampSidebarWidth } from './use-sidebar-state';
import type { SidebarStateApi } from './use-sidebar-state';

export interface SidebarProps {
  sidebar: SidebarStateApi;
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 全量标签行(list_tags,含 id) */
  tagRows: TagCount[];
  /** 标签改名/移动/删除成功后:刷新标签树 + 级联改写当前标签页条件 */
  onTagsMutated: (pathChange?: { from: string; to: string }) => void;
}

/** 拖宽热区:右缘 4px(w-1),光标与悬停高亮提示可拖 */
export function Sidebar(p: SidebarProps): ReactNode {
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = p.sidebar.width;
    const onMove = (ev: MouseEvent) => {
      setDragWidth(clampSidebarWidth(startWidth + ev.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // 松手才提交(拖拽中只改本地态,避免逐帧写库)
      setDragWidth((w) => {
        if (w !== null) p.sidebar.setWidth(w);
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!p.sidebar.visible) return null;
  const width = dragWidth ?? p.sidebar.width;

  return (
    <aside
      data-testid="sidebar"
      aria-label="侧栏"
      className="relative flex h-full flex-col border-r border-border bg-panel"
      style={{ width }}
    >
      <div className="flex h-8 shrink-0 items-center justify-end px-1">
        <button
          type="button"
          title="隐藏侧栏(顶栏可重新显示)"
          aria-label="隐藏侧栏"
          onClick={() => p.sidebar.setVisible(false)}
          className="rounded p-1 text-faint hover:bg-text/10 hover:text-muted"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
            <path d="M10 4l-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      <TagsSection
        conditions={p.conditions}
        onPatch={p.onPatch}
        tagRows={p.tagRows}
        mode={p.sidebar.mode}
        onModeChange={p.sidebar.setMode}
        onTagsMutated={p.onTagsMutated}
      />
      {/* 右缘拖宽热区:悬停高亮,拖动中抑制选中文本 */}
      <div
        onMouseDown={startDrag}
        title="拖动调整侧栏宽度"
        aria-label="调整侧栏宽度"
        className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-accent/60"
      />
    </aside>
  );
}
