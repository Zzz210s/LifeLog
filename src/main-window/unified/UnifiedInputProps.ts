/**
 * 统一输入框的 props 合同(自 UnifiedInput.tsx 抽出以守 200 行红线)。
 * 纯搬移:字段名、可选性、注释一字未改。
 */
import type { InputMode } from '../../shared/input-prefix';
import type { UnifiedCandidateWiring } from './use-unified-candidates';
import type { UnifiedController } from './use-unified-input';
import type { UnifiedPanelOptions } from './use-unified-panel';

export interface UnifiedInputProps {
  /** 保存成功后回调(父组件刷新:回第一页 + 重读标签) */
  onSaved: () => void;
  /** 正在编辑某个条目时该框只读(与今天 Composer 一致) */
  editing: boolean;
  /** 候选接线(控制器 + 装饰);不给 = 没有前缀候选下拉 */
  candidates?: UnifiedCandidateWiring | null;
  /** 采纳回调(索引):前缀模式的副作用在容器接 */
  onAccept?: (index: number) => void;
  /** 模式/统计文案(父组件按需给,用于提示行) */
  stat?: string;
  /** 控制器上抛:父组件(快捷键、验收脚本)需要 setRaw/prefill */
  onController?: (c: UnifiedController) => void;
  /** 正在写内容时的模式变化上报(父组件据此驱动筛选/候选/采纳决策) */
  onStateChange?: (s: { mode: InputMode; query: string; prefix: string }) => void;
  /** 笔记数据版本(`[[` 补全候选池的作废键) */
  dataVersion?: number;
  /** 正在编辑的那个条目 id(`[[` 候选里排除它自己) */
  excludeNoteId?: number;
  /** 笔记 MRU(`[[` 候选的空查询排序与采纳记账;与主窗共用一份实例) */
  noteMru?: UnifiedPanelOptions['noteMru'];
  /** 单行行高(设置项 `ui.search_row_height`;不传 = 默认 36) */
  rowHeight?: number;
}
