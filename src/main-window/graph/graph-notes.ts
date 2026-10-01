/**
 * 展开笔记的小圆:几何口径(半径)与扇形布局(纯函数)。
 * 坐标口径由调用方**显式**给出(`space`):`center`、`radius`、`dots` 同处一个量纲。
 * 笔记小圆一律用 `'screen'` —— 半径是屏幕像素、落点先换算到屏幕,这样它和标签点一样
 * 不随相机缩放(G3 把这条定死:`k=0.2` 时整圈小圆不会再缩进标签点里,`k=4` 也不脱节)。
 * 上限存在的理由:一个标签可能挂上千条笔记,全画出来会糊满整屏;略去的条数用 `+N` 交代,
 * `+N` 摆在环外偏下(不与标签点同心):同心时它的命中圈会盖住小标签点的点击区。
 */
import type { Point } from './radial';

export const NOTE_LIMIT = 20;

/** `noteFan` 的坐标口径:`'screen'` = CSS 屏幕像素;`'world'` = 世界坐标(交给相机换算) */
export type NoteSpace = 'screen' | 'world';

/**
 * 小圆半径(屏幕像素):与标签点一样不随相机缩放,所以「画多大就点多大的地方」
 * 这条命中口径要靠同一个常量 —— 画布的绘制与 `use-expanded-notes` 的命中都读它。
 */
export const NOTE_R = 3;

/**
 * `+N` 提示位离环的距离(与入参同量纲):提示位摆在**环外偏下**,不再与标签点同心。
 * 摆在圆心时它的命中圈(10px)会整块盖住小标签点的点击区(笔记数 ≲150,触及半径 < 10)
 * —— 展开后点圆心只会回信息流,想选中标签得先收起展开(2026-10-01 遗留,本次修掉)。
 */
export const OVERFLOW_GAP = 12;

export interface NoteFan {
  /** 这份扇形所处的量纲(原样回传:调用方据此决定要不要过相机换算) */
  space: NoteSpace;
  dots: Point[];
  /** 没画出来的那部分提示位(`n` 是略去的条数;位置在圆心正下方 `radius + OVERFLOW_GAP` 处);全都画出来时为 null */
  overflow: { x: number; y: number; n: number } | null;
}

export function noteFan(input: {
  center: Point;
  count: number;
  radius: number;
  limit?: number;
  space: NoteSpace;
}): NoteFan {
  const limit = input.limit ?? NOTE_LIMIT;
  const shown = Math.min(Math.max(input.count, 0), limit);
  const dots: Point[] = [];
  for (let i = 0; i < shown; i++) {
    // 从正上方(-π/2)起顺时针:第一个小圆固定落在节点上方,截图对比才有稳定锚点
    const angle = (Math.PI * 2 * i) / shown - Math.PI / 2;
    dots.push({
      x: input.center.x + Math.cos(angle) * input.radius,
      y: input.center.y + Math.sin(angle) * input.radius,
    });
  }
  const hidden = Math.max(input.count - shown, 0);
  return {
    space: input.space,
    dots,
    // 环外偏下:圆心正下方一个环半径 + 一个间距(理由见 OVERFLOW_GAP)
    overflow: hidden === 0 ? null : { x: input.center.x, y: input.center.y + input.radius + OVERFLOW_GAP, n: hidden },
  };
}
