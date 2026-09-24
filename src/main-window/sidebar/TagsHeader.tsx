/**
 * 标签分区头部(spec 6.1):标题 + 操作回执(flash,成功绿/失败红)、
 * 树/扁平模式切换、「筛选标签」按钮。纯展示,状态都在 TagsSection。
 *
 * 「筛选标签」不再自带输入框:点击只把请求交给上层(上层去聚焦统一输入框并预填 `#`,
 * 用户接着打字就是标签筛选)。口径与快捷键 Ctrl+P 完全一致,详见计划 Task 4。
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
  /** 点「筛选标签」:聚焦统一输入框并预填 `#`(实现与快捷键同一条通道) */
  onFilterTags: () => void;
}

const HEADER_BTN =
  BTN_TEXT + ' text-muted hover:text-text';

export function TagsHeader(p: TagsHeaderProps): ReactNode {
  return (
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
          title="筛选标签(在统一输入框里按 # 过滤)"
          aria-label="筛选标签"
          onClick={p.onFilterTags}
          className={HEADER_BTN}
        >
          筛选标签
        </button>
      </span>
    </div>
  );
}
