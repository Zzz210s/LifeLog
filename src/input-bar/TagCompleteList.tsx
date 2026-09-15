import type { ReactNode } from 'react';

export interface TagCompleteListProps {
  items: string[];
  activeIndex: number;
  onPick: (path: string) => void;
}

/**
 * # 补全候选下拉(spec 6.3):完整路径展示、末级加粗;
 * 底部锚定向上生长(输入栏是贴纸小窗,顶部多为正在输入的行);
 * onMouseDown + preventDefault 保住 textarea 焦点与光标(采纳要读光标位置)。
 */
export function TagCompleteList(p: TagCompleteListProps): ReactNode {
  if (p.items.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="标签补全候选"
      className="absolute bottom-[14px] left-[14px] z-10 max-h-[168px] w-64 overflow-y-auto rounded-md border border-border bg-raised py-1 shadow-lg"
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
            onMouseDown={(e) => {
              e.preventDefault();
              p.onPick(path);
            }}
            className={
              'block w-full truncate px-3 py-1 text-left text-xs ' +
              (active ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-hover')
            }
          >
            <span className="text-faint">{parent}</span>
            <span className="font-semibold">{leaf}</span>
          </button>
        );
      })}
    </div>
  );
}
