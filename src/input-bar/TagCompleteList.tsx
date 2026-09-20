import type { ReactNode } from 'react';
import type { CompleteItem } from '../shared/types';
import { SUGGEST_MAX_ROWS, SUGGEST_PAD_CSS, SUGGEST_ROW_CSS } from '../shared/input-geometry';

export interface TagCompleteListProps {
  items: CompleteItem[];
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
 * # 补全候选列表(spec 6.3 的形态升级):像浏览器搜索框下方的推荐词条那样,
 * **长在输入框正下方**、占窗口内的独立高度(窗口随之变高,关闭再缩回去),
 * 而不是压在小弹窗里盖住输入框。完整路径展示、末级加粗;别名命中项(G3)在行尾标一个弱化的
 * 「别名」小标,近义提示项(G4)标「近似」—— 都是提示这行是怎么命中的,
 * 采纳后写入的始终是目标标签的规范路径。
 * 行高固定 SUGGEST_ROW_CSS,前端按它算窗口高度,所以这里不再用 py 之类的可变内边距。
 * onMouseDown + preventDefault 保住 textarea 焦点与光标(采纳要读光标位置)。
 */
export function TagCompleteList(p: TagCompleteListProps): ReactNode {
  if (p.items.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="标签补全候选"
      data-testid="tag-suggest"
      className="w-full shrink-0 overflow-y-auto border-t border-border bg-raised"
      style={{ maxHeight: SUGGEST_MAX_ROWS * SUGGEST_ROW_CSS + SUGGEST_PAD_CSS, paddingTop: 4, paddingBottom: 4 }}
    >
      {p.items.map((it, i) => {
        const path = it.path;
        const slash = path.lastIndexOf('/');
        const parent = slash >= 0 ? path.slice(0, slash + 1) : '';
        const leaf = slash >= 0 ? path.slice(slash + 1) : path;
        const active = i === p.activeIndex;
        return (
          <button
            key={path}
            type="button"
            role="option"
            aria-selected={active}
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
              <span className="text-faint">{parent}</span>
              <span className="font-semibold">{leaf}</span>
            </span>
            {it.kind !== 'tag' && <KindBadge kind={it.kind} path={path} />}
          </button>
        );
      })}
    </div>
  );
}
