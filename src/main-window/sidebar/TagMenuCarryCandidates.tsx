/**
 * 携带面板下半的候选列表(自 TagMenuCarryPane 拆出,守 200 行红线):
 * 只负责渲染已排好序的行(高亮段已由上层重定位到纯文本),键盘/鼠标的选中由上层传入下标。
 */
import type { ReactNode } from 'react';
import type { MatchRange } from '../../shared/fuzzy-score';
import { tagLabelPlain } from '../../shared/tag-label';
import { ITEM_CLASS } from './tag-menu-ui';

/** 一行候选:数值 id(落库用)+ 完整路径 + 相对纯文本的高亮段 */
export interface CarryCandidate {
  id: number;
  path: string;
  ranges: readonly MatchRange[];
}

/** 命中段 -> 节点:ranges 已基于纯文本(remap 在上层做过),这里只切片,不做匹配 */
function HighlightedPath(p: { path: string; ranges: readonly MatchRange[] }): ReactNode {
  const plain = tagLabelPlain(p.path);
  const parts: ReactNode[] = [];
  let at = 0;
  p.ranges.forEach((r, i) => {
    if (r.start > at) parts.push(plain.slice(at, r.start));
    parts.push(
      <mark key={i} className="rounded-xs bg-accent-soft text-accent-text">
        {plain.slice(r.start, r.end)}
      </mark>
    );
    at = r.end;
  });
  if (at < plain.length) parts.push(plain.slice(at));
  return <>{parts}</>;
}

export function TagMenuCarryCandidates(p: {
  rows: readonly CarryCandidate[];
  activeIndex: number;
  busy: boolean;
  onHover: (index: number) => void;
  onPick: (candidate: CarryCandidate) => void;
}): ReactNode {
  return (
    <div className="mt-0.5">
      {p.rows.map((c, i) => (
        <button
          key={c.id}
          type="button"
          data-carry-candidate={c.id}
          disabled={p.busy}
          onMouseEnter={() => p.onHover(i)}
          // 鼠标路径走 mousedown + preventDefault:onClick 之前焦点已被浏览器移到按钮上,输入框一失焦后续打字就落空
          onMouseDown={(e) => {
            e.preventDefault();
            p.onPick(c);
          }}
          className={ITEM_CLASS + (i === p.activeIndex ? ' bg-accent-soft text-accent-text' : '')}
        >
          <HighlightedPath path={c.path} ranges={c.ranges} />
        </button>
      ))}
    </div>
  );
}
