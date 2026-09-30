/**
 * 展开笔记的小圆布局(纯函数)。
 * 坐标是**世界坐标**(与 `radial` 的 Point 同一口径),交给 `drawPlan` 经相机换算成屏幕坐标。
 * 上限存在的理由:一个标签可能挂上千条笔记,全画出来会糊满整屏;略去的条数用 `+N` 交代。
 */
import type { Point } from './radial';

export const NOTE_LIMIT = 20;

export interface NoteFan {
  dots: Point[];
  /** 没画出来的那部分提示位(圆心):`n` 是略去的条数;全都画出来时为 null */
  overflow: { x: number; y: number; n: number } | null;
}

export function noteFan(input: {
  center: Point;
  count: number;
  radius: number;
  limit?: number;
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
  return { dots, overflow: hidden === 0 ? null : { x: input.center.x, y: input.center.y, n: hidden } };
}
