/**
 * `drawPlan` 的关系边层(Task 5,自 `graph-draw-plan.ts` 分出,守 200 行红线):
 * 把 `A -> B` 的标签关系折成屏幕线段(恒带箭头),并在缩放够大时把备注文字放在箭头中点。
 *
 * 与其它边同一套裁剪与强调口径:两端都不在视口内就丢、任一端暗则暗、任一端是焦点则加粗。
 * 备注只在 `k >= RELATION_REMARK_MIN_K` 时给出(低缩放只画箭头不画字),文本缺失也不画。
 * 文字位置是线段中点(**箭头尖在画布层按目标半径回收**,中点仍按两端点算,免得随半径漂)。
 */
import { tagLabelPlain } from '../../shared/tag-label';
import type { RelationEdge } from './graph-relations';
import { screenOf, type Camera } from './graph-camera';
import { isDimmed, type Emphasis } from './graph-focus';
import { RELATION_REMARK_MIN_K } from './graph-draw-plan-metrics';
import type { Point } from './radial';
import type { RelationMark, Segment } from './graph-draw-plan-types';

export function planRelations(input: {
  relations: readonly RelationEdge[];
  points: Map<number, Point>;
  cam: Camera;
  visible: ReadonlySet<number>;
  emphasis: Emphasis;
}): { segments: Segment[]; marks: RelationMark[] } {
  const { relations, points, cam, visible, emphasis } = input;
  const segments: Segment[] = [];
  const marks: RelationMark[] = [];
  const showMarks = cam.k >= RELATION_REMARK_MIN_K;
  for (const r of relations) {
    const pa = points.get(r.a);
    const pb = points.get(r.b);
    if (!pa || !pb) continue; // 位置未知(布局未覆盖)
    if (!visible.has(r.a) && !visible.has(r.b)) continue; // 两端都在视口外
    const a = screenOf(pa, cam);
    const b = screenOf(pb, cam);
    segments.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      weight: 1,
      emphasized: r.a === emphasis.active || r.b === emphasis.active,
      dim: isDimmed(r.a, emphasis) || isDimmed(r.b, emphasis),
      arrow: true,
    });
    // 备注只影响显示(设计 R6),行内 md 标记(加粗/链接等)不该画到画布上 —— 与侧栏
    // `relationLabel` 同一口径取纯文本;剥完为空(如 `****`)则不画字。
    const remark = tagLabelPlain(r.remark);
    if (showMarks && remark !== '') {
      marks.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: remark });
    }
  }
  return { segments, marks };
}
