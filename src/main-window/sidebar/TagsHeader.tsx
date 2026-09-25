/**
 * 标签分区头部(spec 6.1):标题 + 操作回执(flash,成功绿/失败红)、
 * 树/扁平模式切换、「筛选标签」按钮。纯展示,状态都在 TagsSection。
 *
 * 两个入口都是纯图标(Task 4):`aria-label` / `title` 是它们的语义与定位锚点(验收脚本按
 * `aria-label` 找),一字不改；图标画的是当前模式(与旧文案「树」/「扁平」同义),
 * 动作仍由 aria-label 说明。
 *
 * 「筛选标签」不再自带输入框:点击只把请求交给上层(上层去聚焦统一输入框并预填 `#`,
 * 用户接着打字就是标签筛选)。口径与快捷键 Ctrl+P 完全一致,详见计划 Task 4。
 */
import type { ReactNode } from 'react';
import type { TagViewMode } from './use-sidebar-state';
import { BTN_ICON } from '../shell/button-classes';

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

/** 树形 = 三条逐级缩进的横线;扁平 = 三条等宽横线(同一视觉重量,一眼能对比) */
const TREE_PATH = 'M2.5 4h11M5.5 8h8M9 12h4.5';
const FLAT_PATH = 'M2.5 4h11M2.5 8h11M2.5 12h11';
/** 漏斗:上宽下窄,与「按 # 过滤标签」同义 */
const FUNNEL_PATH = 'M2.5 3.5h11L9 8.5v4.3l-2-1.4V8.5z';

/** 图标:(16 格 / 1.5 描边 / 14px 框)与仓内既有侧栏图标同一风格 */
function Icon({ d }: { d: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

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
          className={BTN_ICON}
        >
          <Icon d={p.mode === 'tree' ? TREE_PATH : FLAT_PATH} />
        </button>
        <button
          type="button"
          title="筛选标签(在统一输入框里按 # 过滤)"
          aria-label="筛选标签"
          onClick={p.onFilterTags}
          className={BTN_ICON}
        >
          <Icon d={FUNNEL_PATH} />
        </button>
      </span>
    </div>
  );
}
