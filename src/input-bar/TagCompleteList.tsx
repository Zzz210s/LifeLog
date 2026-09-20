import type { ReactNode } from 'react';
import { SUGGEST_MAX_ROWS, SUGGEST_PAD_CSS, SUGGEST_ROW_CSS } from '../shared/input-geometry';

export interface TagCompleteListProps {
  items: string[];
  activeIndex: number;
  onPick: (path: string) => void;
}

/**
 * # 补全候选列表(spec 6.3 的形态升级):像浏览器搜索框下方的推荐词条那样,
 * **长在输入框正下方**、占窗口内的独立高度(窗口随之变高,关闭再缩回去),
 * 而不是压在小弹窗里盖住输入框。完整路径展示、末级加粗;
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
      {p.items.map((path, i) => {
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
            <span className="truncate">
              <span className="text-faint">{parent}</span>
              <span className="font-semibold">{leaf}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
