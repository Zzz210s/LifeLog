/**
 * 相机对外契约与共享常量(自 `use-graph-camera.ts` 抽出,守 200 行红线):
 * 视图侧只认这里的 `GraphCameraApi`,指针事件只认 `PointerAt`。
 * 常量放在这里,是因为「记忆层」与「输入层」都要读,不能挂在任一侧。
 */
import type { Camera } from './graph-camera';
import type { Positions } from './graph-positions';
import type { Point } from './radial';

export const GRAPH_POSITIONS_KEY = 'graph_positions';
/** 每格滚轮的缩放倍率(相机用例与视图接线用例共读这一份,别在测试里抄第二份) */
export const ZOOM_STEP = 1.15;

/** 拖拽只需要这几个字段:原生 PointerEvent 与 React 合成事件都满足 */
export interface PointerAt {
  clientX: number;
  clientY: number;
  /** 按键(0 主键 / 2 右键);合成事件与旧调用可省 —— 省了就按主键处理 */
  button?: number;
}

export interface GraphCameraApi {
  camera: Camera;
  /** 叠加过记忆位置的落点(布局结果 + graph_positions):绘制与适配都用它 */
  points: Map<number, Point>;
  /** 库里有位置记忆的标签(= 被拖过的节点):「整理布局」拿它当锚点,不移动这些点 */
  pinned: ReadonlySet<number>;
  reset: () => void;
  /** 把某个世界点在**不改缩放**的前提下摆到画布中心(G2 的图内搜索跳转用) */
  centerOn: (p: Point) => void;
  /**
   * 以**指定屏幕点**为锚点缩放(2026-10-04):聚合圆放大需要"放大到那个圆",
   * 而 `zoomBy` 锚在画布中心、合成 WheelEvent 的坐标又是 0(左上角)。
   */
  zoomAtScreen: (p: Point, factor: number) => void;
  onWheel: (e: WheelEvent) => void;
  onPointerDown: (e: PointerAt) => void;
  onPointerMove: (e: PointerAt) => void;
  onPointerUp: () => void;
  /** 位置记忆写回(只由拖节点调用):本地立刻生效,再按现存标签修剪后落库 */
  commitPositions: (moved: Positions) => void;
}
