/**
 * 标签分区头部(spec 6.1):标题 + 操作回执(flash,成功绿/失败红)、
 * 树/扁平模式切换、「筛选标签」、收窄搜索(放大镜)。纯展示,状态都在 TagsSection。
 *
 * 四个图标按钮都是纯图标:既有两个的 `aria-label` / `title` 是它们的语义与定位锚点
 * (验收脚本按 `aria-label` 找),一字不改;图标画的是当前模式(与旧文案「树」/「扁平」同义),
 * 动作仍由 aria-label 说明。放大镜按钮开关搜索框,默认收起。
 * 「标签树里显示关系」开关(2026-10-07 从设置页就近搬到本区头部)与设置页写同一个键,双向同步;
 * 「筛选标签」图标同期从漏斗换成筛选/条件语义的递减线条,与放大镜(收窄树)一眼区分。
 *
 * 「筛选标签」不再自带输入框:点击只把请求交给上层(上层去聚焦统一输入框并预填 `#`,
 * 用户接着打字就是标签筛选)。口径与快捷键 Ctrl+P 完全一致,详见计划 Task 4。
 * 放大镜的输入框是另一回事:它只收窄看得见的树,不改筛选条件(不预填 `#`)。
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
  /** 标签树里显示关系(与设置页同一个持久化键,双向同步) */
  showRelations: boolean;
  onToggleRelations: () => void;
  /** 搜索框是否展开(默认收起,点击放大镜切换) */
  searchOpen: boolean;
  /** 收窄关键词(空串 = 全树) */
  query: string;
  onQueryChange: (v: string) => void;
  /** 放大镜:开/关搜索框 */
  onToggleSearch: () => void;
  /** Esc:清空关键词并收起 */
  onCloseSearch: () => void;
}

/** 树形 = 三条逐级缩进的横线;扁平 = 三条等宽横线(同一视觉重量,一眼能对比) */
const TREE_PATH = 'M2.5 4h11M5.5 8h8M9 12h4.5';
const FLAT_PATH = 'M2.5 4h11M2.5 8h11M2.5 12h11';
/** 筛选/条件语义(2026-10-07 换下漏斗):居中递减三条线,与左对齐缩进的「树形」一眼区分 */
const FILTER_PATH = 'M3 4h10M5 8h6M7 12h2';
/** 放大镜:圆 + 45° 手柄,与「收窄标签树」同义 */
const SEARCH_PATH = 'M13 13 9.7 9.7M2.5 7a4.5 4.5 0 1 0 9 0 4.5 4.5 0 1 0-9 0';
/** 关系:一个节点连出两个节点(与「显示关系」同义) */
const RELATION_PATH =
  'M8 4.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6M4.7 12.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6M11.3 12.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6M7.2 7.4 5.4 10.6M8.8 7.4l1.8 3.2M6.5 14h3';

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
            title="搜索标签"
            aria-label="搜索标签"
            aria-expanded={p.searchOpen}
            onClick={p.onToggleSearch}
            className={BTN_ICON + (p.searchOpen ? ' bg-selected text-accent-text' : '')}
          >
            <Icon d={SEARCH_PATH} />
          </button>
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
            title="标签树里显示关系"
            aria-label="标签树里显示关系"
            aria-pressed={p.showRelations}
            onClick={p.onToggleRelations}
            className={BTN_ICON + (p.showRelations ? ' bg-selected text-accent-text' : '')}
          >
            <Icon d={RELATION_PATH} />
          </button>
          <button
            type="button"
            title="筛选标签(在统一输入框里按 # 过滤)"
            aria-label="筛选标签"
            onClick={p.onFilterTags}
            className={BTN_ICON}
          >
            <Icon d={FILTER_PATH} />
          </button>
        </span>
      </div>
      {p.searchOpen && (
        <input
          autoFocus
          value={p.query}
          onChange={(e) => p.onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') p.onCloseSearch();
          }}
          placeholder="按名称收窄标签树"
          aria-label="按名称收窄标签树"
          className="mx-2 mb-1 h-8 shrink-0 rounded-sm border border-border-strong px-2.5 text-ui outline-none"
        />
      )}
    </>
  );
}
