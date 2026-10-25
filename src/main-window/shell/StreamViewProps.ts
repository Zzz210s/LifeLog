/**
 * `StreamView` 的 props 合同(自 StreamView.tsx 抽出以守 200 行红线)。
 * 纯搬移:字段名、可选性、注释口径一字未改;三处「不传即关档」语义照旧
 * (`dataVersion` 默认 0、`batchModes` 不传 = 两态都关)。
 */
import type { RefObject } from 'react';
import type { Note } from '../../shared/types';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { RowDecoration } from '../palette/PaletteRow';
import type { PaletteController } from '../palette/use-palette';
import type { UnifiedController } from '../unified/use-unified-input';
import type { GroupedView } from '../data/use-stream-feed';
import type { BatchModes } from '../filter/use-batch-modes';
import type { TagPreviewCardProps } from './TagPreviewCard';
import type { ErrorKind } from './ErrorBar';
import type { ErrorMap } from './errors';

export interface StreamViewProps {
  visible: boolean;
  conditions: FilterConditions;
  notes: Note[];
  editingId: number | null;
  hasMore: boolean;
  loading: boolean;
  queryFailed: boolean;
  /** 分组渲染接线(非空 = 分组模式;degraded 时恒 null,平铺兜底) */
  grouping: GroupedView | null;
  /** 顶部提示(degraded / slow 文案) */
  notice: string | null;
  /** open 模式的预览卡片数据(设计 §5.4;null = 没打开任何实体,不渲染) */
  preview: TagPreviewCardProps | null;
  filterEmpty: boolean;
  errors: ErrorMap;
  onPatch: (value: Partial<FilterConditions>) => void;
  onToggleTag: (path: string) => void;
  onRetry: () => void;
  onDismissError: (kind: ErrorKind) => void;
  onClearFilters: () => void;
  onShowInput: () => void;
  onLoadMore: () => void;
  onEdit: (note: Note) => void;
  onSwitchEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onEditSaved: (note: Note) => void;
  onEditCancel: () => void;
  onToggleTask: (note: Note, index: number) => void;
  onLinkError: (message: string) => void;
  /** 候选控制器:统一输入框的候选/高亮状态与它共用(采纳副作用见 acceptAt) */
  palette: PaletteController;
  /** 候选行装饰(命令快捷键/标签计数/笔记日期) */
  decorations: Readonly<Record<string, RowDecoration>>;
  /** 统一输入框保存成功后刷新(回第一页 + 重读标签) */
  onSaved: () => void;
  /** `>` 采纳后执行既有命令(use-app-commands 的 execute:先 flush 编辑态,失败落错误条) */
  onRunCommand: (id: string) => void;
  /** 「添加条件」命令/顶栏菜单上抛的开关(命令消费后由 App 复位) */
  addConditionOpen: boolean;
  onAddConditionOpenChange: (open: boolean) => void;
  /** 统一输入框控制器上抛口(快捷键要 `prefill`):App 持有的 ref,这里只写不读 */
  unifiedRef: RefObject<UnifiedController | null>;
  /** 标签数据版本(`[[` 补全候选池的作废键) */
  dataVersion?: number;
  /** 快捷搜索栏(统一输入框)的单行行高,来自设置 `ui.search_row_height`;不传 = 默认 36 */
  searchRowHeight?: number;
  /** 批量编辑的两态(§10.3 / §A):条目批量 + 条件批量,两者互斥(接线在 `use-batch-modes`);
   *  不传 = 两态都关档(测试夹具与只读用法)。 */
  batchModes?: BatchModes;
}
