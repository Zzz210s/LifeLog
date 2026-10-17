/**
 * 单击接线夹具的**形状与数据**(仅测试):`ClickFlow` / `ClickFlowProbe` 两个接口 + 侧栏行数据。
 * 与 `click-flow-harness.tsx`(挂载与事件合成)分开,只为两边各自守住 200 行红线;
 * 消费侧仍从 `click-flow-harness` 导入(那边原样再出口)。
 * 2026-10-16 两档化:`cursorBar` 只留作反向断言(select 删除后它必须恒为 null)。
 * 2026-10-17:预览卡片退到双击 —— `dblclickRow` 只派发 `dblclick`,真序列是 `doubleClickRow`。
 */
import type { FilterConditions } from '../../../shared/filter-conditions';
import type { TagCount } from '../../../shared/types';
import type { MainView } from '../../settings/settings-model';

/** 侧栏行:可选叶子 / 有子级的容器(计数 0) / 无子级的空实体(计数 0)各一,覆盖三种行 */
export const ROWS: TagCount[] = [
  { id: 1, path: '书籍', depth: 1, sort_order: 0, self_count: 1, subtree_count: 3 },
  { id: 2, path: '书籍/SQL', depth: 2, sort_order: 0, self_count: 1, subtree_count: 2 },
  { id: 3, path: '书籍/SQL/索引', depth: 3, sort_order: 0, self_count: 1, subtree_count: 1 },
  { id: 4, path: '容器', depth: 1, sort_order: 1, self_count: 0, subtree_count: 0 },
  { id: 5, path: '容器/空', depth: 2, sort_order: 0, self_count: 0, subtree_count: 0 },
  { id: 6, path: '空实体', depth: 1, sort_order: 2, self_count: 0, subtree_count: 0 },
];

export interface ClickFlowProbe {
  /** 每次条件变化后的条件原文(filterKey):第 0 条 = 挂载时的空条件,长度即写库次数 */
  writes: string[];
  conditions: FilterConditions;
  view: MainView;
}

export interface ClickFlow {
  host: HTMLDivElement;
  probe: ClickFlowProbe;
  /** 换一份 tagRows(标签被删 / 改名后引用它的状态该失效) */
  setRows: (rows: TagCount[]) => void;
  /** 切视图(设置页 / 关系图):光标与卡片**不清**(设计 R5) */
  setView: (view: MainView) => void;
  row: (path: string) => HTMLElement | null;
  clickRow: (path: string, mods?: MouseEventInit) => void;
  /** 双击:只派发 `dblclick`(卡片是否打开看它,不叠加两次 click) */
  dblclickRow: (path: string) => void;
  /** 真浏览器的双击序列:click + click + dblclick(读两次单击的净效果) */
  doubleClickRow: (path: string) => void;
  blankClick: () => void;
  /** 合成拖拽起手(手法与 __fixtures__/drag-harness 一致:普通 Event + 替身 dataTransfer) */
  dragRow: (path: string) => void;
  clickHeader: () => void;
  clickSettings: (label: string) => void;
  press: (label: string) => void;
  mode: () => string | null;
  /** 反向断言用:select 删除后底部光标条不该存在(恒 null) */
  cursorBar: () => HTMLElement | null;
  card: () => HTMLElement | null;
  cards: () => HTMLElement[];
  flash: () => string | null;
  esc: () => void;
  /** 浮层先吃 Esc(useDismiss 的手法:捕获阶段 stopPropagation) */
  escWithOverlay: () => void;
  unmount: () => void;
}
