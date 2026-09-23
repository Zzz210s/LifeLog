import type { ReactNode } from 'react';
import type { MatchRange } from '../shared/fuzzy-score';
import { SUGGEST_MAX_ROWS, SUGGEST_PAD_CSS, SUGGEST_ROW_CSS } from '../shared/input-geometry';
import type { CompleteRow } from './tag-complete';

export interface TagCompleteListProps {
  items: CompleteRow[];
  activeIndex: number;
  /** 采纳:恒传目标标签路径(别名候选也写入规范路径) */
  onPick: (path: string) => void;
}

const BADGE: Record<'alias' | 'similar', { text: string; hint: string }> = {
  alias: { text: '别名', hint: '别名:采纳后写入 ' },
  similar: { text: '近似', hint: '近似标签:采纳后写入 ' },
};

/** 行尾弱化标记:别名 / 近似(标签项无标记) */
function KindBadge(p: { kind: 'alias' | 'similar'; path: string }): ReactNode {
  const badge = BADGE[p.kind];
  return (
    <span
      className="ml-2 shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-faint"
      title={badge.hint + p.path}
    >
      {badge.text}
    </span>
  );
}

/**
 * 路径 -> 渲染片段(纯函数,供列表行渲染与单测):
 * - 命中段**整段**包 `<mark>`:跨「父段/末级」边界也不切开,`<mark>` 段数恒等于打分器给的段数
 *   (切开会把一个连续命中渲染成两个相邻 mark,`rounded-xs` 在接缝处露出圆角缺口);
 * - 非命中段按边界切成弱化的父段与加粗的末级(边界 = 末级前那个 `/` 之后)。
 * 命中段一律来自打分器(纪律 1),这里只做切片,不做匹配。
 */
export interface PathPiece {
  readonly text: string;
  readonly hit: boolean;
  /** 是否加粗(末级);命中段的加粗判据同此(按段起点是否已进入末级) */
  readonly bold: boolean;
}

export function pathPieces(path: string, ranges: readonly MatchRange[]): PathPiece[] {
  const boundary = path.lastIndexOf('/') + 1; // 父段长度(含末级前的 /);无 / 时为 0
  const pieces: PathPiece[] = [];
  const plain = (text: string, from: number): void => {
    if (text === '') return;
    const cut = Math.min(Math.max(boundary - from, 0), text.length);
    if (cut > 0) pieces.push({ text: text.slice(0, cut), hit: false, bold: false });
    if (cut < text.length) pieces.push({ text: text.slice(cut), hit: false, bold: true });
  };
  let at = 0;
  for (const range of ranges) {
    const start = Math.max(at, Math.min(range.start, path.length));
    const end = Math.max(start, Math.min(range.end, path.length));
    if (start > at) plain(path.slice(at, start), at);
    if (end > start) pieces.push({ text: path.slice(start, end), hit: true, bold: start >= boundary });
    at = end;
  }
  plain(path.slice(at), at);
  return pieces;
}

/** 片段 -> 节点:命中段是 `<mark>`(类名与主窗浮层的 PaletteRow 逐字一致),其余按父/末级上样式 */
function Piece(p: { piece: PathPiece }): ReactNode {
  const { text, hit, bold } = p.piece;
  if (hit) {
    return (
      <mark className={'rounded-xs bg-accent-soft text-accent-text' + (bold ? ' font-semibold' : '')}>
        {text}
      </mark>
    );
  }
  return <span className={bold ? 'font-semibold' : 'text-faint'}>{text}</span>;
}

/**
 * # 补全候选列表(spec 6.3 的形态升级):像浏览器搜索框下方的推荐词条那样,
 * **长在输入框正下方**、占窗口内的独立高度(窗口随之变高,关闭再缩回去),
 * 而不是压在小弹窗里盖住输入框。完整路径展示、末级加粗;别名命中项(G3)在行尾标一个弱化的
 * 「别名」小标,近义提示项(G4)标「近似」—— 都是提示这行是怎么命中的,
 * 采纳后写入的始终是目标标签的规范路径。
 * 命中高亮段(T8)一律来自打分器(`completeMatch` 的 ranges),渲染见 `pathPieces`
 * (纪律 1:UI 不另写 matcher);别名/近义项匹配的是别名串而非展示的路径,
 * 因此恒无高亮段。固定项带 `data-pinned` 标记(空词元时排最前)。
 * 行高固定 SUGGEST_ROW_CSS,前端按它算窗口高度,所以这里不再用 py 之类的可变内边距。
 * onMouseDown + preventDefault 保住 textarea 焦点与光标(采纳要读光标位置)。
 *
 * R5-1(2026-09-21 实测):候选上限 COMPLETE_LIMIT(8)与 SUGGEST_MAX_ROWS(8)同值,
 * 列表高度正是“8 行 + 自身上下内边距”,内容永远不会高于自身 max-height ——
 * 原先的 overflow-y-auto 因此在 8 条候选时只能从 1 像素取整残差里挤出一条**永远滚不动的**
 * 滚动条(实测 ch 199 / sh 200 / barW 15),滚轮落在列表上反而触发了输入栏缩放,
 * 既误导视觉又白吃 15px 宽度。这里不再声明 overflow(内容高度按行数算准,不需要内部滚动);
 * 若将来把 COMPLETE_LIMIT 调大于 SUGGEST_MAX_ROWS,必须同时改回可滚动,否则多余候选会被窗口裁掉。
 */
export function TagCompleteList(p: TagCompleteListProps): ReactNode {
  if (p.items.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="标签补全候选"
      data-testid="tag-suggest"
      className="w-full shrink-0 border-t border-border bg-raised"
      style={{ maxHeight: SUGGEST_MAX_ROWS * SUGGEST_ROW_CSS + SUGGEST_PAD_CSS, paddingTop: 4, paddingBottom: 4 }}
    >
      {p.items.map((it, i) => {
        const path = it.path;
        const active = i === p.activeIndex;
        return (
          <button
            key={path}
            type="button"
            role="option"
            aria-selected={active}
            data-pinned={it.pinned ? 'true' : undefined}
            title={path}
            style={{ height: SUGGEST_ROW_CSS }}
            onMouseDown={(e) => {
              e.preventDefault();
              p.onPick(path);
            }}
            className={
              'flex w-full items-center px-3 text-left text-xs ' +
              (active ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-hover')
            }
          >
            <span className="min-w-0 flex-1 truncate">
              {pathPieces(path, it.ranges).map((piece, k) => (
                <Piece key={k} piece={piece} />
              ))}
            </span>
            {it.kind !== 'tag' && <KindBadge kind={it.kind} path={path} />}
          </button>
        );
      })}
    </div>
  );
}
