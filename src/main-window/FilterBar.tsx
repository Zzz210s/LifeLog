import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface FilterBarProps {
  keyword: string;
  onKeyword: (kw: string) => void;
  tags: string[];
  allTags: { name: string; count: number }[];
  onToggleTag: (name: string) => void;
  oldestFirst: boolean;
  onToggleSort: () => void;
  /** 导出(阶段 4 Task 4 接入;未传则不渲染按钮) */
  onExport?: () => void;
}

/** 筛选栏:关键词(内部 300ms 防抖上抛)| 标签多选 chips | 排序切换 | 导出(可选) */
export function FilterBar(p: FilterBarProps): ReactNode {
  const [kw, setKw] = useState(p.keyword);
  const timer = useRef<number | null>(null);

  // 外部 keyword 重置(未来场景)同步回输入框
  useEffect(() => setKw(p.keyword), [p.keyword]);

  const onInput = (v: string) => {
    setKw(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => p.onKeyword(v.trim()), 300);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className="border-b border-gray-200 px-4 py-2">
      <div className="flex items-center gap-2">
        <input
          value={kw}
          onChange={(e) => onInput(e.target.value)}
          placeholder="搜索笔记与标签"
          aria-label="搜索笔记与标签"
          className="h-8 flex-1 rounded-md border border-gray-300 px-2.5 text-sm outline-none focus:border-blue-500"
        />
        <button
          onClick={p.onToggleSort}
          className="h-8 shrink-0 rounded-md border border-gray-300 px-2.5 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600"
        >
          排序: {p.oldestFirst ? '最早' : '最新'}
        </button>
        {p.onExport && (
          <button
            onClick={p.onExport}
            className="h-8 shrink-0 rounded-md border border-gray-300 px-2.5 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600"
          >
            导出
          </button>
        )}
      </div>
      {p.allTags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {p.allTags.map(({ name, count }) => {
            const active = p.tags.includes(name);
            return (
              <button
                key={name}
                onClick={() => p.onToggleTag(name)}
                aria-pressed={active}
                className={
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors ' +
                  (active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400 hover:text-blue-600')
                }
              >
                #{name}
                <span className={active ? 'ml-1 opacity-80' : 'ml-1 text-gray-400'}>{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
