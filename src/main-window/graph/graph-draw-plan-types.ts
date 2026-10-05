/**
 * `drawPlan` 的产物类型(自 `graph-draw-plan.ts` 抽出,守 200 行红线):
 * 只放"一帧要画什么"的形状声明,不含任何计算 —— 计算按层拆在 edges / points / expanded 三个文件里。
 */

/** 一条待描的线段(坐标已是屏幕 CSS 像素) */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
  /**
   * 画粗的一类边:**任一端是当前焦点 `emphasis.active`**(设计 §5「邻居边加粗」)。
   * 与 `dim` 并存:焦点的另一头若是无关节点,这条边仍会 `dim === true`,但画布按
   * `emphasized` 优先 —— 强调边永远满不透明(见 `GraphCanvas.tsx`)。
   */
  emphasized: boolean;
  /** 弱化(有焦点时,与焦点/邻居都无关的边走暗);画布用 globalAlpha 表达,不改颜色 */
  dim: boolean;
}

/** 一个节点圆点:半径随笔记数增长(有上限),颜色由调用方给 */
export interface Dot {
  id: number;
  x: number;
  y: number;
  r: number;
  color: string;
  dim: boolean;
  /** 是否画选中环:跟 `emphasis.selected` 走,不跟焦点走 */
  selected: boolean;
  /** 聚合计数(>1 才画数字,2026-10-04 设计 D1):低缩放时同格合并,记它代表多少个节点 */
  count?: number;
}

/** 一个节点文字:坐标为文字基线中心(点上方),text 是末级段名 */
export interface Label {
  id: number;
  x: number;
  y: number;
  text: string;
}

/** 一条展开笔记的小圆(屏幕坐标)。`id` 是**笔记 id**:L4 的 link 边要靠它认出两端 */
export type NoteDot = { id: number; x: number; y: number };

/**
 * 被略去的笔记条数提示位(屏幕坐标)。
 * `id` 是它所属的标签:它画在标签环外偏下(`noteFan` 的 `OVERFLOW_GAP`),命中它要知道该带哪个标签
 * 回信息流,所以这一位不随坐标换算丢掉身份(见 `use-graph-interactions` 的 `+N` 判据)。
 */
export interface OverflowDot {
  id: number;
  x: number;
  y: number;
  n: number;
}

/**
 * `drawPlan` 的展开层入参(当前展开的标签、其笔记小圆与 `+N` 提示位)。
 * `'screen'` 时坐标**已经是屏幕口径,绘图不再换算**;`'world'` 才过相机。
 */
export interface ExpandedInput {
  id: number;
  space: 'screen' | 'world';
  dots: readonly NoteDot[];
  overflow: { id: number; x: number; y: number; n: number } | null;
}

/** 一帧要画的东西:边按类型分层,点与文字各自成列,另带展开的笔记小圆 */
export interface DrawPlan {
  /**
   * 枢纽节点(设计 D6):`selfCount >= HUB_NOTES` 的点,画布给它们加一圈细环。
   * 与 `dots` 分开给,是因为画布要在"画完所有点"之后、画选中环之前统一描环。
   */
  hubs: readonly Dot[];
  co: Segment[];
  tree: Segment[];
  /** 笔记间的 link 边(accent 色;两端笔记都在展开的扇形里才有一条) */
  links: Segment[];
  dots: Dot[];
  labels: Label[];
  /** 当前展开标签下的笔记小圆;不展开时为空数组 */
  notes: NoteDot[];
  /** 略去的条数提示位;没略去时为 null */
  overflow: OverflowDot | null;
}
