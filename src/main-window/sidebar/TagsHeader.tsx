/**
 * 标签分区头部(spec 6.1):标题 + 操作回执(flash,成功绿/失败红)、
 * 树/扁平模式切换、「筛选标签」、收窄搜索(放大镜)。纯展示,状态都在 TagsSection。
 * 分区标题「实体」(spec §5.3 / 计划 Task 3.3):分区里装的是**树内实体**(可含笔记),与设置页
 * 「条目」同一口径;命令名 `list_tags` 与 DTO 保持不动(前端契约稳定)。
 *
 * 五个图标按钮都是纯图标:既有四个的 `aria-label` / `title` 是它们的语义与定位锚点
 * (验收脚本按 `aria-label` 找),一字不改;图标画的是当前模式(与旧文案「树」/「扁平」同义),
 * 动作仍由 aria-label 说明。放大镜按钮开关搜索框,默认收起。
 * 第 5 个是单击行为的模式按钮(2026-10-16 设计 §5.2):循环点击 filter → open,
 * 下一档由纯函数 `nextClickMode` 算(组件不持状态),锚点 `data-testid="click-mode-button"` +
 * `data-click-mode`;两态不是开关,故不设 `aria-pressed`。原第三档 `select` 已按用户要求删除。
 * 「实体树里显示引用」开关(2026-10-07 从设置页就近搬到本区头部)与设置页写同一个键,双向同步;
 * 「筛选标签」图标同期从漏斗换成筛选/条件语义的递减线条,与放大镜(收窄树)一眼区分。
 * 该开关的图标 2026-10-16 再换:原「一节点连出两节点」与顶栏「关系图」的图标同形(用户报重复),
 * 现改为**带孔的标签/实体轮廓**——含义仍是"在实体树里显示关系",但一眼不与关系图混淆。
 *
 * 「筛选标签」不再自带输入框:点击只把请求交给上层(上层去聚焦统一输入框并预填 `#`,
 * 用户接着打字就是标签筛选)。口径与快捷键 Ctrl+P 完全一致,详见计划 Task 4。
 * 放大镜的输入框是另一回事:它只收窄看得见的树,不改筛选条件(不预填 `#`)。
 */
import type { ReactNode } from 'react';
import type { ImeInputHandlers } from '../../shared/use-ime-composition';
import type { TagViewMode } from './use-sidebar-state';
import { CLICK_MODE_LABELS, nextClickMode, type SidebarClickMode } from './click-mode';
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
  /** 实体树里显示引用(与设置页同一个持久化键,双向同步) */
  showRelations: boolean;
  onToggleRelations: () => void;
  /** 单击实体行的行为模式(与设置页「单击实体行的行为」同一份状态);缺省 'filter' = 旧行为 */
  clickMode?: SidebarClickMode;
  /** 点模式按钮:回调参数恒为 `nextClickMode(clickMode)`(下一档由本组件算,状态在上层) */
  onChangeClickMode?: (m: SidebarClickMode) => void;
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
/**
 * 关系开关(与「实体树里显示关系」同义):**带孔的标签/实体轮廓**,轮廓一条到底 + 一个内孔圆,
 * 与顶栏「关系图」的三圆三角(`ViewNav` 的 GRAPH_CIRCLES)一眼可分 —— 同义不同形。
 * 路径由 Lucide `tag`(24 格)等比缩到 16 格:外轮廓一段闭合折线 + 内孔整圆。
 */
const RELATION_PATH =
  'M8.39 1.72A1.33 1.33 0 0 0 7.45 1.33H2.67A1.33 1.33 0 0 0 1.33 2.67v3.44A1.33 1.33 0 0 0 1.72 7.06' +
  'l5.81 5.81a1.62 1.62 0 0 0 2.28 0l4.38-4.38a1.62 1.62 0 0 0 0-2.28zM5.2 3.7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3';

/** 单击行为模式按钮(设计 2026-10-16 §5.2):两套图标 —— 漏斗(筛选)/ 方框+外跳(打开、预览),
 *  外加 title 里那句「单击 = ...」。漏斗与「筛选标签」的递减线条不再撞车(那只已换成线条)。
 *  2026-10-17:打开档的单击改为「只看这一条」,预览卡片在双击(文案与行为同源)。 */
const CLICK_MODE_BUTTON: Record<SidebarClickMode, { d: string; action: string }> = {
  filter: { d: 'M2.5 4h11l-4.2 4.8V13L7 11.4V8.8z', action: '单击 = 加入/移出筛选' },
  open: {
    d: 'M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5M9.5 3.5h3.5V7M13 3.5 7.5 9',
    action: '单击 = 只看这一条,双击 = 预览卡片',
  },
};

/** 图标:(16 格 / 1.5 描边 / 14px 框)与仓内既有侧栏图标同一风格 */
function Icon({ d }: { d: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function TagsHeader(p: TagsHeaderProps): ReactNode {
  // 缺省 'filter' = 旧行为:接线(T4)前 TagsSection 还没传模式,本组件也要能独立渲染
  const mode = p.clickMode ?? 'filter';
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
            title="实体树里显示关系"
            aria-label="实体树里显示关系"
            aria-pressed={p.showRelations}
            onClick={p.onToggleRelations}
            className={BTN_ICON + (p.showRelations ? ' bg-selected text-accent-text' : '')}
          >
            <Icon d={RELATION_PATH} />
          </button>
          <button
            type="button"
            data-testid="click-mode-button"
            data-click-mode={mode}
            aria-label={'点击行为：' + CLICK_MODE_LABELS[mode]}
            title={
              `点击行为：${CLICK_MODE_LABELS[mode]}（${CLICK_MODE_BUTTON[mode].action}）。` +
              `点一下切到「${CLICK_MODE_LABELS[nextClickMode(mode)]}」`
            }
            onClick={() => p.onChangeClickMode?.(nextClickMode(mode))}
            className={BTN_ICON}
          >
            <Icon d={CLICK_MODE_BUTTON[mode].d} />
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
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) p.onCloseSearch();
          }}
          placeholder="按名称收窄标签树"
          aria-label="按名称收窄标签树"
          className="mx-2 mb-1 h-8 shrink-0 rounded-sm border border-border-strong px-2.5 text-ui outline-none"
        />
      )}
    </>
  );
}
