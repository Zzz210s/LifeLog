/**
 * `drawPlan` 的关系边层(Task 5,自 `graph-draw-plan.ts` 分出,守 200 行红线):
 * 把 `A -> B` 的标签关系折成屏幕线段(恒带箭头),并在缩放够大时把备注文字放在箭头附近。
 *
 * 与其它边同一套裁剪与强调口径:两端都不在视口内就丢、任一端暗则暗、任一端是焦点则加粗。
 * 备注只在 `k >= RELATION_REMARK_MIN_K`(即聚合阈值 0.6,未进聚合档)**且该边端点正是当前焦点**
 * (悬停或选中该标签)时给出 —— 平时只画箭头(2026-10-06 用户口径:属性名只在悬停/选中该标签时显示,
 * 复用既有 `emphasis` 机制,不新造状态),聚合档没有单条边也不画字;文本缺失也不画。
 * 箭头尖按**目标半径 + `ARROW_RETREAT_GAP`** 回收(半径由调用方给,聚合档给桶半径),
 * 免得大节点把箭头整只盖住;备注沿箭头法线错开 `RELATION_REMARK_OFFSET` 并带 `dim`,
 * 画布再给它垫一层胶囊,才不会被节点标签同色同字体地淹掉。
 */
import { tagLabelPlain } from '../../shared/tag-label';
import type { RelationEdge } from './graph-relations';
import { screenOf, type Camera } from './graph-camera';
import { isDimmed, type Emphasis } from './graph-focus';
import {
  ARROW_RETREAT_GAP,
  RELATION_REMARK_MIN_K,
  RELATION_REMARK_OFFSET,
} from './graph-draw-plan-metrics';
import type { Point } from './radial';
import type { RelationMark, Segment } from './graph-draw-plan-types';

/**
 * 备注纯文本表:一行 md 标记(加粗/链接等)的剥除是**逐帧不变的活**(备注取自库里的属性名),
 * 而 `relations` 数组在相机移动期间引用不变 —— 按引用缓一次就够(WeakMap,数据一换自动失效)。
 */
const plainCache = new WeakMap<readonly RelationEdge[], string[]>();

function plainRemarks(relations: readonly RelationEdge[]): string[] {
  const hit = plainCache.get(relations);
  if (hit !== undefined) return hit;
  const out = relations.map((r) => tagLabelPlain(r.remark));
  plainCache.set(relations, out);
  return out;
}

export function planRelations(input: {
  relations: readonly RelationEdge[];
  points: Map<number, Point>;
  cam: Camera;
  visible: ReadonlySet<number>;
  emphasis: Emphasis;
  /** 终点圆半径(按标签 id 取;聚合档取桶半径,取不到退回节点半径口径) */
  radiusOf: (id: number) => number;
}): { segments: Segment[]; marks: RelationMark[] } {
  const { relations, points, cam, visible, emphasis, radiusOf } = input;
  const segments: Segment[] = [];
  const marks: RelationMark[] = [];
  const showMarks = cam.k >= RELATION_REMARK_MIN_K;
  // 备注纯文本按 relations 引用缓存(逐帧不变的 md 剥除,见 plainRemarks)
  const plain = showMarks ? plainRemarks(relations) : null;
  for (let i = 0; i < relations.length; i += 1) {
    const r = relations[i];
    const pa = points.get(r.a);
    const pb = points.get(r.b);
    if (!pa || !pb) continue; // 位置未知(布局未覆盖)
    if (!visible.has(r.a) && !visible.has(r.b)) continue; // 两端都在视口外
    const a = screenOf(pa, cam);
    const b = screenOf(pb, cam);
    const dim = isDimmed(r.a, emphasis) || isDimmed(r.b, emphasis);
    segments.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      weight: 1,
      emphasized: r.a === emphasis.active || r.b === emphasis.active,
      dim,
      arrow: true,
      pullback: radiusOf(r.b) + ARROW_RETREAT_GAP,
    });
    // 备注只影响显示(设计 R6),行内 md 标记(加粗/链接等)不该画到画布上 —— 与侧栏
    // `relationLabel` 同一口径取纯文本;剥完为空(如 `****`)则不画字。
    // 2026-10-06:只在**该边端点就是焦点**(悬停/选中该标签)时出字 —— 平时只画箭头,
    // 否则 24 条属性名会把骨架糊住。`emphasis.active` = 悬停优先于选中,复用既有机制。
    const remark = plain === null ? '' : plain[i];
    const hot = emphasis.active !== null && (r.a === emphasis.active || r.b === emphasis.active);
    if (showMarks && hot && remark !== '') {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      marks.push({
        x: (a.x + b.x) / 2 - (dy / len) * RELATION_REMARK_OFFSET,
        y: (a.y + b.y) / 2 + (dx / len) * RELATION_REMARK_OFFSET,
        text: remark,
        dim,
      });
    }
  }
  return { segments, marks };
}
