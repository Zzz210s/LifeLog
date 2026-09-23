/**
 * 标签分区头部(spec 6.1):标题 + 操作回执(flash,成功绿/失败红)、
 * 树/扁平模式切换、过滤开关与过滤输入框。纯展示,状态都在 TagsSection。
 */
import type { ReactNode } from 'react';
import type { TagViewMode } from './use-sidebar-state';
import { BTN_TEXT } from '../shell/button-classes';

/** 操作回执:成功(绿)或失败(红,拖拽预校验/后端拒绝) */
export interface TagFlash {
  text: string;
  tone: 'ok' | 'error';
}

export interface TagsHeaderProps {
  flash: TagFlash | null;
  mode: TagViewMode;
  onModeChange: (m: TagViewMode) => void;
  filterOpen: boolean;
  onToggleFilter: () => void;
  query: string;
  onQueryChange: (v: string) => void;
}

const HEADER_BTN =
  BTN_TEXT + ' text-muted hover:text-text';

export function TagsHeader(p: TagsHeaderProps): ReactNode {
  return (
    <>
      <div className="group flex h-8 shrink-0 items-center gap-1 px-2">
        <h2 className="text-label font-semibold uppercase tracking-wide text-muted">标签</h2>
        {p.flash && (
          <span
            data-testid="tag-flash"
            className={'truncate text-label ' + (p.flash.tone === 'error' ? 'text-danger' : 'text-success')}
          >
            {p.flash.text}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title={p.mode === 'tree' ? '切换为扁平列表' : '切换为树形'}
            aria-label={p.mode === 'tree' ? '切换为扁平列表' : '切换为树形'}
            onClick={() => p.onModeChange(p.mode === 'tree' ? 'flat' : 'tree')}
            className={HEADER_BTN}
          >
            {p.mode === 'tree' ? '树' : '扁平'}
          </button>
          <button
            type="button"
            title="过滤标签"
            aria-label="过滤标签"
            onClick={p.onToggleFilter}
            className={HEADER_BTN + (p.filterOpen ? ' bg-selected text-accent-text' : '')}
          >
            过滤
          </button>
        </span>
      </div>
      {p.filterOpen && (
        <input
          autoFocus
          value={p.query}
          onChange={(e) => p.onQueryChange(e.target.value)}
          placeholder="输入关键词过滤标签"
          aria-label="过滤标签"
          className="mx-2 mb-1 h-8 shrink-0 rounded-sm border border-border-strong px-2.5 text-ui outline-none"
        />
      )}
    </>
  );
}
