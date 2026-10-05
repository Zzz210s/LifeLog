/**
 * `drawPlan` 的展开层(自 `graph-draw-plan.ts` 抽出):当前展开标签下的笔记小圆、笔记间 link 边
 * 与略去条数的 `+N` 提示位。展开者自己被裁到视口外时整组不画(否则会留下飘在空处的孤儿小圆)。
 */
import type { GraphLink } from '../../shared/types';
import { screenOf, type Camera } from './graph-camera';
import type { Point } from './radial';
import type { ExpandedInput, NoteDot, OverflowDot, Segment } from './graph-draw-plan-types';

export function planExpanded(input: {
  expanded: ExpandedInput | null;
  links: readonly GraphLink[];
  cam: Camera;
  visible: ReadonlySet<number>;
}): { notes: NoteDot[]; links: Segment[]; overflow: OverflowDot | null } {
  const { expanded, cam, visible } = input;
  const notes: NoteDot[] = [];
  const links: Segment[] = [];
  let overflow: OverflowDot | null = null;
  if (expanded !== null && visible.has(expanded.id)) {
    // 屏幕口径原样用,世界口径才过相机 —— 判据只在 expanded.space 一处
    const toScreen = (p: Point): Point => (expanded.space === 'screen' ? p : screenOf(p, cam));
    for (const d of expanded.dots) notes.push({ id: d.id, ...toScreen(d) });
    // link 边:两端笔记都在这一圈小圆里才画(看不见的一端没有落点,画出来是飘在空处的线)。
    // `emphasized` / `dim` 恒 false:强调态的 active/selected 是**标签** id,让笔记 id 去撞它
    // 会毫无预兆地画出一条粗线或暗线(两套 id 真的会同数)。
    const at = new Map(notes.map((n) => [n.id, n]));
    for (const l of input.links) {
      const s = at.get(l.a);
      const t = at.get(l.b);
      if (s === undefined || t === undefined || l.a === l.b) continue;
      links.push({ x1: s.x, y1: s.y, x2: t.x, y2: t.y, weight: 1, emphasized: false, dim: false });
    }
    if (expanded.overflow !== null) {
      const s = toScreen(expanded.overflow);
      overflow = { id: expanded.overflow.id, x: s.x, y: s.y, n: expanded.overflow.n };
    }
  }
  return { notes, links, overflow };
}
