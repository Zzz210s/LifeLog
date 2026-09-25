/**
 * 侧栏容器(spec 6.1):标签分区;
 * 右缘 4px 热区拖宽(180-420,松手才落库),收起/展开入口只在顶栏(Task 4 删了侧栏内重复的那个)。
 * 时间分区已删除(spec 2026-09-17 D3):时间标签降级为普通标签,就在标签分区里。
 * 「筛选标签」按钮不带输入框(Task 4):点击经 onPrefill 把 `#` 交给统一输入框。
 * 窄窗口保护:内容区 min-w 在 App 侧声明,本栏允许被压缩(不设 shrink-0)。
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import { PREFIXES } from '../../shared/input-prefix';
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
  /** 标签改名/移动/删除成功后:刷新标签树 + 级联改写当前筛选条件 */
  onTagsMutated: (pathChange?: { from: string; to: string }) => void;
  /**
   * 统一输入框的预填通道(与快捷键同一条):聚焦输入框并预填前缀。
   * 「筛选标签」按钮的语义就是 `onPrefill('#')` —— 用户接着打字即标签筛选。
   */
  onPrefill: (prefix: string) => void;
}

/** 「筛选标签」按钮预填的前缀:取自前缀表(唯一真源),不在别处再写一份字面量 */
const TAG_PREFIX = PREFIXES.find((s) => s.mode === 'tag')!.prefix;

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
      <TagsSection
        conditions={p.conditions}
        onPatch={p.onPatch}
        tagRows={p.tagRows}
        mode={p.sidebar.mode}
        onModeChange={p.sidebar.setMode}
        onTagsMutated={p.onTagsMutated}
        onFilterTags={() => p.onPrefill(TAG_PREFIX)}
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
