/**
 * 标签分区头部(spec 6.1):标题 + 操作回执(flash,成功绿/失败红)、
 * 树/扁平模式切换、「筛选标签」、收窄搜索(放大镜)。纯展示,状态都在 TagsSection。
 * 分区标题「实体」(spec §5.3 / 计划 Task 3.3):分区里装的是**树内实体**(可含笔记),与设置页
 * 「条目」同一口径;命令名 `list_tags` 与 DTO 保持不动(前端契约稳定)。
 *
 * 三个图标按钮都是纯图标:它们的 `aria-label` / `title` 是语义与定位锚点
 * (验收脚本按 `aria-label` 找),一字不改;图标画的是当前模式(与旧文案「树」/「扁平」同义),
 * 动作仍由 aria-label 说明。放大镜按钮开关搜索框,默认收起。
 * 2026-10-17 用户要求去掉同一状态的两条入口:「实体树里显示关系」与「点击行为」两颗图标已删,
 * 只留设置 > 实体关系那两行(`tag_tree_show_relations` / `sidebar_click_mode` 的键不变)。
 *
 * 「筛选标签」不再自带输入框:点击只把请求交给上层(上层去聚焦统一输入框并预填 `#`,
 * 用户接着打字就是标签筛选)。口径与快捷键 Ctrl+P 完全一致,详见计划 Task 4。
 * 放大镜的输入框是另一回事:它只收窄看得见的树,不改筛选条件(不预填 `#`)。
 */
import type { ReactNode } from 'react';
import type { ImeInputHandlers } from '../../shared/use-ime-composition';
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
  /** 搜索框是否展开(默认收起,点击放大镜切换) */
  searchOpen: boolean;
  /** 收窄关键词(显示值;空串 = 全树) */
  query: string;
  /** 输入框的组合守卫接线(值/组合标志一起维护) */
  ime: ImeInputHandlers;
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
        <h2 className="text-label font-semibold uppercase tracking-wide text-muted">实体</h2>
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
          onChange={(e) => p.ime.onChange(e.currentTarget.value, e.nativeEvent)}
          onCompositionEnd={(e) => p.ime.onCompositionEnd(e.currentTarget.value)}
          onKeyDown={(e) => {
            // 组合中不抢 Esc(那一下是取消候选),否则会把收窄搜索连关键词一起关掉
            if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
            // 这一下归搜索框:清关键词 + 收起。必须拦在这里,否则窗口级 Esc(预览卡片,
            // `use-tag-click`)会同一按也关掉卡片 —— 同一个键两种预期同时成立(盘点 2026-10-17 §5)
            e.preventDefault();
            e.stopPropagation();
            p.onCloseSearch();
          }}
          placeholder="按名称收窄标签树"
          aria-label="按名称收窄标签树"
          className="mx-2 mb-1 h-8 shrink-0 rounded-sm border border-border-strong px-2.5 text-ui outline-none"
        />
      )}
    </>
  );
}
